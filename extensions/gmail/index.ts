// Gmail, one instance per account: five palettes and a bar item over one
// client (api.ts) and one data layer (data.ts). Inbox is live and lazy and
// the bar item draws from the same inbox (shared for INBOX_FRESH_MS so
// the panel showing and the bar refreshing on it cost one read); Search
// Mail is an input palette over Gmail's own query syntax; Labels is an
// hourly catalog; Compose and Drafts exist only where `send` is on for
// the account. Every row id is the message id, so a pick after a restart
// still finds it with one `messages.get`.
import { bytes, clock, dayNameYear, errorMessage, failed, hint, instance, settings, toast, TokenError, truncate, type Accessory, type Action, type BarCtx, type BarItem, type BarMenuNode, type Ctx, type Detail, type Effect, type Extension, type Form, type Item, type Metadata } from "@zcag/pal";
import { ApiError, RateLimited, conf, log, send as apiSend, draftDelete, draftSend } from "./api.ts";
import { initialIcon } from "./avatar.ts";
import { address, addressNow, archive, drafts, inbox, labelNames, labels, mail, markRead, markUnread, open, reset, search, star, type DraftRow, type Inbox, type Mail } from "./data.ts";
import { buildRaw, displayName, draftUrl, gmailBase, labelQuery, labelTitle, labelUrl, mdEscape, messageText, quoted, replySubject, sectionOf, threadUrl, withSignature } from "./mail.ts";

/** Glyphs from the bundled Nerd Font's `md-` set: email, email-open, email-edit, file-send-outline, label, label-outline, inbox, star, alert, magnify, tag, send, trash-can-outline, open-in-new, alert-circle-outline, flag, tag-multiple-outline. */
const ICON = { mail: "\u{f01ee}", open: "\u{f01ef}", compose: "\u{f0ee3}", draft: "\u{f1039}", label: "\u{f0315}", labelOutline: "\u{f0316}", inbox: "\u{f0687}", star: "\u{f04ce}", alert: "\u{f0026}", search: "\u{f0349}", tag: "\u{f04f9}", send: "\u{f048a}", trash: "\u{f0a7a}", browser: "\u{f03cc}", sent: "\u{f048a}", spam: "\u{f05d6}", important: "\u{f023b}", category: "\u{f12f7}" } as const;
const SYSTEM_GLYPH: Record<string, string> = { INBOX: ICON.inbox, STARRED: ICON.star, IMPORTANT: ICON.important, SENT: ICON.sent, DRAFT: ICON.draft, SPAM: ICON.spam, TRASH: ICON.trash, UNREAD: ICON.mail };
/** How long an inbox is shared between the bar and the palette before either fetches again. */
const INBOX_FRESH_MS = 30_000;
const SEARCH_WAIT_MS = 300;
/** Rows in the bar's popover. */
const BAR_ROWS = 5;
const MAX_CHIPS = 2;

// ---- the inbox, shared ------------------------------------------------------------

let last: Inbox | undefined;
let loading: Promise<Inbox> | undefined;

/** The inbox, fetched unless one younger than `INBOX_FRESH_MS` is at hand (or `refresh`); one fetch at a time. */
function loadInbox(refresh = false): Promise<Inbox> {
  if (!refresh && last && Date.now() - last.at < INBOX_FRESH_MS) return Promise.resolve(last);
  loading ??= inbox().then((i) => (last = i)).finally(() => { loading = undefined; });
  return loading;
}
const dropInbox = () => { last = undefined; };
// New settings may mean another account or another token: nothing cached applies.
settings.onChange(() => { dropInbox(); reset(); }, "gmail");

const canSend = () => conf().send === true;

// ---- rows the palettes share ------------------------------------------------------

const SETTINGS_ACTION: Action[] = [{ id: "settings", title: "Open Gmail settings" }];

/** What a failed listing shows instead of rows: the token command's complaint, when the limit lifts, or what went wrong. */
function failure(e: unknown): Item[] {
  if (e instanceof TokenError) return [hint("token", conf().token_command?.trim() ? "Token command failed" : "Token command is not set", conf().token_command?.trim() ? e.message : "Set one under Settings › Extensions › Gmail: a command that prints an access token", { actions: SETTINGS_ACTION, icon: ICON.alert })];
  if (e instanceof RateLimited) return [hint("limit", "Gmail rate limit reached", `Retry at ${clock(e.until)}`, { icon: ICON.alert })];
  if (e instanceof ApiError && e.auth) return [hint("auth", "Gmail rejected the token", `${e.message}: check the token command's scopes under Settings › Extensions › Gmail`, { actions: SETTINGS_ACTION, icon: ICON.alert })];
  log(errorMessage(e));
  return [hint("error", "Gmail did not answer", errorMessage(e), { icon: ICON.alert })];
}
// The settings link lands on this instance's token command (`?anchor=`, docs/links.md), so a second account's hint opens its own row.
const pickHint = (id: string): Effect | void => (id === "hint:token" || id === "hint:auth" ? { open: `pal://settings/extensions?anchor=extensions:${instance().key}:token_command` } : undefined);
const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const who = (m: Mail) => displayName(m.from);
const addrLine = (a: { name: string; email: string }) => (a.name ? `${a.name} <${a.email}>` : a.email);

/** The user labels on a message, by name, in the message's order. */
function userLabels(m: Mail): string[] {
  const names = labelNames();
  return m.labelIds.filter((id) => !/^[A-Z_]+$/.test(id)).map((id) => names.get(id)).filter((n): n is string => !!n);
}

function mailAccessories(m: Mail): Accessory[] {
  const a: Accessory[] = [];
  for (const l of userLabels(m).slice(0, MAX_CHIPS)) a.push({ tag: l, color: "grey" });
  if (m.starred) a.push({ tag: "★", color: "amber" });
  if (m.attached) a.push({ text: "📎" });
  if (m.date) a.push({ date: m.date });
  return a;
}

function mailActions(m: Mail): Action[] {
  const send = canSend();
  return [
    { id: "open", title: "Open in Gmail" },
    m.unread ? { id: "read", title: "Mark as read", shortcut: "cmd+enter", multi: true } : { id: "unread", title: "Mark as unread", shortcut: "cmd+enter", multi: true },
    ...(send && m.inInbox ? [{ id: "archive", title: "Archive", shortcut: "cmd+e", multi: true } as Action] : []),
    ...(send ? [{ id: m.starred ? "unstar" : "star", title: m.starred ? "Unstar" : "Star", shortcut: "cmd+s" } as Action] : []),
    ...(send ? [{ id: "reply", title: "Reply", shortcut: "cmd+shift+r" } as Action] : []),
    { id: "copy", title: "Copy link", shortcut: "cmd+c" },
  ];
}

/** The instance's title rides in the keywords, so `work invoice` finds the row at the root; the root's section header names it, so no chip repeats it. */
function mailRow(m: Mail, section?: string): Item {
  const title = instance().title;
  return {
    id: m.id,
    name: m.subject || "(no subject)",
    subtitle: truncate([who(m), m.snippet].filter(Boolean).join(" · "), 120),
    icon: m.icon ?? initialIcon(who(m), m.from.email),
    keywords: [m.from.name, m.from.email, ...userLabels(m), ...(title ? [title] : [])].filter(Boolean),
    section,
    accessories: mailAccessories(m),
    actions: mailActions(m),
  };
}

/** The pane: the message as text (quotes folded), then who, when, the labels, the attachments, the link. */
async function mailPane(id: string): Promise<Detail> {
  const o = await open(id);
  const m = o.mail;
  const metadata: Metadata[] = [
    { label: "From", value: addrLine(m.from) },
    ...(m.to.length ? [{ label: "To", value: m.to.map(addrLine).join(", ") }] : []),
    ...(m.cc.length ? [{ label: "Cc", value: m.cc.map(addrLine).join(", ") }] : []),
    { label: "Date", value: m.date ? `${dayNameYear(m.date)} ${clock(m.date)}` : m.dateHeader },
    ...(userLabels(m).length || m.starred ? [{ label: "Labels", tags: [...userLabels(m).map((l) => ({ text: l })), ...(m.starred ? [{ text: "starred", color: "amber" }] : [])] }] : []),
    ...(o.attachments.length ? [{ label: plural(o.attachments.length, "Attachment"), value: o.attachments.map((a) => `${a.filename} (${bytes(a.size)})`).join(", ") }] : []),
    { label: "Thread", link: { text: "Open in Gmail", href: threadUrl(await address(), m.threadId, m.inInbox) } },
  ];
  const text = messageText(o.text, o.html, m.snippet);
  return { markdown: text ? mdEscape(text) : "_(no text)_", metadata };
}

const replyForm = (m: Mail, errors?: Record<string, string>, values: Partial<Record<"to" | "cc" | "subject" | "body", string>> = {}): Form => ({
  id: m.id,
  title: `Reply to ${who(m)}`,
  fields: [
    { kind: "text", id: "to", label: "To", required: true, default: values.to ?? addrLine(m.replyTo) },
    { kind: "text", id: "cc", label: "Cc", default: values.cc ?? "", placeholder: "Comma-separated" },
    { kind: "text", id: "subject", label: "Subject", required: true, default: values.subject ?? replySubject(m.subject) },
    { kind: "textarea", id: "body", label: "Message", required: true, default: values.body ?? "", placeholder: "The original is quoted under your reply", description: conf().signature?.trim() ? "Your signature goes under it" : undefined },
  ],
  submit: { id: "send", title: "Send" },
  errors,
});

const values = (ctx?: Ctx) => ({ to: String(ctx?.values?.to ?? "").trim(), cc: String(ctx?.values?.cc ?? "").trim(), subject: String(ctx?.values?.subject ?? "").trim(), body: String(ctx?.values?.body ?? "").trim() });

async function pickMail(m: Mail, action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const ids = ctx?.ids?.length ? ctx.ids : [m.id];
  const n = ids.length;
  switch (action) {
    case "copy": return { copy: threadUrl(await address(), m.threadId, m.inInbox) };
    case "read":
      try { await markRead(ids); } catch (e) { return failed("mark read", e); }
      dropInbox();
      return toast("Marked read", n > 1 ? plural(n, "message") : m.subject || "(no subject)");
    case "unread":
      try { await markUnread(ids); } catch (e) { return failed("mark unread", e); }
      dropInbox();
      return toast("Marked unread", n > 1 ? plural(n, "message") : m.subject || "(no subject)");
    case "archive":
      if (!canSend()) return toast("Archive is off", "Turn on send for this account under Settings › Extensions › Gmail", "failure");
      try { await archive(ids); } catch (e) { return failed("archive", e); }
      dropInbox();
      return toast("Archived", n > 1 ? plural(n, "message") : m.subject || "(no subject)");
    case "star": case "unstar":
      if (!canSend()) return toast("Star is off", "Turn on send for this account under Settings › Extensions › Gmail", "failure");
      try { await star([m.id], action === "star"); } catch (e) { return failed(action === "star" ? "star" : "unstar", e); }
      dropInbox();
      return toast(action === "star" ? "Starred" : "Unstarred", m.subject || "(no subject)");
    case "reply":
      if (!canSend()) return toast("Reply is off", "Turn on send for this account under Settings › Extensions › Gmail", "failure");
      return { form: replyForm(m) };
    case "send": {
      if (!canSend()) return toast("Reply is off", "Turn on send for this account under Settings › Extensions › Gmail", "failure");
      const v = values(ctx);
      const errors: Record<string, string> = {};
      if (!v.to) errors.to = "Required";
      if (!v.subject) errors.subject = "Required";
      if (!v.body) errors.body = "Required";
      if (Object.keys(errors).length) return { form: replyForm(m, errors, v) };
      try {
        const [from, o] = await Promise.all([address(), open(m.id)]);
        const text = `${withSignature(v.body, conf().signature ?? "")}\n\n${quoted(m.dateHeader || new Date(m.date).toUTCString(), addrLine(m.from), messageText(o.text, o.html, m.snippet))}`;
        await apiSend(buildRaw({ from, to: v.to, cc: v.cc, subject: v.subject, text, inReplyTo: m.messageId || undefined, references: [m.references, m.messageId].filter(Boolean).join(" ") || undefined }), m.threadId);
      } catch (e) { return { form: replyForm(m, { body: errorMessage(e) }, v) }; }
      return toast("Sent", `Reply to ${who(m)}: ${truncate(v.subject, 60)}`);
    }
    default: return { open: threadUrl(await address(), m.threadId, m.inInbox) };
  }
}

// ---- inbox ---------------------------------------------------------------------------

async function inboxRows(ctx?: Ctx): Promise<Item[]> {
  const i = await loadInbox(!!ctx?.refresh);
  const rows = [...i.unread.map((m) => mailRow(m, "Unread")), ...i.recent.map((m) => mailRow(m, "Recent")), ...i.extra.flatMap((e) => e.mails.map((m) => mailRow(m, e.label)))];
  return rows.length ? rows : [hint("empty", "The inbox is empty", "Nothing in the inbox yet; Search Mail reaches the rest")];
}

// ---- search --------------------------------------------------------------------------

let searchSeq = 0;
let lastSearch: Item[] = [];

async function searchRows(query = ""): Promise<Item[]> {
  const q = query.trim();
  if (q.length < 2) return [hint("search", "Search Mail", "Text, from:name, subject:word, has:attachment, newer_than:7d, label:name", { icon: ICON.search })];
  // A newer keystroke supersedes this one: wait a beat, and answer the last rows if one came.
  const seq = ++searchSeq;
  await Bun.sleep(SEARCH_WAIT_MS);
  if (seq !== searchSeq) return lastSearch;
  const found = await search(q);
  const names = labelNames();
  lastSearch = found.length ? found.map((m) => mailRow(m, sectionOf(m.labelIds, names))) : [hint("empty", "No messages found", `Nothing matches "${q}"`, { icon: ICON.search })];
  return lastSearch;
}

// ---- labels ----------------------------------------------------------------------------

async function labelRows(ctx?: Ctx): Promise<Item[]> {
  const all = await labels(!!ctx?.refresh);
  const user = all.filter((l) => l.type !== "system").sort((a, b) => a.name.localeCompare(b.name));
  const order = ["INBOX", "STARRED", "IMPORTANT", "SENT", "DRAFT", "SPAM", "TRASH"];
  const system = all.filter((l) => l.type === "system" && order.includes(l.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const categories = all.filter((l) => l.id.startsWith("CATEGORY_")).sort((a, b) => a.id.localeCompare(b.id));
  const row = (l: { id: string; name: string }, section: string, icon: string): Item => ({
    id: `label:${l.id}`,
    name: labelTitle(l.id, l.name),
    subtitle: l.id.startsWith("CATEGORY_") ? "Category" : undefined,
    icon,
    keywords: [l.name, "label"],
    section,
    actions: [{ id: "open", title: "Open in Gmail" }, { id: "search", title: "Search label", shortcut: "cmd+enter" }, { id: "copy", title: "Copy name", shortcut: "cmd+c" }],
  });
  const rows = [...user.map((l) => row(l, "Labels", ICON.labelOutline)), ...system.map((l) => row(l, "Gmail", SYSTEM_GLYPH[l.id] ?? ICON.label)), ...categories.map((l) => row(l, "Gmail", ICON.category))];
  return rows.length ? rows : [hint("none", "No labels", "Gmail listed none for this account")];
}

async function pickLabel(id: string, action?: string): Promise<Effect> {
  const lid = id.slice(6);
  const l = (await labels()).find((l) => l.id === lid);
  if (!l) throw new Error(`no label ${lid}`);
  if (action === "search") return { push: { extension: "gmail", palette: "search", query: `${labelQuery(l.id, l.name)} ` } };
  if (action === "copy") return { copy: l.name };
  return { open: labelUrl(await address(), l.id, l.name) };
}

// ---- compose -----------------------------------------------------------------------------

const composeForm = (errors?: Record<string, string>, v: Partial<Record<"to" | "cc" | "subject" | "body", string>> = {}): Form => ({
  id: "compose",
  title: `New message from ${addressNow() || "Gmail"}`,
  fields: [
    { kind: "text", id: "to", label: "To", required: true, default: v.to ?? "", placeholder: "name@example.com, another@example.com" },
    { kind: "text", id: "cc", label: "Cc", default: v.cc ?? "", placeholder: "Comma-separated" },
    { kind: "text", id: "subject", label: "Subject", required: true, default: v.subject ?? "" },
    { kind: "textarea", id: "body", label: "Message", required: true, default: v.body ?? withSignature("", conf().signature ?? "") },
  ],
  submit: { id: "send", title: "Send" },
  errors,
});

async function composeRows(): Promise<Item[]> {
  if (!canSend()) return [];
  const from = await address().catch(() => "");
  return [{ id: "compose", name: "Compose", subtitle: from ? `New message from ${from}` : "New message", icon: ICON.compose, keywords: ["new", "mail", "email", "write", ...(instance().title ? [instance().title!] : [])], actions: [{ id: "new", title: "Compose" }] }];
}

async function pickCompose(action: string | undefined, ctx?: Ctx): Promise<Effect> {
  if (!canSend()) return toast("Compose is off", "Turn on send for this account under Settings › Extensions › Gmail", "failure");
  if (action !== "send") return { form: composeForm() };
  const v = values(ctx);
  const errors: Record<string, string> = {};
  if (!v.to) errors.to = "Required";
  if (!v.subject) errors.subject = "Required";
  if (!v.body) errors.body = "Required";
  if (Object.keys(errors).length) return { form: composeForm(errors, v) };
  try {
    // The form carried the signature already (its default); a body typed over it gets it once, not twice.
    const sig = conf().signature?.trim() ?? "";
    const text = sig && v.body.endsWith(sig) ? v.body : withSignature(v.body, sig);
    await apiSend(buildRaw({ from: await address(), to: v.to, cc: v.cc, subject: v.subject, text }));
  } catch (e) { return { form: composeForm({ body: errorMessage(e) }, v) }; }
  return { toast: { title: "Sent", message: `To ${truncate(v.to, 40)}: ${truncate(v.subject, 60)}`, style: "success" } };
}

// ---- drafts ----------------------------------------------------------------------------------

const draftRows_ = new Map<string, DraftRow>();

async function draftRows(): Promise<Item[]> {
  if (!canSend()) return [];
  const list = await drafts();
  draftRows_.clear();
  if (!list.length) return [hint("none", "No drafts", "Compose writes a message straight away; drafts are Gmail's own", { icon: ICON.draft })];
  return list.map((d) => {
    draftRows_.set(d.draftId, d);
    const to = d.mail.to.map(displayName).join(", ");
    return {
      id: d.draftId,
      name: d.mail.subject || "(no subject)",
      subtitle: truncate([to ? `To ${to}` : "No recipient", d.mail.snippet].filter(Boolean).join(" · "), 120),
      icon: ICON.draft,
      keywords: [...d.mail.to.map((a) => a.email), "draft"],
      accessories: d.mail.date ? [{ date: d.mail.date }] : [],
      actions: [
        { id: "open", title: "Open in Gmail" },
        { id: "send", title: "Send draft", shortcut: "cmd+enter", confirm: `Send "${d.mail.subject || "(no subject)"}" to ${to || "no one"}?` },
        { id: "discard", title: "Discard draft", shortcut: "cmd+d", style: "destructive", confirm: `Discard "${d.mail.subject || "(no subject)"}"?` },
      ],
    } satisfies Item;
  });
}

async function pickDraft(id: string, action?: string): Promise<Effect> {
  if (!canSend()) return toast("Drafts are off", "Turn on send for this account under Settings › Extensions › Gmail", "failure");
  if (!draftRows_.has(id)) await draftRows();
  const d = draftRows_.get(id);
  if (!d) throw new Error(`no draft ${id}`);
  if (action === "send") {
    try { await draftSend(id); } catch (e) { return failed("send", e); }
    return toast("Sent", d.mail.subject || "(no subject)");
  }
  if (action === "discard") {
    try { await draftDelete(id); } catch (e) { return failed("discard", e); }
    return toast("Discarded", d.mail.subject || "(no subject)");
  }
  return { open: draftUrl(await address(), d.mail.threadId) };
}

// ---- the bar item ----------------------------------------------------------------------------

/**
 * The inbox's unread count as the badge, hidden at zero, the account's
 * title beside the glyph when it has one (two accounts read apart on
 * the strip); the popover: the newest five unread, each a submenu with
 * Open in Gmail and Mark as read, then Open in pal (the Inbox palette)
 * and Open Gmail. No token is hidden, not an error: the strip has no
 * room for a hint. A failed fetch throws, which the core draws as stale.
 */
async function unreadItem(ctx: BarCtx): Promise<BarItem> {
  let i: Inbox;
  try { i = await loadInbox(ctx.reason === "cli" || ctx.reason === "update"); } catch (e) {
    if (e instanceof TokenError) return { hidden: true };
    throw e;
  }
  if (i.count === 0) return { hidden: true };
  const title = ctx.instance?.title?.trim();
  const addr = addressNow();
  const menu: BarMenuNode[] = [
    {
      type: "section",
      title: "Unread",
      children: i.unread.slice(0, BAR_ROWS).map((m) => ({
        type: "submenu",
        title: truncate(`${who(m)}: ${m.subject || "(no subject)"}`, 60),
        icon: m.icon ?? initialIcon(who(m), m.from.email),
        children: [
          { type: "item", id: `open:${m.id}`, title: "Open in Gmail", subtitle: truncate(m.snippet, 70) || undefined, icon: ICON.browser },
          { type: "item", id: `read:${m.id}`, title: "Mark as read", icon: ICON.open },
        ],
      })),
    },
    { type: "separator" },
    { type: "item", id: "open-pal", title: "Open in pal", subtitle: `${plural(i.count, "unread message")}, Mark as read and more`, icon: ICON.inbox },
    { type: "item", id: "open-gmail", title: "Open Gmail", subtitle: addr || undefined, icon: ICON.mail },
  ];
  return {
    icon: ICON.mail,
    ...(title && { title }),
    badge: i.count,
    tooltip: `${plural(i.count, "unread message")}${addr ? ` in ${addr}` : ""}`,
    menu,
  };
}

async function unreadAction(action: string): Promise<Effect> {
  if (action === "open-pal") return { push: { extension: "gmail", palette: "inbox" } };
  if (action === "open-gmail") return { open: `${gmailBase(await address())}#inbox` };
  const m = action.match(/^(open|read):(.+)$/);
  if (!m) throw new Error(`no action ${action}`);
  const row = await mail(m[2]);
  if (m[1] === "read") {
    const r = await pickMail(row, "read");
    return r.toast?.style === "failure" ? r : { keep: true, hud: "Marked read" };
  }
  return pickMail(row, "open");
}

// ---- the extension ----------------------------------------------------------------------------

const pickRow = async (id: string, action?: string, ctx?: Ctx): Promise<Effect | void> => (id.startsWith("hint:") ? pickHint(id) : pickMail(await mail(id), action, ctx));
const paneOf = async (id: string): Promise<Detail | void> => { if (id.startsWith("hint:")) return; try { return await mailPane(id); } catch (e) { return { markdown: `_${errorMessage(e)}_` }; } };

export default {
  palettes: {
    inbox: {
      title: "Inbox ({instance})",
      live: true,
      lazy: true,
      list: (_q, ctx) => guard(() => inboxRows(ctx)),
      pick: pickRow,
      detail: paneOf,
    },
    search: {
      title: "Search Mail ({instance})",
      input: true,
      placeholder: "Text, from:name, subject:word, has:attachment, newer_than:7d",
      list: (query) => guard(() => searchRows(query)),
      pick: pickRow,
      detail: paneOf,
    },
    labels: {
      title: "Labels ({instance})",
      lazy: true,
      list: (_q, ctx) => guard(() => labelRows(ctx)),
      pick: (id, action) => (id.startsWith("hint:") ? pickHint(id) : pickLabel(id, action)),
    },
    compose: {
      title: "Compose ({instance})",
      list: () => guard(composeRows),
      pick: (id, action, ctx) => (id.startsWith("hint:") ? pickHint(id) : pickCompose(action, ctx)),
    },
    drafts: {
      title: "Drafts ({instance})",
      live: true,
      lazy: true,
      list: () => guard(draftRows),
      pick: (id, action) => (id.startsWith("hint:") ? pickHint(id) : pickDraft(id, action)),
    },
  },
  bar: {
    unread: { render: unreadItem, onAction: unreadAction },
  },
} satisfies Extension;
