// Flashcards: the typed-answer check (answer.ts), the pack formats
// (packs.ts), the scheduling and the queue on a clock of the test's own
// (srs.ts), the bundled packs' shape, and the extension over the wire: the
// page's calls from the first pick to the day's summary, undo, the
// refresher, Add Flashcard, the packs list and the root's suggestion. Progress goes to a temp dir (PAL_FLASHCARDS_DIR). The page
// (surface/) is browser code and is not run here.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answers, check, diff } from "../../../extensions/flashcards/answer.ts";
import { parsePack, parseTable, readFolder, type Pack } from "../../../extensions/flashcards/packs.ts";
import { roles } from "../../../extensions/flashcards/apkg.ts";
import { encode } from "../../../extensions/flashcards/pb.ts";
import { Database } from "bun:sqlite";
import { zipSync } from "../../../extensions/flashcards/node_modules/fflate/esm/index.mjs";
import { DAY, answer, dayStart, items, mastered, previews, progress, queue, recall, span, stats, weak, type Mem, type Settings } from "../../../extensions/flashcards/srs.ts";
import type { Data } from "../../../extensions/flashcards/store.ts";
import type { Screen } from "../../../extensions/flashcards/index.ts";
import { Host } from "../harness.ts";

describe("checking a typed answer", () => {
  test("case, punctuation, ¿¡ and a leading 'to' do not matter", () => {
    expect(check("¿Dónde está?", "¿dónde ESTÁ?").verdict).toBe("exact");
    expect(check("eat", "to eat").verdict).toBe("exact");
    expect(check("to eat", "to eat").verdict).toBe("exact");
  });
  test("any one of several answers is right; words in parentheses are optional", () => {
    expect(answers("of, from; about / over")).toEqual(["of", "from", "about", "over"]);
    expect(check("from", "of, from, about").verdict).toBe("exact");
    expect(check("to have", "to have (auxiliary), there is").verdict).toBe("exact");
  });
  test("an accent (or the ñ's tilde) left off is close, and says so; never exact", () => {
    expect(check("esta", "está")).toMatchObject({ verdict: "close", why: "accent" });
    expect(check("nino", "niño")).toMatchObject({ verdict: "close", why: "accent" });
    expect(check("ano", "año")).toMatchObject({ verdict: "close", why: "accent" });
  });
  test("a missing or wrong article on a noun is close", () => {
    expect(check("casa", "la casa")).toMatchObject({ verdict: "close", why: "article" });
    expect(check("el casa", "la casa")).toMatchObject({ verdict: "close", why: "article" });
  });
  test("one slip in a longer word is close; a short word must be right", () => {
    expect(check("trabajr", "trabajar")).toMatchObject({ verdict: "close", why: "typo" });
    expect(check("sé", "de").verdict).toBe("wrong");
    expect(check("perro", "gato").verdict).toBe("wrong");
    expect(check("", "gato").verdict).toBe("wrong");
  });
  test("the diff marks what matched, what was missed and what was extra", () => {
    expect(diff("esta", "de")).toEqual([{ text: "d", kind: "miss" }, { text: "e", kind: "ok" }, { text: "sta", kind: "extra" }]);
    expect(diff("gato", "gato")).toEqual([{ text: "gato", kind: "ok" }]);
    expect(diff("el nino", "el niño")).toEqual([{ text: "el ni", kind: "ok" }, { text: "ñ", kind: "accent" }, { text: "o", kind: "ok" }]);
  });
});

describe("pack files", () => {
  test("a TSV with a header names its columns; # lines and Anki's HTML go", () => {
    const cards = parseTable("#separator:tab\nback\tfront\tnote\ncat\tel <b>gato</b>\tnoun<br>m\n\ndog\tel perro\n");
    expect(cards).toEqual([
      { id: "el gato", front: "el gato", back: "cat", note: "noun m" },
      { id: "el perro", front: "el perro", back: "dog" },
    ]);
  });
  test("without a header the columns are front, back, note, example, example_back", () => {
    expect(parseTable("hola\thello\tgreeting\t¡Hola, Ana!\tHi, Ana!")[0]).toEqual({ id: "hola", front: "hola", back: "hello", note: "greeting", example: "¡Hola, Ana!", example_back: "Hi, Ana!" });
  });
  test("CSV: quoted fields with commas and doubled quotes; a row without a back is dropped", () => {
    expect(parseTable('"uno, dos",one and two\n"dice ""hola""",says hi\nsolo\n')).toEqual([
      { id: "uno, dos", front: "uno, dos", back: "one and two" },
      { id: 'dice "hola"', front: 'dice "hola"', back: "says hi" },
    ]);
  });
  test("a JSON pack keeps its metadata; the id is the file name", () => {
    const p = parsePack("My Verbs.json", JSON.stringify({ title: "Verbs", reverse: true, lang: { front: "es" }, cards: [{ front: "ir", back: "to go" }, { nope: 1 }] }));
    expect(p).toMatchObject({ id: "my-verbs", title: "Verbs", reverse: true, lang: { front: "es" } });
    expect(p.cards).toEqual([{ front: "ir", back: "to go", id: "ir" }]);
  });
});

// An .apkg made here: the collection as Anki writes it, old (col.models JSON, media JSON) or new
// (notetypes/fields/decks tables, the collection, the media index and the files zstd-compressed).
function apkg(dir: string, name: string, modern: boolean): string {
  const db = join(dir, `${name}.sqlite`);
  const d = new Database(db);
  d.run("create table notes (id integer, guid text, mid integer, flds text)");
  d.run("create table cards (id integer, nid integer, did integer)");
  const notes: [string, string][] = [["g-gato", "el gato\x1fthe cat\x1fEl gato duerme.\x1f[sound:gato.mp3]"], ["g-casa", "<b>la casa</b>\x1fthe <i>house</i>\x1f\x1f"], ["g-empty", "\x1f\x1f\x1f"]];
  notes.forEach(([g, f], i) => { d.run("insert into notes values (?, ?, 7, ?)", [i + 1, g, f.replaceAll("\\x1f", "\x1f")]); d.run("insert into cards values (?, ?, 3)", [i + 1, i + 1]); });
  const names = ["Spanish", "English", "Sentence", "Audio"];
  if (modern) {
    d.run("create table notetypes (id integer, name text)");
    d.run("create table fields (ntid integer, ord integer, name text)");
    d.run("create table decks (id integer, name text)");
    names.forEach((n, i) => d.run("insert into fields values (7, ?, ?)", [i, n]));
    d.run("insert into decks values (3, ?)", ["Spanish::Animals"]);
  } else {
    d.run("create table col (models text, decks text)");
    d.run("insert into col values (?, ?)", [JSON.stringify({ 7: { flds: names.map((n, ord) => ({ name: n, ord })) } }), JSON.stringify({ 3: { name: "Animals" } })]);
  }
  d.close();
  const col = new Uint8Array(readFileSync(db));
  const sound = new TextEncoder().encode("ID3 fake mp3");
  // The new media index: MediaEntries { entries (1): MediaEntry { name (1): "gato.mp3" } }.
  const entry = [0x0a, 8, ...new TextEncoder().encode("gato.mp3")];
  const index = new Uint8Array([0x0a, entry.length, ...entry]);
  const files: Record<string, Uint8Array> = modern
    ? { "collection.anki21b": new Uint8Array(Bun.zstdCompressSync(col)), media: new Uint8Array(Bun.zstdCompressSync(index)), "0": new Uint8Array(Bun.zstdCompressSync(sound)) }
    : { "collection.anki2": col, media: new TextEncoder().encode(JSON.stringify({ 0: "gato.mp3" })), "0": sound };
  const out = join(dir, `${name}.apkg`);
  writeFileSync(out, zipSync(files));
  rmSync(db);
  return out;
}

describe("Anki decks", () => {
  test("fields are matched by name, else the first two", () => {
    expect(roles(["Spanish", "English", "Sentence", "Sentence English", "Audio"])).toEqual({ front: 0, back: 1, example: 2, example_back: 3 });
    expect(roles(["Front", "Back"])).toEqual({ front: 0, back: 1 });
    expect(roles(["Kana", "Kanji", "Meaning"])).toMatchObject({ front: 1, back: 2 });
    expect(roles(["A", "B", "C"])).toEqual({ front: 0, back: 1 });
    // A sentence deck from AnkiWeb: its ids and counts are not sides.
    expect(roles(["EnglishSentenceID", "SpanishSentenceID", "EnglishSentence", "SpanishSentence", "ClozeWord", "Difficulty", "Text", "Audio", "NumberOfSpanishWords"])).toMatchObject({ front: 3, back: 2 });
    expect(roles(["EnglishSentenceID", "SpanishSentenceID", "EnglishSentence", "SpanishSentence"]).example).toBeUndefined();
  });
  for (const modern of [false, true]) test(`an ${modern ? "Anki 2.1.50+ (zstd)" : "older"} deck reads as a pack, its sound extracted`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "pal-apkg-"));
    try {
      apkg(dir, "animals", modern);
      const { packs, errors } = await readFolder(dir, join(dir, "media"));
      expect(errors).toEqual([]);
      expect(packs).toHaveLength(1);
      const p = packs[0];
      expect(p).toMatchObject({ id: "animals", title: modern ? "Spanish › Animals" : "Animals", lang: { front: "es", back: "en" } });
      expect(p.cards.map((c) => [c.id, c.front, c.back, c.example])).toEqual([["g-gato", "el gato", "the cat", "El gato duerme."], ["g-casa", "la casa", "the house", undefined]]);
      expect(readFileSync(p.cards[0].audio!, "utf8")).toBe("ID3 fake mp3");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("the bundled packs", () => {
  const words = JSON.parse(readFileSync(join(import.meta.dir, "../../../extensions/flashcards/packs/spanish-words.json"), "utf8")) as Pack & { cards: { weight: number }[] };
  const phrases = JSON.parse(readFileSync(join(import.meta.dir, "../../../extensions/flashcards/packs/spanish-phrases.json"), "utf8")) as Pack;
  test("6001 words, most common first, each with a short back; nouns carry their article; all but a few have an example", () => {
    expect(words.cards.length).toBe(6001);
    expect(new Set(words.cards.map((c) => c.id)).size).toBe(6001);
    expect(words.cards.every((c) => c.front && c.back && c.back.length <= 60)).toBe(true);
    expect(words.cards[0]).toMatchObject({ front: "ser", back: "to be" });
    expect(words.cards.find((c) => c.id === "ver")).toMatchObject({ back: "to see, to spot" });
    expect(words.cards.some((c) => /[()]|&#|Compare/.test(c.back))).toBe(false);
    expect(words.cards.find((c) => c.id === "casa")).toMatchObject({ front: "la casa", back: "house", note: "noun · feminine" });
    expect(words.cards.filter((c) => c.example).length).toBeGreaterThan(5990);
    // Weighted by how often each is heard: the first hundred cover far more than the last thousand.
    const sum = (a: { weight?: number }[]) => a.reduce((n, c) => n + (c.weight ?? 0), 0);
    expect(sum(words.cards.slice(0, 100))).toBeGreaterThan(sum(words.cards.slice(-1000)) * 5);
  });
  test("phrases: Spanish on the front, both directions", () => {
    expect(phrases.cards.length).toBeGreaterThan(90);
    expect(phrases).toMatchObject({ reverse: true, lang: { front: "es", back: "en" } });
  });
});

// ---- scheduling -------------------------------------------------------------

const T0 = new Date(2026, 8, 25, 12).getTime();
const S: Settings = { retention: 0.9, newPerDay: 3, goal: 5 };
const pack = (id: string, n: number, reverse = true): Pack => ({ id, title: id, reverse, cards: Array.from({ length: n }, (_, i) => ({ id: `w${i}`, front: `w${i}`, back: `b${i}` })) });
const data = (over: Partial<Data> = {}): Data => ({ v: 1, cards: {}, log: [], suspended: [], active: ["p"], ...over });
const review = (due: number, s = 5, lapses = 0, lr = due - s * DAY): Mem => ({ due, s, d: 5, st: 2, reps: 3, lapses, ls: 0, sd: s, lr });

describe("scheduling", () => {
  test("a new card's buttons: again in a minute, good in ten, easy in days", () => {
    const p = previews(undefined, T0);
    expect(p[1]).toBe("1m");
    expect(p[3]).toBe("10m");
    expect(p[4]).toMatch(/^\d+d$/);
  });
  test("good, good graduates it to review; recall falls with time", () => {
    let m = answer(undefined, 3, T0);
    expect(m.st).toBe(1);
    m = answer(m, 3, T0 + 10 * 60_000);
    expect(m.st).toBe(2);
    expect(m.due).toBeGreaterThan(T0 + DAY);
    expect(recall(m, m.lr!)).toBeCloseTo(1, 5);
    expect(recall(m, m.lr! + 30 * DAY)).toBeLessThan(recall(m, m.lr! + DAY));
  });
  test("mastered is a review card not due for three weeks", () => {
    expect(mastered(review(T0, 21))).toBe(true);
    expect(mastered(review(T0, 20))).toBe(false);
    expect(mastered(undefined)).toBe(false);
  });
  test("spans read as the buttons show them", () => {
    expect([span(30_000), span(10 * 60_000), span(5 * 3_600_000), span(3 * DAY), span(65 * DAY), span(800 * DAY)]).toEqual(["1m", "10m", "5h", "3d", "2mo", "2.2y"]);
  });
  test("the day runs to 4 am", () => {
    const late = new Date(2026, 8, 26, 2).getTime();
    expect(dayStart(late)).toBe(new Date(2026, 8, 25, 4).getTime());
  });
});

describe("the queue", () => {
  const its = items([pack("p", 10)]);
  test("new cards in pack order, up to the day's limit; a reverse card waits for its word", () => {
    const q = queue(its, data(), T0, S);
    expect(q.next?.key).toBe("p/w0");
    expect(q.counts).toEqual({ new: 3, learning: 0, review: 0 });
  });
  test("learning due now first, then reviews with a new card after every three", () => {
    const d = data({ cards: { "p/w5": review(T0 - DAY), "p/w6": review(T0 - 2 * DAY), "p/w7": { ...review(T0 - 60_000), st: 1 } } });
    expect(queue(its, d, T0, S).next?.key).toBe("p/w7");
    delete d.cards["p/w7"];
    expect(queue(its, d, T0, S).next?.key).toBe("p/w6");
    // Three answers today: the fourth card is a new one, a learned word's reverse card before a word never seen.
    d.log = [1, 2, 3].map((i) => [Math.round(T0 / 1000) - i, "p/w9", 3, 2, 1000]);
    expect(queue(its, d, T0, S).next?.key).toBe("p/w5<");
  });
  test("the day's new limit counts what was introduced today among these cards; Learn more raises it", () => {
    const d = data({ log: [0, 1, 2].map((i) => [Math.round(T0 / 1000) - i, `p/w${i}`, 3, 0, 1000]) });
    expect(queue(its, d, T0, S).counts.new).toBe(0);
    expect(queue(its, d, T0, S, 10).counts.new).toBe(10);
    // Another pack's new cards count against its own day, not this one's.
    expect(queue(items([pack("q", 5)]), d, T0, S).counts.new).toBe(3);
  });
  test("a graduated word's reverse card comes next day, not the day its sibling was answered", () => {
    const d = data({ cards: { "p/w0": review(T0 + 5 * DAY) } });
    expect(queue(its, d, T0, S).next?.key).toBe("p/w0<");
    d.log = [[Math.round(T0 / 1000) - 60, "p/w0", 3, 1, 1000]];
    expect(queue(its, d, T0, S).next?.key).toBe("p/w1");
  });
  test("a learning card due in the next 20 minutes is shown early rather than ending the session", () => {
    const d = data({ cards: Object.fromEntries([...Array(10).keys()].map((i) => [`p/w${i}`, review(T0 + 9 * DAY)])) });
    d.cards["p/w3"] = { ...review(T0 + 10 * 60_000), st: 1 };
    expect(queue(its, d, T0, { ...S, newPerDay: 0 }).next?.key).toBe("p/w3");
    d.cards["p/w3"].due = T0 + 30 * 60_000;
    expect(queue(its, d, T0, { ...S, newPerDay: 0 }).next).toBe(null);
  });
  test("suspended cards never come", () => {
    expect(queue(its, data({ suspended: ["p/w0"] }), T0, S).next?.key).toBe("p/w1");
  });
});

describe("weak cards, progress and stats", () => {
  test("the refresher takes cards forgotten this week, lapsed often or fading, weakest first", () => {
    const its = items([pack("p", 6, false)]);
    const d = data({
      cards: { "p/w0": review(T0 + DAY, 30), "p/w1": review(T0 + DAY, 30, 4), "p/w2": review(T0 - 20 * DAY, 2, 0, T0 - 22 * DAY), "p/w3": review(T0 + DAY, 30) },
      log: [[Math.round((T0 - 2 * DAY) / 1000), "p/w3", 1, 2, 1000]],
    });
    const w = weak(its, d, T0).map((i) => i.key);
    expect(w[0]).toBe("p/w2");
    expect(w.slice(1).sort()).toEqual(["p/w1", "p/w3"]);
  });
  test("coverage adds the weight of words in review", () => {
    const p: Pack = { id: "p", title: "p", cards: [{ id: "a", front: "a", back: "x", weight: 0.3 }, { id: "b", front: "b", back: "y", weight: 0.2 }] };
    const pr = progress(p, data({ cards: { "p/a": review(T0 + 30 * DAY, 30), "p/b": { ...review(T0), st: 1 } } }), T0);
    expect(pr).toMatchObject({ total: 2, seen: 2, mastered: 1, learning: 1, coverage: 0.3 });
  });
  test("the streak counts the days the goal was met, today's only once it is", () => {
    const at = (daysAgo: number, n: number) => Array.from({ length: n }, (_, i): Data["log"][number] => [Math.round((T0 - daysAgo * DAY) / 1000) + i, "p/w0", 3, 2, 1000]);
    const its = items([pack("p", 1, false)]);
    const d = data({ log: [...at(3, 5), ...at(2, 5), ...at(1, 5), ...at(0, 2)] });
    expect(stats(d, its, T0, 5)).toMatchObject({ streak: 3, todayAnswers: 2, goalMet: false });
    d.log.push(...at(0, 3).map((r): Data["log"][number] => [r[0] + 10, r[1], r[2], r[3], r[4]]));
    expect(stats(d, its, T0, 5)).toMatchObject({ streak: 4, goalMet: true });
    expect(stats(data({ log: at(2, 5) }), its, T0, 5).streak).toBe(0);
  });
});

// ---- over the wire ---------------------------------------------------------------

// AnkiWeb, as far as Browse Anki Decks asks it: a search, a deck's page, its download.
function fakeAnkiWeb(deckFile: string) {
  const row = encode([[1, 42], [2, "Spanish Animals"], [3, 90], [4, 10], [5, 1700000000], [6, 2], [7, 1], [8, 0]]);
  const sample = encode([[1, encode([[1, "Spanish"], [2, "el gato"]])], [1, encode([[1, "English"], [2, "the <b>cat</b>"]])]]);
  const deck = encode([[1, 2], [2, 1], [3, 0], [4, sample], [5, "key-1"]]);
  const item = encode([[1, encode([[5, "Spanish Animals"], [6, " spanish animals "], [7, 2048], [8, 1700000000], [9, "Two animals.<br>With audio."], [10, deck], [18, 90], [19, 10]])]]);
  return Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/svc/shared/list-decks") return new Response(u.searchParams.get("search") === "spanish" ? encode([[1, row]]) : new Uint8Array());
      if (u.pathname === "/svc/shared/item-info" && u.searchParams.get("sharedId") === "42") return new Response(item);
      if (u.pathname === "/svc/shared/download-deck/42" && u.searchParams.get("t") === "key-1") return new Response(Bun.file(deckFile));
      return new Response("no", { status: 404 });
    },
  });
}

describe("the extension", () => {
  let host: Host, dir: string, anki: ReturnType<typeof fakeAnkiWeb>;
  const prev = process.env.PAL_FLASHCARDS_DIR;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pal-flashcards-"));
    process.env.PAL_FLASHCARDS_DIR = dir;
    process.env.PAL_FLASHCARDS_FOLDER_TTL_MS = "1";
    anki = fakeAnkiWeb(apkg(dir, "served", true));
    process.env.PAL_ANKIWEB_URL = anki.url.origin;
    host = await Host.bundled({ settings: { flashcards: { settings: { new_per_day: 2, goal: 3, speak: "off" } } } });
  });
  afterAll(async () => {
    await host.close();
    if (prev === undefined) delete process.env.PAL_FLASHCARDS_DIR; else process.env.PAL_FLASHCARDS_DIR = prev;
    delete process.env.PAL_FLASHCARDS_FOLDER_TTL_MS;
    delete process.env.PAL_ANKIWEB_URL;
    anki.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });
  const send = (msg: unknown, args?: unknown) => host.surfaceSend("flashcards", "flashcards", msg, args) as Promise<Screen & { mastered?: string; undone?: string }>;
  const saved = () => JSON.parse(readFileSync(join(dir, "progress.json"), "utf8")) as Data;

  test("the study view is one surface with its actions", async () => {
    const v = await host.request<{ tree: { type: string; src: string }; actions: { id: string }[] }>("view", { extension: "flashcards", palette: "flashcards" });
    expect(v.tree).toEqual({ type: "surface", src: "surface/index.html" });
    expect(v.actions.map((a) => a.id)).toEqual(["speak", "undo", "stats", "edit", "weak", "more", "suspend", "mute", "browse", "folder"]);
  });

  test("Mute turns the tones off (speech is on Tab by default already)", async () => {
    expect(await send({ op: "mute" })).toEqual({ quiet: true } as never);
    expect(host.written.get("flashcards")).toMatchObject({ sounds: false });
  });

  test("nothing picked yet: the page asks what to learn; picking starts the first card", async () => {
    const w = await send({ op: "open" });
    expect(w.screen).toBe("welcome");
    if (w.screen !== "welcome") return;
    expect(w.packs.map((p) => p.id)).toEqual(["spanish-words", "spanish-phrases"]);
    const c = await send({ op: "start", packs: ["spanish-words"] });
    expect(c).toMatchObject({ screen: "card", mode: "study", progress: { done: 0, size: 10 }, left: 2, day: { answers: 0, goal: 3, streak: 0, total: 0 } });
    if (c.screen !== "card") return;
    expect(c.card).toMatchObject({ key: "spanish-words/ser", prompt: "ser", answer: "to be", kind: "new", reverse: false, type: false, lang: { prompt: "es", answer: "en" } });
    expect(c.card.intervals[3]).toBe("10m");
  });

  test("an answer is saved before the next card comes; undo puts it back and shows that card again", async () => {
    const c = await send({ op: "answer", key: "spanish-words/ser", rating: 3, ms: 2100 });
    expect(saved().cards["spanish-words/ser"].st).toBe(1);
    expect(saved().log).toHaveLength(1);
    expect(c.screen === "card" && c.card.key).toBe("spanish-words/estar");
    expect(c.screen === "card" && c.canUndo).toBe(true);
    const u = await send({ op: "undo" });
    expect(u.undone).toBe("spanish-words/ser");
    expect(u.screen === "card" && u.card.key).toBe("spanish-words/ser");
    expect(saved().cards["spanish-words/ser"]).toBeUndefined();
    expect(saved().log).toHaveLength(0);
  });

  test("the day's new cards done: the summary, then Learn more brings the next", async () => {
    await send({ op: "open" });
    await send({ op: "answer", key: "spanish-words/ser", rating: 4 });
    const d = await send({ op: "answer", key: "spanish-words/estar", rating: 4 });
    expect(d.screen).toBe("done");
    if (d.screen !== "done") return;
    expect(d).toMatchObject({ reason: "caught-up", session: { answers: 2, passed: 2, missed: [] } });
    expect(d.session.learned.map((w) => w.word)).toEqual(["ser", "estar"]);
    // The two commonest words: some 4.5% of what is heard, all of it gained this session.
    expect(d.coverage?.before).toBe(0);
    expect(d.coverage?.after).toBeGreaterThan(0.04);
    expect(d.moreNew).toBeGreaterThan(0);
    const more = await send({ op: "more" });
    expect(more.screen === "card" && more.card.key).toBe("spanish-words/haber");
  });

  test("the refresher drills what was missed without touching its schedule; an Again sends it back", async () => {
    await send({ op: "answer", key: "spanish-words/haber", rating: 1 });
    const before = saved().cards["spanish-words/haber"];
    let r = await send({ op: "open", mode: "weak" });
    expect(r).toMatchObject({ screen: "card", mode: "weak", title: "Refresher", progress: { done: 0, size: 1 } });
    expect(r.screen === "card" && r.card.key).toBe("spanish-words/haber");
    r = await send({ op: "answer", key: "spanish-words/haber", rating: 1, mode: "weak" } as never);
    expect(r.screen === "card" && r.card.key).toBe("spanish-words/haber");
    r = await send({ op: "answer", key: "spanish-words/haber", rating: 3, mode: "weak" } as never);
    expect(r).toMatchObject({ screen: "done", mode: "weak" });
    expect(saved().cards["spanish-words/haber"]).toEqual(before);
    expect(saved().log.slice(-2).map((l) => l[3])).toEqual([4, 4]);
  });

  test("a miss in a session is drilled from its summary", async () => {
    await send({ op: "open" });
    await send({ op: "more" });
    const next = await send({ op: "screen" });
    if (next.screen !== "card") throw new Error(`expected a card, got ${next.screen}`);
    const missed = next.card.key;
    await send({ op: "answer", key: missed, rating: 1 });
    const d = await send({ op: "drill" });
    expect(d).toMatchObject({ screen: "card", mode: "weak", progress: { done: 0, size: 1 } });
    expect(d.screen === "card" && d.card.key).toBe(missed);
  });

  test("a session is a block of answers; Keep going adds another", async () => {
    host.changeSettings("flashcards", { settings: { new_per_day: 2, goal: 3, speak: "off", session: 1 } });
    await host.until(() => true);
    await send({ op: "open" });
    await send({ op: "more" });
    const c = await send({ op: "screen" });
    if (c.screen !== "card") throw new Error(`expected a card, got ${c.screen}`);
    expect(c.progress).toEqual({ done: 0, size: 1 });
    const d = await send({ op: "answer", key: c.card.key, rating: 3 });
    expect(d).toMatchObject({ screen: "done", reason: "block" });
    // Undo from the summary takes the answer back and puts that card on screen again.
    const u = await send({ op: "undo" });
    expect(u).toMatchObject({ screen: "card", undone: c.card.key, progress: { done: 0, size: 1 } });
    expect(u.screen === "card" && u.card.key).toBe(c.card.key);
    await send({ op: "answer", key: c.card.key, rating: 3 });
    const k = await send({ op: "keep" });
    expect(k).toMatchObject({ screen: "card", progress: { done: 0, size: 1 } });
    host.changeSettings("flashcards", { settings: { new_per_day: 2, goal: 3, speak: "off" } });
  });

  test("your own meaning is kept for the word (both directions share it), and an empty one puts the pack's back", async () => {
    await send({ op: "edit", key: "spanish-words/ser<", back: "to exist" });
    expect(saved().edits).toEqual({ "spanish-words/ser": { back: "to exist" } });
    await send({ op: "edit", key: "spanish-words/ser", back: "  " });
    expect(saved().edits).toEqual({});
  });

  test("stats: the streak, the heatmap, the week ahead, each pack", async () => {
    const st = await send({ op: "stats" }) as unknown as import("../../../extensions/flashcards/index.ts").Stats;
    expect(st.heat).toHaveLength(112);
    expect(st.forecast).toHaveLength(7);
    expect(st.total).toBe(saved().log.length);
    expect(st.packs[0]).toMatchObject({ id: "spanish-words", total: 6001 });
  });

  test("the goal met shows on the day line", async () => {
    const r = await send({ op: "screen" });
    expect(r.screen !== "welcome" && r.day).toMatchObject({ goal: 3, goalMet: true });
  });

  test("Add Flashcard: front = back goes into My cards, which joins practice", async () => {
    expect((await host.list("flashcards", "flashcard-add", "gato"))[0].name).toBe("Type the back after an =");
    const rows = await host.list("flashcards", "flashcard-add", "el gato = the cat");
    expect(rows[0]).toMatchObject({ name: "el gato  →  the cat" });
    await host.pick("flashcards", "flashcard-add", rows[0].id, "add");
    await host.pick("flashcards", "flashcard-add", (await host.list("flashcards", "flashcard-add", "perro → dog"))[0].id, "add");
    expect(readFileSync(join(dir, "packs", "my-cards.tsv"), "utf8")).toBe("front\tback\nel gato\tthe cat\nperro\tdog\n");
    expect(saved().active).toEqual(["spanish-words", "my-cards"]);
  });

  test("the packs list: what is practised first, with progress; a pack file that does not parse is a hint", async () => {
    writeFileSync(join(dir, "packs", "broken.json"), "{ nope");
    const rows = await host.list("flashcards", "flashcard-packs");
    const words = rows.find((r) => r.id === "spanish-words")!;
    expect(words).toMatchObject({ section: "Practising", subtitle: "0 mastered · 5 learning · 5996 new" });
    expect(rows.find((r) => r.id === "spanish-phrases")).toMatchObject({ section: "More packs" });
    expect(rows.find((r) => r.id === "my-cards")).toMatchObject({ section: "Practising", name: "my-cards" });
    expect(rows.some((r) => r.name === "A pack file could not be read")).toBe(true);
    expect(await host.pick("flashcards", "flashcard-packs", "spanish-phrases")).toEqual({ push: { extension: "flashcards", palette: "flashcards", args: { pack: "spanish-phrases" } } });
    await host.pick("flashcards", "flashcard-packs", "spanish-phrases", "add");
    expect(saved().active).toContain("spanish-phrases");
    rmSync(join(dir, "packs", "broken.json"));
  });

  test("while cards are due, a row in the root's Now section opens the study", async () => {
    const rows = await host.request<{ extension: string; items: { id: string; name: string }[] }[]>("suggest", {});
    const mine = rows.find((r) => r.extension === "flashcards");
    // The cards learned above, each back within the 20 minutes a session looks ahead.
    expect(mine?.items[0]).toMatchObject({ id: "due", name: "3 flashcards due", subtitle: "Goal met today · 1-day streak" });
    expect(await host.pick("flashcards", "flashcards", "due")).toEqual({ push: { extension: "flashcards", palette: "flashcards" } });
  });

  test("Browse Anki Decks: a search on AnkiWeb, the deck's page beside it, Enter downloads it into practice", async () => {
    // Nothing typed: the language being learned (the practised packs are Spanish).
    const rows = await host.list("flashcards", "flashcard-anki", "");
    expect(rows[0]).toMatchObject({ id: "42", name: "Spanish Animals", subtitle: "2 cards · audio · updated 2023", section: "Spanish on AnkiWeb" });
    expect(rows[0].accessories).toEqual([{ text: "90% of 100 liked" }]);
    expect((await host.list("flashcards", "flashcard-anki", "klingon"))[0].name).toBe("No shared decks for “klingon”");
    const d = await host.detail("flashcards", "flashcard-anki", "42");
    expect(d.markdown).toContain("| el gato | the cat |");
    expect(d.metadata).toContainEqual({ label: "Audio", value: "1 recordings, played on Tab" });
    expect(await host.pick("flashcards", "flashcard-anki", "42", "open")).toEqual({ open: "https://ankiweb.net/shared/info/42" });
    expect(await host.pick("flashcards", "flashcard-anki", "42", "add")).toMatchObject({ toast: { title: "Downloading Spanish Animals" }, keep: true });
    await host.until(() => saved().active?.includes("anki-42") ?? false, 5000, "the deck in practice");
    const added = (await host.list("flashcards", "flashcard-anki", "spanish"))[0];
    expect(added.accessories?.[0]).toEqual({ tag: "Added", color: "green" });
    expect(await host.pick("flashcards", "flashcard-anki", "42", "study")).toEqual({ push: { extension: "flashcards", palette: "flashcards", args: { pack: "anki-42" } } });
    const r = await send({ op: "open" }, { pack: "anki-42" });
    expect(r.screen === "card" && r.card).toMatchObject({ prompt: "el gato", answer: "the cat", audio: true });
  });

  test("a study view of one pack studies only it", async () => {
    const r = await send({ op: "open" }, { pack: "spanish-phrases" });
    expect(r.screen === "card" && r.card.pack).toBe("spanish-phrases");
    expect(r.screen === "card" && r.title).toBe("Flashcards · Spanish: everyday phrases");
  });
});
