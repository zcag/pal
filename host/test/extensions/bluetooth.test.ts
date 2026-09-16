// bluetooth against canned core/bluetooth.* replies.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { BluetoothDevice } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";
import { XDG_ICONS } from "../../../sdk/src/icons.ts";

let devices: BluetoothDevice[] = [
  { address: "14:28:76:8B:AE:C8", name: "AirPods Pro", connected: true, kind: "headphones", battery: 75, battery_detail: "L 80% · R 75% · Case 90%" },
  { address: "D4:83:5A:8E:D0:B9", name: "Pebble M350s", connected: true, kind: "mouse", battery: 55, battery_detail: null },
  { address: "E6:E6:EA:DB:E7:18", name: "Corne", connected: false, kind: "keyboard", battery: null, battery_detail: null },
  { address: "50:ED:3C:E5:7F:02", name: "link", connected: false, kind: "other", battery: null, battery_detail: null },
];
const calls: string[] = [];
let host: Host;
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "bluetooth.devices": () => devices,
      "bluetooth.connect": (p) => { if (p.address === "50:ED:3C:E5:7F:02") throw new Error("could not connect to 50:ED:3C:E5:7F:02 (IOReturn 0xe00002d8)"); calls.push(`connect ${p.address}`); devices = devices.map((d) => (d.address === p.address ? { ...d, connected: true } : d)); return null; },
      "bluetooth.disconnect": (p) => { calls.push(`disconnect ${p.address}`); devices = devices.map((d) => (d.address === p.address ? { ...d, connected: false } : d)); return null; },
    },
  });
});
afterAll(() => host.kill());

const list = () => host.list("bluetooth", "bluetooth");
const pick = (id: string, action?: string) => host.pick("bluetooth", "bluetooth", id, action);

describe("bluetooth", () => {
  test("meta: live", () => {
    expect(host.loaded().find((l) => l.extension === "bluetooth")!.palettes).toMatchObject([{ name: "bluetooth", title: "Bluetooth", live: true, input: false }]);
  });

  test("rows in the core's order with kind glyphs, battery and the connected tag", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(devices.map((d) => d.address));
    expect(items[0]).toEqual({
      id: "14:28:76:8B:AE:C8", name: "AirPods Pro", subtitle: "Headphones", icon: XDG_ICONS["audio-headphones"], keywords: ["14:28:76:8B:AE:C8", "headphones"],
      accessories: [{ text: "L 80% · R 75% · Case 90%" }, { tag: "connected", color: "green" }],
      actions: [{ id: "toggle", title: "Disconnect", confirm: "Disconnect AirPods Pro?" }, { id: "copy", title: "Copy Address", shortcut: "cmd+c" }],
    });
    expect(items[1].accessories).toEqual([{ text: "55%" }, { tag: "connected", color: "green" }]);
    expect(items[2]).toMatchObject({ icon: XDG_ICONS["input-keyboard"], accessories: [], actions: [{ id: "toggle", title: "Connect" }, { id: "copy", title: "Copy Address", shortcut: "cmd+c" }] });
    expect(items[3]).toMatchObject({ subtitle: "50:ED:3C:E5:7F:02", icon: XDG_ICONS["bluetooth"] });
  });

  test("Enter toggles on the state read back from the core, with a HUD line", async () => {
    expect(await pick("E6:E6:EA:DB:E7:18")).toEqual({ hud: "Connected to Corne" });
    expect(await pick("E6:E6:EA:DB:E7:18", "toggle")).toEqual({ hud: "Disconnected Corne" });
    expect(calls).toEqual(["connect E6:E6:EA:DB:E7:18", "disconnect E6:E6:EA:DB:E7:18"]);
  });

  test("copy address, and a refused connect is a failure toast", async () => {
    expect(await pick("14:28:76:8B:AE:C8", "copy")).toEqual({ copy: "14:28:76:8B:AE:C8" });
    expect(await pick("50:ED:3C:E5:7F:02")).toEqual({ keep: true, toast: { title: "Could not connect to link", message: "could not connect to 50:ED:3C:E5:7F:02 (IOReturn 0xe00002d8)", style: "failure" } });
  });

  test("no adapter: one inert row that says why", async () => {
    const h = await Host.bundled({ core: { "bluetooth.devices": () => { throw new Error("no Bluetooth adapter"); } } });
    try {
      expect(await h.list("bluetooth", "bluetooth")).toMatchObject([{ id: "error", name: "Bluetooth is not available", subtitle: "no Bluetooth adapter", actions: [] }]);
    } finally {
      h.kill();
    }
  });
});
