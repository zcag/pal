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
import type { Action, Item, Match } from "./ui/types";
import { PALETTES, iconOf, sourceKey, type Effect, type SourceInfo } from "./items";
import { paletteTitle } from "./fixtures";

export const LIMIT = 200;
const GRID_COLUMNS = 8;
const LIST_ID = "results";
/** Fixture palettes (the gallery) best browsed as tiles; a real palette declares `view` itself. */
const gridFixtures = new Set(["emoji", "iconnerd", "chars", "colors"]);
/** The shell's own actions, kept apart from an item's by the prefix. */
const BROWSE = "pal:browse", DETAIL = "pal:detail", SETTINGS = "pal:settings";
const OPEN: Action = { id: "open", title: "Open" };

/** A palette view is keyed by `sourceKey`. */
type View = { kind: "root" } | { kind: "palette"; palette: string };

export type LauncherHandle = { reset(): void; /** Straight into a palette (its `sourceKey`), from a palette hotkey. */ open(palette: string): void };

export type LauncherProps = {
  /** Palettes in the index, load order; empty until the host has listed one. */
  sources?: SourceInfo[];
  /** Top hits for `q`, over one palette or all of them. */
  search?: (q: string, scope?: SourceInfo) => Promise<Hit[]>;
  /** Bumped when the index or the ranking changed underneath; re-runs the search. */
  version?: number;
  /** Gallery only: search these in the webview instead of `sources`/`search`. */
  items?: Item[];
  /** `action` is the item's own action id; absent for the default action of an item that declares none. */
  onPick: (item: Item, query: string, action?: string) => void | Promise<unknown>;
  onHide: () => void;
  /** Opens the settings window; the action is only offered when given. */
  onSettings?: () => void;
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

/** In-webview fzf over `items`, shaped like the core's `sources`/`search` pair. Fixture rows carry a bare palette name, so that is the key. */
function useLocalSearch(items: Item[] = []) {
  const sources = useMemo<SourceInfo[]>(() => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.palette!, (counts.get(i.palette!) ?? 0) + 1);
    return [...counts].map(([palette, count]) => ({ extension: "", palette, title: paletteTitle(palette), live: false, input: false, view: gridFixtures.has(palette) ? "grid" as const : undefined, count }));
  }, [items]);
  const fzf = useMemo(() => new Fzf(items, { selector: haystack, limit: LIMIT }), [items]);
  const search = useCallback(async (q: string, scope?: SourceInfo): Promise<Hit[]> => {
    const inScope = (i: Item) => !scope || i.palette === scope.palette;
    if (!q) return items.filter(inScope).slice(0, LIMIT).map((item) => ({ item }));
    return fzf.find(q).filter((r) => inScope(r.item)).map((r) => ({ item: r.item, match: splitMatch(r.item, r.positions) }));
  }, [items, fzf]);
  return { sources, search };
}

export const Launcher = forwardRef<LauncherHandle, LauncherProps>(function Launcher(props, ref) {
  const { version = 0, onPick, onHide, onSettings, mark } = props;
  const local = useLocalSearch(props.items);
  const sources = props.sources ?? local.sources;
  const search = props.search ?? local.search;
  const nav = useNavStack<View>({ kind: "root" });
  const { view, query } = nav;
  const [filter, setFilter] = useState("all");
  const [showDetail, setShowDetail] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const [found, setFound] = useState<Hit[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<ListHandle>(null);
  const keyAt = useRef(0);
  const seq = useRef(0);

  const byKey = useMemo(() => new Map(sources.map((s) => [sourceKey(s), s])), [sources]);
  const titleOf = (key: string) => byKey.get(key)?.title ?? key;
  const scopeKey = view.kind === "palette" ? view.palette : filter === "all" ? null : filter;
  const scope = scopeKey ? byKey.get(scopeKey) : undefined;
  const loading = sources.length === 0;
  // The palette rows are not items to count, and an input palette has none to filter by.
  const filterable = sources.filter((s) => sourceKey(s) !== PALETTES && !s.input);
  const total = scope ? scope.count : filterable.reduce((n, s) => n + s.count, 0);

  // Replies can land out of order (a slow one behind a fast one): only the
  // latest request's answer is shown.
  useEffect(() => {
    const n = ++seq.current;
    search(query, scope).then((h) => { if (n === seq.current) setFound(h); });
  }, [search, query, scopeKey, view.kind, version]);

  // At the root, palettes are the sections; inside one, the palette's own sections are.
  const hits = useMemo(() => (view.kind === "root" ? groupBySection(found.map((h) => ({ ...h, item: { ...h.item, section: titleOf(h.item.palette!) } }))) : groupBySection(found)), [found, view.kind, byKey]);

  const cur = useCursor(hits.length);
  const current: Item | undefined = hits[cur.cursor]?.item;
  // A palette that asks for it opens with the pane; leaving resets. cmd+i still toggles.
  useEffect(() => setShowDetail(view.kind === "palette" && !!byKey.get(view.palette)?.detail), [view]);
  const isGrid = view.kind === "palette" && scope?.view === "grid";
  const columns = scope?.columns ?? GRID_COLUMNS;

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
  const push = (v: View) => { nav.push(v); cur.reset(); };
  const pop = () => { nav.pop(); cur.reset(); };
  const closeActions = () => { setActionsOpen(false); focus(); };
  const closeConfirm = () => { setConfirming(null); focus(); };
  const reset = useCallback(() => { nav.reset(); cur.reset(); setActionsOpen(false); setConfirming(null); setToast(null); input.current?.focus(); }, [nav.reset, cur.reset]);
  const open = useCallback((palette: string) => { reset(); nav.push({ kind: "palette", palette }); }, [reset, nav.push]);
  useImperativeHandle(ref, () => ({ reset, open }), [reset, open]);

  // The item's own actions first (the default "Open" when it declares none), then the shell's.
  const actions = useMemo<Action[]>(() => {
    if (!current) return [];
    const isPalette = current.palette === PALETTES;
    const a: Action[] = current.actions ? [...current.actions] : [isPalette ? { ...OPEN, title: `Open ${current.name}` } : OPEN];
    if (view.kind === "root" && !isPalette) a.push({ id: BROWSE, title: `Browse ${titleOf(current.palette!)}`, icon: { kind: "glyph", value: "›" }, shortcut: "cmd+shift+b", section: "Navigate" });
    a.push({ id: DETAIL, title: showDetail ? "Hide details" : "Show details", shortcut: "cmd+i", section: "View" });
    if (onSettings && view.kind === "root") a.push({ id: SETTINGS, title: "Open Settings", icon: { kind: "glyph", value: "⚙" }, shortcut: "cmd+,", section: "pal" });
    return a;
  }, [current, view.kind, showDetail, byKey, onSettings]);

  // The envelope's copy/open/hide are the caller's; the toast shows here.
  const pickItem = (item: Item, action?: string) =>
    Promise.resolve(onPick(item, query, action)).then(
      (r) => { const t = (r as Effect | undefined)?.toast; if (t) setToast({ style: t.style ?? "success", title: t.title, message: t.message }); },
      (e) => setToast({ style: "failure", title: "Failed", message: String(e) }),
    );

  /** `confirmed`: the user already said yes to `a.confirm`. */
  const run = (a: Action, confirmed = false) => {
    if (!current) return;
    setActionsOpen(false);
    if (a.confirm && !confirmed) return setConfirming(a);
    setConfirming(null);
    focus();
    switch (a.id) {
      case BROWSE: push({ kind: "palette", palette: current.palette! }); break;
      case DETAIL: setShowDetail((s) => !s); break;
      case SETTINGS: onSettings?.(); break;
      default:
        // A palette row drills in; the pick only records the choice.
        if (current.palette === PALETTES) push({ kind: "palette", palette: current.id });
        pickItem(current, current.actions ? a.id : undefined);
    }
  };

  const filterSpec = view.kind === "root"
    ? { options: [{ id: "all", title: "All" }, ...filterable.map((s) => ({ id: sourceKey(s), title: s.title }))], value: filter, onChange: (id: string) => { setFilter(id); cur.reset(); } }
    : undefined;

  useKeys(
    {
      move: ({ dir }) => {
        if (dir === "left" || dir === "right") { if (!isGrid) return false; cur.move(dir === "right" ? 1 : -1); return; }
        cur.move((dir === "down" ? 1 : -1) * (isGrid ? columns : 1));
      },
      jump: ({ to }) => {
        if (to === "home") cur.set(0);
        else if (to === "end") cur.set(cur.last);
        else cur.move((to === "pageDown" ? 1 : -1) * (list.current?.pageSize() ?? 10));
      },
      jumpTo: ({ index }) => (index < hits.length ? cur.set(index) : false),
      primary: () => (actions[0] ? run(actions[0]) : false),
      secondary: () => (actions[1] ? run(actions[1]) : false),
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

  const back = view.kind === "palette" ? { title: titleOf(view.palette), icon: scope?.icon ? iconOf(scope.icon, scope.title) : undefined, onBack: pop } : undefined;
  const placeholder = view.kind === "root" ? "Search…" : scope?.placeholder ?? `Search ${titleOf(view.palette)}…`;
  const onPickAt = (i: number) => { cur.set(i); const a = actions[0]; if (a) run(a); };
  const body = !hits.length
    ? <Empty icon={{ kind: "glyph", value: "⌕" }} title={query ? "No results" : loading ? "Loading…" : "Nothing here"} hint={query && !scope?.input ? "Try a different search" : undefined} />
    : isGrid
      ? <Grid ref={list} id={LIST_ID} hits={hits} cursor={cur.cursor} onCursor={cur.set} onPick={onPickAt} columns={columns} />
      : <List ref={list} id={LIST_ID} hits={hits} cursor={cur.cursor} onCursor={cur.set} onPick={onPickAt} />;

  return (
    <Panel
      search={<Search value={query} onChange={setQuery} inputRef={input} back={back} filter={filterSpec} listId={LIST_ID} activeId={hits.length ? domId(LIST_ID, cur.cursor) : undefined} popup={isGrid ? "grid" : "listbox"} loading={loading} placeholder={placeholder} />}
      aside={showDetail && (current?.detail ? <Detail detail={current.detail} /> : <Empty title="No details" />)}
      footer={
        <Footer
          icon={current?.icon}
          title={view.kind === "root" ? `${hits.length}${hits.length === LIMIT ? "+" : ""} of ${total}` : current?.name}
          primary={actions[0] && { title: actions[0].title }}
          actions={actions.length > 0}
          onPrimary={() => actions[0] && run(actions[0])}
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
