// What shots.mjs and host/test/screenshots.test.ts share (docs/design/screenshots.md):
// the sizes a picture must be and the stamp that ties the pictures to their fixtures.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const FIXTURES = join(ROOT, "app/src/gallery/shots");
/** Pixels: a panel shot, a bar strip, a bar popover. */
export const SIZES = { panel: [1440, 900], strip: [1440, 120], popover: [1440, 1080] };

export const fixtureOf = (name) => (existsSync(join(FIXTURES, `${name}.json`)) ? join(FIXTURES, `${name}.json`) : undefined);
export const barFixtureOf = (name) => (existsSync(join(FIXTURES, `bar-${name}.json`)) ? join(FIXTURES, `bar-${name}.json`) : undefined);

/** The fixtures' bytes, panel then bar: what `screenshots/.shots.json` records when the pictures are made from them. */
export function fixtureHash(name) {
  const h = createHash("sha256");
  for (const f of [fixtureOf(name), barFixtureOf(name)]) h.update(f ? readFileSync(f) : "-");
  return h.digest("hex").slice(0, 16);
}
