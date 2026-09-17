// The Now Playing popover as a tree (`View` in `@zcag/pal`), pure (the
// bar-shot fixture renders a state with this same function). 420 px wide:
// the cover large at the left (the stream's picture, else the app's icon
// through the `icon://` scheme, else a note on a tile) with the title,
// the artist and the album beside it and a row of badges (the player,
// paused), then a progress row (the position, a bar, the duration) that
// ticks while the popover shows, then the transport and copy/open as
// keycap hints. A click on a hint runs what it names; a click on the
// cover or the titles opens the track.
import { POPOVER_W, column, keyHint, row, text, truncate, type Action, type MediaPlayer, type View, type ViewNode } from "@zcag/pal";

export type MediaState = {
  player?: MediaPlayer;
  /** The cover as something an `image` node draws (`data:` or `icon://`); nothing for the note tile. */
  cover?: string;
  /** Seconds into the track, estimated for the moment drawn; undefined when the player gives none. */
  position?: number;
  /** Whether Open has somewhere to go (the track's url, the app on macOS). */
  canOpen: boolean;
};

export const COVER = 96;
/** The time columns: `m:ss`, or wider for `h:mm:ss`. */
const TIMES_W = 40, TIMES_W_H = 56;
/** A note on the tile without a cover (the tile's text is in the UI font, so no Nerd glyph here). */
const NOTE = "♪";

const hint = (keys: string[], what: string, action: string): ViewNode[] => keyHint(keys, what, { action });

/** `4:05`, `1:06:03`. */
export const clock = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
  return (h ? [h, String(m).padStart(2, "0")] : [m]).concat(String(sec).padStart(2, "0")).join(":");
};

function coverNode(p: MediaPlayer, st: MediaState): ViewNode {
  const key = `cover-${p.id}-${st.cover ? "pic" : "note"}`;
  const action = st.canOpen ? "open" : undefined;
  if (st.cover) return { type: "image", key, src: st.cover, width: COVER, height: COVER, mask: "rounded", alt: p.album ?? p.title ?? p.name, action, transition: { enter: "fade" } };
  return { type: "tile", key, width: COVER, height: COVER, text: NOTE, color: "neutral", fill: "soft", action, transition: { enter: "fade" } };
}

function head(p: MediaPlayer, st: MediaState): ViewNode {
  const tw = POPOVER_W - COVER - 12;
  const titles: ViewNode[] = p.title
    ? [
        text(p.title, { style: "title", key: `t-${p.id}-${p.title}`, width: tw, transition: { enter: "fade" } }),
        ...(p.artist ? [text(p.artist, { style: "muted", size: "sm", width: tw })] : []),
        ...(p.album ? [text(p.album, { size: "xs", color: "faint", width: tw })] : []),
      ]
    : [text(p.name, { style: "title", key: `t-${p.id}`, width: tw }), text(p.state === "playing" ? "Playing, no track named" : "Paused", { style: "muted", size: "sm", width: tw })];
  // The player as a badge, unless it already stands as the title (a player that names no track).
  const badges: ViewNode[] = p.title ? [{ type: "badge", key: "app", text: p.name, color: "grey" }] : [];
  if (p.state === "paused") badges.push({ type: "badge", key: "paused", text: "paused", color: "amber" });
  if (p.state === "stopped") badges.push({ type: "badge", key: "stopped", text: "stopped", color: "grey" });
  const col = column([...titles, row(badges, { key: "badges", gap: 1, minHeight: 20 })], { key: "titles", gap: 0, grow: true, action: st.canOpen ? "open" : undefined });
  return row([coverNode(p, st), col], { key: "head", gap: 3, align: "center" });
}

/** The position and the duration around a bar; the position alone when the player names no duration; nothing without a position. */
function progressRow(p: MediaPlayer, st: MediaState): ViewNode[] {
  if (st.position === undefined) return [];
  const d = p.duration ?? 0;
  const w = d >= 3600 || st.position >= 3600 ? TIMES_W_H : TIMES_W;
  if (d <= 0) return [row([text(clock(st.position), { key: "pos", style: "mono", size: "xs", width: w })], { key: "progress-row", minHeight: 16 })];
  return [row(
    [text(clock(st.position), { key: "pos", style: "mono", size: "xs", width: w }), { type: "progress", key: "progress", value: Math.min(1, st.position / d), width: POPOVER_W - 2 * w - 16, color: p.state === "playing" ? "green" : "grey" }, text(clock(d), { key: "dur", style: "mono", size: "xs", width: w, align: "end" })],
    { key: "progress-row", gap: 2 },
  )];
}

function transport(p: MediaPlayer): ViewNode {
  return row([...hint(["space"], p.state === "playing" ? "pause" : "play", "play_pause"), ...hint(["left"], "previous", "previous"), ...hint(["right"], "next", "next")], { key: "transport", gap: 1, minHeight: 22 });
}

function extras(p: MediaPlayer, st: MediaState): ViewNode {
  const kids: ViewNode[] = [];
  if (p.title) kids.push(...hint(["c"], "copy track", "copy"));
  if (st.canOpen) kids.push(...hint(["o"], `open in ${p.name}`, "open"));
  return row(kids, { key: "extras", gap: 1, minHeight: 22 });
}

function nothing(): ViewNode {
  return column(
    [{ type: "tile", key: "nothing-tile", width: 56, height: 56, text: NOTE, color: "neutral", fill: "soft" }, text("Nothing playing", { style: "title", size: "lg" }), text("Start something in a player; the item comes back on its own", { style: "muted", size: "sm", align: "center" })],
    { key: "nothing", padding: 6, gap: 2, align: "center", justify: "center" },
  );
}

/** Every action the popover answers to; the first listed is Enter. */
export function actions(st: MediaState): Action[] {
  const p = st.player;
  if (!p) return [{ id: "refresh", title: "Look again" }];
  const acts: Action[] = [
    { id: "play_pause", title: p.state === "playing" ? "Pause" : "Play", shortcut: "space" },
    { id: "next", title: "Next track", shortcut: ["right", "cmd+right"] },
    { id: "previous", title: "Previous track", shortcut: ["left", "cmd+left"] },
  ];
  if (p.title) acts.push({ id: "copy", title: "Copy track", shortcut: ["c", "cmd+c"] });
  if (st.canOpen) acts.push({ id: "open", title: `Open in ${p.name}`, shortcut: ["o", "cmd+o"] });
  return acts;
}

export function render(st: MediaState): View {
  const p = st.player;
  const tree = p
    ? column([head(p, st), ...progressRow(p, st), transport(p), extras(p, st)], { key: "compact", padding: 3, gap: 2 })
    : nothing();
  const title = p ? (p.title ? [p.title, p.artist].filter(Boolean).join(" · ") : p.name) : "Now Playing";
  return { tree, actions: actions(st), title: truncate(title, 72), id: "now", keys: "actions" };
}
