// Writes app/src/gallery/shots/appletv.json and bar-appletv.json: the store
// screenshots' fixtures, an invented living room drawn through the same
// trees and rows the extension draws (remote.ts, setup.ts, rows.ts), so
// the shots show what the panel draws without an Apple TV on the network.
// `bun run extensions/appletv/fixture.ts`, then `make shots EXT=appletv`.
import { NOW, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { appleApp, sampleApp } from "./art.ts";
import manifest from "./pal.json" with { type: "json" };
import { render as renderRemote, type RemoteState } from "./remote.ts";
import { accountRow, appRow, commandRows } from "./rows.ts";
import { render as renderSetup } from "./setup.ts";
import type { App, Found, NowPlaying, Paired } from "./types.ts";

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
const dock = APPS.slice(0, 8).map((a) => ({ ...a, art: art(a) }));
const tvApp = { ...APPS[0], art: art(APPS[0]) };

const NOW_PLAYING: NowPlaying = { state: "playing", title: "The Long Quiet", genre: "Drama", app: { id: "com.apple.TVWatchList", name: "TV" }, duration: 7_260, position: 2_874, at: NOW, rate: 1, mediaType: "video", itemId: "lq" };
const base: RemoteState = {
  layout: "wide", conn: "up", power: "on", device: { name: "Living Room", modelName: "Apple TV 4K (3rd generation)" }, others: 1,
  now: NOW_PLAYING, position: 2_874, art: poster(), app: tvApp, volume: 0.42, dock, skip: 10, mrp: true,
};
const remote = renderRemote(base);
const pressed = renderRemote({ ...base, flash: "right" });
const typing = renderRemote({ ...base, now: undefined, position: undefined, art: undefined, app: { ...APPS[1], art: art(APPS[1]) }, keyboard: { focused: true, title: "Search" }, typing: true });
const compact = renderRemote({ ...base, layout: "compact" });

const LIVING: Found = { id: "4C:20:B8:11:6E:02", name: "Living Room", address: "192.168.1.40", model: "AppleTV14,1", modelName: "Apple TV 4K (3rd generation)", os: "26.6", companionPort: 49153, airplayPort: 7000 };
const BEDROOM: Found = { id: "A8:51:AB:3C:09:F1", name: "Bedroom", address: "192.168.1.52", model: "AppleTV11,1", modelName: "Apple TV 4K (2nd generation)", os: "26.6", asleep: true, companionPort: 49153, airplayPort: 7000 };
const pairedLiving: Paired = { ...LIVING, pairedAt: NOW };
const setupPin = renderSetup({ phase: "pin", protocol: "companion", device: LIVING, asking: false, tries: 0 }, [LIVING, BEDROOM], []);
const setupFind = renderSetup({ phase: "find", scanning: false }, [LIVING, BEDROOM], []);
const setupReady = renderSetup({ phase: "ready", device: pairedLiving, checks: [
  { ok: true, what: "Remote", detail: "Buttons, swipes, sleep and wake" },
  { ok: true, what: "Apps", detail: `${APPS.length} apps, a digit each for the dock` },
  { ok: true, what: "Typing", detail: "Into any text field the TV shows (t on the remote)" },
  { ok: true, what: "Volume", detail: "42% now; the slider sets it" },
  { ok: true, what: "Now playing", detail: "The Long Quiet in TV" },
  { ok: true, what: "Users", detail: "2 people: u switches" },
] }, [LIVING, BEDROOM], [pairedLiving]);

const appRows = [...APPS].sort((a, b) => a.name.localeCompare(b.name)).map((a) => appRow(a, art(a), { device: "Living Room", front: a.id === "com.apple.TVWatchList", dock: (() => { const i = dock.findIndex((d) => d.id === a.id); return i < 0 ? undefined : i; })() }));

const fixture = {
  palettes: {
    remote: { title: "Apple TV Remote", icon: ICON, view: "view", tree: remote },
    typing: { title: "Apple TV Remote", icon: ICON, view: "view", tree: typing },
    apps: { title: "Apple TV Apps", icon: ICON, placeholder: "Search the Apple TV's apps", items: appRows },
    commands: { title: "Apple TV", icon: ICON, items: commandRows("Living Room", ["Bedroom"]) },
    users: { title: "Apple TV Users", icon: ICON, items: [accountRow({ id: "u1", name: "Ada", current: true }, "Living Room"), accountRow({ id: "u2", name: "Grace" }, "Living Room")] },
    setup: { title: "Set Up Apple TV", icon: ICON, view: "view", tree: setupPin },
    "setup-find": { title: "Set Up Apple TV", icon: ICON, view: "view", tree: setupFind },
    "setup-ready": { title: "Set Up Apple TV", icon: ICON, view: "view", tree: setupReady },
  },
  effects: {
    "remote/remote:right": { view: pressed },
  },
  shots: {
    "1-remote": { palette: "remote", keys: ["wait:400"], raw: true, caption: "The remote: the clickpad and the buttons, what plays with its cover and a seek bar, the dock of apps on the digits, the volume" },
    "2-typing": { palette: "typing", keys: ["wait:300", "type:harbor", "wait:300"], raw: true, caption: "The TV's search wants text: type it here, Enter sends it" },
    "3-apps": { palette: "apps", keys: ["wait:300", "down*2", "wait:300"], caption: "Every app on the Apple TV with its icon; Enter opens it, cmd+D puts it in the dock" },
    "4-setup": { palette: "setup-find", keys: ["wait:400"], raw: true, caption: "Setup finds the Apple TVs on the network; a digit pairs one" },
    "5-setup-code": { palette: "setup", keys: ["wait:400"], raw: true, caption: "Type the code the TV shows; a second code adds what is playing" },
    "6-ready": { palette: "setup-ready", keys: ["wait:500"], raw: true, caption: "Paired: a check of what works, read from the TV itself" },
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
