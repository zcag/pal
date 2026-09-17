// The store as data: what pal.cagdas.io's `/api/extensions` answers,
// trimmed to what the rows and the detail pane need (so the cache fits
// the storage cap), matched against the query and the filter, compared
// with what is installed, and rendered as rows and details. Pure; the
// fetch, the clock and the installed list come in as arguments.
import type { Accessory, Action, Detail, Item, Metadata, TileIcon } from "@zcag/pal";

/** One extension as the site lists it, trimmed (`trim`). */
export type Listing = {
  name: string;
  title: string;
  description: string;
  version: string;
  icon?: TileIcon | string;
  author: string;
  url: string;
  tagline: string;
  category: string;
  /** `kind` on the site: `bundled` ships with pal, anything else is a community extension. */
  kind: string;
  screenshots: { url: string; caption: string }[];
  bar: boolean;
  links: boolean;
  multi: boolean;
  features: string[];
  permissions: string[];
  platforms: string[];
  license?: string;
  /** Per palette: its title and key table, for the detail's keys table. */
  palettes: { key: string; title: string; keys: { keys: string; title: string }[] }[];
};

/** What the cache holds: the trimmed list and when it was fetched (unix ms). */
export type Cache = { fetched_at: number; listings: Listing[] };

/** `InstalledExtension` from the core, the part the rows read. */
export type Installed = { name: string; version: string; store: boolean; bundled: boolean };

/** How long a fetched list is good for. */
const CACHE_MS = 60 * 60 * 1000;
/** The description is cut here in the cache; the site page has the rest. */
const DESCRIPTION_MAX = 600;
const FEATURES_MAX = 8;

const CATEGORIES = ["productivity", "developer", "system", "media", "reference", "fun", "integration"] as const;
const CATEGORY_TITLE: Record<string, string> = { productivity: "Productivity", developer: "Developer", system: "System", media: "Media", reference: "Reference", fun: "Fun", integration: "Integration" };
const categoryTitle = (c: string) => CATEGORY_TITLE[c] ?? (c ? c[0].toUpperCase() + c.slice(1) : "Other");

/** The palette's filter dropdown: everything, what is installed, what is behind, then the site's shelves. */
export const FILTERS = [{ id: "all", title: "All" }, { id: "installed", title: "Installed" }, { id: "updates", title: "Updates" }, ...CATEGORIES.map((c) => ({ id: c, title: categoryTitle(c) }))];

const str = (v: unknown, max = Infinity): string => (typeof v === "string" ? (v.length > max ? `${v.slice(0, max - 1)}…` : v) : "");
const strs = (v: unknown, max = Infinity): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);

/** One raw API entry to a `Listing`; `null` for an entry without a name. */
export function trim(raw: unknown): Listing | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const name = str(e.name);
  if (!name) return null;
  const manifest = (e.manifest && typeof e.manifest === "object" ? e.manifest : {}) as Record<string, unknown>;
  const store = (manifest.store && typeof manifest.store === "object" ? manifest.store : {}) as Record<string, unknown>;
  const captions = Array.isArray(store.screenshots) ? store.screenshots.map((s) => (s && typeof s === "object" ? str((s as { caption?: unknown }).caption) : "")) : [];
  const urls = strs(e.panel_screenshots).length ? strs(e.panel_screenshots) : strs(e.screenshots);
  const icon = e.icon && typeof e.icon === "object" && "tile" in (e.icon as object) ? (e.icon as TileIcon) : typeof e.icon === "string" ? e.icon : undefined;
  const palettes = Object.entries((manifest.palettes && typeof manifest.palettes === "object" ? manifest.palettes : {}) as Record<string, Record<string, unknown>>).map(([key, p]) => ({
    key,
    title: str(p?.title) || key,
    keys: Array.isArray(p?.keys) ? (p.keys as { keys?: unknown; title?: unknown }[]).filter((k) => k && typeof k.keys === "string" && typeof k.title === "string").map((k) => ({ keys: k.keys as string, title: k.title as string })) : [],
  }));
  return {
    name,
    title: str(e.title) || name,
    description: str(e.description, DESCRIPTION_MAX),
    version: str(e.version),
    icon,
    author: str(e.author),
    url: str(e.url) || `https://pal.cagdas.io/extensions/${name}`,
    tagline: str(e.tagline) || str(e.description).split(/(?<=\.)\s/)[0] || "",
    category: str(e.category),
    kind: str(e.kind) || "community",
    screenshots: urls.map((url, i) => ({ url, caption: captions[i] ?? "" })),
    bar: e.has_bar === true,
    links: e.has_links === true,
    multi: e.multi === true,
    features: strs(store.features, FEATURES_MAX),
    permissions: strs(store.permissions),
    platforms: strs(store.platforms),
    license: str(manifest.license) || undefined,
    palettes,
  };
}

/** The API's `{ extensions: [...] }` (or a bare array) to listings, by title. */
export function trimAll(body: unknown): Listing[] {
  const list = Array.isArray(body) ? body : body && typeof body === "object" && Array.isArray((body as { extensions?: unknown }).extensions) ? (body as { extensions: unknown[] }).extensions : [];
  return list.map(trim).filter((l): l is Listing => l !== null).sort((a, b) => a.title.localeCompare(b.title));
}

/** Whether a cache fetched at `at` still counts at `now`. */
export const fresh = (c: Cache | null | undefined, now: number): c is Cache => !!c && now - c.fetched_at < CACHE_MS;

/** `a` newer than `b`: dotted numbers compared in order, a pre-release word older than the number it stands beside; an empty version never compares newer. */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) => v.trim().replace(/^v/, "").split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const [x, y] = [parse(a), parse(b)];
  if (!a.trim() || !b.trim()) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const [p, q] = [x[i] ?? 0, y[i] ?? 0];
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p > q;
    // A word where the other has a number (or nothing): a pre-release, older than the release.
    if (typeof p === "number") return true;
    if (typeof q === "number") return false;
    return p > q;
  }
  return false;
}

/** How one listing stands against the machine: not installed, bundled with pal, or from the store (and behind when the site is newer). */
type Standing = { installed?: Installed; behind: boolean };
export function standing(l: Listing, installed: Installed[]): Standing {
  const i = installed.find((x) => x.name === l.name);
  return { installed: i, behind: !!i && i.store && newer(l.version, i.version) };
}

/** What the query is matched against: name, title, tagline, category, author. */
const haystack = (l: Listing) => [l.name, l.title, l.tagline, l.category, l.author, ...l.palettes.map((p) => p.title)].join(" ").toLowerCase();

/** The listings the filter admits, narrowed by every word of the query. */
export function select(listings: Listing[], installed: Installed[], filter: string | undefined, query: string): Listing[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return listings.filter((l) => {
    const s = standing(l, installed);
    if (filter === "installed" && !s.installed) return false;
    if (filter === "updates" && !s.behind) return false;
    if (filter && filter !== "all" && filter !== "installed" && filter !== "updates" && l.category !== filter) return false;
    const h = haystack(l);
    return words.every((w) => h.includes(w));
  });
}

const INSTALL: Action = { id: "install", title: "Install" };
const UPDATE: Action = { id: "update", title: "Update" };
const REMOVE: Action = { id: "remove", title: "Remove", shortcut: "ctrl+x", style: "destructive" };
const PAGE: Action = { id: "page", title: "Open store page" };
const COPY_COMMAND: Action = { id: "copy-command", title: "Copy install command", shortcut: "cmd+c" };

/** The row's actions by standing: Install first while absent, Update first while behind, the store page for a bundled one. */
export function actionsFor(l: Listing, s: Standing): Action[] {
  if (!s.installed) return [{ ...INSTALL, confirm: `Install ${l.title} from pal.cagdas.io?` }, { ...PAGE, shortcut: "cmd+enter" }, COPY_COMMAND];
  if (s.installed.store) {
    const update = { ...UPDATE, confirm: `Update ${l.title} to ${l.version}? Its source is fetched again.` };
    return [...(s.behind ? [update, { ...PAGE, shortcut: "cmd+enter" }] : [PAGE, { ...update, shortcut: "cmd+enter" }]), { ...REMOVE, confirm: `Remove ${l.title}? Its directory is deleted; its settings stay in the config file.` }, COPY_COMMAND];
  }
  return [PAGE, COPY_COMMAND];
}

/** The row: the tile, the title, the tagline, the chips. `section` puts it under a heading (Updates). */
export function row(l: Listing, s: Standing, section?: string): Item {
  const accessories: Accessory[] = [];
  if (l.bar) accessories.push({ tag: "menu bar", color: "blue" });
  if (l.links) accessories.push({ tag: "links", color: "violet" });
  if (l.multi) accessories.push({ tag: "accounts", color: "teal" });
  if (s.behind) accessories.push({ tag: `update to ${l.version}`, color: "amber" });
  else if (s.installed?.bundled) accessories.push({ tag: "bundled", color: "grey" });
  else if (s.installed) accessories.push({ tag: "installed", color: "green" });
  if (l.category) accessories.push({ text: categoryTitle(l.category) });
  return {
    id: l.name,
    name: l.title,
    subtitle: l.tagline,
    icon: l.icon,
    keywords: [l.name, l.author, l.category].filter(Boolean),
    accessories,
    ...(section && { section }),
    actions: actionsFor(l, s),
  };
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The detail pane: description, features, screenshots, the keys per palette; the facts as metadata. */
export function detail(l: Listing, s: Standing): Detail {
  const parts: string[] = [`# ${l.title}`, "", l.description || l.tagline];
  if (l.features.length) parts.push("", "## What it does", "", ...l.features.map((f) => `- ${f}`));
  if (l.screenshots.length) parts.push("", ...l.screenshots.map((sh) => `![${esc(sh.caption)}](${sh.url})`));
  for (const p of l.palettes) {
    if (!p.keys.length) continue;
    parts.push("", `## ${p.title}`, "", "| key | does |", "| --- | --- |", ...p.keys.map((k) => `| \`${esc(k.keys)}\` | ${esc(k.title)} |`));
  }
  const metadata: Metadata[] = [
    ...(l.author ? [{ label: "Author", value: l.author }] : []),
    { label: "Version", value: s.installed ? (s.behind ? `${l.version} (installed ${s.installed.version})` : s.installed.bundled ? `${l.version}, bundled` : `${l.version}, installed`) : l.version || "unstated" },
    ...(l.category ? [{ label: "Category", value: categoryTitle(l.category) }] : []),
    ...(l.license ? [{ label: "License", value: l.license }] : []),
    ...(l.platforms.length ? [{ label: "Platforms", value: l.platforms.join(", ") }] : []),
    { label: "Needs", value: l.permissions.length ? l.permissions.join(", ") : "nothing beyond the panel" },
    { label: "Install", value: `pal install ${l.name}` },
    { label: "Page", link: { text: "pal.cagdas.io", href: l.url } },
  ];
  return { markdown: parts.join("\n"), metadata };
}

/** "Showing the list from N min ago" for a stale cache shown while the site is unreachable. */
export function staleNote(fetchedAt: number, now: number): string {
  const min = Math.max(1, Math.round((now - fetchedAt) / 60_000));
  if (min < 60) return `Showing the list from ${min} min ago`;
  const h = Math.round(min / 60);
  return `Showing the list from ${h} ${h === 1 ? "hour" : "hours"} ago`;
}
