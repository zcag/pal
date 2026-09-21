/**
 * The shell composed from the UI kit: root search over every item, palette
 * drill-downs, detail pane, action panel, toasts. Nothing in here touches
 * Tauri; App wires the index queries, the pick and hide commands and the
 * timing marks.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionPanel, Confirm, Detail, Empty, Footer, Form, Grid, Icon, List, Panel, Presence, Search, Toast, View, keepFocus,
  groupBySection, domId, graphemePositions, hasShortcut, isMac, shiftedArrow, useCursor, useKeys, useNavStack, useSubmitKey, type Command, type Hit, type ListHandle, type ToastSpec,
  isMarked, mark as markRow, markable, multiActions, pickIds, toggle, type Selection,
} from "./ui";
import { Fzf } from "fzf";
import type { Action, Detail as DetailSpec, FormSpec, FormValues, Item, Match, ViewNode, ViewSpec } from "./ui/types";
import { ASK_ID, ATTENTION, FALLBACK, FREQUENT, PALETTES, RECENT_FILES, WELCOME, iconOf, sourceKey, toForm, toView, type Ctx, type Effect, type SourceInfo } from "./items";
import { linkFor } from "./links";
import { SUBMENU, menuRows, type BarMenuNode } from "./bar";
import { paletteTitle } from "./fixtures";

export const LIMIT = 200;
/** `pal_core::dialog::Dialog`: the file panel in front, for the root's hint. */
export type DialogInfo = { app: string; pid: number; kind: "open" | "save"; title?: string | null };
/** The palette the Dialog hint opens: its rows carry "Use in dialog" while a panel is up. */
const FILES = "files/files";
/** The empty root's hint row while a file dialog is up: Enter opens Files (a push, nothing picked). */
export const dialogHit = (d: DialogInfo): Hit => ({
  item: { id: "pal:dialog", name: `Type a path for the ${d.kind} panel of ${d.app}`, subtitle: "Enter opens Files; a file or folder row there has Use in dialog", icon: { kind: "glyph", value: "\u{f0770}" }, palette: FILES, group: "Dialog", push: { extension: "files", palette: "files" } },
});
const GRID_COLUMNS = 8;
const LIST_ID = "results";
/** Fixture palettes (the gallery) best browsed as tiles; a real palette declares `view` itself. */
const gridFixtures = new Set(["emoji", "iconnerd", "chars", "colors"]);
/** The shell's own actions, kept apart from an item's by the prefix. */
const BROWSE = "pal:browse", DETAIL = "pal:detail", SETTINGS = "pal:settings", REFRESH = "pal:refresh", TIPS = "pal:welcome", LINK = "pal:link", FORGET = "pal:forget", CLEAR = "pal:clear", COMPACT = "pal:compact";
const OPEN: Action = { id: "open", title: "Open" };
/** After the last keystroke at the root, before the inline and fallback sections are asked for (the local hits paint first; a keystroke inside this cancels the ask). */
const ROOT_DEBOUNCE = 120;
/** Synthetic sources (`pal/*`) never carry a ranking to reset and are not palettes to jump into. */
const isShell = (key: string) => key.startsWith("pal/");

/** What the Launcher reads of `[general]` (`usePrefs` in core.ts); the defaults are the config's. */
export type Prefs = {
  /** `alias_space`: a palette's alias (or name, or one-word title) and a space jump into it. */
  aliasSpace: boolean;
  /** `backspace_back`: Backspace with nothing typed goes back a level, after the row's own Backspace action. */
  backspaceBack: boolean;
  /** `fallbacks_always`: the fallback rows under the hits too, not only when nothing matched. */
  fallbacksAlways: boolean;
  /** `search_history`: Up at the top of an empty root recalls the last queries. */
  searchHistory: boolean;
  /** `now`: the palette ids whose `suggest()` rows lead the empty root, in order. */
  now: string[];
  /** `compact`: the narrow panel (560 px, 32 px rows), no detail pane, the footer folded into the search row. */
  compact: boolean;
};
const DEFAULT_PREFS: Prefs = { aliasSpace: true, backspaceBack: true, fallbacksAlways: false, searchHistory: true, now: [], compact: false };

/**
 * The palette a typed word names for the alias-and-space jump: its config
 * alias first, else its palette name, else its title (one word, any case),
 * each only when exactly one palette answers to it. Never a shell source
 * or a view palette (nothing to type into).
 */
export function aliasTarget(sources: SourceInfo[], word: string): SourceInfo | undefined {
  const w = word.trim().toLowerCase();
  if (!w) return undefined;
  const real = sources.filter((s) => !isShell(sourceKey(s)) && s.view !== "view");
  const one = (pick: (s: SourceInfo) => boolean) => { const m = real.filter(pick); return m.length === 1 ? m[0] : undefined; };
  const exact = one((s) => s.alias?.toLowerCase() === w) ?? one((s) => s.palette.toLowerCase() === w) ?? one((s) => s.title.toLowerCase() === w);
  if (exact) return exact;
  // An extension's name reaches its search: `tela ` opens tela's input palette with live results (the one input palette, else its one palette).
  const ofExt = (name: string) => { const ext = real.filter((s) => s.extension.toLowerCase() === name); const inp = ext.filter((s) => s.input); return inp.length === 1 ? inp[0] : ext.length === 1 ? ext[0] : undefined; };
  const byName = ofExt(w);
  if (byName) return byName;
  // A prefix of two letters or more that only one target answers to (`em ` for Emoji, `tel ` for tela's search): a palette by alias, name or title, or an extension by name.
  if (w.length < 2) return undefined;
  const targets = new Set<SourceInfo>(real.filter((s) => [s.alias, s.palette, s.title].some((t) => t?.toLowerCase().startsWith(w))));
  // An extension whose name starts with the word stands for its search, ahead of its own palettes (`tel ` is tela's search, not "tela Pages").
  for (const name of new Set(real.map((s) => s.extension.toLowerCase()))) {
    if (!name.startsWith(w)) continue;
    for (const t of targets) if (t.extension.toLowerCase() === name) targets.delete(t);
    const t = ofExt(name);
    if (t) targets.add(t);
  }
  return targets.size === 1 ? [...targets][0] : undefined;
}

/**
 * The root's rows in order. Typed: the inline sections (each under its
 * palette's title), the index's hits (under their palettes), then the
 * fallback rows (only with nothing else, unless `always`). Empty: the
 * welcome tips, what needs attention (a failed extension), the
 * extensions' suggestions ("Now", "Clipboard"), the Frequent rows, the
 * recently used files, then the rest as the core ordered it. A row's
 * `group` is its section; else its palette's title.
 */
export function rootHits(query: string, found: Hit[], inline: Hit[], fallback: Hit[], suggested: Hit[], always: boolean, titleOf: (key: string) => string): Hit[] {
  const label = (h: Hit): Hit => ({ ...h, item: { ...h.item, section: h.item.group ?? titleOf(h.item.palette!) } });
  if (query) {
    const rows = [...inline, ...found];
    return [...rows, ...(rows.length === 0 || always ? fallback : [])].map(label);
  }
  const welcome = found.filter((h) => h.item.palette === WELCOME);
  const rest = found.filter((h) => h.item.palette !== WELCOME);
  const attention = rest.filter((h) => h.item.group === ATTENTION);
  const frequent = rest.filter((h) => h.item.group === FREQUENT);
  const recent = rest.filter((h) => h.item.group !== FREQUENT && h.item.palette === RECENT_FILES);
  const others = rest.filter((h) => h.item.group !== FREQUENT && h.item.group !== ATTENTION && h.item.palette !== RECENT_FILES);
  return [...welcome, ...attention, ...suggested, ...frequent, ...recent, ...others].map(label);
}

/**
 * A palette level is keyed by `sourceKey`; `args` when an `Effect.push`
 * opened it (its rows come from the extension, listed with them). A show
 * level is a detail to read, nothing to search. A view level is a render
 * tree from a view palette: `spec` is absent while the tree is on its way,
 * and every pick from it usually brings the next one. A form level is an
 * `Effect.form` from a pick on `from` with `action`: its submit is a pick
 * on that item (or the form's own `id`) carrying the values; `key` tells
 * one form from the next at the same depth, so the fields never keep a
 * gone form's text.
 * A menu level is a bar item's `nodes` menu (`bar.ts`): its rows are
 * fixed, filtered by the query, a submenu row pushes another; a pick is
 * the row's action on the item (`palette` is the item's key, no source).
 * With `pick` it is `pal pick`'s picker (`pickLevel`): the same fixed rows,
 * Enter answers `onPickReply` with the row's id (or every marked one when
 * `multi`) and nothing is picked from an extension.
 */
export type Level =
  | { kind: "root" }
  | { kind: "palette"; palette: string; args?: unknown; /** The crumb, when the push named one (`Effect.push.title`: the folder being browsed). */ title?: string }
  | { kind: "show"; detail: DetailSpec; title?: string; /** The palette the shown item came from: its tile in the crumb and the footer. */ palette?: string }
  | { kind: "view"; palette: string; args?: unknown; spec?: ViewSpec; /** The crumb, when `palette` is not a source (a bar item's key). */ title?: string }
  | { kind: "form"; palette: string; args?: unknown; spec: FormSpec; from: Item; action?: string; key: number; /** The row's typed arguments (`Item.args`) in the search bar, not a form page. */ inline?: true }
  | { kind: "menu"; key: string; title: string; rows: Item[]; submenus: Record<string, BarMenuNode[]>; pick?: { token: number; multi: boolean } };

/** A menu level for a bar item's `nodes`. */
export const menuLevel = (key: string, title: string, nodes: BarMenuNode[]): Level => ({ kind: "menu", key, title, ...menuRows(key, nodes) });
/** The key the picker's rows carry as their palette (no source: nothing is picked from an extension). */
export const PICK = "pick";
/** One row of `pal pick` as the core relays it (`Row` in pick.rs). */
export type PickRow = { id: string; name: string; subtitle?: string; icon?: unknown };
/** A picker level for `pal pick` (pick.rs): the rows as given, one Pick action each (a multi one, so marked rows go together). */
export const pickLevel = (token: number, title: string, rows: PickRow[], multi: boolean): Level => ({
  kind: "menu", key: PICK, title, submenus: {}, pick: { token, multi },
  rows: rows.map((r) => ({ id: String(r.id), name: String(r.name ?? r.id), subtitle: r.subtitle, icon: iconOf(r.icon, String(r.name ?? r.id)), palette: PICK, actions: [{ id: "pick", title: "Pick", multi: true }] })),
});
/** The item a pick from a view level is addressed to: the view's `id`, else this. */
const VIEW_ID = "view";
/**
 * The view level on top, as the shell is told (`onViewOpen`, `ViewShown`
 * in the SDK): a view palette's by its source, a bar item's own `{ view }`
 * level by the item's id; `id` is the tree's `View.id` (`view` unless set).
 */
export type ViewOpen = { extension: string; palette?: string; bar?: string; id: string };
/** A push for an open view level (`ViewUpdate` in the SDK, `pal://view`): a whole `ViewSpec`, or `{ tree }` alone with the level's actions, title and input kept. */
export type ViewUpdate = { extension: string; palette?: string | null; bar?: string | null; id?: string | null; spec: ViewSpec | { tree: ViewNode } };
/** A bar item's own level (BarPage's `levelOf`) keys its `palette` as `bar:ext/item`: a source key is `ext/palette`, and an extension may name a bar item after one of its palettes (github's prs, issues, notifications), so the bare key would resolve to the palette and a pick would go there. */
export const barKey = (key: string) => `bar:${key}`;
/** The bar item a level's `palette` key names, when it is one. */
const barOf = (key: string): { extension: string; bar: string } | undefined => { if (!key.startsWith("bar:")) return; const k = key.slice(4), i = k.indexOf("/"); return i > 0 ? { extension: k.slice(0, i), bar: k.slice(i + 1) } : undefined; };
/** Keys a view level holds while a pick is on its way, at most; a fast typist's letters, not a held key. */
const VIEW_QUEUE = 4;
/** What a view level does with a key, queued while a pick is in flight and run against the tree the reply brings; `submit` and `cancel` are the `View.input` field's Enter and Escape. */
type ViewCommand = Extract<Command, { type: "primary" | "secondary" | "shortcut" | "key" }> | { type: "submit" } | { type: "cancel" } | { type: "action"; id: string; values?: FormValues };

/** After the cursor rests on a lazy item: wait this long before asking, and this much longer before the skeleton shows. */
const DETAIL_DEBOUNCE = 100, DETAIL_SKELETON_AFTER = 150;

export type LauncherHandle = {
  reset(): void;
  /** Straight into a palette (its `sourceKey`), from a palette hotkey. */
  open(palette: string): void;
  /** The search box set to `q` at the current level (a `pal://open` link's `?q=`). */
  type(q: string): void;
  /** The palette level's filter set to `id` (a `pal://open` link's `?filter=`); nothing outside a palette with filters. */
  filter(id: string): void;
  /** A pick's answer from elsewhere (a `pal://run` or `pal://<ext>/<route>` link, deeplink.rs `deliver`): applied as if `item` had been picked here, at a level opened with `args`. */
  apply(item: Item, effect: Effect, args?: unknown): void;
  /** A toast from outside a pick (a `pal://toast` link while the panel is up). */
  toast(spec: ToastSpec): void;
  /** Focus back on the search box (after a card outside the Launcher closes). */
  focus(): void;
  /** The bottom level swapped for `level` (the bar popover opening on an item): the stack dropped, or kept with only the bottom replaced (`inPlace`, the item rendered again while showing). */
  start(level: Level, inPlace?: boolean): void;
  /** The panel was shown again where it was (pop to root kept the level): what depends on the moment is asked again (the Now section, the history). */
  shown(): void;
  /** A push for a view level (`pal://view`): the level of that source (and `id`, when given) anywhere in the stack takes the spec in place; nothing when there is none. */
  update(u: ViewUpdate): void;
  /** A trigger fired (`pal://trigger`): a view level on top whose palette lists it under `on` asks for its tree again. */
  trigger(name: string): void;
};

export type LauncherProps = {
  /** Palettes in the index, load order; empty until the host has listed one. */
  sources?: SourceInfo[];
  /** Top hits for `q`, over one palette or all of them; `ctx` is the level's filter and args. */
  search?: (q: string, scope?: SourceInfo, ctx?: Ctx) => Promise<Hit[]>;
  /** The root's inline rows for `q` (the palettes whose `match` accepts it), each row's `group` its palette's title; asked after the local hits, debounced. */
  inline?: (q: string) => Promise<Hit[]>;
  /** The root's fallback rows for `q`, ordered and grouped by the core; shown when nothing else matched (or always, `prefs.fallbacksAlways`). */
  fallback?: (q: string) => Promise<Hit[]>;
  /** The empty root's suggestions (the extensions' `suggest()`), each row's `group` its section; asked on every show of the empty root. */
  suggest?: (now: string[]) => Promise<Hit[]>;
  /** The search history, newest first, for Up at the top of an empty root. */
  history?: () => Promise<string[]>;
  /** The open or save panel the app in front has up (`dialog_detect`), asked with the suggestions: the empty root's "Dialog" hint leads into Files. */
  dialog?: () => Promise<DialogInfo | null>;
  /** "Reset ranking for this item": forgets the row's frecency; resolves to whether there was any. The action is only offered when given. */
  onForget?: (item: Item) => Promise<boolean> | boolean;
  /** `[general]` as it bears on the panel; the defaults when absent. */
  prefs?: Prefs;
  /** The rest of a lazy item's detail (`Item.lazyDetail`), merged over the inline one. */
  detail?: (item: Item, ctx?: Ctx) => Promise<DetailSpec>;
  /** The tree a view palette (`SourceInfo.view === "view"`) opens with; asked again every `SourceInfo.refresh` seconds and on its `on` triggers while the level is on top. */
  view?: (scope: SourceInfo, ctx?: Ctx) => Promise<ViewSpec>;
  /** The view level on top changed (pushed, popped, covered, its tree landed): what it is now, or null. The shell tells the extension (`view/shown`, `view/hidden`) and routes pushes by it. */
  onViewOpen?: (open: ViewOpen | null) => void;
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
  /** Copies a `pal://` link for what is on screen (the "Copy deep link" action, `links.ts`); the action is only offered when given. */
  onLink?: (link: string) => void;
  /** `pal pick`'s answer (a `pickLevel`): the chosen ids, or `null` for Escape. */
  onPickReply?: (token: number, ids: string[] | null) => void;
  /** Flips `general.compact` (cmd+shift+m, the "Compact mode" action); the action is only offered when given. */
  onCompact?: () => void;
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
  const { version = 0, onPick, onHide, onSettings, onRefresh, onWelcome, onLink, onForget, onPickReply, onCompact, mark } = props;
  const prefs = props.prefs ?? DEFAULT_PREFS;
  /** Compact: no detail pane (cmd+i is inert), the footer's primary hint sits in the search row instead. */
  const compact = prefs.compact;
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
  /** The marked rows (`selection.ts`): one palette's ids, kept across queries, dropped on a level change and after the pick that used them. */
  const [sel, setSel] = useState<Selection | null>(null);
  /** The root's inline and fallback rows for `key` (the query they answer); stale for any other query. */
  const [extra, setExtra] = useState<{ key: string; inline: Hit[]; fallback: Hit[] }>({ key: "", inline: [], fallback: [] });
  /** The empty root's suggestions, asked on every show and whenever the query empties. */
  const [suggested, setSuggested] = useState<Hit[]>([]);
  const [suggestSeq, setSuggestSeq] = useState(0);
  /** The file dialog in front, asked with the suggestions; the root's "Dialog" hint while one is up (and Files is loaded). */
  const [dialogUp, setDialogUp] = useState<DialogInfo | null>(null);
  /** The search history as last fetched (null until asked, once per show), and where Up has walked to in it (-1: not walking). */
  const hist = useRef<string[] | null>(null);
  const [histIdx, setHistIdx] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<ListHandle>(null);
  const show = useRef<HTMLDivElement>(null);
  const viewEl = useRef<HTMLDivElement>(null);
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
  const titleOf = (key: string) => byKey.get(key)?.title ?? barOf(key)?.bar ?? key;
  const scopeKey = view.kind === "palette" || view.kind === "view" || view.kind === "form" ? view.palette : null;
  const isMenu = view.kind === "menu";
  /** `pal pick`'s picker (a menu level with `pick`). */
  const picker = view.kind === "menu" ? view.pick : undefined;
  const menuFzf = useMemo(() => (view.kind === "menu" ? new Fzf(view.rows, { selector: haystack, limit: LIMIT }) : undefined), [view]);
  const scope = scopeKey ? byKey.get(scopeKey) : undefined;
  /** A level whose rows are gathered rather than typed for (`Palette.multi`, `pal pick --multi`): Tab marks and steps, and a bare `x` too while nothing is typed. */
  const multiLevel = (view.kind === "palette" && !!scope?.multi) || !!picker?.multi;
  // The palette and welcome rows are not items to count, and an input palette has none to filter by.
  const filterable = sources.filter((s) => { const k = sourceKey(s); return k !== PALETTES && k !== WELCOME && !s.input; });
  // Loaded extensions (fixture rows carry a bare palette name, which stands in): the empty state hints at installing more when few.
  const extensions = new Set(filterable.map((s) => s.extension || s.palette)).size;
  // A listing is pending for what is showing: restored rows awaiting the host, or a refresh running.
  const updating = scope ? scope.stale : filterable.some((s) => s.stale);
  const isView = view.kind === "view", isForm = view.kind === "form";
  const spec = view.kind === "view" ? view.spec : undefined;
  /** The view's text field (`View.input`): while set, the search row is a field and bare keys type into it. */
  const viewInput = spec?.input;
  const form = view.kind === "form" ? view : undefined;
  // A menu level's rows are its own: nothing is loading or updating there.
  const loading = isView ? !spec || busy : isForm || isMenu ? busy : sources.length === 0 || updating;
  const total = scope ? scope.count : filterable.reduce((n, s) => n + s.count, 0);
  const args = view.kind === "palette" || view.kind === "view" || view.kind === "form" ? view.args : undefined;
  const scopeFilter = view.kind === "palette" && scope?.filters?.length ? paletteFilter ?? scope.filters[0].id : undefined;
  const ctx = useMemo<Ctx | undefined>(() => (scopeFilter !== undefined || args !== undefined ? { filter: scopeFilter, args } : undefined), [scopeFilter, args]);

  // Replies can land out of order (a slow one behind a fast one): only the
  // latest request's answer is shown. A show, view or form level has nothing
  // to list; a menu level's rows are its own, filtered here. A level the
  // host lists (an input palette, a push with args) is asked per keystroke
  // and not again on `version`: its rows are not in the index, and a show
  // lands one index event per palette for seconds, each of which would be
  // another host call for the same query (tela's search waits 250 ms after
  // the last call, so a storm of them kept it from ever answering).
  const indexVersion = scope?.input || ctx?.args !== undefined ? 0 : version;
  useEffect(() => {
    const n = ++seq.current;
    if (view.kind === "show" || view.kind === "view" || view.kind === "form" || view.kind === "menu") return setFound([]);
    search(query, scope, ctx).then((h) => { if (n === seq.current) setFound(h); });
  }, [search, query, scopeKey, view.kind, ctx, indexVersion]);
  // The root's inline and fallback sections: asked `ROOT_DEBOUNCE` after the
  // last keystroke, the local hits already painted; the next keystroke
  // cancels a pending ask and a late reply is dropped by its key. Both
  // requests go out together: the fallback rows only show when nothing
  // else came (`rootHits`), so waiting for the inline answer would only
  // delay them.
  useEffect(() => {
    if (view.kind !== "root" || !query.trim() || (!props.inline && !props.fallback)) return;
    let live = true;
    const key = query;
    const t = setTimeout(() => {
      Promise.all([props.inline ? props.inline(key) : Promise.resolve([]), props.fallback ? props.fallback(key) : Promise.resolve([])]).then(
        ([inline, fallback]) => { if (live) setExtra({ key, inline, fallback }); },
        () => {},
      );
    }, ROOT_DEBOUNCE);
    return () => { live = false; clearTimeout(t); };
  }, [query, view.kind, version]);
  // The empty root's suggestions: on every show and after every pick (`suggestSeq`: a Hide, a timer paused, a colour copied change them) and when the query empties. Not on every index event: those come with every listing while the panel sits hidden, and each ask runs every suggesting palette.
  useEffect(() => {
    if (view.kind !== "root" || query || (!props.suggest && !props.dialog)) return;
    let live = true;
    props.suggest?.(prefs.now).then((h) => { if (live) setSuggested(h); }, () => {});
    props.dialog?.().then((d) => { if (live) setDialogUp(d); }, () => {});
    return () => { live = false; };
  }, [view.kind, query, suggestSeq, prefs.now]);
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

  // A view's text field: the tree's `input.value` becomes the query when the
  // field opens and whenever a later tree changes it (the same value again
  // leaves what was typed alone), the field takes focus with the caret at
  // the end; the field closing clears the query and hands focus back to
  // the view's document, so Escape then leaves the level as before.
  const inputOpen = !!viewInput, inputValue = viewInput?.value;
  const lastInput = useRef<string | undefined>(undefined);
  const caretToEnd = useRef(false);
  const levelKey = view.kind === "view" ? `${nav.depth}:${view.palette}` : null;
  useEffect(() => {
    if (!inputOpen) {
      if (lastInput.current !== undefined) { lastInput.current = undefined; nav.setQuery(""); viewEl.current?.focus({ preventScroll: true }); }
      return;
    }
    if (lastInput.current !== (inputValue ?? "")) { lastInput.current = inputValue ?? ""; nav.setQuery(inputValue ?? ""); caretToEnd.current = true; }
    input.current?.focus({ preventScroll: true });
  }, [inputOpen, inputValue, levelKey]);
  useLayoutEffect(() => {
    if (!caretToEnd.current) return;
    caretToEnd.current = false;
    const el = input.current;
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }, [query]);

  // The pull half of a live view: while a view level with its tree is on
  // top and its palette says `refresh`, the tree is asked again on that
  // cadence and replaces the level's in place (the query kept, so the
  // text field is untouched); a tick while a pick is in flight is skipped
  // (the reply brings a newer tree), a reply for a level that is gone is
  // dropped. `on` triggers (`trigger` in the handle) re-ask the same way.
  const reask = useCallback((why: string) => {
    const top = level.current;
    if (top.kind !== "view" || !top.spec || !props.view) return;
    const s = byKey.get(top.palette);
    if (!s) return;
    const t0 = performance.now();
    props.view(s, ctx).then(
      (spec) => { mark?.(`view ${top.palette} ${why} ms`, performance.now() - t0); if (level.current === top || (level.current.kind === "view" && level.current.palette === top.palette)) nav.replace({ ...(level.current as Extract<Level, { kind: "view" }>), spec }); },
      () => {},
    );
  }, [byKey, ctx, mark]);
  const refreshEvery = view.kind === "view" && view.spec ? scope?.refresh : undefined;
  useEffect(() => {
    if (!refreshEvery || !(refreshEvery > 0)) return;
    const t = setInterval(() => { if (!busy) reask("refresh"); }, refreshEvery * 1000);
    return () => clearInterval(t);
  }, [refreshEvery, levelKey, busy, reask]);
  // What the shell is told is on top: a view level with its tree, by its source (or the bar item whose `{ view }` it is).
  const open = useMemo<ViewOpen | null>(() => {
    if (view.kind !== "view" || !view.spec) return null;
    const id = view.spec.id ?? VIEW_ID;
    const s = byKey.get(view.palette);
    if (s) return { extension: s.extension, palette: s.palette, id };
    const b = barOf(view.palette);
    return b ? { ...b, id } : null;
  }, [view, byKey]);
  const openKey = open ? `${open.extension}/${open.palette ?? `bar:${open.bar}`}/${open.id}` : null;
  const onViewOpen = props.onViewOpen;
  /** Bumped by `start`: the popover opening on an item forgets what the page reported (views.rs), so the same level again must be reported again. */
  const [reportSeq, setReportSeq] = useState(0);
  useEffect(() => { onViewOpen?.(open); }, [openKey, reportSeq, onViewOpen]);
  useEffect(() => () => onViewOpen?.(null), [onViewOpen]);


  // At the root, palettes are the sections; inside one, the palette's own sections are.
  const hits = useMemo(() => {
    if (view.kind === "menu") return groupBySection(menuHits);
    if (view.kind !== "root") return groupBySection(found);
    const fresh = extra.key === query && !!query.trim();
    const now = query ? [] : [...(dialogUp && byKey.has(FILES) ? [dialogHit(dialogUp)] : []), ...suggested];
    return groupBySection(rootHits(query.trim(), found, fresh ? extra.inline : [], fresh ? extra.fallback : [], now, prefs.fallbacksAlways, titleOf));
  }, [found, extra, suggested, dialogUp, query, menuHits, view.kind, byKey, prefs.fallbacksAlways]);

  const cur = useCursor(hits.length);
  const current: Item | undefined = hits[cur.cursor]?.item;
  /** A list level: rows to mark and pick (the root, a palette, a menu). */
  const isList = view.kind === "root" || view.kind === "palette" || view.kind === "menu";
  /** A marked row on screen (the cursor's when it is one): the row a multi pick is addressed to and whose actions the selection offers. */
  const anchor = useMemo<Item | undefined>(() => (sel ? (current && isMarked(sel, current) ? current : hits.find((h) => isMarked(sel, h.item))?.item) : undefined), [sel, current, hits]);
  const marked = useCallback((item: Item) => isMarked(sel, item), [sel]);
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
  const push = (v: Level) => { nav.push(v); cur.reset(); setPaletteFilter(undefined); setSel(null); };
  const pop = () => { nav.pop(); cur.reset(); setPaletteFilter(undefined); setSel(null); };
  /** Mark or unmark the row at `i` (cmd+click, `x`); a row that cannot be marked is left alone. */
  const toggleAt = (i: number) => { const item = hits[i]?.item; if (item && markable(item)) { cur.set(i); setSel((s) => toggle(s, item)); } };
  /** Into a palette: a view palette opens as a view level (its tree asked for), any other as a list; `q` is typed into it on arrival, `title` is the crumb when the push named one. */
  const enter = useCallback((palette: string, args?: unknown, q?: string, title?: string) => {
    push(byKey.get(palette)?.view === "view" ? { kind: "view", palette, args, title } : { kind: "palette", palette, args, title });
    if (q) nav.setQuery(q);
  }, [byKey]);
  /**
   * The search box changed. At the root, with `prefs.aliasSpace`, a word
   * and a space typed forward (never a deletion) jump into the palette the
   * word names (`aliasTarget`), the crumb pushed as for Enter on its row;
   * whatever follows the space is the palette's query. Typing also ends a
   * walk through the history (`histIdx`).
   */
  const setQuery = (q: string) => {
    keyAt.current = performance.now();
    setHistIdx(-1);
    if (view.kind === "root" && prefs.aliasSpace && q.length > query.length && !query.includes(" ")) {
      const m = /^(\S+) (.*)$/.exec(q);
      const target = m && aliasTarget(sources, m[1]);
      if (target) { enter(sourceKey(target), undefined, m[2]); return; }
    }
    nav.setQuery(q);
    cur.reset();
  };
  const closeActions = () => { setActionsOpen(false); focus(); };
  const closeConfirm = () => { setConfirming(null); focus(); };
  const shown = useCallback(() => { setSuggestSeq((n) => n + 1); hist.current = null; }, []);
  const reset = useCallback(() => { nav.reset(); cur.reset(); setPaletteFilter(undefined); setSel(null); setActionsOpen(false); setConfirming(null); setToast(null); setBusy(false); setHistIdx(-1); shown(); input.current?.focus(); }, [nav.reset, cur.reset, shown]);
  const openPalette = useCallback((palette: string) => { reset(); enter(palette); }, [reset, enter]);
  // A source gone from under an open level (an instance removed, a palette
  // switched off, an extension deleted: the core drops the source and emits
  // `pal://index`): the level's rows would sit on nothing, so it pops to
  // the root with a toast. Only a source that was known goes: a view level
  // on a bar item's key never was, and an empty list at startup says nothing.
  const known = useRef(new Map<string, string>());
  useEffect(() => {
    const was = known.current;
    known.current = new Map(sources.map((s) => [sourceKey(s), s.title]));
    if (!was.size || !known.current.size) return;
    const gone = nav.stack.map((l) => l.view).find((v): v is Extract<Level, { kind: "palette" | "view" | "form" }> => (v.kind === "palette" || v.kind === "view" || v.kind === "form") && was.has(v.palette) && !known.current.has(v.palette));
    if (!gone) return;
    reset();
    setToast({ style: "failure", title: `${was.get(gone.palette) ?? gone.palette} is gone`, message: "Its palette was removed or switched off" });
  }, [sources]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * Up at the top of an empty root walks the search history (the query
   * becomes the entry; Up again the one before, Down the one after, past
   * the newest the box empties); the list under it searches as usual, so
   * Enter picks what the query finds. Escape clears the query as always.
   * The history is fetched on the first Up of a show.
   */
  const recall = (dir: 1 | -1): boolean | void => {
    if (view.kind !== "root" || !prefs.searchHistory || !props.history || cur.cursor !== 0) return false;
    const walking = histIdx >= 0 && hist.current?.[histIdx] === query;
    if (!walking && (query || dir === -1)) return false;
    const step = (list: string[]) => {
      const next = (walking ? histIdx : -1) + dir;
      if (next >= list.length) return;
      keyAt.current = performance.now();
      nav.setQuery(next < 0 ? "" : list[next]);
      cur.reset();
      setHistIdx(next);
    };
    if (hist.current) return hist.current.length ? step(hist.current) : false;
    props.history().then((list) => { hist.current = list; if (list.length) step(list); }, () => { hist.current = []; });
  };
  const start = useCallback((level: Level, inPlace = false) => {
    // A palette level naming a view palette (a bar item's `{ palette }` menu) opens as a view level, as `enter` would.
    if (level.kind === "palette" && byKey.get(level.palette)?.view === "view") level = { kind: "view", palette: level.palette, args: level.args };
    // In place, a view level of the same palette keeps the tree it has (the item rendered again must not blank it while a fresh tree is asked for).
    if (inPlace) return nav.patch((v, depth) => (depth !== 1 ? v : level.kind === "view" && v.kind === "view" && v.palette === level.palette ? { ...level, spec: level.spec ?? v.spec } : level));
    nav.restart(level); cur.reset(); setPaletteFilter(undefined); setSel(null); setActionsOpen(false); setConfirming(null); setToast(null); setBusy(false); setReportSeq((n) => n + 1); input.current?.focus();
  }, [nav.restart, nav.patch, cur.reset, byKey]);
  /** A push lands on the level it names: the spec whole, or its tree alone into the level's spec (actions, title and input kept). */
  const update = useCallback((u: ViewUpdate) => {
    nav.patch((v) => {
      if (v.kind !== "view" || !v.spec) return v;
      // The level's identity as `open` reports it: a source's palette, else a bar item's key; a palette and a bar item of one name never cross.
      const s = byKey.get(v.palette), b = s ? undefined : barOf(v.palette);
      const hit = s ? !u.bar && u.extension === s.extension && u.palette === s.palette : !!b && !u.palette && u.extension === b.extension && u.bar === b.bar;
      if (!hit) return v;
      if (u.id != null && (v.spec.id ?? VIEW_ID) !== u.id) return v;
      if (!u.spec || typeof u.spec !== "object" || !u.spec.tree) return v;
      return { ...v, spec: "actions" in u.spec && Array.isArray(u.spec.actions) ? toView(u.spec) : { ...v.spec, tree: u.spec.tree } };
    });
  }, [nav.patch, byKey]);
  const trigger = useCallback((name: string) => { const top = level.current; if (top.kind === "view" && byKey.get(top.palette)?.on?.includes(name)) reask(name); }, [byKey, reask]);
  const type = useCallback((q: string) => { setQuery(q); focus(); }, [nav.setQuery, cur.reset]);
  const filter = (id: string) => { setPaletteFilter(id); cur.reset(); };
  // `applyEffect` closes over this render's stack, so the handle is rebuilt per render (cheap: an object).
  const apply = (item: Item, effect: Effect, args?: unknown) => applyEffect(item, effect, args !== undefined ? { args } : undefined);
  useImperativeHandle(ref, () => ({ reset, open: openPalette, start, type, focus, filter, apply, shown, toast: setToast, update, trigger }));

  // The item's own actions first (the default "Open" when it declares none;
  // a welcome tip declares `[]`, so Enter on it shows its detail), then the
  // shell's. With no item (nothing matched) the shell's still stand, so cmd+k
  // has somewhere to go.
  const actions = useMemo<Action[]>(() => {
    const a: Action[] = [];
    // A view level's actions are the view's own, with their keys, plus the link (Escape leaves). A form has its submit and nothing else listed; ⌘⇧C still copies its link.
    const link: Action = { id: LINK, title: "Copy deep link", icon: { kind: "glyph", value: "⌘" }, shortcut: "cmd+shift+c", section: "Link" };
    const linkable = !!onLink && !!linkFor(view, current, query);
    if (view.kind === "view") return [...(view.spec?.actions ?? []), ...(linkable ? [link] : [])];
    if (view.kind === "form") return linkable ? [{ ...link, hidden: true }] : [];
    // Rows marked: only what works on several (the marked row's `multi` actions), and the way out.
    if (sel) return [...multiActions(anchor?.actions), { id: CLEAR, title: "Clear selection", icon: { kind: "glyph", value: "×" }, section: "pal" }];
    if (current) {
      const isPalette = current.palette === PALETTES, isTip = current.palette === WELCOME, isAsk = !!current.push;
      a.push(...(current.actions ?? [isPalette ? { ...OPEN, title: `Open ${current.name}` } : isAsk ? { ...OPEN, title: current.name } : OPEN]));
      if (view.kind === "root" && !isPalette && !isTip && !isAsk && current.palette !== FALLBACK) a.push({ id: BROWSE, title: `Browse ${titleOf(current.palette!)}`, icon: { kind: "glyph", value: "›" }, shortcut: "cmd+shift+b", section: "Navigate" });
      if (!compact) a.push({ id: DETAIL, title: showDetail ? "Hide details" : "Show details", shortcut: "cmd+i", section: "View" });
    }
    if (linkable) a.push(link);
    // The shell's own, one "pal" section: a ranking to reset (a row frecency could have remembered: an indexed or palette row; not a tip, a fallback, a "more" row or a suggestion), the refresh, the panel's shape, Settings, the tips.
    if (current && onForget && current.source && (view.kind === "root" || (view.kind === "palette" && args === undefined)) && current.palette !== WELCOME && !current.push && !current.muted && current.palette !== FALLBACK && current.id !== ASK_ID && (!current.group || current.group === FREQUENT))
      a.push({ id: FORGET, title: "Reset ranking for this item", icon: { kind: "glyph", value: "↺" }, section: "pal" });
    // An indexed level only: an input palette or a drill-in lists per keystroke anyway. A menu level's refresh renders its bar item again.
    if (onRefresh && (view.kind === "root" || (view.kind === "palette" && !scope?.input && args === undefined) || view.kind === "menu"))
      a.push({ id: REFRESH, title: view.kind === "root" ? "Refresh everything" : `Refresh ${view.kind === "menu" ? view.title : titleOf(view.palette)}`, icon: { kind: "glyph", value: "↻" }, shortcut: "cmd+r", section: "pal" });
    if (onCompact && (view.kind === "root" || view.kind === "palette")) a.push({ id: COMPACT, title: compact ? "Full panel" : "Compact panel", icon: { kind: "glyph", value: compact ? "⇔" : "⇹" }, shortcut: "cmd+shift+m", section: "pal" });
    if (onSettings && view.kind === "root") a.push({ id: SETTINGS, title: "Open Settings", icon: { kind: "glyph", value: "⚙" }, shortcut: "cmd+,", section: "pal" });
    if (onWelcome && view.kind === "root" && !byKey.has(WELCOME)) a.push({ id: TIPS, title: "Show tips again", icon: { kind: "glyph", value: "?" }, section: "pal" });
    return a;
  }, [current, view, showDetail, byKey, onSettings, onRefresh, onWelcome, onLink, onForget, onCompact, compact, scope, args, query, sel, anchor]);
  /** The actions on show: Enter and ⌘Enter are the first two of these, the footer and the panel list them; a `hidden` action only routes its key. */
  const listed = useMemo(() => actions.filter((a) => !a.hidden), [actions]);

  // The envelope's copy/open/hide are the caller's; the toast shows here, a
  // push/show opens its level, a view replaces the tree of the view level it
  // came from (the game loop) or opens one from a list, a form opens a form
  // level or, answering that form's submit, shows it again with its errors.
  // Any other answer to a submit closes the form first: the pick is done.
  const applyEffect = (item: Item, e: Effect, c: Ctx | undefined, submit = false, action?: string) => {
    const top = level.current;
    if (submit && !e.form && top.kind === "form") pop();
    if (e.toast) setToast({ style: e.toast.style ?? "success", title: e.toast.title, message: e.toast.message });
    if (e.push) enter(sourceKey(e.push), e.push.args, e.push.query, e.push.title);
    if (e.show) push({ kind: "show", detail: { markdown: e.show.markdown, metadata: e.show.metadata }, title: e.show.title, palette: item.palette });
    if (e.view) {
      // The next tree of the view it came from, if that is still the level on top; else a fresh level.
      if (top.kind === "view" && top.palette === item.palette) nav.replace({ ...top, spec: e.view });
      else if (top.kind !== "view") push({ kind: "view", palette: item.palette!, spec: e.view });
    }
    if (e.form) {
      if (submit && top.kind === "form") nav.replace({ ...top, spec: toForm(e.form) });
      else push({ kind: "form", palette: item.palette!, args: c?.args, spec: toForm(e.form), from: item, action, key: ++formSeq.current });
    }
  };
  // A failed pick names what it tried, in the extensions' own voice: "Could not open", "Could not copy URL", "Could not submit".
  const pickItem = (item: Item, action?: string, c: Ctx | undefined = ctx, submit = false) =>
    Promise.resolve(onPick(item, query, action, c)).then(
      (r) => { applyEffect(item, (r ?? {}) as Effect, c, submit, action); setSuggestSeq((n) => n + 1); },
      (e) => {
        const title = submit ? "submit" : item.actions?.find((x) => x.id === action)?.title ?? "open";
        setToast({ style: "failure", title: `Could not ${title[0].toLowerCase()}${title.slice(1)}`, message: String(e) });
      },
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
    // An inline args form submits as the row's default pick when its action id is "" (`argsForm`).
    pickItem(item, view.spec.submit.id || undefined, { ...ctx, values }, true).finally(() => setBusy(false));
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
  const pickView = (a: Action, values?: FormValues) => {
    if (view.kind !== "view" || !view.spec || busy) return;
    const s = byKey.get(view.palette);
    setBusy(true);
    const item: Item = { id: view.spec.id ?? VIEW_ID, name: view.spec.title ?? titleOf(view.palette), palette: view.palette, source: s && { extension: s.extension, palette: s.palette } };
    pickItem(item, a.id, values ? { ...ctx, values } : ctx).finally(() => setBusy(false));
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
    const inp = view.spec.input;
    if (inp) {
      // The field's Enter and Escape are picks carrying the text; a key that queued before the field opened is typed into it (`space` and `backspace` included), so the first letters after a mode key are not lost.
      if (cmd.type === "submit" || cmd.type === "primary") { const a = actions.find((x) => x.id === inp.submit); if (!a) return false; setActionsOpen(false); return pickView(a, { input: query }); }
      if (cmd.type === "cancel") { const a = inp.cancel ? actions.find((x) => x.id === inp.cancel) : undefined; return a ? run(a) : pop(); }
      if (cmd.type === "key") {
        if (cmd.key === "backspace") { setQuery(query.slice(0, -1)); return; }
        const ch = cmd.key === "space" ? " " : cmd.key.length === 1 ? cmd.key : undefined;
        if (ch === undefined) return false;
        setQuery(query + ch);
        return;
      }
    }
    if (cmd.type === "submit" || cmd.type === "cancel") return false;
    // A click on a node carrying `action` (View.tsx): the action of that id, listed or hidden, with what the control read (a slider's fraction).
    if (cmd.type === "action") { const a = actions.find((x) => x.id === cmd.id); if (!a) return false; if (cmd.values && !a.confirm) { setActionsOpen(false); focus(); return pickView(a, cmd.values); } return run(a); }
    const a = cmd.type === "primary" ? listed[0]
      : cmd.type === "secondary" ? listed[1]
      // A shifted arrow with no action of its own is the plain arrow's.
      : cmd.type === "shortcut" ? actions.find((x) => hasShortcut(x, cmd.combo)) ?? (shiftedArrow(cmd.combo) && view.spec.keys === "actions" ? actions.find((x) => hasShortcut(x, shiftedArrow(cmd.combo)!)) : undefined)
      : view.spec.keys === "actions" ? actions.find((x) => hasShortcut(x, cmd.key)) : undefined;
    return a ? run(a) : false;
  };
  // The queue drains one key per settled tree; leaving the level, or landing on another, drops what was waiting.
  const lastLevel = useRef(levelKey);
  useEffect(() => {
    if (lastLevel.current !== levelKey) { lastLevel.current = levelKey; queue.current.length = 0; return; }
    if (levelKey === null || busy || view.kind !== "view" || !view.spec) return;
    // A key no action carries any more (the hand is over) is dropped, and the next one tried.
    while (queue.current.length) if (viewCommand(queue.current.shift()!) !== false) break;
  });

  /** The row's `args` as a form the search bar draws (`Form inline`): a text or select field per argument, the submit the action picked (`""` is the default pick). */
  const argsForm = (item: Item, a: Action, action?: string): FormSpec => ({
    title: item.name,
    fields: (item.args ?? []).map((g) => (g.kind === "select" ? { id: g.id, label: g.placeholder, kind: "select" as const, options: g.options ?? [], required: g.required, value: g.default } : { id: g.id, label: g.placeholder, placeholder: g.placeholder, kind: "text" as const, required: g.required, value: g.default })),
    submit: { id: action ?? "", title: a.title },
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
      case LINK: { const l = linkFor(view, current, query); if (l) onLink?.(l); break; }
      case DETAIL: setShowDetail((s) => !s); break;
      case COMPACT: onCompact?.(); break;
      case CLEAR: setSel(null); break;
      case FORGET:
        if (current && onForget) Promise.resolve(onForget(current)).then(
          (had) => setToast(had ? { style: "success", title: "Ranking reset", message: `${current.name} ranks as never picked` } : { style: "success", title: "Nothing to reset", message: `${current.name} had no ranking` }),
          (e) => setToast({ style: "failure", title: "Could not reset", message: String(e) }),
        );
        break;
      case BROWSE: if (current) push({ kind: "palette", palette: current.palette! }); break;
      case SUBMENU: if (current && view.kind === "menu") push(menuLevel(view.key, current.name, view.submenus[current.id] ?? [])); break;
      default:
        if (view.kind === "view") return pickView(a);
        // The picker's answer: the marked ids, else the row's; the level is the CLI's, so nothing else runs.
        if (picker) {
          const ids = sel ? pickIds(sel, current) : current && !current.disabled ? [current.id] : [];
          if (ids.length) onPickReply?.(picker.token, ids);
          return;
        }
        // A multi action: one pick addressed to the marked row on screen, every marked id in the ctx; the marks go with it.
        if (sel && a.multi) {
          if (!anchor) return;
          const ids = pickIds(sel, current);
          setSel(null);
          pickItem(anchor, a.id, { ...ctx, ids });
          return;
        }
        if (!current || current.disabled) return;
        // A fallback "Ask" row opens its palette with the query typed; nothing to pick.
        if (current.push) { enter(sourceKey(current.push), current.push.args, current.push.query, current.push.title); return; }
        // A palette row drills in; the pick only records the choice.
        if (current.palette === PALETTES) enter(current.id);
        // Typed arguments first: the primary action (and one marked `args`) turns the search bar into the row's fields; the pick follows with their values.
        if (current.args?.length && (!current.actions || current.actions[0]?.id === a.id || a.args)) {
          push({ kind: "form", inline: true, palette: current.palette!, args: ctx?.args, spec: argsForm(current, a, current.actions ? a.id : undefined), from: current, action: current.actions ? a.id : undefined, key: ++formSeq.current });
          return;
        }
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
    return hits[i].item.actions?.[0];
  };
  /**
   * A bare `left`, `right` or `backspace` in a list level while nothing is
   * typed (the caret has nowhere to go): the action carrying that key on
   * the row under the cursor (a folder's "Browse" on `right`); for `left`
   * and `backspace` else on any row of the level (the `..` row's "Go up"
   * from anywhere in a browsed folder), picked on that row and the cursor
   * moved to it. Declined when no row carries it, so the key keeps its
   * native effect.
   */
  const rowKey = (key: string): boolean | void => {
    if (!isList || query || isGrid) return false;
    const own = current?.actions?.find((x) => hasShortcut(x, key));
    if (own && !current?.disabled) return run(own);
    if (key === "right") return false;
    const i = hits.findIndex((h) => !h.item.disabled && h.item.actions?.some((x) => hasShortcut(x, key)));
    if (i < 0) return false;
    const row = hits[i].item;
    const a = row.actions?.find((x) => hasShortcut(x, key));
    if (!a) return false;
    cur.set(i);
    // Not `run`: that reads this render's `current`; the pick is addressed to the row found (a confirm waits for the cursor to land on it).
    if (a.confirm) { setConfirming(a); return; }
    setActionsOpen(false);
    focus();
    pickItem(row, a.id);
  };

  /**
   * A bare Backspace with nothing typed: the row's own action carrying it
   * first (`rowKey`), else, with `prefs.backspaceBack`, back a level as
   * `cmd+backspace` goes (never at the root; a show level goes back as Enter
   * does; a view's keys are its own, and its text field types; a form's
   * fields own it). With text in the box it is typing.
   */
  const backspace = (): boolean | void => {
    if (query) return false;
    if (isList) { const own = rowKey("backspace"); if (own !== false) return own; }
    if (view.kind === "view") return viewInput ? false : viewCommand({ type: "key", key: "backspace" });
    if (view.kind === "form" || !prefs.backspaceBack || nav.depth === 1) return false;
    return pop();
  };

  const move = (dir: "up" | "down" | "left" | "right"): boolean | void => {
    if (view.kind === "form") return false;
    // In a view's text field the arrows move the caret.
    if (view.kind === "view") return viewInput ? false : viewCommand({ type: "key", key: dir });
    if (view.kind === "show") return dir === "down" || dir === "up" ? scrollShow(dir === "down" ? 1 : -1) : false;
    if (dir === "left" || dir === "right") { if (!isGrid) return rowKey(dir); cur.move(dir === "right" ? 1 : -1); return; }
    if ((dir === "up" || (dir === "down" && histIdx >= 0)) && recall(dir === "up" ? 1 : -1) !== false) return;
    cur.move((dir === "down" ? 1 : -1) * (isGrid ? (list.current?.columns() ?? columns) : 1));
  };
  /** A shifted arrow in a list level: the row under the cursor is marked (never unmarked), then the cursor moves; LaunchBar's Shift+Down range. */
  const markAndMove = (dir: "up" | "down" | "left" | "right"): boolean | void => {
    if (isList && current && markable(current)) setSel((s) => markRow(s, current));
    return move(dir);
  };

  useKeys(
    {
      move: ({ dir }) => move(dir),
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
      primary: () => (view.kind === "show" ? pop() : view.kind === "form" ? requestSubmit() : view.kind === "view" ? viewCommand({ type: "primary" }) : sel ? (listed[0]?.id === CLEAR ? noMulti() : run(listed[0])) : current && listed[0] ? run(listed[0]) : false),
      secondary: () => (view.kind === "form" ? requestSubmit() : view.kind === "view" ? viewCommand({ type: "secondary" }) : current && listed[1] ? run(listed[1]) : false),
      actions: () => (listed.length ? setActionsOpen(true) : false),
      escape: () => (view.kind === "view" && viewInput ? viewCommand({ type: "cancel" }) : sel ? setSel(null) : query ? setQuery("") : nav.depth > 1 ? pop() : picker ? onPickReply?.(picker.token, null) : onHide()),
      back: () => (query || nav.depth === 1 ? false : pop()),
      // Without a filter, Tab is still swallowed: it would otherwise walk focus out of the input. A view gets it as the bare key `tab` (and `shift+tab` as a combo), so a picker can move its focus.
      filter: filterSpec ? ({ dir }) => {
        const o = filterSpec.options, i = o.findIndex((x) => x.id === filterSpec.value);
        filterSpec.onChange(o[(i + dir + o.length) % o.length].id);
      } : view.kind === "view" && !viewInput ? ({ dir }) => { viewCommand(dir === 1 ? { type: "key", key: "tab" } : { type: "shortcut", combo: "shift+tab" }); }
      // fzf's Tab in a multi palette or picker (none of them has a filter dropdown): mark and step, whatever is typed.
      : multiLevel ? ({ dir }) => { if (current) { toggleAt(cur.cursor); cur.move(dir); } } : () => {},
      detail: () => (view.kind === "view" || view.kind === "form" || compact ? false : setShowDetail((s) => !s)),
      shortcut: ({ combo }) => {
        if (combo === "cmd+," && onSettings) return onSettings();
        if (combo === "cmd+shift+m" && onCompact) return onCompact();
        if (view.kind === "view") return viewCommand({ type: "shortcut", combo });
        const a = actions.find((x) => hasShortcut(x, combo)) ?? menuShortcut(combo);
        if (a) return run(a);
        // A shifted arrow nothing claims marks the row and moves the cursor in a list; elsewhere it moves as the bare arrow does.
        const dir = shiftedArrow(combo);
        return dir ? markAndMove(dir) : false;
      },
      // A bare key in a menu level runs the row carrying it, while nothing is typed; in a view's text field it is typing; `x` in a `multi` palette marks the row and steps down.
      key: ({ key }) => {
        if (isMenu && !query) { const a = menuShortcut(key); if (a) return run(a); }
        if (key === "x" && multiLevel && !query && current) { toggleAt(cur.cursor); cur.move(isGrid ? (list.current?.columns() ?? columns) : 1); return; }
        if (key === "backspace") return backspace();
        return view.kind === "view" && !viewInput ? viewCommand({ type: "key", key }) : false;
      },
    },
    { input },
  );

  const isShow = view.kind === "show";
  const showTitle = view.kind === "show" ? view.title ?? "Output" : "";
  const viewTitle = isView ? spec?.title ?? titleOf(view.palette) : form ? form.spec.title : "";
  /** A source's tile, or for a key that is no source (a bar item's view or menu level, a shown item's palette) the tile of any palette of its extension: every palette wears the manifest's. */
  const iconFor = (key: string | undefined) => {
    const ext = key && (barOf(key)?.extension ?? key.split("/")[0]);
    const s = key ? byKey.get(key) ?? sources.find((x) => x.extension === ext && x.icon) : undefined;
    return s?.icon ? iconOf(s.icon, s.title) : undefined;
  };
  const levelIcon = view.kind === "palette" || view.kind === "view" || view.kind === "form" ? iconFor(view.palette) : view.kind === "show" ? iconFor(view.palette) : isMenu ? iconFor(view.key) : undefined;
  const crumb = view.kind === "palette" || view.kind === "view" || view.kind === "form" ? { title: ((view.kind === "view" || view.kind === "palette") && view.title) || titleOf(view.palette), icon: levelIcon } : isShow ? { title: showTitle, icon: levelIcon } : isMenu ? { title: view.title, icon: levelIcon } : undefined;
  // The bottom level has nothing under it to go back to: its crumb is a title, not a button.
  const back = crumb && { ...crumb, onBack: nav.depth > 1 ? pop : undefined };
  const placeholder = view.kind === "root" ? "Search…" : view.kind === "view" ? viewInput?.placeholder ?? "" : view.kind === "show" || view.kind === "form" ? "" : isMenu ? `Search ${view.title}…` : scope?.placeholder ?? `Search ${titleOf(view.palette)}…`;
  /** What Enter runs and the footer names: the field's submit while a view's text field is open, else the first listed action. */
  const primaryAction = viewInput ? actions.find((a) => a.id === viewInput.submit) : sel && listed[0]?.id === CLEAR ? undefined : listed[0];
  const onPickAt = (i: number) => { cur.set(i); const a = listed[0]; if (a) run(a); };
  /** Enter with rows marked and nothing that works on several: say so rather than pick one. */
  const noMulti = () => setToast({ style: "failure", title: "Nothing here works on several rows", message: "Clear the selection (Escape) to pick one" });
  const body = view.kind === "show"
    ? <div ref={show} className="pal-show" role="document" aria-label={showTitle}><Detail detail={view.detail} /></div>
    : view.kind === "view"
    ? (spec ? <View tree={spec.tree} label={viewTitle} autoFocus rootRef={viewEl} onAction={(id, values) => viewCommand({ type: "action", id, values })} /> : null)
    : form?.inline
    // The fields are in the search row; the body shows what the row is about.
    ? (form.from.detail ? <div className="pal-show" role="document" aria-label={form.from.name}><Detail detail={form.from.detail} /></div> : <Empty icon={form.from.icon ?? { kind: "glyph", value: "›" }} title={form.from.name} hint={form.from.subtitle ?? `${form.spec.submit.title} with the arguments above`} />)
    : form
    // The title is the search row's (as for a view), so the form draws none of its own.
    ? <div ref={formEl} className="pal-form-level" aria-busy={busy || undefined}><Form key={form.key} fields={form.spec.fields} submitTitle={form.spec.submit.title} cancelTitle={form.spec.cancel} errors={form.spec.errors} onSubmit={submitForm} onCancel={pop} /></div>
    : !hits.length
      ? <Empty
          icon={{ kind: "glyph", value: "⌕" }}
          title={query ? `No results for “${query}”` : loading ? "Loading…" : "Nothing here"}
          hint={query && !scope?.input ? `Try a different word, or ${isMac ? "⌘K" : "Ctrl+K"} for actions` : undefined}
          note={query && view.kind === "root" && sources.length > 0 && extensions < 2 ? `${extensions === 0 ? "No extensions are" : "Only one extension is"} loaded, so there is little to find. Settings (${isMac ? "⌘," : "Ctrl+,"}) › Extensions lists them; the Welcome tips link the guide to adding more.` : undefined}
        />
      : isGrid
        ? <Grid ref={list} id={LIST_ID} hits={hits} cursor={cur.cursor} onCursor={cur.set} onPick={onPickAt} marked={marked} onToggle={toggleAt} columns={columns} />
        : <List ref={list} id={LIST_ID} hits={hits} cursor={cur.cursor} onCursor={cur.set} onPick={onPickAt} marked={marked} onToggle={toggleAt} />;

  /** The footer's primary hint and Enter handler, one place: the footer draws it, or the search row's right side in compact mode. */
  const primaryHint = isShow ? { title: "Back" } : form ? { title: form.spec.submit.title, shortcut: submitKey } : (isView || current) && primaryAction ? { title: primaryAction.title } : undefined;
  const onPrimary = () => (isShow ? pop() : form ? requestSubmit() : isView ? viewCommand({ type: "primary" }) : sel ? (listed[0]?.id === CLEAR ? noMulti() : run(listed[0])) : current && listed[0] && run(listed[0]));
  return (
    <Panel
      search={form?.inline
        ? <div ref={formEl} className="pal-search pal-search--args" aria-busy={busy || undefined}>
            <button type="button" className="pal-search__back" onClick={pop} onMouseDown={keepFocus} aria-label={`Back from ${form.from.name}`} tabIndex={-1}><span className="pal-search__chevron" aria-hidden>‹</span>{form.from.icon && <Icon icon={form.from.icon} size="sm" />}<span className="pal-search__crumb">{form.from.name}</span></button>
            <Form key={form.key} inline title={form.from.name} fields={form.spec.fields} submitTitle={form.spec.submit.title} errors={form.spec.errors} onSubmit={submitForm} onCancel={pop} />
          </div>
        : <Search value={query} onChange={setQuery} inputRef={input} back={back} filter={filterSpec} listId={isShow || isView || isForm ? undefined : LIST_ID} activeId={hits.length ? domId(LIST_ID, cur.cursor) : undefined} popup={isGrid ? "grid" : "listbox"} loading={loading} placeholder={placeholder} readOnly={isShow} title={(isView && !viewInput) || isForm ? viewTitle : undefined} hint={compact ? primaryHint : undefined} onHint={compact ? onPrimary : undefined} count={compact ? sel?.ids.length : undefined} />}
      aside={!compact && showDetail && !isShow && !isView && !isForm && (paneDetail ? <Detail detail={paneDetail} loading={paneLoading} /> : <Empty title="No details" />)}
      footer={compact ? undefined :
        <Footer
          icon={isShow || isView || isForm ? levelIcon : current?.icon}
          title={view.kind === "root" ? `${hits.length}${hits.length === LIMIT ? "+" : ""} of ${total}` : isShow ? showTitle : isView || isForm ? viewTitle : current?.name}
          note={updating && !isShow && !isView && !isForm && !isMenu ? "updating…" : undefined}
          count={sel?.ids.length}
          primary={primaryHint}
          actions={listed.length > 0}
          onPrimary={onPrimary}
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
