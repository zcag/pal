/**
 * pal's built-in designs (`general.design`), each a CSS file beside this one
 * scoped to `[data-design="<id>"]` (theme.ts `applyDesign` puts the attribute
 * on <html>; the gallery on a shot). A design is tokens only: tokens.css's,
 * and the hooks below that ui.css reads with a fallback to pal's own, so
 * with no design set nothing about the panel changes. A theme file
 * (`general.theme_file`) still applies over a design.
 *
 * Hooks: `--pal-text-query`, `--pal-font-query`, `--pal-weight-query`, `--pal-tracking-query`,
 * `--pal-weight-placeholder`, `--pal-text-placeholder` (the search field's text);
 * `--pal-font-hero`, `--pal-weight-hero` (the answer's value, `Item.hero`; its
 * size and row height are tokens.css's `--pal-text-hero`, `--pal-hero-h`); `--pal-weight-title`, `--pal-tracking-title`
 * (row titles); `--pal-cursor`, `--pal-cursor-fg`, `--pal-cursor-fg-muted`,
 * `--pal-cursor-shadow`, `--pal-cursor-kbd`, `--pal-cursor-kbd-line` (the
 * keyboard cursor: a list row, a grid tile, an action); `--pal-cursor-glide`
 * (`block`: one fill that slides between a list's rows) with
 * `--pal-cursor-row` / `--pal-cursor-row-shadow` (`transparent` / `none`); `--pal-caret`;
 * `--pal-match-decoration` (a match, beside `--pal-match`'s fill);
 * `--pal-search-line`, `--pal-footer-line` (the dividers); `--pal-crumb-bg`
 * (the back button); `--pal-row-hints` (`flex` draws the footer's keys on
 * the cursor row) with `--pal-footer-at-row` (`none` drops the footer then)
 * and `--pal-footer-at-row-h` (the room the overlays keep for it then);
 * `--pal-panel-fit` (`on`: a list level takes only the height its rows need);
 * `--pal-glance` (`grid`: the glance strip over the empty root, `general.glance`);
 * `--pal-acc-max` (the most accessories a row shows, the rest dropped in
 * Row's `accessoryDropOrder`); `--pal-place-wash`, `--pal-place-reach`,
 * `--pal-place-cursor`, `--pal-place-crumb`, `--pal-place-accent` (how much a
 * palette's own colour, `--pal-place`, tints the panel inside it).
 */
import "./ink.css";

export type Design = { id: string; title: string; description: string };

/** Every design, pal's own first (the empty id: no attribute). */
export const DESIGNS: Design[] = [
  { id: "", title: "pal", description: "Glass panel, soft selection, keys in the footer." },
  { id: "ink", title: "Ink", description: "Type-led and monochrome: the query as a headline, a soft selected row carrying its keys." },
];

/** The design a config value names, or pal's own for an empty or unknown one. */
export const designOf = (id: string | undefined): Design => DESIGNS.find((d) => d.id === (id ?? "")) ?? DESIGNS[0];
