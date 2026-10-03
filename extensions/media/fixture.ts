// Writes app/src/gallery/shots/media.json and bar-media.json: the store
// screenshots' fixtures, made-up players (invented tracks by invented
// artists; the covers are SVGs drawn here, since a real cover is someone's
// artwork) through the extension's own row (index.ts `item`), strip item
// (`barItem`) and popover (view.ts `render`), at the kit's clock.
// `bun run extensions/media/fixture.ts`, then `make shots EXT=media`.
import type { MediaPlayer } from "@zcag/pal";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";

pinClock();
const { barItem, fromPublished, item } = await import("./index.ts");

/** An abstract cover: a dark field with soft discs, as SVG. */
function coverSvg(bg: string, discs: [string, number, number, number][]): string {
  const body = discs.map(([c, x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="0.85"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/>${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const NIGHT = coverSvg("#1d2a44", [["#e0b45a", 40, 24, 16], ["#7ab3e6", 20, 44, 14], ["#c85c8a", 50, 50, 8]]);
const HARBOUR = coverSvg("#16302e", [["#5fc9b0", 22, 22, 15], ["#e8d36b", 44, 40, 16], ["#3a7bd5", 18, 50, 9]]);
const TANGERINE = coverSvg("#3b2a2a", [["#f39a4a", 24, 26, 17], ["#f06a6a", 44, 42, 13], ["#ffd27a", 48, 16, 6]]);

// Spotify two minutes into a seven-minute track, Music paused, Firefox open with nothing loaded.
const spotify: MediaPlayer = { id: "spotify", name: "Spotify", state: "playing", title: "Night Ferry", artist: "Lumen Drift", album: "Low Tide Radio", artwork: NIGHT, url: "spotify:track:4kX0nightferry", app: "/Applications/Spotify.app", position: 132, duration: 439 };
const music: MediaPlayer = { id: "music", name: "Music", state: "paused", title: "Tangerine Hours", artist: "Mira Sol", album: "Slow Summer", artwork: TANGERINE, url: null, app: "/System/Applications/Music.app", position: 71, duration: 214 };
const firefox: MediaPlayer = { id: "firefox.instance1", name: "Firefox", state: "stopped", title: null, artist: null, album: null, artwork: null, url: null, app: null, position: null, duration: null };
// A browser tab playing a long video: the position and the app, no track.
const chrome: MediaPlayer = { id: "system", name: "Google Chrome", state: "playing", title: null, artist: null, album: null, artwork: null, url: null, app: "/Applications/Google Chrome.app", position: 2532.9, duration: 3963.08 };

// A show on the living-room TV, published by a TV extension as its `player` (docs/design/controls.md): first, with its app and device; Enter opens that extension's own view.
const tv = fromPublished({ provider: { key: "appletv" }, device: "Living room", app: "Harbour+", state: "playing", title: "The Lighthouse Keeper", artist: "Tidewater · S1 E3", artwork: HARBOUR, position: 1260, at: NOW, duration: 2940, palette: "now" }, NOW);

const rows = await Promise.all([tv, spotify, music, firefox].map(item));
writeFixture("media", {
  palettes: { media: { title: "Now Playing", icon: { tile: { glyph: "\u{f075a}", bg: "green" } }, live: true, placeholder: "Play, pause, skip", items: rows } },
  shots: {
    "1-players": { palette: "media", keys: [], caption: "One row per player: a show on the living-room TV from its own extension first, Spotify playing with the position, Music paused, a browser with nothing loaded" },
    "2-actions": { palette: "media", keys: ["cmd+k"], caption: "The actions on a row: open the TV's own remote, pause, next, previous, copy the track" },
    "3-root": { keys: ["type:night ferry"], caption: "The playing track found from the root by its title" },
  },
});

// The strip's item as the extension renders it at the kit's clock (the look taken at that moment: the position as given).
const strip = (p: MediaPlayer, cover?: string) => barItem(p, undefined, false, cover, NOW);
const playing = strip(spotify, NIGHT);
const bar = {
  key: "media/now-playing",
  title: "Now Playing",
  item: playing,
  states: [
    { id: "paused", item: { menu: strip({ ...spotify, state: "paused" }, NIGHT).menu } },
    { id: "untitled", item: strip(chrome) },
  ],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar: the playing track and its artist beside the note" },
    "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the cover, the track, a progress bar that ticks, the transport as keys" },
    "popover-untitled": { target: "menubar", popover: true, state: "untitled", caption: "A player that names no track (a browser): the app, the position, the app's icon in place of a cover" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the note in the icon font, the track as the label" },
  },
};
writeFixture("bar-media", bar);
console.log(`media.json: ${rows.length} players; bar-media.json: ${Object.keys(bar.shots).length} shots`);
