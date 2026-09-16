// Large Type as data: how big the text can be for the window, whether it
// reads as a code (monospace), and a code's digits in groups. Pure, so the
// tests pin the numbers; LargePage.tsx applies them.

/** Type size bounds, px: below the floor Large Type is no longer large; above the ceiling a two-digit code fills the room without gain. */
export const MIN_SIZE = 28;
export const MAX_SIZE = 260;
/** Average glyph advance as a fraction of the size: the system UI face at semibold, and the mono face. */
const ADVANCE = { ui: 0.56, mono: 0.62 };
/** Line height as a fraction of the size, matching the page's CSS. */
const LEADING = 1.15;
/** How much of the window the text may fill, per axis. */
const FILL = 0.86;

const clamp = (n: number) => Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)));
const chars = (s: string) => Math.max(1, [...s].length);

/**
 * The font size that fits `text` into `width` by `height` px. Text with
 * line breaks keeps its lines and is sized so the longest fits the width
 * and all of them the height. A single line may wrap (the page wraps at
 * the window's width), so it gets the larger of its one-row size and the
 * size the area allows when wrapped. Never under `MIN_SIZE` or over
 * `MAX_SIZE`.
 */
export function fit(text: string, width: number, height: number, mono = isCode(text)): number {
  const advance = mono ? ADVANCE.mono : ADVANCE.ui;
  const lines = text.split("\n");
  const longest = Math.max(...lines.map(chars));
  const w = width * FILL, h = height * FILL;
  const rows = Math.min(w / (longest * advance), h / (lines.length * LEADING));
  if (lines.length > 1) return clamp(rows);
  // Wrapped: n rows of w/(size*advance) glyphs with n*size*LEADING <= h, so size^2 <= w*h / (chars*advance*LEADING).
  const wrapped = Math.sqrt((w * h) / (chars(text) * advance * LEADING));
  return clamp(Math.max(rows, wrapped));
}

/** A code, a hash, an address, a key: one token with a digit or a symbol in it, shown in monospace so its characters line up and 0/O and 1/l tell apart. */
export const isCode = (text: string): boolean => !/\s/.test(text.trim()) && /[\d#$%&*+\-./:=@_\\~]/.test(text);

/**
 * Digits in groups so a code reads as one: six as two threes (the
 * authenticator convention), nine as three, otherwise fours from the
 * left (`1234 5678 90`). Only for a run of 5 to 16 digits; anything
 * else comes back as it was.
 */
export function groupDigits(text: string): string {
  const t = text.trim();
  if (!/^\d{5,16}$/.test(t)) return text;
  const size = t.length === 6 || t.length === 9 ? 3 : 4;
  return t.match(new RegExp(`\\d{1,${size}}`, "g"))!.join(" ");
}

/** What the page shows: the digits grouped, everything else as given. */
export const display = (text: string): string => groupDigits(text);
