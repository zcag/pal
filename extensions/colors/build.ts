// Generates data.json: the named colours the grid lists, by set. Run by
// hand (`bun run extensions/colors/build.ts`) and the output is committed,
// so nothing is fetched at runtime. Sets: the CSS names (the SDK's `colors`), pal's
// own tokens (app/src/ui/tokens.css, light and dark), Tailwind's palette
// (the tailwindcss package on unpkg), Material's 2014 palette (the
// material-colors package), the Material 3 baseline tonal palettes
// (generated from the seed #6750A4 with @material/material-color-utilities,
// the library the M3 tools use, fetched from esm.sh), Catppuccin's four
// flavours (catppuccin/palette on GitHub), and the hand-kept Apple, Rosé
// Pine, Nord and Solarized tables from sets.ts.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { colors } from "@zcag/pal";
import { SETS, handKept, type Row } from "./sets.ts";
const { CSS_NAMES } = colors;

const TAILWIND = "https://unpkg.com/tailwindcss@3.4.17/lib/public/colors.js";
const MATERIAL = "https://unpkg.com/material-colors@1.2.6/dist/colors.json";
const MCU = "https://esm.sh/@material/material-color-utilities@0.3.0/es2022/material-color-utilities.bundle.mjs";
const M3_SEED = "#6750A4";
const CATPPUCCIN = "https://raw.githubusercontent.com/catppuccin/palette/v1.8.0/palette.json";
const TOKENS = join(import.meta.dir, "../../app/src/ui/tokens.css");
const OUT = join(import.meta.dir, "data.json");

const rows: Row[] = [];

for (const [n, h] of Object.entries(CSS_NAMES)) rows.push({ id: `css/${n}`, n, h, s: "css" });

// colors.js is CommonJS with a require of its own; the palette is read off the source as `name: { 50: "#hex", ... }` blocks.
const tw = await fetch(TAILWIND).then((r) => r.text());
for (const m of tw.matchAll(/^\s{4}([a-z]+): \{\n([\s\S]*?)\n\s{4}\}/gm)) {
  for (const s of m[2].matchAll(/(\d+): "(#[0-9a-f]{6})"/g)) rows.push({ id: `tw/${m[1]}-${s[1]}`, n: `${m[1]} ${s[1]}`, h: s[2], s: "tailwind" });
}
for (const m of tw.matchAll(/^\s{4}(black|white): "(#[0-9a-f]{3,6})"/gm)) rows.push({ id: `tw/${m[1]}`, n: m[1], h: m[2].length === 4 ? "#" + [...m[2].slice(1)].map((c) => c + c).join("") : m[2], s: "tailwind" });

// Material 3: the six tonal palettes of the baseline scheme at the thirteen documented tones.
const mcuFile = join(mkdtempSync(join(tmpdir(), "pal-mcu-")), "mcu.mjs");
writeFileSync(mcuFile, await fetch(MCU).then((r) => r.text()));
const mcu = await import(mcuFile) as { CorePalette: { of(argb: number): Record<string, { tone(t: number): number }> }; argbFromHex(h: string): number; hexFromArgb(a: number): string };
const core = mcu.CorePalette.of(mcu.argbFromHex(M3_SEED));
const TONES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100];
for (const [name, key] of [["primary", "a1"], ["secondary", "a2"], ["tertiary", "a3"], ["error", "error"], ["neutral", "n1"], ["neutral-variant", "n2"]]) {
  for (const t of TONES) rows.push({ id: `m3/${name}-${t}`, n: `${name.replace("-", " ")} ${t}`, h: mcu.hexFromArgb(core[key].tone(t)).toLowerCase(), s: "material3" });
}

const material = await fetch(MATERIAL).then((r) => r.json() as Promise<Record<string, Record<string, string> | string>>);
for (const [hueName, shades] of Object.entries(material)) {
  if (typeof shades !== "object") continue;
  // The text and icon entries are rgba() opacities over black or white, not palette colours.
  for (const [shade, h] of Object.entries(shades)) if (h.startsWith("#")) rows.push({ id: `md/${hueName}-${shade}`, n: `${hueName.replace(/-/g, " ")} ${shade}`, h: h.toLowerCase(), s: "material" });
}

rows.push(...handKept().filter((r) => r.s === "apple"));

type Flavour = { name: string; order: number; colors: Record<string, { hex: string; order: number }> };
const ctp = await fetch(CATPPUCCIN).then((r) => r.json() as Promise<Record<string, Flavour | string>>);
for (const [flavour, f] of Object.entries(ctp).filter((e): e is [string, Flavour] => typeof e[1] === "object").sort((a, b) => a[1].order - b[1].order)) {
  for (const [n, c] of Object.entries(f.colors).sort((a, b) => a[1].order - b[1].order)) rows.push({ id: `ctp/${flavour}/${n}`, n: `${n} (${f.name})`, h: c.hex.toLowerCase(), s: "catppuccin", v: flavour });
}

rows.push(...handKept().filter((r) => r.s !== "apple"));

// tokens.css: the hex tokens between the light-begin/end and dark-begin/end markers.
const css = readFileSync(TOKENS, "utf8");
for (const theme of ["light", "dark"] as const) {
  const block = css.slice(css.indexOf(`/* ${theme}-begin */`), css.indexOf(`/* ${theme}-end */`));
  for (const m of block.matchAll(/--pal-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    rows.push({ id: `pal/${theme}/${m[1]}`, n: `${m[1].replace(/-/g, " ")} (${theme})`, h: m[2].toLowerCase(), s: "pal", v: theme });
  }
}

const order = new Map(SETS.map((s, i) => [s.id, i]));
rows.sort((a, b) => order.get(a.s)! - order.get(b.s)!);
if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error("duplicate ids");
writeFileSync(OUT, JSON.stringify(rows) + "\n");
console.log(`${rows.length} colours -> ${OUT}\n${SETS.map((s) => `${s.title} ${rows.filter((r) => r.s === s.id).length}`).join(", ")}`);
