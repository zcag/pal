import { useEffect, useState, type FormEvent } from "react";
import { Empty } from "./Empty";
import { Icon } from "./Icon";
import { Tag } from "./Row";
import { SettingsDivider, SettingsField } from "./SettingsField";
import { SettingsList } from "./SettingsList";
import type { SettingsExtension, SettingsIndexEntry, SettingValue, SettingValues } from "./SettingsTypes";
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
};

export const extensionsIndex = (extensions: SettingsExtension[]): SettingsIndexEntry[] =>
  extensions.flatMap((e) => [
    { page: "extensions" as const, label: e.title, hint: `Extension ${e.version}` },
    ...e.settings.map((s) => ({ page: "extensions" as const, label: s.label, hint: e.title })),
  ]);

const repoHref = (repo: string) => (repo === "bundled" || !repo.includes(".") ? undefined : `https://${repo.replace(/^https?:\/\//, "")}`);

/**
 * The install field over the page; installed extensions on the left; the
 * selected one's source, version and declared settings on the right, with
 * Update and Remove in the pane's footer.
 */
export function SettingsExtensions({ extensions, selected, onSelect, onChange, onInstall, onUpdate, onRemove, onOpenLink }: SettingsExtensionsProps) {
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
            sub: [e.version, e.bundled ?? e.repo === "bundled" ? "built in" : undefined].filter(Boolean).join(" · "),
            dim: e.loaded === false,
            accessory: e.error ? <Tag text="failed" color="red" /> : e.latest ? <Tag text="update" color="amber" /> : undefined,
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
            />
          ) : (
            <Empty title="No extension selected" />
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
};

function ExtensionPane({ ext, busy, failed, onChange, onUpdate, onRemove, onOpenLink }: PaneProps) {
  const set = (id: string, v: SettingValue) => onChange({ ...ext.values, [id]: v });
  const href = repoHref(ext.repo);
  const bundled = ext.bundled ?? ext.repo === "bundled";
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
  return (
    <>
    <div className="pal-pane">
      <header className="pal-pane__head">
        <Icon icon={ext.icon} />
        <div className="pal-pane__titles">
          <h3 className="pal-pane__title">{ext.title}</h3>
          {ext.description && <p className="pal-pane__sub">{ext.description}</p>}
        </div>
      </header>
      {failed && <p className="pal-pane__desc" role="alert" data-error>{failed}</p>}
      {ext.error && <p className="pal-pane__desc" role="alert" data-error>Failed to load: <code>{ext.error}</code></p>}

      <dl className="pal-meta-list">
        <div className="pal-meta"><dt className="pal-meta__label">Version</dt><dd className="pal-meta__value">{ext.version || "unversioned"}{ext.latest && <span className="pal-extensions__latest">{ext.latest} available</span>}</dd></div>
        <div className="pal-meta"><dt className="pal-meta__label">Source</dt><dd className="pal-meta__value">
          {href ? (
            onOpenLink ? <button type="button" className="pal-link" onClick={() => onOpenLink(href)}>{ext.repo}</button> : <span>{ext.repo}</span>
          ) : bundled ? "Ships with pal" : ext.source ? <code>{ext.source}</code> : "Installed by hand"}
        </dd></div>
        {ext.installed !== undefined && <div className="pal-meta"><dt className="pal-meta__label">Installed</dt><dd className="pal-meta__value">{relativeDate(ext.installed)} ago</dd></div>}
        <div className="pal-meta"><dt className="pal-meta__label">Palettes</dt><dd className="pal-meta__value">{ext.palettes.map((p) => p.title).join(", ")}</dd></div>
      </dl>

      <SettingsDivider text="Settings" note={`extensions.${ext.name}`} />
      {ext.settings.length === 0 ? (
        <p className="pal-pane__none">{ext.title} declares no settings. Its palettes may; see Palettes.</p>
      ) : (
        <div className="pal-settings-group__rows">
          {ext.settings.map((s) => (
            <SettingsField key={s.id} spec={s} value={ext.values[s.id] ?? s.default} onChange={(v) => set(s.id, v)} />
          ))}
        </div>
      )}
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
