/** Adapts v1 palette rows (fixtures/all.jsonl) to the UI item model, for the gallery. */
import { iconOf as iconFromWire } from "./items";
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

/** No `icon://` in a plain browser: app paths and urls take their placeholder outright. */
export const iconOf = (raw: Raw): Icon | undefined => iconFromWire(raw.icon?.startsWith("/") ? undefined : raw.icon, raw.name);

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
