// Clipboard history over the core's clipboard capability: an input palette,
// so every keystroke is a `clipboard.list` with the query (SQLite FTS does
// the matching, order is pinned first then newest). Enter pastes, the rest
// of the actions manage the entry.
import type { Action, Detail, Extension, Item } from "../../host/src/protocol.ts";
import { clipboard, settings, type ClipboardEntry } from "../../host/src/api.ts";

/** `[extensions.clipboard]`, defaults in pal.json. */
type Settings = { exclude_apps: string[]; max_entries: number; max_age_days: number; primary_action: "paste" | "copy" };

settings.onChange((s) => console.error("[clipboard] settings changed:", JSON.stringify(s.settings)));
const PREVIEW = 100;
const DETAIL_MAX = 20_000;
const THUMB = 48;
const URL_RE = /^https?:\/\/\S+$/;
const KIND_ICON = { text: "≡", image: "▣", files: "▤" } as const;

/** Bundle id to something readable: a few known ones, else the last segment. */
const APP_NAMES: Record<string, string> = {
  "com.apple.Terminal": "Terminal", "com.apple.Safari": "Safari", "com.apple.TextEdit": "TextEdit", "com.apple.finder": "Finder",
  "com.apple.Notes": "Notes", "com.apple.mail": "Mail", "com.apple.Preview": "Preview", "com.google.Chrome": "Chrome",
  "net.kovidgoyal.kitty": "kitty", "com.googlecode.iterm2": "iTerm", "com.microsoft.VSCode": "VS Code", "com.tinyspeck.slackmacgap": "Slack",
};
const appName = (id: string) => APP_NAMES[id] ?? id.split(".").pop() ?? id;

const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
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

function detail(e: ClipboardEntry): Detail {
  const body =
    e.kind === "image" ? `![](${clipboard.imageUrl(e.id, 0)})`
    : e.kind === "files" ? e.files!.map((f) => `- \`${f}\``).join("\n")
    : fence(e.text!.length > DETAIL_MAX ? e.text!.slice(0, DETAIL_MAX) + "\n… (truncated)" : e.text!);
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

const actions = (e: ClipboardEntry, primary: Settings["primary_action"]): Action[] => [
  ...(primary === "copy" ? [{ id: "copy", title: "Copy" }, { id: "paste", title: "Paste" }] : [{ id: "paste", title: "Paste" }, { id: "copy", title: "Copy" }]),
  { id: "pin", title: e.pinned ? "Unpin" : "Pin", shortcut: "cmd+p" },
  { id: "delete", title: "Delete", shortcut: "cmd+d", style: "destructive", confirm: "Delete this entry from history?" },
  { id: "clear", title: "Clear history", shortcut: "cmd+shift+d", style: "destructive", confirm: "Delete every entry, pinned ones included?" },
];

function item(e: ClipboardEntry, primary: Settings["primary_action"]): Item {
  const url = e.kind === "text" && e.text!.length < 2048 && URL_RE.test(e.text!.trim()) ? e.text!.trim() : undefined;
  return {
    id: String(e.id),
    name: title(e),
    subtitle: subtitle(e),
    icon: e.kind === "image" ? { image: clipboard.imageUrl(e.id, THUMB) } : url ? undefined : KIND_ICON[e.kind],
    url,
    accessories: [
      ...(e.source_app ? [{ text: appName(e.source_app) }] : []),
      { date: e.at },
      ...(e.pinned ? [{ tag: "pinned", color: "amber" }] : []),
    ],
    detail: detail(e),
    actions: actions(e, primary),
  };
}

/** An entry is excluded by its source app's bundle id or readable name, or by age. */
function shown(e: ClipboardEntry, s: Settings): boolean {
  if (e.source_app && s.exclude_apps.some((x) => x === e.source_app || x.toLowerCase() === appName(e.source_app!).toLowerCase())) return false;
  if (s.max_age_days > 0 && Date.now() - e.at > s.max_age_days * 86_400_000) return false;
  return true;
}

export default {
  palettes: {
    history: {
      title: "Clipboard History",
      icon: "⎘",
      live: true,
      input: true,
      detail: true,
      placeholder: "Search clipboard history",
      list: async (query = "") => {
        const s = settings.get<Settings>();
        return (await clipboard.list({ query, limit: s.max_entries })).filter((e) => shown(e, s)).map((e) => item(e, s.primary_action));
      },
      pick: async (id, action) => {
        const entry = Number(id);
        switch (action) {
          case "copy": await clipboard.copy(entry); return {};
          case "pin": { const e = await clipboard.get(entry); await clipboard.pin(entry, !e.pinned); return { keep: true }; }
          case "delete": await clipboard.delete(entry); return { keep: true };
          case "clear": await clipboard.clear(); return { keep: true, toast: { title: "History cleared" } };
          default: return { paste: { entry } };
        }
      },
    },
  },
} satisfies Extension;
