// The parts of a device's view a group can hand to another device
// (docs/design/controls.md): the volume row and buttons, the power button,
// the inputs row. pal's own look whoever serves them (the Apple TV
// remote's, where it came from), drawn from what `controls.get` answered;
// nothing for a control nobody serves. Every click runs a
// `controls:<control>:<op>[:<arg>]` action, which `controls.act` runs on the
// serving extension; `withControls(view)` declares the ones a tree's nodes
// run, so a view needs no list of its own.
import { parseControlAction } from "./api.ts";
import type { Action, HexColor, Served, View, ViewNode } from "./protocol.ts";
import { column, row, text } from "./rows.ts";

/** Material Design glyphs (Nerd Font) the parts are drawn with. */
export const CONTROL_GLYPHS = {
  volume: "\u{f057e}", volumeOff: "\u{f0581}", volUp: "\u{f075d}", volDown: "\u{f075e}", power: "\u{f0425}", sleep: "\u{f0904}", input: "\u{f0841}",
} as const;

/** A button while its key flashes: the accent, translucent, so the panel's ink stays on it in both themes. */
export const CONTROL_LIT: HexColor = "#4F8AE866";

/** Where a part says who serves it, unless the caller drew its own device. */
const by = (s: { provider: { device?: string } } | null | undefined) => s?.provider.device;

/** A remote button: a glyph on the button colour, `action` on a click, lit while its key flashes; `label` under it. */
export function controlButton(key: string, glyph: string, action: string, size: number, o: { lit?: boolean; label?: string } = {}): ViewNode {
  return column([
    { type: "stack", key: `btn-${key}`, width: size, height: size, surface: o.lit ? CONTROL_LIT : "elevated", radius: true, align: "center", justify: "center", action, children: [text(glyph, { style: "glyph", size: "md", color: o.lit ? "accent" : undefined })] },
    ...(o.label ? [text(o.label, { size: "xs", color: "faint", align: "center", width: size + 8 })] : []),
  ], { key: `b-${key}`, gap: 0, align: "center" });
}

/** Volume up (`dir` 1) or down: a button stepping whoever serves the volume; nothing when nobody does. */
export function volumeButton(v: Served<"volume"> | null | undefined, dir: 1 | -1, size: number, o: { lit?: boolean; label?: string } = {}): ViewNode | undefined {
  if (!v) return undefined;
  return controlButton(dir > 0 ? "vol+" : "vol-", dir > 0 ? CONTROL_GLYPHS.volUp : CONTROL_GLYPHS.volDown, `controls:volume:step:${dir}`, size, o);
}

/** Power: wake when off, sleep when on, for every member in a group; `label` says which (`wake`/`sleep`) when `labels`. */
export function powerButton(p: Served<"power"> | null | undefined, size: number, o: { lit?: boolean; labels?: boolean } = {}): ViewNode | undefined {
  if (!p) return undefined;
  const off = p.on === false;
  return controlButton("power", off ? CONTROL_GLYPHS.power : CONTROL_GLYPHS.sleep, `controls:power:set:${off}`, size, { lit: o.lit, ...(o.labels && { label: p.busy ? "…" : off ? "wake" : "sleep" }) });
}

/**
 * The volume as a row `width` wide: the glyph (a click mutes), a slider a
 * click sets and the percentage when the device reports a level, else the
 * two step buttons; the device's name under it when it is another's
 * (`device`: the caller's own, left out).
 */
export function volumeRow(v: Served<"volume"> | null | undefined, width: number, o: { device?: string } = {}): ViewNode | undefined {
  if (!v) return undefined;
  const glyph: ViewNode = { type: "stack", key: "vol-mute", action: "controls:volume:mute", children: [text(v.muted ? CONTROL_GLYPHS.volumeOff : CONTROL_GLYPHS.volume, { style: "glyph", size: "sm", color: "muted" })] };
  const other = by(v) && by(v) !== o.device ? by(v) : undefined;
  let line: ViewNode;
  if (v.level === undefined) {
    line = row([glyph, { type: "spacer", key: "vol-fill" }, volumeButton(v, -1, 28)!, volumeButton(v, 1, 28)!], { key: "volume-row", gap: 2 });
  } else {
    const pct = Math.round(v.level * 100);
    line = row([
      glyph,
      { type: "slider", key: "volume", value: v.level, width: width - 24 - 44 - 16, label: "Volume", action: "controls:volume:set" },
      text(v.muted ? "muted" : `${pct}%`, { style: "number", size: "xs", width: 44, align: "end", key: `vol-${v.muted ? "m" : pct}` }),
    ], { key: "volume-row", gap: 2 });
  }
  return other ? column([line, text(other, { size: "xs", color: "faint", key: "vol-by" })], { key: "volume", gap: 0 }) : line;
}

/** The inputs as a row of chips, the current one lit; a click switches. Nothing without a list. */
export function inputsRow(i: Served<"inputs"> | null | undefined, width: number): ViewNode | undefined {
  if (!i?.list?.length) return undefined;
  const chips = i.list.map((x): ViewNode => {
    const on = x.id === i.current;
    return { type: "stack", key: `in-${x.id}`, direction: "row", gap: 1, align: "center", padding: 1, surface: on ? CONTROL_LIT : "elevated", radius: true, action: `controls:inputs:set:${x.id}`, children: [text(x.name, { size: "xs", color: on ? "accent" : undefined, weight: on ? "semibold" : undefined })] };
  });
  return row([text(CONTROL_GLYPHS.input, { style: "glyph", size: "sm", color: "muted" }), row(chips, { key: "inputs-chips", gap: 1 })], { key: "inputs-row", gap: 2, width });
}

/** What each `controls:` action reads as in ⌘K. */
function titleOf(id: string): string {
  const a = parseControlAction(id)!;
  switch (`${a.control}:${a.op}`) {
    case "volume:set": return "Set volume";
    case "volume:step": return Number(a.arg) < 0 ? "Volume down" : "Volume up";
    case "volume:mute": return "Mute";
    case "power:set": return a.arg === "true" ? "Wake up" : a.arg === "false" ? "Sleep" : "Power";
    case "inputs:set": return `Switch input to ${a.arg ?? ""}`.trim();
    default: return `${a.control} ${a.op}`;
  }
}

/** Every `controls:` action a node of `tree` runs on a click. */
function clicked(n: ViewNode, out: Set<string>) {
  const action = (n as { action?: unknown }).action;
  if (typeof action === "string" && parseControlAction(action)) out.add(action);
  for (const c of (n as { children?: ViewNode[] }).children ?? []) clicked(c, out);
}

/** `view` with a hidden action for every `controls:` action its tree runs that it does not declare already, so `checkView` passes and ⌘K lists them. */
export function withControls(view: View): View {
  const have = new Set(view.actions.map((a) => a.id));
  const ids = new Set<string>();
  clicked(view.tree, ids);
  const extra: Action[] = [...ids].filter((id) => !have.has(id)).map((id) => ({ id, title: titleOf(id), hidden: true }));
  return extra.length ? { ...view, actions: [...view.actions, ...extra] } : view;
}
