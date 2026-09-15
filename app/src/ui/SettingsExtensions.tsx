import { useRef, type KeyboardEvent } from "react";
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
  onUpdate?: (name: string) => void;
  onRemove?: (name: string) => void;
};

export const extensionsIndex = (extensions: SettingsExtension[]): SettingsIndexEntry[] =>
  extensions.flatMap((e) => [
    { page: "extensions" as const, label: e.title, hint: `Extension ${e.version}` },
    ...e.settings.map((s) => ({ page: "extensions" as const, label: s.label, hint: e.title })),
  ]);

const repoHref = (repo: string) => (repo === "bundled" ? undefined : `https://${repo}`);

/**
 * Installed extensions on the left; the selected one's version, source
 * and the settings it declared on the right. The separator marks where
 * pal's knowledge of the extension ends and the extension's own begins.
 */
export function SettingsExtensions({ extensions, selected, onSelect, onChange, onUpdate, onRemove }: SettingsExtensionsProps) {
  const list = useRef<HTMLDivElement>(null);
  const current = extensions.find((e) => e.name === selected);

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
            </span>
          </div>
        ))}
      </div>

      <div className="pal-extensions__pane">
        {current ? (
          <ExtensionPane ext={current} onChange={(v) => onChange(current.name, v)} onUpdate={() => onUpdate?.(current.name)} onRemove={() => onRemove?.(current.name)} />
        ) : (
          <Empty title="No extension selected" />
        )}
      </div>
    </div>
  );
}

function ExtensionPane({ ext, onChange, onUpdate, onRemove }: { ext: SettingsExtension; onChange: (values: SettingValues) => void; onUpdate: () => void; onRemove: () => void }) {
  const set = (id: string, v: SettingValue) => onChange({ ...ext.values, [id]: v });
  const href = repoHref(ext.repo);
  return (
    <div className="pal-extensions__detail">
      <header className="pal-extensions__head">
        <Icon icon={ext.icon} />
        <h3 className="pal-extensions__title">{ext.title}</h3>
        <div className="pal-extensions__actions">
          {ext.latest ? (
            <button type="button" className="pal-button" data-primary onClick={onUpdate}>Update to {ext.latest}</button>
          ) : (
            <span className="pal-extensions__uptodate">Up to date</span>
          )}
          {ext.repo !== "bundled" && <button type="button" className="pal-button" data-destructive onClick={onRemove}>Remove</button>}
        </div>
      </header>
      <p className="pal-extensions__desc">{ext.description}</p>

      <dl className="pal-extensions__meta">
        <div className="pal-meta"><dt className="pal-meta__label">Version</dt><dd className="pal-meta__value">{ext.version}{ext.latest && <span className="pal-extensions__latest">{ext.latest} available</span>}</dd></div>
        <div className="pal-meta"><dt className="pal-meta__label">Source</dt><dd className="pal-meta__value">{href ? <a href={href} target="_blank" rel="noreferrer">{ext.repo}</a> : "Ships with pal"}</dd></div>
        <div className="pal-meta"><dt className="pal-meta__label">Installed</dt><dd className="pal-meta__value">{relativeDate(ext.installed)} ago</dd></div>
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
