// Files: an input palette over the OS's own file index. Every keystroke
// spawns one search (the previous one is killed first), reads its output a
// line at a time until `limit` paths are in hand, kills it, and stats the
// paths for the rows. The backend is picked once at load: Spotlight
// (`mdfind`) on macOS; on Linux `fd`, else `locate`, else a bounded `find`
// (slow, and the empty-query hint says so). `PAL_FILES_BACKEND` forces one
// of them: the tests run `find` on a temp folder no index knows about.
// The empty query lists the recently used files (recent.ts: Spotlight's
// last-used date, or GTK's recently-used.xbel), which the `recent` palette
// lists on its own too, with the same rows and actions.
// Folders browse (browse.ts): Enter (or `→`) on a folder row pushes the
// `browse` palette with that folder as its args, a level whose crumb is
// the folder, led by a `..` row (`←` or Backspace from anywhere in it goes
// up) and sorted by the filter dropdown (name, date, size); `cmd+.` flips
// the `show_hidden` setting. A typed path ending in `/` lists that folder
// the same way inside Files.
// Contents too (content.ts): a query starting with `'` or `content:`
// searches what files say instead of what they are called; a plain query
// gets the content matches as a second section, "In files", under the
// name matches, each row's subtitle the first matching line. Spotlight's
// text index on macOS (`mdfind` without `-name`), `rg` else `grep` on
// Linux, 1 s at most. `PAL_FILES_CONTENT` forces a tool (the tests use
// `grep` on their temp folder).
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { apps as appsApi, conceal, dialog, home, ocr, settings, thumbnailUrl, type Action, type App, type Ctx, type Detail, type Dialog, type Effect, type Extension, type Item, type Metadata } from "@zcag/pal";
import { BROWSE_CAP, SORTS, filterEntries, hintRow, isRoot, sortEntries, upRow, type Browse, type Entry, type Sort } from "./browse.ts";
import { contentArgv, parseQuery, snippet, snippetArgv, type ContentBackend } from "./content.ts";
import { parseMdfindRecent, parseXbel, type Recent } from "./recent.ts";

/** `[extensions.files]`, defaults in pal.json. */
type Settings = { folders: string[]; limit: number; show_hidden: boolean; exclude: string[]; content_search: boolean; ocr_concealed: boolean };
/** The args of the level "Open with…" pushes: which file the rows open. */
type OpenWith = { open_with: string };
const openWithOf = (ctx?: Ctx): string | undefined => (ctx?.args as OpenWith | undefined)?.open_with;
/** The args of the level "Browse" pushes: the folder listed. */
const browseOf = (ctx?: Ctx): string | undefined => (ctx?.args as Browse | undefined)?.browse;

const HOME = home("~");
const MAC = process.platform === "darwin";
/** The extension's glyph (md-file_search_outline) and the row glyphs by kind, Material Design outlines in the bundled Nerd Font. */
const ICON = "\u{f0c7d}";
/** A search that has not produced `limit` lines by then is killed; what it printed is the answer. */
const SEARCH_MS = 3000;
/** How deep fd walks below a folder: with fewer than `limit` matches it would otherwise walk all of `~` (1.2 s on a full home). */
const FD_MAX_DEPTH = 8;
/** Finder's delete or `gio trash` waited on this long. */
const TRASH_MS = 10_000;
const TEXT_MAX = 64 * 1024;
const TEXT_LINES = 40;

// ---- backend -------------------------------------------------------------

type Backend = "mdfind" | "fd" | "locate" | "find";
const LABEL: Record<Backend, string> = { mdfind: "Spotlight (mdfind)", fd: "fd", locate: "locate", find: "find" };
const CANDIDATES: Backend[] = MAC ? ["mdfind"] : ["fd", "locate", "find"];
const forced = process.env.PAL_FILES_BACKEND as Backend | undefined;
const BACKEND: Backend | undefined = [...(forced && forced in LABEL ? [forced] : []), ...CANDIDATES].find((b) => Bun.which(b));
console.error(`[files] backend: ${BACKEND ? LABEL[BACKEND] : "none"}`);

// ---- content -------------------------------------------------------------

/** A content search past this is killed; what it printed is the answer. */
const CONTENT_MS = 1000;
const CONTENT_SECTION = "In files";
/** How many snippet lookups run at once. */
const SNIPPETS = 8;
const CONTENT_CANDIDATES: ContentBackend[] = MAC ? ["mdfind", "rg", "grep"] : ["rg", "grep"];
const forcedContent = process.env.PAL_FILES_CONTENT as ContentBackend | undefined;
const CONTENT: ContentBackend | undefined = [...(forcedContent ? [forcedContent] : []), ...CONTENT_CANDIDATES].find((b) => Bun.which(b));
/** The snippet tool: `rg` when there, else `grep` (Spotlight only lists). */
const SNIPPET: ContentBackend = Bun.which("rg") ? "rg" : "grep";
console.error(`[files] content: ${CONTENT ?? "none"}`);

let runningContent: Bun.Subprocess<"ignore", "pipe", "ignore"> | undefined;

/** Files whose text contains `q`, at most `limit`, within the budget; a newer search supersedes this one. */
async function searchContent(q: string, s: Settings, folders: string[]): Promise<string[]> {
  if (!CONTENT) return [];
  runningContent?.kill();
  const proc = Bun.spawn(contentArgv(CONTENT, q, folders, s.show_hidden), { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  runningContent = proc;
  const timer = setTimeout(() => proc.kill(), CONTENT_MS);
  const out = await readLines(proc, s.limit, (p) => (s.show_hidden || !hidden(p, folders)) && !excluded(p, folders, s.exclude) && under(p, folders) !== undefined);
  clearTimeout(timer);
  proc.kill();
  if (runningContent === proc) runningContent = undefined;
  return out;
}

/** The first line of `path` containing `q`, for the row's subtitle; empty when the tool finds none (a binary Spotlight indexed, a PDF). */
async function firstMatch(q: string, path: string): Promise<string> {
  const proc = Bun.spawn(snippetArgv(SNIPPET, q, path), { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => proc.kill(), CONTENT_MS);
  const text = await new Response(proc.stdout).text().catch(() => "");
  clearTimeout(timer);
  return snippet(text);
}

/** Content rows for `paths` (a `searchContent` answer) minus `skip` (what the name search listed): a file row in the section "In files", the first matching line as its subtitle. */
async function contentRows(q: string, paths: string[], skip: Set<string>): Promise<Item[]> {
  const wanted = paths.filter((p) => !skip.has(p));
  const rows: Item[] = [];
  for (let i = 0; i < wanted.length; i += SNIPPETS) {
    const batch = await Promise.all(wanted.slice(i, i + SNIPPETS).map(async (p) => {
      const row = await item(p, undefined, CONTENT_SECTION);
      if (!row || row.icon === GLYPH.folder) return;
      const line = await firstMatch(q, p);
      const out: Item = { ...row, subtitle: line ? `${line} · ${short(dirname(p))}` : row.subtitle };
      return out;
    }));
    rows.push(...batch.filter((r): r is Item => r !== undefined));
  }
  return rows;
}

/** `*`, `?`, `[` and `\` in the query taken literally by find's `-iname`. */
const globEscape = (s: string) => s.replace(/[\\*?[]/g, "\\$&");

function argv(b: Backend, q: string, s: Settings, folders: string[]): string[] {
  switch (b) {
    // `-name` is a case-insensitive substring match on the display name; `-onlyin` repeats as a union.
    case "mdfind": return ["mdfind", "-name", q, ...folders.flatMap((f) => ["-onlyin", f])];
    // Name match (fd's default), not `--full-path`: that would list every descendant of a folder whose name matches.
    // `--exclude` prunes the walk (a gitignore glob: `node_modules` at any depth, `Library/Caches` under the folder).
    case "fd": return ["fd", "--absolute-path", "--fixed-strings", "--max-results", String(s.limit), "--max-depth", String(FD_MAX_DEPTH), ...s.exclude.flatMap((x) => ["--exclude", x]), ...(s.show_hidden ? ["--hidden"] : []), q, ...folders];
    // Whole database; the folders, the excludes and the limit are applied to the stream below, so no `-l`.
    case "locate": return ["locate", "-i", "--", q];
    // Dot entries and the excludes pruned below the folders (never a starting point, so `~/.config` as a folder still works).
    case "find": return ["find", ...folders, "-mindepth", "1", ...(s.show_hidden ? [] : ["-name", ".*", "-prune", "-o"]), ...s.exclude.flatMap((x) => ["-path", `*/${x}`, "-prune", "-o"]), "-iname", `*${globEscape(q)}*`, "-print"];
  }
}

const short = (p: string) => (p === HOME ? "~" : p.startsWith(HOME + "/") ? "~" + p.slice(HOME.length) : p);
const under = (p: string, folders: string[]) => folders.find((f) => p === f || p.startsWith(f.endsWith("/") ? f : f + "/"));
/** A dot segment below the configured folder (the folder itself may be `~/.config`). */
const hidden = (p: string, folders: string[]) => /\/\./.test(p.slice(under(p, folders)?.length ?? 0));
/** An `exclude` entry (one segment, or a few like `Library/Caches`) below the configured folder, whichever backend answered. */
const excluded = (p: string, folders: string[], exclude: string[]) => {
  const rel = p.slice(under(p, folders)?.length ?? 0) + "/";
  return exclude.some((x) => rel.includes(`/${x}/`));
};

let running: Bun.Subprocess<"ignore", "pipe", "ignore"> | undefined;

/** The process's stdout a line at a time until `limit` lines pass `keep`; stops reading then (the caller kills it). */
async function readLines(proc: Bun.Subprocess<"ignore", "pipe", "ignore">, limit: number, keep: (line: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const decoder = new TextDecoder();
  let buf = "";
  try {
    read: for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line && keep(line)) out.push(line);
        if (out.length >= limit) break read;
      }
    }
  } catch {}
  return out;
}

/** Paths matching `q`, at most `limit`, in the backend's order; a newer search supersedes this one. */
async function search(q: string, s: Settings, folders: string[]): Promise<string[]> {
  running?.kill();
  const proc = Bun.spawn(argv(BACKEND!, q, s, folders), { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  running = proc;
  const timer = setTimeout(() => proc.kill(), SEARCH_MS);
  const keep = (p: string) => (s.show_hidden || !hidden(p, folders)) && !excluded(p, folders, s.exclude) && (BACKEND !== "locate" || under(p, folders) !== undefined);
  const out = await readLines(proc, s.limit, keep);
  clearTimeout(timer);
  proc.kill();
  if (running === proc) running = undefined;
  return out;
}

// ---- rows ----------------------------------------------------------------

type Kind = "folder" | "image" | "document" | "code" | "archive" | "file";
const GLYPH: Record<Kind, string> = { folder: "\u{f0256}", image: "\u{f0976}", document: "\u{f09ee}", code: "\u{f102b}", archive: "\u{f0ffa}", file: "\u{f0224}" };
const EXT: Record<Exclude<Kind, "folder" | "file">, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg", "bmp", "tiff", "avif"],
  document: ["txt", "md", "pdf", "doc", "docx", "rtf", "pages", "odt", "xls", "xlsx", "numbers", "csv", "ppt", "pptx", "key", "epub"],
  code: ["ts", "tsx", "js", "jsx", "py", "rs", "go", "rb", "sh", "zsh", "c", "h", "cpp", "java", "kt", "swift", "lua", "toml", "json", "yaml", "yml", "html", "css", "sql"],
  archive: ["zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "dmg", "iso"],
};
function kind(p: string, dir: boolean): Kind {
  if (dir && !(MAC && p.endsWith(".app"))) return "folder";
  const ext = extname(p).slice(1).toLowerCase();
  return (Object.keys(EXT) as (keyof typeof EXT)[]).find((k) => EXT[k].includes(ext)) ?? "file";
}

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

/** A folder's primary action: its contents as a pushed level (the `browse` palette); `→` runs it from anywhere in a listing while nothing is typed. */
const BROWSE: Action = { id: "browse", title: "Browse", shortcut: "right" };
/** On every row of a browsed folder: flips the `show_hidden` setting, so the listing (every listing) shows or hides dot entries. */
const hiddenAction = (s: Settings): Action => ({ id: "toggle-hidden", title: s.show_hidden ? "Hide hidden files" : "Show hidden files", shortcut: "cmd+." });
// Open, reveal, the two copies and the trash work on marked rows too (`multi`: one pick with `ctx.ids`).
const ACTIONS: Action[] = [
  { id: "open", title: "Open", multi: true },
  { id: "reveal", title: MAC ? "Reveal in Finder" : "Show in file manager", multi: true },
  ...(MAC ? [{ id: "quick-look", title: "Quick Look", shortcut: "cmd+y" }] : []),
  { id: "open-with", title: "Open with…", shortcut: "cmd+o" },
  { id: "copy", title: "Copy path", shortcut: "cmd+c", multi: true },
  { id: "copy-file", title: "Copy file", shortcut: "cmd+shift+c", multi: true },
  { id: "trash", title: "Move to Trash", shortcut: "cmd+d", style: "destructive", confirm: "Move this to the Trash?", multi: true },
];
/** An image or a PDF gets OCR after Copy file: its text onto the clipboard. */
const OCR_ACTION: Action = { id: "copy-text", title: "Copy text (OCR)", shortcut: "cmd+shift+t" };
const ocrable = (p: string, k: Kind) => k === "image" || extname(p).toLowerCase() === ".pdf";
/**
 * The open or save panel in front while the panel is up (`dialog.current`,
 * asked at the start of every listing: one cached read per show), so a
 * row leads with "Use in dialog" (the `dialog` effect: the path typed into
 * that panel) only while there is one to type into.
 */
let dialogUp: Dialog | null = null;
async function refreshDialog(): Promise<void> {
  dialogUp = await dialog.current().catch(() => null);
}
const DIALOG_ACTION = (d: Dialog): Action => ({ id: "dialog", title: `Use in ${d.app}'s ${d.kind} panel`, shortcut: "cmd+g" });
const actionsFor = (p: string, k: Kind): Action[] => {
  const base = k === "folder" ? [BROWSE, ...ACTIONS] : ocrable(p, k) ? [...ACTIONS.slice(0, -1), OCR_ACTION, ACTIONS[ACTIONS.length - 1]] : ACTIONS;
  return dialogUp ? [DIALOG_ACTION(dialogUp), ...base] : base;
};

/** A row for a path that still exists; `usedAt` (a recent file) replaces the modified date on the right. */
async function item(p: string, usedAt?: number, section?: string): Promise<Item | undefined> {
  const st = await stat(p).catch(() => undefined);
  if (!st) return;
  return entryRow({ path: p, name: basename(p) || p, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs }, usedAt, section);
}

/** The row of a stat'ed entry: `thumbs` draws an image's own thumbnail in place of the glyph (a browsed folder, where the pictures are the point). */
function entryRow(e: Entry, usedAt?: number, section?: string, thumbs = false, extra: Action[] = []): Item {
  const k = kind(e.path, e.dir);
  return {
    id: e.path,
    name: e.name,
    subtitle: short(dirname(e.path)),
    icon: MAC && e.path.endsWith(".app") ? { app: e.path } : thumbs && k === "image" ? { image: thumbnailUrl(e.path, 24) } : GLYPH[k],
    accessories: [...(k === "folder" ? [] : [{ text: size(e.size) }]), { date: usedAt ?? e.mtime }],
    ...(section && { section }),
    actions: [...actionsFor(e.path, k), ...extra],
  };
}

// ---- browsing a folder -------------------------------------------------------

/** The level "Browse" pushes for `folder`: the `browse` palette, the crumb the folder's short path. */
const browsePush = (folder: string): Effect => ({ push: { extension: "files", palette: "browse", args: { browse: folder } satisfies Browse, title: short(folder) } });

/** Every entry of `folder` stat'ed (one that vanished meanwhile is skipped); empty for a folder that cannot be read. */
async function entries(folder: string): Promise<Entry[]> {
  let names: string[];
  try { names = await readdir(folder); } catch { return []; }
  const all = await Promise.all(names.map(async (name) => {
    const path = join(folder, name);
    const st = await stat(path).catch(() => undefined);
    return st && { path, name, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs };
  }));
  return all.filter((e): e is Entry => !!e);
}

/**
 * The rows of a browsed folder: the `..` row (not at `/`), then the
 * entries sorted by `by` and narrowed by `query`, hidden ones with
 * `show_hidden`, images with their thumbnails, `BROWSE_CAP` at most with
 * a hint row for the rest. Every row can flip the hidden setting.
 */
async function browseRows(folder: string, query: string, s: Settings, by: Sort = "name"): Promise<Item[]> {
  const found = sortEntries(filterEntries(await entries(folder), query, s.show_hidden), by);
  const shown = found.slice(0, BROWSE_CAP);
  const hidden = hiddenAction(s);
  const up = upRow(folder, short, GLYPH.folder);
  return [
    ...(isRoot(folder) ? [] : [{ ...up, actions: [...up.actions!, hidden] }]),
    ...shown.map((e) => entryRow(e, undefined, undefined, true, [hidden])),
    ...(found.length > BROWSE_CAP ? [hintRow(found.length - BROWSE_CAP, GLYPH.folder)] : []),
  ];
}

/** The `browse` palette's sort from the filter dropdown; the first is the default. */
const sortOf = (ctx?: Ctx): Sort => (SORTS.some((x) => x.id === ctx?.filter) ? (ctx!.filter as Sort) : SORTS[0].id);

/** The picks a browsed folder's rows share beyond the file actions: the `..` row, Browse on a folder, the hidden toggle. */
async function browseAction(id: string, action: string | undefined): Promise<Effect | undefined> {
  if (id.startsWith("up:")) return browsePush(id.slice(3));
  if (action === "browse") return browsePush(id);
  if (action === "toggle-hidden") {
    await settings.set("show_hidden", !settings.get<Settings>().show_hidden);
    return { keep: true };
  }
  return undefined;
}

// ---- a typed path ----------------------------------------------------------

/** A root query that is a path: `/` or `~` first (`~/Doc`, `/usr/local`); what the inline section answers. */
export const PATH_RE = /^\s*(~|\/)/;
/** Rows the inline section may show for a typed path. */
const PATH_ROWS = 5;

/**
 * The rows for a typed path: the path itself when it exists, else the
 * entries of its parent whose names start with the last segment (a
 * completion: `~/Down` lists Downloads), hidden ones only when the segment
 * starts with a dot or `show_hidden` is on. Nothing for a path whose
 * parent does not exist. Inside the palette (`browse` set) a path ending
 * in `/` that names a folder lists it whole as a browsed folder instead
 * (the `..` row, every entry, the cap); the root's inline section keeps
 * the short completion.
 */
export async function pathRows(query: string, showHidden: boolean, limit = PATH_ROWS, browse?: Settings): Promise<Item[]> {
  const q = query.trim();
  if (!PATH_RE.test(q)) return [];
  const p = home(q);
  if (!q.endsWith("/")) {
    const exact = await item(p);
    if (exact) return [exact];
  } else if (browse && (await stat(p).catch(() => undefined))?.isDirectory()) {
    return browseRows(p.replace(/(.)\/+$/, "$1"), "", browse);
  }
  const dir = q.endsWith("/") ? p : dirname(p);
  const prefix = q.endsWith("/") ? "" : basename(p);
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const rows = await Promise.all(names
    .filter((n) => n.toLowerCase().startsWith(prefix.toLowerCase()) && (showHidden || prefix.startsWith(".") || !n.startsWith(".")))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit)
    .map((n) => item(`${dir.replace(/\/$/, "")}/${n}`)));
  return rows.filter((i): i is Item => i !== undefined);
}

// ---- recent --------------------------------------------------------------

/** Seven days, what both sources are asked for. */
const RECENT_DAYS = 7;
const RECENT_SECTION = "Recently used";
/** Tests point the Linux source at a file of their own; on macOS this also stands in for Spotlight. */
const XBEL = process.env.PAL_RECENT_XBEL || `${process.env.XDG_DATA_HOME || home("~/.local/share")}/recently-used.xbel`;

/** Newest first, within the configured folders and their excludes, files only. */
async function recentPaths(s: Settings, folders: string[]): Promise<Recent[]> {
  let found: Recent[];
  if (MAC && !process.env.PAL_RECENT_XBEL) {
    const proc = Bun.spawn(["mdfind", "-attr", "kMDItemLastUsedDate", ...folders.flatMap((f) => ["-onlyin", f]), `kMDItemLastUsedDate >= $time.now(-${RECENT_DAYS * 86400}) && kMDItemContentTypeTree != "public.folder"`], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => proc.kill(), SEARCH_MS);
    found = parseMdfindRecent(await new Response(proc.stdout).text().catch(() => ""));
    clearTimeout(timer);
  } else {
    const since = Date.now() - RECENT_DAYS * 86400_000;
    found = parseXbel(await readFile(XBEL, "utf8").catch(() => "")).filter((r) => r.at >= since);
  }
  return found.filter((r) => under(r.path, folders) && (s.show_hidden || !hidden(r.path, folders)) && !excluded(r.path, folders, s.exclude)).slice(0, s.limit);
}

async function recentRows(s: Settings, folders: string[], section?: string): Promise<Item[]> {
  const rows = await Promise.all((await recentPaths(s, folders)).map((r) => item(r.path, r.at, section)));
  return rows.filter((i): i is Item => i !== undefined && i.icon !== GLYPH.folder);
}

/** Exact name first, then a prefix match, then the backend's order. */
function rank(items: Item[], q: string): Item[] {
  const lq = q.toLowerCase();
  const tier = (i: Item) => { const n = i.name.toLowerCase(); return n === lq ? 0 : n.startsWith(lq) ? 1 : 2; };
  return items.map((i, n) => ({ i, n, t: tier(i) })).sort((a, b) => a.t - b.t || a.n - b.n).map(({ i }) => i);
}

// ---- open with -----------------------------------------------------------

/** The apps the OS registers for the file, the default first (the core's order), narrowed by the query. */
async function appRows(file: string, query: string): Promise<Item[]> {
  const apps = await appsApi.forFile(file);
  const q = query.trim().toLowerCase();
  const rows = apps.filter((a) => !q || a.name.toLowerCase().includes(q) || a.bundle_id?.toLowerCase().includes(q)).map(appRow);
  return rows.length || q ? rows : [hint("No app opens this file", `Nothing is registered for ${basename(file)}`)];
}

const appRow = (a: App): Item => ({
  id: a.path,
  name: a.name,
  subtitle: short(dirname(a.path)),
  icon: { app: a.path },
  keywords: a.bundle_id ? [a.bundle_id] : [],
  accessories: a.default ? [{ tag: "default" }] : [],
  actions: [{ id: "open-with", title: "Open" }],
});

/** Four backticks fence the text so a ``` inside cannot end it early. */
const fence = (s: string, lang: string) => "````" + lang + "\n" + s.replace(/````/g, "```​`") + "\n````";

/**
 * Path, size, modified, kind; a text file's first lines under it. No image
 * preview: `icon://` serves app icons, favicons and clipboard images only
 * (app/src-tauri/src/icon.rs), not arbitrary files.
 */
async function detail(p: string): Promise<Detail> {
  // The `..` row describes the folder it leads to; the cap's hint row has nothing to say.
  if (p.startsWith("up:")) return detail(p.slice(3));
  if (p.startsWith("hint:")) return {};
  const st = await stat(p).catch(() => undefined);
  if (!st) return { markdown: "This file no longer exists.", metadata: [{ label: "Path", value: short(p) }] };
  const dir = st.isDirectory();
  const k = kind(p, dir);
  const metadata: Metadata[] = [
    { label: "Path", value: short(p) },
    ...(dir ? [] : [{ label: "Size", value: size(st.size) }]),
    { label: "Modified", value: new Date(st.mtimeMs).toLocaleString() },
    { label: "Kind", value: k === "file" ? (extname(p).slice(1) || "file") : k },
  ];
  let markdown: string | undefined;
  if (!dir && st.size <= TEXT_MAX && k !== "image" && k !== "archive") {
    const buf = await readFile(p).catch(() => undefined);
    if (buf && !buf.subarray(0, 8192).includes(0)) {
      const lines = buf.toString().split("\n");
      markdown = fence(lines.slice(0, TEXT_LINES).join("\n") + (lines.length > TEXT_LINES ? "\n…" : ""), extname(p).slice(1).replace(/[^a-z0-9]/gi, ""));
    }
  }
  return { markdown, metadata };
}

// ---- actions -------------------------------------------------------------

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

/** Runs to completion or `ms`; rejects with stderr (or the exit code) on failure. */
async function run(argv: string[], ms: number): Promise<void> {
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), ms);
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(err.trim() || `${argv[0]} exited ${code}`);
}

const trash = (p: string) => run(MAC ? ["osascript", "-e", `tell application "Finder" to delete POSIX file ${JSON.stringify(p)}`] : ["gio", "trash", "--", p], TRASH_MS);

/**
 * The shared actions of a file row; `open-with` needs the palette to push
 * on, the rest are the same everywhere. `ids` is every marked row of a
 * multi pick (the actions marked `multi` in `ACTIONS`), else the one.
 */
async function fileAction(id: string, action: string | undefined, palette: string, ids: string[] = [id]): Promise<Effect> {
  const browsed = await browseAction(id, action);
  if (browsed) return browsed;
  switch (action) {
    case "dialog": return { dialog: id };
    case "reveal": spawnDetached(MAC ? ["open", "-R", ...ids] : ["xdg-open", dirname(id)]); return { hide: true };
    case "quick-look": spawnDetached(["qlmanage", "-p", id]); return { hide: true };
    case "open-with": return { push: { extension: "files", palette, args: { open_with: id } satisfies OpenWith, title: `Open ${basename(id)} with` } };
    case "copy": return { copy: ids.join("\n") };
    case "copy-file": return { copy_files: ids };
    case "copy-text": {
      let text: string;
      try { text = await ocr.image({ path: id }); } catch (e) { return { keep: true, toast: { title: "Could not read the text", message: String((e as Error)?.message ?? e), style: "failure" } }; }
      if (!text) return { keep: true, toast: { title: "No text found", message: basename(id) } };
      return { copy: settings.get<Settings>().ocr_concealed ? conceal(text, 0) : text, hud: "Copied text" };
    }
    case "trash":
      try { for (const p of ids) await trash(p); } catch (e) { return { keep: true, toast: { title: "Could not move to Trash", message: String((e as Error)?.message ?? e), style: "failure" } }; }
      return { keep: true, toast: { title: "Moved to Trash", message: ids.length === 1 ? basename(id) : `${ids.length} items` } };
    default:
      // Several: every one through the opener; the effect carries one, so the rest go here.
      for (const p of ids.slice(1)) spawnDetached([MAC ? "open" : "xdg-open", p]);
      return { open: id };
  }
}

/** The "Open with…" level: the apps for `file`, or the pick of one. */
const openWithPick = async (file: string, id: string) => {
  try { await appsApi.openWith(file, id); } catch (e) { return { keep: true as const, toast: { title: "Could not open", message: String((e as Error)?.message ?? e), style: "failure" as const } }; }
  return { hide: true as const };
};
const openWithDetail = (file: string, id: string): Detail => ({ metadata: [{ label: "Application", value: short(id) }, { label: "Opens", value: short(file) }] });

const hint = (name: string, subtitle: string): Item => ({ id: `hint:${name}`, name, subtitle, icon: ICON, actions: [] });

function hints(folders: string[]): Item[] {
  if (!BACKEND) return [hint("No file search backend", MAC ? "mdfind is missing" : "Install fd (or locate) for this palette")];
  return [
    hint("Type part of a file name", `${LABEL[BACKEND]} in ${folders.map(short).join(", ")}`),
    ...(BACKEND === "find" ? [hint("This will be slow", "Neither fd nor locate is installed: find walks the folders on every keystroke, 3 s at most.")] : []),
  ];
}

export default {
  palettes: {
    files: {
      title: "Files",
      input: true,
      // Tab (and `x` with nothing typed) marks rows: files are gathered (to trash, to copy).
      multi: true,
      // At the root a typed path (`~/Down`, `/usr/local/bin`) lists the file or its completions inline; any other query gets a Search Files fallback row.
      match: PATH_RE,
      inline: true,
      fallback: "Search Files for “{query}”",
      placeholder: "Search files by name",
      // A level pushed by "Open with…" (`args.open_with` is the file) lists the apps for it instead; its rows' ids are app paths.
      list: async (query = "", ctx) => {
        const file = openWithOf(ctx);
        if (file) return appRows(file, query);
        const s = settings.get<Settings>();
        const folders = s.folders.map(home);
        await refreshDialog();
        // A path completes rather than searches, inside the palette too: the backends match names, not paths.
        if (ctx?.inline) return pathRows(query, s.show_hidden);
        if (PATH_RE.test(query.trim())) return pathRows(query, s.show_hidden, s.limit, s);
        const ask = parseQuery(query);
        if (ask.only) {
          if (!ask.content) return [hint("Type words to find in file contents", CONTENT ? `${CONTENT} in ${folders.map(short).join(", ")}` : "No content search tool: Spotlight, rg or grep")];
          return contentRows(ask.content, await searchContent(ask.content, s, folders), new Set());
        }
        const q = ask.name;
        if (!q || !BACKEND) {
          // The empty query is the recently used files, as in Raycast; the hints when there are none.
          const recent = BACKEND ? await recentRows(s, folders, RECENT_SECTION) : [];
          return recent.length ? recent : hints(folders);
        }
        // Names and contents at once; the content rows come after, minus what the names found.
        const content = s.content_search && CONTENT ? searchContent(q, s, folders) : Promise.resolve([]);
        const paths = await search(q, s, folders);
        const rows = (await Promise.all(paths.map((p) => item(p)))).filter((i): i is Item => i !== undefined);
        const named = rank(rows, q);
        return [...named, ...(await contentRows(q, await content, new Set(named.map((r) => r.id))))];
      },
      pick: (id, action, ctx) => {
        const file = openWithOf(ctx);
        return file ? openWithPick(file, id) : fileAction(id, action, "files", ctx?.ids);
      },
      detail: (id, ctx) => {
        const file = openWithOf(ctx);
        return file ? openWithDetail(file, id) : detail(id);
      },
    },
    browse: {
      title: "Browse Folder",
      input: true,
      multi: true,
      placeholder: "Filter this folder",
      filters: [...SORTS],
      // Listed from the `args.browse` folder a Browse pick pushed; the crumb is the folder. Without args (opened by name) it is the home folder.
      list: async (query = "", ctx) => {
        const file = openWithOf(ctx);
        if (file) return appRows(file, query);
        await refreshDialog();
        return browseRows(browseOf(ctx) ?? HOME, query, settings.get<Settings>(), sortOf(ctx));
      },
      pick: (id, action, ctx) => {
        const file = openWithOf(ctx);
        return file ? openWithPick(file, id) : fileAction(id, action, "browse", ctx?.ids);
      },
      detail: (id, ctx) => {
        const file = openWithOf(ctx);
        return file ? openWithDetail(file, id) : detail(id);
      },
    },
    recent: {
      title: "Recent Files",
      // Newest first is the order; listed again on a show once the listing is a minute old.
      live: true,
      multi: true,
      placeholder: "Search recent files",
      list: async (query = "", ctx) => {
        const file = openWithOf(ctx);
        if (file) return appRows(file, query);
        const s = settings.get<Settings>();
        await refreshDialog();
        return recentRows(s, s.folders.map(home));
      },
      pick: (id, action, ctx) => {
        const file = openWithOf(ctx);
        return file ? openWithPick(file, id) : fileAction(id, action, "recent", ctx?.ids);
      },
      detail: (id, ctx) => {
        const file = openWithOf(ctx);
        return file ? openWithDetail(file, id) : detail(id);
      },
    },
  },
} satisfies Extension;
