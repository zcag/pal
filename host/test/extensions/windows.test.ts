// windows against canned core/windows.* replies: the harness fixtures plus
// a second kitty window, so the per-app actions have a set to act on.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Window } from "../../../sdk/src/index.ts";
import { Host, fixtures } from "../harness.ts";

const MAC = process.platform === "darwin";
const WINDOWS: Window[] = [
  ...fixtures.windows,
  { id: "w4", app: "kitty", title: "~/notes", bundle_or_class: "net.kovidgoyal.kitty", pid: 11, minimized: true, on_screen: false, monitor: null, workspace: null, icon: "/Applications/kitty.app" },
];

let host: Host;
const closed: unknown[] = [];
const minimized: unknown[] = [];
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "windows.list": () => WINDOWS,
      "windows.close": (p) => { if (p.id === "w3") throw new Error("Finder refused"); closed.push(p); return null; },
      "windows.minimize": (p) => { minimized.push(p); return null; },
    },
  });
});
afterAll(() => host.kill());

const list = () => host.list("windows", "windows");
const pick = (id: string, action?: string) => host.pick("windows", "windows", id, action);
const perApp = MAC ? ["hide-app", "minimize-all", "close-all"] : ["minimize-all", "close-all"];

describe("windows", () => {
  test("meta: live, not input, so titles are root results", () => {
    expect(host.loaded().find((l) => l.extension === "windows")!.palettes).toEqual([{ name: "windows", title: "Windows", live: true, input: false, icon: "▣", placeholder: "Switch to a window" }]);
  });

  test("rows in the core's order: title, app as subtitle, section and keyword, app icon or a glyph, state accessories", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["w1", "w2", "w3", "w4"]);
    expect(items[0]).toEqual({
      id: "w1", name: "~/proj/pal", subtitle: "kitty", keywords: ["net.kovidgoyal.kitty", "kitty"], icon: { app: "/Applications/kitty.app" }, accessories: [], section: "kitty",
      actions: [
        { id: "focus", title: "Focus" }, { id: "close", title: "Close", shortcut: "cmd+w", style: "destructive" }, { id: "minimize", title: "Minimize", shortcut: "cmd+m" },
        ...(MAC ? [{ id: "hide-app", title: "Hide app", shortcut: "cmd+h" }] : []),
        { id: "minimize-all", title: "Minimize all of this app", shortcut: "cmd+shift+m" },
        { id: "close-all", title: "Close all of this app", shortcut: "cmd+shift+w", style: "destructive", confirm: "Close every window of this app?" },
      ],
    });
    expect(items[1]).toMatchObject({ icon: "▢", section: "Google Chrome", accessories: [{ tag: "minimized" }, { text: "Display 2" }] });
    // A minimised window has no Minimize; an app with one window has no per-app actions.
    expect(items[1].actions!.map((a) => a.id)).toEqual(["focus", "close", ...(MAC ? ["hide-app"] : [])]);
    expect(items[2].accessories).toEqual([{ text: "ws 3" }]);
    expect(items[3].actions!.map((a) => a.id)).toEqual(["focus", "close", ...perApp]);
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

  test("a core failure becomes a failure toast, palette kept", async () => {
    expect(await pick("w3", "close")).toEqual({ keep: true, toast: { title: "Could not close the window", message: "Finder refused", style: "failure" } });
    expect(await pick("w3", "close-all")).toEqual({ keep: true, toast: { title: "Could not close every window of Finder", message: "Finder refused", style: "failure" } });
  });

  test("include_minimized off hides the minimised rows", async () => {
    host.changeSettings("windows", { settings: { include_minimized: false } });
    expect((await list()).map((i) => i.id)).toEqual(["w1", "w3"]);
    host.changeSettings("windows", {});
    expect(await list()).toHaveLength(4);
  });
});
