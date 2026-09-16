/**
 * `?shot=<extension>&palette=<key>`: the launcher alone, at the panel's size,
 * centred on the site's wallpaper, its rows from `shots/<extension>.json`
 * (fixture data, never the owner's). `app/scripts/shots.mjs` drives it with
 * real keys in a headless browser and saves the store screenshots.
 *
 * A fixture names its palettes as the host would (`PaletteMeta` fields plus
 * the rows) and, where a screenshot needs one, the answers a pick, a detail
 * or a view would bring: `effects["<palette>/<id>"]` (or `.../<id>:<action>`)
 * is what `pick` returns; `details[id]` what `detail(id)` answers; `view` the
 * tree a view palette opens with; `levels[args]` the rows of a `push` with
 * that string as its args; `byQuery[q]` an input palette's rows for a query
 * and `byFilter[id]` a palette's rows under a filter.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Fzf } from "fzf";
import { Launcher, type LauncherHandle } from "../Launcher";
import { PALETTES, sourceKey, toItem, toView, type Ctx, type Effect, type SourceInfo, type WireItem } from "../items";
import type { Hit } from "../ui";
import type { Detail, FilterOption, Item, ViewSpec } from "../ui/types";
import { svgIcon } from "./data";

type Palette = {
  title: string;
  icon?: string;
  live?: boolean;
  input?: boolean;
  view?: "list" | "grid" | "view";
  columns?: number;
  placeholder?: string;
  showDetail?: boolean;
  filters?: FilterOption[];
  items?: WireItem[];
  byQuery?: Record<string, WireItem[]>;
  byFilter?: Record<string, WireItem[]>;
  levels?: Record<string, WireItem[]>;
  details?: Record<string, Detail>;
  tree?: ViewSpec;
};
export type Fixture = { palettes: Record<string, Palette>; effects?: Record<string, Effect> };

const fixtures = import.meta.glob<{ default: Fixture }>("./shots/*.json");

/** The tile colours of the letter icons standing in for app artwork, which only the app's `icon://` scheme serves. */
const tiles = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#14b8a6", "#ef4444", "#6366f1"];
const tileFor = (name: string) => tiles[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % tiles.length];

/** The app's name from its bundle path: the tile's letter and colour, the same for every row of one app. */
const appName = (path: string) => path.replace(/\/+$/, "").split("/").pop()!.replace(/\.app$/i, "");

/** Rows off a fixture as the UI keeps them; an app icon becomes a letter tile. */
function rows(key: string, p: Palette, items: WireItem[] = p.items ?? []): Hit[] {
  return items.map((w) => {
    const app = w.icon && typeof w.icon === "object" && typeof (w.icon as { app?: unknown }).app === "string" ? appName((w.icon as { app: string }).app) : undefined;
    const icon = app !== undefined ? { image: svgIcon(tileFor(app), app[0]?.toUpperCase() ?? "") } : w.icon;
    const item = toItem({ source: { extension: "", palette: key }, id: w.id, score: 0, name_positions: [], item: { ...w, icon } }, { title: p.title, detail: p.details ? "lazy" : undefined });
    return { item };
  });
}

const haystack = (h: Hit) => [h.item.name, h.item.subtitle, ...(h.item.keywords ?? [])].filter(Boolean).join(" ");

function Shot({ fixture, palette: open }: { fixture: Fixture; palette?: string }) {
  const launcher = useRef<LauncherHandle>(null);
  const sources = useMemo<SourceInfo[]>(() => {
    const own = Object.entries(fixture.palettes).map(([key, p]) => ({
      extension: "", palette: key, title: p.title, icon: p.icon, live: !!p.live, input: !!p.input || p.view === "view", view: p.view, columns: p.columns,
      placeholder: p.placeholder, showDetail: p.showDetail, filters: p.filters, detail: p.details ? "lazy" as const : undefined,
      count: p.input || p.view === "view" ? 0 : p.items?.length ?? 0, stale: false,
    }));
    return [{ extension: "pal", palette: "palettes", title: "Palettes", live: false, input: false, count: own.length, stale: false }, ...own];
  }, [fixture]);
  const paletteRows = useMemo<Hit[]>(() => Object.entries(fixture.palettes).map(([key, p]) => ({
    item: { id: key, name: p.title, subtitle: p.title, icon: p.icon ? toItem({ source: { extension: "", palette: key }, id: key, score: 0, name_positions: [], item: { id: key, name: p.title, icon: p.icon } }, { title: p.title }).icon : undefined, palette: PALETTES, accessories: [{ text: "Palette" }] } as Item,
  })), [fixture]);
  const indexed = useMemo(() => Object.entries(fixture.palettes).filter(([, p]) => !p.input && p.view !== "view").flatMap(([key, p]) => rows(key, p)), [fixture]);

  const search = useCallback(async (q: string, scope?: SourceInfo, ctx?: Ctx): Promise<Hit[]> => {
    let pool: Hit[];
    if (!scope) pool = [...paletteRows, ...indexed];
    else {
      const key = sourceKey(scope), p = fixture.palettes[key];
      if (!p) return [];
      if (typeof ctx?.args === "string") return rows(key, p, p.levels?.[ctx.args] ?? []);
      const filtered = ctx?.filter && ctx.filter !== (p.filters?.[0]?.id ?? "all") ? p.byFilter?.[ctx.filter] : undefined;
      if (p.input) return rows(key, p, filtered ?? p.byQuery?.[q] ?? p.byQuery?.[""] ?? p.items);
      pool = rows(key, p, filtered ?? p.items);
    }
    if (!q) return pool;
    return new Fzf(pool, { selector: haystack }).find(q).map((r) => ({ item: r.item.item }));
  }, [fixture, paletteRows, indexed]);

  const detail = useCallback(async (item: Item) => fixture.palettes[item.palette!]?.details?.[item.id] ?? item.detail ?? {}, [fixture]);
  const view = useCallback(async (scope: SourceInfo) => {
    const t = fixture.palettes[sourceKey(scope)]?.tree;
    if (!t) throw new Error("no view in the fixture");
    return toView(t);
  }, [fixture]);
  const onPick = useCallback((item: Item, _q: string, action?: string): Effect | void => {
    if (item.palette === PALETTES) return { keep: true };
    const e = fixture.effects?.[`${item.palette}/${item.id}${action ? `:${action}` : ""}`] ?? fixture.effects?.[`${item.palette}/${item.id}`];
    return e ? { ...e, view: e.view && toView(e.view) } : { keep: true };
  }, [fixture]);

  useEffect(() => { if (open) launcher.current?.open(open); }, [open]);
  return (
    <div className="g-shot" data-theme="light">
      <div className="g-frame">
        <Launcher ref={launcher} sources={sources} search={search} detail={detail} view={view} onPick={onPick} onHide={() => {}} onRefresh={() => {}} onSettings={() => {}} />
      </div>
    </div>
  );
}

/** Loads the fixture the URL names, then mounts the shot; `data-ready` on the root tells the driver the panel is up. */
export default function Shots({ extension, palette }: { extension: string; palette?: string }) {
  const [fixture, setFixture] = useState<Fixture | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    const load = fixtures[`./shots/${extension}.json`];
    if (!load) { document.title = `no fixture for ${extension}`; return; }
    load().then((m) => setFixture(m.default));
  }, [extension]);
  useEffect(() => { if (fixture) requestAnimationFrame(() => { document.documentElement.dataset.ready = ""; }); }, [fixture]);
  return fixture ? <Shot fixture={fixture} palette={palette} /> : null;
}
