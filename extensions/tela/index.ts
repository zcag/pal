// tela: the wiki in the panel. Nine palettes over one client (api.ts)
// and one data layer (data.ts): full-text Search and semantic Research
// (input), Pages (recent across spaces, favourites first; a space's tree
// when pushed from Spaces), Spaces, New Page (a form), Decks, Sheets,
// Comments (what addresses you), Backlinks (of the page opened last). A
// page is one id everywhere, `page:<n>`: a list row, the view it opens as
// (`render.ts` over `md.ts`), the form that comments on it. Editing a
// page's body is not the panel's job (tela's MCP does that). One bar
// item, `inbox`: unread mentions and replies, hidden at zero.
import { clipboard, selection, storage, tinted, type Action, type BarCtx, type BarItem, type BarMenuNode, type Ctx, type Detail, type Effect, type Extension, type Form, type FormValues, type Item, type Metadata } from "@zcag/pal";
import { ApiError, AuthError, EXTENSION, askUrl, baseUrl, conf, keysUrl, log, notesUrl, pageUrl, researchOn, searchUrl, spaceUrl } from "./api.ts";
import {
  RESEARCH_LIMIT, RESEARCH_MAX, addComment, addressed, backlinks, catalog, createPage, deckCover, describe, favorites, findSpace, iso, markAllRead, markRead, notifications, page, pageCounts, recent, research, search, spaceName, spaceTree, spaces,
  type Notification, type Page, type PageRef, type Space,
} from "./data.ts";
import { frontmatter, outline, plain } from "./md.ts";
import { ago, pageView, researchView, type ResearchState } from "./render.ts";

/** Nerd Font `md-` glyphs: page, search, lightbulb (research), space (earth / lock), deck, sheet, comment, mention, reply, backlink, plus, note, star, info, alert, key, inbox, check, history. */
const ICON = {
  page: "\u{f09ee}", search: "\u{f0349}", research: "\u{f06e9}", earth: "\u{f01e7}", lock: "\u{f0341}", deck: "\u{f0428}", sheet: "\u{f04eb}", comment: "\u{f0189}", mention: "\u{f0065}", reply: "\u{f0f20}",
  link: "\u{f0339}", plus: "\u{f1a9e}", note: "\u{f11d7}", star: "\u{f04ce}", info: "\u{f02fd}", alert: "\u{f05d6}", key: "\u{f030b}", inbox: "\u{f0687}", check: "\u{f012d}", history: "\u{f02da}",
} as const;
/** The bar's glyph (md-book_open_page_variant). */
const BAR_GLYPH = "\u{f05da}";
const BAR_ROWS = 5;
const SEARCH_WAIT_MS = 250;
const QUESTIONS_KEPT = 12;
/** Characters of a page body the detail pane gets; the view level draws the whole page. */
const PANE_CHARS = 8000;
const PREFILL_MAX = 20_000;

// ---- rows the palettes share -----------------------------------------------------

const hint = (id: string, name: string, subtitle?: string, actions: Action[] = [], icon: string = ICON.info): Item => ({ id: `hint:${id}`, name, subtitle, icon, actions });

/** What a failed listing shows instead of rows: the setting to fill, the token to renew, or what went wrong, each naming the fix. */
function failure(e: unknown): Item[] {
  if (e instanceof AuthError) {
    return e.which === "url"
      ? [hint("url", "Set the tela address", "Settings, Extensions, tela: the instance, e.g. https://telawiki.com", [{ id: "settings", title: "Open settings" }], ICON.key)]
      : [hint("token", "Sign in to tela", "Create a personal access token under Settings, API Keys on tela, then paste it under Settings, Extensions, tela", [{ id: "keys", title: "Open tela API Keys" }, { id: "settings", title: "Open settings" }], ICON.key)];
  }
  if (e instanceof ApiError && e.unauthorized) return [hint("token", "tela rejected the token", "It expired or was revoked: create a new one under Settings, API Keys and paste it under Settings, Extensions, tela", [{ id: "keys", title: "Open tela API Keys" }, { id: "settings", title: "Open settings" }], ICON.alert)];
  if (e instanceof ApiError && e.forbidden) return [hint("forbidden", "The token cannot see this", e.message || "Its scope or space restriction does not cover it; a wider token under Settings, API Keys", [{ id: "keys", title: "Open tela API Keys" }], ICON.alert)];
  if (e instanceof ApiError && e.unconfigured) return [hint("rag", "Research is not set up on this tela", "The instance has no embedder (tela's AI settings); Search still works", [], ICON.alert)];
  log(e instanceof Error ? e.message : String(e));
  return [hint("error", "tela did not answer", `${e instanceof Error ? e.message : String(e)}; cmd+r tries again`, [], ICON.alert)];
}

const pickHint = (id: string, action?: string): Effect | void => {
  if (/^hint:(url|token|forbidden)$/.test(id)) return { open: action === "keys" ? keysUrl() : "pal://settings/extensions" };
  if (id === "hint:research-off") return { open: "pal://settings/extensions" };
};

/** Rows or the failure hint, never a thrown listing: the panel would show an error where a sentence does. */
const guard = async (f: () => Promise<Item[]>): Promise<Item[]> => { try { return await f(); } catch (e) { return failure(e); } };
const failToast = (title: string, e: unknown): Effect => ({ keep: true, toast: { title, message: e instanceof Error ? e.message : String(e), style: "failure" } });

const short = (s: string, n = 100) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const unmark = (s: string) => s.replace(/<\/?mark>/g, "").replace(/\s+/g, " ").trim();
const crumbOf = (r: PageRef) => (r.breadcrumb?.length ? r.breadcrumb.join(" › ") : "");
const dateOf = (t?: string | null) => { const d = iso(t); return d ? [{ date: d }] : []; };

// ---- pages -------------------------------------------------------------------

const pageTable = new Map<number, PageRef>();
const pid = (id: string) => (id.startsWith("page:") ? Number(id.slice(5)) : NaN);

/** What a page row can do; the view a page opens as offers the same set. */
const PAGE_ACTIONS: Action[] = [
  { id: "open", title: "Open in tela" },
  { id: "read", title: "Read in pal", shortcut: "cmd+enter" },
  { id: "copy", title: "Copy link", shortcut: "cmd+c" },
  { id: "outline", title: "Outline", shortcut: "cmd+shift+o" },
  { id: "backlinks", title: "Backlinks", shortcut: "cmd+b" },
  { id: "comment", title: "Comment on page", shortcut: "cmd+shift+m" },
];

function pageRow(r: PageRef, section?: string, extra: Partial<Item> = {}): Item {
  pageTable.set(r.id, { ...pageTable.get(r.id), ...r });
  const crumb = crumbOf(r);
  return {
    id: `page:${r.id}`,
    name: r.title,
    subtitle: [r.space_name, crumb].filter(Boolean).join(" › ") || undefined,
    icon: r.deck ? ICON.deck : r.sheet ? ICON.sheet : ICON.page,
    keywords: [r.space_name ?? "", ...(r.breadcrumb ?? [])].filter(Boolean),
    section,
    accessories: [...(r.deck ? [{ tag: "deck", color: "violet" }] : r.sheet ? [{ tag: "sheet", color: "teal" }] : []), ...dateOf(r.updated_at)],
    actions: PAGE_ACTIONS,
    ...extra,
  };
}

async function refOf(id: number): Promise<PageRef> {
  const have = pageTable.get(id);
  if (have?.space_name) return have;
  const p = have ?? (await page(id));
  const ref: PageRef = { id: p.id, space_id: p.space_id, title: p.title, space_name: await spaceName(p.space_id), updated_at: p.updated_at ?? have?.updated_at };
  pageTable.set(id, { ...have, ...ref });
  return ref;
}

/** The last page opened or read, for Backlinks with nothing pushed. */
type Last = { id: number; title: string; space: number };
const remember = (r: PageRef) => storage.set("last", { id: r.id, title: r.title, space: r.space_id } satisfies Last, EXTENSION).catch(() => {});
const last = () => storage.get<Last>("last", EXTENSION).catch(() => null);

/** tela's own block syntax made plain for the pane's renderer: front matter off, `:::` fences dropped, callouts as a bold lead. */
export function paneMarkdown(body: string): string {
  const b = frontmatter(body).body.replace(/^:::\w+(\{[^}]*\})?\s*$/gm, "").replace(/^:::\s*$/gm, "").replace(/^>\s*\[!(\w+)\]\s*(.*)$/gm, (_, t: string, rest: string) => `> **${t[0] + t.slice(1).toLowerCase()}${rest ? `: ${rest}` : ""}**`);
  return b.length > PANE_CHARS ? b.slice(0, PANE_CHARS) + "\n\n…" : b;
}

async function pageDetail(id: number): Promise<Detail> {
  const p = await page(id);
  const ref = await refOf(id);
  const meta: Metadata[] = [
    { label: "Space", link: { text: ref.space_name ?? String(p.space_id), href: spaceUrl(p.space_id) } },
    ...(ref.breadcrumb?.length ? [{ label: "Under", value: ref.breadcrumb.join(" › ") }] : []),
    ...(p.props?.deck === true ? [{ label: "Kind", tags: [{ text: "deck", color: "violet" }] }] : p.props?.sheet === true ? [{ label: "Kind", tags: [{ text: "sheet", color: "teal" }] }] : []),
    { label: "Updated", value: `${ago(p.updated_at)}` },
    { label: "Created", value: new Date(iso(p.created_at) ?? p.created_at).toLocaleDateString() },
    { label: "Words", value: String(p.body.split(/\s+/).filter(Boolean).length) },
    ...(typeof p.props?.summary === "string" ? [{ label: "Summary", value: short(p.props.summary, 300) }] : []),
  ];
  let markdown = paneMarkdown(p.body) || "_Nothing on this page yet._";
  if (p.props?.deck === true) {
    const cover = await deckCover(id);
    if (cover) markdown = `![first slide](${cover})\n\n${markdown}`;
  }
  return { markdown, metadata: meta };
}

const outlineDetail = (p: Page): Detail => {
  const heads = outline(p.body);
  return { markdown: heads.length ? heads.map((h) => `${"  ".repeat(Math.max(0, h.level - 1))}- ${h.text}`).join("\n") : "_No headings on this page._" };
};

async function pickPage(id: number, action: string | undefined, ctx?: Ctx): Promise<Effect | void> {
  if (action === "comment:save") return saveComment(id, ctx?.values ?? {});
  const ref = await refOf(id);
  const url = pageUrl(ref.space_id, id, ref.title);
  switch (action) {
    case "copy": return { copy: url };
    case "markdown": return { copy: (await page(id)).body };
    case "read": { const p = await page(id); await remember(ref); return { view: pageView(p, ref.space_name ?? `Space ${p.space_id}`, ref.breadcrumb) }; }
    case "outline": return { show: { title: `Outline of ${short(ref.title, 40)}`, ...outlineDetail(await page(id)) } };
    case "backlinks": await remember(ref); return { push: { extension: EXTENSION, palette: "backlinks", args: { page: id, title: ref.title } } };
    case "comment": return { form: await commentForm(ref) };
    default: await remember(ref); return { open: url };
  }
}

// ---- forms: new page, comment -----------------------------------------

/** What a new page's body starts as: the front app's selection, else the clipboard's text. */
async function prefill(): Promise<string> {
  const sel = await selection.text().catch(() => null);
  if (sel?.trim()) return sel.length > PREFILL_MAX ? "" : sel;
  const c = await clipboard.current().catch(() => null);
  return c?.kind === "text" && c.text && c.text.length <= PREFILL_MAX ? c.text : "";
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

async function newPageForm(space?: number, values?: FormValues, errors?: Record<string, string>): Promise<Form> {
  const all = await spaces();
  const def = space ?? (await findSpace(conf().default_space ?? ""))?.id ?? all[0]?.id;
  return {
    id: "new",
    title: "New tela page",
    fields: [
      { kind: "text", id: "title", label: "Title", required: true, default: str(values?.title), placeholder: "What the page is about" },
      all.length
        ? { kind: "select", id: "space", label: "Space", options: all.map((s) => ({ id: String(s.id), title: s.name })), default: String(values?.space ?? def ?? ""), required: true }
        : { kind: "text", id: "space", label: "Space id", required: true, default: str(values?.space), placeholder: "The space's number" },
      { kind: "textarea", id: "body", label: "Body", default: values ? str(values.body) : await prefill(), description: "Markdown; tela's blocks work (callouts, tabs, [[wikilinks]]). Prefilled from your selection or the clipboard." },
    ],
    submit: { id: "save", title: "Create page" },
    errors,
  };
}

async function saveNewPage(values: FormValues): Promise<Effect> {
  const title = str(values.title).trim(), space = Number(values.space), body = str(values.body);
  const errors: Record<string, string> = {};
  if (!title) errors.title = "Required";
  if (!Number.isFinite(space) || space <= 0) errors.space = "Pick a space";
  if (Object.keys(errors).length) return { form: await newPageForm(undefined, values, errors) };
  try {
    const p = await createPage(space, title, body);
    await remember({ id: p.id, space_id: p.space_id, title: p.title });
    return { open: pageUrl(p.space_id, p.id, p.title), hud: `Created ${short(p.title, 40)}` };
  } catch (e) {
    return { form: await newPageForm(undefined, values, { title: e instanceof Error ? e.message : String(e) }) };
  }
}

async function commentForm(ref: PageRef, values?: FormValues, errors?: Record<string, string>): Promise<Form> {
  const firstLine = values ? "" : plain((await page(ref.id).catch(() => ({ body: "" }))).body).split("\n").find((l) => l.trim()) ?? ref.title;
  return {
    id: `page:${ref.id}`,
    title: `Comment on ${short(ref.title, 40)}`,
    fields: [
      { kind: "textarea", id: "body", label: "Comment", required: true, default: str(values?.body), placeholder: "What you want to say; @name mentions someone" },
      { kind: "text", id: "anchor", label: "On the text", required: true, default: values ? str(values.anchor) : firstLine, description: "A run of the page's text the comment attaches to (tela comments anchor on a passage); the first line unless you say otherwise." },
    ],
    submit: { id: "comment:save", title: "Comment" },
    errors,
  };
}

async function saveComment(id: number, values: FormValues): Promise<Effect> {
  const ref = await refOf(id);
  const body = str(values.body).trim(), anchor = str(values.anchor).trim();
  if (!body || !anchor) return { form: await commentForm(ref, values, { [body ? "anchor" : "body"]: "Required" }) };
  try {
    await addComment(id, body, { exact: anchor });
    return { open: pageUrl(ref.space_id, id, ref.title), hud: `Commented on ${short(ref.title, 40)}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { form: await commentForm(ref, values, { [e instanceof ApiError && e.code === "comment_no_anchor" ? "anchor" : "body"]: msg }) };
  }
}

// ---- pages palette: the root's rows, or a space's tree ------------------------------

const COMMANDS: Item[] = [
  { id: "cmd:new", name: "New tela page", subtitle: "A page in a space, the body from your selection or the clipboard", icon: ICON.plus, keywords: ["create", "write", "wiki"], actions: [{ id: "new", title: "New page" }] },
  { id: "cmd:search", name: "Search tela", subtitle: "Full-text over every page you can see", icon: ICON.search, keywords: ["find", "wiki"], actions: [{ id: "search", title: "Search" }, { id: "browser", title: "Search in the browser", shortcut: "cmd+enter" }] },
  { id: "cmd:ask", name: "Ask tela", subtitle: "A question answered from the pages that matter", icon: ICON.research, keywords: ["research", "question", "wiki"], actions: [{ id: "ask", title: "Ask" }, { id: "browser", title: "Ask in the browser", shortcut: "cmd+enter" }] },
  { id: "cmd:notes", name: "Quick Notes", subtitle: "Your scratchpad page on tela", icon: ICON.note, keywords: ["scratch", "journal", "daily"], actions: [{ id: "open", title: "Open Quick Notes" }] },
];

async function pickCommand(id: string, action?: string): Promise<Effect | void> {
  switch (id) {
    case "cmd:new": return { form: await newPageForm() };
    case "cmd:search": return action === "browser" ? { open: searchUrl("") } : { push: { extension: EXTENSION, palette: "search" } };
    case "cmd:ask": return action === "browser" ? { open: askUrl("") } : { push: { extension: EXTENSION, palette: "research" } };
    case "cmd:notes": return { open: notesUrl() };
  }
}

async function rootRows(refresh: boolean): Promise<Item[]> {
  const [fav, rec] = await Promise.all([favorites(refresh).catch((e) => { log(`favourites: ${e instanceof Error ? e.message : e}`); return [] as PageRef[]; }), recent(refresh)]);
  const rows: Item[] = COMMANDS.filter((c) => c.id !== "cmd:ask" || researchOn());
  const seen = new Set<number>();
  for (const f of fav) { seen.add(f.id); rows.push(pageRow(f, "Favourites", { icon: ICON.star })); }
  // Sectioned by space, so the subtitle is the breadcrumb alone; the author and the date on the right.
  for (const r of rec) if (!seen.has(r.id)) { seen.add(r.id); rows.push(pageRow(r, r.space_name ?? "Recent", { subtitle: crumbOf(r) || undefined, accessories: [...(r.author ? [{ text: r.author }] : []), ...dateOf(r.updated_at)] })); }
  if (!fav.length && !rec.length) rows.push(hint("none", "No pages yet", "Nothing has been edited on this tela; New tela page starts one"));
  return rows;
}

async function spaceRows(space: number, refresh: boolean): Promise<Item[]> {
  const name = await spaceName(space);
  const rows = (await spaceTree(space, refresh)).map((r) => pageRow({ ...r, space_name: name }, r.breadcrumb?.[0] ?? "Top level", { subtitle: crumbOf(r) || undefined }));
  return rows.length ? rows : [hint("none", `No pages in ${name}`, "New tela page starts one", [{ id: "new", title: "New page here" }], ICON.plus)];
}

// ---- search ---------------------------------------------------------------------

/**
 * The wait between the last keystroke and the request. The panel lists an
 * input palette on every keystroke and never debounces, so the wait lives
 * here: one per query, restarted by a newer query only. A call for the
 * query already waiting joins it; a call a newer query overtook answers
 * with that query's rows once they are in (the panel has moved on and
 * drops the reply; what it would show is never an older query's list).
 */
let searchSeq = 0;
let newest: { q: string; rows: Promise<Item[]>; done: boolean } | undefined;

function searchRows(query = ""): Promise<Item[]> {
  const q = query.trim();
  if (q.length < 2) return Promise.resolve([hint("search", "Search tela", "Words, a phrase in quotes, -excluded; ranked over titles and bodies")]);
  if (newest?.q === q && !newest.done) return newest.rows;
  const seq = ++searchSeq;
  const entry = { q, done: false, rows: Bun.sleep(SEARCH_WAIT_MS).then(() => (seq === searchSeq ? hitRows(q) : newest!.rows)) };
  entry.rows.then(() => { entry.done = true; }, () => { entry.done = true; });
  newest = entry;
  return entry.rows;
}

async function hitRows(q: string): Promise<Item[]> {
  const [hits, all] = await Promise.all([search(q), spaces().catch(() => [] as Space[])]);
  const nameOf = (id: number) => all.find((s) => s.id === id)?.name ?? `Space ${id}`;
  const rows = hits.map((h) => {
    const ref: PageRef = { id: h.page_id, space_id: h.space_id, title: h.title, space_name: nameOf(h.space_id), breadcrumb: h.breadcrumb };
    const snippet = unmark(h.snippet);
    return pageRow(ref, ref.space_name, {
      subtitle: [crumbOf(ref), snippet].filter(Boolean).join(" · ") || undefined,
      accessories: h.public ? [{ tag: "public", color: "grey" }] : [],
      detail: { markdown: `…${h.snippet.replace(/<mark>/g, "**").replace(/<\/mark>/g, "**")}…` },
    });
  });
  return rows.length ? rows : [hint("empty", "Nothing found", `No page has “${q}”; Ask tela finds pages by meaning`, [{ id: "ask", title: "Ask tela" }], ICON.research)];
}

// ---- research -------------------------------------------------------------------

let current: ResearchState | undefined;
const questions = () => storage.get<string[]>("questions", EXTENSION).then((q) => q ?? []).catch(() => [] as string[]);

async function rememberQuestion(q: string) {
  const list = [q, ...(await questions()).filter((x) => x !== q)].slice(0, QUESTIONS_KEPT);
  await storage.set("questions", list, EXTENSION).catch(() => {});
}

async function ask(question: string, limit = RESEARCH_LIMIT): Promise<Effect> {
  const q = question.trim();
  if (!q) return current ? { view: researchView({ ...current, asking: false }) } : { keep: true };
  const r = await research(q, undefined, limit);
  const where = new Map((await spaces().catch(() => [] as Space[])).map((s) => [s.id, s.name] as const));
  current = { r, cursor: 0, where };
  await rememberQuestion(q);
  return { view: researchView(current) };
}

const ASK_ACTIONS: Action[] = [{ id: "ask", title: "Ask" }, { id: "browser", title: "Ask in the browser", shortcut: "cmd+enter" }, { id: "forget", title: "Forget question", shortcut: "cmd+shift+d", style: "destructive" }];

async function researchRows(query = ""): Promise<Item[]> {
  if (!researchOn()) return [hint("research-off", "Research is off", "Turn it on under Settings, Extensions, tela; Search works without it", [{ id: "settings", title: "Open settings" }])];
  const q = query.trim();
  const rows: Item[] = [];
  if (q.length >= 3) rows.push({ id: `ask:${q}`, name: `Ask: ${q}`, subtitle: "Semantic and answer-oriented: the pages that matter, assembled with their sources", icon: ICON.research, actions: ASK_ACTIONS.slice(0, 2) });
  const past = (await questions()).filter((x) => !q || x.toLowerCase().includes(q.toLowerCase()));
  for (const x of past) if (x !== q) rows.push({ id: `ask:${x}`, name: x, icon: ICON.history, section: "Recent questions", keywords: ["question"], actions: ASK_ACTIONS });
  if (!rows.length) rows.push(hint("ask", "Ask the wiki a question", "Type a question; Enter assembles the answer from the pages that matter, with sources", [], ICON.research));
  return rows;
}

function move(delta: number): Effect {
  if (!current) return { keep: true };
  const n = current.r.sources.length;
  current = { ...current, cursor: n ? Math.min(n - 1, Math.max(0, current.cursor + delta)) : 0, asking: false };
  return { view: researchView(current) };
}

async function pickResearch(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id, action);
  if (id.startsWith("ask:")) {
    const q = id.slice(4);
    if (action === "browser") return { open: askUrl(q) };
    if (action === "forget") { await storage.set("questions", (await questions()).filter((x) => x !== q), EXTENSION).catch(() => {}); return { keep: true }; }
    try { return await ask(q); } catch (e) { return failToast("Research failed", e instanceof ApiError && e.unconfigured ? "This tela has no embedder configured; Search still works" : e); }
  }
  // The view's own actions.
  if (action === "ask") { try { return await ask(str(ctx?.values?.input)); } catch (e) { return failToast("Research failed", e); } }
  if (!current) return { keep: true };
  const src = current.r.sources[current.cursor];
  switch (action) {
    case "down": return move(1);
    case "up": return move(-1);
    case "question": current = { ...current, asking: true }; return { view: researchView(current) };
    case "cancel": current = { ...current, asking: false }; return { view: researchView(current) };
    case "more": { try { const r = await research(current.r.question, current.r.space, Math.min(RESEARCH_MAX, current.r.limit * 2)); current = { ...current, r, cursor: Math.min(current.cursor, Math.max(0, r.sources.length - 1)) }; return { view: researchView(current) }; } catch (e) { return failToast("Research failed", e); } }
    case "context": return { copy: current.r.context };
    case "ask-tela": return { open: askUrl(current.r.question) };
    case "copy": return src ? { copy: src.source_kind === "file" ? src.share_url ?? src.download_url ?? pageUrl(src.space_id, src.page_id, src.title) : pageUrl(src.space_id, src.page_id, src.title) } : { keep: true };
    case "read": {
      if (!src) return { keep: true };
      const p = await page(src.page_id);
      await remember({ id: p.id, space_id: p.space_id, title: p.title });
      return { show: { title: short(p.title, 50), ...(await pageDetail(p.id)) } };
    }
    default: {
      const go = /^go(\d)$/.exec(action ?? "");
      if (go) { current = { ...current, cursor: Math.min(current.r.sources.length - 1, Number(go[1]) - 1), asking: false }; return { view: researchView(current) }; }
      if (!src) return { open: askUrl(current.r.question) };
      if (src.source_kind === "file") return { open: src.share_url ?? src.download_url ?? pageUrl(src.space_id, src.page_id, src.title) };
      await remember({ id: src.page_id, space_id: src.space_id, title: src.title });
      return { open: pageUrl(src.space_id, src.page_id, src.title) };
    }
  }
}

// ---- spaces ---------------------------------------------------------------------

const SPACE_ACTIONS: Action[] = [
  { id: "pages", title: "Open pages" },
  { id: "open", title: "Open in tela", shortcut: "cmd+enter" },
  { id: "copy", title: "Copy link", shortcut: "cmd+c" },
  { id: "new", title: "New page here", shortcut: "cmd+n" },
];

async function spaceRowsAll(refresh: boolean): Promise<Item[]> {
  const [all, counts] = await Promise.all([spaces(refresh), pageCounts(refresh).catch(() => new Map<number, number>())]);
  const def = (await findSpace(conf().default_space ?? "").catch(() => undefined))?.id;
  const rows = all.map((s): Item => {
    const n = counts.get(s.id) ?? 0;
    return {
      id: `space:${s.id}`,
      name: s.name,
      subtitle: s.description || (s.is_personal ? "Your personal space" : s.visibility === "public" ? "Published, readable without a login" : "Members only"),
      icon: s.visibility === "public" ? tinted(ICON.earth, "teal") : ICON.lock,
      keywords: [s.slug, s.visibility, ...(s.is_personal ? ["personal"] : [])],
      accessories: [
        ...(s.id === def ? [{ tag: "default", color: "blue" }] : []),
        ...(s.visibility === "public" ? [{ tag: "public", color: "teal" }] : []),
        ...(s.is_personal ? [{ tag: "personal", color: "grey" }] : []),
        { text: `${n} page${n === 1 ? "" : "s"}` },
        ...(s.member_count && s.member_count > 1 ? [{ text: `${s.member_count} members` }] : []),
        ...dateOf(s.updated_at),
      ],
      detail: { markdown: `# ${s.name}\n\n${s.description || "_No description._"}`, metadata: [{ label: "Slug", value: s.slug }, { label: "Visibility", value: s.visibility }, { label: "Pages", value: String(n) }, ...(s.member_count ? [{ label: "Members", value: String(s.member_count) }] : [])] },
      actions: SPACE_ACTIONS,
    };
  });
  return rows.length ? rows : [hint("none", "No spaces", "The token sees none; tela's home page creates one")];
}

async function pickSpace(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  const sid = Number(id.slice(6));
  if (action === "new:save") return saveNewPage(ctx?.values ?? {});
  switch (action) {
    case "open": return { open: spaceUrl(sid) };
    case "copy": return { copy: spaceUrl(sid) };
    case "new": return { form: await newPageForm(sid) };
    default: return { push: { extension: EXTENSION, palette: "pages", args: { space: sid } } };
  }
}

// ---- decks and sheets ------------------------------------------------------------------

async function catalogRows(kind: "deck" | "sheet", refresh: boolean): Promise<Item[]> {
  const rows = (await catalog(kind, refresh)).sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")).map((r) => pageRow(r, r.space_name, { subtitle: crumbOf(r) || undefined, accessories: dateOf(r.updated_at) }));
  return rows.length ? rows : [hint("none", kind === "deck" ? "No decks" : "No sheets", kind === "deck" ? "A page with Slidev markdown and the deck flag is a deck; tela's deck guide shows how" : "A page with tela's sheet flag is a sheet; tela's sheet guide shows how")];
}

// ---- comments: what addresses you -----------------------------------------------------------

const notifTable = new Map<number, Notification>();

const NOTIF_ACTIONS: Action[] = [
  { id: "open", title: "Open in tela" },
  { id: "read-page", title: "Read page in pal", shortcut: "cmd+enter" },
  { id: "read", title: "Mark as read", shortcut: "cmd+shift+r" },
  { id: "copy", title: "Copy link", shortcut: "cmd+c" },
  { id: "read-all", title: "Mark all as read", shortcut: "cmd+shift+a", style: "destructive", confirm: "Mark every notification as read?" },
];

function notifRow(n: Notification, section: string): Item {
  notifTable.set(n.id, n);
  return {
    id: `notif:${n.id}`,
    name: describe(n),
    subtitle: typeof n.data.snippet === "string" ? short(n.data.snippet, 120) : typeof n.data.page_title === "string" ? n.data.page_title : undefined,
    icon: n.type === "mention" ? ICON.mention : n.type === "comment_reply" ? ICON.reply : ICON.comment,
    keywords: [n.actor_username ?? "", typeof n.data.page_title === "string" ? n.data.page_title : "", n.type.replace("_", " ")].filter(Boolean),
    section,
    accessories: [{ tag: n.type === "mention" ? "mention" : "reply", color: n.type === "mention" ? "amber" : "blue" }, ...dateOf(n.created_at)],
    actions: NOTIF_ACTIONS,
  };
}

async function commentRows(refresh: boolean): Promise<Item[]> {
  const all = (await notifications(refresh)).filter((n) => n.type === "mention" || n.type === "comment_reply");
  const unread = all.filter((n) => !n.read), read = all.filter((n) => n.read).slice(0, 20);
  const rows = [...unread.map((n) => notifRow(n, "Unread")), ...read.map((n) => notifRow(n, "Earlier"))];
  if (!unread.length) rows.unshift(hint("none", "No unread mentions or replies", all.length ? "Earlier ones are below" : "Someone @-mentioning you or replying to your comment shows here", [], ICON.check));
  return rows;
}

function notifUrl(n: Notification): string {
  if (n.subject_kind === "page" && n.space_id != null) return pageUrl(n.space_id, n.subject_id, typeof n.data.page_title === "string" ? n.data.page_title : "");
  if (n.subject_kind === "space") return spaceUrl(n.subject_id);
  return baseUrl();
}

async function findNotif(id: number): Promise<Notification> {
  const have = notifTable.get(id);
  if (have) return have;
  for (const n of await notifications()) notifTable.set(n.id, n);
  const n = notifTable.get(id);
  if (!n) throw new Error(`no notification ${id}`);
  return n;
}

async function pickNotif(id: string, action?: string): Promise<Effect> {
  if (action === "read-all") {
    try { await markAllRead(); } catch (e) { return failToast("Could not mark all read", e); }
    return { keep: true, toast: { title: "All read" } };
  }
  const n = await findNotif(Number(id.slice(6)));
  switch (action) {
    case "copy": return { copy: notifUrl(n) };
    case "read":
      try { await markRead(n.id); } catch (e) { return failToast("Could not mark read", e); }
      return { keep: true, toast: { title: "Marked read", message: short(describe(n), 60) } };
    case "read-page": {
      if (n.subject_kind !== "page") return { open: notifUrl(n) };
      const p = await page(n.subject_id);
      if (!n.read) markRead(n.id).catch((e) => log(`mark read ${n.id}: ${e instanceof Error ? e.message : e}`));
      return { view: pageView(p, await spaceName(p.space_id)) };
    }
    default:
      // Opening reads it, as tela's bell does.
      if (!n.read) { try { await markRead(n.id); } catch (e) { log(`mark read ${n.id}: ${e instanceof Error ? e.message : e}`); } }
      return { open: notifUrl(n) };
  }
}

/** The bar item: unread mentions and replies as the badge, hidden at zero; the newest five in the popover with Open in pal and Mark all read under them. */
async function inboxItem(ctx: BarCtx): Promise<BarItem> {
  let list: Notification[];
  try { list = await addressed(ctx.reason === "show" || ctx.reason === "wake" || ctx.reason === "network" || ctx.reason === "cli" || ctx.reason === "open"); } catch (e) {
    if (e instanceof AuthError) return { hidden: true };
    throw e;
  }
  if (!list.length) return { hidden: true };
  const rows: BarMenuNode[] = list.slice(0, BAR_ROWS).map((n) => { notifTable.set(n.id, n); return { type: "item", id: `notif:${n.id}`, title: short(describe(n), 60), subtitle: typeof n.data.snippet === "string" ? short(n.data.snippet, 70) : undefined, icon: n.type === "mention" ? ICON.mention : ICON.reply }; });
  const mentions = list.filter((n) => n.type === "mention").length, replies = list.length - mentions;
  return {
    icon: BAR_GLYPH,
    badge: list.length,
    tooltip: [mentions ? `${mentions} mention${mentions === 1 ? "" : "s"}` : "", replies ? `${replies} repl${replies === 1 ? "y" : "ies"}` : ""].filter(Boolean).join(", "),
    menu: [
      { type: "section", title: "Unread", children: rows },
      { type: "separator" },
      { type: "item", id: "open", title: "Open in pal", subtitle: `${list.length} in Comments`, icon: ICON.inbox },
      { type: "item", id: "read-all", title: "Mark all read", icon: ICON.check, shortcut: "cmd+shift+a", style: "destructive" },
    ],
  };
}

async function inboxAction(action: string): Promise<Effect> {
  if (action === "open") return { push: { extension: EXTENSION, palette: "comments" } };
  if (action === "read-all") {
    const r = await pickNotif("", "read-all");
    return r.toast?.style === "failure" ? r : { keep: true, hud: "Marked read" };
  }
  return pickNotif(action);
}

// ---- backlinks --------------------------------------------------------------------------

async function backlinkRows(ctx?: Ctx): Promise<Item[]> {
  const args = ctx?.args as { page?: number; title?: string } | undefined;
  const target = args?.page ? { id: args.page, title: args.title ?? `Page ${args.page}` } : await last();
  if (!target) return [hint("none", "Open a page first", "Backlinks lists what links to the page you opened last; pick one in Pages or Search", [], ICON.link)];
  const links = await backlinks(target.id, !!ctx?.refresh);
  if (!links.length) return [hint("none", `Nothing links to ${short(target.title, 40)}`, "A [[wikilink]] or a tela://page link from another page would show here", [], ICON.link)];
  return links.map((b) => pageRow({ id: b.page_id, space_id: b.space_id, title: b.title, space_name: b.space_name, breadcrumb: b.breadcrumb }, `Links to ${short(target.title, 40)}`, { subtitle: [b.space_name, unmark(b.snippet)].filter(Boolean).join(" · "), icon: ICON.link }));
}

// ---- the extension ----------------------------------------------------------------------------

/** A pick from any palette whose rows are pages, hints or commands; the view and form ids land here too. */
async function pickAny(id: string, action?: string, ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) {
    if (id === "hint:none" && action === "new") return { form: await newPageForm((ctx?.args as { space?: number } | undefined)?.space) };
    if (id === "hint:empty" && action === "ask") return { push: { extension: EXTENSION, palette: "research" } };
    return pickHint(id, action);
  }
  if (id === "new") return action === "save" ? saveNewPage(ctx?.values ?? {}) : { form: await newPageForm() };
  if (id.startsWith("cmd:")) return pickCommand(id, action);
  if (id.startsWith("space:")) return pickSpace(id, action, ctx);
  if (id.startsWith("notif:")) return pickNotif(id, action);
  if (id === "research" || id.startsWith("ask:")) return pickResearch(id, action, ctx);
  const n = pid(id);
  if (Number.isFinite(n)) return pickPage(n, action, ctx);
  throw new Error(`no row ${id}`);
}

const pageDetailOf = async (id: string): Promise<Detail | void> => { const n = pid(id); if (Number.isFinite(n)) { try { return await pageDetail(n); } catch (e) { return { markdown: `_${e instanceof Error ? e.message : String(e)}_` }; } } };

export default {
  palettes: {
    search: {
      title: "Search tela",
      input: true,
      placeholder: "Words, “a phrase”, -excluded",
      list: (query) => guard(() => searchRows(query)),
      pick: pickAny,
      detail: pageDetailOf,
    },
    research: {
      title: "Ask tela",
      input: true,
      placeholder: "A question for the wiki",
      list: (query) => guard(() => researchRows(query)),
      pick: pickAny,
    },
    pages: {
      title: "Pages",
      placeholder: "A page by title or space",
      list: (_q, ctx) => guard(() => { const a = ctx?.args as { space?: number } | undefined; return a?.space ? spaceRows(a.space, !!ctx?.refresh) : rootRows(!!ctx?.refresh); }),
      pick: pickAny,
      detail: pageDetailOf,
    },
    spaces: {
      title: "Spaces",
      placeholder: "A space by name",
      list: (_q, ctx) => guard(() => spaceRowsAll(!!ctx?.refresh)),
      pick: pickAny,
    },
    "new-page": {
      title: "New Page",
      placeholder: "Which space",
      list: (_q, ctx) => guard(async () => {
        const def = (await findSpace(conf().default_space ?? "").catch(() => undefined))?.id;
        const all = await spaces(!!ctx?.refresh);
        const rows = all.slice().sort((a, b) => Number(b.id === def) - Number(a.id === def)).map((s): Item => ({ id: `space:${s.id}`, name: `New page in ${s.name}`, subtitle: s.description || undefined, icon: ICON.plus, keywords: [s.slug, "create", "write"], accessories: s.id === def ? [{ tag: "default", color: "blue" }] : [], actions: [{ id: "new", title: "New page" }] }));
        return rows.length ? rows : [hint("none", "No spaces", "The token sees none; tela's home page creates one")];
      }),
      pick: async (id, action, ctx) => (id.startsWith("space:") && action !== "new:save" ? { form: await newPageForm(Number(id.slice(6))) } : pickAny(id, action, ctx)),
    },
    decks: {
      title: "Decks",
      placeholder: "A deck by title or space",
      showDetail: true,
      list: (_q, ctx) => guard(() => catalogRows("deck", !!ctx?.refresh)),
      pick: pickAny,
      detail: pageDetailOf,
    },
    sheets: {
      title: "Sheets",
      placeholder: "A sheet by title or space",
      list: (_q, ctx) => guard(() => catalogRows("sheet", !!ctx?.refresh)),
      pick: pickAny,
      detail: pageDetailOf,
    },
    comments: {
      title: "Comments",
      placeholder: "Who, or which page",
      live: true,
      list: (_q, ctx) => guard(() => commentRows(!!ctx?.refresh)),
      pick: pickAny,
    },
    backlinks: {
      title: "Backlinks",
      placeholder: "A linking page by title",
      list: (_q, ctx) => guard(() => backlinkRows(ctx)),
      pick: pickAny,
      detail: pageDetailOf,
    },
  },
  bar: {
    inbox: { render: inboxItem, onAction: inboxAction },
  },
} satisfies Extension;
