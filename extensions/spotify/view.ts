// The Now Playing / lyrics view as a render tree (`View` in `@zcag/pal`),
// pure: the gallery renders fixture states with this same function. Two
// layouts, `wide` for the panel (the cover at the left, the lyrics beside
// it) and `compact` for the bar popover (420 wide: the cover in a header
// row, the lyrics under it). The lyrics are a window of lines around the
// one playing, each keyed by its index and carrying `move`, so when the
// song advances the lines slide up, the top one fades out and a new one
// slides in at the bottom; the current line is the panel's text colour at
// the largest size, the previous ones muted, the coming ones faint.
// Unsynced lyrics scroll in proportion to the position; no lyrics is one
// line and a "Search on lrclib" action. The cover's dominant colour paints
// a band under the cover (a `gradient` node, alpha allowed) and picks the
// tag colour of the progress bar; the badges stay grey so a red cover
// never reads as an alarm.
import type { Action, TagColor, View, ViewNode } from "@zcag/pal";
import type { Track } from "./api.ts";
import { withAlpha, type Tint } from "./color.ts";
import { lineAt, type Lyrics } from "./lyrics.ts";

export type Layout = "wide" | "compact";
export type Status = { kind: "client_id" | "signed_out" | "nothing" | "no_device" | "offline" | "limited" | "error"; message?: string };
export type NowState = {
  layout: Layout;
  track?: Track;
  playing: boolean;
  /** Seconds into the track. */
  position: number;
  shuffle: boolean;
  repeat: "off" | "track" | "context";
  liked?: boolean;
  device?: { name: string; volume: number | null };
  /** The lyrics; null when lrclib has none; undefined while unknown. */
  lyrics?: Lyrics | null;
  /** The cover as a data url the `image` node may show. */
  cover?: string;
  tint?: Tint;
  status?: Status;
};

/** The cover's side and the left column's width (wide); the header cover (compact). */
export const COVER = 208, COVER_SM = 64;
/** Lines around the current one: before and after. */
export const AROUND_WIDE = 3, AROUND_COMPACT = 2;
/** A line's least height, so the column holds still while lines come and go. */
const LINE_H = 30, LINE_H_SM = 26;
const TIMES_W = 36;

type Text = Extract<ViewNode, { type: "text" }>;
type Stack = Extract<ViewNode, { type: "stack" }>;
const text = (value: string, extra: Partial<Text> = {}): ViewNode => ({ type: "text", value, ...extra });
const row = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
const column = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 2, ...extra, children });
const keycap = (keys: string): ViewNode => ({ type: "keycap", keys });

/** `4:05`, `1:06:03`. */
export const clock = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
  return (h ? [h, String(m).padStart(2, "0")] : [m]).concat(String(sec).padStart(2, "0")).join(":");
};

/** The tag colour the tint gives, else the accent (no colour on the node). */
const tag = (st: NowState): TagColor | undefined => (st.tint && st.tint.chroma >= 0.12 ? st.tint.tag : undefined);

/**
 * The lines to draw at `position`: the window of `around` before and
 * after the current index (`lineAt`), padded so the current line keeps
 * its place. Before the first line a note stands in; a pause line (empty
 * text) draws the note too.
 */
export function window(lines: { at: number; text: string }[], position: number, around: number): { index: number; key: string; text: string; role: "before" | "current" | "after" }[] {
  const cur = lineAt(lines, position);
  const out: { index: number; key: string; text: string; role: "before" | "current" | "after" }[] = [];
  for (let i = cur - around; i <= cur + around; i++) {
    const role = i < cur ? "before" : i === cur ? "current" : "after";
    if (i < -1 || i >= lines.length) { out.push({ index: i, key: i < 0 ? `pre${-i}` : `post${i}`, text: "", role }); continue; }
    const t = i < 0 ? "♪" : lines[i].text || "♪";
    out.push({ index: i, key: i < 0 ? "intro" : `l${i}`, text: t, role });
  }
  return out;
}

function lyricLine(l: ReturnType<typeof window>[number], compact: boolean): ViewNode {
  const size = l.role === "current" ? "xl" : "lg";
  const color = l.role === "before" ? "muted" : l.role === "after" ? "faint" : undefined;
  return {
    type: "stack", key: l.key, direction: "row", align: "center", minHeight: compact ? LINE_H_SM : LINE_H,
    transition: { move: true, enter: l.role === "after" ? "slide-up" : "fade", exit: "fade" },
    children: l.text ? [text(l.text, { size, weight: l.role === "current" ? "semibold" : "regular", color })] : [],
  };
}

/** The unsynced text as a window that scrolls with the position: the line the position's share of the song lands on, and its neighbours. */
function plainWindow(plain: string, position: number, duration: number, around: number): ViewNode[] {
  const lines = plain.split(/\r?\n/);
  const at = duration > 0 ? Math.min(lines.length - 1, Math.floor((position / duration) * lines.length)) : 0;
  const out: ViewNode[] = [];
  for (let i = at - around; i <= at + around; i++) {
    const inside = i >= 0 && i < lines.length;
    out.push({ type: "stack", key: inside ? `p${i}` : `pad${i}`, direction: "row", align: "center", minHeight: LINE_H, transition: { move: true, enter: "fade", exit: "fade" }, children: inside && lines[i].trim() ? [text(lines[i], { size: "lg", color: i === at ? undefined : "muted" })] : [] });
  }
  return out;
}

function lyricsColumn(st: NowState): ViewNode {
  const compact = st.layout === "compact";
  const around = compact ? AROUND_COMPACT : AROUND_WIDE;
  const l = st.lyrics;
  const wrap = (children: ViewNode[], key: string) => column(children, { key: `lyrics-${key}`, gap: compact ? 1 : 2, grow: true, justify: "center", align: "start", transition: { enter: "fade" } });
  if (!st.track) return wrap([], "none");
  if (l === undefined) return wrap([text("Looking for lyrics", { style: "muted", size: "sm" })], "loading");
  if (l === null) return wrap([text("No lyrics on lrclib", { size: "lg", color: "muted" }), row([keycap("f"), text("search lrclib for this track", { style: "muted", size: "xs" })], { gap: 1 })], "missing");
  if (l.instrumental && !l.synced?.length && !l.plain) return wrap([text("Instrumental", { size: "lg", color: "muted" })], "instrumental");
  if (l.synced?.length) return wrap(window(l.synced, st.position, around).map((x) => lyricLine(x, compact)), "synced");
  if (l.plain) return wrap([...plainWindow(l.plain, st.position, st.track.duration / 1000, around), row([text("Unsynced lyrics, scrolled with the position", { style: "muted", size: "xs" })], { key: "unsynced-note", minHeight: 16 })], "plain");
  return wrap([text("No lyrics", { size: "lg", color: "muted" })], "empty");
}

function coverNode(st: NowState, side: number): ViewNode {
  const key = `cover-${st.track?.id ?? "none"}`;
  if (st.cover) return { type: "image", key, src: st.cover, width: side, height: side, mask: "rounded", alt: st.track?.album, transition: { enter: "fade" } };
  return { type: "tile", key, width: side, height: side, text: "♪", color: tag(st) ?? "neutral", fill: "soft", transition: { enter: "fade" } };
}

/** The band under the cover: the dominant colour fading down into the panel, a shadow of the art. Nothing without a tint. */
function glow(st: NowState, width: number, height: number, direction: "down" | "right"): ViewNode[] {
  if (!st.tint) return [];
  return [{ type: "gradient", key: "glow", width, height, layers: [{ stops: [withAlpha(st.tint.hex, direction === "down" ? 0.36 : 0.5), withAlpha(st.tint.hex, 0)], direction }], transition: { enter: "fade" } }];
}

function progressRow(st: NowState, width: number): ViewNode {
  const d = (st.track?.duration ?? 0) / 1000;
  return row(
    [text(clock(st.position), { style: "mono", size: "xs", width: TIMES_W }), { type: "progress", key: "progress", value: d > 0 ? Math.min(1, st.position / d) : 0, width: width - 2 * TIMES_W - 16, color: tag(st) }, text(clock(d), { style: "mono", size: "xs", width: TIMES_W, align: "end" })],
    { key: "progress-row", gap: 2 },
  );
}

function badges(st: NowState): ViewNode {
  const kids: ViewNode[] = [];
  if (!st.playing) kids.push({ type: "badge", key: "paused", text: "paused", color: "amber" });
  if (st.shuffle) kids.push({ type: "badge", key: "shuffle", text: "shuffle", color: "grey" });
  if (st.repeat !== "off") kids.push({ type: "badge", key: `repeat-${st.repeat}`, text: st.repeat === "track" ? "repeat one" : "repeat", color: "grey" });
  if (st.liked) kids.push({ type: "badge", key: "liked", text: "liked", color: "red" });
  if (st.device) kids.push({ type: "badge", key: "device", text: st.device.volume != null ? `${st.device.name} ${st.device.volume}%` : st.device.name, color: "grey" });
  return row(kids, { key: "badges", gap: 1, minHeight: 20 });
}

function hints(st: NowState): ViewNode {
  const hint = (keys: string[], what: string): ViewNode[] => [...keys.map(keycap), text(what, { style: "muted", size: "xs" })];
  const items = st.layout === "wide"
    ? [...hint(["space"], st.playing ? "pause" : "play"), ...hint(["left", "right"], "seek 10 s"), ...hint(["up", "down"], "volume"), ...hint(["l"], "like"), ...hint(["s"], "shuffle"), ...hint(["r"], "repeat"), ...hint(["q"], "queue"), ...hint(["d"], "devices")]
    : [...hint(["space"], st.playing ? "pause" : "play"), ...hint(["left", "right"], "seek"), ...hint(["up", "down"], "volume"), ...hint(["l"], "like"), ...hint(["q"], "queue"), ...hint(["d"], "devices")];
  return row(items, { key: "hints", gap: 1, minHeight: 20 });
}

/** What the view says instead of a track: how to sign in, that nothing plays, that Spotify is away. */
const STATUS_TEXT: Record<Status["kind"], [string, string]> = {
  client_id: ["Set a Spotify client id", "Settings, Extensions, Spotify: the README tells how to create the app at developer.spotify.com"],
  signed_out: ["Sign in to Spotify", "Enter opens Spotify in the browser; pal listens for the redirect"],
  nothing: ["Nothing playing", "Start something in Spotify on any device; Enter opens the app"],
  no_device: ["No active device", "Open Spotify on a device, or pick one with d"],
  offline: ["Spotify is unreachable", "Check the network; Enter tries again"],
  limited: ["Spotify rate limit reached", "Enter tries again"],
  error: ["Spotify did not answer", "Enter tries again"],
};

function statusTree(st: NowState): ViewNode {
  const [title, sub] = STATUS_TEXT[st.status!.kind];
  return column(
    [
      { type: "tile", key: "status-tile", width: 56, height: 56, text: "♪", color: "neutral", fill: "soft" },
      text(title, { style: "title", size: "lg", key: `status-${st.status!.kind}`, transition: { enter: "fade" } }),
      text(st.status!.message ?? sub, { style: "muted", size: "sm", align: "center" }),
    ],
    { key: "status", padding: 6, gap: 2, align: "center", justify: "center", grow: true },
  );
}

/** Every action the view answers to; the first listed is Enter. */
export function actions(st: NowState): Action[] {
  if (st.status) {
    const first: Action = st.status.kind === "client_id" ? { id: "settings", title: "Open Settings" }
      : st.status.kind === "signed_out" ? { id: "signin", title: "Sign in to Spotify" }
      : st.status.kind === "nothing" ? { id: "open-app", title: "Open Spotify" }
      : { id: "retry", title: "Try again" };
    return [first, { id: "devices", title: "Devices", shortcut: "d" }];
  }
  const acts: Action[] = [
    { id: "toggle", title: st.playing ? "Pause" : "Play", shortcut: "space" },
    { id: "next", title: "Next track", shortcut: "cmd+right" },
    { id: "previous", title: "Previous track", shortcut: "cmd+left" },
    { id: "forward", title: "Seek forward 10 s", shortcut: "right" },
    { id: "back", title: "Seek back 10 s", shortcut: "left" },
    { id: "vol-up", title: "Volume up", shortcut: "up" },
    { id: "vol-down", title: "Volume down", shortcut: "down" },
    { id: "like", title: st.liked ? "Unlike" : "Like", shortcut: "l" },
    { id: "shuffle", title: st.shuffle ? "Shuffle off" : "Shuffle on", shortcut: "s" },
    { id: "repeat", title: st.repeat === "off" ? "Repeat all" : st.repeat === "context" ? "Repeat one" : "Repeat off", shortcut: "r" },
    { id: "queue", title: "Queue", shortcut: "q" },
    { id: "devices", title: "Devices", shortcut: "d" },
    { id: "copy", title: st.lyrics?.synced?.length ? "Copy current line" : "Copy track", shortcut: "cmd+c" },
    { id: "open", title: "Open in Spotify", shortcut: "cmd+o" },
  ];
  if (st.lyrics === null) acts.push({ id: "lrclib", title: "Search on lrclib", shortcut: "f" });
  return acts;
}

export function render(st: NowState): View {
  const compact = st.layout === "compact";
  let tree: ViewNode;
  if (st.status || !st.track) tree = statusTree({ ...st, status: st.status ?? { kind: "nothing" } });
  else if (compact) {
    const t = st.track;
    tree = column(
      [
        row([coverNode(st, COVER_SM), column([text(t.name, { style: "title", key: `t-${t.id}`, width: 300, transition: { enter: "fade" } }), text(t.artist, { style: "muted", size: "sm", width: 300 }), text(t.album, { size: "xs", color: "faint", width: 300 })], { key: "titles", gap: 0, grow: true })], { key: "head", gap: 3, align: "center" }),
        ...glow(st, 372, 6, "right"),
        progressRow(st, 372),
        badges(st),
        lyricsColumn(st),
        hints(st),
      ],
      { key: "compact", padding: 3, gap: 2, grow: true },
    );
  } else {
    const t = st.track;
    const side = column(
      [
        column([coverNode(st, COVER), ...glow(st, COVER, 16, "down")], { key: "art", gap: 0, align: "start" }),
        text(t.name, { style: "title", size: "lg", key: `t-${t.id}`, width: COVER, transition: { enter: "fade" } }),
        text(t.artist, { style: "muted", size: "md", width: COVER }),
        text(t.album, { size: "xs", color: "faint", width: COVER }),
        progressRow(st, COVER),
        badges(st),
      ],
      { key: "side", gap: 1, align: "stretch" },
    );
    tree = column(
      [row([side, lyricsColumn(st)], { key: "main", gap: 6, align: "stretch", grow: true }), hints(st)],
      { key: "wide", padding: 4, gap: 3, grow: true },
    );
  }
  const title = st.track ? `${st.track.name} · ${st.track.artist}` : "Now Playing";
  return { tree, actions: actions(st), title: title.length > 72 ? `${title.slice(0, 71)}…` : title, id: "now", keys: "actions" };
}
