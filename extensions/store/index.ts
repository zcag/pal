// Store: pal.cagdas.io's extension list in the panel. An input palette
// over the site's `/api/extensions` (fetched at most once an hour, kept in
// memory and in `storage`; the shell's Refresh forces a fetch), narrowed
// by what you type and by the filter dropdown (All, Installed, Updates,
// the site's shelves). Every row is one extension with its tile, tagline
// and chips; the detail pane (cmd+i) has the description, the features,
// the screenshots and the keys of each palette. Enter installs an absent
// one (a confirm first, then `pal://install/<name>` through the core: the
// HUD says Installing…, the host restarts, the root opens with the name
// typed), updates a store-installed one that is behind, and opens the
// store page of a bundled one. The pure parts are in store.ts.
import { errorMessage, extensions, hint, storage, type Ctx, type Effect, type Extension, type Item } from "@zcag/pal";
import { actionsFor, detail, FILTERS, fresh, row, select, staleNote, standing, trimAll, type Cache, type Installed, type Listing } from "./store.ts";

/** The site's list; `PAL_STORE_API` points the tests at a local server. */
const API = (process.env.PAL_STORE_API || "https://pal.cagdas.io/api/extensions").replace(/\/$/, "");
const FETCH_MS = 10_000;
/** The one storage key: `{ fetched_at, listings }`. */
const KEY = "cache";
/** The hint rows' glyph (md-information_outline) and the offline one's (md-cloud_off_outline). */
const OFFLINE = "\u{f0164}";

let cache: Cache | null = null;
/** One fetch at a time: a keystroke while the first is in flight waits for it. */
let inflight: Promise<Cache> | null = null;

async function fetchListings(): Promise<Cache> {
  const res = await fetch(API, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_MS) });
  if (!res.ok) throw new Error(`pal.cagdas.io answered ${res.status}`);
  const c: Cache = { fetched_at: Date.now(), listings: trimAll(await res.json()) };
  cache = c;
  // The trimmed list is well under the storage cap today; a list that outgrows it stays in memory only.
  await storage.set(KEY, c).catch((e) => console.error(`[store] cache not stored: ${errorMessage(e)}`));
  return c;
}

/** The listings: the memory cache, else the stored one, fetched when older than an hour or when `force`. Answers what it has and why. */
async function listings(force: boolean): Promise<{ cache: Cache | null; error?: string }> {
  const now = Date.now();
  if (!cache) cache = ((await storage.get<Cache>(KEY).catch(() => null)) ?? null) as Cache | null;
  if (cache && !Array.isArray(cache.listings)) cache = null;
  if (!force && fresh(cache, now)) return { cache };
  try {
    inflight ??= fetchListings().finally(() => { inflight = null; });
    return { cache: await inflight };
  } catch (e) {
    return { cache, error: errorMessage(e) };
  }
}

async function installed(): Promise<Installed[]> {
  try { return await extensions.list(); } catch { return []; }
}


const byName = (name: string): Listing | undefined => cache?.listings.find((l) => l.name === name);

export default {
  palettes: {
    store: {
      title: "Store",
      input: true,
      filters: FILTERS,
      placeholder: "Search the store",
      list: async (query = "", ctx?: Ctx): Promise<Item[]> => {
        const [{ cache: c, error }, have] = await Promise.all([listings(!!ctx?.refresh), installed()]);
        if (!c) return [hint("offline", "pal.cagdas.io is not reachable", error ?? "No list yet; try again when online", { icon: OFFLINE })];
        const rows: Item[] = [];
        if (error) rows.push(hint("stale", staleNote(c.fetched_at, Date.now()), `pal.cagdas.io is not reachable: ${error}`, { icon: OFFLINE }));
        const filter = ctx?.filter ?? FILTERS[0].id;
        const chosen = select(c.listings, have, filter, query);
        // What is behind leads, under its own heading, unless the filter already narrows to it.
        const behind = filter === "updates" ? [] : chosen.filter((l) => standing(l, have).behind);
        rows.push(...behind.map((l) => row(l, standing(l, have), "Updates")));
        rows.push(...chosen.filter((l) => !behind.includes(l)).map((l) => row(l, standing(l, have), behind.length ? "Extensions" : undefined)));
        if (!chosen.length) rows.push(hint("none", query ? `Nothing in the store matches “${query}”` : filter === "updates" ? "Everything installed from the store is current" : filter === "installed" ? "Nothing from the store is installed" : "The store lists nothing", "pal.cagdas.io/extensions has the full site"));
        return rows;
      },
      pick: async (id, action): Promise<Effect | void> => {
        const l = byName(id);
        if (!l) throw new Error(`no extension ${id} in the store`);
        const s = standing(l, await installed());
        const a = action ?? actionsFor(l, s)[0].id;
        switch (a) {
          case "install": await extensions.install(l.name); return { hide: true };
          case "update": await extensions.update(l.name); return { hide: true };
          case "remove": await extensions.remove(l.name); return { hide: true };
          case "copy-command": return { copy: `pal install ${l.name}`, hud: `Copied pal install ${l.name}` };
          default: return { open: l.url };
        }
      },
      detail: async (id) => {
        const l = byName(id);
        if (!l) return;
        return detail(l, standing(l, await installed()));
      },
    },
  },
} satisfies Extension;
