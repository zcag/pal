// immich: the pure parts first (api.ts: the query grammar, the dates, the
// asset shape, the download name), then the palettes over the wire
// against the Bun mock of Immich (immich-mock.ts, the `url` setting) with
// the cache in a temp dir (`PAL_IMMICH_CACHE`) and the clock pinned
// (`PAL_NOW`): the recent grid and its tiles, the CLIP search, a file
// name, the query's since/in/type words, the dropdown, More, the pane,
// every pick (open, link, image, Quick Look, the downloads, favourite, add
// to an album, a new album), albums, people, memories, the links, and the
// missing, refused and read-only keys.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clientOf, clip, downloadName, durationOf, exposureOf, isoCeiling, isoFloor, looksLikeFile, parseAsset, parseQuery, permissionOf, placeOf, takenClock, takenDay } from "../../../extensions/immich/api.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Effect, Item } from "../../../sdk/src/protocol.ts";
import { picture } from "../png.ts";
import { Host, stored, writeTool } from "../harness.ts";
import { ALBUMS, startMock } from "./immich-mock.ts";

describe("api", () => {
  test("parseQuery: words are the CLIP text; since:, before:, in:, type: and is: lift out; a file name goes to the name search", () => {
    expect(parseQuery("a receipt")).toEqual({ text: "a receipt" });
    expect(parseQuery("dog since:2025 before:2026-06")).toEqual({ text: "dog", since: "2025-01-01T00:00:00.000Z", before: "2026-06-01T00:00:00.000Z" });
    expect(parseQuery("--since 2024-03-10 cat")).toEqual({ text: "cat", since: "2024-03-10T00:00:00.000Z" });
    expect(parseQuery("in:2023")).toEqual({ text: "", since: "2023-01-01T00:00:00.000Z", before: "2024-01-01T00:00:00.000Z" });
    expect(parseQuery("sunset in:Ataşehir")).toEqual({ text: "sunset", city: "Ataşehir" });
    expect(parseQuery("cat type:video is:fav")).toEqual({ text: "cat", type: "VIDEO", favorite: true });
    expect(parseQuery("is:archived type:photos")).toEqual({ text: "", type: "IMAGE", archived: true });
    expect(parseQuery("since:soon")).toEqual({ text: "since:soon" });
    expect(parseQuery("DSC00500")).toEqual({ text: "", file: "DSC00500" });
    expect(parseQuery("IMG-20260418-WA0021.jpg since:2026")).toEqual({ text: "", file: "IMG-20260418-WA0021.jpg", since: "2026-01-01T00:00:00.000Z" });
    expect(parseQuery("  ")).toEqual({ text: "" });
  });

  test("isoFloor and isoCeiling: a year, a month, a day; anything else is not a date", () => {
    expect(isoFloor("2025")).toBe("2025-01-01T00:00:00.000Z");
    expect(isoFloor("2025-3")).toBe("2025-03-01T00:00:00.000Z");
    expect(isoCeiling("2025")).toBe("2026-01-01T00:00:00.000Z");
    expect(isoCeiling("2025-12")).toBe("2026-01-01T00:00:00.000Z");
    expect(isoCeiling("2024-02-29")).toBe("2024-03-01T00:00:00.000Z");
    expect(isoFloor("2025-13")).toBeUndefined();
    expect(isoFloor("yesterday")).toBeUndefined();
  });

  test("looksLikeFile: camera and phone names and extensions, not sentences", () => {
    for (const s of ["DSC00500", "IMG_4956", "IMG-20260418-WA0021.jpg", "PXL_20240101_120000", "20260422_232825", "photo.heic", "VID-20260920-WA0170.mp4"]) expect(looksLikeFile(s)).toBe(true);
    for (const s of ["a receipt", "dog", "sunset over the sea", "2023"]) expect(looksLikeFile(s)).toBe(false);
  });

  test("durationOf takes v3's milliseconds and v2's clock string, whole seconds, nothing under one; clip formats it", () => {
    expect(durationOf(31689)).toBe(32);
    expect(durationOf("00:01:02.5")).toBe(63);
    expect(durationOf(65)).toBeUndefined();
    expect(durationOf(null)).toBeUndefined();
    expect(clip(32)).toBe("0:32");
    expect(clip(3723)).toBe("1:02:03");
  });

  test("placeOf and exposureOf read the EXIF; parseAsset normalises an asset, the wall clock read with UTC getters", () => {
    expect(placeOf({ city: "Serdivan", state: "Sakarya", country: "Türkiye" })).toBe("Serdivan, Sakarya, Türkiye");
    expect(placeOf({ city: "Istanbul", state: "Istanbul", country: "Türkiye" })).toBe("Istanbul, Türkiye");
    expect(placeOf({})).toBeUndefined();
    expect(exposureOf({ fNumber: 1.6, exposureTime: "1/100", iso: 100, focalLength: 5.1 })).toBe("ƒ/1.6 · 1/100 s · ISO 100 · 5.1 mm");
    const a = parseAsset({ id: "x", type: "VIDEO", originalFileName: "a.mp4", originalMimeType: "video/mp4", localDateTime: "2022-05-03T22:13:43.000Z", duration: 6635, isFavorite: true, visibility: "archive", exifInfo: { make: "Apple", model: "iPhone", city: "Ataşehir", country: "Türkiye", fileSizeInByte: 10, exifImageWidth: 1, exifImageHeight: 2, latitude: 1, longitude: 2 }, people: [{ id: "p", name: "Ayşe" }, { id: "q", name: "" }, { id: "h", name: "Hidden", isHidden: true }], tags: [{ name: "t" }] })!;
    expect(a).toMatchObject({ id: "x", kind: "video", file: "a.mp4", duration: 7, favorite: true, archived: true, place: "Ataşehir, Türkiye", camera: "Apple iPhone", bytes: 10, width: 1, height: 2, lat: 1, lon: 2, people: ["Ayşe"], faces: 2, tags: ["t"] });
    expect(takenDay(a.taken)).toBe("3 May 2022");
    expect(takenClock(a.taken)).toBe("22:13");
    expect(parseAsset({})).toBeUndefined();
  });

  test("downloadName leads with the day and swaps the extension for a preview; clientOf trims the url and falls back to it for the web address", () => {
    const a = parseAsset({ id: "abcdef12-0000", originalFileName: "DSC00500.ARW", localDateTime: "2026-09-19T18:42:54.099Z" })!;
    expect(downloadName(a)).toBe("2026-09-19_DSC00500.ARW");
    expect(downloadName(a, "jpg")).toBe("2026-09-19_DSC00500.jpg");
    expect(downloadName({ ...a, file: "we/ird:name?.jpg" })).toBe("2026-09-19_we ird name.jpg");
    expect(clientOf({ url: "https://immich.example.com/api/", api_key: " k " })).toEqual({ url: "https://immich.example.com", key: "k", web: "https://immich.example.com" });
    expect(clientOf({ url: "http://100.64.0.2:2283", api_key: "k", web_url: "https://photos.example.com/" })).toMatchObject({ web: "https://photos.example.com" });
    expect(clientOf({ url: "", api_key: "k" })).toBeUndefined();
    expect(permissionOf("Missing required permission: asset.update")).toBe("asset.update");
  });
});

// ---- the palettes over the wire -----------------------------------------------------------

const { server, requests, base, uuid } = startMock();
const dir = mkdtempSync(join(tmpdir(), "pal-immich-"));
const cache = join(dir, "cache"), downloads = join(dir, "Downloads");
/** A stand-in for the clipboard's image copy: logs the path and the format. */
const copyLog = join(dir, "copy.log");
writeTool(join(dir, "copy-image"), `#!/bin/sh\necho "$1 $2" >> ${JSON.stringify(copyLog)}\n`);

const effectsRun: Effect[] = [];

let host: Host;
beforeAll(async () => {
  process.env.PAL_IMMICH_CACHE = cache;
  process.env.PAL_NOW = "2026-09-22T10:00:00";
  process.env.PAL_COPY_IMAGE = join(dir, "copy-image");
  stored.clear();
  host = await Host.bundled({
    settings: { immich: { settings: { url: `${base}/`, api_key: "good", web_url: "https://photos.example.com", download_to: downloads } } },
    core: { "effects.run": (p: unknown) => { effectsRun.push((p as { effect: Effect }).effect); return null; } },
  });
});
afterAll(() => {
  host.kill();
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
  delete process.env.PAL_IMMICH_CACHE; delete process.env.PAL_NOW; delete process.env.PAL_COPY_IMAGE;
});

const list = (q?: string, ctx?: Parameters<Host["list"]>[3]) => host.list("immich", "immich", q, ctx);
const pick = (id: string, action?: string, ctx?: Parameters<Host["pick"]>[4]) => host.pick("immich", "immich", id, action, ctx);
const names = (items: Item[]) => items.map((i) => i.name);
const dataUrl = (i: Item) => (i.icon as { image?: string })?.image ?? "";
/** The last search request (the thumbnail fetches follow a listing). */
const last = () => requests.filter((r) => !r.path.includes("/thumbnail")).at(-1)!;
const settle = (ms = 50) => Bun.sleep(ms);

describe("immich", () => {
  test("meta: an input grid on the indigo tile with the pane open, five filters and a fallback row; albums and people lazy lists with a ttl; memories live; three links; no warnings", () => {
    const l = host.loaded().find((l) => l.extension === "immich")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes.map((p) => p.name)).toEqual(["immich", "albums", "people", "memories"]);
    expect(l.palettes[0]).toMatchObject({ title: "Immich", input: true, view: "grid", columns: 6, showDetail: true, detail: "lazy", fallback: "ask", fallbackTitle: "Search Immich for “{query}”", icon: tile("indigo", "\u{f02f9}") });
    expect(l.palettes[0].filters!.map((f) => f.id)).toEqual(["all", "photos", "videos", "favourites", "archived"]);
    expect(l.palettes[1]).toMatchObject({ title: "Immich Albums", lazy: true, ttl: 300, input: false, live: false });
    expect(l.palettes[2]).toMatchObject({ title: "Immich People", lazy: true, ttl: 600 });
    expect(l.palettes[3]).toMatchObject({ title: "On This Day", live: true, lazy: true, ttl: 1800 });
    expect(Object.keys(l.manifest.links!)).toEqual(["search", "album", "person"]);
  });

  test("nothing typed lists the newest uploads under Recent, 24 tiles then More: each a thumbnail fetched once into the cache as a data url, titled with the day and the place, a video with its length; the actions with Favourite or Unfavourite by the flag", async () => {
    const items = await list("");
    expect(items).toHaveLength(25);
    expect(last()).toMatchObject({ method: "POST", path: "/search/metadata", body: { size: 24, page: 1, withExif: true, visibility: "timeline", order: "desc" } });
    expect(items.every((i) => i.section === "Recent")).toBe(true);
    expect(names(items).slice(0, 5)).toEqual(["21 Sep 2026", "▶ 0:07 · 21 Sep 2026", "19 Sep 2026", "19 Sep 2026", "Serdivan · 3 May 2022"]);
    expect(items[0].subtitle).toBe("IMG-20260921-WA0012.jpg");
    expect(dataUrl(items[0])).toMatch(/^data:image\/png;base64,/);
    expect(Buffer.from(dataUrl(items[0]).slice("data:image/png;base64,".length), "base64").equals(picture(1, 96, 72))).toBe(true);
    expect(items[0].actions!.map((a) => a.id)).toEqual(process.platform === "darwin" ? ["open", "link", "image", "quick-look", "download", "original", "fav", "album", "file"] : ["open", "link", "image", "download", "original", "fav", "album", "file"]);
    expect(items[1].actions!.find((a) => a.id === "unfav")).toMatchObject({ title: "Unfavourite", shortcut: "cmd+f", multi: true });
    expect(items[0].detail!.metadata).toEqual([{ label: "Taken", value: "21 Sep 2026 18:18" }, { label: "Size", value: "946 × 2048 · 120 KB · JPEG" }, { label: "File", value: "IMG-20260921-WA0012.jpg" }]);
    expect(items[4].detail!.metadata).toEqual(expect.arrayContaining([{ label: "Place", link: { text: "Serdivan, Sakarya, Türkiye", href: "https://www.google.com/maps/search/?api=1&query=40.760042,30.364075" } }, { label: "Camera", value: "Apple iPhone 13 mini" }, { label: "Lens", value: "iPhone 13 mini back dual wide camera 5.1mm f/1.6" }, { label: "Exposure", value: "ƒ/1.6 · 1/100 s · ISO 100 · 5.1 mm" }, { label: "Size", value: "4032 × 3024 · 2.6 MB · HEIC" }]));
    expect(items.at(-1)).toMatchObject({ name: "More…", subtitle: "24 shown", actions: [{ id: "more", title: "Load more" }] });
    expect(readdirSync(join(cache, "thumbs"))).toHaveLength(24);
    const n = requests.length;
    await list("");
    expect(requests.length).toBe(n);
  });

  test("More pages on: the next page is appended, no More once the library is out; cmd+r starts over", async () => {
    let items = await list("");
    await pick(items.at(-1)!.id);
    items = await list("");
    expect(items).toHaveLength(29);
    expect(last()).toMatchObject({ path: "/search/metadata", body: { page: 2 } });
    expect(items.at(-1)!.name).not.toBe("More…");
    items = await list("", { refresh: true });
    expect(items).toHaveLength(25);
  });

  test("words are a CLIP search, debounced, the assets with their EXIF; a file name is a name search; nothing found says so", async () => {
    let items = await list("receipt");
    expect(last()).toMatchObject({ path: "/search/smart", body: { query: "receipt", size: 24, withExif: true, visibility: "timeline" } });
    expect(items[0].section).toBeUndefined();
    expect(names(items).slice(0, 3)).toEqual(["21 Sep 2026", "Serdivan · 3 May 2022", "15 Jan 2023"]);
    expect(names(await list("DSC005"))).toEqual(["19 Sep 2026", "19 Sep 2026"]);
    expect(last()).toMatchObject({ path: "/search/metadata", body: { originalFileName: "DSC005", order: "desc" } });
    expect(await list("zebra")).toEqual([expect.objectContaining({ id: "hint:none", name: "Nothing looks like “zebra”", subtitle: "Immich", actions: [] })]);
    expect(await list("IMG_9999.jpg")).toEqual([expect.objectContaining({ name: "No file named like “IMG_9999.jpg”" })]);
    const n = requests.length;
    const [a, b] = await Promise.all([list("do"), Bun.sleep(40).then(() => list("dog"))]);
    expect(a).toEqual([expect.objectContaining({ id: "hint:wait", name: "Searching…", subtitle: "do", actions: [] })]);
    expect(names(b)).toEqual(["22 Sep 2021", "Serdivan · 3 Jun 2022", "▶ 3 Jun 2022"]);
    expect(requests.slice(n).map((r) => r.body?.query)).toEqual(["dog"]);
  });

  test("the query's since:, before:, in: and type: words and the dropdown reach the request; the dropdown's Archived lists the archive, Favourites the favourites", async () => {
    await list("receipt since:2022 before:2023-06");
    expect(last().body).toMatchObject({ query: "receipt", takenAfter: "2022-01-01T00:00:00.000Z", takenBefore: "2023-06-01T00:00:00.000Z" });
    await list("in:Serdivan");
    expect(last()).toMatchObject({ path: "/search/metadata", body: { city: "Serdivan" } });
    expect(names(await list("dog type:video"))).toEqual(["▶ 3 Jun 2022"]);
    expect(last().body).toMatchObject({ type: "VIDEO" });
    expect(names(await list("", { filter: "videos" }))).toEqual(["▶ 0:07 · 21 Sep 2026", "▶ 3 Jun 2022"]);
    expect(names(await list("", { filter: "favourites" }))).toEqual(["▶ 0:07 · 21 Sep 2026", "22 Sep 2021"]);
    expect(last().body).toMatchObject({ isFavorite: true });
    const archived = await list("receipt", { filter: "archived" });
    expect(last().body).toMatchObject({ visibility: "archive" });
    expect(names(archived)).toEqual(["2 Dec 2020"]);
    expect(archived[0].detail!.metadata![0]).toEqual({ label: "Taken", value: "2 Dec 2020 11:23", tags: [{ text: "archived", color: "grey" }] });
    expect(names(await list("", { filter: "photos" }))).not.toContain("▶ 0:07 · 21 Sep 2026");
  });

  test("the pane: the preview fetched into the cache and served through the core's file route, the fresh asset's people and tags, the albums it is in", async () => {
    const [receipt] = await list("receipt");
    const d = (await host.detail("immich", "immich", receipt.id))!;
    expect(d.markdown).toBe(`![IMG-20260921-WA0012.jpg](icon://localhost/file?path=${encodeURIComponent(join(cache, "previews", `${uuid(1)}.jpg`))}&size=0)`);
    expect(readFileSync(join(cache, "previews", `${uuid(1)}.jpg`)).equals(picture(1, 288, 216))).toBe(true);
    expect(d.metadata).toEqual(expect.arrayContaining([{ label: "Albums", tags: [{ text: "Receipts", color: "violet" }] }, { label: "Tags", tags: [{ text: "takeout" }] }]));
    const [, cat] = await list("");
    const dc = (await host.detail("immich", "immich", cat.id))!;
    expect(dc.metadata).toEqual(expect.arrayContaining([{ label: "Taken", value: "21 Sep 2026 10:34", tags: [{ text: "favourite", color: "amber" }, { text: "video", color: "blue" }] }, { label: "Length", value: "0:07" }, { label: "People", tags: [{ text: "Ayşe", color: "teal" }] }, { label: "Albums", tags: [{ text: "Family", color: "violet" }] }]));
    const [portrait] = await list("DSC00500.ARW");
    expect((await host.detail("immich", "immich", portrait.id))!.metadata).toEqual(expect.arrayContaining([{ label: "People", tags: [{ text: "Ayşe", color: "teal" }, { text: "Mehmet", color: "teal" }] }, { label: "Camera", value: "SONY ILCE-6700" }]));
    expect(await host.detail("immich", "immich", "nope")).toEqual({});
  });

  test("Enter opens the photo on the web address; Copy link and Copy file name; Copy image puts the preview on the clipboard through the stand-in; Quick Look on macOS", async () => {
    const [receipt] = await list("receipt");
    expect(await pick(receipt.id)).toEqual({ open: `https://photos.example.com/photos/${uuid(1)}` });
    expect(await pick(receipt.id, "link")).toEqual({ copy: `https://photos.example.com/photos/${uuid(1)}` });
    expect(await pick(receipt.id, "file")).toEqual({ copy: "IMG-20260921-WA0012.jpg" });
    expect(await pick(receipt.id, "link", { ids: [uuid(1), uuid(5)] })).toEqual({ copy: `https://photos.example.com/photos/${uuid(1)}\nhttps://photos.example.com/photos/${uuid(5)}` });
    expect(await pick(receipt.id, "image")).toEqual({ hud: "Image copied" });
    expect(readFileSync(copyLog, "utf8").trim()).toBe(`${join(cache, "previews", `${uuid(1)}.jpg`)} jpeg`);
    // A pick after a restart: the asset is fetched by id.
    expect(await pick(uuid(9), "file")).toEqual({ copy: "IMG_4956.jpg" });
    expect(await pick("00000000-0000-4000-8000-000000000099")).toMatchObject({ keep: true, toast: { title: "Could not find the photo", style: "failure" } });
  });

  test("Download preview writes the JPEG named by the day into the folder (a taken name gets -2); Download original fetches in the background and the HUD says when it landed; several marked rows at once", async () => {
    const [receipt] = await list("receipt");
    expect(await pick(receipt.id, "download")).toEqual({ hud: `Saved 2026-09-21_IMG-20260921-WA0012.jpg to ${downloads}` });
    expect(readFileSync(join(downloads, "2026-09-21_IMG-20260921-WA0012.jpg")).equals(picture(1, 288, 216))).toBe(true);
    expect(await pick(receipt.id, "download")).toEqual({ hud: `Saved 2026-09-21_IMG-20260921-WA0012-2.jpg to ${downloads}` });
    expect(await pick(receipt.id, "download", { ids: [uuid(1), uuid(5)] })).toEqual({ hud: `Saved 2 previews to ${downloads}` });
    expect(readdirSync(downloads).sort()).toEqual(["2022-05-03_2024-11-23.jpg", "2026-09-21_IMG-20260921-WA0012-2.jpg", "2026-09-21_IMG-20260921-WA0012-3.jpg", "2026-09-21_IMG-20260921-WA0012.jpg"]);
    expect(await pick(uuid(3), "original")).toEqual({ hud: "Downloading DSC00500.ARW…" });
    await host.until(() => effectsRun.length > 0, 3000, "the original's HUD");
    expect(effectsRun).toEqual([{ hud: `Saved 2026-09-19_DSC00500.ARW to ${downloads}` }]);
    expect(readFileSync(join(downloads, "2026-09-19_DSC00500.ARW"), "utf8")).toBe("ORIGINAL DSC00500.ARW");
    expect(await pick(uuid(3), "original", { ids: [uuid(3), uuid(9)] })).toEqual({ hud: "Downloading 2 originals…" });
    await host.until(() => effectsRun.length > 1, 3000, "the originals' HUD");
    expect(effectsRun[1]).toEqual({ hud: `Saved 2 originals to ${downloads}` });
  });

  test("Favourite flips the flag on Immich in one call for every marked row and the tile's action follows; a read-only key is a failure toast naming the permission", async () => {
    const [receipt, , portrait] = await list("");
    expect(await pick(receipt.id, "fav", { ids: [receipt.id, portrait.id] })).toEqual({ keep: true, toast: { title: "Favourited", message: "2 photos" } });
    expect(last()).toMatchObject({ method: "PUT", path: "/assets", body: { ids: [receipt.id, portrait.id], isFavorite: true } });
    let items = await list("");
    expect(items[0].actions!.some((a) => a.id === "unfav")).toBe(true);
    expect(items[2].actions!.some((a) => a.id === "unfav")).toBe(true);
    expect(await pick(receipt.id, "unfav")).toEqual({ keep: true, toast: { title: "Unfavourited", message: "21 Sep 2026" } });
    expect(last().body).toEqual({ ids: [receipt.id], isFavorite: false });
    await pick(portrait.id, "unfav");
    items = await list("");
    expect(items[0].actions!.some((a) => a.id === "fav")).toBe(true);
    host.changeSettings("immich", { settings: { url: base, api_key: "readonly", web_url: "https://photos.example.com", download_to: downloads } });
    await settle();
    expect(await pick(receipt.id, "fav")).toEqual({ keep: true, toast: { title: "Could not fav", message: "The key lacks the `asset.update` permission: make one with it under Account Settings › API Keys", style: "failure" } });
    host.changeSettings("immich", { settings: { url: base, api_key: "good", web_url: "https://photos.example.com", download_to: downloads } });
    await settle();
  });

  test("Add to album pushes the albums picker with the ids: your own albums with Add here, New album… first; Add here puts them in (the ones already there counted); the new album form creates one holding them", async () => {
    const [receipt, cat] = await list("");
    const e = await pick(receipt.id, "album", { ids: [receipt.id, cat.id] });
    expect(e).toEqual({ push: { extension: "immich", palette: "albums", args: { add: [receipt.id, cat.id], title: "2 photos" }, title: "Add to album" } });
    const rows = await host.list("immich", "albums", "", { args: e.push!.args });
    // The `good` key may not read `/users/me`, so every album passes as owned; the admin key below tells them apart.
    expect(names(rows)).toEqual(["New album…", "Trip to Bolu", "Receipts", "Family", "Untitled Album"]);
    expect(rows[0].subtitle).toBe("With 2 photos");
    expect(rows[1].actions!.map((a) => a.id)).toEqual(["add", "web"]);
    expect(await host.pick("immich", "albums", "a1", "add", { args: e.push!.args })).toEqual({ hud: "Added 2 photos to Trip to Bolu" });
    expect(last()).toMatchObject({ method: "PUT", path: "/albums/a1/assets", body: { ids: [receipt.id, cat.id] } });
    expect(await host.pick("immich", "albums", "a2", "add", { args: { add: [receipt.id, cat.id], title: "2 photos" } })).toEqual({ hud: "Added 1 photo to Receipts (1 already there)" });
    expect(await host.pick("immich", "albums", "a2", "add", { args: { add: [receipt.id], title: "21 Sep 2026" } })).toEqual({ hud: "Already in Receipts" });
    const form = await host.pick("immich", "albums", "new", "new", { args: e.push!.args });
    expect(form.form).toMatchObject({ id: "new", title: "New album", submit: { id: "create", title: "Create" } });
    expect(form.form!.fields.map((f) => f.id)).toEqual(["name"]);
    expect(await host.pick("immich", "albums", "new", "create", { args: e.push!.args, values: { name: "Cats" } })).toEqual({ hud: "Added 2 photos to the new album Cats" });
    expect(last()).toMatchObject({ method: "POST", path: "/albums", body: { albumName: "Cats", assetIds: [receipt.id, cat.id] } });
    expect(ALBUMS.at(-1)).toMatchObject({ name: "Cats", assets: [receipt.id, cat.id] });
    expect(await host.pick("immich", "albums", "new", "create", { values: { name: "Empty" } })).toEqual({ hud: "Created Empty" });
  });

  test("Albums: the ones with photos first, changed last first, with a cover, the count, the dates and a shared tag, the empty ones last; Enter pushes the album's grid, where a search runs inside it; the library's numbers lead for a key that may read them", async () => {
    let rows = await host.list("immich", "albums");
    expect(names(rows)).toEqual(["Cats", "Trip to Bolu", "Receipts", "Family", "Empty", "Untitled Album"]);
    expect(rows[1].subtitle).toBe("5 items · 10 Jul 2026 – 19 Sep 2026");
    expect(rows[1].accessories).toBeUndefined();
    expect(rows[2]).toMatchObject({ subtitle: "5 items · 10 Jul 2026 – 19 Sep 2026 · For the accountant", accessories: [{ tag: "shared", color: "blue" }] });
    expect(dataUrl(rows[1])).toMatch(/^data:image\/png;base64,/);
    expect(rows[4].icon).toBe("\u{f02ea}");
    expect(rows[1].actions!.map((a) => a.id)).toEqual(["open", "web", "link"]);
    const e = await host.pick("immich", "albums", "a1");
    expect(e).toEqual({ push: { extension: "immich", palette: "immich", args: { album: "a1", title: "Trip to Bolu" }, title: "Trip to Bolu" } });
    expect(await host.pick("immich", "albums", "a1", "web")).toEqual({ open: "https://photos.example.com/albums/a1" });
    expect(await host.pick("immich", "albums", "a1", "link")).toEqual({ copy: "https://photos.example.com/albums/a1" });
    const inside = await list("", { args: e.push!.args });
    expect(last().body).toMatchObject({ albumIds: ["a1"], order: "desc" });
    expect(inside.every((i) => i.section === undefined)).toBe(true);
    expect(names(inside)).toHaveLength(5);
    expect(names(await list("sunset", { args: e.push!.args }))).toEqual(["Ataşehir · 22 Sep 2025"]);
    expect(last()).toMatchObject({ path: "/search/smart", body: { query: "sunset", albumIds: ["a1"] } });
    expect(await list("zebra", { args: e.push!.args })).toEqual([expect.objectContaining({ name: "Nothing looks like “zebra”", subtitle: "Trip to Bolu" })]);
    host.changeSettings("immich", { settings: { url: base, api_key: "admin", web_url: "https://photos.example.com", download_to: downloads } });
    await settle();
    rows = await host.list("immich", "albums", "", { refresh: true });
    expect(rows[0]).toMatchObject({ id: "library", name: "Immich library", subtitle: "60,123 photos · 2,345 videos · 1.12 TB" });
    expect(await host.pick("immich", "albums", "library")).toEqual({ open: "https://photos.example.com/photos" });
    // The admin key reads `/users/me`, so the picker lists only the albums it owns.
    expect(names(await host.list("immich", "albums", "", { args: { add: [uuid(1)] } }))).not.toContain("Family");
    host.changeSettings("immich", { settings: { url: base, api_key: "good", web_url: "https://photos.example.com", download_to: downloads } });
    await settle();
  });

  test("People: the named ones, favourites first with a tag and their face, a row for the faces without a name; Enter pushes the person's grid", async () => {
    const rows = await host.list("immich", "people");
    expect(names(rows)).toEqual(["Ayşe", "Mehmet", "2 faces without a name"]);
    expect(rows[0]).toMatchObject({ accessories: [{ tag: "favourite", color: "amber" }], keywords: ["person", "people"] });
    expect(rows[1].subtitle).toBe("Born 1990-04-01");
    expect(dataUrl(rows[0])).toMatch(/^data:image\/png;base64,/);
    expect(readdirSync(join(cache, "faces")).sort()).toEqual(["p1.jpg", "p2.jpg"]);
    expect(rows[2].actions).toEqual([{ id: "web", title: "Open People in Immich" }]);
    expect(await host.pick("immich", "people", "unnamed")).toEqual({ open: "https://photos.example.com/people" });
    const e = await host.pick("immich", "people", "p1");
    expect(e).toEqual({ push: { extension: "immich", palette: "immich", args: { person: "p1", title: "Ayşe" }, title: "Ayşe" } });
    expect(await host.pick("immich", "people", "p1", "web")).toEqual({ open: "https://photos.example.com/people/p1" });
    expect(names(await list("", { args: e.push!.args }))).toEqual(["▶ 0:07 · 21 Sep 2026", "19 Sep 2026", "19 Sep 2026"]);
    expect(last().body).toMatchObject({ personIds: ["p1"] });
  });

  test("On This Day: a row per memory with the years ago, the count and the first picture; Enter pushes that year's photos, filtered here; no memories says so", async () => {
    const rows = await host.list("immich", "memories");
    expect(names(rows)).toEqual(["A year ago, 2025", "5 years ago, 2021"]);
    expect(last().path).toBe("/memories?for=2026-09-22");
    expect(rows[0]).toMatchObject({ subtitle: "1 photo", keywords: ["2025", "memory", "on this day"] });
    expect(dataUrl(rows[0])).toMatch(/^data:image\/png;base64,/);
    const e = await host.pick("immich", "memories", "m1");
    expect(e).toEqual({ push: { extension: "immich", palette: "immich", args: { memory: "m1", title: "On this day, 2025" }, title: "On this day, 2025" } });
    expect(await host.pick("immich", "memories", "m1", "web")).toEqual({ open: "https://photos.example.com/memory" });
    const n = requests.length;
    expect(names(await list("", { args: e.push!.args }))).toEqual(["22 Sep 2025"]);
    expect(names(await list("WA0001", { args: e.push!.args }))).toEqual(["22 Sep 2025"]);
    expect(await list("zebra", { args: e.push!.args })).toEqual([expect.objectContaining({ name: "Nothing matches", subtitle: "On this day, 2025" })]);
    expect(requests.slice(n).filter((r) => r.path.startsWith("/search"))).toEqual([]);
    process.env.PAL_NOW = "2026-03-01T10:00:00";
    host.changeSettings("immich", { settings: { url: base, api_key: "good", web_url: "https://photos.example.com", download_to: downloads } });
    await settle();
  });

  test("links: search pushes the grid with the query (the filter as a word); album and person find by name or id, or say what is missing", async () => {
    const link = (route: string, params: Record<string, unknown>) => host.request<Effect>("link", { extension: "immich", route, params });
    expect(await link("search", { q: "a receipt" })).toEqual({ push: { extension: "immich", palette: "immich", query: "a receipt" } });
    expect(await link("search", { q: "cat", filter: "videos" })).toEqual({ push: { extension: "immich", palette: "immich", query: "cat type:video" } });
    expect(await link("search", {})).toEqual({ push: { extension: "immich", palette: "immich", query: "" } });
    await expect(link("search", { filter: "big" })).rejects.toThrow("filter is one of");
    expect(await link("album", { name: "receipts" })).toEqual({ push: { extension: "immich", palette: "immich", args: { album: "a2", title: "Receipts" }, title: "Receipts" } });
    expect(await link("album", { name: "bolu" })).toMatchObject({ push: { args: { album: "a1" } } });
    expect(await link("album", { id: "a3" })).toMatchObject({ push: { args: { album: "a3", title: "Family" } } });
    await expect(link("album", { name: "nope" })).rejects.toThrow('no album "nope"');
    await expect(link("album", {})).rejects.toThrow("name or id is required");
    expect(await link("person", { name: "mehmet" })).toEqual({ push: { extension: "immich", palette: "immich", args: { person: "p2", title: "Mehmet" }, title: "Mehmet" } });
    await expect(link("person", { name: "zeynep" })).rejects.toThrow('no person "zeynep"');
  });

  test("without a url or a key every palette is one row that opens Settings on the missing field; a refused key and an unreachable server name the fix", async () => {
    host.changeSettings("immich", { settings: { url: "", api_key: "", web_url: "", download_to: downloads } });
    await settle();
    for (const p of ["immich", "albums", "people", "memories"]) {
      const rows = await host.list("immich", p);
      expect(rows).toEqual([expect.objectContaining({ id: "setup", name: "Set url and api_key under Settings › Extensions › Immich", actions: [{ id: "settings", title: "Open Settings" }] })]);
      expect(await host.pick("immich", p, "setup")).toEqual({ open: "pal://settings/extensions?anchor=extensions:immich:url" });
    }
    host.changeSettings("immich", { settings: { url: base, api_key: "", web_url: "", download_to: downloads } });
    await settle();
    expect(await pick("setup")).toEqual({ open: "pal://settings/extensions?anchor=extensions:immich:api_key" });
    await expect(host.request("link", { extension: "immich", route: "search", params: { q: "x" } })).rejects.toThrow("set url and api_key");
    host.changeSettings("immich", { settings: { url: base, api_key: "bad", web_url: "", download_to: downloads } });
    await settle();
    expect(await list("")).toEqual([expect.objectContaining({ id: "hint:failed", name: "Immich refused the key: check `api_key` under Settings › Extensions › Immich", actions: [] })]);
    expect((await host.list("immich", "albums"))[0].name).toContain("refused the key");
    host.changeSettings("immich", { settings: { url: "http://127.0.0.1:9", api_key: "good", web_url: "", download_to: downloads } });
    await settle();
    expect((await list("", { refresh: true }))[0].name).toBe("Immich did not answer at http://127.0.0.1:9: check `url` and the network");
    host.changeSettings("immich", { settings: { url: base, api_key: "good", web_url: "https://photos.example.com", download_to: downloads } });
    await settle();
    expect((await list("")).length).toBe(25);
  });
});
