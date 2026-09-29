// Store: every extension the registries list, in the panel. An input
// palette over the core's store state (`extensions.state()`, cached and
// cheap; `extensions.refresh()` fetches every registry, on the first
// listing of a while and on the shell's Refresh), narrowed by what you type
// and the filter dropdown (All, Installed, Updates, Registries, the
// shelves). Every row is one listed extension with how it stands; the
// detail pane (cmd+i) has the description, the palettes, the screenshots
// and the facts. Enter installs an absent one, updates one the core has an
// update for, opens an installed one; each waits for the core and says how
// it went. The pure parts are in store.ts.
import { errorMessage, extensions, hint, type Ctx, type Effect, type Extension, type Item, type StoreResult, type StoreState } from "@zcag/pal";
import { FILTERS, REGISTRIES_LINK, detail, featured, pageOf, registryRows, row, select, shelves, staleNote, standingId, standings, targetOf, type Standing } from "./store.ts";

/** How long a fetch of the registries stands before a listing asks for another (the core also fetches every 6 hours and when Settings opens). `PAL_STORE_REFRESH_MS` sets it for the tests. */
const REFRESH_MS = Number(process.env.PAL_STORE_REFRESH_MS) || 10 * 60_000;
/** The hint rows' glyph for a registry that did not answer (md-cloud_off_outline). */
const OFFLINE = "\u{f0164}";

let refreshedAt = 0;
let last: StoreState | null = null;
/** One fetch at a time: a keystroke while it runs waits for the same one. */
let inflight: Promise<StoreState> | null = null;

/** The state, fetched afresh when asked or when the last fetch is old; a failed fetch answers the cached state and why. */
async function current(force: boolean, now: number): Promise<{ state: StoreState; error?: string }> {
  if (!force && now - refreshedAt < REFRESH_MS) return { state: (last = await extensions.state()) };
  try {
    inflight ??= extensions.refresh().finally(() => { inflight = null; });
    const state = await inflight;
    refreshedAt = now;
    return { state: (last = state) };
  } catch (e) {
    return { state: (last = await extensions.state()), error: errorMessage(e) };
  }
}

/**
 * The rows for a state: problems first (a fetch that failed, a registry
 * that did not answer), then what has an update under its own heading,
 * then the rest. Opened on everything with nothing typed, the rest is a
 * Featured section (three worth meeting first) and a section per
 * category, what is not installed leading each; a search or a filter
 * lists one run of rows, the title's matches first.
 */
function rows(state: StoreState, filter: string, query: string, now: number, error?: string): Item[] {
  const out: Item[] = [];
  if (error) out.push(hint("refresh", "Could not check the registries", error, { icon: OFFLINE }));
  for (const r of state.registries) if (r.last_error) out.push(hint(`stale:${r.name}`, staleNote(r, now), "Settings › Extensions › Registries has it", { icon: OFFLINE }));
  if (filter === "registries") return [...out, ...registryRows(state.registries, now).filter((i) => !query || `${i.name} ${i.subtitle ?? ""} ${i.keywords?.join(" ") ?? ""}`.toLowerCase().includes(query.toLowerCase()))];
  if (!state.available.length) return [...out, hint("none", "No registry has answered yet", "Refresh (cmd+r) asks again", { icon: OFFLINE })];
  const chosen = select(standings(state), filter, query);
  // What has an update leads, under its own heading, unless the filter already narrows to it.
  const behind = filter === "updates" ? [] : chosen.filter((s) => targetOf(s.status));
  out.push(...behind.map((s) => row(s, "Updates")));
  const rest = chosen.filter((s) => !behind.includes(s));
  if (filter === "all" && !query.trim()) {
    out.push(...featured(rest).map((s) => row(s, "Featured", { featured: true })));
    for (const shelf of shelves(rest)) out.push(...shelf.rows.map((s) => row(s, shelf.title, { shelved: true })));
  } else out.push(...rest.map((s) => row(s, behind.length ? "Extensions" : undefined)));
  if (!chosen.length) out.push(hint("none", query ? `Nothing listed matches “${query}”` : filter === "updates" ? "Everything installed is up to date" : filter === "installed" ? "Nothing from a registry is installed" : "Nothing listed on this shelf", "The Registries filter shows where extensions come from"));
  return out;
}

/** The standing a row id (`<registry>/<name>`, or a Featured row's) names, in the last state listed. */
async function standingOf(id: string): Promise<Standing | undefined> {
  const state = last ?? (last = await extensions.state());
  return standings(state).find((s) => `${s.a.registry}/${s.a.name}` === standingId(id));
}

/** Several results as one toast, or the reason when any did not go through (the rows relist either way). */
function said(verb: string, results: StoreResult[], titles: Map<string, string>): Effect {
  const failed = results.filter((r) => !r.ok || r.loaded === false);
  const name = (r: StoreResult) => titles.get(r.name) ?? r.name;
  if (failed.length) return { keep: true, toast: { style: "failure", title: `Could not ${verb.toLowerCase()} ${failed.map(name).join(", ")}`, message: failed.map((r) => r.error ?? (r.loaded === false ? "it failed to load" : "")).filter(Boolean).join("; ") } };
  const past = { Install: "Installed", Update: "Updated", Remove: "Removed" }[verb] ?? verb;
  return { keep: true, toast: { title: results.length === 1 ? `${past} ${name(results[0])}` : `${past} ${results.length} extensions` } };
}

export default {
  palettes: {
    store: {
      title: "Store",
      input: true,
      filters: FILTERS,
      placeholder: "Search every registry",
      list: async (query = "", ctx?: Ctx): Promise<Item[]> => {
        const now = Date.now();
        const filter = ctx?.filter ?? FILTERS[0].id;
        const stale = !!ctx?.refresh || now - refreshedAt >= REFRESH_MS;
        // A fetch of every registry is slow: the cached state's rows show first.
        if (stale) { last = await extensions.state(); ctx?.partial?.(rows(last, filter, query, now)); }
        const { state, error } = await current(stale, now);
        return rows(state, filter, query, now, error);
      },
      pick: async (id, action, ctx): Promise<Effect | void> => {
        if (id.startsWith("registry:")) return { open: REGISTRIES_LINK };
        const s = await standingOf(id);
        if (!s) throw new Error(`no extension ${id} in the store`);
        const a = action ?? row(s).actions![0]?.id;
        // The marked extensions (`ctx.ids`), the addressed one first, else the one; a Featured row and its shelf row marked together count once.
        const ids = [...new Set((ctx?.ids ?? [id]).map(standingId))];
        const all = (await Promise.all(ids.map(standingOf))).filter((x): x is Standing => !!x);
        const titles = new Map(all.map((x) => [x.a.name, x.a.listing.title || x.a.name]));
        switch (a) {
          case "install": {
            const results: StoreResult[] = [];
            for (const x of all) results.push(await extensions.install(x.a.name, { registry: x.a.registry, from: "store" }));
            return said("Install", results, titles);
          }
          case "update": return said("Update", await extensions.update(all.map((x) => x.a.name)), titles);
          case "remove": {
            const results: StoreResult[] = [];
            for (const x of all) results.push(await extensions.remove(x.a.name));
            return said("Remove", results, titles);
          }
          case "open": { const p = s.a.listing.palettes[0]; return p ? { push: { extension: s.a.name, palette: p.id } } : undefined; }
          case "copy-command": { const cmds = all.map((x) => `pal install ${x.a.name}`); return { copy: cmds.join("\n"), hud: cmds.length > 1 ? `Copied ${cmds.length} install commands` : `Copied ${cmds[0]}` }; }
          default: return { open: all.length > 1 ? all.map(pageOf) : pageOf(s) };
        }
      },
      detail: async (id) => {
        const s = await standingOf(id);
        return s && detail(s);
      },
    },
  },
} satisfies Extension;
