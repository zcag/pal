// The board as a view tree (`View` in `@zcag/pal`): a header with the
// score, the best and the move count, the four rows of tiles on a sunken
// well, and a line under the board that is a key hint while playing, the
// banner at 2048, or the score at game over. Every cell is a stack holding
// one `tile`: an outline for an empty cell, else the tile keyed by its id
// with `move`, so a tile that slid glides from its old cell to its new one
// (across rows too), a merged one pops in its cell as the slide lands, and
// the spawned one pops a beat later. The tiles are drawn with the tokens,
// so the board follows the theme. No host imports: the gallery renders a
// fixture state with this same function.
import type { Action, View, ViewNode } from "@zcag/pal";
import { SIZE, TARGET, actions as legal, phase, type Action as Move, type Settings, type State } from "./game.ts";

/** 64 px tiles with 8 px gaps in an 8 px well make a 296 px board: four rows plus a header fit the panel. */
export const TILE = 64;

type Tile = Extract<ViewNode, { type: "tile" }>;
type Look = Pick<Tile, "color" | "fill">;

/**
 * The ramp climbs in weight only: paper for 2, the neutral tint for 4,
 * then solid tiles walking the tag palette's hues warm to cool (amber,
 * red, pink, violet, blue, teal, green), the grey chip at 1024, the accent
 * at 2048 and past it. No two fills alternate, so every step reads at
 * least as strong as the last.
 */
const LOOKS: Record<number, Look> = {
  2: { color: "neutral", fill: "solid" },
  4: { color: "neutral", fill: "soft" },
  8: { color: "amber", fill: "solid" },
  16: { color: "red", fill: "solid" },
  32: { color: "pink", fill: "solid" },
  64: { color: "violet", fill: "solid" },
  128: { color: "blue", fill: "solid" },
  256: { color: "teal", fill: "solid" },
  512: { color: "green", fill: "solid" },
  1024: { color: "grey", fill: "solid" },
  2048: { color: "accent", fill: "solid" },
};
export const lookOf = (v: number): Look => LOOKS[v] ?? LOOKS[2048];

const text = (value: string, extra: Partial<Extract<ViewNode, { type: "text" }>> = {}): ViewNode => ({ type: "text", value, ...extra });
const row = (children: ViewNode[], extra: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
const column = (children: ViewNode[], extra: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 2, ...extra, children });
const keycap = (keys: string): ViewNode => ({ type: "keycap", keys });
const hint = (keys: string[], what: string): ViewNode[] => [...keys.map(keycap), text(what, { style: "muted", size: "sm" })];

export const num = (n: number): string => n.toLocaleString("en-US");

const MOVES: Record<Move, Action> = {
  new: { id: "new", title: "New game", shortcut: "n" },
  continue: { id: "continue", title: "Keep going", shortcut: "enter" },
  undo: { id: "undo", title: "Undo the last move", shortcut: "u" },
  up: { id: "up", title: "Up", shortcut: ["up", "k"] },
  down: { id: "down", title: "Down", shortcut: ["down", "j"] },
  left: { id: "left", title: "Left", shortcut: ["left", "h"] },
  right: { id: "right", title: "Right", shortcut: ["right", "l"] },
};

/** A cell: a stack (so the cell keeps its box while its tile moves out) holding the tile, or the outline of an empty cell. */
function cell(st: State, i: number): ViewNode {
  const t = st.board[i];
  const last = st.last;
  const inner: ViewNode = !t
    ? { type: "tile", key: "empty", width: TILE, height: TILE, color: "neutral", fill: "outline", transition: { exit: "none" } }
    : {
        type: "tile", key: `t${t.id}`, width: TILE, height: TILE, text: String(t.v), ...lookOf(t.v),
        transition: { move: true, exit: "none", ...(last?.merged.includes(t.id) ? { enter: "pop", delay: 1 } : last?.spawned.includes(t.id) ? { enter: "pop", delay: 2 } : {}) },
      };
  return { type: "stack", key: `cell${i}`, minHeight: TILE, children: [inner] };
}

export function render(st: State, s: Settings): View {
  const ph = phase(st);
  const board = column(
    Array.from({ length: SIZE }, (_, r) => row(Array.from({ length: SIZE }, (_, c) => cell(st, r * SIZE + c)), { key: `row${r}`, gap: 2, minHeight: TILE })),
    { key: "board", gap: 2, padding: 2, surface: "sunken", radius: true },
  );

  const header = row(
    [
      text("Score", { style: "muted", size: "xs" }),
      text(num(st.score), { key: `score-${st.score}`, style: "number", size: "md", transition: { enter: "fade", exit: "none" } }),
      { type: "divider" },
      text("Best", { style: "muted", size: "xs" }),
      text(num(st.best), { key: `best-${st.best}`, style: "number", size: "md", transition: { enter: "fade", exit: "none" } }),
      { type: "divider" },
      text(`${num(st.moves)} move${st.moves === 1 ? "" : "s"}`, { style: "muted", size: "xs" }),
    ],
    { key: "header", minHeight: 20 },
  );

  let title: string, line: ViewNode[];
  if (ph === "won") {
    title = `${TARGET}!`;
    line = [
      text(`You made ${TARGET}`, { key: "won", style: "title", color: "success", transition: { enter: "slide-up" } }),
      row([...hint(["enter"], "keep going"), ...hint(["n"], "new game")], { key: "won-keys", gap: 1, transition: { enter: "fade" } }),
    ];
  } else if (ph === "over") {
    title = "Game over";
    line = [
      text(`Game over at ${num(st.score)}`, { key: "over", style: "title", color: "destructive", transition: { enter: "slide-up" } }),
      row([...hint(["enter"], "new game"), ...(st.prev && s.undo ? hint(["u"], "undo") : [])], { key: "over-keys", gap: 1, transition: { enter: "fade" } }),
    ];
  } else {
    title = st.moves ? `Score ${num(st.score)}` : "New game";
    line = [row([...hint(["up", "down", "left", "right"], "move"), ...hint(["n"], "new"), ...(st.prev && s.undo ? hint(["u"], "undo") : [])], { key: "play-keys", gap: 1 })];
  }

  // The header and the hint line take the board's width: the inner column is as wide as the board, the outer centres it.
  const tree = column(
    [column([header, board, row(line, { key: "line", gap: 3, minHeight: 24, justify: "center" })], { key: "game", gap: 2 })],
    { key: "table", padding: 4, grow: true, align: "center", justify: "center" },
  );

  const acts = legal(st, s).map((m) => (m === "new" && ph === "play" && st.moves ? { ...MOVES.new, confirm: "Start a new game? The board and the score are lost." } : MOVES[m]));
  return { tree, actions: acts, title, keys: "actions" };
}
