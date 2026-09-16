import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Empty } from "./Empty";
import { Icon } from "./Icon";
import { Tag } from "./Row";
import { SettingsDivider, SettingsField } from "./SettingsField";
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
};

export const extensionsIndex = (extensions: SettingsExtension[]): SettingsIndexEntry[] =>
  extensions.flatMap((e) => [
    { page: "extensions" as const, label: e.title, hint: `Extension ${e.version}` },
    ...e.settings.map((s) => ({ page: "extensions" as const, label: s.label, hint: e.title })),
  ]);

const repoHref = (repo: string) => (repo === "bundled" || !repo.includes(".") ? undefined : `https://${repo.replace(/^https?:\/\//, "")}`);

/**
 * Installed extensions on the left; the selected one's version, source
 * and the settings it declared on the right. The separator marks where
 * pal's knowledge of the extension ends and the extension's own begins.
 */
export function SettingsExtensions({ extensions, selected, onSelect, onChange, onInstall, onUpdate, onRemove }: SettingsExtensionsProps) {
  const list = useRef<HTMLDivElement>(null);
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

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = extensions.findIndex((x) => x.name === selected);
    let next: number | undefined;
    if (e.key === "ArrowDown") next = Math.min(i + 1, extensions.length - 1);
    else if (e.key === "ArrowUp") next = Math.max(i - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = extensions.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(extensions[next].name);
    list.current?.querySelector<HTMLElement>(`[data-ext="${extensions[next].name}"]`)?.focus();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {onInstall && <InstallBar onInstall={onInstall} />}
    <div className="pal-extensions">
      <div className="pal-extensions__list" role="listbox" aria-label="Installed extensions" ref={list} onKeyDown={onListKey}>
        {extensions.map((e) => (
          <div
            key={e.name}
            role="option"
            aria-selected={e.name === selected}
            data-ext={e.name}
            data-active={e.name === selected || undefined}
            tabIndex={e.name === selected || (!selected && e === extensions[0]) ? 0 : -1}
            className="pal-row pal-extensions__row"
            onClick={() => onSelect(e.name)}
            onFocus={() => onSelect(e.name)}
          >
            <Icon icon={e.icon} />
            <span className="pal-row__title">{e.title}</span>
            <span className="pal-row__sub">{e.version}</span>
            <span className="pal-row__accs">
              {e.latest && <Tag text="update" color="amber" />}
              {e.error && <Tag text="failed" color="red" />}
            </span>
          </div>
        ))}
      </div>

      <div className="pal-extensions__pane">
        {current ? (
          <ExtensionPane
            ext={current}
            busy={busy[current.name]}
            failed={failed[current.name]}
            onChange={(v) => onChange(current.name, v)}
            onUpdate={() => act(current.name, "updating", onUpdate)}
            onRemove={() => act(current.name, "removing", onRemove)}
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
 * The spec box above the list. Submit installs; the box is read-only and
 * says so while it runs, and the reason stays under it when it fails.
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
    <form onSubmit={submit} aria-busy={busy} style={{ padding: "var(--pal-space-2, 8px) var(--pal-space-3, 12px)", borderBottom: "1px solid var(--pal-line, rgba(255, 255, 255, 0.08))" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--pal-space-2, 8px)" }}>
        <input
          className="pal-field__input"
          style={{ flex: 1, minWidth: 0, fontFamily: "var(--pal-font-mono, ui-monospace, monospace)", fontSize: "var(--pal-text-sm, 12px)" }}
          aria-label="Install from GitHub"
          placeholder="Install from GitHub: user/repo, github:user/repo/subdir@ref, or a URL"
          value={spec}
          readOnly={busy}
          spellCheck={false}
          onChange={(e) => setSpec(e.target.value)}
        />
        <button type="submit" className="pal-button" data-primary disabled={busy || !spec.trim()}>{busy ? "Installing…" : "Install"}</button>
      </div>
      {state.kind === "error" && <p className="pal-extensions__desc" role="alert" style={{ color: "var(--pal-tag-red)" }}>{state.message}</p>}
      {state.kind === "done" && <p className="pal-extensions__desc">Installed {state.spec}. The host is restarting; it lists below in a moment.</p>}
    </form>
  );
}

type PaneProps = {
  ext: SettingsExtension;
  busy?: "updating" | "removing";
  /** Why the last update/remove failed. */
  failed?: string;
  onChange: (values: SettingValues) => void;
  onUpdate: () => void;
  onRemove: () => void;
};

function ExtensionPane({ ext, busy, failed, onChange, onUpdate, onRemove }: PaneProps) {
  const set = (id: string, v: SettingValue) => onChange({ ...ext.values, [id]: v });
  const href = repoHref(ext.repo);
  // Remove asks once: the second press within a few seconds is the answer.
  const [arming, setArming] = useState(false);
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 4000);
    return () => clearTimeout(t);
  }, [arming]);
  useEffect(() => setArming(false), [ext.name]);
  const remove = () => {
    if (!arming) return setArming(true);
    setArming(false);
    onRemove();
  };
  return (
    <div className="pal-extensions__detail">
      <header className="pal-extensions__head">
        <Icon icon={ext.icon} />
        <h3 className="pal-extensions__title">{ext.title}</h3>
        <div className="pal-extensions__actions">
          {ext.latest ? (
            <button type="button" className="pal-button" data-primary disabled={!!busy} onClick={onUpdate}>{busy === "updating" ? "Updating…" : `Update to ${ext.latest}`}</button>
          ) : (
            <span className="pal-extensions__uptodate">Up to date</span>
          )}
          {!(ext.bundled ?? ext.repo === "bundled") && (
            <button type="button" className="pal-button" data-destructive disabled={!!busy} onClick={remove} onBlur={() => setArming(false)}>
              {busy === "removing" ? "Removing…" : arming ? "Remove? Click again" : "Remove"}
            </button>
          )}
        </div>
      </header>
      <p className="pal-extensions__desc">{ext.description}</p>
      {failed && <p className="pal-extensions__desc" role="alert" style={{ color: "var(--pal-tag-red)" }}>{failed}</p>}
      {ext.error && <p className="pal-extensions__desc" role="alert" style={{ color: "var(--pal-tag-red)" }}>Failed to load: <code>{ext.error}</code></p>}

      <dl className="pal-extensions__meta">
        <div className="pal-meta"><dt className="pal-meta__label">Version</dt><dd className="pal-meta__value">{ext.version}{ext.latest && <span className="pal-extensions__latest">{ext.latest} available</span>}</dd></div>
        <div className="pal-meta"><dt className="pal-meta__label">Source</dt><dd className="pal-meta__value">{href ? <a href={href} target="_blank" rel="noreferrer">{ext.repo}</a> : ext.bundled ?? ext.repo === "bundled" ? "Ships with pal" : ext.source ? <code>{ext.source}</code> : "Installed by hand"}</dd></div>
        {ext.installed !== undefined && <div className="pal-meta"><dt className="pal-meta__label">Installed</dt><dd className="pal-meta__value">{relativeDate(ext.installed)} ago</dd></div>}
        <div className="pal-meta"><dt className="pal-meta__label">Palettes</dt><dd className="pal-meta__value">{ext.palettes.map((p) => p.title).join(", ")}</dd></div>
      </dl>

      <SettingsDivider text="Declared by the extension" note={`extensions.${ext.name}`} />
      {ext.settings.length === 0 && <p className="pal-extensions__none">{ext.title} declares no settings. Its palettes may; see Palettes.</p>}
      <div className="pal-extensions__form">
        {ext.settings.map((s) => (
          <SettingsField key={s.id} spec={s} value={ext.values[s.id] ?? s.default} onChange={(v) => set(s.id, v)} />
        ))}
      </div>
    </div>
  );
}
