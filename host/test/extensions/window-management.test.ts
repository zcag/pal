// window-management against canned core/windows.* replies: the static
// layout rows, the `layout` effect with the settings' knobs, the drill-in
// to `arrange` and back, the Resize to… arguments writing a frame.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { LAYOUTS, displayOf, parseSize, resizeFrame } from "../../../extensions/window-management/index.ts";
import { Host } from "../harness.ts";

// The canned frames: w1 on a 1440x900 display (a 25 px menu bar), w3 on a second one to the right.
const DISPLAYS = [
  { id: "1", frame: { x: 0, y: 0, w: 1440, h: 925 }, visible_frame: { x: 0, y: 25, w: 1440, h: 900 }, primary: true },
  { id: "2", frame: { x: 1440, y: 0, w: 2560, h: 1440 }, visible_frame: { x: 1440, y: 0, w: 2560, h: 1400 }, primary: false },
];
const frames: Record<string, { x: number; y: number; w: number; h: number }> = { w1: { x: 100, y: 100, w: 800, h: 600 }, w3: { x: 1500, y: 50, w: 1000, h: 700 } };
const set: unknown[] = [];
let host: Host;
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "windows.focused": () => ({ id: "w1", app: "kitty", title: "~/proj/pal", bundle_or_class: "net.kovidgoyal.kitty", pid: 11, minimized: false, hidden: false, on_screen: true, monitor: null, workspace: null, icon: null }),
      "windows.frame": ({ id }: { id: string }) => frames[id],
      "windows.displays": () => DISPLAYS,
      "windows.set_frame": (p: unknown) => { set.push(p); return null; },
    },
  });
});
afterAll(() => host.kill());

const EXT = "window-management";
const KNOBS = { gap: 0, almost_maximize_percent: 90, reasonable_size_percent: 60, step: 32, cycle: false };
const list = (palette = EXT, query?: string, args?: unknown) => host.list(EXT, palette, query, args === undefined ? undefined : { args });
const pick = (id: string, action?: string, ctx?: Record<string, unknown>, palette = EXT) => host.pick(EXT, palette, id, action, ctx);

describe("window-management", () => {
  test("meta: an indexed layout palette and an input window picker", () => {
    const l = host.loaded().find((l) => l.extension === EXT)!;
    expect(l.palettes).toEqual([
      { name: EXT, title: "Window Management", live: false, input: false, icon: tile("indigo", "\u{f10aa}"), placeholder: "Left half, maximize, center..." },
      { name: "arrange", title: "Arrange Window", live: false, input: true, icon: tile("indigo", "\u{f10aa}"), placeholder: "Which window?" },
    ]);
    expect(l.manifest.settings?.map((s) => [s.id, s.default])).toEqual([["gap", 0], ["almost_maximize_percent", 90], ["reasonable_size_percent", 60], ["step", 32], ["cycle", false], ["keep_below_bar", false], ["bar_height", 0]]);
  });

  test("one static row per layout, in the core's order, a diagram icon, Focused window subtitle, Apply and Apply to", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(LAYOUTS.map((l) => l.id));
    expect(items.map((i) => i.id)).toEqual([
      "left_half", "right_half", "top_half", "bottom_half",
      "left_third", "center_third", "right_third", "left_two_thirds", "right_two_thirds",
      "top_left_quarter", "top_right_quarter", "bottom_left_quarter", "bottom_right_quarter",
      "maximize", "almost_maximize", "maximize_height", "maximize_width", "center", "reasonable_size",
      "larger", "smaller", "resize", "move_left", "move_right", "move_up", "move_down",
      "next_display", "previous_display", "fullscreen", "minimize", "unminimize", "restore",
    ]);
    expect(items[0]).toEqual({ id: "left_half", name: "Left Half", subtitle: "Focused window", icon: { image: expect.stringMatching(/^data:image\/svg\+xml/) }, keywords: ["half", "left", "split"], actions: [{ id: "apply", title: "Apply" }, { id: "apply-to", title: "Apply to…" }] });
    expect(host.coreCalls.filter((c) => c.method.startsWith("windows."))).toEqual([]);
    // Every layout draws its own diagram, no two alike, never the initial fallback.
    const urls = items.map((i) => (i.icon as { image: string }).image);
    for (const u of urls) expect(u).toMatch(/^data:image\/svg\+xml/);
    expect(new Set(urls).size).toBe(urls.length);
    // Unminimize picks its own window (the last one minimised), so it has no target to choose.
    expect(items.find((i) => i.id === "unminimize")).toMatchObject({ subtitle: "Last minimized window", actions: [{ id: "apply", title: "Apply" }] });
    expect(items.find((i) => i.id === "fullscreen")).toMatchObject({ name: "Toggle Fullscreen", subtitle: "Focused window", actions: [{ id: "apply", title: "Apply" }, { id: "apply-to", title: "Apply to…" }] });
  });

  test("Apply is a layout effect carrying the settings' knobs, the focused window implied", async () => {
    expect(await pick("left_half")).toEqual({ layout: { name: "left_half", ...KNOBS } });
    expect(await pick("maximize", "apply")).toEqual({ layout: { name: "maximize", ...KNOBS } });
    host.changeSettings(EXT, { settings: { gap: 8, reasonable_size_percent: 50, step: 64, cycle: true } });
    expect(await pick("restore")).toEqual({ layout: { name: "restore", gap: 8, almost_maximize_percent: 90, reasonable_size_percent: 50, step: 64, cycle: true } });
    expect(await pick("move_left")).toEqual({ layout: { name: "move_left", gap: 8, almost_maximize_percent: 90, reasonable_size_percent: 50, step: 64, cycle: true } });
    host.changeSettings(EXT, {});
    expect(await pick("unminimize")).toEqual({ layout: { name: "unminimize", ...KNOBS } });
    // No window to pick for it: Apply to… is Apply.
    expect(await pick("unminimize", "apply-to")).toEqual({ layout: { name: "unminimize", ...KNOBS } });
    expect(await pick("nope")).toEqual({});
  });

  test("Apply to… drills into arrange, whose rows are the open windows and whose pick applies to that window", async () => {
    expect(await pick("right_half", "apply-to")).toEqual({ push: { extension: EXT, palette: "arrange", args: { layout: "right_half" } } });
    const rows = await list("arrange", undefined, { layout: "right_half" });
    expect(rows.map((i) => i.id)).toEqual(["w1", "w3"]);
    expect(rows[0]).toMatchObject({ name: "~/proj/pal", subtitle: "kitty", icon: { app: "/Applications/kitty.app" }, actions: [{ id: "apply", title: "Arrange" }] });
    expect((await list("arrange", "downloads")).map((i) => i.id)).toEqual(["w3"]);
    expect(await pick("w3", "apply", { args: { layout: "right_half" } }, "arrange")).toEqual({ layout: { name: "right_half", id: "w3", ...KNOBS } });
    // Fullscreen and minimize take a picked window.
    expect(await pick("fullscreen", "apply-to")).toEqual({ push: { extension: EXT, palette: "arrange", args: { layout: "fullscreen" } } });
  });

  test("from the root, arrange picks a window first and lists the layouts for it", async () => {
    expect(await pick("w1", undefined, undefined, "arrange")).toEqual({ push: { extension: EXT, palette: EXT, args: { id: "w1", title: "~/proj/pal" } } });
    const rows = await list(EXT, "half", { id: "w1", title: "~/proj/pal" });
    expect(rows.map((i) => i.id)).toEqual(["left_half", "right_half", "top_half", "bottom_half"]);
    expect(rows[0]).toMatchObject({ subtitle: "~/proj/pal", actions: [{ id: "apply", title: "Apply" }] });
    expect(await pick("top_half", "apply", { args: { id: "w1", title: "~/proj/pal" } })).toEqual({ layout: { name: "top_half", id: "w1", ...KNOBS } });
    const all = await list(EXT, "", { id: "w1", title: "~/proj/pal" });
    expect(all.map((i) => i.id)).not.toContain("unminimize");
    expect(all.map((i) => i.id)).toContain("minimize");
    expect(all.map((i) => i.id)).toContain("fullscreen");
  });

  test("the size grammar, the display under a window, and the frame a resize lands on", () => {
    expect(parseSize("1280x720")).toEqual({ w: 1280, h: 720 });
    expect(parseSize(" 1280 X 720 ")).toEqual({ w: 1280, h: 720 });
    expect(parseSize("1280 720")).toEqual({ w: 1280, h: 720 });
    expect(parseSize("1280×720")).toEqual({ w: 1280, h: 720 });
    expect(parseSize("800")).toEqual({ w: 800, h: 800 });
    for (const bad of ["", "big", "1280x", "1x2x3", "0x0", "12.5x7"]) expect(parseSize(bad)).toBeUndefined();
    expect(displayOf(DISPLAYS, frames.w1)?.id).toBe("1");
    expect(displayOf(DISPLAYS, frames.w3)?.id).toBe("2");
    // The centre, at 1700, is on the second; off every display it is the primary.
    expect(displayOf(DISPLAYS, { x: 1400, y: 100, w: 600, h: 400 })?.id).toBe("2");
    expect(displayOf(DISPLAYS, { x: 9000, y: 9000, w: 10, h: 10 })?.id).toBe("1");
    const area = DISPLAYS[0].visible_frame;
    // Centred on the old centre (500, 400).
    expect(resizeFrame(frames.w1, { w: 400, h: 300 }, {}, area)).toEqual({ x: 300, y: 250, w: 400, h: 300 });
    // A place given on one axis keeps the other centred; pushed back inside where it would spill.
    expect(resizeFrame(frames.w1, { w: 400, h: 300 }, { x: 1300 }, area)).toEqual({ x: 1040, y: 250, w: 400, h: 300 });
    expect(resizeFrame(frames.w1, { w: 400, h: 300 }, { x: 0, y: 0 }, area)).toEqual({ x: 0, y: 25, w: 400, h: 300 });
    // Larger than the screen: capped to it.
    expect(resizeFrame(frames.w1, { w: 3000, h: 2000 }, {}, area)).toEqual({ x: 0, y: 25, w: 1440, h: 900 });
    // No display known: the size as asked, the centre kept.
    expect(resizeFrame(frames.w1, { w: 3000, h: 2000 }, {})).toEqual({ x: -1000, y: -600, w: 3000, h: 2000 });
  });

  test("Resize to… takes the size and place in the bar; the values write the frame of the focused window, hide and say the size; a pick without them is the same fields as a form", async () => {
    const row = (await list()).find((i) => i.id === "resize")!;
    expect(row).toMatchObject({ name: "Resize to…", subtitle: "Focused window", actions: [{ id: "apply", title: "Apply" }, { id: "apply-to", title: "Apply to…" }] });
    expect(row.args).toEqual([{ id: "size", placeholder: "1280x720", required: true }, { id: "x", placeholder: "X (blank: centred)" }, { id: "y", placeholder: "Y (blank: centred)" }]);
    expect((await list()).filter((i) => i.args).map((i) => i.id)).toEqual(["resize"]);
    const form = (await pick("resize")) as { form: { id: string; title: string; fields: { id: string }[]; submit: { id: string } } };
    expect(form.form).toMatchObject({ id: "resize", title: "Resize the focused window", submit: { id: "resize-submit", title: "Resize" } });
    expect(form.form.fields.map((f) => f.id)).toEqual(["size", "x", "y"]);
    // Nonsense is the fields again with the message, nothing written; from the bar (apply) or the form's submit alike.
    const again = (await pick("resize", "apply", { values: { size: "huge", x: "", y: "" } })) as { form: { errors: Record<string, string>; fields: { id: string }[] } };
    expect(again.form.errors).toEqual({ size: "Width x height in px, like 1280x720" });
    expect(again.form.fields.map((f) => f.id)).toEqual(["size", "x", "y"]);
    expect((await pick("resize", "resize-submit", { values: { size: "1280x720", x: "left", y: "" } }) as { form: { errors: Record<string, string> } }).form.errors).toEqual({ x: "A whole number of px, or blank" });
    expect(set).toEqual([]);
    // The focused window (w1 at 100,100 800x600), centred on its centre, on its display.
    expect(await pick("resize", "apply", { values: { size: "1280x720", x: "", y: "" } })).toEqual({ hide: true, hud: "Resized to 1280x720" });
    expect(set).toEqual([{ id: "w1", x: 0, y: 40, w: 1280, h: 720 }]);
    set.length = 0;
    // Capped to the display, said as landed.
    expect(await pick("resize", "resize-submit", { values: { size: "5000", x: "10", y: "10" } })).toEqual({ hide: true, hud: "Resized to 1440x900" });
    expect(set).toEqual([{ id: "w1", x: 0, y: 25, w: 1440, h: 900 }]);
    set.length = 0;
  });

  test("Resize to… on a picked window: from the target level, and from arrange with the row's Apply to… (the window rows take the size then)", async () => {
    const form = (await pick("resize", "apply", { args: { id: "w3", title: "Downloads" } })) as { form: { id: string; title: string } };
    expect(form.form).toMatchObject({ id: "resize:w3", title: "Resize Downloads" });
    expect(await pick("resize", "apply", { values: { size: "640x480", x: "", y: "" }, args: { id: "w3", title: "Downloads" } })).toEqual({ hide: true, hud: "Resized to 640x480" });
    expect(set).toEqual([{ id: "w3", x: 1680, y: 160, w: 640, h: 480 }]);
    set.length = 0;
    expect(await pick("resize:w3", "resize-submit", { values: { size: "640x480", x: "", y: "" }, args: { id: "w3", title: "Downloads" } })).toEqual({ hide: true, hud: "Resized to 640x480" });
    expect(set).toHaveLength(1);
    set.length = 0;
    expect(await pick("resize", "apply-to")).toEqual({ push: { extension: EXT, palette: "arrange", args: { layout: "resize" } } });
    // Opened for Resize, every window row carries the size fields and its action says so; for any other layout they take nothing.
    const rows = await list("arrange", undefined, { layout: "resize" });
    expect(rows.map((r) => [r.id, r.actions![0].title, r.args?.map((a) => a.id)])).toEqual([["w1", "Resize", ["size", "x", "y"]], ["w3", "Resize", ["size", "x", "y"]]]);
    expect((await list("arrange", undefined, { layout: "right_half" })).every((r) => r.args === undefined && r.actions![0].title === "Arrange")).toBe(true);
    expect(await pick("w3", "apply", { args: { layout: "resize" } }, "arrange")).toMatchObject({ form: { id: "resize:w3", title: "Resize Downloads" } });
    expect(await pick("w3", "apply", { values: { size: "640x480", x: "", y: "" }, args: { layout: "resize" } }, "arrange")).toEqual({ hide: true, hud: "Resized to 640x480" });
    expect(await pick("resize:w3", "resize-submit", { values: { size: "640x480", x: "", y: "" } }, "arrange")).toEqual({ hide: true, hud: "Resized to 640x480" });
    expect(set).toHaveLength(2);
    set.length = 0;
    expect(host.coreCalls.filter((c) => c.method === "windows.set_frame")).toHaveLength(6);
  });
});
