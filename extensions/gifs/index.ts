// GIFs: an input grid over Giphy: trending while nothing is typed, a
// search 300 ms after the last key, each tile the GIF's small animated
// preview (downloaded once into the cache directory and sent as a data
// url, so the grid animates and the second look costs nothing).
// Enter downloads the GIF into the cache and puts the file on the
// clipboard (`copy_files`: it pastes as a picture), cmd+Enter copies the
// url, cmd+o opens the page, cmd+s saves it to Downloads, cmd+f keeps it
// in the Favourites palette (storage), which is a grid of its own with the
// same actions and Remove.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage, hint, home, settings, storage, toast, type Action, type Ctx, type Detail, type Effect, type Extension, type Item } from "@zcag/pal";
import { BACKEND_NAME, FETCH_MS, fileName, GifError, mimeOf, search, type Filter, type Gif } from "./backends.ts";

/** `[extensions.gifs]`, defaults in pal.json. */
type Settings = { giphy_api_key: string; content_filter: Filter; save_to: string };
type PaletteSettings = { columns: number };

/** Material Design glyphs from the bundled Nerd Font; the tile's pink tints them. */
const GLYPH = {
  gif: "\u{f0d78}", // md-file_gif_box
  trending: "\u{f0535}", // md-trending_up
  star: "\u{f04ce}", // md-star
  alert: "\u{f05d6}", // md-alert_circle_outline
  wait: "\u{f051f}", // md-timer_sand
  broom: "\u{f00e2}", // md-broom
};

const COPY: Action = { id: "copy", title: "Copy GIF" };
const COPY_URL: Action = { id: "copy_url", title: "Copy URL" };
const OPEN: Action = { id: "open", title: "Open in browser", shortcut: "cmd+o" };
const SAVE: Action = { id: "save", title: "Save to Downloads", shortcut: "cmd+s" };
const FAV: Action = { id: "fav", title: "Add to favourites", shortcut: "cmd+f" };
const UNFAV: Action = { id: "unfav", title: "Remove from favourites", shortcut: "cmd+d", style: "destructive" };
const CLEAR: Action = { id: "clear", title: "Clear favourites", style: "destructive", confirm: "Forget every favourite GIF?" };

const DEBOUNCE_MS = 300;
const CACHE_MAX = 100;
const FAV_MAX = 200;
const MAC = process.platform === "darwin";
const HOME = home("~");
/** Previews and downloaded GIFs; `PAL_GIFS_CACHE` for the tests. */
const CACHE = process.env.PAL_GIFS_CACHE || (MAC ? `${HOME}/Library/Caches/pal/gifs` : `${process.env.XDG_CACHE_HOME || `${HOME}/.cache`}/pal/gifs`);

const S = () => settings.get<Settings>();
const SOURCE = BACKEND_NAME.giphy;

// ---- files -----------------------------------------------------------------------

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 20);

/** `url` fetched into `<CACHE>/<file>` once; the path, or undefined when the fetch failed. */
async function fetched(url: string, file: string): Promise<string | undefined> {
  const path = join(CACHE, file);
  if (await Bun.file(path).exists()) return path;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!res.ok) return;
    await mkdir(CACHE, { recursive: true });
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    return path;
  } catch (e) {
    console.error(`[gifs] ${url}: ${errorMessage(e)}`);
    return;
  }
}

const previews = new Map<string, string>();
/** The preview as a data url: the cache directory, then memory. */
async function preview(g: Gif): Promise<string | undefined> {
  const hit = previews.get(g.id);
  if (hit) return hit;
  const path = await fetched(g.preview, `${sha(g.preview)}-preview.gif`);
  if (!path) return;
  const bytes = await readFile(path);
  const url = `data:${mimeOf(bytes)};base64,${bytes.toString("base64")}`;
  if (previews.size > 500) previews.clear();
  previews.set(g.id, url);
  return url;
}

/** The full GIF in the cache, named after its title so a paste carries the name. */
const download = (g: Gif) => fetched(g.gif, `${sha(g.gif)}-${fileName(g)}`);

// ---- favourites --------------------------------------------------------------------

const FAVS = "favourites";
const isGif = (x: unknown): x is Gif => !!x && typeof x === "object" && typeof (x as Gif).id === "string" && typeof (x as Gif).gif === "string" && typeof (x as Gif).preview === "string";
const favourites = async (): Promise<Gif[]> => ((await storage.get<Gif[]>(FAVS)) ?? []).filter(isGif);

async function favour(g: Gif): Promise<void> {
  const list = (await favourites()).filter((f) => f.id !== g.id);
  await storage.set(FAVS, [g, ...list].slice(0, FAV_MAX));
}

// ---- rows ---------------------------------------------------------------------------

/** What the last listing showed, by id: `pick` needs the urls. */
const held = new Map<string, Gif>();
const size = (n?: number) => (n === undefined ? undefined : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

/** The pane shows the preview from its url (the webview loads http): the data url stays on the row alone, so the wire carries each preview once. */
const detailOf = (g: Gif): Detail => ({
  markdown: `![](${g.preview})\n\n**${g.title}**`,
  metadata: [
    { label: "Source", value: BACKEND_NAME[g.backend] },
    ...(g.width ? [{ label: "Size", value: `${g.width} × ${g.height}${g.size ? ` · ${size(g.size)}` : ""}` }] : []),
    { label: "Page", link: { text: g.page.replace(/^https?:\/\//, ""), href: g.page } },
  ],
});

async function item(g: Gif, actions: Action[]): Promise<Item> {
  held.set(g.id, g);
  const thumb = await preview(g);
  return { id: g.id, name: g.title, icon: thumb ? { image: thumb } : GLYPH.gif, keywords: [g.backend], detail: detailOf(g), actions };
}

const RESULT_ACTIONS = [COPY, COPY_URL, OPEN, SAVE, FAV];
const FAV_ACTIONS = [COPY, COPY_URL, OPEN, SAVE, UNFAV];

let seq = 0;
const cache = new Map<string, Gif[]>();

async function list(query = "", ctx?: Ctx): Promise<Item[]> {
  const s = S();
  const q = query.trim();
  const my = ++seq;
  if (q && !ctx?.inline) {
    await Bun.sleep(DEBOUNCE_MS);
    if (my !== seq) return [hint("wait", "Searching…", q, { icon: GLYPH.wait })];
  }
  const key = `${s.content_filter}|${q}`;
  try {
    let gifs = cache.get(key);
    if (!gifs) {
      gifs = await search(q, s.giphy_api_key ?? "", s.content_filter ?? "medium");
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, gifs);
    }
    if (my !== seq) return [hint("wait", "Searching…", q, { icon: GLYPH.wait })];
    if (!gifs.length) return [hint("none", `No GIFs for “${q}”`, SOURCE)];
    const rows = await Promise.all(gifs.map((g) => item(g, RESULT_ACTIONS)));
    if (!q) for (const r of rows) r.section = "Trending";
    return rows;
  } catch (e) {
    const ge = e instanceof GifError ? e : undefined;
    console.error(`[gifs] ${ge?.message ?? e}`);
    return [hint("failed", ge ? ge.hint : `Could not search: ${errorMessage(e)}`, q || SOURCE, { icon: GLYPH.alert })];
  }
}

async function act(g: Gif, action: string | undefined): Promise<Effect> {
  switch (action) {
    case "copy_url": return { copy: g.gif };
    case "open": return { open: g.page || g.gif };
    case "fav": await favour(g); return toast("Added to favourites", g.title);
    case "save": {
      const path = await download(g);
      if (!path) return toast("Could not download", g.gif, "failure");
      const dir = home(S().save_to?.trim() || "~/Downloads");
      await mkdir(dir, { recursive: true });
      const out = join(dir, fileName(g));
      await writeFile(out, await readFile(path));
      return { hud: `Saved ${fileName(g)}` };
    }
    default: {
      const path = await download(g);
      if (!path) return toast("Could not download", g.gif, "failure");
      return { copy_files: [path], hud: "Copied GIF" };
    }
  }
}

async function pick(id: string, action?: string): Promise<Effect> {
  const g = held.get(id);
  if (!g) return toast("GIF is gone", "The listing changed; pick again", "failure");
  return act(g, action);
}

// ---- favourites palette ----------------------------------------------------------------

async function favRows(): Promise<Item[]> {
  const list = await favourites();
  if (!list.length) return [hint("empty", "No favourites yet", "cmd+f on a GIF keeps it here", { icon: GLYPH.star })];
  const rows = await Promise.all(list.map((g) => item(g, FAV_ACTIONS)));
  rows.push({ id: "clear", name: "Clear favourites", subtitle: `${list.length} ${list.length === 1 ? "GIF" : "GIFs"}`, icon: GLYPH.broom, actions: [CLEAR] });
  return rows;
}

async function favPick(id: string, action?: string): Promise<Effect> {
  if (id === "clear") { await storage.remove(FAVS); return toast("Favourites cleared"); }
  const g = held.get(id) ?? (await favourites()).find((f) => f.id === id);
  if (!g) return toast("GIF is gone", undefined, "failure");
  if (action === "unfav") {
    await storage.set(FAVS, (await favourites()).filter((f) => f.id !== id));
    return toast("Removed", g.title);
  }
  return act(g, action);
}

export default {
  palettes: {
    gifs: {
      title: "GIFs",
      input: true,
      view: "grid",
      // Palette meta is read once at load, so a change here shows after the extension reloads.
      columns: settings.palette<PaletteSettings>("gifs").columns,
      placeholder: "Search GIFs (trending while empty)",
      fallback: "Search GIFs for “{query}”",
      list,
      pick,
    },
    favourites: {
      title: "Favourite GIFs",
      view: "grid",
      live: true,
      columns: settings.palette<PaletteSettings>("gifs").columns,
      placeholder: "Search your favourites",
      list: favRows,
      pick: favPick,
    },
  },
} satisfies Extension;
