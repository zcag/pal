// The store as data: the core's `StoreState` (every extension the
// registries list, how each installed one stands with the one update
// check, the registries' health) matched against the query and the filter
// and rendered as rows and details. Nothing is compared here: an update is
// what the core says is one. Pure; the state and the clock come in as
// arguments.
import type { Accessory, Action, AvailableExtension, Detail, Item, Metadata, StoreBuildInfo, StoreRegistry, StoreState, StoreStatus, TileIcon } from "@zcag/pal";

/** Where Settings keeps the registries (the Registries section of Settings › Extensions). */
export const REGISTRIES_LINK = "pal://settings/extensions?anchor=extensions:registries";
/** pal's site has a page per extension of its own registry. */
const SITE = "https://pal.cagdas.io/extensions";

const CATEGORIES = ["productivity", "developer", "system", "media", "reference", "fun", "integration"] as const;
const CATEGORY_TITLE: Record<string, string> = { productivity: "Productivity", developer: "Developer", system: "System", media: "Media", reference: "Reference", fun: "Fun", integration: "Integration" };
export const categoryTitle = (c: string) => CATEGORY_TITLE[c] ?? (c ? c[0].toUpperCase() + c.slice(1) : "Other");
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The Featured section: extensions worth meeting first, one per kind of
 * thing pal does, in order; the first three not installed that install
 * here show. Settings' Browse (app/src/ui/SettingsStore.tsx FEATURED)
 * keeps the same list.
 */
export const FEATURED = ["spotify", "github", "solitaire", "calendar", "translate", "space", "hue", "typing"];

/** What an extension does, a line each (`store.features`); a listing from an index older than 0.9 has none (the field may be missing altogether from an older core). */
export const featuresOf = (a: AvailableExtension): string[] => (a.listing.features ?? []).filter((f) => typeof f === "string" && !!f.trim());

/** The filter dropdown: everything, what is installed, what has an update, the registries, then the shelves. */
export const FILTERS = [{ id: "all", title: "All" }, { id: "installed", title: "Installed" }, { id: "updates", title: "Updates" }, { id: "registries", title: "Registries" }, ...CATEGORIES.map((c) => ({ id: c, title: categoryTitle(c) }))];

/** How one listed extension stands on this machine: the core's status when installed, and whether it has something to install. */
export type Standing = { a: AvailableExtension; status?: StoreStatus; ours: boolean; busy: boolean };

/** The build an Update would install: an update, or a pulled build's replacement. */
export const targetOf = (s: StoreStatus | undefined) => (s?.state === "update" ? s.to : s?.state === "yanked" ? s.replacement ?? undefined : undefined);

/** Every listed extension with its standing; a name two registries list shows once per registry. */
export function standings(state: StoreState): Standing[] {
  const ours = new Set(state.registries.filter((r) => r.ours).map((r) => r.name));
  return state.available.map((a) => {
    const status = state.statuses.find((s) => s.name === a.name);
    // The installed copy is this row's only when it came from this registry (a bundled one counts as ours).
    const mine = a.installed && (!status?.registry || status.registry === a.registry || (status.origin === "bundled" && ours.has(a.registry)));
    return { a, status: mine ? status : undefined, ours: ours.has(a.registry), busy: state.busy.includes(a.name) };
  });
}

/** What the query is matched against: name, title, tagline, category, author, keywords, palette titles. */
const haystack = (a: AvailableExtension) => [a.name, a.listing.title, a.listing.tagline, a.listing.category, a.listing.author, a.registry, ...a.listing.keywords, ...a.listing.palettes.map((p) => p.title)].join(" ").toLowerCase();

const titleOf = (s: Standing) => (s.a.listing.title || s.a.name).toLowerCase();
/** 0 when every word starts a word of the title, 1 when one is inside it, 2 otherwise: what a search puts first. */
const titleRank = (s: Standing, words: string[]) => {
  const t = titleOf(s);
  const starts = t.split(/[^\p{L}\p{N}]+/u);
  return !words.length || words.every((w) => starts.some((x) => x.startsWith(w))) ? 0 : words.some((w) => t.includes(w)) ? 1 : 2;
};

/** The standings the filter admits, narrowed by every word of the query: the title's matches first, then by title. */
export function select(all: Standing[], filter: string | undefined, query: string): Standing[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((s) => {
    if (filter === "installed" && !s.a.installed) return false;
    if (filter === "updates" && !targetOf(s.status)) return false;
    if (filter && !["all", "installed", "updates"].includes(filter) && s.a.listing.category !== filter) return false;
    const h = haystack(s.a);
    return words.every((w) => h.includes(w));
  }).sort((x, y) => titleRank(x, words) - titleRank(y, words) || titleOf(x).localeCompare(titleOf(y)));
}

/** The Featured section's standings: FEATURED's names that are listed, not installed and install here, the first `n`. */
export const featured = (all: Standing[], n = 3): Standing[] =>
  FEATURED.map((name) => all.find((s) => s.a.name === name && !s.a.installed && s.a.installable)).filter((s): s is Standing => !!s).slice(0, n);

/** The standings as shelves: a category each in the filter's order (one no filter names after them, by title; none last as Other), each in the order it came in (select's). */
export function shelves(all: Standing[]): { title: string; rows: Standing[] }[] {
  const rank = (c: string) => { const i = (CATEGORIES as readonly string[]).indexOf(c); return i < 0 ? (c ? CATEGORIES.length : CATEGORIES.length + 1) : i; };
  const cats = [...new Set(all.map((s) => s.a.listing.category))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return cats.map((c) => ({ title: categoryTitle(c), rows: all.filter((s) => s.a.listing.category === c) }));
}

const shortHash = (h: string) => h.slice(0, 7);
export const buildDate = (seq: number) => new Date(seq * 1000).toISOString().slice(0, 10);
export const buildLine = (b: StoreBuildInfo) => `${shortHash(b.hash)} (${buildDate(b.seq)})`;

// Every action also takes marked extensions (`multi`): each installed, updated or removed in turn, the pages opened, the commands one per line. The questions name none, so they read for one or several.
const OPEN: Action = { id: "open", title: "Open" };
const INSTALL: Action = { id: "install", title: "Install", multi: true };
const UPDATE: Action = { id: "update", title: "Update", multi: true };
const REMOVE: Action = { id: "remove", title: "Remove", shortcut: "ctrl+x", style: "destructive", multi: true, confirm: "Remove? Its settings and data stay for a reinstall." };
const PAGE: Action = { id: "page", title: "Open store page", multi: true };
const COPY_COMMAND: Action = { id: "copy-command", title: "Copy install command", shortcut: "cmd+c", multi: true };

/**
 * The row's actions by standing: Install first while absent (none when
 * nothing runs here), Update first while the core has one, else Open (its
 * first palette); Remove only for a registry copy (one that comes with pal
 * is turned off in Settings, not removed); the site page for pal's own.
 */
export function actionsFor(s: Standing): Action[] {
  const page = s.ours ? [PAGE] : [];
  const tail = [...(s.status?.origin === "store" ? [REMOVE] : []), COPY_COMMAND];
  if (!s.a.installed) return s.a.installable ? [{ ...INSTALL, confirm: s.ours ? "Install from the pal registry?" : `Install from ${s.a.registry}? It updates from there.` }, ...page.map((p) => ({ ...p, shortcut: "cmd+enter" })), COPY_COMMAND] : [...page, COPY_COMMAND];
  const open = s.a.listing.palettes.length ? [OPEN] : [];
  if (targetOf(s.status)) return [UPDATE, ...open.map((o) => ({ ...o, shortcut: "cmd+enter" })), ...page, ...tail];
  return [...open, ...page.map((p) => ({ ...p, ...(open.length && { shortcut: "cmd+enter" }) })), ...tail];
}

/** The tag that says how it stands: an update, a problem, installed, or why it cannot be. */
function standingTag(s: Standing): Accessory | undefined {
  const st = s.status;
  if (s.busy) return { tag: "working…", color: "blue" };
  if (targetOf(st)) return { tag: st?.state === "yanked" ? "pulled: update" : "update", color: "amber" };
  if (st?.state === "needs_newer_pal") return { tag: "needs a newer pal", color: "amber" };
  if (st?.state === "no_longer_listed") return { tag: "not updated", color: "amber" };
  if (s.a.installed) return s.a.bundled ? { tag: "comes with pal", color: "grey" } : { tag: "installed", color: "green" };
  if (!s.a.installable) return { text: s.a.blocked ?? "not for here" };
  return undefined;
}

/** A Featured row's id: the extension's own, prefixed, since the same extension is also a row on its shelf. */
export const FEATURED_ID = "featured:";
/** The `<registry>/<name>` a row id stands for. */
export const standingId = (id: string) => (id.startsWith(FEATURED_ID) ? id.slice(FEATURED_ID.length) : id);

/**
 * The row: the tile, the title, the tagline, how it stands, the registry
 * when it is not pal's, and the shelf unless the row's section already is
 * the shelf (`shelved`). `featured` gives it the Featured section's id.
 */
export function row(s: Standing, section?: string, opts: { shelved?: boolean; featured?: boolean } = {}): Item {
  const accessories: Accessory[] = [];
  const tag = standingTag(s);
  if (tag) accessories.push(tag);
  if (!s.ours) accessories.push({ tag: s.a.registry, color: "violet" });
  if (s.a.listing.category && !opts.shelved) accessories.push({ text: categoryTitle(s.a.listing.category) });
  const icon = s.a.listing.icon as TileIcon | string | undefined;
  return {
    id: `${opts.featured ? FEATURED_ID : ""}${s.a.registry}/${s.a.name}`,
    name: s.a.listing.title || s.a.name,
    subtitle: s.a.listing.tagline,
    ...(icon && { icon }),
    keywords: [s.a.name, s.a.listing.author, s.a.listing.category, ...s.a.listing.keywords].filter(Boolean),
    accessories,
    ...(section && { section }),
    actions: actionsFor(s),
  };
}

/** The status line of an installed one, in words. */
export function statusText(s: StoreStatus | undefined): string | undefined {
  switch (s?.state) {
    case "up_to_date": return "Up to date";
    case "update": return `Update ready: ${buildLine(s.to)}`;
    case "needs_newer_pal": return "Its next build needs a newer pal";
    case "yanked": return s.replacement ? `This build was pulled; ${buildLine(s.replacement)} replaces it` : "This build was pulled by its registry";
    case "no_longer_listed": return cap(s.why);
    case "unchecked": return "Not checked yet";
    case "source": return "Installed from source: never updated by itself";
    default: return undefined;
  }
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The detail pane: the description, the palettes, the screenshots; the facts as metadata. */
export function detail(s: Standing): Detail {
  const l = s.a.listing;
  const parts: string[] = [`# ${l.title || s.a.name}`, "", l.description || l.tagline];
  const features = featuresOf(s.a);
  if (features.length) parts.push("", "## What it does", "", ...features.map((f) => `- ${f.replace(/\n/g, " ")}`));
  if (l.palettes.length) parts.push("", "## Palettes", "", ...l.palettes.map((p) => `- ${p.title}`));
  const shots = l.screenshots.map((x) => (typeof x === "string" ? { url: x, caption: "" } : { url: x.url, caption: x.caption ?? "" })).filter((x) => x.url);
  if (shots.length) parts.push("", ...shots.map((x) => `![${esc(x.caption)}](${x.url})`));
  if (l.requires.length) parts.push("", `Installing it installs ${l.requires.join(", ")} first.`);
  const st = statusText(s.status);
  const build = s.status?.installed ?? s.a.build;
  const metadata: Metadata[] = [
    ...(l.author ? [{ label: "Author", value: l.author }] : []),
    { label: "From", value: s.a.bundled ? "Comes with pal" : s.ours ? "The pal registry" : `The ${s.a.registry} registry` },
    { label: "Status", value: s.a.installed ? st ?? "Installed" : s.a.installable ? "Not installed" : cap(s.a.blocked ?? "Not available here") },
    ...(build ? [{ label: s.a.installed ? "Build" : "Latest build", value: buildLine(build) }] : []),
    ...(s.status && s.status.origin !== "local" && s.status.state !== "source" ? [{ label: "Updates", value: s.status.auto_update ? "Automatic" : "Wait for you" }] : []),
    ...(l.category ? [{ label: "Category", value: categoryTitle(l.category) }] : []),
    ...(l.platforms?.length ? [{ label: "Platforms", value: l.platforms.join(", ") }] : []),
    { label: "Install", value: `pal install ${s.a.name}` },
    ...(s.ours ? [{ label: "Page", link: { text: "pal.cagdas.io", href: pageOf(s) } }] : []),
  ];
  return { markdown: parts.join("\n"), metadata };
}

export const pageOf = (s: Standing) => `${SITE}/${s.a.name}`;

/** "5 min ago", "3 hours ago" from unix seconds. */
export function ago(secs: number, now: number): string {
  const min = Math.max(1, Math.round((now - secs * 1000) / 60_000));
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** A registry whose last check failed, in a line: why, and how old the list shown is. */
export const staleNote = (r: StoreRegistry, now: number) => `${r.ours ? "pal's registry" : r.name}: ${r.last_error}${r.last_ok ? `; showing its list from ${ago(r.last_ok, now)}` : ""}`;

/** The Registries filter: one row per registry and one to add another, each opening Settings › Extensions › Registries. */
export function registryRows(regs: StoreRegistry[], now: number): Item[] {
  const settings: Action = { id: "registries", title: "Open in Settings" };
  return [
    ...regs.map((r): Item => ({
      id: `registry:${r.name}`,
      name: r.ours ? "pal" : r.name,
      subtitle: r.last_error ? `${cap(r.last_error)}${r.last_ok ? `; last worked ${ago(r.last_ok, now)}` : ""}` : `${r.count} ${r.count === 1 ? "extension" : "extensions"}${r.last_checked ? `, checked ${ago(r.last_checked, now)}` : ""}`,
      icon: r.last_error ? "\u{f0164}" : "\u{f01a7}",
      keywords: [r.url],
      accessories: [...(r.last_error ? [{ tag: "unreachable", color: "red" } as Accessory] : []), { text: r.channel }, { tag: r.auto_update ? "auto-update" : "updates wait", color: "grey" }],
      actions: [settings],
    })),
    { id: "registry:add", name: "Add registry", subtitle: "A URL and its key, in Settings › Extensions › Registries", icon: "\u{f0415}", actions: [{ id: "registries", title: "Add in Settings" }] },
  ];
}
