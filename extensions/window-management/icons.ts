// One small diagram per layout, drawn as an SVG data url: a screen outline
// with the cell the layout fills, so every row's icon is the same shape and
// weight (the Nerd Font has halves but no thirds or quarters). Drawn in
// the extension's indigo (between the light and dark `--pal-brand-indigo`,
// a data url cannot follow the theme), so the rows read as the tile's.
import type { Verb } from "./index.ts";

const INK = "#6662E0";
/** The screen in a 24 px box, and the area inside its outline the cells are cut from. */
const SCREEN = { x: 2, y: 4, w: 20, h: 16 };
const INNER = { x: 3.25, y: 5.25, w: 17.5, h: 13.5 };

type Frac = [x: number, y: number, w: number, h: number];
const cell = ([x, y, w, h]: Frac) => `<rect x="${(INNER.x + INNER.w * x).toFixed(2)}" y="${(INNER.y + INNER.h * y).toFixed(2)}" width="${(INNER.w * w).toFixed(2)}" height="${(INNER.h * h).toFixed(2)}" rx="1" fill="${INK}"/>`;
const outline = (x = SCREEN.x, y = SCREEN.y, w = SCREEN.w, h = SCREEN.h, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="none" stroke="${INK}" stroke-width="1.5"${extra}/>`;
const centred = (w: number, h: number): Frac => [(1 - w) / 2, (1 - h) / 2, w, h];
const T = 1 / 3;
/** A stroked line from (x1, y1) to (x2, y2) with an open arrowhead at its end, in the box's units. */
const arrow = (x1: number, y1: number, x2: number, y2: number) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const head = (t: number) => `${(x2 - 2.8 * Math.cos(a + t)).toFixed(2)} ${(y2 - 2.8 * Math.sin(a + t)).toFixed(2)}`;
  return `<path d="M${x1} ${y1}L${x2} ${y2}M${head(0.6)}L${x2} ${y2}L${head(-0.6)}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
};
/** A window cell with an arrow beside it: the moves. */
const nudged = (cell_: Frac, a: [number, number, number, number]) => outline() + cell(cell_) + arrow(...a);

/** The parts inside the 24 px box, per layout. */
const SHAPES: Record<Verb, string> = {
  left_half: outline() + cell([0, 0, 0.5, 1]),
  right_half: outline() + cell([0.5, 0, 0.5, 1]),
  top_half: outline() + cell([0, 0, 1, 0.5]),
  bottom_half: outline() + cell([0, 0.5, 1, 0.5]),
  left_third: outline() + cell([0, 0, T, 1]),
  center_third: outline() + cell([T, 0, T, 1]),
  right_third: outline() + cell([2 * T, 0, T, 1]),
  left_two_thirds: outline() + cell([0, 0, 2 * T, 1]),
  right_two_thirds: outline() + cell([T, 0, 2 * T, 1]),
  top_left_quarter: outline() + cell([0, 0, 0.5, 0.5]),
  top_right_quarter: outline() + cell([0.5, 0, 0.5, 0.5]),
  bottom_left_quarter: outline() + cell([0, 0.5, 0.5, 0.5]),
  bottom_right_quarter: outline() + cell([0.5, 0.5, 0.5, 0.5]),
  maximize: outline() + cell([0, 0, 1, 1]),
  almost_maximize: outline() + cell(centred(0.88, 0.86)),
  maximize_height: outline() + cell([0.3, 0, 0.4, 1]),
  maximize_width: outline() + cell([0, 0.3, 1, 0.4]),
  center: outline() + cell(centred(0.5, 0.5)),
  reasonable_size: outline() + cell(centred(0.66, 0.66)),
  // A centred cell with arrows out of (larger) or into (smaller) two corners.
  larger: outline() + cell(centred(0.3, 0.3)) + arrow(14, 10.5, 19.5, 6) + arrow(10, 13.5, 4.5, 18),
  smaller: outline() + cell(centred(0.3, 0.3)) + arrow(19.5, 6, 14.5, 10) + arrow(4.5, 18, 9.5, 14),
  move_left: nudged([0.42, 0.25, 0.42, 0.5], [8.5, 12, 4.5, 12]),
  move_right: nudged([0.16, 0.25, 0.42, 0.5], [15.5, 12, 19.5, 12]),
  move_up: nudged([0.29, 0.42, 0.42, 0.45], [12, 10, 12, 6.5]),
  move_down: nudged([0.29, 0.13, 0.42, 0.45], [12, 14, 12, 17.5]),
  // The screen filled edge to edge, no outline left.
  fullscreen: `<rect x="2" y="4" width="20" height="16" rx="2" fill="${INK}"/><rect x="8" y="9" width="8" height="6" rx="1" fill="#fff" fill-opacity="0.9"/>`,
  // The window as a sliver at the bottom (the Dock), and back up from it.
  minimize: outline() + cell([0.15, 0.82, 0.7, 0.18]) + arrow(12, 7, 12, 13.5),
  unminimize: outline() + cell([0.15, 0.82, 0.7, 0.18]) + arrow(12, 14.5, 12, 7.5),
  // Two screens; the filled one is where the window goes.
  next_display: outline(1.5, 6, 9.5, 12) + outline(13, 6, 9.5, 12) + `<rect x="14.25" y="7.25" width="7" height="9.5" rx="1" fill="${INK}"/>`,
  previous_display: outline(1.5, 6, 9.5, 12) + outline(13, 6, 9.5, 12) + `<rect x="2.75" y="7.25" width="7" height="9.5" rx="1" fill="${INK}"/>`,
  // The frame it goes back to, dashed.
  restore: outline() + outline(6.5, 7.5, 11, 9, ` stroke-dasharray="2 1.5"`),
};

const cache = new Map<Verb, string>();

/** The layout's icon: `{ image }` with the diagram as a data url. */
export function layoutIcon(id: Verb): { image: string } {
  let url = cache.get(id);
  if (!url) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${SHAPES[id]}</svg>`;
    url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    cache.set(id, url);
  }
  return { image: url };
}
