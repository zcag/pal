// Writes app/src/gallery/shots/gmail.json and bar-gmail.json, the store
// screenshots' fixtures: every palette's rows, the panes, the forms and
// the bar item drawn through the host harness against the Gmail API
// stand-in the tests use (host/test/extensions/gmail-mock.ts), serving a
// made-up mailbox of its own (`BOX` below: a colleague's deck, a review
// request, a trip, an invoice, a few read ones, two drafts). One instance
// titled Personal, send on so Compose is there; the Gravatar probe is off,
// so every sender wears the initial's tile.
// `bun run extensions/gmail/fixture.ts`, then `make shots EXT=gmail`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinClock, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host, writeTool } from "../../host/test/harness.ts";
import { GmailMock, type Box, type Msg } from "../../host/test/extensions/gmail-mock.ts";

const SYSTEM = ["INBOX", "UNREAD", "STARRED", "IMPORTANT", "SENT", "DRAFT", "SPAM", "TRASH", "CATEGORY_PERSONAL", "CATEGORY_UPDATES", "CATEGORY_PROMOTIONS"].map((id) => ({ id, name: id, type: "system" as const }));
const ME = "sam@example.com";
const msg = (id: string, labelIds: string[], from: string, subject: string, date: string, snippet: string, o: Partial<Msg> = {}): Msg => ({ id, threadId: `t-${id}`, labelIds, from, to: ME, subject, date, snippet, text: snippet, ...o });
const BOX: Box = {
  address: ME,
  labels: [...SYSTEM, { id: "Label_1", name: "GitHub", type: "user" }, { id: "Label_2", name: "Receipts", type: "user" }, { id: "Label_3", name: "Family/Trips", type: "user" }],
  messages: [
    msg("u1", ["INBOX", "UNREAD", "IMPORTANT", "CATEGORY_PERSONAL"], "Mara Lind <mara@example.com>", "Slides for Thursday's review", "Wed, 16 Sep 2026 13:58:00 +0300", "Here's the deck for the quarterly review. Can you check the numbers on slide 6 before I send it around?", {
      text: "Here's the deck for the quarterly review. Can you check the numbers on slide 6 before I send it around?\n\nThe churn figure looks off to me, but it may be the new definition.\n\nMara\n\nOn Tue, 15 Sep 2026, Sam <sam@example.com> wrote:\n> Send it over when it's ready.",
      attachments: [{ filename: "q3-review.pdf", mimeType: "application/pdf", size: 2_184_330 }],
    }),
    msg("u2", ["INBOX", "UNREAD", "Label_1", "CATEGORY_UPDATES"], "GitHub <notifications@github.com>", "[acme/parser] Fix tokenizer on nested quotes (PR #214)", "Wed, 16 Sep 2026 13:21:00 +0300", "tomas-r requested your review on #214.", {
      text: undefined,
      html: "<p>tomas-r requested your review on <a href=\"https://github.com/acme/parser/pull/214\">#214</a>.</p><ul><li>Nested quotes close in the right order</li><li>Two new tests for escapes</li></ul><p>&#169; GitHub</p>",
    }),
    msg("u3", ["INBOX", "UNREAD", "STARRED", "Label_3"], "Ola Berg <ola@example.com>", "Cabin booked for October", "Wed, 16 Sep 2026 11:47:00 +0300", "Booked the cabin for the 10th to the 12th, check-in from 15:00. Details below.", {
      cc: "Tomas Ruiz <tomas@example.com>",
      text: "Booked the cabin for the 10th to the 12th, check-in from 15:00. Details below.\n\nIt sleeps six, so there's room if Lina wants to come. The key box code comes the day before.",
      attachments: [{ filename: "booking.pdf", mimeType: "application/pdf", size: 120_334 }, { filename: "map.png", mimeType: "image/png", size: 88_000 }],
    }),
    msg("u4", ["INBOX", "UNREAD", "Label_2"], "Acme Billing <billing@acme.example>", "Your September invoice", "Wed, 16 Sep 2026 09:05:00 +0300", "Invoice 2026-09 is attached: 14.00 USD, paid by card ending 4242.", {
      attachments: [{ filename: "invoice-2026-09.pdf", mimeType: "application/pdf", size: 48_213 }],
    }),
    msg("r1", ["INBOX", "CATEGORY_PERSONAL"], "Lina Kova <lina@example.com>", "Re: Dinner on Friday", "Tue, 15 Sep 2026 20:15:00 +0300", "Friday works, 19:30 at the usual place?"),
    msg("r2", ["INBOX", "Label_1", "CATEGORY_UPDATES"], "GitHub <notifications@github.com>", "[acme/parser] Release v2.3.0 published", "Tue, 15 Sep 2026 12:00:00 +0300", "Release v2.3.0 is out: faster tokenizer, two fixes."),
    msg("r3", ["INBOX", "CATEGORY_PROMOTIONS"], "Northwind Outdoor <news@northwind.example>", "Autumn sale starts now", "Mon, 14 Sep 2026 08:00:00 +0300", "Up to 40% off tents and sleeping bags this week.", { text: undefined, html: "<p>Up to <b>40%</b> off tents and sleeping bags this week.</p>" }),
    // Archived but unread, so the `labels` setting's Receipts section has something.
    msg("u5", ["UNREAD", "Label_2"], "Acme Billing <billing@acme.example>", "Your August invoice", "Sat, 15 Aug 2026 09:05:00 +0300", "Invoice 2026-08 is attached: 14.00 USD, paid by card ending 4242.", {
      attachments: [{ filename: "invoice-2026-08.pdf", mimeType: "application/pdf", size: 47_001 }],
    }),
    msg("s1", ["SENT"], ME, "Re: Slides for Thursday's review", "Tue, 15 Sep 2026 10:00:00 +0300", "Send it over when it's ready.", { to: "Mara Lind <mara@example.com>" }),
    msg("d1", ["DRAFT"], ME, "Packing list", "Wed, 16 Sep 2026 12:10:00 +0300", "Boots, the good torch, cards, the big thermos.", { to: "Ola Berg <ola@example.com>" }),
    msg("d2", ["DRAFT"], ME, "", "Tue, 15 Sep 2026 23:00:00 +0300", "", { to: "" }),
  ],
  drafts: [{ id: "r1", message: "d1" }, { id: "r2", message: "d2" }],
};

pinClock();
const dir = mkdtempSync(join(tmpdir(), "pal-gmail-fixture-"));
const mock = new GmailMock();
mock.tokens = { "tok-fixture": BOX };
writeTool(join(dir, "token.sh"), "#!/bin/sh\necho tok-fixture\n");
process.env.PAL_GMAIL_API = mock.url;
process.env.PAL_GMAIL_AVATARS = "";
const P = "gmail";
const host = await Host.bundled({
  core: { "instances.get": ({ extension }: { extension: string }) => (extension === P ? [{ key: P, title: "Personal" }] : []) },
  settings: { [P]: { settings: { token_command: join(dir, "token.sh"), address: ME, send: true, signature: "Sam", labels: ["Receipts"] } } },
  timeout: 8000,
});
try {
  const hosts = { [mock.url]: "https://gmail.googleapis.com" };
  // ---- the bar: the unread item and its popover -------------------------------------------
  const item = await host.render(P, "unread");
  writeFixture("bar-gmail", await settle({
    key: "gmail/unread",
    title: "Unread",
    item,
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar: the envelope with the unread count, the account's title beside it" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: every unread message with the sender, subject and time, a star or a paperclip; m marks one read, a marks them all" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the envelope, the account's title and the count" },
    },
  }, { hosts }));

  // ---- the panel: five palettes as the host lists them --------------------------------------
  const metas = Object.fromEntries(host.loaded().find((l) => l.extension === P)!.palettes.map((p) => [p.name, p]));
  const meta = (name: string) => { const { name: _n, count: _c, ...m } = metas[name] as typeof metas[string] & { count?: number }; return m; };
  const inbox = await host.list(P, "inbox");
  const details = Object.fromEntries(await Promise.all(inbox.filter((r) => r.section === "Unread").map(async (r) => [r.id, await host.detail(P, "inbox", r.id)])));
  const search = Object.fromEntries(await Promise.all(["", "has:attachment"].map(async (q) => [q, await host.list(P, "search", q)])));
  writeFixture("gmail", await settle({
    palettes: {
      inbox: { ...meta("inbox"), items: inbox, details },
      search: { ...meta("search"), byQuery: search },
      labels: { ...meta("labels"), items: await host.list(P, "labels") },
      compose: { ...meta("compose"), items: await host.list(P, "compose") },
      drafts: { ...meta("drafts"), items: await host.list(P, "drafts") },
    },
    effects: { "compose/compose": await host.pick(P, "compose", "compose", "new") },
    shots: {
      "1-inbox": { palette: "inbox", keys: ["down*2"], caption: "Inbox: unread first, the sender, the subject and the snippet, a star or a paperclip, the time" },
      "2-detail": { palette: "inbox", keys: ["cmd+i", "wait:400"], caption: "The pane: the message as text with the quote folded, who and when, the labels, the attachment and its size" },
      "3-search": { palette: "search", keys: ["type:has:attachment", "wait:400"], caption: "Search Mail: Gmail's own syntax typed into the panel, the hits sectioned by label" },
      "4-labels": { palette: "labels", keys: ["down"], caption: "Labels: yours and Gmail's, Enter opens one in Gmail, cmd+Enter searches it here" },
      "5-compose": { palette: "compose", keys: ["enter", "wait:300"], caption: "Compose: to, cc, subject and body, the signature already under it; only with send on" },
      "6-drafts": { palette: "drafts", keys: [], caption: "Drafts: the recipient and the subject; send or discard, each after asking" },
    },
  }, { hosts }));
  console.log("gmail.json, bar-gmail.json: four unread (a deck, a review request, a trip, an invoice), three read, two drafts");
} finally {
  host.kill();
  mock.stop();
  rmSync(dir, { recursive: true, force: true });
}
