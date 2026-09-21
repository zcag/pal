// The bar popover as a tree (`View` in `@zcag/pal`), pure: index.ts hands
// it the core's status, the fixture renders made-up ones through the same
// function. The three modes as tiles (the one on wears the accent ring),
// the shortcuts-only switch on its own row, and a line of key hints; the
// first action is Stop while on (a click on the red dot, then Enter), and
// Start in the default mode while the strip keeps the item at Always.
import { POPOVER_W, column, keyHint, row, text, type Action, type View, type ViewNode } from "@zcag/pal";

export type Mode = "keys" | "cursor" | "both";
/** `core/keycast.status` (app keycast.rs `Status`): on or off, the mode, whether the OS lets pal watch, and the settings as resolved. */
export type Status = { available: boolean; reason?: string; active: boolean; mode: Mode; input_monitoring: boolean; settings: { mode: Mode; position: string; scale: number; hold: number; max: number; shortcuts_only: boolean; ring: boolean; ring_color: string; ripples: boolean } };

export const MODES: Mode[] = ["keys", "cursor", "both"];
/** The mode's word, for a row, a tooltip, the HUD. */
export const modeWord = (m: Mode): string => (m === "keys" ? "keys" : m === "cursor" ? "cursor" : "keys and cursor");
/** The mode as the strip's short title. */
export const modeShort = (m: Mode): string => (m === "both" ? "keys + cursor" : m);
/** The mode's tile: a title and what it draws, one line each. */
const TILE: Record<Mode, { title: string; sub: string; key: string; action: string }> = {
  keys: { title: "Keys", sub: "caps", key: "k", action: "Keys only" },
  cursor: { title: "Cursor", sub: "ring", key: "c", action: "Cursor only" },
  both: { title: "Both", sub: "caps + ring", key: "b", action: "Keys and cursor" },
};
/** The position setting's word. */
export const positionWord = (p: string): string => ({ "bottom-center": "bottom centre", "bottom-left": "bottom left", "bottom-right": "bottom right", "top-right": "top right", "top-left": "top left" }[p] ?? p);

/** Three tiles across the popover's width, two gaps between. */
const TILE_W = Math.floor((POPOVER_W - 16) / 3);

function tiles(st: Status): ViewNode {
  return row(MODES.map((m): ViewNode => {
    const on = st.active && st.mode === m;
    return { type: "tile", key: `mode-${m}`, width: TILE_W, height: 48, text: TILE[m].title, sub: TILE[m].sub, color: on ? "accent" : "neutral", fill: on ? "solid" : "soft", action: `mode:${m}`, ...(on && { selected: true }) };
  }), { key: "modes", gap: 2, minHeight: 48 });
}

function status(st: Status): ViewNode {
  const line = !st.available ? st.reason ?? "Not available here"
    : !st.input_monitoring ? "Needs Input Monitoring: nothing typed reaches pal until it is granted"
    : st.active ? `Showing ${modeWord(st.mode)} · strip at the ${positionWord(st.settings.position)} · hold ${st.settings.hold} s`
    : "Off · Enter starts in the default mode";
  return text(line, { key: `status-${st.active}-${st.input_monitoring}`, style: "muted", size: "xs", width: POPOVER_W - 8, transition: { enter: "fade", exit: "none" } });
}

function shortcuts(st: Status): ViewNode {
  return row([
    column([text("Shortcuts only", { style: "body", key: "so-title" }), text(st.settings.shortcuts_only ? "Plain typing stays off the screen" : "Every key is shown", { style: "muted", size: "xs", key: `so-sub-${st.settings.shortcuts_only}`, transition: { enter: "fade", exit: "none" } })], { key: "so-text", gap: 0, grow: true }),
    { type: "switch", key: "so-switch", on: st.settings.shortcuts_only, action: "shortcuts", label: "Shortcuts only" },
  ], { key: "shortcuts", gap: 2, padding: 1, minHeight: 32, action: "shortcuts" });
}

function hints(st: Status): ViewNode {
  return row([
    ...keyHint(["k", "c", "b"], "mode"),
    ...keyHint("s", "shortcuts only", { action: "shortcuts" }),
    ...(st.active ? keyHint("backspace", "stop", { action: "toggle" }) : keyHint("enter", "start", { action: "toggle" })),
    ...keyHint("o", "palette", { action: "open" }),
  ], { key: "hints", gap: 1, minHeight: 22 });
}

/** Every action the popover answers to; the first listed is Enter. */
export function actions(st: Status): Action[] {
  return [
    st.active ? { id: "toggle", title: "Stop keycast", shortcut: "backspace", style: "destructive" } : { id: "toggle", title: "Start keycast" },
    ...MODES.map((m): Action => ({ id: `mode:${m}`, title: st.active && st.mode === m ? `${TILE[m].action} (on)` : TILE[m].action, shortcut: TILE[m].key })),
    { id: "shortcuts", title: st.settings.shortcuts_only ? "Show every key" : "Shortcuts only", shortcut: "s" },
    { id: "open", title: "Open the Keycast palette", shortcut: "o" },
  ];
}

export function render(st: Status): View {
  const kids: ViewNode[] = st.available ? [tiles(st), status(st), shortcuts(st), hints(st)] : [status(st)];
  return { tree: column(kids, { key: "popover", padding: 3, gap: 2 }), actions: actions(st), title: st.active ? `Keycast: ${modeWord(st.mode)}` : "Keycast", id: "keycast", keys: "actions" };
}
