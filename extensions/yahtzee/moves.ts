// The moves as the view offers them and the words the title line says:
// one place for the extension (the view's actions, what cmd+k lists and
// the footer names) and the page (what an action id means). Types only
// from `@zcag/pal`: the page imports this file too.
import type { Action } from "@zcag/pal";
import { CATEGORIES, LABELS, ROLLS, ROUNDS, gain, isJoker, round, started, type Category, type Move, type State } from "./game.ts";

export const CONFIRM_NEW = "Start over? This game's card is lost.";

/**
 * The view's actions now: Roll while a roll is left, every category the dice
 * may go in (the one that adds most first, so cmd+k is a ranked choice),
 * New game (asking first mid-game).
 */
export function viewActions(st: State): Action[] {
  const out: Action[] = [];
  if (st.ended) return [{ id: "new", title: "New game", shortcut: ["n", "enter"] }];
  if (st.rolls < ROLLS) out.push({ id: "roll", title: st.rolls === 0 ? "Roll the dice" : "Roll again", shortcut: ["space", "r"] });
  const scored = CATEGORIES.map((c) => [c, gain(st, c)] as const).filter((x): x is readonly [Category, number] => x[1] !== undefined);
  scored.sort((a, b) => b[1] - a[1]);
  for (const [c, g] of scored) out.push({ id: `score:${c}`, title: `Score ${LABELS[c]}: ${g}` });
  out.push({ id: "new", title: "New game", shortcut: "n", ...(started(st) ? { confirm: CONFIRM_NEW, style: "destructive" as const } : {}) });
  return out;
}

/** A view action's id as a move (`roll`, `score:chance`, `new`). */
export function moveOf(id: string): Move | undefined {
  if (id === "roll" || id === "new") return { type: id };
  const cat = id.startsWith("score:") ? (id.slice(6) as Category) : undefined;
  return cat && CATEGORIES.includes(cat) ? { type: "score", category: cat } : undefined;
}

/** The round and the roll in a few words: `Round 4 of 13`, `Round 4 · Roll 2 of 3`, `Round 4 · Choose a category`, `Final score 247`. */
export function titleOf(st: State): string {
  if (st.ended) return st.ended.best ? `Final score ${st.ended.total} · New best` : `Final score ${st.ended.total}`;
  const r = round(st);
  if (st.rolls === 0) return `Round ${r} of ${ROUNDS}`;
  if (isJoker(st)) return st.scores.yahtzee === 50 ? `Round ${r} · Yahtzee bonus +100` : `Round ${r} · Yahtzee as a Joker`;
  if (st.rolls >= ROLLS) return `Round ${r} · Choose a category`;
  return `Round ${r} · Roll ${st.rolls} of ${ROLLS}`;
}
