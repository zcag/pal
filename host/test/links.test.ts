// Extension links (docs/design/links.md): `checkLinks` against the manifest
// and the code, `checkLinkParams` coercing a query string by the declared
// types, `checkLinkEffect` refusing what needs a level, the host's `link`
// method end to end on a fixture, and the bundled extensions' routes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkLinkEffect, checkLinkParams, checkLinks } from "../../sdk/src/manifest.ts";
import type { Extension, Manifest } from "../../sdk/src/protocol.ts";
import { Host, HostError, Root, manifest, stored } from "./harness.ts";

const ext = (link?: Extension["link"]): Extension => ({ palettes: { a: { list: () => [], pick: () => {} } }, ...(link && { link }) });
const man = (links?: Manifest["links"]): Manifest => ({ name: "x", title: "X", ...(links && { links }) });

describe("checkLinks", () => {
  test("declared and answered: no warnings", () => {
    expect(checkLinks(man({ start: { description: "Start", params: { duration: { required: true } } } }), ext(() => {}))).toEqual([]);
    expect(checkLinks(man(), ext())).toEqual([]);
    expect(checkLinks(man({}), ext())).toEqual([]);
  });
  test("a links block with no link function, and a link function with no block, are warnings", () => {
    expect(checkLinks(man({ start: {}, stop: {} }), ext())).toEqual(['links: 2 routes are declared in pal.json but the code exports no link(route, params); nothing answers "start", "stop"']);
    expect(checkLinks(man({ start: {} }), ext())[0]).toMatch(/^links: a route is declared/);
    expect(checkLinks(man(), ext(() => {}))).toEqual(['links: the code exports link(route, params) but pal.json declares no "links"; a route is reachable only when declared']);
  });
  test("a route name a link cannot carry, a param type not in the table", () => {
    expect(checkLinks(man({ "Join Next": {} }), ext(() => {}))).toEqual(['links.Join Next: a route is lowercase letters, digits and "-" (pal://x/Join Next cannot be typed)']);
    expect(checkLinks(man({ start: { params: { n: { type: "int" as never } } } }), ext(() => {}))).toEqual(['links.start: param "n" has type "int", not one of string, number, boolean, json, string[]']);
    expect(checkLinks({ ...man(), links: [] as never }, ext(() => {}))).toEqual(["links: not an object of routes"]);
  });
});

describe("checkLinkParams", () => {
  const spec = { params: { duration: { required: true }, n: { type: "number" as const }, ring: { type: "boolean" as const }, opts: { type: "json" as const }, tags: { type: "string[]" as const }, name: {} } };
  test("coerces by type, drops a missing optional, keeps an undeclared key", () => {
    expect(checkLinkParams(spec, { duration: "25m", n: "3", ring: "yes", opts: '{"a":1}', tags: "x", extra: "e" }, "t/start")).toEqual({ duration: "25m", n: 3, ring: true, opts: { a: 1 }, tags: ["x"], extra: "e" });
    expect(checkLinkParams(spec, { duration: "25m", tags: ["a", "b"], ring: "0" }, "t/start")).toEqual({ duration: "25m", tags: ["a", "b"], ring: false });
    expect(checkLinkParams(spec, { duration: ["a", "b"] }, "t/start")).toEqual({ duration: "a" });
  });
  test("a missing required param, a bad number, bad JSON name themselves with the route", () => {
    expect(() => checkLinkParams(spec, {}, "t/start")).toThrow("t/start: duration is required");
    expect(() => checkLinkParams(spec, { duration: "" }, "t/start")).toThrow("duration is required");
    expect(() => checkLinkParams(spec, { duration: "1", n: "x" }, "t/start")).toThrow('t/start: n must be a number, not "x"');
    expect(() => checkLinkParams(spec, { duration: "1", opts: "{" }, "t/start")).toThrow(/t\/start: opts is not JSON/);
  });
  test("a route with no params passes everything through", () => {
    expect(checkLinkParams({}, { a: "1", b: ["x", "y"] }, "t/x")).toEqual({ a: "1", b: ["x", "y"] });
  });
});

describe("checkLinkEffect", () => {
  test("a pick's effects pass, the ones that need a level are refused", () => {
    for (const ok of [{ copy: "x" }, { paste: { text: "x" } }, { open: "u" }, { hud: "h" }, { toast: { title: "t" } }, { push: { extension: "e", palette: "p" } }, { layout: { name: "left_half" } }, {}, undefined]) expect(checkLinkEffect(ok, "t/x")).toBe(ok);
    for (const bad of ["keep", "show", "view", "form"]) expect(() => checkLinkEffect({ [bad]: {} }, "t/x")).toThrow(`t/x: a link cannot answer \`${bad}\``);
  });
});

describe("the host's link method", () => {
  let host: Host, root: Root;
  beforeAll(async () => {
    root = new Root({
      linky: {
        "pal.json": manifest("linky", { links: { greet: { description: "Greet", params: { name: { required: true }, loud: { type: "boolean" } } }, bad: {}, level: {} } } as Partial<Manifest>),
        "index.ts": `
export default { palettes: { a: { list: () => [], pick: () => {} } },
  link: (route, params) => {
    if (route === "greet") return { hud: (params.loud ? "HELLO " : "hello ") + params.name + (params.extra ? " " + params.extra : "") };
    if (route === "bad") throw new Error("boom");
    if (route === "level") return { form: { title: "T", fields: [], submit: { id: "s", title: "S" } } };
  } };`,
      },
      mute: { "pal.json": manifest("mute", { links: { x: {} } } as Partial<Manifest>), "index.ts": `export default { palettes: { a: { list: () => [], pick: () => {} } } };` },
      undeclared: { "pal.json": manifest("undeclared"), "index.ts": `export default { palettes: { a: { list: () => [], pick: () => {} } }, link: () => ({ hud: "x" }) };` },
    });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(async () => { await host.close(); root.rm(); });

  test("a declared route reaches link() with the params coerced; the effect comes back", async () => {
    expect(await host.request<unknown>("link", { extension: "linky", route: "greet", params: { name: "Ada", loud: "1" } })).toEqual({ hud: "HELLO Ada" });
    expect(await host.request<unknown>("link", { extension: "linky", route: "greet", params: { name: "Ada", extra: "x" } })).toEqual({ hud: "hello Ada x" });
  });
  test("an undeclared route, a missing required param, a throw, a level effect, a handler-less extension are error replies", async () => {
    await expect(host.request("link", { extension: "linky", route: "nope", params: {} })).rejects.toThrow("no route linky/nope");
    await expect(host.request("link", { extension: "linky", route: "greet", params: {} })).rejects.toThrow("linky/greet: name is required");
    await expect(host.request("link", { extension: "linky", route: "bad", params: {} })).rejects.toThrow("boom");
    await expect(host.request("link", { extension: "linky", route: "level", params: {} })).rejects.toThrow("linky/level: a link cannot answer `form`");
    await expect(host.request("link", { extension: "mute", route: "x", params: {} })).rejects.toThrow("mute: no link handler for x");
    await expect(host.request("link", { extension: "undeclared", route: "x", params: {} })).rejects.toThrow("no route undeclared/x");
    await expect(host.request("link", { extension: "ghost", route: "x", params: {} })).rejects.toBeInstanceOf(HostError);
  });
  test("the load warnings carry the links check on the wire", () => {
    const by = Object.fromEntries(host.loaded().map((l) => [l.extension, l.warnings]));
    expect(by.linky).toEqual([]);
    expect(by.mute[0]).toMatch(/^links: a route is declared in pal.json but the code exports no link/);
    expect(by.undeclared[0]).toMatch(/^links: the code exports link/);
  });
});

describe("bundled extensions", () => {
  describe("over the wire", () => {
    let host: Host;
    const calls: string[] = [];
    beforeAll(async () => {
      stored.set("quicklinks\0links", [{ id: "q1", name: "GitHub search", url: "https://github.com/search?q={query}", keywords: ["gh"] }, { id: "q2", name: "Docs", url: "https://pal.cagdas.io/docs" }]);
      stored.set("expansion\0snippets", [{ id: "s1", name: "Signature", keyword: "sig", text: "Best,\nAda" }]);
      // The timer CLI pointed at nothing: a real `timer` on PATH would start one on this machine.
      host = await Host.bundled({ settings: { timer: { settings: { command: "/nonexistent/pal-test-timer" } } }, core: { "system.run": ({ id }: { id: string }) => { calls.push(`run ${id}`); return null; }, "clipboard.copy": ({ id }: { id: number }) => { calls.push(`copy ${id}`); return null; } } });
    });
    afterAll(async () => { await host.close(); });
    const link = (extension: string, route: string, params: Record<string, unknown> = {}) => host.request<Record<string, unknown>>("link", { extension, route, params });

    test("every manifest's links block is clean against its code (the host's load warnings), and each route has a description for the store", () => {
      const loaded = host.loaded();
      expect(loaded.length).toBeGreaterThan(10);
      expect(loaded.flatMap((l) => l.warnings.filter((w) => w.startsWith("links")).map((w) => `${l.extension}: ${w}`))).toEqual([]);
      const withLinks = loaded.filter((l) => l.manifest.links);
      expect(withLinks.map((l) => l.extension).sort()).toEqual(expect.arrayContaining(["clipboard", "quicklinks", "snippets", "system", "timer", "window-management"]));
      for (const l of withLinks) for (const [route, spec] of Object.entries(l.manifest.links!)) expect(spec.description, `${l.extension}/${route}`).toBeTruthy();
    });

    test("quicklinks/open: by name or keyword; a {query} link opens filled or pushes the drill-in", async () => {
      expect(await link("quicklinks", "open", { name: "docs" })).toEqual({ open: "https://pal.cagdas.io/docs" });
      expect(await link("quicklinks", "open", { name: "gh", query: "pal launcher" })).toEqual({ open: "https://github.com/search?q=pal%20launcher" });
      expect(await link("quicklinks", "open", { name: "GitHub search" })).toEqual({ push: { extension: "quicklinks", palette: "quicklinks", args: { link: "q1" } } });
      await expect(link("quicklinks", "open", { name: "nope" })).rejects.toThrow('no quicklink "nope"');
      await expect(link("quicklinks", "open", {})).rejects.toThrow("quicklinks/open: name is required");
    });
    test("snippets/paste: by name or keyword, placeholders filled; copy=1 copies", async () => {
      expect(await link("snippets", "paste", { name: "sig" })).toEqual({ paste: { text: "Best,\nAda" } });
      expect(await link("snippets", "paste", { name: "signature", copy: "true" })).toEqual({ copy: "Best,\nAda" });
      await expect(link("snippets", "paste", { name: "x" })).rejects.toThrow('no snippet "x"');
    });
    test("window-management/layout answers the layout effect for the focused window", async () => {
      expect(await link("window-management", "layout", { name: "left_half" })).toMatchObject({ layout: { name: "left_half" } });
      await expect(link("window-management", "layout", { name: "sideways" })).rejects.toThrow(/no layout "sideways"; one of left_half/);
    });
    test("system/run runs an available command by id, refuses an unknown one", async () => {
      expect(await link("system", "run", { id: "sleep" })).toEqual({});
      expect(calls).toContain("run sleep");
      await expect(link("system", "run", { id: "dnd" })).rejects.toThrow('no system command "dnd" on this machine');
    });
    test("clipboard/copy puts the nth newest entry back; out of range names the count", async () => {
      expect(await link("clipboard", "copy", { index: "1" })).toEqual({ hud: "Copied" });
      expect(calls).toContain("copy 2");
      expect(await link("clipboard", "copy", {})).toEqual({ hud: "Copied" });
      expect(calls).toContain("copy 1");
      await expect(link("clipboard", "copy", { index: "99" })).rejects.toThrow(/no history entry 99/);
      await expect(link("clipboard", "copy", { index: "x" })).rejects.toThrow("clipboard/copy: index must be a number");
    });
    test("timer/start without the CLI installed says so", async () => {
      await expect(link("timer", "start", { duration: "1m", name: "t" })).rejects.toThrow("/nonexistent/pal-test-timer is not installed");
    });
  });
});
