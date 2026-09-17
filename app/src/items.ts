/**
 * Adapts what the core sends per hit (a host item, fields pass through) to
 * the UI item model. Provisional, like the wire shape it reads.
 */
import { isBrand, isSymbol } from "./ui/icons";
import type { Accessory, Action, Brand, Detail, FilterOption, FormField, FormSpec, FormValues, Icon, Item, ViewSpec } from "./ui/types";

/** `pal_core::index::Source`. */
export type Source = { extension: string; palette: string };

/** `pal_core::index::Item`: the typed fields plus whatever the extension added. */
export type WireItem = {
  id: string;
  name: string;
  subtitle?: string;
  keywords?: string[];
  icon?: unknown;
  section?: string;
  url?: string;
  /** `Action` in sdk/src/protocol.ts: id, title, shortcut?, style?, confirm?, hidden?. */
  actions?: Action[];
  /** As in sdk/src/protocol.ts; both replace what would be derived here. */
  accessories?: Accessory[];
  detail?: Detail;
  /** A fallback "Ask" row (`fallback.rs`): the palette to open with the query typed. */
  push?: { extension: string; palette: string; args?: unknown; query?: string; /** The level's crumb, in place of the palette's title. */ title?: string };
  [extra: string]: unknown;
};

/** One row of the `query` command's reply (`HitView` in src-tauri/src/index.rs); `group` names a root section that is not the palette's. */
export type WireHit = { source: Source; id: string; score: number; name_positions: number[]; item: WireItem; group?: string };

/** One row of the `sources` command's reply (`SourceView`): `PaletteMeta` plus the count. */
export type SourceInfo = Source & {
  title: string;
  live: boolean;
  input: boolean;
  /** The palette's icon as the code gave it: a string, `{ tile }`, `{ glyph, color }` (`iconOf`). */
  icon?: unknown;
  /** `view`: opened as a view level (the palette answers `view(ctx)`), never listed. */
  view?: "list" | "grid" | "view";
  columns?: number;
  placeholder?: string;
  /** Open with the detail pane showing. */
  showDetail?: boolean;
  /** The palette answers `detail(id)` for an item whose inline detail has no markdown. */
  detail?: "lazy";
  /** The actions of every row that carries none of its own (`Palette.actions` in sdk/src/protocol.ts). */
  actions?: Action[];
  /** A scope dropdown inside the palette; first is the default. */
  filters?: FilterOption[];
  /** Seconds the core keeps a listing before listing again on load. */
  ttl?: number;
  /** The palette's tier at the root as the manifest and the code resolved it (the config's override stays in the core). */
  tier?: "primary" | "normal" | "catalog";
  /** Lists inline at the root for queries its `match` accepts (the host matches; the root asks it once any inline palette exists). */
  inline?: true;
  match?: string;
  /** `ask`: the core builds an "Ask" fallback row for it; `rows`: it answers `fallback(query)` itself. */
  fallback?: "ask" | "rows";
  fallbackTitle?: string;
  /** Answers `suggest()` for the empty root's "Now" section. */
  suggest?: true;
  /** `[palettes.<id>] alias`, for the alias-and-space jump. */
  alias?: string;
  /** Tab (and a bare `x` with nothing typed) marks rows inside it (`Palette.multi`). */
  multi?: true;
  /** A view palette: seconds between re-asks of `view(ctx)` while its level is on top (the pull half of a live view). */
  refresh?: number;
  /** A view palette: the triggers (`pal://trigger` names) that re-ask it while on top. */
  on?: string[];
  count: number;
  /** The rows are a restored (or expired) listing and a fresh one is pending: "updating" in the footer. */
  stale: boolean;
  /** Unix seconds of the listing the rows came from. */
  listed_at?: number;
};

/** How a level was opened (`Ctx` in sdk/src/protocol.ts): the filter picked, the args of the `push` that opened it, a form's values on its submit. */
export type Ctx = { filter?: string; args?: unknown; values?: FormValues; /** A multi pick: every marked id, the addressed row's first. */ ids?: string[] };

/** What a pick returns (`Effect` in sdk/src/protocol.ts); `copy` and `open` already ran in the core. */
export type Effect = {
  copy?: string;
  open?: string;
  paste?: unknown;
  hide?: true;
  toast?: { title: string; message?: string; style?: "success" | "failure" };
  /** Shown by the core in the HUD window after the panel hides. */
  hud?: string;
  keep?: true;
  /** Drill in: a level scoped to that palette, its `list` given `args`; `query` is typed into its search box. */
  push?: { extension: string; palette: string; args?: unknown; query?: string; /** The level's crumb, in place of the palette's title. */ title?: string };
  /** A detail-only level to read. */
  show?: Detail & { title?: string };
  /** A render tree: a new view level from a list, the next tree of the view it came from. */
  view?: ViewSpec;
  /** A prompt: a form level from a row, the same form again (with errors) from its submit. */
  form?: FormSpec;
};

/** A toast needs the window; `keep` asks for it; `push`, `show`, `view` and `form` open or refresh a level in it. Everything else hides. */
export const staysOpen = (r: unknown): r is Effect => !!r && typeof r === "object" && ("keep" in r || "toast" in r || "push" in r || "show" in r || "view" in r || "form" in r);

/**
 * An action as the wire carries it, and nothing more: the UI keys its own
 * on the `pal:` prefix, and the host refuses those ids in a view, so an
 * extension's actions can never run the shell's code.
 */
const toAction = (a: Action): Action => ({ id: String(a.id), title: String(a.title ?? a.id), shortcut: a.shortcut, style: a.style, confirm: a.confirm, hidden: a.hidden === true || undefined, multi: a.multi === true || undefined });

/** A `View` off the wire as the UI keeps it; the host has checked the tree. */
export const toView = (v: ViewSpec): ViewSpec => ({
  tree: v.tree, actions: (v.actions ?? []).map(toAction), title: v.title, id: v.id, keys: v.keys,
  input: v.input && typeof v.input === "object" && typeof v.input.submit === "string" ? { value: v.input.value, placeholder: v.input.placeholder, submit: v.input.submit, cancel: v.input.cancel } : undefined,
});

/** A wire field (`default`) as the Form component takes it (`value`); a kind the UI cannot draw is dropped by the host already. */
type WireField = Omit<FormField, "value"> & { default?: string | boolean };
const toField = ({ default: value, ...f }: WireField): FormField => ({ ...f, value } as FormField);

/** A `Form` off the wire as the UI keeps it; the host has checked the fields and the submit id. */
export const toForm = (f: FormSpec & { fields: WireField[] }): FormSpec => ({
  id: f.id, title: String(f.title), fields: (f.fields ?? []).map(toField), submit: { id: String(f.submit.id), title: String(f.submit.title ?? f.submit.id) }, cancel: f.cancel, errors: f.errors,
});

/** `Item.palette` for a source. Fixture rows (the gallery) have no extension and keep their bare palette name. */
export const sourceKey = (s: Source) => (s.extension ? `${s.extension}/${s.palette}` : s.palette);

/** The synthetic source whose rows are the palettes (`palettes_source` in index.rs); a row's id is the palette's `sourceKey`. */
export const PALETTES = "pal/palettes";
/** The synthetic source of the first-run tips (`welcome::source` in welcome.rs): leads the empty query until hidden. */
export const WELCOME = "pal/welcome";
/** The synthetic source of the shell's own fallback rows (`fallback::source` in fallback.rs): never indexed, picked by id. */
export const FALLBACK = "pal/fallback";
/** The empty root's sections that are not a palette's: the Frequent rows (`FREQUENT` in index.rs) and the extensions' `suggest()` rows. */
export const FREQUENT = "Frequent";
/** The empty root's "Needs attention" rows (`commands::ATTENTION`): a failed extension's row, right after the tips. */
export const ATTENTION = "Needs attention";
export const NOW = "Now";
/** The palette whose section follows Frequent at the empty root: the recently used files. */
export const RECENT_FILES = "files/recent";
/** The id of every fallback "Ask" row (`ASK_ID` in fallback.rs). */
export const ASK_ID = "pal:ask";

const pictographic = /\p{Extended_Pictographic}/u;

const HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * `{ app: path }` (or a bare path, as v1 rows carry) is the app's artwork;
 * `{ image: url }` a picture to load as is; `{ tile }` an icon tile in a
 * brand colour (sdk/src/icon.ts; a bad one is a plain glyph of its mark);
 * `{ glyph, color }` a glyph tinted in a brand colour or a hex; a hex
 * colour is a tinted dot; a private-use codepoint is a Nerd Font glyph
 * (the bundled symbols font); a pictograph is an emoji (the platform's
 * colour font); any other string is a glyph in the mono font. No icon: the
 * favicon when there is a url, else the name's initial.
 */
export function iconOf(icon: unknown, name: string, url?: string): Icon | undefined {
  const letter = name ? name[0].toUpperCase() : "";
  const obj = icon && typeof icon === "object" ? (icon as { app?: unknown; image?: unknown; tile?: unknown; glyph?: unknown; color?: unknown }) : undefined;
  if (typeof obj?.app === "string") return { kind: "app", path: obj.app, letter };
  if (typeof obj?.image === "string") return { kind: "image", src: obj.image, mask: "rounded" };
  if (obj?.tile && typeof obj.tile === "object") {
    const t = obj.tile as { glyph?: unknown; svg?: unknown; bg?: unknown; badge?: unknown };
    const glyph = typeof t.glyph === "string" && isSymbol(t.glyph) ? t.glyph : undefined;
    const svg = typeof t.svg === "string" && t.svg.trim() ? t.svg : undefined;
    // An instance's mark: one or two characters (code points) in the corner; anything longer is cut to fit.
    const badge = typeof t.badge === "string" && t.badge.trim() ? { badge: [...t.badge.trim()].slice(0, 2).join("") } : {};
    if (isBrand(t.bg) && (glyph || svg)) return glyph ? { kind: "tile", bg: t.bg, glyph, ...badge } : { kind: "tile", bg: t.bg, svg, ...badge };
    return glyph ? { kind: "glyph", value: glyph } : letter ? { kind: "glyph", value: letter } : undefined;
  }
  if (typeof obj?.glyph === "string" && obj.glyph.trim()) {
    const value = obj.glyph.trim();
    if (isBrand(obj.color)) return { kind: "glyph", value, tint: obj.color };
    return typeof obj.color === "string" && HEX.test(obj.color) ? { kind: "glyph", value, color: obj.color } : { kind: "glyph", value };
  }
  const s = typeof icon === "string" ? icon.trim() : "";
  if (s.startsWith("/")) return { kind: "app", path: s, letter };
  if (s) {
    if (HEX.test(s)) return { kind: "glyph", value: "●", color: s };
    if (isSymbol(s)) return { kind: "glyph", value: s };
    return pictographic.test(s) ? { kind: "emoji", value: s } : { kind: "glyph", value: s };
  }
  if (url) return { kind: "favicon", url };
  return letter ? { kind: "glyph", value: letter } : undefined;
}

function detailOf(w: WireItem, paletteTitle: string): Detail {
  const target = [w.url, w.cmd, w.ssh_cmd, w.hex].find((v) => typeof v === "string") as string | undefined;
  const md = [`# ${w.name}`, w.subtitle ? `${w.subtitle}\n` : "", target ? "```\n" + target + "\n```" : ""].filter(Boolean).join("\n");
  return {
    markdown: md,
    metadata: [
      { label: "Palette", value: paletteTitle },
      ...(w.section ? [{ label: "Section", value: w.section }] : []),
      { label: "Id", value: w.id },
      ...(w.keywords?.length ? [{ label: "Keywords", tags: w.keywords.filter(Boolean).slice(0, 6).map((text) => ({ text })) }] : []),
      ...(w.url ? [{ label: "URL", link: { text: safeHost(w.url), href: w.url } }] : []),
    ],
  };
}

const safeHost = (url: string) => { try { return new URL(url).host; } catch { return url; } };

/** What `toItem` reads of a row's palette: the section label, whether details are lazy, the rows' shared actions, its icon and kind (a tile's colour tints the rows' plain glyphs, except in a catalog or a grid, where the glyphs are the content). */
export type PaletteInfo = Pick<SourceInfo, "title" | "detail" | "actions" | "icon" | "view" | "tier">;

/** The brand colour a palette's rows are marked in: its tile icon's, unless its glyphs are what it lists (a catalog, a grid). */
export const brandOf = (p: Pick<PaletteInfo, "icon" | "view" | "tier">): Brand | undefined => {
  if (p.view === "grid" || p.tier === "catalog") return undefined;
  const i = iconOf(p.icon, "");
  return i?.kind === "tile" ? i.bg : undefined;
};

/**
 * A row's icon with its palette's colour: a plain Nerd Font glyph (no
 * colour of its own, not a letter fallback) in a palette whose icon is a
 * tile takes the tile's brand as its tint, so the rows of an extension are
 * marked in its colour rather than grey; a favicon's globe fallback the
 * same. Anything else is as it came.
 */
const tintedBy = (icon: Icon | undefined, brand: Brand | undefined): Icon | undefined => {
  if (!brand || !icon) return icon;
  if (icon.kind === "glyph" && !icon.color && !icon.tint && isSymbol(icon.value)) return { ...icon, tint: brand };
  if (icon.kind === "favicon" && !icon.tint) return { ...icon, tint: brand };
  return icon;
};

/**
 * `palette.detail === "lazy"`: the palette answers `detail(id)`. An item
 * whose inline detail has no markdown then keeps what it has (or the
 * generic one) and is marked to ask; the reply is merged over it
 * (`mergeDetail`). A row without `actions` gets the palette's.
 */
export function toItem(hit: WireHit, palette: PaletteInfo): Item {
  const w = hit.item;
  const { title: paletteTitle, actions: shared } = palette;
  const lazy = palette.detail === "lazy";
  const key = sourceKey(hit.source);
  return {
    id: w.id,
    name: w.name,
    subtitle: w.subtitle,
    icon: tintedBy(iconOf(w.icon, w.name, w.url), brandOf(palette)),
    keywords: w.keywords,
    palette: key,
    source: hit.source,
    section: w.section,
    accessories: w.accessories ?? (key === PALETTES ? [{ text: "Palette" }] : typeof w.hex === "string" ? [{ tag: w.hex, color: w.hex }] : undefined),
    detail: w.detail ?? detailOf(w, paletteTitle),
    lazyDetail: lazy && !w.detail?.markdown ? true : undefined,
    actions: (w.actions ?? shared)?.map(toAction),
    // The core's "N more in X" row after a capped section (`more_row` in src-tauri/src/index.rs): muted, Enter opens the palette.
    muted: w.more === true ? true : undefined,
    group: hit.group,
    push: w.push && typeof w.push === "object" && typeof w.push.extension === "string" && typeof w.push.palette === "string" ? { extension: w.push.extension, palette: w.push.palette, args: w.push.args, query: typeof w.push.query === "string" ? w.push.query : undefined } : undefined,
  };
}

/** A `detail(id)` reply over the item's inline detail: what the reply has wins, the rest stays. */
export const mergeDetail = (inline: Detail | undefined, reply: unknown): Detail => {
  const r = reply && typeof reply === "object" ? (reply as Detail) : {};
  return { markdown: r.markdown ?? inline?.markdown, metadata: r.metadata ?? inline?.metadata };
};

/** A host `list` reply as hits: unranked rows, in the order given, no match positions. */
export const toLiveHits = (source: Source, items: WireItem[], palette: PaletteInfo) =>
  items.map((item) => ({ item: toItem({ source, id: item.id, score: 0, name_positions: [], item }, palette) }));
