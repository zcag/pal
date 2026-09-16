// Clipboard history over the core's clipboard capability: an input palette,
// so every keystroke is a `clipboard.list` with the query (SQLite FTS does
// the matching, order is pinned first then newest; the pinned ones get a
// section). The filter dropdown narrows by kind: the core's three, plus
// links and colours, which are text entries this side recognises. Enter
// pastes, the rest of the actions manage the entry. A second palette,
// `rows` (now.ts), reads what is on the clipboard right now as the things
// it could be and is the root's Clipboard section.
import { clipboard, conceal, ocr, settings, type Action, type ClipboardEntry, type Detail, type Effect, type Extension, type Item, type LinkParams } from "@zcag/pal";
import { rowsPalette } from "./now.ts";

/** `[extensions.clipboard]`, defaults in pal.json. `max_entries` and `max_age_days` are the recorder's (app clipboard.rs); this side never reads them. */
type Settings = { exclude_apps: string[]; primary_action: "paste" | "copy"; ocr_concealed: boolean };

/** Rows asked from the core per list; retention decides what exists, this only bounds one page. */
const PAGE = 200;
const PREVIEW = 100;
const DETAIL_MAX = 20_000;
const THUMB = 48;
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
const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

function title(e: ClipboardEntry): string {
  if (e.kind === "image") return `Image ${e.width ?? "?"} x ${e.height ?? "?"}`;
  if (e.kind === "files") return e.files!.map(basename).join(", ");
  const first = e.text!.split("\n").find((l) => l.trim()) ?? "";
  return clip(first.trim(), 120);
}

function subtitle(e: ClipboardEntry): string | undefined {
  if (e.kind === "text") {
    const rest = oneLine(e.text!);
    const lines = e.text!.split("\n").length;
    return lines > 1 ? `${lines} lines · ${clip(rest, PREVIEW)}` : undefined;
  }
  if (e.kind === "files") return e.files!.length === 1 ? e.files![0] : `${e.files!.length} files`;
  return undefined;
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
      { label: "Kind", value: e.kind },
      { label: "Size", value: e.kind === "image" ? `${size(e.bytes)} · ${e.width} x ${e.height} px` : e.kind === "text" ? `${size(e.bytes)} · ${e.text!.length} chars` : size(e.bytes) },
      ...(e.source_app ? [{ label: "Source", value: appName(e.source_app) }] : []),
      { label: "Copied", value: new Date(e.at).toLocaleString() },
      ...(e.pinned ? [{ label: "Pinned", tags: [{ text: "pinned", color: "amber" }] }] : []),
    ],
  };
}

const actions = (e: ClipboardEntry, primary: Settings["primary_action"], url?: string): Action[] => [
  ...(primary === "copy" ? [{ id: "copy", title: "Copy" }, { id: "paste", title: "Paste" }] : [{ id: "paste", title: "Paste" }, { id: "copy", title: "Copy" }]),
  ...(url ? [{ id: "open", title: "Open link", shortcut: "cmd+o" }] : []),
  ...(e.kind === "text" ? [{ id: "paste-plain", title: "Paste as plain text", shortcut: "cmd+shift+v" }] : []),
  ...(e.kind === "image" ? [{ id: "copy-file", title: "Copy image file", shortcut: "cmd+shift+c" }, { id: "copy-text", title: "Copy text from image", shortcut: "cmd+shift+t" }] : []),
  { id: "pin", title: e.pinned ? "Unpin" : "Pin", shortcut: "cmd+p" },
  { id: "delete", title: "Delete", shortcut: "cmd+d", style: "destructive", confirm: "Delete this entry from history?" },
  { id: "delete-unpinned", title: "Delete all unpinned", style: "destructive", confirm: "Delete every unpinned entry? Pinned ones stay." },
  { id: "clear", title: "Clear history", shortcut: "cmd+shift+d", style: "destructive", confirm: "Delete every entry, pinned ones included?" },
];

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
      ...(e.kind === "image" ? [{ text: size(e.bytes) }] : []),
      { date: e.at },
      ...(e.pinned ? [{ tag: "pinned", color: "amber" }] : []),
    ],
    ...(e.pinned && { section: "Pinned" }),
    detail: detail(e, color),
    actions: actions(e, primary, url),
  };
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
  return !e.source_app || !s.exclude_apps.some((x) => x === e.source_app || x.toLowerCase() === appName(e.source_app!).toLowerCase());
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
      pick: async (id, action) => {
        const entry = Number(id);
        switch (action) {
          case "copy": await clipboard.copy(entry); return {};
          case "open": { const url = urlOf(await clipboard.get(entry)); return url ? { open: url } : { paste: { entry } }; }
          case "paste-plain": { const e = await clipboard.get(entry); return e.kind === "text" ? { paste: { text: e.text! } } : { paste: { entry } }; }
          case "copy-file": { const e = await clipboard.get(entry); return e.image ? { copy_files: [e.image] } : { paste: { entry } }; }
          case "copy-text": {
            // OCR over the core (Vision on macOS, tesseract on Linux); the text goes on the clipboard as a copy of its own, concealed when the setting says so.
            const e = await clipboard.get(entry);
            if (!e.image) return { paste: { entry } };
            let text: string;
            try { text = await ocr.image({ path: e.image }); } catch (err) { return { keep: true, toast: { title: "Could not read the text", message: String((err as Error)?.message ?? err), style: "failure" } }; }
            if (!text) return { keep: true, toast: { title: "No text in the image" } };
            return { copy: settings.get<Settings>().ocr_concealed ? conceal(text, 0) : text, hud: "Copied text" };
          }
          case "pin": { const e = await clipboard.get(entry); await clipboard.pin(entry, !e.pinned); return { keep: true }; }
          case "delete": await clipboard.delete(entry); return { keep: true };
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
