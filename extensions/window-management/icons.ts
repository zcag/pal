// One small diagram per layout, drawn as an SVG data url: a screen outline
// with the cell the layout fills, so every row's icon is the same shape and
// weight (the Nerd Font has halves but no thirds or quarters). A mid grey
// reads on both themes, as the swatch and glyph images of the reference
// palettes do.
import type { WindowLayout } from "@zcag/pal";

const INK = "#85869A";
/** The screen in a 24 px box, and the area inside its outline the cells are cut from. */
const SCREEN = { x: 2, y: 4, w: 20, h: 16 };
const INNER = { x: 3.25, y: 5.25, w: 17.5, h: 13.5 };

type Frac = [x: number, y: number, w: number, h: number];
const cell = ([x, y, w, h]: Frac) => `<rect x="${(INNER.x + INNER.w * x).toFixed(2)}" y="${(INNER.y + INNER.h * y).toFixed(2)}" width="${(INNER.w * w).toFixed(2)}" height="${(INNER.h * h).toFixed(2)}" rx="1" fill="${INK}"/>`;
const outline = (x = SCREEN.x, y = SCREEN.y, w = SCREEN.w, h = SCREEN.h, extra = "") => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="none" stroke="${INK}" stroke-width="1.5"${extra}/>`;
const centred = (w: number, h: number): Frac => [(1 - w) / 2, (1 - h) / 2, w, h];
const T = 1 / 3;

/** The parts inside the 24 px box, per layout. */
const SHAPES: Record<WindowLayout, string> = {
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
  center: outline() + cell(centred(0.5, 0.5)),
  reasonable_size: outline() + cell(centred(0.66, 0.66)),
  // Two screens; the filled one is where the window goes.
  next_display: outline(1.5, 6, 9.5, 12) + outline(13, 6, 9.5, 12) + `<rect x="14.25" y="7.25" width="7" height="9.5" rx="1" fill="${INK}"/>`,
  previous_display: outline(1.5, 6, 9.5, 12) + outline(13, 6, 9.5, 12) + `<rect x="2.75" y="7.25" width="7" height="9.5" rx="1" fill="${INK}"/>`,
  // The frame it goes back to, dashed.
  restore: outline() + outline(6.5, 7.5, 11, 9, ` stroke-dasharray="2 1.5"`),
};

const cache = new Map<WindowLayout, string>();

/** The layout's icon: `{ image }` with the diagram as a data url. */
export function layoutIcon(id: WindowLayout): { image: string } {
  let url = cache.get(id);
  if (!url) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${SHAPES[id]}</svg>`;
    url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    cache.set(id, url);
  }
  return { image: url };
}
