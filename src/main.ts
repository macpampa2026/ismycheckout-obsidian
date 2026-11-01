import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, requestUrl, moment } from "obsidian";

// Plugin oficial de IsMyCheckout: baja las notas de tus tiendas (solo lectura) y las mantiene al día.
// Respeta lo que escribas debajo de «## Mis notas» en cada nota.

interface Ajustes {
  clave: string;
  servidor: string;
  carpeta: string;
  cadaMinutos: number;
  alAbrir: boolean;
  ultima: string;
}

const DEFECTO: Ajustes = {
  clave: "",
  servidor: "https://ismycheckout.com",
  carpeta: "IsMyCheckout",
  cadaMinutos: 60,
  alAbrir: true,
  ultima: "",
};

const MIS_NOTAS = "## Mis notas";

type Textos = Record<string, string>;
const ES: Textos = {
  sync: "Sincronizar IsMyCheckout",
  sinClave: "IsMyCheckout: falta tu clave. Creala en tu panel (Configuración → Conectar con Obsidian) y pegala en los ajustes del plugin.",
  listo: "IsMyCheckout: {n} notas actualizadas.",
  error: "IsMyCheckout: no se pudo sincronizar. {e}",
  sincronizando: "IsMyCheckout: sincronizando…",
  clave: "Clave de Obsidian",
  claveDesc: "Creala en tu panel de IsMyCheckout: Configuración → Conectar con Obsidian. Es solo de lectura.",
  carpeta: "Carpeta",
  carpetaDesc: "Dónde se guardan las notas dentro de tu bóveda.",
  cada: "Actualizar cada (minutos)",
  cadaDesc: "0 = solo cuando toques «Sincronizar». Mínimo 15.",
  alAbrir: "Sincronizar al abrir Obsidian",
  servidor: "Servidor",
  servidorDesc: "No lo cambies salvo que te lo pidamos.",
  ahora: "Sincronizar ahora",
  ultima: "Última sincronización: {f}",
  nunca: "Todavía no sincronizaste.",
};
const EN: Textos = {
  sync: "Sync IsMyCheckout",
  sinClave: "IsMyCheckout: your key is missing. Create it in your dashboard (Configuración → Conectar con Obsidian) and paste it in the plugin settings.",
  listo: "IsMyCheckout: {n} notes updated.",
  error: "IsMyCheckout: sync failed. {e}",
  sincronizando: "IsMyCheckout: syncing…",
  clave: "Obsidian key",
  claveDesc: "Create it in your IsMyCheckout dashboard: Configuración → Conectar con Obsidian. It is read-only.",
  carpeta: "Folder",
  carpetaDesc: "Where the notes are saved inside your vault.",
  cada: "Update every (minutes)",
  cadaDesc: "0 = only when you click «Sync». Minimum 15.",
  alAbrir: "Sync when Obsidian opens",
  servidor: "Server",
  servidorDesc: "Do not change it unless we ask you to.",
  ahora: "Sync now",
  ultima: "Last sync: {f}",
  nunca: "You have not synced yet.",
};

function t(k: string, vars: Record<string, string | number> = {}): string {
  const loc = (moment.locale() || "en").toLowerCase();
  const base = loc.startsWith("es") ? ES : EN;
  let s = base[k] || EN[k] || k;
  for (const v of Object.keys(vars)) s = s.split("{" + v + "}").join(String(vars[v]));
  return s;
}

// Solo rutas .md relativas, sin «..» ni barras raras: el servidor no puede escribir fuera de la carpeta.
function rutaSegura(r: string): boolean {
  if (!r || !r.endsWith(".md") || r.startsWith("/") || r.includes("\\")) return false;
  return r.split("/").every((p) => p !== "" && p !== "." && p !== "..");
}

function mezclar(nuevo: string, viejo: string): string {
  // Conserva lo que el vendedor escribió debajo de «## Mis notas».
  const iv = viejo.indexOf(MIS_NOTAS);
  if (iv < 0) return nuevo;
  const suyo = viejo.slice(iv + MIS_NOTAS.length).replace(/^\s*\n/, "").trimEnd();
  if (!suyo) return nuevo;
  const inn = nuevo.indexOf(MIS_NOTAS);
  const cabeza = inn >= 0 ? nuevo.slice(0, inn) : nuevo.trimEnd() + "\n\n";
  return cabeza + MIS_NOTAS + "\n\n" + suyo + "\n";
}

export default class IsMyCheckoutPlugin extends Plugin {
  ajustes: Ajustes = { ...DEFECTO };
  private enCurso = false;
  private timer: number | null = null;

  async onload() {
    this.ajustes = Object.assign({}, DEFECTO, await this.loadData());
    this.addRibbonIcon("refresh-cw", t("sync"), () => this.sincronizar(true));
    this.addCommand({ id: "sincronizar", name: t("sync"), callback: () => this.sincronizar(true) });
    this.addSettingTab(new Pestana(this.app, this));
    this.programar();
    if (this.ajustes.alAbrir && this.ajustes.clave) {
      this.app.workspace.onLayoutReady(() => this.sincronizar(false));
    }
  }

  onunload() {
    if (this.timer !== null) window.clearInterval(this.timer);
  }

  programar() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const min = this.ajustes.cadaMinutos;
    if (min > 0) {
      this.timer = window.setInterval(() => this.sincronizar(false), Math.max(15, min) * 60 * 1000);
      this.registerInterval(this.timer);
    }
  }

  async guardar() {
    await this.saveData(this.ajustes);
  }

  async asegurarCarpeta(ruta: string) {
    const partes = ruta.split("/");
    partes.pop();
    let acc = "";
    for (const p of partes) {
      acc = acc ? acc + "/" + p : p;
      if (!this.app.vault.getAbstractFileByPath(acc)) {
        try { await this.app.vault.createFolder(acc); } catch (_e) { /* ya existe */ }
      }
    }
  }

  async sincronizar(avisar: boolean) {
    if (this.enCurso) return;
    if (!this.ajustes.clave) {
      if (avisar) new Notice(t("sinClave"), 10000);
      return;
    }
    this.enCurso = true;
    const aviso = avisar ? new Notice(t("sincronizando"), 0) : null;
    try {
      const r = await requestUrl({
        url: this.ajustes.servidor.replace(/\/+$/, "") + "/obsidian/v1/notas",
        headers: { Authorization: "Bearer " + this.ajustes.clave.trim() },
        throw: false,
      });
      const d = r.json;
      if (r.status !== 200 || !d || !d.ok) throw new Error((d && d.error) || "HTTP " + r.status);
      let n = 0;
      const base = normalizePath(this.ajustes.carpeta || "IsMyCheckout");
      for (const tienda of d.tiendas || []) {
        const carpeta = String(tienda.carpeta || "");
        if (!carpeta || carpeta.includes("/") || carpeta.includes("..")) continue;
        for (const rel of Object.keys(tienda.archivos || {})) {
          if (!rutaSegura(rel)) continue;
          const ruta = normalizePath(base + "/" + carpeta + "/" + rel);
          const nuevo = String(tienda.archivos[rel]);
          const f = this.app.vault.getAbstractFileByPath(ruta);
          if (f instanceof TFile) {
            let cambio = false;
            await this.app.vault.process(f, (viejo) => {
              const final = mezclar(nuevo, viejo);
              cambio = final !== viejo;
              return final;
            });
            if (cambio) n++;
          } else if (!f) {
            await this.asegurarCarpeta(ruta);
            await this.app.vault.create(ruta, nuevo);
            n++;
          }
        }
      }
      this.ajustes.ultima = new Date().toISOString();
      await this.guardar();
      if (avisar) new Notice(t("listo", { n }));
    } catch (e) {
      if (avisar) new Notice(t("error", { e: (e as Error).message || "" }), 10000);
    } finally {
      if (aviso) aviso.hide();
      this.enCurso = false;
    }
  }
}

class Pestana extends PluginSettingTab {
  plugin: IsMyCheckoutPlugin;

  constructor(app: App, plugin: IsMyCheckoutPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const a = this.plugin.ajustes;

    new Setting(containerEl).setName(t("clave")).setDesc(t("claveDesc")).addText((tx) => {
      tx.inputEl.type = "password";
      tx.setPlaceholder("imcobs_…").setValue(a.clave).onChange(async (v) => { a.clave = v.trim(); await this.plugin.guardar(); });
    });
    new Setting(containerEl).setName(t("carpeta")).setDesc(t("carpetaDesc")).addText((tx) =>
      tx.setValue(a.carpeta).onChange(async (v) => { a.carpeta = v.trim() || "IsMyCheckout"; await this.plugin.guardar(); }));
    new Setting(containerEl).setName(t("cada")).setDesc(t("cadaDesc")).addText((tx) =>
      tx.setValue(String(a.cadaMinutos)).onChange(async (v) => {
        const n = parseInt(v, 10);
        a.cadaMinutos = isNaN(n) || n <= 0 ? 0 : Math.max(15, n);
        await this.plugin.guardar();
        this.plugin.programar();
      }));
    new Setting(containerEl).setName(t("alAbrir")).addToggle((tg) =>
      tg.setValue(a.alAbrir).onChange(async (v) => { a.alAbrir = v; await this.plugin.guardar(); }));
    new Setting(containerEl).setName(t("servidor")).setDesc(t("servidorDesc")).addText((tx) =>
      tx.setValue(a.servidor).onChange(async (v) => { a.servidor = v.trim() || DEFECTO.servidor; await this.plugin.guardar(); }));
    new Setting(containerEl)
      .setDesc(a.ultima ? t("ultima", { f: new Date(a.ultima).toLocaleString() }) : t("nunca"))
      .addButton((b) => b.setButtonText(t("ahora")).setCta().onClick(async () => {
        await this.plugin.sincronizar(true);
        this.display();
      }));
  }
}
