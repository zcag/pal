// macOS applications: .app bundles under the three usual roots, one level
// deep so the Utilities folders come along. Ported from v1 builtin/apps.rs.
import { readdir } from "node:fs/promises";
import type { Extension, Item } from "../../host/src/protocol.ts";

const HOME = process.env.HOME ?? "";
const ROOTS: [string, string][] = [
  ["/Applications", "Applications"],
  ["/System/Applications", "macOS"],
  [`${HOME}/Applications`, "User"],
];

async function bundles(dir: string, depth = 1): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const p = `${dir}/${e.name}`;
    if (e.name.endsWith(".app")) out.push(p);
    else if (depth > 0) out.push(...(await bundles(p, depth - 1)));
  }
  return out;
}

// Bundle id as a keyword, so "com.apple." or "anthropic" finds the app.
async function bundleId(app: string): Promise<string | undefined> {
  const plist = await Bun.file(`${app}/Contents/Info.plist`).text().catch(() => "");
  return plist.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/)?.[1]?.trim();
}

let cache: Item[] | undefined;

async function scan(): Promise<Item[]> {
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const [root, source] of ROOTS) {
    for (const path of await bundles(root)) {
      const name = path.slice(path.lastIndexOf("/") + 1, -4);
      if (!seen.add(name.toLowerCase())) continue;
      const id = await bundleId(path);
      items.push({ id: path, name, subtitle: source, icon: path, keywords: id ? [id] : [] });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export default {
  palettes: {
    apps: {
      list: async () => (cache ??= await scan()),
      pick: (id) => {
        Bun.spawn(["open", "-a", id]);
        return { opened: id };
      },
    },
  },
} satisfies Extension;
