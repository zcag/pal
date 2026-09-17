// Paired Bluetooth devices over the core's bluetooth capability: one row
// per device with a glyph for its kind, a connected tag and the battery
// as an accessory. Enter toggles the connection (Disconnect asks first),
// ⌘C copies the address. Live: the connected state is read again on
// every show; the list is the OS's, connected first then by name.
import { bluetooth, errorMessage, failed, hint, settings, toast, truncate, xdg, type Accessory, type Action, type BarItem, type BluetoothDevice, type Effect, type Extension, type Item } from "@zcag/pal";

type Settings = { low_threshold: number };
const EXTENSION = "bluetooth";
const MAC = process.platform === "darwin";
const MAC_SETTINGS_URL = "x-apple.systempreferences:com.apple.BluetoothSettings";
const LINUX_SETTINGS: string[][] = [["gnome-control-center", "bluetooth"], ["systemsettings", "kcm_bluetooth"], ["blueman-manager"]];
const BATTERY = "\u{f0083}"; // md-battery-alert
const BAR_MENU = { palette: "bluetooth" } as const;

const GLYPH: Record<string, string> = {
  headphones: xdg("audio-headphones")!,
  speaker: xdg("audio-speakers")!,
  keyboard: xdg("input-keyboard")!,
  mouse: xdg("input-mouse")!,
  gamepad: xdg("applications-games")!,
  phone: xdg("phone")!,
  computer: xdg("computer")!,
  watch: "\u{f0589}", // md-watch
};

const KIND: Record<string, string> = { headphones: "Headphones", speaker: "Speaker", keyboard: "Keyboard", mouse: "Mouse", gamepad: "Game controller", phone: "Phone", watch: "Watch", computer: "Computer" };

function item(d: BluetoothDevice): Item {
  const accessories: Accessory[] = [];
  if (d.battery !== null) accessories.push({ text: d.battery_detail ?? `${d.battery}%` });
  if (d.connected) accessories.push({ tag: "connected", color: "green" });
  const actions: Action[] = d.connected
    ? [{ id: "toggle", title: "Disconnect", confirm: `Disconnect ${d.name}?` }]
    : [{ id: "toggle", title: "Connect" }];
  actions.push({ id: "copy", title: "Copy address", shortcut: "cmd+c" });
  return {
    id: d.address,
    name: d.name,
    subtitle: KIND[d.kind] ?? d.address,
    icon: GLYPH[d.kind] ?? xdg(d.connected ? "bluetooth-connected" : "bluetooth")!,
    keywords: [d.address, d.kind],
    accessories,
    actions,
  };
}

/** Connected devices with an OS-reported main level, low first for the alert. */
const batteries = (devices: BluetoothDevice[]) => devices.filter((d) => d.connected && d.battery !== null).sort((a, b) => a.battery! - b.battery! || a.name.localeCompare(b.name));

/** Below this fixed floor the low alert is red. Lowering the configured threshold lowers this floor too. */
const RED_PERCENT = 20;
const levelColor = (level: number, threshold: number): "amber" | "red" => level <= Math.min(RED_PERCENT, threshold) ? "red" : "amber";

/** An interruption-only Bluetooth battery strip: the lowest connected device, or hidden. */
async function batteryBar(): Promise<BarItem> {
  try {
    const threshold = settings.get<Settings>(EXTENSION).low_threshold;
    const low = batteries(await bluetooth.devices()).filter((d) => d.battery! <= threshold);
    if (!low.length) return { hidden: true };
    const first = low[0];
    const detail = low.map((d) => `${d.name} ${d.battery}%${d.battery_detail ? ` (${d.battery_detail})` : ""}`).join(" · ");
    return {
      icon: BATTERY,
      title: low.length === 1 ? truncate(`${first.name} ${first.battery}%`, 64) : `${low.length} low`,
      color: levelColor(first.battery!, threshold),
      tooltip: `Bluetooth battery · ${detail}`,
      click: "open",
      menu: BAR_MENU,
    };
  } catch { return { hidden: true }; }
}

async function openBluetoothSettings(): Promise<Effect> {
  if (MAC) return { open: MAC_SETTINGS_URL };
  const command = LINUX_SETTINGS.find(([bin]) => Bun.which(bin));
  if (!command) return toast("No Bluetooth settings app", "None of gnome-control-center, systemsettings or blueman-manager is installed", "failure");
  Bun.spawn(command, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
  return { hide: true };
}


export default {
  palettes: {
    bluetooth: {
      title: "Bluetooth",
      live: true,
      placeholder: "Connect or disconnect a device",
      list: async () => {
        try {
          return (await bluetooth.devices()).map(item);
        } catch (e) {
          return [hint("error", "Bluetooth is not available", errorMessage(e), { icon: xdg("dialog-error")! })];
        }
      },
      pick: async (id, action) => {
        if (id === "hint:error") return { keep: true };
        if (action === "copy") return { copy: id };
        // Read the state again rather than trust the row: the list may have been up a while.
        const d = (await bluetooth.devices().catch(() => [] as BluetoothDevice[])).find((d) => d.address === id);
        const name = d?.name ?? id;
        if (d?.connected) {
          try { await bluetooth.disconnect(id); } catch (e) { return failed(`disconnect ${name}`, e); }
          return { hud: `Disconnected ${name}` };
        }
        try { await bluetooth.connect(id); } catch (e) { return failed(`connect to ${name}`, e); }
        return { hud: `Connected to ${name}` };
      },
    },
  },
  bar: {
    battery: { render: batteryBar, onOpen: openBluetoothSettings },
  },
} satisfies Extension;
