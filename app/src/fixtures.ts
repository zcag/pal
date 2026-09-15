/** Adapts v1 palette rows (fixtures/all.jsonl) to the UI item model. */
import type { Detail, Icon, Item } from "./ui/types";

export type Raw = {
  id: string;
  name: string;
  subtitle?: string | null;
  icon?: string;
  keywords?: string[];
  palette: string;
  section?: string;
  url?: string;
  cmd?: string;
  ssh_cmd?: string;
  hex?: string;
};

export const paletteTitle = (p: string) => ({ apps: "Applications", cmds: "Commands", ssh: "SSH", iconnerd: "Nerd Font" })[p] ?? p[0].toUpperCase() + p.slice(1);

/** Palettes whose items are glyphs, best browsed as tiles. */
export const gridPalettes = new Set(["emoji", "iconnerd", "chars", "colors"]);

const pictographic = /\p{Extended_Pictographic}/u;

export function iconOf(raw: Raw): Icon | undefined {
  const s = raw.icon?.trim();
  if (!s || s.startsWith("/")) return raw.name ? { kind: "glyph", value: raw.name[0].toUpperCase() } : undefined;
  if (/^#[0-9a-f]{3,8}$/i.test(s)) return { kind: "glyph", value: "●", color: s };
  return pictographic.test(s) ? { kind: "emoji", value: s } : { kind: "glyph", value: s };
}

function detailOf(raw: Raw): Detail {
  const glyph = raw.icon && !raw.icon.startsWith("/") && !raw.hex ? raw.icon.trim() : "";
  const target = raw.url ?? raw.cmd ?? raw.ssh_cmd ?? raw.hex;
  const md = [
    `# ${raw.name}`,
    raw.subtitle ? `${raw.subtitle}\n` : "",
    glyph ? `# ${glyph}\n` : "",
    target ? "```\n" + target + "\n```" : "",
  ].filter(Boolean).join("\n");
  return {
    markdown: md,
    metadata: [
      { label: "Palette", value: paletteTitle(raw.palette) },
      ...(raw.section ? [{ label: "Section", value: raw.section }] : []),
      { label: "Id", value: raw.id },
      ...(raw.keywords?.length ? [{ label: "Keywords", tags: raw.keywords.filter(Boolean).slice(0, 6).map((text) => ({ text })) }] : []),
      ...(raw.url ? [{ label: "URL", link: { text: new URL(raw.url).host, href: raw.url } }] : []),
    ],
  };
}

export function toItem(raw: Raw): Item {
  return {
    id: raw.id,
    name: raw.name,
    subtitle: raw.subtitle ?? undefined,
    icon: iconOf(raw),
    keywords: raw.keywords,
    palette: raw.palette,
    section: raw.section,
    accessories: raw.hex ? [{ tag: raw.hex, color: raw.hex }] : undefined,
    detail: detailOf(raw),
  };
}
