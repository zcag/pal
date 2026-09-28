// Writes app/src/gallery/shots/bluetooth.json and bar-bluetooth.json, the
// store screenshots' fixtures: the palette's rows and the battery item
// drawn through the host harness against canned `core/bluetooth.*`
// replies (made-up devices: AirPods nearly flat, a mouse low, a keyboard
// fine, a speaker with no reading, and a few paired but away), at the
// item's default 25% threshold.
// `bun run extensions/bluetooth/fixture.ts`, then `make shots EXT=bluetooth`.
import type { BarItem, BluetoothDevice } from "@zcag/pal";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host } from "../../host/test/harness.ts";

pinClock();
const dev = (address: string, name: string, kind: string, connected: boolean, battery: number | null = null, battery_detail: string | null = null): BluetoothDevice => ({ address, name, kind, connected, battery, battery_detail });
/** As the OS lists them: connected first, then by name. */
const ALL: BluetoothDevice[] = [
  dev("F4:5C:89:AB:12:01", "AirPods Pro", "headphones", true, 12, "L 16% · R 12% · Case 64%"),
  dev("B8:27:EB:4D:21:90", "Desk Speaker", "speaker", true),
  dev("DC:2B:2A:0C:44:7E", "Magic Keyboard", "keyboard", true, 62),
  dev("DC:2B:2A:0C:51:13", "Magic Mouse", "mouse", true, 22),
  dev("98:B8:BC:70:1D:E4", "Game Controller", "gamepad", false),
  dev("B8:27:EB:11:22:33", "Kitchen Speaker", "speaker", false),
  dev("3C:22:FB:9E:80:0A", "Travel Headphones", "headphones", false),
];
/** The AirPods charged: only the mouse is low. */
const MOUSE = ALL.map((d) => (d.name === "AirPods Pro" ? { ...d, battery: 88, battery_detail: "L 90% · R 88% · Case 71%" } : d));

let devices = ALL;
const host = await Host.bundled({ core: { "bluetooth.devices": () => devices } });
try {
  /** The item as the strip gets it: the manifest's rules tint it (`low` amber, `critical` red at 20% or under), which the core applies. */
  const face = async (color: string) => {
    const { states: _s, empty: _e, ...item } = await host.render("bluetooth", "battery");
    return { ...item, color } as BarItem;
  };
  const item = await face("red");
  devices = MOUSE;
  const one = await face("amber");
  devices = ALL;
  writeFixture("bar-bluetooth", {
    key: "bluetooth/battery",
    title: "Bluetooth Battery",
    item,
    states: [{ id: "one", item: one }],
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar only while a device runs low: the count, red once one is at 20% or under" },
      "menubar-one": { target: "menubar", state: "one", caption: "One device low: its name and level, amber until it reaches 20%" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the low batteries first, then the rest of the connected ones, Enter disconnects, c copies the address" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the battery alert and the low count on red" },
    },
  });

  const p = host.loaded().find((l) => l.extension === "bluetooth")!.palettes[0];
  const rows = await host.list("bluetooth", "bluetooth");
  const away = rows.findIndex((r) => r.id === "B8:27:EB:11:22:33");
  writeFixture("bluetooth", {
    palettes: { bluetooth: { title: p.title, live: p.live, icon: p.icon, placeholder: p.placeholder, items: rows } },
    shots: {
      "1-devices": { palette: "bluetooth", keys: [], caption: "Paired devices, the connected ones first with their battery, the AirPods bud by bud" },
      "2-actions": { palette: "bluetooth", keys: [`down*${away}`, "cmd+k"], caption: "A device that is away: connect it, or copy its address" },
      "3-disconnect": { palette: "bluetooth", keys: ["enter"], caption: "Enter on a connected device disconnects it, after asking" },
    },
  });
  console.log("bluetooth.json, bar-bluetooth.json: AirPods at 12% and a mouse at 22%, then only the mouse low");
} finally {
  host.kill();
}
