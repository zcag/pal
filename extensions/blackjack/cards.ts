// Playing cards as SVG data urls, drawn here so the view needs no picture
// assets: rank and suit indices in two corners (the bottom one turned), the
// pips of a number card laid out as on a real deck, a letter card for the
// courts, and a back with a hatch pattern. No host imports: the gallery
// draws the same cards in a browser. Solitaire imports them from here too.
//
// The colours are the panel's own (tokens.css, light values): a card is
// white paper in both themes, as real cards are next to a dark table, so
// the red is `--pal-tag-red`, the ink `--pal-fg`, the back `--pal-accent`.
export type Suit = "S" | "H" | "D" | "C";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
/** `AS`, `10H`: rank then suit, as the shoe and the store carry them. */
export type Card = `${Rank}${Suit}`;

export const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS: Suit[] = ["S", "H", "D", "C"];
export const SUIT_GLYPH: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

/** 56 by 80 sits next to 40 px rows and 13 px text the way a card sits next to a chip: readable indices, four in a row under 300 px. */
export const CARD_W = 56;
export const CARD_H = 80;

export type Palette = { paper: string; ink: string; red: string; back: string; line: string };
/** tokens.css light values: `--pal-bg-elevated`, `--pal-fg`, `--pal-tag-red`, `--pal-accent`, `--pal-line-strong`. */
export const PALETTE: Palette = { paper: "#FFFFFF", ink: "#1A1A1F", red: "#B02925", back: "#4F46D6", line: "rgba(26, 26, 31, 0.16)" };

export const rankOf = (c: Card): Rank => c.slice(0, -1) as Rank;
export const suitOf = (c: Card): Suit => c.slice(-1) as Suit;
export const isRed = (c: Card) => suitOf(c) === "H" || suitOf(c) === "D";

const FONT = `-apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif`;
/** Pip columns and rows on the 56 by 80 face, as a real deck lays them: x in {L, M, R}, y in five steps. */
const L = 18, M = 28, R = 38;
const Y = [20, 30, 40, 50, 60];
/** `[x, y, turned]` per pip; the lower half is turned so the card reads the same upside down. */
const PIPS: Record<string, [number, number, boolean][]> = {
  A: [[M, 40, false]],
  "2": [[M, Y[0], false], [M, Y[4], true]],
  "3": [[M, Y[0], false], [M, Y[2], false], [M, Y[4], true]],
  "4": [[L, Y[0], false], [R, Y[0], false], [L, Y[4], true], [R, Y[4], true]],
  "5": [[L, Y[0], false], [R, Y[0], false], [M, Y[2], false], [L, Y[4], true], [R, Y[4], true]],
  "6": [[L, Y[0], false], [R, Y[0], false], [L, Y[2], false], [R, Y[2], false], [L, Y[4], true], [R, Y[4], true]],
  "7": [[L, Y[0], false], [R, Y[0], false], [M, 30, false], [L, Y[2], false], [R, Y[2], false], [L, Y[4], true], [R, Y[4], true]],
  "8": [[L, Y[0], false], [R, Y[0], false], [M, 30, false], [L, Y[2], false], [R, Y[2], false], [M, 50, true], [L, Y[4], true], [R, Y[4], true]],
  "9": [[L, 18, false], [R, 18, false], [L, 33, false], [R, 33, false], [M, 40, false], [L, 47, true], [R, 47, true], [L, 62, true], [R, 62, true]],
  "10": [[L, 18, false], [R, 18, false], [M, 25, false], [L, 33, false], [R, 33, false], [L, 47, true], [R, 47, true], [M, 55, true], [L, 62, true], [R, 62, true]],
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dataUrl = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg).replace(/%20/g, " ")}`;
/**
 * The top-left `width` by `height` of a card at full scale (the whole card
 * by default): a covered card in a solitaire column is a strip of it, a
 * fanned waste card a sliver. Cropped in the picture, since the view draws
 * an image `object-fit: contain` and would shrink a whole card instead.
 */
export type Crop = { width?: number; height?: number };
const svg = (body: string, { width: w = CARD_W, height: h = CARD_H }: Crop) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const frame = (fill: string, p: Palette) => `<rect x="0.5" y="0.5" width="${CARD_W - 1}" height="${CARD_H - 1}" rx="6" fill="${fill}" stroke="${p.line}"/>`;

/**
 * A face-up card. `index: "row"` sets the corner index on one line (`10♥`,
 * not the rank over the suit), so a 16 px strip of the card names it.
 */
export function cardSvg(card: Card, p: Palette = PALETTE, o: Crop & { index?: "column" | "row" } = {}): string {
  const rank = rankOf(card), suit = SUIT_GLYPH[suitOf(card)];
  const ink = isRed(card) ? p.red : p.ink;
  const corner = o.index === "row"
    ? `<text x="5" y="12" font-family='${FONT}' font-size="11" font-weight="600" fill="${ink}">${esc(rank)}<tspan dx="1" font-size="10" font-weight="400">${suit}</tspan></text>`
    : `<text x="5" y="13" font-family='${FONT}' font-size="11" font-weight="600" fill="${ink}">${esc(rank)}</text>` +
      `<text x="5" y="24" font-family='${FONT}' font-size="10" fill="${ink}">${suit}</text>`;
  const index = (turned: boolean) => `<g${turned ? ` transform="rotate(180 ${CARD_W / 2} ${CARD_H / 2})"` : ""}>${corner}</g>`;
  const pips = PIPS[rank];
  const middle = pips
    ? pips.map(([x, y, turned]) => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family='${FONT}' font-size="${rank === "A" ? 22 : 11}" fill="${ink}"${turned ? ` transform="rotate(180 ${x} ${y})"` : ""}>${suit}</text>`).join("")
    : `<rect x="16" y="24" width="24" height="32" rx="2" fill="none" stroke="${ink}" stroke-opacity="0.35"/>` +
      `<text x="${CARD_W / 2}" y="${CARD_H / 2}" text-anchor="middle" dominant-baseline="central" font-family='${FONT}' font-size="18" font-weight="600" fill="${ink}">${esc(rank)}</text>`;
  return dataUrl(svg(`${frame(p.paper, p)}${index(false)}${index(true)}${middle}`, o));
}

/** The back: the accent with a fine diagonal hatch inside a white border. */
export function backSvg(p: Palette = PALETTE, crop: Crop = {}): string {
  const hatch = `<pattern id="h" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="1.2"/></pattern>`;
  return dataUrl(svg(
    `<defs>${hatch}</defs>${frame(p.paper, p)}` +
      `<rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="4" fill="${p.back}"/><rect x="4" y="4" width="${CARD_W - 8}" height="${CARD_H - 8}" rx="4" fill="url(#h)"/>`,
    crop,
  ));
}
