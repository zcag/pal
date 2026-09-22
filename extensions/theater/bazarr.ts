// Bazarr: how many movies and episodes still want subtitles, each
// provider's health (throttled ones say until when), and the wanted items
// with their missing languages. Search missing subtitles runs Bazarr's
// own wanted-search tasks; cmd+Enter on an item searches for that one.
import { hint, tinted, toast, truncate, type Ctx, type Effect, type Item } from "@zcag/pal";
import { api, cached, conf, configured, GLYPH } from "./http.ts";
import { guard, pickHint } from "./rows.ts";

type Lang = { name: string; code2: string; hi?: boolean; forced?: boolean };
type WantedMovie = { title: string; radarrId: number; missing_subtitles: Lang[]; sceneName?: string };
type WantedEpisode = { seriesTitle: string; episode_number: string; episodeTitle: string; sonarrSeriesId: number; sonarrEpisodeId: number; missing_subtitles: Lang[]; sceneName?: string };
type Provider = { name: string; status: string; retry: string };
type Page<T> = { data: T[]; total: number };

export const bazarrUrl = () => conf("bazarr").url;
export const status = () => api<{ data: { bazarr_version: string } }>("bazarr", "/api/system/status", { timeout: 3500 });
export const wantedMovies = (refresh = false) => cached("bazarr:movies", 300_000, refresh, () => api<Page<WantedMovie>>("bazarr", "/api/movies/wanted", { query: { start: 0, length: 40 } }));
export const wantedEpisodes = (refresh = false) => cached("bazarr:episodes", 300_000, refresh, () => api<Page<WantedEpisode>>("bazarr", "/api/episodes/wanted", { query: { start: 0, length: 40 } }));
export const providers = (refresh = false) => cached("bazarr:providers", 120_000, refresh, async () => (await api<{ data: Provider[] }>("bazarr", "/api/providers")).data);
export const runTask = (taskid: string) => api("bazarr", "/api/system/tasks", { method: "POST", query: { taskid }, text: true });
export const searchMovie = (radarrid: number) => api("bazarr", "/api/movies/subtitles", { method: "PATCH", query: { radarrid }, text: true });
export const searchEpisode = (sonarrEpisodeId: number) => api("bazarr", "/api/episodes/subtitles", { method: "PATCH", query: { sonarrepisodeid: sonarrEpisodeId }, text: true });

const langs = (l: Lang[]) => l.map((x) => `${x.name}${x.hi ? " HI" : ""}${x.forced ? " forced" : ""}`);

export async function rows(refresh: boolean): Promise<Item[]> {
  if (!configured("bazarr")) return [];
  return guard(async () => {
    const [m, e, p] = await Promise.all([wantedMovies(refresh), wantedEpisodes(refresh), providers(refresh).catch(() => [] as Provider[])]);
    const bad = p.filter((x) => x.status !== "Good" && x.name !== "embeddedsubtitles");
    const summary: Item[] = [
      { id: "cmd:search", name: `${m.total} movie${m.total === 1 ? "" : "s"} and ${e.total} episode${e.total === 1 ? "" : "s"} want subtitles`, subtitle: m.total + e.total ? "Enter runs Bazarr's wanted search for all of them" : "Everything has its subtitles", icon: tinted(GLYPH.bazarr, m.total + e.total ? "amber" : "green"), keywords: ["wanted", "missing"], section: "Bazarr", actions: m.total + e.total ? [{ id: "search-all", title: "Search missing subtitles", confirm: `Ask Bazarr to search subtitles for ${m.total + e.total} items now?` }, { id: "open", title: "Open Bazarr", shortcut: "cmd+enter" }] : [{ id: "open", title: "Open Bazarr" }] },
      ...p.map((x): Item => ({ id: `provider:${x.name}`, name: x.name, subtitle: x.status === "Good" ? "Working" : `${x.status}${x.retry && x.retry !== "-" ? `, retry ${x.retry}` : ""}`, icon: tinted(GLYPH.bazarr, x.status === "Good" ? "green" : "red"), section: "Providers", accessories: [{ tag: x.status === "Good" ? "ok" : "throttled", color: x.status === "Good" ? "green" : "red" }], actions: [{ id: "open", title: "Open providers in Bazarr" }] })),
    ];
    if (!p.length) summary.push(hint("providers", "No subtitle provider enabled", "Bazarr can fetch nothing until one is enabled under Settings › Providers", { icon: GLYPH.alert, section: "Providers" }));
    if (bad.length && bad.length === p.filter((x) => x.name !== "embeddedsubtitles").length) summary.push(hint("down", "Every online provider is throttled", "Bazarr can fetch nothing until one comes back", { icon: GLYPH.alert, section: "Providers" }));
    const movies = m.data.map((x): Item => ({ id: `movie:${x.radarrId}`, name: x.title, subtitle: `Wants ${langs(x.missing_subtitles).join(", ")}${x.sceneName ? ` · ${truncate(x.sceneName, 50)}` : ""}`, icon: GLYPH.radarr, keywords: ["movie", ...langs(x.missing_subtitles)], section: "Movies wanting subtitles", accessories: x.missing_subtitles.map((l) => ({ tag: l.code2, color: "amber" })), actions: [{ id: "open", title: "Open in Bazarr" }, { id: "search", title: "Search subtitles now", shortcut: "cmd+enter" }] }));
    const episodes = e.data.map((x): Item => ({ id: `episode:${x.sonarrEpisodeId}`, name: `${x.seriesTitle} ${x.episode_number}${x.episodeTitle ? ` · ${x.episodeTitle}` : ""}`, subtitle: `Wants ${langs(x.missing_subtitles).join(", ")}`, icon: GLYPH.sonarr, keywords: ["episode", x.seriesTitle, ...langs(x.missing_subtitles)], section: "Episodes wanting subtitles", accessories: x.missing_subtitles.map((l) => ({ tag: l.code2, color: "amber" })), actions: [{ id: "open", title: "Open in Bazarr" }, { id: "search", title: "Search subtitles now", shortcut: "cmd+enter" }] }));
    return [...summary, ...movies, ...(m.total > movies.length ? [hint("more-movies", `${m.total - movies.length} more movies on Bazarr's Wanted page`, undefined, { section: "Movies wanting subtitles" })] : []), ...episodes, ...(e.total > episodes.length ? [hint("more-episodes", `${e.total - episodes.length} more episodes on Bazarr's Wanted page`, undefined, { section: "Episodes wanting subtitles" })] : [])];
  });
}

export async function pick(id: string, action?: string, _ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id);
  const u = bazarrUrl();
  try {
    if (id === "cmd:search") {
      if (action !== "search-all") return { open: `${u}/wanted/movies` };
      await Promise.all([runTask("wanted_search_missing_subtitles_movies"), runTask("wanted_search_missing_subtitles_series")]);
      return toast("Searching", "Bazarr is looking for the missing subtitles");
    }
    if (id.startsWith("provider:")) return { open: `${u}/settings/providers` };
    if (id.startsWith("movie:")) { if (action !== "search") return { open: `${u}/movies/${id.slice(6)}` }; await searchMovie(Number(id.slice(6))); return toast("Searching", "Bazarr is looking for the movie's subtitles"); }
    if (id.startsWith("episode:")) { if (action !== "search") return { open: `${u}/wanted/series` }; await searchEpisode(Number(id.slice(8))); return toast("Searching", "Bazarr is looking for the episode's subtitles"); }
  } catch (e) { return toast("Bazarr refused", String((e as Error).message), "failure"); }
}

export async function health() {
  const [s, m, e, p] = await Promise.all([status(), wantedMovies().catch(() => undefined), wantedEpisodes().catch(() => undefined), providers().catch(() => [] as Provider[])]);
  const bad = p.filter((x) => x.status !== "Good").length;
  const wanted = (m?.total ?? 0) + (e?.total ?? 0);
  return { version: s.data.bazarr_version, note: [wanted ? `${wanted} want subtitles` : "nothing wanted", bad ? `${bad} provider${bad === 1 ? "" : "s"} throttled` : ""].filter(Boolean).join(" · "), url: bazarrUrl(), warn: bad > 0 };
}
