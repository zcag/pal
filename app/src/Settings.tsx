/**
 * The settings window: `settings_get` in, `settings_set`/`settings_unset`
 * out, re-read on every `pal://config` (the core's reload event, so a hand
 * edit shows up as it is saved) and on `pal://host` (an extension loaded or
 * failed). The design components (ui/Settings*.tsx) know nothing of Tauri;
 * this file maps the core's shapes onto theirs and turns their onChange
 * calls into key writes.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  SettingsAbout, SettingsBar, SettingsExtensions, SettingsGeneral, SettingsOverview, SettingsShortcuts, SettingsWindow,
  aboutIndex, barIndex, extensionsIndex, generalIndex, hotkeyList, overviewIndex, overviewItems, palettesIndex, shortcutsIndex, flashAnchor, settingsPages, BAR_DEFAULTS, SettingsFeatures, featuresIndex, sidebarIndex, permissionUsers, storePermissions, type SettingsFeature,
  resolveLook, lookDefaults, lookOf, lookWrites, LOOK_KEYS, holdOf, sidebarDefaults, sidebarSummary, type BarBadgeStyle, type BarConfig, type BarFont, type BarItem, type BarItemConfig, type BarRuleEffect, type BarLookConfig, type BarLookOverride, type BarShow, type BarTarget, type Diagnostic, type GeneralConfig, type HotkeyStatus, type PaletteConfig, type PaletteKey, type PaletteTier, type PermissionId, type PermissionsStatus, type SettingSpec, type SettingValue, type SettingValues, type SidebarConfig, type SidebarEdge,
  type CrashReport, type PaletteItem, type PanicReport, type ReportKind, type SettingsExtension, type SettingsIndexEntry, type SettingsPage, type SettingsPalette, type UpdateInfo, type UpdateProgress,
  badgedIcon, leavesFile, resolveInstance, type InstanceInfo, type RawInstance, type SettingsInstance,
  useThemeFile,
} from "./ui";
import { comboOf, isMac } from "./ui/keys";
import { screenshotUrl } from "./ui/icons";
import { iconOf } from "./items";

// ---- what the core sends (settings.rs `View`, pal_core::config::Config) ----

type RawPalette = { enabled?: boolean; alias?: string; hotkey?: string; hold?: string | null; icon?: string; tier?: PaletteTier; item_hotkeys?: Record<string, string>; settings?: Record<string, unknown> };
/** core `Sidebar` as the file spells it (every key present, the core fills the defaults). */
type RawSidebar = { palette?: string; edge?: SidebarEdge; display?: string; width?: number; peek?: boolean; delay?: number; grace?: number; hotkey?: string | null };
/** core `BarLook` as the file spells it. */
type RawLook = { dim?: number; opacity?: number; size?: number; icon_size?: number; text_size?: number; spacing?: number; show_icon?: boolean; icon?: string; show_title?: boolean; color?: string; urgent_color?: string; badge_color?: string; badge_style?: BarBadgeStyle; width?: number; font?: BarFont; max_chars?: number };
type RawBarItem = RawLook & { enabled?: boolean; show?: BarShow; target?: BarTarget; position?: string; hotkey?: string; open_on_hover?: boolean; order?: number; show_when?: string; hide_when?: string; settings?: Record<string, unknown> };
type RawBar = { target: BarTarget; hover_delay: number; hover_grace: number; menubar: RawLook & { open_on_hover: boolean }; sketchybar: RawLook & { open_on_hover: boolean; position: string }; items: Record<string, RawBarItem> };
type RawConfig = {
  general: { hotkey: string | string[]; theme: GeneralConfig["theme"]; launch_at_login: boolean; menu_bar_icon: boolean; position: GeneralConfig["position"]; backspace_back?: boolean; check_updates: boolean };
  palettes: Record<string, RawPalette>;
  bar: RawBar;
  /** `[features]`: the sidebar's typed table, every other feature's as written (`[features.mouse]`, with `hotkeys`). */
  features?: { sidebar?: RawSidebar } & Record<string, Record<string, unknown> | undefined>;
  extensions: Record<string, Record<string, unknown>>;
  /** `[instances.<key>]` (core `Instance`): the configured copies of `multi` extensions, and the default's title once named. */
  instances?: Record<string, RawInstance>;
};
type ManifestPalette = { title?: string; description?: string; kind?: string; keys?: PaletteKey[]; tier?: PaletteTier; settings?: SettingSpec[] };
type ManifestStore = { tagline?: string; permissions?: string[]; screenshots?: { file: string; caption?: string; kind?: string }[] };
type Manifest = { name: string; title?: string; description?: string; version?: string; icon?: unknown; author?: string; repo?: string; multi?: boolean; settings?: SettingSpec[]; palettes?: Record<string, ManifestPalette>; store?: ManifestStore };
/** `PaletteMeta` (registry.rs): what the code said about a palette, `tier` already the manifest's over the code's (host.ts). */
type Meta = { name: string; title: string; icon?: unknown; live?: boolean; input?: boolean; view?: string; tier?: PaletteTier; hold?: string };
type Record_ = { source: string; ref?: string; installed_at: number; commit_or_etag?: string };
/** settings.rs `Ext`: one instance as the host reported it; `key` is the instance key (`gmail@work`), `name` the manifest's. */
type Ext = { key: string; name: string; instance: InstanceInfo; manifest: Manifest; root: string; loaded: boolean; error?: string; palettes: Meta[]; warnings?: string[]; installed?: number; record?: Record_ };
/** `pal_core::extensions::Update`. */
type Update = { name: string; current: string; latest: string };
/** settings.rs `Checked`: when a check ran (unix ms) and what it said, the value or the failure's message. */
type Checked<T> = { at: number; value?: T; error?: string };
/** settings.rs `Checks`: the app's release check and the store's, as last run this process. */
type Checks = { app?: Checked<UpdateInfo>; extensions?: Checked<Update[]> };
/** settings.rs `BarItemView`. */
type RawBarState = NonNullable<BarItem["state"]>;
/** A rule's effect from the file's spelling: the look keys as the page names them, plus hidden, urgent and position. */
const ruleEffect = (r: RawBarRule): BarRuleEffect => ({ ...lookOf(r), ...(r.hidden !== undefined && { hidden: r.hidden }), ...(r.urgent !== undefined && { urgent: r.urgent }), ...(r.position !== undefined && { position: r.position }) });
type RawBarRule = { when?: string; description?: string; hidden?: boolean; urgent?: boolean; position?: string } & RawLook;
type RawBarView = { key: string; extension: string; id: string; title: string; /** The manifest's `bar.<id>.settings`. */ settings_specs?: SettingSpec[]; description?: string; source: boolean; refresh_every?: number; rendered_at?: number; stale: boolean; held?: boolean; state?: RawBarState; mocks?: { id: string; title: string; item: RawBarState }[]; rules?: { id: string; when: string; description?: string; rule: RawBarRule; default?: RawBarRule; overridden: boolean; active: boolean }[]; states?: { name: string; value: boolean | number | string | null; description?: string }[] };
type View = { config: RawConfig; diagnostics: Diagnostic[]; path: string; changed?: number; version: string; extensions: Ext[]; store: string; hotkey: HotkeyStatus; permissions: PermissionsStatus; bar?: { supported: boolean; sketchybar: boolean; items: RawBarView[] }; checks: Checks; /** The displays' names, the primary first (`popover::displays`), for `[sidebar] display`. */ displays?: string[]; /** Every feature (features.rs `view`). */ features?: RawFeature[] };
/** features.rs `view`: the spec as compiled in, and what the app knows of it now. */
type RawFeature = { spec: { id: string; title: string; description: string; icon?: unknown; toggle?: string; permission?: PermissionId; why?: string; settings?: SettingSpec[]; commands?: { id: string; title: string }[] }; available: boolean; on: boolean; needs?: PermissionId | null; note?: string | null; hotkeys?: Record<string, string> };
/** settings.rs `About`: where the docs and the source live, and what the last run left behind (crash.rs). */
type About = { docs: string; repo: string; changelog?: string; report?: CrashReport; panic?: PanicReport };

/** The store site, where every bundled extension has a page. */
const STORE = "https://pal.cagdas.io/extensions";

/** The extension's name behind an instance key: `gmail` for `gmail@work` (`pal_core::config::instance::name_of`). */
const nameOf = (key: string) => key.split("@")[0];

/** `palettes.<id>`: the instance key when the palette is named like the extension's *name*, else `<key>-<palette>` (`pal_core::config::instance::palette_id`). */
const paletteId = (key: string, palette: string) => (nameOf(key) === palette ? key : `${key}-${palette}`);

/** The setting ids a non-default instance never inherits: secrets and `scope: instance` (`instance::private_ids`). */
const isPrivate = (s: SettingSpec) => s.kind === "secret" || s.scope === "instance";

/** What a non-default instance inherits of `base` (the default's table): every declared, non-private key that table sets. */
function inheritedOf(specs: SettingSpec[], base: Record<string, unknown> | undefined): SettingValues {
  const out: SettingValues = {};
  for (const s of specs) if (!isPrivate(s) && base?.[s.id] !== undefined) out[s.id] = base[s.id] as SettingValue;
  return out;
}

/** A dotted-key segment, quoted when TOML needs it. */
const seg = (s: string) => (/^[A-Za-z0-9_-]+$/.test(s) ? s : JSON.stringify(s));

const sameValue = (a: SettingValue, b: SettingValue) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isTier = (r: unknown): r is PaletteTier => r === "primary" || r === "normal" || r === "catalog";

/**
 * One entry per instance the host reported (`Ext`), and for a `multi`
 * extension one per `[instances."<name>@<suffix>"]` the host has not
 * loaded (parked: `enabled = false`), built from the default's report with
 * no palettes. `alone` is whether the extension has one enabled instance:
 * a named default is labelled only next to another.
 */
function toExtension(e: Ext, config: RawConfig, userRoot: string, latest: string | undefined, alone: boolean): SettingsExtension {
  const m = e.manifest;
  const extTitle = m.title ?? e.name;
  const own = m.icon ? iconOf(m.icon, extTitle) : undefined;
  const instance: SettingsInstance | undefined = m.multi ? resolveInstance(e.key, e.name, config.instances?.[e.key], e.instance, own?.kind === "tile" ? own.bg : undefined) : undefined;
  // "Gmail (Work)"; a lone or unnamed default stays "Gmail", as its palette titles do (the host's rule).
  const label = instance && instance.title && (!instance.isDefault || !alone) ? instance.title : undefined;
  const title = label ? `${extTitle} (${label})` : extTitle;
  const inherits = !!instance && !instance.isDefault;
  const defaultTitle = inherits ? config.instances?.[e.name]?.title?.trim() : undefined;
  const codePalettes = new Map(e.palettes.map((p) => [p.name, p]));
  const names = [...new Set([...codePalettes.keys(), ...Object.keys(m.palettes ?? {})])];
  const palettes: SettingsPalette[] = names.map((name) => {
    const id = paletteId(e.key, name);
    const meta = codePalettes.get(name);
    const declared = m.palettes?.[name];
    const raw = config.palettes[id] ?? {};
    const kind = declared?.kind ?? (meta?.view ? "view" : meta?.input ? "input" : meta?.live ? "live" : meta ? "list" : undefined);
    return {
      id,
      source: `${e.key}/${name}`,
      title: meta?.title ?? declared?.title ?? name,
      description: declared?.description,
      icon: meta?.icon ? iconOf(meta.icon, meta.title) : undefined,
      kind,
      keys: declared?.keys,
      tier: isTier(meta?.tier) ? meta.tier : isTier(declared?.tier) ? declared.tier : undefined,
      hold: meta?.hold,
      settings: declared?.settings ?? [],
      config: { enabled: raw.enabled ?? true, alias: raw.alias, hotkey: raw.hotkey, hold: raw.hold ?? undefined, icon: raw.icon, tier: isTier(raw.tier) ? raw.tier : undefined, itemHotkeys: raw.item_hotkeys, settings: (raw.settings ?? {}) as SettingValues },
      ...(inherits && { inherited: inheritedOf(declared?.settings ?? [], config.palettes[paletteId(e.name, name)]?.settings) }),
    };
  });
  const bundled = e.root !== userRoot;
  return {
    name: e.name,
    key: e.key,
    multi: m.multi,
    instance,
    ...(inherits && { inherited: inheritedOf(m.settings ?? [], config.extensions[e.name]), inheritedFrom: defaultTitle ? `${extTitle} (${defaultTitle})` : extTitle }),
    title,
    extTitle,
    description: m.description ?? "",
    tagline: m.store?.tagline,
    author: m.author,
    icon: badgedIcon(own, instance),
    version: m.version ?? "",
    latest,
    // "bundled" here means "not the store's": Update and Remove only apply there. An
    // extension from `general.extension_dirs` gets the same treatment (and the
    // "built in" label, which the page cannot yet tell apart).
    repo: m.repo ?? (bundled ? "bundled" : ""),
    bundled,
    source: e.record?.source,
    installed: e.installed,
    palettes,
    settings: m.settings ?? [],
    permissions: storePermissions(m.store?.permissions),
    values: (config.extensions[e.key] ?? {}) as SettingValues,
    loaded: e.loaded,
    error: e.error,
    warnings: e.warnings,
    // A store-installed extension has its screenshots in its checkout (the
    // `icon://` shot route); a bundled one ships without them (8.6 MB across
    // the set), so its page loads them from the store site.
    screenshots: m.store?.screenshots?.map((s) => ({ src: bundled ? `${STORE}/${e.name}/screenshots/${s.file}` : screenshotUrl(e.name, s.file), caption: s.caption, kind: s.kind })),
    storeUrl: bundled || m.repo === "bundled" ? `${STORE}/${e.name}` : undefined,
  };
}

/** The parked instances of `multi` extensions the host did not load, as entries of their own: the default's report under the instance's key, nothing loaded. */
function parkedInstances(exts: Ext[], config: RawConfig): Ext[] {
  const out: Ext[] = [];
  for (const key of Object.keys(config.instances ?? {})) {
    const name = nameOf(key);
    if (key === name || exts.some((e) => e.key === key)) continue;
    const base = exts.find((e) => e.name === name && e.manifest.multi);
    if (base) out.push({ ...base, key, instance: { key, isDefault: false }, loaded: false, error: undefined, palettes: [], warnings: [] });
  }
  return out;
}

function toBarItem(b: RawBarView, config: RawConfig, extensions: SettingsExtension[], features: RawFeature[] = []): BarItem {
  const raw = config.bar?.items?.[b.key] ?? {};
  // `b.extension` is the instance key: the entry's title carries the instance ("Gmail (Work)"). A feature's own item (keycast's) is named after the feature.
  const ext = extensions.find((e) => e.key === b.extension);
  const feature = ext ? undefined : features.find((f) => f.spec.id === b.extension)?.spec;
  return {
    key: b.key,
    extension: b.extension,
    id: b.id,
    title: b.title,
    description: b.description,
    extTitle: ext?.title ?? feature?.title ?? b.extension,
    extIcon: ext?.icon ?? (feature?.icon ? iconOf(feature.icon, feature.title) : undefined),
    source: b.source,
    refreshEvery: b.refresh_every,
    renderedAt: b.rendered_at,
    stale: b.stale,
    held: b.held,
    state: b.state,
    mocks: b.mocks,
    rules: b.rules?.map((r) => ({ id: r.id, when: r.when, description: r.description, effect: ruleEffect(r.rule), default: r.default && { when: r.default.when ?? "", effect: ruleEffect(r.default) }, overridden: r.overridden, active: r.active })),
    states: b.states,
    config: { enabled: raw.enabled ?? true, show: raw.show === "always" ? "always" : undefined, target: raw.target, position: raw.position, hotkey: raw.hotkey, openOnHover: raw.open_on_hover, order: raw.order, showWhen: raw.show_when, hideWhen: raw.hide_when, look: lookOf(raw) },
    // The item's own settings (`bar.<id>.settings`), `[bar.items."<key>".settings]`; an instance's item (`gmail@work/unread`) over the default instance's (`gmail/unread`).
    settings: (b.settings_specs ?? []).map((spec) => {
      const own = raw.settings?.[spec.id] as SettingValue | undefined;
      const baseKey = b.extension.includes("@") ? `${nameOf(b.extension)}/${b.id}` : undefined;
      const inherited = baseKey ? (config.bar?.items?.[baseKey]?.settings?.[spec.id] as SettingValue | undefined) : undefined;
      return { spec, value: own ?? inherited ?? spec.default, base: baseKey ? inherited : undefined, note: own === undefined && inherited !== undefined ? `From ${ext?.inheritedFrom ?? baseKey}` : undefined };
    }),
  };
}

/** When the newest of the two checks ran, unix ms; `undefined` while neither has. */
const checkedAt = (c: Checks): number | undefined => [c.app?.at, c.extensions?.at].filter((t): t is number => t !== undefined).sort((a, b) => b - a)[0];

/** Deep set/delete on the local copy, so the window moves before the file's reload confirms it. */
function patch(config: RawConfig, key: string[], value: unknown): RawConfig {
  const next = structuredClone(config);
  let at: Record<string, unknown> = next;
  for (const k of key.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  const last = key[key.length - 1];
  if (value === undefined) delete at[last];
  else at[last] = value;
  return next;
}

/** A text field the user is typing into: a reload landing now would put the file's last state over the keystrokes not yet written. */
function typing(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLInputElement) || el.type === "search") return false;
  return ["text", "number", "password"].includes(el.type);
}

/** The diagnostics block for a bug report, the lines `pal doctor` prints (commands.rs `Diag::text`) plus the bar. */
function diagnosticsText(view: View, extensions: SettingsExtension[], bar: BarItem[]): string {
  const loaded = extensions.filter((e) => e.loaded !== false).map((e) => e.name);
  const failed = extensions.filter((e) => e.loaded === false).map((e) => e.name);
  const hk = view.hotkey;
  const p = view.permissions;
  const perm = (v: boolean | undefined) => (v === undefined ? "n/a" : v ? "granted" : "not granted");
  return [
    `pal ${view.version}`,
    `os: ${navigator.platform}`,
    `config: ${view.path}`,
    `extensions: ${loaded.length} loaded${loaded.length ? `: ${loaded.join(", ")}` : ""}${failed.length ? `; ${failed.length} failed: ${failed.join(", ")}` : ""}`,
    `hotkey: ${hk.hotkeys.length ? hk.hotkeys.map((h) => (h.registered ? `${h.wanted} registered` : `${h.wanted} failed: ${h.error ?? "unknown"}`)).join(", ") : "off"}`,
    `accessibility: ${perm(p.accessibility)}`,
    `calendar: ${p.calendar ?? "n/a"}`,
    `full disk access: ${perm(p.full_disk_access)}`,
    `input monitoring: ${perm(p.input_monitoring)}`,
    `location: ${p.location ?? "n/a"}`,
    `theme: ${view.config.general.theme}`,
    view.bar?.supported === false ? "bar: not on this platform" : `bar: ${view.config.bar?.target ?? "auto"}, sketchybar ${view.bar?.sketchybar ? "running" : "not running"}, ${bar.length} items${bar.length ? `: ${bar.map((b) => `${b.key}${b.stale ? " (stale)" : ""}${b.config.enabled ? "" : " (off)"}`).join(", ")}` : ""}`,
    ...(view.diagnostics.length ? [`config problems: ${view.diagnostics.map((d) => `${d.level} ${d.path}${d.line ? `:${d.line}` : ""} ${d.message}`).join("; ")}`] : []),
  ].join("\n");
}

/** A timing mark on the core's clock (lib.rs `mark`): where the window's first paint falls after `settings open`. */
const mark = (name: string) => invoke("mark", { name, t: Date.now() }).catch(() => {});
mark("settings script");

/** The page the window was opened on (settings.rs `create` puts it in the URL), else the Overview. */
function startPage(): SettingsPage {
  const p = new URLSearchParams(location.search).get("page");
  // `palettes` was a page of its own until the palettes moved onto their extensions' panes (a link from before lands there).
  if (p === "palettes") return "extensions";
  return settingsPages.some((x) => x.id === p) ? (p as SettingsPage) : "overview";
}
/** The row the window was opened on (`settings::open_at`: a failed extension's root row), landed once the view is in. */
const startAnchor = (): string | null => new URLSearchParams(location.search).get("anchor");

export default function Settings() {
  const [view, setView] = useState<View | null>(null);
  const [page, setPage] = useState<SettingsPage>(startPage);
  /** An anchor to land on once the view (and so the row) exists: from the URL at start, or a later `pal://settings`. */
  const [landing, setLanding] = useState<string | null>(startAnchor);
  /** The palette unfolded on its extension's pane (`palettes:<id>` lands there). */
  const [palette, setPalette] = useState<string | undefined>(undefined);
  /** The Extensions page's selection: an extension name (one row per name, every instance in its pane), and the instance whose settings its pane shows. */
  const [ext, setExt] = useState<string | undefined>(undefined);
  const [extInstance, setExtInstance] = useState<string | undefined>(undefined);
  const [barKey, setBarKey] = useState<string | undefined>(undefined);
  /** The feature card a link or a search hit opened (`features:<id>`). */
  const [feature, setFeature] = useState<string | undefined>(undefined);
  /** The last failed command, shown in the title bar until a write succeeds. */
  const [error, setError] = useState<string | null>(null);
  const [about, setAbout] = useState<About>({ docs: "", repo: "" });
  // Re-read on every page switch: a crash report can land while the window is up (crash.rs).
  useEffect(() => { invoke<About>("settings_about").then(setAbout).catch((e) => setError(String(e))); }, [page]);
  // The startup mark: the first paint with a view, against `settings open` in the core's log.
  const painted = useRef(false);
  useLayoutEffect(() => {
    if (painted.current || !view) return;
    painted.current = true;
    mark("settings view");
    requestAnimationFrame(() => mark("settings paint"));
  }, [view]);
  const openLink = (url: string) => invoke("settings_open_link", { url }).catch((e) => setError(String(e)));

  // The first read runs at once; re-reads are coalesced (ten extensions
  // load in a burst at startup) and held while a text field has focus: the
  // field keeps what is being typed, and the read runs when focus leaves.
  const read = useCallback(() => invoke<View>("settings_get").then(setView).catch((e) => setError(String(e))), []);
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (typing()) { held.current = true; return; }
      held.current = false;
      read();
    }, 50);
  }, [read]);
  // macOS: settings.rs put the OS's vibrancy behind the window; the page goes glass over it.
  useEffect(() => { if (isMac) document.documentElement.dataset.vibrancy = ""; }, []);
  useEffect(() => {
    read();
    const a = listen("pal://config", refresh);
    const b = listen<{ method?: string }>("pal://host", (e) => { if (e.payload.method?.startsWith("extension/") || e.payload.method === "host/ready") refresh(); });
    // The hotkey's registration outcome and a permission grant land in the view too (settings.rs `View`).
    const c = listen("pal://hotkey", refresh);
    const d = listen("pal://permissions", refresh);
    // A root command opened the window on a page (settings.rs `open_page`), on a row of it when it named one (`open_at`).
    const e = listen<{ page: SettingsPage; anchor?: string | null }>("pal://settings", (ev) => { setPage(ev.payload.page); if (ev.payload.anchor) setLanding(ev.payload.anchor); });
    const onBlur = () => { if (held.current) refresh(); };
    window.addEventListener("focusout", onBlur);
    return () => { for (const u of [a, b, c, d, e]) u.then((f) => f()); window.removeEventListener("focusout", onBlur); clearTimeout(timer.current); };
  }, [read, refresh]);
  // The bar's live state (a render, a stale mark) has no event of its own: re-read while the Bar page is up.
  useEffect(() => {
    if (page !== "bar" && page !== "overview") return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [page, refresh]);

  // Escape or cmd+w (ctrl+w off macOS, keys.ts's mapping) closes (hides) the window; the design's inner scopes stop what they handle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || comboOf(e) === "cmd+w") { e.preventDefault(); invoke("settings_close"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The update checks, the app's release and the store's branches (network,
  // the unauthenticated GitHub API), live in the core (settings.rs `Checks`):
  // it runs them when the Overview or Extensions page opens only while
  // `general.check_updates` is on and the last result is a day old, and
  // remembers them, so a window opened twice a day asks once; "Check now"
  // (`force`) always runs both. The About page's button runs the app's alone.
  const [checking, setChecking] = useState(false);
  const check = useCallback((force: boolean) => {
    setChecking(true);
    invoke<Checks>("settings_check_updates", { force })
      .then((checks) => setView((v) => (v ? { ...v, checks } : v)), (e) => setError(String(e)))
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => { if (page === "overview" || page === "extensions") check(false); }, [page, check]);
  const update = view?.checks.app?.value;
  // An install's steps (updater.rs `Progress`): the row and the Overview draw them; a window opened mid-way reads the state first.
  const [progress, setProgress] = useState<UpdateProgress | undefined>(undefined);
  useEffect(() => {
    invoke<UpdateProgress>("update_progress").then(setProgress).catch(() => {});
    const u = listen<UpdateProgress>("pal://update", (e) => setProgress(e.payload));
    return () => { u.then((f) => f()); };
  }, []);
  const installUpdate = useCallback(() => invoke<void>("update_install"), []);
  const latest = useMemo(() => Object.fromEntries((view?.checks.extensions?.value ?? []).map((u) => [u.name, u.latest.slice(0, 7)])), [view]);

  /** The user's store (`Store::locate`, under the data dir): the root whose extensions Update and Remove apply to. */
  const userRoot = view?.store ?? "";
  // By title: the registry's order is the host's load order, which means nothing to the reader. One entry per instance key (a parked instance included); the Extensions page groups them by name.
  const extensions = useMemo(() => {
    if (!view) return [];
    const all = [...view.extensions, ...parkedInstances(view.extensions, view.config)];
    const enabled = (name: string) => all.filter((e) => e.name === name && view.config.instances?.[e.key]?.enabled !== false).length;
    return all.map((e) => toExtension(e, view.config, userRoot, latest[e.name], enabled(e.name) < 2)).sort((a, b) => a.title.localeCompare(b.title));
  }, [view, userRoot, latest]);
  const barItems = useMemo(() => (view?.bar ? view.bar.items.map((b) => toBarItem(b, view.config, extensions, view.features)) : []), [view, extensions]);
  const onInstall = async (spec: string) => { await invoke("extensions_install", { spec }); };
  // The core forgets the extension's pending update (settings.rs); the re-read lands it.
  const onExtUpdate = async (name: string) => { await invoke("extensions_update", { name }); refresh(); };
  const onExtRemove = async (name: string) => { await invoke("extensions_remove", { name }); refresh(); };
  // Instances (settings.rs `instances_*`): the file edits, applied to the running config at once; the host reloads the extension's instances.
  const onInstanceAdd = async (name: string, suffix: string, title?: string, tint?: string) => { await invoke<string>("instances_add", { name, suffix, title: title || null, tint: tint || null }); refresh(); };
  const onInstanceRename = async (key: string, title: string) => { await invoke("instances_rename", { key, title }); refresh(); };
  const onInstanceRemove = async (key: string) => { await invoke("instances_remove", { key }); refresh(); };
  const onInstanceEnabled = (key: string, enabled: boolean) => write(["instances", key, "enabled"], enabled ? undefined : false);
  // A selection that names nothing (first paint, or a removed extension) moves to the first entry.
  useEffect(() => {
    if (extensions.length === 0) return;
    if (ext && !extensions.some((e) => e.name === ext)) setExt(undefined);
  }, [extensions, ext]);

  /** The theme file picker's state (General): fetched and written by its own hook, since the file lives outside the config. */
  const themeFile = useThemeFile();

  /** One key to the file; `undefined` removes it. The local copy moves at once; a refused write (the core's error, `Contended` after its retry included) shows in the title bar and the file's state comes back. */
  const write = useCallback((key: string[], value: unknown) => {
    setView((v) => (v ? { ...v, config: patch(v.config, key, value) } : v));
    const dotted = key.map(seg).join(".");
    const call = value === undefined ? invoke("settings_unset", { key: dotted }) : invoke("settings_set", { key: dotted, value });
    call.then(() => setError(null), (e) => { setError(String(e)); refresh(); });
  }, [refresh]);

  /** A rule's keys under `[bar.items."<key>".rules.<id>]`; `null` unsets the table (the extension's rule applies again, or a rule of the file's own goes). The look keys are written by their file spelling. */
  const onBarRule = useCallback((key: string, id: string, w: Record<string, unknown> | null) => {
    const path = ["bar", "items", key, "rules", id];
    if (w === null) return write(path, undefined);
    const spelling = new Map<string, string>(LOOK_KEYS);
    for (const [k, v] of Object.entries(w)) write([...path, spelling.get(k) ?? k], v);
  }, [write]);

  /** A declared setting: a value equal to its default (or none) leaves the file, anything else is written. For a non-default instance `base` is the value it inherits from the default's table: an equal value leaves the file too, so the instance keeps following. */
  const writeDeclared = useCallback(async (key: string[], spec: SettingSpec | undefined, value: SettingValue, base?: SettingValue) => {
    if (spec?.kind === "secret" && typeof value === "string" && value && !/^(keychain|env):/.test(value)) {
      // The value goes to the OS store; the file gets the reference (`pal/gmail@work-token` for an instance: its own item).
      try {
        value = await invoke<string>("settings_set_secret", { key: `pal/${key.slice(1).join("-")}`, value });
      } catch (e) { setError(String(e)); return; }
    }
    write(key, leavesFile(value, spec, base) ? undefined : value);
  }, [write]);

  /** The palette's indexed rows (index.rs `query` scoped to its source: the cached listing, every row, no cap), for the item hotkeys' picker. */
  const paletteItems = useCallback(async (p: SettingsPalette): Promise<PaletteItem[]> => {
    const e = view?.extensions.find((x) => x.palettes.some((m) => paletteId(x.key, m.name) === p.id));
    const m = e?.palettes.find((m) => paletteId(e.key, m.name) === p.id);
    if (!e || !m) return [];
    const hits = await invoke<{ id: string; item: { name: string } }[]>("query", { q: "", limit: 5000, sources: [{ extension: e.key, palette: m.name }] });
    return hits.map((h) => ({ id: h.id, name: h.item.name }));
  }, [view]);

  // The landing waits for the view: `go` (below) selects the extension the anchor names out of it. Before the early returns, as every hook must be.
  useEffect(() => { if (landing && view) { setLanding(null); go(page, landing); } }); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !view) return <div className="pal-settings" style={{ padding: 16 }}>{error}</div>;
  if (!view) return null;
  const { config } = view;

  const general: GeneralConfig = { hotkeys: hotkeyList(config.general.hotkey), theme: config.general.theme, launchAtLogin: config.general.launch_at_login, menuBarIcon: config.general.menu_bar_icon, position: config.general.position, backspaceBack: config.general.backspace_back !== false, appSwitcher: (config.features?.switcher?.app_switcher as string | undefined) || undefined };
  const onGeneral = (next: GeneralConfig) => {
    // `general.hotkey` keeps the spelling the file has (a string stays a string) until a second entry needs the list.
    if (next.hotkeys.join("\n") !== general.hotkeys.join("\n")) write(["general", "hotkey"], Array.isArray(config.general.hotkey) || next.hotkeys.length > 1 ? next.hotkeys : (next.hotkeys[0] ?? ""));
    if (next.theme !== general.theme) write(["general", "theme"], next.theme);
    if (next.launchAtLogin !== general.launchAtLogin) write(["general", "launch_at_login"], next.launchAtLogin);
    if (next.menuBarIcon !== general.menuBarIcon) write(["general", "menu_bar_icon"], next.menuBarIcon ? undefined : false);
    if (next.position !== general.position) write(["general", "position"], next.position);
    if (next.backspaceBack !== general.backspaceBack) write(["general", "backspace_back"], next.backspaceBack ? undefined : false);
    if ((next.appSwitcher ?? "") !== (general.appSwitcher ?? "")) write(["features", "switcher", "app_switcher"], next.appSwitcher || undefined);
  };
  const fail = (e: unknown) => setError(String(e));

  const onPalette = (id: string, next: PaletteConfig) => {
    const p = extensions.flatMap((e) => e.palettes).find((x) => x.id === id);
    if (!p) return;
    const cur = p.config;
    if (next.enabled !== cur.enabled) write(["palettes", id, "enabled"], next.enabled ? undefined : false);
    for (const k of ["alias", "hotkey", "icon", "tier"] as const) {
      if ((next[k] ?? "") !== (cur[k] ?? "")) write(["palettes", id, k], next[k]?.trim() ? next[k] : undefined);
    }
    // `hold` keeps `""`: off is a value of its own, unset means the manifest's suggestion.
    if (next.hold !== cur.hold) write(["palettes", id, "hold"], next.hold);
    // `item_hotkeys`: one key per item, so a hand-written table keeps its
    // other lines; the whole table goes when the last one does.
    const wasKeys = cur.itemHotkeys ?? {}, nowKeys = next.itemHotkeys ?? {};
    if (JSON.stringify(wasKeys) !== JSON.stringify(nowKeys)) {
      if (!Object.keys(nowKeys).length) write(["palettes", id, "item_hotkeys"], undefined);
      else for (const k of new Set([...Object.keys(wasKeys), ...Object.keys(nowKeys)])) if (wasKeys[k] !== nowKeys[k]) write(["palettes", id, "item_hotkeys", k], nowKeys[k]);
    }
    for (const k of new Set([...Object.keys(next.settings), ...Object.keys(cur.settings)])) {
      if (!sameValue(next.settings[k], cur.settings[k])) writeDeclared(["palettes", id, "settings", k], p.settings.find((s) => s.id === k), next.settings[k], p.inherited?.[k]);
    }
  };

  /** The instance `key`'s own table (`[extensions.<key>]`); a value equal to what it inherits leaves the file. */
  const onExtension = (key: string, values: SettingValues) => {
    const e = extensions.find((x) => x.key === key);
    if (!e) return;
    for (const k of new Set([...Object.keys(values), ...Object.keys(e.values)])) {
      if (!sameValue(values[k], e.values[k])) writeDeclared(["extensions", key, k], e.settings.find((s) => s.id === k), values[k], e.inherited?.[k]);
    }
  };

  const rawBar = config.bar ?? { target: "auto" as const, hover_delay: 250, hover_grace: 400, menubar: { open_on_hover: false }, sketchybar: { open_on_hover: false, position: "right" }, items: {} };
  const bar: BarConfig = {
    target: rawBar.target, hoverDelay: rawBar.hover_delay, hoverGrace: rawBar.hover_grace, menubarHover: rawBar.menubar.open_on_hover, sketchybarHover: rawBar.sketchybar.open_on_hover, sketchybarPosition: rawBar.sketchybar.position,
    // The file's keys over the built-in look: a target table missing a key is at its default.
    menubar: resolveLook(lookDefaults, lookOf(rawBar.menubar)),
    sketchybar: resolveLook(lookDefaults, lookOf(rawBar.sketchybar)),
  };
  /** Each look key that moved: written, or unset when it is back at `base` (`lookWrites`). */
  const writeLook = (path: string[], cur: BarLookOverride, next: BarLookOverride, base: BarLookConfig) => {
    for (const [r, v] of lookWrites(cur, next, base)) write([...path, r], v);
  };
  const onBar = (next: BarConfig) => {
    if (next.target !== bar.target) write(["bar", "target"], next.target === "auto" ? undefined : next.target);
    if (next.hoverDelay !== bar.hoverDelay) write(["bar", "hover_delay"], next.hoverDelay === 250 ? undefined : next.hoverDelay);
    if (next.hoverGrace !== bar.hoverGrace) write(["bar", "hover_grace"], next.hoverGrace === 400 ? undefined : next.hoverGrace);
    if (next.menubarHover !== bar.menubarHover) write(["bar", "menubar", "open_on_hover"], next.menubarHover ? true : undefined);
    if (next.sketchybarHover !== bar.sketchybarHover) write(["bar", "sketchybar", "open_on_hover"], next.sketchybarHover ? true : undefined);
    if (next.sketchybarPosition !== bar.sketchybarPosition) write(["bar", "sketchybar", "position"], next.sketchybarPosition === "right" ? undefined : next.sketchybarPosition);
    writeLook(["bar", "menubar"], bar.menubar, next.menubar, lookDefaults);
    writeLook(["bar", "sketchybar"], bar.sketchybar, next.sketchybar, lookDefaults);
  };
  const rawSidebar = config.features?.sidebar ?? {};
  const sidebar: SidebarConfig = { palette: rawSidebar.palette ?? "", edge: rawSidebar.edge ?? sidebarDefaults.edge, display: rawSidebar.display ?? sidebarDefaults.display, width: rawSidebar.width ?? sidebarDefaults.width, peek: rawSidebar.peek ?? sidebarDefaults.peek, delay: rawSidebar.delay ?? sidebarDefaults.delay, grace: rawSidebar.grace ?? sidebarDefaults.grace, hotkey: rawSidebar.hotkey ?? undefined };
  /** `[features.sidebar]`, one key per change; a key back at the core's default leaves the file, except `palette`, where `""` is Off said outright. */
  const onSidebar = (next: SidebarConfig) => {
    if (next.palette !== sidebar.palette) write(["features", "sidebar", "palette"], next.palette);
    if (next.edge !== sidebar.edge) write(["features", "sidebar", "edge"], next.edge === sidebarDefaults.edge ? undefined : next.edge);
    if (next.display !== sidebar.display) write(["features", "sidebar", "display"], next.display === sidebarDefaults.display ? undefined : next.display);
    if (next.width !== sidebar.width) write(["features", "sidebar", "width"], next.width === sidebarDefaults.width ? undefined : next.width);
    if (next.peek !== sidebar.peek) write(["features", "sidebar", "peek"], next.peek === sidebarDefaults.peek ? undefined : next.peek);
    if (next.delay !== sidebar.delay) write(["features", "sidebar", "delay"], next.delay === sidebarDefaults.delay ? undefined : next.delay);
    if (next.grace !== sidebar.grace) write(["features", "sidebar", "grace"], next.grace === sidebarDefaults.grace ? undefined : next.grace);
    if ((next.hotkey ?? "") !== (sidebar.hotkey ?? "")) write(["features", "sidebar", "hotkey"], next.hotkey || undefined);
  };
  /** Every enabled palette as `extension/palette` with its title, what the sidebar's select offers. */
  const sidebarPalettes = extensions.flatMap((e) => e.palettes.filter((p) => p.config.enabled && p.source).map((p) => ({ id: p.source!, title: p.title === e.title ? p.title : `${e.title} › ${p.title}` })));
  /** The Windows palette (`palettes.windows`), whose chord the switcher's card and the Overview name. */
  const windows = extensions.flatMap((e) => e.palettes).find((p) => p.id === "windows");
  /** Every feature for its card: the spec flattened, `[features.<id>]` as written, its commands (the boolean settings' flips, then the declared ones). */
  const features: SettingsFeature[] = (view.features ?? []).map(({ spec, available, on, needs, note, hotkeys }) => {
    const { hotkeys: _h, ...values } = (config.features?.[spec.id] ?? {}) as Record<string, unknown>;
    const settings = spec.settings ?? [];
    const flips = settings.filter((s) => s.kind === "boolean" && (s as { command?: boolean }).command !== false).map((s) => ({ id: s.id, title: spec.toggle === s.id ? `Toggle ${spec.title}` : `Toggle: ${s.label}` }));
    return { id: spec.id, title: spec.title, description: spec.description, icon: spec.icon ? iconOf(spec.icon, spec.title) : undefined, available, on, needs: needs ?? undefined, permission: spec.permission, why: spec.why, note: note ?? undefined, toggle: spec.toggle, settings, values: values as SettingValues, commands: [...flips, ...(spec.commands ?? [])], hotkeys: hotkeys ?? {} };
  });
  const onFeatureSetting = (id: string, key: string, value: SettingValue) => { const f = features.find((x) => x.id === id); writeDeclared(["features", id, key], f?.settings.find((s) => s.id === key), value); };
  const onFeatureHotkey = (id: string, command: string, combo: string | undefined) => write(["features", id, "hotkeys", command], combo || undefined);
  const onFeatureRun = (id: string, command: string) => invoke("feature_run", { id: `${id}.${command}` }).then(refresh, fail);
  const onBarItem = (key: string, next: BarItemConfig) => {
    const cur = barItems.find((b) => b.key === key)?.config;
    if (!cur) return;
    if (next.enabled !== cur.enabled) write(["bar", "items", key, "enabled"], next.enabled ? undefined : false);
    if (next.show !== cur.show) write(["bar", "items", key, "show"], next.show === "always" ? "always" : undefined);
    if (next.target !== cur.target) write(["bar", "items", key, "target"], next.target);
    if ((next.position ?? "") !== (cur.position ?? "")) write(["bar", "items", key, "position"], next.position?.trim() || undefined);
    if ((next.hotkey ?? "") !== (cur.hotkey ?? "")) write(["bar", "items", key, "hotkey"], next.hotkey || undefined);
    if (next.openOnHover !== cur.openOnHover) write(["bar", "items", key, "open_on_hover"], next.openOnHover);
    if (next.order !== cur.order) write(["bar", "items", key, "order"], next.order);
    if ((next.showWhen ?? "") !== (cur.showWhen ?? "")) write(["bar", "items", key, "show_when"], next.showWhen?.trim() || undefined);
    if ((next.hideWhen ?? "") !== (cur.hideWhen ?? "")) write(["bar", "items", key, "hide_when"], next.hideWhen?.trim() || undefined);
    // An item's key equal to its target's default leaves the file (the target it draws on, as the pane resolves it: sketchybar's when aimed there or under `auto` with sketchybar up, else the menu bar's).
    const target = next.target ?? bar.target;
    const onSketchybar = target === "sketchybar" || (target === "auto" && (view.bar?.sketchybar ?? false));
    writeLook(["bar", "items", key], cur.look, next.look, onSketchybar ? bar.sketchybar : bar.menubar);
  };

  /** A page, and a row on it lit once it is up: the Overview's actions and the cross-page links. */
  const go = (p: SettingsPage, anchor?: string) => {
    setPage(p);
    // `palettes:<id>[:<key>]`: the palette's extension (the instance it is of) selected, the palette unfolded under its row.
    if (anchor?.startsWith("palettes:")) { const id = anchor.split(":")[1]; const hit = extensions.find((e) => e.palettes.some((x) => x.id === id)); if (hit) { setPage("extensions"); setExt(hit.name); setExtInstance(hit.key); setPalette(id); } }
    // `extensions:<key>[:<setting>]`: the key's extension is the row, its instance the pane's settings.
    if (anchor?.startsWith("extensions:")) { const key = anchor.split(":")[1]; const hit = extensions.find((e) => e.key === key); const name = hit?.name ?? nameOf(key); if (extensions.some((e) => e.name === name)) { setExt(name); if (hit) setExtInstance(hit.key); } }
    // `bar:<ext>/<item>[:<key>]` is an item's row; every other bar anchor lives on the Defaults pane, which the list selects the same way.
    if (anchor?.startsWith("bar:")) { const rest = anchor.slice(4); const key = barItems.find((b) => rest === b.key || rest.startsWith(`${b.key}:`))?.key; setBarKey(key ?? BAR_DEFAULTS); }
    if (anchor?.startsWith("features:")) setFeature(anchor);
    if (anchor) requestAnimationFrame(() => { if (!flashAnchor(anchor)) setTimeout(() => flashAnchor(anchor), 120); });
  };
  const requestPermission = (which: PermissionId) => invoke("permissions_request", { which }).then(refresh, fail);
  const openKeyboardShortcuts = () => invoke("open_system_settings", { pane: "keyboard-shortcuts" }).catch(fail);

  const barSupported = view.bar?.supported ?? isMac;
  const index: SettingsIndexEntry[] = [...overviewIndex, ...generalIndex, ...shortcutsIndex(general, extensions, barSupported ? barItems : [], barSupported ? sidebar : undefined, features), ...featuresIndex(features), ...(barSupported ? sidebarIndex : []), ...palettesIndex(extensions), ...extensionsIndex(extensions), ...barIndex(barItems, barSupported), ...aboutIndex];
  /** A search hit selects what it names before the page lights its row. */
  const onJump = (entry: SettingsIndexEntry) => go(entry.page, entry.anchor);
  const aside = error ? <span role="alert" title={error} data-error>{error}</span> : undefined;
  const fileName = view.path.split("/").pop() ?? "config.toml";
  // Off macOS every permission is a given (permissions.rs), so the rows have nothing to say.
  const permissions = isMac ? view.permissions : undefined;
  const attention = overviewItems({ version: view.version, hotkey: view.hotkey, permissions, extensions, bar: barItems, barSupported, diagnostics: view.diagnostics, update, users: permissionUsers(extensions, features) }).length;
  const sidebarLine = barSupported ? sidebarSummary(sidebar, sidebarPalettes) : undefined;

  return (
    <SettingsWindow page={page} onPage={setPage} aside={aside} index={index} onJump={onJump} diagnostics={view.diagnostics} file={fileName} onOpenDiagnostic={() => invoke("settings_open_file").catch(fail)} mac={isMac} attention={attention}>
      {page === "overview" && (
        <SettingsOverview
          version={view.version}
          hotkey={view.hotkey}
          permissions={permissions}
          extensions={extensions}
          bar={barItems}
          barSupported={barSupported}
          diagnostics={view.diagnostics}
          update={update}
          progress={progress}
          checks={{ enabled: config.general.check_updates, checkedAt: checkedAt(view.checks), error: view.checks.app?.error ?? view.checks.extensions?.error, status: view.checks.app?.value?.status, busy: checking }}
          switcher={windows ? holdOf(windows) ?? "" : undefined}
          sidebar={sidebarLine}
          users={permissionUsers(extensions, features)}
          onCheckUpdates={() => check(true)}
          onInstallUpdate={() => installUpdate().catch(fail)}
          onGo={go}
          onRequestPermission={requestPermission}
          onOpenKeyboardShortcuts={openKeyboardShortcuts}
          onUpdateExtension={(name) => onExtUpdate(name).catch(fail)}
          changelog={about.changelog}
          onOpenLink={openLink}
        />
      )}
      {page === "general" && (
        <SettingsGeneral
          value={general}
          onChange={onGeneral}
          file={{ path: view.path, changed: view.changed }}
          onOpenFile={() => invoke("settings_open_file").catch(fail)}
          onRevealFile={() => invoke("settings_reveal_file").catch(fail)}
          onResetFrecency={() => invoke("settings_reset_frecency").catch(fail)}
          onRestartHost={() => invoke("settings_restart_host").catch(fail)}
          onRefreshListings={() => invoke("index_refresh", { source: null }).catch(fail)}
          permissions={permissions}
          onRequestPermission={requestPermission}
          onOpenOverview={() => go("overview", "overview:attention")}
          themeFile={themeFile}
          onOpenShortcuts={() => go("shortcuts", "shortcuts:hotkey")}
        />
      )}
      {page === "shortcuts" && (
        <SettingsShortcuts
          general={general}
          onGeneral={onGeneral}
          hotkey={view.hotkey}
          onOpenKeyboardShortcuts={openKeyboardShortcuts}
          permissions={permissions}
          onRequestPermission={requestPermission}
          extensions={extensions}
          onPalette={onPalette}
          bar={barSupported ? barItems : undefined}
          onBarItem={barSupported ? onBarItem : undefined}
          sidebar={barSupported ? { value: sidebar, onChange: onSidebar } : undefined}
          items={paletteItems}
          onGo={go}
          features={features}
          onFeatureHotkey={onFeatureHotkey}
        />
      )}
      {page === "features" && (
        <SettingsFeatures
          features={features}
          onSetting={onFeatureSetting}
          onHotkey={onFeatureHotkey}
          onRun={onFeatureRun}
          onRequestPermission={requestPermission}
          sidebar={barSupported ? { value: sidebar, onChange: onSidebar, palettes: sidebarPalettes, displays: view.displays } : undefined}
          switcher={windows && { hold: windows.config.hold, suggested: windows.hold, onHold: (hold) => onPalette(windows.id, { ...windows.config, hold }), appSwitcher: general.appSwitcher, onAppSwitcher: (appSwitcher) => onGeneral({ ...general, appSwitcher }) }}
          open={feature?.split(":")[1]}
        />
      )}
      {page === "extensions" && <SettingsExtensions extensions={extensions} selected={ext} onSelect={setExt} selectedInstance={extInstance} onSelectInstance={setExtInstance} onChange={onExtension} onInstall={onInstall} onUpdate={onExtUpdate} onRemove={onExtRemove} onOpenLink={openLink} openPalette={palette} onOpenPalette={setPalette} onPalette={onPalette} paletteItems={paletteItems} bar={barSupported ? barItems : []} onOpenBarItem={(key) => go("bar", `bar:${key}`)} onOpenStore={() => invoke("settings_open_store").catch(fail)} onInstanceAdd={onInstanceAdd} onInstanceRename={onInstanceRename} onInstanceRemove={onInstanceRemove} onInstanceEnabled={onInstanceEnabled} />}
      {page === "bar" && <SettingsBar config={bar} onChange={onBar} items={barItems} onItem={onBarItem} onRule={onBarRule} sketchybar={view.bar?.sketchybar ?? false} supported={barSupported} selected={barKey} onSelect={setBarKey} onOpenExtension={(key) => (features.some((f) => f.id === key) ? go("features", `features:${key}`) : go("extensions", `extensions:${key}`))} onSetting={(key, id, value) => { const b = barItems.find((x) => x.key === key); writeDeclared(["bar", "items", key, "settings", id], b?.settings?.find((x) => x.spec.id === id)?.spec, value as SettingValue, b?.settings?.find((x) => x.spec.id === id)?.base); }} />}
      {page === "about" && (
        <SettingsAbout
          version={view.version}
          file={view.path}
          links={about}
          onCheckUpdates={() => invoke<UpdateInfo>("check_updates").then((u) => { refresh(); return u; })}
          update={update}
          onInstallUpdate={installUpdate}
          progress={progress}
          onOpenLink={openLink}
          onRevealFile={() => invoke("settings_reveal_file").catch(fail)}
          crash={about.report}
          panic={about.panic}
          onOpenReport={(file: ReportKind) => invoke("settings_open_file", { file }).catch(fail)}
          onRevealReport={(file: ReportKind) => invoke("settings_reveal_file", { file }).catch(fail)}
          diagnosticsText={() => diagnosticsText(view, extensions, barItems)}
        />
      )}
    </SettingsWindow>
  );
}
