// PROVISIONAL. Wire shapes for the Rust core <-> extension host stdio link,
// written down only so both sides compile against one file. Nothing here is
// the contract: item fields mirror the v1 fixture rows, the pick envelope is
// a placeholder, and the extension surface is a plain object with two
// functions so it stays trivial to replace once the render tree is designed.
// One JSON object per line, both directions. Requests carry an id, responses
// echo it, notifications have none. Change freely.

export type Request = { id: number; method: string; params?: unknown };
export type Response = { id: number; result?: unknown; error?: string };
export type Notification = { method: string; params?: unknown };

export type Item = {
  id: string;
  name: string;
  subtitle?: string;
  /** A glyph/emoji/hex string, or `{ app }` for an application's own artwork. */
  icon?: string | { app: string };
  keywords?: string[];
  /** An item with a url and no icon gets the site's favicon. */
  url?: string;
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
  hide?: true;
  toast?: { title: string; style?: "success" | "failure" };
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
  list(query?: string): Item[] | Promise<Item[]>;
  pick(id: string, action?: string): Effect | void | Promise<Effect | void>;
};

export type Extension = { palettes: Record<string, Palette> };

/** What `hello` and `extension/loaded` say about a palette. */
export type PaletteMeta = Pick<Palette, "icon" | "view" | "columns" | "placeholder"> & { name: string; title: string; live: boolean; input: boolean };
