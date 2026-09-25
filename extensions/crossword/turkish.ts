// The Turkish papers' daily kare bulmaca: HaberTürk, Cumhuriyet and Sabah.
// Each is fetched when it is about to be played or listed and kept
// (cache.ts); nothing of theirs ships with pal. Their days are Istanbul's.
//
//   HaberTürk  /bulmaca/gunluk/YYYY/MM/DD, one a day since 25 November 2017
//              (later days are up before their day; a day is played only once
//              it has come). The page carries the puzzle as `var _data = [...]`:
//              each entry an answer with its clue, direction and 1-based start.
//              Always 8 by 8. No list: a day is known to exist by its date.
//   Cumhuriyet the game's own JSON (cumhuriyet.lidyagames.com): /api/list for
//              the archive (since February 2026, not every day), /api/puzzle/
//              YYYY-MM-DD for one: the solution rows ("#" a block), the clues
//              by number (numbered as gridOf numbers), and a photo laid over a
//              block of squares that clues point at ("Fotoğraftaki ..."), as a
//              data URL. 17 by 11.
//   Sabah      an archive that stopped (July 2024 to April 2025): a month's
//              articles from the slider (POST /bulmaca-coz/getsliderarticles;
//              the site reads only the month of the date it is sent), each
//              article's player page (an iframe on isbh.tmgrup.com.tr) with the
//              puzzle as base64 JSON, entries as HaberTürk's. 9 by 9. Its grids
//              cross Ç with C, Ü with U: letters compare folded (game.ts `same`).
//              A day with two puzzles lists the first.
import { cached, get, kept } from "./cache.ts";
import { gridOf, type Puzzle } from "./game.ts";
import type { Listed, Source } from "./sources.ts";

const pad = (n: number) => String(n).padStart(2, "0");
/** A moment's date in Istanbul (UTC+3 the year round since 2016). */
export const istanbulDay = (now: number) => new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
const up = (s: string) => s.toLocaleUpperCase("tr").replace(/[^\p{L}]/gu, "");
const clean = (s: unknown) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// ---- entries into a grid --------------------------------------------------------------

export type Entry = { x: number; y: number; across: boolean; answer: string; clue: string };

/**
 * A grid from answers placed by their 1-based start: the solution written in (an across
 * letter wins a crossing, which on a Turkish grid may differ from the down one only by its
 * diacritics), numbered by gridOf, each clue hung on the word that starts where its entry
 * does. An entry that is not a word of the grid, or a crossing that disagrees beyond the
 * diacritics, is refused: the answers must make the grid.
 */
export function fromEntries(entries: Entry[], base: Omit<Puzzle, "w" | "h" | "solution" | "clues">): Puzzle {
  const es = entries.map((e) => ({ ...e, answer: up(e.answer) })).filter((e) => e.answer.length);
  if (!es.length) throw new Error("an empty puzzle");
  const w = Math.max(...es.map((e) => e.x - 1 + (e.across ? e.answer.length : 1)));
  const h = Math.max(...es.map((e) => e.y - 1 + (e.across ? 1 : e.answer.length)));
  if (w > 30 || h > 30 || es.some((e) => e.x < 1 || e.y < 1)) throw new Error("a grid out of shape");
  const solution = Array<string>(w * h).fill("");
  const fold = (c: string) => c.replace(/[ÇĞİÖŞÜ]/g, (x) => ({ Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" })[x]!);
  for (const e of [...es.filter((x) => !x.across), ...es.filter((x) => x.across)]) {
    [...e.answer].forEach((ch, k) => {
      const i = (e.y - 1 + (e.across ? 0 : k)) * w + e.x - 1 + (e.across ? k : 0);
      if (solution[i] && fold(solution[i]) !== fold(ch)) throw new Error(`the answers cross wrong at ${e.answer}`);
      solution[i] = ch;
    });
  }
  const g = gridOf({ ...base, w, h, solution, clues: { across: {}, down: {} } });
  const clues: Puzzle["clues"] = { across: {}, down: {} };
  for (const e of es) {
    const at = (e.y - 1) * w + e.x - 1;
    const word = g.words[(e.across ? g.across : g.down)[at]];
    if (!word || word.cells[0] !== at || word.cells.length !== e.answer.length) throw new Error(`${e.answer} is not a word of the grid`);
    clues[e.across ? "across" : "down"][word.n] = clean(e.clue);
  }
  return { ...base, w, h, solution, clues };
}

// ---- HaberTürk ------------------------------------------------------------------------------

const HT = () => process.env.PAL_CROSSWORD_HT_URL || "https://www.haberturk.com";
const HT_FIRST = "2017-11-25";
const htPage = (date: string) => `${HT()}/bulmaca/gunluk/${date.replaceAll("-", "/")}`;
type HtEntry = { clue?: string; answer?: string; orientation?: string; startx?: number; starty?: number };

/** HaberTürk's day page: its puzzle's entries, or none on a day without one. */
export function parseHaberturk(html: string): HtEntry[] {
  const m = /var _data = (\[[\s\S]*?\]);/.exec(html);
  if (!m) throw new Error("No puzzle this day");
  return JSON.parse(m[1]) as HtEntry[];
}

const htPuzzle = (entries: HtEntry[], date: string): Puzzle => fromEntries(
  entries.map((e) => ({ x: Number(e.startx), y: Number(e.starty), across: e.orientation === "across", answer: String(e.answer ?? ""), clue: String(e.clue ?? "") })),
  { id: `ht-${date}`, title: "Kare Bulmaca", author: "", date, source: "haberturk", url: htPage(date).replace(HT(), "https://www.haberturk.com"), lang: "tr" },
);

export const haberturk: Source = {
  id: "haberturk",
  title: "HaberTürk",
  lang: "tr",
  day: istanbulDay,
  first: HT_FIRST.slice(0, 7),
  // One a day, known by its date: the month is listed without a request.
  month: async (y, m, now) => {
    const today = istanbulDay(now), out: Listed[] = [];
    for (let d = lastDay(y, m); d >= 1; d--) {
      const date = `${y}-${pad(m)}-${pad(d)}`;
      if (date <= today && date >= HT_FIRST) out.push({ id: `ht-${date}`, source: "haberturk", title: "Kare Bulmaca", author: "", w: 8, h: 8, date });
    }
    return out;
  },
  puzzle: async (id, meta) => {
    const date = id.slice(3);
    const { raw } = await kept(id, meta, async () => parseHaberturk(await get(htPage(date), "HaberTürk")), (r) => htPuzzle(r, date));
    return htPuzzle(raw, date);
  },
};

// ---- Cumhuriyet ------------------------------------------------------------------------------

const CUM = () => process.env.PAL_CROSSWORD_CUM_URL || "https://cumhuriyet.lidyagames.com/oyun/gunluk-kare-bulmaca";
type CumRaw = { date?: string; title?: string; solution?: string[]; clues?: { across?: Record<string, string>; down?: Record<string, string> }; media?: { type?: string; src?: string; row?: number; col?: number; rows?: number; cols?: number }[] };

/** Cumhuriyet's puzzle JSON as a puzzle: the rows (padded with blocks), the clues by number, the photo. */
export function cumhuriyetPuzzle(r: CumRaw, date: string): Puzzle {
  const rows = (r.solution ?? []).map((row) => row.toLocaleUpperCase("tr"));
  const w = Math.max(0, ...rows.map((row) => [...row].length)), h = rows.length;
  if (!w || !h || w > 30 || h > 30) throw new Error("no grid");
  const solution = rows.flatMap((row) => [...row.padEnd(w, "#")].map((c) => (c === "#" || c === " " ? "" : c)));
  const by = (o?: Record<string, string>) => Object.fromEntries(Object.entries(o ?? {}).map(([n, c]) => [Number(n), clean(c)]));
  const media = (r.media ?? []).flatMap((m) => (m.type === "image" && typeof m.src === "string" && m.src.startsWith("data:image/") && [m.row, m.col, m.rows, m.cols].every((v) => Number.isInteger(v))
    ? [{ src: m.src, row: m.row! - 1, col: m.col! - 1, rows: m.rows!, cols: m.cols! }] : []));
  const [y, mo, d] = date.split("-");
  return {
    id: `cum-${date}`, title: clean(r.title) || "Günün Kare Bulmacası", author: "", date, source: "cumhuriyet", lang: "tr",
    url: `https://www.cumhuriyet.com.tr/oyun/gunluk-kare-bulmaca/${d}-${mo}-${y}`,
    w, h, solution, clues: { across: by(r.clues?.across), down: by(r.clues?.down) }, ...(media.length && { media }),
  };
}

const cumList = (now: number) => cached("cumhuriyet", now, (_v, at) => now - at < 3_600_000, async () => {
  const j = JSON.parse(await get(`${CUM()}/api/list`, "Cumhuriyet", { headers: { accept: "application/json" } })) as { puzzles?: { date?: string; title?: string }[] };
  return (j.puzzles ?? []).flatMap((p) => (p.date && /^\d{4}-\d\d-\d\d$/.test(p.date) ? [{ date: p.date, title: clean(p.title) || "Günün Kare Bulmacası" }] : []));
});

export const cumhuriyet: Source = {
  id: "cumhuriyet",
  title: "Cumhuriyet",
  lang: "tr",
  day: istanbulDay,
  first: "2026-02",
  month: async (y, m, now) => {
    const today = istanbulDay(now);
    return (await cumList(now)).filter((p) => p.date.startsWith(`${y}-${pad(m)}-`) && p.date <= today).sort((a, b) => b.date.localeCompare(a.date))
      .map((p) => ({ id: `cum-${p.date}`, source: "cumhuriyet", title: p.title, author: "", w: 17, h: 11, date: p.date }));
  },
  puzzle: async (id, meta) => {
    const date = id.slice(4);
    const { raw } = await kept(id, meta, async () => JSON.parse(await get(`${CUM()}/api/puzzle/${date}`, "Cumhuriyet", { headers: { accept: "application/json" } })) as CumRaw, (r) => cumhuriyetPuzzle(r, date));
    return cumhuriyetPuzzle(raw, date);
  },
};

// ---- Sabah ------------------------------------------------------------------------------------

const SABAH = () => process.env.PAL_CROSSWORD_SABAH_URL || "https://www.sabah.com.tr";
/** Where its player pages may come from: the site's static host, or a stand-in in tests. */
const playerOk = (src: string) => src.startsWith("https://isbh.tmgrup.com.tr/") || (!!process.env.PAL_CROSSWORD_SABAH_URL && src.startsWith(SABAH()));
type SabahRaw = { size?: { x?: number; y?: number }; puzzleData?: { x?: number; y?: number; answer?: string; clue?: string; direction?: string }[] };

/** The articles a slider page lists: per day of the month asked, the first puzzle's path. */
export function parseSabahMonth(html: string, y: number, m: number): { date: string; slug: string }[] {
  const days = new Map<string, { n: number; slug: string }>();
  for (const [, slug] of html.matchAll(/\/bulmaca-coz\/kare\/(\d{4}\/\d\d\/\d\d\/[\w-]+)/g)) {
    const date = slug.slice(0, 10).replaceAll("/", "-"), n = Number(/-(\d+)$/.exec(slug)?.[1] ?? 1);
    if (!date.startsWith(`${y}-${pad(m)}-`)) continue;
    const had = days.get(date);
    if (!had || n < had.n) days.set(date, { n, slug });
  }
  return [...days].map(([date, { slug }]) => ({ date, slug })).sort((a, b) => b.date.localeCompare(a.date));
}

/** The puzzle JSON a Sabah player page carries (`_PUZZLE_DATA`, base64). */
export function parseSabahPlayer(html: string): SabahRaw {
  const m = /_PUZZLE_DATA\s*=\s*'([A-Za-z0-9+/=]+)'/.exec(html);
  if (!m) throw new Error("no puzzle in the player");
  return JSON.parse(Buffer.from(m[1], "base64").toString("utf8")) as SabahRaw;
}

const sabahPuzzle = (r: SabahRaw, date: string, slug?: string): Puzzle => fromEntries(
  (r.puzzleData ?? []).map((e) => ({ x: Number(e.x), y: Number(e.y), across: e.direction === "across", answer: String(e.answer ?? ""), clue: String(e.clue ?? "") })),
  { id: `sabah-${date}`, title: "Günlük Kare Bulmaca", author: "", date, source: "sabah", lang: "tr", ...(slug && { url: `https://www.sabah.com.tr/bulmaca-coz/kare/${slug}` }) },
);

const SABAH_FIRST = "2024-07", SABAH_LAST = "2025-04";
const sabahMonth = (y: number, m: number, now: number) => {
  const key = `${y}-${pad(m)}`;
  if (key < SABAH_FIRST || key > SABAH_LAST) return Promise.resolve([]);
  // A stopped archive: a month's list, once fetched, is kept for good.
  return cached(`sabah-${key}`, now, (v: { date: string; slug: string }[]) => v.length > 0, async () => {
    const body = new URLSearchParams({ categoryNameForUrl: "bulmaca-coz", selectedDate: `${key}-15T00:00:00.000Z` });
    const j = JSON.parse(await get(`${SABAH()}/bulmaca-coz/getsliderarticles`, "Sabah", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } })) as { Html?: string };
    return parseSabahMonth(j.Html ?? "", y, m);
  });
};

export const sabah: Source = {
  id: "sabah",
  title: "Sabah",
  lang: "tr",
  day: istanbulDay,
  first: SABAH_FIRST,
  last: SABAH_LAST,
  month: async (y, m, now) => (await sabahMonth(y, m, now)).map(({ date, slug }) => ({ id: `sabah-${date}`, source: "sabah", title: "Günlük Kare Bulmaca", author: "", w: 9, h: 9, date, slug })),
  puzzle: async (id, meta) => {
    const date = id.slice(6);
    const { raw, meta: m } = await kept(id, meta, async () => {
      // Its article's path, from the month's list when it was not handed over.
      const slug = meta.slug ?? (await sabahMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Date.now())).find((d) => d.date === date)?.slug;
      if (!slug) throw new Error("No puzzle this day");
      const article = await get(`${SABAH()}/bulmaca-coz/kare/${slug}`, "Sabah");
      const src = /<iframe[^>]*class="kare-bulmaca"[^>]*src="([^"]+)"|<iframe[^>]*src="([^"]+\/bulmaca\/kare\/[^"]+)"/.exec(article);
      const url = src?.[1] ?? src?.[2];
      if (!url || !playerOk(url)) throw new Error("no puzzle on the page");
      return { ...parseSabahPlayer(await get(url, "Sabah")), slug };
    }, (r) => sabahPuzzle(r, date));
    return sabahPuzzle(raw, date, (raw as { slug?: string }).slug ?? m.slug);
  },
};
