// The model over api.ts: chats with their unread run, a chat's last
// twenty messages as a conversation, the contacts, the archive search,
// profile pictures and the phone behind a `@lid`. Pure where it can be
// (the message shapes, the labels, the links: `msgOf`, `mediaLabel`,
// `chatLink`, `vcard` take no network), the loaders memoised so the bar
// item and the palettes share one chat list within `CHATS_FRESH_MS`.
import { existsSync } from "node:fs";
import { mdEscape } from "../gmail/mail.ts";
import { storage } from "@zcag/pal";
import { archived, chats as apiChats, conf, contact, contactsPage, history, log, pictures as apiPictures, resolvePhone, search as apiSearch, type ChatSummary, type Contact, type DbMessage, type LiveMessage, type SearchHit, PAGE } from "./api.ts";

export type Chat = {
  /** The chat's id as OpenWA spells it: `<phone>@c.us`, `<lid>@lid` (most direct chats since WhatsApp's LID era), `<id>@g.us`. */
  id: string;
  name: string;
  group: boolean;
  unread: number;
  /** Unix ms of the newest message. */
  at: number;
  /** The newest message as one line: the chat list's own text, or what the unread run says (with the sender for a group). */
  last?: string;
  /** Who wrote the newest message, when known (the unread run was fetched): "You", the chat's name, a group member. */
  who?: string;
  /** The newest incoming message's id, for a reply that quotes or a reaction. */
  latestId?: string;
  latestFromMe?: boolean;
  /** The picture url (pps.whatsapp.net, expiring) when the account has one; absent until asked. */
  avatar?: string;
};

export type Msg = {
  id: string;
  at: number;
  fromMe: boolean;
  /** "You" for an outgoing message, else the sender's name (the contact's saved name, the archive's, or the number). */
  who: string;
  /** The text, or the media label (`mediaLabel`) when there is none. */
  text: string;
  type: string;
  /** What the message replied to, when the archive knows it. */
  quoted?: string;
};

export type Person = { id: string; name: string; phone: string };

/** How long one chat list serves the bar and the palettes. */
export const CHATS_FRESH_MS = 30_000;
/** Unread chats whose newest messages are fetched live, so their rows say who said what. */
export const MAX_RUNS = 12;
/** Messages fetched per unread chat for the row and the popover; the pane asks for `PANE_MSGS`. */
export const RUN_MSGS = 5;
export const PANE_MSGS = 20;
/**
 * Pictures are asked for off the listing's path: the gateway resolves
 * them one by one at ~150 ms each (50 ids took 11.5 s live), so a pass
 * asks for `PICTURE_PASS` ids, passes chain in the background until the
 * top `PICTURE_WARM` chats are known, and the urls (good for about nine
 * days, `oe` in their query) are kept in storage under `pictures`.
 */
export const PICTURE_PASS = 8;
export const PICTURE_WARM = 48;
/** How many urls storage keeps (about 300 bytes each). */
export const PICTURE_KEEP = 200;
/** A url without a readable expiry, and a chat known to have no picture, are asked again after this long. */
export const PICTURE_TTL_MS = 24 * 3600_000;
/** A url is refreshed this long before its expiry. */
const PICTURE_MARGIN_MS = 24 * 3600_000;
export const CONTACTS_TTL_MS = 3600_000;
export const SEARCH_LIMIT = 40;
const AVATAR_MS = 2500, MAX_AVATAR = 96 * 1024, AVATAR_MISS_TTL = 15 * 60_000;

const s2ms = (s: number) => Math.round(s * 1000);
export const isGroupId = (id: string) => id.endsWith("@g.us");
export const isLid = (id: string) => id.endsWith("@lid");
/** The digits of a `<phone>@c.us` id; undefined for a LID or a group. */
export const phoneOfId = (id: string): string | undefined => (id.endsWith("@c.us") ? id.slice(0, -5) : undefined);

// ---- message shapes --------------------------------------------------------------------------

/** What a media message reads as on a row and in the pane: the kind in brackets, the caption or file name after it. */
export function mediaLabel(type: string, body: string): string {
  const kind: Record<string, string> = { image: "photo", video: "video", gif: "GIF", ptt: "voice message", voice: "voice message", audio: "audio", document: "document", sticker: "sticker", location: "location", vcard: "contact card", multi_vcard: "contact cards", contact: "contact card", poll_creation: "poll", poll: "poll", revoked: "message deleted", ciphertext: "waiting for the message", call_log: "call", e2e_notification: "security notice", notification_template: "notice", groups_v4_invite: "group invite" };
  const label = kind[type] ?? (type === "chat" || type === "text" ? "" : type.replace(/_/g, " "));
  const text = body.trim();
  if (!label) return text;
  return text ? `[${label}] ${text}` : `[${label}]`;
}

/** One message of a conversation from the live shape, the archive's row for it (names, quotes) when at hand, and a resolver for a sender's id. */
export function msgOf(m: LiveMessage, db: DbMessage | undefined, nameOf: (jid: string) => string, chatName: string): Msg {
  const sender = m.author || (m.isGroup ? undefined : m.from);
  const who = m.fromMe ? "You" : db?.chatName?.trim() || (sender ? nameOf(sender) : "") || (m.isGroup ? "" : chatName) || "Unknown";
  const text = mediaLabel(m.type, m.body ?? "") || (db?.metadata?.media?.filename ? `[document] ${db.metadata.media.filename}` : "");
  const quoted = db?.metadata?.quotedMessage?.body?.trim();
  return { id: m.id, at: s2ms(m.timestamp), fromMe: !!m.fromMe, who, text: text || "(no text)", type: m.type, ...(quoted && { quoted }) };
}

/** The archive's row as a message (a chat the live history cannot reach, or the search's hit opened). */
export function msgOfDb(d: DbMessage, nameOf: (jid: string) => string, chatName: string, group: boolean): Msg {
  const fromMe = d.direction === "outgoing";
  const sender = d.author || (group ? undefined : d.from);
  const who = fromMe ? "You" : d.chatName?.trim() || (sender ? nameOf(sender) : "") || (group ? "" : chatName) || "Unknown";
  const quoted = d.metadata?.quotedMessage?.body?.trim();
  return { id: d.waMessageId || d.id, at: s2ms(d.timestamp), fromMe, who, text: mediaLabel(d.type, d.body ?? "") || "(no text)", type: d.type, ...(quoted && { quoted }) };
}

/** WhatsApp's own quick reactions, in its order. */
export const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
/** A time today as the clock, else the day and the clock. */
export const clock = (ms: number) => { const d = new Date(ms); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };

/** The pane: one paragraph per message, `**who** · time`, the quoted reply under it as a blockquote, then the text (a media label in italics), markup escaped for marked. */
export function conversationMarkdown(msgs: Msg[]): string {
  return msgs.map((m) => {
    const head = `**${mdEscape(m.who)}** · ${clock(m.at)}`;
    const quoted = m.quoted ? `\n> ${mdEscape(oneLine(m.quoted))}` : "";
    const media = /^\[([^\]]+)\]\s?([\s\S]*)$/.exec(m.text);
    const body = media ? `_[${media[1]}]_${media[2] ? ` ${mdEscape(media[2])}` : ""}` : mdEscape(m.text);
    return `${head}${quoted}\n\n${body.trim()}`;
  }).join("\n\n");
}

// ---- links ---------------------------------------------------------------------------------------

export type Opener = "app" | "web";

/** Where a chat opens for the `open` setting's value: `app` or `web` as said; `auto` is the desktop app when installed (macOS), else the web client. */
export function opener(setting: string | undefined, platform = process.platform, appInstalled = whatsappInstalled): Opener {
  if (setting === "app" || setting === "web") return setting;
  return platform === "darwin" && appInstalled() ? "app" : "web";
}
/** The opener the settings ask for now. */
export const currentOpener = (): Opener => opener(conf().open);

const APP_PATHS = ["/Applications/WhatsApp.app", `${process.env.HOME ?? ""}/Applications/WhatsApp.app`];
export const whatsappInstalled = (): boolean => APP_PATHS.some((p) => existsSync(p));

/**
 * The link into a chat: `whatsapp://send?phone=` in the app and
 * `https://web.whatsapp.com/send?phone=` on the web for a person (the
 * number with no `+`); a group has no link of its own on either, so
 * the app or the web client opens at the top.
 */
export function chatLink(phone: string | undefined, where: Opener, text?: string): string {
  const q = new URLSearchParams();
  if (phone) q.set("phone", phone.replace(/\D/g, ""));
  if (text) q.set("text", text);
  const s = q.toString();
  if (where === "app") return s ? `whatsapp://send?${s}` : "whatsapp://";
  return s ? `https://web.whatsapp.com/send?${s}` : "https://web.whatsapp.com/";
}

/** A contact as a vCard 3.0 the Contacts app and a phone both import. */
export const vcard = (name: string, phone: string): string => `BEGIN:VCARD\nVERSION:3.0\nFN:${name.replace(/[\n\r]/g, " ")}\nTEL;TYPE=CELL:+${phone.replace(/\D/g, "")}\nEND:VCARD`;

/** `905551234567` as `+90 555 123 45 67`: the country code, then the last ten digits in three, three, two, two. */
export function prettyPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length < 8) return `+${d}`;
  const local = d.slice(-10), cc = d.slice(0, -10);
  return `+${cc ? `${cc} ` : ""}${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6, 8)} ${local.slice(8)}`.trim();
}

// ---- chats --------------------------------------------------------------------------------------

let chatList: { at: number; chats: Chat[] } | undefined;
let loading: Promise<Chat[]> | undefined;
const byId = new Map<string, Chat>();
/** The unread run per chat, keyed by the chat's newest timestamp so a refresh where nothing moved fetches nothing. */
const runs = new Map<string, { at: number; msgs: Msg[] }>();

/** The chats, unread first then newest first, one list shared for `CHATS_FRESH_MS` (or `refresh`); one fetch at a time. */
export function loadChats(refresh = false): Promise<Chat[]> {
  if (!refresh && chatList && Date.now() - chatList.at < CHATS_FRESH_MS) return Promise.resolve(chatList.chats);
  loading ??= fetchChats().then((c) => { chatList = { at: Date.now(), chats: c }; return c; }).finally(() => { loading = undefined; });
  return loading;
}
export const dropChats = () => { chatList = undefined; };

async function fetchChats(): Promise<Chat[]> {
  const raw = (await apiChats()).filter((c) => c.kind === "individual" || c.kind === "group" || (c.kind === "unknown" && !c.id.endsWith("@broadcast")));
  const list = raw.map(chatOf).sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || b.at - a.at);
  byId.clear();
  for (const c of list) byId.set(c.id, c);
  // The unread chats' newest messages, live, so the row and the popover say who said what; memoised on the chat's timestamp.
  await Promise.all(list.filter((c) => c.unread > 0).slice(0, MAX_RUNS).map(async (c) => {
    try {
      const run = await unreadRun(c);
      const top = run[run.length - 1];
      if (top) { c.last = top.who === "You" || !c.group ? top.text : `${top.who}: ${top.text}`; c.who = top.who; }
      const incoming = [...run].reverse().find((m) => !m.fromMe);
      c.latestId = incoming?.id ?? top?.id;
      c.latestFromMe = !incoming;
    } catch (e) { log(`history ${c.id}: ${e instanceof Error ? e.message : e}`); }
  }));
  await loadPictures();
  applyPictures(list);
  schedulePictures(list);
  return list;
}

const chatOf = (c: ChatSummary): Chat => ({
  id: c.id,
  name: c.name?.trim() || phoneOfId(c.id) || c.id.split("@")[0],
  group: c.isGroup || c.kind === "group",
  unread: c.unreadCount ?? 0,
  at: s2ms(c.timestamp ?? 0),
  ...(c.lastMessage?.trim() && { last: c.lastMessage.trim() }),
});

/** The newest `RUN_MSGS` of an unread chat, oldest first, from the memo when the chat has not moved. */
async function unreadRun(c: Chat): Promise<Msg[]> {
  const have = runs.get(c.id);
  if (have && have.at === c.at) return have.msgs;
  const msgs = await conversation(c, Math.min(Math.max(c.unread, 1), RUN_MSGS));
  runs.set(c.id, { at: c.at, msgs });
  return msgs;
}

/**
 * The last `n` messages of a chat as a conversation, oldest first: the
 * live history (what the phone shows) with the archive's rows laid over
 * it by id for the sender's saved name and the quoted reply; the archive
 * alone when the live history answers nothing (a LID-era chat the
 * gateway never saw).
 */
export async function conversation(c: Chat, n = PANE_MSGS): Promise<Msg[]> {
  const [live, db] = await Promise.all([history(c.id, n).catch((e) => { log(`history ${c.id}: ${e instanceof Error ? e.message : e}`); return [] as LiveMessage[]; }), archived(c.id, Math.max(n, 40)).catch(() => [] as DbMessage[])]);
  // The senders to name: a group's authors, a direct chat's other side; never our own number (an outgoing message's `from`).
  await warmNames([...live.filter((m) => !m.fromMe).map((m) => m.author || m.from), ...db.filter((d) => d.direction !== "outgoing").map((d) => d.author || d.from)].filter((j): j is string => !!j && !isGroupId(j)), c.id);
  const resolve = (jid: string) => nameOf(jid, c);
  if (!live.length) return db.slice(0, n).reverse().map((d) => msgOfDb(d, resolve, c.name, c.group));
  const rows = new Map(db.map((d) => [d.waMessageId || d.id, d]));
  return live.slice(-n).map((m) => msgOf(m, rows.get(m.id), resolve, c.name));
}

/** A chat by id, from the list at hand or a fresh one; a chat the list lacks (a link naming a phone) is built from the id alone. */
export async function chat(id: string): Promise<Chat> {
  const have = byId.get(id);
  if (have) return have;
  await loadChats();
  return byId.get(id) ?? { id, name: phoneOfId(id) ?? id.split("@")[0], group: isGroupId(id), unread: 0, at: 0 };
}

/** The chats with something unread, the list's order. */
export const unreadChats = async (refresh = false): Promise<Chat[]> => (await loadChats(refresh)).filter((c) => c.unread > 0);

// ---- names and phones ------------------------------------------------------------------------------

/** Saved names by jid: the chat list's, then `GET /contacts/<id>` once per id. */
const names = new Map<string, string>();
const nameLookups = new Map<string, Promise<void>>();

/** A sender's name from what is known now: a chat of that id, a contact looked up before, else its number. */
export function nameOf(jid: string, chatCtx?: Chat): string {
  if (chatCtx && jid === chatCtx.id) return chatCtx.name;
  const c = byId.get(jid);
  if (c) return c.name;
  const n = names.get(jid);
  if (n) return n;
  const p = phoneOfId(jid);
  return p ? prettyPhone(p) : jid.split("@")[0];
}

/** One `GET /contacts/<id>` per unknown sender, in parallel, remembered for the process (a miss too, as the number). */
async function warmNames(jids: string[], skip?: string): Promise<void> {
  const want = [...new Set(jids)].filter((j) => j !== skip && !byId.has(j) && !names.has(j));
  await Promise.all(want.map((j) => {
    let p = nameLookups.get(j);
    if (!p) {
      p = contact(j).then((c) => { names.set(j, contactName(c) || (c.number ? prettyPhone(c.number) : "") || nameOf(j)); }, () => { names.set(j, nameOf(j)); });
      nameLookups.set(j, p);
    }
    return p;
  }));
}

/** A contact's name as the owner saved it, else what the person calls themselves. */
export const contactName = (c: Contact): string => c.name?.trim() || c.pushName?.trim() || "";

const phones = new Map<string, string>();

/** The phone behind a chat: the digits of a `@c.us` id, else `GET /contacts/<lid>/phone` once; undefined for a group. */
export async function phoneOf(id: string): Promise<string | undefined> {
  if (isGroupId(id)) return undefined;
  const direct = phoneOfId(id);
  if (direct) return direct;
  const have = phones.get(id);
  if (have) return have;
  const p = (await resolvePhone(id)).replace(/\D/g, "");
  if (p) phones.set(id, p);
  return p || undefined;
}

// ---- pictures -----------------------------------------------------------------------------------------

type PictureEntry = { u: string | null; t: number };
let pictureMap: Record<string, PictureEntry> | undefined;
let picturePass: Promise<void> | undefined;

/** The unix ms a pps.whatsapp.net url stops working (`oe`, hex seconds), undefined when the url carries none. */
export function pictureExpiry(url: string): number | undefined {
  const oe = /[?&]oe=([0-9a-f]+)/i.exec(url)?.[1];
  return oe ? parseInt(oe, 16) * 1000 : undefined;
}

/** Whether an entry still stands: a url until a day before its expiry (or `PICTURE_TTL_MS` without one), a miss for `PICTURE_TTL_MS`. */
export function pictureFresh(e: PictureEntry | undefined, now = Date.now()): boolean {
  if (!e) return false;
  if (e.u === null) return now - e.t < PICTURE_TTL_MS;
  const exp = pictureExpiry(e.u);
  return exp ? now < exp - PICTURE_MARGIN_MS : now - e.t < PICTURE_TTL_MS;
}

async function loadPictures(): Promise<void> {
  pictureMap ??= (await storage.get<Record<string, PictureEntry>>("pictures", "whatsapp").catch(() => null)) ?? {};
}

/** Each chat's `avatar` from the map at hand. */
function applyPictures(list: Chat[]): void {
  for (const c of list) { const e = pictureMap?.[c.id]; if (e?.u && pictureFresh(e)) c.avatar = e.u; }
}

/** One pass of `PICTURE_PASS` ids among the top `PICTURE_WARM` chats not known yet, then the next while any is wanted; one chain at a time. */
function schedulePictures(list: Chat[]): void {
  if (picturePass || !pictureMap) return;
  const now = Date.now();
  const want = list.slice(0, PICTURE_WARM).filter((c) => !pictureFresh(pictureMap![c.id], now)).slice(0, PICTURE_PASS);
  if (!want.length) return;
  picturePass = apiPictures(want.map((c) => c.id)).then(async (got) => {
    for (const c of want) { const u = got[c.id] ?? null; pictureMap![c.id] = { u, t: now }; if (u) c.avatar = u; }
    const keep = Object.entries(pictureMap!).sort((a, b) => b[1].t - a[1].t).slice(0, PICTURE_KEEP);
    pictureMap = Object.fromEntries(keep);
    await storage.set("pictures", pictureMap, "whatsapp").catch((e) => log(`pictures: ${e instanceof Error ? e.message : e}`));
  }).catch((e) => log(`pictures: ${e instanceof Error ? e.message : e}`)).finally(() => {
    picturePass = undefined;
    if (chatList) schedulePictures(chatList.chats);
  });
}

const avatars = new Map<string, { at: number; data?: string; pending?: Promise<string | undefined> }>();

/** A picture as a data url for the popover's `image` nodes (which take no http url); fetched once per url, a miss remembered `AVATAR_MISS_TTL`. */
export function avatarData(url: string): Promise<string | undefined> {
  const have = avatars.get(url);
  if (have?.data) return Promise.resolve(have.data);
  if (have?.pending) return have.pending;
  if (have && Date.now() - have.at < AVATAR_MISS_TTL) return Promise.resolve(undefined);
  const pending = fetch(url, { signal: AbortSignal.timeout(AVATAR_MS) }).then(async (r) => {
    const type = r.headers.get("content-type")?.split(";")[0] ?? "";
    if (!r.ok || !type.startsWith("image/")) return undefined;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length && buf.length <= MAX_AVATAR ? `data:${type};base64,${buf.toString("base64")}` : undefined;
  }).catch(() => undefined).then((data) => { avatars.set(url, { at: Date.now(), data }); return data; });
  avatars.set(url, { at: Date.now(), pending });
  return pending;
}

// ---- contacts ------------------------------------------------------------------------------------------

let people: { at: number; list: Person[] } | undefined;
let peopleLoading: Promise<Person[]> | undefined;

/**
 * The owner's contacts (`isMyContact`, the ones with a saved name): the
 * store paged `PAGE` at a time, the first page then the rest in
 * parallel; one entry per number (the store lists a person twice when a
 * LID row also carries the name); an hour in memory.
 */
export function contacts(refresh = false): Promise<Person[]> {
  if (!refresh && people && Date.now() - people.at < CONTACTS_TTL_MS) return Promise.resolve(people.list);
  peopleLoading ??= fetchContacts().then((list) => { people = { at: Date.now(), list }; return list; }).finally(() => { peopleLoading = undefined; });
  return peopleLoading;
}

async function fetchContacts(): Promise<Person[]> {
  const pages: Contact[][] = [await contactsPage(0)];
  if (pages[0].length >= PAGE) {
    // The store is ~5.4k on the owner's: five pages at once, then one at a time past that.
    pages.push(...(await Promise.all([1, 2, 3, 4, 5].map((i) => contactsPage(i * PAGE)))));
    for (let i = 6; pages[pages.length - 1].length >= PAGE; i++) pages.push(await contactsPage(i * PAGE));
  }
  const seen = new Map<string, Person>();
  for (const c of pages.flat()) {
    const name = contactName(c);
    if (!c.isMyContact || !name) continue;
    const phone = (phoneOfId(c.id) ?? c.number ?? "").replace(/\D/g, "");
    if (!phone || isLid(c.id)) continue;
    if (!seen.has(phone)) seen.set(phone, { id: c.id, name, phone });
    names.set(c.id, name);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---- search ---------------------------------------------------------------------------------------------

export type Hit = { id: string; chatId: string; chat: string; who: string; text: string; at: number; fromMe: boolean; type: string };

const STRIP_MARK = /<\/?mark>/g;

/** The archive's hits for `q`, newest of equal rank first: the chat's name from the list, the sender's from what is known. */
export async function search(q: string): Promise<Hit[]> {
  const [r] = await Promise.all([apiSearch(q, SEARCH_LIMIT), loadChats().catch(() => [])]);
  const hits = r.hits ?? [];
  await Promise.all(hits.map((h) => (byId.has(h.chatId) ? undefined : warmChatName(h.chatId))));
  return hits.map(hitOf);
}

/** A hit's chat when the list has no such id (a LID-era `<lid>@c.us` the search still labels chats with): its contact record, once. */
const warmChatName = (chatId: string) => (isGroupId(chatId) ? Promise.resolve() : warmNames([chatId]));

export function hitOf(h: SearchHit): Hit {
  const chat = byId.get(h.chatId);
  const group = chat?.group ?? isGroupId(h.chatId);
  const fromMe = h.direction === "outgoing";
  const sender = group ? h.from : h.chatId;
  return {
    id: h.waMessageId || h.messageId,
    chatId: h.chatId,
    chat: chat?.name ?? nameOf(h.chatId),
    who: fromMe ? "You" : nameOf(sender),
    text: (h.snippet || h.body || "").replace(STRIP_MARK, "").replace(/\s+/g, " ").trim() || mediaLabel(h.type, "") || "(no text)",
    at: s2ms(h.timestamp),
    fromMe,
    type: h.type,
  };
}

/** Forget everything memoised (settings changed, tests). */
export const resetData = () => { chatList = undefined; byId.clear(); runs.clear(); names.clear(); nameLookups.clear(); phones.clear(); pictureMap = undefined; avatars.clear(); people = undefined; };
