import { useEffect, useState, type FormEvent } from "react";
import { Empty } from "./Empty";
import { Icon } from "./Icon";
import { Tag } from "./Row";
import { SettingsField } from "./SettingsField";
import { SettingsList } from "./SettingsList";
import { needsSetup, type SettingsExtension, type SettingsIndexEntry, type SettingValue, type SettingValues } from "./SettingsTypes";
import { relativeDate } from "./format";

export type SettingsExtensionsProps = {
  extensions: SettingsExtension[];
  selected?: string;
  onSelect: (name: string) => void;
  onChange: (name: string, values: SettingValues) => void;
  /** Install from a spec (a github:user/repo[/subdir][@ref] or a github.com URL, a path). Rejects with the reason. */
  onInstall?: (spec: string) => Promise<void>;
  onUpdate?: (name: string) => Promise<void> | void;
  onRemove?: (name: string) => Promise<void> | void;
  /** Opens a URL in the browser; the source link is plain text without it. */
  onOpenLink?: (url: string) => void;
  /** The Palettes page on one of this extension's palettes. */
  onOpenPalette?: (id: string) => void;
};

export const extensionsIndex = (extensions: SettingsExtension[]): SettingsIndexEntry[] =>
  extensions.flatMap((e) => [
    { page: "extensions" as const, label: e.title, hint: e.tagline ?? e.description ?? `Extension ${e.version}`, anchor: `extensions:${e.name}`, keywords: `${e.name} extension ${e.author ?? ""}` },
    ...e.settings.map((s) => ({ page: "extensions" as const, label: s.label, hint: `${e.title} setting`, anchor: `extensions:${e.name}:${s.id}`, keywords: s.description })),
  ]);

const repoHref = (repo: string) => (repo === "bundled" || !repo.includes(".") ? undefined : `https://${repo.replace(/^https?:\/\//, "")}`);

/**
 * The install field over the page; installed extensions on the left; the
 * selected one on the right as the store shows it (icon, tagline,
 * version, author, screenshots), then what needs attention, its settings,
 * its palettes, and Update and Remove in the pane's footer.
 */
export function SettingsExtensions({ extensions, selected, onSelect, onChange, onInstall, onUpdate, onRemove, onOpenLink, onOpenPalette }: SettingsExtensionsProps) {
  const current = extensions.find((e) => e.name === selected);
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
  const attention = (e: SettingsExtension) => e.error ? <Tag text="failed" color="red" /> : needsSetup(e).length ? <Tag text="setup" color="amber" /> : e.latest ? <Tag text="update" color="amber" /> : e.warnings?.length ? <Tag text="warning" color="amber" /> : undefined;

  return (
    <div className="pal-extensions">
      {onInstall && <InstallBar onInstall={onInstall} />}
      <div className="pal-split">
        <SettingsList
          label="Installed extensions"
          items={extensions.map((e) => ({
            id: e.name,
            icon: e.icon,
            title: e.title,
            sub: [e.version, e.bundled ?? e.repo === "bundled" ? "built in" : undefined].filter(Boolean).join(", "),
            dim: e.loaded === false,
            accessory: attention(e),
          }))}
          selected={selected}
          onSelect={onSelect}
        />
        <div className="pal-split__pane">
          {current ? (
            <ExtensionPane
              key={current.name}
              ext={current}
              busy={busy[current.name]}
              failed={failed[current.name]}
              onChange={(v) => onChange(current.name, v)}
              onUpdate={onUpdate && (() => act(current.name, "updating", onUpdate))}
              onRemove={onRemove && (() => act(current.name, "removing", onRemove))}
              onOpenLink={onOpenLink}
              onOpenPalette={onOpenPalette}
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
  ext: SettingsExtension;
  busy?: "updating" | "removing";
  /** Why the last update/remove failed. */
  failed?: string;
  onChange: (values: SettingValues) => void;
  onUpdate?: () => void;
  onRemove?: () => void;
  onOpenLink?: (url: string) => void;
  onOpenPalette?: (id: string) => void;
};

function ExtensionPane({ ext, busy, failed, onChange, onUpdate, onRemove, onOpenLink, onOpenPalette }: PaneProps) {
  const set = (id: string, v: SettingValue) => onChange({ ...ext.values, [id]: v });
  const href = repoHref(ext.repo);
  const bundled = ext.bundled ?? ext.repo === "bundled";
  const missing = new Set(needsSetup(ext).map((s) => s.id));
  const link = (url: string | undefined, text: string) => (url && onOpenLink ? <button type="button" className="pal-link" onClick={() => onOpenLink(url)}>{text}</button> : <span>{text}</span>);
  // Remove asks once: the second press while the count runs is the answer.
  // The pane is keyed by extension, so switching extensions resets it.
  const [left, setLeft] = useState(0);
  const arming = left > 0;
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [arming, left]);
  const remove = () => {
    if (!arming) return setLeft(5);
    setLeft(0);
    onRemove?.();
  };
  const shots = ext.screenshots?.filter((s) => s.kind !== "bar") ?? [];
  return (
    <>
    <div className="pal-pane pal-xpane" data-anchor={`extensions:${ext.name}`}>
      <header className="pal-xpane__hero">
        <span className="pal-xpane__tile" data-image={ext.icon?.kind === "image" || ext.icon?.kind === "app" || undefined}><Icon icon={ext.icon} size="lg" /></span>
        <div className="pal-xpane__titles">
          <h3 className="pal-xpane__title">{ext.title}</h3>
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
      {ext.error && <div className="pal-callout" role="alert" data-level="error"><strong>Failed to load.</strong> <code>{ext.error}</code> Fix the code and pal reloads it, or restart the host under General.</div>}
      {ext.warnings?.map((w) => <p key={w} className="pal-callout" data-level="warning"><strong>Manifest:</strong> {w}</p>)}
      {missing.size > 0 && !ext.error && <p className="pal-callout" data-level="warning">Nothing lists until {ext.settings.filter((s) => missing.has(s.id)).map((s) => s.label.toLowerCase()).join(" and ")} {missing.size === 1 ? "is" : "are"} set below.</p>}

      <section className="pal-xpane__section" aria-label="Settings">
        <h4 className="pal-xpane__h">Settings <span className="pal-xpane__h-note">extensions.{ext.name}</span></h4>
        {ext.settings.length === 0 ? (
          <p className="pal-pane__none">{ext.title} declares no settings of its own.{ext.palettes.some((p) => p.settings.length) ? " Its palettes do; see Palettes." : ""}</p>
        ) : (
          <div className="pal-settings-group__rows pal-xpane__fields">
            {ext.settings.map((s) => (
              <div key={s.id} data-anchor={`extensions:${ext.name}:${s.id}`} data-missing={missing.has(s.id) || undefined}>
                <SettingsField spec={s} value={ext.values[s.id] ?? s.default} onChange={(v) => set(s.id, v)} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="pal-xpane__section" aria-label="Palettes">
        <h4 className="pal-xpane__h">Palettes</h4>
        {ext.palettes.length === 0 ? <p className="pal-pane__none">None{ext.error ? " while it fails to load" : ""}.</p> : (
          <ul className="pal-xpane__palettes">
            {ext.palettes.map((p) => (
              <li key={p.id}>
                <button type="button" className="pal-xpane__palette" data-off={!p.config.enabled || undefined} onClick={() => onOpenPalette?.(p.id)} disabled={!onOpenPalette} title={p.description}>
                  <Icon icon={p.config.icon ? { kind: "emoji", value: p.config.icon } : p.icon ?? ext.icon} />
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
          {onRemove && (
            <button type="button" className="pal-button" data-small data-destructive disabled={!!busy} onClick={remove} onBlur={() => setLeft(0)} aria-live="polite">
              {busy === "removing" ? "Removing…" : arming ? `Remove? Click again (${left})` : "Remove"}
            </button>
          )}
        </footer>
      )}
    </>
  );
}
