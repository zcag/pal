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
  icon?: string;
  keywords?: string[];
};

export type Palette = {
  list(query?: string): Item[] | Promise<Item[]>;
  pick(id: string, action?: string): unknown | Promise<unknown>;
};

export type Extension = { palettes: Record<string, Palette> };
