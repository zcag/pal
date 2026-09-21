// Verification codes out of Messages, read from `~/Library/Messages/chat.db`
// itself. One read-only SQLite query per listing over the last `hours` of
// incoming messages, a code pulled out of each text that names one, newest
// first, Today then Earlier. Live: listed again on every show, so the code
// that just arrived is at the top. Enter pastes the code into the app in
// front, the other actions copy the code or the sender. A copied code is
// a concealed copy (`conceal`): out of every clipboard history and gone
// from the clipboard after 30 s.
//
// The database is behind Full Disk Access on macOS: SQLite answers
// `SQLITE_AUTH` ("authorization denied") for a process without it, and so
// does `cp`, so the one hint row points at the Privacy pane. A database
// SQLite reports locked is copied (with its -wal and -shm) and the copy is
// read. Linux has no Messages, so the palette is one "Unavailable" row.
//
// The bar item `latest-code` puts the newest code on the strip for
// `BAR_WINDOW_MS` after it arrived (the same reader; hidden otherwise, and
// on Linux). Its popover (view.ts) shows the code large with the sender
// and the message, a bar counting the minute down (pushed every second
// while the popover shows, from the last read: `view/shown` with
// `{ bar }`), and the two codes before it; Enter or a click copies.
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { conceal, CONCEAL_SECONDS, errorMessage, hint, home, settings, toast, truncate, view as liveView, when as whenAt, type Action, type BarItem, type Effect, type Extension, type Item } from "@zcag/pal";
import { PREVIOUS, render } from "./view.ts";

/** `[extensions.otp]`, defaults in pal.json. */
type Settings = { hours: number; senders: string[]; db: string; contacts: string };

type Row = { id: number; text: string | null; body: Uint8Array | null; date: number; sender: string | null; chat: string | null; chat_name: string | null };
type Code = { id: string; code: string; sender: string; name: string; text: string; at: number };

const MAC = process.platform === "darwin";
/** md-message_text, the rows and the palette; md-lock_alert and md-message_off for the hint rows. */
const ICON = "\u{f0369}";
const HINT_ICON = { locked: "\u{f08ee}", none: "\u{f164d}" };
/** The bar's glyph (nf-fa-key), drawn from the bundled Nerd Font. */
const BAR_GLYPH = "\u{f084}";
/** How long a code stays on the strip after it arrived. */
const BAR_WINDOW_MS = 60_000;
/** The popover's tick while it shows; env for the tests. */
const TICK_MS = Number(process.env.PAL_OTP_TICK_MS) || 1000;
const EXTENSION = "otp";
const ITEM = "latest-code";
/** Rows read per listing at most; the time window bounds it first. */
const LIMIT = 400;
/** Seconds between the unix epoch and Apple's (2001-01-01). */
const APPLE_EPOCH = 978_307_200;
const FDA_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
const CONTACTS_DIR = "~/Library/Application Support/AddressBook";
/** Seconds a contacts lookup table is kept. */
const CONTACTS_TTL = 60;

const ACTIONS: Action[] = [
  { id: "paste", title: "Paste code" },
  { id: "copy", title: "Copy code", shortcut: "cmd+c" },
  { id: "copy-sender", title: "Copy sender", shortcut: "cmd+shift+c" },
];

// ---- the code in a message ------------------------------------------------

/** Google's `G-123456`; the digits are what the form takes. */
const GOOGLE = /\bG-(\d{6})\b/;
/** A run of 4..8 digits that is not part of an amount, a date, a time or a phone number (`1.250,00`, `16.09.2026`, `19:13`, `0850-222`). */
const DIGITS = /(?<!\d[.,:/-])(?<!\d)\d{4,8}(?![.,:/-]?\d)/g;
/** Only a message that talks about a code is a code; the word may carry a suffix (kodunuz, şifreniz, verification) but not a prefix (decode). */
const KEYWORD = /(?<!\p{L})(code|kod|şifre|sifre|otp|pin|parola|password|passcode|doğrulama|dogrulama|verif|c[oó]digo|token|2fa|one-time|tek kullan|security|auth)/giu;

export function extract(text: string): string | undefined {
  const g = GOOGLE.exec(text);
  if (g) return g[1];
  const keys = [...text.matchAll(KEYWORD)].map((m) => m.index!);
  if (keys.length === 0) return undefined;
  const near = (i: number) => Math.min(...keys.map((k) => Math.abs(k - i)));
  const found = [...text.matchAll(DIGITS)].map((m) => ({ code: m[0], score: near(m.index!) + (m[0].length === 6 ? 0 : 1) }));
  found.sort((a, b) => a.score - b.score);
  return found[0]?.code;
}

// ---- reading Messages -------------------------------------------------------

/**
 * Since Ventura `message.text` is often NULL and the text sits in
 * `attributedBody`, an NSAttributedString typedstream: the string follows the
 * `NSString` class name, five bytes of stream framing, and a length that is
 * one byte, or `0x81` + 2 bytes LE, or `0x82` + 4 bytes LE.
 */
export function bodyText(body: Uint8Array | null): string | undefined {
  if (!body) return undefined;
  const marker = Buffer.from("NSString");
  const i = Buffer.from(body).indexOf(marker);
  if (i < 0) return undefined;
  let p = i + marker.length + 5;
  const b = body[p];
  let len: number;
  if (b === 0x81) { len = body[p + 1] | (body[p + 2] << 8); p += 3; }
  else if (b === 0x82) { len = (body[p + 1] | (body[p + 2] << 8) | (body[p + 3] << 16) | (body[p + 4] << 24)) >>> 0; p += 5; }
  else { len = b; p += 1; }
  return new TextDecoder().decode(body.subarray(p, p + len));
}

/** `message.date` is nanoseconds since 2001 on every current macOS, seconds on an old one. */
const toMs = (d: number) => (d > 1e12 ? d / 1e6 : d * 1000) + APPLE_EPOCH * 1000;
const fromMs = (ms: number) => (ms - APPLE_EPOCH * 1000) * 1e6;

const QUERY = `
  SELECT m.ROWID id, m.text, m.attributedBody body, m.date, h.id sender, c.chat_identifier chat, c.display_name chat_name
  FROM message m
  LEFT JOIN handle h ON h.ROWID = m.handle_id
  LEFT JOIN chat_message_join j ON j.message_id = m.ROWID
  LEFT JOIN chat c ON c.ROWID = j.chat_id
  WHERE m.is_from_me = 0 AND m.date > ?1
  ORDER BY m.date DESC
  LIMIT ?2`;

const sqlite = (e: unknown) => (e as { code?: string })?.code ?? "";
const locked = (e: unknown) => /SQLITE_BUSY|SQLITE_LOCKED/.test(sqlite(e));

function read(file: string, since: number): Row[] {
  const db = new Database(file, { readonly: true });
  try { return db.query<Row, [number, number]>(QUERY).all(fromMs(since), LIMIT * 4); } finally { db.close(); }
}

/** The database and its journal copied aside, read there, removed: for one SQLite says is locked. */
function readCopy(file: string, since: number): Row[] {
  const dir = mkdtempSync(join(tmpdir(), "pal-otp-"));
  try {
    for (const suffix of ["", "-wal", "-shm"]) if (existsSync(file + suffix)) copyFileSync(file + suffix, join(dir, "chat.db" + suffix));
    return read(join(dir, "chat.db"), since);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// ---- who sent it --------------------------------------------------------------

let contacts: { at: number; names: Map<string, string> } | undefined;
const digits = (s: string) => s.replace(/\D/g, "");
/** A phone number keyed by its last ten digits, so `+90 5xx` and `05xx` meet. */
const phoneKey = (s: string) => digits(s).slice(-10);

/** Names from the Contacts databases (best effort: any failure means numbers stay numbers). */
function contactNames(setting: string): Map<string, string> {
  if (contacts && Date.now() - contacts.at < CONTACTS_TTL * 1000) return contacts.names;
  const names = new Map<string, string>();
  const files = setting ? [home(setting)] : contactDbs();
  for (const file of files) {
    try {
      const db = new Database(file, { readonly: true });
      try {
        const full = (r: { f: string | null; l: string | null; o: string | null }) => [r.f, r.l].filter(Boolean).join(" ") || r.o || "";
        for (const r of db.query<{ n: string; f: string | null; l: string | null; o: string | null }, []>("SELECT p.ZFULLNUMBER n, r.ZFIRSTNAME f, r.ZLASTNAME l, r.ZORGANIZATION o FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER").all()) {
          const name = full(r), key = phoneKey(r.n ?? "");
          if (name && key.length >= 7 && !names.has(key)) names.set(key, name);
        }
        for (const r of db.query<{ n: string; f: string | null; l: string | null; o: string | null }, []>("SELECT e.ZADDRESS n, r.ZFIRSTNAME f, r.ZLASTNAME l, r.ZORGANIZATION o FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER").all()) {
          const name = full(r), key = (r.n ?? "").toLowerCase();
          if (name && key && !names.has(key)) names.set(key, name);
        }
      } finally { db.close(); }
    } catch { /* no permission, no such file, another schema: numbers stay numbers */ }
  }
  contacts = { at: Date.now(), names };
  return names;
}

function contactDbs(): string[] {
  const root = home(CONTACTS_DIR);
  const out = [join(root, "AddressBook-v22.abcddb")];
  try { for (const d of readdirSync(join(root, "Sources"))) out.push(join(root, "Sources", d, "AddressBook-v22.abcddb")); } catch { /* none */ }
  return out.filter((f) => existsSync(f));
}

/** A number gets its contact's name; a shortcode or an alphanumeric originator is its own name. */
function senderName(raw: string, names: Map<string, string>): string {
  if (/^\+?[\d\s()-]{7,}$/.test(raw)) return names.get(phoneKey(raw)) ?? raw;
  if (raw.includes("@")) return names.get(raw.toLowerCase()) ?? raw;
  return raw;
}

// ---- rows -----------------------------------------------------------------------

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** What `pick` needs per row, from the last listing. */
const codes = new Map<string, Code>();

function collect(rows: Row[], s: Settings): Code[] {
  const deny = new Set(s.senders.map((x) => x.trim().toLowerCase()).filter(Boolean));
  const names = MAC ? contactNames(s.contacts) : new Map<string, string>();
  const seen = new Set<number>();
  const out: Code[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const text = oneLine(r.text ?? bodyText(r.body) ?? "");
    if (!text) continue;
    const raw = r.sender || r.chat_name || r.chat || "";
    if (!raw || deny.has(raw.toLowerCase())) continue;
    const code = extract(text);
    if (!code) continue;
    out.push({ id: String(r.id), code, sender: raw, name: senderName(raw, names), text, at: toMs(r.date) });
  }
  return out;
}

function item(c: Code, now: Date): Item {
  const when = new Date(c.at);
  return {
    id: c.id,
    name: c.name,
    subtitle: truncate(c.text, 140),
    icon: ICON,
    keywords: [c.code, c.sender, c.name].filter((k, i, a) => a.indexOf(k) === i),
    accessories: [{ tag: c.code, color: "green" }, { date: c.at }],
    section: sameDay(when, now) ? "Today" : "Earlier",
    detail: {
      markdown: c.text,
      metadata: [
        { label: "Code", tags: [{ text: c.code, color: "green" }] },
        { label: "From", value: c.name === c.sender ? c.sender : `${c.name} (${c.sender})` },
        { label: "Received", value: whenAt(when) },
      ],
    },
    actions: ACTIONS,
  };
}

/** The codes of the last `hours`, newest first; throws what SQLite did (a locked database is read from a copy first). */
function readCodes(s: Settings, hours = s.hours): Code[] {
  const file = home(s.db);
  const since = Date.now() - Math.max(1, hours) * 3600_000;
  let rows: Row[];
  try { rows = read(file, since); } catch (e) { if (!locked(e)) throw e; rows = readCopy(file, since); }
  return collect(rows, s).slice(0, LIMIT);
}

function list(): Item[] {
  codes.clear();
  if (!MAC) return [hint("unavailable", "Unavailable", "Verification codes read the Messages database, which only macOS has", { icon: HINT_ICON.none })];
  const s = settings.get<Settings>();
  let found: Code[];
  try {
    found = readCodes(s);
  } catch (e) {
    const code = sqlite(e), msg = errorMessage(e);
    if (code === "SQLITE_AUTH" || /authorization denied|not permitted|EPERM/i.test(msg)) {
      return [hint("fda", "Full Disk Access needed", "Allow pal under Privacy & Security, Full Disk Access, then open the palette again", { icon: HINT_ICON.locked, actions: [{ id: "settings", title: "Open System Settings" }] })];
    }
    if (code === "SQLITE_CANTOPEN" || /ENOENT|no such file|unable to open/i.test(msg)) return [hint("missing", "No Messages database", `${home(s.db)} is not there: open Messages once, or point the db setting at the file`, { icon: HINT_ICON.none })];
    return [hint("error", "Could not read Messages", msg, { icon: HINT_ICON.locked })];
  }
  const now = new Date();
  for (const c of found) codes.set(c.id, c);
  if (found.length === 0) return [hint("none", "No codes", `No message of the last ${s.hours} h names a code; raise Look back in Settings to scan further`, { icon: HINT_ICON.none })];
  return found.map((c) => item(c, now));
}

// ---- the bar item -----------------------------------------------------------

/** The last hour's codes, newest first: the first is the strip's while younger than the window, the next two the popover's "Earlier". Not on Linux, and not without the database (hidden, no hint). */
function recentCodes(): Code[] {
  if (!MAC) return [];
  try { return readCodes(settings.get<Settings>(), 1); } catch { return []; }
}
const inWindow = (c: Code | undefined, now = Date.now()) => (c && now - c.at <= BAR_WINDOW_MS ? c : undefined);
/** The newest code, while it is younger than the window. */
const latestCode = (): Code | undefined => inWindow(recentCodes()[0]);

/** The last read, for the popover's tick and its clicks: no database read per second. */
let snap: { latest?: Code; previous: Code[]; at: number } = { previous: [], at: 0 };

const popover = (now = Date.now()) => render({ latest: inWindow(snap.latest, now), previous: snap.previous, now, window: BAR_WINDOW_MS });

/** The code as the title, green, for a minute: `refresh` asks for the render that hides it once the minute is up; the popover's tree as the menu. Between codes the glyph and the popover are the `empty` shape a `show = "always"` config keeps, muted. Not on Linux, where nothing can be read. */
function renderBar(): BarItem {
  listen();
  const found = recentCodes();
  const now = Date.now();
  const c = inWindow(found[0], now);
  snap = { latest: c, previous: found.slice(1, 1 + PREVIOUS), at: now };
  if (!c) return MAC ? { hidden: true, empty: { icon: BAR_GLYPH, tooltip: "No recent code", menu: { view: popover(now) } } } : { hidden: true };
  return { icon: BAR_GLYPH, title: c.code, color: "green", tooltip: `${c.name}: ${truncate(c.text, 80)}`, refresh: Math.max(1, Math.ceil((BAR_WINDOW_MS - (now - c.at)) / 1000)), menu: { view: popover(now) } };
}

// ---- the popover's tick -------------------------------------------------------

let tick: ReturnType<typeof setInterval> | undefined;
/** The popover is up: every second the tree with the bar counted down, from the last read; ends with the popover, or once the minute is up (the strip's own refresh hides the item then). */
function startTick() {
  tick ??= setInterval(() => {
    if (!inWindow(snap.latest)) { stopTick(); return; }
    liveView.update(popover(), { extension: EXTENSION, bar: ITEM }).catch(() => {});
  }, TICK_MS);
}
function stopTick() { clearInterval(tick); tick = undefined; }
/** The shell says when the popover's level is up and when it left; listened for from the first render (the module is imported by tests outside the host too). */
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  liveView.onShown((ev) => { if (ev.bar === ITEM) startTick(); }, EXTENSION);
  liveView.onHidden((ev) => { if (ev.bar === ITEM) stopTick(); }, EXTENSION);
}

/** The code onto the clipboard, concealed, cleared after `CONCEAL_SECONDS`. */
const copyCode = (code: string): Effect => ({ copy: conceal(code), hud: `Copied code, clears in ${CONCEAL_SECONDS} s` });
const copyLatest = (): Effect => { const c = latestCode(); return c ? copyCode(c.code) : { hud: "No recent code" }; };

/** A key or a click in the popover: the newest code copied, pasted, its sender copied, an earlier one copied, the palette opened. */
function barAction(action: string): Effect {
  if (action === "open") return { push: { extension: EXTENSION, palette: "otp" } };
  if (action.startsWith("copy:")) {
    const c = snap.previous.find((x) => x.id === action.slice(5)) ?? (snap.latest?.id === action.slice(5) ? snap.latest : undefined);
    return c ? copyCode(c.code) : { keep: true, hud: "That code is no longer listed" };
  }
  const c = inWindow(snap.latest) ?? latestCode();
  if (!c) return { keep: true, hud: "No recent code" };
  switch (action) {
    case "paste": return { paste: { text: c.code } };
    case "copy-sender": return { copy: c.sender };
    default: return copyCode(c.code);
  }
}

export default {
  palettes: {
    otp: {
      title: "Verification Codes",
      live: true,
      placeholder: "Search codes and senders",
      list,
      pick: (id, action) => {
        if (id === "hint:fda") return { open: FDA_URL };
        const c = codes.get(id);
        if (!c) return toast("That code is no longer listed", undefined, "failure");
        switch (action) {
          case "copy": return copyCode(c.code);
          case "copy-sender": return { copy: c.sender };
          default: return { paste: { text: c.code } };
        }
      },
    },
  },
  bar: {
    [ITEM]: { render: renderBar, onOpen: copyLatest, onAction: barAction },
  },
  dispose: () => stopTick(),
} satisfies Extension;
