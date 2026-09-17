// What is on the clipboard, read as the things it could be, and the rows
// the root's "Clipboard" section (and the `rows` palette) show for each:
// a web address (title, open, private window, markdown link, QR code,
// shortener), a colour (swatch, notations, the picker), paths and file
// lists (open, reveal, open with, names), an email, a phone number, a JSON
// blob (pretty, minified, its size), an expression or a number (the
// answer, other bases), a timestamp or an ISO date (local and relative),
// a hex or base64 string that decodes to text, a tracking number (the
// carrier's page), a git sha or `owner/repo#12` (GitHub), an image (size,
// save, copy as file, OCR), and the text itself (counts, case and slug
// transforms, paste as plain, save as snippet). `analyzeText` is pure and
// synchronous but for the facts it needs (paths that exist, a page title),
// which `now.ts` gathers first; `rows` builds the items; `pickRow` in
// now.ts routes by row id. Nothing here talks to the network except `fetchTitle`, which
// the `fetch_titles` setting gates.
import { basename, dirname, extname } from "node:path";
import qrcode from "qrcode-generator";
import { ago, bytes, clock, colors, dayNameYear, slug, when, type Action, type ClipboardEntry, type Item } from "@zcag/pal";
const { parse: parseColor, toHex, toHslString, toRgb } = colors;
type RGB = colors.RGB;

export const SECTION = "Clipboard";
/** Every row's last action: the section goes until the clipboard changes. */
export const HIDE: Action = { id: "hide", title: "Hide from the root", shortcut: "cmd+shift+h" };
/** Rows a file list on the clipboard gets before the count row. */
const FILE_ROWS = 3;
/** Text past this is not analysed beyond its counts (a JSON dump, a log). */
const ANALYZE_MAX = 64 * 1024;
const PREVIEW = 80;
const MAC = process.platform === "darwin";

/** Material Design glyphs in the bundled Nerd Font, one per row kind. */
export const GLYPH = {
  text: "\u{f09a8}", // md-text
  folder: "\u{f0256}",
  file: "\u{f0224}",
  files: "\u{f1032}",
  email: "\u{f01ee}", // md-email
  phone: "\u{f03f2}", // md-phone
  json: "\u{f0626}", // md-code_json
  calc: "\u{f01fc}", // md-equal
  number: "\u{f0af6}", // md-numeric
  date: "\u{f00ed}", // md-calendar
  clock: "\u{f0954}", // md-timer
  decode: "\u{f0bfe}", // md-lock_open
  track: "\u{f01f0}", // md-package_variant
  git: "\u{f02a2}", // md-git
  github: "\u{f02a4}", // md-github
  image: "\u{f0976}",
  ocr: "\u{f0dd4}", // md-text_recognition
} as const;

// ---- what the text is -----------------------------------------------------

export const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/\S+|(?:localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?::\d+)?(?:[/?#]\S*)?)$/i;
const EMAIL_RE = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
const PHONE_RE = /^\+?[\d\s().-]{6,24}$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
const ISSUE_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;
const REPO_RE = /^([\w-]+)\/([\w.-]+)$/;
const NUMBER_RE = /^-?(?:\d{1,3}(?:[,.]\d{3})+|\d+)(?:[.,]\d+)?$/;
const EXPR_RE = /^[\d\s.,+\-*/^%()]+$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/i;
const HEX_RE = /^(?:0x)?(?:[0-9a-f]{2}){4,}$/i;
const B64_RE = /^[A-Za-z0-9+/]{8,}={0,2}$/;

export type Analysis = {
  entry: ClipboardEntry;
  text?: string;
  url?: string;
  /** The page title, when fetched. */
  title?: string;
  color?: { rgb: RGB; typed: string };
  /** Paths that exist, with what they are. */
  paths: PathInfo[];
  /** A file list's count and total size (files on the clipboard, or every line a path). */
  fileList?: { count: number; bytes: number };
  email?: string;
  phone?: { digits: string; typed: string };
  json?: { pretty: string; minified: string; what: string };
  expr?: { expr: string; value: number };
  number?: { value: number; typed: string };
  date?: { at: Date; from: "unix" | "iso" };
  decoded?: { from: "hex" | "base64"; text: string };
  tracking?: { carrier: string; url: string };
  git?: { kind: "sha" | "issue" | "repo"; short?: string; url?: string; label: string };
  stats?: { words: number; chars: number; lines: number };
  image?: { width?: number; height?: number; bytes: number; ocr: boolean };
};

export type PathInfo = { path: string; dir: boolean; bytes: number };

/** The counts of a text. */
export const stats = (t: string) => ({ words: t.trim() ? t.trim().split(/\s+/).length : 0, chars: [...t].length, lines: t ? t.split("\n").length : 0 });

/** `2+2*3`, `(1+2)/4`, `2^10`, `15%`: left to right with precedence, `^` right-associative; `undefined` when it is not arithmetic or divides by zero. */
export function evaluate(expr: string): number | undefined {
  const src = expr.replace(/,/g, "").replace(/\s+/g, "");
  if (!src || !/\d/.test(src) || !/[+\-*/^%]/.test(src)) return undefined;
  let i = 0;
  const peek = () => src[i];
  const num = (): number | undefined => {
    const m = /^\d+(?:\.\d+)?|^\.\d+/.exec(src.slice(i));
    if (!m) return undefined;
    i += m[0].length;
    let v = Number(m[0]);
    if (peek() === "%") { i++; v /= 100; }
    return v;
  };
  const atom = (): number | undefined => {
    if (peek() === "(") { i++; const v = add(); if (peek() !== ")") return undefined; i++; return v; }
    if (peek() === "-") { i++; const v = atom(); return v === undefined ? undefined : -v; }
    if (peek() === "+") { i++; return atom(); }
    return num();
  };
  const pow = (): number | undefined => {
    const base = atom();
    if (base === undefined) return undefined;
    if (peek() === "^") { i++; const e = pow(); return e === undefined ? undefined : base ** e; }
    return base;
  };
  const mul = (): number | undefined => {
    let v = pow();
    while (v !== undefined && (peek() === "*" || peek() === "/")) { const op = src[i++]; const r = pow(); if (r === undefined || (op === "/" && r === 0)) return undefined; v = op === "*" ? v * r : v / r; }
    return v;
  };
  const add = (): number | undefined => {
    let v = mul();
    while (v !== undefined && (peek() === "+" || peek() === "-")) { const op = src[i++]; const r = mul(); if (r === undefined) return undefined; v = op === "+" ? v + r : v - r; }
    return v;
  };
  const v = add();
  return i === src.length && v !== undefined && Number.isFinite(v) ? v : undefined;
}

const tidy = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(12))));
export const fmt = (n: number) => (Number.isInteger(n) && Math.abs(n) < 1e21 ? n.toLocaleString("en-US") : tidy(n));

/** `1700000000` and `1700000000000` as dates (years 2001 to 2286); an ISO day or timestamp; nothing for other numbers. */
export function parseDate(t: string): Analysis["date"] {
  if (/^\d{10}$/.test(t) || /^\d{13}$/.test(t)) {
    const n = Number(t) * (t.length === 10 ? 1000 : 1);
    return { at: new Date(n), from: "unix" };
  }
  const m = ISO_RE.exec(t);
  if (!m) return undefined;
  const at = new Date(m[4] === undefined ? `${m[1]}-${m[2]}-${m[3]}T00:00:00` : t.replace(" ", "T"));
  return Number.isNaN(at.getTime()) ? undefined : { at, from: "iso" };
}

const printable = (s: string) => { const bad = (s.match(/[\u0000-\u0008\u000b\u000e-\u001f\ufffd]/g) ?? []).length; return s.length > 0 && bad / s.length < 0.05; };

/** Hex (`48656c6c6f`, `0x…`) or base64 that decodes to readable UTF-8; the decoded text. */
export function decode(t: string): Analysis["decoded"] {
  if (HEX_RE.test(t)) {
    const hex = t.replace(/^0x/i, "");
    const bytes = Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (printable(text) && /[a-z]/i.test(text)) return { from: "hex", text };
  }
  if (B64_RE.test(t) && t.length % 4 === 0) {
    try {
      const text = Buffer.from(t, "base64").toString("utf8");
      if (printable(text) && /[a-z]/i.test(text)) return { from: "base64", text };
    } catch { /* not base64 */ }
  }
  return undefined;
}

/** UPS, USPS, FedEx and DHL Express numbers, by shape, with the carrier's page. */
export function tracking(t: string): Analysis["tracking"] {
  const s = t.replace(/\s/g, "");
  if (/^1Z[0-9A-Z]{16}$/i.test(s)) return { carrier: "UPS", url: `https://www.ups.com/track?tracknum=${s.toUpperCase()}` };
  if (/^(?:9[2345]\d{20,22}|\d{20,22})$/.test(s)) return { carrier: "USPS", url: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${s}` };
  if (/^(?:\d{12}|\d{15})$/.test(s)) return { carrier: "FedEx", url: `https://www.fedex.com/fedextrack/?trknbr=${s}` };
  if (/^JD\d{18}$/i.test(s)) return { carrier: "DHL", url: `https://www.dhl.com/en/express/tracking.html?AWB=${s.toUpperCase()}` };
  return undefined;
}

/** A git sha (7 to 40 hex, not all digits), `owner/repo#12`, or `owner/repo`. */
export function git(t: string): Analysis["git"] {
  if (SHA_RE.test(t) && !/^\d+$/.test(t)) return { kind: "sha", short: t.slice(0, 7), label: `Commit ${t.slice(0, 7)}` };
  const issue = ISSUE_RE.exec(t);
  if (issue) return { kind: "issue", url: `https://github.com/${issue[1]}/${issue[2]}/issues/${issue[3]}`, label: `${issue[1]}/${issue[2]} #${issue[3]}` };
  const repo = REPO_RE.exec(t);
  if (repo && !/^\d+$/.test(repo[1]) && !repo[2].endsWith(".")) return { kind: "repo", url: `https://github.com/${repo[1]}/${repo[2]}`, label: `${repo[1]}/${repo[2]} on GitHub` };
  return undefined;
}

/** `{...}` or `[...]` that parses: pretty and minified forms and what it holds. */
export function json(t: string): Analysis["json"] {
  if (!/^[[{][\s\S]*[\]}]$/.test(t)) return undefined;
  try {
    const v = JSON.parse(t);
    const what = Array.isArray(v) ? `${v.length} ${v.length === 1 ? "item" : "items"}` : v && typeof v === "object" ? `${Object.keys(v).length} ${Object.keys(v).length === 1 ? "key" : "keys"}` : typeof v;
    return { pretty: JSON.stringify(v, null, 2), minified: JSON.stringify(v), what };
  } catch { return undefined; }
}

const asUrl = (t: string) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`);

/**
 * Everything the text could be, from one trimmed copy of it; `paths` are
 * the lines that exist on disk (the caller stats them, this only reads
 * the result). A long text keeps its counts only.
 */
export function analyzeText(entry: ClipboardEntry, text: string, paths: PathInfo[]): Analysis {
  const a: Analysis = { entry, text, paths, stats: stats(text) };
  const t = text.trim();
  if (!t || t.length > ANALYZE_MAX) return a;
  const oneLine = !t.includes("\n");
  if (paths.length > 1 || entry.kind === "files") a.fileList = { count: paths.length, bytes: paths.reduce((n, p) => n + p.bytes, 0) };
  if (oneLine && t.length <= 2048 && URL_RE.test(t) && !EMAIL_RE.test(t)) a.url = asUrl(t);
  const c = t.length <= 64 && !a.url ? parseColor(t) : undefined;
  if (c && !/^\d+$/.test(t)) a.color = { rgb: c, typed: t };
  if (oneLine && EMAIL_RE.test(t)) a.email = t;
  if (oneLine) a.date = parseDate(t);
  // Ten bare digits are a unix time before they are a phone number; a number with separators or a `+` is a phone.
  if (oneLine && PHONE_RE.test(t) && a.date?.from !== "unix") {
    const digits = t.replace(/\D/g, "");
    if (digits.length >= 7 && digits.length <= 15) a.phone = { digits: (t.startsWith("+") ? "+" : "") + digits, typed: t };
  }
  a.json = json(t);
  if (oneLine && NUMBER_RE.test(t)) a.number = { value: Number(t.replace(/,/g, "")), typed: t };
  if (oneLine && !a.number && EXPR_RE.test(t) && !(a.phone && !/[*/^%]/.test(t))) {
    const v = evaluate(t);
    if (v !== undefined) a.expr = { expr: t.replace(/\s+/g, " "), value: v };
  }
  if (oneLine && !a.url && !a.number) a.decoded = decode(t);
  if (oneLine && !a.url) a.tracking = tracking(t);
  if (oneLine && !a.url && !a.number && !a.decoded) a.git = git(t);
  return a;
}

// ---- the rows ---------------------------------------------------------------

/** What `rows` needs from the palette's settings and the environment. */
export type RowOpts = { shortener?: string; ocr?: boolean; qr?: boolean; now?: number };

const clip = (s: string, n = PREVIEW) => { const one = s.replace(/\s+/g, " ").trim(); return one.length > n ? one.slice(0, n - 1) + "…" : one; };
const fence = (s: string, lang = "") => "````" + lang + "\n" + s.replace(/````/g, "```​`") + "\n````";
const swatch = (hex: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="${hex}"/></svg>`)}`;
const wideSwatch = (hex: string) => `![](data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="64"><rect width="320" height="64" rx="8" fill="${hex}"/></svg>`)})`;
const item = (id: string, name: string, subtitle: string | undefined, icon: Item["icon"], actions: Action[], more: Partial<Item> = {}): Item => ({ id, name, subtitle, icon, section: SECTION, ...more, actions: [...actions, HIDE] });

/** A file name for the entry: the text's first words as `.txt`, an image's size as `.png`, a file list as `paths.txt`. */
export function fileNameFor(e: Pick<ClipboardEntry, "kind" | "text" | "name" | "width" | "height">): string {
  const stem = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 6).join(" ").slice(0, 60) || "Clipboard";
  if (e.kind === "image") return `${e.name ? stem(e.name) : `Image ${e.width ?? "?"}x${e.height ?? "?"}`}.png`;
  if (e.kind === "files") return `${e.name ? stem(e.name) : "paths"}.txt`;
  return `${stem(e.name ?? e.text!)}.txt`;
}

/**
 * The QR code of `text` as an SVG data url (level M, quiet zone of 2), or
 * nothing when it does not fit. Scalable by default (a row icon takes its
 * box); `size` pins the width and height in px, which is what a markdown
 * image in a level wants, since the pane would otherwise draw it at its
 * full width and cut the bottom off.
 */
export function qrSvg(text: string, cell = 4, size?: number): string | undefined {
  try {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: cell, margin: cell * 2, scalable: true });
    return `data:image/svg+xml;utf8,${encodeURIComponent(size ? svg.replace("<svg ", `<svg width="${size}" height="${size}" `) : svg)}`;
  } catch { return undefined; }
}
/** The size a QR code is drawn at in a `show` level. */
export const QR_SHOW_PX = 320;

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "heic", "svg", "bmp", "tiff", "avif"];
const pathGlyph = (p: PathInfo) => (p.dir && !(MAC && p.path.endsWith(".app")) ? GLYPH.folder : IMAGE_EXT.includes(extname(p.path).slice(1).toLowerCase()) ? GLYPH.image : GLYPH.file);
const short = (p: string, home: string) => (p === home ? "~" : p.startsWith(home + "/") ? "~" + p.slice(home.length) : p);

/** "Title Case" as a headline: every word capitalised but short joining words after the first. */
export const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c, i) => (i > 0 && /^(a|an|and|as|at|but|by|for|in|of|on|or|the|to)\b/.test(s.slice(i).toLowerCase()) ? c : c.toUpperCase()));

/**
 * The rows for an analysis, the most specific first: what the text is,
 * then what every text is. Each row's primary action is the one thing it
 * is for (open the address, open the picker, call, pretty-print, copy the
 * answer, paste as plain); the rest sit behind it in the panel.
 */
export function rows(a: Analysis, o: RowOpts = {}, home = ""): Item[] {
  const out: Item[] = [];
  const e = a.entry;
  const now = o.now ?? Date.now();
  if (e.kind === "image") {
    const dims = e.width && e.height ? `${e.width} × ${e.height}` : "image";
    out.push(item("image", `Image ${dims}`, `${bytes(e.bytes)} · PNG`, { image: `icon://localhost/clip?id=${e.id}&size=48` }, [
      { id: "save", title: "Save to Desktop" }, { id: "copy-file", title: "Copy as PNG file", shortcut: "cmd+shift+c" }, { id: "paste", title: "Paste" },
    ], { detail: { markdown: `![](icon://localhost/clip?id=${e.id}&size=0)`, metadata: [{ label: "Size", value: `${dims} px · ${bytes(e.bytes)}` }, { label: "Copied", value: when(e.at) }] } }));
    if (o.ocr) out.push(item("ocr", "Recognise text in the image", "OCR; the text is copied", GLYPH.ocr, [{ id: "ocr", title: "Recognise and copy" }, { id: "ocr-paste", title: "Recognise and paste" }]));
  }
  if (a.url) {
    const host = a.url.replace(/^[a-z]+:\/\//i, "");
    const actions: Action[] = [
      { id: "open", title: "Open" }, { id: "private", title: "Open in private window", shortcut: "cmd+shift+o" },
      { id: "markdown", title: "Copy as Markdown link", shortcut: "cmd+shift+m" }, { id: "copy", title: "Copy URL", shortcut: "cmd+c" },
      ...(o.shortener ? [{ id: "shorten", title: "Shorten and copy", shortcut: "cmd+shift+s" }] : []),
    ];
    out.push(item("url", a.title ? clip(a.title, 120) : clip(host, 120), a.title ? a.url : undefined, undefined, actions, { url: a.url, detail: { markdown: `# ${a.title ?? host}\n\n\`\`\`\n${a.url}\n\`\`\``, metadata: [{ label: "Site", link: { text: host.split(/[/?#]/)[0], href: a.url } }, ...(a.title ? [{ label: "Title", value: a.title }] : [])] } }));
    const qr = o.qr === false ? undefined : qrSvg(a.url);
    if (qr) out.push(item("qr", "QR code", "Show it large, or save it", { image: qr }, [{ id: "show", title: "Show QR code" }, { id: "save-qr", title: "Save QR to Desktop" }], { detail: { markdown: `![](${qrSvg(a.url, 8)})\n\n\`${a.url}\`` } }));
  }
  if (a.color) {
    const hex = toHex(a.color.rgb);
    out.push(item("color", a.color.typed, `${hex} · ${toRgb(a.color.rgb)} · ${toHslString(a.color.rgb)}`, { image: swatch(hex) }, [
      { id: "picker", title: "Open in Colour Picker" }, { id: "hex", title: "Copy hex", shortcut: "cmd+shift+c" }, { id: "rgb", title: "Copy rgb()" }, { id: "hsl", title: "Copy hsl()" },
    ], { detail: { markdown: wideSwatch(hex), metadata: [{ label: "Hex", value: hex }, { label: "RGB", value: toRgb(a.color.rgb) }, { label: "HSL", value: toHslString(a.color.rgb) }] } }));
  }
  a.paths.slice(0, a.fileList ? FILE_ROWS : 1).forEach((p, i) => {
    const reveal = MAC ? "Reveal in Finder" : "Show in file manager";
    out.push(item(`path:${i}`, basename(p.path) || p.path, short(dirname(p.path), home), pathGlyph(p), [
      { id: "open", title: "Open" }, { id: "reveal", title: reveal, shortcut: "cmd+enter" }, { id: "open-with", title: "Open with…", shortcut: "cmd+o" },
      { id: "copy-name", title: "Copy name", shortcut: "cmd+shift+c" }, { id: "copy", title: "Copy path", shortcut: "cmd+c" },
    ], { accessories: p.dir ? [{ text: "folder" }] : [{ text: bytes(p.bytes) }], detail: { metadata: [{ label: "Path", value: short(p.path, home) }, ...(p.dir ? [] : [{ label: "Size", value: bytes(p.bytes) }])] } }));
  });
  if (a.fileList && a.fileList.count > 0) {
    const n = a.fileList.count;
    out.push(item("files", `${n} ${n === 1 ? "file" : "files"} on the clipboard`, `${bytes(a.fileList.bytes)} in all`, GLYPH.files, [{ id: "reveal-all", title: MAC ? "Reveal in Finder" : "Show in file manager" }, { id: "copy-paths", title: "Copy paths, one per line" }, { id: "copy-names", title: "Copy names" }], { detail: { markdown: a.paths.map((p) => `- \`${short(p.path, home)}\``).join("\n") } }));
  }
  if (a.email) out.push(item("email", a.email, "Compose a message", GLYPH.email, [{ id: "compose", title: "Compose" }, { id: "copy", title: "Copy address", shortcut: "cmd+c" }]));
  if (a.phone) out.push(item("phone", a.phone.typed, `Call ${a.phone.digits}`, GLYPH.phone, [{ id: "call", title: "Call" }, { id: "copy-digits", title: "Copy digits", shortcut: "cmd+c" }, { id: "facetime", title: "FaceTime" }]));
  if (a.json) out.push(item("json", `JSON · ${a.json.what}`, `${bytes(a.json.minified.length)} minified, ${a.json.pretty.split("\n").length} lines pretty`, GLYPH.json, [{ id: "pretty", title: "Pretty-print to clipboard" }, { id: "minify", title: "Minify to clipboard", shortcut: "cmd+shift+m" }], { detail: { markdown: fence(a.json.pretty.length > 20_000 ? a.json.pretty.slice(0, 20_000) + "\n…" : a.json.pretty, "json") } }));
  if (a.expr) out.push(item("calc", `${a.expr.expr} = ${fmt(a.expr.value)}`, "Copy the answer", GLYPH.calc, [{ id: "copy-answer", title: "Copy answer" }, { id: "paste-answer", title: "Paste answer", shortcut: "cmd+enter" }, { id: "copy-both", title: "Copy expression = answer" }]));
  if (a.number) {
    const v = a.number.value;
    const int = Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
    out.push(item("number", fmt(v), int ? `0x${v.toString(16)} · 0b${v.toString(2).slice(0, 32)} · 0o${v.toString(8)}` : "Copy it plain", GLYPH.number, [
      { id: "copy-plain", title: "Copy without formatting" }, ...(int ? [{ id: "copy-hex", title: "Copy as hex" }, { id: "copy-bin", title: "Copy as binary" }] : []),
    ]));
  }
  if (a.date) {
    const { at } = a.date;
    out.push(item("date", `${dayNameYear(at)} ${clock(at)}`, `${ago(at, { now })} · ${at.toISOString()}`, a.date.from === "unix" ? GLYPH.clock : GLYPH.date, [
      { id: "copy-local", title: "Copy local time" }, { id: "copy-iso", title: "Copy ISO 8601 (UTC)" }, { id: "copy-unix", title: "Copy unix seconds" },
    ]));
  }
  if (a.decoded) out.push(item("decoded", clip(a.decoded.text), `Decoded from ${a.decoded.from}`, GLYPH.decode, [{ id: "copy-decoded", title: "Copy decoded text" }, { id: "paste-decoded", title: "Paste decoded text", shortcut: "cmd+enter" }], { detail: { markdown: fence(a.decoded.text.slice(0, 20_000)) } }));
  if (a.tracking) out.push(item("track", `Track with ${a.tracking.carrier}`, a.tracking.url.replace(/^https?:\/\//, ""), GLYPH.track, [{ id: "open", title: `Open ${a.tracking.carrier} tracking` }], { url: a.tracking.url }));
  if (a.git) {
    if (a.git.kind === "sha") out.push(item("git", a.git.label, "A git commit hash", GLYPH.git, [{ id: "copy-short", title: `Copy short sha ${a.git.short}` }, { id: "copy", title: "Copy full sha", shortcut: "cmd+c" }]));
    else out.push(item("git", a.git.label, a.git.url!.replace(/^https?:\/\//, ""), GLYPH.github, [{ id: "open", title: "Open on GitHub" }, { id: "copy-url", title: "Copy GitHub URL", shortcut: "cmd+c" }], { url: a.git.url }));
  }
  if (a.text !== undefined && a.stats) {
    const s = a.stats;
    const first = clip(a.text, 100) || "(whitespace)";
    out.push(item("text", first, `${s.words} ${s.words === 1 ? "word" : "words"} · ${s.chars} ${s.chars === 1 ? "char" : "chars"}${s.lines > 1 ? ` · ${s.lines} lines` : ""}`, GLYPH.text, [
      { id: "paste-plain", title: "Paste as plain text" }, { id: "snippet", title: "Save as snippet", shortcut: "cmd+s" },
      { id: "title", title: "Copy as Title Case" }, { id: "lower", title: "Copy lowercase" }, { id: "upper", title: "Copy UPPERCASE" }, { id: "slug", title: "Copy as slug" }, { id: "trim", title: "Copy trimmed" },
    ], { detail: { markdown: fence(a.text.length > 20_000 ? a.text.slice(0, 20_000) + "\n…" : a.text), metadata: [{ label: "Words", value: String(s.words) }, { label: "Characters", value: String(s.chars) }, { label: "Lines", value: String(s.lines) }, { label: "Copied", value: when(e.at) }] } }));
  }
  return out;
}

/** The transform an action of the text row asks for. */
export function transform(action: string, text: string): string | undefined {
  switch (action) {
    case "title": return titleCase(text);
    case "lower": return text.toLowerCase();
    case "upper": return text.toUpperCase();
    case "slug": return slug(text);
    case "trim": return text.trim();
    default: return undefined;
  }
}

/** `<title>` of an http(s) page, within `ms`; nothing for anything else or on any trouble. Decodes the common entities. */
export async function fetchTitle(url: string, ms = 1000): Promise<string | undefined> {
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: "text/html", "user-agent": "pal (clipboard rows)" }, redirect: "follow" });
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("html")) return undefined;
    const reader = r.body?.getReader();
    if (!reader) return undefined;
    let html = "";
    const dec = new TextDecoder();
    while (html.length < 64 * 1024) {
      const { value, done } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      if (/<\/title>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    return titleOf(html);
  } catch { return undefined; }
}

/** The `<title>` text of an HTML head, entities decoded and whitespace collapsed. */
export function titleOf(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  const t = m[1].replace(/&(amp|lt|gt|quot|#39|apos|nbsp|#(\d+)|#x([0-9a-f]+));/gi, (_, name: string, dec?: string, hex?: string) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " } as Record<string, string>)[name.toLowerCase()] ?? _,
  ).replace(/\s+/g, " ").trim();
  return t || undefined;
}

/** The browser and flag that open `url` in a private window, by what is installed; nothing when none is. */
export function privateArgv(installed: (app: string) => boolean, url: string, preferred = ""): string[] | undefined {
  const known: [string, string][] = [["Google Chrome", "--incognito"], ["Brave Browser", "--incognito"], ["Microsoft Edge", "--inprivate"], ["Chromium", "--incognito"], ["Vivaldi", "--incognito"], ["Firefox", "--private-window"]];
  const order = preferred ? [...known.filter(([n]) => n.toLowerCase() === preferred.toLowerCase()), ...known] : known;
  const hit = order.find(([name]) => installed(name));
  if (!hit) return undefined;
  return MAC ? ["open", "-na", hit[0], "--args", hit[1], url] : [hit[0].toLowerCase().replace(/ browser$/, "").replace(/ /g, "-"), hit[1], url];
}

/** `~/Desktop/Clipboard 2026-09-16 21.05.33.png`: where a saved image or QR goes. */
export const desktopName = (home: string, ext: string, at = new Date()) => `${home}/Desktop/Clipboard ${at.toISOString().slice(0, 19).replace("T", " ").replace(/:/g, ".")}.${ext}`;
