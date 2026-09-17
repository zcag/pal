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
 * the tag palette, `TagColor`), a `date` (an ISO string or unix ms) the
 * UI shows relative ("3 h ago"), or `keys` (a shortcut, "cmd+shift+c")
 * drawn as key caps.
 */
export type Accessory = { text: string } | { tag: string; color?: string } | { date: string | number } | { keys: string };

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
/** A brand tile (`tile()` in icon.ts): a rounded square in one of the twelve brand colours with a white mark; `badge` is one or two characters in its corner (an instance's mark, docs/design/instances.md). */
export type TileIcon = { tile: ({ glyph: string; svg?: undefined } | { svg: string; glyph?: undefined }) & { bg: TileColorName; badge?: string } };
/** A glyph in a colour: a brand name, or a hex colour of the extension's own. */
export type TintedIcon = { glyph: string; color: TileColorName | `#${string}` };
export type TileColorName = "red" | "orange" | "amber" | "green" | "teal" | "cyan" | "blue" | "indigo" | "violet" | "pink" | "slate" | "ink";
export type Icon = string | { app: string } | { image: string; template?: boolean } | TileIcon | TintedIcon;
/** What a palette's or an extension's own icon may be: the string forms, or a tile. */
export type OwnIcon = string | TileIcon;

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
   * a symbol as typed (`#`, `+`, `-`, `=`), `space`, `backspace`, `delete`,
   * `tab`, `up`/`down`/`left`/`right`; `shift+up` and the other shifted
   * arrows and `shift+tab` reach a view as combos (a shifted arrow with no
   * action of its own runs the plain arrow's).
   * An array lists alternatives (`["up", "k"]`): any of them runs the
   * action, the panel draws the first and the rest faintly.
   */
  shortcut?: string | string[];
  style?: "destructive";
  /** Ask first; the question shown, with the action's title as the go-ahead. */
  confirm?: string;
  /**
   * Works on several rows at once: with rows marked (cmd+click, shift+↑↓,
   * Tab or `x` in a `multi` palette) the action panel lists only the actions that
   * say so, and Enter runs the first over the marked rows as one `pick`
   * whose `ctx.ids` is every marked id (`id` is the first). An action
   * without it is single-row only.
   */
  multi?: true;
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
 * A colour of the extension's own, as `#rgb`, `#rgba`, `#rrggbb` or
 * `#rrggbbaa` (`HEX_COLOR` in view.ts): a `tile` painted with it takes
 * black or white ink by contrast, and a translucent one shows a checker
 * through. Only hex: what a tile or a gradient stop is filled with never
 * needs another notation, and the app has no colour parser.
 */
export type HexColor = `#${string}`;

/** One linear gradient of a `gradient` node: `stops` (hex colours, evenly spread) along `direction`. */
export type GradientLayer = { stops: HexColor[]; direction?: "right" | "down" | "up" | "left" };

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
  /**
   * A click (a tap) on the node runs the view action with this id, as
   * its key would: the node draws as a control (a pointer, a hover lift).
   * The id must be one of the view's `actions` (`checkView`); a `hidden`
   * action reached this way needs no shortcut. A room tile that toggles
   * the room, a keycap that runs what it names.
   */
  action?: string;
  /** Draws the node as the one the keys are on: an accent ring on its box. One per view is the idea (a cursor), not a rule. */
  selected?: true;
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
   * behind stats), or a hex colour of the extension's own (`HexColor`,
   * alpha allowed: the box is that colour, the ink black or white by
   * contrast once it is opaque enough (alpha over 0.5) and the panel's
   * otherwise, so a faint tint keeps the panel's text; a room tile in
   * the room's colour); `radius` rounds it (`--pal-radius-tile`). A
   * surface without `padding` sits flush against its children, so give
   * it some.
   */
  | (NodeBase & { type: "stack"; direction?: "row" | "column"; gap?: Space; padding?: Space; align?: "start" | "center" | "end" | "stretch"; justify?: "start" | "center" | "end" | "between"; grow?: boolean; minHeight?: number; surface?: "sunken" | "elevated" | HexColor; radius?: boolean; children: ViewNode[] })
  /**
   * One run of text. `style`: `title` (15 px semibold), `body` (13 px),
   * `muted` (13 px, muted colour), `mono` (12 px mono), `number` (tabular
   * figures, semibold), `glyph` (the bundled symbols font, so a Nerd Font
   * glyph draws in a popover or a card; the value is the glyph, alone or
   * with a few characters). `size`/`weight`/`color` refine it: colours are
   * the tag palette plus `accent`, `success`, `destructive`, `muted`, `faint`.
   * `width` fixes the run's width in px (a column of labels that line up),
   * `minWidth` only its least; `align` places the text inside that width.
   */
  | (NodeBase & { type: "text"; value: string; style?: "title" | "body" | "muted" | "mono" | "number" | "glyph"; weight?: "regular" | "medium" | "semibold"; size?: "xs" | "sm" | "md" | "lg" | "xl"; color?: TagColor | "accent" | "success" | "destructive" | "muted" | "faint"; width?: number; minWidth?: number; align?: "start" | "center" | "end" })
  /** An `icon://` url or a `data:image/...` the extension produced (an SVG it drew); anything else is not shown. Sized in px. `dot` is a small filled circle on the bottom-right corner in that colour, ringed by the panel: an avatar's presence (green active, grey away, red do not disturb). */
  | (NodeBase & { type: "image"; src: string; width?: number; height?: number; mask?: "circle" | "rounded"; alt?: string; dot?: TagColor })
  /**
   * A rounded box of `width` by `height` px with `text` centred in it and
   * `sub` small under the text, drawn with the tokens so it follows the
   * theme: a game tile, a keycap of an on-screen keyboard, a stat. `color`
   * is the tag palette plus `neutral` (the panel's own greys, the default)
   * and `accent`, or a hex colour of the extension's own (`HexColor`:
   * the box is that colour whatever the `fill`, the ink black or white
   * by contrast, a translucent one over a checker); `fill` is `solid`
   * (the colour, ink on it), `soft` (the colour's tint, the colour as
   * ink; the default) or `outline` (a hairline, no fill). The text is
   * tabular and gets heavier as the box grows, and shrinks to fit its
   * length.
   */
  | (NodeBase & { type: "tile"; width: number; height: number; text?: string; sub?: string; color?: TagColor | "neutral" | "accent" | HexColor; fill?: "solid" | "soft" | "outline" })
  /**
   * A box of `width` by `height` px painted with CSS linear gradients,
   * for a colour picker's hue strip or its saturation/value plane: `fill`
   * is a hex colour under everything, each layer's `stops` are hex
   * colours (alpha allowed, `#ffffff00`) spread evenly along `direction`
   * (`right`, the default, `down`, `up`, `left`), in paint order, so a
   * later layer composites over an earlier one. The classic plane is
   * exactly `fill` the pure hue, then `#ffffff` to `#ffffff00` rightwards,
   * then `#000000` to `#00000000` upwards. `marker` is a ring at that point
   * (fractions 0..1 of the box, `x` along, `y` down), drawn to read on any
   * colour. The corners take the tile radius.
   */
  | (NodeBase & { type: "gradient"; width: number; height: number; layers: GradientLayer[]; fill?: HexColor; marker?: { x: number; y: number } })
  /** A tag, as on a row. */
  | (NodeBase & { type: "badge"; text: string; color?: TagColor })
  /** A hairline across the stack (vertical in a row). */
  | (NodeBase & { type: "divider" })
  /** Free space, or `size` px of it. */
  | (NodeBase & { type: "spacer"; size?: number })
  /** A bar filled to `value` (0..1); `width` in px, else it takes the free space; `color` from the tag palette or a hex colour of the extension's own, else the accent. */
  | (NodeBase & { type: "progress"; value: number; width?: number; color?: TagColor | HexColor })
  /**
   * A level the user sets: a track filled to `value` (0..1) with a round
   * thumb at the fill's end, `width` px (else the free space), `color`
   * as for `progress`. Drawn as a control (`role="slider"`); it moves by
   * the view's own keys (an action per step) and, with `action`, a
   * click on it runs that action with the clicked fraction as
   * `ctx.values.value` ("0.62"). A volume, a brightness.
   */
  | (NodeBase & { type: "slider"; value: number; width?: number; color?: TagColor | HexColor; label?: string })
  /** A switch pill, `on` or off, in the accent (or `color`); with `action` a click flips it through that action. A room's power, a setting. */
  | (NodeBase & { type: "switch"; on: boolean; color?: TagColor; label?: string })
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
 * with `pal:` (the shell's own). `input` turns the search row into a text
 * field the view reads on Enter (`ViewInput`).
 */
export type View = { tree: ViewNode; actions: Action[]; title?: string; id?: string; keys?: "actions"; input?: ViewInput };

/**
 * A line of text the view asks for (`View.input`): while it is set the
 * search row is a text field holding `value` (the caret at its end,
 * focused) in place of the title, typing goes there and bare keys are
 * typing, not actions (a modifier combo still runs its action). Enter
 * picks the `submit` action with the text as `ctx.values.input`, Escape
 * picks `cancel` (or leaves the level when there is none); answer either
 * with a tree without `input` to close the field, or with one to keep it
 * (its `value` replaces the text only when it differs from the previous
 * tree's). Both ids must be actions of the view. A picker opens the field
 * from a hidden action on the first digit typed and answers with the
 * digit as `value`, so typing a notation starts without a mode key.
 */
export type ViewInput = { value?: string; placeholder?: string; submit: string; cancel?: string };

/** What re-asks an open view (`Palette.on`): a track or player change, wake from sleep, the network back, the panel shown with the level kept. */
export type ViewTrigger = "media" | "wake" | "network" | "show";

/**
 * Which view a push or a lifecycle notification is about: a view
 * palette's level (`palette`), or a bar item's own `{ view }` popover
 * level (`bar`, the item's id); one of the two. `id` is the `View.id`
 * the tree carries (`view` when it sets none): a palette whose view
 * answers to several things (Hue's light view, one per light) tells
 * them apart by it. `compact` on a notification: the level is in the
 * bar popover.
 */
export type ViewTarget = { extension: string; palette?: string; bar?: string };
/** `view/shown` and `view/hidden`, core to host: a view level came on top of a window, or left it (popped, covered, the window hidden). */
export type ViewShown = ViewTarget & { id: string; compact?: true };
/**
 * `core/view.update` (host to core) and `pal://view` (core to page): a
 * new tree for the open level. `spec` is a whole `View` (its actions,
 * title, keys and input replace the level's) or `{ tree }` alone (the
 * tree replaced, the rest kept). Dropped by the core, with one log line,
 * while no such level is open; `id` narrows it to the level whose
 * `View.id` matches.
 */
export type ViewUpdate = ViewTarget & { id?: string; spec: View | { tree: ViewNode } };

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
  | "maximize" | "almost_maximize" | "maximize_height" | "maximize_width" | "center" | "reasonable_size"
  | "larger" | "smaller" | "move_left" | "move_right" | "move_up" | "move_down"
  | "next_display" | "previous_display" | "fullscreen" | "minimize" | "unminimize" | "restore";

/**
 * `pal_core::windows::layout::Options`: the knobs, all optional (gap 0,
 * 90%, 60%, `step` 32 px per move). `cycle`: a half or a third applied to
 * a window already at that frame steps to the next size of its family
 * (left half, then left two thirds, then left third, then the half
 * again), the way Rectangle's repeated keypress does.
 */
export type WindowLayoutOptions = { gap?: number; almost_maximize_percent?: number; reasonable_size_percent?: number; step?: number; cycle?: boolean };

/** The `layout` effect's payload and `windows.layout`'s params, one shape. */
export type WindowLayoutRequest = WindowLayoutOptions & { name: WindowLayout; id?: string };

/**
 * What `pick` returns and the shell acts on. `copy` and `open` run in the
 * core; the window hides afterwards unless `keep` or `toast` is set (a
 * toast needs the window). Any other object hides too.
 */
/**
 * `Effect.copy` with options. `concealed`: the text is marked for
 * clipboard managers to skip (`org.nspasteboard.ConcealedType` on macOS,
 * the KDE password-manager hint on Linux) and never enters pal's own
 * history: for a password, a one-time code, a token. `clear_after`: seconds
 * after which the previous clipboard is put back (or the clipboard emptied)
 * if the secret is still on it; the HUD then says "Copied, clears in N s".
 * Only meaningful with `concealed`.
 */
export type CopyText = { text: string; concealed?: boolean; clear_after?: number };

export type Effect = {
  /** Text onto the clipboard ("Copied" in the HUD once the panel hides), or a `CopyText` for a secret. */
  copy?: string | CopyText;
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
  /**
   * Large Type: the panel hides and the text is shown across the screen
   * in a type size fitted to the width (a code's digits grouped, a
   * code-like text in monospace), until any key, a click, or 8 s. For an
   * OTP, an IP, a licence key read from across the room. Cut at 400
   * characters; blank text shows nothing.
   */
  large_type?: string;
  /**
   * Dialog jump: hide, then type this path into the open or save panel
   * the app in front has up (its Go to Folder sheet: cmd+shift+g, the
   * path pasted, Return; ctrl+l on a GTK chooser). The HUD says which
   * panel took it, or that none was up. `dialog.current()` (api.ts) says
   * whether one is, so a row can lead with the action only then. Needs
   * Accessibility on macOS like `paste`, with the same toast when missing.
   */
  dialog?: string;
  /** Stay open and list again. */
  keep?: true;
  /**
   * Drill in: the UI pushes a level scoped to that palette (any extension's).
   * `args` reach its `list`/`pick`/`detail` as `ctx.args`, so a palette can
   * list the children of the picked item; a level with args is always listed
   * from the extension, never from the index.
   */
  push?: { extension: string; palette: string; args?: unknown; /** Typed into the level's search box on arrival (a fallback row carrying the root query in). */ query?: string; /** The level's crumb, in place of the palette's title: the folder being browsed, the file the apps are for. */ title?: string };
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
export type Ctx = {
  filter?: string;
  args?: unknown;
  refresh?: boolean;
  values?: FormValues;
  /** On a `list`: the root's inline section asks (`Palette.inline`), so a palette that lists hints for an empty query can answer only what matched. */
  inline?: true;
  /** On a `pick` of an `Action.multi` action: every marked id, the pick's `id` first. Absent on a single pick. */
  ids?: string[];
  /** The level is in the bar popover (420 px wide, `docs/extensions.md`, bar items): a `view` lays out for it, a `list` may cut its rows. Absent in the panel. */
  compact?: true;
};

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
  /** The palette's own row at the root: a glyph, emoji or hex colour, or a brand tile (`tile()`). */
  icon?: OwnIcon;
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
  /**
   * The palette's first listing of a run waits for the first panel show
   * rather than running at process start: its cached rows still restore
   * into the root at startup, and from that show on `ttl` and `live`
   * apply as usual. For a palette whose listing prompts (1Password asks
   * per app) or reaches the network. The manifest's `lazy` wins over this
   * one (`checkPalettes`).
   */
  lazy?: boolean;
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
  /**
   * Inline results at the root: with `inline: true`, a root query that
   * `match` accepts (a regex, a regex source, or a predicate; the manifest
   * may declare the string form for the store) runs `list(query, { inline:
   * true })` and its first rows show at the root under the palette's title,
   * above the index's hits, with their own actions. Debounced like the
   * palette's own keystrokes and dropped when the query moves on; a list
   * that takes over `INLINE_TIMEOUT_MS` (host) is left out.
   */
  match?: RegExp | string | ((query: string) => boolean);
  inline?: boolean;
  /**
   * Fallback rows when the root query matched nothing (or under the hits
   * with `general.fallbacks_always`): `true` adds an "Ask <title>" row that
   * opens the palette with the query typed; a string is that row's title
   * with `{query}` filled in ("Search Files for “{query}”"); a function
   * answers the rows itself (quicklinks: every `{query}` link filled in),
   * picked through `pick` as any row. `general.fallbacks` orders them.
   */
  fallback?: true | string | ((query: string) => Item[] | Promise<Item[]>);
  /**
   * What is worth showing before anything is typed: a few rows for the
   * root's "Now" section (the next event, the running timer, what is
   * playing, what is on the clipboard). Asked on every show of the empty
   * root, so keep it fast and cached; `general.now` orders the palettes.
   * A row's `section` names its own section ("Clipboard"), else "Now".
   */
  suggest?: () => Item[] | Promise<Item[]>;
  /**
   * Rows are marked with Tab, and with a bare `x` while nothing is typed,
   * too (cmd+click and shift+↑↓ mark in every palette): for a palette
   * whose rows are gathered (files to trash, windows to close). Not next
   * to `filters`: Tab cycles those.
   */
  multi?: boolean;
  /**
   * A view palette only: seconds between re-asks of `view(ctx)` while
   * its level is open (on top of the panel or the popover), each answer
   * replacing the tree in place with the keyed transitions; `on` adds
   * triggers (`media`: a track or player change, `wake`, `network`,
   * `show`: the panel shown with the level kept). The pull half of live
   * views; `view.update` is the push half (docs/extensions.md, "Live
   * views"). The manifest's win over these (`checkPalettes`).
   */
  refresh?: number;
  on?: ViewTrigger[];
  /** `id` is the picked row, or the first marked one with `ctx.ids` carrying them all (`Action.multi`). */
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
  /** Run `onOpen` on a click or item hotkey even when this item also has a menu. Hover still opens the menu. */
  click?: "open";
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

/** One named, static state Settings can put through an item's preview strip. It never reaches the live bar. */
export type ManifestBarMock = { title: string; item: BarItem };

/** `pal.json`: `bar.<id>`, readable without code (the Settings window lists it, hidden or not). */
export type ManifestBar = { title: string; description?: string; refresh?: BarRefresh; /** Named Settings-only preview states; `title` describes the condition, `item` is an ordinary render state. */ mocks?: Record<string, ManifestBarMock>; /** The popover's key table, as a palette's: what each key does in the item's own `{ view }` level. */ keys?: ManifestKey[] };

/**
 * Why `render` runs, and what a popover-opening click carried. `compact`:
 * what the call answers is drawn in the bar popover (420 px wide, as tall
 * as its content up to 480), so a `{ view }` menu or a `view` effect lays
 * out for that width; the core sets it on every bar call today, since
 * the popover is the only surface a bar item draws on.
 */
export type BarCtx = { reason: "load" | "every" | "show" | "wake" | "network" | "focus" | "minute" | "settings" | "update" | "cli" | "open"; anchor?: "menubar" | "sketchybar" | "hotkey" | "cli"; compact?: true; /** On `onAction` from the popover: what a `View.input` field held on Enter (`input`), a form's fields, a slider's clicked fraction (`value`). */ values?: Record<string, string>; /** Which instance of a `multi` extension the item belongs to, so it can name its account in `title`; absent for a non-`multi` extension. */ instance?: InstanceInfo };

/**
 * Which instance of a `multi` extension the code runs as (`instance()` in
 * api.ts, `BarCtx.instance`): the `key` is what every table, file and link
 * is spelled with (`gmail@work`), `name` the manifest's, `title` what the
 * user called it ("Work"; the default instance has none until named).
 */
export type InstanceInfo = { key: string; name: string; title?: string; isDefault: boolean };

export type BarSource = {
  render(ctx: BarCtx): BarItem | Promise<BarItem>;
  /** A menu node was picked (its `action`), or a segment clicked (`segment:<id>`). Any Effect; `keep` re-renders the item. */
  onAction?(action: string, ctx: BarCtx): Effect | void | Promise<Effect | void>;
  /** A click on an item without `menu`, or one whose rendered item says `click: "open"`. */
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
export type Extension = { palettes: Record<string, Palette>; bar?: Record<string, BarSource>; link?: LinkHandler; dispose?(): void | Promise<void> };

// ---- links (pal://<extension>/<route>) -------------------------------------
// An extension's own deep links (docs/design/links.md): `pal.json` declares
// them under `links` so the store and the settings window can list them
// without the code, `Extension.link(route, params)` answers them. The host
// checks the route is declared, the required params are there and coerces
// the rest by `type` (`checkLinkParams`, manifest.ts) before calling.

/** What one parameter of a route is: its type (`string` unless said), whether it must be given, a line for the store. */
export type ManifestLinkParam = { description?: string; required?: boolean; type?: "string" | "number" | "boolean" | "json" | "string[]" };

/** `pal.json`: `links.<route>`. `confirm: true` makes the link ask before running whatever `general.deeplink_confirm` allows. */
export type ManifestLink = { description?: string; confirm?: boolean; params?: Record<string, ManifestLinkParam> };

/** The params as `link` receives them: coerced by the manifest's `type`, a missing optional one absent. */
export type LinkParams = Record<string, string | number | boolean | string[] | unknown>;

/**
 * Answers `pal://<extension>/<route>?params`: an `Effect` like a pick's
 * (`copy`, `paste`, `open`, `focus`, `layout`, `hud`, `toast`, `push`,
 * `hide`), or nothing. `keep`, `show`, `view` and `form` need the level a
 * pick came from and are refused by the host, as `effects.run` refuses
 * them.
 */
export type LinkHandler = (route: string, params: LinkParams) => Effect | void | Promise<Effect | void>;

// ---- manifest (pal.json) -------------------------------------------------
// Read by the host without running the extension's code, so the settings
// window can show an extension whose code fails to load. Mirrored by hand in
// app/src/ui/SettingsTypes.ts.

/** One choice of a `select` setting: `id` is the stored value, `title` what the window shows. */
export type SettingOption = { id: string; title: string };

/** `scope: "instance"`: the setting identifies the account (a server url, a workspace) and is never inherited by another instance of a `multi` extension; a `secret` never is either. */
type SettingBase = { id: string; label: string; description?: string; scope?: "instance" };

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
  /** See `Palette.lazy`: the first listing waits for the first panel show; this value wins over the code's. */
  lazy?: boolean;
  /** See `Palette.refresh` (a view palette): seconds between re-asks while open; this value wins over the code's. */
  refresh?: number;
  /** See `Palette.on`: the triggers that re-ask an open view; this value wins over the code's. */
  on?: ViewTrigger[];
  /** See `Palette.tier`; this value wins over the code's. */
  tier?: Tier;
  /** See `Palette.match`: the regex source, for the store; the code's wins when both are set. */
  match?: string;
  /** See `Palette.inline`. */
  inline?: boolean;
  /** See `Palette.fallback`: `true` for an "Ask" row, a string for its title. */
  fallback?: boolean | string;
  /** Extra words the palette's row at the root answers to (`gh`, `hass`), on top of its title, key and the extension's `keywords`. */
  keywords?: string[];
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
  /** A glyph, emoji or hex colour, or a brand tile; the settings window's row for the extension. */
  icon?: OwnIcon;
  author?: string;
  /** `bundled` for the ones that ship with pal, else a repo like `github.com/zcag/pal-github`. */
  repo?: string;
  /** Words every palette's row at the root answers to, on top of its title and key: the short names people type for the product (`gh`, `ha`, `1p`). */
  keywords?: string[];
  /** Extension-level settings, `[extensions.<name>]` in the file. */
  settings?: SettingSpec[];
  /** Per-palette settings, `[palettes.<id>].settings` in the file, keyed by the palette's key in `Extension.palettes`. */
  palettes?: Record<string, ManifestPalette>;
  /** The bar items, keyed by their id in `Extension.bar`: title and refresh schedule, readable without the code. */
  bar?: Record<string, ManifestBar>;
  /** The routes `Extension.link` answers (`pal://<name>/<route>`), with their params, readable without the code. */
  links?: Record<string, ManifestLink>;
  /**
   * The extension can run as several configured instances (two accounts,
   * two homes; docs/design/instances.md): each `[instances."<name>@<suffix>"]`
   * in the config file is one, with its own settings, storage, palettes
   * and bar items, run in its own worker. A palette title may carry
   * `{instance}` for where the instance's title goes.
   */
  multi?: boolean;
};

/**
 * `extension/loaded` (host to core): one per loaded instance. `extension`
 * is the instance key (the bare name for the default and for a non-`multi`
 * extension), `name` the manifest's; `instance` is what the config named
 * it, defaults resolved (`tint` and `badge` absent for the default, which
 * keeps the plain tile). `extension/error` and `extension/removed` carry
 * `extension` the same way.
 */
export type ExtensionLoaded = {
  extension: string;
  name: string;
  root: string;
  instance: { key: string; title?: string; tint?: TileColorName; badge?: string; isDefault: boolean };
  palettes: PaletteMeta[];
  bar: BarMeta[];
  manifest: Manifest;
  warnings: string[];
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
  /** The palette lists inline at the root for queries its `match` accepts (the host matches; a string `match` rides along for the store). */
  inline?: true;
  match?: string;
  /** `ask`: an "Ask <title>" row (`fallbackTitle` when given); `rows`: the palette answers `fallback(query)` itself. */
  fallback?: "ask" | "rows";
  fallbackTitle?: string;
  /** The palette answers `suggest()` for the root's "Now" section. */
  suggest?: true;
  /** Tab (and a bare `x` with nothing typed) marks rows (`Palette.multi`). */
  multi?: true;
  /** Extra words the palette's row at the root answers to: the manifest's `keywords` and the palette's own, once each. */
  keywords?: string[];
  /** The first listing of a run waits for the first panel show (`Palette.lazy`); the cached rows restore either way. */
  lazy?: true;
  /** A view palette: seconds between re-asks of `view(ctx)` while its level is open (`Palette.refresh`, the manifest's first). */
  refresh?: number;
  /** A view palette: the triggers that re-ask it while open (`Palette.on`, the manifest's first). */
  on?: ViewTrigger[];
};
