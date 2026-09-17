// The installed browsers as the two palettes see them: where each keeps
// its profiles (Chrome and its relatives one directory per profile under
// a root, Firefox `<random>.<name>` directories, Safari one folder), the
// profile names Chrome shows, how to open a url in a given browser, and a
// copy of a SQLite file a running browser holds locked. Shared by the
// bookmarks listing (index.ts) and the history palette (history.ts).
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { home } from "@zcag/pal";

export const MAC = process.platform === "darwin";
/** Tests point the profile roots at a temp home. */
export const HOME = process.env.PAL_BOOKMARKS_HOME || home("~");
const APP_SUPPORT = `${HOME}/Library/Application Support`;
/** Where a locked database is copied to before it is read (`PAL_BOOKMARKS_CACHE` in the tests). */
const CACHE = process.env.PAL_BOOKMARKS_CACHE || (MAC ? `${HOME}/Library/Caches/pal/bookmarks` : `${process.env.XDG_CACHE_HOME || `${HOME}/.cache`}/pal/bookmarks`);

export type Chromium = { kind: "chromium"; title: string; mac: string; linux: string; app: string; bin: string };
export type Firefox = { kind: "firefox"; title: string; mac: string; linux: string; app: string; bin: string };
export type Browser = Chromium | { kind: "safari"; title: string; app: string } | Firefox;

/** The `browsers` setting's ids; `mac`/`linux` are the profile roots under the home. */
export const BROWSERS: Record<string, Browser> = {
  chrome: { kind: "chromium", title: "Chrome", mac: `${APP_SUPPORT}/Google/Chrome`, linux: `${HOME}/.config/google-chrome`, app: "Google Chrome", bin: "google-chrome" },
  chromium: { kind: "chromium", title: "Chromium", mac: `${APP_SUPPORT}/Chromium`, linux: `${HOME}/.config/chromium`, app: "Chromium", bin: "chromium" },
  brave: { kind: "chromium", title: "Brave", mac: `${APP_SUPPORT}/BraveSoftware/Brave-Browser`, linux: `${HOME}/.config/BraveSoftware/Brave-Browser`, app: "Brave Browser", bin: "brave" },
  edge: { kind: "chromium", title: "Edge", mac: `${APP_SUPPORT}/Microsoft Edge`, linux: `${HOME}/.config/microsoft-edge`, app: "Microsoft Edge", bin: "microsoft-edge" },
  vivaldi: { kind: "chromium", title: "Vivaldi", mac: `${APP_SUPPORT}/Vivaldi`, linux: `${HOME}/.config/vivaldi`, app: "Vivaldi", bin: "vivaldi" },
  arc: { kind: "chromium", title: "Arc", mac: `${APP_SUPPORT}/Arc/User Data`, linux: "", app: "Arc", bin: "" },
  safari: { kind: "safari", title: "Safari", app: "Safari" },
  firefox: { kind: "firefox", title: "Firefox", mac: `${APP_SUPPORT}/Firefox/Profiles`, linux: `${HOME}/.mozilla/firefox`, app: "Firefox", bin: "firefox" },
};

export const exists = (p: string) => stat(p).then(() => true, () => false);

/** One profile directory of a browser and the section its rows list under (`Chrome`, or `Chrome (Work)` when the browser has several). */
export type Profile = { dir: string; section: string };

/** Chrome's profile names from `Local State`, by profile directory; the directory name otherwise. */
async function chromeProfileNames(root: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const state = await Bun.file(`${root}/Local State`).json().catch(() => undefined);
  const cache = (state as { profile?: { info_cache?: Record<string, { name?: string }> } } | undefined)?.profile?.info_cache ?? {};
  for (const [dir, info] of Object.entries(cache)) if (info?.name) names.set(dir, info.name);
  return names;
}

/** A Chrome-family browser's profiles (`Default`, `Profile N`), the ones holding `file`; none when the browser is not installed. */
export async function chromiumProfiles(b: Chromium, file: string): Promise<Profile[]> {
  const root = MAC ? b.mac : b.linux;
  if (!root || !(await exists(root))) return [];
  const dirs: string[] = [];
  for (const d of (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && (d.name === "Default" || /^Profile \d+$/.test(d.name))).map((d) => d.name).sort()) {
    if (await exists(`${root}/${d}/${file}`)) dirs.push(d);
  }
  const names = await chromeProfileNames(root);
  return dirs.map((dir) => ({ dir: `${root}/${dir}`, section: dirs.length > 1 ? `${b.title} (${names.get(dir) ?? dir})` : b.title }));
}

/** Firefox's profiles, the ones holding `places.sqlite`; the directory is `<random>.<name>` and the name is what Firefox shows. */
export async function firefoxProfiles(b: Firefox): Promise<Profile[]> {
  const root = MAC ? b.mac : b.linux;
  if (!(await exists(root))) return [];
  const dirs: string[] = [];
  for (const dir of (await readdir(root).catch(() => [])).sort()) if (await exists(`${root}/${dir}/places.sqlite`)) dirs.push(dir);
  return dirs.map((dir) => ({ dir: `${root}/${dir}`, section: dirs.length > 1 ? `${b.title} (${dir.replace(/^[^.]*\./, "")})` : b.title }));
}

/**
 * A copy of a SQLite file the browser holds locked, under the cache
 * directory, named by the source path, re-copied when the source's mtime
 * moved and at most every `minMs` (a keystroke-driven listing must not
 * copy a 100 MB history on every letter). Returns the copy's path.
 */
const copies = new Map<string, { at: number; mtime: number }>();
export async function copied(src: string, minMs = 0): Promise<string> {
  const target = join(CACHE, `${Bun.hash(src).toString(36)}-${src.slice(src.lastIndexOf("/") + 1)}`);
  const last = copies.get(src);
  const now = Date.now();
  if (last && now - last.at < minMs) return target;
  const mtime = (await stat(src)).mtimeMs;
  if (!last || last.mtime !== mtime || !(await exists(target))) {
    await mkdir(CACHE, { recursive: true });
    await copyFile(src, target);
  }
  copies.set(src, { at: now, mtime });
  return target;
}

export const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

/** The url in that browser: `open -a` on macOS, the browser's command on Linux (a missing one throws with its name). */
export function openIn(url: string, app: string) {
  if (MAC) return spawnDetached(["open", "-a", app, url]);
  const bin = Object.values(BROWSERS).map((b) => ("bin" in b && b.app === app ? b.bin : "")).find(Boolean);
  if (!bin || !Bun.which(bin)) throw new Error(`${app} is not on PATH`);
  spawnDetached([bin, url]);
}
