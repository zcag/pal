// The store screenshots' gates (docs/design/screenshots.md, "Gates"): every
// bundled extension's pictures are there, in both themes, at their size,
// listed with captions, and made from the fixtures as they are now. A
// failure names the extension and what to do; `make shots EXT=<name>`
// fixes most of them.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkBarItem } from "../../sdk/src/index.ts";
import { BUNDLED } from "./harness.ts";
// @ts-expect-error a plain ESM module of the app's scripts, shared with shots.mjs
import { SIZES, barFixtureOf, fixtureHash, fixtureOf } from "../../app/scripts/shots-lib.mjs";

type Shot = { caption?: string; target?: string; state?: string; popover?: boolean; palette?: string };
type Listed = { file: string; caption?: string; kind?: string };
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
/** PNG width and height from its IHDR. */
function size(file: string): [number, number] {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const extensions = readdirSync(BUNDLED).filter((e) => existsSync(join(BUNDLED, e, "pal.json"))).sort();

describe("store screenshots", () => {
  for (const ext of extensions) {
    const manifest = read(join(BUNDLED, ext, "pal.json"));
    const hasPalettes = Object.keys(manifest.palettes ?? {}).length > 0;
    const bars = Object.keys(manifest.bar ?? {});
    const panel = fixtureOf(ext) ? read(fixtureOf(ext)) : undefined;
    const bar = barFixtureOf(ext) ? read(barFixtureOf(ext)) : undefined;
    const dir = join(BUNDLED, ext, "screenshots");

    test(`${ext}: the set the manifest calls for`, () => {
      const panelShots = Object.keys(panel?.shots ?? {});
      if (hasPalettes) {
        expect(panelShots.length, `${ext} has palettes: its fixture (app/src/gallery/shots/${ext}.json) plans 2 to 6 panel shots`).toBeGreaterThanOrEqual(2);
        expect(panelShots.length, `${ext}: at most 6 panel shots`).toBeLessThanOrEqual(6);
        for (const k of panelShots) expect(k, `${ext}: a panel shot is <n>-<what>`).toMatch(/^\d+-[a-z0-9-]+$/);
      }
      if (!bars.length) {
        expect(bar, `${ext} has no bar item, so no bar fixture`).toBeUndefined();
        return;
      }
      expect(bar, `${ext} has a bar item: app/src/gallery/shots/bar-${ext}.json`).toBeDefined();
      const gen = join(BUNDLED, ext, "fixture.ts");
      expect(existsSync(gen) && /bar-/.test(readFileSync(gen, "utf8")), `${ext}: the bar fixture is written by extensions/${ext}/fixture.ts from the extension's own render and view, never by hand`).toBe(true);
      const [bext, bid] = String(bar.key).split("/");
      expect(bext, `${ext}: the bar fixture's key is <extension>/<item>`).toBe(ext);
      expect(bars, `${ext}: the bar fixture's item is declared in pal.json`).toContain(bid);
      const keys = Object.keys(bar.shots ?? {});
      for (const k of ["menubar", "popover", "sketchybar"]) expect(keys, `${ext}: the bar set has ${k}`).toContain(k);
      for (const k of keys) expect(k, `${ext}: a bar shot is menubar, popover, sketchybar, menubar-<state> or popover-<state>`).toMatch(/^(menubar|popover|sketchybar)(-[a-z0-9-]+)?$/);
      expect(keys.filter((k) => k.startsWith("popover-")).length, `${ext}: at most three extra popover states`).toBeLessThanOrEqual(3);
      expect(keys.filter((k) => k.startsWith("menubar-")).length, `${ext}: at most two extra strip states`).toBeLessThanOrEqual(2);
      const states = new Set((bar.states ?? []).map((s: { id: string }) => s.id));
      for (const [k, s] of Object.entries<Shot>(bar.shots)) {
        if (s.state) expect(states.has(s.state), `${ext}/${k}: the state ${s.state} is in the fixture's states`).toBe(true);
        expect(s.popover === true, `${ext}/${k}: only popover shots open the popover`).toBe(k.startsWith("popover"));
        expect(s.target, `${ext}/${k}: sketchybar shots on sketchybar, the rest on the menu bar`).toBe(k === "sketchybar" ? "sketchybar" : "menubar");
      }
    });

    test(`${ext}: the pictures, both themes, at their size, listed with captions`, () => {
      const planned: Listed[] = [
        ...Object.entries<Shot>(panel?.shots ?? {}).map(([k, s]) => ({ file: `${k}.png`, caption: s.caption })),
        ...Object.entries<Shot>(bar?.shots ?? {}).map(([k, s]) => ({ file: `bar-${k}.png`, caption: s.caption, kind: "bar" })),
      ];
      const listed: Listed[] = manifest.store?.screenshots ?? [];
      expect(listed, `${ext}: pal.json's store.screenshots is what the fixtures plan (make shots EXT=${ext} writes it)`).toEqual(planned);
      for (const l of listed) expect((l.caption ?? "").length, `${ext}/${l.file}: a caption`).toBeGreaterThan(10);
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")).sort() : [];
      const want = planned.flatMap((p) => [p.file, p.file.replace(/\.png$/, "-dark.png")]).sort();
      expect(files, `${ext}: screenshots/ holds exactly the planned pictures and their dark twins (make shots EXT=${ext})`).toEqual(want);
      for (const f of files) {
        const kind = !f.startsWith("bar-") ? "panel" : f.startsWith("bar-popover") ? "popover" : "strip";
        expect(size(join(dir, f)), `${ext}/${f}: a ${kind} picture is ${SIZES[kind].join(" by ")}`).toEqual(SIZES[kind]);
      }
    });

    test(`${ext}: made from the fixtures as they are now`, () => {
      if (!panel && !bar) return;
      const stamp = existsSync(join(dir, ".shots.json")) ? read(join(dir, ".shots.json")).fixtures : "none";
      expect(stamp, `${ext}: a fixture changed after the pictures were made: make shots EXT=${ext}`).toBe(fixtureHash(ext));
    });

    if (bars.length) test(`${ext}: every bar item has mocks Settings can preview`, () => {
      for (const id of bars) {
        const mocks = Object.entries<{ item: unknown }>(manifest.bar[id].mocks ?? {});
        expect(mocks.length, `${ext}/${id}: pal.json's bar.${id}.mocks has at least one state to preview`).toBeGreaterThan(0);
        for (const [m, mock] of mocks) expect(() => checkBarItem(mock.item, `${ext}/${id}@${m}`)).not.toThrow();
      }
    });
  }
});
