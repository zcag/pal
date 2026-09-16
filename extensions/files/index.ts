// Files: an input palette over the OS's own file index. Every keystroke
// spawns one search (the previous one is killed first), reads its output a
// line at a time until `limit` paths are in hand, kills it, and stats the
// paths for the rows. The backend is picked once at load: Spotlight
// (`mdfind`) on macOS; on Linux `fd`, else `locate`, else a bounded `find`
// (slow, and the empty-query hint says so). `PAL_FILES_BACKEND` forces one
// of them: the tests run `find` on a temp folder no index knows about.
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { home, settings, type Action, type Detail, type Extension, type Item, type Metadata } from "@zcag/pal";

/** `[extensions.files]`, defaults in pal.json. */
type Settings = { folders: string[]; limit: number; show_hidden: boolean };

const HOME = home("~");
const MAC = process.platform === "darwin";
const ICON = "▤";
/** A search that has not produced `limit` lines by then is killed; what it printed is the answer. */
const SEARCH_MS = 3000;
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

/** `*`, `?`, `[` and `\` in the query taken literally by find's `-iname`. */
const globEscape = (s: string) => s.replace(/[\\*?[]/g, "\\$&");

function argv(b: Backend, q: string, s: Settings, folders: string[]): string[] {
  switch (b) {
    // `-name` is a case-insensitive substring match on the display name; `-onlyin` repeats as a union.
    case "mdfind": return ["mdfind", "-name", q, ...folders.flatMap((f) => ["-onlyin", f])];
    // Name match (fd's default), not `--full-path`: that would list every descendant of a folder whose name matches.
    case "fd": return ["fd", "--absolute-path", "--fixed-strings", "--max-results", String(s.limit), ...(s.show_hidden ? ["--hidden"] : []), q, ...folders];
    // Whole database; the folders and the limit are applied to the stream below, so no `-l`.
    case "locate": return ["locate", "-i", "--", q];
    // Dot entries pruned below the folders (never a starting point, so `~/.config` as a folder still works).
    case "find": return ["find", ...folders, "-mindepth", "1", ...(s.show_hidden ? [] : ["-name", ".*", "-prune", "-o"]), "-iname", `*${globEscape(q)}*`, "-print"];
  }
}

const short = (p: string) => (p === HOME ? "~" : p.startsWith(HOME + "/") ? "~" + p.slice(HOME.length) : p);
const under = (p: string, folders: string[]) => folders.find((f) => p === f || p.startsWith(f.endsWith("/") ? f : f + "/"));
/** A dot segment below the configured folder (the folder itself may be `~/.config`). */
const hidden = (p: string, folders: string[]) => /\/\./.test(p.slice(under(p, folders)?.length ?? 0));

let running: Bun.Subprocess<"ignore", "pipe", "ignore"> | undefined;

/** Paths matching `q`, at most `limit`, in the backend's order; a newer search supersedes this one. */
async function search(q: string, s: Settings, folders: string[]): Promise<string[]> {
  running?.kill();
  const proc = Bun.spawn(argv(BACKEND!, q, s, folders), { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  running = proc;
  const timer = setTimeout(() => proc.kill(), SEARCH_MS);
  const keep = (p: string) => (s.show_hidden || !hidden(p, folders)) && (BACKEND !== "locate" || under(p, folders) !== undefined);
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
        if (out.length >= s.limit) break read;
      }
    }
  } catch {}
  clearTimeout(timer);
  proc.kill();
  if (running === proc) running = undefined;
  return out;
}

// ---- rows ----------------------------------------------------------------

type Kind = "folder" | "image" | "document" | "code" | "archive" | "file";
const GLYPH: Record<Kind, string> = { folder: "▸", image: "▣", document: "≡", code: "‹›", archive: "▦", file: ICON };
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

const ACTIONS: Action[] = [
  { id: "open", title: "Open" },
  { id: "reveal", title: MAC ? "Reveal in Finder" : "Show in file manager" },
  { id: "copy", title: "Copy path", shortcut: "cmd+c" },
  { id: "trash", title: "Move to Trash", shortcut: "cmd+d", style: "destructive", confirm: "Move this to the Trash?" },
];

async function item(p: string): Promise<Item | undefined> {
  const st = await stat(p).catch(() => undefined);
  if (!st) return;
  const dir = st.isDirectory();
  const k = kind(p, dir);
  return {
    id: p,
    name: basename(p) || p,
    subtitle: short(dirname(p)),
    icon: MAC && p.endsWith(".app") ? { app: p } : GLYPH[k],
    accessories: [...(k === "folder" ? [] : [{ text: size(st.size) }]), { date: st.mtimeMs }],
    actions: ACTIONS,
  };
}

/** Exact name first, then a prefix match, then the backend's order. */
function rank(items: Item[], q: string): Item[] {
  const lq = q.toLowerCase();
  const tier = (i: Item) => { const n = i.name.toLowerCase(); return n === lq ? 0 : n.startsWith(lq) ? 1 : 2; };
  return items.map((i, n) => ({ i, n, t: tier(i) })).sort((a, b) => a.t - b.t || a.n - b.n).map(({ i }) => i);
}

/** Four backticks fence the text so a ``` inside cannot end it early. */
const fence = (s: string, lang: string) => "````" + lang + "\n" + s.replace(/````/g, "```​`") + "\n````";

/**
 * Path, size, modified, kind; a text file's first lines under it. No image
 * preview: `icon://` serves app icons, favicons and clipboard images only
 * (app/src-tauri/src/icon.rs), not arbitrary files.
 */
async function detail(p: string): Promise<Detail> {
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
      icon: ICON,
      input: true,
      placeholder: "Search files by name",
      list: async (query = "") => {
        const s = settings.get<Settings>();
        const folders = s.folders.map(home);
        const q = query.trim();
        if (!q || !BACKEND) return hints(folders);
        const paths = await search(q, s, folders);
        const rows = (await Promise.all(paths.map(item))).filter((i): i is Item => i !== undefined);
        return rank(rows, q);
      },
      pick: async (id, action) => {
        switch (action) {
          case "reveal": spawnDetached(MAC ? ["open", "-R", id] : ["xdg-open", dirname(id)]); return { hide: true };
          case "copy": return { copy: id };
          case "trash":
            try { await trash(id); } catch (e) { return { keep: true, toast: { title: "Could not move to Trash", message: String((e as Error)?.message ?? e), style: "failure" } }; }
            return { keep: true, toast: { title: "Moved to Trash", message: basename(id) } };
          default: return { open: id };
        }
      },
      detail: (id) => detail(id),
    },
  },
} satisfies Extension;
