// Your games: one JSON file in pal's data directory (the SDK's storage caps
// a file at 256 KB, which a long history would outgrow).
//
//   progress: puzzle id → the game as it stands (game.ts `Saved`), written
//             on every move, so Escape anywhere loses nothing
//   solves:   one row per finished puzzle, the log the stats read
//   meta:     puzzle id → the puzzle itself (its clues, difficulty, and the
//             day for a daily), so a puzzle is made once and a list can
//             name it
//   last:     the puzzle open last, which the next open resumes while unsolved
//
// Written whole and atomically (a temp file, then a rename). Saves arrive a
// move at a time, so writes coalesce: while one is on disk the latest state
// waits, and whatever came in between is written once after it.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Saved } from "./game.ts";
import type { Solve } from "./stats.ts";
import type { Diff } from "./sudoku.ts";

/** A puzzle: its clues as 81 characters (0 empty), and the day for a daily. */
export type Meta = { diff: Diff; givens: string; date?: string };
export type Data = { v: 1; progress: Record<string, Saved & { touched: number }>; solves: Solve[]; meta: Record<string, Meta>; last?: string };

/** `PAL_SUDOKU_DIR`, else pal's data directory. */
export function dataDir(): string {
  if (process.env.PAL_SUDOKU_DIR) return process.env.PAL_SUDOKU_DIR;
  const base = process.platform === "darwin" ? join(homedir(), "Library/Application Support") : process.env.XDG_DATA_HOME || join(homedir(), ".local/share");
  return join(base, "pal", "sudoku");
}

const file = () => join(dataDir(), "progress.json");
const empty = (): Data => ({ v: 1, progress: {}, solves: [], meta: {} });

let cache: Data | null = null;
let writing: Promise<void> | null = null;
let dirty = false;

export async function load(): Promise<Data> {
  if (cache) return cache;
  try {
    const d = JSON.parse(await readFile(file(), "utf8")) as Partial<Data>;
    cache = { ...empty(), ...d, v: 1 };
  } catch { cache = empty(); }
  return cache;
}

// The last `dirty` check and `writing = null` run with no await between them, so a save never lands on a writer that is leaving.
async function write() {
  try {
    while (dirty) {
      dirty = false;
      const snap = JSON.stringify(cache ?? empty());
      await mkdir(dataDir(), { recursive: true });
      const tmp = `${file()}.${process.pid}.tmp`;
      await writeFile(tmp, snap);
      await rename(tmp, file());
    }
  } catch (e) { console.error("sudoku: save", e); }
  writing = null;
}

/** Writes the data as it is now; resolves once it (or a later state) is on disk. */
export function save(): Promise<void> {
  dirty = true;
  writing ??= write();
  return writing;
}

/** Tests: forget the cache so the next load reads the file. */
export const reset = () => { cache = null; };
