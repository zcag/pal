// files: an input palette over a spawned search. A temp folder of named
// files is the world; `PAL_FILES_BACKEND=find` makes the extension walk it
// (Spotlight, fd and locate would not know a folder made a moment ago),
// and `PAL_RECENT_XBEL` names a recently-used.xbel written here for the
// recents (Spotlight's last-used dates would not know the folder either).
// Skipped where `find` is missing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentArgv, parseQuery, snippet, snippetArgv } from "../../../extensions/files/content.ts";
import { parseMdfindRecent, parseXbel } from "../../../extensions/files/recent.ts";
import type { Item } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";

const HAS_FIND = Bun.which("find") !== null;
const HAS_GREP = Bun.which("grep") !== null;
const MAC = process.platform === "darwin";
const FILE_ACTIONS = ["open", "reveal", ...(MAC ? ["quick-look"] : []), "open-with", "copy", "copy-file", "trash"];
/** An image or a PDF: Copy text (OCR) before the trash. */
const OCR_ACTIONS = [...FILE_ACTIONS.slice(0, -1), "copy-text", "trash"];

describe("content search helpers", () => {
  test("a ' or content: prefix asks for contents only; anything else for names with contents second", () => {
    expect(parseQuery("'secret phrase")).toEqual({ name: "", content: "secret phrase", only: true });
    expect(parseQuery("content: secret ")).toEqual({ name: "", content: "secret", only: true });
    expect(parseQuery("'")).toEqual({ name: "", content: "", only: true });
    expect(parseQuery(" report ")).toEqual({ name: "report", content: "report", only: false });
    expect(parseQuery("it's")).toEqual({ name: "it's", content: "it's", only: false });
  });
  test("the listing commands per tool, and the one-line snippet", () => {
    expect(contentArgv("mdfind", 'say "hi"', ["/a", "/b"], false)).toEqual(["mdfind", "-onlyin", "/a", "-onlyin", "/b", 'kMDItemTextContent == "*say \\"hi\\"*"cd']);
    expect(contentArgv("rg", "x", ["/a"], true)).toEqual(["rg", "--files-with-matches", "--fixed-strings", "--ignore-case", "--no-messages", "--hidden", "--", "x", "/a"]);
    expect(contentArgv("grep", "x", ["/a"], false)).toEqual(["grep", "-rlIiF", "--exclude-dir=.*", "--", "x", "/a"]);
    expect(snippetArgv("rg", "x", "/a/f")).toEqual(["rg", "--line-number", "--max-count", "1", "--fixed-strings", "--ignore-case", "--no-messages", "--", "x", "/a/f"]);
    expect(snippetArgv("grep", "x", "/a/f")).toEqual(["grep", "-niF", "-m", "1", "--", "x", "/a/f"]);
    expect(snippet("12:   the   secret\tphrase  \n")).toBe("the secret phrase");
    expect(snippet("")).toBe("");
    expect(snippet("3:" + "x".repeat(200), 20)).toBe("x".repeat(19) + "…");
  });
});

describe("recent sources", () => {
  test("mdfind -attr lines: path and last-used date, newest first, other lines skipped", () => {
    expect(parseMdfindRecent("/a/b.txt   kMDItemLastUsedDate = 2026-09-15 17:40:59 +0000\n/c d.rtf   kMDItemLastUsedDate = 2026-09-16 10:30:07 +0200\nnoise\n")).toEqual([
      { path: "/c d.rtf", at: Date.parse("2026-09-16T10:30:07+02:00") },
      { path: "/a/b.txt", at: Date.parse("2026-09-15T17:40:59+00:00") },
    ]);
  });
  test("recently-used.xbel: file hrefs decoded, visited (else modified) as the moment, newest first, other schemes skipped", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <bookmark href="file:///home/x/a%20b.txt" added="2026-09-10T10:00:00Z" modified="2026-09-12T10:00:00Z" visited="2026-09-14T10:00:00Z"><info/></bookmark>
  <bookmark href="file:///home/x/c.md" added="2026-09-15T10:00:00Z" modified="2026-09-15T12:00:00Z"/>
  <bookmark href="https://example.com" visited="2026-09-16T10:00:00Z"/>
</xbel>`;
    expect(parseXbel(xml)).toEqual([{ path: "/home/x/c.md", at: Date.parse("2026-09-15T12:00:00Z") }, { path: "/home/x/a b.txt", at: Date.parse("2026-09-14T10:00:00Z") }]);
    expect(parseXbel("")).toEqual([]);
  });
});

let host: Host;
let dir: string;
/** Canned `core/apps.for_file`: what LaunchServices would say for a text file; `open_with` refuses one app. */
const APPS = [
  { name: "TextEdit", path: "/System/Applications/TextEdit.app", bundle_id: "com.apple.TextEdit", default: true },
  { name: "kitty", path: "/Applications/kitty.app", bundle_id: "net.kovidgoyal.kitty", default: false },
  { name: "Notes", path: "/System/Applications/Notes.app", default: false },
];
const opened: unknown[] = [];
beforeAll(async () => {
  if (!HAS_FIND) return;
  dir = mkdtempSync(join(tmpdir(), "pal-files-"));
  writeFileSync(join(dir, "report-alpha.txt"), "line one\nline two\nline three\n");
  writeFileSync(join(dir, "Report-Beta.md"), "# beta\n");
  writeFileSync(join(dir, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]));
  writeFileSync(join(dir, ".report-hidden.txt"), "secret\n");
  mkdirSync(join(dir, "reports"));
  writeFileSync(join(dir, "reports", "report-gamma.txt"), "gamma\n");
  mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(dir, "node_modules", "dep", "report-delta.txt"), "delta\n");
  mkdirSync(join(dir, "Library", "Caches"), { recursive: true });
  writeFileSync(join(dir, "Library", "Caches", "report-epsilon.txt"), "epsilon\n");
  const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400_000).toISOString();
  // Outside the search folder: its text names every file, which the content search would otherwise list it for.
  const xbel = join(mkdtempSync(join(tmpdir(), "pal-files-xbel-")), "recent.xbel");
  writeFileSync(xbel, `<?xml version="1.0" encoding="UTF-8"?>
<xbel version="1.0">
  <bookmark href="file://${join(dir, "Report-Beta.md")}" visited="${at(1)}"/>
  <bookmark href="file://${join(dir, "reports", "report-gamma.txt")}" visited="${at(2)}"/>
  <bookmark href="file://${join(dir, "reports")}" visited="${at(0)}"/>
  <bookmark href="file://${join(dir, "node_modules", "dep", "report-delta.txt")}" visited="${at(0)}"/>
  <bookmark href="file://${join(dir, ".report-hidden.txt")}" visited="${at(0)}"/>
  <bookmark href="file://${join(dir, "gone.txt")}" visited="${at(0)}"/>
  <bookmark href="file://${join(dir, "photo.png")}" visited="${at(9)}"/>
  <bookmark href="file:///etc/hosts" visited="${at(0)}"/>
</xbel>`);
  writeFileSync(join(dir, "notes.md"), "shopping\nthe Secret Phrase is here\n");
  writeFileSync(join(dir, "scan.pdf"), "%PDF-1.4\n");
  process.env.PAL_FILES_BACKEND = "find";
  process.env.PAL_FILES_CONTENT = "grep";
  process.env.PAL_RECENT_XBEL = xbel;
  host = await Host.bundled({
    settings: { files: { settings: { folders: [dir] } } },
    core: {
      "apps.for_file": (p: { path: string }) => (p.path.endsWith(".png") ? [] : APPS),
      "apps.open_with": (p: { path: string; app: string }) => { if (p.app.endsWith("Notes.app")) throw new Error("Notes refused"); opened.push(p); return null; },
    },
  });
});
afterAll(() => { host?.kill(); if (dir) rmSync(dir, { recursive: true, force: true }); });

const list = (q?: string) => host.list("files", "files", q);
const pick = (id: string, action?: string) => host.pick("files", "files", id, action);

describe.skipIf(!HAS_FIND)("files at the root", () => {
  test("a typed path lists the file, or the entries its last segment starts (hidden ones only when the segment does); inline and inside the palette alike", async () => {
    const { pathRows } = await import("../../../extensions/files/index.ts");
    expect((await pathRows(join(dir, "report-alpha.txt"), false)).map((i) => i.id)).toEqual([join(dir, "report-alpha.txt")]);
    expect((await pathRows(join(dir, "rep"), false)).map((i) => i.name)).toEqual(["report-alpha.txt", "Report-Beta.md", "reports"]);
    expect((await pathRows(join(dir, ".rep"), false)).map((i) => i.name)).toEqual([".report-hidden.txt"]);
    expect((await pathRows(join(dir, "reports") + "/", false)).map((i) => i.name)).toEqual(["report-gamma.txt"]);
    expect(await pathRows(join(dir, "nope", "x"), false)).toEqual([]);
    expect(await pathRows("report", false)).toEqual([]); // not a path
    const inline = await host.request<{ extension: string; items: Item[] }[]>("inline", { query: join(dir, "rep") });
    expect(inline.find((s) => s.extension === "files")!.items.map((i) => i.name)).toEqual(["report-alpha.txt", "Report-Beta.md", "reports"]);
    expect((await inline.find((s) => s.extension === "files")!.items[0].actions!)[0].id).toBe("open");
    expect((await list(join(dir, "rep"))).map((i) => i.name)).toEqual(["report-alpha.txt", "Report-Beta.md", "reports"]);
    expect(await host.request("inline", { query: "report" }).then((r: any) => r.find((s: any) => s.extension === "files"))).toBeUndefined();
    expect(host.loaded().find((l) => l.extension === "files")!.palettes[0]).toMatchObject({ inline: true, fallback: "ask", fallbackTitle: "Search Files for “{query}”" });
  });
});

describe.skipIf(!HAS_FIND)("files", () => {
  test("meta: an input palette with lazy detail, and the live Recent Files palette with a ttl", () => {
    expect(host.loaded().find((l) => l.extension === "files")!.palettes).toEqual([
      { name: "files", title: "Files", live: false, input: true, icon: tile("slate", "\u{f024b}"), placeholder: "Search files by name", detail: "lazy", inline: true, match: "^\\s*(~|\\/)", fallback: "ask", fallbackTitle: "Search Files for “{query}”" },
      { name: "recent", title: "Recent Files", live: true, input: false, icon: tile("slate", "\u{f024b}"), placeholder: "Search recent files", ttl: 60, detail: "lazy", tier: "primary" },
    ]);
  });

  test("an empty query lists the recently used files, newest first, in a section: folders, hidden and excluded paths, gone files, other roots and older than a week left out", async () => {
    const recent = await list("");
    expect(recent.map((i) => i.name)).toEqual(["Report-Beta.md", "report-gamma.txt"]);
    expect(recent[0]).toMatchObject({ id: join(dir, "Report-Beta.md"), section: "Recently used", icon: "󰧮", accessories: [{ text: "7 B" }, { date: expect.any(Number) }] });
    expect(recent[0].actions!.map((a) => a.id)).toEqual(FILE_ACTIONS);
    expect(await list()).toEqual(recent);
  });

  test("the Recent Files palette lists the same rows without a section, and its rows have the same actions and detail", async () => {
    const rows = await host.list("files", "recent");
    expect(rows.map((i) => i.name)).toEqual(["Report-Beta.md", "report-gamma.txt"]);
    expect(rows[0].section).toBeUndefined();
    expect(rows[0].actions!.map((a) => a.id)).toEqual(FILE_ACTIONS);
    const p = join(dir, "Report-Beta.md");
    expect(await host.pick("files", "recent", p, "copy")).toEqual({ copy: p });
    expect(await host.pick("files", "recent", p, "open-with")).toEqual({ push: { extension: "files", palette: "recent", args: { open_with: p } } });
    expect((await host.list("files", "recent", "", { args: { open_with: p } })).map((r) => r.name)).toEqual(APPS.map((a) => a.name));
    expect((await host.detail("files", "recent", p)).metadata!.map((m) => m.label)).toEqual(["Path", "Size", "Modified", "Kind"]);
  });

  test("with no recent files the empty query lists inert hints naming the backend and the folders; find warns it is slow", async () => {
    host.changeSettings("files", { settings: { folders: [join(dir, "Library")] } });
    const hints = await list("");
    expect(hints.map((h) => h.actions)).toEqual([[], []]);
    expect(hints[0].subtitle).toBe(`find in ${join(dir, "Library")}`);
    expect(hints[1].name).toBe("This will be slow");
    host.changeSettings("files", { settings: { folders: [dir] } });
  });

  test("rows: name, parent as subtitle, size and date accessories, glyph by kind, the actions; exact and prefix matches first", async () => {
    const items = await list("report");
    // All four are prefix matches, so the order is find's (traversal, not sorted).
    expect(items.map((i) => i.name).sort()).toEqual(["Report-Beta.md", "report-alpha.txt", "report-gamma.txt", "reports"]);
    const alpha = items.find((i) => i.name === "report-alpha.txt")!;
    expect(alpha.id).toBe(join(dir, "report-alpha.txt"));
    expect(alpha.subtitle).toBe(dir);
    expect(alpha.icon).toBe("󰧮");
    expect(alpha.accessories).toEqual([{ text: "29 B" }, { date: expect.any(Number) }]);
    expect(alpha.actions!.map((a) => a.id)).toEqual(FILE_ACTIONS);
    expect(alpha.actions!.at(-1)).toMatchObject({ id: "trash", style: "destructive", confirm: expect.any(String) });
    expect(alpha.actions!.find((a) => a.id === "copy-file")).toEqual({ id: "copy-file", title: "Copy file", shortcut: "cmd+shift+c" });
    if (MAC) expect(alpha.actions!.find((a) => a.id === "quick-look")).toEqual({ id: "quick-look", title: "Quick Look", shortcut: "cmd+y" });
    expect(items.find((i) => i.name === "report-gamma.txt")!.subtitle).toBe(join(dir, "reports"));
    expect(items.find((i) => i.name === "reports")).toMatchObject({ icon: "󰉖", accessories: [{ date: expect.any(Number) }] });
    expect((await list("photo"))[0].icon).toBe("󰥶");
  });

  test("hidden files are skipped until show_hidden; limit caps the rows", async () => {
    expect((await list("hidden"))).toEqual([]);
    host.changeSettings("files", { settings: { folders: [dir], show_hidden: true } });
    expect((await list("hidden")).map((i) => i.name)).toEqual([".report-hidden.txt"]);
    host.changeSettings("files", { settings: { folders: [dir], limit: 2 } });
    expect(await list("report")).toHaveLength(2);
    host.changeSettings("files", { settings: { folders: [dir] } });
    expect(await list("report")).toHaveLength(4);
  });

  test("the exclude folders are pruned (node_modules at any depth, Library/Caches as a path) until the setting empties", async () => {
    expect((await list("report")).map((i) => i.name)).not.toContain("report-delta.txt");
    host.changeSettings("files", { settings: { folders: [dir], exclude: [] } });
    expect((await list("report")).map((i) => i.name).sort()).toContain("report-delta.txt");
    expect((await list("report")).map((i) => i.name)).toContain("report-epsilon.txt");
    host.changeSettings("files", { settings: { folders: [dir] } });
    expect(await list("report")).toHaveLength(4);
  });

  test("no match is an empty list; a glob character in the query is literal", async () => {
    expect(await list("zzz-nothing")).toEqual([]);
    expect(await list("*")).toEqual([]);
  });

  test("detail: path, size, modified, kind, and a text file's first lines; nothing inline for an image", async () => {
    const d = await host.detail("files", "files", join(dir, "report-alpha.txt"));
    expect(d.metadata!.map((m) => m.label)).toEqual(["Path", "Size", "Modified", "Kind"]);
    expect(d.metadata![3].value).toBe("document");
    expect(d.markdown).toBe("````txt\nline one\nline two\nline three\n\n````");
    const img = await host.detail("files", "files", join(dir, "photo.png"));
    expect(img.markdown).toBeUndefined();
    expect(img.metadata![3].value).toBe("image");
    const folder = await host.detail("files", "files", join(dir, "reports"));
    expect(folder.metadata!.map((m) => m.label)).toEqual(["Path", "Modified", "Kind"]);
  });

  test("contents: a ' query lists files whose text has the words, the matching line as the subtitle, in the In files section", async () => {
    if (!HAS_GREP) return;
    const rows = await list("'secret phrase");
    expect(rows.map((r) => r.name)).toEqual(["notes.md"]);
    expect(rows[0]).toMatchObject({ id: join(dir, "notes.md"), section: "In files", subtitle: `the Secret Phrase is here · ${dir}` });
    expect(rows[0].actions!.map((a) => a.id)).toEqual(FILE_ACTIONS);
    expect((await list("content:shopping")).map((r) => r.name)).toEqual(["notes.md"]);
    expect(await list("'nothing-like-this")).toEqual([]);
    const blank = await list("'");
    expect(blank).toHaveLength(1);
    expect(blank[0]).toMatchObject({ name: "Type words to find in file contents", subtitle: `grep in ${dir}`, actions: [] });
  });

  test("contents: a plain query gets the content matches as a second section after the name matches, never a file twice; off with content_search", async () => {
    if (!HAS_GREP) return;
    // "line two" is in report-alpha.txt, whose name does not match; "alpha" is in its name and its path only.
    const rows = await list("line two");
    expect(rows.map((r) => [r.name, r.section])).toEqual([["report-alpha.txt", "In files"]]);
    expect(rows[0].subtitle).toBe(`line two · ${dir}`);
    const both = await list("shopping");
    expect(both.map((r) => r.name)).toEqual(["notes.md"]);
    // A name match whose text also has the query is listed once, as the name match.
    writeFileSync(join(dir, "gamma-notes.txt"), "gamma\n");
    const once = await list("gamma");
    expect(once.filter((r) => r.name === "gamma-notes.txt")).toHaveLength(1);
    expect(once.find((r) => r.name === "gamma-notes.txt")!.section).toBeUndefined();
    expect(once.every((r) => r.section === undefined)).toBe(true);
    host.changeSettings("files", { settings: { folders: [dir], content_search: false } });
    expect(await list("line two")).toEqual([]);
    expect((await list("'line two")).map((r) => r.name)).toEqual(["report-alpha.txt"]);
    host.changeSettings("files", { settings: { folders: [dir] } });
  });

  test("Copy text (OCR) is offered on images and PDFs, before the trash", async () => {
    expect((await list("photo"))[0].actions!.map((a) => a.id)).toEqual(OCR_ACTIONS);
    expect((await list("scan"))[0].actions!.map((a) => a.id)).toEqual(OCR_ACTIONS);
    expect((await list("photo"))[0].actions!.find((a) => a.id === "copy-text")).toEqual({ id: "copy-text", title: "Copy text (OCR)", shortcut: "cmd+shift+t" });
  });

  test("pick: open by default, copy path, copy file (reveal is not exercised: it would raise Finder)", async () => {
    const p = join(dir, "report-alpha.txt");
    expect(await pick(p)).toEqual({ open: p });
    expect(await pick(p, "open")).toEqual({ open: p });
    expect(await pick(p, "copy")).toEqual({ copy: p });
    expect(await pick(p, "copy-file")).toEqual({ copy_files: [p] });
  });

  test("open with: pushes a level on the same palette with the file as args", async () => {
    const p = join(dir, "report-alpha.txt");
    expect(await pick(p, "open-with")).toEqual({ push: { extension: "files", palette: "files", args: { open_with: p } } });
  });

  test("open with level: the core's apps in its order, the default tagged, app icons, bundle id as keyword; the query narrows by name or id", async () => {
    const p = join(dir, "report-alpha.txt");
    const ctx = { args: { open_with: p } };
    const rows = await host.list("files", "files", "", ctx);
    expect(host.coreCalls.filter((c) => c.method === "apps.for_file").at(-1)!.params).toEqual({ path: p });
    expect(rows.map((r) => r.id)).toEqual(APPS.map((a) => a.path));
    expect(rows[0]).toEqual({ id: "/System/Applications/TextEdit.app", name: "TextEdit", subtitle: "/System/Applications", icon: { app: "/System/Applications/TextEdit.app" }, keywords: ["com.apple.TextEdit"], accessories: [{ tag: "Default" }], actions: [{ id: "open-with", title: "Open" }] });
    expect(rows[2]).toMatchObject({ name: "Notes", keywords: [], accessories: [] });
    expect((await host.list("files", "files", "kit", ctx)).map((r) => r.name)).toEqual(["kitty"]);
    expect((await host.list("files", "files", "apple", ctx)).map((r) => r.name)).toEqual(["TextEdit"]);
    expect(await host.list("files", "files", "zzz", ctx)).toEqual([]);
    const d = await host.detail("files", "files", "/Applications/kitty.app", ctx);
    expect(d.metadata).toEqual([{ label: "Application", value: "/Applications/kitty.app" }, { label: "Opens", value: p }]);
  });

  test("open with level: nothing registered is one inert hint", async () => {
    const rows = await host.list("files", "files", "", { args: { open_with: join(dir, "photo.png") } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "No app opens this file", subtitle: "Nothing is registered for photo.png", actions: [] });
  });

  test("open with level: Enter opens the file with that app and hides; a refusal keeps the level with a toast", async () => {
    const p = join(dir, "report-alpha.txt");
    const ctx = { args: { open_with: p } };
    expect(await host.pick("files", "files", "/Applications/kitty.app", "open-with", ctx)).toEqual({ hide: true });
    expect(opened).toEqual([{ path: p, app: "/Applications/kitty.app" }]);
    expect(await host.pick("files", "files", "/Applications/kitty.app", undefined, ctx)).toEqual({ hide: true });
    expect(await host.pick("files", "files", "/System/Applications/Notes.app", "open-with", ctx)).toEqual({ keep: true, toast: { title: "Could not open", message: "Notes refused", style: "failure" } });
  });

  test("trash of a missing file is a failure toast, palette kept", async () => {
    if (!(MAC ? Bun.which("osascript") : Bun.which("gio"))) return;
    const r = await pick(join(dir, "no-such-file.txt"), "trash");
    expect(r).toMatchObject({ keep: true, toast: { title: "Could not move to Trash", style: "failure" } });
  });
});
