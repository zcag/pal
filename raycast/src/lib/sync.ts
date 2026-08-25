import { environment, getPreferenceValues } from "@raycast/api";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { shellPath } from "./pal";

const exec = promisify(execFile);

const PREFIX = "palette-";

/**
 * Raycast reads its command list from a static manifest at install time, so an
 * extension cannot register a command for a palette you added five minutes
 * ago. Palette *contents* are always live - only this keyword layer is stale.
 * The next best thing is to notice and say so.
 */
function installedManifest(): { commands?: Array<{ name: string }> } | null {
  try {
    // assetsPath is <installed extension>/assets
    return JSON.parse(readFileSync(join(environment.assetsPath, "..", "package.json"), "utf8"));
  } catch {
    return null;
  }
}

const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Palette names that have no Raycast command yet. */
export function palettesMissingCommands(palettes: Array<{ name: string }>): string[] {
  const manifest = installedManifest();
  if (!manifest?.commands) return [];

  const have = new Set(
    manifest.commands
      .map((command) => command.name)
      .filter((name) => name.startsWith(PREFIX))
      .map((name) => name.slice(PREFIX.length)),
  );
  // An extension with no generated commands at all hasn't been synced once;
  // don't nag about every palette in that case.
  if (have.size === 0) return [];

  return palettes.map((p) => p.name).filter((name) => !have.has(slug(name)));
}

export function sourcePath(): string {
  const { extensionPath } = getPreferenceValues<{ extensionPath?: string }>();
  const configured = extensionPath?.trim();
  if (!configured) return "";
  return configured.replace(/^~/, process.env.HOME ?? "~");
}

/**
 * Regenerate the palette commands. With `npm run dev` running, its watcher
 * rebuilds and reinstalls on its own, so this is all that's needed.
 */
export async function syncCommands(): Promise<string> {
  const cwd = sourcePath();
  if (!cwd) {
    throw new Error(
      "Set “Extension Source Folder” in preferences to the pal repo's raycast/ directory first.",
    );
  }
  const { stdout } = await exec("npm", ["run", "sync"], {
    cwd,
    env: { ...process.env, PATH: await shellPath() },
    timeout: 120_000,
  });
  return String(stdout).trim();
}
