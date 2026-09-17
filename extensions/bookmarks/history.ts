// Browser History: an input palette over the visit history the installed
// browsers keep. Chrome and its relatives write `History` per profile
// (SQLite, `urls` with `last_visit_time` in microseconds since 1601, the
// Windows epoch), Firefox `places.sqlite` (`moz_places`, `last_visit_date`
// in microseconds since 1970); Safari's History.db needs Full Disk Access
// and is not read here. A running browser holds its file locked, so each
// is copied under the cache first (browsers.ts `copied`: again when its
// mtime moved, at most every 30 s, since this lists on every keystroke),
// then one LIKE query per profile over the url and the title, newest
// first. The rows: the title (the url when it has none), the url under it
// and as the favicon's source, when it was last visited on the right, the
// browser as the section; Enter opens it in the browser it came from.
import { settings, type Action, type Effect, type Item } from "@zcag/pal";
import { BROWSERS, chromiumProfiles, copied, firefoxProfiles, openIn } from "./browsers.ts";

/** `[extensions.bookmarks]`, the key this palette reads. */
type Settings = { browsers: string[] };

/** Rows per profile, and after the merge. */
export const LIMIT = 50;
/** A copied database is used for this long before the source's mtime is looked at again (`PAL_BOOKMARKS_COPY_MS` in the tests). */
export const COPY_MIN_MS = Number(process.env.PAL_BOOKMARKS_COPY_MS ?? 30_000);
/** Chrome's clock starts at 1601-01-01 and counts microseconds. */
const CHROME_EPOCH_MS = 11_644_473_600_000;

/** One visit as either database answers it, the time in the browser's own unit. */
export type VisitRow = { url: string; title: string | null; last: number | null; visits: number | null };
export type Visit = { url: string; title: string; at: number; visits: number };

/** Chrome's `last_visit_time` (microseconds since 1601) as unix milliseconds; 0 (never visited) stays 0. */
export const chromeTime = (us: number | null): number => (us ? Math.round(us / 1000 - CHROME_EPOCH_MS) : 0);
/** Firefox's `last_visit_date` (microseconds since 1970) as unix milliseconds. */
export const firefoxTime = (us: number | null): number => (us ? Math.round(us / 1000) : 0);

/** The rows of one database as visits, the time converted by `time`; rows never visited or without a url are dropped. */
export const visits = (rows: VisitRow[], time: (us: number | null) => number): Visit[] =>
  rows.filter((r) => r.url && r.last).map((r) => ({ url: r.url, title: r.title?.trim() || r.url, at: time(r.last), visits: r.visits ?? 0 }));

/** `%q%` for LIKE, the wildcards and the escape in the query taken literally. */
export const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const CHROME_SQL = `SELECT url, title, last_visit_time AS last, visit_count AS visits FROM urls WHERE (url LIKE ?1 ESCAPE '\\' OR title LIKE ?1 ESCAPE '\\') AND hidden = 0 ORDER BY last_visit_time DESC LIMIT ${LIMIT}`;
const FIREFOX_SQL = `SELECT url, title, last_visit_date AS last, visit_count AS visits FROM moz_places WHERE (url LIKE ?1 ESCAPE '\\' OR title LIKE ?1 ESCAPE '\\') AND hidden = 0 ORDER BY last_visit_date DESC LIMIT ${LIMIT}`;

/** One profile's matches, newest first; a database that will not open or query is logged and skipped (a schema Chrome moved, a copy mid-write). */
async function query(db: string, sql: string, q: string, time: (us: number | null) => number): Promise<Visit[]> {
  const { Database } = await import("bun:sqlite");
  try {
    const d = new Database(await copied(db, COPY_MIN_MS), { readonly: true });
    try { return visits(d.query<VisitRow, [string]>(sql).all(like(q)), time); } finally { d.close(); }
  } catch (e) {
    console.error(`[bookmarks] history ${db}: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

type Source = { section: string; app: string; db: string; sql: string; time: (us: number | null) => number };

/** Every profile of every browser the setting names that keeps a history file, in the setting's order. */
async function sources(ids: string[]): Promise<Source[]> {
  const out: Source[] = [];
  for (const id of ids) {
    const b = BROWSERS[id];
    if (!b || b.kind === "safari") continue;
    if (b.kind === "chromium") for (const p of await chromiumProfiles(b, "History")) out.push({ section: p.section, app: b.app, db: `${p.dir}/History`, sql: CHROME_SQL, time: chromeTime });
    else for (const p of await firefoxProfiles(b)) out.push({ section: p.section, app: b.app, db: `${p.dir}/places.sqlite`, sql: FIREFOX_SQL, time: firefoxTime });
  }
  return out;
}

/** Every source's matches merged newest first, a url listed once (its newest visit), capped. */
export function merge(lists: { section: string; app: string; rows: Visit[] }[]): (Visit & { section: string; app: string })[] {
  const all = lists.flatMap((l) => l.rows.map((r) => ({ ...r, section: l.section, app: l.app }))).sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  const out: (Visit & { section: string; app: string })[] = [];
  for (const v of all) {
    if (seen.has(v.url)) continue;
    seen.add(v.url);
    out.push(v);
    if (out.length === LIMIT) break;
  }
  return out;
}

const COPY: Action = { id: "copy", title: "Copy link", shortcut: "cmd+c" };
const OPEN_DEFAULT: Action = { id: "open", title: "Open in default browser", shortcut: "cmd+o" };
/** The short browser name for the action title (`Chrome (Work)` is `Chrome`). */
const short = (section: string) => section.replace(/ \(.*\)$/, "");

/** The browser each listed url came from, for the pick (an input palette's rows are never restored from the index, so the last listing is what a pick sees). */
const known = new Map<string, string>();

function row(v: Visit & { section: string; app: string }): Item {
  known.set(v.url, v.app);
  return {
    id: v.url,
    name: v.title,
    subtitle: v.url,
    url: v.url,
    accessories: [{ date: v.at }],
    section: v.section,
    actions: [{ id: "open-in", title: `Open in ${short(v.section)}` }, COPY, OPEN_DEFAULT],
  };
}

async function list(text = ""): Promise<Item[]> {
  const srcs = await sources(settings.get<Settings>().browsers);
  if (!srcs.length) return [{ id: "hint:none", name: "No browser history found", subtitle: "Chrome, Brave, Edge, Chromium, Vivaldi, Arc and Firefox are read; Safari's needs Full Disk Access and is not", icon: "\u{f0026}", actions: [] }];
  known.clear();
  const q = text.trim();
  const lists = await Promise.all(srcs.map(async (s) => ({ section: s.section, app: s.app, rows: await query(s.db, s.sql, q, s.time) })));
  return merge(lists).map(row);
}

async function pick(id: string, action?: string): Promise<Effect> {
  switch (action) {
    case "copy": return { copy: id };
    case "open": return { open: id };
    default: {
      const app = known.get(id);
      if (!app) return { open: id };
      try { openIn(id, app); } catch (e) { return { keep: true, toast: { title: `Could not open in ${app}`, message: String((e as Error)?.message ?? e), style: "failure" } }; }
      return { hide: true };
    }
  }
}

export const historyPalette = {
  title: "Browser History",
  input: true,
  placeholder: "Search browser history",
  list,
  pick,
};
