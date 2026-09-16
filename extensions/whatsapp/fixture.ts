// Writes app/src/gallery/shots/whatsapp.json and bar-whatsapp.json, the
// store screenshots' fixtures: the palettes listed through the host
// harness against the OpenWA mock (host/test/extensions/whatsapp-mock.ts,
// invented people and messages, nothing the owner's) with `send` on so
// the message form shows, the pictures the mock serves inlined as data
// urls (the gallery has no mock to fetch from), the bar item rendered
// the same way with its popover from view.ts. `bun run
// extensions/whatsapp/fixture.ts`, then `node app/scripts/shots.mjs
// whatsapp` and `node app/scripts/shots.mjs bar whatsapp`.
import { writeFileSync } from "node:fs";
import type { Item, View } from "../../sdk/src/protocol.ts";
import { KEY, WhatsAppMock } from "../../host/test/extensions/whatsapp-mock.ts";
import { Host, stored } from "../../host/test/harness.ts";

const MARA = "254011223344556@lid";

const mock = new WhatsAppMock();
stored.clear();
const host = await Host.bundled({ settings: { whatsapp: { settings: { base_url: mock.url, api_key: KEY, send: true, open: "web" } } }, timeout: 8000 });

/** The mock's picture urls as data urls, so the gallery draws them without the mock. */
const inlined = new Map<string, string>();
async function inline(items: Item[]): Promise<Item[]> {
  for (const it of items) {
    const src = it.icon && typeof it.icon === "object" && "image" in it.icon ? it.icon.image : undefined;
    if (!src?.startsWith("http")) continue;
    let data = inlined.get(src);
    if (!data) {
      const r = await fetch(src);
      data = `data:${r.headers.get("content-type")?.split(";")[0]};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
      inlined.set(src, data);
    }
    it.icon = { image: data };
  }
  return items;
}

try {
  const l = host.loaded().find((l) => l.extension === "whatsapp")!;
  const [chats, unread, search, contacts] = l.palettes;
  // The pictures land from a background pass after the first listing; the second listing carries them.
  await host.list("whatsapp", "chats");
  await host.until(() => stored.has("whatsapp\0pictures"), 3000, "the picture pass");
  const chatRows = await inline(await host.list("whatsapp", "chats"));
  const unreadRows = await inline(await host.list("whatsapp", "unread"));
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
      "1-chats": { palette: "chats", keys: ["down"] },
      "2-detail": { palette: "chats", keys: ["cmd+i", "wait:400"] },
      "3-unread": { palette: "unread", keys: ["down"] },
      "4-search": { palette: "search", keys: ["type:parser", "wait:500"] },
      "5-contacts": { palette: "contacts", keys: ["down*3"] },
      "6-message": { palette: "chats", keys: ["cmd+k", "wait:200", "type:Send a", "wait:200", "enter", "wait:300"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/whatsapp.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log(`whatsapp.json: ${chatRows.length} chats, ${unreadRows.length} unread, ${byQuery.parser.length} hits, ${contactRows.length} contacts`);

  // The bar item and its popover, the reply field as a second state; `cli` insists on a fresh list.
  const item = await host.render("whatsapp", "unread", { reason: "cli" });
  const view = (item.menu as { view: View }).view;
  await host.barAction("whatsapp", "unread", `focus:${MARA}`, { reason: "open", compact: true });
  const reply = (await host.barAction("whatsapp", "unread", "reply", { reason: "open", compact: true })).view as View;
  const bar = {
    key: "whatsapp/unread",
    title: "Unread",
    item: { ...item, refresh: 120, menu: { view } },
    states: [
      { id: "calm", item: { badge: 1, urgent: false, tooltip: "1 chat unread: 1 group" } },
      { id: "stale", item: { stale: true, tooltip: `${item.tooltip} (stale)` } },
      { id: "reply", item: { menu: { view: reply } } },
    ],
    shots: {
      "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: the WhatsApp glyph with the count of unread chats, red while a direct chat waits" },
      "bar-menubar-light": { target: "menubar", theme: "light", caption: "The same item on a light menu bar" },
      "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the popover: direct messages then groups with the picture, the newest message and the time, the keys" },
      "bar-menubar-popover-dark": { target: "menubar", theme: "dark", popover: true, caption: "The popover in the dark theme" },
      "bar-menubar-popover-reply": { target: "menubar", theme: "light", popover: true, state: "reply", caption: "r turns the search row into a message field (send on); Enter sends it" },
      "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the glyph and the count" },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/bar-whatsapp.json", import.meta.url), JSON.stringify(bar) + "\n");
  console.log(`bar-whatsapp.json: badge ${item.badge}, ${view.actions.length} actions`);
} finally {
  host.kill();
  mock.stop();
}
