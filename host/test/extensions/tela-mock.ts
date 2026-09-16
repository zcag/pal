// A mock tela instance for the tests and the screenshot fixture: the REST
// routes the extension reads and writes over fixture data (never the
// owner's), and `/api/mcp` as the Streamable HTTP transport (a session
// opened by `initialize`, `tools/call research` answered as an event
// stream). `state` flips the failure modes; `seen` records every request.

// ---- fixtures ---------------------------------------------------------------

export const SPACES = [
  { id: 1, name: "Notes", slug: "notes", visibility: "private", description: "", is_personal: true, member_count: 1, created_at: "2026-01-01 10:00:00", updated_at: "2026-09-15 08:00:00" },
  { id: 2, name: "Engineering", slug: "eng", visibility: "private", description: "How the systems are built and run", is_personal: false, member_count: 6, created_at: "2026-02-01 10:00:00", updated_at: "2026-09-16 09:00:00" },
  { id: 3, name: "Blog", slug: "blog", visibility: "public", description: "Published posts", is_personal: false, member_count: 2, created_at: "2026-03-01 10:00:00", updated_at: "2026-09-10 09:00:00" },
];

const RICH = `---
summary: The indexing pipeline end to end.
review_every: 30
---
# Indexing

Every listing is **persisted** to the data dir and restored at the next start, see [[Startup]] and the [design note](https://example.com/design).

> [!NOTE] Why persist
> The first query answers at 400 ms cold instead of 10 s.

## Steps

1. Restore the cache
2. Spawn the host
3. Relist what expired

- \`ttl\` is palette meta
- \`live\` relists on show
  - not twice within 2 s
- [x] done: the budget
- [ ] open: the Linux bar

| palette | ttl | kind |
|---|---:|---|
| prs | 300 | list |
| notifications | 60 | live |

\`\`\`ts
const gap = 2000;
\`\`\`

:::quote{cite="the brief"}
Paint first, fetch later.
:::

<details><summary>Numbers</summary>

Hotkey to paint 1.7 ms.

</details>

---
![the pipeline](https://example.com/pipeline.png)
`;

export const PAGES: Record<number, { id: number; space_id: number; parent_id: number | null; title: string; body: string; props: Record<string, unknown>; created_at: string; updated_at: string }> = {
  10: { id: 10, space_id: 2, parent_id: null, title: "Indexing", body: RICH, props: { summary: "The indexing pipeline end to end." }, created_at: "2026-09-01 10:00:00", updated_at: "2026-09-16 09:00:00" },
  11: { id: 11, space_id: 2, parent_id: 10, title: "Startup", body: "# Startup\n\nThe host spawns after [[Indexing]] restores the cache.", props: {}, created_at: "2026-09-02 10:00:00", updated_at: "2026-09-15 12:00:00" },
  12: { id: 12, space_id: 2, parent_id: null, title: "Release Talk", body: "---\nlayout: cover\ntitle: Release\n---\n\n# Release\n\n---\n\n## Numbers", props: { deck: true }, created_at: "2026-09-03 10:00:00", updated_at: "2026-09-14 12:00:00" },
  13: { id: 13, space_id: 2, parent_id: null, title: "Budget", body: "| item | cost |\n|---|---|\n| host | 3 |\n", props: { sheet: true }, created_at: "2026-09-03 10:00:00", updated_at: "2026-09-13 12:00:00" },
  20: { id: 20, space_id: 1, parent_id: null, title: "Quick Notes", body: "- call the bank\n", props: {}, created_at: "2026-09-01 10:00:00", updated_at: "2026-09-16 07:00:00" },
  21: { id: 21, space_id: 1, parent_id: null, title: "Reading list", body: "# Reading\n\n- Data & Databases\n", props: {}, created_at: "2026-09-01 10:00:00", updated_at: "2026-09-12 07:00:00" },
  30: { id: 30, space_id: 3, parent_id: null, title: "How we ship", body: "# How we ship\n\nWeekly.", props: {}, created_at: "2026-08-01 10:00:00", updated_at: "2026-09-10 07:00:00" },
};
const treeOf = (space: number) => {
  const nodes = Object.values(PAGES).filter((p) => p.space_id === space);
  const node = (p: (typeof nodes)[number]): unknown => ({ ...p, exposure: null, children: nodes.filter((c) => c.parent_id === p.id).map(node) });
  return nodes.filter((p) => p.parent_id === null).map(node);
};
const crumb = (p: (typeof PAGES)[number]): string[] => (p.parent_id ? [...crumb(PAGES[p.parent_id]), PAGES[p.parent_id].title] : []);
/** A `ts_headline`-like passage: the words around the first hit, the hit wrapped in `<mark>`, over a lightly de-marked body. */
const snippet = (body: string, q: string) => {
  const text = body.replace(/^---[\s\S]*?---\n/, "").replace(/\[!\w+\]/g, "").replace(/[#>*`|\[\]]/g, "").replace(/\s+/g, " ").trim();
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return `the <mark>${q}</mark> passage`;
  const from = Math.max(0, text.lastIndexOf(" ", i - 40) + 1), to = Math.min(text.length, text.indexOf(" ", i + q.length + 40));
  const win = text.slice(from, to === -1 ? undefined : to);
  return win.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), (m) => `<mark>${m}</mark>`);
};
const nameOf = (space: number) => SPACES.find((s) => s.id === space)!.name;

export const RECENT = [
  { page_id: 10, title: "Indexing", space_id: 2, space_name: "Engineering", author_username: "mara", updated_at: "2026-09-16 09:00:00" },
  { page_id: 20, title: "Quick Notes", space_id: 1, space_name: "Notes", author_username: "cagdas", updated_at: "2026-09-16 07:00:00" },
  { page_id: 11, title: "Startup", space_id: 2, space_name: "Engineering", author_username: null, updated_at: "2026-09-15 12:00:00" },
  { page_id: 30, title: "How we ship", space_id: 3, space_name: "Blog", author_username: "tomas", updated_at: "2026-09-10 07:00:00" },
];
export const FAVORITES = [{ page_id: 21, title: "Reading list", space_id: 1, space_name: "Notes", created_at: "2026-09-05 10:00:00" }, { page_id: 10, title: "Indexing", space_id: 2, space_name: "Engineering", created_at: "2026-09-06 10:00:00" }];

export let NOTIFICATIONS = [
  { id: 901, type: "mention", actor_username: "mara", subject_kind: "page", subject_id: 10, space_id: 2, data: { page_title: "Indexing", actor_username: "mara", snippet: "@cagdas is the 2 s budget still right?" }, read: false, created_at: "2026-09-16 09:30:00" },
  { id: 902, type: "comment_reply", actor_username: "tomas", subject_kind: "page", subject_id: 30, space_id: 3, data: { page_title: "How we ship", actor_username: "tomas", snippet: "agreed, weekly it is" }, read: false, created_at: "2026-09-16 08:30:00" },
  { id: 903, type: "page_updated", actor_username: "mara", subject_kind: "page", subject_id: 10, space_id: 2, data: { page_title: "Indexing", actor_username: "mara" }, read: false, created_at: "2026-09-16 08:00:00" },
  { id: 904, type: "user_registered", actor_username: "newbie", subject_kind: "user", subject_id: 77, space_id: null, data: { new_username: "newbie" }, read: false, created_at: "2026-09-15 08:00:00" },
  { id: 905, type: "mention", actor_username: "lina", subject_kind: "page", subject_id: 11, space_id: 2, data: { page_title: "Startup", actor_username: "lina", snippet: "@cagdas see the order" }, read: true, created_at: "2026-09-14 08:00:00" },
];

export const RESEARCH = {
  context: `[1] Engineering › Indexing\n# Indexing\n\nEvery listing is **persisted** and restored, see [[Startup]].\n\n> [!NOTE] Why persist\n> 400 ms cold.\n\n[2] Engineering › Indexing › Startup\nThe host spawns after the cache restores.\n\n[3] Blog › How we ship\nWeekly.`,
  sources: [
    { chunk_id: 501, source_kind: "page", page_id: 10, space_id: 2, title: "Indexing", heading_path: "Indexing > Steps", snippet: "Every listing is persisted to the data dir", score: 0.9, updated_at: "2026-09-16 09:00:00" },
    { chunk_id: 502, source_kind: "page", page_id: 11, space_id: 2, title: "Startup", heading_path: "", snippet: "The host spawns after the cache restores", score: 0.7, updated_at: "2026-09-15 12:00:00" },
    { chunk_id: 503, source_kind: "page", page_id: 30, space_id: 3, title: "How we ship", heading_path: "How we ship", snippet: "Weekly.", score: 0.2, updated_at: "2026-09-10 07:00:00" },
  ],
  disagreements: "[1] says the budget is 2 s, [2] says 1 s.",
  low_confidence: true,
  considered: 9,
  truncated: true,
};

// ---- the mock instance ----------------------------------------------------------

type Seen = { method: string; path: string; body?: any; session?: string | null };
export const seen: Seen[] = [];
/** Knobs the tests turn: the session the server knows, an instance without an embedder, one that is down; `inits` counts initializes. */
export const state = { inits: 0, sessionOk: "sess-1", ragDisabled: false, down: false };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(data, { status, headers });
const sse = (msg: unknown, headers: Record<string, string> = {}) => new Response(`event: message\ndata: ${JSON.stringify(msg)}\n\n`, { headers: { "content-type": "text/event-stream", ...headers } });

export const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const rec: Seen = { method: req.method, path: url.pathname + url.search, session: req.headers.get("mcp-session-id") };
    let body: any;
    if (req.method !== "GET") { try { body = await req.json(); rec.body = body; } catch {} }
    seen.push(rec);
    if (state.down) return new Response(null, { status: 502 });
    const auth = req.headers.get("authorization");
    if (auth !== "Bearer test-token") return json({ error: auth === "Bearer expired-token" ? "token expired" : "unauthorized", code: "unauthorized", status: 401 }, 401);
    const p = url.pathname;
    if (p === "/api/mcp") {
      if (body?.method === "initialize") { state.inits++; return sse({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "tela" } } }, { "mcp-session-id": state.sessionOk }); }
      if (rec.session !== state.sessionOk) return json({ error: "session not found" }, 404);
      if (body?.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (body?.method === "tools/call" && body.params?.name === "research") {
        if (state.ragDisabled) return sse({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "semantic search is not configured", code: "rag_disabled", status: 503 }) }] } });
        const limit = body.params.arguments.limit ?? 12;
        return sse({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "{}" }], structuredContent: { ...RESEARCH, sources: RESEARCH.sources.slice(0, limit), truncated: limit < 16 } } });
      }
      return sse({ jsonrpc: "2.0", id: body?.id, error: { code: -32601, message: "unknown method" } });
    }
    let m: RegExpExecArray | null;
    if (req.method === "GET") {
      if (p === "/api/spaces") return json({ spaces: SPACES });
      if (p === "/api/pages/all") return json({ pages: Object.values(PAGES).map((x) => ({ id: x.id, space_id: x.space_id, space_name: nameOf(x.space_id), title: x.title, breadcrumb: crumb(x) })) });
      if (p === "/api/pages") return json({ pages: treeOf(Number(url.searchParams.get("space_id"))) });
      if (p === "/api/recent-changes") return json({ changes: RECENT });
      if (p === "/api/users/me/favorites") return json({ favorites: FAVORITES });
      if (p === "/api/notifications") return json({ notifications: NOTIFICATIONS });
      if (p === "/api/search") {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        const hits = Object.values(PAGES).filter((x) => x.body.toLowerCase().includes(q) || x.title.toLowerCase().includes(q)).map((x) => ({ page_id: x.id, space_id: x.space_id, title: x.title, snippet: snippet(x.body, q), breadcrumb: crumb(x), public: x.space_id === 3, url: `http://tela.test/spaces/${x.space_id}/pages/${x.id}`, id: String(x.id), text: "" }));
        return json({ results: hits });
      }
      if ((m = /^\/api\/pages\/(\d+)\/backlinks$/.exec(p))) {
        const id = Number(m[1]);
        const links = Object.values(PAGES).filter((x) => x.body.includes(`[[${PAGES[id]?.title}]]`)).map((x) => ({ page_id: x.id, space_id: x.space_id, space_name: nameOf(x.space_id), title: x.title, breadcrumb: crumb(x), snippet: `links to <mark>${PAGES[id].title}</mark>` }));
        return json({ backlinks: links });
      }
      if ((m = /^\/api\/pages\/(\d+)\/comments$/.exec(p))) return json({ threads: [] });
      if ((m = /^\/api\/pages\/(\d+)\/deck\/cover$/.exec(p))) return PAGES[Number(m[1])]?.props.deck ? new Response(null, { status: 302, headers: { location: "/api/deck/d/abc/cover.png" } }) : json({ error: "not a deck", code: "not_found" }, 404);
      if ((m = /^\/api\/pages\/(\d+)$/.exec(p))) { const x = PAGES[Number(m[1])]; return x ? json({ page: x, exposure: null }) : json({ error: "page not found", code: "not_found" }, 404); }
    }
    if (req.method === "POST" && p === "/api/pages") { const id = 99; PAGES[id] = { id, space_id: body.space_id, parent_id: body.parent_id ?? null, title: body.title, body: body.body, props: {}, created_at: "2026-09-16 10:00:00", updated_at: "2026-09-16 10:00:00" }; return json({ page: PAGES[id] }, 201); }
    if (req.method === "PATCH" && (m = /^\/api\/pages\/(\d+)$/.exec(p))) { const x = PAGES[Number(m[1])]; if (body.body !== undefined) x.body = body.body; if (body.title !== undefined) x.title = body.title; return json({ page: x }); }
    if (req.method === "POST" && p === "/api/users/me/quick-notes") return json({ page: PAGES[20] });
    if (req.method === "POST" && (m = /^\/api\/pages\/(\d+)\/comments$/.exec(p))) {
      if (!body.parent_id && !body.anchor_exact) return json({ error: "root comments require anchor_prefix, anchor_exact, anchor_suffix", code: "comment_no_anchor" }, 400);
      return json({ comment: { id: 7, page_id: Number(m[1]), parent_id: body.parent_id ?? null, author_username: "cagdas", body: body.body, resolved: false, created_at: "2026-09-16 10:00:00", updated_at: "2026-09-16 10:00:00" } }, 201);
    }
    if (req.method === "POST" && (m = /^\/api\/notifications\/(\d+)\/read$/.exec(p))) { NOTIFICATIONS = NOTIFICATIONS.map((n) => (n.id === Number(m![1]) ? { ...n, read: true } : n)); return json({ ok: true }); }
    if (req.method === "POST" && p === "/api/notifications/read-all") { NOTIFICATIONS = NOTIFICATIONS.map((n) => ({ ...n, read: true })); return json({ ok: true }); }
    return json({ error: `no fixture for ${req.method} ${p}`, code: "not_found" }, 404);
  },
});


export const BASE = `http://127.0.0.1:${server.port}`;
export const calls = (method: string, path: string) => seen.filter((s) => s.method === method && s.path.startsWith(path));
/** The extension's settings pointed at the mock. */
export const SETTINGS = { base_url: BASE, token: "test-token", default_space: "eng", research: true };
/** Marks every notification read (or the two addressed ones unread again). */
export const setRead = (pred: (n: (typeof NOTIFICATIONS)[number]) => boolean, read: boolean) => { NOTIFICATIONS = NOTIFICATIONS.map((n) => (pred(n) ? { ...n, read } : n)); };
