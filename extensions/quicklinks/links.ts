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

/**
 * An import file as links: a JSON array of `{name, url, keywords?}`, or
 * Raycast's export `{name, link}`; anything without a usable url is
 * dropped, and every link gets a fresh id. Throws on a non-array.
 */
export function fromJson(data: unknown): Link[] {
  if (!Array.isArray(data)) throw new Error("expected a JSON array of {name, url}");
  return data
    .map((r) => (r && typeof r === "object" ? (r as { name?: unknown; url?: unknown; link?: unknown; keywords?: unknown }) : {}))
    .map((r) => ({ url: typeof r.url === "string" ? r.url : typeof r.link === "string" ? r.link : "", name: typeof r.name === "string" ? r.name : "", keywords: Array.isArray(r.keywords) ? r.keywords.map(String) : undefined }))
    .filter((r) => r.url && !badUrl(r.url))
    .map((r) => ({ id: crypto.randomUUID(), name: r.name || r.url, url: r.url, ...(r.keywords?.length && { keywords: r.keywords }) }));
}

/** `"a, b  c"` as keywords: split on commas and whitespace, blanks dropped. */
export const splitKeywords = (s: string): string[] | undefined => {
  const k = s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  return k.length ? k : undefined;
};

