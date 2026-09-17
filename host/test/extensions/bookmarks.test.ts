// bookmarks: the pure readers (sources.ts) over canned files, then the
// extension against a temp home (`PAL_BOOKMARKS_HOME`) holding a Chrome
// profile pair, a Safari plist (XML; plutil reads that too) and a Firefox
// places.sqlite made here, plus the JSON file named by the `file` setting;
// then the history palette over a Chrome `History` and Firefox visits in
// the same profiles.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromeTime, firefoxTime, like, merge, visits } from "../../../extensions/bookmarks/history.ts";
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

/** 2026-09-16 10:30:00 UTC as unix ms; `chromeUs` spells it in Chrome's 1601 microseconds. */
const T = 1_789_554_600_000;
const chromeUs = (ms: number) => (ms + 11_644_473_600_000) * 1000;

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

  test("history: Chrome's 1601 microseconds and Firefox's 1970 microseconds as unix ms, unvisited rows dropped, LIKE escaped, the merge newest first once per url", () => {
    // 2026-09-16 10:30:00 UTC.
    expect(chromeTime(13434028200000000)).toBe(T);
    expect(chromeTime(0)).toBe(0);
    expect(chromeTime(null)).toBe(0);
    expect(firefoxTime(T * 1000)).toBe(T);
    expect(visits([{ url: "https://a", title: " A ", last: 2_000_000, visits: 3 }, { url: "https://b", title: null, last: 1_000_000, visits: null }, { url: "https://never", title: "x", last: 0, visits: 0 }, { url: "", title: "x", last: 5, visits: 1 }], firefoxTime)).toEqual([
      { url: "https://a", title: "A", at: 2000, visits: 3 },
      { url: "https://b", title: "https://b", at: 1000, visits: 0 },
    ]);
    expect(like("50%_x\\y")).toBe("%50\\%\\_x\\\\y%");
    const merged = merge([
      { section: "Chrome", app: "Google Chrome", rows: [{ url: "https://a", title: "A", at: 10, visits: 1 }, { url: "https://c", title: "C", at: 5, visits: 1 }] },
      { section: "Firefox", app: "Firefox", rows: [{ url: "https://a", title: "A again", at: 20, visits: 1 }, { url: "https://b", title: "B", at: 7, visits: 1 }] },
    ]);
    expect(merged.map((v) => [v.url, v.section])).toEqual([["https://a", "Firefox"], ["https://b", "Firefox"], ["https://c", "Chrome"]]);
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
  // Chrome's History in the Default profile alone (Work has none): three visited pages and a never-visited one.
  const db = new Database(join(chromeRoot, "Default", "History"));
  db.run("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0)");
  const rows: [string, string | null, number, number, number][] = [
    ["https://bun.sh/docs", "Bun docs", 4, chromeUs(T - 60_000), 0],
    ["https://news.ycombinator.com/", "Hacker News", 30, chromeUs(T - 3_600_000), 0],
    ["https://example.com/untitled", null, 1, chromeUs(T - 7_200_000), 0],
    ["https://example.com/never", "Never", 0, 0, 0],
    ["https://example.com/hidden", "Hidden redirect", 1, chromeUs(T), 1],
  ];
  for (const r of rows) db.run("INSERT INTO urls (url, title, visit_count, last_visit_time, hidden) VALUES (?, ?, ?, ?, ?)", r);
  db.close();
  const work = new Database(join(chromeRoot, "Profile 1", "History"));
  work.run("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0)");
  work.run("INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES ('https://wiki.example/onboarding', 'Onboarding', 2, ?)", [chromeUs(T - 1_800_000)]);
  work.close();
}
{
  const db = new Database(join(ffRoot, "abc123.default-release", "places.sqlite"));
  db.run("CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER DEFAULT 0, last_visit_date INTEGER, hidden INTEGER DEFAULT 0)");
  db.run("CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, title TEXT)");
  for (const r of FIREFOX) {
    if (r.url) db.run("INSERT INTO moz_places (id, url) VALUES (?, ?)", [r.id, r.url]);
    db.run("INSERT INTO moz_bookmarks (id, type, fk, parent, title) VALUES (?, ?, ?, ?, ?)", [r.id, r.type, r.url ? r.id : null, r.parent, r.title]);
  }
  // Visits: Bun's docs here too (older than Chrome's), one of Firefox's own.
  db.run("INSERT INTO moz_places (id, url, title, visit_count, last_visit_date) VALUES (100, 'https://bun.sh/docs', 'Bun documentation', 2, ?)", [(T - 120_000) * 1000]);
  db.run("INSERT INTO moz_places (id, url, title, visit_count, last_visit_date) VALUES (101, 'https://developer.mozilla.org/', 'MDN', 9, ?)", [(T - 600_000) * 1000]);
  db.close();
}

let host: Host;
beforeAll(async () => {
  process.env.PAL_BOOKMARKS_HOME = homeDir;
  process.env.PAL_BOOKMARKS_CACHE = join(dir, "cache");
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

describe("history", () => {
  const history = (q?: string) => host.list("bookmarks", "history", q);
  const pick = (id: string, action?: string) => host.pick("bookmarks", "history", id, action);

  test("meta: an input palette next to the bookmarks", () => {
    const l = host.loaded().find((l) => l.extension === "bookmarks")!;
    expect(l.palettes.map((p) => [p.name, p.input])).toEqual([["bookmarks", false], ["history", true]]);
    expect(l.palettes[1]).toMatchObject({ title: "Browser History", placeholder: "Search browser history" });
  });

  test("the empty query lists every browser's visits newest first, a url once, the title (or the url), the visit as a date, the browser as the section", async () => {
    host.changeSettings("bookmarks", { settings: { file } });
    const items = await history();
    expect(items.map((i) => [i.id, i.section])).toEqual([
      ["https://bun.sh/docs", "Chrome (Default)"],
      ["https://developer.mozilla.org/", "Firefox"],
      ["https://wiki.example/onboarding", "Chrome (Work)"],
      ["https://news.ycombinator.com/", "Chrome (Default)"],
      ["https://example.com/untitled", "Chrome (Default)"],
    ]);
    expect(items[0]).toEqual({
      id: "https://bun.sh/docs", name: "Bun docs", subtitle: "https://bun.sh/docs", url: "https://bun.sh/docs", accessories: [{ date: T - 60_000 }], section: "Chrome (Default)",
      actions: [{ id: "open-in", title: "Open in Chrome" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }, { id: "open", title: "Open in default browser", shortcut: "cmd+o" }],
    });
    expect(items[1].actions![0].title).toBe("Open in Firefox");
    expect(items[4].name).toBe("https://example.com/untitled");
  });

  test("a query matches the title or the address, case-insensitive; the browsers setting narrows the sources; none is one hint row", async () => {
    expect((await history("MDN")).map((i) => i.id)).toEqual(["https://developer.mozilla.org/"]);
    expect((await history("bun.sh")).map((i) => i.id)).toEqual(["https://bun.sh/docs"]);
    expect((await history("%")).map((i) => i.id)).toEqual([]);
    host.changeSettings("bookmarks", { settings: { file, browsers: ["firefox"] } });
    expect((await history()).map((i) => i.section)).toEqual(["Firefox", "Firefox"]);
    host.changeSettings("bookmarks", { settings: { file, browsers: ["safari"] } });
    const [hint] = await history();
    expect(hint).toMatchObject({ id: "hint:none", name: "No browser history found", actions: [] });
    host.changeSettings("bookmarks", { settings: { file } });
  });

  test("pick: Enter opens in the browser it came from (the opener here, the panel hides), copy, and the default browser through the effect", async () => {
    await history();
    expect(await pick("https://bun.sh/docs", "copy")).toEqual({ copy: "https://bun.sh/docs" });
    expect(await pick("https://bun.sh/docs", "open")).toEqual({ open: "https://bun.sh/docs" });
    // A url the last listing did not have (a stale row) falls back to the default browser.
    expect(await pick("https://nowhere.example")).toEqual({ open: "https://nowhere.example" });
  });

  test("the copy under the cache follows the file: a visit written to Chrome's History shows once the copy is older than the minimum", async () => {
    const cached = readdirSync(join(dir, "cache")).filter((f) => f.endsWith("-History"));
    expect(cached).toHaveLength(2);
    const db = new Database(join(chromeRoot, "Default", "History"));
    db.run("INSERT INTO urls (url, title, visit_count, last_visit_time) VALUES ('https://fresh.example/', 'Fresh', 1, ?)", [chromeUs(T + 1000)]);
    db.close();
    // Within the 30 s window the copy stands.
    expect((await history("fresh")).map((i) => i.id)).toEqual([]);
    // Past it (a host with no minimum) the moved mtime brings a fresh copy.
    process.env.PAL_BOOKMARKS_COPY_MS = "0";
    const fresh = await Host.bundled({ settings: { bookmarks: { settings: { file } } } });
    try { expect((await fresh.list("bookmarks", "history", "fresh")).map((i) => i.id)).toEqual(["https://fresh.example/"]); } finally { fresh.kill(); delete process.env.PAL_BOOKMARKS_COPY_MS; }
  });
});

