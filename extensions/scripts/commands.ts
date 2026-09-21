// Single-file script commands: every executable file in the `commands`
// folder whose header carries `# @pal.*` tags (Raycast's `@raycast.*`
// accepted as aliases, so a Raycast script command drops in unchanged) is
// one row of the Commands palette. The header says the title, the icon,
// the mode (`silent`, `hud`, `show`, `list`, `inline`), the arguments
// (typed into the search bar; a form for a pick that arrives without
// them), whether to confirm, the keywords. The folder is watched, so a
// saved file is read again on the next listing, and the palette is live
// so an `inline` command's first output line is current on every show.
import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { argsForm, effects, errorMessage, hint, home, tile, TILE_COLORS, toast, type Action, type Arg as BarArg, type Ctx, type Effect, type Item, type Palette, type TileColor } from "@zcag/pal";
import { accessory, detail, glyph, log, parseLines, run, S, toActions, type Raw } from "./shared.ts";

export type Mode = "silent" | "hud" | "show" | "list" | "inline";
type Arg = { name: string; placeholder: string; optional?: boolean };
export type Command = {
  /** The file name, the row's id (readable in `item_hotkeys`). */
  id: string;
  path: string;
  title: string;
  subtitle?: string;
  icon?: Item["icon"];
  mode: Mode;
  args: Arg[];
  confirm: boolean;
  keywords: string[];
  section?: string;
  cwd: string;
  /** Seconds an `inline` command's output is kept before it runs again. */
  refresh: number;
};

const MODES: Record<string, Mode> = { silent: "silent", hud: "hud", compact: "hud", show: "show", fulloutput: "show", list: "list", inline: "inline" };
/** md-script_text_outline: a command with no icon of its own. */
const SCRIPT_GLYPH = "\u{f0bc3}";
/** md-alert_circle_outline: a hint row about a command that went wrong. */
const ALERT_GLYPH = "\u{f05d6}";
/** A PNG or JPEG icon next to the script is inlined as a data url up to this size; the panel cannot load a file path. */
const MAX_ICON_BYTES = 64 * 1024;
const HEADER_LINES = 60;
const TAG = /^\s*(?:#|\/\/|--|;+|\*)\s*@(?:pal|raycast)\.(\w+)\s+(.*?)\s*$/;
const DEFAULT_REFRESH = 60;
const DEFAULT_FOLDER = "~/.config/pal/commands";

/** `10s`, `2m`, `1h`, `30` (seconds): Raycast's refreshTime spelling. */
export function seconds(s: string): number | undefined {
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);
  if (!m) return;
  const n = Number(m[1]);
  return { ms: n / 1000, s: n, m: n * 60, h: n * 3600, d: n * 86400 }[m[2] ?? "s"];
}

/** The `@pal.*` / `@raycast.*` tags of a file's first lines, by name, repeated tags as a list. */
export function tags(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of text.split("\n").slice(0, HEADER_LINES)) {
    const m = line.match(TAG);
    if (m) (out[m[1].toLowerCase()] ??= []).push(m[2]);
  }
  return out;
}

/** Raycast's `argument1 { "type": "text", "placeholder": "Query", "optional": true }` or pal's `args name placeholder…`. */
function parseArgs(t: Record<string, string[]>): Arg[] {
  const out: Arg[] = [];
  for (const line of t.args ?? t.arg ?? []) {
    const [name, ...rest] = line.split(/\s+/);
    if (name) out.push({ name, placeholder: rest.join(" ") || name, optional: rest.some((w) => w === "(optional)") });
  }
  for (const key of Object.keys(t).filter((k) => /^argument\d+$/.test(k)).sort()) {
    for (const json of t[key]) {
      try {
        const a = JSON.parse(json);
        out.push({ name: key, placeholder: String(a.placeholder ?? key), optional: a.optional === true });
      } catch { log(`${key}: not JSON, skipped`); }
    }
  }
  return out;
}

/** The icon a header names: an emoji or glyph, a hex colour, a brand colour (a tile), an image next to the script (inlined), a url. */
function parseIcon(raw: string | undefined, dir: string): Item["icon"] | undefined {
  if (!raw) return;
  const s = raw.trim();
  if ((TILE_COLORS as readonly string[]).includes(s)) return tile(s as TileColor, SCRIPT_GLYPH);
  const g = glyph(s);
  if (g) return g;
  if (/^https?:\/\//.test(s)) return { image: s };
  const path = isAbsolute(s) ? s : resolve(dir, s);
  const ext = extname(path).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".svg" ? "image/svg+xml" : undefined;
  if (!mime || !existsSync(path)) return;
  if (statSync(path).size > MAX_ICON_BYTES) { log(`${path}: icon over ${MAX_ICON_BYTES} bytes, skipped`); return; }
  return { image: `data:${mime};base64,${readFileSync(path).toString("base64")}` };
}

/** One executable file with a `title` tag is a command; anything else answers undefined. */
export function parse(path: string): Command | undefined {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return; }
  const t = tags(text);
  const title = t.title?.[0];
  if (!title) return;
  const first = (k: string) => t[k]?.[0];
  const dir = dirname(path);
  const cwd = first("cwd") ?? first("currentdirectorypath");
  return {
    id: basename(path),
    path,
    title,
    subtitle: first("description") ?? first("subtitle"),
    icon: parseIcon(first("icon"), dir),
    mode: MODES[(first("mode") ?? "hud").toLowerCase()] ?? "hud",
    args: parseArgs(t),
    confirm: /^(true|yes|1)$/i.test(first("confirm") ?? first("needsconfirmation") ?? ""),
    keywords: (t.keyword ?? t.keywords ?? []).flatMap((k) => k.split(/[\s,]+/)).filter(Boolean),
    section: first("section") ?? first("packagename"),
    cwd: cwd ? (isAbsolute(home(cwd)) ? home(cwd) : resolve(dir, cwd)) : dir,
    refresh: seconds(first("refresh") ?? first("refreshtime") ?? "") ?? DEFAULT_REFRESH,
  };
}

const isExecutable = (path: string) => { try { const st = statSync(path); return st.isFile() && (st.mode & 0o111) !== 0; } catch { return false; } };

/** Every command in the folder, by file name; `.template.` files and dotfiles are skipped as Raycast skips them. */
export function scan(folder: string): Command[] {
  let names: string[];
  try { names = readdirSync(folder); } catch { return []; }
  return names
    .filter((n) => !n.startsWith(".") && !n.includes(".template."))
    .sort()
    .map((n) => join(folder, n))
    .filter(isExecutable)
    .flatMap((p) => { const c = parse(p); return c ? [c] : []; });
}

// ---- running ---------------------------------------------------------------------------

const argv = (c: Command, values?: Record<string, unknown>) => [c.path, ...c.args.map((a) => String(values?.[a.name] ?? ""))];

/** The first non-empty line, cut to a HUD's width. */
const firstLine = (s: string) => { const l = s.split("\n").map((x) => x.trim()).find(Boolean) ?? ""; return l.length > 80 ? `${l.slice(0, 79)}…` : l; };

const failure = (c: Command, r: { err: string; code: number | null; timedOut: boolean }) => `${c.title}: ${r.timedOut ? `killed after ${S().timeout} s` : firstLine(r.err) || `exited ${r.code}`}`;

/**
 * Runs the command detached from the pick and hands what it said to the
 * HUD when it ends: silent says nothing unless it failed, hud the first
 * output line ("Done" with none), show pushes the whole output as a level.
 */
async function runLater(c: Command, values?: Record<string, unknown>): Promise<void> {
  const r = await run(argv(c, values), { cwd: c.cwd, timeout: S().timeout, stderr: "pipe" });
  const effect: Effect | undefined = !r.ok
    ? { hud: failure(c, r) }
    : c.mode === "silent" ? undefined
    : c.mode === "show" ? { push: { extension: "scripts", palette: "commands", args: { show: c.id, out: r.out } } }
    : { hud: `${c.title}: ${firstLine(r.out) || "Done"}` };
  if (effect) await effects.run(effect).catch((e) => log(`${c.id}: ${errorMessage(e)}`));
}

/** A run the pick waits for: Copy output wants the text back in the pick's own effect. */
async function runNow(c: Command, values?: Record<string, unknown>) {
  return run(argv(c, values), { cwd: c.cwd, timeout: Math.min(S().timeout, 8), stderr: "pipe" });
}

// ---- rows -------------------------------------------------------------------------------

const RUN: Action = { id: "run", title: "Run" };
const OPEN: Action = { id: "open", title: "Open script", shortcut: "cmd+o" };
const COPY_OUTPUT: Action = { id: "copy_output", title: "Copy output", shortcut: "cmd+c" };
/** The header's arguments as the row's (`Item.args`): typed in the bar before Run or Copy output; the values reach the script as `$1..$n` in header order. */
const barArgs = (c: Command): BarArg[] => c.args.map((a) => ({ id: a.name, placeholder: a.placeholder, required: !a.optional }));
const COPY_PATH: Action = { id: "copy_path", title: "Copy path", shortcut: "cmd+shift+c" };

/** An `inline` command's last output, by id, with when it was made. */
const inline = new Map<string, { at: number; text: string }>();

async function inlineText(c: Command): Promise<string> {
  const had = inline.get(c.id);
  if (had && Date.now() - had.at < c.refresh * 1000) return had.text;
  const r = await run(argv(c), { cwd: c.cwd, timeout: Math.min(S().timeout, 8), stderr: "pipe" });
  const text = r.ok ? firstLine(r.out) : failure(c, r);
  inline.set(c.id, { at: Date.now(), text });
  return text;
}

function row(c: Command, subtitle: string | undefined): Item {
  const verb = c.mode === "list" ? "Open" : "Run";
  // A command with arguments takes them in the bar first; a confirm on top would come before the values are typed.
  const run: Action = { ...RUN, title: verb, ...(c.confirm && !c.args.length && { confirm: `${c.title}?` }) };
  return {
    id: c.id,
    name: c.title,
    subtitle,
    icon: c.icon ?? SCRIPT_GLYPH,
    keywords: c.keywords.length ? c.keywords : undefined,
    section: c.section,
    accessories: c.mode !== "hud" ? [{ text: c.mode }] : undefined,
    detail: { metadata: [{ label: "File", value: c.path }, { label: "Mode", value: c.mode }, ...(c.args.length ? [{ label: "Arguments", value: c.args.map((a) => a.name).join(", ") }] : []), ...(c.confirm ? [{ label: "Confirm", value: "yes" }] : []), { label: "Runs in", value: c.cwd }] },
    // Run and Copy output both run the script, so both take the values (marking one alone would leave the other bare).
    ...(c.args.length && { args: barArgs(c) }),
    actions: c.args.length ? [{ ...run, args: true }, OPEN, { ...COPY_OUTPUT, args: true }, COPY_PATH] : [run, OPEN, COPY_OUTPUT, COPY_PATH],
  };
}


/** The rows a `list` command printed: JSON lines or a JSON array of rows, else one row per plain line. */
function listRows(c: Command, out: string): Item[] {
  const trimmed = out.trim();
  let raws: Raw[];
  if (trimmed.startsWith("[")) { try { raws = JSON.parse(trimmed); } catch { raws = []; } }
  else {
    raws = parseLines(out);
    if (!raws.length) raws = out.split("\n").filter((l) => l.trim()).map((l) => ({ name: l.trim() }));
  }
  return raws.filter((r) => r && typeof r === "object").map((r, i) => {
    const { icon_utf, icon, accessories, detail: d, actions, ...rest } = r;
    const id = String(r.id ?? r.name ?? i);
    return {
      ...rest,
      id,
      name: String(r.name ?? id),
      icon: glyph(icon_utf) ?? glyph(icon) ?? c.icon ?? SCRIPT_GLYPH,
      accessories: Array.isArray(accessories) ? accessories.map(accessory).filter((a) => !!a) : undefined,
      detail: detail(d),
      actions: Array.isArray(actions) && actions.length ? toActions(actions) : [{ id: "pick", title: r.url ? "Open" : r.copy !== undefined ? "Copy" : "Pick" }],
    } as Item;
  });
}

/** The rows of a list-mode level, by the row id, for the pick. */
const listed = new Map<string, Map<string, Raw>>();

/** The bar's arguments as a page: what a pick without values (a hotkey, `pal run`, a script) answers, submitted back to the same action. */
const form = (c: Command, submit: { id: string; title: string }, errors?: Record<string, string>) => ({ ...argsForm(barArgs(c), c.title, submit, errors), id: c.id });

// ---- the palette ------------------------------------------------------------------------

export function commands(): { palette: Palette; dispose: () => void } {
  let watcher: FSWatcher | undefined;
  let watched: string | undefined;
  /** The parsed folder, dropped when the watcher sees a change or the setting moves. */
  let cache: Command[] | undefined;

  const folder = () => home(S().commands || DEFAULT_FOLDER);

  function watchFolder(dir: string) {
    if (watched === dir) return;
    watcher?.close();
    watcher = undefined;
    watched = dir;
    if (!existsSync(dir)) return;
    try {
      watcher = watch(dir, () => { cache = undefined; inline.clear(); });
      watcher.on("error", () => { watcher = undefined; watched = undefined; });
      watcher.unref?.();
    } catch (e) {
      log(`watch ${dir} failed: ${errorMessage(e)}`);
    }
  }

  function all(): Command[] {
    const dir = folder();
    if (watched !== dir) { cache = undefined; inline.clear(); }
    watchFolder(dir);
    cache ??= scan(dir);
    return cache;
  }

  const byId = (id: string) => all().find((c) => c.id === id);

  /** Runs the command as its mode says: the fields as a form first when it takes arguments and has none yet. */
  async function start(c: Command, values?: Record<string, unknown>): Promise<Effect> {
    const submit = { id: "run", title: c.mode === "list" ? "Open" : "Run" };
    if (c.args.length && !values) return { form: form(c, submit) };
    const missing = c.args.filter((a) => !a.optional && !String(values?.[a.name] ?? "").trim());
    if (missing.length) return { form: form(c, submit, Object.fromEntries(missing.map((a) => [a.name, "Required"]))) };
    if (c.mode === "list") return { push: { extension: "scripts", palette: "commands", args: { list: c.id, values } } };
    if (c.mode === "inline") inline.delete(c.id);
    void runLater(c, values);
    return { hide: true };
  }

  const palette: Palette = {
    title: "Script Commands",
    live: true,
    placeholder: "Search script commands",
    list: async (_query, ctx?: Ctx) => {
      const args = ctx?.args as { list?: string; values?: Record<string, unknown>; show?: string; out?: string } | undefined;
      if (args?.show !== undefined) {
        const c = byId(args.show);
        return [{ id: "out", name: c?.title ?? args.show, subtitle: "The whole output is in the detail pane (cmd+i)", icon: c?.icon ?? SCRIPT_GLYPH, detail: { markdown: `\`\`\`\n${args.out ?? ""}\n\`\`\`` }, actions: [{ id: "copy_shown", title: "Copy output" }] }];
      }
      if (args?.list !== undefined) {
        const c = byId(args.list);
        if (!c) return [hint("gone", `${args.list} is gone`, "The file left the commands folder", { icon: ALERT_GLYPH })];
        const r = await run(argv(c, args.values), { cwd: c.cwd, timeout: S().timeout, stderr: "pipe" });
        if (!r.ok) return [hint("failed", failure(c, r), "cmd+r runs it again", { icon: ALERT_GLYPH })];
        const rows = listRows(c, r.out);
        listed.set(c.id, new Map(rows.map((row) => [row.id, row as Raw])));
        return rows.length ? rows : [hint("empty", `${c.title} listed nothing`, "The script printed no rows")];
      }
      const cs = all();
      if (!cs.length) return [hint("none", `No script commands in ${S().commands || DEFAULT_FOLDER}`, "An executable file with a # @pal.title line in its header is one row here")];
      return Promise.all(cs.map(async (c) => row(c, c.mode === "inline" ? await inlineText(c) : c.subtitle)));
    },
    pick: async (id, action, ctx?: Ctx) => {
      const args = ctx?.args as { list?: string; values?: Record<string, unknown>; show?: string; out?: string } | undefined;
      if (args?.show !== undefined) return { copy: args.out ?? "" };
      if (args?.list !== undefined) {
        const c = byId(args.list);
        const raw = listed.get(args.list)?.get(id);
        if (!c || !raw) return toast("Row not found", "List again (cmd+r) and retry", "failure");
        if (action && action !== "pick" && raw.actions) {
          const a = (raw.actions as Raw[]).find((x) => String(x.id ?? x.title) === action) ?? {};
          if (a.action === "copy") return { copy: String(a.value ?? raw[a.key ?? "name"] ?? "") };
          if (a.action === "open") return { open: String(a.value ?? raw[a.key ?? "url"] ?? "") };
        }
        if (typeof raw.url === "string") return { open: raw.url };
        if (raw.copy !== undefined) return { copy: String(raw.copy) };
        // A picked row runs the script again with the row's id: `PAL_PICK` in the environment, the same arguments.
        const r = await run(argv(c, args.values), { cwd: c.cwd, timeout: Math.min(S().timeout, 8), stderr: "pipe", env: { PAL_PICK: id } });
        return r.ok ? { hud: `${c.title}: ${firstLine(r.out) || "Done"}` } : toast(failure(c, r), undefined, "failure");
      }
      if (id.startsWith("hint:")) return;
      const c = byId(id);
      if (!c) return toast("Command not found", "The file left the commands folder; cmd+r lists again", "failure");
      switch (action) {
        case "open": return { open: c.path };
        case "copy_path": return { copy: c.path };
        case "copy_output": case "copy_args": {
          if (c.args.length && !ctx?.values) return { form: form(c, { id: "copy_output", title: "Copy output" }) };
          const r = await runNow(c, ctx?.values);
          return r.ok ? { copy: r.out.trimEnd() } : toast(failure(c, r), undefined, "failure");
        }
        // `run`, a bare pick, or `run_args` (the form's submit before the bar took the values; a saved hotkey may still say it).
        default: return start(c, ctx?.values);
      }
    },
  };

  return { palette, dispose: () => { watcher?.close(); watcher = undefined; watched = undefined; } };
}
