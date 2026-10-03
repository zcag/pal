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
import { letterTile, placeholderArt } from "../../../extensions/appletv/art.ts";
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
    const base: RemoteState = { layout: "wide", conn: "up", power: "on", dock: APPS.map((a) => ({ ...a, art: placeholderArt(a.id, a.name) })), skip: 10, mrp: true, device: { name: "Living Room", modelName: "Apple TV 4K" } };
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

  beforeAll(async () => {
    writeFileSync(tvFile, JSON.stringify(TV));
    process.env.PAL_APPLETV_FAKE = dir;
    host = await Host.bundled({ only: [E], settings: { [E]: { settings: { stay: false } } } });
  });
  afterAll(() => { host.kill(); delete process.env.PAL_APPLETV_FAKE; rmSync(dir, { recursive: true, force: true }); });

  test("loads with five palettes, the bar item and six links, no warnings", () => {
    const l = host.loaded().find((x) => x.extension === E)!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => p.name)).toEqual(["remote", "apps", "commands", "users", "setup"]);
    expect(l.palettes.find((p) => p.name === "remote")).toMatchObject({ view: "view", input: true, icon: bundledIcon(E) });
    expect(l.palettes.find((p) => p.name === "commands")).toMatchObject({ tier: "primary" });
    expect(l.bar?.map((b) => b.id)).toEqual(["playing"]);
    expect(Object.keys(l.manifest.links!)).toEqual(["key", "launch", "power", "type", "media", "volume"]);
  });

  test("nothing paired: the lists are the setup row, the remote is the welcome, the bar item hides", async () => {
    for (const p of ["apps", "commands", "users"]) expect((await host.list(E, p)).map((i) => i.id)).toEqual(["setup"]);
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
