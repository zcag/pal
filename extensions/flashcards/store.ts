// What you know: one JSON file in pal's data directory (the SDK's storage
// caps a file at 256 KB, and a few thousand cards' memory states and a
// review log outgrow it). Written whole and atomically after every change,
// through one queue, so a crash mid-write leaves the last good file.
//
//   cards: "<pack>/<card>[<]" → the card's FSRS memory (srs.ts `Mem`); a
//          trailing "<" is the reverse card (back → front)
//   log:   one row per answer, [unix s, key, rating 1-4, state before 0-3
//          (4: a refresher answer, which schedules nothing), ms to answer]:
//          the daily new limit, the stats, streak and heatmap read it, and
//          it is what an FSRS optimiser would need later
//   active: the packs in rotation, in the order they were added; null
//          until the first pick (the page then asks what to learn)
//   suspended: cards taken out of study (a bad card, one you know cold)
//   edits: "<pack>/<card>" → your own meaning for a card (⌘E), over the pack's
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Mem } from "./srs.ts";

export type LogRow = [at: number, key: string, rating: number, state: number, ms: number];
export type Data = { v: 1; cards: Record<string, Mem>; log: LogRow[]; suspended: string[]; active: string[] | null; edits?: Record<string, { back?: string }> };

/** `PAL_FLASHCARDS_DIR`, else pal's data directory (the store's root, like the clipboard history). */
export function dataDir(): string {
  if (process.env.PAL_FLASHCARDS_DIR) return process.env.PAL_FLASHCARDS_DIR;
  const base = process.platform === "darwin" ? join(homedir(), "Library/Application Support") : process.env.XDG_DATA_HOME || join(homedir(), ".local/share");
  return join(base, "pal", "flashcards");
}

export const packsDir = () => join(dataDir(), "packs");
const file = () => join(dataDir(), "progress.json");
const empty = (): Data => ({ v: 1, cards: {}, log: [], suspended: [], active: null });

let cache: Data | null = null;
let writing: Promise<void> = Promise.resolve();

export async function load(): Promise<Data> {
  if (cache) return cache;
  try {
    const d = JSON.parse(await readFile(file(), "utf8")) as Partial<Data>;
    cache = { ...empty(), ...d, v: 1 };
  } catch { cache = empty(); }
  return cache;
}

/** Writes the cache as it is now, after any write already queued. */
export function save(): Promise<void> {
  const snap = JSON.stringify(cache ?? empty());
  writing = writing.then(async () => {
    await mkdir(dataDir(), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    await writeFile(tmp, snap);
    await rename(tmp, file());
  }).catch((e) => console.error("flashcards: save", e));
  return writing;
}

/** Tests: forget the cache so the next load reads the file. */
export const reset = () => { cache = null; };
