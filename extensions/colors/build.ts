// Generates data.json: the named colours the palette lists, by section.
// Run by hand (`bun run extensions/colors/build.ts`) and the output is
// committed, so nothing is fetched at runtime. Sections: the CSS names
// (color.ts), pal's own tokens (app/src/ui/tokens.css, light and dark),
// Tailwind's palette (the tailwindcss package on unpkg), Material's 2014
// palette (the material-colors package).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CSS_NAMES } from "./color.ts";

const TAILWIND = "https://unpkg.com/tailwindcss@3.4.17/lib/public/colors.js";
const MATERIAL = "https://unpkg.com/material-colors@1.2.6/dist/colors.json";
const TOKENS = join(import.meta.dir, "../../app/src/ui/tokens.css");
const OUT = join(import.meta.dir, "data.json");

/** One row: `id` unique across sections, `n` the name, `h` the hex, `s` the section. */
type Row = { id: string; n: string; h: string; s: string };
const rows: Row[] = [];

for (const [n, h] of Object.entries(CSS_NAMES)) rows.push({ id: `css/${n}`, n, h, s: "CSS" });

// tokens.css: the hex tokens between the light-begin/end and dark-begin/end markers.
const css = readFileSync(TOKENS, "utf8");
for (const theme of ["light", "dark"] as const) {
  const block = css.slice(css.indexOf(`/* ${theme}-begin */`), css.indexOf(`/* ${theme}-end */`));
  for (const m of block.matchAll(/--pal-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
    const n = m[1].replace(/-/g, " ");
    rows.push({ id: `pal/${theme}/${m[1]}`, n: `${n} (${theme})`, h: m[2].toLowerCase(), s: "pal tokens" });
  }
}

// colors.js is CommonJS with a require of its own; the palette is read off the source as `name: { 50: "#hex", ... }` blocks.
const tw = await fetch(TAILWIND).then((r) => r.text());
for (const m of tw.matchAll(/^\s{4}([a-z]+): \{\n([\s\S]*?)\n\s{4}\}/gm)) {
  for (const s of m[2].matchAll(/(\d+): "(#[0-9a-f]{6})"/g)) rows.push({ id: `tw/${m[1]}-${s[1]}`, n: `${m[1]} ${s[1]}`, h: s[2], s: "Tailwind" });
}
for (const m of tw.matchAll(/^\s{4}(black|white): "(#[0-9a-f]{3,6})"/gm)) rows.push({ id: `tw/${m[1]}`, n: m[1], h: m[2].length === 4 ? "#" + [...m[2].slice(1)].map((c) => c + c).join("") : m[2], s: "Tailwind" });

const material = await fetch(MATERIAL).then((r) => r.json() as Promise<Record<string, Record<string, string> | string>>);
for (const [hueName, shades] of Object.entries(material)) {
  if (typeof shades !== "object") continue;
  // The text and icon entries are rgba() opacities over black or white, not palette colours.
  for (const [shade, h] of Object.entries(shades)) if (h.startsWith("#")) rows.push({ id: `md/${hueName}-${shade}`, n: `${hueName.replace(/-/g, " ")} ${shade}`, h: h.toLowerCase(), s: "Material" });
}

writeFileSync(OUT, JSON.stringify(rows) + "\n");
const sections = [...new Set(rows.map((r) => r.s))].map((s) => `${s} ${rows.filter((r) => r.s === s).length}`).join(", ");
console.log(`${rows.length} colours -> ${OUT}\n${sections}`);
