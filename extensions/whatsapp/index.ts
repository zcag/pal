// WhatsApp through OpenWA (the owner's self-hosted gateway and archive):
// four palettes and a bar item over one client (api.ts) and one data
// layer (data.ts); the bar popover's tree is view.ts. Chats is live and
// primary (a chat is reached by name), Unread is live and holds the
// root's unread rows, Search WhatsApp is an input palette over the
// archive's full-text search, Contacts an hourly catalog. The chat list
// is shared between the bar and the palettes for CHATS_FRESH_MS. Reading
// and mark-read are always on; with `send` off there is no reply, no
// reaction and no message field anywhere, whatever the key could do.
import { errorMessage, failed, hint, imageData, settings, toast, truncate, type Accessory, type Action, type BarCtx, type BarItem, type Ctx, type Detail, type Effect, type Extension, type Form, type Item, type LinkParams, type Metadata } from "@zcag/pal";
import { ApiError, NoKey, RateLimited, SessionError, Unreachable, base, conf, log, markChatRead, markChatUnread, react as apiReact, reply as apiReply, reset as resetApi, sendText } from "./api.ts";
import { PANE_MSGS, REACTIONS, RUN_MSGS, chat, chatLink, clock, contacts, conversation, conversationMarkdown, dropChats, isGroupId, loadChats, oneLine, currentOpener as opener, phoneOf, prettyPhone, resetData, search, vcard, type Chat, type Hit, type Person } from "./data.ts";
import { SECTION_ROWS, initialIcon, render as renderBar, type BarRow, type BarState } from "./view.ts";

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
  if (e instanceof RateLimited) return [hint("limit", "OpenWA rate limit reached", `Retry at ${e.until.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, { icon: ICON.alert })];
  log(errorMessage(e));
  return [hint("error", "OpenWA did not answer", errorMessage(e), { icon: ICON.alert })];
}
const pickHint = (id: string): Effect | void => (id === "hint:key" || id === "hint:auth" || id === "hint:unreachable" || id === "hint:session" ? { open: SETTINGS_URL } : undefined);
const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };
const SEND_OFF = "Turn on send under Settings › Extensions › WhatsApp";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The row's mark: the profile picture, the group glyph (tinted by the tile), else the initial on a tile. */
const chatIcon = (c: Chat) => (c.avatar ? { image: c.avatar } : c.group ? ICON.group : initialIcon(c.name));

function chatActions(c: Chat): Action[] {
  const send = canSend();
  return [
    { id: "open", title: c.group ? "Open WhatsApp" : "Open chat" },
    c.unread > 0 ? { id: "read", title: "Mark as read", shortcut: "cmd+enter", multi: true } : { id: "unread", title: "Mark as unread", shortcut: "cmd+enter", multi: true },
    ...(send ? [{ id: "reply", title: "Send a message", shortcut: "cmd+shift+r" }, { id: "react", title: "React to the latest message", shortcut: "cmd+shift+e" }] : []),
    { id: "web", title: "Open in the web client", shortcut: "cmd+shift+o" },
    c.group ? { id: "copy-name", title: "Copy name", shortcut: "cmd+c" } : { id: "copy-number", title: "Copy number", shortcut: "cmd+c" },
  ];
}

function chatAccessories(c: Chat): Accessory[] {
  const a: Accessory[] = [];
  if (c.group) a.push({ tag: "group", color: "grey" });
  if (c.unread > 0) a.push({ tag: String(c.unread), color: "green" });
  if (c.at) a.push({ date: c.at });
  return a;
}

/** A chat as a row: the picture, the name, the newest message with its sender, the group tag, the unread count, the time. */
function chatRow(c: Chat, section?: string): Item {
  return {
    id: c.id,
    name: c.name,
    subtitle: c.last ? truncate(oneLine(c.last), 110) : c.group ? "Group" : undefined,
    icon: chatIcon(c),
    keywords: [c.group ? "group" : "chat", ...(c.who && c.who !== "You" && c.who !== c.name ? [c.who] : [])],
    section,
    accessories: chatAccessories(c),
    actions: chatActions(c),
  };
}

/** The pane: the last twenty messages as a conversation (the sender in bold, "You" for yours, the time, a quoted reply as a blockquote, media as a bracketed label), then the chat's facts. */
async function chatPane(c: Chat): Promise<Detail> {
  const msgs = await conversation(c, PANE_MSGS);
  const phone = c.group ? undefined : await phoneOf(c.id).catch(() => undefined);
  const metadata: Metadata[] = [
    { label: "Chat", value: c.name },
    { label: "Kind", value: c.group ? "Group" : "Direct message" },
    ...(c.unread > 0 ? [{ label: "Unread", value: plural(c.unread, "message") }] : []),
    ...(phone ? [{ label: "Phone", value: prettyPhone(phone) }] : []),
    ...(c.at ? [{ label: "Newest", value: clock(c.at) }] : []),
    { label: "Open", link: { text: "In the web client", href: chatLink(phone, "web") } },
  ];
  return { markdown: msgs.length ? conversationMarkdown(msgs) : "_No messages the gateway can see; the conversation is on the phone._", metadata };
}

/** Every chat the pick is for: the marked rows, else the one. */
const idsOf = (id: string, ctx?: Ctx) => (ctx?.ids?.length ? ctx.ids : [id]);

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
    case "reply":
      if (!canSend()) return toast("Sending is off", SEND_OFF, "failure");
      await latestOf(c).catch(() => undefined);
      return { form: messageForm(c) };
    case "send": {
      if (!canSend()) return toast("Sending is off", SEND_OFF, "failure");
      const text = String(ctx?.values?.text ?? "").trim();
      const quote = ctx?.values?.quote === true;
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

async function chatRows(ctx?: Ctx): Promise<Item[]> {
  const list = await loadChats(!!ctx?.refresh);
  if (!list.length) return [hint("empty", "No chats", "The session lists no chats yet; the phone's chats appear once WhatsApp Web has loaded them")];
  return list.map((c) => chatRow(c, c.unread > 0 ? "Unread" : "Recent"));
}

async function unreadRows(ctx?: Ctx): Promise<Item[]> {
  const list = (await loadChats(!!ctx?.refresh)).filter((c) => c.unread > 0);
  if (!list.length) return [hint("none", "Nothing unread", "Every chat is read", { icon: ICON.read })];
  return list.map((c) => chatRow(c, c.group ? "Groups" : "Direct messages"));
}

const pickChatRow = async (id: string, action?: string, ctx?: Ctx): Promise<Effect | void> => (id.startsWith("hint:") ? pickHint(id) : pickChat(await chat(id), action, ctx));
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
    actions: [{ id: "open", title: "Open chat" }, { id: "copy", title: "Copy message", shortcut: "cmd+c" }, { id: "web", title: "Open in the web client", shortcut: "cmd+shift+o" }],
  };
}

async function searchRows(query = ""): Promise<Item[]> {
  const q = query.trim();
  if (q.length < 2) return [hint("search", "Search WhatsApp", "Words from any message in the archive, back to the first chat", { icon: ICON.search })];
  // A newer keystroke supersedes this one: wait a beat, and answer the last rows if one came.
  const seq = ++searchSeq;
  await Bun.sleep(SEARCH_WAIT_MS);
  if (seq !== searchSeq) return lastSearch;
  let found: Hit[];
  try { found = await search(q); } catch (e) {
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
  return {
    id: p.id,
    name: p.name,
    subtitle: prettyPhone(p.phone),
    icon: initialIcon(p.name),
    keywords: [p.phone, prettyPhone(p.phone)],
    actions: [
      { id: "open", title: "Open chat" },
      { id: "copy-number", title: "Copy number", shortcut: "cmd+c" },
      { id: "copy-vcard", title: "Copy as vCard", shortcut: "cmd+shift+c" },
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
 * among them (`dm_urgent`), hidden at zero unless `unread_only_bar` is
 * off (then the glyph stays as a way into the popover, which lists the
 * recent chats). The popover is a view of the item's own (view.ts):
 * direct messages then groups, a cursor the arrows move and a click
 * sets, the keys as hints; Enter opens the focused chat, `m` marks it
 * read, `a` every listed one, `r` (send on) turns the search row into a
 * message field whose Enter sends, `o` opens WhatsApp, `p` the Unread
 * palette. The cursor and the field live here between renders. No key
 * set is hidden, not an error: the strip has no room for a hint. Any
 * other failure throws, which the core draws as stale.
 */
let barFocus: string | undefined, barReplying: string | undefined, barDraft: string | undefined;

async function barRows(list: Chat[]): Promise<BarRow[]> {
  const unread = list.filter((c) => c.unread > 0);
  const picked = unread.length ? [...unread.filter((c) => !c.group).slice(0, SECTION_ROWS), ...unread.filter((c) => c.group).slice(0, SECTION_ROWS)] : list.slice(0, SECTION_ROWS);
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
  try { list = await loadChats(ctx.reason === "cli" || ctx.reason === "update"); } catch (e) {
    if (e instanceof NoKey) return { hidden: true };
    throw e;
  }
  const unread = list.filter((c) => c.unread > 0);
  const direct = unread.filter((c) => !c.group).length, groups = unread.length - direct;
  if (!unread.length && conf().unread_only_bar !== false) return { hidden: true };
  const parts = [direct ? plural(direct, "direct message") : "", groups ? plural(groups, "group") : ""].filter(Boolean);
  return {
    icon: ICON.whatsapp,
    ...(unread.length && { badge: unread.length }),
    urgent: conf().dm_urgent !== false && direct > 0,
    tooltip: unread.length ? `${plural(unread.length, "chat")} unread: ${parts.join(", ")}` : "Nothing unread",
    menu: { view: renderBar(await barState(list)) },
  };
}

/** The popover drawn again from the list at hand (no fetch): what a key that only moves the cursor answers. */
const redraw = async (): Promise<Effect> => ({ view: renderBar(await barState(await loadChats())) });

async function unreadAction(action: string, ctx?: BarCtx): Promise<Effect> {
  if (action === "open-pal") return { push: { extension: "whatsapp", palette: "unread" } };
  if (action === "open-whatsapp") return { open: chatLink(undefined, opener()) };
  if (action === "read-all") {
    const refused: string[] = [];
    for (const c of (await loadChats()).filter((c) => c.unread > 0)) { try { await markChatRead(c.id); } catch (e) { refused.push(c.name); log(`read ${c.id}: ${errorMessage(e)}`); } }
    dropChats();
    return refused.length ? toast("Some could not be marked", refused.join(", "), "failure") : { keep: true, hud: "Marked read" };
  }
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return redraw(); }
  const st = await barState(await loadChats());
  const cur = st.rows[st.focus];
  switch (action) {
    case "down": case "up": {
      if (!st.rows.length) return redraw();
      barFocus = st.rows[(st.focus + (action === "down" ? 1 : st.rows.length - 1)) % st.rows.length].id;
      return redraw();
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
      if (!cur || cur.n === 0) return { keep: true };
      try { await markChatRead(cur.id); } catch (e) { return failed("mark read", e); }
      dropChats();
      return { keep: true, hud: `${cur.name}: read` };
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
      list: (_q, ctx) => guard(() => unreadRows(ctx)),
      pick: pickChatRow,
      detail: paneOf,
    },
    search: {
      title: "Search WhatsApp",
      input: true,
      placeholder: "Words from any message",
      list: (query) => guard(() => searchRows(query)),
      pick: (id, action) => {
        if (id.startsWith("hint:")) return pickHint(id);
        const h = hits.get(id);
        if (!h) throw new Error(`no message ${id}`);
        return pickHit(h, action);
      },
      detail: async (id) => { const h = hits.get(id); if (!h) return; try { return await chatPane(await chat(h.chatId)); } catch (e) { return { markdown: `_${errorMessage(e)}_` }; } },
    },
    contacts: {
      title: "Contacts",
      lazy: true,
      placeholder: "A name or a number",
      list: (_q, ctx) => guard(() => contactRows(ctx)),
      pick: (id, action) => (id.startsWith("hint:") ? pickHint(id) : pickPerson(id, action)),
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
