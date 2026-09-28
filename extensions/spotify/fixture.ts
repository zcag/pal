// Writes app/src/gallery/shots/spotify.json and bar-spotify.json: the
// store screenshots' fixtures. The lyrics view's trees come from view.ts
// over a made-up track (its words are this file's, not a real song's; the
// covers are SVGs drawn here, since the gallery has no Spotify), the rows
// from the same shapes the palettes build; the library's dates count back
// from fixture-kit's clock. `make shots EXT=spotify`.
import { NOW, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { tintFrom } from "./color.ts";
import { parseLrc } from "./lyrics.ts";
import { render, type NowState } from "./view.ts";
import type { Track } from "./api.ts";

/** An abstract cover: a warm or cool field with soft discs, as SVG. */
function coverSvg(bg: string, discs: [string, number, number, number][]): string {
  const body = discs.map(([c, x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="0.85"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/>${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const COVERS = {
  salt: coverSvg("#2a1a3d", [["#e8663a", 22, 40, 20], ["#f5b74a", 44, 22, 14], ["#c2405e", 12, 14, 9]]),
  tide: coverSvg("#10263f", [["#3d8bd9", 26, 26, 18], ["#7fd0c8", 46, 44, 12], ["#f0e3b0", 14, 50, 6]]),
  glass: coverSvg("#1b2a1f", [["#6bc47a", 30, 34, 20], ["#e4f1a3", 48, 18, 9]]),
  night: coverSvg("#171717", [["#9a8cff", 32, 32, 22], ["#ff8ac2", 50, 50, 10]]),
  focus: coverSvg("#232a3a", [["#5e7ce2", 20, 44, 16], ["#a3b8ff", 44, 20, 12]]),
  weekly: coverSvg("#1f1f24", [["#1db954", 32, 32, 20]]),
};

const track = (id: string, name: string, artist: string, album: string, duration: number, cover: string): Track => ({ kind: "track", id, uri: `spotify:track:${id}`, name, url: `https://open.spotify.com/track/${id}`, artist, album, duration, cover, thumb: cover });
const HARBOUR = track("h1", "Harbour Lights", "The Low Tide", "Salt & Static", 254_000, COVERS.salt);
const PAPER = track("h2", "Paper Boats", "The Low Tide", "Salt & Static", 211_000, COVERS.salt);
const GLASS = track("g1", "Glass Morning", "Fern Alder", "Greenhouse", 198_000, COVERS.glass);
const NIGHT = track("n1", "Night Bus", "Orbit Club", "Late", 305_000, COVERS.night);
const TIDE = track("t1", "Undertow", "The Low Tide", "Tidal", 276_000, COVERS.tide);

/** The words of "Harbour Lights", written for this fixture. */
const LRC = `[00:12.40] Harbour lights on the water
[00:18.90] Counting boats that never came
[00:25.30] You said the tide would carry us
[00:31.80] Somewhere past the salt and static
[00:38.20] So I wait where the gulls are
[00:44.60] With a coat that smells of rain
[00:51.10] And the radio keeps playing
[00:57.50] Someone else's song again
[01:04.00] Harbour lights, harbour lights
[01:10.40] Hold the dark a little longer
[01:16.90] Harbour lights, harbour lights
[01:23.30] I am still here on the shore
`;
const lines = parseLrc(LRC);
const tint = tintFrom({ r: 232, g: 102, b: 58 });

const now: NowState = {
  layout: "wide", track: HARBOUR, playing: true, position: 47.2, shuffle: false, repeat: "context", liked: true,
  device: { name: "MacBook Air", volume: 45 }, lyrics: { synced: lines, id: 1 }, cover: COVERS.salt, tint,
};
const compact: NowState = { ...now, layout: "compact", queue: [PAPER, TIDE].map((t) => ({ id: t.id, name: t.name, artist: t.artist, cover: t.cover })) };

const ms = (d: number) => { const t = Math.floor(d / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const TRACK_ACTIONS = (liked = false) => [{ id: "play", title: "Play" }, { id: "queue", title: "Add to queue", shortcut: "cmd+enter" }, { id: "like", title: liked ? "Unlike" : "Like", shortcut: "cmd+l" }, { id: "open", title: "Open in Spotify", shortcut: "cmd+o" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }];
const trackRow = (t: Track, section?: string, extra: Record<string, unknown> = {}) => ({ id: `track:${t.id}`, name: t.name, subtitle: `${t.artist} · ${t.album}`, icon: { image: t.cover }, keywords: [t.artist, t.album, "spotify"], section, accessories: [{ text: ms(t.duration) }], actions: TRACK_ACTIONS(t.id === "h1"), ...extra });
const containerActions = (kind: string) => [{ id: "play", title: "Play" }, ...(kind !== "artist" && kind !== "show" ? [{ id: "tracks", title: "Show tracks", shortcut: "cmd+enter" }] : []), ...(kind === "playlist" ? [{ id: "shuffle", title: "Play shuffled", shortcut: "cmd+s" }] : []), { id: "open", title: "Open in Spotify", shortcut: "cmd+o" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }];
const ICON = { tile: { glyph: "\u{f04c7}", bg: "green" } };

const searchRows = [
  trackRow(HARBOUR, "Tracks"), trackRow(TIDE, "Tracks"), trackRow(PAPER, "Tracks"),
  { id: "artist:a1", name: "The Low Tide", subtitle: "indie folk, coastal", icon: { image: COVERS.tide }, section: "Artists", accessories: [{ text: "48k followers" }], actions: containerActions("artist") },
  { id: "album:al1", name: "Salt & Static", subtitle: "The Low Tide · 2024", icon: { image: COVERS.salt }, section: "Albums", accessories: [{ text: "11 tracks" }], actions: containerActions("album") },
  { id: "album:al2", name: "Tidal", subtitle: "The Low Tide · 2021", icon: { image: COVERS.tide }, section: "Albums", accessories: [{ text: "9 tracks" }], actions: containerActions("album") },
  { id: "playlist:p1", name: "Low Tide Radio", subtitle: "Spotify", icon: { image: COVERS.weekly }, section: "Playlists", accessories: [{ text: "50 tracks" }], actions: containerActions("playlist") },
  { id: "show:s1", name: "Tide Tables", subtitle: "Harbour FM", icon: { image: COVERS.night }, section: "Podcasts", actions: containerActions("show") },
];
const playlistRows = [
  { id: "playlist:p2", name: "Focus", subtitle: "Alex · Deep work, no words", icon: { image: COVERS.focus }, section: "Yours", accessories: [{ text: "42 tracks" }], actions: containerActions("playlist") },
  { id: "playlist:p3", name: "Evening", subtitle: "Alex", icon: { image: COVERS.night }, section: "Yours", accessories: [{ text: "88 tracks" }], actions: containerActions("playlist") },
  { id: "playlist:p4", name: "Road", subtitle: "Alex · Long drives", icon: { image: COVERS.tide }, section: "Yours", accessories: [{ text: "120 tracks" }, { tag: "collaborative", color: "grey" }], actions: containerActions("playlist") },
  { id: "playlist:p5", name: "Discover Weekly", subtitle: "Spotify · Your weekly mixtape of fresh music", icon: { image: COVERS.weekly }, section: "Followed", accessories: [{ text: "30 tracks" }], actions: containerActions("playlist") },
  { id: "playlist:p6", name: "Greenhouse Sessions", subtitle: "Fern Alder", icon: { image: COVERS.glass }, section: "Followed", accessories: [{ text: "24 tracks" }], actions: containerActions("playlist") },
];
/** `h` hours before the clock, as the Web API's `added_at` / `played_at` (ISO). */
const back = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const likedRows = [
  trackRow(HARBOUR, undefined, { accessories: [{ text: ms(HARBOUR.duration) }, { date: back(17.4) }] }),
  trackRow(GLASS, undefined, { accessories: [{ text: ms(GLASS.duration) }, { date: back(4 * 24 + 6) }] }),
  trackRow(NIGHT, undefined, { accessories: [{ text: ms(NIGHT.duration) }, { date: back(13 * 24 + 15) }] }),
  trackRow(TIDE, undefined, { accessories: [{ text: ms(TIDE.duration) }, { date: back(27 * 24 + 19) }] }),
];
const recentRows = [NIGHT, HARBOUR, GLASS].map((t, i) => trackRow(t, undefined, { accessories: [{ text: ms(t.duration) }, { date: back(0.3 + i * 0.1 + i) }] }));
const queueRows = [
  { ...trackRow(HARBOUR, "Now playing"), id: "now:h1", actions: [{ id: "toggle", title: "Play or pause" }, { id: "open", title: "Open in Spotify", shortcut: "cmd+o" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }] },
  ...[PAPER, TIDE, GLASS, NIGHT].map((t, i) => ({ ...trackRow(t, "Up next"), id: `q:${i}:${t.id}`, accessories: [{ text: `#${i + 1}` }, { text: ms(t.duration) }], actions: [{ id: "skip", title: i === 0 ? "Skip to it" : `Skip ${i + 1} ahead` }, { id: "like", title: "Like", shortcut: "cmd+l" }, { id: "open", title: "Open in Spotify", shortcut: "cmd+o" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }] })),
];

const fixture = {
  palettes: {
    "now-playing": { title: "Lyrics", icon: ICON, view: "view", tree: render(now) },
    // The bar popover's tree (420 wide), for looking at in the gallery next to the bar shot of it.
    "now-playing-compact": { title: "Lyrics", icon: ICON, view: "view", tree: render(compact) },
    search: { title: "Search Spotify", icon: ICON, input: true, placeholder: "A track, an artist, an album, a playlist, a podcast", byQuery: { "": [], "low tide": searchRows } },
    playlists: { title: "Playlists", icon: ICON, placeholder: "A playlist by name", items: playlistRows },
    library: { title: "Library", icon: ICON, placeholder: "A track or an artist", filters: [{ id: "liked", title: "Liked Songs" }, { id: "recent", title: "Recently played" }, { id: "top-tracks", title: "Top tracks" }, { id: "top-artists", title: "Top artists" }], items: likedRows, byFilter: { recent: recentRows } },
    queue: { title: "Queue", icon: ICON, live: true, placeholder: "A track in the queue", items: queueRows },
  },
  effects: {
    "now-playing/now:forward": { view: render({ ...now, position: 57.2 }) },
    "now-playing/now:toggle": { view: render({ ...now, playing: false }) },
  },
  shots: {
    // The band under the cover and the amber bar do not survive the 256-colour quantisation (the bar came out red), so the two lyrics shots stay true colour.
    "1-lyrics": { palette: "now-playing", keys: ["wait:400"], raw: true, caption: "The lyrics view: the cover, the progress, the line playing bright among the lines around it" },
    "2-search": { palette: "search", keys: ["type:low tide", "wait:400"], caption: "Search: tracks, artists, albums, playlists and podcasts as sections" },
    "3-playlists": { palette: "playlists", keys: ["down", "wait:300"], caption: "Playlists: yours and the followed ones; cmd+enter lists a playlist's tracks" },
    "4-library": { palette: "library", keys: ["wait:300"], caption: "Library: Liked Songs newest first, the other filters on Tab" },
    "5-queue": { palette: "queue", keys: ["down", "wait:300"], caption: "The queue: what plays now, what comes next, Enter skips to a row" },
  },
};
writeFixture("spotify", fixture);

const bar = {
  key: "spotify/playing",
  title: "Spotify",
  item: {
    icon: "\u{f04c7}",
    title: "With a coat that smells of rain",
    tooltip: "The Low Tide - Harbour Lights (MacBook Air)",
    menu: { view: render(compact) },
  },
  states: [{ id: "track", item: { title: "Harbour Lights · The Low Tide", tooltip: "The Low Tide - Harbour Lights (MacBook Air)" } }],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar: the lyric line playing beside the Spotify mark" },
    "menubar-track": { target: "menubar", state: "track", caption: "A track lrclib has no synced lyrics for: the track and the artist in the line's place" },
    "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the cover and the track, the bar ticking, the lyrics around the line playing, the transport keys, and the queue's next two" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the mark in the icon font, the line as the label" },
  },
};
writeFixture("bar-spotify", bar);
console.log(`lyrics view ${lines.length} lines at ${now.position}s, ${searchRows.length} search rows, ${playlistRows.length} playlists, ${likedRows.length} liked, ${queueRows.length} queue rows`);
