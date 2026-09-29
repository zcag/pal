/**
 * Settings › Extensions, the distribution half: what the core's one update
 * check and the registries say (`StoreState`, app/src/store.ts), turned
 * into Needs you rows, the Browse section, the Registries section and the
 * page of an extension that is listed but not installed. Pure components
 * over the state and a few callbacks; SettingsExtensions places them.
 */
import { useState, type CSSProperties, type FormEvent, type ReactNode, type SyntheticEvent } from "react";
import { Icon } from "./Icon";
import { ArmedButton, SettingsSegment, SettingsSelect, SettingsSwitch } from "./SettingsField";
import { needsSetup, instancesOf, type SettingsExtension, type Screenshot } from "./SettingsTypes";
import { relativeDate } from "./format";
import type { Icon as IconSpec } from "./types";
import { iconOf } from "../items";
import type { Available, BuildInfo, Channel, LeftOver, Listing, Preview, RegistryStatus, Status, StoreState } from "../store";

/** What the Extensions page can do with the store; Settings.tsx wires the core's commands, the gallery fakes them. Every call rejects with the reason. */
export type ExtensionsStore = {
  state: StoreState;
  /** The core answered at least once: before that, empty lists mean "not known yet". */
  loaded?: boolean;
  install: (name: string, registry: string | null) => Promise<void>;
  /** A folder or a GitHub source, installed as is (`pal install --from`); never updated from a registry. */
  installSource?: (spec: string) => Promise<void>;
  update: (names: string[]) => Promise<void>;
  remove: (name: string, forget: boolean) => Promise<void>;
  setDisabled: (name: string, disabled: boolean) => Promise<void>;
  /** Every registry fetched now. */
  refresh: () => Promise<void>;
  previewRegistry: (url: string, key: string | null) => Promise<Preview>;
  addRegistry: (url: string, key: string) => Promise<void>;
  removeRegistry: (name: string) => Promise<void>;
  setRegistry: (name: string, autoUpdate: boolean | null, channel: Channel | null) => Promise<void>;
  /** Drops the references and config tables of an extension that is not there. */
  forgetLeftover: (name: string) => Promise<void>;
  /** A folder in the store the config does not list: added to `[store] installed`. */
  addUnlisted: (name: string) => Promise<void>;
  /** What in the config still points at a turned-off extension, by name, in words ("hotkey ctrl+alt+w", "bar item Battery"). */
  references?: Record<string, string[]>;
  /** The Store palette in the panel. */
  openStore?: () => void;
  /** Where a newer pal comes from (the About page). */
  updatePal?: () => void;
};

// ---- words and numbers ------------------------------------------------------

/** The core's times are unix seconds; anything past 1e12 is already ms. */
export const toMs = (t: number) => (t < 1e12 ? t * 1000 : t);
export const shortHash = (h: string) => h.slice(0, 7);
/** A build's date: `seq` is its source commit's time. */
export const buildDate = (seq: number) => { const t = new Date(seq * 1000); return `${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}`; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const buildLine = (b: BuildInfo) => `${shortHash(b.hash)}, ${buildDate(b.seq)}`;
/** "5 min ago", "just now". */
export const ago = (t: number, now = Date.now()) => { const r = relativeDate(toMs(t), now); return r === "now" ? "just now" : `${r} ago`; };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A registry as the page names it: pal's own is "pal". */
export const registryName = (name: string, registries: RegistryStatus[]) => (registries.find((r) => r.name === name)?.ours ? "pal" : name);

/** Where an installed copy came from, in words. */
export function originLine(s: Status | undefined, registries: RegistryStatus[]): string | undefined {
  if (!s) return undefined;
  if (s.origin === "bundled") return "Comes with pal";
  if (s.origin === "local") return "From a local folder";
  if (s.state === "source") return "Installed from source";
  return s.registry ? `From the ${registryName(s.registry, registries)} registry` : "In the store folder";
}

/** Whether updates apply by themselves, for the page's line; nothing for a copy that never updates (source, local). */
export function updatesLine(s: Status | undefined): string | undefined {
  if (!s || s.origin === "local" || s.state === "source" || s.state === "local") return undefined;
  return s.auto_update ? "Updates automatically" : "Updates wait for you";
}

/** The update check's answer, in a line. */
export function statusText(s: Status | undefined): string | undefined {
  if (!s) return undefined;
  switch (s.state) {
    case "up_to_date": return "Up to date";
    case "update": return `Update ready: ${buildLine(s.to)}`;
    case "needs_newer_pal": return "Its next build needs a newer pal";
    case "yanked": return s.replacement ? `This build was pulled; ${buildLine(s.replacement)} replaces it` : "This build was pulled by its registry";
    case "no_longer_listed": return cap(s.why);
    case "unchecked": return "Not checked yet";
    case "source": return "Installed from source: never updated by itself";
    case "local": return undefined;
  }
}

/** The build an Update now would install: an update, or a pulled build's replacement. */
export const targetOf = (s: Status | undefined) => (s?.state === "update" ? s.to : s?.state === "yanked" ? s.replacement ?? undefined : undefined);

export const listingIcon = (l: Listing | undefined, name: string): IconSpec | undefined => iconOf(l?.icon, l?.title || name);
export const screenshotsOf = (l: Listing | undefined): Screenshot[] => (l?.screenshots ?? []).map((s) => (typeof s === "string" ? { src: s } : { src: s.url, caption: s.caption })).filter((s) => !!s.src);
/** The listing a name is known by: pal's registry's first. */
export const availableOf = (s: StoreState, name: string): Available | undefined => s.available.find((a) => a.name === name && s.registries.find((r) => r.name === a.registry)?.ours) ?? s.available.find((a) => a.name === name);

const REF_WORDS: Record<LeftOver["refs"][number]["kind"], [string, string]> = {
  config: ["its settings", "its settings"], hotkey: ["a hotkey", "hotkeys"], bar: ["a bar item", "bar items"], alias: ["an alias", "aliases"],
  state: ["a state", "states"], fallback: ["a fallback", "fallbacks"], sidebar: ["the sidebar", "the sidebar"],
};
/** "a hotkey and 2 bar items": what a leftover's references are, counted by kind. */
export function refsLine(refs: LeftOver["refs"]): string {
  const counts = new Map<string, number>();
  for (const r of refs) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const words = [...counts].map(([k, n]) => { const [one, many] = REF_WORDS[k as keyof typeof REF_WORDS] ?? [k, k]; return n === 1 || one === many ? one : `${n} ${many}`; });
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0] ?? "";
}

// ---- Needs you --------------------------------------------------------------

export type NeedFix = "open" | "setup" | "update" | "retry" | "install" | "forget" | "add" | "enable" | "remove" | "refresh" | "pal";
/** One Needs you row: whose, why in a line, and the fix (a leftover has two: Install and Forget). `open` says the row itself opens a page (the extension's, installed or listed). */
export type Need = { id: string; name: string; title: string; icon?: IconSpec; tone: "bad" | "warn" | "update"; line: string; fixes: { kind: NeedFix; label: string }[]; registry?: string; open: boolean };

/**
 * Everything that needs the user, in the order to take it: per extension
 * one row (a failed load, a missing setting, a rolled-back or pulled
 * build, one no longer listed, one that needs a newer pal, an update
 * that waits because auto-update is off for its registry, manifest
 * warnings), then what is not an extension on the page (a pending
 * install, a registry that failed, config left over from one that is
 * gone, a store folder the config does not list, a turned-off extension
 * something still points at). Pure, for the page and its tests.
 */
export function needsOf(rows: SettingsExtension[], all: SettingsExtension[], s: StoreState, references: Record<string, string[]> = {}): Need[] {
  const out: Need[] = [];
  const titled = (name: string) => { const a = availableOf(s, name); return { title: a?.listing.title || name, icon: listingIcon(a?.listing, name), a }; };
  for (const e of rows) {
    const base = { id: e.name, name: e.name, title: e.extTitle ?? e.title, icon: e.icon, open: true };
    const inst = instancesOf(e, all);
    const st = e.status;
    const rolled = s.rolled_back.find((r) => r.name === e.name);
    const setup = inst.find((i) => i.loaded !== false && needsSetup(i).length);
    const removable = st?.origin === "store";
    if (inst.some((i) => i.error)) out.push({ ...base, tone: "bad", line: "Failed to load", fixes: [{ kind: "open", label: "Open" }] });
    else if (setup) out.push({ ...base, tone: "warn", line: `Set ${needsSetup(setup).map((x) => x.label.toLowerCase()).join(", ")}${setup.key !== e.key ? ` (${setup.instance?.title ?? setup.key})` : ""}`, fixes: [{ kind: "setup", label: "Set up" }] });
    else if (rolled) out.push({ ...base, tone: "bad", line: `An update failed to load and was put back: ${rolled.error}`, fixes: [{ kind: "open", label: "Open" }] });
    else if (st?.state === "yanked") out.push({ ...base, tone: "bad", line: statusText(st)!, fixes: st.replacement ? [{ kind: "update", label: "Update" }] : removable ? [{ kind: "remove", label: "Remove" }] : [{ kind: "open", label: "Open" }] });
    else if (st?.state === "no_longer_listed") out.push({ ...base, tone: "warn", line: `${cap(st.why)}: no longer updated`, fixes: removable ? [{ kind: "remove", label: "Remove" }] : [{ kind: "open", label: "Open" }] });
    else if (st?.state === "needs_newer_pal") out.push({ ...base, tone: "warn", line: "Its next build needs a newer pal", fixes: [{ kind: "pal", label: "Update pal" }] });
    else if (st?.state === "update" && !st.auto_update) out.push({ ...base, tone: "update", line: `Update ready: ${buildLine(st.to)}`, fixes: [{ kind: "update", label: "Update" }] });
    else if (inst.some((i) => i.warnings?.length)) out.push({ ...base, tone: "warn", line: "Its manifest has warnings", fixes: [{ kind: "open", label: "Open" }] });
  }
  const here = new Set(rows.map((e) => e.name));
  for (const p of s.pending) {
    if (here.has(p.name)) continue;
    const t = titled(p.name);
    out.push({ id: `pending:${p.name}`, name: p.name, title: t.title, icon: t.icon, tone: "warn", line: p.error ? `Not installed yet: ${p.error}` : "Not installed yet; pal keeps trying", fixes: [{ kind: "retry", label: "Retry" }], registry: p.registry, open: !!t.a });
  }
  for (const r of s.registries) {
    if (!r.last_error) continue;
    const since = r.last_ok ? `; last worked ${ago(r.last_ok)}` : "";
    out.push({ id: `registry:${r.name}`, name: r.name, title: `${r.ours ? "pal's" : `The ${r.name}`} registry`, tone: "bad", line: `${cap(r.last_error)}${since}`, fixes: [{ kind: "refresh", label: "Retry" }], registry: r.name, open: false });
  }
  for (const l of s.leftovers) {
    const t = titled(l.name);
    const installable = !!t.a?.installable;
    out.push({ id: `leftover:${l.name}`, name: l.name, title: t.title, icon: t.icon, tone: "warn", line: `Not installed; ${refsLine(l.refs) || "the config"} still ${l.refs.length === 1 ? "points" : "point"} at it`, fixes: [...(installable ? [{ kind: "install" as const, label: "Install" }] : []), { kind: "forget", label: "Forget" }], registry: t.a?.registry, open: !!t.a });
  }
  for (const name of s.unlisted) {
    out.push({ id: `unlisted:${name}`, name, title: all.find((e) => e.name === name)?.extTitle ?? name, icon: all.find((e) => e.name === name)?.icon, tone: "warn", line: "In the store folder but not in the config's list, so another machine would not get it", fixes: [{ kind: "add", label: "Add" }], open: here.has(name) });
  }
  for (const name of s.disabled) {
    const refs = references[name];
    if (!refs?.length) continue;
    const e = all.find((x) => x.name === name);
    const t = titled(name);
    out.push({ id: `disabled:${name}`, name, title: e?.extTitle ?? t.title, icon: e?.icon ?? t.icon, tone: "warn", line: `Turned off, but ${refs.slice(0, 2).join(", ")}${refs.length > 2 ? ` and ${refs.length - 2} more` : ""} still ${refs.length === 1 ? "points" : "point"} at it`, fixes: [{ kind: "enable", label: "Turn on" }], open: here.has(name) || !!t.a });
  }
  return out;
}

// ---- Browse -----------------------------------------------------------------

/** The shelves in the order Browse and the Store palette show them; a category outside these sorts after them, by title. */
export const CATEGORIES = ["productivity", "developer", "system", "media", "reference", "fun", "integration"];
const CATEGORY_TITLE: Record<string, string> = { productivity: "Productivity", developer: "Developer", system: "System", media: "Media", reference: "Reference", fun: "Fun", integration: "Integration" };
export const categoryTitle = (c: string) => CATEGORY_TITLE[c] ?? (c ? cap(c) : "Other");

/**
 * Browse's Featured row: extensions worth meeting first, one per kind of
 * thing pal does (music, code, a game, the day, words, the disk, the
 * lights, typing), in order; the first three that are not installed and
 * install here show. The Store palette's Featured section
 * (extensions/store/store.ts) keeps the same list.
 */
export const FEATURED = ["spotify", "github", "solitaire", "calendar", "translate", "space", "hue", "typing"];

/** What an extension does, a line each: the listing's `features`; an older index has none. */
export const featuresOf = (l: Listing | undefined): string[] => (l?.features ?? []).filter((f) => typeof f === "string" && !!f.trim());
/** A feature line's backticks mark keys and code; a card shows the words. */
export const plainText = (s: string) => s.replace(/`([^`]*)`/g, "$1");
/** The same line on a page: the backticked parts as code. */
const withCode = (s: string): ReactNode[] => s.split(/`([^`]*)`/g).map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));

/** The card's line under the tagline: the first feature, else the description when it says more than the tagline. */
export function whatLine(l: Listing): string | undefined {
  const f = featuresOf(l)[0];
  if (f) return cap(plainText(f));
  const d = l.description.trim();
  const t = l.tagline.trim().replace(/\.$/, "").toLowerCase();
  return d && (!t || !d.toLowerCase().startsWith(t)) ? d : undefined;
}

/** Every category the listings use, with how many each has: the known shelves in order, then the rest by title. */
export function categoriesOf(available: Available[]): { id: string; title: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const a of available) if (a.listing.category) counts.set(a.listing.category, (counts.get(a.listing.category) ?? 0) + 1);
  const rank = (c: string) => (CATEGORIES.includes(c) ? CATEGORIES.indexOf(c) : CATEGORIES.length);
  return [...counts].sort(([a], [b]) => rank(a) - rank(b) || categoryTitle(a).localeCompare(categoryTitle(b))).map(([id, count]) => ({ id, title: categoryTitle(id), count }));
}

/** The Featured row: FEATURED's names that are listed, not installed and install here, the first `n`. */
export const featuredOf = (available: Available[], n = 3): Available[] =>
  FEATURED.map((name) => available.find((a) => a.name === name && !a.installed && a.installable)).filter((a): a is Available => !!a).slice(0, n);

/**
 * What Browse lists for a category and a query. Every word must be in the
 * name, title, tagline, category, keywords or a palette's title, or start
 * a word of the description or a feature (inside a word there, "git"
 * would find every "digit"). With a query the title's matches lead (every
 * word starts a word of the title, then a word inside it), then by title.
 * Installed or not changes nothing here: a card that installs stays where
 * it is, and the card itself says which it is.
 */
export function browseRows(available: Available[], category: string, query: string): Available[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  const strong = (a: Available) => [a.name, a.listing.title, a.listing.tagline, a.listing.category, ...a.listing.keywords, ...a.listing.palettes.map((p) => p.title)].join(" ").toLowerCase();
  const weak = (a: Available) => tokens([a.listing.description, ...featuresOf(a.listing)].join(" "));
  const matches = (a: Available) => { const s = strong(a); let w: string[] | undefined; return words.every((x) => s.includes(x) || (w ??= weak(a)).some((t) => t.startsWith(x))); };
  const title = (a: Available) => (a.listing.title || a.name).toLowerCase();
  const rank = (a: Available) => {
    if (!words.length) return 0;
    const t = title(a);
    return words.every((w) => tokens(t).some((s) => s.startsWith(w))) ? 0 : words.some((w) => t.includes(w)) ? 1 : 2;
  };
  return available
    .filter((a) => (category === "all" || a.listing.category === category) && (!words.length || matches(a)))
    .sort((x, y) => rank(x) - rank(y) || title(x).localeCompare(title(y)));
}

/** What a Browse card or a listing's page is doing: installing, done, or why it failed. */
export type InstallState = { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };

/**
 * The card's button: Install, "Installing…" while it runs, Open on one
 * already here, or the reason one cannot be installed. A pill in the
 * accent's soft tint, so eighty of them on a page stay quiet; Open is
 * the plain one.
 */
function GetButton({ a, busy, run, onOpen }: { a: Available; busy?: InstallState; run: () => void; onOpen: () => void }) {
  const title = a.listing.title || a.name;
  if (a.installed || busy?.kind === "done") return <button type="button" className="pal-xget" data-open onClick={onOpen} aria-label={`Open ${title}`}>Open</button>;
  if (!a.installable) return <span className="pal-xget__blocked" title={a.blocked}>{a.blocked ? cap(a.blocked) : "Not available here"}</span>;
  const running = busy?.kind === "busy";
  return <button type="button" className="pal-xget" data-busy={running || undefined} disabled={running} onClick={run} aria-label={`Install ${title}`}>{running ? "Installing…" : "Install"}</button>;
}

/**
 * A screenshot in the scheme in force. The store's pictures come in pairs
 * (`1-list.png`, `1-list-dark.png`, docs/design/screenshots.md): both are
 * in the page and the CSS shows the one for the scheme, so a flip swaps
 * them without a reload; a dark one a registry does not have falls back
 * to the light one.
 */
export function ThemedShot({ src, alt = "", onFail }: { src: string; alt?: string; /** The picture itself did not load (the light one, or the only one). */ onFail?: (img: HTMLImageElement) => void }) {
  const [missing, setMissing] = useState(false);
  const dark = /-dark\.png(?=$|[?&#])/.test(src) ? undefined : src.replace(/\.png(?=$|[?&#])/, "-dark.png");
  const img = (s: string, scheme: string | undefined, onError: (e: SyntheticEvent<HTMLImageElement>) => void) => <img className="pal-xshot" data-scheme={scheme} src={s} alt={alt} loading="lazy" decoding="async" draggable={false} onError={onError} />;
  const fail = (e: SyntheticEvent<HTMLImageElement>) => onFail?.(e.currentTarget);
  if (!dark || dark === src) return img(src, undefined, fail);
  return <>{img(src, "light", fail)}{img(missing ? src : dark, "dark", () => setMissing(true))}</>;
}

/**
 * One listed extension as a card: its tile large, the title, the tagline
 * and one line of what it does (the first feature, else the
 * description), then where it comes from or that it is installed, and
 * Install or Open. The card opens the listing's page; `shot` puts the
 * first screenshot on top (the Featured row). An install in flight runs a
 * thin bar along the card's foot; a failed one says why under it.
 */
function BrowseCard({ a, store, busy, index, shot, onInstall, onSelect }: { a: Available; store: ExtensionsStore; busy?: InstallState; index: number; shot?: boolean; onInstall: () => void; onSelect: (name: string) => void }) {
  const l = a.listing;
  const installed = a.installed || busy?.kind === "done";
  const ours = !!store.state.registries.find((r) => r.name === a.registry)?.ours;
  const from = a.bundled ? "Comes with pal" : installed ? "Installed" : ours ? undefined : `From ${a.registry}`;
  const what = whatLine(l);
  const picture = shot ? screenshotsOf(l)[0] : undefined;
  return (
    <article className="pal-xbcard" data-shot={shot || undefined} data-installed={installed || undefined} data-busy={busy?.kind === "busy" || undefined} data-failed={busy?.kind === "error" || undefined} data-anchor={`extensions:browse:${a.name}`} style={{ "--i": Math.min(index, 14) } as CSSProperties}>
      <button type="button" className="pal-xbcard__open" onClick={() => onSelect(a.name)} aria-label={`${l.title || a.name}: ${l.tagline}`}>
        {shot && <span className="pal-xbcard__shot">{picture ? <ThemedShot src={picture.src} /> : null}</span>}
        <span className="pal-xbcard__head">
          <span className="pal-xbcard__tile"><Icon icon={listingIcon(l, a.name)} size="lg" /></span>
          <span className="pal-xbcard__titles"><b>{l.title || a.name}</b><span>{l.tagline}</span></span>
        </span>
        {what && !shot && <span className="pal-xbcard__what">{what}</span>}
      </button>
      <div className="pal-xbcard__foot">
        <span className="pal-xbcard__from" data-installed={installed || undefined}>{from}</span>
        <GetButton a={a} busy={busy} run={onInstall} onOpen={() => onSelect(a.name)} />
      </div>
      {busy?.kind === "error" && <p className="pal-xbcard__error" role="alert">{busy.message}</p>}
    </article>
  );
}

/** The two views of the Extensions page, at its top: what is here, and what the registries offer. */
export function ExtensionsTabs({ browsing, onBrowse }: { browsing: boolean; onBrowse: (on: boolean) => void }) {
  return <SettingsSegment value={browsing ? "browse" : "installed"} options={[{ id: "installed", title: "Installed" }, { id: "browse", title: "Browse" }]} onChange={(v) => onBrowse(v === "browse")} label="Extensions" />;
}

/**
 * Browse: every extension the registries list, as cards in a grid that
 * takes as many columns as the window has room for. The search narrows
 * as you type; the categories above it say how many each has. With
 * neither, a Featured row (three with their screenshots) leads and every
 * category is a shelf of its own; with either, one grid of what matches.
 * Each card installs in place and opens the listing's page. The
 * registries themselves, a source install and the Store palette follow.
 */
export function Browse({ store, installing, onInstall, onSelect, category, onCategory, query, onQuery, tabs }: {
  store: ExtensionsStore; installing: Record<string, InstallState>; onInstall: (a: Available) => void; onSelect: (name: string) => void;
  category: string; onCategory: (c: string) => void; query: string; onQuery: (q: string) => void; tabs?: ReactNode;
}) {
  const { state } = store;
  const cats = categoriesOf(state.available);
  const q = query.trim();
  const rows = browseRows(state.available, category, q);
  const shelves = !q && category === "all";
  const featured = shelves ? featuredOf(state.available) : [];
  const busy = (a: Available): InstallState | undefined => installing[a.name] ?? (state.busy.includes(a.name) ? { kind: "busy" } : undefined);
  const card = (a: Available, i: number, shot?: boolean) => <BrowseCard key={`${shot ? "featured:" : ""}${a.registry}/${a.name}`} a={a} store={store} busy={busy(a)} index={i} shot={shot} onInstall={() => onInstall(a)} onSelect={onSelect} />;
  const other = rows.filter((a) => !a.listing.category);
  const shelvesOf = [...cats.map((c) => ({ ...c, rows: rows.filter((a) => a.listing.category === c.id) })), ...(other.length ? [{ id: "", title: "Other", count: other.length, rows: other }] : [])];
  return (
    <div className="pal-settings-page pal-xbrowse">
      <header className="pal-xbrowse__top">
        {tabs}
        <label className="pal-xbrowse__search">
          <svg viewBox="0 0 16 16" aria-hidden><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2L14 14" /></svg>
          <input type="search" placeholder={state.available.length ? `Search ${plural(state.available.length, "extension")}` : "Search extensions"} aria-label="Search extensions" value={query} spellCheck={false} onChange={(e) => onQuery(e.target.value)} />
        </label>
      </header>
      {cats.length > 1 && (
        <nav className="pal-xbrowse__cats" aria-label="Categories">
          {[{ id: "all", title: "All", count: state.available.length }, ...cats].map((c) => (
            <button key={c.id} type="button" className="pal-xcat" aria-pressed={category === c.id} onClick={() => onCategory(category === c.id && c.id !== "all" ? "all" : c.id)}>
              {c.title}<span className="pal-xcat__n">{c.count}</span>
            </button>
          ))}
        </nav>
      )}
      <section className="pal-xbrowse__results" aria-label="Browse" data-anchor="extensions:browse" key={`${category}\n${q}`}>
        {!state.available.length && <p className="pal-xbrowse__empty">{store.loaded ? "No registry has answered yet. Check now, under Registries below, asks again." : "Asking the registries…"}</p>}
        {featured.length > 0 && (
          <div className="pal-xshelf" data-featured>
            <h2 className="pal-xshelf__h">Featured</h2>
            <div className="pal-xbrowse__featured">{featured.map((a, i) => card(a, i, true))}</div>
          </div>
        )}
        {shelves
          ? shelvesOf.map((c) => c.rows.length > 0 && (
            <div key={c.id} className="pal-xshelf">
              <h2 className="pal-xshelf__h"><button type="button" className="pal-xshelf__go" onClick={() => onCategory(c.id)}>{c.title}</button><span>{c.rows.length}</span></h2>
              <div className="pal-xbrowse__grid">{c.rows.map((a, i) => card(a, i + 3))}</div>
            </div>
          ))
          : <div className="pal-xbrowse__grid">{rows.map((a, i) => card(a, i))}</div>}
        {rows.length === 0 && state.available.length > 0 && (
          <p className="pal-xbrowse__empty">
            {q ? `Nothing listed matches "${q}"${category !== "all" ? ` in ${categoryTitle(category)}` : ""}.` : "Nothing in this category."}
            {q && category !== "all" && <> <button type="button" className="pal-link" onClick={() => onCategory("all")}>Search every category</button></>}
          </p>
        )}
      </section>
      <Registries store={store} />
      <section className="pal-xhome__sec pal-xbrowse__more" aria-label="More ways to install">
        <h2 className="pal-xhome__h">Not listed?<span>your own extension, or one in development</span></h2>
        {store.installSource && <SourceInstall run={store.installSource} />}
        {store.openStore && <p className="pal-xbrowse__foot"><button type="button" className="pal-link" onClick={store.openStore}>Open the Store palette</button> to browse from the panel.</p>}
      </section>
    </div>
  );
}

/** A folder or a GitHub source, for an extension no registry lists (your own, one in development). */
function SourceInstall({ run }: { run: (spec: string) => Promise<void> }) {
  const [spec, setSpec] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string }>({ kind: "idle" });
  const busy = state.kind === "busy";
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!spec.trim() || busy) return;
    setState({ kind: "busy" });
    try { await run(spec.trim()); setState({ kind: "done" }); setSpec(""); } catch (err) { setState({ kind: "error", message: String(err) }); }
  };
  return (
    <form className="pal-xsource" onSubmit={submit} aria-label="Install from a folder or GitHub" aria-busy={busy}>
      <label className="pal-instances__field"><span>From a folder or GitHub</span><input className="pal-inline" type="text" value={spec} placeholder="~/code/my-extension or github:user/repo" spellCheck={false} readOnly={busy} onChange={(e) => { setSpec(e.target.value); if (state.kind !== "busy") setState({ kind: "idle" }); }} /></label>
      <button type="submit" className="pal-button" data-small disabled={busy || !spec.trim()}>{busy ? "Installing…" : "Install"}</button>
      {state.kind === "done" && <p className="pal-instances__note" role="status">Installed. A source install never updates from a registry; its page has Update to fetch the source again.</p>}
      {state.kind === "error" && <p className="pal-instances__note" data-error role="alert">{state.message}</p>}
    </form>
  );
}

// ---- Registries -------------------------------------------------------------

const CHANNELS = [{ id: "stable", title: "Stable" }, { id: "edge", title: "Edge (every build)" }];

/** "12 extensions, checked 5 min ago", or why the last check failed and when it last worked. */
export function registryLine(r: RegistryStatus, now = Date.now()): string {
  const count = plural(r.count, "extension");
  if (r.last_error) return `${cap(r.last_error)}${r.last_ok ? `; last worked ${ago(r.last_ok, now)}` : ""}`;
  return r.last_checked ? `${count}, checked ${ago(r.last_checked, now)}` : `${count}, not checked yet`;
}

/**
 * Registries: each with its URL, how its last check went, its channel
 * and whether its extensions update by themselves; pal's own is first and
 * stays. Add takes a URL and the registry's public key, looks the index
 * up and shows what it found before anything is written.
 */
export function Registries({ store }: { store: ExtensionsStore }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const run = async (name: string, f: () => Promise<void>) => {
    setBusy(name);
    setFailed(undefined);
    try { await f(); } catch (e) { setFailed(String(e)); } finally { setBusy(undefined); }
  };
  const { registries } = store.state;
  return (
    <section className="pal-xhome__sec" aria-label="Registries" data-anchor="extensions:registries">
      <h2 className="pal-xhome__h">Registries<span>where extensions come from; each build is checked against the registry's key</span>
        <button type="button" className="pal-button pal-xhome__act" data-small disabled={busy === "*"} onClick={() => run("*", store.refresh)}>{busy === "*" ? "Checking…" : "Check now"}</button>
      </h2>
      <ul className="pal-xregs">
        {registries.map((r) => (
          <li key={r.name} className="pal-xreg" data-failed={!!r.last_error || undefined} data-anchor={`extensions:registries:${r.name}`}>
            <span className="pal-xreg__text">
              <b>{r.ours ? "pal" : r.name}</b>
              <code className="pal-xreg__url" title={r.url}>{r.url}</code>
              <span className="pal-xreg__line">{registryLine(r)}</span>
            </span>
            <SettingsSelect value={r.channel} options={CHANNELS} onChange={(c) => run(r.name, () => store.setRegistry(r.name, null, c as Channel))} label={`Channel of ${r.name}`} />
            <label className="pal-xreg__auto">
              <span>Auto-update</span>
              <SettingsSwitch checked={r.auto_update} disabled={busy === r.name} onChange={(v) => run(r.name, () => store.setRegistry(r.name, v, null))} label={`Update ${r.name}'s extensions automatically`} />
            </label>
            {!r.ours && <ArmedButton label="Remove" arm="Its extensions stay, not updated. Click again" busy={busy === r.name ? "Removing…" : undefined} disabled={!!busy} onConfirm={() => run(r.name, () => store.removeRegistry(r.name))} aria-label={`Remove ${r.name}`} data-small />}
          </li>
        ))}
        {registries.length === 0 && <li className="pal-pane__none">{store.loaded ? "No registry is configured." : "Asking the core…"}</li>}
      </ul>
      {failed && <p className="pal-callout" role="alert" data-level="error">{failed}</p>}
      {adding ? <AddRegistry store={store} onDone={() => setAdding(false)} /> : <div className="pal-button-row pal-xregs__add"><button type="button" className="pal-button" data-small onClick={() => setAdding(true)}>Add a registry</button></div>}
    </section>
  );
}

/** The add flow: a URL and the key, Look up fetches and verifies the index, the card says what it lists and whose key signs it, Add pins it. */
function AddRegistry({ store, onDone }: { store: ExtensionsStore; onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [preview, setPreview] = useState<Preview | undefined>(undefined);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string }>({ kind: "idle" });
  const busy = state.kind === "busy";
  const attempt = async (f: () => Promise<void>) => {
    setState({ kind: "busy" });
    try { await f(); setState({ kind: "idle" }); } catch (e) { setState({ kind: "error", message: String(e) }); }
  };
  const look = (e: FormEvent) => { e.preventDefault(); if (!url.trim() || busy) return; attempt(async () => setPreview(await store.previewRegistry(url.trim(), key.trim() || null))); };
  const add = () => preview && attempt(async () => { await store.addRegistry(preview.url, preview.key); onDone(); });
  return (
    <form className="pal-xregs__form" onSubmit={look} aria-label="Add a registry" aria-busy={busy}>
      <label className="pal-instances__field"><span>URL</span><input className="pal-inline" type="url" autoFocus value={url} placeholder="https://example.github.io/pal/index.json" spellCheck={false} readOnly={busy} onChange={(e) => { setUrl(e.target.value); setPreview(undefined); }} /></label>
      <label className="pal-instances__field"><span>Key</span><input className="pal-inline" type="text" value={key} placeholder="RWQ… (the public key on the registry's page)" spellCheck={false} readOnly={busy} onChange={(e) => { setKey(e.target.value); setPreview(undefined); }} /></label>
      {preview && (
        <div className="pal-xregs__preview" role="status">
          <b>{preview.name}</b> lists {plural(preview.count, "extension")}, signed with key <code>{preview.key_id}</code>. Adding it trusts that key: its extensions update by themselves unless you turn that off for it here.
        </div>
      )}
      {state.kind === "error" && <p className="pal-instances__note" data-error>{state.message}</p>}
      <div className="pal-button-row">
        {preview ? <button type="button" className="pal-button" data-small data-primary disabled={busy} onClick={add}>{busy ? "Adding…" : `Add ${preview.name}`}</button> : <button type="submit" className="pal-button" data-small data-primary disabled={busy || !url.trim()}>{busy ? "Looking…" : "Look up"}</button>}
        <button type="button" className="pal-button" data-small onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

// ---- a listed extension's page ------------------------------------------------

/** Screenshots as an installed extension's page lays them out: a strip that scrolls, in the scheme in force; a picture that fails to load drops out. */
export function Shots({ shots }: { shots: Screenshot[] }) {
  if (!shots.length) return null;
  return (
    <div className="pal-xpane__shots" role="list" aria-label="Screenshots">
      {shots.map((s) => (
        <figure key={s.src} className="pal-xpane__shot" role="listitem" title={s.caption}>
          <ThemedShot src={s.src} alt={s.caption} onFail={(el) => { (el.closest("figure") as HTMLElement | null)?.setAttribute("hidden", ""); }} />
          {s.caption && <figcaption>{s.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

/**
 * A listing's screenshots as a store page shows them: one large, its
 * caption under it, and the rest as thumbnails that pick it; the large one
 * fades in on a pick. A bar strip or a popover sits whole in the frame.
 */
function ShotGallery({ shots }: { shots: Screenshot[] }) {
  const [at, setAt] = useState(0);
  if (!shots.length) return null;
  const i = Math.min(at, shots.length - 1);
  const cur = shots[i];
  return (
    <section className="pal-xgallery" aria-label="Screenshots">
      <figure className="pal-xgallery__stage" key={cur.src}>
        <span className="pal-xgallery__frame"><ThemedShot src={cur.src} alt={cur.caption} /></span>
        {cur.caption && <figcaption>{cur.caption}</figcaption>}
      </figure>
      {shots.length > 1 && (
        <div className="pal-xgallery__thumbs" role="tablist" aria-label="Pick a screenshot">
          {shots.map((s, k) => (
            <button key={s.src} type="button" role="tab" aria-selected={k === i} aria-label={s.caption ?? `Screenshot ${k + 1}`} className="pal-xgallery__thumb" onClick={() => setAt(k)}>
              <ThemedShot src={s.src} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const PLATFORM_TITLE: Record<string, string> = { macos: "macOS", linux: "Linux", windows: "Windows" };
/** "macOS and Linux"; nothing when the listing names none (it runs wherever pal does). */
const platformsLine = (p: string[] | null | undefined) => {
  const words = (p ?? []).map((x) => PLATFORM_TITLE[x] ?? x);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0];
};

/** What the page offers next to this one: what it suggests, then others on its shelf not installed yet, three at most (a row). */
export function relatedOf(state: StoreState, a: Available, n = 3): Available[] {
  const seen = new Set([a.name]);
  const out: Available[] = [];
  const add = (x: Available | undefined) => { if (x && !seen.has(x.name) && out.length < n) { seen.add(x.name); out.push(x); } };
  for (const name of a.listing.suggests) add(availableOf(state, name));
  for (const x of browseRows(state.available, a.listing.category || "all", "")) if (!x.installed && x.listing.category === a.listing.category) add(x);
  return out;
}

/**
 * An extension a registry lists and this machine does not have, as its
 * store page: the hero (the tile large, the title, the tagline, Install or
 * why it cannot be), the screenshots in the scheme in force, the
 * description and what it does, its palettes, the facts beside them
 * (where it comes from, what it runs on, what it installs first, its
 * build, the command), and related extensions to go on to.
 */
export function ListingPane({ a, store, busy, onInstall, onSelect, extra }: { a: Available; store: ExtensionsStore; busy?: InstallState; onInstall: () => void; onSelect?: (name: string) => void; extra?: ReactNode }) {
  const l = a.listing;
  const icon = listingIcon(l, a.name);
  const features = featuresOf(l);
  const titleOf = (name: string) => availableOf(store.state, name)?.listing.title || name;
  const related = onSelect ? relatedOf(store.state, a) : [];
  const running = busy?.kind === "busy";
  const done = busy?.kind === "done";
  const facts = ([
    ["Category", l.category ? categoryTitle(l.category) : undefined],
    ["From", a.bundled ? "Comes with pal" : `The ${registryName(a.registry, store.state.registries)} registry`],
    ["Author", l.author || undefined],
    ["Runs on", platformsLine(l.platforms)],
    ["Installs first", l.requires.length ? l.requires.map(titleOf).join(", ") : undefined],
    ["Status", a.installed || done ? "Installed" : a.installable ? "Not installed" : cap(a.blocked ?? "Not available here")],
    [a.installed ? "Build" : "Latest build", a.build ? <span title={a.build.commit}>{buildLine(a.build)}</span> : undefined],
    ["In a terminal", <code>pal install {a.name}</code>],
  ] as [string, ReactNode][]).filter((f) => f[1] !== undefined);
  return (
    <div className="pal-pane pal-xpane pal-xlisting" data-anchor={`extensions:${a.name}`}>
      <header className="pal-xlisting__hero">
        <span className="pal-xlisting__tile"><Icon icon={icon} size="lg" /></span>
        <div className="pal-xpane__titles">
          <h3 className="pal-xpane__title">{l.title || a.name}</h3>
          <p className="pal-xpane__tagline">{l.tagline}</p>
        </div>
        <div className="pal-xlisting__act">
          {!a.installed && a.installable && !done && <button type="button" className="pal-button" data-primary data-busy={running || undefined} disabled={running} onClick={onInstall}>{running ? "Installing…" : "Install"}</button>}
          {done && <span className="pal-xlisting__state" data-ok role="status">Installed</span>}
          {!a.installed && !a.installable && <span className="pal-xlisting__state">{a.blocked ? cap(a.blocked) : "No build runs here"}</span>}
        </div>
      </header>
      {extra}
      {busy?.kind === "error" && <p className="pal-callout" role="alert" data-level="error">{busy.message}</p>}
      <ShotGallery shots={screenshotsOf(l)} />
      <div className="pal-xlisting__body">
        <div className="pal-xlisting__main">
          {l.description && <p className="pal-xlisting__desc">{withCode(l.description)}</p>}
          {features.length > 0 && (
            <section className="pal-xpane__section" aria-label="What it does">
              <h4 className="pal-xpane__h">What it does</h4>
              <ul className="pal-xlisting__features">{features.map((f) => <li key={f}>{withCode(f)}</li>)}</ul>
            </section>
          )}
          {l.palettes.length > 0 && (
            <section className="pal-xpane__section" aria-label="Palettes">
              <h4 className="pal-xpane__h">Palettes</h4>
              <ul className="pal-xpane__palettes">{l.palettes.map((p) => <li key={p.id} className="pal-xpane__palette"><Icon icon={icon} /><span className="pal-xpane__palette-title">{p.title}</span></li>)}</ul>
            </section>
          )}
        </div>
        <dl className="pal-xlisting__facts">
          {facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      </div>
      {related.length > 0 && (
        <section className="pal-xpane__section pal-xlisting__related" aria-label="Related">
          <h4 className="pal-xpane__h">Related</h4>
          <div className="pal-xlisting__rel">
            {related.map((r) => (
              <button key={r.name} type="button" className="pal-xrel" onClick={() => onSelect!(r.name)}>
                <Icon icon={listingIcon(r.listing, r.name)} size="lg" />
                <span className="pal-xrel__text"><b>{r.listing.title || r.name}</b><span>{r.listing.tagline}</span></span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
