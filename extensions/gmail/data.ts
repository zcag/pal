// The account's mail as the palettes read it: one `Mail` per message off
// its metadata (cached by id for the process; a message's headers never
// change, its labels are patched here on every write), the inbox as
// unread then recent plus the `labels` setting's unread, the label table
// (an hour in memory, persisted in storage so a restart lists without a
// call), the address (the setting, else the profile once), a search, the
// opened message whole, the drafts, and the writes.
import { errorMessage, oneLine, storage } from "@zcag/pal";
import * as api from "./api.ts";
import { avatar } from "./avatar.ts";
import { bodyOf, header, looksAttached, parseAddress, parseAddresses, type Address, type Attachment, type Message } from "./mail.ts";

export type Mail = {
  id: string;
  threadId: string;
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo: Address;
  /** Unix ms, Gmail's `internalDate`. */
  date: number;
  dateHeader: string;
  snippet: string;
  labelIds: string[];
  unread: boolean;
  starred: boolean;
  inInbox: boolean;
  /** From `format=metadata` a guess by MIME type; the pane confirms. */
  attached: boolean;
  messageId: string;
  references: string;
  /** The sender's mark, filled once by `withAvatars`. */
  icon?: { image: string };
};

export type Opened = { mail: Mail; text: string; html: string; attachments: Attachment[] };
export type Inbox = { at: number; unread: Mail[]; recent: Mail[]; extra: { label: string; mails: Mail[] }[]; count: number };

const LABELS_TTL_MS = 3_600_000;
/** Opened messages kept whole. */
const OPENED_MAX = 20;

const mails = new Map<string, Mail>();
const opened = new Map<string, Opened>();

export function toMail(m: Message): Mail {
  const p = m.payload;
  const labelIds = m.labelIds ?? [];
  return {
    id: m.id,
    threadId: m.threadId,
    subject: (header(p, "Subject") ?? "").trim(),
    from: parseAddress(header(p, "From")),
    to: parseAddresses(header(p, "To")),
    cc: parseAddresses(header(p, "Cc")),
    replyTo: parseAddress(header(p, "Reply-To") ?? header(p, "From")),
    date: Number(m.internalDate) || Date.parse(header(p, "Date") ?? "") || 0,
    dateHeader: header(p, "Date") ?? "",
    snippet: decodeSnippet(m.snippet ?? ""),
    labelIds,
    unread: labelIds.includes("UNREAD"),
    starred: labelIds.includes("STARRED"),
    inInbox: labelIds.includes("INBOX"),
    attached: looksAttached(p),
    messageId: header(p, "Message-ID") ?? "",
    references: header(p, "References") ?? "",
  };
}

/** Gmail's snippet is HTML-escaped text; a newsletter's preheader pads it with invisible characters (`oneLine` drops them). */
const decodeSnippet = (s: string) => oneLine(s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e]!));

/** The `Mail` for each ref, the cache first, `messages.get` (metadata) for the rest, eight at a time. */
export async function fetchMails(refs: api.Ref[]): Promise<Mail[]> {
  const missing = refs.filter((r) => !mails.has(r.id));
  const got = await api.pool(missing, (r) => api.metadata(r.id));
  for (const m of got) mails.set(m.id, toMail(m));
  return refs.flatMap((r) => mails.get(r.id) ?? []);
}

/** Each mail's sender mark, probed once per address, in parallel. */
export async function withAvatars(list: Mail[]): Promise<Mail[]> {
  await Promise.all(list.filter((m) => !m.icon).map(async (m) => { m.icon = await avatar(m.from.email, m.from.name || m.from.email); }));
  return list;
}

export const mailOf = (id: string): Mail | undefined => mails.get(id);

/** One message by id, fetched (metadata) when it is not cached. */
export async function mail(id: string): Promise<Mail> {
  const have = mails.get(id);
  if (have) return have;
  const m = toMail(await api.metadata(id));
  mails.set(id, m);
  return m;
}

// ---- labels ----------------------------------------------------------------------------

let labelCache: { at: number; labels: api.Label[] } | undefined;
let labelLoad: Promise<api.Label[]> | undefined;

/** Every label: the memory table while young, storage's copy first (any age) unless `fresh`, then `labels.list`. */
export async function labels(fresh = false): Promise<api.Label[]> {
  if (!fresh && labelCache && Date.now() - labelCache.at < LABELS_TTL_MS) return labelCache.labels;
  if (!fresh && !labelCache) {
    const stored = await storage.get<{ at: number; labels: api.Label[] }>("labels").catch(() => null);
    if (stored?.labels?.length) { labelCache = stored; if (Date.now() - stored.at < LABELS_TTL_MS) return stored.labels; }
  }
  labelLoad ??= api.labelList().then(async (ls) => {
    labelCache = { at: Date.now(), labels: ls };
    await storage.set("labels", labelCache).catch(() => {});
    return ls;
  }).finally(() => { labelLoad = undefined; });
  try { return await labelLoad; } catch (e) { if (labelCache) return labelCache.labels; throw e; }
}

/** Label id to name, from the last table read (empty before the first). */
export const labelNames = (): Map<string, string> => new Map((labelCache?.labels ?? []).map((l) => [l.id, l.name]));

/** The label ids for the `labels` setting's names (case-insensitive; an unknown name is skipped and logged). */
export async function labelIdsFor(names: string[]): Promise<{ id: string; name: string }[]> {
  if (!names.length) return [];
  const all = await labels();
  const out: { id: string; name: string }[] = [];
  for (const n of names) {
    const l = all.find((l) => l.name.toLowerCase() === n.trim().toLowerCase() || l.id === n.trim());
    if (l) out.push({ id: l.id, name: l.name });
    else api.log(`no label "${n}" on this account`);
  }
  return out;
}

// ---- the address ------------------------------------------------------------------------

let profileAddress: string | undefined;

/** The account's address: the setting, else the profile (once; empty while unknown). */
export async function address(): Promise<string> {
  const set = (api.conf().address ?? "").trim();
  if (set) return set;
  if (profileAddress === undefined) {
    try { profileAddress = (await api.profile()).emailAddress ?? ""; } catch (e) { api.log(`profile: ${errorMessage(e)}`); return ""; }
  }
  return profileAddress;
}

/** The address without waiting: the setting, or what the profile said. */
export const addressNow = (): string => (api.conf().address ?? "").trim() || profileAddress || "";

// ---- the inbox ---------------------------------------------------------------------------

/** Unread first (up to 50; the count from the label when the page is full), then the newest 50 minus those, then the `labels` setting's unread. */
export async function inbox(): Promise<Inbox> {
  // The label table first: the rows' chips and the `labels` setting need the names.
  await labels().catch((e) => api.log(`labels: ${errorMessage(e)}`));
  const extraLabels = await labelIdsFor(api.conf().labels ?? []);
  const [unreadRefs, recentRefs, ...extraRefs] = await Promise.all([
    api.list({ labelIds: ["INBOX", "UNREAD"] }),
    api.list({ labelIds: ["INBOX"] }),
    ...extraLabels.map((l) => api.list({ labelIds: [l.id, "UNREAD"] })),
  ]);
  const count = unreadRefs.length < api.MAX_RESULTS ? unreadRefs.length : (await api.labelGet("INBOX")).messagesUnread ?? unreadRefs.length;
  const seen = new Set(unreadRefs.map((r) => r.id));
  const all = await fetchMails([...unreadRefs, ...recentRefs.filter((r) => !seen.has(r.id)), ...extraRefs.flat().filter((r) => !seen.has(r.id))]);
  // The lists said which are unread now; a cached row is patched to agree (past a full page the cache's word stands).
  const unreadIds = new Set([...unreadRefs, ...extraRefs.flat()].map((r) => r.id));
  for (const m of all) {
    m.unread = unreadIds.has(m.id) || (unreadRefs.length >= api.MAX_RESULTS && m.unread);
    m.labelIds = m.unread ? (m.labelIds.includes("UNREAD") ? m.labelIds : [...m.labelIds, "UNREAD"]) : m.labelIds.filter((l) => l !== "UNREAD");
  }
  const have = (refs: { id: string }[]) => refs.flatMap((r) => mails.get(r.id) ?? []);
  const unread = have(unreadRefs);
  const recent = have(recentRefs.filter((r) => !seen.has(r.id)));
  const extra = extraLabels.map((l, i) => ({ label: l.name, mails: have(extraRefs[i].filter((r) => !seen.has(r.id))) }));
  await withAvatars([...unread, ...recent, ...extra.flatMap((e) => e.mails)]);
  return { at: Date.now(), unread, recent, extra, count };
}

// ---- search -------------------------------------------------------------------------------

export async function search(q: string): Promise<Mail[]> {
  const [refs] = await Promise.all([api.list({ q }), labels().catch(() => [])]);
  return withAvatars(await fetchMails(refs));
}

// ---- the opened message -------------------------------------------------------------------

/** The message whole: the text, the HTML and the attachments, kept for the last twenty opened. */
export async function open(id: string): Promise<Opened> {
  const have = opened.get(id);
  if (have) return have;
  const m = await api.full(id);
  const mail = toMail(m);
  const prev = mails.get(id);
  if (prev) { mail.icon = prev.icon; }
  mails.set(id, mail);
  const o: Opened = { mail, ...bodyOf(m.payload) };
  mail.attached = o.attachments.length > 0;
  opened.set(id, o);
  if (opened.size > OPENED_MAX) opened.delete(opened.keys().next().value!);
  return o;
}

// ---- writes ---------------------------------------------------------------------------------

function patch(ids: string[], add: string[], remove: string[]) {
  for (const id of ids) {
    const m = mails.get(id);
    if (!m) continue;
    m.labelIds = [...m.labelIds.filter((l) => !remove.includes(l)), ...add.filter((l) => !m.labelIds.includes(l))];
    m.unread = m.labelIds.includes("UNREAD");
    m.starred = m.labelIds.includes("STARRED");
    m.inInbox = m.labelIds.includes("INBOX");
  }
}

async function change(ids: string[], add: string[], remove: string[]) {
  await api.modify(ids, add, remove);
  patch(ids, add, remove);
}

export const markRead = (ids: string[]) => change(ids, [], ["UNREAD"]);
export const markUnread = (ids: string[]) => change(ids, ["UNREAD"], []);
export const archive = (ids: string[]) => change(ids, [], ["INBOX"]);
export const star = (ids: string[], on: boolean) => change(ids, on ? ["STARRED"] : [], on ? [] : ["STARRED"]);

// ---- drafts -----------------------------------------------------------------------------------

export type DraftRow = { draftId: string; mail: Mail };

export async function drafts(): Promise<DraftRow[]> {
  const refs = await api.draftList();
  const got = await api.pool(refs, (r) => api.draftGet(r.id));
  return got.map((d) => ({ draftId: d.id, mail: toMail(d.message) }));
}

/** Forget everything read (settings changed: it may be another account). */
export function reset() {
  mails.clear();
  opened.clear();
  labelCache = undefined;
  profileAddress = undefined;
  api.reset();
}
