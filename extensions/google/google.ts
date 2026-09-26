// Google Search's network half: the suggestions (Google's own endpoint,
// no key), the result providers (SerpApi, Brave Search API, a SearXNG
// instance), the Wikipedia card for a suggestion Google marks as a person,
// place or thing, and the urls a search opens. Parsers are exported for
// the tests; every request goes through `fetchText`, which decodes by the
// charset the reply names and which `PAL_GOOGLE_BASE` points at a
// stand-in server.
import { htmlText } from "@zcag/pal";

export type Provider = "none" | "serpapi" | "brave" | "searxng";
/** `[extensions.google]`, defaults in pal.json. */
export type Settings = { provider: Provider; serpapi_key: string; brave_key: string; searxng_url: string; results: "typing" | "ask"; language: string; region: string; safe_search: boolean; browser: string; root: boolean; history: boolean };

/** One suggestion: the text searched, and for an entity Google knows its name, a line about it and a thumbnail. */
export type Suggestion = { text: string; entity?: { title: string; about: string; image?: string } };
/** One web result. */
export type Result = { title: string; url: string; snippet: string; date?: string };
/** An instant answer or a knowledge panel: `text` is the answer itself (27 °C, a definition, 3.412,50 TRY), `about` the line under it. */
export type Answer = { title: string; text: string; about?: string; url?: string; image?: string };
export type Found = { results: Result[]; answer?: Answer };
export type Locale = { hl: string; gl: string };

const FETCH_MS = 8000;
/** `https://host/path` as `<base>/host/path` when the tests set a stand-in. */
const routed = (url: string) => { const b = process.env.PAL_GOOGLE_BASE; return b ? url.replace(/^https:\/\//, `${b}/`) : url; };

/** The body as text in the charset its Content-Type names (Google's suggest answers ISO-8859-9 for Turkish, ISO-8859-1 elsewhere, unless asked for UTF-8); UTF-8 when it names none or one the decoder does not know. */
export async function decode(res: Response): Promise<string> {
  const buf = await res.arrayBuffer();
  const charset = /charset=["']?([\w.:-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1] ?? "utf-8";
  try { return new TextDecoder(charset as ConstructorParameters<typeof TextDecoder>[0]).decode(buf); } catch { return new TextDecoder().decode(buf); }
}

export class SearchError extends Error {}

async function fetchText(url: string, init: RequestInit & { what: string }): Promise<string> {
  const res = await fetch(routed(url), { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(FETCH_MS)]) : AbortSignal.timeout(FETCH_MS) });
  const body = await decode(res);
  if (!res.ok) throw new SearchError(`${init.what} answered ${res.status}${errorOf(body) ? `: ${errorOf(body)}` : ""}`);
  return body;
}
const errorOf = (body: string): string | undefined => { try { const j = JSON.parse(body); return typeof j?.error === "string" ? j.error : j?.error?.detail ?? j?.message; } catch { return undefined; } };
const json = (body: string, what: string): any => { try { return JSON.parse(body); } catch { throw new SearchError(`${what} answered something that is not JSON`); } };

// ---- suggestions ----------------------------------------------------------------------

/** The language and country: the settings', else the system's locale (`en-US` is en and us). */
export function localeOf(s: Pick<Settings, "language" | "region">, system = Intl.DateTimeFormat().resolvedOptions().locale): Locale {
  const [lang, country] = system.split(/[-_]/);
  const hl = s.language && s.language !== "auto" ? s.language : lang || "en";
  return { hl, gl: (s.region?.trim() || country || "").toLowerCase() };
}

/**
 * Google's homepage suggest (`client=gws-wiz`): `)]}'` then
 * `[[[html, type, subtypes, {zh, zi, zs}?], ...], meta]`, the completion
 * marked with `<b>`; `zh` names an entity, `zi` says what it is, `zs` is
 * its thumbnail.
 */
export function parseWiz(body: string): Suggestion[] {
  const data = JSON.parse(body.replace(/^\)\]\}'\s*/, ""));
  if (!Array.isArray(data?.[0])) throw new SearchError("suggestions in an unknown shape");
  return data[0].flatMap((row: unknown): Suggestion[] => {
    if (!Array.isArray(row) || typeof row[0] !== "string") return [];
    const text = htmlText(row[0]);
    const m = row[3] as { zh?: string; zi?: string; zs?: string } | undefined;
    const entity = m?.zh ? { title: htmlText(m.zh), about: htmlText(m.zi ?? ""), ...(m.zs && { image: m.zs }) } : undefined;
    return text ? [{ text, ...(entity && { entity }) }] : [];
  });
}

/** The documented suggest (`client=firefox`): `[query, [suggestion, ...], ...]`. */
export function parseFirefox(body: string): Suggestion[] {
  const data = JSON.parse(body);
  if (!Array.isArray(data?.[1])) throw new SearchError("suggestions in an unknown shape");
  return data[1].filter((t: unknown): t is string => typeof t === "string" && !!t.trim()).map((text: string) => ({ text: text.trim() }));
}

const qs = (o: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "").map(([k, v]): [string, string] => [k, String(v)])).toString();

/**
 * The suggestions for `q`: Google's homepage endpoint first (it names the
 * entities), the documented one when that fails or changes shape. `signal`
 * cancels the request when a newer keystroke asks.
 */
export async function suggest(q: string, loc: Locale, signal?: AbortSignal): Promise<Suggestion[]> {
  try {
    return parseWiz(await fetchText(`https://www.google.com/complete/search?${qs({ q, client: "gws-wiz", xssi: "t", hl: loc.hl, gl: loc.gl })}`, { signal, what: "Google suggest" }));
  } catch (e) {
    if (signal?.aborted) throw e;
    return parseFirefox(await fetchText(`https://suggestqueries.google.com/complete/search?${qs({ client: "firefox", q, hl: loc.hl, gl: loc.gl })}`, { signal, what: "Google suggest" }));
  }
}

// ---- urls -----------------------------------------------------------------------------

/** google.com's search for `q`; the language, country and safe search only when set, so an unset one leaves Google's own choice. */
export function searchUrl(q: string, s: Pick<Settings, "language" | "region" | "safe_search">): string {
  return `https://www.google.com/search?${qs({ q, hl: s.language && s.language !== "auto" ? s.language : undefined, gl: s.region?.trim().toLowerCase() || undefined, safe: s.safe_search ? "active" : undefined })}`;
}

/** `github.com` for `https://www.github.com/zcag/pal`. */
export const domainOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

// ---- results --------------------------------------------------------------------------

const str = (v: unknown): string => (typeof v === "string" ? htmlText(v) : typeof v === "number" ? String(v) : "");
const results = (list: unknown, pick: (r: any) => Result | undefined): Result[] => (Array.isArray(list) ? list.map(pick).filter((r): r is Result => !!r && !!r.url && !!r.title) : []);

/** SerpApi's Google engine: `organic_results`, the `answer_box` (a calculation, the weather, a conversion, a definition, a quoted passage) or the `knowledge_graph`. */
export function parseSerpApi(j: any): Found {
  const found: Found = { results: results(j?.organic_results, (r) => ({ title: str(r.title), url: str(r.link), snippet: str(r.snippet), ...(r.date && { date: str(r.date) }) })) };
  const a = j?.answer_box, k = j?.knowledge_graph;
  if (a) {
    const text = str(a.answer) || str(a.result) || (a.temperature !== undefined ? `${str(a.temperature)}°${str(a.unit).startsWith("F") ? "F" : "C"}` : "") || str(a.definitions?.[0]) || str(a.snippet) || str(a.title);
    const about = [str(a.weather), str(a.location), a.answer || a.result ? str(a.title) : "", str(a.syllables), str(a.date)].filter(Boolean).join(" · ");
    if (text) found.answer = { title: str(a.title) || str(a.type).replace(/_/g, " ") || "Answer", text, ...(about && { about }), ...(a.link && { url: str(a.link) }), ...(a.thumbnail && { image: str(a.thumbnail) }) };
  } else if (k?.title) {
    found.answer = { title: str(k.title), text: str(k.description) || str(k.type), ...(k.type && k.description && { about: str(k.type) }), ...((k.source?.link || k.website) && { url: str(k.source?.link || k.website) }), ...((k.header_images?.[0]?.image || k.thumbnail) && { image: str(k.header_images?.[0]?.image || k.thumbnail) }) };
  }
  return found;
}

/** The Brave Search API's web search: `web.results`, the `infobox` as the panel. */
export function parseBrave(j: any): Found {
  const found: Found = { results: results(j?.web?.results, (r) => ({ title: str(r.title), url: str(r.url), snippet: str(r.description), ...(r.age && { date: str(r.age) }) })) };
  const i = j?.infobox?.results?.[0];
  if (i?.title) found.answer = { title: str(i.title), text: str(i.long_desc) || str(i.description), ...(i.description && i.long_desc && { about: str(i.description) }), ...(i.url && { url: str(i.url) }), ...(i.thumbnail?.src && { image: str(i.thumbnail.src) }) };
  return found;
}

/** A SearXNG instance's `format=json`: `results`, the first of `answers`, else of `infoboxes`. */
export function parseSearxng(j: any): Found {
  const found: Found = { results: results(j?.results, (r) => ({ title: str(r.title), url: str(r.url), snippet: str(r.content), ...(r.publishedDate && { date: str(r.publishedDate).slice(0, 10) }) })) };
  const a = j?.answers?.[0], i = j?.infoboxes?.[0];
  const text = typeof a === "string" ? htmlText(a) : str(a?.answer);
  if (text) found.answer = { title: "Answer", text, ...(a?.url && { url: str(a.url) }) };
  else if (i?.infobox) found.answer = { title: str(i.infobox), text: str(i.content), ...(i.urls?.[0]?.url && { url: str(i.urls[0].url) }), ...(i.img_src && { image: str(i.img_src) }) };
  return found;
}

/** Whether the provider has what it needs (a key, an instance). */
export const ready = (s: Settings): boolean => (s.provider === "serpapi" ? !!s.serpapi_key?.trim() : s.provider === "brave" ? !!s.brave_key?.trim() : s.provider === "searxng" ? !!s.searxng_url?.trim() : false);

export const PROVIDER_NAME: Record<Provider, string> = { none: "Suggestions only", serpapi: "SerpApi", brave: "Brave Search", searxng: "SearXNG" };

/** The web results and the answer for `q` from the chosen provider. */
export async function search(q: string, s: Settings, loc: Locale): Promise<Found> {
  switch (s.provider) {
    case "serpapi":
      return parseSerpApi(json(await fetchText(`https://serpapi.com/search.json?${qs({ engine: "google", q, api_key: s.serpapi_key.trim(), hl: loc.hl, gl: loc.gl, safe: s.safe_search ? "active" : undefined })}`, { what: "SerpApi" }), "SerpApi"));
    case "brave":
      return parseBrave(json(await fetchText(`https://api.search.brave.com/res/v1/web/search?${qs({ q, count: 10, search_lang: loc.hl, country: loc.gl, safesearch: s.safe_search ? "strict" : "moderate" })}`, { headers: { accept: "application/json", "x-subscription-token": s.brave_key.trim() }, what: "Brave Search" }), "Brave Search"));
    case "searxng":
      return parseSearxng(json(await fetchText(`${s.searxng_url.trim().replace(/\/+$/, "")}/search?${qs({ q, format: "json", language: loc.hl, safesearch: s.safe_search ? 2 : 0 })}`, { what: "SearXNG" }), "SearXNG (is `json` among its search formats?)"));
    default:
      return { results: [] };
  }
}

// ---- Wikipedia ------------------------------------------------------------------------

export type Card = { title: string; about?: string; extract: string; url: string; image?: string };

/** A REST `page/summary` as a card; a disambiguation page or an empty extract is none. */
export function parseSummary(j: any): Card | undefined {
  if (!j?.extract || j.type === "disambiguation") return undefined;
  return { title: str(j.title), ...(j.description && { about: str(j.description) }), extract: String(j.extract).trim(), url: str(j.content_urls?.desktop?.page), ...(j.thumbnail?.source && { image: str(j.thumbnail.source) }) };
}

/** Wikipedia's summary of `title` in `lang`, then in English; undefined when neither has the page. */
export async function wikiCard(title: string, lang: string): Promise<Card | undefined> {
  for (const l of [...new Set([lang, "en"])]) {
    try { const c = parseSummary(json(await fetchText(`https://${l}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`, { what: "Wikipedia" }), "Wikipedia")); if (c) return c; } catch { /* the next language */ }
  }
  return undefined;
}
