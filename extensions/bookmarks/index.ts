// Bookmarks: the hand-picked JSON file (same data file as v1's palette),
// plus what the installed browsers keep. Chrome and its relatives are one
// `Bookmarks` JSON per profile; Safari is a binary plist read through
// `plutil` (and needs Full Disk Access, so a refusal is a hint row);
// Firefox is `places.sqlite`, copied first because the running browser
// holds it locked. Every source is read on every list, so an edit shows
// at once. Rows are deduplicated by url, the first source wins; the
// section is the browser (and profile), the folder path an accessory.
import { copyFile, readdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { home, settings, type Action, type Extension, type Item } from "@zcag/pal";
import { chromeBookmarks, excludedFolder, firefoxBookmarks, markdownLink, parsePlist, safariBookmarks, type FirefoxRow, type Found } from "./sources.ts";

/** `[extensions.bookmarks]`, defaults in pal.json. */
type Settings = { file: string; browsers: string[]; exclude_folders: string[] };
type Row = { name?: string; url?: string; subtitle?: string; icon?: string; keywords?: string[] };

const MAC = process.platform === "darwin";
/** Tests point the profile roots at a temp home. */
const HOME = process.env.PAL_BOOKMARKS_HOME || home("~");
const APP_SUPPORT = `${HOME}/Library/Application Support`;
const ICON = "🔖";

const OPEN: Action = { id: "open", title: "Open in browser" };
const COPY: Action = { id: "copy", title: "Copy link", shortcut: "cmd+c" };
const COPY_MD: Action = { id: "copy-markdown", title: "Copy as markdown", shortcut: "cmd+shift+c" };

// ---- browsers --------------------------------------------------------------

type Chromium = { kind: "chromium"; title: string; mac: string; linux: string; app: string; bin: string };
type Browser = Chromium | { kind: "safari"; title: string; app: string } | { kind: "firefox"; title: string; mac: string; linux: string; app: string; bin: string };

/** The `browsers` setting's ids; `mac`/`linux` are the profile roots under the home. */
const BROWSERS: Record<string, Browser> = {
  chrome: { kind: "chromium", title: "Chrome", mac: `${APP_SUPPORT}/Google/Chrome`, linux: `${HOME}/.config/google-chrome`, app: "Google Chrome", bin: "google-chrome" },
  chromium: { kind: "chromium", title: "Chromium", mac: `${APP_SUPPORT}/Chromium`, linux: `${HOME}/.config/chromium`, app: "Chromium", bin: "chromium" },
  brave: { kind: "chromium", title: "Brave", mac: `${APP_SUPPORT}/BraveSoftware/Brave-Browser`, linux: `${HOME}/.config/BraveSoftware/Brave-Browser`, app: "Brave Browser", bin: "brave" },
  edge: { kind: "chromium", title: "Edge", mac: `${APP_SUPPORT}/Microsoft Edge`, linux: `${HOME}/.config/microsoft-edge`, app: "Microsoft Edge", bin: "microsoft-edge" },
  vivaldi: { kind: "chromium", title: "Vivaldi", mac: `${APP_SUPPORT}/Vivaldi`, linux: `${HOME}/.config/vivaldi`, app: "Vivaldi", bin: "vivaldi" },
  arc: { kind: "chromium", title: "Arc", mac: `${APP_SUPPORT}/Arc/User Data`, linux: "", app: "Arc", bin: "" },
  safari: { kind: "safari", title: "Safari", app: "Safari" },
  firefox: { kind: "firefox", title: "Firefox", mac: `${APP_SUPPORT}/Firefox/Profiles`, linux: `${HOME}/.mozilla/firefox`, app: "Firefox", bin: "firefox" },
};

/** One source's rows: the section they list under, and how to open a url in that browser. */
type Source = { section: string; browser?: string; found: Found[] };
type Problem = { name: string; subtitle: string };

const exists = (p: string) => stat(p).then(() => true, () => false);

/** Chrome's profile names from `Local State`, by profile directory; the directory name otherwise. */
async function chromeProfiles(root: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const state = await Bun.file(`${root}/Local State`).json().catch(() => undefined);
  const cache = (state as { profile?: { info_cache?: Record<string, { name?: string }> } } | undefined)?.profile?.info_cache ?? {};
  for (const [dir, info] of Object.entries(cache)) if (info?.name) names.set(dir, info.name);
  return names;
}

async function readChromium(b: Chromium): Promise<Source[]> {
  const root = MAC ? b.mac : b.linux;
  if (!root || !(await exists(root))) return [];
  const dirs = (await readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory() && (d.name === "Default" || /^Profile \d+$/.test(d.name))).map((d) => d.name).sort();
  const names = await chromeProfiles(root);
  const sources: Source[] = [];
  for (const dir of dirs) {
    const json = await Bun.file(`${root}/${dir}/Bookmarks`).json().catch(() => undefined);
    if (!json) continue;
    const section = dirs.length > 1 ? `${b.title} (${names.get(dir) ?? dir})` : b.title;
    sources.push({ section, browser: b.app, found: chromeBookmarks(json) });
  }
  return sources;
}

/** `plutil` prints the XML form of the binary plist; a permission refusal is Full Disk Access missing. */
async function readSafari(): Promise<{ sources: Source[]; problem?: Problem }> {
  const file = `${HOME}/Library/Safari/Bookmarks.plist`;
  if (!MAC) return { sources: [] };
  const proc = Bun.spawn(["plutil", "-convert", "xml1", "-o", "-", file], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, xml, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if (code !== 0) {
    if (/permission|not permitted|operation not permitted/i.test(err)) return { sources: [], problem: { name: "Safari bookmarks need Full Disk Access", subtitle: "System Settings > Privacy & Security > Full Disk Access: add pal" } };
    return { sources: [] }; // no Safari bookmarks file
  }
  return { sources: [{ section: "Safari", browser: "Safari", found: safariBookmarks(parsePlist(xml)) }] };
}

/** `places.sqlite`, copied first (the running browser holds the lock), then one query over folders and bookmarks. */
async function readFirefox(b: Browser & { kind: "firefox" }): Promise<Source[]> {
  const root = MAC ? b.mac : b.linux;
  if (!(await exists(root))) return [];
  const { Database } = await import("bun:sqlite");
  const dirs: string[] = [];
  for (const dir of (await readdir(root).catch(() => [])).sort()) if (await exists(`${root}/${dir}/places.sqlite`)) dirs.push(dir);
  const sources: Source[] = [];
  for (const dir of dirs) {
    const db = `${root}/${dir}/places.sqlite`;
    const copy = join(tmpdir(), `pal-places-${process.pid}.sqlite`);
    try {
      await copyFile(db, copy);
      const d = new Database(copy, { readonly: true });
      try {
        const rows = d.query<FirefoxRow, []>("SELECT b.id, b.parent, b.type, b.title, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id").all();
        // The profile directory is `<random>.<name>`; the name is what Firefox shows.
        sources.push({ section: dirs.length > 1 ? `${b.title} (${dir.replace(/^[^.]*\./, "")})` : b.title, browser: b.app, found: firefoxBookmarks(rows) });
      } finally { d.close(); }
    } catch (e) {
      console.error(`bookmarks: firefox ${db}: ${e instanceof Error ? e.message : e}`);
    } finally {
      await unlink(copy).catch(() => {});
    }
  }
  return sources;
}

async function browserSources(ids: string[]): Promise<{ sources: Source[]; problems: Problem[] }> {
  const sources: Source[] = [], problems: Problem[] = [];
  for (const id of ids) {
    const b = BROWSERS[id];
    if (!b) continue;
    if (b.kind === "chromium") sources.push(...(await readChromium(b)));
    else if (b.kind === "firefox") sources.push(...(await readFirefox(b)));
    else { const r = await readSafari(); sources.push(...r.sources); if (r.problem) problems.push(r.problem); }
  }
  return { sources, problems };
}

// ---- the file ------------------------------------------------------------

async function fileRows(): Promise<Row[]> {
  const file = home(settings.get<Settings>().file);
  const data = await Bun.file(file).json();
  if (!Array.isArray(data)) throw new Error(`${file}: expected a JSON array of {name, url}`);
  return data;
}

// ---- rows ----------------------------------------------------------------

/** What a pick needs per url, from the last listing: the name for a markdown link, the browser for Open in. */
const known = new Map<string, { name: string; browser?: string }>();

async function list(): Promise<Item[]> {
  const s = settings.get<Settings>();
  const seen = new Set<string>();
  const items: Item[] = [];
  known.clear();
  for (const r of await fileRows()) {
    if (typeof r.url !== "string" || !r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    known.set(r.url, { name: r.name ?? r.url });
    items.push({ id: r.url, name: r.name ?? r.url, subtitle: r.subtitle ?? r.url, icon: r.icon?.trim() || undefined, keywords: r.keywords, url: r.url, actions: [OPEN, COPY, COPY_MD] });
  }
  const { sources, problems } = await browserSources(s.browsers);
  for (const src of sources) {
    for (const f of src.found) {
      if (excludedFolder(f.folder, s.exclude_folders) || seen.has(f.url)) continue;
      seen.add(f.url);
      known.set(f.url, { name: f.name, browser: src.browser });
      items.push({
        id: f.url,
        name: f.name,
        subtitle: f.url,
        keywords: [...new Set(f.folder.filter(Boolean))],
        url: f.url,
        accessories: f.folder.length ? [{ text: f.folder.join(" / ") }] : [],
        section: src.section,
        actions: [OPEN, COPY, COPY_MD, ...(src.browser ? [{ id: "open-in", title: `Open in ${src.section.replace(/ \(.*\)$/, "")}` }] : [])],
      });
    }
  }
  for (const p of problems) items.push({ id: `hint:${p.name}`, name: p.name, subtitle: p.subtitle, icon: ICON, section: "Safari", actions: [] });
  return items;
}

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

function openIn(url: string, app: string) {
  if (MAC) return spawnDetached(["open", "-a", app, url]);
  const bin = Object.values(BROWSERS).map((b) => ("bin" in b && b.app === app ? b.bin : "")).find(Boolean);
  if (!bin || !Bun.which(bin)) throw new Error(`${app} is not on PATH`);
  spawnDetached([bin, url]);
}

export default {
  palettes: {
    bookmarks: {
      title: "Bookmarks",
      list,
      pick: async (id, action) => {
        // A pick on a row restored from the persisted index, before this run has listed.
        if (!known.has(id) && (action === "copy-markdown" || action === "open-in")) await list();
        switch (action) {
          case "copy": return { copy: id };
          case "copy-markdown": return { copy: markdownLink(known.get(id)?.name ?? id, id) };
          case "open-in": {
            const app = known.get(id)?.browser;
            if (!app) return { open: id };
            try { openIn(id, app); } catch (e) { return { keep: true, toast: { title: `Could not open in ${app}`, message: String((e as Error)?.message ?? e), style: "failure" } }; }
            return { hide: true };
          }
          default: return { open: id };
        }
      },
    },
  },
} satisfies Extension;
