import { useSyncExternalStore } from "react";
import { isMac } from "./keys";
import type { Shortcut } from "./types";

const macGlyph: Record<string, string> = {
  cmd: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧",
  enter: "↵", backspace: "⌫", escape: "esc", tab: "⇥", space: "␣",
  arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→",
};
const otherName: Record<string, string> = { cmd: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift", enter: "Enter", backspace: "Bksp", escape: "Esc", tab: "Tab" };

/** Keys of a shortcut as the platform writes them: ["⌘", "⇧", "C"] or ["Ctrl", "Shift", "C"]. */
export function shortcutKeys(s: Shortcut): string[] {
  return s.split("+").map((p) => (isMac ? macGlyph[p] : otherName[p]) ?? p.toUpperCase());
}

const units: [number, string][] = [[60, "s"], [60, "m"], [24, "h"], [7, "d"], [4.35, "w"], [12, "mo"], [Infinity, "y"]];

/** "now", "5m", "3h", "2d", "3w", "4mo", "2y"; future as "in 5m". */
export function relativeDate(d: string | number | Date, now = Date.now()): string {
  const diff = (now - new Date(d).getTime()) / 1000;
  let n = Math.abs(diff);
  if (n < 45) return "now";
  let label = "s";
  for (const [size, unit] of units) {
    label = unit;
    if (n < size) break;
    n /= size;
  }
  const text = `${Math.round(n)}${label}`;
  return diff < 0 ? `in ${text}` : text;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/**
 * Grapheme clusters of `text`, the unit the core's match positions count
 * (nucleo segments with unicode-segmentation). Code points when the webview
 * has no Segmenter, where a flag or a ZWJ emoji then counts as several.
 */
export const graphemes = (text: string): string[] => (segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : [...text]);

/** UTF-16 offsets into `text` (what the in-webview fzf reports) as grapheme positions, for `Highlight`. */
export function graphemePositions(text: string, units: Iterable<number>): Set<number> {
  const at = new Map<number, number>();
  let offset = 0;
  graphemes(text).forEach((g, i) => { for (let u = 0; u < g.length; u++) at.set(offset + u, i); offset += g.length; });
  const out = new Set<number>();
  for (const u of units) { const i = at.get(u); if (i !== undefined) out.add(i); }
  return out;
}

/*
 * One clock for every relative date on screen: a single interval that only
 * runs while something subscribes, so "2m" ticks to "3m" without a timer
 * per row.
 */
const TICK_MS = 15_000;
const listeners = new Set<() => void>();
let tick = 0, timer: ReturnType<typeof setInterval> | undefined;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  timer ??= setInterval(() => { tick++; listeners.forEach((l) => l()); }, TICK_MS);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) { clearInterval(timer); timer = undefined; }
  };
};

/** Re-renders the caller every 15 s; returns the current time. */
export function useNow(): number {
  useSyncExternalStore(subscribe, () => tick, () => tick);
  return Date.now();
}
