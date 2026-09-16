import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Empty } from "./Empty";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { Tag } from "./Row";
import { SettingsField, SettingsHotkey, SettingsSelect, SettingsSwitch } from "./SettingsField";
import type { PaletteConfig, PaletteTier, SettingsExtension, SettingsIndexEntry, SettingsPalette, SettingValue } from "./SettingsTypes";
import type { Icon as IconSpec } from "./types";

/** One indexed row of a palette, for the item hotkeys' picker. */
export type PaletteItem = { id: string; name: string };

export type SettingsPalettesProps = {
  extensions: SettingsExtension[];
  /** Selected palette id. */
  selected?: string;
  onSelect: (id: string | undefined) => void;
  onChange: (id: string, config: PaletteConfig) => void;
  /** The Extensions page for the palette's extension. */
  onOpenExtension?: (name: string) => void;
  /** The palette's rows as indexed now (its cached listing), for the item hotkeys' picker; absent, the id is typed. */
  items?: (palette: SettingsPalette) => Promise<PaletteItem[]>;
};

/** The icon a palette shows: its override, else the extension's. */
export const paletteIcon = (p: SettingsPalette, ext: SettingsExtension): IconSpec | undefined =>
  p.config.icon ? { kind: "emoji", value: p.config.icon } : p.icon ?? ext.icon;

export const palettesIndex = (extensions: SettingsExtension[]): SettingsIndexEntry[] =>
  extensions.flatMap((e) => [
    ...e.palettes.map((p) => ({ page: "palettes" as const, label: p.title === e.title ? p.title : `${e.title} › ${p.title}`, hint: p.description ?? `${e.title} palette`, anchor: `palettes:${p.id}`, keywords: `${p.config.alias ?? ""} ${p.config.hotkey ?? ""} ${p.id} palette` })),
    ...e.palettes.flatMap((p) => p.settings.map((s) => ({ page: "palettes" as const, label: s.label, hint: `${e.title} › ${p.title}`, anchor: `palettes:${p.id}:${s.id}`, keywords: s.description }))),
  ]);

const tiers: { id: PaletteTier; title: string }[] = [
  { id: "primary", title: "Primary: reached by name" },
  { id: "normal", title: "Normal: browsed" },
  { id: "catalog", title: "Catalog: a big static list" },
];

const kinds: Record<string, string> = { list: "List, cached", live: "Live, relisted on every show", input: "Input, answers as you type", view: "View" };

const count = (n: number) => (n === 1 ? "1 palette" : `${n} palettes`);

/**
 * Every palette of every extension as one table: an extension with several
 * palettes is a group under its icon and tagline, each row "Extension ›
 * Palette"; one with a single palette is one row with the tagline under
 * the name. Inline, what pal gives every palette (enabled,
 * alias, hotkey, icon); the
 * filter over it narrows the rows live. The selected palette's pane on the
 * right: what it is, its kind, its keys, where it ranks at the root, its
 * item hotkeys and the settings it declared. Arrows move the selection;
 * Tab walks the row's controls.
 */
export function SettingsPalettes({ extensions, selected, onSelect, onChange, onOpenExtension, items }: SettingsPalettesProps) {
  const [filter, setFilter] = useState("");
  const table = useRef<HTMLDivElement>(null);
  const q = filter.trim().toLowerCase();
  const groups = useMemo(() => extensions.map((e) => ({ ext: e, palettes: q ? e.palettes.filter((p) => `${e.title} ${p.title} ${p.config.alias ?? ""} ${p.description ?? ""}`.toLowerCase().includes(q)) : e.palettes })).filter((g) => g.palettes.length), [extensions, q]);
  const all = extensions.flatMap((e) => e.palettes.map((p) => ({ p, ext: e })));
  const current = all.find((x) => x.p.id === selected) ?? all[0];
  const visible = groups.flatMap((g) => g.palettes.map((p) => p.id));
  const set = (p: SettingsPalette, patch: Partial<PaletteConfig>) => onChange(p.id, { ...p.config, ...patch });
  const setSetting = (p: SettingsPalette, id: string, v: SettingValue) => set(p, { settings: { ...p.config.settings, [id]: v } });

  const onTableKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!dir || !visible.length) return;
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "SELECT") return;
    e.preventDefault();
    const i = visible.indexOf(current?.p.id ?? "");
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + dir))];
    onSelect(next);
    table.current?.querySelector<HTMLElement>(`[data-palette-row="${CSS.escape(next)}"]`)?.focus();
  };

  if (!extensions.length) return <Empty title="No extensions" hint="Install one on the Extensions page; its palettes list here." />;

  return (
    <div className="pal-split pal-palettes">
      <div className="pal-palettes__left">
        <div className="pal-palettes__filter">
          <input className="pal-field__input" type="search" placeholder="Filter palettes" aria-label="Filter palettes" value={filter} spellCheck={false} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && filter) { e.stopPropagation(); setFilter(""); } }} />
          <span className="pal-palettes__count">{visible.length} of {all.length}</span>
        </div>
        <div className="pal-ptable__cols" role="presentation" aria-hidden>
          <span>Palette</span><span>On</span><span>Alias</span><span>Hotkey</span><span>Icon</span>
        </div>
        <div className="pal-palettes__scroll" ref={table} onKeyDown={onTableKey}>
          {groups.length === 0 && <p className="pal-settings__none">No palette matches "{filter}".</p>}
          {groups.map(({ ext, palettes }) => {
            // One palette: the row stands for the extension too (tagline under the name), no header.
            const solo = ext.palettes.length === 1;
            return (
            <section key={ext.name} className="pal-ptable" data-solo={solo || undefined} aria-label={ext.title} data-anchor={`palettes:ext:${ext.name}`}>
              {!solo && (
                <header className="pal-ptable__head">
                  <Icon icon={ext.icon} />
                  <span className="pal-ptable__ext">
                    <span className="pal-ptable__ext-title">{ext.title}{ext.loaded === false && <Tag text="failed" color="red" />}</span>
                    <span className="pal-ptable__ext-sub">{ext.tagline ?? ext.description}</span>
                  </span>
                  <span className="pal-ptable__ext-count">{count(ext.palettes.length)}</span>
                </header>
              )}
              {palettes.map((p) => {
                const active = p.id === current?.p.id;
                return (
                  <div
                    key={p.id}
                    role="row"
                    tabIndex={active ? 0 : -1}
                    aria-selected={active}
                    data-palette-row={p.id}
                    data-anchor={`palettes:${p.id}`}
                    data-active={active || undefined}
                    data-disabled={!p.config.enabled || undefined}
                    className="pal-ptable__row"
                    onClick={() => onSelect(p.id)}
                    onFocus={(e) => { if (e.target === e.currentTarget) onSelect(p.id); }}
                  >
                    <span className="pal-ptable__cell pal-ptable__cell--name">
                      <Icon icon={paletteIcon(p, ext)} />
                      <span className="pal-ptable__text">
                        <span className="pal-ptable__name">{p.title !== ext.title && <span className="pal-ptable__name-ext">{ext.title} › </span>}{p.title}{solo && ext.loaded === false && <Tag text="failed" color="red" />}</span>
                        {solo && <span className="pal-ptable__sub">{ext.tagline ?? ext.description}</span>}
                      </span>
                    </span>
                    <span className="pal-ptable__cell">
                      <SettingsSwitch checked={p.config.enabled} onChange={(v) => set(p, { enabled: v })} label={`${p.title} enabled`} />
                    </span>
                    <span className="pal-ptable__cell pal-ptable__cell--alias">
                      <input
                        className="pal-inline"
                        type="text"
                        value={p.config.alias ?? ""}
                        placeholder="alias"
                        aria-label={`${p.title} alias`}
                        spellCheck={false}
                        size={5}
                        onChange={(e) => set(p, { alias: e.target.value || undefined })}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
                      />
                    </span>
                    <span className="pal-ptable__cell">
                      <SettingsHotkey compact value={p.config.hotkey} onChange={(v) => set(p, { hotkey: v })} label={`${p.title} hotkey`} />
                    </span>
                    <span className="pal-ptable__cell">
                      <IconPick p={p} ext={ext} onChange={(icon) => set(p, { icon })} />
                    </span>
                  </div>
                );
              })}
            </section>
            );
          })}
        </div>
      </div>

      <aside className="pal-palettes__pane" aria-label="Selected palette">
        {current ? <PalettePane key={current.p.id} p={current.p} ext={current.ext} onChange={(patch) => set(current.p, patch)} onSetting={(id, v) => setSetting(current.p, id, v)} onOpenExtension={onOpenExtension} items={items} /> : <Empty title="No palette selected" />}
      </aside>
    </div>
  );
}

function PalettePane({ p, ext, onChange, onSetting, onOpenExtension, items }: { p: SettingsPalette; ext: SettingsExtension; onChange: (patch: Partial<PaletteConfig>) => void; onSetting: (id: string, v: SettingValue) => void; onOpenExtension?: (name: string) => void; items?: SettingsPalettesProps["items"] }) {
  const tier = p.config.tier ?? p.tier ?? "normal";
  return (
    <div className="pal-ppane">
      <header className="pal-ppane__head">
        <Icon icon={paletteIcon(p, ext)} size="lg" />
        <div className="pal-ppane__titles">
          <span className="pal-ppane__crumb">{onOpenExtension ? <button type="button" className="pal-link" onClick={() => onOpenExtension(ext.name)}>{ext.title}</button> : ext.title} ›</span>
          <h3 className="pal-ppane__title">{p.title}</h3>
        </div>
      </header>
      {p.description && <p className="pal-ppane__desc">{p.description}</p>}
      {!p.config.enabled && <p className="pal-ppane__note">Off: no rows at the root and no row for the palette itself. Its hotkey and alias stay written down.</p>}

      <dl className="pal-ppane__meta">
        <div className="pal-ppane__meta-row"><dt>Id</dt><dd><code>{p.id}</code></dd></div>
        {p.kind && <div className="pal-ppane__meta-row"><dt>Kind</dt><dd>{kinds[p.kind] ?? p.kind}</dd></div>}
        <div className="pal-ppane__meta-row" data-anchor={`palettes:${p.id}:tier`}>
          <dt><label htmlFor={`tier-${p.id}`}>At the root</label></dt>
          <dd>
            <SettingsSelect id={`tier-${p.id}`} value={tier} options={tiers} onChange={(v) => onChange({ tier: v === (p.tier ?? "normal") ? undefined : (v as PaletteTier) })} />
            <span className="pal-ppane__hint">{p.config.tier ? `Overrides the extension's ${p.tier ?? "normal"}.` : "As the extension says. Primary rows beat catalog rows on the same match."}</span>
          </dd>
        </div>
      </dl>

      {p.keys && p.keys.length > 0 && (
        <section className="pal-ppane__section" aria-label="Keys">
          <h4 className="pal-ppane__h">Keys</h4>
          <ul className="pal-ppane__keys">
            {p.keys.map((k) => <li key={k.keys}><Kbd shortcut={k.keys} /><span>{k.title}</span></li>)}
          </ul>
        </section>
      )}

      {p.kind !== "view" && <ItemHotkeys p={p} onChange={(itemHotkeys) => onChange({ itemHotkeys })} items={items} />}

      <section className="pal-ppane__section" aria-label="Settings">
        <h4 className="pal-ppane__h">Settings <span className="pal-ppane__h-note">palettes.{p.id}.settings</span></h4>
        {p.settings.length === 0 ? (
          <p className="pal-ppane__none">{ext.title} declares none for this palette.{ext.settings.length > 0 && onOpenExtension ? <> Its own are on <button type="button" className="pal-link" onClick={() => onOpenExtension(ext.name)}>Extensions</button>.</> : null}</p>
        ) : (
          <div className="pal-ppane__fields">
            {p.settings.map((s) => (
              <div key={s.id} data-anchor={`palettes:${p.id}:${s.id}`}>
                <SettingsField spec={s} value={p.config.settings[s.id] ?? s.default} onChange={(v) => onSetting(s.id, v)} layout="stack" />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * `palettes.<id>.item_hotkeys` as a table: one row per item, its id (typed,
 * or picked from the palette's indexed rows through the datalist, which
 * filters as you type and shows each row's name), the recorder, Remove.
 * "Add hotkey" opens an unsaved row that is written once it has both an
 * id and a combination; a saved row whose id is retyped moves the
 * combination to the new id. An id the palette does not list now is kept
 * and marked (a row that comes and goes, or a typo).
 */
function ItemHotkeys({ p, onChange, items }: { p: SettingsPalette; onChange: (itemHotkeys: Record<string, string> | undefined) => void; items?: SettingsPalettesProps["items"] }) {
  const saved = p.config.itemHotkeys ?? {};
  const rows = Object.entries(saved);
  const [draft, setDraft] = useState<{ id: string; hotkey?: string } | undefined>(undefined);
  const [known, setKnown] = useState<PaletteItem[] | undefined>(undefined);
  const listId = `item-hotkeys-${p.id}`;
  useEffect(() => {
    if (!items) return;
    let live = true;
    items(p).then((r) => { if (live) setKnown(r); }, () => { if (live) setKnown([]); });
    return () => { live = false; };
  }, [items, p]);
  const nameOf = (id: string) => known?.find((k) => k.id === id)?.name;
  const write = (next: Record<string, string>) => onChange(Object.keys(next).length ? next : undefined);
  const rename = (from: string, to: string) => {
    const id = to.trim();
    if (id === from) return;
    const next: Record<string, string> = {};
    for (const [k, v] of rows) next[k === from ? id : k] = v;
    if (!id) delete next[""];
    write(next);
  };
  const record = (id: string, hotkey: string | undefined) => {
    const next = { ...saved };
    if (hotkey) next[id] = hotkey;
    else delete next[id];
    write(next);
  };
  const remove = (id: string) => { const next = { ...saved }; delete next[id]; write(next); };
  const commitDraft = (d: { id: string; hotkey?: string }) => {
    const id = d.id.trim();
    if (id && d.hotkey) { write({ ...saved, [id]: d.hotkey }); setDraft(undefined); } else setDraft(d);
  };
  const idField = (value: string, label: string, onCommit: (v: string) => void, autoFocus = false) => (
    <input
      className="pal-inline pal-itemkeys__id"
      type="text"
      list={known?.length ? listId : undefined}
      defaultValue={value}
      key={value}
      placeholder="item id"
      aria-label={label}
      spellCheck={false}
      autoFocus={autoFocus}
      onBlur={(e) => onCommit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { e.currentTarget.value = value; e.currentTarget.blur(); } }}
    />
  );
  return (
    <section className="pal-ppane__section" aria-label="Item hotkeys" data-anchor={`palettes:${p.id}:item_hotkeys`}>
      <h4 className="pal-ppane__h">Item hotkeys <span className="pal-ppane__h-note">palettes.{p.id}.item_hotkeys</span></h4>
      {known && known.length > 0 && (
        <datalist id={listId}>
          {known.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
        </datalist>
      )}
      {rows.length === 0 && !draft && <p className="pal-ppane__none">None. A hotkey here runs one row of {p.title} from any app, without the panel.</p>}
      {(rows.length > 0 || draft) && (
        <ul className="pal-itemkeys" aria-label={`Item hotkeys of ${p.title}`}>
          {rows.map(([id, hotkey]) => {
            const name = nameOf(id);
            return (
              <li key={id} className="pal-itemkeys__row" data-unknown={known && !name ? "" : undefined}>
                <span className="pal-itemkeys__item">
                  {idField(id, `Item id for ${hotkey}`, (v) => rename(id, v))}
                  <span className="pal-itemkeys__name" title={known && !name ? "Not among the palette's rows right now" : undefined}>{name ?? (known ? "not listed now" : "")}</span>
                </span>
                <SettingsHotkey compact value={hotkey} onChange={(v) => record(id, v)} label={`Hotkey for ${id}`} />
                <button type="button" className="pal-button" data-small aria-label={`Remove hotkey for ${id}`} onClick={() => remove(id)}>Remove</button>
              </li>
            );
          })}
          {draft && (
            <li className="pal-itemkeys__row" data-draft="">
              <span className="pal-itemkeys__item">
                {idField(draft.id, "New item id", (v) => commitDraft({ ...draft, id: v }), true)}
                <span className="pal-itemkeys__name">{nameOf(draft.id.trim()) ?? ""}</span>
              </span>
              <SettingsHotkey compact value={draft.hotkey} onChange={(v) => commitDraft({ ...draft, hotkey: v })} label="Hotkey for the new item" />
              <button type="button" className="pal-button" data-small aria-label="Cancel the new item hotkey" onClick={() => setDraft(undefined)}>Cancel</button>
            </li>
          )}
        </ul>
      )}
      {!draft && <div className="pal-button-row"><button type="button" className="pal-button" data-small onClick={() => setDraft({ id: "" })}>Add hotkey</button></div>}
      <p className="pal-ppane__hint pal-itemkeys__hint">The row's primary action runs as if picked. A root hotkey wins over a palette's, a palette's over an item's.</p>
    </section>
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
