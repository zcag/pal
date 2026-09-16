// Skin tones as data: the Fitzpatrick modifiers and how one is applied to
// an emoji. Pure, so the tests need no host.

export type SkinTone = "none" | "light" | "medium-light" | "medium" | "medium-dark" | "dark";
/** The Fitzpatrick modifiers, U+1F3FB..U+1F3FF. */
const MODIFIER: Record<Exclude<SkinTone, "none">, string> = { light: "\u{1F3FB}", "medium-light": "\u{1F3FC}", medium: "\u{1F3FD}", "medium-dark": "\u{1F3FE}", dark: "\u{1F3FF}" };

/**
 * The modifier after the first code point (a following U+FE0F dropped: a
 * toned emoji is never text-styled), which tones a single person and the
 * first person of a ZWJ sequence. Two-person sequences (🧑‍🤝‍🧑) get one
 * tone on the first person only.
 */
export function withSkinTone(emoji: string, tone: SkinTone, modifiable: boolean): string {
  if (tone === "none" || !modifiable) return emoji;
  const [first, ...rest] = [...emoji];
  if (rest[0] === "️") rest.shift();
  return first + MODIFIER[tone] + rest.join("");
}
