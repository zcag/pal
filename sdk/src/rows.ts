// What a list palette and a view answer in the same shape everywhere: a
// hint row (inert, the icon says "information"), the failure toast, the
// view node builders and the keycap-plus-caption hint line.
import type { Action, Arg, Effect, Form, Icon, Item, ViewNode } from "./protocol.ts";

/** md-information_outline: the glyph of a hint row unless the extension says otherwise. */
export const HINT_GLYPH = "\u{f02fd}";

/**
 * An inert row that tells the user something (an empty list, a missing
 * tool, a setting to fill in): `id` is prefixed `hint:` unless it is
 * already, `actions` is empty unless given (Enter then does nothing).
 */
export const hint = (id: string, name: string, subtitle?: string, extra: { icon?: Icon; actions?: Action[]; section?: string } = {}): Item => ({
  id: id.startsWith("hint:") ? id : `hint:${id}`,
  name,
  subtitle,
  icon: extra.icon ?? HINT_GLYPH,
  ...(extra.section !== undefined && { section: extra.section }),
  actions: extra.actions ?? [],
});

/** A toast over the list, the panel kept open; `message` and `style` only when given (the UI's default is a success). */
export const toast = (title: string, message?: string, style?: "success" | "failure"): Effect => ({ keep: true, toast: { title, ...(message !== undefined && { message }), ...(style && { style }) } });

/** "Could not <what>" with the error's message, the panel kept open: what a pick answers when the OS or a service refused. */
export const failed = (what: string, e: unknown): Effect => toast(`Could not ${what}`, String((e as { message?: unknown })?.message ?? e), "failure");

/**
 * A row's typed arguments (`Item.args`) as the form to answer with when a
 * pick arrives without `ctx.values` (a bare `pal run`, an item hotkey, a
 * script): the same fields as a page, the submit addressed as the pick
 * was, so the values land in the same `pick` branch on the way back.
 */
export const argsForm = (args: Arg[], title: string, submit: { id: string; title: string }, errors?: Record<string, string>): Form => ({
  title,
  fields: args.map((a) => (a.kind === "select" ? { kind: "select", id: a.id, label: a.placeholder, options: a.options ?? [], required: a.required, default: a.default } : { kind: "text", id: a.id, label: a.placeholder, placeholder: a.placeholder, required: a.required, default: a.default })),
  submit,
  ...(errors && { errors }),
});

/** A bar popover's content width: the popover is 420 wide, less the view's padding (3 steps a side). Fixed widths in a popover view are measured against it. */
export const POPOVER_W = 396;

type Text = Extract<ViewNode, { type: "text" }>;
type Stack = Extract<ViewNode, { type: "stack" }>;

/** A text node; `extra` is any of its style, weight, size, color, width, key. */
export const text = (value: string, extra: Partial<Text> = {}): ViewNode => ({ type: "text", value, ...extra });
/** A horizontal stack, centred, two steps of gap unless `extra` says otherwise. */
export const row = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
/** A vertical stack, two steps of gap unless `extra` says otherwise. */
export const column = (children: ViewNode[], extra: Partial<Stack> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 2, ...extra, children });
/** A keycap; with `action`, a click on it runs that view action. */
export const keycap = (keys: string, action?: string): ViewNode => ({ type: "keycap", keys, ...(action && { action }) });
/** Keycaps then a muted caption (`⏎ Open`), the line a view's footer hints are made of; `size` is the caption's. */
export const keyHint = (keys: string | string[], what: string, o: { action?: string; size?: Text["size"] } = {}): ViewNode[] => [
  ...(Array.isArray(keys) ? keys : [keys]).map((k) => keycap(k, o.action)),
  text(what, { style: "muted", size: o.size ?? "xs" }),
];
