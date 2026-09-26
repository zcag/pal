// Solitaire: the rules (game.ts, pure) on tables laid out by hand, the
// pointer's moves and the title line, the page's layout (surface/layout.ts,
// pure: the fit at both panel widths), and the extension over the wire: a
// view palette whose view is the page.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { DEFAULTS, F, RANKS, STOCK, T, UNDO, WASTE, actions, apply, canFinish, clock, finishStep, headline, isState, newGame, play as drag, quickTarget, type Action, type Card, type Pile, type State } from "../../../extensions/solitaire/game.ts";
import { RATIO, geometry, layout } from "../../../extensions/solitaire/surface/layout.ts";
import type { View } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";

const pile = (down: Card[], up: Card[]): Pile => ({ down, up });
const empty = (): Pile[] => Array.from({ length: 7 }, () => pile([], []));
/** A table laid out by hand: seven empty piles, one card in the stock (an empty stock under face-up piles would finish itself), nothing else unless given. */
const table = (o: Partial<State> = {}): State => ({ ...newGame(DEFAULTS, () => 0.5), stock: ["5D"], waste: [], foundations: [[], [], [], []], tableau: empty(), ...o });
/** A foundation holding its suit from the ace up to `rank`. */
const upTo = (suit: string, rank: number) => RANKS.slice(0, rank).map((r) => `${r}${suit}` as Card);
const play = (st: State, ...keys: Action[]) => keys.reduce((s, k) => apply(s, k), st);
const tab = (...piles: Pile[]) => [...piles, ...empty()].slice(0, 7);

describe("the deal", () => {
  test("28 cards to the tableau, one to seven, the last of each face up; 24 in the stock; the record carries over", () => {
    const st = newGame(DEFAULTS, () => 0.3, { stats: { played: 3, won: 1 }, game: 3 });
    expect(st.tableau.map((p) => [p.down.length, p.up.length])).toEqual([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1]]);
    expect(st.tableau.flatMap((p) => [...p.down, ...p.up])).toHaveLength(28);
    expect(st.stock).toHaveLength(24);
    expect(new Set([...st.stock, ...st.tableau.flatMap((p) => [...p.down, ...p.up])]).size).toBe(52);
    expect(st).toMatchObject({ waste: [], foundations: [[], [], [], []], moves: 0, draw: 1, cursor: STOCK, started: false, won: false, game: 4, stats: { played: 3, won: 1 } });
    expect(newGame({ draw: "3" }).draw).toBe(3);
    expect(isState(st)).toBe(true);
    expect(isState({ ...st, tableau: [] })).toBe(false);
  });
});

describe("moves", () => {
  test("the waste's card onto a pile: down by one, the other colour; the first move starts the game", () => {
    const st = table({ waste: ["7H"], tableau: tab(pile([], ["8S"])), cursor: WASTE });
    const held = apply(st, "select");
    expect(held.held).toEqual({ from: WASTE, count: 1 });
    const done = apply({ ...held, cursor: T(0) }, "select");
    expect(done.tableau[0].up).toEqual(["8S", "7H"]);
    expect(done.waste).toEqual([]);
    expect(done).toMatchObject({ moves: 1, started: true, held: undefined, stats: { played: 1, won: 0 } });
  });
  test("an illegal drop cancels with a note and moves nothing", () => {
    const st = table({ waste: ["7H"], tableau: tab(pile([], ["9S"]), pile([], ["8H"]), pile([], [])), cursor: WASTE });
    const drop = (to: number) => apply({ ...apply(st, "select"), cursor: to }, "select");
    expect(drop(T(0))).toMatchObject({ note: "7♥ can't go on 9♠", held: undefined, waste: ["7H"], moves: 0 });
    expect(drop(T(1)).note).toBe("7♥ can't go on 8♥");
    expect(drop(T(2)).note).toBe("Only a king goes on an empty pile");
    expect(drop(F(0)).note).toBe("The ♥ foundation needs A♥");
    // The note lasts one key.
    expect(apply(drop(T(0)), "right").note).toBeUndefined();
  });
  test("a king on an empty pile; a face-up run pile to pile, and the card it uncovers turns over", () => {
    const st = table({ tableau: tab(pile(["2C"], ["KD", "QS", "JH"]), pile([], [])), cursor: T(0) });
    // Up takes more of the run, and stops at its top.
    const deep = play(st, "up", "up");
    expect(deep.depth).toBe(3);
    const moved = play({ ...apply(deep, "select"), cursor: T(1) }, "select");
    expect(moved.tableau[1].up).toEqual(["KD", "QS", "JH"]);
    expect(moved.tableau[0]).toEqual({ down: [], up: ["2C"] });
    // Part of a run: the two below the king onto a red king elsewhere.
    const part = table({ tableau: tab(pile([], ["KD", "QS", "JH"]), pile([], ["KH"])), cursor: T(0) });
    expect(play({ ...play(part, "up", "select"), cursor: T(1) }, "select").tableau.map((p) => p.up).slice(0, 2)).toEqual([["KD"], ["KH", "QS", "JH"]]);
  });
  test("a tableau card to its foundation and back; a foundation takes one card at a time, on its suit's whichever the cursor is on", () => {
    const st = table({ foundations: [[], upTo("H", 2), [], []], tableau: tab(pile(["5C"], ["3H"]), pile([], ["4S"])), cursor: T(0) });
    const home = play({ ...apply(st, "select"), cursor: F(3) }, "select");
    expect(home.foundations[1]).toEqual(["AH", "2H", "3H"]);
    expect(home.tableau[0]).toEqual({ down: [], up: ["5C"] });
    const back = play({ ...play({ ...home, cursor: F(1) }, "select"), cursor: T(1) }, "select");
    expect(back.foundations[1]).toEqual(["AH", "2H"]);
    expect(back.tableau[1].up).toEqual(["4S", "3H"]);
    const two = table({ tableau: tab(pile([], ["2H", "AS"])), cursor: T(0) });
    expect(play({ ...play(two, "up", "select"), cursor: F(0) }, "select").note).toBe("One card at a time goes to a foundation");
  });
  test("Enter twice on the same card: its foundation, else the first pile that takes it, else a note", () => {
    const st = table({ waste: ["AD"], tableau: tab(pile([], ["9C"]), pile([], ["8S"]), pile([], ["9H"])), cursor: WASTE });
    expect(play(st, "select", "select").foundations[2]).toEqual(["AD"]);
    const eight = { ...st, cursor: T(1) };
    expect(quickTarget(eight, T(1), 1)).toBe(T(2));
    expect(play(eight, "select", "select").tableau[2].up).toEqual(["9H", "8S"]);
    expect(play({ ...st, cursor: T(0) }, "select", "select")).toMatchObject({ note: "No move for 9♣", held: undefined, moves: 0 });
    // A king that is a whole pile does not hop to another empty one.
    const king = table({ tableau: tab(pile([], ["KS"])), cursor: T(0) });
    expect(play(king, "select", "select").note).toBe("No move for K♠");
  });
});

describe("the stock", () => {
  test("draw one, the waste turned back over once the stock is out, nothing left a note", () => {
    const st = table({ stock: ["2S", "3S"] });
    const one = apply(st, "select");
    expect(one).toMatchObject({ stock: ["2S"], waste: ["3S"], drawn: ["3S"], moves: 1 });
    const out = play(one, "draw");
    expect(out).toMatchObject({ stock: [], waste: ["3S", "2S"] });
    const back = apply(out, "draw");
    expect(back).toMatchObject({ stock: ["2S", "3S"], waste: [], moves: 3 });
    expect(play(back, "draw", "draw").waste).toEqual(["3S", "2S"]);
    expect(apply(table({ stock: [], tableau: tab(pile(["2C"], ["3C"])) }), "draw")).toMatchObject({ note: "Nothing left to draw", moves: 0 });
  });
  test("draw three: three at a time, the last turned on top; fewer when fewer are left; only the top plays", () => {
    const st = table({ draw: 3, stock: ["2S", "3S", "4S", "5S", "6S"], tableau: tab(pile([], ["7H"])), cursor: STOCK });
    const three = apply(st, "select");
    expect(three).toMatchObject({ stock: ["2S", "3S"], waste: ["6S", "5S", "4S"], drawn: ["6S", "5S", "4S"] });
    expect(apply(three, "draw")).toMatchObject({ stock: [], waste: ["6S", "5S", "4S", "3S", "2S"] });
    expect(play({ ...three, cursor: WASTE }, "select", "select").waste).toEqual(["6S", "5S", "4S"]);
    expect(play({ ...three, cursor: WASTE }, "select", "select").note).toBe("No move for 4♠");
    const turned = play(apply(three, "draw"), "draw");
    expect(turned).toMatchObject({ stock: ["2S", "3S", "4S", "5S", "6S"], waste: [] });
  });
});

describe("undo", () => {
  test("puts the cards back, the flip too, with the cursor on the pile they came from; while holding, puts the held cards down", () => {
    const st = table({ tableau: tab(pile(["2C"], ["7H"]), pile([], ["8S"])), cursor: T(0) });
    expect(actions(st)).not.toContain("undo");
    const held = apply(st, "select");
    expect(actions(held)).toContain("undo");
    expect(apply(held, "undo").held).toBeUndefined();
    const moved = apply({ ...held, cursor: T(1) }, "select");
    expect(moved.tableau[0].up).toEqual(["2C"]);
    const undone = apply(moved, "undo");
    expect(undone.tableau.slice(0, 2)).toEqual([pile(["2C"], ["7H"]), pile([], ["8S"])]);
    expect(undone).toMatchObject({ moves: 0, cursor: T(0), history: [] });
    expect(undone.started).toBe(true);
  });
  test("draws undo too, and the history is capped", () => {
    const st = table({ stock: ["2S", "3S"] });
    expect(play(st, "draw", "draw", "undo", "undo")).toMatchObject({ stock: ["2S", "3S"], waste: [], moves: 0 });
    let long = table({ stock: ["2S"] });
    for (let i = 0; i < UNDO + 20; i++) long = apply(long, "draw");
    expect(long.history).toHaveLength(UNDO);
  });
});

describe("the cursor", () => {
  test("left and right walk all thirteen piles and wrap; up and down pick the depth, then change rows", () => {
    const st = table({ tableau: tab(pile(["2C"], ["9H", "8S"])), stock: ["2S"] });
    expect(apply(st, "left").cursor).toBe(T(6));
    expect(play(st, "right", "right").cursor).toBe(F(0));
    const t0 = { ...st, cursor: T(0) };
    expect(play(t0, "up").depth).toBe(2);
    expect(play(t0, "up", "up")).toMatchObject({ cursor: STOCK, depth: 1 });
    expect(play(t0, "up", "down").depth).toBe(1);
    expect(play(t0, "down")).toMatchObject({ cursor: T(0), depth: 1 });
    expect(apply({ ...st, cursor: F(2) }, "down").cursor).toBe(T(5));
    expect(apply({ ...st, cursor: T(2) }, "up").cursor).toBe(WASTE);
  });
  test("holding, the stops are the piles the cards can go on and where they came from; up takes one card to its foundation", () => {
    const st = table({ tableau: tab(pile([], ["AH"]), pile([], ["9C"])), cursor: T(0) });
    const held = apply(st, "select");
    expect(apply(held, "left").cursor).toBe(F(3));
    expect(play(held, "left", "left", "left", "left", "left").cursor).toBe(T(6));
    expect(play(held, "right", "right", "right", "right", "right", "right", "right").cursor).toBe(F(0));
    expect(apply(held, "up").cursor).toBe(F(1));
    expect(play(held, "up", "select").foundations[1]).toEqual(["AH"]);
    // A run never goes to a foundation, so the cursor skips them and up stays put.
    const two = apply(table({ tableau: tab(pile([], ["9C", "8H"])), cursor: T(0), depth: 2 }), "select");
    expect(two.held).toEqual({ from: T(0), count: 2 });
    expect(apply(two, "left").cursor).toBe(T(6));
    expect(apply(two, "up").cursor).toBe(T(0));
  });
});

/** A table one move from the end: every card home but the king of clubs, on the first pile. */
const lastCard = () => table({ foundations: [upTo("S", 13), upTo("H", 13), upTo("D", 13), upTo("C", 12)], stock: [], waste: ["KC"], cursor: WASTE, started: true, stats: { played: 5, won: 2 }, history: [table()] });

describe("winning", () => {
  test("the last card home wins: the record moves, undo and the cursor keys are gone, Enter deals again", () => {
    const won = play(lastCard(), "select", "select");
    expect(won).toMatchObject({ won: true, stats: { played: 5, won: 3 } });
    expect(actions(won)).toEqual(["new"]);
    expect(apply(won, "undo")).toBe(won);
    const next = apply(won, "new");
    expect(next).toMatchObject({ won: false, moves: 0, started: false, stats: { played: 5, won: 3 }, game: won.game + 1 });
  });
  test("every card face up and nothing to draw: the rest finishes itself, lowest first", () => {
    const st = table({ stock: [], foundations: [upTo("S", 11), upTo("H", 11), upTo("D", 12), upTo("C", 12)], tableau: tab(pile([], ["KS", "QH"]), pile([], ["KH", "QS"]), pile([], ["KC"]), pile([], ["KD"])), started: true });
    expect(canFinish(st)).toBe(true);
    expect(canFinish({ ...st, stock: ["AS"] })).toBe(false);
    expect(canFinish({ ...st, tableau: tab(pile(["KS"], ["QH"])) })).toBe(false);
    expect(actions(st)).toEqual(["finish", "new"]);
    const one = finishStep(st);
    expect(one.foundations.map((f) => f.length)).toEqual([11, 12, 12, 12]);
    const done = apply(st, "finish");
    expect(done.won).toBe(true);
    expect(done.foundations.every((f) => f.length === 13)).toBe(true);
  });
});

describe("the pointer", () => {
  test("play: a run dropped on a pile that takes it, a refusal with its note, where it goes when the pile is its own", () => {
    const st = table({ tableau: tab(pile(["2C"], ["9H", "8S"]), pile([], ["10C"]), pile([], ["10H"])), held: { from: T(2), count: 1 } });
    const moved = drag(st, T(0), 2, T(1));
    expect(moved.tableau.slice(0, 2)).toEqual([pile([], ["2C"]), pile([], ["10C", "9H", "8S"])]);
    expect(moved).toMatchObject({ moves: 1, held: undefined, history: [expect.anything()] });
    expect(drag(st, T(0), 2, T(2))).toMatchObject({ note: "9♥ can't go on 10♥", held: undefined, moves: 0, tableau: st.tableau });
    // Its own pile, or none: where Enter twice would send it.
    expect(drag(st, T(0), 2).tableau[1].up).toEqual(["10C", "9H", "8S"]);
    expect(drag(st, T(0), 2, T(0)).tableau[1].up).toEqual(["10C", "9H", "8S"]);
    expect(drag(st, T(1), 1).note).toBe("No move for 10♣");
    // More cards than the pile shows face up, or a won table: nothing happens.
    expect(drag(st, T(0), 3).tableau).toBe(st.tableau);
    expect(drag({ ...st, won: true }, T(0), 2, T(1)).tableau).toBe(st.tableau);
  });
});

describe("the title line and the clock", () => {
  test("the clock reads minutes and seconds, hours when there are any", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(187_400)).toBe("3:07");
    expect(clock(3_765_000)).toBe("1:02:45");
  });
  test("what the cursor is on, what is held, a note, the finish, the win", () => {
    expect(headline(newGame(DEFAULTS, () => 0.3))).toBe("Stock · 24 left");
    const st = table({ tableau: tab(pile(["2C"], ["9H", "8S", "7D"]), pile([], ["10C"])), cursor: T(0), started: true });
    expect(headline(apply(st, "up"))).toBe("Pile 1 · 8♠ 7♦");
    expect(headline(play(apply(st, "up"), "select"))).toBe("Moving 8♠ and 1 more");
    expect(headline(drag(st, T(0), 1, T(1)))).toBe("7♦ can't go on 10♣");
    expect(headline({ ...st, cursor: F(1), foundations: [[], upTo("H", 3), [], []] })).toBe("♥ foundation · 3 of 13");
    expect(headline({ ...st, cursor: STOCK, stock: [], waste: ["2S"] })).toBe("Stock · Enter turns the waste over");
    expect(headline({ ...st, stock: [], tableau: tab(pile([], ["KS"])) })).toBe("Finishing…");
    expect(headline(play(lastCard(), "select", "select"))).toBe("You won");
  });
});

describe("the page's layout", () => {
  const inside = (b: { x: number; y: number; w: number; h: number }, o: { x: number; y: number; w: number; h: number }) =>
    b.x >= o.x && b.y >= o.y && b.x + b.w <= o.x + o.w + 0.5 && b.y + b.h <= o.y + o.h + 0.5;
  for (const [vw, vh] of [[720, 390], [560, 390]]) {
    test(`${vw} by ${vh}: a deal and a long column fit the felt, every face-up card still shows its rank`, () => {
      const deal = newGame(DEFAULTS, () => 0.3);
      const g = geometry(vw, vh, deal);
      expect(g.felt.x + g.felt.w).toBeLessThanOrEqual(g.rail.x);
      expect(g.rail.x + g.rail.w).toBeLessThanOrEqual(vw);
      expect(g.h / g.w).toBeCloseTo(RATIO, 1);
      expect(g.w).toBeGreaterThanOrEqual(vw === 720 ? 70 : 54);
      // The seven columns side by side, none over the next.
      g.col.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(g.col[i] + g.w));
      const l = layout(deal, g);
      expect(l.cards.size).toBe(52);
      for (const p of l.cards.values()) expect(inside({ ...p, w: g.w, h: g.h }, g.felt)).toBe(true);

      const up: Card[] = ["KH", "QS", "JH", "10S", "9H", "8S", "7H", "6S", "5H", "4S", "3H", "2S"];
      const long = table({ tableau: tab(pile(["2C", "3C", "4C", "5C", "6C", "7C"], up)) });
      const lg = geometry(vw, vh, long);
      expect(lg.w).toBeGreaterThanOrEqual(48);
      const ll = layout(long, lg);
      const ys = up.map((c) => ll.cards.get(c)!.y);
      expect(ys.at(-1)! + lg.h).toBeLessThanOrEqual(lg.bottom);
      ys.slice(1).forEach((y, i) => expect(y - ys[i]).toBeGreaterThanOrEqual(Math.floor(lg.h * 0.19)));
    });
  }
  test("held cards ride on the pile under the cursor, lifted and on top, the ring round them; draw three fans the waste", () => {
    const st = table({ tableau: tab(pile(["2C"], ["9H", "8S"]), pile([], ["10C"])), cursor: T(0), depth: 2 });
    const g = geometry(720, 390, st);
    const riding = layout({ ...apply(st, "select"), cursor: T(1) }, g);
    const ten = riding.cards.get("10C")!, nine = riding.cards.get("9H")!;
    expect(nine).toMatchObject({ x: ten.x, lifted: true });
    expect(nine.y).toBeGreaterThan(ten.y - g.h * 0.1);
    expect(nine.z).toBeGreaterThan(1000);
    expect(riding.ring).toMatchObject({ x: nine.x, y: nine.y, h: riding.cards.get("8S")!.y + g.h - nine.y });
    // Before the pick-up the ring holds the two cards where they lie.
    expect(layout(st, g).ring).toMatchObject({ y: layout(st, g).cards.get("9H")!.y });
    const three = layout(apply(table({ draw: 3, stock: ["2S", "3S", "4S", "5S"] }), "draw"), g);
    const xs = (["5S", "4S", "3S"] as Card[]).map((c) => three.cards.get(c)!.x);
    expect(xs[1]).toBeGreaterThan(xs[0]);
    expect(xs[2]).toBeGreaterThan(xs[1]);
    expect(layout({ ...lastCard(), won: true }, g).ring).toBeUndefined();
  });
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => { host = await Host.bundled(); });
  afterAll(() => host.kill());

  test("a view palette is input on the wire with view: view", () => {
    const l = host.loaded().find((l) => l.extension === "solitaire")!;
    expect(l.palettes).toEqual([{ name: "solitaire", title: "Solitaire", live: false, input: true, icon: tile("green", "\u{f18af}"), view: "view", ttl: undefined, detail: undefined, columns: undefined, placeholder: undefined, showDetail: undefined, filters: undefined }]);
  });
  test("the view is the page, with the actions ⌘K hands it", async () => {
    const v = await host.request<View>("view", { extension: "solitaire", palette: "solitaire" });
    expect(v.tree).toEqual({ type: "surface", src: "surface/index.html" } as unknown as View["tree"]);
    expect(v.title).toBe("Solitaire");
    expect(v.actions.map((a) => a.id)).toEqual(["draw", "undo", "finish", "new", "clock"]);
    expect(v.actions.at(-1)).toMatchObject({ title: "Hide the clock", shortcut: "t" });
  });
  test("the page hides the clock (T): the setting written, the ⌘K title following", async () => {
    const push = host.surfaceSend("solitaire", "solitaire", { clock: false });
    const u = await host.nextViewUpdate("solitaire", { palette: "solitaire" });
    expect(await push).toEqual({ clock: false });
    expect(host.written.get("solitaire")).toEqual({ clock: false });
    expect((u.spec as View).actions.at(-1)?.title).toBe("Show the clock");
    expect(await host.surfaceSend("solitaire", "solitaire", { nonsense: 1 })).toBeUndefined();
    expect(await host.surfaceSend("solitaire", "solitaire", { clock: true })).toEqual({ clock: true });
    expect(host.written.get("solitaire")).toEqual({});
  });
});
