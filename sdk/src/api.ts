// What an extension imports from `@zcag/pal` to reach the core's OS
// capabilities. Every function is one `core/<capability>.<fn>` request over
// the host's bridge, which reaches this module through `runtime.ts`. The
// protocol's types ride along (`index.ts`), so
// `import { settings, type Extension } from "@zcag/pal"`.
import type { BarItem, ResolvedSettings, WindowLayoutRequest } from "./protocol.ts";
import { runtime } from "./runtime.ts";
import { checkBarItem } from "./view.ts";

const call = <T = unknown>(method: string, params?: unknown): Promise<T> => runtime().call<T>(method, params);
const who = (extension?: string): string => runtime().caller(extension).extension;

/**
 * The raw bridge: `core.call("clipboard.list", { limit: 5 })` is one
 * `core/clipboard.list` request. What the typed objects below wrap; for a
 * capability they do not cover yet.
 */
export const core = { call };

/** A leading `~` (bare, or `~/...`) replaced by the home directory, as paths from settings and data files carry it. */
// No `node:os` import: this file is also type-checked by consumers without
// node types (the app's gallery). Bun and Node both expose the env.
declare const process: { env: Record<string, string | undefined> } | undefined;
const homeDir = (): string => (typeof process === "undefined" ? "" : process.env.HOME || process.env.USERPROFILE || "");
export const home = (path: string): string => path.replace(/^~(?=\/|$)/, homeDir());

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
 * The extension's bar items (`Extension.bar`, `docs/design/bar.md`), pushed
 * from the extension's own side: a webhook, a file watcher, a poll it runs
 * itself. The core renders a pushed item to every target as it would a
 * `render` answer (diffed, so a 1 Hz push costs one change per second at
 * most). Which extension is asking is known inside `render`/`onAction`/
 * `list`/`pick` and at import time; from a timer or a watcher pass the name.
 */
export const bar = {
  /** Replace the item now; the core renders it to every target. Checked like a `render` answer (`checkBarItem`) before it goes. */
  update: (id: string, item: BarItem, extension?: string) => call<null>("bar.update", { extension: who(extension), id, item: checkBarItem(item, `bar.update ${id}`) }),
  /** Ask for a `render` with reason `update`. */
  refresh: (id: string, extension?: string) => call<null>("bar.refresh", { extension: who(extension), id }),
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

/** `pal_core::apps::App`: an application registered for a file; `path` is the `.app` / `.desktop`, usable as `icon: { app: path }`. */
export type App = { name: string; path: string; bundle_id?: string; default: boolean };

/** Which applications open a file (`pal_core::apps`): Launch Services on macOS, xdg-mime + mimeapps.list + mimeinfo.cache on Linux. */
export const apps = {
  /** The default first, then by name. */
  forFile: (path: string) => call<App[]>("apps.for_file", { path }),
  /** `open -a` / `gio launch` with an app from `forFile`. */
  openWith: (path: string, app: string) => call<null>("apps.open_with", { path, app }),
};

/** The system commands the core knows how to run (`pal_core::system`). */
export const system = {
  /** The whole catalogue; filter on `available`. */
  commands: () => call<SystemCommand[]>("system.commands"),
  /** Hides the panel, then runs. Rejects with the tool's complaint. */
  run: (id: string) => call<null>("system.run", { id }),
};

/** `pal_core::audio::Device`: one direction of a device; a headset is an output entry and an input entry with the same `id`. */
export type AudioDevice = {
  /** What the setters take: the CoreAudio UID, the PipeWire node id, or the PulseAudio sink/source name. */
  id: string;
  name: string;
  kind: "output" | "input";
  default: boolean;
  /** Percent, 0..100; null when the device has no volume control. */
  volume: number | null;
  muted: boolean | null;
  /** `bluetooth`, `usb`, `builtin`, `hdmi`, `airplay`, ... when the backend says (macOS); null otherwise. */
  transport: string | null;
};

/** Audio devices (`pal_core::audio`): CoreAudio on macOS, `wpctl` (PipeWire) else `pactl` on Linux. */
export const audio = {
  /** Every output and input, outputs first, the defaults marked. */
  devices: () => call<AudioDevice[]>("audio.devices"),
  /** Make `id` the default for its direction. */
  setDefault: (id: string, kind: AudioDevice["kind"]) => call<null>("audio.set_default", { id, kind }),
  /** Percent, 0..100. */
  setVolume: (id: string, kind: AudioDevice["kind"], volume: number) => call<null>("audio.set_volume", { id, kind, volume }),
  /** Mute, unmute, or toggle when `muted` is omitted; resolves with the state after. */
  setMute: (id: string, kind: AudioDevice["kind"], muted?: boolean) => call<boolean>("audio.set_mute", { id, kind, muted }),
};

/** `pal_core::bluetooth::Device`: a paired device. */
export type BluetoothDevice = {
  /** `AA:BB:CC:DD:EE:FF`. */
  address: string;
  name: string;
  connected: boolean;
  /** `headphones`, `speaker`, `keyboard`, `mouse`, `gamepad`, `phone`, `watch`, `computer`, `other`. */
  kind: string;
  /** Percent, the main level (AirPods: the lower bud) when the OS reports one. */
  battery: number | null;
  /** The per-part levels when there are several: `L 80% · R 75% · Case 90%`. */
  battery_detail: string | null;
};

/** Paired Bluetooth devices (`pal_core::bluetooth`): `system_profiler` + IOBluetooth on macOS, `bluetoothctl` on Linux. */
export const bluetooth = {
  /** Connected first, then by name. Rejects when the machine has no adapter. */
  devices: () => call<BluetoothDevice[]>("bluetooth.devices"),
  /** Synchronous: resolves once connected or the attempt gave up (seconds). */
  connect: (address: string) => call<null>("bluetooth.connect", { address }),
  disconnect: (address: string) => call<null>("bluetooth.disconnect", { address }),
};

/** `pal_core::wifi::Current`: the network the machine is on. `ssid` is null when the OS hides it (macOS 15+ without Location Services). */
export type WifiCurrent = { ssid: string | null; signal: number | null; channel: string | null; security: string | null; ip: string | null };
/** `pal_core::wifi::Status`: `interface` is null on a machine without Wi-Fi; `current` null while off or not associated. */
export type WifiStatus = { interface: string | null; powered: boolean; current: WifiCurrent | null };
/** `pal_core::wifi::Known`: a saved network, in the OS's preference order. */
export type WifiKnown = { ssid: string; security: string | null };
/** `pal_core::wifi::Network`: one scan result; `security` null for an open network. */
export type WifiNetwork = { ssid: string; signal: number; channel: string | null; security: string | null; known: boolean; current: boolean };
/** `pal_core::wifi::Scan`: `hidden` counts networks whose name the OS withheld; `age_secs` is null for a scan just taken. */
export type WifiScan = { networks: WifiNetwork[]; hidden: number; age_secs: number | null };
/** `cached`: never runs the tool (empty without a previous scan); `auto`: the cache while under 60 s old; `fresh`: scan now. */
export type WifiScanMode = "cached" | "auto" | "fresh";

/** Wi-Fi (`pal_core::wifi`): `networksetup`/`ipconfig`/`system_profiler` on macOS, `nmcli` on Linux. */
export const wifi = {
  status: () => call<WifiStatus>("wifi.status"),
  /** The saved networks. */
  known: () => call<WifiKnown[]>("wifi.known"),
  /** Nearby networks, strongest first, one per name. A macOS scan takes seconds: list with `cached` and offer `fresh` as an action. */
  scan: (mode: WifiScanMode = "auto") => call<WifiScan>("wifi.scan", { mode }),
  /** Join by name; `password` for a network that is not saved. Rejects with the tool's complaint. */
  join: (ssid: string, password?: string) => call<null>("wifi.join", { ssid, password }),
  /** Remove a saved network. */
  forget: (ssid: string) => call<null>("wifi.forget", { ssid }),
  /** The saved password; on macOS the keychain asks the user first. */
  password: (ssid: string) => call<string>("wifi.password", { ssid }),
  setPower: (on: boolean) => call<null>("wifi.set_power", { on }),
};

/** `pal_core::media::Player`: one player and what it is on. */
export type MediaPlayer = {
  /** What `control` takes: `spotify`, `music`, `system` (nowplaying-cli), or the playerctl name. */
  id: string;
  /** `Spotify`, `Music`, `Firefox`. */
  name: string;
  state: "playing" | "paused" | "stopped";
  title: string | null;
  artist: string | null;
  album: string | null;
  /** An http(s) or file url, usable as `icon: { image }`. */
  artwork: string | null;
  /** The track's own url, for Open. */
  url: string | null;
  /** The player's `.app` / `.desktop`, usable as `icon: { app }` and with the `open` effect. */
  app: string | null;
  /** Seconds. */
  position: number | null;
  duration: number | null;
};
/** `pal_core::media::NowPlaying`: `system_wide` says whether a source beyond Spotify and Music is installed (`playerctl`, `nowplaying-cli`). */
export type NowPlaying = { players: MediaPlayer[]; system_wide: boolean };
export type MediaCommand = "play_pause" | "play" | "pause" | "next" | "previous";

/** Now playing (`pal_core::media`): Spotify and Music over AppleScript plus `nowplaying-cli` on macOS, `playerctl` on Linux. */
export const media = {
  /** Every running player, playing ones first. */
  nowPlaying: () => call<NowPlaying>("media.now_playing"),
  /** A transport command to one player; the panel stays up. */
  control: (player: string, command: MediaCommand) => call<null>("media.control", { player, command }),
};
