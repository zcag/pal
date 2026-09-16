import { useRef, type KeyboardEvent } from "react";
import { Empty } from "./Empty";
import { Icon } from "./Icon";
import { SettingsGroup, SettingsHotkey, SettingsRow, SettingsSelect, SettingsSwitch } from "./SettingsField";
import type { BarConfig, BarItem, BarItemConfig, BarTarget, SettingsIndexEntry } from "./SettingsTypes";
import { relativeDate } from "./format";

export type SettingsBarProps = {
  config: BarConfig;
  onChange: (config: BarConfig) => void;
  items: BarItem[];
  onItem: (key: string, config: BarItemConfig) => void;
  /** sketchybar answered its last probe. */
  sketchybar: boolean;
  /** The Extensions page for an item's extension. */
  onOpenExtension?: (name: string) => void;
};

const targets: { id: BarTarget; title: string; explain: (sketchybar: boolean) => string }[] = [
  { id: "auto", title: "Automatic", explain: (s) => (s ? "sketchybar is running, so items go there." : "sketchybar is not running, so items go to the menu bar.") },
  { id: "menubar", title: "Menu bar", explain: () => "The macOS menu bar, whatever else runs." },
  { id: "sketchybar", title: "sketchybar", explain: (s) => (s ? "sketchybar only; it is running." : "sketchybar only; it is not running now, so nothing shows until it does.") },
  { id: "both", title: "Both", explain: () => "The menu bar and sketchybar, the same items on each." },
  { id: "off", title: "Off", explain: () => "No item anywhere; the timers stop too." },
];
const targetOptions = targets.map((t) => ({ id: t.id, title: t.title }));
const itemTargets = [{ id: "", title: "Default" }, ...targetOptions];
const hovers = [{ id: "", title: "Default" }, { id: "on", title: "On" }, { id: "off", title: "Off" }];

export const barIndex = (items: BarItem[]): SettingsIndexEntry[] => [
  { page: "bar", label: "Where bar items are drawn", hint: "Bar", anchor: "bar:target", keywords: "target menu bar sketchybar auto off" },
  { page: "bar", label: "Hover delay", hint: "Bar", anchor: "bar:hover", keywords: "peek grace popover" },
  { page: "bar", label: "Open on hover", hint: "Bar", anchor: "bar:hover-targets", keywords: "peek menu bar sketchybar" },
  ...items.map((b) => ({ page: "bar" as const, label: `${b.extTitle} › ${b.title}`, hint: b.description ?? "Bar item", anchor: `bar:${b.key}`, keywords: `${b.key} bar item` })),
];

const every = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

/** One line under the item's name: how it refreshes and how it is doing. */
function itemState(b: BarItem): { text: string; level?: "warning" | "error" } {
  if (!b.source) return { text: "Declared, but the code has no render for it; never drawn.", level: "error" };
  if (!b.config.enabled) return { text: "Off: no slot on any target, no timer." };
  const parts: string[] = [];
  if (b.state?.hidden) parts.push("hidden by the extension");
  else if (b.state?.badge !== undefined) parts.push(`badge ${b.state.badge}`);
  else if (b.state?.dot) parts.push("dot");
  if (b.state?.title) parts.push(`shows "${b.state.title}"`);
  parts.push(b.refreshEvery ? `every ${every(b.refreshEvery)}` : "no poll");
  if (b.renderedAt) parts.push(`rendered ${relativeDate(b.renderedAt * 1000)} ago`);
  else parts.push("not rendered yet");
  if (b.stale) return { text: `Stale: the last render failed. ${parts.join(", ")}.`, level: "warning" };
  return { text: parts.join(", ") + "." };
}

/**
 * Where bar items go and how a peek behaves, then every declared item as a
 * row: on/off, its own target and position, a hotkey that opens its
 * popover, whether a hover peeks it, its order, and under the name what the
 * strip shows now. Arrows move between rows.
 */
export function SettingsBar({ config, onChange, items, onItem, sketchybar, onOpenExtension }: SettingsBarProps) {
  const set = <K extends keyof BarConfig>(k: K, v: BarConfig[K]) => onChange({ ...config, [k]: v });
  const target = targets.find((t) => t.id === config.target) ?? targets[0];
  // The probe runs only while a target wants sketchybar (sketchybar.rs `probe`), so the dot means nothing under `menubar` or `off`.
  const probed = config.target === "auto" || config.target === "sketchybar" || config.target === "both";
  const table = useRef<HTMLDivElement>(null);
  const onTableKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "SELECT") return;
    const rows = [...(table.current?.querySelectorAll<HTMLElement>("[data-bar-row]") ?? [])];
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + dir))];
    if (next) { e.preventDefault(); next.focus(); }
  };
  const num = (v: string, d: number) => { const n = Number(v); return Number.isFinite(n) && v !== "" ? Math.max(0, Math.round(n)) : d; };

  return (
    <div className="pal-settings-page pal-bar">
      <SettingsGroup title="Where items are drawn">
        <div data-anchor="bar:target">
          <SettingsRow label="Target" description={<>{probed && <span className="pal-bar__detect" data-alive={sketchybar || undefined}><span className="pal-bar__dot" aria-hidden />sketchybar {sketchybar ? "is running" : "is not running"}</span>} {target.explain(sketchybar)} An item can pick its own target below.</>} htmlFor="pal-bar-target">
            <SettingsSelect id="pal-bar-target" value={config.target} options={targetOptions} onChange={(v) => set("target", v as BarTarget)} />
          </SettingsRow>
        </div>
        <div data-anchor="bar:hover">
          <SettingsRow label="Peeks" description="A peek is the popover opened by resting the pointer on an item. Off on the menu bar by default (Apple's bar has no hover convention), on for sketchybar; an item can say otherwise below. Delay before it opens, grace after the pointer has left both before it closes.">
            <span className="pal-bar__peeks">
              <span className="pal-bar__hovers" data-anchor="bar:hover-targets">
                <label className="pal-bar__hover"><SettingsSwitch checked={config.menubarHover} onChange={(v) => set("menubarHover", v)} label="Menu bar opens on hover" /><span>Menu bar</span></label>
                <label className="pal-bar__hover"><SettingsSwitch checked={config.sketchybarHover} onChange={(v) => set("sketchybarHover", v)} label="sketchybar opens on hover" /><span>sketchybar</span></label>
              </span>
              <span className="pal-bar__hovers">
                <label className="pal-number"><input className="pal-field__input" type="number" min={0} step={50} aria-label="Hover delay" value={config.hoverDelay} onChange={(e) => set("hoverDelay", num(e.target.value, 250))} /><span className="pal-number__unit">ms delay</span></label>
                <label className="pal-number"><input className="pal-field__input" type="number" min={0} step={50} aria-label="Hover grace" value={config.hoverGrace} onChange={(e) => set("hoverGrace", num(e.target.value, 400))} /><span className="pal-number__unit">ms grace</span></label>
              </span>
            </span>
          </SettingsRow>
        </div>
        <SettingsRow label="sketchybar position" description="Where pal's items sit by default: left, right, center, q, e, before:<item> or after:<item>." htmlFor="pal-bar-position">
          <input id="pal-bar-position" className="pal-field__input pal-bar__position" type="text" value={config.sketchybarPosition} spellCheck={false} onChange={(e) => set("sketchybarPosition", e.target.value)} onBlur={(e) => { if (!e.target.value.trim()) set("sketchybarPosition", "right"); }} />
        </SettingsRow>
      </SettingsGroup>

      <section className="pal-settings-group" aria-label="Items">
        <h3 className="pal-settings-group__title">Items<span className="pal-settings-group__note">{items.length ? `${items.length} declared` : ""}</span></h3>
        {items.length === 0 ? (
          <div className="pal-settings-group__rows"><Empty title="No bar items" hint="An extension declares them in its pal.json under bar; GitHub's unread count is one. None of the installed extensions does." /></div>
        ) : (
          <div className="pal-btable" role="grid" aria-label="Bar items" ref={table} onKeyDown={onTableKey}>
            <div className="pal-btable__head" role="row">
              <span role="columnheader" className="pal-btable__col pal-btable__col--name">Item</span>
              <span role="columnheader" className="pal-btable__col">On</span>
              <span role="columnheader" className="pal-btable__col">Target</span>
              <span role="columnheader" className="pal-btable__col">Position</span>
              <span role="columnheader" className="pal-btable__col">Hotkey</span>
              <span role="columnheader" className="pal-btable__col">Hover</span>
              <span role="columnheader" className="pal-btable__col">Order</span>
            </div>
            {items.map((b, i) => {
              const c = b.config;
              const put = (patch: Partial<BarItemConfig>) => onItem(b.key, { ...c, ...patch });
              const st = itemState(b);
              return (
                <div key={b.key} role="row" tabIndex={i === 0 ? 0 : -1} data-bar-row={b.key} data-anchor={`bar:${b.key}`} data-disabled={!c.enabled || !b.source || undefined} data-stale={b.stale || undefined} className="pal-btable__row">
                  <span role="gridcell" className="pal-btable__cell pal-btable__cell--name">
                    <Icon icon={b.extIcon} />
                    <span className="pal-btable__text">
                      <span className="pal-btable__name">{b.title !== b.extTitle && <span className="pal-btable__name-ext">{onOpenExtension ? <button type="button" className="pal-link" onClick={() => onOpenExtension(b.extension)}>{b.extTitle}</button> : b.extTitle} › </span>}{b.title}</span>
                      <span className="pal-btable__state" data-level={st.level}>{st.text}</span>
                    </span>
                  </span>
                  <span role="gridcell" className="pal-btable__cell"><SettingsSwitch checked={c.enabled} disabled={!b.source} onChange={(v) => put({ enabled: v })} label={`${b.title} enabled`} /></span>
                  <span role="gridcell" className="pal-btable__cell"><SettingsSelect label={`${b.title} target`} value={c.target ?? ""} options={itemTargets} onChange={(v) => put({ target: (v || undefined) as BarTarget | undefined })} /></span>
                  <span role="gridcell" className="pal-btable__cell"><input className="pal-inline" type="text" size={5} placeholder={config.sketchybarPosition} aria-label={`${b.title} position`} value={c.position ?? ""} spellCheck={false} onChange={(e) => put({ position: e.target.value || undefined })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }} /></span>
                  <span role="gridcell" className="pal-btable__cell"><SettingsHotkey compact value={c.hotkey} onChange={(v) => put({ hotkey: v })} label={`${b.title} hotkey`} /></span>
                  <span role="gridcell" className="pal-btable__cell"><SettingsSelect label={`${b.title} opens on hover`} value={c.openOnHover === undefined ? "" : c.openOnHover ? "on" : "off"} options={hovers} onChange={(v) => put({ openOnHover: v === "" ? undefined : v === "on" })} /></span>
                  <span role="gridcell" className="pal-btable__cell"><input className="pal-inline pal-inline--num" type="number" aria-label={`${b.title} order`} placeholder="0" value={c.order ?? ""} onChange={(e) => put({ order: e.target.value === "" ? undefined : Number(e.target.value) })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }} /></span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
