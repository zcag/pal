// apps against this Mac: the real application folders.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { Host } from "../harness.ts";

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

describe("apps", () => {
  test("loads with one palette and the manifest's folders setting", async () => {
    const l = host.loaded().find((l) => l.extension === "apps")!;
    expect(l.palettes).toEqual([{ name: "apps", title: "Applications", live: false, input: false }]);
    expect(l.manifest.settings?.map((s) => s.id)).toEqual(["folders"]);
  });

  test("lists the installed apps, Google Chrome among them, with existing .app icons and bundle ids as keywords", async () => {
    const items = await host.list("apps", "apps");
    expect(items.length).toBeGreaterThan(20);
    const chrome = items.find((i) => i.name === "Google Chrome")!;
    expect(chrome).toBeDefined();
    expect(chrome.id).toBe("/Applications/Google Chrome.app");
    expect(chrome.icon).toEqual({ app: "/Applications/Google Chrome.app" });
    expect(chrome.keywords).toEqual(["com.google.Chrome"]);
    expect(chrome.subtitle).toBe("Applications");
    for (const i of items) expect(existsSync((i.icon as { app: string }).app), i.name).toBe(true);
    expect(items.map((i) => i.name)).toEqual([...items.map((i) => i.name)].sort((a, b) => a.localeCompare(b)));
    expect(new Set(items.map((i) => i.name.toLowerCase())).size).toBe(items.length);
  });

  test("the scan is cached: a second list is the same and asks nothing of the core", async () => {
    const calls = host.coreCalls.length;
    const a = await host.list("apps", "apps");
    const b = await host.list("apps", "apps");
    expect(b).toEqual(a);
    expect(host.coreCalls.length).toBe(calls);
  });

  test("pick opens the bundle", async () => {
    expect(await host.pick("apps", "apps", "/Applications/Google Chrome.app")).toEqual({ open: "/Applications/Google Chrome.app" });
  });

  test("a folders change drops the cache and the extra folder's apps show up", async () => {
    const before = await host.list("apps", "apps");
    host.changeSettings("apps", { settings: { folders: ["/System/Library/CoreServices"] } });
    const after = await host.list("apps", "apps");
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.find((i) => i.name === "Finder")).toMatchObject({ subtitle: "/System/Library/CoreServices" });
  });
});
