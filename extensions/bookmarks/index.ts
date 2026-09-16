// Hand-picked links from a JSON file of {name, url, keywords?, ...}: open
// the url, or copy it. Same data file as v1's bookmarks palette.
import type { Extension, Item } from "../../host/src/protocol.ts";
import { settings } from "../../host/src/api.ts";

type Row = { name: string; url: string; subtitle?: string; icon?: string; keywords?: string[] };

/** `[extensions.bookmarks] file`, default in pal.json; `~` expanded. */
const file = () => String(settings.get<{ file?: string }>().file ?? "~/.config/pal/data/bookmarks.json").replace(/^~(?=\/|$)/, process.env.HOME ?? "");

async function rows(): Promise<Row[]> {
  return Bun.file(file()).json();
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
          actions: [{ id: "open", title: "Open in browser" }, { id: "copy", title: "Copy link", shortcut: "cmd+c" }],
        })),
      pick: (id, action) => (action === "copy" ? { copy: id } : { open: id }),
    },
  },
} satisfies Extension;
