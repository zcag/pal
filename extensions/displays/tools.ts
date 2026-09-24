// The OS-facing half: which tools are installed, one snapshot of the
// screens (cached, since `displayplacer list` and `system_profiler` cost
// a few hundred ms together), and the reads and writes each backend
// answers for. macOS: `system_profiler` for the names without a tool,
// `displayplacer` for modes and arrangement, the `brightness` CLI for the
// built-in display (and Apple displays), `m1ddc` (Apple Silicon) or
// `ddcctl` (Intel) for DDC/CI on external monitors, `nightlight` for
// Night Shift. Linux: `hyprctl` / `wlr-randr` / `xrandr` for the
// outputs, `brightnessctl` for the panel, `ddcutil` for DDC.
// `PAL_DISPLAYS_OS` forces the platform and `PAL_DISPLAYS_BREW` the
// directories a shadowed `brightness` is looked for in (the tests set it
// empty).
import { exec, now, windows } from "@zcag/pal";
import { INPUTS, formatPlacements, mergeMac, parseBrightnessCli, parseBrightnessctl, parseDdcctl, parseDdcutilDetect, parseDdcutilVcp, parseDisplayplacer, parseHyprctl, parseM1ddcList, parseProfiler, parseWlrRandr, parseXrandr, splitQuoted, type InputId, type Placement, type Screen } from "./model.ts";

export const MAC = (process.env.PAL_DISPLAYS_OS ?? process.platform) === "darwin";
/** DDC is slow (a read is a round trip over the monitor's i2c), so each call gets its own budget. */
const DDC_MS = 4000, LIST_MS = 6000;
/** How long a snapshot stands: a plug-in shows within this, or at once on `⌘R`, a wake or a write. */
export const SNAPSHOT_TTL_MS = 20_000;
/** Brightness moves under the keyboard's keys too, so a reading is trusted only briefly. */
const LEVEL_TTL_MS = 3000;
const TOOLS_TTL_MS = 60_000;
/** A key that dims never blacks the built-in panel: a screen you cannot see is one you cannot fix from. */
export const BUILTIN_FLOOR = 5;

export type Compositor = "hyprctl" | "wlr-randr" | "xrandr";
export type Tools = { displayplacer?: string; brightness?: string; m1ddc?: string; ddcctl?: string; ddcutil?: string; brightnessctl?: string; nightlight?: string; compositor?: Compositor };
export type Control = "brightness" | "contrast" | "volume";
export const CONTROLS: Control[] = ["brightness", "contrast", "volume"];
/** The VCP codes of the three continuous controls and the input source. */
const VCP: Record<Control | "input", number> = { brightness: 0x10, contrast: 0x12, volume: 0x62, input: 0x60 };
const M1DDC: Record<Control, string> = { brightness: "luminance", contrast: "contrast", volume: "volume" };
const DDCCTL: Record<Control, string> = { brightness: "-b", contrast: "-c", volume: "-v" };

export type Snapshot = { screens: Screen[]; placements: Placement[]; tools: Tools; at: number };

const which = (name: string) => Bun.which(name) ?? undefined;
const out = async (argv: string[], ms = LIST_MS) => { const r = await exec(argv, { ms }); return r.code === 0 || r.out ? r.out : ""; };
const ok = async (argv: string[], ms = DDC_MS) => { const r = await exec(argv, { ms }); if (r.timedOut) throw new Error(`${argv[0]} did not answer in ${ms / 1000} s`); if (r.code !== 0) throw new Error(r.err.trim() || r.out.trim() || `${argv[0]} exited ${r.code}`); return r.out; };

/**
 * The `brightness` on PATH may be something else by that name (a shell
 * script of the user's), so the CLI is the first candidate whose `-l`
 * lists displays; Homebrew's is tried when PATH has none.
 */
async function brightnessCli(): Promise<string | undefined> {
  const brew = (process.env.PAL_DISPLAYS_BREW ?? "/opt/homebrew/bin:/usr/local/bin").split(":").filter(Boolean).map((d) => `${d}/brightness`);
  for (const c of [which("brightness"), ...brew]) {
    if (!c || !(await Bun.file(c).exists())) continue;
    const r = await exec([c, "-l"], { ms: 3000 });
    if (/^display \d+:/m.test(r.out)) return c;
  }
}

let toolsMemo: { at: number; value: Promise<Tools> } | undefined;
/** What is installed, re-checked every minute so a `brew install` lands without a restart. */
export function tools(fresh = false): Promise<Tools> {
  if (!fresh && toolsMemo && now() - toolsMemo.at < TOOLS_TTL_MS) return toolsMemo.value;
  const value = (async (): Promise<Tools> => {
    if (MAC) return { displayplacer: which("displayplacer"), brightness: await brightnessCli(), m1ddc: which("m1ddc"), ddcctl: which("ddcctl"), nightlight: which("nightlight") };
    const env = process.env;
    const compositor: Compositor | undefined = env.HYPRLAND_INSTANCE_SIGNATURE && which("hyprctl") ? "hyprctl" : env.WAYLAND_DISPLAY && which("wlr-randr") ? "wlr-randr" : which("hyprctl") ? "hyprctl" : which("xrandr") && env.DISPLAY ? "xrandr" : which("wlr-randr") ? "wlr-randr" : undefined;
    return { compositor, brightnessctl: which("brightnessctl"), ddcutil: which("ddcutil") };
  })();
  toolsMemo = { at: now(), value };
  return value;
}

let snapMemo: { at: number; value: Promise<Snapshot> } | undefined;
export function invalidate(): void { snapMemo = undefined; levels.clear(); }

/** The screens as they are, from a cache under `SNAPSHOT_TTL_MS` old unless `fresh`. */
export function snapshot(fresh = false): Promise<Snapshot> {
  if (!fresh && snapMemo && now() - snapMemo.at < SNAPSHOT_TTL_MS) return snapMemo.value;
  if (fresh) levels.clear();
  const value = (async () => {
    const t = await tools(fresh);
    const snap = MAC ? await macSnapshot(t) : await linuxSnapshot(t);
    return { ...snap, tools: t, at: now() };
  })();
  snapMemo = { at: now(), value };
  value.catch(() => { snapMemo = undefined; });
  return value;
}

async function macSnapshot(t: Tools): Promise<Omit<Snapshot, "tools" | "at">> {
  const [profiler, dp, ddc, cli] = await Promise.all([
    out(["system_profiler", "SPDisplaysDataType", "-json"]).then(parseProfiler),
    t.displayplacer ? out([t.displayplacer, "list"]).then(parseDisplayplacer) : undefined,
    t.m1ddc ? out([t.m1ddc, "display", "list", "detailed"]).then(parseM1ddcList) : [],
    t.brightness ? out([t.brightness, "-l"], 3000).then(parseBrightnessCli) : [],
  ]);
  const screens = mergeMac(profiler, dp, ddc);
  lastScreens = screens;
  for (const c of cli) {
    const s = c.id ? screens.find((x) => x.id === c.id) : undefined;
    if (s && c.level !== undefined) { s.cli = c.index; levels.set(`${s.id}/brightness`, { at: now(), value: c.level }); }
  }
  if (t.ddcctl && !t.m1ddc) {
    // ddcctl numbers the external displays 1.. in CoreGraphics' order; it has no listing of its own to correlate by.
    let i = 0;
    for (const s of screens) if (!s.builtin) s.ddc = String(++i);
  }
  // Without displayplacer, main and the frames come from what the core knows.
  if (!dp) {
    const frames = await windows.displays().catch(() => []);
    for (const f of frames) { const s = screens.find((x) => x.id === f.id); if (s) { s.origin = { x: f.frame.x, y: f.frame.y }; if (f.primary) s.main = true; } }
  }
  return { screens, placements: dp?.placements ?? [] };
}

async function linuxSnapshot(t: Tools): Promise<Omit<Snapshot, "tools" | "at">> {
  let screens: Screen[] = [];
  if (t.compositor === "hyprctl") screens = parseHyprctl(await out(["hyprctl", "monitors", "-j"]));
  else if (t.compositor === "wlr-randr") screens = parseWlrRandr(await out(["wlr-randr", "--json"]));
  else if (t.compositor === "xrandr") screens = parseXrandr(await out(["xrandr", "--query"]));
  for (const s of screens) for (const m of screens) if (m.mirrorOf === s.id) s.mirrors.push(m.id);
  if (!screens.some((s) => s.main) && screens.length) screens[0].main = true;
  if (t.ddcutil) {
    const found = parseDdcutilDetect(await out([t.ddcutil, "detect", "--brief"], LIST_MS));
    const externals = screens.filter((s) => !s.builtin);
    for (const [i, d] of found.entries()) {
      const s = (d.connector && externals.find((x) => x.id === d.connector)) || (d.model && externals.find((x) => x.name.includes(d.model!))) || externals.find((x) => !x.ddc) || externals[i];
      if (s) s.ddc = String(d.display);
    }
  }
  return { screens: screens.sort((a, b) => Number(b.main) - Number(a.main) || (a.origin?.x ?? 0) - (b.origin?.x ?? 0)), placements: [] };
}

// ---- levels ----------------------------------------------------------------

const levels = new Map<string, { at: number; value: number }>();
const maxes = new Map<string, number>();
/** Every level last read or written, kept through `invalidate()`: what an m1ddc read that only ever answered 0 falls back to. */
const known = new Map<string, number>();
/** How many times an m1ddc read is tried before its 0 is believed. */
const M1DDC_TRIES = 5;
/** The last snapshot's screens, so a bulk `brightness -l` can file every display's level. */
let lastScreens: Screen[] = [];

/** Whether `control` can be read and set on `s` with what is installed. */
export function settable(s: Screen, control: Control, t: Tools): boolean {
  if (control === "brightness") {
    if (MAC) return s.cli !== undefined || (!!s.ddc && !!(t.m1ddc || t.ddcctl));
    return s.builtin ? !!t.brightnessctl : !!s.ddc && !!t.ddcutil;
  }
  return !s.builtin && !!s.ddc && !!(MAC ? t.m1ddc || t.ddcctl : t.ddcutil);
}

/** A DDC read: the current value and the maximum, through whichever tool is there. */
async function ddcRead(s: Screen, control: Control, t: Tools): Promise<{ current: number; max: number; missed?: boolean } | undefined> {
  if (!s.ddc) return;
  if (t.m1ddc) {
    // m1ddc zeroes its reply buffer and never checks the monitor's answer, so a read the monitor missed prints 0 and exits 0;
    // a Dell U2724DE misses about two in three. A reading counts once it is in 1..max, and a 0 only after every try said so.
    const m1 = async (verb: string, fits: (n: number) => boolean) => {
      for (let i = 0; i < M1DDC_TRIES; i++) { const n = Number((await ok([t.m1ddc!, "display", s.ddc!, verb, M1DDC[control]])).trim()); if (fits(n)) return n; }
    };
    const key = `${s.id}/${control}`;
    let max = maxes.get(key);
    if (max === undefined) { max = await m1("max", (n) => n > 0); if (max !== undefined) maxes.set(key, max); }
    const cur = await m1("get", (n) => n > 0 && n <= (max ?? 100));
    return { current: cur ?? 0, max: max ?? 100, missed: cur === undefined };
  }
  if (t.ddcctl) return parseDdcctl(await out([t.ddcctl, "-d", s.ddc, DDCCTL[control], "?"], DDC_MS));
  if (t.ddcutil) return parseDdcutilVcp(await out([t.ddcutil, "getvcp", VCP[control].toString(16), "--brief", "--display", s.ddc], DDC_MS));
}

/** The level of `control` on `s` as a percent, or undefined when nothing can read it; cached for `LEVEL_TTL_MS`. */
export async function read(s: Screen, control: Control, t: Tools): Promise<number | undefined> {
  const key = `${s.id}/${control}`;
  const hit = levels.get(key);
  if (hit && now() - hit.at < LEVEL_TTL_MS) return hit.value;
  let value: number | undefined;
  try {
    if (control === "brightness" && MAC && s.cli !== undefined && t.brightness) {
      const all = parseBrightnessCli(await out([t.brightness, "-l"], 3000));
      // One `-l` lists every display it reads, so the others' levels land in the cache with this one.
      for (const c of all) { const x = c.id && lastScreens.find((y) => y.id === c.id); if (x && c.level !== undefined) levels.set(`${x.id}/brightness`, { at: now(), value: c.level }); }
      value = all.find((c) => c.index === s.cli)?.level;
    } else if (control === "brightness" && !MAC && s.builtin && t.brightnessctl) {
      value = parseBrightnessctl(await out([t.brightnessctl, "-m"], 3000));
    } else if (settable(s, control, t)) {
      const r = await ddcRead(s, control, t);
      if (r?.missed && known.has(key)) value = known.get(key);
      else if (r && r.max > 0) value = Math.round((r.current / r.max) * 100);
    }
  } catch { value = undefined; }
  if (value !== undefined) { levels.set(key, { at: now(), value }); known.set(key, value); }
  return value;
}

/** Set `control` on `s` to `percent` (already clamped by the caller); throws with the tool's complaint. */
export async function write(s: Screen, control: Control, percent: number, t: Tools): Promise<void> {
  const key = `${s.id}/${control}`;
  if (control === "brightness" && MAC && s.cli !== undefined && t.brightness) await ok([t.brightness, "-d", String(s.cli), (percent / 100).toFixed(2)]);
  else if (control === "brightness" && !MAC && s.builtin && t.brightnessctl) await ok([t.brightnessctl, "-q", "set", `${percent}%`]);
  else if (s.ddc && MAC && t.m1ddc) {
    const max = maxes.get(key) ?? 100;
    await ok([t.m1ddc, "display", s.ddc, "set", M1DDC[control], String(Math.round((percent * max) / 100))]);
  } else if (s.ddc && MAC && t.ddcctl) await ok([t.ddcctl, "-d", s.ddc, DDCCTL[control], String(percent)]);
  else if (s.ddc && !MAC && t.ddcutil) await ok([t.ddcutil, "setvcp", VCP[control].toString(16), String(percent), "--display", s.ddc]);
  else throw new Error(`nothing installed can set ${control} on ${s.name}`);
  levels.set(key, { at: now(), value: percent });
  known.set(key, percent);
}

/** The input source of `s` as a VCP code, where the tool can read it (ddcctl and ddcutil; m1ddc only sets). */
export async function readInput(s: Screen, t: Tools): Promise<number | undefined> {
  if (!s.ddc || s.builtin) return;
  try {
    if (MAC && t.ddcctl) return parseDdcctl(await out([t.ddcctl, "-d", s.ddc, "-i", "?"], DDC_MS))?.current;
    if (!MAC && t.ddcutil) return parseDdcutilVcp(await out([t.ddcutil, "getvcp", "60", "--brief", "--display", s.ddc], DDC_MS))?.current;
  } catch { return; }
}

/** Switch `s` to an input: one of `INPUTS` (its standard code, or LG's alternate with `alt`) or a raw VCP 60 code. */
export async function setInput(s: Screen, source: InputId | number, t: Tools, alt = false): Promise<void> {
  if (!s.ddc || s.builtin) throw new Error(`${s.name} takes no input source over DDC`);
  const entry = typeof source === "string" ? INPUTS.find((i) => i.id === source) : undefined;
  const code = typeof source === "number" ? source : alt ? entry!.alt : entry!.code;
  if (MAC && t.m1ddc) await ok([t.m1ddc, "display", s.ddc, "set", alt && typeof source === "string" ? "input-alt" : "input", String(code)]);
  else if (MAC && t.ddcctl) await ok([t.ddcctl, "-d", s.ddc, "-i", String(code)]);
  else if (!MAC && t.ddcutil) await ok([t.ddcutil, "setvcp", "60", `x${code.toString(16)}`, "--display", s.ddc]);
  else throw new Error("no DDC tool is installed");
}

// ---- arrangement -----------------------------------------------------------

/** Whether modes, rotation, mirroring and presets can be applied on this machine. */
export const canArrange = (t: Tools): boolean => !!(MAC ? t.displayplacer : t.compositor);

const rotateWord = (deg: number) => ({ 0: "normal", 90: "90", 180: "180", 270: "270" }[deg] ?? "normal");
const xrandrRotate = (deg: number) => ({ 0: "normal", 90: "left", 180: "inverted", 270: "right" }[deg] ?? "normal");

/** One argv per output that reproduces `s` as it is (Linux); the whole snapshot's is the preset. */
function linuxArgv(s: Screen, t: Tools, over: Partial<Screen> = {}): string[] {
  const x = { ...s, ...over };
  const mode = `${x.w}x${x.h}${x.hz ? `@${x.hz}` : ""}`;
  const pos = `${x.origin?.x ?? 0}x${x.origin?.y ?? 0}`;
  if (t.compositor === "hyprctl") return ["hyprctl", "keyword", "monitor", [x.id, x.enabled === false ? "disable" : mode, ...(x.mirrorOf ? ["auto", String(x.scale ?? 1), "mirror", x.mirrorOf] : [pos, String(x.scale ?? 1), ...(x.rotation ? ["transform", String([0, 90, 180, 270].indexOf(x.rotation))] : [])])].join(",")];
  if (t.compositor === "wlr-randr") return ["wlr-randr", "--output", x.id, ...(x.enabled === false ? ["--off"] : ["--on", "--mode", `${mode}Hz`, "--pos", `${x.origin?.x ?? 0},${x.origin?.y ?? 0}`, "--scale", String(x.scale ?? 1), "--transform", rotateWord(x.rotation ?? 0)])];
  return ["xrandr", "--output", x.id, ...(x.enabled === false ? ["--off"] : ["--mode", `${x.w}x${x.h}`, ...(x.hz ? ["--rate", String(x.hz)] : []), "--pos", pos, "--rotate", xrandrRotate(x.rotation ?? 0), ...(x.main ? ["--primary"] : []), ...(x.mirrorOf ? ["--same-as", x.mirrorOf] : [])])];
}

/** The commands that reproduce the arrangement as it is now: displayplacer's own line, or one command per output on Linux. */
export function reproduce(snap: Snapshot): string[][] {
  if (MAC) return snap.placements.length ? [formatPlacements(snap.placements)] : [];
  return snap.screens.map((s) => linuxArgv(s, snap.tools));
}

/** The commands for the same arrangement with one screen changed (`over`); macOS callers pass the new placements instead. */
export function changed(snap: Snapshot, s: Screen, over: Partial<Screen>): string[][] {
  return [linuxArgv(s, snap.tools, over)];
}

/** Run an arrangement: each argv in turn; a displayplacer line pasted from its output is split on its quotes first. */
export async function apply(argv: string[][], t: Tools): Promise<void> {
  for (const a of argv) {
    const [cmd, ...args] = a.length === 1 && a[0].startsWith("displayplacer ") ? ["displayplacer", ...splitQuoted(a[0])] : a;
    const bin = cmd === "displayplacer" ? t.displayplacer : which(cmd);
    if (!bin) throw new Error(`${cmd} is not installed`);
    await ok([bin, ...args], 15_000);
  }
  invalidate();
}

// ---- Night Shift -----------------------------------------------------------

/** `nightlight status` → on/off; undefined without the tool. */
export async function nightShift(t: Tools): Promise<boolean | undefined> {
  if (!t.nightlight) return;
  const s = (await out([t.nightlight, "status"], 3000)).trim().toLowerCase();
  return s ? s.startsWith("on") : undefined;
}
export async function setNightShift(t: Tools, state: "on" | "off" | "toggle"): Promise<boolean> {
  if (!t.nightlight) throw new Error("nightlight is not installed (brew install smudge/smudge/nightlight)");
  await ok([t.nightlight, state]);
  return (await nightShift(t)) ?? state === "on";
}
