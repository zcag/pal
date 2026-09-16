// Lyrics from lrclib.net (free, no key): `/api/get` by track, artist,
// album and duration, then `/api/search` by track and artist with the
// closest duration when the exact lookup has nothing. LRC parsed into
// timed lines; `lineAt` picks the line for a position (the last one whose
// time has come). One in-memory cache per track id, misses included, so a
// track asks lrclib once per run. `PAL_LRCLIB` points the tests at a mock.
export const LRCLIB = (process.env.PAL_LRCLIB || "https://lrclib.net").replace(/\/+$/, "");
const REQUEST_MS = 8000;
/** A search hit counts when its duration is within this many seconds of the track's. */
const DURATION_SLACK = 3;
const CACHE_MAX = 100;
/** Sent as lrclib asks of clients (their docs: name the app). */
const UA = "pal-spotify (https://github.com/zcag/pal)";

export type Line = { /** Seconds. */ at: number; text: string };
export type Lyrics = { synced?: Line[]; plain?: string; instrumental?: boolean; /** lrclib's record id, for the link. */ id?: number };
export type TrackKey = { id: string; name: string; artist: string; album: string; /** Seconds. */ duration: number };

const TIME = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/**
 * LRC to lines, by time: `[mm:ss.xx]` (or `.xxx`, or `:xx`) tags, several
 * on one line for a repeated lyric, id tags (`[ar:...]`) and blank lines
 * dropped. An empty text after a tag is kept as a pause line (lrclib
 * writes them between verses).
 */
export function parseLrc(text: string): Line[] {
  const out: Line[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tags = [...raw.matchAll(TIME)];
    if (!tags.length) continue;
    const body = raw.slice(tags[tags.length - 1].index! + tags[tags.length - 1][0].length).trim();
    for (const t of tags) {
      const frac = t[3] ? Number(t[3]) / 10 ** t[3].length : 0;
      out.push({ at: Number(t[1]) * 60 + Number(t[2]) + frac, text: body });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The index of the line playing at `t` seconds: the last with `at <= t`; -1 before the first. */
export function lineAt(lines: Line[], t: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].at <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** The lyric line to show at `t`: none before the first line and none once a pause line is on. */
export const currentLine = (lines: Line[], t: number): string | undefined => {
  const i = lineAt(lines, t);
  return i < 0 ? undefined : lines[i].text || undefined;
};

type Hit = { id: number; trackName: string; artistName: string; albumName: string; duration: number; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null };

const toLyrics = (h: Hit): Lyrics => ({
  id: h.id,
  instrumental: !!h.instrumental,
  synced: h.syncedLyrics ? parseLrc(h.syncedLyrics) : undefined,
  plain: h.plainLyrics?.trim() || undefined,
});

async function get(path: string, query: Record<string, string>): Promise<any> {
  const res = await fetch(`${LRCLIB}${path}?${new URLSearchParams(query)}`, { headers: { "user-agent": UA, "lrclib-client": UA }, signal: AbortSignal.timeout(REQUEST_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lrclib ${res.status}`);
  return res.json();
}

/** The exact lookup, then the closest search hit that has lyrics; null when lrclib has nothing. */
export async function fetchLyrics(k: Omit<TrackKey, "id">): Promise<Lyrics | null> {
  const exact = (await get("/api/get", { track_name: k.name, artist_name: k.artist, album_name: k.album, duration: String(Math.round(k.duration)) })) as Hit | null;
  if (exact) return toLyrics(exact);
  const hits = ((await get("/api/search", { track_name: k.name, artist_name: k.artist })) ?? []) as Hit[];
  const near = hits
    .filter((h) => (h.syncedLyrics || h.plainLyrics) && Math.abs(h.duration - k.duration) <= DURATION_SLACK)
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || Math.abs(a.duration - k.duration) - Math.abs(b.duration - k.duration));
  return near.length ? toLyrics(near[0]) : null;
}

const cache = new Map<string, Lyrics | null>();
const inflight = new Map<string, Promise<Lyrics | null>>();
/** A failed lookup (lrclib down, a 503 on search) is not asked again for this long; every key would otherwise ask twice. */
const FAIL_TTL_MS = 30_000;
const failed = new Map<string, { at: number; error: Error }>();

/** The lyrics for a track, asked once per run; a lookup that fails (lrclib down) is retried after `FAIL_TTL_MS`, not remembered as a miss. */
export function lyricsFor(k: TrackKey): Promise<Lyrics | null> {
  if (cache.has(k.id)) return Promise.resolve(cache.get(k.id)!);
  const f = failed.get(k.id);
  if (f && Date.now() - f.at < FAIL_TTL_MS) return Promise.reject(f.error);
  let p = inflight.get(k.id);
  if (!p) {
    p = fetchLyrics(k)
      .then((l) => { remember(k.id, l); failed.delete(k.id); return l; })
      .catch((e) => { failed.set(k.id, { at: Date.now(), error: e instanceof Error ? e : new Error(String(e)) }); throw e; })
      .finally(() => inflight.delete(k.id));
    inflight.set(k.id, p);
  }
  return p;
}

/** What is known without asking: the lyrics, null for a known miss, undefined when never asked. */
export const cachedLyrics = (id: string): Lyrics | null | undefined => cache.get(id);

function remember(id: string, l: Lyrics | null) {
  cache.set(id, l);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
}

export const forgetLyrics = () => { cache.clear(); failed.clear(); };

/** lrclib's own search page for a track, for the "No lyrics" row. */
export const searchUrl = (k: { name: string; artist: string }) => `${LRCLIB}/search?${new URLSearchParams({ q: `${k.artist} ${k.name}` })}`;
