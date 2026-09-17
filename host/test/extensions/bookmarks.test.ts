// bookmarks: the pure readers (sources.ts) over canned files, then the
// extension against a temp home (`PAL_BOOKMARKS_HOME`) holding a Chrome
// profile pair, a Safari plist (XML; plutil reads that too) and a Firefox
// places.sqlite made here, plus the JSON file named by the `file` setting.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeBookmarks, excludedFolder, firefoxBookmarks, markdownLink, parsePlist, safariBookmarks } from "../../../extensions/bookmarks/sources.ts";
import { Host } from "../harness.ts";

const MAC = process.platform === "darwin";

const CHROME = {
  roots: {
    bookmark_bar: { type: "folder", name: "Bookmarks bar", children: [
      { type: "url", name: "GitHub", url: "https://github.com" },
      { type: "folder", name: "Dev", children: [{ type: "url", name: "Bun", url: "https://bun.sh" }, { type: "url", name: "js", url: "javascript:void(0)" }] },
    ] },
    other: { type: "folder", name: "Other bookmarks", children: [{ type: "url", name: "Archive link", url: "https://old.example" }] },
    synced: { type: "folder", name: "Mobile bookmarks", children: [] },
    trash: { type: "folder", name: "Trash", children: [{ type: "url", name: "Gone", url: "https://gone.example" }] },
  },
};

const SAFARI = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Children</key>
	<array>
		<dict><key>Title</key><string>History</string><key>WebBookmarkType</key><string>WebBookmarkTypeProxy</string></dict>
		<dict>
			<key>Children</key>
			<array>
				<dict>
					<key>URIDictionary</key><dict><key>title</key><string>Apple &amp; Co</string></dict>
					<key>URLString</key><string>https://www.apple.com/</string>
					<key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
				</dict>
				<dict>
					<key>Children</key>
					<array>
						<dict>
							<key>URIDictionary</key><dict><key>title</key><string>GitHub in Safari</string></dict>
							<key>URLString</key><string>https://github.com</string>
							<key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
						</dict>
					</array>
					<key>Title</key><string>Work</string>
					<key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
				</dict>
			</array>
			<key>Title</key><string>BookmarksBar</string>
			<key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
		</dict>
		<dict>
			<key>Children</key>
			<array>
				<dict>
					<key>ReadingList</key><dict><key>DateAdded</key><date>2024-01-01T00:00:00Z</date></dict>
					<key>URLString</key><string>https://later.example/</string>
					<key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string>
				</dict>
			</array>
			<key>Title</key><string>com.apple.ReadingList</string>
			<key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
		</dict>
	</array>
	<key>WebBookmarkFileVersion</key><integer>1</integer>
	<key>WebBookmarkType</key><string>WebBookmarkTypeList</string>
</dict>
</plist>
`;

const FIREFOX = [
  { id: 1, parent: 0, type: 2, title: null, url: null },
  { id: 2, parent: 1, type: 2, title: "menu", url: null },
  { id: 3, parent: 1, type: 2, title: "toolbar", url: null },
  { id: 4, parent: 1, type: 2, title: "tags", url: null },
  { id: 5, parent: 1, type: 2, title: "unfiled", url: null },
  { id: 10, parent: 3, type: 1, title: "Mozilla", url: "https://mozilla.org" },
  { id: 11, parent: 3, type: 2, title: "Reading", url: null },
  { id: 12, parent: 11, type: 1, title: "Deep", url: "https://deep.example" },
  { id: 13, parent: 4, type: 2, title: "sometag", url: null },
  { id: 14, parent: 13, type: 1, title: null, url: "https://tagged.example" },
  { id: 15, parent: 5, type: 1, title: "Query", url: "place:sort=8" },
  { id: 16, parent: 2, type: 3, title: null, url: null },
];

describe("sources", () => {
  test("chrome: the three roots with their folder paths, javascript: and the trash skipped", () => {
    expect(chromeBookmarks(CHROME)).toEqual([
      { name: "GitHub", url: "https://github.com", folder: ["Bookmarks Bar"] },
      { name: "Bun", url: "https://bun.sh", folder: ["Bookmarks Bar", "Dev"] },
      { name: "Archive link", url: "https://old.example", folder: ["Other Bookmarks"] },
    ]);
    expect(chromeBookmarks(null)).toEqual([]);
    expect(chromeBookmarks({ roots: 1 })).toEqual([]);
  });

  test("plist: dicts, arrays, strings and scalars as text, entities decoded", () => {
    const p = parsePlist(`<?xml version="1.0"?><plist version="1.0"><dict><key>a &amp; b</key><string>x&lt;y</string><key>n</key><integer>3</integer><key>d</key><date>2024-01-01T00:00:00Z</date><key>t</key><true/><key>arr</key><array><string>1</string><real>2.5</real><data>
  AAEC
  </data></array><key>empty</key><dict/></dict></plist>`);
    expect(p).toEqual({ "a & b": "x<y", n: "3", d: "2024-01-01T00:00:00Z", t: "true", arr: ["1", "2.5", "AAEC"], empty: {} });
    expect(parsePlist("")).toBeUndefined();
  });

  test("safari: leaves under the bar and folders, proxies and the Reading List skipped, BookmarksBar shown as Favorites", () => {
    expect(safariBookmarks(parsePlist(SAFARI))).toEqual([
      { name: "Apple & Co", url: "https://www.apple.com/", folder: ["Favorites"] },
      { name: "GitHub in Safari", url: "https://github.com", folder: ["Favorites", "Work"] },
    ]);
    expect(safariBookmarks(undefined)).toEqual([]);
  });

  test("firefox: bookmarks with their folder path from the folder rows; tags, place: queries and separators skipped", () => {
    expect(firefoxBookmarks(FIREFOX)).toEqual([
      { name: "Mozilla", url: "https://mozilla.org", folder: ["Bookmarks Toolbar"] },
      { name: "Deep", url: "https://deep.example", folder: ["Bookmarks Toolbar", "Reading"] },
    ]);
  });

  test("excludedFolder by name or short path, case-insensitive; markdownLink escapes brackets", () => {
    expect(excludedFolder(["Bookmarks Bar", "Old", "Deep"], ["old"])).toBe(true);
    expect(excludedFolder(["Bookmarks Bar", "Old"], ["Bookmarks Bar/Old"])).toBe(true);
    expect(excludedFolder(["Bookmarks Bar", "Older"], ["Old"])).toBe(false);
    expect(excludedFolder([], ["Old"])).toBe(false);
    expect(markdownLink("a [b]", "https://x")).toBe("[a \\[b\\]](https://x)");
  });
});

const dir = mkdtempSync(join(tmpdir(), "pal-bm-"));
const file = join(dir, "bookmarks.json");
writeFileSync(file, JSON.stringify([
  { name: "Home Assistant", url: "http://ha.lan", keywords: ["ha", "home"], icon: "🏠" },
  { name: "GitHub", url: "https://github.com", subtitle: "code", icon: " " },
  { name: "Grafana", url: "http://grafana.lan/d/x" },
]));
const homeDir = join(dir, "home");
const chromeRoot = MAC ? join(homeDir, "Library", "Application Support", "Google", "Chrome") : join(homeDir, ".config", "google-chrome");
for (const p of ["Default", "Profile 1"]) mkdirSync(join(chromeRoot, p), { recursive: true });
writeFileSync(join(chromeRoot, "Default", "Bookmarks"), JSON.stringify(CHROME));
writeFileSync(join(chromeRoot, "Profile 1", "Bookmarks"), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: "url", name: "Work wiki", url: "https://wiki.example" }] } } }));
writeFileSync(join(chromeRoot, "Local State"), JSON.stringify({ profile: { info_cache: { "Profile 1": { name: "Work" } } } }));
mkdirSync(join(homeDir, "Library", "Safari"), { recursive: true });
writeFileSync(join(homeDir, "Library", "Safari", "Bookmarks.plist"), SAFARI);
const ffRoot = MAC ? join(homeDir, "Library", "Application Support", "Firefox", "Profiles") : join(homeDir, ".mozilla", "firefox");
mkdirSync(join(ffRoot, "abc123.default-release"), { recursive: true });
{
  const db = new Database(join(ffRoot, "abc123.default-release", "places.sqlite"));
  db.run("CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT)");
  db.run("CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, title TEXT)");
  for (const r of FIREFOX) {
    if (r.url) db.run("INSERT INTO moz_places (id, url) VALUES (?, ?)", [r.id, r.url]);
    db.run("INSERT INTO moz_bookmarks (id, type, fk, parent, title) VALUES (?, ?, ?, ?, ?)", [r.id, r.type, r.url ? r.id : null, r.parent, r.title]);
  }
  db.close();
}

let host: Host;
beforeAll(async () => {
  process.env.PAL_BOOKMARKS_HOME = homeDir;
  host = await Host.bundled({ settings: { bookmarks: { settings: { file } } } });
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

const list = () => host.list("bookmarks", "bookmarks");
const pick = (id: string, action?: string) => host.pick("bookmarks", "bookmarks", id, action);

describe("bookmarks", () => {
  test("the file's rows first: url as id, keywords, icon only when set, the palette's three actions (said once, not per row)", async () => {
    const items = await list();
    expect(items[0]).toEqual({
      id: "http://ha.lan", name: "Home Assistant", subtitle: "http://ha.lan", icon: "🏠", keywords: ["ha", "home"], url: "http://ha.lan", section: "bookmarks.json",
    });
    expect(host.loaded().find((l) => l.extension === "bookmarks")!.palettes[0].actions).toEqual([
      { id: "open", title: "Open in browser", multi: true }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }, { id: "copy-markdown", title: "Copy as markdown", shortcut: "cmd+shift+c" },
    ]);
    expect(items[1]).toMatchObject({ subtitle: "code", url: "https://github.com" });
    expect(items[1].icon).toBeUndefined();
    expect(items[1].section).toBe("bookmarks.json");
    expect(items[2].keywords).toBeUndefined();
  });

  test("browser rows follow, in the setting's order, one section per browser and profile, the folder path as accessory and keywords, deduplicated by url", async () => {
    const items = await list();
    const ids = items.map((i) => i.id);
    // Chrome's GitHub is the file's url: the file won; Safari's too.
    expect(ids.filter((i) => i === "https://github.com")).toHaveLength(1);
    const bun = items.find((i) => i.id === "https://bun.sh")!;
    expect(bun).toMatchObject({ name: "Bun", subtitle: "https://bun.sh", url: "https://bun.sh", keywords: ["Bookmarks Bar", "Dev"], accessories: [{ text: "Bookmarks Bar / Dev" }], section: "Chrome (Default)" });
    expect(bun.icon).toBeUndefined();
    expect(bun.actions!.map((a) => [a.id, a.title])).toEqual([["open", "Open in browser"], ["copy", "Copy link"], ["copy-markdown", "Copy as markdown"], ["open-in", "Open in Chrome"]]);
    expect(items.find((i) => i.id === "https://wiki.example")!.section).toBe("Chrome (Work)");
    expect(ids).not.toContain("https://gone.example");
    const sections = [...new Set(items.map((i) => i.section))];
    expect(sections).toEqual(["bookmarks.json", "Chrome (Default)", "Chrome (Work)", ...(MAC ? ["Safari"] : []), "Firefox"]);
    if (MAC) expect(items.find((i) => i.id === "https://www.apple.com/")).toMatchObject({ name: "Apple & Co", section: "Safari", accessories: [{ text: "Favorites" }] });
    expect(items.find((i) => i.id === "https://deep.example")).toMatchObject({ name: "Deep", section: "Firefox", accessories: [{ text: "Bookmarks Toolbar / Reading" }] });
    expect(items.find((i) => i.id === "https://deep.example")!.actions!.at(-1)!.title).toBe("Open in Firefox");
    expect(ids).not.toContain("https://tagged.example");
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("pick: open by default, copy the url, copy as markdown with the row's name", async () => {
    expect(await pick("http://ha.lan")).toEqual({ open: "http://ha.lan" });
    expect(await pick("http://ha.lan", "open")).toEqual({ open: "http://ha.lan" });
    expect(await pick("http://ha.lan", "copy")).toEqual({ copy: "http://ha.lan" });
    expect(await pick("http://ha.lan", "copy-markdown")).toEqual({ copy: "[Home Assistant](http://ha.lan)" });
    expect(await pick("https://bun.sh", "copy-markdown")).toEqual({ copy: "[Bun](https://bun.sh)" });
    // A file row has no browser of its own: open-in falls back to the opener.
    expect(await pick("http://ha.lan", "open-in")).toEqual({ open: "http://ha.lan" });
    // Marked rows: the first is the effect, the rest go through the opener here (a lone id opens nothing extra). Open is the one multi action.
    expect(await host.pick("bookmarks", "bookmarks", "http://ha.lan", "open", { ids: ["http://ha.lan"] })).toEqual({ open: "http://ha.lan" });
    expect(host.loaded().find((l) => l.extension === "bookmarks")!.palettes[0].actions!.filter((a) => a.multi).map((a) => a.id)).toEqual(["open"]);
  });

  test("browsers and exclude_folders settings: an empty browser list is the file alone; a folder name drops its rows", async () => {
    host.changeSettings("bookmarks", { settings: { file, browsers: [] } });
    expect((await list()).map((i) => i.id)).toEqual(["http://ha.lan", "https://github.com", "http://grafana.lan/d/x"]);
    host.changeSettings("bookmarks", { settings: { file, browsers: ["firefox", "chrome"], exclude_folders: ["Dev", "Other Bookmarks"] } });
    const items = await list();
    expect(items.map((i) => i.id)).not.toContain("https://bun.sh");
    expect(items.map((i) => i.id)).not.toContain("https://old.example");
    // Default's only other row is GitHub, which the file already has: no section of its own is left.
    expect([...new Set(items.map((i) => i.section))]).toEqual(["bookmarks.json", "Firefox", "Chrome (Work)"]);
    host.changeSettings("bookmarks", { settings: { file } });
  });

  test.skipIf(!MAC)("an unreadable Safari plist (what Full Disk Access missing looks like) is one inert hint row in the Safari section", async () => {
    const plist = join(homeDir, "Library", "Safari", "Bookmarks.plist");
    chmodSync(plist, 0o000);
    try {
      const items = await list();
      expect(items.find((i) => i.id === "https://www.apple.com/")).toBeUndefined();
      const hint = items.find((i) => i.id.startsWith("hint:"))!;
      expect(hint).toMatchObject({ name: "Safari bookmarks need Full Disk Access", section: "Safari", actions: [] });
    } finally { chmodSync(plist, 0o644); }
    expect((await list()).find((i) => i.id === "https://www.apple.com/")).toBeDefined();
  });

  test("the file is read on every list, so an edit shows without a reload", async () => {
    writeFileSync(file, JSON.stringify([{ name: "Only", url: "http://only" }]));
    expect((await list()).filter((i) => i.section === "bookmarks.json").map((i) => i.name)).toEqual(["Only"]);
  });

  test("a missing file is no rows, the browsers still list; a broken one is a hint row naming the file", async () => {
    host.changeSettings("bookmarks", { settings: { file: join(dir, "nope.json") } });
    const items = await list();
    expect(items.every((i) => i.section && i.section !== "nope.json")).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    writeFileSync(join(dir, "broken.json"), "{ not json");
    host.changeSettings("bookmarks", { settings: { file: join(dir, "broken.json") } });
    const hint = (await list())[0];
    expect(hint).toMatchObject({ id: "hint:Could not read broken.json", name: "Could not read broken.json", actions: [] });
    expect(hint.subtitle).toMatch(/fix the file/);
    expect(hint.icon).toBeTruthy();
    expect((await host.hello()).pid).toBe(host.pid);
  });
});
