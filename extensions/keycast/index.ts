// Keycast: keystrokes and clicks drawn over the screen for a recording or
// a screen share. The watching and the drawing are the shell's
// (`core/keycast.*`, app keycast.rs over the shared key monitor and its
// overlay window); this extension is the way in: a live palette with
// Start / Stop, the three modes, the shortcuts-only flip and the Input
// Monitoring row, `pal://keycast/{toggle,start,stop}` for a keybind, and
// a red dot on the bar while it runs whose popover (view.ts) switches the
// mode and stops it. The shell publishes `keycast/active` and
// `keycast/mode`, so the item re-renders on `state:keycast/active`.
import { core, failed, hint, permissions, settings, type Action, type BarItem, type Effect, type Extension, type Item, type LinkParams } from "@zcag/pal";
import { MODES, modeShort, modeWord, positionWord, render, type Mode, type Status } from "./view.ts";

export { MODES, modeShort, modeWord, positionWord, render, type Mode, type Status };

const EXTENSION = "keycast", ITEM = "active", PALETTE = "keycast";
/** nf-md-record: the red dot on the bar. nf-md-keyboard, nf-md-cursor_default_outline, nf-md-keyboard_variant for the rows, nf-md-keyboard_outline for the shortcuts row; nf-md-shield_key for the permission row. */
const REC = "\u{f044a}";
const KEYS = "\u{f030c}";
const CURSOR = "\u{f01bf}";
const BOTH = "\u{f0313}";
const SHIELD = "\u{f0bc4}";
const TOGGLE = "toggle", SHORTCUTS = "shortcuts", PERMISSION = "permission", SETTINGS = "settings";

const status = () => core.call<Status>("keycast.status");
const start = (mode?: Mode) => core.call<Status>("keycast.start", mode ? { mode } : {});
const stop = () => core.call<Status>("keycast.stop");
const toggle = (mode?: Mode) => core.call<Status>("keycast.toggle", mode ? { mode } : {});

/** The HUD's line for a status just changed. */
export const hudLine = (st: Status): string => (st.active ? `Keycast on: ${modeWord(st.mode)}` : "Keycast off");

const parseMode = (v: unknown): Mode | undefined => (typeof v === "string" && (MODES as string[]).includes(v.trim()) ? (v.trim() as Mode) : undefined);

/** What every row offers besides its own: the shortcuts-only flip and the settings. */
const common = (st: Status): Action[] => [
  { id: SHORTCUTS, title: st.settings.shortcuts_only ? "Show every key" : "Shortcuts only", shortcut: "cmd+shift+s" },
  { id: SETTINGS, title: "Open settings", shortcut: "cmd+," },
];

/** Start / Stop, the row the palette leads with and the root's Now section shows while on. */
function toggleRow(st: Status): Item {
  const on = st.active;
  const subtitle = on ? `Showing ${modeWord(st.mode)} · strip at the ${positionWord(st.settings.position)}` : `${modeWord(st.settings.mode)[0].toUpperCase()}${modeWord(st.settings.mode).slice(1)}, strip at the ${positionWord(st.settings.position)}`;
  return {
    id: TOGGLE,
    name: on ? "Stop keycast" : "Start keycast",
    subtitle,
    icon: on ? { glyph: REC, color: "red" } : KEYS,
    keywords: ["keycast", "record", "screencast", on ? "stop" : "start"],
    accessories: on ? [{ tag: "on", color: "red" }] : [],
    actions: [on ? { id: "stop", title: "Stop", style: "destructive" } : { id: "start", title: "Start" }, ...common(st)],
  };
}

function modeRow(m: Mode, st: Status): Item {
  const on = st.active && st.mode === m;
  const sub: Record<Mode, string> = { keys: "The recent keys as caps, modifiers as glyphs, a repeat as ×3", cursor: "A ring around the cursor and a ripple on every click", both: "The key strip and the cursor ring together" };
  const first: Action = on ? { id: "stop", title: "Stop", style: "destructive" } : { id: "start", title: st.active ? "Switch to it" : "Start" };
  return {
    id: `mode:${m}`,
    name: m === "both" ? "Keys and cursor" : m === "keys" ? "Keys only" : "Cursor only",
    subtitle: sub[m],
    icon: m === "keys" ? KEYS : m === "cursor" ? CURSOR : BOTH,
    keywords: ["keycast", "mode", m, ...(m === "both" ? ["keys", "cursor"] : [])],
    accessories: on ? [{ tag: "current", color: "red" }] : m === st.settings.mode ? [{ tag: "default", color: "muted" }] : [],
    actions: [first, ...(st.active && !on ? [{ id: "stop", title: "Stop", shortcut: "cmd+enter", style: "destructive" } as Action] : []), ...common(st)],
  };
}

const shortcutsRow = (st: Status): Item => ({
  id: SHORTCUTS,
  name: `Shortcuts only: ${st.settings.shortcuts_only ? "on" : "off"}`,
  subtitle: st.settings.shortcuts_only ? "Plain typing stays off the screen; cmd, ctrl, alt, function and navigation keys show" : "Every key shows; turn it on when what you type should stay private",
  icon: "\u{f097b}",
  keywords: ["keycast", "shortcuts", "typing", "private"],
  accessories: [{ tag: st.settings.shortcuts_only ? "on" : "off", color: st.settings.shortcuts_only ? "green" : "muted" }],
  actions: [{ id: SHORTCUTS, title: st.settings.shortcuts_only ? "Show every key" : "Show shortcuts only", shortcut: "cmd+shift+s" }, { id: SETTINGS, title: "Open settings", shortcut: "cmd+," }],
});

/** Without the grant nothing typed reaches pal: the row says so and Enter asks (the prompt, or the pane once it was answered no). */
const permissionRow = (): Item => hint(PERMISSION, "Keycast needs Input Monitoring", "Keys typed in other apps reach pal only with it; Enter shows the system prompt, or the pane once it was refused", { icon: { glyph: SHIELD, color: "amber" }, actions: [{ id: "grant", title: "Grant Input Monitoring" }] });

async function list(): Promise<Item[]> {
  const st = await status();
  if (!st.available) return [hint("unavailable", "Keycast is not available here", st.reason ?? "No input tap on this platform")];
  const rows: Item[] = [];
  if (!st.input_monitoring) rows.push(permissionRow());
  rows.push(toggleRow(st), ...MODES.map((m) => modeRow(m, st)), shortcutsRow(st));
  return rows;
}

async function pick(id: string, action?: string): Promise<Effect> {
  if (id === "hint:unavailable") return { keep: true };
  if (action === SETTINGS) return { open: `pal://settings/extensions?anchor=extensions:${EXTENSION}` };
  if (id === "hint:permission" || action === "grant") {
    try { await permissions.request("input_monitoring"); } catch (e) { return failed("ask for Input Monitoring", e); }
    return { keep: true };
  }
  if (id === SHORTCUTS || action === SHORTCUTS) {
    await settings.set("shortcuts_only", !settings.get<{ shortcuts_only: boolean }>().shortcuts_only);
    return { keep: true };
  }
  try {
    if (action === "stop") return { hud: hudLine(await stop()) };
    if (id === TOGGLE) return { hud: hudLine(await toggle()) };
    if (id.startsWith("mode:")) return { hud: hudLine(await start(parseMode(id.slice(5)))) };
  } catch (e) {
    return failed(action === "stop" ? "stop keycast" : "start keycast", e);
  }
  return { keep: true };
}

// ---- the bar item -----------------------------------------------------------------

async function renderBar(): Promise<BarItem> {
  const st = await status();
  const menu = { view: render(st) };
  if (!st.active) return { hidden: true, empty: { icon: REC, tooltip: st.available ? "Keycast is off" : st.reason, menu } };
  return { icon: REC, title: modeShort(st.mode), tooltip: `Keycast: ${modeWord(st.mode)}${st.settings.shortcuts_only ? " · shortcuts only" : ""}`, menu };
}

/** A key or a click in the popover: the shell is asked, the item re-rendered (`keep`) with the new tree; Stop hides the popover with the HUD's line. */
async function popoverAction(action: string): Promise<Effect> {
  if (action === "open") return { push: { extension: EXTENSION, palette: PALETTE } };
  if (action === SHORTCUTS) {
    await settings.set("shortcuts_only", !settings.get<{ shortcuts_only: boolean }>().shortcuts_only);
    return { keep: true };
  }
  try {
    if (action === TOGGLE) {
      const st = await toggle();
      return st.active ? { keep: true } : { hud: hudLine(st) };
    }
    const m = action.startsWith("mode:") ? parseMode(action.slice(5)) : undefined;
    if (m) { await start(m); return { keep: true }; }
  } catch (e) {
    return failed("switch keycast", e);
  }
  return { keep: true };
}

export default {
  // `pal://keycast/toggle?mode=keys`, `start`, `stop`: the HUD says what happened.
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    const mode = parseMode(params.mode);
    if (params.mode !== undefined && !mode) throw new Error(`unknown mode "${String(params.mode)}": keys, cursor or both`);
    if (route === "toggle") return { hud: hudLine(await toggle(mode)) };
    if (route === "start") return { hud: hudLine(await start(mode)) };
    if (route === "stop") return { hud: hudLine(await stop()) };
  },
  palettes: {
    [PALETTE]: {
      title: "Keycast",
      live: true,
      placeholder: "Start, stop, or pick what to show",
      list,
      pick,
      // The empty root's Now section: the Stop row while the overlay is on.
      suggest: async () => status().then((st) => (st.active ? [toggleRow(st)] : [])),
    },
  },
  bar: {
    [ITEM]: { render: renderBar, onAction: popoverAction },
  },
} satisfies Extension;
