/// <reference types="node" />
// The files as written: vitest hands a CSS import (even `?raw`) over empty.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGNS } from "../designs";

const dir = new URL("../designs/", import.meta.url);
const css = (id: string) => readFileSync(new URL(`${id}.css`, dir), "utf8");
/** The custom properties a rule block sets, by the block's selector. */
const block = (text: string, selector: string) => {
  const at = text.indexOf(`${selector} {`);
  if (at < 0) return new Map<string, string>();
  const body = text.slice(at, text.indexOf("}", at));
  return new Map([...body.matchAll(/(--pal-[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
};
const colourish = (v: string) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v);

describe("designs", () => {
  it("every CSS file is listed, and every listed design has one", () => {
    const ids = readdirSync(dir).filter((f) => f.endsWith(".css")).map((f) => f.slice(0, -".css".length)).sort();
    expect(ids).toEqual(DESIGNS.filter((d) => !d.bare).map((d) => d.id).sort());
  });

  for (const d of DESIGNS.filter((d) => !d.bare)) {
    it(`${d.id}: the dark blocks set every colour the light one does, the same in both`, () => {
      const text = css(d.id);
      const light = block(text, `[data-design~="${d.id}"],\n[data-design~="${d.id}"][data-theme="light"],\n[data-design~="${d.id}"] [data-theme="light"]`);
      const media = block(text, `  [data-design~="${d.id}"]:not([data-theme="light"])`);
      const pinned = block(text, `[data-design~="${d.id}"][data-theme="dark"],\n[data-design~="${d.id}"] [data-theme="dark"]`);
      const colours = [...light].filter(([, v]) => colourish(v)).map(([k]) => k);
      expect(colours.length).toBeGreaterThan(0);
      for (const k of colours) {
        expect(media.has(k), `${k} under the OS's dark`).toBe(true);
        expect(pinned.has(k), `${k} under data-theme="dark"`).toBe(true);
      }
      expect([...media]).toEqual([...pinned]);
    });
  }
});
