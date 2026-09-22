// The tree and the walk. A scan reads a root breadth-parallel (every
// directory's entries listed and stat'ed with the others in flight, which
// is what makes a Bun walk beat `du` on APFS: ~/ with 1.07 M files in
// 7.2 s against du's 28.5 s, README), adding each file's size to every
// ancestor as it lands, so a map drawn mid-scan is live. Sizes are kept
// twice: allocated (`blocks * 512`, what the disk gives up) and apparent
// (`size`); a hard-linked file counts once (by inode); other file systems
// are skipped, except across a macOS firmlink (`/Users` lives on the Data
// volume); symlinks are never followed. The compact form for storage keeps
// the biggest nodes by a size cut, every ancestor of a kept node included.
import { readdir, readFile, lstat } from "node:fs/promises";
import { extname, join } from "node:path";

export type Node = {
  name: string;
  dir: boolean;
  /** Allocated bytes (the blocks), the subtree's for a directory. */
  alloc: number;
  /** Apparent bytes, the subtree's for a directory. */
  size: number;
  /** Files below (1 for a file, 0 for a `rest` node's own count in `count`). */
  files: number;
  /** Unix ms of the entry's own modification. */
  mtime: number;
  kids?: Node[];
  up?: Node;
  /** A directory that could not be listed. */
  denied?: boolean;
  /** Children this node has that the tree does not hold (cut for storage, or folded into a `rest` node): a zoom into it scans it afresh. */
  omitted?: number;
  /** "N smaller files": how many this node stands for. */
  rest?: number;
  /** The unix ms this directory's listing finished (absent while it is being read). */
  done?: number;
  /** A directory: allocated bytes below it per kind (`KINDS` order), what colours its box by the kind that weighs most. */
  kinds?: number[];
};

/** Files kept per directory as nodes; the rest fold into one "N smaller files" node so a million-file home stays a few hundred thousand nodes. */
export const FILES_PER_DIR = 256;

export const isRoot = (n: Node) => !n.up;
export const pathOf = (n: Node): string => (n.up ? join(pathOf(n.up), n.name) : n.name);
export const depthOf = (n: Node): number => (n.up ? depthOf(n.up) + 1 : 0);
/** The path from the root down to `n`, the root first. */
export const chain = (n: Node): Node[] => (n.up ? [...chain(n.up), n] : [n]);
/** The node at `path` under `root`'s tree (a path the tree does not hold: undefined). */
export function find(root: Node, path: string): Node | undefined {
  if (path === root.name) return root;
  if (!path.startsWith(root.name.endsWith("/") ? root.name : root.name + "/")) return;
  let n: Node | undefined = root;
  for (const part of path.slice(root.name.length).split("/").filter(Boolean)) {
    n = n?.kids?.find((k) => k.name === part);
    if (!n) return;
  }
  return n;
}

// ---- kinds ----------------------------------------------------------------

export type Kind = "folder" | "app" | "image" | "video" | "audio" | "document" | "code" | "archive" | "disk" | "package" | "file" | "rest";
export const KINDS: Kind[] = ["folder", "app", "image", "video", "audio", "document", "code", "archive", "disk", "package", "file", "rest"];
const EXT: [Kind, string[]][] = [
  ["image", ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg", "bmp", "tiff", "tif", "avif", "raw", "arw", "cr2", "dng", "psd", "ai"]],
  ["video", ["mp4", "mov", "mkv", "avi", "webm", "m4v", "mpg", "mpeg", "wmv", "flv", "ts"]],
  ["audio", ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "aiff", "wma", "alac"]],
  ["document", ["txt", "md", "pdf", "doc", "docx", "rtf", "pages", "odt", "xls", "xlsx", "numbers", "csv", "ppt", "pptx", "key", "epub", "mobi", "azw3"]],
  ["code", ["ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "rb", "sh", "zsh", "c", "h", "cpp", "hpp", "java", "kt", "swift", "lua", "toml", "json", "yaml", "yml", "html", "css", "sql", "wasm", "o", "a", "so", "dylib"]],
  ["archive", ["zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "jar", "whl"]],
  ["disk", ["dmg", "iso", "img", "vmdk", "qcow2", "vdi", "sparseimage", "sparsebundle", "ipsw"]],
  ["package", ["pkg", "deb", "rpm", "apk", "ipa", "appimage", "flatpak", "snap"]],
];
const BY_EXT = new Map<string, Kind>(EXT.flatMap(([k, es]) => es.map((e) => [e, k] as [string, Kind])));
export function kindOf(n: Pick<Node, "name" | "dir" | "rest">): Kind {
  if (n.rest) return "rest";
  if (n.dir) return n.name.endsWith(".app") ? "app" : "folder";
  return BY_EXT.get(extname(n.name).slice(1).toLowerCase()) ?? "file";
}
/** The kind that weighs most below a directory (its own kind for a file, or a directory with nothing counted). */
export function dominant(n: Node): Kind {
  if (!n.dir || !n.kinds) return kindOf(n);
  let best = -1, max = 0;
  n.kinds.forEach((b, i) => { if (b > max) { max = b; best = i; } });
  return best < 0 ? "folder" : KINDS[best];
}
export const KIND_LABEL: Record<Kind, string> = { folder: "Folder", app: "Application", image: "Image", video: "Video", audio: "Audio", document: "Document", code: "Code", archive: "Archive", disk: "Disk image", package: "Package", file: "File", rest: "Smaller files" };

// ---- formatting -------------------------------------------------------------

/** "42%", "0.4%", "<0.1%": a share of the parent. */
export function pct(part: number, whole: number): string {
  if (!whole || part <= 0) return "0%";
  const p = (100 * part) / whole;
  return p >= 10 ? `${Math.round(p)}%` : p >= 0.1 ? `${p.toFixed(1)}%` : "<0.1%";
}
export const count = (n: number, what = "file") => `${n.toLocaleString("en-US")} ${what}${n === 1 ? "" : "s"}`;

// ---- the walk ---------------------------------------------------------------

export type Progress = { files: number; dirs: number; alloc: number; size: number; denied: number; current: string };
export type WalkOptions = {
  /** Cross into other file systems (mounts); off, a directory on another device is skipped. macOS firmlinks are always crossed. */
  crossDevices?: boolean;
  /** Called after every directory finishes, for the live map. */
  onProgress?: (p: Progress) => void;
  /** Read by every directory; set it to stop. */
  signal?: { cancelled: boolean };
};

/** macOS firmlinks: directories that sit on the Data volume but belong in the system tree (`/Users`, `/Applications`, ...); crossed even though their device differs. */
let firmlinks: Promise<Set<string>> | undefined;
const firmlinkSet = () => (firmlinks ??= readFile("/usr/share/firmlinks", "utf8").then((t) => new Set(t.split("\n").map((l) => l.split("\t")[0]).filter(Boolean))).catch(() => new Set<string>()));

const add = (n: Node, alloc: number, sz: number, files: number) => { for (let a: Node | undefined = n; a; a = a.up) { a.alloc += alloc; a.size += sz; a.files += files; } };
/** `bytes` of kind `ki` into every directory above (and including) `n`. */
const bump = (n: Node, ki: number, bytes: number) => { for (let a: Node | undefined = n; a; a = a.up) { (a.kinds ??= new Array(KINDS.length).fill(0))[ki] += bytes; } };

/**
 * Reads `dir`'s subtree into `node` (its kids replaced, its totals
 * reset), the way a fresh scan and a rescan of one directory both go.
 * Resolves when every directory below has been listed.
 */
export async function walk(node: Node, dir: string, o: WalkOptions = {}): Promise<Progress> {
  const p: Progress = { files: 0, dirs: 0, alloc: 0, size: 0, denied: 0, current: dir };
  // The subtree's old totals leave the ancestors first, so a rescan lands on the right sums.
  add(node, -node.alloc, -node.size, -node.files);
  node.kinds?.forEach((b, ki) => b && bump(node, ki, -b));
  node.kids = [];
  node.denied = false;
  node.omitted = 0;
  node.done = undefined;
  const st = await lstat(dir).catch(() => undefined);
  const dev = st?.dev ?? 0;
  if (st) node.mtime = st.mtimeMs;
  const seen = new Set<string>();
  const links = await firmlinkSet();
  const one = async (n: Node, path: string, dev: number): Promise<void> => {
    if (o.signal?.cancelled) return;
    let ents: import("node:fs").Dirent[];
    try { ents = await readdir(path, { withFileTypes: true }); } catch { n.denied = true; p.denied++; n.done = Date.now(); return; }
    const subs: Promise<void>[] = [];
    const files: { name: string; alloc: number; size: number; mtime: number }[] = [];
    await Promise.all(ents.map(async (e) => {
      if (e.isSymbolicLink()) return;
      const full = join(path, e.name);
      const st = await lstat(full).catch(() => undefined);
      if (!st) return;
      if (e.isDirectory()) {
        if (st.dev !== dev && !o.crossDevices && !links.has(full)) return;
        const kid: Node = { name: e.name, dir: true, alloc: 0, size: 0, files: 0, mtime: st.mtimeMs, kids: [], up: n };
        n.kids!.push(kid);
        p.dirs++;
        subs.push(one(kid, full, st.dev));
        return;
      }
      if (!e.isFile()) return;
      if (st.nlink > 1) { const k = `${st.dev}:${st.ino}`; if (seen.has(k)) return; seen.add(k); }
      const alloc = st.blocks * 512;
      files.push({ name: e.name, alloc, size: st.size, mtime: st.mtimeMs });
      add(n, alloc, st.size, 1);
      bump(n, KINDS.indexOf(kindOf({ name: e.name, dir: false })), alloc);
      p.files++; p.alloc += alloc; p.size += st.size;
    }));
    // The biggest files are nodes; the rest fold into one, so the map still adds up.
    files.sort((a, b) => b.alloc - a.alloc);
    for (const f of files.slice(0, FILES_PER_DIR)) n.kids!.push({ name: f.name, dir: false, alloc: f.alloc, size: f.size, files: 1, mtime: f.mtime, up: n });
    const tail = files.slice(FILES_PER_DIR);
    if (tail.length) n.kids!.push({ name: `${tail.length.toLocaleString("en-US")} smaller files`, dir: false, rest: tail.length, alloc: tail.reduce((s, f) => s + f.alloc, 0), size: tail.reduce((s, f) => s + f.size, 0), files: 0, mtime: Math.max(...tail.map((f) => f.mtime)), up: n });
    p.current = path;
    o.onProgress?.(p);
    await Promise.all(subs);
    n.done = Date.now();
  };
  if (!st?.isDirectory()) { node.denied = true; p.denied = 1; node.done = Date.now(); return p; }
  await one(node, dir, dev);
  return p;
}

/** A fresh root node for `path` (the node's name is the whole path; its kids' are entry names). */
export const rootNode = (path: string): Node => ({ name: path, dir: true, alloc: 0, size: 0, files: 0, mtime: 0, kids: [] });

/** Takes `n` out of the tree (trashed): its totals leave every ancestor. */
export function detach(n: Node): void {
  if (!n.up?.kids) return;
  add(n.up, -n.alloc, -n.size, -n.files);
  if (n.dir) n.kinds?.forEach((b, ki) => b && bump(n.up!, ki, -b));
  else bump(n.up, KINDS.indexOf(kindOf(n)), -n.alloc);
  n.up.kids = n.up.kids.filter((k) => k !== n);
  n.up = undefined;
}

// ---- the compact form for storage ------------------------------------------

/** `[name, dir, alloc, size, files, mtime, kind, kids?]`: `kind` is a directory's dominant kind (`KINDS` index; -1 for a file); a trailing number in `kids` is how many children were cut; `rest` nodes carry their count as a negative `files`. */
export type Packed = [string, 0 | 1, number, number, number, number, number, (Packed | number)[]?];

/** The `budget` biggest nodes (by allocated size; every ancestor of a kept node is at least as big, so the kept set is a subtree from the root), packed. */
export function pack(root: Node, budget: number): Packed {
  const allocs: number[] = [];
  const gather = (n: Node) => { allocs.push(n.alloc); n.kids?.forEach(gather); };
  gather(root);
  allocs.sort((a, b) => b - a);
  const cut = allocs[Math.min(budget, allocs.length) - 1] ?? 0;
  const one = (n: Node): Packed => {
    const p: Packed = [n.name, n.dir ? 1 : 0, n.alloc, n.size, n.rest ? -n.rest : n.files, Math.round(n.mtime), n.dir ? KINDS.indexOf(dominant(n)) : -1];
    if (n.dir && n.kids) {
      // Under a cut of zero (the budget holds every node) the empty ones stay too, so the round trip is whole.
      const kept = n.kids.filter((k) => k.alloc >= cut && (k.alloc > 0 || cut === 0));
      const dropped = n.kids.length - kept.length + (n.omitted ?? 0);
      // A directory with anything cut says so, so a zoom into it rescans; one with an empty listing says that too (an empty array).
      p[7] = [...kept.map(one), ...(dropped ? [dropped] : [])];
    } else if (n.dir && n.omitted) p[7] = [n.omitted];
    return p;
  };
  return one(root);
}

/** A packed tree back into nodes, with `up` links and `omitted` counts. */
export function unpack(p: Packed, up?: Node): Node {
  const [name, dir, alloc, size, files, mtime, kind, kids] = p;
  const n: Node = { name, dir: dir === 1, alloc, size, files: files < 0 ? 0 : files, mtime, up, ...(files < 0 && { rest: -files }) };
  if (n.dir) {
    n.kids = [];
    // The dominant kind alone comes back: enough to colour the box.
    if (kind >= 0 && alloc > 0) { n.kinds = new Array(KINDS.length).fill(0); n.kinds[kind] = alloc; }
    n.done = mtime;
    for (const k of kids ?? []) { if (typeof k === "number") n.omitted = k; else n.kids.push(unpack(k, n)); }
  }
  return n;
}

/** Packs within `bytes` of JSON: the budget shrinks by a quarter from `start` until it fits (a packed node is 50 to 70 bytes). */
export function packWithin(root: Node, bytes: number, start = 2000): Packed {
  let budget = start;
  for (;;) {
    const p = pack(root, budget);
    if (budget <= 2 || JSON.stringify(p).length <= bytes) return p;
    budget = Math.floor(budget * 0.75);
  }
}

// ---- queries over a tree ------------------------------------------------------

/** The `n` largest files under `root` (a `rest` node is not a file), biggest first. */
export function largestFiles(root: Node, n: number): Node[] {
  let top: Node[] = [];
  let floor = 0;
  const visit = (x: Node) => {
    if (!x.dir) {
      if (x.rest || x.alloc < floor) return;
      top.push(x);
      if (top.length >= 2 * n) { top.sort((a, b) => b.alloc - a.alloc); top.length = n; floor = top[n - 1].alloc; }
      return;
    }
    x.kids?.forEach(visit);
  };
  visit(root);
  top.sort((a, b) => b.alloc - a.alloc);
  return top.slice(0, n);
}

/** The `n` largest directories under `root` (the root itself aside), biggest first. */
export function largestDirs(root: Node, n: number): Node[] {
  const all: Node[] = [];
  const visit = (x: Node) => { if (x !== root && x.dir) all.push(x); x.kids?.forEach(visit); };
  visit(root);
  return all.sort((a, b) => b.alloc - a.alloc).slice(0, n);
}

/** Directories named `name` under `root`, the outermost only (a node_modules inside another is that one's), biggest first. */
export function dirsNamed(root: Node, name: string, keep: (n: Node) => boolean = () => true): Node[] {
  const out: Node[] = [];
  const visit = (x: Node) => {
    if (x.dir && x !== root && x.name === name) { if (keep(x)) out.push(x); return; }
    x.kids?.forEach(visit);
  };
  visit(root);
  return out.sort((a, b) => b.alloc - a.alloc);
}
