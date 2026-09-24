// Solitaire: the rules (game.ts, pure) on tables laid out by hand, the
// tree (render.ts), and the extension over the wire: a view palette's
// meta, its opening tree, a pick that answers a tree and persists the
// state, the auto-finish's pushes and the clock that runs only while the
// table is shown.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { RANKS, SUITS, type Card } from "../../../extensions/blackjack/cards.ts";
import { DEFAULTS, F, STOCK, T, UNDO, WASTE, actions, apply, canFinish, finishStep, isState, newGame, quickTarget, type Action, type Pile, type State } from "../../../extensions/solitaire/game.ts";
import { COLUMN_H, clock, render } from "../../../extensions/solitaire/render.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";

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

const find = (n: ViewNode, pred: (n: ViewNode) => boolean, out: ViewNode[] = []): ViewNode[] => {
  if (pred(n)) out.push(n);
  if (n.type === "stack") n.children.forEach((c) => find(c, pred, out));
  return out;
};
const images = (v: View) => find(v.tree, (n) => n.type === "image") as Extract<ViewNode, { type: "image" }>[];

describe("render", () => {
  test("the clock reads minutes and seconds, hours when there are any", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(187_400)).toBe("3:07");
    expect(clock(3_765_000)).toBe("1:02:45");
  });
  test("a deal: the legal keys with their shortcuts, backs and faces keyed, the columns drop in, the cursor on the stock", () => {
    const st = newGame(DEFAULTS, () => 0.3);
    const v = render(st);
    expect(checkView(v, "test")).toBe(v);
    expect(v.keys).toBe("actions");
    expect(v.title).toBe("Stock · 24 left");
    expect(v.actions.map((a) => [a.id, a.shortcut])).toEqual([
      ["select", "enter"], ["left", ["left", "h"]], ["right", ["right", "l"]], ["up", ["up", "k"]], ["down", ["down", "j"]], ["draw", ["space", "d"]], ["new", "n"],
    ]);
    expect(v.actions[0].title).toBe("Draw");
    expect(v.actions.at(-1)!.confirm).toBeUndefined();
    const imgs = images(v);
    const faces = imgs.filter((n) => n.key!.startsWith("c-"));
    expect(faces.map((n) => n.key)).toEqual(st.tableau.map((p) => `c-${p.up[0]}-${st.game}`));
    expect(faces.every((n) => n.transition?.move && n.height === 80 && n.width === 56)).toBe(true);
    expect(faces[6].transition).toMatchObject({ enter: "slide-down", delay: 6 });
    expect(imgs.filter((n) => n.key!.startsWith("b-"))).toHaveLength(21);
    expect(imgs.filter((n) => n.key!.startsWith("b-") && n.height === 5)).toHaveLength(21);
    expect(find(v.tree, (n) => !!n.selected).map((n) => n.key)).toEqual([`stock-${st.game}`]);
    expect(find(v.tree, (n) => n.type === "keycap").map((n) => (n as { keys: string }).keys)).toEqual(["left", "right", "up", "down", "enter", "space", "u", "n"]);
  });
  test("mid-game: covered cards are strips, the cursor rings the run it takes, held cards ride under it and leave their pile", () => {
    const st = table({ tableau: tab(pile(["2C"], ["9H", "8S", "7D"]), pile([], ["10C"])), cursor: T(0), started: true, history: [table()] });
    const deep = apply(st, "up");
    const v = render(deep);
    expect(v.title).toBe("Pile 1 · 8♠ 7♦");
    expect(v.actions[0].title).toBe("Pick up 2 cards");
    expect(v.actions.find((a) => a.id === "new")).toMatchObject({ confirm: "Deal a new game? This one counts as lost.", style: "destructive" });
    const col = images(v).filter((n) => ["b-2C", "c-9H", "c-8S", "c-7D"].some((k) => n.key!.startsWith(k)));
    expect(col.map((n) => n.height)).toEqual([5, 20, 20, 80]);
    const ring = find(v.tree, (n) => !!n.selected)[0];
    expect(find(ring, (n) => n.type === "image").map((n) => n.key!.split("-")[1])).toEqual(["8S", "7D"]);
    const carried = render({ ...apply(deep, "select"), cursor: T(1) });
    expect(carried.title).toBe("Moving 8♠ and 1 more");
    expect(carried.actions[0].title).toBe("Drop here");
    const ring2 = find(carried.tree, (n) => !!n.selected)[0];
    expect(find(ring2, (n) => n.type === "image").map((n) => n.key!.split("-")[1])).toEqual(["8S", "7D"]);
    expect(images(carried).filter((n) => n.key!.includes("8S"))).toHaveLength(1);
    expect(checkView(carried, "test")).toBe(carried);
    // A long run tightens, never under 16 px a card.
    const long = render(table({ tableau: tab(pile(["2C", "3C", "4C", "5C", "6C", "7C"], ["KH", "QS", "JH", "10S", "9H", "8S", "7H", "6S", "5H", "4S", "3H", "2S"])) }));
    const heights = images(long).map((n) => n.height!);
    expect(Math.min(...heights.filter((h) => h > 5))).toBe(16);
    expect(COLUMN_H).toBeGreaterThan(200);
  });
  test("a note, a draw flipping in, draw three fanned, the won table", () => {
    const st = table({ waste: ["7H"], tableau: tab(pile([], ["9S"])), cursor: WASTE });
    expect(render(play({ ...apply(st, "select"), cursor: T(0) }, "select")).title).toBe("7♥ can't go on 9♠");
    const three = apply(table({ draw: 3, stock: ["2S", "3S", "4S", "5S"] }), "draw");
    const fan = images(render(three)).filter((n) => n.key!.startsWith("c-"));
    expect(fan.map((n) => [n.key!.split("-")[1], n.width, n.transition?.enter, n.transition?.delay])).toEqual([["5S", 24, "flip", 0], ["4S", 24, "flip", 1], ["3S", 56, "flip", 2]]);
    const won = render(play(lastCard(), "select", "select"));
    expect(won.title).toBe("You won");
    expect(won.actions).toEqual([{ id: "new", title: "New game", shortcut: ["enter", "n"] }]);
    expect(find(won.tree, (n) => !!n.selected)).toHaveLength(0);
    expect(images(won).map((n) => n.key!.split("-")[1])).toEqual(SUITS.map((s) => `K${s}`));
  });
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => {
    stored.clear();
    process.env.PAL_SOLITAIRE_FINISH_MS = "40";
    process.env.PAL_SOLITAIRE_TICK_MS = "20";
    host = await Host.bundled().finally(() => { delete process.env.PAL_SOLITAIRE_FINISH_MS; delete process.env.PAL_SOLITAIRE_TICK_MS; });
  });
  afterAll(() => host.kill());

  test("a view palette is input on the wire with view: view", () => {
    const l = host.loaded().find((l) => l.extension === "solitaire")!;
    expect(l.palettes).toEqual([{ name: "solitaire", title: "Solitaire", live: false, input: true, icon: tile("green", "\u{f18af}"), view: "view", ttl: undefined, detail: undefined, columns: undefined, placeholder: undefined, showDetail: undefined, filters: undefined }]);
  });
  test("view answers the deal, a pick the next tree with the state persisted; the draw setting applies from the next deal", async () => {
    const v = await host.request<View>("view", { extension: "solitaire", palette: "solitaire" });
    expect(v.title).toBe("Stock · 24 left");
    const r = await host.pick("solitaire", "solitaire", "view", "select");
    expect((r.view as View).title).toBe("Stock · 23 left");
    const st = stored.get("solitaire\0state") as State;
    expect(st).toMatchObject({ moves: 1, started: true, stats: { played: 1, won: 0 } });
    expect(st.waste).toHaveLength(1);
    host.changeSettings("solitaire", { settings: { draw: "3" } });
    await host.pick("solitaire", "solitaire", "view", "new");
    const fresh = stored.get("solitaire\0state") as State;
    expect(fresh).toMatchObject({ draw: 3, moves: 0, stats: { played: 1, won: 0 } });
  });
  test("once every card is face up the rest goes home a card at a time, each pushed", async () => {
    // The king of spades carried to the empty fifth pile uncovers the last face-down card; six cards are left to go home.
    const st = table({
      foundations: [upTo("S", 11), upTo("H", 11), upTo("D", 12), upTo("C", 12)],
      tableau: tab(pile(["QH"], ["KS"]), pile([], ["KH", "QS"]), pile([], ["KC"]), pile([], ["KD"])),
      stock: [], held: { from: T(0), count: 1 }, cursor: T(4), started: true, stats: { played: 1, won: 0 },
    });
    stored.set("solitaire\0state", st);
    const before = host.viewUpdates("solitaire", { palette: "solitaire" }).length;
    const dropped = await host.pick("solitaire", "solitaire", "view", "select");
    expect((dropped.view as View).title).toBe("Finishing…");
    expect((dropped.view as View).actions.map((a) => a.id)).toEqual(["finish", "new"]);
    const last = await host.nextViewUpdate("solitaire", { palette: "solitaire" }, (u) => (u.spec as View).title === "You won");
    expect(host.viewUpdates("solitaire", { palette: "solitaire" }).length - before).toBe(6);
    expect((last.spec as View).actions.map((a) => a.id)).toEqual(["new"]);
    expect(stored.get("solitaire\0state")).toMatchObject({ won: true, stats: { played: 1, won: 1 } });
  });
  test("the clock runs only while the table is shown", async () => {
    const st = { ...table({ stock: ["2S", "3S"] }), started: true, elapsed: 5000 };
    stored.set("solitaire\0state", st);
    await host.pick("solitaire", "solitaire", "view", "left");
    expect((stored.get("solitaire\0state") as State).elapsed).toBe(5000);
    const from = host.viewUpdates("solitaire", { palette: "solitaire" }).length;
    host.viewShown("solitaire", { palette: "solitaire" });
    await host.until(() => host.viewUpdates("solitaire", { palette: "solitaire" }).length > from, 3000, "a clock tick");
    host.viewHidden("solitaire", { palette: "solitaire" });
    await host.until(() => (stored.get("solitaire\0state") as State).elapsed > 5000, 3000, "the time folded in");
    const at = (stored.get("solitaire\0state") as State).elapsed;
    await host.pick("solitaire", "solitaire", "view", "right");
    expect((stored.get("solitaire\0state") as State).elapsed).toBe(at);
  });
});
