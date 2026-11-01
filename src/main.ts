import { App, Notice, Plugin, PluginSettingTab, Setting, SettingDefinitionItem, TFile, normalizePath, requestUrl, moment } from "obsidian";

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

interface TiendaNotas {
  carpeta: string;
  archivos: Record<string, string>;
}

interface Respuesta {
  ok: boolean;
  error?: string;
  tiendas: TiendaNotas[];
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

// Valida la respuesta del servidor sin confiar en su forma.
function leerRespuesta(x: unknown): Respuesta {
  if (!esObjeto(x)) return { ok: false, tiendas: [] };
  const tiendas: TiendaNotas[] = [];
  if (Array.isArray(x.tiendas)) {
    for (const t of x.tiendas as unknown[]) {
      if (!esObjeto(t) || typeof t.carpeta !== "string" || !esObjeto(t.archivos)) continue;
      const archivos: Record<string, string> = {};
      for (const [k, v] of Object.entries(t.archivos)) if (typeof v === "string") archivos[k] = v;
      tiendas.push({ carpeta: t.carpeta, archivos });
    }
  }
  return { ok: x.ok === true, error: typeof x.error === "string" ? x.error : undefined, tiendas };
}

type Textos = Record<string, string>;
const ES: Textos = {
  sync: "Sincronizar IsMyCheckout",
  sinClave: "IsMyCheckout: falta tu clave. Creala en tu panel (Configuración → Conectar con Obsidian) y pegala en los ajustes del plugin.",
  listo: "IsMyCheckout: {n} notas actualizadas.",
  error: "IsMyCheckout: no se pudo sincronizar. {e}",
  sincronizando: "IsMyCheckout: sincronizando…",
  clave: "Clave de Obsidian",
  clavePh: "Pegá tu clave acá",
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
  clavePh: "Paste your key here",
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

  async onload(): Promise<void> {
    const guardado: unknown = await this.loadData();
    this.ajustes = Object.assign({}, DEFECTO, esObjeto(guardado) ? (guardado as Partial<Ajustes>) : {});
    this.addRibbonIcon("refresh-cw", t("sync"), () => { void this.sincronizar(true); });
    this.addCommand({ id: "sincronizar", name: t("sync"), callback: () => { void this.sincronizar(true); } });
    this.addSettingTab(new Pestana(this.app, this));
    this.programar();
    if (this.ajustes.alAbrir && this.ajustes.clave) {
      this.app.workspace.onLayoutReady(() => { void this.sincronizar(false); });
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
      this.timer = window.setInterval(() => { void this.sincronizar(false); }, Math.max(15, min) * 60 * 1000);
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
        try { await this.app.vault.createFolder(acc); } catch { /* ya existe */ }
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
      let crudo: unknown = null;
      try { crudo = r.json as unknown; } catch { crudo = null; }
      const d = leerRespuesta(crudo);
      if (r.status !== 200 || !d.ok) throw new Error(d.error || "HTTP " + r.status);
      let n = 0;
      const base = normalizePath(this.ajustes.carpeta || "IsMyCheckout");
      for (const tienda of d.tiendas) {
        const carpeta = tienda.carpeta;
        if (!carpeta || carpeta.includes("/") || carpeta.includes("..")) continue;
        for (const rel of Object.keys(tienda.archivos)) {
          if (!rutaSegura(rel)) continue;
          const ruta = normalizePath(base + "/" + carpeta + "/" + rel);
          const nuevo = tienda.archivos[rel];
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
      if (avisar) new Notice(t("error", { e: e instanceof Error ? e.message : "" }), 10000);
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

  // Ajustes declarativos: Obsidian los muestra y los encuentra en su buscador de ajustes.
  getSettingDefinitions(): SettingDefinitionItem[] {
    const a = this.plugin.ajustes;
    const guardar = async (): Promise<void> => { await this.plugin.guardar(); };
    return [
      { name: t("clave"), desc: t("claveDesc"), aliases: ["IsMyCheckout", "key", "clave"],
        render: (s: Setting) => { s.addText((tx) => {
          tx.inputEl.type = "password";
          tx.setPlaceholder(t("clavePh")).setValue(a.clave).onChange(async (v) => { a.clave = v.trim(); await guardar(); });
        }); } },
      { name: t("carpeta"), desc: t("carpetaDesc"),
        render: (s: Setting) => { s.addText((tx) =>
          tx.setValue(a.carpeta).onChange(async (v) => { a.carpeta = v.trim() || "IsMyCheckout"; await guardar(); })); } },
      { name: t("cada"), desc: t("cadaDesc"),
        render: (s: Setting) => { s.addText((tx) =>
          tx.setValue(String(a.cadaMinutos)).onChange(async (v) => {
            const n = parseInt(v, 10);
            a.cadaMinutos = isNaN(n) || n <= 0 ? 0 : Math.max(15, n);
            await guardar();
            this.plugin.programar();
          })); } },
      { name: t("alAbrir"),
        render: (s: Setting) => { s.addToggle((tg) =>
          tg.setValue(a.alAbrir).onChange(async (v) => { a.alAbrir = v; await guardar(); })); } },
      { name: t("servidor"), desc: t("servidorDesc"),
        render: (s: Setting) => { s.addText((tx) =>
          tx.setValue(a.servidor).onChange(async (v) => { a.servidor = v.trim() || DEFECTO.servidor; await guardar(); })); } },
      { name: t("ahora"), desc: a.ultima ? t("ultima", { f: new Date(a.ultima).toLocaleString() }) : t("nunca"),
        render: (s: Setting) => { s.addButton((b) => b.setButtonText(t("ahora")).setCta().onClick(async () => {
          await this.plugin.sincronizar(true);
          this.update();
        })); } },
    ];
  }
}
