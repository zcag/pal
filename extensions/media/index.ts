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
// while nothing plays) with the cover and the transport in its popover.
// The strip keeps its glyph (a 24 pt cover is a smudge) unless the
// `bar_artwork` setting is on and the cover is square. The core asks for
// it every 30 s and on its `media` trigger, which the core's MediaRemote
// stream fires on every track, state or cover change (`stream: true` on
// the reply); without that stream (Linux, the adapter down) the extension
// polls the players itself every `POLL_MS` while one was playing at the
// last look and pushes (`bar.update`) when the track or the state changed.
//
// The cover comes by id (`artwork_id` on the player: the same picture is
// the same id) through `media.artwork`, once per picture, as a 128 px PNG
// data url; one is kept, since one thing plays at a time.
import { bar, core, media, settings, xdg, type Accessory, type Action, type BarItem, type BarMenuNode, type Effect, type Extension, type Item, type MediaPlayer, type NowPlaying } from "@zcag/pal";

const MAC = process.platform === "darwin";
const MUSIC = xdg("multimedia-player")!;
/** The transport's glyphs (Material Design in the bundled Nerd Font), for the popover rows. */
const GLYPH = {
  pause: xdg("media-playback-pause")!,
  next: xdg("media-skip-forward")!,
  previous: xdg("media-skip-backward")!,
  copy: xdg("edit-copy")!,
  open: "\u{f03cc}", // md-open_in_new
};
const EXTENSION = "media";
const ITEM = "now-playing";
/** The bar's popover row for the track itself. */
const TRACK_ROW = "track";
/** The bar's glyph (nf-fa-music), drawn from the bundled Nerd Font. */
const BAR_GLYPH = "\uf001";
/** Between the extension's own looks at the players while one plays; env for the tests. */
const POLL_MS = Number(process.env.PAL_MEDIA_POLL_MS) || 5000;

/** The core's shapes with what the SDK does not type yet: the stream's cover id and whether the stream is up. */
type Player = MediaPlayer & { artwork_id?: string | null };
type Playing = NowPlaying & { stream?: boolean };
type Settings = { bar_artwork?: boolean };
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

/** `4:05`, `1:06:03`. */
export const clock = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
  return (h ? [h, String(m).padStart(2, "0")] : [m]).concat(String(sec).padStart(2, "0")).join(":");
};

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
    return { keep: true, toast: { title: "Could not control the player", message: String((e as Error)?.message ?? e), style: "failure" } };
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
  return { id: "empty", name: "Nothing playing", subtitle, icon: MUSIC, actions: [] };
}

// ---- the bar item -----------------------------------------------------------

const playing = (np: { players: Player[] }) => np.players.find((p) => p.state === "playing");

/**
 * What the strip shows for a playing player: the track (else the app) as
 * the title and the glyph (the cover instead when `bar_artwork` is on and
 * it is square), the track row with the cover and the transport as the menu.
 */
export function barItem(p: Player | undefined, c: Cover | undefined, barArtwork: boolean): BarItem {
  if (!p) return { hidden: true };
  const target = openTarget(p);
  const track: BarMenuNode = {
    type: "item",
    id: TRACK_ROW,
    title: (p.title ?? p.name).slice(0, 64),
    subtitle: p.title ? [p.artist, p.album].filter(Boolean).join(" · ") || p.name : progress(p) ?? "Playing",
    icon: picture(p, c),
    ...(target ? { action: "open" } : p.title ? { action: "copy" } : { disabled: true }),
  };
  return {
    icon: barArtwork && c?.square ? { image: c.image } : BAR_GLYPH,
    title: (p.title ? [p.title, p.artist].filter(Boolean).join(" · ") : p.name).slice(0, 40),
    tooltip: p.title ? `${trackText(p)} (${p.name})` : `Playing in ${p.name}`,
    menu: [
      track,
      { type: "separator" },
      { type: "item", id: "play_pause", title: "Pause", icon: GLYPH.pause, shortcut: "space" },
      { type: "item", id: "next", title: "Next track", icon: GLYPH.next, shortcut: "right" },
      { type: "item", id: "previous", title: "Previous track", icon: GLYPH.previous, shortcut: "left" },
      { type: "separator" },
      ...(p.title ? [{ type: "item" as const, id: "copy", title: "Copy track", icon: GLYPH.copy, shortcut: "cmd+c" }] : []),
      ...(target ? [{ type: "item" as const, id: "open", title: `Open in ${p.name}`, icon: p.app && MAC ? { app: p.app } : GLYPH.open, shortcut: "cmd+o" }] : []),
    ],
  };
}

/** What a push compares against: the same player, track, state and cover means nothing to say. */
const signature = (p: Player | undefined) => (p ? `${p.id}\0${p.state}\0${p.title}\0${p.artist}\0${p.artwork_id ?? ""}` : "");
let last = "";
let poll: ReturnType<typeof setInterval> | undefined;

const barArtwork = () => settings.get<Settings>(EXTENSION).bar_artwork === true;

/** The item for the playing player, its cover fetched. */
async function playingItem(np: Playing): Promise<BarItem> {
  const p = playing(np);
  return barItem(p, p ? await coverOf(p) : undefined, barArtwork());
}

/**
 * Polls while a player was playing at the last look and the core does not
 * stream (a streaming core fires the `media` trigger itself); stops once
 * none is, and the core's own timer restarts it when one comes back.
 */
function follow(np: Playing | undefined) {
  const p = np && playing(np);
  last = signature(p);
  if (!p || np?.stream) { clearInterval(poll); poll = undefined; return; }
  poll ??= setInterval(async () => {
    let now: Playing;
    try { now = await media.nowPlaying(); } catch { return; }
    if (signature(playing(now)) === last) return;
    follow(now);
    playingItem(now).then((item) => bar.update(ITEM, item, EXTENSION)).catch(() => {});
  }, POLL_MS);
}

async function renderBar(): Promise<BarItem> {
  let np: Playing | undefined;
  try { np = await media.nowPlaying(); } catch { np = undefined; }
  follow(np);
  return np ? playingItem(np) : barItem(undefined, undefined, false);
}

async function barAction(action: string): Promise<Effect> {
  const p = playing(await media.nowPlaying());
  if (!p) return { keep: true, hud: "Nothing playing" };
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
        try { const p = playing(await media.nowPlaying()); return p ? [await item(p)] : []; } catch { return []; }
      },
      list: async () => {
        try {
          const np = await media.nowPlaying();
          return np.players.length ? Promise.all(np.players.map(item)) : [empty(np.system_wide)];
        } catch (e) {
          return [{ id: "empty", name: "Now Playing is not available", subtitle: String((e as Error)?.message ?? e), icon: xdg("dialog-error")!, actions: [] }];
        }
      },
      pick: async (id, action) => {
        if (id === "empty") return { keep: true };
        if (action === "copy" || action === "open") {
          const p = (await media.nowPlaying()).players.find((p) => p.id === id);
          if (!p) return { keep: true, toast: { title: "That player is gone", style: "failure" } };
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
  dispose: () => clearInterval(poll),
} satisfies Extension;
