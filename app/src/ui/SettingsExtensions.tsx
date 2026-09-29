import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "./Icon";
import { BRAND } from "./icons";
import { Tag } from "./Row";
import { ArmedButton, SettingsField, SettingsSegment, SettingsSwitch } from "./SettingsField";
import { ExtensionPalettes, type SettingsPalettesProps } from "./SettingsPalettes";
import { availableOf, Browse, buildLine, ListingPane, listingIcon, needsOf, originLine, Registries, screenshotsOf, Shots, statusText, targetOf, updatesLine, type ExtensionsStore, type InstallState, type Need } from "./SettingsStore";
import { badgedIcon, type BarItem, instanceBadge, instanceTint, instancesOf, needsSetup, slugSuffix, suffixProblem, suffixTitle, type PaletteConfig, type SettingsExtension, type SettingsIndexEntry, type SettingValue, type SettingValues } from "./SettingsTypes";
import { flashAnchor } from "./SettingsWindow";
import type { Brand } from "./types";
import { EMPTY_STORE, type Available } from "../store";

export type SettingsExtensionsProps = {
  /** One entry per instance key; the list shows one row per extension name and the pane every instance of it. */
  extensions: SettingsExtension[];
  /** The extension whose page is open (its name: installed, or only listed by a registry); none is the page's home. */
  selected?: string;
  onSelect: (name: string | undefined) => void;
  /** The bar items, for what an extension has on the bar (its line on the home, its page's Bar items). */
  bar?: BarItem[];
  /** A bar item's pane on the Bar page. */
  onOpenBarItem?: (key: string) => void;
  /** The registries, the update check and every install, update, remove and switch; the page has no Browse, Registries or store rows without it. */
  store?: ExtensionsStore;
  /** The instance whose settings the pane shows (a key); the default when unset. */
  selectedInstance?: string;
  onSelectInstance?: (key: string) => void;
  /** The instance `key`'s own values (`[extensions.<key>]`). */
  onChange: (key: string, values: SettingValues) => void;
  /** `[instances."<name>@<suffix>"]` written; rejects with the reason. */
  onInstanceAdd?: (name: string, suffix: string, title?: string, tint?: string) => Promise<void>;
  /** The instance's title (`[instances.<key>] title`); empty restores the suffix's. */
  onInstanceRename?: (key: string, title: string) => Promise<void> | void;
  /** The instance's tables, storage, cache and ranking gone. */
  onInstanceRemove?: (key: string) => Promise<void>;
  /** `[instances.<key>] enabled`: parked or back. */
  onInstanceEnabled?: (key: string, enabled: boolean) => void;
  /** Opens a URL in the browser; the source link is plain text without it. */
  onOpenLink?: (url: string) => void;
  /** The palette unfolded under its row on the pane (its id), and the fold. */
  openPalette?: string;
  onOpenPalette?: (id: string | undefined) => void;
  /** A palette's `[palettes.<id>]` changed on the pane. */
  onPalette?: (id: string, config: PaletteConfig) => void;
  /** A palette's indexed rows, for its row hotkeys' picker. */
  paletteItems?: SettingsPalettesProps["items"];
};

/** The search index: the extension once per name, its settings once per instance (`extensions:gmail@work:token`), Browse and Registries, and every listed extension not installed, which opens its page. */
export const extensionsIndex = (extensions: SettingsExtension[], available: Available[] = []): SettingsIndexEntry[] => {
  const have = new Set(extensions.map((e) => e.name));
  return [
    ...extensions.flatMap((e) => [
      ...(e.instance && !e.instance.isDefault
        ? [{ page: "extensions" as const, label: e.title, hint: `Instance of ${e.extTitle ?? e.name}`, anchor: `extensions:${e.key}`, keywords: `${e.key} ${e.instance.suffix ?? ""} instance account` }]
        : [{ page: "extensions" as const, label: e.extTitle ?? e.title, hint: e.tagline ?? e.description ?? "Extension", anchor: `extensions:${e.name}`, keywords: `${e.name} extension ${e.author ?? ""}` }]),
      ...e.settings.map((s) => ({ page: "extensions" as const, label: s.label, hint: `${e.title} setting`, anchor: `extensions:${e.key}:${s.id}`, keywords: `${s.description ?? ""} ${e.key}` })),
    ]),
    { page: "extensions", label: "Browse extensions", hint: "Install from a registry", anchor: "extensions:browse", keywords: "store install get more new download catalog" },
    { page: "extensions", label: "Registries", hint: "Where extensions come from", anchor: "extensions:registries", keywords: "registry add key trust channel edge stable source index auto-update" },
    ...available.filter((a) => !a.installed && !have.has(a.name)).map((a) => ({ page: "extensions" as const, label: a.listing.title || a.name, hint: `Not installed: ${a.listing.tagline}`, anchor: `extensions:${a.name}`, keywords: `${a.name} ${a.listing.keywords.join(" ")} install` })),
  ];
};

/** One row per extension name: the default instance's entry, else the first of the name. */
export const byName = (extensions: SettingsExtension[]): SettingsExtension[] => {
  const seen = new Map<string, SettingsExtension>();
  for (const e of extensions) {
    const cur = seen.get(e.name);
    if (!cur || (e.instance?.isDefault && !cur.instance?.isDefault)) seen.set(e.name, e);
  }
  return [...seen.values()];
};

/** The manifest's `repo` as a link, when it is one. */
const repoHref = (repo: string | undefined) => (!repo || !repo.includes(".") ? undefined : `https://${repo.replace(/^https?:\/\//, "")}`);

/** What an extension is set to, in a line: a couple of its values, its accounts, what it has on the bar, the words that open its palettes. */
function factsOf(e: SettingsExtension, all: SettingsExtension[], bar: BarItem[]): string[] {
  const short = (v: string) => (v.length > 34 ? `${v.slice(0, 33)}…` : v);
  const shown = (v: unknown) => (Array.isArray(v) ? (v.length ? `${v.slice(0, 3).join(", ")}${v.length > 3 ? ` +${v.length - 3}` : ""}` : "none") : typeof v === "boolean" ? (v ? "on" : "off") : String(v));
  const facts = e.settings.filter((s) => s.kind !== "secret" && !/command/i.test(s.id) && e.values[s.id] !== undefined).slice(0, 2).map((s) => {
    const v = e.values[s.id];
    const label = s.kind === "select" ? (s.options.find((o) => o.id === v)?.title ?? String(v)) : shown(v);
    return `${s.label.toLowerCase()} ${short(label)}`;
  });
  const n = instancesOf(e, all).length;
  if (n > 1) facts.push(`${n} accounts`);
  const onBar = bar.filter((b) => nameOf(b.extension) === e.name && b.config.enabled && b.source);
  if (onBar.length) facts.push(`on the bar: ${onBar.map((b) => b.title).join(", ")}`);
  const keyed = e.palettes.filter((p) => p.config.alias || p.config.hotkey);
  if (keyed.length) facts.push(keyed.slice(0, 2).map((p) => `${p.config.alias ?? p.config.hotkey} opens ${p.title}`).join(", "));
  return facts;
}
const nameOf = (key: string) => key.split("@")[0];

/** What a button press is doing, per row: the label it shows meanwhile. */
type Busy = Record<string, string>;

/**
 * Settings › Extensions: the page's home is ordered by what you come here
 * to do. What needs you first (a failure, a missing token, an update that
 * waits, a pending install, a registry that failed, config left over; each
 * with its fix), then what is in use (set up, on the bar, or with more than
 * one account; a line says what each is set to), what is turned off, an
 * index of the rest at their defaults, then Browse (every extension the
 * registries list, installable in place) and the registries themselves.
 * An extension opens as a page of its own: the store's head, its accounts,
 * its settings, its palettes, its bar items, and what can be done to it; a
 * listed one not installed opens as its listing with Install.
 */
export function SettingsExtensions({ extensions, selected, onSelect, selectedInstance, onSelectInstance, onChange, onOpenLink, openPalette, onOpenPalette, onPalette, paletteItems, onInstanceAdd, onInstanceRename, onInstanceRemove, onInstanceEnabled, bar = [], onOpenBarItem, store }: SettingsExtensionsProps) {
  const rows = byName(extensions);
  const current = rows.find((e) => e.name === selected);
  const [busy, setBusy] = useState<Busy>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState<Record<string, InstallState>>({});
  const [query, setQuery] = useState("");
  /** Runs `f` for the row `id`, its button saying `label` meanwhile; a failure stays under the row until the next try. */
  const act = async (id: string, label: string, f?: () => Promise<void> | void) => {
    if (!f) return;
    setBusy((b) => ({ ...b, [id]: label }));
    setFailed(({ [id]: _, ...rest }) => rest);
    try {
      await f();
    } catch (e) {
      setFailed((x) => ({ ...x, [id]: String(e) }));
    } finally {
      setBusy(({ [id]: _, ...rest }) => rest);
    }
  };
  const install = async (name: string, registry: string | null) => {
    if (!store) return;
    setInstalling((s) => ({ ...s, [name]: { kind: "busy" } }));
    try {
      await store.install(name, registry);
      setInstalling((s) => ({ ...s, [name]: { kind: "done" } }));
    } catch (e) {
      setInstalling((s) => ({ ...s, [name]: { kind: "error", message: String(e) } }));
    }
  };
  const state = store?.state;

  if (current) {
    const name = current.name;
    const target = targetOf(current.status);
    return (
      <div className="pal-settings-page pal-xpage">
        <button type="button" className="pal-xpage__back" onClick={() => onSelect(undefined)}>{"‹"} Extensions</button>
        <ExtensionPane
          key={name}
          ext={current}
          instances={instancesOf(current, extensions)}
          selectedInstance={selectedInstance}
          onSelectInstance={onSelectInstance}
          busy={busy[name]}
          failed={failed[name]}
          store={store}
          onChange={onChange}
          onUpdate={store && target ? () => act(name, "Updating…", () => store.update([name])) : undefined}
          onDisabled={store ? (off) => act(name, off ? "Turning off…" : "Turning on…", () => store.setDisabled(name, off)) : undefined}
          onRemove={store && current.status?.origin === "store" ? (forget) => act(name, "Removing…", async () => { await store.remove(name, forget); onSelect(undefined); }) : undefined}
          onOpenLink={onOpenLink}
          openPalette={openPalette}
          onOpenPalette={onOpenPalette}
          onPalette={onPalette}
          paletteItems={paletteItems}
          onInstanceAdd={onInstanceAdd}
          onInstanceRename={onInstanceRename}
          onInstanceRemove={onInstanceRemove}
          onInstanceEnabled={onInstanceEnabled}
          bar={bar.filter((b) => nameOf(b.extension) === name)}
          onOpenBarItem={onOpenBarItem}
        />
      </div>
    );
  }
  const listed = store && selected ? availableOf(store.state, selected) : undefined;
  if (store && listed) {
    const off = store.state.disabled.includes(listed.name);
    return (
      <div className="pal-settings-page pal-xpage">
        <button type="button" className="pal-xpage__back" onClick={() => onSelect(undefined)}>{"‹"} Extensions</button>
        <ListingPane
          key={listed.name}
          a={listed}
          store={store}
          busy={installing[listed.name]}
          onInstall={() => install(listed.name, listed.registry)}
          extra={off && (
            <p className="pal-callout">
              <strong>Turned off.</strong> It is installed and does not load; its settings stay. <button type="button" className="pal-button" data-small disabled={!!busy[listed.name]} onClick={() => act(listed.name, "Turning on…", () => store.setDisabled(listed.name, false))}>{busy[listed.name] ?? "Turn on"}</button>
              {failed[listed.name] && <span role="alert"> {failed[listed.name]}</span>}
            </p>
          )}
        />
      </div>
    );
  }

  // Without the store only what the extensions themselves say (a failure, a missing setting, warnings) needs you.
  const needs = needsOf(rows, extensions, state ?? EMPTY_STORE, store?.references);
  const needy = new Set(needs.filter((n) => n.id === n.name).map((n) => n.name));
  const on = rows.filter((e) => !e.disabled);
  const facts = new Map(on.map((e) => [e.name, factsOf(e, extensions, bar)]));
  const inUse = on.filter((e) => !needy.has(e.name) && facts.get(e.name)!.length);
  const used = new Set(inUse.map((e) => e.name));
  const q = query.trim().toLowerCase();
  const rest = on.filter((e) => !needy.has(e.name) && !used.has(e.name) && (!q || `${e.extTitle ?? e.title} ${e.name} ${e.tagline ?? e.description}`.toLowerCase().includes(q)));
  // Turned off: the host's report of each (its manifest kept), and a name the config turns off that reported nothing (by its listing, else its name).
  const offRows = [
    ...rows.filter((e) => e.disabled).map((e) => ({ name: e.name, title: e.extTitle ?? e.title, icon: e.icon, line: e.tagline ?? e.description })),
    ...(state?.disabled ?? []).filter((n) => !rows.some((e) => e.name === n)).map((n) => { const a = state && availableOf(state, n); return { name: n, title: a?.listing.title || n, icon: listingIcon(a?.listing, n), line: a?.listing.tagline ?? "Not installed" }; }),
  ];
  const title = (e: SettingsExtension) => e.extTitle ?? e.title;
  const fix = (n: Need, kind: Need["fixes"][number]["kind"]) => {
    if (!store) return;
    const id = n.id;
    switch (kind) {
      case "open": case "setup": return onSelect(n.name);
      case "update": return act(id, "Updating…", () => store.update([n.name]));
      case "retry": case "install": return act(id, "Installing…", () => store.install(n.name, n.registry ?? null));
      case "forget": return act(id, "Forgetting…", () => store.forgetLeftover(n.name));
      case "add": return act(id, "Adding…", () => store.addUnlisted(n.name));
      case "enable": return act(id, "Turning on…", () => store.setDisabled(n.name, false));
      case "remove": return act(id, "Removing…", () => store.remove(n.name, false));
      case "refresh": return act(id, "Checking…", store.refresh);
      case "pal": return store.updatePal?.();
    }
  };

  return (
    <div className="pal-settings-page pal-xhome">
      {needs.length > 0 && (
        <section className="pal-xhome__sec" aria-label="Needs you">
          <h2 className="pal-xhome__h">Needs you<span>{needs.length}</span></h2>
          <div className="pal-xhome__needs">
            {needs.map((n) => (
              <div key={n.id} className="pal-xneed" data-tone={failed[n.id] ? "bad" : n.tone} data-anchor={`extensions:need:${n.id}`}>
                <button type="button" className="pal-xneed__open" disabled={!n.open} onClick={() => onSelect(n.name)}>
                  {n.icon ? <Icon icon={badgedIcon(n.icon, undefined)} size="lg" /> : <span className="pal-xneed__dot" aria-hidden />}
                  <span className="pal-xneed__text"><b>{n.title}</b><span title={failed[n.id] ?? n.line}>{failed[n.id] ?? n.line}</span></span>
                </button>
                {busy[n.id] ? <button type="button" className="pal-button" data-small disabled>{busy[n.id]}</button> : n.fixes.map((f, i) => (
                  <button key={f.kind} type="button" className="pal-button" data-small data-primary={(i === 0 && (n.tone === "update" || f.kind === "install" || f.kind === "retry")) || undefined} onClick={() => fix(n, f.kind)}>{f.label}</button>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="pal-xhome__sec" aria-label="In use">
        <h2 className="pal-xhome__h">In use<span>{inUse.length ? `${inUse.length} set up, on the bar or with accounts` : "nothing set up yet"}</span></h2>
        <div className="pal-xhome__used">
          {inUse.map((e) => (
            <button key={e.name} type="button" className="pal-xcard" data-anchor={`extensions:${e.name}`} onClick={() => onSelect(e.name)}>
              <Icon icon={badgedIcon(e.icon, undefined)} size="lg" />
              <span className="pal-xcard__text"><b>{title(e)}</b><span>{facts.get(e.name)!.join("; ")}</span></span>
            </button>
          ))}
          {store && (
            <button type="button" className="pal-xcard pal-xcard--more" onClick={() => flashAnchor("extensions:browse")}>
              <span className="pal-xcard__plus" aria-hidden>+</span>
              <span className="pal-xcard__text"><b>Get more extensions</b><span>Browse what the registries list, below, and install in place</span></span>
            </button>
          )}
        </div>
      </section>
      {offRows.length > 0 && store && (
        <section className="pal-xhome__sec" aria-label="Turned off">
          <h2 className="pal-xhome__h">Turned off<span>not loaded; their settings stay</span></h2>
          <div className="pal-xhome__off">
            {offRows.map((o) => (
              <div key={o.name} className="pal-xoff" data-anchor={`extensions:${o.name}`}>
                <button type="button" className="pal-xneed__open" onClick={() => onSelect(o.name)}>
                  <Icon icon={o.icon} />
                  <span className="pal-xneed__text"><b>{o.title}</b><span>{failed[o.name] ?? o.line}</span></span>
                </button>
                <SettingsSwitch checked={false} disabled={!!busy[o.name]} onChange={() => act(o.name, "Turning on…", () => store.setDisabled(o.name, false))} label={`Turn on ${o.title}`} />
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="pal-xhome__sec" aria-label="Everything else">
        <h2 className="pal-xhome__h">Everything else<span>{rest.length} at their defaults</span>
          <input className="pal-field__input pal-xhome__find" type="search" placeholder="Find one" aria-label="Find an extension" value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </h2>
        <div className="pal-xhome__rest">
          {rest.map((e) => (
            <button key={e.name} type="button" className="pal-xrest" data-anchor={`extensions:${e.name}`} data-dim={instancesOf(e, extensions).every((i) => i.loaded === false) || undefined} title={e.tagline ?? e.description} onClick={() => onSelect(e.name)}>
              <Icon icon={badgedIcon(e.icon, undefined)} />
              <span>{title(e)}</span>
            </button>
          ))}
          {rest.length === 0 && <p className="pal-pane__none">{q ? `Nothing else matches "${query}".` : "Every extension is in use."}</p>}
        </div>
      </section>
      {store && <Browse store={store} installing={installing} onInstall={(a) => install(a.name, a.registry)} onSelect={onSelect} />}
      {store && <Registries store={store} />}
    </div>
  );
}

type PaneProps = {
  /** The extension's default instance (or the first entry of its name). */
  ext: SettingsExtension;
  /** Every instance of the name, the default first. */
  instances: SettingsExtension[];
  selectedInstance?: string;
  onSelectInstance?: (key: string) => void;
  /** What the last button press is doing ("Updating…"). */
  busy?: string;
  /** Why the last update, switch or remove failed. */
  failed?: string;
  store?: ExtensionsStore;
  onChange: (key: string, values: SettingValues) => void;
  /** Update now: offered while the check has a build to install. */
  onUpdate?: () => void;
  /** Turn off (`true`) or on. */
  onDisabled?: (disabled: boolean) => void;
  /** Remove, and with `forget` its settings, storage, cache, ranking and secrets too; a store copy only. */
  onRemove?: (forget: boolean) => void;
  onOpenLink?: (url: string) => void;
  openPalette?: string;
  onOpenPalette?: (id: string | undefined) => void;
  onPalette?: SettingsExtensionsProps["onPalette"];
  paletteItems?: SettingsExtensionsProps["paletteItems"];
  onInstanceAdd?: SettingsExtensionsProps["onInstanceAdd"];
  onInstanceRename?: SettingsExtensionsProps["onInstanceRename"];
  onInstanceRemove?: SettingsExtensionsProps["onInstanceRemove"];
  onInstanceEnabled?: SettingsExtensionsProps["onInstanceEnabled"];
  /** Its bar items (every instance's), for the page's Bar items section. */
  bar?: BarItem[];
  onOpenBarItem?: (key: string) => void;
};

/** Exactly what Remove and forget deletes, for its confirm. */
export const forgetText = (e: SettingsExtension) =>
  `Deletes ${e.extTitle ?? e.title}'s folder and everything it kept: its settings in the config file ([extensions.${e.name}], its palettes' and bar items' tables${e.multi ? ", every instance" : ""}), its stored data and cache, its search ranking, and its keychain secrets. A reinstall starts from nothing.`;

function ExtensionPane({ ext, instances, selectedInstance, onSelectInstance, busy, failed, store, onChange, onUpdate, onDisabled, onRemove, onOpenLink, openPalette, onOpenPalette, onPalette, paletteItems, onInstanceAdd, onInstanceRename, onInstanceRemove, onInstanceEnabled, bar = [], onOpenBarItem }: PaneProps) {
  const multi = !!ext.multi;
  // The instance whose settings show: the selected one when it is of this extension, else the default (or the first).
  const [localInstance, setLocalInstance] = useState<string | undefined>(undefined);
  const [forgetting, setForgetting] = useState(false);
  const wanted = selectedInstance ?? localInstance;
  const inst = instances.find((i) => i.key === wanted) ?? instances.find((i) => i.instance?.isDefault) ?? instances[0] ?? ext;
  const selectInstance = (key: string) => { setLocalInstance(key); onSelectInstance?.(key); };
  const set = (id: string, v: SettingValue) => onChange(inst.key, { ...inst.values, [id]: v });
  const href = repoHref(ext.repo);
  const status = ext.status;
  const registries = store?.state.registries ?? [];
  const origin = originLine(status, registries);
  const updates = updatesLine(status);
  const target = targetOf(status);
  const listed = store && availableOf(store.state, ext.name);
  const missing = new Set(needsSetup(inst).map((s) => s.id));
  const link = (url: string | undefined, text: string) => (url && onOpenLink ? <button type="button" className="pal-link" onClick={() => onOpenLink(url)}>{text}</button> : <span>{text}</span>);
  // The listing's pictures (absolute, the registry's), else the manifest's own.
  const shots = (listed ? screenshotsOf(listed.listing) : []).length ? screenshotsOf(listed!.listing) : ext.screenshots?.filter((s) => s.kind !== "bar") ?? [];
  const extTitle = ext.extTitle ?? ext.title;
  const errors = instances.filter((i) => i.error);
  const rolled = store?.state.rolled_back.find((r) => r.name === ext.name);
  const note = busy ?? statusText(status);
  return (
    <>
    <div className="pal-pane pal-xpane" data-anchor={`extensions:${ext.name}`}>
      <header className="pal-xpane__hero">
        <span className="pal-xpane__tile" data-image={ext.icon?.kind === "image" || ext.icon?.kind === "app" || ext.icon?.kind === "tile" || undefined}><Icon icon={badgedIcon(ext.icon, undefined)} size="lg" /></span>
        <div className="pal-xpane__titles">
          <h3 className="pal-xpane__title">{extTitle}</h3>
          <p className="pal-xpane__tagline">{ext.tagline ?? ext.description}</p>
          <p className="pal-xpane__meta">
            {ext.author && <span>{ext.author}</span>}
            {status?.origin === "bundled" ? <Tag text="Comes with pal" color="grey" /> : origin ? <span>{origin}</span> : ext.source ? <span title={ext.source}>from {ext.source.replace(/^github:/, "")}</span> : href ? link(href, ext.repo!) : null}
            {status?.installed ? <span title={status.installed.commit ? `commit ${status.installed.commit}` : undefined}>{buildLine(status.installed)}</span> : ext.version ? <span>v{ext.version}</span> : null}
            {updates && <span>{updates}</span>}
            {ext.disabled && <Tag text="off" color="grey" />}
          </p>
        </div>
        {ext.storeUrl && onOpenLink && <button type="button" className="pal-button" data-small onClick={() => onOpenLink(ext.storeUrl!)}>Store page</button>}
      </header>

      <Shots shots={shots} />

      {failed && <p className="pal-callout" role="alert" data-level="error">{failed}</p>}
      {ext.disabled && <p className="pal-callout"><strong>Turned off.</strong> It does not load: its palettes, bar items and hotkeys do nothing until it is turned on. Its settings stay.</p>}
      {rolled && <p className="pal-callout" data-level="error"><strong>An update failed to load and was put back.</strong> <code>{rolled.error}</code> That build is not offered again here.</p>}
      {target && <p className="pal-callout" data-level="warning"><strong>{statusText(status)}.</strong>{status?.auto_update ? " It goes in by itself once nothing of it is open." : ""}</p>}
      {errors.map((i) => <div key={i.key} className="pal-callout" role="alert" data-level="error"><strong>{multi && instances.length > 1 ? `${i.title} failed to load.` : "Failed to load."}</strong> <code>{i.error}</code> Fix the code and pal reloads it, or restart the host under General.</div>)}
      {ext.warnings?.map((w) => <p key={w} className="pal-callout" data-level="warning"><strong>Manifest:</strong> {w}</p>)}
      {missing.size > 0 && !inst.error && inst.loaded !== false && <p className="pal-callout" data-level="warning">{multi && instances.length > 1 ? `${inst.title} lists nothing` : "Nothing lists"} until {inst.settings.filter((s) => missing.has(s.id)).map((s) => s.label.toLowerCase()).join(" and ")} {missing.size === 1 ? "is" : "are"} set below.</p>}

      {multi && (
        <Instances
          ext={ext}
          instances={instances}
          selected={inst.key}
          onSelect={selectInstance}
          onAdd={onInstanceAdd}
          onRename={onInstanceRename}
          onRemove={onInstanceRemove}
          onEnabled={onInstanceEnabled}
        />
      )}

      <section className="pal-xpane__section" aria-label="Settings">
        <h4 className="pal-xpane__h">Settings <span className="pal-xpane__h-note">extensions.{inst.key.includes("@") ? `"${inst.key}"` : inst.key}</span></h4>
        {multi && instances.length > 1 && (
          <div className="pal-xpane__instances-pick">
            <SettingsSegment value={inst.key} options={instances.map((i) => ({ id: i.key, title: i.instance?.title ?? (i.instance?.isDefault ? "Default" : i.key) }))} onChange={selectInstance} label="Settings of which instance" />
            {inst.inherited && <span className="pal-xpane__inherits">Unset values follow {inst.inheritedFrom ?? extTitle}; secrets and account settings are this instance's own.</span>}
          </div>
        )}
        {inst.settings.length === 0 ? (
          <p className="pal-pane__none">{extTitle} declares no settings of its own.{inst.palettes.some((p) => p.settings.length) ? " Its palettes do; see Palettes." : ""}</p>
        ) : (
          <div className="pal-settings-group__rows pal-xpane__fields">
            {inst.settings.map((s) => {
              const own = inst.values[s.id];
              const inherited = inst.inherited?.[s.id];
              const isPrivate = s.kind === "secret" || s.scope === "instance";
              const perInstance = !!inst.inherited && isPrivate;
              return (
                <div key={s.id} data-anchor={`extensions:${inst.key}:${s.id}`} data-missing={missing.has(s.id) || undefined} data-inherited={own === undefined && inherited !== undefined ? "" : undefined}>
                  <SettingsField
                    spec={s}
                    value={own ?? inherited ?? s.default}
                    onChange={(v) => set(s.id, v)}
                    base={inst.inherited ? inherited : undefined}
                    note={own === undefined && inherited !== undefined ? `From ${inst.inheritedFrom ?? extTitle}` : perInstance && (own === undefined || own === "") ? "Set for this instance; never shared between accounts" : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="pal-xpane__section" aria-label="Palettes">
        <h4 className="pal-xpane__h">Palettes{multi && instances.length > 1 && <span className="pal-xpane__h-note">{inst.title}</span>}</h4>
        {inst.palettes.length === 0 ? <p className="pal-pane__none">None{ext.disabled ? " while it is turned off" : inst.error ? " while it fails to load" : inst.instance && !inst.instance.enabled ? " while the instance is off" : ""}.</p> : onPalette ? (
          <ExtensionPalettes ext={inst} onChange={onPalette} items={paletteItems} open={openPalette} onOpen={(id) => onOpenPalette?.(id)} />
        ) : (
          <ul className="pal-xpane__palettes">
            {inst.palettes.map((p) => (
              <li key={p.id} className="pal-xpane__palette" data-off={!p.config.enabled || undefined} title={p.description}>
                <Icon icon={p.config.icon ? { kind: "emoji", value: p.config.icon } : p.icon ?? inst.icon} />
                <span className="pal-xpane__palette-title">{p.title}</span>
                {p.config.alias && <code className="pal-xpane__palette-alias">{p.config.alias}</code>}
                {!p.config.enabled && <span className="pal-xpane__palette-off">off</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {bar.length > 0 && (
        <section className="pal-xpane__section" aria-label="Bar items">
          <h4 className="pal-xpane__h">Bar items<span className="pal-xpane__h-note">Settings › Bar has each one's place, look and settings</span></h4>
          <ul className="pal-xpane__bar">
            {bar.map((b) => (
              <li key={b.key} data-off={!b.config.enabled || undefined}>
                <Icon icon={b.extIcon} />
                <span className="pal-xpane__bar-text"><b>{b.title}</b>{b.description && <span>{b.description}</span>}</span>
                <span className="pal-xpane__bar-state">{ext.disabled || !b.config.enabled ? "off" : b.state?.hidden ? "hidden now" : "on the bar"}</span>
                {onOpenBarItem && <button type="button" className="pal-button" data-small onClick={() => onOpenBarItem(b.key)}>Open in Bar</button>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
      {forgetting && onRemove && (
        <div className="pal-xforget" role="alertdialog" aria-label={`Remove and forget ${extTitle}`}>
          <p>{forgetText(ext)}</p>
          <span className="pal-button-row">
            <button type="button" className="pal-button" data-small data-destructive onClick={() => { setForgetting(false); onRemove(true); }}>Remove and forget</button>
            <button type="button" className="pal-button" data-small onClick={() => setForgetting(false)}>Cancel</button>
          </span>
        </div>
      )}
      {(onUpdate || onDisabled || onRemove) && (
        <footer className="pal-pane__foot">
          <span className="pal-pane__note">{note}</span>
          {onUpdate && <button type="button" className="pal-button" data-small data-primary disabled={!!busy} onClick={onUpdate}>Update now</button>}
          {onDisabled && <button type="button" className="pal-button" data-small data-primary={ext.disabled || undefined} disabled={!!busy} onClick={() => onDisabled(!ext.disabled)}>{ext.disabled ? "Turn on" : "Turn off"}</button>}
          {onRemove && <ArmedButton label="Remove" arm="Settings and data stay. Click again" disabled={!!busy} onConfirm={() => onRemove(false)} data-small />}
          {onRemove && <button type="button" className="pal-button" data-small data-destructive disabled={!!busy || forgetting} onClick={() => setForgetting(true)}>Remove and forget…</button>}
        </footer>
      )}
    </>
  );
}

type InstancesProps = {
  ext: SettingsExtension;
  instances: SettingsExtension[];
  selected: string;
  onSelect: (key: string) => void;
  onAdd?: SettingsExtensionsProps["onInstanceAdd"];
  onRename?: SettingsExtensionsProps["onInstanceRename"];
  onRemove?: SettingsExtensionsProps["onInstanceRemove"];
  onEnabled?: SettingsExtensionsProps["onInstanceEnabled"];
};

/**
 * The Instances section of a `multi` extension: one row per instance
 * (the badged tile, the title, the key, "default", on/off, Rename,
 * Remove) and "Add another account", which opens the inline form. A row
 * selects the instance for the Settings section below.
 */
function Instances({ ext, instances, selected, onSelect, onAdd, onRename, onRemove, onEnabled }: InstancesProps) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const extTitle = ext.extTitle ?? ext.title;
  const run = async (key: string, f: () => Promise<void> | void) => {
    setBusy(key);
    setFailed(undefined);
    try { await f(); } catch (e) { setFailed(String(e)); } finally { setBusy(undefined); }
  };
  const commitRename = (key: string, title: string) => { setRenaming(undefined); if (onRename) run(key, () => onRename(key, title.trim())); };
  return (
    <section className="pal-xpane__section pal-instances" aria-label="Instances" data-anchor={`extensions:${ext.name}:instances`}>
      <h4 className="pal-xpane__h">Instances <span className="pal-xpane__h-note">instances.{ext.name}@…</span></h4>
      <ul className="pal-instances__list">
        {instances.map((i) => {
          const inst = i.instance!;
          const active = i.key === selected;
          const renamingThis = renaming === i.key;
          return (
            <li key={i.key} className="pal-instances__row" data-active={active || undefined} data-off={!inst.enabled || undefined} data-anchor={`extensions:${i.key}`}>
              <button type="button" className="pal-instances__main" onClick={() => onSelect(i.key)} aria-pressed={active} aria-label={`${i.title} instance`}>
                <Icon icon={i.icon} />
                <span className="pal-instances__titles">
                  {renamingThis ? (
                    <input
                      className="pal-inline pal-instances__rename"
                      type="text"
                      autoFocus
                      defaultValue={inst.title ?? ""}
                      placeholder={inst.suffix ? suffixTitle(inst.suffix) : "Untitled"}
                      aria-label={`Title of ${i.key}`}
                      spellCheck={false}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => commitRename(i.key, e.target.value)}
                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { setRenaming(undefined); } }}
                    />
                  ) : (
                    <span className="pal-instances__title">{inst.title ?? extTitle}{inst.isDefault && <Tag text="default" color="grey" />}{i.error && <Tag text="failed" color="red" />}</span>
                  )}
                  <code className="pal-instances__key">{i.key}</code>
                </span>
              </button>
              {onEnabled && <SettingsSwitch checked={inst.enabled} onChange={(v) => onEnabled(i.key, v)} label={`${i.title} enabled`} disabled={busy === i.key} />}
              {onRename && !renamingThis && <button type="button" className="pal-button" data-small disabled={busy === i.key} onClick={() => setRenaming(i.key)}>Rename</button>}
              {onRemove && !inst.isDefault && <ArmedButton label="Remove" arm="Remove? Click again" busy={busy === i.key ? "Removing…" : undefined} disabled={!!busy} onConfirm={() => run(i.key, () => onRemove(i.key))} aria-label={`Remove ${i.title}`} data-small />}
            </li>
          );
        })}
      </ul>
      {failed && <p className="pal-callout" role="alert" data-level="error">{failed}</p>}
      {adding ? (
        <AddInstance ext={ext} taken={instances.map((i) => i.instance?.suffix).filter((s): s is string => !!s)} onCancel={() => setAdding(false)} onAdd={async (suffix, title, tint) => { await onAdd!(ext.name, suffix, title, tint); setAdding(false); onSelect(`${ext.name}@${suffix}`); }} />
      ) : (
        onAdd && <div className="pal-button-row"><button type="button" className="pal-button" data-small onClick={() => setAdding(true)}>Add another account</button></div>
      )}
      <p className="pal-ppane__hint pal-instances__hint">Each instance has its own settings, palettes, bar items, storage and ranking; the code is shared. Off keeps an instance's settings and hides everything of it.</p>
    </section>
  );
}

/**
 * The inline form: a title, a suffix slugged from it until typed by hand
 * and checked live (the key grammar, a suffix in use), a tint (twelve
 * swatches, "auto" the host's pick from the suffix). Create writes the
 * table; the reason stays under the form when it fails.
 */
function AddInstance({ ext, taken, onAdd, onCancel }: { ext: SettingsExtension; taken: string[]; onAdd: (suffix: string, title?: string, tint?: string) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [suffix, setSuffix] = useState("");
  const [typedSuffix, setTypedSuffix] = useState(false);
  const [tint, setTint] = useState<Brand | undefined>(undefined);
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string }>({ kind: "idle" });
  const problem = suffixProblem(suffix, taken);
  const own = ext.icon?.kind === "tile" ? ext.icon.bg : undefined;
  const auto = suffix ? instanceTint(suffix, own) : undefined;
  const preview = badgedIcon(ext.icon, { key: `${ext.name}@${suffix}`, suffix, title: title || (suffix ? suffixTitle(suffix) : undefined), tint: tint ?? auto ?? own, badge: instanceBadge(title || suffix || "?"), isDefault: false, enabled: true });
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem || state.kind === "busy") return;
    setState({ kind: "busy" });
    try {
      await onAdd(suffix, title.trim() || undefined, tint);
    } catch (err) {
      setState({ kind: "error", message: String(err) });
    }
  };
  return (
    <form className="pal-instances__add" onSubmit={submit} aria-label={`Add another ${ext.extTitle ?? ext.title}`} aria-busy={state.kind === "busy"}>
      <div className="pal-instances__add-row">
        <span className="pal-instances__preview"><Icon icon={preview} size="lg" /></span>
        <label className="pal-instances__field">
          <span>Title</span>
          <input ref={first} className="pal-inline" type="text" value={title} placeholder="Work" spellCheck={false} onChange={(e) => { setTitle(e.target.value); if (!typedSuffix) setSuffix(slugSuffix(e.target.value)); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }} />
        </label>
        <label className="pal-instances__field">
          <span>Key</span>
          <span className="pal-instances__keyfield"><code>{ext.name}@</code><input className="pal-inline" type="text" value={suffix} placeholder="work" spellCheck={false} aria-invalid={!!suffix && !!problem} onChange={(e) => { setTypedSuffix(true); setSuffix(e.target.value); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }} /></span>
        </label>
      </div>
      <div className="pal-instances__tints" role="radiogroup" aria-label="Tile colour">
        <button type="button" role="radio" aria-checked={tint === undefined} className="pal-instances__tint" data-auto title={auto ? `Auto: ${auto}` : "Auto: picked from the key"} onClick={() => setTint(undefined)}>auto</button>
        {BRAND.filter((b) => b !== own).map((b) => <button key={b} type="button" role="radio" aria-checked={tint === b} className="pal-instances__tint" data-brand={b} title={b} aria-label={b} onClick={() => setTint(b)} />)}
      </div>
      <p className="pal-instances__note" data-error={(!!suffix && !!problem) || state.kind === "error" || undefined}>
        {state.kind === "error" ? state.message : suffix && problem ? problem : `Fixed once created: the key names the instance's tables, links (pal://open/${ext.name}@${suffix || "work"}/…) and keychain items.`}
      </p>
      <div className="pal-button-row">
        <button type="submit" className="pal-button" data-small data-primary disabled={!!problem || state.kind === "busy"}>{state.kind === "busy" ? "Creating…" : "Create"}</button>
        <button type="button" className="pal-button" data-small onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
