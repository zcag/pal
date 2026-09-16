/**
 * The settings window: `settings_get` in, `settings_set`/`settings_unset`
 * out, re-read on every `pal://config` (the core's reload event, so a hand
 * edit shows up as it is saved) and on `pal://host` (an extension loaded or
 * failed). The design components (ui/Settings*.tsx) know nothing of Tauri;
 * this file maps the core's shapes onto theirs and turns their onChange
 * calls into key writes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  SettingsExtensions, SettingsGeneral, SettingsPalettes, SettingsWindow,
  extensionsIndex, generalIndex, palettesIndex,
  type Diagnostic, type GeneralConfig, type HotkeyStatus, type PaletteConfig, type PermissionsStatus, type SettingSpec, type SettingValue, type SettingValues,
  type SettingsExtension, type SettingsIndexEntry, type SettingsPage, type SettingsPalette,
} from "./ui";
import { comboOf, isMac } from "./ui/keys";
import { iconOf } from "./items";

// ---- what the core sends (settings.rs `View`, pal_core::config::Config) ----

type RawPalette = { enabled?: boolean; alias?: string; hotkey?: string; icon?: string; settings?: Record<string, unknown> };
type RawConfig = {
  general: { hotkey: string; theme: GeneralConfig["theme"]; launch_at_login: boolean; menu_bar_icon: boolean; position: GeneralConfig["position"]; ask_permissions_on_start: boolean };
  palettes: Record<string, RawPalette>;
  extensions: Record<string, Record<string, unknown>>;
};
type ManifestPalette = { title?: string; description?: string; settings?: SettingSpec[] };
type Manifest = { name: string; title?: string; description?: string; version?: string; icon?: string; author?: string; repo?: string; settings?: SettingSpec[]; palettes?: Record<string, ManifestPalette> };
/** `PaletteMeta` (index.rs): what the code said about a palette. */
type Meta = { name: string; title: string; icon?: string };
type Record_ = { source: string; ref?: string; installed_at: number; commit_or_etag?: string };
type Ext = { name: string; manifest: Manifest; root: string; loaded: boolean; error?: string; palettes: Meta[]; installed?: number; record?: Record_ };
/** `pal_core::extensions::Update`. */
type Update = { name: string; current: string; latest: string };
type View = { config: RawConfig; diagnostics: Diagnostic[]; path: string; changed?: number; version: string; extensions: Ext[]; store: string; hotkey: HotkeyStatus; permissions: PermissionsStatus };

/** `palettes.<id>`: the extension's name when the palette is named like it, else `<extension>-<palette>` (index.rs `palette_id`). */
const paletteId = (ext: string, palette: string) => (ext === palette ? ext : `${ext}-${palette}`);

/** A dotted-key segment, quoted when TOML needs it. */
const seg = (s: string) => (/^[A-Za-z0-9_-]+$/.test(s) ? s : JSON.stringify(s));

const sameValue = (a: SettingValue, b: SettingValue) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

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
    return {
      id,
      title: meta?.title ?? declared?.title ?? name,
      description: declared?.description,
      icon: meta?.icon ? iconOf(meta.icon, meta.title) : undefined,
      settings: declared?.settings ?? [],
      config: { enabled: raw.enabled ?? true, alias: raw.alias, hotkey: raw.hotkey, icon: raw.icon, settings: (raw.settings ?? {}) as SettingValues },
    };
  });
  return {
    name: e.name,
    title,
    description: m.description ?? "",
    icon: m.icon ? iconOf(m.icon, title) : undefined,
    version: m.version ?? "",
    latest,
    // "bundled" here means "not the store's": Update and Remove only apply there. An
    // extension from `general.extension_dirs` gets the same treatment (and the
    // "Ships with pal" label, which the page cannot yet tell apart).
    repo: m.repo ?? (e.root === userRoot ? "" : "bundled"),
    bundled: e.root !== userRoot,
    source: e.record?.source,
    installed: e.installed,
    palettes,
    settings: m.settings ?? [],
    values: (config.extensions[e.name] ?? {}) as SettingValues,
    loaded: e.loaded,
    error: e.error,
  };
}

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

export default function Settings() {
  const [view, setView] = useState<View | null>(null);
  const [page, setPage] = useState<SettingsPage>("general");
  const [palette, setPalette] = useState<string | undefined>(undefined);
  const [ext, setExt] = useState<string | undefined>(undefined);
  /** The last failed command, shown in the title bar until a write succeeds. */
  const [error, setError] = useState<string | null>(null);

  // Re-reads are coalesced (ten extensions load in a burst at startup) and
  // held while a text field has focus: the field keeps what is being typed,
  // and the read runs when focus leaves.
  const held = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (typing()) { held.current = true; return; }
      held.current = false;
      invoke<View>("settings_get").then(setView).catch((e) => setError(String(e)));
    }, 50);
  }, []);
  useEffect(() => {
    refresh();
    const a = listen("pal://config", refresh);
    const b = listen<{ method?: string }>("pal://host", (e) => { if (e.payload.method?.startsWith("extension/") || e.payload.method === "host/ready") refresh(); });
    // The hotkey's registration outcome and a permission grant land in the view too (settings.rs `View`).
    const c = listen("pal://hotkey", refresh);
    const d = listen("pal://permissions", refresh);
    const onBlur = () => { if (held.current) refresh(); };
    window.addEventListener("focusout", onBlur);
    return () => { for (const u of [a, b, c, d]) u.then((f) => f()); window.removeEventListener("focusout", onBlur); clearTimeout(timer.current); };
  }, [refresh]);

  // Escape or cmd+w (ctrl+w off macOS, keys.ts's mapping) closes (hides) the window; the design's inner scopes stop what they handle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || comboOf(e) === "cmd+w") { e.preventDefault(); invoke("settings_close"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // `latest` per extension, from one `extensions_check_updates` the first
  // time the Extensions page opens (network, unauthenticated GitHub API);
  // cleared for an extension once it is updated or removed.
  const [updates, setUpdates] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (page !== "extensions" || updates !== null) return;
    setUpdates({});
    invoke<Update[]>("extensions_check_updates")
      .then((u) => setUpdates(Object.fromEntries(u.map((x) => [x.name, x.latest.slice(0, 7)]))))
      .catch((e) => setError(String(e)));
  }, [page, updates]);
  const forget = (name: string) => setUpdates((u) => (u && name in u ? Object.fromEntries(Object.entries(u).filter(([k]) => k !== name)) : u));

  /** The user's store (`Store::locate`, under the data dir): the root whose extensions Update and Remove apply to. */
  const userRoot = view?.store ?? "";
  const extensions = useMemo(() => (view ? view.extensions.map((e) => toExtension(e, view.config, userRoot, updates?.[e.name])) : []), [view, userRoot, updates]);
  const onInstall = async (spec: string) => { await invoke("extensions_install", { spec }); };
  const onExtUpdate = async (name: string) => { await invoke("extensions_update", { name }); forget(name); };
  const onExtRemove = async (name: string) => { await invoke("extensions_remove", { name }); forget(name); };
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
    for (const k of ["alias", "hotkey", "icon"] as const) {
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

  const index: SettingsIndexEntry[] = [...generalIndex, ...palettesIndex(extensions), ...extensionsIndex(extensions)];
  /** A search hit selects what it names (the index entries carry no ids, only the titles `palettesIndex`/`extensionsIndex` built them from). */
  const onJump = (entry: SettingsIndexEntry) => {
    if (entry.page === "palettes") {
      for (const e of extensions) {
        const hit = e.palettes.find((p) => (p.title === entry.label && entry.hint === `${e.title} palette`) || (entry.hint === `${p.title} (${e.title})` && p.settings.some((s) => s.label === entry.label)));
        if (hit) return setPalette(hit.id);
      }
    } else if (entry.page === "extensions") {
      const hit = extensions.find((e) => e.title === entry.label || (entry.hint === e.title && e.settings.some((s) => s.label === entry.label)));
      if (hit) setExt(hit.name);
    }
  };
  const count = extensions.reduce((n, e) => n + e.palettes.length, 0);
  const summary = page === "palettes" ? `${count} palettes from ${extensions.length} extensions` : page === "extensions" ? `${extensions.length} installed` : undefined;
  const aside = error ? <span role="alert" title={error} style={{ color: "var(--pal-tag-red)" }}>{error}</span> : summary;
  const fileName = view.path.split("/").pop() ?? "config.toml";

  return (
    <SettingsWindow page={page} onPage={setPage} aside={aside} index={index} onJump={onJump} diagnostics={view.diagnostics} file={fileName} onOpenDiagnostic={() => invoke("settings_open_file").catch((e) => setError(String(e)))} version={view.version}>
      {page === "general" && (
        <SettingsGeneral
          value={general}
          onChange={onGeneral}
          file={{ path: view.path, changed: view.changed }}
          onOpenFile={() => invoke("settings_open_file").catch((e) => setError(String(e)))}
          onRevealFile={() => invoke("settings_reveal_file").catch((e) => setError(String(e)))}
          onResetFrecency={() => invoke("settings_reset_frecency").catch(fail)}
          onRestartHost={() => invoke("settings_restart_host").catch(fail)}
          hotkey={view.hotkey}
          onOpenKeyboardShortcuts={() => invoke("open_system_settings", { pane: "keyboard-shortcuts" }).catch(fail)}
          // Off macOS every permission is a given (permissions.rs), so the group has nothing to say.
          permissions={isMac ? view.permissions : undefined}
          onRequestPermission={(which) => invoke("permissions_request", { which }).then(refresh, fail)}
        />
      )}
      {page === "palettes" && <SettingsPalettes extensions={extensions} selected={palette} onSelect={setPalette} onChange={onPalette} />}
      {page === "extensions" && <SettingsExtensions extensions={extensions} selected={ext} onSelect={setExt} onChange={onExtension} onInstall={onInstall} onUpdate={onExtUpdate} onRemove={onExtRemove} />}
    </SettingsWindow>
  );
}
