// Emoji picker over data.json ({emoji, name, keywords}[], names are
// shortcodes): a grid inside, tiles are the glyphs; copy the emoji, or its
// :shortcode:.
import type { Extension, Item } from "../../host/src/protocol.ts";
import data from "./data.json";

type Row = { emoji: string; name: string; keywords: string[] };

const items: Item[] = (data as Row[]).map((r) => ({
  id: r.emoji,
  name: r.name.replace(/_/g, " "),
  icon: r.emoji,
  keywords: [r.name, ...r.keywords],
  actions: [
    { id: "copy", title: "Copy emoji" },
    { id: "shortcode", title: "Copy shortcode", shortcut: "cmd+shift+c" },
  ],
}));
const shortcode = new Map((data as Row[]).map((r) => [r.emoji, `:${r.name}:`]));

export default {
  palettes: {
    emoji: {
      title: "Emoji",
      icon: "😀",
      view: "grid",
      columns: 10,
      list: () => items,
      pick: (id, action) => ({ copy: action === "shortcode" ? shortcode.get(id) ?? id : id }),
    },
  },
} satisfies Extension;
