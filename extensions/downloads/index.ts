// Downloads: a live palette over ~/Downloads (the `folder` setting) and
// the browsers' own download folders when they differ, newest first,
// each row with its size, kind glyph or a 64 px thumbnail (images and
// PDFs, made once by `sips` or ImageMagick and cached), and its age; a
// file still coming in (`.crdownload`, `.part`, `.download`) leads the
// list under Downloading with its size growing between listings as a
// rate, or Safari's own percentage. Sections Today, Yesterday, This week,
// Older. Enter opens, cmd+Enter reveals, cmd+c copies the file, cmd+shift+c
// its path, cmd+d moves to the Trash (asks first), cmd+m moves it to a
// folder (a form), cmd+shift+r renames it to the name typed in the bar
// (a form when blank); open, reveal, the
// copies and the trash take marked rows. The last rows clear what is
// older than 30 days and open the folder; the root's Now section gets
// the newest download of the last ten minutes (`suggest`).
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { bytes, errorMessage, files, hint as hintRow, home, run, settings, tilde, toast, when, type Action, type Arg, type Ctx, type Detail, type Effect, type Extension, type Item } from "@zcag/pal";
import { browserDirsFrom, finalName, GLYPH, inProgress, kindOf, olderThan, rate, safariProgress, sectionOf, SUGGEST_MS, THUMBABLE, type Kind, type Section } from "./scan.ts";

/** `[extensions.downloads]`, defaults in pal.json. */
type Settings = { folder: string; browser_folders: boolean; limit: number; thumbnails: boolean; clear_days: number };

const MAC = process.platform === "darwin";
const HOME = home("~");
const OPEN_FOLDER_ICON = "\u{f0770}"; // md-folder_open
const BROOM = "\u{f00e2}"; // md-broom
const DOWNLOAD = "\u{f01da}"; // md-download
/** Thumbnails are made for the newest rows only; the rest get them on a later listing as the cache fills. */
const THUMBS_PER_LISTING = 24;
const THUMB_PX = 64;
const THUMB_MS = 4000;
/** Thumbnail processes at once: ImageMagick takes 0.1 to 0.8 s per camera-sized file on Linux (sips 20 ms), so a cold listing of 24 ran 5 s in a row. */
const THUMB_JOBS = 4;

const S = () => settings.get<Settings>();

// ---- folders ------------------------------------------------------------------------

let browserDirs: Promise<string[]> | undefined;

/** The browsers' download folders (read once per process), those that exist. */
async function browserFolders(): Promise<string[]> {
  browserDirs ??= (async () => {
    const chrome = MAC ? ["Google/Chrome", "Google/Chrome Beta", "Chromium", "BraveSoftware/Brave-Browser", "Microsoft Edge", "Vivaldi", "Arc/User Data"].map((d) => `${HOME}/Library/Application Support/${d}/Default/Preferences`) : ["google-chrome", "chromium", "BraveSoftware/Brave-Browser", "microsoft-edge", "vivaldi"].map((d) => `${process.env.XDG_CONFIG_HOME || `${HOME}/.config`}/${d}/Default/Preferences`);
    const ffRoot = MAC ? `${HOME}/Library/Application Support/Firefox/Profiles` : `${HOME}/.mozilla/firefox`;
    const firefox = await readdir(ffRoot).then((ps) => ps.map((p) => join(ffRoot, p, "prefs.js"))).catch(() => [] as string[]);
    const read = (ps: string[]) => Promise.all(ps.map((p) => readFile(p, "utf8").catch(() => undefined))).then((ts) => ts.filter((t): t is string => t !== undefined));
    const found = browserDirsFrom({ chromePrefs: await read(chrome), firefoxPrefs: await read(firefox) });
    const exists = await Promise.all(found.map((d) => stat(home(d)).then((s) => s.isDirectory()).catch(() => false)));
    return found.filter((_, i) => exists[i]).map(home);
  })();
  return browserDirs;
}

async function folders(s: Settings): Promise<string[]> {
  const main = home(s.folder?.trim() || "~/Downloads");
  const extra = s.browser_folders ? (await browserFolders()).filter((d) => d !== main) : [];
  return [main, ...extra];
}

// ---- scanning -------------------------------------------------------------------------

type Entry = { path: string; name: string; dir: boolean; size: number; mtime: number; partial: boolean; kind: Kind; folder: string };

/** The entries of one folder, dotfiles skipped, newest first is the caller's sort. */
async function scan(folder: string): Promise<Entry[]> {
  const names = await readdir(folder).catch(() => [] as string[]);
  const out = await Promise.all(names.filter((n) => !n.startsWith(".")).map(async (name): Promise<Entry | undefined> => {
    const path = join(folder, name);
    const st = await stat(path).catch(() => undefined);
    if (!st) return;
    const partial = inProgress(name);
    return { path, name, dir: st.isDirectory(), size: st.size, mtime: Math.round(st.mtimeMs), partial, kind: partial ? "file" : kindOf(name, st.isDirectory()), folder };
  }));
  return out.filter((e): e is Entry => e !== undefined);
}

async function all(s: Settings): Promise<{ entries: Entry[]; folders: string[] }> {
  const fs = await folders(s);
  const entries = (await Promise.all(fs.map(scan))).flat().sort((a, b) => b.mtime - a.mtime);
  return { entries: entries.slice(0, Math.max(1, s.limit || 200)), folders: fs };
}

// ---- progress of a partial file ---------------------------------------------------------

/** The size and time a partial was last seen at, so the next listing can say how fast it grows. */
const seen = new Map<string, { size: number; at: number }>();

async function progress(e: Entry): Promise<string> {
  const now = Date.now();
  if (e.dir && e.name.toLowerCase().endsWith(".download")) {
    // Safari: a bundle with the bytes and the total in its plist.
    const p = safariProgress(await readFile(join(e.path, "Info.plist"), "utf8").catch(() => ""));
    if (p) return `${Math.min(100, Math.round((p.done / p.total) * 100))}% · ${bytes(p.done)} of ${bytes(p.total)}`;
  }
  const prev = seen.get(e.path);
  seen.set(e.path, { size: e.size, at: now });
  const r = prev ? rate(prev.size, e.size, now - prev.at) : undefined;
  return r ? `${bytes(e.size)} · ${r}` : bytes(e.size);
}

// ---- thumbnails ------------------------------------------------------------------------

const CACHE = process.env.PAL_DOWNLOADS_CACHE || (MAC ? `${HOME}/Library/Caches/pal/downloads` : `${process.env.XDG_CACHE_HOME || `${HOME}/.cache`}/pal/downloads`);
const thumbs = new Map<string, string>();
const THUMB_TOOL: string[] | undefined = MAC && Bun.which("sips") ? ["sips"] : Bun.which("magick") ? ["magick"] : Bun.which("convert") ? ["convert"] : undefined;

/**
 * ImageMagick decodes a JPEG at a fraction of its size when told the
 * target up front (`jpeg:size`, libjpeg's DCT scaling: 316 to 105 ms on a
 * 9.6 MB photo on marko), and a transparent page or PNG is laid on white
 * before the JPEG drops the alpha (a PDF's first page came out as a black
 * square without it).
 */
const thumbArgv = (tool: string, src: string, out: string): string[] =>
  tool === "sips" ? ["sips", "-Z", String(THUMB_PX), "-s", "format", "jpeg", "-s", "formatOptions", "70", src, "--out", out] : [tool, "-define", `jpeg:size=${THUMB_PX * 2}x${THUMB_PX * 2}`, `${src}[0]`, "-thumbnail", `${THUMB_PX}x${THUMB_PX}`, "-background", "white", "-alpha", "remove", "-alpha", "off", "-quality", "70", out];

let running = 0;
const waiting: (() => void)[] = [];
/** Runs `f` with at most THUMB_JOBS in flight. */
async function pooled<T>(f: () => Promise<T>): Promise<T> {
  if (running >= THUMB_JOBS) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await f(); } finally { running--; waiting.shift()?.(); }
}

/** A 64 px JPEG of the file as a data url, made once per (path, size, mtime) into the cache directory; undefined when it cannot be made. */
async function thumbnail(e: Entry): Promise<string | undefined> {
  if (!THUMB_TOOL || e.dir || !THUMBABLE.has(extname(e.name).slice(1).toLowerCase())) return;
  const key = createHash("sha1").update(`${e.path}|${e.size}|${e.mtime}`).digest("hex");
  const hit = thumbs.get(key);
  if (hit) return hit;
  const file = join(CACHE, `${key}.jpg`);
  let bytes = await readFile(file).catch(() => undefined);
  if (!bytes) {
    await mkdir(CACHE, { recursive: true });
    await pooled(async () => {
      const proc = Bun.spawn(thumbArgv(THUMB_TOOL[0], e.path, file), { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
      const timer = setTimeout(() => proc.kill(), THUMB_MS);
      await proc.exited;
      clearTimeout(timer);
    });
    bytes = await readFile(file).catch(() => undefined);
    if (!bytes) return;
  }
  const url = `data:image/jpeg;base64,${bytes.toString("base64")}`;
  if (thumbs.size > 500) thumbs.clear();
  thumbs.set(key, url);
  return url;
}

// ---- rows ----------------------------------------------------------------------------

const OPEN: Action = { id: "open", title: "Open", multi: true };
const REVEAL: Action = { id: "reveal", title: MAC ? "Reveal in Finder" : "Show in file manager", multi: true };
const QUICK_LOOK: Action = { id: "quick-look", title: "Quick Look", shortcut: "cmd+y" };
const COPY_FILE: Action = { id: "copy-file", title: "Copy file", shortcut: "cmd+c", multi: true };
const COPY_PATH: Action = { id: "copy-path", title: "Copy path", shortcut: "cmd+shift+c", multi: true };
const MOVE: Action = { id: "move", title: "Move to folder…", shortcut: "cmd+m" };
const RENAME: Action = { id: "rename", title: "Rename", shortcut: "cmd+shift+r", args: true };
/** The row's one field in the bar, a new name; only Rename reads it, and blank falls back to the form with the current name filled. */
const RENAME_ARGS: Arg[] = [{ id: "name", placeholder: "Rename to" }];
const TRASH: Action = { id: "trash", title: "Move to Trash", shortcut: "cmd+d", style: "destructive", confirm: "Move this to the Trash?", multi: true };
const FILE_ACTIONS: Action[] = [OPEN, REVEAL, ...(MAC ? [QUICK_LOOK] : []), COPY_FILE, COPY_PATH, MOVE, RENAME, TRASH];
const PARTIAL_ACTIONS: Action[] = [REVEAL, COPY_PATH];

const hint = (name: string, subtitle: string): Item => hintRow(name, name, subtitle);

async function item(e: Entry, several: boolean, thumb: boolean, section?: Section): Promise<Item> {
  const icon = (thumb && (await thumbnail(e))) || (MAC && e.name.endsWith(".app") ? { app: e.path } : GLYPH[e.kind]);
  const where = several ? ` · ${tilde(e.folder)}` : "";
  const label = (k: Kind, name: string) => (k === "file" ? extname(name).slice(1).toUpperCase() || "File" : k[0].toUpperCase() + k.slice(1));
  if (e.partial) {
    const done = finalName(e.name) || e.name;
    return { id: e.path, name: done, subtitle: `${label(kindOf(done, false), done)}${where}`, icon: DOWNLOAD, keywords: [e.name], section: "Downloading", accessories: [{ tag: "downloading", color: "blue" }, { text: await progress(e) }], actions: PARTIAL_ACTIONS };
  }
  const kind = label(e.kind, e.name);
  return {
    id: e.path, name: e.name, subtitle: `${kind}${where}`, icon: typeof icon === "string" && icon.startsWith("data:") ? { image: icon } : icon, keywords: [e.name],
    section: section ?? sectionOf(e.mtime),
    accessories: [...(e.dir ? [] : [{ text: bytes(e.size) }]), { date: e.mtime }],
    args: RENAME_ARGS,
    // No actions of its own: the palette's (`FILE_ACTIONS`, said once), so
    // eight objects do not ride on every row of every listing and show.
  };
}

async function list(): Promise<Item[]> {
  const s = S();
  const { entries, folders: fs } = await all(s);
  const several = fs.length > 1;
  // Every row at once: the thumbnails (the newest THUMBS_PER_LISTING) go through the pool.
  const rows = await Promise.all(entries.map((e, i) => item(e, several, s.thumbnails !== false && i < THUMBS_PER_LISTING)));
  // Downloading first, then the sections as the newest-first order lays them out.
  rows.sort((a, b) => Number(b.section === "Downloading") - Number(a.section === "Downloading"));
  const old = olderThan(entries.filter((e) => !e.partial), s.clear_days || 30);
  const tail: Item[] = [];
  if (old.length) tail.push({ id: "clear-old", name: `Clear older than ${s.clear_days || 30} days`, subtitle: `${old.length} ${old.length === 1 ? "item" : "items"}, ${bytes(old.reduce((n, e) => n + e.size, 0))}, to the Trash`, icon: BROOM, section: "Folder", actions: [{ id: "clear-old", title: "Move them to the Trash", style: "destructive", confirm: `Move ${old.length} ${old.length === 1 ? "item" : "items"} older than ${s.clear_days || 30} days to the Trash?` }] });
  tail.push({ id: "open-folder", name: "Open Downloads", subtitle: fs.map(tilde).join(", "), icon: OPEN_FOLDER_ICON, section: "Folder", actions: [{ id: "open-folder", title: "Open the folder" }] });
  if (!rows.length) return [hint("Nothing downloaded", `${fs.map(tilde).join(", ")} ${fs.length > 1 ? "are" : "is"} empty`), ...tail];
  return [...rows, ...tail];
}

/** The newest finished download of the last ten minutes, for the root's Now section. */
async function suggest(): Promise<Item[]> {
  const s = S();
  const { entries, folders: fs } = await all(s);
  const e = entries.find((x) => !x.partial && Date.now() - x.mtime < SUGGEST_MS);
  if (!e) return [];
  const row = await item(e, fs.length > 1, s.thumbnails !== false);
  return [{ ...row, name: `Downloaded: ${e.name}`, section: undefined }];
}

// ---- detail ----------------------------------------------------------------------------

/** The url the file came from (Spotlight's `kMDItemWhereFroms`, what the browser stamps). */
async function whereFrom(path: string): Promise<string[]> {
  if (!MAC) return [];
  const proc = Bun.spawn(["mdls", "-name", "kMDItemWhereFroms", "-raw", path], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const text = await new Response(proc.stdout).text().catch(() => "");
  return [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).filter((u) => /^https?:/.test(u));
}

async function detail(path: string): Promise<Detail> {
  const st = await stat(path).catch(() => undefined);
  if (!st) return { markdown: "This file is gone.", metadata: [{ label: "Path", value: tilde(path) }] };
  const from = await whereFrom(path);
  const k = kindOf(basename(path), st.isDirectory());
  return {
    metadata: [
      { label: "Name", value: basename(path) },
      { label: "Folder", value: tilde(dirname(path)) },
      ...(st.isDirectory() ? [] : [{ label: "Size", value: bytes(st.size) }]),
      { label: "Kind", value: k === "file" ? extname(path).slice(1).toUpperCase() || "File" : k[0].toUpperCase() + k.slice(1) },
      { label: "Modified", value: when(st.mtimeMs) },
      ...(from.length ? [{ label: "From", link: { text: from[0].replace(/^https?:\/\//, "").slice(0, 80), href: from[0] } }] : []),
      ...(from.length > 1 ? [{ label: "Page", link: { text: from[1].replace(/^https?:\/\//, "").slice(0, 80), href: from[1] } }] : []),
    ],
  };
}

// ---- actions ----------------------------------------------------------------------------

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

/** Finder's delete (macOS) or `gio trash`; `PAL_DOWNLOADS_TRASH` names a stand-in taking the path (the tests). */
const trash = (p: string) => run(process.env.PAL_DOWNLOADS_TRASH ? [process.env.PAL_DOWNLOADS_TRASH, p] : MAC ? ["osascript", "-e", `tell application "Finder" to delete POSIX file ${JSON.stringify(p)}`] : ["gio", "trash", "--", p]);

const failure = (title: string, e: unknown): Effect => toast(title, errorMessage(e), "failure");

async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect> {
  const s = S();
  if (id === "open-folder") return { open: (await folders(s))[0] };
  if (id === "clear-old") {
    const old = olderThan((await all(s)).entries.filter((e) => !e.partial), s.clear_days || 30);
    let n = 0;
    try { for (const e of old) { await trash(e.path); n++; } } catch (e) { return failure(`Moved ${n} to the Trash, then failed`, e); }
    return { keep: true, toast: { title: "Moved to Trash", message: `${n} ${n === 1 ? "item" : "items"} older than ${s.clear_days || 30} days` } };
  }
  const ids = ctx?.ids ?? [id];
  switch (action) {
    case "reveal": spawnDetached(MAC ? ["open", "-R", ...ids] : ["xdg-open", dirname(id)]); return { hide: true };
    case "quick-look": spawnDetached(["qlmanage", "-p", id]); return { hide: true };
    case "copy-file": return { copy_files: ids };
    case "copy-path": return { copy: ids.join("\n") };
    // The bar's name; blank (or a pick without values) is the form with the current name filled, as `rename-submit` (the form's submit) comes back.
    case "rename": return String(ctx?.values?.name ?? "").trim() ? files.renamePick(id, ctx?.values) : { form: files.renameForm(id) };
    case "move": return { form: files.moveForm(id) };
    case "rename-submit": return files.renamePick(id, ctx?.values);
    case "move-submit": return files.intoFolderPick("move", id, ctx?.values);
    case "trash": {
      let n = 0;
      try { for (const p of ids) { await trash(p); n++; } } catch (e) { return failure(n ? `Moved ${n} to the Trash, then failed` : "Could not move to Trash", e); }
      return { keep: true, toast: { title: "Moved to Trash", message: ids.length === 1 ? basename(id) : `${ids.length} items` } };
    }
    default:
      for (const p of ids.slice(1)) spawnDetached([MAC ? "open" : "xdg-open", p]);
      return { open: id };
  }
}

export default {
  palettes: {
    downloads: {
      title: "Downloads",
      // Newest first is the order, listed again on every show so a finished download is there.
      live: true,
      multi: true,
      placeholder: "Search downloads",
      actions: FILE_ACTIONS,
      list,
      pick,
      detail,
      suggest,
    },
  },
} satisfies Extension;
