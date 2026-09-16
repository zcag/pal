// The picker as a view tree (`View` in `@zcag/pal`): the swatch on a sunken
// well with the hue strip and the plane under it, the notations as a
// column of copyable rows, the nearest tokens, the contrast rows, then the
// tints, shades and harmonies as rows of tiles the focus walks. Every
// tile is a `tile` node in the colour itself (`HexColor`), the strip and
// the plane are `gradient` nodes, so the app draws the picker with its
// tokens in both themes. No host imports: the gallery renders a fixture
// state with this same function.
import type { Action, HexColor, View, ViewNode } from "@zcag/pal";
import { BLACK, WHITE, contrast, fromHsl, fromOklchMapped, maxChroma, nameOf, nearestIn, nearestName, toHex, toHsl, toOklchValues, wcag, type RGB } from "./color.ts";
import { ROWS, previous, rowColors, titleOf, write, type Focus, type Settings, type State } from "./state.ts";
import type { Row } from "./sets.ts";

/** The swatch's box, the strip and the plane under it take the same width. */
const SWATCH_W = 160, SWATCH_H = 116, STRIP_H = 10, PLANE_H = 80;
/** A scale's tile, and the highlighted one. */
const TILE = 16, TILE_ON = 22;
/** The notation column: the label and the value (the longest, display-p3, is 37 characters of 12 px mono). */
const LABEL_W = 56, VALUE_W = 276;

type Text = Extract<ViewNode, { type: "text" }>;
type Stack = Extract<ViewNode, { type: "stack" }>;
const text = (value: string, extra: Partial<Text> = {}): ViewNode => ({ type: "text", value, ...extra });
const row = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
const column = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 2, ...extra, children });
const keycap = (keys: string): ViewNode => ({ type: "keycap", keys });
const hex = (c: RGB): HexColor => toHex(c) as HexColor;
const opaque = (c: RGB): HexColor => toHex({ ...c, a: 1 }) as HexColor;
const LEVEL_COLOR = { AAA: "green", AA: "green", "AA large": "amber", fail: "red" } as const;
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The hue strip: the pure hues round the wheel (seven stops in HSL; in OKLCH, the most chromatic sRGB colour every 30° of OKLCH hue, so the marker's hue reads on the same scale). */
export function hueStops(st: State): HexColor[] {
  if (st.model === "hsl") return ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"];
  return Array.from({ length: 13 }, (_, i) => vivid((i * 30) % 360));
}

/** The most chromatic sRGB colour of an OKLCH hue: the lightness where the gamut is widest, at that chroma. */
export function vivid(H: number): HexColor {
  let best = { L: 0.5, C: 0 };
  for (let L = 0.05; L < 1; L += 0.05) { const C = maxChroma(L, H); if (C > best.C) best = { L, C }; }
  return opaque(fromOklchMapped({ L: best.L, C: best.C, H }));
}

/**
 * The classic saturation/value plane, exactly: the pure hue as the fill,
 * white to transparent rightwards, black to transparent upwards. In HSL
 * mode the colour's HSL saturation and lightness are converted to HSV for
 * the marker (the arrows still move HSL); in OKLCH mode the same plane
 * stands in (the hue's most chromatic colour as the fill) and the marker
 * sits at the chroma, as a share of what the gamut allows at that
 * lightness, and the lightness.
 */
export function plane(st: State): { fill: HexColor; layers: { stops: HexColor[]; direction?: "up" | "right" }[]; marker: { x: number; y: number } } {
  const layers: { stops: HexColor[]; direction?: "up" | "right" }[] = [{ stops: ["#ffffff", "#ffffff00"], direction: "right" }, { stops: ["#000000", "#00000000"], direction: "up" }];
  if (st.model === "hsl") {
    const { h, s, l } = toHsl(st.color);
    const v = l + s * Math.min(l, 1 - l);
    const sv = v === 0 ? 0 : 2 * (1 - l / v);
    return { fill: opaque(fromHsl({ h, s: 1, l: 0.5 })), layers, marker: { x: sv, y: 1 - v } };
  }
  const { L, C, H } = toOklchValues(st.color);
  const max = maxChroma(L, H);
  return { fill: vivid(H), layers, marker: { x: max > 0 ? Math.min(1, C / max) : 0, y: 1 - L } };
}

/** The line under the plane: the model and the three values the arrows edit. */
export function readout(st: State): string {
  if (st.model === "hsl") { const { h, s, l } = toHsl(st.color); return `${Math.round(h)}° ${pct(s)} ${pct(l)}`; }
  const { L, C, H } = toOklchValues(st.color);
  return `${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)}°`;
}

const ratio = (c: RGB, on: RGB) => { const r = contrast(c, on); return { text: `${r.toFixed(2)}:1`, level: wcag(r) }; };

function swatchColumn(st: State, s: Settings): ViewNode {
  const c = st.color;
  const name = nameOf(c);
  const p = plane(st);
  const focused = st.focus === "swatch";
  return column(
    [
      column([{ type: "tile", key: `swatch-${toHex(c)}`, width: SWATCH_W, height: SWATCH_H, color: hex(c), sub: name, transition: { enter: "fade" } }], { key: "well", surface: "sunken", radius: true, padding: 2, align: "center" }),
      { type: "gradient", key: "hue", width: SWATCH_W + 16, height: STRIP_H, layers: [{ stops: hueStops(st) }], marker: { x: (st.model === "hsl" ? toHsl(c).h : toOklchValues(c).H) / 360, y: 0.5 } },
      { type: "gradient", key: "plane", width: SWATCH_W + 16, height: PLANE_H, fill: p.fill, layers: p.layers, marker: p.marker },
      row([
        { type: "badge", key: `model-${st.model}`, text: st.model.toUpperCase(), color: focused ? "violet" : "grey", transition: { enter: "fade", exit: "none" } },
        text(readout(st), { style: "mono", size: "xs", color: focused ? undefined : "muted", width: SWATCH_W + 16 - 64 }),
      ], { key: "readout", minHeight: 20 }),
    ],
    { key: "left", gap: 2, align: "start" },
  );
}

const NOTATIONS: [string, Parameters<typeof write>[2]][] = [["Hex", "hex"], ["RGB", "rgb"], ["HSL", "hsl"], ["HWB", "hwb"], ["OKLCH", "oklch"], ["OKLab", "oklab"], ["Lab", "lab"], ["P3", "p3"]];

function notationColumn(st: State, s: Settings, tokens: { tailwind: Row[]; material: Row[] }): ViewNode {
  const c = st.color;
  const label = (v: string) => text(v, { style: "muted", size: "xs", width: LABEL_W });
  const value = (v: string, key: string) => text(v, { key, style: "mono", width: VALUE_W, transition: { enter: "fade", exit: "none" } });
  const line = (l: string, v: string, key: string) => row([label(l), value(v, key)], { key, minHeight: 18 });
  const exact = nameOf(c);
  const near = exact ? undefined : nearestName(c);
  const tw = nearestIn(c, tokens.tailwind), md = nearestIn(c, tokens.material);
  const tokenLine = (l: string, hit: { row: Row; distance: number } | undefined) =>
    hit ? row([label(l), { type: "tile", width: 12, height: 12, color: hit.row.h as HexColor }, text(hit.row.id.slice(hit.row.id.indexOf("/") + 1), { key: `${l}-${hit.row.id}`, style: "mono", transition: { enter: "fade", exit: "none" } }), text(hit.distance < 0.005 ? "exact" : hit.distance < 0.02 ? "close" : hit.distance < 0.06 ? "near" : "far", { style: "muted", size: "xs" })], { key: l, minHeight: 18 }) : row([], { key: l });
  const prev = previous(st);
  const contrastLine = (l: string, on: RGB, key: string, swatch?: boolean) => {
    const r = ratio(c, on);
    return row([label(l), ...(swatch ? [{ type: "tile", width: 12, height: 12, color: hex(on) } as ViewNode] : []), text(r.text, { style: "number", size: "sm", width: 56 }), { type: "badge", key: `${key}-${r.level}`, text: r.level, color: LEVEL_COLOR[r.level], transition: { enter: "fade", exit: "none" } }], { key, minHeight: 18 });
  };
  return column(
    [
      ...NOTATIONS.map(([l, f]) => line(l, write(c, s, f), `n-${f}`)),
      line("Name", exact ?? `${near!.name} (nearest)`, "n-name"),
      { type: "divider", key: "d1" },
      tokenLine("Tailwind", tw),
      tokenLine("Material", md),
      { type: "divider", key: "d2" },
      contrastLine("On white", WHITE, "cw"),
      contrastLine("On black", BLACK, "cb"),
      ...(prev ? [contrastLine("Previous", prev, "cp", true)] : []),
    ],
    { key: "notations", gap: 1 },
  );
}

const ROW_TITLES: Record<Exclude<Focus, "swatch">, string> = { tints: "Tints", shades: "Shades", complementary: "Complementary", analogous: "Analogous", triadic: "Triadic", split: "Split", tetradic: "Tetradic" };

/** One row of tiles: the highlighted one is taller and the label names its hex while the row has the focus. */
function scaleRow(st: State, which: Exclude<Focus, "swatch">): ViewNode {
  const colors = rowColors(st, which);
  const on = st.focus === which;
  const picked = on ? colors[st.index] : undefined;
  return column(
    [
      row([text(ROW_TITLES[which], { style: "muted", size: "xs", weight: on ? "semibold" : undefined, color: on ? "accent" : "muted" }), ...(picked ? [text(toHex(picked), { key: `pk-${which}-${toHex(picked)}`, style: "mono", size: "xs", transition: { enter: "fade", exit: "none" } })] : [])], { key: "t", minHeight: 14, gap: 2 }),
      row(
        colors.map((c, i) => ({ type: "tile", key: `${which}-${i}-${toHex(c)}`, width: on && i === st.index ? TILE_ON : TILE, height: on && i === st.index ? TILE_ON : TILE, color: hex(c), transition: { enter: "fade", exit: "none" } }) as ViewNode),
        { key: "r", gap: 1, minHeight: TILE_ON },
      ),
    ],
    { key: which, gap: 0 },
  );
}

/** Every action the picker answers to, for this state; the first listed is Enter. */
export function actions(st: State, s: Settings): Action[] {
  const onSwatch = st.focus === "swatch";
  const copy = write(st.color, s);
  const acts: Action[] = [];
  if (!onSwatch) acts.push({ id: "use", title: `Use ${toHex(rowColors(st, st.focus)[st.index] ?? st.color)}`, shortcut: "enter" });
  acts.push({ id: "copy", title: `Copy ${copy}`, shortcut: "c" });
  acts.push({ id: "copy:hex", title: "Copy hex", shortcut: "cmd+c" });
  acts.push({ id: "pick", title: "Pick Colour from Screen", shortcut: "p" });
  acts.push({ id: "history", title: "History", shortcut: "h" });
  acts.push({ id: "names", title: "Named Colours", shortcut: "n" });
  acts.push({ id: "model", title: st.model === "hsl" ? "Edit in OKLCH" : "Edit in HSL", shortcut: "m" });
  acts.push({ id: "undo", title: "Back to the previous colour", shortcut: "u" });
  acts.push({ id: "random", title: "Random colour", shortcut: "r" });
  // On a row the arrows walk it and step between rows; Tab always cycles.
  acts.push({ id: "focus:next", title: "Focus the next row", shortcut: onSwatch ? "tab" : ["tab", "down"] });
  acts.push({ id: "focus:prev", title: "Focus the previous row", shortcut: onSwatch ? "shift+tab" : ["shift+tab", "up"] });
  for (const [f, t, k] of [["rgb", "Copy rgb", "cmd+shift+r"], ["hsl", "Copy hsl", "cmd+shift+h"], ["oklch", "Copy oklch", "cmd+shift+o"], ["lab", "Copy lab", "cmd+shift+l"], ["p3", "Copy display-p3", "cmd+shift+p"], ["name", "Copy the CSS name", "cmd+shift+n"], ["hwb", "Copy hwb", undefined], ["oklab", "Copy oklab", undefined]] as const) acts.push({ id: `copy:${f}`, title: t, shortcut: k });
  if (onSwatch) {
    acts.push({ id: "h+", title: "Hue +5°", shortcut: "right", hidden: true }, { id: "h-", title: "Hue -5°", shortcut: "left", hidden: true });
    acts.push({ id: "h++", title: "Hue +15°", shortcut: "shift+right", hidden: true }, { id: "h--", title: "Hue -15°", shortcut: "shift+left", hidden: true });
    acts.push({ id: "l+", title: "Lighter", shortcut: "up", hidden: true }, { id: "l-", title: "Darker", shortcut: "down", hidden: true });
    acts.push({ id: "l++", title: "Much lighter", shortcut: "shift+up", hidden: true }, { id: "l--", title: "Much darker", shortcut: "shift+down", hidden: true });
    acts.push({ id: "s+", title: st.model === "hsl" ? "More saturated" : "More chroma", shortcut: ["+", "="], hidden: true }, { id: "s-", title: st.model === "hsl" ? "Less saturated" : "Less chroma", shortcut: "-", hidden: true });
  } else {
    acts.push({ id: "along:next", title: "Next tile", shortcut: "right", hidden: true }, { id: "along:prev", title: "Previous tile", shortcut: "left", hidden: true });
  }
  // Typing: a digit or # opens the text field with that character; the field's Enter and Escape are these two (`View.input`), whose keys never arrive as bare keys.
  for (const d of "0123456789#") acts.push({ id: `type:${d}`, title: `Type ${d}`, shortcut: d, hidden: true });
  acts.push({ id: "apply", title: "Apply", hidden: true, shortcut: "enter" }, { id: "cancel", title: "Stop typing", hidden: true, shortcut: "escape" });
  return acts;
}

/** The line under everything: what the keys do here, which changes with the focus. */
function hints(st: State): ViewNode {
  const hint = (keys: string[], what: string): ViewNode[] => [...keys.map(keycap), text(what, { style: "muted", size: "xs" })];
  if (st.typing !== undefined) return row([text("Type any notation: #ff8800, rgb(255 136 0), hsl(30 100% 50%), oklch(0.75 0.18 60), lab(), color(display-p3 …), a name", { style: "muted", size: "xs" }), { type: "spacer" }, ...hint(["enter"], "apply"), ...hint(["escape"], "close")], { key: "hints-typing", gap: 1, minHeight: 24, transition: { enter: "fade", exit: "none" } });
  const items = st.focus === "swatch"
    ? [...hint(["left", "right"], "hue"), ...hint(["up", "down"], "lightness"), ...hint(["-", "+"], st.model === "hsl" ? "saturation" : "chroma"), ...hint(["shift"], "big steps"), ...hint(["m"], st.model === "hsl" ? "oklch" : "hsl"), ...hint(["tab"], "rows")]
    : [...hint(["left", "right"], "tile"), ...hint(["enter"], "use it"), ...hint(["tab", "shift+tab"], "rows"), ...hint(["up", "down"], "row")];
  return row([...items, { type: "spacer" }, ...hint(["p"], "pick"), ...hint(["0-9", "#"], "type"), ...hint(["c"], "copy")], { key: `hints-${st.focus === "swatch" ? "swatch" : "row"}`, gap: 1, minHeight: 24, transition: { enter: "fade", exit: "none" } });
}

export function render(st: State, s: Settings, tokens: { tailwind: Row[]; material: Row[] }): View {
  const scales = column((ROWS.filter((r) => r !== "swatch") as Exclude<Focus, "swatch">[]).map((r) => scaleRow(st, r)), { key: "scales", gap: 1, align: "start" });
  const tree = column(
    [row([swatchColumn(st, s), notationColumn(st, s, tokens), scales], { key: "main", gap: 4, align: "start" }), { type: "spacer", key: "fill" }, hints(st)],
    { key: "picker", padding: 4, gap: 2, grow: true },
  );
  const view: View = { tree, actions: actions(st, s), title: titleOf(st.color), id: "picker", keys: "actions" };
  if (st.typing !== undefined) view.input = { value: st.typing, placeholder: "#ff8800, rgb(255 136 0), hsl(30 100% 50%), oklch(0.75 0.18 60), lab(), a name", submit: "apply", cancel: "cancel" };
  return view;
}
