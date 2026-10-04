// media's `playing`: the one glance card for whatever plays (a glance-only
// item, `strip: false`). Every playing player counts, the published ones
// and the system's, a provider's own item showing or not (the card is no
// strip, nothing doubles); the one that started last leads, with its cover,
// "artist · where", its progress and its own view as the item's menu; a
// second playing one is an "also" line opening its own, a third a "+N
// more"; with nothing playing the last paused one leads, muted; nothing at
// all is no card.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MediaPlayer, NowPlaying, PlayerState } from "../../../sdk/src/index.ts";
import { API, BUNDLED, Host, Root, manifest } from "../harness.ts";

const BOX = `
import { controls } from "${API}";
export default {
  palettes: { now: { title: "Box Now Playing", list: () => [], pick: async (id) => { await controls.publish("player", JSON.parse(id)); return { keep: true }; } } },
  controls: { player: { play_pause: () => {} } },
};
`;

const spotify: MediaPlayer = { id: "spotify", name: "Spotify", state: "playing", title: "Weird Fishes", artist: "Radiohead", album: null, artwork: null, url: null, app: "/Applications/Spotify.app", position: 30, duration: 300 };
const music: MediaPlayer = { id: "music", name: "Music", state: "playing", title: "Song 2", artist: "Blur", album: null, artwork: null, url: null, app: "/System/Applications/Music.app", position: 0, duration: 120 };
let np: NowPlaying = { players: [], system_wide: true };
const TV: PlayerState = { device: "Living Room", app: "YouTube", state: "playing", title: "Mr. Blue Sky", artist: "Pomplamoose", position: 60, duration: 240, palette: "now", item: "playing" };

let root: Root;
let host: Host;
beforeAll(async () => {
  root = new Root({ box: { "index.ts": BOX, "pal.json": manifest("box", { controls: ["player"], palettes: { now: { title: "Box Now Playing" } } }) } });
  host = await Host.start({ roots: [BUNDLED, root.dir], only: ["media", "box"], core: { "media.now_playing": () => np, "media.control": () => null } });
});
afterAll(() => { host.kill(); root.rm(); });

const publish = (s: PlayerState | null) => host.pick("box", "now", JSON.stringify(s));
const card = () => host.render("media", "playing");

describe("the Playing glance card", () => {
  test("nothing playing or paused: no card", async () => {
    expect(await card()).toMatchObject({ hidden: true });
  });

  test("one playing: its track, artist · app, progress, and the media list as its view (a system player)", async () => {
    np = { players: [spotify], system_wide: true };
    const c = await card();
    expect(c).toMatchObject({ title: "Weird Fishes", tooltip: "Radiohead · Spotify", progress: 0.1, menu: { palette: "media" } });
    expect(c.glance).toBeUndefined();
  });

  test("the one that started last leads, its provider's own view the menu even while its own item shows it; the other is an also line", async () => {
    await host.advance(1000);
    host.itemsShown.add("box/playing");
    await publish(TV);
    const c = await card();
    expect(c).toMatchObject({ title: "Mr. Blue Sky", tooltip: "Pomplamoose · YouTube on Living Room", progress: 0.25, menu: { palette: "now", extension: "box" } });
    expect(c.glance).toEqual({ lines: [{ text: "also: Weird Fishes · Spotify", action: "open:spotify" }] });
    host.itemsShown.delete("box/playing");
  });

  test("an also line opens that player's own view; +N more opens the list", async () => {
    await host.advance(1000);
    np = { players: [spotify, music], system_wide: true };
    const c = await card();
    expect(c.title).toBe("Song 2");
    expect(c.glance?.lines).toEqual([{ text: "also: Mr. Blue Sky · YouTube on Living Room", action: "open:ctl:box" }, { text: "+1 more", action: "open:all" }]);
    expect(await host.barAction("media", "playing", "open:ctl:box")).toEqual({ push: { extension: "box", palette: "now" } });
    expect(await host.barAction("media", "playing", "open:spotify")).toEqual({ push: { extension: "media", palette: "media" } });
    expect(await host.barAction("media", "playing", "open:all")).toEqual({ push: { extension: "media", palette: "media" } });
  });

  test("a pause drops a player out; with none playing, the last that played leads, muted, with no also lines", async () => {
    np = { players: [{ ...spotify, state: "paused" }, { ...music, state: "paused" }], system_wide: true };
    await publish({ ...TV, state: "paused" });
    const c = await card();
    expect(c).toMatchObject({ title: "Song 2", color: "muted" });
    expect(c.glance).toBeUndefined();
    np = { players: [], system_wide: true };
    await publish(null);
    expect(await card()).toMatchObject({ hidden: true });
  });
});
