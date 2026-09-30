/**
 * `?gallery&bar=<ext>/<id>[,<ext>/<id>]&target=menubar|sketchybar&theme=dark|light[&state=<id>][&popover=1]`:
 * a bar item as each target draws it, on a 720 by 60 strip, for the store's
 * bar shots (docs/design/screenshots.md). The item comes from
 * `shots/bar-<ext>.json` (fixture data, never the owner's): a `BarItem`,
 * `states[]` patches over it, and for a `{ palette }` menu the rows that
 * palette lists. `app/scripts/shots.mjs` drives it. The band itself is
 * `ui/BarStrip.tsx` over `ui/bar-model.ts` (what the real renderers draw),
 * shared with the Settings > Bar preview. `&popover=1` opens the popover
 * under the item: the Launcher on the item's menu level or palette level,
 * 420 wide, height by content, as `BarPage.tsx` shows it, on a 720 by 540
 * canvas whatever its height; an item with no menu shows the HUD its click
 * answers with ("Copied").
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Launcher, menuLevel, type Level } from "../Launcher";
import type { BarMenu, BarMenuNode } from "../bar";
import { Hud } from "../ui";
import { BarStrip, MENUBAR_H, SKETCHYBAR_H, type BarStripItem } from "../ui/BarStrip";
import { POPOVER_MAX_H, popoverHeight } from "../ui/popover-size";
import { toItem, toView, type Effect, type SourceInfo, type WireItem } from "../items";
import { manifestOf } from "./data";
import type { Item } from "../ui/types";

export type BarItem = BarStripItem & { menu?: BarMenu };
export type BarFixture = {
  key: string;
  /** The manifest's `bar.<id>.title`: the popover's crumb. */
  title: string;
  item: BarItem;
  /** Patches over `item`, picked by `&state=<id>`. */
  states?: { id: string; item: Partial<BarItem> }[];
  /** The menu bar's own battery level, percent, when the item is about power (80 otherwise). */
  battery?: number;
  /** The rows a `{ palette }` menu opens on. */
  palette?: { title: string; placeholder?: string; rows: Item[] };
  /** The extension's answers to a `{ view }` popover's actions, by action id (what `bar/action` returned while the fixture ran): a shot's `keys` reach them, a preview's `show`. */
  effects?: Record<string, Effect>;
  /** What shots.mjs saves (docs/design/screenshots.md): `menubar`, `popover`, `sketchybar`, and `menubar-<state>` / `popover-<state>`, each with its target, state, the keys pressed in the popover and store caption; both themes of each. */
  shots?: Record<string, { target: Target; state?: string; popover?: boolean; keys?: string[]; caption: string }>;
};
type Target = "menubar" | "sketchybar";
type Theme = "dark" | "light";

const fixtures = import.meta.glob<{ default: BarFixture }>("./shots/bar-*.json");

/** The strip: 720 by 60, the band at the top and the desktop under it. */
const W = 720, STRIP_H = 60;
/** Every popover shot's canvas: the band, the gap and the tallest popover (480) with a margin, so the store lays them out alike. */
const POPOVER_CANVAS_H = 540;
const POPOVER_W = 420, POPOVER_GAP = 8;

const patched = (fx: BarFixture, state?: string): BarItem => {
  const s = state ? fx.states?.find((x) => x.id === state) : undefined;
  return s ? { ...fx.item, ...s.item } : fx.item;
};

// ---- the popover --------------------------------------------------------------

const menuOf = (m: BarMenu | undefined): "nodes" | "palette" | "view" | "none" => (Array.isArray(m) ? "nodes" : m && typeof m === "object" && "palette" in m ? "palette" : m && typeof m === "object" && "view" in m ? "view" : "none");

/**
 * The popover as `BarPage.tsx` opens it: the Launcher on the item's level,
 * 420 wide, centred under the anchor and 8 px down, clamped to the strip,
 * its height the content's up to 480. A `nodes` menu is a menu level; a
 * `{ palette }` menu is that palette level over the fixture's rows; a
 * `{ view }` menu is that tree as the item's own view level (a pick from
 * it answers what the fixture recorded for that action, else keeps the level).
 */
function Popover({ fx, item, x }: { fx: BarFixture; item: BarItem; x: number }) {
  const kind = menuOf(item.menu);
  const key = kind === "palette" ? fx.palette?.title.toLowerCase() ?? "rows" : fx.key;
  const start = useMemo<Level>(() => (kind === "nodes" ? menuLevel(fx.key, fx.title, item.menu as BarMenuNode[]) : kind === "view" ? { kind: "view", palette: fx.key, title: fx.title, spec: toView((item.menu as { view: never }).view) } : { kind: "palette", palette: key }), [fx, item, kind, key]);
  // The extension's manifest as the source: the crumb and the footer draw its tile, and a palette menu's rows are that palette's (toItem: its tint), as the app's popover draws them.
  const m = useMemo(() => manifestOf(fx.key.split("/")[0]), [fx]);
  const rows = useMemo<Item[] | undefined>(() => {
    if (kind !== "palette") return undefined;
    // Keyed by the palette alone, as the level names it (sourceKey of an empty extension), as the panel's gallery does.
    const source = { extension: "", palette: key };
    return fx.palette?.rows.map((r) => toItem({ source, id: r.id, score: 0, name_positions: [], item: r as WireItem }, { title: fx.palette!.title, icon: m?.icon }));
  }, [fx, kind, key, m]);
  const sources = useMemo<SourceInfo[]>(() => {
    return m ? [{ extension: kind === "palette" ? "" : fx.key.split("/")[0], palette: kind === "palette" ? key : "manifest", title: kind === "palette" ? fx.palette?.title ?? m.title : m.title, placeholder: kind === "palette" ? fx.palette?.placeholder : undefined, icon: m.icon, live: false, input: false, count: 0, stale: false }] : [];
  }, [fx, m, kind, key]);
  const el = useRef<HTMLDivElement>(null);
  // From the tallest, then shrunk to the content: a view that scrolls its selected row into view on mount (stats) would otherwise scroll in a 120 px box.
  const [h, setH] = useState(POPOVER_MAX_H);
  // The height follows the content as BarPage.tsx measures it: the rows land after the Launcher's first search, so watch the tree.
  useLayoutEffect(() => {
    const root = el.current;
    if (!root) return;
    const measure = () => setH(popoverHeight(root));
    const mo = new MutationObserver(measure);
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    measure();
    return () => mo.disconnect();
  }, []);
  return (
    <div ref={el} className="g-bar__popover pal-bar-page" data-urgent={item.urgent || undefined} title={item.tooltip} style={{ left: x, width: POPOVER_W, height: h }}>
      <Launcher key={key} start={start} items={rows} sources={sources} search={rows ? undefined : async () => []} onPick={(_i, _q, action) => (action && fx.effects?.[action]) || { keep: true }} onHide={() => {}} />
    </div>
  );
}

// ---- the page -----------------------------------------------------------------

function Strip({ fx, target, theme, state, popover }: { fx: BarFixture; target: Target; theme: Theme; state?: string; popover: boolean }) {
  const item = useMemo(() => patched(fx, state), [fx, state]);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [x, setX] = useState<number | null>(null);
  const bandH = target === "menubar" ? MENUBAR_H : SKETCHYBAR_H;
  const showHud = popover && menuOf(item.menu) === "none";
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const w = showHud ? 0 : POPOVER_W;
    setX(Math.round(Math.max(8, Math.min(W - w - 8, r.left + r.width / 2 - w / 2))));
  }, [anchor, showHud]);
  const height = popover ? POPOVER_CANVAS_H : STRIP_H;
  useEffect(() => {
    document.documentElement.dataset.h = String(height);
    if (x !== null || !popover) requestAnimationFrame(() => { document.documentElement.dataset.ready = ""; });
  }, [height, x, popover]);
  return (
    <BarStrip items={[item]} target={target} theme={theme} width={W} height={height} battery={fx.battery} anchor={setAnchor}>
      {popover && x !== null && !showHud && <Popover fx={fx} item={item} x={x} />}
      {showHud && x !== null && <div className="g-bar__hud" style={{ left: x, top: bandH + POPOVER_GAP }}><Hud text="Copied" /></div>}
    </BarStrip>
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
