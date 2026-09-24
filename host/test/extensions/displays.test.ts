// displays: the parsers on fixtures, the two trees through checkView, and
// the palette, bar item and routes against fake tools on PATH (shell
// scripts that print the fixtures and log what they were asked to set).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { INPUTS, findMode, formatPlacements, levelFrom, mergeMac, parseBrightnessCli, parseDdcctl, parseDdcutilDetect, parseDdcutilVcp, parseDisplayplacer, parseHyprctl, parseInput, parseM1ddcList, parsePlacement, parseProfiler, parseWlrRandr, parseXrandr, withMain, withMirror, withMode, withoutMirror, type Screen } from "../../../extensions/displays/model.ts";
import { popover, sliderView } from "../../../extensions/displays/view.ts";
import { resolveScreen } from "../../../extensions/displays/index.ts";
import { checkView } from "../../../sdk/src/view.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { Host, stored, writeTool } from "../harness.ts";
import { BRIGHTNESS_L, BUILTIN, DDCCTL, DDCUTIL_DETECT, DELL, DISPLAYPLACER, DISPLAYPLACER_MIRRORED, HYPRCTL, M1DDC_LIST, PROFILER, WLR_RANDR, XRANDR } from "./displays-fixtures.ts";

const walk = (n: ViewNode): ViewNode[] => [n, ...(n.type === "stack" ? n.children.flatMap(walk) : [])];
const texts = (v: View) => walk(v.tree).flatMap((n) => (n.type === "text" ? [n.value] : n.type === "badge" ? [`[${n.text}]`] : []));
const sliders = (v: View) => walk(v.tree).filter((n) => n.type === "slider") as Extract<ViewNode, { type: "slider" }>[];
const viewOf = (x: unknown): View => { const v = (x as any).view ?? (x as any).menu?.view; if (!v) throw new Error("no view"); return v; };

describe("displays: parsers", () => {
  test("displayplacer: blocks, modes, the reproduce line and a mirror set", () => {
    const dp = parseDisplayplacer(DISPLAYPLACER);
    expect(dp.screens.map((s) => [s.id, s.uuid, s.builtin, s.main, s.w, s.h, s.hz, s.hidpi, s.origin.x, s.modes.length])).toEqual([["1", BUILTIN, true, false, 1800, 1169, 120, true, -1800, 8], ["2", DELL, false, true, 2560, 1440, 60, true, 0, 4]]);
    expect(dp.screens[0].modes.find((m) => m.current)).toEqual({ id: "2", w: 1800, h: 1169, hz: 120, depth: 8, hidpi: true, current: true });
    expect(dp.screens[1].modes[3]).toEqual({ id: "3", w: 3840, h: 2160, hz: 60, depth: 8, hidpi: false });
    expect(dp.placements).toEqual([{ id: BUILTIN, mirrors: [], enabled: true, w: 1800, h: 1169, hz: 120, depth: 8, hidpi: true, x: -1800, y: 271, degree: 0 }, { id: DELL, mirrors: [], enabled: true, w: 2560, h: 1440, hz: 60, depth: 8, hidpi: true, x: 0, y: 0, degree: 0 }]);
    expect(formatPlacements(dp.placements)).toEqual(["displayplacer", `id:${BUILTIN} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(-1800,271) degree:0`, `id:${DELL} res:2560x1440 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0`]);
    const mirrored = parseDisplayplacer(DISPLAYPLACER_MIRRORED);
    expect(mirrored.placements).toEqual([{ id: BUILTIN, mirrors: [DELL], enabled: true, w: 1800, h: 1169, hz: 120, depth: 8, hidpi: true, x: 0, y: 0, degree: 0 }]);
    expect(parsePlacement(`id:${DELL} enabled:false`)).toMatchObject({ id: DELL, enabled: false });
    expect(formatPlacements([{ id: DELL, mirrors: [], enabled: false, x: 0, y: 0, degree: 0 }])).toEqual(["displayplacer", `id:${DELL} enabled:false`]);
  });

  test("system_profiler, m1ddc, the brightness CLI, ddcctl", () => {
    expect(parseProfiler(PROFILER)).toEqual([
      { id: "1", name: "Built-in Liquid Retina XDR Display", builtin: true, main: false, mirror: false, connection: "internal", w: 1800, h: 1169, hz: 120, pixels: { w: 3600, h: 2338 } },
      { id: "2", name: "DELL U2720Q", builtin: false, main: true, mirror: false, connection: "displayport-dongletype-dp", w: 2560, h: 1440, hz: 60, pixels: { w: 5120, h: 2880 } },
    ]);
    expect(parseProfiler("not json")).toEqual([]);
    expect(parseM1ddcList(M1DDC_LIST)).toEqual([{ index: 1, name: undefined, uuid: BUILTIN, id: "1" }, { index: 2, name: "DELL U2720Q", uuid: DELL, id: "2" }]);
    expect(parseBrightnessCli(BRIGHTNESS_L("0.500000"))).toEqual([{ index: 0, builtin: true, id: "1", level: 50 }, { index: 1, builtin: false, id: "2" }]);
    expect(parseDdcctl(DDCCTL)).toEqual({ current: 70, max: 100 });
    expect(parseDdcctl("E: DDC send command failed!")).toBeUndefined();
  });

  test("merge: names from system_profiler, the rest from displayplacer, the DDC handle from m1ddc, mirrors from the reproduce line", () => {
    const screens = mergeMac(parseProfiler(PROFILER), parseDisplayplacer(DISPLAYPLACER_MIRRORED), parseM1ddcList(M1DDC_LIST));
    expect(screens.map((s) => [s.id, s.name, s.main, s.uuid, s.ddc, s.mirrorOf, s.mirrors, s.modes.length])).toEqual([["2", "DELL U2720Q", true, DELL, DELL, "1", [], 4], ["1", "Built-in Liquid Retina XDR Display", false, BUILTIN, undefined, undefined, ["2"], 8]]);
    // Without displayplacer: what system_profiler alone gives, HiDPI from the pixel ratio.
    const bare = mergeMac(parseProfiler(PROFILER), undefined);
    expect(bare.map((s) => [s.id, s.hidpi, s.modes.length, s.uuid])).toEqual([["2", true, 0, undefined], ["1", true, 0, undefined]]);
  });

  test("Linux: hyprctl, wlr-randr, xrandr, ddcutil", () => {
    const h = parseHyprctl(HYPRCTL);
    expect(h.map((s) => [s.id, s.name, s.builtin, s.main, s.w, s.hz, s.scale, s.hidpi, s.origin?.x, s.modes.length, s.modes.find((m) => m.current)?.id])).toEqual([["eDP-1", "BOE 0x0BCA", true, false, 2880, 120, 2, true, 0, 3, "2880x1800@120.00Hz"], ["DP-1", "Dell Inc. DELL U2720Q ABC1234", false, true, 3840, 60, 1.5, true, 1440, 3, "3840x2160@59.99Hz"]]);
    const w = parseWlrRandr(WLR_RANDR);
    expect(w.map((s) => [s.id, s.name, s.w, s.h, s.hz, s.scale, s.modes.map((m) => m.current)])).toEqual([["DP-1", "Dell Inc. DELL U2720Q", 3840, 2160, 60, 1.5, [true, undefined]]]);
    const x = parseXrandr(XRANDR);
    expect(x.map((s) => [s.id, s.builtin, s.main, s.w, s.h, s.hz, s.origin?.x, s.modes.length])).toEqual([["eDP-1", true, false, 2880, 1800, 120, 0, 3], ["DP-1", false, true, 3840, 2160, 60, 2880, 3]]);
    expect(x[1].modes[0]).toEqual({ id: "3840x2160@59.98", w: 3840, h: 2160, hz: 60, current: true });
    expect(parseDdcutilDetect(DDCUTIL_DETECT)).toEqual([{ display: 1, connector: "DP-1", model: "DELL U2720Q" }]);
    expect(parseDdcutilVcp("VCP 10 C 55 100\n")).toEqual({ current: 55, max: 100 });
    expect(parseDdcutilVcp("VCP 60 SNC x11\n")).toEqual({ current: 17, max: 0 });
  });

  test("arrangement maths", () => {
    const ps = parseDisplayplacer(DISPLAYPLACER).placements;
    expect(withMode(ps, DELL, { id: "3", w: 3840, h: 2160, hz: 60, hidpi: false })[1]).toMatchObject({ w: 3840, h: 2160, hidpi: false, x: 0 });
    // Main moves to the panel: every origin shifts by the panel's, so it lands at (0,0) and the Dell to its right.
    expect(withMain(ps, BUILTIN).map((p) => [p.x, p.y])).toEqual([[0, 0], [1800, -271]]);
    expect(withMain(ps, DELL)).toBe(ps);
    const mirrored = withMirror(ps, DELL, BUILTIN);
    expect(mirrored).toEqual([{ ...ps[0], mirrors: [DELL] }]);
    expect(withoutMirror(mirrored, DELL, { w: 2560, h: 1440, hz: 60, depth: 8, hidpi: true })).toEqual([ps[0], { id: DELL, mirrors: [], enabled: true, w: 2560, h: 1440, hz: 60, depth: 8, hidpi: true, x: 0, y: 271, degree: 0 }]);
    expect(withMirror(ps, DELL, DELL)).toBe(ps);
  });

  test("findMode, levelFrom, parseInput, resolveScreen", () => {
    const modes = parseDisplayplacer(DISPLAYPLACER).screens[0].modes;
    expect(findMode(modes, "2")?.id).toBe("2");
    expect(findMode(modes, "1512x945")?.id).toBe("0");
    expect(findMode(modes, "1512×945 @ 60")?.id).toBe("1");
    expect(findMode(modes, "1920x1200 native")?.id).toBe("4");
    expect(findMode(modes, "1920x1200 hidpi")).toBeUndefined();
    expect(findMode(modes, "nope")).toBeUndefined();
    expect(levelFrom(40, "+10")).toBe(50);
    expect(levelFrom(40, "-50", 5)).toBe(5);
    expect(levelFrom(undefined, "62%")).toBe(62);
    expect(levelFrom(undefined, "0.7")).toBe(70);
    expect(levelFrom(40, "150")).toBe(100);
    expect(levelFrom(40, "lots")).toBeUndefined();
    expect(parseInput("HDMI 1")).toBe("hdmi1");
    expect(parseInput("dp-2")).toBe("dp2");
    expect(parseInput("usb-c")).toBe("usbc");
    expect(parseInput("17")).toBe(17);
    expect(parseInput("scart")).toBeUndefined();
    expect(INPUTS.map((i) => i.code)).toEqual([15, 16, 17, 18, 27]);
    const screens = mergeMac(parseProfiler(PROFILER), parseDisplayplacer(DISPLAYPLACER));
    expect(resolveScreen(screens, undefined, "external")?.id).toBe("2");
    expect(resolveScreen(screens, "builtin", "main")?.id).toBe("1");
    expect(resolveScreen(screens, "dell", "main")?.id).toBe("2");
    expect(resolveScreen(screens, BUILTIN.toLowerCase(), "main")?.id).toBe("1");
    expect(resolveScreen(screens, "external", "main")?.id).toBe("2");
    expect(resolveScreen(screens.filter((s) => s.builtin), "external", "main")).toBeUndefined();
    expect(resolveScreen(screens.filter((s) => s.builtin), undefined, "external")?.id).toBe("1");
  });
});

describe("displays: views", () => {
  const screens = mergeMac(parseProfiler(PROFILER), parseDisplayplacer(DISPLAYPLACER), parseM1ddcList(M1DDC_LIST));
  const [panel, dell] = screens.sort((a, b) => a.id.localeCompare(b.id)) as [Screen, Screen];

  test("the slider view: a card, the slider, the keys; an unread level shows why", () => {
    const v = sliderView({ screen: dell, control: "brightness", value: 70, step: 5, compact: true });
    checkView(v, "test");
    expect(v.title).toBe("Brightness: DELL U2720Q");
    expect(v.id).toBe("brightness:2");
    expect(sliders(v)[0]).toMatchObject({ value: 0.7, action: "set", color: "amber" });
    expect(texts(v)).toContain("70%");
    expect(v.actions.map((a) => a.id).slice(0, 6)).toEqual(["up", "down", "fine-up", "fine-down", "max", "set"]);
    expect(v.actions.find((a) => a.id === "preset:100")?.shortcut).toBe("0");
    const unread = sliderView({ screen: panel, control: "contrast", value: undefined, step: 5, reason: "no tool" });
    checkView(unread, "test");
    expect(sliders(unread)).toHaveLength(0);
    expect(texts(unread)).toContain("no tool");
    expect(unread.actions.map((a) => a.id)).toEqual(["retry"]);
  });

  test("the popover: a card per screen, the cursor's elevated, a slider only where one can be set", () => {
    const v = popover({ screens: [{ screen: dell, level: 70, settable: true }, { screen: panel, level: undefined, settable: false }], focus: 0, step: 5, night: true, hint: "Built-in brightness needs the brightness CLI: brew install --HEAD brightness" });
    checkView(v, "test");
    expect(v.title).toBe("2 displays");
    expect(sliders(v).map((s) => s.action)).toEqual(["set:2"]);
    expect(texts(v)).toContain("Set with the keyboard's keys");
    expect(texts(v)).toContain("[main]");
    expect(walk(v.tree).find((n) => n.selected)?.key).toBe("screen-2");
    expect(v.actions.map((a) => a.id)).toEqual(["open", "up", "down", "fine-up", "fine-down", "preset:10", "preset:20", "preset:30", "preset:40", "preset:50", "preset:60", "preset:70", "preset:80", "preset:90", "preset:100", "night", "open-pal", "next", "prev", "focus:2", "set:2", "focus:1"]);
    const none = popover({ screens: [], focus: 0, step: 5 });
    checkView(none, "test");
    expect(none.title).toBe("No displays");
  });
});

// ---- the extension against fake tools ---------------------------------------

type Fakes = { dir: string; bin: string; log: string };
/** A sh script at `bin/<name>`: fixtures by `cat`, what it was asked logged as one line per call. */
function fake(f: Fakes, name: string, body: string) {
  const p = join(f.bin, name);
  writeTool(p, `#!/bin/sh\nDIR="${f.dir}"\nLOG="${f.log}"\n${body}\n`);

}
function fakes(): Fakes {
  const dir = mkdtempSync(join(tmpdir(), "pal-displays-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const f = { dir, bin, log: join(dir, "log") };
  writeFileSync(f.log, "");
  writeFileSync(join(dir, "displayplacer.txt"), DISPLAYPLACER);
  writeFileSync(join(dir, "profiler.json"), PROFILER);
  writeFileSync(join(dir, "m1ddc.txt"), M1DDC_LIST);
  writeFileSync(join(dir, "cli-level"), "0.500000");
  writeFileSync(join(dir, "ddc-luminance"), "70");
  writeFileSync(join(dir, "night"), "on");
  fake(f, "system_profiler", `cat "$DIR/profiler.json"`);
  fake(f, "displayplacer", `if [ "$1" = list ]; then cat "$DIR/displayplacer.txt"; else printf 'displayplacer %s\\n' "$*" >> "$LOG"; fi`);
  fake(f, "brightness", `case "$1" in -l) printf 'display 0: main, active, awake, online, built-in, ID 0x1\\ndisplay 0: brightness %s\\ndisplay 1: active, awake, online, external, ID 0x2\\n' "$(cat "$DIR/cli-level")";; -d) printf '%s' "$3" > "$DIR/cli-level"; printf 'brightness %s\\n' "$*" >> "$LOG";; esac`);
  fake(f, "m1ddc", `case "$*" in
  "display list detailed") cat "$DIR/m1ddc.txt";;
  "display ${DELL} get luminance") m=$(cat "$DIR/miss" 2>/dev/null || echo 0); if [ "$m" -gt 0 ]; then echo $((m - 1)) > "$DIR/miss"; echo 0; else cat "$DIR/ddc-luminance"; fi;;
  "display ${DELL} max luminance") echo 100;;
  "display ${DELL} get contrast") echo 75;;
  "display ${DELL} max contrast") echo 100;;
  "display ${DELL} get volume") echo 30;;
  "display ${DELL} max volume") echo 100;;
  "display ${DELL} set luminance "*) printf '%s' "$5" > "$DIR/ddc-luminance"; printf 'm1ddc %s\\n' "$*" >> "$LOG";;
  "display ${DELL} set "*) printf 'm1ddc %s\\n' "$*" >> "$LOG";;
  *) echo "Could not find a suitable external display." >&2; exit 1;;
esac`);
  fake(f, "nightlight", `case "$1" in status) cat "$DIR/night"; exit 0;; on|off) printf '%s' "$1" > "$DIR/night";; toggle) if [ "$(cat "$DIR/night")" = on ]; then printf off > "$DIR/night"; else printf on > "$DIR/night"; fi;; esac; printf 'nightlight %s\\n' "$*" >> "$LOG"`);
  return f;
}
const logOf = (f: Fakes) => readFileSync(f.log, "utf8").trim().split("\n").filter(Boolean);
const clearLog = (f: Fakes) => writeFileSync(f.log, "");
/** The state files back to their start, and the extension's caches dropped (a `⌘R` listing), so the next test reads them. */
async function reset(f: Fakes, host: Host) {
  writeFileSync(join(f.dir, "ddc-luminance"), "70");
  writeFileSync(join(f.dir, "cli-level"), "0.500000");
  writeFileSync(join(f.dir, "night"), "on");
  writeFileSync(join(f.dir, "displayplacer.txt"), DISPLAYPLACER);
  await host.list("displays", "displays", "", { refresh: true });
}

/** A host with PATH holding only the fakes (and the coreutils the scripts use), the platform pinned. */
async function start(f: Fakes, os: "darwin" | "linux", env: Record<string, string> = {}, settings: Record<string, unknown> = {}): Promise<Host> {
  const saved: Record<string, string | undefined> = { PATH: process.env.PATH, PAL_DISPLAYS_OS: process.env.PAL_DISPLAYS_OS, PAL_DISPLAYS_BREW: process.env.PAL_DISPLAYS_BREW };
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  stored.clear();
  process.env.PATH = `${f.bin}:/usr/bin:/bin:${dirname(process.execPath)}`;
  process.env.PAL_DISPLAYS_OS = os;
  process.env.PAL_DISPLAYS_BREW = "";
  Object.assign(process.env, env);
  try {
    return await Host.bundled({ settings: { displays: { settings } }, core: { "windows.displays": () => [{ id: "2", frame: { x: 0, y: 0, w: 2560, h: 1440 }, visible_frame: { x: 0, y: 25, w: 2560, h: 1415 }, primary: true }, { id: "1", frame: { x: -1800, y: 271, w: 1800, h: 1169 }, visible_frame: { x: -1800, y: 296, w: 1800, h: 1144 }, primary: false }], "system.commands": () => [{ id: "sleep-displays", title: "Sleep Displays", subtitle: "", icon: "", keywords: [], destructive: false, available: true }] } });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

describe("displays: macOS with every tool", () => {
  let f: Fakes, host: Host;
  const dell = { args: { display: "2" } };
  const panel = { args: { display: "1" } };
  beforeAll(async () => { f = fakes(); host = await start(f, "darwin"); });
  afterAll(() => { host.kill(); rmSync(f.dir, { recursive: true, force: true }); });

  test("metadata: one live palette, the bar item with its rules and mocks, seven routes, no warnings", () => {
    const loaded = host.loaded().find((x) => x.extension === "displays")!;
    expect(loaded.warnings).toEqual([]);
    expect(loaded.palettes.map((p) => [p.name, p.live, p.input])).toEqual([["displays", true, false]]);
    expect(loaded.bar).toMatchObject([{ id: "brightness", refresh: { every: 60, on: ["wake", "show"] }, rules: [{ id: "laptop", hidden: true }, { id: "unsettable", hidden: true }], source: true }]);
    expect(Object.keys(loaded.bar[0].mocks!)).toEqual(["laptop", "external", "dim", "unreadable"]);
    expect(Object.keys(loaded.manifest.links!)).toEqual(["brightness", "contrast", "volume", "input", "mode", "preset", "night-shift"]);
  });

  test("root: a row per display with its mode, tags and level; Night Shift, Sleep displays, Save; no setup hints", async () => {
    const rows = await host.list("displays", "displays");
    expect(rows.map((r) => r.id)).toEqual(["display:2", "display:1", "night-shift", "sleep", "save"]);
    expect(rows[0]).toMatchObject({ name: "DELL U2720Q", subtitle: "2560×1440 @ 60 Hz · HiDPI · DisplayPort-DONGLETYPE-DP", accessories: [{ text: "70%" }, { tag: "main", color: "blue" }], section: "Displays", args: [{ id: "brightness" }] });
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "set-brightness", "copy-id"]);
    expect(rows[1]).toMatchObject({ name: "Built-in Liquid Retina XDR Display", subtitle: "1800×1169 @ 120 Hz · HiDPI", accessories: [{ text: "50%" }] });
    expect(rows[1].actions!.map((a) => a.id)).toEqual(["open", "set-brightness", "make-main", "copy-id"]);
    expect(rows[2]).toMatchObject({ name: "Night Shift", accessories: [{ tag: "on", color: "amber" }] });
    expect(rows.find((r) => r.section === "Setup")).toBeUndefined();
    expect(rows[1].detail).toMatchObject({ metadata: expect.arrayContaining([{ label: "Persistent id", value: BUILTIN }, { label: "Origin", value: "(-1800, 271)" }, { label: "Modes", value: "8 listed" }]) });
  });

  test("a display's level: the three controls with their levels, input, modes, mirror, rotation, main, sleep", async () => {
    const rows = await host.list("displays", "displays", "", dell);
    expect(rows.map((r) => r.id)).toEqual(["brightness", "contrast", "volume", "input", "modes", "mirror", "rotation", "sleep"]);
    expect(rows[0]).toMatchObject({ accessories: [{ text: "70%" }], args: [{ id: "level" }] });
    expect(rows[2]).toMatchObject({ name: "Volume", accessories: [{ text: "30%" }] });
    expect(rows[3].subtitle).toContain("m1ddc cannot read which is active");
    expect(rows[4].subtitle).toBe("4 modes; now 2560×1440 @ 60 Hz · HiDPI");
    const built = await host.list("displays", "displays", "", panel);
    expect(built.map((r) => r.id)).toEqual(["brightness", "modes", "mirror", "rotation", "main", "sleep"]);
    expect(built[0].subtitle).toContain("Never below 5%");
  });

  test("the slider: Enter opens it, the keys write through m1ddc, a click sets the clicked fraction", async () => {
    const opened = await host.pick("displays", "displays", "brightness", "slider", dell);
    const v = viewOf(opened);
    expect(v.id).toBe("brightness:2");
    expect(sliders(v)[0].value).toBe(0.7);
    clearLog(f);
    expect(sliders(viewOf(await host.pick("displays", "displays", "brightness:2", "up")))[0].value).toBe(0.75);
    expect(sliders(viewOf(await host.pick("displays", "displays", "brightness:2", "fine-down")))[0].value).toBe(0.74);
    expect(sliders(viewOf(await host.pick("displays", "displays", "brightness:2", "preset:30")))[0].value).toBe(0.3);
    expect(sliders(viewOf(await host.pick("displays", "displays", "brightness:2", "set", { values: { value: "0.62" } })))[0].value).toBe(0.62);
    expect(sliders(viewOf(await host.pick("displays", "displays", "brightness:2", "max")))[0].value).toBe(1);
    expect(logOf(f)).toEqual([`m1ddc display ${DELL} set luminance 75`, `m1ddc display ${DELL} set luminance 74`, `m1ddc display ${DELL} set luminance 30`, `m1ddc display ${DELL} set luminance 62`, `m1ddc display ${DELL} set luminance 100`]);
    await reset(f, host);
  });

  test("the built-in panel goes through the brightness CLI and never below the floor", async () => {
    clearLog(f);
    writeFileSync(join(f.dir, "cli-level"), "0.070000");
    expect(sliders(viewOf(await host.pick("displays", "displays", "brightness", "slider", panel)))[0].value).toBe(0.07);
    expect(sliders(viewOf(await host.pick("displays", "displays", "brightness:1", "down")))[0].value).toBe(0.05);
    expect(sliders(viewOf(await host.pick("displays", "displays", "brightness:1", "down")))[0].value).toBe(0.05);
    expect(logOf(f)).toEqual(["brightness -d 0 0.05", "brightness -d 0 0.05"]);
    // The typed argument on the root row: a step against the current level.
    clearLog(f);
    expect(await host.pick("displays", "displays", "display:1", "set-brightness", { values: { brightness: "+20" } })).toMatchObject({ keep: true, hud: "Built-in Liquid Retina XDR Display 25%" });
    expect(logOf(f)).toEqual(["brightness -d 0 0.25"]);
    // Bare (no values): the form, and a bad value comes back on it.
    expect(await host.pick("displays", "displays", "display:1", "set-brightness")).toMatchObject({ form: { id: "display:1", fields: [{ id: "brightness" }] } });
    expect(await host.pick("displays", "displays", "display:1", "set-brightness", { values: { brightness: "lots" } })).toMatchObject({ form: { errors: { brightness: expect.stringContaining("percent") } } });
    await reset(f, host);
  });

  test("modes: HiDPI first, the current tagged, a switch runs the whole arrangement with the new mode and leaves Undo", async () => {
    const rows = await host.list("displays", "displays", "", { args: { display: "2", level: "modes" } });
    expect(rows.map((r) => [r.name, r.section, r.accessories?.[0]])).toEqual([["3008×1692 @ 60 Hz", "HiDPI", { text: "60 Hz" }], ["2560×1440 @ 60 Hz", "HiDPI", { tag: "current", color: "green" }], ["1920×1080 @ 60 Hz", "HiDPI", { text: "60 Hz" }], ["3840×2160 @ 60 Hz", "Native", { text: "60 Hz" }]]);
    expect(rows[0].actions![0]).toMatchObject({ id: "apply", confirm: expect.stringContaining("3008×1692") });
    expect(rows[1].actions![0]).toEqual({ id: "apply", title: "Already this mode" });
    clearLog(f);
    expect(await host.pick("displays", "displays", "mode:3", "apply", { args: { display: "2", level: "modes" } })).toEqual({ hud: "DELL U2720Q: 3840×2160 @ 60 Hz" });
    expect(logOf(f)).toEqual([`displayplacer id:${BUILTIN} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(-1800,271) degree:0 id:${DELL} res:3840x2160 hz:60 color_depth:8 enabled:true scaling:off origin:(0,0) degree:0`]);
    const root = await host.list("displays", "displays");
    expect(root.find((r) => r.id === "undo")).toMatchObject({ name: "Undo: DELL U2720Q: 3840×2160 @ 60 Hz", section: "Recent" });
    clearLog(f);
    expect(await host.pick("displays", "displays", "undo", "apply")).toEqual({ hud: "Undid DELL U2720Q: 3840×2160 @ 60 Hz" });
    expect(logOf(f)).toEqual([`displayplacer id:${BUILTIN} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(-1800,271) degree:0 id:${DELL} res:2560x1440 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0`]);
    expect((await host.list("displays", "displays")).find((r) => r.id === "undo")).toBeUndefined();
    expect(await host.pick("displays", "displays", "mode:3", "copy-link", { args: { display: "2", level: "modes" } })).toMatchObject({ copy: "pal://displays/mode?display=2&mode=3" });
  });

  test("make main, mirror, stop mirroring, rotation", async () => {
    clearLog(f);
    expect(await host.pick("displays", "displays", "display:1", "make-main")).toEqual({ hud: "Built-in Liquid Retina XDR Display is main" });
    expect(await host.pick("displays", "displays", "mirror:2", "apply", { args: { display: "1", level: "mirror" } })).toEqual({ hud: "Built-in Liquid Retina XDR Display mirrors DELL U2720Q" });
    expect(await host.pick("displays", "displays", "rot:90", "apply", { args: { display: "2", level: "rotation" } })).toEqual({ hud: "DELL U2720Q rotated 90°" });
    expect(logOf(f)).toEqual([
      `displayplacer id:${BUILTIN} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0 id:${DELL} res:2560x1440 hz:60 color_depth:8 enabled:true scaling:on origin:(1800,-271) degree:0`,
      `displayplacer id:${DELL}+${BUILTIN} res:2560x1440 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0`,
      `displayplacer id:${BUILTIN} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(-1800,271) degree:0 id:${DELL} res:2560x1440 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:90`,
    ]);
    const rot = await host.list("displays", "displays", "", { args: { display: "1", level: "rotation" } });
    expect(rot.map((r) => [r.id, r.accessories?.length])).toEqual([["rot:0", 1], ["rot:90", 0], ["rot:180", 0], ["rot:270", 0]]);
    expect(rot[1].actions![0].confirm).toContain("crash");
    // Mirrored: the Dell's row says so and its level offers Stop mirroring.
    writeFileSync(join(f.dir, "displayplacer.txt"), DISPLAYPLACER_MIRRORED);
    const rows = await host.list("displays", "displays", "", { refresh: true });
    expect(rows[0]).toMatchObject({ name: "DELL U2720Q", accessories: [{ text: "70%" }, { tag: "mirror", color: "violet" }, { tag: "main", color: "blue" }] });
    expect(rows[1].accessories).toEqual([{ text: "50%" }, { tag: "mirrored", color: "violet" }]);
    const level = await host.list("displays", "displays", "", dell);
    expect(level.find((r) => r.id === "unmirror")?.subtitle).toContain("Mirrors Built-in");
    clearLog(f);
    expect(await host.pick("displays", "displays", "unmirror", "apply", dell)).toEqual({ hud: "DELL U2720Q no longer mirrors" });
    expect(logOf(f)).toEqual([`displayplacer id:${BUILTIN} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0 id:${DELL} res:2560x1440 hz:60 color_depth:8 enabled:true scaling:on origin:(1800,0) degree:0`]);
    await reset(f, host);
  });

  test("input source: the five, LG codes by the setting, a custom code through the form", async () => {
    const rows = await host.list("displays", "displays", "", { args: { display: "2", level: "input" } });
    expect(rows.map((r) => [r.id, r.subtitle])).toEqual([["input:dp1", "VCP 60 code 15"], ["input:dp2", "VCP 60 code 16"], ["input:hdmi1", "VCP 60 code 17"], ["input:hdmi2", "VCP 60 code 18"], ["input:usbc", "VCP 60 code 27"], ["input:custom", "A raw VCP 60 value from the monitor's manual"]]);
    clearLog(f);
    expect(await host.pick("displays", "displays", "input:hdmi1", "apply", { args: { display: "2", level: "input" } })).toEqual({ hud: "DELL U2720Q: HDMI 1" });
    expect(await host.pick("displays", "displays", "input:custom", "apply", { args: { display: "2", level: "input" } })).toMatchObject({ form: { id: "input:custom" } });
    expect(await host.pick("displays", "displays", "input:custom", "apply", { args: { display: "2", level: "input" }, values: { code: "18" } })).toEqual({ hud: "DELL U2720Q: code 18" });
    host.changeSettings("displays", { settings: { input_alt: true } });
    expect(await host.pick("displays", "displays", "input:hdmi1", "apply", { args: { display: "2", level: "input" } })).toEqual({ hud: "DELL U2720Q: HDMI 1" });
    expect(logOf(f)).toEqual([`m1ddc display ${DELL} set input 17`, `m1ddc display ${DELL} set input 18`, `m1ddc display ${DELL} set input-alt 144`]);
    host.changeSettings("displays", { settings: { input_alt: false } });
  });

  test("presets: save through the form, apply, rename, delete", async () => {
    expect(await host.pick("displays", "displays", "save", "save")).toMatchObject({ form: { id: "save", fields: [{ id: "name", required: true }] } });
    expect(await host.pick("displays", "displays", "save", "save", { values: { name: "Home desk" } })).toMatchObject({ keep: true, hud: "Saved “Home desk”" });
    expect(await host.pick("displays", "displays", "save", "save", { values: { name: "home desk" } })).toMatchObject({ form: { errors: { name: expect.stringContaining("has this name") } } });
    const rows = await host.list("displays", "displays");
    const preset = rows.find((r) => r.id === "preset:Home desk")!;
    expect(preset).toMatchObject({ name: "Home desk", section: "Presets", subtitle: expect.stringContaining("DELL U2720Q + Built-in Liquid Retina XDR Display") });
    expect(preset.actions!.map((a) => a.id)).toEqual(["apply", "rename", "update", "delete"]);
    expect(preset.detail?.markdown).toContain(`"id:${DELL} res:2560x1440`);
    clearLog(f);
    expect(await host.pick("displays", "displays", "preset:Home desk", "apply")).toEqual({ hud: "Applied “Home desk”" });
    expect(logOf(f)).toEqual([`displayplacer id:${BUILTIN} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(-1800,271) degree:0 id:${DELL} res:2560x1440 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0`]);
    expect(await host.pick("displays", "displays", "preset:Home desk", "rename")).toMatchObject({ form: { fields: [{ id: "name", default: "Home desk" }] } });
    expect(await host.pick("displays", "displays", "preset:Home desk", "rename", { values: { name: "Desk" } })).toMatchObject({ hud: "Renamed to “Desk”" });
    expect(await host.request<any>("link", { extension: "displays", route: "preset", params: { name: "desk" } })).toEqual({ hud: "Applied “Desk”" });
    await expect(host.request("link", { extension: "displays", route: "preset", params: { name: "Office" } })).rejects.toThrow("no preset “Office”");
    expect(await host.pick("displays", "displays", "preset:Desk", "delete")).toMatchObject({ hud: "Deleted “Desk”" });
    expect((await host.list("displays", "displays")).some((r) => r.id.startsWith("preset:"))).toBe(false);
  });

  test("bar: the external display's level on the strip, a card per display in the popover, keys and scroll", async () => {
    const item = await host.render("displays", "brightness");
    expect(item).toMatchObject({ icon: "\u{f00e0}", title: "70%", tooltip: "DELL U2720Q · 70% · 2560×1440 @ 60 Hz · HiDPI", scroll: { up: "scroll-up", down: "scroll-down" }, states: { brightness: 70, external: 1, count: 2, settable: true } });
    expect(item.empty).toMatchObject({ title: "70%" });
    const v = viewOf(item);
    expect(v.title).toBe("2 displays");
    expect(sliders(v).map((s) => [s.action, s.value])).toEqual([["set:2", 0.7], ["set:1", 0.5]]);
    expect(walk(v.tree).find((n) => n.selected)?.key).toBe("screen-2");
    // The cursor moves to the panel; right brightens the card the cursor is on; a scroll on the strip always acts on the bar's own display.
    expect(walk(viewOf(await host.barAction("displays", "brightness", "next")).tree).find((n) => n.selected)?.key).toBe("screen-1");
    clearLog(f);
    expect(sliders(viewOf(await host.barAction("displays", "brightness", "up"))).map((s) => s.value)).toEqual([0.7, 0.55]);
    expect(await host.barAction("displays", "brightness", "scroll-down")).toEqual({ keep: true, hud: "DELL U2720Q 65%" });
    expect(sliders(viewOf(await host.barAction("displays", "brightness", "set:2", { reason: "open", values: { value: "0.2" } }))).map((s) => s.value)).toEqual([0.2, 0.55]);
    expect(logOf(f)).toEqual(["brightness -d 0 0.55", `m1ddc display ${DELL} set luminance 65`, `m1ddc display ${DELL} set luminance 20`]);
    expect(await host.barAction("displays", "brightness", "open")).toEqual({ push: { extension: "displays", palette: "displays", args: { display: "1" }, title: "Built-in Liquid Retina XDR Display" } });
    expect(await host.barAction("displays", "brightness", "open-pal")).toEqual({ push: { extension: "displays", palette: "displays" } });
    expect(await host.barAction("displays", "brightness", "night")).toMatchObject({ hud: "Night Shift off" });
    // The item's setting (through the render's ctx) picks the strip's display, and a brightness link naming none follows the last one rendered.
    expect(await host.render("displays", "brightness", { reason: "load", settings: { display: "builtin" } })).toMatchObject({ title: "55%", tooltip: expect.stringContaining("Built-in") });
    expect(await host.request<any>("link", { extension: "displays", route: "brightness", params: { value: "55" } })).toEqual({ hud: "Built-in Liquid Retina XDR Display 55%" });
    expect(await host.render("displays", "brightness")).toMatchObject({ tooltip: expect.stringContaining("DELL") });
    await reset(f, host);
  });

  test("bar: a DDC read the monitor missed (m1ddc prints 0) is tried again, and never reported over a level already known", async () => {
    const miss = join(f.dir, "miss");
    try {
      writeFileSync(miss, "3");
      await host.list("displays", "displays", "", { refresh: true });
      expect(await host.render("displays", "brightness")).toMatchObject({ title: "70%" });
      await host.barAction("displays", "brightness", "set:2", { reason: "open", values: { value: "0.4" } });
      writeFileSync(miss, "99");
      await host.list("displays", "displays", "", { refresh: true });
      expect(await host.render("displays", "brightness")).toMatchObject({ title: "40%" });
    } finally { rmSync(miss, { force: true }); await reset(f, host); }
  });

  test("routes: brightness, contrast, volume, input, mode, night-shift", async () => {
    clearLog(f);
    const call = (route: string, params: Record<string, unknown>) => host.request<any>("link", { extension: "displays", route, params });
    expect(await call("brightness", { value: "+10" })).toEqual({ hud: "DELL U2720Q 80%" });
    expect(await call("brightness", { value: "40", display: "builtin" })).toEqual({ hud: "Built-in Liquid Retina XDR Display 40%" });
    expect(await call("contrast", { value: "-5" })).toEqual({ hud: "DELL U2720Q contrast 70%" });
    expect(await call("volume", { value: "0", display: "dell" })).toEqual({ hud: "DELL U2720Q volume 0%" });
    expect(await call("input", { source: "usb-c" })).toEqual({ hud: "DELL U2720Q: USB-C" });
    expect(await call("mode", { mode: "1920x1080", display: "2" })).toEqual({ hud: "DELL U2720Q: 1920×1080 @ 60 Hz · HiDPI" });
    expect(await call("night-shift", {})).toEqual({ hud: "Night Shift off" });
    expect(await call("night-shift", { state: "on" })).toEqual({ hud: "Night Shift on" });
    expect(logOf(f)).toEqual([`m1ddc display ${DELL} set luminance 80`, "brightness -d 0 0.40", `m1ddc display ${DELL} set contrast 70`, `m1ddc display ${DELL} set volume 0`, `m1ddc display ${DELL} set input 27`, `displayplacer id:${BUILTIN} res:1800x1169 hz:120 color_depth:8 enabled:true scaling:on origin:(-1800,271) degree:0 id:${DELL} res:1920x1080 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0`, "nightlight toggle", "nightlight on"]);
    await expect(call("brightness", { value: "much" })).rejects.toThrow("a percent or +10 / -10");
    await expect(call("brightness", { value: "50", display: "LG" })).rejects.toThrow("no display LG");
    await expect(call("contrast", { value: "50", display: "builtin" })).rejects.toThrow("contrast is a DDC control");
    await expect(call("input", { source: "scart" })).rejects.toThrow("source: hdmi1");
    await expect(call("mode", { mode: "640x480" })).rejects.toThrow("has no mode");
    await expect(call("night-shift", { state: "dim" })).rejects.toThrow("state: on, off or toggle");
  });
});

describe("displays: macOS with nothing installed", () => {
  let f: Fakes, host: Host;
  beforeAll(async () => {
    f = fakes();
    for (const tool of ["displayplacer", "brightness", "m1ddc", "nightlight"]) rmSync(join(f.bin, tool));
    host = await start(f, "darwin");
  });
  afterAll(() => { host.kill(); rmSync(f.dir, { recursive: true, force: true }); });

  test("the displays still list from system_profiler and the core's frames; setup rows say what to install; the bar hides by its states", async () => {
    const rows = await host.list("displays", "displays");
    // The DDC tool named is the machine's: m1ddc on Apple silicon, ddcctl on Intel (CI's runner).
    const ddc = process.arch === "arm64" ? "m1ddc" : "ddcctl";
    expect(rows.map((r) => r.id)).toEqual(["display:2", "display:1", "sleep", "hint:setup:displayplacer", "hint:setup:brightness", `hint:setup:${ddc}`]);
    expect(rows[0]).toMatchObject({ name: "DELL U2720Q", subtitle: "2560×1440 @ 60 Hz · HiDPI · DisplayPort-DONGLETYPE-DP", accessories: [{ tag: "main", color: "blue" }] });
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "copy-id"]);
    expect(rows[3]).toMatchObject({ subtitle: "brew install displayplacer", section: "Setup", actions: [{ id: "copy-install" }] });
    expect(rows[4].subtitle).toBe("brew install --HEAD brightness");
    expect(await host.pick("displays", "displays", `hint:setup:${ddc}`, "copy-install")).toMatchObject({ copy: `brew install ${ddc}` });
    const level = await host.list("displays", "displays", "", { args: { display: "2" } });
    expect(level.map((r) => r.id)).toEqual(["sleep", "hint:setup:displayplacer", `hint:setup:${ddc}`]);
    const item = await host.render("displays", "brightness");
    expect(item).toMatchObject({ states: { brightness: null, external: 1, count: 2, settable: false }, tooltip: `DELL U2720Q: brightness, contrast, volume and input need ${ddc} (brew install ${ddc})` });
    expect(item.title).toBeUndefined();
    const v = viewOf(item);
    expect(sliders(v)).toHaveLength(0);
    expect(texts(v).some((t) => t.includes("brew install --HEAD brightness"))).toBe(true);
    await expect(host.request("link", { extension: "displays", route: "mode", params: { mode: "1920x1080" } })).rejects.toThrow("displayplacer is missing");
    await expect(host.request("link", { extension: "displays", route: "brightness", params: { value: "50" } })).rejects.toThrow(`needs ${ddc}`);
  });
});

describe("displays: Linux on Hyprland", () => {
  let f: Fakes, host: Host;
  beforeAll(async () => {
    f = fakes();
    writeFileSync(join(f.dir, "hyprctl.json"), HYPRCTL);
    writeFileSync(join(f.dir, "detect.txt"), DDCUTIL_DETECT);
    writeFileSync(join(f.dir, "panel"), "40");
    fake(f, "hyprctl", `if [ "$1" = monitors ]; then cat "$DIR/hyprctl.json"; else printf 'hyprctl %s\\n' "$*" >> "$LOG"; fi`);
    fake(f, "brightnessctl", `case "$1" in -m) printf 'intel_backlight,backlight,%s,%s%%,24000\\n' "$(cat "$DIR/panel")" "$(cat "$DIR/panel")";; -q) printf '%s' "$3" | tr -d % > "$DIR/panel"; printf 'brightnessctl %s\\n' "$*" >> "$LOG";; esac`);
    writeFileSync(join(f.dir, "vcp10"), "70");
    fake(f, "ddcutil", `case "$1" in detect) cat "$DIR/detect.txt";; getvcp) case "$2" in 10) echo "VCP 10 C $(cat "$DIR/vcp10") 100";; 12) echo "VCP 12 C 75 100";; 62) echo "VCP 62 C 30 100";; 60) echo "VCP 60 SNC x0f";; esac;; setvcp) [ "$2" = 10 ] && printf '%s' "$3" > "$DIR/vcp10"; printf 'ddcutil %s\\n' "$*" >> "$LOG";; esac`);
    host = await start(f, "linux", { HYPRLAND_INSTANCE_SIGNATURE: "x" });
  });
  afterAll(() => { host.kill(); rmSync(f.dir, { recursive: true, force: true }); });

  test("outputs from hyprctl, the panel through brightnessctl, the Dell over ddcutil with its input read; a mode goes through hyprctl", async () => {
    const rows = await host.list("displays", "displays");
    expect(rows.map((r) => [r.id, r.name, r.subtitle, r.accessories])).toEqual([
      ["display:DP-1", "Dell Inc. DELL U2720Q ABC1234", "3840×2160 @ 60 Hz · HiDPI", [{ text: "70%" }, { tag: "main", color: "blue" }]],
      ["display:eDP-1", "BOE 0x0BCA", "2880×1800 @ 120 Hz · HiDPI", [{ text: "40%" }]],
      ["sleep", "Sleep displays", "Turn the screens off; System's own command", undefined],
      ["save", "Save current arrangement as…", "One hyprctl command per output, under a name", undefined],
    ]);
    const level = await host.list("displays", "displays", "", { args: { display: "DP-1" } });
    expect(level.map((r) => r.id)).toEqual(["brightness", "contrast", "volume", "input", "modes", "mirror", "rotation", "sleep"]);
    expect(level[3]).toMatchObject({ subtitle: "Now DisplayPort 1", accessories: [{ text: "DisplayPort 1" }] });
    const inputs = await host.list("displays", "displays", "", { args: { display: "DP-1", level: "input" } });
    expect(inputs[0].accessories).toEqual([{ tag: "current", color: "green" }]);
    clearLog(f);
    const call = (route: string, params: Record<string, unknown>) => host.request<any>("link", { extension: "displays", route, params });
    expect(await call("brightness", { value: "+10", display: "builtin" })).toEqual({ hud: "BOE 0x0BCA 50%" });
    expect(await call("brightness", { value: "55" })).toEqual({ hud: "Dell Inc. DELL U2720Q ABC1234 55%" });
    expect(await call("input", { source: "hdmi1" })).toEqual({ hud: "Dell Inc. DELL U2720Q ABC1234: HDMI 1" });
    expect(await host.pick("displays", "displays", "mode:2560x1440@59.95Hz", "apply", { args: { display: "DP-1", level: "modes" } })).toEqual({ hud: "Dell Inc. DELL U2720Q ABC1234: 2560×1440 @ 60 Hz" });
    expect(await host.pick("displays", "displays", "rot:90", "apply", { args: { display: "eDP-1", level: "rotation" } })).toEqual({ hud: "BOE 0x0BCA rotated 90°" });
    expect(logOf(f)).toEqual(["brightnessctl -q set 50%", "ddcutil setvcp 10 55 --display 1", "ddcutil setvcp 60 x11 --display 1", "hyprctl keyword monitor DP-1,2560x1440@60,1440x0,1.5", "hyprctl keyword monitor eDP-1,2880x1800@120,0x0,2,transform,1"]);
    const item = await host.render("displays", "brightness");
    expect(item).toMatchObject({ title: "55%", states: { brightness: 55, external: 1, count: 2, settable: true } });
    expect(sliders(viewOf(item)).map((s) => s.action)).toEqual(["set:DP-1", "set:eDP-1"]);
  });
});
