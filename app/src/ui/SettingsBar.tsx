import { useState, type CSSProperties, type ReactNode } from "react";
import { BarStrip, type BarLook, type BarStripItem, type BarStripTarget } from "./BarStrip";
import { Empty } from "./Empty";
import { Icon } from "./Icon";
import { SettingsDisclosure, SettingsField, SettingsHotkey, SettingsSegment, SettingsSelect, SettingsSwitch } from "./SettingsField";
import { SettingsList, type SettingsListItem } from "./SettingsList";
import { Tag } from "./Row";
import { lookDefaults, resolveLook, type BarConfig, type BarItem, type BarItemConfig, type BarItemState, type BarLookConfig, type BarLookOverride, type BarShow, type BarTarget, type SettingsIndexEntry } from "./SettingsTypes";
import { relativeDate } from "./format";

export type SettingsBarProps = {
  config: BarConfig;
  onChange: (config: BarConfig) => void;
  items: BarItem[];
  onItem: (key: string, config: BarItemConfig) => void;
  /** sketchybar answered its last probe. */
  sketchybar: boolean;
  /** This platform draws bar items (macOS); off it the page only says so. */
  supported?: boolean;
  /** The selected item's key; the first item when absent. */
  selected?: string;
  onSelect?: (key: string) => void;
  /** The Extensions page for an item's extension. */
  onOpenExtension?: (name: string) => void;
  /** One of the extension's own settings changed from an item's pane (`BarItem.settings`): written to the extension's table, as the Extensions page does. */
  onSetting?: (extension: string, id: string, value: unknown) => void;
};

type Target = "menubar" | "sketchybar";
type Group = "placement" | "text" | "colour" | "behaviour";

/** The list row that selects the defaults rather than an item; never an item key, which is always `ext/item`. */
export const BAR_DEFAULTS = "__defaults__";

/**
 * The config key worth printing next to a label. For most fields the key is
 * the label lowercased ("Spacing" / `spacing`), and printing both reads as a
 * stutter; the section header already names the table it lives in. Only a key
 * you could not have guessed earns the space.
 */
const keyChip = (label: string, key: string): string | undefined => (key === label.toLowerCase().replace(/ /g, "_") ? undefined : key);

const targets: { id: BarTarget; title: string; explain: (sketchybar: boolean) => string }[] = [
  { id: "auto", title: "Automatic", explain: (s) => (s ? "sketchybar is running, so items go there." : "sketchybar is not running, so items go to the menu bar.") },
  { id: "menubar", title: "Menu bar", explain: () => "The macOS menu bar, whatever else runs." },
  { id: "sketchybar", title: "sketchybar", explain: (s) => (s ? "sketchybar only; it is running." : "sketchybar only; it is not running now, so nothing shows until it does.") },
  { id: "both", title: "Both", explain: () => "The menu bar and sketchybar, the same items on each." },
  { id: "off", title: "Off", explain: () => "No item anywhere; the timers stop too." },
];
const targetOptions = targets.map((t) => ({ id: t.id, title: t.title }));
const itemTargets = [{ id: "", title: "Default" }, ...targetOptions];
const targetTitle: Record<Target, string> = { menubar: "menu bar", sketchybar: "sketchybar" };
const groups: { id: Group; title: string }[] = [{ id: "placement", title: "Placement" }, { id: "text", title: "Text" }, { id: "colour", title: "Colour" }, { id: "behaviour", title: "Behaviour" }];
const colorNames = ["grey", "blue", "green", "amber", "red", "violet", "pink", "teal", "accent", "text", "muted"];

/** One appearance key: where it sits, what it does, how it is edited, and what each target makes of it. */
type LookField = {
  id: keyof BarLookConfig;
  key: string;
  label: string;
  group: Group;
  description: string;
  control: { kind: "number"; unit: string; min: number; max?: number; step?: number; zero?: string } | { kind: "select"; options: { id: string; title: string }[] } | { kind: "switch" } | { kind: "color"; placeholder: string } | { kind: "text"; placeholder: string };
  /** What the target does with it, when it differs from the description. */
  targets?: Partial<Record<Target, string>>;
  /** Only an item's pane shows it: a target-wide value makes no sense (`icon`). */
  itemOnly?: boolean;
};

export const lookFields: LookField[] = [
  { id: "spacing", key: "spacing", label: "Spacing", group: "placement", description: "Points between the icon, the title and the segments.", control: { kind: "number", unit: "pt", min: 0, max: 32 }, targets: { menubar: "On the menu bar only a prerendered strip (a mono font, a size or a width) takes it; Apple sets the gap otherwise." } },
  { id: "width", key: "width", label: "Width", group: "placement", description: "A fixed width in points, so a ticking timer does not move its neighbours; text past it is cut.", control: { kind: "number", unit: "pt", min: 0, max: 600, zero: "natural" } },
  { id: "font", key: "font", label: "Font", group: "text", description: "The text's face: the bar's own, or a monospace for codes and times.", control: { kind: "select", options: [{ id: "system", title: "System" }, { id: "mono", title: "Mono" }] }, targets: { menubar: "Mono prerenders the text into the icon image in SF Mono.", sketchybar: "Mono is Menlo." } },
  { id: "size", key: "size", label: "Size", group: "text", description: "Point size of the glyph and the text.", control: { kind: "number", unit: "pt", min: 0, max: 24, step: 0.5, zero: "the bar's own" }, targets: { menubar: "The bar's own is 13 pt text and a 14 pt glyph; a size prerenders the text into the icon image.", sketchybar: "The bar's own is its icon and label font size." } },
  { id: "iconSize", key: "icon_size", label: "Icon size", group: "text", description: "Point size of the glyph alone; 0 follows Size.", control: { kind: "number", unit: "pt", min: 0, max: 24, step: 0.5, zero: "follows size" } },
  { id: "textSize", key: "text_size", label: "Text size", group: "text", description: "Point size of the title and the segments alone; 0 follows Size.", control: { kind: "number", unit: "pt", min: 0, max: 24, step: 0.5, zero: "follows size" } },
  { id: "maxChars", key: "max_chars", label: "Longest title", group: "text", description: "Characters a title may run to; longer text ends in an ellipsis. Apple's bar hides whatever runs under the notch or off the left edge.", control: { kind: "number", unit: "chars", min: 4, max: 200 } },
  { id: "showIcon", key: "show_icon", label: "Icon", group: "text", description: "Draw the icon.", control: { kind: "switch" } },
  { id: "icon", key: "icon", label: "Custom icon", group: "text", description: "A glyph, an emoji or a short text drawn as the icon in place of the extension's own. Empty keeps the extension's.", control: { kind: "text", placeholder: "extension's" }, itemOnly: true },
  { id: "showTitle", key: "show_title", label: "Title", group: "text", description: "Draw the title and the segments; off is a glyph-only item.", control: { kind: "switch" } },
  { id: "color", key: "color", label: "Tint", group: "colour", description: "A colour name or #rrggbb drawn in place of the colour the extension answers. Empty keeps the extension's: a coloured item its own, the rest the bar's text colour.", control: { kind: "color", placeholder: "extension's" }, targets: { menubar: "The glyph's ink; the title text keeps the bar's colour unless prerendered." } },
  { id: "urgentColor", key: "urgent_color", label: "Urgent", group: "colour", description: "The colour of an urgent item (a landed timer, an alarm).", control: { kind: "color", placeholder: "destructive" } },
  { id: "badgeColor", key: "badge_color", label: "Badge colour", group: "colour", description: "The colour of a count badge and a dot. Empty draws them in the item's own colour (the tint; the urgent colour while urgent), so a mail count is not red by default.", control: { kind: "color", placeholder: "the item's" }, targets: { menubar: "A colour prerenders the text into the icon image, so the count can wear it." } },
  { id: "opacity", key: "opacity", label: "Opacity", group: "colour", description: "The item's strength: every colour it draws (icon, text, segments, badge) at this alpha. A muted item is at Dim of this.", control: { kind: "number", unit: "%", min: 0, max: 100, step: 5 }, targets: { menubar: "Under 100 prerenders the text into the icon image, so it fades with the glyph." } },
  { id: "dim", key: "dim", label: "Dim", group: "colour", description: "A muted item's strength: a stale item, or one the extension colours muted (a paused timer), draws at this opacity.", control: { kind: "number", unit: "%", min: 0, max: 100, step: 5 } },
  { id: "badgeStyle", key: "badge_style", label: "Badge", group: "behaviour", description: "How a count badge is drawn: the number, a dot whatever the number, or nothing (the count stays in the tooltip).", control: { kind: "select", options: [{ id: "count", title: "Count" }, { id: "dot", title: "Dot" }, { id: "none", title: "None" }] } },
];

export const barIndex = (items: BarItem[], supported = true): SettingsIndexEntry[] => (supported ? [
  { page: "bar", label: "Where bar items are drawn", hint: "Bar › Defaults", anchor: "bar:target", keywords: "target menu bar sketchybar auto off" },
  { page: "bar", label: "Hover delay", hint: "Bar › Defaults", anchor: "bar:hover", keywords: "peek grace popover" },
  { page: "bar", label: "Open on hover", hint: "Bar › Defaults", anchor: "bar:hover-targets", keywords: "peek menu bar sketchybar" },
  { page: "bar", label: "sketchybar position", hint: "Bar › Defaults", anchor: "bar:position", keywords: "left right center before after" },
  ...(["menubar", "sketchybar"] as Target[]).flatMap((t) => lookFields.filter((f) => !f.itemOnly).map((f) => ({ page: "bar" as const, label: `${f.label} (${targetTitle[t]})`, hint: `Bar › Defaults › ${groups.find((g) => g.id === f.group)?.title}`, anchor: `bar:${t}:${f.key}`, keywords: `${f.key} ${f.description} appearance ${t}` }))),
  ...items.flatMap((b) => [
    { page: "bar" as const, label: `${b.extTitle} › ${b.title}`, hint: b.description ?? "Bar item", anchor: `bar:${b.key}`, keywords: `${b.key} bar item` },
    ...["show", "target", "position", "order", "hotkey", "open_on_hover"].map((k) => ({ page: "bar" as const, label: `${b.title}: ${k.replace(/_/g, " ")}`, hint: `Bar › ${b.extTitle} › ${b.title}`, anchor: `bar:${b.key}:${k}`, keywords: `${b.key} ${k}` })),
    ...lookFields.map((f) => ({ page: "bar" as const, label: `${b.title}: ${f.label}`, hint: `Bar › ${b.extTitle} › ${b.title}`, anchor: `bar:${b.key}:${f.key}`, keywords: `${b.key} ${f.key} ${f.description}` })),
  ]),
] : []);

const every = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)} h` : s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

/**
 * A state as the strip draws it under `show` (bar/mod.rs `BarItem::kept`):
 * hidden with an `empty` shape under `always` is that shape, muted, no
 * badge; anything else is itself.
 */
export function kept(s: BarItemState, show: BarShow | undefined): BarItemState {
  if (!s.hidden || show !== "always" || !s.empty) return s;
  return { hidden: false, urgent: false, icon: s.empty.icon, title: s.empty.title, tooltip: s.empty.tooltip, color: "muted" };
}

/** One line under the item's name: how it refreshes and how it is doing. */
export function itemState(b: BarItem): { text: string; level?: "warning" | "error" } {
  if (!b.source) return { text: "Declared, but the code has no render for it; never drawn.", level: "error" };
  if (!b.config.enabled) return { text: "Off: no slot on any target, no timer." };
  const parts: string[] = [];
  const s = b.state && kept(b.state, b.config.show);
  if (b.state?.hidden && !s?.hidden) parts.push("nothing to say, kept on the strip muted");
  else if (s?.hidden) parts.push("hidden by the extension");
  else if (s?.badge !== undefined) parts.push(`badge ${s.badge}`);
  else if (s?.dot) parts.push("dot");
  if (s?.title) parts.push(`shows "${s.title}"`);
  parts.push(b.refreshEvery ? `every ${every(b.refreshEvery)}` : "no poll");
  if (b.renderedAt) parts.push(`rendered ${relativeDate(b.renderedAt * 1000)} ago`);
  else parts.push("not rendered yet");
  if (b.stale) return { text: `Stale: the last render failed. ${parts.join(", ")}.`, level: "warning" };
  return { text: parts.join(", ") + "." };
}

/** The target an item's strip lands on: its own, else the global one; `auto` by what is running. */
export function effectiveTarget(b: BarItem, config: BarConfig, sketchybar: boolean): Target | "both" | "off" {
  const t = b.config.target ?? config.target;
  return t === "auto" ? (sketchybar ? "sketchybar" : "menubar") : t;
}

/** The last render as the strip draws it; a placeholder from the manifest while it never has. */
export function previewItem(b: BarItem): BarStripItem {
  return previewState(b.state, b.title, b.stale, b.config.show);
}

/** A live or declared mock state, as the strip draws it under `show`. Mocks are never stale: they are static examples. */
export function previewState(state: BarItem["state"] | undefined, fallback: string, stale = false, show?: BarShow): BarStripItem {
  if (!state) return { icon: "\u{f0a9c}", title: fallback, stale };
  const s = kept(state, show);
  return {
    hidden: s.hidden,
    icon: typeof s.icon === "string" ? s.icon : s.icon ? "\u{f0976}" : undefined,
    title: s.title,
    segments: s.segments,
    badge: s.dot ? "dot" : s.badge,
    color: s.color,
    urgent: s.urgent,
    stale,
    progress: s.progress,
    tooltip: s.tooltip,
  };
}

const num = (v: string, d: number) => { const n = Number(v); return Number.isFinite(n) && v !== "" ? Math.max(0, n) : d; };

/**
 * One appearance field: the label, the control on the resolved value, the
 * description, and (in an item's pane) where the value comes from: "from
 * the menu bar default" while inherited, Reset once overridden.
 */
function LookControl({ field, value, inherited, from, onChange, target, anchor, placeholder }: { field: LookField; value: BarLookConfig[keyof BarLookConfig]; inherited?: boolean; from?: string; onChange: (v: BarLookConfig[keyof BarLookConfig] | undefined) => void; target: Target; anchor: string; placeholder?: string }) {
  const c = field.control;
  const id = `${anchor}-${field.key}`;
  const note = field.targets?.[target];
  let control: ReactNode;
  switch (c.kind) {
    case "text":
      control = <input id={id} className="pal-field__input pal-bar-field__text" type="text" placeholder={placeholder ?? c.placeholder} value={(value as string) ?? ""} spellCheck={false} aria-label={`${field.label} (${targetTitle[target]})`} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "number":
      control = (
        <span className="pal-number">
          <input id={id} className="pal-field__input" type="number" min={c.min} max={c.max} step={c.step ?? 1} value={value as number} aria-label={`${field.label} (${targetTitle[target]})`} onChange={(e) => onChange(Math.min(c.max ?? Infinity, num(e.target.value, 0)))} />
          <span className="pal-number__unit">{c.zero && !(value as number) ? c.zero : c.unit}</span>
        </span>
      );
      break;
    case "select":
      control = <SettingsSelect id={id} value={value as string} options={c.options} onChange={(v) => onChange(v)} />;
      break;
    case "switch":
      control = <SettingsSwitch checked={!!value} label={`${field.label} (${targetTitle[target]})`} onChange={(v) => onChange(v)} />;
      break;
    case "color":
      control = (
        <span className="pal-bar-color">
          <span className="pal-bar-color__swatch" data-color={(value as string) || undefined} style={swatch(value as string | undefined)} aria-hidden />
          <input id={id} className="pal-field__input" type="text" list="pal-bar-colors" placeholder={c.placeholder} value={(value as string) ?? ""} spellCheck={false} aria-label={`${field.label} (${targetTitle[target]})`} onChange={(e) => onChange(e.target.value)} />
        </span>
      );
      break;
  }
  return (
    <div className="pal-setting pal-bar-field" data-layout="stack" data-inherited={inherited || undefined} data-anchor={`${anchor}:${field.key}`}>
      <span className="pal-setting__label">{c.kind === "switch" ? field.label : <label htmlFor={id}>{field.label}</label>}{keyChip(field.label, field.key) && <code className="pal-bar-field__key">{field.key}</code>}</span>
      <div className="pal-setting__body">
        <div className="pal-setting__control">
          {control}
          {from !== undefined && (inherited ? <span className="pal-bar-field__from">from the {from} default</span> : <button type="button" className="pal-setting__reset" onClick={() => onChange(undefined)} title={`Back to the ${from} default`}>Reset</button>)}
        </div>
        <p className="pal-setting__desc">{field.description}{note && <> <span className="pal-bar-field__target">{note}</span></>}</p>
      </div>
    </div>
  );
}

/** The swatch behind a colour spec: a token for a name, the hex itself, nothing for empty. */
function swatch(v: string | undefined): CSSProperties | undefined {
  if (!v) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(v)) return { background: v };
  if (/^0x[0-9a-f]{8}$/i.test(v)) return { background: `#${v.slice(4)}` };
  if (v === "text") return { background: "var(--pal-fg)" };
  if (v === "muted") return { background: "var(--pal-fg-muted)" };
  if (v === "accent" || v === "destructive") return { background: `var(--pal-${v})` };
  if (colorNames.includes(v)) return { background: `var(--pal-tag-${v})` };
  return { background: "transparent", boxShadow: "inset 0 0 0 1px var(--pal-destructive)" };
}

/** The four groups of appearance fields for one target, each field on `look` (with `over` marking what the item set itself; an item-only field shows only then). `placeholders` are an item's own (its extension's icon). */
function LookGroups({ target, look, over, base, onChange, anchor, from, placeholders }: { target: Target; look: BarLookConfig; over?: BarLookOverride; base?: BarLookConfig; onChange: (id: keyof BarLookConfig, v: unknown) => void; anchor: string; from?: string; placeholders?: Partial<Record<keyof BarLookConfig, string>> }) {
  return (
    <div className="pal-bar-groups">
      {groups.map((g) => (
        <fieldset key={g.id} className="pal-bar-group" data-group={g.id}>
          <legend className="pal-bar-group__title">{g.title}</legend>
          {lookFields.filter((f) => f.group === g.id && (over || !f.itemOnly)).map((f) => (
            <LookControl key={f.id} field={f} target={target} anchor={anchor} value={look[f.id]} inherited={over ? over[f.id] === undefined : undefined} from={from} placeholder={placeholders?.[f.id]} onChange={(v) => onChange(f.id, v === undefined ? undefined : base && v === base[f.id] ? undefined : v)} />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

/** The Defaults card: the target, the peeks, sketchybar's position, then each target's appearance under a segmented switch. */
function Defaults({ config, onChange, sketchybar, items }: { config: BarConfig; onChange: (c: BarConfig) => void; sketchybar: boolean; items: BarItem[] }) {
  const set = <K extends keyof BarConfig>(k: K, v: BarConfig[K]) => onChange({ ...config, [k]: v });
  const target = targets.find((t) => t.id === config.target) ?? targets[0];
  // The probe runs only while a target wants sketchybar (sketchybar.rs `probe`), so the dot means nothing under `menubar` or `off`.
  const probed = config.target === "auto" || config.target === "sketchybar" || config.target === "both";
  const [shown, setShown] = useState<Target>(config.target === "sketchybar" || (config.target === "auto" && sketchybar) ? "sketchybar" : "menubar");
  const setLook = (t: Target, id: keyof BarLookConfig, v: unknown) => onChange({ ...config, [t]: { ...config[t], [id]: v === undefined ? lookDefaults[id] : v } });
  return (
    <section className="pal-settings-group pal-bar-defaults" aria-label="Defaults">
      <h3 className="pal-settings-group__title">Defaults<span className="pal-settings-group__note">{items.length ? `${items.length} items inherit these` : "every item, unless it says otherwise"}</span></h3>
      <div className="pal-settings-group__rows">
        <div className="pal-setting pal-bar-defaults__target" data-layout="row" data-anchor="bar:target">
          <label className="pal-setting__label" htmlFor="pal-bar-target">Target</label>
          <div className="pal-setting__body">
            <div className="pal-setting__control">
              <SettingsSelect id="pal-bar-target" value={config.target} options={targetOptions} onChange={(v) => set("target", v as BarTarget)} />
              {probed && <span className="pal-bar__detect" data-alive={sketchybar || undefined}><span className="pal-bar__dot" aria-hidden />sketchybar {sketchybar ? "is running" : "is not running"}</span>}
            </div>
            <p className="pal-setting__desc">{target.explain(sketchybar)} An item can pick its own target in its pane.</p>
          </div>
        </div>
        <div className="pal-setting" data-layout="row" data-anchor="bar:hover">
          <span className="pal-setting__label">Peeks</span>
          <div className="pal-setting__body">
            <div className="pal-setting__control pal-bar__peeks">
              <span className="pal-bar__hovers" data-anchor="bar:hover-targets">
                <label className="pal-bar__hover"><SettingsSwitch checked={config.menubarHover} onChange={(v) => set("menubarHover", v)} label="Menu bar opens on hover" /><span>Menu bar</span></label>
                <label className="pal-bar__hover"><SettingsSwitch checked={config.sketchybarHover} onChange={(v) => set("sketchybarHover", v)} label="sketchybar opens on hover" /><span>sketchybar</span></label>
              </span>
              <span className="pal-bar__hovers">
                <label className="pal-number"><input className="pal-field__input" type="number" min={0} step={50} aria-label="Hover delay" value={config.hoverDelay} onChange={(e) => set("hoverDelay", Math.round(num(e.target.value, 250)))} /><span className="pal-number__unit">ms delay</span></label>
                <label className="pal-number"><input className="pal-field__input" type="number" min={0} step={50} aria-label="Hover grace" value={config.hoverGrace} onChange={(e) => set("hoverGrace", Math.round(num(e.target.value, 400)))} /><span className="pal-number__unit">ms grace</span></label>
              </span>
            </div>
            <p className="pal-setting__desc">A peek is the popover opened by resting the pointer on an item. Off on both targets by default: a click opens and closes a popover (Apple's bar has no hover convention, and a peek on the way across the bar gets in the way); an item can say otherwise. Delay before it opens, grace after the pointer has left both before it closes.</p>
          </div>
        </div>
        <div className="pal-setting" data-layout="row" data-anchor="bar:position">
          <label className="pal-setting__label" htmlFor="pal-bar-position">sketchybar position</label>
          <div className="pal-setting__body">
            <div className="pal-setting__control">
              <input id="pal-bar-position" className="pal-field__input pal-bar__position" type="text" value={config.sketchybarPosition} spellCheck={false} onChange={(e) => set("sketchybarPosition", e.target.value)} onBlur={(e) => { if (!e.target.value.trim()) set("sketchybarPosition", "right"); }} />
            </div>
            <p className="pal-setting__desc">Where pal's items sit by default: left, right, center, q, e, before:&lt;item&gt; or after:&lt;item&gt;.</p>
          </div>
        </div>
        <div className="pal-setting pal-bar-defaults__look" data-layout="row">
          <span className="pal-setting__label">Appearance</span>
          <div className="pal-setting__body">
            <div className="pal-setting__control">
              <SettingsSegment value={shown} options={[{ id: "menubar", title: "Menu bar" }, { id: "sketchybar", title: "sketchybar" }]} onChange={(v) => setShown(v as Target)} label="Appearance defaults of" />
              <span className="pal-bar-defaults__file">bar.{shown}</span>
            </div>
            <p className="pal-setting__desc">How the {targetTitle[shown]} draws every item. The same key means the same thing on both targets where the target can; a note says where one cannot.</p>
          </div>
        </div>
        <div className="pal-bar-defaults__groups">
          <LookGroups target={shown} look={config[shown]} onChange={(id, v) => setLook(shown, id, v)} anchor={`bar:${shown}`} />
        </div>
        {items.length === 0 && <div className="pal-settings-group__rows"><Empty title="No bar items" hint="An extension declares them in its pal.json under bar; GitHub's unread count is one. None of the installed extensions does, so nothing inherits the defaults above." /></div>}
      </div>
    </section>
  );
}

/** The short state a list row wears on its right: only what is wrong or off, so a healthy list is quiet. */
function rowTag(b: BarItem): ReactNode {
  const s = b.state && kept(b.state, b.config.show);
  if (!b.source) return <Tag text="no code" color="red" />;
  if (!b.config.enabled) return <Tag text="off" color="grey" />;
  if (b.stale) return <Tag text="stale" color="amber" />;
  if (s?.urgent) return <Tag text="urgent" color="red" />;
  if (s?.hidden) return <Tag text="hidden" color="grey" />;
  return undefined;
}

const hovers = [{ id: "", title: "Default" }, { id: "on", title: "On" }, { id: "off", title: "Off" }];
const shows: { id: BarShow; title: string }[] = [{ id: "auto", title: "When there is something" }, { id: "always", title: "Always" }];

/** The selected item: description, preview, placement, appearance with inheritance, hotkey, peek, Reset. */
function ItemPane({ b, config, sketchybar, onItem, onOpenExtension, onSetting }: { b: BarItem; config: BarConfig; sketchybar: boolean; onItem: (c: BarItemConfig) => void; onOpenExtension?: (name: string) => void; onSetting?: (extension: string, id: string, value: unknown) => void }) {
  const c = b.config;
  const put = (patch: Partial<BarItemConfig>) => onItem({ ...c, ...patch });
  const eff = effectiveTarget(b, config, sketchybar);
  const previewTargets: BarStripTarget[] = eff === "both" ? ["menubar", "sketchybar"] : eff === "off" ? [] : [eff];
  const lookTarget: Target = eff === "sketchybar" ? "sketchybar" : "menubar";
  const base = config[lookTarget];
  const look: BarLook = resolveLook(base, c.look);
  // A hidden (or never rendered) item previews as its first visible mock, not as an empty strip: what it looks like when it shows is the question the pane answers.
  const [mockId, setMockId] = useState(() => ((!b.state || kept(b.state, c.show).hidden) && b.mocks?.find((m) => !m.item.hidden)?.id) || "");
  const mock = b.mocks?.find((m) => m.id === mockId);
  const item = mock ? previewState(mock.item, b.title, false, c.show) : previewItem(b);
  // Whether the render (or a mock) offers a quiet shape: the Show select is always there, since the key is the core's and any item may offer one on its next render; the line under it says what this one does.
  const quiet = !!(b.state?.empty || b.mocks?.some((m) => m.item.empty));
  const overrides = Object.values(c.look).filter((v) => v !== undefined).length;
  const overridden = overrides > 0;
  const st = itemState(b);
  const anchor = `bar:${b.key}`;
  return (
    <div className="pal-ppane pal-bpane" key={b.key}>
      <header className="pal-ppane__head">
        <Icon icon={b.extIcon} size="lg" />
        <div className="pal-ppane__titles">
          <span className="pal-ppane__crumb">{onOpenExtension ? <button type="button" className="pal-link" onClick={() => onOpenExtension(b.extension)}>{b.extTitle}</button> : b.extTitle} ›</span>
          <h3 className="pal-ppane__title">{b.title}</h3>
        </div>
        <SettingsSwitch checked={c.enabled} disabled={!b.source} onChange={(v) => put({ enabled: v })} label={`${b.title} enabled`} />
      </header>
      {b.description && <p className="pal-ppane__desc">{b.description}</p>}
      <p className="pal-bpane__state" data-level={st.level}>{st.text}</p>
      {!b.source && <p className="pal-ppane__note">The manifest declares this item but the code has no render for it, so nothing is drawn and the switch is locked.</p>}

      <section className="pal-ppane__section pal-bpane__preview" aria-label="Preview">
        <h4 className="pal-ppane__h">Preview <span className="pal-ppane__h-note">{mock ? mock.title : b.state ? "the last render, as the strip draws it" : "not rendered yet: the manifest's title"}</span></h4>
        {!!b.mocks?.length && (
          <div className="pal-bpane__preview-state">
            <SettingsSelect id={`${anchor}-preview-state`} label="Preview state" value={mockId} options={[{ id: "", title: "Live state" }, ...b.mocks.map((m) => ({ id: m.id, title: m.title }))]} onChange={setMockId} />
            <span>Settings only; this never changes the live bar.</span>
          </div>
        )}
        {previewTargets.length === 0 ? (
          <p className="pal-ppane__none">Off: no strip draws it.</p>
        ) : previewTargets.flatMap((t) => (["dark", "light"] as const).map((theme) => (
          <div key={`${t}-${theme}`} className="pal-bpane__strip" data-hidden={item.hidden || undefined}>
            <BarStrip items={[item]} target={t} theme={theme} look={resolveLook(config[t], c.look)} width="100%" height={(t === "menubar" ? 24 : 26) + 10} bare />
            <span className="pal-bpane__strip-label">{targetTitle[t]}, {theme}{item.hidden ? ", hidden now" : ""}</span>
          </div>
        )))}
      </section>

      {!!b.settings?.length && (
        // What the extension decides about this item (when it shows, its colours, its thresholds): the same rows as the Extensions page, written to the same table, so they are found where the item is.
        <section className="pal-ppane__section" aria-label="Item settings">
          <h4 className="pal-ppane__h">Item settings <span className="pal-ppane__h-note">extensions.{b.extension}, the extension's own; the rest under {onOpenExtension ? <button type="button" className="pal-link" onClick={() => onOpenExtension(b.extension)}>{b.extTitle}</button> : b.extTitle}</span></h4>
          <div className="pal-settings-group__rows pal-xpane__fields">
            {b.settings.map((s) => (
              <div key={s.spec.id} data-anchor={`extensions:${b.extension}:${s.spec.id}`} data-inherited={s.note ? "" : undefined}>
                <SettingsField spec={s.spec} value={s.value} onChange={(v) => onSetting?.(b.extension, s.spec.id, v)} base={s.base} note={s.note} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="pal-ppane__section" aria-label="Placement">
        <h4 className="pal-ppane__h">Placement <span className="pal-ppane__h-note">bar.items."{b.key}"</span></h4>
        <div className="pal-bar-groups pal-bar-groups--flat">
          <div className="pal-setting pal-bar-field" data-layout="stack" data-anchor={`${anchor}:show`}>
            <label className="pal-setting__label" htmlFor={`${anchor}-show`}>Show</label>
            <div className="pal-setting__body">
              <div className="pal-setting__control"><SettingsSelect id={`${anchor}-show`} value={c.show ?? "auto"} options={shows} onChange={(v) => put({ show: v === "always" ? "always" : undefined })} /></div>
              <p className="pal-setting__desc">{c.show === "always" ? "Kept on the strip with nothing to say: the glyph alone, muted, the same popover." : "The default: off the strip while the extension has nothing to say."}{quiet ? "" : " This item offers no quiet shape yet, so it hides either way."}</p>
            </div>
          </div>
          <div className="pal-setting pal-bar-field" data-layout="stack" data-anchor={`${anchor}:target`}>
            <label className="pal-setting__label" htmlFor={`${anchor}-target`}>Target</label>
            <div className="pal-setting__body">
              <div className="pal-setting__control"><SettingsSelect id={`${anchor}-target`} value={c.target ?? ""} options={itemTargets} onChange={(v) => put({ target: (v || undefined) as BarTarget | undefined })} /></div>
              <p className="pal-setting__desc">{c.target ? "This item's own target." : `The default, ${targets.find((t) => t.id === config.target)?.title.toLowerCase()}: ${eff === "both" ? "both bars" : eff === "off" ? "nowhere" : `the ${targetTitle[eff]}`} now.`}</p>
            </div>
          </div>
          <div className="pal-setting pal-bar-field" data-layout="stack" data-anchor={`${anchor}:position`}>
            <label className="pal-setting__label" htmlFor={`${anchor}-position`}>sketchybar position<code className="pal-bar-field__key">position</code></label>
            <div className="pal-setting__body">
              <div className="pal-setting__control"><input id={`${anchor}-position`} className="pal-field__input pal-bar__position" type="text" placeholder={config.sketchybarPosition} value={c.position ?? ""} spellCheck={false} onChange={(e) => put({ position: e.target.value || undefined })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }} /></div>
              <p className="pal-setting__desc">{c.position ? "This item's own position." : `From the sketchybar default, ${config.sketchybarPosition}.`}</p>
            </div>
          </div>
          <div className="pal-setting pal-bar-field" data-layout="stack" data-anchor={`${anchor}:order`}>
            <label className="pal-setting__label" htmlFor={`${anchor}-order`}>Order</label>
            <div className="pal-setting__body">
              <div className="pal-setting__control"><input id={`${anchor}-order`} className="pal-field__input pal-bar__order" type="number" placeholder="0" value={c.order ?? ""} onChange={(e) => put({ order: e.target.value === "" ? undefined : Number(e.target.value) })} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }} /></div>
              <p className="pal-setting__desc">Among pal's own items: ascending left to right on the menu bar and within a sketchybar position.</p>
            </div>
          </div>
        </div>
      </section>


      <section className="pal-ppane__section" aria-label="Popover">
        <h4 className="pal-ppane__h">Popover</h4>
        <div className="pal-bar-groups pal-bar-groups--flat">
          <div className="pal-setting pal-bar-field" data-layout="stack" data-anchor={`${anchor}:hotkey`}>
            <span className="pal-setting__label">Hotkey</span>
            <div className="pal-setting__body">
              <div className="pal-setting__control"><SettingsHotkey value={c.hotkey} onChange={(v) => put({ hotkey: v })} label={`${b.title} hotkey`} /></div>
              <p className="pal-setting__desc">Opens the item's popover engaged from any app (or runs its open action). The root and palette hotkeys win a clash.</p>
            </div>
          </div>
          <div className="pal-setting pal-bar-field" data-layout="stack" data-anchor={`${anchor}:open_on_hover`}>
            <label className="pal-setting__label" htmlFor={`${anchor}-hover`}>Peek on hover<code className="pal-bar-field__key">open_on_hover</code></label>
            <div className="pal-setting__body">
              <div className="pal-setting__control"><SettingsSelect id={`${anchor}-hover`} value={c.openOnHover === undefined ? "" : c.openOnHover ? "on" : "off"} options={hovers} onChange={(v) => put({ openOnHover: v === "" ? undefined : v === "on" })} /></div>
              <p className="pal-setting__desc">{c.openOnHover === undefined ? `The default: ${lookTarget === "sketchybar" ? (config.sketchybarHover ? "on" : "off") : (config.menubarHover ? "on" : "off")} on the ${targetTitle[lookTarget]}.` : "This item's own say."} A peek opens after the hover delay and closes after the grace.</p>
            </div>
          </div>
        </div>
      </section>

      <SettingsDisclosure
        title="Override defaults"
        anchor={`${anchor}:look`}
        count={overrides}
        hint={overrides ? `over the ${targetTitle[lookTarget]} default` : `all from the ${targetTitle[lookTarget]} default`}
        aside={<p className="pal-bpane__override-note">Every key here is set once on the Defaults row and inherited by every item. Change one below and this item alone departs from it.</p>}
      >
        <LookGroups target={lookTarget} look={look} over={c.look} base={base} onChange={(id, v) => put({ look: { ...c.look, [id]: v } })} anchor={anchor} from={targetTitle[lookTarget]} placeholders={{ icon: typeof b.state?.icon === "string" ? b.state.icon : undefined }} />
      </SettingsDisclosure>

      <div className="pal-button-row pal-bpane__reset">
        <button type="button" className="pal-button" data-small disabled={!overridden && c.show === undefined && c.target === undefined && c.position === undefined && c.order === undefined && c.hotkey === undefined && c.openOnHover === undefined} onClick={() => onItem({ enabled: c.enabled, look: {} })}>Reset to defaults</button>
        <span className="pal-pane__note">Drops every key of this item but on/off; the defaults above apply again.</span>
      </div>
    </div>
  );
}

/**
 * One list, one pane, like Extensions and Palettes. The list is the
 * defaults row and then every declared item; the pane is whichever is
 * selected — the defaults form, or an item's description, a preview strip
 * of its last render in both themes, its placement, its popover, and its
 * departures from the defaults folded away until it has some.
 */
export function SettingsBar({ config, onChange, items, onItem, sketchybar, supported = true, selected, onSelect, onOpenExtension, onSetting }: SettingsBarProps) {
  const [local, setLocal] = useState<string | undefined>(undefined);
  const key = selected ?? local ?? BAR_DEFAULTS;
  const current = items.find((b) => b.key === key);
  const select = (k: string) => { setLocal(k); onSelect?.(k); };
  if (!supported) {
    return (
      <div className="pal-settings-page pal-bar">
        <section className="pal-settings-group" aria-label="Bar items">
          <h3 className="pal-settings-group__title">Bar items</h3>
          <div className="pal-settings-group__rows"><Empty title="Not on Linux yet" hint="pal draws bar items on the macOS menu bar and on sketchybar. A [bar] table in the config file is read and kept; nothing is drawn here." note={items.length ? `${items.length} declared by extensions, none rendered.` : undefined} /></div>
        </section>
      </div>
    );
  }

  const rows: SettingsListItem[] = [
    { id: BAR_DEFAULTS, icon: { kind: "glyph", value: "\u{f0493}", tint: "slate" }, title: "Defaults", sub: "every item, unless it says otherwise", anchor: "bar:defaults", divider: true },
    ...items.map((b) => ({ id: b.key, icon: b.extIcon, title: b.title, sub: b.extTitle, accessory: rowTag(b), dim: !b.config.enabled || !b.source, anchor: `bar:${b.key}` })),
  ];

  return (
    <div className="pal-split pal-bar">
      <datalist id="pal-bar-colors">{colorNames.map((c) => <option key={c} value={c} />)}</datalist>
      <SettingsList label="Bar items" items={rows} selected={key} onSelect={select} />
      <div className="pal-split__pane">
        {current
          ? <ItemPane key={current.key} b={current} config={config} sketchybar={sketchybar} onItem={(c) => onItem(current.key, c)} onOpenExtension={onOpenExtension} onSetting={onSetting} />
          : <Defaults config={config} onChange={onChange} sketchybar={sketchybar} items={items} />}
      </div>
    </div>
  );
}
