// Diff what you copied: a view palette that compares two texts. Opened
// bare it takes the two newest text entries of the clipboard history (the
// older on the left, so the diff reads as what changed on the way to the
// newer one); pushed with args it takes any two sources: a history entry
// by id, what is on the clipboard now, the selection in the app in front,
// a file, a text handed over by a link. `diff.ts` computes, `view.ts`
// draws; this file resolves the sources, keeps a state per open level
// (the toggles, the expanded folds) and answers the keys: `s` side by
// side, `w` whitespace, `x` swap, `space` a fold, `o` an external tool,
// `n` / `e` / `h` / `f` other sources. The second palette, `pick`, lists
// the history so two entries can be chosen by hand (the Clipboard
// History palette's Diff actions land there too).
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ago, appName, clipboard, errorMessage, hint, home, oneLine, selection, settings, tilde, toast, truncate, windows, type Action, type ClipboardEntry, type Ctx, type Effect, type Extension, type Form, type Item, type LinkParams } from "@zcag/pal";
import { compute, summary, unified } from "./diff.ts";
import { foldCount, render, renderEmpty, VIEW_ID_PREFIX, type Side, type State } from "./view.ts";

/** `[extensions.diff]`, defaults in pal.json. */
type Settings = { tool: "auto" | "code" | "opendiff" | "kitty" | "meld" | "custom"; tool_command: string };

const NAME = "diff";
const MAC = process.platform === "darwin";
const HOME = home("~");
/** Where the sides land as files for an external tool; `PAL_DIFF_CACHE` for the tests. */
const CACHE = process.env.PAL_DIFF_CACHE || (MAC ? `${HOME}/Library/Caches/pal/diff` : `${process.env.XDG_CACHE_HOME || `${HOME}/.cache`}/pal/diff`);
/** A file past this is not read into the panel (a megabyte is thousands of lines the view could not draw anyway); the external tool takes it. */
export const MAX_FILE = 1024 * 1024;
/** How many open levels keep their state; an older one is forgotten (its keys then say so). */
const STATES_MAX = 16;
/** Material Design glyphs from the bundled Nerd Font. */
const GLYPH = { text: "\u{f09a8}", pick: "\u{f0ad9}", clipboard: "\u{f014d}" } as const;

// ---- sources -------------------------------------------------------------------------

/** Where a side comes from: what a push's args and a link name. */
export type Source =
  | { kind: "newest"; /** 0 is the newest text entry, 1 the one before. */ index: number }
  | { kind: "entry"; id: number }
  | { kind: "clipboard" }
  | { kind: "selection" }
  | { kind: "file"; path: string }
  | { kind: "text"; text: string; label?: string };
export type Args = { left?: Source; right?: Source };

/** The two newest copies: the older on the left. */
const NEWEST: Required<Args> = { left: { kind: "newest", index: 1 }, right: { kind: "newest", index: 0 } };
const VS_SELECTION: Required<Args> = { left: { kind: "clipboard" }, right: { kind: "selection" } };

class SourceError extends Error {}

const entryTitle = (e: ClipboardEntry) => e.name ?? `“${truncate(oneLine(e.text ?? ""), 40) || "empty"}”`;
const entrySub = (e: ClipboardEntry) => `copied ${ago(e.at)}${e.source_app ? ` from ${appName(e.source_app)}` : ""}`;
const entrySide = (e: ClipboardEntry): Side => ({ text: e.text ?? "", label: entryTitle(e), sub: entrySub(e) });

/** The newest text entries, `n` of them (a page past that is asked when the newest are not text). */
async function newestText(n: number): Promise<ClipboardEntry[]> {
  const out: ClipboardEntry[] = [];
  for (let offset = 0; out.length < n; offset += 50) {
    const page = await clipboard.list({ kind: "text", limit: 50, offset });
    out.push(...page.filter((e) => e.kind === "text"));
    if (page.length < 50) break;
  }
  return out.slice(0, n);
}

/** The app in front, for the selection's label; nothing when the core cannot say. */
const frontApp = () => windows.focused().then((w) => w?.app ?? undefined).catch(() => undefined);

/** A source as a side, or a `SourceError` saying why not. */
export async function resolve(src: Source, which: "left" | "right"): Promise<Side> {
  switch (src.kind) {
    case "newest": {
      const entries = await newestText(src.index + 1);
      const e = entries[src.index];
      if (!e) throw new SourceError(entries.length ? "Only one text copy in the history so far: copy something else, then come back" : "Nothing copied yet: copy two things, then come back");
      return entrySide(e);
    }
    case "entry": {
      const e = await clipboard.get(src.id).catch(() => undefined);
      if (!e) throw new SourceError(`History entry ${src.id} is gone`);
      if (e.kind !== "text") throw new SourceError(`History entry ${src.id} is ${e.kind === "image" ? "an image" : "a file list"}, not text`);
      return entrySide(e);
    }
    case "clipboard": {
      const cur = await clipboard.current().catch(() => null);
      if (cur?.kind === "text") return { ...entrySide(cur), label: `Clipboard: ${entryTitle(cur)}` };
      const e = (await newestText(1))[0];
      if (!e) throw new SourceError("Nothing on the clipboard: copy a text first");
      return { ...entrySide(e), label: `Newest copy: ${entryTitle(e)}` };
    }
    case "selection": {
      let text: string | null;
      try { text = await selection.text(); } catch (e) { throw new SourceError(`Could not read the selection: ${errorMessage(e)}`); }
      if (!text) throw new SourceError("Nothing is selected in the app in front: select a text, then open Diff");
      const app = await frontApp();
      return { text, label: "Selection", sub: app ? `in ${app}` : undefined };
    }
    case "file": {
      const path = home(src.path.trim());
      if (!path) throw new SourceError(`No ${which} file given`);
      const st = statSync(path, { throwIfNoEntry: false });
      if (!st) throw new SourceError(`${tilde(path)} does not exist`);
      if (st.isDirectory()) throw new SourceError(`${tilde(path)} is a folder`);
      if (st.size > MAX_FILE) throw new SourceError(`${tilde(path)} is ${Math.round(st.size / 1024 / 1024)} MB: too big for the panel, open it in a tool`);
      const bytes = await readFile(path);
      if (bytes.subarray(0, 8192).includes(0)) throw new SourceError(`${tilde(path)} is not a text file`);
      return { text: bytes.toString("utf8"), label: basename(path), sub: tilde(dirname(path)) };
    }
    case "text":
      return { text: src.text, label: src.label || (which === "left" ? "Left text" : "Right text") };
  }
}

// ---- the external tool -----------------------------------------------------------------

type Tool = { id: Exclude<Settings["tool"], "auto">; title: string; argv: (left: string, right: string) => string[] };

const which = (name: string): string | undefined => {
  const dir = process.env.PAL_DIFF_PATH;
  if (dir) return existsSync(join(dir, name)) ? join(dir, name) : undefined;
  return Bun.which(name) ?? undefined;
};

/** The tools by id, each with how it is spawned; kitty as its own app on macOS so the diff kitten gets a window. */
const TOOLS: Record<Exclude<Settings["tool"], "auto" | "custom">, Tool> = {
  code: { id: "code", title: "VS Code", argv: (l, r) => [which("code")!, "--diff", l, r] },
  opendiff: { id: "opendiff", title: "FileMerge", argv: (l, r) => [which("opendiff")!, l, r] },
  kitty: { id: "kitty", title: "kitty", argv: (l, r) => (which("kitty") ? [which("kitty")!, "+kitten", "diff", l, r] : ["open", "-na", "kitty", "--args", "+kitten", "diff", l, r]) },
  meld: { id: "meld", title: "Meld", argv: (l, r) => [which("meld")!, l, r] },
};
const installed = (id: keyof typeof TOOLS) => !!which(id) || (id === "kitty" && MAC && existsSync("/Applications/kitty.app"));

/** `{left} {right}` in a custom command filled in and split on spaces (a quoted argument stays whole). */
export function customArgv(command: string, left: string, right: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push((m[1] ?? m[2] ?? m[3]).replaceAll("{left}", left).replaceAll("{right}", right));
  return out;
}

/** The tool the settings pick: a named one when installed, `auto` the first installed of the table, `custom` the command. */
export function tool(s: Settings): Tool | undefined {
  if (s.tool === "custom") {
    const cmd = s.tool_command.trim();
    return cmd ? { id: "custom", title: cmd.split(/\s+/)[0].split("/").pop() ?? cmd, argv: (l, r) => customArgv(cmd, l, r) } : undefined;
  }
  if (s.tool !== "auto") return installed(s.tool) ? TOOLS[s.tool] : undefined;
  for (const id of ["code", "kitty", "opendiff", "meld"] as const) if (installed(id)) return TOOLS[id];
}

/** The side as a file for the tool: the file itself for a file source, else written under the cache with a name from its label. */
async function asFile(side: Side, src: Source | undefined, which: "left" | "right"): Promise<string> {
  if (src?.kind === "file") return home(src.path);
  await mkdir(CACHE, { recursive: true });
  const name = (side.label.replace(/^[^:]*: /, "").replace(/[“”]/g, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || which).slice(0, 40);
  const path = join(CACHE, `${which}-${name}.txt`);
  await writeFile(path, side.text);
  return path;
}

// ---- states ---------------------------------------------------------------------------

/** The state of every open diff level, by its `View.id`; the sources kept so Open in tool can hand a file over as itself. */
const states = new Map<string, State & { sources: Args }>();
let seq = 0;

function remember(s: State & { sources: Args }): void {
  states.set(s.id, s);
  if (states.size > STATES_MAX) states.delete(states.keys().next().value!);
}

/** A fresh level for two sources: both resolved, else the empty view saying what is missing. */
async function open(args: Args, id = `${VIEW_ID_PREFIX}${++seq}`): Promise<Effect> {
  const t = tool(settings.get<Settings>());
  const sources: Args = { left: args.left ?? NEWEST.left, right: args.right ?? NEWEST.right };
  try {
    const [left, right] = await Promise.all([resolve(sources.left!, "left"), resolve(sources.right!, "right")]);
    const s: State & { sources: Args } = { id, left, right, side: false, ws: false, expanded: [], cursor: -1, tool: t?.title, sources };
    remember(s);
    return { view: render(s) };
  } catch (e) {
    if (!(e instanceof SourceError)) throw e;
    remember({ id, left: { text: "", label: "" }, right: { text: "", label: "" }, side: false, ws: false, expanded: [], cursor: -1, tool: t?.title, sources });
    return { view: renderEmpty({ id, title: "Diff", reason: e.message, tool: t?.title }) };
  }
}

/** The files form: two paths, `~` allowed. */
const filesForm = (errors?: Form["errors"], defaults: { left?: string; right?: string } = {}): Form => ({
  title: "Diff two files",
  fields: [
    { kind: "text", id: "left", label: "Left file", placeholder: "~/before.txt", required: true, default: defaults.left },
    { kind: "text", id: "right", label: "Right file", placeholder: "~/after.txt", required: true, default: defaults.right },
  ],
  submit: { id: "files-submit", title: "Diff" },
  errors,
});

/** A key in the view: the toggles redraw the same level, the sources replace its sides, the rest copy or open. */
async function viewPick(id: string, action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const s = states.get(id);
  if (action === "files") return { form: filesForm() };
  if (action === "files-submit") {
    const left = String(ctx?.values?.left ?? "").trim(), right = String(ctx?.values?.right ?? "").trim();
    const args: Args = { left: { kind: "file", path: left }, right: { kind: "file", path: right } };
    // Each side checked on its own, so the message lands under the field it is about.
    for (const which of ["left", "right"] as const) {
      try { await resolve(args[which]!, which); } catch (e) {
        if (!(e instanceof SourceError)) throw e;
        return { form: filesForm({ [which]: e.message }, { left, right }) };
      }
    }
    return { push: { extension: NAME, palette: NAME, args, title: `${basename(left)} → ${basename(right)}` } };
  }
  if (action === "history") return { push: { extension: NAME, palette: "pick" } };
  if (action === "newest" || action === "selection") return open(action === "newest" ? NEWEST : VS_SELECTION, id);
  if (!s) return toast("This diff is gone", "Open it again", "failure");
  const redraw = (): Effect => ({ view: render(s) });
  const empty = !s.left.label && !s.right.label;
  if (empty) return action === "copy" ? toast("Nothing to copy", "Two texts first") : redraw();
  const r = compute(s.left.text, s.right.text, { ignoreWhitespace: s.ws });
  const folds = foldCount(r);
  switch (action) {
    case "copy": return { copy: unified(s.left.text, s.right.text, s.left.label, s.right.label, { ignoreWhitespace: s.ws }), hud: `Copied unified diff, ${summary(r)}` };
    case "copy-left": return { copy: s.left.text, hud: "Copied left text" };
    case "copy-right": return { copy: s.right.text, hud: "Copied right text" };
    case "side": s.side = !s.side; return redraw();
    case "ws": s.ws = !s.ws; s.expanded = []; s.cursor = -1; return redraw();
    case "swap": [s.left, s.right] = [s.right, s.left]; [s.sources.left, s.sources.right] = [s.sources.right, s.sources.left]; s.expanded = []; s.cursor = -1; return redraw();
    case "next": s.cursor = folds ? (s.cursor + 1) % folds : -1; return redraw();
    case "prev": s.cursor = folds ? (s.cursor - 1 + folds) % folds : -1; return redraw();
    case "expand": if (s.cursor >= 0 && !s.expanded.includes(s.cursor)) s.expanded.push(s.cursor); return redraw();
    case "expand-all": s.expanded = Array.from({ length: folds }, (_, i) => i); s.cursor = -1; return redraw();
    case "open": {
      const t = tool(settings.get<Settings>());
      if (!t) return toast("No diff tool found", "Install VS Code, kitty, FileMerge (Xcode) or Meld, or set a custom command in Settings", "failure");
      const [l, r] = await Promise.all([asFile(s.left, s.sources.left, "left"), asFile(s.right, s.sources.right, "right")]);
      try {
        const proc = Bun.spawn(t.argv(l, r), { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
        proc.unref();
      } catch (e) { return toast(`Could not start ${t.title}`, errorMessage(e), "failure"); }
      return { hud: `Opened in ${t.title}` };
    }
  }
  const m = action?.match(/^expand:(\d+)$/);
  if (m) { const i = Number(m[1]); if (!s.expanded.includes(i)) s.expanded.push(i); s.cursor = i; return redraw(); }
  return redraw();
}

// ---- the pick palette -------------------------------------------------------------------

type PickArgs = { left?: number };
const PICK_LEFT: Action = { id: "left", title: "Diff with…" };
const PICK_BOTH: Action = { id: "both", title: "Diff these two", multi: true };

/** The history's text entries as rows; with a left entry chosen, each row's Enter diffs it against that one. */
async function pickRows(query: string, ctx?: Ctx): Promise<Item[]> {
  const args = (ctx?.args ?? {}) as PickArgs;
  const left = args.left !== undefined ? await clipboard.get(args.left).catch(() => undefined) : undefined;
  const entries = (await clipboard.list({ query, kind: "text", limit: 100 })).filter((e) => e.kind === "text" && e.id !== args.left);
  const rows: Item[] = entries.map((e) => ({
    id: String(e.id),
    name: entryTitle(e),
    subtitle: `${e.text!.split("\n").length} lines · ${truncate(oneLine(e.text!), 80)}`,
    icon: GLYPH.text,
    accessories: [...(e.source_app ? [{ text: appName(e.source_app) }] : []), { date: e.at }],
    actions: left ? [{ id: "right", title: `Diff ${entryTitle(left)} with this` }] : [PICK_LEFT, PICK_BOTH],
  }));
  if (left) rows.unshift(hint("left", `Left: ${entryTitle(left)}`, `${entrySub(left)} · pick the right side below`, { icon: GLYPH.pick }));
  else if (!rows.length) rows.push(hint("empty", query ? "No text entry matches" : "No text in the clipboard history", "Copy two texts, then come back", { icon: GLYPH.clipboard }));
  else rows.unshift(hint("how", "Pick the left side, then the right", "Or mark two entries (tab, or x) and press Enter", { icon: GLYPH.pick }));
  return rows;
}

async function pickPick(id: string, action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const args = (ctx?.args ?? {}) as PickArgs;
  const ids = (ctx?.ids ?? [id]).map(Number);
  if (action === "both" || ids.length > 1) {
    if (ids.length !== 2) return toast("Mark two entries", `${ids.length} marked`, "failure");
    return { push: { extension: NAME, palette: NAME, args: { left: { kind: "entry", id: ids[0] }, right: { kind: "entry", id: ids[1] } } satisfies Args } };
  }
  if (args.left !== undefined) return { push: { extension: NAME, palette: NAME, args: { left: { kind: "entry", id: args.left }, right: { kind: "entry", id: Number(id) } } satisfies Args } };
  const e = await clipboard.get(Number(id));
  return { push: { extension: NAME, palette: "pick", args: { left: e.id } satisfies PickArgs, title: `Diff ${entryTitle(e)} with…` } };
}

// ---- the extension ----------------------------------------------------------------------

/** `pal://diff/<route>`: a push into the view with the sources the route names. */
async function link(route: string, params: LinkParams): Promise<Effect | void> {
  const str = (k: string) => (params[k] === undefined ? undefined : String(params[k]));
  const push = (args: Args, title?: string): Effect => ({ push: { extension: NAME, palette: NAME, args, ...(title && { title }) } });
  switch (route) {
    case "clipboard": return push(NEWEST);
    case "selection": return push(VS_SELECTION);
    case "files": return push({ left: { kind: "file", path: str("left")! }, right: { kind: "file", path: str("right")! } }, `${basename(str("left")!)} → ${basename(str("right")!)}`);
    case "text": return push({ left: { kind: "text", text: str("left")!, label: str("left_label") }, right: { kind: "text", text: str("right")!, label: str("right_label") } });
    case "history": return push({ left: { kind: "entry", id: Number(params.left) }, right: { kind: "entry", id: Number(params.right) } });
  }
}

export default {
  link,
  palettes: {
    diff: {
      title: "Diff",
      placeholder: "The two newest copies; n, e, h, f for other sources",
      view: (ctx) => open((ctx?.args ?? {}) as Args).then((e) => e.view!),
      pick: (id, action, ctx) => viewPick(id, action, ctx),
    },
    pick: {
      title: "Diff from History",
      input: true,
      multi: true,
      placeholder: "Search the clipboard history for a text to diff",
      list: (q = "", ctx) => pickRows(q, ctx),
      pick: pickPick,
    },
  },
} satisfies Extension;
