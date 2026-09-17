// The vault on disk: one index of every note (walked, parsed through
// notes.ts, kept per file by mtime and size so a rebuild re-reads only
// what changed), a watcher on the folder that marks it stale (the next
// listing rebuilds; nothing is re-read on the event itself), and the
// full-text search: ripgrep when it is on PATH, else a scan of the notes
// in Bun with a one-second budget. Reads and writes of one note are here
// too, so index.ts never touches the file system by itself.
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { errorMessage } from "@zcag/pal";
import { excluded, parseNote, resolve, type Note } from "./notes.ts";

export type Index = {
  root: string;
  /** The vault's name in Obsidian's URIs: its folder's. */
  name: string;
  notes: Note[];
  byPath: Map<string, Note>;
  /** Target path to the paths that link to it. */
  backlinks: Map<string, string[]>;
  /** Every folder that holds a note, sorted; `""` is the top. */
  folders: string[];
  builtAt: number;
};

/** A rebuild older than this happens on the next listing even without a watcher event (a watcher that silently died). */
export const MAX_AGE_MS = 30_000;
/** Watcher events closer than this are one invalidation. */
const WATCH_SETTLE_MS = 200;
/** The scan stops here and answers what it has. */
export const SEARCH_BUDGET_MS = 1000;
/** Matching lines kept per note. */
export const MATCHES_PER_NOTE = 3;
/** Notes a search answers at most. */
export const SEARCH_MAX = 60;
/** A note past this is not scanned (a pasted log); ripgrep reads it anyway. */
const SCAN_MAX_BYTES = 2 * 1024 * 1024;

const log = (s: string) => console.error(`[obsidian] ${s}`);

// ---- the index -----------------------------------------------------------------

type Cached = { mtime: number; size: number; note: Note };

let current: { key: string; index: Index } | undefined;
let building: Promise<Index> | undefined;
let dirty = true;
const parsed = new Map<string, Cached>();
let watcher: { root: string; w: FSWatcher } | undefined;
let settle: ReturnType<typeof setTimeout> | undefined;

/** Every `.md` under `root`, relative paths, dot folders and the excluded globs pruned as the walk goes. */
async function walk(root: string, globs: Bun.Glob[]): Promise<string[]> {
  const out: string[] = [];
  const dirs = [""];
  while (dirs.length) {
    const rel = dirs.pop()!;
    let entries: import("node:fs").Dirent[];
    try { entries = await readdir(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) { if (!globs.some((g) => g.match(p) || g.match(`${p}/`))) dirs.push(p); continue; }
      if (!/\.md$/i.test(e.name) || !(e.isFile() || e.isSymbolicLink())) continue;
      if (!excluded(p, globs)) out.push(p);
    }
  }
  return out.sort();
}

async function build(root: string, name: string, globs: Bun.Glob[]): Promise<Index> {
  const paths = await walk(root, globs);
  const keep = new Set(paths);
  for (const k of parsed.keys()) if (!keep.has(k)) parsed.delete(k);
  const notes: Note[] = [];
  await Promise.all(paths.map(async (p) => {
    let s: { mtime: number; size: number };
    try { const st = await stat(join(root, p)); s = { mtime: st.mtimeMs, size: st.size }; } catch { return; }
    const have = parsed.get(p);
    if (have && have.mtime === s.mtime && have.size === s.size) { notes.push(have.note); return; }
    let text: string;
    try { text = await readFile(join(root, p), "utf8"); } catch { return; }
    const note = parseNote(p, text, s);
    parsed.set(p, { ...s, note });
    notes.push(note);
  }));
  notes.sort((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const backlinks = new Map<string, string[]>();
  for (const n of notes) for (const t of n.links) {
    const target = resolve(t, notes);
    if (!target || target.path === n.path) continue;
    const list = backlinks.get(target.path) ?? [];
    if (!list.includes(n.path)) { list.push(n.path); backlinks.set(target.path, list); }
  }
  const folders = [...new Set(notes.map((n) => n.folder))].sort();
  return { root, name, notes, byPath, backlinks, folders, builtAt: Date.now() };
}

/** One watcher on the vault; a burst of events is one invalidation. Replaced when the root moves; missing `recursive` support is logged and the age cap stands in. */
function watchRoot(root: string) {
  if (watcher?.root === root) return;
  watcher?.w.close();
  watcher = undefined;
  try {
    const w = watch(root, { recursive: true }, () => { clearTimeout(settle); settle = setTimeout(() => { dirty = true; }, WATCH_SETTLE_MS); });
    w.on("error", (e) => { log(`watch: ${errorMessage(e)}`); if (watcher?.w === w) watcher = undefined; });
    watcher = { root, w };
  } catch (e) {
    log(`watch: ${errorMessage(e)}; the index refreshes every ${MAX_AGE_MS / 1000} s instead`);
  }
}

/**
 * The index for `root`, rebuilt when the watcher saw a change, the root
 * or the globs moved, `force` asks, or the last build is older than
 * `MAX_AGE_MS`; concurrent callers share one build.
 */
export async function index(root: string, exclude: string[], force = false): Promise<Index> {
  const key = `${root}\0${exclude.join("\0")}`;
  watchRoot(root);
  if (!force && !dirty && current?.key === key && Date.now() - current.index.builtAt < MAX_AGE_MS) return current.index;
  if (building && current?.key === key && !force) return building;
  if (current?.key !== key) parsed.clear();
  const globs = exclude.map((g) => g.trim()).filter(Boolean).map((g) => new Bun.Glob(g));
  dirty = false;
  const t0 = Date.now();
  building = build(root, basename(root), globs).then((ix) => {
    current = { key, index: ix };
    log(`indexed ${ix.notes.length} notes in ${Date.now() - t0} ms`);
    return ix;
  }).finally(() => { building = undefined; });
  return building;
}

/** The next `index` call rebuilds (a write of our own). */
export const invalidate = () => { dirty = true; };

export function dispose() {
  clearTimeout(settle);
  watcher?.w.close();
  watcher = undefined;
  current = undefined;
  parsed.clear();
}

// ---- one note's file ------------------------------------------------------------------

export const noteText = (root: string, path: string): Promise<string> => readFile(join(root, path), "utf8");

/** Writes a note (folders made), then marks the index stale. */
export async function writeNote(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await Bun.write(join(root, path), text);
  invalidate();
}

/** Appends `text` as the last line (a newline first when the note does not end on one); the note is created when missing. */
export async function appendNote(root: string, path: string, text: string): Promise<void> {
  const file = Bun.file(join(root, path));
  const have = (await file.exists()) ? await file.text() : "";
  const sep = have && !have.endsWith("\n") ? "\n" : "";
  await writeNote(root, path, `${have}${sep}${text.replace(/\s+$/, "")}\n`);
}

export const exists = (root: string, path: string): Promise<boolean> => Bun.file(join(root, path)).exists();

// ---- search ---------------------------------------------------------------------------

export type Hit = { path: string; lines: { n: number; text: string }[] };
export type SearchBackend = "rg" | "scan";

const forced = process.env.PAL_OBSIDIAN_SEARCH as SearchBackend | undefined;
/** ripgrep when on PATH (or forced); the scan otherwise. Decided once per process. */
export const BACKEND: SearchBackend = forced === "scan" ? "scan" : forced === "rg" || Bun.which("rg") ? "rg" : "scan";

/** The ripgrep command: fixed string, case-insensitive, `path:line:text` per match, three per file, markdown only. */
export const rgArgv = (q: string, exclude: string[]): string[] => [
  "rg", "--line-number", "--no-heading", "--with-filename", "--ignore-case", "--fixed-strings", "--color", "never", "--no-messages", "--max-count", String(MATCHES_PER_NOTE),
  "--glob", "*.md", "--glob", "!.*", ...exclude.flatMap((g) => ["--glob", `!${g}`]), "--", q, ".",
];

/** `path:line:text` lines to hits, in ripgrep's order. */
export function parseRg(out: string): Hit[] {
  const by = new Map<string, Hit>();
  for (const line of out.split("\n")) {
    const m = /^\.\/(.+?\.md):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    const hit = by.get(m[1]) ?? { path: m[1], lines: [] };
    hit.lines.push({ n: Number(m[2]), text: m[3] });
    by.set(m[1], hit);
  }
  return [...by.values()];
}

let running: Bun.Subprocess<"ignore", "pipe", "ignore"> | undefined;

async function rgSearch(q: string, root: string, exclude: string[]): Promise<Hit[]> {
  running?.kill();
  const proc = Bun.spawn(rgArgv(q, exclude), { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  running = proc;
  const timer = setTimeout(() => proc.kill(), SEARCH_BUDGET_MS);
  const out = await new Response(proc.stdout).text().catch(() => "");
  clearTimeout(timer);
  if (running === proc) running = undefined;
  return parseRg(out);
}

/** The scan: every note of the index in order, its lines that contain `q`, until the budget is spent. */
async function scanSearch(q: string, ix: Index): Promise<Hit[]> {
  const needle = q.toLowerCase();
  const hits: Hit[] = [];
  const t0 = Date.now();
  for (const n of ix.notes) {
    if (Date.now() - t0 > SEARCH_BUDGET_MS || hits.length >= SEARCH_MAX) break;
    if (n.size > SCAN_MAX_BYTES) continue;
    let text: string;
    try { text = await noteText(ix.root, n.path); } catch { continue; }
    if (!text.toLowerCase().includes(needle)) continue;
    const lines: Hit["lines"] = [];
    const ls = text.split("\n");
    for (let i = 0; i < ls.length && lines.length < MATCHES_PER_NOTE; i++) if (ls[i].toLowerCase().includes(needle)) lines.push({ n: i + 1, text: ls[i] });
    hits.push({ path: n.path, lines });
  }
  return hits;
}

/**
 * Notes whose text has `q`: a note named or titled like it first, then by
 * how many lines matched, then the newest; `SEARCH_MAX` at most. The hits
 * carry the matching lines for the row and the pane.
 */
export async function search(q: string, ix: Index, exclude: string[]): Promise<Hit[]> {
  const raw = BACKEND === "rg" ? await rgSearch(q, ix.root, exclude) : await scanSearch(q, ix);
  const needle = q.toLowerCase();
  const hits = raw.filter((h) => ix.byPath.has(h.path));
  const titled = (h: Hit) => { const n = ix.byPath.get(h.path)!; return n.name.toLowerCase().includes(needle) || n.title.toLowerCase().includes(needle) ? 1 : 0; };
  return hits.sort((a, b) => titled(b) - titled(a) || b.lines.length - a.lines.length || ix.byPath.get(b.path)!.mtime - ix.byPath.get(a.path)!.mtime).slice(0, SEARCH_MAX);
}
