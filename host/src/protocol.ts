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
  /** Anything else rides along untouched to the UI and back to `pick`. */
  [extra: string]: unknown;
};

export type Palette = {
  /** Section label at the root; the palette key otherwise. */
  title?: string;
  /** Arrival order is the order (OTP codes, tabs): never ranked by use. */
  live?: boolean;
  list(query?: string): Item[] | Promise<Item[]>;
  pick(id: string, action?: string): unknown | Promise<unknown>;
};

export type Extension = { palettes: Record<string, Palette> };

/** What `hello` and `extension/loaded` say about a palette. */
export type PaletteMeta = { name: string; title: string; live: boolean };
