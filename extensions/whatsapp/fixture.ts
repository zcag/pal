// Writes app/src/gallery/shots/whatsapp.json and bar-whatsapp.json, the
// store screenshots' fixtures: the palettes listed through the host
// harness against the OpenWA mock (host/test/extensions/whatsapp-mock.ts,
// invented people and messages, nothing the owner's) at the fixed clock,
// with `send` on so the message form shows, the pictures the mock serves
// inlined by `settle`, the bar item rendered the same way with its popover
// from view.ts. `bun run extensions/whatsapp/fixture.ts`, then
// `node app/scripts/shots.mjs whatsapp`.
import { writeFileSync } from "node:fs";
import { pinClock, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { View } from "../../sdk/src/protocol.ts";

// Before the mock and the harness load: the mock dates its messages by the SDK's clock, read once at load.
pinClock();
const { KEY, WhatsAppMock } = await import("../../host/test/extensions/whatsapp-mock.ts");
const { Host, stored } = await import("../../host/test/harness.ts");

const MARA = "254011223344556@lid";

const mock = new WhatsAppMock();
stored.clear();
const host = await Host.bundled({ settings: { whatsapp: { settings: { base_url: mock.url, api_key: KEY, send: true, open: "web" } } }, timeout: 8000 });

try {
  const l = host.loaded().find((l) => l.extension === "whatsapp")!;
  const [chats, unread, search, contacts] = l.palettes;
  // The pictures land from a background pass after the first listing; the second listing carries them.
  await host.list("whatsapp", "chats");
  await host.until(() => stored.has("whatsapp\0pictures"), 3000, "the picture pass");
  const chatRows = await host.list("whatsapp", "chats");
  const unreadRows = await host.list("whatsapp", "unread");
  const details = Object.fromEntries(await Promise.all(chatRows.slice(0, 3).map(async (r) => [r.id, await host.detail("whatsapp", "chats", r.id)])));
  const byQuery = { parser: await host.list("whatsapp", "search", "parser"), cabin: await host.list("whatsapp", "search", "cabin") };
  const contactRows = await host.list("whatsapp", "contacts");
  const form = (await host.pick("whatsapp", "chats", MARA, "reply")).form;
  const fixture = {
    palettes: {
      chats: { title: chats.title, icon: chats.icon, live: true, tier: chats.tier, placeholder: chats.placeholder, items: chatRows, details },
      unread: { title: unread.title, icon: unread.icon, live: true, placeholder: unread.placeholder, items: unreadRows, details },
      search: { title: search.title, icon: search.icon, input: true, placeholder: search.placeholder, byQuery },
      contacts: { title: contacts.title, icon: contacts.icon, tier: contacts.tier, placeholder: contacts.placeholder, items: contactRows },
    },
    effects: { [`chats/${MARA}:reply`]: { form } },
    shots: {
      "1-chats": { palette: "chats", keys: ["down"], caption: "Chats: unread first, the picture, the newest message and who sent it, the count, the time" },
      "2-detail": { palette: "chats", keys: ["cmd+i", "wait:400"], caption: "The pane: the last messages as a conversation, a quoted reply indented, a photo as [photo]" },
      "3-unread": { palette: "unread", keys: ["down"], caption: "Unread: direct messages then groups, the same keys" },
      "4-search": { palette: "search", keys: ["type:parser", "wait:500"], caption: "Search WhatsApp: the matching line, who said it where, when" },
      "5-contacts": { palette: "contacts", keys: ["down*3"], caption: "Contacts: each name with its number, a number alone when it has none; copy it or a vCard" },
      "6-message": { palette: "chats", keys: ["cmd+k", "wait:200", "type:Send a", "wait:200", "enter", "wait:300"], caption: "Send a message (send on): a form for the text, the latest message there to quote" },
    },
  };
  const hosts = { hosts: { [mock.url]: "https://wa.example" } };
  writeFixture("whatsapp", await settle(fixture, hosts));
  console.log(`whatsapp.json: ${chatRows.length} chats, ${unreadRows.length} unread, ${byQuery.parser.length} hits, ${contactRows.length} contacts`);

  // The bar item and its popover, the reply field as a second state; `cli` insists on a fresh list.
  const item = await host.render("whatsapp", "unread", { reason: "cli" });
  const view = (item.menu as { view: View }).view;
  await host.barAction("whatsapp", "unread", `focus:${MARA}`, { reason: "open", compact: true });
  const reply = (await host.barAction("whatsapp", "unread", "reply", { reason: "open", compact: true })).view as View;
  const bar = {
    key: "whatsapp/unread",
    title: "Unread",
    // The manifest's `dm` rule makes a direct message urgent (red) on the bar; the core applies it after render, so the fixture shows it as drawn.
    item: { ...item, urgent: true, refresh: 120, menu: { view } },
    states: [
      { id: "calm", item: { badge: 1, urgent: false, tooltip: "1 chat unread: 1 group", states: { unread: 1, direct: 0 } } },
      { id: "stale", item: { stale: true, tooltip: `${item.tooltip} (stale)` } },
      { id: "reply", item: { menu: { view: reply } } },
    ],
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar: the WhatsApp glyph with the count of unread chats, red while a direct message waits" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: direct messages then groups with the picture, the newest message and the time, the keys" },
      "popover-reply": { target: "menubar", popover: true, state: "reply", caption: "r turns the search row into a message field (send on); Enter sends it" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the glyph and the count" },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/bar-whatsapp.json", import.meta.url), JSON.stringify(await settle(bar, hosts)) + "\n");
  console.log(`bar-whatsapp.json: badge ${item.badge}, ${view.actions.length} actions`);
} finally {
  host.kill();
  mock.stop();
}
