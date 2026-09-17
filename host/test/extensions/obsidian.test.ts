// Obsidian: the pure parsing (front matter, tags, wikilinks, resolution,
// the daily-note formats, templates, Obsidian's config files), then the
// extension over the wire against a temp vault shaped like a real one
// (folders, `_index.md`, front matter, inline tags, wikilinks, a daily
// notes plugin config and its template, an excluded folder). Writes land
// in that temp vault only. The search runs with ripgrep when it is on
// PATH and again forced to the Bun scan; a third host finds the vault
// through a fake `obsidian.json`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paneMarkdown } from "../../../extensions/obsidian/index.ts";
import { dailyConfig, excluded, fileName, fillTemplate, firstVault, formatDate, frontMatter, isoWeek, parseNote, resolve, tags, wikilink, wikilinks, type Note } from "../../../extensions/obsidian/notes.ts";
import { parseRg, rgArgv } from "../../../extensions/obsidian/vault.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Item } from "../../../sdk/src/index.ts";
import { Host, stored } from "../harness.ts";

const HAS_RG = Bun.which("rg") !== null;
const NOTE_ACTIONS = ["obsidian", "editor", "copy-link", "read", "backlinks", "outgoing", "copy-path"];

// ---- pure ----------------------------------------------------------------------

describe("front matter and the note", () => {
  test("key: value, [a, b], a block list, quotes stripped; the body follows; no block means none", () => {
    const { meta, body } = frontMatter('---\ntitle: "The Box"\ntags: [infra, homelab]\naliases:\n  - box\n  - "the theater"\ndescription: \'Media\'\nempty:\n---\n# The Box\n\ntext\n');
    expect(meta).toEqual({ title: "The Box", tags: ["infra", "homelab"], aliases: ["box", "the theater"], description: "Media", empty: [] });
    expect(body).toBe("# The Box\n\ntext\n");
    expect(frontMatter("# plain\n")).toEqual({ meta: {}, body: "# plain\n" });
    expect(frontMatter("---\nnot closed\n")).toEqual({ meta: {}, body: "---\nnot closed\n" });
  });
  test("tags: inline #tag and #a/b, the front matter's, once each, never a heading, a number, a url fragment or code", () => {
    expect(tags("# Heading\n\n#project and #reading/rss, #Project again, #2026 no, http://x.io/a#frag no\n\n```\n#code\n```\n`#inline`", { tags: ["infra", "project"] })).toEqual(["infra", "project", "reading/rss"]);
    expect(tags("(#paren) #türkçe #a-b_c", {})).toEqual(["paren", "türkçe", "a-b_c"]);
    expect(tags("", { tags: "one, two" })).toEqual(["one", "two"]);
  });
  test("wikilinks: target, #heading, |label, embeds; once each; a non-note embed and code left out", () => {
    expect(wikilinks("[[a]] [[b#Heading]] [[c|label]] ![[d]] [[a]] ![[pic.png]] [[e.md]] `[[code]]` [[ ]] | [[f\\|in a table]] |")).toEqual(["a", "b", "c", "d", "e", "f"]);
  });
  test("parseNote: the title from the front matter, else the first heading, else the name; the description from the front matter, else the first body line", () => {
    const n = parseNote("infra/theater.md", "---\ndescription: The media box\ntags: [infra]\n---\n# theater\n\nCaddy fronts it. #homelab\n\nSee [[ken]].\n", { mtime: 5, size: 9 });
    expect(n).toMatchObject({ path: "infra/theater.md", name: "theater", title: "theater", folder: "infra", description: "The media box", tags: ["infra", "homelab"], links: ["ken"], mtime: 5, size: 9, words: 8 });
    expect(parseNote("a.md", "# The Title\n\n- first bullet\n", { mtime: 0, size: 0 })).toMatchObject({ title: "The Title", folder: "", description: "first bullet" });
    expect(parseNote("b.md", "---\ntitle: Own\n---\n# Heading\n", { mtime: 0, size: 0 })).toMatchObject({ title: "Own", description: undefined });
    expect(parseNote("c.md", "", { mtime: 0, size: 0 })).toMatchObject({ title: "c", words: 0 });
  });
});

describe("resolving and writing links", () => {
  const notes: Note[] = [
    { path: "infra/theater.md", name: "theater", title: "theater", folder: "infra", tags: [], aliases: ["the box"], links: [], mtime: 0, size: 0, words: 0 },
    { path: "personal/ken.md", name: "ken", title: "ken", folder: "personal", tags: [], aliases: [], links: [], mtime: 0, size: 0, words: 0 },
    { path: "work/notes/ken.md", name: "ken", title: "ken", folder: "work/notes", tags: [], aliases: [], links: [], mtime: 0, size: 0, words: 0 },
    { path: "Index.md", name: "Index", title: "Index", folder: "", tags: [], aliases: [], links: [], mtime: 0, size: 0, words: 0 },
  ];
  test("a path, else the unique name (case-insensitive), else the shortest path among namesakes, else an alias; nothing for a link to nothing", () => {
    expect(resolve("infra/theater", notes)?.path).toBe("infra/theater.md");
    expect(resolve("work/notes/ken.md", notes)?.path).toBe("work/notes/ken.md");
    expect(resolve("THEATER", notes)?.path).toBe("infra/theater.md");
    expect(resolve("ken", notes)?.path).toBe("personal/ken.md");
    expect(resolve("the box", notes)?.path).toBe("infra/theater.md");
    expect(resolve("index", notes)?.path).toBe("Index.md");
    expect(resolve("nowhere", notes)).toBeUndefined();
    expect(resolve("", notes)).toBeUndefined();
  });
  test("the wikilink to copy is [[name]] when unique, [[path]] when another note shares the name", () => {
    expect(wikilink(notes[0], notes)).toBe("[[theater]]");
    expect(wikilink(notes[1], notes)).toBe("[[personal/ken]]");
    expect(wikilink(notes[2], notes)).toBe("[[work/notes/ken]]");
  });
  test("fileName drops Obsidian's forbidden characters and the ends' dots and spaces", () => {
    expect(fileName(' What: "is" a/b? ')).toBe("What- -is- a-b-");
    expect(fileName("...")).toBe("");
  });
});

describe("dates and templates", () => {
  const d = new Date(2026, 8, 17, 9, 5, 7); // Thursday 2026-09-17 09:05:07
  test("formatDate: moment's tokens, literals in brackets, the rest copied", () => {
    expect(formatDate("YYYY-MM-DD", d)).toBe("2026-09-17");
    expect(formatDate("dddd, D MMMM YYYY", d)).toBe("Thursday, 17 September 2026");
    expect(formatDate("YY/M/D ddd MMM Do", d)).toBe("26/9/17 Thu Sep 17th");
    expect(formatDate("HH:mm:ss h A a d Q", d)).toBe("09:05:07 9 AM am 4 3");
    expect(formatDate("[Week] WW [of] YYYY", d)).toBe("Week 38 of 2026");
    expect(formatDate("YYYY/[YYYY]/W", new Date(2027, 0, 1))).toBe("2027/YYYY/53");
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
  });
  test("fillTemplate: {{date}}, {{time}}, {{title}} and their formats", () => {
    expect(fillTemplate("# {{title}}\n{{date}} {{time}} {{ date:dddd }} {{time:h A}}", { title: "Kaş", now: d })).toBe("# Kaş\n2026-09-17 09:05 Thursday 9 AM");
    expect(fillTemplate("no braces", { now: d })).toBe("no braces");
  });
});

describe("Obsidian's files", () => {
  test("obsidian.json: the open vault, else the one used last, else none", () => {
    expect(firstVault({ vaults: { a: { path: "/v/a", ts: 1 }, b: { path: "/v/b", ts: 2 }, c: { path: "/v/c", ts: 3, open: true } } })).toBe("/v/c");
    expect(firstVault({ vaults: { a: { path: "/v/a", ts: 1 }, b: { path: "/v/b", ts: 2 } } })).toBe("/v/b");
    expect(firstVault({ vaults: {} })).toBeUndefined();
    expect(firstVault(null)).toBeUndefined();
  });
  test("daily-notes.json: folder, format and template, slashes trimmed, blank when unset", () => {
    expect(dailyConfig({ folder: "/daily/", format: "YYYY/MM/YYYY-MM-DD", template: "templates/daily" })).toEqual({ folder: "daily", format: "YYYY/MM/YYYY-MM-DD", template: "templates/daily" });
    expect(dailyConfig({})).toEqual({ folder: "", format: "", template: "" });
  });
  test("excluded: a dot segment anywhere, or a glob", () => {
    const globs = [new Bun.Glob("templates/**"), new Bun.Glob("**/drafts/**")];
    expect(excluded(".obsidian/workspace.md", [])).toBe(true);
    expect(excluded("a/.trash/x.md", [])).toBe(true);
    expect(excluded("templates/daily.md", globs)).toBe(true);
    expect(excluded("work/drafts/x.md", globs)).toBe(true);
    expect(excluded("work/x.md", globs)).toBe(false);
  });
});

describe("search backend helpers", () => {
  test("the ripgrep command and its output parsed to hits with their lines", () => {
    const argv = rgArgv("caddy", ["templates/**"]);
    expect(argv.slice(0, 2)).toEqual(["rg", "--line-number"]);
    expect(argv.slice(-7)).toEqual(["--glob", "!.*", "--glob", "!templates/**", "--", "caddy", "."]);
    expect(parseRg("./infra/theater.md:8:> Caddy fronts it.\n./infra/theater.md:12:caddy again\n./x.md:1:Caddy\nnoise\n")).toEqual([
      { path: "infra/theater.md", lines: [{ n: 8, text: "> Caddy fronts it." }, { n: 12, text: "caddy again" }] },
      { path: "x.md", lines: [{ n: 1, text: "Caddy" }] },
    ]);
  });
  test("paneMarkdown: front matter off, callouts a bold lead, wikilinks as obsidian:// links or marked as not a note yet", () => {
    const notes: Note[] = [{ path: "a/ken.md", name: "ken", title: "ken", folder: "a", tags: [], aliases: [], links: [], mtime: 0, size: 0, words: 0 }];
    expect(paneMarkdown("---\ntags: [x]\n---\n> [!WARNING] Careful\n> body\n\n[[ken|the reader]] and [[ken#Top]] and [[nowhere]]\n", "vault", notes))
      .toBe("> **Warning: Careful**\n> body\n\n[the reader](obsidian://open?vault=vault&file=a%2Fken) and [ken#Top](obsidian://open?vault=vault&file=a%2Fken) and nowhere (not a note yet)");
    expect(paneMarkdown("---\na: b\n---\n", "v", [])).toBe("_Nothing in this note yet._");
    expect(paneMarkdown("| a |\n|---|\n| [[ken\\|the reader]] |\n", "vault", notes)).toBe("| a |\n|---|\n| [the reader](obsidian://open?vault=vault&file=a%2Fken) |");
  });
});

// ---- over the wire ----------------------------------------------------------------

process.env.TZ = "UTC"; // bun test runs in UTC; the host it spawns must agree for the daily-note dates below
const today = new Date();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
const threeDaysAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3);

const vault = mkdtempSync(join(tmpdir(), "pal-vault-"));
const scratch = mkdtempSync(join(tmpdir(), "pal-obsidian-"));
const w = (p: string, t: string) => { mkdirSync(join(vault, p, ".."), { recursive: true }); writeFileSync(join(vault, p), t); };
w("_index.md", "# Wiki Index\n\nThe pointer layer.\n\n- [[infra/theater]] the media box\n- [[ken]] the reader\n");
w("_log.md", "# Log\n\n- 2026-09-07, infra / klima: the checksum was solved\n");
w("infra/theater.md", "---\ndescription: The media box under the TV\ntags: [infra, homelab]\naliases: [the box]\n---\n# theater\n\n> [!NOTE]\n> Caddy fronts everything on it.\n\n| service | port |\n|---|---|\n| read | 8791 |\n\nSee [[ken|the reader]] and [[nowhere]].\n");
w("personal/projects/ken.md", "# ken\n\nA feed reader that sends two digests a day. #project #reading/rss\n\n```\n#notatag\n```\n\nRuns next to [[theater]].\n");
w("personal/projects/tan.md", "# tan\n\nThe standing agent. #project\n\n[[ken]] feeds it.\n");
w(`daily/${iso(yesterday)}.md`, `# ${iso(yesterday)}\n\n## Log\n\n- read the ken digest\n`);
w(`daily/${iso(threeDaysAgo)}.md`, `# ${iso(threeDaysAgo)}\n\n## Log\n\n- nothing much\n`);
w(".obsidian/daily-notes.json", JSON.stringify({ folder: "daily", format: "YYYY-MM-DD", template: "templates/daily" }));
w(".obsidian/app.json", "{}");
w("templates/daily.md", "# {{date:dddd, D MMMM YYYY}}\n\n## Log\n\n");
w("templates/note.md", "# {{title}}\n\nCreated {{date}}.\n");
w("drafts/secret.md", "# secret\n\nnot listed\n");
const editorLog = join(scratch, "editor.log");
const editor = join(scratch, "fake-editor");
writeFileSync(editor, `#!/bin/sh\necho "$@" > "${editorLog}"\n`);
chmodSync(editor, 0o755);

const SETTINGS = { vault, exclude: ["templates/**", "drafts/**"], editor, template: "templates/note" };
let host: Host;
beforeAll(async () => {
  stored.clear();
  host = await Host.bundled({ settings: { obsidian: { settings: SETTINGS } }, core: { "clipboard.current": () => ({ id: 9, kind: "text", text: "from the clipboard", image: null, files: null, source_app: null, at: 0, bytes: 18, pinned: false, width: null, height: null }) }, timeout: 10000 });
  await host.hello();
});
afterAll(async () => {
  await host?.close();
  rmSync(vault, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const list = (palette: string, query = "", ctx?: Parameters<Host["list"]>[3]) => host.list("obsidian", palette, query, ctx);
const pick = (palette: string, id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("obsidian", palette, id, action, ctx);
/** Polls a listing until `pred` holds on it. */
async function untilListed(palette: string, pred: (rows: Item[]) => boolean, what: string, timeout = 4000): Promise<Item[]> {
  const t0 = Date.now();
  for (;;) {
    const rows = await list(palette);
    if (pred(rows)) return rows;
    if (Date.now() - t0 > timeout) throw new Error(`${what} not met within ${timeout} ms`);
    await Bun.sleep(100);
  }
}

describe("the extension", () => {
  test("loads: the violet tile, seven palettes with the manifest's kinds and tiers, no warnings, the three link routes", async () => {
    const loaded = host.loaded().find((l) => l.extension === "obsidian")!;
    expect(loaded.warnings).toEqual([]);
    expect(loaded.manifest.icon).toEqual(tile("violet", "\u{f0a6a}"));
    const by = Object.fromEntries(loaded.palettes.map((p) => [p.name, p]));
    expect(Object.keys(by).sort()).toEqual(["backlinks", "daily", "notes", "outgoing", "recent", "search", "tags"]);
    expect(by.notes).toMatchObject({ tier: "primary", ttl: 300, detail: "lazy", live: false, input: false });
    expect(by.search).toMatchObject({ input: true });
    expect(by.daily).toMatchObject({ live: true, detail: "lazy" });
    expect(by.recent).toMatchObject({ live: true });
    expect(by.tags).toMatchObject({ tier: "catalog" });
    expect(Object.keys(loaded.manifest.links!).sort()).toEqual(["append-today", "new", "open"]);
    const m = loaded.manifest as unknown as { store: { tagline: string; actions: { title: string }[] } };
    expect(m.store.tagline.length).toBeLessThan(60);
    for (const p of Object.values(loaded.manifest.palettes!)) for (const k of p.keys ?? []) expect(k.keys).not.toMatch(/^cmd\+(i|r|k)$/);
  });

  test("Notes: the four commands, then every note sectioned by folder, the description as subtitle, tags and the date as accessories; dot folders and the excluded globs are out", async () => {
    const rows = await list("notes");
    expect(rows.slice(0, 4).map((r) => r.id)).toEqual(["cmd:today", "cmd:new", "cmd:search", "cmd:random"]);
    const notes = rows.slice(4);
    expect(notes.map((r) => r.id)).toEqual(["note:_index.md", "note:_log.md", `note:daily/${iso(threeDaysAgo)}.md`, `note:daily/${iso(yesterday)}.md`, "note:infra/theater.md", "note:personal/projects/ken.md", "note:personal/projects/tan.md"]);
    const theater = notes.find((r) => r.id === "note:infra/theater.md")!;
    expect(theater).toMatchObject({ name: "theater", section: "infra", subtitle: "The media box under the TV", icon: "\u{f11d7}", keywords: ["the box", "#infra", "#homelab", "infra"] });
    expect(theater.accessories).toEqual([{ tag: "infra" }, { tag: "homelab" }, { date: expect.any(Number) }]);
    expect(theater.actions!.map((a) => a.id)).toEqual(NOTE_ACTIONS);
    expect(theater.actions![1].shortcut).toBe("cmd+enter");
    const index = notes.find((r) => r.id === "note:_index.md")!;
    expect(index).toMatchObject({ name: "Wiki Index", section: "Vault", subtitle: "The pointer layer." });
    const ken = notes.find((r) => r.id === "note:personal/projects/ken.md")!;
    expect(ken.accessories!.slice(0, 2)).toEqual([{ tag: "project" }, { tag: "reading/rss" }]);
    for (const r of rows) expect(r.icon).toBeDefined();
  });

  test("Enter opens in Obsidian through obsidian://open; cmd+Enter runs the editor with the path; cmd+c copies [[name]]; Copy path is absolute", async () => {
    expect(await pick("notes", "note:infra/theater.md")).toEqual({ open: `obsidian://open?vault=${encodeURIComponent(vault.split("/").pop()!)}&file=infra%2Ftheater` });
    const r = await pick("notes", "note:infra/theater.md", "editor");
    expect(r.hud).toBe("Opened theater in fake-editor");
    await host.until(() => { try { return Bun.file(editorLog).size > 0; } catch { return false; } }, 3000, "editor ran");
    expect((await Bun.file(editorLog).text()).trim()).toBe(join(vault, "infra/theater.md"));
    expect(await pick("notes", "note:infra/theater.md", "copy-link")).toEqual({ copy: "[[theater]]" });
    expect(await pick("notes", "note:infra/theater.md", "copy-path")).toEqual({ copy: join(vault, "infra/theater.md") });
    expect(stored.get("obsidian\0last")).toBe("infra/theater.md");
  });

  test("open_with = editor swaps the pair: Enter runs the editor, cmd+Enter opens Obsidian; an editor off PATH is a failure toast naming the setting", async () => {
    host.changeSettings("obsidian", { settings: { ...SETTINGS, open_with: "editor" } });
    const rows = await list("notes");
    const theater = rows.find((r) => r.id === "note:infra/theater.md")!;
    expect(theater.actions!.slice(0, 2).map((a) => [a.id, a.shortcut])).toEqual([["editor", undefined], ["obsidian", "cmd+enter"]]);
    expect((await pick("notes", "note:infra/theater.md")).hud).toMatch(/^Opened theater/);
    host.changeSettings("obsidian", { settings: { ...SETTINGS, editor: "no-such-editor-xyz" } });
    const r = await pick("notes", "note:infra/theater.md", "editor");
    expect(r.toast).toMatchObject({ title: "no-such-editor-xyz is not installed", style: "failure" });
    host.changeSettings("obsidian", { settings: SETTINGS });
  });

  test("the pane: the note as markdown (callout a bold lead, the table kept, wikilinks into Obsidian), tags, links with the unresolved one grey, the backlinks count", async () => {
    const d = await host.detail("obsidian", "notes", "note:infra/theater.md");
    expect(d.markdown).toContain("> **Note**\n> Caddy fronts everything on it.");
    expect(d.markdown).toContain("| service | port |");
    expect(d.markdown).toContain(`[the reader](obsidian://open?vault=${encodeURIComponent(vault.split("/").pop()!)}&file=personal%2Fprojects%2Fken)`);
    expect(d.markdown).toContain("nowhere (not a note yet)");
    expect(d.markdown).not.toContain("description:");
    const meta = Object.fromEntries(d.metadata!.map((m) => [m.label, m]));
    expect(meta.Path.value).toBe("infra/theater.md");
    expect(meta.Modified.value).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect(meta.Tags.tags).toEqual([{ text: "infra" }, { text: "homelab" }]);
    expect(meta.Aliases.value).toBe("the box");
    expect(meta.Links.tags).toEqual([{ text: "ken" }, { text: "nowhere", color: "grey" }]);
    expect(meta.Backlinks.value).toBe("2: Wiki Index, ken");
    expect(await host.detail("obsidian", "notes", "cmd:new")).toEqual({});
  });

  test("Read in pal: a view titled after the note, the callout as a card with its badge, the table as columns, the links under their paragraph; its actions", async () => {
    const r = await pick("notes", "note:infra/theater.md", "read");
    const v = r.view!;
    expect(v.id).toBe("note:infra/theater.md");
    expect(v.title).toBe("theater");
    const json = JSON.stringify(v.tree);
    expect(json).toContain('"text":"Note","color":"blue"');
    expect(json).toContain("Caddy fronts everything on it.");
    expect(json).toContain('"value":"service"');
    expect(json).toContain("↗ the reader   ↗ nowhere");
    expect(json.split('"value":"theater"').length).toBe(2);
    expect(v.actions.map((a) => a.id)).toEqual(["obsidian", "editor", "copy-link", "backlinks", "outgoing", "copy-markdown"]);
    expect((await pick("notes", "note:infra/theater.md", "copy-markdown")).copy).toMatch(/^---\ndescription: The media box/);
  });

  test("Backlinks and Outgoing links: pushed from a row with its path, else for the note opened last; a link to nothing offers Create the note", async () => {
    expect(await pick("notes", "note:personal/projects/ken.md", "backlinks")).toEqual({ push: { extension: "obsidian", palette: "backlinks", args: { path: "personal/projects/ken.md" } } });
    const back = await list("backlinks", "", { args: { path: "personal/projects/ken.md" } });
    expect(new Set(back.map((r) => r.id))).toEqual(new Set(["note:infra/theater.md", "note:_index.md", "note:personal/projects/tan.md"]));
    expect(back.every((r) => r.section === "Links to ken" && r.icon === "\u{f0339}")).toBe(true);
    // The last opened note is ken (the backlinks pick remembered it), so an unpushed listing is the same.
    expect((await list("backlinks")).map((r) => r.id).sort()).toEqual(back.map((r) => r.id).sort());
    const out = await list("outgoing", "", { args: { path: "infra/theater.md" } });
    expect(out.map((r) => [r.id, r.name, r.section])).toEqual([["note:personal/projects/ken.md", "ken", "From theater"], ["missing:nowhere", "nowhere", "From theater"]]);
    expect(out[1].actions!.map((a) => a.id)).toEqual(["create", "copy-link"]);
    expect(await pick("outgoing", "missing:nowhere", "copy-link", { args: { path: "infra/theater.md" } })).toEqual({ copy: "[[nowhere]]" });
    expect((await list("backlinks", "", { args: { path: "_log.md" } }))[0]).toMatchObject({ id: "hint:none", name: "Nothing links to Log", actions: [] });
    expect((await list("outgoing", "", { args: { path: "_log.md" } }))[0]).toMatchObject({ id: "hint:none", name: "Log links to nothing" });
  });

  test("Tags: every tag with its count, most used first; Enter pushes Notes with the tag, which lists the carriers (a nested tag under its parent too); cmd+c copies it", async () => {
    const rows = await list("tags");
    expect(rows.map((r) => [r.id, r.name, r.accessories])).toEqual([
      ["tag:project", "#project", [{ text: "2 notes" }]],
      ["tag:homelab", "#homelab", [{ text: "1 note" }]],
      ["tag:infra", "#infra", [{ text: "1 note" }]],
      ["tag:reading/rss", "#reading/rss", [{ text: "1 note" }]],
    ]);
    expect(await pick("tags", "tag:project")).toEqual({ push: { extension: "obsidian", palette: "notes", args: { tag: "project" } } });
    expect(await pick("tags", "tag:project", "copy")).toEqual({ copy: "#project" });
    expect((await list("notes", "", { args: { tag: "project" } })).map((r) => r.id).sort()).toEqual(["note:personal/projects/ken.md", "note:personal/projects/tan.md"]);
    expect((await list("notes", "", { args: { tag: "reading" } })).map((r) => r.id)).toEqual(["note:personal/projects/ken.md"]);
    expect((await list("notes", "", { args: { tag: "nope" } }))[0].id).toBe("hint:none");
  });

  test("Recent Notes: newest first, the folder and description as subtitle, no sections", async () => {
    await Bun.sleep(20);
    writeFileSync(join(vault, "personal/projects/tan.md"), "# tan\n\nThe standing agent, touched. #project\n\n[[ken]] feeds it.\n");
    const rows = await host.list("obsidian", "recent", "", { refresh: true });
    expect(rows[0]).toMatchObject({ id: "note:personal/projects/tan.md", subtitle: "personal/projects · The standing agent, touched. #project", icon: "\u{f02da}" });
    expect(rows.every((r) => r.section === undefined)).toBe(true);
    expect(rows.length).toBe(7);
  });

  test("Daily Notes: today missing is a Create row that asks; yesterday and this week listed; Enter creates today from the template and opens it", async () => {
    const rows = await list("daily");
    expect(rows.map((r) => [r.id, r.section])).toEqual([
      ["daily:create", "Daily notes"],
      [`note:daily/${iso(yesterday)}.md`, "Daily notes"],
      [`note:daily/${iso(threeDaysAgo)}.md`, "This week"],
      ["append", "Write"],
      ["new", "Write"],
    ]);
    expect(rows[0]).toMatchObject({ name: "Create today's note", subtitle: `daily/${iso(today)}.md, from the template`, actions: [{ id: "create", title: "Create today's note", confirm: "Create today's note from the template?" }] });
    expect(rows[1].subtitle).toMatch(/^Yesterday · /);
    const r = await pick("daily", "daily:create", "create");
    expect(r).toEqual({ open: expect.stringContaining(`file=daily%2F${iso(today)}`), hud: `Created ${iso(today)}` });
    const text = await Bun.file(join(vault, `daily/${iso(today)}.md`)).text();
    expect(text).toBe(`# ${formatDate("dddd, D MMMM YYYY", today)}\n\n## Log\n\n`);
    const after = await list("daily");
    expect(after[0]).toMatchObject({ id: `note:daily/${iso(today)}.md`, name: formatDate("dddd, D MMMM YYYY", today), subtitle: `Today · daily/${iso(today)}.md` });
    // The command row opens the existing note without creating.
    expect(await pick("notes", "cmd:today")).toEqual({ open: expect.stringContaining(`file=daily%2F${iso(today)}`) });
  });

  test("Append to today: the form prefilled from the clipboard; the submit expands placeholders and lands the text on its own line at the end; empty text is refused", async () => {
    const f = (await pick("daily", "append")).form!;
    expect(f).toMatchObject({ id: "append", title: "Append to today", submit: { id: "append:save", title: "Append" } });
    expect(f.fields[0]).toMatchObject({ kind: "textarea", id: "text", required: true, default: "from the clipboard" });
    expect(await pick("daily", "append", "append:save", { values: { text: "- read {clipboard} on {date}" } })).toEqual({ hud: `Appended to ${iso(today)}` });
    expect(await Bun.file(join(vault, `daily/${iso(today)}.md`)).text()).toBe(`# ${formatDate("dddd, D MMMM YYYY", today)}\n\n## Log\n\n- read from the clipboard on ${iso(today)}\n`);
    expect(await pick("daily", "append", "append:save", { values: { text: "second" } })).toEqual({ hud: `Appended to ${iso(today)}` });
    expect(await Bun.file(join(vault, `daily/${iso(today)}.md`)).text()).toMatch(/on \d{4}-\d\d-\d\d\nsecond\n$/);
    const refused = await pick("daily", "append", "append:save", { values: { text: "  " } });
    expect(refused.form!.errors).toEqual({ text: "Required" });
    expect(await pick("notes", "cmd:today", "append")).toMatchObject({ form: { id: "append" } });
  });

  test("New note: the form (title, the vault's folders, the body from the template with {{title}} filled); the submit writes the file and opens it; a duplicate is refused", async () => {
    const f = (await pick("notes", "cmd:new")).form!;
    expect(f).toMatchObject({ id: "new", title: "New note", submit: { id: "new:save", title: "Create note" } });
    expect(f.fields.map((x) => x.id)).toEqual(["title", "folder", "body"]);
    expect((f.fields[1] as { options: { id: string }[] }).options.map((o) => o.id)).toEqual(["", "daily", "infra", "personal/projects"]);
    expect((f.fields[2] as { default?: string }).default).toBe(`# \n\nCreated ${iso(today)}.\n`);
    const r = await pick("notes", "new", "new:save", { values: { title: "Trip: Kaş?", folder: "personal/projects", body: "# {{title}}\n\nferry times\n" } });
    expect(r).toEqual({ open: expect.stringContaining("file=personal%2Fprojects%2FTrip-%20Ka%C5%9F-"), hud: "Created Trip- Kaş-" });
    expect(await Bun.file(join(vault, "personal/projects/Trip- Kaş-.md")).text()).toBe("# Trip- Kaş-\n\nferry times\n");
    const dup = await pick("notes", "new", "new:save", { values: { title: "Trip: Kaş?", folder: "personal/projects", body: "" } });
    expect(dup.form!.errors).toEqual({ title: "personal/projects/Trip- Kaş-.md is there already" });
    expect((await pick("notes", "new", "new:save", { values: { title: " ", folder: "", body: "" } })).form!.errors).toEqual({ title: "Required" });
    expect((await list("daily")).find((x) => x.id === "new")).toBeDefined();
  });

  test("the watcher: a note written by hand shows in the next listing without a refresh, and a deleted one is gone", async () => {
    writeFileSync(join(vault, "infra", "archer.md"), "# archer\n\nThe home server. #infra\n");
    const rows = await untilListed("notes", (r) => r.some((x) => x.id === "note:infra/archer.md"), "the new note listed");
    expect(rows.find((r) => r.id === "note:infra/archer.md")).toMatchObject({ name: "archer", section: "infra", subtitle: "The home server. #infra" });
    rmSync(join(vault, "infra", "archer.md"));
    await untilListed("notes", (r) => !r.some((x) => x.id === "note:infra/archer.md"), "the deleted note gone");
    expect((await list("tags")).find((r) => r.id === "tag:infra")!.accessories).toEqual([{ text: "1 note" }]);
  });

  test("Search Notes: a hint under two characters; hits with the matching line as subtitle (leading marks off), the count, the matches bold in the pane; a note titled like the query first; nothing found says so", async () => {
    const hint = await list("search", "");
    expect(hint[0]).toMatchObject({ id: "hint:search", name: "Search every note's text", actions: [{ id: "obsidian", title: "Search in Obsidian" }] });
    expect(hint[0].subtitle).toContain(HAS_RG ? "ripgrep" : "a scan");
    expect((await pick("search", "hint:search", "obsidian")).open).toMatch(/^obsidian:\/\/search\?vault=.*&query=$/);
    const rows = await list("search", "caddy");
    expect(rows.map((r) => r.id)).toEqual(["note:infra/theater.md"]);
    expect(rows[0]).toMatchObject({ section: "infra", subtitle: "Caddy fronts everything on it.", accessories: [{ text: "1 line" }, { date: expect.any(Number) }] });
    expect(rows[0].detail!.markdown).toBe("9: **Caddy** fronts everything on it.");
    const ken = await list("search", "ken");
    expect(ken[0].id).toBe("note:personal/projects/ken.md");
    expect(ken.map((r) => r.id)).toContain("note:_index.md");
    expect(ken.map((r) => r.id)).not.toContain("note:drafts/secret.md");
    expect((await list("search", "zzzz-nothing"))[0]).toMatchObject({ id: "hint:empty", name: "No note has “zzzz-nothing”" });
    expect((await list("search", "not listed"))[0].id).toBe("hint:empty");
  });

  test("links: open by path or name, new with a template body, append-today; a missing note or title is the refusal's line", async () => {
    const link = (route: string, params: Record<string, unknown>) => host.request<Record<string, unknown>>("link", { extension: "obsidian", route, params });
    expect(await link("open", { path: "infra/theater" })).toEqual({ open: expect.stringContaining("file=infra%2Ftheater") });
    expect(await link("open", { path: "the box" })).toEqual({ open: expect.stringContaining("file=infra%2Ftheater") });
    expect(await link("open", { path: "personal/projects/ken.md" })).toEqual({ open: expect.stringContaining("file=personal%2Fprojects%2Fken") });
    await expect(link("open", { path: "nope" })).rejects.toThrow('no note "nope"');
    expect(await link("append-today", { text: "from a link" })).toEqual({ hud: `Appended to ${iso(today)}` });
    expect(await Bun.file(join(vault, `daily/${iso(today)}.md`)).text()).toMatch(/\nfrom a link\n$/);
    expect(await link("new", { title: "From a link", body: "# {{title}}\n\nhi" })).toEqual({ open: expect.stringContaining("file=From%20a%20link"), hud: "Created From a link" });
    expect(await Bun.file(join(vault, "From a link.md")).text()).toBe("# From a link\n\nhi");
    await expect(link("new", { title: "From a link" })).rejects.toThrow("From a link.md is there already");
  });

  test("Random note opens one of the notes; the missing-vault hints name the fix", async () => {
    const r = await pick("notes", "cmd:random");
    expect(r.open).toMatch(/^obsidian:\/\/open\?vault=.*&file=/);
    host.changeSettings("obsidian", { settings: { ...SETTINGS, vault: join(scratch, "no-such-vault") } });
    const rows = await list("notes");
    expect(rows).toEqual([{ id: "hint:vault", name: "The vault folder is missing", subtitle: `${join(scratch, "no-such-vault")} is not there; Settings › Extensions › Obsidian names it`, icon: "\u{f0026}", actions: [{ id: "settings", title: "Open settings" }] }]);
    expect(await pick("notes", "hint:vault", "settings")).toEqual({ open: "pal://settings/extensions" });
    host.changeSettings("obsidian", { settings: SETTINGS });
    expect((await list("notes")).length).toBeGreaterThan(4);
  });
});

describe("the Bun scan and Obsidian's own vault list", () => {
  let scan: Host, auto: Host;
  const config = join(scratch, "obsidian.json");
  beforeAll(async () => {
    writeFileSync(config, JSON.stringify({ vaults: { a: { path: "/nowhere/old", ts: 1 }, b: { path: vault, ts: 2, open: true } } }));
    process.env.PAL_OBSIDIAN_SEARCH = "scan";
    scan = await Host.bundled({ settings: { obsidian: { settings: SETTINGS } }, timeout: 10000 });
    delete process.env.PAL_OBSIDIAN_SEARCH;
    process.env.PAL_OBSIDIAN_CONFIG = config;
    auto = await Host.bundled({ settings: { obsidian: { settings: { exclude: ["templates/**", "drafts/**"] } } }, timeout: 10000 });
    delete process.env.PAL_OBSIDIAN_CONFIG;
    await Promise.all([scan.hello(), auto.hello()]);
  });
  afterAll(async () => { await scan?.close(); await auto?.close(); });

  test("forced to the scan, the search answers the same hits, the line and the bold match included", async () => {
    const rows = await scan.list("obsidian", "search", "caddy");
    expect(rows.map((r) => r.id)).toEqual(["note:infra/theater.md"]);
    expect(rows[0].subtitle).toBe("Caddy fronts everything on it.");
    expect(rows[0].detail!.markdown).toBe("9: **Caddy** fronts everything on it.");
    expect((await scan.list("obsidian", "search", ""))[0].subtitle).toContain("a scan");
  });

  test("without a vault setting the open vault in obsidian.json is the one; without that file it is the hint naming the setting", async () => {
    const rows = await auto.list("obsidian", "notes");
    expect(rows.map((r) => r.id)).toContain("note:infra/theater.md");
    process.env.PAL_OBSIDIAN_CONFIG = join(scratch, "missing.json");
    const none = await Host.bundled({ settings: { obsidian: { settings: {} } }, timeout: 10000 });
    delete process.env.PAL_OBSIDIAN_CONFIG;
    try {
      const hint = await none.list("obsidian", "notes");
      expect(hint).toEqual([{ id: "hint:vault", name: "Set the vault folder", subtitle: "Settings › Extensions › Obsidian: the folder Obsidian opens; found by itself once Obsidian has opened one", icon: "\u{f08bb}", actions: [{ id: "settings", title: "Open settings" }] }]);
    } finally { await none.close(); }
  });
});
