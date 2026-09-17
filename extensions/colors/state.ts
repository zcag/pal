// The picker's state and its pure moves: the colour under the keys, the
// model the arrows edit in, what the focus is on (the swatch, or a tile
// of a scale or harmony row), the typing field, and the history of picked
// and copied colours (newest first, one entry per colour, capped). No
// host imports: index.ts persists what `persisted` says, render.ts draws.
import { colors } from "@zcag/pal";
const { BLACK, WHITE, adjust, format, harmony, nameOf, nearestName, parse, shades, tints, toHex } = colors;
type Axis = colors.Axis;
type Format = colors.Format;
type Harmony = colors.Harmony;
type Model = colors.Model;
type RGB = colors.RGB;

/** Where a history entry came from. */
export type Source = "screen" | "typed" | "set" | "picker" | "convert" | "history";
/** One remembered colour: the hex (alpha included), when, where from, and the set token when it was one. */
export type Entry = { c: string; at: number; from: Source; name?: string };

/** `[extensions.colors]`, defaults in pal.json. */
export type Settings = { format: Format; uppercase: boolean; alpha: "keep" | "drop"; sets: string[]; history_size: number };
export const DEFAULTS: Settings = { format: "hex", uppercase: false, alpha: "keep", sets: ["css", "tailwind", "material3", "material", "apple", "catppuccin", "rosepine", "nord", "solarized", "pal"], history_size: 50 };

/** What Tab walks: the swatch (the arrows edit), then each row of tiles (the arrows move along it, Enter takes the tile). */
export const ROWS = ["swatch", "tints", "shades", "complementary", "analogous", "triadic", "split", "tetradic"] as const;
export type Focus = (typeof ROWS)[number];

export type State = {
  color: RGB;
  model: Model;
  focus: Focus;
  /** The highlighted tile of the focused row. */
  index: number;
  /** The text field's value while it is open. */
  typing?: string;
  history: Entry[];
};

/** The colour the picker opens on before anything was picked: pal's accent. */
const DEFAULT_COLOR = "#4f46d6";

export const fresh = (): State => ({ color: parse(DEFAULT_COLOR)!, model: "hsl", focus: "swatch", index: 0, history: [] });

/** The tiles of a row, in the order drawn. */
export function rowColors(st: State, row: Focus): RGB[] {
  switch (row) {
    case "swatch": return [st.color];
    case "tints": return tints(st.color);
    case "shades": return shades(st.color);
    default: return harmony(st.color, row as Harmony);
  }
}

/** The last remembered colour that is not the current one: what the contrast row compares with and `u` goes back to. */
export function previous(st: State): RGB | undefined {
  const cur = toHex(st.color);
  const e = st.history.find((h) => h.c !== cur);
  return e ? parse(e.c) : undefined;
}

/** `history` with `entry` in front, an older entry of the same colour dropped, capped at `max`. */
export function remember(history: Entry[], entry: Entry, max: number): Entry[] {
  return [entry, ...history.filter((h) => h.c !== entry.c)].slice(0, Math.max(1, max));
}

export type Move =
  | { kind: "set"; color: RGB; from: Source; name?: string; at: number }
  | { kind: "step"; axis: Axis; steps: number }
  | { kind: "model" }
  | { kind: "focus"; dir: 1 | -1 }
  | { kind: "along"; dir: 1 | -1 }
  | { kind: "use"; at: number }
  | { kind: "undo" }
  | { kind: "random"; hue: number; sat: number; light: number }
  | { kind: "type"; text?: string }
  | { kind: "apply"; text: string; at: number }
  | { kind: "copied"; at: number }
  | { kind: "clear" };

/** The state after a move; `max` caps the history. A move that changes nothing answers the same object. */
export function apply(st: State, m: Move, max: number): State {
  switch (m.kind) {
    case "set": {
      const history = remember(st.history, { c: toHex(m.color), at: m.at, from: m.from, name: m.name }, max);
      return { ...st, color: m.color, focus: "swatch", index: 0, typing: undefined, history };
    }
    case "step": {
      if (st.focus !== "swatch") return st;
      const color = adjust(st.color, st.model, m.axis, m.steps);
      return toHex(color) === toHex(st.color) ? st : { ...st, color };
    }
    case "model": return { ...st, model: st.model === "hsl" ? "oklch" : "hsl" };
    case "focus": {
      const i = (ROWS.indexOf(st.focus) + m.dir + ROWS.length) % ROWS.length;
      return { ...st, focus: ROWS[i], index: 0 };
    }
    case "along": {
      if (st.focus === "swatch") return st;
      const n = rowColors(st, st.focus).length;
      return { ...st, index: (st.index + m.dir + n) % n };
    }
    case "use": {
      if (st.focus === "swatch") return st;
      const c = rowColors(st, st.focus)[st.index];
      return c ? apply(st, { kind: "set", color: { ...c, a: st.color.a }, from: "picker", at: m.at }, max) : st;
    }
    case "undo": {
      const p = previous(st);
      return p ? { ...st, color: p, focus: "swatch", index: 0 } : st;
    }
    case "random": return { ...st, color: parse(`hsl(${m.hue} ${m.sat}% ${m.light}%)`)!, focus: "swatch", index: 0 };
    case "type": return { ...st, typing: m.text ?? "" };
    case "apply": {
      const c = parse(m.text);
      if (!c) return { ...st, typing: m.text };
      return apply(st, { kind: "set", color: c, from: "typed", at: m.at }, max);
    }
    case "copied": return { ...st, history: remember(st.history, { c: toHex(st.color), at: m.at, from: "picker" }, max) };
    case "clear": return { ...st, history: [] };
  }
}

/** The colour written as the settings want it. */
export const write = (c: RGB, s: Settings, f: Format = s.format) => format(c, f, { upper: s.uppercase, alpha: s.alpha });

/** The title of the picker: the hex, and the CSS name when it has one exactly. */
export const titleOf = (c: RGB): string => { const n = nameOf(c); return n ? `${toHex(c)} · ${n}` : toHex(c); };

/** "just now", "4 min ago", "2 h ago", "yesterday", "3 d ago". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} d ago`;
}

export { BLACK, WHITE, nearestName };
