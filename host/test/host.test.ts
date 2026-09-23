// The host over the wire: load reports, errors, hot reload, the request
// envelope, the detail cache, ctx, the reverse core path, the bar items'
// requests and limits, and exit on EOF.
// One host per describe block against a throwaway root.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { BarItem, BarMeta } from "../../sdk/src/protocol.ts";
import { API, HOST, Host, Root, manifest, simpleExt } from "./harness.ts";

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
      // An installed extension imports the API by its package name (docs/extensions.md).
      bare_import: { "index.ts": `import { settings, type Extension } from "@zcag/pal";\nexport default { palettes: { p: { list: () => [{ id: "a", name: String(settings.get().greeting) }], pick: () => {} } } } satisfies Extension;`, "pal.json": manifest("bare_import", { settings: [{ kind: "text", id: "greeting", label: "G", default: "hey" }] }) },
    });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("`@zcag/pal` resolves to the SDK through <root>/node_modules/@zcag/pal, which the host links", async () => {
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

  test("extension/loaded carries the manifest and the palette meta; the manifest's title wins over the code's", () => {
    const l = host.loaded().find((l) => l.extension === "good")!;
    expect(l.root).toBe(root.dir);
    expect(l.manifest).toEqual({ name: "good", title: "Good", description: "fixture", settings: [{ kind: "text", id: "greeting", label: "Greeting", default: "hi" }], palettes: { main: { title: "Main" } } });
    expect(l.palettes).toEqual([{
      name: "main", title: "Main", live: true, input: false, icon: "★", view: "grid", columns: 6, placeholder: "Type", showDetail: true,
      filters: [{ id: "all", title: "All" }, { id: "some", title: "Some" }], detail: "lazy",
    }]);
    // The code says "main", the manifest "Main": a warning, and the manifest's is served.
    expect(l.warnings).toEqual(['palettes.main: title "main" in the code, "Main" in pal.json; the manifest\'s is used, drop the code\'s']);
    expect(host.stderr).toContain('[good] manifest: palettes.main: title "main" in the code');
    const bare = host.loaded().find((l) => l.extension === "bare")!;
    expect(bare.palettes[0]).toMatchObject({ name: "bare", title: "bare", live: false, input: false });
    expect(bare.palettes[0].detail).toBeUndefined();
    // No manifest at all: nothing to disagree with.
    expect(bare.warnings).toEqual([]);
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
    pick: (id, action, ctx) => { if (id === "throw") throw new Error("boom"); if (id === "badform") return { form: { title: "x", fields: [], submit: { id: "s", title: "S" } } }; return { id, action: action ?? null, ctx: ctx ?? null }; },
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

  test("a form's values reach pick as ctx.values (null, as the core sends when there are none, makes no ctx); a bad form answer is refused", async () => {
    expect(await host.pick("ext", "main", "f", "save", { values: { name: "x", pin: true } })).toEqual({ id: "f", action: "save", ctx: { values: { name: "x", pin: true } } });
    expect(await host.request<unknown>("pick", { extension: "ext", palette: "main", id: "i", args: null, values: null })).toEqual({ id: "i", action: null, ctx: null });
    expect((await host.call("pick", { extension: "ext", palette: "main", id: "badform" })).error).toMatch(/pick  form: no fields/);
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

describe("settings.set", () => {
  let root: Root;
  let host: Host;
  beforeAll(async () => {
    root = new Root({
      writer: {
        "index.ts": `
import { settings } from "${API}";
const heard = [];
settings.onChange((s) => heard.push(s.settings.name + "/" + (s.settings.token ?? "")), "writer");
export default { palettes: {
  main: {
    list: () => [{ id: "a", name: String(settings.get().name) }],
    pick: async (id, action) => {
      if (action === "name") { await settings.set("name", "paired"); return { after: settings.get().name }; }
      if (action === "secret") { await settings.set("token", "s3cret"); return { after: settings.get().token }; }
      if (action === "default") { await settings.set("name", "default name"); return { after: settings.get().name }; }
      if (action === "unset") { await settings.set("name", null); return { after: settings.get().name }; }
      if (action === "undeclared") { try { await settings.set({ name: "half", nope: 1 }); return { ok: true }; } catch (e) { return { error: e.message, name: settings.get().name }; } }
      if (action === "both") { await settings.set({ name: "both", token: "t0k" }); return { after: settings.get() }; }
      if (action === "palette") { await settings.setPalette("columns", 6); return { after: settings.palette().columns }; }
      if (action === "heard") { await Bun.sleep(20); return { heard }; }
      return {};
    },
  },
} };`,
        "pal.json": manifest("writer", {
          settings: [{ id: "name", kind: "text", label: "Name", default: "default name" }, { id: "token", kind: "secret", label: "Token" }],
          palettes: { main: { kind: "list", settings: [{ id: "columns", kind: "number", label: "Columns", default: 4 }] } },
        }),
      },
    });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("a write is one core/settings.set with the extension, id and value; the table has the value when the call resolves", async () => {
    expect(await host.list("writer", "main")).toEqual([{ id: "a", name: "default name" }]);
    expect(await host.pick("writer", "main", "a", "name")).toEqual({ after: "paired" });
    expect(host.coreCalls.find((c) => c.method === "settings.set")).toEqual({ method: "settings.set", params: { extension: "writer", values: { name: "paired" } } });
    expect(host.written.get("writer")).toEqual({ name: "paired" });
    expect(await host.list("writer", "main")).toEqual([{ id: "a", name: "paired" }]);
  });

  test("a secret reaches the store, the file gets the reference, the extension sees the value", async () => {
    expect(await host.pick("writer", "main", "a", "secret")).toEqual({ after: "s3cret" });
    expect(host.written.get("writer")!.token).toBe("keychain:pal/writer-token");
    expect(host.secrets.get("pal/writer-token")).toBe("s3cret");
  });

  test("the default and null unset the key; onChange hears each change once (the answer, the push and the watcher's reload carry the same values)", async () => {
    expect(await host.pick("writer", "main", "a", "default")).toEqual({ after: "default name" });
    expect(host.written.get("writer")!.name).toBeUndefined();
    await host.pick("writer", "main", "a", "name");
    expect(await host.pick("writer", "main", "a", "unset")).toEqual({ after: "default name" });
    const { heard } = (await host.pick("writer", "main", "a", "heard")) as unknown as { heard: string[] };
    expect(heard).toEqual(["paired/", "paired/s3cret", "default name/s3cret", "paired/s3cret", "default name/s3cret"]);
  });

  test("a palette's setting goes under its palette; an undeclared id is refused by the core", async () => {
    expect(await host.pick("writer", "main", "a", "palette")).toEqual({ after: 6 });
    expect(host.coreCalls.at(-1)).toEqual({ method: "settings.set", params: { extension: "writer", palette: "main", values: { columns: 6 } } });
    expect(host.written.get("writer/main")).toEqual({ columns: 6 });
    // One object is one call and one edit; an undeclared id in it refuses the whole write.
    expect(await host.pick("writer", "main", "a", "both")).toEqual({ after: { name: "both", token: "t0k" } });
    expect(host.coreCalls.at(-1)).toEqual({ method: "settings.set", params: { extension: "writer", values: { name: "both", token: "t0k" } } });
    expect(await host.pick("writer", "main", "a", "undeclared")).toEqual({ error: "settings.set: writer declares no setting nope", name: "both" });
  });
});

describe("bar", () => {
  let root: Root;
  let host: Host;
  beforeAll(async () => {
    root = new Root({
      ext: {
        "index.ts": `
import { bar, settings } from "${API}";
let shown = 0;
const tick = setInterval(() => {}, 1000);
export default {
  palettes: { p: { list: () => [], pick: () => {} } },
  bar: {
    a: {
      render: (ctx) => ({ icon: "x", title: \`\${settings.get().greeting} \${ctx.reason}\`, badge: 3, menu: [{ type: "item", id: "one", title: "One" }], shown }),
      onAction: (action, ctx) => {
        if (action === "throw") throw new Error("nope");
        if (action === "view") return { view: { tree: { type: "text", value: "v" }, actions: [{ id: "pal:x", title: "bad" }] } };
        return { action, ctx };
      },
      onOpen: (ctx) => ({ open: "https://x", ctx }),
      onShown: () => { shown++; },
    },
    b: { render: () => ({ hidden: true }) },
    echo: { render: (ctx) => ctx.item },
    push: { render: async () => { await bar.update("push", { title: "pushed" }); await bar.refresh("push"); return { title: "p" }; } },
    badpush: { render: async () => { try { await bar.update("badpush", { title: "x".repeat(65) }); } catch (e) { return { title: e.message }; } return {}; } },
  },
  dispose: () => { clearInterval(tick); console.log("disposed"); },
};`,
        "pal.json": manifest("ext", { settings: [{ kind: "text", id: "greeting", label: "G", default: "hi" }], bar: { a: { title: "A", description: "the a", refresh: { every: 60, on: ["show"] }, mocks: { warning: { title: "3 unread", item: { icon: "x", badge: 3, color: "amber" } } } }, ghost: { title: "Ghost" } } }),
      },
      plain: { "index.ts": simpleExt("plain") },
    });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("hello and extension/loaded carry the manifest's bar entries merged with the code's keys; a manifest-only id has source: false", async () => {
    const expected: BarMeta[] = [
      { id: "a", title: "A", description: "the a", refresh: { every: 60, on: ["show"] }, mocks: { warning: { title: "3 unread", item: { icon: "x", badge: 3, color: "amber" } } }, source: true },
      { id: "ghost", title: "Ghost", source: false },
      { id: "b", title: "b", source: true },
      { id: "echo", title: "echo", source: true },
      { id: "push", title: "push", source: true },
      { id: "badpush", title: "badpush", source: true },
    ];
    expect(host.loaded().find((l) => l.extension === "ext")!.bar).toEqual(expected);
    const h = await host.hello();
    expect(h.extensions.find((e) => e.name === "ext")!.bar).toEqual(expected);
    expect(h.extensions.find((e) => e.name === "plain")!.bar).toEqual([]);
    expect(host.loaded().find((l) => l.extension === "plain")!.bar).toEqual([]);
  });

  test("bar/render answers the item, with ctx and the extension's settings in scope", async () => {
    expect(await host.render("ext", "a")).toEqual({ icon: "x", title: "hi load", badge: 3, menu: [{ type: "item", id: "one", title: "One" }], shown: 0 } as BarItem);
    expect((await host.render("ext", "a", { reason: "show", anchor: "menubar" })).title).toBe("hi show");
    expect(await host.render("ext", "b")).toEqual({ hidden: true });
    expect(await host.request("bar/render", { extension: "ext", id: "a" })).toMatchObject({ title: "hi load" });
  });

  test("an unknown item, a manifest-only one, or an unknown extension is an error reply", async () => {
    expect((await host.call("bar/render", { extension: "ext", id: "nope", ctx: { reason: "load" } })).error).toBe("no bar item ext/nope");
    expect((await host.call("bar/render", { extension: "ext", id: "ghost", ctx: { reason: "load" } })).error).toBe("no bar item ext/ghost");
    expect((await host.call("bar/render", { extension: "none", id: "a", ctx: { reason: "load" } })).error).toBe("no extension none");
    expect((await host.call("bar/action", { extension: "ext", id: "nope", action: "x", ctx: { reason: "open" } })).error).toBe("no bar item ext/nope");
  });

  test("the limits: title, segments, menu nodes, submenu depth, pal: action ids, a { view } menu, badge, progress", async () => {
    const refused = async (item: unknown) => (await host.call("bar/render", { extension: "ext", id: "echo", ctx: { reason: "load", item } })).error;
    expect(await refused({ title: "x".repeat(65) })).toBe("ext/echo: render: title longer than 64 chars");
    expect(await refused({ title: "x".repeat(64) })).toBeUndefined();
    expect(await refused({ segments: Array.from({ length: 9 }, (_, i) => ({ id: `s${i}` })) })).toMatch(/more than 8 segments/);
    expect(await refused({ segments: [{ id: "s" }, { id: "s" }] })).toMatch(/segment id "s" twice/);
    expect(await refused({ menu: Array.from({ length: 65 }, (_, i) => ({ type: "item", id: `i${i}`, title: "x" })) })).toMatch(/more than 64 menu nodes/);
    expect(await refused({ menu: Array.from({ length: 64 }, (_, i) => ({ type: "item", id: `i${i}`, title: "x" })) })).toBeUndefined();
    const nest = (depth: number): unknown => (depth === 0 ? { type: "item", id: "leaf", title: "l" } : { type: "submenu", title: `s${depth}`, children: [nest(depth - 1)] });
    expect(await refused({ menu: [nest(3)] })).toBeUndefined();
    expect(await refused({ menu: [nest(4)] })).toMatch(/nested deeper than 3/);
    expect(await refused({ menu: [{ type: "section", title: "S", children: [{ type: "item", id: "x", title: "x", action: "pal:settings" }] }] })).toMatch(/"pal:settings" is the shell's/);
    expect(await refused({ menu: [{ type: "item", id: "pal:x", title: "x" }] })).toMatch(/"pal:x" is the shell's/);
    expect(await refused({ menu: [{ type: "item", id: "d", title: "x" }, { type: "separator" }, { type: "item", id: "d", title: "y" }] })).toMatch(/menu id "d" twice/);
    expect(await refused({ menu: [{ type: "row", id: "d" }] })).toMatch(/menu\/0 is not a menu node/);
    expect(await refused({ menu: { view: { tree: { type: "text", value: "v" }, actions: [{ id: "pal:x", title: "b" }] } } })).toMatch(/menu view: action id "pal:x"/);
    expect(await refused({ menu: { view: { tree: { type: "text", value: "v" }, actions: [] } } })).toBeUndefined();
    expect(await refused({ menu: { palette: "" } })).toMatch(/menu palette must be a name/);
    expect(await refused({ menu: { palette: "p", extension: "ext", args: { n: 1 } } })).toBeUndefined();
    expect(await refused({ menu: "nodes" })).toMatch(/menu must be nodes/);
    expect(await refused({ badge: "x" })).toMatch(/badge must be a number or "dot"/);
    expect(await refused({ badge: "dot", progress: 0.5, color: "amber", refresh: 30 })).toBeUndefined();
    expect(await refused({ progress: 2 })).toMatch(/progress must be 0..1/);
    expect(await refused({ color: "chartreuse" })).toMatch(/unknown color/);
    expect(await refused(null)).toMatch(/not an object/);
  });

  test("a hidden item's empty shape (what show = always keeps) passes through with its menu checked like the item's", async () => {
    const quiet = { hidden: true, empty: { icon: "x", tooltip: "Nothing here", menu: [{ type: "item", id: "open", title: "Open" }] } };
    expect(await host.render("ext", "echo", { reason: "load", item: quiet } as never)).toEqual(quiet as BarItem);
    const refused = async (item: unknown) => (await host.call("bar/render", { extension: "ext", id: "echo", ctx: { reason: "load", item } })).error;
    expect(await refused({ hidden: true, empty: "glyph" })).toBe("ext/echo: render: empty must be an object");
    expect(await refused({ hidden: true, empty: { title: "x".repeat(65) } })).toBe("ext/echo: render: empty title longer than 64 chars");
    expect(await refused({ hidden: true, empty: { menu: [{ type: "item", id: "pal:x", title: "x" }] } })).toMatch(/render empty: action id "pal:x" is the shell's/);
    expect(await refused({ hidden: true, empty: { menu: { view: { tree: { type: "text", value: "v" }, actions: [] } } } })).toBeUndefined();
  });

  test("bar/action and bar/open reach the handlers with the action and ctx; a throw is an error reply; a bad effect is refused; no handler answers {}", async () => {
    expect(await host.barAction("ext", "a", "one", { reason: "open", anchor: "sketchybar" })).toEqual({ action: "one", ctx: { reason: "open", anchor: "sketchybar", settings: {} } });
    expect((await host.call("bar/action", { extension: "ext", id: "a", action: "throw", ctx: { reason: "open" } })).error).toBe("nope");
    expect((await host.call("bar/action", { extension: "ext", id: "a", action: "view", ctx: { reason: "open" } })).error).toMatch(/action view view: action id "pal:x"/);
    expect(await host.barAction("ext", "b", "x")).toEqual({});
    expect(await host.barOpen("ext", "a", { reason: "open", anchor: "hotkey" })).toEqual({ open: "https://x", ctx: { reason: "open", anchor: "hotkey", settings: {} } });
    expect(await host.barOpen("ext", "b")).toEqual({});
  });

  test("bar/shown is a notification: no reply, the item's onShown runs", async () => {
    const before = host.notifications.length;
    host.barShown("ext", "a");
    host.barShown("ext", "nope");
    await host.untilStderr("bar/shown failed: no bar item ext/nope");
    expect((await host.render("ext", "a") as BarItem & { shown: number }).shown).toBe(1);
    expect(host.notifications.length).toBe(before);
    expect(host.garbage).toEqual([]);
  });

  test("bar.update and bar.refresh reach the core with the extension and id; a bad push is refused in the SDK", async () => {
    expect(await host.render("ext", "push")).toEqual({ title: "p" });
    expect(host.coreCalls.filter((c) => c.method.startsWith("bar."))).toEqual([
      { method: "bar.update", params: { extension: "ext", id: "push", item: { title: "pushed" } } },
      { method: "bar.refresh", params: { extension: "ext", id: "push" } },
    ]);
    expect(await host.render("ext", "badpush")).toEqual({ title: "bar.update badpush: title longer than 64 chars" });
    expect(host.updates("ext", "badpush")).toEqual([]);
  });

  test("hot reload disposes the resident module first and announces the bar entries again", async () => {
    const reloaded = host.next("extension/loaded", (p) => p.extension === "ext");
    root.write("ext", "index.ts", `export default { palettes: { p: { list: () => [], pick: () => {} } }, bar: { a: { render: () => ({ title: "again" }) } } };`);
    expect(((await reloaded).params as any).bar).toEqual([{ id: "a", title: "A", description: "the a", refresh: { every: 60, on: ["show"] }, mocks: { warning: { title: "3 unread", item: { icon: "x", badge: 3, color: "amber" } } }, source: true }, { id: "ghost", title: "Ghost", source: false }]);
    expect(host.stderr).toContain("disposed");
    expect(await host.render("ext", "a")).toEqual({ title: "again" });
    expect((await host.call("bar/render", { extension: "ext", id: "b", ctx: { reason: "load" } })).error).toBe("no bar item ext/b");
  });
});

describe("watching", () => {
  test("an extension whose directory is deleted leaves: extension/removed, gone from hello and known, no longer served", async () => {
    const root = new Root({ stay: { "index.ts": simpleExt("stay") }, go: { "index.ts": simpleExt("go") } });
    const host = await Host.start({ roots: [root.dir] });
    expect(await host.list("go", "go")).toHaveLength(1);
    const removed = host.next("extension/removed", (p) => p.extension === "go");
    rmSync(join(root.dir, "go"), { recursive: true });
    await removed;
    expect((await host.call("list", { extension: "go", palette: "go" })).error).toBe("no extension go");
    const h = await host.hello();
    expect(h.extensions.map((e) => e.name)).toEqual(["stay"]);
    expect(h.errors).toEqual({});
    expect(await host.list("stay", "stay")).toHaveLength(1);
    host.kill();
    root.rm();
  });

  test("a root created after start is watched: its extensions load and reload, and it gets the @zcag/pal link", async () => {
    const parent = new Root();
    const late = join(parent.dir, "extensions");
    const host = await Host.start({ roots: [late] });
    expect((await host.hello()).extensions).toEqual([]);
    const loaded = host.next("extension/loaded", (p) => p.extension === "fresh");
    mkdirSync(join(late, "fresh"), { recursive: true });
    writeFileSync(join(late, "fresh", "index.ts"), simpleExt("fresh"));
    expect((await loaded).params).toMatchObject({ extension: "fresh", root: late });
    expect(await host.list("fresh", "fresh")).toEqual([{ id: "a", name: "A" }]);
    expect(existsSync(join(late, "node_modules", "@zcag", "pal"))).toBe(true);
    const reloaded = host.next("extension/loaded", (p) => p.extension === "fresh");
    writeFileSync(join(late, "fresh", "index.ts"), simpleExt("fresh", { list: `() => [{ id: "b", name: "B" }]` }));
    await reloaded;
    expect(await host.list("fresh", "fresh")).toEqual([{ id: "b", name: "B" }]);
    host.kill();
    parent.rm();
  });

  test("a root deleted whole lets its extensions go", async () => {
    const parent = new Root();
    const root = join(parent.dir, "extensions");
    mkdirSync(join(root, "e"), { recursive: true });
    writeFileSync(join(root, "e", "index.ts"), simpleExt("e"));
    const host = await Host.start({ roots: [root] });
    expect(await host.list("e", "e")).toHaveLength(1);
    const removed = host.next("extension/removed", (p) => p.extension === "e");
    rmSync(root, { recursive: true });
    await removed;
    expect((await host.hello()).extensions).toEqual([]);
    host.kill();
    parent.rm();
  });

  test("the @zcag/pal link: made once, re-pointed when stale, a real directory at that path is left alone", async () => {
    const root = new Root({ e: { "index.ts": simpleExt("e") } });
    const link = join(root.dir, "node_modules", "@zcag", "pal");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync("/nonexistent/old-host", link);
    let host = await Host.start({ roots: [root.dir] });
    expect(readlinkSync(link)).toBe(resolve(HOST, "../../../sdk"));
    expect(host.stderr).toContain(`linked ${link}`);
    host.kill();
    host = await Host.start({ roots: [root.dir] });
    expect(host.stderr).not.toContain("linked ");
    host.kill();
    rmSync(link);
    mkdirSync(link);
    host = await Host.start({ roots: [root.dir] });
    expect(host.stderr).toContain("is not a link; leaving it");
    expect(lstatSync(link).isDirectory()).toBe(true);
    host.kill();
    root.rm();
  });

  test("an import that never settles is reported as extension/error and does not hold host/ready back", async () => {
    const root = new Root({ hang: { "index.ts": "await new Promise(() => {});\nexport default { palettes: {} };" }, ok: { "index.ts": simpleExt("ok") } });
    process.env.PAL_LOAD_TIMEOUT_MS = "500";
    const host = await Host.start({ roots: [root.dir] }).finally(() => delete process.env.PAL_LOAD_TIMEOUT_MS);
    expect(await host.list("ok", "ok")).toHaveLength(1);
    expect(host.failed().find((f) => f.extension === "hang")?.message).toBe("import of hang did not answer within 0.5 s");
    host.kill();
    root.rm();
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
