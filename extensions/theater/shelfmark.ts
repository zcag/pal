// Shelfmark, the book request door: a search on its metadata provider
// (Hardcover by default), the releases it finds for a book (Prowlarr's
// indexers and its direct sources), and the download that puts the book
// into the ebook library. With nothing typed, what it is downloading now.
// No auth (the instance is reachable on the LAN alone).
import { bytes, hint, tinted, toast, truncate, type Ctx, type Effect, type Item } from "@zcag/pal";
import { api, cached, conf, configured, GLYPH, type Tag } from "./http.ts";
import { guard, pickHint, setupRow } from "./rows.ts";

export type Book = { id: string; title: string; author?: string; year?: string | number; preview?: string; provider?: string; provider_id?: string; subtitle?: string; series_name?: string; series_position?: number; series_count?: number; source_url?: string; publisher?: string; language?: string; format?: string };
export type Release = { source: string; source_id: string; title: string; format?: string; size?: string; size_bytes?: number; download_url?: string; protocol?: string; indexer?: string; seeders?: number; language?: string; extra?: unknown };
type StatusEntry = { id: string; title?: string; author?: string; progress?: number; status?: string; error?: string; format?: string; size?: string };
export type Status = Record<string, Record<string, StatusEntry>>;

export const shelfmarkUrl = () => conf("shelfmark").url;
export const status = (refresh = false) => cached("shelfmark:status", 15_000, refresh, () => api<Status>("shelfmark", "/api/status", { timeout: 3500 }));
export const search = async (q: string) => api<{ books: Book[]; total_found?: number; provider?: string }>("shelfmark", "/api/metadata/search", { query: { query: q, limit: 20, sort: "relevance", page: 1, content_type: "ebook" }, timeout: 30_000 });
export const releases = async (b: Book) => (await api<{ releases: Release[] }>("shelfmark", "/api/releases", { query: { provider: b.provider ?? "hardcover", book_id: b.provider_id ?? b.id, title: b.title, author: b.author, content_type: "ebook" }, timeout: 60_000 })).releases;
/** The download, as Shelfmark's own Download button posts it: the book, the release, and the context that names the source. */
export const download = (b: Book, r: Release) => api("shelfmark", "/api/releases/download", {
  body: {
    book_data: { title: b.title, author: b.author ?? "Unknown author", content_type: "ebook", provider: b.provider ?? "hardcover", provider_id: b.provider_id ?? b.id, year: b.year, preview: b.preview, series_name: b.series_name, series_position: b.series_position, series_count: b.series_count, subtitle: b.subtitle, source_url: b.source_url },
    release_data: { source: r.source, source_id: r.source_id, title: b.title || r.title, author: b.author, year: b.year, format: r.format, size: r.size, size_bytes: r.size_bytes, download_url: r.download_url, protocol: r.protocol, indexer: r.indexer, seeders: r.seeders, extra: r.extra, preview: b.preview, content_type: "ebook", series_name: b.series_name, series_position: b.series_position, series_count: b.series_count, subtitle: b.subtitle, language: r.language },
    context: { source: r.source, content_type: "ebook", request_level: "release" },
  },
  text: true,
});

const books = new Map<string, Book>();
const found = new Map<string, Release>();

const STATE: Record<string, Tag> = { downloading: { text: "downloading", color: "blue" }, queued: { text: "queued", color: "grey" }, locating: { text: "locating", color: "amber" }, resolving: { text: "resolving", color: "amber" }, complete: { text: "done", color: "green" }, error: { text: "failed", color: "red" }, cancelled: { text: "cancelled", color: "grey" } };

function statusRows(st: Status): Item[] {
  const rows: Item[] = [];
  for (const [state, entries] of Object.entries(st)) for (const e of Object.values(entries)) {
    const s = STATE[state] ?? { text: state, color: "grey" };
    rows.push({ id: `status:${e.id}`, name: e.title ?? e.id, subtitle: [e.author, e.format, e.size, e.error ? truncate(e.error, 80) : ""].filter(Boolean).join(" · "), icon: tinted(GLYPH.shelfmark, s.color === "red" ? "red" : s.color === "green" ? "green" : "teal"), section: "Shelfmark is working on", accessories: [{ tag: s.text, color: s.color }, ...(e.progress ? [{ text: `${Math.round(e.progress)}%` }] : [])], actions: [{ id: "open", title: "Open Shelfmark" }] });
  }
  return rows;
}

export function bookRow(b: Book): Item {
  books.set(b.id, b);
  return {
    id: `book:${b.id}`,
    name: b.title,
    subtitle: [b.author, b.year, b.series_name ? `${b.series_name}${b.series_position ? ` #${b.series_position}` : ""}` : "", b.publisher].filter(Boolean).join(" · "),
    icon: b.preview ? { image: b.preview } : GLYPH.kavita,
    keywords: [b.author ?? "", "book", "ebook"].filter(Boolean),
    section: "Books",
    detail: { markdown: [b.preview ? `![cover](${b.preview})` : "", `**${b.title}**${b.subtitle ? `\n\n${b.subtitle}` : ""}`].filter(Boolean).join("\n\n"), metadata: [...(b.author ? [{ label: "Author", value: b.author }] : []), ...(b.year ? [{ label: "Year", value: String(b.year) }] : []), ...(b.series_name ? [{ label: "Series", value: `${b.series_name}${b.series_position ? ` #${b.series_position}` : ""}` }] : []), ...(b.provider ? [{ label: "Provider", value: b.provider }] : []), ...(b.source_url ? [{ label: "Page", link: { text: "Open", href: b.source_url } }] : [])] },
    actions: [{ id: "releases", title: "Find releases" }, { id: "open", title: "Open Shelfmark", shortcut: "cmd+enter" }, ...(b.source_url ? [{ id: "page", title: "Open the book's page", shortcut: "cmd+o" }] : [])],
  };
}

export async function searchRows(q: string): Promise<Item[]> {
  if (!configured("shelfmark")) return [setupRow("shelfmark")];
  const query = q.trim();
  if (query.length < 3) {
    return guard(async () => {
      const rows = statusRows(await status(true).catch(() => ({} as Status)));
      return [hint("search", "Request a book", "Type a title or an author; Enter on a book lists the releases found for it", { icon: GLYPH.shelfmark }), ...rows];
    });
  }
  return guard(async () => {
    const r = await search(query);
    const rows = r.books.map(bookRow);
    return rows.length ? rows : [hint("none", `Nothing on ${r.provider ?? "the provider"}`, `No book matches “${query}”; a different spelling, or the author alone, may`, { icon: GLYPH.shelfmark })];
  });
}

/** The releases level, pushed with `{ book }`: format, size, source, seeders; Enter downloads. */
export async function releaseRows(ctx?: Ctx): Promise<Item[]> {
  const args = ctx?.args as { book?: string } | undefined;
  const b = args?.book ? books.get(args.book) : undefined;
  if (!b) return [];
  return guard(async () => {
    const list = await releases(b);
    const rows = list.map((r, i): Item => {
      const key = `${b.id}:${i}`;
      found.set(key, r);
      const torrent = r.protocol === "torrent";
      return {
        id: `release:${key}`,
        name: r.title,
        subtitle: [r.format?.toUpperCase(), r.size ?? (r.size_bytes ? bytes(r.size_bytes) : ""), r.language, r.indexer ?? r.source].filter(Boolean).join(" · "),
        icon: tinted(torrent ? GLYPH.qbit : r.protocol === "usenet" ? GLYPH.sab : GLYPH.shelfmark, torrent ? "blue" : "amber"),
        keywords: [r.format ?? "", r.source, r.indexer ?? ""].filter(Boolean),
        section: r.indexer ?? r.source,
        accessories: [{ tag: r.source, color: torrent ? "blue" : "amber" }, ...(torrent && r.seeders !== undefined ? [{ text: `${r.seeders} seeds` }] : [])],
        actions: [{ id: "download", title: "Download into the library", confirm: `Download ${truncate(r.title, 60)} (${r.format ?? "?"}) through Shelfmark?` }, { id: "copy", title: "Copy release title", shortcut: "cmd+c" }],
      };
    });
    return rows.length ? rows : [hint("none", "No release found", `No indexer has ${b.title}; usenet is thin for books, a torrent indexer on Prowlarr helps`, { icon: GLYPH.shelfmark })];
  });
}

export async function pick(id: string, action?: string, _ctx?: Ctx): Promise<Effect | void> {
  if (id.startsWith("hint:")) return pickHint(id);
  if (id.startsWith("status:")) return { open: shelfmarkUrl() };
  if (id.startsWith("book:")) {
    const b = books.get(id.slice(5));
    if (!b) throw new Error("that book is gone; search again");
    if (action === "open") return { open: shelfmarkUrl() };
    if (action === "page") return { open: b.source_url ?? shelfmarkUrl() };
    return { push: { extension: "theater", palette: "shelfmark-releases", args: { book: b.id }, title: `Releases for ${truncate(b.title, 30)}` } };
  }
  if (id.startsWith("release:")) {
    const key = id.slice(8), r = found.get(key), b = books.get(key.slice(0, key.lastIndexOf(":")));
    if (!r || !b) throw new Error("that release is gone; search again");
    if (action === "copy") return { copy: r.title };
    try { await download(b, r); return { hud: `Downloading ${truncate(b.title, 40)}` }; } catch (e) { return toast("Could not download", String((e as Error).message), "failure"); }
  }
}

export async function health() {
  const st = await status(true);
  const active = Object.keys(st.downloading ?? {}).length + Object.keys(st.queued ?? {}).length, failed = Object.keys(st.error ?? {}).length;
  return { version: "", note: [active ? `${active} downloading` : "idle", failed ? `${failed} failed` : ""].filter(Boolean).join(" · "), url: shelfmarkUrl(), warn: failed > 0 };
}
