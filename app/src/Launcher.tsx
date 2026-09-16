/**
 * The shell composed from the UI kit: root search over every item, palette
 * drill-downs, detail pane, action panel, toasts. Nothing in here touches
 * Tauri; App wires the index queries, the pick and hide commands and the
 * timing marks.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionPanel, Confirm, Detail, Empty, Footer, Grid, List, Panel, Presence, Search, Toast,
  groupBySection, domId, graphemePositions, useCursor, useKeys, useNavStack, type Hit, type ListHandle, type ToastSpec,
} from "./ui";
import { Fzf } from "fzf";
import type { Action, Detail as DetailSpec, Item, Match } from "./ui/types";
import { PALETTES, WELCOME, iconOf, sourceKey, type Ctx, type Effect, type SourceInfo } from "./items";
import { paletteTitle } from "./fixtures";

export const LIMIT = 200;
const GRID_COLUMNS = 8;
const LIST_ID = "results";
/** Fixture palettes (the gallery) best browsed as tiles; a real palette declares `view` itself. */
const gridFixtures = new Set(["emoji", "iconnerd", "chars", "colors"]);
/** The shell's own actions, kept apart from an item's by the prefix. */
const BROWSE = "pal:browse", DETAIL = "pal:detail", SETTINGS = "pal:settings", REFRESH = "pal:refresh", TIPS = "pal:welcome";
const OPEN: Action = { id: "open", title: "Open" };

/**
 * A palette view is keyed by `sourceKey`; `args` when an `Effect.push`
 * opened it (its rows come from the extension, listed with them). A show
 * view is a detail to read, nothing to search.
 */
type View = { kind: "root" } | { kind: "palette"; palette: string; args?: unknown } | { kind: "show"; detail: DetailSpec; title?: string };

/** After the cursor rests on a lazy item: wait this long before asking, and this much longer before the skeleton shows. */
const DETAIL_DEBOUNCE = 100, DETAIL_SKELETON_AFTER = 150;

export type LauncherHandle = { reset(): void; /** Straight into a palette (its `sourceKey`), from a palette hotkey. */ open(palette: string): void };

export type LauncherProps = {
  /** Palettes in the index, load order; empty until the host has listed one. */
  sources?: SourceInfo[];
  /** Top hits for `q`, over one palette or all of them; `ctx` is the level's filter and args. */
  search?: (q: string, scope?: SourceInfo, ctx?: Ctx) => Promise<Hit[]>;
  /** The rest of a lazy item's detail (`Item.lazyDetail`), merged over the inline one. */
  detail?: (item: Item, ctx?: Ctx) => Promise<DetailSpec>;
  /** Bumped when the index or the ranking changed underneath; re-runs the search. */
  version?: number;
  /** Gallery only: search these in the webview instead of `sources`/`search`. */
  items?: Item[];
  /** `action` is the item's own action id; absent for the default action of an item that declares none. What it returns is read as an `Effect` (toast, push, show). */
  onPick: (item: Item, query: string, action?: string, ctx?: Ctx) => void | Effect | Promise<unknown>;
  onHide: () => void;
  /** Opens the settings window; the action is only offered when given. */
  onSettings?: () => void;
  /** Lists `scope` again now (everything at the root), past any ttl; the action is only offered when given. */
  onRefresh?: (scope?: SourceInfo) => void;
  /** Brings the first-run tips (the `pal/welcome` source) back; offered at the root while they are hidden. */
  onWelcome?: () => void;
  mark?: (name: string, t: number) => void;
};

const haystack = (i: Item) => [i.name, i.subtitle, ...(i.keywords ?? [])].filter(Boolean).join(" ");

/** fzf positions are UTF-16 offsets into the haystack; map them back onto name and subtitle as grapheme positions, the unit the core reports. */
function splitMatch(item: Item, positions: Set<number>): Match {
  const name = new Set<number>(), subtitle = new Set<number>();
  const subStart = item.name.length + 1;
  for (const p of positions) {
    if (p < item.name.length) name.add(p);
    else if (item.subtitle && p >= subStart && p < subStart + item.subtitle.length) subtitle.add(p - subStart);
  }
  return { name: graphemePositions(item.name, name), subtitle: graphemePositions(item.subtitle ?? "", subtitle) };
}

/**
 * In-webview fzf over `items`, shaped like the core's `sources`/`search`
 * pair. Fixture rows carry a bare palette name, so that is the key. A
 * palette with a few sections gets them as `filters` (All first), so the
 * dropdown and Tab work in the gallery; a lazy item (`lazyDetail`) is one
 * the gallery answers itself.
 */
function useLocalSearch(items: Item[] = []) {
  const sources = useMemo<SourceInfo[]>(() => {
    const counts = new Map<string, number>(), sections = new Map<string, Set<string>>();
    for (const i of items) {
      counts.set(i.palette!, (counts.get(i.palette!) ?? 0) + 1);
      if (i.section) (sections.get(i.palette!) ?? sections.set(i.palette!, new Set()).get(i.palette!)!).add(i.section);
    }
    return [...counts].map(([palette, count]) => {
      const secs = [...(sections.get(palette) ?? [])];
      const filters = secs.length >= 2 && secs.length <= 8 ? [{ id: "all", title: "All" }, ...secs.map((s) => ({ id: s, title: s }))] : undefined;
      const lazy = items.some((i) => i.palette === palette && i.lazyDetail) ? "lazy" as const : undefined;
      return { extension: "", palette, title: paletteTitle(palette), live: false, input: false, view: gridFixtures.has(palette) ? "grid" as const : undefined, filters, detail: lazy, count, stale: false };
    });
  }, [items]);
  const fzf = useMemo(() => new Fzf(items, { selector: haystack, limit: LIMIT }), [items]);
  const search = useCallback(async (q: string, scope?: SourceInfo, ctx?: Ctx): Promise<Hit[]> => {
    const section = ctx?.filter && ctx.filter !== "all" ? ctx.filter : undefined;
    const inScope = (i: Item) => (!scope || i.palette === scope.palette) && (!section || i.section === section);
    if (!q) return items.filter(inScope).slice(0, LIMIT).map((item) => ({ item }));
    return fzf.find(q).filter((r) => inScope(r.item)).map((r) => ({ item: r.item, match: splitMatch(r.item, r.positions) }));
  }, [items, fzf]);
  return { sources, search };
}

export const Launcher = forwardRef<LauncherHandle, LauncherProps>(function Launcher(props, ref) {
  const { version = 0, onPick, onHide, onSettings, onRefresh, onWelcome, mark } = props;
  const local = useLocalSearch(props.items);
  const sources = props.sources ?? local.sources;
  const search = props.search ?? local.search;
  const nav = useNavStack<View>({ kind: "root" });
  const { view, query } = nav;
  const [filter, setFilter] = useState("all");
  /** The drilled-in palette's own filter; undefined is its first. */
  const [paletteFilter, setPaletteFilter] = useState<string | undefined>(undefined);
  const [showDetail, setShowDetail] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const [found, setFound] = useState<Hit[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<ListHandle>(null);
  const show = useRef<HTMLDivElement>(null);
  const keyAt = useRef(0);
  const seq = useRef(0);

  const byKey = useMemo(() => new Map(sources.map((s) => [sourceKey(s), s])), [sources]);
  const titleOf = (key: string) => byKey.get(key)?.title ?? key;
  const scopeKey = view.kind === "palette" ? view.palette : view.kind === "root" && filter !== "all" ? filter : null;
  const scope = scopeKey ? byKey.get(scopeKey) : undefined;
  // The palette and welcome rows are not items to count, and an input palette has none to filter by.
  const filterable = sources.filter((s) => { const k = sourceKey(s); return k !== PALETTES && k !== WELCOME && !s.input; });
  // Loaded extensions (fixture rows carry a bare palette name, which stands in): the empty state hints at installing more when few.
  const extensions = new Set(filterable.map((s) => s.extension || s.palette)).size;
  // A listing is pending for what is showing: restored rows awaiting the host, or a refresh running.
  const updating = scope ? scope.stale : filterable.some((s) => s.stale);
  const loading = sources.length === 0 || updating;
  const total = scope ? scope.count : filterable.reduce((n, s) => n + s.count, 0);
  const args = view.kind === "palette" ? view.args : undefined;
  const scopeFilter = view.kind === "palette" && scope?.filters?.length ? paletteFilter ?? scope.filters[0].id : undefined;
  const ctx = useMemo<Ctx | undefined>(() => (scopeFilter !== undefined || args !== undefined ? { filter: scopeFilter, args } : undefined), [scopeFilter, args]);

  // Replies can land out of order (a slow one behind a fast one): only the
  // latest request's answer is shown. A show view has nothing to list.
  useEffect(() => {
    const n = ++seq.current;
    if (view.kind === "show") return setFound([]);
    search(query, scope, ctx).then((h) => { if (n === seq.current) setFound(h); });
  }, [search, query, scopeKey, view.kind, ctx, version]);

  // At the root, palettes are the sections; inside one, the palette's own sections are.
  const hits = useMemo(() => (view.kind === "root" ? groupBySection(found.map((h) => ({ ...h, item: { ...h.item, section: titleOf(h.item.palette!) } }))) : groupBySection(found)), [found, view.kind, byKey]);

  const cur = useCursor(hits.length);
  const current: Item | undefined = hits[cur.cursor]?.item;
  // A palette that asks for it opens with the pane; leaving resets. cmd+i still toggles.
  useEffect(() => setShowDetail(view.kind === "palette" && !!byKey.get(view.palette)?.showDetail), [view]);
  const isGrid = view.kind === "palette" && scope?.view === "grid";
  const columns = scope?.columns ?? GRID_COLUMNS;

  // A lazy item under the cursor with the pane open: ask once the cursor has
  // rested, keep the answer for the level, and show the skeleton only when
  // the answer is slow. An answer for an item the cursor has left is dropped.
  const lazyKey = showDetail && current?.lazyDetail && props.detail ? `${current.palette}/${current.id}` : undefined;
  const lazyCache = useRef(new Map<string, DetailSpec>());
  const [lazy, setLazy] = useState<{ key: string; detail?: DetailSpec; slow?: boolean } | null>(null);
  useEffect(() => { lazyCache.current.clear(); }, [version, view]);
  useEffect(() => {
    if (!lazyKey || !current) return setLazy(null);
    const cached = lazyCache.current.get(lazyKey);
    if (cached) return setLazy({ key: lazyKey, detail: cached });
    setLazy({ key: lazyKey });
    let live = true;
    const item = current, c = ctx;
    const ask = setTimeout(() => {
      const slow = setTimeout(() => { if (live) setLazy({ key: lazyKey, slow: true }); }, DETAIL_SKELETON_AFTER);
      props.detail!(item, c).then(
        (d) => { clearTimeout(slow); if (!live) return; lazyCache.current.set(lazyKey, d); setLazy({ key: lazyKey, detail: d }); },
        () => { clearTimeout(slow); if (live) setLazy({ key: lazyKey, detail: item.detail ?? {} }); },
      );
    }, DETAIL_DEBOUNCE);
    return () => { live = false; clearTimeout(ask); };
  }, [lazyKey]);
  const lazyNow = lazy && lazy.key === lazyKey ? lazy : null;
  const paneDetail = current && (lazyNow?.detail ?? current.detail);
  const paneLoading = !!lazyNow && !lazyNow.detail && !!lazyNow.slow;

  // Fires on the paint after a reply: keystroke to painted list, invoke included.
  useLayoutEffect(() => {
    if (!keyAt.current) return;
    const t = keyAt.current;
    keyAt.current = 0;
    requestAnimationFrame(() => mark?.(`key->paint "${query}" (${hits.length}) ms`, performance.now() - t));
  }, [hits, mark]);

  useEffect(() => {
    if (!toast || toast.style === "animated") return;
    const id = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(id);
  }, [toast]);

  const focus = () => input.current?.focus();
  const setQuery = (q: string) => { keyAt.current = performance.now(); nav.setQuery(q); cur.reset(); };
  const push = (v: View) => { nav.push(v); cur.reset(); setPaletteFilter(undefined); };
  const pop = () => { nav.pop(); cur.reset(); setPaletteFilter(undefined); };
  const closeActions = () => { setActionsOpen(false); focus(); };
  const closeConfirm = () => { setConfirming(null); focus(); };
  const reset = useCallback(() => { nav.reset(); cur.reset(); setPaletteFilter(undefined); setActionsOpen(false); setConfirming(null); setToast(null); input.current?.focus(); }, [nav.reset, cur.reset]);
  const open = useCallback((palette: string) => { reset(); nav.push({ kind: "palette", palette }); }, [reset, nav.push]);
  useImperativeHandle(ref, () => ({ reset, open }), [reset, open]);

  // The item's own actions first (the default "Open" when it declares none;
  // a welcome tip declares `[]`, so Enter on it shows its detail), then the
  // shell's. With no item (nothing matched) the shell's still stand, so cmd+k
  // has somewhere to go.
  const actions = useMemo<Action[]>(() => {
    const a: Action[] = [];
    if (current) {
      const isPalette = current.palette === PALETTES, isTip = current.palette === WELCOME;
      a.push(...(current.actions ?? [isPalette ? { ...OPEN, title: `Open ${current.name}` } : OPEN]));
      if (view.kind === "root" && !isPalette && !isTip) a.push({ id: BROWSE, title: `Browse ${titleOf(current.palette!)}`, icon: { kind: "glyph", value: "›" }, shortcut: "cmd+shift+b", section: "Navigate" });
      a.push({ id: DETAIL, title: showDetail ? "Hide details" : "Show details", shortcut: "cmd+i", section: "View" });
    }
    // An indexed level only: an input palette or a drill-in lists per keystroke anyway.
    if (onRefresh && (view.kind === "root" || (view.kind === "palette" && !scope?.input && args === undefined)))
      a.push({ id: REFRESH, title: view.kind === "root" ? "Refresh everything" : `Refresh ${titleOf(view.palette)}`, icon: { kind: "glyph", value: "↻" }, shortcut: "cmd+r", section: "pal" });
    if (onSettings && view.kind === "root") a.push({ id: SETTINGS, title: "Open Settings", icon: { kind: "glyph", value: "⚙" }, shortcut: "cmd+,", section: "pal" });
    if (onWelcome && view.kind === "root" && !byKey.has(WELCOME)) a.push({ id: TIPS, title: "Show tips again", icon: { kind: "glyph", value: "?" }, section: "pal" });
    return a;
  }, [current, view, showDetail, byKey, onSettings, onRefresh, onWelcome, scope, args]);

  // The envelope's copy/open/hide are the caller's; the toast shows here, and a push/show opens its level.
  const pickItem = (item: Item, action?: string) =>
    Promise.resolve(onPick(item, query, action, ctx)).then(
      (r) => {
        const e = (r ?? {}) as Effect;
        if (e.toast) setToast({ style: e.toast.style ?? "success", title: e.toast.title, message: e.toast.message });
        if (e.push) push({ kind: "palette", palette: sourceKey(e.push), args: e.push.args });
        if (e.show) push({ kind: "show", detail: { markdown: e.show.markdown, metadata: e.show.metadata }, title: e.show.title });
      },
      (e) => setToast({ style: "failure", title: "Failed", message: String(e) }),
    );

  /** `confirmed`: the user already said yes to `a.confirm`. */
  const run = (a: Action, confirmed = false) => {
    setActionsOpen(false);
    if (a.confirm && !confirmed) return setConfirming(a);
    setConfirming(null);
    focus();
    switch (a.id) {
      case SETTINGS: onSettings?.(); break;
      case REFRESH: onRefresh?.(view.kind === "palette" ? scope : undefined); break;
      case TIPS: onWelcome?.(); break;
      case DETAIL: setShowDetail((s) => !s); break;
      case BROWSE: if (current) push({ kind: "palette", palette: current.palette! }); break;
      default:
        if (!current) return;
        // A palette row drills in; the pick only records the choice.
        if (current.palette === PALETTES) push({ kind: "palette", palette: current.id });
        pickItem(current, current.actions ? a.id : undefined);
    }
  };

  // At the root the dropdown scopes to a palette; inside one, it is the palette's own `filters`.
  const filterSpec = view.kind === "root"
    ? { options: [{ id: "all", title: "All" }, ...filterable.map((s) => ({ id: sourceKey(s), title: s.title }))], value: filter, onChange: (id: string) => { setFilter(id); cur.reset(); } }
    : view.kind === "palette" && scope?.filters?.length
      ? { options: scope.filters, value: scopeFilter!, onChange: (id: string) => { setPaletteFilter(id); cur.reset(); } }
      : undefined;

  /** In a show view the arrows scroll the text; a page is most of the view. */
  const scrollShow = (lines: number, page = false) => {
    const el = show.current;
    if (!el) return false;
    el.scrollBy({ top: page ? lines * el.clientHeight * 0.85 : lines * 40 });
  };

  useKeys(
    {
      move: ({ dir }) => {
        if (view.kind === "show") return dir === "down" || dir === "up" ? scrollShow(dir === "down" ? 1 : -1) : false;
        if (dir === "left" || dir === "right") { if (!isGrid) return false; cur.move(dir === "right" ? 1 : -1); return; }
        cur.move((dir === "down" ? 1 : -1) * (isGrid ? columns : 1));
      },
      jump: ({ to }) => {
        if (view.kind === "show") { const el = show.current; if (!el) return false; if (to === "home") el.scrollTo({ top: 0 }); else if (to === "end") el.scrollTo({ top: el.scrollHeight }); else scrollShow(to === "pageDown" ? 1 : -1, true); return; }
        if (to === "home") cur.set(0);
        else if (to === "end") cur.set(cur.last);
        else cur.move((to === "pageDown" ? 1 : -1) * (list.current?.pageSize() ?? 10));
      },
      jumpTo: ({ index }) => (index < hits.length ? cur.set(index) : false),
      // Enter and cmd+enter are a row's: with nothing under the cursor the shell's actions wait in the panel.
      primary: () => (view.kind === "show" ? pop() : current && actions[0] ? run(actions[0]) : false),
      secondary: () => (current && actions[1] ? run(actions[1]) : false),
      actions: () => (actions.length ? setActionsOpen(true) : false),
      escape: () => (query ? setQuery("") : nav.depth > 1 ? pop() : onHide()),
      back: () => (query || nav.depth === 1 ? false : pop()),
      // Without a filter, Tab is still swallowed: it would otherwise walk focus out of the input.
      filter: filterSpec ? ({ dir }) => {
        const o = filterSpec.options, i = o.findIndex((x) => x.id === filterSpec.value);
        filterSpec.onChange(o[(i + dir + o.length) % o.length].id);
      } : () => {},
      detail: () => setShowDetail((s) => !s),
      shortcut: ({ combo }) => {
        if (combo === "cmd+," && onSettings) return onSettings();
        const a = actions.find((x) => x.shortcut === combo);
        return a ? run(a) : false;
      },
    },
    { input },
  );

  const isShow = view.kind === "show";
  const showTitle = view.kind === "show" ? view.title ?? "Output" : "";
  const back = view.kind === "palette" ? { title: titleOf(view.palette), icon: scope?.icon ? iconOf(scope.icon, scope.title) : undefined, onBack: pop } : isShow ? { title: showTitle, onBack: pop } : undefined;
  const placeholder = view.kind === "root" ? "Search…" : view.kind === "show" ? "" : scope?.placeholder ?? `Search ${titleOf(view.palette)}…`;
  const onPickAt = (i: number) => { cur.set(i); const a = actions[0]; if (a) run(a); };
  const body = view.kind === "show"
    ? <div ref={show} className="pal-show" role="document" aria-label={showTitle}><Detail detail={view.detail} /></div>
    : !hits.length
      ? <Empty
          icon={{ kind: "glyph", value: "⌕" }}
          title={query ? `No results for “${query}”` : loading ? "Loading…" : "Nothing here"}
          hint={query && !scope?.input ? "Try a different word, or ⌘K for actions" : undefined}
          note={query && view.kind === "root" && sources.length > 0 && extensions < 2 ? `${extensions === 0 ? "No extensions are" : "Only one extension is"} loaded, so there is little to find. Settings (⌘,) › Extensions lists them; the Welcome tips link the guide to adding more.` : undefined}
        />
      : isGrid
        ? <Grid ref={list} id={LIST_ID} hits={hits} cursor={cur.cursor} onCursor={cur.set} onPick={onPickAt} columns={columns} />
        : <List ref={list} id={LIST_ID} hits={hits} cursor={cur.cursor} onCursor={cur.set} onPick={onPickAt} />;

  return (
    <Panel
      search={<Search value={query} onChange={setQuery} inputRef={input} back={back} filter={filterSpec} listId={isShow ? undefined : LIST_ID} activeId={hits.length ? domId(LIST_ID, cur.cursor) : undefined} popup={isGrid ? "grid" : "listbox"} loading={loading} placeholder={placeholder} readOnly={isShow} />}
      aside={showDetail && !isShow && (paneDetail ? <Detail detail={paneDetail} loading={paneLoading} /> : <Empty title="No details" />)}
      footer={
        <Footer
          icon={isShow ? undefined : current?.icon}
          title={view.kind === "root" ? `${hits.length}${hits.length === LIMIT ? "+" : ""} of ${total}` : isShow ? showTitle : current?.name}
          note={updating && !isShow ? "updating…" : undefined}
          primary={isShow ? { title: "Back" } : current && actions[0] ? { title: actions[0].title } : undefined}
          actions={actions.length > 0}
          onPrimary={() => (isShow ? pop() : current && actions[0] && run(actions[0]))}
          onActions={() => setActionsOpen(true)}
        />
      }
      overlay={
        <>
          <Presence show={!!toast} dur="base">{toast && <Toast toast={toast} />}</Presence>
          <Presence show={actionsOpen}><ActionPanel actions={actions} onRun={run} onClose={closeActions} title={current?.name} /></Presence>
          <Presence show={!!confirming}>{confirming && <Confirm title={confirming.confirm!} action={confirming.title} destructive={confirming.style === "destructive"} onConfirm={() => run(confirming, true)} onCancel={closeConfirm} />}</Presence>
        </>
      }
    >
      {body}
    </Panel>
  );
});
