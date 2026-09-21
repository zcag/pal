// keycast: the popover as a pure render (the tiles, the ring on the mode
// that is on, Enter as Stop or Start), then the palette, the links and the
// bar item over the wire against an in-memory stand-in for the shell's
// `core/keycast.*` (app keycast.rs): Start / Stop flip, the mode rows
// start and switch, shortcuts-only writes the setting, the permission
// row leads while the grant is missing and asks on Enter, the item hides
// while off, and Linux's one honest row.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hudLine, render, type Status } from "../../../extensions/keycast/index.ts";
import { checkIcon, checkLinks, checkPalettes, checkView } from "../../../sdk/src/index.ts";
import type { Accessory, Item, ViewNode } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";
import manifest from "../../../extensions/keycast/pal.json" with { type: "json" };
import ext from "../../../extensions/keycast/index.ts";

const settings: Status["settings"] = { mode: "both", position: "bottom-center", scale: 1, hold: 2, max: 5, shortcuts_only: false, ring: true, ring_color: "blue", ripples: true };
const off: Status = { available: true, active: false, mode: "both", input_monitoring: true, settings };
const on = (mode: Status["mode"]): Status => ({ ...off, active: true, mode });

const flat = (n: ViewNode): ViewNode[] => [n, ...("children" in n && n.children ? n.children.flatMap(flat) : [])];
const tiles = (st: Status) => flat(render(st).tree).filter((n) => n.type === "tile") as Extract<ViewNode, { type: "tile" }>[];

describe("the popover", () => {
  test("three tiles, the one that is on solid and ringed; the view passes the host's check", () => {
    const t = tiles(on("cursor"));
    expect(t.map((x) => x.text)).toEqual(["Keys", "Cursor", "Both"]);
    expect(t.map((x) => x.fill)).toEqual(["soft", "solid", "soft"]);
    expect(t.map((x) => !!x.selected)).toEqual([false, true, false]);
    expect(t.map((x) => x.action)).toEqual(["mode:keys", "mode:cursor", "mode:both"]);
    expect(tiles(off).every((x) => !x.selected && x.fill === "soft")).toBe(true);
    expect(() => checkView(render(on("both")), "keycast")).not.toThrow();
  });
  test("Enter is Stop while on and Start while off; the keys k c b s o", () => {
    const a = render(on("keys")).actions;
    expect(a[0]).toMatchObject({ id: "toggle", title: "Stop keycast", shortcut: "backspace", style: "destructive" });
    expect(a.map((x) => x.shortcut)).toEqual(["backspace", "k", "c", "b", "s", "o"]);
    expect(a[1].title).toBe("Keys only (on)");
    expect(render(off).actions[0]).toMatchObject({ id: "toggle", title: "Start keycast" });
    expect(render(on("both")).title).toBe("Keycast: keys and cursor");
  });
  test("the status line says what shows, or what is missing", () => {
    const texts = (st: Status) => flat(render(st).tree).filter((n) => n.type === "text").map((n) => (n as { value: string }).value);
    expect(texts(on("both"))).toContain("Showing keys and cursor · strip at the bottom centre · hold 2 s");
    expect(texts({ ...off, input_monitoring: false })[0]).toMatch(/Needs Input Monitoring/);
    expect(texts({ ...off, available: false, reason: "no tap" })).toEqual(["no tap"]);
    expect(tiles({ ...off, available: false })).toEqual([]);
  });
  test("the HUD's line", () => {
    expect(hudLine(on("keys"))).toBe("Keycast on: keys");
    expect(hudLine(off)).toBe("Keycast off");
  });
  test("the manifest and the code agree", () => {
    expect(checkPalettes(manifest as never, ext).warnings).toEqual([]);
    expect(checkLinks(manifest as never, ext)).toEqual([]);
    expect(checkIcon(manifest.icon, "keycast")).toBeUndefined();
  });
});

/** The shell's side, in memory: `start` switches the mode in place, `toggle` follows the link's rule. */
class Shell {
  st: Status = { ...off };
  calls: string[] = [];
  core = {
    "keycast.status": () => this.st,
    "keycast.start": (p: { mode?: Status["mode"] }) => { this.calls.push(`start:${p.mode ?? ""}`); this.st = { ...this.st, active: true, mode: p.mode ?? this.st.settings.mode }; return this.st; },
    "keycast.stop": () => { this.calls.push("stop"); this.st = { ...this.st, active: false }; return this.st; },
    "keycast.toggle": (p: { mode?: Status["mode"] }) => {
      const st = !this.st.active || (p.mode && p.mode !== this.st.mode) ? this.core["keycast.start"](p) : this.core["keycast.stop"]();
      this.calls.push(`toggle:${p.mode ?? ""}`);
      return st;
    },
    "permissions.request": (p: { which: string }) => { this.calls.push(`permission:${p.which}`); return { accessibility: true, calendar: "granted", input_monitoring: false, location: "granted" }; },
  };
}

describe("over the wire", () => {
  let host: Host;
  const shell = new Shell();
  beforeAll(async () => { host = await Host.bundled({ core: shell.core }); });
  afterAll(() => host.kill());

  const rows = () => host.list("keycast", "keycast");
  const now = () => host.request<{ extension: string; items: Item[] }[]>("suggest").then((r) => r.find((s) => s.extension === "keycast")?.items ?? []);
  const link = (route: string, params: Record<string, unknown>) => host.request<unknown>("link", { extension: "keycast", route, params });
  const byId = (rows: Item[], id: string) => rows.find((r) => r.id === id)!;
  const tag = (r: Item) => (r.accessories?.[0] as Extract<Accessory, { tag: string }> | undefined)?.tag;

  test("off: Start leads, the modes follow with the default marked, shortcuts-only last", async () => {
    const r = await rows();
    expect(r.map((x) => x.id)).toEqual(["toggle", "mode:keys", "mode:cursor", "mode:both", "shortcuts"]);
    expect(byId(r, "toggle")).toMatchObject({ name: "Start keycast", subtitle: "Keys and cursor, strip at the bottom centre" });
    expect(byId(r, "toggle").actions?.map((a) => a.id)).toEqual(["start", "shortcuts", "settings"]);
    expect(tag(byId(r, "mode:both"))).toBe("default");
    expect(tag(byId(r, "mode:keys"))).toBeUndefined();
    expect(byId(r, "shortcuts")).toMatchObject({ name: "Shortcuts only: off" });
  });

  test("Enter on Start toggles on in the default mode; the rows flip; the Now section offers Stop", async () => {
    expect(await host.pick("keycast", "keycast", "toggle", "start")).toEqual({ hud: "Keycast on: keys and cursor" });
    expect(shell.calls.at(-1)).toBe("toggle:");
    const r = await rows();
    expect(byId(r, "toggle")).toMatchObject({ name: "Stop keycast", subtitle: "Showing keys and cursor · strip at the bottom centre" });
    expect(tag(byId(r, "toggle"))).toBe("on");
    expect(tag(byId(r, "mode:both"))).toBe("current");
    expect(byId(r, "mode:both").actions?.[0]).toMatchObject({ id: "stop", title: "Stop" });
    expect(byId(r, "mode:keys").actions?.map((a) => a.id)).toEqual(["start", "stop", "shortcuts", "settings"]);
    expect((await now()).map((x) => x.name)).toEqual(["Stop keycast"]);
  });

  test("a mode row switches in place; Stop from a mode row stops", async () => {
    expect(await host.pick("keycast", "keycast", "mode:keys", "start")).toEqual({ hud: "Keycast on: keys" });
    expect(shell.calls.at(-1)).toBe("start:keys");
    expect(await host.pick("keycast", "keycast", "mode:cursor", "stop")).toEqual({ hud: "Keycast off" });
    expect(shell.st.active).toBe(false);
    expect(await now()).toEqual([]);
  });

  test("shortcuts-only writes the setting (the shell's status reads the file back); the settings action opens the pane", async () => {
    expect(await host.pick("keycast", "keycast", "shortcuts")).toEqual({ keep: true });
    expect(host.written.get("keycast")).toEqual({ shortcuts_only: true });
    expect(await host.pick("keycast", "keycast", "mode:keys", "shortcuts")).toEqual({ keep: true });
    expect(host.written.get("keycast")).toEqual({});
    expect(await host.pick("keycast", "keycast", "toggle", "settings")).toEqual({ open: "pal://settings/extensions?anchor=extensions:keycast" });
  });

  test("the links: toggle with a mode, start, stop; a bad mode is refused", async () => {
    expect(await link("toggle", { mode: "cursor" })).toEqual({ hud: "Keycast on: cursor" });
    expect(await link("toggle", { mode: "keys" })).toEqual({ hud: "Keycast on: keys" });
    expect(await link("toggle", {})).toEqual({ hud: "Keycast off" });
    expect(await link("start", {})).toEqual({ hud: "Keycast on: keys and cursor" });
    expect(await link("stop", {})).toEqual({ hud: "Keycast off" });
    await expect(link("start", { mode: "ring" })).rejects.toThrow(/unknown mode "ring"/);
  });

  test("the bar item: hidden with the popover kept while off; the dot and the mode while on; its keys", async () => {
    let item = await host.render("keycast", "active");
    expect(item.hidden).toBe(true);
    expect(item.empty?.tooltip).toBe("Keycast is off");
    expect(item.empty?.menu && "view" in item.empty.menu).toBe(true);
    expect(await host.barAction("keycast", "active", "mode:both")).toEqual({ keep: true });
    item = await host.render("keycast", "active");
    expect(item).toMatchObject({ icon: "\u{f044a}", title: "keys + cursor", tooltip: "Keycast: keys and cursor" });
    expect(item.hidden).toBeUndefined();
    expect(await host.barAction("keycast", "active", "mode:keys")).toEqual({ keep: true });
    expect(shell.st.mode).toBe("keys");
    expect(await host.barAction("keycast", "active", "open")).toEqual({ push: { extension: "keycast", palette: "keycast" } });
    expect(await host.barAction("keycast", "active", "toggle")).toEqual({ hud: "Keycast off" });
    expect((await host.render("keycast", "active")).hidden).toBe(true);
  });

  test("without Input Monitoring a row leads and Enter asks", async () => {
    shell.st = { ...shell.st, input_monitoring: false };
    const r = await rows();
    expect(r[0]).toMatchObject({ id: "hint:permission", name: "Keycast needs Input Monitoring" });
    expect(r[0].actions?.[0].title).toBe("Grant Input Monitoring");
    expect(await host.pick("keycast", "keycast", "hint:permission", "grant")).toEqual({ keep: true });
    expect(shell.calls.at(-1)).toBe("permission:input_monitoring");
    shell.st = { ...shell.st, input_monitoring: true };
  });

  test("off macOS: one honest row and nothing else", async () => {
    shell.st = { ...shell.st, available: false, reason: "Keycast is not available on Linux: there is no portable input tap (Wayland hands input to the focused app only)" };
    const r = await rows();
    expect(r.map((x) => x.id)).toEqual(["hint:unavailable"]);
    expect(r[0].subtitle).toMatch(/Wayland/);
    expect(await host.pick("keycast", "keycast", "hint:unavailable")).toEqual({ keep: true });
    const item = await host.render("keycast", "active");
    expect(item.hidden).toBe(true);
    expect(item.empty?.tooltip).toMatch(/not available on Linux/);
    shell.st = { ...shell.st, available: true, reason: undefined };
  });
});
