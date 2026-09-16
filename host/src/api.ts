// What an extension imports to reach the core's OS capabilities. Today a
// relative import (`../../host/src/api.ts`); it becomes the `pal` package
// (`import { clipboard } from "pal"`) once extensions are packaged. Every
// function is one `core/<capability>.<fn>` request over the bridge.
import { call } from "./bridge.ts";
import { caller, resolved, subscribe } from "./settings.ts";
import type { ResolvedSettings } from "./protocol.ts";

export const core = { call };

/**
 * The extension's settings as the user set them: the manifest's defaults
 * (pal.json) with the config file's `[extensions.<name>]` on top, kept
 * current by the core on every config change. Which extension is asking is
 * known inside `list`/`pick` and at import time; elsewhere pass the name
 * (see settings.ts).
 */
export const settings = {
  /** Extension-level values, `[extensions.<name>]`. */
  get: <T = Record<string, unknown>>(extension?: string): T => resolved(caller(extension).extension).settings as T,
  /** One palette's declared values, `[palettes.<id>].settings`; the current palette inside `list`/`pick`. */
  palette: <T = Record<string, unknown>>(palette?: string, extension?: string): T => {
    const c = caller(extension);
    const name = palette ?? c.palette;
    if (!name) throw new Error("settings.palette: no palette in context; pass its name");
    return (resolved(c.extension).palettes[name] ?? {}) as T;
  },
  /** Called with the new values whenever they change; returns the unsubscribe. */
  onChange: (cb: (s: ResolvedSettings) => void, extension?: string) => subscribe(caller(extension).extension, cb),
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

export type ClipboardListOpts = { query?: string; kind?: ClipboardEntry["kind"]; limit?: number; offset?: number };

export const clipboard = {
  /** Pinned first, then newest; `query` is a prefix-word search over text and file paths. */
  list: (opts: ClipboardListOpts = {}) => call<ClipboardEntry[]>("clipboard.list", opts),
  get: (id: number) => call<ClipboardEntry>("clipboard.get", { id }),
  pin: (id: number, pinned = true) => call<null>("clipboard.pin", { id, pinned }),
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

export const windows = {
  /** Every window of every regular app, front to back; minimised ones included. */
  list: () => call<Window[]>("windows.list"),
  /** Focus is not here: return `{ focus: id }` from `pick`, so the panel hides first. */
  close: (id: string) => call<null>("windows.close", { id }),
  minimize: (id: string) => call<null>("windows.minimize", { id }),
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

export const system = {
  /** The whole catalogue; filter on `available`. */
  commands: () => call<SystemCommand[]>("system.commands"),
  /** Hides the panel, then runs. Rejects with the tool's complaint. */
  run: (id: string) => call<null>("system.run", { id }),
};
