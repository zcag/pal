// Games: one row that opens every game pal has, and every game a registry
// offers for this machine. A game is an extension the store shelves under
// Fun with a view palette: the installed ones read from their manifests on
// every open (so a new game is listed without a change here), the others
// from the registries' listings (`extensions.available()`), tagged Not
// installed. Enter opens an installed game; on one not installed it
// installs it, waits for it to load, then opens it. An install that fails
// stays as a row saying why.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage, extensions, hint, type AvailableExtension, type Effect, type Extension, type InstalledExtension, type Item, type OwnIcon } from "@zcag/pal";

type Manifest = { title?: string; icon?: OwnIcon; store?: { category?: string; tagline?: string }; palettes?: Record<string, { kind?: string; title?: string; icon?: OwnIcon }> };
export type Game = { extension: string; palette: string; title: string; tagline: string; icon?: OwnIcon; installed: boolean; registry?: string };

/** This machine as a listing's `platforms` names it. */
const PLATFORM = process.platform === "darwin" ? "macos" : process.platform;

async function manifest(e: InstalledExtension): Promise<Manifest> {
  try { return JSON.parse(await readFile(join(e.root, e.name, "pal.json"), "utf8")); } catch { return {}; }
}

/** Installed games: each view palette of a loaded `fun` extension. */
async function installed(): Promise<Game[]> {
  const found = await Promise.all((await extensions.list()).filter((e) => e.loaded).map(async (e) => {
    const m = await manifest(e);
    if (m.store?.category !== "fun") return [];
    return Object.entries(m.palettes ?? {}).filter(([, p]) => p.kind === "view").map(([palette, p]) => ({
      extension: e.name, palette, title: p.title ?? m.title ?? e.name, tagline: m.store?.tagline ?? "", icon: p.icon ?? m.icon, installed: true,
    }));
  }));
  return found.flat();
}

/** Games a registry lists that are not installed: `fun`, a view palette, for this platform, a build that runs here. */
export function offered(available: AvailableExtension[], have: Set<string>): Game[] {
  return available.filter((a) => !a.installed && !have.has(a.name) && a.installable && a.listing.category === "fun" && (!a.listing.platforms?.length || a.listing.platforms.includes(PLATFORM)))
    .flatMap((a) => a.listing.palettes.filter((p) => p.kind === "view").map((p) => ({ extension: a.name, palette: p.id, title: p.title || a.listing.title || a.name, tagline: a.listing.tagline, icon: a.listing.icon as OwnIcon | undefined, installed: false, registry: a.registry })));
}

/** Every game, by title: the installed ones and the ones on offer. A registry that cannot be asked leaves only the installed ones. */
export async function games(): Promise<Game[]> {
  const mine = await installed();
  const more = await extensions.available().then((a) => offered(a, new Set(mine.map((g) => g.extension))), () => []);
  // A name two registries list shows once, pal's first as the core orders them.
  const seen = new Set<string>();
  return [...mine, ...more].filter((g) => { const k = `${g.extension}/${g.palette}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.title.localeCompare(b.title));
}

/** Installs running from here, and the last failure per extension (shown as a row until the next try). */
const installing = new Set<string>();
const failed = new Map<string, string>();

export default {
  palettes: {
    games: {
      title: "Games",
      live: true,
      list: async (): Promise<Item[]> => {
        const all = await games();
        if (!all.length) return [hint("none", "No games installed", "The store's Fun shelf has them")];
        const rows: Item[] = [...failed].map(([name, error]) => hint(`failed:${name}`, `Could not install ${all.find((g) => g.extension === name)?.title ?? name}`, error));
        for (const g of all) rows.push({
          id: `${g.extension}/${g.palette}`, name: g.title, subtitle: g.tagline, icon: g.icon,
          ...(!g.installed && { accessories: [installing.has(g.extension) ? { tag: "Installing…", color: "blue" } : { tag: "Not installed", color: "grey" }] }),
          actions: [g.installed ? { id: "play", title: "Play" } : { id: "install", title: "Install and play" }],
        });
        return rows;
      },
      pick: async (id, action): Promise<Effect | void> => {
        const [extension, palette] = id.split("/");
        if (!extension || !palette) return;
        if (action !== "install") return { push: { extension, palette } };
        const g = (await games()).find((x) => x.extension === extension && x.palette === palette);
        installing.add(extension);
        failed.delete(extension);
        try {
          const r = await extensions.install(extension, { from: "games", ...(g?.registry && { registry: g.registry }) });
          if (!r.ok || r.loaded === false) throw new Error(r.error || (r.loaded === false ? "it installed but failed to load" : "the install did not go through"));
          return { push: { extension, palette } };
        } catch (e) {
          failed.set(extension, errorMessage(e));
          return { keep: true };
        } finally {
          installing.delete(extension);
        }
      },
    },
  },
} satisfies Extension;
