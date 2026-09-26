// Google Search: an input palette over Google's suggestions (no key),
// fetched on every keystroke (a newer one cancels the request, answers are
// kept ten minutes), and web results from a provider when one is set
// (SerpApi for Google's own, the Brave Search API, a SearXNG instance): in
// the detail pane as you type, or as rows on cmd+Enter. A suggestion Google
// marks as a person, place or thing shows its Wikipedia card there. Tab
// puts a suggestion in the search box (`Item.complete`). At the root, when
// nothing matched, the first suggestions join the "Use “q” with" section
// under Search the web (`lateFallback`, asked only then). Searches opened
// are remembered and listed while nothing is typed.
import { errorMessage, hint, mdEscape, openUrl, settings, storage, toast, truncate, type Action, type Ctx, type Detail, type Effect, type Extension, type Item } from "@zcag/pal";
import { domainOf, localeOf, PROVIDER_NAME, ready, search, searchUrl, suggest, wikiCard, type Answer, type Found, type Locale, type Result, type Settings, type Suggestion } from "./google.ts";

const EXT = "google", PALETTE = "google";
/** Material Design glyphs from the bundled Nerd Font; the tile's blue tints them. */
const GLYPH = {
  search: "\u{f0349}", // md-magnify
  history: "\u{f02da}", // md-history
  answer: "\u{f0336}", // md-lightbulb_outline
  alert: "\u{f05d6}", // md-alert_circle_outline
  web: "\u{f059f}", // md-web
};

const SEARCH: Action = { id: "search", title: "Search Google" };
const RESULTS: Action = { id: "results", title: "Results here", shortcut: "cmd+enter" };
const HERE: Action = { id: "here", title: "Open in Google Search", shortcut: "cmd+enter" };
const BACKGROUND: Action = { id: "background", title: "Search in the background", shortcut: "cmd+b" };
const COPY: Action = { id: "copy", title: "Copy text", shortcut: "cmd+c" };
const COPY_SEARCH: Action = { id: "copy_link", title: "Copy search link", shortcut: "cmd+l" };
const REMOVE: Action = { id: "remove", title: "Remove from recent searches", shortcut: "ctrl+x", style: "destructive" };
const CLEAR: Action = { id: "clear", title: "Clear recent searches", style: "destructive", confirm: "Forget every recent search?" };
const OPEN: Action = { id: "open", title: "Open" };
const OPEN_BG: Action = { id: "background", title: "Open in the background", shortcut: "cmd+enter" };
const COPY_LINK: Action = { id: "copy_link", title: "Copy link", shortcut: "cmd+c" };
const COPY_MD: Action = { id: "copy_md", title: "Copy as Markdown link", shortcut: "cmd+shift+c" };
const COPY_ANSWER: Action = { id: "copy", title: "Copy answer", shortcut: "cmd+c" };

/** Suggestions listed in the palette, and at the root under Search the web. */
const LIST_MAX = 8, ROOT_MAX = 3;
const HISTORY_KEY = "history", HISTORY_MAX = 50, HISTORY_SHOWN = 12;
const CACHE_MS = 10 * 60_000, CACHE_MAX = 300;
/** After the pane rests on a row, before its results are asked for: arrowing through the suggestions asks for none of the rows passed. */
const PREVIEW_MS = Number(process.env.PAL_GOOGLE_PREVIEW_MS) || 250;
const PREVIEW_RESULTS = 5;
const S = () => settings.get<Settings>();

// ---- caches ---------------------------------------------------------------------------

function remember<T>(m: Map<string, { at: number; v: T }>, key: string, v: T) {
  if (m.size >= CACHE_MAX) m.delete(m.keys().next().value!);
  m.set(key, { at: Date.now(), v });
}
const fresh = <T>(m: Map<string, { at: number; v: T }>, key: string): T | undefined => { const h = m.get(key); return h && Date.now() - h.at < CACHE_MS ? h.v : undefined; };

const suggested = new Map<string, { at: number; v: Suggestion[] }>();
/** The entity each suggestion text stood for, for the detail pane and the picks. */
const entities = new Map<string, NonNullable<Suggestion["entity"]>>();
let inflight: AbortController | undefined;

/** The suggestions for `q`, from the cache or Google; a newer call cancels this one's request (it then throws, and its answer is one the panel drops anyway). */
async function suggestions(q: string, loc: Locale): Promise<Suggestion[]> {
  const key = `${loc.hl}|${loc.gl}|${q.toLowerCase()}`;
  const hit = fresh(suggested, key);
  if (hit) return hit;
  inflight?.abort();
  const ac = (inflight = new AbortController());
  try {
    const list = await suggest(q, loc, ac.signal);
    remember(suggested, key, list);
    for (const x of list) if (x.entity) entities.set(x.text.toLowerCase(), x.entity);
    return list;
  } finally { if (inflight === ac) inflight = undefined; }
}

const found = new Map<string, { at: number; v: Found }>();
const pending = new Map<string, Promise<Found>>();
/** The results for `q`, cached and shared: the pane's preview and the results level never ask twice for one query (a SerpApi search counts against its plan). */
function results(q: string, s: Settings): Promise<Found> {
  const loc = localeOf(s);
  const key = [s.provider, loc.hl, loc.gl, s.safe_search, q.toLowerCase()].join("|");
  const hit = fresh(found, key);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(key);
  if (!p) {
    p = search(q, s, loc).then((f) => { remember(found, key, f); return f; }).finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}

// ---- recent searches ------------------------------------------------------------------

const recent = async (): Promise<string[]> => { const v = await storage.get(HISTORY_KEY); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; };
async function keep(q: string) {
  if (!S().history) return;
  const list = await recent();
  await storage.set(HISTORY_KEY, [q, ...list.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, HISTORY_MAX));
}

// ---- rows -----------------------------------------------------------------------------

type Kind = "q" | "s" | "h";
/** `q:` the typed query, `s:` a suggestion, `h:` a recent search, `r:` a result's url, `a:` the answer for a query. */
const parse = (id: string): { kind: string; text: string } => ({ kind: id.slice(0, id.indexOf(":")), text: id.slice(id.indexOf(":") + 1) });

const textActions = (s: Settings, kind: Kind): Action[] => [SEARCH, ...(ready(s) ? [RESULTS] : []), BACKGROUND, COPY, COPY_SEARCH, ...(kind === "h" ? [REMOVE, CLEAR] : [])];

function textRow(kind: Kind, text: string, s: Settings, o: { name?: string; subtitle?: string; entity?: Suggestion["entity"]; actions?: Action[] } = {}): Item {
  const e = o.entity;
  return {
    id: `${kind}:${text}`,
    name: o.name ?? text,
    subtitle: o.subtitle ?? e?.about,
    icon: e?.image ? { image: e.image } : kind === "h" ? GLYPH.history : GLYPH.search,
    complete: text,
    actions: o.actions ?? textActions(s, kind),
  };
}

/** What the palette lists for a typed query: the query itself, then Google's suggestions (the query again left out). */
async function queryRows(q: string, s: Settings): Promise<Item[]> {
  let list: Suggestion[];
  try { list = await suggestions(q, localeOf(s)); } catch (e) {
    if ((e as Error)?.name === "AbortError") return [textRow("q", q, s, { name: `Search Google for “${q}”` })];
    console.error(`[google] suggest: ${errorMessage(e)}`);
    return [textRow("q", q, s, { name: `Search Google for “${q}”` }), hint("offline", "No suggestions", `Google did not answer: ${errorMessage(e)}`, { icon: GLYPH.alert })];
  }
  const same = (x: Suggestion) => x.text.toLowerCase() === q.toLowerCase();
  const entity = list.find(same)?.entity;
  const top = textRow("q", q, s, { name: `Search Google for “${q}”`, subtitle: entity?.about, entity });
  return [top, ...list.filter((x) => !same(x)).slice(0, LIST_MAX).map((x) => textRow("s", x.text, s, { entity: x.entity }))];
}

async function emptyRows(s: Settings): Promise<Item[]> {
  const tip = hint("type", "Type to search Google", ready(s) ? "Tab puts a suggestion in the box, cmd+enter lists the results here" : "Tab puts a suggestion in the box. Results here need a provider (Settings, Google Search)", { icon: GLYPH.search });
  if (!s.history) return [tip];
  return [tip, ...(await recent()).slice(0, HISTORY_SHOWN).map((q) => ({ ...textRow("h", q, s), section: "Recent searches" }))];
}

/** Results by url, as the last results level listed them: what the picks and the pane read. */
const listed = new Map<string, Result>();
const answers = new Map<string, Answer>();

function resultRow(r: Result): Item {
  listed.set(r.url, r);
  return {
    id: `r:${r.url}`,
    name: r.title,
    subtitle: r.snippet,
    url: r.url,
    accessories: [{ text: domainOf(r.url) }],
    detail: { markdown: `**${mdEscape(r.title)}**\n\n${mdEscape(r.snippet)}`, metadata: [{ label: "Site", value: domainOf(r.url) }, { label: "Link", link: { text: truncate(r.url, 60), href: r.url } }, ...(r.date ? [{ label: "Date", value: r.date }] : [])] },
    actions: [OPEN, OPEN_BG, COPY_LINK, COPY_MD],
  };
}

function answerRow(q: string, a: Answer): Item {
  answers.set(q, a);
  // A short answer is the row's name (27°C); a panel is named by its subject, its description under it.
  const short = a.text.length <= 40;
  return { id: `a:${q}`, name: short ? a.text : a.title, subtitle: (short ? [a.title, a.about] : [a.about, a.text]).filter(Boolean).join(" · "), icon: a.image ? { image: a.image } : GLYPH.answer, detail: { markdown: answerMd(a) }, actions: [...(a.url ? [{ id: "open", title: "Open the source" }] : []), COPY_ANSWER], section: "Answer" };
}

/** The results level for `q`: the answer, then the results, what is typed in the level narrowing them. */
async function resultRows(q: string, filter: string, s: Settings): Promise<Item[]> {
  if (!ready(s)) return [hint("setup", "Results here need a provider", "Settings, Extensions, Google Search: SerpApi (Google's results), Brave Search, or your own SearXNG", { icon: GLYPH.alert })];
  let f: Found;
  try { f = await results(q, s); } catch (e) {
    console.error(`[google] ${s.provider}: ${errorMessage(e)}`);
    return [hint("failed", "Could not search", errorMessage(e), { icon: GLYPH.alert })];
  }
  const t = filter.trim().toLowerCase();
  const has = (...xs: (string | undefined)[]) => !t || xs.some((x) => x?.toLowerCase().includes(t));
  const rows = [...(f.answer && has(f.answer.title, f.answer.text) ? [answerRow(q, f.answer)] : []), ...f.results.filter((r) => has(r.title, r.snippet, r.url)).map((r) => ({ ...resultRow(r), section: `Results from ${PROVIDER_NAME[s.provider]}` }))];
  return rows.length ? rows : [hint("none", t ? `Nothing matches “${filter.trim()}”` : `No results for “${q}”`, PROVIDER_NAME[s.provider])];
}

// ---- the detail pane ------------------------------------------------------------------

function answerMd(a: Answer): string {
  // A short answer (27°C, 4, a conversion) is the headline; a panel's description reads as a paragraph.
  const text = a.text.length <= 40 ? `### ${mdEscape(a.text)}` : mdEscape(a.text);
  return [a.image ? `![](${a.image})` : "", `**${mdEscape(a.title)}**${a.about ? `\n${mdEscape(a.about)}` : ""}`, text, a.url ? `[${domainOf(a.url)}](${a.url})` : ""].filter(Boolean).join("\n\n");
}

/** The pane's preview of a search: the answer, then the first results as links. */
function previewMd(q: string, f: Found, s: Settings): string {
  const parts = f.answer ? [answerMd(f.answer), "---"] : [];
  for (const r of f.results.slice(0, PREVIEW_RESULTS)) parts.push(`**[${mdEscape(r.title)}](${r.url})**\n${domainOf(r.url)}${r.date ? ` · ${r.date}` : ""}${r.snippet ? `\n${mdEscape(truncate(r.snippet, 160))}` : ""}`);
  if (!f.results.length && !f.answer) parts.push(`No results for “${mdEscape(q)}” from ${PROVIDER_NAME[s.provider]}.`);
  else if (f.results.length > PREVIEW_RESULTS) parts.push(`*cmd+enter lists all ${f.results.length} here*`);
  return parts.join("\n\n");
}

/** A person, place or thing: Wikipedia's card when it has the page, else what Google said. */
async function entityMd(e: NonNullable<Suggestion["entity"]>, s: Settings): Promise<string> {
  const c = await wikiCard(e.title, localeOf(s).hl).catch(() => undefined);
  if (!c) return [e.image ? `![](${e.image})` : "", `**${mdEscape(e.title)}**`, e.about ? mdEscape(e.about) : ""].filter(Boolean).join("\n\n");
  return [c.image ? `![](${c.image})` : "", `**${mdEscape(c.title)}**${c.about ? `\n${mdEscape(c.about)}` : ""}`, mdEscape(c.extract), `[Wikipedia](${c.url})`].filter(Boolean).join("\n\n");
}

let previewSeq = 0;
async function detail(id: string): Promise<Detail> {
  const { kind, text } = parse(id);
  if (kind === "r" || kind === "a") return {};
  const s = S();
  const e = entities.get(text.toLowerCase());
  if (ready(s) && s.results === "typing") {
    const my = ++previewSeq;
    await Bun.sleep(PREVIEW_MS);
    if (my !== previewSeq) return {};
    try { return { markdown: previewMd(text, await results(text, s), s) }; } catch (err) { return { markdown: `Could not search: ${mdEscape(errorMessage(err))}` }; }
  }
  if (e) return { markdown: await entityMd(e, s) };
  return {
    markdown: kind === "q" && !ready(s)
      ? `Enter searches Google for **${mdEscape(text)}**.\n\nResults can show here as you type: pick a provider under Settings, Extensions, Google Search (SerpApi for Google's own results, Brave Search, or your own SearXNG).`
      : `Enter searches Google for **${mdEscape(text)}**; Tab puts it in the search box.`,
    metadata: [{ label: "Opens", link: { text: truncate(searchUrl(text, s).replace(/^https:\/\/www\./, ""), 48), href: searchUrl(text, s) } }],
  };
}

// ---- picks ----------------------------------------------------------------------------

const resultsLevel = (q: string): Effect => ({ push: { extension: EXT, palette: PALETTE, args: { results: q }, title: q } });

async function pick(id: string, action?: string): Promise<Effect | void> {
  const s = S();
  const { kind, text } = parse(id);
  if (kind === "r") {
    const r = listed.get(text) ?? { title: text, url: text, snippet: "" };
    switch (action) {
      case "background": return openUrl(r.url, { app: s.browser === "default" ? "" : s.browser, background: true });
      case "copy_link": return { copy: r.url };
      case "copy_md": return { copy: `[${r.title.replace(/[[\]]/g, "\\$&")}](${r.url})` };
      default: return openUrl(r.url, { app: s.browser === "default" ? "" : s.browser });
    }
  }
  if (kind === "a") {
    const a = answers.get(text);
    if (!a) return toast("The answer is gone", "List the results again", "failure");
    return action === "open" && a.url ? openUrl(a.url, { app: s.browser === "default" ? "" : s.browser }) : { copy: a.text };
  }
  if (!text) return;
  const app = s.browser === "default" ? "" : s.browser;
  switch (action) {
    case "copy": return { copy: text };
    case "copy_link": return { copy: searchUrl(text, s) };
    case "here": return { push: { extension: EXT, palette: PALETTE, query: text } };
    case "remove": await storage.set(HISTORY_KEY, (await recent()).filter((x) => x !== text)); return { keep: true };
    case "clear": await storage.set(HISTORY_KEY, []); return { keep: true };
    case "results": await keep(text); return resultsLevel(text);
    case "background": await keep(text); return openUrl(searchUrl(text, s), { app, background: true });
    default: await keep(text); return openUrl(searchUrl(text, s), { app });
  }
}

export default {
  palettes: {
    google: {
      title: "Google Search",
      input: true,
      placeholder: "Search Google",
      showDetail: true,
      list: async (query = "", ctx?: Ctx): Promise<Item[]> => {
        const s = S();
        const args = ctx?.args as { results?: string } | undefined;
        if (typeof args?.results === "string") return resultRows(args.results, query, s);
        const q = query.trim();
        return q ? queryRows(q, s) : emptyRows(s);
      },
      // At the root, once Search the web shows (nothing matched): the first suggestions under it; the query itself and an address are left alone.
      lateFallback: async (query: string): Promise<Item[]> => {
        const s = S();
        const q = query.trim();
        if (!s.root || !q || q.includes("://")) return [];
        const list = await suggestions(q, localeOf(s)).catch(() => [] as Suggestion[]);
        return list.filter((x) => x.text.toLowerCase() !== q.toLowerCase()).slice(0, ROOT_MAX).map((x) => textRow("s", x.text, s, { subtitle: x.entity?.about ? `${x.entity.about} · Google` : "Google suggestion", entity: x.entity, actions: [SEARCH, HERE, COPY] }));
      },
      detail,
      pick,
    },
  },
} satisfies Extension;
