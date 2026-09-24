// Yahtzee: the rules (game.ts, pure) with rigged dice, every category,
// the upper bonus, the Yahtzee bonus and the Joker rules, the end of a
// game and the record; the moves as the view offers them (moves.ts,
// shared by the view and the page); and the extension over the wire: a
// view palette whose opening view is one `surface` with the boxes the
// dice may go in as its actions. The page (surface/) is browser code and
// is not run here.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { CATEGORIES, apply, average, bestOption, counted, gain, isJoker, isState, newGame, options, round, score, started, totals, type Category, type State } from "../../../extensions/yahtzee/game.ts";
import { moveOf, titleOf, viewActions } from "../../../extensions/yahtzee/moves.ts";
import type { View } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";

/** An rng that rolls these faces, in order. */
const faces = (...f: number[]) => { const q = f.map((d) => (d - 1) / 6 + 0.01); return () => q.shift() ?? 0; };
/** A round in play with these dice (one roll made) and these boxes filled. */
const at = (dice: number[], scores: State["scores"] = {}, more: Partial<State> = {}): State => ({ ...newGame(), dice, rolls: 1, scores, ...more });
const scoreIn = (st: State, category: Category) => apply(st, { type: "score", category });
/** Every box filled with 0 but these open. */
const allBut = (...open: Category[]): State["scores"] => Object.fromEntries(CATEGORIES.filter((c) => !open.includes(c)).map((c) => [c, 0]));

describe("the categories", () => {
  test("upper boxes count their face", () => {
    const d = [1, 3, 3, 5, 3];
    expect(["ones", "twos", "threes", "fours", "fives", "sixes"].map((c) => score(c as Category, d))).toEqual([1, 0, 9, 0, 5, 0]);
  });
  test("three and four of a kind are the sum of all five dice, or 0", () => {
    expect(score("three-kind", [2, 2, 2, 5, 6])).toBe(17);
    expect(score("three-kind", [2, 2, 4, 5, 6])).toBe(0);
    expect(score("four-kind", [4, 4, 1, 4, 4])).toBe(17);
    expect(score("four-kind", [4, 4, 1, 4, 3])).toBe(0);
    expect(score("three-kind", [6, 6, 6, 6, 6])).toBe(30);
    expect(score("four-kind", [6, 6, 6, 6, 6])).toBe(30);
  });
  test("a full house is three and two; a Yahtzee alone is not one", () => {
    expect(score("full-house", [2, 3, 2, 3, 3])).toBe(25);
    expect(score("full-house", [2, 3, 2, 3, 4])).toBe(0);
    expect(score("full-house", [5, 5, 5, 5, 5])).toBe(0);
  });
  test("straights: any four in a run for 30, five for 40, duplicates and order aside", () => {
    expect(score("small-straight", [1, 2, 3, 4, 4])).toBe(30);
    expect(score("small-straight", [6, 3, 5, 1, 4])).toBe(30);
    expect(score("small-straight", [2, 3, 4, 5, 6])).toBe(30);
    expect(score("small-straight", [1, 2, 3, 5, 6])).toBe(0);
    expect(score("large-straight", [5, 4, 3, 2, 1])).toBe(40);
    expect(score("large-straight", [2, 3, 4, 5, 6])).toBe(40);
    expect(score("large-straight", [1, 2, 3, 4, 6])).toBe(0);
  });
  test("a Yahtzee is five alike for 50; chance is the sum", () => {
    expect(score("yahtzee", [3, 3, 3, 3, 3])).toBe(50);
    expect(score("yahtzee", [3, 3, 3, 3, 2])).toBe(0);
    expect(score("chance", [1, 2, 3, 4, 6])).toBe(16);
  });
});

describe("a round", () => {
  test("the first roll throws all five; held dice stay on the next; three rolls at most", () => {
    let st = apply(newGame(), { type: "roll" }, faces(1, 2, 3, 4, 5));
    expect(st.dice).toEqual([1, 2, 3, 4, 5]);
    expect(st.rolls).toBe(1);
    st = apply(st, { type: "hold", die: 1 });
    st = apply(st, { type: "hold", die: 3 });
    expect(st.held).toEqual([false, true, false, true, false]);
    st = apply(st, { type: "roll" }, faces(6, 6, 6));
    expect(st.dice).toEqual([6, 2, 6, 4, 6]);
    st = apply(st, { type: "hold", die: 3 });
    st = apply(st, { type: "roll" }, faces(1, 1, 1, 1));
    expect(st.dice).toEqual([1, 2, 1, 1, 1]);
    expect(st.rolls).toBe(3);
    expect(apply(st, { type: "roll" }, faces(5, 5, 5, 5, 5))).toBe(st);
  });
  test("nothing to hold before the first roll or after the third; nothing to score before a roll", () => {
    const fresh = newGame();
    expect(apply(fresh, { type: "hold", die: 0 })).toBe(fresh);
    expect(apply(fresh, { type: "score", category: "chance" })).toBe(fresh);
    expect(options(fresh)).toEqual({});
    const last = at([1, 2, 3, 4, 5], {}, { rolls: 3 });
    expect(apply(last, { type: "hold", die: 0 })).toBe(last);
    expect(apply(at([1, 2, 3, 4, 5]), { type: "hold", die: 7 }).held).toEqual([false, false, false, false, false]);
  });
  test("holds from the last round do not carry: a round's first roll throws every die", () => {
    const st = apply({ ...newGame(), held: [true, true, true, true, true] }, { type: "roll" }, faces(2, 2, 2, 2, 2));
    expect(st.dice).toEqual([2, 2, 2, 2, 2]);
  });
  test("scoring fills the box and starts the next round; a filled box takes nothing more", () => {
    let st = scoreIn(at([2, 3, 4, 5, 6], {}, { held: [true, false, false, false, false] }), "large-straight");
    expect(st.scores["large-straight"]).toBe(40);
    expect(st).toMatchObject({ dice: [0, 0, 0, 0, 0], held: [false, false, false, false, false], rolls: 0 });
    expect(round(st)).toBe(2);
    st = { ...st, dice: [2, 3, 4, 5, 6], rolls: 1 };
    expect(options(st)["large-straight"]).toBeUndefined();
    expect(scoreIn(st, "large-straight")).toBe(st);
    // A zero is a legal choice: the box is scratched.
    expect(scoreIn(st, "yahtzee").scores.yahtzee).toBe(0);
  });
  test("options list every open box with what it would score", () => {
    const st = at([4, 4, 4, 2, 2], { fours: 12, chance: 20 });
    const o = options(st);
    expect(Object.keys(o)).toHaveLength(11);
    expect(o).toMatchObject({ twos: 4, "three-kind": 16, "four-kind": 0, "full-house": 25, yahtzee: 0 });
  });
});

describe("the upper bonus", () => {
  test("35 at 63 or more, not at 62", () => {
    const three = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: 18 };
    expect(totals({ ...newGame(), scores: three })).toMatchObject({ upper: 63, upperBonus: 35, total: 98 });
    expect(totals({ ...newGame(), scores: { ...three, ones: 2 } })).toMatchObject({ upper: 62, upperBonus: 0, total: 62 });
  });
  test("the box that reaches 63 gains its score and the 35", () => {
    const st = at([6, 6, 6, 1, 2], { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15 });
    expect(gain(st, "sixes")).toBe(18 + 35);
    expect(gain(st, "chance")).toBe(21);
  });
});

describe("Yahtzee bonus and the Joker", () => {
  test("with the Yahtzee box open a Yahtzee scores normally: 50 there, no full house elsewhere", () => {
    const st = at([5, 5, 5, 5, 5]);
    expect(isJoker(st)).toBe(false);
    expect(options(st)).toMatchObject({ yahtzee: 50, fives: 25, "full-house": 0, "large-straight": 0, chance: 25 });
    expect(scoreIn(st, "yahtzee").bonuses).toBe(0);
  });
  test("with 50 in the box: 100 more, and its number's upper box is forced while open", () => {
    const st = at([4, 4, 4, 4, 4], { yahtzee: 50 });
    expect(isJoker(st)).toBe(true);
    expect(options(st)).toEqual({ fours: 20 });
    expect(scoreIn(st, "chance")).toBe(st);
    const next = scoreIn(st, "fours");
    expect(next.bonuses).toBe(1);
    expect(totals(next)).toMatchObject({ upper: 20, yahtzeeBonus: 100, total: 170 });
    expect(gain(st, "fours")).toBe(120);
  });
  test("upper box filled: any open lower box, the fixed ones at full value", () => {
    const st = at([2, 2, 2, 2, 2], { yahtzee: 50, twos: 6, chance: 20 });
    expect(options(st)).toEqual({ "three-kind": 10, "four-kind": 10, "full-house": 25, "small-straight": 30, "large-straight": 40 });
    const next = scoreIn(st, "large-straight");
    expect(next.scores["large-straight"]).toBe(40);
    expect(next.bonuses).toBe(1);
    expect(bestOption(st)).toBe("large-straight");
  });
  test("upper box and every lower box filled: an open upper box for 0", () => {
    const scores = { ...allBut("ones", "sixes", "fives"), yahtzee: 50 };
    const st = at([5, 5, 5, 5, 5], { ...scores, fives: 10 });
    expect(options(st)).toEqual({ ones: 0, sixes: 0 });
    expect(scoreIn(st, "sixes")).toMatchObject({ bonuses: 1, scores: { sixes: 0 } });
  });
  test("a zero in the Yahtzee box: the Joker still applies, the bonus does not", () => {
    const st = at([3, 3, 3, 3, 3], { yahtzee: 0, threes: 9 });
    expect(isJoker(st)).toBe(true);
    expect(options(st)["full-house"]).toBe(25);
    expect(scoreIn(st, "full-house").bonuses).toBe(0);
  });
  test("bonuses add up, 100 each", () => {
    let st = at([6, 6, 6, 6, 6], { yahtzee: 50 });
    st = scoreIn(st, "sixes");
    st = scoreIn({ ...st, dice: [1, 1, 1, 1, 1], rolls: 2 }, "ones");
    expect(st.bonuses).toBe(2);
    expect(totals(st)).toMatchObject({ upper: 35, lower: 50, yahtzeeBonus: 200, total: 285 });
  });
});

describe("the end of a game and the record", () => {
  test("the thirteenth box ends it: final score, the record; a first game is no new best, beating one is", () => {
    const st = at([6, 6, 6, 6, 5], allBut("chance"));
    const end = scoreIn(st, "chance");
    expect(end.ended).toEqual({ total: 29, best: false });
    expect(end.record).toEqual({ games: 1, sum: 29, best: 29 });
    expect(scoreIn({ ...st, record: { games: 1, sum: 20, best: 20 } }, "chance").ended).toEqual({ total: 29, best: true });
    expect(apply(end, { type: "roll" })).toBe(end);
    expect(options(end)).toEqual({});
    expect(round(end)).toBe(13);
    expect(started(end)).toBe(false);
  });
  test("a lower score keeps the best and counts toward the average", () => {
    const r = { games: 2, sum: 400, best: 250 };
    const end = scoreIn(at([1, 1, 2, 2, 3], allBut("chance"), { record: r }), "chance");
    expect(end.ended).toEqual({ total: 9, best: false });
    expect(end.record).toEqual({ games: 3, sum: 409, best: 250 });
    expect(average(end.record)).toBe(136);
    expect(average({ games: 0, sum: 0, best: 0 })).toBe(0);
  });
  test("a whole game played out by the rules: 13 rounds, then over", () => {
    let st = newGame();
    const rng = faces(...Array(13 * 5).fill(3));
    for (let r = 0; r < 13; r++) {
      st = apply(st, { type: "roll" }, rng);
      st = scoreIn(st, bestOption(st)!);
    }
    expect(st.ended).toBeDefined();
    // 3s every round: yahtzee 50 then twelve bonus Jokers (threes 15, the lower boxes, then the upper for 0).
    expect(st.bonuses).toBe(12);
    expect(st.ended!.total).toBe(totals(st).total);
  });
  test("new game keeps the record, clears the card", () => {
    const st = apply(at([1, 2, 3, 4, 5], { chance: 15 }, { record: { games: 4, sum: 800, best: 260 } }), { type: "new" });
    expect(st).toEqual(newGame({ games: 4, sum: 800, best: 260 }));
    expect(started(st)).toBe(false);
    expect(started(apply(st, { type: "roll" }, faces(1, 1, 1, 1, 1)))).toBe(true);
  });
  test("a stored state is checked before it is played", () => {
    expect(isState(newGame())).toBe(true);
    expect(isState(at([1, 2, 3, 4, 5], { chance: 15 }))).toBe(true);
    expect(isState({ from: "an older version" })).toBe(false);
    expect(isState({ ...newGame(), dice: [1, 2, 3] })).toBe(false);
    expect(isState({ ...newGame(), scores: { bogus: 3 } })).toBe(false);
    expect(isState(null)).toBe(false);
  });
});

describe("the moves as the view offers them", () => {
  test("the title line says the round and the roll", () => {
    expect(titleOf(newGame())).toBe("Round 1 of 13");
    expect(titleOf(at([1, 2, 3, 4, 5], { chance: 15 }, { rolls: 2 }))).toBe("Round 2 · Roll 2 of 3");
    expect(titleOf(at([1, 2, 3, 4, 5], {}, { rolls: 3 }))).toBe("Round 1 · Choose a category");
    expect(titleOf(at([4, 4, 4, 4, 4], { yahtzee: 50 }))).toBe("Round 2 · Yahtzee bonus +100");
    expect(titleOf(at([4, 4, 4, 4, 4], { yahtzee: 0 }))).toBe("Round 2 · Yahtzee as a Joker");
    expect(titleOf({ ...newGame(), ended: { total: 240, best: true } })).toBe("Final score 240 · New best");
  });
  test("actions: roll while one is left, the options ranked by what they add, new game asking mid-game", () => {
    expect(viewActions(newGame()).map((a) => a.id)).toEqual(["roll", "new"]);
    expect(viewActions(newGame()).find((a) => a.id === "new")!.confirm).toBeUndefined();
    const st = at([2, 2, 2, 2, 2], { yahtzee: 50, twos: 6, chance: 20 }, { rolls: 3 });
    const acts = viewActions(st);
    expect(acts.map((a) => a.id)).toEqual(["score:large-straight", "score:small-straight", "score:full-house", "score:three-kind", "score:four-kind", "new"]);
    expect(acts[0].title).toBe("Score Large straight: 140");
    expect(acts.at(-1)).toMatchObject({ id: "new", style: "destructive" });
    expect(viewActions({ ...newGame(), ended: { total: 1, best: false } }).map((a) => a.id)).toEqual(["new"]);
  });
  test("an action id is a move", () => {
    expect(moveOf("roll")).toEqual({ type: "roll" });
    expect(moveOf("new")).toEqual({ type: "new" });
    expect(moveOf("score:full-house")).toEqual({ type: "score", category: "full-house" });
    expect(moveOf("score:bogus")).toBeUndefined();
    expect(moveOf("hold")).toBeUndefined();
  });
});

describe("the dice a category counts (the page's ring)", () => {
  test("the face, the kind, one die per step of the run", () => {
    expect(counted("fours", [4, 1, 4, 2, 3])).toEqual([true, false, true, false, false]);
    expect(counted("three-kind", [5, 2, 5, 5, 1])).toEqual([true, false, true, true, false]);
    expect(counted("small-straight", [1, 2, 3, 4, 4])).toEqual([true, true, true, true, false]);
    expect(counted("small-straight", [3, 4, 5, 6, 1])).toEqual([true, true, true, true, false]);
    expect(counted("chance", [1, 2, 3, 4, 5])).toEqual([true, true, true, true, true]);
  });
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => { stored.clear(); host = await Host.bundled(); });
  afterAll(() => host.kill());

  test("a view palette is input on the wire with view: view", async () => {
    const l = host.loaded().find((l) => l.extension === "yahtzee")!;
    expect(l.palettes).toEqual([{ name: "yahtzee", title: "Yahtzee", live: false, input: true, icon: tile("amber", "\u{f01ce}"), view: "view", ttl: undefined, detail: undefined, columns: undefined, placeholder: undefined, showDetail: undefined, filters: undefined }]);
  });
  test("view answers the card: one surface, roll and new game, the round", async () => {
    const v = await host.request<View>("view", { extension: "yahtzee", palette: "yahtzee" });
    expect(v.tree).toMatchObject({ type: "surface", src: "surface/index.html" });
    expect(v.title).toBe("Round 1 of 13");
    expect(v.actions.map((a) => a.id)).toEqual(["roll", "new"]);
    stored.set("yahtzee\0state", { from: "an older version" });
    expect((await host.request<View>("view", { extension: "yahtzee", palette: "yahtzee" })).title).toBe("Round 1 of 13");
  });
  test("the page's `moved` pushes the actions and the title for the saved state", async () => {
    stored.set("yahtzee\0state", at([3, 3, 5, 5, 5], { chance: 12 }, { rolls: 3 }));
    const push = host.surfaceSend("yahtzee", "yahtzee", { moved: true });
    const u = await host.nextViewUpdate("yahtzee", { palette: "yahtzee" });
    await push;
    const spec = u.spec as View;
    expect(spec.title).toBe("Round 2 · Choose a category");
    expect(spec.actions[0]).toMatchObject({ id: "score:full-house", title: "Score Full house: 25" });
    expect(spec.actions.some((a) => a.id === "roll")).toBe(false);
    expect(spec.tree).toMatchObject({ type: "surface", src: "surface/index.html" });
  });
});
