// media (Now Playing) against canned core/media.* replies: the palette
// (rows with the position and the cover), and the `now-playing` bar item
// (the track row with the cover in its menu, the glyph or the cover on the
// strip, the core's `media` trigger declared, no self-poll when the core
// streams).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { MediaPlayer, NowPlaying } from "../../../sdk/src/index.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../harness.ts";
import { positionAt, progress, trackText } from "../../../extensions/media/index.ts";
import { clock } from "../../../extensions/media/view.ts";
import { render } from "../../../extensions/media/view.ts";
import { checkView } from "../../../sdk/src/view.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";

const MAC = process.platform === "darwin";
// The artwork url is one the popover would fetch (a url it cannot draw as is): a closed port here, so the test stays off the network.
const spotify: MediaPlayer = { id: "spotify", name: "Spotify", state: "playing", title: "Blue Monday", artist: "New Order", album: "Power, Corruption & Lies", artwork: "http://127.0.0.1:1/image/ab67", url: "spotify:track:abc", app: "/Applications/Spotify.app", position: 12.5, duration: 448 };
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
let allowed = true;
const coreFor = (asked: () => void) => ({
  "media.now_playing": () => np,
  "media.ask": (p: { player: string }) => { calls.push({ player: p.player, command: "ask" }); return allowed; },
  "media.control": (p: { player: string; command: string }) => { if (p.player === "music" && p.command === "next") throw new Error("Music is not running"); calls.push(p); return null; },
  "media.artwork": (p: { id: string }) => { asked(); const a = artworks[p.id]; if (!a) throw new Error(`no artwork ${p.id}`); return a; },
});
beforeAll(async () => {
  process.env.PAL_MEDIA_TICK_MS = "100";
  host = await Host.bundled({ core: coreFor(() => artworkAsked++) }).finally(() => delete process.env.PAL_MEDIA_TICK_MS);
});
/** The popover's tree of an item, checked as the host does. */
const viewOf = (item: { menu?: unknown }): View => checkView((item.menu as { view: View }).view);
/** Every node of a tree, flattened. */
const nodes = (n: ViewNode): ViewNode[] => [n, ...(n.type === "stack" ? n.children.flatMap(nodes) : [])];
const texts = (v: View) => nodes(v.tree).filter((n) => n.type === "text").map((n) => (n as { value: string }).value);
const keycaps = (v: View) => nodes(v.tree).filter((n) => n.type === "keycap").map((n) => `${(n as { keys: string }).keys}:${(n as { action?: string }).action}`);
afterAll(() => host.kill());

const list = () => host.list("media", "media");
const pick = (id: string, action?: string) => host.pick("media", "media", id, action);

describe("the popover's tree (view.ts)", () => {
  const p = { id: "spotify", name: "Spotify", state: "playing" as const, title: "Blue Monday", artist: "New Order", album: null, artwork: null, url: "spotify:track:abc", app: null, position: 100, duration: 448 };
  test("a paused player: the play hint, an amber badge, a grey bar; a long track widens the time columns; nothing playing is one message", () => {
    const v = checkView(render({ player: { ...p, state: "paused" }, position: 100, canOpen: true }));
    expect(v.actions[0]).toEqual({ id: "play_pause", title: "Play", shortcut: "space" });
    expect(nodes(v.tree).filter((n) => n.type === "badge").map((n) => (n as { text: string }).text)).toEqual(["Spotify", "paused"]);
    expect((nodes(v.tree).find((n) => n.type === "progress") as { color?: string }).color).toBe("grey");
    const long = checkView(render({ player: { ...p, duration: 4000 }, position: 3700, canOpen: false }));
    expect(nodes(long.tree).filter((n) => n.type === "text" && n.width === 56).length).toBe(2);
    expect(long.actions.map((a) => a.id)).toEqual(["play_pause", "next", "previous", "copy"]);
    const none = checkView(render({ canOpen: false }));
    expect(texts(none)[0]).toBe("Nothing playing");
    expect(none.actions.map((a) => a.id)).toEqual(["refresh"]);
  });
  test("positionAt: moved along by the clock while playing, held at the duration, still while paused, none without one", () => {
    expect(positionAt(p, 1000, 3500)).toBe(102.5);
    expect(positionAt({ ...p, position: 447 }, 1000, 3500)).toBe(448);
    expect(positionAt({ ...p, state: "paused" }, 1000, 3500)).toBe(100);
    expect(positionAt({ ...p, position: null }, 1000, 3500)).toBeUndefined();
  });
});

describe("media", () => {
  test("meta: live", () => {
    expect(host.loaded().find((l) => l.extension === "media")!.palettes).toMatchObject([{ name: "media", title: "Now Playing", live: true, input: false }]);
  });

  test("a row per player: track, artist · album, artwork or app icon, position, state tag, actions", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["spotify", "music", "firefox.instance1"]);
    expect(items[0]).toMatchObject({
      name: "Blue Monday", subtitle: "New Order · Power, Corruption & Lies", icon: { image: "http://127.0.0.1:1/image/ab67" },
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
    test("meta and render: the playing track as the title, the popover a view with the titles, the progress row, the transport and copy/open as keycaps; the core's media trigger declared", async () => {
      // `as unknown`: `BarRefresh.on` in sdk/src/protocol.ts does not list the core's `media` trigger yet; the host passes any name through.
      expect(host.loaded().find((l) => l.extension === "media")!.bar as unknown).toEqual([{ id: "now-playing", title: "Now Playing", description: expect.any(String), mocks: expect.any(Object), refresh: { every: 30, on: ["show", "wake", "media"] }, keys: expect.any(Array), rules: [{ id: "paused", when: "not media.playing", description: expect.any(String), hidden: true, color: "muted" }], source: true }]);
      const item = await host.render("media", "now-playing");
      expect(item).toMatchObject({ icon: "\uf001", title: "Blue Monday · New Order", tooltip: "New Order - Blue Monday (Spotify)" });
      const v = viewOf(item);
      expect(v).toMatchObject({ id: "now", keys: "actions", title: "Blue Monday · New Order" });
      expect(v.actions.map((a) => a.id)).toEqual(["play_pause", "next", "previous", "copy", "open"]);
      expect(v.actions[0]).toEqual({ id: "play_pause", title: "Pause", shortcut: "space" });
      expect(texts(v)).toEqual(["Blue Monday", "New Order", "Power, Corruption & Lies", "0:12", "7:28", "pause", "previous", "next", "copy track", "open in Spotify"]);
      expect(keycaps(v)).toEqual(["space:play_pause", "left:previous", "right:next", "c:copy", "o:open"]);
      // The cover url cannot be fetched (a closed port): the app's own icon through the scheme stands in, opening the track on a click like the titles.
      const cover = nodes(v.tree).find((n) => n.type === "tile" || n.type === "image")!;
      expect(cover).toMatchObject({ type: "image", src: `icon://localhost/app?path=${encodeURIComponent("/Applications/Spotify.app")}&size=192`, width: 96, height: 96, mask: "rounded", action: "open" });
      const bar = nodes(v.tree).find((n) => n.type === "progress") as Extract<ViewNode, { type: "progress" }>;
      expect(bar.value).toBeCloseTo(12.5 / 448, 3);
      expect(bar.color).toBe("green");
      expect(nodes(v.tree).filter((n) => n.type === "badge").map((n) => (n as { text: string }).text)).toEqual(["Spotify"]);
    });

    test("the stream's cover in the popover as the picture; the strip keeps the glyph unless bar_artwork is on and the cover is square", async () => {
      np = { players: [chromeTitled], system_wide: true, stream: true };
      const item = await host.render("media", "now-playing");
      // The strip's title is cut at 40 characters, as before.
      expect(item).toMatchObject({ icon: "\uf001", title: "Taylor Tomlinson (Full Episode) · Team C" });
      const v = viewOf(item);
      expect(nodes(v.tree).find((n) => n.type === "image")).toMatchObject({ type: "image", src: PNG, width: 96, height: 96, mask: "rounded", ...(MAC ? { action: "open" } : {}) });
      expect(texts(v).slice(0, 2)).toEqual(["Taylor Tomlinson (Full Episode)", "Team Coco"]);
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
      expect(await host.render("media", "now-playing")).toMatchObject({ title: "Song 2 · Blur", states: { playing: false, state: "paused", app: "Music" } });
      host.changeSettings("media", { settings: { exclude: ["spotify"] } });
      expect(await host.render("media", "now-playing")).toMatchObject({ states: { playing: false } });
      expect((await host.list("media", "media")).map((r) => r.id)).toContain("spotify");
      host.changeSettings("media", { settings: { exclude: ["Spotify"] } });
      // `suggest` is host-wide (every suggesting palette answers): only media's section is this test's.
      expect(((await host.request<{ extension: string }[]>("suggest")) ?? []).filter((s) => s.extension === "media")).toEqual([]);
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
      const v = viewOf(item);
      // Without a track: the app as the title, no copy, the app's own icon through the scheme in place of a cover (the popover runs in the app), open on macOS only.
      expect(v.actions.map((a) => a.id)).toEqual(MAC ? ["play_pause", "next", "previous", "open"] : ["play_pause", "next", "previous"]);
      expect(texts(v).slice(0, 4)).toEqual(["Google Chrome", "Playing, no track named", "42:12", "1:06:03"]);
      expect(nodes(v.tree).find((n) => n.type === "image")).toMatchObject({ src: `icon://localhost/app?path=${encodeURIComponent("/Applications/Google Chrome.app")}&size=192` });
      expect(nodes(v.tree).filter((n) => n.type === "badge")).toEqual([]);
      expect(await host.barAction("media", "now-playing", "copy")).toEqual({ keep: true, hud: "No track title" });
      np = { players: [spotify, music, idle], system_wide: true };
    });

    test("a cover the player names as a file is read into the picture once; a url that is no image, or too large, leaves the app's icon", async () => {
      const dir = mkdtempSync(join(tmpdir(), "pal-media-"));
      const png = join(dir, "cover.png");
      writeFileSync(png, Buffer.from(PNG.split(",")[1], "base64"));
      np = { players: [{ ...spotify, artwork: `file://${png}` }], system_wide: true };
      const v = viewOf(await host.render("media", "now-playing"));
      expect(nodes(v.tree).find((n) => n.type === "image")).toMatchObject({ src: PNG });
      const txt = join(dir, "cover.txt");
      writeFileSync(txt, "not a picture");
      np = { players: [{ ...spotify, artwork: `file://${txt}`, app: null }], system_wide: true };
      const v2 = viewOf(await host.render("media", "now-playing"));
      // A .txt is read as a jpeg by name: the bytes are what they are, the picture simply fails to decode; the size cap is what refuses a huge one.
      const big = join(dir, "big.png");
      writeFileSync(big, Buffer.alloc(2 * 1024 * 1024 + 1));
      np = { players: [{ ...spotify, artwork: `file://${big}`, app: null }], system_wide: true };
      const v3 = viewOf(await host.render("media", "now-playing"));
      expect(nodes(v3.tree).find((n) => n.type === "image")).toBeUndefined();
      expect(nodes(v3.tree).find((n) => n.type === "tile")).toMatchObject({ width: 96, height: 96 });
      expect(v2).toBeTruthy();
      rmSync(dir, { recursive: true, force: true });
      np = { players: [spotify, music, idle], system_wide: true };
    });

    test("the popover's tick: while its level shows, the tree is pushed every tick with the position moved along by the clock, no player asked; hidden stops it", async () => {
      np = { players: [spotify, music, idle], system_wide: true };
      await host.render("media", "now-playing");
      const before = host.viewUpdates("media", { bar: "now-playing" }).length;
      host.viewShown("media", { bar: "now-playing" }, "now", true);
      const u = await host.nextViewUpdate("media", { bar: "now-playing" }, (x) => "actions" in x.spec);
      expect(u).toMatchObject({ extension: "media", bar: "now-playing", spec: { id: "now", keys: "actions" } });
      const pos = texts(u.spec as View)[3];
      expect(pos).toMatch(/^0:1\d$/);
      await Bun.sleep(1100);
      const later = host.viewUpdates("media", { bar: "now-playing" });
      expect(later.length).toBeGreaterThan(before + 5);
      // The position moved on by about a second of clock.
      const last = texts(later[later.length - 1].spec as View)[3];
      expect(last >= pos).toBe(true);
      host.viewHidden("media", { bar: "now-playing" }, "now", true);
      await Bun.sleep(150);
      const n = host.viewUpdates("media", { bar: "now-playing" }).length;
      await Bun.sleep(300);
      expect(host.viewUpdates("media", { bar: "now-playing" }).length).toBe(n);
    });

    test("a paused player renders muted-less with playing false (the manifest's rule hides it); nothing at all is hidden with the empty shape; its actions reach the paused player", async () => {
      np = { players: [music, idle], system_wide: true };
      const paused = await host.render("media", "now-playing");
      expect(paused).toMatchObject({ icon: "\uf001", title: "Song 2 · Blur", tooltip: "Blur - Song 2 (Music), paused", states: { playing: false, state: "paused", app: "Music" }, empty: { icon: "\uf001", tooltip: "Nothing playing" } });
      expect(paused).not.toHaveProperty("color");
      expect(viewOf(paused).actions[0]).toEqual({ id: "play_pause", title: "Play", shortcut: "space" });
      calls.length = 0;
      expect(await host.barAction("media", "now-playing", "play_pause")).toEqual({ keep: true });
      expect(calls).toEqual([{ player: "music", command: "play_pause" }]);
      np = { players: [], system_wide: true };
      const none = await host.render("media", "now-playing");
      expect(none).toMatchObject({ hidden: true, empty: { icon: "\uf001", tooltip: "Nothing playing" }, states: { playing: false, state: "none", app: null } });
      expect(none.title).toBeUndefined();
      expect(texts(viewOf(none.empty!))[0]).toBe("Nothing playing");
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
    expect(await list()).toMatchObject([{ id: "hint:empty", name: "Nothing playing", subtitle: "No player is running", actions: [] }]);
    np = { players: [], system_wide: false };
    // macOS bundles its source (the MediaRemote adapter), so no install hint there: a build without it is what the row says.
    expect((await list())[0].subtitle).toBe(MAC ? "No player is running (this build has no MediaRemote adapter: only Spotify and Music are watched)" : "Install playerctl to control MPRIS players");
    expect(await pick("hint:empty")).toEqual({ keep: true });
    np = { players: [spotify, music, idle], system_wide: true };
  });

  test("a running player macOS was never asked about: a row after the players whose pick lets macOS ask (a listing never does); refused is a toast naming the pane", async () => {
    np = { players: [idle], unasked: [{ id: "spotify", name: "Spotify", app: "/Applications/Spotify.app" }], system_wide: true };
    const rows = await list();
    expect(rows.map((r) => r.id)).toEqual(["firefox.instance1", "hint:ask:spotify"]);
    expect(rows[1]).toMatchObject({ name: "Spotify is running; let pal control it directly", icon: { app: "/Applications/Spotify.app" }, actions: [{ id: "ask", title: "Allow pal to control it" }] });
    calls.length = 0;
    expect(await pick("hint:ask:spotify")).toEqual({ keep: true });
    expect(calls).toEqual([{ player: "spotify", command: "ask" }]);
    allowed = false;
    expect(await pick("hint:ask:spotify")).toMatchObject({ toast: { title: "Not allowed", style: "failure" } });
    allowed = true;
    np = { players: [], unasked: [{ id: "music", name: "Music", app: "/System/Applications/Music.app" }], system_wide: true };
    // No empty row while there is something to ask about.
    expect((await list()).map((r) => r.id)).toEqual(["hint:ask:music"]);
    np = { players: [spotify, music, idle], system_wide: true };
  });
});
