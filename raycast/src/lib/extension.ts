import { environment } from "@raycast/api";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The manifest Raycast actually installed, which is not always the one in the
 * repo: the store build drops every `palette-*` command, and the local build
 * is baked against whichever config was last synced. Anything that wants to
 * know what commands exist has to read this, not assume.
 */
export function installedManifest(): {
  author?: string;
  name?: string;
  commands?: Array<{ name: string }>;
} | null {
  try {
    // assetsPath is <installed extension>/assets
    return JSON.parse(readFileSync(join(environment.assetsPath, "..", "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function extensionIdentity(): { author: string; name: string } {
  const manifest = installedManifest();
  return { author: manifest?.author ?? "zcag", name: manifest?.name ?? "pal" };
}

/** `raycast://extensions/<author>/<extension>/<command>` for this extension. */
export function deeplink(command: string, params?: Record<string, string>): string {
  const { author, name } = extensionIdentity();
  const query = params
    ? `?${Object.entries(params)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join("&")}`
    : "";
  return `raycast://extensions/${author}/${name}/${command}${query}`;
}

/**
 * A link that opens one palette. The per-palette commands only exist in a
 * locally synced build - the store build has just `pal` - so route through
 * `pal` and hand it the palette in the launch context, which is true of both.
 */
export function paletteDeeplink(palette: string): string {
  return deeplink("pal", { launchContext: JSON.stringify({ palette }) });
}
