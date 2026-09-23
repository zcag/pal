// odak against a local mock of the server (odak-mock.ts: the REST routes
// over an in-memory list with odak's own quirks). The clock is pinned to
// Tuesday 22 September 2026 (`PAL_NOW` through the harness) so the days
// read the same on every run. The rows and sections of each palette, the
// writes (complete with Undo, snooze, move, edit, the flag, delete, add
// in every way), the bar item and its popover, the link route, and the
// hint rows naming the fix for a missing address, a missing or refused
// key and a server that does not answer.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { checkView } from "../../../sdk/src/index.ts";
import type { Form, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";
import { BASE, ITEMS, NOW, SETTINGS, calls, idOf, reset, seen, server, state } from "./odak-mock.ts";

process.env.TZ = "Europe/Istanbul";
process.env.PAL_NOW = NOW;

let host: Host;
/** What the harness answers for the front app's selection and the clipboard: the tests set them. */
const os = { selection: null as string | null, clipboard: null as string | null };
beforeAll(async () => {
  stored.clear();
  delete process.env.PAL_ODAK_URL;
  delete process.env.PAL_ODAK_KEY;
  host = await Host.bundled({
    settings: { odak: { settings: SETTINGS } },
    core: {
      "selection.text": () => os.selection,
      "clipboard.current": () => (os.clipboard === null ? null : { id: 9, kind: "text", text: os.clipboard, image: null, files: null, source_app: null, at: 1, bytes: os.clipboard.length, pinned: false, width: null, height: null, name: null }),
    },
  });
});
afterAll(() => { host.kill(); server.stop(true); delete process.env.PAL_NOW; });

const list = (palette: string, query?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("odak", palette, query, ctx);
const pick = (palette: string, id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("odak", palette, id, action, ctx);
/** The mock's todo whose text starts so; `id` copies the id out, since an edit gives the mock's object a new one in place. */
const item = (start: string) => { const t = ITEMS.find((x) => x.text.startsWith(start)); if (!t) throw new Error(`no item ${start}`); return t; };
const id = (start: string) => item(start).id;
/** The key of the node wearing the cursor ring. */
const selectedKey = (n: ViewNode): string | undefined => (n.selected ? n.key : n.type === "stack" ? n.children.map(selectedKey).find(Boolean) : undefined);
const texts = (n: ViewNode): string[] => (n.type === "text" ? [n.value] : n.type === "stack" ? n.children.flatMap(texts) : n.type === "tile" ? [`(${n.text})`] : []);
const viewOf = (x: unknown): View => { const v = (x as { view?: View; menu?: { view?: View } }).view ?? (x as { menu?: { view?: View } }).menu?.view; if (!v) throw new Error("no view"); return v; };
/** A fresh list from the server: the cache is dropped through a refresh listing. */
const fresh = () => list("odak", undefined, { refresh: true });

describe("odak", () => {
  // A write fetches behind itself; a beat lets the last test's land before the list is seeded again, so a refresh never joins a fetch of the old state.
  beforeEach(async () => { await Bun.sleep(20); reset(); await fresh(); seen.length = 0; });

  test("meta: Todos and Completed live with the manifest's ttl, lazy and multi; Add and Search input, Add with the fallback row and Todos with suggestions; the bar item, the states, the link, the four settings", () => {
    const l = host.loaded().find((x) => x.extension === "odak")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((m) => [m.name, m.input, m.live, m.ttl, m.lazy, m.multi])).toEqual([["odak", false, true, 60, true, true], ["add", true, false, undefined, undefined, undefined], ["search", true, false, undefined, undefined, undefined], ["done", false, true, 60, true, true]]);
    expect(l.palettes[0]).toMatchObject({ title: "Todos", suggest: true });
    expect(l.palettes[1]).toMatchObject({ title: "Add Todo", fallback: "ask", fallbackTitle: "Add “{query}” to odak" });
    expect(l.bar).toEqual([{ id: "today", title: "Today", description: expect.any(String), mocks: expect.any(Object), refresh: { every: 300, on: ["show", "wake", "network"] }, keys: expect.any(Array), rules: [expect.objectContaining({ id: "quiet", hidden: true }), expect.objectContaining({ id: "overdue", color: "red" })], source: true }]);
    expect(Object.keys(l.manifest.states!)).toEqual(["overdue", "today", "open"]);
    expect(Object.keys(l.manifest.links!.add.params!)).toEqual(["text", "section", "due", "tags", "urgent"]);
    expect(host.manifests.get("odak")!.settings!.map((s) => [s.id, s.kind])).toEqual([["url", "text"], ["api_key", "secret"], ["default_section", "text"], ["today_sections", "list"]]);
  });

  describe("Todos", () => {
    test("the rows: the two commands, then Overdue and Due today, then the file's sections in order with a subtask under its parent, a waiting one at the end; one GET for the list and one for the sections", async () => {
      const items = await list("odak");
      expect(items.slice(0, 2).map((i) => [i.id, i.name])).toEqual([["cmd:add", "New todo"], ["cmd:open", "Open odak"]]);
      expect(items.slice(2).map((i) => [i.section, i.name])).toEqual([
        ["Overdue", "Call the bank about the card"],
        ["Due today", "Review the parser PR https://github.com/example/pal/pull/42"],
        ["Focus", "Ship the release notes"],
        ["Focus", "Write the changelog entry"],
        ["Next", "Book the dentist"],
        ["Next", "Pick a marketing project to start"],
        ["Someday", "Learn the accordion"],
        ["Inbox", "Check the alt text idea"],
        ["Not yet", "Visa appointment confirmation"],
      ]);
      seen.length = 0;
      await fresh();
      expect(calls("GET", "/todos")).toHaveLength(1);
      expect(calls("GET", "/sections")).toHaveLength(1);
    });

    test("a row: the tags and the day as tags in their colours, the flag as a red mark, the subtask count, the parent under a subtask, the waiting day; the keywords carry the section, the tags and the day", async () => {
      const items = await list("odak");
      const bank = items.find((i) => i.name.startsWith("Call the bank"))!;
      expect(bank.accessories).toEqual([{ tag: "personal", color: "violet" }, { tag: "overdue 3 d", color: "red" }]);
      expect(bank.icon).toBe("\u{f0130}");
      expect(bank.keywords).toEqual(["Today", "personal", "overdue"]);
      const ship = items.find((i) => i.name === "Ship the release notes")!;
      expect(ship.icon).toEqual({ glyph: "\u{f0028}", color: "red" });
      expect(ship.accessories).toEqual([{ tag: "work", color: "pink" }, { text: "1 subtask" }]);
      expect(ship.keywords).toContain("urgent");
      const child = items.find((i) => i.name === "Write the changelog entry")!;
      expect(child.subtitle).toBe("↳ Ship the release notes");
      expect(items.find((i) => i.name === "Book the dentist")!.accessories).toEqual([{ tag: "personal", color: "violet" }, { tag: "Sat", color: "grey" }]);
      expect(items.find((i) => i.name.startsWith("Visa"))!.accessories).toEqual([{ tag: "personal", color: "violet" }, { tag: "from Sat 3 Oct", color: "grey" }]);
    });

    test("the actions: Complete first, the rest on their keys, Open link only on a row with a link, Delete asks", async () => {
      const items = await list("odak");
      const pr = items.find((i) => i.name.startsWith("Review the parser"))!;
      expect(pr.actions!.map((a) => [a.id, a.shortcut])).toEqual([["complete", undefined], ["edit", "cmd+e"], ["tomorrow", "cmd+t"], ["snooze", "cmd+s"], ["move", "cmd+m"], ["urgent", "cmd+u"], ["subtask", "cmd+n"], ["link", "cmd+l"], ["open", "cmd+o"], ["copy", "cmd+c"], ["copy-link", "cmd+shift+c"], ["delete", "cmd+d"]]);
      expect(pr.actions!.at(-1)).toMatchObject({ style: "destructive", multi: true, confirm: expect.stringContaining("subtasks") });
      const ship = items.find((i) => i.name === "Ship the release notes")!;
      expect(ship.actions!.map((a) => a.id)).not.toContain("link");
      expect(ship.actions!.find((a) => a.id === "urgent")!.title).toBe("Not urgent");
    });

    test("the pane: the text bold with the subtasks as a task list; section, tags, urgent, due with the day, under, subtasks, link, id", async () => {
      const items = await list("odak");
      const ship = items.find((i) => i.name === "Ship the release notes")!;
      expect(ship.detail!.markdown).toBe("**Ship the release notes**\n\n- [ ] Write the changelog entry");
      expect(ship.detail!.metadata!.map((m) => m.label)).toEqual(["Section", "Tags", "Urgent", "Subtasks", "Id"]);
      const pr = items.find((i) => i.name.startsWith("Review the parser"))!;
      expect(pr.detail!.metadata!.find((m) => m.label === "Due")).toEqual({ label: "Due", value: "Tue 22 Sep 2026 (today)" });
      expect(pr.detail!.metadata!.find((m) => m.label === "Link")).toEqual({ label: "Link", link: { text: "github.com/example/pal/pull/42", href: "https://github.com/example/pal/pull/42" } });
      const child = items.find((i) => i.name === "Write the changelog entry")!;
      expect(child.detail!.metadata!.find((m) => m.label === "Under")).toEqual({ label: "Under", value: "Ship the release notes" });
    });

    test("the commands: New todo takes the text in the bar (a form without it; the todo with it, through the add grammar), cmd+enter opens Add Todo; Open odak opens the server", async () => {
      const add = (await list("odak")).find((i) => i.id === "cmd:add")!;
      expect(add.args).toEqual([{ id: "text", placeholder: "Todo", required: true }]);
      expect(add.actions).toEqual([{ id: "add", title: "Add", args: true }, { id: "palette", title: "Open Add Todo", shortcut: "cmd+enter" }]);
      expect((await pick("odak", "cmd:add")).form).toMatchObject({ title: "New todo", submit: { id: "add", title: "Add" } });
      expect(((await pick("odak", "cmd:add", "add", { values: { text: " " } })).form as Form).errors).toEqual({ text: "Required" });
      expect(await pick("odak", "cmd:add", "palette")).toEqual({ push: { extension: "odak", palette: "add" } });
      expect(await pick("odak", "cmd:add", "add", { values: { text: "water the garden #home tomorrow" } })).toEqual({ hud: "Added to Inbox: water the garden" });
      expect(calls("POST", "/todos").at(-1)!.body).toEqual({ text: "water the garden", section: "Inbox", tags: ["home"], deadline: "2026-09-23" });
      expect((await list("odak")).find((i) => i.name === "water the garden")).toMatchObject({ section: "Inbox", accessories: [{ tag: "home", color: expect.any(String) }, { tag: "tomorrow", color: "blue" }] });
      expect(await pick("odak", "cmd:open")).toEqual({ open: BASE });
    });

    test("Complete: the toast, the row gone at once from the patched cache (one PATCH, no GET), an Undo row at the top that reopens it; the time kept for Completed", async () => {
      const bank = id("Call the bank");
      expect(await pick("odak", bank)).toEqual({ keep: true, toast: { title: "Done", message: "Call the bank about the card" } });
      expect(calls("PATCH", `/todos/${bank}/done`)).toHaveLength(1);
      const gets = calls("GET", "/todos").length;
      const items = await list("odak");
      expect(calls("GET", "/todos").length).toBe(gets);
      expect(items.map((i) => i.id)).not.toContain(bank);
      expect(items[2]).toMatchObject({ id: "undo", name: "Undo: reopen Call the bank about the card", subtitle: "Completed just now" });
      expect(stored.get("odak\0completed")).toEqual({ [bank]: Date.parse(NOW) });
      const done = await list("done");
      expect(done.map((i) => [i.section, i.name])).toEqual([["Today", "Call the bank about the card"], ["Today", "Water the plants"], ["Inbox", "Renew the domain"]]);
      expect(done[0].accessories).toEqual([{ tag: "personal", color: "violet" }, { date: Date.parse(NOW) }]);
      expect(done[0].actions!.map((a) => a.id)).toEqual(["reopen", "copy", "open", "delete"]);
      expect(await pick("odak", "undo")).toEqual({ keep: true, toast: { title: "Reopened", message: "Call the bank about the card" } });
      expect((await list("odak")).map((i) => i.id)).toContain(bank);
      expect(item("Call the bank").done).toBe(false);
    });

    test("several marked rows complete as one pick; Reopen from Completed", async () => {
      const a = id("Book the dentist"), b = id("Learn the accordion");
      expect(await pick("odak", a, "complete", { ids: [a, b] })).toEqual({ keep: true, toast: { title: "Done", message: "2 todos" } });
      expect(ITEMS.filter((t) => t.done).map((t) => t.text)).toContain("Learn the accordion");
      expect(await pick("done", a, "reopen", { ids: [a, b] })).toEqual({ keep: true, toast: { title: "Reopened", message: "2 todos" } });
      expect(item("Book the dentist").done).toBe(false);
    });

    test("Snooze to tomorrow writes the day with the flag kept; Snooze… is a form whose typed day wins over the choice, and a day it cannot read stays in the form", async () => {
      const ship = id("Ship the release notes");
      expect(await pick("odak", ship, "tomorrow")).toEqual({ keep: true, toast: { title: "Snoozed to Wed 23 Sep", message: "Ship the release notes" } });
      expect(calls("PATCH", `/todos/${ship}`)[0].body).toEqual({ deadline: "2026-09-23", urgent: true });
      const dentist = id("Book the dentist");
      const f = (await pick("odak", dentist, "snooze")).form as Form;
      expect(f.fields.map((x) => x.id)).toEqual(["day", "typed"]);
      expect((f.fields[0] as { options: { id: string; title: string }[] }).options).toEqual([
        { id: "2026-09-23", title: "Tomorrow, Wed 23 Sep" }, { id: "2026-09-25", title: "In 3 days, Fri 25 Sep" }, { id: "2026-09-28", title: "Next Monday, Mon 28 Sep" }, { id: "2026-09-29", title: "Next week, Tue 29 Sep" }, { id: "2026-10-22", title: "In a month, Thu 22 Oct" },
      ]);
      expect(((await pick("odak", dentist, "snooze:save", { values: { day: "2026-09-25", typed: "whenever" } })).form as Form).errors).toEqual({ typed: expect.stringContaining("Not a day") });
      expect(await pick("odak", dentist, "snooze:save", { values: { day: "2026-09-25", typed: "in 2 weeks" } })).toEqual({ keep: true, toast: { title: "Snoozed to Tue 6 Oct", message: "Book the dentist" } });
      expect(item("Book the dentist").deadline).toBe("2026-10-06");
      expect((await list("odak")).find((i) => i.name === "Book the dentist")!.id).toBe(id("Book the dentist"));
      expect(await pick("odak", id("Book the dentist"), "snooze:save", { values: { day: "2026-09-28", typed: "" } })).toMatchObject({ toast: { title: "Snoozed to Mon 28 Sep" } });
    });

    test("Move… lists the file's sections with the row's chosen; the move lands the line at the end of the new section, subtasks along", async () => {
      const ship = id("Ship the release notes");
      const f = (await pick("odak", ship, "move")).form as Form;
      expect(f.fields[0]).toMatchObject({ kind: "select", default: "Focus", options: [{ id: "Focus", title: "Focus" }, { id: "Today", title: "Today" }, { id: "Next", title: "Next" }, { id: "Waiting", title: "Waiting" }, { id: "Backlog", title: "Backlog" }, { id: "Someday", title: "Someday" }, { id: "Inbox", title: "Inbox" }] });
      expect(await pick("odak", ship, "move:save", { values: { section: "Next" } })).toEqual({ keep: true, toast: { title: "Moved to Next", message: "Ship the release notes" } });
      expect((await list("odak")).filter((i) => i.section === "Next").map((i) => i.name)).toEqual(["Book the dentist", "Pick a marketing project to start", "Ship the release notes", "Write the changelog entry"]);
      expect(ITEMS.filter((t) => t.section === "Next").map((t) => t.text).slice(-2)).toEqual(["Ship the release notes", "Write the changelog entry"]);
    });

    test("Edit…: the form holds the todo; Save writes text, tags, the flag and a day, moves when the section changed, and the row comes back under its new id; a cleared day is refused with the reason", async () => {
      const idea = id("Check the alt text idea");
      const f = (await pick("odak", idea, "edit")).form as Form;
      expect(f.fields.map((x) => [x.id, x.kind, x.default])).toEqual([["text", "text", "Check the alt text idea"], ["section", "select", "Inbox"], ["tags", "text", "work, idea"], ["due", "text", ""], ["urgent", "checkbox", false]]);
      expect(await pick("odak", idea, "edit:save", { values: { text: "Check the alt text idea in parsing", section: "Next", tags: "#work, idea parsing", due: "fri", urgent: true } })).toEqual({ keep: true, toast: { title: "Saved", message: "Check the alt text idea in parsing" } });
      expect(calls("PATCH", `/todos/${idea}`)[0].body).toEqual({ text: "Check the alt text idea in parsing", tags: ["work", "idea", "parsing"], urgent: true, deadline: "2026-09-25" });
      // The move goes to the id the edit gave the line, computed here as odak does.
      expect(calls("POST", `/todos/${id("Check the alt text idea in parsing")}/move`)[0].body).toEqual({ section: "Next" });
      const row = (await list("odak")).find((i) => i.name === "Check the alt text idea in parsing")!;
      expect(row).toMatchObject({ section: "Next", icon: { glyph: "\u{f0028}", color: "red" }, accessories: [{ tag: "work", color: "pink" }, { tag: "idea", color: "green" }, { tag: "parsing", color: expect.any(String) }, { tag: "Fri", color: "grey" }] });
      const renamed = id("Check the alt text idea in parsing");
      expect(renamed).not.toBe(idea);
      expect(row.id).toBe(renamed);
      expect(((await pick("odak", renamed, "edit:save", { values: { text: "x", section: "Next", tags: "", due: "", urgent: false } })).form as Form).errors).toEqual({ due: expect.stringContaining("keeps a day") });
    });

    test("Mark urgent flips the flag; Copy, Copy link (the todo's, else odak's), Open link, Open odak, Add subtask", async () => {
      const acc = id("Learn the accordion");
      expect(await pick("odak", acc, "urgent")).toEqual({ keep: true, toast: { title: "Urgent", message: "Learn the accordion" } });
      expect(calls("PATCH", `/todos/${acc}`)[0].body).toEqual({ urgent: true });
      const pr = id("Review the parser");
      expect(await pick("odak", pr, "copy")).toEqual({ copy: item("Review the parser").text });
      expect(await pick("odak", pr, "copy-link")).toEqual({ copy: "https://github.com/example/pal/pull/42" });
      expect(await pick("odak", pr, "link")).toEqual({ open: "https://github.com/example/pal/pull/42" });
      // The flag rewrote the line, so the todo has a new id on the server and in the cache alike; the old one is a failure toast.
      expect(id("Learn the accordion")).not.toBe(acc);
      expect((await list("odak")).find((i) => i.name === "Learn the accordion")!.id).toBe(id("Learn the accordion"));
      expect(await pick("odak", acc, "copy-link")).toMatchObject({ toast: { title: "Not there any more" } });
      expect(await pick("odak", id("Learn the accordion"), "copy-link")).toEqual({ copy: BASE });
      expect(await pick("odak", id("Learn the accordion"), "open")).toEqual({ open: BASE });
      expect(await pick("odak", pr, "subtask")).toEqual({ push: { extension: "odak", palette: "add", args: { parent: pr }, title: "Subtask of Review the parser PR https://…" } });
    });

    test("Delete takes the subtasks; a todo gone in odak meanwhile is a failure toast, not an error", async () => {
      const ship = id("Ship the release notes");
      expect(await pick("odak", ship, "delete")).toEqual({ keep: true, toast: { title: "Deleted", message: "Ship the release notes" } });
      expect(ITEMS.some((t) => t.text === "Write the changelog entry")).toBe(false);
      expect((await list("odak")).map((i) => i.name)).not.toContain("Write the changelog entry");
      expect(await pick("odak", "deadbeef")).toEqual({ keep: true, toast: { title: "Not there any more", message: expect.any(String), style: "failure" } });
    });

    test("the root's Now section: what is overdue or due today, from the cache alone", async () => {
      const r = await host.request<{ extension: string; palette: string; items: { name: string; section?: string }[] }[]>("suggest", {});
      const mine = r.find((s) => s.extension === "odak")!;
      expect(mine.items.map((i) => [i.section, i.name])).toEqual([["Todos", "Call the bank about the card"], ["Todos", "Review the parser PR https://github.com/example/pal/pull/42"]]);
    });
  });

  describe("Add Todo", () => {
    test("the line read back as you type: the text, the section, the day, the flag and the tags; a line of only tokens is a hint", async () => {
      const [row] = await list("add", "call mum #personal ! next mon 9am /ne");
      expect(row).toMatchObject({ id: "new:call mum #personal ! next mon 9am /ne", name: "call mum 9am", subtitle: "Next · due Mon 28 Sep · urgent", icon: { glyph: "\u{f0028}", color: "red" }, accessories: [{ tag: "personal", color: "violet" }, { tag: "Mon", color: "grey" }] });
      expect(row.actions!.map((a) => a.id)).toEqual(["add", "another", "copy-line"]);
      expect((await list("add", "buy milk"))[0].subtitle).toBe("Inbox");
      expect((await list("add", "#work !"))[0]).toMatchObject({ id: "hint:empty", name: "Nothing to add yet" });
    });

    test("Enter adds and hides with the HUD line; the POST carries what was read; cmd+enter keeps the panel with a toast; Copy the line", async () => {
      expect(await pick("add", "new:call mum #personal ! next mon 9am /ne")).toEqual({ hud: "Added to Next: call mum 9am" });
      expect(calls("POST", "/todos").at(-1)!.body).toEqual({ text: "call mum 9am", section: "Next", tags: ["personal"], urgent: true, deadline: "2026-09-28" });
      expect((await list("odak")).find((i) => i.name === "call mum 9am")).toMatchObject({ section: "Next" });
      expect(await pick("add", "new:read the brief", "another")).toEqual({ keep: true, toast: { title: "Added to Inbox", message: "read the brief" } });
      expect(await pick("add", "new:read the brief", "copy-line")).toEqual({ copy: "read the brief" });
    });

    test("before anything is typed: what to type, what was just added with Undo, the selection and the clipboard as todos (Enter adds as typed, cmd+enter edits first)", async () => {
      await pick("add", "new:read the brief");
      os.selection = "Renew the passport before  the trip";
      os.clipboard = "https://example.com/a-thing-to-read";
      const rows = await list("add", "");
      expect(rows.map((r) => r.id)).toEqual(["hint:type", "added:" + id("read the brief"), "sel:Renew the passport before the trip", "clip:https://example.com/a-thing-to-read"]);
      expect(rows[0].subtitle).toContain("Lands in Inbox");
      expect(rows[1]).toMatchObject({ name: "Added to Inbox: read the brief", actions: [{ id: "undo-add", title: "Undo (delete it)", style: "destructive" }] });
      expect(rows[2]).toMatchObject({ name: "Add the selected text: Renew the passport before the trip", subtitle: "As typed, into Inbox" });
      expect(await pick("add", rows[2].id, "edit")).toEqual({ push: { extension: "odak", palette: "add", query: "Renew the passport before the trip" } });
      expect(await pick("add", rows[3].id)).toEqual({ hud: "Added to Inbox: https://example.com/a-thing-to-read" });
      expect(await pick("add", rows[1].id, "undo-add")).toEqual({ keep: true, toast: { title: "Deleted", message: "The todo just added is gone" } });
      expect(ITEMS.some((t) => t.text === "read the brief")).toBe(false);
      os.selection = null;
      os.clipboard = null;
      expect((await list("add", "")).map((r) => r.id)).toEqual(["hint:type"]);
    });

    test("pushed for a subtask: the hint names the parent, the todo lands under it in the parent's section", async () => {
      const pr = id("Review the parser");
      const ctx = { args: { parent: pr } };
      expect((await list("add", "", ctx))[0]).toMatchObject({ id: "hint:parent", name: "Subtask of Review the parser PR https://github.com/example/pal/pull/42" });
      expect((await list("add", "run the tests /next", ctx))[0].subtitle).toBe("Subtask of Review the parser PR https://github.com…");
      expect(await pick("add", "new:run the tests", undefined, ctx)).toEqual({ hud: "Added to Focus under Review the parser PR https://…: run the tests" });
      expect(calls("POST", "/todos").at(-1)!.body).toEqual({ text: "run the tests", section: "Focus", parent_id: pr });
      expect((await list("odak")).find((i) => i.name === "run the tests")).toMatchObject({ section: "Focus", subtitle: "↳ Review the parser PR https://github.com/example/pal/pull/42" });
    });

    test("a /section the file lacks stays in the text; the default section setting names a section the file has, else Inbox", async () => {
      expect((await list("add", "read /nowhere"))[0]).toMatchObject({ name: "read /nowhere", subtitle: "Inbox" });
      host.changeSettings("odak", { settings: { ...SETTINGS, default_section: "next" } });
      await Bun.sleep(50);
      expect((await list("add", "read"))[0].subtitle).toBe("Next");
      host.changeSettings("odak", { settings: { ...SETTINGS, default_section: "Nowhere" } });
      await Bun.sleep(50);
      expect((await list("add", "read"))[0].subtitle).toBe("Inbox");
      host.changeSettings("odak", { settings: SETTINGS });
      await Bun.sleep(50);
    });
  });

  describe("Search Todos", () => {
    test("every word against text, tags and section; open rows by section first, completed ones after; nothing found offers Add", async () => {
      expect((await list("search", ""))[0]).toMatchObject({ id: "hint:search" });
      const rows = await list("search", "personal");
      expect(rows.map((i) => [i.section, i.name])).toEqual([["Today", "Call the bank about the card"], ["Next", "Book the dentist"], ["Waiting", "Visa appointment confirmation"], ["Completed", "Water the plants"], ["Completed", "Renew the domain"]]);
      expect(rows[3]).toMatchObject({ icon: { glyph: "\u{f0134}", color: "green" }, actions: [expect.objectContaining({ id: "reopen" }), expect.anything(), expect.anything(), expect.anything()] });
      expect((await list("search", "work parser")).map((i) => i.name)).toEqual(["Review the parser PR https://github.com/example/pal/pull/42"]);
      const none = (await list("search", "zebra"))[0];
      expect(none).toMatchObject({ id: "hint:empty", name: "Nothing found" });
      expect(await pick("search", "hint:empty", "add")).toEqual({ push: { extension: "odak", palette: "add" } });
      expect(await pick("search", item("Water the plants").id)).toMatchObject({ toast: { title: "Reopened" } });
    });
  });

  describe("the bar item", () => {
    test("the count of the overdue and today's (due today or in today's sections, waiting ones aside), the tooltip, the facts; the popover as a view with the overdue first", async () => {
      const bar = await host.render("odak", "today", { reason: "cli" });
      expect(bar).toMatchObject({ icon: "\u{f0134}", title: "4", tooltip: "1 overdue, 3 today", states: { overdue: 1, today: 3, open: 9 } });
      expect(bar.hidden).toBeUndefined();
      expect(bar.empty).toMatchObject({ icon: "\u{f0134}", tooltip: "1 overdue, 3 today" });
      const v = viewOf(bar);
      checkView(v);
      expect(v).toMatchObject({ id: "today", title: "1 overdue, 3 today", keys: "actions" });
      const t = texts(v.tree);
      expect(t.slice(0, 3)).toEqual(["\u{f0130}", "Call the bank about the card", "Today · #personal"]);
      expect(t).toContain("overdue 3 d");
      expect(t.filter((x) => x === "\u{f0028}")).toHaveLength(1);
      expect(v.actions.map((a) => a.id).slice(0, 8)).toEqual(["complete", "urgent", "tomorrow", "new", "open-odak", "open-pal", "refresh", "down"]);
      expect(v.actions.find((a) => a.id === "complete")!.shortcut).toBe("x");
    });

    test("the keys: down moves the cursor, Enter completes the focused todo and the strip re-renders, u flips the flag, t snoozes, o and p open, r fetches again", async () => {
      expect(selectedKey(viewOf(await host.render("odak", "today", { reason: "update" })).tree)).toBe(id("Call the bank"));
      expect(selectedKey(viewOf(await host.barAction("odak", "today", "down")).tree)).toBe(id("Review the parser"));
      expect(texts(viewOf(await host.render("odak", "today", { reason: "update" })).tree).filter((x) => /^(Call|Review|Ship|Write)/.test(x))).toEqual(["Call the bank about the card", "Review the parser PR https://github.com/example/pal/pull/42", "Ship the release notes", "Write the changelog entry"]);
      expect(await host.barAction("odak", "today", "complete")).toEqual({ keep: true, hud: "Done: Review the parser PR https://github.com/example/p…" });
      expect(item("Review the parser").done).toBe(true);
      expect(await host.render("odak", "today", { reason: "update" })).toMatchObject({ title: "3", states: { overdue: 1, today: 2 } });
      // The cursor is back on the first row (the completed one left); u flips its flag.
      expect(await host.barAction("odak", "today", "urgent")).toEqual({ keep: true });
      expect(item("Call the bank").urgent).toBe(true);
      expect(await host.barAction("odak", "today", "tomorrow")).toEqual({ keep: true, toast: { title: "Snoozed to Wed 23 Sep", message: "Call the bank about the card" } });
      expect(item("Call the bank").deadline).toBe("2026-09-23");
      expect(await host.barAction("odak", "today", "open-odak")).toEqual({ open: BASE });
      expect(await host.barAction("odak", "today", "open-pal")).toEqual({ push: { extension: "odak", palette: "odak" } });
      const gets = calls("GET", "/todos").length;
      expect(await host.barAction("odak", "today", "refresh")).toEqual({ keep: true });
      await host.until(() => calls("GET", "/todos").length === gets + 1, 3000, "the refetch"); // the action answers before its fetch lands
    });

    test("n opens the field (the search row types a todo), Enter adds it through the add grammar and closes the field, an empty one is refused, Escape closes", async () => {
      const opened = viewOf(await host.barAction("odak", "today", "new"));
      expect(opened.input).toEqual({ placeholder: "Todo, #tag, !, tomorrow", submit: "add", cancel: "cancel" });
      expect(opened.title).toBe("New todo");
      expect(opened.actions[0]).toEqual({ id: "add", title: "Add to Inbox" });
      const empty = await host.barAction("odak", "today", "add", { reason: "open", values: { input: "  " } });
      expect(empty.toast).toEqual({ title: "Nothing to add", message: "Type the todo first", style: "failure" });
      expect(viewOf(empty).input).toBeDefined();
      expect(await host.barAction("odak", "today", "add", { reason: "open", values: { input: "buy stamps #errand tomorrow" } })).toEqual({ keep: true, toast: { title: "Added to Inbox", message: "buy stamps" } });
      expect(calls("POST", "/todos").at(-1)!.body).toEqual({ text: "buy stamps", section: "Inbox", tags: ["errand"], deadline: "2026-09-23" });
      expect(viewOf(await host.render("odak", "today", { reason: "update" })).input).toBeUndefined();
      viewOf(await host.barAction("odak", "today", "new"));
      expect(viewOf(await host.barAction("odak", "today", "cancel")).input).toBeUndefined();
    });

    test("at zero: no title, the honest tooltip and the popover as the empty shape (the rule hides it); signed out: hidden without one and the facts withdrawn", async () => {
      for (const t of ITEMS) if (t.section === "Focus" || t.section === "Today") t.done = true;
      const bar = await host.render("odak", "today", { reason: "update" });
      expect(bar).toMatchObject({ icon: "\u{f0134}", tooltip: "Nothing due today", states: { overdue: 0, today: 0 }, empty: { tooltip: "Nothing due today" } });
      expect(bar.title).toBeUndefined();
      expect(texts(viewOf(bar).tree)).toContain("Nothing due today");
      host.changeSettings("odak", { settings: { ...SETTINGS, api_key: "" } });
      await Bun.sleep(50);
      expect(await host.render("odak", "today", { reason: "cli" })).toEqual({ hidden: true, states: { overdue: null, today: null, open: null } });
      host.changeSettings("odak", { settings: SETTINGS });
      await Bun.sleep(50);
    });
  });

  describe("the link", () => {
    test("pal://odak/add: the text through the grammar, section, due, tags and urgent on top; a day it cannot read or an empty text is the HUD's line", async () => {
      expect(await host.request<unknown>("link", { extension: "odak", route: "add", params: { text: "file the expense #work fri" } })).toEqual({ hud: "Added to Inbox: file the expense" });
      expect(calls("POST", "/todos").at(-1)!.body).toEqual({ text: "file the expense", section: "Inbox", tags: ["work"], deadline: "2026-09-25" });
      expect(await host.request<unknown>("link", { extension: "odak", route: "add", params: { text: "taxes", section: "next", due: "in 2 weeks", tags: ["money", "work"], urgent: "1" } })).toEqual({ hud: "Added to Next: taxes" });
      expect(calls("POST", "/todos").at(-1)!.body).toEqual({ text: "taxes", section: "Next", tags: ["money", "work"], urgent: true, deadline: "2026-10-06" });
      await expect(host.request("link", { extension: "odak", route: "add", params: { text: "taxes", due: "someday" } })).rejects.toThrow('cannot read the day "someday"');
      await expect(host.request("link", { extension: "odak", route: "add", params: { text: "#work" } })).rejects.toThrow("text is empty");
      await expect(host.request("link", { extension: "odak", route: "add", params: {} })).rejects.toThrow("text is required");
    });
  });

  describe("what goes wrong", () => {
    test("no address, no key: one hint naming the setting, Enter opens it in Settings; the bar item is hidden", async () => {
      host.changeSettings("odak", { settings: { ...SETTINGS, url: "" } });
      await Bun.sleep(50);
      const items = await list("odak");
      expect(items).toEqual([expect.objectContaining({ id: "hint:url", name: "Set the odak address", icon: "\u{f030b}" })]);
      expect(await pick("odak", "hint:url")).toEqual({ open: "pal://settings/extensions?anchor=extensions:odak:url" });
      host.changeSettings("odak", { settings: { ...SETTINGS, api_key: "" } });
      await Bun.sleep(50);
      expect((await list("done"))[0]).toMatchObject({ id: "hint:key", name: "Set the odak API key" });
      expect(await pick("done", "hint:key")).toEqual({ open: "pal://settings/extensions?anchor=extensions:odak:api_key" });
      expect((await list("add", "x"))[0].id).toBe("hint:key");
      expect(await host.render("odak", "today", { reason: "cli" })).toMatchObject({ hidden: true });
    });

    test("a refused key: the 401 is a hint naming it, never stale rows; the bar render fails (the core marks it stale)", async () => {
      host.changeSettings("odak", { settings: { ...SETTINGS, api_key: "wrong" } });
      await Bun.sleep(50);
      const items = await list("odak");
      expect(items).toEqual([expect.objectContaining({ id: "hint:key", name: "odak rejected the key" })]);
      expect((await list("search", "bank"))[0].id).toBe("hint:key");
      await expect(host.render("odak", "today", { reason: "cli" })).rejects.toThrow(/unauthorized/);
    });

    test("a server that answers with an error keeps the cached rows and logs; with nothing cached it is a hint with the retry key", async () => {
      host.changeSettings("odak", { settings: SETTINGS });
      await Bun.sleep(50);
      await fresh();
      state.down = true;
      const items = await list("odak", undefined, { refresh: true });
      expect(items.map((i) => i.name)).toContain("Call the bank about the card");
      expect(host.stderr).toContain("showing cached rows");
      state.down = false;
      host.changeSettings("odak", { settings: { ...SETTINGS, url: "http://127.0.0.1:1" } });
      await Bun.sleep(50);
      const down = await list("odak");
      expect(down[0]).toMatchObject({ id: "hint:down", name: "odak is not answering" });
      expect(down[0].subtitle).toMatch(/127\.0\.0\.1:1.*cmd\+r tries again/);
      expect(await pick("odak", "hint:down", "open")).toEqual({ open: "http://127.0.0.1:1" });
      host.changeSettings("odak", { settings: SETTINGS });
      await Bun.sleep(50);
    });
  });
});

// The mock's ids are what odak would compute; a test that computes one by hand pins the rule.
test("the mock's id is odak's: the line after the checkbox, tags first, hashed", () => {
  expect(idOf({ section: "Inbox", done: false, text: "x", tags: ["a"], urgent: true, deadline: "2026-01-01" })).toBe(new Bun.CryptoHasher("sha256").update("[t:a] [!] [d:2026-01-01] x").digest("hex").slice(0, 8));
});
