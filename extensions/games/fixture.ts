// Writes app/src/gallery/shots/games.json, the store screenshots' fixture:
// the rows as index.ts lists them through the host harness, from the
// repo's own manifests. The machine it shows is a 0.9 one: the games come
// from pal's registry (docs/design/distribution.md, "What is bundled"),
// Solitaire, Wordle and Snake are installed, and every other game the
// registry lists is on offer under Not installed, each with its tile and
// tagline. `bun run extensions/games/fixture.ts`, then `make shots EXT=games`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED, Host } from "../../host/test/harness.ts";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { AvailableExtension } from "../../sdk/src/index.ts";
import manifest from "./pal.json" with { type: "json" };

const INSTALLED = new Set(["games", "solitaire", "wordle", "snake"]);

pinClock();
const names = readdirSync(BUNDLED).filter((n) => existsSync(join(BUNDLED, n, "pal.json"))).sort();
const installed = names.filter((n) => INSTALLED.has(n)).map((name) => ({ name, version: "0.1.0", root: BUNDLED, loaded: true, store: name !== "games", bundled: name === "games" }));
const available: AvailableExtension[] = names.map((name) => {
  const m = JSON.parse(readFileSync(join(BUNDLED, name, "pal.json"), "utf8"));
  const s = m.store ?? {};
  return {
    name, registry: "pal", installed: INSTALLED.has(name), bundled: name === "games", installable: true,
    listing: {
      title: m.title ?? name, description: m.description ?? "", tagline: s.tagline ?? "", features: s.features ?? [], category: s.category ?? "", keywords: m.keywords ?? [], icon: m.icon ?? null, author: m.author ?? "",
      platforms: s.platforms ?? null, play: !!s.play, palettes: Object.entries(m.palettes ?? {}).map(([id, p]: [string, any]) => ({ id, title: p.title ?? m.title ?? id, kind: p.kind ?? "list" })),
      screenshots: [], requires: m.requires ?? [], suggests: m.suggests ?? [],
    },
  };
});
const host = await Host.bundled({ core: { "extensions.list": () => installed, "store.state": () => ({ available }) } });
try {
  const items = await host.list("games", "games");
  writeFixture("games", {
    palettes: { games: { title: manifest.title, icon: manifest.icon, live: true, items } },
    shots: {
      "1-list": { palette: "games", keys: [], caption: "The games you have first, then every other game pal's registry offers, each with its tile and what it is; Enter installs one and starts it" },
      "2-search": { palette: "games", keys: ["type:daily"], caption: "Typing narrows the list, taglines included: daily finds the daily puzzles; Enter opens one" },
    },
  });
  console.log(`wrote app/src/gallery/shots/games.json: ${items.length} games`);
} finally {
  host.kill();
}
