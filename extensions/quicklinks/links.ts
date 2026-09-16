// Quicklinks as data: the stored shape, the `{query}` placeholder, and the
// url a query fills it into. Pure, so the tests need no host.

export type Link = { id: string; name: string; url: string; keywords?: string[] };

/**
 * `{query}`, `{argument}` or `{argument name="Search"}` (Raycast's
 * spelling): the part of the url the user types when the row is picked.
 * The name, when given, is what the input asks for.
 */
const PLACEHOLDER = /\{(?:query|argument)(?:\s+name="([^"]*)")?\}/g;

/** The name the placeholder asks for, or undefined when the url has none. */
export function placeholder(url: string): string | undefined {
  const m = new RegExp(PLACEHOLDER.source).exec(url);
  return m ? m[1] || "query" : undefined;
}

/** Every placeholder replaced by the query, percent-encoded as a url component. */
export const fill = (url: string, query: string): string => url.replace(PLACEHOLDER, encodeURIComponent(query));

/**
 * A url the opener can take: an absolute one with a scheme (`https:`,
 * `mailto:`, `raycast:`, `file:`), or an absolute or `~` path. Returns
 * why not, or nothing when fine. Checked with the placeholder in place,
 * which `URL` takes as ordinary characters.
 */
export function badUrl(url: string): string | undefined {
  const s = url.trim();
  if (!s) return "Required";
  if (s.startsWith("/") || s.startsWith("~/")) return;
  try {
    const u = new URL(s);
    if (!u.protocol) return "Not a URL";
  } catch {
    return "Not a URL: start with https:// (or a scheme like mailto:)";
  }
}

/** The stored list, defensively: whatever is not a link with an id, a name and a url is dropped. */
export const asLinks = (v: unknown): Link[] =>
  Array.isArray(v)
    ? v.filter((x): x is Link => !!x && typeof x === "object" && typeof (x as Link).id === "string" && typeof (x as Link).name === "string" && typeof (x as Link).url === "string")
        .map((x) => ({ id: x.id, name: x.name, url: x.url, ...(Array.isArray(x.keywords) && x.keywords.length ? { keywords: x.keywords.map(String) } : {}) }))
    : [];

/** `"a, b  c"` as keywords: split on commas and whitespace, blanks dropped. */
export const splitKeywords = (s: string): string[] | undefined => {
  const k = s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  return k.length ? k : undefined;
};

