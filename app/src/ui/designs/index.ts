/**
 * pal's built-in designs (`general.design`), each but Classic a CSS file beside this one
 * scoped to `[data-design~="<id>"]` (theme.ts `applyDesign` puts the attribute
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
 * `--pal-loading-top`, `--pal-loading-bottom` (where the loading line runs);
 * `--pal-acc-max` (the most accessories a row shows, the rest dropped in
 * Row's `accessoryDropOrder`); `--pal-place-wash`, `--pal-place-reach`,
 * `--pal-place-cursor`, `--pal-place-crumb`, `--pal-place-accent` (how much a
 * palette's own colour, `--pal-place`, tints the panel inside it).
 */
import "./ink.css";
// After the design it builds on: a later file wins at the same specificity.
import "./frappe.css";

/** `base`: a design this one builds on (its layout, under this one's colours); both ids go in the attribute, base first. `bare`: no CSS of its own (Classic is tokens.css alone, so no attribute). */
export type Design = { id: string; title: string; description: string; base?: string; bare?: boolean };

/** Every design, the default first: Ink (since 2026-10-03; `general.design` empty or unknown means it). */
export const DESIGNS: Design[] = [
  { id: "ink", title: "Ink", description: "Type-led and monochrome: the query as a headline, a soft selected row carrying its keys." },
  { id: "frappe", title: "Frappé", base: "ink", description: "Ink in Catppuccin: Frappé on dark, Latte on light, to match a Catppuccin desktop." },
  { id: "classic", title: "Classic", bare: true, description: "pal's first look: a glass panel, a soft selection, the keys in the footer." },
];

/** The design a config value names, or the default (Ink) for an empty or unknown one. */
export const designOf = (id: string | undefined): Design => DESIGNS.find((d) => d.id === id) ?? DESIGNS[0];
/** The `data-design` value for a design: its base and its own id (`"ink frappe"`), empty for Classic. */
export const designAttr = (d: Design): string => (d.bare ? "" : [d.base, d.id].filter(Boolean).join(" "));
