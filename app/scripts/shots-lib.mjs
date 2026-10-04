// What shots.mjs and host/test/screenshots.test.ts share (docs/design/screenshots.md):
// the sizes a picture must be and the stamp that ties the pictures to their fixtures.
// An extension's fixtures are in its repo's `test/shots/` (extension-repos.mjs).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PAL, extensionDirs } from "./extension-repos.mjs";

export const ROOT = PAL;
/** fixture-kit.ts's clock and zone: the page the shots are taken of runs at this instant, in this zone, so "2w ago" and "in 12 min" are the same every time. */
export const NOW = Date.UTC(2026, 8, 16, 11, 32, 0);
export const TZ = "Europe/Istanbul";
/** Pixels: a panel shot, a bar strip, a bar popover. */
export const SIZES = { panel: [1440, 900], strip: [1440, 120], popover: [1440, 1080] };

let dirs;
/** Every extension in the repos: `{ dir, repo }` by name (read once). */
export const extensions = () => (dirs ??= extensionDirs());
const fixture = (name, file) => {
  const shots = extensions().get(name)?.repo.shots;
  return shots && existsSync(join(shots, file)) ? join(shots, file) : undefined;
};
export const fixtureOf = (name) => fixture(name, `${name}.json`);
export const barFixtureOf = (name) => fixture(name, `bar-${name}.json`);

/** The fixtures' bytes, panel then bar: what `screenshots/.shots.json` records when the pictures are made from them. */
export function fixtureHash(name) {
  const h = createHash("sha256");
  for (const f of [fixtureOf(name), barFixtureOf(name)]) h.update(f ? readFileSync(f) : "-");
  return h.digest("hex").slice(0, 16);
}
