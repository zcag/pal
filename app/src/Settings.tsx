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
  SettingsAbout, SettingsBar, SettingsExtensions, SettingsGeneral, SettingsOverview, SettingsPalettes, SettingsWindow,
  aboutIndex, barIndex, extensionsIndex, generalIndex, overviewIndex, overviewItems, palettesIndex, flashAnchor, settingsPages,
  type BarConfig, type BarItem, type BarItemConfig, type BarTarget, type Diagnostic, type GeneralConfig, type HotkeyStatus, type PaletteConfig, type PaletteKey, type PaletteTier, type PermissionId, type PermissionsStatus, type SettingSpec, type SettingValue, type SettingValues,
  type CrashReport, type PanicReport, type ReportKind, type SettingsExtension, type SettingsIndexEntry, type SettingsPage, type SettingsPalette, type UpdateInfo,
} from "./ui";
import { comboOf, isMac } from "./ui/keys";
import { screenshotUrl } from "./ui/icons";
import { iconOf } from "./items";

// ---- what the core sends (settings.rs `View`, pal_core::config::Config) ----

type RawPalette = { enabled?: boolean; alias?: string; hotkey?: string; icon?: string; tier?: PaletteTier; item_hotkeys?: Record<string, string>; settings?: Record<string, unknown> };
type RawBarItem = { enabled?: boolean; target?: BarTarget; position?: string; hotkey?: string; open_on_hover?: boolean; order?: number };
type RawBar = { target: BarTarget; hover_delay: number; hover_grace: number; menubar: { open_on_hover: boolean }; sketchybar: { open_on_hover: boolean; position: string }; items: Record<string, RawBarItem> };
type RawConfig = {
  general: { hotkey: string; theme: GeneralConfig["theme"]; launch_at_login: boolean; menu_bar_icon: boolean; position: GeneralConfig["position"]; ask_permissions_on_start: boolean; check_updates: boolean };
  palettes: Record<string, RawPalette>;
  bar: RawBar;
  extensions: Record<string, Record<string, unknown>>;
};
type ManifestPalette = { title?: string; description?: string; kind?: string; keys?: PaletteKey[]; tier?: PaletteTier; settings?: SettingSpec[] };
type ManifestStore = { tagline?: string; screenshots?: { file: string; caption?: string; kind?: string }[] };
type Manifest = { name: string; title?: string; description?: string; version?: string; icon?: string; author?: string; repo?: string; settings?: SettingSpec[]; palettes?: Record<string, ManifestPalette>; store?: ManifestStore };
/** `PaletteMeta` (registry.rs): what the code said about a palette, `tier` already the manifest's over the code's (host.ts). */
type Meta = { name: string; title: string; icon?: string; live?: boolean; input?: boolean; view?: string; tier?: PaletteTier };
type Record_ = { source: string; ref?: string; installed_at: number; commit_or_etag?: string };
type Ext = { name: string; manifest: Manifest; root: string; loaded: boolean; error?: string; palettes: Meta[]; warnings?: string[]; installed?: number; record?: Record_ };
/** `pal_core::extensions::Update`. */
type Update = { name: string; current: string; latest: string };
/** settings.rs `Checked`: when a check ran (unix ms) and what it said, the value or the failure's message. */
type Checked<T> = { at: number; value?: T; error?: string };
/** settings.rs `Checks`: the app's release check and the store's, as last run this process. */
type Checks = { app?: Checked<UpdateInfo>; extensions?: Checked<Update[]> };
/** settings.rs `BarItemView`. */
type RawBarView = { key: string; extension: string; id: string; title: string; description?: string; source: boolean; refresh_every?: number; rendered_at?: number; stale: boolean; state?: { title?: string; hidden: boolean; badge?: number; dot?: boolean; urgent: boolean } };
type View = { config: RawConfig; diagnostics: Diagnostic[]; path: string; changed?: number; version: string; extensions: Ext[]; store: string; hotkey: HotkeyStatus; permissions: PermissionsStatus; bar?: { supported: boolean; sketchybar: boolean; items: RawBarView[] }; checks: Checks };
/** settings.rs `About`: where the docs and the source live, and what the last run left behind (crash.rs). */
type About = { docs: string; repo: string; report?: CrashReport; panic?: PanicReport };

/** The store site, where every bundled extension has a page. */
const STORE = "https://pal.cagdas.io/extensions";

/** `palettes.<id>`: the extension's name when the palette is named like it, else `<extension>-<palette>` (index.rs `palette_id`). */
const paletteId = (ext: string, palette: string) => (ext === palette ? ext : `${ext}-${palette}`);

/** A dotted-key segment, quoted when TOML needs it. */
const seg = (s: string) => (/^[A-Za-z0-9_-]+$/.test(s) ? s : JSON.stringify(s));

const sameValue = (a: SettingValue, b: SettingValue) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isTier = (r: unknown): r is PaletteTier => r === "primary" || r === "normal" || r === "catalog";

function toExtension(e: Ext, config: RawConfig, userRoot: string, latest?: string): SettingsExtension {
  const m = e.manifest;
  const title = m.title ?? e.name;
  const codePalettes = new Map(e.palettes.map((p) => [p.name, p]));
  const names = [...new Set([...codePalettes.keys(), ...Object.keys(m.palettes ?? {})])];
  const palettes: SettingsPalette[] = names.map((name) => {
    const id = paletteId(e.name, name);
    const meta = codePalettes.get(name);
    const declared = m.palettes?.[name];
    const raw = config.palettes[id] ?? {};
    const kind = declared?.kind ?? (meta?.view ? "view" : meta?.input ? "input" : meta?.live ? "live" : meta ? "list" : undefined);
    return {
      id,
      title: meta?.title ?? declared?.title ?? name,
      description: declared?.description,
      icon: meta?.icon ? iconOf(meta.icon, meta.title) : undefined,
      kind,
      keys: declared?.keys,
      tier: isTier(meta?.tier) ? meta.tier : isTier(declared?.tier) ? declared.tier : undefined,
      settings: declared?.settings ?? [],
      config: { enabled: raw.enabled ?? true, alias: raw.alias, hotkey: raw.hotkey, icon: raw.icon, tier: isTier(raw.tier) ? raw.tier : undefined, itemHotkeys: raw.item_hotkeys, settings: (raw.settings ?? {}) as SettingValues },
    };
  });
  const bundled = e.root !== userRoot;
  return {
    name: e.name,
    title,
    description: m.description ?? "",
    tagline: m.store?.tagline,
    author: m.author,
    icon: m.icon ? iconOf(m.icon, title) : undefined,
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
    values: (config.extensions[e.name] ?? {}) as SettingValues,
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

function toBarItem(b: RawBarView, config: RawConfig, extensions: SettingsExtension[]): BarItem {
  const raw = config.bar?.items?.[b.key] ?? {};
  const ext = extensions.find((e) => e.name === b.extension);
  return {
    key: b.key,
    extension: b.extension,
    id: b.id,
    title: b.title,
    description: b.description,
    extTitle: ext?.title ?? b.extension,
    extIcon: ext?.icon,
    source: b.source,
    refreshEvery: b.refresh_every,
    renderedAt: b.rendered_at,
    stale: b.stale,
    state: b.state,
    config: { enabled: raw.enabled ?? true, target: raw.target, position: raw.position, hotkey: raw.hotkey, openOnHover: raw.open_on_hover, order: raw.order },
  };
}

/** When the newest of the two checks ran, unix ms; `undefined` while neither has. */
const checkedAt = (c: Checks): number | undefined => [c.app?.at, c.extensions?.at].filter((t): t is number => t !== undefined).sort((a, b) => b - a)[0];

/** Deep set/delete on the local copy, so the window moves before the file's reload confirms it. */
function patch(config: RawConfig, key: string[], value: unknown): RawConfig {
  const next = structuredClone(config) as unknown as Record<string, unknown>;
  let at = next;
  for (const k of key.slice(0, -1)) at = (at[k] ??= {}) as Record<string, unknown>;
  const last = key[key.length - 1];
  if (value === undefined) delete at[last];
  else at[last] = value;
  return next as unknown as RawConfig;
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
    `hotkey: ${!hk.wanted ? "off" : hk.registered ? `${hk.wanted} registered` : `${hk.wanted} failed: ${hk.error ?? "unknown"}`}`,
    `accessibility: ${perm(p.accessibility)}`,
    `calendar: ${p.calendar ?? "n/a"}`,
    `full disk access: ${perm(p.full_disk_access)}`,
    `input monitoring: ${perm(p.input_monitoring)}`,
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
  return settingsPages.some((x) => x.id === p) ? (p as SettingsPage) : "overview";
}

export default function Settings() {
  const [view, setView] = useState<View | null>(null);
  const [page, setPage] = useState<SettingsPage>(startPage);
  const [palette, setPalette] = useState<string | undefined>(undefined);
  const [ext, setExt] = useState<string | undefined>(undefined);
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
    // A root command opened the window on a page (settings.rs `open_page`).
    const e = listen<{ page: SettingsPage }>("pal://settings", (ev) => setPage(ev.payload.page));
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
  const latest = useMemo(() => Object.fromEntries((view?.checks.extensions?.value ?? []).map((u) => [u.name, u.latest.slice(0, 7)])), [view]);

  /** The user's store (`Store::locate`, under the data dir): the root whose extensions Update and Remove apply to. */
  const userRoot = view?.store ?? "";
  // By title: the registry's order is the host's load order, which means nothing to the reader.
  const extensions = useMemo(() => (view ? view.extensions.map((e) => toExtension(e, view.config, userRoot, latest[e.name])).sort((a, b) => a.title.localeCompare(b.title)) : []), [view, userRoot, latest]);
  const barItems = useMemo(() => (view?.bar ? view.bar.items.map((b) => toBarItem(b, view.config, extensions)) : []), [view, extensions]);
  const onInstall = async (spec: string) => { await invoke("extensions_install", { spec }); };
  // The core forgets the extension's pending update (settings.rs); the re-read lands it.
  const onExtUpdate = async (name: string) => { await invoke("extensions_update", { name }); refresh(); };
  const onExtRemove = async (name: string) => { await invoke("extensions_remove", { name }); refresh(); };
  // A selection that names nothing (first paint, or a removed extension) moves to the first entry.
  useEffect(() => {
    if (extensions.length === 0) return;
    if (!extensions.some((e) => e.palettes.some((p) => p.id === palette))) setPalette(extensions.flatMap((e) => e.palettes)[0]?.id);
    if (!extensions.some((e) => e.name === ext)) setExt(extensions[0].name);
  }, [extensions, palette, ext]);

  /** One key to the file; `undefined` removes it. The local copy moves at once; a refused write (the core's error, `Contended` after its retry included) shows in the title bar and the file's state comes back. */
  const write = useCallback((key: string[], value: unknown) => {
    setView((v) => (v ? { ...v, config: patch(v.config, key, value) } : v));
    const dotted = key.map(seg).join(".");
    const call = value === undefined ? invoke("settings_unset", { key: dotted }) : invoke("settings_set", { key: dotted, value });
    call.then(() => setError(null), (e) => { setError(String(e)); refresh(); });
  }, [refresh]);

  /** A declared setting: a value equal to its default (or none) leaves the file, anything else is written. */
  const writeDeclared = useCallback(async (key: string[], spec: SettingSpec | undefined, value: SettingValue) => {
    if (spec?.kind === "secret" && typeof value === "string" && value && !/^(keychain|env):/.test(value)) {
      // The value goes to the OS store; the file gets the reference.
      try {
        value = await invoke<string>("settings_set_secret", { key: `pal/${key.slice(1).join("-")}`, value });
      } catch (e) { setError(String(e)); return; }
    }
    const clear = value === undefined || value === "" || (spec && sameValue(value, spec.default));
    write(key, clear ? undefined : value);
  }, [write]);

  if (error && !view) return <div className="pal-settings" style={{ padding: 16 }}>{error}</div>;
  if (!view) return null;
  const { config } = view;

  const general: GeneralConfig = { hotkey: config.general.hotkey, theme: config.general.theme, launchAtLogin: config.general.launch_at_login, menuBarIcon: config.general.menu_bar_icon, position: config.general.position, askPermissionsOnStart: config.general.ask_permissions_on_start };
  const onGeneral = (next: GeneralConfig) => {
    if (next.hotkey !== general.hotkey) write(["general", "hotkey"], next.hotkey);
    if (next.theme !== general.theme) write(["general", "theme"], next.theme);
    if (next.launchAtLogin !== general.launchAtLogin) write(["general", "launch_at_login"], next.launchAtLogin);
    if (next.menuBarIcon !== general.menuBarIcon) write(["general", "menu_bar_icon"], next.menuBarIcon ? undefined : false);
    if (next.position !== general.position) write(["general", "position"], next.position);
    if (next.askPermissionsOnStart !== general.askPermissionsOnStart) write(["general", "ask_permissions_on_start"], next.askPermissionsOnStart ? undefined : false);
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
    for (const k of new Set([...Object.keys(next.settings), ...Object.keys(cur.settings)])) {
      if (!sameValue(next.settings[k], cur.settings[k])) writeDeclared(["palettes", id, "settings", k], p.settings.find((s) => s.id === k), next.settings[k]);
    }
  };

  const onExtension = (name: string, values: SettingValues) => {
    const e = extensions.find((x) => x.name === name);
    if (!e) return;
    for (const k of new Set([...Object.keys(values), ...Object.keys(e.values)])) {
      if (!sameValue(values[k], e.values[k])) writeDeclared(["extensions", name, k], e.settings.find((s) => s.id === k), values[k]);
    }
  };

  const rawBar = config.bar ?? { target: "auto" as const, hover_delay: 250, hover_grace: 400, menubar: { open_on_hover: false }, sketchybar: { open_on_hover: true, position: "right" }, items: {} };
  const bar: BarConfig = { target: rawBar.target, hoverDelay: rawBar.hover_delay, hoverGrace: rawBar.hover_grace, menubarHover: rawBar.menubar.open_on_hover, sketchybarHover: rawBar.sketchybar.open_on_hover, sketchybarPosition: rawBar.sketchybar.position };
  const onBar = (next: BarConfig) => {
    if (next.target !== bar.target) write(["bar", "target"], next.target === "auto" ? undefined : next.target);
    if (next.hoverDelay !== bar.hoverDelay) write(["bar", "hover_delay"], next.hoverDelay === 250 ? undefined : next.hoverDelay);
    if (next.hoverGrace !== bar.hoverGrace) write(["bar", "hover_grace"], next.hoverGrace === 400 ? undefined : next.hoverGrace);
    if (next.menubarHover !== bar.menubarHover) write(["bar", "menubar", "open_on_hover"], next.menubarHover ? true : undefined);
    if (next.sketchybarHover !== bar.sketchybarHover) write(["bar", "sketchybar", "open_on_hover"], next.sketchybarHover ? undefined : false);
    if (next.sketchybarPosition !== bar.sketchybarPosition) write(["bar", "sketchybar", "position"], next.sketchybarPosition === "right" ? undefined : next.sketchybarPosition);
  };
  const onBarItem = (key: string, next: BarItemConfig) => {
    const cur = barItems.find((b) => b.key === key)?.config;
    if (!cur) return;
    if (next.enabled !== cur.enabled) write(["bar", "items", key, "enabled"], next.enabled ? undefined : false);
    if (next.target !== cur.target) write(["bar", "items", key, "target"], next.target);
    if ((next.position ?? "") !== (cur.position ?? "")) write(["bar", "items", key, "position"], next.position?.trim() || undefined);
    if ((next.hotkey ?? "") !== (cur.hotkey ?? "")) write(["bar", "items", key, "hotkey"], next.hotkey || undefined);
    if (next.openOnHover !== cur.openOnHover) write(["bar", "items", key, "open_on_hover"], next.openOnHover);
    if (next.order !== cur.order) write(["bar", "items", key, "order"], next.order);
  };

  /** A page, and a row on it lit once it is up: the Overview's actions and the cross-page links. */
  const go = (p: SettingsPage, anchor?: string) => {
    setPage(p);
    if (anchor?.startsWith("palettes:")) { const id = anchor.split(":")[1]; if (id !== "ext" && extensions.some((e) => e.palettes.some((x) => x.id === id))) setPalette(id); }
    if (anchor?.startsWith("extensions:")) { const name = anchor.split(":")[1]; if (extensions.some((e) => e.name === name)) setExt(name); }
    if (anchor) requestAnimationFrame(() => { if (!flashAnchor(anchor)) setTimeout(() => flashAnchor(anchor), 120); });
  };
  const requestPermission = (which: PermissionId) => invoke("permissions_request", { which }).then(refresh, fail);
  const openKeyboardShortcuts = () => invoke("open_system_settings", { pane: "keyboard-shortcuts" }).catch(fail);

  const barSupported = view.bar?.supported ?? isMac;
  const index: SettingsIndexEntry[] = [...overviewIndex, ...generalIndex, ...palettesIndex(extensions), ...extensionsIndex(extensions), ...barIndex(barItems, barSupported), ...aboutIndex];
  /** A search hit selects what it names before the page lights its row. */
  const onJump = (entry: SettingsIndexEntry) => go(entry.page, entry.anchor);
  const aside = error ? <span role="alert" title={error} data-error>{error}</span> : undefined;
  const fileName = view.path.split("/").pop() ?? "config.toml";
  // Off macOS every permission is a given (permissions.rs), so the rows have nothing to say.
  const permissions = isMac ? view.permissions : undefined;
  const attention = overviewItems({ version: view.version, hotkey: view.hotkey, permissions, extensions, bar: barItems, barSupported, diagnostics: view.diagnostics, update }).length;

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
          checks={{ enabled: config.general.check_updates, checkedAt: checkedAt(view.checks), error: view.checks.app?.error ?? view.checks.extensions?.error, status: view.checks.app?.value?.status, busy: checking }}
          onCheckUpdates={() => check(true)}
          onGo={go}
          onRequestPermission={requestPermission}
          onOpenKeyboardShortcuts={openKeyboardShortcuts}
          onUpdateExtension={(name) => onExtUpdate(name).catch(fail)}
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
          hotkey={view.hotkey}
          onOpenKeyboardShortcuts={openKeyboardShortcuts}
          permissions={permissions}
          onRequestPermission={requestPermission}
          onOpenOverview={() => go("overview", "overview:attention")}
        />
      )}
      {page === "palettes" && <SettingsPalettes extensions={extensions} selected={palette} onSelect={setPalette} onChange={onPalette} onOpenExtension={(name) => go("extensions", `extensions:${name}`)} />}
      {page === "extensions" && <SettingsExtensions extensions={extensions} selected={ext} onSelect={setExt} onChange={onExtension} onInstall={onInstall} onUpdate={onExtUpdate} onRemove={onExtRemove} onOpenLink={openLink} onOpenPalette={(id) => go("palettes", `palettes:${id}`)} />}
      {page === "bar" && <SettingsBar config={bar} onChange={onBar} items={barItems} onItem={onBarItem} sketchybar={view.bar?.sketchybar ?? false} supported={barSupported} onOpenExtension={(name) => go("extensions", `extensions:${name}`)} />}
      {page === "about" && (
        <SettingsAbout
          version={view.version}
          file={view.path}
          links={about}
          onCheckUpdates={() => invoke<UpdateInfo>("check_updates").then((u) => { refresh(); return u; })}
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
