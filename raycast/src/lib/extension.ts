import { environment } from "@raycast/api";
import { createDeeplink } from "@raycast/utils";
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

/**
 * A link that opens one palette. The per-palette commands only exist in a
 * locally synced build - the store build has just `pal` - so route through
 * `pal` and hand it the palette in the launch context, which is true of both.
 *
 * Built by Raycast rather than by hand: the scheme is `RAYCAST_SCHEME` when
 * set and only `raycast://` otherwise (a dev build registers `raycast-x`), the
 * launch context rides in `context`, not `launchContext`, and the identity is
 * `owner || author`. Hand-rolling all three is what made these links no-ops.
 */
export function paletteDeeplink(palette: string): string {
  return createDeeplink({ command: "pal", context: { palette } });
}
