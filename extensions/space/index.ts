// Disk Space: a big file finder and cleanup. `space` lists where to look
// (home, the volumes, the folders scanned before, a typed one); Enter
// pushes `map`, a view palette drawing the root's tree as a zoomable
// treemap (render.ts over scan.ts, the layout in layout.ts). A scan runs
// in this extension's own worker of the host, breadth-parallel over the
// file system, and the map is pushed live every 250 ms while it runs;
// when it lands the tree is packed into storage (the biggest nodes, under
// a size cut), so the next open draws at once and Rescan is explicit. A
// zoom into a folder the saved tree cut rescans that folder alone.
// `largest`, `folders` and `cleanup` are lists over the same trees.
import { readdir, lstat, statfs } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { ago, bytes, exec, failed, hint, home, now, run, settings, storage, tilde, toast, view, type Action, type Ctx, type Effect, type Extension, type Item, type LinkParams, type Metadata } from "@zcag/pal";
import { render, children, move, rootLabel, type Colour, type MapState, type Sizes } from "./render.ts";
import { GLYPH, ICON, fileRow, folderRow, suggestionRow, type Suggestion } from "./rows.ts";
import { KIND_LABEL, chain, count, detach, dirsNamed, find, kindOf, largestDirs, largestFiles, packWithin, pathOf, pct, rootNode, unpack, walk, type Kind, type Node, type Packed, type Progress } from "./scan.ts";

type Settings = { sizes: Sizes; colour: Colour; cross_devices: boolean; largest: number; stale_days: number };
const S = () => settings.get<Settings>();

const MAC = process.platform === "darwin";
const HOME = home("~");
/** How often the live map is pushed while a scan runs. */
const PUSH_MS = 250;
/** Roots kept in storage, and what each one's packed tree may weigh (the file is capped at 256 KB). */
const KEEP_ROOTS = 4;
const PACK_BYTES = 56_000;
/** A cleanup measurement is reused for this long. */
const MEASURE_TTL = 10 * 60_000;
/** A listing waits this long for the cleanup measurements before showing what it has. */
const MEASURE_WAIT = 4000;

/** A push into one of this extension's palettes. */
const pushTo = (palette: string, args?: unknown, title?: string): Effect => ({ push: { extension: "space", palette, ...(args !== undefined && { args }), ...(title !== undefined && { title }) } });

// ---- scans -------------------------------------------------------------------

type Scan = {
  root: string;
  tree: Node;
  started: number;
  /** When the whole tree last landed (a subtree rescan keeps it). */
  finished?: number;
  /** How long the last full scan took. */
  ms?: number;
  /** Set while a walk runs. */
  progress?: Progress;
  signal: { cancelled: boolean };
  denied: number;
  /** From storage: only the biggest nodes are here. */
  partial?: boolean;
};
type Stored = { at: number; ms: number; files: number; dirs: number; alloc: number; size: number; denied: number; tree: Packed };
type Ui = { dir: string; focus: number; marked: Set<string>; animate?: boolean };

const scans = new Map<string, Scan>();
const uis = new Map<string, Ui>();
let lastRoot: string | undefined;

/** A root as it is keyed: `~` expanded, absolute, no trailing slash (but `/`). */
export const normRoot = (p: string): string => { const r = resolve(home(p.trim() || "~")); return r.length > 1 ? r.replace(/\/+$/, "") : r; };

const roots = async (): Promise<Record<string, Stored>> => (await storage.get<Record<string, Stored>>("roots")) ?? {};

/** The scan of `root`: in memory, else from storage (partial), else none. */
async function load(root: string): Promise<Scan | undefined> {
  const have = scans.get(root);
  if (have) return have;
  const st = (await roots())[root];
  if (!st) return;
  const sc: Scan = { root, tree: unpack(st.tree), started: st.at, finished: st.at, ms: st.ms, signal: { cancelled: false }, denied: st.denied, partial: true };
  scans.set(root, sc);
  return sc;
}

async function persist(sc: Scan): Promise<void> {
  const all = await roots();
  all[sc.root] = { at: sc.finished ?? now(), ms: sc.ms ?? 0, files: sc.tree.files, dirs: 0, alloc: sc.tree.alloc, size: sc.tree.size, denied: sc.denied, tree: packWithin(sc.tree, PACK_BYTES) };
  const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP_ROOTS);
  await storage.set("roots", Object.fromEntries(keep)).catch((e) => console.error(`space: could not save the scan: ${e}`));
}

const ui = (root: string): Ui => { let u = uis.get(root); if (!u) { u = { dir: root, focus: 0, marked: new Set() }; uis.set(root, u); } return u; };

function stateOf(sc: Scan, compact?: boolean): MapState {
  const u = ui(sc.root);
  const s = S();
  const dir = find(sc.tree, u.dir) ?? sc.tree;
  if (dir !== sc.tree && !find(sc.tree, u.dir)) { u.dir = sc.root; u.focus = 0; }
  const n = children(dir, s.sizes).length;
  if (u.focus >= n) u.focus = Math.max(0, n - 1);
  const st: MapState = { root: sc.tree, dir, focus: u.focus, marked: u.marked, sizes: s.sizes, colour: s.colour, scanning: sc.progress, scannedAt: sc.finished, partial: sc.partial, denied: sc.denied, compact, mac: MAC, now: now(), animate: u.animate };
  u.animate = false;
  return st;
}

/** The map of `root` into its open level, if one is. */
function push(root: string): void {
  const sc = scans.get(root);
  const open = view.open("space").some((v) => v.palette === "map" && v.id === root);
  if (!sc || !open) return;
  view.update(render(stateOf(sc, view.open("space").some((v) => v.id === root && v.compact))), { palette: "map", id: root }).catch((e) => console.error(`space: push: ${e}`));
}

/**
 * Scans `root` whole (a new tree), or `node`'s subtree in place (a zoom
 * into a folder the saved tree cut, a rescan of one folder). One walk per
 * root at a time: a second request stops the first.
 */
function startScan(root: string, node?: Node): Scan {
  let sc = scans.get(root);
  if (sc?.progress) sc.signal.cancelled = true;
  if (!sc || !node) {
    const tree = sc && node ? sc.tree : rootNode(root);
    sc = { root, tree, started: now(), signal: { cancelled: false }, denied: 0, finished: undefined };
    scans.set(root, sc);
    node = tree;
  } else sc.signal = { cancelled: false };
  const me = sc, target = node, t0 = now();
  const whole = target === me.tree;
  me.progress = { files: 0, dirs: 0, alloc: 0, size: 0, denied: 0, current: root };
  let last = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const tick = (p: Progress) => {
    me.progress = p;
    const due = PUSH_MS - (Date.now() - last);
    if (due <= 0) { last = Date.now(); push(root); }
    else timer ??= setTimeout(() => { timer = undefined; last = Date.now(); push(root); }, due);
  };
  walk(target, whole ? root : pathOf(target), { crossDevices: S().cross_devices, onProgress: tick, signal: me.signal }).then(async (p) => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (me.signal.cancelled) { me.progress = undefined; push(root); return; }
    me.progress = undefined;
    me.denied = whole ? p.denied : me.denied + p.denied;
    if (whole) { me.finished = now(); me.ms = now() - t0; me.partial = false; }
    else if (target.omitted) target.omitted = 0;
    console.error(`space: scanned ${tilde(whole ? root : pathOf(target))}: ${count(p.files)}, ${bytes(p.alloc)} in ${now() - t0} ms${p.denied ? `, ${p.denied} unreadable` : ""}`);
    push(root);
    await persist(me);
  }).catch((e) => { me.progress = undefined; console.error(`space: scan of ${root} failed: ${e}`); push(root); });
  return sc;
}

/** The scan to draw for `root`: what is there, else a fresh one started now. */
async function ensure(root: string, rescan = false): Promise<Scan> {
  lastRoot = root;
  const have = await load(root);
  if (have && !rescan) return have;
  return startScan(root);
}

// ---- the file actions ---------------------------------------------------------

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
/** Finder's delete (macOS) or `gio trash`; `PAL_SPACE_TRASH` names a stand-in taking the path (the tests). */
const trashOne = (p: string) => run(process.env.PAL_SPACE_TRASH ? [process.env.PAL_SPACE_TRASH, p] : MAC ? ["osascript", "-e", `tell application "Finder" to delete POSIX file ${JSON.stringify(p)}`] : ["gio", "trash", "--", p]);

/** Trashes `paths`, takes them out of every tree that holds them, saves. The effect names what went. */
async function trashPaths(paths: string[], what = ""): Promise<Effect & { trashed: number; freed: number }> {
  let freed = 0, n = 0;
  for (const p of paths) {
    try { await trashOne(p); } catch (e) { return { ...failed("move to Trash", e), trashed: n, freed }; }
    n++;
    for (const sc of scans.values()) {
      const node = find(sc.tree, p);
      if (!node) continue;
      freed = Math.max(freed, node.alloc);
      detach(node);
      void persist(sc);
    }
  }
  return { ...toast("Moved to Trash", what || (n === 1 ? basename(paths[0]) : `${n} items`)), trashed: n, freed };
}

async function owner(path: string): Promise<string | undefined> {
  const st = await lstat(path).catch(() => undefined);
  if (!st) return;
  const r = await exec(["id", "-un", String(st.uid)], { ms: 1000 }).catch(() => undefined);
  return r?.code === 0 ? r.out.trim() : String(st.uid);
}

const infoOf = async (n: Node): Promise<Effect> => {
  const path = pathOf(n);
  const metadata: Metadata[] = [
    { label: "Kind", value: KIND_LABEL[kindOf(n)] },
    { label: "Path", value: tilde(path) },
    { label: "On disk", value: bytes(n.alloc) },
    { label: "Apparent", value: bytes(n.size) },
    ...(n.dir ? [{ label: "Files", value: n.files.toLocaleString("en-US") }, { label: "Items", value: `${(n.kids?.length ?? 0).toLocaleString("en-US")}${n.omitted ? ` shown of more (rescan for all)` : ""}` }] : []),
    ...(n.up ? [{ label: "Share of parent", value: pct(n.alloc, n.up.alloc) }] : []),
    ...(n.mtime ? [{ label: "Modified", value: `${new Date(n.mtime).toISOString().slice(0, 16).replace("T", " ")} (${ago(n.mtime)})` }] : []),
  ];
  const who = await owner(path);
  if (who) metadata.push({ label: "Owner", value: who });
  return { show: { title: n.name, metadata } };
};

/** A pick on a path row shared by the lists; `ids` are every marked row of a multi pick. */
async function pathAction(path: string, action: string | undefined, ids: string[], root: string): Promise<Effect> {
  switch (action) {
    case "reveal": spawnDetached(MAC ? ["open", "-R", ...ids] : ["xdg-open", dirname(path)]); return { hide: true };
    case "look": spawnDetached(["qlmanage", "-p", path]); return { hide: true };
    case "copy": return { copy: ids.join("\n") };
    case "largest": return pushTo("largest", { root: path }, `Largest in ${basename(path)}`);
    case "map": {
      const sc = await load(root);
      const node = sc && find(sc.tree, path);
      const u = ui(root);
      if (node?.dir) { u.dir = path; u.focus = 0; }
      else if (node) { u.dir = dirname(path); u.focus = Math.max(0, children(node.up!, S().sizes).indexOf(node)); }
      return pushTo("map", { root }, rootLabel(root));
    }
    case "info": { const sc = await load(root); const n = sc && find(sc.tree, path); return n ? infoOf(n) : toast("Not in the scan", tilde(path), "failure"); }
    case "trash": return trashPaths(ids);
    default: for (const p of ids.slice(1)) spawnDetached([MAC ? "open" : "xdg-open", p]); return { open: path };
  }
}

// ---- the roots palette -----------------------------------------------------------

type Volume = { path: string; name: string; free: number; total: number };

/** The mounted volumes: `/` and `/Volumes/*` on macOS (the symlink to `/` aside), `/`, `/home` and the media mounts on Linux; each with its free space. */
async function volumes(): Promise<Volume[]> {
  const out: Volume[] = [];
  const seen = new Set<number>();
  const one = async (path: string, name: string) => {
    const st = await lstat(path).catch(() => undefined);
    if (!st?.isDirectory() || seen.has(st.dev)) return;
    seen.add(st.dev);
    const fs = await statfs(path).catch(() => undefined);
    if (!fs) return;
    out.push({ path, name, free: fs.bavail * fs.bsize, total: fs.blocks * fs.bsize });
  };
  if (MAC) {
    await one("/", "Macintosh HD");
    for (const n of (await readdir("/Volumes").catch(() => [] as string[])).sort()) await one(join("/Volumes", n), n);
  } else {
    await one("/", "Root");
    await one("/home", "Home");
    for (const base of ["/mnt", `/media/${process.env.USER ?? ""}`, `/run/media/${process.env.USER ?? ""}`]) for (const n of (await readdir(base).catch(() => [] as string[])).sort()) await one(join(base, n), n);
  }
  return out;
}

const ROOT_ACTIONS: Action[] = [
  { id: "map", title: "Open the map" },
  { id: "largest", title: "Largest files" },
  { id: "folders", title: "Largest folders", shortcut: "cmd+shift+l" },
  { id: "rescan", title: "Scan again", shortcut: "cmd+shift+r" },
];
const FORGET: Action = { id: "forget", title: "Forget the saved scan", shortcut: "cmd+shift+d", style: "destructive", confirm: "Forget this scan? The folder itself is untouched." };

async function rootRows(): Promise<Item[]> {
  const saved = await roots();
  const vols = await volumes();
  const scanned = (path: string): { subtitle?: string; accessories: Item["accessories"] } => {
    const sc = scans.get(path), st = saved[path];
    const at = sc?.finished ?? st?.at, alloc = sc?.tree.alloc ?? st?.alloc, files = sc?.tree.files ?? st?.files;
    if (sc?.progress) return { subtitle: `Scanning… ${count(sc.progress.files)}, ${bytes(sc.progress.alloc)}`, accessories: [{ tag: "scanning", color: "blue" }] };
    if (at === undefined) return { accessories: [{ tag: "not scanned", color: "grey" }] };
    return { subtitle: `${bytes(alloc ?? 0)} in ${count(files ?? 0)}, scanned ${ago(at)}`, accessories: [{ text: bytes(alloc ?? 0) }, { date: at }] };
  };
  const rows: Item[] = [];
  const homeInfo = scanned(HOME);
  rows.push({ id: `root:${HOME}`, name: "Home", subtitle: homeInfo.subtitle ?? tilde(HOME), icon: "\u{f02dc}", keywords: ["~", "home"], accessories: homeInfo.accessories, actions: [...ROOT_ACTIONS, ...(saved[HOME] ? [FORGET] : [])] });
  for (const v of vols) {
    const info = scanned(v.path);
    rows.push({ id: `root:${v.path}`, name: v.name, subtitle: info.subtitle ?? `${bytes(v.free)} free of ${bytes(v.total)}`, icon: ICON, keywords: ["volume", "disk"], accessories: [{ text: `${bytes(v.free)} free` }, ...(info.accessories ?? [])], actions: [...ROOT_ACTIONS, ...(saved[v.path] ? [FORGET] : [])] });
  }
  const others = [...new Set([...Object.keys(saved), ...scans.keys()])].filter((p) => p !== HOME && !vols.some((v) => v.path === p)).sort((a, b) => (saved[b]?.at ?? 0) - (saved[a]?.at ?? 0));
  for (const p of others) rows.push({ id: `root:${p}`, name: tilde(p), subtitle: scanned(p).subtitle, icon: GLYPH.folder, keywords: [basename(p)], accessories: scanned(p).accessories, actions: [...ROOT_ACTIONS, FORGET], section: "Scanned before" });
  rows.push({ id: "scan", name: "Scan a folder…", subtitle: "Type the path", icon: "\u{f0256}", args: [{ id: "path", placeholder: "Folder (~/proj)", required: true }], actions: [{ id: "map", title: "Open the map" }, { id: "largest", title: "Largest files" }] });
  rows.push({ id: "cleanup", name: "Cleanup suggestions", subtitle: "Caches, stale build folders, old downloads, the Trash", icon: "\u{f0a7a}", actions: [{ id: "open", title: "Open" }] });
  return rows;
}

async function rootPick(id: string, action: string | undefined, ctx?: Ctx): Promise<Effect> {
  if (id === "cleanup") return pushTo("cleanup");
  let root: string;
  if (id === "scan") {
    const typed = String(ctx?.values?.path ?? "").trim();
    if (!typed) return { form: { title: "Scan a folder", fields: [{ kind: "text", id: "path", label: "Folder", placeholder: "~/proj", required: true }], submit: { id: action ?? "map", title: "Scan" } } };
    root = normRoot(typed);
    const st = await lstat(root).catch(() => undefined);
    if (!st?.isDirectory()) return toast("Not a folder", tilde(root), "failure");
  } else root = id.slice(5);
  switch (action) {
    case "largest": return pushTo("largest", { root }, `Largest in ${rootLabel(root)}`);
    case "folders": return pushTo("folders", { root }, `Largest folders in ${rootLabel(root)}`);
    case "forget": { const all = await roots(); delete all[root]; await storage.set("roots", all); scans.delete(root); uis.delete(root); return toast("Forgotten", tilde(root)); }
    case "rescan": await ensure(root, true); return pushTo("map", { root }, rootLabel(root));
    default: return pushTo("map", { root }, rootLabel(root));
  }
}

// ---- the map ---------------------------------------------------------------------

type MapArgs = { root?: string };
const rootOf = (ctx?: Ctx): string => normRoot((ctx?.args as MapArgs | undefined)?.root ?? lastRoot ?? HOME);

async function mapPick(root: string, action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const sc = await load(root);
  if (!sc) return pushTo("space");
  const u = ui(root);
  const s = S();
  const st = () => stateOf(sc, ctx?.compact);
  const dir = find(sc.tree, u.dir) ?? sc.tree;
  const kids = children(dir, s.sizes);
  const reply = (): Effect => ({ view: render(st()) });
  const m = /^(box|row|crumb):(\d+)$/.exec(action ?? "");
  if (m) {
    const i = Number(m[2]);
    if (m[1] === "crumb") { const c = chain(dir)[i]; if (c) { u.focus = Math.max(0, children(c, s.sizes).indexOf(chain(dir)[i + 1])); u.dir = pathOf(c); u.animate = true; } return reply(); }
    u.focus = Math.min(i, kids.length - 1);
    if (m[1] === "row" || !kids[i]?.dir) return reply();
    action = "zoom";
  }
  const f = kids[u.focus] as Node | undefined;
  const fpath = f ? pathOf(f) : undefined;
  switch (action) {
    case "zoom": {
      if (!f) return reply();
      if (f.rest) return { ...reply(), toast: { title: "Smaller files", message: `${f.rest.toLocaleString("en-US")} files too small to show; the biggest are the boxes` } };
      if (!f.dir) return { open: fpath! };
      u.dir = fpath!; u.focus = 0; u.animate = true;
      // A folder the saved tree cut, or one never listed: read it now, the map following live.
      if (f.omitted || (f.done === undefined && !sc.progress)) startScan(root, f);
      return reply();
    }
    case "out": {
      if (!dir.up) return reply();
      u.focus = Math.max(0, children(dir.up, s.sizes).indexOf(dir)); u.dir = pathOf(dir.up); u.animate = true;
      return reply();
    }
    case "up": case "down": case "left": case "right": u.focus = move(dir, s.sizes, u.focus, action, ctx?.compact); return reply();
    case "next": u.focus = kids.length ? (u.focus + 1) % kids.length : 0; return reply();
    case "prev": u.focus = kids.length ? (u.focus - 1 + kids.length) % kids.length : 0; return reply();
    case "mark": if (fpath && !f?.rest) { if (u.marked.has(fpath)) u.marked.delete(fpath); else u.marked.add(fpath); } return reply();
    case "trash": {
      const paths = u.marked.size ? [...u.marked] : fpath && !f?.rest ? [fpath] : [];
      if (!paths.length) return reply();
      const r = await trashPaths(paths, paths.length === 1 ? basename(paths[0]) : `${paths.length} items`);
      for (const p of paths.slice(0, r.trashed)) u.marked.delete(p);
      u.focus = Math.min(u.focus, Math.max(0, children(find(sc.tree, u.dir) ?? sc.tree, s.sizes).length - 1));
      const { trashed, freed, ...eff } = r;
      return { ...eff, keep: undefined, view: render(st()) };
    }
    case "look": if (fpath && !f?.rest) spawnDetached(["qlmanage", "-p", fpath]); return { hide: true };
    case "open": return fpath && !f?.rest ? { open: fpath } : reply();
    case "reveal": if (fpath && !f?.rest) spawnDetached(MAC ? ["open", "-R", fpath] : ["xdg-open", dirname(fpath)]); return { hide: true };
    case "copy": return fpath && !f?.rest ? { copy: fpath } : reply();
    case "info": return f && !f.rest ? infoOf(f) : reply();
    case "largest": return pushTo("largest", { root: pathOf(dir) }, `Largest in ${dir.up ? dir.name : rootLabel(root)}`);
    case "colour": await settings.set("colour", s.colour === "kind" ? "depth" : "kind"); return reply();
    case "sizes": await settings.set("sizes", s.sizes === "allocated" ? "apparent" : "allocated"); return reply();
    case "stop": sc.signal.cancelled = true; return reply();
    case "rescan": startScan(root, dir === sc.tree ? undefined : dir); return reply();
    default: return reply();
  }
}

// ---- the lists ---------------------------------------------------------------------

/** A scan for the lists: the one in hand, else a hint row telling how to get one. */
async function scanFor(ctx: Ctx | undefined): Promise<{ root: string; sc?: Scan; rows?: Item[] }> {
  const root = rootOf(ctx);
  const sc = await load(root);
  if (sc) return { root, sc };
  return { root, rows: [hint("none", `${tilde(root)} is not scanned yet`, "Enter opens the map and scans it", { icon: ICON, actions: [{ id: "scan", title: "Scan it" }] })] };
}

const KIND_FILTERS = [{ id: "all", title: "All kinds" }, ...(["image", "video", "audio", "document", "archive", "disk", "code", "app", "file"] as Kind[]).map((k) => ({ id: k, title: `${KIND_LABEL[k]}s` }))];

async function largestRows(ctx?: Ctx): Promise<Item[]> {
  const { root, sc, rows } = await scanFor(ctx);
  if (!sc) return rows!;
  const s = S();
  const under = find(sc.tree, root) ?? sc.tree;
  let files = largestFiles(under, ctx?.filter && ctx.filter !== "all" ? s.largest * 10 : s.largest);
  if (ctx?.filter && ctx.filter !== "all") files = files.filter((f) => kindOf(f) === ctx.filter).slice(0, s.largest);
  if (!files.length) return [hint("empty", sc.progress ? "Scanning…" : "No files here", sc.partial ? "The saved scan keeps the biggest only; rescan for everything" : undefined, { icon: ICON })];
  const out = files.map((f) => fileRow(f, sc.root, s.sizes, MAC));
  if (sc.partial || sc.progress) out.unshift(hint("note", sc.progress ? `Scanning… ${count(sc.progress.files)} so far` : `From the scan of ${ago(sc.finished!)}`, sc.progress ? undefined : "Rescan from the map (cmd+r) for the current picture", { icon: ICON }));
  return out;
}

async function folderRows(ctx?: Ctx): Promise<Item[]> {
  const { root, sc, rows } = await scanFor(ctx);
  if (!sc) return rows!;
  const s = S();
  const under = find(sc.tree, root) ?? sc.tree;
  const dirs = largestDirs(under, s.largest);
  if (!dirs.length) return [hint("empty", sc.progress ? "Scanning…" : "No folders here", undefined, { icon: ICON })];
  return dirs.map((d) => folderRow(d, under, s.sizes, MAC));
}

/** A pick from the lists: the scan hint, or the path row's verb. */
async function listPick(id: string, action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const root = rootOf(ctx);
  if (id === "hint:none" || action === "scan") { await ensure(root); return pushTo("map", { root }, rootLabel(root)); }
  if (id.startsWith("hint:")) return { keep: true };
  const sc = await load(root);
  return pathAction(id, action, ctx?.ids ?? [id], sc?.root ?? root);
}

// ---- cleanup suggestions -----------------------------------------------------------------

type Measure = { node: Node; at: number; done: boolean; doneP?: Promise<Measure> };
const measures = new Map<string, Measure>();

/** The size of one folder, measured with the walker and kept ten minutes; `wait` ms at most for a fresh one. */
function measure(path: string, wait: number): Promise<Measure> {
  const have = measures.get(path);
  if (have && have.done && now() - have.at < MEASURE_TTL) return Promise.resolve(have);
  if (have && !have.done) return Promise.race([have.doneP!, Bun.sleep(wait).then(() => have)]);
  const node = rootNode(path);
  const m: Measure = { node, at: now(), done: false };
  m.doneP = walk(node, path).then(() => { m.done = true; m.at = now(); return m; });
  measures.set(path, m);
  return Promise.race([m.doneP, Bun.sleep(wait).then(() => m)]);
}

/** What the cleanup palette knows about: the candidate folders that exist, measured, plus the stale build folders from the scans in hand. */
async function suggestions(): Promise<Suggestion[]> {
  const s = S();
  const cands: { id: string; name: string; path: string; note: string; action: Suggestion["action"]; section: string }[] = [
    ...(MAC ? [{ id: "caches", name: "User caches", path: join(HOME, "Library/Caches"), note: "Apps rebuild what they need; a few may sign you out", action: "trash-contents" as const, section: "Caches" }] : []),
    { id: "xdg-cache", name: "Cache folder (~/.cache)", path: join(HOME, ".cache"), note: "Tools rebuild what they need", action: "trash-contents", section: "Caches" },
    ...(MAC ? [{ id: "derived", name: "Xcode DerivedData", path: join(HOME, "Library/Developer/Xcode/DerivedData"), note: "Build products; Xcode rebuilds them", action: "trash-contents" as const, section: "Caches" }] : []),
    ...(MAC ? [{ id: "simulators", name: "iOS Simulator caches", path: join(HOME, "Library/Developer/CoreSimulator/Caches"), note: "Rebuilt on the next run", action: "trash-contents" as const, section: "Caches" }] : []),
    { id: "npm", name: "npm cache", path: join(HOME, ".npm/_cacache"), note: "`npm cache clean` territory; refilled on install", action: "trash-contents", section: "Package caches" },
    { id: "bun", name: "Bun install cache", path: join(HOME, ".bun/install/cache"), note: "Refilled on install", action: "trash-contents", section: "Package caches" },
    { id: "cargo", name: "Cargo registry", path: join(HOME, ".cargo/registry"), note: "Crate sources and indexes; refetched on build", action: "trash-contents", section: "Package caches" },
    { id: "gradle", name: "Gradle caches", path: join(HOME, ".gradle/caches"), note: "Refetched on build", action: "trash-contents", section: "Package caches" },
    { id: "pip", name: "pip cache", path: join(HOME, MAC ? "Library/Caches/pip" : ".cache/pip"), note: "Refetched on install", action: "trash-contents", section: "Package caches" },
    { id: "trash", name: "Trash", path: join(HOME, MAC ? ".Trash" : ".local/share/Trash"), note: "Emptying it is final", action: "empty-trash", section: "Trash and downloads" },
    { id: "downloads", name: `Downloads older than ${s.stale_days} days`, path: join(HOME, "Downloads"), note: "By modification date", action: "trash-old", section: "Trash and downloads" },
  ];
  const present = (await Promise.all(cands.map(async (c) => ((await lstat(c.path).catch(() => undefined))?.isDirectory() ? c : undefined)))).filter((c): c is NonNullable<typeof c> => !!c);
  const measured = await Promise.all(present.map((c) => measure(c.path, MEASURE_WAIT)));
  const out: Suggestion[] = [];
  present.forEach((c, i) => {
    const m = measured[i];
    let size = m.node.alloc, files = m.node.files, targets: string[] | undefined;
    if (c.action === "trash-old") {
      const cut = now() - s.stale_days * 86400e3;
      const old = (m.node.kids ?? []).filter((k) => k.mtime < cut && !k.rest);
      size = old.reduce((t, k) => t + k.alloc, 0); files = old.length; targets = old.map(pathOf);
    }
    if (m.done && size === 0) return;
    out.push({ ...c, size, files, measuring: !m.done, targets });
  });
  // Stale build folders, from every scan in hand: the outermost node_modules, and a cargo `target` (one with a debug or release inside).
  const cut = now() - s.stale_days * 86400e3;
  const seen = new Set<string>();
  for (const sc of scans.values()) {
    for (const d of [...dirsNamed(sc.tree, "node_modules"), ...dirsNamed(sc.tree, "target", (n) => !!n.kids?.some((k) => k.dir && (k.name === "debug" || k.name === "release")))]) {
      const path = pathOf(d);
      if (seen.has(path) || d.mtime >= cut || !d.alloc) continue;
      seen.add(path);
      out.push({ id: `stale:${path}`, name: tilde(path), path, note: `Untouched ${ago(d.mtime)}; the next install or build recreates it`, size: d.alloc, files: d.files, action: "trash", section: "Stale build folders" });
    }
  }
  return out;
}

async function cleanupRows(): Promise<Item[]> {
  const sugg = await suggestions();
  const rows: Item[] = sugg.sort((a, b) => (a.section === b.section ? (b.size ?? 0) - (a.size ?? 0) : 0)).map((g) => suggestionRow(g, S().stale_days, MAC));
  const homeScanned = scans.has(HOME) || (await roots())[HOME];
  if (!homeScanned) rows.push(hint("scan-home", "Scan Home for stale node_modules and target folders", "Enter opens the map of ~ and scans it", { icon: ICON, actions: [{ id: "scan-home", title: "Scan Home" }], section: "Stale build folders" }));
  if (!rows.length) rows.push(hint("clean", "Nothing to suggest", "No caches, stale build folders or old downloads found", { icon: ICON }));
  return rows;
}

async function cleanupPick(id: string, action: string | undefined): Promise<Effect> {
  if (id === "hint:scan-home" || action === "scan-home") { await ensure(HOME); return pushTo("map", { root: HOME }, "Home"); }
  if (id.startsWith("hint:")) return { keep: true };
  const g = (await suggestions()).find((x) => x.id === id);
  if (!g) return { keep: true };
  switch (action) {
    case "reveal": spawnDetached(MAC ? ["open", "-R", g.path] : ["xdg-open", g.path]); return { hide: true };
    case "copy": return { copy: g.path };
    case "empty-trash": {
      try { await run(process.env.PAL_SPACE_TRASH ? [process.env.PAL_SPACE_TRASH, "--empty"] : MAC ? ["osascript", "-e", 'tell application "Finder" to empty trash'] : ["gio", "trash", "--empty"]); } catch (e) { return failed("empty the Trash", e); }
      measures.delete(g.path);
      return toast("Trash emptied", bytes(g.size ?? 0));
    }
    case "trash": { const r = await trashPaths([g.path]); measures.delete(g.path); return r; }
    case "trash-old": case "trash-contents": {
      const targets = g.action === "trash-old" ? g.targets ?? [] : (await readdir(g.path).catch(() => [] as string[])).map((n) => join(g.path, n));
      if (!targets.length) return toast("Nothing to trash", tilde(g.path));
      const r = await trashPaths(targets, `${count(targets.length, "item")} from ${tilde(g.path)}`);
      measures.delete(g.path);
      return r;
    }
    default: {
      // The map: a candidate folder gets a scan of its own; a stale folder shows inside its root's map.
      const root = [...scans.keys()].find((r) => g.path.startsWith(r + "/")) ?? g.path;
      await ensure(root);
      const u = ui(root);
      if (root !== g.path) { const sc = scans.get(root); const n = sc && find(sc.tree, g.path); if (n?.up) { u.dir = pathOf(n.up); u.focus = Math.max(0, children(n.up, S().sizes).indexOf(n)); } }
      return pushTo("map", { root }, rootLabel(root));
    }
  }
}

// ---- the extension -----------------------------------------------------------------

export default {
  palettes: {
    space: {
      title: "Disk Space",
      live: true,
      list: rootRows,
      pick: rootPick,
    },
    map: {
      title: "Disk Map",
      view: async (ctx) => render(stateOf(await ensure(rootOf(ctx)), ctx?.compact)),
      // The view's id is its root, so a pick reaches the right tree whichever map is open.
      pick: (id, action, ctx) => mapPick(id === "view" ? rootOf(ctx) : id, action, ctx),
    },
    largest: {
      title: "Largest Files",
      live: true,
      multi: true,
      filters: KIND_FILTERS,
      list: (_q, ctx) => largestRows(ctx),
      pick: listPick,
    },
    folders: {
      title: "Largest Folders",
      live: true,
      list: (_q, ctx) => folderRows(ctx),
      pick: listPick,
    },
    cleanup: {
      title: "Cleanup Suggestions",
      live: true,
      list: cleanupRows,
      pick: cleanupPick,
    },
  },
  link: async (route: string, params: LinkParams): Promise<Effect> => {
    const root = normRoot(String(params.root ?? (route === "largest" ? lastRoot ?? HOME : HOME)));
    const st = await lstat(root).catch(() => undefined);
    if (!st?.isDirectory()) throw new Error(`not a folder: ${tilde(root)}`);
    if (route === "largest") { lastRoot = root; return pushTo("largest", { root }, `Largest in ${rootLabel(root)}`); }
    await ensure(root, params.rescan === true);
    return pushTo("map", { root }, rootLabel(root));
  },
  dispose: () => { for (const sc of scans.values()) sc.signal.cancelled = true; },
} satisfies Extension;
