// Spotify over the Web API (api.ts) with PKCE sign-in (auth.ts): six
// palettes and one bar item over one playback state. `search` (input)
// lists tracks, artists, albums, playlists, podcasts and episodes as
// sections with their cover art; `playlists` (yours, followed; a drill-in
// lists a playlist's tracks); `library` (Liked Songs newest first, recently
// played, top tracks and artists this month) under filters; `devices`
// (live: transfer playback, volume rows); `queue` (live: the queue, skip to
// a row); `commands` (play/pause, skip, like, and a "Play <playlist>" row
// per pinned playlist, all root results); and `now-playing`, the lyrics
// view (view.ts): the cover, the track, a ticking progress bar, the state
// badges and lrclib's synced lyrics (lyrics.ts) around the line playing.
//
// One playback state (`live`): `/me/player` read at most every `SYNC_MS`
// while something ticks, the position between reads from the local clock
// (`positionOf`), and an action patches it optimistically (`hold`) so the
// tree answers at once. The bar item `playing` renders that state: the
// track (or, with `bar_lyrics`, the lyric line playing) on the strip, the
// compact lyrics view as the popover. One 1 Hz loop (`tick`) serves both
// live surfaces while they are open: the popover gets a `bar.update` of
// the whole item every second (the lines slide, the bar ticks; from
// `view/shown` of the item's own popover level, or `onShown`, until
// `view/hidden` or `TICK_WINDOW_MS` as the fallback), and the panel's
// lyrics view gets a `view.update` of the wide tree whenever it differs
// from the last one pushed (every second while playing, since the clock
// moves; on a state change while paused), from `view/shown` of
// `now-playing` until its `view/hidden`. The manifest's `refresh: 5` on
// the view is the safety net: the panel re-asks `view()` on that cadence
// too. Outside the popover's window the item asks to be rendered again at
// the next lyric line (`refresh`), so the strip changes line on time
// without a poll.
import { bar, errorMessage, failed, hint, toast, view as liveView, type Accessory, type Action, type BarCtx, type BarItem, type Ctx, type Effect, type Extension, type Item, type View } from "@zcag/pal";
import { EXTENSION, ITEM, NotSignedIn, conf, log, signIn, signOut, signedIn, stopListener } from "./auth.ts";
import { ApiError, Offline, RateLimited, api, contains, devices as listDevices, enqueue, like, liked as likedTracks, me, next, pause, play, player, playlistTracks, playlists as myPlaylists, positionOf, previous, queue as readQueue, recent, search as apiSearch, seek, setRepeat, setShuffle, setVolume, toTrack, topArtists, topTracks, transfer, unlike, type Artist, type Album, type Player, type Playlist, type Show, type Track } from "./api.ts";
import { tintOf, type Tint } from "./color.ts";
import { cachedLyrics, currentLine, lyricsFor, searchUrl, type Lyrics } from "./lyrics.ts";
import { QUEUE_ROWS, STATUS_TEXT, clock, render, type Layout, type NowState, type QueueTrack, type Status } from "./view.ts";

/** Nerd Font glyphs (nf-md-*, nf-fa-spotify for the bar). */
const G = {
  spotify: "\u{f04c7}", note: "\u{f0387}", play: "\u{f040a}", next: "\u{f04ad}", previous: "\u{f04ae}", heart: "\u{f02d1}", heartOutline: "\u{f02d5}",
  playlist: "\u{f0cb8}", album: "\u{f0025}", artist: "\u{f0803}", podcast: "\u{f0994}", library: "\u{f0331}", search: "\u{f0349}", lyrics: "\u{f0a17}",
  devices: "\u{f0fb0}", laptop: "\u{f0322}", phone: "\u{f011c}", speaker: "\u{f04c3}", tv: "\u{f0502}", cast: "\u{f0118}", car: "\u{f010b}",
  volumeUp: "\u{f075d}", volumeDown: "\u{f075e}", volumeMute: "\u{f075f}", login: "\u{f0342}", logout: "\u{f0343}", key: "\u{f030b}", alert: "\u{f0026}", info: "\u{f02fc}",
} as const;
const DEVICE_GLYPH: Record<string, string> = { Computer: G.laptop, Smartphone: G.phone, Tablet: G.phone, Speaker: G.speaker, TV: G.tv, CastVideo: G.cast, CastAudio: G.cast, Automobile: G.car, AVR: G.speaker, STB: G.tv, AudioDongle: G.cast, GameConsole: G.tv };

/** How old a `/me/player` read may be for a tick (the clock carries the position between reads). */
const SYNC_MS = Number(process.env.PAL_SPOTIFY_SYNC_MS) || 5000;
/** How long the popover keeps ticking after it was shown or used. */
const TICK_WINDOW_MS = Number(process.env.PAL_SPOTIFY_TICK_MS) || 5 * 60_000;
const TICK_MS = 1000;
/** An optimistic patch is served for this long before the API's answer replaces it. */
const HOLD_MS = 1200;
/** A first paint waits this long for the cover and the lyrics; later ones have them cached. */
const FIRST_PAINT_MS = 1500;
const SEEK_S = 10, VOLUME_STEP = 5;
/** The queue palette skips at most this many rows ahead (one `next` each). */
const MAX_SKIP = 20;
const SEARCH_WAIT_MS = 300;
/** After a skip Spotify takes a moment to report the new track. */
const SKIP_SETTLE_MS = 350;
const COVER_MS = 6000;

// ---- errors to rows and statuses -----------------------------------------------

function statusOf(e: unknown): Status {
  if (e instanceof NotSignedIn) return { kind: e.reason };
  if (e instanceof RateLimited) return { kind: "limited", message: e.message };
  if (e instanceof Offline) return { kind: "offline", message: e.message };
  if (e instanceof ApiError && e.noDevice) return { kind: "no_device" };
  if (e instanceof ApiError && e.premium) return { kind: "error", message: "Spotify Premium is needed to control playback" };
  log(errorMessage(e));
  return { kind: "error", message: errorMessage(e) };
}

/** What a failed listing shows instead of rows. */
function failure(e: unknown): Item[] {
  const s = statusOf(e);
  switch (s.kind) {
    case "client_id": return [hint("client_id", "Client id is not set", "Settings › Extensions › Spotify; the README says how to create the app at developer.spotify.com", { icon: G.key, actions: [{ id: "settings", title: "Open Settings" }] })];
    case "signed_out": return [hint("signin", "Sign in to Spotify", "Opens Spotify in the browser; pal listens for the redirect and keeps the tokens", { icon: G.login, actions: [{ id: "signin", title: "Sign in to Spotify" }] })];
    case "limited": return [hint("limited", "Spotify rate limit reached", s.message, { icon: G.alert })];
    case "offline": return [hint("offline", "Spotify is unreachable", s.message, { icon: G.alert })];
    case "no_device": return [hint("device", "No active device", "Open Spotify on a device, then try again", { icon: G.devices })];
    default: return [hint("error", "Spotify did not answer", s.message, { icon: G.alert })];
  }
}

/** The hint rows' picks: the sign-in flow, the settings page. */
async function pickHint(id: string): Promise<Effect> {
  if (id === "hint:signin") return startSignIn();
  if (id === "hint:client_id") return { open: "pal://settings/extensions?anchor=extensions:spotify:client_id" };
  return { keep: true };
}

async function startSignIn(): Promise<Effect> {
  const s = conf();
  const clientId = s.client_id?.trim();
  if (!clientId) return toast("Client id is not set", "Set it under Settings › Extensions › Spotify (the README tells how)", "failure");
  try {
    const url = await signIn(clientId, Number(s.redirect_port) || 27182);
    return { open: url, toast: { title: "Finish signing in in the browser", message: `pal listens on 127.0.0.1:${Number(s.redirect_port) || 27182}` } };
  } catch (e) {
    return failed("listen for the redirect", e);
  }
}

/** Rows or the failure hint, never a thrown listing. */
const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };

// ---- the live playback state ---------------------------------------------------

type Live = { player?: Player; status?: Status; at: number };
let live: Live | undefined;
let reading: Promise<Live> | undefined;
let holdUntil = 0;

/**
 * The state, read from the API unless the last read is younger than
 * `maxAge` or an optimistic patch is still held (`fresh` ignores the hold:
 * a view opening anew wants the truth, not the last key's guess).
 */
async function readLive(maxAge = 0, fresh = false): Promise<Live> {
  const now = Date.now();
  if (live && ((now < holdUntil && !fresh) || now - live.at < maxAge)) return live;
  reading ??= player()
    .then((p) => (live = { player: p, at: Date.now() }))
    .catch((e) => (live = { status: statusOf(e), at: Date.now() }))
    .finally(() => { reading = undefined; });
  return reading;
}

/** Patches the state now and holds it against the next read. */
function patch(f: (p: Player) => Player) {
  if (live?.player) { live = { player: f(live.player), at: Date.now() }; holdUntil = Date.now() + HOLD_MS; }
}

// ---- covers, tints, likes ------------------------------------------------------

type Cover = { id: string; data: string; tint?: Tint };
let cover: Cover | undefined;
let coverFetch: { id: string; p: Promise<Cover | undefined> } | undefined;

/** The 300 px cover as a data url with its dominant colour, one track at a time (one thing plays at a time). */
function coverOf(t: Track | undefined): Promise<Cover | undefined> {
  if (!t?.cover) return Promise.resolve(undefined);
  if (cover?.id === t.id) return Promise.resolve(cover);
  if (coverFetch?.id === t.id) return coverFetch.p;
  const p = fetch(t.cover, { signal: AbortSignal.timeout(COVER_MS) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`cover ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const type = r.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      return (cover = { id: t.id, data: `data:${type};base64,${Buffer.from(bytes).toString("base64")}`, tint: type === "image/jpeg" ? tintOf(bytes) : undefined });
    })
    .catch((e) => { log(`cover: ${errorMessage(e)}`); return undefined; })
    .finally(() => { if (coverFetch?.p === p) coverFetch = undefined; });
  coverFetch = { id: t.id, p };
  return p;
}

// ---- the queue for the popover -------------------------------------------------

/** The queue is asked at most this often while the popover shows (the 1 Hz loop reads the cache). */
const QUEUE_MS = Number(process.env.PAL_SPOTIFY_QUEUE_MS) || 15_000;
/** The 64 px thumbs kept as data urls, this many at most. */
const THUMB_KEEP = 24;
let queueCache: { at: number; tracks: QueueTrack[] } | undefined;
let queueFetch: Promise<void> | undefined;
const thumbs = new Map<string, string | null>();
const thumbFetch = new Map<string, Promise<void>>();

/** The track's 64 px cover as a data url, once per track; a failure leaves it out (a note tile stands in). */
function thumbOf(t: Track): Promise<void> {
  if (!t.thumb || thumbs.has(t.id)) return Promise.resolve();
  const running = thumbFetch.get(t.id);
  if (running) return running;
  const p = fetch(t.thumb, { signal: AbortSignal.timeout(COVER_MS) })
    .then(async (r) => {
      if (!r.ok) throw new Error(`thumb ${r.status}`);
      const type = r.headers.get("content-type")?.split(";")[0] || "image/jpeg";
      thumbs.set(t.id, `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`);
      if (thumbs.size > THUMB_KEEP) thumbs.delete(thumbs.keys().next().value!);
    })
    .catch((e) => { log(`thumb: ${errorMessage(e)}`); thumbs.set(t.id, null); })
    .finally(() => thumbFetch.delete(t.id));
  thumbFetch.set(t.id, p);
  return p;
}

/** The queue's next rows for the popover, from the cache when it is under `QUEUE_MS` old, else asked (with their thumbs); undefined while unknown. */
async function queueFor(maxAge = QUEUE_MS): Promise<QueueTrack[] | undefined> {
  if (queueCache && Date.now() - queueCache.at <= maxAge) return queueCache.tracks;
  queueFetch ??= readQueue()
    .then(async (q) => {
      const next = q.queue.slice(0, QUEUE_ROWS);
      await Promise.all(next.map(thumbOf));
      queueCache = { at: Date.now(), tracks: next.map((t) => ({ id: t.id, name: t.name, artist: t.artist, cover: thumbs.get(t.id) ?? undefined })) };
    })
    .catch((e) => { log(`queue: ${errorMessage(e)}`); queueCache = { at: Date.now(), tracks: queueCache?.tracks ?? [] }; })
    .finally(() => { queueFetch = undefined; });
  await queueFetch;
  return queueCache?.tracks;
}

/** A skip changed the queue: the next read asks again. */
const forgetQueue = () => { queueCache = undefined; };

const likes = new Map<string, boolean>();
async function likedOf(t: Track | undefined): Promise<boolean | undefined> {
  if (!t || t.kind !== "track") return undefined;
  if (likes.has(t.id)) return likes.get(t.id);
  try { const [v] = await contains([t.id]); likes.set(t.id, !!v); return !!v; } catch { return undefined; }
}

const lyricsKey = (t: Track) => ({ id: t.id, name: t.name, artist: t.artist.split(", ")[0] ?? t.artist, album: t.album, duration: t.duration / 1000 });
/** Asks lrclib for the track's lyrics (once per track); an error leaves them unknown and is logged. */
const askLyrics = (t: Track | undefined): Promise<Lyrics | null | undefined> => (t && t.kind === "track" ? lyricsFor(lyricsKey(t)).catch((e) => { log(`lyrics: ${errorMessage(e)}`); return undefined; }) : Promise.resolve(null));

/** The view's state from the live one, with what is cached of the cover, the tint, the like and the lyrics. */
function stateOf(l: Live, layout: Layout): NowState {
  const p = l.player;
  const t = p?.track;
  const c = t && cover?.id === t.id ? cover : undefined;
  const base: NowState = { layout, playing: !!p?.playing, position: p ? positionOf(p) / 1000 : 0, shuffle: !!p?.shuffle, repeat: p?.repeat ?? "off" };
  if (l.status) return { ...base, status: l.status };
  if (!p || !t) return { ...base, status: { kind: "nothing" } };
  return {
    ...base, track: t, liked: likes.get(t.id), device: p.device ? { name: p.device.name, volume: p.device.volume } : undefined,
    lyrics: t.kind === "track" ? cachedLyrics(t.id) : null, cover: c?.data, tint: c?.tint,
    ...(layout === "compact" && queueCache && { queue: queueCache.tracks }),
  };
}

/** The state with the cover, the like, the lyrics and (compact) the queue fetched, waiting at most `wait` ms for them. */
async function fullState(l: Live, layout: Layout, wait: number): Promise<NowState> {
  const t = l.player?.track;
  if (t) await Promise.race([Promise.all([coverOf(t), likedOf(t), askLyrics(t), ...(layout === "compact" ? [queueFor()] : [])]), Bun.sleep(wait)]);
  return stateOf(l, layout);
}

const viewOf = async (l: Live, layout: Layout, wait = FIRST_PAINT_MS): Promise<View> => render(await fullState(l, layout, wait));

// ---- actions on the playing track ---------------------------------------------

const trackText = (t: Track) => `${t.artist} - ${t.name}`;

/** Runs one of the view's actions; answers the effect the panel wants (`view` for the next tree, or a push/copy/open). */
async function act(action: string, layout: Layout): Promise<Effect> {
  const l = await readLive(SYNC_MS);
  const p = l.player;
  const t = p?.track;
  const again = async (fresh = false) => ({ view: await viewOf(await readLive(fresh ? 0 : SYNC_MS, fresh), layout, 400) });
  /** Runs the command; `after` patches the state at once, `settle` waits for Spotify and reads the new track instead (a skip). */
  const call = async (title: string, f: () => Promise<unknown>, after?: (p: Player) => Player, settle = false) => {
    try { await f(); } catch (e) {
      const s = statusOf(e);
      if (s.kind === "no_device") return { view: render({ ...stateOf(l, layout), status: s }) };
      return { ...(await again()), toast: { title, message: errorMessage(e), style: "failure" as const } };
    }
    if (after) patch(after);
    if (settle) { await Bun.sleep(SKIP_SETTLE_MS); return again(true); }
    return again();
  };
  switch (action) {
    case "retry": return { view: await viewOf(await readLive(0, true), layout) };
    case "signin": return startSignIn();
    case "settings": return { open: "pal://settings/extensions" };
    case "open-app": return { open: "spotify:" };
    case "queue": return { push: { extension: EXTENSION, palette: "queue" } };
    case "devices": return { push: { extension: EXTENSION, palette: "devices" } };
    case "lyrics": return { view: await viewOf(l, layout) };
  }
  if (!p) return { view: await viewOf(l, layout) };
  // A queue row clicked in the popover: as many Nexts as its place, as the queue palette does.
  const skip = /^skip:(\d+)$/.exec(action);
  if (skip) { const n = Math.min(MAX_SKIP, Number(skip[1]) + 1); return call("Could not skip", async () => { for (let i = 0; i < n; i++) await next(); forgetQueue(); }, undefined, true); }
  switch (action) {
    case "toggle": return call(p.playing ? "Could not pause" : "Could not play", () => (p.playing ? pause() : play()), (x) => ({ ...x, playing: !p.playing, progress: positionOf(p), at: Date.now() }));
    case "next": return call("Could not skip", async () => { await next(); forgetQueue(); }, undefined, true);
    case "previous": return call("Could not go back", async () => { await previous(); forgetQueue(); }, undefined, true);
    case "forward": case "back": {
      const to = Math.max(0, Math.min(t?.duration ?? Infinity, positionOf(p) + (action === "forward" ? SEEK_S : -SEEK_S) * 1000));
      return call("Could not seek", () => seek(to), (x) => ({ ...x, progress: to, at: Date.now() }));
    }
    case "vol-up": case "vol-down": {
      const v = Math.max(0, Math.min(100, (p.device?.volume ?? 50) + (action === "vol-up" ? VOLUME_STEP : -VOLUME_STEP)));
      return call("Could not set the volume", () => setVolume(v), (x) => ({ ...x, device: x.device ? { ...x.device, volume: v } : x.device }));
    }
    case "shuffle": return call("Could not set shuffle", () => setShuffle(!p.shuffle), (x) => ({ ...x, shuffle: !p.shuffle }));
    case "repeat": {
      const mode = p.repeat === "off" ? "context" : p.repeat === "context" ? "track" : "off";
      return call("Could not set repeat", () => setRepeat(mode), (x) => ({ ...x, repeat: mode }));
    }
    case "like": {
      if (!t || t.kind !== "track") return { ...(await again()), toast: { title: "Only a track can be liked" } };
      const was = likes.get(t.id) ?? (await likedOf(t)) ?? false;
      try { await (was ? unlike([t.id]) : like([t.id])); likes.set(t.id, !was); } catch (e) { return { ...(await again()), toast: { title: was ? "Could not unlike" : "Could not like", message: errorMessage(e), style: "failure" } }; }
      return { ...(await again()), toast: { title: was ? "Removed from Liked Songs" : "Added to Liked Songs", message: t.name } };
    }
    case "copy": {
      if (!t) return { keep: true };
      const line = t.kind === "track" ? cachedLyrics(t.id)?.synced : undefined;
      const cur = line?.length ? currentLine(line, positionOf(p) / 1000) : undefined;
      return { copy: cur ?? trackText(t) };
    }
    case "open": return t ? { open: t.uri } : { keep: true };
    case "lrclib": return t ? { open: searchUrl({ name: t.name, artist: t.artist.split(", ")[0] ?? t.artist }) } : { keep: true };
  }
  return again();
}

// ---- the bar item ------------------------------------------------------------

let tick: ReturnType<typeof setInterval> | undefined;
/** The next lrclib timestamp for the strip itself; unlike `tick`, it runs with no popover open. */
let lyricTick: ReturnType<typeof setTimeout> | undefined;
/** Tracks whose already-in-flight lrclib lookup has a publish callback. */
const lyricLookup = new Set<string>();
/** Until when the popover is fed (`Date.now()` past it: not at all). */
let tickUntil = 0;
/** The panel's lyrics view is on top (`view/shown` of `now-playing`). */
let viewOpen = false;
/** The wide tree last pushed, serialised: the next tick pushes only a different one. */
let lastPushed: string | undefined;

/**
 * The strip and the popover for the state: hidden unless something plays,
 * or, by `bar_show`, the track muted while paused (`paused`) or the glyph
 * alone with nothing at all (`always`); the popover is the same view, so
 * play, sign in and the devices stay a click away.
 */
function barItem(l: Live, st: NowState): BarItem {
  const p = l.player, t = p?.track;
  if (!p || !t || !p.playing) {
    const show = conf().bar_show ?? "playing";
    if (show === "playing" || (show === "paused" && !t)) return { hidden: true };
    const tooltip = t ? `${trackText(t)}, paused` : STATUS_TEXT[st.status?.kind ?? "nothing"][0];
    return { icon: G.spotify, ...(t && { title: `${t.name} · ${t.artist}`.slice(0, 64) }), color: "muted", tooltip, scroll: { up: "next", down: "previous" }, menu: { view: render(st) } };
  }
  const synced = st.lyrics?.synced;
  const line = synced?.length && conf().bar_lyrics !== false ? currentLine(synced, st.position) : undefined;
  const title = (line ?? `${t.name} · ${t.artist}`).slice(0, 64);
  // The extension-owned ticker below is primary; this remains a safety net if
  // the worker restarts or a scheduled callback is lost.
  let refresh: number | undefined;
  if (synced?.length) {
    const nextAt = synced.find((x) => x.at > st.position)?.at;
    if (nextAt !== undefined) refresh = Math.max(1, Math.ceil(nextAt - st.position));
  }
  return { icon: G.spotify, title, tooltip: `${trackText(t)}${p.device ? ` (${p.device.name})` : ""}`, scroll: { up: "next", down: "previous" }, menu: { view: render(st) }, ...(refresh ? { refresh } : {}) };
}

const stopLyricTick = () => { clearTimeout(lyricTick); lyricTick = undefined; };

/**
 * Arms one callback at the next LRC timestamp. The local player clock keeps
 * it aligned between Spotify's 30 s polls; every poll and MediaRemote render
 * calls this again, replacing the old deadline with Spotify's latest one.
 */
function followLyrics(l: Live, st: NowState) {
  if (live !== l) return;
  stopLyricTick();
  const p = l.player, t = p?.track, lines = st.lyrics?.synced;
  if (!p?.playing || !t || t.kind !== "track" || conf().bar_lyrics === false || !lines?.length) return;
  const next = lines.find((line) => line.at * 1000 > positionOf(p));
  if (!next) return;
  // A small margin avoids landing just before a fractional LRC timestamp.
  const after = Math.max(0, next.at * 1000 - positionOf(p)) + 20;
  lyricTick = setTimeout(() => { pushLyric(t.id).catch((e) => log(`lyrics ticker: ${errorMessage(e)}`)); }, after);
}

/** Pushes precisely on a lyric boundary, then arms the next one. */
async function pushLyric(trackId: string) {
  lyricTick = undefined;
  const l = live, p = l?.player, t = p?.track;
  if (!l || !p?.playing || !t || t.id !== trackId) return;
  const st = stateOf(l, "compact");
  followLyrics(l, st);
  await bar.update(ITEM, barItem(l, st), EXTENSION);
}

/**
 * lrclib commonly finishes after the first bar paint. Once it does, publish
 * the first lyric line immediately and start its timestamped ticker, without
 * waiting for the next 30 s bar poll.
 */
function followLyricsWhenReady(l: Live, st: NowState) {
  if (live !== l) return;
  followLyrics(l, st);
  const t = l.player?.track;
  if (!t || t.kind !== "track" || st.lyrics !== undefined || lyricLookup.has(t.id)) return;
  lyricLookup.add(t.id);
  askLyrics(t).then(() => {
    const current = live, p = current?.player;
    if (!current || !p?.playing || p.track?.id !== t.id) return;
    const next = stateOf(current, "compact");
    followLyrics(current, next);
    bar.update(ITEM, barItem(current, next), EXTENSION).catch((e) => log(`lyrics ready: ${errorMessage(e)}`));
  }).catch(() => {}).finally(() => lyricLookup.delete(t.id));
}

/** The item while nothing plays: hidden by default; with `bar_show` past `playing` the state is fetched (a paused track wants its cover) and drawn by `barItem`. */
async function quietItem(l: Live): Promise<BarItem> {
  if ((conf().bar_show ?? "playing") === "playing") return { hidden: true };
  return barItem(l, l.player?.track ? await fullState(l, "compact", 400) : stateOf(l, "compact"));
}

async function renderBar(ctx: BarCtx): Promise<BarItem> {
  // The timer reads the clock; a `keep` after an action (`update`) takes the patched state; anything else (a show, a wake, the media trigger) asks the API afresh.
  const l = await readLive(ctx.reason === "every" ? SYNC_MS : 0, ctx.reason !== "update" && ctx.reason !== "every");
  if (!l.player?.playing) { stopTick(); stopLyricTick(); return quietItem(l); }
  const st = await fullState(l, "compact", ctx.reason === "load" ? FIRST_PAINT_MS : 400);
  followLyricsWhenReady(l, st);
  return barItem(l, st);
}

function stopTick() { clearInterval(tick); tick = undefined; }

/** The 1 Hz loop while anything is open: the popover (`bar.update`) and the panel's view (`view.update`). Ends itself once neither is. */
function startTick() {
  tick ??= setInterval(async () => {
    const popover = Date.now() <= tickUntil;
    if (!popover && tickUntil) { tickUntil = 0; bar.refresh(ITEM, EXTENSION).catch(() => {}); }
    if (!popover && !viewOpen) { stopTick(); return; }
    try {
      const l = await readLive(SYNC_MS);
      if (popover) {
        if (!l.player?.playing) { tickUntil = 0; stopLyricTick(); await bar.update(ITEM, await quietItem(l), EXTENSION); }
        else {
          const st = await fullState(l, "compact", 200);
          followLyrics(l, st);
          await bar.update(ITEM, barItem(l, st), EXTENSION);
        }
      }
      if (viewOpen) {
        const v = render(await fullState(l, "wide", 200));
        const key = JSON.stringify(v);
        if (key !== lastPushed) { lastPushed = key; await liveView.update(v, { extension: EXTENSION, palette: "now-playing" }); }
      }
    } catch (e) { log(`tick: ${errorMessage(e)}`); }
  }, TICK_MS);
}

/** The popover is up (or was, within the window): feed it every second so the lyrics and the bar move. */
function startPopover() { tickUntil = Date.now() + TICK_WINDOW_MS; startTick(); }

// The shell says when a level of ours is on top and when it left: the
// panel's lyrics view starts and stops the pushes, the item's own popover
// level starts and ends its window (the window is the fallback).
liveView.onShown((ev) => {
  if (ev.palette === "now-playing") { viewOpen = true; lastPushed = undefined; startTick(); }
  else if (ev.bar === ITEM) startPopover();
}, EXTENSION);
liveView.onHidden((ev) => {
  if (ev.palette === "now-playing") viewOpen = false;
  else if (ev.bar === ITEM) tickUntil = 0;
}, EXTENSION);

/** A view action from the popover: the same handler; a new tree is a `keep` (the item renders again from the patched state). */
async function barAction(action: string): Promise<Effect> {
  startPopover();
  const r = await act(action, "compact");
  if (r.view) { const { view: _v, ...rest } = r; return { ...rest, keep: true }; }
  return r;
}

// ---- rows ---------------------------------------------------------------------

type Entity = Track | Artist | Album | Playlist | Show;
const table = new Map<string, Entity>();
const idOf = (e: Entity) => `${e.kind}:${e.id}`;
/** `kind:id` back to a Spotify uri and link, so a pick after a restart needs no table. */
const parseId = (id: string): { kind: string; id: string; uri: string; url: string } | undefined => {
  const m = /^(track|episode|artist|album|playlist|show):([A-Za-z0-9]+)$/.exec(id);
  return m ? { kind: m[1], id: m[2], uri: `spotify:${m[1]}:${m[2]}`, url: `https://open.spotify.com/${m[1]}/${m[2]}` } : undefined;
};
const ms = (d: number) => clock(d / 1000);
/** A track row's accessories: the length, an E for explicit, then the caller's. */
const acc = (t: Track, ...more: Accessory[]): Accessory[] => [{ text: ms(t.duration) }, ...(t.explicit ? [{ tag: "E", color: "grey" }] : []), ...more];
const picture = (e: { thumb?: string; cover?: string }, fallback: string) => (e.thumb || e.cover ? { image: (e.thumb ?? e.cover)! } : fallback);

const TRACK_ACTIONS = (t: Track, liked?: boolean, context?: string): Action[] => [
  { id: "play", title: context ? "Play from here" : "Play" },
  { id: "queue", title: "Add to queue", shortcut: "cmd+enter" },
  ...(t.kind === "track" ? [{ id: "like", title: liked ? "Unlike" : "Like", shortcut: "cmd+l" }] : []),
  { id: "open", title: "Open in Spotify", shortcut: "cmd+o" },
  { id: "copy", title: "Copy link", shortcut: "cmd+c" },
];

function trackRow(t: Track, section?: string, extra: Partial<Item> = {}, context?: string): Item {
  table.set(idOf(t), t);
  return {
    id: idOf(t), name: t.name, subtitle: [t.artist, t.album].filter(Boolean).join(" · "), icon: picture(t, G.note), url: t.url,
    keywords: [t.artist, t.album, "spotify"].filter(Boolean), section,
    accessories: acc(t),
    actions: TRACK_ACTIONS(t, likes.get(t.id), context), ...extra,
  };
}

const containerActions = (kind: "artist" | "album" | "playlist" | "show"): Action[] => [
  { id: "play", title: "Play" },
  ...(kind === "playlist" || kind === "album" ? [{ id: "tracks", title: "Show tracks", shortcut: "cmd+enter" }] : []),
  ...(kind === "playlist" ? [{ id: "shuffle", title: "Play shuffled", shortcut: "cmd+s" }] : []),
  { id: "open", title: "Open in Spotify", shortcut: "cmd+o" },
  { id: "copy", title: "Copy link", shortcut: "cmd+c" },
];

function artistRow(a: Artist, section?: string, extra: Partial<Item> = {}): Item {
  table.set(idOf(a), a);
  const followers = a.followers >= 1_000_000 ? `${(a.followers / 1_000_000).toFixed(1)}M` : a.followers >= 1000 ? `${Math.round(a.followers / 1000)}k` : String(a.followers);
  return { id: idOf(a), name: a.name, subtitle: a.genres.slice(0, 3).join(", ") || "Artist", icon: picture(a, G.artist), url: a.url, keywords: ["artist", "spotify"], section, accessories: a.followers ? [{ text: `${followers} followers` }] : [], actions: containerActions("artist"), ...extra };
}
function albumRow(a: Album, section?: string): Item {
  table.set(idOf(a), a);
  return { id: idOf(a), name: a.name, subtitle: [a.artist, a.year].filter(Boolean).join(" · "), icon: picture(a, G.album), url: a.url, keywords: [a.artist, "album", "spotify"], section, accessories: [{ text: `${a.tracks} tracks` }, ...(a.type !== "album" ? [{ tag: a.type, color: "grey" }] : [])], actions: containerActions("album") };
}
function playlistRow(p: Playlist, section?: string): Item {
  table.set(idOf(p), p);
  return { id: idOf(p), name: p.name, subtitle: [p.owner, p.description].filter(Boolean).join(" · "), icon: picture(p, G.playlist), url: p.url, keywords: [p.owner, "playlist", "spotify"], section, accessories: [{ text: `${p.tracks} tracks` }, ...(p.collaborative ? [{ tag: "collaborative", color: "grey" }] : [])], actions: containerActions("playlist") };
}
function showRow(s: Show, section?: string): Item {
  table.set(idOf(s), s);
  return { id: idOf(s), name: s.name, subtitle: s.publisher, icon: picture(s, G.podcast), url: s.url, keywords: ["podcast", "show", "spotify"], section, actions: containerActions("show") };
}

/** A pick on any entity row: play, queue, like, show tracks, open, copy; the id alone says what it is. */
async function pickEntity(id: string, action = "play", ctx?: Ctx): Promise<Effect> {
  const e = parseId(id);
  if (!e) throw new Error(`no row ${id}`);
  const known = table.get(id);
  const args = ctx?.args as { playlist?: string; album?: string } | undefined;
  const playable = e.kind === "track" || e.kind === "episode";
  try {
    switch (action) {
      case "play":
        // A track from a playlist or album level plays inside that context, so the rest follows.
        if (playable && args?.playlist) await play({ context: `spotify:playlist:${args.playlist}`, offset: { uri: e.uri } });
        else if (playable && args?.album) await play({ context: `spotify:album:${e.uri.startsWith("spotify:album") ? e.id : args.album}`, offset: { uri: e.uri } });
        else if (playable) await play({ uris: [e.uri] });
        else await play({ context: e.uri });
        holdUntil = 0;
        return { hud: `Playing ${known?.name ?? e.kind}` };
      case "shuffle":
        await setShuffle(true).catch(() => {});
        await play({ context: e.uri });
        return { hud: `Playing ${known?.name ?? e.kind} shuffled` };
      case "queue":
        if (!playable) return { keep: true };
        await enqueue(e.uri); forgetQueue();
        return { keep: true, toast: { title: "Added to queue", message: known?.name } };
      case "like": {
        if (e.kind !== "track") return { keep: true };
        const was = likes.get(e.id) ?? (await contains([e.id]))[0] ?? false;
        await (was ? unlike([e.id]) : like([e.id]));
        likes.set(e.id, !was);
        return { keep: true, toast: { title: was ? "Removed from Liked Songs" : "Added to Liked Songs", message: known?.name } };
      }
      case "tracks":
        if (e.kind === "playlist") return { push: { extension: EXTENSION, palette: "playlists", args: { playlist: e.id, name: known?.name } } };
        if (e.kind === "album") return { push: { extension: EXTENSION, palette: "playlists", args: { album: e.id, name: known?.name } } };
        return { keep: true };
      case "open": return { open: e.uri };
      case "copy": return { copy: known?.url ?? e.url };
    }
  } catch (err) {
    const s = statusOf(err);
    if (s.kind === "no_device") return { keep: true, toast: { title: "No active device", message: "Open Spotify on a device first, or pick one in Devices", style: "failure" } };
    return failed(action === "queue" ? "add to the queue" : action, err);
  }
  return { keep: true };
}

// ---- search ---------------------------------------------------------------------

let searchSeq = 0;
let lastSearch: Item[] = [];
const searchCache = new Map<string, { at: number; rows: Item[] }>();

async function searchRows(query = ""): Promise<Item[]> {
  const q = query.trim();
  if (q.length < 2) return [hint("search", "Search Spotify", "Tracks, artists, albums, playlists, podcasts", { icon: G.search })];
  const c = searchCache.get(q);
  if (c && Date.now() - c.at < 60_000) return c.rows;
  const seq = ++searchSeq;
  await Bun.sleep(SEARCH_WAIT_MS);
  if (seq !== searchSeq) return lastSearch;
  const r = await apiSearch(q);
  const ids = r.tracks.map((t) => t.id).filter((id) => !likes.has(id));
  if (ids.length) try { (await contains(ids)).forEach((v, i) => likes.set(ids[i], v)); } catch {}
  const rows = [
    ...r.tracks.map((t) => trackRow(t, "Tracks")),
    ...r.artists.map((a) => artistRow(a, "Artists")),
    ...r.albums.map((a) => albumRow(a, "Albums")),
    ...r.playlists.map((p) => playlistRow(p, "Playlists")),
    ...r.shows.map((s) => showRow(s, "Podcasts")),
    ...r.episodes.map((e) => trackRow(e, "Episodes")),
  ];
  const out = rows.length ? rows : [hint("empty", "No results", `Nothing on Spotify matches "${q}"`, { icon: G.search })];
  searchCache.set(q, { at: Date.now(), rows: out });
  if (searchCache.size > 50) searchCache.delete(searchCache.keys().next().value!);
  lastSearch = out;
  return out;
}

// ---- playlists --------------------------------------------------------------------

let meId: Promise<string> | undefined;
const myId = () => (meId ??= me().then((m) => m?.id ?? "").catch((e) => { meId = undefined; throw e; }));

async function playlistRows(ctx?: Ctx): Promise<Item[]> {
  const args = ctx?.args as { playlist?: string; album?: string; name?: string } | undefined;
  if (args?.playlist) {
    const tracks = await playlistTracks(args.playlist);
    return tracks.length ? tracks.map((t) => trackRow(t, undefined, {}, `spotify:playlist:${args.playlist}`)) : [hint("empty", "An empty playlist", "Nothing to play here", { icon: G.playlist })];
  }
  if (args?.album) {
    const tracks = await albumTracks(args.album);
    return tracks.length ? tracks.map((t) => trackRow(t, undefined, {}, `spotify:album:${args.album}`)) : [hint("empty", "An empty album", "Nothing to play here", { icon: G.album })];
  }
  const [lists, id] = await Promise.all([myPlaylists(), myId()]);
  return lists.map((p) => playlistRow(p, p.ownerId === id ? "Yours" : "Followed"));
}

/** The album's tracks: `/albums/{id}` carries them simplified (no album on each), so the album's name and cover are filled in. */
async function albumTracks(id: string): Promise<Track[]> {
  const album = await api<any>("GET", `/albums/${id}`);
  const items: any[] = album?.tracks?.items ?? [];
  return items.map((t) => toTrack({ ...t, album: { name: album?.name, images: album?.images } })).filter((t): t is Track => !!t);
}

// ---- library --------------------------------------------------------------------

const LIBRARY_FILTERS = [{ id: "liked", title: "Liked Songs" }, { id: "recent", title: "Recently played" }, { id: "top-tracks", title: "Top tracks" }, { id: "top-artists", title: "Top artists" }];

async function libraryRows(ctx?: Ctx): Promise<Item[]> {
  switch (ctx?.filter ?? "liked") {
    case "recent": {
      const rows = await recent();
      const seen = new Set<string>();
      return rows.filter((t) => !seen.has(t.id) && seen.add(t.id)).map((t) => trackRow(t, undefined, { accessories: acc(t, { date: t.playedAt }) }));
    }
    case "top-tracks": return (await topTracks()).map((t, i) => trackRow(t, undefined, { accessories: [{ text: `#${i + 1}` }, ...acc(t)] }));
    case "top-artists": return (await topArtists()).map((a, i) => artistRow(a, undefined, { accessories: [{ text: `#${i + 1}` }] }));
    default: {
      const rows = await likedTracks();
      for (const t of rows) likes.set(t.id, true);
      return rows.length ? rows.map((t) => trackRow(t, undefined, { accessories: acc(t, { date: t.addedAt }) })) : [hint("empty", "No liked songs yet", "cmd+l on a track adds it", { icon: G.heartOutline })];
    }
  }
}

// ---- devices ---------------------------------------------------------------------

async function deviceRows(): Promise<Item[]> {
  const ds = await listDevices();
  const rows: Item[] = ds.map((d) => ({
    id: `device:${d.id ?? d.name}`, name: d.name, subtitle: d.type, icon: DEVICE_GLYPH[d.type] ?? G.devices, keywords: ["device", "spotify", d.type], section: "Devices",
    accessories: [...(d.volume != null ? [{ text: `${d.volume}%` }] : []), ...(d.active ? [{ tag: "active", color: "green" }] : [])],
    actions: d.active ? [{ id: "vol-up", title: "Volume up", shortcut: "cmd+up" }, { id: "vol-down", title: "Volume down", shortcut: "cmd+down" }] : [{ id: "transfer", title: "Play here" }, { id: "transfer-paused", title: "Transfer without playing", shortcut: "cmd+enter" }],
  }));
  if (!rows.length) rows.push(hint("none", "No devices", "Open Spotify on a phone, a computer or a speaker", { icon: G.devices }));
  const active = ds.find((d) => d.active);
  if (active?.supportsVolume) {
    rows.push(
      { id: "volume:up", name: "Volume up", subtitle: `${active.name}: ${active.volume ?? 0}% to ${Math.min(100, (active.volume ?? 0) + 10)}%`, icon: G.volumeUp, section: "Volume", keywords: ["louder"], actions: [{ id: "run", title: "Volume up" }] },
      { id: "volume:down", name: "Volume down", subtitle: `${active.name}: ${active.volume ?? 0}% to ${Math.max(0, (active.volume ?? 0) - 10)}%`, icon: G.volumeDown, section: "Volume", keywords: ["quieter"], actions: [{ id: "run", title: "Volume down" }] },
      { id: "volume:mute", name: "Mute", subtitle: active.name, icon: G.volumeMute, section: "Volume", actions: [{ id: "run", title: "Mute" }] },
    );
  }
  return rows;
}

async function pickDevice(id: string, action?: string): Promise<Effect> {
  try {
    if (id.startsWith("volume:")) {
      const ds = await listDevices();
      const active = ds.find((d) => d.active);
      if (!active) return { keep: true, toast: { title: "No active device", style: "failure" } };
      const v = id === "volume:mute" ? 0 : Math.max(0, Math.min(100, (active.volume ?? 0) + (id === "volume:up" ? 10 : -10)));
      await setVolume(v);
      patch((p) => ({ ...p, device: p.device ? { ...p.device, volume: v } : p.device }));
      return { keep: true, toast: { title: `${active.name} at ${v}%` } };
    }
    const deviceId = id.slice("device:".length);
    if (action === "vol-up" || action === "vol-down") {
      const d = (await listDevices()).find((x) => x.id === deviceId);
      const v = Math.max(0, Math.min(100, (d?.volume ?? 50) + (action === "vol-up" ? 10 : -10)));
      await setVolume(v);
      return { keep: true, toast: { title: `${d?.name ?? "Volume"} at ${v}%` } };
    }
    await transfer(deviceId, action !== "transfer-paused");
    holdUntil = 0;
    return { keep: true, toast: { title: "Playback transferred" } };
  } catch (e) { return failed("change the device", e); }
}

// ---- queue -----------------------------------------------------------------------

async function queueRows(): Promise<Item[]> {
  const q = await readQueue();
  const rows: Item[] = [];
  if (q.current) rows.push(trackRow(q.current, "Now playing", { id: `now:${q.current.id}`, actions: [{ id: "toggle", title: "Play or pause" }, { id: "open", title: "Open in Spotify", shortcut: "cmd+o" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }] }));
  q.queue.forEach((t, i) => {
    table.set(idOf(t), t);
    rows.push({
      ...trackRow(t, "Up next"), id: `q:${i}:${t.id}`, accessories: [{ text: `#${i + 1}` }, ...acc(t)],
      actions: [{ id: "skip", title: i === 0 ? "Skip to it" : `Skip ${i + 1} ahead` }, { id: "like", title: likes.get(t.id) ? "Unlike" : "Like", shortcut: "cmd+l" }, { id: "open", title: "Open in Spotify", shortcut: "cmd+o" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }],
    });
  });
  if (!rows.length) rows.push(hint("empty", "The queue is empty", "Nothing is playing; cmd+enter on a track queues it", { icon: G.playlist }));
  return rows;
}

async function pickQueue(id: string, action?: string): Promise<Effect> {
  if (id.startsWith("hint:")) return { keep: true };
  if (id.startsWith("now:")) {
    if (action === "toggle") { const r = await act("toggle", "wide"); return r.toast ? { keep: true, toast: r.toast } : { keep: true }; }
    return pickEntity(`track:${id.slice(4)}`, action);
  }
  const m = /^q:(\d+):(.+)$/.exec(id);
  if (!m) throw new Error(`no row ${id}`);
  if (action !== "skip") return pickEntity(`${table.get(`track:${m[2]}`)?.kind ?? "track"}:${m[2]}`, action);
  const n = Math.min(MAX_SKIP, Number(m[1]) + 1);
  try { for (let i = 0; i < n; i++) await next(); } catch (e) { return failed("skip", e); }
  forgetQueue();
  holdUntil = 0;
  return { keep: true, toast: { title: n === 1 ? "Skipped" : `Skipped ${n} tracks` } };
}

// ---- root commands ------------------------------------------------------------------

const COMMANDS: Item[] = [
  { id: "toggle", name: "Play or Pause Spotify", subtitle: "The active device", icon: G.play, keywords: ["spotify", "pause", "play", "resume"], actions: [{ id: "run", title: "Play or pause" }] },
  { id: "next", name: "Next Track", subtitle: "Spotify", icon: G.next, keywords: ["spotify", "skip"], actions: [{ id: "run", title: "Next track" }] },
  { id: "previous", name: "Previous Track", subtitle: "Spotify", icon: G.previous, keywords: ["spotify", "back"], actions: [{ id: "run", title: "Previous track" }] },
  { id: "like", name: "Like This Track", subtitle: "Add what is playing to Liked Songs", icon: G.heart, keywords: ["spotify", "save", "favourite", "heart"], actions: [{ id: "run", title: "Like" }] },
  { id: "lyrics", name: "Lyrics", subtitle: "What is playing, with the words", icon: G.lyrics, keywords: ["spotify", "now playing", "song"], actions: [{ id: "run", title: "Show lyrics" }] },
];

/** The pinned playlists as "Play <name>" rows: each `pinned` entry by name (case-insensitive) or `spotify:playlist:` uri / id against the user's playlists. */
async function pinnedRows(): Promise<Item[]> {
  const pins = (conf().pinned ?? []).map((s) => String(s).trim()).filter(Boolean);
  if (!pins.length) return [];
  let lists: Playlist[];
  try { lists = await myPlaylists(); } catch { return []; }
  const rows: Item[] = [];
  for (const pin of pins) {
    const id = pin.replace(/^spotify:playlist:/, "").replace(/^https:\/\/open\.spotify\.com\/playlist\//, "").split("?")[0];
    const p = lists.find((l) => l.id === id) ?? lists.find((l) => l.name.toLowerCase() === pin.toLowerCase());
    if (!p) { rows.push(hint(`pin:${pin}`, `Play ${pin}`, "Not among your playlists; the pinned setting names one by name or link", { icon: G.alert })); continue; }
    rows.push({ id: `pin:${p.id}`, name: `Play ${p.name}`, subtitle: [p.owner, `${p.tracks} tracks`].filter(Boolean).join(" · "), icon: picture(p, G.playlist), keywords: ["spotify", "playlist", p.name], actions: [{ id: "play", title: "Play" }, { id: "shuffle", title: "Play shuffled", shortcut: "cmd+s" }, { id: "open", title: "Open in Spotify", shortcut: "cmd+o" }] });
  }
  return rows;
}

const SIGN_OUT: Item = { id: "signout", name: "Sign Out of Spotify", subtitle: "Forgets the tokens; the app stays authorised at spotify.com/account/apps", icon: G.logout, keywords: ["spotify", "logout"], actions: [{ id: "run", title: "Sign out" }] };

/** A root command: the view's own action, answered with the HUD instead of a tree (the panel hides); a failure or a signed-out state stays in the panel. */
async function pickCommand(id: string, action?: string): Promise<Effect> {
  if (id === "now") return act(action ?? "toggle", "wide");
  if (id.startsWith("hint:")) return pickHint(id);
  if (id.startsWith("pin:")) return pickEntity(`playlist:${id.slice(4)}`, action === "shuffle" ? "shuffle" : action === "open" ? "open" : "play");
  if (id === "lyrics") return { view: await viewOf(await readLive(0, true), "wide") };
  if (id === "signout") { await signOut(); stopTick(); live = undefined; likes.clear(); return { keep: true, toast: { title: "Signed out of Spotify" } }; }
  const r = await act(id, "wide");
  if (r.toast?.style === "failure") return { keep: true, toast: r.toast };
  if (!r.view) return r;
  const st = stateOf(live!, "wide");
  if (st.status) return { view: r.view };
  if (id === "like") return { hud: [r.toast?.title ?? "Liked", r.toast?.message].filter(Boolean).join(": ") };
  const said = id === "toggle" ? (st.playing ? "Playing" : "Paused") : id === "next" ? "Next track" : "Previous track";
  return { hud: st.track ? `${said}: ${st.track.name}` : said };
}

// ---- the extension -----------------------------------------------------------------

export default {
  palettes: {
    "now-playing": {
      title: "Lyrics",
      icon: G.lyrics,
      view: async () => viewOf(await readLive(0, true), "wide"),
      pick: async (id, action) => {
        if (id !== "now") return pickHint(id);
        return act(action ?? "toggle", "wide");
      },
      // The root's Now section: the track on, playing or paused (a paused one is still what is on), Enter opens the view.
      suggest: async () => {
        const l = await readLive(SYNC_MS);
        const p = l.player, t = p?.track;
        if (!p || !t) return [];
        return [{
          id: "now", name: t.name, subtitle: `${t.artist} · Spotify`, icon: picture(t, G.spotify),
          accessories: [{ text: `${clock(positionOf(p) / 1000)} / ${ms(t.duration)}` }, ...(p.playing ? [] : [{ tag: "paused", color: "amber" }])],
          actions: [{ id: "lyrics", title: "Show lyrics" }, { id: "toggle", title: p.playing ? "Pause" : "Play", shortcut: "cmd+enter" }, { id: "next", title: "Next track", shortcut: "cmd+right" }],
        }];
      },
    },
    search: {
      title: "Search Spotify",
      icon: G.search,
      input: true,
      placeholder: "A track, an artist, an album, a playlist, a podcast",
      list: (q) => guard(() => searchRows(q)),
      pick: (id, action, ctx) => (id.startsWith("hint:") ? pickHint(id) : pickEntity(id, action, ctx)),
    },
    playlists: {
      title: "Playlists",
      icon: G.playlist,
      placeholder: "A playlist by name",
      list: (_q, ctx) => guard(() => playlistRows(ctx)),
      pick: (id, action, ctx) => (id.startsWith("hint:") ? pickHint(id) : pickEntity(id, action, ctx)),
    },
    library: {
      title: "Library",
      icon: G.library,
      placeholder: "A track or an artist",
      filters: LIBRARY_FILTERS,
      list: (_q, ctx) => guard(() => libraryRows(ctx)),
      pick: (id, action, ctx) => (id.startsWith("hint:") ? pickHint(id) : pickEntity(id, action, ctx)),
    },
    devices: {
      title: "Spotify Devices",
      icon: G.devices,
      live: true,
      placeholder: "A device, or the volume",
      list: () => guard(deviceRows),
      pick: (id, action) => (id.startsWith("hint:") ? pickHint(id) : pickDevice(id, action)),
    },
    queue: {
      title: "Queue",
      icon: G.playlist,
      live: true,
      placeholder: "A track in the queue",
      list: () => guard(queueRows),
      pick: pickQueue,
    },
    commands: {
      title: "Spotify",
      icon: G.spotify,
      tier: "primary",
      placeholder: "Play, pause, next, like, a pinned playlist",
      list: async () => [...COMMANDS, ...(await pinnedRows()), ...((await signedIn()) ? [SIGN_OUT] : [])],
      pick: pickCommand,
    },
  },
  bar: {
    [ITEM]: {
      render: renderBar,
      onAction: barAction,
      onShown: async () => { startPopover(); },
    },
  },
  dispose: () => { stopTick(); stopLyricTick(); tickUntil = 0; viewOpen = false; stopListener(); },
} satisfies Extension;
