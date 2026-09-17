// Folder browsing as data: the order of a listing under each sort, the
// name filter, the parent of a path, the `..` row and the cap's row. Pure;
// index.ts reads the folder and turns entries into rows.
import { basename, dirname } from "node:path";
import { hint, tilde, type Item } from "@zcag/pal";

/** One entry of a folder as `stat` reports it, before it is a row. */
export type Entry = { path: string; name: string; dir: boolean; size: number; mtime: number };

/** The `browse` palette's filters, in dropdown order; the first is the default. */
export const SORTS = [
  { id: "name", title: "Name" },
  { id: "date", title: "Date" },
  { id: "size", title: "Size" },
] as const;
export type Sort = (typeof SORTS)[number]["id"];

/** Rows a browsed folder shows at most; the rest is a hint row (`moreRow`). */
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
/** The `..` row's id; index.ts reads the parent back off it. */
export const UP = "up:";

/**
 * The `..` row that leads the listing of `folder`: Enter (and `←`,
 * Backspace from anywhere in the level) goes up. `glyph` is the folder
 * glyph the rows use.
 */
export function upRow(folder: string, glyph: string): Item {
  const parent = parentOf(folder);
  return {
    id: UP + parent,
    name: "..",
    subtitle: tilde(parent),
    icon: glyph,
    keywords: ["up", "parent"],
    actions: [{ id: "up", title: "Go up", shortcut: ["left", "backspace"] }],
  };
}

/** An inert row after the cap saying how many entries were left out. */
export const moreRow = (left: number, glyph: string): Item => hint("more", `${left} more; type to filter`, `A folder shows ${BROWSE_CAP} entries at most`, { icon: glyph });

/** The last segment, for a crumb (`Downloads`), the path itself at the root. */
export const leaf = (path: string) => basename(path.replace(/\/+$/, "")) || path;
