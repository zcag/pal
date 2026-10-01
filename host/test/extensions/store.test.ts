// store against a canned core: `store.state` answers store-fixture.json
// (pal's registry and acme's; calc comes with pal, timer has an update
// that waits, wordle is current, todo from acme needs a newer pal, github
// and gmail are absent, dpi is not for this platform), `store.refresh`
// the same after counting the fetch, and install, update and remove are
// recorded and answered. The rows and their tags, the Featured and category
// sections, the filters (Registries included), the Updates section, the
// detail pane, the picks reaching the core and saying how they went, the
// cached rows streamed before a fetch, a registry that did not answer, a
// fetch that failed, and no registry yet.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Item, StoreResult, StoreState } from "../../../sdk/src/index.ts";
import { actionsFor, detail, featured, registryRows, select, shelves, staleNote, standings, targetOf } from "../../../extensions/store/store.ts";
import { Host } from "../harness.ts";

const fixture: StoreState = JSON.parse(readFileSync(join(import.meta.dir, "store-fixture.json"), "utf8"));
let state: StoreState = fixture;
let refreshes = 0;
let refreshFails: string | null = null;
let answer: (name: string) => StoreResult = (name) => ({ name, ok: true, loaded: true });
const calls: { method: string; params: any }[] = [];

let host: Host;
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "store.state": () => state,
      "store.refresh": () => { refreshes++; if (refreshFails) throw new Error(refreshFails); return state; },
      "store.install": (p: any) => { calls.push({ method: "install", params: p }); return answer(p.name); },
      "store.update": (p: any) => { calls.push({ method: "update", params: p }); return p.names.map(answer); },
      "store.remove": (p: any) => { calls.push({ method: "remove", params: p }); return answer(p.name); },
    },
  });
});
afterAll(() => host?.kill());

const list = (q?: string, ctx?: { filter?: string; refresh?: boolean }) => host.list("store", "store", q, ctx);
const pick = (id: string, action?: string, ctx?: { ids?: string[] }) => host.pick("store", "store", id, action, ctx);
const tags = (i: Item) => (i.accessories ?? []).map((a) => ("tag" in a ? a.tag : "text" in a ? a.text : "")).filter(Boolean);
const ids = (rows: Item[]) => rows.map((r) => r.id);
const NOW = 1790000000 * 1000 + 5 * 60_000;

describe("the pure parts", () => {
  const all = standings(fixture);
  const of = (name: string) => all.find((s) => s.a.name === name)!;
  test("each listed extension stands as the core says: its status, ours or not; nothing compared here", () => {
    expect(of("timer").status?.state).toBe("update");
    expect(targetOf(of("timer").status)?.hash).toBe("7272727272727272");
    expect(of("calc").status?.origin).toBe("bundled");
    expect(of("github").status).toBeUndefined();
    expect(of("todo").ours).toBe(false);
    expect(of("calc").ours).toBe(true);
  });
  test("select honours the filter and every word of the query", () => {
    const names = (f: string | undefined, q = "") => select(all, f, q).map((s) => s.a.name);
    expect(names("installed")).toEqual(["calc", "timer", "todo", "wordle"]);
    expect(names("updates")).toEqual(["timer"]);
    expect(names("fun")).toEqual(["wordle"]);
    expect(names("all", "pull")).toEqual(["github"]);
    expect(names(undefined, "acme")).toEqual(["todo"]);
    expect(names(undefined, "pal productivity")).toEqual(["calc", "timer"]);
  });
  test("actions follow the standing", () => {
    const a = (name: string) => actionsFor(of(name)).map((x) => x.id);
    expect(a("github")).toEqual(["install", "page", "copy-command"]);
    expect(actionsFor(of("github"))[0].confirm).toBe("Install from the pal registry?");
    expect(a("timer")).toEqual(["update", "open", "page", "remove", "copy-command"]);
    expect(a("wordle")).toEqual(["open", "page", "remove", "copy-command"]);
    // Comes with pal: turned off in Settings, never removed from here.
    expect(a("calc")).toEqual(["open", "page", "copy-command"]);
    expect(a("dpi")).toEqual(["page", "copy-command"]);
    // A third party's: no site page; the confirm names where it updates from.
    expect(a("todo")).toEqual(["open", "remove", "copy-command"]);
    expect(actionsFor({ ...of("todo"), a: { ...of("todo").a, installed: false }, status: undefined })[0].confirm).toBe("Install from acme? It updates from there.");
  });
  test("the detail carries the listing and the facts", () => {
    const d = detail(of("timer"));
    expect(d.markdown).toContain("# Timer");
    expect(d.markdown).toContain("## Palettes");
    expect(d.markdown).toContain("![Running timers](https://pal.cagdas.io/extensions/timer/screenshots/1-list.png)");
    expect(d.markdown).toContain("](https://pal.cagdas.io/extensions/timer/screenshots/2-bar.png)");
    expect(d.metadata).toContainEqual({ label: "Status", value: "Update ready: 7272727 (2026-09-15)" });
    expect(d.metadata).toContainEqual({ label: "Build", value: "7171717 (2026-08-29)" });
    expect(d.metadata).toContainEqual({ label: "Updates", value: "Wait for you" });
    expect(d.metadata).toContainEqual({ label: "From", value: "The pal registry" });
    expect(d.metadata!.at(-1)).toEqual({ label: "Page", link: { text: "pal.cagdas.io", href: "https://pal.cagdas.io/extensions/timer" } });
    expect(detail(of("gmail")).markdown).toContain("Installing it installs browser-tabs first.");
    expect(detail(of("dpi")).metadata).toContainEqual({ label: "Status", value: "Not for this platform" });
    expect(detail(of("calc")).metadata).toContainEqual({ label: "From", value: "Comes with pal" });
    expect(detail(of("todo")).metadata).toContainEqual({ label: "Status", value: "Its next build needs a newer pal" });
    // What it does: the listing's features when the index has them (an older one has none).
    expect(d.markdown).not.toContain("## What it does");
    const withFeatures = { ...of("timer"), a: { ...of("timer").a, listing: { ...of("timer").a.listing, features: ["Named countdowns", "A `pomodoro` cycle"] } } };
    expect(detail(withFeatures).markdown).toContain("## What it does\n\n- Named countdowns\n- A `pomodoro` cycle");
  });
  test("Featured: the first three of the list not installed that install here; shelves by the filter's order, what is not installed first", () => {
    expect(featured(all).map((s) => s.a.name)).toEqual(["github"]);
    expect(shelves(all).map((s) => [s.title, s.rows.map((x) => x.a.name)])).toEqual([["Productivity", ["calc", "timer", "todo"]], ["Developer", ["github"]], ["System", ["dpi"]], ["Fun", ["wordle"]], ["Integration", ["gmail"]]]);
  });
  test("the registries: one row each and one to add, the stale note says why and how old", () => {
    const rows = registryRows(fixture.registries, NOW);
    expect(ids(rows)).toEqual(["registry:pal", "registry:acme", "registry:add"]);
    expect(rows[0].subtitle).toBe("6 extensions, checked 5 min ago");
    const down = { ...fixture.registries[1], last_error: "unreachable: connection refused" };
    expect(registryRows([down], NOW)[0].subtitle).toBe("Unreachable: connection refused; last worked 3 hours ago");
    expect(staleNote(down, NOW)).toBe("acme: unreachable: connection refused; showing its list from 3 hours ago");
  });
});

describe("store", () => {
  test("meta: an input palette with the filters", () => {
    const meta = host.loaded().find((l) => l.extension === "store")!.palettes[0];
    expect(meta.input).toBe(true);
    expect(meta.tier).toBe("primary");
    expect(meta.filters!.map((f) => f.id)).toEqual(["all", "installed", "updates", "registries", "productivity", "developer", "system", "media", "reference", "fun", "integration"]);
    expect(meta.detail).toBe("lazy");
  });
  test("the first listing fetches every registry, the cached rows shown first; later ones reuse it until Refresh", async () => {
    const { items, partials } = await host.listStream("store", "store", "");
    expect(refreshes).toBe(1);
    expect(partials).toHaveLength(1);
    expect(ids(partials[0])).toEqual(ids(items));
    await list("git");
    expect(refreshes).toBe(1);
    const again = await host.listStream("store", "store", "", { refresh: true });
    expect(refreshes).toBe(2);
    expect(again.partials).toHaveLength(1);
    // A fetch stands for ten minutes (store REFRESH_MS), told apart by Date.now, so by a second: the real time the test takes moves it too.
    await host.advance(10 * 60_000 - 1000);
    await list("");
    expect(refreshes).toBe(2);
    await host.advance(1000);
    await list("");
    expect(refreshes).toBe(3);
  });
  test("rows: what has an update under Updates first, then Featured, then a section per category, what is not installed leading each", async () => {
    const rows = await list();
    expect(ids(rows)).toEqual(["pal/timer", "featured:pal/github", "pal/calc", "acme/todo", "pal/github", "pal/dpi", "pal/wordle", "pal/gmail"]);
    expect(rows.map((r) => r.section)).toEqual(["Updates", "Featured", "Productivity", "Productivity", "Developer", "System", "Fun", "Integration"]);
    expect(tags(rows[0])).toEqual(["update", "Productivity"]);
    // Featured and shelf rows: the section names the shelf, so the row does not.
    expect(tags(rows[1])).toEqual(["Developer"]);
    expect(tags(rows[2])).toEqual(["comes with pal"]);
    expect(tags(rows[3])).toEqual(["needs a newer pal", "acme"]);
    expect(tags(rows[4])).toEqual([]);
    expect(tags(rows[5])).toEqual(["not for this platform"]);
    expect(tags(rows[6])).toEqual(["installed"]);
    expect(rows[4].icon).toEqual(expect.objectContaining({ tile: expect.any(Object) }));
    // A Featured row acts, and shows, as its extension.
    expect(await host.detail("store", "store", "featured:pal/github")).toEqual(await host.detail("store", "store", "pal/github"));
    calls.length = 0;
    expect(await pick("featured:pal/github", "install", { ids: ["featured:pal/github", "pal/github"] })).toEqual({ keep: true, toast: { title: "Installed GitHub" } });
    expect(calls).toEqual([{ method: "install", params: { name: "github", registry: "pal", from: "store" } }]);
  });
  test("a search lists one run of rows, the title's matches first; a filter too", async () => {
    const rows = await list("pal");
    expect(rows.every((r) => r.section === undefined || r.section === "Updates" || r.section === "Extensions")).toBe(true);
    expect(tags((await list("calc"))[0])).toEqual(["comes with pal", "Productivity"]);
  });
  test("the query and the filters narrow, nothing found says so, Registries lists the registries", async () => {
    expect(ids(await list("word"))).toEqual(["pal/wordle"]);
    expect(ids(await list("", { filter: "installed" }))).toEqual(["pal/timer", "pal/calc", "acme/todo", "pal/wordle"]);
    const updates = await list("", { filter: "updates" });
    expect(ids(updates)).toEqual(["pal/timer"]);
    expect(updates[0].section).toBeUndefined();
    expect(ids(await list("", { filter: "integration" }))).toEqual(["pal/gmail"]);
    const none = await list("zzz");
    expect(none).toHaveLength(1);
    expect(none[0].name).toContain("Nothing listed matches");
    expect(none[0].actions).toEqual([]);
    expect(ids(await list("", { filter: "registries" }))).toEqual(["registry:pal", "registry:acme", "registry:add"]);
    expect(ids(await list("acme", { filter: "registries" }))).toEqual(["registry:acme"]);
  });
  test("the detail pane", async () => {
    const d = await host.detail("store", "store", "pal/timer");
    expect(d.markdown).toContain("# Timer");
    expect(d.metadata).toContainEqual({ label: "Updates", value: "Wait for you" });
  });
  test("picks: install, update and remove wait for the core and say how it went; the list stays and relists", async () => {
    calls.length = 0;
    expect(await pick("pal/github")).toEqual({ keep: true, toast: { title: "Installed GitHub" } });
    expect(calls.pop()).toEqual({ method: "install", params: { name: "github", registry: "pal", from: "store" } });
    expect(await pick("pal/timer")).toEqual({ keep: true, toast: { title: "Updated Timer" } });
    expect(calls.pop()).toEqual({ method: "update", params: { names: ["timer"], from: "store" } });
    expect(await pick("pal/wordle", "remove")).toEqual({ keep: true, toast: { title: "Removed Wordle" } });
    expect(calls.pop()).toEqual({ method: "remove", params: { name: "wordle", forget: false } });
    expect(await pick("pal/wordle")).toEqual({ push: { extension: "wordle", palette: "wordle" } });
    expect(await pick("pal/calc", "page")).toEqual({ open: "https://pal.cagdas.io/extensions/calc" });
    expect(await pick("pal/calc", "copy-command")).toEqual({ copy: "pal install calc", hud: "Copied pal install calc" });
    expect(await pick("registry:add")).toEqual({ open: "pal://settings/extensions?anchor=extensions:registries" });
    await expect(pick("pal/nope")).rejects.toThrow("no extension pal/nope");
    // Marked extensions: each reaches the core, in one update or in turn; the pages open, the commands copy one per line.
    expect(await pick("pal/github", "install", { ids: ["pal/github", "pal/gmail"] })).toEqual({ keep: true, toast: { title: "Installed 2 extensions" } });
    expect(calls.slice(-2).map((c) => c.params.name)).toEqual(["github", "gmail"]);
    expect(await pick("pal/timer", "update", { ids: ["pal/timer", "pal/wordle"] })).toEqual({ keep: true, toast: { title: "Updated 2 extensions" } });
    expect(calls.at(-1)).toEqual({ method: "update", params: { names: ["timer", "wordle"], from: "store" } });
    expect(await pick("pal/calc", "page", { ids: ["pal/calc", "pal/wordle"] })).toEqual({ open: ["https://pal.cagdas.io/extensions/calc", "https://pal.cagdas.io/extensions/wordle"] });
  });
  test("a failure says which and why, and one that installed but failed to load says so too", async () => {
    answer = (name) => (name === "gmail" ? { name, ok: false, error: "offline: pal.cagdas.io is not reachable" } : { name, ok: true, loaded: false, error: "SyntaxError at index.ts:3" });
    try {
      expect(await pick("pal/gmail")).toEqual({ keep: true, toast: { style: "failure", title: "Could not install Gmail", message: "offline: pal.cagdas.io is not reachable" } });
      expect(await pick("pal/github")).toEqual({ keep: true, toast: { style: "failure", title: "Could not install GitHub", message: "SyntaxError at index.ts:3" } });
    } finally {
      answer = (name) => ({ name, ok: true, loaded: true });
    }
  });
  test("a registry that did not answer, and a fetch that failed, lead the rows; the cached list still shows", async () => {
    state = { ...fixture, registries: [fixture.registries[0], { ...fixture.registries[1], last_error: "unreachable: connection refused" }] };
    refreshFails = "the core could not fetch";
    try {
      const rows = await list("", { refresh: true });
      expect(rows[0]).toMatchObject({ id: "hint:refresh", name: "Could not check the registries", subtitle: "the core could not fetch" });
      expect(rows[1].name).toMatch(/^acme: unreachable: connection refused; showing its list from/);
      expect(rows[1].actions).toEqual([]);
      expect(ids(rows).slice(2)).toContain("pal/github");
    } finally {
      state = fixture;
      refreshFails = null;
    }
  });
  test("no registry answered yet: one row says so", async () => {
    state = { ...fixture, available: [] };
    try {
      const rows = await list();
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("No registry has answered yet");
    } finally {
      state = fixture;
    }
  });
});
