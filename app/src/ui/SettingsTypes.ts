/**
 * What the settings view renders. Mirrors core/src/config: `general`,
 * `palettes.<id>`, `extensions.<name>` and `Diagnostic`, plus the declared
 * setting schema an extension ships (not in the core yet; see the report
 * that introduced this file).
 */
import { defaultLook, type BarLook } from "./BarStrip";
import { BRAND } from "./icons";
import type { Brand, Icon } from "./types";

export type SettingOption = { id: string; title: string };

type Base = { id: string; label: string; description?: string };

/** One setting an extension declares, with its default. */
export type SettingSpec = Base & {
  /** The extension does nothing useful without it: an empty value puts the extension on the Overview's "Needs setup" list. */
  required?: boolean;
  /** `instance`: identifies the account (a server url, a workspace); never inherited by another instance of a `multi` extension, like a secret. */
  scope?: "instance";
  /** The bar item (its id) the setting is about: Settings > Bar shows it on that item's pane too. An id starting `bar_` with no `bar` is shown on every item of the extension. */
  bar?: string;
  /** Read only while other settings hold these values (`{ "auth": "token" }`); otherwise an empty value is not missing. */
  only?: Record<string, string>;
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
  /** `hold`, the switcher chord: unset follows the manifest's suggestion (`SettingsPalette.hold`), `""` turns it off, anything else is the chord. */
  hold?: string;
  /** Icon override; an emoji or glyph. The extension's own icon when unset. */
  icon?: string;
  /** `tier` override; the manifest's (or the code's) when unset. */
  tier?: PaletteTier;
  /** `item_hotkeys`: global hotkeys that run one item, keyed by item id. Edited in the file. */
  itemHotkeys?: Record<string, string>;
  settings: SettingValues;
};

/** The switcher chord that applies to a palette: the file's, else the manifest's; `undefined` when off (`""` in the file, or nothing suggested). */
export const holdOf = (p: SettingsPalette): string | undefined => (p.config.hold ?? p.hold)?.trim() || undefined;

/** One key the manifest documents for a palette (`ManifestKey`). */
export type PaletteKey = { keys: string; title: string };

export type SettingsPalette = {
  id: string;
  /** `extension/palette`, what `[sidebar] palette` and the hotkey targets name; absent for a fixture. */
  source?: string;
  title: string;
  description?: string;
  icon?: Icon;
  /** `list`, `live`, `input`, `view`: how the palette answers (the manifest's `kind`). */
  kind?: string;
  keys?: PaletteKey[];
  /** The tier the manifest or the code declares; `normal` when neither says. */
  tier?: PaletteTier;
  /** The switcher chord the manifest suggests (`alt+tab` for Windows); applies while the file has no `hold` line. */
  hold?: string;
  /** Settings the extension declared for this palette. */
  settings: SettingSpec[];
  config: PaletteConfig;
  /** A non-default instance: the default instance's palette settings it inherits (`[palettes.gmail-inbox].settings` under `[palettes."gmail@work-inbox"]`), minus the private ones. */
  inherited?: SettingValues;
};

/**
 * One instance of a `multi` extension (`[instances.<key>]`, docs/design/instances.md):
 * the default is the extension's bare name, another `<name>@<suffix>`.
 */
export type SettingsInstance = {
  /** `gmail`, `gmail@work`. */
  key: string;
  /** The part after the `@`; none for the default. */
  suffix?: string;
  /** The display name ("Work"): as configured, else the suffix capitalised; the default has none until named. */
  title?: string;
  /** The tile's colour and corner letter of a non-default instance. */
  tint?: Brand;
  badge?: string;
  isDefault: boolean;
  /** `enabled = false` parks it: not loaded, its rows gone, its settings kept. */
  enabled: boolean;
};

/** One store screenshot of an extension, served through the `icon://` scheme. */
export type Screenshot = { src: string; caption?: string; kind?: string };

export type SettingsExtension = {
  /** The manifest name, the directory: `gmail` for every instance. */
  name: string;
  /** The instance key (`gmail@work`); the name for the default and for a non-`multi` extension. What the config tables, the links and the bar keys use. */
  key: string;
  /** The extension declares `multi`: Settings offers another account. */
  multi?: boolean;
  /** Which instance this entry is, for a `multi` extension. */
  instance?: SettingsInstance;
  /** A non-default instance: the values it takes from the default's table (`[extensions.gmail]`) when its own has none, secrets and `scope: instance` left out. */
  inherited?: SettingValues;
  /** The title of the instance `inherited` comes from ("Gmail (Personal)"). */
  inheritedFrom?: string;
  /** "Gmail (Work)": the extension's title with the instance's label; the extension's alone otherwise. */
  title: string;
  /** The extension's title alone ("Gmail"), for the pane that groups its instances; `title` when absent. */
  extTitle?: string;
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
  /** The OS permissions it uses, read from its store listing's `permissions` (`calendars`, `full-disk-access`, `location`…; `storePermissions`): the Overview asks for one only when something uses it. */
  permissions?: PermissionId[];
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
  /** `general.backspace_back`: Backspace with nothing typed goes back a level. */
  backspaceBack: boolean;
  /** `[features.switcher] app_switcher`: macOS's own App Switcher on this Tab chord, through the event tap; unset is off. */
  appSwitcher?: string;
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
  /** A switcher chord the Dock owns (`cmd+tab`), as configured, waiting on Input Monitoring for its event tap. */
  hold_blocked?: string;
};

/** The largest `general.hotkey` list Settings offers to build; the file may hold more. */
export const MAX_ROOT_HOTKEYS = 3;

/** `general.hotkey` as the file has it, as the list it means: trimmed, blanks dropped. */
export function hotkeyList(raw: string | string[] | undefined): string[] {
  return (Array.isArray(raw) ? raw : [raw ?? ""]).map((s) => s.trim()).filter(Boolean);
}

/** core::permission::Status (Calendars, Location): `not_determined` prompts on request, `denied` is switched in System Settings. */
export type PromptPermission = "granted" | "denied" | "not_determined" | "restricted" | "unavailable";

/** permissions.rs `Status`: what the OS lets pal do. Always granted off macOS. */
export type PermissionsStatus = {
  accessibility: boolean;
  calendar?: PromptPermission;
  /** `undefined`: nothing to probe (Messages never ran here). */
  full_disk_access?: boolean;
  input_monitoring?: boolean;
  /** Location Services: Wi-Fi network names on macOS 15+. */
  location?: PromptPermission;
};

export type PermissionId = "accessibility" | "calendar" | "full_disk_access" | "input_monitoring" | "location";

/** One permission as a row: granted or not, what needs it, where the switch is. */
export type PermissionRow = {
  id: PermissionId;
  title: string;
  granted: boolean;
  /** Not on this machine at all (`unavailable`, nothing to probe): no row. */
  state: "granted" | "missing" | "unknown";
  /** What in pal needs it, a few words: the General list's note after the title. */
  brief: string;
  /** What in pal needs it, one line. */
  needs: string;
  /** Where the switch is, one line. */
  where: string;
};

/**
 * The permissions as rows. Every row is listed (the Overview and General
 * say what each is for); `unknown` is a probe with no answer, shown as such.
 */
/** Who uses a permission and what for: an extension that declares it (its manifest's `permissions`), a feature that is on (its spec's `permission` and `why`). */
export type PermissionUser = { who: string; why?: string };

/** The store listing's words for the OS permissions (`store.permissions` in a manifest, next to `network`, `token` and the tools it runs). */
const STORE_PERMISSION: Record<string, PermissionId> = { accessibility: "accessibility", calendars: "calendar", "full-disk-access": "full_disk_access", "input-monitoring": "input_monitoring", location: "location" };

/** The OS permissions among a store listing's `permissions`. */
export const storePermissions = (listed: unknown): PermissionId[] => (Array.isArray(listed) ? [...new Set(listed.map((w) => STORE_PERMISSION[String(w)]).filter((p): p is PermissionId => !!p))] : []);

/**
 * Who uses each permission: every extension whose store listing names it
 * (by title, once per name), and every feature that is on with a
 * `permission` and its `why`.
 */
export function permissionUsers(extensions: SettingsExtension[], features: { title: string; on: boolean; permission?: PermissionId; why?: string }[] = []): Partial<Record<PermissionId, PermissionUser[]>> {
  const out: Partial<Record<PermissionId, PermissionUser[]>> = {};
  const add = (id: PermissionId, u: PermissionUser) => { const list = (out[id] ??= []); if (!list.some((x) => x.who === u.who)) list.push(u); };
  for (const e of extensions) for (const id of e.permissions ?? []) add(id, { who: e.extTitle ?? e.title });
  for (const f of features) if (f.on && f.permission && f.why) add(f.permission, { who: f.title, why: f.why });
  return out;
}

/** "Calendar: My Schedule and Create Event. Keycast: the keys typed…", or `none` when nothing installed uses it. */
const usedBy = (users: PermissionUser[] | undefined, none: string) => (users?.length ? users.map(line).join(". ") : none);
const line = (u: PermissionUser) => (u.why ? `${u.who}: ${u.why}` : `${u.who} uses it`);

/**
 * The permissions as rows. Every row is listed (the Overview and General
 * say what each is for); `unknown` is a probe with no answer, shown as such.
 * `users` is what the installed extensions and the features that are on
 * use each one for; `bar` whether any bar item is registered.
 */
export function permissionRows(p: PermissionsStatus | undefined, opts: { users?: Partial<Record<PermissionId, PermissionUser[]>>; bar?: boolean } = {}): PermissionRow[] {
  if (!p) return [];
  const u = opts.users ?? {};
  const brief = (id: PermissionId, fallback: string) => (u[id]?.length ? u[id]!.map((x) => x.who).join(", ") : fallback);
  const rows: PermissionRow[] = [
    { id: "accessibility", title: "Accessibility", granted: p.accessibility, state: p.accessibility ? "granted" : "missing", brief: ["paste", "window switching", ...(u.accessibility ?? []).map((x) => x.who)].join(", "), needs: ["Paste into the app in front, switch to a window, pal action type", ...(u.accessibility ?? []).map(line)].join(". "), where: "Privacy & Security > Accessibility" },
  ];
  if (p.calendar && p.calendar !== "unavailable") {
    rows.push({ id: "calendar", title: "Calendars", granted: p.calendar === "granted", state: p.calendar === "granted" ? "granted" : "missing", brief: brief("calendar", "nothing installed"), needs: usedBy(u.calendar, "Nothing installed reads your calendars"), where: p.calendar === "not_determined" ? "the system prompt, once" : "Privacy & Security > Calendars" });
  }
  if (p.full_disk_access !== undefined || u.full_disk_access?.length) {
    rows.push({ id: "full_disk_access", title: "Full Disk Access", granted: p.full_disk_access === true, state: p.full_disk_access === true ? "granted" : p.full_disk_access === false ? "missing" : "unknown", brief: brief("full_disk_access", "nothing installed"), needs: usedBy(u.full_disk_access, "Nothing installed reads protected files"), where: "Privacy & Security > Full Disk Access; add pal there by hand" });
  }
  if (p.input_monitoring !== undefined) {
    const peek = opts.bar ? "A bar peek closes on the next key press" : "A bar peek closes on the next key press (no bar items yet)";
    rows.push({ id: "input_monitoring", title: "Input Monitoring", granted: p.input_monitoring, state: p.input_monitoring ? "granted" : "missing", brief: [...(u.input_monitoring ?? []).map((x) => x.who), "bar peeks"].join(", "), needs: [...(u.input_monitoring ?? []).map(line), peek].join(". "), where: "Privacy & Security > Input Monitoring" });
  }
  if (p.location && p.location !== "unavailable") {
    rows.push({ id: "location", title: "Location", granted: p.location === "granted", state: p.location === "granted" ? "granted" : "missing", brief: brief("location", "Wi-Fi network names"), needs: usedBy(u.location, "Wi-Fi network names (macOS shows them only to apps with Location access); nothing installed asks for them"), where: p.location === "not_determined" ? "the system prompt, once" : "Privacy & Security > Location Services" });
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

export type SettingsPage = "overview" | "general" | "shortcuts" | "features" | "extensions" | "bar" | "about";

/**
 * One searchable entry: a page, the setting's label, where on the page it
 * lives, and the `data-anchor` of the row the window scrolls to and
 * flashes once the page is up. `keywords` widens the match.
 */
export type SettingsIndexEntry = { page: SettingsPage; label: string; hint?: string; anchor?: string; keywords?: string };

/** `[bar]` in the file (core::config::Bar), the part the Bar page edits. */
export type BarTarget = "auto" | "menubar" | "sketchybar" | "both" | "off";
export type BarBadgeStyle = "count" | "dot" | "none";
export type BarFont = "system" | "mono";
/** The appearance keys of `[bar.menubar]` / `[bar.sketchybar]` (core `BarLook`), the strip renderer's `BarLook`. */
export type BarLookConfig = BarLook;
/** One item's say on each look key (core `BarLookOverride`); absent means the target's. */
export type BarLookOverride = Partial<BarLookConfig>;
export type BarConfig = {
  target: BarTarget;
  hoverDelay: number;
  hoverGrace: number;
  menubarHover: boolean;
  sketchybarHover: boolean;
  sketchybarPosition: string;
  menubar: BarLookConfig;
  sketchybar: BarLookConfig;
};

/** `Bar::look`: the target's defaults with the item's keys on top. */
export function resolveLook(base: BarLookConfig, over: BarLookOverride): BarLookConfig {
  const out = { ...base };
  for (const k of Object.keys(over) as (keyof BarLookConfig)[]) if (over[k] !== undefined) (out as Record<string, unknown>)[k] = over[k];
  return out;
}

/** The built-in look (core `BarLook::default`), the same for both targets. */
export const lookDefaults: BarLookConfig = defaultLook;

/** The look keys: the page's camelCase to the file's snake_case. */
export const LOOK_KEYS: [keyof BarLookConfig, string][] = [["dim", "dim"], ["opacity", "opacity"], ["size", "size"], ["iconSize", "icon_size"], ["textSize", "text_size"], ["spacing", "spacing"], ["showIcon", "show_icon"], ["icon", "icon"], ["showTitle", "show_title"], ["color", "color"], ["urgentColor", "urgent_color"], ["badgeColor", "badge_color"], ["badgeStyle", "badge_style"], ["width", "width"], ["font", "font"], ["maxChars", "max_chars"]];

/** The file's look keys (a target table, an item table) as the page's override. */
export function lookOf(raw: Record<string, unknown> | undefined): BarLookOverride {
  const out: BarLookOverride = {};
  for (const [k, r] of LOOK_KEYS) if (raw?.[r] !== undefined) (out as Record<string, unknown>)[k] = raw[r];
  return out;
}

/**
 * What to write when a look moves from `cur` to `next`: each changed key
 * as its file spelling with the value, or `undefined` (unset) when it is
 * back at `base` (the built-in default for a target table, the target's
 * value for an item), empty, or cleared.
 */
export function lookWrites(cur: BarLookOverride, next: BarLookOverride, base: BarLookConfig): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, r] of LOOK_KEYS) {
    if (cur[k] === next[k]) continue;
    const v = next[k];
    const unset = v === undefined || v === base[k] || v === "";
    // Nothing in the file and nothing to put there: no write.
    if (unset && cur[k] === undefined) continue;
    out.push([r, unset ? undefined : v]);
  }
  return out;
}

/** `[features.sidebar]` in the file (core::config::Sidebar): one live palette docked to a screen edge. */
export type SidebarEdge = "left" | "right";
export type SidebarConfig = {
  /** `extension/palette`; empty is no sidebar. */
  palette: string;
  edge: SidebarEdge;
  /** `cursor`, `primary`, or a display's name as the OS reports it. */
  display: string;
  /** Points. */
  width: number;
  /** The pointer at the edge peeks it. */
  peek: boolean;
  /** Milliseconds the pointer rests at the edge before the peek; 0 is at once. */
  delay: number;
  /** Milliseconds after the pointer has left before a peek closes. */
  grace: number;
  hotkey?: string;
};

/** The core's defaults (`Sidebar::default`): what an absent key means, and what a value equal to it leaves out of the file. */
export const sidebarDefaults: SidebarConfig = { palette: "", edge: "right", display: "cursor", width: 280, peek: true, delay: 0, grace: 150 };

/** The palette the sidebar is built for; what the General page's switch writes. */
export const SIDEBAR_WINDOWS = "windows/windows";

/** `[bar.items] show`: what an item with nothing to say does with its slot (core `BarShow`). */
export type BarShow = "auto" | "always";

/** `[bar.items."<key>"]`: absent keys mean the target's defaults. */
export type BarItemConfig = {
  enabled: boolean;
  /** Unset is `auto`: hidden while the render says so; `always` keeps the render's `empty` shape, muted. */
  show?: BarShow;
  target?: BarTarget;
  position?: string;
  hotkey?: string;
  openOnHover?: boolean;
  order?: number;
  /** A state expression (docs/design/states.md): on the strip only while true. */
  showWhen?: string;
  /** The opposite: off the strip while true. */
  hideWhen?: string;
  look: BarLookOverride;
};

/** What a rule does while it holds: presence, urgency, and the look keys (`BarLookOverride`), each unset meaning "leave". */
export type BarRuleEffect = BarLookOverride & { hidden?: boolean; urgent?: boolean; position?: string };

/** One rule of a bar item as the pane lists it (settings.rs `BarRuleView`): as it applies, the extension's own for comparison, and whether it holds now. */
export type BarRuleView = {
  id: string;
  when: string;
  description?: string;
  effect: BarRuleEffect;
  /** The extension's rule; absent for one of the file's own. */
  default?: { when: string; effect: BarRuleEffect };
  overridden: boolean;
  active: boolean;
};

/** A state the item's renders publish, with its live value. */
export type BarStateView = { name: string; value: boolean | number | string | null; description?: string };

/** One static state an extension declared for its Settings-only bar preview. */
export type BarItemMock = {
  /** Stable manifest key, never shown to the user. */
  id: string;
  /** A condition label such as "Starts in 4 min". */
  title: string;
  item: BarItemState;
};

/** The compact render state settings.rs exposes for the live and mock strips. `empty` is what `show = "always"` keeps of a hidden item (`BarItem.empty`, the menu left out). */
export type BarItemState = { title?: string; hidden: boolean; badge?: number; dot?: boolean; urgent: boolean; icon?: unknown; segments?: { id: string; icon?: string; text?: string; color?: string }[]; color?: string; progress?: number; tooltip?: string; empty?: { icon?: unknown; title?: string; tooltip?: string } };

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
  /** Off every target by its `show_when`/`hide_when`. */
  held?: boolean;
  /** The last render's strip (settings.rs `BarItemState`): the state line and the preview read it. */
  state?: BarItemState;
  /** Optional, extension-declared states that replace only this pane's strip. */
  mocks?: BarItemMock[];
  /** The item's rules as they apply, in order. */
  rules?: BarRuleView[];
  /** The facts the item publishes, what its rules read. */
  states?: BarStateView[];
  config: BarItemConfig;
  /** The item's own settings (its manifest's `bar.<id>.settings`): shown on its pane, written to `[bar.items."<key>".settings]`. */
  settings?: BarItemSetting[];
};

/** One item setting as the bar pane shows it: the spec, its current value, and what an instance's item inherits from the default instance's (SettingsExtensions draws the same row). */
export type BarItemSetting = { spec: SettingSpec; value: SettingValue | undefined; base?: SettingValue; note?: string };

/**
 * The extension-level settings an extension cannot work without and that
 * are still empty: `required` in the manifest, else a `secret` (a token)
 * or a `url` whose description offers no fallback for an empty value
 * (the manifests' convention is to say "empty" when there is one).
 */
export function needsSetup(ext: SettingsExtension): SettingSpec[] {
  const value = (id: string) => ext.values[id] ?? ext.inherited?.[id] ?? ext.settings.find((s) => s.id === id)?.default;
  return ext.settings.filter((s) => {
    const v = ext.values[s.id] ?? ext.inherited?.[s.id];
    const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (!empty) return false;
    if (s.only && Object.entries(s.only).some(([id, want]) => value(id) !== want)) return false;
    if (s.required) return true;
    if (s.kind !== "secret" && !(s.kind === "text" && /url|host|endpoint/i.test(s.id))) return false;
    return !/empty|optional|leave/i.test(s.description ?? "") && !s.default;
  });
}

export const defaultOf = (spec: SettingSpec): SettingValue => spec.default;

/**
 * Whether a declared setting's `value` leaves the file rather than being
 * written: none, empty, or equal to what the key falls back to, which is
 * `base` when given (the value a non-default instance inherits from the
 * default's table, so an equal value keeps following it) and the declared
 * default otherwise.
 */
export function leavesFile(value: SettingValue, spec: SettingSpec | undefined, base?: SettingValue): boolean {
  return value === undefined || value === "" || JSON.stringify(value ?? null) === JSON.stringify((base ?? spec?.default) ?? null);
}

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

// ---- instances ---------------------------------------------------------------

/** The longest instance suffix (`pal_core::config::instance::MAX_SUFFIX`). */
export const MAX_SUFFIX = 32;

/** `[a-z0-9][a-z0-9_-]{0,31}` and never `default`: the suffix grammar of `pal_core::config::instance::valid_suffix`. */
export const validSuffix = (s: string): boolean => new RegExp(`^[a-z0-9][a-z0-9_-]{0,${MAX_SUFFIX - 1}}$`).test(s) && s !== "default";

/** Why a suffix is refused, one line for the form; empty when it is fine. */
export function suffixProblem(s: string, taken: string[] = []): string {
  if (!s) return "A suffix is needed: it names the instance in the file, the links and the keychain.";
  if (s === "default") return "\"default\" is the default instance itself.";
  if (s.length > MAX_SUFFIX) return `At most ${MAX_SUFFIX} characters.`;
  if (!/^[a-z0-9]/.test(s)) return "Starts with a lowercase letter or a digit.";
  if (!validSuffix(s)) return "Lowercase letters, digits, - and _ only.";
  if (taken.includes(s)) return `There is a ${s} instance already.`;
  return "";
}

/** A title as a suffix: lowercased, accents dropped, runs of anything else as one `-`, trimmed, cut to the limit ("Work (SerpApi)" is `work-serpapi`). */
export function slugSuffix(title: string): string {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, MAX_SUFFIX).replace(/[-_]+$/g, "");
}

/** "work" is "Work": the title the host gives an untitled instance (`capitalised`, host/src/instances.ts). */
export const suffixTitle = (suffix: string): string => suffix.charAt(0).toUpperCase() + suffix.slice(1);

/**
 * The tint the host picks for an instance with none configured: a djb2
 * hash of the suffix over the brand colours, the extension's own skipped
 * (`tintOf`, host/src/instances.ts; `BRAND` is `TILE_COLORS` in the same
 * order). Kept here so a parked instance's tile and the add form's
 * default read as the host will draw them.
 */
export function instanceTint(suffix: string, own?: Brand): Brand {
  const choices = BRAND.filter((c) => c !== own);
  let h = 5381;
  for (const ch of suffix) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return choices[h % choices.length];
}

/** The badge the host gives an instance with none configured: the title's first letter, upper case. */
export const instanceBadge = (title: string): string => [...title][0]?.toUpperCase() ?? "";

/** `[instances.<key>]` as the file has it (core `Instance`). */
export type RawInstance = { title?: string; tint?: string; badge?: string; enabled?: boolean };

/** What the host announced for an instance (settings.rs `InstanceInfo`). */
export type InstanceInfo = { key: string; title?: string; tint?: string; badge?: string; isDefault: boolean };

/**
 * The instance of `key` as the Settings pages show it: the host's
 * announcement (the tint and badge it resolved) over the file's table,
 * the defaults filled the host's way for one the host has not loaded (a
 * parked instance). `own` is the extension's tile colour, skipped by the
 * tint hash.
 */
export function resolveInstance(key: string, name: string, raw: RawInstance | undefined, info: InstanceInfo | undefined, own?: Brand): SettingsInstance {
  const enabled = raw?.enabled !== false;
  if (key === name) {
    const title = info?.title ?? raw?.title?.trim();
    return { key, isDefault: true, enabled, ...(title && { title }) };
  }
  const suffix = key.slice(name.length + 1);
  const title = info?.title ?? raw?.title?.trim() ?? suffixTitle(suffix);
  const tint = (info?.tint as Brand | undefined) ?? (raw?.tint && BRAND.includes(raw.tint as Brand) ? (raw.tint as Brand) : instanceTint(suffix, own));
  const badge = info?.badge ?? ([...(raw?.badge?.trim() ?? "")].slice(0, 2).join("") || instanceBadge(title));
  return { key, suffix, title, tint, badge, isDefault: false, enabled };
}

/** The extension's tile as the instance's: the tint and the badge in its corner (a tile icon only; anything else stays). */
export function badgedIcon(icon: Icon | undefined, inst: SettingsInstance | undefined): Icon | undefined {
  if (!icon || !inst || inst.isDefault || icon.kind !== "tile") return icon;
  return { ...icon, bg: inst.tint ?? icon.bg, badge: inst.badge };
}

/** The instances of the extension `ext` belongs to, the default first, then by key (`SettingsExtension.instance` of every entry of its name). */
export function instancesOf(ext: SettingsExtension, all: SettingsExtension[]): SettingsExtension[] {
  return all.filter((e) => e.name === ext.name).sort((a, b) => Number(!!b.instance?.isDefault) - Number(!!a.instance?.isDefault) || a.key.localeCompare(b.key));
}
