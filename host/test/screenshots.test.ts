// The store screenshots' gates (docs/design/screenshots.md, "Gates"): every
// bundled extension's pictures are there, in both themes, at their size,
// listed with captions, and made from the fixtures as they are now. A
// failure names the extension and what to do; `make shots EXT=<name>`
// fixes most of them.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkBarItem } from "../../sdk/src/index.ts";
import { extensionsByName } from "./harness.ts";
// @ts-expect-error a plain ESM module of the app's scripts, shared with shots.mjs
import { SIZES, barFixtureOf, fixtureHash, fixtureOf } from "../../app/scripts/shots-lib.mjs";

type Shot = { caption?: string; target?: string; state?: string; popover?: boolean; palette?: string; cover?: number[] };
type Listed = { file: string; caption?: string; kind?: string; box?: number[]; cover?: number[] };
const read = (f: string) => JSON.parse(readFileSync(f, "utf8"));
/** PNG width and height from its IHDR. */
function size(file: string): [number, number] {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const extensions = [...extensionsByName()].sort(([a], [b]) => a.localeCompare(b));

describe("store screenshots", () => {
  for (const [ext, extDir] of extensions) {
    const manifest = read(join(extDir, "pal.json"));
    const hasPalettes = Object.keys(manifest.palettes ?? {}).length > 0;
    const bars = Object.keys(manifest.bar ?? {});
    const panel = fixtureOf(ext) ? read(fixtureOf(ext)) : undefined;
    const bar = barFixtureOf(ext) ? read(barFixtureOf(ext)) : undefined;
    const dir = join(extDir, "screenshots");

    test(`${ext}: the set the manifest calls for`, () => {
      const panelShots = Object.keys(panel?.shots ?? {});
      if (hasPalettes) {
        expect(panelShots.length, `${ext} has palettes: its fixture (test/shots/${ext}.json) plans 2 to 6 panel shots`).toBeGreaterThanOrEqual(2);
        expect(panelShots.length, `${ext}: at most 6 panel shots`).toBeLessThanOrEqual(6);
        for (const k of panelShots) expect(k, `${ext}: a panel shot is <n>-<what>`).toMatch(/^\d+-[a-z0-9-]+$/);
      }
      if (!bars.length) {
        expect(bar, `${ext} has no bar item, so no bar fixture`).toBeUndefined();
        return;
      }
      expect(bar, `${ext} has a bar item: test/shots/bar-${ext}.json`).toBeDefined();
      const gen = join(extDir, "fixture.ts");
      expect(existsSync(gen) && /bar-/.test(readFileSync(gen, "utf8")), `${ext}: the bar fixture is written by ${ext}/fixture.ts from the extension's own render and view, never by hand`).toBe(true);
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
        ...Object.entries<Shot>(panel?.shots ?? {}).map(([k, s]) => ({ file: `${k}.png`, caption: s.caption, ...(s.cover && { cover: s.cover }) })),
        ...Object.entries<Shot>(bar?.shots ?? {}).map(([k, s]) => ({ file: `bar-${k}.png`, caption: s.caption, kind: "bar" })),
      ];
      const listed: Listed[] = manifest.store?.screenshots ?? [];
      expect(listed.map(({ box: _, ...l }) => l), `${ext}: pal.json's store.screenshots is what the fixtures plan (make shots EXT=${ext} writes it)`).toEqual(planned);
      for (const l of listed) expect((l.caption ?? "").length, `${ext}/${l.file}: a caption`).toBeGreaterThan(10);
      // A popover says where it sits on its canvas (the store crops to it), inside the picture; nothing else has a box.
      for (const l of listed) {
        if (!l.file.startsWith("bar-popover")) { expect(l.box, `${ext}/${l.file}: only a popover has a box`).toBeUndefined(); continue; }
        const [x, y, w, h] = l.box ?? [];
        expect(l.box?.length === 4 && [x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= SIZES.popover[0] && y + h <= SIZES.popover[1], `${ext}/${l.file}: box is [x, y, width, height] inside the picture (make shots EXT=${ext})`).toBe(true);
      }
      // A game's cover (what Games draws its tile from): one panel shot at most, a crop inside the picture, no narrower than the panel's body.
      const covers = listed.filter((l) => l.cover);
      expect(covers.length, `${ext}: one shot at most is the cover`).toBeLessThanOrEqual(1);
      for (const l of covers) {
        const [x, y, w, h] = l.cover!;
        expect(!l.kind && l.cover!.length === 4 && [x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= SIZES.panel[0] && y + h <= SIZES.panel[1], `${ext}/${l.file}: cover is [x, y, width, height] inside a panel picture`).toBe(true);
        expect(w / h, `${ext}/${l.file}: a cover is about 2:1, the shape Games draws it in`).toBeGreaterThan(1.6);
        expect(w / h, `${ext}/${l.file}: a cover is about 2:1, the shape Games draws it in`).toBeLessThan(2.5);
      }
      const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".png")).sort() : [];
      const want = planned.flatMap((p) => [p.file, p.file.replace(/\.png$/, "-dark.png")]).sort();
      expect(files, `${ext}: screenshots/ holds exactly the planned pictures and their dark twins (make shots EXT=${ext})`).toEqual(want);
      for (const f of files) {
        const kind = !f.startsWith("bar-") ? "panel" : f.startsWith("bar-popover") ? "popover" : "strip";
        expect(size(join(dir, f)), `${ext}/${f}: a ${kind} picture is ${SIZES[kind].join(" by ")}`).toEqual(SIZES[kind]);
      }
    });

    const gen = join(extDir, "fixture.ts");
    if (existsSync(gen)) test(`${ext}: the generator pins the clock`, () => {
      const code = readFileSync(gen, "utf8");
      expect(/fixture-kit\.ts/.test(code) && /\bpinClock\(|\bNOW(_S)?\b/.test(code), `${ext}: fixture.ts takes its clock from app/scripts/fixture-kit.ts (NOW, and pinClock() before a Host)`).toBe(true);
      expect(/Date\.now\(\)/.test(code), `${ext}: fixture.ts reads the real clock (Date.now()); use fixture-kit's NOW, so the pictures are the same tomorrow`).toBe(false);
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
