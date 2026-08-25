import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { open } from "@raycast/api";
import { PalItem, PaletteMeta, parseItems, parsePaletteMeta, runPal } from "./pal";
import { asEmoji } from "./icon";

/** Where the generated script commands live. Register this once in Raycast. */
export const SCRIPTS_DIR = join(homedir(), ".config", "raycast", "generated", "pal");

/** Palettes whose item list is ephemeral - a baked entry would be a lie. */
const NEVER_BAKE = ["otp", "tabs", "clipboard", "psg", "calc", "pwatch", "media"];

export function bakeable(palette: PaletteMeta): boolean {
  return !palette.input && !NEVER_BAKE.includes(palette.name);
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * Write one Raycast script command per item, so palette items are reachable
 * from Raycast's root search (which only indexes commands, never the contents
 * of a view).
 *
 * The script stores a *pointer* - palette plus id - not a copy of the item.
 * `pal pick --id` re-lists and resolves it at run time, so the action is always
 * current and only the title is from generation time. That's what makes this
 * safe for palettes whose state moves even though their identities don't.
 */
export async function generateScripts(
  palettes: string[],
): Promise<Array<{ palette: string; count: number; error?: string }>> {
  mkdirSync(SCRIPTS_DIR, { recursive: true });
  for (const file of readdirSync(SCRIPTS_DIR)) {
    if (file.endsWith(".sh")) rmSync(join(SCRIPTS_DIR, file));
  }

  const results: Array<{ palette: string; count: number; error?: string }> = [];

  for (const palette of palettes) {
    try {
      const meta = parsePaletteMeta(await runPal(["meta", palette]));
      const items = parseItems(await runPal(["list", palette]));
      const paletteEmoji = asEmoji(meta.icon) ?? asEmoji(meta.icon_utf);

      for (const item of items) {
        writeFileSync(
          join(SCRIPTS_DIR, `${slug(palette)}-${slug(item.id ?? item.name)}.sh`),
          script(palette, item, meta, paletteEmoji),
          { mode: 0o755 },
        );
      }
      results.push({ palette, count: items.length });
    } catch (e) {
      results.push({ palette, count: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Nudge Raycast to rescan rather than waiting for its own poll.
  try {
    await open("raycast://extensions/raycast/raycast/refresh-script-directories");
  } catch {
    // Not fatal - the directory is picked up on the next scan.
  }

  return results;
}

function script(
  palette: string,
  item: PalItem,
  meta: PaletteMeta,
  paletteEmoji?: string,
): string {
  const icon = asEmoji(item.icon) ?? asEmoji(item.icon_utf) ?? paletteEmoji ?? "⚡";
  const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const id = (item.id ?? item.name).replace(/'/g, "'\\''");

  return [
    "#!/bin/bash",
    "",
    "# @raycast.schemaVersion 1",
    `# @raycast.title ${oneLine(item.name)}`,
    "# @raycast.mode silent",
    `# @raycast.icon ${icon}`,
    `# @raycast.packageName ${palette}`,
    `# @raycast.description ${oneLine(item.subtitle ?? meta.desc ?? palette)}`,
    "",
    `# generated from the "${palette}" pal palette - do not edit`,
    `# resolves the item fresh on each run, so only the title above can go stale`,
    `exec pal pick ${palette} --id '${id}'`,
    "",
  ].join("\n");
}
