// Crosshare (crosshare.org), the puzzles' one source. Three requests, each
// made only when a puzzle or a list is about to be shown, and cached on disk:
//
//   /dailyminis/<year>/<month>  a month of daily minis (the month 1-based;
//        bare /dailyminis is the current one). A Next.js page: the list is
//        in its __NEXT_DATA__ as [day, puzzle, constructor, patron], newest
//        first, the days in UTC (the site's `getUTCDate`). Back to 2020.
//   /tags/mini/page/<n>  the newest puzzles tagged mini, 20 a page, pages 0
//        to 9 (the site's own limit), newest first.
//   /api/ipuz/<id>  one puzzle as ipuz (ipuz.ts reads it).
//
// A puzzle file is kept for good (a replay or the archive never fetches it
// again); a past month's list for good too; the current month's and the
// newest-mini pages are asked again after a while. A failed request falls
// back to what is cached, however old, so a puzzle once opened always plays
// offline. Nothing of Crosshare's ships with pal: the puzzles are their
// constructors' work, fetched when you play and credited on the page.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Puzzle } from "./game.ts";
import { fromIpuz, type Ipuz } from "./ipuz.ts";
import { dataDir } from "./store.ts";

export const SITE = "https://crosshare.org";
const base = () => process.env.PAL_CROSSWORD_URL || SITE;
const FETCH_MS = Number(process.env.PAL_CROSSWORD_FETCH_MS) || 12_000;
/** The current month's list is asked again after this, sooner while today's mini is missing from it. */
const MONTH_TTL = 6 * 3_600_000, TODAY_TTL = 10 * 60_000, NEWEST_TTL = 3_600_000;
/** The largest grid played: a mini. */
export const MAX_SIDE = 7;
/** A Next walks back at most this many months (one request each) before it gives up. */
const WALK_MONTHS = 4;

export type Listed = { id: string; title: string; author: string; w: number; h: number; date?: string; slug?: string };
export const small = (l: { w: number; h: number }) => l.w <= MAX_SIDE && l.h <= MAX_SIDE;
export const pageUrl = (id: string, slug?: string) => `${SITE}/crosswords/${id}${slug ? `/${slug}` : ""}`;

// ---- reading the pages -------------------------------------------------------------

/** The JSON a Next.js page carries its props in. */
export function nextData(html: string): any {
  const m = /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("no page data");
  return JSON.parse(m[1]).props?.pageProps ?? {};
}

type RawPuzzle = { id?: string; title?: string; authorName?: string; guestConstructor?: string | null; size?: { rows?: number; cols?: number }; slug?: string };
const pad = (n: number) => String(n).padStart(2, "0");
function listed(p: RawPuzzle, date?: string): Listed | undefined {
  if (!p?.id) return undefined;
  const slug = (p.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { id: p.id, title: p.title?.trim() || "Untitled", author: (p.guestConstructor || p.authorName || "").trim(), w: Number(p.size?.cols) || 0, h: Number(p.size?.rows) || 0, ...(date && { date }), ...(slug && { slug }) };
}

/** A daily minis page: its month (1-based) and the puzzles by date, newest first. */
export function parseMonth(html: string): { year: number; month: number; days: Listed[] } {
  const d = nextData(html);
  const year = Number(d.year), month = Number(d.month) + 1;
  if (!year || !month) throw new Error("no month");
  const days = (Array.isArray(d.puzzles) ? d.puzzles : []).flatMap(([day, p]: [number, RawPuzzle]) => {
    const l = listed(p, `${year}-${pad(month)}-${pad(Number(day))}`);
    return l ? [l] : [];
  });
  return { year, month, days };
}

/** A tag page: its puzzles, newest first, and whether a page follows. */
export function parseTag(html: string): { items: Listed[]; more: boolean } {
  const d = nextData(html);
  const items = (Array.isArray(d.puzzles) ? d.puzzles : []).flatMap((p: RawPuzzle) => { const l = listed(p); return l ? [l] : []; });
  return { items, more: d.nextPage !== null && d.nextPage !== undefined };
}

// ---- the network and the cache -------------------------------------------------------

async function get(path: string): Promise<string> {
  const res = await fetch(base() + path, { signal: AbortSignal.timeout(FETCH_MS), headers: { "user-agent": "pal-crossword" } });
  if (!res.ok) throw new Error(res.status === 404 ? "not found" : `Crosshare answered ${res.status}`);
  return res.text();
}

const cacheDir = () => join(dataDir(), "cache");
async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as T; } catch { return undefined; }
}
async function writeJson(path: string, v: unknown) {
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(v));
  await rename(tmp, path);
}

/** A list, from the cache while it is fresh, else fetched; a failed fetch falls back to the cache, however old. */
async function cached<T>(name: string, now: number, fresh: (v: T, at: number) => boolean, fetchIt: () => Promise<T>): Promise<T> {
  const path = join(cacheDir(), "lists", `${name}.json`);
  const hit = await readJson<{ at: number; v: T }>(path);
  if (hit && fresh(hit.v, hit.at)) return hit.v;
  try {
    const v = await fetchIt();
    await writeJson(path, { at: now, v }).catch(() => {});
    return v;
  } catch (e) {
    if (hit) return hit.v;
    throw e;
  }
}

export const utcToday = (now: number) => new Date(now).toISOString().slice(0, 10);

/** The daily minis of a month (1-based), newest first. */
export async function month(year: number, m: number, now = Date.now()): Promise<Listed[]> {
  const today = utcToday(now);
  const current = today.slice(0, 7) === `${year}-${pad(m)}`;
  if (`${year}-${pad(m)}` > today.slice(0, 7) || year < 2020) return [];
  return cached(`daily-${year}-${pad(m)}`, now, (v: Listed[], at) => {
    if (!current) return v.length > 0 || now - at < MONTH_TTL;
    const age = now - at;
    return age < (v.some((l) => l.date === today) ? MONTH_TTL : TODAY_TTL);
  }, async () => {
    try { return parseMonth(await get(`/dailyminis/${year}/${m}`)).days; }
    // A month with no minis at all is a 404 on the site: an empty month, not an error.
    catch (e) { if ((e as Error).message === "not found") return []; throw e; }
  });
}

/** Today's daily mini: the one dated today (UTC), else the newest listed. */
export async function today(now = Date.now()): Promise<Listed | undefined> {
  const t = utcToday(now);
  const days = await month(Number(t.slice(0, 4)), Number(t.slice(5, 7)), now);
  if (days.length) return days.find((d) => d.date === t) ?? days[0];
  const prev = new Date(`${t.slice(0, 7)}-01T00:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  return (await month(prev.getUTCFullYear(), prev.getUTCMonth() + 1, now))[0];
}

/** A page (0 to 9) of the newest minis. */
export function newest(page: number, now = Date.now()): Promise<{ items: Listed[]; more: boolean }> {
  const p = Math.max(0, Math.min(9, Math.floor(page)));
  return cached(`mini-${p}`, now, (_v, at) => now - at < NEWEST_TTL, async () => parseTag(await get(`/tags/mini/page/${p}`)));
}

const puzzlePath = (id: string) => join(cacheDir(), "puzzles", `${id.replace(/[^A-Za-z0-9_-]/g, "")}.json`);
type Stored = { ipuz: Ipuz; date?: string; slug?: string };
/** A puzzle by id, from the cache or fetched once; `meta` adds what the list knew (the daily's date, the slug). */
export async function puzzle(id: string, meta: { date?: string; slug?: string } = {}): Promise<Puzzle & { slug?: string }> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("not a puzzle id");
  const path = puzzlePath(id);
  let s = await readJson<Stored>(path);
  if (!s) {
    const ipuz = JSON.parse(await get(`/api/ipuz/${id}`)) as Ipuz;
    fromIpuz(ipuz, id); // a file it cannot play is not kept
    s = { ipuz, ...meta };
    await writeJson(path, s).catch(() => {});
  } else if ((meta.date && !s.date) || (meta.slug && !s.slug)) {
    s = { ...s, ...meta };
    await writeJson(path, s).catch(() => {});
  }
  const p = fromIpuz(s.ipuz, id);
  return { ...p, ...(s.date && { date: s.date }), ...(s.slug && { slug: s.slug }) };
}

// ---- the next puzzle ------------------------------------------------------------------

/**
 * The next puzzle to play after `from`, skipping the one open, every puzzle
 * `seen` says was played (solved or started) and grids larger than a mini:
 * today's daily while it is unplayed; then, after a daily (or with nothing
 * open), the dailies back from its day, a month's list at a time and a few
 * months at most, then the newest minis; after any other puzzle the newest
 * minis first, then the dailies back from today.
 */
export async function next(from: { id?: string; date?: string } | undefined, seen: (id: string) => boolean, now = Date.now()): Promise<Listed | undefined> {
  const ok = (l: Listed) => l.id !== from?.id && !seen(l.id) && small(l);
  const top = await today(now).catch(() => undefined);
  if (top && ok(top)) return top;
  const dailies = async () => {
    const start = from?.date ?? utcToday(now);
    let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
    for (let k = 0; k < WALK_MONTHS && y >= 2020; k++) {
      const hit = (await month(y, m, now).catch(() => [] as Listed[])).find((d) => d.date! <= start && ok(d));
      if (hit) return hit;
      if (--m === 0) { m = 12; y--; }
    }
  };
  const minis = async () => {
    for (let page = 0; page <= 9; page++) {
      const { items, more } = await newest(page, now).catch(() => ({ items: [] as Listed[], more: false }));
      const hit = items.find(ok);
      if (hit || !more) return hit;
    }
  };
  const order = !from?.id || from.date ? [dailies, minis] : [minis, dailies];
  for (const walk of order) {
    const hit = await walk();
    if (hit) return hit;
  }
  return undefined;
}
