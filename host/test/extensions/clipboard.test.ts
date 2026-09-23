// clipboard against canned core/clipboard.* replies (harness fixtures).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tile } from "../../../sdk/src/icon.ts";
import type { ClipboardEntry } from "../../../sdk/src/index.ts";
import { fileNameFor } from "../../../extensions/clipboard/rows.ts";
import { Host, fixtures } from "../harness.ts";

let host: Host;
const calls = { pin: [] as unknown[], del: [] as unknown[], copy: [] as unknown[], rename: [] as unknown[], clear: 0 };
/** Where Save as file writes in the tests, and the image the recorder "keeps" for entry 3. */
const dir = mkdtempSync(join(tmpdir(), "pal-clip-"));
const PNG = join(dir, "clip-3.png");
writeFileSync(PNG, Buffer.from("89504e470d0a1a0a", "hex"));
/** The fixtures plus a colour, with the core's `kind` and `offset` honoured (the harness's default answers the query alone). */
const ENTRIES: ClipboardEntry[] = [
  ...fixtures.clipboard.map((e) => (e.id === 3 ? { ...e, image: PNG } : { ...e })),
  { id: 6, kind: "text", text: "rgb(255, 0, 128)", image: null, files: null, source_app: null, at: 1758000005000, bytes: 16, pinned: false, width: null, height: null, name: null },
];
let entries = ENTRIES;
/** What the canned `core/ocr.image` reads; null makes it fail. */
let ocrText: string | null = "";
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "clipboard.list": ({ query = "", kind, limit = 200, offset = 0 }: { query?: string; kind?: string; limit?: number; offset?: number } = {}) =>
        entries.filter((e) => (!kind || e.kind === kind) && (!query || `${e.text ?? e.files?.join(" ") ?? ""} ${e.name ?? ""}`.toLowerCase().includes(query.toLowerCase()))).slice(offset, offset + limit),
      "clipboard.get": ({ id }: { id: number }) => { const e = entries.find((e) => e.id === id); if (!e) throw new Error(`no entry ${id}`); return e; },
      "clipboard.pin": (p) => { calls.pin.push(p); return null; },
      "clipboard.rename": (p: { id: number; name: string | null }) => { calls.rename.push(p); const e = entries.find((e) => e.id === p.id); if (!e) throw new Error(`no entry ${p.id}`); e.name = p.name; return null; },
      "clipboard.delete": (p: { id: number }) => { calls.del.push(p); entries = entries.filter((e) => e.id !== p.id); return null; },
      "clipboard.copy": (p) => { calls.copy.push(p); return null; },
      "clipboard.clear": () => { calls.clear++; return null; },
      "ocr.image": () => { if (ocrText === null) throw new Error("OCR unavailable: tesseract is not installed"); return { text: ocrText }; },
    },
  });
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

const list = (q?: string, filter?: string) => host.list("clipboard", "history", q, filter ? { filter } : undefined);
const pick = (id: string, action?: string, values?: Record<string, string | boolean>) => host.pick("clipboard", "history", id, action, values ? { values } : undefined);

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
    // A named entry (fixture 2, "Deploy notes") is titled by its name; the text stays in the subtitle.
    expect(multi).toMatchObject({ name: "Deploy notes", subtitle: "3 lines · line one line two line three", section: "Pinned", accessories: [{ text: "kitty" }, { date: 1758000001000 }, { tag: "pinned", color: "amber" }] });
    expect(image).toMatchObject({ name: "Image 640 x 480", icon: { image: "icon://localhost/clip?id=3&size=48" }, accessories: [{ text: "12 KB" }, { date: 1758000002000 }] });
    expect(image.subtitle).toBeUndefined();
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
    expect(image.detail!.metadata).toContainEqual({ label: "Size", value: "12 KB · 640 x 480 px" });
    expect(files.detail!.markdown).toBe("- `/Users/x/a.txt`\n- `/Users/x/b.txt`");
    const pinned = (await list())[1].detail!.metadata!;
    expect(pinned[0]).toEqual({ label: "Name", value: "Deploy notes" });
    expect(pinned.at(-1)).toEqual({ label: "Pinned", tags: [{ text: "pinned", color: "amber" }] });
  });

  test("actions: paste first by default, plain-text paste on text, open on a link, the file copy on an image, pin/unpin by state, destructive ones confirm", async () => {
    const [text, multi, image, files, url] = await list();
    const MANAGE = ["pin", "rename", "save-file"];
    expect(text.actions!.map((a) => a.id)).toEqual(["paste", "copy", "paste-plain", "edit", ...MANAGE, "snippet", "qr", "diff", "diff-two", "delete", "delete-unpinned", "clear"]);
    const pin = (i: (typeof text)) => i.actions!.find((a) => a.id === "pin")!.title;
    expect(pin(text)).toBe("Pin");
    expect(pin(multi)).toBe("Unpin");
    // Name… until the entry has one, Rename… after.
    expect(text.actions!.find((a) => a.id === "rename")).toEqual({ id: "rename", title: "Name", shortcut: "cmd+shift+r", args: true });
    expect(multi.actions!.find((a) => a.id === "rename")!.title).toBe("Rename");
    // The name field in the bar: only Name / Rename reads it, prefilled with the name the row has.
    expect(text.args).toEqual([{ id: "name", placeholder: "Name" }]);
    expect(multi.args).toEqual([{ id: "name", placeholder: "New name (blank clears it)", default: multi.name }]);
    expect(text.actions!.find((a) => a.id === "edit")).toEqual({ id: "edit", title: "Edit…", shortcut: "cmd+e" });
    expect(text.actions!.find((a) => a.id === "save-file")).toEqual({ id: "save-file", title: "Save as file…", shortcut: "cmd+s" });
    expect(text.actions!.find((a) => a.id === "snippet")).toEqual({ id: "snippet", title: "Save as snippet", shortcut: "cmd+shift+s" });
    expect(text.actions!.find((a) => a.id === "qr")).toEqual({ id: "qr", title: "Show as QR code", shortcut: "cmd+shift+k" });
    expect(url.actions!.map((a) => a.id)).toEqual(["paste", "copy", "open", "paste-plain", "edit", ...MANAGE, "snippet", "qr", "diff", "diff-two", "delete", "delete-unpinned", "clear"]);
    // Edit, snippet and QR are for text; an image and a file list keep the file save and the name.
    expect(image.actions!.map((a) => a.id)).toEqual(["paste", "copy", "copy-file", "copy-text", ...MANAGE, "delete", "delete-unpinned", "clear"]);
    expect(image.actions![3]).toEqual({ id: "copy-text", title: "Copy text from image", shortcut: "cmd+shift+t" });
    expect(files.actions!.map((a) => a.id)).toEqual(["paste", "copy", ...MANAGE, "delete", "delete-unpinned", "clear"]);
    const del = text.actions!.find((a) => a.id === "delete")!;
    expect(del).toEqual({ id: "delete", title: "Delete", shortcut: "cmd+d", style: "destructive", confirm: "Delete this entry from history?", multi: true });
    // Copy and Delete take marked rows; a paste is one entry.
    expect(text.actions!.filter((a) => a.multi).map((a) => a.id)).toEqual(["copy", "diff-two", "delete"]);
    expect(text.actions!.find((a) => a.id === "delete-unpinned")).toEqual({ id: "delete-unpinned", title: "Delete all unpinned", style: "destructive", confirm: "Delete every unpinned entry? Pinned ones stay." });
    expect(text.actions!.find((a) => a.id === "clear")!.confirm).toMatch(/pinned ones included/);
  });

  test("pick: open a link, paste text as plain text, copy an image's file", async () => {
    expect(await pick("5", "open")).toEqual({ open: "https://example.com/page" });
    expect(await pick("2", "paste-plain")).toEqual({ paste: { text: "line one\nline two\nline three" } });
    expect(await pick("3", "copy-file")).toEqual({ copy_files: [PNG] });
    // The wrong kind falls back to the entry paste rather than failing.
    expect(await pick("1", "open")).toEqual({ paste: { entry: 1 } });
    expect(await pick("1", "copy-file")).toEqual({ paste: { entry: 1 } });
  });

  test("pick: Copy text from image runs OCR over the core and copies what it read; concealed when the setting says so; failures and empties are toasts", async () => {
    ocrText = "Total 42.00";
    expect(await pick("3", "copy-text")).toEqual({ copy: "Total 42.00", hud: "Copied text" });
    expect(host.coreCalls.at(-1)).toEqual({ method: "ocr.image", params: { path: PNG } });
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

  test("edit: a form with the text in a textarea; the submit copies the edited text (or pastes it with the box ticked), an emptied text is refused", async () => {
    const f = (await pick("1", "edit")) as { form: { id: string; title: string; fields: { id: string; kind: string; default?: unknown }[]; submit: { id: string } } };
    expect(f.form).toMatchObject({ id: "1", title: "Edit entry", submit: { id: "edit-submit", title: "Copy edited text" } });
    expect(f.form.fields.map((x) => [x.id, x.kind, x.default])).toEqual([["text", "textarea", "hello world"], ["paste", "checkbox", false]]);
    expect(((await pick("2", "edit")) as { form: { title: string } }).form.title).toBe("Edit Deploy notes");
    expect(await pick("1", "edit-submit", { text: "hello there", paste: false })).toEqual({ copy: "hello there" });
    expect(await pick("1", "edit-submit", { text: "hello there", paste: true })).toEqual({ paste: { text: "hello there" } });
    expect(await pick("1", "edit-submit", { text: "   ", paste: false })).toMatchObject({ form: { errors: { text: "Nothing to copy" } } });
    // Not a text entry: the plain paste, as every wrong-kind action.
    expect(await pick("3", "edit")).toEqual({ paste: { entry: 3 } });
  });

  test("name: the bar's field goes through clipboard.rename (a pick without it is the field as a form); empty clears; the row is then titled by it and found by it", async () => {
    const f = (await pick("1", "rename")) as { form: { title: string; fields: { id: string; default?: unknown }[]; submit: { id: string; title: string } } };
    expect(f.form).toMatchObject({ title: "Name this entry", submit: { id: "rename", title: "Name" } });
    expect(f.form.fields[0]).toMatchObject({ id: "name" });
    expect(await pick("1", "rename", { name: "  Greeting " })).toEqual({ keep: true, toast: { title: "Named", message: "Greeting" } });
    expect(calls.rename).toEqual([{ id: 1, name: "Greeting" }]);
    const [row] = await list();
    expect(row).toMatchObject({ name: "Greeting", subtitle: "hello world", args: [{ id: "name", placeholder: "New name (blank clears it)", default: "Greeting" }] });
    expect(row.actions!.find((a) => a.id === "rename")!.title).toBe("Rename");
    expect((await list("greet")).map((i) => i.id)).toEqual(["1"]);
    expect(((await pick("1", "rename")) as { form: { title: string; fields: { default?: unknown }[] } }).form).toMatchObject({ title: "Rename Greeting", fields: [{ default: "Greeting" }] });
    // The form's old submit id still lands (a saved hotkey may carry it).
    expect(await pick("1", "rename-submit", { name: "" })).toEqual({ keep: true, toast: { title: "Name cleared", message: undefined } });
    expect(calls.rename.at(-1)).toEqual({ id: 1, name: null });
    expect((await list())[0]).toMatchObject({ name: "hello world" });
    expect((await list())[0].subtitle).toBeUndefined();
  });

  test("save as file: the form defaults to the Desktop and a name from the entry; the submit writes the text, copies the PNG, refuses an existing name", async () => {
    expect(fileNameFor({ kind: "text", text: "Hello: there, general Kenobi/Grievous and the rest of them all", name: null, width: null, height: null })).toBe("Hello there, general Kenobi Grievous and.txt");
    expect(fileNameFor({ kind: "text", text: "\n  \n", name: null, width: null, height: null })).toBe("Clipboard.txt");
    expect(fileNameFor({ kind: "image", text: null, name: null, width: 640, height: 480 })).toBe("Image 640x480.png");
    expect(fileNameFor({ kind: "image", text: null, name: "Screenshot of the bug", width: 640, height: 480 })).toBe("Screenshot of the bug.png");
    expect(fileNameFor({ kind: "files", text: null, name: null, width: null, height: null })).toBe("paths.txt");
    const f = (await pick("1", "save-file")) as { form: { title: string; fields: { id: string; default?: unknown }[]; submit: { id: string } } };
    expect(f.form).toMatchObject({ title: "Save as file", submit: { id: "save-submit" } });
    expect(f.form.fields.map((x) => [x.id, x.default])).toEqual([["folder", "~/Desktop"], ["name", "hello world.txt"]]);
    const out = join(dir, "saved");
    expect(await pick("1", "save-submit", { folder: out, name: "hi.txt" })).toEqual({ keep: true, toast: { title: "Saved", message: join(out, "hi.txt") } });
    expect(readFileSync(join(out, "hi.txt"), "utf8")).toBe("hello world");
    expect(await pick("1", "save-submit", { folder: out, name: "hi.txt" })).toMatchObject({ form: { errors: { name: "hi.txt exists there already" } } });
    expect(await pick("1", "save-submit", { folder: out, name: "a/b.txt" })).toMatchObject({ form: { errors: { name: "A file name, without a slash" } } });
    expect(await pick("1", "save-submit", { folder: "  ", name: "x.txt" })).toMatchObject({ form: { errors: { folder: "A folder path" } } });
    expect(await pick("3", "save-submit", { folder: out, name: "pic.png" })).toMatchObject({ keep: true, toast: { title: "Saved" } });
    expect(readFileSync(join(out, "pic.png"))).toEqual(readFileSync(PNG));
    expect(await pick("4", "save-submit", { folder: out, name: "list.txt" })).toMatchObject({ keep: true });
    expect(readFileSync(join(out, "list.txt"), "utf8")).toBe("/Users/x/a.txt\n/Users/x/b.txt\n");
  });

  test("save as snippet pushes the snippets palette with the text to create; the QR action shows the code large, a too-long text is a toast", async () => {
    expect(await pick("1", "snippet")).toEqual({ push: { extension: "snippets", palette: "snippets", args: { create: "hello world" } } });
    expect(await pick("3", "snippet")).toEqual({ paste: { entry: 3 } });
    const qr = (await pick("5", "qr")) as { show: { title: string; markdown: string } };
    expect(qr.show.title).toBe("QR code");
    expect(qr.show.markdown).toMatch(/^!\[\]\(data:image\/svg\+xml;utf8,.+\)\n\n`https:\/\/example\.com\/page`$/);
    expect(((await pick("2", "qr")) as { show: { title: string } }).show.title).toBe("Deploy notes");
    entries = [...ENTRIES, { id: 7, kind: "text", text: "x".repeat(3000), image: null, files: null, source_app: null, at: 1, bytes: 3000, pinned: false, width: null, height: null, name: null }];
    expect((await list()).find((i) => i.id === "7")!.actions!.map((a) => a.id)).not.toContain("qr");
    expect(await pick("7", "qr")).toMatchObject({ keep: true, toast: { title: "Too long for a QR code", style: "failure" } });
    entries = ENTRIES;
  });

  test("a core error on pick is the reply's error", async () => {
    const r = await host.call("pick", { extension: "clipboard", palette: "history", id: "99", action: "pin" });
    expect(r.error).toBe("no entry 99");
  });

  test("settings: primary_action copy reorders; what is recorded and listed is the feature's (clipboard.list leaves excluded apps out), not a filter here", async () => {
    host.changeSettings("clipboard", { settings: { primary_action: "copy" } });
    const items = await list();
    expect(host.coreCalls.at(-1)).toEqual({ method: "clipboard.list", params: { query: "", limit: 200 } });
    expect(items).toHaveLength(ENTRIES.length);
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
