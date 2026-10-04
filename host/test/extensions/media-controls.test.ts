// media's Now Playing over the players other extensions publish
// (docs/design/controls.md, "Now Playing"): a stand-in provider publishes
// a `player`, the harness stands in for the core's table (and for
// `item_shown`, which the core reads off its bar). The published row comes
// first and opens the provider's own palette, its transport lands in the
// provider's context, a `same` bundle id drops the system's row, and the bar
// item leaves a player alone while the provider's own item shows it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MediaPlayer, NowPlaying, PlayerState } from "../../../sdk/src/index.ts";
import { fromPublished, merged } from "../../../extensions/media/index.ts";
import { API, Host, ROOTS, Root, manifest, stored } from "../harness.ts";

/** A device that plays: its pick publishes the state the id spells (null withdraws), its transport is logged in its own storage. */
const BOX = `
import { controls, storage } from "${API}";
const log = async (op) => storage.set("ops", [...((await storage.get("ops")) ?? []), op]);
export default {
  palettes: {
    now: { title: "Box Now Playing", list: () => [], pick: async (id) => { await controls.publish("player", JSON.parse(id)); return { keep: true }; } },
  },
  controls: { player: { play_pause: () => log("play_pause"), next: () => log("next"), previous: () => log("previous"), seek: (s) => log("seek " + s) } },
};
`;

const spotify: MediaPlayer = { id: "spotify", name: "Spotify", state: "paused", title: "Blue Monday", artist: "New Order", album: null, artwork: null, url: "spotify:track:abc", app: "/Applications/Spotify.app", position: 12.5, duration: 448 };
const music: MediaPlayer = { id: "music", name: "Music", state: "paused", title: "Song 2", artist: "Blur", album: null, artwork: null, url: null, app: "/System/Applications/Music.app", position: 0, duration: 120 };
let np: NowPlaying = { players: [spotify, music], system_wide: true };

const PLAYING: PlayerState = { device: "Living room", app: "YouTube", state: "playing", title: "A Talk", artist: "A Channel", position: 10, duration: 600, palette: "now", item: "playing" };

let root: Root;
let host: Host;
beforeAll(async () => {
  root = new Root({ box: { "index.ts": BOX, "pal.json": manifest("box", { controls: ["player"], palettes: { now: { title: "Box Now Playing" } } }) } });
  host = await Host.start({ roots: [...ROOTS, root.dir], only: ["media", "box"], core: { "media.now_playing": () => np, "media.control": () => null } });
});
afterAll(() => { host.kill(); root.rm(); });

const publish = (s: PlayerState | null) => host.pick("box", "now", JSON.stringify(s));
const list = () => host.list("media", "media");
const render = () => host.render("media", "now-playing");

describe("published players in Now Playing", () => {
  test("the published row comes first: the track, the app and device, the position moved along from when it was read; Enter opens the provider's own palette", async () => {
    await publish({ ...PLAYING, at: host.now() - 5000 });
    const rows = await list();
    expect(rows.map((r) => r.id)).toEqual(["ctl:box", "spotify", "music"]);
    expect(rows[0]).toMatchObject({ name: "A Talk", subtitle: "A Channel" });
    expect(rows[0].accessories?.[0]).toEqual({ text: "YouTube · Living room" });
    expect((rows[0].accessories?.[1] as { text: string }).text).toMatch(/^0:1[5-6] \/ 10:00$/);
    expect(rows[0].actions?.[0]).toEqual({ id: "open", title: "Open" });
    expect(await host.pick("media", "media", "ctl:box", "open")).toEqual({ push: { extension: "box", palette: "now" } });
  });

  test("its transport lands on the provider, in the provider's own context", async () => {
    await host.pick("media", "media", "ctl:box", "play_pause");
    await host.pick("media", "media", "ctl:box", "next");
    expect(stored.get("box\0ops")).toEqual(["play_pause", "next"]);
  });

  test("a `same` bundle id drops the system's row for that playback; a stopped or withdrawn player is not listed", async () => {
    await publish({ ...PLAYING, same: ["com.spotify.client"] });
    expect((await list()).map((r) => r.id)).toEqual(["ctl:box", "music"]);
    await publish({ ...PLAYING, state: "stopped" });
    expect((await list()).map((r) => r.id)).toEqual(["spotify", "music"]);
    await publish(null);
    expect((await list()).map((r) => r.id)).toEqual(["spotify", "music"]);
  });

  test("the bar shows a published player only while the provider's own item does not: never twice, never replaced", async () => {
    await publish(PLAYING);
    expect(await render()).toMatchObject({ title: "A Talk · A Channel", states: { playing: true, app: "YouTube · Living room" } });
    host.itemsShown.add("box/playing");
    // Its own item shows it now: media's falls back to what is left (paused players, hidden by the manifest's rule).
    expect(await render()).toMatchObject({ title: "Blue Monday · New Order", states: { playing: false, app: "Spotify" } });
    host.itemsShown.delete("box/playing");
    await publish(null);
  });

  test("a published player's change makes the bar look again", async () => {
    await render();
    const from = host.coreCalls.length;
    await publish({ ...PLAYING, title: "Another Talk" });
    await host.until(() => host.coreCalls.slice(from).some((c) => c.method === "bar.refresh" && (c.params as { extension: string }).extension === "media"));
    await publish(null);
  });
});

describe("the root's Now section", () => {
  const nowRows = async () => ((await host.request<{ extension: string; items: any[] }[]>("suggest")) ?? []).find((x) => x.extension === "media")?.items ?? [];

  test("every playing player has a row, the published one first even while its own bar item shows it: a device with no suggestion of its own (the Samsung, Jellyfin) is there through media", async () => {
    np = { players: [{ ...music, state: "playing" }, spotify], system_wide: true };
    await publish(PLAYING);
    host.itemsShown.add("box/playing");
    const rows = await nowRows();
    expect(rows.map((r) => r.id)).toEqual(["ctl:box", "music"]);
    expect(rows[0]).toMatchObject({ name: "A Talk", subtitle: "A Channel · YouTube on Living room" });
    expect(rows[0].section).toBeUndefined();
    expect(rows[0].actions.slice(0, 2)).toEqual([{ id: "open", title: "Open" }, { id: "play_pause", title: "Pause", shortcut: "cmd+enter" }]);
    expect(rows[1]).toMatchObject({ name: "Song 2", subtitle: "Blur · Music" });
    host.itemsShown.delete("box/playing");
  });

  test("a player whose provider has its own Now row (`now`, Spotify's) and a paused one have none", async () => {
    await publish({ ...PLAYING, now: true });
    expect((await nowRows()).map((r) => r.id)).toEqual(["music"]);
    np = { players: [spotify, music], system_wide: true };
    await publish({ ...PLAYING, state: "paused" });
    expect(await nowRows()).toEqual([]);
    await publish(null);
  });
});

describe("merging (pure)", () => {
  test("the system-wide row naming the app is dropped too; an unknown bundle id drops nothing", () => {
    const system: MediaPlayer = { ...spotify, id: "system", name: "Spotify" };
    const pub = fromPublished({ ...PLAYING, same: ["com.spotify.client"], provider: { key: "spotify" } }, 0);
    expect(merged({ players: [system, music], system_wide: true }, [pub]).players.map((p) => p.id)).toEqual(["ctl:spotify", "music"]);
    const other = fromPublished({ ...PLAYING, same: ["com.example.player"], provider: { key: "x" } }, 0);
    expect(merged({ players: [system, music], system_wide: true }, [other]).players.map((p) => p.id)).toEqual(["ctl:x", "system", "music"]);
  });

  test("a paused player's position stays where it was read; a playing one's moves along, held at the duration", () => {
    expect(fromPublished({ ...PLAYING, state: "paused", at: 0, provider: { key: "b" } }, 9000).position).toBe(10);
    expect(fromPublished({ ...PLAYING, at: 0, provider: { key: "b" } }, 9000).position).toBe(19);
    expect(fromPublished({ ...PLAYING, at: 0, provider: { key: "b" } }, 10_000_000).position).toBe(600);
  });
});
