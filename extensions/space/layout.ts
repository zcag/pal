// The squarified treemap (Bruls, Huizing, van Wijk 2000), pure: items with
// an area into a rectangle as strips of boxes whose aspect ratios stay
// near 1. Sorted largest first, each strip is laid along the shorter side
// of what is left and takes items while the worst aspect ratio in it does
// not get worse; the next strip starts where that one stops improving.
// The output keeps the strip structure, since the view draws it as nested
// flex stacks (a row of column strips, a column of row strips) with the
// px sizes as weights, not as absolute rectangles; the px rectangles ride
// along for the labels (does a name fit?) and for the keys (which box is
// to the right of this one?).

export type Rect = { x: number; y: number; w: number; h: number };
export type Box<T> = { item: T; rect: Rect };
/** One strip: `vertical` is a column of boxes along the left edge (the remaining rectangle was wider than tall), else a row along the top. */
export type Strip<T> = { vertical: boolean; rect: Rect; boxes: Box<T>[] };

/** The worst aspect ratio of a strip of areas `row` laid along a side of length `w`. */
export function worst(row: number[], w: number): number {
  const s = row.reduce((a, b) => a + b, 0);
  if (!s || !w) return Infinity;
  const w2 = w * w, s2 = s * s;
  let r = 0;
  for (const a of row) r = Math.max(r, (w2 * a) / s2, s2 / (w2 * a));
  return r;
}

/**
 * Lays `items` (areas from `area`, any scale; zero and negative areas are
 * dropped) into `rect`. The strips come in order, each taking the left or
 * the top edge of what the previous ones left.
 */
export function squarify<T>(items: T[], area: (t: T) => number, rect: Rect): Strip<T>[] {
  const sorted = items.map((item) => ({ item, a: area(item) })).filter((x) => x.a > 0).sort((a, b) => b.a - a.a);
  const total = sorted.reduce((s, x) => s + x.a, 0);
  const strips: Strip<T>[] = [];
  if (!total || rect.w <= 0 || rect.h <= 0) return strips;
  const scale = (rect.w * rect.h) / total;
  let rem: Rect = { ...rect };
  let row: { item: T; a: number }[] = [];
  const side = () => Math.min(rem.w, rem.h);
  const flush = () => {
    if (!row.length) return;
    const s = row.reduce((t, x) => t + x.a, 0);
    const vertical = rem.w >= rem.h;
    const boxes: Box<T>[] = [];
    if (vertical) {
      const w = s / rem.h;
      let y = rem.y;
      for (const x of row) { const h = x.a / w; boxes.push({ item: x.item, rect: { x: rem.x, y, w, h } }); y += h; }
      strips.push({ vertical, rect: { x: rem.x, y: rem.y, w, h: rem.h }, boxes });
      rem = { x: rem.x + w, y: rem.y, w: rem.w - w, h: rem.h };
    } else {
      const h = s / rem.w;
      let x = rem.x;
      for (const it of row) { const w = it.a / h; boxes.push({ item: it.item, rect: { x, y: rem.y, w, h } }); x += w; }
      strips.push({ vertical, rect: { x: rem.x, y: rem.y, w: rem.w, h }, boxes });
      rem = { x: rem.x, y: rem.y + h, w: rem.w, h: rem.h - h };
    }
    row = [];
  };
  for (const x of sorted) {
    const a = x.a * scale;
    const w = side();
    if (row.length && worst([...row.map((r) => r.a), a], w) > worst(row.map((r) => r.a), w)) flush();
    row.push({ item: x.item, a });
  }
  flush();
  return strips;
}

/**
 * Strips grouped for the view: consecutive strips of one orientation are
 * siblings in one flex container (a row of vertical strips, a column of
 * horizontal ones) and the strips after an orientation flip nest as that
 * container's last child. `size` is a strip's extent along the
 * container (its width in a row, its height in a column): the flex
 * weight; `rest` is what the flipped remainder weighs.
 */
export type Group<T> = { vertical: boolean; strips: Strip<T>[]; rest?: Group<T> };
export function group<T>(strips: Strip<T>[]): Group<T> | undefined {
  if (!strips.length) return;
  const g: Group<T> = { vertical: strips[0].vertical, strips: [] };
  let i = 0;
  while (i < strips.length && strips[i].vertical === g.vertical) g.strips.push(strips[i++]);
  g.rest = group(strips.slice(i));
  return g;
}

export type Dir = "up" | "down" | "left" | "right";

/**
 * The box the arrow lands on from `from`: among the boxes past `from`'s
 * far edge in that direction, the one nearest by the gap along the
 * direction plus the misalignment across it (weighted, so a box straight
 * ahead beats a nearer one off to the side). None when nothing lies that
 * way.
 */
export function neighbour(rects: Rect[], from: number, dir: Dir): number | undefined {
  const f = rects[from];
  if (!f) return;
  const fcx = f.x + f.w / 2, fcy = f.y + f.h / 2;
  let best: number | undefined, score = Infinity;
  rects.forEach((r, i) => {
    if (i === from) return;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let gap: number, off: number;
    if (dir === "right") { gap = r.x - (f.x + f.w); off = Math.max(0, f.y - (r.y + r.h), r.y - (f.y + f.h)); if (cx <= fcx) return; }
    else if (dir === "left") { gap = f.x - (r.x + r.w); off = Math.max(0, f.y - (r.y + r.h), r.y - (f.y + f.h)); if (cx >= fcx) return; }
    else if (dir === "down") { gap = r.y - (f.y + f.h); off = Math.max(0, f.x - (r.x + r.w), r.x - (f.x + f.w)); if (cy <= fcy) return; }
    else { gap = f.y - (r.y + r.h); off = Math.max(0, f.x - (r.x + r.w), r.x - (f.x + f.w)); if (cy >= fcy) return; }
    // Overlapping along the direction (a box whose near edge is inside `from`, as a nested layout can give) counts as touching.
    const s = Math.max(0, gap) + 3 * off + (dir === "right" || dir === "left" ? Math.abs(cy - fcy) : Math.abs(cx - fcx)) * 0.1;
    if (s < score) { score = s; best = i; }
  });
  return best;
}
