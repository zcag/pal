// The pure half of the extension: what the API's message shapes carry
// (headers, addresses, MIME parts, base64url bodies), HTML to text with
// the quoted replies folded, the markdown the pane shows, the RFC 822
// text a send needs, and the Gmail links. No network, no settings; the
// tests import it as is.
import { mdEscape as escapeMd } from "@zcag/pal";

/** `Name <a@b>`, `a@b`, `"Name" <a@b>`: the two parts, the name empty when there is none. */
export type Address = { name: string; email: string };

export function parseAddress(raw: string | undefined): Address {
  const s = (raw ?? "").trim();
  if (!s) return { name: "", email: "" };
  const m = s.match(/^"?(.*?)"?\s*<([^<>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: s.replace(/^<|>$/g, "").toLowerCase() };
}

/** Every address of a `To:` or `Cc:` line (commas outside quotes and brackets split). */
export function parseAddresses(raw: string | undefined): Address[] {
  const out: Address[] = [];
  let cur = "", quoted = false, depth = 0;
  for (const ch of raw ?? "") {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") depth++;
    else if (!quoted && ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && !quoted && depth === 0) { if (cur.trim()) out.push(parseAddress(cur)); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(parseAddress(cur));
  return out.filter((a) => a.email);
}

/** What a row calls the sender: the name, else the part of the address before the @. */
export const displayName = (a: Address): string => a.name || a.email.split("@")[0] || "?";

// ---- the API's shapes -------------------------------------------------------------

export type Header = { name: string; value: string };
export type Part = { partId?: string; mimeType?: string; filename?: string; headers?: Header[]; body?: { size?: number; data?: string; attachmentId?: string }; parts?: Part[] };
export type Message = { id: string; threadId: string; labelIds?: string[]; snippet?: string; internalDate?: string; sizeEstimate?: number; payload?: Part };
export type Attachment = { filename: string; mimeType: string; size: number };

/** A header's value, whatever the case of its name. */
export const header = (p: Part | undefined, name: string): string | undefined => p?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

/** Gmail's base64url body data as text. */
export function decodeBody(data: string | undefined): string {
  if (!data) return "";
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

/** The text and HTML bodies of a message and its attachments, walking the MIME tree; a part with a filename is an attachment. */
export function bodyOf(payload: Part | undefined): { text: string; html: string; attachments: Attachment[] } {
  const out = { text: "", html: "", attachments: [] as Attachment[] };
  const walk = (p: Part | undefined) => {
    if (!p) return;
    const mime = (p.mimeType ?? "").toLowerCase();
    if (p.filename) out.attachments.push({ filename: p.filename, mimeType: mime, size: p.body?.size ?? 0 });
    else if (mime === "text/plain" && !out.text) out.text = decodeBody(p.body?.data);
    else if (mime === "text/html" && !out.html) out.html = decodeBody(p.body?.data);
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  return out;
}

/** With `format=metadata` the parts are not sent: a `multipart/mixed` top level is the sign of an attachment (a guess the pane confirms). */
export const looksAttached = (payload: Part | undefined): boolean => (payload?.mimeType ?? "").toLowerCase() === "multipart/mixed";

// ---- HTML to text --------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#160": " " };
const entity = (_: string, e: string): string => ENTITIES[e] ?? (e.startsWith("#x") ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith("#") ? String.fromCodePoint(Number(e.slice(1))) : `&${e};`);
const unescape = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, entity);

/** What stands in for a folded quote. */
export const QUOTE_FOLD = "[quoted text folded]";

/**
 * An HTML body as text: the head, scripts and styles gone, a quoted reply
 * (Gmail's `gmail_quote`, a `blockquote`, Outlook's `#divRplyFwdMsg`)
 * replaced by one fold line, breaks and block ends as newlines, list
 * items as `- `, links as `text (url)` when the two differ, entities
 * decoded, runs of blank lines collapsed.
 */
export function htmlToText(html: string): string {
  let s = html.replace(/\r\n?/g, "\n");
  s = s.replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = foldHtmlQuotes(s);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|table|blockquote|pre)>/gi, "\n");
  s = s.replace(/<(p|div|h[1-6]|tr|table|pre)\b[^>]*>/gi, "\n");
  s = s.replace(/<li\b[^>]*>/gi, "- ");
  s = s.replace(/<\/t[dh]>/gi, "\t");
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
    const text = unescape(inner.replace(/<[^>]+>/g, "")).trim();
    const url = unescape(href.trim());
    if (!text) return url;
    if (!/^https?:/i.test(url) || text === url || text.replace(/\/$/, "") === url.replace(/^https?:\/\//i, "").replace(/\/$/, "")) return text;
    return `${text} (${url})`;
  });
  s = s.replace(/<[^>]+>/g, "");
  s = unescape(s).replace(/[ \t]{2,}/g, " ");
  return tidy(s);
}

/** The quote containers of the mail clients, each replaced by the fold line; a nested one goes with its parent. */
function foldHtmlQuotes(html: string): string {
  let s = html.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, `\n${QUOTE_FOLD}\n`);
  // Gmail and Outlook wrap the quote in a div with a class or an id; a div nests, so match its end by depth.
  const starts = /<div\b[^>]*(class="[^"]*\bgmail_quote\b[^"]*"|id="divRplyFwdMsg"|class="[^"]*\bmoz-cite-prefix\b[^"]*"|class="[^"]*\byahoo_quoted\b[^"]*")[^>]*>/i;
  for (let m = starts.exec(s); m; m = starts.exec(s)) {
    const from = m.index;
    let depth = 1, at = from + m[0].length;
    const tag = /<(\/?)div\b[^>]*>/gi;
    tag.lastIndex = at;
    for (let t = tag.exec(s); t; t = tag.exec(s)) {
      depth += t[1] ? -1 : 1;
      at = t.index + t[0].length;
      if (depth === 0) break;
    }
    if (depth !== 0) at = s.length;
    s = `${s.slice(0, from)}\n${QUOTE_FOLD}\n${s.slice(at)}`;
  }
  return s;
}

/**
 * A plain-text body with its quoted reply folded: from the first `On ...
 * wrote:` line (or `-----Original Message-----`, or `From:` after a blank
 * line as Outlook forwards) to the end, and any run of `>` lines, each
 * replaced by the fold line.
 */
export function foldTextQuotes(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const cut = lines.findIndex((l, i) => /^On .{4,}wrote:\s*$/.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()) || /^_{10,}$/.test(l.trim()) || (/^From:\s/.test(l) && i > 0 && !lines[i - 1].trim()));
  const kept = cut >= 0 ? [...lines.slice(0, cut), QUOTE_FOLD] : lines;
  const out: string[] = [];
  let inQuote = false;
  for (const l of kept) {
    const q = /^\s*>/.test(l);
    if (q && !inQuote) out.push(QUOTE_FOLD);
    if (!q) out.push(l);
    inQuote = q;
  }
  return tidy(out.join("\n"));
}

/** Trailing spaces off every line, three or more newlines to two, the fold line at most once in a row, the whole trimmed. */
function tidy(s: string): string {
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(new RegExp(`(${QUOTE_FOLD.replace(/[[\]]/g, "\\$&")}\\n+)+${QUOTE_FOLD.replace(/[[\]]/g, "\\$&")}`, "g"), QUOTE_FOLD)
    .trim();
}

/** The message as text for the pane: the plain part when there is one (its quotes folded), else the HTML converted, else the snippet. */
export function messageText(text: string, html: string, snippet = ""): string {
  if (text.trim()) return foldTextQuotes(text);
  if (html.trim()) return htmlToText(html);
  return snippet.trim();
}

// ---- markdown ---------------------------------------------------------------------------

/** Mail text as markdown that reads as the text (the SDK's `mdEscape`), the fold line in italics. */
export const mdEscape = (text: string): string => escapeMd(text).split(QUOTE_FOLD.replace(/[[\]]/g, "\\$&")).join(`_${QUOTE_FOLD.slice(1, -1)}_`);

// ---- outgoing ---------------------------------------------------------------------------

export type Outgoing = { from: string; to: string; cc?: string; subject: string; text: string; inReplyTo?: string; references?: string };

/** RFC 2047 for a header that is not ASCII, else as is. */
const headerText = (s: string): string => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);

/** The RFC 822 message `messages.send` takes, as base64url (`raw`). */
export function buildRaw(m: Outgoing): string {
  const lines = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    ...(m.cc?.trim() ? [`Cc: ${m.cc.trim()}`] : []),
    `Subject: ${headerText(m.subject)}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(m.references ? [`References: ${m.references}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `Re: ` once in front of a subject. */
export const replySubject = (subject: string): string => (/^re:\s/i.test(subject.trim()) ? subject.trim() : `Re: ${subject.trim()}`);

/** The original under a reply, as Gmail writes it: `On <date>, <who> wrote:` then every line quoted. */
export function quoted(date: string, who: string, text: string): string {
  return `On ${date}, ${who} wrote:\n${text.split("\n").map((l) => `> ${l}`).join("\n")}`;
}

/** The body as sent: the text, then the signature after a blank line when there is one, then the quote. */
export const withSignature = (text: string, signature: string): string => (signature.trim() ? `${text.trimEnd()}\n\n${signature.trim()}` : text.trimEnd());

// ---- links ----------------------------------------------------------------------------------

/** The account's Gmail, or the account-less one when the address is not known yet. */
export const gmailBase = (address: string): string => `https://mail.google.com/mail/u/${address ? encodeURIComponent(address) : "0"}/`;

/** A thread in the account's Gmail: under `#inbox` while it is in the inbox, else under `#all`. */
export const threadUrl = (address: string, threadId: string, inInbox: boolean): string => `${gmailBase(address)}#${inInbox ? "inbox" : "all"}/${threadId}`;

/** A draft's thread, on the Drafts list. */
export const draftUrl = (address: string, threadId: string): string => `${gmailBase(address)}#drafts/${threadId}`;

/** Gmail's own anchors for the system labels; a user label by name. */
const SYSTEM_ANCHORS: Record<string, string> = { INBOX: "inbox", STARRED: "starred", SENT: "sent", DRAFT: "drafts", SPAM: "spam", TRASH: "trash", IMPORTANT: "imp", UNREAD: "search/is:unread", CHAT: "chats" };
export const labelUrl = (address: string, id: string, name: string): string => {
  const anchor = SYSTEM_ANCHORS[id];
  if (anchor) return `${gmailBase(address)}#${anchor}`;
  if (id.startsWith("CATEGORY_")) return `${gmailBase(address)}#category/${id.slice(9).toLowerCase()}`;
  return `${gmailBase(address)}#label/${name.split("/").map(encodeURIComponent).join("/")}`;
};

/** The label's spelling in a search: `label:inbox`, `label:"Work/Reports"`. */
export const labelQuery = (id: string, name: string): string => (SYSTEM_ANCHORS[id] ? `in:${id.toLowerCase()}` : id.startsWith("CATEGORY_") ? `category:${id.slice(9).toLowerCase()}` : /\s/.test(name) ? `label:"${name}"` : `label:${name}`);

/** What a system label reads as; a user label is its name; a category `Category/Promotions`. */
const SYSTEM_TITLES: Record<string, string> = { INBOX: "Inbox", STARRED: "Starred", SENT: "Sent", DRAFT: "Drafts", SPAM: "Spam", TRASH: "Trash", IMPORTANT: "Important", UNREAD: "Unread", CHAT: "Chats" };
export const labelTitle = (id: string, name: string): string => SYSTEM_TITLES[id] ?? (id.startsWith("CATEGORY_") ? `${id.slice(9)[0]}${id.slice(10).toLowerCase()}` : name);

/** The label a search hit sits under: the first user label, else where Gmail keeps it (Inbox, Sent, Drafts, Spam, Trash, else Archive). */
export function sectionOf(labelIds: string[] | undefined, names: Map<string, string>): string {
  const ids = labelIds ?? [];
  for (const id of ids) { const n = names.get(id); if (n && !/^[A-Z_]+$/.test(id)) return n; }
  for (const id of ["INBOX", "SENT", "DRAFT", "SPAM", "TRASH"]) if (ids.includes(id)) return labelTitle(id, id);
  return "Archive";
}
