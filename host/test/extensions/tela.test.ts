// tela against a local mock of an instance: a Bun server answering the REST
// routes the extension reads and writes, and `/api/mcp` as the Streamable
// HTTP transport (a session opened by `initialize`, `tools/call research`
// answered as an event stream). Rows, sections and actions per palette,
// the page read as a view tree, the research view and its keys, the two
// forms and their writes, the inbox item, and the hint rows naming the fix
// for a missing address, a missing or expired token, an instance without
// an embedder, and one that does not answer.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkView, tinted } from "../../../sdk/src/index.ts";
import type { Form, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";
import { BASE, RESEARCH, SETTINGS, calls, seen, server, setRead, state } from "./tela-mock.ts";


let host: Host;
beforeAll(async () => {
  stored.clear();
  delete process.env.PAL_TELA_URL;
  delete process.env.PAL_TELA_TOKEN;
  host = await Host.bundled({ settings: { tela: { settings: SETTINGS } } });
});
afterAll(() => { host.kill(); server.stop(true); });

const list = (palette: string, query?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("tela", palette, query, ctx);
const pick = (palette: string, id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("tela", palette, id, action, ctx);
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const texts = (n: ViewNode): string[] => (n.type === "text" ? [n.value] : n.type === "stack" ? n.children.flatMap(texts) : n.type === "badge" ? [`[${n.text}]`] : n.type === "tile" ? [`(${n.text})`] : []);
const nodes = (n: ViewNode, type: string): ViewNode[] => [...(n.type === type ? [n] : []), ...(n.type === "stack" ? n.children.flatMap((c) => nodes(c, type)) : [])];
const keycaps = (v: View) => nodes(v.tree, "keycap").flatMap((n) => (n.type === "keycap" ? [n.keys] : []));
const viewOf = (x: unknown): View => {
  const o = x as { view?: View; menu?: { view?: View } };
  const v = o.view ?? o.menu?.view;
  if (!v) throw new Error("no view");
  return v;
};

describe("tela", () => {
  test("meta: nine palettes (search and research input, comments live, the rest indexed with the manifest's ttl), the bar item, the four settings", () => {
    const l = host.loaded().find((x) => x.extension === "tela")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((m) => [m.name, m.input, m.live, m.ttl])).toEqual([
      ["search", true, false, undefined], ["research", true, false, undefined], ["pages", false, false, 300], ["spaces", false, false, 3600], ["new-page", false, false, 3600],
      ["decks", false, false, 3600], ["sheets", false, false, 3600], ["comments", false, true, 60], ["backlinks", false, false, 300],
    ]);
    expect(l.palettes.find((m) => m.name === "search")!.detail).toBe("lazy");
    expect(l.bar).toEqual([{ id: "inbox", title: "Inbox", description: expect.any(String), mocks: expect.any(Object), refresh: { every: 300, on: ["show", "wake", "network"] }, keys: expect.any(Array), source: true }]);
    expect(host.manifests.get("tela")!.settings!.map((s) => [s.id, s.kind])).toEqual([["base_url", "text"], ["token", "secret"], ["default_space", "text"], ["research", "boolean"]]);
  });

  describe("pages", () => {
    test("the root: the four commands, favourites, then what changed by space, a favourite not listed twice; the author and the date on a change", async () => {
      const items = await list("pages");
      expect(ids(items)).toEqual(["cmd:new", "cmd:search", "cmd:ask", "cmd:notes", "page:21", "page:10", "page:20", "page:11", "page:30"]);
      expect(items.slice(4).map((i) => i.section)).toEqual(["Favourites", "Favourites", "Notes", "Engineering", "Blog"]);
      expect(items[6]).toMatchObject({ name: "Quick Notes", icon: "\u{f09ee}", accessories: [{ text: "cagdas" }, { date: "2026-09-16T07:00:00Z" }] });
      expect(items[6].subtitle).toBeUndefined();
      expect(items[4].icon).toBe("\u{f04ce}");
      expect(items[5].actions!.map((a) => a.id)).toEqual(["open", "read", "copy", "outline", "backlinks", "comment"]);
      expect(calls("GET", "/api/recent-changes")).toHaveLength(1);
    });

    test("the commands: New opens the form with the default space chosen, Search pushes its palette, Ask takes the question in the bar (a form without values; the view with them, the browser on cmd+enter), Quick Notes opens /n", async () => {
      const r = await pick("pages", "cmd:new");
      expect(r.form).toMatchObject({ id: "new", title: "New tela page", submit: { id: "save", title: "Create page" } });
      const f = r.form as Form;
      expect(f.fields.map((x) => x.id)).toEqual(["title", "space", "body"]);
      expect(f.fields[1]).toMatchObject({ kind: "select", default: "2", options: [{ id: "1", title: "Notes" }, { id: "2", title: "Engineering" }, { id: "3", title: "Blog" }] });
      expect(await pick("pages", "cmd:search")).toEqual({ push: { extension: "tela", palette: "search" } });
      const askRow = (await list("pages")).find((i) => i.id === "cmd:ask")!;
      expect(askRow.args).toEqual([{ id: "question", placeholder: "Question", required: true }]);
      expect(askRow.actions).toEqual([{ id: "ask", title: "Ask", args: true }, { id: "browser", title: "Ask in the browser", shortcut: "cmd+enter", args: true }]);
      const form = (await pick("pages", "cmd:ask")).form as Form;
      expect(form).toMatchObject({ title: "Ask tela", submit: { id: "ask", title: "Ask" } });
      expect(form.fields.map((x) => [x.id, x.kind, !!x.required])).toEqual([["question", "text", true]]);
      expect(((await pick("pages", "cmd:ask", "browser")).form as Form).submit).toEqual({ id: "browser", title: "Ask in the browser" });
      expect(((await pick("pages", "cmd:ask", "ask", { values: { question: " " } })).form as Form).errors).toEqual({ question: "Required" });
      expect(await pick("pages", "cmd:ask", "browser", { values: { question: "what is a deck" } })).toEqual({ open: `${BASE}/ask?q=what%20is%20a%20deck` });
      const asked = (await pick("pages", "cmd:ask", "ask", { values: { question: "what is a deck" } })).view as View;
      expect(asked).toMatchObject({ id: "research", title: "what is a deck" });
      expect(calls("POST", "/api/mcp").at(-1)!.body.params).toEqual({ name: "research", arguments: { question: "what is a deck", limit: 8 } });
      // Asked from the row, the question is remembered as the palette's are; forgotten here, and the MCP session's trace dropped, so the research tests start clean.
      await pick("research", "ask:what is a deck", "forget");
      state.inits = 0;
      for (let i = seen.length - 1; i >= 0; i--) if (seen[i].path === "/api/mcp") seen.splice(i, 1);
      expect(await pick("pages", "cmd:notes")).toEqual({ open: `${BASE}/n` });
    });

    test("pushed with a space: the tree in order, sectioned by the top-level page, the breadcrumb as subtitle, deck and sheet tagged", async () => {
      const items = await list("pages", undefined, { args: { space: 2 } });
      expect(ids(items)).toEqual(["page:10", "page:11", "page:12", "page:13"]);
      expect(items.map((i) => i.section)).toEqual(["Top level", "Indexing", "Top level", "Top level"]);
      expect(items[1].subtitle).toBe("Indexing");
      expect(items[2]).toMatchObject({ icon: "\u{f0428}", accessories: [{ tag: "deck", color: "violet" }, { date: "2026-09-14T12:00:00Z" }] });
      expect(items[3].accessories![0]).toEqual({ tag: "sheet", color: "teal" });
    });

    test("the pane: front matter off, the callout as a bold lead, the metadata (space link, kind, words, summary); a deck's pane leads with its first slide", async () => {
      const d = await host.detail("tela", "pages", "page:10");
      expect(d.markdown).not.toContain("summary:");
      expect(d.markdown).toContain("> **Note: Why persist**");
      expect(d.metadata!.map((m) => m.label)).toEqual(["Space", "Updated", "Created", "Words", "Summary"]);
      expect(d.metadata![0].link).toEqual({ text: "Engineering", href: `${BASE}/spaces/2` });
      const deck = await host.detail("tela", "pages", "page:12", { args: { space: 2 } });
      expect(deck.markdown!.startsWith(`![first slide](${BASE}/api/deck/d/abc/cover.png)`)).toBe(true);
      expect(deck.metadata!.find((m) => m.label === "Kind")).toEqual({ label: "Kind", tags: [{ text: "deck", color: "violet" }] });
    });

    test("actions: open remembers the page and opens its slugged url, copy, outline shows the headings, backlinks pushes with the page, read is a view", async () => {
      expect(await pick("pages", "page:10")).toEqual({ open: `${BASE}/spaces/2/pages/10/indexing` });
      expect(stored.get("tela\0last")).toEqual({ id: 10, title: "Indexing", space: 2 });
      expect(await pick("pages", "page:10", "copy")).toEqual({ copy: `${BASE}/spaces/2/pages/10/indexing` });
      expect((await pick("pages", "page:10", "outline")).show).toEqual({ title: "Outline of Indexing", markdown: "- Indexing\n  - Steps" });
      expect(await pick("pages", "page:10", "backlinks")).toEqual({ push: { extension: "tela", palette: "backlinks", args: { page: 10, title: "Indexing" } } });
      const v = (await pick("pages", "page:10", "read")).view as View;
      expect(v.id).toBe("page:10");
      expect(v.title).toBe("Indexing");
      checkView(v);
    });

    test("the page as a view: the header line, headings by size, the callout as an elevated card with its badge, ordered and task lists, the table as aligned columns, code on a sunken well, the quote with its cite, details, the links under their paragraph", async () => {
      const v = (await pick("pages", "page:10", "read")).view as View;
      const t = texts(v.tree);
      expect(t[0]).toBe("Indexing");
      expect(t[1]).toMatch(/^Engineering · updated .* · \d+ words$/);
      // The body's own `# Indexing` repeats the header and is left out.
      expect(t[2]).toMatch(/^Every listing/);
      expect(t).toContain("[Note]");
      expect(t).toContain("Why persist");
      expect(t).toContain("↗ Startup   ↗ design note");
      expect(t).toEqual(expect.arrayContaining(["1.", "2.", "3.", "•", "☑", "☐", "prs", "300", "notifications", "const gap = 2000;", "Paint first, fetch later.", "the brief", "▸ Numbers", "[image: the pipeline]"]));
      const cards = nodes(v.tree, "stack").filter((n) => n.type === "stack" && n.surface === "elevated");
      expect(cards).toHaveLength(1);
      expect(nodes(v.tree, "stack").filter((n) => n.type === "stack" && n.surface === "sunken")).toHaveLength(2);
      const widths = nodes(v.tree, "text").filter((n) => n.type === "text" && n.width !== undefined);
      expect(widths.length).toBeGreaterThanOrEqual(9);
      expect((nodes(v.tree, "text")[0] as { size?: string }).size).toBe("xl");
      expect(nodes(v.tree, "text").find((n) => n.type === "text" && n.value === "Steps")).toMatchObject({ style: "title", size: "lg" });
      expect(v.actions.map((a) => a.id)).toEqual(["open", "copy", "backlinks", "outline", "comment", "markdown"]);
    });

    test("comment: the anchor defaults to the page's first line of plain text; the submit posts body and anchor; tela's no-anchor refusal lands on the anchor field", async () => {
      const f = (await pick("pages", "page:11", "comment")).form as Form;
      expect(f.fields.map((x) => [x.id, (x as { default?: string }).default])).toEqual([["body", ""], ["anchor", "Startup"]]);
      expect(await pick("pages", "page:11", "comment:save", { values: { body: "Is this still true?", anchor: "Startup" } })).toEqual({ open: `${BASE}/spaces/2/pages/11/startup`, hud: "Commented on Startup" });
      expect(calls("POST", "/api/pages/11/comments").at(-1)!.body).toEqual({ body: "Is this still true?", anchor_prefix: "", anchor_exact: "Startup", anchor_suffix: "" });
      const bad = await pick("pages", "page:11", "comment:save", { values: { body: "x", anchor: "" } });
      expect((bad.form as Form).errors).toEqual({ anchor: "Required" });
    });
  });

  describe("search", () => {
    test("under two characters is a hint; hits are page rows sectioned by space with the passage unmarked, the public one tagged; the pane keeps the highlight as bold", async () => {
      expect(ids(await list("search", "i"))).toEqual(["hint:search"]);
      const items = await list("search", "weekly");
      expect(ids(items)).toEqual(["page:30"]);
      expect(items[0]).toMatchObject({ name: "How we ship", section: "Blog", subtitle: "How we ship Weekly.", accessories: [{ tag: "public", color: "grey" }], detail: { markdown: "…How we ship **Weekly**.…" } });
      expect(calls("GET", "/api/search?q=weekly")).toHaveLength(1);
      const many = await list("search", "cache");
      expect(ids(many)).toEqual(["page:10", "page:11"]);
      expect(many[1].subtitle).toMatch(/^Indexing · .*restores the cache\./);
    });

    test("typed letter by letter, the calls overlapping: one request, for the last query, and every reply is that query's rows; a repeat of the query in flight joins it", async () => {
      const before = calls("GET", "/api/search").length;
      const word = "spawns";
      const asks: Promise<{ id: string }[]>[] = [];
      for (let i = 2; i <= word.length; i++) {
        asks.push(list("search", word.slice(0, i)));
        if (i < word.length) await Bun.sleep(60);
      }
      // The panel lists again on an index event: the same query, mid-wait.
      await Bun.sleep(100);
      asks.push(list("search", word));
      const replies = await Promise.all(asks);
      for (const r of replies) expect(ids(r)).toEqual(["page:11"]);
      expect(calls("GET", "/api/search").slice(before).map((c) => c.path)).toEqual(["/api/search?q=spawns"]);
      // Once answered, the query lists afresh (the cache, not the wait, saves the request).
      expect(ids(await list("search", "spawns"))).toEqual(["page:11"]);
      expect(calls("GET", "/api/search").length).toBe(before + 1);
    });

    test("nothing found is a hint whose Enter goes to Ask tela; a hit's actions are the page's, cmd+Enter is the view", async () => {
      const none = await list("search", "zzzz");
      expect(none[0]).toMatchObject({ id: "hint:empty", name: "Nothing found" });
      expect(await pick("search", "hint:empty", "ask")).toEqual({ push: { extension: "tela", palette: "research" } });
      expect((await pick("search", "page:30", "read")).view).toMatchObject({ id: "page:30", title: "How we ship" });
      expect((await host.detail("tela", "search", "page:30")).metadata![0].link!.text).toBe("Blog");
    });
  });

  describe("research", () => {
    test("rows: a hint until three characters, then the Ask row and the remembered questions; research off is one hint", async () => {
      expect(ids(await list("research", ""))).toEqual(["hint:ask"]);
      const items = await list("research", "how does indexing work");
      expect(items[0]).toMatchObject({ id: "ask:how does indexing work", name: "Ask: how does indexing work", icon: "\u{f06e9}" });
      host.changeSettings("tela", { settings: { ...SETTINGS, research: false } });
      await Bun.sleep(50);
      expect(ids(await list("research", "x"))).toEqual(["hint:research-off"]);
      expect(await pick("research", "hint:research-off")).toEqual({ open: "pal://settings/extensions" });
      host.changeSettings("tela", { settings: SETTINGS });
      await Bun.sleep(50);
    });

    test("asking: one MCP session (initialize, initialized, tools/call), the view with the flags, the sources numbered with the cursor on the first, its excerpt rendered under them; the question remembered", async () => {
      const r = await pick("research", "ask:how does indexing work", undefined, undefined);
      const v = r.view as View;
      checkView(v);
      expect(v).toMatchObject({ id: "research", title: "how does indexing work", keys: "actions" });
      expect(state.inits).toBe(1);
      const mcp = calls("POST", "/api/mcp").map((c) => c.body?.method);
      expect(mcp).toEqual(["initialize", "notifications/initialized", "tools/call"]);
      expect(calls("POST", "/api/mcp").at(-1)!.body.params).toEqual({ name: "research", arguments: { question: "how does indexing work", limit: 8 } });
      const t = texts(v.tree);
      expect(t.slice(0, 2)).toEqual(["[Low confidence]", "Nothing strongly relevant was found; verify before relying on this"]);
      expect(t).toContain("[Disagreements]");
      expect(t).toContain("[1] says the budget is 2 s, [2] says 1 s.");
      expect(t).toContain("3 sources of 9 considered; + asks for more");
      expect(t).toEqual(expect.arrayContaining(["(1)", "Indexing", "(2)", "Startup", "(3)", "How we ship"]));
      expect(t.find((x) => x.startsWith("Engineering · Indexing › Steps"))).toBeDefined();
      // The selected card carries its excerpt from the grounding (rendered), the others their snippet.
      expect(t.slice(t.indexOf("(1)"), t.indexOf("(2)"))).toEqual(["(1)", "Indexing", expect.stringMatching(/^Engineering · Indexing › Steps · \d+ (h|min|d) ago$/), "Indexing", "Every listing is persisted and restored, see Startup.", "↗ Startup", "[Note]", "Why persist", "400 ms cold."]);
      expect(t.slice(t.indexOf("(2)"), t.indexOf("(3)"))).toEqual(["(2)", "Startup", expect.stringMatching(/^Engineering · \d+ (min|h|d|w|mo|y) ago$/), "The host spawns after the cache restores"]);
      const tiles = nodes(v.tree, "tile") as { color?: string; fill?: string }[];
      expect(tiles.map((x) => [x.color, x.fill])).toEqual([["accent", "solid"], ["neutral", "soft"], ["neutral", "soft"]]);
      expect(v.actions.map((a) => a.id)).toEqual(["open", "read", "down", "up", "copy", "context", "ask-tela", "more", "question", "go1", "go2", "go3"]);
      expect(v.actions.find((a) => a.id === "go2")).toMatchObject({ hidden: true, shortcut: "2" });
      expect(stored.get("tela\0questions")).toEqual(["how does indexing work"]);
    });

    test("the keys: down and up move the cursor and the excerpt, 3 jumps, Enter opens the source, cmd+Enter shows the page, copy is its link, + asks with twice the limit, n opens the input and a typed question asks", async () => {
      let v = (await pick("research", "research", "down")).view as View;
      expect((nodes(v.tree, "tile") as { color?: string }[]).map((x) => x.color)).toEqual(["neutral", "accent", "neutral"]);
      expect(texts(v.tree)).toContain("The host spawns after the cache restores.");
      v = (await pick("research", "research", "go3")).view as View;
      expect((nodes(v.tree, "tile") as { color?: string }[]).map((x) => x.color)).toEqual(["neutral", "neutral", "accent"]);
      expect(await pick("research", "research", "open")).toEqual({ open: `${BASE}/spaces/3/pages/30/how-we-ship` });
      expect(await pick("research", "research", "copy")).toEqual({ copy: `${BASE}/spaces/3/pages/30/how-we-ship` });
      expect((await pick("research", "research", "read")).show).toMatchObject({ title: "How we ship", markdown: "# How we ship\n\nWeekly." });
      v = (await pick("research", "research", "up")).view as View;
      v = (await pick("research", "research", "up")).view as View;
      expect((nodes(v.tree, "tile") as { color?: string }[]).map((x) => x.color)).toEqual(["accent", "neutral", "neutral"]);
      v = (await pick("research", "research", "more")).view as View;
      expect(calls("POST", "/api/mcp").at(-1)!.body.params.arguments.limit).toBe(16);
      expect(v.actions.find((a) => a.id === "more")).toBeUndefined();
      v = (await pick("research", "research", "question")).view as View;
      expect(v.input).toEqual({ placeholder: "Ask the wiki a question", submit: "ask", cancel: "cancel" });
      expect(v.actions.map((a) => a.id)).toContain("cancel");
      v = (await pick("research", "research", "ask", { values: { input: "when does the host spawn" } })).view as View;
      expect(v.title).toBe("when does the host spawn");
      expect(v.input).toBeUndefined();
      expect(stored.get("tela\0questions")).toEqual(["when does the host spawn", "how does indexing work"]);
      expect(await pick("research", "research", "context")).toEqual({ copy: RESEARCH.context });
      expect(await pick("research", "research", "ask-tela")).toEqual({ open: `${BASE}/ask?q=when%20does%20the%20host%20spawn` });
    });

    test("a session the server forgot is opened again once, in the same call", async () => {
      state.sessionOk = "sess-2";
      const before = state.inits;
      const v = (await pick("research", "ask:a third question")).view as View;
      expect(v.title).toBe("a third question");
      expect(state.inits).toBe(before + 1);
      const tail = calls("POST", "/api/mcp").slice(-4).map((c) => [c.body?.method, c.session]);
      expect(tail).toEqual([["tools/call", "sess-1"], ["initialize", null], ["notifications/initialized", "sess-2"], ["tools/call", "sess-2"]]);
    });

    test("recent questions list under the Ask row and can be forgotten; the browser action opens tela's Ask", async () => {
      const items = await list("research", "");
      expect(ids(items)).toEqual(["ask:a third question", "ask:when does the host spawn", "ask:how does indexing work"]);
      expect(items[0].section).toBe("Recent questions");
      expect(await pick("research", "ask:a third question", "forget")).toEqual({ keep: true });
      expect(ids(await list("research", ""))).toEqual(["ask:when does the host spawn", "ask:how does indexing work"]);
      expect(await pick("research", "ask:how does indexing work", "browser")).toEqual({ open: `${BASE}/ask?q=how%20does%20indexing%20work` });
    });

    test("an instance without an embedder: the pick is a failure toast naming it", async () => {
      state.ragDisabled = true;
      const r = await pick("research", "ask:no embedder here");
      expect(r).toEqual({ keep: true, toast: { title: "Research failed", message: "This tela has no embedder configured; Search still works", style: "failure" } });
      state.ragDisabled = false;
    });
  });

  describe("spaces", () => {
    test("every space with its page count from one listing, the default and public tagged; Enter pushes the pages, cmd+n the form with the space", async () => {
      const items = await list("spaces");
      expect(ids(items)).toEqual(["space:1", "space:2", "space:3"]);
      expect(items[1]).toMatchObject({ name: "Engineering", subtitle: "How the systems are built and run", icon: "\u{f0341}", accessories: [{ tag: "default", color: "blue" }, { text: "4 pages" }, { text: "6 members" }, { date: "2026-09-16T09:00:00Z" }] });
      expect(items[2]).toMatchObject({ icon: tinted("\u{f01e7}", "teal"), accessories: [{ tag: "public", color: "teal" }, { text: "1 page" }, { text: "2 members" }, { date: "2026-09-10T09:00:00Z" }] });
      expect(items[0]).toMatchObject({ subtitle: "Your personal space", accessories: [{ tag: "personal", color: "grey" }, { text: "2 pages" }, { date: "2026-09-15T08:00:00Z" }] });
      expect(await pick("spaces", "space:2")).toEqual({ push: { extension: "tela", palette: "pages", args: { space: 2 } } });
      expect(await pick("spaces", "space:2", "open")).toEqual({ open: `${BASE}/spaces/2` });
      expect(((await pick("spaces", "space:3", "new")).form as Form).fields[1]).toMatchObject({ default: "3" });
    });
  });

  describe("new page", () => {
    test("one row per space, the default first; the form's submit posts the page and opens it; a blank title stays in the form", async () => {
      const items = await list("new-page");
      expect(ids(items)).toEqual(["space:2", "space:1", "space:3"]);
      expect(items[0]).toMatchObject({ name: "New page in Engineering", accessories: [{ tag: "default", color: "blue" }] });
      const f = (await pick("new-page", "space:1")).form as Form;
      expect(f.fields[1]).toMatchObject({ default: "1" });
      const r = await pick("new-page", "new", "save", { values: { title: "Runbook", space: "1", body: "# Runbook\n\nSteps." } });
      expect(r).toEqual({ open: `${BASE}/spaces/1/pages/99/runbook`, hud: "Created Runbook" });
      expect(calls("POST", "/api/pages").at(-1)!.body).toEqual({ space_id: 1, title: "Runbook", body: "# Runbook\n\nSteps." });
      const bad = await pick("new-page", "new", "save", { values: { title: " ", space: "1", body: "" } });
      expect((bad.form as Form).errors).toEqual({ title: "Required" });
      expect((bad.form as Form).fields[2]).toMatchObject({ default: "" });
    });
  });

  describe("decks and sheets", () => {
    test("the trees of every space filtered by the flag, newest first, the space as section", async () => {
      const decks = await list("decks");
      expect(decks).toHaveLength(1);
      expect(decks[0]).toMatchObject({ id: "page:12", name: "Release Talk", section: "Engineering", icon: "\u{f0428}" });
      expect(calls("GET", "/api/pages?space_id=").length).toBeGreaterThanOrEqual(3);
      const sheets = await list("sheets");
      expect(sheets.map((s) => [s.id, s.icon])).toEqual([["page:13", "\u{f04eb}"]]);
    });
  });

  describe("comments", () => {
    test("mentions and replies only, unread first then earlier; open marks read and opens the page; mark read; mark all", async () => {
      const items = await list("comments");
      expect(ids(items)).toEqual(["notif:901", "notif:902", "notif:905"]);
      expect(items.map((i) => i.section)).toEqual(["Unread", "Unread", "Earlier"]);
      expect(items[0]).toMatchObject({ name: "mara mentioned you in “Indexing”", subtitle: "@cagdas is the 2 s budget still right?", icon: "\u{f0065}", accessories: [{ tag: "mention", color: "amber" }, { date: "2026-09-16T09:30:00Z" }] });
      expect(items[1].name).toBe("tomas replied to your comment in “How we ship”");
      expect(await pick("comments", "notif:902")).toEqual({ open: `${BASE}/spaces/3/pages/30/how-we-ship` });
      expect(calls("POST", "/api/notifications/902/read")).toHaveLength(1);
      expect(await pick("comments", "notif:901", "read")).toEqual({ keep: true, toast: { title: "Marked read", message: "mara mentioned you in “Indexing”" } });
      expect(ids(await list("comments"))).toEqual(["hint:none", "notif:901", "notif:902", "notif:905"]);
      expect((await list("comments"))[0]).toMatchObject({ name: "No unread mentions or replies", subtitle: "Earlier ones are below", actions: [] });
    });
  });

  describe("bar item", () => {
    test("the badge counts unread mentions and replies, never the noise; the popover is a view of them with a cursor and its keys; hidden at zero", async () => {
      setRead((n) => n.id === 901 || n.id === 902, false);
      const item = await host.render("tela", "inbox", { reason: "cli" });
      expect(item).toMatchObject({ icon: "\u{f05da}", badge: 2, tooltip: "1 mention, 1 reply" });
      // The popover is a view of the item's own: what happened and the comment's snippet per row, the first focused.
      const v = viewOf(item);
      expect(v).toMatchObject({ id: "inbox", title: "2 addressed to you", keys: "actions" });
      const t = texts(v.tree);
      expect(t).toContain("mara mentioned you in “Indexing”");
      expect(t).toContain("@cagdas is the 2 s budget still right?");
      expect(t).toContain("tomas replied to your comment in “How we ship”");
      // Two unread and two rows, so nothing is left to count.
      expect(t.some((x) => x.startsWith("and "))).toBe(false);
      expect(keycaps(v)).toEqual(["enter", "m", "a", "o", "p"]);
      expect(v.actions!.filter((a) => !a.hidden).map((a) => a.id)).toEqual(["open", "read", "read-all", "open-tela", "open-pal"]);
      expect(v.actions!.filter((a) => a.id.startsWith("focus:")).map((a) => a.id)).toEqual(["focus:901", "focus:902"]);
      expect(await host.barAction("tela", "inbox", "open-pal")).toEqual({ push: { extension: "tela", palette: "comments" } });
      // Enter opens whatever the cursor is on, and the cursor moves.
      expect(await host.barAction("tela", "inbox", "open")).toEqual({ open: `${BASE}/spaces/2/pages/10/indexing` });
      expect(viewOf(await host.barAction("tela", "inbox", "focus:902"))).toMatchObject({ id: "inbox" });
      expect(await host.barAction("tela", "inbox", "notif:901")).toEqual({ open: `${BASE}/spaces/2/pages/10/indexing` });
      expect(await host.barAction("tela", "inbox", "read-all")).toEqual({ keep: true, hud: "Marked read" });
      expect(calls("POST", "/api/notifications/read-all")).toHaveLength(1);
      expect(await host.render("tela", "inbox", { reason: "every" })).toMatchObject({ hidden: true, empty: { icon: "\u{f05da}" } });
    });

    test("nothing addressed to you: hidden, the empty shape (the glyph, no badge, the popover saying so) offered for the core's show = always", async () => {
      const item = await host.render("tela", "inbox", { reason: "every" });
      expect(item).toMatchObject({ hidden: true, empty: { icon: "\u{f05da}", tooltip: "Nothing addressed to you" } });
      expect(item.badge).toBeUndefined();
      expect(texts(viewOf(item.empty!).tree)).toContain("Nothing addressed to you");
    });
  });

  describe("backlinks", () => {
    test("pushed with a page: the linking pages with the passage; without args the page opened last; nothing linking is a hint", async () => {
      const items = await list("backlinks", undefined, { args: { page: 11, title: "Startup" } });
      expect(ids(items)).toEqual(["page:10"]);
      expect(items[0]).toMatchObject({ section: "Links to Startup", subtitle: "Engineering · links to Startup", icon: "\u{f0339}" });
      await pick("pages", "page:11");
      expect(ids(await list("backlinks"))).toEqual(["page:10"]);
      expect((await list("backlinks", undefined, { args: { page: 30, title: "How we ship" } }))[0]).toMatchObject({ id: "hint:none", name: "Nothing links to How we ship" });
    });
  });

  describe("what goes wrong", () => {
    test("no token: one hint naming where a token comes from, Enter opens tela's API Keys; the bar item is hidden", async () => {
      host.changeSettings("tela", { settings: { ...SETTINGS, token: "" } });
      await Bun.sleep(50);
      const items = await list("pages");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id: "hint:token", name: "Sign in to tela", icon: "\u{f030b}" });
      expect(items[0].subtitle).toContain("Settings, API Keys");
      expect(await pick("pages", "hint:token", "keys")).toEqual({ open: `${BASE}/settings?tab=api-keys` });
      expect(await pick("pages", "hint:token", "settings")).toEqual({ open: "pal://settings/extensions" });
      // Signed out: no empty shape, hidden under either `show`.
      expect(await host.render("tela", "inbox", { reason: "cli" })).toEqual({ hidden: true });
    });

    test("no address: the hint says which setting", async () => {
      host.changeSettings("tela", { settings: { ...SETTINGS, base_url: "" } });
      await Bun.sleep(50);
      expect((await list("spaces"))[0]).toMatchObject({ id: "hint:url", name: "Set the tela address" });
    });

    test("an expired token: tela's 401 becomes a hint naming the renewal, on every palette, and no stale rows", async () => {
      host.changeSettings("tela", { settings: { ...SETTINGS, token: "expired-token" } });
      await Bun.sleep(50);
      for (const p of ["pages", "spaces", "comments", "decks"]) {
        const items = await list(p);
        expect(items.map((i) => i.id)).toEqual(["hint:token"]);
        expect(items[0].name).toBe("tela rejected the token");
        expect(items[0].subtitle).toContain("expired or was revoked");
      }
      expect(ids(await list("search", "cache"))).toEqual(["hint:token"]);
      await expect(host.render("tela", "inbox", { reason: "cli" })).rejects.toThrow(/token expired/);
    });

    test("an instance that does not answer: the hint names the retry key", async () => {
      host.changeSettings("tela", { settings: SETTINGS });
      await Bun.sleep(50);
      state.down = true;
      const items = await list("spaces", undefined, { refresh: true });
      expect(items[0]).toMatchObject({ id: "hint:error", name: "tela did not answer" });
      expect(items[0].subtitle).toMatch(/502.*cmd\+r tries again/);
      state.down = false;
    });
  });
});
