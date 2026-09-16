// windows against canned core/windows.* replies.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host } from "../harness.ts";

let host: Host;
const closed: unknown[] = [];
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "windows.close": (p) => { if (p.id === "w3") throw new Error("Finder refused"); closed.push(p); return null; },
      "windows.minimize": () => null,
    },
  });
});
afterAll(() => host.kill());

const list = () => host.list("windows", "windows");
const pick = (id: string, action?: string) => host.pick("windows", "windows", id, action);

describe("windows", () => {
  test("meta: live, not input, so titles are root results", () => {
    expect(host.loaded().find((l) => l.extension === "windows")!.palettes).toEqual([{ name: "windows", title: "Windows", live: true, input: false, icon: "▣", placeholder: "Switch to a window" }]);
  });

  test("rows in the core's order: title, app, class keyword, app icon or a glyph, state accessories", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["w1", "w2", "w3"]);
    expect(items[0]).toEqual({
      id: "w1", name: "~/proj/pal", subtitle: "kitty", keywords: ["net.kovidgoyal.kitty"], icon: { app: "/Applications/kitty.app" }, accessories: [],
      actions: [{ id: "focus", title: "Focus" }, { id: "close", title: "Close", shortcut: "cmd+w", style: "destructive" }, { id: "minimize", title: "Minimize", shortcut: "cmd+m" }],
    });
    expect(items[1]).toMatchObject({ icon: "▢", accessories: [{ tag: "minimized" }, { text: "Display 2" }] });
    expect(items[1].actions!.map((a) => a.id)).toEqual(["focus", "close"]);
    expect(items[2].accessories).toEqual([{ text: "ws 3" }]);
  });

  test("pick focuses by default; close and minimize go to the core and keep the palette", async () => {
    expect(await pick("w1")).toEqual({ focus: "w1" });
    expect(await pick("w1", "focus")).toEqual({ focus: "w1" });
    expect(await pick("w1", "close")).toEqual({ keep: true });
    expect(closed).toEqual([{ id: "w1" }]);
    expect(await pick("w1", "minimize")).toEqual({ keep: true });
    expect(host.coreCalls.at(-1)).toEqual({ method: "windows.minimize", params: { id: "w1" } });
  });

  test("a core failure becomes a failure toast, palette kept", async () => {
    expect(await pick("w3", "close")).toEqual({ keep: true, toast: { title: "Could not close the window", message: "Finder refused", style: "failure" } });
  });

  test("include_minimized off hides the minimised row", async () => {
    host.changeSettings("windows", { settings: { include_minimized: false } });
    expect((await list()).map((i) => i.id)).toEqual(["w1", "w3"]);
    host.changeSettings("windows", {});
    expect(await list()).toHaveLength(3);
  });
});
