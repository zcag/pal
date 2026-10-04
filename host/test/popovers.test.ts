// A bar popover scrolls (`.pal-view` is `overflow: auto`, the window's
// height capped by the core), so it never omits rows: no "and N more in
// pal" line, no per-section row cap, no "newest N". This reads every
// of pal's extensions' sources and fails on the two shapes the caps took.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { extensionsByName } from "./harness.ts";

const sources = () => [...extensionsByName()].flatMap(([name, dir]) => readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => ({ f: `${name}/${f}`, path: `${dir}/${f}` })));

describe("bar popovers", () => {
  test("no extension caps a popover's rows or says 'and N more in pal': the popover scrolls", () => {
    const hits = sources().flatMap(({ f, path }) => {
      const s = readFileSync(path, "utf8");
      return [/more in pal/.test(s) && `${f}: "more in pal"`, /slice\(0, (BAR_ROWS|SECTION_ROWS|ROWS)\)/.test(s) && `${f}: a row cap`].filter(Boolean);
    });
    expect(hits).toEqual([]);
  });
});
