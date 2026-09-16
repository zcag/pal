/**
 * The shell composed from the UI kit: root search over every item, palette
 * drill-downs, detail pane, action panel, toasts. Nothing in here touches
 * Tauri; App wires the index queries, the pick and hide commands and the
 * timing marks.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionPanel, Confirm, Detail, Empty, Footer, Form, Grid, List, Panel, Presence, Search, Toast, View,
  groupBySection, domId, graphemePositions, hasShortcut, useCursor, useKeys, useNavStack, useSubmitKey, type Command, type Hit, type ListHandle, type ToastSpec,
} from "./ui";
import { Fzf } from "fzf";
import type { Action, Detail as DetailSpec, FormSpec, FormValues, Item, Match, ViewSpec } from "./ui/types";
import { PALETTES, WELCOME, iconOf, sourceKey, toForm, type Ctx, type Effect, type SourceInfo } from "./items";
import { SUBMENU, menuRows, type BarMenuNode } from "./bar";
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
 * A palette level is keyed by `sourceKey`; `args` when an `Effect.push`
 * opened it (its rows come from the extension, listed with them). A show
 * level is a detail to read, nothing to search. A view level is a render
 * tree from a view palette: `spec` is absent while the tree is on its way,
 * and every pick from it usually brings the next one. A form level is an
 * `Effect.form` from a pick on `from`: its submit is a pick on that item
 * (or the form's own `id`) carrying the values; `key` tells one form from
 * the next at the same depth, so the fields never keep a gone form's text.
 * A menu level is a bar item's `nodes` menu (`bar.ts`): its rows are
 * fixed, filtered by the query, a submenu row pushes another; a pick is
 * the row's action on the item (`palette` is the item's key, no source).
 */
export type Level =
  | { kind: "root" }
  | { kind: "palette"; palette: string; args?: unknown }
  | { kind: "show"; detail: DetailSpec; title?: string }
  | { kind: "view"; palette: string; args?: unknown; spec?: ViewSpec; /** The crumb, when `palette` is not a source (a bar item's key). */ title?: string }
  | { kind: "form"; palette: string; args?: unknown; spec: FormSpec; from: Item; key: number }
  | { kind: "menu"; key: string; title: string; rows: Item[]; submenus: Record<string, BarMenuNode[]> };

/** A menu level for a bar item's `nodes`. */
export const menuLevel = (key: string, title: string, nodes: BarMenuNode[]): Level => ({ kind: "menu", key, title, ...menuRows(key, nodes) });
/** The item a pick from a view level is addressed to: the view's `id`, else this. */
const VIEW_ID = "view";
/** Keys a view level holds while a pick is on its way, at most; a fast typist's letters, not a held key. */
const VIEW_QUEUE = 4;
/** What a view level does with a key, queued while a pick is in flight and run against the tree the reply brings. */
type ViewCommand = Extract<Command, { type: "primary" | "secondary" | "shortcut" | "key" }>;

/** After the cursor rests on a lazy item: wait this long before asking, and this much longer before the skeleton shows. */
const DETAIL_DEBOUNCE = 100, DETAIL_SKELETON_AFTER = 150;

export type LauncherHandle = {
  reset(): void;
  /** Straight into a palette (its `sourceKey`), from a palette hotkey. */
  open(palette: string): void;
  /** The search box set to `q` at the current level (a `pal://open` link's `?q=`). */
  type(q: string): void;
  /** Focus back on the search box (after a card outside the Launcher closes). */
  focus(): void;
  /** The bottom level swapped for `level` (the bar popover opening on an item): the stack dropped, or kept with only the bottom replaced (`inPlace`, the item rendered again while showing). */
  start(level: Level, inPlace?: boolean): void;
};

export type LauncherProps = {
  /** Palettes in the index, load order; empty until the host has listed one. */
  sources?: SourceInfo[];
  /** Top hits for `q`, over one palette or all of them; `ctx` is the level's filter and args. */
  search?: (q: string, scope?: SourceInfo, ctx?: Ctx) => Promise<Hit[]>;
  /** The rest of a lazy item's detail (`Item.lazyDetail`), merged over the inline one. */
  detail?: (item: Item, ctx?: Ctx) => Promise<DetailSpec>;
  /** The tree a view palette (`SourceInfo.view === "view"`) opens with. */
  view?: (scope: SourceInfo, ctx?: Ctx) => Promise<ViewSpec>;
  /** Bumped when the index or the ranking changed underneath; re-runs the search. */
  version?: number;
  /** The bottom level: the root, or (the bar popover) an item's level with no root under it. */
  start?: Level;
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
  const nav = useNavStack<Level>(props.start ?? { kind: "root" });
  const { view, query } = nav;
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
  const formEl = useRef<HTMLDivElement>(null);
  const submitKey = useSubmitKey(formEl);
  const keyAt = useRef(0);
  const seq = useRef(0);
  const formSeq = useRef(0);
  /** A pick from a view or form level in flight: the reply is coming. A form drops further keys (a second Enter); a view queues them (`queue`). */
  const [busy, setBusy] = useState(false);
  /** Keys pressed in a view level while a pick was in flight, oldest first; drained one per reply against the new tree, dropped when the level changes. */
  const queue = useRef<ViewCommand[]>([]);
  /** The level as of the last render, for a reply that lands after the user moved on. */
  const level = useRef(view);
  level.current = view;

  const byKey = useMemo(() => new Map(sources.map((s) => [sourceKey(s), s])), [sources]);
  const titleOf = (key: string) => byKey.get(key)?.title ?? key;
  const scopeKey = view.kind === "palette" || view.kind === "view" || view.kind === "form" ? view.palette : null;
  const isMenu = view.kind === "menu";
  const menuFzf = useMemo(() => (view.kind === "menu" ? new Fzf(view.rows, { selector: haystack, limit: LIMIT }) : undefined), [view]);
  const scope = scopeKey ? byKey.get(scopeKey) : undefined;
  // The palette and welcome rows are not items to count, and an input palette has none to filter by.
  const filterable = sources.filter((s) => { const k = sourceKey(s); return k !== PALETTES && k !== WELCOME && !s.input; });
  // Loaded extensions (fixture rows carry a bare palette name, which stands in): the empty state hints at installing more when few.
  const extensions = new Set(filterable.map((s) => s.extension || s.palette)).size;
  // A listing is pending for what is showing: restored rows awaiting the host, or a refresh running.
  const updating = scope ? scope.stale : filterable.some((s) => s.stale);
  const isView = view.kind === "view", isForm = view.kind === "form";
  const spec = view.kind === "view" ? view.spec : undefined;
  const form = view.kind === "form" ? view : undefined;
  // A menu level's rows are its own: nothing is loading or updating there.
  const loading = isView ? !spec || busy : isForm || isMenu ? busy : sources.length === 0 || updating;
  const total = scope ? scope.count : filterable.reduce((n, s) => n + s.count, 0);
  const args = view.kind === "palette" || view.kind === "view" || view.kind === "form" ? view.args : undefined;
  const scopeFilter = view.kind === "palette" && scope?.filters?.length ? paletteFilter ?? scope.filters[0].id : undefined;
  const ctx = useMemo<Ctx | undefined>(() => (scopeFilter !== undefined || args !== undefined ? { filter: scopeFilter, args } : undefined), [scopeFilter, args]);

  // Replies can land out of order (a slow one behind a fast one): only the
  // latest request's answer is shown. A show, view or form level has nothing
  // to list; a menu level's rows are its own, filtered here.
  useEffect(() => {
    const n = ++seq.current;
    if (view.kind === "show" || view.kind === "view" || view.kind === "form" || view.kind === "menu") return setFound([]);
    search(query, scope, ctx).then((h) => { if (n === seq.current) setFound(h); });
  }, [search, query, scopeKey, view.kind, ctx, version]);
  // A menu level's rows are known up front: no request, filtered as typed.
  const menuHits = useMemo<Hit[]>(() => (view.kind !== "menu" ? [] : query && menuFzf ? menuFzf.find(query).map((r) => ({ item: r.item, match: splitMatch(r.item, r.positions) })) : view.rows.map((item) => ({ item }))), [view, query, menuFzf]);

  // A view level pushed without its tree asks for it; the answer lands in
  // the level (replaced in place), a failure is a toast and the level pops.
  useEffect(() => {
    if (view.kind !== "view" || view.spec || !scope) return;
    let live = true;
    const ask = props.view ? props.view(scope, ctx) : Promise.reject(new Error("no view source"));
    ask.then(
      (s) => { if (live) nav.replace({ ...view, spec: s }); },
      (e) => { if (!live) return; setToast({ style: "failure", title: "Could not open", message: String(e) }); nav.pop(); },
    );
    return () => { live = false; };
  }, [view, scope, ctx]);

  // Leaving a view or form level, the search input comes back and takes the keys again (a form's first field takes them meanwhile).
  useEffect(() => { if (view.kind !== "view" && view.kind !== "form") input.current?.focus({ preventScroll: true }); }, [view.kind]);

  // At the root, palettes are the sections; inside one, the palette's own sections are.
  const hits = useMemo(() => (view.kind === "menu" ? groupBySection(menuHits) : view.kind === "root" ? groupBySection(found.map((h) => ({ ...h, item: { ...h.item, section: titleOf(h.item.palette!) } }))) : groupBySection(found)), [found, menuHits, view.kind, byKey]);

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

  // Fires on the paint after a reply: keystroke to painted list, invoke
  // included. The first list painted at all is the startup mark (the core
  // logs it against its own start).
  const painted = useRef(false);
  useLayoutEffect(() => {
    if (!painted.current && hits.length) {
      painted.current = true;
      requestAnimationFrame(() => mark?.(`first paint (${hits.length})`, performance.now()));
    }
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
  const push = (v: Level) => { nav.push(v); cur.reset(); setPaletteFilter(undefined); };
  const pop = () => { nav.pop(); cur.reset(); setPaletteFilter(undefined); };
  /** Into a palette: a view palette opens as a view level (its tree asked for), any other as a list. */
  const enter = useCallback((palette: string, args?: unknown) => push(byKey.get(palette)?.view === "view" ? { kind: "view", palette, args } : { kind: "palette", palette, args }), [byKey]);
  const closeActions = () => { setActionsOpen(false); focus(); };
  const closeConfirm = () => { setConfirming(null); focus(); };
  const reset = useCallback(() => { nav.reset(); cur.reset(); setPaletteFilter(undefined); setActionsOpen(false); setConfirming(null); setToast(null); setBusy(false); input.current?.focus(); }, [nav.reset, cur.reset]);
  const open = useCallback((palette: string) => { reset(); enter(palette); }, [reset, enter]);
  const start = useCallback((level: Level, inPlace = false) => {
    if (inPlace) return nav.replaceRoot(level);
    nav.restart(level); cur.reset(); setPaletteFilter(undefined); setActionsOpen(false); setConfirming(null); setToast(null); setBusy(false); input.current?.focus();
  }, [nav.restart, nav.replaceRoot, cur.reset]);
  const type = useCallback((q: string) => { setQuery(q); focus(); }, [nav.setQuery, cur.reset]);
  useImperativeHandle(ref, () => ({ reset, open, start, type, focus }), [reset, open, start, type]);

  // The item's own actions first (the default "Open" when it declares none;
  // a welcome tip declares `[]`, so Enter on it shows its detail), then the
  // shell's. With no item (nothing matched) the shell's still stand, so cmd+k
  // has somewhere to go.
  const actions = useMemo<Action[]>(() => {
    const a: Action[] = [];
    // A view level's actions are the view's own, with their keys; the shell adds nothing (Escape leaves). A form has its submit and nothing else.
    if (view.kind === "view") return view.spec?.actions ?? [];
    if (view.kind === "form") return [];
    if (current) {
      const isPalette = current.palette === PALETTES, isTip = current.palette === WELCOME;
      a.push(...(current.actions ?? [isPalette ? { ...OPEN, title: `Open ${current.name}` } : OPEN]));
      if (view.kind === "root" && !isPalette && !isTip) a.push({ id: BROWSE, title: `Browse ${titleOf(current.palette!)}`, icon: { kind: "glyph", value: "›" }, shortcut: "cmd+shift+b", section: "Navigate" });
      a.push({ id: DETAIL, title: showDetail ? "Hide details" : "Show details", shortcut: "cmd+i", section: "View" });
    }
    // An indexed level only: an input palette or a drill-in lists per keystroke anyway. A menu level's refresh renders its bar item again.
    if (onRefresh && (view.kind === "root" || (view.kind === "palette" && !scope?.input && args === undefined) || view.kind === "menu"))
      a.push({ id: REFRESH, title: view.kind === "root" ? "Refresh everything" : `Refresh ${view.kind === "menu" ? view.title : titleOf(view.palette)}`, icon: { kind: "glyph", value: "↻" }, shortcut: "cmd+r", section: "pal" });
    if (onSettings && view.kind === "root") a.push({ id: SETTINGS, title: "Open Settings", icon: { kind: "glyph", value: "⚙" }, shortcut: "cmd+,", section: "pal" });
    if (onWelcome && view.kind === "root" && !byKey.has(WELCOME)) a.push({ id: TIPS, title: "Show tips again", icon: { kind: "glyph", value: "?" }, section: "pal" });
    return a;
  }, [current, view, showDetail, byKey, onSettings, onRefresh, onWelcome, scope, args]);
  /** The actions on show: Enter and ⌘Enter are the first two of these, the footer and the panel list them; a `hidden` action only routes its key. */
  const listed = useMemo(() => actions.filter((a) => !a.hidden), [actions]);

  // The envelope's copy/open/hide are the caller's; the toast shows here, a
  // push/show opens its level, a view replaces the tree of the view level it
  // came from (the game loop) or opens one from a list, a form opens a form
  // level or, answering that form's submit, shows it again with its errors.
  // Any other answer to a submit closes the form first: the pick is done.
  const pickItem = (item: Item, action?: string, c: Ctx | undefined = ctx, submit = false) =>
    Promise.resolve(onPick(item, query, action, c)).then(
      (r) => {
        const e = (r ?? {}) as Effect;
        const top = level.current;
        if (submit && !e.form && top.kind === "form") pop();
        if (e.toast) setToast({ style: e.toast.style ?? "success", title: e.toast.title, message: e.toast.message });
        if (e.push) enter(sourceKey(e.push), e.push.args);
        if (e.show) push({ kind: "show", detail: { markdown: e.show.markdown, metadata: e.show.metadata }, title: e.show.title });
        if (e.view) {
          // The next tree of the view it came from, if that is still the level on top; else a fresh level.
          if (top.kind === "view" && top.palette === item.palette) nav.replace({ ...top, spec: e.view });
          else if (top.kind !== "view") push({ kind: "view", palette: item.palette!, spec: e.view });
        }
        if (e.form) {
          if (submit && top.kind === "form") nav.replace({ ...top, spec: toForm(e.form) });
          else push({ kind: "form", palette: item.palette!, args: c?.args, spec: toForm(e.form), from: item, key: ++formSeq.current });
        }
      },
      (e) => setToast({ style: "failure", title: "Failed", message: String(e) }),
    );

  /**
   * The form level's submit: a pick addressed to the form's `id` (else the
   * item it came from) with the submit action and the values in the ctx.
   * One at a time, as for a view.
   */
  const submitForm = (values: FormValues) => {
    if (view.kind !== "form" || busy) return;
    setBusy(true);
    const item: Item = { ...view.from, id: view.spec.id ?? view.from.id };
    pickItem(item, view.spec.submit.id, { ...ctx, values }, true).finally(() => setBusy(false));
  };
  /** Enter from outside the fields (the footer's hint): the form validates and submits as from inside. */
  const requestSubmit = () => formEl.current?.querySelector("form")?.requestSubmit();

  /**
   * A pick from the view level: addressed to the view's id with the action's
   * id. One at a time, and the search row sweeps meanwhile; a key pressed
   * while the tree is on its way waits in `queue` (`viewCommand`) and is
   * resolved against the tree the reply brings, so a "hit" typed a beat
   * early lands on the hand it was meant for, or on nothing if that hand
   * is over.
   */
  const pickView = (a: Action) => {
    if (view.kind !== "view" || !view.spec || busy) return;
    const s = byKey.get(view.palette);
    setBusy(true);
    const item: Item = { id: view.spec.id ?? VIEW_ID, name: view.spec.title ?? titleOf(view.palette), palette: view.palette, source: s && { extension: s.extension, palette: s.palette } };
    pickItem(item, a.id).finally(() => setBusy(false));
  };

  /**
   * A key in a view level: Enter and ⌘Enter are the first two listed
   * actions, a modifier combo the action carrying it, and with
   * `keys: "actions"` a bare key (`h`, `space`, `backspace`, `up`) too, any
   * of an action's shortcuts matching. While a pick is in flight the key
   * waits in `queue` (`VIEW_QUEUE` at most, the rest dropped) and is run by
   * the effect below once the reply's tree is in. Declined (`false`) when
   * no action carries the key.
   */
  const viewCommand = (cmd: ViewCommand): boolean | void => {
    if (view.kind !== "view" || !view.spec) return false;
    if (busy) { if (queue.current.length < VIEW_QUEUE) queue.current.push(cmd); return; }
    const a = cmd.type === "primary" ? listed[0]
      : cmd.type === "secondary" ? listed[1]
      : cmd.type === "shortcut" ? actions.find((x) => hasShortcut(x, cmd.combo))
      : view.spec.keys === "actions" ? actions.find((x) => hasShortcut(x, cmd.key)) : undefined;
    return a ? run(a) : false;
  };
  // The queue drains one key per settled tree; leaving the level, or landing on another, drops what was waiting.
  const levelKey = view.kind === "view" ? `${nav.depth}:${view.palette}` : null;
  const lastLevel = useRef(levelKey);
  useEffect(() => {
    if (lastLevel.current !== levelKey) { lastLevel.current = levelKey; queue.current.length = 0; return; }
    if (levelKey === null || busy || view.kind !== "view" || !view.spec) return;
    // A key no action carries any more (the hand is over) is dropped, and the next one tried.
    while (queue.current.length) if (viewCommand(queue.current.shift()!) !== false) break;
  });

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
      case SUBMENU: if (current && view.kind === "menu") push(menuLevel(view.key, current.name, view.submenus[current.id] ?? [])); break;
      default:
        if (view.kind === "view") return pickView(a);
        if (!current || current.disabled) return;
        // A palette row drills in; the pick only records the choice.
        if (current.palette === PALETTES) enter(current.id);
        pickItem(current, current.actions ? a.id : undefined);
    }
  };

  // The dropdown is a palette's own `filters`; the root has none (a palette is picked from the list instead).
  const filterSpec = view.kind === "palette" && scope?.filters?.length
    ? { options: scope.filters, value: scopeFilter!, onChange: (id: string) => { setPaletteFilter(id); cur.reset(); } }
    : undefined;

  /** In a show view the arrows scroll the text; a page is most of the view. */
  const scrollShow = (lines: number, page = false) => {
    const el = show.current;
    if (!el) return false;
    el.scrollBy({ top: page ? lines * el.clientHeight * 0.85 : lines * 40 });
  };

  /** In a menu level, any row's action carrying `combo` as its shortcut (a menu's shortcuts work from anywhere in it); the cursor moves to that row. */
  const menuShortcut = (combo: string): Action | undefined => {
    if (view.kind !== "menu") return undefined;
    const i = hits.findIndex((h) => !h.item.disabled && h.item.actions?.some((x) => hasShortcut(x, combo)));
    if (i < 0) return undefined;
    cur.set(i);
    return hits[i].item.actions![0];
  };

  useKeys(
    {
      move: ({ dir }) => {
        if (view.kind === "form") return false;
        if (view.kind === "view") return viewCommand({ type: "key", key: dir });
        if (view.kind === "show") return dir === "down" || dir === "up" ? scrollShow(dir === "down" ? 1 : -1) : false;
        if (dir === "left" || dir === "right") { if (!isGrid) return false; cur.move(dir === "right" ? 1 : -1); return; }
        cur.move((dir === "down" ? 1 : -1) * (isGrid ? (list.current?.columns() ?? columns) : 1));
      },
      jump: ({ to }) => {
        if (view.kind === "view" || view.kind === "form") return false;
        if (view.kind === "show") { const el = show.current; if (!el) return false; if (to === "home") el.scrollTo({ top: 0 }); else if (to === "end") el.scrollTo({ top: el.scrollHeight }); else scrollShow(to === "pageDown" ? 1 : -1, true); return; }
        if (to === "home") cur.set(0);
        else if (to === "end") cur.set(cur.last);
        else cur.move((to === "pageDown" ? 1 : -1) * (list.current?.pageSize() ?? 10));
      },
      jumpTo: ({ index }) => (view.kind !== "view" && view.kind !== "form" && index < hits.length ? cur.set(index) : false),
      // Enter and cmd+enter are a row's: with nothing under the cursor the shell's actions wait in the panel.
      // A form's fields take them first (Form's own scope); reaching here means focus is elsewhere, so the form is asked to submit.
      primary: () => (view.kind === "show" ? pop() : view.kind === "form" ? requestSubmit() : view.kind === "view" ? viewCommand({ type: "primary" }) : current && listed[0] ? run(listed[0]) : false),
      secondary: () => (view.kind === "form" ? requestSubmit() : view.kind === "view" ? viewCommand({ type: "secondary" }) : current && listed[1] ? run(listed[1]) : false),
      actions: () => (listed.length ? setActionsOpen(true) : false),
      escape: () => (query ? setQuery("") : nav.depth > 1 ? pop() : onHide()),
      back: () => (query || nav.depth === 1 ? false : pop()),
      // Without a filter, Tab is still swallowed: it would otherwise walk focus out of the input.
      filter: filterSpec ? ({ dir }) => {
        const o = filterSpec.options, i = o.findIndex((x) => x.id === filterSpec.value);
        filterSpec.onChange(o[(i + dir + o.length) % o.length].id);
      } : () => {},
      detail: () => (view.kind === "view" || view.kind === "form" ? false : setShowDetail((s) => !s)),
      shortcut: ({ combo }) => {
        if (combo === "cmd+," && onSettings) return onSettings();
        if (view.kind === "view") return viewCommand({ type: "shortcut", combo });
        const a = actions.find((x) => hasShortcut(x, combo)) ?? menuShortcut(combo);
        return a ? run(a) : false;
      },
      // A bare key in a menu level runs the row carrying it, while nothing is typed.
      key: ({ key }) => { if (isMenu && !query) { const a = menuShortcut(key); if (a) return run(a); } return view.kind === "view" ? viewCommand({ type: "key", key }) : false; },
    },
    { input },
  );

  const isShow = view.kind === "show";
  const showTitle = view.kind === "show" ? view.title ?? "Output" : "";
  const viewTitle = isView ? spec?.title ?? titleOf(view.palette) : form ? form.spec.title : "";
  const crumb = view.kind === "palette" || view.kind === "view" || view.kind === "form" ? { title: (view.kind === "view" && view.title) || titleOf(view.palette), icon: scope?.icon ? iconOf(scope.icon, scope.title) : undefined } : isShow ? { title: showTitle } : isMenu ? { title: view.title } : undefined;
  // The bottom level has nothing under it to go back to: its crumb is a title, not a button.
  const back = crumb && { ...crumb, onBack: nav.depth > 1 ? pop : undefined };
  const placeholder = view.kind === "root" ? "Search…" : view.kind === "show" || view.kind === "view" || view.kind === "form" ? "" : isMenu ? `Search ${view.title}…` : scope?.placeholder ?? `Search ${titleOf(view.palette)}…`;
  const onPickAt = (i: number) => { cur.set(i); const a = listed[0]; if (a) run(a); };
  const body = view.kind === "show"
    ? <div ref={show} className="pal-show" role="document" aria-label={showTitle}><Detail detail={view.detail} /></div>
    : view.kind === "view"
    ? (spec ? <View tree={spec.tree} label={viewTitle} autoFocus /> : null)
    : form
    // The title is the search row's (as for a view), so the form draws none of its own.
    ? <div ref={formEl} className="pal-form-level" aria-busy={busy || undefined}><Form key={form.key} fields={form.spec.fields} submitTitle={form.spec.submit.title} cancelTitle={form.spec.cancel} errors={form.spec.errors} onSubmit={submitForm} onCancel={pop} /></div>
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
      search={<Search value={query} onChange={setQuery} inputRef={input} back={back} filter={filterSpec} listId={isShow || isView || isForm ? undefined : LIST_ID} activeId={hits.length ? domId(LIST_ID, cur.cursor) : undefined} popup={isGrid ? "grid" : "listbox"} loading={loading} placeholder={placeholder} readOnly={isShow} title={isView || isForm ? viewTitle : undefined} />}
      aside={showDetail && !isShow && !isView && !isForm && (paneDetail ? <Detail detail={paneDetail} loading={paneLoading} /> : <Empty title="No details" />)}
      footer={
        <Footer
          icon={isShow ? undefined : isView || isForm ? (scope?.icon ? iconOf(scope.icon, scope.title) : undefined) : current?.icon}
          title={view.kind === "root" ? `${hits.length}${hits.length === LIMIT ? "+" : ""} of ${total}` : isShow ? showTitle : isView || isForm ? viewTitle : current?.name}
          note={updating && !isShow && !isView && !isForm && !isMenu ? "updating…" : undefined}
          primary={isShow ? { title: "Back" } : form ? { title: form.spec.submit.title, shortcut: submitKey } : (isView || current) && listed[0] ? { title: listed[0].title } : undefined}
          actions={listed.length > 0}
          onPrimary={() => (isShow ? pop() : form ? requestSubmit() : isView ? viewCommand({ type: "primary" }) : current && listed[0] && run(listed[0]))}
          onActions={() => setActionsOpen(true)}
        />
      }
      overlay={
        <>
          <Presence show={!!toast} dur="base">{toast && <Toast toast={toast} />}</Presence>
          <Presence show={actionsOpen}><ActionPanel actions={actions} onRun={run} onClose={closeActions} title={isView ? viewTitle : current?.name} /></Presence>
          <Presence show={!!confirming}>{confirming && <Confirm title={confirming.confirm!} action={confirming.title} destructive={confirming.style === "destructive"} onConfirm={() => run(confirming, true)} onCancel={closeConfirm} />}</Presence>
        </>
      }
    >
      {body}
    </Panel>
  );
});
