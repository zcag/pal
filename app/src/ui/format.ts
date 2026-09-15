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
