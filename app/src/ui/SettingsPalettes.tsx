import { useState } from "react";
import { Empty } from "./Empty";
import { Icon } from "./Icon";
import { Tag } from "./Row";
import { SettingsDivider, SettingsField, SettingsHotkey, SettingsSwitch } from "./SettingsField";
import { SettingsList } from "./SettingsList";
import type { PaletteConfig, SettingsExtension, SettingsIndexEntry, SettingsPalette, SettingValue } from "./SettingsTypes";
import type { Icon as IconSpec } from "./types";

export type SettingsPalettesProps = {
  extensions: SettingsExtension[];
  /** Selected palette id; its extension is the one open on the left. */
  selected?: string;
  onSelect: (id: string | undefined) => void;
  onChange: (id: string, config: PaletteConfig) => void;
};

/** The icon a palette shows: its override, else the extension's. */
export const paletteIcon = (p: SettingsPalette, ext: SettingsExtension): IconSpec | undefined =>
  p.config.icon ? { kind: "emoji", value: p.config.icon } : p.icon ?? ext.icon;

export const palettesIndex = (extensions: SettingsExtension[]): SettingsIndexEntry[] =>
  extensions.flatMap((e) => [
    ...e.palettes.map((p) => ({ page: "palettes" as const, label: p.title, hint: `${e.title} palette` })),
    ...e.palettes.flatMap((p) => p.settings.map((s) => ({ page: "palettes" as const, label: s.label, hint: `${p.title} (${e.title})` }))),
  ]);

const count = (n: number) => (n === 1 ? "1 palette" : `${n} palettes`);

/**
 * Extensions on the left; on the right the selected one's palettes as a
 * table of what pal gives every palette (enabled, alias, hotkey, icon),
 * and under it the settings the extension declared for the palette whose
 * row was last touched. Arrows move the list; Tab walks the table.
 */
export function SettingsPalettes({ extensions, selected, onSelect, onChange }: SettingsPalettesProps) {
  const ext = extensions.find((e) => e.palettes.some((p) => p.id === selected)) ?? extensions[0];
  const current = ext?.palettes.find((p) => p.id === selected) ?? ext?.palettes[0];
  const set = (p: SettingsPalette, patch: Partial<PaletteConfig>) => onChange(p.id, { ...p.config, ...patch });
  const setSetting = (p: SettingsPalette, id: string, v: SettingValue) => set(p, { settings: { ...p.config.settings, [id]: v } });

  return (
    <div className="pal-split">
      <SettingsList
        label="Extensions"
        items={extensions.map((e) => ({ id: e.name, icon: e.icon, title: e.title, sub: count(e.palettes.length), dim: e.loaded === false, accessory: e.error ? <Tag text="failed" color="red" /> : undefined }))}
        selected={ext?.name}
        onSelect={(name) => onSelect(extensions.find((e) => e.name === name)?.palettes[0]?.id)}
      />
      <div className="pal-split__pane">
        {ext ? (
          <div className="pal-pane">
            <header className="pal-pane__head">
              <Icon icon={ext.icon} />
              <div className="pal-pane__titles">
                <h3 className="pal-pane__title">{ext.title}</h3>
                {ext.description && <p className="pal-pane__sub">{ext.description}</p>}
              </div>
            </header>

            <div className="pal-table" role="grid" aria-label={`${ext.title} palettes`} aria-rowcount={ext.palettes.length}>
              <div className="pal-table__head" role="row">
                <span role="columnheader" className="pal-table__col pal-table__col--name">Palette</span>
                <span role="columnheader" className="pal-table__col">Enabled</span>
                <span role="columnheader" className="pal-table__col pal-table__col--alias">Alias</span>
                <span role="columnheader" className="pal-table__col">Hotkey</span>
                <span role="columnheader" className="pal-table__col">Icon</span>
              </div>
              {ext.palettes.map((p) => (
                <div
                  key={p.id}
                  role="row"
                  aria-selected={p === current}
                  data-palette-row={p.id}
                  data-active={p === current || undefined}
                  data-disabled={!p.config.enabled || undefined}
                  className="pal-table__row"
                  onClick={() => onSelect(p.id)}
                  onFocus={() => onSelect(p.id)}
                >
                  <span role="gridcell" className="pal-table__cell pal-table__cell--name">
                    <Icon icon={paletteIcon(p, ext)} />
                    <span className="pal-table__name">{p.title}</span>
                  </span>
                  <span role="gridcell" className="pal-table__cell">
                    <SettingsSwitch checked={p.config.enabled} onChange={(v) => set(p, { enabled: v })} label={`${p.title} enabled`} />
                  </span>
                  <span role="gridcell" className="pal-table__cell pal-table__cell--alias">
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
                  <span role="gridcell" className="pal-table__cell">
                    <SettingsHotkey compact value={p.config.hotkey} onChange={(v) => set(p, { hotkey: v })} label={`${p.title} hotkey`} />
                  </span>
                  <span role="gridcell" className="pal-table__cell">
                    <IconPick p={p} ext={ext} onChange={(icon) => set(p, { icon })} />
                  </span>
                </div>
              ))}
            </div>

            {current && (
              <>
                <SettingsDivider text={`${current.title} settings`} note={`palettes.${current.id}.settings`} />
                {current.description && <p className="pal-pane__desc">{current.description}</p>}
                {current.settings.length === 0 ? (
                  <p className="pal-pane__none">{ext.title} declares no settings for {current.title}.</p>
                ) : (
                  <div className="pal-settings-group__rows">
                    {current.settings.map((s) => (
                      <SettingsField key={s.id} spec={s} value={current.config.settings[s.id] ?? s.default} onChange={(v) => setSetting(current, s.id, v)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <Empty title="No extensions" hint="Install one on the Extensions page" />
        )}
      </div>
    </div>
  );
}

/**
 * The icon override: the button shows the current icon; a click turns it
 * into a one-character field (paste an emoji, type a glyph), Enter or blur
 * commits, Escape cancels, empty clears the override.
 */
function IconPick({ p, ext, onChange }: { p: SettingsPalette; ext: SettingsExtension; onChange: (icon: string | undefined) => void }) {
  const [editing, setEditing] = useState(false);
  const commit = (v: string) => { onChange(v.trim() || undefined); setEditing(false); };
  if (editing) {
    return (
      <input
        className="pal-inline pal-inline--icon"
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
    <button type="button" className="pal-iconpick" data-override={p.config.icon ? "" : undefined} aria-label={`${p.title} icon${p.config.icon ? ", overridden" : ""}`} title={p.config.icon ? "Change icon (empty restores the extension's)" : "Change icon"} onClick={() => setEditing(true)}>
      <Icon icon={paletteIcon(p, ext)} />
    </button>
  );
}
