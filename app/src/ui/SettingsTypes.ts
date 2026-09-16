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
export type SettingSpec = Base &
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

/** `palettes.<id>` in the file: what pal provides to every palette without it declaring anything. */
export type PaletteConfig = {
  enabled: boolean;
  alias?: string;
  hotkey?: string;
  /** Icon override; an emoji or glyph. The extension's own icon when unset. */
  icon?: string;
  settings: SettingValues;
};

export type SettingsPalette = {
  id: string;
  title: string;
  description?: string;
  icon?: Icon;
  /** Settings the extension declared for this palette. */
  settings: SettingSpec[];
  config: PaletteConfig;
};

export type SettingsExtension = {
  name: string;
  title: string;
  description: string;
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
};

export type GeneralConfig = {
  hotkey: string;
  theme: "system" | "light" | "dark";
  launchAtLogin: boolean;
  /** The menu bar (macOS) / tray (Linux) icon; the app has no Dock icon. */
  menuBarIcon: boolean;
  position: "top" | "centre" | "last";
  /** macOS: ask for Accessibility on the panel's first show of a fresh profile. */
  askPermissionsOnStart: boolean;
};

/** hotkey.rs `Outcome`: how the root hotkey's last registration went. */
export type HotkeyStatus = {
  /** `general.hotkey` as configured, trimmed; empty when off. */
  wanted: string;
  registered: boolean;
  /** The OS's refusal, or the parse error a fallback covered. */
  error?: string;
  /** Spotlight's own binding, present only when it is the combination `wanted` names. */
  spotlight?: string;
};

/** permissions.rs `Status`: what the OS lets pal do. Always granted off macOS. */
export type PermissionsStatus = {
  accessibility: boolean;
};

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

export type SettingsPage = "general" | "palettes" | "extensions" | "about";

/** One searchable entry: a page, the setting's label, and where on the page it lives. */
export type SettingsIndexEntry = { page: SettingsPage; label: string; hint?: string };

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
