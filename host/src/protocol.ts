// PROVISIONAL. Wire shapes for the Rust core <-> extension host stdio link,
// and the surface an extension implements (`Extension`, `Palette`). Written
// down so both sides compile against one file; the contract is still being
// settled in notes/decisions.md, so change freely. One JSON object per line,
// both directions. Requests carry an id, responses echo it, notifications
// have none.
//
// Both sides send requests: the core asks the host to `list`/`pick`/`detail`, the host
// asks the core for a capability with a `core/<capability>.<fn>` method
// (`core/clipboard.list`), and each answers on its own output. A line is
// classified by shape alone: a `method` makes it a request (with an id) or
// a notification (without); no `method` makes it a response. Each side
// numbers its own requests, so ids only have to be unique per direction.

export type Request = { id: number; method: string; params?: unknown };
export type Response = { id: number; result?: unknown; error?: string };
export type Notification = { method: string; params?: unknown };

export type Accessory = { text: string } | { tag: string; color?: string } | { date: string | number };

export type Metadata = {
  label: string;
  value?: string;
  tags?: { text: string; color?: string }[];
  link?: { text: string; href: string };
};

/** Side pane: markdown (no raw HTML; `icon://` images work) over a metadata list. */
export type Detail = { markdown?: string; metadata?: Metadata[] };

/**
 * A glyph/emoji/hex string, `{ app }` for an application's own artwork (the
 * `.app` bundle or `.desktop` file), or `{ image }` for a url the webview can
 * load (an `icon://` one from `api.ts`, or any http(s) url).
 */
export type Icon = string | { app: string } | { image: string };

export type Item = {
  /** Stable across listings: frecency and the cursor are keyed by it. Unique within the palette. */
  id: string;
  name: string;
  subtitle?: string;
  icon?: Icon;
  keywords?: string[];
  /** An item with a url and no icon gets the site's favicon. */
  url?: string;
  /** Right-aligned on the row; the UI derives none when absent. */
  accessories?: Accessory[];
  /** The detail pane's content; the UI derives a generic one when absent. */
  detail?: Detail;
  /**
   * First is primary (Enter), second secondary (Cmd+Enter), all in the
   * action panel. Omitted: one default "Open" action, `pick(id)` with no
   * action id. Empty: an inert row (a hint).
   */
  actions?: Action[];
  /** Anything else rides along untouched to the UI and back to `pick`. */
  [extra: string]: unknown;
};

export type Action = {
  id: string;
  title: string;
  /** "cmd+shift+c": lower-case, "+" joined; cmd is the platform's primary modifier. */
  shortcut?: string;
  style?: "destructive";
  /** Ask first; the question shown, with the action's title as the go-ahead. */
  confirm?: string;
};

// ---- view: a declarative render tree -------------------------------------
// A level the UI draws from a small fixed vocabulary, never HTML: a game
// board, a dashboard, a card. The extension sends a tree, the UI renders it
// with the tokens; a pick from it carries an action id and usually answers
// with a new tree. `host/src/view.ts` checks a tree before it goes out.

/** The tag palette (`--pal-tag-*` in tokens.css). */
export type TagColor = "grey" | "blue" | "green" | "amber" | "red" | "violet" | "pink" | "teal";

/**
 * How a keyed node comes and goes. `enter` runs when the node first
 * appears (its key was not in the previous tree): `fade`, `slide-up` (the
 * brief's rise, 6 px), `flip` (a horizontal unfold, for a card turning
 * over). `exit` when its key leaves: `fade` (the default) or `none` (gone
 * at once; a face-down card replaced by its face). `delay` staggers the
 * entrance in steps of `--pal-dur-fast` (0..8), so a deal lands one card
 * at a time. Durations and easings are the tokens'; nothing else.
 */
export type Transition = { enter?: "fade" | "slide-up" | "flip"; exit?: "fade" | "none"; delay?: number };

type NodeBase = {
  /**
   * Stable across trees: the UI animates a node whose key is new and one
   * whose key is gone (`Transition`), and keeps the DOM of one that stays.
   * Unique among siblings. Without one a node is matched by position.
   */
  key?: string;
  transition?: Transition;
};

/** Spacing in steps of the 4 px grid (`--pal-space-1..6`); 0 is none. */
export type Space = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ViewNode =
  /** A flex box. `grow` takes the free space along its parent; `minHeight` (px) holds a row's height while its keyed children come and go. */
  | (NodeBase & { type: "stack"; direction?: "row" | "column"; gap?: Space; padding?: Space; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "between"; grow?: boolean; minHeight?: number; children: ViewNode[] })
  /**
   * One run of text. `style`: `title` (15 px semibold), `body` (13 px),
   * `muted` (13 px, muted colour), `mono` (12 px mono), `number` (tabular
   * figures, semibold). `size`/`weight`/`color` refine it: colours are
   * the tag palette plus `accent`, `success`, `destructive`, `muted`, `faint`.
   */
  | (NodeBase & { type: "text"; value: string; style?: "title" | "body" | "muted" | "mono" | "number"; weight?: "regular" | "medium" | "semibold"; size?: "xs" | "sm" | "md" | "lg" | "xl"; color?: TagColor | "accent" | "success" | "destructive" | "muted" | "faint" })
  /** An `icon://` url or a `data:image/...` the extension produced (an SVG it drew); anything else is not shown. Sized in px. */
  | (NodeBase & { type: "image"; src: string; width?: number; height?: number; mask?: "circle" | "rounded"; alt?: string })
  /** A tag, as on a row. */
  | (NodeBase & { type: "badge"; text: string; color?: TagColor })
  /** A hairline across the stack (vertical in a row). */
  | (NodeBase & { type: "divider" })
  /** Free space, or `size` px of it. */
  | (NodeBase & { type: "spacer"; size?: number })
  /** A bar filled to `value` (0..1); `width` in px, else it takes the free space. */
  | (NodeBase & { type: "progress"; value: number; width?: number })
  /** A shortcut as key caps, in the `Action.shortcut` spelling (`h`, `cmd+k`, `up`). */
  | (NodeBase & { type: "keycap"; keys: string });

/**
 * A view level: the search input is hidden, the body is `tree`, the footer
 * shows the first action and "Actions ⌘K", ⌘K lists `actions` with their
 * keys. `keys: "actions"`: a bare key runs the action carrying it as its
 * `shortcut` (`h`, `space`, `+`, `up`); Enter is always the first action,
 * Escape always leaves. A pick from the view is `pick(id, action, ctx)`
 * with this `id` (default `view`) and the action's id; answering with a
 * new `{ view }` replaces the level's tree, so the loop is key, pick, tree.
 * An action id may not start with `pal:` (the shell's own).
 */
export type View = { tree: ViewNode; actions: Action[]; title?: string; id?: string; keys?: "actions" };

// ---- form: a prompt with fields --------------------------------------------
// An effect that asks: the UI pushes a form level drawn from these fields,
// Enter submits it as a pick carrying the values, Escape leaves. The
// extension answers that pick like any other, or with another `form`
// carrying `errors` to show the same form again with the messages.

/**
 * One field. `id` is the key in `ctx.values`; `default` is the initial
 * value (a string, a boolean for a checkbox); `required` blocks the submit
 * while the field is empty (or, for a checkbox, unticked) with a message
 * under it; `description` is a line of help under the field.
 */
export type FormField = { id: string; label: string; placeholder?: string; required?: boolean; description?: string } & (
  | { kind: "text"; default?: string }
  | { kind: "textarea"; default?: string }
  | { kind: "password"; default?: string }
  | { kind: "select"; options: { id: string; title: string }[]; default?: string }
  | { kind: "checkbox"; text?: string; default?: boolean }
);

/** What `ctx.values` carries on the submit: a string per field, a boolean per checkbox. */
export type FormValues = Record<string, string | boolean>;

/**
 * A form level. The submit is `pick(id, submit.id, { values })` with this
 * `id` (default: the id of the row the form came from) and the values by
 * field id. `cancel` is the cancel button's label ("Cancel"). Answer the
 * submit with `{ form }` again, `errors` set by field id, and the form
 * stays with the messages under the fields (the typed values kept); any
 * other effect closes it and runs as from a row (`keep` lists again,
 * `toast` shows over the list, nothing hides).
 */
export type Form = { id?: string; title: string; fields: FormField[]; submit: { id: string; title: string }; cancel?: string; errors?: Record<string, string> };

/** `pal_core::windows::layout::Layout`, the wire names. */
export type WindowLayout =
  | "left_half" | "right_half" | "top_half" | "bottom_half"
  | "left_third" | "center_third" | "right_third" | "left_two_thirds" | "right_two_thirds"
  | "top_left_quarter" | "top_right_quarter" | "bottom_left_quarter" | "bottom_right_quarter"
  | "maximize" | "almost_maximize" | "center" | "reasonable_size"
  | "next_display" | "previous_display" | "restore";

/** `pal_core::windows::layout::Options`: the knobs, all optional (gap 0, 90%, 60%). */
export type WindowLayoutOptions = { gap?: number; almost_maximize_percent?: number; reasonable_size_percent?: number };

/** The `layout` effect's payload and `windows.layout`'s params, one shape. */
export type WindowLayoutRequest = WindowLayoutOptions & { name: WindowLayout; id?: string };

/**
 * What `pick` returns and the shell acts on. `copy` and `open` run in the
 * core; the window hides afterwards unless `keep` or `toast` is set (a
 * toast needs the window). Any other object hides too.
 */
export type Effect = {
  copy?: string;
  /** A url or a path, given to the OS opener. */
  open?: string;
  /**
   * Hide, then paste into the app that was in front: a history entry by id,
   * or text (which the watcher then records). Without Accessibility on
   * macOS the core shows a toast instead and asks for the permission once.
   */
  paste?: { entry: number } | { text: string };
  /**
   * Hide, then bring this window (an id from `windows.list`) to the front,
   * restoring it if minimised. Needs Accessibility on macOS like `paste`,
   * with the same toast when missing.
   */
  focus?: string;
  /**
   * Hide, then move and resize a window: `name` is a layout from
   * `WindowLayout`, `id` a window from `windows.list` (the focused window
   * when absent, which is why the panel hides first). The HUD then shows the
   * layout's name, or why it did not happen. Needs Accessibility on macOS
   * like `focus`, with the same toast when missing.
   */
  layout?: WindowLayoutRequest;
  hide?: true;
  toast?: { title: string; message?: string; style?: "success" | "failure" };
  /**
   * A line in the HUD (the small capsule at the bottom of the screen) once
   * the panel has hidden, for a pick with no other visible result; `copy`
   * shows "Copied" there by itself, this replaces that text.
   */
  hud?: string;
  /** Stay open and list again. */
  keep?: true;
  /**
   * Drill in: the UI pushes a level scoped to that palette (any extension's).
   * `args` reach its `list`/`pick`/`detail` as `ctx.args`, so a palette can
   * list the children of the picked item; a level with args is always listed
   * from the extension, never from the index.
   */
  push?: { extension: string; palette: string; args?: unknown };
  /** Show output: the UI pushes a detail-only level (the Detail, full width; `title` is the level's crumb). */
  show?: Detail & { title?: string };
  /** A render tree (`View`): from a list, pushes a view level; from a view, replaces its tree. */
  view?: View;
  /** A prompt (`Form`): pushes a form level; from a form, shows it again (with `errors`). */
  form?: Form;
};

/**
 * How the palette was opened, given to `list`/`pick`/`detail`: the chosen
 * `filter` id (absent means the first), and the `args` of an `Effect.push`
 * that opened this level (absent at the root and on a plain drill-in).
 * `refresh` on a `list`: the user asked for a fresh listing (the shell's
 * Refresh action), so a cache the palette keeps should step aside.
 * `values` on a `pick`: the submitted fields of an `Effect.form`.
 */
export type Ctx = { filter?: string; args?: unknown; refresh?: boolean; values?: FormValues };

type PaletteBase = {
  /** Section label at the root; the palette key otherwise. */
  title?: string;
  /** The palette's own row at the root: a glyph, emoji or hex colour (the string forms of `Icon`). */
  icon?: string;
  /**
   * Arrival order is the order (OTP codes, tabs, windows): never ranked by
   * use, and listed again every time the panel is shown so the rows are
   * current at the root (with `input` the rows are never at the root anyway).
   */
  live?: boolean;
  columns?: number;
  /**
   * Items are never indexed: `list(query)` runs on every keystroke inside
   * the palette and its rows show as returned. The root only has the
   * palette's own row.
   */
  input?: boolean;
  placeholder?: string;
  /** Open with the detail pane showing. */
  showDetail?: boolean;
  /**
   * A scope dropdown; the chosen id reaches `list` as `ctx.filter`. First is
   * the default. An indexed palette is listed again per filter (the core
   * caches each until the palette re-lists); an input palette gets it with
   * every keystroke.
   */
  filters?: { id: string; title: string }[];
  /**
   * Seconds a listing stays good for. The core persists every listing and
   * restores it at the next start; with a `ttl` it lists the palette again
   * only when the restored listing is older than that (in a low-priority
   * pass after startup), without one on every start as before. `live` still
   * re-lists on every show. The manifest may declare it instead.
   */
  ttl?: number;
  pick(id: string, action?: string, ctx?: Ctx): Effect | void | Promise<Effect | void>;
  /**
   * The detail pane's content for one item, asked when the pane is open and
   * the cursor rests on an item whose inline `detail` has no markdown (its
   * metadata may be inline; what comes back is merged over it). The host
   * caches the answer per item until the palette lists again. Declaring it
   * makes the palette `detail: "lazy"` in its meta.
   */
  detail?(id: string, ctx?: Ctx): Detail | void | Promise<Detail | void>;
};

/** Rows: `list` answers them; `view` names the layout inside. */
export type ListPalette = PaletteBase & {
  /** Inside the palette; the root is always a list. */
  view?: "list" | "grid";
  list(query?: string, ctx?: Ctx): Item[] | Promise<Item[]>;
};

/**
 * A view palette: no rows to index, the root has only its own row, and
 * opening it (Enter on that row, its hotkey, an `Effect.push` to it) asks
 * `view(ctx)` for the tree. Picks arrive at `pick` with the view's `id`
 * and the action's id; `ctx.args` are the push's.
 */
export type ViewPalette = PaletteBase & {
  view(ctx?: Ctx): View | Promise<View>;
  list?: never;
};

export type Palette = ListPalette | ViewPalette;

export type Extension = { palettes: Record<string, Palette> };

// ---- manifest (pal.json) -------------------------------------------------
// Read by the host without running the extension's code, so the settings
// window can show an extension whose code fails to load. Mirrored by hand in
// app/src/ui/SettingsTypes.ts.

export type SettingOption = { id: string; title: string };

type SettingBase = { id: string; label: string; description?: string };

/** One setting an extension declares, with its default. */
export type SettingSpec = SettingBase &
  (
    | { kind: "text"; placeholder?: string; default?: string }
    /** The file holds a `keychain:` or `env:` reference; the value never sits in it as plain text. */
    | { kind: "secret"; placeholder?: string; default?: string }
    | { kind: "number"; min?: number; max?: number; step?: number; unit?: string; default?: number }
    | { kind: "boolean"; text?: string; default?: boolean }
    | { kind: "select"; options: SettingOption[]; default?: string }
    | { kind: "hotkey"; default?: string }
    | { kind: "path"; pick?: "file" | "folder"; placeholder?: string; default?: string }
    | { kind: "list"; placeholder?: string; default?: string[] }
  );

/** What the manifest says about one palette; the code still defines it. */
export type ManifestPalette = { title?: string; description?: string; settings?: SettingSpec[]; /** See `Palette.ttl`; the code's value wins. */ ttl?: number };

export type Manifest = {
  name: string;
  title: string;
  description?: string;
  version?: string;
  /** A glyph, emoji or hex colour; the settings window's row for the extension. */
  icon?: string;
  author?: string;
  /** `bundled` for the ones that ship with pal, else a repo like `github.com/zcag/pal-github`. */
  repo?: string;
  /** Extension-level settings, `[extensions.<name>]` in the file. */
  settings?: SettingSpec[];
  /** Per-palette settings, `[palettes.<id>].settings` in the file, keyed by the palette's key in `Extension.palettes`. */
  palettes?: Record<string, ManifestPalette>;
};

/** Resolved values one extension sees: manifest defaults with the file's keys on top. */
export type ResolvedSettings = { settings: Record<string, unknown>; palettes: Record<string, Record<string, unknown>> };

/** `settings/changed`, core to host: every extension's resolved values (or the ones that changed). */
export type SettingsChanged = { extensions: Record<string, ResolvedSettings> };

/** What `hello` and `extension/loaded` say about a palette. */
export type PaletteMeta = Pick<PaletteBase, "icon" | "columns" | "placeholder" | "showDetail" | "filters" | "ttl"> & {
  name: string;
  title: string;
  live: boolean;
  /** Also true for a view palette: nothing of it is indexed. */
  input: boolean;
  /** `view`: the palette answers `view(ctx)`; the UI opens it as a view level. */
  view?: "list" | "grid" | "view";
  /** The palette answers `detail(id)`. */
  detail?: "lazy";
};
