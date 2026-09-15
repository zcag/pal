// Hand-picked links from a JSON file of {name, url, keywords?, ...}; pick
// opens the url. Same data file as v1's bookmarks palette.
import type { Extension, Item } from "../../host/src/protocol.ts";

const FILE = `${process.env.HOME}/.config/pal/data/bookmarks.json`;

type Row = { name: string; url: string; subtitle?: string; icon?: string; keywords?: string[] };

async function rows(): Promise<Row[]> {
  return Bun.file(FILE).json();
}

export default {
  palettes: {
    bookmarks: {
      title: "Bookmarks",
      list: async (): Promise<Item[]> =>
        (await rows()).map((r) => ({
          id: r.url,
          name: r.name,
          subtitle: r.subtitle ?? r.url,
          icon: r.icon?.trim() || undefined,
          keywords: r.keywords,
          url: r.url,
        })),
      pick: (id) => {
        Bun.spawn(["open", id]);
        return { opened: id };
      },
    },
  },
} satisfies Extension;
