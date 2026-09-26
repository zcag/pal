// Crossword: the rules (game.ts: numbering, the NYT's keys, check, reveal,
// clear, the finish, the saved form), ipuz (ipuz.ts), the stats and the
// streak (stats.ts), Crosshare's pages (crosshare.ts), and the extension
// over the wire against a stand-in crosshare.org with hand-made minis
// (crossword-fixtures.ts): today's mini, resuming, Next, the lists, the
// record, offline, the Now row. The clock is pinned (PAL_NOW); solves go
// to a temp dir (PAL_CROSSWORD_DIR). The page (surface/) is browser code
// and is not run here.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseMonth, parseTag } from "../../../extensions/crossword/crosshare.ts";
import {
  REVEALED, RIGHT, WRONG, arrow, backspace, check, clear, click, crossing, current, decode, del, encode, gridOf, isBlock, newPlay, nextWord, progressOf, reveal,
  select, selectWord, status, toggle, type, type Play,
} from "../../../extensions/crossword/game.ts";
import { fromIpuz } from "../../../extensions/crossword/ipuz.ts";
import type { Entry, MonthView, NewestView, Offline, Opened, SolvedReply, StatsView } from "../../../extensions/crossword/index.ts";
import { isBest, streaks, summary, type Solve } from "../../../extensions/crossword/stats.ts";
import type { Data } from "../../../extensions/crossword/store.ts";
import { CART, DUMP, TALL, fakeCrosshare, ipuz, monthPage, tagPage } from "./crossword-fixtures.ts";
import { Host } from "../harness.ts";

//  # T A L L       1 across TALL, 5 BELIE, 6 OPINE, 7 SEVER, 8 SEED
//  B E L I E       1 down TEPEE, 2 ALIVE, 3 LINED, 4 LEER, 5 BOSS
//  O P I N E
//  S E V E R
//  S E E D #
const g = gridOf(fromIpuz(TALL, "tall"));
const word = (n: number, dir: "across" | "down") => g.words.findIndex((w) => w.n === n && w.dir === dir);
const typeAll = (st: Play, s: string) => [...s].reduce((x, ch) => type(g, x, ch), st);
const letters = (st: Play) => st.fill.map((f, i) => (isBlock(g.p, i) ? "#" : f || ".")).join("");

describe("the grid", () => {
  test("numbered the standard way, the clues hung on their words, across then down", () => {
    expect(g.numbers.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(g.words.map((w) => `${w.n}${w.dir[0]}`)).toEqual(["1a", "5a", "6a", "7a", "8a", "1d", "2d", "3d", "4d", "5d"]);
    expect(g.words[word(1, "across")]).toMatchObject({ cells: [1, 2, 3, 4], clue: "Like a giraffe" });
    expect(g.words[word(4, "down")]).toMatchObject({ cells: [4, 9, 14, 19], clue: "Sly look" });
    expect(g.words[word(5, "down")].cells).toEqual([5, 10, 15, 20]);
  });
  test("a fresh solve starts on 1 across; the word and its crossing", () => {
    const st = newPlay(g);
    expect(st).toMatchObject({ at: 1, dir: "across", ms: 0 });
    expect(current(g, st)?.n).toBe(1);
    expect(crossing(g, st)).toMatchObject({ n: 1, dir: "down" });
  });
  test("a bar ends a word as a block does", () => {
    const barred = gridOf({ ...fromIpuz(CART, "c"), bars: { right: [1], below: [] } });
    expect(barred.words.filter((w) => w.dir === "across").map((w) => w.cells)).toEqual([[0, 1], [2, 3], [4, 5, 6, 7], [8, 9, 10, 11], [12, 13, 14, 15]]);
  });
});

describe("the keys", () => {
  test("typing fills and moves on; a finished word jumps to the next clue", () => {
    let st = typeAll(newPlay(g), "tal");
    expect(st.at).toBe(4);
    st = type(g, st, "l");
    expect(letters(st).slice(0, 5)).toBe("#TALL");
    expect(st).toMatchObject({ at: 5, dir: "across" });
  });
  test("filled squares in the word are skipped, and a word typed to its end wraps back to its first gap", () => {
    // 5 across is squares 5 to 9.
    let st = type(g, select(g, newPlay(g), 7), "l");
    expect(st.at).toBe(8);
    st = type(g, select(g, st, 5), "b");
    // B landed on 5; 6 is the next gap.
    expect(st.at).toBe(6);
    st = type(g, st, "e");
    // 7 is filled: skipped, on to 8.
    expect(st.at).toBe(8);
    st = type(g, select(g, st, 9), "e");
    // Nothing after 9: back to the word's first gap.
    expect(st.at).toBe(8);
  });
  test("typing over a full word goes square by square", () => {
    const st = typeAll(newPlay(g), "tall");
    const over = type(g, select(g, st, 1), "x");
    expect(over.at).toBe(2);
    expect(over.fill[1]).toBe("X");
  });
  test("Backspace clears the square; on an empty one it steps back and clears; from a word's start into the previous clue", () => {
    let st = typeAll(newPlay(g), "ta");
    st = backspace(g, st); // at 3, empty: back to 2 and clear it
    expect(st).toMatchObject({ at: 2 });
    expect(st.fill[2]).toBe("");
    st = backspace(g, st); // 2 now empty: back to 1, clear the T
    expect(st.at).toBe(1);
    expect(st.fill[1]).toBe("");
    const b = typeAll(newPlay(g), "tall"); // at 5 across start
    const back = backspace(g, b);
    expect(back).toMatchObject({ at: 4, dir: "across" });
    expect(back.fill[4]).toBe("");
    const filled = type(g, select(g, newPlay(g), 5), "b");
    expect(backspace(g, select(g, filled, 5)).fill[5]).toBe("");
    expect(del(g, select(g, filled, 5)).at).toBe(5);
  });
  test("an arrow along the word moves (over blocks); across it, it turns first", () => {
    const st = newPlay(g);
    expect(arrow(g, st, "right").at).toBe(2);
    const turned = arrow(g, st, "down");
    expect(turned).toMatchObject({ at: 1, dir: "down" });
    expect(arrow(g, turned, "down").at).toBe(6);
    // Left from 1 across's first square: the block at 0 is the edge of the row.
    expect(arrow(g, st, "left")).toBe(st);
    // Down column 4 from 19: the block at 24 ends it.
    const col = select(g, st, 19, "down");
    expect(arrow(g, col, "down")).toBe(col);
  });
  test("Space and a click on the square turn; a click elsewhere moves; a square with one word takes that word's direction", () => {
    const st = newPlay(g);
    expect(toggle(g, st).dir).toBe("down");
    expect(click(g, st, 1).dir).toBe("down");
    expect(click(g, st, 7)).toMatchObject({ at: 7, dir: "across" });
    // Square 24 is a block: nothing.
    expect(click(g, st, 24)).toBe(st);
  });
  test("Tab walks the clues in order, skipping full ones while any has a gap; Shift-Tab goes back", () => {
    let st = typeAll(newPlay(g), "tallbelie"); // 1 and 5 across full, at 6 across
    expect(current(g, st)?.n).toBe(6);
    st = nextWord(g, st);
    expect(current(g, st)).toMatchObject({ n: 7, dir: "across" });
    st = nextWord(g, nextWord(g, st));
    // 8 across, then 1 down (TEPEE: T and E filled, the P at 11 is its first gap)
    expect(current(g, st)).toMatchObject({ n: 1, dir: "down" });
    expect(st.at).toBe(11);
    expect(current(g, nextWord(g, newPlay(g), -1))).toMatchObject({ n: 5, dir: "down" });
    expect(current(g, selectWord(g, st, word(3, "down")))).toMatchObject({ n: 3 });
  });
});

describe("check, reveal, clear, the finish", () => {
  const solved = (): Play => typeAll(newPlay(g), "tallbelieopineseverseed");
  test("the whole grid typed is solved; one wrong square is 'not quite'", () => {
    expect(status(g, solved())).toBe("solved");
    const wrong = typeAll(newPlay(g), "tallbelieopixeseverseed");
    expect(status(g, wrong)).toBe("wrong");
    expect(status(g, newPlay(g))).toBe("open");
  });
  test("check marks wrong letters and locks right ones; typing over a wrong one clears its mark", () => {
    const st = typeAll(newPlay(g), "tallbelieopixe");
    const checked = check(g, st, "puzzle");
    expect(checked.mark[13] & WRONG).toBeTruthy();
    expect(checked.mark[1] & RIGHT).toBeTruthy();
    expect(checked.mark[15]).toBe(0); // empty: untouched
    expect(checked.checked).toBe(true);
    // A locked square only moves the cursor on.
    const locked = type(g, select(g, checked, 1), "z");
    expect(locked.fill[1]).toBe("T");
    expect(locked.at).toBe(2);
    const fixed = type(g, select(g, checked, 13), "n");
    expect(fixed.mark[13]).toBe(0);
    expect(check(g, select(g, st, 13), "square").mark.filter(Boolean)).toHaveLength(1);
  });
  test("reveal fills the scope and marks it; it counts as help; clear leaves locked squares", () => {
    const st = reveal(g, newPlay(g), "word");
    expect(letters(st).slice(0, 5)).toBe("#TALL");
    expect(st.mark[1]).toBe(REVEALED);
    expect(st.helped).toBe(true);
    const typed = typeAll(st, "be");
    expect(letters(clear(g, typed, "puzzle")).slice(0, 7)).toBe("#TALL..");
    const all = reveal(g, newPlay(g), "puzzle");
    expect(status(g, all)).toBe("solved");
  });
  test("autocheck marks a wrong letter as it lands", () => {
    const st = type(g, newPlay(g), "x", true);
    expect(st.mark[1] & WRONG).toBeTruthy();
    expect(type(g, newPlay(g), "t", true).mark[1]).toBe(0);
    expect(st.checked).toBe(true);
  });
  test("a finished solve takes no more letters", () => {
    const done = { ...solved(), done: { ms: 1000, at: 1 } };
    expect(type(g, done, "x")).toBe(done);
    expect(backspace(g, done)).toBe(done);
    expect(check(g, done, "puzzle")).toBe(done);
  });
  test("saved compactly and read back whole; a save that does not fit the grid starts fresh", () => {
    const st = { ...check(g, typeAll(newPlay(g), "tallbelieopixe"), "puzzle"), ms: 4321, dir: "down" as const };
    const saved = encode(st, g.p);
    expect(saved.fill).toBe("#TALLBELIEOPIXE.........#");
    expect(saved.mark).toHaveLength(25);
    const back = decode(JSON.parse(JSON.stringify(saved)), g);
    expect(back).toMatchObject({ fill: st.fill, mark: st.mark, ms: 4321, checked: true, dir: "down" });
    expect(decode({ fill: "short" }, g)).toEqual(newPlay(g));
    expect(progressOf(saved)).toEqual({ filled: 14, total: 23, done: false });
  });
});

describe("ipuz", () => {
  test("Crosshare's file: the grid, the clues, the credit; its own line stripped from the note", () => {
    const p = fromIpuz(TALL, "tall");
    expect(p).toMatchObject({ id: "tall", title: "Standing Tall", author: "Pat Quill", w: 5, h: 5, note: "A mini about things that grow up.", copyright: "Copyright Pat Quill, all rights reserved" });
    expect(p.solution.slice(0, 5)).toEqual(["", "T", "A", "L", "L"]);
    expect(fromIpuz(DUMP, "d").note).toBeUndefined();
  });
  test("the spec's other shapes: [n, clue] and 'n clue', { value } cells, null (omitted) squares, circles, bars, markup", () => {
    const p = fromIpuz({
      kind: ["http://ipuz.org/crossword#1"], title: "<i>Odd</i> &amp; Ends", author: "A", dimensions: { width: 3, height: 2 }, block: "#",
      puzzle: [[{ cell: 1, style: { shapebg: "circle" } }, 2, { cell: 3, style: { barred: "B" } }], [null, 4, 0]],
      solution: [[{ value: "a" }, "B", "C"], [null, "D", "E"]],
      clues: { "Across:Across": [[1, "First <b>row</b>"], "4 Second row"], Down: [{ number: 2, clue: "Middle" }] },
    }, "x");
    expect(p.title).toBe("Odd & Ends");
    expect(p.solution).toEqual(["A", "B", "C", "", "D", "E"]);
    expect(p.circles).toEqual([0]);
    expect(p.bars).toEqual({ right: [], below: [2] });
    expect(p.clues).toEqual({ across: { 1: "First row", 4: "Second row" }, down: { 2: "Middle" } });
  });
  test("what it cannot play is refused", () => {
    expect(() => fromIpuz({ kind: ["http://ipuz.org/sudoku#1"] }, "x")).toThrow("not a crossword");
    expect(() => fromIpuz({ dimensions: { width: 2, height: 1 }, solution: [["A", 0]] }, "x")).toThrow("gap");
  });
});

describe("stats", () => {
  const DAY = 86_400_000, T = Date.parse("2026-09-25T10:00:00Z");
  const s = (date: string | undefined, at: number, ms: number, extra: Partial<Solve> = {}): Solve => ({ id: `${date}-${at}`, title: "t", author: "a", date, at, ms, ...extra });
  const on = (date: string, ms = 60_000, extra: Partial<Solve> = {}) => s(date, Date.parse(`${date}T12:00:00Z`), ms, extra);
  test("the streak counts dailies solved on their own (UTC) day, back from today or from yesterday while today's is open", () => {
    const solves = [on("2026-09-22"), on("2026-09-23"), on("2026-09-24")];
    expect(streaks(solves, T)).toEqual({ streak: 3, best: 3 });
    expect(streaks([...solves, on("2026-09-25")], T).streak).toBe(4);
    // A day missed breaks it; the best keeps the longer run.
    expect(streaks([on("2026-09-10"), on("2026-09-11"), on("2026-09-12"), on("2026-09-24")], T)).toEqual({ streak: 1, best: 3 });
    // Solved later, revealed, or not a daily: no day.
    expect(streaks([s("2026-09-24", T, 1), on("2026-09-23", 1, { helped: true }), s(undefined, T - DAY, 1)], T).streak).toBe(0);
  });
  test("best and average leave out solves with a reveal and replays; a new best is only the fastest clean first solve", () => {
    const a = on("2026-09-24", 90_000), b = on("2026-09-23", 60_000), c = on("2026-09-22", 30_000, { helped: true }), d = s(undefined, T, 20_000, { replay: true });
    const sum = summary([a, b, c, d], T);
    expect(sum).toMatchObject({ solved: 3, clean: 2, best: 60_000, average: 75_000, streak: 2, today: false });
    expect(sum.times.map((x) => x.ms)).toEqual([60_000, 90_000]);
    expect(isBest([a, b], b)).toBe(true);
    expect(isBest([a, b], a)).toBe(false);
    expect(isBest([c], c)).toBe(false);
  });
});

describe("Crosshare's pages", () => {
  test("a month of daily minis: the site's 0-based month read 1-based, each day a date, newest first", () => {
    const m = parseMonth(monthPage(2026, 9, [{ day: 24, id: "b", title: "B", author: "Y", w: 4, h: 4 }, { day: 25, id: "a", title: "A", author: "X" }]));
    expect(m).toMatchObject({ year: 2026, month: 9 });
    expect(m.days).toEqual([{ id: "a", source: "crosshare", title: "A", author: "X", w: 5, h: 5, date: "2026-09-25", slug: "a" }, { id: "b", source: "crosshare", title: "B", author: "Y", w: 4, h: 4, date: "2026-09-24", slug: "b" }]);
  });
  test("a tag page and whether another follows", () => {
    expect(parseTag(tagPage([{ id: "q", title: "Quick One", author: "Z" }], 2))).toEqual({ items: [{ id: "q", source: "crosshare", title: "Quick One", author: "Z", w: 5, h: 5, slug: "quick-one" }], more: true });
    expect(parseTag(tagPage([], null)).more).toBe(false);
    expect(() => parseTag("<html></html>")).toThrow("no page data");
  });
});

describe("the extension", () => {
  let host: Host;
  let dir: string;
  let site: ReturnType<typeof fakeCrosshare>;
  const opened: string[] = [];
  const env = { PAL_NOW: process.env.PAL_NOW, PAL_CROSSWORD_DIR: process.env.PAL_CROSSWORD_DIR, PAL_CROSSWORD_URL: process.env.PAL_CROSSWORD_URL };
  const d = (day: number, id: string, title: string, w = 5) => ({ day, id, title, author: "Pat Quill", w, h: w });
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pal-crossword-"));
    site = fakeCrosshare({
      months: {
        "2026-09": [d(25, "tall", "Standing Tall"), d(24, "dump", "Kitchen Table"), d(23, "big", "Weekend", 9), d(22, "cart", "Square Deal", 4)],
        "2026-08": [d(31, "old", "Late Summer")],
      },
      tags: [[{ id: "fresh", title: "Fresh", author: "Z" }, { id: "cart", title: "Square Deal", author: "Pat Quill", w: 4, h: 4 }]],
      puzzles: { tall: TALL, dump: DUMP, cart: CART, old: ipuz("Late Summer", "Pat Quill", ["CART", "AREA", "REAL", "TALE"], {}, {}), fresh: { ...CART, title: "Fresh" } },
    });
    Object.assign(process.env, { PAL_NOW: "2026-09-25T10:00:00Z", PAL_CROSSWORD_DIR: dir, PAL_CROSSWORD_URL: site.url });
    host = await Host.bundled({ core: { "effects.run": (p: { effect: { open?: string } }) => { if (p.effect.open) opened.push(p.effect.open); return null; } } });
  });
  afterAll(async () => {
    await host?.close();
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    site.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const send = <T>(msg: unknown, args?: unknown) => host.surfaceSend("crossword", "crossword", msg, args) as Promise<T>;
  const saved = () => JSON.parse(readFileSync(join(dir, "progress.json"), "utf8")) as Data;
  const ipuzHits = () => site.hits.filter((h) => h.startsWith("/api/ipuz/")).length;
  const suggestions = async () => (await host.request<{ extension: string; items: { id: string; name: string; subtitle?: string }[] }[]>("suggest", {})).find((r) => r.extension === "crossword")?.items ?? [];

  test("the view is one surface with its actions", async () => {
    const v = await host.request<{ tree: unknown; actions: { id: string; shortcut?: unknown }[] }>("view", { extension: "crossword", palette: "crossword" });
    expect(v.tree).toEqual({ type: "surface", src: "surface/index.html" });
    expect(v.actions.slice(0, 4).map((a) => [a.id, a.shortcut])).toEqual([["next", "cmd+n"], ["browse", "cmd+o"], ["stats", "cmd+s"], ["check-word", "cmd+e"]]);
  });

  test("the first open is today's daily mini, fetched once and kept", async () => {
    const o = await send<Opened>({ op: "open" });
    expect(o.today).toBe(true);
    expect(o.puzzle).toMatchObject({ id: "tall", title: "Standing Tall", author: "Pat Quill", date: "2026-09-25", url: "https://crosshare.org/crosswords/tall/standing-tall" });
    expect(o.saved).toBeUndefined();
    const hits = ipuzHits();
    await send<Opened>({ op: "open", id: "tall" });
    expect(ipuzHits()).toBe(hits);
    expect(await suggestions()).toEqual([]); // nothing solved yet: no Now row
  });

  test("every save is on disk, and the next open resumes the half-done puzzle", async () => {
    const play = { fill: `#TA${".".repeat(21)}#`, mark: "0".repeat(25), at: 3, dir: "a", ms: 5000 };
    await send({ op: "save", id: "tall", play });
    expect(saved().progress.tall).toMatchObject({ fill: play.fill, ms: 5000 });
    // A save for a puzzle never opened is ignored.
    await send({ op: "save", id: "nope", play });
    expect(saved().progress.nope).toBeUndefined();
    const again = await send<Opened>({ op: "open" });
    expect(again.puzzle.id).toBe("tall");
    expect(again.saved).toMatchObject({ fill: play.fill, at: 3 });
  });

  test("Next skips the puzzle open and the played ones, and grids bigger than a mini: back through the dailies, then the newest minis", async () => {
    const n1 = await send<Opened>({ op: "next", from: "tall" });
    expect(n1.puzzle).toMatchObject({ id: "dump", date: "2026-09-24" });
    await send({ op: "save", id: "dump", play: { fill: `#D${".".repeat(22)}#`, mark: "0".repeat(25), at: 2, dir: "a", ms: 1 } });
    // 23 is a 9x9: skipped. 22 is next.
    const n2 = await send<Opened>({ op: "next", from: "dump" });
    expect(n2.puzzle.id).toBe("cart");
    await send({ op: "save", id: "cart", play: { fill: "C...............", mark: "0".repeat(16), at: 1, dir: "a", ms: 1 } });
    expect((await send<Opened>({ op: "next", from: "cart" })).puzzle.id).toBe("old");
    await send({ op: "save", id: "old", play: { fill: "C...............", mark: "0".repeat(16), at: 1, dir: "a", ms: 1 } });
    // The dailies run out within the months it walks: the newest minis.
    const n4 = await send<Opened>({ op: "next", from: "old" });
    expect(n4.puzzle.id).toBe("fresh");
    expect(n4.puzzle.date).toBeUndefined();
  });

  test("after a newest mini Next tries the newest first, then the dailies; a prefetched next opens without another request", async () => {
    await send({ op: "restart", id: "old" });
    await send({ op: "prefetch", from: "fresh" });
    const hits = site.hits.length;
    const n = await send<Opened>({ op: "next", from: "fresh" });
    expect(n.puzzle.id).toBe("old");
    expect(site.hits.length).toBe(hits);
  });

  test("a solve is recorded: the best, the streak, and today's Now row goes", async () => {
    // Yesterday's, solved yesterday (the log as a day ago would have left it), then today's.
    const r = await send<SolvedReply>({ op: "solved", id: "tall", play: { fill: "#TALLBELIEOPINESEVERSEED#", mark: "0".repeat(25), at: 23, dir: "a", ms: 61_000, done: { ms: 61_000, at: 1 } } });
    expect(r).toMatchObject({ best: true, first: true, stats: { solved: 1, best: 61_000, streak: 1, today: true } });
    expect(saved().solves).toHaveLength(1);
    expect(saved().solves[0]).toMatchObject({ id: "tall", date: "2026-09-25", ms: 61_000, size: "5×5" });
    const again = await send<SolvedReply>({ op: "solved", id: "tall", play: { fill: "#TALLBELIEOPINESEVERSEED#", mark: "0".repeat(25), at: 23, dir: "a", ms: 1_000, done: { ms: 1_000, at: 1 } } });
    expect(again).toMatchObject({ best: false, first: false, stats: { solved: 1, best: 61_000 } });
    expect(await suggestions()).toEqual([]); // today's is solved
    const st = await send<StatsView>({ op: "stats" });
    expect(st.history.map((h) => [h.id, h.replay ?? false])).toEqual([["tall", true], ["tall", false]]);
  });

  test("a month's calendar and the newest minis carry each puzzle's state", async () => {
    const m = await send<MonthView>({ op: "month", year: 2026, month: 9 });
    expect(m.today).toBe("2026-09-25");
    const state = (e: Entry) => [e.id, e.state, e.big ?? false];
    expect(m.days.map(state)).toEqual([["tall", "solved", false], ["dump", "started", false], ["big", "new", true], ["cart", "started", false]]);
    expect(m.days[1]).toMatchObject({ filled: 1, total: 23, ms: 1 });
    const n = await send<NewestView>({ op: "newest", page: 0 });
    expect(n).toMatchObject({ page: 0, more: false });
    expect(n.items.map((e) => e.id)).toEqual(["fresh", "cart"]);
    expect((await send<MonthView>({ op: "month", year: 2031, month: 1 })).days).toEqual([]);
  });

  test("In progress: every half-done puzzle and nothing else, the last played first", async () => {
    const p = await send<Entry[]>({ op: "progress" });
    expect(p.map((e) => e.id).sort()).toEqual(["cart", "dump"]);
    expect(p.every((e) => e.state === "started" && e.filled! > 0)).toBe(true);
    const touched = (id: string) => saved().progress[id].touched;
    expect(touched(p[0].id)).toBeGreaterThanOrEqual(touched(p[1].id));
  });

  test("the puzzle's page on crosshare.org", async () => {
    await send({ op: "site", id: "tall" });
    expect(opened).toEqual(["https://crosshare.org/crosswords/tall/standing-tall"]);
  });

  test("offline: a plain message and the puzzles opened before, which still play", async () => {
    site.down = true;
    try {
      const o = await send<Offline>({ op: "open", id: "never-fetched" });
      expect(o.error).toContain("503");
      expect(o.opened.map((e) => e.id)).toContain("tall");
      expect((await send<Opened>({ op: "open", id: "dump" })).puzzle.id).toBe("dump");
      const m = await send<MonthView>({ op: "month", year: 2025, month: 1 });
      expect(m.error).toContain("503");
    } finally { site.down = false; }
  });

  test("the Now row: today's mini while it is unsolved, once one has been solved; Enter opens it by date", async () => {
    // Today's solve taken out of the log: the row comes back.
    const data = saved();
    data.solves = data.solves.map((s) => ({ ...s, date: "2026-09-01" }));
    data.progress.tall = { ...data.progress.tall, fill: `#TA${".".repeat(21)}#`, done: undefined, touched: 1 };
    await Bun.write(join(dir, "progress.json"), JSON.stringify(data));
    await host.close();
    host = await Host.bundled();
    const rows = await suggestions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "today", name: "Today's mini crossword" });
    expect(rows[0].subtitle).toContain("In progress");
    expect(await host.pick("crossword", "crossword", "today")).toEqual({ push: { extension: "crossword", palette: "crossword", args: { date: "2026-09-25", source: "crosshare" } } });
    const byDate = await send<Opened>({ op: "open" }, { date: "2026-09-24" });
    expect(byDate.puzzle.id).toBe("dump");
  });
});
