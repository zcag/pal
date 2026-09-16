// The root's sections that come from the extensions (sdk/src/manifest.ts,
// host.ts `inline`/`fallback`/`suggest`): what a palette declares
// (`match` + `inline`, `fallback`, `suggest`) rides in its meta, the host
// matches the query and asks the palettes that answer, each on its own
// timeout, and a palette that fails or is late is left out.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { checkPalettes, inlineMatches, paletteMeta } from "../../sdk/src/manifest.ts";
import type { Palette } from "../../sdk/src/protocol.ts";
import { Host, Root, manifest } from "./harness.ts";

const rows = () => [{ id: "a", name: "A" }];
const pick = () => {};
const input: Palette = { title: "Input", input: true, list: rows, pick };

describe("paletteMeta: the root section flags", () => {
  test("inline needs a match; a regex, a string or the manifest's string rides as the source, a predicate only as inline", () => {
    expect(paletteMeta("p", { ...input, inline: true })).not.toHaveProperty("inline");
    expect(paletteMeta("p", { ...input, inline: true, match: /^\d/ })).toMatchObject({ inline: true, match: "^\\d" });
    expect(paletteMeta("p", { ...input, inline: true, match: "^~" })).toMatchObject({ inline: true, match: "^~" });
    expect(paletteMeta("p", { ...input, inline: true, match: (q) => q.length > 2 })).toMatchObject({ inline: true });
    expect(paletteMeta("p", { ...input, inline: true, match: (q) => q.length > 2 }, { match: "documented" })).toMatchObject({ inline: true, match: "documented" });
    expect(paletteMeta("p", { ...input, match: /x/ }, { inline: true })).toMatchObject({ inline: true, match: "x" });
    expect(paletteMeta("p", input, { inline: true })).not.toHaveProperty("inline");
  });
  test("fallback: true is an ask row, a string its title, a function rows; the manifest may say true or a title", () => {
    expect(paletteMeta("p", { ...input, fallback: true })).toMatchObject({ fallback: "ask" });
    expect(paletteMeta("p", { ...input, fallback: "Search “{query}”" })).toMatchObject({ fallback: "ask", fallbackTitle: "Search “{query}”" });
    expect(paletteMeta("p", { ...input, fallback: () => [] })).toMatchObject({ fallback: "rows" });
    expect(paletteMeta("p", { ...input, fallback: () => [] }, { fallback: true })).toMatchObject({ fallback: "rows" });
    expect(paletteMeta("p", input, { fallback: "Ask {query}" })).toMatchObject({ fallback: "ask", fallbackTitle: "Ask {query}" });
    expect(paletteMeta("p", { ...input, fallback: "  " })).not.toHaveProperty("fallback");
    expect(paletteMeta("p", input)).not.toHaveProperty("fallback");
  });
  test("suggest is a flag; checkPalettes carries all three through", () => {
    expect(paletteMeta("p", { ...input, suggest: () => [] })).toMatchObject({ suggest: true });
    const r = checkPalettes({ name: "x", title: "X", palettes: { p: { kind: "input", match: "^#" } } }, { palettes: { p: { ...input, inline: true, fallback: true, suggest: () => [] } } });
    expect(r.warnings).toEqual([]);
    expect(r.metas[0]).toMatchObject({ inline: true, match: "^#", fallback: "ask", suggest: true });
  });
});

describe("inlineMatches", () => {
  test("never for an empty query or a non-inline palette; predicate, regex, string and the manifest's string all work; a bad regex matches nothing", () => {
    const re: Palette = { ...input, inline: true, match: /^\d+$/ };
    expect(inlineMatches(re, undefined, "42")).toBe(true);
    expect(inlineMatches(re, undefined, "x")).toBe(false);
    expect(inlineMatches(re, undefined, "  ")).toBe(false);
    expect(inlineMatches({ ...input, match: /^\d+$/ }, undefined, "42")).toBe(false);
    expect(inlineMatches({ ...input, inline: true, match: (q) => q.startsWith("!") }, undefined, "!x")).toBe(true);
    expect(inlineMatches({ ...input, inline: true, match: () => { throw new Error("no"); } }, undefined, "x")).toBe(false);
    expect(inlineMatches({ ...input, inline: true, match: "^[A-Z]" }, undefined, "abc")).toBe(true);
    expect(inlineMatches({ ...input, inline: true }, { match: "^~" }, "~/x")).toBe(true);
    expect(inlineMatches({ ...input, inline: true }, { match: "(" }, "(")).toBe(false);
  });
});

describe("the host's root sections", () => {
  let host: Host;
  let root: Root;
  beforeAll(async () => {
    process.env.PAL_ROOT_TIMEOUT_MS = "300";
    root = new Root({
      nums: {
        "pal.json": manifest("nums", { palettes: { nums: { kind: "input", match: "^\\d" }, slow: { kind: "input" } } }),
        "index.ts": `
export default { palettes: {
  nums: {
    title: "Numbers", input: true, inline: true, fallback: true,
    list: (q, ctx) => [{ id: "n", name: "number " + q + (ctx?.inline ? " inline" : "") }, ...Array.from({ length: 9 }, (_, i) => ({ id: "x" + i, name: "more" }))],
    pick: (id) => ({ copy: id }),
    suggest: () => [{ id: "s", name: "suggested", section: "Numbers now" }],
  },
  slow: {
    title: "Slow", input: true, inline: true, match: /./,
    list: () => new Promise((r) => setTimeout(() => r([{ id: "late", name: "late" }]), 2000)),
    pick: () => {},
    suggest: () => { throw new Error("boom"); },
    fallback: async (q) => [{ id: "f:" + q, name: "fallback for " + q }],
  },
} };`,
      },
      plain: { "index.ts": `export default { palettes: { plain: { title: "Plain", list: () => [], pick: () => {} } } };` },
    });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(() => { host.kill(); root.rm(); delete process.env.PAL_ROOT_TIMEOUT_MS; });

  test("metas say who takes part", () => {
    const metas = host.loaded().find((l) => l.extension === "nums")!.palettes;
    expect(metas.find((m) => m.name === "nums")).toMatchObject({ inline: true, match: "^\\d", fallback: "ask", suggest: true });
    expect(metas.find((m) => m.name === "slow")).toMatchObject({ inline: true, match: ".", fallback: "rows", suggest: true });
    expect(host.loaded().find((l) => l.extension === "plain")!.palettes[0]).not.toHaveProperty("inline");
  });

  test("inline: the palettes whose match accepts the query list it with ctx.inline, five rows at most; a late one is left out", async () => {
    const r = await host.request<{ extension: string; palette: string; items: { id: string; name: string }[] }[]>("inline", { query: "42" });
    expect(r.map((s) => `${s.extension}/${s.palette}`)).toEqual(["nums/nums"]);
    expect(r[0].items[0]).toEqual({ id: "n", name: "number 42 inline" });
    expect(r[0].items.length).toBe(5);
    expect(await host.request<unknown[]>("inline", { query: "abc" })).toEqual([]);
    expect(await host.request<unknown[]>("inline", { query: "" })).toEqual([]);
    expect(host.stderr).toContain("inline nums/slow failed");
  });

  test("fallback: only the palettes with a function answer, given the query", async () => {
    const r = await host.request<{ extension: string; palette: string; items: { id: string; name: string }[] }[]>("fallback", { query: "tax" });
    expect(r).toEqual([{ extension: "nums", palette: "slow", items: [{ id: "f:tax", name: "fallback for tax" }] }]);
  });

  test("suggest: every suggesting palette, a failing one logged and left out", async () => {
    const r = await host.request<{ extension: string; palette: string; items: { id: string; name: string; section?: string }[] }[]>("suggest");
    expect(r).toEqual([{ extension: "nums", palette: "nums", items: [{ id: "s", name: "suggested", section: "Numbers now" }] }]);
    expect(host.stderr).toContain("suggest nums/slow failed: boom");
  });
});
