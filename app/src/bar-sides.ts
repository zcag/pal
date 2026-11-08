/**
 * Where a bar item sits on a page's strip, from its configured `position`
 * (`[bar.items."ext/item"] position`, else sketchybar's default): `left`,
 * then sketchybar's `q` and `e` (the notch's two sides; a page has no notch,
 * so they follow the left items), `center` in the middle, and `right` for
 * anything else (the menu bar's own place). Within a side the strip's
 * order holds.
 */
export type Side = "left" | "center" | "right";

const LEFT = ["left", "q", "e"];

export const sideOf = (position: string | undefined): Side => (LEFT.includes(position ?? "") ? "left" : position === "center" || position === "c" ? "center" : "right");

/** The items by side, each side in the strip's order, the left's `left` before its `q` before its `e`. */
export function bySide<T extends { position?: string }>(items: T[]): Record<Side, T[]> {
  const out: Record<Side, T[]> = { left: [], center: [], right: [] };
  for (const it of items) out[sideOf(it.position)].push(it);
  out.left.sort((a, b) => LEFT.indexOf(a.position ?? "") - LEFT.indexOf(b.position ?? ""));
  return out;
}

/** `hide="a/b, c/d"` as keys. */
export const hiddenKeys = (list: string | null | undefined): Set<string> => new Set((list ?? "").split(",").map((k) => k.trim()).filter(Boolean));
