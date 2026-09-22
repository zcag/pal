// Turkish text tools: an input palette whose rows are what you typed (or,
// with nothing typed, the selection in the app in front, else the
// clipboard) converted five ways: deasciified (`Turkce` → `Türkçe`, the
// pattern-table algorithm from Emacs turkish-mode), asciified, and the
// three Turkish cases. Enter pastes the row into the app in front (over a
// selection that is what the rows came from, so it replaces it), cmd+c
// copies. `pal://turkish/<conversion>?text=…` does the same for a script
// or a keybind, and without `text` converts the selection. The
// conversions are `turkish.ts`.
import { hint, settings, textAtHand, toast, truncate, oneLine, type Action, type Detail, type Effect, type Extension, type Item, type LinkParams } from "@zcag/pal";
import { ABOUT, changed, CONVERSIONS, convert, TITLES, type Conversion } from "./turkish.ts";

/** `[extensions.turkish]`, defaults in pal.json. */
type Settings = { primary_action: "paste" | "copy" };

/** Material Design glyphs from the bundled Nerd Font; the tile's red tints them. */
const GLYPH: Record<Conversion, string> = { deasciify: "\u{f0b34}", asciify: "\u{f002c}", upper: "\u{f0b36}", lower: "\u{f0b35}", title: "\u{f05f4}" };
const G = { text: "\u{f09a8}", cursor: "\u{f05e7}", info: "\u{f02fd}" } as const;
/** Longer than this and the deasciifier's per-character context lookups take a noticeable while on every keystroke. */
export const MAX_CHARS = 20_000;

const PASTE: Action = { id: "paste", title: "Paste" };
const COPY: Action = { id: "copy", title: "Copy", shortcut: "cmd+c" };
const TRANSLATE: Action = { id: "translate", title: "Translate", shortcut: "cmd+t" };
const COPY_SOURCE: Action = { id: "copy-source", title: "Copy the source text", shortcut: "cmd+shift+c" };

const S = () => settings.get<Settings>();

/** A row's texts for `pick`, by conversion; the listing that made them is the one the pick comes from. */
const held = new Map<string, { text: string; source: string }>();

/** Typed text as it is; nothing typed: the selection, else the clipboard (`textAtHand`, read once per 2 s). */
async function source(typed: string): Promise<{ text: string; where: "typed" | "selection" | "clipboard" } | undefined> {
  if (typed) return { text: typed, where: "typed" };
  return (await textAtHand()) ?? undefined;
}

const detail = (kind: Conversion, out: string, src: string, where: string, n: number): Detail => ({
  markdown: `${out}\n\n---\n\n${src}`,
  metadata: [
    { label: "Conversion", value: `${TITLES[kind]}: ${ABOUT[kind]}` },
    { label: "Changed", value: n ? `${n} ${n === 1 ? "character" : "characters"}` : "nothing" },
    { label: "Length", value: `${src.length} characters` },
    { label: "Source", value: where === "typed" ? "Typed" : where === "selection" ? "The selection in the app in front" : "The clipboard" },
  ],
});

async function list(query = ""): Promise<Item[]> {
  const src = await source(query.slice(0, MAX_CHARS));
  if (!src) {
    return [
      hint("type", "Type Turkish written without its letters", "Turkce yazilmis bir cumle → Türkçe yazılmış bir cümle", { icon: GLYPH.deasciify }),
      hint("select", "Or select text in the app in front and open the palette", "The rows then act on the selection and Enter replaces it", { icon: G.cursor }),
      hint("cases", "Also the reverse, and the Turkish cases", "asciify · UPPERCASE (i → İ) · lowercase (I → ı) · Title Case", { icon: G.text }),
    ];
  }
  const whence = src.where === "typed" ? "" : src.where === "selection" ? " · from the selection, Enter replaces it" : " · from the clipboard";
  const primary = S().primary_action === "copy" ? [COPY, PASTE] : [PASTE, COPY];
  held.clear();
  const rows: Item[] = [];
  for (const kind of CONVERSIONS) {
    const out = await convert(kind, src.text);
    const n = changed(src.text, out);
    held.set(kind, { text: out, source: src.text });
    rows.push({
      id: kind,
      name: truncate(oneLine(out), 120) || " ",
      subtitle: `${TITLES[kind]} · ${ABOUT[kind]}${whence}`,
      icon: GLYPH[kind],
      keywords: [kind, TITLES[kind]],
      accessories: n ? [{ text: `${n} changed` }] : [{ tag: "unchanged", color: "grey" }],
      detail: detail(kind, out, src.text, src.where, n),
      actions: [...primary, TRANSLATE, COPY_SOURCE],
    });
  }
  if (src.text.length >= MAX_CHARS) rows.push(hint("cut", `Only the first ${MAX_CHARS} characters are converted`, "Split a longer text, or convert it in pieces", { icon: G.info }));
  return rows;
}

function pick(id: string, action?: string): Effect {
  const h = held.get(id);
  if (!h) return toast("The rows changed", "Pick again", "failure");
  switch (action) {
    case "copy": return { copy: h.text };
    case "copy-source": return { copy: h.source };
    case "translate": return { push: { extension: "translate", palette: "translate", query: h.text } };
    case "paste": return { paste: { text: h.text } };
    default: return S().primary_action === "copy" ? { copy: h.text } : { paste: { text: h.text } };
  }
}

/** `pal://turkish/<conversion>?text=…&paste=1`: the text (else the selection, else the clipboard) converted, copied or pasted. */
async function link(route: string, params: LinkParams): Promise<Effect | void> {
  if (!CONVERSIONS.includes(route as Conversion)) return;
  const kind = route as Conversion;
  const given = params.text === undefined ? undefined : String(params.text);
  const src = given !== undefined ? { text: given, where: "typed" as const } : await textAtHand();
  if (!src) throw new Error("no text: nothing given, selected or on the clipboard");
  const out = await convert(kind, src.text.slice(0, MAX_CHARS));
  // Pasting over the selection the text came from replaces it; from the clipboard or a given text, the default is a copy.
  const paste = params.paste === undefined ? src.where === "selection" : !!params.paste;
  return paste ? { paste: { text: out } } : { copy: out, hud: `${TITLES[kind]}, copied` };
}

export default {
  link,
  palettes: {
    turkish: {
      title: "Turkish",
      input: true,
      placeholder: "Turkce yazilmis bir cumle, or select text first",
      list,
      pick,
    },
  },
} satisfies Extension;

