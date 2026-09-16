// downloads: the pure half first (scan.ts: kinds, the in-progress
// suffixes, the day sections, sizes and rates, the browsers' folders off
// their preference files, Safari's plist), then the palette over the
// wire on a temp folder the test fills (files dated across the sections,
// a Chrome partial that grows between listings, a Safari bundle, a PNG
// for the thumbnail), with a stand-in `open` on PATH and a stand-in
// trash (`PAL_DOWNLOADS_TRASH`) that moves into a folder of its own, so
// nothing touches the real Downloads or the real Trash.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserDirsFrom, finalName, inProgress, kindOf, olderThan, rate, safariProgress, sectionOf, size, SUGGEST_MS } from "../../../extensions/downloads/scan.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Form, Item } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";

const MAC = process.platform === "darwin";

describe("scan.ts", () => {
  test("kindOf by extension, a folder unless it is an .app; the in-progress suffixes and the final name", () => {
    expect(kindOf("photo.HEIC", false)).toBe("image");
    expect(kindOf("clip.mov", false)).toBe("video");
    expect(kindOf("report.pdf", false)).toBe("document");
    expect(kindOf("src.tar.gz", false)).toBe("archive");
    expect(kindOf("index.ts", false)).toBe("code");
    expect(kindOf("Tool.app", true)).toBe("app");
    expect(kindOf("disk.dmg", false)).toBe("disk");
    expect(kindOf("stuff", true)).toBe("folder");
    expect(kindOf("README", false)).toBe("file");
    expect(inProgress("report.pdf.crdownload")).toBe(true);
    expect(inProgress("a.zip.part")).toBe(true);
    expect(inProgress("Big.download")).toBe(true);
    expect(inProgress("report.pdf")).toBe(false);
    expect(finalName("report.pdf.crdownload")).toBe("report.pdf");
    expect(finalName("Unconfirmed 123.crdownload")).toBe("Unconfirmed 123");
  });

  test("sectionOf by local day; sizes and a rate", () => {
    const now = new Date(2026, 8, 17, 14, 0).getTime();
    expect(sectionOf(new Date(2026, 8, 17, 1, 0).getTime(), now)).toBe("Today");
    expect(sectionOf(new Date(2026, 8, 16, 23, 59).getTime(), now)).toBe("Yesterday");
    expect(sectionOf(new Date(2026, 8, 12).getTime(), now)).toBe("This week");
    expect(sectionOf(new Date(2026, 8, 10).getTime(), now)).toBe("Older");
    expect(size(0)).toBe("0 B");
    expect(size(1536)).toBe("1.5 KB");
    expect(size(75 * 1024)).toBe("75 KB");
    expect(size(25.3 * 1024 ** 2)).toBe("25.3 MB");
    expect(size(1.15 * 1024 ** 3)).toBe("1.15 GB");
    expect(rate(1000, 3_000_000, 1000)).toBe("2.9 MB/s");
    expect(rate(5, 5, 1000)).toBeUndefined();
    expect(rate(5, 9, 0)).toBeUndefined();
    expect(olderThan([{ mtime: now - 31 * 86400e3 }, { mtime: now - 29 * 86400e3 }], 30, now)).toEqual([{ mtime: now - 31 * 86400e3 }]);
  });

  test("browserDirsFrom: Chrome's default_directory and Firefox's dir when folderList is 2, once each; Safari's plist progress", () => {
    const chrome = JSON.stringify({ download: { default_directory: "/Users/x/Web" } });
    const ff = `user_pref("browser.download.dir", "/Users/x/Fire\\"fox");\nuser_pref("browser.download.folderList", 2);\n`;
    const ffDefault = `user_pref("browser.download.dir", "/Users/x/Unused");\nuser_pref("browser.download.folderList", 1);\n`;
    expect(browserDirsFrom({ chromePrefs: [chrome, chrome, "{}", "not json"], firefoxPrefs: [ff, ffDefault] })).toEqual(["/Users/x/Web", '/Users/x/Fire"fox']);
    expect(safariProgress(`<plist><dict><key>DownloadEntryProgressBytesSoFar</key><integer>1200</integer><key>DownloadEntryProgressTotalToLoad</key><integer>4800</integer></dict></plist>`)).toEqual({ done: 1200, total: 4800 });
    expect(safariProgress("<plist/>")).toBeUndefined();
  });
});

// ---- the palette over the wire ------------------------------------------------------

// bun test runs in UTC; the host it spawns must agree for the day sections below (calc.test.ts does the same).
process.env.TZ = "UTC";
const root = mkdtempSync(join(tmpdir(), "pal-downloads-"));
const folder = join(root, "Downloads");
const bin = join(root, "bin");
const trashDir = join(root, "trash");
const cache = join(root, "cache");
const openLog = join(root, "open.log");
mkdirSync(folder); mkdirSync(bin); mkdirSync(trashDir);
writeFileSync(join(bin, "open"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${openLog}"\n`);
writeFileSync(join(bin, "trash"), `#!/bin/sh\nmv -- "$1" "${trashDir}/" || exit 1\n`);
chmodSync(join(bin, "open"), 0o755); chmodSync(join(bin, "trash"), 0o755);
// A 1 by 1 red PNG, for the thumbnail.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const DAY = 86400e3;
const now = Date.now();
const at = (path: string, t: number) => utimesSync(path, new Date(t), new Date(t));
const file = (name: string, bytes: number | Buffer, age: number) => { const p = join(folder, name); writeFileSync(p, typeof bytes === "number" ? Buffer.alloc(bytes, 120) : bytes); at(p, now - age); return p; };

const report = file("report.pdf", 2048, 3 * DAY);
const startOfToday = new Date(); startOfToday.setUTCHours(0, 0, 0, 0);
const photo = file("photo.png", PNG, Math.min(2 * 3600e3, now - startOfToday.getTime() - 60e3));
const notes = file("notes.txt", 100, 1.5 * DAY);
const old = file("old-build.zip", 4096, 40 * DAY);
const older = file("ancient.dmg", 8192, 90 * DAY);
const partial = file("big.iso.crdownload", 1000, 60e3);
const safari = join(folder, "Movie.mp4.download");
mkdirSync(safari);
writeFileSync(join(safari, "Info.plist"), `<?xml version="1.0"?><plist version="1.0"><dict><key>DownloadEntryProgressBytesSoFar</key><integer>3000000</integer><key>DownloadEntryProgressTotalToLoad</key><integer>12000000</integer></dict></plist>`);
at(safari, now - 30e3);
writeFileSync(join(folder, ".DS_Store"), "x");
const yesterday = new Date(); yesterday.setUTCDate(yesterday.getUTCDate() - 1); yesterday.setUTCHours(12, 0, 0, 0);
at(notes, yesterday.getTime());

let host: Host;
const oldPath = process.env.PATH;
beforeAll(async () => {
  process.env.PATH = `${bin}:${oldPath}`;
  process.env.PAL_DOWNLOADS_TRASH = join(bin, "trash");
  process.env.PAL_DOWNLOADS_CACHE = cache;
  host = await Host.bundled({ settings: { downloads: { settings: { folder, browser_folders: false } } } });
});
afterAll(() => { host.kill(); process.env.PATH = oldPath; delete process.env.PAL_DOWNLOADS_TRASH; delete process.env.PAL_DOWNLOADS_CACHE; rmSync(root, { recursive: true, force: true }); });

const list = () => host.list("downloads", "downloads");
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("downloads", "downloads", id, action, ctx);
const opened = () => (existsSync(openLog) ? readFileSync(openLog, "utf8").trim().split("\n") : []);
const byName = (items: Item[], name: string) => items.find((i) => i.name === name)!;
const FILE_ACTIONS = ["open", "reveal", ...(MAC ? ["quick-look"] : []), "copy-file", "copy-path", "move", "rename", "trash"];

describe("downloads", () => {
  test("meta: a live, primary, multi palette on the cyan download tile, with suggest and a lazy detail; the manifest and the code agree", () => {
    const l = host.loaded().find((l) => l.extension === "downloads")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ name: "downloads", title: "Downloads", live: true, input: false, multi: true, suggest: true, tier: "primary", detail: "lazy", icon: tile("cyan", "\u{f01da}") });
  });

  test("the listing: downloads in progress first, then newest first under Today, Yesterday, This week, Older; size and date on the right; the dotfile skipped; the Clear and Open rows last", async () => {
    const items = await list();
    expect(items.map((i) => [i.name, i.section])).toEqual([
      ["Movie.mp4", "Downloading"], ["big.iso", "Downloading"],
      ["photo.png", "Today"], ["notes.txt", "Yesterday"], ["report.pdf", "This week"], ["old-build.zip", "Older"], ["ancient.dmg", "Older"],
      ["Clear older than 30 days", "Folder"], ["Open Downloads", "Folder"],
    ]);
    const r = byName(items, "report.pdf");
    expect(r).toMatchObject({ id: report, subtitle: "Document", keywords: ["report.pdf"], accessories: [{ text: "2.0 KB" }, { date: expect.any(Number) }] });
    expect(r.actions!.map((a) => a.id)).toEqual(FILE_ACTIONS);
    expect(r.actions!.filter((a) => a.multi).map((a) => a.id)).toEqual(["open", "reveal", "copy-file", "copy-path", "trash"]);
    expect(r.actions!.at(-1)).toMatchObject({ id: "trash", shortcut: "cmd+d", style: "destructive", confirm: expect.any(String) });
    expect(byName(items, "ancient.dmg").subtitle).toBe("Disk");
    expect(byName(items, "notes.txt").subtitle).toBe("Document");
    expect(byName(items, "big.iso").subtitle).toBe("Disk");
    expect(items.every((i) => i.icon)).toBe(true);
    expect(items.at(-2)).toMatchObject({ id: "clear-old", subtitle: "2 items, 12 KB, to the Trash" });
    expect(items.at(-2)!.actions![0]).toMatchObject({ confirm: "Move 2 items older than 30 days to the Trash?", style: "destructive" });
    expect(items.at(-1)).toMatchObject({ id: "open-folder", subtitle: folder.replace(process.env.HOME!, "~") });
  });

  test("a download in progress: the name without the suffix, a blue tag, the size, then the rate once it has grown between two listings; Safari's bundle reads its percentage; reveal and copy path only", async () => {
    let items = await list();
    const chrome = byName(items, "big.iso");
    expect(chrome).toMatchObject({ id: partial, subtitle: "Disk", accessories: [{ tag: "downloading", color: "blue" }, { text: "1000 B" }] });
    expect(chrome.actions!.map((a) => a.id)).toEqual(["reveal", "copy-path"]);
    expect(byName(items, "Movie.mp4").accessories![1]).toEqual({ text: "25% · 2.9 MB of 11.4 MB" });
    writeFileSync(partial, Buffer.alloc(501_000, 120));
    await Bun.sleep(120);
    items = await list();
    const text = (byName(items, "big.iso").accessories![1] as { text: string }).text;
    expect(text).toMatch(/^489 KB · [\d.]+ (MB|KB)\/s$/);
  });

  test("an image gets a 64 px thumbnail as its icon, from the cache the second time; a document its glyph", async () => {
    if (!MAC && !Bun.which("magick") && !Bun.which("convert")) return;
    const items = await list();
    const icon = byName(items, "photo.png").icon as { image: string };
    expect(icon.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(readdirSync(cache).filter((f) => f.endsWith(".jpg"))).toHaveLength(1);
    expect(typeof byName(items, "report.pdf").icon === "string" || (byName(items, "report.pdf").icon as { image?: string }).image).toBeTruthy();
    expect(typeof byName(items, "notes.txt").icon).toBe("string");
  });

  test("picks: open (the rest through the opener on a multi pick), reveal, copy file, copy path, the folder row", async () => {
    expect(await pick(report)).toEqual({ open: report });
    expect(await pick(report, "open", { ids: [report, notes] })).toEqual({ open: report });
    await host.until(() => opened().some((l) => l === notes), 2000, "the second file opened");
    expect(await pick(report, "reveal", { ids: [report, notes] })).toEqual({ hide: true });
    if (MAC) await host.until(() => opened().some((l) => l === `-R ${report} ${notes}`), 2000, "revealed");
    expect(await pick(report, "copy-file", { ids: [report, notes] })).toEqual({ copy_files: [report, notes] });
    expect(await pick(report, "copy-path")).toEqual({ copy: report });
    expect(await pick(report, "copy-path", { ids: [report, notes] })).toEqual({ copy: `${report}\n${notes}` });
    expect(await pick("open-folder")).toEqual({ open: folder });
  });

  test("rename: a form with the name; the submit renames in place, a name in use or with a slash shows the form again with the error", async () => {
    const f = (await pick(notes, "rename")).form as Form;
    expect(f).toMatchObject({ id: notes, title: "Rename", submit: { id: "rename-submit", title: "Rename" } });
    expect(f.fields[0]).toMatchObject({ kind: "text", id: "name", default: "notes.txt", required: true });
    expect(await pick(notes, "rename-submit", { values: { name: "report.pdf" } })).toMatchObject({ form: { errors: { name: expect.stringContaining("exists already") } } });
    expect(await pick(notes, "rename-submit", { values: { name: "a/b" } })).toMatchObject({ form: { errors: { name: "A file name, without a slash" } } });
    expect(await pick(notes, "rename-submit", { values: { name: "notes-renamed.txt" } })).toEqual({ keep: true, toast: { title: "Renamed", message: "notes-renamed.txt" } });
    expect(existsSync(join(folder, "notes-renamed.txt"))).toBe(true);
    expect(existsSync(notes)).toBe(false);
  });

  test("move: a form with the target folder; the submit creates it and moves the file; a blank folder is an error", async () => {
    const renamed = join(folder, "notes-renamed.txt");
    const f = (await pick(renamed, "move")).form as Form;
    expect(f).toMatchObject({ id: renamed, title: "Move notes-renamed.txt", submit: { id: "move-submit", title: "Move" } });
    expect(f.fields[0]).toMatchObject({ kind: "text", id: "folder", default: "~/Documents", required: true });
    expect(await pick(renamed, "move-submit", { values: { folder: "  " } })).toMatchObject({ form: { errors: { folder: "A folder path" } } });
    const target = join(root, "Archive", "notes");
    expect(await pick(renamed, "move-submit", { values: { folder: target } })).toEqual({ keep: true, toast: { title: "Moved", message: `notes-renamed.txt to ${target}` } });
    expect(existsSync(join(target, "notes-renamed.txt"))).toBe(true);
    expect(existsSync(renamed)).toBe(false);
  });

  test("trash: one file, then marked rows together; a missing file is a failure toast; Clear older than 30 days trashes the old ones", async () => {
    expect(await pick(photo, "trash")).toEqual({ keep: true, toast: { title: "Moved to Trash", message: "photo.png" } });
    expect(existsSync(photo)).toBe(false);
    expect(existsSync(join(trashDir, "photo.png"))).toBe(true);
    expect(await pick(report, "trash", { ids: [report, join(folder, "nope")] })).toMatchObject({ keep: true, toast: { title: "Moved 1 to the Trash, then failed", style: "failure" } });
    expect(existsSync(report)).toBe(false);
    expect(await pick("clear-old", "clear-old")).toEqual({ keep: true, toast: { title: "Moved to Trash", message: "2 items older than 30 days" } });
    expect(existsSync(old)).toBe(false);
    expect(existsSync(older)).toBe(false);
    expect(readdirSync(trashDir).sort()).toEqual(["ancient.dmg", "old-build.zip", "photo.png", "report.pdf"]);
    const items = await list();
    expect(items.map((i) => i.id)).toEqual([partial, safari, "open-folder"]);
  });

  test("detail: name, folder, size, kind, modified (and on macOS the source url from Spotlight when there is one)", async () => {
    const fresh = file("fresh.csv", 300, 1000);
    const d = await host.detail("downloads", "downloads", fresh);
    expect(d.metadata!.map((m) => m.label)).toEqual(["Name", "Folder", "Size", "Kind", "Modified"]);
    expect(d.metadata![2].value).toBe("300 B");
    expect(d.metadata![3].value).toBe("Document");
    expect((await host.detail("downloads", "downloads", join(folder, "gone"))).markdown).toBe("This file is gone.");
  });

  test("suggest: the newest finished download of the last ten minutes as a Now row; nothing older, nothing in progress", async () => {
    type Suggested = { extension: string; palette: string; items: Item[] }[];
    const ours = (r: Suggested) => r.filter((s) => s.extension === "downloads").flatMap((s) => s.items);
    const rows = ours(await host.request<Suggested>("suggest"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Downloaded: fresh.csv", accessories: [{ text: "300 B" }, { date: expect.any(Number) }] });
    expect(rows[0].section).toBeUndefined();
    at(join(folder, "fresh.csv"), now - SUGGEST_MS - 60e3);
    expect(ours(await host.request<Suggested>("suggest"))).toEqual([]);
  });

  test("an empty folder is one hint row before the Open Downloads row", async () => {
    const empty = join(root, "Empty");
    mkdirSync(empty);
    host.changeSettings("downloads", { settings: { folder: empty, browser_folders: false } });
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["hint:Nothing downloaded", "open-folder"]);
    expect(items[0]).toMatchObject({ subtitle: `${empty.replace(process.env.HOME!, "~")} is empty`, actions: [] });
  });
});
