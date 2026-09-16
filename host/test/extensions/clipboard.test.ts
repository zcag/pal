// clipboard against canned core/clipboard.* replies (harness fixtures).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Host, fixtures } from "../harness.ts";

let host: Host;
const calls = { pin: [] as unknown[], del: [] as unknown[], copy: [] as unknown[], clear: 0 };
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "clipboard.pin": (p) => { calls.pin.push(p); return null; },
      "clipboard.delete": (p) => { calls.del.push(p); return null; },
      "clipboard.copy": (p) => { calls.copy.push(p); return null; },
      "clipboard.clear": () => { calls.clear++; return null; },
    },
  });
});
afterAll(() => host.kill());

const list = (q?: string) => host.list("clipboard", "history", q);
const pick = (id: string, action?: string) => host.pick("clipboard", "history", id, action);

describe("clipboard", () => {
  test("meta: live input palette that opens with the detail pane", () => {
    expect(host.loaded().find((l) => l.extension === "clipboard")!.palettes).toEqual([
      { name: "history", title: "Clipboard History", live: true, input: true, icon: "⎘", placeholder: "Search clipboard history", showDetail: true },
    ]);
  });

  test("list asks core/clipboard.list with the query and its own page size", async () => {
    await list("hello");
    expect(host.coreCalls.at(-1)).toEqual({ method: "clipboard.list", params: { query: "hello", limit: 200 } });
  });

  test("rows: title, subtitle, icon per kind, accessories, url detection", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["1", "2", "3", "4", "5"]);
    const [text, multi, image, files, url] = items;
    expect(text).toMatchObject({ name: "hello world", icon: "≡", accessories: [{ text: "Chrome" }, { date: 1758000000000 }] });
    expect(text.subtitle).toBeUndefined();
    expect(multi).toMatchObject({ name: "line one", subtitle: "3 lines · line one line two line three", accessories: [{ text: "kitty" }, { date: 1758000001000 }, { tag: "pinned", color: "amber" }] });
    expect(image).toMatchObject({ name: "Image 640 x 480", icon: { image: "icon://localhost/clip?id=3&size=48" }, accessories: [{ date: 1758000002000 }] });
    expect(files).toMatchObject({ name: "a.txt, b.txt", subtitle: "2 files", icon: "▤", accessories: [{ text: "Finder" }, { date: 1758000003000 }] });
    expect(url).toMatchObject({ name: "https://example.com/page", url: "https://example.com/page", accessories: [{ text: "Safari" }, { date: 1758000004000 }] });
    expect(url.icon).toBeUndefined();
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

  test("actions: paste first by default, pin/unpin by state, destructive ones confirm", async () => {
    const [text, multi] = await list();
    expect(text.actions!.map((a) => a.id)).toEqual(["paste", "copy", "pin", "delete", "clear"]);
    expect(text.actions![2].title).toBe("Pin");
    expect(multi.actions![2].title).toBe("Unpin");
    const del = text.actions!.find((a) => a.id === "delete")!;
    expect(del).toEqual({ id: "delete", title: "Delete", shortcut: "cmd+d", style: "destructive", confirm: "Delete this entry from history?" });
    expect(text.actions!.find((a) => a.id === "clear")!.confirm).toMatch(/pinned ones included/);
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

  test("a core error on pick is the reply's error", async () => {
    const r = await host.call("pick", { extension: "clipboard", palette: "history", id: "99", action: "pin" });
    expect(r.error).toBe("no entry 99");
  });

  test("settings: primary_action copy reorders, exclude_apps drops rows; the retention keys are the recorder's, not a list filter", async () => {
    host.changeSettings("clipboard", { settings: { primary_action: "copy", exclude_apps: ["com.google.Chrome", "safari"], max_entries: 1, max_age_days: 1 } });
    const items = await list();
    expect(host.coreCalls.at(-1)).toEqual({ method: "clipboard.list", params: { query: "", limit: 200 } });
    expect(items.map((i) => i.id)).toEqual(["2", "3", "4"]);
    expect(items[0].actions!.map((a) => a.id).slice(0, 2)).toEqual(["copy", "paste"]);
    host.changeSettings("clipboard", {});
    expect(await list()).toHaveLength(fixtures.clipboard.length);
  });
});
