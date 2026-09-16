// bookmarks against a temp JSON file named by the `file` setting.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../harness.ts";

const dir = mkdtempSync(join(tmpdir(), "pal-bm-"));
const file = join(dir, "bookmarks.json");
writeFileSync(file, JSON.stringify([
  { name: "Home Assistant", url: "http://ha.lan", keywords: ["ha", "home"], icon: "🏠" },
  { name: "GitHub", url: "https://github.com", subtitle: "code", icon: " " },
  { name: "Grafana", url: "http://grafana.lan/d/x" },
]));

let host: Host;
beforeAll(async () => { host = await Host.bundled({ settings: { bookmarks: { settings: { file } } } }); });
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("bookmarks", () => {
  test("rows come from the file: url as id, keywords, icon only when set, open and copy actions", async () => {
    const items = await host.list("bookmarks", "bookmarks");
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      id: "http://ha.lan", name: "Home Assistant", subtitle: "http://ha.lan", icon: "🏠", keywords: ["ha", "home"], url: "http://ha.lan",
      actions: [{ id: "open", title: "Open in browser" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }],
    });
    expect(items[1]).toMatchObject({ subtitle: "code", url: "https://github.com" });
    expect(items[1].icon).toBeUndefined();
    expect(items[2].keywords).toBeUndefined();
  });

  test("pick opens by default and copies on the copy action", async () => {
    expect(await host.pick("bookmarks", "bookmarks", "http://ha.lan")).toEqual({ open: "http://ha.lan" });
    expect(await host.pick("bookmarks", "bookmarks", "http://ha.lan", "open")).toEqual({ open: "http://ha.lan" });
    expect(await host.pick("bookmarks", "bookmarks", "http://ha.lan", "copy")).toEqual({ copy: "http://ha.lan" });
  });

  test("the file is read on every list, so an edit shows without a reload", async () => {
    writeFileSync(file, JSON.stringify([{ name: "Only", url: "http://only" }]));
    expect((await host.list("bookmarks", "bookmarks")).map((i) => i.name)).toEqual(["Only"]);
  });

  test("a missing file is an error reply, not a crash", async () => {
    host.changeSettings("bookmarks", { settings: { file: join(dir, "nope.json") } });
    const r = await host.call("list", { extension: "bookmarks", palette: "bookmarks" });
    expect(r.error).toMatch(/ENOENT|no such file/i);
    expect((await host.hello()).pid).toBe(host.pid);
  });
});
