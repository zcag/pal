// mouse: the rows over the wire against an in-memory stand-in for the
// shell's `core/mouse.status` (app mouse.rs): one row per switch with its
// state, Enter writes the setting, the toggle link flips one and names it,
// the Accessibility row leads while the grant is missing and asks on
// Enter, and Linux's one honest row.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkIcon, checkLinks, checkPalettes } from "../../../sdk/src/index.ts";
import type { Accessory, Item } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";
import manifest from "../../../extensions/mouse/pal.json" with { type: "json" };
import ext, { hudLine, type Status } from "../../../extensions/mouse/index.ts";

const settings: Status["settings"] = { middle_click: false, middle_click_tap: true, reverse_trackpad: false, reverse_mouse: false, reverse_vertical: true, reverse_horizontal: true };
const base: Status = { available: true, accessibility: true, running: false, devices: 0, settings };

class Shell {
  st: Status = { ...base };
  calls: string[] = [];
  core = {
    "mouse.status": () => this.st,
    "permissions.request": (p: { which: string }) => { this.calls.push(`permission:${p.which}`); return { accessibility: false, calendar: "granted", input_monitoring: true, location: "granted" }; },
  };
}

describe("the manifest", () => {
  test("agrees with the code; every setting has a switch", () => {
    expect(checkPalettes(manifest as never, ext).warnings).toEqual([]);
    expect(checkLinks(manifest as never, ext)).toEqual([]);
    expect(checkIcon(manifest.icon, "mouse")).toBeUndefined();
    expect(manifest.settings.map((s) => s.id).sort()).toEqual(Object.keys(settings).sort());
    expect(Object.fromEntries(manifest.settings.map((s) => [s.id, s.default]))).toEqual(settings);
  });
  test("the HUD's line", () => {
    expect(hudLine("reverse_mouse", true)).toBe("Reverse mouse scrolling on");
    expect(hudLine("middle_click", false)).toBe("Three-finger middle click off");
  });
});

describe("over the wire", () => {
  let host: Host;
  const shell = new Shell();
  beforeAll(async () => { host = await Host.bundled({ core: shell.core }); });
  afterAll(() => host.kill());

  const rows = () => host.list("mouse", "mouse");
  const link = (route: string, params: Record<string, unknown>) => host.request<unknown>("link", { extension: "mouse", route, params });
  const byId = (rows: Item[], id: string) => rows.find((r) => r.id === id)!;
  const tag = (r: Item) => (r.accessories?.[0] as Extract<Accessory, { tag: string }> | undefined);

  test("a row per switch, its state as the tag; a switch with nothing to act on is muted", async () => {
    const r = await rows();
    expect(r.map((x) => x.id)).toEqual(["middle_click", "middle_click_tap", "reverse_trackpad", "reverse_mouse", "reverse_vertical", "reverse_horizontal"]);
    expect(tag(byId(r, "middle_click"))).toEqual({ tag: "off", color: "muted" });
    expect(tag(byId(r, "middle_click_tap"))).toEqual({ tag: "on", color: "muted" });
    expect(tag(byId(r, "reverse_vertical"))).toEqual({ tag: "on", color: "muted" });
    expect(byId(r, "middle_click").actions?.map((a) => a.title)).toEqual(["Turn on", "Open settings"]);
  });

  test("on, the rows say so; no trackpad read is noted", async () => {
    shell.st = { ...base, running: true, devices: 0, settings: { ...settings, middle_click: true, reverse_mouse: true } };
    const r = await rows();
    expect(tag(byId(r, "middle_click"))).toEqual({ tag: "on", color: "green" });
    expect(byId(r, "middle_click").subtitle).toMatch(/no trackpad is being read/);
    expect(tag(byId(r, "middle_click_tap"))?.color).toBe("green");
    expect(tag(byId(r, "reverse_vertical"))?.color).toBe("green");
    shell.st = { ...base };
  });

  test("Enter writes the setting; again puts it back; the settings action opens the pane", async () => {
    expect(await host.pick("mouse", "mouse", "reverse_mouse", "flip")).toEqual({ keep: true });
    expect(host.written.get("mouse")).toEqual({ reverse_mouse: true });
    expect(await host.pick("mouse", "mouse", "reverse_mouse")).toEqual({ keep: true });
    expect(host.written.get("mouse")).toEqual({});
    expect(await host.pick("mouse", "mouse", "middle_click", "settings")).toEqual({ open: "pal://settings/extensions?anchor=extensions:mouse" });
  });

  test("the toggle link flips the named switch; a bad one is refused", async () => {
    expect(await link("toggle", { setting: "middle_click" })).toEqual({ hud: "Three-finger middle click on" });
    expect(host.written.get("mouse")).toEqual({ middle_click: true });
    expect(await link("toggle", { setting: "middle_click" })).toEqual({ hud: "Three-finger middle click off" });
    await expect(link("toggle", { setting: "natural" })).rejects.toThrow(/unknown setting "natural"/);
  });

  test("without Accessibility a row leads and Enter asks", async () => {
    shell.st = { ...base, accessibility: false };
    const r = await rows();
    expect(r[0]).toMatchObject({ id: "hint:permission", name: "Mouse & Trackpad needs Accessibility" });
    expect(await host.pick("mouse", "mouse", "hint:permission", "grant")).toEqual({ keep: true });
    expect(shell.calls.at(-1)).toBe("permission:accessibility");
    shell.st = { ...base };
  });

  test("off macOS: one honest row", async () => {
    shell.st = { ...base, available: false, reason: "Not available on Linux: there is no portable input tap (Wayland hands input to the focused app only)" };
    const r = await rows();
    expect(r.map((x) => x.id)).toEqual(["hint:unavailable"]);
    expect(r[0].subtitle).toMatch(/Wayland/);
    shell.st = { ...base };
  });
});
