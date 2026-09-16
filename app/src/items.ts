/**
 * Adapts what the core sends per hit (a host item, fields pass through) to
 * the UI item model. Provisional, like the wire shape it reads.
 */
import { isSymbol } from "./ui/icons";
import type { Accessory, Action, Detail, FilterOption, FormField, FormSpec, FormValues, Icon, Item, ViewSpec } from "./ui/types";

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
  /** `Action` in host/protocol.ts: id, title, shortcut?, style?, confirm?. */
  actions?: Action[];
  /** As in host/protocol.ts; both replace what would be derived here. */
  accessories?: Accessory[];
  detail?: Detail;
  [extra: string]: unknown;
};

/** One row of the `query` command's reply (`HitView` in src-tauri/src/index.rs). */
export type WireHit = { source: Source; id: string; score: number; name_positions: number[]; item: WireItem };

/** One row of the `sources` command's reply (`SourceView`): `PaletteMeta` plus the count. */
export type SourceInfo = Source & {
  title: string;
  live: boolean;
  input: boolean;
  icon?: string;
  /** `view`: opened as a view level (the palette answers `view(ctx)`), never listed. */
  view?: "list" | "grid" | "view";
  columns?: number;
  placeholder?: string;
  /** Open with the detail pane showing. */
  showDetail?: boolean;
  /** The palette answers `detail(id)` for an item whose inline detail has no markdown. */
  detail?: "lazy";
  /** A scope dropdown inside the palette; first is the default. */
  filters?: FilterOption[];
  /** Seconds the core keeps a listing before listing again on load. */
  ttl?: number;
  count: number;
  /** The rows are a restored (or expired) listing and a fresh one is pending: "updating" in the footer. */
  stale: boolean;
  /** Unix seconds of the listing the rows came from. */
  listed_at?: number;
};

/** How a level was opened (`Ctx` in host/protocol.ts): the filter picked, the args of the `push` that opened it, a form's values on its submit. */
export type Ctx = { filter?: string; args?: unknown; values?: FormValues };

/** What a pick returns (`Effect` in host/protocol.ts); `copy` and `open` already ran in the core. */
export type Effect = {
  copy?: string;
  open?: string;
  paste?: unknown;
  hide?: true;
  toast?: { title: string; message?: string; style?: "success" | "failure" };
  /** Shown by the core in the HUD window after the panel hides. */
  hud?: string;
  keep?: true;
  /** Drill in: a level scoped to that palette, its `list` given `args`. */
  push?: { extension: string; palette: string; args?: unknown };
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
const toAction = (a: Action): Action => ({ id: String(a.id), title: String(a.title ?? a.id), shortcut: a.shortcut, style: a.style, confirm: a.confirm });

/** A `View` off the wire as the UI keeps it; the host has checked the tree. */
export const toView = (v: ViewSpec): ViewSpec => ({ tree: v.tree, actions: (v.actions ?? []).map(toAction), title: v.title, id: v.id, keys: v.keys });

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

const pictographic = /\p{Extended_Pictographic}/u;

/**
 * `{ app: path }` (or a bare path, as v1 rows carry) is the app's artwork;
 * `{ image: url }` a picture to load as is; a hex colour is a tinted dot; a
 * private-use codepoint is a Nerd Font glyph (the bundled symbols font); a
 * pictograph is an emoji (the platform's colour font); any other string is
 * a glyph in the mono font. No icon: the favicon when there is a url, else
 * the name's initial.
 */
export function iconOf(icon: unknown, name: string, url?: string): Icon | undefined {
  const letter = name ? name[0].toUpperCase() : "";
  const obj = icon && typeof icon === "object" ? (icon as { app?: unknown; image?: unknown }) : undefined;
  if (typeof obj?.app === "string") return { kind: "app", path: obj.app, letter };
  if (typeof obj?.image === "string") return { kind: "image", src: obj.image, mask: "rounded" };
  const s = typeof icon === "string" ? icon.trim() : "";
  if (s.startsWith("/")) return { kind: "app", path: s, letter };
  if (s) {
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return { kind: "glyph", value: "●", color: s };
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

/**
 * `lazy`: the palette answers `detail(id)`. An item whose inline detail has
 * no markdown then keeps what it has (or the generic one) and is marked to
 * ask; the reply is merged over it (`mergeDetail`).
 */
export function toItem(hit: WireHit, paletteTitle: string, lazy = false): Item {
  const w = hit.item;
  const palette = sourceKey(hit.source);
  return {
    id: w.id,
    name: w.name,
    subtitle: w.subtitle,
    icon: iconOf(w.icon, w.name, w.url),
    keywords: w.keywords,
    palette,
    source: hit.source,
    section: w.section,
    accessories: w.accessories ?? (palette === PALETTES ? [{ text: "Palette" }] : typeof w.hex === "string" ? [{ tag: w.hex, color: w.hex }] : undefined),
    detail: w.detail ?? detailOf(w, paletteTitle),
    lazyDetail: lazy && !w.detail?.markdown ? true : undefined,
    actions: w.actions?.map(toAction),
  };
}

/** A `detail(id)` reply over the item's inline detail: what the reply has wins, the rest stays. */
export const mergeDetail = (inline: Detail | undefined, reply: unknown): Detail => {
  const r = reply && typeof reply === "object" ? (reply as Detail) : {};
  return { markdown: r.markdown ?? inline?.markdown, metadata: r.metadata ?? inline?.metadata };
};

/** A host `list` reply as hits: unranked rows, in the order given, no match positions. */
export const toLiveHits = (source: Source, items: WireItem[], paletteTitle: string, lazy = false) =>
  items.map((item) => ({ item: toItem({ source, id: item.id, score: 0, name_positions: [], item }, paletteTitle, lazy) }));
