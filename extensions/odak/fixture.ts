// Writes app/src/gallery/shots/odak.json and bar-odak.json: the store
// screenshots' fixture. The rows, the add preview, the forms and the bar
// item come out of the real extension run through the host harness
// against the tests' mock server (host/test/extensions/odak-mock.ts), with
// a few more todos added so the listings look lived in; nothing here is
// the owner's. The mock's days sit around the tests' clock (22 Sep); they
// move with it to the shots' (16 Sep), so an overdue stays overdue and
// today's today. `make shots EXT=odak`.
import { Host, stored } from "../../host/test/harness.ts";
import { BASE, ITEMS, NOW as MOCK_NOW, SETTINGS, idOf, server } from "../../host/test/extensions/odak-mock.ts";
import { NOW, pinClock, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import manifest from "./pal.json" with { type: "json" };

pinClock();
const DAY = 86400000;
const shift = Math.round((new Date(MOCK_NOW).getTime() - NOW) / DAY);
const moved = (iso?: string) => { if (!iso) return iso; const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() - shift); return d.toLocaleDateString("sv"); };

// More of a list than the tests need.
for (const t of [
  { section: "Next", done: false, text: "Renew the passport before the trip", tags: ["personal"], deadline: "2026-09-24" },
  { section: "Backlog", done: false, text: "Move the vault's flows to one page", tags: ["personal"] },
  { section: "Backlog", done: false, text: "Compare the two hosting quotes https://example.com/quotes", tags: ["work"] },
  { section: "Someday", done: false, text: "Read the rest of the trilogy" },
  { section: "Inbox", done: false, text: "Ask Lina about the parser benchmark", tags: ["work"], urgent: true },
]) { const at = ITEMS.findLastIndex((x) => x.section === t.section); ITEMS.splice(at + 1, 0, { ...t, id: idOf(t) }); }
// A day is part of odak's id: a moved line gets a new one (no parent carries a day).
for (const t of ITEMS) if (t.deadline || t.trigger) { t.deadline = moved(t.deadline); t.trigger = moved(t.trigger); t.id = idOf(t); }

const icon = manifest.icon;

stored.clear();
delete process.env.PAL_ODAK_URL;
delete process.env.PAL_ODAK_KEY;
const host = await Host.bundled({ settings: { odak: { settings: SETTINGS } }, timeout: 20000 });
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
      "1-todos": { palette: "odak", keys: ["down*2", "wait:300"], caption: "Every todo by section, the overdue and today's on top, a subtask under its parent; Enter completes" },
      "2-add": { palette: "add", keys: ["type:call the bank about the card #personal ! fri", "wait:400"], caption: "One line adds a todo: #tag, ! for urgent and a day in words, read back as you type" },
      "3-snooze": { palette: "odak", keys: ["type:dentist", "wait:300", "cmd+s", "wait:400"], caption: "Snooze to tomorrow, next Monday or a day typed in words" },
      "4-search": { palette: "search", keys: ["type:personal", "wait:400", "down*3", "wait:300"], caption: "Search reaches open and completed todos alike, by text or by tag" },
      "5-edit": { palette: "odak", keys: ["type:dentist", "wait:300", "cmd+e", "wait:400"], caption: "Edit everything in one form: the text, the section, the tags and the day" },
      "6-completed": { palette: "done", caption: "Completed lists what is checked off; Enter reopens one" },
    },
  };
  const hosts = { [BASE]: "https://odak.example.com" };
  writeFixture("odak", await settle(fixture, { hosts }));

  const barFixture = {
    key: "odak/today",
    title: manifest.bar.today.title,
    // One overdue: the manifest's `overdue` rule (core applies rules; the gallery draws the item as rendered).
    item: { ...bar, color: manifest.bar.today.rules.find((r) => r.id === "overdue")!.color },
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar: today's count, red while anything is overdue" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the overdue first, then today's, Enter completes, n adds" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the glyph and the count, red for the overdue one" },
    },
  };
  writeFixture("bar-odak", await settle(barFixture, { hosts }));
  console.log(`${todos.length} todo rows, ${searchHits.length} hits, ${done.length} completed, bar title ${bar.title}`);
} finally {
  await host.close();
  server.stop(true);
}
