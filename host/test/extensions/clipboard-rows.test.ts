// The clipboard's `rows` palette (extensions/clipboard/{rows,now}.ts):
// what a copied text is read as and the rows each reading gets, pure;
// then the palette over a canned `core/clipboard.current`, the Hide
// dismissal, and a few picks.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClipboardEntry, Item } from "../../../sdk/src/index.ts";
import { analyzeText, decode, evaluate, git, json, parseDate, privateArgv, qrSvg, relative, rows, slug, stats, titleCase, titleOf, tracking, transform, HIDE, SECTION } from "../../../extensions/clipboard/rows.ts";
import { Host, stored } from "../harness.ts";

const entry = (text: string, id = 1): ClipboardEntry => ({ id, kind: "text", text, image: null, files: null, source_app: null, at: 1758000000000, bytes: text.length, pinned: false, width: null, height: null, name: null });
const ids = (items: Item[]) => items.map((i) => i.id);
const rowsOf = (text: string, paths: Parameters<typeof analyzeText>[2] = []) => rows(analyzeText(entry(text), text, paths), { now: 1758000000000 }, "/Users/u");

describe("what the text is", () => {
  test("a web address, with or without a scheme; never an email or a word", () => {
    expect(analyzeText(entry("https://example.com/a?b=c"), "https://example.com/a?b=c", []).url).toBe("https://example.com/a?b=c");
    expect(analyzeText(entry("docs.rs/serde"), "docs.rs/serde", []).url).toBe("https://docs.rs/serde");
    expect(analyzeText(entry("me@example.com"), "me@example.com", []).url).toBeUndefined();
    expect(analyzeText(entry("chrome"), "chrome", []).url).toBeUndefined();
    expect(analyzeText(entry("two words.com"), "two words.com", []).url).toBeUndefined();
  });
  test("a colour, a phone, an email, JSON, an expression, a number, dates, decoded strings, tracking and git refs", () => {
    expect(analyzeText(entry("#ff8800"), "#ff8800", []).color).toMatchObject({ typed: "#ff8800" });
    expect(analyzeText(entry("rebeccapurple"), "rebeccapurple", []).color).toBeDefined();
    expect(analyzeText(entry("+90 (532) 123 45 67"), "+90 (532) 123 45 67", []).phone).toEqual({ digits: "+905321234567", typed: "+90 (532) 123 45 67" });
    expect(analyzeText(entry("555-1234"), "555-1234", []).expr).toBeUndefined();
    expect(analyzeText(entry("a.b@c.io"), "a.b@c.io", []).email).toBe("a.b@c.io");
    expect(json('{"a":1,"b":[1,2]}')).toMatchObject({ what: "2 keys", minified: '{"a":1,"b":[1,2]}' });
    expect(json("[1,2,3]")!.what).toBe("3 items");
    expect(json("{oops")).toBeUndefined();
    expect(analyzeText(entry("2 + 2 * 3"), "2 + 2 * 3", []).expr).toEqual({ expr: "2 + 2 * 3", value: 8 });
    expect(analyzeText(entry("1,234.5"), "1,234.5", []).number).toEqual({ value: 1234.5, typed: "1,234.5" });
    expect(analyzeText(entry("42"), "42", []).color).toBeUndefined();
    expect(parseDate("1700000000")!.at.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(parseDate("1700000000000")!.from).toBe("unix");
    expect(parseDate("2026-09-16T10:00:00Z")!.at.toISOString()).toBe("2026-09-16T10:00:00.000Z");
    expect(parseDate("2026-13-45")).toBeUndefined();
    expect(parseDate("hello")).toBeUndefined();
    expect(decode("48656c6c6f2c20776f726c64")).toEqual({ from: "hex", text: "Hello, world" });
    expect(decode("0x48656c6c6f2c20776f726c64")!.text).toBe("Hello, world");
    expect(decode("SGVsbG8sIHdvcmxkIQ==")).toEqual({ from: "base64", text: "Hello, world!" });
    expect(decode("deadbeef")).toBeUndefined();
    expect(tracking("1Z999AA10123456784")).toMatchObject({ carrier: "UPS" });
    expect(tracking("9400111899223197428490")!.carrier).toBe("USPS");
    expect(tracking("123456789012")!.carrier).toBe("FedEx");
    expect(tracking("hello")).toBeUndefined();
    expect(git("a1b2c3d4e5f6")).toMatchObject({ kind: "sha", short: "a1b2c3d" });
    expect(git("zcag/pal#12")).toMatchObject({ kind: "issue", url: "https://github.com/zcag/pal/issues/12" });
    expect(git("zcag/pal")).toMatchObject({ kind: "repo", url: "https://github.com/zcag/pal" });
    expect(git("1234567")).toBeUndefined();
    expect(git("docs.rs/serde")).toBeUndefined();
  });
  test("arithmetic: precedence, powers, percent, parens; not a bare number, not division by zero", () => {
    expect(evaluate("2+2")).toBe(4);
    expect(evaluate("2 + 3 * 4")).toBe(14);
    expect(evaluate("(2 + 3) * 4")).toBe(20);
    expect(evaluate("2^3^2")).toBe(512);
    expect(evaluate("15% * 80")).toBe(12);
    expect(evaluate("1,000 + 1")).toBe(1001);
    expect(evaluate("-3 + 5")).toBe(2);
    expect(evaluate("42")).toBeUndefined();
    expect(evaluate("1/0")).toBeUndefined();
    expect(evaluate("2 +")).toBeUndefined();
  });
  test("counts, relative times, transforms, titles", () => {
    expect(stats("one two\nthree")).toEqual({ words: 3, chars: 13, lines: 2 });
    expect(relative(new Date(1000), 1000 + 3 * 36e5)).toBe("3 hours ago");
    expect(relative(new Date(2 * 864e5), 0)).toBe("in 2 days");
    expect(relative(new Date(10), 0)).toBe("just now");
    expect(titleCase("the quick brown fox of the road")).toBe("The Quick Brown Fox of the Road");
    expect(slug("Héllo, Wörld! 2026")).toBe("hello-world-2026");
    expect(transform("upper", "ab")).toBe("AB");
    expect(transform("trim", "  ab ")).toBe("ab");
    expect(transform("paste-plain", "x")).toBeUndefined();
    expect(titleOf("<html><head><title>  A &amp; B &#39;c&#39; </title></head>")).toBe("A & B 'c'");
    expect(titleOf("<p>no title</p>")).toBeUndefined();
  });
});

describe("the rows", () => {
  test("a url: the address row (favicon from the url, open first, private, markdown, copy, no shortener) and a QR row; every row ends in Hide under Clipboard", () => {
    const r = rowsOf("https://example.com/x");
    expect(ids(r)).toEqual(["url", "qr", "text"]);
    expect(r[0]).toMatchObject({ name: "example.com/x", url: "https://example.com/x", section: SECTION });
    expect(r[0].actions!.map((a) => a.id)).toEqual(["open", "private", "markdown", "copy", "hide"]);
    expect(r[0].actions!.at(-1)).toEqual(HIDE);
    expect((r[1].icon as { image: string }).image.startsWith("data:image/svg+xml")).toBe(true);
    expect(r[1].detail!.markdown).toContain("data:image/svg+xml");
    for (const row of r) expect(row.actions!.at(-1)).toEqual(HIDE);
    const withTitle = rows({ ...analyzeText(entry("https://example.com/x"), "https://example.com/x", []), title: "Example Domain" }, { shortener: "https://s/?u={url}" }, "/Users/u");
    expect(withTitle[0]).toMatchObject({ name: "Example Domain", subtitle: "https://example.com/x" });
    expect(withTitle[0].actions!.map((a) => a.id)).toContain("shorten");
    expect(qrSvg("x".repeat(5000))).toBeUndefined();
  });
  test("a colour: swatch, notations, the picker first", () => {
    const r = rowsOf("#ff8800");
    expect(ids(r)).toEqual(["color", "text"]);
    expect(r[0]).toMatchObject({ name: "#ff8800", subtitle: "#ff8800 · rgb(255, 136, 0) · hsl(32, 100%, 50%)" });
    expect(r[0].actions![0].id).toBe("picker");
  });
  test("paths and file lists: a row per path (three at most), then the count", () => {
    const paths = [{ path: "/Users/u/a.txt", dir: false, bytes: 10 }, { path: "/Users/u/dir", dir: true, bytes: 0 }, { path: "/Users/u/c.png", dir: false, bytes: 2048 }, { path: "/Users/u/d", dir: false, bytes: 1 }];
    const r = rowsOf("/Users/u/a.txt\n/Users/u/dir\n/Users/u/c.png\n/Users/u/d", paths);
    expect(ids(r)).toEqual(["path:0", "path:1", "path:2", "files", "text"]);
    expect(r[0]).toMatchObject({ name: "a.txt", subtitle: "~", accessories: [{ text: "10 B" }] });
    expect(r[1].accessories).toEqual([{ text: "folder" }]);
    expect(r[3]).toMatchObject({ name: "4 files on the clipboard", subtitle: "2.0 KB in all" });
    expect(rowsOf("~/a.txt", [paths[0]]).map((i) => i.id)).toEqual(["path:0", "text"]);
  });
  test("email, phone, JSON, expression, number, date, decoded, tracking, git, and the text row's counts and transforms", () => {
    expect(rowsOf("me@example.com")[0]).toMatchObject({ id: "email", name: "me@example.com" });
    expect(rowsOf("+1 555 123 4567")[0]).toMatchObject({ id: "phone", subtitle: "Call +15551234567" });
    expect(rowsOf('{"a": 1}')[0]).toMatchObject({ id: "json", name: "JSON · 1 key" });
    expect(rowsOf("2+2")[0]).toMatchObject({ id: "calc", name: "2+2 = 4" });
    expect(rowsOf("255")[0]).toMatchObject({ id: "number", name: "255", subtitle: "0xff · 0b11111111 · 0o377" });
    const date = rowsOf("2026-09-16T10:00:00Z");
    expect(date[0].id).toBe("date");
    expect(date[0].subtitle).toContain("2026-09-16T10:00:00.000Z");
    expect(rowsOf("1700000000").map((i) => i.id)).toEqual(["number", "date", "text"]);
    expect(rowsOf("SGVsbG8sIHdvcmxkIQ==")[0]).toMatchObject({ id: "decoded", name: "Hello, world!", subtitle: "Decoded from base64" });
    expect(rowsOf("1Z999AA10123456784")[0]).toMatchObject({ id: "track", name: "Track with UPS" });
    expect(rowsOf("zcag/pal#12")[0]).toMatchObject({ id: "git", name: "zcag/pal #12", url: "https://github.com/zcag/pal/issues/12" });
    const text = rowsOf("Hello there, general Kenobi.\nA second line.");
    expect(text.map((i) => i.id)).toEqual(["text"]);
    expect(text[0]).toMatchObject({ name: "Hello there, general Kenobi. A second line.", subtitle: "7 words · 43 chars · 2 lines" });
    expect(text[0].actions!.map((a) => a.id)).toEqual(["paste-plain", "snippet", "title", "lower", "upper", "slug", "trim", "hide"]);
    expect(text[0].detail!.metadata!.map((m) => m.label)).toEqual(["Words", "Characters", "Lines", "Copied"]);
  });
  test("an image: dimensions, save, copy as file, paste; the OCR row when the core can", () => {
    const img: ClipboardEntry = { id: 9, kind: "image", text: null, image: "/tmp/x.png", files: null, source_app: null, at: 0, bytes: 4096, pinned: false, width: 640, height: 480, name: null };
    const r = rows({ entry: img, paths: [], image: { width: 640, height: 480, bytes: 4096, ocr: true } }, { ocr: true });
    expect(ids(r)).toEqual(["image", "ocr"]);
    expect(r[0]).toMatchObject({ name: "Image 640 × 480", subtitle: "4.0 KB · PNG", icon: { image: "icon://localhost/clip?id=9&size=48" } });
    expect(r[0].actions!.map((a) => a.id)).toEqual(["save", "copy-file", "paste", "hide"]);
    expect(rows({ entry: img, paths: [], image: { bytes: 4096, ocr: false } }, {}).map((i) => i.id)).toEqual(["image"]);
  });
  test("a private window goes to the first installed browser, or the preferred one", () => {
    const installed = (app: string) => ["Google Chrome", "Firefox"].includes(app);
    expect(privateArgv(installed, "https://x")).toEqual(process.platform === "darwin" ? ["open", "-na", "Google Chrome", "--args", "--incognito", "https://x"] : ["google-chrome", "--incognito", "https://x"]);
    expect(privateArgv(installed, "https://x", "firefox")).toEqual(process.platform === "darwin" ? ["open", "-na", "Firefox", "--args", "--private-window", "https://x"] : ["firefox", "--private-window", "https://x"]);
    expect(privateArgv(() => false, "https://x")).toBeUndefined();
  });
});

describe("the rows palette over the host", () => {
  let host: Host;
  let current: ClipboardEntry | null = null;
  let dir: string;
  beforeAll(async () => {
    stored.clear();
    dir = mkdtempSync(join(tmpdir(), "pal-cliprows-"));
    mkdirSync(join(dir, "Desktop"));
    writeFileSync(join(dir, "note.txt"), "hello\n");
    // No title fetch: the tests stay off the network.
    host = await Host.bundled({ core: { "clipboard.current": () => current, "ocr.available": () => false }, settings: { clipboard: { palettes: { rows: { fetch_titles: false } } } } });
  });
  afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });
  const suggest = () => host.request<{ extension: string; palette: string; items: Item[] }[]>("suggest").then((r) => r.find((s) => s.extension === "clipboard")?.items ?? []);

  test("nothing on the clipboard: no suggestion, one inert row inside", async () => {
    current = null;
    expect(await suggest()).toEqual([]);
    const items = await host.list("clipboard", "rows");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "empty", actions: [] });
  });

  test("a copied path suggests its row; Hide keeps it away until the clipboard changes; the query narrows the palette", async () => {
    current = entry(join(dir, "note.txt"), 3);
    const s = await suggest();
    expect(s.map((i) => i.id)).toEqual(["path:0", "text"]);
    expect(s[0]).toMatchObject({ name: "note.txt", section: "Clipboard" });
    expect(await host.list("clipboard", "rows", "note").then(ids)).toEqual(["path:0", "text"]); // both rows name the file
    expect(await host.list("clipboard", "rows", "zzz").then(ids)).toEqual([]);
    expect(await host.pick("clipboard", "rows", "path:0", "copy")).toEqual({ copy: join(dir, "note.txt") });
    expect(await host.pick("clipboard", "rows", "path:0", "copy-name")).toEqual({ copy: "note.txt" });
    expect(await host.pick("clipboard", "rows", "path:0", "open-with")).toEqual({ push: { extension: "files", palette: "files", args: { open_with: join(dir, "note.txt") } } });
    const hidden = await host.pick("clipboard", "rows", "text", "hide");
    expect(hidden.keep).toBe(true);
    expect(await suggest()).toEqual([]);
    expect(await host.list("clipboard", "rows").then(ids)).toEqual(["path:0", "text"]); // the palette itself still lists it
    current = { ...current, at: current.at + 1 };
    expect(await suggest().then(ids)).toEqual(["path:0", "text"]);
  });

  test("picks: the answer, the transforms, the notations, the address; a changed clipboard is a toast", async () => {
    current = entry("2+2", 4);
    expect(await host.pick("clipboard", "rows", "calc")).toEqual({ copy: "4" });
    expect(await host.pick("clipboard", "rows", "calc", "copy-both")).toEqual({ copy: "2+2 = 4" });
    expect(await host.pick("clipboard", "rows", "text", "upper")).toMatchObject({ copy: "2+2" });
    expect(await host.pick("clipboard", "rows", "text")).toEqual({ paste: { text: "2+2" } });
    expect(await host.pick("clipboard", "rows", "text", "snippet")).toEqual({ push: { extension: "snippets", palette: "snippets", args: { create: "2+2" } } });
    current = entry("#ff8800", 5);
    expect(await host.pick("clipboard", "rows", "color", "rgb")).toEqual({ copy: "rgb(255, 136, 0)" });
    expect(await host.pick("clipboard", "rows", "color")).toEqual({ push: { extension: "colors", palette: "picker", args: { color: "#ff8800", from: "typed" } } });
    expect((await host.pick("clipboard", "rows", "calc")).toast).toMatchObject({ title: "The clipboard changed" });
    current = entry("https://example.com/", 6);
    expect(await host.pick("clipboard", "rows", "url", "markdown")).toEqual({ copy: "[example.com/](https://example.com/)" });
    expect(await host.pick("clipboard", "rows", "url")).toEqual({ open: "https://example.com/" });
    expect((await host.pick("clipboard", "rows", "qr")).show!.markdown).toContain("data:image/svg+xml");
    expect(await host.pick("clipboard", "rows", "email", "copy")).toMatchObject({ toast: { title: "The clipboard changed" } });
  });
});
