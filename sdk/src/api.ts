// What an extension imports from `@zcag/pal` to reach the core's OS
// capabilities. Every function is one `core/<capability>.<fn>` request over
// the host's bridge, which reaches this module through `runtime.ts`. The
// protocol's types ride along (`index.ts`), so
// `import { settings, type Extension } from "@zcag/pal"`.
import type { BarItem, CopyText, Effect, ResolvedSettings, WindowLayoutRequest } from "./protocol.ts";
import { runtime } from "./runtime.ts";
import { checkBarItem } from "./view.ts";

const call = <T = unknown>(method: string, params?: unknown, opts?: { timeout?: number }): Promise<T> => runtime().call<T>(method, params, opts);
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
   * The history entry for what is on the clipboard right now, or `null`:
   * the pasteboard is read and looked up by content, so what history never
   * recorded (a copy from an excluded app, a concealed one, one over the
   * size cap, or an entry deleted since) is not current either. What the
   * root's Clipboard rows are built from.
   */
  current: () => call<ClipboardEntry | null>("clipboard.current"),
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

/** `pal_core::wifi::Current`: the network the machine is on. `ssid` is null when the OS hides it (macOS 15+ without Location Services: `permissions.request("location")`). */
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

/** Wi-Fi (`pal_core::wifi`): CoreWLAN plus `networksetup`/`ipconfig` on macOS, `nmcli` on Linux. */
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

/** `pal_core::permission::Status` (Calendars, Location): `not_determined` means a request will prompt; `denied`/`restricted` are switched in System Settings; `unavailable` is a machine without the backend (Linux without `khal`, Location off macOS). */
export type PermissionStatus = "granted" | "denied" | "not_determined" | "restricted" | "unavailable";
/** `pal_core::calendar::Status`: the same enum. */
export type CalendarStatus = PermissionStatus;

/** permissions.rs `Status`: what the OS lets pal do. Every field is a given off macOS (`true`, `unavailable`); `full_disk_access` is absent when there is nothing to probe. */
export type Permissions = { accessibility: boolean; calendar: PermissionStatus; full_disk_access?: boolean; input_monitoring: boolean; location: PermissionStatus };
/** What `permissions.request` takes: the prompt for the ones that have one (`accessibility`, `calendar`, `input_monitoring`, `location`), the System Settings pane for the rest or once the prompt was answered no. */
export type PermissionId = "accessibility" | "calendar" | "full_disk_access" | "input_monitoring" | "location";

/**
 * The OS permissions pal holds (`permissions.rs`), for an extension whose
 * palette needs one: `status()` says where each stands, `request(which)`
 * shows the system prompt while the OS still has one to show (the answer
 * lands later; the state as of now comes back) or opens the pane once it
 * was answered no. Ask lazily, from the listing that needs it, and only
 * while `not_determined`: the prompt is modal. The wifi extension asks
 * for `location` the first time it lists with the names withheld.
 */
export const permissions = {
  status: () => call<Permissions>("permissions.status"),
  request: (which: PermissionId) => call<Permissions>("permissions.request", { which }),
};

/** `pal_core::calendar::Calendar`: `id` is what `events` filters on and `create` takes. */
export type Calendar = {
  id: string;
  title: string;
  /** `#rrggbb` when the backend has one; usable as `icon`. */
  color: string | null;
  /** The account (`iCloud`, `Google`); null on khal. */
  source: string | null;
  /** Whether events can be added (a subscribed or holiday calendar cannot). */
  writable: boolean;
};

/** `pal_core::calendar::Attendee`. */
export type Attendee = { name: string; status: "accepted" | "declined" | "tentative" | "pending" | "unknown"; me: boolean };

/** `pal_core::calendar::Event`: times are unix ms; `end` of an all-day event is the midnight after its last day. */
export type CalendarEvent = {
  /** Shared by every occurrence of a recurring event; with `occurrence` it names one. */
  id: string;
  /** This occurrence's start, ms, on recurring events only; pass it to `delete`/`open` beside the id. */
  occurrence: number | null;
  title: string;
  start: number;
  end: number;
  all_day: boolean;
  location: string | null;
  notes: string | null;
  url: string | null;
  calendar: Calendar;
  attendees: Attendee[];
  organizer: string | null;
  /** The Zoom / Meet / Teams / Webex link found in the url, location or notes. */
  conference_url: string | null;
  recurring: boolean;
  /** The user's reply on an invitation; null on an event they own or without attendees. */
  my_status: Attendee["status"] | null;
};

/** `calendar.create`'s params: `calendar` is a `Calendar.id` (the default calendar when absent); with `all_day` the times are read as days, `end` exclusive. */
export type NewCalendarEvent = { title: string; start: number; end: number; all_day?: boolean; calendar?: string; location?: string; notes?: string };

/**
 * The calendar (`pal_core::calendar`): EventKit on macOS (every account
 * Calendar.app has), `khal` on Linux. Gated by the Calendars permission on
 * macOS: `permission()` first, `request()` once when `not_determined` (the
 * system prompt; the panel loses focus and hides while it is up), and a
 * `denied` state is only switched in System Settings (`openSettings`).
 */
export const calendar = {
  /** The state, no prompt. */
  permission: () => call<CalendarStatus>("calendar.permission"),
  /** macOS: the system prompt when `not_determined`, waited on for a few seconds; the state after. Elsewhere the same as `permission`. */
  request: () => call<CalendarStatus>("calendar.request"),
  /** macOS: System Settings on Privacy & Security > Calendars. */
  openSettings: () => call<null>("calendar.open_settings"),
  /** Every event calendar, by account then title. */
  calendars: () => call<Calendar[]>("calendar.calendars"),
  /** Events overlapping `[from, to)` (unix ms), by start; `calendars` narrows to those ids. Occurrences of recurring events are expanded. */
  events: (from: number, to: number, calendars?: string[]) => call<CalendarEvent[]>("calendar.events", { from, to, calendars }),
  /** Save a new event; resolves with its id. Rejects with the backend's complaint (a read-only calendar, an end before the start). */
  create: (event: NewCalendarEvent) => call<string>("calendar.create", event),
  /** Remove an event, or with `occurrence` one occurrence of a recurring one. Not possible over khal. */
  delete: (id: string, occurrence?: number | null) => call<null>("calendar.delete", { id, occurrence }),
  /** Show the event in Calendar.app (`ical://ekevent/…`). Not possible over khal. */
  open: (id: string, occurrence?: number | null) => call<null>("calendar.open", { id, occurrence }),
};

/** What `color.sample` answers: sRGB, 0..255 per channel, `hex` lower case `#rrggbb`. */
export type Color = { r: number; g: number; b: number; hex: string };

/** How long a screen pick may take before the call gives up: the user is aiming a loupe, not a handler hanging. */
export const SAMPLE_TIMEOUT_MS = 120_000;

/**
 * The screen's colours (`color.rs` in the app): `sample` hides the panel
 * and lets the user pick one pixel with the OS's own loupe, `NSColorSampler`
 * on macOS (no permission; the colour comes back in sRGB) and the
 * `org.freedesktop.portal.Screenshot.PickColor` portal on Linux (the
 * portal asks the first time on some desktops). Resolves with the colour,
 * or null when the user cancelled (Escape). The panel stays hidden: from
 * `pick` return at once and run the rest in the background, then
 * `effects.run({ push })` to bring the panel back where the colour is, or
 * `effects.run({ copy, hud })` to hand it over (a pick that waited here
 * would hit the shell's 10 s limit before the user has aimed).
 */
export const color = {
  sample: () => call<Color | null>("color.sample", undefined, { timeout: SAMPLE_TIMEOUT_MS }),
};

/**
 * An effect from outside a pick (`effects.rs` in the app): what a `pick`
 * would answer, run now, for work that finished after the pick returned (a
 * screen pick, a timer, a download). The OS effects only: `copy` (with
 * "Copied" in the HUD, or the `hud` text), `copy_files`, `open`, `paste`,
 * `focus`, `layout`, `hud`, and `push`, which shows the panel inside that
 * palette (its `view` or `list` asked afresh). `toast`, `keep`, `view`,
 * `form` and `show` need the level a pick came from and are refused.
 */
export const effects = {
  run: (effect: Effect) => call<null>("effects.run", { effect }),
};

/** How long a concealed copy stays on the clipboard by default (`conceal`): long enough to paste, short enough to be gone by the next coffee. */
export const CONCEAL_SECONDS = 30;

/**
 * A `copy` effect for a secret: `{ copy: conceal(password) }`. Marked for
 * clipboard managers to skip, kept out of pal's history, and replaced by
 * the previous clipboard after `clearAfter` seconds (`CONCEAL_SECONDS`;
 * 0 leaves it). The HUD says "Copied, clears in N s" unless the effect
 * carries its own `hud`.
 */
export const conceal = (text: string, clearAfter = CONCEAL_SECONDS): CopyText => ({ text, concealed: true, ...(clearAfter > 0 && { clear_after: clearAfter }) });

/**
 * The frontmost app's selected text (`selection.rs` in the app, over
 * `pal_core::selection`): the accessibility API first (`AXSelectedText`
 * of the focused element on macOS; the primary selection on Linux), then,
 * when `general.selection_snapshot` allows, a copy-shortcut snapshot with
 * the clipboard put back as it was. Resolves with null when nothing is
 * selected; rejects on macOS without Accessibility (the prompt is shown
 * once per run). The panel is up in front of the app during a pick, and
 * the selection is still the app's: reading it from `pick` works.
 */
export const selection = {
  text: () => call<string | null>("selection.text"),
};

/**
 * Text out of an image (`pal_core::ocr`): the Vision framework on macOS,
 * `tesseract` on Linux when installed (`available()` says; `image`
 * rejects with "OCR unavailable" otherwise). A PDF is its first page.
 * Lines top to bottom joined by newlines; an empty string for no text.
 */
/** A page-sized scan at the accurate level takes a few seconds; longer than the bridge's default. */
export const OCR_TIMEOUT_MS = 30_000;

export const ocr = {
  available: () => call<boolean>("ocr.available"),
  /** A file by `path`, or base64 image bytes as `data`. */
  image: (source: { path: string } | { data: string }) => call<{ text: string }>("ocr.image", source, { timeout: OCR_TIMEOUT_MS }).then((r) => r.text),
};
