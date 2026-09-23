// Keycast as data: what the overlay page holds and how each `pal://keycast`
// payload (keycast.rs) moves it. Pure, so the tests pin the rules;
// KeycastPage.tsx draws the result.

export type Mode = "keys" | "cursor" | "both";
export type Position = "bottom-center" | "bottom-left" | "bottom-right" | "top-right" | "top-left";
export type Button = "left" | "right" | "middle";

/** `[extensions.keycast]` as the shell resolves it (extensions/keycast/pal.json). */
export type Settings = { mode: Mode; position: Position; scale: number; hold: number; max: number; shortcuts_only: boolean; ring: boolean; ring_color: string; ripples: boolean; gestures: boolean };
/** One entry of the strip (`pal_core::keycast::Entry`): the caps, the repeat count, the last press or move in unix ms, what it is, and for a scroll how much (1..3). */
export type Entry = { id: number; keys: string[]; count: number; at: number; kind: "key" | "text" | "scroll" | "gesture"; level: number };
export type Ripple = { id: number; x: number; y: number; button: Button };

export type Payload =
  | { kind: "state"; active: boolean; mode: Mode; settings: Settings }
  | { kind: "keys"; entries: Entry[] }
  | { kind: "click"; button: Button; x: number; y: number; down: boolean }
  | { kind: "display"; inset: [number, number, number, number] };

export type State = {
  active: boolean;
  mode: Mode;
  settings: Settings | null;
  entries: Entry[];
  ripples: Ripple[];
  /** The work area's insets from the window's edges: top, right, bottom, left. */
  inset: [number, number, number, number];
};

export const DEFAULTS: Settings = { mode: "both", position: "bottom-center", scale: 1, hold: 2, max: 5, shortcuts_only: false, ring: true, ring_color: "blue", ripples: true, gestures: true };

export const initial = (): State => ({ active: false, mode: "both", settings: null, entries: [], ripples: [], inset: [0, 0, 0, 0] });

/** How many ripples may be mid-flight; a click storm past it drops the oldest. */
export const MAX_RIPPLES = 12;
let ripple = 0;

/** The page's own: a ripple's animation ended, it leaves the list. */
export type PageAction = Payload | { kind: "ripple-done"; id: number };

/** The next state for a payload. Off clears everything drawn; a click adds a ripple only while `ripples` is on. */
export function reduce(s: State, p: PageAction): State {
  switch (p.kind) {
    case "state":
      return p.active ? { ...s, active: true, mode: p.mode, settings: p.settings } : { ...initial(), settings: p.settings, mode: p.mode, inset: s.inset };
    case "keys":
      return { ...s, entries: p.entries };
    case "click": {
      if (!p.down || !(s.settings ?? DEFAULTS).ripples) return s;
      return { ...s, ripples: [...s.ripples, { id: ++ripple, x: p.x, y: p.y, button: p.button }].slice(-MAX_RIPPLES) };
    }
    case "display":
      return { ...s, inset: p.inset };
    case "ripple-done":
      return { ...s, ripples: s.ripples.filter((r) => r.id !== p.id) };
  }
}

/** The entries still inside their hold at `now`: what the page keeps in the DOM (the shell prunes on the next key, the page between keys). */
export const visible = (entries: Entry[], holdSeconds: number, now: number): Entry[] => entries.filter((e) => now - e.at < holdSeconds * 1000);

/** How long the fade at the end of the hold takes (tokens.css `--pal-dur-hud-out`). */
export const OUT_MS = 240;
/** Whether an entry is inside its last `OUT_MS` at `now`: the page marks it exiting, and an update (a scroll still going) brings it back. */
export const exiting = (e: Entry, holdSeconds: number, now: number): boolean => e.at + holdSeconds * 1000 - now <= OUT_MS;

/** A ripple's colour: the ring's for the left button, amber for the right (told apart), grey for a middle click. */
export const rippleColor = (button: Button, ring: string): string => (button === "left" ? ring : button === "right" ? "amber" : "grey");

/** Whether the strip and the ring draw for a mode. */
export const showsKeys = (mode: Mode) => mode !== "cursor";
export const showsCursor = (mode: Mode) => mode !== "keys";

/** `×3` after the caps once a key repeated; nothing for a single press. */
export const countLabel = (count: number): string | null => (count > 1 ? `×${count}` : null);

/** How far into its hold an entry is at `now`, 0 fresh to 1 at the end: the page fades and settles an entry by it. */
export const age = (e: Entry, holdSeconds: number, now: number): number => Math.min(1, Math.max(0, (now - e.at) / (holdSeconds * 1000)));

/** How long after its last character a text run still shows a caret (`pal_core::keycast::TEXT_GAP_MS`: the window in which the next character joins it). */
export const TEXT_GAP_MS = 1000;
/** Whether a text run is still taking characters: the newest entry, and its last character within the gap. */
export const liveText = (e: Entry, entries: Entry[], now: number): boolean => e.kind === "text" && entries[entries.length - 1]?.id === e.id && now - e.at < TEXT_GAP_MS;

/** The modifier glyphs (`pal_core::keycast::Mods::glyphs`), drawn a shade apart from the key they chord with. */
export const MODIFIERS = new Set(["⌃", "⌥", "⇧", "⌘"]);
export const isModifier = (cap: string): boolean => MODIFIERS.has(cap);
