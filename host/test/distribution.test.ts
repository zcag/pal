// What decides whether a found extension loads (docs/design/distribution.md):
// the protocol a package was built for (skipped for an earlier root's copy,
// else failed), the core's turned-off list at start and on
// `disabled/changed`, `requires`, and the core's `reload {extension}` after
// it swaps a directory, whose own file events do not load it a second time.
import { describe, expect, test } from "bun:test";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROTOCOL, PROTOCOL_MIN, type Reloaded } from "../../sdk/src/protocol.ts";
import { API, Host, Root, manifest, simpleExt } from "./harness.ts";

const runs = PROTOCOL_MIN === PROTOCOL ? `protocol ${PROTOCOL}` : `${PROTOCOL_MIN} to ${PROTOCOL}`;
const at = (list: { extension: string }[], name: string) => list.filter((n) => n.extension === name);

describe("protocol", () => {
  test("a copy built for another protocol is skipped for an earlier root's; with no other copy it fails with why", async () => {
    const a = new Root({ both: { "index.ts": simpleExt("both", { list: `() => [{ id: "a", name: "from a" }]` }), "pal.json": manifest("both") } });
    const b = new Root({
      both: { "index.ts": simpleExt("both", { list: `() => [{ id: "b", name: "from b" }]` }), "pal.json": manifest("both", { protocol: PROTOCOL + 1 }) },
      only: { "index.ts": simpleExt("only"), "pal.json": manifest("only", { protocol: PROTOCOL + 1 }) },
      now: { "index.ts": simpleExt("now"), "pal.json": manifest("now", { protocol: PROTOCOL }) },
    });
    const host = await Host.start({ roots: [a.dir, b.dir] });
    try {
      expect((await host.list("both", "both"))[0].name).toBe("from a");
      expect(host.loaded().find((l) => l.extension === "both")!.root).toBe(a.dir);
      expect(host.stderr).toContain(`skipping both in ${b.dir}: built for protocol ${PROTOCOL + 1}; this pal runs ${runs}`);
      const f = host.failed().find((f) => f.extension === "only")!;
      expect(f).toMatchObject({ root: b.dir, message: `built for protocol ${PROTOCOL + 1}; this pal runs ${runs}` });
      expect(f.manifest.name).toBe("only");
      expect(host.coreCalls.some((c) => (c.params as any)?.extension === "only" && c.method === "settings.get")).toBe(false);
      expect(await host.list("now", "now")).toHaveLength(1);
      const h = await host.hello();
      expect([h.protocolMin, h.protocol]).toEqual([PROTOCOL_MIN, PROTOCOL]);
      expect(h.errors.only).toContain("built for protocol");
    } finally {
      host.kill();
      a.rm(); b.rm();
    }
  });
});

describe("turned off", () => {
  test("store.disabled at start: announced with its manifest, listed in hello, never loaded; disabled/changed turns it on and another off", async () => {
    const root = new Root({
      off: { "index.ts": simpleExt("off"), "pal.json": manifest("off", { title: "Off" }) },
      on: { "index.ts": simpleExt("on"), "pal.json": manifest("on", { title: "On" }) },
    });
    const host = await Host.start({ roots: [root.dir], core: { "store.disabled": () => ["off", "absent"] } });
    try {
      expect(host.seen("extension/disabled")).toEqual([{ extension: "off", root: root.dir, manifest: { name: "off", title: "Off" } }]);
      expect(at(host.loaded(), "off")).toEqual([]);
      expect(host.coreCalls.some((c) => (c.params as any)?.extension === "off")).toBe(false);
      expect((await host.call("list", { extension: "off", palette: "off" })).error).toBe("no extension off");
      const h = await host.hello();
      expect(h.extensions.find((e) => e.name === "off")).toMatchObject({ loaded: false, disabled: true, manifest: { title: "Off" } });
      expect(h.extensions.find((e) => e.name === "on")).toMatchObject({ loaded: true, disabled: false });
      expect(h.errors).toEqual({});
      const ready = host.seen("host/ready")[0];
      expect(ready.extensions).not.toContain("off");
      expect(ready.known).toContain("off");

      const loaded = host.next("extension/loaded", (p) => p.extension === "off");
      const parked = host.next("extension/disabled", (p) => p.extension === "on");
      host.notify("disabled/changed", { names: ["on"] });
      await Promise.all([loaded, parked]);
      expect(await host.list("off", "off")).toHaveLength(1);
      expect(at(host.seen("extension/removed"), "on")).toHaveLength(1);
      expect((await host.call("list", { extension: "on", palette: "on" })).error).toBe("no extension on");
      expect((await host.hello()).extensions.find((e) => e.name === "on")).toMatchObject({ loaded: false, disabled: true });
      expect(await host.request<Reloaded>("reload", { extension: "on" })).toEqual({ loaded: false, root: root.dir, disabled: true });
    } finally {
      host.kill();
      root.rm();
    }
  });

  test("a core without store.disabled (an error) turns nothing off", async () => {
    const root = new Root({ e: { "index.ts": simpleExt("e") } });
    const host = await Host.start({ roots: [root.dir], core: { "store.disabled": () => { throw new Error("unknown capability store"); } } });
    try {
      expect(await host.list("e", "e")).toHaveLength(1);
      expect(host.stderr).toContain("turned-off extensions unavailable (unknown capability store); none");
    } finally {
      host.kill();
      root.rm();
    }
  });

  test("a multi extension turned off parks every instance, and comes back with each", async () => {
    const root = new Root({
      acct: {
        "index.ts": `import { instance } from "${API}";\nexport default { palettes: { main: { title: "Main", list: () => [{ id: "k", name: instance().key }], pick: () => {} } } };`,
        "pal.json": manifest("acct", { multi: true, palettes: { main: { title: "Main" } } }),
      },
    });
    const host = await Host.start({ roots: [root.dir], core: { "instances.get": () => [{ key: "acct" }, { key: "acct@work", title: "Work" }] } });
    try {
      expect(host.loaded().map((l) => l.extension).sort()).toEqual(["acct", "acct@work"]);
      const parked = host.next("extension/disabled", (p) => p.extension === "acct");
      host.notify("disabled/changed", { names: ["acct"] });
      await parked;
      expect(host.seen("extension/removed").map((r) => r.extension).sort()).toEqual(["acct", "acct@work"]);
      expect((await host.hello()).extensions).toEqual([expect.objectContaining({ name: "acct", loaded: false, disabled: true })]);
      const back = host.next("extension/loaded", (p) => p.extension === "acct@work");
      host.notify("disabled/changed", { names: [] });
      await back;
      expect((await host.list("acct@work", "main"))[0].name).toBe("acct@work");
    } finally {
      host.kill();
      root.rm();
    }
  });
});

describe("requires", () => {
  test("missing, it fails with the name; installed, it loads; turned off, it fails again", async () => {
    const root = new Root({ needy: { "index.ts": simpleExt("needy"), "pal.json": manifest("needy", { requires: ["base"], suggests: ["extra"] }) } });
    const host = await Host.start({ roots: [root.dir] });
    try {
      expect(host.failed().find((f) => f.extension === "needy")?.message).toBe("needs base, which is not installed");
      const needy = host.next("extension/loaded", (p) => p.extension === "needy");
      root.write("base", "pal.json", manifest("base"));
      root.write("base", "index.ts", simpleExt("base"));
      expect(((await needy).params as any).warnings).toEqual([]);
      expect(await host.list("needy", "needy")).toHaveLength(1);
      const off = host.next("extension/error", (p) => p.extension === "needy");
      host.notify("disabled/changed", { names: ["base"] });
      expect(((await off).params as any).message).toBe("needs base, which is turned off");
      expect((await host.call("list", { extension: "needy", palette: "needy" })).error).toBe("needs base, which is turned off");
      const on = host.next("extension/loaded", (p) => p.extension === "needy");
      host.notify("disabled/changed", { names: [] });
      await on;
      const gone = host.next("extension/error", (p) => p.extension === "needy");
      rmSync(join(root.dir, "base"), { recursive: true });
      expect(((await gone).params as any).message).toBe("needs base, which is not installed");
    } finally {
      host.kill();
      root.rm();
    }
  });

  test("a bad requires or suggests is a warning; two that require each other both load", async () => {
    const root = new Root({
      odd: { "index.ts": simpleExt("odd"), "pal.json": manifest("odd", { requires: ["Bad Name", "odd"], suggests: "x" as unknown as string[] }) },
      a: { "index.ts": simpleExt("a"), "pal.json": manifest("a", { requires: ["b"] }) },
      b: { "index.ts": simpleExt("b"), "pal.json": manifest("b", { requires: ["a"] }) },
    });
    const host = await Host.start({ roots: [root.dir] });
    try {
      expect(host.loaded().find((l) => l.extension === "odd")!.warnings).toEqual([
        'requires: "Bad Name" is not an extension name (lowercase letters, digits, "-", "_", ".")',
        "requires: names the extension itself",
        "suggests: not a list of extension names",
      ]);
      expect(await host.list("a", "a")).toHaveLength(1);
      expect(await host.list("b", "b")).toHaveLength(1);
    } finally {
      host.kill();
      root.rm();
    }
  });
});

describe("reload", () => {
  test("after a directory swap: answers once the new build loaded, or with its error; the swap's own events load nothing again", async () => {
    const root = new Root({ ext: { "index.ts": simpleExt("ext", { list: `() => [{ id: "v", name: "1" }]` }) } });
    const host = await Host.start({ roots: [root.dir] });
    // The core's swap: the new build staged beside the root, renamed over the old one.
    const swap = (name: string, text: string) => {
      const staged = join(root.dir, "..", `${name}-staged-${Date.now()}`);
      mkdirSync(staged);
      writeFileSync(join(staged, "index.ts"), text);
      rmSync(join(root.dir, name), { recursive: true, force: true });
      renameSync(staged, join(root.dir, name));
    };
    try {
      swap("ext", simpleExt("ext", { list: `() => [{ id: "v", name: "2" }]` }));
      expect(await host.request<Reloaded>("reload", { extension: "ext" })).toEqual({ loaded: true, root: root.dir });
      expect((await host.list("ext", "ext"))[0].name).toBe("2");
      await host.untilStderr("ext unchanged since its last load");
      expect(at(host.loaded(), "ext")).toHaveLength(2);

      swap("ext", "export default {{{");
      const r = await host.request<Reloaded>("reload", { extension: "ext" });
      expect(r.loaded).toBe(false);
      expect(r.error).toContain("index.ts:1:");
      await host.until(() => host.stderr.split("ext unchanged since its last load").length > 2, 3000, "the second swap's events skipped");
      expect(at(host.failed(), "ext")).toHaveLength(1);

      expect(await host.request<Reloaded>("reload", { extension: "nope" })).toEqual({ loaded: false, error: "no extension nope" });
      // An edit afterwards is a change: the watcher loads it.
      const again = host.next("extension/loaded", (p) => p.extension === "ext");
      root.write("ext", "index.ts", simpleExt("ext", { list: `() => [{ id: "v", name: "3" }]` }));
      await again;
      expect((await host.list("ext", "ext"))[0].name).toBe("3");
    } finally {
      host.kill();
      root.rm();
    }
  });

  test("a new extension: reload loads it at once and answers its root", async () => {
    const root = new Root();
    const host = await Host.start({ roots: [root.dir] });
    try {
      root.write("fresh", "index.ts", simpleExt("fresh"));
      expect(await host.request<Reloaded>("reload", { extension: "fresh" })).toEqual({ loaded: true, root: root.dir });
      expect(await host.list("fresh", "fresh")).toHaveLength(1);
    } finally {
      host.kill();
      root.rm();
    }
  });
});
