/**
 * Marked rows (LaunchBar's staging, fzf's multi): a set of ids inside one
 * palette, kept while the query changes so rows can be gathered across
 * searches. Marking a row of another palette starts over, since a multi
 * pick is one `pick` to one palette. Pure; the Launcher owns the state.
 */
import type { Action, Item } from "./types";

export type Selection = { palette: string; ids: string[] };

/** The palette a row belongs to, for the one-palette rule; a fixture row's bare name stands in. */
const paletteOf = (item: Item) => item.palette ?? "";

export const isMarked = (sel: Selection | null, item: Item): boolean => !!sel && sel.palette === paletteOf(item) && sel.ids.includes(item.id);

/** The row marked, or unmarked when it was; an empty selection is `null`. */
export function toggle(sel: Selection | null, item: Item): Selection | null {
  if (isMarked(sel, item)) {
    const ids = sel!.ids.filter((id) => id !== item.id);
    return ids.length ? { palette: sel!.palette, ids } : null;
  }
  return mark(sel, item);
}

/** The row marked (a shifted arrow: never unmarks). */
export function mark(sel: Selection | null, item: Item): Selection {
  if (isMarked(sel, item)) return sel!;
  const palette = paletteOf(item);
  return sel && sel.palette === palette ? { palette, ids: [...sel.ids, item.id] } : { palette, ids: [item.id] };
}

/** A row that cannot be marked: a hint, a palette row, a fallback, a "more" row, a suggestion push. */
export const markable = (item: Item): boolean => !item.disabled && !item.muted && !item.push && item.actions?.length !== 0 && !!item.palette && !item.palette.startsWith("pal/");

/**
 * What the marked rows can do together: the row's actions that declare
 * `multi` (the cursor row's, or the palette's shared ones the row
 * carries), in their order. Empty when nothing on the row works on
 * several.
 */
export const multiActions = (actions: Action[] | undefined): Action[] => (actions ?? []).filter((a) => a.multi && !a.hidden);

/**
 * The ids a multi pick sends: the cursor row first when it is marked
 * (the pick is addressed to it), then the rest in marking order.
 */
export function pickIds(sel: Selection, cursor: Item | undefined): string[] {
  if (!cursor || !isMarked(sel, cursor)) return sel.ids;
  return [cursor.id, ...sel.ids.filter((id) => id !== cursor.id)];
}
