// Bookmarks: the hand-picked JSON file (rows of `{name, url, subtitle?, icon?, keywords?}`),
// plus what the installed browsers keep. Chrome and its relatives are one
// `Bookmarks` JSON per profile; Safari is a binary plist read through
// `plutil` (and needs Full Disk Access, so a refusal is a hint row);
// Firefox is `places.sqlite`, copied first because the running browser
// holds it locked. Every source is read on every list, so an edit shows
// at once. Rows are deduplicated by url, the first source wins; the
// section is the browser (and profile), the folder path an accessory.
// A second palette, `history` (history.ts), searches the same browsers'
// visit history; browsers.ts is what the two share.
import { errorMessage, failed, hint, home, settings, xdg, type Action, type Extension, type Item } from "@zcag/pal";
import { BROWSERS, HOME, MAC, chromiumProfiles, copied, exists, firefoxProfiles, openIn, spawnDetached, type Firefox } from "./browsers.ts";
import { historyPalette } from "./history.ts";
import { bareUrl, chromeBookmarks, excludedFolder, firefoxBookmarks, markdownLink, parsePlist, safariBookmarks, titleOf, type FirefoxRow, type Found } from "./sources.ts";

/** `[extensions.bookmarks]`, defaults in pal.json. */
type Settings = { file: string; browsers: string[]; exclude_folders: string[] };
type Row = { name?: string; url?: string; subtitle?: string; icon?: string; keywords?: string[] };

// Open works on marked rows too (`multi`): every one in a tab of the default browser.
const OPEN: Action = { id: "open", title: "Open in browser", multi: true };
const COPY: Action = { id: "copy", title: "Copy link", shortcut: "cmd+c" };
const COPY_MD: Action = { id: "copy-markdown", title: "Copy as markdown", shortcut: "cmd+shift+c" };

// ---- browsers --------------------------------------------------------------

/** One source's rows: the section they list under, and how to open a url in that browser. */
type Source = { section: string; browser?: string; found: Found[] };
type Problem = { name: string; subtitle: string };

/** Every profile's `Bookmarks` JSON. */
async function readChromium(b: Extract<typeof BROWSERS[string], { kind: "chromium" }>): Promise<Source[]> {
  const sources: Source[] = [];
  for (const p of await chromiumProfiles(b, "Bookmarks")) {
    const json = await Bun.file(`${p.dir}/Bookmarks`).json().catch(() => undefined);
    if (json) sources.push({ section: p.section, browser: b.app, found: chromeBookmarks(json) });
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

/** `places.sqlite`, copied first (the running browser holds the lock; the copy follows the file's mtime), then one query over folders and bookmarks. */
async function readFirefox(b: Firefox): Promise<Source[]> {
  const { Database } = await import("bun:sqlite");
  const sources: Source[] = [];
  for (const p of await firefoxProfiles(b)) {
    const db = `${p.dir}/places.sqlite`;
    try {
      const d = new Database(await copied(db), { readonly: true });
      try {
        const rows = d.query<FirefoxRow, []>("SELECT b.id, b.parent, b.type, b.title, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON b.fk = p.id").all();
        sources.push({ section: p.section, browser: b.app, found: firefoxBookmarks(rows) });
      } finally { d.close(); }
    } catch (e) {
      console.error(`[bookmarks] firefox ${db}: ${errorMessage(e)}`);
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

/** The file's rows; a file that is not there is no rows (the browsers still list), one that will not parse is a hint row. */
async function fileRows(): Promise<{ rows: Row[]; problem?: Problem }> {
  const file = home(settings.get<Settings>().file);
  if (!(await exists(file))) return { rows: [] };
  try {
    const data = await Bun.file(file).json();
    if (!Array.isArray(data)) throw new Error("expected a JSON array of {name, url}");
    return { rows: data };
  } catch (e) {
    return { rows: [], problem: { name: `Could not read ${file.slice(file.lastIndexOf("/") + 1)}`, subtitle: `${errorMessage(e).split("\n")[0]}: fix the file or point the file setting elsewhere` } };
  }
}

// ---- rows ----------------------------------------------------------------

/** What a pick needs per url, from the last listing: the name for a markdown link, the browser for Open in. */
const known = new Map<string, { name: string; browser?: string }>();

async function list(): Promise<Item[]> {
  const s = settings.get<Settings>();
  const seen = new Set<string>();
  const items: Item[] = [];
  known.clear();
  const file = await fileRows();
  // The file's rows sit under the file's name: a headless group above the browsers' sections read as a mistake.
  const section = s.file.slice(s.file.lastIndexOf("/") + 1);
  if (file.problem) items.push(hint(file.problem.name, file.problem.name, file.problem.subtitle, { icon: xdg("dialog-warning")!, section }));
  for (const r of file.rows) {
    if (typeof r.url !== "string" || !r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    const name = titleOf(r.name, r.url);
    known.set(r.url, { name });
    // The file's rows take the palette's three actions (said once); a browser's rows below add "Open in <browser>" and so say their own. A nameless bookmark is named by its address and says nothing twice.
    items.push({ id: r.url, name, subtitle: r.subtitle ?? (name === bareUrl(r.url) ? undefined : r.url), icon: r.icon?.trim() || undefined, keywords: r.keywords, url: r.url, section });
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
        subtitle: f.name === bareUrl(f.url) ? undefined : f.url,
        keywords: [...new Set(f.folder.filter(Boolean))],
        url: f.url,
        accessories: f.folder.length ? [{ text: f.folder.join(" / ") }] : [],
        section: src.section,
        actions: [OPEN, COPY, COPY_MD, ...(src.browser ? [{ id: "open-in", title: `Open in ${src.section.replace(/ \(.*\)$/, "")}` }] : [])],
      });
    }
  }
  for (const p of problems) items.push(hint(p.name, p.name, p.subtitle, { icon: xdg("dialog-warning")!, section: "Safari" }));
  return items;
}

export default {
  palettes: {
    bookmarks: {
      title: "Bookmarks",
      placeholder: "A name, a folder or a keyword",
      actions: [OPEN, COPY, COPY_MD],
      list,
      pick: async (id, action, ctx) => {
        // A pick on a row restored from the persisted index, before this run has listed.
        if (!known.has(id) && (action === "copy-markdown" || action === "open-in")) await list();
        // A multi pick's marked urls: all but the first through the opener here, the first as the effect (one url each).
        if (ctx?.ids && ctx.ids.length > 1 && (action === "open" || action === undefined)) {
          for (const url of ctx.ids.slice(1)) spawnDetached([MAC ? "open" : "xdg-open", url]);
        }
        switch (action) {
          case "copy": return { copy: id };
          case "copy-markdown": return { copy: markdownLink(known.get(id)?.name ?? id, id) };
          case "open-in": {
            const app = known.get(id)?.browser;
            if (!app) return { open: id };
            try { openIn(id, app); } catch (e) { return failed(`open in ${app}`, e); }
            return { hide: true };
          }
          default: return { open: id };
        }
      },
    },
    history: historyPalette,
  },
} satisfies Extension;
