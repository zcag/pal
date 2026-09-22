// Theater: the home media stack in one extension. The Theater palette
// lists every configured service with live health (a service you have
// not set up is one Set up row); each service's own palettes come from
// its module (jellyfin, seerr, arr for the three arrs, downloads over sab
// and qbit, prowlarr with hydra, navidrome, abs, kavita, shelfmark,
// bazarr); http.ts is the one client; view.ts draws the four bar
// popovers (downloads, playing, requests, queue), each hidden when it
// has nothing to say.
import { errorMessage, hint, imageData, tile, toast, type BarCtx, type BarItem, type Detail, type Effect, type Extension, type Item, type Palette } from "@zcag/pal";
import { EXTENSION, GLYPH, HEALTH_MS, SERVICES, cached, conf, configured, forget, needsSetup, service, speed as fmtSpeed, pct, settingsLink, type Service, type ServiceId } from "./http.ts";
import { SEARCH_WAIT_MS, debounced, guard, pickHint, setupRow } from "./rows.ts";
import * as jellyfin from "./jellyfin.ts";
import * as seerr from "./seerr.ts";
import * as arr from "./arr.ts";
import * as downloads from "./downloads.ts";
import * as prowlarr from "./prowlarr.ts";
import * as navidrome from "./navidrome.ts";
import * as abs from "./abs.ts";
import * as kavita from "./kavita.ts";
import * as shelfmark from "./shelfmark.ts";
import * as bazarr from "./bazarr.ts";
import { render as renderPop, type PopRow, type PopState } from "./view.ts";

const log = (...a: unknown[]) => console.error("[theater]", ...a);

// ---- the Theater palette: every service with its health -------------------------------

type Health = { version?: string; note?: string; url: string; warn?: boolean };

/** One health probe per service, each with its own short timeout; a failure is the row's "down" state, never a thrown listing. */
async function probe(id: ServiceId): Promise<Health | { error: string }> {
  try {
    switch (id) {
      case "jellyfin": return await jellyfin.health();
      case "seerr": return await seerr.health();
      case "radarr": case "sonarr": case "lidarr": return await arr.health(id);
      case "prowlarr": return await prowlarr.health();
      case "hydra": return await prowlarr.hydraHealth();
      case "bazarr": return await bazarr.health();
      case "sab": return await downloads.sabHealth();
      case "qbit": return await downloads.qbitHealth();
      case "navidrome": return await navidrome.health();
      case "abs": return await abs.health();
      case "kavita": return await kavita.health();
      case "shelfmark": return await shelfmark.health();
      default: {
        // Filebrowser and Homepage have nothing to ask: the page answering is the health.
        const res = await fetch(conf(id).url, { signal: AbortSignal.timeout(HEALTH_MS), redirect: "manual" });
        if (res.status >= 500) throw new Error(`${res.status} ${res.statusText}`);
        return { url: conf(id).url, note: "up" };
      }
    }
  } catch (e) { return { error: errorMessage(e) }; }
}

const healthOf = (id: ServiceId, refresh: boolean) => cached(`health:${id}`, 30_000, refresh, () => probe(id));

function serviceRow(s: Service, h: Health | { error: string }): Item {
  const down = "error" in h;
  const drill = s.drill.map(([key, title]) => ({ id: `palette:${key}`, title }));
  return {
    id: `service:${s.id}`,
    name: s.title,
    subtitle: down ? `Down: ${h.error}` : [h.version ? `v${h.version}` : "", h.note].filter(Boolean).join(" · ") || conf(s.id).url,
    icon: tile(s.color, GLYPH[s.id]),
    keywords: [...s.keywords, s.id],
    section: "Services",
    accessories: [down ? { tag: "down", color: "red" } : h.warn ? { tag: "attention", color: "amber" } : { tag: "up", color: "green" }],
    detail: { metadata: [{ label: "URL", link: { text: conf(s.id).url.replace(/^https?:\/\//, ""), href: conf(s.id).url } }, ...(!down && h.version ? [{ label: "Version", value: h.version }] : []), { label: "Status", value: down ? h.error : h.note || "up" }, ...(drill.length ? [{ label: "In pal", value: drill.map((d) => d.title).join(", ") }] : [])] },
    actions: [
      { id: "open", title: `Open ${s.title}` },
      ...(s.palette ? [{ id: `palette:${s.palette}`, title: "Open in pal", shortcut: "cmd+enter" }] : []),
      ...drill.filter((d) => d.id !== `palette:${s.palette}`),
      { id: "copy", title: "Copy URL", shortcut: "cmd+c" },
    ],
  };
}

async function theaterRows(refresh: boolean): Promise<Item[]> {
  const on = SERVICES.filter((s) => configured(s.id)), off = SERVICES.filter((s) => !configured(s.id));
  const probed = await Promise.all(on.map((s) => healthOf(s.id, refresh)));
  const rows = on.map((s, i) => serviceRow(s, probed[i]!));
  if (!on.length) rows.push(hint("none", "Nothing set up yet", "Fill a service's URL and key under Settings › Extensions › Theater; only the ones you fill in show here", { icon: GLYPH.key, actions: [{ id: "settings", title: "Open settings" }] }));
  return [...rows, ...off.map((s) => setupRow(s.id))];
}

async function pickTheater(id: string, action?: string): Promise<Effect | void> {
  if (id === "hint:none") return { open: "pal://settings/extensions?anchor=extensions:theater:jellyfin_url" };
  if (id.startsWith("hint:")) return pickHint(id);
  const s = service(id.slice(8) as ServiceId);
  if (action?.startsWith("palette:")) return { push: { extension: EXTENSION, palette: action.slice(8) } };
  if (action === "copy") return { copy: conf(s.id).url };
  return { open: conf(s.id).url };
}

// ---- bar items -----------------------------------------------------------------------

/** The cursor of each popover, kept between renders. */
const focus: Record<string, string | undefined> = {};
const cursorOf = (kind: string, rows: PopRow[]) => Math.max(0, rows.findIndex((r) => r.id === focus[kind]));
const move = (kind: string, rows: PopRow[], delta: number) => { if (rows.length) focus[kind] = rows[(cursorOf(kind, rows) + delta + rows.length) % rows.length]!.id; };

async function downloadsPop(st: downloads.DownloadsState): Promise<PopState> {
  const rows: PopRow[] = st.items.map((d) => ({ id: `${d.client}:${d.id}`, title: d.name, subtitle: [d.client === "sab" ? "SABnzbd" : "qBittorrent", d.category, d.left ? `${Math.round(d.left / 60)} min left` : ""].filter(Boolean).join(" · "), glyph: d.client === "sab" ? GLYPH.sab : GLYPH.qbit, glyphColor: d.active ? "accent" : "faint", tag: d.state, right: d.active && d.speed ? fmtSpeed(d.speed) : pct(d.progress), progress: d.progress, progressColor: d.paused ? "grey" : "blue", paused: d.paused }));
  return { kind: "downloads", title: st.items.length ? `${st.items.length} download${st.items.length === 1 ? "" : "s"}` : "Downloads", summary: st.items.length ? `${st.paused ? "Paused" : fmtSpeed(st.speed)} · ${st.items.filter((d) => d.active).length} active${st.limits.length ? ` · limit ${st.limits.join(", ")}` : ""}` : undefined, rows, focus: cursorOf("downloads", rows), allPaused: st.paused, empty: { title: "Nothing downloading", sub: "SABnzbd and qBittorrent are idle" } };
}

async function renderDownloads(ctx: BarCtx): Promise<BarItem> {
  if (!configured("sab") && !configured("qbit")) return { hidden: true };
  const st = await downloads.downloadsState(ctx.reason !== "every");
  const active = st.items.filter((d) => d.active).length;
  const states = { downloading: active, speed: st.speed, paused: st.paused };
  const menu = { view: renderPop(await downloadsPop(st)) };
  if (!st.items.length) return { hidden: true, states, empty: { icon: GLYPH.sab, tooltip: "Nothing downloading", menu } };
  const title = st.paused ? `paused · ${st.items.length}` : `${fmtSpeed(st.speed)} · ${active || st.items.length}`;
  return { icon: st.paused ? GLYPH.pause : GLYPH.sab, title, tooltip: st.paused ? `${st.items.length} in the queue, paused` : `${active} downloading, ${fmtSpeed(st.speed)}`, states, menu, ...(st.errors.length && { stale: true }) };
}

async function downloadsAction(action: string): Promise<Effect | void> {
  const st = await downloads.downloadsState();
  const rows = (await downloadsPop(st)).rows;
  const cur = rows[cursorOf("downloads", rows)];
  const redraw = async (): Promise<Effect> => ({ view: renderPop(await downloadsPop(await downloads.downloadsState(true))) });
  if (action.startsWith("focus:")) { focus.downloads = action.slice(6); return { view: renderPop(await downloadsPop(st)) }; }
  switch (action) {
    case "down": move("downloads", rows, 1); return { view: renderPop(await downloadsPop(st)) };
    case "up": move("downloads", rows, -1); return { view: renderPop(await downloadsPop(st)) };
    case "open-pal": return { push: { extension: EXTENSION, palette: "downloads" } };
    case "toggle-all": try { st.paused ? await downloads.resumeAll() : await downloads.pauseAll(); } catch (e) { return toast("Could not pause", errorMessage(e), "failure"); } return { keep: true, hud: st.paused ? "Resumed" : "Paused" };
    case "toggle": case "delete": {
      if (!cur) return { keep: true };
      const r = await downloads.pick(`dl:${cur.id}`, action === "delete" ? "delete" : cur.paused ? "resume" : "pause");
      return r?.toast?.style === "failure" ? r : redraw();
    }
    case "open": return { open: cur ? downloads.clientUrl(cur.id.startsWith("sab:") ? "sab" : "qbit") : downloads.clientUrl(configured("sab") ? "sab" : "qbit") };
  }
}

async function playingPop(list: jellyfin.JfSession[]): Promise<PopState> {
  const rows: PopRow[] = await Promise.all(list.map(async (s) => {
    const it = s.NowPlayingItem!;
    const pos = it.RunTimeTicks && s.PlayState?.PositionTicks ? s.PlayState.PositionTicks / it.RunTimeTicks : 0;
    const img = jellyfin.poster(it, 48);
    return { id: s.Id, title: jellyfin.nameOf(it), subtitle: [s.UserName, s.DeviceName].filter(Boolean).join(" on "), glyph: GLYPH.play, glyphColor: "accent", image: img ? await imageData(img) : undefined, tag: s.PlayState?.IsPaused ? { text: "paused", color: "amber" as const } : { text: "playing", color: "green" as const }, right: pct(pos), progress: pos, progressColor: s.PlayState?.IsPaused ? "grey" as const : "green" as const, paused: !!s.PlayState?.IsPaused };
  }));
  return { kind: "playing", title: rows.length ? `${rows.length} watching` : "Now Playing", rows, focus: cursorOf("playing", rows), empty: { title: "Nothing playing", sub: "No Jellyfin session is playing anything" } };
}

async function renderPlaying(ctx: BarCtx): Promise<BarItem> {
  if (!configured("jellyfin")) return { hidden: true };
  const list = await jellyfin.playing(ctx.reason !== "every");
  const states = { watching: list.length };
  const menu = { view: renderPop(await playingPop(list)) };
  if (!list.length) return { hidden: true, states, empty: { icon: GLYPH.play, tooltip: "Nothing playing on Jellyfin", menu } };
  const names = [...new Set(list.map((s) => s.UserName ?? "someone"))];
  const first = list[0]!;
  return { icon: GLYPH.play, title: list.length === 1 ? names[0] : String(list.length), tooltip: list.length === 1 ? `${names[0]} · ${first.NowPlayingItem!.Name} on ${first.DeviceName ?? first.Client ?? "a device"}` : `${names.join(" and ")} are watching`, states, menu };
}

async function playingAction(action: string): Promise<Effect | void> {
  const list = await jellyfin.playing();
  const rows = (await playingPop(list)).rows;
  const cur = rows[cursorOf("playing", rows)];
  const draw = async (fresh = false): Promise<Effect> => ({ view: renderPop(await playingPop(await jellyfin.playing(fresh))) });
  if (action.startsWith("focus:")) { focus.playing = action.slice(6); return draw(); }
  switch (action) {
    case "down": move("playing", rows, 1); return draw();
    case "up": move("playing", rows, -1); return draw();
    case "open-pal": return { push: { extension: EXTENSION, palette: "jellyfin-playing" } };
    case "playpause": { if (!cur) return { keep: true }; const r = await jellyfin.pick(`session:${cur.id}`, "playpause"); return r?.toast?.style === "failure" ? r : draw(true); }
    case "open": return cur ? jellyfin.pick(`session:${cur.id}`, "open") : { open: jellyfin.jfHome() };
  }
}

async function requestsPop(list: seerr.SeerrRequest[]): Promise<PopState> {
  const rows: PopRow[] = await Promise.all(list.map(async (r) => {
    const t = await seerr.titleOf(r.type, r.media.tmdbId).catch(() => ({ title: `TMDB ${r.media.tmdbId}` } as { title: string; year?: string; posterPath?: string }));
    return { id: String(r.id), title: t.year ? `${t.title} (${t.year})` : t.title, subtitle: `${r.type === "tv" ? "Series" : "Movie"} · ${r.requestedBy.displayName}`, glyph: GLYPH.seerr, glyphColor: "accent" as const, image: t.posterPath ? await imageData(`https://image.tmdb.org/t/p/w92${t.posterPath}`) : undefined, tag: r.is4k ? { text: "4K", color: "violet" as const } : undefined };
  }));
  return { kind: "requests", title: rows.length ? `${rows.length} pending request${rows.length === 1 ? "" : "s"}` : "Requests", rows, focus: cursorOf("requests", rows), empty: { title: "No pending requests", sub: "Nothing waits for an approval" } };
}

async function renderRequests(ctx: BarCtx): Promise<BarItem> {
  if (!configured("seerr")) return { hidden: true };
  const list = await seerr.requests("pending", ctx.reason !== "every");
  const states = { pending: list.length };
  const menu = { view: renderPop(await requestsPop(list)) };
  if (!list.length) return { hidden: true, states, empty: { icon: GLYPH.seerr, tooltip: "No pending requests", menu } };
  return { icon: GLYPH.seerr, badge: list.length, tooltip: `${list.length} pending request${list.length === 1 ? "" : "s"}`, states, menu };
}

async function requestsAction(action: string): Promise<Effect | void> {
  const list = await seerr.requests("pending");
  const rows = (await requestsPop(list)).rows;
  const cur = rows[cursorOf("requests", rows)];
  const draw = async (fresh = false): Promise<Effect> => ({ view: renderPop(await requestsPop(await seerr.requests("pending", fresh))) });
  if (action.startsWith("focus:")) { focus.requests = action.slice(6); return draw(); }
  switch (action) {
    case "down": move("requests", rows, 1); return draw();
    case "up": move("requests", rows, -1); return draw();
    case "open-pal": return { push: { extension: EXTENSION, palette: "seerr-requests" } };
    case "approve": case "decline": { if (!cur) return { keep: true }; const r = await seerr.pick(`req:${cur.id}`, action); if (r?.toast?.style === "failure") return r; forget("seerr:requests"); return { keep: true, hud: action === "approve" ? "Approved" : "Declined" }; }
    case "open": return cur ? seerr.pick(`req:${cur.id}`) : { open: `${seerr.seerrUrl()}/requests` };
  }
}

type Queued = { app: arr.ArrId; r: arr.QueueRecord };
async function arrQueues(refresh: boolean): Promise<Queued[]> {
  const apps = (["radarr", "sonarr", "lidarr"] as arr.ArrId[]).filter(configured);
  const lists = await Promise.all(apps.map((app) => arr.queue(app, refresh).catch((e) => { log(`${app} queue: ${errorMessage(e)}`); return [] as arr.QueueRecord[]; })));
  return apps.flatMap((app, i) => lists[i]!.map((r) => ({ app, r })));
}

function queuePop(list: Queued[]): PopState {
  const rows: PopRow[] = list.map(({ app, r }) => { const st = arr.stateOf(r), p = arr.progressOf(r); return { id: `${app}:${r.id}`, title: arr.subjectOf(r), subtitle: [arr.APPS[app].title, st.message ? st.message : r.title].filter(Boolean).join(" · "), glyph: GLYPH[app], glyphColor: st.stuck ? "amber" as const : "accent" as const, tag: { text: st.text, color: st.color }, right: pct(p), progress: p, progressColor: st.stuck ? "amber" as const : "blue" as const }; });
  const stuck = list.filter((q) => arr.stateOf(q.r).stuck).length;
  return { kind: "queue", title: rows.length ? `${rows.length} in the arr queues` : "Arr queue", summary: rows.length ? `${rows.length - stuck} moving${stuck ? `, ${stuck} need${stuck === 1 ? "s" : ""} attention` : ""}` : undefined, rows, focus: cursorOf("queue", rows), empty: { title: "The queues are empty", sub: "Radarr, Sonarr and Lidarr are not fetching anything" } };
}

async function renderQueue(ctx: BarCtx): Promise<BarItem> {
  if (!(["radarr", "sonarr", "lidarr"] as ServiceId[]).some(configured)) return { hidden: true };
  const list = await arrQueues(ctx.reason !== "every");
  const stuck = list.filter((q) => arr.stateOf(q.r).stuck).length;
  const states = { queued: list.length, stuck };
  const menu = { view: renderPop(queuePop(list)) };
  if (!list.length) return { hidden: true, states, empty: { icon: GLYPH.queue, tooltip: "The arr queues are empty", menu } };
  return { icon: GLYPH.queue, title: String(list.length), ...(stuck && { badge: stuck }), tooltip: `${list.length} in the queues${stuck ? `, ${stuck} need${stuck === 1 ? "s" : ""} attention` : ""}`, states, menu };
}

async function queueAction(action: string): Promise<Effect | void> {
  const list = await arrQueues(false);
  const rows = queuePop(list).rows;
  const cur = rows[cursorOf("queue", rows)];
  const draw = async (fresh = false): Promise<Effect> => ({ view: renderPop(queuePop(await arrQueues(fresh))) });
  if (action.startsWith("focus:")) { focus.queue = action.slice(6); return draw(); }
  const [app, id] = cur ? [cur.id.slice(0, cur.id.indexOf(":")) as arr.ArrId, cur.id.slice(cur.id.indexOf(":") + 1)] : [undefined, undefined];
  switch (action) {
    case "down": move("queue", rows, 1); return draw();
    case "up": move("queue", rows, -1); return draw();
    case "open-pal": return { push: { extension: EXTENSION, palette: app ?? (["radarr", "sonarr", "lidarr"] as arr.ArrId[]).find(configured) ?? "radarr" } };
    case "remove": { if (!app) return { keep: true }; const r = await arr.pick(`queue:${app}:${id}`, "remove"); if (r?.toast?.style === "failure") return r; forget(`${app}:queue`); return draw(true); }
    case "open": return app ? arr.pick(`queue:${app}:${id}`, "open") : { open: arr.arrUrl((["radarr", "sonarr", "lidarr"] as arr.ArrId[]).find(configured) ?? "radarr") };
  }
}

// ---- wiring ------------------------------------------------------------------------

const input = (list: (q: string) => Promise<Item[]>, pick: Palette["pick"], placeholder: string, detail?: Palette["detail"]): Palette => {
  const run = debounced(SEARCH_WAIT_MS, list);
  return { input: true, placeholder, list: (q = "") => run(q), pick, ...(detail && { detail }) };
};
const arrPalettes = (app: arr.ArrId): Record<string, Palette> => ({
  [app]: { live: true, placeholder: "A title in the queue, or a command", list: (_q, ctx) => arr.homeRows(app, !!ctx?.refresh), pick: arr.pick, detail: arr.detail },
  [`${app}-add`]: input((q) => arr.lookupRows(app, q), arr.pick, app === "radarr" ? "A movie" : app === "sonarr" ? "A series" : "An artist"),
  [`${app}-wanted`]: { placeholder: "A wanted title", list: (_q, ctx) => arr.wantedRows(app, !!ctx?.refresh), pick: arr.pick },
  [`${app}-history`]: { placeholder: "A release", list: (_q, ctx) => arr.historyRows(app, !!ctx?.refresh), pick: arr.pick },
});
const jfDetail = (id: string): Promise<Detail | void> => jellyfin.detail(id);

export default {
  palettes: {
    theater: { live: true, placeholder: "A service", list: (_q, ctx) => guard(() => theaterRows(!!ctx?.refresh)), pick: pickTheater },
    jellyfin: { live: true, placeholder: "A title", list: (_q, ctx) => jellyfin.homeRows(!!ctx?.refresh), pick: jellyfin.pick, detail: jfDetail },
    "jellyfin-search": input(jellyfin.searchRows, jellyfin.pick, "A movie, series, episode, album or song", jfDetail),
    "jellyfin-playing": { live: true, placeholder: "Who, or what", list: (_q, ctx) => jellyfin.playingRows(!!ctx?.refresh), pick: jellyfin.pick },
    "jellyfin-play": { placeholder: "A device", list: (_q, ctx) => jellyfin.playRows(ctx), pick: jellyfin.pick },
    "seerr-requests": { live: true, placeholder: "A title or who asked", filters: seerr.FILTERS, list: (_q, ctx) => seerr.requestRows(ctx?.filter, !!ctx?.refresh), pick: seerr.pick },
    "seerr-request": input(seerr.searchRows, seerr.pick, "A movie or a series", seerr.detail),
    ...arrPalettes("radarr"),
    ...arrPalettes("sonarr"),
    ...arrPalettes("lidarr"),
    downloads: { live: true, placeholder: "A download, or a command", list: (_q, ctx) => downloads.queueRows(!!ctx?.refresh), pick: downloads.pick },
    "downloads-history": { placeholder: "A finished download", list: (_q, ctx) => downloads.historyRows(!!ctx?.refresh), pick: downloads.pick },
    prowlarr: { placeholder: "An indexer", list: (_q, ctx) => prowlarr.indexerRows(!!ctx?.refresh), pick: prowlarr.pick },
    "prowlarr-search": input(prowlarr.searchRows, prowlarr.pick, "A release title"),
    "hydra-search": input(prowlarr.hydraRows, prowlarr.pick, "A release title"),
    navidrome: { live: true, placeholder: "An album", list: (_q, ctx) => navidrome.homeRows(!!ctx?.refresh), pick: navidrome.pick },
    "navidrome-search": input(navidrome.searchRows, navidrome.pick, "An artist, album or song"),
    abs: { live: true, placeholder: "A book or podcast", list: (_q, ctx) => abs.homeRows(!!ctx?.refresh), pick: abs.pick },
    "abs-search": input(abs.searchRows, abs.pick, "A book, podcast or author"),
    kavita: { live: true, placeholder: "A series", list: (_q, ctx) => kavita.homeRows(!!ctx?.refresh), pick: kavita.pick },
    "kavita-search": input(kavita.searchRows, kavita.pick, "A series or a file"),
    shelfmark: input(shelfmark.searchRows, shelfmark.pick, "A book title or an author"),
    "shelfmark-releases": { placeholder: "A release", list: (_q, ctx) => shelfmark.releaseRows(ctx), pick: shelfmark.pick },
    bazarr: { placeholder: "A title wanting subtitles", list: (_q, ctx) => bazarr.rows(!!ctx?.refresh), pick: bazarr.pick },
  },
  bar: {
    downloads: { render: renderDownloads, onAction: downloadsAction },
    playing: { render: renderPlaying, onAction: playingAction },
    requests: { render: renderRequests, onAction: requestsAction },
    queue: { render: renderQueue, onAction: queueAction },
  },
  link: async (route, params): Promise<Effect | void> => {
    const q = typeof params.q === "string" ? params.q : undefined;
    switch (route) {
      case "search": return { push: { extension: EXTENSION, palette: "jellyfin-search", ...(q && { query: q }) } };
      case "request": return { push: { extension: EXTENSION, palette: "seerr-request", ...(q && { query: q }) } };
      case "downloads": return { push: { extension: EXTENSION, palette: "downloads" } };
      case "pause-all": { const did = await downloads.pauseAll(); if (!did.length) throw new Error("no download client is set up"); return { hud: `Paused ${did.join(" and ")}` }; }
      case "resume-all": { const did = await downloads.resumeAll(); if (!did.length) throw new Error("no download client is set up"); return { hud: `Resumed ${did.join(" and ")}` }; }
      case "sync-watchlist": {
        const apps = (params.app ? [String(params.app)] : ["radarr", "sonarr"]).filter((a): a is arr.ArrId => a === "radarr" || a === "sonarr").filter(configured);
        if (!apps.length) throw new Error("neither Radarr nor Sonarr is set up");
        const n = await Promise.all(apps.map((a) => arr.syncLists(a)));
        return { hud: `Syncing ${apps.map((a, i) => `${arr.APPS[a].title} (${n[i]} list${n[i] === 1 ? "" : "s"})`).join(", ")}` };
      }
      case "open": {
        const id = String(params.service) as ServiceId;
        if (!SERVICES.some((s) => s.id === id)) throw new Error(`no service "${id}"`);
        const missing = needsSetup(id);
        if (missing?.which === "url") return { open: settingsLink(id, "url"), hud: `${service(id).title} has no URL yet` };
        return { open: conf(id).url };
      }
    }
  },
} satisfies Extension;
