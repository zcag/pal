// Now Playing over the core's media capability: one row per running
// player with the track as the title, artist and album as the subtitle,
// the cover (the stream's, else the player's artwork url, else the app's
// icon), the player, the position as `12:34 / 1:06:03` and a state tag. A player that
// reports no track (Chrome with YouTube on macOS gives the position and
// nothing else) is its app's name with the position as the subtitle. Enter
// plays or pauses, ⌘→ / ⌘← skip, ⌘C copies "artist - title", ⌘O opens
// the track (its url, else the app). Controls keep the palette up and list
// again, so the tag follows. Live: listed again on every show, and the
// position is the core's estimate at that moment (it ticks from the last
// payload and the clock). With nothing running the one row says so, and on
// Linux how to see players. What other extensions publish as their
// `player` control (docs/design/controls.md: the Apple TV, Spotify on any
// device, Jellyfin) comes first, Enter opening that extension's own view,
// the transport through `controls.runOn`; one that names a system row as
// the same playback (`same`) drops it, and the bar leaves a player alone
// while its extension's own item shows it (`item_shown`).
//
// The bar item `now-playing` is the playing track on the strip (hidden
// while nothing plays) with the cover, the titles, a ticking progress
// bar and the transport as keycap hints in its popover (view.ts, a
// `{ view }` menu). The strip keeps its glyph (a 24 pt cover is a smudge)
// unless the item's `artwork` setting is on and the cover is square. The
// core asks for it every 30 s and on its `media` trigger, which the
// core's MediaRemote stream fires on every track, state or cover change
// (`stream: true` on the reply); without that stream (Linux, the adapter
// down) the extension polls the players itself every `POLL_MS` while one
// was playing at the last look and pushes (`bar.update`) when the track
// or the state changed. While the popover shows (`view/shown` with
// `{ bar }`) a 1 Hz tick pushes the tree with the position moved along
// by the clock from the last look (`view.update`), no player asked.
//
// The cover comes by id (`artwork_id` on the player: the same picture is
// the same id) through `media.artwork`, once per picture, as a 128 px PNG
// data url; one is kept, since one thing plays at a time. A player that
// names its artwork by url instead (Spotify's `https://i.scdn.co/...`, a
// `file://` from MPRIS) has it fetched once into a data url for the
// popover (`ARTWORK_MAX` bytes at most), since a view's image draws
// `data:` and `icon://` only; the app's own icon stands in without one.
import { readFile } from "node:fs/promises";
import { bar, controls, core, errorMessage, failed, hint, media, now, settings, toast, view as liveView, xdg, type Accessory, type Action, type BarCtx, type BarItem, type Effect, type Extension, type Item, type MediaPlayer, type NowPlaying, type Served } from "@zcag/pal";
import { clock, render, type MediaState } from "./view.ts";

const MAC = process.platform === "darwin";
const MUSIC = xdg("multimedia-player")!;
const EXTENSION = "media";
const ITEM = "now-playing";
/** The bar's glyph (nf-fa-music), drawn from the bundled Nerd Font. */
const BAR_GLYPH = "\uf001";
/** Between the extension's own looks at the players while one plays. */
const POLL_MS = 5000;
/** The popover's tick while it shows. */
const TICK_MS = 1000;
/** A cover fetched by url for the popover: skipped past this many bytes. */
const ARTWORK_MAX = 2 * 1024 * 1024;
const ARTWORK_TIMEOUT_MS = 3000;

/** The core's shapes with what the SDK does not type yet: the stream's cover id and whether the stream is up; `ext` on a player another extension publishes. */
type Player = MediaPlayer & { artwork_id?: string | null; ext?: Published };
/** What a published player (`controls.all("player")`) adds: its provider, its own Now Playing palette, whether its own bar item is on a strip, the system players it duplicates. */
type Published = { key: string; palette?: string; shown: boolean; same: string[] };
type Playing = NowPlaying & { stream?: boolean };
type Settings = { exclude?: string[] };
/** The `now-playing` item's own settings (`[bar.items."media/now-playing".settings]`). */
type ItemSettings = { artwork?: boolean };
/** `core/media.artwork`: the cover as a data url, and its own size (square or not). */
type Artwork = { data: string; width: number; height: number };
type Cover = { id: string; image: string; square: boolean };

const STATE: Record<MediaPlayer["state"], { color: string; tag: string }> = {
  playing: { color: "green", tag: "playing" },
  paused: { color: "amber", tag: "paused" },
  stopped: { color: "grey", tag: "stopped" },
};

// ---- players other extensions publish (docs/design/controls.md, "Now Playing") ----

/** A published player's row id: its provider's key behind the prefix. */
const PUBLISHED = "ctl:";
/** The system's players a provider's `same` bundle id stands for: the app's own row (`id`), or the system-wide row naming its `.app`. */
const BUNDLES: Record<string, { id: string; app: string }> = { "com.spotify.client": { id: "spotify", app: "spotify" }, "com.apple.Music": { id: "music", app: "music" } };

/** One published player as a row's player: its app and device as the name, the position moved along from when it was read. */
export function fromPublished(s: Served<"player">, at = now()): Player {
  const p: Player = {
    id: `${PUBLISHED}${s.provider.key}`, name: [s.app, s.device].filter(Boolean).join(" · ") || s.provider.key, state: s.state ?? "stopped",
    title: s.title ?? null, artist: s.artist ?? null, album: s.album ?? null, artwork: s.artwork ?? null, url: null, app: null, position: s.position ?? null, duration: s.duration ?? null,
    ext: { key: s.provider.key, palette: s.palette, shown: s.item_shown === true, same: s.same ?? [] },
  };
  return s.at !== undefined ? { ...p, position: positionAt(p, s.at, at) ?? null } : p;
}

/** Every published player that plays or pauses something; none on a host without controls. */
async function published(): Promise<Player[]> {
  try { return (await controls.all("player")).filter((s) => s.state === "playing" || s.state === "paused").map((s) => fromPublished(s)); } catch { return []; }
}

/** The published players first, then the system's, less the system rows a published one says it duplicates. */
export function merged(np: Playing, pub: Player[]): Playing {
  const same = pub.flatMap((p) => p.ext?.same ?? []).flatMap((b) => BUNDLES[b] ?? []);
  const dup = (p: Player) => same.some((b) => p.id === b.id || (p.app !== null && p.app.toLowerCase().endsWith(`/${b.app}.app`)));
  return { ...np, players: [...pub, ...np.players.filter((p) => !dup(p))] };
}

/** The players now: the system's and the published ones, merged. */
async function nowPlaying(): Promise<Playing> {
  const [np, pub] = await Promise.all([media.nowPlaying() as Promise<Playing>, published()]);
  return merged(np, pub);
}

/** `artist - title`, or whichever there is. */
export const trackText = (p: MediaPlayer): string => [p.artist, p.title].filter(Boolean).join(" - ");

/** `12:34 / 1:06:03`, `12:34`, or nothing when the player gives no position. */
export const progress = (p: MediaPlayer): string | undefined =>
  p.position != null ? [clock(p.position), p.duration != null ? clock(p.duration) : ""].filter(Boolean).join(" / ") : undefined;

/** What stands in for a track on a player that reports none: the position, else the state. */
const untitled = (p: MediaPlayer): string => progress(p) ?? (p.state === "playing" ? "Playing" : "Paused");

let cover: Cover | undefined;

/** The stream's cover for `p`, fetched once per picture; nothing without one or once it is gone (a new list gives the new id). */
async function coverOf(p: Player): Promise<Cover | undefined> {
  const id = p.artwork_id;
  if (!id) return undefined;
  if (cover?.id === id) return cover;
  try {
    const a = await core.call<Artwork>("media.artwork", { id });
    cover = { id, image: a.data, square: a.width === a.height };
  } catch {
    return undefined;
  }
  return cover;
}

/** The row's picture: the cover, the player's artwork url, the app, the note. */
const picture = (p: Player, c: Cover | undefined) => (c ? { image: c.image } : p.artwork ? { image: p.artwork } : p.app ? { app: p.app } : MUSIC);

/** What Open opens: the track's url, else the app on macOS (a `.desktop` path is not something the opener launches). */
const openTarget = (p: MediaPlayer) => p.url ?? (MAC ? p.app : null);

/** A published player's own Now Playing, in its extension: what Open does for one. */
const openPublished = (p: Player): Effect | undefined => (p.ext?.palette ? { push: { extension: p.ext.key, palette: p.ext.palette } } : undefined);

/** A transport command to `player` (a published one's goes to its provider); the panel or popover stays up, a refusal is a toast. */
async function control(player: string, action?: string): Promise<Effect> {
  const command = action === "next" || action === "previous" ? action : "play_pause";
  try {
    if (player.startsWith(PUBLISHED)) await controls.runOn(player.slice(PUBLISHED.length), "player", command);
    else await media.control(player, command);
  } catch (e) {
    return failed("control the player", e);
  }
  return { keep: true };
}

/** A player's row (the store fixture builds its rows here too). */
export async function item(p: Player): Promise<Item> {
  const idle = !p.title;
  // A row with a state but no track: the app is the title, the position the subtitle.
  const untitledActive = idle && p.state !== "stopped";
  const accessories: Accessory[] = [{ tag: STATE[p.state].tag, color: STATE[p.state].color }];
  // On a row with a track: the player, then the position (the untitled row has it as the subtitle). A design that keeps two accessories drops the position first, so which player it is stays.
  const at = progress(p);
  if (!idle && at) accessories.unshift({ text: at });
  if (!idle) accessories.unshift({ text: p.name });
  const actions: Action[] = [
    { id: "play_pause", title: p.state === "playing" ? "Pause" : "Play" },
    { id: "next", title: "Next track", shortcut: "cmd+right" },
    { id: "previous", title: "Previous track", shortcut: "cmd+left" },
  ];
  if (!idle) actions.push({ id: "copy", title: "Copy track", shortcut: "cmd+c" });
  const target = openTarget(p);
  // A published player: Enter opens its extension's own Now Playing (the lyrics, the remote), the transport stays on the other actions.
  if (openPublished(p)) actions.unshift({ id: "open", title: "Open" });
  else if (target) actions.push({ id: "open", title: `Open in ${p.name}`, shortcut: "cmd+o" });
  return {
    id: p.id,
    name: p.title ?? (untitledActive ? p.name : "Nothing playing"),
    subtitle: untitledActive ? untitled(p) : idle ? p.name : [p.artist, p.album].filter(Boolean).join(" · ") || undefined,
    icon: picture(p, await coverOf(p)),
    keywords: [p.name, "now playing", "music", ...(p.artist ? [p.artist] : [])],
    accessories,
    actions,
  };
}

// macOS always has a system-wide source (the bundled MediaRemote adapter); a build without it is the one case the hint covers.
function empty(systemWide: boolean): Item {
  const subtitle = systemWide
    ? "No player is running"
    : MAC ? "No player is running (this build has no MediaRemote adapter: only Spotify and Music are watched)" : "Install playerctl to control MPRIS players";
  return hint("empty", "Nothing playing", subtitle, { icon: MUSIC });
}

// ---- the bar item -----------------------------------------------------------


/** The players this extension leaves to another (`exclude`, by app name or player id, case-insensitive): the bar item and the Now row skip them, the palette lists them. */
const excluded = (p: Player) => {
  const list = (settings.get<Settings>(EXTENSION).exclude ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(p.id.toLowerCase()) || list.includes(p.name.toLowerCase()) || (p.app !== null && list.some((x) => p.app!.toLowerCase().includes(`/${x}.app`)));
};
/** A player the bar leaves alone: excluded, or published by an extension whose own bar item shows it now (Spotify's lyric line, the Apple TV's remote: never doubled, never replaced). */
const skipped = (p: Player) => excluded(p) || p.ext?.shown === true;
/** The playing player the bar and the Now row show: the first playing one that is not skipped. */
const playingForBar = (np: { players: Player[] }) => np.players.find((p) => p.state === "playing" && !skipped(p));
/** The player the strip follows: the playing one, else the first that is not skipped, paused or idle (the manifest's `paused` rule hides that one unless the user keeps it). */
const playerForBar = (np: { players: Player[] }) => playingForBar(np) ?? np.players.find((p) => !skipped(p));

/** The cover a player names by url, as a data url for the popover: fetched or read once per url, the last one kept. Nothing for a picture too large, unreachable or not an image. */
let fetched: { url: string; data?: string } | undefined;
async function coverByUrl(url: string): Promise<string | undefined> {
  if (fetched?.url === url) return fetched.data;
  fetched = { url };
  try {
    let bytes: Uint8Array, type: string;
    if (url.startsWith("file://")) {
      bytes = new Uint8Array(await readFile(new URL(url)));
      type = /\.png$/i.test(url) ? "image/png" : /\.(jpe?g)$/i.test(url) ? "image/jpeg" : "image/jpeg";
    } else if (/^https?:\/\//.test(url)) {
      const r = await fetch(url, { signal: AbortSignal.timeout(ARTWORK_TIMEOUT_MS) });
      if (!r.ok) return undefined;
      type = r.headers.get("content-type")?.split(";")[0].trim() || "image/jpeg";
      bytes = new Uint8Array(await r.arrayBuffer());
    } else return undefined;
    if (!type.startsWith("image/") || bytes.byteLength > ARTWORK_MAX || !bytes.byteLength) return undefined;
    fetched.data = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return undefined;
  }
  return fetched.data;
}

/** The popover's cover: the stream's picture, a url the player names fetched, `data:`/`icon://` urls as they are, the app's icon through the scheme, else nothing (the note tile). */
async function popoverCover(p: Player, c: Cover | undefined): Promise<string | undefined> {
  if (c) return c.image;
  if (p.artwork) {
    if (/^(data:image\/|icon:\/\/)/.test(p.artwork)) return p.artwork;
    const d = await coverByUrl(p.artwork);
    if (d) return d;
  }
  return p.app ? `icon://localhost/app?path=${encodeURIComponent(p.app)}&size=192` : undefined;
}

/** The last look at the players and when, so the popover's position can move along by the clock between looks. */
let snap: { p: Player | undefined; cover?: string; at: number } = { p: undefined, at: 0 };

/** The position at `now`: the player's, moved along by the time since the look while playing, held at the duration. */
export const positionAt = (p: Player, at: number, now: number): number | undefined => {
  if (p.position == null) return undefined;
  const moved = p.state === "playing" ? p.position + Math.max(0, now - at) / 1000 : p.position;
  return p.duration != null && p.duration > 0 ? Math.min(p.duration, moved) : moved;
};

const stateOf = (p: Player, cover: string | undefined, at: number, moment = now()): MediaState => ({ player: p, cover, position: positionAt(p, at, moment), canOpen: !!(openTarget(p) || openPublished(p)) });

/**
 * What the strip shows for a playing player: the track (else the app) as
 * the title and the glyph (the cover instead when the item's `artwork` is on and
 * it is square), the popover's tree (view.ts) as the menu, and the facts
 * (`media/playing`, `media/state`, `media/app`; docs/design/states.md):
 * the manifest's `paused` rule hides a player that is not playing, muted
 * for a user who keeps it. No player at all is hidden, the glyph alone
 * with the popover saying nothing plays its `empty` shape for a
 * `show = "always"` config.
 */
export function barItem(p: Player | undefined, c: Cover | undefined, barArtwork: boolean, cover: string | undefined = c?.image, at = now()): BarItem {
  const empty = { icon: BAR_GLYPH, tooltip: "Nothing playing", menu: { view: render({ canOpen: false }) } };
  if (!p) return { hidden: true, empty, states: { playing: false, state: "none", app: null } };
  const playing = p.state === "playing";
  return {
    icon: barArtwork && c?.square ? { image: c.image } : BAR_GLYPH,
    title: (p.title ? [p.title, p.artist].filter(Boolean).join(" · ") : p.name).slice(0, 40),
    tooltip: p.title ? `${trackText(p)} (${p.name})${playing ? "" : `, ${p.state}`}` : playing ? `Playing in ${p.name}` : `${p.name}, ${p.state}`,
    menu: { view: render(stateOf(p, cover, at)) },
    empty,
    states: { playing, state: p.state, app: p.name },
  };
}

/** What a push compares against: the same player, track, state and cover means nothing to say. */
const signature = (p: Player | undefined) => (p ? `${p.id}\0${p.state}\0${p.title}\0${p.artist}\0${p.artwork_id ?? ""}` : "");
let last = "";
let poll: ReturnType<typeof setInterval> | undefined;

/** The item's settings as the last render got them: the poll's push has no ctx. */
let itemSettings: ItemSettings = {};
const barArtwork = () => itemSettings.artwork === true;

/** The item for the strip's player, its cover fetched; the look remembered for the popover's tick. */
async function playingItem(np: Playing): Promise<BarItem> {
  const p = playerForBar(np);
  const c = p ? await coverOf(p) : undefined;
  const cover = p ? await popoverCover(p, c) : undefined;
  snap = { p, cover, at: now() };
  return barItem(p, c, barArtwork(), cover, snap.at);
}

// ---- the popover's tick -----------------------------------------------------------

let tick: ReturnType<typeof setInterval> | undefined;
/** The popover is up: every second the tree with the position moved along, from the last look, no player asked; ends with the popover or once nothing plays. */
function startTick() {
  tick ??= setInterval(() => {
    const { p, cover, at } = snap;
    if (!p || p.state !== "playing" || p.position == null) return;
    liveView.update(render(stateOf(p, cover, at)), { extension: EXTENSION, bar: ITEM }).catch(() => {});
  }, TICK_MS);
}
function stopTick() { clearInterval(tick); tick = undefined; }
/** The shell says when the popover's level is up and when it left; listened for from the first render (the module is imported by tests outside the host too). */
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  liveView.onShown((ev) => { if (ev.bar === ITEM) startTick(); }, EXTENSION);
  liveView.onHidden((ev) => { if (ev.bar === ITEM) stopTick(); }, EXTENSION);
  // A published player moved (a track, a pause, its own item showing or not): the strip looks again.
  try { controls.onChange((c) => { if (c.control === "player") bar.refresh(ITEM, EXTENSION).catch(() => {}); }, EXTENSION); } catch {}
}

/**
 * Polls while the strip had a player at the last look (playing or paused)
 * and the core does not stream (a
 * streaming core fires the `media` trigger itself); stops once it has
 * none, and the core's own timer restarts it when one comes back.
 */
function follow(np: Playing | undefined) {
  const p = np && playerForBar(np);
  last = signature(p);
  if (!p || np?.stream) { clearInterval(poll); poll = undefined; return; }
  poll ??= setInterval(async () => {
    let now: Playing;
    try { now = await nowPlaying(); } catch { return; }
    if (signature(playerForBar(now)) === last) return;
    follow(now);
    playingItem(now).then((item) => bar.update(ITEM, item, EXTENSION)).catch(() => {});
  }, POLL_MS);
}

async function renderBar(ctx?: BarCtx): Promise<BarItem> {
  if (ctx?.settings) itemSettings = ctx.settings as ItemSettings;
  listen();
  let np: Playing | undefined;
  try { np = await nowPlaying(); } catch { np = undefined; }
  follow(np);
  return np ? playingItem(np) : barItem(undefined, undefined, false);
}

async function barAction(action: string): Promise<Effect> {
  const p = playerForBar(await nowPlaying());
  if (!p) return { keep: true, hud: "Nothing playing" };
  if (action === "refresh") return { keep: true };
  if (action === "copy") return p.title ? { copy: trackText(p) } : { keep: true, hud: "No track title" };
  if (action === "open") { const target = openTarget(p); return openPublished(p) ?? (target ? { open: target } : { keep: true }); }
  return control(p.id, action);
}

export default {
  palettes: {
    media: {
      title: "Now Playing",
      live: true,
      placeholder: "Play, pause, skip",
      // The empty root's Now section: the playing track, nothing while nothing plays.
      suggest: async () => {
        try { const p = playingForBar(await nowPlaying()); return p ? [await item(p)] : []; } catch { return []; }
      },
      list: async () => {
        try {
          const np = await nowPlaying();
          // A running player macOS has not been asked about: its track is on the system-wide row; this row's pick lets macOS ask (never a listing: the first event is the consent alert).
          const unasked = (np.unasked ?? []).map((u) => hint(`ask:${u.id}`, `${u.name} is running; let pal control it directly`, "Enter lets macOS ask whether pal may automate it: its own row, with the track's link", { icon: { app: u.app }, actions: [{ id: "ask", title: "Allow pal to control it" }] }));
          return np.players.length || unasked.length ? [...(await Promise.all(np.players.map(item))), ...unasked] : [empty(np.system_wide)];
        } catch (e) {
          return [hint("empty", "Now Playing is not available", errorMessage(e), { icon: xdg("dialog-error") })];
        }
      },
      pick: async (id, action) => {
        if (id === "hint:empty") return { keep: true };
        if (id.startsWith("hint:ask:")) {
          try { return (await media.ask(id.slice("hint:ask:".length))) ? { keep: true } : toast("Not allowed", "Switch it on under System Settings > Privacy & Security > Automation", "failure"); } catch (e) { return failed("ask for Automation", e); }
        }
        if (action === "copy" || action === "open") {
          const p = (await nowPlaying()).players.find((p) => p.id === id);
          if (!p) return toast("That player is gone", undefined, "failure");
          if (action === "copy") return { copy: trackText(p) };
          const target = openTarget(p);
          return openPublished(p) ?? (target ? { open: target } : { keep: true });
        }
        return control(id, action);
      },
    },
  },
  bar: {
    [ITEM]: { render: renderBar, onAction: barAction },
  },
  dispose: () => { clearInterval(poll); stopTick(); },
} satisfies Extension;
