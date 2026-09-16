// tela's resources as the palettes read them: spaces, pages (recent,
// favourites, a space's tree), search hits, research answers, backlinks,
// comments, notifications, and the few writes (a page, an append, a
// comment, marking read). Every reader goes through `cached` (api.ts) so a
// palette and the bar item share one fetch; a write forgets what it moved.
import { cached, forget, rest, redirectOf, tool, RESEARCH_MS } from "./api.ts";

export type Space = { id: number; name: string; slug: string; visibility: "private" | "public"; description: string; is_personal?: boolean; member_count?: number; created_at: string; updated_at: string };
export type Page = { id: number; space_id: number; parent_id: number | null; title: string; body: string; props?: Record<string, unknown>; created_at: string; updated_at: string };
/** A page named without its body: a listing row, a favourite, a change, a search hit's page. */
export type PageRef = { id: number; space_id: number; title: string; space_name?: string; breadcrumb?: string[]; updated_at?: string; author?: string | null; deck?: boolean; sheet?: boolean };
export type Hit = { page_id: number; space_id: number; title: string; snippet: string; breadcrumb: string[]; public: boolean; url: string };
export type Source = { chunk_id: number; source_kind: "page" | "file"; page_id: number; space_id: number; title: string; heading_path: string; snippet: string; score: number; updated_at: string; file_name?: string; download_url?: string; share_url?: string };
export type Research = { question: string; space?: number; limit: number; context: string; sources: Source[]; disagreements?: string; low_confidence: boolean; considered: number; truncated: boolean; at: number };
export type Backlink = { page_id: number; space_id: number; space_name: string; title: string; breadcrumb: string[]; snippet: string };
export type Comment = { id: number; page_id: number; parent_id: number | null; author_username: string; body: string; anchor_exact?: string | null; resolved: boolean; created_at: string; updated_at: string };
export type Thread = { root: Comment; replies: Comment[]; reply_count?: number; page_title?: string; space_id?: number };
export type Notification = { id: number; type: string; actor_username: string | null; subject_kind: string; subject_id: number; space_id: number | null; data: Record<string, unknown>; read: boolean; created_at: string };

/** Seconds a listing stays good for: the manifest's `ttl` per palette and the caches agree. */
export const TTL = { spaces: 3600, pages: 300, catalog: 3600, page: 120, search: 60, research: 600, links: 300, comments: 60, inbox: 60 } as const;
/** Research asks for this many sources unless told more (tela's default is 12, cap 40). */
export const RESEARCH_LIMIT = 8, RESEARCH_MAX = 40;
/** Notification kinds that are someone addressing you: what the inbox counts. */
export const ADDRESSED = new Set(["mention", "comment_reply"]);

/** tela writes times as `YYYY-MM-DD HH:MM:SS` in UTC without a zone; an ISO string for the UI's relative dates. */
export const iso = (t?: string | null): string | undefined => (t ? (/[TZ]|[+-]\d\d:\d\d$/.test(t) ? t : t.replace(" ", "T") + "Z") : undefined);

// ---- spaces ---------------------------------------------------------------

export const spaces = (refresh = false) => cached<Space[]>("spaces", TTL.spaces * 1000, refresh, async () => (await rest<{ spaces: Space[] }>("GET", "spaces")).spaces);

export async function spaceName(id: number): Promise<string> {
  const s = (await spaces().catch(() => [] as Space[])).find((x) => x.id === id);
  return s?.name ?? `Space ${id}`;
}

/** The space a name, slug or id names (the `default_space` setting), else undefined. */
export async function findSpace(key: string): Promise<Space | undefined> {
  const k = key.trim().toLowerCase();
  if (!k) return undefined;
  const all = await spaces();
  return all.find((s) => String(s.id) === k) ?? all.find((s) => s.slug.toLowerCase() === k) ?? all.find((s) => s.name.toLowerCase() === k);
}

// ---- pages ----------------------------------------------------------------

/** Every page the token can see, by space then title; no bodies. Also the page count per space. */
export const allPages = (refresh = false) => cached<PageRef[]>("pages:all", TTL.pages * 1000, refresh, async () => (await rest<{ pages: PageRef[] }>("GET", "pages/all")).pages);

export async function pageCounts(refresh = false): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  for (const p of await allPages(refresh)) counts.set(p.space_id, (counts.get(p.space_id) ?? 0) + 1);
  return counts;
}

type TreeNode = Page & { children?: TreeNode[] };
/** A space's pages in tree order, each with its breadcrumb (the ancestors' titles) and the deck / sheet flags; bodies dropped. */
export const spaceTree = (space: number, refresh = false) => cached<PageRef[]>(`tree:${space}`, TTL.catalog * 1000, refresh, async () => {
  const { pages } = await rest<{ pages: TreeNode[] }>("GET", `pages?space_id=${space}&tree=1`);
  const out: PageRef[] = [];
  const walk = (nodes: TreeNode[], crumb: string[]) => {
    for (const n of nodes) {
      out.push({ id: n.id, space_id: n.space_id, title: n.title, breadcrumb: crumb, updated_at: n.updated_at, deck: n.props?.deck === true, sheet: n.props?.sheet === true });
      if (n.children?.length) walk(n.children, [...crumb, n.title]);
    }
  };
  walk(pages, []);
  return out;
});

/** Decks (or sheets) across every space: the trees of all spaces, filtered. One request per space, an hour. */
export async function catalog(kind: "deck" | "sheet", refresh = false): Promise<PageRef[]> {
  const all = await spaces(refresh);
  const trees = await Promise.all(all.map((s) => spaceTree(s.id, refresh).then((rows) => rows.map((r) => ({ ...r, space_name: s.name }))).catch(() => [] as PageRef[])));
  return trees.flat().filter((r) => (kind === "deck" ? r.deck : r.sheet));
}

export const recent = (refresh = false) => cached<PageRef[]>("recent", TTL.pages * 1000, refresh, async () =>
  (await rest<{ changes: { page_id: number; title: string; space_id: number; space_name: string; author_username: string | null; updated_at: string }[] }>("GET", "recent-changes?limit=50")).changes
    .map((c) => ({ id: c.page_id, space_id: c.space_id, space_name: c.space_name, title: c.title, updated_at: c.updated_at, author: c.author_username })));

export const favorites = (refresh = false) => cached<PageRef[]>("favorites", TTL.pages * 1000, refresh, async () =>
  (await rest<{ favorites: { page_id: number; title: string; space_id: number; space_name: string; created_at: string }[] }>("GET", "users/me/favorites")).favorites
    .map((f) => ({ id: f.page_id, space_id: f.space_id, space_name: f.space_name, title: f.title })));

export const page = (id: number, refresh = false) => cached<Page>(`page:${id}`, TTL.page * 1000, refresh, async () => (await rest<{ page: Page }>("GET", `pages/${id}`)).page);

export const backlinks = (id: number, refresh = false) => cached<Backlink[]>(`backlinks:${id}`, TTL.links * 1000, refresh, async () => (await rest<{ backlinks: Backlink[] }>("GET", `pages/${id}/backlinks`)).backlinks);

/** The first slide of a deck as tela renders it (a public, content-addressed asset), or undefined when the renderer is not there. */
export const deckCover = (id: number) => cached<string | undefined>(`cover:${id}`, TTL.catalog * 1000, false, () => redirectOf(`pages/${id}/deck/cover`).catch(() => undefined));

// ---- search and research -----------------------------------------------------

export const search = (q: string) => cached<Hit[]>(`search:${q}`, TTL.search * 1000, false, async () => (await rest<{ results: Hit[] }>("GET", `search?q=${encodeURIComponent(q)}`)).results);

/** The MCP `research` tool: the assembled grounding for a question, its sources, disagreements and the confidence flag. */
export const research = (question: string, space?: number, limit = RESEARCH_LIMIT) => cached<Research>(`research:${space ?? ""}:${limit}:${question}`, TTL.research * 1000, false, async () => {
  const r = await tool<Omit<Research, "question" | "space" | "limit" | "at">>("research", { question, ...(space ? { space_id: space } : {}), limit: Math.min(limit, RESEARCH_MAX) }, RESEARCH_MS);
  return { question, space, limit, at: Date.now(), ...r, sources: r.sources ?? [] };
});

/** The `[n] Space › path › Title` excerpts of a research context, by their number. */
export function excerpts(context: string): Map<number, { where: string; body: string }> {
  const out = new Map<number, { where: string; body: string }>();
  const re = /^\[(\d+)\] (.*)$/gm;
  const marks: { n: number; where: string; start: number; end: number }[] = [];
  for (let m = re.exec(context); m; m = re.exec(context)) marks.push({ n: Number(m[1]), where: m[2], start: m.index, end: m.index + m[0].length });
  marks.forEach((m, i) => out.set(m.n, { where: m.where, body: context.slice(m.end, marks[i + 1]?.start ?? context.length).trim() }));
  return out;
}

// ---- comments and notifications ---------------------------------------------

export const threads = (pageId: number, refresh = false) => cached<Thread[]>(`threads:${pageId}`, TTL.comments * 1000, refresh, async () => (await rest<{ threads: Thread[] }>("GET", `pages/${pageId}/comments`)).threads);

export const notifications = (refresh = false) => cached<Notification[]>("notifications", TTL.inbox * 1000, refresh, async () => (await rest<{ notifications: Notification[] }>("GET", "notifications?limit=100")).notifications);

/** The unread that address you (mentions, replies to your comments), newest first. */
export const addressed = async (refresh = false) => (await notifications(refresh)).filter((n) => !n.read && ADDRESSED.has(n.type));

/** The human line for a notification, as tela's own bell writes it. */
export function describe(n: Notification): string {
  const actor = n.actor_username ?? "Someone";
  const title = typeof n.data.page_title === "string" ? n.data.page_title : "a page";
  switch (n.type) {
    case "mention": return `${actor} mentioned you in \u201C${title}\u201D`;
    case "comment_reply": return `${actor} replied to your comment in \u201C${title}\u201D`;
    case "page_updated": return `${actor} updated \u201C${title}\u201D`;
    case "page_created": return `${actor} created \u201C${title}\u201D`;
    case "space_added": return `${actor} added you to ${typeof n.data.space_name === "string" ? n.data.space_name : "a space"}`;
    case "user_registered": return `${typeof n.data.new_display_name === "string" && n.data.new_display_name ? n.data.new_display_name : actor} just signed up`;
    default: return typeof n.data.title === "string" ? `${n.data.title}${typeof n.data.summary === "string" && n.data.summary ? `: ${n.data.summary}` : ""}` : `${actor} sent you a notification`;
  }
}

// ---- writes ---------------------------------------------------------------------

export async function createPage(space: number, title: string, body: string, parent?: number): Promise<Page> {
  const r = await rest<{ page: Page }>("POST", "pages", { space_id: space, title, body, ...(parent ? { parent_id: parent } : {}) });
  forget("recent", "pages:all", `tree:${space}`);
  return r.page;
}

/** Markdown added at the end of the page (a blank line between), through a full-body PATCH: tela has no append call. */
export async function appendToPage(id: number, text: string): Promise<Page> {
  const p = await page(id, true);
  const body = p.body.replace(/\s+$/, "") + (p.body.trim() ? "\n\n" : "") + text.trim() + "\n";
  const r = await rest<{ page: Page }>("PATCH", `pages/${id}`, { body });
  forget(`page:${id}`, "recent");
  return r.page;
}

/** The caller's Quick Notes page, created on first use (tela's `/n`, its one scratchpad). */
export const quickNotes = async () => (await rest<{ page: Page }>("POST", "users/me/quick-notes")).page;

/** A root comment anchored on `exact` (a run of the page's plain text), or a reply to `parent`. */
export async function addComment(pageId: number, body: string, anchor?: { prefix?: string; exact: string; suffix?: string }, parent?: number): Promise<Comment> {
  const r = await rest<{ comment: Comment }>("POST", `pages/${pageId}/comments`, parent ? { body, parent_id: parent } : { body, anchor_prefix: anchor?.prefix ?? "", anchor_exact: anchor?.exact ?? "", anchor_suffix: anchor?.suffix ?? "" });
  forget(`threads:${pageId}`);
  return r.comment;
}

export async function markRead(id: number): Promise<void> {
  await rest("POST", `notifications/${id}/read`);
  forget("notifications");
}
export async function markAllRead(): Promise<void> {
  await rest("POST", "notifications/read-all");
  forget("notifications");
}
