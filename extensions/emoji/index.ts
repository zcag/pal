// Emoji picker over data.json ({emoji, name, keywords, category, skin?}[];
// names are shortcodes, categories Unicode's groups, `skin` marks an emoji
// a skin tone modifier applies to): a grid inside, tiles are the glyphs,
// in a Recently used section first and then one section per category.
// Copy or paste the emoji (with the `skin_tone` setting applied where it
// can be), or copy its :shortcode:. Your own search words per emoji come
// from the `keywords` setting (`rocket: ship deploy`). Live with a ttl: the order is ours
// (recents from storage, then categories), never frecency's, and a show
// lists again once the listing is `ttl` old, so the recents follow.
import { settings, storage, type Action, type Extension, type Item } from "@zcag/pal";
import data from "./data.json";
import { withSkinTone, type SkinTone } from "./skin.ts";

type Row = { emoji: string; name: string; keywords: string[]; category: string; skin?: boolean };
/** `[palettes.emoji]`, default in pal.json. */
type PaletteSettings = { columns: number };
/** `[extensions.emoji]`, defaults in pal.json. */
type Settings = { skin_tone: SkinTone; paste_by_default: boolean; keywords: string[] };

/** Unicode's group order, the sections' order. */
const CATEGORIES = ["Smileys & Emotion", "People & Body", "Animals & Nature", "Food & Drink", "Travel & Places", "Activities", "Objects", "Symbols", "Flags"];
const RECENT = "recent";
const RECENT_MAX = 24;
const SECTION_RECENT = "Recently used";

const rows = data as Row[];
const byEmoji = new Map(rows.map((r) => [r.emoji, r]));
const order = new Map(CATEGORIES.map((c, i) => [c, i]));
const sorted = [...rows].sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99));

/**
 * The `keywords` setting as words per emoji: a line is `rocket: ship
 * deploy` or `🚀: ship, deploy` (a shortcode or the emoji itself, a
 * colon, then words split on spaces and commas); a line naming no emoji
 * in the list, or with no words, is ignored. Parsed once per settings
 * value (the lines are compared by identity of the joined text).
 */
function customKeywords(lines: unknown, byName: Map<string, Row>, byEmojiChar: Map<string, Row>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!Array.isArray(lines)) return out;
  for (const line of lines) {
    if (typeof line !== "string") continue;
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().replace(/^:|:$/g, "");
    const words = line.slice(i + 1).split(/[\s,]+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
    const row = byEmojiChar.get(key) ?? byName.get(key.toLowerCase());
    if (!row || !words.length) continue;
    out.set(row.emoji, [...(out.get(row.emoji) ?? []), ...words.filter((w) => !row.keywords.includes(w))]);
  }
  return out;
}
const byName = new Map(rows.map((r) => [r.name, r]));
let custom: { key: string; words: Map<string, string[]> } = { key: "", words: new Map() };
const customFor = (s: Settings) => {
  const key = (Array.isArray(s.keywords) ? s.keywords : []).join("\n");
  if (custom.key !== key) custom = { key, words: customKeywords(s.keywords, byName, byEmoji) };
  return custom.words;
};

const actions = (s: Settings): Action[] => {
  const copy: Action = { id: "copy", title: "Copy emoji" };
  const paste: Action = { id: "paste", title: "Paste emoji" };
  return [...(s.paste_by_default ? [paste, copy] : [copy, paste]), { id: "shortcode", title: "Copy shortcode", shortcut: "cmd+shift+c" }];
};

function item(r: Row, s: Settings, section: string, extra: Map<string, string[]>): Item {
  return {
    id: r.emoji,
    name: r.name.replace(/_/g, " "),
    icon: withSkinTone(r.emoji, s.skin_tone, !!r.skin),
    keywords: [r.name, `:${r.name}:`, ...r.keywords, ...(extra.get(r.emoji) ?? [])],
    section,
    actions: actions(s),
  };
}

const recents = async () => ((await storage.get<string[]>(RECENT)) ?? []).filter((e) => byEmoji.has(e));

async function list(): Promise<Item[]> {
  const s = settings.get<Settings>();
  const recent = await recents();
  const seen = new Set(recent);
  const extra = customFor(s);
  return [
    ...recent.map((e) => item(byEmoji.get(e)!, s, SECTION_RECENT, extra)),
    ...sorted.filter((r) => !seen.has(r.emoji)).map((r) => item(r, s, r.category, extra)),
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
      view: "grid",
      live: true,
      placeholder: "Name, keyword or :shortcode:",
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
