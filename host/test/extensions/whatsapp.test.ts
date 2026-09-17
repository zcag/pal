// WhatsApp: data.ts's pure parts by import (the media labels, a message
// from the live and the archive shapes, the links, the opener, the vCard,
// the phone spelling) and view.ts's tree from a state; then the extension
// through the harness against whatsapp-mock.ts (a Bun mock of OpenWA):
// the session resolved once from its name and kept in storage, the chat
// rows with their pictures, the unread run's sender, the pane as a
// conversation, the unread palette, the search (and its 503), the
// contacts, mark read and unread against the mock, every send refused
// with `send` off and made with it on (a message, a quoted reply, a
// reaction), the bar item and its popover keys, the links, a 401, a 429,
// a session that is not ready, an unreachable gateway, no key.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chatLink, conversationMarkdown, mediaLabel, msgOf, msgOfDb, opener, pictureExpiry, pictureFresh, prettyPhone, REACTIONS, vcard } from "../../../extensions/whatsapp/data.ts";
import { initial, initialIcon, render, type BarState } from "../../../extensions/whatsapp/view.ts";
import type { Item, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";
import { KEY, SESSION_ID, WhatsAppMock, m } from "./whatsapp-mock.ts";

const X = "whatsapp";
const MARA = "254011223344556@lid", HIKE = "120363012345678901@g.us", TOMAS = "905559876543@c.us", FAMILY = "120363099887766554@g.us", OLA = "905551112233@c.us", LINA = "301122334455667@lid";

const nodes = (n: ViewNode): ViewNode[] => [n, ...("children" in n ? n.children.flatMap(nodes) : [])];
const texts = (v: View) => nodes(v.tree).flatMap((n) => (n.type === "text" ? [n.value] : []));
const keycaps = (v: View) => nodes(v.tree).flatMap((n) => (n.type === "keycap" ? [n.keys] : []));
const viewOf = (x: unknown): View => {
  const o = x as { view?: View; menu?: { view?: View } };
  const v = o.view ?? o.menu?.view;
  if (!v) throw new Error("no view");
  return v;
};
const tags = (i: Item) => (i.accessories ?? []).flatMap((a) => ("tag" in a ? [a.tag] : []));

describe("whatsapp helpers", () => {
  test("mediaLabel: text as is, media in brackets with the caption or file name after it", () => {
    expect(mediaLabel("text", " hi ")).toBe("hi");
    expect(mediaLabel("chat", "hi")).toBe("hi");
    expect(mediaLabel("image", "")).toBe("[photo]");
    expect(mediaLabel("image", "look")).toBe("[photo] look");
    expect(mediaLabel("ptt", "")).toBe("[voice message]");
    expect(mediaLabel("document", "cv.pdf")).toBe("[document] cv.pdf");
    expect(mediaLabel("revoked", "")).toBe("[message deleted]");
    expect(mediaLabel("poll_creation", "")).toBe("[poll]");
    expect(mediaLabel("some_new_kind", "")).toBe("[some new kind]");
    expect(mediaLabel("unknown", "")).toBe("[message]");
    expect(mediaLabel("unknown", "a template")).toBe("a template");
  });

  test("msgOf: the live shape with the archive's row over it (name, quote); msgOfDb: the archive alone; You for what is ours", () => {
    const names = (jid: string) => (jid === "905551112233@c.us" ? "Ola Berg" : jid.split("@")[0]);
    const live = { id: "m1", from: "g@g.us", to: "me@c.us", chatId: "g@g.us", body: "trailhead at 8:30", type: "text", timestamp: 1789627000, fromMe: false, isGroup: true, author: "301122334455667@lid" };
    expect(msgOf(live, undefined, names, "Weekend hike")).toEqual({ id: "m1", at: 1789627000000, fromMe: false, who: "301122334455667", text: "trailhead at 8:30", type: "text" });
    const db = { id: "row", waMessageId: "m1", chatId: "g@g.us", chatName: "Lina Kova", from: "g@g.us", to: "me@c.us", body: "trailhead at 8:30", type: "text", direction: "incoming" as const, timestamp: 1789627000, metadata: { quotedMessage: { id: "q", body: "before nine " } } };
    expect(msgOf(live, db, names, "Weekend hike")).toMatchObject({ who: "Lina Kova", quoted: "before nine" });
    expect(msgOf({ ...live, fromMe: true, author: undefined }, db, names, "Weekend hike").who).toBe("You");
    // A direct chat's incoming message is the chat's other side.
    expect(msgOf({ ...live, isGroup: false, author: undefined, from: "905551112233@c.us", chatId: "905551112233@c.us" }, undefined, names, "Ola").who).toBe("Ola Berg");
    expect(msgOf({ ...live, isGroup: false, author: undefined, from: "x@lid", chatId: "x@lid", body: "", type: "image" }, undefined, () => "", "Mara Lind")).toMatchObject({ who: "Mara Lind", text: "[photo]" });
    expect(msgOfDb({ ...db, direction: "outgoing" }, names, "Weekend hike", true)).toMatchObject({ id: "m1", who: "You", quoted: "before nine" });
    expect(msgOfDb({ ...db, chatName: undefined, author: "905551112233@c.us" }, names, "Weekend hike", true).who).toBe("Ola Berg");
  });

  test("conversationMarkdown: the sender in bold with the time, a quote as a blockquote, media in italics, markup escaped", () => {
    const at = Date.parse("2026-09-17T09:41:00+03:00");
    const md = conversationMarkdown([
      { id: "a", at, fromMe: false, who: "Mara *Lind*", text: "see #4471 <now>", type: "text" },
      { id: "b", at, fromMe: true, who: "You", text: "ok", type: "text", quoted: "see #4471\n<now>" },
      { id: "c", at, fromMe: false, who: "Mara", text: "[photo] the cabin", type: "image" },
    ]);
    const paragraphs = md.split("\n\n");
    expect(paragraphs[0]).toMatch(/^\*\*Mara \\\*Lind\\\*\*\* · /);
    expect(paragraphs[1]).toBe("see \\#4471 \\<now\\>");
    expect(paragraphs[2]).toMatch(/^\*\*You\*\* · .+\n> see \\#4471 \\<now\\>$/);
    expect(paragraphs[3]).toBe("ok");
    expect(paragraphs[5]).toBe("_[photo]_ the cabin");
  });

  test("links: the app and the web client, a group at the top, the opener by setting and platform, the vCard, the phone spelling", () => {
    expect(chatLink("+90 555 123 45 67", "app")).toBe("whatsapp://send?phone=905551234567");
    expect(chatLink("905551234567", "web")).toBe("https://web.whatsapp.com/send?phone=905551234567");
    expect(chatLink("905551234567", "web", "hi there")).toBe("https://web.whatsapp.com/send?phone=905551234567&text=hi+there");
    expect(chatLink(undefined, "app")).toBe("whatsapp://");
    expect(chatLink(undefined, "web")).toBe("https://web.whatsapp.com/");
    expect(opener("app", "linux", () => false)).toBe("app");
    expect(opener("web", "darwin", () => true)).toBe("web");
    expect(opener("auto", "darwin", () => true)).toBe("app");
    expect(opener("auto", "darwin", () => false)).toBe("web");
    expect(opener(undefined, "linux", () => true)).toBe("web");
    expect(vcard("Mara Lind", "905551234567")).toBe("BEGIN:VCARD\nVERSION:3.0\nFN:Mara Lind\nTEL;TYPE=CELL:+905551234567\nEND:VCARD");
    expect(prettyPhone("905551234567")).toBe("+90 555 123 45 67");
    expect(prettyPhone("15551234567")).toBe("+1 555 123 45 67");
    expect(prettyPhone("12345")).toBe("+12345");
    expect(initial("+90 555")).toBe("9");
    expect(initial("mara")).toBe("M");
    expect(initialIcon("Mara").image).toMatch(/^data:image\/svg\+xml;utf8,.*%3EM%3C/);
    // A picture url's expiry (`oe`, hex seconds); an entry stands until a day before it, a miss for a day.
    const url = "https://pps.whatsapp.net/v/t61.24694-24/x.jpg?ccb=11-4&oh=abc&oe=6AB81B3B&_nc_sid=5e03e0";
    expect(pictureExpiry(url)).toBe(0x6ab81b3b * 1000);
    expect(pictureExpiry("https://pps.whatsapp.net/x.jpg")).toBeUndefined();
    const now = 0x6ab81b3b * 1000 - 3 * 24 * 3600_000;
    expect(pictureFresh({ u: url, t: 0 }, now)).toBe(true);
    expect(pictureFresh({ u: url, t: 0 }, now + 2.5 * 24 * 3600_000)).toBe(false);
    expect(pictureFresh({ u: null, t: now - 3600_000 }, now)).toBe(true);
    expect(pictureFresh({ u: null, t: now - 25 * 3600_000 }, now)).toBe(false);
    expect(pictureFresh(undefined, now)).toBe(false);
  });

  test("view: the sections, the cursor, the hints, the reply field; nothing unread is one calm line", () => {
    const rows: BarState["rows"] = [
      { id: MARA, name: "Mara Lind", group: false, text: "standup in 20?", time: "09:39", n: 3 },
      { id: HIKE, name: "Weekend hike", group: true, text: "Ola Berg: [location]", time: "09:32", n: 5, avatar: "data:image/svg+xml;base64,PHN2Zy8+" },
    ];
    const v = checkView(render({ rows, focus: 1, canSend: true }));
    expect(v).toMatchObject({ id: "unread", keys: "actions", title: "2 chats unread" });
    expect(texts(v)).toEqual(expect.arrayContaining(["Direct messages", "Groups", "Mara Lind", "standup in 20?", "Weekend hike", "Ola Berg: [location]"]));
    const stacks = nodes(v.tree).filter((n): n is Extract<ViewNode, { type: "stack" }> => n.type === "stack" && !!n.action?.startsWith("focus:"));
    expect(stacks.map((s) => [s.action, !!s.selected])).toEqual([[`focus:${MARA}`, false], [`focus:${HIKE}`, true]]);
    expect(nodes(v.tree).find((n) => n.type === "tile")).toMatchObject({ text: "M", fill: "solid" });
    expect(nodes(v.tree).find((n) => n.type === "image")).toMatchObject({ mask: "circle", alt: "Weekend hike" });
    expect(keycaps(v)).toEqual(["enter", "r", "m", "a", "o", "p"]);
    expect(v.actions.slice(0, 6).map((a) => [a.id, a.shortcut])).toEqual([["open", undefined], ["reply", "r"], ["read", "m"], ["read-all", ["a", "cmd+shift+a"]], ["open-whatsapp", "o"], ["open-pal", "p"]]);
    // Send off: no reply key, no hint.
    const off = checkView(render({ rows, focus: 0, canSend: false }));
    expect(keycaps(off)).toEqual(["enter", "m", "a", "o", "p"]);
    expect(off.actions.map((a) => a.id)).not.toContain("reply");
    // Replying: the field, Send and Cancel first, the hints for them.
    const replying = checkView(render({ rows, focus: 0, canSend: true, replying: MARA, draft: "on my way" }));
    expect(replying.input).toEqual({ value: "on my way", placeholder: "Message Mara Lind", submit: "send", cancel: "cancel" });
    expect(replying.title).toBe("Reply to Mara Lind");
    expect(keycaps(replying)).toEqual(["enter", "escape"]);
    // Recent chats while nothing is unread: no counts, no read keys; no rows at all is the calm line.
    const recent = checkView(render({ rows: rows.map((r) => ({ ...r, n: 0 })), focus: 0, canSend: false }));
    expect(recent.title).toBe("WhatsApp");
    expect(texts(recent)).toEqual(expect.arrayContaining(["Recent", "Recent groups"]));
    expect(keycaps(recent)).toEqual(["enter", "o", "p"]);
    const zero = checkView(render({ rows: [], focus: 0, canSend: false }));
    expect(texts(zero)).toEqual(expect.arrayContaining(["Nothing unread", "Every chat is read"]));
  });
});

describe("whatsapp", () => {
  let mock: WhatsAppMock;
  let host: Host;
  const settings = (extra: Record<string, unknown> = {}) => ({ base_url: mock.url, api_key: KEY, open: "web", ...extra });
  const list = (palette: string, q = "", ctx?: Parameters<Host["list"]>[3]) => host.list(X, palette, q, ctx);
  const ctx = { reason: "open" as const, compact: true as const };

  beforeAll(async () => {
    stored.clear();
    mock = new WhatsAppMock();
    host = await Host.bundled({ settings: { [X]: { settings: settings() } }, timeout: 8000 });
  });
  afterAll(() => { host.kill(); mock.stop(); });

  test("meta: the tile, four palettes (chats live primary with a pane, unread live, search input, contacts an hourly catalog), the bar item, two links, the settings", () => {
    const loaded = host.loaded().find((l) => l.extension === X)!;
    expect(loaded.warnings).toEqual([]);
    expect(loaded.manifest.icon).toEqual({ tile: { glyph: "\u{f05a3}", bg: "green" } });
    expect(loaded.palettes.map((p) => [p.name, p.title, p.live, p.input, p.lazy, p.ttl, p.tier, p.detail])).toEqual([
      ["chats", "Chats", true, false, true, undefined, "primary", "lazy"],
      ["unread", "Unread", true, false, true, undefined, undefined, "lazy"],
      ["search", "Search WhatsApp", false, true, undefined, undefined, undefined, "lazy"],
      ["contacts", "Contacts", false, false, true, 3600, "catalog", undefined],
    ]);
    expect(loaded.bar.map((b) => [b.id, b.refresh?.every])).toEqual([["unread", 120]]);
    expect(Object.keys(loaded.manifest.links ?? {})).toEqual(["open", "search"]);
    expect(loaded.manifest.settings!.map((s) => [s.id, s.kind, s.default])).toEqual([["base_url", "text", "http://wp.lan"], ["api_key", "secret", ""], ["session", "text", "main"], ["send", "boolean", false], ["unread_only_bar", "boolean", true], ["dm_urgent", "boolean", true], ["open", "select", "auto"]]);
    for (const p of Object.values(loaded.manifest.palettes ?? {})) for (const k of p.keys ?? []) expect(["cmd+i", "cmd+r", "cmd+k", "cmd+backspace"]).not.toContain(k.keys);
  });

  test("chats: the session resolved once by name and kept in storage; unread first with the run's sender, the pictures, the group tag, the count, the time; the status chat dropped", async () => {
    const first = await list("chats");
    expect(first.map((r) => [r.id, r.section])).toEqual([[MARA, "Unread"], [HIKE, "Unread"], [TOMAS, "Unread"], [FAMILY, "Recent"], [OLA, "Recent"], [LINA, "Recent"], ["120363055544433322@g.us", "Recent"], ["905557778899@c.us", "Recent"]]);
    // The pictures are not on the listing's path: the first listing has the initial, the background pass (one batch of the eight) lands them for the next.
    expect(first[0].icon).toEqual(initialIcon("Mara Lind"));
    await host.until(() => stored.has(`${X}\0pictures`), 3000, "the picture pass");
    expect(mock.calls(/profile-pictures$/)).toHaveLength(1);
    expect(mock.calls(/profile-pictures$/)[0].query.ids.split(",")).toHaveLength(8);
    expect(Object.entries(stored.get(`${X}\0pictures`) as Record<string, { u: string | null }>).filter(([, e]) => e.u).map(([id]) => id).sort()).toEqual([MARA, HIKE, OLA].sort());
    const rows = await list("chats");
    expect(rows[0]).toMatchObject({ name: "Mara Lind", subtitle: "standup in 20?", icon: { image: `${mock.url}/pic/${encodeURIComponent(MARA)}.svg` }, keywords: ["chat"] });
    expect(tags(rows[0])).toEqual(["3"]);
    expect(rows[0].accessories).toContainEqual({ date: m(2) * 1000 });
    // A group's newest message names its sender (from the archive's row) and a media message its kind; the sender is a keyword.
    expect(rows[1]).toMatchObject({ name: "Weekend hike", subtitle: "Ola Berg: [location]", keywords: ["group", "Ola Berg"] });
    expect(tags(rows[1])).toEqual(["group", "5"]);
    // A chat with a text lastMessage and one unread: the run agrees; no picture is the initial on a tile; a group without one the group glyph.
    expect(rows[2]).toMatchObject({ subtitle: "the cabin is booked, sending the map", icon: initialIcon("Tomas Ruiz") });
    expect(rows[3]).toMatchObject({ name: "Family", subtitle: "Dinner at eight on Sunday?", icon: "\u{f0849}" });
    expect(rows[6]).toMatchObject({ name: "pal beta", subtitle: "Group" });
    expect(rows.find((r) => r.name === "Status")).toBeUndefined();
    // Read chats: Open, Mark as unread, web, copy; with send off no message or reaction.
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "read", "web", "copy-number"]);
    expect(rows[3].actions!.map((a) => a.id)).toEqual(["open", "unread", "web", "copy-name"]);
    expect(rows[0].actions![1]).toEqual({ id: "read", title: "Mark as read", shortcut: "cmd+enter", multi: true });
    // One session lookup, kept in storage; the histories only for the unread three, sized to their count (5 at most); one picture batch.
    expect(mock.calls("/api/sessions")).toHaveLength(1);
    expect(stored.get(`${X}\0session:main`)).toBe(SESSION_ID);
    expect(mock.calls(/\/history$/).map((c) => [decodeURIComponent(c.path.split("/")[5]), c.query.limit])).toEqual([[MARA, "3"], [HIKE, "5"], [TOMAS, "1"]]);
    // A second listing inside the window is the shared list: no new call.
    const n = mock.seen.length;
    await list("chats");
    expect(mock.seen.length).toBe(n);
  });

  test("the pane: the last messages as a conversation with the sender, the time, a quoted reply and a photo; the chat's facts; a group's senders named from the archive", async () => {
    const d = await host.detail(X, "chats", MARA);
    const md = d.markdown!;
    expect(md.split("\n\n").filter((p) => p.startsWith("**")).map((p) => p.split(" · ")[0])).toEqual(["**Mara Lind**", "**You**", "**Mara Lind**", "**Mara Lind**", "**Mara Lind**"]);
    expect(md).toContain("\n\n_[photo]_\n\n");
    expect(md).toContain("\n> on it, give me ten\n\nthe tests are green now, the diff is small");
    expect(md.endsWith("standup in 20?")).toBe(true);
    expect(d.metadata).toEqual([
      { label: "Chat", value: "Mara Lind" },
      { label: "Kind", value: "Direct message" },
      { label: "Unread", value: "3 messages" },
      { label: "Phone", value: "+90 555 123 45 67" },
      { label: "Newest", value: expect.any(String) },
      { label: "Open", link: { text: "In the web client", href: "https://web.whatsapp.com/send?phone=905551234567" } },
    ]);
    // The LID's phone came from the resolve route, once.
    expect(mock.calls(`/api/sessions/${SESSION_ID}/contacts/${encodeURIComponent(MARA)}/phone`)).toHaveLength(1);
    const g = await host.detail(X, "chats", HIKE);
    expect(g.markdown!.split("\n\n").filter((p) => p.startsWith("**")).map((p) => p.split(" · ")[0])).toEqual(["**Ola Berg**", "**You**", "**Tomas Ruiz**", "**Lina Kova**", "**Ola Berg**"]);
    expect(g.markdown).toContain("_[voice message]_");
    expect(g.metadata).toContainEqual({ label: "Kind", value: "Group" });
    expect(g.metadata!.find((m) => m.label === "Phone")).toBeUndefined();
  });

  test("unread: the three, direct messages then groups; nothing unread is one hint", async () => {
    const rows = await list("unread");
    expect(rows.map((r) => [r.name, r.section])).toEqual([["Mara Lind", "Direct messages"], ["Weekend hike", "Groups"], ["Tomas Ruiz", "Direct messages"]]);
    const was = mock.chats;
    mock.chats = was.map((c) => ({ ...c, unread: 0 }));
    try {
      expect((await list("unread", "", { refresh: true })).map((r) => [r.id, r.name])).toEqual([["hint:none", "Nothing unread"]]);
    } finally { mock.chats = was; await list("chats", "", { refresh: true }); }
  });

  test("open: the web client with the chat's number (a LID resolved), a group at the top with a HUD line, copy number and name", async () => {
    expect(await host.pick(X, "chats", MARA)).toEqual({ open: "https://web.whatsapp.com/send?phone=905551234567" });
    expect(await host.pick(X, "chats", TOMAS, "open")).toEqual({ open: "https://web.whatsapp.com/send?phone=905559876543" });
    expect(await host.pick(X, "chats", HIKE)).toEqual({ open: "https://web.whatsapp.com/", hud: "Weekend hike is a group: WhatsApp opens at the top" });
    expect(await host.pick(X, "chats", MARA, "copy-number")).toEqual({ copy: "+905551234567" });
    expect(await host.pick(X, "chats", HIKE, "copy-name")).toEqual({ copy: "Weekend hike" });
    // The app, when the setting says so.
    host.changeSettings(X, { settings: settings({ open: "app" }) });
    await host.until(() => host.coreCalls.length > 0);
    expect(await host.pick(X, "chats", TOMAS)).toEqual({ open: "whatsapp://send?phone=905559876543" });
    expect(await host.pick(X, "chats", HIKE, "web")).toEqual({ open: "https://web.whatsapp.com/", hud: "Weekend hike is a group: WhatsApp opens at the top" });
    host.changeSettings(X, { settings: settings() });
  });

  test("mark read and unread against the mock, over the marked rows too; the list is fetched again after", async () => {
    expect(await host.pick(X, "chats", MARA, "read")).toEqual({ keep: true, toast: { title: "Marked read", message: "Mara Lind" } });
    expect(mock.read).toEqual([MARA]);
    expect(mock.chat(MARA)!.unread).toBe(0);
    expect(await host.pick(X, "unread", HIKE, "read", { ids: [HIKE, TOMAS] })).toEqual({ keep: true, toast: { title: "Marked read", message: "2 chats" } });
    expect(mock.read).toEqual([MARA, HIKE, TOMAS]);
    expect(await list("unread")).toMatchObject([{ id: "hint:none" }]);
    expect(await host.pick(X, "chats", MARA, "unread")).toEqual({ keep: true, toast: { title: "Marked unread", message: "Mara Lind" } });
    expect(mock.unread).toEqual([MARA]);
    expect((await list("chats"))[0]).toMatchObject({ id: MARA, section: "Unread" });
    // Back to the fixture's counts for the tests below.
    mock.chat(HIKE)!.unread = 5;
    mock.chat(TOMAS)!.unread = 1;
    mock.chat(MARA)!.unread = 3;
    await list("chats", "", { refresh: true });
  });

  test("send off: no message, no reaction, no reply field, whatever the pick asks; nothing reaches the mock", async () => {
    const before = mock.seen.length;
    expect(await host.pick(X, "chats", MARA, "reply")).toEqual({ keep: true, toast: { title: "Sending is off", message: "Turn on send under Settings › Extensions › WhatsApp", style: "failure" } });
    expect(await host.pick(X, "chats", MARA, "send", { values: { text: "hi" } })).toMatchObject({ toast: { title: "Sending is off", style: "failure" } });
    expect(await host.pick(X, "chats", MARA, "react")).toMatchObject({ toast: { title: "Reactions are off", style: "failure" } });
    expect(await host.pick(X, "chats", MARA, "react-send", { values: { emoji: "👍" } })).toMatchObject({ toast: { title: "Reactions are off", style: "failure" } });
    const bar = checkView(viewOf(await host.render(X, "unread", { reason: "load" })));
    expect(bar.actions.map((a) => a.id)).not.toContain("reply");
    expect(checkView(viewOf(await host.barAction(X, "unread", "reply", ctx))).input).toBeUndefined();
    expect(mock.sent).toEqual([]);
    expect(mock.reacted).toEqual([]);
    expect(mock.seen.slice(before).filter((s) => s.method === "POST")).toEqual([]);
  });

  test("send on: the message form (the latest message quotable), a plain send, a quoted reply, the empty text refused, a reaction from the six and its removal", async () => {
    host.changeSettings(X, { settings: settings({ send: true }) });
    await host.until(() => host.coreCalls.length > 0);
    const rows = await list("chats", "", { refresh: true });
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "read", "reply", "react", "web", "copy-number"]);
    const form = (await host.pick(X, "chats", MARA, "reply")).form!;
    expect(form).toMatchObject({ id: MARA, title: "Message Mara Lind", submit: { id: "send", title: "Send" } });
    expect(form.fields.map((f) => [f.id, f.kind])).toEqual([["text", "textarea"], ["quote", "checkbox"]]);
    expect(form.fields[1]).toMatchObject({ text: "Quote the latest message: “standup in 20?”" });
    expect(await host.pick(X, "chats", MARA, "send", { values: { text: "  ", quote: false } })).toMatchObject({ form: { errors: { text: "Required" } } });
    expect(await host.pick(X, "chats", MARA, "send", { values: { text: "on my way", quote: false } })).toEqual({ keep: true, toast: { title: "Sent", message: "Mara Lind: on my way" } });
    expect(await host.pick(X, "chats", MARA, "send", { values: { text: "yes, 20", quote: true } })).toMatchObject({ toast: { title: "Sent" } });
    expect(mock.sent).toEqual([{ chatId: MARA, text: "on my way" }, { chatId: MARA, text: "yes, 20", quoted: "false_254011223344556@lid_A5" }]);
    // A read chat's latest message is fetched at form time: Family's newest is ours, so nothing to quote and nothing to react to.
    const fam = (await host.pick(X, "chats", FAMILY, "reply")).form!;
    expect(fam.fields.map((f) => f.id)).toEqual(["text"]);
    expect(await host.pick(X, "chats", FAMILY, "react")).toMatchObject({ toast: { title: "Nothing to react to" } });
    const react = (await host.pick(X, "chats", HIKE, "react")).form!;
    expect(react).toMatchObject({ id: HIKE, title: "React in Weekend hike", submit: { id: "react-send" } });
    expect((react.fields[0] as { options: { id: string }[] }).options.map((o) => o.id)).toEqual([...REACTIONS, ""]);
    expect(await host.pick(X, "chats", HIKE, "react-send", { values: { emoji: "❤️" } })).toEqual({ keep: true, toast: { title: "Reacted ❤️", message: "Weekend hike" } });
    expect(await host.pick(X, "chats", HIKE, "react-send", { values: { emoji: "" } })).toMatchObject({ toast: { title: "Reaction removed" } });
    expect(mock.reacted).toEqual([{ chatId: HIKE, messageId: "false_120363012345678901@g.us_B5", emoji: "❤️" }, { chatId: HIKE, messageId: "false_120363012345678901@g.us_B5", emoji: "" }]);
  });

  test("search: the archive's hits with the chat, the sender and the time, the marks stripped; Enter opens the chat, cmd+c copies; the pane is the chat's; the 503 is one hint naming the gateway", async () => {
    expect((await list("search", "t")).map((r) => r.id)).toEqual(["hint:search"]);
    const rows = await list("search", "parser");
    expect(rows.map((r) => [r.name, r.subtitle])).toEqual([["can you look at the parser before standup?", "Mara Lind"], ["the invoice for september is missing the parser line", "You in Acme Support"]]);
    expect(rows[0].icon).toEqual(initialIcon("Mara Lind"));
    expect(rows[0].accessories).toEqual([{ date: m(40) * 1000 }]);
    expect(rows[0].actions!.map((a) => [a.id, a.shortcut])).toEqual([["open", undefined], ["copy", "cmd+c"], ["web", "cmd+shift+o"]]);
    expect(mock.calls("/api/search").at(-1)!.query).toEqual({ q: "parser", limit: "40", sessionId: SESSION_ID });
    const hike = await list("search", "trailhead");
    expect(hike[0]).toMatchObject({ subtitle: "Lina Kova in Weekend hike", icon: "\u{f0849}" });
    expect(await host.pick(X, "search", rows[0].id)).toEqual({ open: "https://web.whatsapp.com/send?phone=905551234567" });
    expect(await host.pick(X, "search", rows[0].id, "copy")).toEqual({ copy: "can you look at the parser before standup?" });
    expect((await host.detail(X, "search", rows[0].id)).metadata).toContainEqual({ label: "Chat", value: "Mara Lind" });
    expect((await list("search", "zzzz")).map((r) => r.name)).toEqual(["No messages found"]);
    mock.searchDown = true;
    try {
      const down = await list("search", "parser");
      expect(down).toMatchObject([{ id: "hint:down", name: "WhatsApp search is unavailable", subtitle: `${mock.url} answered 503: wsearch /search -> 500 Internal Server Error` }]);
    } finally { mock.searchDown = false; }
  });

  test("contacts: the saved ones by name with the number, one per number (the LID twin folded), the pushName-only and nameless left out, a name without a letter or digit or that is the number itself as the number alone; open, copy number, copy vCard", async () => {
    const rows = await list("contacts");
    expect(rows.map((r) => [r.name, r.subtitle])).toEqual([["+90 555 222 33 44", undefined], ["+90 555 888 99 00", undefined], ["Acme Support", "+90 555 777 88 99"], ["Dana Ruiz", "+90 555 000 11 22"], ["Lina Kova", "+90 555 333 44 55"], ["Mara Lind", "+90 555 123 45 67"], ["Ola Berg", "+90 555 111 22 33"], ["Tomas Ruiz", "+90 555 987 65 43"]]);
    expect(rows[5]).toMatchObject({ id: "905551234567@c.us", icon: initialIcon("Mara Lind"), keywords: ["905551234567", "+90 555 123 45 67"] });
    expect(rows[5].actions!.map((a) => [a.id, a.shortcut])).toEqual([["open", undefined], ["copy-number", "cmd+c"], ["copy-vcard", "cmd+shift+c"], ["web", "cmd+shift+o"]]);
    expect(mock.calls(`/api/sessions/${SESSION_ID}/contacts`).map((c) => c.query)).toEqual([{ limit: "1000", offset: "0" }]);
    expect(await host.pick(X, "contacts", rows[5].id)).toEqual({ open: "https://web.whatsapp.com/send?phone=905551234567" });
    expect(await host.pick(X, "contacts", rows[5].id, "copy-number")).toEqual({ copy: "+905551234567" });
    expect(await host.pick(X, "contacts", rows[5].id, "copy-vcard")).toEqual({ copy: vcard("Mara Lind", "905551234567"), hud: "Copied Mara Lind as a vCard" });
  });

  test("the bar item: the count of unread chats, urgent for a direct one, the popover's rows with the pictures as data urls; one list shared with the palettes", async () => {
    const before = mock.calls(/\/chats$/).length;
    const item = await host.render(X, "unread", { reason: "cli" });
    expect(item).toMatchObject({ icon: "\u{f05a3}", badge: 3, urgent: true, tooltip: "3 chats unread: 2 direct messages, 1 group" });
    expect(mock.calls(/\/chats$/)).toHaveLength(before + 1);
    await host.render(X, "unread", { reason: "every" });
    await list("unread");
    expect(mock.calls(/\/chats$/)).toHaveLength(before + 1);
    const view = checkView(viewOf(item));
    expect(view).toMatchObject({ id: "unread", keys: "actions", title: "3 chats unread" });
    const stacks = nodes(view.tree).filter((n): n is Extract<ViewNode, { type: "stack" }> => n.type === "stack" && !!n.action?.startsWith("focus:"));
    expect(stacks.map((s) => s.action)).toEqual([`focus:${MARA}`, `focus:${TOMAS}`, `focus:${HIKE}`]);
    expect(stacks.map((s) => !!s.selected)).toEqual([true, false, false]);
    const images = nodes(view.tree).filter((n): n is Extract<ViewNode, { type: "image" }> => n.type === "image");
    expect(images.map((i) => [i.alt, i.src.slice(0, 26)])).toEqual([["Mara Lind", "data:image/svg+xml;base64,"], ["Weekend hike", "data:image/svg+xml;base64,"]]);
    expect(nodes(view.tree).find((n) => n.type === "tile")).toMatchObject({ text: "T", fill: "solid" });
    expect(keycaps(view)).toEqual(["enter", "r", "m", "a", "o", "p"]);
    // dm_urgent off: a plain count.
    host.changeSettings(X, { settings: settings({ send: true, dm_urgent: false }) });
    await host.until(() => host.coreCalls.length > 0);
    expect((await host.render(X, "unread", { reason: "settings" })).urgent).toBe(false);
    host.changeSettings(X, { settings: settings({ send: true }) });
    await host.until(() => host.coreCalls.length > 0);
  });

  test("popover keys: the cursor, Enter opens, m marks read, r opens the field and Enter sends, Escape cancels, a marks all, o and p; a chat id as the action", async () => {
    await host.render(X, "unread", { reason: "cli" });
    let r = await host.barAction(X, "unread", "down", ctx);
    expect(nodes(checkView(viewOf(r)).tree).filter((n) => n.type === "stack" && !!n.selected).map((n) => n.action)).toEqual([`focus:${TOMAS}`]);
    expect(await host.barAction(X, "unread", "open", ctx)).toEqual({ open: "https://web.whatsapp.com/send?phone=905559876543" });
    r = await host.barAction(X, "unread", `focus:${HIKE}`, ctx);
    expect(nodes(checkView(viewOf(r)).tree).filter((n) => n.type === "stack" && !!n.selected).map((n) => n.action)).toEqual([`focus:${HIKE}`]);
    expect(await host.barAction(X, "unread", "open", ctx)).toEqual({ open: "https://web.whatsapp.com/", hud: "Weekend hike is a group: WhatsApp opens at the top" });
    expect(await host.barAction(X, "unread", "web", ctx)).toMatchObject({ open: "https://web.whatsapp.com/" });
    // r: the field on the focused row; an empty send keeps it; Enter sends through send-text; Escape cancels.
    r = await host.barAction(X, "unread", "reply", ctx);
    expect(checkView(viewOf(r)).input).toEqual({ value: "", placeholder: "Message Weekend hike", submit: "send", cancel: "cancel" });
    r = await host.barAction(X, "unread", "send", { ...ctx, values: { input: " " } });
    expect(r.toast).toMatchObject({ title: "Nothing to send" });
    expect(checkView(viewOf(r)).input).toBeDefined();
    const sent = mock.sent.length;
    r = await host.barAction(X, "unread", "send", { ...ctx, values: { input: "see you at the trailhead" } });
    expect(r.toast).toEqual({ title: "Sent", message: "Weekend hike: see you at the trailhead", style: "success" });
    expect(checkView(viewOf(r)).input).toBeUndefined();
    expect(mock.sent.slice(sent)).toEqual([{ chatId: HIKE, text: "see you at the trailhead" }]);
    await host.barAction(X, "unread", "reply", ctx);
    expect(checkView(viewOf(await host.barAction(X, "unread", "cancel", ctx))).input).toBeUndefined();
    // m on the focused row, then a over the rest.
    const read = mock.read.length;
    expect(await host.barAction(X, "unread", "read", ctx)).toEqual({ keep: true, hud: "Weekend hike: read" });
    expect(mock.read.slice(read)).toEqual([HIKE]);
    expect(await host.barAction(X, "unread", "read-all", ctx)).toEqual({ keep: true, hud: "Marked read" });
    expect(mock.read.slice(read + 1).sort()).toEqual([MARA, TOMAS].sort());
    expect(await host.barAction(X, "unread", "open-pal", ctx)).toEqual({ push: { extension: X, palette: "unread" } });
    expect(await host.barAction(X, "unread", "open-whatsapp", ctx)).toEqual({ open: "https://web.whatsapp.com/" });
    expect(await host.barAction(X, "unread", MARA)).toEqual({ open: "https://web.whatsapp.com/send?phone=905551234567" });
    // Everything read: hidden at zero; with unread_only_bar off the glyph stays and the popover lists the recent chats.
    expect(await host.render(X, "unread", { reason: "cli" })).toEqual({ hidden: true });
    host.changeSettings(X, { settings: settings({ send: true, unread_only_bar: false }) });
    await host.until(() => host.coreCalls.length > 0);
    const stays = await host.render(X, "unread", { reason: "settings" });
    expect(stays).toMatchObject({ icon: "\u{f05a3}", urgent: false, tooltip: "Nothing unread" });
    expect(stays.badge).toBeUndefined();
    expect(texts(checkView(viewOf(stays)))).toEqual(expect.arrayContaining(["Recent", "Mara Lind", "Weekend hike"]));
    host.changeSettings(X, { settings: settings({ send: true }) });
    await host.until(() => host.coreCalls.length > 0);
    for (const [id, n] of [[MARA, 3], [HIKE, 5], [TOMAS, 1]] as const) mock.chat(id)!.unread = n;
    await list("chats", "", { refresh: true });
  });

  test("links: open by id, by number, by name (a chat, then a contact), the refusals; search pushes the palette with the query", async () => {
    expect(await host.request<unknown>("link", { extension: X, route: "open", params: { chat: TOMAS } })).toEqual({ open: "https://web.whatsapp.com/send?phone=905559876543" });
    expect(await host.request<unknown>("link", { extension: X, route: "open", params: { chat: "+90 555 000 11 22" } })).toEqual({ open: "https://web.whatsapp.com/send?phone=905550001122" });
    expect(await host.request<unknown>("link", { extension: X, route: "open", params: { chat: "mara" } })).toEqual({ open: "https://web.whatsapp.com/send?phone=905551234567" });
    expect(await host.request<unknown>("link", { extension: X, route: "open", params: { chat: "Dana Ruiz" } })).toEqual({ open: "https://web.whatsapp.com/send?phone=905550001122" });
    await expect(host.request("link", { extension: X, route: "open", params: { chat: "nobody" } })).rejects.toThrow('no chat or contact named "nobody"');
    await expect(host.request("link", { extension: X, route: "open", params: {} })).rejects.toThrow("chat is required");
    expect(await host.request<unknown>("link", { extension: X, route: "search", params: { q: "cabin" } })).toEqual({ push: { extension: X, palette: "search", query: "cabin" } });
  });

  test("a 429 is refused locally until Retry-After, then the next call goes through", async () => {
    mock.limited = true;
    try {
      const rows = await list("chats", "", { refresh: true });
      expect(rows).toMatchObject([{ id: "hint:limit", name: "OpenWA rate limit reached" }]);
      expect(rows[0].subtitle).toMatch(/^Retry at /);
      mock.limited = false;
      const n = mock.seen.length;
      expect(await list("chats", "", { refresh: true })).toMatchObject([{ id: "hint:limit" }]);
      expect(mock.seen.length).toBe(n);
      await Bun.sleep(1100);
      expect((await list("chats", "", { refresh: true }))[0]).toMatchObject({ id: MARA });
    } finally { mock.limited = false; }
  });

  test("a session that is not ready (the chat list's 409) is one hint naming the state and the url to scan at; the bar goes stale", async () => {
    mock.status = "qr_ready";
    try {
      const rows = await list("chats", "", { refresh: true });
      expect(rows).toMatchObject([{ id: "hint:session", name: 'WhatsApp session "main" is qr ready', subtitle: `Scan the QR code at ${mock.url} to link the phone again`, actions: [{ id: "settings", title: "Open WhatsApp settings" }] }]);
      expect(await host.pick(X, "chats", "hint:session")).toEqual({ open: "pal://settings/extensions" });
      await expect(host.render(X, "unread", { reason: "cli" })).rejects.toThrow('WhatsApp session "main" is qr ready');
    } finally { mock.status = "ready"; }
    await list("chats", "", { refresh: true });
  });

  test("a wrong key is a 401 hint naming the setting; no key at all a hint and a hidden bar item, with no call made; a session name nobody has; an unreachable gateway names the url", async () => {
    host.changeSettings(X, { settings: settings({ api_key: "k-wrong" }) });
    await host.until(() => host.coreCalls.length > 0);
    expect(await list("chats", "", { refresh: true })).toMatchObject([{ id: "hint:auth", name: "OpenWA rejected the API key", subtitle: "401: check api_key under Settings › Extensions › WhatsApp" }]);
    expect(mock.seen.at(-1)!.key).toBe("k-wrong");
    host.changeSettings(X, { settings: settings({ api_key: "" }) });
    await host.until(() => host.coreCalls.length > 0);
    const n = mock.seen.length;
    expect(await list("chats", "", { refresh: true })).toMatchObject([{ id: "hint:key", name: "API key is not set", subtitle: "Set api_key under Settings › Extensions › WhatsApp: a key from OpenWA's Settings, API keys" }]);
    expect(await host.render(X, "unread", { reason: "cli" })).toEqual({ hidden: true });
    expect(mock.seen.length).toBe(n);
    host.changeSettings(X, { settings: settings({ session: "nope" }) });
    await host.until(() => host.coreCalls.length > 0);
    expect(await list("chats", "", { refresh: true })).toMatchObject([{ id: "hint:session", name: 'No WhatsApp session named "nope"', subtitle: `Set session under Settings › Extensions › WhatsApp to a session ${mock.url} lists` }]);
    host.changeSettings(X, { settings: settings({ base_url: "http://127.0.0.1:1" }) });
    await host.until(() => host.coreCalls.length > 0);
    const down = await list("chats", "", { refresh: true });
    expect(down).toMatchObject([{ id: "hint:unreachable", name: "OpenWA is unreachable at http://127.0.0.1:1", subtitle: "Check base_url under Settings › Extensions › WhatsApp, and that the gateway is up" }]);
    host.changeSettings(X, { settings: settings() });
    await host.until(() => host.coreCalls.length > 0);
    expect((await list("chats", "", { refresh: true }))[0]).toMatchObject({ id: MARA });
  });

  test("a stale session UUID in storage (the session recreated) is resolved again once and the call retried", async () => {
    stored.set(`${X}\0session:main`, "00000000-0000-0000-0000-000000000000");
    // A changed setting drops the resolved UUID from memory, so the stale one in storage is what the next call takes.
    host.changeSettings(X, { settings: settings({ dm_urgent: false }) });
    await host.until(() => host.coreCalls.length > 0);
    const before = mock.calls("/api/sessions").length;
    expect((await list("chats", "", { refresh: true }))[0]).toMatchObject({ id: MARA });
    expect(mock.calls("/api/sessions")).toHaveLength(before + 1);
    expect(mock.calls("/api/sessions/00000000-0000-0000-0000-000000000000/chats")).toHaveLength(1);
    expect(stored.get(`${X}\0session:main`)).toBe(SESSION_ID);
  });
});
