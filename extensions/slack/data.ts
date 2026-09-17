// What the palettes and the bar item list, in the extension's own shapes,
// and how each is fetched.
//
// The inbox is built on ADDRESSED versus merely unread: a busy workspace is
// never at zero unread channels, so a count of those would light the bar
// permanently and say nothing. A direct message, an @-mention or a reply in
// a followed thread is someone asking for something and is counted; a
// channel that is only unread is named under "Channels" and not counted.
// One `client.counts` gives every conversation's `last_read`, `latest`,
// `mention_count` and `has_unreads` and the thread counts by channel; a
// `conversations.history` is spent only on an addressed conversation, and
// only once per change of its `latest` (memoised), so a refresh where
// nothing moved is that one call. Names and avatars come from a directory
// (`users.list`, `users.conversations`) kept an hour, with `users.info` /
// `conversations.info` for an id it lacks.
//
// A user token (`auth: token`) has no `client.counts`: the fallback asks
// `conversations.info` per conversation of the directory for
// `unread_count_display` and `last_read`, which gives direct messages and
// unread channels but neither mentions nor threads (a channel mention is
// found in its unread run when the run is fetched).
import { errorMessage } from "@zcag/pal";
import { ApiError, call, log, paged, primary, sessions, type Session } from "./api.ts";
import { fromCodePoints } from "./emoji.ts";

export const DIRECTORY_TTL = 3600_000;
/** Addressed conversations that get a history call per refresh, newest first; the rest keep their count and name. */
export const MAX_DETAIL = 12;
/** Messages looked at per conversation, and how many of the unread run a row carries. */
export const MAX_SCAN = 60, MAX_MSGS = 8;
export const PREVIEW = 160;
/** Quiet channels named in the bar's popover. */
export const MAX_QUIET = 8;
const DIRECTORY_PAGES = 5;
/** `conversations.info` calls in flight at once while counting members. */
const MEMBERS_BATCH = 8;

export type Kind = "dm" | "mention" | "thread" | "channel";
export type Msg = { who: string; avatar: string; text: string; ts: string; thread_ts?: string };
export type Unread = {
  kind: Kind;
  /** `<team>/<conversation>`: the row id. */
  id: string;
  team: string;
  teamName: string;
  domain: string;
  cid: string;
  /** The conversation's name: the person, `#channel`, the people of a group message. */
  where: string;
  /** What the conversation is, from the directory. */
  ckind: Conversation["kind"];
  /** How many: mentions in a channel, unread messages in a DM, replies in threads. */
  n: number;
  /** `client.counts`' `latest` and `last_read`, for Mark as read and the memo. */
  latest: string;
  lastRead: string;
  /** The message the row shows (the one naming you, in a channel; the newest, in a DM) and the unread run, oldest first. */
  top?: Msg;
  msgs: Msg[];
  more: boolean;
};
export type Inbox = { at: number; dm: number; mention: number; thread: number; channels: number; items: Unread[]; quiet: Unread[] };

export type Conversation = { id: string; team: string; teamName: string; domain: string; name: string; kind: "channel" | "private" | "im" | "mpim"; topic: string; purpose: string; members: number; user?: string };
export type SearchHit = { id: string; team: string; domain: string; cid: string; where: string; who: string; avatar: string; text: string; ts: string; permalink: string };
export type Status = { emoji: string; text: string; expiration: number; /** The emoji as a character, when Slack sent its code point. */ char?: string };
export type Dnd = { snoozing: boolean; until: number };
export type Presence = "active" | "away";

// ---- directory ---------------------------------------------------------------
// Ids are what the API speaks, names what the user reads. One list of users and
// one of the conversations the user is in, per workspace, kept an hour; a miss
// asks for that one id and remembers it for the hour too.

type User = { name: string; avatar: string; deleted: boolean; bot: boolean };
type Dir = { at: number; users: Map<string, User>; convs: Map<string, Conversation>; listed: boolean; counted: boolean };
const dirs = new Map<string, Dir>();
const inflight = new Map<string, Promise<unknown>>();

const once = <T>(key: string, f: () => Promise<T>): Promise<T> => {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = f().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
};

const dirOf = (s: Session): Dir => {
  let d = dirs.get(s.id);
  if (!d || Date.now() - d.at > DIRECTORY_TTL) { d = { at: Date.now(), users: new Map(), convs: new Map(), listed: false, counted: false }; dirs.set(s.id, d); }
  return d;
};

type RawUser = { id: string; name?: string; real_name?: string; deleted?: boolean; is_bot?: boolean; profile?: { display_name?: string; real_name?: string; image_48?: string } };
const toUser = (u: RawUser): User => ({ name: u.profile?.display_name || u.profile?.real_name || u.real_name || u.name || u.id, avatar: u.profile?.image_48 ?? "", deleted: !!u.deleted, bot: !!u.is_bot });

/** The whole user list once an hour (a few pages at most), then per-id lookups for what it lacks. */
async function users(s: Session): Promise<Map<string, User>> {
  const d = dirOf(s);
  if (!d.listed) {
    await once(`users:${s.id}`, async () => {
      if (d.listed) return;
      try {
        for (const u of await paged<RawUser>(s, "users.list", {}, "members", DIRECTORY_PAGES)) d.users.set(u.id, toUser(u));
      } catch (e) { log(`users.list: ${errorMessage(e)}`); }
      d.listed = true;
    });
  }
  return d.users;
}

export async function user(s: Session, id: string): Promise<User> {
  const map = await users(s);
  const have = map.get(id);
  if (have) return have;
  const u = await once(`user:${s.id}:${id}`, async () => {
    try { return toUser((await call<{ user: RawUser }>(s, "users.info", { user: id })).user); } catch (e) { log(`users.info ${id}: ${errorMessage(e)}`); return { name: id, avatar: "", deleted: false, bot: false }; }
  });
  map.set(id, u);
  return u;
}

type RawConv = { id: string; name?: string; is_im?: boolean; is_mpim?: boolean; is_private?: boolean; is_channel?: boolean; is_archived?: boolean; user?: string; topic?: { value?: string }; purpose?: { value?: string }; num_members?: number };

/** A group message is stored as `mpdm-a--b--c-1`: the people, joined. */
const mpimName = (name: string) => name.replace(/^mpdm-/, "").replace(/-\d+$/, "").split("--").join(", ");

async function toConv(s: Session, c: RawConv): Promise<Conversation> {
  const kind = c.is_im ? "im" : c.is_mpim ? "mpim" : c.is_private ? "private" : "channel";
  const name = kind === "im" ? (await user(s, c.user ?? "")).name : kind === "mpim" ? mpimName(c.name ?? c.id) : `#${c.name ?? c.id}`;
  return { id: c.id, team: s.id, teamName: s.name, domain: s.domain, name, kind, topic: c.topic?.value ?? "", purpose: c.purpose?.value ?? "", members: c.num_members ?? (kind === "im" ? 2 : 0), user: c.user };
}

/**
 * Every conversation the user is in, once an hour: the catalog and the
 * names behind the inbox. `users.conversations` carries no member counts;
 * with `members` the channels get one `conversations.info` each (in
 * batches, once per directory), which only the catalog asks for.
 */
export async function conversations(s: Session, refresh = false, members = false): Promise<Conversation[]> {
  const d = dirOf(s);
  if (refresh || !d.convs.size) {
    await once(`convs:${s.id}`, async () => {
      const raw = await paged<RawConv>(s, "users.conversations", { types: "public_channel,private_channel,mpim,im", exclude_archived: true }, "channels", DIRECTORY_PAGES);
      // The user list first, so the direct messages resolve without one call each.
      if (raw.some((c) => c.is_im)) await users(s);
      const convs = await Promise.all(raw.filter((c) => !c.is_archived).map((c) => toConv(s, c)));
      d.convs = new Map(convs.map((c) => [c.id, c]));
      d.counted = false;
    });
  }
  if (members && !d.counted) {
    await once(`members:${s.id}`, async () => {
      const want = [...d.convs.values()].filter((c) => (c.kind === "channel" || c.kind === "private") && !c.members);
      for (let i = 0; i < want.length; i += MEMBERS_BATCH) {
        await Promise.all(want.slice(i, i + MEMBERS_BATCH).map(async (c) => {
          try { c.members = (await call<{ channel: RawConv }>(s, "conversations.info", { channel: c.id })).channel.num_members ?? 0; } catch (e) { log(`conversations.info ${c.id}: ${errorMessage(e)}`); }
        }));
      }
      d.counted = true;
    });
  }
  return [...d.convs.values()];
}

/** One conversation by id: the directory, else `conversations.info`, remembered. */
export async function conversation(s: Session, cid: string): Promise<Conversation> {
  const d = dirOf(s);
  if (!d.convs.size) await conversations(s).catch((e) => log(`users.conversations: ${errorMessage(e)}`));
  const have = d.convs.get(cid);
  if (have) return have;
  const c = await once(`conv:${s.id}:${cid}`, async () => {
    try { return await toConv(s, (await call<{ channel: RawConv }>(s, "conversations.info", { channel: cid })).channel); } catch (e) {
      log(`conversations.info ${cid}: ${errorMessage(e)}`);
      return { id: cid, team: s.id, teamName: s.name, domain: s.domain, name: cid, kind: "channel" as const, topic: "", purpose: "", members: 0 };
    }
  });
  d.convs.set(cid, c);
  return c;
}

// ---- text ------------------------------------------------------------------

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">" };

/**
 * Slack's wire text as the client draws it: `<@U..>` is a name, `<#C..|name>`
 * a channel, `<!here>` a broadcast, `<url|label>` its label, and the whole
 * is entity-escaped. A preview showing `<@U0BTS72L1C2>` would be worse than none.
 */
export async function render(s: Session, text: string | undefined): Promise<string> {
  let out = "";
  let last = 0;
  for (const m of (text ?? "").matchAll(/<([^>]*)>/g)) {
    out += (text ?? "").slice(last, m.index);
    last = m.index! + m[0].length;
    const body = m[1];
    if (body.startsWith("@U") || body.startsWith("@W")) out += "@" + (await user(s, body.slice(1).split("|")[0])).name;
    else if (body.startsWith("#C")) { const [id, label] = body.slice(1).split("|"); out += label ? `#${label}` : (await conversation(s, id)).name; }
    else if (body.startsWith("!")) { const [ref, label] = body.slice(1).split("|"); out += label ? (label.startsWith("@") ? label : `@${label}`) : `@${ref.split("^")[0]}`; }
    else out += body.split("|").at(-1);
  }
  out += (text ?? "").slice(last);
  for (const [k, v] of Object.entries(ENTITIES)) out = out.replaceAll(k, v);
  return out.replace(/\s+/g, " ").trim();
}

export type RawMsg = { ts: string; text?: string; user?: string; username?: string; bot_id?: string; subtype?: string; thread_ts?: string; files?: { title?: string; name?: string }[]; attachments?: { fallback?: string; text?: string }[]; bot_profile?: { name?: string; icons?: { image_48?: string } }; reply_count?: number };

/** The one line a message gets: its text, else what the file or attachment is, else what happened. */
export async function describe(s: Session, m: RawMsg): Promise<string> {
  let body = await render(s, m.text);
  if (!body) {
    if (m.files?.length) body = `📎 ${m.files[0].title || m.files[0].name || "file"}`;
    else if (m.attachments?.length) body = await render(s, m.attachments[0].fallback || m.attachments[0].text || "");
    else if (m.subtype === "huddle_thread") body = "started a huddle";
  }
  return body.slice(0, PREVIEW);
}

export async function toMsg(s: Session, m: RawMsg): Promise<Msg> {
  const u = m.user ? await user(s, m.user) : undefined;
  return { who: u?.name ?? m.username ?? m.bot_profile?.name ?? (m.bot_id ? "app" : ""), avatar: u?.avatar ?? m.bot_profile?.icons?.image_48 ?? "", text: await describe(s, m), ts: m.ts, thread_ts: m.thread_ts };
}

/** A join or a leave counts (Slack counts them) but is never the line worth previewing when a real message exists. */
const NOISE = new Set(["channel_join", "channel_leave", "group_join", "group_leave"]);

/** The unread run of one conversation, newest first as Slack returns it, `more` when it is longer than a page. */
export async function unreadSince(s: Session, cid: string, lastRead: string): Promise<{ msgs: RawMsg[]; more: boolean }> {
  const r = await call<{ messages: RawMsg[]; has_more?: boolean }>(s, "conversations.history", { channel: cid, oldest: lastRead, inclusive: false, limit: MAX_SCAN });
  const msgs = (r.messages ?? []).filter((m) => m.ts > lastRead);
  const real = msgs.filter((m) => !NOISE.has(m.subtype ?? ""));
  return { msgs: real.length ? real : msgs, more: !!r.has_more };
}

// ---- the inbox -------------------------------------------------------------------

type Counts = {
  channels?: { id: string; last_read?: string; latest?: string; mention_count?: number; has_unreads?: boolean }[];
  ims?: Counts["channels"];
  mpims?: Counts["channels"];
  threads?: { unread_count_by_channel?: Record<string, number> };
};

/** The run per conversation, remembered by (conversation, latest): a refresh where nothing moved re-fetches nothing. */
const runs = new Map<string, { latest: string; top?: Msg; msgs: Msg[]; more: boolean; n: number }>();

const mentionsMe = (s: Session, m: RawMsg) => new RegExp(`<@${s.user}[|>]|<!here|<!channel|<!everyone`).test(m.text ?? "");

/** The counts for one workspace: `client.counts` for the app's session; per-conversation `conversations.info` for a token (no mentions, no threads). */
async function counts(s: Session): Promise<Counts> {
  if (s.mode === "app") return call<Counts>(s, "client.counts", { thread_counts_by_channel: true, org_wide_aware: true, include_file_channels: true });
  const out: Required<Pick<Counts, "channels" | "ims" | "mpims">> = { channels: [], ims: [], mpims: [] };
  const convs = await conversations(s);
  const infos = await Promise.all(convs.map(async (c) => {
    try {
      const r = await call<{ channel: { id: string; last_read?: string; latest?: { ts?: string }; unread_count_display?: number } }>(s, "conversations.info", { channel: c.id });
      return { c, info: r.channel };
    } catch (e) { log(`conversations.info ${c.id}: ${errorMessage(e)}`); return undefined; }
  }));
  for (const x of infos) {
    if (!x) continue;
    const n = x.info.unread_count_display ?? 0;
    const row = { id: x.c.id, last_read: x.info.last_read, latest: x.info.latest?.ts, mention_count: 0, has_unreads: n > 0 };
    (x.c.kind === "im" ? out.ims : x.c.kind === "mpim" ? out.mpims : out.channels).push(row);
  }
  return out;
}

/** The whole inbox across the workspaces: the addressed rows with their runs (the newest `MAX_DETAIL` fetched), the quiet channels named, the counts. */
export async function inbox(): Promise<Inbox> {
  const ss = await sessions();
  const multi = ss.length > 1;
  const items: Unread[] = [], quiet: Unread[] = [];
  let dm = 0, mention = 0, thread = 0, channels = 0;
  for (const s of ss) {
    let c: Counts;
    try { c = await counts(s); } catch (e) { if (e instanceof ApiError && ss.length > 1) { log(`${s.domain}: ${e.message}`); continue; } throw e; }
    const base = (kind: Kind, conv: NonNullable<Counts["channels"]>[number], n: number): Unread => ({ kind, id: `${s.id}/${conv.id}`, team: s.id, teamName: multi ? s.name : "", domain: s.domain, cid: conv.id, where: conv.id, ckind: "channel", n, latest: conv.latest ?? "", lastRead: conv.last_read ?? "", msgs: [], more: false });
    const hot: Unread[] = [];
    for (const conv of [...(c.ims ?? []), ...(c.mpims ?? [])]) if (conv.has_unreads || conv.mention_count) hot.push(base("dm", conv, Math.max(conv.mention_count ?? 0, 1)));
    for (const conv of c.channels ?? []) {
      if (conv.mention_count) hot.push(base("mention", conv, conv.mention_count));
      else if (conv.has_unreads) { channels++; quiet.push(base("channel", conv, 1)); }
    }
    for (const [cid, n] of Object.entries(c.threads?.unread_count_by_channel ?? {})) hot.push(base("thread", { id: cid }, n));
    // The run for the newest addressed conversations; the older ones keep their count and name.
    hot.sort((a, b) => b.latest.localeCompare(a.latest));
    await Promise.all(hot.map(async (u, i) => {
      const c = await conversation(s, u.cid);
      u.where = c.name;
      u.ckind = c.kind;
      if (u.kind === "thread" || i >= MAX_DETAIL || !u.lastRead) return;
      const have = runs.get(u.id);
      if (have && have.latest === u.latest) { Object.assign(u, { top: have.top, msgs: have.msgs, more: have.more, n: have.n }); return; }
      try {
        const { msgs, more } = await unreadSince(s, u.cid, u.lastRead);
        // In a channel it is the message that names you that matters, not whatever was said last.
        const shown = u.kind === "mention" ? (msgs.filter((m) => mentionsMe(s, m)).length ? msgs.filter((m) => mentionsMe(s, m)) : msgs) : msgs;
        const run = await Promise.all(msgs.slice(0, MAX_MSGS).reverse().map((m) => toMsg(s, m)));
        u.top = shown[0] ? await toMsg(s, shown[0]) : undefined;
        u.msgs = run;
        u.more = more;
        if (u.kind === "dm") u.n = msgs.length + (more ? 1 : 0) || u.n;
        runs.set(u.id, { latest: u.latest, top: u.top, msgs: u.msgs, more: u.more, n: u.n });
      } catch (e) { log(`history ${u.cid}: ${errorMessage(e)}`); }
    }));
    await Promise.all(quiet.filter((q) => q.team === s.id).map(async (q) => { const c = await conversation(s, q.cid); q.where = c.name; q.ckind = c.kind; }));
    items.push(...hot);
  }
  // The counts after the runs, so a direct message counts its unread messages once they are known.
  for (const u of items) { if (u.kind === "dm") dm += u.n; else if (u.kind === "mention") mention += u.n; else if (u.kind === "thread") thread += u.n; }
  const order: Record<Kind, number> = { dm: 0, mention: 1, thread: 2, channel: 3 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || b.latest.localeCompare(a.latest));
  quiet.sort((a, b) => b.latest.localeCompare(a.latest));
  return { at: Date.now(), dm, mention, thread, channels, items, quiet };
}

/** Marks the conversation read up to `ts` (its `latest`), so the count falls at the next refresh. */
export const markRead = async (u: Unread) => call((await sessionOf(u.team)), "conversations.mark", { channel: u.cid, ts: u.latest });

export async function sessionOf(team: string): Promise<Session> {
  const s = (await sessions()).find((x) => x.id === team);
  if (!s) throw new Error(`not signed in to workspace ${team}`);
  return s;
}

/** A message into the conversation (in the thread when `threadTs` is given). */
export const post = async (team: string, cid: string, text: string, threadTs?: string) => call<{ ts: string }>(await sessionOf(team), "chat.postMessage", { channel: cid, text, thread_ts: threadTs, as_user: true });

// ---- links -----------------------------------------------------------------------

/** The desktop app's own scheme: the conversation, at a message when `ts` is known. */
export const deepLink = (team: string, cid: string, ts?: string) => `slack://channel?team=${team}&id=${cid}${ts ? `&message=${ts}` : ""}`;
/** The web client's archive url for the same place. */
export const webLink = (domain: string, cid: string, ts?: string) => `https://${domain}.slack.com/archives/${cid}${ts ? `/p${ts.replace(".", "")}` : ""}`;

// ---- search -------------------------------------------------------------------------

type RawHit = { ts: string; text?: string; user?: string; username?: string; channel?: { id: string; name?: string; is_im?: boolean; is_mpim?: boolean }; permalink?: string; team?: string };

/** `search.messages` with the query as typed (Slack's own syntax: `from:@x`, `in:#y`, `has:link`, `before:`), on the first workspace. */
export async function search(q: string, count = 20): Promise<SearchHit[]> {
  const s = await primary();
  const r = await call<{ messages?: { matches?: RawHit[] } }>(s, "search.messages", { query: q, count, sort: "timestamp", sort_dir: "desc" });
  return Promise.all((r.messages?.matches ?? []).map(async (m) => {
    const u = m.user ? await user(s, m.user) : undefined;
    const cid = m.channel?.id ?? "";
    const where = m.channel?.is_im ? (await conversation(s, cid)).name : m.channel?.is_mpim ? mpimName(m.channel.name ?? cid) : `#${m.channel?.name ?? cid}`;
    return { id: `${s.id}/${cid}/${m.ts}`, team: s.id, domain: s.domain, cid, where, who: u?.name ?? m.username ?? "", avatar: u?.avatar ?? "", text: await describe(s, m), ts: m.ts, permalink: m.permalink ?? webLink(s.domain, cid, m.ts) };
  }));
}

// ---- status, presence, do not disturb -------------------------------------------------

export async function status(): Promise<Status> {
  const s = await primary();
  const r = await call<{ profile: { status_emoji?: string; status_text?: string; status_expiration?: number; status_emoji_display_info?: { emoji_name?: string; unicode?: string }[] } }>(s, "users.profile.get");
  return { emoji: r.profile.status_emoji ?? "", text: r.profile.status_text ?? "", expiration: r.profile.status_expiration ?? 0, char: fromCodePoints(r.profile.status_emoji_display_info?.[0]?.unicode) };
}

/** `expiration` is unix seconds, 0 for none. */
export const setStatus = async (emoji: string, text: string, expiration = 0) => call(await primary(), "users.profile.set", { profile: JSON.stringify({ status_emoji: emoji, status_text: text, status_expiration: expiration }) });

export async function dnd(): Promise<Dnd> {
  const s = await primary();
  const r = await call<{ snooze_enabled?: boolean; snooze_endtime?: number }>(s, "dnd.info");
  return { snoozing: !!r.snooze_enabled, until: r.snooze_endtime ?? 0 };
}
export const snooze = async (minutes: number) => call(await primary(), "dnd.setSnooze", { num_minutes: minutes });
export const endSnooze = async () => call(await primary(), "dnd.endSnooze");

export async function presence(): Promise<{ presence: Presence; manual: boolean }> {
  const s = await primary();
  const r = await call<{ presence: string; manual_away?: boolean }>(s, "users.getPresence", { user: s.user });
  return { presence: r.presence === "away" ? "away" : "active", manual: !!r.manual_away };
}
export const setPresence = async (p: "auto" | "away") => call(await primary(), "users.setPresence", { presence: p });

/** A preset as the `statuses` setting spells it: `:emoji: text (1h)`, the expiry `Nm`, `Nh`, `Nd` or `today`; without an emoji `:speech_balloon:`. */
export function parsePreset(line: string): { emoji: string; text: string; expiry?: string } | undefined {
  const m = line.trim().match(/^(:[\w+-]+:)?\s*(.*?)(?:\s*\((\d+[mhd]|today)\))?$/);
  if (!m || !(m[1] || m[2])) return;
  return { emoji: m[1] ?? ":speech_balloon:", text: m[2], expiry: m[3] };
}

/** Unix seconds a preset's expiry lands on, 0 for none; `today` is the next local midnight. */
export function expiresAt(expiry: string | undefined, now = new Date()): number {
  if (!expiry) return 0;
  if (expiry === "today") { const d = new Date(now); d.setHours(24, 0, 0, 0); return Math.floor(d.getTime() / 1000); }
  const n = Number(expiry.slice(0, -1)), unit = expiry.at(-1);
  return Math.floor(now.getTime() / 1000) + n * (unit === "m" ? 60 : unit === "h" ? 3600 : 86400);
}

/** For the tests: forget every directory and run. */
export const reset = () => { dirs.clear(); runs.clear(); };
