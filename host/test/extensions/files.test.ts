// files: an input palette over a spawned search. A temp folder of named
// files is the world; `PAL_FILES_BACKEND=find` makes the extension walk it
// (Spotlight, fd and locate would not know a folder made a moment ago),
// and `PAL_RECENT_XBEL` names a recently-used.xbel written here for the
// recents (Spotlight's last-used dates would not know the folder either).
// The Finder selection is the canned `core/selection.files` (and the
// `front_app` state for the reason row). Skipped where `find` is missing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { BROWSE_CAP, filterEntries, isRoot, moreRow, parentOf, sortEntries, upRow, type Entry } from "../../../extensions/files/browse.ts";
import { contentArgv, parseQuery, snippet, snippetArgv } from "../../../extensions/files/content.ts";
import { parseMdls } from "../../../extensions/files/meta.ts";
import { archiveArgv, archiveName, copyForm, moveForm, renameForm } from "../../../sdk/src/files.ts";
import { parseMdfindRecent, parseXbel } from "../../../extensions/files/recent.ts";
import type { Ctx, Item } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";

const HAS_FIND = Bun.which("find") !== null;
const HAS_GREP = Bun.which("grep") !== null;
const MAC = process.platform === "darwin";
const FILE_ACTIONS = ["open", "reveal", ...(MAC ? ["quick-look"] : []), "open-with", "copy", "copy-file", "terminal", "rename", "move", "copy-to", "compress", "trash"];
/** A folder: Browse leads, the file actions follow. */
const FOLDER_ACTIONS = ["browse", ...FILE_ACTIONS];
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

describe("browse helpers", () => {
  const e = (name: string, dir: boolean, size: number, mtime: number): Entry => ({ path: `/x/${name}`, name, dir, size, mtime });
  const entries = [e("b.txt", false, 30, 2), e("Docs", true, 0, 5), e("a.txt", false, 10, 9), e(".hidden", false, 1, 1), e("apps", true, 0, 3), e("C.md", false, 20, 4)];
  test("sorts: name puts folders first then files, case-insensitive; date newest first mixed; size largest first with folders last", () => {
    expect(sortEntries(entries, "name").map((x) => x.name)).toEqual(["apps", "Docs", ".hidden", "a.txt", "b.txt", "C.md"]);
    expect(sortEntries(entries, "date").map((x) => x.name)).toEqual(["a.txt", "Docs", "C.md", "apps", "b.txt", ".hidden"]);
    expect(sortEntries(entries, "size").map((x) => x.name)).toEqual(["b.txt", "C.md", "a.txt", ".hidden", "apps", "Docs"]);
    expect(sortEntries(entries).map((x) => x.name)).toEqual(sortEntries(entries, "name").map((x) => x.name));
    expect(entries[0].name).toBe("b.txt"); // the input is not reordered
  });
  test("filter: a case-insensitive substring of the name; dot entries only with show_hidden or a query that starts with a dot", () => {
    expect(filterEntries(entries, "", false).map((x) => x.name)).toEqual(["b.txt", "Docs", "a.txt", "apps", "C.md"]);
    expect(filterEntries(entries, "", true).map((x) => x.name)).toContain(".hidden");
    expect(filterEntries(entries, "TXT", false).map((x) => x.name)).toEqual(["b.txt", "a.txt"]);
    expect(filterEntries(entries, ".hid", false).map((x) => x.name)).toEqual([".hidden"]);
    expect(filterEntries(entries, " doc ", false).map((x) => x.name)).toEqual(["Docs"]);
  });
  test("parent and root: a trailing slash does not count, / is its own parent and has no .. row", () => {
    expect(parentOf("/Users/x/Downloads")).toBe("/Users/x");
    expect(parentOf("/Users/x/Downloads/")).toBe("/Users/x");
    expect(parentOf("/Users")).toBe("/");
    expect(parentOf("/")).toBe("/");
    expect(isRoot("/")).toBe(true);
    expect(isRoot("//")).toBe(true);
    expect(isRoot("/Users")).toBe(false);
  });
  test("the .. row goes up on Enter, left and backspace; the hint row is inert and counts what was cut", () => {
    const home = process.env.HOME!;
    const up = upRow(`${home}/Downloads`, "F");
    expect(up).toEqual({ id: `up:${home}`, name: "..", subtitle: "~", icon: "F", keywords: ["up", "parent"], actions: [{ id: "up", title: "Go up", shortcut: ["left", "backspace"] }] });
    expect(moreRow(12, "F")).toMatchObject({ id: "hint:more", name: "12 more; type to filter", actions: [] });
    expect(BROWSE_CAP).toBe(500);
  });
});

describe("the file ops (the SDK's `files`) and meta", () => {
  test("archive commands: ditto on macOS with every source, zip from the folder on Linux, the stand-in when set", () => {
    expect(archiveArgv(["/a/x.txt", "/a/y"], "/a/x.zip", { PAL_FILES_ZIP: "/t/zip" })).toEqual({ argv: ["/t/zip", "/a/x.zip", "/a/x.txt", "/a/y"] });
    expect(archiveArgv(["/a/x.txt", "/a/y"], "/a/x.zip", {})).toEqual(MAC ? { argv: ["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", "/a/x.txt", "/a/y", "/a/x.zip"] } : { argv: ["zip", "-r", "-q", "/a/x.zip", "x.txt", "y"], cwd: "/a" });
  });
  test("the archive is named after the first path, its extension dropped, next to it", async () => {
    expect(await archiveName("/nonexistent-pal/report.final.txt")).toBe("/nonexistent-pal/report.final.zip");
    expect(await archiveName("/nonexistent-pal/Makefile")).toBe("/nonexistent-pal/Makefile.zip");
  });
  test("mdls -raw: numbers, an array of tags with the colour index cut, (null) as nothing", () => {
    expect(parseMdls('640\u0000480\u0000(\n    "Red\\n6",\n    "Work"\n)')).toEqual({ width: 640, height: 480, tags: ["Red", "Work"] });
    expect(parseMdls("(null)\u0000(null)\u0000(null)")).toEqual({ width: undefined, height: undefined, tags: [] });
    expect(parseMdls("")).toEqual({ width: undefined, height: undefined, tags: [] });
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
let tools: string;
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
  // Stand-ins: a "zip" that writes the archive's name and its sources, a "terminal" that logs the folder, an "mdls" answering a fixed raw record.
  tools = mkdtempSync(join(tmpdir(), "pal-files-tools-"));
  const tool = (name: string, body: string) => { const p = join(tools, name); writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return p; };
  process.env.PAL_FILES_ZIP = tool("zip", 'out="$1"; shift; printf "%s\\n" "$@" > "$out"');
  process.env.PAL_FILES_TERMINAL = tool("term", `printf "%s\\n" "$1" >> "${join(tools, "terminal.log")}"`);
  process.env.PAL_FILES_MDLS = tool("mdls", `case "$8" in *.png) printf '640\\000480\\000(\\n    "Red\\\\n6",\\n    "Work"\\n)';; *) printf '(null)\\000(null)\\000(null)';; esac`);
  process.env.PAL_FILES_BACKEND = "find";
  process.env.PAL_FILES_CONTENT = "grep";
  process.env.PAL_RECENT_XBEL = xbel;
  host = await Host.bundled({
    settings: { files: { settings: { folders: [dir] } } },
    core: {
      "apps.for_file": (p: { path: string }) => (p.path.endsWith(".png") ? [] : APPS),
      "apps.open_with": (p: { path: string; app: string }) => { if (p.app.endsWith("Notes.app")) throw new Error("Notes refused"); opened.push(p); return null; },
      "dialog.current": () => dialogUp,
      "selection.files": () => finder,
      "states.get": (p: { name?: string }) => (p.name === "front_app" ? front : null),
    },
  });
});
/** What the canned `core/dialog.current` answers: the open panel in front, or none. */
let dialogUp: { app: string; pid: number; kind: "open" | "save"; title?: string } | null = null;
/** What the canned `core/selection.files` answers, and the `front_app` state behind the reason row. */
let finder: string[] = [];
let front = "com.google.Chrome";
afterAll(() => { host?.kill(); if (dir) { rmSync(dir, { recursive: true, force: true }); rmSync(dir + "-ops", { recursive: true, force: true }); } if (tools) rmSync(tools, { recursive: true, force: true }); });

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
      { name: "files", title: "Files", live: false, input: true, icon: tile("slate", "\u{f024b}"), placeholder: "Search files by name", detail: "lazy", inline: true, match: "^\\s*(~|\\/)", fallback: "ask", fallbackTitle: "Search Files for “{query}”", multi: true , dialog: true },
      { name: "browse", title: "Browse Folder", live: false, input: true, icon: tile("slate", "\u{f024b}"), placeholder: "Filter this folder", filters: [{ id: "name", title: "Name" }, { id: "date", title: "Date" }, { id: "size", title: "Size" }], detail: "lazy", multi: true },
      { name: "selection", title: "Finder Selection", live: false, input: true, icon: tile("slate", "\u{f024b}"), placeholder: "Filter the selection", detail: "lazy", multi: true, suggest: true },
      { name: "recent", title: "Recent Files", live: true, input: false, icon: tile("slate", "\u{f024b}"), placeholder: "Search recent files", ttl: 60, detail: "lazy", tier: "primary", multi: true },
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
    expect(await host.pick("files", "recent", p, "open-with")).toEqual({ push: { extension: "files", palette: "recent", args: { open_with: p }, title: `Open ${basename(p)} with` } });
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
    expect(alpha.actions!.find((a) => a.id === "copy-file")).toEqual({ id: "copy-file", title: "Copy file", shortcut: "cmd+shift+c", multi: true });
    // Open, reveal, Quick Look, both copies, compress and the trash take marked rows; Open with is one file's.
    expect(alpha.actions!.filter((a) => a.multi).map((a) => a.id)).toEqual(["open", "reveal", ...(MAC ? ["quick-look"] : []), "copy", "copy-file", "compress", "trash"]);
    expect(alpha.actions!.filter((a) => ["terminal", "rename", "move", "copy-to", "compress"].includes(a.id)).map((a) => a.shortcut)).toEqual(["cmd+t", "cmd+shift+r", "cmd+m", "cmd+alt+c", "cmd+shift+z"]);
    // The bar's one field on every file row, a new name: only Rename reads it.
    expect(alpha.args).toEqual([{ id: "name", placeholder: "Rename to" }]);
    expect(alpha.actions!.filter((a) => a.args).map((a) => a.id)).toEqual(["rename"]);
    if (MAC) expect(alpha.actions!.find((a) => a.id === "quick-look")).toEqual({ id: "quick-look", title: "Quick Look", shortcut: "cmd+y", multi: true });
    expect(items.find((i) => i.name === "report-gamma.txt")!.subtitle).toBe(join(dir, "reports"));
    expect(items.find((i) => i.name === "reports")).toMatchObject({ icon: "󰉖", accessories: [{ date: expect.any(Number) }] });
    // A folder leads with Browse (Enter, and the right arrow from anywhere in the listing), Open second.
    expect(items.find((i) => i.name === "reports")!.actions!.map((a) => a.id)).toEqual(FOLDER_ACTIONS);
    expect(items.find((i) => i.name === "reports")!.actions![0]).toEqual({ id: "browse", title: "Browse", shortcut: "right" });
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
    // What mdls knows (the stand-in): the pixel size and Finder's tags, their colour index dropped; nothing for the text file.
    expect(img.metadata!.slice(4)).toEqual([{ label: "Dimensions", value: "640 x 480 px" }, { label: "Tags", tags: [{ text: "Red" }, { text: "Work" }] }]);
    expect(d.metadata!.length).toBe(4);
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

  test("pick with marked rows (ctx.ids): paths joined for copy, every file for copy file, the first as the open effect, the trash counts", async () => {
    const a = join(dir, "report-alpha.txt"), b = join(dir, "Report-Beta.md");
    expect(await host.pick("files", "files", a, "copy", { ids: [a, b] })).toEqual({ copy: `${a}\n${b}` });
    expect(await host.pick("files", "recent", a, "copy-file", { ids: [a, b] })).toEqual({ copy_files: [a, b] });
    // The second file goes through the opener here (not exercised: it would open it); the effect carries the first.
    expect(await host.pick("files", "files", a, "copy", { ids: [a] })).toEqual({ copy: a });
    if (!(MAC ? Bun.which("osascript") : Bun.which("gio"))) return;
    expect(await host.pick("files", "files", join(dir, "nope-1"), "trash", { ids: [join(dir, "nope-1"), join(dir, "nope-2")] })).toMatchObject({ keep: true, toast: { title: "Could not move to Trash", style: "failure" } });
  });

  test("open in terminal: the folder itself, or a file's folder, through the terminal stand-in; the panel hides", async () => {
    expect(await pick(join(dir, "reports"), "terminal")).toEqual({ hide: true });
    expect(await pick(join(dir, "reports", "report-gamma.txt"), "terminal")).toEqual({ hide: true });
    // The stand-in is detached; it lands within a moment.
    const log = () => Bun.file(join(tools, "terminal.log")).text().then((t) => t.trim().split("\n")).catch(() => [] as string[]);
    for (let i = 0; i < 40 && (await log()).length < 2; i++) await Bun.sleep(50);
    expect(await log()).toEqual([join(dir, "reports"), join(dir, "reports")]);
  });

  /** A folder of its own for the operations, so the browse listings of `dir` stay as the other tests expect. */
  const opsDir = () => { const d = join(dir, "..", basename(dir) + "-ops"); mkdirSync(d, { recursive: true }); return d; };

  test("rename: the bar's name moves the file (blank, or a pick without it, is the form with the name filled); a slash or a taken name is the form with the message; the same name is a no-op", async () => {
    const d = opsDir();
    const p = join(d, "to-rename.txt");
    writeFileSync(p, "x\n");
    writeFileSync(join(d, "notes.md"), "n\n");
    expect(await pick(p, "rename")).toEqual({ form: renameForm(p) });
    expect(await pick(p, "rename")).toMatchObject({ form: { title: "Rename", fields: [{ id: "name", default: "to-rename.txt" }], submit: { id: "rename-submit" } } });
    expect(await host.pick("files", "files", p, "rename", { values: { name: " " } })).toEqual({ form: renameForm(p) });
    expect(await host.pick("files", "files", p, "rename", { values: { name: "a/b" } })).toEqual({ form: renameForm(p, { name: "A file name, without a slash" }) });
    expect(await host.pick("files", "files", p, "rename-submit", { values: { name: "notes.md" } })).toMatchObject({ form: { errors: { name: expect.stringContaining("exists already") } } });
    expect(await host.pick("files", "files", p, "rename", { values: { name: "to-rename.txt" } })).toEqual({ keep: true });
    expect(await host.pick("files", "browse", p, "rename", { values: { name: "renamed.txt" } })).toEqual({ keep: true, toast: { title: "Renamed", message: "renamed.txt" } });
    expect(await Bun.file(join(d, "renamed.txt")).exists()).toBe(true);
    expect(await Bun.file(p).exists()).toBe(false);
  });

  test("move to and copy to a folder: the forms, the folder made when missing, a taken name refused", async () => {
    const d = opsDir();
    const p = join(d, "to-move.txt");
    writeFileSync(p, "m\n");
    expect(await pick(p, "move")).toEqual({ form: moveForm(p) });
    expect(await pick(p, "copy-to")).toEqual({ form: copyForm(p) });
    expect(await host.pick("files", "files", p, "move-submit", { values: { folder: "  " } })).toEqual({ form: moveForm(p, { folder: "A folder path" }) });
    const into = join(d, "moved", "deeper");
    expect(await host.pick("files", "recent", p, "copy-submit", { values: { folder: into } })).toEqual({ keep: true, toast: { title: "Copied", message: `to-move.txt to ${into}` } });
    expect(await Bun.file(join(into, "to-move.txt")).text()).toBe("m\n");
    expect(await host.pick("files", "files", p, "move-submit", { values: { folder: into } })).toMatchObject({ form: { errors: { folder: expect.stringContaining("exists already") } } });
    expect(await host.pick("files", "files", p, "move-submit", { values: { folder: join(d, "moved") } })).toEqual({ keep: true, toast: { title: "Moved", message: `to-move.txt to ${join(d, "moved")}` } });
    expect(await Bun.file(p).exists()).toBe(false);
    expect(await Bun.file(join(d, "moved", "to-move.txt")).exists()).toBe(true);
  });

  test("compress: one zip next to the file named after it (-2 when taken), the marked rows together into one named after the first", async () => {
    const d = opsDir();
    const a = join(d, "report-gamma.txt"), b = join(d, "notes.md");
    writeFileSync(a, "g\n");
    expect(await pick(a, "compress")).toEqual({ keep: true, toast: { title: "Compressed", message: join(d, "report-gamma.zip") } });
    expect((await Bun.file(join(d, "report-gamma.zip")).text()).trim()).toBe(a);
    expect(await host.pick("files", "files", a, "compress", { ids: [a, b] })).toEqual({ keep: true, toast: { title: "Compressed", message: join(d, "report-gamma-2.zip") } });
    expect((await Bun.file(join(d, "report-gamma-2.zip")).text()).trim().split("\n")).toEqual([a, b]);
  });

  test("dialog jump: with an open or save panel in front (core/dialog.current, asked per listing) every row leads with Use in dialog, whose pick is the dialog effect", async () => {
    dialogUp = { app: "TextEdit", pid: 7, kind: "open" };
    const p = join(dir, "report-alpha.txt");
    const row = (await list("report-alpha"))[0];
    expect(row.actions![0]).toEqual({ id: "dialog", title: "Use in TextEdit's open panel", shortcut: "cmd+g" });
    expect(row.actions!.slice(1).map((a) => a.id)).toEqual(FILE_ACTIONS);
    expect(await pick(p, "dialog")).toEqual({ dialog: p });
    expect((await host.list("files", "recent"))[0]?.actions?.[0]?.id ?? "dialog").toBe("dialog");
    dialogUp = null;
    expect((await list("report-alpha"))[0].actions!.map((a) => a.id)).toEqual(FILE_ACTIONS);
  });

  test("open with: pushes a level on the same palette with the file as args", async () => {
    const p = join(dir, "report-alpha.txt");
    expect(await pick(p, "open-with")).toEqual({ push: { extension: "files", palette: "files", args: { open_with: p }, title: `Open ${basename(p)} with` } });
  });

  test("open with level: the core's apps in its order, the default tagged, app icons, bundle id as keyword; the query narrows by name or id", async () => {
    const p = join(dir, "report-alpha.txt");
    const ctx = { args: { open_with: p } };
    const rows = await host.list("files", "files", "", ctx);
    expect(host.coreCalls.filter((c) => c.method === "apps.for_file").at(-1)!.params).toEqual({ path: p });
    expect(rows.map((r) => r.id)).toEqual(APPS.map((a) => a.path));
    expect(rows[0]).toEqual({ id: "/System/Applications/TextEdit.app", name: "TextEdit", subtitle: "/System/Applications", icon: { app: "/System/Applications/TextEdit.app" }, keywords: ["com.apple.TextEdit"], accessories: [{ tag: "default" }], actions: [{ id: "open-with", title: "Open" }] });
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

describe.skipIf(!HAS_FIND)("the Finder selection", () => {
  const sel = (q?: string, ctx?: Ctx) => host.list("files", "selection", q, ctx);
  const suggest = async () => (await host.request<{ extension: string; palette: string; items: Item[] }[]>("suggest")).find((s) => s.extension === "files" && s.palette === "selection")?.items;
  const ALL_ACTIONS = ["open", "reveal", ...(MAC ? ["quick-look"] : []), "copy", "copy-file", "compress", "trash"];

  test("nothing selected: no suggestion, and the palette says why (Finder in front or not; Linux has none)", async () => {
    expect(await suggest()).toBeUndefined();
    const why = (await sel())[0];
    if (!MAC) {
      expect(why).toMatchObject({ id: "hint:Not available on Linux", actions: [] });
      return;
    }
    expect(why).toMatchObject({ id: "hint:Finder is not in front", actions: [] });
    front = "com.apple.finder";
    expect((await sel())[0]).toMatchObject({ id: "hint:Nothing is selected in Finder", subtitle: "Select files in Finder, then open pal", actions: [] });
    front = "com.google.Chrome";
  });

  test.skipIf(!MAC)("one file selected: its row alone, with the file actions, in the palette and under Selected in Finder at the root; a gone path is skipped", async () => {
    const a = join(dir, "report-alpha.txt");
    finder = [a, join(dir, "gone.txt")];
    const rows = await sel();
    expect(rows.map((r) => r.id)).toEqual([a]);
    expect(rows[0]).toMatchObject({ name: "report-alpha.txt", subtitle: dir, accessories: [{ text: "29 B" }, { date: expect.any(Number) }] });
    expect(rows[0].actions!.map((x) => x.id)).toEqual(FILE_ACTIONS);
    expect(rows[0]).not.toHaveProperty("section");
    const now = (await suggest())!;
    expect(now.map((r) => r.id)).toEqual([a]);
    expect(now[0].section).toBe("Selected in Finder");
    expect(await host.pick("files", "selection", a, "copy")).toEqual({ copy: a });
    expect((await host.detail("files", "selection", a)).metadata![0]).toEqual({ label: "Path", value: a });
  });

  test.skipIf(!MAC)("several: an N items row leads (names, total size, the multi actions over every item), the files follow with thumbnails for pictures, a selected dot file included; the query filters the files", async () => {
    const a = join(dir, "report-alpha.txt"), png = join(dir, "photo.png"), dot = join(dir, ".report-hidden.txt"), folder = join(dir, "reports");
    finder = [a, png, dot, folder];
    const rows = await sel();
    expect(rows.map((r) => r.id)).toEqual(["selection:all", a, png, dot, folder]);
    expect(rows[0]).toMatchObject({ name: "4 items", subtitle: "report-alpha.txt, photo.png, .report-hidden.txt, reports", icon: "\u{f1032}", accessories: [{ text: "42 B" }] });
    expect(rows[0].actions!.map((x) => x.id)).toEqual(ALL_ACTIONS);
    expect(rows[0].actions!.map((x) => x.title)).toEqual(["Open all", "Reveal all in Finder", "Quick Look all", "Copy paths", "Copy files", "Compress together", "Move all to Trash"]);
    expect(rows[0].actions!.at(-1)).toMatchObject({ confirm: "Move 4 items to the Trash?", style: "destructive" });
    expect(rows[2].icon).toEqual({ image: `icon://localhost/file?path=${encodeURIComponent(png)}&size=24` });
    expect(rows[4].actions![0].id).toBe("browse");
    expect((await sel("report")).map((r) => r.id)).toEqual([a, dot, folder]);
    // The all row's actions run on the whole selection, whatever was marked.
    expect(await host.pick("files", "selection", "selection:all", "copy")).toEqual({ copy: finder.join("\n") });
    expect(await host.pick("files", "selection", "selection:all", "copy-file")).toEqual({ copy_files: finder });
    expect((await host.detail("files", "selection", "selection:all")).metadata!.slice(0, 3)).toEqual([{ label: "Items", value: "4" }, { label: "Size", value: "42 B" }, { label: "File", value: a }]);
  });

  test.skipIf(!MAC)("at the root: the N items row leads with Show in Finder Selection (a push of the palette), then at most four files under Selected in Finder", async () => {
    const paths = ["report-alpha.txt", "Report-Beta.md", "photo.png", "notes.md", "scan.pdf", "reports"].map((n) => join(dir, n));
    finder = paths;
    const now = (await suggest())!;
    expect(now.map((r) => r.id)).toEqual(["selection:all", ...paths.slice(0, 4)]);
    expect(now.every((r) => r.section === "Selected in Finder")).toBe(true);
    expect(now[0].actions!.map((x) => x.id)).toEqual(["show", ...ALL_ACTIONS]);
    expect(await host.pick("files", "selection", "selection:all", "show")).toEqual({ push: { extension: "files", palette: "selection" } });
    // Compress together: one zip named after the first, in its folder (an ops copy, so the search folder stays as it was).
    const d = join(dir, "..", basename(dir) + "-ops");
    mkdirSync(d, { recursive: true });
    const first = join(d, "selected.txt");
    writeFileSync(first, "s\n");
    finder = [first, join(dir, "photo.png")];
    expect(await host.pick("files", "selection", "selection:all", "compress")).toEqual({ keep: true, toast: { title: "Compressed", message: join(d, "selected.zip") } });
    expect((await Bun.file(join(d, "selected.zip")).text()).trim().split("\n")).toEqual(finder);
    finder = [];
    expect(await host.pick("files", "selection", "selection:all", "copy")).toEqual({ keep: true, toast: { title: "Nothing is selected in Finder", message: "Select files in Finder, then open pal", style: "failure" } });
  });

  test.skipIf(!MAC)("open with from the selection pushes the selection palette with the file as args, and that level lists the apps", async () => {
    const a = join(dir, "report-alpha.txt");
    finder = [a];
    expect(await host.pick("files", "selection", a, "open-with")).toEqual({ push: { extension: "files", palette: "selection", args: { open_with: a }, title: "Open report-alpha.txt with" } });
    expect((await sel("", { args: { open_with: a } })).map((r) => r.name)).toEqual(["TextEdit", "kitty", "Notes"]);
    finder = [];
  });
});

describe.skipIf(!HAS_FIND)("browsing folders", () => {
  const browse = (folder: string, query = "", filter?: string) => host.list("files", "browse", query, { args: { browse: folder }, ...(filter && { filter }) });
  const BROWSE_KEYS = ["browse", "up", "toggle-hidden"];

  test("the browse palette lists the folder: a .. row first (Enter, left, backspace go up), folders before files by name, hidden ones left out, every row with the hidden toggle", async () => {
    const rows = await browse(dir);
    expect(rows[0]).toMatchObject({ id: `up:${dirname(dir)}`, name: "..", subtitle: dirname(dir), actions: [{ id: "up", title: "Go up", shortcut: ["left", "backspace"] }, { id: "toggle-hidden", title: "Show hidden files", shortcut: "cmd+." }] });
    expect(rows.slice(1).map((r) => r.name)).toEqual(["Library", "node_modules", "reports", "gamma-notes.txt", "notes.md", "photo.png", "report-alpha.txt", "Report-Beta.md", "scan.pdf"]);
    const folder = rows.find((r) => r.name === "reports")!;
    expect(folder.actions!.map((a) => a.id)).toEqual([...FOLDER_ACTIONS, "toggle-hidden"]);
    expect(folder.subtitle).toBe(dir);
    expect(rows.find((r) => r.name === "notes.md")!.actions!.map((a) => a.id)).toEqual([...FILE_ACTIONS, "toggle-hidden"]);
    // A picture draws its own thumbnail through the app's icon scheme.
    expect(rows.find((r) => r.name === "photo.png")!.icon).toEqual({ image: `icon://localhost/file?path=${encodeURIComponent(join(dir, "photo.png"))}&size=24` });
    expect(rows.every((r) => r.actions!.some((a) => BROWSE_KEYS.includes(a.id)))).toBe(true);
  });

  test("the dropdown sorts: date newest first mixed, size largest first with folders last; the query filters by name", async () => {
    const now = Date.now();
    const { utimesSync } = await import("node:fs");
    // The fixture files were all written within a second: two moved apart so the order is not luck.
    utimesSync(join(dir, "notes.md"), new Date(now + 60_000), new Date(now + 60_000));
    utimesSync(join(dir, "reports"), new Date(now + 30_000), new Date(now + 30_000));
    const byDate = (await browse(dir, "", "date")).slice(1).map((r) => r.name);
    expect(byDate.slice(0, 2)).toEqual(["notes.md", "reports"]);
    const bySize = (await browse(dir, "", "size")).slice(1).map((r) => r.name);
    expect(bySize.slice(0, 2)).toEqual(["notes.md", "report-alpha.txt"]);
    expect(bySize.slice(-3)).toEqual(["Library", "node_modules", "reports"]);
    expect((await browse(dir, "REPORT")).map((r) => r.name)).toEqual(["..", "reports", "report-alpha.txt", "Report-Beta.md"]);
    expect((await browse(dir, ".rep")).map((r) => r.name)).toEqual(["..", ".report-hidden.txt"]);
  });

  test("at / there is no .. row; the parent's .. row leads to the grandparent", async () => {
    const root = await browse("/");
    expect(root[0].name).not.toBe("..");
    expect(root.every((r) => !r.id.startsWith("up:"))).toBe(true);
    expect((await browse(join(dir, "reports")))[0]).toMatchObject({ id: `up:${dir}`, subtitle: dir });
  });

  test("picks: Browse on a folder and Enter on the .. row push the browse palette with the folder as args and its path as the crumb", async () => {
    expect(await host.pick("files", "browse", join(dir, "reports"), "browse", { args: { browse: dir } })).toEqual({ push: { extension: "files", palette: "browse", args: { browse: join(dir, "reports") }, title: join(dir, "reports") } });
    expect(await host.pick("files", "browse", `up:${dir}`, "up", { args: { browse: join(dir, "reports") } })).toEqual({ push: { extension: "files", palette: "browse", args: { browse: dir }, title: dir } });
    // A search row's Browse (Enter on a folder in Files) is the same push.
    expect(await pick(join(dir, "reports"), "browse")).toEqual({ push: { extension: "files", palette: "browse", args: { browse: join(dir, "reports") }, title: join(dir, "reports") } });
    // Files keep their actions; the .. row's detail is the folder it leads to.
    expect(await host.pick("files", "browse", join(dir, "notes.md"), "copy", { args: { browse: dir } })).toEqual({ copy: join(dir, "notes.md") });
    expect((await host.detail("files", "browse", `up:${dir}`, { args: { browse: join(dir, "reports") } })).metadata![0]).toEqual({ label: "Path", value: dir });
  });

  test("cmd+. flips show_hidden through settings.set and lists again; the toggle's title follows", async () => {
    expect(await host.pick("files", "browse", join(dir, "notes.md"), "toggle-hidden", { args: { browse: dir } })).toEqual({ keep: true });
    expect(host.written.get("files")).toEqual({ show_hidden: true });
    const rows = await browse(dir);
    expect(rows.map((r) => r.name)).toContain(".report-hidden.txt");
    expect(rows[0].actions![1]).toMatchObject({ id: "toggle-hidden", title: "Hide hidden files" });
    expect(await host.pick("files", "browse", join(dir, "notes.md"), "toggle-hidden", { args: { browse: dir } })).toEqual({ keep: true });
    expect(host.written.get("files")).toEqual({});
    expect((await browse(dir)).map((r) => r.name)).not.toContain(".report-hidden.txt");
  });

  test("a path ending in / typed in Files lists that folder as browsed rows; without the slash it completes as before; the root's inline section stays a completion", async () => {
    const rows = await list(join(dir, "reports") + "/");
    expect(rows.map((r) => r.name)).toEqual(["..", "report-gamma.txt"]);
    expect(rows[0].actions![0].id).toBe("up");
    expect((await list(join(dir, "rep"))).map((i) => i.name)).toEqual(["report-alpha.txt", "Report-Beta.md", "reports"]);
    const inline = await host.request<{ extension: string; items: Item[] }[]>("inline", { query: join(dir, "reports") + "/" });
    expect(inline.find((s) => s.extension === "files")!.items.map((i) => i.name)).toEqual(["report-gamma.txt"]);
    // A folder row at the root pushes too: Browse is its first action.
    const folderInline = await host.request<{ extension: string; items: Item[] }[]>("inline", { query: join(dir, "repo") });
    expect(folderInline.find((s) => s.extension === "files")!.items.map((i) => [i.name, i.actions![0].id])).toEqual([["report-alpha.txt", "open"], ["Report-Beta.md", "open"], ["reports", "browse"]]);
  });

  test("a folder over the cap shows 500 rows and a hint counting the rest; typing narrows past it", async () => {
    const big = join(dir, "big");
    mkdirSync(big);
    for (let i = 0; i < 510; i++) writeFileSync(join(big, `f${String(i).padStart(3, "0")}.txt`), "");
    const rows = await browse(big);
    expect(rows).toHaveLength(1 + 500 + 1);
    expect(rows.at(-1)).toMatchObject({ id: "hint:more", name: "10 more; type to filter", actions: [] });
    expect((await browse(big, "f50")).map((r) => r.name)).toEqual(["..", "f500.txt", "f501.txt", "f502.txt", "f503.txt", "f504.txt", "f505.txt", "f506.txt", "f507.txt", "f508.txt", "f509.txt"]);
    rmSync(big, { recursive: true, force: true });
  });

  test("open with from a browsed row pushes the browse palette with the file as args, and that level lists the apps", async () => {
    const p = join(dir, "notes.md");
    expect(await host.pick("files", "browse", p, "open-with", { args: { browse: dir } })).toEqual({ push: { extension: "files", palette: "browse", args: { open_with: p }, title: "Open notes.md with" } });
    expect((await host.list("files", "browse", "", { args: { open_with: p } })).map((r) => r.name)).toEqual(APPS.map((a) => a.name));
  });
});
