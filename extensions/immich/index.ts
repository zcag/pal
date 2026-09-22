// Immich: the photo library from the panel. One input grid over the CLIP
// search (nothing typed: the newest uploads; a file name: a name search;
// `since:` / `before:` / `in:` narrow it; the dropdown picks photos,
// videos, favourites or the archive), every tile Immich's own thumbnail
// fetched once into the cache directory and sent as a data url, titled
// with the day and the place. The pane (open by default) shows the
// preview large with the EXIF, the people and the albums. Enter opens the
// photo in Immich; the rest copies the link or the picture, downloads the
// preview or the original, favourites, adds to an album, Quick Looks.
// Albums, people and today's memories are lists of their own whose Enter
// pushes the same grid scoped to them (`ctx.args`), so a search there runs
// inside the album or the person. `pal://immich/search`, `/album` and
// `/person` open the grids from outside.
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { bytes, copyImage, effects, errorMessage, hint, home, settings, thumbnailUrl, tilde, toast, type Action, type Ctx, type Detail, type Effect, type Extension, type Item, type LinkParams, type Metadata } from "@zcag/pal";
import { addToAlbum, albums as fetchAlbums, albumsOf, albumUrl, asset as fetchAsset, clientOf, clip, createAlbum, downloadName, face, ImmichError, libraryUrl, mapUrl, me, memories as fetchMemories, memoryUrl, original, parseQuery, people as fetchPeople, personUrl, photoUrl, preview, search, setFavorite, stats as fetchStats, takenClock, takenDay, takenIso, thumbnail, type Album, type Asset, type Client, type Memory, type Person, type Query, type Scope } from "./api.ts";

/** `[extensions.immich]`, defaults in pal.json. */
type Settings = { url: string; api_key: string; web_url: string; download_to: string };
type PaletteSettings = { columns: number };

/** Material Design glyphs from the bundled Nerd Font; the tile's indigo tints them. */
const GLYPH = {
  photo: "\u{f02e9}", // md-image
  video: "\u{f0567}", // md-video
  album: "\u{f02ea}", // md-image_album
  person: "\u{f0004}", // md-account
  people: "\u{f0849}", // md-account_group
  memory: "\u{f02da}", // md-history
  library: "\u{f01bc}", // md-database
  more: "\u{f01d8}", // md-dots_horizontal
  plus: "\u{f0415}", // md-plus
  alert: "\u{f05d6}", // md-alert_circle_outline
  wait: "\u{f051f}", // md-timer_sand
  cog: "\u{f0493}", // md-cog
  none: "\u{f082b}", // md-image_off
};

const EXT = "immich";
const MAC = process.platform === "darwin";
const DEBOUNCE_MS = 300;
/** Thumbnails kept in memory as data urls, and on disk (~10 KB each). */
const THUMBS_MEMORY = 600;
const THUMBS_DISK = 3000;
const PREVIEWS_DISK = 200;
/** Fetches in flight against the server at once. */
const POOL = 6;
/** Covers and faces fetched for a list (each rides the wire as a ~20 KB data url): the rest of a long album list keep their glyph. */
const COVERS_MAX = 60;
const FACES_MAX = 150;
const CACHE = process.env.PAL_IMMICH_CACHE || (MAC ? home("~/Library/Caches/pal/immich") : join(process.env.XDG_CACHE_HOME || home("~/.cache"), "pal/immich"));

const S = () => settings.get<Settings>(EXT);
const client = (): Client | undefined => clientOf(S());
const columns = () => settings.palette<PaletteSettings>("immich", EXT).columns;

// ---- the cache directory --------------------------------------------------------------------

const writes = new Map<string, number>();
/** `<CACHE>/<sub>/<file>`: the bytes on disk, else fetched and written; the directory is pruned to `max` files (oldest first) every hundred writes. */
async function cached(sub: "thumbs" | "previews" | "faces", file: string, fetcher: () => Promise<Buffer>, max: number): Promise<Buffer> {
  const dir = join(CACHE, sub), path = join(dir, file);
  const have = await readFile(path).catch(() => undefined);
  if (have?.length) return have;
  const b = await fetcher();
  await mkdir(dir, { recursive: true });
  await writeFile(path, b);
  const n = (writes.get(sub) ?? 0) + 1;
  writes.set(sub, n);
  if (n % 100 === 0) prune(dir, max).catch(() => {});
  return b;
}

/** Delete the oldest files past `max`, down to 80% of it. */
async function prune(dir: string, max: number): Promise<void> {
  const names = await readdir(dir);
  if (names.length <= max) return;
  const aged = await Promise.all(names.map(async (n) => ({ n, at: (await stat(join(dir, n)).catch(() => ({ mtimeMs: 0 }))).mtimeMs })));
  aged.sort((a, b) => a.at - b.at);
  for (const f of aged.slice(0, names.length - Math.floor(max * 0.8))) await unlink(join(dir, f.n)).catch(() => {});
}

/** A few at a time, in order: a listing of 24 tiles is 24 requests, and the server is small. */
async function pool<T, R>(items: T[], fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(POOL, items.length) }, async () => { for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i); }));
  return out;
}

/** A cached file comes back without its content type: the magic bytes say (Immich's thumbnails are WebP, its face crops JPEG). */
const mimeOf = (b: Buffer): string => (b.subarray(8, 12).toString("latin1") === "WEBP" ? "image/webp" : b[0] === 0x89 ? "image/png" : b.subarray(0, 4).toString("latin1") === "GIF8" ? "image/gif" : "image/jpeg");

const thumbs = new Map<string, string>();
/** The tile's picture as a data url: memory, the cache directory, then Immich; undefined when the fetch failed (the tile keeps its glyph). */
async function thumb(c: Client, kind: "thumbs" | "faces", id: string): Promise<string | undefined> {
  const key = `${kind}:${id}`;
  const hit = thumbs.get(key);
  if (hit) return hit;
  try {
    const b = await cached(kind, `${id}.${kind === "faces" ? "jpg" : "webp"}`, async () => (await (kind === "faces" ? face(c, id) : thumbnail(c, id))).bytes, THUMBS_DISK);
    const url = `data:${mimeOf(b)};base64,${b.toString("base64")}`;
    if (thumbs.size >= THUMBS_MEMORY) thumbs.delete(thumbs.keys().next().value!);
    thumbs.set(key, url);
    return url;
  } catch (e) { console.error(`[immich] ${kind} ${id}: ${errorMessage(e)}`); return; }
}

/** The preview JPEG on disk (fetched once), for the pane, the clipboard, Quick Look and a download. */
const previewFile = async (c: Client, id: string): Promise<string> => { await cached("previews", `${id}.jpg`, async () => (await preview(c, id)).bytes, PREVIEWS_DISK); return join(CACHE, "previews", `${id}.jpg`); };

// ---- rows ---------------------------------------------------------------------------------------

const OPEN: Action = { id: "open", title: "Open in Immich" };
const COPY_LINK: Action = { id: "link", title: "Copy link" };
const COPY_IMAGE: Action = { id: "image", title: "Copy image", shortcut: "cmd+shift+c" };
const DOWNLOAD: Action = { id: "download", title: "Download preview", shortcut: "cmd+s", multi: true };
const DOWNLOAD_ORIGINAL: Action = { id: "original", title: "Download original", shortcut: "cmd+shift+s", multi: true };
const FAV: Action = { id: "fav", title: "Favourite", shortcut: "cmd+f", multi: true };
const UNFAV: Action = { id: "unfav", title: "Unfavourite", shortcut: "cmd+f", multi: true };
const ALBUM: Action = { id: "album", title: "Add to album…", shortcut: "cmd+shift+a", multi: true };
const QUICK_LOOK: Action = { id: "quick-look", title: "Quick Look", shortcut: "cmd+y" };
const COPY_FILE: Action = { id: "file", title: "Copy file name", shortcut: "cmd+shift+f" };
const MORE: Action = { id: "more", title: "Load more" };

const assetActions = (a: Asset): Action[] => [OPEN, COPY_LINK, COPY_IMAGE, ...(MAC ? [QUICK_LOOK] : []), DOWNLOAD, DOWNLOAD_ORIGINAL, a.favorite ? UNFAV : FAV, ALBUM, COPY_FILE];

/** What the last listings showed, by id: `pick` and `detail` need the asset. */
const held = new Map<string, Asset>();

/** "Serdivan · 3 May 2022" on a photo (the place first: a narrow cell cuts the caption, and the town tells the pictures apart where the day does not; the footer shows the whole line on the selected tile); "▶ 0:31 · 13 May 2026" on a video, which has no room left for the place. */
const titleOf = (a: Asset): string => (a.kind === "video" ? `▶ ${[a.duration !== undefined ? clip(a.duration) : "", takenDay(a.taken)].filter(Boolean).join(" · ")}` : [a.place?.split(",")[0], takenDay(a.taken)].filter(Boolean).join(" · "));

async function tile(c: Client, a: Asset, section?: string): Promise<Item> {
  held.set(a.id, a);
  const pic = await thumb(c, "thumbs", a.id);
  // Nothing of an input palette is indexed, so the tile carries no keywords; the subtitle names the file in the action panel.
  return { id: a.id, name: titleOf(a), subtitle: a.file, icon: pic ? { image: pic } : a.kind === "video" ? GLYPH.video : GLYPH.photo, ...(section && { section }), detail: { metadata: metadataOf(a) }, actions: assetActions(a) };
}

/** The pane's facts from what the listing knows; `detail(id)` adds the people, the albums and the picture. */
function metadataOf(a: Asset, albums?: Album[]): Metadata[] {
  const m: Metadata[] = [];
  const flags = [...(a.favorite ? [{ text: "favourite", color: "amber" }] : []), ...(a.archived ? [{ text: "archived", color: "grey" }] : []), ...(a.kind === "video" ? [{ text: "video", color: "blue" }] : [])];
  m.push({ label: "Taken", value: `${takenDay(a.taken)} ${takenClock(a.taken)}`, ...(flags.length && { tags: flags }) });
  if (a.place) m.push(mapUrl(a) ? { label: "Place", link: { text: a.place, href: mapUrl(a)! } } : { label: "Place", value: a.place });
  if (a.camera) m.push({ label: "Camera", value: a.camera });
  if (a.lens) m.push({ label: "Lens", value: a.lens });
  if (a.exposure) m.push({ label: "Exposure", value: a.exposure });
  const size = [a.width && a.height ? `${a.width} × ${a.height}` : "", a.bytes ? bytes(a.bytes) : "", a.mime.split("/")[1]?.toUpperCase() ?? ""].filter(Boolean).join(" · ");
  if (size) m.push({ label: "Size", value: size });
  if (a.kind === "video" && a.duration !== undefined) m.push({ label: "Length", value: clip(a.duration) });
  m.push({ label: "File", value: a.file });
  if (a.people.length || a.faces) m.push({ label: "People", tags: [...a.people.map((p) => ({ text: p, color: "teal" })), ...(a.faces > a.people.length ? [{ text: `${a.faces - a.people.length} unnamed`, color: "grey" }] : [])] });
  if (albums?.length) m.push({ label: "Albums", tags: albums.map((x) => ({ text: x.name, color: "violet" })) });
  if (a.tags.length) m.push({ label: "Tags", tags: a.tags.map((t) => ({ text: t })) });
  if (a.description) m.push({ label: "Description", value: a.description });
  return m;
}

/** A row that opens Settings on the missing field: the empty state of every palette while `url` or `api_key` is blank. */
const setupRow = (): Item => ({ id: "setup", name: "Set url and api_key under Settings › Extensions › Immich", subtitle: "Where Immich answers, and an API key from Account Settings › API Keys", icon: GLYPH.cog, actions: [{ id: "settings", title: "Open Settings" }] });
const settingsOpen = (): Effect => { const s = S(); return { open: `pal://settings/extensions?anchor=extensions:${EXT}:${s.url?.trim() ? "api_key" : "url"}` }; };
const failedRow = (e: unknown, sub?: string): Item => { const ie = e instanceof ImmichError ? e : undefined; console.error(`[immich] ${ie?.message ?? errorMessage(e)}`); return hint("failed", ie ? ie.hint : `Could not reach Immich: ${errorMessage(e)}`, sub ?? "cmd+r tries again", { icon: GLYPH.alert }); };

// ---- the grid ---------------------------------------------------------------------------------

/** What a pushed level is scoped to (`Effect.push` args): an album, a person, a memory (its assets came with the memory), and the crumb. */
type Args = { album?: string; person?: string; memory?: string; title?: string };
const FILTERS = [{ id: "all", title: "All" }, { id: "photos", title: "Photos" }, { id: "videos", title: "Videos" }, { id: "favourites", title: "Favourites" }, { id: "archived", title: "Archived" }];
/** The dropdown's choice and the level's args as a search scope; the query's own `type:` / `is:` words win over the dropdown. */
const scopeOf = (args: Args | undefined, filter: string | undefined, q: Query): Scope => ({
  ...(args?.album && { album: args.album }), ...(args?.person && { person: args.person }),
  ...(filter === "photos" && { type: "IMAGE" as const }), ...(filter === "videos" && { type: "VIDEO" as const }), ...(filter === "favourites" && { favorite: true as const }), ...(filter === "archived" && { archived: true as const }),
  ...(q.type && { type: q.type }), ...(q.favorite && { favorite: true as const }), ...(q.archived && { archived: true as const }),
});

/** The pages fetched per listing key (a query, a scope), so More appends and a relist costs nothing; `wanted` is how many pages a key shows. */
const pages = new Map<string, { pages: Asset[][]; more: boolean }>();
const wanted = new Map<string, number>();
const PAGES_MAX = 50;
/** The More tile's id names its listing (`more:<hash>`), so a pick pages that one whatever was listed since. */
const moreKeys = new Map<string, string>();
let seq = 0;
const memoryAssets = new Map<string, Memory>();

async function list(query = "", ctx?: Ctx): Promise<Item[]> {
  const c = client();
  if (!c) return [setupRow()];
  const args = ctx?.args as Args | undefined;
  const q = parseQuery(query);
  const scope = scopeOf(args, ctx?.filter, q);
  const key = JSON.stringify([q, scope, args?.memory ?? ""]);
  if (ctx?.refresh) { pages.delete(key); wanted.delete(key); }
  // A memory's assets came with it: filtered here, never searched.
  if (args?.memory) {
    const m = memoryAssets.get(args.memory);
    if (!m) return [hint("gone", "Open On This Day again", "The memory's photos are listed from it", { icon: GLYPH.memory })];
    const words = [q.text, q.file].filter(Boolean).join(" ").toLowerCase();
    const rows = m.assets.filter((a) => (!scope.type || a.kind === (scope.type === "VIDEO" ? "video" : "image")) && (!scope.favorite || a.favorite) && (!words || `${a.file} ${a.place ?? ""} ${a.people.join(" ")}`.toLowerCase().includes(words)));
    return rows.length ? pool(rows, (a) => tile(c, a)) : [hint("none", "Nothing matches", args.title, { icon: GLYPH.none })];
  }
  const my = ++seq;
  if ((q.text || q.file) && !ctx?.inline) {
    await Bun.sleep(DEBOUNCE_MS);
    if (my !== seq) return [hint("wait", "Searching…", q.text || q.file, { icon: GLYPH.wait })];
  }
  const want = wanted.get(key) ?? 1;
  const got = pages.get(key) ?? { pages: [], more: true };
  try {
    for (let p = got.pages.length; p < want && got.more; p++) {
      const r = await search(c, q, scope, p + 1);
      got.pages.push(r.assets);
      got.more = r.more && r.assets.length > 0;
      if (!pages.has(key) && pages.size >= PAGES_MAX) pages.delete(pages.keys().next().value!);
      pages.set(key, got);
    }
  } catch (e) {
    if (!got.pages.length) return [failedRow(e, q.text || q.file || undefined)];
  }
  if (my !== seq) return [hint("wait", "Searching…", q.text || q.file, { icon: GLYPH.wait })];
  const assets = got.pages.flat();
  if (!assets.length) return [hint("none", q.text ? `Nothing looks like “${q.text}”` : q.file ? `No file named like “${q.file}”` : "No photos here", args?.title ?? (scope.archived ? "The archive" : "Immich"), { icon: GLYPH.none })];
  const section = !q.text && !q.file && !args ? "Recent" : undefined;
  const rows = await pool(assets, (a) => tile(c, a, section));
  if (got.more) {
    const id = `more:${Bun.hash(key).toString(36)}`;
    moreKeys.set(id, key);
    rows.push({ id, name: "More…", subtitle: `${assets.length} shown`, icon: GLYPH.more, ...(section && { section }), actions: [MORE] });
  }
  return rows;
}

/** The asset a pick names: the listing's, else fetched (a pick after a restart, a link). */
async function assetOf(c: Client, id: string): Promise<Asset> {
  const a = held.get(id);
  if (a) return a;
  const fresh = await fetchAsset(c, id);
  held.set(id, fresh);
  return fresh;
}

/** `<download_to>/<date>_<name>`, a taken name getting `-2`. */
async function downloadPath(a: Asset, ext?: string): Promise<string> {
  const dir = downloadDir();
  await mkdir(dir, { recursive: true });
  const name = downloadName(a, ext), dot = name.lastIndexOf(".");
  let path = join(dir, name);
  for (let n = 2; await stat(path).then(() => true, () => false); n++) path = join(dir, `${name.slice(0, dot)}-${n}${name.slice(dot)}`);
  return path;
}

const downloadDir = () => home(S().download_to?.trim() || "~/Downloads");
/** "Saved 2022-05-03_IMG_1234.jpg to ~/Downloads", or the count. */
const savedLine = (names: string[], what: string, of = names.length) => `Saved ${names.length === 1 && of === 1 ? names[0] : of !== names.length ? `${names.length} of ${of} ${what}` : `${names.length} ${what}`} to ${tilde(downloadDir())}`;

async function downloadPreviews(c: Client, assets: Asset[]): Promise<Effect> {
  const names: string[] = [];
  for (const a of assets) {
    const path = await downloadPath(a, "jpg");
    await writeFile(path, await readFile(await previewFile(c, a.id)));
    names.push(basename(path));
  }
  return { hud: savedLine(names, "previews") };
}

/** Originals are big (a raw is 30 MB): the panel goes down at once and the HUD says when they landed. */
function downloadOriginals(c: Client, assets: Asset[]): Effect {
  (async () => {
    const names: string[] = [];
    for (const a of assets) {
      try {
        const o = await original(c, a.id);
        const path = await downloadPath({ ...a, file: o.name ?? a.file });
        await writeFile(path, o.bytes);
        names.push(basename(path));
      } catch (e) { console.error(`[immich] original ${a.id}: ${errorMessage(e)}`); }
    }
    await effects.run({ hud: names.length ? savedLine(names, "originals", assets.length) : `Could not download ${assets.length === 1 ? assets[0].file : `${assets.length} originals`}` }).catch(() => {});
  })();
  return { hud: assets.length === 1 ? `Downloading ${assets[0].file}…` : `Downloading ${assets.length} originals…` };
}

async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect> {
  if (id === "setup") return settingsOpen();
  if (id.startsWith("hint:")) return { keep: true };
  const c = client();
  if (!c) return settingsOpen();
  if (id.startsWith("more:")) { const key = moreKeys.get(id); if (key) wanted.set(key, (pages.get(key)?.pages.length ?? 1) + 1); return { keep: true }; }
  const ids = ctx?.ids ?? [id];
  let assets: Asset[];
  try { assets = await Promise.all(ids.map((x) => assetOf(c, x))); }
  catch (e) { return failure("find the photo", e); }
  const a = assets[0];
  try {
    switch (action) {
      case "link": return { copy: ids.map((x) => photoUrl(c, x)).join("\n") };
      case "file": return { copy: assets.map((x) => x.file).join("\n") };
      case "image": { const p = await previewFile(c, a.id); return (await copyImage(p)) ? { hud: "Image copied" } : { copy_files: [p], hud: "Copied as a file" }; }
      case "quick-look": { const p = await previewFile(c, a.id); Bun.spawn(["qlmanage", "-p", p], { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref(); return { hide: true }; }
      case "download": return await downloadPreviews(c, assets);
      case "original": return downloadOriginals(c, assets);
      case "fav": case "unfav": {
        const on = action === "fav";
        await setFavorite(c, ids, on);
        for (const x of assets) x.favorite = on;
        return { keep: true, toast: { title: on ? "Favourited" : "Unfavourited", message: assets.length === 1 ? titleOf(a) : `${assets.length} photos` } };
      }
      case "album": return { push: { extension: EXT, palette: "albums", args: { add: ids, title: assets.length === 1 ? titleOf(a) : `${assets.length} photos` }, title: "Add to album" } };
      default: return { open: photoUrl(c, a.id) };
    }
  } catch (e) { return failure(action ?? "open", e); }
}

const failure = (what: string, e: unknown): Effect => toast(`Could not ${what}`, e instanceof ImmichError ? e.hint : errorMessage(e), "failure");

/** The pane: the preview from the cache directory through the core's file route, the fresh asset (its people and tags come with `/assets/{id}`), the albums it is in. */
async function detail(id: string): Promise<Detail | void> {
  const c = client();
  if (!c || !held.has(id)) return;
  const [fresh, albums, pic] = await Promise.all([fetchAsset(c, id).catch(() => undefined), albumsOf(c, id).catch(() => [] as Album[]), previewFile(c, id).catch(() => undefined)]);
  // The listing's object is the one `pick` and a relist read: the fresh facts land on it rather than beside it.
  const a = Object.assign(held.get(id)!, fresh);
  return { markdown: pic ? `![${a.file}](${thumbnailUrl(pic, 0)})` : undefined, metadata: metadataOf(a, albums) };
}

// ---- albums -------------------------------------------------------------------------------------

const heldAlbums = new Map<string, Album>();
const ALBUM_OPEN: Action = { id: "open", title: "Open the album" };
const ALBUM_WEB: Action = { id: "web", title: "Open in Immich" };
const ALBUM_LINK: Action = { id: "link", title: "Copy link", shortcut: "cmd+c" };
const ALBUM_ADD: Action = { id: "add", title: "Add here" };

const range = (a: Album): string => (a.start && a.end ? (takenIso(a.start) === takenIso(a.end) ? takenDay(a.start) : `${takenDay(a.start)} – ${takenDay(a.end)}`) : "");
const countOf = (n: number, what: string) => `${n.toLocaleString("en-US")} ${what}${n === 1 ? "" : "s"}`;

async function albumRow(c: Client, a: Album, cover: boolean, picker: boolean): Promise<Item> {
  heldAlbums.set(a.id, a);
  const pic = cover && a.cover ? await thumb(c, "thumbs", a.cover) : undefined;
  return {
    id: a.id, name: a.name, subtitle: [countOf(a.count, "item"), range(a), a.description].filter(Boolean).join(" · "), icon: pic ? { image: pic } : GLYPH.album,
    keywords: ["album"], accessories: a.shared ? [{ tag: "shared", color: "blue" }] : undefined,
    actions: picker ? [ALBUM_ADD, ALBUM_WEB] : [ALBUM_OPEN, ALBUM_WEB, ALBUM_LINK],
  };
}

/** The library's numbers as one row; nothing when the key may read neither statistics endpoint. */
async function statsRow(c: Client): Promise<Item | undefined> {
  const s = await fetchStats(c).catch(() => undefined);
  if (!s || (s.images === undefined && s.videos === undefined && s.usage === undefined)) return;
  const bits = [s.images !== undefined ? countOf(s.images, "photo") : "", s.videos !== undefined ? countOf(s.videos, "video") : "", s.usage !== undefined ? bytes(s.usage) : ""].filter(Boolean);
  return { id: "library", name: "Immich library", subtitle: bits.join(" · "), icon: GLYPH.library, keywords: ["photos", "stats"], actions: [{ id: "web", title: "Open in Immich" }] };
}

/** The albums and the people for a minute (a picker, a link, a relist), the search pages per key: all of it is one server's, so a settings change drops it. */
let albumsCache: { at: number; list: Album[] } | undefined;
let peopleCache: { at: number; list: Person[] } | undefined;
settings.onChange(() => { albumsCache = peopleCache = undefined; pages.clear(); wanted.clear(); thumbs.clear(); }, EXT);

async function allAlbums(c: Client, refresh?: boolean): Promise<Album[]> {
  if (albumsCache && !refresh && Date.now() - albumsCache.at < 60_000) return albumsCache.list;
  const list = await fetchAlbums(c, await me(c));
  albumsCache = { at: Date.now(), list };
  return list;
}

async function albumRows(_query = "", ctx?: Ctx): Promise<Item[]> {
  const c = client();
  if (!c) return [setupRow()];
  const args = ctx?.args as { add?: string[]; title?: string } | undefined;
  try {
    const list = await allAlbums(c, ctx?.refresh);
    if (args?.add) {
      const mine = list.filter((a) => a.owned);
      const rows = await pool(mine, (a, i) => albumRow(c, a, i < COVERS_MAX && a.count > 0, true));
      return [{ id: "new", name: "New album…", subtitle: args.title ? `With ${args.title}` : undefined, icon: GLYPH.plus, actions: [{ id: "new", title: "Create and add" }] }, ...rows];
    }
    const filled = list.filter((a) => a.count > 0), empty = list.filter((a) => a.count === 0);
    const rows = await pool(filled, (a, i) => albumRow(c, a, i < COVERS_MAX, false));
    const stats = await statsRow(c);
    for (const a of empty) rows.push(await albumRow(c, a, false, false));
    if (!rows.length) return [hint("none", "No albums yet", "Make one in Immich and it lists here", { icon: GLYPH.album })];
    return stats ? [stats, ...rows] : rows;
  } catch (e) { return [failedRow(e)]; }
}

async function albumPick(id: string, action?: string, ctx?: Ctx): Promise<Effect> {
  if (id === "setup") return settingsOpen();
  if (id.startsWith("hint:")) return { keep: true };
  const c = client();
  if (!c) return settingsOpen();
  if (id === "library") return { open: libraryUrl(c) };
  const args = ctx?.args as { add?: string[]; title?: string } | undefined;
  if (id === "new") {
    const name = String(ctx?.values?.name ?? "").trim();
    if (!name) return { form: { id: "new", title: "New album", fields: [{ kind: "text", id: "name", label: "Name", required: true, placeholder: "Trip to Bolu" }], submit: { id: "create", title: "Create" } } };
    try {
      const a = await createAlbum(c, name, args?.add ?? []);
      albumsCache = undefined;
      return { hud: args?.add?.length ? `Added ${args.title ?? countOf(args.add.length, "photo")} to the new album ${a.name}` : `Created ${a.name}` };
    } catch (e) { return failure("create the album", e); }
  }
  const a = heldAlbums.get(id);
  if (!a) return toast("Album is gone", "The listing changed; pick again", "failure");
  switch (action) {
    case "web": return { open: albumUrl(c, a.id) };
    case "link": return { copy: albumUrl(c, a.id) };
    case "add": {
      if (!args?.add?.length) return { push: { extension: EXT, palette: "immich", args: { album: a.id, title: a.name }, title: a.name } };
      try {
        const r = await addToAlbum(c, a.id, args.add);
        albumsCache = undefined;
        if (r.failed.length && !r.added) return toast(`Could not add to ${a.name}`, r.failed[0], "failure");
        // The selection's title names it only when the whole selection is one photo; a partial add counts.
        const what = args.add.length === 1 ? args.title ?? "the photo" : countOf(r.added, "photo");
        return { hud: r.added ? `Added ${what} to ${a.name}${r.there ? ` (${r.there} already there)` : ""}` : `Already in ${a.name}` };
      } catch (e) { return failure(`add to ${a.name}`, e); }
    }
    default: return { push: { extension: EXT, palette: "immich", args: { album: a.id, title: a.name }, title: a.name } };
  }
}

// ---- people --------------------------------------------------------------------------------------

const heldPeople = new Map<string, Person>();
const PERSON_OPEN: Action = { id: "open", title: "The person's photos" };
const PERSON_WEB: Action = { id: "web", title: "Open in Immich" };
const PERSON_LINK: Action = { id: "link", title: "Copy link", shortcut: "cmd+c" };

async function allPeople(c: Client, refresh?: boolean): Promise<Person[]> {
  if (peopleCache && !refresh && Date.now() - peopleCache.at < 60_000) return peopleCache.list;
  const list = await fetchPeople(c);
  peopleCache = { at: Date.now(), list };
  return list;
}

async function peopleRows(_query = "", ctx?: Ctx): Promise<Item[]> {
  const c = client();
  if (!c) return [setupRow()];
  try {
    const list = await allPeople(c, ctx?.refresh);
    const named = list.filter((p) => p.name), unnamed = list.length - named.length;
    const rows = await pool(named, async (p, i): Promise<Item> => {
      heldPeople.set(p.id, p);
      const pic = i < FACES_MAX ? await thumb(c, "faces", p.id) : undefined;
      return { id: p.id, name: p.name, subtitle: p.birthDate ? `Born ${p.birthDate}` : undefined, icon: pic ? { image: pic } : GLYPH.person, keywords: ["person", "people"], accessories: p.favorite ? [{ tag: "favourite", color: "amber" }] : undefined, actions: [PERSON_OPEN, PERSON_WEB, PERSON_LINK] };
    });
    if (unnamed) rows.push({ id: "unnamed", name: `${countOf(unnamed, "face")} without a name`, subtitle: "Name them in Immich and they list here", icon: GLYPH.people, actions: [{ id: "web", title: "Open People in Immich" }] });
    if (!rows.length) return [hint("none", "No people yet", "Immich names faces once face recognition has run", { icon: GLYPH.people })];
    return rows;
  } catch (e) { return [failedRow(e)]; }
}

async function peoplePick(id: string, action?: string): Promise<Effect> {
  if (id === "setup") return settingsOpen();
  if (id.startsWith("hint:")) return { keep: true };
  const c = client();
  if (!c) return settingsOpen();
  if (id === "unnamed") return { open: `${c.web}/people` };
  const p = heldPeople.get(id);
  if (!p) return toast("Person is gone", "The listing changed; pick again", "failure");
  switch (action) {
    case "web": return { open: personUrl(c, p.id) };
    case "link": return { copy: personUrl(c, p.id) };
    default: return { push: { extension: EXT, palette: "immich", args: { person: p.id, title: p.name }, title: p.name } };
  }
}

// ---- memories -------------------------------------------------------------------------------------

const MEMORY_OPEN: Action = { id: "open", title: "That year's photos" };
const MEMORY_WEB: Action = { id: "web", title: "Open in Immich" };

/** Today as `YYYY-MM-DD` on this machine's clock (`PAL_NOW` pins it for the tests). */
const today = (): string => { const d = process.env.PAL_NOW ? new Date(process.env.PAL_NOW) : new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

async function memoryRows(): Promise<Item[]> {
  const c = client();
  if (!c) return [setupRow()];
  try {
    const list = await fetchMemories(c, today());
    if (!list.length) return [hint("none", "No memories today", "Immich shows On this day once a past year has photos of today's date", { icon: GLYPH.memory })];
    const year = Number(today().slice(0, 4));
    return pool(list, async (m): Promise<Item> => {
      memoryAssets.set(m.id, m);
      for (const a of m.assets) held.set(a.id, a);
      const places = [...new Set(m.assets.map((a) => a.place?.split(",")[0]).filter(Boolean))].slice(0, 3).join(", ");
      const pic = m.assets[0] ? await thumb(c, "thumbs", m.assets[0].id) : undefined;
      const ago = year - m.year;
      return { id: m.id, name: `${ago === 1 ? "A year" : `${ago} years`} ago, ${m.year}`, subtitle: [countOf(m.assets.length, "photo"), places].filter(Boolean).join(" · "), icon: pic ? { image: pic } : GLYPH.memory, keywords: [String(m.year), "memory", "on this day"], actions: [MEMORY_OPEN, MEMORY_WEB] };
    });
  } catch (e) { return [failedRow(e)]; }
}

async function memoryPick(id: string, action?: string): Promise<Effect> {
  if (id === "setup") return settingsOpen();
  if (id.startsWith("hint:")) return { keep: true };
  const c = client();
  if (!c) return settingsOpen();
  const m = memoryAssets.get(id);
  if (!m) return toast("Memory is gone", "The listing changed; pick again", "failure");
  if (action === "web") return { open: memoryUrl(c) };
  const title = `On this day, ${m.year}`;
  return { push: { extension: EXT, palette: "immich", args: { memory: m.id, title }, title } };
}

// ---- links ------------------------------------------------------------------------------------------

/** A link's `filter` as the word the query grammar reads: a push cannot set the level's dropdown. */
const FILTER_WORD: Record<string, string> = { all: "", photos: "type:photo", videos: "type:video", favourites: "is:favourite", favorites: "is:favourite", archived: "is:archived" };

async function link(route: string, params: LinkParams): Promise<Effect | void> {
  const c = client();
  if (!c) throw new Error("immich: set url and api_key under Settings › Extensions › Immich");
  const named = (v: unknown) => String(v ?? "").trim();
  if (route === "search") {
    const q = named(params.q), filter = named(params.filter).toLowerCase();
    if (filter && !(filter in FILTER_WORD)) throw new Error(`immich/search: filter is one of ${Object.keys(FILTER_WORD).join(", ")}`);
    return { push: { extension: EXT, palette: "immich", query: [q, FILTER_WORD[filter] ?? ""].filter(Boolean).join(" ") } };
  }
  if (route === "album") {
    const id = named(params.id), name = named(params.name).toLowerCase();
    if (!id && !name) throw new Error("immich/album: name or id is required");
    const list = await allAlbums(c);
    const a = id ? list.find((x) => x.id === id) : list.find((x) => x.name.toLowerCase() === name) ?? list.find((x) => x.name.toLowerCase().includes(name));
    if (!a) throw new Error(`no album ${id ? id : `"${params.name}"`}`);
    return { push: { extension: EXT, palette: "immich", args: { album: a.id, title: a.name }, title: a.name } };
  }
  if (route === "person") {
    const id = named(params.id), name = named(params.name).toLowerCase();
    if (!id && !name) throw new Error("immich/person: name or id is required");
    const list = await allPeople(c);
    const p = id ? list.find((x) => x.id === id) : list.find((x) => x.name.toLowerCase() === name) ?? list.find((x) => x.name.toLowerCase().includes(name));
    if (!p) throw new Error(`no person ${id ? id : `"${params.name}"`}`);
    return { push: { extension: EXT, palette: "immich", args: { person: p.id, title: p.name }, title: p.name } };
  }
}

export default {
  palettes: {
    immich: {
      title: "Immich",
      input: true,
      view: "grid",
      // Palette meta is read once at load, so a change here shows after the extension reloads.
      columns: columns(),
      showDetail: true,
      placeholder: "What is in the picture (a file name, since:2025, in:Istanbul)",
      filters: FILTERS,
      fallback: "Search Immich for “{query}”",
      list,
      pick,
      detail,
    },
    albums: {
      title: "Immich Albums",
      placeholder: "Search albums",
      list: albumRows,
      pick: albumPick,
    },
    people: {
      title: "Immich People",
      placeholder: "Search people",
      list: peopleRows,
      pick: peoplePick,
    },
    memories: {
      title: "On This Day",
      live: true,
      placeholder: "Search memories",
      list: memoryRows,
      pick: memoryPick,
    },
  },
  link,
} satisfies Extension;
