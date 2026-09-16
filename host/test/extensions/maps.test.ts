// maps: the grammar and the urls first (maps.ts, pure), then the palette
// over the wire: the rows for nothing typed, a place, a route, the
// travel-mode filter, the inline ask, the picks (every url form, the
// copies, the other app), and the Places API (New) autocomplete against a
// Bun mock (`PAL_MAPS_PLACES`).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parsePredictions } from "../../../extensions/maps/index.ts";
import { directionsUrl, matches, parse, parsePlaces, resolveEnd, searchUrl, webUrl } from "../../../extensions/maps/maps.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Item } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";

describe("maps.ts", () => {
  test("parse: the prefix stripped, a route split on > or ->, on `to` only with a known end; a lone end or a bare `to` is text", () => {
    expect(parse("go: coffee")).toEqual({ text: "coffee", prefixed: true });
    expect(parse("Maps:home > work")).toEqual({ text: "home > work", from: "home", to: "work", prefixed: true });
    expect(parse("here -> Kadıköy")).toEqual({ text: "here -> Kadıköy", from: "here", to: "Kadıköy", prefixed: false });
    expect(parse("home to ankara")).toEqual({ text: "home to ankara", from: "home", to: "ankara", prefixed: false });
    expect(parse("istanbul to Gym", ["Gym"])).toEqual({ text: "istanbul to Gym", from: "istanbul", to: "Gym", prefixed: false });
    expect(parse("istanbul to ankara")).toEqual({ text: "istanbul to ankara", prefixed: false });
    expect(parse("things to do in Moda")).toEqual({ text: "things to do in Moda", prefixed: false });
    expect(parse("tomato")).toEqual({ text: "tomato", prefixed: false });
    expect(parse("> work")).toEqual({ text: "> work", prefixed: false });
    expect(parse("  go:  ")).toEqual({ text: "", prefixed: true });
    expect(matches("go: coffee")).toBe(true);
    expect(matches("maps: home > work")).toBe(true);
    expect(matches("go:")).toBe(false);
    expect(matches("coffee")).toBe(false);
    expect(matches("gorilla: yes")).toBe(false);
  });

  test("parsePlaces reads Name = address, a bare line as both; resolveEnd maps home, work and here", () => {
    expect(parsePlaces(["Gym = Kadıköy Sports Hall", "Moda Sahili", " = ", "Cafe=  Karaköy, İstanbul "])).toEqual([{ name: "Gym", address: "Kadıköy Sports Hall" }, { name: "Moda Sahili", address: "Moda Sahili" }, { name: "Cafe", address: "Karaköy, İstanbul" }]);
    expect(parsePlaces(undefined)).toEqual([]);
    const s = { home: "Moda", work: "Levent" };
    expect(resolveEnd("home", s)).toBe("Moda");
    expect(resolveEnd("Work", s)).toBe("Levent");
    expect(resolveEnd("here", s)).toBeUndefined();
    expect(resolveEnd("home", { home: "" })).toBe("home");
    expect(resolveEnd("Taksim", s)).toBe("Taksim");
  });

  test("urls: Google search and directions with the api=1 forms, Apple's maps:// with dirflg, a place id pinned, Copy link never a maps:// url", () => {
    expect(searchUrl("coffee near me", "google")).toBe("https://www.google.com/maps/search/?api=1&query=coffee%20near%20me");
    expect(searchUrl("x", "google", "ChIJ1")).toBe("https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJ1");
    expect(searchUrl("coffee", "apple")).toBe("maps://?q=coffee");
    expect(directionsUrl("Levent", "Moda", "transit", "google")).toBe("https://www.google.com/maps/dir/?api=1&destination=Levent&origin=Moda&travelmode=transit");
    expect(directionsUrl("Levent", undefined, "cycling", "google")).toBe("https://www.google.com/maps/dir/?api=1&destination=Levent&travelmode=bicycling");
    expect(directionsUrl("Levent", "Moda", "walking", "apple")).toBe("maps://?daddr=Levent&saddr=Moda&dirflg=w");
    expect(directionsUrl("Levent", undefined, "driving", "apple")).toBe("maps://?daddr=Levent&dirflg=d");
    expect(webUrl("maps://?q=coffee")).toBe("https://maps.apple.com/?q=coffee");
    expect(webUrl("https://www.google.com/maps/search/?api=1&query=x")).toBe("https://www.google.com/maps/search/?api=1&query=x");
  });

  test("parsePredictions reads Places API (New) suggestions", () => {
    expect(parsePredictions({ suggestions: [{ placePrediction: { placeId: "ChIJa", text: { text: "Kadıköy, İstanbul, Türkiye" }, structuredFormat: { mainText: { text: "Kadıköy" }, secondaryText: { text: "İstanbul, Türkiye" } } } }, { queryPrediction: { text: { text: "x" } } }] }))
      .toEqual([{ placeId: "ChIJa", text: "Kadıköy, İstanbul, Türkiye", main: "Kadıköy", secondary: "İstanbul, Türkiye" }]);
    expect(parsePredictions({})).toEqual([]);
  });
});

// ---- the palette over the wire ------------------------------------------------------

const seen: { input: string; key: string }[] = [];
const places = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/v1/places:autocomplete" || req.method !== "POST") return new Response("no", { status: 404 });
    const key = req.headers.get("x-goog-api-key") ?? "";
    const { input } = (await req.json()) as { input: string };
    seen.push({ input, key });
    if (key !== "good") return Response.json({ error: { code: 403, message: "denied" } }, { status: 403 });
    return Response.json({ suggestions: [
      { placePrediction: { place: "places/ChIJk", placeId: "ChIJk", text: { text: `${input} Sahili, İstanbul, Türkiye` }, structuredFormat: { mainText: { text: `${input} Sahili` }, secondaryText: { text: "İstanbul, Türkiye" } } } },
      { placePrediction: { place: "places/ChIJm", placeId: "ChIJm", text: { text: `${input} Moda Park` }, structuredFormat: { mainText: { text: `${input} Moda Park` }, secondaryText: { text: "Kadıköy" } } } },
    ] });
  },
});

const SETTINGS = { home: "Moda, Kadıköy, İstanbul", work: "Levent, İstanbul", places: ["Gym = Kadıköy Sports Hall", "Airport = IST Airport"] };
let host: Host;
beforeAll(async () => {
  process.env.PAL_MAPS_PLACES = `http://127.0.0.1:${places.port}`;
  host = await Host.bundled({ settings: { maps: { settings: SETTINGS } } });
});
afterAll(() => { host.kill(); places.stop(true); delete process.env.PAL_MAPS_PLACES; });

const list = (q?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("maps", "maps", q, ctx);
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("maps", "maps", id, action, ctx);
const names = (items: Item[]) => items.map((i) => i.name);
const ids = (items: Item[]) => items.map((i) => i.id);

describe("maps", () => {
  test("meta: an input palette on the green tile, inline with a match, the four travel modes as filters", () => {
    const l = host.loaded().find((l) => l.extension === "maps")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ title: "Maps", input: true, inline: true, icon: tile("green", "\u{f05f5}"), filters: [{ id: "driving", title: "Driving" }, { id: "transit", title: "Transit" }, { id: "walking", title: "Walking" }, { id: "cycling", title: "Cycling" }] });
    expect(l.palettes[0].match).toBe("^\\s*(?:maps?|go)\\s*:\\s*\\S");
  });

  test("nothing typed: Home, Work, the commute both ways, the saved places; without any of them, hints", async () => {
    const items = await list("");
    expect(ids(items)).toEqual(["home", "work", "commute", "commute-back", "place:Gym", "place:Airport"]);
    expect(items[0]).toMatchObject({ name: "Home", subtitle: SETTINGS.home, keywords: ["home"] });
    expect(items[0].actions!.map((a) => a.id)).toEqual(["open", "directions", "from_home", "from_work", "copy_address", "copy_link", "other"]);
    expect(items[2]).toMatchObject({ name: `${SETTINGS.home} → ${SETTINGS.work}`, subtitle: "driving · Google Maps" });
    expect(items[4]).toMatchObject({ name: "Gym", subtitle: "Kadıköy Sports Hall" });
    host.changeSettings("maps", { settings: {} });
    expect(ids(await list(""))).toEqual(["hint:setup", "hint:root"]);
    host.changeSettings("maps", { settings: SETTINGS });
  });

  test("a place typed: Search, directions from here, from home, from work, and the saved places that match by name or address", async () => {
    const items = await list("kadıköy");
    expect(ids(items)).toEqual(["search", "to", "from-home", "from-work", "home", "place:Gym"]);
    expect(items[0]).toMatchObject({ name: "Search kadıköy", subtitle: "Google Maps" });
    expect(items[1]).toMatchObject({ name: "Directions from here", subtitle: "current location → kadıköy · driving · Google Maps" });
    expect(items[2]).toMatchObject({ name: "Directions from home", subtitle: `${SETTINGS.home} → kadıköy · driving · Google Maps` });
    expect(ids(await list("airport"))).toEqual(["search", "to", "from-home", "from-work", "place:Airport"]);
  });

  test("a route: both ends resolved (home, work, here), the reverse as the second row; the filter is the mode", async () => {
    let items = await list("home > work", { filter: "walking" });
    expect(ids(items)).toEqual(["route", "route-back"]);
    expect(items[0]).toMatchObject({ name: `${SETTINGS.home} → ${SETTINGS.work}`, subtitle: "walking · Google Maps" });
    expect(items[1].name).toBe(`${SETTINGS.work} → ${SETTINGS.home}`);
    expect((await pick("route", undefined, { filter: "walking" })).open).toBe(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(SETTINGS.work)}&origin=${encodeURIComponent(SETTINGS.home)}&travelmode=walking`);
    items = await list("here -> Taksim");
    expect(ids(items)).toEqual(["route"]);
    expect(items[0].name).toBe("current location → Taksim");
    expect((await pick("route", undefined, { filter: "transit" })).open).toBe("https://www.google.com/maps/dir/?api=1&destination=Taksim&travelmode=transit");
    expect(ids(await list("moda > here"))).toEqual(["hint:to"]);
  });

  test("picks on a place: open is the search, directions from here / home / work, the address and the web link copied, the other app", async () => {
    await list("kadıköy");
    expect(await pick("search")).toEqual({ open: "https://www.google.com/maps/search/?api=1&query=kad%C4%B1k%C3%B6y" });
    expect((await pick("search", "directions", { filter: "cycling" })).open).toBe("https://www.google.com/maps/dir/?api=1&destination=kad%C4%B1k%C3%B6y&travelmode=bicycling");
    expect((await pick("place:Gym", "from_home")).open).toBe(`https://www.google.com/maps/dir/?api=1&destination=Kad%C4%B1k%C3%B6y%20Sports%20Hall&origin=${encodeURIComponent(SETTINGS.home)}&travelmode=driving`);
    expect((await pick("place:Gym", "from_work")).open).toContain(`origin=${encodeURIComponent(SETTINGS.work)}`);
    expect(await pick("place:Gym", "copy_address")).toEqual({ copy: "Kadıköy Sports Hall" });
    expect(await pick("place:Gym", "copy_link")).toEqual({ copy: "https://www.google.com/maps/search/?api=1&query=Kad%C4%B1k%C3%B6y%20Sports%20Hall" });
    expect(await pick("place:Gym", "other")).toEqual({ open: "maps://?q=Kad%C4%B1k%C3%B6y%20Sports%20Hall" });
    expect(await pick("to", "copy_address")).toEqual({ copy: "kadıköy" });
    expect(await pick("nope")).toMatchObject({ keep: true, toast: { style: "failure" } });
  });

  test("Apple Maps as the app: maps:// urls open, the other app is Google, Copy link is the web form", async () => {
    host.changeSettings("maps", { settings: { ...SETTINGS, app: "apple" } });
    const items = await list("coffee");
    expect(items[1].subtitle).toBe("current location → coffee · driving · Apple Maps");
    expect(await pick("search")).toEqual({ open: "maps://?q=coffee" });
    expect(await pick("to")).toEqual({ open: "maps://?daddr=coffee&dirflg=d" });
    expect(await pick("search", "copy_link")).toEqual({ copy: "https://maps.apple.com/?q=coffee" });
    expect(await pick("search", "other")).toEqual({ open: "https://www.google.com/maps/search/?api=1&query=coffee" });
    host.changeSettings("maps", { settings: SETTINGS });
  });

  test("the inline ask answers only a prefixed query, and never waits on the Places API", async () => {
    expect(await list("coffee", { inline: true })).toEqual([]);
    const items = await list("go: coffee", { inline: true });
    expect(ids(items)).toEqual(["search", "to", "from-home", "from-work"]);
    expect(ids(await list("maps: home > work", { inline: true }))).toEqual(["route", "route-back"]);
  });

  test("with a Places API key, predictions follow the rows after the debounce, pinned to their place id on open; a refused key is a hint row under the rows", async () => {
    host.changeSettings("maps", { settings: { ...SETTINGS, api_key: "good" } });
    const items = await list("Kadıköy");
    expect(ids(items).slice(-2)).toEqual(["pred:ChIJk", "pred:ChIJm"]);
    expect(items.at(-2)).toMatchObject({ name: "Kadıköy Sahili", subtitle: "İstanbul, Türkiye" });
    expect(seen.at(-1)).toEqual({ input: "Kadıköy", key: "good" });
    expect(await pick("pred:ChIJk")).toEqual({ open: "https://www.google.com/maps/search/?api=1&query=Kad%C4%B1k%C3%B6y%20Sahili%2C%20%C4%B0stanbul%2C%20T%C3%BCrkiye&query_place_id=ChIJk" });
    expect(await pick("pred:ChIJk", "copy_address")).toEqual({ copy: "Kadıköy Sahili, İstanbul, Türkiye" });
    // The same input again is answered from the cache.
    const n = seen.length;
    await list("Kadıköy");
    expect(seen.length).toBe(n);
    // Overtaken: the older listing answers the plain rows with a waiting hint and asks nothing.
    const [a, b] = await Promise.all([list("Mod"), Bun.sleep(40).then(() => list("Moda"))]);
    expect(ids(a).at(-1)).toBe("hint:wait");
    expect(ids(b).at(-1)).toBe("pred:ChIJm");
    expect(seen.slice(n).map((s) => s.input)).toEqual(["Moda"]);
    expect(ids(await list("go: x", { inline: true }))).not.toContain("pred:ChIJk");
    host.changeSettings("maps", { settings: { ...SETTINGS, api_key: "bad" } });
    const bad = await list("Taksim");
    expect(bad.at(-1)).toMatchObject({ id: "hint:failed", actions: [] });
    expect(bad.at(-1)!.name).toContain("refused the key");
    host.changeSettings("maps", { settings: SETTINGS });
  });
});
