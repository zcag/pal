// Window layouts over the core's windows capability. `window-management`
// is one static row per layout; Enter answers a `layout` effect, so the
// panel hides first and the window that had focus (the one you were in,
// not pal) is the one moved, then the HUD names the layout. `Apply to...`
// drills into `arrange`, which lists the open windows (`windows.list`) and
// applies the chosen layout to the one picked; opened from the root,
// `arrange` goes the other way round: pick a window, then its layout, the
// same rows with the window's title as subtitle.
import type { Action, Extension, Item } from "../../host/src/protocol.ts";
import { settings, windows, type Window, type WindowLayout, type WindowLayoutOptions } from "../../host/src/api.ts";

/** `[extensions.window-management]`, defaults in pal.json. */
type Settings = WindowLayoutOptions;

const EXT = "window-management";

/** One per `pal_core::windows::layout::Layout`, in its order; the glyph suggests the shape. */
export const LAYOUTS: { id: WindowLayout; title: string; icon: string; keywords: string[] }[] = [
  { id: "left_half", title: "Left Half", icon: "◧", keywords: ["half", "left", "split"] },
  { id: "right_half", title: "Right Half", icon: "◨", keywords: ["half", "right", "split"] },
  { id: "top_half", title: "Top Half", icon: "⬒", keywords: ["half", "top", "up"] },
  { id: "bottom_half", title: "Bottom Half", icon: "⬓", keywords: ["half", "bottom", "down"] },
  { id: "left_third", title: "Left Third", icon: "◂⅓", keywords: ["third", "left", "first"] },
  { id: "center_third", title: "Center Third", icon: "⅓", keywords: ["third", "center", "middle"] },
  { id: "right_third", title: "Right Third", icon: "⅓▸", keywords: ["third", "right", "last"] },
  { id: "left_two_thirds", title: "Left Two Thirds", icon: "◂⅔", keywords: ["thirds", "left", "first"] },
  { id: "right_two_thirds", title: "Right Two Thirds", icon: "⅔▸", keywords: ["thirds", "right", "last"] },
  { id: "top_left_quarter", title: "Top Left Quarter", icon: "◰", keywords: ["quarter", "corner", "top", "left"] },
  { id: "top_right_quarter", title: "Top Right Quarter", icon: "◳", keywords: ["quarter", "corner", "top", "right"] },
  { id: "bottom_left_quarter", title: "Bottom Left Quarter", icon: "◱", keywords: ["quarter", "corner", "bottom", "left"] },
  { id: "bottom_right_quarter", title: "Bottom Right Quarter", icon: "◲", keywords: ["quarter", "corner", "bottom", "right"] },
  { id: "maximize", title: "Maximize", icon: "⛶", keywords: ["full", "fill", "big", "zoom"] },
  { id: "almost_maximize", title: "Almost Maximize", icon: "▣", keywords: ["full", "fill", "big", "large"] },
  { id: "center", title: "Center", icon: "⊡", keywords: ["centre", "middle"] },
  { id: "reasonable_size", title: "Reasonable Size", icon: "▢", keywords: ["small", "medium", "shrink"] },
  { id: "next_display", title: "Next Display", icon: "⇨", keywords: ["screen", "monitor", "move", "other"] },
  { id: "previous_display", title: "Previous Display", icon: "⇦", keywords: ["screen", "monitor", "move", "other"] },
  { id: "restore", title: "Restore", icon: "↺", keywords: ["undo", "back", "previous", "original"] },
];

const APPLY: Action = { id: "apply", title: "Apply" };
/** The second action, so ⌘Enter by the UI's grammar. */
const APPLY_TO: Action = { id: "apply-to", title: "Apply to…" };

/** What a level was opened with: `window-management` with a window, `arrange` with a layout. */
type Args = { id?: string; title?: string; layout?: WindowLayout };

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (query: string, ...fields: (string | string[] | undefined)[]) => {
  const hay = fields.flat().filter(Boolean).join(" ").toLowerCase();
  return words(query).every((w) => hay.includes(w));
};

/** The `layout` effect: the layout, the window (the focused one when absent), and the settings' knobs. */
const effect = (name: WindowLayout, id?: string) => ({ layout: { name, id, ...settings.get<Settings>(EXT) } });

function row(l: (typeof LAYOUTS)[number], target?: Args): Item {
  return {
    id: l.id,
    name: l.title,
    subtitle: target?.title ?? "Focused window",
    icon: l.icon,
    keywords: l.keywords,
    actions: target ? [APPLY] : [APPLY, APPLY_TO],
  };
}

function windowRow(w: Window): Item {
  return {
    id: w.id,
    name: w.title,
    subtitle: w.app,
    keywords: [w.bundle_or_class],
    icon: w.icon ? { app: w.icon } : "▢",
    accessories: w.monitor ? [{ text: w.monitor }] : [],
    actions: [{ id: "apply", title: "Arrange" }],
  };
}

export default {
  palettes: {
    "window-management": {
      title: "Window Management",
      icon: "◧",
      placeholder: "Left half, maximize, center...",
      // Indexed at the root; a level opened with a window (from `arrange`)
      // is listed here per keystroke, so the query is matched by hand.
      list: (query = "", ctx) => {
        const args = ctx?.args as Args | undefined;
        const target = args?.id ? args : undefined;
        return LAYOUTS.filter((l) => !target || matches(query, l.title, l.keywords)).map((l) => row(l, target));
      },
      pick: (id, action, ctx) => {
        const name = id as WindowLayout;
        if (!LAYOUTS.some((l) => l.id === name)) return;
        if (action === "apply-to") return { push: { extension: EXT, palette: "arrange", args: { layout: name } } };
        return effect(name, (ctx?.args as Args | undefined)?.id);
      },
    },
    arrange: {
      title: "Arrange Window",
      icon: "▢",
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
