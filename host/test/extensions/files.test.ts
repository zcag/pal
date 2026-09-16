// files: an input palette over a spawned search. A temp folder of named
// files is the world; `PAL_FILES_BACKEND=find` makes the extension walk it
// (Spotlight, fd and locate would not know a folder made a moment ago).
// Skipped where `find` is missing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../harness.ts";

const HAS_FIND = Bun.which("find") !== null;
const MAC = process.platform === "darwin";

let host: Host;
let dir: string;
beforeAll(async () => {
  if (!HAS_FIND) return;
  dir = mkdtempSync(join(tmpdir(), "pal-files-"));
  writeFileSync(join(dir, "report-alpha.txt"), "line one\nline two\nline three\n");
  writeFileSync(join(dir, "Report-Beta.md"), "# beta\n");
  writeFileSync(join(dir, "photo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]));
  writeFileSync(join(dir, ".report-hidden.txt"), "secret\n");
  mkdirSync(join(dir, "reports"));
  writeFileSync(join(dir, "reports", "report-gamma.txt"), "gamma\n");
  process.env.PAL_FILES_BACKEND = "find";
  host = await Host.bundled({ settings: { files: { settings: { folders: [dir] } } } });
});
afterAll(() => { host?.kill(); if (dir) rmSync(dir, { recursive: true, force: true }); });

const list = (q?: string) => host.list("files", "files", q);
const pick = (id: string, action?: string) => host.pick("files", "files", id, action);

describe.skipIf(!HAS_FIND)("files", () => {
  test("meta: input palette with lazy detail", () => {
    expect(host.loaded().find((l) => l.extension === "files")!.palettes[0]).toEqual({ name: "files", title: "Files", live: false, input: true, icon: "▤", placeholder: "Search files by name", detail: "lazy" });
  });

  test("an empty query lists inert hints naming the backend and the folders; find warns it is slow", async () => {
    const hints = await list("");
    expect(hints.map((h) => h.actions)).toEqual([[], []]);
    expect(hints[0].subtitle).toBe(`find in ${dir}`);
    expect(hints[1].name).toBe("This will be slow");
    expect(await list()).toEqual(hints);
  });

  test("rows: name, parent as subtitle, size and date accessories, glyph by kind, four actions; exact and prefix matches first", async () => {
    const items = await list("report");
    // All four are prefix matches, so the order is find's (traversal, not sorted).
    expect(items.map((i) => i.name).sort()).toEqual(["Report-Beta.md", "report-alpha.txt", "report-gamma.txt", "reports"]);
    const alpha = items.find((i) => i.name === "report-alpha.txt")!;
    expect(alpha.id).toBe(join(dir, "report-alpha.txt"));
    expect(alpha.subtitle).toBe(dir);
    expect(alpha.icon).toBe("≡");
    expect(alpha.accessories).toEqual([{ text: "29 B" }, { date: expect.any(Number) }]);
    expect(alpha.actions!.map((a) => a.id)).toEqual(["open", "reveal", "copy", "trash"]);
    expect(alpha.actions![3]).toMatchObject({ style: "destructive", confirm: expect.any(String) });
    expect(items.find((i) => i.name === "report-gamma.txt")!.subtitle).toBe(join(dir, "reports"));
    expect(items.find((i) => i.name === "reports")).toMatchObject({ icon: "▸", accessories: [{ date: expect.any(Number) }] });
    expect((await list("photo"))[0].icon).toBe("▣");
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

  test("pick: open by default, copy path (reveal is not exercised: it would raise Finder)", async () => {
    const p = join(dir, "report-alpha.txt");
    expect(await pick(p)).toEqual({ open: p });
    expect(await pick(p, "open")).toEqual({ open: p });
    expect(await pick(p, "copy")).toEqual({ copy: p });
  });

  test("trash of a missing file is a failure toast, palette kept", async () => {
    if (!(MAC ? Bun.which("osascript") : Bun.which("gio"))) return;
    const r = await pick(join(dir, "no-such-file.txt"), "trash");
    expect(r).toMatchObject({ keep: true, toast: { title: "Could not move to Trash", style: "failure" } });
  });
});
