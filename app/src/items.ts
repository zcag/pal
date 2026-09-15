/**
 * Adapts what the core sends per hit (a host item, fields pass through) to
 * the UI item model. Provisional, like the wire shape it reads.
 */
import type { Detail, Icon, Item } from "./ui/types";

/** `pal_core::index::Source`. */
export type Source = { extension: string; palette: string };

/** `pal_core::index::Item`: the typed fields plus whatever the extension added. */
export type WireItem = {
  id: string;
  name: string;
  subtitle?: string;
  keywords?: string[];
  icon?: unknown;
  section?: string;
  url?: string;
  [extra: string]: unknown;
};

/** One row of the `query` command's reply (`HitView` in src-tauri/src/index.rs). */
export type WireHit = { source: Source; id: string; score: number; name_positions: number[]; item: WireItem };

/** One row of the `sources` command's reply. */
export type SourceInfo = Source & { title: string; live: boolean; count: number };

/** `Item.palette` for a source. Fixture rows (the gallery) have no extension and keep their bare palette name. */
export const sourceKey = (s: Source) => (s.extension ? `${s.extension}/${s.palette}` : s.palette);

/** Palettes whose items are glyphs, best browsed as tiles. By palette name until palettes declare a view. */
export const gridPalettes = new Set(["emoji", "iconnerd", "chars", "colors"]);

const pictographic = /\p{Extended_Pictographic}/u;

/**
 * `{ app: path }` (or a bare path, as v1 rows carry) is the app's artwork; a
 * hex colour is a tinted dot; a pictograph is an emoji; any other string is
 * a glyph. No icon: the favicon when there is a url, else the name's initial.
 */
export function iconOf(icon: unknown, name: string, url?: string): Icon | undefined {
  const letter = name ? name[0].toUpperCase() : "";
  if (icon && typeof icon === "object" && typeof (icon as { app?: unknown }).app === "string") return { kind: "app", path: (icon as { app: string }).app, letter };
  const s = typeof icon === "string" ? icon.trim() : "";
  if (s.startsWith("/")) return { kind: "app", path: s, letter };
  if (s) {
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return { kind: "glyph", value: "●", color: s };
    return pictographic.test(s) ? { kind: "emoji", value: s } : { kind: "glyph", value: s };
  }
  if (url) return { kind: "favicon", url };
  return letter ? { kind: "glyph", value: letter } : undefined;
}

function detailOf(w: WireItem, paletteTitle: string): Detail {
  const target = [w.url, w.cmd, w.ssh_cmd, w.hex].find((v) => typeof v === "string") as string | undefined;
  const md = [`# ${w.name}`, w.subtitle ? `${w.subtitle}\n` : "", target ? "```\n" + target + "\n```" : ""].filter(Boolean).join("\n");
  return {
    markdown: md,
    metadata: [
      { label: "Palette", value: paletteTitle },
      ...(w.section ? [{ label: "Section", value: w.section }] : []),
      { label: "Id", value: w.id },
      ...(w.keywords?.length ? [{ label: "Keywords", tags: w.keywords.filter(Boolean).slice(0, 6).map((text) => ({ text })) }] : []),
      ...(w.url ? [{ label: "URL", link: { text: safeHost(w.url), href: w.url } }] : []),
    ],
  };
}

const safeHost = (url: string) => { try { return new URL(url).host; } catch { return url; } };

export function toItem(hit: WireHit, paletteTitle: string): Item {
  const w = hit.item;
  return {
    id: w.id,
    name: w.name,
    subtitle: w.subtitle,
    icon: iconOf(w.icon, w.name, w.url),
    keywords: w.keywords,
    palette: sourceKey(hit.source),
    source: hit.source,
    section: w.section,
    accessories: typeof w.hex === "string" ? [{ tag: w.hex, color: w.hex }] : undefined,
    detail: detailOf(w, paletteTitle),
  };
}
