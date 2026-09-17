// The rows and details the list palettes answer, pure: the detail pane of a
// colour (a wide swatch over the notations, the name, contrast, and for a
// set's tile where the token is used), the grid's tiles, the converter's
// rows and the history's. No host imports: the gallery's fixture builds its
// rows with these same functions.
import type { Action, Detail, Item, Metadata } from "@zcag/pal";
import { BLACK, WHITE, contrast, nameOf, nearestName, parse, swatch, toHex, wcag, type Format, type RGB } from "./color.ts";
import { setInfo, token, usage, type Row } from "./sets.ts";
import { ago, write, type Settings, type Source, type State } from "./state.ts";

// ---- details ----------------------------------------------------------------------------------

const ratio = (c: RGB, on: RGB) => { const r = contrast(c, on); return { text: `${r.toFixed(2)}:1`, level: wcag(r) }; };
const LEVEL_COLOR = { AAA: "green", AA: "green", "AA large": "amber", fail: "red" } as const;
const swatchWide = (hex: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 48"><rect width="400" height="48" rx="8" fill="${hex}"/></svg>`)}`;
const NOTATIONS: [string, Format][] = [["Hex", "hex"], ["RGB", "rgb"], ["HSL", "hsl"], ["HWB", "hwb"], ["OKLCH", "oklch"], ["OKLab", "oklab"], ["Lab", "lab"], ["P3", "p3"]];

/** A wide swatch over the notations, the name, contrast on white and black; for a set's row, where the token is used. */
export function detailOf(c: RGB, title: string, s: Settings, row?: Row): Detail {
  const exact = nameOf(c);
  const near = exact ? undefined : nearestName(c);
  const [w, b] = [ratio(c, WHITE), ratio(c, BLACK)];
  const metadata: Metadata[] = [
    ...NOTATIONS.map(([label, f]) => ({ label, value: write(c, s, f) })),
    exact ? { label: "CSS name", value: exact } : { label: "Nearest name", value: near!.name, tags: [{ text: near!.distance < 0.02 ? "close" : near!.distance < 0.06 ? "near" : "far", color: "grey" as const }] },
    { label: "On white", value: w.text, tags: [{ text: w.level, color: LEVEL_COLOR[w.level] }] },
    { label: "On black", value: b.text, tags: [{ text: b.level, color: LEVEL_COLOR[b.level] }] },
  ];
  const hex = toHex(c);
  const used = row ? `\n\n${usage(row)}` : "";
  return { markdown: `![${hex}](${swatchWide(hex)})\n\n**${title}**${used}`, metadata };
}

// ---- the converter -----------------------------------------------------------------------------

/** The hint rows' glyph (md-information_outline); it takes the extension's indigo from the manifest's tile. */
const HINT_ICON = "\u{f02fd}";
export const hint = (name: string, subtitle: string): Item => ({ id: `hint:${name}`, name, subtitle, icon: HINT_ICON, actions: [] });
export const HINTS = [
  hint("Type a colour", "#ff8800, rgb(255 136 0), hsl(30 100% 50%), hwb(), oklch(0.75 0.18 60), oklab(), lab(), color(display-p3 …), or a CSS name"),
  hint("Every row is one notation of it", "Enter opens it in the picker, cmd+enter copies the row; the detail pane (cmd+i) has contrast and the nearest name"),
];

/** The conversions of `c`, one row each; the row's id is its value. */
export function conversions(c: RGB, s: Settings): Item[] {
  const exact = nameOf(c);
  const near = exact ? undefined : nearestName(c);
  const detail = detailOf(c, exact ?? toHex(c), s);
  const icon = { image: swatch(toHex(c)) };
  const actions: Action[] = [{ id: "open", title: "Open in Picker" }, { id: "copy", title: "Copy" }];
  const row = (id: string, name: string, subtitle: string, accessories?: Item["accessories"]): Item => ({ id, name, subtitle, icon, detail, accessories, actions });
  const [w, b] = [ratio(c, WHITE), ratio(c, BLACK)];
  return [
    ...NOTATIONS.map(([label, f]) => { const v = write(c, s, f); return row(v, v, label.toLowerCase() === "p3" ? "display-p3" : label.toLowerCase()); }),
    exact ? row(exact, exact, "CSS name") : row(near!.name, near!.name, `nearest CSS name, ${toHex(parse(near!.name)!)}`, [{ tag: near!.distance < 0.02 ? "close" : near!.distance < 0.06 ? "near" : "far", color: "grey" }]),
    row(w.text, `${w.text} on white`, "contrast ratio", [{ tag: w.level, color: LEVEL_COLOR[w.level] }]),
    row(b.text, `${b.text} on black`, "contrast ratio", [{ tag: b.level, color: LEVEL_COLOR[b.level] }]),
  ];
}

// ---- history -------------------------------------------------------------------------------------

export const PICK_ROW = "pick";
export const HISTORY_ACTIONS: Action[] = [
  { id: "open", title: "Open in Picker" },
  { id: "copy", title: "Copy" },
  { id: "hex", title: "Copy hex", shortcut: "cmd+shift+c" },
  { id: "delete", title: "Remove from History", shortcut: "cmd+d", style: "destructive" },
  { id: "clear", title: "Clear History", shortcut: "cmd+shift+d", style: "destructive", confirm: "Clear the colour history? Every picked and copied colour is forgotten." },
];
const FROM: Record<Source, string> = { screen: "picked from the screen", typed: "typed", set: "from a set", picker: "from the picker", convert: "converted", history: "from history" };

export function historyRows(st: State, s: Settings, now: number): Item[] {
  const head: Item = { id: PICK_ROW, name: "Pick Colour from Screen", subtitle: "The system's loupe; the colour is copied and remembered", icon: "󰈊", keywords: ["color", "colour", "eyedropper", "sample"], section: "Pick", actions: [{ id: "pick", title: "Pick Colour from Screen" }, { id: "open", title: "Open the Picker", shortcut: "cmd+enter" }] };
  return [head, ...st.history.map((e): Item => {
    const c = parse(e.c) ?? BLACK;
    return {
      id: e.c, name: write(c, s, "hex"), subtitle: `${e.name ? `${e.name} · ` : ""}${FROM[e.from] ?? e.from} · ${ago(e.at, now)}`,
      icon: { image: swatch(e.c) }, keywords: [e.c, ...(e.name ? [e.name] : []), e.from, nameOf(c) ?? nearestName(c).name], section: "History",
      // The chosen notation when it adds to the hex in the name; else the CSS name, approximate when not exact.
      accessories: [{ text: s.format === "hex" ? (nameOf(c) ?? `≈ ${nearestName(c).name}`) : write(c, s) }],
    };
  })];
}

export const GRID_ACTIONS: Action[] = [
  { id: "open", title: "Open in Picker" },
  { id: "copy", title: "Copy" },
  { id: "hex", title: "Copy hex", shortcut: "cmd+shift+c" },
  { id: "name", title: "Copy name", shortcut: "cmd+shift+n" },
];
/** A set's row as a grid tile: the swatch fills the box, the hex is the subtitle, the token and the set are keywords. */
export const gridItem = (r: Row, section: string): Item => ({ id: r.id, name: r.n.replace(/ \((?:light|dark|latte|frappe|macchiato|mocha|main|moon|dawn)\)$/i, ""), subtitle: r.v ? `${r.h} · ${r.v}` : r.h, icon: { image: swatch(r.h) }, keywords: [r.h, token(r), setInfo(r.s).title.toLowerCase(), ...(r.v ? [r.v] : [])], section });
