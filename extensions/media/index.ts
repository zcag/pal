// Now Playing over the core's media capability: one row per running
// player with the track as the title, artist and album as the subtitle,
// the cover (the stream's, else the player's artwork url, else the app's
// icon), the position as `12:34 / 1:06:03` and a state tag. A player that
// reports no track (Chrome with YouTube on macOS gives the position and
// nothing else) is its app's name with the position as the subtitle. Enter
// plays or pauses, ⌘→ / ⌘← skip, ⌘C copies "artist - title", ⌘O opens
// the track (its url, else the app). Controls keep the palette up and list
// again, so the tag follows. Live: listed again on every show, and the
// position is the core's estimate at that moment (it ticks from the last
// payload and the clock). With nothing running the one row says so, and on
// Linux how to see players.
//
// The bar item `now-playing` is the playing track on the strip (hidden
// while nothing plays) with the cover, the titles, a ticking progress
// bar and the transport as keycap hints in its popover (view.ts, a
// `{ view }` menu). The strip keeps its glyph (a 24 pt cover is a smudge)
// unless the `bar_artwork` setting is on and the cover is square. The
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
import { bar, core, errorMessage, failed, hint, media, settings, toast, view as liveView, xdg, type Accessory, type Action, type BarItem, type Effect, type Extension, type Item, type MediaPlayer, type NowPlaying } from "@zcag/pal";
import { clock, render, type MediaState } from "./view.ts";

const MAC = process.platform === "darwin";
const MUSIC = xdg("multimedia-player")!;
const EXTENSION = "media";
const ITEM = "now-playing";
/** The bar's glyph (nf-fa-music), drawn from the bundled Nerd Font. */
const BAR_GLYPH = "\uf001";
/** Between the extension's own looks at the players while one plays; env for the tests. */
const POLL_MS = Number(process.env.PAL_MEDIA_POLL_MS) || 5000;
/** The popover's tick while it shows; env for the tests. */
const TICK_MS = Number(process.env.PAL_MEDIA_TICK_MS) || 1000;
/** A cover fetched by url for the popover: skipped past this many bytes. */
const ARTWORK_MAX = 2 * 1024 * 1024;
const ARTWORK_TIMEOUT_MS = 3000;

/** The core's shapes with what the SDK does not type yet: the stream's cover id and whether the stream is up. */
type Player = MediaPlayer & { artwork_id?: string | null };
type Playing = NowPlaying & { stream?: boolean };
/** `bar_show`: `playing` is the strip's rule; `running` keeps a paused (or idle) player on it, muted; `always` keeps the glyph even with no player. */
type BarShow = "playing" | "running" | "always";
type Settings = { bar_artwork?: boolean; exclude?: string[]; bar_show?: BarShow };
/** `core/media.artwork`: the cover as a data url, and its own size (square or not). */
type Artwork = { data: string; width: number; height: number };
type Cover = { id: string; image: string; square: boolean };

const STATE: Record<MediaPlayer["state"], { color: string; tag: string }> = {
  playing: { color: "green", tag: "playing" },
  paused: { color: "amber", tag: "paused" },
  stopped: { color: "grey", tag: "stopped" },
};

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

/** A transport command to `player`; the panel or popover stays up, a refusal is a toast. */
async function control(player: string, action?: string): Promise<Effect> {
  const command = action === "next" || action === "previous" ? action : "play_pause";
  try {
    await media.control(player, command);
  } catch (e) {
    return failed("control the player", e);
  }
  return { keep: true };
}

async function item(p: Player): Promise<Item> {
  const idle = !p.title;
  // A row with a state but no track: the app is the title, the position the subtitle.
  const untitledActive = idle && p.state !== "stopped";
  const accessories: Accessory[] = [{ tag: STATE[p.state].tag, color: STATE[p.state].color }];
  if (!idle) accessories.unshift({ text: p.name });
  // The position leads, on a row with a track (the untitled row has it as the subtitle).
  const at = progress(p);
  if (!idle && at) accessories.unshift({ text: at });
  const actions: Action[] = [
    { id: "play_pause", title: p.state === "playing" ? "Pause" : "Play" },
    { id: "next", title: "Next track", shortcut: "cmd+right" },
    { id: "previous", title: "Previous track", shortcut: "cmd+left" },
  ];
  if (!idle) actions.push({ id: "copy", title: "Copy track", shortcut: "cmd+c" });
  const target = openTarget(p);
  if (target) actions.push({ id: "open", title: `Open in ${p.name}`, shortcut: "cmd+o" });
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
/** The playing player the bar and the Now row show: the first playing one that is not excluded. */
const playingForBar = (np: { players: Player[] }) => np.players.find((p) => p.state === "playing" && !excluded(p));
const barShow = (): BarShow => settings.get<Settings>(EXTENSION).bar_show ?? "playing";
/** The player the strip follows: the playing one, or (`bar_show` past `playing`) the first that is not excluded, paused or idle. */
const playerForBar = (np: { players: Player[] }) => playingForBar(np) ?? (barShow() === "playing" ? undefined : np.players.find((p) => !excluded(p)));

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

const stateOf = (p: Player, cover: string | undefined, at: number, now = Date.now()): MediaState => ({ player: p, cover, position: positionAt(p, at, now), canOpen: !!openTarget(p) });

/**
 * What the strip shows for a playing player: the track (else the app) as
 * the title and the glyph (the cover instead when `bar_artwork` is on and
 * it is square), the popover's tree (view.ts) as the menu. A player that
 * is not playing (there by `bar_show`) is the same, muted; no player at
 * all is the glyph alone with the popover saying nothing plays.
 */
export function barItem(p: Player | undefined, c: Cover | undefined, barArtwork: boolean, cover: string | undefined = c?.image, at = Date.now(), always = false): BarItem {
  if (!p) return always ? { icon: BAR_GLYPH, color: "muted", tooltip: "Nothing playing", menu: { view: render({ canOpen: false }) } } : { hidden: true };
  const playing = p.state === "playing";
  return {
    icon: barArtwork && c?.square ? { image: c.image } : BAR_GLYPH,
    title: (p.title ? [p.title, p.artist].filter(Boolean).join(" · ") : p.name).slice(0, 40),
    ...(playing ? {} : { color: "muted" as const }),
    tooltip: p.title ? `${trackText(p)} (${p.name})${playing ? "" : `, ${p.state}`}` : playing ? `Playing in ${p.name}` : `${p.name}, ${p.state}`,
    menu: { view: render(stateOf(p, cover, at)) },
  };
}

/** What a push compares against: the same player, track, state and cover means nothing to say. */
const signature = (p: Player | undefined) => (p ? `${p.id}\0${p.state}\0${p.title}\0${p.artist}\0${p.artwork_id ?? ""}` : "");
let last = "";
let poll: ReturnType<typeof setInterval> | undefined;

const barArtwork = () => settings.get<Settings>(EXTENSION).bar_artwork === true;

/** The item for the strip's player, its cover fetched; the look remembered for the popover's tick. */
async function playingItem(np: Playing): Promise<BarItem> {
  const p = playerForBar(np);
  const c = p ? await coverOf(p) : undefined;
  const cover = p ? await popoverCover(p, c) : undefined;
  snap = { p, cover, at: Date.now() };
  return barItem(p, c, barArtwork(), cover, snap.at, barShow() === "always");
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
}

/**
 * Polls while the strip had a player at the last look (playing, or paused
 * with `bar_show` past `playing`) and the core does not stream (a
 * streaming core fires the `media` trigger itself); stops once it has
 * none, and the core's own timer restarts it when one comes back.
 */
function follow(np: Playing | undefined) {
  const p = np && playerForBar(np);
  last = signature(p);
  if (!p || np?.stream) { clearInterval(poll); poll = undefined; return; }
  poll ??= setInterval(async () => {
    let now: Playing;
    try { now = await media.nowPlaying(); } catch { return; }
    if (signature(playerForBar(now)) === last) return;
    follow(now);
    playingItem(now).then((item) => bar.update(ITEM, item, EXTENSION)).catch(() => {});
  }, POLL_MS);
}

async function renderBar(): Promise<BarItem> {
  listen();
  let np: Playing | undefined;
  try { np = await media.nowPlaying(); } catch { np = undefined; }
  follow(np);
  return np ? playingItem(np) : barItem(undefined, undefined, false, undefined, Date.now(), barShow() === "always");
}

async function barAction(action: string): Promise<Effect> {
  const p = playerForBar(await media.nowPlaying());
  if (!p) return { keep: true, hud: "Nothing playing" };
  if (action === "refresh") return { keep: true };
  if (action === "copy") return p.title ? { copy: trackText(p) } : { keep: true, hud: "No track title" };
  if (action === "open") { const target = openTarget(p); return target ? { open: target } : { keep: true }; }
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
        try { const p = playingForBar(await media.nowPlaying()); return p ? [await item(p)] : []; } catch { return []; }
      },
      list: async () => {
        try {
          const np = await media.nowPlaying();
          return np.players.length ? Promise.all(np.players.map(item)) : [empty(np.system_wide)];
        } catch (e) {
          return [hint("empty", "Now Playing is not available", errorMessage(e), { icon: xdg("dialog-error") })];
        }
      },
      pick: async (id, action) => {
        if (id === "hint:empty") return { keep: true };
        if (action === "copy" || action === "open") {
          const p = (await media.nowPlaying()).players.find((p) => p.id === id);
          if (!p) return toast("That player is gone", undefined, "failure");
          if (action === "copy") return { copy: trackText(p) };
          const target = openTarget(p);
          return target ? { open: target } : { keep: true };
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
