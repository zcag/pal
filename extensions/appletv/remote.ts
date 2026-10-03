// The remote as a render tree (`View` in `@zcag/pal`), pure: the fixture
// and the tests draw rigged states with this same function. Two layouts:
// `wide` for the panel (the clickpad and the buttons on the left, what is
// playing, the keyboard the TV is asking with, the app dock and the
// volume on the right, the keys under everything) and `compact` for the
// bar popover (420 wide: what is playing on top, the clickpad beside the
// buttons, the dock under them). The clickpad is made of stacks, so every
// part of it is a click target as well as a key: the arrows' cells, the
// centre (Select), each lit for a moment in the accent when its key is
// pressed (`flash`), and the whole pad tinted toward the direction of a
// swipe. Nothing here waits on the TV: the extension renders from what
// the connection last said and pushes a new tree when that changes.
import { POPOVER_W, column, keyHint, keycap, row, text, type Action, type HexColor, type TagColor, type View, type ViewNode } from "@zcag/pal";
import type { Keyboard, NowPlaying, Power, Swipe } from "./types.ts";

/** Nerd Font glyphs (Material Design) the remote is drawn with. */
export const G = {
  tv: "\u{f0502}", remote: "\u{f0ec5}", up: "\u{f0143}", down: "\u{f0140}", left: "\u{f0141}", right: "\u{f0142}",
  back: "\u{f0141}", home: "\u{f0502}", playPause: "\u{f040e}", play: "\u{f040a}", pause: "\u{f03e4}",
  volUp: "\u{f075d}", volDown: "\u{f075e}", volume: "\u{f057e}", power: "\u{f0425}", sleep: "\u{f0904}",
  keyboard: "\u{f030c}", apps: "\u{f003b}", account: "\u{f0004}", switchUser: "\u{f0019}", skipBack: "\u{f0d2a}", skipFwd: "\u{f0d71}",
  prev: "\u{f04ae}", next: "\u{f04ad}", check: "\u{f05e0}", alert: "\u{f05d6}", search: "\u{f0349}", swipe: "\u{f0d76}", tap: "\u{f0741}",
  music: "\u{f0387}", movie: "\u{f0fce}", podcast: "\u{f0994}", screensaver: "\u{f1104}", wifiOff: "\u{f05aa}", info: "\u{f02fd}",
} as const;

export type Layout = "wide" | "compact";
/** The parts of the pad and the buttons a key lights for a moment. */
export type Flash = "up" | "down" | "left" | "right" | "select" | "menu" | "home" | "play" | "vol+" | "vol-" | "power";
/** A dock app: its square picture and its 5:3 tvOS one. */
export type DockApp = { id: string; name: string; art: string; wide: string };
/** A copied link waiting to be played. */
export type OfferCard = { title: string; by?: string; thumb?: string; app: string };

export type RemoteState = {
  layout: Layout;
  /** No Apple TV paired yet: the welcome. */
  unpaired?: boolean;
  device?: { name: string; modelName: string };
  /** How many other Apple TVs are paired (`d` switches). */
  others?: number;
  conn: "connecting" | "up" | "down";
  /** Why the connection is down, in words. */
  error?: string;
  power: Power;
  now?: NowPlaying;
  /** Seconds into what plays, at render time. */
  position?: number;
  /** The cover (or the app's icon when the app gives none), a data url. */
  art?: string;
  /** The app in front: its name and tile. */
  app?: { id: string; name: string; art: string };
  volume?: number;
  keyboard?: Keyboard;
  /** The text field is open in the search row. */
  typing?: boolean;
  dock: DockApp[];
  flash?: Flash;
  swipe?: Swipe;
  /** Seconds a skip moves (the `skip` setting). */
  skip: number;
  /** MRP is up (now playing, seek); keys work without it. */
  mrp: boolean;
  /** The AirPlay half was never paired: the card says how to add it. */
  noAirplay?: boolean;
  /** A link was just copied: the banner offers it. */
  offer?: OfferCard;
};

/** Dock tiles: as many 5:3 tiles as fit beside the "All apps" tile, a digit each. */
export const DOCK_WIDE = 6, DOCK_COMPACT = 5;

/** A part of the pad or a button while its key flashes: the accent, translucent, so the panel's ink stays on it in both themes. */
const LIT: HexColor = "#4F8AE866";

// ---- the clickpad --------------------------------------------------------------------------------

/** One cell of the pad: a glyph (or nothing), its action, lit when its key was just pressed. */
function cell(st: RemoteState, id: Flash, size: number, glyph?: string, action?: string, centre = false): ViewNode {
  const lit = st.flash === id;
  const surface = lit ? LIT : centre ? "elevated" : undefined;
  return {
    type: "stack", key: `cell-${id}`, width: size, height: size, ...(surface && { surface }), radius: true,
    align: "center", justify: "center", ...(action && { action }),
    children: glyph ? [text(glyph, { style: "glyph", size: centre ? "lg" : "md", color: lit ? "accent" : "muted" })] : [],
  };
}

/** The clickpad: a rounded square of nine cells, arrows on the edges, Select in the middle; a swipe tints the pad toward its side for a moment. */
export function clickpad(st: RemoteState, side: number): ViewNode {
  const c = Math.floor((side - 16) / 3);
  // Corners are inert: a stack per corner keyed by position, so the grid holds its shape.
  const corner = (k: string): ViewNode => ({ type: "stack", key: `corner-${k}`, width: c, height: c, children: [] });
  const swipeHint = st.swipe ? { up: "↑", down: "↓", left: "←", right: "→" }[st.swipe] : undefined;
  return {
    type: "stack", key: "pad", direction: "column", gap: 1, padding: 1, align: "center", surface: "sunken", radius: true,
    children: [
      row([corner("nw"), cell(st, "up", c, G.up, "up"), corner("ne")], { key: "pad-1", gap: 1 }),
      row([cell(st, "left", c, G.left, "left"), cell(st, "select", c, swipeHint ?? undefined, "select", true), cell(st, "right", c, G.right, "right")], { key: "pad-2", gap: 1 }),
      row([corner("sw"), cell(st, "down", c, G.down, "down"), corner("se")], { key: "pad-3", gap: 1 }),
    ],
  };
}

/** A round-ish remote button: a glyph on the button colour, its action on a click, lit while its key flashes. */
function button(st: RemoteState, id: Flash, glyph: string, action: string, size: number, label?: string): ViewNode {
  const lit = st.flash === id;
  return column([
    { type: "stack", key: `btn-${id}`, width: size, height: size, surface: lit ? LIT : "elevated", radius: true, align: "center", justify: "center", action, children: [text(glyph, { style: "glyph", size: "md", color: lit ? "accent" : undefined })] },
    ...(label ? [text(label, { size: "xs", color: "faint", align: "center", width: size + 8 })] : []),
  ], { key: `b-${id}`, gap: 0, align: "center" });
}

/** The buttons under the pad, as the Siri Remote lays them out: Back and TV, then Play/Pause, then the volume, then power. */
function buttons(st: RemoteState, size: number, labels: boolean): ViewNode {
  return column([
    row([button(st, "menu", G.back, "menu", size, labels ? "back" : undefined), button(st, "home", G.home, "home", size, labels ? "home" : undefined), button(st, "play", G.playPause, "play-pause", size, labels ? "play" : undefined)], { key: "btns-1", gap: 2, justify: "center", align: "start" }),
    row([button(st, "vol-", G.volDown, "volume-down", size, labels ? "vol" : undefined), button(st, "vol+", G.volUp, "volume-up", size, labels ? "vol" : undefined), button(st, "power", st.power === "off" ? G.power : G.sleep, "power", size, labels ? (st.power === "off" ? "wake" : "sleep") : undefined)], { key: "btns-2", gap: 2, justify: "center", align: "start" }),
  ], { key: "buttons", gap: 2, align: "center" });
}

// ---- what is playing ----------------------------------------------------------------------------

/** `4:05`, `1:06:03`. */
export const clock = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
  return (h ? [h, String(m).padStart(2, "0")] : [m]).concat(String(sec).padStart(2, "0")).join(":");
};

/** Where playback is now: the position the TV last said, moved on by the rate since then. */
export function positionAt(n: NowPlaying | undefined, at: number): number | undefined {
  if (n?.position === undefined) return undefined;
  const moved = n.state === "playing" && n.at ? ((at - n.at) / 1000) * (n.rate ?? 1) : 0;
  const p = n.position + Math.max(0, moved);
  return n.duration ? Math.min(n.duration, p) : p;
}

/** The lines a card shows for what plays: a headline and what it belongs to (an episode's show, a song's artist and album). */
export function titles(n: NowPlaying, appName?: string): { title: string; sub?: string; small?: string } {
  const ep = n.season !== undefined && n.episode !== undefined ? `S${n.season} · E${n.episode}` : n.episode !== undefined ? `Episode ${n.episode}` : undefined;
  if (n.series) return { title: n.title ?? n.series, sub: [n.series, ep].filter(Boolean).join(" · "), small: appName };
  if (n.artist) return { title: n.title ?? "Untitled", sub: n.artist, small: [n.album, appName].filter(Boolean).join(" · ") };
  return { title: n.title ?? appName ?? "Playing", sub: n.album ?? n.genre, small: n.title ? appName : undefined };
}

const STATE_BADGE: Partial<Record<NowPlaying["state"], [string, TagColor]>> = { paused: ["paused", "amber"], seeking: ["seeking", "blue"], stopped: ["stopped", "grey"] };

/** The kind of thing playing, as a glyph for the stand-in cover. */
const kindGlyph = (n?: NowPlaying) => (n?.mediaType === "music" ? G.music : n?.mediaType === "podcast" ? G.podcast : n ? G.movie : G.tv);

function cover(st: RemoteState, side: number): ViewNode {
  const key = `cover-${st.now?.itemId ?? st.app?.id ?? "none"}`;
  if (st.art) return { type: "image", key, src: st.art, width: side, height: side, mask: "rounded", alt: st.now?.title ?? st.app?.name, transition: { enter: "fade" } };
  if (st.app) return { type: "image", key, src: st.app.art, width: side, height: side, mask: "rounded", alt: st.app.name, transition: { enter: "fade" } };
  return { type: "stack", key, width: side, height: side, surface: "sunken", radius: true, align: "center", justify: "center", children: [text(kindGlyph(st.now), { style: "glyph", size: "xl", color: "faint" })], transition: { enter: "fade" } };
}

/** The card draws what plays (and its position bar): awake, and something with a title is loaded. */
const showsNow = (st: RemoteState) => st.power !== "off" && !!st.now && st.now.state !== "idle" && !!(st.now.title || st.now.artist || st.now.series);
const seekable = (st: RemoteState) => st.mrp && (!st.now?.commands || st.now.commands.includes("seek"));

/** The position as a slider a click seeks with when the app lets it, a plain bar otherwise; the times either side. */
function progress(st: RemoteState, width: number): ViewNode | undefined {
  const d = st.now?.duration, p = st.position;
  if (!d || p === undefined) return undefined;
  const value = Math.min(1, Math.max(0, p / d));
  // `47:54` and `-1:13:06`: the columns as wide as an hours-long item needs.
  const tw = d >= 3600 ? 64 : 44;
  const bar: ViewNode = seekable(st) ? { type: "slider", key: "seek", value, width: width - 2 * tw - 16, label: "Position", action: "seek" } : { type: "progress", key: "seek", value, width: width - 2 * tw - 16 };
  return row([text(clock(p), { style: "mono", size: "xs", width: tw }), bar, text(`-${clock(d - p)}`, { style: "mono", size: "xs", width: tw, align: "end" })], { key: "progress", gap: 2 });
}

/** The card: what plays with its cover, or what the TV is doing when nothing does. */
function nowCard(st: RemoteState, width: number, side: number): ViewNode {
  const inner = width - side - 3 * 4 - 2 * 8;
  let lines: ViewNode[];
  if (st.power === "off") {
    lines = [text(`${st.device?.name ?? "The Apple TV"} is asleep`, { style: "headline", width: inner }), text("p wakes it; so does any key", { style: "muted", size: "sm", width: inner })];
  } else if (showsNow(st) && st.now) {
    const t = titles(st.now, st.app?.name);
    const badge = STATE_BADGE[st.now.state];
    lines = [
      row([text(t.title, { style: "headline", key: `t-${st.now.itemId ?? t.title}`, width: badge ? inner - 64 : inner, transition: { enter: "fade" } }), ...(badge ? [{ type: "badge", key: `state-${st.now.state}`, text: badge[0], color: badge[1] } as ViewNode] : [])], { key: "title-row", gap: 1 }),
      ...(t.sub ? [text(t.sub, { style: "muted", size: "sm", width: inner })] : []),
      ...(t.small ? [text(t.small, { size: "xs", color: "faint", width: inner })] : []),
    ];
    const bar = progress(st, inner);
    if (bar) lines.push(bar);
  } else if (st.power === "screensaver") {
    lines = [text("Screen saver", { style: "headline", width: inner }), text("Any key brings the Home Screen back", { style: "muted", size: "sm", width: inner })];
  } else if (st.app) {
    lines = [text(st.app.name, { style: "headline", width: inner }), text(st.noAirplay ? "Nothing playing; the AirPlay step of the setup shows what does" : "Nothing playing", { style: "muted", size: "sm", width: inner })];
  } else {
    lines = [text("Home Screen", { style: "headline", width: inner }), text(st.noAirplay ? "Pair AirPlay in the setup to see what plays" : "Nothing playing", { style: "muted", size: "sm", width: inner })];
  }
  return row([cover(st, side), column(lines, { key: "lines", gap: 1, grow: true, justify: "center" })], { key: "card", gap: 3, padding: 2, surface: "elevated", radius: true, align: "center", minHeight: side + 16, ...(showsNow(st) && { action: "now" }) });
}

/** The TV is showing its keyboard: a banner that says what for, with `t` (or the field already open). */
function keyboardBanner(st: RemoteState, width: number): ViewNode | undefined {
  const k = st.keyboard;
  if (!k?.focused) return undefined;
  const what = k.title || k.prompt || "a text field";
  return row([
    text(G.keyboard, { style: "glyph", size: "md", color: "amber" }),
    column([text(`${st.device?.name ?? "The TV"} is asking for text: ${what}`, { size: "sm", weight: "medium", width: width - 120 }), ...(k.text ? [text(k.secure ? "•".repeat(k.text.length) : k.text, { style: "mono", size: "xs", width: width - 120 })] : [])], { gap: 0, grow: true }),
    ...(st.typing ? [text("typing", { size: "xs", color: "amber" })] : keyHint("t", "type")),
  ], { key: "keyboard", gap: 2, padding: 2, surface: "#F0B25A26", radius: true, transition: { enter: "slide-down" } });
}

/** A link was just copied: its picture and title, and the keys that play it or wave it off. */
function offerBanner(st: RemoteState, width: number): ViewNode | undefined {
  const o = st.offer;
  if (!o) return undefined;
  return row([
    o.thumb ? { type: "image", key: "offer-thumb", src: o.thumb, width: 48, height: 27, mask: "rounded", alt: o.title } : text(G.play, { style: "glyph", size: "md", color: "accent" }),
    column([text(o.title, { size: "sm", weight: "semibold", width: width - 190 }), text(["Copied", o.by, o.app].filter(Boolean).join(" · "), { size: "xs", color: "muted", width: width - 190 })], { gap: 0, grow: true }),
    ...keyHint("l", "play", { action: "play-link" }), ...keyHint("x", "dismiss", { action: "offer:dismiss" }),
  ], { key: "offer", gap: 2, padding: 2, surface: "#4F8AE826", radius: true, action: "play-link", transition: { enter: "slide-down" } });
}

/** The favourite apps as tiles with their digit, and the All apps tile. */
function dock(st: RemoteState, max: number, h: number): ViewNode {
  // The TV's Home Screen shape: 5:3 tiles, the app's own tvOS picture.
  const w = Math.round((h * 5) / 3);
  const tiles = st.dock.slice(0, max).map((a, i): ViewNode => column([
    { type: "image", key: `dock-img-${a.id}`, src: a.wide, width: w, height: h, mask: "rounded", alt: a.name, action: `launch:${i}` },
    row([keycap(String(i + 1), `launch:${i}`)], { key: `dk-${i}`, justify: "center" }),
  ], { key: `dock-${a.id}`, gap: 1, align: "center", transition: { enter: "fade", delay: Math.min(8, i) } }));
  tiles.push(column([
    { type: "stack", key: "dock-all", width: h, height: h, surface: "sunken", radius: true, align: "center", justify: "center", action: "apps", children: [text(G.apps, { style: "glyph", size: "lg", color: "muted" })] },
    row([keycap("a", "apps")], { key: "dk-a", justify: "center" }),
  ], { key: "dock-all-col", gap: 1, align: "center" }));
  return row(tiles, { key: "dock", gap: 2, align: "start" });
}

/** What the remote does beyond the buttons, as clickable hints: the room left under the dock in the panel. */
function extras(st: RemoteState): ViewNode {
  return row([
    ...keyHint(",", `back ${st.skip} s`, { action: "skip-back" }),
    ...keyHint(".", "forward", { action: "skip-forward" }),
    ...keyHint("tab", "app switcher", { action: "home:double" }),
    ...keyHint("c", "control center", { action: "control-center" }),
    ...keyHint("s", "screen saver", { action: "screensaver" }),
    ...keyHint("u", "users", { action: "accounts" }),
    ...keyHint("t", "type", { action: "type" }),
  ], { key: "extras", gap: 1, minHeight: 22 });
}

function volumeRow(st: RemoteState, width: number): ViewNode | undefined {
  if (st.volume === undefined) return undefined;
  const pct = Math.round(st.volume * 100);
  return row([
    text(G.volume, { style: "glyph", size: "sm", color: "muted" }),
    { type: "slider", key: "volume", value: st.volume, width: width - 24 - 44 - 16, label: "Volume", action: "volume:set" },
    text(`${pct}%`, { style: "number", size: "xs", width: 44, align: "end", key: `vol-${pct}` }),
  ], { key: "volume-row", gap: 2 });
}

function header(st: RemoteState): ViewNode {
  const badges: ViewNode[] = [];
  if (st.conn === "connecting") badges.push({ type: "badge", key: "conn", text: "connecting", color: "blue" });
  else if (st.conn === "down") badges.push({ type: "badge", key: "conn", text: "not connected", color: "red" });
  else if (st.power === "off") badges.push({ type: "badge", key: "power", text: "asleep", color: "grey" });
  else if (st.power === "screensaver") badges.push({ type: "badge", key: "power", text: "screen saver", color: "violet" });
  else badges.push({ type: "badge", key: "power", text: "on", color: "green" });
  if (st.others) badges.push(...keyHint("d", st.others === 1 ? "1 more Apple TV" : `${st.others} more Apple TVs`, { action: "device" }));
  return row([
    text(G.tv, { style: "glyph", size: "lg", color: "muted" }),
    text(st.device?.name ?? "Apple TV", { style: "title", key: `name-${st.device?.name}` }),
    text(st.device?.modelName ?? "", { style: "muted", size: "xs" }),
    { type: "spacer" },
    ...badges,
  ], { key: "header", gap: 2, minHeight: 24 });
}

function hints(st: RemoteState): ViewNode {
  return row([
    ...keyHint(["up", "down", "left", "right"], "move"), ...keyHint("enter", "select"), ...keyHint("backspace", "back"), ...keyHint("h", "home"),
    ...keyHint("space", st.now?.state === "playing" ? "pause" : "play"), ...keyHint("t", "type"), ...keyHint("cmd+k", "more"),
  ], { key: "hints", gap: 1, minHeight: 22 });
}

// ---- the states that are not a remote -----------------------------------------------------------

function welcome(st: RemoteState): ViewNode {
  return column([
    { type: "stack", key: "w-tile", width: 64, height: 64, surface: "elevated", radius: true, align: "center", justify: "center", children: [text(G.remote, { style: "glyph", size: "xl" })] },
    text("Control your Apple TV from here", { style: "headline", align: "center" }),
    text("The arrows move, Enter selects, your apps are a digit away, and you can type into the TV's search instead of hunting letters.", { style: "muted", size: "sm", align: "center", width: st.layout === "compact" ? 340 : 440 }),
    row(keyHint("enter", "set it up: pal finds the Apple TV, you type the code it shows"), { key: "w-keys", gap: 1, justify: "center" }),
  ], { key: "welcome", padding: 6, gap: 3, align: "center", justify: "center", grow: true });
}

function trouble(st: RemoteState): ViewNode {
  const name = st.device?.name ?? "The Apple TV";
  return column([
    { type: "stack", key: "t-tile", width: 56, height: 56, surface: "sunken", radius: true, align: "center", justify: "center", children: [text(st.conn === "connecting" ? G.tv : G.wifiOff, { style: "glyph", size: "xl", color: st.conn === "connecting" ? "muted" : "red" })] },
    text(st.conn === "connecting" ? `Connecting to ${name}` : `${name} did not answer`, { style: "headline", align: "center", key: `t-${st.conn}`, transition: { enter: "fade" } }),
    text(st.conn === "connecting" ? "A sleeping Apple TV takes a few seconds to wake up." : st.error ?? "Is it on, and on this network?", { style: "muted", size: "sm", align: "center", width: 420 }),
    ...(st.conn === "down" ? [row([...keyHint("enter", "try again"), ...keyHint("s", "setup")], { key: "t-keys", gap: 1, justify: "center" })] : [{ type: "progress", key: "t-spin", value: 0.35, width: 160 } as ViewNode]),
  ], { key: "trouble", padding: 6, gap: 3, align: "center", justify: "center", grow: true });
}

// ---- actions -------------------------------------------------------------------------------------

/** Every action the remote answers to; the first listed is Enter. */
export function actions(st: RemoteState): Action[] {
  if (st.unpaired) return [{ id: "setup", title: "Set up an Apple TV" }];
  if (st.conn !== "up") return [{ id: "reconnect", title: "Try again" }, { id: "setup", title: "Set up Apple TV", shortcut: "s" }];
  const playing = st.now?.state === "playing";
  const acts: Action[] = [
    { id: "select", title: "Select" },
    { id: "select:hold", title: "Hold Select (more options)", shortcut: "shift+enter" },
    { id: "menu", title: "Back", shortcut: "backspace" },
    { id: "home", title: "Home (the TV button)", shortcut: "h" },
    { id: "home:double", title: "App switcher", shortcut: "tab" },
    { id: "control-center", title: "Control Center", shortcut: "c" },
    { id: "play-pause", title: playing ? "Pause" : "Play", shortcut: "space" },
    { id: "skip-back", title: `Back ${st.skip} s`, shortcut: [",", "["] },
    { id: "skip-forward", title: `Forward ${st.skip} s`, shortcut: [".", "]"] },
    { id: "previous", title: "Previous (chapter, track)", shortcut: "cmd+left" },
    { id: "next", title: "Next (chapter, track)", shortcut: "cmd+right" },
    { id: "volume-up", title: "Volume up", shortcut: ["=", "+"] },
    { id: "volume-down", title: "Volume down", shortcut: "-" },
    { id: "type", title: st.keyboard?.focused ? `Type: ${st.keyboard.title || st.keyboard.prompt || "the field on the TV"}` : "Type on the TV", shortcut: "t" },
    { id: "apps", title: "All apps", shortcut: "a" },
    { id: "now", title: "Now Playing", shortcut: "n" },
    { id: "play-link", title: st.offer ? `Play “${st.offer.title.length > 40 ? `${st.offer.title.slice(0, 39)}…` : st.offer.title}”` : "Play a link on the TV", shortcut: "l" },
    ...(st.offer ? [{ id: "offer:dismiss", title: "Not now", shortcut: "x" } as Action] : []),
    { id: "power", title: st.power === "off" ? "Wake up" : "Sleep", shortcut: "p" },
    { id: "screensaver", title: "Screen saver", shortcut: "s" },
    { id: "accounts", title: "Switch user", shortcut: "u" },
    ...(st.others ? [{ id: "device", title: "Switch Apple TV", shortcut: "d" } as Action] : []),
    { id: "copy", title: "Copy what is playing", shortcut: "cmd+c" },
    { id: "reconnect", title: "Reconnect", shortcut: "r" },
    { id: "setup", title: "Set up or pair another Apple TV", shortcut: "cmd+," },
  ];
  for (const d of ["up", "down", "left", "right"] as const) {
    acts.push({ id: d, title: d[0].toUpperCase() + d.slice(1), shortcut: d, hidden: true });
    acts.push({ id: `swipe:${d}`, title: `Swipe ${d}`, shortcut: `shift+${d}`, hidden: true });
  }
  st.dock.slice(0, st.layout === "compact" ? DOCK_COMPACT : DOCK_WIDE).forEach((a, i) => acts.push({ id: `launch:${i}`, title: `Open ${a.name}`, shortcut: String(i + 1), hidden: true }));
  // The sliders' clicks; declared only while a slider draws them.
  if (showsNow(st) && seekable(st) && st.now?.duration && st.position !== undefined) acts.push({ id: "seek", title: "Seek", hidden: true });
  if (st.volume !== undefined) acts.push({ id: "volume:set", title: "Set volume", hidden: true });
  acts.push({ id: "type:send", title: "Send the text", hidden: true, shortcut: "enter" }, { id: "type:cancel", title: "Stop typing", hidden: true, shortcut: "escape" });
  return acts;
}

// ---- the view ------------------------------------------------------------------------------------

export function render(st: RemoteState): View {
  const compact = st.layout === "compact";
  let tree: ViewNode;
  if (st.unpaired) tree = welcome(st);
  else if (st.conn !== "up") tree = trouble(st);
  else if (compact) {
    const W = POPOVER_W;
    tree = column([
      nowCard(st, W, 56),
      ...[offerBanner(st, W), keyboardBanner(st, W)].filter((x): x is ViewNode => !!x),
      row([clickpad(st, 148), column([buttons(st, 36, false), ...[volumeRow(st, W - 148 - 16)].filter((x): x is ViewNode => !!x)], { key: "right", gap: 3, grow: true, align: "center" })], { key: "controls", gap: 4, align: "center" }),
      dock(st, DOCK_COMPACT, 36),
    ], { key: "compact", padding: 3, gap: 3 });
  } else {
    const LEFT = 176, RIGHT = 696 - LEFT - 16;
    const left = column([clickpad(st, LEFT), buttons(st, 40, true)], { key: "left", gap: 3, align: "center", width: LEFT });
    const right = column([
      header(st),
      nowCard(st, RIGHT, 84),
      ...[offerBanner(st, RIGHT), keyboardBanner(st, RIGHT)].filter((x): x is ViewNode => !!x),
      dock(st, DOCK_WIDE, 40),
      ...[volumeRow(st, RIGHT)].filter((x): x is ViewNode => !!x),
      // The banners take the room the extras row had.
      ...(st.offer || st.keyboard?.focused ? [] : [extras(st)]),
    ], { key: "right", gap: 3, grow: true });
    tree = column([row([left, right], { key: "main", gap: 4, align: "start" }), { type: "spacer", key: "fill" }, hints(st)], { key: "wide", padding: 3, gap: 2, grow: true });
  }
  const title = st.unpaired ? "Apple TV" : `${st.device?.name ?? "Apple TV"}${st.now?.title && st.conn === "up" ? ` · ${st.now.title}` : ""}`;
  const v: View = { tree, actions: actions(st), title: title.length > 72 ? `${title.slice(0, 71)}…` : title, id: "remote", keys: "actions" };
  if (st.typing && !st.unpaired && st.conn === "up") v.input = { value: st.keyboard?.text ?? "", placeholder: st.keyboard?.title || st.keyboard?.prompt || "Text for the TV", submit: "type:send", cancel: "type:cancel" };
  return v;
}
