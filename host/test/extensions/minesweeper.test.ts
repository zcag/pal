// Minesweeper: the rules (game.ts, pure) on laid boards, the clock, the
// tree (render.ts), and the extension over the wire: a view palette's
// meta, its opening tree, picks that answer trees and persist the state,
// the clock paused while the view is away and pushed while it is shown.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { DEFAULTS, LEVELS, apply, around, count, isChord, isState, layMines, minesLeft, newGame, pause, resume, settle, type Level, type State } from "../../../extensions/minesweeper/game.ts";
import { FLAG, INK, MINE, clockText, pitchOf, render, tileOf } from "../../../extensions/minesweeper/render.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";

/**
 * A board in play from a picture: `*` a mine, `.` closed, `o` open, `F` a
 * flag (on a mine or not: `f` is a flag on a safe cell), the cursor on the
 * cell at `cursor`.
 */
function board(rows: string[], extra: Partial<State> = {}): State {
  const h = rows.length, w = rows[0].length, cells = rows.join("");
  return {
    ...newGame("beginner"), w, h, mines: [...cells].filter((c) => c === "*" || c === "F").length,
    mine: [...cells].map((c) => c === "*" || c === "F"), open: [...cells].map((c) => c === "o"), flag: [...cells].map((c) => c === "F" || c === "f"),
    phase: "play", cursor: 0, clock: { ms: 0, since: 0 }, ...extra,
  };
}
const at = (st: State, r: number, c: number): State => ({ ...st, cursor: r * st.w + c });
const opened = (st: State) => st.open.flatMap((o, i) => (o ? [i] : []));

describe("laying the mines", () => {
  test("never on the first cell or around it, the count exact, whatever the draws", () => {
    for (const rng of [() => 0, () => 0.999999, Math.random]) {
      for (const safe of [0, 40, 80]) {
        const mine = layMines(9, 9, 10, safe, rng);
        expect(mine.filter(Boolean)).toHaveLength(10);
        expect([safe, ...around(safe, 9, 9)].some((i) => mine[i])).toBe(false);
      }
    }
    // Expert packs 99 mines in 480 cells and still spares the nine.
    const expert = layMines(30, 16, 99, 245, Math.random);
    expect(expert.filter(Boolean)).toHaveLength(99);
    expect([245, ...around(245, 30, 16)].some((i) => expert[i])).toBe(false);
    // A board too full to spare the neighbours spares the cell alone.
    const full = layMines(3, 3, 8, 4, Math.random);
    expect(full.filter(Boolean)).toHaveLength(8);
    expect(full[4]).toBe(false);
  });
  test("around counts the edges and corners right", () => {
    expect(around(0, 9, 9).sort((a, b) => a - b)).toEqual([1, 9, 10]);
    expect(around(40, 9, 9)).toHaveLength(8);
    expect(around(8, 9, 9).sort((a, b) => a - b)).toEqual([7, 16, 17]);
  });
  test("the first open is safe, opens an area, starts the clock and the game", () => {
    for (const level of Object.keys(LEVELS) as Level[]) {
      const st = newGame(level);
      expect(st).toMatchObject({ phase: "ready", ...LEVELS[level] && { w: LEVELS[level].w, h: LEVELS[level].h, mines: LEVELS[level].mines } });
      const first = apply(st, "open", { difficulty: level }, Math.random, 5000);
      expect(first.phase === "play" || first.phase === "won").toBe(true);
      expect(first.mine.filter(Boolean)).toHaveLength(LEVELS[level].mines);
      expect(first.mine[st.cursor]).toBe(false);
      expect(count(first, st.cursor)).toBe(0);
      expect(opened(first).length).toBeGreaterThan(1);
      expect(first.clock).toMatchObject({ ms: 0, since: 5000 });
    }
  });
});

describe("opening, flooding, chording", () => {
  test("an empty cell floods open to the numbers around the area; flags stop the flood", () => {
    const st = board([
      "....*",
      ".....",
      ".....",
      "*....",
    ]);
    const flood = apply(st, "open");
    // Everything opens but the two mines; a flood never opens a mine.
    expect(opened(flood)).toHaveLength(18);
    expect(flood.open[4] || flood.open[15]).toBe(false);
    expect(flood.phase).toBe("won");
    const flagged = apply(board(["....*", "f....", ".....", "*...."]), "open");
    expect(flagged.open[5]).toBe(false);
    expect(flagged.flag[5]).toBe(true);
    expect(flagged.last?.opened[0]).toBe(0);
  });
  test("a number opens alone; the last open records where the ripple starts", () => {
    const st = at(board(["*..", "...", "..*"]), 0, 1);
    const one = apply(st, "open");
    expect(opened(one)).toEqual([1]);
    expect(count(one, 1)).toBe(1);
    expect(one.last).toEqual({ at: 1, opened: [1] });
  });
  test("a chord opens around a number whose flags are placed, not before", () => {
    const st = at(board(["*o.", "...", "..."]), 0, 1);
    expect(isChord(st)).toBe(false);
    expect(apply(st, "open")).toBe(st);
    const flagged = apply(at(st, 0, 0), "flag");
    const ready = at(flagged, 0, 1);
    expect(isChord(ready)).toBe(true);
    const chord = apply(ready, "open");
    // The chord opens 2, 3, 4, 5; the flood through the empty ones opens the rest.
    expect(opened(chord)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(chord.phase).toBe("won");
  });
  test("a chord on a wrong flag sets off the mine it left", () => {
    const st = at(board(["*o.", "f..", "..."]), 0, 1);
    expect(isChord(st)).toBe(true);
    const boom = apply(st, "open");
    expect(boom.phase).toBe("lost");
    expect(boom.hit).toBe(0);
  });
  test("open on a flag and flag on an open cell are no-ops; a flag toggles and moves the counter", () => {
    const st = board(["*o.", "...", "..."]);
    const onOpen = at(st, 0, 1);
    expect(apply(onOpen, "flag")).toBe(onOpen);
    const f = apply(st, "flag");
    expect(f.flag[0]).toBe(true);
    expect(minesLeft(f)).toBe(0);
    expect(apply(f, "open")).toBe(f);
    expect(apply(f, "flag").flag[0]).toBe(false);
    const extra = apply(at(f, 2, 2), "flag");
    expect(minesLeft(extra)).toBe(-1);
  });
});

describe("winning, losing, the records", () => {
  test("a mine opened loses: the hit kept, the clock stopped, the game counted", () => {
    const st = board(["*..", "...", "..."], { clock: { ms: 2000, since: 10_000 } });
    const lost = apply(st, "open", DEFAULTS, Math.random, 13_500);
    expect(lost).toMatchObject({ phase: "lost", hit: 0, clock: { ms: 5500 } });
    expect(lost.clock.since).toBeUndefined();
    expect(lost.records.beginner).toEqual({ played: 1, won: 0 });
    expect(st.records.beginner).toEqual({ played: 0, won: 0 });
  });
  test("the last safe cell wins: the mines are flagged, the best time kept only when faster", () => {
    const st = at(board(["*o", "o."], { records: { ...newGame().records, beginner: { played: 3, won: 1, best: 9000 } }, clock: { ms: 0, since: 1000 } }), 1, 1);
    const won = apply(st, "open", DEFAULTS, Math.random, 8000);
    expect(won.phase).toBe("won");
    expect(won.flag).toEqual([true, false, false, false]);
    expect(won.records.beginner).toEqual({ played: 4, won: 2, best: 7000 });
    const slow = apply(st, "open", DEFAULTS, Math.random, 20_000);
    expect(slow.records.beginner.best).toBe(9000);
  });
  test("a finished game only starts over; new keeps the records, takes the setting, and the cursor on a same-sized board", () => {
    const lost = apply(board(["*..", "...", "..."]), "open");
    for (const a of ["open", "flag", "up", "left"] as const) expect(apply(lost, a)).toBe(lost);
    const again = apply(lost, "new", { difficulty: "expert" });
    expect(again).toMatchObject({ level: "expert", w: 30, h: 16, mines: 99, phase: "ready", game: lost.game + 1 });
    expect(again.records.beginner.played).toBe(1);
    const same = apply(at(newGame("beginner"), 2, 3), "new");
    expect(same.cursor).toBe(21);
  });
  test("the cursor moves one cell and stops at the edges", () => {
    const st = at(newGame("beginner"), 0, 0);
    expect(apply(st, "up")).toBe(st);
    expect(apply(st, "left")).toBe(st);
    expect(apply(st, "right").cursor).toBe(1);
    expect(apply(st, "down").cursor).toBe(9);
    const corner = at(st, 8, 8);
    expect(apply(corner, "down")).toBe(corner);
  });
});

describe("the clock", () => {
  test("pause folds the run in, resume starts one, settle cuts a stale run at the last move", () => {
    const st = board(["*..", "...", "..."], { clock: { ms: 1000, since: 5000, seen: 7000 } });
    const held = pause(st, 9000);
    expect(held.clock).toEqual({ ms: 5000, seen: 7000 });
    expect(pause(held, 20_000)).toBe(held);
    expect(resume(held, 30_000).clock).toEqual({ ms: 5000, seen: 7000, since: 30_000 });
    expect(settle(st).clock).toEqual({ ms: 3000, seen: 7000 });
    const ready = newGame();
    expect(resume(ready, 1)).toBe(ready);
  });
  test("a move in play with the clock paused (no resume came) starts a run and marks the move", () => {
    const st = board(["*..", "...", "..."], { clock: { ms: 4000 } });
    const f = apply(st, "flag", DEFAULTS, Math.random, 50_000);
    expect(f.clock).toEqual({ ms: 4000, since: 50_000, seen: 50_000 });
  });
});

describe("a stored state", () => {
  test("round-trips through JSON; a foreign one is refused", () => {
    const st = apply(newGame("intermediate"), "open", { difficulty: "intermediate" });
    expect(isState(JSON.parse(JSON.stringify(st)))).toBe(true);
    expect(isState({ ...st, open: st.open.slice(1) })).toBe(false);
    expect(isState({ ...st, level: "nightmare" })).toBe(false);
    expect(isState(null)).toBe(false);
    expect(JSON.stringify(newGame("expert")).length).toBeLessThan(10_000);
  });
});

const find = (n: ViewNode, pred: (n: ViewNode) => boolean, out: ViewNode[] = []): ViewNode[] => {
  if (pred(n)) out.push(n);
  if (n.type === "stack") n.children.forEach((c) => find(c, pred, out));
  return out;
};
type TileNode = Extract<ViewNode, { type: "tile" }>;
type Stack = Extract<ViewNode, { type: "stack" }>;
const tiles = (v: View) => (find(v.tree, (n) => n.type === "stack" && /^c\d+$/.test(n.key ?? "")) as Stack[]).map((c) => c.children[0] as TileNode);
const keycaps = (v: View) => find(v.tree, (n) => n.type === "keycap").map((n) => (n as { keys: string }).keys);

describe("render", () => {
  test("the cells fit the panel at every level: 30 px on beginner, 17 on intermediate and expert", () => {
    expect([pitchOf(LEVELS.beginner), pitchOf(LEVELS.intermediate), pitchOf(LEVELS.expert)]).toEqual([30, 17, 17]);
    expect([tileOf(30), tileOf(17)]).toEqual([27, 15]);
    // The expert well, 30 cells and its padding, inside the compact panel's 560 less the table's padding.
    expect(30 * pitchOf(LEVELS.expert) + 16 + 24).toBeLessThanOrEqual(560);
    const v = checkView(render(newGame("expert"), 0));
    expect(tiles(v)).toHaveLength(480);
  });
  test("a board in play: keyed cells on a sunken well, the cursor selected, the numbers in their colours, a flag and the closed paper", () => {
    const st = at(board(["*o.", "..f", "..."]), 1, 1);
    const v = checkView(render(st, 3000));
    expect(v.keys).toBe("actions");
    expect(v.title).toBe("0 mines left");
    expect(find(v.tree, (n) => n.key === "board")[0]).toMatchObject({ surface: "sunken", radius: true, padding: 2 });
    const t = tiles(v);
    expect(t).toHaveLength(9);
    expect(t[1]).toMatchObject({ key: `o1-${st.game}`, text: "1", color: INK[1], fill: "soft", width: 27 });
    expect(t[5]).toMatchObject({ key: `f5-${st.game}`, text: FLAG, color: "amber", fill: "solid" });
    expect(t[0]).toMatchObject({ key: `h0-${st.game}`, color: "neutral", fill: "solid" });
    expect(t.filter((x) => x.selected).map((x) => x.key)).toEqual([`h4-${st.game}`]);
    expect(Object.values(INK)).toEqual(["blue", "green", "red", "violet", "pink", "teal", "amber", "grey"]);
  });
  test("an open ripples out from the cell opened, one step per ring", () => {
    const st = apply(at(board(["....*", ".....", ".....", "....."]), 3, 0), "open");
    const t = tiles(render(st));
    expect(t[15].transition).toEqual({ exit: "none", enter: "pop", delay: 0 });
    expect(t[10].transition).toEqual({ exit: "none", enter: "pop", delay: 1 });
    expect(t[3].transition).toEqual({ exit: "none", enter: "pop", delay: 3 });
    // An arrow keeps the last open: the same tree for the cells, the cursor moved.
    const moved = apply(st, "up");
    expect(tiles(render(moved))[15].transition).toEqual(t[15].transition);
  });
  test("a lost board: the hit in red, the other mines ripple out from it, a wrong flag crossed out, no cursor", () => {
    const st = apply(board(["*...*", "f....", "....."]), "open");
    expect(st.phase).toBe("lost");
    const v = render(st);
    expect(v.title).toBe("Boom");
    const t = tiles(v);
    expect(t[0]).toMatchObject({ text: MINE, color: "red", fill: "solid", transition: { enter: "pop", exit: "none", delay: 0 } });
    expect(t[4]).toMatchObject({ text: MINE, color: "grey", transition: { enter: "pop", exit: "none", delay: 4 } });
    expect(t[5]).toMatchObject({ text: "✕", color: "amber", fill: "outline" });
    expect(t.some((x) => x.selected)).toBe(false);
    expect(v.actions.map((a) => [a.id, a.shortcut])).toEqual([["new", "n"]]);
    expect(keycaps(v)).toEqual(["enter"]);
  });
  test("a won board: the time in the title, a best-time badge, Enter for a new game", () => {
    const won = apply(at(board(["*o", "o."], { clock: { ms: 0, since: 0 } }), 1, 1), "open", DEFAULTS, Math.random, 83_000);
    const v = render(won, 99_000);
    expect(v.title).toBe("Cleared in 1:23");
    expect(find(v.tree, (n) => n.type === "badge").map((n) => (n as { text: string }).text)).toEqual(["best time"]);
    expect(v.actions[0].id).toBe("new");
  });
  test("the actions carry their keys, Enter first: arrows and hjkl, f / space for the flag; titles follow the cell", () => {
    const st = at(board(["*o.", "...", "..."]), 0, 0);
    const v = render(st);
    expect(v.actions.map((a) => [a.id, a.title, a.shortcut])).toEqual([
      ["open", "Open", "enter"],
      ["flag", "Flag", ["f", "/", "space"]],
      ["up", "Up", ["up", "k"]],
      ["down", "Down", ["down", "j"]],
      ["left", "Left", ["left", "h"]],
      ["right", "Right", ["right", "l"]],
      ["new", "New game", "n"],
    ]);
    expect(v.actions[6]).toMatchObject({ confirm: expect.any(String), style: "destructive" });
    const chord = render(at(apply(st, "flag"), 0, 1));
    expect(chord.actions.slice(0, 2).map((a) => a.title)).toEqual(["Open around", "Flag"]);
    expect(render(apply(st, "flag")).actions[1].title).toBe("Unflag");
    // The hint line: arrows, Enter, the flag's keys, n.
    expect(keycaps(v)).toEqual(["up", "down", "left", "right", "enter", "f", "/", "space", "n"]);
    // Before the first open New game does not ask.
    expect(render(newGame()).actions.at(-1)).toEqual({ id: "new", title: "New game", shortcut: "n" });
  });
  test("the header: the counter, the running clock, the best time", () => {
    const st = board(["*..", "...", "..."], { clock: { ms: 60_000, since: 1000 }, records: { ...newGame().records, beginner: { played: 2, won: 1, best: 75_000 } } });
    const texts = find(render(st, 8500).tree, (n) => n.type === "text").map((n) => (n as { value: string }).value);
    expect(texts).toEqual(expect.arrayContaining(["Beginner", "1", "1:07", "1:15", "1 of 2 won"]));
    expect(clockText(0)).toBe("0:00");
    expect(clockText(3_599_999)).toBe("59:59");
  });
});

describe("over the wire", () => {
  let host: Host;
  const tickWas = process.env.PAL_MINESWEEPER_TICK_MS;
  beforeAll(async () => { stored.clear(); process.env.PAL_MINESWEEPER_TICK_MS = "30"; host = await Host.bundled(); });
  afterAll(() => { host.kill(); if (tickWas === undefined) delete process.env.PAL_MINESWEEPER_TICK_MS; else process.env.PAL_MINESWEEPER_TICK_MS = tickWas; });
  const state = () => stored.get("minesweeper\0state") as State;

  test("a view palette is input on the wire with view: view", () => {
    const l = host.loaded().find((l) => l.extension === "minesweeper")!;
    expect(l.palettes).toEqual([{ name: "minesweeper", title: "Minesweeper", live: false, input: true, icon: tile("slate", "\u{f0691}"), view: "view", ttl: undefined, detail: undefined, columns: undefined, placeholder: undefined, showDetail: undefined, filters: undefined }]);
  });
  test("view answers a fresh board; picks answer trees and persist; an unknown action is a no-op", async () => {
    await expect(host.request("list", { extension: "minesweeper", palette: "minesweeper" })).rejects.toThrow("view palette has no list");
    const v = await host.request<View>("view", { extension: "minesweeper", palette: "minesweeper" });
    expect(v.title).toBe("Open any cell");
    expect(v.actions[0]).toMatchObject({ id: "open", shortcut: "enter" });
    const moved = await host.pick("minesweeper", "minesweeper", "view", "left");
    expect(tiles(moved.view as View).findIndex((t) => t.selected)).toBe(39);
    expect(state().cursor).toBe(39);
    const r = await host.pick("minesweeper", "minesweeper", "view", "open");
    expect(state().phase === "play" || state().phase === "won").toBe(true);
    expect(state().mine[39]).toBe(false);
    expect((r.view as View).title).toMatch(/mines? left|Cleared/);
    const same = await host.pick("minesweeper", "minesweeper", "view", "hologram");
    expect((same.view as View).title).toBe((r.view as View).title);
  });
  test("shown, the clock runs and the tree is pushed; hidden, it pauses", async () => {
    stored.set("minesweeper\0state", board(["*..", "...", "..."], { clock: { ms: 1000 } }));
    host.viewShown("minesweeper", { palette: "minesweeper" });
    const push = await host.nextViewUpdate("minesweeper", { palette: "minesweeper" });
    expect((push.spec as View).title).toBe("1 mine left");
    expect(state().clock.since).toBeNumber();
    host.viewHidden("minesweeper", { palette: "minesweeper" });
    await host.until(() => state().clock.since === undefined, 2000, "the clock paused");
    expect(state().clock.ms).toBeGreaterThanOrEqual(1000);
  });
  test("the difficulty setting applies to a board with nothing open yet", async () => {
    stored.set("minesweeper\0state", newGame("beginner"));
    host.changeSettings("minesweeper", { settings: { difficulty: "expert" } });
    const v = await host.request<View>("view", { extension: "minesweeper", palette: "minesweeper" });
    expect(tiles(v)).toHaveLength(480);
    expect(state().level).toBe("expert");
  });
});
