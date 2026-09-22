// A mock of the whole theater stack for the tests and the screenshot
// fixture: one Bun server, every service under its own prefix
// (`/jellyfin/...`, `/radarr/...`), answering the routes the extension
// reads and writes over fixture data (never the owner's). `seen` records
// every request; `state` flips the failure modes. `SETTINGS` points every
// service at the server.

export const KEY = "test-key";
export const seen: { method: string; path: string; body?: unknown }[] = [];
export const calls = (method: string, path: string) => seen.filter((s) => s.method === method && s.path.startsWith(path));
export const state = { sabPaused: false, qbitPaused: false, idle: false, qbitVersion: "v5.2.1", down: new Set<string>(), unauthorized: new Set<string>() };

// ---- fixtures ----------------------------------------------------------------

export const JF_USER = "dcf048d52fcb44f8851cfebd38ddf5a1";
export const JF_ITEMS: Record<string, { Id: string; Name: string; Type: string; SeriesName?: string; SeriesId?: string; IndexNumber?: number; ParentIndexNumber?: number; ProductionYear?: number; Overview?: string; RunTimeTicks?: number; CommunityRating?: number; OfficialRating?: string; Genres?: string[]; ImageTags?: Record<string, string>; DateCreated?: string; UserData?: Record<string, unknown> }> = {
  snatch: { Id: "aaa1", Name: "Snatch", Type: "Movie", ProductionYear: 2000, Overview: "Unscrupulous boxing promoters.", RunTimeTicks: 61800000000, CommunityRating: 7.8, OfficialRating: "R", Genres: ["Crime", "Comedy"], ImageTags: { Primary: "t1" }, DateCreated: "2026-09-01T10:00:00Z", UserData: { Played: false, PlaybackPositionTicks: 4326000000, PlayCount: 0, IsFavorite: false } },
  barry: { Id: "bbb2", Name: "Chapter Four: Commit ... to YOU", Type: "Episode", SeriesName: "Barry", SeriesId: "ser1", IndexNumber: 4, ParentIndexNumber: 1, ProductionYear: 2018, Overview: "Barry finds that extricating himself from Fuches is hard.", RunTimeTicks: 17791630000, CommunityRating: 7.3, ImageTags: {}, DateCreated: "2026-08-29T10:00:00Z", UserData: { Played: false, PlaybackPositionTicks: 8895815000, PlayCount: 0, IsFavorite: true } },
  lasso: { Id: "ccc3", Name: "Ted Lasso", Type: "Series", ProductionYear: 2020, Overview: "An American football coach in England.", CommunityRating: 8.3, ImageTags: { Primary: "t3" }, DateCreated: "2026-09-10T10:00:00Z", UserData: { Played: false, UnplayedItemCount: 4, PlaybackPositionTicks: 0, PlayCount: 0, IsFavorite: false } },
  totoro: { Id: "ddd4", Name: "My Neighbor Totoro", Type: "Movie", ProductionYear: 1988, Overview: "Two sisters and a forest spirit.", RunTimeTicks: 51600000000, CommunityRating: 8.1, Genres: ["Animation"], ImageTags: { Primary: "t4" }, DateCreated: "2026-06-01T10:00:00Z", UserData: { Played: true, PlaybackPositionTicks: 0, PlayCount: 2, IsFavorite: false, LastPlayedDate: "2026-09-15T20:00:00Z" } },
};
export const JF_SESSIONS = [
  { Id: "s1", UserName: "cagdas", DeviceName: "Living room TV", Client: "Jellyfin Tizen", LastActivityDate: "2026-09-16T10:29:00Z", SupportsRemoteControl: true, NowPlayingItem: JF_ITEMS.barry!, PlayState: { PositionTicks: 8895815000, IsPaused: false, PlayMethod: "DirectPlay" } },
  { Id: "s2", UserName: "guest", DeviceName: "iPhone", Client: "Swiftfin", LastActivityDate: "2026-09-16T10:20:00Z", SupportsRemoteControl: true, PlayState: {} },
];
export const SEERR_REQUESTS = [
  { id: 11, status: 1, type: "movie", is4k: false, createdAt: "2026-09-15T09:00:00Z", media: { id: 1, tmdbId: 438631, mediaType: "movie", status: 2 }, requestedBy: { displayName: "guest" } },
  { id: 12, status: 2, type: "tv", is4k: true, createdAt: "2026-09-10T09:00:00Z", media: { id: 2, tmdbId: 90228, mediaType: "tv", status: 5, status4k: 3 }, requestedBy: { displayName: "cagdas" }, seasons: [{ seasonNumber: 1 }] },
];
export const SEERR_TITLES: Record<string, unknown> = { "movie/438631": { title: "Dune", releaseDate: "2021-09-15", posterPath: "/dune.jpg", overview: "Paul Atreides." }, "tv/90228": { name: "Dune: Prophecy", firstAirDate: "2024-11-17", posterPath: "/prophecy.jpg", overview: "Ten thousand years before." } };
export const SEERR_SEARCH = [
  { id: 438631, mediaType: "movie", title: "Dune", releaseDate: "2021-09-15", posterPath: "/dune.jpg", overview: "Paul Atreides.", voteAverage: 7.8, mediaInfo: { id: 1, tmdbId: 438631, mediaType: "movie", status: 2 } },
  { id: 693134, mediaType: "movie", title: "Dune: Part Two", releaseDate: "2024-02-27", posterPath: "/dune2.jpg", overview: "The mythic journey.", voteAverage: 8.1 },
  { id: 1, mediaType: "person", name: "Frank Herbert" },
];
const MOVIE = { id: 5, title: "Oppenheimer", year: 2023, tmdbId: 872585, overview: "The bomb.", hasFile: false, monitored: true, status: "released", digitalRelease: "2023-11-21T00:00:00Z", images: [{ coverType: "poster", remoteUrl: "https://img/opp.jpg" }] };
const SERIES = { id: 17, title: "Ted Lasso", year: 2020, tvdbId: 383203, titleSlug: "ted-lasso", status: "continuing", network: "Apple TV", images: [{ coverType: "poster", remoteUrl: "https://img/lasso.jpg" }], seasons: [{ seasonNumber: 1, monitored: true }] };
const ARTIST = { id: 1, artistName: "Snarky Puppy", foreignArtistId: "fe85367e-4036-43c1-874b-b91af81cb4f3", artistType: "Group", images: [] };
export const RADARR_QUEUE = [{ id: 901, title: "Oppenheimer.2023.1080p.WEB-DL", status: "downloading", trackedDownloadStatus: "ok", trackedDownloadState: "downloading", size: 8_000_000_000, sizeleft: 2_000_000_000, timeleft: "00:12:30", protocol: "usenet", downloadClient: "SABnzbd", indexer: "NZBgeek", movieId: 5, movie: MOVIE }];
export const SONARR_QUEUE = [{ id: 902, title: "Ted.Lasso.S04E01.PROPER.1080p.WEB.h264-ETHEL", status: "completed", trackedDownloadStatus: "warning", trackedDownloadState: "importBlocked", statusMessages: [{ title: "Ted.Lasso.S04E01", messages: ["Episode file already imported at a higher quality"] }], size: 3_200_000_000, sizeleft: 0, protocol: "usenet", downloadClient: "SABnzbd", seriesId: 17, episodeId: 1462, series: SERIES, episode: { id: 1462, seriesId: 17, seasonNumber: 4, episodeNumber: 1, title: "Home" } }];
export const SONARR_CALENDAR = [{ id: 1469, seriesId: 17, seasonNumber: 4, episodeNumber: 8, title: "Follow the Anger", airDateUtc: "2026-09-23T04:00:00Z", hasFile: false, series: SERIES }];
export const SONARR_WANTED = { totalRecords: 54, records: [{ id: 2054, seriesId: 28, seasonNumber: 1, episodeNumber: 5, title: "Un Monsieur Triste", airDateUtc: "2017-02-23T05:00:00Z", hasFile: false, series: { ...SERIES, id: 28, title: "Patriot", titleSlug: "patriot" } }] };
export const HISTORY = [{ id: 4893, eventType: "downloadFolderImported", sourceTitle: "Barry.S02E07.1080p.WEB", date: "2026-08-29T12:37:00Z", quality: { quality: { name: "WEBDL-1080p" } }, data: { indexer: "NZBgeek", downloadClient: "SABnzbd" }, series: { ...SERIES, title: "Barry", titleSlug: "barry" }, episode: { id: 1, seriesId: 1, seasonNumber: 2, episodeNumber: 7, title: "The Audition" } }, { id: 4888, eventType: "downloadFailed", sourceTitle: "Barry.S02E03.1080p.WEB", date: "2026-08-29T12:36:00Z", data: { message: "Aborted, cannot be completed" }, series: { ...SERIES, title: "Barry", titleSlug: "barry" } }];
export const SAB_QUEUE = { version: "5.0.3", paused: false, speed: "4.2 M", kbpersec: "4300.00", speedlimit: "0", speedlimit_abs: "0", timeleft: "0:12:30", mbleft: "1900.00", noofslots_total: 2, status: "Downloading", diskspace1_norm: "259.6 G", slots: [
  { nzo_id: "SABnzbd_nzo_1", filename: "Oppenheimer.2023.1080p.WEB-DL", status: "Downloading", percentage: "75", mb: "7629.39", mbleft: "1907.35", timeleft: "0:12:30", cat: "movies", priority: "Normal" },
  { nzo_id: "SABnzbd_nzo_2", filename: "Ted.Lasso.S04E08.1080p.WEB", status: "Queued", percentage: "0", mb: "3100.00", mbleft: "3100.00", timeleft: "0:00:00", cat: "tv", priority: "Normal" },
] };
export const SAB_HISTORY = [{ nzo_id: "SABnzbd_nzo_9", name: "Ted.Lasso.S04E01.PROPER.1080p.WEB", status: "Completed", fail_message: "", category: "tv", bytes: 3_210_000_000, completed: 1787431774, storage: "/data/downloads/usenet/Ted.Lasso.S04E01" }, { nzo_id: "SABnzbd_nzo_8", name: "Severance.S02E06.1080p.WEB", status: "Failed", fail_message: "Aborted, cannot be completed - https://sabnzbd.org/not-complete", category: "tv", bytes: 0, completed: 1787000000 }];
export const TORRENTS = [
  { hash: "f7e9", name: "ted.lasso.s04e04.1080p.web.h264-cakes", state: "downloading", progress: 0.42, dlspeed: 1_200_000, upspeed: 0, eta: 900, size: 3_550_000_000, completed: 1_500_000_000, category: "tv-sonarr", num_seeds: 12, num_leechs: 3, added_on: 1787707696, completion_on: 0, ratio: 0 },
  { hash: "a1b2", name: "Project Hail Mary.epub", state: "stalledDL", progress: 0, dlspeed: 0, upspeed: 0, eta: 8640000, size: 10_300_000, completed: 0, category: "books", num_seeds: 0, num_leechs: 0, added_on: 1787707000, completion_on: 0, ratio: 0 },
  { hash: "c3d4", name: "Dune.2021.2160p", state: "pausedUP", progress: 1, dlspeed: 0, upspeed: 0, eta: 8640000, size: 20_000_000_000, completed: 20_000_000_000, category: "movies", num_seeds: 0, num_leechs: 0, added_on: 1787000000, completion_on: 1787100000, ratio: 0.2 },
];
export const INDEXERS = [{ id: 1, name: "NZBgeek", enable: true, protocol: "usenet", priority: 25, privacy: "private" }, { id: 3, name: "EZTV", enable: true, protocol: "torrent", priority: 25, privacy: "public" }, { id: 4, name: "YTS", enable: false, protocol: "torrent", priority: 25, privacy: "public" }];
export const RELEASES = [{ guid: "https://nzbgeek.info/geekseek.php?guid=1", title: "ubuntu-24.04-desktop-amd64", size: 5_800_000_000, age: 200, grabs: 93, indexer: "NZBgeek", indexerId: 1, protocol: "usenet", infoUrl: "https://nzbgeek.info/geekseek.php?guid=1", downloadUrl: "http://prowlarr/1/download?apikey=x", publishDate: "2026-03-01T00:00:00Z", categories: [{ name: "PC" }] }, { guid: "magnet:?xt=urn:btih:ABC", title: "Ubuntu 22.04 LTS", size: 3_400_000_000, age: 1500, seeders: 37, leechers: 2, indexer: "EZTV", indexerId: 3, protocol: "torrent", magnetUrl: "magnet:?xt=urn:btih:ABC", infoUrl: "https://eztv/ubuntu", categories: [{ name: "PC" }] }];
export const ALBUMS = [{ id: "al1", name: "Immigrance", artist: "Snarky Puppy", artistId: "ar1", coverArt: "al-al1", songCount: 8, duration: 3265, year: 2019, genre: "Fusion", created: "2026-05-29T23:55:34Z" }];
export const SONGS = [{ id: "so1", title: "Chonks", artist: "Snarky Puppy", artistId: "ar1", album: "Immigrance", albumId: "al1", coverArt: "al-al1", duration: 512, starred: "2026-09-01T00:00:00Z" }];
export const ABS_LIB = { id: "lib1", name: "Audiobooks", mediaType: "book" };
export const ABS_ITEM = { id: "it1", libraryId: "lib1", mediaType: "book", addedAt: 1787000000000, media: { metadata: { title: "Project Hail Mary", authorName: "Andy Weir", narratorName: "Ray Porter", publishedYear: "2021", description: "A lone astronaut." }, duration: 58000 } };
export const KAVITA_SERIES = [{ id: 3, name: "Measure What Matters", libraryId: 1, libraryName: "Ebooks", pages: 73, pagesRead: 11, format: 3, created: "2026-08-04T17:35:24", latestReadDate: "2026-08-29T23:45:43", avgHoursToRead: 3.2 }];
export const KAVITA_RECENT = [{ id: 6, name: "Ruby on Rails Guides", libraryId: 1, libraryName: "Ebooks", pages: 51, pagesRead: 0, format: 3, created: "2026-08-04T17:38:24", latestReadDate: "0001-01-01T00:00:00", wordCount: 258737 }];
export const BOOKS = [{ id: "hc1", title: "Dune", author: "Frank Herbert", year: 1965, preview: "https://img/dune.jpg", provider: "hardcover", provider_id: "hc1", series_name: "Dune", series_position: 1 }];
export const BOOK_RELEASES = [{ source: "prowlarr", source_id: "r1", title: "Frank Herbert - Dune (epub)", format: "epub", size: "1.2 MB", size_bytes: 1_200_000, download_url: "http://prowlarr/1/dl", protocol: "usenet", indexer: "NZBgeek" }, { source: "prowlarr", source_id: "r2", title: "Dune - Frank Herbert.epub", format: "epub", size: "980 KB", protocol: "torrent", indexer: "1337x", seeders: 41 }];
export const BAZARR_MOVIES = { data: [{ title: "Sovereign", radarrId: 48, missing_subtitles: [{ name: "Turkish", code2: "tr", code3: "tur" }], sceneName: "Sovereign.2025.1080p.WEB" }], total: 2 };
export const BAZARR_EPISODES = { data: [{ seriesTitle: "The Venture Bros.", episode_number: "1x13", episodeTitle: "Return to Spider-Skull Island", sonarrSeriesId: 25, sonarrEpisodeId: 1970, missing_subtitles: [{ name: "Turkish", code2: "tr", code3: "tur" }] }], total: 49 };
export const PROVIDERS = [{ name: "embeddedsubtitles", status: "Good", retry: "-" }, { name: "opensubtitlescom", status: "Good", retry: "-" }, { name: "subf2m", status: "Throttled", retry: "in 11 hours" }];
export const SHELF_STATUS = { downloading: { d1: { id: "d1", title: "Project Hail Mary", author: "Andy Weir", progress: 42, format: "epub" } }, queued: {}, complete: {}, error: { e1: { id: "e1", title: "Love's Executioner", error: "stalled, no seeders" } }, cancelled: {}, locating: {}, resolving: {} };

// ---- the server --------------------------------------------------------------------

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const text = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers });
const subsonic = (body: Record<string, unknown>) => json({ "subsonic-response": { status: "ok", version: "1.16.1", type: "navidrome", serverVersion: "0.61.2 (aa84e645)", ...body } });

export const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const [, svc, ...rest] = url.pathname.split("/");
    const path = "/" + rest.join("/");
    let body: unknown;
    if (req.method !== "GET" && req.headers.get("content-type")?.includes("json")) body = await req.json().catch(() => undefined);
    else if (req.method !== "GET") body = await req.text().catch(() => undefined);
    seen.push({ method: req.method, path: `/${svc}${path}${url.search}`, body });
    if (state.down.has(svc!)) return text("gateway down", 502);
    const q = url.searchParams;
    const keyOk = (h: string) => req.headers.get(h) === KEY;
    switch (svc) {
      case "jellyfin": {
        if (path === "/Items" && /Images/.test(path)) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
        if (/^\/Items\/[^/]+\/Images\/Primary$/.test(path)) return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "content-type": "image/png" } });
        if (!keyOk("x-emby-token") || state.unauthorized.has("jellyfin")) return text("Unauthorized", 401);
        if (path === "/System/Info/Public") return json({ ServerName: "marko", Version: "10.11.11", Id: "srv" });
        if (path === "/Users") return json([{ Id: "u2", Name: "guest", Policy: { IsAdministrator: false } }, { Id: JF_USER, Name: "cagdas", Policy: { IsAdministrator: true } }]);
        if (path === "/Sessions") return json(JF_SESSIONS);
        if (path === "/UserItems/Resume") return json({ Items: [JF_ITEMS.snatch, JF_ITEMS.barry] });
        if (path === "/Items/Latest") return json([JF_ITEMS.lasso, JF_ITEMS.snatch]);
        if (path === "/Items") { const t = (q.get("searchTerm") ?? "").toLowerCase(); return json({ Items: Object.values(JF_ITEMS).filter((i) => i.Name.toLowerCase().includes(t) || i.SeriesName?.toLowerCase().includes(t)) }); }
        const one = /^\/Items\/(\w+)$/.exec(path);
        if (one) { const it = Object.values(JF_ITEMS).find((i) => i.Id === one[1]); return it ? json(it) : text("", 404); }
        if (/^\/UserPlayedItems\/\w+$/.test(path) || /^\/UserFavoriteItems\/\w+$/.test(path)) return json({ Played: req.method === "POST" });
        if (/^\/Sessions\/\w+\/Playing(\/\w+)?$/.test(path)) return text("", 204);
        break;
      }
      case "seerr": {
        if (!keyOk("x-api-key")) return json({ message: "API key required" }, 403);
        if (path === "/api/v1/status") return json({ version: "2.7.3" });
        if (path === "/api/v1/settings/public") return json({ movie4kEnabled: true, series4kEnabled: false });
        if (path === "/api/v1/request/count") return json({ total: 2, pending: 1, approved: 1, available: 1, processing: 0 });
        if (path === "/api/v1/request" && req.method === "GET") { const f = q.get("filter"); return json({ results: SEERR_REQUESTS.filter((r) => f === "all" || !f || (f === "pending" && r.status === 1) || (f === "approved" && r.status === 2) || (f === "available" && r.media.status === 5)) }); }
        if (path === "/api/v1/request" && req.method === "POST") return json({ id: 13, status: 1, ...(body as object) }, 201);
        if (/^\/api\/v1\/request\/\d+\/(approve|decline)$/.test(path)) return json({ ok: true });
        if (path === "/api/v1/search") return json({ results: (q.get("query") ?? "").includes("dune") ? SEERR_SEARCH : [] });
        const t = /^\/api\/v1\/(movie|tv)\/(\d+)$/.exec(path);
        if (t) return SEERR_TITLES[`${t[1]}/${t[2]}`] ? json(SEERR_TITLES[`${t[1]}/${t[2]}`]) : text("", 404);
        break;
      }
      case "radarr": case "sonarr": case "lidarr": {
        if (!keyOk("x-api-key")) return json({ message: "Unauthorized" }, 401);
        const v = svc === "lidarr" ? "/api/v1" : "/api/v3";
        const p = path.startsWith(v) ? path.slice(v.length) : path;
        if (p === "/system/status") return json({ appName: svc, version: svc === "radarr" ? "6.1.1" : svc === "sonarr" ? "4.0.17" : "3.1.0" });
        if (p === "/health") return json(svc === "sonarr" ? [{ source: "UpdateCheck", type: "warning", message: "New update is available", wikiUrl: "https://wiki/update" }] : []);
        if (p === "/queue") return json({ totalRecords: 1, records: svc === "radarr" ? RADARR_QUEUE : svc === "sonarr" ? SONARR_QUEUE : [] });
        if (p === "/calendar") return json(svc === "sonarr" ? SONARR_CALENDAR : []);
        if (p === "/wanted/missing") return json(svc === "sonarr" ? SONARR_WANTED : svc === "radarr" ? { totalRecords: 1, records: [MOVIE] } : { totalRecords: 0, records: [] });
        if (p === "/history") return json({ totalRecords: 2, records: svc === "sonarr" ? HISTORY : [] });
        if (p === "/importlist") return json(svc === "lidarr" ? [] : [{ id: 1, enabled: true, name: "Trakt User" }, { id: 2, enabled: false, name: "Old" }]);
        if (p === "/qualityprofile") return json([{ id: 7, name: "HD" }]);
        if (p === "/rootfolder") return json([{ id: 1, path: `/data/library/${svc}` }]);
        if (p === "/metadataprofile") return json([{ id: 1 }]);
        if (p === "/movie/lookup") return json((q.get("term") ?? "").includes("opp") ? [MOVIE, { title: "Oppenheimer After Trinity", year: 2023, tmdbId: 1143770 }] : []);
        if (p === "/series/lookup") return json((q.get("term") ?? "").includes("lasso") ? [SERIES] : []);
        if (p === "/artist/lookup") return json((q.get("term") ?? "").includes("snarky") ? [ARTIST, { artistName: "Snarky Anarchy", foreignArtistId: "feb1c651", artistType: "Group" }] : []);
        if (p === "/movie" || p === "/series" || p === "/artist") return json({ id: 99, ...(body as object) }, 201);
        if (p === "/command") return json({ id: 1, name: (body as { name: string }).name, status: "queued" }, 201);
        if (/^\/queue\/\d+$/.test(p) && req.method === "DELETE") return text("", 200);
        break;
      }
      case "prowlarr": {
        if (!keyOk("x-api-key")) return json({ message: "Unauthorized" }, 401);
        if (path === "/api/v1/system/status") return json({ version: "2.3.5" });
        if (path === "/api/v1/indexer") return json(INDEXERS);
        if (path === "/api/v1/indexerstatus") return json([{ indexerId: 3, disabledTill: "2099-01-01T00:00:00Z", mostRecentFailure: "Unable to access eztvx.to, blocked by CloudFlare" }]);
        if (path === "/api/v1/health") return json([]);
        if (path === "/api/v1/search" && req.method === "GET") return json((q.get("query") ?? "").includes("ubuntu") ? RELEASES : []);
        if (path === "/api/v1/search" && req.method === "POST") return json({ ok: true });
        if (/^\/api\/v1\/indexer\/\d+\/test$/.test(path)) return text("", 200);
        break;
      }
      case "hydra": {
        if (q.get("apikey") !== KEY) return json({ error: "wrong api key" }, 403);
        if (q.get("t") === "caps") return json({ server: { attributes: { version: "8.8.1" } } });
        if (q.get("t") === "search") return json({ channel: { item: (q.get("q") ?? "").includes("ubuntu") ? [{ title: "ubuntu-20.04.3-desktop-amd64", guid: "-1572", link: `${url.origin}/hydra/getnzb/api/-1572?apikey=${KEY}`, comments: "https://nzbgeek.info/geekseek.php?guid=2", pubDate: 1660000000, category: "PC", attr: [{ attributes: { name: "size", value: "2458000000" } }, { attributes: { name: "grabs", value: "206" } }, { attributes: { name: "hydraIndexerName", value: "NZBGeek" } }] }] : [] } });
        break;
      }
      case "bazarr": {
        if (!keyOk("x-api-key")) return text("Unauthorized", 401);
        if (path === "/api/system/status") return json({ data: { bazarr_version: "1.5.6" } });
        if (path === "/api/movies/wanted") return json(BAZARR_MOVIES);
        if (path === "/api/episodes/wanted") return json(BAZARR_EPISODES);
        if (path === "/api/providers") return json({ data: PROVIDERS });
        if (path === "/api/system/tasks" || path === "/api/movies/subtitles" || path === "/api/episodes/subtitles") return text("", 204);
        break;
      }
      case "sab": {
        if (q.get("apikey") !== KEY) return json({ status: false, error: "API Key Incorrect" }, 403);
        switch (q.get("mode")) {
          case "version": return json({ version: "5.0.3" });
          case "queue": if (q.get("name")) return json({ status: true }); return json({ queue: { ...SAB_QUEUE, paused: state.sabPaused, noofslots_total: state.idle ? 0 : 2, kbpersec: state.idle || state.sabPaused ? "0" : SAB_QUEUE.kbpersec, slots: state.idle ? [] : state.sabPaused ? SAB_QUEUE.slots.map((s) => ({ ...s, status: "Paused" })) : SAB_QUEUE.slots } });
          case "history": if (q.get("name")) return json({ status: true }); return json({ history: { slots: SAB_HISTORY } });
          case "pause": state.sabPaused = true; return json({ status: true });
          case "resume": state.sabPaused = false; return json({ status: true });
          case "config": return json({ status: true, value: q.get("value") });
          case "addurl": return json({ status: true, nzo_ids: ["SABnzbd_nzo_new"] });
        }
        break;
      }
      case "qbit": {
        if (path === "/api/v2/auth/login") return req.headers.get("referer") ? text("Ok.", 200, { "set-cookie": "SID=cookie1; HttpOnly" }) : text("Fails.", 200);
        const cookie = req.headers.get("cookie")?.includes("SID=cookie1"), bearer = req.headers.get("authorization") === `Bearer ${KEY}`;
        if (!cookie && !bearer) return text("Forbidden", 403);
        if (path === "/api/v2/app/version") return text(state.qbitVersion);
        if (path === "/api/v2/torrents/info") return json(state.idle ? [] : state.qbitPaused ? TORRENTS.map((t) => ({ ...t, state: t.progress >= 1 ? "stoppedUP" : "stoppedDL", dlspeed: 0 })) : TORRENTS);
        if ((path === "/api/v2/torrents/stop" || path === "/api/v2/torrents/start") && String(body).includes("hashes=all")) state.qbitPaused = path.endsWith("stop");
        if (path === "/api/v2/transfer/info") return json({ dl_info_speed: state.idle || state.qbitPaused ? 0 : 1_200_000, up_info_speed: 0, dl_rate_limit: 0, connection_status: "connected" });
        if (/^\/api\/v2\/(torrents\/(stop|start|pause|resume|delete|add)|transfer\/setDownloadLimit)$/.test(path)) return text("Ok.");
        break;
      }
      case "navidrome": {
        if (q.get("u") !== "cagdas" || !q.get("t") || !q.get("s")) return json({ "subsonic-response": { status: "failed", error: { code: 40, message: "Wrong username or password" } } });
        if (path === "/rest/ping.view") return subsonic({});
        if (path === "/rest/getNowPlaying.view") return subsonic({ nowPlaying: { entry: [{ ...SONGS[0], username: "cagdas", playerName: "Symfonium", minutesAgo: 1 }] } });
        if (path === "/rest/getAlbumList2.view") return subsonic({ albumList2: { album: ALBUMS } });
        if (path === "/rest/search3.view") return subsonic({ searchResult3: (q.get("query") ?? "").includes("snarky") ? { artist: [{ id: "ar1", name: "Snarky Puppy", albumCount: 2, coverArt: "ar-ar1" }], album: ALBUMS, song: SONGS } : {} });
        if (path === "/rest/star.view" || path === "/rest/unstar.view") return subsonic({});
        if (path === "/rest/getCoverArt.view") return new Response(new Uint8Array([255, 216, 255]), { headers: { "content-type": "image/jpeg" } });
        break;
      }
      case "abs": {
        if (path === "/status") return json({ serverVersion: "2.35.1" });
        if (path === "/login") return (body as { password?: string })?.password === "pw" ? json({ user: { id: "u1", username: "cagdas", token: "abs-jwt" } }) : json({ error: "Invalid user or password" }, 401);
        if (/^\/api\/items\/\w+\/cover$/.test(path)) return new Response(new Uint8Array([255, 216, 255]), { headers: { "content-type": "image/jpeg" } });
        if (req.headers.get("authorization") !== "Bearer abs-jwt") return text("Unauthorized", 401);
        if (path === "/api/libraries") return json({ libraries: [ABS_LIB] });
        if (path === "/api/me") return json({ username: "cagdas", mediaProgress: [{ id: "p1", libraryItemId: "it1", progress: 0.31, isFinished: false, lastUpdate: 1787400000000 }] });
        if (path === "/api/me/items-in-progress") return json({ libraryItems: [ABS_ITEM] });
        if (path === "/api/libraries/lib1/items") return json({ results: [ABS_ITEM, { ...ABS_ITEM, id: "it2", media: { metadata: { title: "The Martian", authorName: "Andy Weir" }, duration: 39000 } }] });
        if (path === "/api/libraries/lib1/search") return json((q.get("q") ?? "").includes("mars") ? { book: [{ libraryItem: { ...ABS_ITEM, id: "it2", media: { metadata: { title: "The Martian", authorName: "Andy Weir" }, duration: 39000 } } }], authors: [{ id: "au1", name: "Andy Weir", numBooks: 2 }] } : { book: [], authors: [] });
        if (/^\/api\/me\/progress\/\w+$/.test(path)) return json({ ok: true });
        break;
      }
      case "kavita": {
        if (path === "/api/Account/login") return (body as { password?: string })?.password === "pw" ? json({ username: "cagdas", token: "kavita-jwt", apiKey: "kavita-key" }) : json({ message: "Invalid" }, 401);
        if (path === "/api/image/series-cover") return q.get("apiKey") === "kavita-key" ? new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }) : text("", 401);
        if (req.headers.get("authorization") !== "Bearer kavita-jwt") return text("Unauthorized", 401);
        if (path === "/api/Server/server-info-slim") return json({ kavitaVersion: "0.9.0.2" });
        if (path === "/api/Series/on-deck") return json(KAVITA_SERIES);
        if (path === "/api/Series/recently-added-v2") return json([...KAVITA_SERIES, ...KAVITA_RECENT]);
        if (path === "/api/Search/search") return json((q.get("queryString") ?? "").includes("ruby") ? { series: [{ seriesId: 6, name: "Ruby on Rails Guides", libraryId: 1, libraryName: "Ebooks", format: 3 }], collections: [], readingLists: [], files: [{ id: 7, filePath: "/books/Ruby on Rails/Ruby on Rails Guides v6.1.epub", format: 3, pages: 51 }] } : { series: [], files: [] });
        break;
      }
      case "shelfmark": {
        if (path === "/api/status") return json(SHELF_STATUS);
        if (path === "/api/metadata/search") return json({ books: (q.get("query") ?? "").includes("dune") ? BOOKS : [], provider: "hardcover", total_found: 1 });
        if (path === "/api/releases" && req.method === "GET") return q.get("book_id") === "hc1" ? json({ releases: BOOK_RELEASES }) : json({ error: "Parameters 'provider' and 'book_id' are required" }, 400);
        if (path === "/api/releases/download") return json({ status: "queued" });
        break;
      }
      case "filebrowser": case "homepage": return text("<html>ok</html>", 200, { "content-type": "text/html" });
    }
    return json({ error: "Resource not found" }, 404);
  },
});

export const BASE = `http://127.0.0.1:${server.port}`;
const at = (svc: string) => `${BASE}/${svc}`;

/** `[extensions.theater]` with every service pointed at the mock. */
export const SETTINGS: Record<string, string> = {
  jellyfin_url: at("jellyfin"), jellyfin_key: KEY, jellyfin_user: "cagdas",
  seerr_url: at("seerr"), seerr_key: KEY,
  radarr_url: at("radarr"), radarr_key: KEY, sonarr_url: at("sonarr"), sonarr_key: KEY, lidarr_url: at("lidarr"), lidarr_key: KEY,
  prowlarr_url: at("prowlarr"), prowlarr_key: KEY, hydra_url: at("hydra"), hydra_key: KEY, bazarr_url: at("bazarr"), bazarr_key: KEY,
  sab_url: at("sab"), sab_key: KEY, qbit_url: at("qbit"), qbit_key: "", qbit_user: "admin", qbit_password: "pw",
  navidrome_url: at("navidrome"), navidrome_user: "cagdas", navidrome_password: "pw",
  abs_url: at("abs"), abs_user: "cagdas", abs_password: "pw",
  kavita_url: at("kavita"), kavita_user: "cagdas", kavita_password: "pw",
  shelfmark_url: at("shelfmark"), filebrowser_url: at("filebrowser"), homepage_url: at("homepage"),
};
