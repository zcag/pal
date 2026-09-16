// Writes app/src/gallery/shots/bar-media.json: the bar item's fixture for
// the store screenshots, its popover tree from view.ts over a made-up
// track (the cover is an SVG drawn here, since the gallery has no
// player). `bun run extensions/media/fixture.ts`, then
// `node app/scripts/shots.mjs bar media`.
import { writeFileSync } from "node:fs";
import type { MediaPlayer } from "@zcag/pal";
import { render, type MediaState } from "./view.ts";

/** An abstract cover: a dark field with soft discs, as SVG. */
function coverSvg(bg: string, discs: [string, number, number, number][]): string {
  const body = discs.map(([c, x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" opacity="0.85"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${bg}"/>${body}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
const COVER = coverSvg("#1d2a44", [["#e0b45a", 40, 24, 16], ["#7ab3e6", 20, 44, 14], ["#c85c8a", 50, 50, 8]]);

const spotify: MediaPlayer = { id: "spotify", name: "Spotify", state: "playing", title: "Motion Picture Soundtrack", artist: "Radiohead", album: "Kid A", artwork: null, url: "spotify:track:abc", app: "/Applications/Spotify.app", position: 132, duration: 439 };
const playing: MediaState = { player: spotify, cover: COVER, position: 132, canOpen: true };
const paused: MediaState = { player: { ...spotify, state: "paused" }, cover: COVER, position: 132, canOpen: true };
const chrome: MediaState = { player: { id: "system", name: "Google Chrome", state: "playing", title: null, artist: null, album: null, artwork: null, url: null, app: "/Applications/Google Chrome.app", position: 2532.9, duration: 3963.08 }, position: 2532.9, canOpen: true };

const bar = {
  key: "media/now-playing",
  title: "Now Playing",
  item: {
    icon: "",
    title: "Motion Picture Soundtrack · Radiohead",
    tooltip: "Radiohead - Motion Picture Soundtrack (Spotify)",
    menu: { view: render(playing) },
  },
  states: [
    { id: "short", item: { title: "Weird Fishes · Radiohead", tooltip: "Radiohead - Weird Fishes / Arpeggi (Spotify)" } },
    { id: "paused", item: { menu: { view: render(paused) } } },
    { id: "untitled", item: { title: "Google Chrome", tooltip: "Playing in Google Chrome", menu: { view: render(chrome) } } },
  ],
  shots: {
    "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: the playing track and its artist beside the note" },
    "bar-menubar-light": { target: "menubar", theme: "light", caption: "The same item on a light menu bar" },
    "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the popover: the cover, the track, a progress bar that ticks, the transport as keys" },
    "bar-menubar-popover-dark": { target: "menubar", theme: "dark", popover: true, caption: "The same popover in the dark theme" },
    "bar-menubar-popover-untitled": { target: "menubar", theme: "light", popover: true, state: "untitled", caption: "A player that names no track (a browser): the app, the position, the app's icon in place of a cover" },
    "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the note in the icon font, the track as the label" },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/bar-media.json", import.meta.url), JSON.stringify(bar) + "\n");
console.log(`bar-media.json: ${Object.keys(bar.shots).length} shots`);
