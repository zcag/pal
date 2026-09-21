// Paired Bluetooth devices over the core's bluetooth capability: one row
// per device with a glyph for its kind, a connected tag and the battery
// as an accessory. Enter toggles the connection (Disconnect asks first),
// ⌘C copies the address. Live: the connected state is read again on
// every show; the list is the OS's, connected first then by name.
import { bluetooth, errorMessage, failed, hint, settings, toast, truncate, xdg, type Accessory, type Action, type BarItem, type BluetoothDevice, type Effect, type Extension, type Item } from "@zcag/pal";
import { GLYPH, KIND, batteries, levelColor, render as renderBattery, rows as batteryRows, type BarState } from "./view.ts";

/** `bar_show`: `low` is the alert alone; `connected` keeps the strip up while a device is connected as a muted Bluetooth glyph, still a way into the popover. */
type Settings = { low_threshold: number; bar_show?: "low" | "connected" };
const EXTENSION = "bluetooth";
const MAC = process.platform === "darwin";
const MAC_SETTINGS_URL = "x-apple.systempreferences:com.apple.BluetoothSettings";
const LINUX_SETTINGS: string[][] = [["gnome-control-center", "bluetooth"], ["systemsettings", "kcm_bluetooth"], ["blueman-manager"]];
const BATTERY = "\u{f0083}"; // md-battery-alert
let barFocus: string | undefined;

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

function barState(devices: BluetoothDevice[], threshold: number): BarState {
  const st = { devices, threshold, focus: 0 };
  const rows = batteryRows(st);
  st.focus = Math.max(0, rows.findIndex((d) => d.address === barFocus));
  barFocus = rows[st.focus]?.address;
  return st;
}

/** An interruption-only Bluetooth battery strip: the lowest connected device, or hidden (or, by `bar_show`, a muted glyph naming what is connected); the same glyph is the `empty` shape a `show = "always"` config keeps between alerts. */
async function batteryBar(): Promise<BarItem> {
  try {
    const { low_threshold: threshold, bar_show: show } = settings.get<Settings>(EXTENSION);
    const devices = await bluetooth.devices();
    const low = batteries(devices).filter((d) => d.battery! <= threshold);
    if (!low.length) {
      const connected = devices.filter((d) => d.connected);
      const detail = connected.map((d) => `${d.name}${d.battery === null ? "" : ` ${d.battery}%`}`).join(" · ");
      const icon = xdg(connected.length ? "bluetooth-connected" : "bluetooth")!;
      const tooltip = connected.length ? `Bluetooth · ${detail}` : "No connected devices";
      const menu = { view: renderBattery(barState(devices, threshold)) };
      if (show === "connected" && connected.length) return { icon, color: "muted", tooltip, click: "open", menu };
      return { hidden: true, empty: { icon, tooltip, menu } };
    }
    const first = low[0];
    const detail = low.map((d) => `${d.name} ${d.battery}%${d.battery_detail ? ` (${d.battery_detail})` : ""}`).join(" · ");
    return {
      icon: BATTERY,
      title: low.length === 1 ? truncate(`${first.name} ${first.battery}%`, 64) : `${low.length} low`,
      color: levelColor(first.battery!, threshold),
      tooltip: `Bluetooth battery · ${detail}`,
      click: "open",
      menu: { view: renderBattery(barState(devices, threshold)) },
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

const redraw = async (): Promise<Effect> => {
  const threshold = settings.get<Settings>(EXTENSION).low_threshold;
  return { view: renderBattery(barState(await bluetooth.devices(), threshold)) };
};

async function batteryAction(action: string): Promise<Effect> {
  if (action === "settings") return openBluetoothSettings();
  if (action === "refresh") return { keep: true, ...(await redraw()) };
  const threshold = settings.get<Settings>(EXTENSION).low_threshold;
  const devices = await bluetooth.devices().catch(() => [] as BluetoothDevice[]);
  const st = barState(devices, threshold);
  const rows = batteryRows(st);
  const cur = rows[st.focus];
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return { view: renderBattery(barState(devices, threshold)) }; }
  if (action === "down" || action === "up") {
    if (!rows.length) return { keep: true };
    barFocus = rows[(st.focus + (action === "down" ? 1 : rows.length - 1)) % rows.length].address;
    return { view: renderBattery(barState(devices, threshold)) };
  }
  if (!cur) return { keep: true };
  if (action === "copy") return { copy: cur.address };
  if (action === "disconnect") {
    try { await bluetooth.disconnect(cur.address); } catch (e) { return failed(`disconnect ${cur.name}`, e); }
    return { keep: true, hud: `Disconnected ${cur.name}`, ...(await redraw()) };
  }
  return { keep: true };
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
    battery: { render: batteryBar, onOpen: openBluetoothSettings, onAction: batteryAction },
  },
} satisfies Extension;
