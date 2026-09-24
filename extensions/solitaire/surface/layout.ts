// Where everything goes, pure: the page's viewport and a `State` in, the
// card size and every card's place out, so the page only moves elements
// (main.ts) and the host tests can check the fit. The felt takes the view
// less a rail on the right for the status; the card size is the largest
// that fits seven columns across and the longest column down, the column
// fanned at its tightest (a face-up card shows at least its rank). A
// column fans out loose while it has room and tightens as it grows.
import { F, STOCK, T, WASTE, isTableau, run, type Card, type State } from "../game.ts";

/** A card's height over its width (the kit's 420 by 570 pictures). */
export const RATIO = 570 / 420;
/** Between columns, of a card's width. */
const GAP = 0.13;
/** Between the top row and the tableau, of a card's height. */
const ROW = 0.16;
/** How much of a covered card shows, of its height: face down, loose then tight; face up, rank and suit then the rank alone. */
const DOWN = [0.1, 0.055];
const UP = [0.31, 0.19];
/** A column held cards ride on may tighten past `UP` (only while they ride). */
const UP_FLOOR = 0.12;
/** Draw three: how much of a fanned waste card shows, of its width. */
const FAN = 0.26;
/** Wider than this reads as a poster, not a table. */
const MAX_W = 104;
/** Around the felt, and inside it. */
const MARGIN = 8, PAD = 10;
/** Held cards sit this much above where they would lie, of a height. */
const LIFT = 0.07;

export type Box = { x: number; y: number; w: number; h: number };
export type Geometry = { vw: number; vh: number; felt: Box; rail: Box; w: number; h: number; col: number[]; top: number; tab: number; bottom: number };
/** A card's place: its top-left, its stacking order, whether it shows its face, and whether it is picked up. */
export type Place = { x: number; y: number; z: number; up: boolean; lifted: boolean };
export type Layout = { g: Geometry; cards: Map<Card, Place>; ring?: Box };

/** The rail is narrower in the compact panel. */
export const railWidth = (vw: number) => (vw >= 640 ? 124 : 100);

export function geometry(vw: number, vh: number, st: State): Geometry {
  const rw = railWidth(vw);
  const felt = { x: MARGIN, y: MARGIN, w: vw - rw - MARGIN, h: vh - 2 * MARGIN };
  const rail = { x: felt.x + felt.w + MARGIN, y: MARGIN, w: rw - 2 * MARGIN, h: felt.h };
  const longest = Math.max(...st.tableau.map((p) => p.down.length * DOWN[1] + Math.max(0, p.up.length - 1) * UP[1]));
  const byWidth = (felt.w - 2 * PAD) / (7 + 6 * GAP);
  const byHeight = (felt.h - 2 * PAD) / (2 + ROW + longest) / RATIO;
  const w = Math.max(24, Math.floor(Math.min(byWidth, byHeight, MAX_W)));
  const h = Math.round(w * RATIO), gap = Math.round(w * GAP);
  const x0 = felt.x + (felt.w - 7 * w - 6 * gap) / 2;
  const top = felt.y + PAD;
  return { vw, vh, felt, rail, w, h, col: Array.from({ length: 7 }, (_, i) => Math.round(x0 + i * (w + gap))), top, tab: top + h + Math.round(h * ROW), bottom: felt.y + felt.h - PAD };
}

/** Pile `p`'s place on the felt: its empty outline, where its first card lies. */
export function slot(g: Geometry, p: number): Box {
  const at = (c: number, y: number) => ({ x: g.col[c], y, w: g.w, h: g.h });
  if (p === STOCK) return at(0, g.top);
  if (p === WASTE) return at(1, g.top);
  if (isTableau(p)) return at(p - 6, g.tab);
  return at(p + 1, g.top);
}

/** A column's steps: face down, face up, the tightest that fits `n` face-up cards under `down` face-down ones. */
function steps(g: Geometry, down: number, n: number) {
  const room = g.bottom - g.tab - g.h;
  let d = DOWN[0] * g.h, u = UP[0] * g.h;
  if (down * d + (n - 1) * u > room) d = DOWN[1] * g.h;
  if (n > 1 && down * d + (n - 1) * u > room) u = Math.max(UP_FLOOR * g.h, (room - down * d) / (n - 1));
  return { d, u };
}

/**
 * Every card's place. Picked-up cards (`st.held`) ride on the pile under
 * the cursor, lifted; on the pile they came from they only lift. `ring`
 * is what the cursor takes: the cards Enter would pick up, the ones it
 * carries, or the empty place.
 */
export function layout(st: State, g: Geometry): Layout {
  const cards = new Map<Card, Place>();
  const held = st.held ? run(st, st.held.from, st.held.count) : [];
  const riding = !!st.held && st.held.from !== st.cursor;
  const lift = Math.round(g.h * LIFT);
  const without = (cs: Card[], p: number) => (riding && st.held!.from === p ? cs.slice(0, cs.length - held.length) : cs);
  const put = (c: Card, x: number, y: number, z: number, up: boolean) => {
    const lifted = held.includes(c);
    cards.set(c, { x: Math.round(x), y: Math.round(y - (lifted ? lift : 0)), z: lifted ? z + 1000 : z, up, lifted });
  };
  let ring: Box | Place | undefined;
  const around = (from: Place | Box, to: Place | Box): Box => ({ x: from.x, y: from.y, w: g.w, h: to.y + g.h - from.y });

  // The stock, a little thicker every eight cards.
  const s = slot(g, STOCK);
  st.stock.forEach((c, i) => put(c, s.x - Math.min(3, i >> 3), s.y - Math.min(3, i >> 3), i, false));
  if (st.cursor === STOCK) ring = st.stock.length ? { ...s, x: s.x - Math.min(3, (st.stock.length - 1) >> 3), y: s.y - Math.min(3, (st.stock.length - 1) >> 3) } : s;

  // The waste: drawing three, its top three fanned.
  const w = slot(g, WASTE), waste = without(st.waste, WASTE);
  const fanned = st.draw === 3 ? Math.min(3, waste.length) : 1;
  waste.forEach((c, i) => put(c, w.x + Math.max(0, i - (waste.length - fanned)) * FAN * g.w, w.y, 100 + i, true));
  if (st.cursor === WASTE) ring = waste.length ? cards.get(waste.at(-1)!) : w;

  // The foundations; cards carried onto one sit on top.
  st.foundations.forEach((f, i) => {
    const b = slot(g, F(i)), here = without(f, F(i));
    const top = riding && st.cursor === F(i) ? [...here, ...held] : here;
    top.forEach((c, j) => put(c, b.x, b.y, 200 + j, true));
    if (st.cursor === F(i)) ring = top.length ? cards.get(top.at(-1)!) : b;
  });

  // The tableau.
  st.tableau.forEach((p, i) => {
    const b = slot(g, T(i));
    const up = [...without(p.up, T(i)), ...(riding && st.cursor === T(i) ? held : [])];
    const { d, u } = steps(g, p.down.length, up.length);
    let y = b.y, z = 300;
    for (const c of p.down) { put(c, b.x, y, z++, false); y += d; }
    for (const c of up) { put(c, b.x, y, z++, true); y += u; }
    if (st.cursor !== T(i)) return;
    const take = st.held ? held.length : Math.min(st.depth, up.length);
    ring = take ? around(cards.get(up[up.length - take])!, cards.get(up.at(-1)!)!) : p.down.length ? cards.get(p.down.at(-1)!) : b;
  });
  return { g, cards, ring: ring && !st.won ? { x: ring.x, y: ring.y, w: g.w, h: "h" in ring ? ring.h : g.h } : undefined };
}

/** Where a drop on pile `p` lands, for the drag's hit test: a column down to the felt's edge (or its last card), a top-row pile its place. */
export function dropBox(l: Layout, st: State, p: number): Box {
  const b = slot(l.g, p);
  if (!isTableau(p)) return b;
  const last = st.tableau[p - 6].up.at(-1);
  const y = last ? l.cards.get(last)!.y + l.g.h : b.y + b.h;
  return { ...b, h: Math.max(l.g.bottom, y) - b.y };
}

/** Pile `p`'s top card's box (or its place), where a legal drop glows. */
export function topBox(l: Layout, st: State, p: number): Box {
  const pile = p === WASTE ? st.waste : isTableau(p) ? st.tableau[p - 6].up : p >= 2 && p < 6 ? st.foundations[p - 2] : st.stock;
  const c = pile.at(-1), at = c && l.cards.get(c);
  return at ? { x: at.x, y: at.y, w: l.g.w, h: l.g.h } : slot(l.g, p);
}

/** Overlap area of two boxes. */
export const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
