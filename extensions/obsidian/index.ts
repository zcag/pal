// Obsidian: a vault of markdown notes in the panel. Notes (every note by
// title, sectioned by folder, at the root), Search (full-text as you
// type), Daily (today, yesterday, this week, Append to today, New note),
// Tags (every tag with a count), Recent (the last modified), Backlinks and
// Outgoing links (of the note opened last, or the row they came from).
// A note opens in Obsidian (`obsidian://open`) or an editor, reads inside
// the panel through tela's markdown renderer (../tela/md.ts), and the pane
// shows it with its links, tags and backlinks. Writes: a daily note from
// its template, a line appended to it, a new note; nothing else is
// changed. vault.ts owns the index and the file system, notes.ts the
// parsing.
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { clipboard, home, selection, settings, storage, type Action, type Ctx, type Detail, type Effect, type Extension, type Form, type FormValues, type Item, type LinkParams, type Metadata, type View } from "@zcag/pal";
import { expand } from "../snippets/placeholders.ts";
import { render as renderMd } from "../tela/md.ts";
import { DAILY_FORMAT, cut, dailyConfig, dayAfter, fileName, fillTemplate, firstVault, formatDate, frontMatter, obsidianSearchUrl, obsidianUrl, plainLine, resolve, unescapePipes, wikilink, type Note } from "./notes.ts";
import { BACKEND, appendNote, dispose, exists, index, noteText, search, writeNote, type Index } from "./vault.ts";

/** `[extensions.obsidian]`, defaults in pal.json. */
type Settings = { vault: string; daily_folder: string; daily_format: string; daily_template: string; template: string; open_with: "obsidian" | "editor"; editor: string; exclude: string[] };
const conf = () => settings.get<Settings>();
const EXTENSION = "obsidian";

/** Nerd Font `md-` glyphs: note, calendar (today), calendar week, plus, pencil (append), magnify, dice (random), pound (tag), history, link (backlinks), arrow (outgoing), folder, alert, info, cog. */
const ICON = {
  note: "\u{f11d7}", today: "\u{f00f6}", week: "\u{f0a33}", plus: "\u{f039d}", append: "\u{f0cb6}", search: "\u{f13b8}", random: "\u{f076e}", tag: "\u{f0423}", history: "\u{f02da}", link: "\u{f0339}", out: "\u{f0054}",
  folder: "\u{f0256}", alert: "\u{f0026}", info: "\u{f02fd}", cog: "\u{f08bb}", missing: "\u{f039b}",
} as const;

const RECENT = 20;
const PANE_CHARS = 8000;
const PREFILL_MAX = 20_000;
const TAGS_ON_ROW = 3;
const CREATE_CONFIRM = "Create today's note from the template?";

// ---- the vault and its settings --------------------------------------------------------

/** Where Obsidian keeps the list of vaults it knows, per platform (`PAL_OBSIDIAN_CONFIG` for the tests). */
function obsidianJson(): string {
  if (process.env.PAL_OBSIDIAN_CONFIG) return process.env.PAL_OBSIDIAN_CONFIG;
  if (process.platform === "darwin") return home("~/Library/Application Support/obsidian/obsidian.json");
  const xdg = process.env.XDG_CONFIG_HOME || home("~/.config");
  return join(xdg, "obsidian", "obsidian.json");
}

class NoVault extends Error { constructor(public reason: "unset" | "missing", public path?: string) { super(reason === "unset" ? "no vault set" : `no folder at ${path}`); } }

/** The vault's root: the setting, else the vault Obsidian has open (or used last); `NoVault` when neither says. */
async function root(): Promise<string> {
  const set = conf().vault?.trim();
  let path = set ? home(set) : undefined;
  if (!path) {
    try { path = firstVault(JSON.parse(await readFile(obsidianJson(), "utf8"))); } catch { path = undefined; }
    if (!path) throw new NoVault("unset");
  }
  path = path.replace(/\/+$/, "");
  try { if (!(await stat(path)).isDirectory()) throw new Error("not a folder"); } catch { throw new NoVault("missing", path); }
  return path;
}

const ix = async (refresh = false): Promise<Index> => index(await root(), conf().exclude ?? [], refresh);

/** The daily-notes plugin's folder, format and template, each overridden by the setting when set. */
async function daily(r: string): Promise<{ folder: string; format: string; template: string }> {
  const s = conf();
  let plugin = { folder: "", format: "", template: "" };
  try { plugin = dailyConfig(JSON.parse(await readFile(join(r, ".obsidian", "daily-notes.json"), "utf8"))); } catch { /* no plugin config */ }
  return {
    folder: (s.daily_folder?.trim() || plugin.folder).replace(/^\/+|\/+$/g, ""),
    format: s.daily_format?.trim() || plugin.format || DAILY_FORMAT,
    template: (s.daily_template?.trim() || plugin.template).replace(/^\/+/, "").replace(/\.md$/i, ""),
  };
}

/** The relative path of the daily note for a day. */
async function dailyPath(r: string, day: Date): Promise<string> {
  const d = await daily(r);
  const name = formatDate(d.format, day);
  return `${d.folder ? `${d.folder}/` : ""}${name}.md`;
}

/** A template's text, filled; empty when the setting names nothing or the file is missing. */
async function templateText(r: string, rel: string, title: string): Promise<string> {
  if (!rel) return "";
  const p = /\.md$/i.test(rel) ? rel : `${rel}.md`;
  try { return fillTemplate(await noteText(r, p), { title }); } catch { return ""; }
}

// ---- rows -------------------------------------------------------------------------------

const hint = (id: string, name: string, subtitle?: string, actions: Action[] = [], icon: string = ICON.info): Item => ({ id: `hint:${id}`, name, subtitle, icon, actions });

/** What a failed listing shows: the setting to fill, the folder to restore, or what went wrong. */
function failure(e: unknown): Item[] {
  if (e instanceof NoVault) {
    return e.reason === "unset"
      ? [hint("vault", "Set the vault folder", "Settings, Extensions, Obsidian: the folder Obsidian opens; found by itself once Obsidian has opened one", [{ id: "settings", title: "Open settings" }], ICON.cog)]
      : [hint("vault", "The vault folder is missing", `${e.path} is not there; Settings, Extensions, Obsidian names it`, [{ id: "settings", title: "Open settings" }], ICON.alert)];
  }
  console.error(`[obsidian] ${e instanceof Error ? e.message : String(e)}`);
  return [hint("error", "The vault could not be read", `${e instanceof Error ? e.message : String(e)}; cmd+r tries again`, [], ICON.alert)];
}

const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };
const failToast = (title: string, e: unknown): Effect => ({ keep: true, toast: { title, message: e instanceof Error ? e.message : String(e), style: "failure" } });

const nid = (path: string) => `note:${path}`;
const pathOf = (id: string) => (id.startsWith("note:") ? id.slice(5) : undefined);

/** Open in Obsidian or in the editor first, per `open_with`; the other on cmd+enter. */
function noteActions(): Action[] {
  const editorFirst = conf().open_with === "editor";
  const obsidian: Action = { id: "obsidian", title: "Open in Obsidian" };
  const editor: Action = { id: "editor", title: "Open in editor" };
  return [
    ...(editorFirst ? [editor, { ...obsidian, shortcut: "cmd+enter" }] : [obsidian, { ...editor, shortcut: "cmd+enter" }]),
    { id: "copy-link", title: "Copy wikilink", shortcut: "cmd+c" },
    { id: "read", title: "Read in pal", shortcut: "cmd+shift+r" },
    { id: "backlinks", title: "Backlinks", shortcut: "cmd+b" },
    { id: "outgoing", title: "Outgoing links", shortcut: "cmd+l" },
    { id: "copy-path", title: "Copy path", shortcut: "cmd+shift+c" },
  ];
}

function noteRow(n: Note, actions: Action[], extra: Partial<Item> = {}): Item {
  return {
    id: nid(n.path),
    name: n.title,
    subtitle: n.description,
    icon: ICON.note,
    keywords: [...(n.name !== n.title ? [n.name] : []), ...n.aliases, ...n.tags.map((t) => `#${t}`), ...(n.folder ? [n.folder] : [])],
    section: n.folder || "Vault",
    accessories: [...n.tags.slice(0, TAGS_ON_ROW).map((t) => ({ tag: t })), { date: Math.round(n.mtime) }],
    actions,
    ...extra,
  };
}

const COMMANDS: Item[] = [
  { id: "cmd:today", name: "Today's note", subtitle: "Open today's daily note; created from the template when missing", icon: ICON.today, keywords: ["daily", "journal", "log"], section: "Obsidian", actions: [{ id: "open", title: "Open today's note" }, { id: "append", title: "Append to today", shortcut: "cmd+enter" }] },
  { id: "cmd:new", name: "New note", subtitle: "A note by title in a folder of the vault", icon: ICON.plus, keywords: ["create", "write"], section: "Obsidian", actions: [{ id: "new", title: "New note" }] },
  { id: "cmd:search", name: "Search notes", subtitle: "Full-text over every note", icon: ICON.search, keywords: ["find", "grep"], section: "Obsidian", actions: [{ id: "search", title: "Search" }, { id: "obsidian", title: "Search in Obsidian", shortcut: "cmd+enter" }] },
  { id: "cmd:random", name: "Random note", subtitle: "Open one at random", icon: ICON.random, keywords: ["shuffle", "surprise"], section: "Obsidian", actions: [{ id: "open", title: "Open a random note" }] },
];

// ---- notes: every note, or the ones a push asks for --------------------------------------------

type NotesArgs = { tag?: string; backlinks?: string; outgoing?: string };

async function noteRows(ctx?: Ctx): Promise<Item[]> {
  const args = (ctx?.args ?? {}) as NotesArgs;
  const i = await ix(!!ctx?.refresh);
  const actions = noteActions();
  if (args.tag) {
    const t = args.tag.toLowerCase();
    const rows = i.notes.filter((n) => n.tags.some((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(`${t}/`))).sort((a, b) => b.mtime - a.mtime).map((n) => noteRow(n, actions));
    return rows.length ? rows : [hint("none", `No note tagged #${args.tag}`, "Tags counts what the index saw; cmd+r rebuilds it")];
  }
  if (args.backlinks !== undefined) return backlinkRows(i, args.backlinks, actions);
  if (args.outgoing !== undefined) return outgoingRows(i, args.outgoing, actions);
  const rows = i.notes.map((n) => noteRow(n, actions));
  if (!rows.length) rows.push(hint("empty", "The vault has no notes", `Nothing ends in .md under ${i.root}; New note starts one`, [{ id: "new", title: "New note" }], ICON.plus));
  return [...COMMANDS, ...rows];
}

/** The note opened or read last, for Backlinks and Outgoing links with nothing pushed. */
const remember = (path: string) => storage.set("last", path, EXTENSION).catch(() => {});
const last = () => storage.get<string>("last", EXTENSION).catch(() => null);

async function target(i: Index, path: string | undefined): Promise<Note | undefined> {
  const p = path || (await last());
  return p ? i.byPath.get(p) : undefined;
}

async function backlinkRows(i: Index, path: string | undefined, actions: Action[]): Promise<Item[]> {
  const t = await target(i, path);
  if (!t) return [hint("none", "Open a note first", "Backlinks lists what links to the note you opened last; pick one in Notes or Search", [], ICON.link)];
  const from = (i.backlinks.get(t.path) ?? []).map((p) => i.byPath.get(p)).filter((n): n is Note => !!n).sort((a, b) => b.mtime - a.mtime);
  if (!from.length) return [hint("none", `Nothing links to ${cut(t.title, 40)}`, `A [[${t.name}]] in another note would show here`, [], ICON.link)];
  return from.map((n) => noteRow(n, actions, { section: `Links to ${cut(t.title, 40)}`, icon: ICON.link }));
}

async function outgoingRows(i: Index, path: string | undefined, actions: Action[]): Promise<Item[]> {
  const t = await target(i, path);
  if (!t) return [hint("none", "Open a note first", "Outgoing links lists what the note you opened last links to; pick one in Notes or Search", [], ICON.out)];
  if (!t.links.length) return [hint("none", `${cut(t.title, 40)} links to nothing`, "A [[wikilink]] in it would show here", [], ICON.out)];
  const section = `From ${cut(t.title, 40)}`;
  return t.links.map((l) => {
    const n = resolve(l, i.notes);
    if (n) return noteRow(n, actions, { section, icon: ICON.out });
    return { id: `missing:${l}`, name: l, subtitle: "Not a note yet", icon: ICON.missing, section, actions: [{ id: "create", title: "Create the note" }, { id: "copy-link", title: "Copy wikilink", shortcut: "cmd+c" }] };
  });
}

// ---- opening, reading, the pane -------------------------------------------------------------------

/** Obsidian's own URI: the app switches to the vault and the file. */
const openInObsidian = (i: Index, path: string): Effect => ({ open: obsidianUrl(i.name, path) });

/** The editor setting split on spaces with the file's absolute path last; the OS opener for the empty setting. */
function openInEditor(i: Index, path: string): Effect {
  const cmd = conf().editor?.trim();
  const abs = join(i.root, path);
  if (!cmd) return { open: abs };
  const argv = cmd.split(/\s+/);
  if (!Bun.which(argv[0]) && !argv[0].startsWith("/")) return { keep: true, toast: { title: `${argv[0]} is not on PATH`, message: "Settings, Extensions, Obsidian: the editor command", style: "failure" } };
  try {
    Bun.spawn([...argv, abs], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  } catch (e) { return failToast("Could not start the editor", e); }
  return { hud: `Opened ${basename(path, ".md")} in ${basename(argv[0])}` };
}

const open = (i: Index, path: string, how?: "obsidian" | "editor"): Effect => ((how ?? conf().open_with) === "editor" ? openInEditor(i, path) : openInObsidian(i, path));

/** Obsidian's own syntax made plain for the pane's renderer: front matter off, `> [!TYPE]` a bold lead, `[[links]]` as links into Obsidian, `#tags` kept. */
export function paneMarkdown(text: string, vault: string, notes: Note[]): string {
  let b = unescapePipes(frontMatter(text).body)
    .replace(/^>[ \t]*\[!(\w+)\][+-]?[ \t]*(.*)$/gm, (_, t: string, rest: string) => `> **${t[0].toUpperCase() + t.slice(1).toLowerCase()}${rest ? `: ${rest}` : ""}**`)
    .replace(/!?\[\[([^\]|#]*)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t: string, h: string | undefined, label?: string) => {
      const n = resolve(t, notes);
      const text = (label ?? (t + (h ?? ""))).trim() || t;
      return n ? `[${text}](${obsidianUrl(vault, n.path)})` : `${text} (not a note yet)`;
    });
  if (b.length > PANE_CHARS) b = b.slice(0, PANE_CHARS) + "\n\n…";
  return b.trim() || "_Nothing in this note yet._";
}

async function noteDetail(i: Index, n: Note): Promise<Detail> {
  const text = await noteText(i.root, n.path);
  const back = (i.backlinks.get(n.path) ?? []).map((p) => i.byPath.get(p)?.title ?? p);
  const links = n.links.map((l) => ({ text: l, color: resolve(l, i.notes) ? undefined : "grey" }));
  const meta: Metadata[] = [
    { label: "Path", value: n.path },
    { label: "Modified", value: formatDate("YYYY-MM-DD HH:mm", new Date(n.mtime)) },
    { label: "Words", value: String(n.words) },
    ...(n.tags.length ? [{ label: "Tags", tags: n.tags.map((t) => ({ text: t })) }] : []),
    ...(n.aliases.length ? [{ label: "Aliases", value: n.aliases.join(", ") }] : []),
    ...(links.length ? [{ label: "Links", tags: links.slice(0, 8) }] : []),
    { label: "Backlinks", value: back.length ? `${back.length}: ${cut(back.join(", "), 120)}` : "none" },
  ];
  return { markdown: paneMarkdown(text, i.name, i.notes), metadata: meta };
}

/** The note drawn as a view: the title, where it lives, then the body through the markdown renderer. */
async function noteView(i: Index, n: Note): Promise<View> {
  const text = await noteText(i.root, n.path);
  const line = [n.folder || "vault", `${n.words} words`, ...(n.tags.length ? [n.tags.map((t) => `#${t}`).join(" ")] : []), `${(i.backlinks.get(n.path) ?? []).length} backlinks`].join(" · ");
  const body = renderMd(frontMatter(text).body, { padding: 0, width: 660, dropTitle: n.title });
  return {
    id: nid(n.path),
    title: cut(n.title, 60),
    tree: { type: "stack", gap: 3, padding: 4, children: [
      { type: "stack", gap: 0, children: [{ type: "text", value: n.title, style: "title", size: "xl" }, { type: "text", value: line, style: "muted", size: "xs" }] },
      { type: "divider" },
      body.tree,
    ] },
    actions: [
      { id: "obsidian", title: "Open in Obsidian" },
      { id: "editor", title: "Open in editor", shortcut: "cmd+enter" },
      { id: "copy-link", title: "Copy wikilink", shortcut: "cmd+c" },
      { id: "backlinks", title: "Backlinks", shortcut: "cmd+b" },
      { id: "outgoing", title: "Outgoing links", shortcut: "cmd+l" },
      { id: "copy-markdown", title: "Copy markdown", shortcut: "cmd+shift+c" },
    ],
  };
}

async function pickNote(path: string, action?: string): Promise<Effect | void> {
  const i = await ix();
  const n = i.byPath.get(path);
  if (!n) throw new Error(`no note ${path}`);
  switch (action) {
    case "editor": await remember(path); return open(i, path, "editor");
    case "obsidian": await remember(path); return open(i, path, "obsidian");
    case "copy-link": return { copy: wikilink(n, i.notes) };
    case "copy-path": return { copy: join(i.root, path) };
    case "copy-markdown": return { copy: await noteText(i.root, path) };
    case "read": await remember(path); return { view: await noteView(i, n) };
    case "backlinks": await remember(path); return { push: { extension: EXTENSION, palette: "backlinks", args: { path } } };
    case "outgoing": await remember(path); return { push: { extension: EXTENSION, palette: "outgoing", args: { path } } };
    default: await remember(path); return open(i, path);
  }
}

// ---- daily ------------------------------------------------------------------------------------

/** Creates the daily note for `day` from the template when it is missing; answers its path and whether it was made. */
async function ensureDaily(r: string, day: Date): Promise<{ path: string; created: boolean }> {
  const path = await dailyPath(r, day);
  if (await exists(r, path)) return { path, created: false };
  const d = await daily(r);
  await writeNote(r, path, await templateText(r, d.template, basename(path, ".md")));
  return { path, created: true };
}

async function dailyRows(ctx?: Ctx): Promise<Item[]> {
  const r = await root();
  const i = await ix(!!ctx?.refresh);
  const actions = noteActions();
  const now = new Date();
  const rows: Item[] = [];
  const todayPath = await dailyPath(r, now);
  const today = i.byPath.get(todayPath);
  if (today) rows.push(noteRow(today, actions, { section: "Daily notes", icon: ICON.today, subtitle: `Today · ${today.description ?? todayPath}` }));
  else rows.push({ id: "daily:create", name: `Create today's note`, subtitle: `${todayPath}, from the template`, icon: ICON.today, keywords: ["today", "daily"], section: "Daily notes", actions: [{ id: "create", title: "Create today's note", confirm: CREATE_CONFIRM }] });
  const yPath = await dailyPath(r, dayAfter(now, -1));
  const y = i.byPath.get(yPath);
  if (y) rows.push(noteRow(y, actions, { section: "Daily notes", icon: ICON.today, subtitle: `Yesterday · ${y.description ?? yPath}` }));
  for (let k = 2; k < 7; k++) {
    const n = i.byPath.get(await dailyPath(r, dayAfter(now, -k)));
    if (n) rows.push(noteRow(n, actions, { section: "This week", icon: ICON.week }));
  }
  rows.push(
    { id: "append", name: "Append to today", subtitle: "A line onto today's note, from the clipboard or what you type", icon: ICON.append, keywords: ["log", "journal", "add"], section: "Write", actions: [{ id: "append", title: "Append to today" }] },
    { id: "new", name: "New note", subtitle: "A note by title in a folder of the vault", icon: ICON.plus, keywords: ["create", "write"], section: "Write", actions: [{ id: "new", title: "New note" }] },
  );
  return rows;
}

// ---- forms: append to today, new note -----------------------------------------------------------

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** What a body starts as: the front app's selection, else the clipboard's text; empty past `PREFILL_MAX`. */
async function prefill(): Promise<string> {
  const sel = await selection.text().catch(() => null);
  if (sel?.trim()) return sel.length > PREFILL_MAX ? "" : sel;
  const c = await clipboard.current().catch(() => null);
  if (c?.kind === "text" && c.text) return c.text.length <= PREFILL_MAX ? c.text : "";
  const first = (await clipboard.list({ kind: "text", limit: 1 }).catch(() => []))[0]?.text ?? "";
  return first.length <= PREFILL_MAX ? first : "";
}

/** `{selection}`, `{clipboard}`, `{date}`, `{time}`, `{datetime}`, `{uuid}` as Snippets fills them. */
const SOURCES = { clipboard: async () => (await clipboard.current().catch(() => null))?.text ?? (await clipboard.list({ kind: "text", limit: 1 }).catch(() => []))[0]?.text ?? "", selection: selection.text };

async function appendForm(values?: FormValues, errors?: Record<string, string>): Promise<Form> {
  const r = await root();
  const path = await dailyPath(r, new Date());
  return {
    id: "append",
    title: "Append to today",
    fields: [
      { kind: "textarea", id: "text", label: "Text", required: true, default: values ? str(values.text) : await prefill(), placeholder: "What happened, a link, a thought", description: `Added as a new line at the end of ${path}. {selection}, {clipboard}, {date} and {time} are filled in.` },
    ],
    submit: { id: "append:save", title: "Append" },
    errors,
  };
}

async function saveAppend(values: FormValues): Promise<Effect> {
  const raw = str(values.text);
  if (!raw.trim()) return { form: await appendForm(values, { text: "Required" }) };
  try {
    const r = await root();
    const text = await expand(raw, SOURCES);
    const { path } = await ensureDaily(r, new Date());
    await appendNote(r, path, text);
    return { hud: `Appended to ${basename(path, ".md")}` };
  } catch (e) {
    return { form: await appendForm(values, { text: e instanceof Error ? e.message : String(e) }) };
  }
}

async function newForm(values?: FormValues, errors?: Record<string, string>, folder?: string): Promise<Form> {
  const i = await ix();
  const s = conf();
  const folders = ["", ...i.folders.filter(Boolean)];
  const body = values ? str(values.body) : (await templateText(i.root, s.template?.trim() ?? "", "")) || (await prefill());
  return {
    id: "new",
    title: "New note",
    fields: [
      { kind: "text", id: "title", label: "Title", required: true, default: str(values?.title), placeholder: "What the note is about", description: "The file name too; Obsidian's forbidden characters become dashes." },
      { kind: "select", id: "folder", label: "Folder", options: folders.map((f) => ({ id: f, title: f || "/ (the vault)" })), default: str(values?.folder ?? folder ?? "") },
      { kind: "textarea", id: "body", label: "Body", default: body, placeholder: "# Title\n\nMarkdown, [[wikilinks]], #tags", description: s.template?.trim() ? `Starts as the template ${s.template.trim()}, {{title}} and {{date}} filled.` : "Starts as your selection or the clipboard's text; a template setting replaces that." },
    ],
    submit: { id: "new:save", title: "Create note" },
    errors,
  };
}

async function saveNew(values: FormValues): Promise<Effect> {
  const title = str(values.title).trim(), folder = str(values.folder).replace(/^\/+|\/+$/g, ""), body = str(values.body);
  const name = fileName(title);
  if (!name) return { form: await newForm(values, { title: "Required" }) };
  try {
    const i = await ix();
    const path = `${folder ? `${folder}/` : ""}${name}.md`;
    if (await exists(i.root, path)) return { form: await newForm(values, { title: `${path} is there already` }) };
    await writeNote(i.root, path, fillTemplate(body, { title: name }));
    await remember(path);
    const j = await ix(true);
    return { ...open(j, path), hud: `Created ${name}` };
  } catch (e) {
    return { form: await newForm(values, { title: e instanceof Error ? e.message : String(e) }) };
  }
}

// ---- search ------------------------------------------------------------------------------------

const searchHint = () => hint("search", "Search every note's text", BACKEND === "rg" ? "Words as typed, case-insensitive; ripgrep over the vault" : "Words as typed, case-insensitive; a scan of the vault, 1 s at most", [{ id: "obsidian", title: "Search in Obsidian" }], ICON.search);

const mark = (line: string, q: string) => line.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => `**${m}**`);

async function searchRows(query = ""): Promise<Item[]> {
  const q = query.trim();
  if (q.length < 2) return [searchHint()];
  const i = await ix();
  const hits = await search(q, i, conf().exclude ?? []);
  if (!hits.length) return [hint("empty", `No note has “${q}”`, "Titles are matched at the root; this is the text", [{ id: "obsidian", title: "Search in Obsidian" }], ICON.search)];
  const actions = noteActions();
  return hits.map((h) => {
    const n = i.byPath.get(h.path)!;
    const lines = h.lines.map((l) => ({ n: l.n, text: plainLine(l.text.replace(/^[\s>#*+-]+/, "").replace(/\s+/g, " ")) }));
    const first = lines[0]?.text ?? "";
    return noteRow(n, actions, {
      subtitle: first ? cut(first, 120) : n.description,
      accessories: [{ text: `${h.lines.length} line${h.lines.length === 1 ? "" : "s"}` }, { date: Math.round(n.mtime) }],
      detail: { markdown: lines.map((l) => `${l.n}: ${mark(l.text, q)}`).join("  \n") || "_No matching line._", metadata: [{ label: "Path", value: n.path }] },
    });
  });
}

// ---- tags, recent ----------------------------------------------------------------------------------

async function tagRows(ctx?: Ctx): Promise<Item[]> {
  const i = await ix(!!ctx?.refresh);
  const counts = new Map<string, { tag: string; n: number }>();
  for (const n of i.notes) for (const t of n.tags) { const k = t.toLowerCase(); const c = counts.get(k) ?? { tag: t, n: 0 }; c.n++; counts.set(k, c); }
  const rows = [...counts.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag)).map((c): Item => ({
    id: `tag:${c.tag}`, name: `#${c.tag}`, icon: ICON.tag, keywords: c.tag.split("/"),
    accessories: [{ text: `${c.n} note${c.n === 1 ? "" : "s"}` }],
    actions: [{ id: "notes", title: "Notes with the tag" }, { id: "copy", title: "Copy tag", shortcut: "cmd+c" }],
  }));
  return rows.length ? rows : [hint("none", "No tags", "A #tag in a note's text or a tags: line in its front matter shows here", [], ICON.tag)];
}

async function recentRows(ctx?: Ctx): Promise<Item[]> {
  const i = await ix(!!ctx?.refresh);
  const actions = noteActions();
  const rows = i.notes.slice().sort((a, b) => b.mtime - a.mtime).slice(0, RECENT).map((n) => noteRow(n, actions, { section: undefined, subtitle: [n.folder || undefined, n.description].filter(Boolean).join(" · ") || undefined, icon: ICON.history }));
  return rows.length ? rows : [hint("empty", "The vault has no notes", "New note starts one", [{ id: "new", title: "New note" }], ICON.plus)];
}

// ---- picks ----------------------------------------------------------------------------------------

async function pickCommand(id: string, action?: string): Promise<Effect | void> {
  switch (id) {
    case "cmd:today": {
      if (action === "append") return { form: await appendForm() };
      const r = await root();
      const { path, created } = await ensureDaily(r, new Date());
      const i = await ix(created);
      await remember(path);
      return { ...open(i, path), ...(created ? { hud: `Created ${basename(path, ".md")}` } : {}) };
    }
    case "cmd:new": return { form: await newForm() };
    case "cmd:search": { const i = await ix(); return action === "obsidian" ? { open: obsidianSearchUrl(i.name, "") } : { push: { extension: EXTENSION, palette: "search" } }; }
    case "cmd:random": {
      const i = await ix();
      if (!i.notes.length) return { keep: true, toast: { title: "The vault has no notes", style: "failure" } };
      const n = i.notes[Math.floor(Math.random() * i.notes.length)];
      await remember(n.path);
      return open(i, n.path);
    }
  }
}

async function pickAny(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) {
    if (id === "hint:vault" || action === "settings") return { open: "pal://settings/extensions" };
    if (action === "new") return { form: await newForm() };
    if (action === "obsidian") { const i = await ix(); return { open: obsidianSearchUrl(i.name, "") }; }
    return;
  }
  if (id.startsWith("cmd:")) return pickCommand(id, action);
  if (id === "append") return action === "append:save" ? saveAppend(ctx?.values ?? {}) : { form: await appendForm() };
  if (id === "new") return action === "new:save" ? saveNew(ctx?.values ?? {}) : { form: await newForm() };
  if (id === "daily:create") {
    const r = await root();
    const { path } = await ensureDaily(r, new Date());
    const i = await ix(true);
    await remember(path);
    return { ...open(i, path), hud: `Created ${basename(path, ".md")}` };
  }
  if (id.startsWith("tag:")) {
    const tag = id.slice(4);
    return action === "copy" ? { copy: `#${tag}` } : { push: { extension: EXTENSION, palette: "notes", args: { tag } satisfies NotesArgs } };
  }
  if (id.startsWith("missing:")) {
    const l = id.slice(8);
    if (action === "copy-link") return { copy: `[[${l}]]` };
    const i = await ix();
    const path = `${l.replace(/^\/+/, "")}.md`;
    if (!(await exists(i.root, path))) await writeNote(i.root, path, `# ${basename(l)}\n`);
    await remember(path);
    return { ...open(await ix(true), path), hud: `Created ${basename(l)}` };
  }
  const path = pathOf(id);
  if (path !== undefined) return pickNote(path, action);
  throw new Error(`no row ${id}`);
}

const noteDetailOf = async (id: string): Promise<Detail | void> => {
  const path = pathOf(id);
  if (path === undefined) return;
  try { const i = await ix(); const n = i.byPath.get(path); return n ? await noteDetail(i, n) : undefined; } catch (e) { return { markdown: `_${e instanceof Error ? e.message : String(e)}_` }; }
};

/** A link's `path`: relative with or without `.md`, or a note's name as a wikilink would say it. */
async function noteByRef(i: Index, ref: string): Promise<Note> {
  const rel = ref.trim().replace(/^\/+/, "");
  const n = i.byPath.get(rel) ?? i.byPath.get(`${rel}.md`) ?? resolve(rel, i.notes);
  if (!n) throw new Error(`no note "${ref}"`);
  return n;
}

export default {
  // `pal://obsidian/open?path=`, `pal://obsidian/new?title=&body=&folder=`, `pal://obsidian/append-today?text=`.
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route === "open") { const i = await ix(); const n = await noteByRef(i, String(params.path)); await remember(n.path); return open(i, n.path); }
    if (route === "append-today") {
      const r = await root();
      const { path } = await ensureDaily(r, new Date());
      await appendNote(r, path, await expand(String(params.text), SOURCES));
      return { hud: `Appended to ${basename(path, ".md")}` };
    }
    if (route === "new") {
      const e = await saveNew({ title: String(params.title), body: str(params.body), folder: str(params.folder) });
      if (e.form) throw new Error(Object.values(e.form.errors ?? {})[0] ?? "could not create the note");
      return e;
    }
  },
  palettes: {
    notes: {
      title: "Notes",
      placeholder: "A note by title, alias, tag or folder",
      list: (_q, ctx) => guard(() => noteRows(ctx)),
      pick: pickAny,
      detail: noteDetailOf,
    },
    search: {
      title: "Search Notes",
      input: true,
      placeholder: "Words in any note",
      list: (query) => guard(() => searchRows(query)),
      pick: pickAny,
    },
    daily: {
      title: "Daily Notes",
      live: true,
      placeholder: "Today, yesterday, this week",
      list: (_q, ctx) => guard(() => dailyRows(ctx)),
      pick: pickAny,
      detail: noteDetailOf,
    },
    tags: {
      title: "Tags",
      placeholder: "A tag",
      list: (_q, ctx) => guard(() => tagRows(ctx)),
      pick: pickAny,
    },
    recent: {
      title: "Recent Notes",
      live: true,
      placeholder: "A note changed lately",
      list: (_q, ctx) => guard(() => recentRows(ctx)),
      pick: pickAny,
      detail: noteDetailOf,
    },
    backlinks: {
      title: "Backlinks",
      placeholder: "A linking note",
      list: (_q, ctx) => guard(async () => backlinkRows(await ix(!!ctx?.refresh), (ctx?.args as { path?: string } | undefined)?.path, noteActions())),
      pick: pickAny,
      detail: noteDetailOf,
    },
    outgoing: {
      title: "Outgoing Links",
      placeholder: "A linked note",
      list: (_q, ctx) => guard(async () => outgoingRows(await ix(!!ctx?.refresh), (ctx?.args as { path?: string } | undefined)?.path, noteActions())),
      pick: pickAny,
      detail: noteDetailOf,
    },
  },
  dispose,
} satisfies Extension;
