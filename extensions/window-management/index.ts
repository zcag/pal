// Window layouts over the core's windows capability. `window-management`
// is one static row per layout (halves, thirds, quarters, the maximize
// family, larger / smaller, the moves by `step`, the displays, fullscreen,
// minimize / unminimize, restore); Enter answers a `layout` effect, so the
// panel hides first and the window that had focus (the one you were in,
// not pal) is the one moved, then the HUD names the layout. `Apply to...`
// drills into `arrange`, which lists the open windows (`windows.list`) and
// applies the chosen layout to the one picked; opened from the root,
// `arrange` goes the other way round: pick a window, then its layout, the
// same rows with the window's title as subtitle.
import { settings, windows, xdg, type Action, type Effect, type Extension, type Item, type LinkParams, type Window, type WindowLayout, type WindowLayoutOptions } from "@zcag/pal";
import { layoutIcon } from "./icons.ts";

/** `[extensions.window-management]`, defaults in pal.json. `step` (px per move) is not in the SDK's options type yet (protocol.ts). */
type Settings = WindowLayoutOptions & { step?: number };

/**
 * The core's `Layout` names: `WindowLayout` plus the verbs added after it
 * (larger / smaller, the moves, maximize height / width, fullscreen, the
 * minimise pair), which protocol.ts does not list yet; the effect casts.
 */
export type Verb = WindowLayout | "maximize_height" | "maximize_width" | "larger" | "smaller" | "move_left" | "move_right" | "move_up" | "move_down" | "fullscreen" | "minimize" | "unminimize";

const EXT = "window-management";
/** The picker row's glyph when the window has no artwork (md-window_maximize). */
const WINDOW_GLYPH = xdg("window-new")!;

/** One per `pal_core::windows::layout::Layout`, in its order; the icon is its diagram (icons.ts). */
export const LAYOUTS: { id: Verb; title: string; keywords: string[] }[] = [
  { id: "left_half", title: "Left Half", keywords: ["half", "left", "split"] },
  { id: "right_half", title: "Right Half", keywords: ["half", "right", "split"] },
  { id: "top_half", title: "Top Half", keywords: ["half", "top", "up"] },
  { id: "bottom_half", title: "Bottom Half", keywords: ["half", "bottom", "down"] },
  { id: "left_third", title: "Left Third", keywords: ["third", "left", "first"] },
  { id: "center_third", title: "Center Third", keywords: ["third", "center", "middle"] },
  { id: "right_third", title: "Right Third", keywords: ["third", "right", "last"] },
  { id: "left_two_thirds", title: "Left Two Thirds", keywords: ["thirds", "left", "first"] },
  { id: "right_two_thirds", title: "Right Two Thirds", keywords: ["thirds", "right", "last"] },
  { id: "top_left_quarter", title: "Top Left Quarter", keywords: ["quarter", "corner", "top", "left"] },
  { id: "top_right_quarter", title: "Top Right Quarter", keywords: ["quarter", "corner", "top", "right"] },
  { id: "bottom_left_quarter", title: "Bottom Left Quarter", keywords: ["quarter", "corner", "bottom", "left"] },
  { id: "bottom_right_quarter", title: "Bottom Right Quarter", keywords: ["quarter", "corner", "bottom", "right"] },
  { id: "maximize", title: "Maximize", keywords: ["full", "fill", "big", "zoom"] },
  { id: "almost_maximize", title: "Almost Maximize", keywords: ["full", "fill", "big", "large"] },
  { id: "maximize_height", title: "Maximize Height", keywords: ["tall", "vertical", "fill"] },
  { id: "maximize_width", title: "Maximize Width", keywords: ["wide", "horizontal", "fill"] },
  { id: "center", title: "Center", keywords: ["centre", "middle"] },
  { id: "reasonable_size", title: "Reasonable Size", keywords: ["small", "medium", "shrink"] },
  { id: "larger", title: "Larger", keywords: ["bigger", "grow", "resize", "enlarge"] },
  { id: "smaller", title: "Smaller", keywords: ["shrink", "resize", "reduce"] },
  { id: "move_left", title: "Move Left", keywords: ["nudge", "step", "left"] },
  { id: "move_right", title: "Move Right", keywords: ["nudge", "step", "right"] },
  { id: "move_up", title: "Move Up", keywords: ["nudge", "step", "up", "top"] },
  { id: "move_down", title: "Move Down", keywords: ["nudge", "step", "down", "bottom"] },
  { id: "next_display", title: "Next Display", keywords: ["screen", "monitor", "move", "other"] },
  { id: "previous_display", title: "Previous Display", keywords: ["screen", "monitor", "move", "other"] },
  { id: "fullscreen", title: "Toggle Fullscreen", keywords: ["full screen", "native", "space"] },
  { id: "minimize", title: "Minimize", keywords: ["dock", "hide", "away"] },
  { id: "unminimize", title: "Unminimize", keywords: ["dock", "restore", "back", "bring"] },
  { id: "restore", title: "Restore", keywords: ["undo", "back", "previous", "original"] },
];

const APPLY: Action = { id: "apply", title: "Apply" };
/** The second action, so ⌘Enter by the UI's grammar. */
const APPLY_TO: Action = { id: "apply-to", title: "Apply to…" };

/** What a level was opened with: `window-management` with a window, `arrange` with a layout. */
type Args = { id?: string; title?: string; layout?: Verb };

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (query: string, ...fields: (string | string[] | undefined)[]) => {
  const hay = fields.flat().filter(Boolean).join(" ").toLowerCase();
  return words(query).every((w) => hay.includes(w));
};

/** The `layout` effect: the layout, the window (the focused one when absent), and the settings' knobs. */
const effect = (name: Verb, id?: string): Effect => ({ layout: { name: name as WindowLayout, id, ...settings.get<Settings>(EXT) } });

/** Picks its own window (the last one minimised): no Apply to…, and not offered for a picked window. */
const noTarget = (id: Verb) => id === "unminimize";

function row(l: (typeof LAYOUTS)[number], target?: Args): Item {
  return {
    id: l.id,
    name: l.title,
    subtitle: target?.title ?? (noTarget(l.id) ? "Last minimized window" : "Focused window"),
    icon: layoutIcon(l.id),
    keywords: l.keywords,
    actions: target || noTarget(l.id) ? [APPLY] : [APPLY, APPLY_TO],
  };
}

function windowRow(w: Window): Item {
  return {
    id: w.id,
    name: w.title,
    subtitle: w.app,
    keywords: [w.bundle_or_class],
    icon: w.icon ? { app: w.icon } : WINDOW_GLYPH,
    accessories: w.monitor ? [{ text: w.monitor }] : [],
    actions: [{ id: "apply", title: "Arrange" }],
  };
}

export default {
  // `pal://window-management/layout?name=left_half`: the focused window, as Enter on the row does.
  link: (route: string, params: LinkParams): Effect | void => {
    if (route !== "layout") return;
    const name = String(params.name) as Verb;
    if (!LAYOUTS.some((l) => l.id === name)) throw new Error(`no layout "${name}"; one of ${LAYOUTS.map((l) => l.id).join(", ")}`);
    return effect(name);
  },
  palettes: {
    "window-management": {
      title: "Window Management",
      placeholder: "Left half, maximize, center...",
      // Indexed at the root; a level opened with a window (from `arrange`)
      // is listed here per keystroke, so the query is matched by hand.
      list: (query = "", ctx) => {
        const args = ctx?.args as Args | undefined;
        const target = args?.id ? args : undefined;
        return LAYOUTS.filter((l) => !target || (!noTarget(l.id) && matches(query, l.title, l.keywords))).map((l) => row(l, target));
      },
      pick: (id, action, ctx) => {
        const name = id as Verb;
        if (!LAYOUTS.some((l) => l.id === name)) return;
        if (action === "apply-to" && !noTarget(name)) return { push: { extension: EXT, palette: "arrange", args: { layout: name } } };
        return effect(name, (ctx?.args as Args | undefined)?.id);
      },
    },
    arrange: {
      title: "Arrange Window",
      input: true,
      placeholder: "Which window?",
      list: async (query = "") => (await windows.list()).filter((w) => !w.minimized && matches(query, w.title, w.app, w.bundle_or_class)).map(windowRow),
      pick: async (id, _action, ctx) => {
        const layout = (ctx?.args as Args | undefined)?.layout;
        if (layout) return effect(layout, id);
        const w = (await windows.list()).find((w) => w.id === id);
        return { push: { extension: EXT, palette: "window-management", args: { id, title: w?.title ?? id } } };
      },
    },
  },
} satisfies Extension;
