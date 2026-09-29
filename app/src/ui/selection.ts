/**
 * Marked rows (LaunchBar's staging, fzf's multi, Mail's shift and cmd
 * clicks): the marked rows of one palette, kept while the query changes so
 * rows can be gathered across searches. Marking a row of another palette
 * starts over, since a multi pick is one `pick` to one palette. The rows
 * themselves are kept, not only their ids, so what they can do together
 * still reads when a search has filtered them off screen. A view level's
 * marks are the same model over the tree's `mark` nodes (`viewMarks`).
 * Pure; the Launcher owns the state.
 */
import type { Action, Item, ViewNode } from "./types";

/** `items` in marking order; `anchor` is where a shift-click's or a shifted arrow's range starts (the row last clicked or toggled). */
export type Selection = { palette: string; items: Item[]; anchor?: string };

/** The palette a row belongs to, for the one-palette rule; a fixture row's bare name stands in. */
const paletteOf = (item: Item) => item.palette ?? "";

export const idsOf = (sel: Selection | null): string[] => (sel ? sel.items.map((i) => i.id) : []);

export const isMarked = (sel: Selection | null, item: Item): boolean => !!sel && sel.palette === paletteOf(item) && sel.items.some((i) => i.id === item.id);

/** The row marked, or unmarked when it was; an empty selection is `null`. Either way the row becomes the range's anchor. */
export function toggle(sel: Selection | null, item: Item): Selection | null {
  if (!sel || !isMarked(sel, item)) return mark(sel, item);
  const items = sel.items.filter((i) => i.id !== item.id);
  return items.length ? { palette: sel.palette, items, anchor: item.id } : null;
}

/** The row marked (never unmarked) and made the anchor. */
export function mark(sel: Selection | null, item: Item): Selection {
  const palette = paletteOf(item);
  if (!sel || sel.palette !== palette) return { palette, items: [item], anchor: item.id };
  return { palette, items: isMarked(sel, item) ? sel.items : [...sel.items, item], anchor: item.id };
}

/** Every markable row from the anchor (else `from`) to `to` in `rows` marked: a shift-click. The anchor stays where it was. */
export function markRange(sel: Selection | null, rows: Item[], from: number, to: number): Selection | null {
  const a = sel?.anchor !== undefined && sel.palette === paletteOf(rows[to] ?? rows[from]!) ? rows.findIndex((r) => r.id === sel.anchor) : -1;
  const start = a >= 0 ? a : from;
  const [lo, hi] = start <= to ? [start, to] : [to, start];
  let s = sel;
  for (let i = lo; i <= hi; i++) if (markable(rows[i]!)) s = mark(s, rows[i]!);
  return s ? { ...s, anchor: a >= 0 ? sel!.anchor : rows[start]?.id } : s;
}

/**
 * A shifted arrow from `from` to `to` in `rows`: Mail's range. Moving away
 * from the anchor marks both rows; moving back toward it unmarks the row
 * left, so an overshoot is undone by the opposite arrow. The first step
 * of a run anchors at `from`.
 */
export function step(sel: Selection | null, rows: Item[], from: number, to: number): Selection | null {
  const src = rows[from], dst = rows[to];
  if (!src || !dst || from === to) return sel;
  const a = sel && isMarked(sel, src) && sel.anchor !== undefined ? rows.findIndex((r) => r.id === sel.anchor) : -1;
  if (a >= 0 && Math.abs(to - a) < Math.abs(from - a)) {
    const items = sel!.items.filter((i) => i.id !== src.id);
    return items.length ? { ...sel!, items } : null;
  }
  let s = markable(src) ? mark(sel, src) : sel;
  // Across a palette's edge (the root's sections) the range stops: the row landed on would start the marks over.
  if (markable(dst) && (!s || s.palette === paletteOf(dst))) s = mark(s, dst);
  return s && { ...s, anchor: a >= 0 ? sel!.anchor : markable(src) ? src.id : dst.id };
}

/** A row that cannot be marked: a hint, a palette row, a fallback, a "more" row, a suggestion push. */
export const markable = (item: Item): boolean => !item.disabled && !item.muted && !item.push && item.actions?.length !== 0 && !!item.palette && !item.palette.startsWith("pal/");

/** An action that runs over marked rows: `multi` and listed. */
const isMulti = (a: Action) => !!a.multi && !a.hidden;

/**
 * What the marked rows can do together: the `multi` actions every marked
 * row carries (by id), in the anchor row's order and with its titles.
 * Empty when they share none (a read and an unread message marked
 * together offer neither "Mark as read" nor "Mark as unread", unless both
 * carry both).
 */
export function multiActions(items: Item[], anchor?: Item): Action[] {
  const first = anchor ?? items[0];
  if (!first) return [];
  return (first.actions ?? []).filter((a) => isMulti(a) && items.every((i) => (i.actions ?? []).some((b) => b.id === a.id && isMulti(b))));
}

/**
 * The ids a multi pick sends: the cursor row first when it is marked
 * (the pick is addressed to it), then the rest in marking order.
 */
export function pickIds(sel: Selection, cursor: Item | undefined): string[] {
  const ids = idsOf(sel);
  if (!cursor || !isMarked(sel, cursor)) return ids;
  return [cursor.id, ...ids.filter((id) => id !== cursor.id)];
}

/** The row a multi pick is addressed to: the cursor's when it is marked, else the first marked (on screen or not). */
export const anchorOf = (sel: Selection | null, cursor: Item | undefined): Item | undefined => (sel ? (cursor && isMarked(sel, cursor) ? cursor : sel.items[0]) : undefined);

/**
 * A view tree's markable rows, in document order: every node carrying
 * `mark` (`NodeBase.mark`), as rows of `palette` the model above works on.
 */
export function viewMarks(tree: ViewNode | undefined, palette: string): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  const walk = (n: ViewNode | undefined) => {
    if (!n || typeof n !== "object") return;
    if (typeof n.mark === "string" && n.mark && !seen.has(n.mark)) { seen.add(n.mark); out.push({ id: n.mark, name: n.mark, palette }); }
    if (n.type === "stack" && Array.isArray(n.children)) n.children.forEach(walk);
  };
  walk(tree);
  return out;
}

/** The mark of the view's cursor (the `selected` node carrying `mark`, or holding one), if any. */
export function viewCursor(tree: ViewNode | undefined): string | undefined {
  let found: string | undefined;
  const walk = (n: ViewNode | undefined, inSel: boolean): void => {
    if (found !== undefined || !n || typeof n !== "object") return;
    const sel = inSel || !!n.selected;
    if (sel && typeof n.mark === "string" && n.mark) { found = n.mark; return; }
    if (n.type === "stack" && Array.isArray(n.children)) for (const c of n.children) walk(c, sel);
  };
  walk(tree, false);
  return found;
}

/** The selection with only the rows still in `rows` (a view's new tree dropped the rest); null once none is left. */
export function prune(sel: Selection | null, rows: Item[]): Selection | null {
  if (!sel) return sel;
  const have = new Set(rows.map((r) => r.id));
  const items = sel.items.filter((i) => have.has(i.id));
  return items.length === sel.items.length ? sel : items.length ? { ...sel, items } : null;
}
