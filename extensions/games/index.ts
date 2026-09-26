// Games: one row that opens every game pal has. A game is a loaded
// extension the store shelves under Fun with a view palette (2048,
// Blackjack, Crossword, Minesweeper, Snake II, Solitaire, Sudoku, Typing, Wordle, Yahtzee, and one
// installed from the store later), read from the manifests on every open,
// so a new game is listed without a change here. Enter opens it.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extensions, hint, type Effect, type Extension, type InstalledExtension, type Item, type OwnIcon } from "@zcag/pal";

type Manifest = { title?: string; icon?: OwnIcon; store?: { category?: string; tagline?: string }; palettes?: Record<string, { kind?: string; title?: string; icon?: OwnIcon }> };
export type Game = { extension: string; palette: string; title: string; tagline: string; icon?: OwnIcon };

async function manifest(e: InstalledExtension): Promise<Manifest> {
  try { return JSON.parse(await readFile(join(e.root, e.name, "pal.json"), "utf8")); } catch { return {}; }
}

/** Every game, by title: each view palette of a loaded `fun` extension. */
export async function games(): Promise<Game[]> {
  const found = await Promise.all((await extensions.list()).filter((e) => e.loaded).map(async (e) => {
    const m = await manifest(e);
    if (m.store?.category !== "fun") return [];
    return Object.entries(m.palettes ?? {}).filter(([, p]) => p.kind === "view").map(([palette, p]) => ({
      extension: e.name, palette, title: p.title ?? m.title ?? e.name, tagline: m.store?.tagline ?? "", icon: p.icon ?? m.icon,
    }));
  }));
  return found.flat().sort((a, b) => a.title.localeCompare(b.title));
}

export default {
  palettes: {
    games: {
      title: "Games",
      live: true,
      list: async (): Promise<Item[]> => {
        const all = await games();
        if (!all.length) return [hint("none", "No games installed", "The store's Fun shelf has them")];
        return all.map((g) => ({ id: `${g.extension}/${g.palette}`, name: g.title, subtitle: g.tagline, icon: g.icon, actions: [{ id: "play", title: "Play" }] }));
      },
      pick: (id): Effect | void => {
        const [extension, palette] = id.split("/");
        if (extension && palette) return { push: { extension, palette } };
      },
    },
  },
} satisfies Extension;
