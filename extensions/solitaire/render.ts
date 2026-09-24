// The table as a view tree (`View` in `@zcag/pal`): a sunken felt holding
// the top row (the stock, the waste, the four foundations) over the seven
// tableau columns, and beside it the moves, the time, the record and the
// keys. A column is its cards top to bottom, every covered one a strip of
// its picture (cards.ts crops it) so the column fans without overlapping
// nodes; a long run tightens the strips to stay in the panel. Every face-up
// card is keyed by deal and card with `move`, so a card that changes pile
// glides there, whether a drop, an undo or the auto-finish sending it home;
// held cards ride under the cursor the same way, and an illegal drop glides
// them back. A card turned over flips in, the deal drops in column by column.
// Types only from `@zcag/pal`, as blackjack's render.ts: the gallery may
// bundle this file into the webview, where the SDK's runtime half has no
// place, so the node builders stay local.
import type { Action, View, ViewNode } from "@zcag/pal";
import { CARD_H, CARD_W, PALETTE, SUITS, SUIT_GLYPH, backSvg, cardSvg, type Card } from "../blackjack/cards.ts";
import { STOCK, T, WASTE, actions as legal, canFinish, isFoundation, name, run, running, type Action as Move, type State } from "./game.ts";

/** Between columns, in 4 px steps: seven 56 px columns make a 464 px board. */
const GAP = 3;
/** A face-down card under another shows this much of its back; a face-up one between these, so its `10♥` reads. */
const DOWN = 5;
const UP_MAX = 20;
const UP_MIN = 16;
/** The height a column may take before the view scrolls: the view's 390 px less the top row and the paddings. Six backs and eleven face-up cards fit. */
export const COLUMN_H = 264;
/** How much of a fanned waste card shows under the next (draw three). */
const FAN = 24;
/** The waste's box spans two columns, so the foundations line up over the last four. */
const WASTE_W = 2 * CARD_W + GAP * 4;

const text = (value: string, extra: Partial<Extract<ViewNode, { type: "text" }>> = {}): ViewNode => ({ type: "text", value, ...extra });
const row = (children: ViewNode[], extra: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
const column = (children: ViewNode[], extra: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 2, ...extra, children });

/** `3:07`, `1:02:45`. */
export const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

/** The pictures, drawn once per card and size: a tick re-renders the whole table every second. */
const svgs = new Map<string, string>();
const faceSrc = (c: Card, width: number, height: number) => {
  const k = `${c}/${width}/${height}`;
  let src = svgs.get(k);
  if (!src) svgs.set(k, (src = cardSvg(c, PALETTE, { index: "row", width, height })));
  return src;
};
const backSrc = (height: number) => {
  const k = `back/${height}`;
  let src = svgs.get(k);
  if (!src) svgs.set(k, (src = backSvg(PALETTE, { height })));
  return src;
};

type Enter = "flip" | "slide-down";
const face = (st: State, c: Card, o: { width?: number; height?: number; enter?: Enter; delay?: number } = {}): ViewNode => {
  const width = o.width ?? CARD_W, height = o.height ?? CARD_H;
  return { type: "image", key: `c-${c}-${st.game}`, src: faceSrc(c, width, height), width, height, alt: name(c), transition: { move: true, exit: "none", ...(o.enter && { enter: o.enter, delay: o.delay }) } };
};
const back = (st: State, c: Card, height: number, deal?: number): ViewNode =>
  ({ type: "image", key: `b-${c}-${st.game}`, src: backSrc(height), width: CARD_W, height, alt: "face down", transition: { exit: "none", ...(deal !== undefined && { enter: "slide-down", delay: deal }) } });
/** An empty place: an outline the size of a card, the suit on a foundation's. */
const place = (key: string, glyph = "", red = false, selected = false): ViewNode =>
  ({ type: "tile", key, width: CARD_W, height: CARD_H, text: glyph, color: red ? "red" : "neutral", fill: "outline", transition: { exit: "none" }, ...(selected && { selected }) });
const sel = (n: ViewNode, on: boolean): ViewNode => (on ? { ...n, selected: true } : n);

/** The cards picked up, drawn under the cursor. */
const heldCards = (st: State): Card[] => (st.held ? run(st, st.held.from, st.held.count) : []);
/** Pile `p`'s face-up cards less the ones picked up from it. */
const left = (cards: Card[], st: State, p: number) => (st.held?.from === p ? cards.slice(0, cards.length - st.held.count) : cards);

/** A fresh deal drops in column by column. */
const dealing = (st: State) => !st.moves && !st.history.length;

function tableauColumn(st: State, i: number): ViewNode {
  const p = st.tableau[i], at = T(i);
  const cursor = st.cursor === at;
  const up = left(p.up, st, at);
  const carried = cursor ? heldCards(st) : [];
  const faces = [...up, ...carried];
  if (!p.down.length && !faces.length) return column([place(`t${i}-empty-${st.game}`, "", false, cursor)], { key: `t${i}`, gap: 0 });
  const deal = dealing(st) ? i : undefined;
  const step = faces.length > 1 ? Math.max(UP_MIN, Math.min(UP_MAX, Math.floor((COLUMN_H - CARD_H - p.down.length * DOWN) / (faces.length - 1)))) : UP_MAX;
  const last = p.down.length + faces.length - 1;
  const nodes: ViewNode[] = [
    ...p.down.map((c, j) => back(st, c, j === last ? CARD_H : DOWN, deal)),
    ...faces.map((c, j) => face(st, c, { height: p.down.length + j === last ? CARD_H : step, enter: deal !== undefined ? "slide-down" : "flip", delay: deal })),
  ];
  // The cursor's ring goes round the cards it takes, or the ones it carries.
  const ringed = !cursor ? 0 : st.held ? carried.length : Math.min(st.depth, up.length);
  const body = ringed ? [...nodes.slice(0, nodes.length - ringed), column(nodes.slice(-ringed), { gap: 0, selected: true })] : nodes;
  return column(body, { key: `t${i}`, gap: 0 });
}

function topRow(st: State): ViewNode {
  const held = heldCards(st);
  // A won table has no cursor.
  const on = (p: number) => !st.won && st.cursor === p;
  const stock = st.stock.length
    ? sel({ type: "image", key: `stock-${st.game}`, src: backSrc(CARD_H), width: CARD_W, height: CARD_H, alt: `stock, ${st.stock.length} cards`, transition: { exit: "none" } }, on(STOCK))
    : place("stock-empty", st.waste.length ? "↻" : "", false, on(STOCK));

  const waste = [...left(st.waste, st, WASTE), ...(on(WASTE) ? held : [])].slice(-st.draw);
  const wasteNodes = waste.length
    ? waste.map((c, j) => {
      const top = j === waste.length - 1;
      const n = face(st, c, { width: top ? CARD_W : FAN, ...(st.drawn.includes(c) && { enter: "flip", delay: st.drawn.indexOf(c) }) });
      return sel(n, top && on(WASTE));
    })
    : [place("waste-empty", "", false, on(WASTE))];
  const wasteW = waste.length ? (waste.length - 1) * FAN + CARD_W : CARD_W;

  const foundations = SUITS.map((s, i) => {
    const at = 2 + i, cursor = on(at);
    const top = cursor && held.length ? held.at(-1) : left(st.foundations[i], st, at).at(-1);
    return top ? sel(face(st, top), cursor) : place(`f${i}-empty`, SUIT_GLYPH[s], s === "H" || s === "D", cursor);
  });
  return row([stock, row(wasteNodes, { key: "waste", gap: 0 }), { type: "spacer", size: WASTE_W - wasteW - GAP * 4 }, ...foundations], { key: "top", gap: GAP, align: "start" });
}

/** What Enter does here, for the action panel and the hint. */
function enterTitle(st: State): string {
  if (st.held) return st.cursor === st.held.from ? "Send where it goes" : "Drop here";
  if (st.cursor === STOCK) return st.stock.length ? "Draw" : "Turn the waste over";
  const cards = run(st, st.cursor, st.depth);
  return cards.length > 1 ? `Pick up ${cards.length} cards` : cards.length ? `Pick up ${name(cards[0])}` : "Pick up";
}

const MOVES: Record<Move, Action> = {
  select: { id: "select", title: "Pick up or drop", shortcut: "enter" },
  finish: { id: "finish", title: "Finish now", shortcut: "enter" },
  left: { id: "left", title: "Previous pile", shortcut: ["left", "h"] },
  right: { id: "right", title: "Next pile", shortcut: ["right", "l"] },
  up: { id: "up", title: "One more card, then the row above", shortcut: ["up", "k"] },
  down: { id: "down", title: "One card fewer, then the row below", shortcut: ["down", "j"] },
  draw: { id: "draw", title: "Draw", shortcut: ["space", "d"] },
  undo: { id: "undo", title: "Undo", shortcut: ["u", "backspace"] },
  new: { id: "new", title: "New game", shortcut: "n" },
};

function action(st: State, m: Move): Action {
  const a = MOVES[m];
  switch (m) {
    case "select": return { ...a, title: enterTitle(st) };
    case "draw": return st.stock.length || !st.waste.length ? a : { ...a, title: "Turn the waste over" };
    case "undo": return st.held ? { ...a, title: "Put the cards back" } : a;
    case "new": return st.won ? { ...a, shortcut: ["enter", "n"] } : running(st) ? { ...a, confirm: "Deal a new game? This one counts as lost.", style: "destructive" } : a;
    default: return a;
  }
}

/** The line in place of the search input: what went wrong, what is held, else what the cursor is on. */
function title(st: State): string {
  if (st.won) return "You won";
  if (canFinish(st)) return "Finishing…";
  if (st.note) return st.note;
  const held = heldCards(st);
  if (held.length) return `Moving ${name(held[0])}${held.length > 1 ? ` and ${held.length - 1} more` : ""}`;
  const at = st.cursor;
  if (at === STOCK) return st.stock.length ? `Stock · ${st.stock.length} left` : st.waste.length ? "Stock · Enter turns the waste over" : "Stock · empty";
  if (at === WASTE) return st.waste.length ? `Waste · ${name(st.waste.at(-1)!)}` : "Waste · empty";
  if (isFoundation(at)) return `${SUIT_GLYPH[SUITS[at - 2]]} foundation · ${st.foundations[at - 2].length} of 13`;
  const cards = run(st, at, st.depth);
  return `Pile ${at - 5} · ${cards.length ? cards.map(name).join(" ") : "empty"}`;
}

const caps = (m: Move): ViewNode => ({ type: "keycap", keys: [MOVES[m].shortcut ?? []].flat()[0] });
const hint = (keys: ViewNode[], what: string): ViewNode => row([...keys, text(what, { style: "muted", size: "sm" })], { gap: 1 });
const stat = (label: string, value: string): ViewNode => row([text(label, { style: "muted", size: "xs", width: 44 }), text(value, { style: "number", size: "sm" })], { gap: 2 });

function side(st: State): ViewNode {
  const home = st.foundations.reduce((n, f) => n + f.length, 0);
  const { played, won } = st.stats;
  const keys: ViewNode[] = st.won
    ? [hint([{ type: "keycap", keys: "enter" }], "new game")]
    : [
      hint([caps("left"), caps("right")], "pile"),
      hint([caps("up"), caps("down")], "cards"),
      hint([{ type: "keycap", keys: "enter" }], st.held ? "drop" : st.cursor === STOCK ? "draw" : "pick up"),
      hint([caps("draw")], "draw"),
      hint([caps("undo")], "undo"),
      hint([caps("new")], "new game"),
    ];
  return column(
    [
      stat("Moves", String(st.moves)),
      stat("Time", clock(st.elapsed)),
      stat("Won", played ? `${won} of ${played}` : "none yet"),
      row([text("Home", { style: "muted", size: "xs", width: 44 }), { type: "progress", value: home / 52, width: 72, color: "green" }], { gap: 2 }),
      row([{ type: "badge", text: `Draw ${st.draw}`, color: "grey" }]),
      { type: "divider" },
      column(keys, { key: `keys-${st.won}`, gap: 1, transition: { enter: "fade" } }),
    ],
    { key: "side", gap: 2, grow: true, padding: 1 },
  );
}

export function render(st: State): View {
  const tableau: ViewNode = st.won
    ? column(
      [
        text("You won", { key: `won-${st.game}`, style: "title", size: "xl", color: "success", transition: { enter: "slide-up" } }),
        text(`${st.moves} moves in ${clock(st.elapsed)}`, { style: "muted", size: "sm" }),
        row([{ type: "keycap", keys: "enter" }, text("deals again", { style: "muted", size: "sm" })], { gap: 1 }),
      ],
      { key: "won", align: "center", justify: "center", gap: 2, minHeight: COLUMN_H },
    )
    : row(st.tableau.map((_, i) => tableauColumn(st, i)), { key: "tableau", gap: GAP, align: "start", minHeight: COLUMN_H });
  const felt = column([topRow(st), tableau], { key: "felt", padding: 2, gap: 2, surface: "sunken", radius: true });
  const tree = row([felt, side(st)], { key: "table", padding: 2, gap: 3, align: "stretch", grow: true });
  return { tree, actions: legal(st).map((m) => action(st, m)), title: title(st), keys: "actions" };
}
