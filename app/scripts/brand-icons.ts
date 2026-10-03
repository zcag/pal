// Writes the product logos into the manifests of the extensions that are
// that product (docs/extensions.md, "Icons"): each one's `icon` becomes a
// tile with the Simple Icons path (CC0, drawn in a 24 box) on the brand's
// own colour, the mark in `fg` where the brand draws it dark. The path is
// copied, so nothing loads at run time; `simple-icons` is a dev dependency
// of the app for this script alone. Run after bumping it, or to add one:
//
//   bun app/scripts/brand-icons.ts            # rewrite the icons below
//   bun app/scripts/brand-icons.ts --check    # exit 1 when a manifest differs
//
// Only an extension that IS the product gets its logo; pal's own tools, and
// one that speaks to several services (calendar, maps, translate,
// speedtest), keep their glyph tile. A brand Simple Icons dropped (Slack)
// or never had (Apple Shortcuts) keeps its glyph too: a logo is never drawn
// by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as si from "simple-icons";

type Logo = { slug: string; fg?: `#${string}` };

/** extension -> its Simple Icons slug; `fg` where the brand's own mark on its colour is dark. */
const LOGOS: Record<string, Logo> = {
  appletv: { slug: "appletv" },
  docker: { slug: "docker" },
  gifs: { slug: "giphy" },
  github: { slug: "github" },
  gmail: { slug: "gmail" },
  google: { slug: "google" },
  grafana: { slug: "grafana" },
  "home-assistant": { slug: "homeassistant" },
  hue: { slug: "philipshue" },
  immich: { slug: "immich" },
  obsidian: { slug: "obsidian" },
  onepassword: { slug: "1password" },
  spotify: { slug: "spotify", fg: "#000000" },
  whatsapp: { slug: "whatsapp" },
  youtube: { slug: "youtube" },
};

const root = join(import.meta.dir, "../../extensions");
const icons = new Map((Object.values(si) as { slug?: string; path: string; hex: string }[]).filter((i) => i.slug).map((i) => [i.slug!, i]));
const check = process.argv.includes("--check");
let differs = 0;

for (const [name, { slug, fg }] of Object.entries(LOGOS)) {
  const icon = icons.get(slug);
  if (!icon) throw new Error(`${name}: simple-icons has no "${slug}"`);
  const file = join(root, name, "pal.json");
  const text = readFileSync(file, "utf8");
  const manifest = JSON.parse(text);
  manifest.icon = { tile: { svg: icon.path, box: 24, bg: `#${icon.hex.toUpperCase()}`, ...(fg && { fg }) } };
  const out = JSON.stringify(manifest, null, 2) + "\n";
  if (out === text) continue;
  differs++;
  if (check) {
    console.log(`${name}: icon differs from simple-icons "${slug}"`);
    continue;
  }
  writeFileSync(file, out);
  console.log(`${name}: ${slug} on #${icon.hex}${fg ? `, mark ${fg}` : ""}, ${icon.path.length} bytes`);
}
if (check && differs) process.exit(1);
