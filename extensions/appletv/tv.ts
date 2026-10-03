// What every part of the extension shares: the paired Apple TVs and which
// is current, the one connection to it (opened on first use, kept while a
// view, the bar item or Stay connected wants it, closed once nothing has
// for a while), the TV's apps with their pictures, the cover of what plays
// with the tone it gives, and the redraw loop: every view level of ours
// that is open is redrawn by the renderer its palette registered whenever
// the TV tells something (`push`), a burst being one redraw, and the bar
// item with it when it changed. The palettes' own modules (index.ts,
// now.ts, play.ts, pairing.ts) keep their state and register here.
import { bar, errorMessage, failed, imageData, settings, state, storage, view as liveView, type BarItem, type Effect, type View } from "@zcag/pal";
import { placeholderArt, wideArt } from "./art.ts";
import { fakeDriver } from "./fake.ts";
import { backdrop, decodeJpeg, dominant, pngData, rounded, type RGB } from "./image.ts";
import type { App, Conn, Driver, Paired } from "./types.ts";

export const NAME = "appletv";

/** `[extensions.appletv]`, defaults in pal.json. */
export type Settings = { device: string; favorites: string[]; skip: number; wake: boolean; stay: boolean };
/** The bar item's own settings. */
export type BarSettings = { when: "playing" | "awake"; artwork: boolean };
export const cfg = (): Settings => settings.get<Settings>(NAME);

let driverP: Promise<Driver> | undefined;
/** The real driver, loaded on first use (it pulls in the protocol stack); the fake one when a test says so. */
export const driver = (): Promise<Driver> => (driverP ??= process.env.PAL_APPLETV_FAKE ? Promise.resolve(fakeDriver(process.env.PAL_APPLETV_FAKE)) : import("./device.ts").then((m) => m.realDriver));

/** An error as a sentence the views can show. */
export const plain = (e: unknown): string => errorMessage(e).replace(/^Error: /, "");

// ---- paired Apple TVs ---------------------------------------------------------------------------------

let devices: Paired[] | undefined;
export async function paired(): Promise<Paired[]> {
  return (devices ??= ((await storage.get("devices", NAME)) as Paired[] | null) ?? []);
}
export const pairedNow = () => devices ?? [];
export async function savePaired(list: Paired[]): Promise<void> {
  devices = list;
  await storage.set("devices", list, NAME);
}
/** The Apple TV the `device` setting names (by name or id), else the one paired last. */
export function current(list: Paired[] = devices ?? []): Paired | undefined {
  const want = cfg().device?.trim().toLowerCase();
  return (want && list.find((d) => d.name.toLowerCase() === want || d.id.toLowerCase() === want)) || list[list.length - 1];
}

// ---- the connection -----------------------------------------------------------------------------------

/** The connection's state, read by every view. */
export const tv = { conn: undefined as Conn | undefined, state: "down" as "connecting" | "up" | "down", error: undefined as string | undefined };
let connecting: Promise<Conn> | undefined;
let unlisten: (() => void) | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const IDLE_MS = 90_000;
/** Things to do when the TV says something changed, besides redrawing: the cover, the queue. */
const changed: ((kind: string) => void)[] = [];
export const onTvChange = (f: (kind: string) => void) => changed.push(f);

/** The open connection to the current Apple TV, opened now when there is none; one attempt at a time. */
export async function ensure(): Promise<Conn> {
  const dev = current(await paired());
  if (!dev) throw new Error("No Apple TV paired: run Set Up Apple TV");
  if (tv.conn && tv.conn.device.id === dev.id) return tv.conn;
  if (tv.conn) await drop();
  connecting ??= (async () => {
    tv.state = "connecting"; tv.error = undefined; push();
    try {
      const c = await (await driver()).connect(dev);
      tv.conn = c; tv.state = "up";
      unlisten = c.on((e) => {
        if (e.kind === "connection") { tv.state = e.up ? "up" : "down"; tv.error = e.error; }
        if (e.kind === "now_playing") cover();
        for (const f of changed) f(e.kind);
        push();
      });
      cover();
      for (const f of changed) f("connection");
      return c;
    } catch (e) {
      tv.state = "down"; tv.error = plain(e);
      throw e;
    } finally {
      connecting = undefined;
      push();
      idle();
    }
  })();
  return connecting;
}

/** Wait a moment for a first connection, so a view opened cold draws the TV rather than "connecting". */
export async function warm(ms = 1500): Promise<void> {
  if (!connecting && !tv.conn && (await paired()).length) await Promise.race([ensure().catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

export async function drop(): Promise<void> {
  const c = tv.conn;
  unlisten?.(); unlisten = undefined; tv.conn = undefined; tv.state = "down";
  await c?.close().catch(() => {});
}

/** Close the connection once nothing has wanted it for a while: no level open, Stay connected off. */
export function idle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { idleTimer = undefined; if (!(levels.size > 0 || (cfg().stay && !!devices?.length))) void drop(); else idle(); }, IDLE_MS);
}

/** Run `f` on the connection, as a failure toast when it throws; `undefined` when it went. */
export async function withConn(what: string, f: (c: Conn) => Promise<unknown>): Promise<Effect | undefined> {
  try { await f(await ensure()); return undefined; } catch (e) { return failed(what, e); }
}

// ---- apps and their pictures ---------------------------------------------------------------------------

/** App lists per Apple TV, the last read kept in storage so the root and the dock have them before the TV answers. */
export const appLists = new Map<string, App[]>();

export async function appsOf(dev: Paired, fresh = false): Promise<App[]> {
  if (!fresh && appLists.has(dev.id)) return appLists.get(dev.id)!;
  const cached = (await storage.get(`apps:${dev.id}`, NAME)) as App[] | null;
  if (!fresh && cached) { appLists.set(dev.id, cached); return cached; }
  const list = [...(await (await ensure()).apps())].sort((a, b) => a.name.localeCompare(b.name));
  appLists.set(dev.id, list);
  await storage.set(`apps:${dev.id}`, list, NAME);
  return list;
}

/** The app in front, from what plays (its name from the TV's list: YouTube does not say its own). */
export function frontApp(): App | undefined {
  const n = tv.conn?.nowPlaying(), dev = tv.conn?.device;
  if (!n?.app?.id || !dev) return undefined;
  return (appLists.get(dev.id) ?? []).find((a) => a.id === n.app!.id) ?? { id: n.app.id, name: n.app.name ?? n.app.id };
}

type Pic = { square?: string; wide?: string; strip?: string; tone?: ReturnType<typeof backdrop> };
const pics = new Map<string, Pic>();
let iconUrls: Record<string, string | null> | undefined;

async function iconUrl(bundleId: string, kind: "square" | "tv"): Promise<string | undefined> {
  iconUrls ??= ((await storage.get("icons", NAME)) as Record<string, string | null> | null) ?? {};
  const key = kind === "tv" ? `tv:${bundleId}` : bundleId;
  let url = iconUrls[key];
  if (url === undefined) {
    url = (await (await driver()).appIcon(bundleId, kind).catch(() => undefined)) ?? null;
    iconUrls[key] = url;
    await storage.set("icons", iconUrls, NAME).catch(() => {});
  }
  return url ?? undefined;
}

/** The App Store's image service serves any size: `…/512x512bb.jpg` as `…/64x64bb.jpg`. */
const sized = (url: string, w: number, h: number) => url.replace(/\/\d+x\d+(bb|cc)\.(jpg|png)$/, `/${w}x${h}bb.jpg`);

async function bytes(url: string): Promise<Uint8Array | undefined> {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined; } catch { return undefined; }
}

/** Fetch an app's pictures once: the square icon, the 5:3 tvOS one, the strip's rounded PNG, and the tone of the icon. A push when they land. */
function fetchPics(a: App): void {
  if (pics.has(a.id)) return;
  const p: Pic = {};
  pics.set(a.id, p);
  void (async () => {
    const [sq, tvIcon] = await Promise.all([iconUrl(a.id, "square"), iconUrl(a.id, "tv")]);
    if (sq) {
      p.square = await imageData(sized(sq, 128, 128));
      const small = await bytes(sized(sq, 44, 44));
      const px = small && decodeJpeg(small);
      if (px) { p.strip = pngData(rounded(px)); const c = dominant(px); if (c) p.tone = backdrop(c); }
    }
    if (tvIcon) p.wide = await imageData(sized(tvIcon, 200, 120));
    if (p.square || p.wide) push();
  })();
}

/** An app's square picture now: the App Store icon once fetched, else Apple's mark or the initial. */
export function artOf(a: App): string {
  fetchPics(a);
  return pics.get(a.id)?.square ?? placeholderArt(a.id, a.name);
}
/** Its 5:3 picture, as the TV's Home Screen draws it: the tvOS icon, else the square one on a wide tile. */
export function wideArtOf(a: App): string {
  fetchPics(a);
  return pics.get(a.id)?.wide ?? wideArt(a.id, a.name, pics.get(a.id)?.square);
}
/** The strip's picture: a raster with rounded corners, or undefined (then the TV mark). */
export const stripArtOf = (a: App) => { fetchPics(a); return pics.get(a.id)?.strip; };
export const appTone = (a: App) => pics.get(a.id)?.tone;

// ---- the cover of what plays -----------------------------------------------------------------------------

/** The cover, keyed by the item: its data url, whether it is wider than tall, and the tone it gives. */
export const coverArt: { item?: string; data?: string; wide?: boolean; tone?: ReturnType<typeof backdrop> } = {};

const itemKey = () => { const n = tv.conn?.nowPlaying(); return n ? n.itemId ?? `${n.title ?? ""}|${n.app?.id ?? ""}` : undefined; };

/** Fetch the cover of what plays, once per item; a push when it lands. */
function cover(): void {
  const n = tv.conn?.nowPlaying(), item = itemKey();
  if (!n || !n.title || coverArt.item === item) return;
  Object.assign(coverArt, { item, data: undefined, wide: undefined, tone: undefined });
  if (n.artworkAvailable === false) return;
  tv.conn!.artwork(480, 480).then((b) => {
    if (!b?.length || coverArt.item !== item) return;
    const jpeg = b[0] === 0xff;
    const px = jpeg ? decodeJpeg(b) : undefined;
    const c: RGB | undefined = px ? dominant(px) : undefined;
    Object.assign(coverArt, { data: `data:image/${jpeg ? "jpeg" : "png"};base64,${Buffer.from(b).toString("base64")}`, wide: px ? px.width > px.height * 1.15 : false, tone: c ? backdrop(c) : undefined });
    push();
  }).catch(() => {});
}

// ---- launches -----------------------------------------------------------------------------------------------

/** How often each app was opened from pal: the dock's order when no favourites are set. */
export let launches: Record<string, number> | undefined;
export async function launch(id: string, name: string): Promise<Effect> {
  const e = await withConn(`open ${name}`, (c) => c.launch(id));
  if (e) return e;
  launches ??= ((await storage.get("launches", NAME)) as Record<string, number> | null) ?? {};
  launches[id] = (launches[id] ?? 0) + 1;
  await storage.set("launches", launches, NAME).catch(() => {});
  return { hud: `Opening ${name}`, keep: true };
}

// ---- open levels and the redraw ---------------------------------------------------------------------------------

/** A view level of ours that is open: a palette's (or the bar item's popover), panel or popover layout. */
export type Level = { palette?: string; bar?: string; compact?: boolean };
const levels = new Map<string, Level>();
const levelKey = (l: Level) => (l.bar ? `bar:${l.bar}` : `palette:${l.palette}`);
export const openLevels = () => [...levels.values()];
export const isOpen = (palette: string) => levels.has(`palette:${palette}`);

/** The renderer of each live palette (and of the bar item's popover, under `bar:<id>`), and the bar item itself. */
const renderers = new Map<string, (l: Level) => Promise<View>>();
export const registerView = (key: string, f: (l: Level) => Promise<View>) => renderers.set(key, f);
let barRender: (() => Promise<BarItem>) | undefined;
export const registerBar = (f: () => Promise<BarItem>) => { barRender = f; };
/** Called when a level opens: wake the TV, warm the app list, start a tick. */
const opened: ((l: Level) => void)[] = [];
export const onOpen = (f: (l: Level) => void) => opened.push(f);

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastBar = "";
/** Redraw every open level of ours and the bar item; a burst of calls is one redraw. */
export function push(): void {
  if (pushTimer) return;
  pushTimer = setTimeout(async () => {
    pushTimer = undefined;
    for (const l of openLevels()) {
      const f = renderers.get(l.bar ? `bar:${l.bar}` : l.palette!);
      if (!f) continue;
      const v = await f(l).catch(() => undefined);
      if (v) void liveView.update(v, { ...(l.bar ? { bar: l.bar } : { palette: l.palette }), id: v.id, extension: NAME }).catch(() => {});
    }
    if (devices?.length && barRender) {
      // A key's flash redraws a view twice; the strip only when it changed.
      const item = await barRender(), json = JSON.stringify(item);
      if (json !== lastBar) { lastBar = json; void bar.update("playing", item, NAME).catch(() => {}); }
    }
    publish();
    ticking();
  }, 30);
}

let tick: ReturnType<typeof setInterval> | undefined;
/** A 1 s beat while a level is open and something plays: the position moves. */
function ticking(): void {
  const want = levels.size > 0 && tv.conn?.nowPlaying()?.state === "playing";
  if (want && !tick) tick = setInterval(() => { if (tv.conn?.nowPlaying()?.state !== "playing" || !levels.size) { clearInterval(tick); tick = undefined; } push(); }, 1000);
}

liveView.onShown((ev) => {
  if (!ev.bar && !renderers.has(ev.palette ?? "")) return;
  const l: Level = { palette: ev.palette, bar: ev.bar, compact: ev.compact };
  levels.set(levelKey(l), l);
  for (const f of opened) f(l);
  void ensure().then(async () => {
    const dev = current(await paired());
    if (dev && !appLists.has(dev.id)) await appsOf(dev).catch(() => {});
    push();
  }).catch(() => push());
}, NAME);
liveView.onHidden((ev) => { levels.delete(levelKey({ palette: ev.palette, bar: ev.bar })); idle(); }, NAME);

// ---- states ------------------------------------------------------------------------------------------------------

let said: Record<string, unknown> = {};
/** `appletv/power`, `playing`, `app`, `title`: published when they change. */
function publish(): void {
  const c = tv.conn, n = c?.nowPlaying();
  const now: Record<string, unknown> = { power: c ? c.power() : null, playing: c ? n?.state === "playing" : null, app: frontApp()?.name ?? null, title: n?.title ?? null };
  for (const [k, v] of Object.entries(now)) if (said[k] !== v) void state.set(k, v as string | boolean | null, NAME).catch(() => {});
  said = now;
}

export function disposeTv(): void {
  for (const t of [idleTimer, pushTimer]) if (t) clearTimeout(t);
  if (tick) clearInterval(tick);
  void drop();
}

// The device setting moves the connection.
let lastDevice: string | undefined;
settings.onChange(() => {
  const want = cfg().device ?? "";
  if (lastDevice !== undefined && want !== lastDevice && tv.conn && current()?.id !== tv.conn.device.id) void drop().then(() => ensure()).catch(() => {});
  lastDevice = want;
  push();
}, NAME);
