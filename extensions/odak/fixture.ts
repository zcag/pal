// Writes app/src/gallery/shots/odak.json and bar-odak.json: the store
// screenshots' fixture. The rows, the add preview, the forms and the bar
// item come out of the real extension run through the host harness
// against the tests' mock server (host/test/extensions/odak-mock.ts), with
// a few more todos added so the listings look lived in; nothing here is
// the owner's. `bun run extensions/odak/fixture.ts`, then
// `node app/scripts/shots.mjs odak` and `node app/scripts/shots.mjs bar odak`.
import { writeFileSync } from "node:fs";
import { BUNDLED, Host, stored } from "../../host/test/harness.ts";
import { ITEMS, NOW, SETTINGS, idOf, server } from "../../host/test/extensions/odak-mock.ts";
import manifest from "./pal.json" with { type: "json" };

process.env.TZ = "Europe/Istanbul";
process.env.PAL_NOW = NOW;

// More of a list than the tests need.
for (const t of [
  { section: "Next", done: false, text: "Renew the passport before the trip", tags: ["personal"], deadline: "2026-09-24" },
  { section: "Backlog", done: false, text: "Move the vault's flows to one page", tags: ["personal"] },
  { section: "Backlog", done: false, text: "Compare the two hosting quotes https://example.com/quotes", tags: ["work"] },
  { section: "Someday", done: false, text: "Read the Dune sequels" },
  { section: "Inbox", done: false, text: "Ask Lina about the parser benchmark", tags: ["work"], urgent: true },
]) { const at = ITEMS.findLastIndex((x) => x.section === t.section); ITEMS.splice(at + 1, 0, { ...t, id: idOf(t) }); }

const icon = manifest.icon;

stored.clear();
delete process.env.PAL_ODAK_URL;
delete process.env.PAL_ODAK_KEY;
const host = await Host.bundled({ roots: [BUNDLED], settings: { odak: { settings: SETTINGS } }, timeout: 20000 });
try {
  const loaded = (await host.hello()).extensions.find((x) => x.name === "odak")!;
  const meta = (name: string) => loaded.palettes.find((p) => p.name === name)!;
  const todos = await host.list("odak", "odak");
  const addEmpty = await host.list("odak", "add", "");
  const addLine = await host.list("odak", "add", "call the bank about the card #personal ! fri");
  const searchEmpty = await host.list("odak", "search", "");
  const searchHits = await host.list("odak", "search", "personal");
  const done = await host.list("odak", "done");
  const dentist = todos.find((i) => i.name === "Book the dentist")!;
  const snooze = await host.pick("odak", "odak", dentist.id, "snooze");
  const edit = await host.pick("odak", "odak", dentist.id, "edit");
  const bar = await host.render("odak", "today", { reason: "cli" });

  const fixture = {
    palettes: {
      odak: { title: "Todos", icon, live: true, placeholder: meta("odak").placeholder, items: todos },
      add: { title: "Add Todo", icon, input: true, placeholder: meta("add").placeholder, byQuery: { "": addEmpty, "call the bank about the card #personal ! fri": addLine }, fallback: meta("add").fallbackTitle },
      search: { title: "Search Todos", icon, input: true, placeholder: meta("search").placeholder, byQuery: { "": searchEmpty, personal: searchHits } },
      done: { title: "Completed", icon, live: true, placeholder: meta("done").placeholder, items: done },
    },
    effects: {
      [`odak/${dentist.id}:snooze`]: snooze,
      [`odak/${dentist.id}:edit`]: edit,
    },
    shots: {
      "1-todos": { palette: "odak", keys: ["down*2", "wait:300"] },
      "2-add": { palette: "add", keys: ["type:call the bank about the card #personal ! fri", "wait:400"] },
      "3-snooze": { palette: "odak", keys: ["type:dentist", "wait:300", "cmd+s", "wait:400"] },
      "4-search": { palette: "search", keys: ["type:personal", "wait:400", "down*3", "wait:300"] },
      "5-edit": { palette: "odak", keys: ["type:dentist", "wait:300", "cmd+e", "wait:400"] },
      "6-completed": { palette: "done", keys: ["wait:300"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/odak.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");

  const barFixture = {
    key: "odak/today",
    title: manifest.bar.today.title,
    item: bar,
    states: [{ id: "quiet", item: { title: "3", tooltip: "3 today" } }],
    shots: {
      "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: today's count, red while anything is overdue" },
      "bar-menubar-light": { target: "menubar", theme: "light", caption: "The same item on a light menu bar" },
      "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the popover: the overdue first, then today's, Enter completes, n adds" },
      "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the glyph and the count" },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/bar-odak.json", import.meta.url), JSON.stringify(barFixture, null, 2) + "\n");
  console.log(`${todos.length} todo rows, ${searchHits.length} hits, ${done.length} completed, bar title ${bar.title}`);
} finally {
  await host.close();
  server.stop(true);
}
