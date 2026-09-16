// The game as a view tree (`View` in `@zcag/pal`): the six rows of tiles
// on a sunken well on the left; on the right the puzzle's name, a message
// row (the notice for a bad guess, the result once it is over), the stats
// on a card after a game, and the keyboard coloured by what the guesses
// have shown. Tiles and keys are `tile` nodes drawn with the tokens, so
// the board follows the theme: an outline for an empty cell, paper for a
// typed letter (it pops in), green, amber and grey for the marks (a
// submitted row flips tile by tile), a deleted letter goes at once. The
// letters are hidden actions: they route, and ⌘K lists only the moves.
// No host imports: the gallery renders a fixture state with this same
// function.
import type { Action, View, ViewNode } from "@zcag/pal";
import { COLS, LETTERS, ROWS, actions as legal, canNew, keyMarks, mark, nextIsDaily, type Action as Move, type Letter, type Mark, type Settings, type State } from "./game.ts";
import { dayOf } from "./words.ts";

export const TILE = 48;
export const KEY_W = 32;
export const KEY_H = 40;

type Tile = Extract<ViewNode, { type: "tile" }>;
/** A mark's tile colour: the tag palette's green and amber, grey for a letter that is not in the word. */
export const COLOR_OF: Record<Mark, Tile["color"]> = { correct: "green", present: "amber", absent: "grey" };

const text = (value: string, extra: Partial<Extract<ViewNode, { type: "text" }>> = {}): ViewNode => ({ type: "text", value, ...extra });
const row = (children: ViewNode[], extra: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
const column = (children: ViewNode[], extra: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 2, ...extra, children });
const keycap = (keys: string): ViewNode => ({ type: "keycap", keys });
const hint = (keys: string[], what: string): ViewNode[] => [...keys.map(keycap), text(what, { style: "muted", size: "sm" })];

const KEYBOARD = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const PRAISE = ["Genius", "Magnificent", "Impressive", "Splendid", "Great", "Phew"];

/** The puzzle's name: `Daily #260` or `Practice`. */
export const nameOf = (st: State): string => (st.game.day !== null ? `Daily #${st.game.day + 1}` : "Practice");

function moves(st: State, s: Settings, today: number): Action[] {
  const newTitle = nextIsDaily(st, s, today) ? "Today's puzzle" : "Practice game";
  const playing = st.game.status === "play";
  const of: Record<Move, Action> = {
    submit: { id: "submit", title: "Submit the guess", shortcut: "enter" },
    delete: { id: "delete", title: "Delete a letter", shortcut: "backspace" },
    copy: { id: "copy", title: "Copy the result", shortcut: "c" },
    // Mid-game a bare N is a letter, so New game rides on a modifier there.
    new: { id: "new", title: newTitle, shortcut: playing ? "cmd+n" : "n" },
    ...(Object.fromEntries(LETTERS.map((l) => [l, { id: l, title: `Type ${l.toUpperCase()}`, shortcut: l, hidden: true }])) as Record<Letter, Action>),
  };
  return legal(st, s).map((m) => of[m]);
}

/** One board tile: keyed by its place and content, entering per what changed; a gone one leaves at once. */
function tile(st: State, r: number, c: number): ViewNode {
  const g = st.game;
  const base = { type: "tile" as const, width: TILE, height: TILE };
  if (r < g.guesses.length) {
    const w = g.guesses[r], m = mark(w, g.answer)[c];
    return { ...base, key: `g${r}${c}-${w[c]}${m[0]}`, text: w[c].toUpperCase(), color: COLOR_OF[m], fill: "solid", transition: { enter: "flip", exit: "none", delay: c } };
  }
  if (r === g.guesses.length && g.status === "play" && c < g.input.length) {
    return { ...base, key: `i${r}${c}-${g.input[c]}`, text: g.input[c].toUpperCase(), color: "neutral", fill: "solid", transition: { enter: "pop", exit: "none" } };
  }
  return { ...base, key: `e${r}${c}`, color: "neutral", fill: "outline", transition: { exit: "none" } };
}

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

/** The record on a card: four figures, then the guess distribution with the winning row in the accent. */
function statsBlock(st: State): ViewNode {
  const s = st.stats;
  const figure = (label: string, value: string): ViewNode => column([text(value, { style: "number", size: "xl" }), text(label, { style: "muted", size: "xs" })], { gap: 0, align: "center" });
  const most = Math.max(1, ...s.dist);
  const current = st.game.status === "won" ? st.game.guesses.length - 1 : -1;
  const bars = s.dist.map((n, i) =>
    row(
      [
        text(String(i + 1), { style: "mono", size: "xs", color: "faint", width: 8, align: "end" }),
        { type: "progress", value: n / most, width: 96, color: i === current ? undefined : "grey" },
        text(String(n), { style: "number", size: "xs", color: i === current ? "accent" : "muted", width: 20, align: "end" }),
      ],
      { key: `bar${i}`, gap: 1, minHeight: 14 },
    ),
  );
  return row(
    [
      row([figure("played", String(s.played)), figure("win %", String(pct(s.won, s.played))), figure("streak", String(s.streak)), figure("best", String(s.best))], { gap: 4, align: "start" }),
      column(bars, { gap: 0 }),
    ],
    { key: "stats", gap: 5, padding: 3, align: "start", surface: "elevated", radius: true, transition: { enter: "fade" } },
  );
}

export function render(st: State, s: Settings, today = dayOf()): View {
  const g = st.game;
  const nextWord = nextIsDaily(st, s, today) ? "today's puzzle" : "practice";
  const board = column(
    Array.from({ length: ROWS }, (_, r) => row(Array.from({ length: COLS }, (_, c) => tile(st, r, c)), { key: `row${r}`, gap: 1, minHeight: TILE })),
    { key: "board", gap: 1, padding: 2, surface: "sunken", radius: true },
  );

  const marks = keyMarks(g);
  const keyboard = column(
    KEYBOARD.map((keys, i) => row(keys.split("").map((l) => {
      const m = marks[l as Letter];
      return { type: "tile", key: `k${l}-${m ?? "none"}`, text: l.toUpperCase(), width: KEY_W, height: KEY_H, ...(m ? { color: COLOR_OF[m], fill: "solid" } : { color: "neutral", fill: "soft" }), transition: { enter: "fade", exit: "none" } } as ViewNode;
    }), { key: `keys${i}`, gap: 1, minHeight: KEY_H, justify: "center" })),
    { key: "keyboard", gap: 1 },
  );

  const head = row(
    [
      text(nameOf(st), { key: `name-${nameOf(st)}`, style: "title", transition: { enter: "fade", exit: "none" } }),
      ...(g.hard ? [{ type: "badge", text: "hard", color: "amber" } as ViewNode] : []),
      { type: "spacer" },
      text(st.stats.streak ? `streak ${st.stats.streak}` : st.stats.played ? `${st.stats.played} played` : "", { style: "muted", size: "xs" }),
    ],
    { key: "head", minHeight: 20 },
  );

  let title: string, line: ViewNode[];
  if (g.status === "won") {
    title = `${PRAISE[g.guesses.length - 1]}! ${g.guesses.length}/${ROWS}`;
    line = [text(title, { key: "won", style: "title", color: "success", transition: { enter: "slide-up" } })];
  } else if (g.status === "lost") {
    title = `The word was ${g.answer.toUpperCase()}`;
    line = [text(title, { key: "lost", style: "title", color: "destructive", transition: { enter: "slide-up" } })];
  } else {
    title = nameOf(st);
    line = st.notice ? [{ type: "badge", key: `notice-${st.notice.n}`, text: st.notice.text, color: "red", transition: { enter: "fade" } }] : [];
  }
  const keysLine = g.status === "play"
    ? row([...hint(["enter"], "submit"), ...hint(["backspace"], "delete"), ...(canNew(st, s) ? hint(["cmd+n"], nextWord) : [])], { key: "play-keys", gap: 1 })
    : row([...hint(["c"], "copy result"), ...(canNew(st, s) ? hint(["n"], nextWord) : [])], { key: "done-keys", gap: 1, transition: { enter: "fade" } });

  const side = column(
    [
      head,
      row(line, { key: "line", minHeight: 22 }),
      ...(g.status !== "play" ? [statsBlock(st)] : []),
      { type: "spacer" },
      keyboard,
      keysLine,
    ],
    { key: "side", gap: 2, grow: true, align: "start" },
  );

  const tree = row([board, side], { key: "table", padding: 4, gap: 5, grow: true, align: "stretch" });
  return { tree, actions: moves(st, s, today), title, keys: "actions" };
}
