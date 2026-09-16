/**
 * The settings window: `settings_get` in, `settings_set`/`settings_unset`
 * out, re-read on every `pal://config` (the core's reload event, so a hand
 * edit shows up as it is saved) and on `pal://host` (an extension loaded or
 * failed). The design components (ui/Settings*.tsx) know nothing of Tauri;
 * this file maps the core's shapes onto theirs and turns their onChange
 * calls into key writes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  SettingsExtensions, SettingsGeneral, SettingsPalettes, SettingsWindow,
  extensionsIndex, generalIndex, palettesIndex,
  type Diagnostic, type GeneralConfig, type PaletteConfig, type SettingSpec, type SettingValue, type SettingValues,
  type SettingsExtension, type SettingsIndexEntry, type SettingsPage, type SettingsPalette,
} from "./ui";
import { iconOf } from "./items";

// ---- what the core sends (settings.rs `View`, pal_core::config::Config) ----

type RawPalette = { enabled?: boolean; alias?: string; hotkey?: string; icon?: string; settings?: Record<string, unknown> };
type RawConfig = {
  general: { hotkey: string; theme: GeneralConfig["theme"]; launch_at_login: boolean; position: GeneralConfig["position"] };
  palettes: Record<string, RawPalette>;
  extensions: Record<string, Record<string, unknown>>;
};
type ManifestPalette = { title?: string; description?: string; settings?: SettingSpec[] };
type Manifest = { name: string; title?: string; description?: string; version?: string; icon?: string; author?: string; repo?: string; settings?: SettingSpec[]; palettes?: Record<string, ManifestPalette> };
/** `PaletteMeta` (index.rs): what the code said about a palette. */
type Meta = { name: string; title: string; icon?: string };
type Ext = { name: string; manifest: Manifest; root: string; loaded: boolean; error?: string; palettes: Meta[]; installed?: number };
type View = { config: RawConfig; diagnostics: Diagnostic[]; path: string; changed?: number; version: string; extensions: Ext[] };

/** `palettes.<id>`: the extension's name when the palette is named like it, else `<extension>-<palette>` (index.rs `palette_id`). */
const paletteId = (ext: string, palette: string) => (ext === palette ? ext : `${ext}-${palette}`);

/** A dotted-key segment, quoted when TOML needs it. */
const seg = (s: string) => (/^[A-Za-z0-9_-]+$/.test(s) ? s : JSON.stringify(s));

const sameValue = (a: SettingValue, b: SettingValue) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function toExtension(e: Ext, config: RawConfig): SettingsExtension {
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
    repo: m.repo ?? "bundled",
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

export default function Settings() {
  const [view, setView] = useState<View | null>(null);
  const [page, setPage] = useState<SettingsPage>("general");
  const [palette, setPalette] = useState<string | undefined>(undefined);
  const [ext, setExt] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => invoke<View>("settings_get").then(setView).catch((e) => setError(String(e))), []);
  useEffect(() => {
    refresh();
    const a = listen("pal://config", refresh);
    const b = listen<{ method?: string }>("pal://host", (e) => { if (e.payload.method?.startsWith("extension/") || e.payload.method === "host/ready") refresh(); });
    return () => { a.then((f) => f()); b.then((f) => f()); };
  }, [refresh]);

  // Escape or cmd+w closes (hides) the window; the design's inner scopes stop what they handle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (e.metaKey && e.key.toLowerCase() === "w")) { e.preventDefault(); invoke("settings_close"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const extensions = useMemo(() => (view ? view.extensions.map((e) => toExtension(e, view.config)) : []), [view]);
  useEffect(() => {
    if (!palette && extensions[0]?.palettes[0]) setPalette(extensions[0].palettes[0].id);
    if (!ext && extensions[0]) setExt(extensions[0].name);
  }, [extensions, palette, ext]);

  /** One key to the file; `undefined` removes it. The local copy moves at once. */
  const write = useCallback((key: string[], value: unknown) => {
    setView((v) => (v ? { ...v, config: patch(v.config, key, value) } : v));
    const dotted = key.map(seg).join(".");
    const call = value === undefined ? invoke("settings_unset", { key: dotted }) : invoke("settings_set", { key: dotted, value });
    call.catch((e) => { setError(`${dotted}: ${e}`); refresh(); });
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

  const general: GeneralConfig = { hotkey: config.general.hotkey, theme: config.general.theme, launchAtLogin: config.general.launch_at_login, position: config.general.position };
  const onGeneral = (next: GeneralConfig) => {
    if (next.hotkey !== general.hotkey) write(["general", "hotkey"], next.hotkey);
    if (next.theme !== general.theme) write(["general", "theme"], next.theme);
    if (next.launchAtLogin !== general.launchAtLogin) write(["general", "launch_at_login"], next.launchAtLogin);
    if (next.position !== general.position) write(["general", "position"], next.position);
  };

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
  const aside = page === "palettes" ? `${count} palettes from ${extensions.length} extensions` : page === "extensions" ? `${extensions.length} installed` : error ? <span title={error}>Last write failed</span> : undefined;
  const fileName = view.path.split("/").pop() ?? "config.toml";

  return (
    <SettingsWindow page={page} onPage={setPage} aside={aside} index={index} onJump={onJump} diagnostics={view.diagnostics} file={fileName} onOpenDiagnostic={() => invoke("settings_open_file")} version={view.version}>
      {page === "general" && (
        <SettingsGeneral
          value={general}
          onChange={onGeneral}
          file={{ path: view.path, changed: view.changed }}
          onOpenFile={() => invoke("settings_open_file").catch((e) => setError(String(e)))}
          onRevealFile={() => invoke("settings_reveal_file").catch((e) => setError(String(e)))}
          onResetFrecency={() => invoke("settings_reset_frecency").catch((e) => setError(String(e)))}
          onRestartHost={() => invoke("settings_restart_host").catch((e) => setError(String(e)))}
        />
      )}
      {page === "palettes" && <SettingsPalettes extensions={extensions} selected={palette} onSelect={setPalette} onChange={onPalette} />}
      {page === "extensions" && <SettingsExtensions extensions={extensions} selected={ext} onSelect={setExt} onChange={onExtension} />}
    </SettingsWindow>
  );
}
