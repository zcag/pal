import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Icon pulls in icons.ts, which reads `window` at import; no DOM is needed for these tests.
vi.hoisted(() => { (globalThis as { window?: unknown }).window ??= globalThis; });
import { Icon } from "../Icon";
import { BRAND } from "../icons";
import { PALETTES, brandOf, iconOf, toItem } from "../../items";
import type { Icon as IconSpec } from "../types";

const render = (icon: IconSpec | undefined, size?: "sm" | "md" | "lg") => renderToStaticMarkup(<Icon icon={icon} size={size} />);

describe("Icon: tile", () => {
  const glyph: IconSpec = { kind: "tile", bg: "ink", glyph: "" };
  const svg: IconSpec = { kind: "tile", bg: "green", svg: "M2 2h5v5H2z" };

  it("draws a glyph mark in the brand's square at every size (the side is icons.css's per data-size)", () => {
    for (const size of ["sm", "md", "lg"] as const) {
      const html = render(glyph, size);
      expect(html).toContain(`data-size="${size}"`);
      expect(html).toContain('data-kind="tile"');
      expect(html).toContain('data-brand="ink"');
      expect(html).toContain('<span class="pal-icon__glyph"></span>');
      expect(html).not.toContain("<svg");
    }
  });
  it("draws an svg mark as path data in a 16 box, filled by the stylesheet's currentColor", () => {
    const html = render(svg, "md");
    expect(html).toContain('data-brand="green"');
    expect(html).toContain('<svg class="pal-icon__mark" viewBox="0 0 16 16"><path d="M2 2h5v5H2z"></path></svg>');
    expect(html).not.toContain("pal-icon__glyph");
  });
  it("a badge is a pill in the corner, only when the tile has one", () => {
    const html = render({ kind: "tile", bg: "amber", glyph: "\uf408", badge: "W" }, "md");
    expect(html).toContain("data-badged");
    expect(html).toContain('<span class="pal-icon__badge">W</span>');
    expect(render(glyph)).not.toContain("pal-icon__badge");
  });
  it("a tinted glyph carries the brand; a hex colour is inline and wins over a tint", () => {
    expect(render({ kind: "glyph", value: "", tint: "green" })).toContain('data-kind="glyph" data-brand="green"');
    const hex = render({ kind: "glyph", value: "●", color: "#ff0000", tint: "green" });
    expect(hex).toContain('style="color:#ff0000"');
    expect(hex).not.toContain("data-brand");
  });
  it("the twelve brands are the ones the SDK names", () => {
    expect(BRAND).toEqual(["red", "orange", "amber", "green", "teal", "cyan", "blue", "indigo", "violet", "pink", "slate", "ink"]);
  });
});

describe("iconOf: the wire forms", () => {
  it("{ tile } with a glyph or an svg in a brand colour", () => {
    expect(iconOf({ tile: { glyph: "", bg: "ink" } }, "GitHub")).toEqual({ kind: "tile", bg: "ink", glyph: "" });
    expect(iconOf({ tile: { svg: "M0 0h1v1z", bg: "amber" } }, "2048")).toEqual({ kind: "tile", bg: "amber", svg: "M0 0h1v1z" });
  });
  it("{ tile } with a badge keeps it, cut to two characters", () => {
    expect(iconOf({ tile: { glyph: "\uf408", bg: "amber", badge: "W" } }, "GitHub")).toEqual({ kind: "tile", bg: "amber", glyph: "\uf408", badge: "W" });
    expect(iconOf({ tile: { svg: "M0 0h1v1z", bg: "amber", badge: "Work" } }, "x")).toEqual({ kind: "tile", bg: "amber", svg: "M0 0h1v1z", badge: "Wo" });
    expect(iconOf({ tile: { glyph: "\uf408", bg: "amber", badge: " " } }, "x")).toEqual({ kind: "tile", bg: "amber", glyph: "\uf408" });
  });
  it("a tile with a colour off the palette falls back to its glyph, else the initial", () => {
    expect(iconOf({ tile: { glyph: "", bg: "mauve" } }, "GitHub")).toEqual({ kind: "glyph", value: "" });
    expect(iconOf({ tile: { svg: "M0 0", bg: "mauve" } }, "Two")).toEqual({ kind: "glyph", value: "T" });
  });
  it("{ glyph, color }: a brand is a tint, a hex is a colour, anything else is plain", () => {
    expect(iconOf({ glyph: "", color: "green" }, "x")).toEqual({ kind: "glyph", value: "", tint: "green" });
    expect(iconOf({ glyph: "", color: "#8250df" }, "x")).toEqual({ kind: "glyph", value: "", color: "#8250df" });
    expect(iconOf({ glyph: "", color: "lime" }, "x")).toEqual({ kind: "glyph", value: "" });
  });
  it("the string forms are unchanged", () => {
    expect(iconOf("", "x")).toEqual({ kind: "glyph", value: "" });
    expect(iconOf("🍑", "x")).toEqual({ kind: "emoji", value: "🍑" });
    expect(iconOf("#4f46d6", "x")).toEqual({ kind: "glyph", value: "●", color: "#4f46d6" });
    expect(iconOf(undefined, "x", "https://a.b")).toEqual({ kind: "favicon", url: "https://a.b" });
  });
});

describe("toItem: rows take their palette's colour", () => {
  const source = { extension: "github", palette: "prs" };
  const hit = (item: { id: string; name: string; icon?: unknown; url?: string }) => ({ source, id: item.id, score: 0, name_positions: [], item });
  const tile = { tile: { glyph: "", bg: "ink" } };

  it("a plain Nerd Font glyph is tinted in the tile's brand; a letter, a coloured glyph and an emoji are not", () => {
    const palette = { title: "Pull Requests", icon: tile };
    expect(toItem(hit({ id: "a", name: "A", icon: "" }), palette).icon).toEqual({ kind: "glyph", value: "", tint: "ink" });
    expect(toItem(hit({ id: "b", name: "Bee" }), palette).icon).toEqual({ kind: "glyph", value: "B" });
    expect(toItem(hit({ id: "c", name: "C", icon: "#1a7f37" }), palette).icon).toEqual({ kind: "glyph", value: "●", color: "#1a7f37" });
    expect(toItem(hit({ id: "d", name: "D", icon: "🍑" }), palette).icon).toEqual({ kind: "emoji", value: "🍑" });
    expect(toItem(hit({ id: "e", name: "E", icon: { glyph: "", color: "violet" } }), palette).icon).toEqual({ kind: "glyph", value: "", tint: "violet" });
  });
  it("a favicon's globe fallback takes the brand too", () => {
    expect(toItem(hit({ id: "u", name: "U", url: "https://a.b" }), { title: "Bookmarks", icon: { tile: { glyph: "\u{f00c0}", bg: "orange" } } }).icon).toEqual({ kind: "favicon", url: "https://a.b", tint: "orange" });
  });
  it("a palette without a tile, a catalog and a grid leave glyphs alone: theirs are the content", () => {
    expect(toItem(hit({ id: "a", name: "A", icon: "" }), { title: "P", icon: "" }).icon).toEqual({ kind: "glyph", value: "" });
    expect(brandOf({ icon: tile, tier: "catalog" })).toBeUndefined();
    expect(brandOf({ icon: tile, view: "grid" })).toBeUndefined();
    expect(brandOf({ icon: tile })).toBe("ink");
  });
  it("the palettes' own rows at the root are tiles", () => {
    const row = toItem({ source: { extension: "pal", palette: "palettes" }, id: "github/prs", score: 0, name_positions: [], item: { id: "github/prs", name: "Pull Requests", icon: tile } }, { title: "Palettes" });
    expect(row.palette).toBe(PALETTES);
    expect(row.icon).toEqual({ kind: "tile", bg: "ink", glyph: "" });
  });
});
