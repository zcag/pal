// The light and room view as a tree (`View` in `@zcag/pal`): the big
// tile in the current colour over the brightness bar, the warm-to-cool
// temperature strip and the hue/saturation plane on the left, the
// presets, the room's scenes, the effects and the options on the right,
// the key hints under everything; and the setup view (find a bridge,
// press its button, paired). Pure: the fixture renders rigged states with
// these same functions.
import { column, keyHint, keycap, row, text, type Action, type HexColor, type View, type ViewNode } from "@zcag/pal";
import { MIREK_MAX, MIREK_MIN, clamp, dim, kelvin, mirekToRgb, temperatureStops, toHex, xyToHs, type RGB } from "./color.ts";
import type { Bridge, Found } from "./api.ts";
import { aggregate, lightColor, pct, type Light, type Room, type Scene } from "./model.ts";

export type Focus = "light" | "color" | "presets" | "scenes" | "effects";
export const FOCUS: Focus[] = ["light", "color", "presets", "scenes", "effects"];
/** In-process state of the view: where the keys land, what a room-bound light's changes apply to, the transition. */
export type ViewState = { focus: Focus; index: number; scope: "light" | "room"; duration: number };
export const DURATIONS = [0, 400, 1000, 4000];
export const fresh = (): ViewState => ({ focus: "light", index: 0, scope: "light", duration: 400 });

/** Hue's own presets, as the app ships them: a temperature and a brightness. */
export const PRESETS: { id: string; title: string; mirek: number; brightness: number }[] = [
  { id: "relax", title: "Relax", mirek: 447, brightness: 57 },
  { id: "read", title: "Read", mirek: 346, brightness: 100 },
  { id: "concentrate", title: "Concentrate", mirek: 233, brightness: 100 },
  { id: "energize", title: "Energize", mirek: 156, brightness: 100 },
  { id: "bright", title: "Bright", mirek: 233, brightness: 100 },
  { id: "dimmed", title: "Dimmed", mirek: 366, brightness: 30 },
  { id: "nightlight", title: "Nightlight", mirek: 447, brightness: 1 },
];
export const EFFECTS = ["candle", "fire", "sparkle", "prism", "opal", "glisten", "underwater", "cosmos", "sunbeam", "enchant"] as const;

/** What the view is about: one light (with its room for the scope) or a room. */
export type Target = { kind: "light"; light: Light; room?: Room } | { kind: "room"; room: Room };

/** The state the view draws, one shape for a light and a room. */
export type Shown = { name: string; on: boolean; brightness?: number; mirek?: number; mirekRange?: [number, number]; hs?: { h: number; s: number }; hasColor: boolean; hasTemperature: boolean; color: RGB; effects: string[]; effect?: string; reach?: string; sub: string };

export function shown(t: Target): Shown {
  if (t.kind === "light") {
    const l = t.light;
    return {
      name: l.name, on: l.on, brightness: l.brightness, mirek: l.mirek, mirekRange: l.mirekRange, hs: l.xy ? xyToHs(l.xy, l.gamut) : undefined,
      hasColor: !!l.xy, hasTemperature: !!l.mirekRange, color: lightColor(l), effects: l.effects, effect: l.effect, reach: l.reach,
      sub: [l.room?.name ?? "No room", l.reach === "disconnected" || l.reach === "connectivity_issue" ? "unreachable" : undefined].filter(Boolean).join(" · "),
    };
  }
  const r = t.room, a = aggregate(r);
  const on = r.lights.filter((l) => l.on);
  const withCt = on.filter((l) => l.mirek), withColor = on.filter((l) => l.xy);
  const mirek = withCt.length ? Math.round(withCt.reduce((s, l) => s + l.mirek!, 0) / withCt.length) : undefined;
  const ranges = r.lights.map((l) => l.mirekRange).filter((x): x is [number, number] => !!x);
  const range: [number, number] | undefined = ranges.length ? [Math.max(...ranges.map((x) => x[0])), Math.min(...ranges.map((x) => x[1]))] : undefined;
  const first = withColor[0];
  const effects = [...new Set(r.lights.flatMap((l) => l.effects))];
  return {
    name: r.name, on: a.anyOn, brightness: a.brightness, mirek, mirekRange: range, hs: first?.xy ? xyToHs(first.xy, first.gamut) : undefined,
    hasColor: r.lights.some((l) => l.xy), hasTemperature: !!range, color: a.color ?? mirekToRgb(mirek ?? 370), effects, effect: on.find((l) => l.effect)?.effect,
    sub: `${r.kind === "zone" ? "Zone" : "Room"} · ${a.on === 0 ? "all off" : a.on === a.total ? `all ${a.total} on` : `${a.on} of ${a.total} on`}`,
  };
}

const hex = (c: RGB): HexColor => toHex(c);
const label = (v: string, on: boolean, width = 84): ViewNode => text(v, { style: "muted", size: "xs", width, weight: on ? "semibold" : undefined, color: on ? "accent" : "muted" });

const TILE_W = 216, TILE_H = 112, BAR_W = 128, PLANE_H = 84;

function leftColumn(s: Shown, st: ViewState): ViewNode {
  const bri = pct(s.brightness);
  const onLight = st.focus === "light", onColor = st.focus === "color";
  const tileColor: HexColor = s.on ? hex(dim(s.color, (bri ?? 100) / 100 * 0.35 + 0.65)) : "#00000000";
  const tile: ViewNode = s.on
    ? { type: "tile", key: `tile-${tileColor}`, width: TILE_W, height: TILE_H, color: tileColor, fill: "solid", text: bri !== undefined ? `${bri}%` : "On", sub: s.name, transition: { enter: "fade", exit: "none" } }
    : { type: "tile", key: "tile-off", width: TILE_W, height: TILE_H, color: "neutral", fill: "outline", text: "Off", sub: s.name, transition: { enter: "fade", exit: "none" } };
  const strip = s.mirekRange ?? [MIREK_MIN, MIREK_MAX];
  const kids: ViewNode[] = [
    column([tile], { key: "well", surface: "sunken", radius: true, padding: 2, align: "center" }),
    row([label("Brightness", onLight), { type: "progress", key: "bri", value: (bri ?? 0) / 100, width: BAR_W, color: s.on ? undefined : "grey" }], { key: "brightness", minHeight: 18 }),
  ];
  if (s.hasTemperature) {
    const m = clamp(s.mirek ?? strip[1], strip[0], strip[1]);
    kids.push(row([label("Temperature", onLight), { type: "gradient", key: "ct", width: BAR_W, height: 12, layers: [{ stops: temperatureStops(strip[0], strip[1]) }], marker: { x: (strip[1] - m) / Math.max(1, strip[1] - strip[0]), y: 0.5 } }], { key: "temperature", minHeight: 18 }));
  }
  if (s.hasColor) {
    // No marker while the light shows no colour (off, or on a white): a ring at the plane's edge would say a hue it does not have.
    const hs = s.on && s.hs && s.hs.s > 0.02 ? s.hs : undefined;
    kids.push(column([
      row([label("Colour", onColor, TILE_W), { type: "spacer" }], { key: "cl", minHeight: 14 }),
      { type: "gradient", key: "plane", width: TILE_W, height: PLANE_H, layers: [{ stops: ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"] }, { stops: ["#ffffff", "#ffffff00"], direction: "down" }], ...(hs && { marker: { x: hs.h / 360, y: clamp(hs.s, 0, 1) } }) },
    ], { key: "colour", gap: 2 }));
  }
  const parts = [bri !== undefined ? `${bri}%` : undefined, s.mirek && s.hasTemperature ? `${kelvin(s.mirek)} K` : undefined, s.on ? toHex(s.color) : "off"].filter(Boolean) as string[];
  kids.push(text(parts.join(" · "), { key: "readout", style: "mono", size: "xs", color: "muted", width: TILE_W }));
  return column(kids, { key: "left", gap: 2, align: "start" });
}

/** A preset as a tile in its white with its name inside; the focused one is taller. */
function presetsRow(st: ViewState): ViewNode {
  const on = st.focus === "presets";
  return column([
    row([label("Presets", on, 60), ...(on ? [text(`${PRESETS[st.index]?.brightness ?? ""}% · ${kelvin(PRESETS[st.index]?.mirek ?? 370)} K`, { key: `p-${st.index}`, style: "muted", size: "xs", transition: { enter: "fade", exit: "none" } })] : [])], { key: "t", minHeight: 14 }),
    row(PRESETS.map((p, i) => ({ type: "tile", key: `preset-${p.id}`, width: 58, height: on && i === st.index ? 32 : 26, text: p.title, color: hex(dim(mirekToRgb(p.mirek), p.brightness / 100 * 0.5 + 0.5)), fill: "solid", transition: { enter: "fade", exit: "none" } }) as ViewNode), { key: "r", gap: 1, minHeight: 32 }),
  ], { key: "presets", gap: 0 });
}

/** The room's scenes as five-swatch strips; a scene that is on carries a dot. */
function scenesRow(scenes: Scene[], st: ViewState): ViewNode {
  const on = st.focus === "scenes";
  if (!scenes.length) return column([row([label("Scenes", on, 60), text("none in this room", { style: "muted", size: "xs" })], { key: "t", minHeight: 14 })], { key: "scenes", gap: 0 });
  const cur = scenes[st.index];
  return column([
    row([label("Scenes", on, 60), ...(on && cur ? [text(`${cur.name}${cur.active !== "inactive" ? " · on" : ""}`, { key: `s-${cur.id}`, style: "muted", size: "xs", transition: { enter: "fade", exit: "none" } })] : [])], { key: "t", minHeight: 14 }),
    row(scenes.slice(0, 8).map((sc, i) => {
      const big = on && i === st.index;
      const sw = sc.swatches.length ? sc.swatches : ["#8a8f98"];
      // Every strip is about as wide whatever its swatch count: a one-white scene is a block, a palette five stripes.
      const w = Math.max(6, Math.round((big ? 40 : 34) / sw.length)), h = big ? 30 : 24;
      return row(sw.map((c, j) => ({ type: "tile", key: `${sc.id}-${j}`, width: w, height: h, color: c as HexColor, fill: "solid" }) as ViewNode), { key: sc.id, gap: 0, surface: sc.active !== "inactive" ? "elevated" : undefined, radius: true });
    }), { key: "r", gap: 1, minHeight: 30 }),
  ], { key: "scenes", gap: 0 });
}

function effectsRow(s: Shown, st: ViewState): ViewNode {
  const on = st.focus === "effects";
  const list = s.effects.length ? ["none", ...s.effects] : [];
  if (!list.length) return column([row([label("Effects", on, 60), text("not supported here", { style: "muted", size: "xs" })], { key: "t", minHeight: 14 })], { key: "effects", gap: 0 });
  const active = s.effect ?? "none";
  return column([
    row([label("Effects", on, 60)], { key: "t", minHeight: 14 }),
    row(list.map((e, i) => ({ type: "badge", key: `e-${e}`, text: on && i === st.index ? `▸ ${e}` : e, color: e === active ? "violet" : "grey" }) as ViewNode), { key: "r", gap: 1, minHeight: 22 }),
  ], { key: "effects", gap: 0 });
}

function optionsRow(t: Target, st: ViewState): ViewNode {
  const kids: ViewNode[] = [];
  if (t.kind === "light" && t.room) kids.push(text("Apply to", { style: "muted", size: "xs" }), { type: "badge", key: `scope-${st.scope}`, text: st.scope === "room" ? `room · ${t.room.name}` : "this light", color: st.scope === "room" ? "blue" : "grey" }, keycap("a"));
  kids.push(text("Transition", { style: "muted", size: "xs" }), { type: "badge", key: `dur-${st.duration}`, text: st.duration === 0 ? "instant" : st.duration < 1000 ? `${st.duration} ms` : `${st.duration / 1000} s`, color: "grey" }, keycap("d"));
  return row(kids, { key: "options", gap: 1, minHeight: 22 });
}

function header(s: Shown, t: Target): ViewNode {
  const badges: ViewNode[] = [{ type: "badge", key: `on-${s.on}`, text: s.on ? "on" : "off", color: s.on ? "green" : "grey" }];
  if (s.reach === "disconnected" || s.reach === "connectivity_issue") badges.push({ type: "badge", key: "reach", text: "unreachable", color: "red" });
  if (s.effect) badges.push({ type: "badge", key: `fx-${s.effect}`, text: s.effect, color: "violet" });
  return column([
    row([text(s.name, { style: "title" }), ...badges], { key: "h1", gap: 1 }),
    text(t.kind === "room" ? s.sub : s.sub, { style: "muted", size: "sm" }),
  ], { key: "header", gap: 0 });
}

function hints(st: ViewState, s: Shown): ViewNode {
  const items = st.focus === "light"
    ? [...keyHint(["left", "right"], "brightness"), ...(s.hasTemperature ? keyHint(["up", "down"], "warmer / cooler") : []), ...keyHint(["1-9", "0"], "level / off"), ...keyHint(["shift"], "big steps")]
    : st.focus === "color"
      ? [...keyHint(["left", "right"], "hue"), ...keyHint(["up", "down"], "saturation"), ...keyHint(["shift"], "big steps")]
      : [...keyHint(["left", "right"], "choose"), ...keyHint(["enter"], st.focus === "presets" ? "apply preset" : st.focus === "scenes" ? "play scene" : "set effect")];
  return row([...items, { type: "spacer" }, ...keyHint(["tab"], "rows"), ...keyHint(["t"], "toggle"), ...keyHint(["c"], "copy")], { key: `hints-${st.focus}`, gap: 1, minHeight: 24, transition: { enter: "fade", exit: "none" } });
}

/** Every action the view answers to for this state; the first listed is Enter. */
export function actions(t: Target, st: ViewState, s: Shown, scenes: Scene[]): Action[] {
  const acts: Action[] = [];
  const toggleTitle = s.on ? "Turn off" : "Turn on";
  if (st.focus === "presets") acts.push({ id: "apply", title: `Apply ${PRESETS[st.index]?.title ?? "preset"}`, shortcut: "enter" });
  else if (st.focus === "scenes" && scenes[st.index]) acts.push({ id: "apply", title: `Play ${scenes[st.index].name}`, shortcut: "enter" });
  else if (st.focus === "effects") acts.push({ id: "apply", title: "Set the effect", shortcut: "enter" });
  else acts.push({ id: "toggle", title: toggleTitle, shortcut: "enter" });
  if (acts[0].id !== "toggle") acts.push({ id: "toggle", title: toggleTitle, shortcut: "t" });
  else acts.push({ id: "toggle:t", title: toggleTitle, shortcut: ["t", "space"], hidden: true });
  acts.push({ id: "copy", title: `Copy ${toHex(s.color)}`, shortcut: "c" });
  acts.push({ id: "scenes", title: "All scenes of the room", shortcut: "s" });
  if (t.kind === "light") acts.push({ id: "identify", title: "Blink to find it", shortcut: "i" });
  if (t.kind === "light" && t.room) acts.push({ id: "scope", title: st.scope === "room" ? "Apply to this light only" : `Apply to the whole room`, shortcut: "a" });
  if (t.kind === "light" && t.room) acts.push({ id: "room", title: `Open ${t.room.name}`, shortcut: "o" });
  acts.push({ id: "duration", title: "Next transition length", shortcut: "d" });
  acts.push({ id: "refresh", title: "Read the bridge again", shortcut: "r" });
  acts.push({ id: "focus:next", title: "Next row", shortcut: st.focus === "light" || st.focus === "color" ? "tab" : ["tab", "down"] });
  acts.push({ id: "focus:prev", title: "Previous row", shortcut: st.focus === "light" || st.focus === "color" ? "shift+tab" : ["shift+tab", "up"] });
  if (st.focus === "light") {
    acts.push({ id: "bri+", title: "Brighter", shortcut: "right", hidden: true }, { id: "bri-", title: "Dimmer", shortcut: "left", hidden: true });
    acts.push({ id: "bri++", title: "Much brighter", shortcut: "shift+right", hidden: true }, { id: "bri--", title: "Much dimmer", shortcut: "shift+left", hidden: true });
    if (s.hasTemperature) {
      acts.push({ id: "ct+", title: "Cooler", shortcut: "up", hidden: true }, { id: "ct-", title: "Warmer", shortcut: "down", hidden: true });
      acts.push({ id: "ct++", title: "Much cooler", shortcut: "shift+up", hidden: true }, { id: "ct--", title: "Much warmer", shortcut: "shift+down", hidden: true });
    }
  } else if (st.focus === "color") {
    acts.push({ id: "hue+", title: "Hue +10°", shortcut: "right", hidden: true }, { id: "hue-", title: "Hue -10°", shortcut: "left", hidden: true });
    acts.push({ id: "hue++", title: "Hue +40°", shortcut: "shift+right", hidden: true }, { id: "hue--", title: "Hue -40°", shortcut: "shift+left", hidden: true });
    acts.push({ id: "sat+", title: "More saturated", shortcut: "up", hidden: true }, { id: "sat-", title: "Less saturated", shortcut: "down", hidden: true });
    acts.push({ id: "sat++", title: "Much more saturated", shortcut: "shift+up", hidden: true }, { id: "sat--", title: "Much less saturated", shortcut: "shift+down", hidden: true });
  } else {
    acts.push({ id: "along:next", title: "Next", shortcut: "right", hidden: true }, { id: "along:prev", title: "Previous", shortcut: "left", hidden: true });
  }
  for (const d of "1234567890") acts.push({ id: `level:${d}`, title: d === "0" ? "Off" : `${d}0%`, shortcut: d, hidden: true });
  return acts;
}

export function render(t: Target, st: ViewState, scenes: Scene[]): View {
  const s = shown(t);
  const right = column([header(s, t), presetsRow(st), scenesRow(scenes, st), effectsRow(s, st), optionsRow(t, st)], { key: "right", gap: 2, grow: true, align: "start" });
  const tree = column(
    [row([leftColumn(s, st), right], { key: "main", gap: 4, align: "start" }), { type: "spacer", key: "fill" }, hints(st, s)],
    { key: "hue", padding: 4, gap: 2, grow: true },
  );
  return { tree, actions: actions(t, st, s, scenes), title: s.name, id: t.kind === "light" ? t.light.id : t.room.id, keys: "actions" };
}

// ---- setup -----------------------------------------------------------------

export type SetupState =
  | { phase: "idle"; error?: string }
  | { phase: "press"; ip: string; name: string; id?: string; deadline: number; attempts: number; error?: string }
  | { phase: "paired"; ip: string; name: string; id: string; key: string }
  | { phase: "failed"; ip: string; name: string; error: string };

const SETUP_ID = "setup";

export function renderSetup(st: SetupState, found: Found[], paired: Bridge[], now: number, typing?: string): View {
  const acts: Action[] = [];
  const kids: ViewNode[] = [];
  const isPaired = (f: Found) => paired.some((b) => b.id === f.id || b.ip === f.ip);
  if (st.phase === "press") {
    const left = Math.max(0, Math.ceil((st.deadline - now) / 1000));
    kids.push(
      text("Press the round button on the bridge", { style: "title", size: "xl" }),
      text(`${st.name} · ${st.ip}`, { style: "muted" }),
      row([{ type: "progress", key: "clock", value: left / 30, width: 320, color: left > 10 ? "blue" : "amber" }, text(`${left} s`, { key: `left-${left}`, style: "number", transition: { enter: "fade", exit: "none" } })], { key: "countdown", minHeight: 20 }),
      text(st.error ? st.error : "pal asks the bridge every second; the panel comes back on its own once the key is in.", { style: "muted", size: "sm", color: st.error ? "destructive" : "muted" }),
      row([...keyHint("enter", "check now"), ...keyHint("escape", "leave, pairing keeps going")], { key: "keys", gap: 1 }),
    );
    acts.push({ id: "check", title: "Check now", shortcut: "enter" }, { id: "cancel", title: "Stop pairing", shortcut: "x", style: "destructive" });
  } else if (st.phase === "paired") {
    kids.push(
      text(`Paired with ${st.name}`, { style: "title", size: "xl", color: "success" }),
      text(`${st.ip} · bridge ${st.id}`, { style: "muted" }),
      text("The address and the key are in the settings (Settings › Extensions › Hue; the key in the keychain), the bridge's certificate is pinned.", { style: "body", size: "sm" }),
      row([...keyHint("enter", "open Rooms"), ...keyHint("c", "copy the key"), ...keyHint("b", "back to the bridges")], { key: "keys", gap: 1 }),
    );
    acts.push({ id: "rooms", title: "Open Rooms", shortcut: "enter" }, { id: "copy_key", title: "Copy the application key", shortcut: "c" }, { id: "back", title: "Back to the bridges", shortcut: "b" });
  } else if (st.phase === "failed") {
    kids.push(
      text("Not paired", { style: "title", size: "xl", color: "destructive" }),
      text(`${st.name} · ${st.ip}`, { style: "muted" }),
      text(st.error, { style: "body", size: "sm" }),
      row([...keyHint("enter", "try again"), ...keyHint("b", "back")], { key: "keys", gap: 1 }),
    );
    acts.push({ id: `pair:${st.ip}`, title: "Try again", shortcut: "enter" }, { id: "back", title: "Back to the bridges", shortcut: "b" });
  } else {
    kids.push(text("Set up Hue", { style: "title", size: "xl" }), text(found.length ? "Bridges on this network. Pick one, then press its button." : "No bridge found yet. Is it on and on this network? Type its address, or scan again.", { style: "muted" }));
    if (st.error) kids.push(text(st.error, { style: "body", size: "sm", color: "destructive" }));
    const rows: ViewNode[] = found.slice(0, 9).map((f, i) => {
      const done = isPaired(f);
      return row([
        keycap(String(i + 1)),
        text(f.name ?? "Hue Bridge", { style: "body", weight: "medium", width: 200 }),
        text(f.ip, { style: "mono", size: "xs", width: 130 }),
        text(f.id ? f.id : "", { style: "mono", size: "xs", color: "faint", width: 150 }),
        { type: "badge", text: done ? "paired" : f.via, color: done ? "green" : "grey" },
      ], { key: `found-${f.ip}`, minHeight: 22, transition: { enter: "slide-up", delay: Math.min(8, i) } });
    });
    for (const [i, f] of found.slice(0, 9).entries()) acts.push({ id: `pair:${f.ip}`, title: `${isPaired(f) ? "Pair again with" : "Pair with"} ${f.name ?? f.ip}`, shortcut: String(i + 1), ...(i > 0 && { hidden: true as const }) });
    if (rows.length) kids.push(column(rows, { key: "found", gap: 1, surface: "elevated", radius: true, padding: 2 }));
    for (const b of paired) kids.push(row([text("Paired:", { style: "muted", size: "xs" }), text(b.name, { style: "body", size: "sm", weight: "medium" }), text(b.ip, { style: "mono", size: "xs" }), text(b.from_settings ? "from the settings" : b.cert ? "certificate pinned" : "root CA only", { style: "muted", size: "xs" })], { key: `paired-${b.id}`, gap: 1, minHeight: 18 }));
    kids.push(row([...keyHint("1-9", "pair"), ...keyHint("i", "type an address"), ...keyHint("r", "scan again"), ...(paired.length ? keyHint("x", "forget a bridge") : [])], { key: "keys", gap: 1 }));
    if (found[0]) acts[0] = { ...acts[0], shortcut: ["enter", "1"] };
    acts.push({ id: "type", title: "Type the bridge's address", shortcut: "i" }, { id: "rescan", title: "Scan again", shortcut: "r" });
    if (paired.length) acts.push({ id: "forget", title: `Forget ${paired.length === 1 ? paired[0].name : "a bridge"}`, shortcut: "x", style: "destructive", confirm: `Forget ${paired.length === 1 ? paired[0].name : "the first paired bridge"}? Its key stays on the bridge until you pair again.` });
    acts.push({ id: "pair:typed", title: "Pair with the typed address", hidden: true, shortcut: "enter" }, { id: "type:cancel", title: "Stop typing", hidden: true, shortcut: "escape" });
  }
  const view: View = { tree: column([...kids, { type: "spacer", key: "fill" }], { key: "setup", padding: 4, gap: 3, grow: true }), actions: acts, title: "Set up Hue", id: SETUP_ID, keys: "actions" };
  if (typing !== undefined) view.input = { value: typing, placeholder: "192.168.1.25", submit: "pair:typed", cancel: "type:cancel" };
  return view;
}
