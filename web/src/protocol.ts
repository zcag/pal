/**
 * What a host page and a pal page framed in it say to each other over
 * `postMessage` (docs/embed.md). The host speaks first (`hello`); the pal
 * page answers to that message's origin and to no other, and the browser
 * has already checked that origin against `[remote] embed_origins`
 * (`frame-ancestors`), so neither side ever posts to `*`.
 */

/** What the host page hears, as `pal-<name>` events on the element. */
export type EmbedEvents = {
  /** A row was picked (a pick that only moves within pal, like opening a palette, is one too). */
  pick: { id: string; name: string; subtitle?: string; palette?: string; action?: string };
  /** A HUD line, or Large Type with `large`. */
  hud: { text: string; large?: boolean };
  /** Text pal put on the clipboard. */
  copy: { text: string };
  /** A URL a pick opens; pal opens it itself unless the element has `links="host"`. */
  open: { url: string };
  /** A bar item's popover opened or closed (`<pal-bar>`). */
  "bar-open": { key: string; title: string };
  "bar-close": Record<string, never>;
  /** Every item the bar has (`<pal-bar>`), by key as `pal bar list` prints it, those `hide` leaves out included: sent once ready and whenever the set changes, for a host that lets someone pick. */
  "bar-items": { key: string; title: string }[];
  /** Someone picked which items show (`<pal-bar>`'s own picker, a right-click or a long press): the keys now hidden. The element takes them as its `hide`; a host keeps them for this device. */
  "bar-hide": { keys: string[] };
  /**
   * The app would hide pal here: Escape with nothing left to back out of
   * (`escape`, also `<pal-bar>`'s with no sheet open), or a pick that hides
   * the panel (`pick`). A host showing pal in an overlay closes it.
   */
  dismiss: { reason: "escape" | "pick" };
};

/** Host to pal. */
export type ToPal =
  | { pal: "embed"; hello: true }
  | { pal: "embed"; call: "focus" | "reset" | "close" }
  | { pal: "embed"; call: "open"; palette: string }
  | { pal: "embed"; call: "query"; text: string }
  /** `<pal-bar>`'s `hide`, changed: these keys leave the strip. */
  | { pal: "embed"; call: "hide"; keys: string[] }
  /** The element's `theme`, changed (`null`: pal's own). */
  | { pal: "embed"; call: "theme"; theme: "light" | "dark" | null }
  /** The host's theme tokens (`--pal-<key>`: value as CSS writes it), over pal's theme in this frame; `{}` clears them. */
  | { pal: "embed"; call: "tokens"; tokens: Record<string, string>; fonts?: FontFace[] };

/** A host's own `@font-face` for a family its `font-ui`/`font-mono` token names, its `url()`s absolute, so the frame can load it (cross-origin: the font's server answers with CORS). */
export type FontFace = { family: string; src: string; weight?: string; style?: string };

/** Pal to host. */
export type FromPal =
  | { pal: "embed"; ready: true }
  /** The frame's height; `strip`, the strip's own, which `<pal-bar>` takes as its height (the frame grows past it under a sheet). */
  | { pal: "embed"; size: number; strip?: number }
  /** The scheme pal draws in: the frame takes it, or the browser paints an opaque backdrop behind a page whose scheme differs from its frame's. */
  | { pal: "embed"; scheme: "light" | "dark" }
  /** Host tokens pal dropped, a line each naming the token and why. */
  | { pal: "embed"; warnings: string[] }
  | { [K in keyof EmbedEvents]: { pal: "embed"; event: K; detail: EmbedEvents[K] } }[keyof EmbedEvents];

const tagged = (data: unknown): data is { pal: "embed" } => !!data && typeof data === "object" && (data as { pal?: unknown }).pal === "embed";
export const isToPal = (data: unknown): data is ToPal => tagged(data) && ("hello" in data || "call" in data);
export const isFromPal = (data: unknown): data is FromPal => tagged(data) && ("ready" in data || "size" in data || "scheme" in data || "warnings" in data || "event" in data);

/** The frame's query for each element attribute it carries (`embed`, the kind, is set apart). */
export const PARAMS = ["token", "palette", "theme", "links", "transparent", "hide"] as const;
