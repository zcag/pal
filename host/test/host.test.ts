// The host over the wire: load reports, errors, hot reload, the request
// envelope, the detail cache, ctx, the reverse core path, and exit on EOF.
// One host per describe block against a throwaway root.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { API, Host, Root, manifest, simpleExt } from "./harness.ts";

describe("loading", () => {
  let root: Root;
  let host: Host;
  beforeAll(async () => {
    root = new Root({
      good: {
        "index.ts": simpleExt("main", { extra: `icon: "★", view: "grid", columns: 6, placeholder: "Type", live: true, showDetail: true, filters: [{ id: "all", title: "All" }, { id: "some", title: "Some" }],`, detail: `() => ({ markdown: "d" })` }),
        "pal.json": manifest("good", { title: "Good", description: "fixture", settings: [{ kind: "text", id: "greeting", label: "Greeting", default: "hi" }], palettes: { main: { title: "Main" } } }),
      },
      bare: { "index.ts": simpleExt("bare") },
      badjson: { "index.ts": simpleExt("badjson"), "pal.json": "{ not json" },
      renamed: { "index.ts": simpleExt("renamed"), "pal.json": manifest("other-name", { title: "Renamed" }) },
      broken: { "index.ts": "export default { palettes: { x: {\n  list: () => [{{{\n" },
      nopalettes: { "index.ts": "export default { nothing: true };" },
      notext: { "README.md": "not an extension" },
      // An installed extension imports the API by its bare name (docs/extensions.md).
      bare_import: { "index.ts": `import { settings, type Extension } from "pal";\nexport default { palettes: { p: { list: () => [{ id: "a", name: String(settings.get().greeting) }], pick: () => {} } } } satisfies Extension;`, "pal.json": manifest("bare_import", { settings: [{ kind: "text", id: "greeting", label: "G", default: "hey" }] }) },
    });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("`pal` resolves to the host's api.ts through <root>/node_modules/pal, which the host links", async () => {
    const h = await host.hello();
    expect(h.extensions.find((e) => e.name === "bare_import")?.loaded).toBe(true);
    expect(await host.list("bare_import", "p")).toEqual([{ id: "a", name: "hey" }]);
  });

  test("hello: version, bun, pid, roots, every extension with its manifest and load state, errors", async () => {
    const h = await host.hello();
    expect(h.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(h.bun).toBe(Bun.version);
    expect(h.pid).toBe(host.pid);
    expect(h.roots).toEqual([root.dir]);
    const names = h.extensions.map((e) => e.name).sort();
    expect(names).toEqual(["badjson", "bare", "bare_import", "broken", "good", "nopalettes", "renamed"]);
    const good = h.extensions.find((e) => e.name === "good")!;
    expect(good.loaded).toBe(true);
    expect(good.root).toBe(root.dir);
    expect(good.manifest.title).toBe("Good");
    expect(good.palettes.map((p) => p.name)).toEqual(["main"]);
    expect(h.extensions.find((e) => e.name === "broken")!.loaded).toBe(false);
    expect(h.extensions.find((e) => e.name === "broken")!.palettes).toEqual([]);
    expect(Object.keys(h.errors).sort()).toEqual(["broken", "nopalettes"]);
  });

  test("extension/loaded carries the manifest and the palette meta", () => {
    const l = host.loaded().find((l) => l.extension === "good")!;
    expect(l.root).toBe(root.dir);
    expect(l.manifest).toEqual({ name: "good", title: "Good", description: "fixture", settings: [{ kind: "text", id: "greeting", label: "Greeting", default: "hi" }], palettes: { main: { title: "Main" } } });
    expect(l.palettes).toEqual([{
      name: "main", title: "main", live: true, input: false, icon: "★", view: "grid", columns: 6, placeholder: "Type", showDetail: true,
      filters: [{ id: "all", title: "All" }, { id: "some", title: "Some" }], detail: "lazy",
    }]);
    const bare = host.loaded().find((l) => l.extension === "bare")!;
    expect(bare.palettes[0]).toMatchObject({ name: "bare", title: "bare", live: false, input: false });
    expect(bare.palettes[0].detail).toBeUndefined();
  });

  test("manifest: missing pal.json gives a bare one, broken JSON too (logged), the dir name wins over the file's", () => {
    const by = Object.fromEntries(host.loaded().map((l) => [l.extension, l.manifest]));
    expect(by.bare).toEqual({ name: "bare", title: "bare" });
    expect(by.badjson).toEqual({ name: "badjson", title: "badjson" });
    expect(host.stderr).toContain(`bad manifest ${root.path("badjson", "pal.json")}`);
    expect(by.renamed).toEqual({ name: "renamed", title: "Renamed" });
  });

  test("settings.get is asked per extension with its manifest before the code runs", () => {
    const asked = host.coreCalls.filter((c) => c.method === "settings.get").map((c) => (c.params as any).extension).sort();
    expect(asked).toEqual(["badjson", "bare", "bare_import", "broken", "good", "nopalettes", "renamed"]);
    expect((host.coreCalls.find((c) => (c.params as any)?.extension === "good")!.params as any).manifest.title).toBe("Good");
  });

  test("a syntax error is reported as extension/error with file:line, the others serve", async () => {
    const f = host.failed().find((f) => f.extension === "broken")!;
    expect(f.message).toContain(`${root.path("broken")}:2:`);
    expect(f.manifest).toEqual({ name: "broken", title: "broken" });
    expect(host.failed().find((f) => f.extension === "nopalettes")!.message).toBe("default export has no palettes");
    expect(await host.list("good", "main")).toEqual([{ id: "a", name: "A" }]);
    const r = await host.call("list", { extension: "broken", palette: "x" });
    expect(r.error).toContain("Expected");
  });

  test("a dir without index.ts is not an extension; an unknown extension or palette is an error reply", async () => {
    expect((await host.call("list", { extension: "notext", palette: "x" })).error).toBe("no extension notext");
    expect((await host.call("list", { extension: "good", palette: "nope" })).error).toBe("no palette good/nope");
    expect((await host.call("nosuch", {})).error).toBe("unknown method nosuch");
  });

  test("hot reload: editing a file re-imports it and announces extension/loaded again", async () => {
    const reloaded = host.next("extension/loaded", (p) => p.extension === "bare");
    root.write("bare", "index.ts", simpleExt("bare", { list: `() => [{ id: "b", name: "B2" }]` }));
    await reloaded;
    expect(await host.list("bare", "bare")).toEqual([{ id: "b", name: "B2" }]);
  });

  test("hot reload: a fixed extension comes back, a broken one leaves", async () => {
    const fixed = host.next("extension/loaded", (p) => p.extension === "broken");
    root.write("broken", "index.ts", simpleExt("x"));
    await fixed;
    expect(await host.list("broken", "x")).toEqual([{ id: "a", name: "A" }]);
    const broke = host.next("extension/error", (p) => p.extension === "bare");
    root.write("bare", "index.ts", "export default {{{");
    expect(((await broke).params as any).message).toContain("index.ts:1:");
    expect((await host.call("list", { extension: "bare", palette: "bare" })).error).toContain("index.ts:1:");
    expect((await host.hello()).errors.bare).toBeDefined();
  });

  test("a line that is not JSON is logged and skipped; a stray reply is logged; a notification gets no reply", async () => {
    host.writeRaw("this is not json\n");
    await host.untilStderr("bad json");
    host.writeRaw(JSON.stringify({ id: 9999, result: 1 }) + "\n");
    await host.untilStderr("stray reply 9999");
    const before = host.notifications.length;
    host.notify("settings/changed", { extensions: {} });
    expect(await host.list("good", "main")).toHaveLength(1);
    expect(host.notifications.length).toBe(before);
    expect(host.garbage).toEqual([]);
  });
});

describe("serving", () => {
  let root: Root;
  let host: Host;
  beforeAll(async () => {
    root = new Root({
      ext: {
        "index.ts": `
import { core, settings } from "${API}";
console.log("import-time stdout");
let details = 0;
export default { palettes: {
  main: {
    list: (query, ctx) => { console.log("list-time stdout"); console.info("info too"); return [{ id: "q", name: query ?? "", ctx: ctx ?? null }]; },
    pick: (id, action, ctx) => { if (id === "throw") throw new Error("boom"); return { id, action: action ?? null, ctx: ctx ?? null }; },
    detail: (id, ctx) => ({ markdown: \`\${id} \${JSON.stringify(ctx?.args ?? null)} #\${++details}\` }),
  },
  bad: { list: () => ({ not: "an array" }), pick: () => {} },
  nodetail: { list: () => [], pick: () => {} },
  echo: {
    list: async () => [{ id: "x", name: JSON.stringify(await core.call("echo.reverse", { s: "abc" })) }],
    pick: async (id) => { try { return { got: await core.call("echo.fail") }; } catch (e) { return { failed: e.message }; } },
    detail: async () => { throw new Error("no detail"); },
  },
} };`,
      },
    });
    host = await Host.start({
      roots: [root.dir],
      core: { "echo.reverse": ({ s }) => ({ s: [...s].reverse().join("") }), "echo.fail": () => { throw new Error("core says no"); } },
    });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("console.log in an extension goes to stderr, never into the protocol", async () => {
    await host.hello();
    expect(await host.list("ext", "main", "x")).toHaveLength(1);
    expect(host.garbage).toEqual([]);
    expect(host.stderr).toContain("import-time stdout");
    expect(host.stderr).toContain("list-time stdout");
    expect(host.stderr).toContain("info too");
  });

  test("a pick that throws answers {id, error}", async () => {
    const r = await host.call("pick", { extension: "ext", palette: "main", id: "throw" });
    expect(r).toEqual({ id: r.id, error: "boom" });
  });

  test("a pick that returns nothing answers {}", async () => {
    expect(await host.pick("ext", "bad", "x")).toEqual({});
  });

  test("a list that returns a non-array is an error", async () => {
    const r = await host.call("list", { extension: "ext", palette: "bad" });
    expect(r.error).toMatch(/array/);
  });

  test("filter and args reach list, pick and detail as ctx; absent ones make ctx undefined", async () => {
    expect(await host.list("ext", "main", "hello", { filter: "f1", args: { n: 1 } })).toEqual([{ id: "q", name: "hello", ctx: { filter: "f1", args: { n: 1 } } }]);
    expect(await host.list("ext", "main")).toEqual([{ id: "q", name: "", ctx: null }]);
    expect(await host.pick("ext", "main", "i", "act", { filter: "f2" })).toEqual({ id: "i", action: "act", ctx: { filter: "f2" } });
    expect(await host.pick("ext", "main", "i")).toEqual({ id: "i", action: null, ctx: null });
    expect(await host.detail("ext", "main", "d", { args: [1] })).toMatchObject({ markdown: expect.stringContaining("d [1]") });
  });

  test("detail is cached per item and args until the palette lists again", async () => {
    await host.list("ext", "main");
    const first = await host.detail("ext", "main", "k");
    expect(await host.detail("ext", "main", "k")).toEqual(first);
    const other = await host.detail("ext", "main", "k", { args: { a: 1 } });
    expect(other).not.toEqual(first);
    expect(await host.detail("ext", "main", "k", { args: { a: 1 } })).toEqual(other);
    await host.list("ext", "main");
    const again = await host.detail("ext", "main", "k");
    expect(again).not.toEqual(first);
    expect(again.markdown).toMatch(/#\d+$/);
  });

  test("detail on a palette without one answers {}; a throwing detail is an error and not cached", async () => {
    expect(await host.detail("ext", "nodetail", "x")).toEqual({});
    expect((await host.call("detail", { extension: "ext", palette: "echo", id: "x" })).error).toBe("no detail");
    expect((await host.call("detail", { extension: "ext", palette: "echo", id: "x" })).error).toBe("no detail");
  });

  test("the reverse core/* path round-trips a result and an error", async () => {
    expect(await host.list("ext", "echo")).toEqual([{ id: "x", name: '{"s":"cba"}' }]);
    expect(host.coreCalls.find((c) => c.method === "echo.reverse")).toEqual({ method: "echo.reverse", params: { s: "abc" } });
    expect(await host.pick("ext", "echo", "x")).toEqual({ failed: "core says no" });
  });
});

describe("lifecycle", () => {
  test("stdin closed: the host exits 0 even with the watcher running", async () => {
    const root = new Root({ e: { "index.ts": simpleExt("e") } });
    const host = await Host.start({ roots: [root.dir] });
    const t0 = performance.now();
    expect(await host.close()).toBe(0);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(host.stderr).toContain("stdin closed");
    root.rm();
  });

  test("a missing root is skipped; later roots win a name clash", async () => {
    const a = new Root({ dup: { "index.ts": simpleExt("dup", { list: `() => [{ id: "from", name: "a" }]` }) }, onlya: { "index.ts": simpleExt("onlya") } });
    const b = new Root({ dup: { "index.ts": simpleExt("dup", { list: `() => [{ id: "from", name: "b" }]` }) } });
    const host = await Host.start({ roots: ["/nonexistent/root", a.dir, b.dir] });
    expect((await host.list("dup", "dup"))[0].name).toBe("b");
    expect(await host.list("onlya", "onlya")).toHaveLength(1);
    expect(host.loaded().find((l) => l.extension === "dup")!.root).toBe(b.dir);
    host.kill();
    a.rm(); b.rm();
  });
});
