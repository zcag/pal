// The contract: what an extension implements (`Extension`, `Palette`, what
// `list` answers and `pick` returns) and the wire shapes of the Rust core
// <-> extension host stdio link. One file so both sides compile against it.
//
// PROVISIONAL: pal is unreleased (0.x) and these shapes still move; a
// change that breaks an extension bumps the minor version of `@zcag/pal`
// until 1.0. What is marked provisional below is likelier to move than the
// rest.
//
// The wire: one JSON object per line, both directions. Both sides send
// requests: the core asks the host to `list`/`pick`/`detail`/`view`, the
// host asks the core for a capability with a `core/<capability>.<fn>`
// method (`core/clipboard.list`), and each answers on its own output. A
// line is classified by shape alone: a `method` makes it a request (with an
// id) or a notification (without); no `method` makes it a response. Each
// side numbers its own requests, so ids only have to be unique per
// direction. An extension never sees these three envelopes; they are here
// for a host or a test harness.

/** A request on the wire: the sender's own `id`, echoed by the `Response`. */
export type Request = { id: number; method: string; params?: unknown };
/** The answer to a `Request`: `result` on success, else `error` (a message). */
export type Response = { id: number; result?: unknown; error?: string };
/** A request without an id: nothing answers it (`host/ready`, `settings/changed`). */
export type Notification = { method: string; params?: unknown };

/**
 * Right-aligned on a row: a run of `text`, a `tag` (a badge, `color` from
 * the tag palette, `TagColor`), or a `date` (an ISO string or unix ms) the
 * UI shows relative ("3 h ago").
 */
export type Accessory = { text: string } | { tag: string; color?: string } | { date: string | number };

/** One line of the detail pane's metadata list: a `label` with a `value`, tags, or a link. */
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
 * load (an `icon://` one from `api.ts`, or any http(s) url). `template` is
 * for a bar item on the macOS menu bar: the image is a mask the system tints.
 */
export type Icon = string | { app: string } | { image: string; template?: boolean };

/**
 * One row, what `list` answers. Only `id` and `name` are required. The
 * core indexes and ranks rows by `name`, `subtitle` and `keywords`; the
 * UI draws the rest. Keys beyond these ride through the core untouched
 * and come back on nothing: `pick` gets the `id`, so keep what a pick
 * needs in your own table, keyed by it.
 */
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
   * action panel. Omitted: the palette's `actions`, else one default "Open"
   * action, `pick(id)` with no action id. Empty: an inert row (a hint).
   */
  actions?: Action[];
  /**
   * Anything else rides along untouched (the core keeps unknown keys, the
   * UI ignores them). For a field of your own, a future version of the
   * shape cannot collide with; `pick` does not get it back.
   */
  [extra: string]: unknown;
};

/**
 * One thing a row can do. The first in `Item.actions` runs on Enter, the
 * second on Cmd+Enter, all of them from the action panel (Cmd+K). In a
 * `View`, the same shape lists what a key does.
 */
export type Action = {
  id: string;
  title: string;
  /**
   * "cmd+shift+c": lower-case, "+" joined; cmd is the platform's primary
   * modifier. Bare keys in a view with `keys: "actions"`: a letter, a digit,
   * `space`, `backspace`, `delete`, `up`/`down`/`left`/`right`, `+`, `-`.
   * An array lists alternatives (`["up", "k"]`): any of them runs the
   * action, the panel draws the first and the rest faintly.
   */
  shortcut?: string | string[];
  style?: "destructive";
  /** Ask first; the question shown, with the action's title as the go-ahead. */
  confirm?: string;
  /**
   * Routes its key, is never listed: not in ⌘K, not in the footer, and not
   * one of the Enter / ⌘Enter pair (those are the first two listed). Needs
   * a `shortcut`, else nothing could reach it (`checkView` refuses one
   * without). Wordle's letters: 26 actions that would swamp the panel.
   */
  hidden?: true;
};

// ---- view: a declarative render tree -------------------------------------
// A level the UI draws from a small fixed vocabulary, never HTML: a game
// board, a dashboard, a card. The extension sends a tree, the UI renders it
// with the tokens; a pick from it carries an action id and usually answers
// with a new tree. `view.ts` (`checkView`) checks a tree before it goes out.

/** The tag palette (`--pal-tag-*` in the app's tokens): what a badge, a tag accessory, a text node, a tile or a progress bar may be coloured. */
export type TagColor = "grey" | "blue" | "green" | "amber" | "red" | "violet" | "pink" | "teal";

/**
 * How a keyed node comes, goes and moves. `enter` runs when the node first
 * appears (its key was not in the previous tree): `fade`, `slide-up` (the
 * brief's rise, `--pal-motion-slide`, 6 px) and its siblings `slide-down`,
 * `slide-left`, `slide-right` (the node arrives from that side), `flip`
 * (a horizontal unfold, for a card turning over), `pop` (a scale from
 * 0.8, for a merged tile or a typed letter). `exit` when its key leaves:
 * `fade` (the default) or `none` (gone at once; a face-down card replaced
 * by its face). `delay` staggers the entrance in steps of `--pal-dur-fast`
 * (0..8), so a deal lands one card at a time. `move`: when the key was in
 * the previous tree at another place (another cell, another parent), the
 * node slides from its old box to its new one (`--pal-motion-move`)
 * instead of entering, and the old place shows nothing of it; a 2048 tile
 * keyed by its id slides across the board. A `move` key must be unique in
 * the whole tree, not only among its siblings (`checkView` refuses two).
 * Durations and easings are the tokens'; reduced motion turns them off.
 */
export type Transition = {
  enter?: "fade" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "flip" | "pop";
  exit?: "fade" | "none";
  delay?: number;
  move?: true;
};

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

/**
 * One node of a `View.tree`, by `type`. A node of a type the app does not
 * know is skipped (not an error), so a newer extension still draws on an
 * older app. Every node may carry `key` and `transition` (`NodeBase`).
 * Provisional: node types get added; fields of the ones here stay.
 */
export type ViewNode =
  /**
   * A flex box. `grow` takes the free space along its parent; `minHeight`
   * (px) holds a row's height while its keyed children come and go.
   * `surface` paints it: `sunken` (`--pal-bg-sunken`, a well behind a
   * board) or `elevated` (`--pal-bg-elevated` with a hairline, a card
   * behind stats); `radius` rounds it (`--pal-radius-tile`). A surface
   * without `padding` sits flush against its children, so give it some.
   */
  | (NodeBase & { type: "stack"; direction?: "row" | "column"; gap?: Space; padding?: Space; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "between"; grow?: boolean; minHeight?: number; surface?: "sunken" | "elevated"; radius?: boolean; children: ViewNode[] })
  /**
   * One run of text. `style`: `title` (15 px semibold), `body` (13 px),
   * `muted` (13 px, muted colour), `mono` (12 px mono), `number` (tabular
   * figures, semibold). `size`/`weight`/`color` refine it: colours are
   * the tag palette plus `accent`, `success`, `destructive`, `muted`, `faint`.
   * `width` fixes the run's width in px (a column of labels that line up),
   * `minWidth` only its least; `align` places the text inside that width.
   */
  | (NodeBase & { type: "text"; value: string; style?: "title" | "body" | "muted" | "mono" | "number"; weight?: "regular" | "medium" | "semibold"; size?: "xs" | "sm" | "md" | "lg" | "xl"; color?: TagColor | "accent" | "success" | "destructive" | "muted" | "faint"; width?: number; minWidth?: number; align?: "start" | "center" | "end" })
  /** An `icon://` url or a `data:image/...` the extension produced (an SVG it drew); anything else is not shown. Sized in px. */
  | (NodeBase & { type: "image"; src: string; width?: number; height?: number; mask?: "circle" | "rounded"; alt?: string })
  /**
   * A rounded box of `width` by `height` px with `text` centred in it and
   * `sub` small under the text, drawn with the tokens so it follows the
   * theme: a game tile, a keycap of an on-screen keyboard, a stat. `color`
   * is the tag palette plus `neutral` (the panel's own greys, the default)
   * and `accent`; `fill` is `solid` (the colour, ink on it), `soft` (the
   * colour's tint, the colour as ink; the default) or `outline` (a
   * hairline, no fill). The text is tabular and gets heavier as the box
   * grows, and shrinks to fit its length.
   */
  | (NodeBase & { type: "tile"; width: number; height: number; text?: string; sub?: string; color?: TagColor | "neutral" | "accent"; fill?: "solid" | "soft" | "outline" })
  /** A tag, as on a row. */
  | (NodeBase & { type: "badge"; text: string; color?: TagColor })
  /** A hairline across the stack (vertical in a row). */
  | (NodeBase & { type: "divider" })
  /** Free space, or `size` px of it. */
  | (NodeBase & { type: "spacer"; size?: number })
  /** A bar filled to `value` (0..1); `width` in px, else it takes the free space; `color` from the tag palette, else the accent. */
  | (NodeBase & { type: "progress"; value: number; width?: number; color?: TagColor })
  /** A shortcut as key caps, in the `Action.shortcut` spelling (`h`, `cmd+k`, `up`). */
  | (NodeBase & { type: "keycap"; keys: string });

/**
 * A view level: the search input is hidden, the body is `tree`, the footer
 * shows the first action and "Actions ⌘K", ⌘K lists `actions` with their
 * keys (those not `hidden`). `keys: "actions"`: a bare key runs the action
 * carrying it as its `shortcut` (`h`, `space`, `backspace`, `+`, `up`);
 * Enter is always the first listed action, ⌘Enter the second, Escape
 * always leaves. A pick from the view is `pick(id, action, ctx)` with this
 * `id` (default `view`) and the action's id; answering with a new
 * `{ view }` replaces the level's tree, so the loop is key, pick, tree.
 * Keys pressed while a pick is on its way queue (four at most) and run
 * against the tree the reply brings, so fast typing loses nothing; the
 * queue is dropped when the level changes. An action id may not start
 * with `pal:` (the shell's own).
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
  /** The files themselves onto the clipboard (file URLs on macOS, `text/uri-list` on Linux); "Copied" in the HUD like `copy`. A backend that cannot take a file list makes the pick a failure toast. */
  copy_files?: string[];
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

/**
 * What a palette's rows are at the root next to everyone else's. `primary`:
 * reached by name (apps, windows, bookmarks, quicklinks); `normal`: browsed
 * (containers, pull requests, devices), the default; `catalog`: a big
 * static list where any query matches dozens of rows (emoji, icons,
 * unicode, colours). The core ranks a tier's rows up or down and caps how
 * many one palette shows at the root (`docs/extensions.md`, "tier"); the
 * config file can override it per palette.
 */
export type Tier = "primary" | "normal" | "catalog";

type PaletteBase = {
  /** Section label at the root; the manifest's `title` wins over it, the palette key stands in when neither has one. */
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
   * re-lists on every show. The manifest's `ttl` is the one that counts
   * (`checkPalettes`); this one is a fallback while the manifest has none.
   */
  ttl?: number;
  /** The palette's tier at the root; the manifest may declare it instead. */
  tier?: Tier;
  /**
   * The actions of every row that declares none of its own: sent once with
   * the palette's meta rather than on every item, which is what a catalog
   * of thousands of rows with the same four actions wants (eleven thousand
   * copies of `Copy glyph` were half of the icons listing on the wire). A
   * row's own `actions` replace them whole; `[]` on a row still means inert.
   */
  actions?: Action[];
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

/**
 * What an extension declares under a key of `Extension.palettes`: rows
 * (`ListPalette`, has `list`) or a drawing (`ViewPalette`, has `view`).
 * Both share `PaletteBase`: `title`, `icon`, `pick`, `detail`, the flags.
 */
export type Palette = ListPalette | ViewPalette;

// ---- bar: glanceable state on the menu bar / sketchybar --------------------
// An extension puts an item on the bar (`docs/design/bar.md`): one `render`
// answers the item's whole state, the core diffs it and draws it on every
// target, and a click opens pal's own popover (a menu level, a palette, a
// view) or asks the extension for an Effect. `view.ts` (`checkBarItem`)
// checks an item before it goes out, as `checkView` does a tree.

/** What an item may be coloured: the tag palette plus the bar's own text roles. */
export type BarColor = TagColor | "text" | "muted" | "accent" | "destructive";

/** One coloured run of a strip (`BarItem.segments`): a small glyph and/or text with its own colour. */
export type BarSegment = { id: string; icon?: string; text?: string; color?: BarColor; tooltip?: string };

/**
 * What `render` answers: the item's whole state. The core diffs it against
 * the last one and touches only what changed on each target.
 */
export type BarItem = {
  /** The rule: true takes no space, on every target. `render` keeps running. */
  hidden?: boolean;
  /** A glyph (drawn from the bundled Nerd Font), an emoji, `{ image }` (`icon://`, `data:image/`), `{ app }`. `Icon`'s image form gains `template?: boolean`. */
  icon?: Icon;
  /** Text beside the icon: a count, a code, a track. Short; the menu bar has no truncation of its own. */
  title?: string;
  /** Extra runs after the title, each its own colour: prs' four state counts. Menu bar: joined into the title text. */
  segments?: BarSegment[];
  /** A count, or a dot: drawn as a small red mark on the icon (menu bar), a coloured count after the label (sketchybar). */
  badge?: number | "dot";
  /** Tints the icon and the title. Menu bar: the icon is a template image (system tint) unless a colour is set. */
  color?: BarColor;
  /** Draws the item as an alarm (destructive colour, non-template icon) and the popover's title bar red. */
  urgent?: boolean;
  /** The number could not be refreshed: muted, tooltip says so. Set by the core on a failed render too. */
  stale?: boolean;
  /** 0..1, drawn as a thin fill under the icon (menu bar image) or a rule of box-drawing characters (sketchybar). */
  progress?: number;
  tooltip?: string;
  /** Seconds until the next `render`, this once (prs: 60 while checks run, else the manifest's `every`). */
  refresh?: number;
  /** What a click, the item's hotkey or a hover peek opens. Absent: the click is `bar/open` and the extension answers an Effect; hover does nothing. */
  menu?: BarMenu;
};

/**
 * Always pal's popover, on every target. `nodes`: a menu level (rows with
 * shortcuts, ticks, sections, submenus). `{ palette }`: that palette level
 * (any extension's), `args` as for `Effect.push`. `{ view }`: the tree as a
 * view level.
 */
export type BarMenu = BarMenuNode[] | { palette: string; extension?: string; args?: unknown } | { view: View };

export type BarMenuNode =
  /** A row; `action` (default `id`) reaches `onAction`. `checked` draws a tick, `disabled` greys it. */
  | { type: "item"; id: string; title: string; subtitle?: string; icon?: Icon; shortcut?: string; checked?: boolean; disabled?: boolean; style?: "destructive"; action?: string }
  /** A captioned group; separators around it are the renderer's. */
  | { type: "section"; title?: string; children: BarMenuNode[] }
  | { type: "submenu"; title: string; icon?: Icon; children: BarMenuNode[] }
  | { type: "separator" };

/** When the core asks `render` again. `every` is seconds (min 10, like Raycast's interval); `on` adds triggers. */
export type BarRefresh = { every?: number; on?: ("show" | "wake" | "network" | "focus" | "minute")[] };

/** `pal.json`: `bar.<id>`, readable without code (the Settings window lists it, hidden or not). */
export type ManifestBar = { title: string; description?: string; refresh?: BarRefresh };

/** Why `render` runs, and what a popover-opening click carried. */
export type BarCtx = { reason: "load" | "every" | "show" | "wake" | "network" | "focus" | "minute" | "settings" | "update" | "cli" | "open"; anchor?: "menubar" | "sketchybar" | "hotkey" | "cli" };

export type BarSource = {
  render(ctx: BarCtx): BarItem | Promise<BarItem>;
  /** A menu node was picked (its `action`), or a segment clicked (`segment:<id>`). Any Effect; `keep` re-renders the item. */
  onAction?(action: string, ctx: BarCtx): Effect | void | Promise<Effect | void>;
  /** A click on an item without `menu`. */
  onOpen?(ctx: BarCtx): Effect | void | Promise<Effect | void>;
  /** The popover opened on the item (a peek counts; `bar/shown`): warm the cache the palette or view will read. */
  onShown?(ctx: BarCtx): void | Promise<void>;
};

/** What `hello` and `extension/loaded` (host to core) say about a bar item: the manifest's entry with its id, and whether the code has a `BarSource` for it (false: an error row in Settings, never rendered). */
export type BarMeta = ManifestBar & { id: string; source: boolean };

/**
 * The default export of an extension's `index.ts`: its palettes by key,
 * and its bar items by id (`bar.<id>` in the manifest). The key is the
 * palette's id in the config file (`[palettes.<id>]`), the manifest
 * (`Manifest.palettes`) and an `Effect.push`. Write it as
 * `export default defineExtension({ palettes: { ... } })`, or with
 * `satisfies Extension`. `dispose` runs before the extension is reloaded
 * or removed: clear the intervals and watchers a bar item runs, since the
 * old module instance stays resident and what it left running would keep
 * pushing.
 */
export type Extension = { palettes: Record<string, Palette>; bar?: Record<string, BarSource>; dispose?(): void | Promise<void> };

// ---- manifest (pal.json) -------------------------------------------------
// Read by the host without running the extension's code, so the settings
// window can show an extension whose code fails to load. Mirrored by hand in
// app/src/ui/SettingsTypes.ts.

/** One choice of a `select` setting: `id` is the stored value, `title` what the window shows. */
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

/**
 * What a palette is, in one word, as the manifest states it and the code
 * implies it (`kindOf` in manifest.ts): `view` answers `view(ctx)`, `grid`
 * is `view: "grid"`, `input` is `input: true`, `live` is `live: true`
 * without `input`, else `list`. The two must agree (`checkPalettes`).
 */
export type PaletteKind = "list" | "live" | "input" | "grid" | "view";

/** One line of a palette's key table in the manifest: what a key does, for the store and the settings window. */
export type ManifestKey = { keys: string; title: string };

/**
 * What the manifest says about one palette: its static, author-facing
 * description (docs/extensions.md, "Where a palette is described"). The
 * code defines the behaviour; where both say a thing (`title`, `ttl`) the
 * manifest wins and the host warns if they differ.
 */
export type ManifestPalette = {
  /** The section label at the root and the settings window's row; over the code's. */
  title?: string;
  description?: string;
  /** Must agree with what the code implies; a mismatch is a load warning. */
  kind?: PaletteKind;
  /** The key table the store and the settings window show. */
  keys?: ManifestKey[];
  /** Where the palette sorts among the bundled ones (lower first). */
  rank?: number;
  settings?: SettingSpec[];
  /** See `Palette.ttl`; this value wins over the code's. */
  ttl?: number;
  /** See `Palette.tier`; this value wins over the code's. */
  tier?: Tier;
};

/**
 * `pal.json`, next to `index.ts`. `name` and `version` are required by
 * `pal install`; the rest is what the settings window shows and the
 * settings the extension declares.
 */
export type Manifest = {
  /** The directory name and the config key: lowercase letters, digits, `-`, `_`, `.`. */
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
  /** The bar items, keyed by their id in `Extension.bar`: title and refresh schedule, readable without the code. */
  bar?: Record<string, ManifestBar>;
};

/** Resolved values one extension sees: manifest defaults with the file's keys on top. */
export type ResolvedSettings = { settings: Record<string, unknown>; palettes: Record<string, Record<string, unknown>> };

/** `settings/changed`, core to host: every extension's resolved values (or the ones that changed). */
export type SettingsChanged = { extensions: Record<string, ResolvedSettings> };

/**
 * What `hello` and `extension/loaded` (host to core) say about a palette:
 * the flags the core and the UI need without the code, the manifest's
 * `title` and `ttl` merged over the code's (`checkPalettes`, manifest.ts).
 * Both messages carry `warnings: string[]` next to `palettes`: where the
 * manifest and the code disagreed, empty when they did not.
 */
export type PaletteMeta = Pick<PaletteBase, "icon" | "columns" | "placeholder" | "showDetail" | "filters" | "ttl" | "tier" | "actions"> & {
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
