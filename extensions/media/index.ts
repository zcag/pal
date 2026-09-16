// Now Playing over the core's media capability: one row per running
// player with the track as the title, artist and album as the subtitle,
// the artwork (or the app's icon) and a state tag. Enter plays or pauses,
// ⌘→ / ⌘← skip, ⌘C copies "artist - title", ⌘O opens the track (its url,
// else the app). Controls keep the palette up and list again, so the tag
// follows. Live: listed again on every show. With nothing running the one
// row says so, and on macOS how to see players beyond Spotify and Music.
import { media, xdg, type Accessory, type Action, type Extension, type Item, type MediaPlayer } from "@zcag/pal";

const MAC = process.platform === "darwin";
const MUSIC = xdg("multimedia-player")!;

const STATE: Record<MediaPlayer["state"], { color: string; tag: string }> = {
  playing: { color: "green", tag: "playing" },
  paused: { color: "amber", tag: "paused" },
  stopped: { color: "grey", tag: "stopped" },
};

/** `artist - title`, or whichever there is. */
export const trackText = (p: MediaPlayer): string => [p.artist, p.title].filter(Boolean).join(" - ");

function item(p: MediaPlayer): Item {
  const idle = !p.title;
  const accessories: Accessory[] = [{ tag: STATE[p.state].tag, color: STATE[p.state].color }];
  if (!idle) accessories.unshift({ text: p.name });
  const actions: Action[] = [
    { id: "play_pause", title: p.state === "playing" ? "Pause" : "Play" },
    { id: "next", title: "Next Track", shortcut: "cmd+right" },
    { id: "previous", title: "Previous Track", shortcut: "cmd+left" },
  ];
  if (!idle) actions.push({ id: "copy", title: "Copy Track", shortcut: "cmd+c" });
  const target = p.url ?? (MAC ? p.app : null);
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
          const target = p.url ?? (MAC ? p.app : null);
          return target ? { open: target } : { keep: true };
        }
        const command = action === "next" || action === "previous" ? action : "play_pause";
        try {
          await media.control(id, command);
        } catch (e) {
          return { keep: true, toast: { title: "Could not control the player", message: String((e as Error)?.message ?? e), style: "failure" } };
        }
        return { keep: true };
      },
    },
  },
} satisfies Extension;
