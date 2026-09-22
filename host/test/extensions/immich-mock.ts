// A Bun mock of Immich v3's API for the immich tests and the screenshot
// fixture: the reply shapes are the documented ones (probed against a
// v3.1 server on 2026-09-22), trimmed to the fields the extension reads.
// A small library of assets in three albums with two named people and two
// memories; the pictures are generated (`png.ts`). The key `good` reads and
// writes, `readonly` reads only (a 403 naming the permission on a write,
// as Immich answers), `admin` may also read the statistics; anything else
// is Immich's 401. `requests` records every call with its body.
import { picture } from "../png.ts";

export type Seen = { method: string; path: string; body?: Record<string, unknown> };

const ME = "u1";
const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;

type Asset = { id: string; type: "IMAGE" | "VIDEO"; file: string; mime: string; local: string; title: string; favorite: boolean; visibility: "timeline" | "archive"; duration: number | null; exif: Record<string, unknown>; people: string[] };

const exif = (o: Record<string, unknown>) => ({ make: null, model: null, exifImageWidth: 4032, exifImageHeight: 3024, fileSizeInByte: 2758895, orientation: "6", dateTimeOriginal: null, modifyDate: null, timeZone: "Europe/Istanbul", lensModel: null, fNumber: null, focalLength: null, iso: null, exposureTime: null, latitude: null, longitude: null, city: null, state: null, country: null, description: "", projectionType: null, rating: null, ...o });
const IPHONE = { make: "Apple", model: "iPhone 13 mini", lensModel: "iPhone 13 mini back dual wide camera 5.1mm f/1.6", fNumber: 1.6, focalLength: 5.1, iso: 100, exposureTime: "1/100" };
const SONY = { make: "SONY", model: "ILCE-6700", lensModel: "Tamron 18-300mm F3.5-6.3 Di III-A VC VXD", fNumber: 4, focalLength: 18, iso: 320, exposureTime: "1/160", exifImageWidth: 6272, exifImageHeight: 4168, fileSizeInByte: 28585984 };
const SERDIVAN = { city: "Serdivan", state: "Sakarya", country: "Türkiye", latitude: 40.760042, longitude: 30.364075 };
const ATASEHIR = { city: "Ataşehir", state: "Istanbul", country: "Türkiye", latitude: 40.9938, longitude: 29.0597 };

/** The library, newest first: what "recent" lists. `title` is what the CLIP search matches on (a word of it). */
export const ASSETS: Asset[] = [
  { id: uuid(1), type: "IMAGE", file: "IMG-20260921-WA0012.jpg", mime: "image/jpeg", local: "2026-09-21T18:18:49.000Z", title: "a receipt from the market", favorite: false, visibility: "timeline", duration: null, exif: exif({ exifImageWidth: 946, exifImageHeight: 2048, fileSizeInByte: 122880 }), people: [] },
  { id: uuid(2), type: "VIDEO", file: "20260921_103355.mp4", mime: "video/mp4", local: "2026-09-21T10:34:03.000Z", title: "the cat on the sofa", favorite: true, visibility: "timeline", duration: 6635, exif: exif({ ...ATASEHIR, exifImageWidth: 1920, exifImageHeight: 1080, fileSizeInByte: 11015292 }), people: ["p1"] },
  { id: uuid(3), type: "IMAGE", file: "DSC00500.ARW", mime: "image/arw", local: "2026-09-19T18:42:54.099Z", title: "a portrait in the park", favorite: false, visibility: "timeline", duration: null, exif: exif(SONY), people: ["p1", "p2"] },
  { id: uuid(4), type: "IMAGE", file: "DSC00500.lume.jpg", mime: "image/jpeg", local: "2026-09-19T18:42:54.000Z", title: "a portrait in the park edited", favorite: false, visibility: "timeline", duration: null, exif: exif({ ...SONY, exifImageWidth: 4168, exifImageHeight: 6240, fileSizeInByte: 2880972 }), people: ["p1"] },
  { id: uuid(5), type: "IMAGE", file: "2024-11-23.heic", mime: "image/heic", local: "2022-05-03T22:13:43.000Z", title: "a receipt on the table", favorite: false, visibility: "timeline", duration: null, exif: exif({ ...IPHONE, ...SERDIVAN, dateTimeOriginal: "2022-05-03T19:13:43+00:00" }), people: [] },
  { id: uuid(6), type: "IMAGE", file: "IMG_0563.PNG", mime: "image/png", local: "2020-12-02T11:23:50.000Z", title: "a screenshot of a receipt", favorite: false, visibility: "archive", duration: null, exif: exif({ exifImageWidth: 1170, exifImageHeight: 2532, fileSizeInByte: 812000 }), people: [] },
  { id: uuid(7), type: "IMAGE", file: "IMG-20250922-WA0001.jpg", mime: "image/jpeg", local: "2025-09-22T10:30:34.000Z", title: "the sea at sunset", favorite: false, visibility: "timeline", duration: null, exif: exif({ ...ATASEHIR, exifImageWidth: 1600, exifImageHeight: 657, fileSizeInByte: 91000 }), people: ["p2"] },
  { id: uuid(8), type: "IMAGE", file: "IMG-20210922-WA0004.jpg", mime: "image/jpeg", local: "2021-09-22T15:00:00.000Z", title: "a dog on the beach", favorite: true, visibility: "timeline", duration: null, exif: exif({ exifImageWidth: 1200, exifImageHeight: 900, fileSizeInByte: 210000 }), people: [] },
  { id: uuid(9), type: "IMAGE", file: "IMG_4956.jpg", mime: "image/jpeg", local: "2022-06-03T09:12:00.000Z", title: "a dog in the garden", favorite: false, visibility: "timeline", duration: null, exif: exif({ ...IPHONE, ...SERDIVAN }), people: [] },
  { id: uuid(10), type: "VIDEO", file: "IMG_4957.MOV", mime: "video/quicktime", local: "2022-06-03T09:13:00.000Z", title: "a dog running", favorite: false, visibility: "timeline", duration: 65, exif: exif({ exifImageWidth: 1920, exifImageHeight: 1080, fileSizeInByte: 3000000 }), people: [] },
];
// Filler for the paging: 20 more receipts and cats over 2023.
for (let n = 11; n <= 30; n++) ASSETS.push({ id: uuid(n), type: "IMAGE", file: `IMG_${5000 + n}.jpg`, mime: "image/jpeg", local: `2023-${String(((n - 11) % 12) + 1).padStart(2, "0")}-15T12:00:00.000Z`, title: n % 2 ? "a receipt from a shop" : "the cat asleep", favorite: false, visibility: "timeline", duration: null, exif: exif({ exifImageWidth: 3000, exifImageHeight: 2000, fileSizeInByte: 1500000 }), people: [] });

export const PEOPLE = [
  { id: "p1", name: "Ayşe", isFavorite: true, isHidden: false, birthDate: null },
  { id: "p2", name: "Mehmet", isFavorite: false, isHidden: false, birthDate: "1990-04-01" },
  { id: "p3", name: "", isFavorite: false, isHidden: false, birthDate: null },
  { id: "p4", name: "", isFavorite: false, isHidden: false, birthDate: null },
  { id: "p5", name: "Hidden", isFavorite: false, isHidden: true, birthDate: null },
];

export type MockAlbum = { id: string; name: string; description: string; assets: string[]; shared: boolean; owner: string; modified: string };
export const ALBUMS: MockAlbum[] = [
  { id: "a1", name: "Trip to Bolu", description: "", assets: [uuid(3), uuid(4), uuid(7)], shared: false, owner: ME, modified: "2026-09-20T18:56:09.403Z" },
  { id: "a2", name: "Receipts", description: "For the accountant", assets: [uuid(1), uuid(5), uuid(11), uuid(13)], shared: true, owner: ME, modified: "2026-08-04T05:40:49.958Z" },
  { id: "a3", name: "Family", description: "", assets: [uuid(2)], shared: true, owner: "u2", modified: "2026-07-10T12:30:34.733Z" },
  { id: "a4", name: "Untitled Album", description: "", assets: [], shared: false, owner: ME, modified: "2026-06-01T00:00:00.000Z" },
];

const MEMORIES = [
  { id: "m1", year: 2025, assets: [uuid(7)] },
  { id: "m2", year: 2021, assets: [uuid(8)] },
];

const person = (id: string) => { const p = PEOPLE.find((p) => p.id === id)!; return { id: p.id, name: p.name, birthDate: p.birthDate, thumbnailPath: `/thumbs/${p.id}.jpeg`, isHidden: p.isHidden, isFavorite: p.isFavorite, updatedAt: "2026-02-21T17:59:46.934Z" }; };

/** `AssetResponseDto`, `exifInfo` when asked (`withExif`), `people` always (v3 sends them in searches and on the asset). */
function dto(a: Asset, withExif: boolean) {
  const n = Number(a.id.slice(0, 8));
  return {
    id: a.id, createdAt: "2026-02-17T05:52:51.113Z", ownerId: ME, libraryId: null, type: a.type, originalPath: `/usr/src/app/upload/library/admin/${a.file}`, originalFileName: a.file, originalMimeType: a.mime,
    thumbhash: "YxgODQIraIWHB4iIl2SKiLfABA5N", fileCreatedAt: a.local, fileModifiedAt: a.local, localDateTime: a.local, updatedAt: "2026-05-28T14:20:58.419Z",
    isFavorite: a.favorite, isArchived: a.visibility === "archive", isTrashed: false, visibility: a.visibility, duration: a.duration, livePhotoVideoId: null,
    ...(withExif && { exifInfo: a.exif }), people: a.people.map(person), checksum: `c${n}`, isOffline: false, hasMetadata: true, duplicateId: null, resized: true, width: a.exif.exifImageWidth, height: a.exif.exifImageHeight, isEdited: false,
  };
}

const albumDto = (a: MockAlbum) => ({
  albumName: a.name, description: a.description, albumThumbnailAssetId: a.assets[0] ?? null, createdAt: a.modified, updatedAt: a.modified, id: a.id,
  albumUsers: [{ user: { id: a.owner, email: "x@example.com", name: a.owner, profileImagePath: "", avatarColor: "yellow", profileChangedAt: a.modified }, role: "owner" }],
  shared: a.shared, hasSharedLink: false, startDate: a.assets.length ? "2026-07-10T00:00:00.000Z" : null, endDate: a.assets.length ? "2026-09-19T00:00:00.000Z" : null,
  assetCount: a.assets.length, isActivityEnabled: true, order: "desc", lastModifiedAssetTimestamp: a.modified,
});

/** The search filters both endpoints share, as Immich applies them. */
function filtered(b: Record<string, unknown>): Asset[] {
  let list = ASSETS.filter((a) => a.visibility === (b.visibility ?? "any") || b.visibility === undefined);
  if (b.type) list = list.filter((a) => a.type === b.type);
  if (b.isFavorite !== undefined) list = list.filter((a) => a.favorite === b.isFavorite);
  if (Array.isArray(b.albumIds)) list = list.filter((a) => (b.albumIds as string[]).some((id) => ALBUMS.find((x) => x.id === id)?.assets.includes(a.id)));
  if (Array.isArray(b.personIds)) list = list.filter((a) => (b.personIds as string[]).some((id) => a.people.includes(id)));
  if (typeof b.takenAfter === "string") list = list.filter((a) => a.local >= (b.takenAfter as string));
  if (typeof b.takenBefore === "string") list = list.filter((a) => a.local < (b.takenBefore as string));
  if (typeof b.city === "string") list = list.filter((a) => a.exif.city === b.city);
  if (typeof b.originalFileName === "string") list = list.filter((a) => a.file.toLowerCase().includes((b.originalFileName as string).toLowerCase()));
  return list;
}

const page = (list: Asset[], b: Record<string, unknown>) => {
  const size = Number(b.size ?? 100), p = Number(b.page ?? 1);
  const items = list.slice((p - 1) * size, p * size);
  return { albums: { total: 0, count: 0, items: [], facets: [] }, assets: { total: items.length, count: items.length, items: items.map((a) => dto(a, !!b.withExif)), facets: [], nextPage: p * size < list.length ? String(p + 1) : null } };
};

export function startMock() {
  const requests: Seen[] = [];
  const favorites = new Map<string, boolean>();
  const server = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname.replace(/^\/api/, "");
      const body = req.method === "POST" || req.method === "PUT" ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : undefined;
      requests.push({ method: req.method, path: path + url.search, ...(body && { body }) });
      const key = req.headers.get("x-api-key") ?? "";
      const deny = (permission: string) => Response.json({ message: `Missing required permission: ${permission}` }, { status: 403 });
      if (path === "/server/version") return Response.json({ major: 3, minor: 1, patch: 0, prerelease: null });
      if (!["good", "readonly", "admin"].includes(key)) return Response.json({ message: "Invalid API key", error: "Unauthorized", statusCode: 401 }, { status: 401 });
      const write = key !== "readonly";
      let m: RegExpExecArray | null;
      if (path === "/search/smart" && req.method === "POST") {
        const q = String(body!.query ?? "");
        if (!q) return Response.json({ message: "Either `query` or `queryAssetId` must be set" }, { status: 400 });
        const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
        return Response.json(page(filtered(body!).filter((a) => words.some((w) => a.title.includes(w))), body!));
      }
      if (path === "/search/metadata" && req.method === "POST") return Response.json(page(filtered(body!), body!));
      // Before the `/assets/{id}` routes, which would take "statistics" for an id.
      if (path === "/assets/statistics") return key === "admin" ? Response.json({ images: 60123, videos: 2345, total: 62468 }) : deny("asset.statistics");
      if ((m = /^\/assets\/([^/]+)\/thumbnail$/.exec(path))) {
        const n = Number(m[1].slice(0, 8));
        const big = url.searchParams.get("size") === "preview";
        return new Response(picture(n, big ? 288 : 96, big ? 216 : 72), { headers: { "content-type": big ? "image/jpeg" : "image/png" } });
      }
      if ((m = /^\/assets\/([^/]+)\/original$/.exec(path))) {
        const a = ASSETS.find((a) => a.id === m![1]);
        if (!a) return Response.json({ message: "Not found" }, { status: 404 });
        return new Response(Buffer.from(`ORIGINAL ${a.file}`), { headers: { "content-type": a.mime, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.file)}` } });
      }
      if ((m = /^\/assets\/([^/]+)$/.exec(path)) && req.method === "GET") {
        const a = ASSETS.find((a) => a.id === m![1]);
        if (!a) return Response.json({ message: "Not found" }, { status: 404 });
        return Response.json({ ...dto({ ...a, favorite: favorites.get(a.id) ?? a.favorite }, true), tags: [{ id: "t1", name: "takeout", value: "takeout" }], stack: null });
      }
      if (path === "/assets" && req.method === "PUT") {
        if (!write) return deny("asset.update");
        for (const id of body!.ids as string[]) { const a = ASSETS.find((a) => a.id === id); if (a) a.favorite = body!.isFavorite as boolean; }
        return new Response(null, { status: 204 });
      }
      if (path === "/server/statistics") return key === "admin" ? Response.json({ photos: 60123, videos: 2345, usage: 1234567890123, usagePhotos: 1, usageVideos: 2, usageByUser: [] }) : deny("server.statistics");
      if (path === "/users/me") return key === "admin" ? Response.json({ id: ME, name: "cagdas" }) : deny("user.read");
      if (path === "/albums" && req.method === "GET") {
        const assetId = url.searchParams.get("assetId");
        return Response.json(ALBUMS.filter((a) => !assetId || a.assets.includes(assetId)).map(albumDto));
      }
      if (path === "/albums" && req.method === "POST") {
        if (!write) return deny("album.create");
        const a: MockAlbum = { id: `a${ALBUMS.length + 1}`, name: String(body!.albumName), description: "", assets: [...((body!.assetIds as string[]) ?? [])], shared: false, owner: ME, modified: "2026-09-22T00:00:00.000Z" };
        ALBUMS.push(a);
        return Response.json(albumDto(a), { status: 201 });
      }
      if ((m = /^\/albums\/([^/]+)\/assets$/.exec(path)) && req.method === "PUT") {
        if (!write) return deny("albumAsset.create");
        const a = ALBUMS.find((a) => a.id === m![1]);
        if (!a) return Response.json({ message: "Not found" }, { status: 404 });
        return Response.json((body!.ids as string[]).map((id) => (a.assets.includes(id) ? { id, success: false, error: "duplicate" } : (a.assets.push(id), { id, success: true }))));
      }
      if ((m = /^\/albums\/([^/]+)$/.exec(path))) { const a = ALBUMS.find((a) => a.id === m![1]); return a ? Response.json(albumDto(a)) : Response.json({ message: "Not found" }, { status: 404 }); }
      if (path === "/people" && req.method === "GET") {
        const visible = PEOPLE.filter((p) => !p.isHidden || url.searchParams.get("withHidden") === "true");
        return Response.json({ people: visible.map((p) => person(p.id)), hasNextPage: false, total: PEOPLE.length, hidden: PEOPLE.filter((p) => p.isHidden).length });
      }
      if ((m = /^\/people\/([^/]+)\/thumbnail$/.exec(path))) return new Response(picture(100 + Number(m[1].slice(1)), 64, 64), { headers: { "content-type": "image/jpeg" } });
      if (path === "/memories") {
        const day = url.searchParams.get("for") ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return Response.json({ message: "Validation failed" }, { status: 400 });
        const list = day.endsWith("09-22") ? MEMORIES : [];
        return Response.json(list.map((mm) => ({ id: mm.id, createdAt: `${day}T00:00:01.683Z`, updatedAt: `${day}T00:00:01.683Z`, memoryAt: `${mm.year}-09-22T00:00:00.000Z`, showAt: `${day}T00:00:00.000Z`, hideAt: `${day}T23:59:59.999Z`, ownerId: ME, type: "on_this_day", data: { year: mm.year }, isSaved: false, assets: mm.assets.map((id) => dto(ASSETS.find((a) => a.id === id)!, false)) })));
      }
      return Response.json({ message: `Cannot ${req.method} ${path}`, error: "Not Found", statusCode: 404 }, { status: 404 });
    },
  });
  return { server, requests, base: `http://127.0.0.1:${server.port}`, uuid };
}
