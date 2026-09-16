// Now Playing over the core's media capability: one row per running
// player with the track as the title, artist and album as the subtitle,
// the artwork (or the app's icon) and a state tag. Enter plays or pauses,
// ⌘→ / ⌘← skip, ⌘C copies "artist - title", ⌘O opens the track (its url,
// else the app). Controls keep the palette up and list again, so the tag
// follows. Live: listed again on every show. With nothing running the one
// row says so, and on macOS how to see players beyond Spotify and Music.
//
// The bar item `now-playing` is the playing track on the strip (hidden
// while nothing plays) with the transport in its popover. The core asks
// for it every 30 s; between those the extension polls the players itself
// every `POLL_MS` while one was playing at the last look and pushes
// (`bar.update`) when the track or the state changed, so a skip shows
// within seconds and an idle machine costs nothing.
import { bar, media, xdg, type Accessory, type Action, type BarItem, type Effect, type Extension, type Item, type MediaPlayer } from "@zcag/pal";

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
/** The bar's glyph (nf-fa-music), drawn from the bundled Nerd Font. */
const BAR_GLYPH = "\uf001";
/** Between the extension's own looks at the players while one plays; env for the tests. */
const POLL_MS = Number(process.env.PAL_MEDIA_POLL_MS) || 5000;

const STATE: Record<MediaPlayer["state"], { color: string; tag: string }> = {
  playing: { color: "green", tag: "playing" },
  paused: { color: "amber", tag: "paused" },
  stopped: { color: "grey", tag: "stopped" },
};

/** `artist - title`, or whichever there is. */
export const trackText = (p: MediaPlayer): string => [p.artist, p.title].filter(Boolean).join(" - ");

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

function item(p: MediaPlayer): Item {
  const idle = !p.title;
  const accessories: Accessory[] = [{ tag: STATE[p.state].tag, color: STATE[p.state].color }];
  if (!idle) accessories.unshift({ text: p.name });
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
    name: p.title ?? "Nothing playing",
    subtitle: idle ? p.name : [p.artist, p.album].filter(Boolean).join(" · ") || undefined,
    icon: p.artwork ? { image: p.artwork } : p.app ? { app: p.app } : MUSIC,
    keywords: [p.name, "now playing", "music", ...(p.artist ? [p.artist] : [])],
    accessories,
    actions,
  };
}

function empty(systemWide: boolean): Item {
  const subtitle = systemWide
    ? "No player is running"
    : MAC ? "Spotify and Music are watched; brew install nowplaying-cli to see other players" : "Install playerctl to control MPRIS players";
  return { id: "empty", name: "Nothing playing", subtitle, icon: MUSIC, actions: [] };
}

// ---- the bar item -----------------------------------------------------------

const playing = (np: { players: MediaPlayer[] }) => np.players.find((p) => p.state === "playing" && p.title);

/** What the strip shows for a playing player: the track as the title, the transport as the menu. */
function barItem(p: MediaPlayer | undefined): BarItem {
  if (!p) return { hidden: true };
  const target = openTarget(p);
  return {
    icon: BAR_GLYPH,
    title: [p.title, p.artist].filter(Boolean).join(" · ").slice(0, 40),
    tooltip: `${trackText(p)} (${p.name})`,
    menu: [
      { type: "item", id: "play_pause", title: "Pause", icon: GLYPH.pause, shortcut: "space" },
      { type: "item", id: "next", title: "Next track", icon: GLYPH.next, shortcut: "right" },
      { type: "item", id: "previous", title: "Previous track", icon: GLYPH.previous, shortcut: "left" },
      { type: "separator" },
      { type: "item", id: "copy", title: "Copy track", icon: GLYPH.copy, shortcut: "cmd+c" },
      ...(target ? [{ type: "item" as const, id: "open", title: `Open in ${p.name}`, icon: p.app && MAC ? { app: p.app } : GLYPH.open, shortcut: "cmd+o" }] : []),
    ],
  };
}

/** What a push compares against: the same player, track and state means nothing to say. */
const signature = (p: MediaPlayer | undefined) => (p ? `${p.id}\0${p.state}\0${p.title}\0${p.artist}` : "");
let last = "";
let poll: ReturnType<typeof setInterval> | undefined;

/** Polls while a player was playing at the last look; stops once none is, and the core's own timer restarts it when one comes back. */
function follow(p: MediaPlayer | undefined) {
  last = signature(p);
  if (!p) { clearInterval(poll); poll = undefined; return; }
  poll ??= setInterval(async () => {
    let now: MediaPlayer | undefined;
    try { now = playing(await media.nowPlaying()); } catch { return; }
    if (signature(now) === last) return;
    follow(now);
    bar.update(ITEM, barItem(now), EXTENSION).catch(() => {});
  }, POLL_MS);
}

async function renderBar(): Promise<BarItem> {
  let p: MediaPlayer | undefined;
  try { p = playing(await media.nowPlaying()); } catch { p = undefined; }
  follow(p);
  return barItem(p);
}

async function barAction(action: string): Promise<Effect> {
  const p = playing(await media.nowPlaying());
  if (!p) return { keep: true, hud: "Nothing playing" };
  if (action === "copy") return { copy: trackText(p) };
  if (action === "open") { const target = openTarget(p); return target ? { open: target } : { keep: true }; }
  return control(p.id, action);
}

export default {
  palettes: {
    media: {
      title: "Now Playing",
      icon: MUSIC,
      live: true,
      placeholder: "Play, pause, skip",
      list: async () => {
        try {
          const np = await media.nowPlaying();
          return np.players.length ? np.players.map(item) : [empty(np.system_wide)];
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
