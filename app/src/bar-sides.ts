/**
 * Where a bar item sits on a page's strip, from its configured `position`
 * (`[bar.items."ext/item"] position`, else sketchybar's default): `left`,
 * the middle (`center`, and sketchybar's `q` and `e` either side of the
 * notch, in that order), or `right`, which is also anything else (the menu
 * bar's own place). Within a side the strip's order holds.
 */
export type Side = "left" | "center" | "right";

const MIDDLE = ["q", "center", "c", "e"];

export const sideOf = (position: string | undefined): Side => (position === "left" ? "left" : MIDDLE.includes(position ?? "") ? "center" : "right");

/** The items by side, each side in the strip's order, the middle's `q` before its `e`. */
export function bySide<T extends { position?: string }>(items: T[]): Record<Side, T[]> {
  const out: Record<Side, T[]> = { left: [], center: [], right: [] };
  for (const it of items) out[sideOf(it.position)].push(it);
  out.center.sort((a, b) => MIDDLE.indexOf(a.position ?? "") - MIDDLE.indexOf(b.position ?? ""));
  return out;
}

/** `hide="a/b, c/d"` as keys. */
export const hiddenKeys = (list: string | null | undefined): Set<string> => new Set((list ?? "").split(",").map((k) => k.trim()).filter(Boolean));
