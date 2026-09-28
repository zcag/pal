/**
 * The bar popover's height for what it shows: the content's (a list's
 * virtual height, a view, a show, a form, an empty state) plus the chrome
 * (the search row and the footer), up to the window's maximum. BarPage.tsx
 * sizes the real popover window with it and the gallery's bar shots draw
 * theirs with it, so a store picture is the popover's real size.
 */
export const POPOVER_MAX_H = 480;
/** The search row and the footer, as the popover draws them. */
export const POPOVER_CHROME = 52 + 36;
const CONTENT = ".pal-list__inner, .pal-view > .pal-view__stack, .pal-show, .pal-form-level, .pal-empty";

export function popoverHeight(root: HTMLElement, chrome = POPOVER_CHROME, max = POPOVER_MAX_H): number {
  const inner = root.querySelector<HTMLElement>(CONTENT);
  const content = inner ? inner.scrollHeight + 16 : 120;
  return Math.min(max, chrome + content);
}
