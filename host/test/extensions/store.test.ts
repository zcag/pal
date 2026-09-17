// store against a local stand-in for pal.cagdas.io's `/api/extensions`
// (store-fixture.json, five entries of the real answer, served by Bun and
// reached through `PAL_STORE_API`), with a canned `extensions.list`: calc
// bundled, timer installed from the store and behind, wordle installed
// from the store and current, github and gmail absent. The rows and their
// chips, the filters, the Updates section, the detail pane, the picks
// reaching the core, the cache (one fetch per hour, Refresh forces one),
// and the offline rows.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Item } from "../../../sdk/src/index.ts";
import { actionsFor, detail, newer, select, staleNote, trim, trimAll, type Listing } from "../../../extensions/store/store.ts";
import { Host, stored } from "../harness.ts";

const fixture = JSON.parse(readFileSync(join(import.meta.dir, "store-fixture.json"), "utf8"));
let fetches = 0;
let down = false;
const server = Bun.serve({
  port: 0,
  fetch() {
    fetches++;
    if (down) return new Response("nope", { status: 503 });
    return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
  },
});

const INSTALLED = [
  { name: "calc", version: "0.2.0", root: "/app/extensions", loaded: true, store: false, bundled: true },
  { name: "timer", version: "0.0.9", root: "/data/extensions", loaded: true, store: true, bundled: false },
  { name: "wordle", version: "0.1.0", root: "/data/extensions", loaded: true, store: true, bundled: false },
];
const storeCalls: { method: string; params: unknown }[] = [];

let host: Host;
beforeAll(async () => {
  process.env.PAL_STORE_API = `http://127.0.0.1:${server.port}/api/extensions`;
  host = await Host.bundled({
    core: {
      "extensions.list": () => INSTALLED,
      "extensions.install": (p: unknown) => { storeCalls.push({ method: "install", params: p }); return null; },
      "extensions.update": (p: unknown) => { storeCalls.push({ method: "update", params: p }); return null; },
      "extensions.remove": (p: unknown) => { storeCalls.push({ method: "remove", params: p }); return null; },
    },
  });
});
afterAll(() => { host?.kill(); server.stop(true); delete process.env.PAL_STORE_API; });

const list = (q?: string, ctx?: { filter?: string; refresh?: boolean }) => host.list("store", "store", q, ctx);
const pick = (id: string, action?: string) => host.pick("store", "store", id, action);
const tags = (i: Item) => (i.accessories ?? []).map((a) => ("tag" in a ? a.tag : "text" in a ? a.text : "")).filter(Boolean);
const names = (rows: Item[]) => rows.map((r) => r.id);

describe("the pure parts", () => {
  test("trim keeps what the rows and the pane need, and drops the rest", () => {
    const l = trim(fixture.extensions.find((e: { name: string }) => e.name === "timer"))!;
    expect(l.name).toBe("timer");
    expect(l.title).toBe("Timer");
    expect(l.tagline).toBeTruthy();
    expect(l.icon).toEqual(expect.objectContaining({ tile: expect.any(Object) }));
    expect(l.bar).toBe(true);
    expect(l.links).toBe(true);
    expect(l.multi).toBe(false);
    expect(l.category).toBe("productivity");
    expect(l.screenshots.length).toBeGreaterThan(0);
    expect(l.screenshots[0].url).toStartWith("https://pal.cagdas.io/");
    expect(l.palettes[0].keys.length).toBeGreaterThan(0);
    expect(JSON.stringify(l)).not.toContain('"settings"');
    expect(trim({})).toBeNull();
    expect(trimAll({ extensions: [{ name: "b", title: "B" }, { name: "a", title: "A" }] }).map((x) => x.name)).toEqual(["a", "b"]);
    expect(trimAll("junk")).toEqual([]);
  });
  test("newer compares dotted versions, never an unparseable pair as newer", () => {
    expect(newer("0.2.0", "0.1.9")).toBe(true);
    expect(newer("0.10.0", "0.9.0")).toBe(true);
    expect(newer("1.0.0", "1.0.0")).toBe(false);
    expect(newer("v1.0.1", "1.0.0")).toBe(true);
    expect(newer("", "1.0.0")).toBe(false);
    expect(newer("1.0.0-beta", "1.0.0")).toBe(false);
  });
  test("select honours the filter and every word of the query", () => {
    const all = trimAll(fixture);
    const inst = INSTALLED;
    expect(select(all, inst, "installed", "").map((l) => l.name)).toEqual(["calc", "timer", "wordle"]);
    expect(select(all, inst, "updates", "").map((l) => l.name)).toEqual(["timer"]);
    expect(select(all, inst, "fun", "").map((l) => l.name)).toEqual(["wordle"]);
    expect(select(all, inst, "all", "git hub").map((l) => l.name)).toEqual(["github"]);
    expect(select(all, inst, undefined, "pal productivity").map((l) => l.name)).toEqual(["calc", "timer"]);
  });
  test("actions follow the standing, the detail carries the facts", () => {
    const l = trimAll(fixture).find((x) => x.name === "timer")!;
    expect(actionsFor(l, { behind: false }).map((a) => a.id)).toEqual(["install", "page", "copy-command"]);
    expect(actionsFor(l, { installed: INSTALLED[1], behind: true }).map((a) => a.id)).toEqual(["update", "page", "remove", "copy-command"]);
    expect(actionsFor(l, { installed: INSTALLED[2], behind: false }).map((a) => a.id)).toEqual(["page", "update", "remove", "copy-command"]);
    expect(actionsFor(l, { installed: INSTALLED[0], behind: false }).map((a) => a.id)).toEqual(["page", "copy-command"]);
    const d = detail(l, { installed: INSTALLED[1], behind: true });
    expect(d.markdown).toContain("# Timer");
    expect(d.markdown).toContain("## What it does");
    expect(d.markdown).toContain("](https://pal.cagdas.io/extensions/timer/screenshots/");
    expect(d.markdown).toContain("| key | does |");
    expect(d.metadata).toContainEqual({ label: "Version", value: "0.1.0 (installed 0.0.9)" });
    expect(d.metadata).toContainEqual({ label: "Install", value: "pal install timer" });
    expect(d.metadata!.at(-1)).toEqual({ label: "Page", link: { text: "pal.cagdas.io", href: "https://pal.cagdas.io/extensions/timer" } });
    expect(staleNote(Date.now() - 5 * 60_000, Date.now())).toBe("Showing the list from 5 min ago");
    expect(staleNote(Date.now() - 3 * 3600_000, Date.now())).toBe("Showing the list from 3 hours ago");
  });
});

describe("store", () => {
  test("meta: an input palette with the filters", async () => {
    const meta = host.loaded().find((l) => l.extension === "store")!.palettes[0];
    expect(meta.input).toBe(true);
    expect(meta.tier).toBe("primary");
    expect(meta.filters!.map((f) => f.id)).toEqual(["all", "installed", "updates", "productivity", "developer", "system", "media", "reference", "fun", "integration"]);
    expect(meta.detail).toBe("lazy");
  });
  test("rows: every extension by title, the chips, the standing tags, what is behind under Updates first", async () => {
    const rows = await list();
    expect(fetches).toBe(1);
    expect(names(rows)).toEqual(["timer", "calc", "github", "gmail", "wordle"]);
    const timer = rows[0];
    expect(timer.section).toBe("Updates");
    expect(timer.name).toBe("Timer");
    expect(tags(timer)).toEqual(["menu bar", "links", "update to 0.1.0", "Productivity"]);
    expect(timer.actions!.map((a) => a.id)).toEqual(["update", "page", "remove", "copy-command"]);
    expect(timer.actions![0].confirm).toContain("Update Timer");
    const calc = rows[1];
    expect(calc.section).toBe("Extensions");
    expect(tags(calc)).toEqual(["bundled", "Productivity"]);
    expect(calc.actions!.map((a) => a.id)).toEqual(["page", "copy-command"]);
    expect(tags(rows[2])).toEqual(["menu bar", "accounts", "Developer"]);
    expect(rows[2].actions![0]).toMatchObject({ id: "install", confirm: "Install GitHub from pal.cagdas.io?" });
    expect(tags(rows[4])).toEqual(["installed", "Fun"]);
    expect(rows[4].icon).toEqual(expect.objectContaining({ tile: expect.any(Object) }));
    expect(rows[4].keywords).toContain("pal");
  });
  test("the query narrows, the filters narrow, nothing found says so", async () => {
    expect(names(await list("word"))).toEqual(["wordle"]);
    expect(names(await list("", { filter: "installed" }))).toEqual(["timer", "calc", "wordle"]);
    const updates = await list("", { filter: "updates" });
    expect(names(updates)).toEqual(["timer"]);
    expect(updates[0].section).toBeUndefined();
    expect(names(await list("", { filter: "integration" }))).toEqual(["gmail"]);
    const none = await list("zzz");
    expect(none).toHaveLength(1);
    expect(none[0].name).toContain("Nothing in the store matches");
    expect(none[0].actions).toEqual([]);
    expect(fetches).toBe(1);
  });
  test("the detail pane: description, features, screenshots, keys; the installed version beside the site's", async () => {
    const d = await host.detail("store", "store", "timer");
    expect(d.markdown).toContain("## What it does");
    expect(d.markdown).toMatch(/!\[.*\]\(https:\/\/pal\.cagdas\.io\/extensions\/timer\/screenshots\/.+\.png\)/);
    expect(d.markdown).toContain("| `");
    expect(d.metadata).toContainEqual({ label: "Version", value: "0.1.0 (installed 0.0.9)" });
    expect((await host.detail("store", "store", "calc")).metadata).toContainEqual({ label: "Version", value: "0.2.0, bundled" });
  });
  test("picks: install, update and remove reach the core and hide; the page opens; the command copies", async () => {
    expect(await pick("github")).toEqual({ hide: true });
    expect(storeCalls.pop()).toEqual({ method: "install", params: { spec: "github" } });
    expect(await pick("timer")).toEqual({ hide: true });
    expect(storeCalls.pop()).toEqual({ method: "update", params: { name: "timer" } });
    expect(await pick("wordle", "remove")).toEqual({ hide: true });
    expect(storeCalls.pop()).toEqual({ method: "remove", params: { name: "wordle" } });
    expect(await pick("wordle")).toEqual({ open: "https://pal.cagdas.io/extensions/wordle" });
    expect(await pick("calc", "page")).toEqual({ open: "https://pal.cagdas.io/extensions/calc" });
    expect(await pick("calc", "copy-command")).toEqual({ copy: "pal install calc", hud: "Copied pal install calc" });
    await expect(pick("nope")).rejects.toThrow("no extension nope");
  });
  test("the cache: stored once, reused across listings, refetched on Refresh", async () => {
    const c = stored.get("store\0cache") as { fetched_at: number; listings: Listing[] };
    expect(c.listings).toHaveLength(5);
    expect(JSON.stringify(c).length).toBeLessThan(256 * 1024);
    await list();
    expect(fetches).toBe(1);
    await list("", { refresh: true });
    expect(fetches).toBe(2);
  });
  test("offline: the stale list with a note leads; with no list at all, one row says so", async () => {
    down = true;
    const rows = await list("", { refresh: true });
    expect(fetches).toBe(3);
    expect(rows[0].name).toMatch(/^Showing the list from \d+ min ago$/);
    expect(rows[0].subtitle).toContain("503");
    expect(rows[0].actions).toEqual([]);
    expect(names(rows).slice(1)).toEqual(["timer", "calc", "github", "gmail", "wordle"]);
    expect(names(await list())).toEqual(["timer", "calc", "github", "gmail", "wordle"]);
    down = false;
  });
});

describe("store with nothing cached", () => {
  test("an unreachable site with no list yet is one hint row", async () => {
    stored.delete("store\0cache");
    const port = server.port;
    process.env.PAL_STORE_API = "http://127.0.0.1:1/api/extensions";
    const fresh = await Host.bundled({ core: { "extensions.list": () => INSTALLED } });
    try {
      const rows = await fresh.list("store", "store");
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("pal.cagdas.io is not reachable");
      expect(rows[0].actions).toEqual([]);
    } finally {
      fresh.kill();
      process.env.PAL_STORE_API = `http://127.0.0.1:${port}/api/extensions`;
    }
  });
});
