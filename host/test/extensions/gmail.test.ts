// Gmail: mail.ts's pure parts by import (addresses, HTML to text with the
// quotes folded, the markdown escape, the RFC 822 build, the links), then
// the extension through the harness as two instances (`gmail` with send
// on, `gmail@work` with send off) against gmail-mock.ts: the rows and
// their actions per instance, the pane, every write against the mock
// (mark read, mark unread, archive, star, reply, compose, drafts), the
// work instance refusing each write it must not do, the bar item and its
// popover, the shared inbox, the token failures, a 401 re-mint, a 429.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gravatarUrl, initialIcon } from "../../../extensions/gmail/avatar.ts";
import { QUOTE_FOLD, bodyOf, buildRaw, displayName, foldTextQuotes, htmlToText, labelQuery, labelTitle, labelUrl, looksAttached, mdEscape, messageText, parseAddress, parseAddresses, quoted, replySubject, sectionOf, size, threadUrl, withSignature } from "../../../extensions/gmail/mail.ts";
import type { Item, PaletteMeta } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";
import { GmailMock, personal } from "./gmail-mock.ts";

const P = "gmail";
const W = "gmail@work";

const decodeRaw = (raw: string) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const bodyText = (raw: string) => Buffer.from(decodeRaw(raw).split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString("utf8");
const tags = (i: Item) => (i.accessories ?? []).flatMap((a) => ("tag" in a ? [a.tag] : []));

describe("mail helpers", () => {
  test("addresses: name and email, a bare address, a list with a quoted comma", () => {
    expect(parseAddress("Mara Lind <Mara@Example.com>")).toEqual({ name: "Mara Lind", email: "mara@example.com" });
    expect(parseAddress('"Lind, Mara" <mara@example.com>')).toEqual({ name: "Lind, Mara", email: "mara@example.com" });
    expect(parseAddress("mara@example.com")).toEqual({ name: "", email: "mara@example.com" });
    expect(parseAddress(undefined)).toEqual({ name: "", email: "" });
    expect(parseAddresses('"Lind, Mara" <mara@example.com>, tomas@example.com, Ola <ola@example.com>')).toEqual([{ name: "Lind, Mara", email: "mara@example.com" }, { name: "", email: "tomas@example.com" }, { name: "Ola", email: "ola@example.com" }]);
    expect(displayName({ name: "", email: "billing@acme.example" })).toBe("billing");
  });

  test("htmlToText: head and style gone, the quote folded, lists, links, entities, blank runs", () => {
    const html = personal.messages[1].html!;
    expect(htmlToText(html)).toBe(`tomas-r requested your review on #81 (https://github.com/zcag/pal/pull/81).\n- Settings page\n- Bar rows\n\n${QUOTE_FOLD}\n\n© GitHub`);
    expect(htmlToText("<p>Hi</p><blockquote>old</blockquote><p>bye</p>")).toBe(`Hi\n\n${QUOTE_FOLD}\n\nbye`);
    expect(htmlToText("a<br>b &amp; c &nbsp; <a href=\"https://x.example/\">x.example</a>")).toBe("a\nb & c x.example");
    expect(htmlToText("<div id=\"divRplyFwdMsg\"><div>From: x</div><div>old</div></div><p>after</p>")).toBe(`${QUOTE_FOLD}\n\nafter`);
  });

  test("foldTextQuotes: the reply header cuts, a run of > lines folds once", () => {
    expect(foldTextQuotes(personal.messages[0].text!)).toBe(`Can you look at the parser before standup? The tests are green now & the diff is small.\n\n${QUOTE_FOLD}`);
    expect(foldTextQuotes("top\n> a\n> b\nmiddle\n> c\nend")).toBe(`top\n${QUOTE_FOLD}\nmiddle\n${QUOTE_FOLD}\nend`);
    expect(foldTextQuotes("hello\n\nFrom: Someone\nSent: yesterday\nold")).toBe(`hello\n\n${QUOTE_FOLD}`);
    expect(messageText("", "<p>x</p>", "snip")).toBe("x");
    expect(messageText("", "", "snip")).toBe("snip");
  });

  test("mdEscape: markup escaped, links whole, the fold in italics", () => {
    expect(mdEscape("see <a@b> and #1 *now*")).toBe("see \\<a@b\\> and \\#1 \\*now\\*");
    expect(mdEscape("go https://x.example/a_b?c=1 now")).toBe("go https://x.example/a_b?c=1 now");
    expect(mdEscape("- item\n1. one\n+ plus")).toBe("\\- item\n1\\. one\n\\+ plus");
    expect(mdEscape(`top\n${QUOTE_FOLD}`)).toBe("top\n_quoted text folded_");
  });

  test("buildRaw: the headers, the base64 body, a non-ASCII subject encoded; replySubject, quoted, withSignature", () => {
    const raw = buildRaw({ from: "me@x.example", to: "you@x.example", cc: "cc@x.example", subject: "Re: Ünïcode", text: "hello\nworld", inReplyTo: "<m1@x>", references: "<m0@x> <m1@x>" });
    const text = decodeRaw(raw);
    expect(text.split("\r\n\r\n")[0].split("\r\n")).toEqual(["From: me@x.example", "To: you@x.example", "Cc: cc@x.example", "Subject: =?UTF-8?B?UmU6IMOcbsOvY29kZQ==?=", "In-Reply-To: <m1@x>", "References: <m0@x> <m1@x>", "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"]);
    expect(bodyText(raw)).toBe("hello\nworld");
    expect(decodeRaw(buildRaw({ from: "a", to: "b", subject: "Plain", text: "x" }))).toContain("Subject: Plain\r\nMIME-Version");
    expect(replySubject("Re: x")).toBe("Re: x");
    expect(replySubject("x")).toBe("Re: x");
    expect(quoted("Wed, 16 Sep 2026", "Mara <m@x>", "a\nb")).toBe("On Wed, 16 Sep 2026, Mara <m@x> wrote:\n> a\n> b");
    expect(withSignature("hi\n", "Cagdas")).toBe("hi\n\nCagdas");
    expect(withSignature("hi", "")).toBe("hi");
  });

  test("links and labels: the account in the url, inbox or all, the system anchors, the search spelling, the section of a hit", () => {
    expect(threadUrl("someone@gmail.com", "t1", true)).toBe("https://mail.google.com/mail/u/someone%40gmail.com/#inbox/t1");
    expect(threadUrl("", "t1", false)).toBe("https://mail.google.com/mail/u/0/#all/t1");
    expect(labelUrl("a@b", "INBOX", "INBOX")).toBe("https://mail.google.com/mail/u/a%40b/#inbox");
    expect(labelUrl("a@b", "Label_3", "Family/Trips")).toBe("https://mail.google.com/mail/u/a%40b/#label/Family/Trips");
    expect(labelUrl("a@b", "CATEGORY_PROMOTIONS", "CATEGORY_PROMOTIONS")).toBe("https://mail.google.com/mail/u/a%40b/#category/promotions");
    expect(labelQuery("INBOX", "INBOX")).toBe("in:inbox");
    expect(labelQuery("Label_1", "GitHub")).toBe("label:GitHub");
    expect(labelQuery("Label_9", "Two Words")).toBe('label:"Two Words"');
    expect(labelTitle("DRAFT", "DRAFT")).toBe("Drafts");
    expect(labelTitle("CATEGORY_UPDATES", "CATEGORY_UPDATES")).toBe("Updates");
    const names = new Map([["Label_1", "GitHub"], ["INBOX", "INBOX"]]);
    expect(sectionOf(["INBOX", "Label_1"], names)).toBe("GitHub");
    expect(sectionOf(["INBOX", "UNREAD"], names)).toBe("Inbox");
    expect(sectionOf(["SENT"], names)).toBe("Sent");
    expect(sectionOf([], names)).toBe("Archive");
    expect(size(500)).toBe("500 B");
    expect(size(48213)).toBe("47 KB");
    expect(size(1_500_000)).toBe("1.4 MB");
  });

  test("bodyOf walks the MIME tree; looksAttached reads the top-level type", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const payload = { mimeType: "multipart/mixed", parts: [{ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: b64("plain") } }, { mimeType: "text/html", body: { data: b64("<p>html</p>") } }] }, { mimeType: "application/pdf", filename: "a.pdf", body: { size: 12, attachmentId: "x" } }] };
    expect(bodyOf(payload)).toEqual({ text: "plain", html: "<p>html</p>", attachments: [{ filename: "a.pdf", mimeType: "application/pdf", size: 12 }] });
    expect(looksAttached(payload)).toBe(true);
    expect(looksAttached({ mimeType: "multipart/alternative" })).toBe(false);
  });

  test("the avatar helpers", () => {
    expect(gravatarUrl("Mara@Example.com ")).toMatch(/\/ec0b5b5f013f246e0729ebaea54e85d5\?s=64&d=404$/);
    expect(initialIcon("mara lind", "mara@example.com").image).toMatch(/^data:image\/svg\+xml;utf8,.*%3EM%3C/);
  });
});

describe("gmail", () => {
  let dir: string;
  let mock: GmailMock;
  let host: Host;
  let personalToken = "tok-personal";
  const runs = (name: string) => { try { return readFileSync(join(dir, `${name}.runs`), "utf8").length; } catch { return 0; } };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "pal-gmail-"));
    mock = new GmailMock();
    writeFileSync(join(dir, "token.txt"), personalToken);
    writeFileSync(join(dir, "tok-personal.sh"), `#!/bin/sh\nprintf x >> "${dir}/personal.runs"\ncat "${dir}/token.txt"\necho\n`);
    writeFileSync(join(dir, "tok-work.sh"), `#!/bin/sh\nprintf x >> "${dir}/work.runs"\necho '{"access_token": "tok-work", "expires_in": 3385, "policy": "read and mark-read only"}'\n`);
    writeFileSync(join(dir, "tok-broken.sh"), `#!/bin/sh\necho "curl: (7) Failed to connect to 127.0.0.1 port 8776" >&2\nexit 7\n`);
    for (const f of ["tok-personal.sh", "tok-work.sh", "tok-broken.sh"]) chmodSync(join(dir, f), 0o755);
    process.env.PAL_GMAIL_API = mock.url;
    process.env.PAL_GMAIL_AVATARS = mock.avatarsUrl;
    host = await Host.bundled({
      core: { "instances.get": ({ extension }: { extension: string }) => (extension === P ? [{ key: P, title: "Personal" }, { key: W, title: "Work", tint: "amber", badge: "W" }] : []) },
      settings: {
        [P]: { settings: { token_command: join(dir, "tok-personal.sh"), send: true, signature: "Cagdas", labels: ["Receipts", "Nope"] } },
        [W]: { settings: { token_command: join(dir, "tok-work.sh"), address: "someone@example.org", send: false } },
      },
      timeout: 8000,
    });
  });
  afterAll(() => { host.kill(); mock.stop(); rmSync(dir, { recursive: true, force: true }); });

  const list = (ext: string, palette: string, q = "", ctx?: Parameters<Host["list"]>[3]) => host.list(ext, palette, q, ctx);
  const modifies = () => mock.calls("/users/me/messages/batchModify").map((c) => c.body);

  test("meta: multi, the account settings instance-scoped, the titles with the instance, the badge, lazy and the kinds", () => {
    const m = host.manifests.get(P)!;
    expect(m.multi).toBe(true);
    expect(m.settings!.filter((s) => s.scope === "instance").map((s) => s.id)).toEqual(["token_command", "address", "send"]);
    const by = Object.fromEntries(host.loaded().map((l) => [l.extension, l]));
    expect(by[P].palettes.map((p: PaletteMeta) => p.title)).toEqual(["Inbox (Personal)", "Search Mail (Personal)", "Labels (Personal)", "Compose (Personal)", "Drafts (Personal)"]);
    expect(by[W].palettes.map((p: PaletteMeta) => p.title)).toEqual(["Inbox (Work)", "Search Mail (Work)", "Labels (Work)", "Compose (Work)", "Drafts (Work)"]);
    expect(by[P].palettes[0].icon).toEqual({ tile: { glyph: "\u{f01ee}", bg: "red" } });
    expect(by[W].palettes[0].icon).toEqual({ tile: { glyph: "\u{f01ee}", bg: "amber", badge: "W" } });
    expect(by[P].palettes.map((p: PaletteMeta) => [p.live, p.input, p.lazy, p.ttl, p.tier])).toEqual([[true, false, true, undefined, undefined], [false, true, undefined, undefined, undefined], [false, false, true, 3600, "catalog"], [false, false, undefined, undefined, undefined], [true, false, true, undefined, undefined]]);
    expect(by[P].palettes[0].detail).toBe("lazy");
    expect(by[P].bar.map((b: { id: string }) => b.id)).toEqual(["unread"]);
    expect(by[P].warnings).toEqual([]);
    expect(by[W].warnings).toEqual([]);
    expect(host.stderr).toMatch(/loaded gmail@work \(inbox,search,labels,compose,drafts; bar unread\) in a worker/);
  });

  test("inbox (personal): unread first, then recent, then the labels setting's unread; the row; one token run; metadata gets with the headers", async () => {
    const rows = await list(P, "inbox");
    expect(rows.map((r) => [r.id, r.section])).toEqual([["m1", "Unread"], ["m2", "Unread"], ["m3", "Unread"], ["m4", "Unread"], ["m5", "Recent"], ["m6", "Recent"], ["m7", "Recent"], ["m8", "Receipts"]]);
    const m1 = rows[0];
    expect(m1).toMatchObject({ name: "Parser review before standup?", subtitle: "Mara Lind · Can you look at the parser before standup? The tests are green now & the diff is small.", icon: { image: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/ec0b5b5f013f246e0729ebaea54e85d5\?s=64&d=404$/) } });
    expect(m1.keywords).toEqual(["Mara Lind", "mara@example.com", "Personal"]);
    expect(m1.accessories).toEqual([{ date: Date.parse("Wed, 16 Sep 2026 09:12:00 +0000") }]);
    expect(m1.actions).toEqual([
      { id: "open", title: "Open in Gmail" },
      { id: "read", title: "Mark as read", shortcut: "cmd+enter", multi: true },
      { id: "archive", title: "Archive", shortcut: "cmd+e", multi: true },
      { id: "star", title: "Star", shortcut: "cmd+s" },
      { id: "reply", title: "Reply", shortcut: "cmd+shift+r" },
      { id: "copy", title: "Copy link", shortcut: "cmd+c" },
    ]);
    // No Gravatar for GitHub: the initial on a tile. The chips are the user labels, the star and the paperclip.
    expect(rows[1].icon).toEqual(initialIcon("GitHub", "notifications@github.com"));
    expect(tags(rows[1])).toEqual(["GitHub"]);
    expect(tags(rows[3])).toEqual(["Family/Trips", "★"]);
    expect(rows[3].accessories).toContainEqual({ text: "📎" });
    expect(rows[3].actions!.find((a) => a.id === "unstar")).toEqual({ id: "unstar", title: "Unstar", shortcut: "cmd+s" });
    expect(rows[4].actions![1]).toEqual({ id: "unread", title: "Mark as unread", shortcut: "cmd+enter", multi: true });
    expect(runs("personal")).toBe(1);
    expect(host.stderr).toContain('[gmail] no label "Nope" on this account');
    const lists = mock.calls("/users/me/messages").filter((c) => c.auth === "Bearer tok-personal");
    expect(lists.map((c) => [c.query.labelIds, c.query.maxResults?.[0]])).toEqual([[["INBOX", "UNREAD"], "50"], [["INBOX"], "50"], [["Label_2", "UNREAD"], "50"]]);
    const gets = mock.calls(/^\/users\/me\/messages\/m/).filter((c) => c.auth === "Bearer tok-personal");
    expect(gets).toHaveLength(8);
    expect(gets[0].query.format).toEqual(["metadata"]);
    expect(gets[0].query.metadataHeaders).toContain("From");
    expect(gets[0].query.metadataHeaders).toContain("Message-ID");
    // The count came from the list (under a page), not from labels.get.
    expect(mock.calls("/users/me/labels/INBOX")).toHaveLength(0);
  });

  test("inbox (work): its own token, its own two unread, no archive, star or reply with send off", async () => {
    const rows = await list(W, "inbox");
    expect(rows.map((r) => [r.id, r.section])).toEqual([["w1", "Unread"], ["w2", "Unread"], ["w3", "Recent"]]);
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "read", "copy"]);
    expect(rows[2].actions!.map((a) => a.id)).toEqual(["open", "unread", "copy"]);
    expect(tags(rows[0])).toEqual(["Reports"]);
    expect(rows[0].keywords).toContain("Work");
    expect(runs("work")).toBe(1);
    // A second listing inside the window is the shared inbox: no new list call.
    const n = mock.calls("/users/me/messages").length;
    await list(W, "inbox");
    expect(mock.calls("/users/me/messages").length).toBe(n);
  });

  test("the pane: the text with the quote folded, the HTML converted, the headers, the attachments, the link; the full message fetched once", async () => {
    const d1 = await host.detail(P, "inbox", "m1");
    expect(d1.markdown).toBe("Can you look at the parser before standup? The tests are green now & the diff is small.\n\n_quoted text folded_");
    expect(d1.metadata).toEqual([
      { label: "From", value: "Mara Lind <mara@example.com>" },
      { label: "To", value: "someone@gmail.com" },
      { label: "Date", value: expect.stringMatching(/2026/) },
      { label: "Thread", link: { text: "Open in Gmail", href: "https://mail.google.com/mail/u/someone%40gmail.com/#inbox/t1" } },
    ]);
    const d2 = await host.detail(P, "inbox", "m2");
    expect(d2.markdown).toBe("tomas-r requested your review on \\#81 (https://github.com/zcag/pal/pull/81).\n\\- Settings page\n\\- Bar rows\n\n_quoted text folded_\n\n© GitHub");
    expect(d2.metadata!.find((m) => m.label === "Labels")).toEqual({ label: "Labels", tags: [{ text: "GitHub" }] });
    const d4 = await host.detail(P, "inbox", "m4");
    expect(d4.metadata!.filter((m) => /Cc|Attachments|Labels/.test(m.label))).toEqual([
      { label: "Cc", value: "Tomas Ruiz <tomas@example.com>" },
      { label: "Labels", tags: [{ text: "Family/Trips" }, { text: "starred", color: "amber" }] },
      { label: "2 Attachments", value: "booking.pdf (118 KB), map.png (86 KB)" },
    ]);
    const fulls = mock.calls("/users/me/messages/m1").filter((c) => c.query.format?.[0] === "full");
    expect(fulls).toHaveLength(1);
    await host.detail(P, "inbox", "m1");
    expect(mock.calls("/users/me/messages/m1").filter((c) => c.query.format?.[0] === "full")).toHaveLength(1);
    // The address came from the profile: the setting is empty for the personal instance.
    expect(mock.calls("/users/me/profile").filter((c) => c.auth === "Bearer tok-personal")).toHaveLength(1);
  });

  test("picks: open at the thread, copy, mark read and unread through batchModify, several at once", async () => {
    expect(await host.pick(P, "inbox", "m1")).toEqual({ open: "https://mail.google.com/mail/u/someone%40gmail.com/#inbox/t1" });
    expect(await host.pick(P, "inbox", "m8", "open")).toEqual({ open: "https://mail.google.com/mail/u/someone%40gmail.com/#all/t8" });
    expect(await host.pick(P, "inbox", "m1", "copy")).toEqual({ copy: "https://mail.google.com/mail/u/someone%40gmail.com/#inbox/t1" });
    expect(await host.pick(P, "inbox", "m1", "read")).toEqual({ keep: true, toast: { title: "Marked read", message: "Parser review before standup?" } });
    expect(modifies().at(-1)).toEqual({ ids: ["m1"], removeLabelIds: ["UNREAD"] });
    // The next listing (the cache dropped) has it under Recent; the count fell.
    let rows = await list(P, "inbox");
    expect(rows.find((r) => r.id === "m1")!.section).toBe("Recent");
    expect(rows.find((r) => r.id === "m1")!.actions![1].id).toBe("unread");
    expect(await host.pick(P, "inbox", "m1", "unread")).toMatchObject({ toast: { title: "Marked unread" } });
    expect(modifies().at(-1)).toEqual({ ids: ["m1"], addLabelIds: ["UNREAD"] });
    expect(await host.pick(P, "inbox", "m2", "read", { ids: ["m2", "m3"] })).toEqual({ keep: true, toast: { title: "Marked read", message: "2 messages" } });
    expect(modifies().at(-1)).toEqual({ ids: ["m2", "m3"], removeLabelIds: ["UNREAD"] });
    rows = await list(P, "inbox");
    expect(rows.filter((r) => r.section === "Unread").map((r) => r.id)).toEqual(["m1", "m4"]);
    await host.pick(P, "inbox", "m2", "unread", { ids: ["m2", "m3"] });
  });

  test("archive and star (send on) change the labels; the work instance refuses both with no call", async () => {
    expect(await host.pick(P, "inbox", "m7", "archive")).toEqual({ keep: true, toast: { title: "Archived", message: "Autumn sale starts now" } });
    expect(modifies().at(-1)).toEqual({ ids: ["m7"], removeLabelIds: ["INBOX"] });
    expect(personal.messages.find((m) => m.id === "m7")!.labelIds).not.toContain("INBOX");
    expect(await host.pick(P, "inbox", "m6", "star")).toEqual({ keep: true, toast: { title: "Starred", message: "Re: Dinner on Friday" } });
    expect(modifies().at(-1)).toEqual({ ids: ["m6"], addLabelIds: ["STARRED"] });
    expect(await host.pick(P, "inbox", "m6", "unstar")).toMatchObject({ toast: { title: "Unstarred" } });
    expect(modifies().at(-1)).toEqual({ ids: ["m6"], removeLabelIds: ["STARRED"] });
    const before = modifies().length;
    expect(await host.pick(W, "inbox", "w3", "archive")).toEqual({ keep: true, toast: { title: "Archive is off", message: "Turn on send for this account under Settings › Extensions › Gmail", style: "failure" } });
    expect(await host.pick(W, "inbox", "w3", "star")).toMatchObject({ toast: { title: "Star is off", style: "failure" } });
    expect(await host.pick(W, "inbox", "w3", "reply")).toMatchObject({ toast: { title: "Reply is off", style: "failure" } });
    expect(await host.pick(W, "inbox", "w3", "send", { values: { to: "x@y", subject: "s", body: "b" } })).toMatchObject({ toast: { title: "Reply is off", style: "failure" } });
    expect(modifies().length).toBe(before);
    expect(mock.sent).toHaveLength(0);
    // Mark read is the work account's one write.
    expect(await host.pick(W, "inbox", "w1", "read")).toMatchObject({ toast: { title: "Marked read" } });
    expect(modifies().at(-1)).toEqual({ ids: ["w1"], removeLabelIds: ["UNREAD"] });
    await host.pick(W, "inbox", "w1", "unread");
  });

  test("reply: the form with the defaults, a missing body kept with the error, the send in the thread with the quote and the signature", async () => {
    const f = (await host.pick(P, "inbox", "m1", "reply"))!.form!;
    expect(f.title).toBe("Reply to Mara Lind");
    expect(f.fields.map((x) => [x.id, (x as { default?: string }).default])).toEqual([["to", "Mara Lind <mara@example.com>"], ["cc", ""], ["subject", "Re: Parser review before standup?"], ["body", ""]]);
    const again = (await host.pick(P, "inbox", "m1", "send", { values: { to: f.fields[0].default as string, cc: "", subject: "Re: Parser review before standup?", body: "  " } }))!.form!;
    expect(again.errors).toEqual({ body: "Required" });
    expect(mock.sent).toHaveLength(0);
    const r = await host.pick(P, "inbox", "m1", "send", { values: { to: "Mara Lind <mara@example.com>", cc: "tomas@example.com", subject: "Re: Parser review before standup?", body: "Looking now." } });
    expect(r).toEqual({ keep: true, toast: { title: "Sent", message: "Reply to Mara Lind: Re: Parser review before standup?" } });
    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0].threadId).toBe("t1");
    expect(mock.sent[0].box).toBe("someone@gmail.com");
    const raw = decodeRaw(mock.sent[0].raw);
    expect(raw).toContain("From: someone@gmail.com\r\nTo: Mara Lind <mara@example.com>\r\nCc: tomas@example.com\r\nSubject: Re: Parser review before standup?\r\nIn-Reply-To: <m1@example.com>\r\nReferences: <m1@example.com>\r\n");
    expect(bodyText(mock.sent[0].raw)).toBe("Looking now.\n\nCagdas\n\nOn Wed, 16 Sep 2026 09:12:00 +0000, Mara Lind <mara@example.com> wrote:\n> Can you look at the parser before standup? The tests are green now & the diff is small.\n> \n> [quoted text folded]");
  });

  test("search: a short query is the hint, Gmail's syntax goes through, hits sectioned by label, nothing found", async () => {
    expect((await list(P, "search", "a"))[0]).toMatchObject({ id: "hint:search", name: "Search Mail" });
    const rows = await list(P, "search", "from:acme");
    expect(rows.map((r) => [r.id, r.section])).toEqual([["m3", "Receipts"], ["m8", "Receipts"]]);
    expect(mock.calls("/users/me/messages").at(-1)!.query).toEqual({ q: ["from:acme"], maxResults: ["50"] });
    expect((await list(P, "search", "in:sent")).map((r) => [r.id, r.section])).toEqual([["m9", "Sent"]]);
    expect((await list(P, "search", "has:attachment cabin")).map((r) => r.id)).toEqual(["m4"]);
    expect((await list(P, "search", "zzzz"))[0]).toMatchObject({ id: "hint:empty", name: "No messages found", subtitle: 'Nothing matches "zzzz"' });
    expect(await host.pick(P, "search", "m9")).toEqual({ open: "https://mail.google.com/mail/u/someone%40gmail.com/#all/t9" });
  });

  test("labels: yours first by name, then Gmail's in order and the categories; open, search here, copy; the table persisted", async () => {
    const rows = await list(P, "labels");
    expect(rows.map((r) => [r.id, r.name, r.section])).toEqual([
      ["label:Label_3", "Family/Trips", "Labels"], ["label:Label_1", "GitHub", "Labels"], ["label:Label_2", "Receipts", "Labels"],
      ["label:INBOX", "Inbox", "Gmail"], ["label:STARRED", "Starred", "Gmail"], ["label:IMPORTANT", "Important", "Gmail"], ["label:SENT", "Sent", "Gmail"], ["label:DRAFT", "Drafts", "Gmail"], ["label:SPAM", "Spam", "Gmail"], ["label:TRASH", "Trash", "Gmail"],
      ["label:CATEGORY_PERSONAL", "Personal", "Gmail"], ["label:CATEGORY_PROMOTIONS", "Promotions", "Gmail"], ["label:CATEGORY_UPDATES", "Updates", "Gmail"],
    ]);
    expect(rows[0].icon).toBe("\u{f0316}");
    expect(rows[3].icon).toBe("\u{f0687}");
    expect(await host.pick(P, "labels", "label:Label_3")).toEqual({ open: "https://mail.google.com/mail/u/someone%40gmail.com/#label/Family/Trips" });
    expect(await host.pick(P, "labels", "label:Label_1", "search")).toEqual({ push: { extension: "gmail", palette: "search", query: "label:GitHub " } });
    expect(await host.pick(P, "labels", "label:DRAFT", "search")).toEqual({ push: { extension: "gmail", palette: "search", query: "in:draft " } });
    expect(await host.pick(P, "labels", "label:Label_2", "copy")).toEqual({ copy: "Receipts" });
    expect((stored.get(`${P}\0labels`) as { labels: unknown[] }).labels).toHaveLength(14);
    expect((stored.get(`${W}\0labels`) as { labels: unknown[] }).labels).toHaveLength(12);
    expect((await list(W, "labels")).map((r) => r.name).slice(0, 2)).toEqual(["Reports", "Inbox"]);
  });

  test("compose: the row and the form with the signature (send on), nothing for the work instance; the send", async () => {
    const rows = await list(P, "compose");
    expect(rows).toEqual([{ id: "compose", name: "Compose", subtitle: "New message from someone@gmail.com", icon: "\u{f0ee3}", keywords: ["new", "mail", "email", "write", "Personal"], actions: [{ id: "new", title: "Compose" }] }]);
    expect(await list(W, "compose")).toEqual([]);
    const f = (await host.pick(P, "compose", "compose"))!.form!;
    expect(f.title).toBe("New message from someone@gmail.com");
    expect(f.fields.map((x) => x.id)).toEqual(["to", "cc", "subject", "body"]);
    expect((f.fields[3] as { default?: string }).default).toBe("\n\nCagdas");
    const again = (await host.pick(P, "compose", "compose", "send", { values: { to: "", cc: "", subject: "Hi", body: "x" } }))!.form!;
    expect(again.errors).toEqual({ to: "Required" });
    const before = mock.sent.length;
    expect(await host.pick(P, "compose", "compose", "send", { values: { to: "ola@example.com", cc: "", subject: "Cabin", body: "See you there.\n\nCagdas" } })).toEqual({ toast: { title: "Sent", message: "To ola@example.com: Cabin", style: "success" } });
    expect(mock.sent).toHaveLength(before + 1);
    expect(mock.sent.at(-1)!.threadId).toBeUndefined();
    expect(decodeRaw(mock.sent.at(-1)!.raw)).toContain("To: ola@example.com\r\nSubject: Cabin\r\n");
    expect(bodyText(mock.sent.at(-1)!.raw)).toBe("See you there.\n\nCagdas");
    expect(await host.pick(W, "compose", "compose")).toMatchObject({ toast: { title: "Compose is off", style: "failure" } });
    expect(mock.sent).toHaveLength(before + 1);
  });

  test("drafts: the rows (send on), send one after the confirm, discard one; nothing for the work instance", async () => {
    const rows = await list(P, "drafts");
    expect(rows.map((r) => [r.id, r.name, r.subtitle])).toEqual([["r1", "Packing list", "To Ola Berg · Boots, the good torch, cards."], ["r2", "(no subject)", "No recipient"]]);
    expect(rows[0].actions).toEqual([
      { id: "open", title: "Open in Gmail" },
      { id: "send", title: "Send draft", shortcut: "cmd+enter", confirm: 'Send "Packing list" to Ola Berg?' },
      { id: "discard", title: "Discard draft", shortcut: "cmd+d", style: "destructive", confirm: 'Discard "Packing list"?' },
    ]);
    expect(await host.pick(P, "drafts", "r1")).toEqual({ open: "https://mail.google.com/mail/u/someone%40gmail.com/#drafts/td1" });
    expect(await host.pick(P, "drafts", "r1", "send")).toEqual({ keep: true, toast: { title: "Sent", message: "Packing list" } });
    expect(mock.calls("/users/me/drafts/send").at(-1)!.body).toEqual({ id: "r1" });
    expect(await host.pick(P, "drafts", "r2", "discard")).toEqual({ keep: true, toast: { title: "Discarded", message: "(no subject)" } });
    expect(mock.calls("/users/me/drafts/r2").at(-1)!.method).toBe("DELETE");
    expect((await list(P, "drafts"))[0]).toMatchObject({ id: "hint:none", name: "No drafts" });
    expect(await list(W, "drafts")).toEqual([]);
    expect(mock.calls("/users/me/drafts").filter((c) => c.auth === "Bearer tok-work")).toHaveLength(0);
  });

  test("the bar item: the count as the badge with the instance's title, the popover's five with Open and Mark as read; per instance; shared with the palette", async () => {
    const n = mock.calls("/users/me/messages").length;
    await list(P, "inbox", "", { refresh: true });
    const item = await host.render(P, "unread", { reason: "show", instance: { key: P, name: P, title: "Personal", isDefault: true } });
    expect(item).toMatchObject({ icon: "\u{f01ee}", title: "Personal", badge: 4, tooltip: "4 unread messages in someone@gmail.com" });
    const menu = item.menu as Extract<typeof item.menu, unknown[]>;
    expect(menu[0]).toMatchObject({ type: "section", title: "Unread" });
    const subs = (menu[0] as { children: unknown[] }).children as { type: string; title: string; children: { id: string; title: string }[] }[];
    expect(subs.map((s) => [s.type, s.title])).toEqual([["submenu", "Mara Lind: Parser review before standup?"], ["submenu", "GitHub: [zcag/pal] Instances phase 2 (PR #81)"], ["submenu", "Acme Billing: Your September invoice"], ["submenu", "Ola Berg: Trip: cabin booked for October"]]);
    expect(subs[0].children.map((c) => [c.id, c.title])).toEqual([["open:m1", "Open in Gmail"], ["read:m1", "Mark as read"]]);
    expect(menu.slice(1)).toEqual([
      { type: "separator" },
      { type: "item", id: "open-pal", title: "Open in pal", subtitle: "4 unread messages, Mark as read and more", icon: "\u{f0687}" },
      { type: "item", id: "open-gmail", title: "Open Gmail", subtitle: "someone@gmail.com", icon: "\u{f01ee}" },
    ]);
    // The render right after the listing shared its inbox: three list calls for the refresh, none for the render.
    expect(mock.calls("/users/me/messages").length).toBe(n + 3);
    const w = await host.render(W, "unread", { reason: "every", instance: { key: W, name: P, title: "Work", isDefault: false } });
    expect(w).toMatchObject({ title: "Work", badge: 2, tooltip: "2 unread messages in someone@example.org" });
    expect(await host.barAction(W, "unread", "open-gmail")).toEqual({ open: "https://mail.google.com/mail/u/someone%40example.org/#inbox" });
    expect(await host.barAction(W, "unread", "open-pal")).toEqual({ push: { extension: W, palette: "inbox" } });
    expect(await host.barAction(W, "unread", "open:w2")).toEqual({ open: "https://mail.google.com/mail/u/someone%40example.org/#inbox/wt2" });
    expect(await host.barAction(W, "unread", "read:w2")).toEqual({ keep: true, hud: "Marked read" });
    expect(modifies().at(-1)).toEqual({ ids: ["w2"], removeLabelIds: ["UNREAD"] });
    await host.barAction(W, "unread", "read:w1");
    expect(await host.render(W, "unread", { reason: "update" })).toEqual({ hidden: true });
    await host.pick(W, "inbox", "w1", "unread", { ids: ["w1", "w2"] });
  });

  test("send turned off on the personal instance hides every write at once", async () => {
    host.changeSettings(P, { settings: { token_command: join(dir, "tok-personal.sh"), send: false, signature: "Cagdas" } });
    await Bun.sleep(50);
    const rows = await list(P, "inbox", "", { refresh: true });
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["open", "read", "copy"]);
    expect(await list(P, "compose")).toEqual([]);
    expect(await list(P, "drafts")).toEqual([]);
    expect(await host.pick(P, "inbox", "m1", "archive")).toMatchObject({ toast: { title: "Archive is off" } });
    host.changeSettings(P, { settings: { token_command: join(dir, "tok-personal.sh"), send: true, signature: "Cagdas", labels: ["Receipts"] } });
    await Bun.sleep(50);
  });

  test("a 401 mints the token again, once", async () => {
    personalToken = "tok-personal-2";
    mock.tokens["tok-personal-2"] = personal;
    delete mock.tokens["tok-personal"];
    writeFileSync(join(dir, "token.txt"), personalToken);
    const before = runs("personal");
    const rows = await list(P, "inbox", "", { refresh: true });
    expect(rows.map((r) => r.id)).toContain("m1");
    expect(runs("personal")).toBe(before + 1);
    expect(mock.seen.at(-1)!.auth).toBe("Bearer tok-personal-2");
  });

  test("a 429 is one hint row and every call until Retry-After is refused locally", async () => {
    mock.limited = true;
    try {
      const rows = await list(P, "inbox", "", { refresh: true });
      expect(rows[0]).toMatchObject({ id: "hint:limit", name: "Gmail rate limit reached", subtitle: expect.stringMatching(/^Retry at \d/) });
      const n = mock.seen.length;
      expect((await list(P, "search", "from:acme"))[0].id).toBe("hint:limit");
      expect(mock.seen.length).toBe(n);
      // The bar inside the window answers from the inbox it shares with the palette, with no request.
      expect(await host.render(P, "unread", { reason: "every" })).toMatchObject({ badge: 4 });
      expect(mock.seen.length).toBe(n);
      expect(await host.render(P, "unread", { reason: "cli" }).catch((e) => e.message)).toMatch(/rate limit reached/);
    } finally { mock.limited = false; }
    await Bun.sleep(1100);
    expect((await list(P, "inbox", "", { refresh: true })).map((r) => r.id)).toContain("m1");
  });

  test("token failures: a failing command is one hint row with its stderr and the settings action, an empty one names the fix, the bar hides", async () => {
    const h2 = await Host.bundled({
      core: { "instances.get": ({ extension }: { extension: string }) => (extension === P ? [{ key: P }, { key: "gmail@none", title: "None" }] : []) },
      settings: { [P]: { settings: { token_command: join(dir, "tok-broken.sh") } }, "gmail@none": { settings: {} } },
      timeout: 8000,
    });
    try {
      const rows = await h2.list(P, "inbox");
      expect(rows).toEqual([{ id: "hint:token", name: "Token command failed", subtitle: "Token command exited 7: curl: (7) Failed to connect to 127.0.0.1 port 8776", icon: "\u{f0026}", actions: [{ id: "settings", title: "Open Gmail settings" }] }]);
      expect(await h2.pick(P, "inbox", "hint:token")).toEqual({ open: "pal://settings/extensions?anchor=extensions:gmail:token_command" });
      expect(await h2.render(P, "unread", { reason: "load" })).toEqual({ hidden: true });
      const none = await h2.list("gmail@none", "inbox");
      expect(await h2.pick("gmail@none", "inbox", "hint:token")).toEqual({ open: "pal://settings/extensions?anchor=extensions:gmail@none:token_command" });
      expect(none[0]).toMatchObject({ id: "hint:token", name: "Token command is not set", subtitle: "Set one under Settings › Extensions › Gmail: a command that prints an access token" });
      expect((await h2.list("gmail@none", "labels"))[0].id).toBe("hint:token");
      expect(mock.seen.filter((s) => s.auth === "Bearer undefined")).toHaveLength(0);
    } finally { h2.kill(); }
  });

  test("a rejected token is one hint row naming the scopes", async () => {
    const h3 = await Host.bundled({
      core: { "instances.get": () => [] },
      settings: { [P]: { settings: { token_command: "echo tok-nobody" } } },
      timeout: 8000,
    });
    try {
      const rows = await h3.list(P, "inbox");
      expect(rows[0]).toMatchObject({ id: "hint:auth", name: "Gmail rejected the token", subtitle: "Request had invalid authentication credentials.: check the token command's scopes under Settings › Extensions › Gmail" });
      await expect(h3.render(P, "unread", { reason: "load" })).rejects.toThrow(/invalid authentication/);
    } finally { h3.kill(); }
  });
});
