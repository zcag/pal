/**
 * `?gallery&bar=<ext>/<id>[,<ext>/<id>]&target=menubar|sketchybar&theme=dark|light[&state=<id>][&popover=1]`:
 * a bar item as each target draws it (docs/design/bar.md, "Mapping"), on a
 * 720 by 60 strip the store shows next to the panel screenshots. The item
 * comes from `shots/bar-<ext>.json` (fixture data, never the owner's): a
 * `BarItem`, `states[]` patches over it, and for a `{ palette }` menu the
 * rows that palette lists. `app/scripts/shots.mjs bar` drives it.
 *
 * The menu bar band is drawn from the bar's geometry, not captured: 24 pt
 * tall, 13 pt system text, template glyphs in the text colour, 22 px between
 * items, Apple's own items (battery, Wi-Fi, Control Center, the clock) at
 * the right and pal's to their left. The glyph is the prerendered 18 pt
 * image of the renderer (`bar/menubar.rs`): badge and progress drawn into
 * it, tinted only when `color` or `urgent` says so. `&popover=1` opens the
 * popover under the item: the Launcher on the item's menu level or palette
 * level, 420 wide, height by content, as `BarPage.tsx` shows it; an item
 * with no menu shows the HUD its click answers with ("Copied").
 *
 * The sketchybar band is the owner's (`~/.config/sketchybar/{theme,colors}.sh`):
 * a flat 26 px Catppuccin Frappe bar, San Francisco 14 for labels, the icon
 * font at 15, icon padding 8/4 and label padding 4/8, no pills at rest; the
 * `urgent` tint is the one box drawn (the timer's landed state).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Launcher, menuLevel, type Level } from "../Launcher";
import type { BarMenu, BarMenuNode } from "../bar";
import { Hud } from "../ui";
import { iconOf } from "../items";
import type { Item } from "../ui/types";

export type BarColor = "grey" | "blue" | "green" | "amber" | "red" | "violet" | "pink" | "teal" | "text" | "muted" | "accent" | "destructive";
export type BarSegment = { id: string; icon?: string; text?: string; color?: BarColor };
export type BarItem = {
  hidden?: boolean; icon?: string; title?: string; segments?: BarSegment[]; badge?: number | "dot";
  color?: BarColor | null; urgent?: boolean; stale?: boolean; progress?: number; tooltip?: string; menu?: BarMenu;
};
export type BarFixture = {
  key: string;
  /** The manifest's `bar.<id>.title`: the popover's crumb. */
  title: string;
  item: BarItem;
  /** Patches over `item`, picked by `&state=<id>`. */
  states?: { id: string; item: Partial<BarItem> }[];
  /** The rows a `{ palette }` menu opens on. */
  palette?: { title: string; placeholder?: string; rows: Item[] };
  /** What shots.mjs saves: file to target, theme, state, popover and the store caption. */
  shots?: Record<string, { target: Target; theme: Theme; state?: string; popover?: boolean; caption: string }>;
};
type Target = "menubar" | "sketchybar";
type Theme = "dark" | "light";

const fixtures = import.meta.glob<{ default: BarFixture }>("./shots/bar-*.json");

/** The strip: 720 by 60, the band at the top and the desktop under it. */
const W = 720, STRIP_H = 60;
const MENUBAR_H = 24, SKETCHYBAR_H = 26;
const POPOVER_W = 420, POPOVER_MAX_H = 480, POPOVER_GAP = 8, POPOVER_CHROME = 52 + 36;

/** The owner's two sketchybar palettes (colors.sh), the roles pal's `BarColor` lands on. */
const SKETCHY = {
  dark: { base: "#303446", text: "#c6d0f5", dim: "#7c8299", dimmer: "#535766", urgentBg: "#4f3352",
    map: { grey: "#7c8299", blue: "#8caaee", green: "#a6d189", amber: "#ef9f76", red: "#e78284", violet: "#ca9ee6", pink: "#f4b8e4", teal: "#81c8be", text: "#c6d0f5", muted: "#7c8299", accent: "#8caaee", destructive: "#e78284" } },
  light: { base: "#faf4ed", text: "#575279", dim: "#797593", dimmer: "#9893a5", urgentBg: "#f0dde2",
    map: { grey: "#797593", blue: "#286983", green: "#286983", amber: "#d7827e", red: "#b4637a", violet: "#907aa9", pink: "#b4637a", teal: "#56949f", text: "#575279", muted: "#797593", accent: "#286983", destructive: "#b4637a" } },
} as const;

/** A pal token for a `BarColor` on the menu bar (the tag palette; `text` is the bar's own colour, `muted` its 55% alpha). */
const menubarColor = (c: BarColor | null | undefined): string | undefined => {
  if (!c || c === "text") return undefined;
  if (c === "muted") return "var(--g-mb-muted)";
  if (c === "accent" || c === "destructive") return `var(--pal-${c})`;
  return `var(--pal-tag-${c})`;
};

const patched = (fx: BarFixture, state?: string): BarItem => {
  const s = state ? fx.states?.find((x) => x.id === state) : undefined;
  return s ? { ...fx.item, ...s.item } : fx.item;
};

/** A run of the strip: a Nerd glyph in the symbols font, anything else in the text font. */
function Glyph({ value, className, style }: { value: string; className?: string; style?: CSSProperties }) {
  return <span className={className} data-symbol={/^[\p{Co}]$/u.test(value) || undefined} style={style}>{value}</span>;
}

// ---- menu bar -----------------------------------------------------------------

/** Apple's items at the right of every bar, as neutral template glyphs. */
const Battery = () => (
  <svg className="g-mb__glyph" width="25" height="12" viewBox="0 0 25 12" aria-hidden>
    <rect x="0.5" y="0.5" width="21" height="11" rx="2.5" fill="none" stroke="currentColor" strokeOpacity="0.45" />
    <rect x="2" y="2" width="15" height="8" rx="1.2" fill="currentColor" />
    <path d="M23 4.2v3.6a2 2 0 0 0 1-1.8 2 2 0 0 0-1-1.8z" fill="currentColor" fillOpacity="0.45" />
  </svg>
);
const Wifi = () => (
  <svg className="g-mb__glyph" width="16" height="12" viewBox="0 0 16 12" aria-hidden>
    <path d="M0.6 3.6a11 11 0 0 1 14.8 0l-1.35 1.4a9 9 0 0 0-12.1 0z" fill="currentColor" />
    <path d="M3.3 6.4a7.2 7.2 0 0 1 9.4 0l-1.35 1.4a5.2 5.2 0 0 0-6.7 0z" fill="currentColor" />
    <path d="M6 9.2a3.4 3.4 0 0 1 4 0L8 11.4z" fill="currentColor" />
  </svg>
);
const ControlCenter = () => (
  <svg className="g-mb__glyph" width="17" height="15" viewBox="0 0 17 15" aria-hidden>
    <rect x="0.5" y="0.5" width="16" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <circle cx="13.5" cy="3.5" r="2" fill="currentColor" />
    <rect x="0.5" y="8.5" width="16" height="6" rx="3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <circle cx="3.5" cy="11.5" r="2" fill="currentColor" />
  </svg>
);

/** The renderer's 18 pt image: the glyph, the badge in its corner, the progress fill along its bottom. */
function MenubarImage({ item, tint }: { item: BarItem; tint?: string }) {
  const badge = item.badge;
  return (
    <span className="g-mb__image" data-progress={typeof item.progress === "number" || undefined} style={tint ? { color: tint } : undefined}>
      {item.icon && <Glyph value={item.icon} className="g-mb__icon" />}
      {badge === "dot" && <span className="g-mb__dot" />}
      {typeof badge === "number" && <span className="g-mb__count">{badge > 99 ? "99+" : badge}</span>}
      {typeof item.progress === "number" && (
        <span className="g-mb__progress"><span style={{ width: `${Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%` }} /></span>
      )}
    </span>
  );
}

/** One `NSStatusItem`: the image, `ImageLeft` of the title; segments joined into the title, two spaces apart, in the one text colour. */
function MenubarItem({ item, anchor }: { item: BarItem; anchor?: (el: HTMLElement | null) => void }) {
  const tint = item.urgent ? "var(--pal-destructive)" : menubarColor(item.color);
  const runs: ReactNode[] = [];
  if (item.title) runs.push(<span key="t">{item.title}</span>);
  for (const s of item.segments ?? []) runs.push(
    <span key={s.id}>{runs.length ? "  " : ""}{s.icon && <Glyph value={s.icon} className="g-mb__seg-icon" />}{s.icon && s.text ? " " : ""}{s.text}</span>,
  );
  return (
    <span ref={anchor} className="g-mb__item g-mb__pal" data-stale={item.stale || undefined} title={item.tooltip}>
      <MenubarImage item={item} tint={tint} />
      {runs.length > 0 && <span className="g-mb__title" style={tint ? { color: tint } : undefined}>{runs}</span>}
    </span>
  );
}

function MenuBar({ items, anchor }: { items: BarItem[]; anchor: (el: HTMLElement | null) => void }) {
  return (
    <div className="g-mb" style={{ height: MENUBAR_H }}>
      <div className="g-mb__items">
        {items.map((it, i) => <MenubarItem key={i} item={it} anchor={i === 0 ? anchor : undefined} />)}
        <span className="g-mb__item"><Battery /></span>
        <span className="g-mb__item"><Wifi /></span>
        <span className="g-mb__item"><ControlCenter /></span>
        <span className="g-mb__item g-mb__clock">Tue 16 Sep<span className="g-mb__time">14:32</span></span>
      </div>
    </div>
  );
}

// ---- sketchybar ---------------------------------------------------------------

/** The owner's timer rule: eight cells of heavy and light box drawing, the heavy ones the elapsed share. */
const rule = (p: number) => { const n = Math.round(Math.min(1, Math.max(0, p)) * 8); return "━".repeat(n) + "─".repeat(8 - n); };

/** One sketchybar item (or, with segments, a bracket of them): `icon` then `label`, the owner's paddings, colours from the map. */
function SketchyItem({ item, theme, anchor }: { item: BarItem; theme: Theme; anchor?: (el: HTMLElement | null) => void }) {
  const pal = SKETCHY[theme];
  const colorOf = (c: BarColor | null | undefined, fallback: string) => (item.stale ? pal.dim : c ? pal.map[c] : fallback);
  const iconColor = item.urgent ? pal.map.destructive : item.badge === "dot" ? pal.map.red : colorOf(item.color, pal.text);
  const labelColor = item.urgent ? pal.map.destructive : colorOf(item.color, pal.text);
  const label = [item.title, typeof item.badge === "number" ? <span key="b" style={{ color: pal.map.red }}>{item.title ? " " : ""}{item.badge}</span> : null].filter(Boolean);
  const hasLabel = label.length > 0;
  return (
    <span ref={anchor} className="g-sb__group" data-urgent={item.urgent || undefined} style={item.urgent ? { background: pal.urgentBg } : undefined}>
      <span className="g-sb__item">
        {typeof item.progress === "number" && <span className="g-sb__rule" style={{ color: iconColor }}>{rule(item.progress)}</span>}
        {item.icon && <Glyph value={item.icon} className="g-sb__icon" style={{ color: iconColor, paddingRight: hasLabel ? 4 : 8 }} />}
        {hasLabel && <span className="g-sb__label" style={{ color: labelColor }}>{label}</span>}
      </span>
      {item.segments?.map((s) => (
        <span key={s.id} className="g-sb__item">
          {s.icon && <Glyph value={s.icon} className="g-sb__icon" style={{ color: colorOf(s.color, pal.text), paddingRight: s.text ? 4 : 8 }} />}
          {s.text && <span className="g-sb__label" style={{ color: colorOf(s.color, pal.text) }}>{s.text}</span>}
        </span>
      ))}
    </span>
  );
}

function Sketchybar({ items, theme, anchor }: { items: BarItem[]; theme: Theme; anchor: (el: HTMLElement | null) => void }) {
  const pal = SKETCHY[theme];
  return (
    <div className="g-sb" style={{ height: SKETCHYBAR_H, background: pal.base, color: pal.text }}>
      <div className="g-sb__items">
        {items.map((it, i) => <SketchyItem key={i} item={it} theme={theme} anchor={i === 0 ? anchor : undefined} />)}
        <span className="g-sb__item"><Glyph value={"\u{f057e}"} className="g-sb__icon g-sb__icon--opt" style={{ paddingRight: 8 }} /></span>
        <span className="g-sb__item"><Glyph value={"\u{f0081}"} className="g-sb__icon" /><span className="g-sb__label">82%</span></span>
        <span className="g-sb__item"><span className="g-sb__label">Tue Sep 16 14:32</span></span>
      </div>
    </div>
  );
}

// ---- the popover --------------------------------------------------------------

const menuOf = (m: BarMenu | undefined): "nodes" | "palette" | "none" => (Array.isArray(m) ? "nodes" : m && typeof m === "object" && "palette" in m ? "palette" : "none");

/**
 * The popover as `BarPage.tsx` opens it: the Launcher on the item's level,
 * 420 wide, centred under the anchor and 8 px down, clamped to the strip,
 * its height the content's up to 480. A `nodes` menu is a menu level; a
 * `{ palette }` menu is that palette level over the fixture's rows.
 */
function Popover({ fx, item, x, onHeight }: { fx: BarFixture; item: BarItem; x: number; onHeight: (h: number) => void }) {
  const kind = menuOf(item.menu);
  const key = kind === "palette" ? fx.palette?.title.toLowerCase() ?? "rows" : fx.key;
  const start = useMemo<Level>(() => (kind === "nodes" ? menuLevel(fx.key, fx.title, item.menu as BarMenuNode[]) : { kind: "palette", palette: key }), [fx, item, kind, key]);
  const rows = useMemo<Item[] | undefined>(() => (kind === "palette" ? fx.palette?.rows.map((r) => ({ ...r, icon: iconOf(r.icon, r.name), palette: key })) : undefined), [fx, kind, key]);
  const el = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(120);
  // The height follows the content as BarPage.tsx measures it: the rows land after the Launcher's first search, so watch the tree.
  useLayoutEffect(() => {
    const root = el.current;
    if (!root) return;
    const measure = () => {
      const inner = root.querySelector<HTMLElement>(".pal-list__inner");
      const content = inner ? inner.scrollHeight + 16 : 120;
      const next = Math.min(POPOVER_MAX_H, POPOVER_CHROME + content);
      setH(next);
      onHeight(next);
    };
    const mo = new MutationObserver(measure);
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    measure();
    return () => mo.disconnect();
  }, [onHeight]);
  return (
    <div ref={el} className="g-bar__popover pal-bar-page" data-urgent={item.urgent || undefined} title={item.tooltip} style={{ left: x, width: POPOVER_W, height: h }}>
      <Launcher key={key} start={start} items={rows} sources={rows ? undefined : []} search={rows ? undefined : async () => []} onPick={() => ({ keep: true })} onHide={() => {}} />
    </div>
  );
}

// ---- the page -----------------------------------------------------------------

function Strip({ fx, target, theme, state, popover }: { fx: BarFixture; target: Target; theme: Theme; state?: string; popover: boolean }) {
  const item = useMemo(() => patched(fx, state), [fx, state]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [x, setX] = useState<number | null>(null);
  const [popH, setPopH] = useState(0);
  const bandH = target === "menubar" ? MENUBAR_H : SKETCHYBAR_H;
  const showHud = popover && menuOf(item.menu) === "none";
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = showHud ? 0 : POPOVER_W;
    setX(Math.round(Math.max(8, Math.min(W - w - 8, r.left + r.width / 2 - w / 2))));
  }, [anchor, showHud]);
  const height = popover ? bandH + POPOVER_GAP + (showHud ? 36 + 24 : popH + 28) : STRIP_H;
  useEffect(() => {
    document.documentElement.dataset.h = String(height);
    if (x !== null || !popover) requestAnimationFrame(() => { document.documentElement.dataset.ready = ""; });
  }, [height, x, popover]);
  return (
    <div className="g-bar" data-theme={theme} data-target={target} style={{ width: W, height }}>
      {target === "menubar" ? <MenuBar items={[item]} anchor={setAnchor} /> : <Sketchybar items={[item]} theme={theme} anchor={setAnchor} />}
      {popover && x !== null && !showHud && <Popover fx={fx} item={item} x={x} onHeight={setPopH} />}
      {showHud && x !== null && <div className="g-bar__hud" style={{ left: x, top: bandH + POPOVER_GAP }}><Hud text="Copied" /></div>}
    </div>
  );
}

/** Loads the fixture the URL names (`bar-<ext>.json` from `<ext>/<id>`), then mounts the strip; `data-ready` tells the driver it is drawn. */
export default function BarShot({ bar, target, theme, state, popover }: { bar: string; target: Target; theme: Theme; state?: string; popover: boolean }) {
  const [fx, setFx] = useState<BarFixture | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const ext = bar.split("/")[0];
    const load = fixtures[`./shots/bar-${ext}.json`];
    if (!load) { document.title = `no bar fixture for ${ext}`; return; }
    load().then((m) => setFx(m.default));
  }, [bar, theme]);
  return fx ? <Strip fx={fx} target={target} theme={theme} state={state} popover={popover} /> : null;
}
