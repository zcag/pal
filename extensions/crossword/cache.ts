// The network and the disk, shared by the sources: one GET with a timeout, a
// list kept while it is fresh, and a puzzle's source data kept for good.
// A failed request falls back to what is cached, however old, so a puzzle
// once opened always plays offline. Everything lives under
// `<data dir>/cache/` (store.ts `dataDir`).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./store.ts";

const FETCH_MS = Number(process.env.PAL_CROSSWORD_FETCH_MS) || 12_000;

/** A page or a file; `site` names the source in the error ("HaberTürk answered 503"). A 404 is "not found". */
export async function get(url: string, site: string, init: RequestInit = {}): Promise<string> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_MS), headers: { "user-agent": "pal-crossword", ...(init.headers as Record<string, string>) } });
  if (!res.ok) throw new Error(res.status === 404 ? "not found" : `${site} answered ${res.status}`);
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

/** A list, from the cache while `fresh` says so, else fetched; a failed fetch falls back to the cache, however old. */
export async function cached<T>(name: string, now: number, fresh: (v: T, at: number) => boolean, fetchIt: () => Promise<T>): Promise<T> {
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

export const isId = (id: string) => /^[A-Za-z0-9_-]{1,64}$/.test(id);

/**
 * A puzzle's source data by id, from the cache or fetched once (`load`, checked by `check`
 * before it is kept, so a file that cannot be played is never stored), with the meta the
 * lists knew (the date, a slug) kept beside it.
 */
export async function kept<R, M extends object>(id: string, meta: M, load: () => Promise<R>, check: (raw: R) => unknown): Promise<{ raw: R; meta: M }> {
  if (!isId(id)) throw new Error("not a puzzle id");
  const path = join(cacheDir(), "puzzles", `${id}.json`);
  const hit = await readJson<{ raw?: R; ipuz?: R } & M>(path);
  if (hit) {
    // Files kept before the sources came have the raw data under `ipuz`.
    const { raw, ipuz, ...had } = hit;
    const given = Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
    const merged = { ...had, ...given } as M;
    if (Object.entries(given).some(([k, v]) => (had as Record<string, unknown>)[k] !== v)) await writeJson(path, { raw: raw ?? ipuz, ...merged }).catch(() => {});
    return { raw: (raw ?? ipuz) as R, meta: merged };
  }
  const raw = await load();
  check(raw);
  await writeJson(path, { raw, ...meta }).catch(() => {});
  return { raw, meta };
}
