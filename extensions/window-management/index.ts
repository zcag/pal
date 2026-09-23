// Window layouts over the core's windows capability. `window-management`
// is one static row per layout (halves, thirds, quarters, the maximize
// family, larger / smaller, the moves by `step`, the displays, fullscreen,
// minimize / unminimize, restore); Enter answers a `layout` effect, so the
// panel hides first and the window that had focus (the one you were in,
// not pal) is the one moved, then the HUD names the layout. `Apply to...`
// drills into `arrange`, which lists the open windows (`windows.list`) and
// applies the chosen layout to the one picked; opened from the root,
// `arrange` goes the other way round: pick a window, then its layout, the
// same rows with the window's title as subtitle. "Resize to..." is the one
// row that is not a core layout: the search bar takes a size (and a
// place) as the row's arguments (a form with the same fields for a pick
// that arrives without them), and the frame is written from here
// (`windows.frame` / `set_frame`, kept inside the window's display); pal's
// panel never activates, so the focused window read on submit is still
// the one you were in.
import { argsForm, settings, windows, xdg, type Action, type Arg, type Display, type Effect, type Extension, type Form, type FormValues, type Item, type LinkParams, type Rect, type Window, type WindowLayout, type WindowLayoutOptions } from "@zcag/pal";
import { layoutIcon } from "./icons.ts";

/** `[extensions.window-management]`, defaults in pal.json. */
/** The layouts' knobs, and the keep-below-bar watcher's two, which the app reads itself (reserve.rs). */
type Settings = WindowLayoutOptions;

/** A row of the palette: a core layout, or the resize form. */
export type RowId = WindowLayout | typeof RESIZE;

const EXT = "window-management";
const RESIZE = "resize";
/** The picker row's glyph when the window has no artwork (md-window_maximize). */
const WINDOW_GLYPH = xdg("window-new")!;

/** One per `pal_core::windows::layout::Layout`, in its order, plus the resize form after Smaller; the icon is its diagram (icons.ts). */
export const LAYOUTS: { id: RowId; title: string; keywords: string[] }[] = [
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
  { id: RESIZE, title: "Resize to…", keywords: ["size", "pixels", "width", "height", "exact", "1280x720", "1920x1080"] },
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
type Args = { id?: string; title?: string; layout?: RowId };

const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (query: string, ...fields: (string | string[] | undefined)[]) => {
  const hay = fields.flat().filter(Boolean).join(" ").toLowerCase();
  return words(query).every((w) => hay.includes(w));
};

/** The `layout` effect: the layout, the window (the focused one when absent), and the settings' knobs. */
const effect = (name: WindowLayout, id?: string): Effect => {
  const knobs = settings.get<Settings>(EXT);
  return { layout: { name, id, ...knobs } };
};

/** Picks its own window (the last one minimised): no Apply to…, and not offered for a picked window. */
const noTarget = (id: RowId) => id === "unminimize";

// ---- Resize to... -----------------------------------------------------------

/** Common sizes, the size field's hint. */
const PRESETS = "1280x720, 1440x900, 1920x1080";
/** The Resize row's arguments: the size, then where to put it (blank keeps the window centred where it is). */
const RESIZE_ARGS: Arg[] = [
  { id: "size", placeholder: "1280x720", required: true },
  { id: "x", placeholder: "X (blank: centred)" },
  { id: "y", placeholder: "Y (blank: centred)" },
];
const RESIZE_SUBMIT = { id: "resize-submit", title: "Resize" };
const SIZE_RE = /^(\d{2,5})(?:(?:\s*[x×*,]\s*|\s+)(\d{2,5}))?$/i;

/** `1280x720`, `1280 720`, `1280×720`, `1280*720`, `1280` (a square): width and height in px, or nothing. */
export function parseSize(s: string): { w: number; h: number } | undefined {
  const m = s.trim().match(SIZE_RE);
  if (!m) return;
  const w = Number(m[1]), h = m[2] ? Number(m[2]) : w;
  return w > 0 && h > 0 ? { w, h } : undefined;
}

/** A blank field keeps the axis; a number is px. Nothing for anything else. */
const parseCoord = (s: string): number | undefined | null => (s.trim() === "" ? undefined : /^-?\d{1,5}$/.test(s.trim()) ? Number(s.trim()) : null);

/** The display holding the window's centre, else the one it overlaps most, else the primary, else the first. */
export function displayOf(displays: Display[], w: Rect): Display | undefined {
  const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
  const inside = (d: Rect) => cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h;
  const overlap = (d: Rect) => Math.max(0, Math.min(w.x + w.w, d.x + d.w) - Math.max(w.x, d.x)) * Math.max(0, Math.min(w.y + w.h, d.y + d.h) - Math.max(w.y, d.y));
  return displays.find((d) => inside(d.frame)) ?? displays.filter((d) => overlap(d.frame) > 0).sort((a, b) => overlap(b.frame) - overlap(a.frame))[0] ?? displays.find((d) => d.primary) ?? displays[0];
}

/**
 * The frame a resize lands on: the size capped to the display's visible
 * frame, the window kept centred where it was (or put at `x`/`y` where
 * given), then pushed back inside the visible frame on each axis where
 * it fits. Whole pixels.
 */
export function resizeFrame(from: Rect, size: { w: number; h: number }, at: { x?: number; y?: number }, area?: Rect): Rect {
  const w = area ? Math.min(size.w, area.w) : size.w;
  const h = area ? Math.min(size.h, area.h) : size.h;
  let x = at.x ?? from.x + (from.w - w) / 2;
  let y = at.y ?? from.y + (from.h - h) / 2;
  if (area) {
    if (w <= area.w) x = Math.min(Math.max(x, area.x), area.x + area.w - w);
    if (h <= area.h) y = Math.min(Math.max(y, area.y), area.y + area.h - h);
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** The arguments as a page, for a pick without values and for a refused one (the messages under the fields); its id carries the picked window (`resize:<id>`), none for the focused one. */
const resizeForm = (target?: Args, errors?: Form["errors"]): Form => ({
  ...argsForm(RESIZE_ARGS, target?.title ? `Resize ${target.title}` : "Resize the focused window", RESIZE_SUBMIT, errors),
  id: target?.id ? `${RESIZE}:${target.id}` : RESIZE,
});

/** The values in: the size and place checked (the fields again with the messages otherwise), the frame written, the panel down and the HUD saying the size. */
async function resize(target: Args | undefined, values: FormValues | undefined): Promise<Effect> {
  if (!values) return { form: resizeForm(target) };
  const size = parseSize(String(values.size ?? ""));
  const x = parseCoord(String(values.x ?? "")), y = parseCoord(String(values.y ?? ""));
  const errors: Record<string, string> = {};
  if (!size) errors.size = `Width x height in px, like ${PRESETS.split(",")[0]}`;
  if (x === null) errors.x = "A whole number of px, or blank";
  if (y === null) errors.y = "A whole number of px, or blank";
  if (Object.keys(errors).length || !size) return { form: resizeForm(target, errors) };
  const id = target?.id ?? (await windows.focused())?.id;
  if (!id) return { form: resizeForm(target, { size: "No window has focus: open one first, or pick one with Apply to…" }) };
  const from = await windows.frame(id);
  const area = displayOf(await windows.displays(), from)?.visible_frame;
  const to = resizeFrame(from, size, { x: x ?? undefined, y: y ?? undefined }, area);
  await windows.setFrame(id, to);
  return { hide: true, hud: `Resized to ${to.w}x${to.h}` };
}

function row(l: (typeof LAYOUTS)[number], target?: Args): Item {
  return {
    id: l.id,
    name: l.title,
    subtitle: target?.title ?? (noTarget(l.id) ? "Last minimized window" : "Focused window"),
    icon: layoutIcon(l.id),
    keywords: l.keywords,
    // The size in the bar gates Apply; Apply to… picks the window first and the size comes in that level.
    ...(l.id === RESIZE && { args: RESIZE_ARGS }),
    actions: target || noTarget(l.id) ? [APPLY] : [APPLY, APPLY_TO],
  };
}

/** A window to arrange; opened for Resize, the row takes the size in the bar. */
function windowRow(w: Window, layout?: RowId): Item {
  return {
    id: w.id,
    name: w.title,
    subtitle: w.app,
    keywords: [w.bundle_or_class],
    icon: w.icon ? { app: w.icon } : WINDOW_GLYPH,
    accessories: w.monitor ? [{ text: w.monitor }] : [],
    ...(layout === RESIZE && { args: RESIZE_ARGS }),
    actions: [{ id: "apply", title: layout === RESIZE ? "Resize" : "Arrange" }],
  };
}

export default {
  // `pal://window-management/layout?name=left_half`: the focused window, as Enter on the row does.
  link: (route: string, params: LinkParams): Effect | void => {
    if (route !== "layout") return;
    const name = String(params.name);
    const layouts = LAYOUTS.filter((l) => l.id !== RESIZE).map((l) => l.id as WindowLayout);
    if (!layouts.includes(name as WindowLayout)) throw new Error(`no layout "${name}"; one of ${layouts.join(", ")}`);
    return effect(name as WindowLayout);
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
        const args = ctx?.args as Args | undefined;
        // The resize form's submit: the window is in the form's id.
        if (action === "resize-submit") {
          const wid = id.startsWith(`${RESIZE}:`) ? id.slice(RESIZE.length + 1) : undefined;
          return resize(wid ? { id: wid, title: args?.title } : undefined, ctx?.values ?? {});
        }
        const name = id as RowId;
        if (!LAYOUTS.some((l) => l.id === name)) return;
        if (action === "apply-to" && !noTarget(name)) return { push: { extension: EXT, palette: "arrange", args: { layout: name } } };
        // The bar's values, or (a hotkey, a bare `pal run`) the same fields as a form.
        if (name === RESIZE) return resize(args?.id ? args : undefined, ctx?.values);
        return effect(name, args?.id);
      },
    },
    arrange: {
      title: "Arrange Window",
      input: true,
      placeholder: "Which window?",
      list: async (query = "", ctx) => {
        const layout = (ctx?.args as Args | undefined)?.layout;
        return (await windows.list()).filter((w) => !w.minimized && matches(query, w.title, w.app, w.bundle_or_class)).map((w) => windowRow(w, layout));
      },
      pick: async (id, action, ctx) => {
        const layout = (ctx?.args as Args | undefined)?.layout;
        if (action === "resize-submit") return resize({ id: id.slice(RESIZE.length + 1) }, ctx?.values ?? {});
        const w = (await windows.list()).find((w) => w.id === id);
        if (layout === RESIZE) return resize({ id, title: w?.title ?? id }, ctx?.values);
        if (layout) return effect(layout, id);
        return { push: { extension: EXT, palette: "window-management", args: { id, title: w?.title ?? id } } };
      },
    },
  },
} satisfies Extension;
