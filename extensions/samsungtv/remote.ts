// The remote as a render tree (`View` in `@zcag/pal`), pure: the fixture
// and the tests draw rigged states with this same function. Two layouts:
// `wide` for the panel (the d-pad and the buttons on the left; the TV,
// what is in front, the keyboard the TV is asking with, the app dock, the
// inputs and the volume on the right; the keys under everything) and
// `compact` for the bar popover (what is in front on top, the d-pad
// beside the buttons and the volume, the inputs, the dock). The d-pad is
// made of stacks, so every part is a click target as well as a key, each
// lit for a moment in the accent when its key is pressed (`flash`). The
// volume, the power button and the inputs are pal's control parts
// (docs/design/controls.md), drawn from what `controls.get` answered: a
// group may hand them to another device, and then they drive that one.
// Nothing here waits on the TV.
import { CONTROL_LIT, POPOVER_W, column, controlButton, inputsRow, keyHint, keycap, powerButton, row, text, volumeRow, withControls, type Action, type Served, type TagColor, type View, type ViewNode } from "@zcag/pal";
import type { Keyboard, Media, Power } from "./types.ts";

/** Nerd Font glyphs (Material Design) the remote is drawn with. */
export const G = {
  tv: "\u{f0502}", remote: "\u{f0ec5}", up: "\u{f0143}", down: "\u{f0140}", left: "\u{f0141}", right: "\u{f0142}",
  back: "\u{f17b3}", home: "\u{f02dc}", playPause: "\u{f040e}", rewind: "\u{f045f}", forward: "\u{f0211}", prev: "\u{f04ae}", next: "\u{f04ad}",
  volUp: "\u{f075d}", volDown: "\u{f075e}", mute: "\u{f075f}", power: "\u{f0425}", standby: "\u{f0906}",
  keyboard: "\u{f030c}", apps: "\u{f003b}", hdmi: "\u{f0841}", settings: "\u{f0493}", guide: "\u{f0503}", web: "\u{f059f}",
  check: "\u{f05e0}", alert: "\u{f0028}", info: "\u{f02fd}", wifiOff: "\u{f05aa}", play: "\u{f0ecf}", cast: "\u{f0118}",
} as const;

export type Layout = "wide" | "compact";
/** The parts of the pad and the buttons a key lights for a moment. */
export type Flash = "up" | "down" | "left" | "right" | "select" | "back" | "home" | "play" | "rewind" | "forward" | "power";
/** A dock app: its tile. `front`: it is the app on screen. */
export type DockApp = { id: string; name: string; art: string; front?: boolean };

export type RemoteState = {
  layout: Layout;
  /** No TV paired yet: the welcome. */
  unpaired?: boolean;
  device?: { name: string; model: string };
  /** How many other TVs are paired (`d` switches). */
  others?: number;
  conn: "connecting" | "up" | "down";
  /** Why the connection is down, in words. */
  error?: string;
  /** The TV can be woken from off (its MAC is known). */
  wakeable?: boolean;
  power: Power;
  /** The app on screen: its name and tile. */
  front?: { id: string; name: string; art: string };
  /** What a DLNA sender plays on the TV, and where it is now. */
  media?: Media;
  position?: number;
  /** The controls as they are served to this TV: its own, or the group's device's. */
  volume?: Served<"volume"> | null;
  powerSlot?: Served<"power"> | null;
  inputs?: Served<"inputs"> | null;
  keyboard?: Keyboard;
  /** The text field is open in the search row. */
  typing?: boolean;
  dock: DockApp[];
  flash?: Flash;
};

/** Dock tiles: as many as fit beside the "All apps" tile, a digit each. */
export const DOCK_WIDE = 8, DOCK_COMPACT = 6;

// ---- the d-pad -----------------------------------------------------------------------------------

/** One cell of the pad: a glyph (or nothing), its action, lit when its key was just pressed. */
function cell(st: RemoteState, id: Flash, size: number, glyph?: string, action?: string, centre = false): ViewNode {
  const lit = st.flash === id;
  const surface = lit ? CONTROL_LIT : centre ? "elevated" : undefined;
  return {
    type: "stack", key: `cell-${id}`, width: size, height: size, ...(surface && { surface }), radius: true,
    align: "center", justify: "center", ...(action && { action }),
    children: glyph ? [text(glyph, { style: "glyph", size: centre ? "sm" : "md", color: lit ? "accent" : "muted" })] : centre ? [text("OK", { size: "xs", weight: "semibold", color: lit ? "accent" : "muted" })] : [],
  };
}

/** The d-pad: the four arrows round OK, as the Samsung remote has them. */
export function dpad(st: RemoteState, side: number): ViewNode {
  const c = Math.floor((side - 16) / 3);
  const corner = (k: string): ViewNode => ({ type: "stack", key: `corner-${k}`, width: c, height: c, children: [] });
  return {
    type: "stack", key: "pad", direction: "column", gap: 1, padding: 1, align: "center", surface: "sunken", radius: true,
    children: [
      row([corner("nw"), cell(st, "up", c, G.up, "up"), corner("ne")], { key: "pad-1", gap: 1 }),
      row([cell(st, "left", c, G.left, "left"), cell(st, "select", c, undefined, "select", true), cell(st, "right", c, G.right, "right")], { key: "pad-2", gap: 1 }),
      row([corner("sw"), cell(st, "down", c, G.down, "down"), corner("se")], { key: "pad-3", gap: 1 }),
    ],
  };
}

/** A remote button, in the look of pal's control parts, lit while its key flashes. */
const button = (st: RemoteState, id: Flash, glyph: string, action: string, size: number, label?: string): ViewNode => controlButton(id, glyph, action, size, { lit: st.flash === id, label });

/** The buttons under the pad: Back, Home, Play/Pause; rewind, forward, and power (a slot). */
function buttons(st: RemoteState, size: number, labels: boolean): ViewNode {
  const power = powerButton(st.powerSlot, size, { lit: st.flash === "power", labels });
  return column([
    row([button(st, "back", G.back, "back", size, labels ? "back" : undefined), button(st, "home", G.home, "home", size, labels ? "home" : undefined), button(st, "play", G.playPause, "play-pause", size, labels ? "play" : undefined)], { key: "btns-1", gap: 2, justify: "center", align: "start" }),
    row([button(st, "rewind", G.rewind, "rewind", size, labels ? "rew" : undefined), button(st, "forward", G.forward, "forward", size, labels ? "ff" : undefined), ...(power ? [power] : [])], { key: "btns-2", gap: 2, justify: "center", align: "start" }),
  ], { key: "buttons", gap: 2, align: "center" });
}

// ---- what is on ----------------------------------------------------------------------------------

/** `4:05`, `1:06:03`. */
export const clock = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60];
  return (h ? [h, String(m).padStart(2, "0")] : [m]).concat(String(sec).padStart(2, "0")).join(":");
};

/** Where a DLNA sender's media is now: the position the TV last said, moved on since then while it plays. */
export function positionAt(m: Media | undefined, at: number): number | undefined {
  if (m?.position === undefined) return undefined;
  const p = m.position + (m.state === "playing" ? Math.max(0, (at - m.at) / 1000) : 0);
  return m.duration ? Math.min(m.duration, p) : p;
}

const MEDIA_BADGE: Partial<Record<Media["state"], [string, TagColor]>> = { paused: ["paused", "amber"], stopped: ["stopped", "grey"], transitioning: ["loading", "blue"] };

function picture(st: RemoteState, side: number): ViewNode {
  const key = `pic-${st.media ? "media" : st.front?.id ?? "none"}`;
  if (st.front && !st.media) return { type: "image", key, src: st.front.art, width: side, height: side, mask: "rounded", alt: st.front.name, transition: { enter: "fade" } };
  return { type: "stack", key, width: side, height: side, surface: "sunken", radius: true, align: "center", justify: "center", children: [text(st.media ? G.cast : st.power === "on" ? G.tv : G.standby, { style: "glyph", size: "xl", color: "faint" })], transition: { enter: "fade" } };
}

/** The card: what is on the screen, or what the TV is doing. */
function nowCard(st: RemoteState, width: number, side: number): ViewNode {
  const inner = width - side - 3 * 4 - 2 * 8;
  const name = st.device?.name ?? "The TV";
  let lines: ViewNode[];
  if (st.power !== "on") {
    lines = [text(`${name} is in standby`, { style: "headline", width: inner }), text("p turns it on", { style: "muted", size: "sm", width: inner })];
  } else if (st.media) {
    const m = st.media, badge = MEDIA_BADGE[m.state];
    lines = [
      row([text(m.title ?? "Media from this network", { style: "headline", width: badge ? inner - 64 : inner, key: `t-${m.url ?? m.title}`, transition: { enter: "fade" } }), ...(badge ? [{ type: "badge", key: `state-${m.state}`, text: badge[0], color: badge[1] } as ViewNode] : [])], { key: "title-row", gap: 1 }),
      text("Sent to the TV over DLNA", { style: "muted", size: "sm", width: inner }),
    ];
    if (m.duration && st.position !== undefined) {
      const tw = m.duration >= 3600 ? 64 : 44;
      lines.push(row([text(clock(st.position), { style: "mono", size: "xs", width: tw }), { type: "progress", key: "seek", value: Math.min(1, st.position / m.duration), width: inner - 2 * tw - 16 }, text(`-${clock(m.duration - st.position)}`, { style: "mono", size: "xs", width: tw, align: "end" })], { key: "progress", gap: 2 }));
    }
  } else if (st.front) {
    lines = [text(st.front.name, { style: "headline", width: inner, key: `t-${st.front.id}`, transition: { enter: "fade" } }), text(`On ${name}`, { style: "muted", size: "sm", width: inner })];
  } else {
    lines = [text("No app in front", { style: "headline", width: inner }), text("Live TV, an input, or the Home screen", { style: "muted", size: "sm", width: inner })];
  }
  return row([picture(st, side), column(lines, { key: "lines", gap: 1, grow: true, justify: "center" })], { key: "card", gap: 3, padding: 2, surface: "elevated", radius: true, align: "center", minHeight: side + 16 });
}

/** The TV is showing its keyboard: a banner, with `t` (or the field already open). */
function keyboardBanner(st: RemoteState, width: number): ViewNode | undefined {
  const k = st.keyboard;
  if (!k?.open) return undefined;
  return row([
    text(G.keyboard, { style: "glyph", size: "md", color: "amber" }),
    column([text(`${st.device?.name ?? "The TV"} is asking for text`, { size: "sm", weight: "medium", width: width - 120 }), ...(k.text ? [text(k.text, { style: "mono", size: "xs", width: width - 120 })] : [])], { gap: 0, grow: true }),
    ...(st.typing ? [text("typing", { size: "xs", color: "amber" })] : keyHint("t", "type")),
  ], { key: "keyboard", gap: 2, padding: 2, surface: "#F0B25A26", radius: true, transition: { enter: "slide-down" } });
}

/** The dock: the apps as the TV draws them, the one on screen dotted, a digit under each, then All apps. */
function dock(st: RemoteState, max: number, side: number): ViewNode {
  const tiles = st.dock.slice(0, max).map((a, i): ViewNode => column([
    { type: "image", key: `dock-img-${a.id}`, src: a.art, width: side, height: side, mask: "rounded", alt: a.name, action: `launch:${i}`, ...(a.front && { dot: "green" as const }) },
    row([keycap(String(i + 1), `launch:${i}`)], { key: `dk-${i}`, justify: "center" }),
  ], { key: `dock-${a.id}`, gap: 1, align: "center", transition: { enter: "fade", delay: Math.min(8, i) } }));
  tiles.push(column([
    { type: "stack", key: "dock-all", width: side, height: side, surface: "sunken", radius: true, align: "center", justify: "center", action: "apps", children: [text(G.apps, { style: "glyph", size: "lg", color: "muted" })] },
    row([keycap("a", "apps")], { key: "dk-a", justify: "center" }),
  ], { key: "dock-all-col", gap: 1, align: "center" }));
  return row(tiles, { key: "dock", gap: 2, align: "start" });
}

/** What the remote does beyond the buttons, as clickable hints. */
function extras(): ViewNode {
  return row([
    keycap("[", "channel-down"), ...keyHint("]", "channel", { action: "channel-up" }),
    ...keyHint("i", "next input", { action: "input:next" }),
    ...keyHint("s", "settings", { action: "menu" }),
    ...keyHint("g", "guide", { action: "guide" }),
    ...keyHint("e", "exit", { action: "exit" }),
  ], { key: "extras", gap: 1, minHeight: 22 });
}

function header(st: RemoteState): ViewNode {
  const badges: ViewNode[] = [];
  if (st.conn === "connecting") badges.push({ type: "badge", key: "conn", text: "connecting", color: "blue" });
  else if (st.conn === "down") badges.push({ type: "badge", key: "conn", text: "not connected", color: "red" });
  else if (st.power !== "on") badges.push({ type: "badge", key: "power", text: "standby", color: "grey" });
  else badges.push({ type: "badge", key: "power", text: "on", color: "green" });
  if (st.others) badges.push(...keyHint("d", st.others === 1 ? "1 more TV" : `${st.others} more TVs`, { action: "device" }));
  return row([
    text(G.tv, { style: "glyph", size: "lg", color: "muted" }),
    text(st.device?.name ?? "Samsung TV", { style: "title", key: `name-${st.device?.name}` }),
    text(st.device?.model ?? "", { style: "muted", size: "xs" }),
    { type: "spacer" },
    ...badges,
  ], { key: "header", gap: 2, minHeight: 24 });
}

function hints(st: RemoteState): ViewNode {
  return row([
    ...keyHint(["up", "down", "left", "right"], "move"), ...keyHint("enter", "OK"), ...keyHint("backspace", "back"), ...keyHint("h", "home"),
    ...keyHint(["-", "="], "volume"), ...keyHint("p", st.power === "on" ? "off" : "on"), ...keyHint("cmd+k", "more"),
  ], { key: "hints", gap: 1, minHeight: 22 });
}

// ---- the states that are not a remote -----------------------------------------------------------

function welcome(st: RemoteState): ViewNode {
  return column([
    { type: "stack", key: "w-tile", width: 64, height: 64, surface: "elevated", radius: true, align: "center", justify: "center", children: [text(G.remote, { style: "glyph", size: "xl" })] },
    text("Control your Samsung TV from here", { style: "headline", align: "center" }),
    text("The arrows move, Enter is OK, your apps are a digit away, the volume and the inputs are a key, and you can type into the TV's search instead of hunting letters.", { style: "muted", size: "sm", align: "center", width: st.layout === "compact" ? 340 : 440 }),
    row(keyHint("enter", "set it up: pal finds the TV, you press Allow on it"), { key: "w-keys", gap: 1, justify: "center" }),
  ], { key: "welcome", padding: 6, gap: 3, align: "center", justify: "center", grow: true });
}

function trouble(st: RemoteState): ViewNode {
  const name = st.device?.name ?? "The TV";
  const connecting = st.conn === "connecting";
  return column([
    { type: "stack", key: "t-tile", width: 56, height: 56, surface: "sunken", radius: true, align: "center", justify: "center", children: [text(connecting ? G.tv : G.wifiOff, { style: "glyph", size: "xl", color: connecting ? "muted" : "red" })] },
    text(connecting ? `Connecting to ${name}` : `${name} did not answer`, { style: "headline", align: "center", key: `t-${st.conn}`, transition: { enter: "fade" } }),
    text(connecting ? "Asking the TV over the network." : st.error ?? "Is it on, and on this network?", { style: "muted", size: "sm", align: "center", width: 420 }),
    ...(connecting ? [{ type: "progress", key: "t-spin", value: 0.35, width: 160 } as ViewNode] : [row([...keyHint("enter", "try again"), ...(st.wakeable ? keyHint("p", "turn it on") : []), ...keyHint("cmd+,", "setup")], { key: "t-keys", gap: 1, justify: "center" })]),
  ], { key: "trouble", padding: 6, gap: 3, align: "center", justify: "center", grow: true });
}

// ---- actions -------------------------------------------------------------------------------------

/** Every action the remote answers to; the first listed is Enter. */
export function actions(st: RemoteState): Action[] {
  if (st.unpaired) return [{ id: "setup", title: "Set up a Samsung TV" }];
  if (st.conn !== "up") return [{ id: "reconnect", title: "Try again" }, ...(st.wakeable ? [{ id: "wake", title: "Turn it on (Wake-on-LAN)", shortcut: "p" } as Action] : []), { id: "setup", title: "Set up Samsung TV", shortcut: "cmd+," }];
  const acts: Action[] = [
    { id: "select", title: "OK" },
    { id: "back", title: "Back", shortcut: "backspace" },
    { id: "home", title: "Home", shortcut: "h" },
    { id: "play-pause", title: "Play or pause", shortcut: "space" },
    { id: "rewind", title: "Rewind", shortcut: "," },
    { id: "forward", title: "Fast forward", shortcut: "." },
    { id: "previous", title: "Previous", shortcut: "cmd+left" },
    { id: "next", title: "Next", shortcut: "cmd+right" },
    // The control parts' keys: spelled as their actions, so a group's device answers them.
    ...(st.volume ? [{ id: "controls:volume:step:1", title: "Volume up", shortcut: ["=", "+"] }, { id: "controls:volume:step:-1", title: "Volume down", shortcut: "-" }, { id: "controls:volume:mute", title: st.volume.muted ? "Unmute" : "Mute", shortcut: "m" }] as Action[] : []),
    ...(st.powerSlot ? [{ id: "controls:power:set", title: st.powerSlot.on === false ? "Turn on" : "Turn off (standby)", shortcut: "p" } as Action] : []),
    { id: "input:next", title: "Next input", shortcut: "i" },
    { id: "channel-up", title: "Channel up", shortcut: "]" },
    { id: "channel-down", title: "Channel down", shortcut: "[" },
    { id: "menu", title: "The TV's settings", shortcut: "s" },
    { id: "guide", title: "Guide", shortcut: "g" },
    { id: "info", title: "Info" },
    { id: "exit", title: "Exit", shortcut: "e" },
    // The TV's own keyboard is the only one typing reaches (an app's in-app keyboard, YouTube's, takes nothing).
    ...(st.keyboard?.open ? [{ id: "type", title: "Type into the TV's field", shortcut: "t" } as Action] : []),
    { id: "apps", title: "All apps", shortcut: "a" },
    ...(st.others ? [{ id: "device", title: "Switch TV", shortcut: "d" } as Action] : []),
    { id: "reconnect", title: "Reconnect", shortcut: "r" },
    { id: "setup", title: "Set up or pair another TV", shortcut: "cmd+," },
  ];
  for (const d of ["up", "down", "left", "right"] as const) acts.push({ id: d, title: d[0].toUpperCase() + d.slice(1), shortcut: d, hidden: true });
  st.dock.slice(0, st.layout === "compact" ? DOCK_COMPACT : DOCK_WIDE).forEach((a, i) => acts.push({ id: `launch:${i}`, title: `Open ${a.name}`, shortcut: String(i + 1), hidden: true }));
  acts.push({ id: "type:send", title: "Send the text", hidden: true, shortcut: "enter" }, { id: "type:cancel", title: "Stop typing", hidden: true, shortcut: "escape" });
  return acts;
}

// ---- the view ------------------------------------------------------------------------------------

const present = (xs: (ViewNode | undefined)[]) => xs.filter((x): x is ViewNode => !!x);

export function render(st: RemoteState): View {
  const compact = st.layout === "compact";
  let tree: ViewNode;
  if (st.unpaired) tree = welcome(st);
  else if (st.conn !== "up") tree = trouble(st);
  else if (compact) {
    const W = POPOVER_W;
    tree = column([
      nowCard(st, W, 56),
      ...present([keyboardBanner(st, W)]),
      row([dpad(st, 148), column([buttons(st, 36, false), ...present([volumeRow(st.volume, W - 148 - 16, { device: st.device?.name })])], { key: "right", gap: 3, grow: true, align: "center" })], { key: "controls", gap: 4, align: "center" }),
      ...present([inputsRow(st.inputs, W)]),
      dock(st, DOCK_COMPACT, 40),
    ], { key: "compact", padding: 3, gap: 3 });
  } else {
    const LEFT = 176, RIGHT = 696 - LEFT - 16;
    const left = column([dpad(st, LEFT), buttons(st, 40, true)], { key: "left", gap: 3, align: "center", width: LEFT });
    const right = column([
      header(st),
      nowCard(st, RIGHT, 72),
      ...present([keyboardBanner(st, RIGHT)]),
      dock(st, DOCK_WIDE, 44),
      ...present([inputsRow(st.inputs, RIGHT), volumeRow(st.volume, RIGHT, { device: st.device?.name })]),
      ...(st.keyboard?.open ? [] : [extras()]),
    ], { key: "right", gap: 3, grow: true });
    tree = column([row([left, right], { key: "main", gap: 4, align: "start" }), { type: "spacer", key: "fill" }, hints(st)], { key: "wide", padding: 3, gap: 2, grow: true });
  }
  const on = st.media?.title ?? st.front?.name;
  const title = st.unpaired ? "Samsung TV" : `${st.device?.name ?? "Samsung TV"}${on && st.conn === "up" && st.power === "on" ? ` · ${on}` : ""}`;
  const v: View = { tree, actions: actions(st), title: title.length > 72 ? `${title.slice(0, 71)}…` : title, id: "remote", keys: "actions" };
  // The field opens by itself while the TV shows its keyboard; Escape puts it away until the next one.
  if (st.typing && !st.unpaired && st.conn === "up") v.input = { value: "", placeholder: "Text for the TV; Enter sends it", submit: "type:send", cancel: "type:cancel" };
  return withControls(v);
}
