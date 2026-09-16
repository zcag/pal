// 2048: the rules (game.ts, pure) on rigged boards, the tree (render.ts),
// and the extension over the wire: a view palette's meta, its opening
// tree, picks that answer trees and persist the state, the undo setting.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { DEFAULTS, SIZE, actions, apply, canMove, isState, newGame, phase, slide, slideLine, spawn, type Board, type State } from "../../../extensions/2048/game.ts";
import { TILE, lookOf, render } from "../../../extensions/2048/render.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";

let ids = 1;
const tiles = (vs: number[]): Board => vs.map((v) => (v ? { id: ids++, v } : null));
const values = (b: Board) => b.map((t) => t?.v ?? 0);
const state = (vs: number[], extra: Partial<State> = {}): State => ({ board: tiles(vs), score: 0, best: 0, moves: 0, seq: 1000, won: false, kept: false, games: 1, ...extra });
/** A spawn on the first free cell, always a 2. */
const first = () => 0;
/** Feeds `rng` the numbers in turn. */
const seq = (...ns: number[]) => { let i = 0; return () => ns[Math.min(i++, ns.length - 1)]; };

describe("sliding and merging", () => {
  test("a line slides toward the edge and merges equal neighbours once", () => {
    const line = (vs: number[]) => vs.map((v) => (v ? { id: ids++, v } : null));
    expect(values(slideLine(line([0, 2, 0, 2]), 1).out)).toEqual([4, 0, 0, 0]);
    expect(values(slideLine(line([2, 2, 2, 2]), 1).out)).toEqual([4, 4, 0, 0]);
    expect(values(slideLine(line([4, 4, 8, 0]), 1).out)).toEqual([8, 8, 0, 0]);
    expect(values(slideLine(line([2, 2, 4, 0]), 1).out)).toEqual([4, 4, 0, 0]);
    expect(values(slideLine(line([2, 0, 0, 0]), 1).out)).toEqual([2, 0, 0, 0]);
    const r = slideLine(line([2, 2, 4, 4]), 50);
    expect(values(r.out)).toEqual([4, 8, 0, 0]);
    expect(r.gained).toBe(12);
    expect(r.merged).toEqual([50, 51]);
    expect(r.seq).toBe(52);
  });
  test("moved is the survivors whose cell changed, merged tiles are new ids", () => {
    const a = { id: 1, v: 2 }, b = { id: 2, v: 4 }, c = { id: 3, v: 4 };
    const r = slideLine([null, a, b, c], 9);
    expect(values(r.out)).toEqual([2, 8, 0, 0]);
    expect(r.moved).toEqual([1]);
    expect(r.merged).toEqual([9]);
    expect(r.out[0]).toBe(a);
  });
  test("every direction, and a board that cannot change answers null", () => {
    const b = tiles([2, 0, 0, 2, 0, 4, 4, 0, 8, 0, 0, 0, 0, 0, 0, 8]);
    expect(values(slide(b, "left", 1)!.board)).toEqual([4, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0]);
    expect(values(slide(b, "right", 1)!.board)).toEqual([0, 0, 0, 4, 0, 0, 0, 8, 0, 0, 0, 8, 0, 0, 0, 8]);
    expect(values(slide(b, "up", 1)!.board)).toEqual([2, 4, 4, 2, 8, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(values(slide(b, "down", 1)!.board)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 2, 8, 4, 4, 8]);
    const stuck = tiles([2, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(slide(stuck, "left", 1)).toBeNull();
    expect(slide(stuck, "up", 1)).toBeNull();
    expect(slide(stuck, "down", 1)).not.toBeNull();
  });
  test("a merged tile does not merge again in the same move", () => {
    const st = state([4, 4, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const after = apply(st, "left", DEFAULTS, seq(0.99, 0));
    expect(values(after.board).slice(0, 4)).toEqual([8, 8, 0, 0]);
    expect(after.score).toBe(8);
  });
});

describe("spawning", () => {
  test("a 2 nine times in ten, a 4 otherwise, on a free cell picked by the first draw", () => {
    const b = tiles([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const two = spawn([...b], 7, seq(0, 0.5));
    expect(two).toEqual({ id: 7, v: 2 });
    expect(spawn([...b], 7, seq(0, 0.89))!.v).toBe(2);
    expect(spawn([...b], 7, seq(0, 0.9))!.v).toBe(4);
    expect(spawn([...b], 7, seq(0, 0.999))!.v).toBe(4);
    const last = [...b];
    spawn(last, 8, seq(0.999, 0));
    expect(last[15]).toEqual({ id: 8, v: 2 });
    expect(spawn(tiles(Array(16).fill(2)), 9, seq(0, 0))).toBeNull();
  });
  test("over many draws the split is about 90/10", () => {
    let fours = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) if (spawn(tiles([0]), 1, Math.random)!.v === 4) fours++;
    expect(fours / n).toBeGreaterThan(0.07);
    expect(fours / n).toBeLessThan(0.13);
  });
  test("a new game has two tiles, the best and the game count carried over", () => {
    const st = newGame(undefined, first);
    expect(st.board.filter(Boolean)).toHaveLength(2);
    expect(st.games).toBe(1);
    const again = newGame({ best: 500, games: 3, seq: 40 }, first);
    expect(again).toMatchObject({ best: 500, games: 4, score: 0, moves: 0, seq: 42 });
  });
});

describe("moves, undo and the end", () => {
  test("a move slides, scores, counts, spawns and keeps the best", () => {
    const st = state([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], { best: 3 });
    const after = apply(st, "left", DEFAULTS, seq(0, 0.5));
    expect(values(after.board)).toEqual([4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(after).toMatchObject({ score: 4, best: 4, moves: 1 });
    expect(after.last).toEqual({ dir: "left", moved: [], merged: [1000], spawned: [1001] });
    expect(after.prev).toEqual({ board: st.board, score: 0, moves: 0, won: false });
    expect(after.seq).toBe(1002);
  });
  test("each direction is one action; the view puts the vim key on it as a second shortcut", () => {
    const st = state([0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(values(apply(st, "left", DEFAULTS, seq(0.99, 0)).board)[0]).toBe(2);
    expect(values(apply(st, "down", DEFAULTS, seq(0, 0)).board)[15]).toBe(2);
    expect(apply(st, "right", DEFAULTS, seq(0, 0))).toBe(st);
    expect(apply(st, "up", DEFAULTS, seq(0, 0))).toBe(st);
    expect(apply(st, "h" as never, DEFAULTS, seq(0, 0))).toBe(st);
    expect(render(st, DEFAULTS).actions.map((a) => [a.id, a.shortcut])).toEqual([["new", "n"], ["up", ["up", "k"]], ["down", ["down", "j"]], ["left", ["left", "h"]], ["right", ["right", "l"]]]);
  });
  test("a move that changes nothing is a no-op: no spawn, no count, the same state", () => {
    const st = state([2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(apply(st, "left")).toBe(st);
    expect(apply(st, "up")).toBe(st);
  });
  test("undo takes one move back, once, and only with the setting", () => {
    const st = state([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const moved = apply(st, "left", DEFAULTS, first);
    expect(actions(moved)).toContain("undo");
    const back = apply(moved, "undo");
    expect(back.board).toEqual(st.board);
    expect(back).toMatchObject({ score: 0, moves: 0, prev: undefined, last: undefined });
    expect(actions(back)).not.toContain("undo");
    expect(apply(back, "undo")).toBe(back);
    const off = { undo: false };
    const noUndo = apply(st, "left", off, first);
    expect(noUndo.prev).toBeUndefined();
    expect(actions(noUndo, off)).not.toContain("undo");
    expect(apply(noUndo, "undo", off)).toBe(noUndo);
  });
  test("2048 wins once, Keep going plays on, undo before continuing takes the win back", () => {
    const st = state([1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const won = apply(st, "left", DEFAULTS, seq(0.99, 0));
    expect(won.won).toBe(true);
    expect(phase(won)).toBe("won");
    expect(actions(won)).toEqual(["continue", "new", "undo"]);
    expect(apply(won, "right")).toBe(won);
    const kept = apply(won, "continue");
    expect(phase(kept)).toBe("play");
    expect(kept.kept).toBe(true);
    const more = apply(kept, "left", DEFAULTS, seq(0.99, 0));
    expect(phase(more)).toBe("play");
    const back = apply(won, "undo");
    expect(phase(back)).toBe("play");
    expect(back.won).toBe(false);
  });
  test("game over when no move can change the board; undo is the way out", () => {
    const full = [2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 8];
    expect(canMove(tiles(full))).toBe(false);
    expect(canMove(tiles([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 4]))).toBe(true);
    expect(canMove(tiles([...full.slice(0, 15), 0]))).toBe(true);
    // Right shifts the last row into the corner; the spawned 4 on the freed cell locks the board.
    const st = state([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 2, 4, 2, 0]);
    expect(phase(st)).toBe("play");
    const over = apply(st, "right", DEFAULTS, seq(0.99, 0.95));
    expect(phase(over)).toBe("over");
    expect(actions(over)).toEqual(["new", "undo"]);
    expect(apply(over, "up")).toBe(over);
    const fresh = apply(over, "new", DEFAULTS, first);
    expect(phase(fresh)).toBe("play");
    expect(fresh).toMatchObject({ score: 0, moves: 0, games: 2, best: over.best });
  });
  test("the legal moves per phase are what the view offers, Enter first", () => {
    const st = state([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(actions(st)).toEqual(["new", "up", "down", "left", "right"]);
  });
  test("a stored state round-trips through JSON and a foreign one is refused", () => {
    const st = apply(state([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "left", DEFAULTS, first);
    const back = JSON.parse(JSON.stringify(st));
    expect(isState(back)).toBe(true);
    expect(apply(back, "undo").board).toEqual(st.prev!.board);
    expect(isState({ board: [], score: 0 })).toBe(false);
    expect(isState(null)).toBe(false);
    expect(isState({ ...st, board: st.board.slice(0, 15) })).toBe(false);
  });
});

const find = (n: ViewNode, pred: (n: ViewNode) => boolean, out: ViewNode[] = []): ViewNode[] => {
  if (pred(n)) out.push(n);
  if (n.type === "stack") n.children.forEach((c) => find(c, pred, out));
  return out;
};
type TileNode = Extract<ViewNode, { type: "tile" }>;
type Stack = Extract<ViewNode, { type: "stack" }>;

describe("render", () => {
  test("sixteen keyed cells on a sunken well, each holding an outline or the tile keyed by id with move; a merge pops, the spawn pops a beat later", () => {
    const st = apply(state([2, 2, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "left", DEFAULTS, seq(0.99, 0));
    const v = checkView(render(st, DEFAULTS));
    expect(v.keys).toBe("actions");
    expect(v.title).toBe("Score 4");
    const board = find(v.tree, (n) => n.key === "board")[0] as Stack;
    expect(board).toMatchObject({ surface: "sunken", radius: true, padding: 2 });
    const cells = find(v.tree, (n) => n.type === "stack" && !!n.key?.startsWith("cell")) as Stack[];
    expect(cells).toHaveLength(SIZE * SIZE);
    expect(cells.map((c) => c.key)).toEqual(Array.from({ length: 16 }, (_, i) => `cell${i}`));
    const tiles = cells.map((c) => c.children[0] as TileNode);
    expect(tiles[0]).toEqual({ type: "tile", key: "t1000", width: TILE, height: TILE, text: "4", color: "neutral", fill: "soft", transition: { move: true, exit: "none", enter: "pop", delay: 1 } });
    expect(tiles[1]).toMatchObject({ key: `t${st.board[1]!.id}`, text: "4", transition: { move: true, exit: "none" } });
    expect(tiles[1].transition!.enter).toBeUndefined();
    expect(tiles[2]).toEqual({ type: "tile", key: "empty", width: TILE, height: TILE, color: "neutral", fill: "outline", transition: { exit: "none" } });
    expect(tiles[15]).toMatchObject({ key: "t1001", text: "2", color: "neutral", fill: "solid", transition: { move: true, exit: "none", enter: "pop", delay: 2 } });
    expect(find(v.tree, (n) => n.type === "image")).toHaveLength(0);
    expect(v.actions[0]).toMatchObject({ id: "new", shortcut: "n", confirm: expect.any(String) });
    expect(v.actions.map((a) => a.shortcut)).toEqual(["n", ["up", "k"], ["down", "j"], ["left", "h"], ["right", "l"], "u"]);
    expect(find(v.tree, (n) => n.type === "keycap").map((n) => (n as { keys: string }).keys)).toEqual(["up", "down", "left", "right", "n", "u"]);
  });
  test("the ramp only climbs: paper, the neutral tint, then solid hues warm to cool, grey, the accent at 2048 and past it; a tile's key survives a slide so it moves", () => {
    expect([2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096].map((v) => `${lookOf(v).color}/${lookOf(v).fill}`)).toEqual(["neutral/solid", "neutral/soft", "amber/solid", "red/solid", "pink/solid", "violet/solid", "blue/solid", "teal/solid", "green/solid", "grey/solid", "accent/solid", "accent/solid"]);
    // Nothing alternates: past 4 every tile is solid.
    expect([8, 16, 32, 64, 128, 256, 512, 1024, 2048].every((v) => lookOf(v).fill === "solid")).toBe(true);
    const st = state([0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const id = st.board[3]!.id;
    const before = find(render(st, DEFAULTS).tree, (n) => n.key === `t${id}`);
    const after = find(render(apply(st, "down", DEFAULTS, seq(0, 0)), DEFAULTS).tree, (n) => n.key === `t${id}`);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ transition: { move: true } });
  });
  test("the won banner offers Enter to keep going; game over shows the score with New game on Enter, no confirm", () => {
    const won = apply(state([1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), "left", DEFAULTS, seq(0.99, 0));
    const v = checkView(render(won, DEFAULTS));
    expect(v.title).toBe("2048!");
    expect(v.actions.map((a) => [a.id, a.shortcut])).toEqual([["continue", "enter"], ["new", "n"], ["undo", "u"]]);
    expect(find(v.tree, (n) => n.type === "text" && n.value === "You made 2048")).toHaveLength(1);
    const over = state([2, 4, 2, 4, 4, 2, 4, 2, 2, 4, 2, 4, 4, 2, 4, 8], { score: 1234 });
    const o = checkView(render(over, DEFAULTS));
    expect(o.title).toBe("Game over");
    expect(o.actions[0]).toEqual({ id: "new", title: "New game", shortcut: "n" });
    expect(find(o.tree, (n) => n.type === "text" && n.value === "Game over at 1,234")).toHaveLength(1);
  });
  test("a fresh board is titled New game and its New game asks nothing", () => {
    const v = render(newGame(undefined, first), DEFAULTS);
    expect(v.title).toBe("New game");
    expect(v.actions[0].confirm).toBeUndefined();
  });
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => { stored.clear(); host = await Host.bundled(); });
  afterAll(() => host.kill());

  test("a view palette is input on the wire with view: view", async () => {
    const l = host.loaded().find((l) => l.extension === "2048")!;
    expect(l.palettes).toEqual([{ name: "2048", title: "2048", live: false, input: true, icon: tile("amber", { svg: "M2 2h5.5v5.5H2zM8.5 2H14v5.5H8.5zM2 8.5h5.5V14H2zM8.5 8.5H14V14H8.5z" }), view: "view", ttl: undefined, detail: undefined, columns: undefined, placeholder: undefined, showDetail: undefined, filters: undefined }]);
  });
  test("view answers the opening tree and stores the fresh game", async () => {
    await expect(host.request("list", { extension: "2048", palette: "2048" })).rejects.toThrow("view palette has no list");
    const v = await host.request<View>("view", { extension: "2048", palette: "2048" });
    expect(v.title).toBe("New game");
    expect(find(v.tree, (n) => n.type === "tile")).toHaveLength(16);
    const st = stored.get("2048\0state") as State;
    expect(isState(st)).toBe(true);
    expect(st.board.filter(Boolean)).toHaveLength(2);
  });
  test("a pick answers the next tree and persists the state; undo follows the setting", async () => {
    // Rig a board so the move is certain to change it.
    const rigged = state([2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    stored.set("2048\0state", rigged);
    const r = await host.pick("2048", "2048", "view", "left");
    const v = r.view as View;
    expect(v.title).toBe("Score 4");
    const st = stored.get("2048\0state") as State;
    expect(st.moves).toBe(1);
    expect(st.board[0]!.v).toBe(4);
    expect(v.actions.some((a) => a.id === "undo")).toBe(true);
    const same = await host.pick("2048", "2048", "view", "hologram");
    expect((same.view as View).title).toBe("Score 4");
    expect((stored.get("2048\0state") as State).moves).toBe(1);
    host.changeSettings("2048", { settings: { undo: false } });
    const noUndo = await host.pick("2048", "2048", "view", "undo");
    expect((noUndo.view as View).actions.some((a) => a.id === "undo")).toBe(false);
    expect((stored.get("2048\0state") as State).moves).toBe(1);
    host.changeSettings("2048", { settings: { undo: true } });
    const back = await host.pick("2048", "2048", "view", "undo");
    expect((back.view as View).title).toBe("New game");
    expect((stored.get("2048\0state") as State).moves).toBe(0);
  });
});
