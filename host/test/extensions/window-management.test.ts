// window-management against canned core/windows.* replies: the static
// layout rows, the `layout` effect with the settings' knobs, the drill-in
// to `arrange` and back.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LAYOUTS } from "../../../extensions/window-management/index.ts";
import { Host } from "../harness.ts";

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

const EXT = "window-management";
const list = (palette = EXT, query?: string, args?: unknown) => host.list(EXT, palette, query, args === undefined ? undefined : { args });
const pick = (id: string, action?: string, args?: unknown, palette = EXT) => host.pick(EXT, palette, id, action, args === undefined ? undefined : { args });

describe("window-management", () => {
  test("meta: an indexed layout palette and an input window picker", () => {
    const l = host.loaded().find((l) => l.extension === EXT)!;
    expect(l.palettes).toEqual([
      { name: EXT, title: "Window Management", live: false, input: false, icon: "◧", placeholder: "Left half, maximize, center..." },
      { name: "arrange", title: "Arrange Window", live: false, input: true, icon: "▢", placeholder: "Which window?" },
    ]);
    expect(l.manifest.settings?.map((s) => [s.id, s.default])).toEqual([["gap", 0], ["almost_maximize_percent", 90], ["reasonable_size_percent", 60]]);
  });

  test("one static row per layout, in the core's order, glyph icon, Focused window subtitle, Apply and Apply to", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(LAYOUTS.map((l) => l.id));
    expect(items.map((i) => i.id)).toEqual([
      "left_half", "right_half", "top_half", "bottom_half",
      "left_third", "center_third", "right_third", "left_two_thirds", "right_two_thirds",
      "top_left_quarter", "top_right_quarter", "bottom_left_quarter", "bottom_right_quarter",
      "maximize", "almost_maximize", "center", "reasonable_size", "next_display", "previous_display", "restore",
    ]);
    expect(items[0]).toEqual({ id: "left_half", name: "Left Half", subtitle: "Focused window", icon: "◧", keywords: ["half", "left", "split"], actions: [{ id: "apply", title: "Apply" }, { id: "apply-to", title: "Apply to…" }] });
    expect(host.coreCalls.filter((c) => c.method.startsWith("windows."))).toEqual([]);
    for (const i of items) expect(typeof i.icon, i.id).toBe("string");
  });

  test("Apply is a layout effect carrying the settings' knobs, the focused window implied", async () => {
    expect(await pick("left_half")).toEqual({ layout: { name: "left_half", gap: 0, almost_maximize_percent: 90, reasonable_size_percent: 60 } });
    expect(await pick("maximize", "apply")).toEqual({ layout: { name: "maximize", gap: 0, almost_maximize_percent: 90, reasonable_size_percent: 60 } });
    host.changeSettings(EXT, { settings: { gap: 8, reasonable_size_percent: 50 } });
    expect(await pick("restore")).toEqual({ layout: { name: "restore", gap: 8, almost_maximize_percent: 90, reasonable_size_percent: 50 } });
    host.changeSettings(EXT, {});
    expect(await pick("nope")).toEqual({});
  });

  test("Apply to… drills into arrange, whose rows are the open windows and whose pick applies to that window", async () => {
    expect(await pick("right_half", "apply-to")).toEqual({ push: { extension: EXT, palette: "arrange", args: { layout: "right_half" } } });
    const rows = await list("arrange", undefined, { layout: "right_half" });
    expect(rows.map((i) => i.id)).toEqual(["w1", "w3"]);
    expect(rows[0]).toMatchObject({ name: "~/proj/pal", subtitle: "kitty", icon: { app: "/Applications/kitty.app" }, actions: [{ id: "apply", title: "Arrange" }] });
    expect((await list("arrange", "downloads")).map((i) => i.id)).toEqual(["w3"]);
    expect(await pick("w3", "apply", { layout: "right_half" }, "arrange")).toEqual({ layout: { name: "right_half", id: "w3", gap: 0, almost_maximize_percent: 90, reasonable_size_percent: 60 } });
  });

  test("from the root, arrange picks a window first and lists the layouts for it", async () => {
    expect(await pick("w1", undefined, undefined, "arrange")).toEqual({ push: { extension: EXT, palette: EXT, args: { id: "w1", title: "~/proj/pal" } } });
    const rows = await list(EXT, "half", { id: "w1", title: "~/proj/pal" });
    expect(rows.map((i) => i.id)).toEqual(["left_half", "right_half", "top_half", "bottom_half"]);
    expect(rows[0]).toMatchObject({ subtitle: "~/proj/pal", actions: [{ id: "apply", title: "Apply" }] });
    expect(await pick("top_half", "apply", { id: "w1", title: "~/proj/pal" })).toEqual({ layout: { name: "top_half", id: "w1", gap: 0, almost_maximize_percent: 90, reasonable_size_percent: 60 } });
  });
});
