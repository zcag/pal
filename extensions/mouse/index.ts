// Mouse & Trackpad: the three-finger middle click and scroll reversal per
// device. The work is the shell's (app mouse.rs: an event tap and the
// fingers over MultitouchSupport, following `[extensions.mouse]`); this
// extension is the way in: one row per switch, Enter flips it, the
// Accessibility row while the grant is missing, and
// `pal://mouse/toggle?setting=<id>` for a keybind.
import { core, failed, hint, permissions, settings, type Effect, type Extension, type Item, type LinkParams } from "@zcag/pal";

const EXTENSION = "mouse", PALETTE = "mouse", PERMISSION = "permission", SETTINGS = "settings";

export type Settings = {
  middle_click: boolean;
  middle_click_tap: boolean;
  reverse_trackpad: boolean;
  reverse_mouse: boolean;
  reverse_vertical: boolean;
  reverse_horizontal: boolean;
};
export type Setting = keyof Settings;
/** `core/mouse.status` (mouse.rs). */
export type Status = { available: boolean; reason?: string; accessibility: boolean; running: boolean; devices: number; settings: Settings };

const status = () => core.call<Status>("mouse.status");

/** nf-md-mouse, nf-md-mouse_variant, nf-md-gesture_tap, nf-md-gesture_swipe_vertical, nf-md-swap_vertical, nf-md-swap_horizontal, nf-md-shield_key. */
const MOUSE = "\u{f037d}", WHEEL = "\u{f037f}", TAP = "\u{f0741}", TRACKPAD = "\u{f0ac0}", VERTICAL = "\u{f04e2}", HORIZONTAL = "\u{f04e1}", SHIELD = "\u{f0bc4}";

/** Each switch: its row's name, what on and off mean, its icon. */
export const SWITCHES: Record<Setting, { name: string; on: string; off: string; icon: string; keywords: string[] }> = {
  middle_click: { name: "Three-finger middle click", on: "A click with three fingers on the trackpad is a middle click", off: "A click with three fingers is a plain click", icon: MOUSE, keywords: ["middle", "click", "three", "finger"] },
  middle_click_tap: { name: "Three-finger tap", on: "Three fingers tapped together click the middle button (with Middle click on)", off: "Only a three-finger click is a middle click", icon: TAP, keywords: ["middle", "tap", "three", "finger"] },
  reverse_trackpad: { name: "Reverse trackpad scrolling", on: "The trackpad scrolls against System Settings' direction", off: "The trackpad scrolls as System Settings says", icon: TRACKPAD, keywords: ["reverse", "scroll", "trackpad", "natural"] },
  reverse_mouse: { name: "Reverse mouse scrolling", on: "The mouse scrolls against System Settings' direction", off: "The mouse scrolls as System Settings says", icon: WHEEL, keywords: ["reverse", "scroll", "mouse", "wheel", "natural"] },
  reverse_vertical: { name: "Reverse vertical", on: "Reversed devices flip up and down", off: "Up and down are left alone", icon: VERTICAL, keywords: ["reverse", "scroll", "vertical"] },
  reverse_horizontal: { name: "Reverse horizontal", on: "Reversed devices flip left and right", off: "Left and right are left alone", icon: HORIZONTAL, keywords: ["reverse", "scroll", "horizontal"] },
};
const IDS = Object.keys(SWITCHES) as Setting[];

/** The HUD's line for a switch just flipped. */
export const hudLine = (id: Setting, on: boolean): string => `${SWITCHES[id].name} ${on ? "on" : "off"}`;

/** A switch's row: its state as the tag, a note when it cannot act yet. */
export function row(id: Setting, st: Status): Item {
  const s = SWITCHES[id], on = st.settings[id];
  const idle = (id === "middle_click_tap" && !st.settings.middle_click) || ((id === "reverse_vertical" || id === "reverse_horizontal") && !st.settings.reverse_trackpad && !st.settings.reverse_mouse);
  const noTrackpad = on && id.startsWith("middle_click") && st.running && st.devices === 0;
  return {
    id,
    name: s.name,
    subtitle: noTrackpad ? `${s.on}; no trackpad is being read` : on ? s.on : s.off,
    icon: s.icon,
    keywords: ["mouse", "trackpad", ...s.keywords],
    accessories: [{ tag: on ? "on" : "off", color: on ? (idle ? "muted" : "green") : "muted" }],
    actions: [{ id: "flip", title: on ? "Turn off" : "Turn on" }, { id: SETTINGS, title: "Open settings", shortcut: "cmd+," }],
  };
}

const permissionRow = (): Item => hint(PERMISSION, "Mouse & Trackpad needs Accessibility", "Changing clicks and scrolls in other apps takes it; Enter shows the system prompt, or the pane once it was refused", { icon: { glyph: SHIELD, color: "amber" }, actions: [{ id: "grant", title: "Grant Accessibility" }] });

export async function list(): Promise<Item[]> {
  const st = await status();
  if (!st.available) return [hint("unavailable", "Mouse & Trackpad is not available here", st.reason ?? "No input tap on this platform")];
  return [...(st.accessibility ? [] : [permissionRow()]), ...IDS.map((id) => row(id, st))];
}

async function flip(id: Setting): Promise<boolean> {
  const on = !settings.get<Settings>()[id];
  await settings.set(id, on);
  return on;
}

async function pick(id: string, action?: string): Promise<Effect> {
  if (id === "hint:unavailable") return { keep: true };
  if (action === SETTINGS) return { open: `pal://settings/extensions?anchor=extensions:${EXTENSION}` };
  if (id === `hint:${PERMISSION}` || action === "grant") {
    try { await permissions.request("accessibility"); } catch (e) { return failed("ask for Accessibility", e); }
    return { keep: true };
  }
  if ((IDS as string[]).includes(id)) {
    await flip(id as Setting);
    return { keep: true };
  }
  return { keep: true };
}

export default {
  // `pal://mouse/toggle?setting=reverse_mouse`: the HUD says where it landed.
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route !== "toggle") return;
    const id = String(params.setting ?? "");
    if (!(IDS as string[]).includes(id)) throw new Error(`unknown setting "${id}": ${IDS.join(", ")}`);
    return { hud: hudLine(id as Setting, await flip(id as Setting)) };
  },
  palettes: {
    [PALETTE]: {
      title: "Mouse & Trackpad",
      live: true,
      placeholder: "Middle click and scroll direction",
      list,
      pick,
    },
  },
} satisfies Extension;
