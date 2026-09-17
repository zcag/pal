// Writes app/src/gallery/shots/colors.json: the store screenshots' fixture.
// The picker's trees come from render.ts over rigged states (a colour with
// a history behind it, the shades row focused, the text field open), the
// grid and the history rows from the same functions the palettes use, so
// the shots show what the panel draws without a screen to pick from.
// `bun run extensions/colors/fixture.ts`, then `node app/scripts/shots.mjs colors`.
import { writeFileSync } from "node:fs";
import { parse, swatch, toHex } from "./color.ts";
import { GRID_ACTIONS, HISTORY_ACTIONS, conversions, gridItem, historyRows } from "./rows.ts";
import { render } from "./render.ts";
import { SETS, sectionOf, type Row, type SetId } from "./sets.ts";
import { DEFAULTS, apply, fresh, type Entry, type State } from "./state.ts";
import data from "./data.json";

const rows = data as Row[];
const bySet = (id: SetId) => rows.filter((r) => r.s === id);
const tokens = { tailwind: bySet("tailwind"), material: bySet("material") };
const NOW = 1_758_000_000_000;
const history: Entry[] = [
  { c: "#ff8800", at: NOW - 40_000, from: "screen" },
  { c: "#64748b", at: NOW - 15 * 60_000, from: "set", name: "slate-500" },
  { c: "#cba6f7", at: NOW - 2 * 3_600_000, from: "set", name: "mocha/mauve" },
  { c: "#663399", at: NOW - 26 * 3_600_000, from: "typed" },
  { c: "#30d158", at: NOW - 3 * 86_400_000, from: "set", name: "systemGreen" },
  { c: "#f6c177", at: NOW - 5 * 86_400_000, from: "picker" },
];
const base: State = { ...fresh(), color: parse("#ff8800")!, history };
const shades = { ...apply(apply(base, { kind: "focus", dir: 1 }, 50), { kind: "focus", dir: 1 }, 50), index: 3 };
const typing = apply(base, { kind: "type", text: "#ff88" }, 50);
const s = DEFAULTS;

const gridItems = [...["tw/slate-500", "ctp/mocha/mauve", "apple/dark/green"].map((id) => gridItem(rows.find((r) => r.id === id)!, "Recent")), ...rows.map((r) => gridItem(r, sectionOf(r)))];
const historyItems = historyRows(base, s, NOW);

const TILE = { tile: { glyph: "\u{f03d8}", bg: "indigo" } };
const fixture = {
  palettes: {
    picker: { title: "Colour Picker", icon: TILE, view: "view", tree: render(base, s, tokens) },
    "picker-shades": { title: "Colour Picker", icon: TILE, view: "view", tree: render(shades, s, tokens) },
    "picker-typing": { title: "Colour Picker", icon: TILE, view: "view", tree: render(typing, s, tokens) },
    colors: { title: "Named Colours", icon: TILE, view: "grid", columns: 8, filters: [{ id: "all", title: "All sets" }, ...SETS.map((x) => ({ id: x.id, title: x.title }))], items: gridItems.map((i) => ({ ...i, actions: GRID_ACTIONS })), byFilter: { catppuccin: bySet("catppuccin").map((r) => ({ ...gridItem(r, sectionOf(r)), actions: GRID_ACTIONS })) } },
    history: { title: "Colour History", icon: TILE, items: historyItems.map((i) => (i.actions ? i : { ...i, actions: HISTORY_ACTIONS })) },
    convert: { title: "Convert Colour", icon: TILE, input: true, placeholder: "#ff8800, rgb(255 136 0), hsl(30 100% 50%), lab(), a name", byQuery: { "": [], "hsl(30 100% 50%)": conversions(parse("hsl(30 100% 50%)")!, s) } },
  },
  effects: {
    "picker/picker:h+": { view: render({ ...base, color: parse("hsl(37 100% 50%)")! }, s, tokens) },
    "picker-shades/picker:along:next": { view: render({ ...shades, index: 4 }, s, tokens) },
  },
  shots: {
    // The picker's gradients do not survive the 256-colour quantisation, so these three stay true colour.
    "1-picker": { palette: "picker", keys: ["wait:400"], raw: true },
    "2-shades": { palette: "picker-shades", keys: ["wait:300", "right", "wait:500"], raw: true },
    "3-typing": { palette: "picker-typing", keys: ["wait:300", "type:00", "wait:400"], raw: true },
    "4-sets": { palette: "colors", keys: ["wait:300", "tab*6", "wait:500"] },
    "5-history": { palette: "history", keys: ["wait:300", "down", "wait:300"] },
    "6-convert": { palette: "convert", keys: ["wait:200", "type:hsl(30 100% 50%)", "wait:400"] },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/colors.json", import.meta.url), JSON.stringify(fixture) + "\n");
console.log(`picker ${toHex(base.color)}, ${gridItems.length} tiles, ${historyItems.length} history rows`);
