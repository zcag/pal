// media (Now Playing) against canned core/media.* replies: the palette
// (rows with the position and the cover), and the `now-playing` bar item
// (the track row with the cover in its menu, the glyph or the cover on the
// strip, the core's `media` trigger declared, no self-poll when the core
// streams).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MediaPlayer, NowPlaying } from "../../../sdk/src/index.ts";
import { Host } from "../harness.ts";
import { clock, progress, trackText } from "../../../extensions/media/index.ts";

const MAC = process.platform === "darwin";
const spotify: MediaPlayer = { id: "spotify", name: "Spotify", state: "playing", title: "Blue Monday", artist: "New Order", album: "Power, Corruption & Lies", artwork: "https://i.scdn.co/image/ab67", url: "spotify:track:abc", app: "/Applications/Spotify.app", position: 12.5, duration: 448 };
const music: MediaPlayer = { id: "music", name: "Music", state: "paused", title: "Song 2", artist: "Blur", album: null, artwork: null, url: null, app: "/System/Applications/Music.app", position: 0, duration: 120 };
const idle: MediaPlayer = { id: "firefox.instance1", name: "Firefox", state: "stopped", title: null, artist: null, album: null, artwork: null, url: null, app: null, position: null, duration: null };
/** The macOS system-wide row for Chrome playing YouTube: the MediaRemote adapter gives the app, the state and the position, no track (captured on macOS 26.4). */
const chrome: MediaPlayer = { id: "system", name: "Google Chrome", state: "playing", title: null, artist: null, album: null, artwork: null, url: null, app: "/Applications/Google Chrome.app", position: 2532.9, duration: 3963.08 };
/** The same tab once YouTube's media session reached Chrome: a title, an artist and a cover the core's stream holds under `artwork_id`. */
const chromeTitled = { ...chrome, title: "Taylor Tomlinson (Full Episode)", artist: "Team Coco", position: 2891.9, artwork_id: "a1b2c3d4e5f60718" } as MediaPlayer;
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** What `core/media.artwork` answers per id: the square cover, a wide one, or nothing (the track moved on). */
const artworks: Record<string, { data: string; width: number; height: number }> = {
  a1b2c3d4e5f60718: { data: PNG, width: 600, height: 600 },
  wide000000000000: { data: PNG, width: 1280, height: 720 },
};
let np: NowPlaying & { stream?: boolean } = { players: [spotify, music, idle], system_wide: true };
const calls: { player: string; command: string }[] = [];
let artworkAsked = 0;
let host: Host;
const coreFor = (asked: () => void) => ({
  "media.now_playing": () => np,
  "media.control": (p: { player: string; command: string }) => { if (p.player === "music" && p.command === "next") throw new Error("Music is not running"); calls.push(p); return null; },
  "media.artwork": (p: { id: string }) => { asked(); const a = artworks[p.id]; if (!a) throw new Error(`no artwork ${p.id}`); return a; },
});
beforeAll(async () => {
  host = await Host.bundled({ core: coreFor(() => artworkAsked++) });
});
afterAll(() => host.kill());

const list = () => host.list("media", "media");
const pick = (id: string, action?: string) => host.pick("media", "media", id, action);

describe("media", () => {
  test("meta: live", () => {
    expect(host.loaded().find((l) => l.extension === "media")!.palettes).toMatchObject([{ name: "media", title: "Now Playing", live: true, input: false }]);
  });

  test("a row per player: track, artist · album, artwork or app icon, position, state tag, actions", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["spotify", "music", "firefox.instance1"]);
    expect(items[0]).toMatchObject({
      name: "Blue Monday", subtitle: "New Order · Power, Corruption & Lies", icon: { image: "https://i.scdn.co/image/ab67" },
      accessories: [{ text: "0:12 / 7:28" }, { text: "Spotify" }, { tag: "playing", color: "green" }],
    });
    expect(items[0].actions!.map((a) => [a.id, a.title])).toEqual([["play_pause", "Pause"], ["next", "Next track"], ["previous", "Previous track"], ["copy", "Copy track"], ["open", "Open in Spotify"]]);
    expect(items[1]).toMatchObject({ name: "Song 2", subtitle: "Blur", icon: { app: "/System/Applications/Music.app" }, accessories: [{ text: "0:00 / 2:00" }, { text: "Music" }, { tag: "paused", color: "amber" }] });
    expect(items[1].actions![0].title).toBe("Play");
    // No url: Open goes to the app on macOS only (a .desktop path is not something the opener launches).
    expect(items[1].actions!.some((a) => a.id === "open")).toBe(MAC);
    expect(items[2]).toMatchObject({ name: "Nothing playing", subtitle: "Firefox", accessories: [{ tag: "stopped", color: "grey" }] });
    expect(items[2].actions!.map((a) => a.id)).toEqual(["play_pause", "next", "previous"]);
  });

  test("a player that reports no track (Chrome on macOS): the app as the title, the position as the subtitle, no copy", async () => {
    np = { players: [chrome], system_wide: true };
    const [row] = await list();
    expect(row).toMatchObject({ id: "system", name: "Google Chrome", subtitle: "42:12 / 1:06:03", icon: { app: "/Applications/Google Chrome.app" }, accessories: [{ tag: "playing", color: "green" }] });
    expect(row.actions!.map((a) => a.id)).toEqual(MAC ? ["play_pause", "next", "previous", "open"] : ["play_pause", "next", "previous"]);
    np = { players: [{ ...chrome, state: "paused", position: null, duration: null }], system_wide: true };
    expect((await list())[0]).toMatchObject({ name: "Google Chrome", subtitle: "Paused", accessories: [{ tag: "paused", color: "amber" }] });
    expect(clock(65)).toBe("1:05");
    expect(clock(3600)).toBe("1:00:00");
    expect(progress({ ...chrome, duration: null })).toBe("42:12");
    expect(progress({ ...chrome, position: null })).toBeUndefined();
    np = { players: [spotify, music, idle], system_wide: true };
  });

  test("the stream's cover: fetched once per id as the row's picture, the app's icon once the core no longer has it", async () => {
    np = { players: [chromeTitled], system_wide: true, stream: true };
    artworkAsked = 0;
    const [row] = await list();
    expect(row).toMatchObject({ name: "Taylor Tomlinson (Full Episode)", subtitle: "Team Coco", icon: { image: PNG }, accessories: [{ text: "48:11 / 1:06:03" }, { text: "Google Chrome" }, { tag: "playing", color: "green" }] });
    expect(artworkAsked).toBe(1);
    await list();
    expect(artworkAsked).toBe(1);
    // A new id is a new fetch; one the core has dropped falls back to the app.
    np = { players: [{ ...chromeTitled, artwork_id: "gone000000000000" } as MediaPlayer], system_wide: true, stream: true };
    expect((await list())[0].icon).toEqual({ app: "/Applications/Google Chrome.app" });
    expect(artworkAsked).toBe(2);
    np = { players: [spotify, music, idle], system_wide: true };
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

  describe("bar: now-playing", () => {
    test("meta and render: the playing track as the title, the track row then the transport and copy/open as the menu; the core's media trigger declared", async () => {
      // `as unknown`: `BarRefresh.on` in sdk/src/protocol.ts does not list the core's `media` trigger yet; the host passes any name through.
      expect(host.loaded().find((l) => l.extension === "media")!.bar as unknown).toEqual([{ id: "now-playing", title: "Now Playing", description: expect.any(String), refresh: { every: 30, on: ["show", "wake", "media"] }, source: true }]);
      const item = await host.render("media", "now-playing");
      expect(item).toMatchObject({ icon: "\uf001", title: "Blue Monday · New Order", tooltip: "New Order - Blue Monday (Spotify)" });
      expect((item.menu as any[]).map((n) => n.id ?? n.type)).toEqual(["track", "separator", "play_pause", "next", "previous", "separator", "copy", "open"]);
      // The track row: the cover (Spotify's url here) at row size, opening the track.
      expect((item.menu as any[])[0]).toEqual({ type: "item", id: "track", title: "Blue Monday", subtitle: "New Order · Power, Corruption & Lies", icon: { image: "https://i.scdn.co/image/ab67" }, action: "open" });
      // Every row draws a glyph, never the title's initial.
      for (const n of item.menu as any[]) if (n.type === "item") expect(n.icon).toBeTruthy();
    });

    test("the stream's cover in the popover's track row; the strip keeps the glyph unless bar_artwork is on and the cover is square", async () => {
      np = { players: [chromeTitled], system_wide: true, stream: true };
      const item = await host.render("media", "now-playing");
      // The strip's title is cut at 40 characters, as before.
      expect(item).toMatchObject({ icon: "\uf001", title: "Taylor Tomlinson (Full Episode) · Team C" });
      expect((item.menu as any[])[0]).toEqual({ type: "item", id: "track", title: "Taylor Tomlinson (Full Episode)", subtitle: "Team Coco", icon: { image: PNG }, action: MAC ? "open" : "copy" });
      // The setting on: the square cover is the strip's icon, a wide one is not.
      // The notification lands before the next request: the host reads its stdin in order.
      host.changeSettings("media", { settings: { bar_artwork: true } });
      expect((await host.render("media", "now-playing")).icon).toEqual({ image: PNG });
      np = { players: [{ ...chromeTitled, artwork_id: "wide000000000000" } as MediaPlayer], system_wide: true, stream: true };
      expect((await host.render("media", "now-playing")).icon).toBe("\uf001");
      host.changeSettings("media", { settings: { bar_artwork: false } });
      np = { players: [spotify, music, idle], system_wide: true };
    });

    test("exclude: a listed player is left to another extension on the bar and in the Now row, by name, id or app; the palette still lists it", async () => {
      np = { players: [spotify, music, idle], system_wide: true };
      host.changeSettings("media", { settings: { exclude: ["Spotify"] } });
      expect(await host.render("media", "now-playing")).toMatchObject({ hidden: true });
      host.changeSettings("media", { settings: { exclude: ["spotify"] } });
      expect(await host.render("media", "now-playing")).toMatchObject({ hidden: true });
      expect((await host.list("media", "media")).map((r) => r.id)).toContain("spotify");
      host.changeSettings("media", { settings: { exclude: ["Spotify"] } });
      expect(await host.request<unknown>("suggest", { extension: "media", palette: "media" })).toEqual([]);
      host.changeSettings("media", { settings: { exclude: ["Music"] } });
      expect((await host.render("media", "now-playing")).title).toContain("Blue Monday");
      host.changeSettings("media", { settings: { exclude: [] } });
    });

    test("actions go to the playing player and keep the popover; copy and open", async () => {
      calls.length = 0;
      expect(await host.barAction("media", "now-playing", "play_pause")).toEqual({ keep: true });
      expect(await host.barAction("media", "now-playing", "next")).toEqual({ keep: true });
      expect(calls).toEqual([{ player: "spotify", command: "play_pause" }, { player: "spotify", command: "next" }]);
      expect(await host.barAction("media", "now-playing", "copy")).toEqual({ copy: "New Order - Blue Monday" });
      expect(await host.barAction("media", "now-playing", "open")).toEqual({ open: "spotify:track:abc" });
    });

    test("a playing player without a track shows its app; copy has nothing to give", async () => {
      np = { players: [chrome], system_wide: true };
      const item = await host.render("media", "now-playing");
      expect(item).toMatchObject({ icon: "\uf001", title: "Google Chrome", tooltip: "Playing in Google Chrome" });
      expect((item.menu as any[]).map((n) => n.id ?? n.type)).toEqual(MAC ? ["track", "separator", "play_pause", "next", "previous", "separator", "open"] : ["track", "separator", "play_pause", "next", "previous", "separator"]);
      // The track row without a track: the app, the position, the app's icon; nothing to copy so it opens the app on macOS and is inert elsewhere.
      expect((item.menu as any[])[0]).toEqual({ type: "item", id: "track", title: "Google Chrome", subtitle: "42:12 / 1:06:03", icon: { app: "/Applications/Google Chrome.app" }, ...(MAC ? { action: "open" } : { disabled: true }) });
      expect(await host.barAction("media", "now-playing", "copy")).toEqual({ keep: true, hud: "No track title" });
      np = { players: [spotify, music, idle], system_wide: true };
    });

    test("only a playing player shows: paused or nothing is hidden; an action then says so", async () => {
      np = { players: [music, idle], system_wide: true };
      expect(await host.render("media", "now-playing")).toEqual({ hidden: true });
      expect(await host.barAction("media", "now-playing", "next")).toEqual({ keep: true, hud: "Nothing playing" });
      np = { players: [spotify, music, idle], system_wide: true };
    });
  });

  describe("bar: without the core's stream the item polls itself; with it, it does not", () => {
    let polled: Host;
    let asked = 0;
    beforeAll(async () => {
      process.env.PAL_MEDIA_POLL_MS = "100";
      polled = await Host.bundled({ core: { ...coreFor(() => {}), "media.now_playing": () => { asked++; return np; } } }).finally(() => delete process.env.PAL_MEDIA_POLL_MS);
    });
    afterAll(() => polled.kill());

    test("stream: true means no poll (the core's media trigger renders the item); a later reply without it starts one", async () => {
      np = { players: [spotify], system_wide: true, stream: true };
      expect((await polled.render("media", "now-playing")).title).toBe("Blue Monday · New Order");
      const n = asked;
      await Bun.sleep(350);
      expect(asked).toBe(n);
      expect(polled.updates("media", "now-playing")).toEqual([]);
      np = { players: [spotify], system_wide: true, stream: false };
      await polled.render("media", "now-playing");
      await Bun.sleep(350);
      expect(asked).toBeGreaterThan(n + 2);
      np = { players: [spotify, music, idle], system_wide: true };
    });
  });

  test("nothing running: one inert row, with the install hint when there is no system-wide source", async () => {
    np = { players: [], system_wide: true };
    expect(await list()).toMatchObject([{ id: "empty", name: "Nothing playing", subtitle: "No player is running", actions: [] }]);
    np = { players: [], system_wide: false };
    // macOS bundles its source (the MediaRemote adapter), so no install hint there: a build without it is what the row says.
    expect((await list())[0].subtitle).toBe(MAC ? "No player is running (this build has no MediaRemote adapter: only Spotify and Music are watched)" : "Install playerctl to control MPRIS players");
    expect(await pick("empty")).toEqual({ keep: true });
    np = { players: [spotify, music, idle], system_wide: true };
  });
});
