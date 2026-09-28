// Writes app/src/gallery/shots/theater.json and bar-theater.json: the
// store screenshots' fixture. The rows and the popovers come out of the
// real extension run through the host harness against the tests' mock
// stack (host/test/extensions/theater-mock.ts), its titles swapped for
// invented ones first and every poster drawn here as an SVG (the mock's
// are a few bytes, and a real film's art is someone's); nothing here is
// the owner's. `make shots EXT=theater`.
import { BUNDLED, Host, stored } from "../../host/test/harness.ts";
import * as M from "../../host/test/extensions/theater-mock.ts";
import { pinClock, seeded, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import manifest from "./pal.json" with { type: "json" };

// ---- invented titles over the mock's (the tests keep theirs) ----------------------------------

const me = "deniz";
Object.assign(M.JF_ITEMS.snatch, { Name: "The Salt Road", ProductionYear: 2019, Overview: "Two brothers drive a salt caravan across a drying lake.", Genres: ["Drama", "Adventure"] });
Object.assign(M.JF_ITEMS.barry, { Name: "The Lighthouse Keeper", SeriesName: "Harbour Lights", Overview: "A storm cuts the island off for a night." });
Object.assign(M.JF_ITEMS.lasso, { Name: "Northern Line", Overview: "A night-shift tram crew and the city they keep awake." });
Object.assign(M.JF_ITEMS.totoro, { Name: "Paper Lanterns", Overview: "Two sisters and a festival that never ends.", Genres: ["Animation"] });
for (const s of M.JF_SESSIONS) if (s.UserName === "cagdas") s.UserName = me;
for (const r of M.SEERR_REQUESTS) if (r.requestedBy.displayName === "cagdas") r.requestedBy.displayName = me;
Object.assign(M.SEERR_TITLES["movie/438631"] as object, { title: "Glass Harvest", posterPath: "/glass-harvest.jpg", overview: "A farming colony on a planet of mirrors." });
Object.assign(M.SEERR_TITLES["tv/90228"] as object, { name: "Glass Harvest: Origins", posterPath: "/glass-harvest-origins.jpg", overview: "A century before the first harvest." });
const movie = M.RADARR_QUEUE[0]!.movie, series = M.SONARR_QUEUE[0]!.series;
Object.assign(movie, { title: "Iron Meridian", overview: "A surveyor follows a railway nobody finished.", images: [{ coverType: "poster", remoteUrl: "https://img/iron-meridian.jpg" }] });
Object.assign(series, { title: "Northern Line", titleSlug: "northern-line", network: "Harbor TV", images: [{ coverType: "poster", remoteUrl: "https://img/northern-line.jpg" }] });
M.RADARR_QUEUE[0]!.title = "Iron.Meridian.2023.1080p.WEB-DL";
Object.assign(M.SONARR_QUEUE[0]!, { title: "Northern.Line.S04E01.PROPER.1080p.WEB.h264-TRAM", statusMessages: [{ title: "Northern.Line.S04E01", messages: ["Episode file already imported at a higher quality"] }] });
M.SONARR_QUEUE[0]!.episode.title = "Last Tram";
M.SONARR_CALENDAR[0]!.title = "Signal Failure";
Object.assign(M.SAB_QUEUE.slots[0]!, { filename: "Iron.Meridian.2023.1080p.WEB-DL" });
Object.assign(M.SAB_QUEUE.slots[1]!, { filename: "Northern.Line.S04E08.1080p.WEB" });
Object.assign(M.TORRENTS[0]!, { name: "northern.line.s04e04.1080p.web.h264-tram" });
Object.assign(M.TORRENTS[1]!, { name: "The Quiet Orbit.epub" });
Object.assign(M.TORRENTS[2]!, { name: "Glass.Harvest.2021.2160p" });
// Indexers named for what they are, not after real sites; the search is a Linux image, the plain legal case.
const rename: Record<string, string> = { NZBgeek: "Northwind", EZTV: "Mirrorlist", YTS: "Archive" };
for (const i of M.INDEXERS) i.name = rename[i.name] ?? i.name;
for (const r of M.RELEASES) { r.indexer = rename[r.indexer] ?? r.indexer; r.infoUrl = `https://indexer.example/${r.indexerId}`; }

// ---- posters: a gradient, a shape and the title, the same for a title every run ----------------

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function poster(title: string, seed: number): string {
  const r = seeded(seed), hue = Math.floor(r() * 360), hue2 = (hue + 40 + Math.floor(r() * 80)) % 360;
  const words = title.toUpperCase().split(" ");
  const lines = words.reduce<string[]>((a, w) => (a.length && (a.at(-1)! + " " + w).length <= 10 ? [...a.slice(0, -1), a.at(-1) + " " + w] : [...a, w]), []);
  const body = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 42%)"/><stop offset="1" stop-color="hsl(${hue2} 60% 14%)"/></linearGradient></defs>`
    + `<rect width="200" height="300" fill="url(#g)"/><circle cx="${60 + r() * 80}" cy="${90 + r() * 40}" r="${34 + r() * 22}" fill="hsl(${hue2} 80% 75%)" opacity=".55"/>`
    + `<path d="M0 ${200 + r() * 30} Q100 ${160 + r() * 30} 200 ${205 + r() * 30} V300 H0z" fill="hsl(${hue} 50% 10%)" opacity=".7"/>`
    + lines.map((l, i) => `<text x="100" y="${236 + i * 22 - (lines.length - 1) * 11}" text-anchor="middle" font-family="Georgia, serif" font-size="19" font-weight="700" fill="#fff" letter-spacing="1">${esc(l)}</text>`).join("");
  return `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">${body}</svg>`).toString("base64")}`;
}
/** A token in a picture's address (a Jellyfin id, a poster path) to the title it shows. */
const POSTERS: Record<string, string> = {
  "/Items/aaa1/": "The Salt Road", "/Items/ser1/": "Harbour Lights", "/Items/bbb2/": "Harbour Lights", "/Items/ccc3/": "Northern Line", "/Items/ddd4/": "Paper Lanterns",
  "/glass-harvest.jpg": "Glass Harvest", "/glass-harvest-origins.jpg": "Glass Harvest: Origins", "/iron-meridian.jpg": "Iron Meridian", "/northern-line.jpg": "Northern Line",
};
const drawn = Object.fromEntries(Object.entries(POSTERS).map(([k, t], i) => [k, poster(t, [...t].reduce((n, c) => n * 31 + c.charCodeAt(0), 7) >>> 0 || i)]));
/** Every picture address with a token swapped for its poster (before `settle`, which would inline the mock's few bytes). */
const withPosters = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/https?:\/\/[^\s"')\]]+/g, (url) => {
  const key = Object.keys(drawn).find((k) => url.includes(k));
  return key ? drawn[key]! : url;
}));

for (const k of Object.keys(process.env)) if (k.startsWith("PAL_THEATER_")) delete process.env[k];
pinClock();
stored.clear();
const icon = manifest.icon;
const host = await Host.bundled({ roots: [BUNDLED], settings: { theater: { settings: M.SETTINGS } }, timeout: 20000 });
try {
  const loaded = (await host.hello()).extensions.find((x) => x.name === "theater")!;
  const meta = (name: string) => loaded.palettes.find((p) => p.name === name)!;
  const list = (p: string, q?: string, ctx?: Record<string, unknown>) => host.list("theater", p, q, ctx as never);
  const pal = async (name: string, extra: Record<string, unknown> = {}) => { const m = meta(name); return { title: m.title, icon, placeholder: m.placeholder, live: m.live || undefined, items: await list(name), ...extra }; };
  const search = async (name: string, queries: string[]) => { const m = meta(name); const byQuery: Record<string, unknown> = {}; for (const q of ["", ...queries]) byQuery[q] = await list(name, q); return { title: m.title, icon, input: true, placeholder: m.placeholder, byQuery }; };
  const downloads = await host.render("theater", "downloads", { reason: "cli" });
  // Both clients paused (space on the popover), drawn after the palettes below.
  const pauseAll = async () => { M.state.sabPaused = M.state.qbitPaused = true; return host.render("theater", "downloads", { reason: "cli" }); };
  const fixture = {
    palettes: {
      theater: await pal("theater"),
      jellyfin: await pal("jellyfin"),
      "seerr-requests": await pal("seerr-requests"),
      sonarr: await pal("sonarr"),
      downloads: await pal("downloads"),
      "prowlarr-search": await search("prowlarr-search", ["ubuntu"]),
    },
    effects: { "downloads/cmd:limit": await host.pick("theater", "downloads", "cmd:limit") },
    shots: {
      "1-theater": { palette: "theater", keys: ["down*3", "wait:300"], caption: "Every service of the home media stack on one list: its version, what it is doing, and what needs a hand" },
      "2-jellyfin": { palette: "jellyfin", keys: ["down", "wait:300"], caption: "Jellyfin: what you are halfway through and what just arrived, how far in and the rating; cmd+Enter plays it on the TV" },
      "3-requests": { palette: "seerr-requests", caption: "Requests: the pending ones first with who asked, 4K and where each one stands; approve or decline from the row" },
      "4-sonarr": { palette: "sonarr", keys: ["down*7", "wait:300"], caption: "Sonarr: its commands, its health, an import stuck in the queue with the reason, and what airs this week" },
      "5-downloads": { palette: "downloads", keys: ["down*2", "wait:300"], caption: "SABnzbd and qBittorrent in one list: speed, time left and size; pause everything or set a limit" },
      "6-indexers": { palette: "prowlarr-search", keys: ["type:ubuntu", "wait:700"], caption: "One search across every Prowlarr indexer, grouped by indexer with size, age and grabs; Enter sends it to the downloader" },
    },
  };
  const paused = await pauseAll();
  const hosts = { [M.BASE]: "https://media.home.example" };
  writeFixture("theater", await settle(withPosters(fixture), { hosts }));
  const barFixture = {
    key: "theater/downloads",
    title: manifest.bar.downloads.title,
    item: downloads,
    // The manifest's `paused` rule (core applies rules; the gallery draws the item as rendered).
    states: [{ id: "paused", item: { ...paused, color: manifest.bar.downloads.rules.find((r) => r.id === "paused")!.color } }],
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar: the combined download speed and how many items are active" },
      "menubar-paused": { target: "menubar", state: "paused", caption: "Everything paused: the item turns amber and says how many wait in the queue" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the queue: every item with its progress bar, space pauses everything" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the speed and the count" },
    },
  };
  writeFixture("bar-theater", await settle(withPosters(barFixture), { hosts }));
  console.log(`${fixture.palettes.theater.items.length} service rows, ${fixture.palettes.downloads.items.length} download rows, bar title ${downloads.title}`);
} finally {
  await host.close();
  M.server.stop(true);
}
