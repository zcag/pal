// Snippet text as data: the stored shape, the import file, the keyword
// rule and the preview. The placeholders themselves (`expand`, the
// `{date format=}` grammar, `{snippet name=}`) are the SDK's
// (`sdk/src/placeholders.ts`, shared with quicklinks and obsidian) and
// are re-exported here for the callers that grew up with this file.
export { expand, hasPlaceholders, isoDate, isoTime, type PlaceholderSources as Sources } from "@zcag/pal";

export type Snippet = { id: string; name: string; keyword?: string; text: string };

/** The stored list, defensively: whatever is not a snippet with an id, a name and a text is dropped. */
export const asSnippets = (v: unknown): Snippet[] =>
  Array.isArray(v)
    ? v.filter((x): x is Snippet => !!x && typeof x === "object" && typeof (x as Snippet).id === "string" && typeof (x as Snippet).name === "string" && typeof (x as Snippet).text === "string")
        .map((x) => ({ id: x.id, name: x.name, text: x.text, ...(typeof x.keyword === "string" && x.keyword ? { keyword: x.keyword } : {}) }))
    : [];

/**
 * An import file as snippets: a JSON array of `{name, text, keyword?}`
 * (Raycast's export shape too); anything without a name and a text is
 * dropped, a keyword with a space in it too, and every snippet gets a
 * fresh id. Throws on a non-array.
 */
export function fromJson(data: unknown): Snippet[] {
  if (!Array.isArray(data)) throw new Error("expected a JSON array of {name, text, keyword?}");
  return data
    .map((r) => (r && typeof r === "object" ? (r as { name?: unknown; text?: unknown; keyword?: unknown }) : {}))
    .filter((r) => typeof r.name === "string" && r.name.trim() && typeof r.text === "string" && r.text.trim())
    .map((r) => {
      const keyword = typeof r.keyword === "string" ? r.keyword.trim() : "";
      return { id: crypto.randomUUID(), name: (r.name as string).trim(), text: r.text as string, ...(keyword && !badKeyword(keyword) && { keyword }) };
    });
}

/** A keyword is one word: no spaces, so typing it finds the row whole. */
export const badKeyword = (k: string): string | undefined => (/\s/.test(k.trim()) ? "One word, no spaces" : undefined);

/** The first line of the text, trimmed to `max` characters, for a subtitle. */
export function preview(text: string, max = 80): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

