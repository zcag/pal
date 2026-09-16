// Where a palette is described (sdk/src/manifest.ts): the manifest and the
// code name the same palettes and agree on `kind`, `title` and `ttl`, or
// the host says where they differ. `checkPalettes` as a table, the host
// carrying its warnings on the wire, and the bundled extensions all clean.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { checkPalettes, kindOf, paletteMeta } from "../../sdk/src/manifest.ts";
import type { Extension, Manifest, ManifestPalette, Palette } from "../../sdk/src/protocol.ts";
import { BUNDLED, Host, Root, manifest, simpleExt } from "./harness.ts";

const rows = () => [{ id: "a", name: "A" }];
const pick = () => {};
const list: Palette = { title: "List", list: rows, pick };
const live: Palette = { title: "Live", live: true, list: rows, pick };
const input: Palette = { title: "Input", input: true, list: rows, pick };
const grid: Palette = { title: "Grid", view: "grid", list: rows, pick };
const view: Palette = { title: "View", view: () => ({ tree: { type: "divider" }, actions: [] }), pick };

const ext = (palettes: Record<string, Palette>): Extension => ({ palettes });
const man = (palettes?: Manifest["palettes"]): Manifest => ({ name: "x", title: "X", ...(palettes && { palettes }) });

describe("kindOf", () => {
  test("view, grid, input, live, list, first match wins", () => {
    expect(kindOf(view)).toBe("view");
    expect(kindOf(grid)).toBe("grid");
    expect(kindOf(input)).toBe("input");
    expect(kindOf(live)).toBe("live");
    expect(kindOf(list)).toBe("list");
    expect(kindOf({ ...list, view: "list" })).toBe("list");
  });
  test("a live input palette is input (nothing of it is indexed); a live grid is grid", () => {
    expect(kindOf({ ...input, live: true })).toBe("input");
    expect(kindOf({ ...grid, live: true })).toBe("grid");
  });
});

describe("checkPalettes", () => {
  test("agreeing on every key, kind, title and ttl: no warnings, one meta per palette", () => {
    const r = checkPalettes(man({ a: { kind: "live", title: "Live", ttl: 5 }, b: { kind: "view" } }), ext({ a: { ...live, ttl: 5 }, b: view }));
    expect(r.warnings).toEqual([]);
    expect(r.metas.map((m) => m.name)).toEqual(["a", "b"]);
    expect(r.metas[0]).toMatchObject({ title: "Live", live: true, input: false, ttl: 5 });
    expect(r.metas[1]).toMatchObject({ title: "View", live: false, input: true, view: "view" });
  });

  test("a manifest entry without kind, title or ttl is fine: the code's values serve", () => {
    const r = checkPalettes(man({ a: {} }), ext({ a: { ...grid, ttl: 9 } }));
    expect(r.warnings).toEqual([]);
    expect(r.metas[0]).toMatchObject({ title: "Grid", view: "grid", ttl: 9 });
  });

  test("a code palette the manifest lacks is served from the code, with a warning naming the entry to add", () => {
    const r = checkPalettes(man({ a: { kind: "list" } }), ext({ a: list, b: input }));
    expect(r.warnings).toEqual(['palettes.b: in the code but not in pal.json; add "b": { "kind": "input" } to its "palettes"']);
    expect(r.metas.map((m) => m.name)).toEqual(["a", "b"]);
    expect(r.metas[1]).toMatchObject({ title: "Input", input: true });
  });

  test("a manifest palette the code lacks is not served, with a warning", () => {
    const r = checkPalettes(man({ a: { kind: "list" }, ghost: { kind: "list", title: "Ghost" } }), ext({ a: list }));
    expect(r.warnings).toEqual(["palettes.ghost: in pal.json but not in the code; nothing serves it"]);
    expect(r.metas.map((m) => m.name)).toEqual(["a"]);
  });

  test("an empty palettes block declares nothing, so every code palette is missing from it", () => {
    expect(checkPalettes(man({}), ext({ a: list })).warnings).toHaveLength(1);
  });

  test("no palettes key at all is a dynamic extension: served from the code, no warnings", () => {
    const r = checkPalettes(man(), ext({ a: list, b: live }));
    expect(r.warnings).toEqual([]);
    expect(r.metas.map((m) => m.name)).toEqual(["a", "b"]);
  });

  test("kind mismatch each way: the warning says how the code spells it and what to set", () => {
    const table: [Palette, ManifestPalette["kind"], string][] = [
      [live, "list", 'palettes.p: kind "list" in pal.json but the code is live: true; set "kind": "live", or make the code a plain list (neither live, input, grid nor view)'],
      [list, "live", 'palettes.p: kind "live" in pal.json but the code is a plain list (neither live, input, grid nor view); set "kind": "list", or make the code live: true'],
      [input, "live", 'palettes.p: kind "live" in pal.json but the code is input: true; set "kind": "input", or make the code live: true'],
      [live, "input", 'palettes.p: kind "input" in pal.json but the code is live: true; set "kind": "live", or make the code input: true'],
      [grid, "list", 'palettes.p: kind "list" in pal.json but the code is view: "grid"; set "kind": "grid", or make the code a plain list (neither live, input, grid nor view)'],
      [list, "grid", 'palettes.p: kind "grid" in pal.json but the code is a plain list (neither live, input, grid nor view); set "kind": "list", or make the code view: "grid"'],
      [view, "list", 'palettes.p: kind "list" in pal.json but the code is a view() palette; set "kind": "view", or make the code a plain list (neither live, input, grid nor view)'],
      [list, "view", 'palettes.p: kind "view" in pal.json but the code is a plain list (neither live, input, grid nor view); set "kind": "list", or make the code a view() palette'],
    ];
    for (const [p, kind, warning] of table) {
      const r = checkPalettes(man({ p: { kind } }), ext({ p }));
      expect(r.warnings).toEqual([warning]);
      expect(r.metas).toHaveLength(1);
    }
  });

  test("a kind that is not one of the five is refused by name", () => {
    const r = checkPalettes(man({ p: { kind: "table" as any } }), ext({ p: list }));
    expect(r.warnings).toEqual(['palettes.p: kind "table" is not one of list, live, input, grid, view; the code is a plain list (neither live, input, grid nor view), set "kind": "list"']);
  });

  test("title on both sides: the manifest's is served, a difference is a warning", () => {
    const same = checkPalettes(man({ p: { title: "List" } }), ext({ p: list }));
    expect(same.warnings).toEqual([]);
    expect(same.metas[0].title).toBe("List");
    const differ = checkPalettes(man({ p: { title: "Rows" } }), ext({ p: list }));
    expect(differ.warnings).toEqual(['palettes.p: title "List" in the code, "Rows" in pal.json; the manifest\'s is used, drop the code\'s']);
    expect(differ.metas[0].title).toBe("Rows");
    // The key stands in when neither has one.
    expect(checkPalettes(man({ p: {} }), ext({ p: { list: rows, pick } })).metas[0].title).toBe("p");
  });

  test("ttl on both sides: the manifest's is served, a difference is a warning", () => {
    expect(checkPalettes(man({ p: { ttl: 60 } }), ext({ p: { ...list, ttl: 60 } })).warnings).toEqual([]);
    const differ = checkPalettes(man({ p: { ttl: 60 } }), ext({ p: { ...list, ttl: 10 } }));
    expect(differ.warnings).toEqual(["palettes.p: ttl 10 in the code, 60 in pal.json; the manifest's is used, drop the code's"]);
    expect(differ.metas[0].ttl).toBe(60);
    expect(checkPalettes(man({ p: { ttl: 60 } }), ext({ p: list })).metas[0].ttl).toBe(60);
    expect(checkPalettes(man({ p: {} }), ext({ p: { ...list, ttl: 10 } })).metas[0].ttl).toBe(10);
  });

  test("tier on both sides: the manifest's is served, a difference is a warning", () => {
    expect(checkPalettes(man({ p: { tier: "catalog" } }), ext({ p: { ...list, tier: "catalog" } })).warnings).toEqual([]);
    const differ = checkPalettes(man({ p: { tier: "catalog" } }), ext({ p: { ...list, tier: "primary" } }));
    expect(differ.warnings).toEqual(['palettes.p: tier "primary" in the code, "catalog" in pal.json; the manifest\'s is used, drop the code\'s']);
    expect(differ.metas[0].tier).toBe("catalog");
    expect(checkPalettes(man({ p: { tier: "primary" } }), ext({ p: list })).metas[0].tier).toBe("primary");
    expect(checkPalettes(man({ p: {} }), ext({ p: { ...list, tier: "catalog" } })).metas[0].tier).toBe("catalog");
    expect(checkPalettes(man({ p: {} }), ext({ p: list })).metas[0].tier).toBeUndefined();
  });

  test("several disagreements on one palette are several warnings", () => {
    const r = checkPalettes(man({ p: { kind: "list", title: "T", ttl: 1 } }), ext({ p: { ...live, ttl: 2 } }));
    expect(r.warnings.map((w) => w.split(":")[1].trim().split(" ")[0])).toEqual(["kind", "title", "ttl"]);
  });

  test("paletteMeta: the code's flags, the manifest's title and ttl over the code's", () => {
    expect(paletteMeta("p", { ...grid, columns: 8, placeholder: "Type", showDetail: true, icon: "★", detail: () => ({}) }, { title: "M", ttl: 3 })).toEqual({
      name: "p", title: "M", live: false, input: false, icon: "★", view: "grid", columns: 8, placeholder: "Type", showDetail: true, filters: undefined, detail: "lazy", ttl: 3,
    });
  });
});

describe("the host carries the warnings", () => {
  let root: Root;
  let host: Host;
  beforeAll(async () => {
    root = new Root({
      drift: {
        "index.ts": simpleExt("rows", { extra: "live: true, ttl: 10," }),
        "pal.json": manifest("drift", { palettes: { rows: { kind: "list", ttl: 60 }, ghost: { kind: "list", title: "Ghost" } } }),
      },
      clean: {
        "index.ts": simpleExt("clean", { extra: "input: true," }),
        "pal.json": manifest("clean", { palettes: { clean: { kind: "input", title: "clean" } } }),
      },
    });
    host = await Host.start({ roots: [root.dir] });
  });
  afterAll(() => { host.kill(); root.rm(); });

  test("extension/loaded: warnings per disagreement, the manifest-only palette not among the metas, the manifest's ttl served", () => {
    const l = host.loaded().find((l) => l.extension === "drift")!;
    expect(l.warnings).toEqual([
      'palettes.rows: kind "list" in pal.json but the code is live: true; set "kind": "live", or make the code a plain list (neither live, input, grid nor view)',
      "palettes.rows: ttl 10 in the code, 60 in pal.json; the manifest's is used, drop the code's",
      "palettes.ghost: in pal.json but not in the code; nothing serves it",
    ]);
    expect(l.palettes.map((p) => p.name)).toEqual(["rows"]);
    expect(l.palettes[0].ttl).toBe(60);
    expect(host.loaded().find((l) => l.extension === "clean")!.warnings).toEqual([]);
  });

  test("each warning is a `[<ext>] manifest:` line on stderr", () => {
    expect(host.stderr).toContain('[drift] manifest: palettes.rows: kind "list" in pal.json');
    expect(host.stderr).toContain("[drift] manifest: palettes.ghost: in pal.json but not in the code");
    expect(host.stderr).not.toContain("[clean] manifest:");
  });

  test("hello repeats them, and the manifest-only palette is not served", async () => {
    const h = await host.hello();
    expect(h.extensions.find((e) => e.name === "drift")!.warnings).toHaveLength(3);
    expect(h.extensions.find((e) => e.name === "clean")!.warnings).toEqual([]);
    expect((await host.call("list", { extension: "drift", palette: "ghost" })).error).toBe("no palette drift/ghost");
    expect(await host.list("drift", "rows")).toEqual([{ id: "a", name: "A" }]);
  });

  test("a reload that fixes the manifest clears the warnings", async () => {
    const again = host.next("extension/loaded", (p) => p.extension === "drift");
    root.write("drift", "pal.json", manifest("drift", { palettes: { rows: { kind: "live", ttl: 10 } } }));
    expect((((await again).params) as { warnings: string[] }).warnings).toEqual([]);
  });
});

describe("the bundled extensions", () => {
  test("every one agrees with its manifest: no warnings, every manifest palette served", async () => {
    const host = await Host.bundled();
    try {
      // Every directory with an entry file (one without is not an extension yet).
      const dirs = readdirSync(BUNDLED, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules" && ["index.ts", "index.js"].some((f) => existsSync(`${BUNDLED}/${d.name}/${f}`)))
        .map((d) => d.name).sort();
      const loaded = host.loaded();
      expect(loaded.map((l) => l.extension).sort()).toEqual(dirs);
      const drift = Object.fromEntries(loaded.filter((l) => l.warnings.length).map((l) => [l.extension, l.warnings]));
      expect(drift).toEqual({});
      for (const l of loaded) {
        for (const key of Object.keys(l.manifest.palettes ?? {})) expect(l.palettes.map((p) => p.name)).toContain(key);
      }
    } finally {
      host.kill();
    }
  }, 30_000);
});
