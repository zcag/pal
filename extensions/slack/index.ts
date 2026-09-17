// Slack: four palettes and one bar item over one client (api.ts) and one
// data layer (data.ts); the bar popover's tree is view.ts. Unreads is live and the bar item draws from the
// same inbox (one `client.counts` per refresh, shared within
// `INBOX_FRESH_MS` so the panel showing and the bar refreshing on it cost
// one fetch); Channels is an hourly catalog; Search Slack is an input
// palette over `search.messages`; Status is live and lists what is set now
// before the presets. Row ids carry the workspace (`<team>/<conversation>`),
// so a workspace signed in twice over never collides.
import { errorMessage, failed, hint, imageData, settings, toast, truncate, type Accessory, type Action, type BarCtx, type BarItem, type Ctx, type Detail, type Effect, type Extension, type Form, type Item } from "@zcag/pal";
import { ApiError, NotSignedIn, RateLimited, conf, log, sessions } from "./api.ts";
import { emojiFor } from "./emoji.ts";
import {
  MAX_MSGS, MAX_QUIET, conversations, deepLink, dnd, endSnooze, expiresAt, inbox, markRead, parsePreset, post, presence, reset as resetData, search, sessionOf, setPresence, setStatus, snooze, status, toMsg, unreadSince, webLink,
  type Conversation, type Inbox, type Msg, type SearchHit, type Unread,
} from "./data.ts";
import { SECTION, render as renderBar, type BarRow, type BarState } from "./view.ts";

/** Glyphs from the bundled Nerd Font's `md-` set: slack, at, forum, pound, lock, account, account-multiple, magnify, emoticon, bell-sleep, bell, account-check, account-off, check-all, open-in-new, inbox. */
const ICON = { slack: "\u{f04b1}", dm: "\u{f0009}", mention: "\u{f0065}", thread: "\u{f028c}", channel: "\u{f0423}", private: "\u{f033e}", im: "\u{f0004}", mpim: "\u{f000e}", search: "\u{f0349}", status: "\u{f01f2}", dndOn: "\u{f00a0}", dndOff: "\u{f009a}", active: "\u{f0008}", away: "\u{f0012}", clear: "\u{f012d}", browser: "\u{f03cc}", inbox: "\u{f0687}" } as const;
/** How long an inbox is shared between the bar and the palette before either fetches again. */
const INBOX_FRESH_MS = 30_000;
const SEARCH_WAIT_MS = 300;
/** Rows per section in the bar's popover. */
const BAR_ROWS = 5;

// ---- the inbox, shared ------------------------------------------------------------

let last: Inbox | undefined;
let loading: Promise<Inbox> | undefined;
const rows = new Map<string, Unread>();

/** The inbox, fetched unless one younger than `INBOX_FRESH_MS` is at hand (or `refresh`); one fetch at a time. */
async function loadInbox(refresh = false): Promise<Inbox> {
  if (!refresh && last && Date.now() - last.at < INBOX_FRESH_MS) return last;
  loading ??= inbox().then((i) => { last = i; for (const u of [...i.items, ...i.quiet]) rows.set(rowId(u), u); return i; }).finally(() => { loading = undefined; });
  return loading;
}
const dropInbox = () => { last = undefined; };
// New settings may mean another workspace or another way in: nothing cached applies.
settings.onChange(() => { dropInbox(); rows.clear(); convs.clear(); resetData(); }, "slack");

/** A conversation can be a mention and a thread at once: the kind is part of the row id. */
const rowId = (u: Unread) => `${u.kind}:${u.id}`;

// ---- rows the palettes share ------------------------------------------------------


/** What a failed listing shows instead of rows: how to sign in, when the limit lifts, or what went wrong. */
function failure(e: unknown): Item[] {
  if (e instanceof NotSignedIn) return [hint("auth", conf().auth === "token" ? "Slack token is not set" : "Slack is not signed in", e.message, { actions: [{ id: "settings", title: "Open Slack settings" }] })];
  if (e instanceof RateLimited) return [hint("limit", "Slack rate limit reached", `Retry at ${e.until.toLocaleTimeString()}`)];
  if (e instanceof ApiError && e.auth) return [hint("auth", "Slack rejected the session", "Open Slack and sign in again, or set a token under Settings › Extensions › Slack", { actions: [{ id: "settings", title: "Open Slack settings" }] })];
  log(errorMessage(e));
  return [hint("error", "Slack did not answer", errorMessage(e))];
}
const pickHint = (id: string): Effect | void => (id === "hint:auth" ? { open: "pal://settings/extensions" } : undefined);
const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };

const ms = (ts: string) => Math.round(Number(ts) * 1000);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clock = (ts: string) => { const d = new Date(ms(ts)); return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
const convIcon = (kind: Conversation["kind"]) => (kind === "private" ? ICON.private : kind === "im" ? ICON.im : kind === "mpim" ? ICON.mpim : ICON.channel);

// ---- unreads --------------------------------------------------------------------

/** The row's mark: the sender's avatar when the run was fetched, else the kind's glyph. */
const unreadIcon = (u: Unread) => (u.top?.avatar ? { image: u.top.avatar } : u.kind === "channel" ? convIcon(u.ckind) : ICON[u.kind]);

function unreadSubtitle(u: Unread): string {
  if (u.kind === "thread") return `${plural(u.n, "new reply", "new replies")}${u.teamName ? ` · ${u.teamName}` : ""}`;
  // In a direct message the sender is the row's name already; a channel row says who.
  const line = u.top ? (u.top.who && u.top.who !== u.where ? `${u.top.who}: ${u.top.text}` : u.top.text) : u.kind === "channel" ? "Unread" : "";
  return [line || "(no text)", u.teamName].filter(Boolean).join(" · ");
}

function unreadAccessories(u: Unread): Accessory[] {
  const a: Accessory[] = [];
  if (u.kind !== "channel") a.push({ tag: String(u.n) + (u.more ? "+" : ""), color: u.kind === "thread" ? "blue" : "red" });
  const ts = u.top?.ts ?? u.latest;
  if (ts) a.push({ date: ms(ts) });
  return a;
}

function unreadActions(u: Unread): Action[] {
  return [
    { id: "open", title: "Open in Slack" },
    ...(u.kind !== "thread" ? [{ id: "reply", title: "Reply" }] : []),
    ...(u.kind !== "thread" && u.latest ? [{ id: "read", title: "Mark as read", shortcut: "cmd+shift+r" }] : []),
    { id: "browser", title: "Open in browser", shortcut: "cmd+shift+o" },
    { id: "copy", title: "Copy link", shortcut: "cmd+c" },
  ];
}

function unreadRow(u: Unread): Item {
  return {
    id: rowId(u),
    name: u.where,
    subtitle: unreadSubtitle(u),
    icon: unreadIcon(u),
    keywords: [u.where.replace(/^#/, ""), u.top?.who ?? "", u.kind === "dm" ? "dm" : u.kind].filter(Boolean),
    section: SECTION[u.kind],
    accessories: unreadAccessories(u),
    actions: unreadActions(u),
  };
}

async function unreadRows(ctx?: Ctx): Promise<Item[]> {
  const i = await loadInbox(!!ctx?.refresh);
  const all = [...i.items, ...i.quiet];
  if (!all.length) return [hint("none", "Nothing addressed to you", "No unread direct messages, mentions or threads, and every channel is read")];
  return all.map(unreadRow);
}

/** The unread run as the pane: one paragraph per message, oldest first; a thread names the count; a row whose run was not fetched fetches it now. */
async function unreadPane(u: Unread): Promise<Detail> {
  const metadata = [
    { label: "Conversation", value: u.where },
    { label: "Kind", value: u.kind === "dm" ? "Direct message" : u.kind === "mention" ? "Mention" : u.kind === "thread" ? "Thread" : "Channel" },
    ...(u.kind !== "channel" ? [{ label: "Unread", value: String(u.n) + (u.more ? " or more" : "") }] : []),
    ...(u.teamName ? [{ label: "Workspace", value: u.teamName }] : []),
    ...(u.latest ? [{ label: "Latest", value: clock(u.latest) }] : []),
  ];
  if (u.kind === "thread") return { markdown: `_${plural(u.n, "new reply", "new replies")} in threads you follow in ${u.where}; open Slack to read them._`, metadata };
  let msgs: Msg[] = u.msgs;
  if (!msgs.length && u.lastRead) {
    const s = await sessionOf(u.team);
    const r = await unreadSince(s, u.cid, u.lastRead);
    msgs = await Promise.all(r.msgs.slice(0, MAX_MSGS).reverse().map((m) => toMsg(s, m)));
    u.msgs = msgs;
  }
  if (!msgs.length) return { markdown: "_Nothing unread here any more._", metadata };
  const parts = msgs.map((m) => `**${m.who || "app"}** · ${clock(m.ts)}\n\n${m.text || "_(no text)_"}`);
  if (u.more) parts.push("_…and more before these._");
  return { markdown: parts.join("\n\n---\n\n"), metadata };
}

async function findUnread(id: string): Promise<Unread> {
  const have = rows.get(id);
  if (have) return have;
  await loadInbox();
  const u = rows.get(id);
  if (!u) throw new Error(`no unread ${id}`);
  return u;
}

const replyForm = (u: Unread, errors?: Record<string, string>, text = ""): Form => ({
  id: rowId(u),
  title: `Reply to ${u.where}`,
  fields: [{ kind: "text", id: "text", label: "Message", required: true, default: text, placeholder: u.top?.thread_ts ? "Posted in the thread" : "Posted to the conversation" }],
  submit: { id: "send", title: "Send" },
  errors,
});

async function pickUnread(u: Unread, action?: string, ctx?: Ctx): Promise<Effect> {
  const ts = u.top?.ts;
  switch (action) {
    case "browser": return { open: webLink(u.domain, u.cid, ts) };
    case "copy": return { copy: webLink(u.domain, u.cid, ts) };
    case "reply": return { form: replyForm(u) };
    case "send": {
      const text = String(ctx?.values?.text ?? "").trim();
      if (!text) return { form: replyForm(u, { text: "Required" }) };
      try { await post(u.team, u.cid, text, u.top?.thread_ts); } catch (e) { return { form: replyForm(u, { text: errorMessage(e) }, text) }; }
      return toast("Sent", `${u.where}: ${truncate(text, 60)}`);
    }
    case "read":
      try { await markRead(u); } catch (e) { return failed("mark read", e); }
      dropInbox();
      return toast("Marked read", u.where);
    default: return { open: deepLink(u.team, u.cid, ts) };
  }
}

// ---- channels ---------------------------------------------------------------------

const convs = new Map<string, Conversation>();
const convId = (c: Conversation) => `${c.team}/${c.id}`;

function convRow(c: Conversation, multi: boolean): Item {
  convs.set(convId(c), c);
  const kind = c.kind === "im" ? "direct message" : c.kind === "mpim" ? "group message" : c.kind === "private" ? "private channel" : "channel";
  return {
    id: convId(c),
    name: c.name,
    subtitle: truncate(c.topic || c.purpose || (c.kind === "im" ? "Direct message" : c.kind === "mpim" ? "Group message" : ""), 120) || undefined,
    icon: convIcon(c.kind),
    keywords: [c.name.replace(/^#/, ""), kind, ...(multi ? [c.teamName] : [])],
    section: multi ? c.teamName : undefined,
    accessories: [
      ...(c.kind === "private" ? [{ tag: "private", color: "amber" }] : c.kind === "mpim" ? [{ tag: "group", color: "grey" }] : c.kind === "im" ? [{ tag: "DM", color: "grey" }] : []),
      ...(c.members > 2 ? [{ text: plural(c.members, "member") }] : []),
    ],
    actions: [{ id: "open", title: "Open in Slack" }, { id: "browser", title: "Open in browser", shortcut: "cmd+shift+o" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }],
  };
}

async function convRows(ctx?: Ctx): Promise<Item[]> {
  const ss = await sessions();
  const lists = await Promise.all(ss.map((s) => conversations(s, !!ctx?.refresh, true)));
  const order: Record<Conversation["kind"], number> = { channel: 0, private: 1, mpim: 2, im: 3 };
  const out = lists.flat().sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name)).map((c) => convRow(c, ss.length > 1));
  return out.length ? out : [hint("none", "No conversations", "You are in no channel or direct message")];
}

const pickConv = (c: Conversation, action?: string): Effect => (action === "browser" ? { open: webLink(c.domain, c.id) } : action === "copy" ? { copy: webLink(c.domain, c.id) } : { open: deepLink(c.team, c.id) });

// ---- search ------------------------------------------------------------------------

const hits = new Map<string, SearchHit>();
let searchSeq = 0;
let lastSearch: Item[] = [];

function hitRow(h: SearchHit): Item {
  hits.set(h.id, h);
  return {
    id: h.id,
    name: truncate(h.text || "(no text)", 100),
    // A hit in a direct message with its sender: the name is the sender already.
    subtitle: h.who && h.who !== h.where ? `${h.who} in ${h.where}` : h.who ? "Direct message" : h.where,
    icon: h.avatar ? { image: h.avatar } : ICON.im,
    keywords: [h.who, h.where.replace(/^#/, "")].filter(Boolean),
    accessories: [{ date: ms(h.ts) }],
    actions: [{ id: "open", title: "Open in Slack" }, { id: "browser", title: "Open in browser", shortcut: "cmd+shift+o" }, { id: "copy", title: "Copy text", shortcut: "cmd+c" }],
  };
}

async function searchRows(query = ""): Promise<Item[]> {
  const q = query.trim();
  if (q.length < 2) return [hint("search", "Search Slack", "Text, from:@name, in:#channel, has:link, before:yesterday")];
  // A newer keystroke supersedes this one: wait a beat, and answer the last rows if one came.
  const seq = ++searchSeq;
  await Bun.sleep(SEARCH_WAIT_MS);
  if (seq !== searchSeq) return lastSearch;
  const found = await search(q);
  lastSearch = found.length ? found.map(hitRow) : [hint("empty", "No messages found", `Nothing in Slack matches "${q}"`)];
  return lastSearch;
}

const pickHit = (h: SearchHit, action?: string): Effect => (action === "browser" ? { open: h.permalink } : action === "copy" ? { copy: h.text } : { open: deepLink(h.team, h.cid, h.ts) });

// ---- status ------------------------------------------------------------------------

const until = (unix: number) => `until ${new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

async function statusRows(): Promise<Item[]> {
  const [st, d, p] = await Promise.all([status(), dnd(), presence()]);
  const now: Item[] = [
    st.text || st.emoji
      ? { id: "status:current", name: st.text || st.emoji, subtitle: st.expiration ? `Your status, ${until(st.expiration)}` : "Your status, no expiry", icon: st.char ?? emojiFor(st.emoji) ?? ICON.status, section: "Now", keywords: ["status"], actions: [{ id: "clear", title: "Clear status" }] }
      : { id: "status:current", name: "No status", subtitle: "Set one from the presets below", icon: ICON.status, section: "Now", keywords: ["status"], actions: [] },
    d.snoozing
      ? { id: "dnd:current", name: "Do Not Disturb", subtitle: `Notifications paused ${until(d.until)}`, icon: ICON.dndOn, section: "Now", keywords: ["dnd", "snooze"], actions: [{ id: "dnd:end", title: "End Do Not Disturb" }] }
      : { id: "dnd:current", name: "Notifications on", subtitle: "Do Not Disturb is off", icon: ICON.dndOff, section: "Now", keywords: ["dnd"], actions: [] },
    { id: "presence:current", name: p.presence === "away" ? "Away" : "Active", subtitle: p.presence === "away" ? (p.manual ? "Set away by hand" : "Away") : "Shown as active", icon: p.presence === "away" ? ICON.away : ICON.active, section: "Now", keywords: ["presence", "away", "active"], actions: [{ id: "presence:toggle", title: p.presence === "away" ? "Set active" : "Set away" }] },
  ];
  const presets = (conf().statuses ?? []).flatMap((line, i) => { const preset = parsePreset(line); return preset ? [{ preset, i }] : []; });
  const set: Item[] = presets.map(({ preset, i }) => ({
    id: `status:${i}`,
    name: preset.text || preset.emoji,
    subtitle: [...(emojiFor(preset.emoji) ? [] : [preset.emoji]), preset.expiry ? (preset.expiry === "today" ? "until tomorrow" : `for ${preset.expiry}`) : "no expiry"].join(" · "),
    icon: emojiFor(preset.emoji) ?? ICON.status,
    section: "Status",
    keywords: ["status"],
    actions: [{ id: "set", title: "Set status" }],
  }));
  const dndRows: Item[] = [
    { id: "dnd:30", name: "Do Not Disturb for 30 minutes", icon: ICON.dndOn, section: "Do Not Disturb", keywords: ["dnd", "snooze"], actions: [{ id: "snooze", title: "Pause notifications" }] },
    { id: "dnd:60", name: "Do Not Disturb for 1 hour", icon: ICON.dndOn, section: "Do Not Disturb", keywords: ["dnd", "snooze"], actions: [{ id: "snooze", title: "Pause notifications" }] },
    { id: "dnd:tomorrow", name: "Do Not Disturb until tomorrow", icon: ICON.dndOn, section: "Do Not Disturb", keywords: ["dnd", "snooze"], actions: [{ id: "snooze", title: "Pause notifications" }] },
  ];
  const pres: Item[] = [
    p.presence === "away"
      ? { id: "presence:active", name: "Set active", icon: ICON.active, section: "Presence", keywords: ["presence"], actions: [{ id: "set", title: "Set active" }] }
      : { id: "presence:away", name: "Set away", icon: ICON.away, section: "Presence", keywords: ["presence"], actions: [{ id: "set", title: "Set away" }] },
  ];
  return [...now, ...set, ...dndRows, ...pres];
}

/** Minutes until the next local midnight, for "until tomorrow". */
const minutesToMidnight = () => Math.max(1, Math.ceil((expiresAt("today") * 1000 - Date.now()) / 60_000));

async function pickStatus(id: string, action?: string): Promise<Effect> {
  try {
    if (id === "status:current" && action === "clear") { await setStatus("", "", 0); return toast("Status cleared"); }
    if (id.startsWith("status:")) {
      const preset = parsePreset((conf().statuses ?? [])[Number(id.slice(7))] ?? "");
      if (!preset) throw new Error(`no preset ${id}`);
      await setStatus(preset.emoji, preset.text, expiresAt(preset.expiry));
      return toast("Status set", `${preset.emoji} ${preset.text}${preset.expiry ? ` (${preset.expiry})` : ""}`);
    }
    if (id === "dnd:current" || id === "dnd:end") { await endSnooze(); return toast("Do Not Disturb ended"); }
    if (id.startsWith("dnd:")) {
      const minutes = id === "dnd:tomorrow" ? minutesToMidnight() : Number(id.slice(4));
      await snooze(minutes);
      return toast("Do Not Disturb on", id === "dnd:tomorrow" ? "Until tomorrow" : `For ${minutes === 60 ? "1 hour" : `${minutes} minutes`}`);
    }
    if (id === "presence:current" || id.startsWith("presence:")) {
      const away = id === "presence:away" || (id === "presence:current" && (await presence()).presence !== "away");
      await setPresence(away ? "away" : "auto");
      return toast(away ? "Set away" : "Set active");
    }
  } catch (e) { return toast("Slack refused", errorMessage(e), "failure"); }
  throw new Error(`no row ${id}`);
}

// ---- the bar item ----------------------------------------------------------------------

/**
 * The count of what is addressed to you (direct messages, mentions, thread
 * replies) as the badge, hidden at zero, urgent while a direct message
 * waits (`dm_urgent`); the popover is a view of the item's own (view.ts):
 * a section per kind with the newest five rows, a cursor the arrows move
 * and a click sets, the channels that are only unread as badges, the keys
 * as hints. Enter opens the focused row in Slack, `r` turns the search row
 * into a reply field (Enter sends through `post`), `m` marks it read, `a`
 * marks every listed conversation read, `o` opens Slack, `p` the Unreads
 * palette. The cursor and the reply field live here between renders. Not
 * signed in is hidden, not an error: the strip has no room for a hint. A
 * failed fetch throws, which the core draws as stale.
 */
const refreshSecs = () => Math.max(10, Number(conf().refresh) || 120);
/** The row the keys act on, and the one a reply is being typed for, across renders. */
let barFocus: string | undefined, barReplying: string | undefined, barDraft: string | undefined;

/** The popover's rows from the inbox: the newest `BAR_ROWS` per kind, the avatars fetched once each (a miss is the initial's tile). */
async function barState(i: Inbox): Promise<BarState> {
  const picked = (["dm", "mention", "thread"] as const).flatMap((kind) => i.items.filter((u) => u.kind === kind).slice(0, BAR_ROWS));
  const rows: BarRow[] = await Promise.all(picked.map(async (u) => {
    const ts = u.top?.ts ?? u.latest;
    return {
      id: rowId(u), kind: u.kind, where: u.where, who: u.top?.who || undefined, text: u.top?.text ?? (u.kind === "channel" ? "Unread" : ""), time: ts ? clock(ts) : undefined, n: u.n, more: u.more,
      avatar: u.top?.avatar ? await imageData(u.top.avatar) : undefined,
      canReply: u.kind !== "thread", canRead: u.kind !== "thread" && !!u.latest, teamName: u.teamName || undefined,
    };
  }));
  const focus = Math.max(0, rows.findIndex((r) => r.id === barFocus));
  if (barReplying && !rows.some((r) => r.id === barReplying)) { barReplying = undefined; barDraft = undefined; }
  return { rows, quiet: i.quiet.slice(0, MAX_QUIET).map((u) => ({ id: rowId(u), name: u.where })), quietTotal: i.quiet.length, focus, replying: barReplying, draft: barDraft };
}

async function unreadsItem(ctx: BarCtx): Promise<BarItem> {
  // The panel showing fires both this render and the palette's relist: an inbox under INBOX_FRESH_MS serves both. Only a push from the CLI or `bar.refresh` insists.
  let i: Inbox;
  try { i = await loadInbox(ctx.reason === "cli" || ctx.reason === "update"); } catch (e) {
    if (e instanceof NotSignedIn) return { hidden: true, refresh: refreshSecs() };
    throw e;
  }
  const attn = i.dm + i.mention + i.thread;
  const refresh = refreshSecs();
  if (attn === 0) return { hidden: true, refresh };
  const parts = [i.dm ? plural(i.dm, "direct message") : "", i.mention ? plural(i.mention, "mention") : "", i.thread ? plural(i.thread, "thread reply", "thread replies") : ""].filter(Boolean);
  return {
    icon: ICON.slack,
    badge: attn,
    urgent: conf().dm_urgent !== false && i.dm > 0,
    tooltip: `${parts.join(", ")}${i.channels ? `; ${plural(i.channels, "channel")} unread` : ""}`,
    refresh,
    menu: { view: renderBar(await barState(i)) },
  };
}

/** The popover drawn again from the inbox at hand (no fetch): what a key that only moves the cursor answers. */
const redraw = async (): Promise<Effect> => ({ view: renderBar(await barState(await loadInbox())) });

async function unreadsAction(action: string, ctx?: BarCtx): Promise<Effect> {
  if (action === "open-pal") return { push: { extension: "slack", palette: "unreads" } };
  if (action === "open-slack") return { open: "slack://open" };
  if (action === "read-all") {
    const i = await loadInbox();
    const refused: string[] = [];
    for (const u of i.items) if (u.kind !== "thread" && u.latest) { try { await markRead(u); } catch (e) { refused.push(u.where); log(`mark ${u.cid}: ${errorMessage(e)}`); } }
    dropInbox();
    return refused.length ? toast("Some could not be marked", refused.join(", "), "failure") : { keep: true, hud: "Marked read" };
  }
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return redraw(); }
  if (action.startsWith("open:")) return pickUnread(await findUnread(action.slice(5)));
  const st = await barState(await loadInbox());
  const cur = st.rows[st.focus];
  switch (action) {
    case "down": case "up": {
      if (!st.rows.length) return redraw();
      barFocus = st.rows[(st.focus + (action === "down" ? 1 : st.rows.length - 1)) % st.rows.length].id;
      return redraw();
    }
    case "reply": if (cur?.canReply) { barReplying = cur.id; barDraft = ""; } return redraw();
    case "cancel": barReplying = undefined; barDraft = undefined; return redraw();
    case "send": {
      const u = barReplying ? rows.get(barReplying) : undefined;
      const text = String(ctx?.values?.input ?? "").trim();
      if (!u) { barReplying = undefined; return redraw(); }
      if (!text) return { ...(await redraw()), toast: { title: "Nothing to send", message: "Type the reply first", style: "failure" } };
      try { await post(u.team, u.cid, text, u.top?.thread_ts); } catch (e) { barDraft = text; return { ...(await redraw()), toast: { title: "Could not send", message: errorMessage(e), style: "failure" } }; }
      barReplying = undefined; barDraft = undefined;
      return { ...(await redraw()), toast: { title: "Sent", message: `${u.where}: ${truncate(text, 60)}`, style: "success" } };
    }
    case "read": {
      if (!cur?.canRead) return { keep: true };
      const u = await findUnread(cur.id);
      try { await markRead(u); } catch (e) { return failed("mark read", e); }
      dropInbox();
      return { keep: true, hud: `${u.where}: read` };
    }
    case "open": return cur ? pickUnread(await findUnread(cur.id)) : { open: "slack://open" };
    case "browser": case "copy": return cur ? pickUnread(await findUnread(cur.id), action) : { keep: true };
  }
  // A menu-era id (`dm:T1/D_MARA`): the row itself, as a link or the CLI names it.
  if (rows.has(action) || /^(dm|mention|thread|channel):/.test(action)) return pickUnread(await findUnread(action));
  return { keep: true };
}

export default {
  palettes: {
    unreads: {
      title: "Unreads",
      live: true,
      list: (_q, ctx) => guard(() => unreadRows(ctx)),
      pick: async (id, action, ctx) => (id.startsWith("hint:") ? pickHint(id) : pickUnread(await findUnread(id), action, ctx)),
      detail: async (id) => { if (id.startsWith("hint:")) return; try { return await unreadPane(await findUnread(id)); } catch (e) { return { markdown: `_${errorMessage(e)}_` }; } },
    },
    channels: {
      title: "Channels",
      list: (_q, ctx) => guard(() => convRows(ctx)),
      pick: async (id, action) => {
        if (id.startsWith("hint:")) return pickHint(id);
        if (!convs.has(id)) await convRows();
        const c = convs.get(id);
        if (!c) throw new Error(`no conversation ${id}`);
        return pickConv(c, action);
      },
    },
    search: {
      title: "Search Slack",
      input: true,
      placeholder: "Text, from:@name, in:#channel, has:link",
      list: (query) => guard(() => searchRows(query)),
      pick: (id, action) => {
        if (id.startsWith("hint:")) return pickHint(id);
        const h = hits.get(id);
        if (!h) throw new Error(`no message ${id}`);
        return pickHit(h, action);
      },
    },
    status: {
      title: "Status",
      live: true,
      list: () => guard(statusRows),
      pick: (id, action) => (id.startsWith("hint:") ? pickHint(id) : pickStatus(id, action)),
    },
  },
  bar: {
    unreads: { render: unreadsItem, onAction: (action, ctx) => unreadsAction(action, ctx) },
  },
} satisfies Extension;
