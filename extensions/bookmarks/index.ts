// Hand-picked links from a JSON file of {name, url, keywords?, ...}: open
// the url, or copy it. Same data file as v1's bookmarks palette, read on
// every list so an edit shows at once.
import type { Action, Extension, Item } from "../../host/src/protocol.ts";
import { home, settings } from "../../host/src/api.ts";

/** `[extensions.bookmarks]`, default in pal.json. */
type Settings = { file: string };
type Row = { name?: string; url?: string; subtitle?: string; icon?: string; keywords?: string[] };

const ACTIONS: Action[] = [
  { id: "open", title: "Open in browser" },
  { id: "copy", title: "Copy link", shortcut: "cmd+c" },
];

async function rows(): Promise<Row[]> {
  const file = home(settings.get<Settings>().file);
  const data = await Bun.file(file).json();
  if (!Array.isArray(data)) throw new Error(`${file}: expected a JSON array of {name, url}`);
  return data;
}

export default {
  palettes: {
    bookmarks: {
      title: "Bookmarks",
      list: async (): Promise<Item[]> => {
        // The url is the id (frecency follows it); a second row with the same
        // url gets a NUL-separated ordinal, which no url can carry, so the ids stay unique.
        const seen = new Map<string, number>();
        return (await rows())
          .filter((r): r is Row & { url: string } => typeof r.url === "string" && r.url !== "")
          .map((r) => {
            const n = (seen.get(r.url) ?? 0) + 1;
            seen.set(r.url, n);
            return {
              id: n === 1 ? r.url : `${r.url}\0${n}`,
              name: r.name ?? r.url,
              subtitle: r.subtitle ?? r.url,
              icon: r.icon?.trim() || undefined,
              keywords: r.keywords,
              url: r.url,
              actions: ACTIONS,
            };
          });
      },
      pick: (id, action) => {
        const url = id.split("\0")[0];
        return action === "copy" ? { copy: url } : { open: url };
      },
    },
  },
} satisfies Extension;
