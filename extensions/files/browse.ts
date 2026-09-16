// Folder browsing as data: the order of a listing under each sort, the
// name filter, the parent of a path, the `..` row and the cap hint. Pure;
// index.ts reads the folder and turns entries into rows.
import { basename, dirname } from "node:path";
import type { Item } from "@zcag/pal";

/** One entry of a folder as `stat` reports it, before it is a row. */
export type Entry = { path: string; name: string; dir: boolean; size: number; mtime: number };

/** The `browse` palette's filters, in dropdown order; the first is the default. */
export const SORTS = [
  { id: "name", title: "Name" },
  { id: "date", title: "Date" },
  { id: "size", title: "Size" },
] as const;
export type Sort = (typeof SORTS)[number]["id"];

/** Rows a browsed folder shows at most; the rest is a hint row (`hintRow`). */
export const BROWSE_CAP = 500;

/** The args of the level the `browse` palette lists: the folder, absolute. */
export type Browse = { browse: string };

const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name);

/**
 * `name`: folders first, then files, each case-insensitive alphabetical
 * (Finder's order); `date`: newest first, folders and files mixed; `size`:
 * largest first, folders (no size of their own) last, by name among
 * themselves. Ties fall back to the name.
 */
export function sortEntries(entries: Entry[], by: Sort = "name"): Entry[] {
  const out = [...entries];
  switch (by) {
    case "date": return out.sort((a, b) => b.mtime - a.mtime || byName(a, b));
    case "size": return out.sort((a, b) => Number(a.dir) - Number(b.dir) || (a.dir ? 0 : b.size - a.size) || byName(a, b));
    default: return out.sort((a, b) => Number(b.dir) - Number(a.dir) || byName(a, b));
  }
}

/** The entries whose name contains `query` (case-insensitive substring); dot files only with `showHidden`, or when the query itself starts with a dot. */
export function filterEntries(entries: Entry[], query: string, showHidden: boolean): Entry[] {
  const q = query.trim().toLowerCase();
  const dots = showHidden || q.startsWith(".");
  return entries.filter((e) => (dots || !e.name.startsWith(".")) && (!q || e.name.toLowerCase().includes(q)));
}

/** The folder above `path`; `/` is its own parent (nothing above it), and a trailing slash does not count. */
export function parentOf(path: string): string {
  const p = path.replace(/\/+$/, "") || "/";
  return p === "/" ? "/" : dirname(p);
}

/** True at the filesystem root: nowhere to go up to, so no `..` row. */
export const isRoot = (path: string) => (path.replace(/\/+$/, "") || "/") === "/";

/** The row id of the `..` row for `parent`. */
export const upId = (parent: string) => `up:${parent}`;

/**
 * The `..` row that leads the listing of `folder`: Enter (and `←`,
 * Backspace from anywhere in the level) goes up; `short` spells a path
 * for the subtitle. `glyph` is the folder glyph the rows use.
 */
export function upRow(folder: string, short: (p: string) => string, glyph: string): Item {
  const parent = parentOf(folder);
  return {
    id: upId(parent),
    name: "..",
    subtitle: short(parent),
    icon: glyph,
    keywords: ["up", "parent"],
    actions: [{ id: "up", title: "Go up", shortcut: ["left", "backspace"] }],
  };
}

/** An inert row after the cap saying how many entries were left out. */
export const hintRow = (left: number, glyph: string): Item => ({
  id: "hint:more",
  name: `${left} more; type to filter`,
  subtitle: `A folder shows ${BROWSE_CAP} entries at most`,
  icon: glyph,
  actions: [],
});

/** What a typed path means for browsing: a path ending in `/` names a folder to list whole. */
export const endsWithSlash = (q: string) => /\/\s*$/.test(q);

/** The last segment, for a crumb (`Downloads`), the path itself at the root. */
export const leaf = (path: string) => basename(path.replace(/\/+$/, "")) || path;
