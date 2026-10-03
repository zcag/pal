// Writes app/src/gallery/shots/appletv.json and bar-appletv.json: the store
// screenshots' fixtures, an invented living room drawn through the same
// trees and rows the extension draws (remote.ts, setup.ts, rows.ts), so
// the shots show what the panel draws without an Apple TV on the network.
// `bun run extensions/appletv/fixture.ts`, then `make shots EXT=appletv`.
import { NOW, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { appleApp, sampleApp, wideArt } from "./art.ts";
import { backdrop } from "./image.ts";
import { render as renderNow, type NowState } from "./nowplaying.ts";
import manifest from "./pal.json" with { type: "json" };
import { render as renderRemote, type RemoteState } from "./remote.ts";
import { accountRow, appRow, commandRows } from "./rows.ts";
import { render as renderSetup } from "./setup.ts";
import type { App, Found, NowPlaying } from "./types.ts";

const ICON = manifest.icon;

/** A film poster for the invented "The Long Quiet": dusk over a ridge, the title set in the sky. */
function poster(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f4a"/><stop offset="0.55" stop-color="#7a3d6b"/><stop offset="1" stop-color="#f08a4b"/></linearGradient></defs>
<rect width="120" height="120" fill="url(#s)"/><circle cx="84" cy="70" r="14" fill="#ffd28a" opacity="0.9"/>
<path d="M0 92 L22 70 L38 84 L58 58 L80 86 L98 72 L120 90 L120 120 L0 120Z" fill="#14122b"/>
<path d="M0 104 L30 88 L52 100 L78 84 L120 104 L120 120 L0 120Z" fill="#0b0a1a"/>
<text x="60" y="30" text-anchor="middle" font-family="Georgia, serif" font-size="9" letter-spacing="1.5" fill="#f6e7d8">THE LONG QUIET</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Invented apps (marks.ts SAMPLE_MARKS) beside Apple's own TV, Photos, Settings, Search and Computers.
const APPS: App[] = [
  { id: "com.apple.TVWatchList", name: "TV" }, { id: "io.reelwave.tv", name: "Reelwave" }, { id: "tv.northlight.player", name: "Northlight" },
  { id: "app.tidepool.music", name: "Tidepool" }, { id: "fm.quillcast", name: "Quillcast" }, { id: "film.filmhouse", name: "Filmhouse" },
  { id: "games.arcadia.play", name: "Arcadia" }, { id: "org.fieldguide.tv", name: "Fieldguide" }, { id: "com.kitebox.kids", name: "Kitebox" },
  { id: "io.nightfall.sleep", name: "Nightfall" }, { id: "tv.greenroom.live", name: "Greenroom" }, { id: "com.apple.TVPhotos", name: "Photos" },
  { id: "com.apple.TVSearch", name: "Search" }, { id: "com.apple.TVSettings", name: "Settings" }, { id: "com.apple.TVHomeSharing", name: "Computers" },
];
const art = (a: App) => sampleApp(a.id) ?? appleApp(a.id)!;
const dock = APPS.slice(0, 6).map((a) => ({ ...a, art: art(a), wide: wideArt(a.id, a.name) }));
const tvApp = { ...APPS[0], art: art(APPS[0]) };

const NOW_PLAYING: NowPlaying = { state: "playing", title: "The Long Quiet", genre: "Drama", app: { id: "com.apple.TVWatchList", name: "TV" }, duration: 7_260, position: 2_874, at: NOW, rate: 1, mediaType: "video", itemId: "lq" };
const base: RemoteState = {
  layout: "wide", conn: "up", power: "on", device: { name: "Living Room", modelName: "Apple TV 4K (3rd generation)" }, others: 1,
  now: NOW_PLAYING, position: 2_874, art: poster(), app: tvApp, volume: 0.42, dock, skip: 10, mrp: true,
};
const remote = renderRemote(base);
const pressed = renderRemote({ ...base, flash: "right" });
const compact = renderRemote({ ...base, layout: "compact" });

// ---- Now Playing: an invented episode with chapters, tracks and a queue; an invented song with lyrics -----

const svg = (w: number, h: number, body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`)}`;
/** A still of a lighthouse at night: the show's key art, wide. */
const still = (sky: string, sea: string, beam = 0.5) => svg(160, 90, `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#0d1630"/></linearGradient></defs><rect width="160" height="90" fill="url(#s)"/><path d="M100 30 L160 ${10 + beam * 20} L160 ${40 + beam * 20}Z" fill="#fff3c4" opacity="0.35"/><rect x="94" y="30" width="8" height="38" fill="#e9e4da"/><rect x="92" y="26" width="12" height="6" fill="#ffd36b"/><path d="M0 70 Q40 62 80 70 T160 70 L160 90 L0 90Z" fill="${sea}"/><circle cx="30" cy="18" r="1" fill="#fff"/><circle cx="58" cy="10" r="0.8" fill="#fff"/><circle cx="130" cy="14" r="0.9" fill="#fff"/>`);
const EPISODE: NowPlaying = {
  state: "playing", title: "The Lantern Keeper", series: "Harbor", season: 2, episode: 5, mediaType: "video", genre: "Drama", released: "2025-03-14", rating: "TV-14",
  description: "A storm cuts the island off for three nights, and Mara finds the logbook her father swore he burned. The light has not gone dark since 1931; someone has been keeping it.",
  app: { id: "io.reelwave.tv", name: "Reelwave" }, duration: 3_312, position: 1_486, at: NOW, rate: 1, itemId: "harbor-205",
  rates: [0.5, 0.75, 1, 1.25, 1.5, 2],
  chapters: [{ title: "Previously", start: 0 }, { title: "Cold open", start: 94 }, { title: "Titles", start: 352 }, { title: "The logbook", start: 401 }, { title: "Low tide", start: 1_190 }, { title: "Three nights", start: 1_720 }, { title: "The keeper", start: 2_610 }, { title: "Credits", start: 3_180 }],
  languages: { audio: [{ id: "a-en", name: "English", active: true }, { id: "a-es", name: "Español", active: false }, { id: "a-fr", name: "Français", active: false }], subtitles: [{ id: "s-en", name: "English", active: true }, { id: "s-sdh", name: "English (SDH)", active: false }, { id: "s-es", name: "Español", active: false }] },
};
const reelwave = APPS[1];
const nowBase: NowState = {
  layout: "wide", device: "Living Room", now: EPISODE, position: 1_486, art: still("#1d3a78", "#0a1b3d"), artWide: true,
  tone: backdrop({ r: 46, g: 84, b: 170 }), app: { name: reelwave.name, art: art(reelwave) }, panel: "next", cursor: 0, mrp: true,
  queue: [
    { id: "h206", title: "Fog Signal", series: "Harbor", season: 2, episode: 6, duration: 3_240, art: still("#2b2f6b", "#101a3a", 0.2) },
    { id: "h207", title: "What the Tide Keeps", series: "Harbor", season: 2, episode: 7, duration: 3_396, art: still("#3a2a5e", "#140f2e", 0.8) },
    { id: "h208", title: "Ninety Steps", series: "Harbor", season: 2, episode: 8, duration: 3_150, art: still("#1e4b6e", "#0a2236", 0.4) },
    { id: "h209", title: "Keeper's Log", series: "Harbor", season: 2, episode: 9, duration: 3_480, art: still("#46305e", "#1a1030", 0.6) },
  ],
};
const nowWide = renderNow(nowBase);
const cover = svg(120, 120, `<defs><radialGradient id="g" cx="0.3" cy="0.3" r="0.9"><stop offset="0" stop-color="#ffb46b"/><stop offset="0.6" stop-color="#d4466b"/><stop offset="1" stop-color="#4a1d4f"/></radialGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="84" cy="40" r="18" fill="#ffe2b0" opacity="0.85"/><path d="M0 92 C30 80 60 104 120 86 L120 120 L0 120Z" fill="#2a0f2e" opacity="0.9"/><text x="10" y="112" font-family="Helvetica, Arial" font-size="9" font-weight="700" fill="#fff" letter-spacing="1">LOW LIGHT</text>`);
const tidepool = APPS[3];
const SONG: NowPlaying = { state: "playing", title: "Salt Lines", artist: "Marrow Bay", album: "Low Light", genre: "Indie", released: "2024", mediaType: "music", app: { id: tidepool.id, name: tidepool.name }, duration: 236, position: 61, at: NOW, rate: 1, itemId: "salt", liked: true, shuffle: "off", repeat: "all", hasLyrics: true };
const nowMusic = renderNow({
  ...nowBase, now: SONG, position: 61, art: cover, artWide: false, tone: backdrop({ r: 212, g: 70, b: 107 }), app: { name: tidepool.name, art: art(tidepool) }, panel: "lyrics", queue: undefined,
  lyrics: { lines: [{ at: 12, text: "The harbour hums the way it used to" }, { at: 24, text: "Ropes and gulls and something new" }, { at: 37, text: "I wrote your name in salt lines" }, { at: 49, text: "Down the window, down the glass" }, { at: 58, text: "Every wave that takes it under" }, { at: 66, text: "Brings a little of it back" }, { at: 75, text: "Salt lines, salt lines" }, { at: 83, text: "Hold me to the shore" }] },
});

// ---- Play on Apple TV: an invented video just copied, the browser's tab, earlier links ---------------------

const thumb = (a: string, b: string) => svg(160, 90, `<rect width="160" height="90" fill="${a}"/><circle cx="110" cy="40" r="26" fill="${b}"/><rect x="20" y="58" width="70" height="8" rx="2" fill="#ffffff" opacity="0.85"/><rect x="20" y="70" width="44" height="6" rx="2" fill="#ffffff" opacity="0.5"/>`);
const linkRow = (id: string, name: string, subtitle: string, img: string, section: string, extra: Record<string, unknown> = {}) => ({ id, name, subtitle, icon: { image: img }, section, actions: [{ id: "play", title: "Play on the TV" }, { id: "open", title: "Open in the browser", shortcut: "cmd+o" }, { id: "copy", title: "Copy the link", shortcut: "cmd+c" }], ...extra });
const playRows = [
  linkRow("link:a", "How a lighthouse lens works, in nine minutes", "Just copied · Coastline Labs · YouTube", thumb("#12324f", "#f2c14e"), "Copied", { accessories: [{ tag: "from 2:15", color: "blue" }, { date: NOW - 40_000 }] }),
  linkRow("link:b", "Night ferry to the outer islands, 4K", "Open in Chrome · Slow Water · YouTube", thumb("#1d1a3a", "#7fb0ff"), "Browser"),
  linkRow("link:c", "The quiet hour: a field recording", "Copied · Fieldnotes · YouTube", thumb("#2c3a1f", "#c9e48a"), "Copied", { accessories: [{ date: NOW - 3 * 3_600_000 }] }),
  linkRow("link:e", "Tidal bores of the world", "Played · Coastline Labs · YouTube", thumb("#1a2f2f", "#5fcfcb"), "Played before", { accessories: [{ date: NOW - 3 * 86_400_000 }] }),
];
const withOffer = renderRemote({ ...base, offer: { title: "How a lighthouse lens works, in nine minutes", by: "Coastline Labs", thumb: thumb("#12324f", "#f2c14e"), app: "YouTube" } });

const LIVING: Found = { id: "4C:20:B8:11:6E:02", name: "Living Room", address: "192.168.1.40", model: "AppleTV14,1", modelName: "Apple TV 4K (3rd generation)", os: "26.6", companionPort: 49153, airplayPort: 7000 };
const BEDROOM: Found = { id: "A8:51:AB:3C:09:F1", name: "Bedroom", address: "192.168.1.52", model: "AppleTV11,1", modelName: "Apple TV 4K (2nd generation)", os: "26.6", asleep: true, companionPort: 49153, airplayPort: 7000 };
const setupPin = renderSetup({ phase: "pin", protocol: "companion", device: LIVING, asking: false, tries: 0 }, [LIVING, BEDROOM], []);

const appRows = [...APPS].sort((a, b) => a.name.localeCompare(b.name)).map((a) => appRow(a, art(a), { device: "Living Room", front: a.id === "com.apple.TVWatchList", dock: (() => { const i = dock.findIndex((d) => d.id === a.id); return i < 0 ? undefined : i; })() }));

const fixture = {
  palettes: {
    remote: { title: "Apple TV Remote", icon: ICON, view: "view", tree: remote },
    "remote-offer": { title: "Apple TV Remote", icon: ICON, view: "view", tree: withOffer },
    now: { title: "Now Playing on Apple TV", icon: ICON, view: "view", tree: nowWide },
    "now-music": { title: "Now Playing on Apple TV", icon: ICON, view: "view", tree: nowMusic },
    play: { title: "Play on Apple TV", icon: ICON, input: true, placeholder: "Paste a YouTube or Netflix link, or an Apple TV+ page", byQuery: { "": playRows } },
    apps: { title: "Apple TV Apps", icon: ICON, placeholder: "Search the Apple TV's apps", items: appRows },
    commands: { title: "Apple TV", icon: ICON, items: commandRows("Living Room", ["Bedroom"]) },
    users: { title: "Apple TV Users", icon: ICON, items: [accountRow({ id: "u1", name: "Ada", current: true }, "Living Room"), accountRow({ id: "u2", name: "Grace" }, "Living Room")] },
    setup: { title: "Set Up Apple TV", icon: ICON, view: "view", tree: setupPin },
  },
  effects: {
    "remote/remote:right": { view: pressed },
  },
  shots: {
    "1-now": { palette: "now", keys: ["wait:500"], raw: true, caption: "Now Playing: the episode on its own colour, the chapters on the position bar, speed, subtitles and audio, Up Next with its stills" },
    "2-remote": { palette: "remote", keys: ["wait:400"], raw: true, caption: "The remote: the clickpad and the buttons, what plays, your apps as the TV draws them on the digits, the volume" },
    "3-play": { palette: "play", keys: ["wait:400"], caption: "Play on Apple TV: the link just copied, the browser tab in front and every link copied before; Enter plays it on the TV" },
    "4-offer": { palette: "remote-offer", keys: ["wait:400"], raw: true, caption: "Copy a YouTube link and the remote offers it: l plays it on the TV, at its start time" },
    "5-lyrics": { palette: "now-music", keys: ["wait:500"], raw: true, caption: "A song with its lyrics, the line playing lit; hold an arrow to scrub, one seek when you let go" },
    "6-setup": { palette: "setup", keys: ["wait:400"], raw: true, caption: "Guided setup: type the code the TV shows; a second code adds what is playing" },
  },
};
writeFixture("appletv", fixture);

const bar = {
  key: "appletv/playing",
  title: "Apple TV",
  item: { icon: "\u{f0502}", title: "The Long Quiet", tooltip: "The Long Quiet · TV on Living Room", menu: { view: compact } },
  states: [{ id: "paused", item: { color: "muted", tooltip: "The Long Quiet · TV on Living Room, paused" } }],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar: what plays on the Apple TV" },
    "popover": { target: "menubar", popover: true, raw: true, caption: "A click opens the remote: what plays with its seek bar, the clickpad and the buttons, the dock on the digits" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the TV mark and the title" },
  },
};
writeFixture("bar-appletv", bar);
console.log(`${APPS.length} apps, the remote, the setup in three steps, the bar item`);
