// clipboard against canned core/clipboard.* replies (harness fixtures).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import type { ClipboardEntry } from "../../../sdk/src/index.ts";
import { Host, fixtures } from "../harness.ts";

let host: Host;
const calls = { pin: [] as unknown[], del: [] as unknown[], copy: [] as unknown[], clear: 0 };
/** The fixtures plus a colour, with the core's `kind` and `offset` honoured (the harness's default answers the query alone). */
const ENTRIES: ClipboardEntry[] = [
  ...fixtures.clipboard,
  { id: 6, kind: "text", text: "rgb(255, 0, 128)", image: null, files: null, source_app: null, at: 1758000005000, bytes: 16, pinned: false, width: null, height: null },
];
let entries = ENTRIES;
/** What the canned `core/ocr.image` reads; null makes it fail. */
let ocrText: string | null = "";
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "clipboard.list": ({ query = "", kind, limit = 200, offset = 0 }: { query?: string; kind?: string; limit?: number; offset?: number } = {}) =>
        entries.filter((e) => (!kind || e.kind === kind) && (!query || (e.text ?? e.files?.join(" ") ?? "").toLowerCase().includes(query.toLowerCase()))).slice(offset, offset + limit),
      "clipboard.get": ({ id }: { id: number }) => { const e = entries.find((e) => e.id === id); if (!e) throw new Error(`no entry ${id}`); return e; },
      "clipboard.pin": (p) => { calls.pin.push(p); return null; },
      "clipboard.delete": (p: { id: number }) => { calls.del.push(p); entries = entries.filter((e) => e.id !== p.id); return null; },
      "clipboard.copy": (p) => { calls.copy.push(p); return null; },
      "clipboard.clear": () => { calls.clear++; return null; },
      "ocr.image": () => { if (ocrText === null) throw new Error("OCR unavailable: tesseract is not installed"); return { text: ocrText }; },
    },
  });
});
afterAll(() => host.kill());

const list = (q?: string, filter?: string) => host.list("clipboard", "history", q, filter ? { filter } : undefined);
const pick = (id: string, action?: string) => host.pick("clipboard", "history", id, action);

describe("clipboard", () => {
  test("meta: live input palette that opens with the detail pane, six kind filters", () => {
    expect(host.loaded().find((l) => l.extension === "clipboard")!.palettes).toEqual([
      { name: "history", title: "Clipboard History", live: true, input: true, icon: tile("violet", "\u{f014d}"), placeholder: "Search clipboard history", showDetail: true,
        filters: [{ id: "all", title: "All" }, { id: "text", title: "Text" }, { id: "image", title: "Images" }, { id: "files", title: "Files" }, { id: "links", title: "Links" }, { id: "colors", title: "Colors" }] },
      // What is on the clipboard now (now.ts): an input palette that suggests the root's Clipboard section.
      { name: "rows", title: "Clipboard", live: false, input: true, icon: tile("violet", "\u{f014d}"), placeholder: "What is on the clipboard", suggest: true },
    ]);
  });

  test("list asks core/clipboard.list with the query and its own page size", async () => {
    await list("hello");
    expect(host.coreCalls.at(-1)).toEqual({ method: "clipboard.list", params: { query: "hello", limit: 200 } });
  });

  test("rows: title, subtitle, icon per kind, accessories, url and colour detection, the pinned section", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    const [text, multi, image, files, url, color] = items;
    expect(text).toMatchObject({ name: "hello world", icon: "\u{f09a8}", accessories: [{ text: "Chrome" }, { date: 1758000000000 }] });
    expect(text.subtitle).toBeUndefined();
    expect(text.section).toBeUndefined();
    expect(multi).toMatchObject({ name: "line one", subtitle: "3 lines · line one line two line three", section: "Pinned", accessories: [{ text: "kitty" }, { date: 1758000001000 }, { tag: "pinned", color: "amber" }] });
    expect(image).toMatchObject({ name: "Image 640 x 480", icon: { image: "icon://localhost/clip?id=3&size=48" }, accessories: [{ text: "12.1 KB" }, { date: 1758000002000 }] });
    expect(files).toMatchObject({ name: "a.txt, b.txt", subtitle: "2 files", icon: "\u{f1032}", accessories: [{ text: "Finder" }, { date: 1758000003000 }] });
    expect(url).toMatchObject({ name: "https://example.com/page", url: "https://example.com/page", accessories: [{ text: "Safari" }, { date: 1758000004000 }] });
    expect(url.icon).toBeUndefined();
    // A colour's icon is the hex colour itself: the UI draws a tinted dot for one.
    expect(color).toMatchObject({ name: "rgb(255, 0, 128)", icon: "#ff0080" });
    // The pane draws the colour as a wide swatch above the fenced text.
    expect(color.detail!.markdown).toMatch(/^!\[\]\(data:image\/svg\+xml;utf8,.*ff0080.*\)\n\n````\nrgb\(255, 0, 128\)\n````$/);
  });

  test("filters: the core's kinds are passed through; links and colours are text narrowed here", async () => {
    expect((await list("", "image")).map((i) => i.id)).toEqual(["3"]);
    expect(host.coreCalls.at(-1)).toEqual({ method: "clipboard.list", params: { query: "", limit: 200, kind: "image" } });
    expect((await list("", "files")).map((i) => i.id)).toEqual(["4"]);
    expect((await list("", "text")).map((i) => i.id)).toEqual(["1", "2", "5", "6"]);
    expect((await list("", "links")).map((i) => i.id)).toEqual(["5"]);
    expect(host.coreCalls.at(-1)).toEqual({ method: "clipboard.list", params: { query: "", limit: 200, kind: "text" } });
    expect((await list("", "colors")).map((i) => i.id)).toEqual(["6"]);
    expect((await list("", "all")).map((i) => i.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  test("detail: fenced text, the image, the file list, and metadata", async () => {
    const [text, , image, files] = await list();
    expect(text.detail!.markdown).toBe("````\nhello world\n````");
    expect(text.detail!.metadata).toEqual([
      { label: "Kind", value: "text" }, { label: "Size", value: "11 B · 11 chars" }, { label: "Source", value: "Chrome" },
      { label: "Copied", value: expect.stringMatching(/2025/) }, // local time in the host; bun test itself runs in UTC
    ]);
    expect(image.detail!.markdown).toBe("![](icon://localhost/clip?id=3&size=0)");
    expect(image.detail!.metadata).toContainEqual({ label: "Size", value: "12.1 KB · 640 x 480 px" });
    expect(files.detail!.markdown).toBe("- `/Users/x/a.txt`\n- `/Users/x/b.txt`");
    const pinned = (await list())[1].detail!.metadata!;
    expect(pinned.at(-1)).toEqual({ label: "Pinned", tags: [{ text: "pinned", color: "amber" }] });
  });

  test("actions: paste first by default, plain-text paste on text, open on a link, the file copy on an image, pin/unpin by state, destructive ones confirm", async () => {
    const [text, multi, image, files, url] = await list();
    expect(text.actions!.map((a) => a.id)).toEqual(["paste", "copy", "paste-plain", "pin", "delete", "delete-unpinned", "clear"]);
    expect(text.actions![3].title).toBe("Pin");
    expect(multi.actions![3].title).toBe("Unpin");
    expect(url.actions!.map((a) => a.id)).toEqual(["paste", "copy", "open", "paste-plain", "pin", "delete", "delete-unpinned", "clear"]);
    expect(image.actions!.map((a) => a.id)).toEqual(["paste", "copy", "copy-file", "copy-text", "pin", "delete", "delete-unpinned", "clear"]);
    expect(image.actions![3]).toEqual({ id: "copy-text", title: "Copy text from image", shortcut: "cmd+shift+t" });
    expect(files.actions!.map((a) => a.id)).toEqual(["paste", "copy", "pin", "delete", "delete-unpinned", "clear"]);
    const del = text.actions!.find((a) => a.id === "delete")!;
    expect(del).toEqual({ id: "delete", title: "Delete", shortcut: "cmd+d", style: "destructive", confirm: "Delete this entry from history?", multi: true });
    // Copy and Delete take marked rows; a paste is one entry.
    expect(text.actions!.filter((a) => a.multi).map((a) => a.id)).toEqual(["copy", "delete"]);
    expect(text.actions!.find((a) => a.id === "delete-unpinned")).toEqual({ id: "delete-unpinned", title: "Delete all unpinned", style: "destructive", confirm: "Delete every unpinned entry? Pinned ones stay." });
    expect(text.actions!.find((a) => a.id === "clear")!.confirm).toMatch(/pinned ones included/);
  });

  test("pick: open a link, paste text as plain text, copy an image's file", async () => {
    expect(await pick("5", "open")).toEqual({ open: "https://example.com/page" });
    expect(await pick("2", "paste-plain")).toEqual({ paste: { text: "line one\nline two\nline three" } });
    expect(await pick("3", "copy-file")).toEqual({ copy_files: ["/tmp/clip-3.png"] });
    // The wrong kind falls back to the entry paste rather than failing.
    expect(await pick("1", "open")).toEqual({ paste: { entry: 1 } });
    expect(await pick("1", "copy-file")).toEqual({ paste: { entry: 1 } });
  });

  test("pick: Copy text from image runs OCR over the core and copies what it read; concealed when the setting says so; failures and empties are toasts", async () => {
    ocrText = "Total 42.00";
    expect(await pick("3", "copy-text")).toEqual({ copy: "Total 42.00", hud: "Copied text" });
    expect(host.coreCalls.at(-1)).toEqual({ method: "ocr.image", params: { path: "/tmp/clip-3.png" } });
    host.changeSettings("clipboard", { settings: { ocr_concealed: true } });
    expect(await pick("3", "copy-text")).toEqual({ copy: { text: "Total 42.00", concealed: true }, hud: "Copied text" });
    host.changeSettings("clipboard", {});
    ocrText = "";
    expect(await pick("3", "copy-text")).toMatchObject({ keep: true, toast: { title: "No text in the image" } });
    ocrText = null;
    expect(await pick("3", "copy-text")).toMatchObject({ keep: true, toast: { title: "Could not read the text", message: "OCR unavailable: tesseract is not installed", style: "failure" } });
    expect(await pick("1", "copy-text")).toEqual({ paste: { entry: 1 } });
  });

  test("pick: Enter pastes the entry by id; copy goes through the core and hides", async () => {
    expect(await pick("1")).toEqual({ paste: { entry: 1 } });
    expect(await pick("1", "paste")).toEqual({ paste: { entry: 1 } });
    expect(await pick("2", "copy")).toEqual({});
    expect(calls.copy).toEqual([{ id: 2 }]);
  });

  test("pick: pin toggles from the entry's state, delete and clear keep the palette open", async () => {
    expect(await pick("2", "pin")).toEqual({ keep: true });
    expect(calls.pin).toEqual([{ id: 2, pinned: false }]);
    expect(await pick("1", "pin")).toEqual({ keep: true });
    expect(calls.pin.at(-1)).toEqual({ id: 1, pinned: true });
    expect(await pick("4", "delete")).toEqual({ keep: true });
    expect(calls.del).toEqual([{ id: 4 }]);
    expect(await pick("4", "clear")).toEqual({ keep: true, toast: { title: "History cleared" } });
    expect(calls.clear).toBe(1);
  });

  test("delete all unpinned: every unpinned entry goes through clipboard.delete, the pinned one stays", async () => {
    expect(await pick("1", "delete-unpinned")).toEqual({ keep: true, toast: { title: "Deleted 4 unpinned entries" } });
    expect(calls.del.slice(1)).toEqual([{ id: 1 }, { id: 3 }, { id: 5 }, { id: 6 }]);
    expect((await list()).map((i) => i.id)).toEqual(["2"]);
    expect(await pick("2", "delete-unpinned")).toEqual({ keep: true, toast: { title: "Deleted 0 unpinned entries" } });
    entries = ENTRIES;
  });

  test("a core error on pick is the reply's error", async () => {
    const r = await host.call("pick", { extension: "clipboard", palette: "history", id: "99", action: "pin" });
    expect(r.error).toBe("no entry 99");
  });

  test("settings: primary_action copy reorders, exclude_apps drops rows; the retention keys are the recorder's, not a list filter", async () => {
    host.changeSettings("clipboard", { settings: { primary_action: "copy", exclude_apps: ["com.google.Chrome", "safari"], max_entries: 1, max_age_days: 1 } });
    const items = await list();
    expect(host.coreCalls.at(-1)).toEqual({ method: "clipboard.list", params: { query: "", limit: 200 } });
    expect(items.map((i) => i.id)).toEqual(["2", "3", "4", "6"]);
    expect(items[0].actions!.map((a) => a.id).slice(0, 2)).toEqual(["copy", "paste"]);
    host.changeSettings("clipboard", {});
    expect(await list()).toHaveLength(ENTRIES.length);
  });

  test("pick with marked rows (ctx.ids): copy joins their text one per line (a file list its paths, an image its title) as one copy; delete removes each", async () => {
    entries = ENTRIES;
    calls.del.length = 0;
    expect(await host.pick("clipboard", "history", "1", "copy", { ids: ["1", "4", "3"] })).toEqual({ copy: "hello world\n/Users/x/a.txt\n/Users/x/b.txt\nImage 640 x 480", hud: "Copied 3 entries" });
    expect(await host.pick("clipboard", "history", "1", "delete", { ids: ["1", "5"] })).toEqual({ keep: true });
    expect(calls.del).toEqual([{ id: 1 }, { id: 5 }]);
  });
});
