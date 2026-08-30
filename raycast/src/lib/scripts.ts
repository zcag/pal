import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PalItem, PaletteMeta, parseItems, parsePaletteMeta, runPal } from "./pal";
import { asEmoji } from "./icon";
import { paletteDeeplink } from "./extension";

/** Where the generated script commands live. Register this once in Raycast. */
export const SCRIPTS_DIR = join(homedir(), ".config", "raycast", "generated", "pal");
const ICONS_DIR = join(SCRIPTS_DIR, "icons");

/** Palettes whose item list is ephemeral - a baked entry would be a lie. */
const NEVER_BAKE = ["otp", "tabs", "clipboard", "psg", "calc", "pwatch", "media"];

export function bakeable(palette: PaletteMeta): boolean {
  return !palette.input && !NEVER_BAKE.includes(palette.name);
}

/**
 * Script command icons take an emoji, a file path or an https URL - not
 * Raycast's own icon names, and not the Nerd Font glyphs pal palettes use in
 * terminals. Map the freedesktop name to something that renders.
 */
const XDG_TO_EMOJI: Record<string, string> = {
  "accessories-calculator": "🧮",
  "accessories-character-map": "🔤",
  "application-x-executable": "📦",
  "audio-card": "🔊",
  bluetooth: "🅱️",
  bookmark: "🔖",
  "camera-web": "👁️",
  "dialog-password": "🔑",
  docker: "🐳",
  "edit-paste": "📋",
  "face-smile": "😀",
  "folder-remote": "🗄️",
  "font-x-generic": "🔤",
  "google-chrome": "🌐",
  home: "🏠",
  kitty: "🐱",
  "mail-unread": "✉️",
  "multimedia-player": "🎵",
  "network-server": "🖥️",
  "network-wired": "🔌",
  "network-wireless": "📶",
  pda: "📆",
  "preferences-desktop-theme": "🎨",
  "preferences-system-windows": "🪟",
  "system-hibernate": "🌙",
  "system-lock-screen": "🔒",
  "system-log-out": "🚪",
  "system-reboot": "🔄",
  "system-run": "🔨",
  "system-shutdown": "⏻",
  "system-suspend": "😴",
  "utilities-system-monitor": "📈",
  "utilities-terminal": "💻",
  "view-grid": "🔲",
  "view-list": "📋",
  "weather-clear": "☀️",
};

function paletteEmoji(meta: PaletteMeta): string | undefined {
  return (
    asEmoji(meta.icon) ??
    asEmoji(meta.icon_utf) ??
    (meta.icon ? XDG_TO_EMOJI[meta.icon] : undefined) ??
    (meta.icon_xdg ? XDG_TO_EMOJI[meta.icon_xdg] : undefined)
  );
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * Cache a site icon next to the scripts and return its path.
 *
 * Fetched once per sync rather than referenced as a remote URL, so rendering
 * the root search doesn't phone out on every keystroke.
 */
async function cacheFavicon(url: string, name: string): Promise<string | undefined> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  const file = join(ICONS_DIR, `${name}.png`);
  if (existsSync(file)) return file;

  try {
    const response = await fetch(
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100) return undefined; // a placeholder, not a real icon
    mkdirSync(ICONS_DIR, { recursive: true });
    writeFileSync(file, bytes);
    return file;
  } catch {
    return undefined;
  }
}

/**
 * Write one Raycast script command per item, so palette items are reachable
 * from root search (which only indexes commands, never the contents of a view).
 *
 * The script stores a *pointer* - palette plus id - not a copy of the item.
 * `pal pick --id` re-lists and resolves it at run time, so the action is always
 * current and only the title is from generation time.
 */
export async function generateScripts(
  palettes: string[],
): Promise<Array<{ palette: string; count: number; error?: string }>> {
  mkdirSync(SCRIPTS_DIR, { recursive: true });
  for (const file of readdirSync(SCRIPTS_DIR)) {
    if (file.endsWith(".sh")) rmSync(join(SCRIPTS_DIR, file));
  }

  // Icons for palettes referenced by a `pals` entry, so those rows look right.
  const allMeta = new Map<string, PaletteMeta>();
  try {
    const meta = JSON.parse(await runPal(["meta"]));
    for (const palette of meta.palettes ?? []) allMeta.set(palette.name, palette);
  } catch {
    // Falls back to per-palette lookups below.
  }

  const results: Array<{ palette: string; count: number; error?: string }> = [];

  for (const palette of palettes) {
    try {
      const meta = allMeta.get(palette) ?? parsePaletteMeta(await runPal(["meta", palette]));
      const items = parseItems(await runPal(["list", palette]));

      for (const item of items) {
        const name = `${slug(palette)}-${slug(item.id ?? item.name)}`;
        const body = await scriptFor(palette, item, meta, allMeta, name);
        writeFileSync(join(SCRIPTS_DIR, `${name}.sh`), body, { mode: 0o755 });
      }
      results.push({ palette, count: items.length });
    } catch (e) {
      results.push({ palette, count: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return results;
}

async function scriptFor(
  palette: string,
  item: PalItem,
  meta: PaletteMeta,
  allMeta: Map<string, PaletteMeta>,
  name: string,
): Promise<string> {
  const source = typeof item._source === "string" ? item._source : palette;
  const sourceMeta = allMeta.get(source) ?? meta;

  // An item from the `pals` palette *is* another palette. Running its pick
  // headlessly just answers "show this palette", which a shell script can't
  // act on - so open the palette in Raycast instead.
  const isPalette = source === "pals";
  const target = isPalette ? allMeta.get(item.id) : undefined;

  const url = typeof item.url === "string" && /^https?:\/\//.test(item.url) ? item.url : undefined;
  const icon =
    asEmoji(item.icon) ??
    asEmoji(item.icon_utf) ??
    (url ? await cacheFavicon(url, name) : undefined) ??
    (target ? paletteEmoji(target) : undefined) ??
    paletteEmoji(sourceMeta) ??
    // A link whose favicon we couldn't fetch (internal host, blocked) still
    // reads better as a bookmark than as a generic bolt.
    (url ? "🔖" : "⚡");

  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const id = (item.id ?? item.name).replace(/'/g, "'\\''");

  const action = isPalette
    ? `open "${paletteDeeplink(item.id)}"`
    : `exec pal pick ${palette} --id '${id}'`;

  return [
    "#!/bin/bash",
    "",
    "# @raycast.schemaVersion 1",
    `# @raycast.title ${oneLine(item.name)}`,
    "# @raycast.mode silent",
    `# @raycast.icon ${icon}`,
    `# @raycast.packageName ${isPalette ? "pal" : source}`,
    `# @raycast.description ${oneLine(item.subtitle ?? sourceMeta.desc ?? source)}`,
    "",
    `# generated from the "${palette}" pal palette - do not edit`,
    isPalette
      ? "# a palette entry, so this opens the palette in Raycast"
      : "# resolves the item fresh on each run, so only the title above can go stale",
    action,
    "",
  ].join("\n");
}
