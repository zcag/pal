// Clipboard history over the core's clipboard capability: an input palette,
// so every keystroke is a `clipboard.list` with the query (SQLite FTS does
// the matching, order is pinned first then newest; the pinned ones get a
// section). The filter dropdown narrows by kind: the core's three, plus
// links and colours, which are text entries this side recognises. Enter
// pastes, the rest of the actions manage the entry: edit it (a form whose
// submit copies the new text, so it is the newest entry), save it as a
// file or as a snippet, show it as a QR code, name it (the row's title
// from then on, searched like the text). A second palette, `rows`
// (now.ts), reads what is on the clipboard right now as the things it
// could be and is the root's Clipboard section.
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argsForm, bytes, clipboard, conceal, errorMessage, failed, home, ocr, settings, when, type Action, type Arg, type ClipboardEntry, type Ctx, type Detail, type Effect, type Extension, type Form, type Item, type LinkParams } from "@zcag/pal";
import { rowsPalette } from "./now.ts";
import { fileNameFor, qrSvg, QR_SHOW_PX } from "./rows.ts";

/** `[extensions.clipboard]`, defaults in pal.json. `max_entries` and `max_age_days` are the recorder's (app clipboard.rs); this side never reads them. */
type Settings = { exclude_apps: string[]; primary_action: "paste" | "copy"; ocr_concealed: boolean };

/** Rows asked from the core per list; retention decides what exists, this only bounds one page. */
const PAGE = 200;
const PREVIEW = 100;
const DETAIL_MAX = 20_000;
const THUMB = 48;
/** Longer than this and a QR code will not take it (version 40 at level M holds about 2.3 KB of bytes). */
const QR_MAX = 2000;
const SAVE_DIR = "~/Desktop";
const URL_RE = /^https?:\/\/\S+$/;
/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r, g, b)`, `rgba(r, g, b, a)`. */
const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/i;
/** The row glyph by kind (Material Design in the bundled Nerd Font): text, an image without a thumbnail, a file list. */
const KIND_ICON = { text: "\u{f09a8}", image: "\u{f0976}", files: "\u{f1032}" } as const;
/** The dropdown: the core's kinds, then the two this side derives from text. */
const FILTERS = [
  { id: "all", title: "All" },
  { id: "text", title: "Text" },
  { id: "image", title: "Images" },
  { id: "files", title: "Files" },
  { id: "links", title: "Links" },
  { id: "colors", title: "Colors" },
];

/** Bundle id to something readable: a few known ones, else the last segment. */
const APP_NAMES: Record<string, string> = {
  "com.apple.Terminal": "Terminal", "com.apple.Safari": "Safari", "com.apple.TextEdit": "TextEdit", "com.apple.finder": "Finder",
  "com.apple.Notes": "Notes", "com.apple.mail": "Mail", "com.apple.Preview": "Preview", "com.google.Chrome": "Chrome",
  "net.kovidgoyal.kitty": "kitty", "com.googlecode.iterm2": "iTerm", "com.microsoft.VSCode": "VS Code", "com.tinyspeck.slackmacgap": "Slack",
};
const appName = (id: string) => APP_NAMES[id] ?? id.split(".").pop() ?? id;

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
/** A text entry that is one url. */
const urlOf = (e: ClipboardEntry) => (e.kind === "text" && e.text!.length < 2048 && URL_RE.test(e.text!.trim()) ? e.text!.trim() : undefined);
/** A text entry that is one colour, as `#rrggbb` (a hex form as typed, `rgb()` converted), for the swatch. */
function colorOf(e: ClipboardEntry): string | undefined {
  if (e.kind !== "text" || e.text!.length > 64) return;
  const t = e.text!.trim();
  if (HEX_RE.test(t)) return t;
  const m = t.match(RGB_RE);
  if (!m) return;
  const [r, g, b] = m.slice(1, 4).map((n) => Math.min(255, +n));
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** The text the entry is, one line, for a title: the first non-blank line. */
const firstLine = (e: ClipboardEntry) => (e.text!.split("\n").find((l) => l.trim()) ?? "").trim();

function title(e: ClipboardEntry): string {
  if (e.name) return e.name;
  if (e.kind === "image") return `Image ${e.width ?? "?"} x ${e.height ?? "?"}`;
  if (e.kind === "files") return e.files!.map(basename).join(", ");
  return clip(firstLine(e), 120);
}

/** Under a name the subtitle is what the entry is (the text's preview, the image's size, the files); else the multi-line preview or the files. */
function subtitle(e: ClipboardEntry): string | undefined {
  if (e.kind === "text") {
    const rest = oneLine(e.text!);
    const lines = e.text!.split("\n").length;
    return lines > 1 ? `${lines} lines · ${clip(rest, PREVIEW)}` : e.name ? clip(rest, PREVIEW) : undefined;
  }
  if (e.kind === "files") return e.files!.length === 1 ? e.files![0] : `${e.files!.length} files`;
  return e.name ? `Image ${e.width ?? "?"} x ${e.height ?? "?"}` : undefined;
}

/** Four backticks fence the text so a ``` inside cannot end it early. */
const fence = (s: string) => "````\n" + s.replace(/````/g, "```​`") + "\n````";
/** A wide swatch of a copied colour, as the Colors palette draws one. */
const swatch = (hex: string) => `![](data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="64"><rect width="320" height="64" rx="8" fill="${hex}"/></svg>`)})`;

function detail(e: ClipboardEntry, color?: string): Detail {
  const body =
    e.kind === "image" ? `![](${clipboard.imageUrl(e.id, 0)})`
    : e.kind === "files" ? e.files!.map((f) => `- \`${f}\``).join("\n")
    : (color ? swatch(color) + "\n\n" : "") + fence(e.text!.length > DETAIL_MAX ? e.text!.slice(0, DETAIL_MAX) + "\n… (truncated)" : e.text!);
  return {
    markdown: body,
    metadata: [
      ...(e.name ? [{ label: "Name", value: e.name }] : []),
      { label: "Kind", value: e.kind },
      { label: "Size", value: e.kind === "image" ? `${bytes(e.bytes)} · ${e.width} x ${e.height} px` : e.kind === "text" ? `${bytes(e.bytes)} · ${e.text!.length} chars` : bytes(e.bytes) },
      ...(e.source_app ? [{ label: "Source", value: appName(e.source_app) }] : []),
      { label: "Copied", value: when(e.at) },
      ...(e.pinned ? [{ label: "Pinned", tags: [{ text: "pinned", color: "amber" }] }] : []),
    ],
  };
}

// Copy joins the marked entries' text (one per line) and Delete removes each (`multi`); Paste is one entry.
const COPY: Action = { id: "copy", title: "Copy", multi: true };
const PASTE: Action = { id: "paste", title: "Paste" };
const actions = (e: ClipboardEntry, primary: Settings["primary_action"], url?: string): Action[] => [
  ...(primary === "copy" ? [COPY, PASTE] : [PASTE, COPY]),
  ...(url ? [{ id: "open", title: "Open link", shortcut: "cmd+o" }] : []),
  ...(e.kind === "text" ? [{ id: "paste-plain", title: "Paste as plain text", shortcut: "cmd+shift+v" }] : []),
  ...(e.kind === "image" ? [{ id: "copy-file", title: "Copy image file", shortcut: "cmd+shift+c" }, { id: "copy-text", title: "Copy text from image", shortcut: "cmd+shift+t" }] : []),
  ...(e.kind === "text" ? [{ id: "edit", title: "Edit…", shortcut: "cmd+e" }] : []),
  { id: "pin", title: e.pinned ? "Unpin" : "Pin", shortcut: "cmd+p" },
  { id: "rename", title: e.name ? "Rename" : "Name", shortcut: "cmd+shift+r", args: true },
  { id: "save-file", title: "Save as file…", shortcut: "cmd+s" },
  ...(e.kind === "text" ? [{ id: "snippet", title: "Save as snippet", shortcut: "cmd+shift+s" }] : []),
  ...(e.kind === "text" && e.text!.length <= QR_MAX ? [{ id: "qr", title: "Show as QR code", shortcut: "cmd+shift+k" }] : []),
  { id: "delete", title: "Delete", shortcut: "cmd+d", style: "destructive", confirm: "Delete this entry from history?", multi: true },
  { id: "delete-unpinned", title: "Delete all unpinned", style: "destructive", confirm: "Delete every unpinned entry? Pinned ones stay." },
  { id: "clear", title: "Clear history", shortcut: "cmd+shift+d", style: "destructive", confirm: "Delete every entry, pinned ones included?" },
];

/** The row's one field in the bar, its name; only Name / Rename reads it, and blank clears a name it has. */
const nameArgs = (e: ClipboardEntry): Arg[] => [{ id: "name", placeholder: e.name ? "New name (blank clears it)" : "Name", ...(e.name && { default: e.name }) }];

function item(e: ClipboardEntry, primary: Settings["primary_action"]): Item {
  const url = urlOf(e);
  const color = colorOf(e);
  return {
    id: String(e.id),
    name: title(e),
    subtitle: subtitle(e),
    icon: e.kind === "image" ? { image: clipboard.imageUrl(e.id, THUMB) } : url ? undefined : color ?? KIND_ICON[e.kind],
    url,
    accessories: [
      ...(e.source_app ? [{ text: appName(e.source_app) }] : []),
      ...(e.kind === "image" ? [{ text: bytes(e.bytes) }] : []),
      { date: e.at },
      ...(e.pinned ? [{ tag: "pinned", color: "amber" }] : []),
    ],
    ...(e.pinned && { section: "Pinned" }),
    detail: detail(e, color),
    args: nameArgs(e),
    actions: actions(e, primary, url),
  };
}

// ---- the forms -----------------------------------------------------------------

/** Edit: the text in a textarea; the submit copies it, so the edited text is the newest entry (the original stays). */
const editForm = (e: ClipboardEntry, errors?: Form["errors"]): Form => ({
  id: String(e.id),
  title: e.name ? `Edit ${e.name}` : "Edit entry",
  fields: [
    { kind: "textarea", id: "text", label: "Text", default: e.text!, required: true },
    { kind: "checkbox", id: "paste", label: "Then", text: "Paste it into the app in front as well", default: false },
  ],
  submit: { id: "edit-submit", title: "Copy edited text" },
  errors,
});

/** The name field as a page, for a pick without values (a hotkey, `pal run`): empty clears (the row goes back to its text). */
const nameForm = (e: ClipboardEntry): Form => ({ ...argsForm(nameArgs(e), e.name ? `Rename ${e.name}` : "Name this entry", { id: "rename", title: e.name ? "Rename" : "Name" }), id: String(e.id) });

const saveForm = (e: ClipboardEntry, errors?: Form["errors"]): Form => ({
  id: String(e.id),
  title: "Save as file",
  fields: [
    { kind: "text", id: "folder", label: "Folder", default: SAVE_DIR, required: true, description: "~ is expanded; a missing folder is created." },
    { kind: "text", id: "name", label: "Name", default: fileNameFor(e), required: true, description: e.kind === "image" ? "The PNG the recorder keeps, copied under this name." : e.kind === "files" ? "The paths, one per line." : "The text as it is." },
  ],
  submit: { id: "save-submit", title: "Save" },
  errors,
});

/** The Save form's submit: the entry written under `folder/name`; an existing file is refused with the form again. */
async function saveFile(e: ClipboardEntry, values: Ctx["values"]): Promise<Effect> {
  const rawFolder = String(values?.folder ?? "").trim(), name = String(values?.name ?? "").trim();
  if (!rawFolder) return { form: saveForm(e, { folder: "A folder path" }) };
  if (!name || name.includes("/") || name === "." || name === "..") return { form: saveForm(e, { name: "A file name, without a slash" }) };
  const folder = home(rawFolder);
  const target = join(folder, name);
  try {
    await mkdir(folder, { recursive: true });
    if (await stat(target).then(() => true).catch(() => false)) return { form: saveForm(e, { name: `${name} exists there already` }) };
    if (e.kind === "image") await copyFile(e.image!, target);
    else await writeFile(target, e.kind === "files" ? e.files!.join("\n") + "\n" : e.text!, { flag: "wx" });
  } catch (err) { return { form: saveForm(e, { name: errorMessage(err) }) }; }
  return { keep: true, toast: { title: "Saved", message: target.replace(home("~"), "~") } };
}

/** The core's `kind` for a filter; `links` and `colors` are text narrowed here. */
const kindOf = (filter?: string): ClipboardEntry["kind"] | undefined => (filter === "text" || filter === "image" || filter === "files" ? filter : filter === "links" || filter === "colors" ? "text" : undefined);
const passes = (e: ClipboardEntry, filter?: string) => (filter === "links" ? !!urlOf(e) : filter === "colors" ? !!colorOf(e) : true);

/** Every unpinned entry deleted one by one (the core has no bulk delete short of `clear`): pinned ones list first and stay, so each page starts past them. */
async function deleteUnpinned(): Promise<number> {
  let n = 0, kept = 0;
  for (;;) {
    const page = await clipboard.list({ limit: PAGE, offset: kept });
    for (const e of page) if (e.pinned) kept++; else { await clipboard.delete(e.id); n++; }
    if (page.length < PAGE) return n;
  }
}

/** An entry recorded before its app went on the exclude list is hidden by bundle id or readable name. */
function shown(e: ClipboardEntry, s: Settings): boolean {
  const app = e.source_app;
  return !app || !s.exclude_apps.some((x) => x === app || x.toLowerCase() === appName(app).toLowerCase());
}

export default {
  // `pal://clipboard/copy?index=2`: the nth newest entry (0 the newest) back on the clipboard.
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route !== "copy") return;
    const index = typeof params.index === "number" ? params.index : 0;
    if (!Number.isInteger(index) || index < 0) throw new Error(`index must be 0 or more, not ${index}`);
    const s = settings.get<Settings>();
    const entries = (await clipboard.list({ limit: index + 1 + s.exclude_apps.length * 4 })).filter((e) => shown(e, s));
    const e = entries[index];
    if (!e) throw new Error(`no history entry ${index} (${entries.length} in history)`);
    await clipboard.copy(e.id);
    return { hud: "Copied" };
  },
  palettes: {
    history: {
      title: "Clipboard History",
      live: true,
      input: true,
      showDetail: true,
      placeholder: "Search clipboard history",
      filters: FILTERS,
      list: async (query = "", ctx) => {
        const s = settings.get<Settings>();
        const kind = kindOf(ctx?.filter);
        return (await clipboard.list({ query, limit: PAGE, ...(kind && { kind }) })).filter((e) => shown(e, s) && passes(e, ctx?.filter)).map((e) => item(e, s.primary_action));
      },
      pick: async (id, action, ctx) => {
        const entry = Number(id);
        // A multi pick's marked entries (`ctx.ids`), else the one.
        const ids = (ctx?.ids ?? [id]).map(Number);
        switch (action) {
          case "copy": {
            if (ids.length === 1) { await clipboard.copy(entry); return {}; }
            // Several: their text joined, one per line, onto the clipboard as one copy; an image or a file list contributes its name.
            const entries = await Promise.all(ids.map((i) => clipboard.get(i)));
            return { copy: entries.map((e) => (e.kind === "text" ? e.text! : e.kind === "files" ? e.files!.join("\n") : title(e))).join("\n"), hud: `Copied ${ids.length} entries` };
          }
          case "open": { const url = urlOf(await clipboard.get(entry)); return url ? { open: url } : { paste: { entry } }; }
          case "paste-plain": { const e = await clipboard.get(entry); return e.kind === "text" ? { paste: { text: e.text! } } : { paste: { entry } }; }
          case "copy-file": { const e = await clipboard.get(entry); return e.image ? { copy_files: [e.image] } : { paste: { entry } }; }
          case "copy-text": {
            // OCR over the core (Vision on macOS, tesseract on Linux); the text goes on the clipboard as a copy of its own, concealed when the setting says so.
            const e = await clipboard.get(entry);
            if (!e.image) return { paste: { entry } };
            let text: string;
            try { text = await ocr.image({ path: e.image }); } catch (err) { return failed("read the text", err); }
            if (!text) return { keep: true, toast: { title: "No text in the image" } };
            return { copy: settings.get<Settings>().ocr_concealed ? conceal(text, 0) : text, hud: "Copied text" };
          }
          case "pin": { const e = await clipboard.get(entry); await clipboard.pin(entry, !e.pinned); return { keep: true }; }
          case "edit": { const e = await clipboard.get(entry); return e.kind === "text" ? { form: editForm(e) } : { paste: { entry } }; }
          case "edit-submit": {
            const e = await clipboard.get(entry);
            const text = String(ctx?.values?.text ?? "");
            if (!text.trim()) return { form: editForm(e, { text: "Nothing to copy" }) };
            // The edited text goes on the clipboard (the watcher records it as the newest entry); with the box ticked it is pasted, which copies it on the way.
            return ctx?.values?.paste ? { paste: { text } } : { copy: text };
          }
          // The bar's name, or the form's (`rename-submit` was its submit id before; a saved hotkey may carry it).
          case "rename": case "rename-submit": {
            if (!ctx?.values) return { form: nameForm(await clipboard.get(entry)) };
            const name = String(ctx.values.name ?? "").trim();
            await clipboard.rename(entry, name || null);
            return { keep: true, toast: { title: name ? "Named" : "Name cleared", message: name || undefined } };
          }
          case "save-file": return { form: saveForm(await clipboard.get(entry)) };
          case "save-submit": return saveFile(await clipboard.get(entry), ctx?.values);
          case "snippet": {
            const e = await clipboard.get(entry);
            return e.kind === "text" ? { push: { extension: "snippets", palette: "snippets", args: { create: e.text! } } } : { paste: { entry } };
          }
          case "qr": {
            const e = await clipboard.get(entry);
            const svg = e.kind === "text" ? qrSvg(e.text!, 10, QR_SHOW_PX) : undefined;
            if (!svg) return { keep: true, toast: { title: "Too long for a QR code", message: `Up to ${QR_MAX} characters`, style: "failure" } };
            return { show: { title: e.name ?? "QR code", markdown: `![](${svg})\n\n\`${e.text!.length > 200 ? e.text!.slice(0, 199) + "…" : e.text!}\`` } };
          }
          case "delete": for (const i of ids) await clipboard.delete(i); return { keep: true };
          case "delete-unpinned": { const n = await deleteUnpinned(); return { keep: true, toast: { title: `Deleted ${n} unpinned ${n === 1 ? "entry" : "entries"}` } }; }
          case "clear": await clipboard.clear(); return { keep: true, toast: { title: "History cleared" } };
          default: return { paste: { entry } };
        }
      },
    },
    // What is on the clipboard now, as the things it could be (now.ts, rows.ts); the root's Clipboard section comes from its `suggest`.
    rows: rowsPalette,
  },
} satisfies Extension;
