// Generates data.json: every Nerd Font glyph by set, from the release's
// glyphnames.json. Run by hand (`bun run extensions/icons/build.ts`) and
// the output is committed. The version pinned here is the one the app
// bundles (app/src/assets/fonts/LICENSES), so every code point listed has
// a glyph in the font the tiles are drawn with.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const VERSION = "3.5.1";
const URL = `https://raw.githubusercontent.com/ryanoasis/nerd-fonts/v${VERSION}/glyphnames.json`;
const OUT = join(import.meta.dir, "data.json");

type Glyphs = Record<string, { char: string; code: string } | { version: string }>;
const glyphs = (await fetch(URL).then((r) => r.json())) as Glyphs;
const meta = glyphs.METADATA as { version: string };
if (meta.version !== VERSION) throw new Error(`glyphnames.json says ${meta.version}, expected ${VERSION}`);

/** `sets[set]` is `[name, code]` pairs in the file's order: `md-account` is `["account", "f0004"]` under `md`. */
const sets: Record<string, [string, string][]> = {};
for (const [key, v] of Object.entries(glyphs)) {
  if (key === "METADATA" || !("code" in v)) continue;
  const i = key.indexOf("-");
  const set = key.slice(0, i), name = key.slice(i + 1);
  (sets[set] ??= []).push([name, v.code]);
}

writeFileSync(OUT, JSON.stringify({ version: VERSION, sets }) + "\n");
const n = Object.values(sets).reduce((a, s) => a + s.length, 0);
console.log(`${n} glyphs in ${Object.keys(sets).length} sets -> ${OUT}\n${Object.entries(sets).map(([s, g]) => `${s} ${g.length}`).join(", ")}`);
