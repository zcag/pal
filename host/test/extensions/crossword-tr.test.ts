// Crossword's Turkish sources: the Turkish letters in game.ts (upper case
// the Turkish way, folded comparison, a matching plain letter shown as the answer's own, the solved grid's own
// letters), a grid from placed answers (turkish.ts `fromEntries`), each
// paper's format (HaberTürk's day page, Cumhuriyet's JSON with its photo,
// Sabah's slider and player), and the extension over the wire against a
// stand-in for the three sites (crossword-tr-fixtures.ts, puzzles made for
// the tests): the source list, the default source, Next within a source
// passing a day with no puzzle, the calendars, the stats per source.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check, fold, gridOf, letterOf, newPlay, proper, same, select, status, type, WRONG, type Play } from "../../../extensions/crossword/game.ts";
import type { MonthView, Opened, SolvedReply, SourcesView, StatsView } from "../../../extensions/crossword/index.ts";
import { cumhuriyetPuzzle, fromEntries, istanbulDay, parseHaberturk, parseSabahMonth, parseSabahPlayer } from "../../../extensions/crossword/turkish.ts";
import type { Data } from "../../../extensions/crossword/store.ts";
import { CUM_SMALL, HT_8, SABAH_SMALL, fakePapers, htPage } from "./crossword-tr-fixtures.ts";
import { Host } from "../harness.ts";

const htEntries = (list = HT_8) => list.map((e) => ({ x: e.startx, y: e.starty, across: e.orientation === "across", answer: e.answer, clue: e.clue }));
const ht = fromEntries(htEntries(), { id: "ht-x", title: "Kare Bulmaca", author: "", lang: "tr" });
const g = gridOf(ht);

describe("Turkish letters", () => {
  test("upper case the Turkish way: i is İ, ı is I", () => {
    expect(letterOf(ht, "i")).toBe("İ");
    expect(letterOf(ht, "ı")).toBe("I");
    expect(letterOf(ht, "ş")).toBe("Ş");
    expect(letterOf({ ...ht, lang: undefined }, "i")).toBe("I");
  });
  test("a letter matches with its diacritics folded, on a Turkish puzzle only", () => {
    expect(fold("ÇĞİÖŞÜ")).toBe("CGIOSU");
    expect(same(ht, "S", "Ş")).toBe(true);
    expect(same(ht, "I", "İ")).toBe(true);
    expect(same(ht, "S", "Z")).toBe(false);
    expect(same({ ...ht, lang: undefined }, "S", "Ş")).toBe(false);
  });
  test("plain letters solve it, checks agree, and the solved grid shows the answers' own letters", () => {
    // TEMA across: T typed as T, İ of İTİ below typed as a plain I.
    let st: Play = newPlay(g);
    const plain = ht.solution.map((c) => fold(c));
    st = { ...st, fill: plain };
    expect(status(g, st)).toBe("solved");
    expect(check(g, st, "puzzle").mark.some((m) => m & WRONG)).toBe(false);
    expect(proper(g, st).fill.join("")).toBe(ht.solution.join(""));
  });
  test("a plain letter that matches shows the answer's own; a wrong one stays as typed", () => {
    const at = ht.solution.findIndex((c) => /[ÇĞİÖŞÜ]/.test(c));
    const want = ht.solution[at];
    const st = type(g, select(g, newPlay(g), at), fold(want).toLowerCase());
    expect(st.fill[at]).toBe(want);
    const wrong = fold(want) === "Z" ? "y" : "z";
    expect(type(g, select(g, newPlay(g), at), wrong).fill[at]).toBe(wrong.toUpperCase());
    // i where a dotless I goes shows I, and where İ goes İ.
    const plain = { ...ht, solution: ht.solution.map((c, i) => (i === at ? "I" : c)) };
    expect(type(gridOf(plain), select(gridOf(plain), newPlay(gridOf(plain)), at), "i").fill[at]).toBe("I");
  });
});

describe("a grid from placed answers", () => {
  test("HaberTürk's 8 by 8: the blocks where no answer runs, renumbered, each clue on its word", () => {
    expect([ht.w, ht.h]).toEqual([8, 8]);
    expect(ht.solution.slice(0, 8).map((c) => c || "#").join("")).toBe("TEMA###A");
    expect(g.words).toHaveLength(HT_8.length);
    expect(ht.clues.across[1]).toBe("Bir eserin ana düşüncesi");
    // KONU starts on row 4, column 8: the grid's own number there.
    const konu = g.words.find((w) => w.dir === "down" && w.cells[0] === 3 * 8 + 7)!;
    expect(konu.clue).toBe("Üzerinde konuşulan şey, mevzu");
  });
  test("a crossing may differ by its diacritics (the across letter wins); beyond that, or an answer that is not a word, is refused", () => {
    const sabah = fromEntries([{ x: 1, y: 1, across: true, answer: "açı", clue: "a" }, { x: 2, y: 1, across: false, answer: "can", clue: "b" }], { id: "s", title: "", author: "", lang: "tr" });
    expect(sabah.solution[1]).toBe("Ç");
    expect(() => fromEntries([{ x: 1, y: 1, across: true, answer: "abc", clue: "" }, { x: 2, y: 1, across: false, answer: "xy", clue: "" }], { id: "s", title: "", author: "" })).toThrow("cross wrong");
    expect(() => fromEntries([{ x: 1, y: 1, across: true, answer: "abc", clue: "" }, { x: 2, y: 1, across: true, answer: "bc", clue: "" }], { id: "s", title: "", author: "" })).toThrow("not a word");
  });
});

describe("the papers' formats", () => {
  test("HaberTürk: the entries in the day page; a day without one says so", () => {
    expect(parseHaberturk(htPage(7000, HT_8))).toHaveLength(HT_8.length);
    expect(() => parseHaberturk("<html><title>Sayfa Bulunamadı</title></html>")).toThrow("No puzzle this day");
  });
  test("Cumhuriyet: the rows padded with blocks, the clues by number, the photo 0-based, only as a data URL", () => {
    const p = cumhuriyetPuzzle({ ...CUM_SMALL, date: "2026-09-25" }, "2026-09-25");
    expect(p).toMatchObject({ id: "cum-2026-09-25", w: 4, h: 3, lang: "tr", url: "https://www.cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/25-09-2026" });
    expect(p.solution.slice(0, 4)).toEqual(["K", "A", "Ş", ""]);
    expect(p.clues.down[2]).toBe("Fotoğraftaki hayvan");
    expect(p.media).toEqual([{ src: CUM_SMALL.media[0].src, row: 0, col: 3, rows: 3, cols: 1 }]);
    expect(cumhuriyetPuzzle({ ...CUM_SMALL, media: [{ type: "image", src: "https://elsewhere/x.jpg", row: 1, col: 4, rows: 3, cols: 1 }] }, "2026-09-25").media).toBeUndefined();
    // The numbering is the one gridOf gives: each clue lands on a word.
    expect(gridOf(p).words.map((w) => w.clue)).not.toContain("");
  });
  test("Sabah: a month's articles, the first puzzle of each day, only the month asked; the player's base64 JSON", () => {
    const html = `<a href="/bulmaca-coz/kare/2025/04/28/28-nisan-2025-gunluk-kare-bulmaca-2">` + `<a href="/bulmaca-coz/kare/2025/04/28/28-nisan-2025-gunluk-kare-bulmaca-1">` + `<a href="/bulmaca-coz/kare/2024/04/03/3-nisan-2024-gunluk-kare-bulmaca-1">`;
    expect(parseSabahMonth(html, 2025, 4)).toEqual([{ date: "2025-04-28", slug: "2025/04/28/28-nisan-2025-gunluk-kare-bulmaca-1" }]);
    const b64 = Buffer.from(JSON.stringify(SABAH_SMALL)).toString("base64");
    expect(parseSabahPlayer(`_PUZZLE_DATA = '${b64}';`)).toEqual(SABAH_SMALL);
    expect(() => parseSabahPlayer("<html></html>")).toThrow("no puzzle");
  });
  test("the papers' day is Istanbul's", () => {
    expect(istanbulDay(Date.parse("2026-09-25T21:30:00Z"))).toBe("2026-09-26");
    expect(istanbulDay(Date.parse("2026-09-25T20:30:00Z"))).toBe("2026-09-25");
  });
});

describe("the extension", () => {
  let host: Host;
  let dir: string;
  let site: ReturnType<typeof fakePapers>;
  const keep = ["PAL_NOW", "PAL_CROSSWORD_DIR", "PAL_CROSSWORD_HT_URL", "PAL_CROSSWORD_CUM_URL", "PAL_CROSSWORD_SABAH_URL"].map((k) => [k, process.env[k]] as const);
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pal-crossword-tr-"));
    site = fakePapers("2026-09-26");
    Object.assign(process.env, site.env, { PAL_NOW: "2026-09-26T09:00:00Z", PAL_CROSSWORD_DIR: dir });
    host = await Host.bundled({ settings: { crossword: { settings: { source: "haberturk" } } } });
  });
  afterAll(async () => {
    await host?.close();
    for (const [k, v] of keep) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    site.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const send = <T>(msg: unknown) => host.surfaceSend("crossword", "crossword", msg) as Promise<T>;
  const saved = () => JSON.parse(readFileSync(join(dir, "progress.json"), "utf8")) as Data;
  const done = (p: Opened["puzzle"]) => ({ fill: p.solution.map((s) => s || "#").join(""), mark: "0".repeat(p.w * p.h), at: 0, dir: "a", ms: 90_000, done: { ms: 90_000, at: 1 } });

  test("the sources in order, the default one from the setting, the archive marked", async () => {
    const s = await send<SourcesView>({ op: "sources" });
    expect(s.source).toBe("haberturk");
    expect(s.sources.map((x) => [x.id, x.archive])).toEqual([["crosshare", false], ["haberturk", false], ["cumhuriyet", false], ["sabah", true]]);
  });

  test("the first open is today's puzzle of the default source, credited and linked", async () => {
    const o = await send<Opened>({ op: "open" });
    expect(o).toMatchObject({ today: true, credit: "HaberTürk" });
    expect(o.puzzle).toMatchObject({ id: "ht-2026-09-26", source: "haberturk", lang: "tr", w: 8, h: 8, date: "2026-09-26", url: "https://www.haberturk.com/bulmaca/gunluk/2026/09/26" });
  });

  test("Next stays with the source: the day before, then past a day with no puzzle", async () => {
    const n1 = await send<Opened>({ op: "next", from: "ht-2026-09-26" });
    expect(n1.puzzle.id).toBe("ht-2026-09-25");
    await send({ op: "save", id: "ht-2026-09-25", play: { ...done(n1.puzzle), done: undefined, fill: `T${".".repeat(63)}` } });
    // Today's is next while it is unplayed; once it is started, the days before have no puzzle on the stand-in: Next tries a few, then says so.
    expect((await send<Opened>({ op: "next", from: "ht-2026-09-25" })).puzzle.id).toBe("ht-2026-09-26");
    await send({ op: "save", id: "ht-2026-09-26", play: { ...done(n1.puzzle), done: undefined, fill: `T${".".repeat(63)}` } });
    expect(await send({ op: "next", from: "ht-2026-09-25" })).toEqual({ none: true } as never);
  });

  test("Cumhuriyet: its month from its list, a puzzle with its photo", async () => {
    const m = await send<MonthView>({ op: "month", source: "cumhuriyet" });
    expect(m).toMatchObject({ source: "cumhuriyet", year: 2026, month: 9, first: "2026-02" });
    expect(m.days.map((d) => d.id)).toEqual(["cum-2026-09-25", "cum-2026-09-24"]);
    const o = await send<Opened>({ op: "open", id: "cum-2026-09-25" });
    expect(o.credit).toBe("Cumhuriyet");
    expect(o.puzzle.media).toHaveLength(1);
  });

  test("Sabah: an archive, opened at its last month; a day's first puzzle; its crossings fold", async () => {
    const m = await send<MonthView>({ op: "month", source: "sabah" });
    expect(m).toMatchObject({ year: 2025, month: 4, first: "2024-07", last: "2025-04" });
    expect(m.days.map((d) => [d.id, d.slug])).toEqual([["sabah-2025-04-28", "2025/04/28/28-gunluk-kare-bulmaca-1"], ["sabah-2025-04-27", "2025/04/27/27-gunluk-kare-bulmaca-1"]]);
    expect((await send<MonthView>({ op: "month", source: "sabah", year: 2026, month: 9 })).days).toEqual([]);
    const o = await send<Opened>({ op: "open", id: "sabah-2025-04-28", date: "2025-04-28" });
    expect(o.puzzle).toMatchObject({ source: "sabah", w: 3, h: 3, url: "https://www.sabah.com.tr/bulmaca-coz/kare/2025/04/28/28-gunluk-kare-bulmaca-1" });
    expect(o.puzzle.solution.slice(0, 3)).toEqual(["A", "Ç", "I"]);
    // Opened again: from the cache, no request.
    const hits = site.hits.length;
    await send<Opened>({ op: "open", id: "sabah-2025-04-28" });
    expect(site.hits.length).toBe(hits);
  });

  test("the stats are per source: a HaberTürk solve counts there, on Istanbul's day, and not in Crosshare's", async () => {
    const o = await send<Opened>({ op: "open", id: "ht-2026-09-26" });
    const r = await send<SolvedReply>({ op: "solved", id: "ht-2026-09-26", play: done(o.puzzle) });
    expect(r).toMatchObject({ best: true, first: true, stats: { solved: 1, streak: 1, today: true } });
    expect(saved().solves.at(-1)).toMatchObject({ id: "ht-2026-09-26", source: "haberturk", size: "8×8" });
    expect((await send<StatsView>({ op: "stats", source: "haberturk" })).solved).toBe(1);
    expect((await send<StatsView>({ op: "stats", source: "crosshare" })).solved).toBe(0);
  });

  test("today's not up yet: the first open is the latest that is; a day with none says so by name", async () => {
    // The host holds the record in memory: closed first, so the file edit is the one it reads.
    await host.close();
    process.env.PAL_NOW = "2026-09-27T09:00:00Z";
    const data = saved();
    data.last = undefined;
    await Bun.write(join(dir, "progress.json"), JSON.stringify(data));
    host = await Host.bundled({ settings: { crossword: { settings: { source: "haberturk" } } } });
    // The 27th has none on the stand-in: the 26th, solved above, opens with its result.
    const o = await send<Opened>({ op: "open" });
    expect(o.puzzle.id).toBe("ht-2026-09-26");
    expect(o.today).toBe(false);
    expect(o.saved?.done).toBeTruthy();
    const none = await send<{ error: string; source: string }>({ op: "open", date: "2026-09-20", source: "haberturk" });
    expect(none).toMatchObject({ error: "No puzzle this day", source: "HaberTürk" });
  });

  test("offline, a puzzle opened before still plays", async () => {
    site.down = true;
    try {
      expect((await send<Opened>({ op: "open", id: "cum-2026-09-25" })).puzzle.id).toBe("cum-2026-09-25");
      expect((await send<{ error: string }>({ op: "open", id: "cum-2026-09-24" })).error).toContain("503");
    } finally { site.down = false; }
  });
});
