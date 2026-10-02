// WhatsApp through OpenWA (the owner's self-hosted gateway and archive):
// four palettes and a bar item over one client (api.ts) and one data
// layer (data.ts); the bar popover's tree is view.ts. Chats is live and
// primary (a chat is reached by name), Unread is live and holds the
// root's unread rows, Search WhatsApp is an input palette over the
// archive's full-text search, Contacts an hourly catalog. The chat list
// is shared between the bar and the palettes for CHATS_FRESH_MS. Reading
// and mark-read are always on; with `send` off there is no reply, no
// reaction and no message field anywhere, whatever the key could do.
// With it on, a chat row takes the message in the search bar (`args`)
// for "Send a message"; a bare pick gets the same as a form.
import { bar, eachId, errorMessage, failed, hint, ignoreStore, imageData, preview, settings, toast, truncate, type Accessory, type Action, type Arg, type BarCtx, type BarItem, type Ctx, type Detail, type Effect, type Extension, type Form, type Item, type LinkParams, type Metadata } from "@zcag/pal";
import { ApiError, NoKey, RateLimited, SessionError, Unreachable, base, conf, log, markChatRead, markChatUnread, react as apiReact, reply as apiReply, reset as resetApi, sendText } from "./api.ts";
import { PANE_MSGS, REACTIONS, RUN_MSGS, chat, chatLink, clock, contacts, conversation, conversationMarkdown, dropChats, isGroupId, loadChats, oneLine, currentOpener as opener, phoneOf, prettyPhone, resetData, search, vcard, type Chat, type Hit, type Person } from "./data.ts";
import { RECENT_ROWS, actions as barActions, initialIcon, render as renderBar, type BarRow, type BarState } from "./view.ts";

/** Glyphs from the bundled Nerd Font's `md-` set: whatsapp, account-group, magnify, information, alert, check-all, message-text, reply, emoticon-outline, content-copy, open-in-new, card-account-details, phone. */
const ICON = { whatsapp: "\u{f05a3}", group: "\u{f0849}", search: "\u{f0349}", alert: "\u{f0026}", read: "\u{f012d}", unread: "\u{f0369}", reply: "\u{f045a}", react: "\u{f01f2}", copy: "\u{f018f}", web: "\u{f03cc}", contact: "\u{f05d2}", phone: "\u{f03f2}" } as const;
const SEARCH_WAIT_MS = 300;
const SETTINGS_URL = "pal://settings/extensions";

// New settings may mean another gateway, another key or another session: nothing cached applies.
settings.onChange(() => { resetApi(); resetData(); }, "whatsapp");

const canSend = () => conf().send === true;

// ---- rows the palettes share ----------------------------------------------------------------

const SETTINGS_ACTION: Action[] = [{ id: "settings", title: "Open WhatsApp settings" }];

/** What a failed listing shows instead of rows: the setting to fill, the url that did not answer, the session's state, when the limit lifts, or what went wrong. */
function failure(e: unknown): Item[] {
  if (e instanceof NoKey) return [hint("key", "API key is not set", "Set api_key under Settings › Extensions › WhatsApp: a key from OpenWA's Settings, API keys", { actions: SETTINGS_ACTION, icon: ICON.alert })];
  if (e instanceof Unreachable) return [hint("unreachable", `OpenWA is unreachable at ${e.url}`, "Check base_url under Settings › Extensions › WhatsApp, and that the gateway is up", { actions: SETTINGS_ACTION, icon: ICON.alert })];
  if (e instanceof ApiError && e.auth) return [hint("auth", "OpenWA rejected the API key", `${e.status}: check api_key under Settings › Extensions › WhatsApp`, { actions: SETTINGS_ACTION, icon: ICON.alert })];
  if (e instanceof SessionError) return [hint("session", e.message, e.status === "qr_ready" ? `Scan the QR code at ${base()} to link the phone again` : e.status ? `Check the session at ${base()}` : `Set session under Settings › Extensions › WhatsApp to a session ${base()} lists`, { actions: SETTINGS_ACTION, icon: ICON.alert })];
  if (e instanceof RateLimited) return [hint("limit", "OpenWA rate limit reached", `Retry at ${clock(e.until.getTime())}`, { icon: ICON.alert })];
  log(errorMessage(e));
  return [hint("error", "OpenWA did not answer", errorMessage(e), { icon: ICON.alert })];
}
const pickHint = (id: string): Effect | void => (id === "hint:key" || id === "hint:auth" || id === "hint:unreachable" || id === "hint:session" ? { open: SETTINGS_URL } : undefined);
const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };
const SEND_OFF = "Turn on send under Settings › Extensions › WhatsApp";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The row's mark: the profile picture, the group glyph (tinted by the tile), else the initial on a tile. */
const chatIcon = (c: Chat) => (c.avatar ? { image: c.avatar } : c.group ? ICON.group : initialIcon(c.name));

const READ: Action = { id: "read", title: "Mark as read", multi: true }, UNREAD: Action = { id: "unread", title: "Mark as unread", multi: true };

// ---- ignored ------------------------------------------------------------------------------------
// An unread chat can be ignored until its next message: out of the count,
// the popover and the Unread section, and still unread on the phone (no
// blue ticks, nothing sent). The stamp is the newest message's time, so a
// new message brings it back by itself; the Unread palette's Ignored
// filter lists it with Show again, the Chats palette under its own section.

const ignored = ignoreStore("ignored");
const stampOf = (c: Chat) => String(c.at);
const isIgnored = (c: Chat) => c.unread > 0 && ignored.hides(c.id, stampOf(c));
/** Unread and not ignored: what counts. */
const counts = (c: Chat) => c.unread > 0 && !isIgnored(c);
/** The chat list with the ignored set settled against it: a chat whose newest message moved is shown again. */
async function chats(refresh?: boolean): Promise<Chat[]> {
  const [list] = await Promise.all([loadChats(refresh), ignored.ready]);
  const dropped = await ignored.settle(list.map((c) => ({ id: c.id, stamp: stampOf(c) })));
  if (dropped.length) log(`shown again ${dropped.map(([id, why]) => `${id} (${why})`).join(", ")}`);
  return list;
}
const IGNORE: Action = { id: "ignore", title: "Ignore until the next message", shortcut: "cmd+shift+i", multi: true };
const SHOW: Action = { id: "unignore", title: "Show again", shortcut: "cmd+shift+i", multi: true };
async function pickIgnore(ids: string[], on: boolean): Promise<Effect> {
  const list = await chats();
  const picked = list.filter((c) => ids.includes(c.id));
  if (on) await ignored.add(picked.map((c) => ({ id: c.id, stamp: stampOf(c) })));
  else await ignored.remove(ids);
  bar.refresh("unread").catch(() => {});
  return toast(on ? "Ignored until the next message" : "Shown again", ids.length > 1 ? plural(ids.length, "chat") : picked[0]?.name ?? "");
}

function chatActions(c: Chat): Action[] {
  const send = canSend();
  return [
    { id: "open", title: c.group ? "Open WhatsApp" : "Open chat" },
    // The one that flips the chat is on ⌘↵; the other rides at the end, so marked chats that mix read and unread can still be marked either way.
    { ...(c.unread > 0 ? READ : UNREAD), shortcut: "cmd+enter" },
    // Send takes the row's typed arguments (the message, and whether it quotes); Enter on the row still opens the chat.
    ...(send ? [{ id: "reply", title: "Send a message", shortcut: "cmd+shift+r", args: true as const }, { id: "react", title: "React to the latest message", shortcut: "cmd+shift+e" }] : []),
    { id: "web", title: "Open in the web client", shortcut: "cmd+shift+o" },
    // Opening stays one chat: WhatsApp shows one at a time. Copying takes marked chats too, one per line.
    c.group ? { id: "copy-name", title: "Copy name", shortcut: "cmd+c", multi: true } : { id: "copy-number", title: "Copy number", shortcut: "cmd+c", multi: true },
    ...(isIgnored(c) ? [SHOW] : c.unread > 0 ? [IGNORE] : []),
    c.unread > 0 ? UNREAD : READ,
  ];
}

/** With `send` on, the message typed in the bar for "Send a message", and a quote choice when the listing knows an incoming latest message. */
function chatArgs(c: Chat): Arg[] | undefined {
  if (!canSend()) return;
  return [
    { id: "text", placeholder: "Message", required: true },
    ...(c.latestId && !c.latestFromMe ? [{ id: "quote", placeholder: "Reply", kind: "select" as const, default: "", options: [{ id: "", title: "New message" }, { id: "quote", title: `Quote “${truncate(oneLine(c.last ?? ""), 40)}”` }] }] : []),
  ];
}

/** Two at most: the unread count (else the group tag, which an unread group's count outranks), then the time. */
function chatAccessories(c: Chat): Accessory[] {
  const a: Accessory[] = [];
  if (c.unread > 0) a.push({ tag: String(c.unread), color: "green" });
  else if (c.group) a.push({ tag: "group", color: "grey" });
  if (c.at) a.push({ date: c.at });
  return a;
}

/** A chat as a row: the picture, the name, the newest message with its sender, the unread count or the group tag, the time. */
function chatRow(c: Chat, section?: string): Item {
  return {
    id: c.id,
    name: c.name,
    subtitle: c.last ? truncate(oneLine(c.last), 110) : c.group ? "Group" : undefined,
    icon: chatIcon(c),
    keywords: [c.group ? "group" : "chat", ...(c.who && c.who !== "You" && c.who !== c.name ? [c.who] : [])],
    section,
    accessories: chatAccessories(c),
    args: chatArgs(c),
    actions: chatActions(c),
  };
}

/** The pane, a document: the kind and number over the chat's name, its unread count as a chip; the last twenty messages as a conversation (the sender in bold, "You" for yours, the time, a quoted reply as a blockquote, media as a bracketed label); then the time of the newest and the link. */
async function chatPane(c: Chat): Promise<Detail> {
  const msgs = await conversation(c, PANE_MSGS);
  const phone = c.group ? undefined : await phoneOf(c.id).catch(() => undefined);
  const metadata: Metadata[] = [
    ...(c.at ? [{ label: "Newest", value: clock(c.at) }] : []),
    { label: "Open", link: { text: "In the web client", href: chatLink(phone, "web") } },
  ];
  return {
    caption: [c.group ? "Group" : "Direct message", phone && prettyPhone(phone)].filter(Boolean).join(" · "),
    title: c.name,
    ...(c.unread > 0 && { chips: [{ text: `${plural(c.unread, "message")} unread`, color: "green" as const }] }),
    markdown: msgs.length ? conversationMarkdown(msgs) : "_No messages the gateway can see; the conversation is on the phone._",
    metadata,
  };
}

/** Every chat the pick is for: the marked rows, else the one. */
const idsOf = (id: string, ctx?: Ctx) => ctx?.ids ?? [id];

async function openChat(c: Chat, where = opener()): Promise<Effect> {
  if (c.group) return { open: chatLink(undefined, where), hud: `${c.name} is a group: WhatsApp opens at the top` };
  const phone = await phoneOf(c.id).catch(() => undefined);
  if (!phone) return toast("No number for this chat", `${c.name} has no phone the gateway can resolve`, "failure");
  return { open: chatLink(phone, where) };
}

const messageForm = (c: Chat, errors?: Record<string, string>, text = "", quote = false): Form => ({
  id: c.id,
  title: `Message ${c.name}`,
  fields: [
    { kind: "textarea", id: "text", label: "Message", required: true, default: text, placeholder: `Sent to ${c.name} from your own number` },
    ...(c.latestId && !c.latestFromMe ? [{ kind: "checkbox", id: "quote", label: "Reply", text: `Quote the latest message: “${truncate(oneLine(c.last ?? ""), 60)}”`, default: quote } as const] : []),
  ],
  submit: { id: "send", title: "Send" },
  errors,
});

const reactForm = (c: Chat, errors?: Record<string, string>): Form => ({
  id: c.id,
  title: `React in ${c.name}`,
  fields: [
    { kind: "select", id: "emoji", label: "Reaction", options: [...REACTIONS.map((e) => ({ id: e, title: e })), { id: "", title: "Remove your reaction" }], default: REACTIONS[0], description: `On the latest message: “${truncate(oneLine(c.last ?? ""), 80)}”` },
  ],
  submit: { id: "react-send", title: "React" },
  errors,
});

/** The latest incoming message's id for a reply that quotes or a reaction, fetched now when the listing did not (a read chat). */
async function latestOf(c: Chat): Promise<string | undefined> {
  if (c.latestId !== undefined) return c.latestFromMe ? undefined : c.latestId;
  const run = await conversation(c, RUN_MSGS);
  const incoming = [...run].reverse().find((m) => !m.fromMe);
  const top = run[run.length - 1];
  c.latestId = incoming?.id ?? top?.id;
  c.latestFromMe = !incoming;
  if (top && !c.last) { c.last = top.who === "You" || !c.group ? top.text : `${top.who}: ${top.text}`; c.who = top.who; }
  return incoming?.id;
}

async function pickChat(c: Chat, action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const ids = idsOf(c.id, ctx);
  const n = ids.length;
  switch (action) {
    case "read": {
      const refused: string[] = [];
      for (const id of ids) { try { await markChatRead(id); } catch (e) { refused.push((await chat(id)).name); log(`read ${id}: ${errorMessage(e)}`); } }
      dropChats();
      if (refused.length) return failed("mark read", refused.join(", "));
      return toast("Marked read", n > 1 ? plural(n, "chat") : c.name);
    }
    case "unread": {
      const refused: string[] = [];
      for (const id of ids) { try { await markChatUnread(id); } catch (e) { refused.push((await chat(id)).name); log(`unread ${id}: ${errorMessage(e)}`); } }
      dropChats();
      if (refused.length) return failed("mark unread", refused.join(", "));
      return toast("Marked unread", n > 1 ? plural(n, "chat") : c.name);
    }
    case "reply": case "send": {
      if (!canSend()) return toast("Sending is off", SEND_OFF, "failure");
      // The bar's values ("reply"), or the form's on the way back ("send"); a bare pick (a hotkey, `pal run`) gets the form, the latest message fetched so it can be quoted.
      if (!ctx?.values) { await latestOf(c).catch(() => undefined); return { form: messageForm(c) }; }
      const text = String(ctx.values.text ?? "").trim();
      const quote = ctx.values.quote === true || ctx.values.quote === "quote";
      if (!text) return { form: messageForm(c, { text: "Required" }, "", quote) };
      try {
        if (quote && c.latestId && !c.latestFromMe) await apiReply(c.id, c.latestId, text);
        else await sendText(c.id, text);
      } catch (e) { return { form: messageForm(c, { text: errorMessage(e) }, text, quote) }; }
      dropChats();
      return toast("Sent", `${c.name}: ${truncate(text, 60)}`);
    }
    case "react": {
      if (!canSend()) return toast("Reactions are off", SEND_OFF, "failure");
      const target = await latestOf(c).catch(() => undefined);
      if (!target) return toast("Nothing to react to", `The latest message in ${c.name} is yours, or there is none`, "failure");
      return { form: reactForm(c) };
    }
    case "react-send": {
      if (!canSend()) return toast("Reactions are off", SEND_OFF, "failure");
      const emoji = String(ctx?.values?.emoji ?? "");
      const target = await latestOf(c).catch(() => undefined);
      if (!target) return toast("Nothing to react to", `The latest message in ${c.name} is yours, or there is none`, "failure");
      try { await apiReact(c.id, target, emoji); } catch (e) { return { form: reactForm(c, { emoji: errorMessage(e) }) }; }
      return toast(emoji ? `Reacted ${emoji}` : "Reaction removed", c.name);
    }
    case "ignore": case "unignore": return pickIgnore(ids, action === "ignore");
    case "web": return openChat(c, "web");
    case "copy-name": return { copy: c.name };
    case "copy-number": {
      const phone = await phoneOf(c.id).catch(() => undefined);
      return phone ? { copy: `+${phone}` } : toast("No number for this chat", `${c.name} has no phone the gateway can resolve`, "failure");
    }
    default: return openChat(c);
  }
}

// ---- chats and unread -------------------------------------------------------------------------

/** The section ignored unread chats are listed under, last. */
const IGNORED = "Ignored until the next message";

async function chatRows(ctx?: Ctx): Promise<Item[]> {
  const list = await chats(!!ctx?.refresh);
  if (!list.length) return [hint("empty", "No chats", "The session lists no chats yet; the phone's chats appear once WhatsApp Web has loaded them")];
  return list.map((c) => chatRow(c, isIgnored(c) ? IGNORED : c.unread > 0 ? "Unread" : "Recent"));
}

async function unreadRows(ctx?: Ctx): Promise<Item[]> {
  const all = await chats(!!ctx?.refresh);
  if (ctx?.filter === "ignored") {
    const quiet = all.filter(isIgnored);
    return quiet.length ? quiet.map((c) => chatRow(c, IGNORED)) : [hint("none", "Nothing ignored", "Ignore keeps an unread chat out of the list and the count until its next message", { icon: ICON.read })];
  }
  const list = all.filter(counts);
  if (!list.length) return [hint("none", "Nothing unread", "Every chat is read", { icon: ICON.read })];
  return list.map((c) => chatRow(c, c.group ? "Groups" : "Direct messages"));
}

/** Marked rows' copies (`ctx.ids`, each row's own pick) on one clipboard, one per line; the first failure instead, when one failed (`eachId`). */
const copyEach = (ids: string[], one: (id: string) => Promise<Effect>) => eachId(ids, one);
const COPIES = new Set(["copy", "copy-name", "copy-number", "copy-vcard"]);
const many = (action: string | undefined, ctx: Ctx | undefined): ctx is Ctx & { ids: string[] } => !!action && COPIES.has(action) && !!ctx?.ids && ctx.ids.length > 1;

const pickChatRow = async (id: string, action?: string, ctx?: Ctx): Promise<Effect | void> =>
  id.startsWith("hint:") ? pickHint(id) : many(action, ctx) ? copyEach(ctx.ids, async (x) => pickChat(await chat(x), action)) : pickChat(await chat(id), action, ctx);
const paneOf = async (id: string): Promise<Detail | void> => { if (id.startsWith("hint:")) return; try { return await chatPane(await chat(id)); } catch (e) { return { markdown: `_${errorMessage(e)}_` }; } };

// ---- search -----------------------------------------------------------------------------------------

const hits = new Map<string, Hit>();
let searchSeq = 0;
let lastSearch: Item[] = [];

function hitRow(h: Hit): Item {
  hits.set(h.id, h);
  return {
    id: h.id,
    name: truncate(h.text, 100),
    // A hit in a direct chat with its sender: the chat's name is the sender already.
    subtitle: h.fromMe ? `You in ${h.chat}` : h.who !== h.chat ? `${h.who} in ${h.chat}` : h.chat,
    icon: isGroupId(h.chatId) ? ICON.group : initialIcon(h.chat),
    keywords: [h.chat, h.who],
    accessories: [{ date: h.at }],
    actions: [{ id: "open", title: "Open chat" }, { id: "copy", title: "Copy message", shortcut: "cmd+c", multi: true }, { id: "web", title: "Open in the web client", shortcut: "cmd+shift+o" }],
  };
}

async function searchRows(query = "", ctx?: Ctx): Promise<Item[]> {
  const q = query.trim();
  if (q.length < 2) return [hint("search", "Search WhatsApp", "Words from any message in the archive, back to the first chat", { icon: ICON.search })];
  // A newer keystroke supersedes this one: wait a beat, and answer the last rows if one came.
  const seq = ++searchSeq;
  await Bun.sleep(SEARCH_WAIT_MS);
  if (seq !== searchSeq) return lastSearch;
  let found: Hit[];
  try { found = await search(q, (have) => { if (seq === searchSeq) ctx?.partial?.(have.map(hitRow)); }); } catch (e) {
    if (e instanceof ApiError && !e.auth) return (lastSearch = [hint("down", "WhatsApp search is unavailable", `${base()} answered ${e.status}: ${truncate(e.message, 80)}`, { icon: ICON.alert })]);
    throw e;
  }
  lastSearch = found.length ? found.map(hitRow) : [hint("empty", "No messages found", `Nothing in the archive matches "${q}"`, { icon: ICON.search })];
  return lastSearch;
}

async function pickHit(h: Hit, action?: string): Promise<Effect> {
  if (action === "copy") return { copy: h.text };
  const c = await chat(h.chatId);
  return openChat(c, action === "web" ? "web" : undefined);
}

// ---- contacts -----------------------------------------------------------------------------------------

const people = new Map<string, Person>();

function personRow(p: Person): Item {
  people.set(p.id, p);
  const phone = prettyPhone(p.phone);
  return {
    id: p.id,
    name: p.name,
    ...(p.name !== phone && { subtitle: phone }),
    icon: initialIcon(p.name),
    keywords: [p.phone, prettyPhone(p.phone)],
    actions: [
      { id: "open", title: "Open chat" },
      { id: "copy-number", title: "Copy number", shortcut: "cmd+c", multi: true },
      { id: "copy-vcard", title: "Copy as vCard", shortcut: "cmd+shift+c", multi: true },
      { id: "web", title: "Open in the web client", shortcut: "cmd+shift+o" },
    ],
  };
}

async function contactRows(ctx?: Ctx): Promise<Item[]> {
  const list = await contacts(!!ctx?.refresh);
  people.clear();
  if (!list.length) return [hint("none", "No contacts", "The session lists no saved contact; the phone's address book appears once WhatsApp Web has synced it")];
  return list.map(personRow);
}

async function pickPerson(id: string, action?: string): Promise<Effect> {
  let p = people.get(id);
  if (!p) { await contactRows(); p = people.get(id); }
  if (!p) throw new Error(`no contact ${id}`);
  if (action === "copy-number") return { copy: `+${p.phone}` };
  if (action === "copy-vcard") return { copy: vcard(p.name, p.phone), hud: `Copied ${p.name} as a vCard` };
  return { open: chatLink(p.phone, action === "web" ? "web" : opener()) };
}

// ---- the bar item ------------------------------------------------------------------------------------------

/**
 * The count of unread chats as the badge, urgent while a direct chat is
 * among them (the manifest's `dm` rule), hidden at zero by its `quiet`
 * rule, the glyph and the popover
 * (which then lists the recent chats) its `empty` shape for a `show =
 * "always"` config. The popover is a view of the item's own (view.ts):
 * direct messages then groups, a cursor the arrows move and a click
 * sets, rows the shell can mark (cmd/shift click, shift+arrows), the
 * keys as hints; Enter opens the focused chat, `m` marks it read (or
 * every marked chat), `a` every listed one, `r` (send on) turns the search row into a
 * message field whose Enter sends, `o` opens WhatsApp, `p` the Unread
 * palette. The cursor and the field live here between renders. No key
 * set is hidden, not an error: the strip has no room for a hint. Any
 * other failure throws, which the core draws as stale.
 */
let barFocus: string | undefined, barReplying: string | undefined, barDraft: string | undefined;

/** Every unread chat, direct messages then groups; at nothing unread the newest `RECENT_ROWS` chats instead. */
async function barRows(list: Chat[]): Promise<BarRow[]> {
  const unread = list.filter(counts);
  const picked = unread.length ? [...unread.filter((c) => !c.group), ...unread.filter((c) => c.group)] : list.filter((c) => !isIgnored(c)).slice(0, RECENT_ROWS);
  return Promise.all(picked.map(async (c): Promise<BarRow> => ({
    id: c.id, name: c.name, group: c.group, text: c.last ? oneLine(c.last) : c.group ? "Group" : "", time: c.at ? clock(c.at) : undefined, n: c.unread,
    avatar: c.avatar ? await imageData(c.avatar) : undefined,
  })));
}

async function barState(list: Chat[]): Promise<BarState> {
  const rows = await barRows(list);
  const focus = Math.max(0, rows.findIndex((r) => r.id === barFocus));
  if (barReplying && !rows.some((r) => r.id === barReplying)) { barReplying = undefined; barDraft = undefined; }
  return { rows, focus, replying: barReplying, draft: barDraft, canSend: canSend(), urgent: rows.some((r) => r.n > 0 && !r.group) };
}

async function unreadItem(ctx: BarCtx): Promise<BarItem> {
  // The panel showing fires both this render and the palettes' relists: a list under CHATS_FRESH_MS serves all. Only a push from the CLI or `bar.refresh` insists.
  let list: Chat[];
  try { list = await chats(ctx.reason === "cli" || ctx.reason === "update"); } catch (e) {
    if (e instanceof NoKey) return { hidden: true, states: { unread: null, direct: null } };
    throw e;
  }
  const unread = list.filter(counts);
  const direct = unread.filter((c) => !c.group).length, groups = unread.length - direct;
  const menu = { view: renderBar(await barState(list)) };
  // The facts (`whatsapp/unread`, `whatsapp/direct`): the manifest's rules hide the item at zero and make a direct message urgent.
  const states = { unread: unread.length, direct };
  const empty = { icon: ICON.whatsapp, tooltip: "Nothing unread", menu };
  if (!unread.length) return { icon: ICON.whatsapp, tooltip: "Nothing unread", menu, empty, states };
  const parts = [direct ? plural(direct, "direct message") : "", groups ? plural(groups, "group") : ""].filter(Boolean);
  return { icon: ICON.whatsapp, badge: unread.length, tooltip: `${plural(unread.length, "chat")} unread: ${parts.join(", ")}`, menu, empty, states };
}

/** The popover drawn again from the list at hand (no fetch): what a key that only moves the cursor answers. */
const redraw = async (): Promise<Effect> => ({ view: renderBar(await barState(await chats())) });

async function unreadAction(action: string, ctx?: BarCtx): Promise<Effect> {
  if (action === "open-pal") return { push: { extension: "whatsapp", palette: "unread" } };
  if (action === "open-whatsapp") return { open: chatLink(undefined, opener()) };
  if (action === "read-all") {
    const refused: string[] = [];
    // What the popover lists: an ignored chat stays unread on the phone.
    for (const c of (await chats()).filter(counts)) { try { await markChatRead(c.id); } catch (e) { refused.push(c.name); log(`read ${c.id}: ${errorMessage(e)}`); } }
    dropChats();
    return refused.length ? toast("Some could not be marked", refused.join(", "), "failure") : { keep: true, hud: "Marked read" };
  }
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return redraw(); }
  const st = await barState(await chats());
  const cur = st.rows[st.focus];
  switch (action) {
    case "down": case "up": {
      if (!st.rows.length) return redraw();
      barFocus = st.rows[(st.focus + (action === "down" ? 1 : st.rows.length - 1)) % st.rows.length].id;
      return redraw();
    }
    // The chat under the cursor as a level to read, the row's keys still working there.
    case "preview": return cur ? preview(await paneOf(cur.id), cur.name, barActions(st), ["open", "reply", ...(cur.n > 0 ? ["read", "ignore"] : []), "web"]) : { keep: true };
    case "ignore": {
      // The marked rows (`BarCtx.ids`), else the unread one under the cursor; the cursor stays at its index, the next chat slides under it.
      const ids = ctx?.ids ?? (cur && cur.n > 0 ? [cur.id] : []);
      if (!ids.length) return { keep: true };
      const list = await chats();
      await ignored.add(list.filter((c) => ids.includes(c.id)).map((c) => ({ id: c.id, stamp: stampOf(c) })));
      const next = await barState(list);
      barFocus = next.rows[Math.min(st.focus, Math.max(0, next.rows.length - 1))]?.id;
      return { keep: true, view: renderBar(await barState(list)), ...(ids.length > 1 && { hud: `Ignored ${ids.length}` }) };
    }
    case "reply": if (cur && canSend()) { barReplying = cur.id; barDraft = ""; } return redraw();
    case "cancel": barReplying = undefined; barDraft = undefined; return redraw();
    case "send": {
      const text = String(ctx?.values?.input ?? "").trim();
      const c = barReplying ? await chat(barReplying) : undefined;
      if (!c) { barReplying = undefined; return redraw(); }
      if (!canSend()) { barReplying = undefined; barDraft = undefined; return { ...(await redraw()), toast: { title: "Sending is off", message: SEND_OFF, style: "failure" } }; }
      if (!text) return { ...(await redraw()), toast: { title: "Nothing to send", message: "Type the message first", style: "failure" } };
      try { await sendText(c.id, text); } catch (e) { barDraft = text; return { ...(await redraw()), toast: { title: "Could not send", message: errorMessage(e), style: "failure" } }; }
      barReplying = undefined; barDraft = undefined;
      dropChats();
      return { ...(await redraw()), toast: { title: "Sent", message: `${c.name}: ${truncate(text, 60)}`, style: "success" } };
    }
    case "read": {
      // The marked rows (`BarCtx.ids`), else the unread one under the cursor.
      const ids = ctx?.ids ?? (cur && cur.n > 0 ? [cur.id] : []);
      if (!ids.length) return { keep: true };
      const refused: string[] = [];
      for (const id of ids) { try { await markChatRead(id); } catch (e) { refused.push(st.rows.find((r) => r.id === id)?.name ?? id); log(`read ${id}: ${errorMessage(e)}`); } }
      dropChats();
      if (refused.length) return failed("mark read", refused.join(", "));
      return { keep: true, hud: ids.length > 1 ? `Marked ${ids.length} read` : `${st.rows.find((r) => r.id === ids[0])?.name ?? "Chat"}: read` };
    }
    case "open": return cur ? openChat(await chat(cur.id)) : { open: chatLink(undefined, opener()) };
    case "web": return cur ? openChat(await chat(cur.id), "web") : { open: chatLink(undefined, "web") };
  }
  // A chat id as a link or the CLI names it: the row itself.
  if (/@(c\.us|lid|g\.us)$/.test(action)) return openChat(await chat(action));
  return { keep: true };
}

// ---- links -----------------------------------------------------------------------------------------------------

/** `open?chat=`: a chat id, a phone (digits, `+` allowed), or a name the chat list or the contacts have. */
async function openLink(what: string): Promise<Effect> {
  const s = what.trim();
  if (!s) throw new Error("chat is required");
  if (/@(c\.us|lid|g\.us)$/.test(s)) return openChat(await chat(s));
  if (/^\+?[\d\s()-]{6,}$/.test(s)) return { open: chatLink(s.replace(/\D/g, ""), opener()) };
  const lower = s.toLowerCase();
  const list = await loadChats();
  const c = list.find((c) => c.name.toLowerCase() === lower) ?? list.find((c) => c.name.toLowerCase().startsWith(lower));
  if (c) return openChat(c);
  const p = (await contacts()).find((p) => p.name.toLowerCase() === lower) ?? (await contacts()).find((p) => p.name.toLowerCase().startsWith(lower));
  if (p) return { open: chatLink(p.phone, opener()) };
  throw new Error(`no chat or contact named "${s}"`);
}

// ---- the extension ----------------------------------------------------------------------------------------------

export default {
  palettes: {
    chats: {
      title: "Chats",
      live: true,
      lazy: true,
      placeholder: "A person or a group",
      list: (_q, ctx) => guard(() => chatRows(ctx)),
      pick: pickChatRow,
      detail: paneOf,
    },
    unread: {
      title: "Unread",
      live: true,
      lazy: true,
      placeholder: "An unread chat",
      filters: [{ id: "all", title: "All" }, { id: "ignored", title: "Ignored" }],
      list: (_q, ctx) => guard(() => unreadRows(ctx)),
      pick: pickChatRow,
      detail: paneOf,
    },
    search: {
      title: "Search WhatsApp",
      input: true,
      placeholder: "Words from any message",
      list: (query, ctx) => guard(() => searchRows(query, ctx)),
      pick: (id, action, ctx) => {
        if (id.startsWith("hint:")) return pickHint(id);
        const one = (x: string) => { const h = hits.get(x); if (!h) throw new Error(`no message ${x}`); return pickHit(h, action); };
        return many(action, ctx) ? copyEach(ctx.ids, one) : one(id);
      },
      detail: async (id) => { const h = hits.get(id); if (!h) return; try { return await chatPane(await chat(h.chatId)); } catch (e) { return { markdown: `_${errorMessage(e)}_` }; } },
    },
    contacts: {
      title: "Contacts",
      lazy: true,
      placeholder: "A name or a number",
      list: (_q, ctx) => guard(() => contactRows(ctx)),
      // Marked contacts' numbers or vCards (one .vcf holds several) on one clipboard.
      pick: (id, action, ctx) => (id.startsWith("hint:") ? pickHint(id) : many(action, ctx) ? copyEach(ctx.ids, (x) => pickPerson(x, action)) : pickPerson(id, action)),
    },
  },
  bar: {
    unread: { render: unreadItem, onAction: (action, ctx) => unreadAction(action, ctx) },
  },
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route === "open") return openLink(String(params.chat ?? ""));
    if (route === "search") return { push: { extension: "whatsapp", palette: "search", query: String(params.q ?? "") } };
  },
} satisfies Extension;
