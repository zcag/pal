/**
 * Settings › Extensions, the distribution half: what the core's one update
 * check and the registries say (`StoreState`, app/src/store.ts), turned
 * into Needs you rows, the Browse section, the Registries section and the
 * page of an extension that is listed but not installed. Pure components
 * over the state and a few callbacks; SettingsExtensions places them.
 */
import { useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import { ArmedButton, SettingsSelect, SettingsSwitch } from "./SettingsField";
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

const CATEGORY_TITLE: Record<string, string> = { productivity: "Productivity", developer: "Developer", system: "System", media: "Media", reference: "Reference", fun: "Fun", integration: "Integration" };
export const categoryTitle = (c: string) => CATEGORY_TITLE[c] ?? (c ? cap(c) : "Other");

/** What Browse lists for a category and a query: every word must match the name, title, tagline, keywords or a palette's title; not installed first, each by title. */
export function browseRows(available: Available[], category: string, query: string): Available[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (a: Available) => [a.name, a.listing.title, a.listing.tagline, a.listing.category, ...a.listing.keywords, ...a.listing.palettes.map((p) => p.title)].join(" ").toLowerCase();
  return available
    .filter((a) => (category === "all" || a.listing.category === category) && words.every((w) => hay(a).includes(w)))
    .sort((x, y) => Number(x.installed) - Number(y.installed) || (x.listing.title || x.name).localeCompare(y.listing.title || y.name));
}

/** What a Browse row or a listing's page is doing: installing, done, or why it failed. */
export type InstallState = { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };

/** The Install button, or what stands for it: "Installing…", "Installed", "Open" on one already here, the reason on one that cannot be. */
function InstallControl({ a, busy, run, onOpen }: { a: Available; busy?: InstallState; run: () => void; onOpen: () => void }) {
  if (a.installed || busy?.kind === "done") return <button type="button" className="pal-button" data-small onClick={onOpen}>Open</button>;
  if (!a.installable) return <span className="pal-xbrow__blocked" title={a.blocked}>{a.blocked ? cap(a.blocked) : "Not available here"}</span>;
  return <button type="button" className="pal-button" data-small data-primary disabled={busy?.kind === "busy"} onClick={run}>{busy?.kind === "busy" ? "Installing…" : "Install"}</button>;
}

/**
 * Browse: every extension the registries list, narrowed by a category and
 * what is typed, the ones not installed first. Each row says where it
 * comes from ("Comes with pal", or its registry) and installs in place;
 * the row itself opens the extension's page, installed or not.
 */
export function Browse({ store, installing, onInstall, onSelect }: { store: ExtensionsStore; installing: Record<string, InstallState>; onInstall: (a: Available) => void; onSelect: (name: string) => void }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const { state } = store;
  const categories = [...new Set(state.available.map((a) => a.listing.category).filter(Boolean))].sort((a, b) => categoryTitle(a).localeCompare(categoryTitle(b)));
  const rows = browseRows(state.available, category, query);
  const absent = state.available.filter((a) => !a.installed).length;
  const busy = (a: Available): InstallState | undefined => installing[a.name] ?? (state.busy.includes(a.name) ? { kind: "busy" } : undefined);
  return (
    <section className="pal-xhome__sec" aria-label="Browse" data-anchor="extensions:browse">
      <h2 className="pal-xhome__h">Browse<span>{state.available.length ? `${absent} not installed, from ${plural(state.registries.length, "registry", "registries")}` : store.loaded ? "no registry has answered yet" : "asking the registries…"}</span>
        <input className="pal-field__input pal-xhome__find" type="search" placeholder="Find one to install" aria-label="Find an extension to install" value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
      </h2>
      {categories.length > 1 && (
        <div className="pal-xbrowse__cats" role="group" aria-label="Categories">
          {["all", ...categories].map((c) => <button key={c} type="button" className="pal-button" data-small aria-pressed={category === c} onClick={() => setCategory(c)}>{c === "all" ? "All" : categoryTitle(c)}</button>)}
        </div>
      )}
      <div className="pal-xbrowse__list">
        {rows.map((a) => {
          const b = busy(a);
          return (
            <div key={`${a.registry}/${a.name}`} className="pal-xbrow" data-installed={a.installed || undefined} data-anchor={`extensions:browse:${a.name}`}>
              <button type="button" className="pal-xbrow__open" onClick={() => onSelect(a.name)} title={a.listing.description || a.listing.tagline}>
                <Icon icon={listingIcon(a.listing, a.name)} />
                <span className="pal-xbrow__text"><b>{a.listing.title || a.name}</b><span>{a.listing.tagline}</span></span>
              </button>
              <span className="pal-xbrow__from">{a.bundled ? "Comes with pal" : registryName(a.registry, state.registries)}</span>
              <InstallControl a={a} busy={b} run={() => onInstall(a)} onOpen={() => onSelect(a.name)} />
              {b?.kind === "error" && <p className="pal-xbrow__error" role="alert">{b.message}</p>}
            </div>
          );
        })}
        {rows.length === 0 && state.available.length > 0 && <p className="pal-pane__none">{query ? `Nothing listed matches "${query}".` : "Nothing in this category."}</p>}
      </div>
      <p className="pal-xbrowse__foot">
        {store.openStore && <button type="button" className="pal-link" onClick={store.openStore}>Open the Store palette</button>}
      </p>
      {store.installSource && <SourceInstall run={store.installSource} />}
    </section>
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

/** Screenshots as the pane lays them out: a strip that scrolls, a picture that fails to load drops out. */
export function Shots({ shots }: { shots: Screenshot[] }) {
  if (!shots.length) return null;
  return (
    <div className="pal-xpane__shots" role="list" aria-label="Screenshots">
      {shots.map((s) => (
        <figure key={s.src} className="pal-xpane__shot" role="listitem" title={s.caption}>
          <img src={s.src} alt={s.caption ?? ""} loading="lazy" draggable={false} onError={(e) => { (e.currentTarget.parentElement as HTMLElement).hidden = true; }} />
          {s.caption && <figcaption>{s.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

/**
 * An extension a registry lists and this machine does not have: what it
 * is (the listing's hero, screenshots, description, palettes, what it
 * installs first) and Install, or why it cannot be.
 */
export function ListingPane({ a, store, busy, onInstall, extra }: { a: Available; store: ExtensionsStore; busy?: InstallState; onInstall: () => void; extra?: ReactNode }) {
  const l = a.listing;
  const icon = listingIcon(l, a.name);
  return (
    <>
      <div className="pal-pane pal-xpane" data-anchor={`extensions:${a.name}`}>
        <header className="pal-xpane__hero">
          <span className="pal-xpane__tile" data-image={icon?.kind === "image" || icon?.kind === "app" || icon?.kind === "tile" || undefined}><Icon icon={icon} size="lg" /></span>
          <div className="pal-xpane__titles">
            <h3 className="pal-xpane__title">{l.title || a.name}</h3>
            <p className="pal-xpane__tagline">{l.tagline}</p>
            <p className="pal-xpane__meta">
              {l.author && <span>{l.author}</span>}
              <span>{a.bundled ? "Comes with pal" : `From the ${registryName(a.registry, store.state.registries)} registry`}</span>
              {l.category && <span>{categoryTitle(l.category)}</span>}
              {a.build && <span title={a.build.commit}>{buildLine(a.build)}</span>}
              <span>{a.installed ? "Installed" : "Not installed"}</span>
            </p>
          </div>
        </header>
        <Shots shots={screenshotsOf(l)} />
        {extra}
        {busy?.kind === "error" && <p className="pal-callout" role="alert" data-level="error">{busy.message}</p>}
        {l.description && <p className="pal-xpane__desc">{l.description}</p>}
        {l.palettes.length > 0 && (
          <section className="pal-xpane__section" aria-label="Palettes">
            <h4 className="pal-xpane__h">Palettes</h4>
            <ul className="pal-xpane__palettes">{l.palettes.map((p) => <li key={p.id} className="pal-xpane__palette"><Icon icon={icon} /><span className="pal-xpane__palette-title">{p.title}</span></li>)}</ul>
          </section>
        )}
        {l.requires.length > 0 && <p className="pal-pane__none">Installing it installs {l.requires.join(", ")} first.</p>}
      </div>
      <footer className="pal-pane__foot">
        <span className="pal-pane__note">{a.installable || a.installed ? (busy?.kind === "done" ? "Installed" : "") : a.blocked ? cap(a.blocked) : "No build runs here"}</span>
        {!a.installed && a.installable && busy?.kind !== "done" && <button type="button" className="pal-button" data-small data-primary disabled={busy?.kind === "busy"} onClick={onInstall}>{busy?.kind === "busy" ? "Installing…" : "Install"}</button>}
      </footer>
    </>
  );
}
