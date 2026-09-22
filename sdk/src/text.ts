// Small text helpers every extension reaches for: a byte count, a cut
// string, a slug, an error's message. Pure; the platform-free half of the
// SDK next to placeholders.ts.

/** `512 B`, `3.2 KB`, `24 KB` (whole from 10 KB), `1.5 MB`, `2.25 GB`, `1.50 TB` (a whole disk). */
export const bytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n < 1024 ** 4 ? `${(n / 1024 ** 3).toFixed(2)} GB` : `${(n / 1024 ** 4).toFixed(2)} TB`;

/** `s` cut to `n` characters, an ellipsis as the last when it was longer. */
export const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The invisible characters a mail preheader is padded with (zero-width spaces and joiners, the combining grapheme joiner, soft hyphens, the byte-order mark): a row would show them as a run of nothing. */
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u034F\u00AD]/g;
/** Runs of whitespace (newlines included) as one space, invisible characters out, trimmed: a subtitle from a body. */
export const oneLine = (s: string): string => s.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

/** `Hello, Wörld!` as `hello-world`: lowercase ASCII words joined by hyphens, accents stripped. */
export const slug = (s: string): string => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Bundle ids whose last segment is not the app's name (Slack's `slackmacgap`, Chrome's `Chrome` is fine); the rest read from the id. */
const APP_NAMES: Record<string, string> = {
  "com.apple.Terminal": "Terminal", "com.apple.Safari": "Safari", "com.apple.TextEdit": "TextEdit", "com.apple.finder": "Finder",
  "com.apple.Notes": "Notes", "com.apple.mail": "Mail", "com.apple.Preview": "Preview", "com.google.Chrome": "Chrome",
  "net.kovidgoyal.kitty": "kitty", "com.googlecode.iterm2": "iTerm", "com.microsoft.VSCode": "VS Code", "com.tinyspeck.slackmacgap": "Slack",
};
/** A bundle id (`com.google.Chrome`, what a clipboard entry's `source_app` is) as something readable: a known name, else the last segment. */
export const appName = (id: string): string => APP_NAMES[id] ?? id.split(".").pop() ?? id;

/** What a thrown value says: an Error's message, else the value as text. */
export const errorMessage = (e: unknown): string => String((e as { message?: unknown })?.message ?? e);

const LINK = /https?:\/\/[^\s<>"')\]]+/g;
/**
 * Plain text as markdown that reads as the text: the characters markdown
 * marks up escaped (a bare `<a@b>` would otherwise vanish as HTML, a
 * leading `#` would be a heading, `- ` a list), bare links left whole so
 * the renderer links them.
 */
export function mdEscape(text: string): string {
  const esc = (s: string) => s.replace(/[\\`*_{}[\]<>#|~]/g, "\\$&").replace(/^(\s*)([-+])(\s)/gm, "$1\\$2$3").replace(/^(\s*\d+)\.(\s)/gm, "$1\\.$2");
  let out = "", at = 0;
  for (const m of text.matchAll(LINK)) {
    out += esc(text.slice(at, m.index)) + m[0];
    at = m.index + m[0].length;
  }
  return out + esc(text.slice(at));
}
