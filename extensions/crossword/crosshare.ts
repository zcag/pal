// Crosshare (crosshare.org): English minis. Three requests, each made only
// when a puzzle or a list is about to be shown, and cached (cache.ts):
//
//   /dailyminis/<year>/<month>  a month of daily minis (the month 1-based;
//        bare /dailyminis is the current one). A Next.js page: the list is
//        in its __NEXT_DATA__ as [day, puzzle, constructor, patron], newest
//        first, the days in UTC (the site's `getUTCDate`). Back to 2020.
//   /tags/mini/page/<n>  the newest puzzles tagged mini, 20 a page, pages 0
//        to 9 (the site's own limit), newest first.
//   /api/ipuz/<id>  one puzzle as ipuz (ipuz.ts reads it).
//
// A past month's list is kept for good; the current month's and the
// newest-mini pages are asked again after a while. Nothing of Crosshare's
// ships with pal: the puzzles are their constructors' work, fetched when
// you play and credited on the page.
import { cached, get, kept } from "./cache.ts";
import type { Puzzle } from "./game.ts";
import { fromIpuz, type Ipuz } from "./ipuz.ts";
import type { Listed, Source } from "./sources.ts";

export const SITE = "https://crosshare.org";
const base = () => process.env.PAL_CROSSWORD_URL || SITE;
/** The current month's list is asked again after this, sooner while today's mini is missing from it. */
const MONTH_TTL = 6 * 3_600_000, TODAY_TTL = 10 * 60_000, NEWEST_TTL = 3_600_000;
/** The largest grid played: a mini. */
export const MAX_SIDE = 7;
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
  return { id: p.id, source: "crosshare", title: p.title?.trim() || "Untitled", author: (p.guestConstructor || p.authorName || "").trim(), w: Number(p.size?.cols) || 0, h: Number(p.size?.rows) || 0, ...(date && { date }), ...(slug && { slug }) };
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

// ---- the network ---------------------------------------------------------------------

const fetchPage = (path: string) => get(base() + path, "Crosshare");

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
    try { return parseMonth(await fetchPage(`/dailyminis/${year}/${m}`)).days; }
    // A month with no minis at all is a 404 on the site: an empty month, not an error.
    catch (e) { if ((e as Error).message === "not found") return []; throw e; }
  });
}

/** A page (0 to 9) of the newest minis. */
export function newest(page: number, now = Date.now()): Promise<{ items: Listed[]; more: boolean }> {
  const p = Math.max(0, Math.min(9, Math.floor(page)));
  return cached(`mini-${p}`, now, (_v, at) => now - at < NEWEST_TTL, async () => parseTag(await fetchPage(`/tags/mini/page/${p}`)));
}

/** A puzzle by id, from the cache or fetched once; `meta` adds what the list knew (the daily's date, the slug). */
export async function puzzle(id: string, meta: { date?: string; slug?: string } = {}): Promise<Puzzle> {
  const { raw, meta: m } = await kept(id, meta, async () => JSON.parse(await fetchPage(`/api/ipuz/${id}`)) as Ipuz, (r) => fromIpuz(r, id));
  return { ...fromIpuz(raw, id), source: "crosshare", url: pageUrl(id, m.slug), ...(m.date && { date: m.date }) };
}

export const crosshare: Source = {
  id: "crosshare",
  title: "Crosshare",
  day: utcToday,
  first: "2020-01",
  month,
  puzzle,
  fits: small,
};
