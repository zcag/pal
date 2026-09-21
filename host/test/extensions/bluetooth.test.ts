// bluetooth against canned core/bluetooth.* replies.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkView, type BluetoothDevice, type View, type ViewNode } from "../../../sdk/src/index.ts";
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
const nodes = (n: ViewNode): ViewNode[] => [n, ...("children" in n ? n.children.flatMap(nodes) : [])];
const texts = (v: View) => nodes(v.tree).flatMap((n) => (n.type === "text" ? [n.value] : []));
const keycaps = (v: View) => nodes(v.tree).flatMap((n) => (n.type === "keycap" ? [n.keys] : []));
const viewOf = (x: unknown): View => {
  const o = x as { view?: View; menu?: { view?: View } };
  const v = o.view ?? o.menu?.view;
  if (!v) throw new Error("no view");
  return checkView(v);
};

describe("bluetooth", () => {
  test("meta: live", () => {
    const loaded = host.loaded().find((l) => l.extension === "bluetooth")!;
    expect(loaded.palettes).toMatchObject([{ name: "bluetooth", title: "Bluetooth", live: true, input: false }]);
    expect(loaded.bar).toMatchObject([{ id: "battery", title: "Bluetooth Battery", refresh: { every: 60, on: ["wake"] }, keys: expect.any(Array), mocks: { clear: { item: { hidden: true, empty: { icon: "\u{f00af}", tooltip: "No connected devices" } } } }, source: true }]);
  });

  test("bar: only connected low batteries interrupt; the popover shows low first, then the rest, with keys and actions", async () => {
    const original = devices;
    try {
      expect(await host.render("bluetooth", "battery")).toMatchObject({ icon: "\u{f00b1}", empty: { icon: "\u{f00b1}" }, states: { low: 0, lowest: 55, connected: 2 } });
      host.changeSettings("bluetooth", { settings: { low_threshold: 100 } });
      devices = devices.map((d) => d.name === "Corne" ? { ...d, connected: true } : d);
      const item = await host.render("bluetooth", "battery");
      expect(item).toMatchObject({ icon: "\u{f0083}", title: "2 low", states: { low: 2, lowest: 55 }, tooltip: "Bluetooth battery · Pebble M350s 55% · AirPods Pro 75% (L 80% · R 75% · Case 90%)", click: "open" });
      const v = viewOf(item);
      expect(v).toMatchObject({ id: "battery", title: "2 low Bluetooth batteries", keys: "actions" });
      const all = nodes(v.tree);
      expect(texts(v).filter((t) => ["Low battery", "Connected, no battery reading", "Pebble M350s", "AirPods Pro", "Corne", "L 80% · R 75% · Case 90%"].includes(t))).toEqual(["Low battery", "Pebble M350s", "AirPods Pro", "L 80% · R 75% · Case 90%", "Connected, no battery reading", "Corne"]);
      const rows = all.filter((n): n is Extract<ViewNode, { type: "stack" }> => n.type === "stack" && !!n.action?.startsWith("focus:"));
      expect(rows.map((r) => r.action)).toEqual(["focus:D4:83:5A:8E:D0:B9", "focus:14:28:76:8B:AE:C8", "focus:E6:E6:EA:DB:E7:18"]);
      expect(rows.map((r) => !!r.selected)).toEqual([true, false, false]);
      expect(all.filter((n): n is Extract<ViewNode, { type: "progress" }> => n.type === "progress").map((p) => [p.value, p.color])).toEqual([[0.55, "amber"], [0.75, "amber"]]);
      expect(keycaps(v)).toEqual(["enter", "c", "s", "r", "up", "down"]);
      expect(v.actions!.filter((a) => !a.hidden).map((a) => [a.id, a.shortcut, a.confirm])).toEqual([["disconnect", "enter", "Disconnect Pebble M350s?"], ["copy", "c", undefined], ["settings", "s", undefined], ["refresh", "r", undefined]]);
      expect(v.actions!.filter((a) => a.id.startsWith("focus:")).map((a) => a.id)).toEqual(["focus:D4:83:5A:8E:D0:B9", "focus:14:28:76:8B:AE:C8", "focus:E6:E6:EA:DB:E7:18"]);
      expect(viewOf(await host.barAction("bluetooth", "battery", "focus:14:28:76:8B:AE:C8"))).toMatchObject({ id: "battery" });
      const before = calls.length;
      expect(await host.barAction("bluetooth", "battery", "disconnect")).toMatchObject({ keep: true, hud: "Disconnected AirPods Pro", view: { id: "battery" } });
      expect(calls.slice(before)).toEqual(["disconnect 14:28:76:8B:AE:C8"]);
      host.changeSettings("bluetooth", { settings: { low_threshold: 60 } });
      expect(await host.render("bluetooth", "battery")).toMatchObject({ title: "Pebble M350s 55%", states: { low: 1 }, tooltip: "Bluetooth battery · Pebble M350s 55%" });
      devices = original.map((d) => d.address === "14:28:76:8B:AE:C8" ? { ...d, battery: 12, battery_detail: "L 16% · R 12% · Case 90%" } : d);
      const critical = await host.render("bluetooth", "battery");
      expect(critical).toMatchObject({ title: "2 low", states: { low: 2, lowest: 12 }, tooltip: "Bluetooth battery · AirPods Pro 12% (L 16% · R 12% · Case 90%) · Pebble M350s 55%" });
      expect(nodes(viewOf(critical).tree).filter((n): n is Extract<ViewNode, { type: "progress" }> => n.type === "progress").map((p) => [p.value, p.color])).toEqual([[0.12, "red"], [0.55, "amber"]]);
      devices = devices.map((d) => ({ ...d, connected: false }));
      expect(await host.render("bluetooth", "battery")).toMatchObject({ icon: "\u{f00af}", states: { connected: 0, low: 0, lowest: null }, empty: { icon: "\u{f00af}" } });
    } finally {
      devices = original;
      calls.length = 0;
      host.changeSettings("bluetooth", { settings: { low_threshold: 25 } });
    }
  });

  test("bar: the low count and the lowest level are the facts; amber and red are the manifest's rules over them", async () => {
    const original = devices;
    try {
      const at = async (battery: number) => {
        devices = [{ address: "14:28:76:8B:AE:C8", name: "AirPods Pro", connected: true, kind: "headphones", battery, battery_detail: null }];
        return (await host.render("bluetooth", "battery")) as any;
      };
      expect(await at(26)).toMatchObject({ states: { low: 0, lowest: 26, connected: 1 }, empty: { tooltip: "Bluetooth · AirPods Pro 26%" } });
      expect(await at(25)).toMatchObject({ title: "AirPods Pro 25%", states: { low: 1, lowest: 25 } });
      expect(await at(20)).toMatchObject({ title: "AirPods Pro 20%", states: { low: 1, lowest: 20 } });
      expect((await at(20)).color).toBeUndefined();
      const rules = host.loaded().find((l) => l.extension === "bluetooth")!.bar[0].rules!;
      expect(rules.map((r) => [r.id, r.when])).toEqual([["none", "bluetooth.connected == 0"], ["fine", "bluetooth.low == 0"], ["low", "bluetooth.low > 0"], ["critical", "bluetooth.low > 0 and bluetooth.lowest <= 20"]]);
    } finally {
      devices = original;
    }
  });

  test("nothing low: the glyph naming what is connected with click and the popover, the same as its empty shape (the manifest's fine rule hides it); nothing connected the same with the plain glyph", async () => {
    const original = devices;
    try {
      const quiet = await host.render("bluetooth", "battery");
      expect(quiet).toMatchObject({ icon: "\u{f00b1}", tooltip: "Bluetooth · AirPods Pro 75% · Pebble M350s 55%", click: "open", empty: { icon: "\u{f00b1}", tooltip: "Bluetooth · AirPods Pro 75% · Pebble M350s 55%" }, states: { low: 0, connected: 2 } });
      expect(quiet.title).toBeUndefined();
      expect(quiet.color).toBeUndefined();
      expect(viewOf(quiet)).toMatchObject({ id: "battery", title: "Bluetooth batteries" });
      expect(texts(viewOf(quiet))).toContain("AirPods Pro");
      devices = devices.map((d) => ({ ...d, connected: false }));
      const none = await host.render("bluetooth", "battery");
      expect(none).toMatchObject({ icon: "\u{f00af}", tooltip: "No connected devices", states: { connected: 0 }, empty: { icon: "\u{f00af}", tooltip: "No connected devices" } });
      expect(texts(viewOf(none.empty!))).toContain("No connected devices");
      devices = original.map((d) => d.name === "Pebble M350s" ? { ...d, battery: 12 } : d);
      expect(await host.render("bluetooth", "battery")).toMatchObject({ icon: "\u{f0083}", title: "Pebble M350s 12%", states: { low: 1, lowest: 12 } });
    } finally {
      devices = original;
    }
  });

  test("rows in the core's order with kind glyphs, battery and the connected tag", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(devices.map((d) => d.address));
    expect(items[0]).toEqual({
      id: "14:28:76:8B:AE:C8", name: "AirPods Pro", subtitle: "Headphones", icon: XDG_ICONS["audio-headphones"], keywords: ["14:28:76:8B:AE:C8", "headphones"],
      accessories: [{ text: "L 80% · R 75% · Case 90%" }, { tag: "connected", color: "green" }],
      actions: [{ id: "toggle", title: "Disconnect", confirm: "Disconnect AirPods Pro?" }, { id: "copy", title: "Copy address", shortcut: "cmd+c" }],
    });
    expect(items[1].accessories).toEqual([{ text: "55%" }, { tag: "connected", color: "green" }]);
    expect(items[2]).toMatchObject({ icon: XDG_ICONS["input-keyboard"], accessories: [], actions: [{ id: "toggle", title: "Connect" }, { id: "copy", title: "Copy address", shortcut: "cmd+c" }] });
    expect(items[3]).toMatchObject({ subtitle: "50:ED:3C:E5:7F:02", icon: XDG_ICONS["bluetooth"] });
  });

  test("Enter toggles on the state read back from the core, with a HUD line", async () => {
    calls.length = 0;
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
      expect(await h.list("bluetooth", "bluetooth")).toMatchObject([{ id: "hint:error", name: "Bluetooth is not available", subtitle: "no Bluetooth adapter", actions: [] }]);
    } finally {
      h.kill();
    }
  });
});
