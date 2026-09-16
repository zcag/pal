import { useRef, useState, type KeyboardEvent } from "react";
import { Empty } from "./Empty";
import { Icon } from "./Icon";
import { SettingsDivider, SettingsField, SettingsHotkey, SettingsRow, SettingsSwitch } from "./SettingsField";
import type { PaletteConfig, SettingsExtension, SettingsIndexEntry, SettingsPalette, SettingValue } from "./SettingsTypes";
import type { Icon as IconSpec } from "./types";

export type SettingsPalettesProps = {
  extensions: SettingsExtension[];
  /** Selected palette id. */
  selected?: string;
  onSelect: (id: string | undefined) => void;
  onChange: (id: string, config: PaletteConfig) => void;
  /** Filters the table; matched against palette and extension titles. */
  filter?: string;
};

/** The icon a palette shows: its override, else the extension's. */
export const paletteIcon = (p: SettingsPalette, ext: SettingsExtension): IconSpec | undefined =>
  p.config.icon ? { kind: "emoji", value: p.config.icon } : p.icon ?? ext.icon;

export const palettesIndex = (extensions: SettingsExtension[]): SettingsIndexEntry[] =>
  extensions.flatMap((e) => [
    ...e.palettes.map((p) => ({ page: "palettes" as const, label: p.title, hint: `${e.title} palette` })),
    ...e.palettes.flatMap((p) => p.settings.map((s) => ({ page: "palettes" as const, label: s.label, hint: `${p.title} (${e.title})` }))),
  ]);

const columns = ["Enabled", "Alias", "Hotkey", "Icon"];

/**
 * Every palette, grouped by the extension that provides it, with the
 * per-palette defaults pal gives each one as inline columns. The selected
 * row's full settings, pal's and the extension's, are in the pane.
 */
export function SettingsPalettes({ extensions, selected, onSelect, onChange, filter }: SettingsPalettesProps) {
  const grid = useRef<HTMLDivElement>(null);
  const q = filter?.trim().toLowerCase();
  const shown = extensions
    .map((e) => ({ ext: e, palettes: q ? e.palettes.filter((p) => `${p.title} ${e.title}`.toLowerCase().includes(q)) : e.palettes }))
    .filter((g) => g.palettes.length);
  const flat = shown.flatMap((g) => g.palettes.map((p) => ({ p, ext: g.ext })));
  const current = flat.find((f) => f.p.id === selected);
  const set = (p: SettingsPalette, patch: Partial<PaletteConfig>) => onChange(p.id, { ...p.config, ...patch });

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).matches("[data-palette-row]")) return; // keys inside a cell's control are its own
    const i = flat.findIndex((f) => f.p.id === selected);
    let next: number | undefined;
    if (e.key === "ArrowDown") next = Math.min(i + 1, flat.length - 1);
    else if (e.key === "ArrowUp") next = Math.max(i - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = flat.length - 1;
    else if (e.key === " " && current) { e.preventDefault(); e.stopPropagation(); set(current.p, { enabled: !current.p.config.enabled }); return; }
    if (next === undefined || !flat[next]) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(flat[next].p.id);
    grid.current?.querySelector<HTMLElement>(`[data-palette-row="${flat[next].p.id}"]`)?.focus();
  };

  return (
    <div className="pal-palettes">
      <div className="pal-palettes__table" role="grid" aria-label="Palettes" aria-rowcount={flat.length} ref={grid} onKeyDown={onGridKey}>
        <div className="pal-palettes__head" role="row">
          <span role="columnheader" className="pal-palettes__col pal-palettes__col--name">Palette</span>
          {columns.map((c) => <span key={c} role="columnheader" className="pal-palettes__col">{c}</span>)}
        </div>
        {shown.map(({ ext, palettes }) => (
          <div key={ext.name} role="rowgroup" className="pal-palettes__group">
            <div role="row" className="pal-palettes__ext" aria-label={ext.title}>
              <span role="gridcell" className="pal-palettes__cell pal-palettes__cell--name">
                <Icon icon={ext.icon} />
                <span className="pal-palettes__ext-title">{ext.title}</span>
                <span className="pal-palettes__ext-meta">{ext.palettes.length === 1 ? "1 palette" : `${ext.palettes.length} palettes`}</span>
              </span>
            </div>
            {palettes.map((p) => {
              const active = p.id === selected;
              return (
                <div
                  key={p.id}
                  role="row"
                  aria-selected={active}
                  data-palette-row={p.id}
                  data-active={active || undefined}
                  data-disabled={!p.config.enabled || undefined}
                  tabIndex={active || (!selected && flat[0]?.p === p) ? 0 : -1}
                  className="pal-palettes__row"
                  onClick={() => onSelect(p.id)}
                  onFocus={(e) => { if (e.target === e.currentTarget) onSelect(p.id); }}
                >
                  <span role="gridcell" className="pal-palettes__cell pal-palettes__cell--name">
                    <Icon icon={paletteIcon(p, ext)} />
                    <span className="pal-palettes__name">{p.title}</span>
                  </span>
                  <span role="gridcell" className="pal-palettes__cell pal-palettes__cell--enabled">
                    <SettingsSwitch checked={p.config.enabled} onChange={(v) => set(p, { enabled: v })} label={`${p.title} enabled`} />
                  </span>
                  <span role="gridcell" className="pal-palettes__cell">
                    <input
                      className="pal-inline"
                      type="text"
                      value={p.config.alias ?? ""}
                      placeholder="Add alias"
                      aria-label={`${p.title} alias`}
                      spellCheck={false}
                      size={6}
                      onChange={(e) => set(p, { alias: e.target.value || undefined })}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
                    />
                  </span>
                  <span role="gridcell" className="pal-palettes__cell">
                    <SettingsHotkey compact value={p.config.hotkey} onChange={(v) => set(p, { hotkey: v })} label={`${p.title} hotkey`} />
                  </span>
                  <span role="gridcell" className="pal-palettes__cell pal-palettes__cell--icon">
                    <IconPick p={p} ext={ext} onChange={(icon) => set(p, { icon })} />
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && <Empty title="No palettes match" hint="Try another name" />}
      </div>

      <div className="pal-palettes__pane">
        {current ? <PalettePane key={current.p.id} p={current.p} ext={current.ext} onChange={(patch) => set(current.p, patch)} /> : <Empty title="No palette selected" hint="Pick one to set its hotkey, alias and settings" />}
      </div>
    </div>
  );
}

/**
 * The icon override: the button shows the current icon; a click turns it
 * into a one-character field (paste an emoji, type a glyph), Enter or blur
 * commits, Escape cancels, empty clears the override.
 */
function IconPick({ p, ext, onChange, withButton }: { p: SettingsPalette; ext: SettingsExtension; onChange: (icon: string | undefined) => void; withButton?: boolean }) {
  const [editing, setEditing] = useState(false);
  const commit = (v: string) => { onChange(v.trim() || undefined); setEditing(false); };
  if (editing) {
    return (
      <input
        className="pal-inline"
        type="text"
        size={3}
        autoFocus
        defaultValue={p.config.icon ?? ""}
        placeholder="Emoji"
        aria-label={`${p.title} icon`}
        spellCheck={false}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit(e.currentTarget.value);
          else if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <>
      <button type="button" className="pal-iconpick" data-override={p.config.icon ? "" : undefined} aria-label={`${p.title} icon${p.config.icon ? ", overridden" : ""}`} title="Change icon" onClick={() => setEditing(true)}>
        <Icon icon={paletteIcon(p, ext)} />
      </button>
      {withButton && <button type="button" className="pal-button" onClick={() => setEditing(true)}>Change…</button>}
    </>
  );
}

function PalettePane({ p, ext, onChange }: { p: SettingsPalette; ext: SettingsExtension; onChange: (patch: Partial<PaletteConfig>) => void }) {
  const setSetting = (id: string, v: SettingValue) => onChange({ settings: { ...p.config.settings, [id]: v } });
  const aliasId = `pal-palette-alias-${p.id}`;
  return (
    <div className="pal-palettes__detail">
      <header className="pal-palettes__detail-head">
        <Icon icon={paletteIcon(p, ext)} />
        <div className="pal-palettes__detail-titles">
          <h3 className="pal-palettes__detail-title">{p.title}</h3>
          <span className="pal-palettes__detail-sub">{ext.title} <code>palettes.{p.id}</code></span>
        </div>
      </header>
      {p.description && <p className="pal-palettes__detail-desc">{p.description}</p>}

      <SettingsRow label="Enabled" layout="stack">
        <span className="pal-field__check">
          <SettingsSwitch checked={p.config.enabled} onChange={(v) => onChange({ enabled: v })} label={`${p.title} enabled`} />
          <span>{p.config.enabled ? "Shown in root search" : "Hidden everywhere"}</span>
        </span>
      </SettingsRow>
      <SettingsRow label="Alias" layout="stack" htmlFor={aliasId} description="An extra keyword on the palette's row at the root: typing it finds the palette.">
        <input id={aliasId} className="pal-field__input" type="text" value={p.config.alias ?? ""} placeholder="none" spellCheck={false} onChange={(e) => onChange({ alias: e.target.value || undefined })} />
      </SettingsRow>
      <SettingsRow label="Hotkey" layout="stack" description="Opens pal directly in this palette.">
        <SettingsHotkey value={p.config.hotkey} onChange={(v) => onChange({ hotkey: v })} label={`${p.title} hotkey`} />
      </SettingsRow>
      <SettingsRow label="Icon" layout="stack" description="An emoji or a glyph, in place of the extension's own.">
        <span className="pal-palettes__iconrow">
          <IconPick p={p} ext={ext} onChange={(icon) => onChange({ icon })} withButton />
          {p.config.icon && <button type="button" className="pal-setting__reset" onClick={() => onChange({ icon: undefined })}>Use {ext.title}'s</button>}
        </span>
      </SettingsRow>

      <SettingsDivider text={`Declared by ${ext.title}`} note={`palettes.${p.id}.settings`} />
      {p.settings.length === 0 && <p className="pal-palettes__none">{ext.title} declares no settings for this palette.</p>}
      {p.settings.map((s) => (
        <SettingsField key={s.id} spec={s} value={p.config.settings[s.id] ?? s.default} onChange={(v) => setSetting(s.id, v)} layout="stack" />
      ))}
    </div>
  );
}
