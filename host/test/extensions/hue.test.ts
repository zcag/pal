// Hue: the maths (xy, gamut, mirek, HSV), the model over the sample home
// (ids, rooms, aggregation, scenes' swatches, sensors, the event merge),
// the wire parsers (SSE, mDNS), then the extension over the host against
// the mock bridge (hue-mock.ts, https with a self-signed certificate):
// nothing paired, discovery and press-link pairing with the certificate
// pinned, the rows of every palette, the light and room view under the
// keys and what each key PUTs, the event stream merging a change made
// elsewhere without a request, the bar item and its pushes, the links,
// and a bridge that rejects the key.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GAMUTS, clampToGamut, hsvToRgb, inGamut, kelvin, kelvinToXy, lux, mirekOf, mirekToRgb, rgbToHsv, rgbToXy, temperatureStops, toHex, xyToRgb } from "../../../extensions/hue/color.ts";
import { devicetype, hostPort, parseMdns, parseMdnsLookup, parseSse } from "../../../extensions/hue/api.ts";
import { ROOT_BRIDGE_PEM, ROOT_BRIDGE_SHA256 } from "../../../extensions/hue/cert.ts";
import { Home, aggregate, automationsOf, deepMerge, entertainmentOf, lightsOf, roomsOf, scenesOf, sensorsOf, slug, swatchesOf } from "../../../extensions/hue/model.ts";
import { PRESETS, fresh, render, renderSetup, shown } from "../../../extensions/hue/render.ts";
import { lightRow, roomRow, sceneRow } from "../../../extensions/hue/rows.ts";
import { SAMPLE_BRIDGE_ID, SAMPLE_KEY, SAMPLE_RESOURCES } from "../../../extensions/hue/sample.ts";
import { checkView } from "../../../sdk/src/view.ts";
import type { Effect, View } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";
import { MockBridge, discoveryServer } from "./hue-mock.ts";

const E = "hue";
// Discovery is the cloud endpoint and mDNS; in the tests the cloud is a local server (set per describe) and mDNS a tool that prints nothing.
process.env.PAL_HUE_MDNS = "true";
const near = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

describe("colour maths", () => {
  test("xy to rgb and back lands on the same point, for the primaries and a warm white", () => {
    for (const xy of [{ x: 0.6915, y: 0.3083 }, { x: 0.17, y: 0.7 }, { x: 0.1532, y: 0.0475 }, { x: 0.4575, y: 0.4099 }, { x: 0.3127, y: 0.329 }]) {
      const back = rgbToXy(xyToRgb(xy, 1, GAMUTS.C), GAMUTS.C);
      expect(near(back.x, xy.x, 0.02) && near(back.y, xy.y, 0.02)).toBe(true);
    }
  });
  test("a point outside the gamut is clamped to its nearest edge; one inside is left alone", () => {
    const inside = { x: 0.4, y: 0.4 };
    expect(inGamut(inside, GAMUTS.B)).toBe(true);
    expect(clampToGamut(inside, GAMUTS.B)).toEqual(inside);
    const deepBlue = { x: 0.1532, y: 0.0475 };
    expect(inGamut(deepBlue, GAMUTS.B)).toBe(false);
    const c = clampToGamut(deepBlue, GAMUTS.B);
    expect(inGamut({ x: c.x + (0.3 - c.x) * 0.001, y: c.y + (0.3 - c.y) * 0.001 }, GAMUTS.B)).toBe(true);
    expect(c).not.toEqual(deepBlue);
    expect(Math.hypot(c.x - deepBlue.x, c.y - deepBlue.y)).toBeLessThan(0.03);
    // A pure red asked of a gamut B bulb comes back as gamut B's red corner, not sRGB's.
    const red = rgbToXy({ r: 1, g: 0, b: 0 }, GAMUTS.B);
    expect(near(red.x, GAMUTS.B.red.x, 0.001) && near(red.y, GAMUTS.B.red.y, 0.001)).toBe(true);
  });
  test("mirek and kelvin invert; the locus is warm at 500 and cool at 153; the strip runs warm to cool", () => {
    expect(kelvin(500)).toBe(2000);
    expect(kelvin(153)).toBe(6536);
    expect(mirekOf(2700)).toBe(370);
    const warm = mirekToRgb(500), cool = mirekToRgb(153);
    expect(warm.r).toBeGreaterThan(warm.b);
    expect(cool.b).toBeGreaterThan(cool.r * 0.9);
    // D65 sits a little off the Planckian locus, so a loose match.
    const d65 = kelvinToXy(6504);
    expect(near(d65.x, 0.3127, 0.01) && near(d65.y, 0.329, 0.01)).toBe(true);
    const stops = temperatureStops();
    expect(stops).toHaveLength(7);
    expect(stops[0]).toBe(toHex(warm));
    expect(stops[6]).toBe(toHex(cool));
  });
  test("hsv round trips and lux is the log scale undone", () => {
    const c = { r: 0.2, g: 0.6, b: 0.9 };
    const back = hsvToRgb(rgbToHsv(c));
    expect(near(back.r, c.r) && near(back.g, c.g) && near(back.b, c.b)).toBe(true);
    expect(lux(1)).toBe(1);
    expect(lux(40001)).toBe(10000);
    expect(lux(18000)).toBe(63);
  });
  test("the root CA is the one the developer site publishes: parses, self-signed, the fingerprint on record", () => {
    expect(ROOT_BRIDGE_PEM).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
    expect(ROOT_BRIDGE_SHA256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    const out = Bun.spawnSync(["openssl", "x509", "-noout", "-subject", "-fingerprint", "-sha256"], { stdin: Buffer.from(ROOT_BRIDGE_PEM) });
    if (out.exitCode !== 0) return;
    const text = out.stdout.toString();
    expect(text).toMatch(/CN ?= ?root-bridge/);
    expect(text).toContain(ROOT_BRIDGE_SHA256);
  });
});

describe("the model over the sample home", () => {
  const home = new Home();
  home.load({ id: SAMPLE_BRIDGE_ID, name: "Hue Bridge", ip: "127.0.0.1" }, SAMPLE_RESOURCES);
  test("slugs: ascii, dashes, a fallback; a second of a name is -2", () => {
    expect(slug("Living room")).toBe("living-room");
    expect(slug("Çalışma odası")).toBe("calisma-odasi");
    expect(slug("  ")).toBe("unnamed");
    const twice = new Home();
    twice.load({ id: "b", name: "b", ip: "x" }, [...SAMPLE_RESOURCES, { ...SAMPLE_RESOURCES.find((r) => r.id === "light-6")!, id: "light-7" }]);
    expect(lightsOf(twice).filter((l) => l.name === "Hall spot").map((l) => l.id)).toEqual(["light:hall-spot", "light:hall-spot-2"]);
  });
  test("lights: ids, rooms, colour, temperature range, effects, reachability", () => {
    const lights = lightsOf(home);
    expect(lights.map((l) => l.id)).toEqual(["light:bedside", "light:ceiling", "light:hall-spot", "light:sofa-lamp", "light:tv-strip", "light:wardrobe"]);
    const sofa = lights.find((l) => l.id === "light:sofa-lamp")!;
    expect(sofa).toMatchObject({ on: true, brightness: 72, mirek: 366, mirekRange: [153, 500], gamutType: "C", effects: ["candle", "fire", "sparkle"], reach: "connected", room: { id: "room:living-room", name: "Living room" } });
    const strip = lights.find((l) => l.id === "light:tv-strip")!;
    expect(strip.effect).toBe("candle");
    expect(strip.mirek).toBeUndefined();
    expect(toHex(xyToRgb(strip.xy!, 1, strip.gamut))).toMatch(/^#[0-3][0-9a-f]00ff$/);
    expect(lights.find((l) => l.id === "light:wardrobe")).toMatchObject({ reach: "disconnected", mirekRange: undefined, xy: undefined });
  });
  test("rooms then zones, each with its lights and its grouped light; the aggregate counts and mixes", () => {
    const rooms = roomsOf(home);
    expect(rooms.map((r) => r.id)).toEqual(["room:bedroom", "room:hallway", "room:living-room", "zone:evening"]);
    const living = rooms.find((r) => r.id === "room:living-room")!;
    expect(living.lights.map((l) => l.name)).toEqual(["Ceiling", "Sofa lamp", "TV strip"]);
    expect(living.grouped).toEqual({ rid: "gl-living", on: true, brightness: 72 });
    const a = aggregate(living);
    expect(a).toMatchObject({ on: 3, total: 3, brightness: 72, anyOn: true });
    expect(a.hex).toMatch(/^#[0-9a-f]{6}$/);
    const evening = rooms.find((r) => r.id === "zone:evening")!;
    expect(evening.lights.map((l) => l.id)).toEqual(["light:bedside", "light:sofa-lamp"]);
    expect(aggregate(rooms.find((r) => r.id === "room:bedroom")!)).toMatchObject({ on: 0, total: 2, anyOn: false, hex: undefined });
  });
  test("scenes by room with their swatches: the palette's colours, else the actions', a temperature as its white; smart scenes after", () => {
    const scenes = scenesOf(home);
    expect(scenes.map((s) => s.id)).toEqual(["scene:bedroom/bright", "scene:bedroom/nightlight", "smart:living-room/natural-light", "scene:living-room/read", "scene:living-room/relax", "scene:living-room/savanna-sunset", "scene:living-room/tropical-twilight"]);
    const savanna = scenes.find((s) => s.id === "scene:living-room/savanna-sunset")!;
    expect(savanna.swatches).toHaveLength(5);
    expect(savanna).toMatchObject({ dynamic: true, autoDynamic: true, speed: 0.6, active: "inactive", room: { id: "room:living-room" } });
    const relax = scenes.find((s) => s.id === "scene:living-room/relax")!;
    expect(relax.swatches).toEqual([toHex(mirekToRgb(447))]);
    expect(relax.active).toBe("static");
    expect(swatchesOf({ actions: [{ action: { on: { on: true } } }] })).toHaveLength(1);
    expect(scenes.find((s) => s.kind === "smart")).toMatchObject({ name: "Natural light", active: "inactive" });
  });
  test("sensors by device: the value as text, when it changed, the battery, the buttons' last event", () => {
    const sensors = sensorsOf(home);
    const by = Object.fromEntries(sensors.map((s) => [s.id, s]));
    expect(by["sensor:hallway-sensor-motion"]).toMatchObject({ kind: "motion", value: "motion", changed: "2026-09-16T19:58:12Z", battery: 84, batteryState: "normal", enabled: true });
    expect(by["sensor:hallway-sensor-temperature"].value).toBe("22.4 °C");
    expect(by["sensor:hallway-sensor-light-level"].value).toBe("63 lux");
    expect(by["sensor:bedroom-dimmer-button-1"]).toMatchObject({ value: "short release", battery: 12, batteryState: "low", control: 1 });
    expect(by["sensor:bedroom-dimmer-button-2"].value).toBe("no press yet");
    expect(by["sensor:kitchen-dial-dial-0"].value).toBe("clockwise 45 steps");
    expect(sensors.map((s) => s.device)).toEqual([...sensors.map((s) => s.device)].sort());
  });
  test("automations with their script; entertainment areas with their lights", () => {
    expect(automationsOf(home)).toMatchObject([{ id: "auto:hallway-motion", enabled: false, script: "Motion sensor" }, { id: "auto:weekday-wake-up", enabled: true, status: "running", script: "Wake up" }]);
    expect(entertainmentOf(home)).toMatchObject([{ id: "ent:tv-area", type: "screen", active: false, lights: 2 }]);
  });
  test("an event merges into the resource: objects patched, arrays replaced, an add inserts, a delete removes", () => {
    const h = new Home();
    h.load({ id: "b", name: "b", ip: "x" }, SAMPLE_RESOURCES);
    const v = h.version;
    expect(h.merge("b", { id: "e1", type: "update", creationtime: "", data: [{ id: "light-4", type: "light", on: { on: true }, dimming: { brightness: 55 } }] })).toEqual(["light-4"]);
    const bedside = lightsOf(h).find((l) => l.id === "light:bedside")!;
    expect(bedside).toMatchObject({ on: true, brightness: 55, mirek: 447 });
    expect(h.version).toBe(v + 1);
    h.merge("b", { id: "e2", type: "add", creationtime: "", data: [{ id: "light-9", type: "light", metadata: { name: "New" }, on: { on: false } }] });
    expect(lightsOf(h).some((l) => l.id === "light:new")).toBe(true);
    h.merge("b", { id: "e3", type: "delete", creationtime: "", data: [{ id: "light-9", type: "light" }] });
    expect(lightsOf(h).some((l) => l.id === "light:new")).toBe(false);
    expect(h.merge("b", { id: "e4", type: "update", creationtime: "", data: [{ id: "nope", type: "light", on: { on: true } }] })).toEqual([]);
    expect(deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, e: 2 })).toEqual({ a: { b: 1, c: [3] }, d: 1, e: 2 });
  });
  test("rows: the room's tile, the light's swatch and section, the scene's strip; every action listed has a title", () => {
    const rooms = roomsOf(home), lights = lightsOf(home), scenes = scenesOf(home);
    const living = roomRow(rooms.find((r) => r.id === "room:living-room")!, false, "Hue");
    expect(living).toMatchObject({ name: "Living room", subtitle: "Room · all 3 on · 72%", accessories: [{ text: "72%" }, { tag: "on", color: "green" }] });
    expect((living.icon as { image: string }).image).toMatch(/^data:image\/svg\+xml/);
    const two = roomRow(rooms.find((r) => r.id === "room:living-room")!, true, "Upstairs");
    expect(two.subtitle).toContain("· Upstairs");
    const wardrobe = lightRow(lights.find((l) => l.id === "light:wardrobe")!, false, "Hue");
    expect(wardrobe).toMatchObject({ section: "Bedroom", accessories: [{ tag: "unreachable", color: "red" }, { tag: "off", color: "grey" }] });
    const strip = lightRow(lights.find((l) => l.id === "light:tv-strip")!, false, "Hue");
    expect(strip.icon).toMatch(/^#[0-3][0-9a-f]00ff$/);
    expect(strip.accessories).toEqual([{ tag: "candle", color: "violet" }, { text: "45%" }, { tag: "on", color: "green" }]);
    const savanna = sceneRow(scenes.find((s) => s.id === "scene:living-room/savanna-sunset")!, false, "Hue");
    expect(savanna.accessories).toEqual([{ tag: "dynamic", color: "violet" }]);
    expect(savanna.actions!.map((a) => a.id)).toEqual(["activate", "dynamic", "room", "copy_id"]);
    for (const row of [living, wardrobe, strip, savanna]) for (const a of row.actions!) expect(a.title).toMatch(/^[A-Z][^A-Z]*$|^[A-Z]/);
  });
  test("the view: a light's tree passes the check, has the plane and the strip, and the keys of its focus; a room's has no identify", () => {
    const lights = lightsOf(home), rooms = roomsOf(home), scenes = scenesOf(home);
    const sofa = lights.find((l) => l.id === "light:sofa-lamp")!;
    const living = rooms.find((r) => r.id === "room:living-room")!;
    const t = { kind: "light" as const, light: sofa, room: living };
    const v = checkView(render(t, fresh(), scenes.filter((s) => s.room?.id === living.id && s.kind === "scene")));
    expect(v).toMatchObject({ title: "Sofa lamp", id: "light:sofa-lamp", keys: "actions" });
    const json = JSON.stringify(v.tree);
    expect(json).toContain('"key":"plane"');
    expect(json).toContain('"key":"ct"');
    expect(json).toContain('"key":"scene:living-room/savanna-sunset"');
    const ids = v.actions.map((a) => a.id);
    expect(ids.slice(0, 2)).toEqual(["toggle", "toggle:t"]);
    expect(ids).toEqual(expect.arrayContaining(["bri+", "bri--", "ct+", "ct--", "level:0", "level:9", "scope", "identify", "copy", "duration"]));
    expect(ids).not.toContain("hue+");
    const colour = render(t, { ...fresh(), focus: "color" }, []);
    expect(colour.actions.map((a) => a.id)).toEqual(expect.arrayContaining(["hue+", "sat--"]));
    const s = shown({ kind: "room", room: living });
    expect(s).toMatchObject({ on: true, brightness: 72, hasColor: true, hasTemperature: true, effect: "candle" });
    expect(s.effects).toEqual(["candle", "fire", "sparkle", "prism", "opal", "glisten"]);
    const rv = checkView(render({ kind: "room", room: living }, { ...fresh(), focus: "scenes", index: 1 }, scenes.filter((sc) => sc.room?.id === living.id && sc.kind === "scene")));
    expect(rv.actions[0]).toMatchObject({ id: "apply", title: "Play Relax" });
    expect(rv.actions.map((a) => a.id)).not.toContain("identify");
    expect(PRESETS.map((p) => p.id)).toEqual(["relax", "read", "concentrate", "energize", "bright", "dimmed", "nightlight"]);
  });
  test("the setup view: found bridges as numbered rows, the countdown while pressing, the key once paired", () => {
    const found = [{ id: "abc", ip: "10.0.0.2", name: "Hue Bridge", via: "mdns" as const }, { id: "", ip: "10.0.0.9", via: "setting" as const }];
    const idle = checkView(renderSetup({ phase: "idle" }, found, [], 0));
    expect(idle.actions.slice(0, 2)).toMatchObject([{ id: "pair:10.0.0.2", shortcut: ["enter", "1"] }, { id: "pair:10.0.0.9", shortcut: "2", hidden: true }]);
    const press = checkView(renderSetup({ phase: "press", ip: "10.0.0.2", name: "Hue Bridge", deadline: 30_000, attempts: 3 }, found, [], 12_000));
    expect(JSON.stringify(press.tree)).toContain("18 s");
    expect(press.actions[0].id).toBe("check");
    const paired = checkView(renderSetup({ phase: "paired", ip: "10.0.0.2", name: "Hue Bridge", id: "abc", key: "k" }, found, [{ id: "abc", ip: "10.0.0.2", name: "Hue Bridge", key: "k", cert: "pem" }], 0));
    expect(paired.actions.map((a) => a.id)).toEqual(["rooms", "copy_key", "back"]);
    const typing = renderSetup({ phase: "idle" }, [], [], 0, "192.");
    expect(typing.input).toMatchObject({ value: "192.", submit: "pair:typed", cancel: "type:cancel" });
  });
});

describe("wire parsers", () => {
  test("SSE blocks: the data lines' events, comments and junk skipped", () => {
    expect(parseSse(": hi")).toEqual([]);
    expect(parseSse("id: 1:0\ndata: not json")).toEqual([]);
    const evs = parseSse('id: 1770343753:0\ndata: [{"creationtime":"2026-02-06T02:09:13Z","data":[{"id":"l1","on":{"on":false},"type":"light"}],"id":"e","type":"update"}]');
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ type: "update", data: [{ id: "l1", on: { on: false } }] });
  });
  test("mDNS: dns-sd's browse and lookup lines, avahi's resolved line", () => {
    const browse = "Browsing for _hue._tcp.local\nTimestamp     A/R    Flags  if Domain               Service Type         Instance Name\n22:29:01.467  Add        2  15 local.               _hue._tcp.           Hue Bridge - 8C0231\n";
    expect(parseMdns(browse)).toEqual([{ id: "", ip: "", name: "Hue Bridge - 8C0231", via: "mdns" }]);
    expect(parseMdnsLookup("Lookup Hue Bridge - 8C0231._hue._tcp.local\n22:29:13.723  Hue\\032Bridge\\032-\\0328C0231._hue._tcp.local. can be reached at ecb5fa8c0231.local.:443 (interface 15)\n bridgeid=ecb5fafffe8c0231 modelid=BSB002\n")).toEqual({ host: "ecb5fa8c0231.local", port: 443, id: "ecb5fafffe8c0231" });
    expect(parseMdns('=;eth0;IPv4;Hue\\032Bridge\\032-\\0328C0231;_hue._tcp;local;ecb5fa8c0231.local;192.168.1.25;443;"bridgeid=ecb5fafffe8c0231" "modelid=BSB002"\n')).toEqual([{ id: "ecb5fafffe8c0231", ip: "192.168.1.25", name: "Hue Bridge - 8C0231", port: 443, via: "mdns" }]);
  });
  test("host:port and the devicetype", () => {
    expect(hostPort("192.168.1.25")).toEqual({ host: "192.168.1.25", port: 443 });
    expect(hostPort("127.0.0.1:5432")).toEqual({ host: "127.0.0.1", port: 5432 });
    expect(devicetype("hornet.local")).toBe("pal#hornetlocal");
    expect(devicetype("")).toBe("pal#pal");
  });
});

describe("over the wire against the mock bridge", () => {
  let mock: MockBridge;
  let discovery: ReturnType<typeof discoveryServer>;
  let host: Host;
  const ran: unknown[] = [];
  beforeAll(async () => {
    mock = new MockBridge();
    discovery = discoveryServer([{ id: SAMPLE_BRIDGE_ID, ip: "127.0.0.1", port: mock.port }]);
    process.env.PAL_HUE_DISCOVERY = `http://127.0.0.1:${discovery.port}/`;
    host = await Host.bundled({ settings: { [E]: { settings: { timeout: 2, transition: 400 } } }, core: { "effects.run": ({ effect }: { effect: unknown }) => { ran.push(effect); return null; } } });
  });
  afterAll(() => { host.kill(); mock.stop(); discovery.stop(true); });

  const list = (palette: string, ctx?: Parameters<Host["list"]>[3]) => host.list(E, palette, "", ctx);
  const view = (palette: string, args?: unknown) => host.request<View>("view", { extension: E, palette, args });
  const lastPut = () => mock.puts[mock.puts.length - 1];
  /** Waits for a PUT satisfying `pred` to arrive after the current ones (a group takes its 1 s gap). */
  const untilPut = async (pred: (p: MockBridge["puts"][number]) => boolean, what = "a PUT") => { await host.until(() => mock.puts.some(pred), 2500, what); };
  const getsSince = (n: number) => mock.calls.slice(n).filter((c) => c.method === "GET" && c.path.startsWith("/clip/v2/resource"));

  test("loads with eight palettes, the bar item and the links, no warnings", async () => {
    const l = host.loaded().find((x) => x.extension === E)!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => p.name)).toEqual(["rooms", "lights", "scenes", "light", "setup", "sensors", "automations", "entertainment"]);
    expect(l.palettes.find((p) => p.name === "rooms")).toMatchObject({ live: true, tier: "primary", icon: { tile: { bg: "amber" } } });
    expect(l.palettes.find((p) => p.name === "light")).toMatchObject({ view: "view", input: true });
    expect(l.bar).toEqual([{ id: "home", title: "Home", description: expect.any(String), refresh: { every: 60, on: ["show", "wake", "network"] }, keys: expect.arrayContaining([{ keys: "x", title: "All off" }]), source: true }]);
    expect(Object.keys(l.manifest.links!)).toEqual(["toggle", "scene", "off"]);
  });

  test("nothing paired: every list palette is the setup row, the bar item is hidden, the view refuses", async () => {
    for (const p of ["rooms", "lights", "scenes", "sensors", "automations", "entertainment"]) {
      const items = await list(p);
      expect(items.map((i) => i.id)).toEqual(["setup"]);
    }
    expect(await host.render(E, "home")).toEqual({ hidden: true });
    expect(await host.pick(E, "rooms", "setup")).toEqual({ push: { extension: E, palette: "setup" } });
    await expect(view("light", { light: "light:sofa-lamp" })).rejects.toThrow(/No bridge paired/);
  });

  test("setup: discovery finds the mock (cloud), its name and id asked without a key; press-link waits, pins the certificate, keeps the key in the settings", async () => {
    const v = await view("setup");
    expect(v.title).toBe("Set up Hue");
    expect(JSON.stringify(v.tree)).toContain(mock.ip);
    expect(JSON.stringify(v.tree)).toContain(SAMPLE_BRIDGE_ID);
    expect(v.actions[0]).toMatchObject({ id: `pair:${mock.ip}`, title: "Pair with Hue Bridge" });
    expect(mock.calls.some((c) => c.path === "/api/0/config")).toBe(true);
    // Start pairing: the view says press the button and counts down; the bridge answers 101 meanwhile.
    const pressing = await host.pick(E, "setup", "setup", `pair:${mock.ip}`);
    expect(JSON.stringify(pressing.view!.tree)).toContain("Press the round button");
    await host.until(() => mock.pairAttempts >= 2, 4000, "two press-link attempts");
    expect(stored.get(`${E}\0bridges`)).toBeUndefined();
    expect(host.written.get(E)).toBeUndefined();
    // The button.
    mock.press();
    await host.until(() => Array.isArray(stored.get(`${E}\0bridges`)), 4000, "the record stored");
    // The address and the key went to the settings through `settings.set` (a separate call after the record: wait for it on a slow runner): the key to the keychain, the file gets the reference.
    await host.until(() => host.written.get(E) !== undefined, 4000, "the settings written");
    expect(host.written.get(E)).toEqual({ bridge: mock.ip, application_key: `keychain:pal/${E}-application_key` });
    expect(host.secrets.get(`pal/${E}-application_key`)).toBe(SAMPLE_KEY);
    // Storage keeps the rest of the record (the pinned certificate, the entertainment client key), never the key.
    const bridges = stored.get(`${E}\0bridges`) as { id: string; ip: string; key?: string; cert?: string; clientkey?: string }[];
    expect(bridges).toHaveLength(1);
    expect(bridges[0]).toMatchObject({ id: SAMPLE_BRIDGE_ID, ip: mock.ip, clientkey: expect.any(String) });
    expect(bridges[0].key).toBeUndefined();
    expect(bridges[0].cert).toContain("BEGIN CERTIFICATE");
    expect(bridges[0].cert!.replace(/\s/g, "")).toBe(mock.tls!.cert.replace(/\s/g, ""));
    // The panel is brought back inside the setup, which now says paired.
    await host.until(() => ran.some((e) => JSON.stringify(e).includes('"setup"')), 4000, "effects.run push");
    const after = await view("setup");
    expect(JSON.stringify(after.tree)).toContain("Paired with Hue Bridge");
    expect(await host.pick(E, "setup", "setup", "copy_key")).toMatchObject({ copy: SAMPLE_KEY });
    expect(await host.pick(E, "setup", "setup", "rooms")).toEqual({ push: { extension: E, palette: "rooms" } });
    // The devicetype the bridge saw.
    const pair = mock.calls.find((c) => c.path === "/api" && c.method === "POST")!;
    expect((pair.body as { devicetype: string }).devicetype).toMatch(/^pal#[a-z0-9-]{1,19}$/i);
    // The stream is up.
    await host.until(() => mock.streamClients >= 1, 4000, "a stream client");
  });

  test("rooms: rows with the tile, the counts and the brightness; Enter toggles the grouped light with the transition", async () => {
    const items = await list("rooms");
    expect(items.map((i) => i.id)).toEqual(["room:bedroom", "room:hallway", "room:living-room", "zone:evening"]);
    const living = items.find((i) => i.id === "room:living-room")!;
    expect(living).toMatchObject({ name: "Living room", subtitle: "Room · all 3 on · 72%", accessories: [{ text: "72%" }, { tag: "on", color: "green" }] });
    expect(living.actions!.map((a) => a.shortcut)).toContain("cmd+enter");
    const r = await host.pick(E, "rooms", "room:living-room", "toggle");
    expect(r).toMatchObject({ keep: true, hud: "Living room: off" });
    expect(lastPut()).toEqual({ type: "grouped_light", id: "gl-living", body: { on: { on: false }, dynamics: { duration: 400 } } });
    // The model took it at once; the stream confirms it.
    const again = await list("rooms");
    expect(again.find((i) => i.id === "room:living-room")!.subtitle).toBe("Room · all off");
    const n = mock.puts.length;
    expect(await host.pick(E, "rooms", "room:living-room", "on")).toMatchObject({ keep: true });
    // Inside the group's one-second gap the PUT waits; it goes out once, as the newest state.
    expect(mock.puts.length).toBe(n);
    await untilPut((p) => p.id === "gl-living" && (p.body as any).on?.on === true, "the queued group PUT");
    expect(lastPut().body).toEqual({ on: { on: true }, dynamics: { duration: 400 } });
    await Bun.sleep(200);
    expect(await host.pick(E, "rooms", "room:living-room", "open")).toEqual({ push: { extension: E, palette: "light", args: { room: "room:living-room" } } });
    expect(await host.pick(E, "rooms", "room:living-room", "scenes")).toEqual({ push: { extension: E, palette: "scenes", args: { scenes: "room:living-room" } } });
    expect(await host.pick(E, "rooms", "room:living-room", "copy_id")).toEqual({ copy: "room:living-room" });
    const d = await host.detail(E, "rooms", "room:living-room");
    expect(d.metadata!.map((m) => m.label)).toEqual(["Room", "Lights", "State", "Id"]);
  });

  test("lights: by room with sections and swatches; a room's lights through args; toggle, identify, copy", async () => {
    const items = await list("lights");
    expect(items.map((i) => i.section)).toEqual(["Bedroom", "Bedroom", "Hallway", "Living room", "Living room", "Living room"]);
    const sofa = items.find((i) => i.id === "light:sofa-lamp")!;
    expect(sofa.subtitle).toBe("Living room · Table shade · 2732 K");
    expect(sofa.icon).toMatch(/^#/);
    expect(items.find((i) => i.id === "light:wardrobe")!.icon).toBe("\u{f0336}");
    const only = await list("lights", { args: { lights: "room:bedroom" } });
    expect(only.map((i) => i.id)).toEqual(["light:bedside", "light:wardrobe"]);
    expect(await host.pick(E, "lights", "light:bedside", "toggle")).toMatchObject({ hud: "Bedside: on" });
    expect(lastPut()).toEqual({ type: "light", id: "light-4", body: { on: { on: true }, dynamics: { duration: 400 } } });
    expect(await host.pick(E, "lights", "light:bedside", "identify")).toMatchObject({ toast: { title: "Bedside is blinking" } });
    expect(lastPut().body).toEqual({ alert: { action: "breathe" } });
    expect(await host.pick(E, "lights", "light:tv-strip", "copy_hex")).toEqual({ copy: expect.stringMatching(/^#[0-3][0-9a-f]00ff$/) });
    const d = await host.detail(E, "lights", "light:sofa-lamp");
    expect(d.metadata!.find((m) => m.label === "Temperature")!.value).toBe("2732 K (366 mirek)");
    expect(d.metadata!.find((m) => m.label === "Effects")!.value).toBe("candle, fire, sparkle");
  });

  test("scenes: strips, tags, a room's through args; Enter recalls with the transition, cmd+Enter dynamically, a smart scene activates", async () => {
    const items = await list("scenes");
    expect(items.map((i) => i.section)).toEqual(["Bedroom", "Bedroom", "Living room", "Living room", "Living room", "Living room", "Living room"]);
    const savanna = items.find((i) => i.id === "scene:living-room/savanna-sunset")!;
    expect((savanna.icon as { image: string }).image).toContain("svg");
    expect(savanna.accessories).toEqual([{ tag: "dynamic", color: "violet" }]);
    expect(items.find((i) => i.id === "scene:living-room/relax")!.accessories).toEqual([{ tag: "active", color: "green" }]);
    expect((await list("scenes", { args: { scenes: "room:bedroom" } })).map((i) => i.id)).toEqual(["scene:bedroom/bright", "scene:bedroom/nightlight"]);
    expect(await host.pick(E, "scenes", "scene:living-room/savanna-sunset", "activate")).toMatchObject({ keep: true, hud: "Savanna sunset in Living room" });
    expect(lastPut()).toEqual({ type: "scene", id: "scene-savanna", body: { recall: { action: "active", duration: 400 } } });
    expect(await host.pick(E, "scenes", "scene:living-room/savanna-sunset", "dynamic")).toMatchObject({ hud: "Savanna sunset: playing" });
    expect(lastPut().body).toEqual({ recall: { action: "dynamic_palette", duration: 400 } });
    // The recall set the lights: the stream told the model.
    await host.until(() => mock.puts.length >= 1 && (mock.find("light-1") as any).color.xy.x === 0.5451, 2000, "the scene applied on the mock");
    await Bun.sleep(150);
    const lights = await list("lights");
    expect((lights.find((i) => i.id === "light:sofa-lamp") as any).brightness).toBe(100);
    expect(await host.pick(E, "scenes", "smart:living-room/natural-light", "activate")).toMatchObject({ hud: "Natural light: activated" });
    expect(lastPut()).toEqual({ type: "smart_scene", id: "smart-natural", body: { recall: { action: "activate" } } });
  });

  test("the light view: every key is one PUT, coalesced per resource; the tree follows; presets, colour, effects, scope, transition", async () => {
    const v = await view("light", { light: "light:ceiling" });
    expect(v).toMatchObject({ title: "Ceiling", id: "light:ceiling" });
    expect(JSON.stringify(v.tree)).not.toContain('"key":"plane"');
    const pick = (action: string) => host.pick(E, "light", "light:ceiling", action);
    let r = await pick("bri-");
    expect(lastPut()).toEqual({ type: "light", id: "light-2", body: { on: { on: true }, dimming: { brightness: 95 }, dynamics: { duration: 400 } } });
    expect(JSON.stringify(r.view!.tree)).toContain("95%");
    // A second key inside the 100 ms gap is queued and sent once, as the newest state.
    const n = mock.puts.length;
    await pick("bri-");
    await pick("bri--");
    expect(mock.puts.length).toBe(n);
    await host.until(() => mock.puts.length === n + 1, 1000, "the coalesced PUT");
    expect(lastPut().body).toMatchObject({ dimming: { brightness: 70 } });
    await Bun.sleep(150);
    r = await pick("level:5");
    expect(lastPut().body).toMatchObject({ dimming: { brightness: 50 } });
    await Bun.sleep(150);
    r = await pick("level:0");
    expect(lastPut().body).toEqual({ on: { on: false }, dynamics: { duration: 400 } });
    expect(JSON.stringify(r.view!.tree)).toContain('"text":"Off"');
    await Bun.sleep(150);
    const mirek = mock.find("light-2")!.color_temperature.mirek as number;
    r = await pick("ct+");
    expect(lastPut().body).toEqual({ on: { on: true }, color_temperature: { mirek: mirek - 20 }, dynamics: { duration: 400 } });
    await Bun.sleep(150);
    await pick("ct--");
    expect(lastPut().body.color_temperature).toEqual({ mirek: mirek + 60 });
    // A preset.
    r = await pick("focus:next"); // colour: a white-ambiance bulb has no plane, the row is skipped in the tree but the focus still walks
    r = await pick("focus:next"); // presets
    expect(r.view!.actions[0]).toMatchObject({ id: "apply", title: "Apply Relax" });
    await pick("along:next");
    await Bun.sleep(150);
    r = await pick("apply");
    expect(lastPut().body).toEqual({ on: { on: true }, dimming: { brightness: 100 }, color_temperature: { mirek: 346 }, dynamics: { duration: 400 } });
    // Transition cycles; the next PUT carries it.
    r = await pick("duration");
    expect(JSON.stringify(r.view!.tree)).toContain('"text":"1 s"');
    await Bun.sleep(150);
    await pick("apply");
    expect(lastPut().body.dynamics).toEqual({ duration: 1000 });
    r = await pick("duration");
    r = await pick("duration");
    expect(JSON.stringify(r.view!.tree)).toContain('"text":"instant"');
    await Bun.sleep(150);
    await pick("apply");
    expect(lastPut().body.dynamics).toBeUndefined();
    expect(await pick("copy")).toMatchObject({ copy: expect.stringMatching(/^#/) });
    expect(await pick("scenes")).toEqual({ push: { extension: E, palette: "scenes", args: { scenes: "room:living-room" } } });
  });

  test("a colour light: hue and saturation move on the plane inside the gamut; the scope sends to the room; effects per light", async () => {
    const v = await view("light", { light: "light:sofa-lamp" });
    expect(JSON.stringify(v.tree)).toContain('"key":"plane"');
    const pick = (action: string) => host.pick(E, "light", "light:sofa-lamp", action);
    await pick("focus:next");
    let r = await pick("hue+");
    const put = lastPut();
    expect(put.type).toBe("light");
    const xy = (put.body as { color: { xy: { x: number; y: number } } }).color.xy;
    expect(inGamut(xy, GAMUTS.C)).toBe(true);
    expect(JSON.stringify(r.view!.tree)).toContain('"key":"plane"');
    await Bun.sleep(150);
    await pick("sat--");
    expect((lastPut().body as any).color.xy.y).not.toBe(xy.y);
    // Scope: the room's grouped light takes the next change.
    r = await pick("scope");
    expect(JSON.stringify(r.view!.tree)).toContain("room · Living room");
    await Bun.sleep(150);
    await pick("level:3");
    await untilPut((p) => p.id === "gl-living" && (p.body as any).dimming?.brightness === 30, "the room's PUT");
    expect(lastPut()).toEqual({ type: "grouped_light", id: "gl-living", body: { on: { on: true }, dimming: { brightness: 30 }, dynamics: { duration: 400 } } });
    await pick("scope");
    // Effects: the row lists what the light supports, none first; apply sends the effect.
    await pick("focus:next"); await pick("focus:next"); await pick("focus:next");
    r = await pick("along:next");
    expect(r.view!.actions[0]).toMatchObject({ id: "apply", title: "Set the effect" });
    await Bun.sleep(1100);
    await pick("apply");
    expect(lastPut()).toEqual({ type: "light", id: "light-1", body: { on: { on: true }, effects: { effect: "candle" } } });
    await Bun.sleep(150);
    await pick("along:prev");
    await pick("apply");
    expect(lastPut().body).toEqual({ effects: { effect: "no_effect" } });
    expect(await pick("identify")).toMatchObject({ view: expect.anything() });
    expect(await pick("room")).toEqual({ push: { extension: E, palette: "light", args: { room: "room:living-room" } } });
  });

  test("a room view: the aggregate, the scenes row plays a scene, a digit dims the grouped light", async () => {
    const v = await view("light", { room: "room:bedroom" });
    expect(v.title).toBe("Bedroom");
    expect(JSON.stringify(v.tree)).toContain('"key":"scene:bedroom/nightlight"');
    const pick = (action: string) => host.pick(E, "light", "room:bedroom", action);
    await pick("level:8");
    await untilPut((p) => p.id === "gl-bedroom" && (p.body as any).dimming?.brightness === 80, "the room's PUT");
    expect(lastPut()).toEqual({ type: "grouped_light", id: "gl-bedroom", body: { on: { on: true }, dimming: { brightness: 80 }, dynamics: { duration: 400 } } });
    await pick("focus:next"); await pick("focus:next");
    const r = await pick("focus:next");
    expect(r.view!.actions[0]).toMatchObject({ id: "apply", title: "Play Bright" });
    await pick("apply");
    expect(lastPut()).toEqual({ type: "scene", id: "scene-bright", body: { recall: { action: "active", duration: 400 } } });
  });

  test("the event stream: a change made elsewhere reaches the rows and the view without a request", async () => {
    const before = mock.calls.length;
    mock.change("light-6", { on: { on: false } });
    mock.change("motion-1", { motion: { motion: false, motion_report: { changed: "2026-09-16T20:30:00Z", motion: false } } });
    await Bun.sleep(300);
    const lights = await list("lights");
    expect(lights.find((i) => i.id === "light:hall-spot")!.accessories).toEqual([{ tag: "off", color: "grey" }]);
    const sensors = await list("sensors");
    expect(sensors.find((i) => i.id === "sensor:hallway-sensor-motion")!.subtitle).toBe("clear");
    const v = await view("light", { light: "light:hall-spot" });
    expect(JSON.stringify(v.tree)).toContain('"text":"Off"');
    expect(getsSince(before)).toEqual([]);
    // A bar push followed the change.
    const pushed = host.updates(E, "home");
    expect(pushed.length).toBeGreaterThan(0);
    const on = mock.resources.filter((r) => r.type === "light" && (r as any).on.on).length;
    expect(pushed[pushed.length - 1].title).toBe(`${on} on`);
  });

  test("an open light view follows the stream: a change pushes its tree again by the target's id; a closed one gets nothing", async () => {
    host.viewShown(E, { palette: "light" }, "light:hall-spot");
    mock.change("light-6", { on: { on: true }, dimming: { brightness: 25 } });
    const u = await host.nextViewUpdate(E, { palette: "light" }, (x) => x.id === "light:hall-spot" && JSON.stringify(x.spec).includes('"25%"'));
    expect(u).toMatchObject({ extension: E, palette: "light", id: "light:hall-spot", spec: { id: "light:hall-spot", keys: "actions" } });
    expect(JSON.stringify(u.spec.tree)).toContain('"text":"on","color":"green"');
    // A change to another light pushes this view too (a room's aggregate may depend on it), from the model, with no GET.
    const before = mock.calls.length;
    host.viewHidden(E, { palette: "light" }, "light:hall-spot");
    const n = host.viewUpdates(E, { palette: "light" }).length;
    mock.change("light-6", { on: { on: false } });
    await Bun.sleep(300);
    expect(host.viewUpdates(E, { palette: "light" }).length).toBe(n);
    expect(getsSince(before)).toEqual([]);
  });

  test("sensors, automations, entertainment: the rows and what each Enter does", async () => {
    const sensors = await list("sensors");
    expect(sensors.map((i) => i.section)).toEqual(["Bedroom dimmer", "Bedroom dimmer", "Bedroom dimmer", "Bedroom dimmer", "Hallway sensor", "Hallway sensor", "Hallway sensor", "Kitchen dial"]);
    expect(sensors.find((i) => i.id === "sensor:bedroom-dimmer-button-1")!.accessories).toEqual([{ tag: "12%", color: "red" }, { date: "2026-09-16T18:40:03Z" }]);
    // The battery is the device's: on its first row only.
    expect(sensors.find((i) => i.id === "sensor:bedroom-dimmer-button-2")!.accessories).toEqual([]);
    expect(await host.pick(E, "sensors", "sensor:hallway-sensor-temperature", "copy_value")).toEqual({ copy: "22.4 °C" });
    expect(await host.pick(E, "sensors", "sensor:hallway-sensor-motion", "toggle_enabled")).toMatchObject({ hud: "Hallway sensor · motion: disabled" });
    expect(lastPut()).toEqual({ type: "motion", id: "motion-1", body: { enabled: false } });
    const autos = await list("automations");
    expect(autos.map((i) => i.name)).toEqual(["Hallway motion", "Weekday wake up"]);
    expect(autos[1].accessories).toEqual([{ tag: "running", color: "green" }]);
    expect(await host.pick(E, "automations", "auto:hallway-motion", "toggle_enabled")).toMatchObject({ hud: "Hallway motion: enabled" });
    expect(lastPut()).toEqual({ type: "behavior_instance", id: "auto-hall", body: { enabled: true } });
    const ent = await list("entertainment");
    expect(ent[0]).toMatchObject({ name: "TV area", subtitle: "screen · 2 lights", accessories: [{ tag: "idle", color: "grey" }] });
    expect(await host.pick(E, "entertainment", "ent:tv-area", "start")).toMatchObject({ hud: "TV area: streaming" });
    expect(lastPut()).toEqual({ type: "entertainment_configuration", id: "ent-tv", body: { action: "start" } });
    expect((await list("entertainment"))[0].accessories).toEqual([{ tag: "streaming", color: "green" }]);
    expect(await host.pick(E, "entertainment", "ent:tv-area", "stop")).toMatchObject({ hud: "TV area: stopped" });
  });

  test("the bar item: the count, the main room's dot as a PNG, the popover as a view: the rooms as tiles with switches, the sensors, the scenes, the keys; a toggle, the arrows, a room opened, a slider tap, All off", async () => {
    const item = await host.render(E, "home");
    expect(item.title).toMatch(/^\d+ on$/);
    expect((item.icon as { image: string }).image).toMatch(/^data:image\/png;base64,/);
    const view = (item.menu as { view: View }).view;
    expect(checkView(view)).toBe(view);
    expect(view).toMatchObject({ id: "home", keys: "actions", title: "Hue Bridge" });
    const json = JSON.stringify(view.tree);
    // The rooms as tiles: a lit one in its colour with a switch that toggles it, an off one a plain card; the status row's sensors; the main room's scenes with their digits.
    for (const r of ["bedroom", "hallway", "living-room", "evening"]) expect(json).toContain(`"key":"room-${r}"`);
    // A room's tile carries a switch with its state and toggles it; a lit room is in its colour, one with no light on a plain card (the tests before left the hallway's light off).
    const hallOn = /"type":"switch","key":"sw","on":(true|false),"action":"toggle:room:hallway"/.exec(json)![1] === "true";
    expect(json).toMatch(/"key":"room-hallway","surface":"elevated"/);
    expect(json).toMatch(/"key":"room-bedroom","surface":"#[0-9a-f]{6}"/);
    expect(json).toContain('"type":"switch","key":"sw","on":true,"action":"toggle:room:bedroom"');
    expect(json).toMatch(/"text":"Hallway: (motion|clear)","color":"(green|grey)"/);
    expect(json).toContain('"text":"22.4°"');
    expect(json).toContain('"key":"scene-living-room/relax"');
    expect(view.actions.find((a) => a.id === "scene:scene:living-room/relax")).toMatchObject({ shortcut: "2", hidden: true });
    expect(view.actions[0]).toMatchObject({ id: "enter", title: "Open Bedroom" });
    expect(view.actions.find((a) => a.id === "all_off")).toMatchObject({ shortcut: ["x", "cmd+shift+o"], style: "destructive" });
    // A tap on a room's tile: one PUT on its grouped light, the tree answered with the cursor on it.
    const ctx = { reason: "open" as const, compact: true as const };
    let r = await host.barAction(E, "home", "toggle:room:hallway", ctx);
    expect(lastPut()).toEqual({ type: "grouped_light", id: "gl-hall", body: { on: { on: !hallOn }, dynamics: { duration: 400 } } });
    expect(JSON.stringify(r.view!.tree)).toContain(`"type":"switch","key":"sw","on":${!hallOn},"action":"toggle:room:hallway"`);
    expect(r.view!.actions[0].title).toBe("Open Hallway");
    // The arrows walk the grid two a row; Enter opens the room: its lights inline with a slider each, the keys on the first light.
    await Bun.sleep(1100);
    r = await host.barAction(E, "home", "move:down", ctx);
    expect(r.view!.actions[0].title).toBe("Open Evening");
    r = await host.barAction(E, "home", "move:left", ctx);
    expect(r.view!.actions[0].title).toBe("Open Living room");
    r = await host.barAction(E, "home", "enter", ctx);
    let tree = JSON.stringify(r.view!.tree);
    expect(tree).toContain('"key":"open-living-room"');
    expect(tree).toMatch(/"type":"slider","key":"level","value":[0-9.]+,"width":132,"color":"(#[0-9a-f]{6}|grey)","action":"level:light:sofa-lamp"/);
    expect(tree).toContain('"key":"light-sofa-lamp"');
    expect(r.view!.actions[0]).toMatchObject({ id: "enter", title: expect.stringMatching(/^Turn (on|off) Ceiling$/), shortcut: ["enter", "space"] });
    // The right arrow brightens the focused light by five; a tap on a slider sets the level the fraction says; Enter toggles it.
    r = await host.barAction(E, "home", "bri+", ctx);
    expect(lastPut()).toEqual({ type: "light", id: "light-2", body: { on: { on: true }, dimming: { brightness: expect.any(Number) }, dynamics: { duration: 400 } } });
    r = await host.barAction(E, "home", "level:light:sofa-lamp", { ...ctx, values: { value: "0.500" } });
    expect(lastPut()).toEqual({ type: "light", id: "light-1", body: { on: { on: true }, dimming: { brightness: 50 }, dynamics: { duration: 400 } } });
    expect(JSON.stringify(r.view!.tree)).toContain('"key":"level","value":0.5');
    expect(r.view!.actions[0].title).toBe("Turn off Sofa lamp");
    // Past the light's gap, so the toggle is its own PUT rather than folded into the one in flight.
    await Bun.sleep(250);
    r = await host.barAction(E, "home", "enter", ctx);
    expect(lastPut()).toEqual({ type: "light", id: "light-1", body: { on: { on: false }, dynamics: { duration: 400 } } });
    expect(JSON.stringify(r.view!.tree)).toContain('"type":"switch","key":"on","on":false,"action":"toggle:light:sofa-lamp"');
    // Backspace closes the room; a scene digit plays it.
    r = await host.barAction(E, "home", "back", ctx);
    expect(JSON.stringify(r.view!.tree)).not.toContain('"key":"open-living-room"');
    r = await host.barAction(E, "home", "scene:scene:living-room/read", ctx);
    expect(lastPut()).toMatchObject({ type: "scene", body: { recall: { action: "active" } } });
    expect(r.view).toBeTruthy();
    // All off sends to every lit room; the strip follows.
    await Bun.sleep(1100);
    const n = mock.puts.length;
    r = await host.barAction(E, "home", "all_off", ctx);
    expect(r.view!.actions[0].title).toBe("Open Living room");
    const offs = mock.puts.slice(n);
    expect(offs.every((p) => (p.body as any).on?.on === false)).toBe(true);
    expect(offs.map((p) => p.id).sort()).toEqual(expect.arrayContaining(["gl-living"]));
    expect(JSON.stringify(r.view!.tree)).toContain('"value":"All lights off"');
    await Bun.sleep(1200);
    expect((await host.render(E, "home")).title).toBeUndefined();
    // Everything on brings every room back; Open in pal pushes the rooms palette.
    r = await host.barAction(E, "home", "all_on", ctx);
    expect(mock.puts.slice(-1)[0].body).toMatchObject({ on: { on: true } });
    await Bun.sleep(1200);
    expect((await host.render(E, "home")).title).toMatch(/^\d+ on$/);
    expect(await host.barAction(E, "home", "open", ctx)).toEqual({ push: { extension: E, palette: "rooms" } });
    // Off again, so the links test finds the living room off.
    await host.barAction(E, "home", "all_off", ctx);
    await Bun.sleep(1200);
    // The main room setting picks the dot and the scenes the popover offers.
    host.changeSettings(E, { settings: { timeout: 2, transition: 400, main_room: "Bedroom", bar_scenes: ["Relax", "scene:bedroom/bright"] } });
    await host.until(() => host.updates(E, "home").length > 0 && true, 3000, "a render after the change");
    await Bun.sleep(400);
    const again = (await host.render(E, "home")).menu as { view: View };
    expect(again.view.actions.filter((a) => a.id.startsWith("scene:")).map((a) => a.title)).toEqual(["Play Bright", "Play Relax"]);
  }, 15000);

  test("links: toggle a room by name, play a scene, everything off; unknown names throw", async () => {
    const n = mock.puts.length;
    expect(await host.request<Effect>("link", { extension: E, route: "toggle", params: { room: "living room" } })).toEqual({ hud: "Living room: on" });
    await untilPut((p) => p.id === "gl-living" && (p.body as any).on?.on === true && mock.puts.indexOf(p) >= n, "the link's PUT");
    expect(lastPut()).toEqual({ type: "grouped_light", id: "gl-living", body: { on: { on: true }, dynamics: { duration: 400 } } });
    expect(await host.request<Effect>("link", { extension: E, route: "toggle", params: { room: "hallway", on: false } })).toEqual({ hud: "Hallway: off" });
    expect(await host.request<Effect>("link", { extension: E, route: "scene", params: { name: "relax", room: "living-room" } })).toEqual({ hud: "Relax in Living room" });
    expect(lastPut()).toEqual({ type: "scene", id: "scene-relax", body: { recall: { action: "active", duration: 400 } } });
    expect(await host.request<Effect>("link", { extension: E, route: "scene", params: { name: "Savanna sunset", dynamic: true } })).toEqual({ hud: "Savanna sunset in Living room" });
    expect(lastPut().body).toEqual({ recall: { action: "dynamic_palette", duration: 400 } });
    await Bun.sleep(1100);
    expect(await host.request<Effect>("link", { extension: E, route: "off", params: {} })).toEqual({ hud: "All lights off" });
    await expect(host.request<Effect>("link", { extension: E, route: "toggle", params: { room: "attic" } })).rejects.toThrow(/no room "attic"/);
    await expect(host.request<Effect>("link", { extension: E, route: "scene", params: { name: "disco" } })).rejects.toThrow(/no scene "disco"/);
  });

  test("forget: the bridge leaves storage and the settings, the streams close, the rows are the setup row again", async () => {
    const v = await host.pick(E, "setup", "setup", "back");
    expect(v.view).toBeDefined();
    await host.pick(E, "setup", "setup", "forget");
    expect(stored.get(`${E}\0bridges`)).toEqual([]);
    expect(host.written.get(E)).toEqual({});
    expect((await list("rooms")).map((i) => i.id)).toEqual(["setup"]);
    await host.until(() => mock.streamClients === 0, 4000, "the stream closed");
  });
});

describe("a bridge from the settings, and one that rejects the key", () => {
  test("bridge + application_key list the home without pairing; a wrong key is one hint row naming the fix; a bad certificate too", async () => {
    const good = new MockBridge();
    const disc = discoveryServer([]);
    process.env.PAL_HUE_DISCOVERY = `http://127.0.0.1:${disc.port}/`;
    const h = await Host.bundled({ settings: { [E]: { settings: { bridge: good.ip, application_key: SAMPLE_KEY, insecure: true, timeout: 2 } } } });
    try {
      const rooms = await h.list(E, "rooms");
      expect(rooms.map((i) => i.id)).toEqual(["room:bedroom", "room:hallway", "room:living-room", "zone:evening"]);
      expect(rooms[0].subtitle).not.toContain("·  Hue");
      // The key never went to storage.
      expect(h.coreCalls.filter((c) => c.method === "storage.set")).toEqual([]);
      const setup = await h.request<View>("view", { extension: E, palette: "setup" });
      expect(JSON.stringify(setup.tree)).toContain("from the settings");
      // A wrong key.
      h.changeSettings(E, { settings: { bridge: good.ip, application_key: "nope", insecure: true, timeout: 2 } });
      await Bun.sleep(300);
      const hint = await h.list(E, "rooms");
      expect(hint[0]).toMatchObject({ id: "hint", name: "The bridge rejected the application key", actions: [] });
      expect(hint[0].subtitle).toContain("Set up Hue");
      expect(await h.render(E, "home")).toMatchObject({ stale: true });
      // The certificate: with the check on, a self-signed bridge that was never pinned is refused, and the row says so.
      h.changeSettings(E, { settings: { bridge: good.ip, application_key: SAMPLE_KEY, insecure: false, timeout: 2 } });
      await Bun.sleep(300);
      const refused = await h.list(E, "rooms");
      expect(refused[0].name).toContain("certificate");
      expect(refused[0].subtitle).toContain("insecure = true");
    } finally {
      h.kill();
      good.stop();
      disc.stop(true);
    }
  });
  test("a bridge that is not there: the hint says it did not answer, within the timeout", async () => {
    const h = await Host.bundled({ settings: { [E]: { settings: { bridge: "127.0.0.1:1", application_key: "k", insecure: true, timeout: 1 } } } });
    try {
      const t0 = Date.now();
      const rows = await h.list(E, "lights");
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(rows[0]).toMatchObject({ id: "hint", name: expect.stringMatching(/Could not reach|did not answer/) });
    } finally {
      h.kill();
    }
  });
});
