// Paired Bluetooth devices over the core's bluetooth capability: one row
// per device with a glyph for its kind, a connected tag and the battery
// as an accessory. Enter toggles the connection (Disconnect asks first),
// ⌘C copies the address. Live: the connected state is read again on
// every show; the list is the OS's, connected first then by name.
import { bluetooth, xdg, type Accessory, type Action, type BluetoothDevice, type Effect, type Extension, type Item } from "@zcag/pal";

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

const failed = (what: string, e: unknown): Effect => ({ keep: true, toast: { title: `Could not ${what}`, message: String((e as Error)?.message ?? e), style: "failure" } });

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
          return [{ id: "error", name: "Bluetooth is not available", subtitle: String((e as Error)?.message ?? e), icon: xdg("dialog-error")!, actions: [] }];
        }
      },
      pick: async (id, action) => {
        if (id === "error") return { keep: true };
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
} satisfies Extension;
