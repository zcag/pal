// Instances of a `multi` extension (docs/design/instances.md): one worker
// per configured instance, each with its own module state, settings,
// storage key and effects; the title rule and the badged tile on the
// metas; `hello` and `host/ready` by key; removal, disposal and a hung
// instance's termination.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { instanceTitle, stripInstance } from "../../sdk/src/manifest.ts";
import type { BarItem, PaletteMeta } from "../../sdk/src/protocol.ts";
import { resolveInstances, rewriteBarItem, rewriteCall, rewriteEffect, tintOf } from "../src/instances.ts";
import { API, Host, HostError, Root, manifest } from "./harness.ts";

/** The fixture: a submodule holds a counter, so two instances sharing one module registry would count together. */
const STATE = `let n = 0;\nexport const bump = () => ++n;\n`;
const INDEX = `
import { bar, instance, settings, storage } from "${API}";
import { bump } from "./state.ts";
export default {
  palettes: {
    counter: {
      title: "Counter",
      list: () => [
        { id: "n", name: String(bump()) },
        { id: "who", name: instance().key, subtitle: String(settings.get().label), keywords: [instance().name, String(instance().isDefault), instance().title ?? "-"] },
      ],
      pick: async (id) => {
        if (id === "push") return { push: { palette: "counter" } };
        if (id === "pushname") return { push: { extension: "counter", palette: "inbox" } };
        if (id === "pushother") return { push: { extension: "other", palette: "x" } };
        if (id === "store") { await storage.set("k", instance().key); return { copy: await storage.get("k") }; }
        if (id === "byname") return { copy: String(settings.get("counter").label) };
        if (id === "run") { await bar.update("count", { title: "pushed", menu: { palette: "counter" } }); return { hud: "ok" }; }
        if (id === "hang") { for (;;) {} }
        return { copy: id };
      },
    },
    inbox: { title: "Inbox ({instance})", list: () => [], pick: () => ({}) },
  },
  bar: { count: { render: (ctx) => ({ title: ctx.instance ? String(ctx.instance.title) : "none", menu: { palette: "counter" } }) } },
  link: () => ({ push: { palette: "counter" } }),
  dispose: async () => { await storage.set("disposed", true); },
};
`;
const MANIFEST = manifest("counter", {
  title: "Counter",
  multi: true,
  icon: { tile: { glyph: "", bg: "blue" } },
  settings: [{ kind: "text", id: "label", label: "Label", default: "x" }, { kind: "secret", id: "token", label: "Token" }],
  palettes: { counter: { title: "Counter" }, inbox: { title: "Inbox ({instance})" } },
  bar: { count: { title: "Count" } },
  links: { bump: {} },
});

/** What the core answers for `instances.get`, changed by the tests to add and remove instances. */
let instances: Record<string, unknown[]> = { counter: [{ key: "counter", title: "Personal" }, { key: "counter@work", title: "Work", tint: "amber", badge: "W" }, { key: "counter@off", enabled: false }] };

describe("instances", () => {
  let root: Root;
  let host: Host;
  beforeAll(async () => {
    root = new Root({
      counter: { "index.ts": INDEX, "state.ts": STATE, "pal.json": MANIFEST },
      // A non-multi extension next to it: inline, as before.
      plain: { "index.ts": `export default { palettes: { plain: { title: "Plain ({instance})", list: () => [{ id: "a", name: "A" }], pick: () => ({ push: { palette: "plain" } }) } } };`, "pal.json": manifest("plain", { title: "Plain" }) },
    });
    host = await Host.start({
      roots: [root.dir],
      core: { "instances.get": ({ extension }: { extension: string }) => instances[extension] ?? [] },
      settings: { counter: { settings: { label: "P" } }, "counter@work": { settings: { label: "W" } } },
    });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("host/ready and hello list the instance keys; a disabled instance is not loaded", async () => {
    const ready = host.seen("host/ready")[0];
    expect(ready.extensions.sort()).toEqual(["counter", "counter@work", "plain"]);
    expect(ready.known.sort()).toEqual(["counter", "counter@work", "plain"]);
    const h = await host.hello();
    const keys = h.extensions.map((e: any) => e.extension).sort();
    expect(keys).toEqual(["counter", "counter@work", "plain"]);
    const work = h.extensions.find((e: any) => e.extension === "counter@work") as any;
    expect(work.name).toBe("counter");
    expect(work.loaded).toBe(true);
    expect(work.instance).toEqual({ key: "counter@work", title: "Work", tint: "amber", badge: "W", isDefault: false });
    expect(work.palettes.map((p: PaletteMeta) => p.title)).toEqual(["Counter (Work)", "Inbox (Work)"]);
    expect(work.bar.map((b: any) => b.id)).toEqual(["count"]);
    expect(host.stderr).toContain("instance counter@off is disabled");
    expect(host.stderr).toMatch(/loaded counter@work \(counter,inbox; bar count\) in a worker/);
  });

  test("extension/loaded per instance: the key, the name, the instance, the title rule and the badged tile", () => {
    const by = Object.fromEntries(host.loaded().map((l: any) => [l.extension, l]));
    expect(by.counter.name).toBe("counter");
    expect(by.counter.instance).toEqual({ key: "counter", title: "Personal", isDefault: true });
    expect(by.counter.palettes.map((p: PaletteMeta) => p.title)).toEqual(["Counter (Personal)", "Inbox (Personal)"]);
    // The default keeps the plain tile, even next to another instance.
    expect(by.counter.palettes[0].icon).toEqual({ tile: { glyph: "", bg: "blue" } });
    expect(by["counter@work"].palettes[0].icon).toEqual({ tile: { glyph: "", bg: "amber", badge: "W" } });
    expect(by["counter@work"].warnings).toEqual([]);
    // A non-multi extension is as before, plus `name` and a default `instance`; its `{instance}` is a warning.
    expect(by.plain.name).toBe("plain");
    expect(by.plain.instance).toEqual({ key: "plain", isDefault: true });
    expect(by.plain.palettes[0].title).toBe("Plain ({instance})");
    expect(by.plain.warnings).toEqual(['palettes.plain: the title uses {instance} but pal.json does not declare "multi": true; nothing fills it']);
  });

  test("two instances count separately: each worker has its own module registry", async () => {
    const n = async (key: string) => (await host.list(key, "counter"))[0].name;
    expect(await n("counter")).toBe("1");
    expect(await n("counter")).toBe("2");
    expect(await n("counter@work")).toBe("1");
    expect(await n("counter")).toBe("3");
    expect(await n("counter@work")).toBe("2");
  });

  test("settings.get() and instance() answer per key, the manifest name meaning the instance itself", async () => {
    const who = async (key: string) => (await host.list(key, "counter"))[1];
    expect(await who("counter")).toMatchObject({ name: "counter", subtitle: "P", keywords: ["counter", "true", "Personal"] });
    expect(await who("counter@work")).toMatchObject({ name: "counter@work", subtitle: "W", keywords: ["counter", "false", "Work"] });
    expect(await host.pick("counter@work", "counter", "byname")).toEqual({ copy: "W" });
    // settings/changed for the key reaches its worker's table, and only that one.
    host.changeSettings("counter@work", { settings: { label: "W2" } });
    await host.until(() => host.stderr.includes("settings counter@work"));
    expect((await who("counter@work")).subtitle).toBe("W2");
    expect((await who("counter")).subtitle).toBe("P");
  });

  test("storage calls carry the key", async () => {
    expect(await host.pick("counter@work", "counter", "store")).toEqual({ copy: "counter@work" });
    expect(await host.pick("counter", "counter", "store")).toEqual({ copy: "counter" });
    const sets = host.coreCalls.filter((c) => c.method === "storage.set").map((c) => (c.params as any).extension);
    expect(sets).toEqual(["counter@work", "counter"]);
  });

  test("push without an extension, or with the manifest name, lands on the key; another extension's stays", async () => {
    expect(await host.pick("counter@work", "counter", "push")).toEqual({ push: { extension: "counter@work", palette: "counter" } });
    expect(await host.pick("counter@work", "counter", "pushname")).toEqual({ push: { extension: "counter@work", palette: "inbox" } });
    expect(await host.pick("counter@work", "counter", "pushother")).toEqual({ push: { extension: "other", palette: "x" } });
    expect(await host.pick("counter", "counter", "push")).toEqual({ push: { extension: "counter", palette: "counter" } });
    // A link's effect, and an inline extension's, the same way.
    expect(await host.request<unknown>("link", { extension: "counter@work", route: "bump", params: {} })).toEqual({ push: { extension: "counter@work", palette: "counter" } });
    expect(await host.pick("plain", "plain", "a")).toEqual({ push: { extension: "plain", palette: "plain" } });
  });

  test("bar: ctx.instance names the instance, a menu's palette is spelled by key, bar.update from inside too", async () => {
    const item = await host.render("counter@work", "count");
    expect(item).toEqual({ title: "Work", menu: { palette: "counter", extension: "counter@work" } } as BarItem);
    expect((await host.render("counter", "count")).title).toBe("Personal");
    await host.pick("counter@work", "counter", "run");
    const update = host.updates("counter@work", "count").at(-1) as any;
    expect(update.menu).toEqual({ palette: "counter", extension: "counter@work" });
  });

  test("instances/changed: a removed instance is disposed (a storage call by key) and terminated, the rest keep serving", async () => {
    instances = { counter: [{ key: "counter", title: "Personal" }] };
    const removed = host.next("extension/removed", (p) => p.extension === "counter@work");
    host.notify("instances/changed", { extension: "counter" });
    expect(await removed).toMatchObject({ params: { extension: "counter@work", name: "counter" } });
    await host.until(() => host.coreCalls.some((c) => c.method === "storage.set" && (c.params as any).extension === "counter@work" && (c.params as any).key === "disposed"));
    await expect(host.list("counter@work", "counter")).rejects.toThrow(/no extension counter@work/);
    // The default restarted with the new list: alone, the "(Personal)" suffix is gone and the count starts over.
    await host.until(() => host.loaded().filter((l) => l.extension === "counter").length >= 2);
    expect(host.loaded().at(-1)!.palettes.map((p) => p.title)).toEqual(["Counter", "Inbox"]);
    expect((await host.list("counter", "counter"))[0].name).toBe("1");
  });

  test("a hanging instance is terminated without hurting the other", async () => {
    instances = { counter: [{ key: "counter", title: "Personal" }, { key: "counter@home" }] };
    const home = host.next("extension/loaded", (p) => p.extension === "counter@home");
    const again = host.next("extension/loaded", (p) => p.extension === "counter");
    host.notify("instances/changed", { extension: "counter" });
    await Promise.all([home, again]);
    // The worker's event loop is now blocked for good.
    const hung = host.pick("counter@home", "counter", "hang", undefined, undefined).catch((e) => e);
    await Bun.sleep(100);
    expect((await host.list("counter", "counter"))[0].name).toBe("1");
    instances = { counter: [{ key: "counter", title: "Personal" }] };
    const gone = host.next("extension/removed", (p) => p.extension === "counter@home", 5000);
    const back = host.next("extension/loaded", (p) => p.extension === "counter", 5000);
    host.notify("instances/changed", { extension: "counter" });
    await gone;
    const e = await hung;
    expect(e).toBeInstanceOf(HostError);
    expect((e as HostError).message).toMatch(/counter@home stopped/);
    // Every instance of the name restarts on the change, the default too; it answers again once loaded.
    await back;
    expect((await host.list("counter", "counter"))[0].name).toBe("1");
  });
});

describe("title rule", () => {
  const two = (title?: string) => ({ title, alone: false });
  test("with several instances the instance title is substituted or appended", () => {
    expect(instanceTitle("Inbox", two("Work"))).toBe("Inbox (Work)");
    expect(instanceTitle("{instance} Inbox", two("Work"))).toBe("Work Inbox");
    expect(instanceTitle("Inbox ({instance})", two("Work"))).toBe("Inbox (Work)");
    expect(instanceTitle("Inbox", two("  Work "))).toBe("Inbox (Work)");
  });
  test("alone, or an unnamed default, strips {instance} with its frame and appends nothing", () => {
    expect(instanceTitle("Inbox", { title: "Work", alone: true })).toBe("Inbox");
    expect(instanceTitle("Inbox ({instance})", { title: "Work", alone: true })).toBe("Inbox");
    expect(instanceTitle("Inbox ({instance})", two(undefined))).toBe("Inbox");
    expect(instanceTitle("Inbox", two(undefined))).toBe("Inbox");
    expect(instanceTitle("Inbox", undefined)).toBe("Inbox");
    expect(stripInstance("{instance} Inbox")).toBe("Inbox");
    expect(stripInstance("Inbox {instance}")).toBe("Inbox");
    expect(stripInstance("({instance}) Inbox")).toBe("Inbox");
    expect(stripInstance("Inbox({instance})")).toBe("Inbox");
    // A title that is only the placeholder keeps it rather than going blank.
    expect(stripInstance("{instance}")).toBe("{instance}");
  });
});

describe("resolveInstances", () => {
  test("the default first and always present, defaults filled, malformed keys dropped", () => {
    const r = resolveInstances("gmail", [{ key: "gmail@work", title: "Work", tint: "amber", badge: "W" }, { key: "gmail@home" }, { key: "gmail@Bad" }, { key: "other@x" }, { key: "gmail@default" }, { key: "gmail@off", enabled: false }], "red");
    expect(r.map((i) => i.key)).toEqual(["gmail", "gmail@work", "gmail@home", "gmail@off"]);
    expect(r[0]).toEqual({ key: "gmail", name: "gmail", isDefault: true, enabled: true });
    expect(r[1]).toEqual({ key: "gmail@work", name: "gmail", title: "Work", isDefault: false, enabled: true, tint: "amber", badge: "W" });
    expect(r[2]).toMatchObject({ key: "gmail@home", title: "Home", badge: "H", enabled: true });
    expect(r[2].tint).toBe(tintOf("home", "red"));
    expect(r[2].tint).not.toBe("red");
    expect(r[3].enabled).toBe(false);
  });
  test("a titled default, a bad tint, a long badge, no answer at all", () => {
    const r = resolveInstances("gmail", [{ key: "gmail@work", tint: "chartreuse", badge: "Work" }, { key: "gmail", title: "Personal" }]);
    expect(r.map((i) => i.key)).toEqual(["gmail", "gmail@work"]);
    expect(r[0].title).toBe("Personal");
    expect(r[1].tint).toBe(tintOf("work"));
    expect(r[1].badge).toBe("Wo");
    expect(resolveInstances("gmail", null)).toEqual([{ key: "gmail", name: "gmail", isDefault: true, enabled: true }]);
    expect(resolveInstances("gmail", "nonsense")).toHaveLength(1);
  });
  test("tintOf is stable and never the extension's own colour", () => {
    expect(tintOf("work")).toBe(tintOf("work"));
    for (const own of ["red", "amber", "ink"] as const) expect(tintOf("work", own)).not.toBe(own);
  });
});

describe("rewrites", () => {
  test("push and menus name the key; an outgoing effects.run and bar.update the same", () => {
    const fx = (r: unknown) => rewriteEffect(r, "g@w");
    const item = (r: unknown) => rewriteBarItem(r, "g@w");
    expect(fx({ push: { palette: "p" } })).toEqual({ push: { palette: "p", extension: "g@w" } });
    expect(fx({ push: { extension: "g", palette: "p" } })).toEqual({ push: { palette: "p", extension: "g@w" } });
    expect(fx({ push: { extension: "h", palette: "p" } })).toEqual({ push: { palette: "p", extension: "h" } });
    expect(fx({ copy: "x" })).toEqual({ copy: "x" });
    expect(fx(undefined)).toBeUndefined();
    expect(item({ title: "t", menu: { palette: "p" } })).toEqual({ title: "t", menu: { palette: "p", extension: "g@w" } });
    expect(item({ title: "t", menu: [{ type: "separator" }] })).toEqual({ title: "t", menu: [{ type: "separator" }] });
    expect(rewriteCall("effects.run", { effect: { push: { palette: "p" } } }, "g@w")).toEqual({ effect: { push: { palette: "p", extension: "g@w" } } });
    expect(rewriteCall("bar.update", { extension: "g@w", id: "i", item: { title: "t", menu: { palette: "p" } } }, "g@w")).toEqual({ extension: "g@w", id: "i", item: { title: "t", menu: { palette: "p", extension: "g@w" } } });
    expect(rewriteCall("storage.get", { extension: "g@w", key: "k" }, "g@w")).toEqual({ extension: "g@w", key: "k" });
  });
});
