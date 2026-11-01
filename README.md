# IsMyCheckout for Obsidian

Sync your [IsMyCheckout](https://ismycheckout.com) stores into linked notes. Read-only. One key per account brings **all your stores**:

- Products, checkouts and monthly sales
- Campaigns and ads (UTM)
- Upsells and order bumps
- Visits and conversion
- Abandoned carts (counts only)
- Coupons
- Earnings and fees
- Store and checkout copy
- Countries and currencies

## How it works
1. In your IsMyCheckout dashboard go to **Configuración → Conectar con Obsidian** and create your **Obsidian key** (it starts with `imcobs_`).
2. Install this plugin, open its settings and paste the key.
3. Click the ribbon icon or run the command **Sync IsMyCheckout**. Notes are created in the `IsMyCheckout` folder and can update automatically every hour.

Anything you write under **«## Mis notas»** in each note is kept when the plugin updates it.

## Privacy and security
- The key is **read-only**: it can only download these notes. It cannot change your store, and it is not your API key.
- Notes contain **no buyer names, emails or phone numbers**.
- Each key only returns the stores of the account that created it. Nobody can read another account's data, and your notes live only in your own vault.
- Repeated attempts with invalid keys are blocked, and your dashboard shows when the key was last used.
- The plugin only connects to `https://ismycheckout.com` (network use is required to download your data). No telemetry.
- An IsMyCheckout account is required.

---

## En español
Sincroniza todas tus tiendas de IsMyCheckout como notas enlazadas: productos, checkouts, ventas por mes, campañas, upsells y bumps, visitas y conversión, carritos abandonados, cupones, ganancias y comisiones, textos de la tienda, y países y monedas.
1. En tu panel: **Configuración → Conectar con Obsidian** → «Crear mi clave de Obsidian».
2. Instalá el plugin y pegá la clave en sus ajustes.
3. Tocá el ícono o el comando **Sincronizar IsMyCheckout**.

Lo que escribas debajo de **«## Mis notas»** se respeta al actualizar. La clave es solo de lectura y las notas no traen nombres ni emails de tus compradores.
