/**
 * The shell composed from the UI kit: root search over every item, palette
 * drill-downs, detail pane, action panel, toasts. Nothing in here touches
 * Tauri; App wires the feed, the hide command and the timing marks.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Fzf } from "fzf";
import {
  ActionPanel, Detail, Empty, Footer, Grid, List, Panel, Search, Toast,
  groupBySection, domId, useCursor, useKeys, useNavStack, type Hit, type ListHandle, type ToastSpec,
} from "./ui";
import type { Action, Item, Match } from "./ui/types";
import { gridPalettes, paletteTitle } from "./fixtures";

const LIMIT = 200;
const GRID_COLUMNS = 8;
const LIST_ID = "results";

type View = { kind: "root" } | { kind: "palette"; palette: string };

export type LauncherHandle = { reset(): void };

export type LauncherProps = {
  items: Item[];
  loading?: boolean;
  onPick: (item: Item) => void;
  onHide: () => void;
  mark?: (name: string, t: number) => void;
};

const haystack = (i: Item) => [i.name, i.subtitle, ...(i.keywords ?? [])].filter(Boolean).join(" ");

/** fzf positions index the haystack; map them back onto name and subtitle. */
function splitMatch(item: Item, positions: Set<number>): Match {
  const name = new Set<number>(), subtitle = new Set<number>();
  const subStart = item.name.length + 1;
  for (const p of positions) {
    if (p < item.name.length) name.add(p);
    else if (item.subtitle && p >= subStart && p < subStart + item.subtitle.length) subtitle.add(p - subStart);
  }
  return { name, subtitle };
}

export const Launcher = forwardRef<LauncherHandle, LauncherProps>(function Launcher({ items, loading, onPick, onHide, mark }, ref) {
  const nav = useNavStack<View>({ kind: "root" });
  const { view, query } = nav;
  const [filter, setFilter] = useState("all");
  const [showDetail, setShowDetail] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [toast, setToast] = useState<ToastSpec | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<ListHandle>(null);
  const keyAt = useRef(0);

  const palettes = useMemo(() => [...new Set(items.map((i) => i.palette!))], [items]);
  const scope = view.kind === "palette" ? view.palette : filter === "all" ? null : filter;
  const scoped = useMemo(() => (scope ? items.filter((i) => i.palette === scope) : items), [items, scope]);
  const fzf = useMemo(() => new Fzf(scoped, { selector: haystack, limit: LIMIT }), [scoped]);
  const hits = useMemo<Hit[]>(() => {
    const found = query ? fzf.find(query).map((r) => ({ item: r.item, match: splitMatch(r.item, r.positions) })) : scoped.slice(0, LIMIT).map((item) => ({ item }));
    // At the root, palettes are the sections; inside one, the palette's own sections are.
    return view.kind === "root" ? groupBySection(found.map((h) => ({ ...h, item: { ...h.item, section: paletteTitle(h.item.palette!) } }))) : groupBySection(found);
  }, [fzf, scoped, query, view]);

  const cur = useCursor(hits.length);
  const current: Item | undefined = hits[cur.cursor]?.item;
  const isGrid = view.kind === "palette" && gridPalettes.has(view.palette);

  useLayoutEffect(() => {
    if (!keyAt.current) return;
    const t = keyAt.current;
    keyAt.current = 0;
    requestAnimationFrame(() => mark?.(`key->paint "${query}" (${hits.length}) ms`, performance.now() - t));
  }, [query, hits.length, mark]);

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
  const reset = useCallback(() => { nav.reset(); cur.reset(); setActionsOpen(false); setToast(null); input.current?.focus(); }, [nav.reset, cur.reset]);
  useImperativeHandle(ref, () => ({ reset }), [reset]);

  const actions = useMemo<Action[]>(() => {
    if (!current) return [];
    const a: Action[] = [
      { id: "open", title: "Open", icon: { kind: "glyph", value: "↗" } },
      { id: "copy", title: "Copy name", icon: { kind: "glyph", value: "⎘" }, shortcut: "cmd+c" },
    ];
    if (view.kind === "root") a.push({ id: "browse", title: `Browse ${paletteTitle(current.palette!)}`, icon: { kind: "glyph", value: "›" }, shortcut: "cmd+shift+b", section: "Navigate" });
    a.push({ id: "detail", title: showDetail ? "Hide details" : "Show details", shortcut: "cmd+i", section: "View" });
    if (current.palette === "tabs") a.push({ id: "close", title: "Close tab", shortcut: "cmd+shift+w", style: "destructive", section: "Tab" });
    return a;
  }, [current, view.kind, showDetail]);

  const run = (a: Action) => {
    if (!current) return;
    setActionsOpen(false);
    focus();
    switch (a.id) {
      case "open": onPick(current); break;
      case "copy":
        Promise.resolve().then(() => navigator.clipboard.writeText(current.name)).then(
          () => setToast({ style: "success", title: "Copied", message: current.name }),
          () => setToast({ style: "failure", title: "Copy failed" }),
        );
        break;
      case "browse": push({ kind: "palette", palette: current.palette! }); break;
      case "detail": setShowDetail((s) => !s); break;
      case "close": setToast({ style: "animated", title: "Closing tab…" }); break;
    }
  };

  const filterSpec = view.kind === "root"
    ? { options: [{ id: "all", title: "All" }, ...palettes.map((p) => ({ id: p, title: paletteTitle(p) }))], value: filter, onChange: (id: string) => { setFilter(id); cur.reset(); } }
    : undefined;

  useKeys(
    {
      move: ({ dir }) => {
        if (dir === "left" || dir === "right") { if (!isGrid) return false; cur.move(dir === "right" ? 1 : -1); return; }
        cur.move((dir === "down" ? 1 : -1) * (isGrid ? GRID_COLUMNS : 1));
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
      filter: filterSpec && (({ dir }) => {
        const o = filterSpec.options, i = o.findIndex((x) => x.id === filterSpec.value);
        filterSpec.onChange(o[(i + dir + o.length) % o.length].id);
      }),
      detail: () => setShowDetail((s) => !s),
      shortcut: ({ combo }) => { const a = actions.find((x) => x.shortcut === combo); return a ? run(a) : false; },
    },
    { input },
  );

  const back = view.kind === "palette" ? { title: paletteTitle(view.palette), onBack: pop } : undefined;
  const body = !hits.length
    ? <Empty icon={{ kind: "glyph", value: "⌕" }} title={query ? "No results" : loading ? "Loading…" : "Nothing here"} hint={query ? "Try a different search" : undefined} />
    : isGrid
      ? <Grid ref={list} id={LIST_ID} hits={hits} cursor={cur.cursor} onCursor={cur.set} onPick={(i) => onPick(hits[i].item)} columns={GRID_COLUMNS} />
      : <List ref={list} id={LIST_ID} hits={hits} cursor={cur.cursor} onCursor={cur.set} onPick={(i) => onPick(hits[i].item)} />;

  return (
    <Panel
      search={<Search value={query} onChange={setQuery} inputRef={input} back={back} filter={filterSpec} listId={LIST_ID} activeId={hits.length ? domId(LIST_ID, cur.cursor) : undefined} loading={loading} placeholder={view.kind === "root" ? "Search…" : `Search ${paletteTitle(view.palette)}…`} />}
      aside={showDetail && (current?.detail ? <Detail detail={current.detail} /> : <Empty title="No details" />)}
      footer={
        <Footer
          icon={current?.icon}
          title={view.kind === "root" ? `${hits.length}${hits.length === LIMIT ? "+" : ""} of ${scoped.length}` : current?.name}
          primary={actions[0] && { title: actions[0].title }}
          actions={actions.length > 0}
          onPrimary={() => actions[0] && run(actions[0])}
          onActions={() => setActionsOpen(true)}
        />
      }
      overlay={
        <>
          {toast && <Toast toast={toast} />}
          {actionsOpen && <ActionPanel actions={actions} onRun={run} onClose={closeActions} title={current?.name} />}
        </>
      }
    >
      {body}
    </Panel>
  );
});
