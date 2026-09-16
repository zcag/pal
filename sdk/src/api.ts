// What an extension imports from `@zcag/pal` to reach the core's OS
// capabilities. Every function is one `core/<capability>.<fn>` request over
// the host's bridge, which reaches this module through `runtime.ts`. The
// protocol's types ride along (`index.ts`), so
// `import { settings, type Extension } from "@zcag/pal"`.
import { homedir } from "node:os";
import type { ResolvedSettings, WindowLayoutRequest } from "./protocol.ts";
import { runtime } from "./runtime.ts";

const call = <T = unknown>(method: string, params?: unknown): Promise<T> => runtime().call<T>(method, params);
const who = (extension?: string): string => runtime().caller(extension).extension;

/**
 * The raw bridge: `core.call("clipboard.list", { limit: 5 })` is one
 * `core/clipboard.list` request. What the typed objects below wrap; for a
 * capability they do not cover yet.
 */
export const core = { call };

/** A leading `~` (bare, or `~/...`) replaced by the home directory, as paths from settings and data files carry it. */
export const home = (path: string): string => path.replace(/^~(?=\/|$)/, homedir());

/**
 * The extension's settings as the user set them: the manifest's defaults
 * (pal.json) with the config file's `[extensions.<name>]` on top, kept
 * current by the core on every config change. Which extension is asking is
 * known inside `list`/`pick`/`view` and at import time; elsewhere pass the
 * name.
 */
export const settings = {
  /** Extension-level values, `[extensions.<name>]`. */
  get: <T = Record<string, unknown>>(extension?: string): T => runtime().resolved(who(extension)).settings as T,
  /** One palette's declared values, `[palettes.<id>].settings`; the current palette inside `list`/`pick`. */
  palette: <T = Record<string, unknown>>(palette?: string, extension?: string): T => {
    const c = runtime().caller(extension);
    const name = palette ?? c.palette;
    if (!name) throw new Error("settings.palette: no palette in context; pass its name");
    return (runtime().resolved(c.extension).palettes[name] ?? {}) as T;
  },
  /** Called with the new values whenever they change; returns the unsubscribe. */
  onChange: (cb: (s: ResolvedSettings) => void, extension?: string): (() => void) => runtime().subscribe(who(extension), cb),
};

/**
 * Small per-extension key-value store, kept by the core in
 * `<data dir>/pal/storage/<extension>.json` (one file per extension, written
 * whole and atomically on every change, shared by every config profile).
 * Values are JSON; `get` answers `null` for a key that is not there. The
 * file is capped at `storage.LIMIT` bytes: a `set` that would exceed it
 * rejects and nothing is written. For a bankroll, a cursor, a last-used
 * choice; not for a cache of any size. Which extension is asking is known
 * inside `list`/`pick`/`view` and at import time; elsewhere pass the name.
 */
export const storage = {
  /** Bytes per extension file, serialised. */
  LIMIT: 256 * 1024,
  /** The value under `key`, or null. */
  get: <T = unknown>(key: string, extension?: string) => call<T | null>("storage.get", { extension: who(extension), key }),
  /** Any JSON value; null removes the key. */
  set: (key: string, value: unknown, extension?: string) => call<null>("storage.set", { extension: who(extension), key, value }),
  remove: (key: string, extension?: string) => call<null>("storage.remove", { extension: who(extension), key }),
  /** Every key the extension has set, sorted. */
  keys: (extension?: string) => call<string[]>("storage.keys", { extension: who(extension) }),
};

/** `pal_core::clipboard::Entry`: one of text/image/files is set, by kind. */
export type ClipboardEntry = {
  id: number;
  kind: "text" | "image" | "files";
  text: string | null;
  /** Path of the PNG on disk; the webview loads it via `clipboard.imageUrl`. */
  image: string | null;
  files: string[] | null;
  /** Bundle id of the app that was frontmost at copy time; null on Linux. */
  source_app: string | null;
  /** Unix milliseconds. */
  at: number;
  bytes: number;
  pinned: boolean;
  width: number | null;
  height: number | null;
};

/** `clipboard.list` options: a prefix-word `query` over text and file paths, one `kind`, and a page. */
export type ClipboardListOpts = { query?: string; kind?: ClipboardEntry["kind"]; limit?: number; offset?: number };

/** The clipboard history the core keeps (`pal_core::clipboard`). */
export const clipboard = {
  /** Pinned first, then newest; `query` is a prefix-word search over text and file paths. */
  list: (opts: ClipboardListOpts = {}) => call<ClipboardEntry[]>("clipboard.list", opts),
  /** One entry by id; rejects when it is gone. */
  get: (id: number) => call<ClipboardEntry>("clipboard.get", { id }),
  /** Pin (or unpin with `false`): a pinned entry lists first and is exempt from retention (the age and count limits), not from `clear`. */
  pin: (id: number, pinned = true) => call<null>("clipboard.pin", { id, pinned }),
  /** Remove one entry. */
  delete: (id: number) => call<null>("clipboard.delete", { id }),
  /** Everything, pinned included. */
  clear: () => call<null>("clipboard.clear"),
  /** Back onto the clipboard, and to the top of history. */
  copy: (id: number) => call<null>("clipboard.copy", { id }),
  /**
   * An image entry as the webview loads it: a thumbnail fitted into `size`
   * px, or the image itself for 0. The `icon://` scheme is the app's
   * (app/src-tauri/src/icon.rs); this is the one place its shape is known.
   */
  imageUrl: (id: number, size: number) => `icon://localhost/clip?id=${id}&size=${size}`,
};

/** `pal_core::windows::Window`, plus the app's icon source. */
export type Window = {
  /** Backend-specific, stable while the window lives; what `focus`/`close`/`minimize` take. */
  id: string;
  /** The app's name (macOS) or window class (Linux). */
  app: string;
  title: string;
  /** Bundle id on macOS; `app_id` / `WM_CLASS` on Linux. */
  bundle_or_class: string;
  pid: number;
  minimized: boolean;
  /** Visible right now: not minimised, hidden, or on another space. */
  on_screen: boolean;
  /** Only when there is more than one display. */
  monitor: string | null;
  workspace: string | null;
  /** The `.app` bundle or `.desktop` file, for `Item.icon = { app }`; null when unknown. */
  icon: string | null;
};

/** `pal_core::windows::Rect`: global top-left origin, points on macOS, logical pixels on Linux. */
export type Rect = { x: number; y: number; w: number; h: number };

/** `pal_core::windows::Display`: `visible_frame` is `frame` minus the menu bar, Dock and bars. */
export type Display = { id: string; frame: Rect; visible_frame: Rect; primary: boolean };

/** What `windows.layout` did: the window, and where it went from and to. */
export type Applied = { id: string; layout: string; from: Rect; to: Rect };

/** Windows of every app, over the OS's accessibility API (`pal_core::windows`). */
export const windows = {
  /** Every window of every regular app, front to back; minimised ones included. */
  list: () => call<Window[]>("windows.list"),
  /** Focus is not here: return `{ focus: id }` from `pick`, so the panel hides first. */
  close: (id: string) => call<null>("windows.close", { id }),
  minimize: (id: string) => call<null>("windows.minimize", { id }),
  frame: (id: string) => call<Rect>("windows.frame", { id }),
  /** Move and resize; needs Accessibility on macOS. A tiled window on Hyprland or Sway is floated first. */
  setFrame: (id: string, rect: Rect) => call<null>("windows.set_frame", { id, ...rect }),
  /** Every display, the primary first. */
  displays: () => call<Display[]>("windows.displays"),
  /** The window with keyboard focus; null when nothing has it. With the panel up this is the app behind it. */
  focused: () => call<Window | null>("windows.focused"),
  /**
   * Run a named layout on a window (the focused one without `id`) right
   * now, without hiding the panel. From `pick` prefer the `layout` effect,
   * which hides first and shows the layout's name in the HUD.
   */
  layout: (req: WindowLayoutRequest) => call<Applied>("windows.layout", req),
};

/** `pal_core::system::SystemCommand`. */
export type SystemCommand = {
  id: string;
  title: string;
  subtitle: string;
  /** A glyph. */
  icon: string;
  keywords: string[];
  /** Ends the session or deletes: ask before running. */
  destructive: boolean;
  /** Whether this machine has what the command needs. */
  available: boolean;
};

/** The system commands the core knows how to run (`pal_core::system`). */
export const system = {
  /** The whole catalogue; filter on `available`. */
  commands: () => call<SystemCommand[]>("system.commands"),
  /** Hides the panel, then runs. Rejects with the tool's complaint. */
  run: (id: string) => call<null>("system.run", { id }),
};
