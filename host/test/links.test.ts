// Extension links (docs/design/links.md): `checkLinks` against the manifest
// and the code, `checkLinkParams` coercing a query string by the declared
// types, `checkLinkEffect` refusing what needs a level, the host's `link`
// method end to end on a fixture, and every loaded extension's links block
// (their routes are tested in their own repos).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkLinkEffect, checkLinkParams, checkLinks } from "../../sdk/src/manifest.ts";
import type { Extension, Manifest } from "../../sdk/src/protocol.ts";
import { Host, HostError, Root, manifest } from "./harness.ts";

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

describe("the extension repos' extensions", () => {
  // Every manifest's links block held to its code, as the host loads them: whichever extension repos this run reads.
  test("every manifest's links block is clean against its code (the host's load warnings), and each route has a description for the store", async () => {
    const host = await Host.bundled();
    try {
      const loaded = host.loaded();
      expect(loaded.flatMap((l) => l.warnings.filter((w) => w.startsWith("links")).map((w) => `${l.extension}: ${w}`))).toEqual([]);
      for (const l of loaded.filter((l) => l.manifest.links)) for (const [route, spec] of Object.entries(l.manifest.links!)) expect(spec.description, `${l.extension}/${route}`).toBeTruthy();
    } finally {
      await host.close();
    }
  });
});
