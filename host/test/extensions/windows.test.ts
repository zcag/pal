// windows against canned core/windows.* replies: the harness fixtures plus
// a second kitty window, so the per-app actions have a set to act on, and
// a hidden app's window; three spaces for the Spaces palette, the middle
// one in front and the first the one left last.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import type { Window, Workspace } from "../../../sdk/src/index.ts";
import { Host, fixtures } from "../harness.ts";

const MAC = process.platform === "darwin";
const WINDOWS: Window[] = [
  ...fixtures.windows,
  { id: "w4", app: "kitty", title: "~/notes", bundle_or_class: "net.kovidgoyal.kitty", pid: 11, minimized: true, hidden: false, on_screen: false, monitor: null, workspace: null, icon: "/Applications/kitty.app" },
  { id: "w5", app: "Slack", title: "pal", bundle_or_class: "com.tinyspeck.slackmacgap", pid: 55, minimized: false, hidden: true, on_screen: false, monitor: null, workspace: null, icon: null },
];

const SPACES: Workspace[] = [
  { id: "6", index: 1, name: null, current: false, previous: true, fullscreen: false, monitor: null, windows: ["w2"] },
  { id: "5", index: 2, name: null, current: true, previous: false, fullscreen: false, monitor: null, windows: ["w4", "w1"] },
  { id: "1", index: 3, name: null, current: false, previous: false, fullscreen: false, monitor: null, windows: [] },
];

let host: Host;
const closed: unknown[] = [];
const minimized: unknown[] = [];
const activated: unknown[] = [];
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "windows.list": () => WINDOWS,
      "windows.spaces": () => SPACES,
      "windows.close": (p) => { if (p.id === "w3") throw new Error("Finder refused"); closed.push(p); return null; },
      "windows.minimize": (p) => { minimized.push(p); return null; },
      "windows.activate": (p) => { activated.push(p); return "Slack"; },
    },
  });
});
afterAll(() => host.kill());

const list = () => host.list("windows", "windows");
const pick = (id: string, action?: string) => host.pick("windows", "windows", id, action);
const perApp = MAC ? ["hide-app", "minimize-all", "close-all"] : ["minimize-all", "close-all"];

describe("windows", () => {
  test("meta: live, not input, so titles are root results; Spaces the same one level up", () => {
    const keywords = ["window", "switcher", "space", "desktop", "workspace"];
    expect(host.loaded().find((l) => l.extension === "windows")!.palettes).toEqual([
      { name: "windows", title: "Windows", live: true, input: false, icon: tile("slate", "\u{f10ac}"), placeholder: "Switch to a window", tier: "primary", multi: true, hold: "alt+tab", keywords },
      { name: "spaces", title: "Spaces", live: true, input: false, icon: tile("slate", "\u{f10ac}"), placeholder: "Switch to a space", keywords },
    ]);
  });

  test("rows in the core's order: title, app as subtitle, section and keyword, app icon or a glyph, state accessories", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["w1", "w2", "w3", "w4", "w5"]);
    expect(items[0]).toEqual({
      id: "w1", name: "~/proj/pal", subtitle: "kitty", keywords: ["net.kovidgoyal.kitty", "kitty"], icon: { app: "/Applications/kitty.app" }, accessories: [], section: "kitty",
      actions: [
        { id: "focus", title: "Focus" }, { id: "close", title: "Close", shortcut: "cmd+w", style: "destructive", multi: true }, { id: "minimize", title: "Minimize", shortcut: "cmd+m", multi: true },
        ...(MAC ? [{ id: "hide-app", title: "Hide app", shortcut: "cmd+h" }] : []),
        { id: "minimize-all", title: "Minimize all of this app", shortcut: "cmd+shift+m" },
        { id: "close-all", title: "Close all of this app", shortcut: "cmd+shift+w", style: "destructive", confirm: "Close every window of this app?" },
      ],
    });
    expect(items[1]).toMatchObject({ icon: "\u{f05af}", section: "Google Chrome", accessories: [{ tag: "minimized" }, { text: "Display 2" }] });
    // A minimised window has no Minimize; an app with one window has no per-app actions.
    expect(items[1].actions!.map((a) => a.id)).toEqual(["focus", "close", ...(MAC ? ["hide-app"] : [])]);
    expect(items[2].accessories).toEqual([{ text: "ws 3" }]);
    expect(items[3].actions!.map((a) => a.id)).toEqual(["focus", "close", ...perApp]);
    // A hidden app's window is `hidden`, not `other space`; Show app replaces Hide app on it.
    expect(items[4].accessories).toEqual([{ tag: "hidden" }]);
    expect(items[4].actions!.map((a) => a.id)).toEqual(["focus", "close", "minimize", ...(MAC ? ["show-app"] : [])]);
    if (MAC) expect(items[4].actions!.find((a) => a.id === "show-app")).toEqual({ id: "show-app", title: "Show app", shortcut: "cmd+shift+h" });
  });

  test.if(MAC)("show app activates the window's app through the core and lets the panel hide", async () => {
    expect(await pick("w5", "show-app")).toEqual({});
    expect(activated).toEqual([{ id: "w5" }]);
  });

  test("pick focuses by default; close and minimize go to the core and keep the palette", async () => {
    expect(await pick("w1")).toEqual({ focus: "w1" });
    expect(await pick("w1", "focus")).toEqual({ focus: "w1" });
    expect(await pick("w1", "close")).toEqual({ keep: true });
    expect(closed).toEqual([{ id: "w1" }]);
    expect(await pick("w1", "minimize")).toEqual({ keep: true });
    expect(minimized).toEqual([{ id: "w1" }]);
  });

  test("close all and minimize all act on every window of the row's app (minimize skips the minimised ones)", async () => {
    closed.length = 0; minimized.length = 0;
    expect(await pick("w4", "close-all")).toEqual({ keep: true });
    expect(closed).toEqual([{ id: "w1" }, { id: "w4" }]);
    expect(await pick("w1", "minimize-all")).toEqual({ keep: true });
    expect(minimized).toEqual([{ id: "w1" }]);
    expect(await pick("gone", "close-all")).toEqual({ keep: true });
  });

  test("pick with marked rows (ctx.ids): close and minimize go through each id; focus stays one window", async () => {
    closed.length = 0; minimized.length = 0;
    expect(await host.pick("windows", "windows", "w1", "close", { ids: ["w1", "w4"] })).toEqual({ keep: true });
    expect(closed).toEqual([{ id: "w1" }, { id: "w4" }]);
    expect(await host.pick("windows", "windows", "w4", "minimize", { ids: ["w4", "w1"] })).toEqual({ keep: true });
    expect(minimized).toEqual([{ id: "w4" }, { id: "w1" }]);
    expect(await host.pick("windows", "windows", "w1", "close", { ids: ["w1", "w3"] })).toEqual({ keep: true, toast: { title: "Could not close every marked window", message: "Finder refused", style: "failure" } });
    expect(host.loaded().find((l) => l.extension === "windows")!.palettes[0].actions).toBeUndefined();
    expect((await list())[0].actions!.find((a) => a.id === "focus")!.multi).toBeUndefined();
  });

  test("a core failure becomes a failure toast, palette kept", async () => {
    expect(await pick("w3", "close")).toEqual({ keep: true, toast: { title: "Could not close the window", message: "Finder refused", style: "failure" } });
    expect(await pick("w3", "close-all")).toEqual({ keep: true, toast: { title: "Could not close every window of Finder", message: "Finder refused", style: "failure" } });
  });

  describe("spaces", () => {
    const spaces = () => host.list("windows", "spaces");
    const go = (id: string) => host.pick("windows", "spaces", id);

    test("a row per space in the desktop's order: numbered, the apps on it, the last used window's icon, tags; Previous space last", async () => {
      const rows = await spaces();
      expect(rows.map((r) => r.id)).toEqual(["1", "2", "3", "last"]);
      expect(rows[0]).toEqual({ id: "1", name: "Desktop 1", subtitle: "Google Chrome", keywords: ["space", "desktop", "workspace", "1", "Google Chrome"], icon: "\u{f0379}", accessories: [{ tag: "previous" }], actions: [{ id: "go", title: "Go" }] });
      // The apps in the windows' order (most recently used first), each once; the icon is the first window's.
      expect(rows[1]).toMatchObject({ name: "Desktop 2", subtitle: "kitty", icon: { app: "/Applications/kitty.app" }, accessories: [{ tag: "current" }] });
      expect(rows[2]).toMatchObject({ name: "Desktop 3", subtitle: "Nothing open", accessories: [] });
      expect(rows[3]).toMatchObject({ id: "last", name: "Previous space", subtitle: "Desktop 1" });
    });

    test("names from the setting title the rows, become their ids and the windows' `ws` accessory", async () => {
      host.changeSettings("windows", { settings: { spaces: ["web", "term"] } });
      const rows = await spaces();
      expect(rows.map((r) => [r.id, r.name])).toEqual([["web", "web"], ["term", "term"], ["3", "Desktop 3"], ["last", "Previous space"]]);
      expect(rows[3].subtitle).toBe("web");
      host.changeSettings("windows", { settings: { spaces: ["web", "term", "misc"] } });
      expect((await list())[2].accessories).toEqual([{ text: "ws misc" }]);
      host.changeSettings("windows", {});
    });

    test("pick answers the space effect with the backend id; last is the previous space; an unknown id a toast", async () => {
      expect(await go("1")).toEqual({ space: "6" });
      expect(await go("last")).toEqual({ space: "6" });
      expect(await go("2")).toEqual({ space: "5" });
      expect(await go("9")).toEqual({ keep: true, toast: { title: "No space 9", style: "failure" } });
      host.changeSettings("windows", { settings: { spaces: ["web", "term"] } });
      expect(await go("term")).toEqual({ space: "5" });
      expect(await go("2")).toEqual({ keep: true, toast: { title: "No space 2", style: "failure" } });
      host.changeSettings("windows", {});
    });

    test("toggle: a row once the setting names two spaces; on the first it goes to the second, anywhere else to the first", async () => {
      expect((await spaces()).map((r) => r.id)).not.toContain("toggle");
      expect(await go("toggle")).toEqual({ keep: true, toast: { title: "No toggle pair: set two space names in `toggle`", style: "failure" } });
      host.changeSettings("windows", { settings: { spaces: ["web", "term"], toggle: ["web", "term"] } });
      const rows = await spaces();
      expect(rows.at(-1)).toMatchObject({ id: "toggle", name: "Toggle web / term", subtitle: "Between the two; from elsewhere to web", icon: "\u{f04e1}" });
      // The current space (term, "5") is the second: to the first.
      expect(await go("toggle")).toEqual({ space: "6" });
      host.changeSettings("windows", { settings: { spaces: ["web", "term"], toggle: ["term", "web"] } });
      expect(await go("toggle")).toEqual({ space: "6" });
      host.changeSettings("windows", { settings: { toggle: ["3", "1"] } });
      expect(await go("toggle")).toEqual({ space: "1" });
      host.changeSettings("windows", { settings: { toggle: ["web", "term"] } });
      expect((await spaces()).map((r) => r.id)).not.toContain("toggle");
      host.changeSettings("windows", {});
    });

    test("back and forth: the current space's row goes to the previous one", async () => {
      host.changeSettings("windows", { settings: { back_and_forth: true } });
      expect(await go("2")).toEqual({ space: "6" });
      expect(await go("3")).toEqual({ space: "1" });
      host.changeSettings("windows", {});
      expect(await go("2")).toEqual({ space: "5" });
    });
  });

  test("include_minimized off hides the minimised rows", async () => {
    host.changeSettings("windows", { settings: { include_minimized: false } });
    expect((await list()).map((i) => i.id)).toEqual(["w1", "w3", "w5"]);
    host.changeSettings("windows", {});
    expect(await list()).toHaveLength(5);
  });
});
