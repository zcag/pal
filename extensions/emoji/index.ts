// Emoji picker over data.json ({emoji, name, keywords, category, skin?}[];
// names are shortcodes, categories Unicode's groups, `skin` marks an emoji
// a skin tone modifier applies to): a grid inside, tiles are the glyphs,
// in a Recently used section first and then one section per category.
// Copy or paste the emoji (with the `skin_tone` setting applied where it
// can be), or copy its :shortcode:. Live with a ttl: the order is ours
// (recents from storage, then categories), never frecency's, and a show
// lists again once the listing is `ttl` old, so the recents follow.
import { settings, storage, type Action, type Extension, type Item } from "@zcag/pal";
import data from "./data.json";
import { withSkinTone, type SkinTone } from "./skin.ts";

type Row = { emoji: string; name: string; keywords: string[]; category: string; skin?: boolean };
/** `[palettes.emoji]`, default in pal.json. */
type PaletteSettings = { columns: number };
/** `[extensions.emoji]`, defaults in pal.json. */
type Settings = { skin_tone: SkinTone; paste_by_default: boolean };

/** Unicode's group order, the sections' order. */
const CATEGORIES = ["Smileys & Emotion", "People & Body", "Animals & Nature", "Food & Drink", "Travel & Places", "Activities", "Objects", "Symbols", "Flags"];
const RECENT = "recent";
const RECENT_MAX = 24;
const SECTION_RECENT = "Recently used";
/** Seconds a listing stays good for: a show past this lists again, so a used emoji reaches the recents. */
const TTL = 30;

const rows = data as Row[];
const byEmoji = new Map(rows.map((r) => [r.emoji, r]));
const order = new Map(CATEGORIES.map((c, i) => [c, i]));
const sorted = [...rows].sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99));

const actions = (s: Settings): Action[] => {
  const copy: Action = { id: "copy", title: "Copy emoji" };
  const paste: Action = { id: "paste", title: "Paste emoji" };
  return [...(s.paste_by_default ? [paste, copy] : [copy, paste]), { id: "shortcode", title: "Copy shortcode", shortcut: "cmd+shift+c" }];
};

function item(r: Row, s: Settings, section: string): Item {
  return {
    id: r.emoji,
    name: r.name.replace(/_/g, " "),
    icon: withSkinTone(r.emoji, s.skin_tone, !!r.skin),
    keywords: [r.name, `:${r.name}:`, ...r.keywords],
    section,
    actions: actions(s),
  };
}

const recents = async () => ((await storage.get<string[]>(RECENT)) ?? []).filter((e) => byEmoji.has(e));

async function list(): Promise<Item[]> {
  const s = settings.get<Settings>();
  const recent = await recents();
  const seen = new Set(recent);
  return [
    ...recent.map((e) => item(byEmoji.get(e)!, s, SECTION_RECENT)),
    ...sorted.filter((r) => !seen.has(r.emoji)).map((r) => item(r, s, r.category)),
  ];
}

/** The used emoji to the front of the recents, capped. */
async function remember(emoji: string) {
  const recent = await recents();
  await storage.set(RECENT, [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_MAX));
}

export default {
  palettes: {
    emoji: {
      title: "Emoji",
      icon: "😀",
      view: "grid",
      live: true,
      ttl: TTL,
      // Palette meta is read once at load, so a change here shows after
      // the extension reloads (a file edit, or Settings > Restart host).
      columns: settings.palette<PaletteSettings>("emoji").columns,
      list,
      pick: async (id, action) => {
        const r = byEmoji.get(id);
        if (action === "shortcode") return { copy: r ? `:${r.name}:` : id };
        const s = settings.get<Settings>();
        const text = r ? withSkinTone(r.emoji, s.skin_tone, !!r.skin) : id;
        if (r) await remember(id);
        const paste = action === "paste" || (action === undefined && s.paste_by_default);
        return paste ? { paste: { text } } : { copy: text };
      },
    },
  },
} satisfies Extension;
