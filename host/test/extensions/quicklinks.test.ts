// Quicklinks: the placeholder and url helpers (links.ts, pure), then the
// extension over the wire against the harness's in-memory storage: the
// create form and its submit (filled from the tab in front, a browser to
// open with), the refusal round trip, edit, delete, the drill-in for a
// `{query}` link, `{selection}` filled without asking, the library, an
// open tab preferred, and an import file's read-only rows. The browser
// is a Bun server speaking the DevTools HTTP endpoints (browser-tabs'
// `activeTab`/`findTab`); `PAL_QUICKLINKS_BROWSERS` names the installed
// browsers and `PAL_QUICKLINKS_OPEN` a stand-in for `open -a` that logs.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LIBRARY } from "../../../extensions/quicklinks/library.ts";
import { asLinks, badUrl, fill, fromJson, placeholder, splitKeywords } from "../../../extensions/quicklinks/links.ts";
import { samePage } from "../../../extensions/browser-tabs/index.ts";
import type { Form } from "../../../sdk/src/protocol.ts";
import type { Item } from "../../../sdk/src/index.ts";
import { Host, fixtures, stored } from "../harness.ts";

describe("links", () => {
  test("placeholder: {query}, {argument}, a named argument, or none", () => {
    expect(placeholder("https://github.com/search?q={query}")).toBe("query");
    expect(placeholder("https://x/{argument}")).toBe("query");
    expect(placeholder('https://x/{argument name="Repo"}')).toBe("Repo");
    expect(placeholder("https://x/{other}")).toBeUndefined();
    expect(placeholder("https://x/")).toBeUndefined();
  });
  test("fill encodes the query as a url component, every occurrence", () => {
    expect(fill("https://github.com/search?q={query}&type={query}", "a b&c")).toBe("https://github.com/search?q=a%20b%26c&type=a%20b%26c");
    expect(fill('https://x/{argument name="Repo"}/', "zcag/pal")).toBe("https://x/zcag%2Fpal/");
  });
  test("badUrl takes a scheme or an absolute path, refuses the rest with a hint", () => {
    expect(badUrl("https://x.y/{query}")).toBeUndefined();
    expect(badUrl("mailto:a@b.c")).toBeUndefined();
    expect(badUrl("/Applications/Safari.app")).toBeUndefined();
    expect(badUrl("~/notes.md")).toBeUndefined();
    expect(badUrl("")).toBe("Required");
    expect(badUrl("github.com")).toMatch(/^Not a URL/);
  });
  test("fromJson takes {name, url} or Raycast's {name, link}, drops the rest, gives fresh ids; a non-array throws", () => {
    const links = fromJson([{ name: "A", url: "https://a", keywords: ["k"] }, { name: "B", link: "https://b" }, { url: "https://c" }, { name: "bad", url: "nope" }, null, 3]);
    expect(links.map(({ id, ...l }) => l)).toEqual([{ name: "A", url: "https://a", keywords: ["k"] }, { name: "B", url: "https://b" }, { name: "https://c", url: "https://c" }]);
    expect(new Set(links.map((l) => l.id)).size).toBe(3);
    expect(() => fromJson({})).toThrow(/array/);
  });
  test("asLinks drops what is not a link and keeps an app; splitKeywords splits on commas and spaces", () => {
    expect(asLinks([{ id: "1", name: "a", url: "u", keywords: ["k", 2], app: "Safari" }, { id: "2", name: "b" }, null, "x"])).toEqual([{ id: "1", name: "a", url: "u", keywords: ["k", "2"], app: "Safari" }]);
    expect(asLinks(null)).toEqual([]);
    expect(splitKeywords(" gh, code  search ")).toEqual(["gh", "code", "search"]);
    expect(splitKeywords("  ")).toBeUndefined();
  });
  test("samePage (browser-tabs): the origin and path, no query or fragment, no trailing slash, lower-cased", () => {
    expect(samePage("https://GitHub.com/zcag/pal/?tab=x#top")).toBe("https://github.com/zcag/pal");
    expect(samePage("https://github.com/zcag/pal")).toBe(samePage("https://github.com/zcag/pal/"));
    expect(samePage("not a url")).toBe("not a url");
  });
});

// ---- a browser: the DevTools endpoints browser-tabs reads, activation logged ----------------------

const targets = [
  { id: "T1", type: "page", title: "pal: a launcher", url: "https://github.com/zcag/pal?tab=readme" },
  { id: "T2", type: "page", title: "Home Assistant", url: "http://ha.lan/" },
];
const activated: string[] = [];
const browser = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req, srv) {
    const path = new URL(req.url).pathname;
    if (path === "/json/version") return Response.json({ Browser: "Chrome/152.0.0.0", webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/browser/x` });
    if (path === "/json" || path === "/json/list") return Response.json(targets);
    if (path.startsWith("/json/activate/")) { activated.push(path.slice(15)); return new Response("Target activated"); }
    return new Response("not found", { status: 404 });
  },
});

const dir = mkdtempSync(join(tmpdir(), "pal-ql-"));
const importFile = join(dir, "links.json");
writeFileSync(importFile, JSON.stringify([{ name: "Grafana", url: "http://grafana.lan", keywords: ["graphs"] }, { url: "http://bare" }, { name: "no url" }]));

const openLog = join(dir, "open.log");
writeFileSync(join(dir, "open"), `#!/bin/sh\necho "$1|$2" >> ${JSON.stringify(openLog)}\n`);
chmodSync(join(dir, "open"), 0o755);
const opened = () => { try { return readFileSync(openLog, "utf8").trim().split("\n"); } catch { return []; } };

let host: Host;
/** What the canned `core/selection.text` answers. */
let selected: string | null = "kedi";
beforeAll(async () => {
  stored.clear();
  stored.set("quicklinks\0links", [
    { id: "gh", name: "GitHub search", url: "https://github.com/search?q={query}", keywords: ["gh"] },
    { id: "ha", name: "Home Assistant", url: "http://ha.lan" },
    { id: "tr", name: "Translate selection", url: "https://translate.google.com/?text={selection}", app: "Firefox" },
  ]);
  process.env.PAL_QUICKLINKS_BROWSERS = "Safari,Firefox";
  process.env.PAL_QUICKLINKS_OPEN = join(dir, "open");
  try {
    host = await Host.bundled({
      settings: { quicklinks: { settings: { import: importFile } }, "browser-tabs": { settings: { port: browser.port, apps: [], firefox: false } } },
      core: { "selection.text": () => selected },
    });
  } finally { delete process.env.PAL_QUICKLINKS_BROWSERS; delete process.env.PAL_QUICKLINKS_OPEN; }
});
afterAll(() => { host.kill(); browser.stop(true); rmSync(dir, { recursive: true, force: true }); });

const list = () => host.list("quicklinks", "quicklinks");
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("quicklinks", "quicklinks", id, action, ctx);

describe("quicklinks at the root", () => {
  test("a typed web address lists one inline Open row (favicon from the url), picked by its id; a word does not match", async () => {
    const inline = (q: string) => host.request<{ extension: string; items: Item[] }[]>("inline", { query: q }).then((r) => r.find((s) => s.extension === "quicklinks")?.items);
    const rows = await inline("docs.rs/serde");
    expect(rows).toEqual([{ id: "open:https://docs.rs/serde", name: "Open docs.rs/serde", subtitle: "https://docs.rs/serde", url: "https://docs.rs/serde", actions: [{ id: "open", title: "Open" }, { id: "copy", title: "Copy URL", shortcut: "cmd+c" }] }]);
    expect((await inline("https://x.io/a?b"))![0].id).toBe("open:https://x.io/a?b");
    expect(await inline("github")).toBeUndefined();
    expect(await pick("open:https://docs.rs/serde")).toEqual({ open: "https://docs.rs/serde" });
    expect(await pick("open:https://docs.rs/serde", "copy")).toEqual({ copy: "https://docs.rs/serde" });
  });
  test("the fallback rows: every {query} link filled with the query, opened or copied by id", async () => {
    const r = await host.request<{ extension: string; items: Item[] }[]>("fallback", { query: "pal launcher" });
    const rows = r.find((s) => s.extension === "quicklinks")!.items;
    expect(rows).toEqual([{ id: "open:https://github.com/search?q=pal%20launcher", name: "GitHub search", subtitle: "https://github.com/search?q=pal%20launcher", url: "https://github.com/search?q=pal%20launcher", actions: [{ id: "open", title: "Open" }, { id: "copy", title: "Copy URL", shortcut: "cmd+c" }] }]);
    expect(await pick(rows[0].id)).toEqual({ open: "https://github.com/search?q=pal%20launcher" });
    expect(await host.request<unknown[]>("fallback", { query: "  " })).toEqual([]);
  });
});

describe("quicklinks", () => {
  test("rows: the create row first, then stored links (favicon from url, {query} as a tag, edit and delete), then the import file's, read-only, then Import and Export", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["create", "library", "gh", "ha", "tr", "import:http://grafana.lan", "import:http://bare", "import", "export"]);
    expect(items[7]).toMatchObject({ name: "Import Quicklinks", actions: [{ id: "import", title: "Import…" }] });
    expect(items[8]).toMatchObject({ name: "Export Quicklinks", actions: [{ id: "export", title: "Export…" }] });
    expect(items[0]).toMatchObject({ name: "Create Quicklink", icon: "\u{f0c94}", actions: [{ id: "create", title: "Create quicklink" }] });
    expect(items[1]).toMatchObject({ name: "Browse Library", icon: "\u{f0ba9}", actions: [{ id: "library", title: "Browse library" }] });
    for (const i of items) expect(i.icon || i.url).toBeTruthy();
    expect(items[2]).toMatchObject({ name: "GitHub search", subtitle: "https://github.com/search?q={query}", url: "https://github.com/search?q={query}", keywords: ["gh"], accessories: [{ tag: "{query}" }] });
    expect(items[2].icon).toBeUndefined();
    expect(items[2].actions!.map((a) => a.id)).toEqual(["open", "copy", "edit", "delete"]);
    expect(items[2].actions![3]).toMatchObject({ style: "destructive", confirm: "Delete this quicklink?" });
    expect(items[2].detail!.markdown).toContain("https://github.com/search?q={query}");
    expect(items[3].accessories).toBeUndefined();
    // The app it opens with is an accessory and a metadata line; `{selection}` is no tag (nothing is asked for).
    expect(items[4].accessories).toEqual([{ text: "Firefox" }]);
    expect(items[4].detail!.metadata).toContainEqual({ label: "Opens with", value: "Firefox" });
    expect(items[5]).toMatchObject({ name: "Grafana", url: "http://grafana.lan", keywords: ["graphs"] });
    expect(items[5].actions!.map((a) => a.id)).toEqual(["open", "copy"]);
    expect(items[6].name).toBe("http://bare");
  });

  test("{selection} in a url is filled from the app in front's selected text (the newest clipboard text when nothing is selected), percent-encoded, and opens at once with the link's app", async () => {
    expect(await pick("tr")).toEqual({ hide: true });
    await host.until(() => opened().length === 1);
    expect(opened()).toEqual(["Firefox|https://translate.google.com/?text=kedi"]);
    selected = null;
    expect(await pick("tr", "open")).toEqual({ hide: true });
    await host.until(() => opened().length === 2);
    expect(opened()[1]).toBe(`Firefox|https://translate.google.com/?text=${encodeURIComponent(fixtures.clipboard[0].text!)}`);
    selected = "kedi";
    expect(await pick("tr", "copy")).toEqual({ copy: "https://translate.google.com/?text={selection}" });
  });

  test("prefer_existing_tab: a link whose page a browser tab has (query and fragment aside) switches to that tab (activated in the browser, its window raised); a page no tab has opens as before", async () => {
    host.changeSettings("quicklinks", { settings: { import: importFile, prefer_existing_tab: true } });
    stored.set("quicklinks\0links", [...(stored.get("quicklinks\0links") as object[]), { id: "pal", name: "pal", url: "https://github.com/zcag/pal/" }]);
    try {
      // The canned windows carry a Chrome window (w2), which is the one raised.
      expect(await pick("pal")).toEqual({ focus: "w2" });
      expect(activated).toEqual(["T1"]);
      expect(await pick("ha")).toEqual({ focus: "w2" });
      expect(activated).toEqual(["T1", "T2"]);
      expect(await pick("import:http://grafana.lan")).toEqual({ open: "http://grafana.lan" });
      expect(activated).toHaveLength(2);
    } finally {
      host.changeSettings("quicklinks", { settings: { import: importFile } });
      stored.set("quicklinks\0links", (stored.get("quicklinks\0links") as { id: string }[]).filter((l) => l.id !== "pal"));
    }
    expect(await pick("ha")).toEqual({ open: "http://ha.lan" });
    expect(activated).toHaveLength(2);
  });

  test("the library: every ready-made search, the ones you have tagged added; Enter adds one (once), cmd+enter searches with it without saving, cmd+c copies", async () => {
    expect(await pick("library")).toEqual({ push: { extension: "quicklinks", palette: "quicklinks", args: { library: true }, title: "Quicklink Library" } });
    const rows = await host.list("quicklinks", "quicklinks", "", { args: { library: true } });
    expect(rows).toHaveLength(LIBRARY.length);
    expect(rows[0]).toMatchObject({ id: "library:0", name: "Google", url: "https://www.google.com/search?q={query}", keywords: ["g", "search", "web"] });
    expect(rows[0].accessories).toBeUndefined();
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["add", "search", "copy"]);
    const gh = rows.find((r) => r.name === "GitHub")!;
    expect(gh.accessories).toEqual([{ tag: "added", color: "green" }]);
    expect(gh.actions!.map((a) => a.id)).toEqual(["search", "add", "copy"]);
    const ctx = { args: { library: true } };
    expect(await pick("library:0", undefined, ctx)).toEqual({ keep: true, toast: { title: "Added", message: "Google" } });
    const mine = stored.get("quicklinks\0links") as { name: string; url: string; keywords?: string[] }[];
    expect(mine.at(-1)).toMatchObject({ name: "Google", url: "https://www.google.com/search?q={query}", keywords: ["g", "search", "web"] });
    expect(await pick("library:0", "add", ctx)).toEqual({ keep: true, toast: { title: "Already there", message: "Google" } });
    expect((await host.list("quicklinks", "quicklinks", "", ctx))[0].accessories).toEqual([{ tag: "added", color: "green" }]);
    // Searching with one you have goes through your link; one you do not carries the entry along, so the drill-in lists without saving.
    const google = (stored.get("quicklinks\0links") as { id: string; name: string }[]).find((l) => l.name === "Google")!;
    expect(await pick("library:0", "search", ctx)).toEqual({ push: { extension: "quicklinks", palette: "quicklinks", args: { link: google.id }, title: "Google" } });
    const wiki = rows.find((r) => r.name === "Wikipedia")!;
    expect(await pick(wiki.id, "search", ctx)).toEqual({ push: { extension: "quicklinks", palette: "quicklinks", args: { link: wiki.id, library: wiki.id }, title: "Wikipedia" } });
    const drill = await host.list("quicklinks", "quicklinks", "bun", { args: { link: wiki.id, library: wiki.id } });
    expect(drill).toEqual([{ id: "https://en.wikipedia.org/w/index.php?search=bun", name: "Open Wikipedia", subtitle: "https://en.wikipedia.org/w/index.php?search=bun", url: "https://en.wikipedia.org/w/index.php?search=bun", actions: [{ id: "open", title: "Open" }, { id: "copy", title: "Copy URL", shortcut: "cmd+c" }] }]);
    expect(await pick(drill[0].id, "open", { args: { link: wiki.id, library: wiki.id } })).toEqual({ open: "https://en.wikipedia.org/w/index.php?search=bun" });
    expect(await pick(wiki.id, "copy", ctx)).toEqual({ copy: "https://en.wikipedia.org/w/index.php?search={query}" });
    expect((stored.get("quicklinks\0links") as object[]).some((l) => (l as { name: string }).name === "Wikipedia")).toBe(false);
    stored.set("quicklinks\0links", (stored.get("quicklinks\0links") as { name: string }[]).filter((l) => l.name !== "Google"));
  });

  test("a push with args.create is one row whose form comes filled with the link handed over", async () => {
    const ctx = { args: { create: { name: "pal", url: "https://github.com/zcag/pal", keywords: ["launcher"] } } };
    const rows = await host.list("quicklinks", "quicklinks", "", ctx);
    expect(rows).toEqual([{ id: "create", name: "Create Quicklink for pal", subtitle: "https://github.com/zcag/pal", icon: "\u{f0c94}", actions: [{ id: "create", title: "Create quicklink" }] }]);
    const form = (await pick("create", undefined, ctx)).form as Form;
    expect(form.fields.map((f) => (f as { default?: unknown }).default)).toEqual(["pal", "https://github.com/zcag/pal", "launcher", "default"]);
  });

  test("a plain link opens on Enter and copies on cmd+c; an imported one too", async () => {
    expect(await pick("ha")).toEqual({ open: "http://ha.lan" });
    expect(await pick("ha", "open")).toEqual({ open: "http://ha.lan" });
    expect(await pick("ha", "copy")).toEqual({ copy: "http://ha.lan" });
    expect(await pick("import:http://grafana.lan")).toEqual({ open: "http://grafana.lan" });
  });

  test("a {query} link drills in; the level lists one row whose id is the filled url, a hint while nothing is typed", async () => {
    expect(await pick("gh")).toEqual({ push: { extension: "quicklinks", palette: "quicklinks", args: { link: "gh" } } });
    const hint = await host.list("quicklinks", "quicklinks", "", { args: { link: "gh" } });
    expect(hint).toHaveLength(1);
    expect(hint[0]).toMatchObject({ id: "gh", name: "Type the query", actions: [] });
    const rows = await host.list("quicklinks", "quicklinks", "bun test", { args: { link: "gh" } });
    expect(rows).toEqual([{ id: "https://github.com/search?q=bun%20test", name: "Open GitHub search", subtitle: "https://github.com/search?q=bun%20test", url: "https://github.com/search?q=bun%20test", actions: [{ id: "open", title: "Open" }, { id: "copy", title: "Copy URL", shortcut: "cmd+c" }] }]);
    expect(await pick(rows[0].id, "open", { args: { link: "gh" } })).toEqual({ open: "https://github.com/search?q=bun%20test" });
    expect(await pick(rows[0].id, "copy", { args: { link: "gh" } })).toEqual({ copy: "https://github.com/search?q=bun%20test" });
    expect(await host.list("quicklinks", "quicklinks", "x", { args: { link: "nope" } })).toEqual([]);
  });

  test("the create row answers a form; its submit stores the link and lists again", async () => {
    const r = await pick("create", "create");
    const form = r.form as Form;
    expect(form).toMatchObject({ id: "create", title: "Create Quicklink", submit: { id: "save", title: "Create" } });
    expect(form.fields.map((f) => [f.id, f.kind, !!f.required])).toEqual([["name", "text", true], ["url", "text", true], ["keywords", "text", false], ["app", "select", false]]);
    // Filled from the tab in front (the DevTools browser's first target); the browsers found are the Open with choices after Default.
    expect(form.fields.map((f) => (f as { default?: unknown }).default)).toEqual(["pal: a launcher", "https://github.com/zcag/pal?tab=readme", undefined, "default"]);
    expect((form.fields[3] as { options: { id: string; title: string }[] }).options).toEqual([{ id: "default", title: "Default browser" }, { id: "Safari", title: "Safari" }, { id: "Firefox", title: "Firefox" }]);
    const saved = await pick("create", "save", { values: { name: "Docs", url: "https://docs.rs/{query}", keywords: "rust, crate", app: "default" } });
    expect(saved).toEqual({ keep: true, toast: { title: "Created", message: "Docs" } });
    const links = stored.get("quicklinks\0links") as { id: string; name: string; url: string; keywords?: string[]; app?: string }[];
    expect(links).toHaveLength(4);
    expect(links[3]).toEqual({ id: links[3].id, name: "Docs", url: "https://docs.rs/{query}", keywords: ["rust", "crate"] });
    expect(links[3].id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await list()).map((i) => i.name)).toContain("Docs");
    // A browser chosen is stored and shown; the drill-in's Open then goes through it.
    expect(await pick(links[3].id, "save", { values: { name: "Docs", url: "https://docs.rs/{query}", keywords: "rust", app: "Safari" } })).toEqual({ keep: true, toast: { title: "Saved", message: "Docs" } });
    expect((stored.get("quicklinks\0links") as { app?: string }[])[3].app).toBe("Safari");
    const before = opened().length;
    expect(await pick("https://docs.rs/serde", "open", { args: { link: links[3].id } })).toEqual({ hide: true });
    await host.until(() => opened().length === before + 1);
    expect(opened().at(-1)).toBe("Safari|https://docs.rs/serde");
  });

  test("a submit without a usable url is refused: the form again with the message on the field, nothing stored", async () => {
    const before = JSON.stringify(stored.get("quicklinks\0links"));
    const r = await pick("create", "save", { values: { name: "Bad", url: "github.com", keywords: "" } });
    expect((r.form as Form).errors).toEqual({ url: expect.stringMatching(/^Not a URL/) });
    expect((r.form as Form).id).toBe("create");
    expect(r.keep).toBeUndefined();
    expect(JSON.stringify(stored.get("quicklinks\0links"))).toBe(before);
  });

  test("edit answers the form filled in; its submit replaces the link in place", async () => {
    const r = await pick("ha", "edit");
    const form = r.form as Form;
    expect(form).toMatchObject({ id: "ha", title: "Edit Home Assistant", submit: { id: "save", title: "Save" } });
    expect(form.fields.map((f) => (f as { default?: unknown }).default)).toEqual(["Home Assistant", "http://ha.lan", undefined, "default"]);
    expect(await pick("ha", "save", { values: { name: "HA", url: "http://ha.lan:8123", keywords: "home" } })).toEqual({ keep: true, toast: { title: "Saved", message: "HA" } });
    const links = stored.get("quicklinks\0links") as { id: string; name: string; url: string; keywords?: string[] }[];
    expect(links.map((l) => l.id)).toEqual(["gh", "ha", "tr", links[3].id]);
    expect(links[1]).toEqual({ id: "ha", name: "HA", url: "http://ha.lan:8123", keywords: ["home"] });
  });

  test("delete drops the link and lists again", async () => {
    expect(await pick("ha", "delete")).toEqual({ keep: true, toast: { title: "Deleted", message: "HA" } });
    expect((stored.get("quicklinks\0links") as { id: string }[]).map((l) => l.id)).not.toContain("ha");
    expect((await list()).map((i) => i.id)).not.toContain("ha");
  });

  test("an unknown id, and an imported row's edit, are errors, not crashes", async () => {
    expect((await host.call("pick", { extension: "quicklinks", palette: "quicklinks", id: "nope" })).error).toMatch(/no quicklink nope/);
    expect((await host.call("pick", { extension: "quicklinks", palette: "quicklinks", id: "import:http://bare", action: "save", values: { name: "x", url: "https://x" } })).error).toMatch(/no quicklink/);
    expect((await host.hello()).pid).toBe(host.pid);
  });

  test("export asks for a path and writes the stored links (ids left out); import reads one back, skipping urls already there, refusing a file it cannot read", async () => {
    const out = join(dir, "out", "links.json");
    const form = (await pick("export", "export")).form as Form;
    expect(form).toMatchObject({ id: "export", title: "Export Quicklinks", submit: { id: "save", title: "Export" } });
    expect(form.fields.map((f) => [f.id, (f as { default?: string }).default])).toEqual([["path", "~/Downloads/pal-quicklinks.json"]]);
    const before = stored.get("quicklinks\0links") as { id: string; name: string; url: string }[];
    const r = await pick("export", "save", { values: { path: out } });
    expect(r).toEqual({ keep: true, toast: { title: `Exported ${before.length} quicklinks`, message: out } });
    const written = await Bun.file(out).json();
    expect(written).toEqual(before.map(({ id, ...l }) => l));
    // Import: the same file adds nothing; one more link in it adds that one.
    expect(((await pick("import", "import")).form as Form).fields[0].id).toBe("path");
    expect(await pick("import", "save", { values: { path: out } })).toEqual({ keep: true, toast: { title: "Imported 0 quicklinks", message: `${before.length} already there` } });
    writeFileSync(out, JSON.stringify([...written, { name: "New", link: "https://new.example" }]));
    expect(await pick("import", "save", { values: { path: out } })).toEqual({ keep: true, toast: { title: "Imported 1 quicklink", message: `${before.length} already there` } });
    const after = stored.get("quicklinks\0links") as { name: string; url: string }[];
    expect(after).toHaveLength(before.length + 1);
    expect(after.at(-1)).toMatchObject({ name: "New", url: "https://new.example" });
    const bad = (await pick("import", "save", { values: { path: join(dir, "missing.json") } })).form as Form;
    expect(bad.errors!.path).toMatch(/^Could not read/);
    expect(((await pick("export", "save", { values: { path: "" } })).form as Form).errors).toEqual({ path: "Required" });
  });

  test("a broken import file lists the stored links alone and says so on stderr", async () => {
    host.changeSettings("quicklinks", { settings: { import: join(dir, "nope.json") } });
    expect((await list()).map((i) => i.id).some((id) => id.startsWith("import:"))).toBe(false);
    await host.untilStderr("[quicklinks] import");
  });
});
