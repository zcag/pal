/**
 * What the settings view renders. Mirrors core/src/config: `general`,
 * `palettes.<id>`, `extensions.<name>` and `Diagnostic`, plus the declared
 * setting schema an extension ships (not in the core yet; see the report
 * that introduced this file).
 */
import type { Icon } from "./types";

export type SettingOption = { id: string; title: string };

type Base = { id: string; label: string; description?: string };

/** One setting an extension declares, with its default. */
export type SettingSpec = Base & {
  /** The extension does nothing useful without it: an empty value puts the extension on the Overview's "Needs setup" list. */
  required?: boolean;
} &
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

export type SettingValue = string | number | boolean | string[] | undefined;
export type SettingValues = Record<string, SettingValue>;

/** Where a palette's rows sort at the root (core::index::Tier): reached by name, browsed, or a big static list. */
export type PaletteTier = "primary" | "normal" | "catalog";

/** `palettes.<id>` in the file: what pal provides to every palette without it declaring anything. */
export type PaletteConfig = {
  enabled: boolean;
  alias?: string;
  hotkey?: string;
  /** Icon override; an emoji or glyph. The extension's own icon when unset. */
  icon?: string;
  /** `tier` override; the manifest's (or the code's) when unset. */
  tier?: PaletteTier;
  /** `item_hotkeys`: global hotkeys that run one item, keyed by item id. Edited in the file. */
  itemHotkeys?: Record<string, string>;
  settings: SettingValues;
};

/** One key the manifest documents for a palette (`ManifestKey`). */
export type PaletteKey = { keys: string; title: string };

export type SettingsPalette = {
  id: string;
  title: string;
  description?: string;
  icon?: Icon;
  /** `list`, `live`, `input`, `view`: how the palette answers (the manifest's `kind`). */
  kind?: string;
  keys?: PaletteKey[];
  /** The tier the manifest or the code declares; `normal` when neither says. */
  tier?: PaletteTier;
  /** Settings the extension declared for this palette. */
  settings: SettingSpec[];
  config: PaletteConfig;
};

/** One store screenshot of an extension, served through the `icon://` scheme. */
export type Screenshot = { src: string; caption?: string; kind?: string };

export type SettingsExtension = {
  name: string;
  title: string;
  description: string;
  /** The store's one-liner (`store.tagline`), under the title; `description` when there is none. */
  tagline?: string;
  author?: string;
  icon?: Icon;
  version: string;
  /** Newer version available, when there is one. */
  latest?: string;
  /** Source repository, or "bundled" for the ones that ship with pal. */
  repo: string;
  /** Ships with pal: cannot be removed. Decided by the root it loaded from, not the manifest. */
  bundled?: boolean;
  /** What `pal install` was given (`.pal-install.json`), for an extension in the user's store. */
  source?: string;
  installed?: string | number | Date;
  palettes: SettingsPalette[];
  /** Extension-level settings the extension declared. */
  settings: SettingSpec[];
  /** `extensions.<name>` in the file. */
  values: SettingValues;
  /** False while the code fails to load; `error` says why. The manifest still lists it. */
  loaded?: boolean;
  error?: string;
  /** What the host found wrong with the manifest against the code. */
  warnings?: string[];
  screenshots?: Screenshot[];
  /** The extension's page on the store site. */
  storeUrl?: string;
};

export type GeneralConfig = {
  /** `general.hotkey` as a list, whichever spelling the file has: one entry per root hotkey, none when off. */
  hotkeys: string[];
  theme: "system" | "light" | "dark";
  launchAtLogin: boolean;
  /** The menu bar (macOS) / tray (Linux) icon; the app has no Dock icon. */
  menuBarIcon: boolean;
  position: "top" | "centre" | "last";
  /** macOS: ask for Accessibility on the panel's first show of a fresh profile. */
  askPermissionsOnStart: boolean;
};

/** hotkey.rs `RootOutcome`: one entry of `general.hotkey` and how its registration went. */
export type RootHotkeyStatus = {
  /** The entry as configured, trimmed. */
  wanted: string;
  registered: boolean;
  /** The OS's refusal, the parse error a fallback covered, or "Spotlight takes this key first". */
  error?: string;
  /** Spotlight's own binding, present only when it is the combination `wanted` names. */
  spotlight?: string;
};

/** hotkey.rs `Outcome`: every root hotkey's last registration. */
export type HotkeyStatus = {
  /** One per configured entry, in the file's order; empty when off. */
  hotkeys: RootHotkeyStatus[];
  /** At least one entry works; true with none configured. */
  registered: boolean;
};

/** The largest `general.hotkey` list Settings offers to build; the file may hold more. */
export const MAX_ROOT_HOTKEYS = 3;

/** `general.hotkey` as the file has it, as the list it means: trimmed, blanks dropped. */
export function hotkeyList(raw: string | string[] | undefined): string[] {
  return (Array.isArray(raw) ? raw : [raw ?? ""]).map((s) => s.trim()).filter(Boolean);
}

/** core::calendar::Status. */
export type CalendarPermission = "granted" | "denied" | "not_determined" | "restricted" | "unavailable";

/** permissions.rs `Status`: what the OS lets pal do. Always granted off macOS. */
export type PermissionsStatus = {
  accessibility: boolean;
  calendar?: CalendarPermission;
  /** `undefined`: nothing to probe (Messages never ran here). */
  full_disk_access?: boolean;
  input_monitoring?: boolean;
};

export type PermissionId = "accessibility" | "calendar" | "full_disk_access" | "input_monitoring";

/** One permission as a row: granted or not, what needs it, where the switch is. */
export type PermissionRow = {
  id: PermissionId;
  title: string;
  granted: boolean;
  /** Not on this machine at all (`unavailable`, nothing to probe): no row. */
  state: "granted" | "missing" | "unknown";
  /** What in pal needs it, one line. */
  needs: string;
  /** Where the switch is, one line. */
  where: string;
};

/**
 * The permissions as rows. Every row is listed (the Overview and General
 * say what each is for); `unknown` is a probe with no answer, shown as such.
 */
export function permissionRows(p: PermissionsStatus | undefined, opts: { otp?: boolean; calendar?: boolean; bar?: boolean } = {}): PermissionRow[] {
  if (!p) return [];
  const rows: PermissionRow[] = [
    { id: "accessibility", title: "Accessibility", granted: p.accessibility, state: p.accessibility ? "granted" : "missing", needs: "Paste into the app in front, switch to a window, pal action type", where: "Privacy & Security > Accessibility" },
  ];
  if (p.calendar && p.calendar !== "unavailable") {
    rows.push({ id: "calendar", title: "Calendars", granted: p.calendar === "granted", state: p.calendar === "granted" ? "granted" : "missing", needs: opts.calendar ? "The Calendar extension: My Schedule, Create Event" : "The Calendar extension (not installed)", where: p.calendar === "not_determined" ? "the system prompt, once" : "Privacy & Security > Calendars" });
  }
  if (p.full_disk_access !== undefined || opts.otp) {
    rows.push({ id: "full_disk_access", title: "Full Disk Access", granted: p.full_disk_access === true, state: p.full_disk_access === true ? "granted" : p.full_disk_access === false ? "missing" : "unknown", needs: "Verification codes (the OTP palette reads the Messages database)", where: "Privacy & Security > Full Disk Access; add pal there by hand" });
  }
  if (p.input_monitoring !== undefined) {
    rows.push({ id: "input_monitoring", title: "Input Monitoring", granted: p.input_monitoring, state: p.input_monitoring ? "granted" : "missing", needs: opts.bar ? "A bar peek closes on the next key press" : "A bar peek closes on the next key press (no bar items yet)", where: "Privacy & Security > Input Monitoring" });
  }
  return rows;
}

export type ConfigFileInfo = {
  path: string;
  /** Last change picked up from disk, when there was one. */
  changed?: string | number | Date;
};

/** core::config::Diagnostic. */
export type Diagnostic = {
  level: "warning" | "error";
  /** Dotted key path; empty for whole-file problems. */
  path: string;
  /** 1-based, when known. */
  line?: number;
  message: string;
};

export type SettingsPage = "overview" | "general" | "palettes" | "extensions" | "bar" | "about";

/**
 * One searchable entry: a page, the setting's label, where on the page it
 * lives, and the `data-anchor` of the row the window scrolls to and
 * flashes once the page is up. `keywords` widens the match.
 */
export type SettingsIndexEntry = { page: SettingsPage; label: string; hint?: string; anchor?: string; keywords?: string };

/** `[bar]` in the file (core::config::Bar), the part the Bar page edits. */
export type BarTarget = "auto" | "menubar" | "sketchybar" | "both" | "off";
export type BarConfig = {
  target: BarTarget;
  hoverDelay: number;
  hoverGrace: number;
  menubarHover: boolean;
  sketchybarHover: boolean;
  sketchybarPosition: string;
};

/** `[bar.items."<key>"]`: absent keys mean the target's defaults. */
export type BarItemConfig = {
  enabled: boolean;
  target?: BarTarget;
  position?: string;
  hotkey?: string;
  openOnHover?: boolean;
  order?: number;
};

/** One declared bar item (settings.rs `BarItemView`) with its extension and its config. */
export type BarItem = {
  /** `extension/id`. */
  key: string;
  extension: string;
  id: string;
  title: string;
  description?: string;
  extTitle: string;
  extIcon?: Icon;
  /** The code has a `render` for it; `false` is declared only, never drawn. */
  source: boolean;
  refreshEvery?: number;
  /** Unix seconds of the last render. */
  renderedAt?: number;
  stale: boolean;
  state?: { title?: string; hidden: boolean; badge?: number; dot?: boolean; urgent: boolean };
  config: BarItemConfig;
};

/**
 * The extension-level settings an extension cannot work without and that
 * are still empty: `required` in the manifest, else a `secret` (a token)
 * or a `url` whose description offers no fallback for an empty value
 * (the manifests' convention is to say "empty" when there is one).
 */
export function needsSetup(ext: SettingsExtension): SettingSpec[] {
  return ext.settings.filter((s) => {
    const v = ext.values[s.id];
    const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (!empty) return false;
    if (s.required) return true;
    if (s.kind !== "secret" && !(s.kind === "text" && /url|host|endpoint/i.test(s.id))) return false;
    return !/empty|optional|leave/i.test(s.description ?? "") && !s.default;
  });
}

export const defaultOf = (spec: SettingSpec): SettingValue => spec.default;

export const isModified = (spec: SettingSpec, value: SettingValue) => {
  const d = defaultOf(spec);
  if (Array.isArray(d) || Array.isArray(value)) return JSON.stringify(d ?? []) !== JSON.stringify(value ?? []);
  return (value ?? undefined) !== (d ?? undefined);
};

/** A default as the user reads it: `ctrl+space`, `on`, `200 entries`, `none`. */
export function describeDefault(spec: SettingSpec): string {
  const d = defaultOf(spec);
  if (d === undefined || (Array.isArray(d) && d.length === 0) || d === "") return "none";
  if (spec.kind === "boolean") return d ? "on" : "off";
  if (spec.kind === "select") return spec.options.find((o) => o.id === d)?.title ?? String(d);
  if (spec.kind === "number") return `${d}${spec.unit ? ` ${spec.unit}` : ""}`;
  if (Array.isArray(d)) return d.join(", ");
  return String(d);
}
