// PROVISIONAL. Wire shapes for the Rust core <-> extension host stdio link,
// written down only so both sides compile against one file. Nothing here is
// the contract: item fields mirror the v1 fixture rows, the pick envelope is
// a placeholder, and the extension surface is a plain object with two
// functions so it stays trivial to replace once the render tree is designed.
// One JSON object per line, both directions. Requests carry an id, responses
// echo it, notifications have none. Change freely.
//
// Both sides send requests: the core asks the host to `list`/`pick`, the host
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

export type Item = {
  id: string;
  name: string;
  subtitle?: string;
  /**
   * A glyph/emoji/hex string, `{ app }` for an application's own artwork,
   * or `{ image }` for a url the webview can load (an `icon://` one from
   * `api.ts`, or any http(s) url).
   */
  icon?: string | { app: string } | { image: string };
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
  hide?: true;
  toast?: { title: string; message?: string; style?: "success" | "failure" };
  /** Stay open and list again. */
  keep?: true;
};

export type Palette = {
  /** Section label at the root; the palette key otherwise. */
  title?: string;
  /** The palette's own row at the root; same forms as `Item.icon`. */
  icon?: string;
  /** Arrival order is the order (OTP codes, tabs): never ranked by use. */
  live?: boolean;
  /** Inside the palette; the root is always a list. */
  view?: "list" | "grid";
  columns?: number;
  /**
   * Items are never indexed: `list(query)` runs on every keystroke inside
   * the palette and its rows show as returned. The root only has the
   * palette's own row.
   */
  input?: boolean;
  placeholder?: string;
  /** Open with the detail pane showing. */
  detail?: boolean;
  list(query?: string): Item[] | Promise<Item[]>;
  pick(id: string, action?: string): Effect | void | Promise<Effect | void>;
};

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
export type ManifestPalette = { title?: string; description?: string; settings?: SettingSpec[] };

export type Manifest = {
  name: string;
  title: string;
  description?: string;
  version?: string;
  /** Same forms as `Item.icon`. */
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
export type PaletteMeta = Pick<Palette, "icon" | "view" | "columns" | "placeholder" | "detail"> & { name: string; title: string; live: boolean; input: boolean };
