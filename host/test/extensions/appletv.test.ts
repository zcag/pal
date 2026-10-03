// Apple TV over the host against the stand-in TV (extensions/appletv/
// fake.ts: the TV's state is a JSON file this test writes, every command a
// line in a log it reads back): the palettes and the bar item before
// anything is paired, the guided setup (discovery, the remote's code, a
// wrong code and the new one it brings, the now-playing code, the check
// of what works), the remote's keys and what each sends, typing into the
// field the TV shows, a change on the TV pushed into the open remote, the
// bar item playing, paused and asleep, the apps and the dock, the root
// commands, and the links.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeTv } from "../../../extensions/appletv/fake.ts";
import { clickpad, positionAt, render as renderRemote, titles, type RemoteState } from "../../../extensions/appletv/remote.ts";
import { render as renderSetup } from "../../../extensions/appletv/setup.ts";
import { letterTile, placeholderArt, wideArt } from "../../../extensions/appletv/art.ts";
import { findLink, linkKey, parseLink, seconds, target } from "../../../extensions/appletv/links.ts";

import { actions as nowActions, chapterAt, panels, render as renderNow, type NowState } from "../../../extensions/appletv/nowplaying.ts";
import { backdrop, dominant, pngData, rounded } from "../../../extensions/appletv/image.ts";
import { checkView } from "../../../sdk/src/view.ts";
import type { BarItem, View } from "../../../sdk/src/protocol.ts";
import { Host, bundledIcon, logLines, stored } from "../harness.ts";

const E = "appletv";
const LIVING = { id: "32:C4:F2:8D:8E:A9", name: "Living Room", address: "192.168.1.113", model: "AppleTV11,1", modelName: "Apple TV 4K (2nd generation)", os: "26.6", companionPort: 49153, airplayPort: 7000 };
const BEDROOM = { id: "AA:BB:CC:00:11:22", name: "Bedroom", address: "192.168.1.120", model: "AppleTV14,1", modelName: "Apple TV 4K (3rd generation)", os: "26.6", companionPort: 49153, airplayPort: 7000 };
const APPS = [
  { id: "com.apple.TVWatchList", name: "TV" },
  { id: "com.google.ios.youtube", name: "YouTube" },
  { id: "com.netflix.Netflix", name: "Netflix" },
  { id: "com.apple.TVSettings", name: "Settings" },
  { id: "com.plexapp.plex", name: "Plex" },
];
const TV: FakeTv = {
  found: [LIVING, BEDROOM],
  pin: "2552",
  power: "on",
  volume: 0.5,
  apps: APPS,
  accounts: [{ id: "u1", name: "Ada", current: true }, { id: "u2", name: "Grace" }],
  now: { state: "playing", title: "The Long Quiet", app: { id: "com.apple.TVWatchList", name: "TV" }, duration: 6120, position: 1800, at: Date.now(), rate: 1, mediaType: "video", itemId: "item-1" },
  keyboard: { focused: false },
};

describe("pure parts", () => {
  test("titles: an episode leads with its title under the show, a song with its artist, a film alone", () => {
    expect(titles({ state: "playing", title: "Pilot", series: "Harbor", season: 1, episode: 2 }, "TV")).toEqual({ title: "Pilot", sub: "Harbor · S1 · E2", small: "TV" });
    expect(titles({ state: "playing", title: "Song", artist: "Band", album: "Record" }, "Music")).toEqual({ title: "Song", sub: "Band", small: "Record · Music" });
    expect(titles({ state: "playing", title: "Film" }, "TV")).toMatchObject({ title: "Film", small: "TV" });
  });
  test("positionAt moves a playing item on by the rate since the TV said it, and holds a paused one", () => {
    const at = 1_000_000;
    expect(positionAt({ state: "playing", position: 10, at, rate: 1, duration: 100 }, at + 5000)).toBe(15);
    expect(positionAt({ state: "paused", position: 10, at, rate: 0, duration: 100 }, at + 5000)).toBe(10);
    expect(positionAt({ state: "playing", position: 98, at, rate: 1, duration: 100 }, at + 5000)).toBe(100);
  });
  test("the remote's trees pass the host's checks in every state and layout, and a flash lights only its cell", () => {
    const base: RemoteState = { layout: "wide", conn: "up", power: "on", dock: APPS.map((a) => ({ ...a, art: placeholderArt(a.id, a.name), wide: placeholderArt(a.id, a.name) })), skip: 10, mrp: true, device: { name: "Living Room", modelName: "Apple TV 4K" } };
    for (const st of [base, { ...base, layout: "compact" as const }, { ...base, unpaired: true }, { ...base, conn: "down" as const, error: "No route" }, { ...base, power: "off" as const }, { ...base, keyboard: { focused: true, title: "Search" }, typing: true }, { ...base, now: TV.now, position: 30, volume: 0.4 }]) {
      expect(() => checkView(renderRemote(st), "remote")).not.toThrow();
    }
    const lit = JSON.stringify(clickpad({ ...base, flash: "left" }, 176));
    expect(lit).toContain("#4F8AE866");
    expect(lit.match(/#4F8AE866/g)).toHaveLength(1);
    expect(renderRemote({ ...base, keyboard: { focused: true, title: "Search" }, typing: true }).input).toMatchObject({ submit: "type:send", cancel: "type:cancel", placeholder: "Search" });
  });
  test("the setup's trees pass the checks; a PIN step opens the field once the code shows", () => {
    for (const st of [{ phase: "find", scanning: true }, { phase: "find", scanning: false }, { phase: "pin", protocol: "companion", device: LIVING, asking: true, tries: 0 }, { phase: "pin", protocol: "airplay", device: LIVING, asking: false, tries: 1, error: "nope" }, { phase: "checking", device: LIVING }, { phase: "failed", device: LIVING, error: "x", hint: "y" }] as const) {
      expect(() => checkView(renderSetup(st as never, [LIVING], []), "setup")).not.toThrow();
    }
    expect(renderSetup({ phase: "pin", protocol: "companion", device: LIVING, asking: true, tries: 0 }, [], []).input).toBeUndefined();
    expect(renderSetup({ phase: "pin", protocol: "companion", device: LIVING, asking: false, tries: 0 }, [], []).input).toMatchObject({ submit: "pin" });
  });
  test("an app's stand-in: Apple's own mark for its apps, the initial on a steady colour for the rest", () => {
    expect(placeholderArt("com.apple.TVSettings", "Settings")).toContain("data:image/svg+xml");
    expect(placeholderArt("com.apple.TVSettings", "Settings")).not.toEqual(letterTile("Settings"));
    expect(letterTile("Plex")).toEqual(letterTile("Plex"));
    expect(decodeURIComponent(letterTile("plex"))).toContain(">P</text>");
  });
});

describe("links, Now Playing and pictures", () => {
  test("parseLink: YouTube in every shape with its start time and playlist, Netflix, Apple TV+; what the TV cannot open (Twitch, a file, a page) is nothing", () => {
    expect(parseLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s&list=PL1")).toMatchObject({ kind: "youtube", id: "dQw4w9WgXcQ", start: 90, list: "PL1" });
    expect(parseLink("https://youtu.be/dQw4w9WgXcQ?t=42")).toMatchObject({ kind: "youtube", id: "dQw4w9WgXcQ", start: 42 });
    expect(parseLink("https://m.youtube.com/shorts/abc123")).toMatchObject({ kind: "youtube", id: "abc123" });
    expect(parseLink("http://youtube.com/live/xyz?start=600")).toMatchObject({ kind: "youtube", id: "xyz", start: 600, url: expect.stringMatching(/^https:/) });
    expect(parseLink("https://www.netflix.com/title/80057281")).toMatchObject({ kind: "netflix", id: "80057281" });
    expect(parseLink("https://tv.apple.com/us/show/severance/umc.cmc.1srk2goyh2q2zdxcx605w8vtx")).toMatchObject({ kind: "appletv" });
    for (const no of ["https://www.youtube.com/", "https://www.twitch.tv/somechannel", "https://cdn.example.com/a/clip.mp4", "https://example.com/page", "not a url"]) expect(parseLink(no)).toBeUndefined();
    expect(seconds("1h2m3s")).toBe(3723);
    expect(seconds("abc")).toBeUndefined();
  });
  test("findLink takes the first playable link out of a copied paragraph, trailing punctuation off; one video copied twice is one link", () => {
    const l = findLink("watch this: https://youtu.be/abc?t=5, it's great. also https://www.netflix.com/title/1")!;
    expect(l).toMatchObject({ kind: "youtube", id: "abc", start: 5 });
    expect(linkKey(l)).toBe(linkKey(parseLink("https://www.youtube.com/watch?v=abc&feature=share")!));
    expect(findLink("nothing here https://example.com")).toBeUndefined();
  });
  test("target: each kind reaches the TV its own way; a start time is dropped when asked to play from the start", () => {
    const yt = parseLink("https://youtu.be/abc?t=90")!;
    expect(target(yt)).toEqual({ app: "com.google.ios.youtube", url: "youtube://www.youtube.com/watch?v=abc&t=90" });
    expect(target(yt, true).url).toBe("youtube://www.youtube.com/watch?v=abc");
    expect(target(parseLink("https://www.netflix.com/title/80057281")!).url).toBe("https://www.netflix.com/title/80057281");
  });
  const EP = { state: "playing", title: "Ep", series: "Show", season: 1, episode: 2, duration: 1000, position: 300, at: 0, rate: 1, chapters: [{ title: "A", start: 0 }, { title: "B", start: 400 }], languages: { audio: [{ id: "a1", name: "English", active: true }, { id: "a2", name: "Español", active: false }], subtitles: [{ id: "s1", name: "English", active: false }] }, rates: [1, 1.5, 2] } as const;
  const NOW: NowState = { layout: "wide", device: "Living Room", now: EP as never, position: 300, panel: "next", cursor: 0, mrp: true };
  test("Now Playing: the panels an item has, the chapter at a time, every state's tree passes the checks, an action id once", () => {
    expect(panels(NOW)).toEqual(["next", "chapters", "audio", "subtitles", "info"]);
    expect(panels({ ...NOW, now: { state: "playing", title: "x" } })).toEqual(["next", "info"]);
    expect(chapterAt(EP as never, 399)).toBe(0);
    expect(chapterAt(EP as never, 400)).toBe(1);
    for (const st of [NOW, { ...NOW, layout: "compact" as const }, { ...NOW, panel: "chapters" as const }, { ...NOW, panel: "subtitles" as const, cursor: 1 }, { ...NOW, scrub: { target: 500 } }, { ...NOW, status: "asleep" as const }, { ...NOW, status: "noAirplay" as const }, { ...NOW, panel: "lyrics" as const, lyrics: { lines: [{ at: 1, text: "la" }] } }]) {
      expect(() => checkView(renderNow(st), "now")).not.toThrow();
    }
    const ids = nowActions(NOW).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(nowActions({ ...NOW, scrub: { target: 500 } })[0]).toMatchObject({ id: "scrub:commit", title: "Seek to 8:20" });
    expect(nowActions({ ...NOW, panel: "chapters", cursor: 1 })[0]).toMatchObject({ id: "panel:enter", title: "Jump to B" });
  });
  test("pictures: a rounded PNG keeps the middle and clears the corners; the dominant colour of a red picture is red; the backdrop is a deep tone of its hue", () => {
    const px = { width: 20, height: 20, data: new Uint8Array(20 * 20 * 4).map((_, i) => (i % 4 === 0 ? 220 : i % 4 === 3 ? 255 : 30)) };
    const r = rounded(px);
    expect(r.data[3]).toBe(0);
    expect(r.data[(10 * 20 + 10) * 4 + 3]).toBe(255);
    expect(pngData(r)).toMatch(/^data:image\/png;base64,iVBOR/);
    const c = dominant(px)!;
    expect(c.r).toBeGreaterThan(c.g * 3);
    const b = backdrop(c);
    expect(parseInt(b.deep.slice(1, 3), 16)).toBeLessThan(90);
    expect(parseInt(b.deep.slice(1, 3), 16)).toBeGreaterThan(parseInt(b.deep.slice(3, 5), 16));
    expect(decodeURIComponent(wideArt("x.y", "Plex"))).toContain('viewBox="0 0 40 24"');
  });
});

describe("over the host against the stand-in TV", () => {
  let host: Host;
  const dir = mkdtempSync(join(tmpdir(), "pal-appletv-"));
  const tvFile = join(dir, "tv.json");
  const setTv = (f: (tv: FakeTv) => void) => { const tv = JSON.parse(readFileSync(tvFile, "utf8")) as FakeTv; f(tv); writeFileSync(tvFile, JSON.stringify(tv)); };
  const log = () => logLines(join(dir, "log")).map((l) => JSON.parse(l) as Record<string, unknown>);
  const ops = (op: string) => log().filter((l) => l.op === op);
  const view = (palette: string, args?: unknown) => host.request<View>("view", { extension: E, palette, args });
  const text = (v: { tree: unknown }) => JSON.stringify(v.tree);
  const pick = (palette: string, action: string, values?: Record<string, string>) => host.pick(E, palette, palette === "setup" ? "setup" : "remote", action, values ? { values } : undefined);

  /** The clipboard's newest entry as pal's history would answer it; a test puts a link there. */
  let clip: { id: number; kind: "text"; text: string; at: number } | null = { id: 1, kind: "text", text: "hello", at: Date.now() };
  /** YouTube's oEmbed, answered here. */
  const oembed = Bun.serve({ port: 0, fetch: (r) => { const v = new URL(new URL(r.url).searchParams.get("url")!).searchParams.get("v"); return Response.json({ title: `Video ${v}`, author_name: "Coastline Labs" }); } });

  beforeAll(async () => {
    writeFileSync(tvFile, JSON.stringify(TV));
    process.env.PAL_APPLETV_FAKE = dir;
    process.env.PAL_APPLETV_OEMBED = `http://127.0.0.1:${oembed.port}/oembed`;
    host = await Host.bundled({ only: [E], settings: { [E]: { settings: { stay: false } } }, core: { "clipboard.current": () => clip, "clipboard.list": () => (clip ? [clip] : []) } });
  });
  afterAll(() => { host.kill(); oembed.stop(true); delete process.env.PAL_APPLETV_FAKE; delete process.env.PAL_APPLETV_OEMBED; rmSync(dir, { recursive: true, force: true }); });

  test("loads with seven palettes, the bar item and seven links, no warnings", () => {
    const l = host.loaded().find((x) => x.extension === E)!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => p.name)).toEqual(["remote", "now", "play", "apps", "commands", "users", "setup"]);
    expect(l.palettes.find((p) => p.name === "remote")).toMatchObject({ view: "view", input: true, icon: bundledIcon(E) });
    expect(l.palettes.find((p) => p.name === "commands")).toMatchObject({ tier: "primary" });
    expect(l.bar?.map((b) => b.id)).toEqual(["playing"]);
    expect(Object.keys(l.manifest.links!)).toEqual(["key", "launch", "power", "type", "media", "volume", "play"]);
  });

  test("nothing paired: the lists are the setup row, the remote is the welcome, the bar item hides", async () => {
    for (const p of ["apps", "commands", "users", "play"]) expect((await host.list(E, p)).map((i) => i.id)).toEqual(["setup"]);
    const v = await view("remote");
    expect(text(v)).toContain("Control your Apple TV from here");
    expect(v.actions[0]).toMatchObject({ id: "setup" });
    expect(await host.pick(E, "remote", "remote", "setup")).toEqual({ push: { extension: E, palette: "setup" } });
    expect(await host.render(E, "playing")).toEqual({ hidden: true });
  });

  test("setup: finds both TVs, a wrong code brings a new one, the right one moves on to now playing, then the check", async () => {
    await view("setup");
    await host.until(() => ops("scan").length > 0, 2000, "a scan");
    const found = await host.until(async () => text(await view("setup")).includes("Living Room"), 2000, "the list").then(() => view("setup"));
    expect(text(found)).toContain("Apple TV 4K (2nd generation)");
    expect(text(found)).toContain("Bedroom");
    expect(found.actions[0]).toMatchObject({ id: `pair:${LIVING.id}`, title: "Pair with Living Room" });
    // Step 1, the remote: the code appears, the field opens.
    const asking = await pick("setup", `pair:${LIVING.id}`);
    expect(text(asking.view!)).toContain("Type the code on your TV");
    await host.until(async () => !!(await view("setup")).input, 2000, "the field");
    expect(ops("pair")).toEqual([{ op: "pair", id: LIVING.id, protocol: "companion" }]);
    // A wrong code: said so, and a new code asked for.
    const wrong = await pick("setup", "pin", { input: "1111" });
    expect(text(wrong.view!)).toContain("That code did not match");
    await host.until(() => ops("pair").length === 2, 2000, "a new code");
    await host.until(async () => !!(await view("setup")).input, 2000, "the field again");
    // Not four digits: refused before the TV hears of it.
    expect(text((await pick("setup", "pin", { input: "25" })).view!)).toContain("The code is four digits");
    // The right one: on to step 2, AirPlay.
    const two = await pick("setup", "pin", { input: "2552" });
    expect(text(two.view!)).toContain("One more code");
    await host.until(() => ops("pair").some((p) => p.protocol === "airplay"), 2000, "the AirPlay pairing");
    await host.until(async () => !!(await view("setup")).input, 2000, "the AirPlay field");
    await pick("setup", "pin", { input: "2552" });
    // Saved with both keys, made current, and checked against the TV.
    await host.until(() => Array.isArray(stored.get(`${E}\0devices`)), 2000, "the device stored");
    const devices = stored.get(`${E}\0devices`) as { id: string; companion?: unknown; airplay?: unknown }[];
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: LIVING.id, companion: { serverId: `${LIVING.id}-companion` }, airplay: { serverId: `${LIVING.id}-airplay` } });
    await host.until(() => host.written.get(E)?.device === "Living Room", 2000, "the device setting");
    await host.until(async () => text(await view("setup")).includes("Living Room is ready"), 3000, "ready");
    const ready = text(await view("setup"));
    expect(ready).toContain("5 apps, a digit each for the dock");
    expect(ready).toContain("50% now; the slider sets it");
    expect(ready).toContain("The Long Quiet in TV");
    expect(ready).toContain("2 people: u switches");
    expect(await pick("setup", "remote")).toEqual({ push: { extension: E, palette: "remote" } });
  });

  test("the remote: what plays, the dock, and each key sends its button; a key lights its cell, then the light goes", async () => {
    const v = await view("remote");
    expect(v.title).toBe("Living Room · The Long Quiet");
    expect(text(v)).toContain("The Long Quiet");
    expect(text(v)).toContain("Apple TV 4K (2nd generation)");
    expect(v.actions[0]).toMatchObject({ id: "select", title: "Select" });
    host.viewShown(E, { palette: "remote" }, "remote");
    const n = ops("key").length;
    const up = await pick("remote", "up");
    expect(text(up.view!)).toContain("#4F8AE866");
    await host.until(() => ops("key").length === n + 1, 2000, "the key");
    expect(ops("key").at(-1)).toEqual({ op: "key", key: "up", press: "tap" });
    // The light goes after 160 ms (a push without it).
    await host.advance(200);
    await host.nextViewUpdate(E, { palette: "remote" }, (u) => !JSON.stringify(u.spec).includes("#4F8AE866"));
    for (const [action, key, press] of [["select:hold", "select", "hold"], ["menu", "menu", "tap"], ["home:double", "home", "double"], ["control-center", "home", "hold"], ["play-pause", "play_pause", "tap"], ["volume-up", "volume_up", "tap"]] as const) {
      await pick("remote", action);
      await host.until(() => JSON.stringify(ops("key").at(-1)) === JSON.stringify({ op: "key", key, press }), 2000, `${action}`);
    }
    await pick("remote", "swipe:left");
    await host.until(() => ops("swipe").at(-1)?.direction === "left", 2000, "the swipe");
    await pick("remote", "skip-forward");
    await host.until(() => ops("media").at(-1)?.command === "skip_forward" && ops("media").at(-1)?.arg === 10, 2000, "skip");
    // The seek bar: a click's fraction of the duration.
    await host.pick(E, "remote", "remote", "seek", { values: { value: "0.5" } });
    await host.until(() => ops("media").at(-1)?.command === "seek" && ops("media").at(-1)?.arg === 3060, 2000, "seek");
    await host.pick(E, "remote", "remote", "volume:set", { values: { value: "0.25" } });
    await host.until(() => ops("volume").at(-1)?.level === 0.25, 2000, "volume");
    // The dock's first digit opens the first app.
    expect(await pick("remote", "launch:0")).toMatchObject({ hud: "Opening TV" });
    expect(ops("launch").at(-1)).toEqual({ op: "launch", id: "com.apple.TVWatchList" });
    expect(await pick("remote", "apps")).toEqual({ push: { extension: E, palette: "apps" } });
  });

  test("typing: refused while the TV shows no field; with one, the banner, then the field, and Enter sets the text", async () => {
    expect(await pick("remote", "type")).toMatchObject({ toast: { title: "Nothing to type into yet", style: "failure" } });
    setTv((tv) => { tv.keyboard = { focused: true, title: "Search" }; });
    await host.nextViewUpdate(E, { palette: "remote" }, (u) => JSON.stringify(u.spec).includes("is asking for text: Search"));
    const open = await pick("remote", "type");
    expect(open.view!.input).toMatchObject({ placeholder: "Search", submit: "type:send" });
    const sent = await pick("remote", "type:send", { input: "harbor" });
    expect(sent).toMatchObject({ hud: "Typed “harbor”" });
    expect(ops("text").at(-1)).toEqual({ op: "text", set: "harbor" });
    setTv((tv) => { tv.keyboard = { focused: false }; });
  });

  test("a change on the TV pushes into the open remote and the bar item: a new title, then paused, then asleep", async () => {
    setTv((tv) => { tv.now = { ...tv.now!, title: "Harbor Lights", itemId: "item-2" }; });
    await host.nextViewUpdate(E, { palette: "remote" }, (u) => JSON.stringify(u.spec).includes("Harbor Lights"));
    const bar = await host.render(E, "playing");
    expect(bar).toMatchObject({ title: "Harbor Lights", tooltip: "Harbor Lights · TV on Living Room", states: { power: "on", playing: true, app: "TV", title: "Harbor Lights" } });
    // Apple's TV app has a drawn SVG tile, which the strip's renderers cannot draw: the TV mark stands in.
    expect((bar as BarItem).icon).toBe("\u{f0502}");
    setTv((tv) => { tv.now = { ...tv.now!, state: "paused" }; });
    await host.nextUpdate(E, "playing", (i) => i.color === "muted" && !!i.tooltip?.endsWith(", paused"));
    setTv((tv) => { tv.power = "off"; });
    const asleep = await host.nextUpdate(E, "playing", (i) => !!i.hidden);
    expect(asleep).toMatchObject({ hidden: true, empty: { tooltip: "Living Room is asleep" } });
    // p wakes it.
    await pick("remote", "power");
    await host.until(() => ops("power").at(-1)?.to === "on", 2000, "wake");
    setTv((tv) => { tv.now = { ...tv.now!, state: "playing" }; });
  });

  test("apps: every app with its picture, the one in front tagged, the dock's digits; cmd+D adds one to the dock setting", async () => {
    const rows = await host.list(E, "apps");
    expect(rows.map((r) => r.name)).toEqual(["Netflix", "Plex", "Settings", "TV", "YouTube"]);
    expect(rows.find((r) => r.name === "TV")).toMatchObject({ subtitle: "In front on Living Room", accessories: [{ tag: "in front", color: "green" }, { keys: "1" }] });
    expect(rows.find((r) => r.name === "Settings")!.icon).toMatchObject({ image: expect.stringContaining("data:image/svg+xml") });
    expect(await host.pick(E, "apps", "com.netflix.Netflix", "launch")).toMatchObject({ hud: "Opening Netflix" });
    expect(ops("launch").at(-1)).toEqual({ op: "launch", id: "com.netflix.Netflix" });
    expect(await host.pick(E, "apps", "com.netflix.Netflix", "copy")).toEqual({ copy: "com.netflix.Netflix" });
    // Five apps: the automatic dock holds them all (the opened ones first: TV and Netflix were), so the first cmd+D takes one out and writes the rest as the setting; the second puts it back at the end.
    expect((await host.pick(E, "apps", "com.apple.TVSettings", "dock")).toast?.title).toBe("Settings left the dock");
    expect(host.written.get(E)?.favorites).toEqual(["TV", "Netflix", "YouTube", "Plex"]);
    expect((await host.pick(E, "apps", "com.apple.TVSettings", "dock")).toast).toMatchObject({ title: "Settings is in the dock", message: "Digit 5 on the remote" });
    expect(host.written.get(E)?.favorites).toEqual(["TV", "Netflix", "YouTube", "Plex", "Settings"]);
  });

  test("commands at the root: play or pause sends the button and says so; typing from the root; users switch", async () => {
    const rows = await host.list(E, "commands");
    expect(rows.map((r) => r.id)).toContain("type");
    expect(rows.find((r) => r.id === "sleep")).toMatchObject({ subtitle: "Living Room" });
    expect(await host.pick(E, "commands", "play-pause", "run")).toMatchObject({ hud: "Living Room: Play or Pause" });
    expect(ops("key").at(-1)).toMatchObject({ key: "play_pause" });
    expect(await host.pick(E, "commands", "type", "type", { values: { text: "x" } })).toMatchObject({ toast: { style: "failure" } });
    const users = await host.list(E, "users");
    expect(users.map((u) => [u.name, u.accessories])).toEqual([["Ada", [{ tag: "current", color: "green" }]], ["Grace", []]]);
    await host.pick(E, "users", "u2", "switch");
    expect(ops("account").at(-1)).toEqual({ op: "account", id: "u2" });
  });

  test("Now Playing: the item in full, a panel walked and its row picked, a held scrub that seeks once, speed and subtitles", async () => {
    setTv((tv) => {
      tv.power = "on";
      tv.now = { state: "playing", title: "The Lantern Keeper", series: "Harbor", season: 2, episode: 5, mediaType: "tv", app: { id: "com.apple.TVWatchList", name: "TV" }, duration: 3312, position: 1000, at: Date.now(), rate: 1, itemId: "h205", description: "A storm.", rates: [1, 1.5, 2],
        chapters: [{ title: "Cold open", start: 0 }, { title: "The logbook", start: 400 }, { title: "Low tide", start: 1190 }],
        languages: { audio: [{ id: "a1", name: "English", active: true }, { id: "a2", name: "Español", active: false }], subtitles: [{ id: "s1", name: "English", active: true }] } };
      tv.queue = [{ id: "h206", title: "Fog Signal", series: "Harbor", season: 2, episode: 6, duration: 3240 }];
    });
    host.viewShown(E, { palette: "now" }, "now");
    const v = await host.until(async () => text(await view("now")).includes("Fog Signal"), 2000, "the queue").then(() => view("now"));
    expect(v.title).toBe("The Lantern Keeper · Harbor · S2 · E5");
    expect(text(v)).toContain("Season 2, Episode 5");
    expect(v.actions[0]).toMatchObject({ id: "panel:enter", title: "Play Fog Signal" });
    // Chapters: the second row, Enter jumps there.
    await host.pick(E, "now", "now", "panel:chapters");
    await host.pick(E, "now", "now", "cursor:down");
    const ch = await host.pick(E, "now", "now", "panel:enter");
    expect(ch.view).toBeDefined();
    await host.until(() => ops("media").at(-1)?.command === "seek" && ops("media").at(-1)?.arg === 400, 2000, "the chapter's seek");
    // Three quick presses: 10 s each; the seek goes once, when the keys rest.
    const seeks = ops("media").filter((m) => m.command === "seek").length;
    for (let i = 0; i < 3; i++) await host.pick(E, "now", "now", "scrub+");
    const scrubbing = await view("now");
    expect(scrubbing.actions[0].id).toBe("scrub:commit");
    expect(ops("media").filter((m) => m.command === "seek").length).toBe(seeks);
    await host.advance(700);
    await host.until(() => ops("media").filter((m) => m.command === "seek").length === seeks + 1, 2000, "one seek");
    expect(Number(ops("media").at(-1)!.arg)).toBeGreaterThanOrEqual(1030);
    await host.pick(E, "now", "now", "speed:up");
    await host.until(() => ops("rate").at(-1)?.rate === 1.5, 2000, "the speed");
    await host.pick(E, "now", "now", "panel:subtitles");
    await host.pick(E, "now", "now", "panel:enter");
    await host.until(() => JSON.stringify(ops("language").at(-1)) === JSON.stringify({ op: "language", kind: "subtitles", id: null }), 2000, "subtitles off");
    await host.pick(E, "now", "now", "panel:next");
    await host.pick(E, "now", "now", "panel:enter");
    await host.until(() => ops("queue").at(-1)?.play === "h206", 2000, "the queue item");
    host.viewHidden(E, { palette: "now" }, "now");
  });

  test("a copied YouTube link: offered by the bar item and the remote, played at its start time in the TV's YouTube app, then not offered again", async () => {
    // The entry there at the first poll is old news: the next poll after it sees the link.
    await host.advance(2000);
    clip = { id: 2, kind: "text", text: "look https://youtu.be/abc123?t=95 nice", at: Date.now() };
    await host.advance(2000);
    const offered = await host.nextUpdate(E, "playing", (i) => !!i.title?.startsWith("Play on TV: Video abc123"));
    expect(offered).toMatchObject({ color: "accent" });
    const remote = await view("remote");
    expect(text(remote)).toContain("Video abc123");
    expect(remote.actions.find((a) => a.id === "play-link")?.title).toBe("Play “Video abc123”");
    const played = await pick("remote", "play-link");
    expect(played.hud).toBe("Playing “Video abc123” on Living Room");
    expect(ops("launch").at(-1)).toEqual({ op: "launch", id: "youtube://www.youtube.com/watch?v=abc123&t=95" });
    expect(text((await view("remote")))).not.toContain("Video abc123");
    // Played: the palette lists it under what was played.
    const rows = await host.list(E, "play");
    expect(rows.find((r) => r.name === "Video abc123")).toMatchObject({ section: "Copied" });
  });

  test("play: a link typed at the root is one row that plays it; a link route plays the url given", async () => {
    const rows = await host.list(E, "play", "https://www.youtube.com/watch?v=xyz789", { inline: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Play on Living Room", subtitle: "Video xyz789 · Coastline Labs", hero: true });
    expect(await host.pick(E, "play", rows[0].id, "play")).toEqual({ hud: "Playing “Video xyz789” on Living Room" });
    expect(ops("launch").at(-1)).toEqual({ op: "launch", id: "youtube://www.youtube.com/watch?v=xyz789" });
    expect(await host.list(E, "play", "https://example.com/page", { inline: true })).toEqual([]);
    expect(await host.request("link", { extension: E, route: "play", params: { url: "https://www.netflix.com/title/80057281" } })).toMatchObject({ hud: expect.stringContaining("on Living Room") });
    expect(ops("launch").at(-1)).toEqual({ op: "launch", id: "https://www.netflix.com/title/80057281" });
  });

  test("links: launch by name, a key held, the volume as a percent, power toggled, refusals in words", async () => {
    expect(await host.request("link", { extension: E, route: "launch", params: { app: "youtube" } })).toMatchObject({ hud: "Opening YouTube" });
    expect(ops("launch").at(-1)).toEqual({ op: "launch", id: "com.google.ios.youtube" });
    await host.request("link", { extension: E, route: "key", params: { name: "home", press: "hold" } });
    expect(ops("key").at(-1)).toEqual({ op: "key", key: "home", press: "hold" });
    await host.request("link", { extension: E, route: "volume", params: { level: "40" } });
    expect(ops("volume").at(-1)).toEqual({ op: "volume", level: 0.4 });
    await host.request("link", { extension: E, route: "power", params: { to: "off" } });
    expect(ops("power").at(-1)).toEqual({ op: "power", to: "off" });
    await expect(host.request("link", { extension: E, route: "launch", params: { app: "nothing here" } })).rejects.toThrow(/no app "nothing here" on Living Room/);
    await expect(host.request("link", { extension: E, route: "type", params: { text: "hi" } })).rejects.toThrow(/no text field is open/);
  });
});
