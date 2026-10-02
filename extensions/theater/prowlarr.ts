// Prowlarr: the indexers with their health (a disabled one says until
// when and why), Prowlarr's own health warnings, and a release search
// across every indexer whose Enter grabs the release through Prowlarr
// into its download client. NZBHydra2's newznab search rides next to it
// (`hydraRows`): Enter sends the NZB to SABnzbd when that is set up.
import { ago, bytes, hint, tinted, toast, truncate, type Ctx, type Effect, type Item } from "@zcag/pal";
import { api, cached, conf, configured, GLYPH } from "./http.ts";
import * as sab from "./sab.ts";
import { guard, pickHint, setupRow } from "./rows.ts";

export type Indexer = { id: number; name: string; enable: boolean; protocol: "usenet" | "torrent"; priority: number; privacy?: string; tags?: number[]; capabilities?: { categories?: { name: string }[] } };
export type IndexerStatus = { indexerId: number; disabledTill?: string; mostRecentFailure?: string; initialFailure?: string };
export type Release = { guid: string; title: string; size: number; age: number; seeders?: number; leechers?: number; grabs?: number; indexer: string; indexerId: number; protocol: "usenet" | "torrent"; infoUrl?: string; downloadUrl?: string; magnetUrl?: string; publishDate?: string; categories?: { name: string }[]; indexerFlags?: string[] };
type Health = { source: string; type: string; message: string; wikiUrl?: string };
type HydraItem = { title: string; guid: string; link: string; comments?: string; pubDate?: number; category?: string; enclosure?: { attributes?: { url?: string; length?: string } }; attr?: { attributes: { name: string; value: string } }[] };

export const prowlarrUrl = () => conf("prowlarr").url;
export const hydraUrl = () => conf("hydra").url;
export const status = () => api<{ version: string }>("prowlarr", "/api/v1/system/status", { timeout: 3500 });
export const indexers = (refresh = false) => cached("prowlarr:indexers", 300_000, refresh, () => api<Indexer[]>("prowlarr", "/api/v1/indexer"));
export const indexerStatus = (refresh = false) => cached("prowlarr:status", 60_000, refresh, () => api<IndexerStatus[]>("prowlarr", "/api/v1/indexerstatus"));
export const healthOf = (refresh = false) => cached("prowlarr:health", 60_000, refresh, () => api<Health[]>("prowlarr", "/api/v1/health"));
export const search = (q: string) => api<Release[]>("prowlarr", "/api/v1/search", { query: { query: q, limit: 60 }, timeout: 30_000 });
export const grab = (r: Release) => api("prowlarr", "/api/v1/search", { body: { guid: r.guid, indexerId: r.indexerId } });
export const testIndexer = (id: number) => api("prowlarr", `/api/v1/indexer/${id}/test`, { method: "POST", body: {}, text: true });
export const hydraSearch = async (q: string) => (await api<{ channel: { item?: HydraItem[] | HydraItem; response?: { attributes?: { total?: string } } } }>("hydra", "/api", { query: { t: "search", q, limit: 60 }, timeout: 30_000 })).channel;
export const hydraCaps = () => api<{ server?: { attributes?: { version?: string } } }>("hydra", "/api", { query: { t: "caps" }, timeout: 3500 });

const releases = new Map<string, Release>();
const hydraItems = new Map<string, HydraItem>();

const ageText = (days: number) => (days < 1 ? "today" : days < 30 ? `${Math.round(days)} d` : days < 365 ? `${Math.round(days / 30)} mo` : `${(days / 365).toFixed(1)} y`);

export function releaseRow(r: Release): Item {
  releases.set(r.guid, r);
  const torrent = r.protocol === "torrent";
  return {
    id: `rel:${r.guid}`,
    name: r.title,
    subtitle: [bytes(r.size), ageText(r.age), r.categories?.[0]?.name, ...(r.indexerFlags ?? [])].filter(Boolean).join(" · "),
    icon: tinted(torrent ? GLYPH.qbit : GLYPH.sab, torrent ? "blue" : "amber"),
    keywords: [r.indexer, r.protocol, ...(r.categories?.map((c) => c.name) ?? [])],
    section: r.indexer,
    // The indexer is the section and the glyph's colour the protocol, so the row keeps the seeds or grabs alone.
    accessories: torrent ? [{ text: `${r.seeders ?? 0} seeds` }] : [{ text: `${r.grabs ?? 0} grabs` }],
    detail: {
      caption: `${r.indexer} · ${r.protocol}`,
      title: r.title,
      chips: (r.indexerFlags ?? []).map((f) => ({ text: f, color: "grey" as const })),
      stats: [{ value: bytes(r.size), label: "size" }, ...(torrent ? [{ value: String(r.seeders ?? 0), label: "seeders" }, { value: String(r.leechers ?? 0), label: "leechers" }] : [{ value: String(r.grabs ?? 0), label: "grabs" }])],
      metadata: [{ label: "Age", value: r.publishDate ? ago(r.publishDate) : ageText(r.age) }, ...(r.categories?.length ? [{ label: "Categories", value: r.categories.map((c) => c.name).join(", ") }] : []), ...(r.infoUrl ? [{ label: "Page", link: { text: "Open", href: r.infoUrl } }] : [])],
    },
    // Every action also takes marked releases (`multi`): each grabbed (the question names none), each page opened, the links one per line.
    actions: [
      { id: "grab", title: "Grab through Prowlarr", multi: true, confirm: "Send to the download client through Prowlarr?" },
      ...(r.infoUrl ? [{ id: "page", title: "Open release page", shortcut: "cmd+enter", multi: true as const }] : []),
      { id: "copy", title: torrent && r.magnetUrl ? "Copy magnet link" : "Copy download link", shortcut: "cmd+c", multi: true },
    ],
  };
}

export async function searchRows(q: string): Promise<Item[]> {
  if (!configured("prowlarr")) return [setupRow("prowlarr")];
  if (q.trim().length < 3) return [hint("search", "Search the indexers", "A release title, three characters at least; Prowlarr asks every enabled indexer (a few seconds)", { icon: GLYPH.prowlarr })];
  return guard(async () => {
    const found = await search(q.trim());
    const rows = found.sort((a, b) => (b.seeders ?? b.grabs ?? 0) - (a.seeders ?? a.grabs ?? 0)).map(releaseRow);
    return rows.length ? rows : [hint("none", "No release", `No indexer has “${q.trim()}”`, { icon: GLYPH.prowlarr })];
  });
}

const attr = (it: HydraItem, name: string) => it.attr?.find((a) => a.attributes.name === name)?.attributes.value;

export function hydraRow(it: HydraItem): Item {
  hydraItems.set(it.guid, it);
  const size = Number(attr(it, "size") ?? it.enclosure?.attributes?.length ?? 0), indexer = attr(it, "hydraIndexerName") ?? attr(it, "indexer") ?? "NZBHydra2", grabs = attr(it, "grabs");
  return {
    id: `nzb:${it.guid}`,
    name: it.title,
    subtitle: [size ? bytes(size) : "", it.pubDate ? ago(it.pubDate * 1000) : "", it.category].filter(Boolean).join(" · "),
    icon: tinted(GLYPH.sab, "amber"),
    keywords: [indexer, it.category ?? ""],
    section: indexer,
    accessories: grabs ? [{ text: `${grabs} grabs` }] : [],
    // Send, the page and Copy also take marked results (`multi`); Open is Hydra's one page.
    actions: [
      configured("sab") ? { id: "send", title: "Send to SABnzbd", multi: true, confirm: "Send to SABnzbd?" } : { id: "open", title: "Open in NZBHydra2" },
      ...(it.comments ? [{ id: "page", title: "Open release page", shortcut: "cmd+enter", multi: true as const }] : []),
      { id: "copy", title: "Copy NZB link", shortcut: "cmd+c", multi: true },
    ],
  };
}

export async function hydraRows(q: string): Promise<Item[]> {
  if (!configured("hydra")) return [setupRow("hydra")];
  if (q.trim().length < 3) return [hint("search", "Search NZBHydra2", "A release title, three characters at least; Hydra asks every usenet indexer it has", { icon: GLYPH.hydra })];
  return guard(async () => {
    const ch = await hydraSearch(q.trim());
    const items = Array.isArray(ch.item) ? ch.item : ch.item ? [ch.item] : [];
    const rows = items.map(hydraRow);
    return rows.length ? rows : [hint("none", "No release", `No indexer on Hydra has “${q.trim()}”`, { icon: GLYPH.hydra })];
  });
}

export async function indexerRows(refresh: boolean): Promise<Item[]> {
  if (!configured("prowlarr")) return [];
  return guard(async () => {
    const [list, statuses, health] = await Promise.all([indexers(refresh), indexerStatus(refresh).catch(() => [] as IndexerStatus[]), healthOf(refresh).catch(() => [] as Health[])]);
    const warnings = health.filter((h) => h.type === "warning" || h.type === "error").map((h): Item => ({ id: `health:${h.source}`, name: h.message, subtitle: h.source, icon: tinted(GLYPH.alert, h.type === "error" ? "red" : "amber"), section: "Health", accessories: [{ tag: h.type, color: h.type === "error" ? "red" : "amber" }], actions: h.wikiUrl ? [{ id: "wiki", title: "What this means (wiki)" }] : [], url: h.wikiUrl }));
    const rows = list.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)).map((x): Item => {
      const st = statuses.find((s) => s.indexerId === x.id);
      const down = st?.disabledTill && new Date(st.disabledTill).getTime() > Date.now();
      return {
        id: `indexer:${x.id}`,
        name: x.name,
        subtitle: [x.protocol, x.privacy, `priority ${x.priority}`, down && st?.mostRecentFailure ? truncate(st.mostRecentFailure, 80) : ""].filter(Boolean).join(" · "),
        icon: tinted(x.protocol === "torrent" ? GLYPH.qbit : GLYPH.sab, !x.enable ? "slate" : down ? "red" : "green"),
        keywords: [x.protocol, x.privacy ?? ""],
        section: x.protocol === "torrent" ? "Torrent indexers" : "Usenet indexers",
        accessories: [!x.enable ? { tag: "disabled", color: "grey" } : down ? { tag: `failing, retry ${ago(st!.disabledTill!)}`, color: "red" } : { tag: "ok", color: "green" }],
        // Marked indexers are tested in turn (`multi`); the list page is one.
        actions: [{ id: "open", title: "Open in Prowlarr" }, { id: "test", title: "Test the indexer", shortcut: "cmd+enter", multi: true }],
      };
    });
    return [...warnings, ...rows, ...(rows.length ? [] : [hint("none", "No indexers", "Add one under Indexers on Prowlarr", { icon: GLYPH.prowlarr })])];
  });
}

export async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id);
  if (id.startsWith("health:")) return { open: `${prowlarrUrl()}/system/status` };
  // The marked rows of this kind (`ctx.ids`), as their keys; the one otherwise.
  const keys = (prefix: string) => (ctx?.ids ?? [id]).filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length));
  if (id.startsWith("indexer:")) {
    if (action === "test") {
      const ids = keys("indexer:").map(Number);
      const failed: string[] = [];
      for (const n of ids) { try { await testIndexer(n); } catch (e) { failed.push(String((e as Error).message)); } }
      if (failed.length) return toast(ids.length > 1 ? `${failed.length} of ${ids.length} tests failed` : "Test failed", failed.join("; "), "failure");
      return toast(ids.length > 1 ? `${ids.length} indexers OK` : "Indexer OK", "Prowlarr's test passed");
    }
    return { open: `${prowlarrUrl()}/indexers` };
  }
  if (id.startsWith("rel:")) {
    const r = releases.get(id.slice(4));
    if (!r) throw new Error("that search result is gone; search again");
    const rs = keys("rel:").map((k) => releases.get(k)).filter((x): x is NonNullable<typeof x> => !!x);
    switch (action) {
      case "page": return { open: rs.length > 1 ? rs.map((x) => x.infoUrl ?? prowlarrUrl()) : r.infoUrl ?? prowlarrUrl() };
      case "copy": return { copy: rs.map((x) => x.magnetUrl ?? x.downloadUrl ?? x.infoUrl ?? "").join("\n") };
      default:
        for (const x of rs) { try { await grab(x); } catch (e) { return toast("Could not grab", String((e as Error).message), "failure"); } }
        return { hud: rs.length > 1 ? `Grabbed ${rs.length} releases` : `Grabbed ${truncate(r.title, 40)}` };
    }
  }
  if (id.startsWith("nzb:")) {
    const it = hydraItems.get(id.slice(4));
    if (!it) throw new Error("that search result is gone; search again");
    const its = keys("nzb:").map((k) => hydraItems.get(k)).filter((x): x is NonNullable<typeof x> => !!x);
    switch (action) {
      case "page": return { open: its.length > 1 ? its.map((x) => x.comments ?? hydraUrl()) : it.comments ?? hydraUrl() };
      case "copy": return { copy: its.map((x) => x.link).join("\n") };
      case "open": return { open: hydraUrl() };
      default:
        for (const x of its) { try { await sab.addUrl(x.link, x.title); } catch (e) { return toast("Could not send", String((e as Error).message), "failure"); } }
        return { hud: its.length > 1 ? `Sent ${its.length} to SABnzbd` : `Sent ${truncate(it.title, 40)} to SABnzbd` };
    }
  }
}

export async function health() {
  const [s, list, statuses, h] = await Promise.all([status(), indexers().catch(() => [] as Indexer[]), indexerStatus().catch(() => [] as IndexerStatus[]), healthOf().catch(() => [] as Health[])]);
  const on = list.filter((x) => x.enable), failing = statuses.filter((x) => x.disabledTill && new Date(x.disabledTill).getTime() > Date.now()).length;
  const warn = h.filter((x) => x.type === "warning" || x.type === "error").length;
  return { version: s.version, note: [`${on.length} indexer${on.length === 1 ? "" : "s"}`, failing ? `${failing} failing` : "", warn ? `${warn} warning${warn === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · "), url: prowlarrUrl(), warn: failing > 0 || warn > 0 };
}
export async function hydraHealth() {
  const c = await hydraCaps();
  return { version: c.server?.attributes?.version ?? "", note: "usenet meta search", url: hydraUrl() };
}
