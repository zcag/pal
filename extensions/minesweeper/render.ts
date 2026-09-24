// The board as a view tree (`View` in `@zcag/pal`): a header with the
// level, the mine counter, the clock and the best time, the cells on a
// sunken well, and a line under it that is the key hint while playing and
// the result once the game is over. Every cell is a box holding one
// `tile`, keyed by cell, look and board: a closed cell is paper, a flag
// the amber chip, an open cell its number in the classic colour mapped to
// the tag palette (an empty one a hairline), so the board follows the
// theme. A new key pops in: an open ripples out from the cell opened, one
// step of delay per ring, and a lost game's mines ripple out from the one
// that went off. The cursor is the tile drawn `selected`.
// Types only from `@zcag/pal`: the app's gallery may bundle this file into
// the webview, and the SDK's runtime half (node:fs, Bun) has no place
// there, so the node builders stay local, as in blackjack.
import type { Action, TagColor, View, ViewNode } from "@zcag/pal";
import { LEVELS, actions as legal, count, elapsed, isChord, minesLeft, type Action as Move, type State } from "./game.ts";

type Tile = Extract<ViewNode, { type: "tile" }>;
type Stack = Extract<ViewNode, { type: "stack" }>;

const text = (value: string, extra: Partial<Extract<ViewNode, { type: "text" }>> = {}): ViewNode => ({ type: "text", value, ...extra });
const row = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
const column = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 2, ...extra, children });
/** Keycaps then a small muted caption, the games' hint. */
const hint = (keys: string[], what: string): ViewNode[] => [...keys.map((k): ViewNode => ({ type: "keycap", keys: k })), text(what, { style: "muted", size: "sm" })];

/**
 * The room the board has in the 480 px tall panel under the header and the
 * hint line: 284 px of rows, and 512 px of columns so a 30-wide expert
 * board still fits the 560 px compact panel. Cells are as big as that
 * allows, 30 px at most: beginner 30, intermediate and expert 17.
 */
const ROOM_H = 284, ROOM_W = 512, MAX_CELL = 30;
export const pitchOf = (st: Pick<State, "w" | "h">): number => Math.min(MAX_CELL, Math.floor(ROOM_H / st.h), Math.floor(ROOM_W / st.w));
/** The tile inside its cell: 3 px of gap on a big cell, 2 on a small one. */
export const tileOf = (pitch: number): number => pitch - (pitch >= 24 ? 3 : 2);

/** The classic colours on the tag palette: 1 blue, 2 green, 3 red, 4 navy as violet, 5 maroon as pink, 6 teal, 7 black as amber, 8 grey. */
export const INK: Record<number, TagColor> = { 1: "blue", 2: "green", 3: "red", 4: "violet", 5: "pink", 6: "teal", 7: "amber", 8: "grey" };
export const FLAG = "⚑";
export const MINE = "●";

/** `0:07`, `12:34`: minutes and seconds, the minutes as many as it takes. */
export const clockText = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const MOVES: Record<Move, Action> = {
  open: { id: "open", title: "Open", shortcut: "enter" },
  flag: { id: "flag", title: "Flag", shortcut: ["f", "/", "space"] },
  up: { id: "up", title: "Up", shortcut: ["up", "k"] },
  down: { id: "down", title: "Down", shortcut: ["down", "j"] },
  left: { id: "left", title: "Left", shortcut: ["left", "h"] },
  right: { id: "right", title: "Right", shortcut: ["right", "l"] },
  new: { id: "new", title: "New game", shortcut: "n" },
};
export const FLAG_KEYS = MOVES.flag.shortcut as string[];

/** Rings from `from` to `i`, the ripple's delay: 0 on the cell itself, 8 at most. */
const ring = (st: State, i: number, from: number) => Math.min(8, Math.max(Math.abs(Math.floor(i / st.w) - Math.floor(from / st.w)), Math.abs((i % st.w) - (from % st.w))));

/** A cell: a box of `pitch` px (it clips, so the cursor's ring is drawn inside the tile) holding the tile for what the cell shows. */
function cell(st: State, i: number, pitch: number): ViewNode {
  const g = st.game, size = tileOf(pitch);
  const lost = st.phase === "lost";
  let t: Pick<Tile, "key" | "text" | "color" | "fill" | "transition">;
  if (st.mine[i] && (st.open[i] || (lost && !st.flag[i]))) {
    // A lost game shows every mine: the one that went off in red, the rest rippling out from it.
    const boom = st.open[i];
    t = { key: `m${i}-${g}`, text: MINE, color: boom ? "red" : "grey", fill: "solid", transition: { enter: "pop", exit: "none", delay: boom ? 0 : ring(st, i, st.hit ?? i) } };
  } else if (st.open[i]) {
    const n = count(st, i);
    const fresh = st.last?.opened.includes(i);
    t = { key: `o${i}-${g}`, ...(n ? { text: String(n), color: INK[n], fill: "soft" } : { color: "neutral", fill: "outline" }), transition: { exit: "none", ...(fresh ? { enter: "pop", delay: ring(st, i, st.last!.at) } : {}) } };
  } else if (st.flag[i] && lost && !st.mine[i]) {
    t = { key: `x${i}-${g}`, text: "✕", color: "amber", fill: "outline", transition: { enter: "fade", exit: "none" } };
  } else if (st.flag[i]) {
    // A win flags the mines left, rippling out from the last cell opened.
    t = { key: `f${i}-${g}`, text: FLAG, color: "amber", fill: "solid", transition: { enter: "pop", exit: "none", ...(st.phase === "won" && st.last ? { delay: ring(st, i, st.last.at) } : {}) } };
  } else {
    t = { key: `h${i}-${g}`, color: "neutral", fill: "solid", transition: { enter: "fade", exit: "none" } };
  }
  const selected = i === st.cursor && (st.phase === "ready" || st.phase === "play");
  const tile: ViewNode = { type: "tile", width: size, height: size, ...t, ...(selected ? { selected: true } : {}) };
  return { type: "stack", key: `c${i}`, width: pitch, height: pitch, align: "center", justify: "center", children: [tile] };
}

export function render(st: State, now = Date.now()): View {
  const pitch = pitchOf(st);
  const board = column(
    Array.from({ length: st.h }, (_, r) => row(Array.from({ length: st.w }, (_, c) => cell(st, r * st.w + c, pitch)), { key: `r${r}`, gap: 0 })),
    { key: "board", gap: 0, padding: 2, surface: "sunken", radius: true },
  );

  const rec = st.records[st.level];
  const left = minesLeft(st);
  const time = elapsed(st.clock, now);
  const header = row(
    [
      text(LEVELS[st.level].title, { style: "muted", size: "xs", weight: "medium" }),
      { type: "divider" },
      text("Mines", { style: "muted", size: "xs" }),
      text(String(left), { key: `mines-${left}`, style: "number", size: "md", minWidth: 20, ...(left < 0 ? { color: "destructive" } : {}), transition: { enter: "fade", exit: "none" } }),
      { type: "divider" },
      text("Time", { style: "muted", size: "xs" }),
      text(clockText(time), { style: "number", size: "md", minWidth: 36 }),
      { type: "divider" },
      text("Best", { style: "muted", size: "xs" }),
      text(rec.best === undefined ? "–" : clockText(rec.best), { key: `best-${rec.best}`, style: "number", size: "md", transition: { enter: "fade", exit: "none" } }),
      ...(rec.played ? [{ type: "divider" } as ViewNode, text(`${rec.won} of ${rec.played} won`, { style: "muted", size: "xs" })] : []),
    ],
    { key: "header", minHeight: 20 },
  );

  let title: string, line: ViewNode[];
  if (st.phase === "won") {
    title = `Cleared in ${clockText(time)}`;
    line = [
      text(title, { key: `won-${st.game}`, style: "title", color: "success", transition: { enter: "slide-up" } }),
      ...(rec.best === time ? [{ type: "badge", key: "record", text: "best time", color: "green", transition: { enter: "fade", delay: 2 } } as ViewNode] : []),
      row(hint(["enter"], "new game"), { key: "over-keys", gap: 1, transition: { enter: "fade" } }),
    ];
  } else if (st.phase === "lost") {
    title = "Boom";
    line = [
      text("Boom", { key: `lost-${st.game}`, style: "title", color: "destructive", transition: { enter: "slide-up" } }),
      row(hint(["enter"], "new game"), { key: "over-keys", gap: 1, transition: { enter: "fade" } }),
    ];
  } else {
    title = st.phase === "ready" ? "Open any cell" : `${left} mine${left === 1 ? "" : "s"} left`;
    line = [row([...hint(["up", "down", "left", "right"], "move"), ...hint(["enter"], isChord(st) ? "open around" : "open"), ...hint(FLAG_KEYS, "flag"), ...hint(["n"], "new")], { key: "play-keys", gap: 1 })];
  }

  const tree = column([header, board, row(line, { key: "line", gap: 3, minHeight: 24, justify: "center" })], { key: "table", padding: 3, gap: 2, grow: true, align: "center", justify: "center" });

  const acts = legal(st).map((m): Action => {
    if (m === "open") return isChord(st) ? { ...MOVES.open, title: "Open around" } : MOVES.open;
    if (m === "flag") return st.flag[st.cursor] ? { ...MOVES.flag, title: "Unflag" } : MOVES.flag;
    if (m === "new" && st.phase === "play") return { ...MOVES.new, confirm: "Start a new game? This board is lost.", style: "destructive" };
    return MOVES[m];
  });
  return { tree, actions: acts, title, keys: "actions" };
}
