// Displays: one row per screen at the root (its mode, main and mirror
// tags, its brightness), Enter drilling into the screen's controls
// (brightness, contrast and volume as slider views, the input source,
// every mode, rotation, mirroring, make main), arrangement presets saved
// from displayplacer's own reproduce line, and a bar item with a slider
// per screen. tools.ts runs the tools, model.ts parses them, view.ts
// draws; this file is the palette, the bar item and the routes.
import { ago, argsForm, bar, errorMessage, failed, hint, now, settings, storage, system, toast, type Action, type Arg, type BarCtx, type BarItem, type Ctx, type Effect, type Extension, type Item, type LinkParams, type Metadata } from "@zcag/pal";
import { INPUTS, findMode, formatArgv, formatPlacements, levelFrom, modeText, parseInput, withMain, withMirror, withMode, withRotation, withoutMirror, type InputId, type Mode, type Screen } from "./model.ts";
import { BUILTIN_FLOOR, CONTROLS, MAC, apply, canArrange, changed as linuxChange, invalidate, nightShift, read, readInput, reproduce, setInput, setNightShift, settable, snapshot, write, type Control, type Snapshot, type Tools } from "./tools.ts";
import { CONTROL_TITLE, GLYPH, brightnessGlyph, modeLine, popover, screenGlyph, sliderView, type PopoverState, type SliderState } from "./view.ts";

type Settings = { step: number; bar_display: "external" | "main" | "builtin"; input_alt: boolean };
/** One saved arrangement: the commands that reproduce it (`tools.reproduce`) and the screens it had, for the subtitle. */
type Preset = { name: string; saved: number; argv: string[][]; displays: string[] };
/** The arrangement before the last change, so Undo is one row. */
type Undo = { argv: string[][]; what: string; at: number };
type Args = { display?: string; level?: "modes" | "input" | "rotation" | "mirror" };

const EXT = "displays";
const settingsOf = () => settings.get<Settings>();
const BRIGHTNESS_ARGS: Arg[] = [{ id: "brightness", placeholder: "Brightness % or +10", kind: "text" }];
const NAME_ARGS: Arg[] = [{ id: "name", placeholder: "Preset name", required: true }];
const INSTALL = {
  displayplacer: "brew install displayplacer",
  brightness: "brew install --HEAD brightness",
  m1ddc: "brew install m1ddc",
  ddcctl: "brew install ddcctl",
  nightlight: "brew install smudge/smudge/nightlight",
  ddcutil: "apt install ddcutil",
  brightnessctl: "apt install brightnessctl",
};
const ROTATIONS = [0, 90, 180, 270];

const floorOf = (s: Screen) => (s.builtin ? BUILTIN_FLOOR : 0);
const argsOf = (ctx?: Ctx): Args => (ctx?.args && typeof ctx.args === "object" ? (ctx.args as Args) : {});
const presets = async (): Promise<Preset[]> => (await storage.get<Preset[]>("presets", EXT)) ?? [];
const undoStored = () => storage.get<Undo>("undo", EXT);

/** `main`, `external`, `builtin` (or `internal`, `built-in`), an id, a persistent id, or part of a name, case blind; `fallback` when nothing is named. */
export function resolveScreen(screens: Screen[], spec: string | undefined, fallback: "main" | "external" | "builtin"): Screen | undefined {
  const want = (spec ?? fallback).trim().toLowerCase();
  const externals = screens.filter((s) => !s.builtin);
  if (want === "main" || want === "primary") return screens.find((s) => s.main) ?? screens[0];
  if (want === "external") return externals[0] ?? (spec ? undefined : screens[0]);
  if (want === "builtin" || want === "built-in" || want === "internal") return screens.find((s) => s.builtin) ?? (spec ? undefined : screens[0]);
  return screens.find((s) => s.id === want || s.uuid?.toLowerCase() === want) ?? screens.find((s) => s.name.toLowerCase() === want) ?? screens.find((s) => s.name.toLowerCase().includes(want));
}

/** The screen the bar item speaks for, by the setting; the main one when the setting names a kind that is not there. */
const barScreen = (snap: Snapshot): Screen | undefined => resolveScreen(snap.screens, undefined, settingsOf().bar_display) ?? snap.screens.find((s) => s.main) ?? snap.screens[0];

/** One tool that is missing: which, what it would add, and which kind of screen it is about (`arrange` is about none). */
type Gap = { id: keyof typeof INSTALL; what: string; about: "arrange" | "builtin" | "external" };
/** What is missing for the screens there are, as install hints; empty when everything that could be set can be. */
function missing(snap: Snapshot): Gap[] {
  const t = snap.tools;
  const out: Gap[] = [];
  const externals = snap.screens.filter((s) => !s.builtin);
  if (MAC) {
    if (!t.displayplacer) out.push({ id: "displayplacer", what: "Resolution, rotation, mirroring and presets need displayplacer", about: "arrange" });
    if (snap.screens.some((s) => s.builtin && s.cli === undefined)) out.push({ id: "brightness", what: t.brightness ? "The brightness CLI cannot read the built-in display; on Apple Silicon it needs the HEAD build" : "Built-in brightness needs the brightness CLI (the HEAD build on Apple Silicon)", about: "builtin" });
    if (externals.some((s) => s.cli === undefined) && !t.m1ddc && !t.ddcctl) out.push({ id: process.arch === "arm64" ? "m1ddc" : "ddcctl", what: `${externals.find((s) => s.cli === undefined)!.name}: brightness, contrast, volume and input need ${process.arch === "arm64" ? "m1ddc" : "ddcctl"}`, about: "external" });
  } else {
    if (!t.compositor) out.push({ id: "displayplacer", what: "No hyprctl, wlr-randr or xrandr on PATH: nothing lists the outputs", about: "arrange" });
    if (snap.screens.some((s) => s.builtin) && !t.brightnessctl) out.push({ id: "brightnessctl", what: "The panel's brightness needs brightnessctl", about: "builtin" });
    if (externals.length && !t.ddcutil) out.push({ id: "ddcutil", what: `${externals[0].name}: brightness, contrast, volume and input need ddcutil`, about: "external" });
  }
  return out;
}
const setupRows = (snap: Snapshot): Item[] => missing(snap).map((m) => hint(`setup:${m.id}`, m.what, INSTALL[m.id] === "apt install ddcutil" || INSTALL[m.id] === "apt install brightnessctl" ? `${INSTALL[m.id]} (or your distribution's package)` : INSTALL[m.id], { icon: GLYPH.tools, section: "Setup", actions: [{ id: "copy-install", title: "Copy the install command" }] }));

// ---- rows ------------------------------------------------------------------

const meta = (pairs: [string, string | undefined][]): Metadata[] => pairs.filter((x): x is [string, string] => !!x[1]).map(([label, value]) => ({ label, value }));

function screenRow(s: Screen, snap: Snapshot, level: number | undefined): Item {
  const t = snap.tools;
  const can = settable(s, "brightness", t);
  const accessories: Item["accessories"] = [];
  if (level !== undefined) accessories.push({ text: `${level}%` });
  if (s.mirrorOf) accessories.push({ tag: "mirror", color: "violet" });
  if (s.mirrors.length) accessories.push({ tag: "mirrored", color: "violet" });
  if (s.main) accessories.push({ tag: "main", color: "blue" });
  const actions: Action[] = [{ id: "open", title: "Open" }];
  if (can) actions.push({ id: "set-brightness", title: "Set brightness", shortcut: "cmd+b", args: true });
  if (canArrange(t) && !s.main && !s.mirrorOf) actions.push({ id: "make-main", title: "Make main", shortcut: "cmd+shift+m" });
  actions.push({ id: "copy-id", title: "Copy display id", shortcut: "cmd+c" });
  return {
    id: `display:${s.id}`,
    name: s.name,
    subtitle: modeLine(s),
    icon: screenGlyph(s),
    keywords: [s.builtin ? "builtin" : "external", "display", "screen", "monitor", ...(s.main ? ["main"] : [])],
    accessories,
    ...(can && { args: BRIGHTNESS_ARGS }),
    actions,
    section: "Displays",
    detail: { metadata: meta([
      ["Display", s.name], ["Id", s.id], ["Persistent id", s.uuid], ["Connection", s.connection],
      ["Mode", s.w && s.h ? modeText(s) : undefined], ["Pixels", s.pixels ? `${s.pixels.w}×${s.pixels.h}` : undefined],
      ["Rotation", s.rotation === undefined ? undefined : `${s.rotation}°`], ["Origin", s.origin ? `(${s.origin.x}, ${s.origin.y})` : undefined],
      ["Main", s.main ? "yes" : "no"], ["Mirroring", s.mirrorOf ? snap.screens.find((x) => x.id === s.mirrorOf)?.name : s.mirrors.length ? `mirrored by ${s.mirrors.map((m) => snap.screens.find((x) => x.id === m)?.name ?? m).join(", ")}` : undefined],
      ["Brightness", level === undefined ? (can ? "unread" : "not settable from here") : `${level}%`],
      ["DDC", s.ddc ? (t.m1ddc ? "m1ddc" : t.ddcctl ? "ddcctl" : "ddcutil") : undefined], ["Modes", s.modes.length ? `${s.modes.length} listed` : undefined],
    ]) },
  };
}

async function rootRows(snap: Snapshot): Promise<Item[]> {
  const t = snap.tools;
  const rows: Item[] = [];
  const levels = await Promise.all(snap.screens.map((s) => (settable(s, "brightness", t) ? read(s, "brightness", t) : undefined)));
  for (const [i, s] of snap.screens.entries()) rows.push(screenRow(s, snap, levels[i]));
  if (!snap.screens.length) rows.push(hint("none", "No displays listed", MAC ? "system_profiler answered nothing" : "No compositor tool answered; see Setup below", { icon: GLYPH.monitor, section: "Displays" }));
  const night = await nightShift(t);
  if (night !== undefined) rows.push({ id: "night-shift", name: "Night Shift", subtitle: night ? "On: warmer colours until it is turned off or its schedule ends" : "Off", icon: GLYPH.night, keywords: ["nightlight", "warm", "blue light"], accessories: [{ tag: night ? "on" : "off", color: night ? "amber" : "grey" }], section: "Screen", actions: [{ id: "toggle", title: night ? "Turn off" : "Turn on" }] });
  const sleep = (await system.commands().catch(() => [])).find((c) => c.id === "sleep-displays");
  if (sleep?.available) rows.push({ id: "sleep", name: "Sleep displays", subtitle: "Turn the screens off; System's own command", icon: GLYPH.sleep, keywords: ["off", "screen"], section: "Screen", actions: [{ id: "run", title: "Sleep displays" }] });
  const undo = await undoStored();
  if (undo && canArrange(t)) rows.push({ id: "undo", name: `Undo: ${undo.what}`, subtitle: `Back to the arrangement of ${ago(undo.at)}`, icon: GLYPH.undo, keywords: ["undo", "revert", "back"], section: "Recent", actions: [{ id: "apply", title: "Undo" }, { id: "forget", title: "Forget", shortcut: "cmd+backspace", style: "destructive" }] });
  for (const p of await presets()) rows.push({
    id: `preset:${p.name}`, name: p.name, subtitle: `${p.displays.join(" + ")} · saved ${ago(p.saved)}`, icon: GLYPH.preset, keywords: ["preset", "arrangement", "layout"], section: "Presets",
    actions: [{ id: "apply", title: "Apply", ...(!canArrange(t) && { confirm: `Nothing installed can apply an arrangement (${MAC ? "displayplacer" : "a compositor tool"} is missing). Try anyway?` }) }, { id: "rename", title: "Rename", shortcut: "cmd+r" }, { id: "update", title: "Overwrite with the current arrangement", shortcut: "cmd+s", confirm: `Replace “${p.name}” with the arrangement as it is now?` }, { id: "delete", title: "Delete", shortcut: "cmd+backspace", style: "destructive", confirm: `Delete the preset “${p.name}”?` }],
    detail: { markdown: `\`\`\`\n${p.argv.map(formatArgv).join("\n")}\n\`\`\``, metadata: meta([["Displays", p.displays.join(", ")], ["Saved", ago(p.saved)]]) },
  });
  if (canArrange(t)) rows.push({ id: "save", name: "Save current arrangement as…", subtitle: MAC ? "displayplacer's line for the arrangement as it is now, under a name" : `One ${t.compositor} command per output, under a name`, icon: GLYPH.save, keywords: ["preset", "save", "arrangement"], section: "Presets", args: NAME_ARGS, actions: [{ id: "save", title: "Save", args: true }] });
  rows.push(...setupRows(snap));
  return rows;
}

/** The rows of one screen's level: its controls, then what can be arranged. */
async function screenRows(s: Screen, snap: Snapshot): Promise<Item[]> {
  const t = snap.tools;
  const rows: Item[] = [];
  const glyph: Record<Control, string> = { brightness: GLYPH.mid, contrast: GLYPH.contrast, volume: GLYPH.volume };
  for (const c of CONTROLS) {
    if (!settable(s, c, t)) continue;
    const level = await read(s, c, t);
    if (level === undefined && c !== "brightness") continue; // a monitor without speakers answers nothing for volume: no row rather than a dead one
    rows.push({
      id: c, name: CONTROL_TITLE[c], subtitle: level === undefined ? "Could not be read; Enter tries again" : c === "brightness" && s.builtin ? `Never below ${BUILTIN_FLOOR}% from here, so the screen stays readable` : "A slider with keys; ⌘= and ⌘- from this row",
      icon: c === "brightness" ? brightnessGlyph(level) : glyph[c], keywords: [c, "level"], section: "Controls",
      accessories: level === undefined ? [{ tag: "unread", color: "grey" }] : [{ text: `${level}%` }],
      ...(level !== undefined && { args: [{ id: "level", placeholder: `${CONTROL_TITLE[c]} % or +10`, kind: "text" }] as Arg[] }),
      actions: [{ id: "slider", title: `Open ${CONTROL_TITLE[c].toLowerCase()}` }, ...(level === undefined ? [] : [{ id: "set", title: `Set ${CONTROL_TITLE[c].toLowerCase()}`, shortcut: "cmd+b", args: true }, { id: "up", title: `Up ${settingsOf().step}%`, shortcut: "cmd+=" }, { id: "down", title: `Down ${settingsOf().step}%`, shortcut: "cmd+-" }] as Action[])],
    });
  }
  if (!s.builtin && s.ddc && (t.m1ddc || t.ddcctl || t.ddcutil)) {
    const cur = await readInput(s, t);
    const name = cur === undefined ? undefined : INPUTS.find((i) => i.code === cur || i.alt === cur)?.title ?? `code ${cur}`;
    rows.push({ id: "input", name: "Input source", subtitle: name ? `Now ${name}` : t.m1ddc ? "HDMI, DisplayPort, USB-C; m1ddc cannot read which is active" : "HDMI, DisplayPort, USB-C", icon: GLYPH.input, keywords: ["hdmi", "displayport", "usb-c", "source"], section: "Controls", ...(name && { accessories: [{ text: name }] }), actions: [{ id: "open", title: "Choose an input" }] });
  }
  if (canArrange(t) && s.modes.length) {
    const cur = s.modes.find((m) => m.current);
    rows.push({ id: "modes", name: "Resolution & scaling", subtitle: `${s.modes.length} modes; ${cur ? `now ${modeText(cur)}` : s.w ? `now ${modeText(s)}` : ""}`.replace(/; $/, ""), icon: GLYPH.modes, keywords: ["resolution", "hidpi", "retina", "refresh", "hz", "scaling", "dpi"], section: "Arrangement", actions: [{ id: "open", title: "Choose a mode" }] });
  }
  if (canArrange(t)) {
    if (s.mirrorOf) rows.push({ id: "unmirror", name: "Stop mirroring", subtitle: `Mirrors ${snap.screens.find((x) => x.id === s.mirrorOf)?.name ?? s.mirrorOf}; becomes its own screen to the right`, icon: GLYPH.mirror, keywords: ["mirror", "extend"], section: "Arrangement", actions: [{ id: "apply", title: "Stop mirroring" }] });
    else if (snap.screens.length > 1) rows.push({ id: "mirror", name: "Mirror with…", subtitle: s.mirrors.length ? `Mirrored by ${s.mirrors.map((m) => snap.screens.find((x) => x.id === m)?.name ?? m).join(", ")}` : "Show the same picture as another display", icon: GLYPH.mirror, keywords: ["mirror", "duplicate"], section: "Arrangement", actions: [{ id: "open", title: "Choose a display" }] });
    rows.push({ id: "rotation", name: "Rotation", subtitle: `Now ${s.rotation ?? 0}°${s.builtin && MAC ? "; displayplacer warns that rotating the built-in screen can crash the machine" : ""}`, icon: GLYPH.rotate, keywords: ["rotate", "portrait", "landscape"], section: "Arrangement", accessories: [{ text: `${s.rotation ?? 0}°` }], actions: [{ id: "open", title: "Choose a rotation" }] });
    if (!s.main && !s.mirrorOf) rows.push({ id: "main", name: "Make main", subtitle: "The menu bar and (0,0) move here; the layout is kept", icon: GLYPH.main, keywords: ["primary", "main"], section: "Arrangement", actions: [{ id: "apply", title: "Make main" }] });
  }
  const sleep = (await system.commands().catch(() => [])).find((c) => c.id === "sleep-displays");
  if (sleep?.available) rows.push({ id: "sleep", name: "Sleep displays", subtitle: "Every screen off; System's own command", icon: GLYPH.sleep, section: "Screen", actions: [{ id: "run", title: "Sleep displays" }] });
  rows.push(...setupRows({ ...snap, screens: [s] }));
  if (!rows.length) rows.push(hint("nothing", "Nothing to set on this display", "No tool installed reaches it", { icon: screenGlyph(s) }));
  return rows;
}

const modeRow = (s: Screen, m: Mode): Item => {
  const cur = s.modes.find((x) => x.current);
  const changes = !cur || cur.w !== m.w || cur.h !== m.h || !!cur.hidpi !== !!m.hidpi;
  return {
    // macOS modes carry the scaling; a Linux mode is pixels and the compositor's scale factor stays what it is.
    id: `mode:${m.id}`, name: modeText({ w: m.w, h: m.h, hz: m.hz }), subtitle: !MAC ? `The scale stays ${s.scale ?? 1}×` : m.hidpi ? `HiDPI: looks like ${m.w}×${m.h}, drawn at ${m.w * 2}×${m.h * 2}` : `Native pixels${m.depth ? ` · ${m.depth}-bit` : ""}`,
    icon: GLYPH.modes, keywords: [`${m.w}x${m.h}`, m.hidpi ? "hidpi" : "native", ...(m.hz ? [`${m.hz}hz`] : [])], section: !MAC ? "Modes" : m.hidpi ? "HiDPI" : "Native",
    accessories: m.current ? [{ tag: "current", color: "green" }] : m.hz ? [{ text: `${m.hz} Hz` }] : [],
    actions: [{ id: "apply", title: m.current ? "Already this mode" : "Switch to this mode", ...(changes && !m.current && { confirm: `Switch ${s.name} to ${modeText(m)}? The arrangement before is kept under Undo in Displays.` }) }, { id: "copy-link", title: "Copy link", shortcut: "cmd+c" }],
  };
};
const modeRows = (s: Screen): Item[] => [...s.modes].sort((a, b) => Number(!!b.hidpi) - Number(!!a.hidpi) || b.w - a.w || b.h - a.h || (b.hz ?? 0) - (a.hz ?? 0)).map((m) => modeRow(s, m));

async function inputRows(s: Screen, t: Tools): Promise<Item[]> {
  const cur = await readInput(s, t);
  const alt = settingsOf().input_alt;
  return [
    ...INPUTS.map((i): Item => ({ id: `input:${i.id}`, name: i.title, subtitle: `VCP 60 code ${alt ? i.alt : i.code}`, icon: GLYPH.input, keywords: [i.id], accessories: cur !== undefined && (cur === i.code || cur === i.alt) ? [{ tag: "current", color: "green" }] : [], actions: [{ id: "apply", title: `Switch to ${i.title}` }, { id: "copy-link", title: "Copy link", shortcut: "cmd+c" }] })),
    { id: "input:custom", name: "Another code…", subtitle: "A raw VCP 60 value from the monitor's manual", icon: GLYPH.input, args: [{ id: "code", placeholder: "Code", kind: "number", required: true }], actions: [{ id: "apply", title: "Switch", args: true }] },
  ];
}

const rotationRows = (s: Screen): Item[] => ROTATIONS.map((deg) => ({ id: `rot:${deg}`, name: `${deg}°`, subtitle: deg === 0 ? "Landscape" : deg === 180 ? "Upside down" : "Portrait", icon: GLYPH.rotate, accessories: (s.rotation ?? 0) === deg ? [{ tag: "current", color: "green" }] : [], actions: [{ id: "apply", title: `Rotate to ${deg}°`, ...((s.rotation ?? 0) !== deg && s.builtin && MAC && { confirm: "displayplacer warns that rotating the built-in screen may crash the machine (it comes back rotated after a restart). Rotate?" }) }] }));

const mirrorRows = (s: Screen, snap: Snapshot): Item[] => snap.screens.filter((x) => x.id !== s.id && !x.mirrorOf).map((x) => ({ id: `mirror:${x.id}`, name: `Mirror ${x.name}`, subtitle: `${s.name} shows what ${x.name} shows; ${x.name} keeps its mode`, icon: screenGlyph(x), actions: [{ id: "apply", title: "Mirror", confirm: `${s.name} will mirror ${x.name}. Undo stays one row away in Displays.` }] }));

// ---- changes ---------------------------------------------------------------

/** Run an arrangement change, keeping the arrangement before it as Undo; the HUD names what happened. */
async function arrange(snap: Snapshot, argv: string[][], what: string): Promise<Effect> {
  const before = reproduce(snap);
  try { await apply(argv, snap.tools); } catch (e) { return failed(what.toLowerCase(), e); }
  if (before.length) await storage.set("undo", { argv: before, what, at: now() } satisfies Undo, EXT);
  bar.refresh("brightness", EXT).catch(() => {});
  return { hud: what };
}

const placements = (snap: Snapshot, s: Screen): string | undefined => (MAC ? s.uuid && snap.placements.length ? s.uuid : undefined : s.id);

async function applyMode(snap: Snapshot, s: Screen, m: Mode): Promise<Effect> {
  const what = `${s.name}: ${modeText(m)}`;
  if (MAC) {
    const uuid = placements(snap, s);
    if (!uuid) return toast("Cannot set the mode", "displayplacer did not list this display", "failure");
    return arrange(snap, [formatPlacements(withMode(snap.placements, uuid, m))], what);
  }
  return arrange(snap, linuxChange(snap, s, { w: m.w, h: m.h, hz: m.hz }), what);
}

/** The next level of `control` on `s` written, clamped to the screen's floor; the HUD line. */
async function setLevel(s: Screen, control: Control, next: number, t: Tools): Promise<Effect> {
  const level = Math.max(floorOf(s), Math.min(100, Math.round(next)));
  try { await write(s, control, level, t); } catch (e) { return failed(`set ${control} on ${s.name}`, e); }
  bar.refresh("brightness", EXT).catch(() => {});
  return { keep: true, hud: `${s.name} ${control === "brightness" ? "" : `${control} `}${level}%` };
}

/** A typed or linked value (`50`, `+10`, `-5`) against the current level; the form back when the pick came bare. */
async function setTyped(s: Screen, control: Control, raw: string | undefined, t: Tools, formId: string, field: string, title: string): Promise<Effect> {
  const args: Arg[] = [{ id: field, placeholder: `${CONTROL_TITLE[control]} % or +10`, kind: "text" }];
  const form = (errors?: Record<string, string>): Effect => ({ form: { ...argsForm(args, title, { id: "set", title: "Set" }, errors), id: formId } });
  if (raw === undefined) return form();
  const cur = await read(s, control, t);
  const next = levelFrom(cur, raw, floorOf(s));
  if (next === undefined) return form({ [field]: "A percent (0 to 100), or +10 / -10" });
  return setLevel(s, control, next, t);
}

const sliderState = async (s: Screen, control: Control, t: Tools, compact?: boolean): Promise<SliderState> => ({ screen: s, control, value: await read(s, control, t), step: settingsOf().step, compact, reason: settable(s, control, t) ? undefined : `${CONTROL_TITLE[control]} cannot be set on ${s.name} with what is installed` });
const sliderEffect = async (s: Screen, control: Control, t: Tools, compact?: boolean): Promise<Effect> => ({ view: sliderView(await sliderState(s, control, t, compact)) });

/** A key of the slider view: the next level from the action, or nothing for one that changes no level. */
export function nextLevel(action: string, current: number | undefined, step: number, values?: Record<string, string | boolean>): number | undefined {
  const cur = current ?? 50;
  if (action === "up") return cur + step;
  if (action === "down") return cur - step;
  if (action === "fine-up") return cur + 1;
  if (action === "fine-down") return cur - 1;
  if (action === "max") return 100;
  if (action.startsWith("preset:")) return Number(action.slice(7));
  if (action === "set") { const v = Number(values?.value); return Number.isFinite(v) ? v * 100 : undefined; }
}

async function sliderPick(viewId: string, action: string, ctx: Ctx | undefined, t: Tools): Promise<Effect> {
  const [control, id] = viewId.split(":") as [Control, string];
  const snap = await snapshot();
  const s = snap.screens.find((x) => x.id === id);
  if (!s) return toast("Display gone", "It is no longer connected", "failure");
  if (action === "retry") { invalidate(); return sliderEffect(s, control, t, ctx?.compact); }
  const next = nextLevel(action, await read(s, control, t), settingsOf().step, ctx?.values);
  if (next === undefined) return sliderEffect(s, control, t, ctx?.compact);
  const level = Math.max(floorOf(s), Math.min(100, Math.round(next)));
  try { await write(s, control, level, t); } catch (e) { return failed(`set ${control}`, e); }
  bar.refresh("brightness", EXT).catch(() => {});
  return sliderEffect(s, control, t, ctx?.compact);
}

// ---- picks -----------------------------------------------------------------

async function rootPick(id: string, action: string | undefined, ctx: Ctx | undefined): Promise<Effect> {
  const snap = await snapshot();
  const t = snap.tools;
  if (id.startsWith("hint:setup:")) { const key = id.slice(11) as keyof typeof INSTALL; return action === "copy-install" ? { copy: INSTALL[key], hud: `Copied “${INSTALL[key]}”` } : { keep: true }; }
  if (id.startsWith("hint:")) return { keep: true };
  if (id.startsWith("display:")) {
    const s = snap.screens.find((x) => x.id === id.slice(8));
    if (!s) return toast("Display gone", "It is no longer connected", "failure");
    switch (action) {
      case "set-brightness": return setTyped(s, "brightness", ctx?.values ? String(ctx.values.brightness ?? "") : undefined, t, id, "brightness", `Brightness: ${s.name}`);
      case "set": return setTyped(s, "brightness", ctx?.values ? String(ctx.values.brightness ?? "") : undefined, t, id, "brightness", `Brightness: ${s.name}`);
      case "make-main": return makeMain(snap, s);
      case "copy-id": return { copy: s.id, hud: `Copied ${s.id}` };
      default: return { push: { extension: EXT, palette: "displays", args: { display: s.id } satisfies Args, title: s.name } };
    }
  }
  if (id === "night-shift") {
    try { const on = await setNightShift(t, "toggle"); return { keep: true, hud: on ? "Night Shift on" : "Night Shift off" }; } catch (e) { return failed("switch Night Shift", e); }
  }
  if (id === "sleep") { try { await system.run("sleep-displays"); return { hide: true }; } catch (e) { return failed("sleep the displays", e); } }
  if (id === "undo") {
    const undo = await undoStored();
    if (!undo) return { keep: true };
    if (action === "forget") { await storage.remove("undo", EXT); return { keep: true }; }
    try { await apply(undo.argv, t); } catch (e) { return failed("undo", e); }
    await storage.remove("undo", EXT);
    bar.refresh("brightness", EXT).catch(() => {});
    return { hud: `Undid ${undo.what}` };
  }
  if (id === "save") {
    const argv = reproduce(snap);
    if (!argv.length) return toast("Nothing to save", MAC ? "displayplacer did not print an arrangement" : "No output is listed", "failure");
    const name = ctx?.values ? String(ctx.values.name ?? "").trim() : undefined;
    const form = (errors?: Record<string, string>): Effect => ({ form: { ...argsForm(NAME_ARGS, "Save arrangement", { id: "save", title: "Save" }, errors), id: "save" } });
    if (name === undefined) return form();
    if (!name) return form({ name: "A name" });
    const list = await presets();
    if (list.some((p) => p.name.toLowerCase() === name.toLowerCase())) return form({ name: "A preset has this name; delete or overwrite it from its row" });
    await storage.set("presets", [...list, { name, saved: now(), argv, displays: snap.screens.map((s) => s.name) } satisfies Preset], EXT);
    return { keep: true, hud: `Saved “${name}”`, toast: { title: `Saved “${name}”`, message: `pal://displays/preset?name=${encodeURIComponent(name)} applies it` } };
  }
  if (id.startsWith("preset:")) {
    const list = await presets();
    const p = list.find((x) => x.name === id.slice(7));
    if (!p) return { keep: true };
    switch (action) {
      case "rename": {
        const name = ctx?.values ? String(ctx.values.name ?? "").trim() : undefined;
        const form = (errors?: Record<string, string>): Effect => ({ form: { title: `Rename “${p.name}”`, id, fields: [{ kind: "text", id: "name", label: "Name", required: true, default: p.name }], submit: { id: "rename", title: "Rename" }, ...(errors && { errors }) } });
        if (name === undefined) return form();
        if (!name) return form({ name: "A name" });
        if (list.some((x) => x !== p && x.name.toLowerCase() === name.toLowerCase())) return form({ name: "Another preset has this name" });
        await storage.set("presets", list.map((x) => (x === p ? { ...x, name } : x)), EXT);
        return { keep: true, hud: `Renamed to “${name}”` };
      }
      case "update": {
        const argv = reproduce(snap);
        if (!argv.length) return toast("Nothing to save", "No arrangement was read", "failure");
        await storage.set("presets", list.map((x) => (x === p ? { ...x, argv, saved: now(), displays: snap.screens.map((s) => s.name) } : x)), EXT);
        return { keep: true, hud: `Updated “${p.name}”` };
      }
      case "delete": await storage.set("presets", list.filter((x) => x !== p), EXT); return { keep: true, hud: `Deleted “${p.name}”` };
      default: return arrange(snap, p.argv, `Applied “${p.name}”`);
    }
  }
  return { keep: true };
}

async function makeMain(snap: Snapshot, s: Screen): Promise<Effect> {
  if (MAC) {
    const uuid = placements(snap, s);
    if (!uuid) return toast("Cannot make it main", "displayplacer did not list this display", "failure");
    return arrange(snap, [formatPlacements(withMain(snap.placements, uuid))], `${s.name} is main`);
  }
  if (snap.tools.compositor !== "xrandr") return toast("No main display on this compositor", "Wayland compositors have no primary output; the menu bar is per output", "failure");
  return arrange(snap, linuxChange(snap, s, { main: true }), `${s.name} is main`);
}

async function screenPick(s: Screen, snap: Snapshot, id: string, action: string | undefined, ctx: Ctx | undefined): Promise<Effect> {
  const t = snap.tools;
  if (id.startsWith("hint:setup:")) return rootPick(id, action, ctx);
  if (CONTROLS.includes(id as Control)) {
    const c = id as Control;
    const step = settingsOf().step;
    if (action === "set") return setTyped(s, c, ctx?.values ? String(ctx.values.level ?? "") : undefined, t, id, "level", `${CONTROL_TITLE[c]}: ${s.name}`);
    if (action === "up" || action === "down") { const cur = await read(s, c, t); if (cur === undefined) return toast(`${CONTROL_TITLE[c]} unread`, "Open the slider and try again", "failure"); return setLevel(s, c, cur + (action === "up" ? step : -step), t); }
    if (action === "slider" || !action) { invalidate(); return sliderEffect(s, c, t, ctx?.compact); }
  }
  if (id === "input") return { push: { extension: EXT, palette: "displays", args: { display: s.id, level: "input" } satisfies Args, title: `Input: ${s.name}` } };
  if (id === "modes") return { push: { extension: EXT, palette: "displays", args: { display: s.id, level: "modes" } satisfies Args, title: `Modes: ${s.name}` } };
  if (id === "rotation") return { push: { extension: EXT, palette: "displays", args: { display: s.id, level: "rotation" } satisfies Args, title: `Rotation: ${s.name}` } };
  if (id === "mirror") return { push: { extension: EXT, palette: "displays", args: { display: s.id, level: "mirror" } satisfies Args, title: `Mirror: ${s.name}` } };
  if (id === "unmirror") {
    if (MAC) { const uuid = placements(snap, s); if (!uuid) return { keep: true }; return arrange(snap, [formatPlacements(withoutMirror(snap.placements, uuid, { w: s.w, h: s.h, hz: s.hz, depth: s.depth, hidpi: s.hidpi }))], `${s.name} no longer mirrors`); }
    const lead = snap.screens.find((x) => x.id === s.mirrorOf);
    return arrange(snap, linuxChange(snap, s, { mirrorOf: undefined, origin: { x: (lead?.origin?.x ?? 0) + (lead?.w ?? 0), y: lead?.origin?.y ?? 0 } }), `${s.name} no longer mirrors`);
  }
  if (id === "main") return makeMain(snap, s);
  if (id === "sleep") return rootPick("sleep", action, ctx);
  return { keep: true };
}

async function levelPick(s: Screen, snap: Snapshot, level: Args["level"], id: string, action: string | undefined, ctx: Ctx | undefined): Promise<Effect> {
  const t = snap.tools;
  if (level === "modes" && id.startsWith("mode:")) {
    const m = s.modes.find((x) => x.id === id.slice(5));
    if (!m) return { keep: true };
    if (action === "copy-link") { const link = `pal://displays/mode?display=${encodeURIComponent(s.id)}&mode=${encodeURIComponent(m.id)}`; return { copy: link, hud: "Copied link" }; }
    if (m.current) return { keep: true, hud: "Already this mode" };
    return applyMode(snap, s, m);
  }
  if (level === "input" && id.startsWith("input:")) {
    const which = id.slice(6);
    const source: InputId | number | undefined = which === "custom" ? (ctx?.values ? Number(ctx.values.code) : undefined) : (which as InputId);
    if (which === "custom" && (source === undefined || !Number.isFinite(source))) return { form: { ...argsForm([{ id: "code", placeholder: "Code", kind: "number", required: true }], `Input code: ${s.name}`, { id: "apply", title: "Switch" }), id } };
    if (action === "copy-link") return { copy: `pal://displays/input?display=${encodeURIComponent(s.id)}&source=${which}`, hud: "Copied link" };
    try { await setInput(s, source!, t, settingsOf().input_alt); } catch (e) { return failed("switch the input", e); }
    const title = typeof source === "string" ? INPUTS.find((i) => i.id === source)!.title : `code ${source}`;
    return { hud: `${s.name}: ${title}` };
  }
  if (level === "rotation" && id.startsWith("rot:")) {
    const deg = Number(id.slice(4));
    if ((s.rotation ?? 0) === deg) return { keep: true, hud: "Already there" };
    if (MAC) { const uuid = placements(snap, s); if (!uuid) return { keep: true }; return arrange(snap, [formatPlacements(withRotation(snap.placements, uuid, deg))], `${s.name} rotated ${deg}°`); }
    return arrange(snap, linuxChange(snap, s, { rotation: deg }), `${s.name} rotated ${deg}°`);
  }
  if (level === "mirror" && id.startsWith("mirror:")) {
    const lead = snap.screens.find((x) => x.id === id.slice(7));
    if (!lead) return { keep: true };
    if (MAC) { const a = placements(snap, s), b = placements(snap, lead); if (!a || !b) return { keep: true }; return arrange(snap, [formatPlacements(withMirror(snap.placements, a, b))], `${s.name} mirrors ${lead.name}`); }
    return arrange(snap, linuxChange(snap, s, { mirrorOf: lead.id }), `${s.name} mirrors ${lead.name}`);
  }
  return { keep: true };
}

// ---- bar -------------------------------------------------------------------

/** Which card the popover's keys act on, between renders: the screen's id, so a list that changes keeps its place. */
let barFocus: string | undefined;

async function popoverState(snap: Snapshot): Promise<PopoverState> {
  const t = snap.tools;
  const screens = await Promise.all(snap.screens.map(async (s) => ({ screen: s, settable: settable(s, "brightness", t), level: settable(s, "brightness", t) ? await read(s, "brightness", t) : undefined })));
  const at = screens.findIndex((p) => p.screen.id === barFocus);
  const first = screens.findIndex((p) => p.settable);
  const gaps = missing(snap).filter((m) => m.about !== "arrange");
  return { screens, focus: at >= 0 ? at : Math.max(0, first), step: settingsOf().step, night: await nightShift(t), hint: gaps[0] ? `${gaps[0].what}: ${INSTALL[gaps[0].id]}` : undefined };
}

async function renderBar(): Promise<BarItem> {
  let snap: Snapshot;
  try { snap = await snapshot(); } catch { return { hidden: true, states: { brightness: null, external: 0, count: 0, settable: false } }; }
  const t = snap.tools;
  const chosen = barScreen(snap);
  const level = chosen && settable(chosen, "brightness", t) ? await read(chosen, "brightness", t) : undefined;
  const externals = snap.screens.filter((s) => !s.builtin).length;
  const states = { brightness: level ?? null, external: externals, count: snap.screens.length, settable: snap.screens.some((s) => settable(s, "brightness", t)) };
  if (!chosen) return { hidden: true, states };
  const gap = missing(snap).find((m) => m.about === (chosen.builtin ? "builtin" : "external"));
  const tooltip = level === undefined ? (gap ? `${chosen.name}: ${gap.what.replace(/^[^:]*: /, "")} (${INSTALL[gap.id]})` : `${chosen.name}: brightness unread`) : [chosen.name, `${level}%`, chosen.w ? modeText(chosen) : undefined].filter(Boolean).join(" · ");
  const shape: BarItem = { icon: brightnessGlyph(level), title: level === undefined ? undefined : `${level}%`, tooltip, menu: { view: popover(await popoverState(snap)) }, scroll: { up: "scroll-up", down: "scroll-down" } };
  return { ...shape, empty: shape, states };
}

async function barAction(action: string, ctx?: BarCtx): Promise<Effect> {
  const snap = await snapshot();
  const t = snap.tools;
  const redraw = async (): Promise<Effect> => ({ view: popover(await popoverState(snap)) });
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return redraw(); }
  if (action === "next" || action === "prev") {
    const ids = snap.screens.map((s) => s.id);
    if (!ids.length) return { keep: true };
    const here = Math.max(0, ids.indexOf(barFocus ?? ""));
    barFocus = ids[(here + (action === "next" ? 1 : -1) + ids.length) % ids.length];
    return redraw();
  }
  if (action === "open-pal") return { push: { extension: EXT, palette: "displays" } };
  if (action === "night") { try { const on = await setNightShift(t, "toggle"); return { ...(await redraw()), hud: on ? "Night Shift on" : "Night Shift off" }; } catch (e) { return failed("switch Night Shift", e); } }
  // A scroll on the strip acts on the bar's own display and answers with the HUD; a key or a click in the popover acts on the card the cursor is on and answers with the tree.
  const scroll = action === "scroll-up" || action === "scroll-down";
  const st = await popoverState(snap);
  const target = action.startsWith("set:") ? snap.screens.find((s) => s.id === action.slice(4)) : scroll ? barScreen(snap) : st.screens[st.focus]?.screen;
  if (!target) return { keep: true };
  if (action === "open") return { push: { extension: EXT, palette: "displays", args: { display: target.id } satisfies Args, title: target.name } };
  const next = nextLevel(action.startsWith("set:") ? "set" : scroll ? action.slice(7) : action, await read(target, "brightness", t), st.step, ctx?.values);
  if (next === undefined || !settable(target, "brightness", t)) return { keep: true };
  const level = Math.max(floorOf(target), Math.min(100, Math.round(next)));
  try { await write(target, "brightness", level, t); } catch (e) { return failed("set brightness", e); }
  return scroll ? { keep: true, hud: `${target.name} ${level}%` } : redraw();
}

// ---- links -----------------------------------------------------------------

async function link(route: string, params: LinkParams): Promise<Effect | void> {
  const snap = await snapshot();
  const t = snap.tools;
  const spec = params.display === undefined ? undefined : String(params.display);
  if (route === "brightness" || route === "contrast" || route === "volume") {
    const s = resolveScreen(snap.screens, spec, route === "brightness" ? settingsOf().bar_display : "external");
    if (!s) throw new Error(`no display ${spec ?? "connected"}`);
    const ddcTool = MAC ? (process.arch === "arm64" ? "m1ddc" : "ddcctl") : "ddcutil";
    if (!settable(s, route, t)) throw new Error(route !== "brightness" && s.builtin ? `${route} is a DDC control; ${s.name} is the built-in display` : `${route} on ${s.name} needs ${s.builtin ? (MAC ? "the brightness CLI (brew install --HEAD brightness)" : "brightnessctl") : ddcTool}`);
    const next = levelFrom(await read(s, route, t), String(params.value), floorOf(s));
    if (next === undefined) throw new Error(`value: a percent or +10 / -10, not “${params.value}”`);
    await write(s, route, next, t);
    bar.refresh("brightness", EXT).catch(() => {});
    return { hud: `${s.name} ${route === "brightness" ? "" : `${route} `}${next}%` };
  }
  if (route === "input") {
    const s = resolveScreen(snap.screens, spec, "external");
    if (!s) throw new Error(`no display ${spec ?? "connected"}`);
    const source = parseInput(String(params.source));
    if (source === undefined) throw new Error(`source: hdmi1, hdmi2, dp1, dp2, usbc or a VCP code, not “${params.source}”`);
    await setInput(s, source, t, settingsOf().input_alt);
    return { hud: `${s.name}: ${typeof source === "string" ? INPUTS.find((i) => i.id === source)!.title : `input ${source}`}` };
  }
  if (route === "mode") {
    const s = resolveScreen(snap.screens, spec, "main");
    if (!s) throw new Error(`no display ${spec ?? "connected"}`);
    const m = findMode(s.modes, String(params.mode));
    if (!m) throw new Error(s.modes.length ? `${s.name} has no mode “${params.mode}”` : `no modes listed for ${s.name} (${MAC ? "displayplacer" : "the compositor tool"} is missing)`);
    const r = await applyMode(snap, s, m);
    if (r.toast) throw new Error(r.toast.message ?? r.toast.title);
    return r;
  }
  if (route === "preset") {
    const p = (await presets()).find((x) => x.name.toLowerCase() === String(params.name).toLowerCase());
    if (!p) throw new Error(`no preset “${params.name}”`);
    const r = await arrange(snap, p.argv, `Applied “${p.name}”`);
    if (r.toast) throw new Error(r.toast.message ?? r.toast.title);
    return r;
  }
  if (route === "night-shift") {
    const state = String(params.state ?? "toggle").toLowerCase();
    if (state !== "on" && state !== "off" && state !== "toggle") throw new Error(`state: on, off or toggle, not “${params.state}”`);
    const on = await setNightShift(t, state);
    return { hud: on ? "Night Shift on" : "Night Shift off" };
  }
}

export default {
  palettes: {
    displays: {
      title: "Displays",
      live: true,
      placeholder: "A display, a preset, a setting",
      list: async (_query, ctx) => {
        const args = argsOf(ctx);
        let snap: Snapshot;
        try { snap = await snapshot(!!ctx?.refresh); } catch (e) { return [hint("error", "Displays unavailable", errorMessage(e), { icon: GLYPH.monitor })]; }
        if (!args.display) return rootRows(snap);
        const s = snap.screens.find((x) => x.id === args.display);
        if (!s) return [hint("gone", "Display disconnected", "It is no longer listed", { icon: GLYPH.monitor })];
        switch (args.level) {
          case "modes": return modeRows(s);
          case "input": return inputRows(s, snap.tools);
          case "rotation": return rotationRows(s);
          case "mirror": return mirrorRows(s, snap);
          default: return screenRows(s, snap);
        }
      },
      pick: async (id, action, ctx) => {
        const args = argsOf(ctx);
        const snap = await snapshot();
        // A slider view's picks come with the view's id, `<control>:<display id>`.
        if (CONTROLS.some((c) => id.startsWith(`${c}:`))) return sliderPick(id, action ?? "", ctx, snap.tools);
        if (!args.display) return rootPick(id, action, ctx);
        const s = snap.screens.find((x) => x.id === args.display);
        if (!s) return toast("Display gone", "It is no longer connected", "failure");
        return args.level ? levelPick(s, snap, args.level, id, action, ctx) : screenPick(s, snap, id, action, ctx);
      },
    },
  },
  bar: {
    brightness: { render: renderBar, onAction: barAction, onShown: async () => { await popoverState(await snapshot()); } },
  },
  link,
} satisfies Extension;
