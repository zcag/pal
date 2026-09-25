// Where puzzles come from. A source lists a month of its dailies and fetches
// one as a `Puzzle` (game.ts); the rest of the extension treats them alike.
// Crosshare's minis (crosshare.ts), and the Turkish papers' kare bulmaca
// (turkish.ts). A puzzle's id says its source: Crosshare's are its own ids,
// the papers' are `ht-`, `cum-`, `sabah-` and the date.
import { crosshare, newest } from "./crosshare.ts";
import type { Puzzle } from "./game.ts";
import { cumhuriyet, haberturk, sabah } from "./turkish.ts";

export type SourceId = "crosshare" | "haberturk" | "cumhuriyet" | "sabah";
export type Listed = { id: string; source: SourceId; title: string; author: string; w: number; h: number; date?: string; slug?: string };

export type Source = {
  id: SourceId;
  title: string;
  lang?: "tr";
  /** A moment's date on its calendar: Crosshare's UTC, the papers' Istanbul. */
  day: (now: number) => string;
  /** The first month it has puzzles for, and the last for an archive that stopped (YYYY-MM). */
  first: string;
  last?: string;
  /** Its puzzles dated in a month (1-based), newest first, none after today. */
  month: (year: number, month: number, now: number) => Promise<Listed[]>;
  /** One puzzle, from the cache or fetched once; `meta` is what its list knew. */
  puzzle: (id: string, meta: { date?: string; slug?: string }) => Promise<Puzzle>;
  /** What Next may pick (Crosshare: a mini). */
  fits?: (l: Listed) => boolean;
};

export const SOURCES: Record<SourceId, Source> = { crosshare, haberturk, cumhuriyet, sabah };
export const ORDER: SourceId[] = ["crosshare", "haberturk", "cumhuriyet", "sabah"];
export const sourceId = (s: unknown): SourceId => (typeof s === "string" && s in SOURCES ? (s as SourceId) : "crosshare");
export const sourceOf = (id: string): Source => SOURCES[id.startsWith("ht-") ? "haberturk" : id.startsWith("cum-") ? "cumhuriyet" : id.startsWith("sabah-") ? "sabah" : "crosshare"];

const monthBack = (y: number, m: number): [number, number] => (m === 1 ? [y - 1, 12] : [y, m - 1]);
/** The month to start from: today's, or an archive's last. */
function startMonth(src: Source, now: number): [number, number] {
  const t = src.day(now).slice(0, 7), key = src.last && src.last < t ? src.last : t;
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7))];
}

/** Today's puzzle: the one dated today, else the newest listed (this month's or last month's; an archive's last). */
export async function today(src: Source, now: number): Promise<Listed | undefined> {
  const t = src.day(now);
  let [y, m] = startMonth(src, now);
  for (let k = 0; k < 2; k++) {
    const days = await src.month(y, m, now);
    if (days.length) return days.find((d) => d.date === t) ?? days[0];
    [y, m] = monthBack(y, m);
  }
  return undefined;
}

/** A Next walks back at most this many months (one request each at most) before it gives up. */
const WALK_MONTHS = 4;

/**
 * The next puzzle of `src` after `from`, skipping the one open, every puzzle `seen` says was
 * played (solved or started) and what the source does not fit: today's while it is unplayed;
 * then the dailies back from `from`'s day (or today); for Crosshare the newest minis too,
 * first after a newest mini, last after a daily.
 */
export async function next(src: Source, from: { id?: string; date?: string } | undefined, seen: (id: string) => boolean, now: number): Promise<Listed | undefined> {
  const ok = (l: Listed) => l.id !== from?.id && !seen(l.id) && (src.fits?.(l) ?? true);
  const top = await today(src, now).catch(() => undefined);
  if (top && ok(top)) return top;
  const dailies = async () => {
    const start = from?.date ?? src.day(now);
    let [y, m] = from?.date ? [Number(start.slice(0, 4)), Number(start.slice(5, 7))] : startMonth(src, now);
    for (let k = 0; k < WALK_MONTHS && `${y}-${String(m).padStart(2, "0")}` >= src.first; k++) {
      const hit = (await src.month(y, m, now).catch(() => [] as Listed[])).find((d) => d.date! <= start && ok(d));
      if (hit) return hit;
      [y, m] = monthBack(y, m);
    }
  };
  if (src.id !== "crosshare") return dailies();
  const minis = async () => {
    for (let page = 0; page <= 9; page++) {
      const { items, more } = await newest(page, now).catch(() => ({ items: [] as Listed[], more: false }));
      const hit = items.find(ok);
      if (hit || !more) return hit;
    }
  };
  for (const walk of !from?.id || from.date ? [dailies, minis] : [minis, dailies]) {
    const hit = await walk();
    if (hit) return hit;
  }
  return undefined;
}
