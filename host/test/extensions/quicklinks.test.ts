// Quicklinks: the placeholder and url helpers (links.ts, pure), then the
// extension over the wire against the harness's in-memory storage: the
// create form and its submit, the refusal round trip, edit, delete, the
// drill-in for a `{query}` link, and an import file's read-only rows.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asLinks, badUrl, fill, fromJson, placeholder, splitKeywords } from "../../../extensions/quicklinks/links.ts";
import type { Form } from "../../../sdk/src/protocol.ts";
import type { Item } from "../../../sdk/src/index.ts";
import { Host, stored } from "../harness.ts";

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
  test("asLinks drops what is not a link; splitKeywords splits on commas and spaces", () => {
    expect(asLinks([{ id: "1", name: "a", url: "u", keywords: ["k", 2] }, { id: "2", name: "b" }, null, "x"])).toEqual([{ id: "1", name: "a", url: "u", keywords: ["k", "2"] }]);
    expect(asLinks(null)).toEqual([]);
    expect(splitKeywords(" gh, code  search ")).toEqual(["gh", "code", "search"]);
    expect(splitKeywords("  ")).toBeUndefined();
  });
});

const dir = mkdtempSync(join(tmpdir(), "pal-ql-"));
const importFile = join(dir, "links.json");
writeFileSync(importFile, JSON.stringify([{ name: "Grafana", url: "http://grafana.lan", keywords: ["graphs"] }, { url: "http://bare" }, { name: "no url" }]));

let host: Host;
beforeAll(async () => {
  stored.clear();
  stored.set("quicklinks\0links", [{ id: "gh", name: "GitHub search", url: "https://github.com/search?q={query}", keywords: ["gh"] }, { id: "ha", name: "Home Assistant", url: "http://ha.lan" }]);
  host = await Host.bundled({ settings: { quicklinks: { settings: { import: importFile } } } });
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

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
    expect(items.map((i) => i.id)).toEqual(["create", "gh", "ha", "import:http://grafana.lan", "import:http://bare", "import", "export"]);
    expect(items[5]).toMatchObject({ name: "Import Quicklinks", actions: [{ id: "import", title: "Import…" }] });
    expect(items[6]).toMatchObject({ name: "Export Quicklinks", actions: [{ id: "export", title: "Export…" }] });
    expect(items[0]).toMatchObject({ name: "Create Quicklink", icon: "\u{f0c94}", actions: [{ id: "create", title: "Create quicklink" }] });
    for (const i of items) expect(i.icon || i.url).toBeTruthy();
    expect(items[1]).toMatchObject({ name: "GitHub search", subtitle: "https://github.com/search?q={query}", url: "https://github.com/search?q={query}", keywords: ["gh"], accessories: [{ tag: "{query}" }] });
    expect(items[1].icon).toBeUndefined();
    expect(items[1].actions!.map((a) => a.id)).toEqual(["open", "copy", "edit", "delete"]);
    expect(items[1].actions![3]).toMatchObject({ style: "destructive", confirm: "Delete this quicklink?" });
    expect(items[1].detail!.markdown).toContain("https://github.com/search?q={query}");
    expect(items[2].accessories).toBeUndefined();
    expect(items[3]).toMatchObject({ name: "Grafana", url: "http://grafana.lan", keywords: ["graphs"] });
    expect(items[3].actions!.map((a) => a.id)).toEqual(["open", "copy"]);
    expect(items[4].name).toBe("http://bare");
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
    expect(form.fields.map((f) => [f.id, f.kind, !!f.required])).toEqual([["name", "text", true], ["url", "text", true], ["keywords", "text", false]]);
    const saved = await pick("create", "save", { values: { name: "Docs", url: "https://docs.rs/{query}", keywords: "rust, crate" } });
    expect(saved).toEqual({ keep: true, toast: { title: "Created", message: "Docs" } });
    const links = stored.get("quicklinks\0links") as { id: string; name: string; url: string; keywords?: string[] }[];
    expect(links).toHaveLength(3);
    expect(links[2]).toMatchObject({ name: "Docs", url: "https://docs.rs/{query}", keywords: ["rust", "crate"] });
    expect(links[2].id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await list()).map((i) => i.name)).toContain("Docs");
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
    expect(form.fields.map((f) => (f as { default?: unknown }).default)).toEqual(["Home Assistant", "http://ha.lan", undefined]);
    expect(await pick("ha", "save", { values: { name: "HA", url: "http://ha.lan:8123", keywords: "home" } })).toEqual({ keep: true, toast: { title: "Saved", message: "HA" } });
    const links = stored.get("quicklinks\0links") as { id: string; name: string; url: string; keywords?: string[] }[];
    expect(links.map((l) => l.id)).toEqual(["gh", "ha", links[2].id]);
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
