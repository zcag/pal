// Minesweeper: the rules (game.ts, pure) on laid boards, the clock, what
// the page (surface/main.ts) asks of them (a click's cell, the setting on
// a board, the ripple's rings, the title line), and the extension over the
// wire: a view palette whose body is its surface page, with the moves as
// actions for cmd+k.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { DEFAULTS, LEVELS, adopt, apply, around, clockText, count, isChord, isState, layMines, minesLeft, newGame, pause, pointAt, resume, rings, settle, status, type Level, type State } from "../../../extensions/minesweeper/game.ts";
import type { View } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";

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

describe("what the page asks of the rules", () => {
  test("a click puts the cursor on the cell; off the board, on the cursor or once over, the same state", () => {
    const st = at(board(["*o.", "...", "..."]), 0, 0);
    expect(pointAt(st, 5).cursor).toBe(5);
    for (const i of [0, -1, 9, 1.5]) expect(pointAt(st, i)).toBe(st);
    const lost = apply(st, "open");
    expect(pointAt(lost, 5)).toBe(lost);
    // A click on a satisfied number opens around it, as Enter does.
    const flagged = apply(st, "flag");
    expect(apply(pointAt(flagged, 1), "open").phase).toBe("won");
  });
  test("the setting on a board: a game in play plays out, a fresh or finished board takes it", () => {
    const fresh = newGame("beginner");
    expect(adopt(fresh, "beginner")).toBe(fresh);
    expect(adopt(fresh, "expert")).toMatchObject({ level: "expert", w: 30, h: 16, game: fresh.game + 1 });
    const playing = board(["*..", "...", "..."]);
    expect(adopt(playing, "expert")).toBe(playing);
    const lost = apply(playing, "open");
    expect(adopt(lost, "intermediate")).toMatchObject({ level: "intermediate", phase: "ready", records: lost.records });
  });
  test("rings: the ripple's distance, a diagonal one ring", () => {
    const b = { w: 9 };
    expect([rings(b, 40, 40), rings(b, 30, 40), rings(b, 50, 40), rings(b, 0, 40), rings(b, 8, 80)]).toEqual([0, 1, 1, 4, 8]);
  });
  test("the title line and the clock's text", () => {
    expect(status(newGame())).toBe("Open any cell");
    const st = board(["*..", "...", "*.."]);
    expect(status(st)).toBe("2 mines left");
    expect(status(apply(st, "flag"))).toBe("1 mine left");
    expect(status(apply(st, "open"))).toBe("Boom");
    const won = apply(at(board(["*o", "o."], { clock: { ms: 0, since: 0 } }), 1, 1), "open", DEFAULTS, Math.random, 83_000);
    expect(status(won)).toBe("Cleared in 1:23, a new best");
    const slower = apply(at(board(["*o", "o."], { clock: { ms: 0, since: 0 }, records: { ...newGame().records, beginner: { played: 1, won: 1, best: 60_000 } } }), 1, 1), "open", DEFAULTS, Math.random, 83_000);
    expect(status(slower)).toBe("Cleared in 1:23");
    expect(clockText(0)).toBe("0:00");
    expect(clockText(3_599_999)).toBe("59:59");
  });
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => { host = await Host.bundled(); });
  afterAll(() => host.kill());

  test("a view palette is input on the wire with view: view", () => {
    const l = host.loaded().find((l) => l.extension === "minesweeper")!;
    expect(l.palettes).toEqual([{ name: "minesweeper", title: "Minesweeper", live: false, input: true, icon: tile("slate", "\u{f0691}"), view: "view", ttl: undefined, detail: undefined, columns: undefined, placeholder: undefined, showDetail: undefined, filters: undefined }]);
  });
  test("view answers the surface page and the moves for cmd+k, Enter first", async () => {
    const v = await host.request<View>("view", { extension: "minesweeper", palette: "minesweeper" });
    expect(v.tree as unknown).toEqual({ type: "surface", src: "surface/index.html" });
    expect(v.title).toBe("Minesweeper");
    expect(v.actions.map((a) => [a.id, a.shortcut])).toEqual([["open", "enter"], ["flag", ["/", "f", "space"]], ["new", "n"], ["level", "d"]]);
  });
});
