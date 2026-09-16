// settings.ts in-process: the resolved table, listeners, how `caller` tells
// which extension is asking (explicit, async context, or the stack), and
// the SDK's `settings` over it once sdk.ts has bound the two.
import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { settings as api } from "../../sdk/src/index.ts";
import { bindSdk } from "../src/sdk.ts";
import { caller, context, resolved, setRoots, subscribe, update } from "../src/settings.ts";
import { Root } from "./harness.ts";

const SETTINGS = resolve(import.meta.dir, "../src/settings.ts");
bindSdk();

describe("table", () => {
  test("resolved is empty for an unknown extension and replaces whole on update", () => {
    expect(resolved("nobody")).toEqual({ settings: {}, palettes: {} });
    update({ ext: { settings: { a: 1 }, palettes: { p: { x: true } } } });
    expect(resolved("ext")).toEqual({ settings: { a: 1 }, palettes: { p: { x: true } } });
    update({ ext: { settings: { b: 2 }, palettes: {} } });
    expect(resolved("ext")).toEqual({ settings: { b: 2 }, palettes: {} });
  });

  test("subscribe hears updates for its extension only, until unsubscribed", () => {
    const heard: unknown[] = [];
    const off = subscribe("ext", (s) => heard.push(s.settings));
    update({ other: { settings: { z: 0 }, palettes: {} } });
    update({ ext: { settings: { c: 3 }, palettes: {} } });
    expect(heard).toEqual([{ c: 3 }]);
    off();
    update({ ext: { settings: { d: 4 }, palettes: {} } });
    expect(heard).toEqual([{ c: 3 }]);
  });
});

describe("caller", () => {
  test("an explicit name wins", () => {
    expect(context.run({ extension: "ctx", palette: "p" }, () => caller("given"))).toEqual({ extension: "given" });
  });

  test("the async context names extension and palette, across awaits", async () => {
    const got = await context.run({ extension: "ctx", palette: "p" }, async () => {
      await Bun.sleep(1);
      return caller();
    });
    expect(got).toEqual({ extension: "ctx", palette: "p" });
  });

  test("outside any context and off the roots it throws", () => {
    setRoots([]);
    expect(() => caller()).toThrow(/pass its name/);
  });

  test("api.settings reads the context: get, palette, onChange", () => {
    update({ ctx: { settings: { k: "v" }, palettes: { p: { cols: 3 } } } });
    context.run({ extension: "ctx", palette: "p" }, () => {
      expect(api.get<object>()).toEqual({ k: "v" });
      expect(api.palette<object>()).toEqual({ cols: 3 });
      expect(api.palette<object>("missing")).toEqual({});
      const heard: unknown[] = [];
      const off = api.onChange((s) => heard.push(s.palettes));
      update({ ctx: { settings: {}, palettes: { p: { cols: 4 } } } });
      expect(heard).toEqual([{ p: { cols: 4 } }]);
      off();
    });
    context.run({ extension: "ctx" }, () => expect(() => api.palette()).toThrow(/no palette in context/));
    expect(api.get<object>("ctx")).toEqual({});
  });
});

describe("caller from the stack", () => {
  const root = new Root();
  afterAll(() => root.rm());

  test("a synchronous call at import time from <root>/<name>/... names the extension", async () => {
    root.write("stacky", "index.ts", `import { caller } from "${SETTINGS}";\nexport const who = caller();\nexport const later = () => caller().extension;`);
    // (A bare `() => caller()` is a proper tail call under JSC and loses its frame; list/pick run in the async context anyway.)
    root.write("stacky", "lib/deep.ts", `import { caller } from "${SETTINGS}";\nexport const who = caller();`);
    setRoots([root.dir + "/"]);
    const mod = await import(`${root.path("stacky")}?t=${Date.now()}`);
    expect(mod.who).toEqual({ extension: "stacky" });
    expect(mod.later()).toBe("stacky");
    const deep = await import(root.path("stacky", "lib/deep.ts"));
    expect(deep.who).toEqual({ extension: "stacky" });
    setRoots([]);
    expect(() => mod.later()).toThrow();
  });
});
