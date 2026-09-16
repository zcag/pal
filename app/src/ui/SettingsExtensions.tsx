import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Empty } from "./Empty";
import { Icon } from "./Icon";
import { BRAND } from "./icons";
import { Tag } from "./Row";
import { SettingsField, SettingsSegment, SettingsSwitch } from "./SettingsField";
import { SettingsList } from "./SettingsList";
import { badgedIcon, instanceBadge, instanceTint, instancesOf, needsSetup, slugSuffix, suffixProblem, suffixTitle, type SettingsExtension, type SettingsIndexEntry, type SettingValue, type SettingValues } from "./SettingsTypes";
import type { Brand } from "./types";
import { relativeDate } from "./format";

export type SettingsExtensionsProps = {
  /** One entry per instance key; the list shows one row per extension name and the pane every instance of it. */
  extensions: SettingsExtension[];
  /** The selected extension's name. */
  selected?: string;
  onSelect: (name: string) => void;
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
  /** Install from a spec (a github:user/repo[/subdir][@ref] or a github.com URL, a path). Rejects with the reason. */
  onInstall?: (spec: string) => Promise<void>;
  onUpdate?: (name: string) => Promise<void> | void;
  onRemove?: (name: string) => Promise<void> | void;
  /** Opens a URL in the browser; the source link is plain text without it. */
  onOpenLink?: (url: string) => void;
  /** The Palettes page on one of this extension's palettes. */
  onOpenPalette?: (id: string) => void;
};

/** The search index: the extension once per name, its settings once per instance (`extensions:gmail@work:token`). */
export const extensionsIndex = (extensions: SettingsExtension[]): SettingsIndexEntry[] =>
  extensions.flatMap((e) => [
    ...(e.instance && !e.instance.isDefault
      ? [{ page: "extensions" as const, label: e.title, hint: `Instance of ${e.extTitle ?? e.name}`, anchor: `extensions:${e.key}`, keywords: `${e.key} ${e.instance.suffix ?? ""} instance account` }]
      : [{ page: "extensions" as const, label: e.extTitle ?? e.title, hint: e.tagline ?? e.description ?? `Extension ${e.version}`, anchor: `extensions:${e.name}`, keywords: `${e.name} extension ${e.author ?? ""}` }]),
    ...e.settings.map((s) => ({ page: "extensions" as const, label: s.label, hint: `${e.title} setting`, anchor: `extensions:${e.key}:${s.id}`, keywords: `${s.description ?? ""} ${e.key}` })),
  ]);

/** One row per extension name: the default instance's entry, else the first of the name. */
export const byName = (extensions: SettingsExtension[]): SettingsExtension[] => {
  const seen = new Map<string, SettingsExtension>();
  for (const e of extensions) {
    const cur = seen.get(e.name);
    if (!cur || (e.instance?.isDefault && !cur.instance?.isDefault)) seen.set(e.name, e);
  }
  return [...seen.values()];
};

const repoHref = (repo: string) => (repo === "bundled" || !repo.includes(".") ? undefined : `https://${repo.replace(/^https?:\/\//, "")}`);

/**
 * The install field over the page; installed extensions on the left; the
 * selected one on the right as the store shows it (icon, tagline,
 * version, author, screenshots), then what needs attention, its settings,
 * its palettes, and Update and Remove in the pane's footer.
 */
export function SettingsExtensions({ extensions, selected, onSelect, selectedInstance, onSelectInstance, onChange, onInstall, onUpdate, onRemove, onOpenLink, onOpenPalette, onInstanceAdd, onInstanceRename, onInstanceRemove, onInstanceEnabled }: SettingsExtensionsProps) {
  const rows = byName(extensions);
  const current = rows.find((e) => e.name === selected);
  /** What the last button press is doing, per extension, and how it ended. */
  const [busy, setBusy] = useState<Record<string, "updating" | "removing">>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const act = async (name: string, what: "updating" | "removing", f?: (name: string) => Promise<void> | void) => {
    if (!f) return;
    setBusy((b) => ({ ...b, [name]: what }));
    setFailed(({ [name]: _, ...rest }) => rest);
    try {
      await f(name);
    } catch (e) {
      setFailed((x) => ({ ...x, [name]: String(e) }));
    } finally {
      setBusy(({ [name]: _, ...rest }) => rest);
    }
  };
  // The row's mark is the worst across the extension's instances: one failing instance is the extension's problem.
  const attention = (e: SettingsExtension) => {
    const all = instancesOf(e, extensions);
    return all.some((i) => i.error) ? <Tag text="failed" color="red" /> : all.some((i) => i.loaded !== false && needsSetup(i).length) ? <Tag text="setup" color="amber" /> : e.latest ? <Tag text="update" color="amber" /> : all.some((i) => i.warnings?.length) ? <Tag text="warning" color="amber" /> : undefined;
  };

  return (
    <div className="pal-extensions">
      {onInstall && <InstallBar onInstall={onInstall} />}
      <div className="pal-split">
        <SettingsList
          label="Installed extensions"
          items={rows.map((e) => {
            const n = instancesOf(e, extensions).length;
            return {
              id: e.name,
              icon: badgedIcon(e.icon, undefined),
              title: e.extTitle ?? e.title,
              sub: [e.version, e.bundled ?? e.repo === "bundled" ? "built in" : undefined, n > 1 ? `${n} instances` : undefined].filter(Boolean).join(", "),
              dim: instancesOf(e, extensions).every((i) => i.loaded === false),
              accessory: attention(e),
            };
          })}
          selected={selected}
          onSelect={onSelect}
        />
        <div className="pal-split__pane">
          {current ? (
            <ExtensionPane
              key={current.name}
              ext={current}
              instances={instancesOf(current, extensions)}
              selectedInstance={selectedInstance}
              onSelectInstance={onSelectInstance}
              busy={busy[current.name]}
              failed={failed[current.name]}
              onChange={onChange}
              onUpdate={onUpdate && (() => act(current.name, "updating", onUpdate))}
              onRemove={onRemove && (() => act(current.name, "removing", onRemove))}
              onOpenLink={onOpenLink}
              onOpenPalette={onOpenPalette}
              onInstanceAdd={onInstanceAdd}
              onInstanceRename={onInstanceRename}
              onInstanceRemove={onInstanceRemove}
              onInstanceEnabled={onInstanceEnabled}
            />
          ) : (
            <Empty title={extensions.length ? "No extension selected" : "No extensions"} hint={extensions.length ? "Pick one on the left." : "Install one from GitHub above: user/repo, or the store's pal install line."} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One field with Install at its end. Submit installs; the field is
 * read-only and says so while it runs, and the reason stays under it when
 * it fails.
 */
function InstallBar({ onInstall }: { onInstall: (spec: string) => Promise<void> }) {
  const [spec, setSpec] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "error"; message: string } | { kind: "done"; spec: string }>({ kind: "idle" });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const s = spec.trim();
    if (!s || state.kind === "busy") return;
    setState({ kind: "busy" });
    try {
      await onInstall(s);
      setState({ kind: "done", spec: s });
      setSpec("");
    } catch (err) {
      setState({ kind: "error", message: String(err) });
    }
  };
  const busy = state.kind === "busy";
  return (
    <form className="pal-install" onSubmit={submit} aria-busy={busy}>
      <div className="pal-install__field">
        <input
          className="pal-install__input"
          aria-label="Install from GitHub"
          placeholder="Install from GitHub: user/repo, github:user/repo/subdir@ref, or a URL"
          value={spec}
          readOnly={busy}
          spellCheck={false}
          onChange={(e) => setSpec(e.target.value)}
        />
        <button type="submit" className="pal-button" data-small data-primary disabled={busy || !spec.trim()}>{busy ? "Installing…" : "Install"}</button>
      </div>
      {state.kind === "error" && <p className="pal-install__note" role="alert" data-error>{state.message}</p>}
      {state.kind === "done" && <p className="pal-install__note">Installed {state.spec}. The host is restarting; it lists below in a moment.</p>}
    </form>
  );
}

type PaneProps = {
  /** The extension's default instance (or the first entry of its name). */
  ext: SettingsExtension;
  /** Every instance of the name, the default first. */
  instances: SettingsExtension[];
  selectedInstance?: string;
  onSelectInstance?: (key: string) => void;
  busy?: "updating" | "removing";
  /** Why the last update/remove failed. */
  failed?: string;
  onChange: (key: string, values: SettingValues) => void;
  onUpdate?: () => void;
  onRemove?: () => void;
  onOpenLink?: (url: string) => void;
  onOpenPalette?: (id: string) => void;
  onInstanceAdd?: SettingsExtensionsProps["onInstanceAdd"];
  onInstanceRename?: SettingsExtensionsProps["onInstanceRename"];
  onInstanceRemove?: SettingsExtensionsProps["onInstanceRemove"];
  onInstanceEnabled?: SettingsExtensionsProps["onInstanceEnabled"];
};

/**
 * A button that asks once: the first press arms it for five seconds
 * ("Remove? Click again (5)"), the second press within them is the answer.
 * Blur disarms.
 */
function ArmedButton({ label, arm, busy, disabled, onConfirm, ...rest }: { label: string; arm: string; busy?: string; disabled?: boolean; onConfirm: () => void; "aria-label"?: string; "data-small"?: boolean; "data-destructive"?: boolean }) {
  const [left, setLeft] = useState(0);
  const arming = left > 0;
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [arming, left]);
  const press = () => {
    if (!arming) return setLeft(5);
    setLeft(0);
    onConfirm();
  };
  return (
    <button type="button" className="pal-button" data-small data-destructive disabled={disabled} onClick={press} onBlur={() => setLeft(0)} aria-live="polite" {...rest}>
      {busy ?? (arming ? `${arm} (${left})` : label)}
    </button>
  );
}

function ExtensionPane({ ext, instances, selectedInstance, onSelectInstance, busy, failed, onChange, onUpdate, onRemove, onOpenLink, onOpenPalette, onInstanceAdd, onInstanceRename, onInstanceRemove, onInstanceEnabled }: PaneProps) {
  const multi = !!ext.multi;
  // The instance whose settings show: the selected one when it is of this extension, else the default (or the first).
  const [localInstance, setLocalInstance] = useState<string | undefined>(undefined);
  const wanted = selectedInstance ?? localInstance;
  const inst = instances.find((i) => i.key === wanted) ?? instances.find((i) => i.instance?.isDefault) ?? instances[0] ?? ext;
  const selectInstance = (key: string) => { setLocalInstance(key); onSelectInstance?.(key); };
  const set = (id: string, v: SettingValue) => onChange(inst.key, { ...inst.values, [id]: v });
  const href = repoHref(ext.repo);
  const bundled = ext.bundled ?? ext.repo === "bundled";
  const missing = new Set(needsSetup(inst).map((s) => s.id));
  const link = (url: string | undefined, text: string) => (url && onOpenLink ? <button type="button" className="pal-link" onClick={() => onOpenLink(url)}>{text}</button> : <span>{text}</span>);
  const shots = ext.screenshots?.filter((s) => s.kind !== "bar") ?? [];
  const extTitle = ext.extTitle ?? ext.title;
  const errors = instances.filter((i) => i.error);
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
            <span>{ext.version ? `v${ext.version}` : "unversioned"}{ext.latest && <span className="pal-xpane__latest"> · {ext.latest} available</span>}</span>
            {bundled ? <Tag text="built in" color="grey" /> : ext.source ? <span title={ext.source}>from {ext.source.replace(/^github:/, "")}</span> : href ? link(href, ext.repo) : <span>installed by hand</span>}
            {ext.installed !== undefined && !bundled && <span>{relativeDate(ext.installed)} ago</span>}
          </p>
        </div>
        {ext.storeUrl && onOpenLink && <button type="button" className="pal-button" data-small onClick={() => onOpenLink(ext.storeUrl!)}>Store page</button>}
      </header>

      {shots.length > 0 && (
        <div className="pal-xpane__shots" role="list" aria-label="Screenshots">
          {shots.map((s) => (
            <figure key={s.src} className="pal-xpane__shot" role="listitem" title={s.caption}>
              <img src={s.src} alt={s.caption ?? ""} loading="lazy" draggable={false} onError={(e) => { (e.currentTarget.parentElement as HTMLElement).hidden = true; }} />
              {s.caption && <figcaption>{s.caption}</figcaption>}
            </figure>
          ))}
        </div>
      )}

      {failed && <p className="pal-callout" role="alert" data-level="error">{failed}</p>}
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
        {inst.palettes.length === 0 ? <p className="pal-pane__none">None{inst.error ? " while it fails to load" : inst.instance && !inst.instance.enabled ? " while the instance is off" : ""}.</p> : (
          <ul className="pal-xpane__palettes">
            {inst.palettes.map((p) => (
              <li key={p.id}>
                <button type="button" className="pal-xpane__palette" data-off={!p.config.enabled || undefined} onClick={() => onOpenPalette?.(p.id)} disabled={!onOpenPalette} title={p.description}>
                  <Icon icon={p.config.icon ? { kind: "emoji", value: p.config.icon } : p.icon ?? inst.icon} />
                  <span className="pal-xpane__palette-title">{p.title}</span>
                  {p.config.alias && <code className="pal-xpane__palette-alias">{p.config.alias}</code>}
                  {!p.config.enabled && <span className="pal-xpane__palette-off">off</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
      {(onUpdate || onRemove) && !bundled && (
        <footer className="pal-pane__foot">
          {onUpdate && (ext.latest ? (
            <button type="button" className="pal-button" data-small data-primary disabled={!!busy} onClick={onUpdate}>{busy === "updating" ? "Updating…" : `Update to ${ext.latest}`}</button>
          ) : (
            <span className="pal-pane__note">Up to date</span>
          ))}
          {onRemove && <ArmedButton label="Remove" arm="Remove? Click again" busy={busy === "removing" ? "Removing…" : undefined} disabled={!!busy} onConfirm={onRemove} />}
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
              {onRemove && !inst.isDefault && <ArmedButton label="Remove" arm="Remove? Click again" busy={busy === i.key ? "Removing…" : undefined} disabled={!!busy} onConfirm={() => run(i.key, () => onRemove(i.key))} aria-label={`Remove ${i.title}`} />}
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
