// The two trees this extension draws, pure so the tests render them from
// made-up state: the level one control of one screen opens (a slider
// with its keys), and the bar popover (a card per screen with its mode
// line and a brightness slider, a cursor the arrows move). Both lay out
// for the popover's 420 px when `compact`; in the panel the slider takes
// the free space.
import { POPOVER_W, column, keyHint, row, text, type Action, type View, type ViewNode } from "@zcag/pal";
import { modeText, type Screen } from "./model.ts";
import type { Control } from "./tools.ts";

export const GLYPH = {
  laptop: "\u{f0322}", // md-laptop
  monitor: "\u{f0379}", // md-monitor
  monitors: "\u{f037a}", // md-monitor_multiple
  dim: "\u{f00de}", // md-brightness_5
  mid: "\u{f00df}", // md-brightness_6
  bright: "\u{f00e0}", // md-brightness_7
  contrast: "\u{f0195}", // md-contrast
  volume: "\u{f057e}", // md-volume_high
  input: "\u{f0841}", // md-video_input_hdmi
  modes: "\u{f0a24}", // md-aspect_ratio
  rotate: "\u{f0475}", // md-screen_rotation
  mirror: "\u{f11fd}", // md-mirror
  main: "\u{f0ddc}", // md-monitor_star
  night: "\u{f0594}", // md-weather_night
  sleep: "\u{f0d90}", // md-monitor_off
  save: "\u{f0193}", // md-content_save
  preset: "\u{f0a07}", // md-monitor_dashboard
  undo: "\u{f054c}", // md-undo
  tools: "\u{f1064}", // md-tools
};
export const CONTROL_TITLE: Record<Control, string> = { brightness: "Brightness", contrast: "Contrast", volume: "Volume" };
const CONTROL_GLYPH: Record<Control, string> = { brightness: GLYPH.mid, contrast: GLYPH.contrast, volume: GLYPH.volume };

/** The brightness glyph for a level: three steps of the same sun. */
export const brightnessGlyph = (level: number | undefined): string => (level === undefined ? GLYPH.mid : level < 34 ? GLYPH.dim : level < 67 ? GLYPH.mid : GLYPH.bright);
export const screenGlyph = (s: Pick<Screen, "builtin">): string => (s.builtin ? GLYPH.laptop : GLYPH.monitor);

/** `1800×1169 @ 120 Hz · HiDPI · rotated 90°`: the mode line under a screen's name, or what is known without a tool. */
export function modeLine(s: Screen): string {
  const parts: string[] = [];
  if (s.w && s.h) parts.push(modeText(s));
  if (s.rotation) parts.push(`rotated ${s.rotation}°`);
  if (s.connection && s.connection !== "internal") parts.push(s.connection.toUpperCase().replace("DISPLAYPORT", "DisplayPort").replace("THUNDERBOLT", "Thunderbolt"));
  return parts.join(" · ") || (s.builtin ? "Built-in" : "External");
}

/** The popover's card width inside the outer padding, and what the name has left beside the glyph and the tags. */
const PAD = 8, GLYPH_W = 24, LEVEL_W = 40, SLIDER_W = 150;
const CARD_W = POPOVER_W - 2 * PAD;
/** Room for two badges (`main`, `mirror`) after the name. */
const NAME_W = CARD_W - GLYPH_W - 116;

export type SliderState = { screen: Screen; control: Control; value: number | undefined; step: number; compact?: boolean; /** Why the value could not be read, when it could not. */ reason?: string };

/** The digits set a level: `1`..`9` are 10..90 %, `0` is 100 %. */
export const digitLevel = (d: number): number => (d === 0 ? 100 : d * 10);

export function sliderActions(st: SliderState): Action[] {
  const settable = st.value !== undefined;
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d): Action => ({ id: `preset:${digitLevel(d)}`, title: `Set ${digitLevel(d)}%`, shortcut: String(d), hidden: true }));
  return settable ? [
    { id: "up", title: `Up ${st.step}%`, shortcut: ["right", "+", "="] },
    { id: "down", title: `Down ${st.step}%`, shortcut: ["left", "-"] },
    { id: "fine-up", title: "Up 1%", shortcut: ["shift+right", "."] },
    { id: "fine-down", title: "Down 1%", shortcut: ["shift+left", ","] },
    { id: "max", title: "Full", shortcut: "m" },
    { id: "set", title: `Set ${CONTROL_TITLE[st.control].toLowerCase()}`, hidden: true },
    ...digits,
  ] : [{ id: "retry", title: "Read again", shortcut: "r" }];
}

/** One control of one screen: the screen on a card, the slider with its number, the keys as hints. */
export function sliderView(st: SliderState): View {
  const s = st.screen;
  const v = st.value;
  // The card's padding is 3 steps here, so the name gets what the popover's card leaves less that difference.
  const nameW = st.compact ? NAME_W + 44 : undefined;
  const head = row([
    text(screenGlyph(s), { key: "g", style: "glyph", size: "lg", width: GLYPH_W }),
    column([
      text(s.name, { key: "n", style: "title", size: "sm", ...(nameW && { width: nameW }) }),
      text(modeLine(s), { key: "m", style: "muted", size: "xs", ...(nameW && { width: nameW }) }),
    ], { key: "name", gap: 0, grow: true }),
    ...(s.main ? [{ type: "badge", key: "main", text: "main", color: "blue" } as ViewNode] : []),
  ], { key: "head", gap: 1, align: "center", minHeight: 30 });
  const level: ViewNode = v === undefined
    ? row([text(CONTROL_GLYPH[st.control], { key: "cg", style: "glyph", size: "md", color: "muted", width: GLYPH_W }), text(st.reason ?? `${CONTROL_TITLE[st.control]} could not be read`, { key: "why", style: "muted", size: "sm" })], { key: "level", gap: 1, align: "center", minHeight: 26 })
    : row([
        text(st.control === "brightness" ? brightnessGlyph(v) : CONTROL_GLYPH[st.control], { key: "cg", style: "glyph", size: "md", width: GLYPH_W }),
        { type: "slider", key: "slider", value: v / 100, ...(st.compact && { width: SLIDER_W + 120 }), color: st.control === "brightness" ? "amber" : st.control === "volume" ? "green" : "violet", action: "set", label: `${s.name} ${CONTROL_TITLE[st.control].toLowerCase()}` },
        text(`${v}%`, { key: `v-${v}`, style: "number", size: "md", width: LEVEL_W + 8, align: "end", transition: { enter: "fade", exit: "none" } }),
      ], { key: "level", gap: 2, align: "center", minHeight: 30 });
  const hints = v === undefined
    ? row([...keyHint("r", "read again"), { type: "spacer" }, ...keyHint("esc", "back")], { key: "hints", gap: 1, minHeight: 22 })
    : row([...keyHint(["left", "right"], `${st.step}%`), ...keyHint(["shift+left", "shift+right"], "1%"), ...keyHint("1…0", "preset"), ...keyHint("m", "full"), { type: "spacer" }, ...keyHint("esc", "back")], { key: "hints", gap: 1, minHeight: 22 });
  const tree = column([column([head, level], { key: "card", gap: 2, padding: 3, surface: "elevated", radius: true }), hints], { key: "slider-view", padding: 3, gap: 2 });
  return { tree, actions: sliderActions(st), title: `${CONTROL_TITLE[st.control]}: ${s.name}`, id: `${st.control}:${s.id}`, keys: "actions" };
}

export type PopoverScreen = { screen: Screen; level: number | undefined; settable: boolean };
export type PopoverState = { screens: PopoverScreen[]; focus: number; step: number; night?: boolean; /** What to install for the screens that cannot be set, when any cannot. */ hint?: string };

function screenCard(p: PopoverScreen, selected: boolean, i: number): ViewNode {
  const s = p.screen;
  const tags: ViewNode[] = [];
  if (s.main) tags.push({ type: "badge", key: "main", text: "main", color: "blue" });
  if (s.mirrorOf) tags.push({ type: "badge", key: "mirror", text: "mirror", color: "violet" });
  const kids: ViewNode[] = [
    row([
      text(screenGlyph(s), { key: "g", style: "glyph", size: "lg", width: GLYPH_W }),
      column([
        text(s.name, { key: "n", style: "title", size: "sm", weight: selected ? "semibold" : "medium", width: NAME_W }),
        text(modeLine(s), { key: "m", style: "muted", size: "xs", width: NAME_W }),
      ], { key: "name", gap: 0, grow: true }),
      ...tags,
    ], { key: "head", gap: 1, align: "center", minHeight: 30 }),
  ];
  if (p.settable && p.level !== undefined) {
    kids.push(row([
      text(brightnessGlyph(p.level), { key: "bg", style: "glyph", size: "sm", color: "muted", width: GLYPH_W }),
      { type: "slider", key: "level", value: p.level / 100, width: CARD_W - GLYPH_W - LEVEL_W - 2 * PAD - 8, color: "amber", action: `set:${s.id}`, label: `${s.name} brightness` },
      text(`${p.level}%`, { key: `v-${p.level}`, style: "mono", size: "xs", color: "muted", width: LEVEL_W, align: "end", transition: { enter: "fade", exit: "none" } }),
    ], { key: "level", gap: 1, align: "center", minHeight: 24 }));
  } else {
    kids.push(row([text(p.settable ? "Brightness could not be read" : s.builtin ? "Set with the keyboard's keys" : "No tool can set its brightness", { key: "na", style: "muted", size: "xs" })], { key: "level", gap: 1, minHeight: 18 }));
  }
  return column(kids, { key: `screen-${s.id}`, gap: 1, padding: 2, surface: selected ? "elevated" : undefined, radius: true, action: `focus:${s.id}`, ...(selected && { selected: true }), transition: { enter: "fade", delay: Math.min(8, i) } });
}

export function popoverActions(st: PopoverState): Action[] {
  const cur = st.screens[st.focus];
  const canSet = !!cur?.settable && cur.level !== undefined;
  return [
    ...(cur ? [{ id: "open", title: `Open ${cur.screen.name} in pal` } as Action] : []),
    ...(canSet ? [
      { id: "up", title: "Brighter", shortcut: ["right", "+", "="] } as Action,
      { id: "down", title: "Dimmer", shortcut: ["left", "-"] } as Action,
      { id: "fine-up", title: "Brighter by 1%", shortcut: ["shift+right", "."], hidden: true } as Action,
      { id: "fine-down", title: "Dimmer by 1%", shortcut: ["shift+left", ","], hidden: true } as Action,
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d): Action => ({ id: `preset:${digitLevel(d)}`, title: `Set ${digitLevel(d)}%`, shortcut: String(d), hidden: true })),
    ] : []),
    ...(st.night !== undefined ? [{ id: "night", title: st.night ? "Night Shift off" : "Night Shift on", shortcut: "n" } as Action] : []),
    { id: "open-pal", title: "Open Displays in pal", shortcut: "p" },
    { id: "next", title: "Next display", shortcut: ["down", "j"], hidden: true },
    { id: "prev", title: "Previous display", shortcut: ["up", "k"], hidden: true },
    // The sliders' clicks (the fraction rides in `ctx.values.value`) and the cards': no key, so they stay out of ⌘K.
    ...st.screens.flatMap((p): Action[] => [{ id: `focus:${p.screen.id}`, title: `Go to ${p.screen.name}`, hidden: true }, ...(p.settable ? [{ id: `set:${p.screen.id}`, title: `Set ${p.screen.name} brightness`, hidden: true } as Action] : [])]),
  ];
}

/** The popover: a card per screen, the cursor's on an elevated surface, then the key hints. */
export function popover(st: PopoverState): View {
  const cur = st.screens[st.focus];
  const canSet = !!cur?.settable && cur.level !== undefined;
  const kids: ViewNode[] = st.screens.map((p, i) => screenCard(p, i === st.focus, i));
  if (st.hint) kids.push(row([text(GLYPH.tools, { key: "tg", style: "glyph", size: "sm", color: "muted", width: GLYPH_W }), text(st.hint, { key: "hint", style: "muted", size: "xs", width: CARD_W - GLYPH_W - PAD })], { key: "hint-row", gap: 1, align: "center", minHeight: 20 }));
  kids.push(row([
    ...(st.screens.length > 1 ? keyHint(["up", "down"], "display") : []),
    ...(canSet ? [...keyHint(["left", "right"], `${st.step}%`), ...keyHint("1…0", "preset")] : []),
    ...(st.night !== undefined ? keyHint("n", "night shift") : []),
    { type: "spacer" },
    ...keyHint("enter", "open"),
    ...keyHint("p", "pal"),
  ], { key: "hints", gap: 1, minHeight: 22 }));
  const tree = column(kids, { key: "compact", padding: 3, gap: 2 });
  const externals = st.screens.filter((p) => !p.screen.builtin).length;
  const title = st.screens.length === 0 ? "No displays" : externals ? `${st.screens.length} displays` : cur?.screen.name ?? "Display";
  return { tree, actions: popoverActions(st), title, id: "brightness", keys: "actions" };
}
