// A vault as data, pure: what one markdown file says about itself (front
// matter, the title, tags, wikilinks), how Obsidian resolves a link, the
// daily-note name for a day (moment's tokens, the subset Obsidian's
// daily-notes plugin is configured with), a template filled, the two
// config files Obsidian keeps (`obsidian.json` for the vaults it knows,
// `.obsidian/daily-notes.json` for the plugin). The file system is
// vault.ts's.

/** One note as the index keeps it: everything a row, a pane or a search needs without re-reading the file. */
export type Note = {
  /** Relative to the vault, with `.md`; the id. */
  path: string;
  /** The file's base name without `.md`: what a `[[wikilink]]` names. */
  name: string;
  /** Front matter `title`, else the first `# heading`, else the name. */
  title: string;
  /** The folder relative to the vault, `""` at the top. */
  folder: string;
  /** Front matter `description`, else the first body line that is not a heading. */
  description?: string;
  tags: string[];
  aliases: string[];
  /** Wikilink targets as written (heading, block and label stripped), unique, in order. */
  links: string[];
  mtime: number;
  size: number;
  words: number;
};

export type FrontMatter = Record<string, string | string[]>;

// ---- front matter ----------------------------------------------------------

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
const splitList = (s: string) => s.split(",").map(unquote).filter(Boolean);

/**
 * A leading `---` block as Obsidian writes it: `key: value`, `key: [a, b]`,
 * a block list under a key, quotes stripped, nothing nested. The body is
 * what follows. Not YAML: the subset a note's properties use.
 */
export function frontMatter(text: string): { meta: FrontMatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: FrontMatter = {};
  let key: string | undefined;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && key) { const cur = meta[key]; meta[key] = [...(Array.isArray(cur) ? cur : cur ? [cur] : []), unquote(item[1])]; continue; }
    const kv = /^([\w.-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1];
    const v = kv[2].trim();
    if (!v) meta[key] = [];
    else if (v.startsWith("[") && v.endsWith("]")) meta[key] = splitList(v.slice(1, -1));
    else meta[key] = unquote(v);
  }
  return { meta, body: text.slice(m[0].length) };
}

const asList = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : typeof v === "string" && v ? splitList(v) : []);

// ---- tags and links -----------------------------------------------------------

/** Obsidian's tag: letters, digits, `_`, `-`, `/`, with at least one character that is not a digit. */
const TAG = /(^|[\s(])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;
const WIKI = /!?\[\[([^\]|#]*)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
const FENCE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;
/** `[[target\|label]]`, the alias pipe escaped as Obsidian writes it inside a table cell, read as `[[target|label]]`. */
export const unescapePipes = (s: string): string => s.replace(/\[\[([^\]]*?)\\\|([^\]]*)\]\]/g, "[[$1|$2]]");

/** `#tag` and `#a/b` in the body (code left out), plus the front matter's `tags`; the `#` off, once each, case kept as first seen. */
export function tags(body: string, meta: FrontMatter = {}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => { const k = t.replace(/^#/, "").trim(); if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); out.push(k); } };
  for (const t of [...asList(meta.tags), ...asList(meta.tag)]) add(t);
  for (const m of body.replace(FENCE, " ").matchAll(TAG)) add(m[2]);
  return out;
}

/** Every `[[target]]`, `[[target#heading]]`, `[[target|label]]`, `![[target]]` in the body: the targets, once each; an embed of something that is not a note (`.png`, `.pdf`) is skipped. */
export function wikilinks(body: string): string[] {
  const out: string[] = [];
  for (const m of unescapePipes(body.replace(FENCE, " ")).matchAll(WIKI)) {
    const t = m[1].trim().replace(/\.md$/i, "");
    if (!t || /\.[a-z0-9]{2,4}$/i.test(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

// ---- one note --------------------------------------------------------------

const HEADING = /^#\s+(.+?)\s*#*\s*$/;

/** The note's `name` and `folder` from its relative path. */
export const split = (path: string): { name: string; folder: string } => {
  const i = path.lastIndexOf("/");
  return { name: path.slice(i + 1).replace(/\.md$/i, ""), folder: i < 0 ? "" : path.slice(0, i) };
};

/** A note from its relative path, text and stat. */
export function parseNote(path: string, text: string, stat: { mtime: number; size: number }): Note {
  const { meta, body } = frontMatter(text);
  const { name, folder } = split(path);
  const lines = body.split(/\r?\n/);
  const heading = lines.map((l) => HEADING.exec(l)?.[1]).find(Boolean);
  const title = (typeof meta.title === "string" && meta.title) || heading || name;
  const first = lines.find((l) => l.trim() && !/^#{1,6}\s/.test(l) && !/^---+$/.test(l) && !/^\s*[-*+]\s*$/.test(l))?.trim().replace(/^[-*+]\s+/, "").replace(/\s+/g, " ");
  const description = (typeof meta.description === "string" && meta.description) || (first ? cut(plainLine(first), 120) : undefined);
  return {
    path, name, title, folder, description,
    tags: tags(body, meta),
    aliases: asList(meta.aliases).concat(asList(meta.alias)),
    links: wikilinks(body),
    mtime: stat.mtime, size: stat.size,
    words: body.split(/\s+/).filter(Boolean).length,
  };
}

/** A line with its wikilinks reduced to their label and its bold, italic and code marks off, for a subtitle. */
export const plainLine = (s: string): string => unescapePipes(s).replace(WIKI, (m, t: string, _h: string | undefined, label?: string) => (m.startsWith("!") ? "" : (label ? label.slice(1) : t).trim())).replace(/`([^`]+)`/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, "$1$2").trim();

export const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// ---- resolving -----------------------------------------------------------------

/**
 * Where a wikilink lands, as Obsidian resolves it: the path itself
 * (`folder/name`, with `.md` implied), else the note of that name anywhere
 * in the vault (the shortest path when several share it), else an alias.
 * `undefined` for a link to nothing yet.
 */
export function resolve(target: string, notes: Iterable<Note>): Note | undefined {
  const t = target.trim().replace(/\.md$/i, "").replace(/^\//, "");
  if (!t) return undefined;
  const lower = t.toLowerCase();
  let byName: Note | undefined, byAlias: Note | undefined;
  for (const n of notes) {
    const p = n.path.slice(0, -3).toLowerCase();
    if (p === lower) return n;
    if (n.name.toLowerCase() === lower && (!byName || n.path.length < byName.path.length)) byName = n;
    if (!byAlias && n.aliases.some((a) => a.toLowerCase() === lower)) byAlias = n;
  }
  return byName ?? byAlias;
}

/** What `[[...]]` to write for a note: its name when no other note shares it, else its path without `.md`. */
export function wikilink(note: Note, notes: Iterable<Note>): string {
  for (const n of notes) if (n !== note && n.name.toLowerCase() === note.name.toLowerCase()) return `[[${note.path.slice(0, -3)}]]`;
  return `[[${note.name}]]`;
}

/** `obsidian://open?vault=<name>&file=<path>`: the vault's name is its folder's, the file without `.md`. */
export const obsidianUrl = (vaultName: string, path: string): string => `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(path.replace(/\.md$/i, ""))}`;
export const obsidianSearchUrl = (vaultName: string, query: string): string => `obsidian://search?vault=${encodeURIComponent(vaultName)}&query=${encodeURIComponent(query)}`;

/** A title as a file name: Obsidian's forbidden characters (`* " \ / < > : | ?`) replaced, dots and spaces at the ends dropped. */
export const fileName = (title: string): string => title.replace(/[*"\\/<>:|?]/g, "-").replace(/\s+/g, " ").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 200);

// ---- dates: the tokens Obsidian's daily-notes format takes ------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const two = (n: number) => String(n).padStart(2, "0");
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** ISO week number (Monday first, week 1 holds the year's first Thursday). */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
}

/** The default the plugin ships with. */
export const DAILY_FORMAT = "YYYY-MM-DD";

/**
 * A date in moment's format language, the tokens a daily-note name uses:
 * `YYYY YY MMMM MMM MM M Do DD D dddd ddd d HH H hh h mm m ss s A a WW W Q`
 * and `[literal text]`. Anything else is copied as it is.
 */
export function formatDate(fmt: string, d: Date): string {
  const h12 = d.getHours() % 12 || 12;
  const tok: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()), YY: () => two(d.getFullYear() % 100),
    MMMM: () => MONTHS[d.getMonth()], MMM: () => MONTHS[d.getMonth()].slice(0, 3), MM: () => two(d.getMonth() + 1), M: () => String(d.getMonth() + 1),
    dddd: () => DAYS[d.getDay()], ddd: () => DAYS[d.getDay()].slice(0, 3), Do: () => ordinal(d.getDate()), DD: () => two(d.getDate()), D: () => String(d.getDate()), d: () => String(d.getDay()),
    HH: () => two(d.getHours()), H: () => String(d.getHours()), hh: () => two(h12), h: () => String(h12), mm: () => two(d.getMinutes()), m: () => String(d.getMinutes()), ss: () => two(d.getSeconds()), s: () => String(d.getSeconds()),
    A: () => (d.getHours() < 12 ? "AM" : "PM"), a: () => (d.getHours() < 12 ? "am" : "pm"), WW: () => two(isoWeek(d)), W: () => String(isoWeek(d)), Q: () => String(Math.floor(d.getMonth() / 3) + 1),
  };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|Do|DD|D|d|HH|H|hh|h|mm|m|ss|s|A|a|WW|W|Q/g, (m, lit?: string) => (lit !== undefined ? lit : tok[m]()));
}

/** `{{date}}`, `{{time}}`, `{{title}}`, `{{date:FMT}}`, `{{time:FMT}}` as Obsidian's Templates and daily-notes plugins fill them. */
export function fillTemplate(text: string, opts: { title?: string; now?: Date } = {}): string {
  const now = opts.now ?? new Date();
  return text.replace(/\{\{\s*(date|time|title)\s*(?::([^}]*))?\}\}/g, (_, k: string, fmt?: string) => {
    if (k === "title") return opts.title ?? "";
    return formatDate(fmt?.trim() || (k === "date" ? DAILY_FORMAT : "HH:mm"), now);
  });
}

/** The day `n` days from `d` at midnight. */
export const dayAfter = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

// ---- Obsidian's own files ------------------------------------------------------

/** `obsidian.json`: the vault that is open, else the one used last (`ts`), else the first; undefined for none. */
export function firstVault(json: unknown): string | undefined {
  const vaults = (json as { vaults?: Record<string, { path?: string; ts?: number; open?: boolean }> } | null)?.vaults;
  if (!vaults || typeof vaults !== "object") return undefined;
  const list = Object.values(vaults).filter((v) => v && typeof v.path === "string" && v.path);
  return (list.find((v) => v.open) ?? list.slice().sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))[0])?.path;
}

export type DailyConfig = { folder: string; format: string; template: string };

/** `.obsidian/daily-notes.json`: `folder`, `format`, `template` (a path without `.md`), each blank when unset. */
export function dailyConfig(json: unknown): DailyConfig {
  const o = (json ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim().replace(/^\/+|\/+$/g, "") : "");
  return { folder: s("folder"), format: s("format") || "", template: s("template") };
}

/** Whether `path` (relative to the vault) is kept out: a dot segment (`.obsidian`, `.git`, `.trash`) or one of the globs. */
export function excluded(path: string, globs: Bun.Glob[]): boolean {
  if (path.split("/").some((seg) => seg.startsWith("."))) return true;
  return globs.some((g) => g.match(path));
}
