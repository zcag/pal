// media (Now Playing) against canned core/media.* replies.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MediaPlayer, NowPlaying } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";
import { trackText } from "../../../extensions/media/index.ts";

const MAC = process.platform === "darwin";
const spotify: MediaPlayer = { id: "spotify", name: "Spotify", state: "playing", title: "Blue Monday", artist: "New Order", album: "Power, Corruption & Lies", artwork: "https://i.scdn.co/image/ab67", url: "spotify:track:abc", app: "/Applications/Spotify.app", position: 12.5, duration: 448 };
const music: MediaPlayer = { id: "music", name: "Music", state: "paused", title: "Song 2", artist: "Blur", album: null, artwork: null, url: null, app: "/System/Applications/Music.app", position: 0, duration: 120 };
const idle: MediaPlayer = { id: "firefox.instance1", name: "Firefox", state: "stopped", title: null, artist: null, album: null, artwork: null, url: null, app: null, position: null, duration: null };
let np: NowPlaying = { players: [spotify, music, idle], system_wide: true };
const calls: { player: string; command: string }[] = [];
let host: Host;
beforeAll(async () => {
  host = await Host.bundled({
    core: {
      "media.now_playing": () => np,
      "media.control": (p) => { if (p.player === "music" && p.command === "next") throw new Error("Music is not running"); calls.push(p); return null; },
    },
  });
});
afterAll(() => host.kill());

const list = () => host.list("media", "media");
const pick = (id: string, action?: string) => host.pick("media", "media", id, action);

describe("media", () => {
  test("meta: live", () => {
    expect(host.loaded().find((l) => l.extension === "media")!.palettes).toMatchObject([{ name: "media", title: "Now Playing", live: true, input: false }]);
  });

  test("a row per player: track, artist · album, artwork or app icon, state tag, actions", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["spotify", "music", "firefox.instance1"]);
    expect(items[0]).toMatchObject({
      name: "Blue Monday", subtitle: "New Order · Power, Corruption & Lies", icon: { image: "https://i.scdn.co/image/ab67" },
      accessories: [{ text: "Spotify" }, { tag: "playing", color: "green" }],
    });
    expect(items[0].actions!.map((a) => [a.id, a.title])).toEqual([["play_pause", "Pause"], ["next", "Next Track"], ["previous", "Previous Track"], ["copy", "Copy Track"], ["open", "Open in Spotify"]]);
    expect(items[1]).toMatchObject({ name: "Song 2", subtitle: "Blur", icon: { app: "/System/Applications/Music.app" }, accessories: [{ text: "Music" }, { tag: "paused", color: "amber" }] });
    expect(items[1].actions![0].title).toBe("Play");
    // No url: Open goes to the app on macOS only (a .desktop path is not something the opener launches).
    expect(items[1].actions!.some((a) => a.id === "open")).toBe(MAC);
    expect(items[2]).toMatchObject({ name: "Nothing playing", subtitle: "Firefox", accessories: [{ tag: "stopped", color: "grey" }] });
    expect(items[2].actions!.map((a) => a.id)).toEqual(["play_pause", "next", "previous"]);
  });

  test("controls go to the core and keep the palette; a refusal is a toast", async () => {
    expect(await pick("spotify")).toEqual({ keep: true });
    expect(await pick("spotify", "next")).toEqual({ keep: true });
    expect(await pick("firefox.instance1", "previous")).toEqual({ keep: true });
    expect(calls).toEqual([{ player: "spotify", command: "play_pause" }, { player: "spotify", command: "next" }, { player: "firefox.instance1", command: "previous" }]);
    expect(await pick("music", "next")).toEqual({ keep: true, toast: { title: "Could not control the player", message: "Music is not running", style: "failure" } });
  });

  test("copy track and open", async () => {
    expect(trackText(spotify)).toBe("New Order - Blue Monday");
    expect(trackText({ ...spotify, artist: null })).toBe("Blue Monday");
    expect(await pick("spotify", "copy")).toEqual({ copy: "New Order - Blue Monday" });
    expect(await pick("spotify", "open")).toEqual({ open: "spotify:track:abc" });
    expect(await pick("music", "open")).toEqual(MAC ? { open: "/System/Applications/Music.app" } : { keep: true });
  });

  test("nothing running: one inert row, with the install hint when there is no system-wide source", async () => {
    np = { players: [], system_wide: true };
    expect(await list()).toMatchObject([{ id: "empty", name: "Nothing playing", subtitle: "No player is running", actions: [] }]);
    np = { players: [], system_wide: false };
    expect((await list())[0].subtitle).toBe(MAC ? "Spotify and Music are watched; brew install nowplaying-cli to see other players" : "Install playerctl to control MPRIS players");
    expect(await pick("empty")).toEqual({ keep: true });
    np = { players: [spotify, music, idle], system_wide: true };
  });
});
