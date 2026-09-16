import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { isMac } from "./keys";
import { comboLabel } from "./SettingsGeneral";
import type { UpdateInfo } from "./SettingsAbout";
import { needsSetup, permissionRows, type BarItem, type Diagnostic, type HotkeyStatus, type PermissionId, type PermissionsStatus, type SettingsExtension, type SettingsIndexEntry, type SettingsPage } from "./SettingsTypes";
import type { Icon as IconSpec } from "./types";

/** What the Overview reads; all of it comes from `settings_get` and the update checks. */
export type OverviewInput = {
  version: string;
  hotkey?: HotkeyStatus;
  permissions?: PermissionsStatus;
  extensions: SettingsExtension[];
  bar?: BarItem[];
  diagnostics?: Diagnostic[];
  /** The last app update check; `undefined` while none ran. */
  update?: UpdateInfo;
};

/** One thing to do, or one fact, as a row with its action inline. */
export type OverviewItem = {
  id: string;
  /** `attention`: needs doing; `ok`: a fact worth a glance. */
  level: "attention" | "ok";
  icon?: IconSpec;
  title: string;
  /** What is wrong and what fixes it, one line. */
  detail: string;
  /** The inline action. */
  action?: { label: string; go?: { page: SettingsPage; anchor?: string }; permission?: PermissionId; keyboardShortcuts?: boolean; updateExtension?: string };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The attention list, in the order the user should take it: the hotkey
 * (pal is unreachable without it), permissions (features silently do
 * nothing), extensions that failed to load, extensions with nothing to
 * work with, manifest warnings, config file problems, updates. Pure, so
 * the page and its tests share it.
 */
export function overviewItems(v: OverviewInput): OverviewItem[] {
  const items: OverviewItem[] = [];
  const h = v.hotkey;
  if (h && !h.registered) {
    const combo = h.wanted ? comboLabel(h.wanted) : "";
    const spotlight = h.spotlight ?? (isMac && /spotlight/i.test(h.error ?? "") ? h.wanted : undefined);
    if (spotlight) {
      items.push({ id: "hotkey", level: "attention", title: "Hotkey", detail: `${combo} is Spotlight's. Untick Show Spotlight search under Keyboard Shortcuts > Spotlight, then pal takes it.`, action: { label: "Open Keyboard Shortcuts", keyboardShortcuts: true } });
    } else if (/already registered|in use/i.test(h.error ?? "")) {
      items.push({ id: "hotkey", level: "attention", title: "Hotkey", detail: `${combo} is held by another app (Raycast, if it is running: its hotkey is under Raycast Settings > General). Change one of them.`, action: { label: "Change", go: { page: "general", anchor: "general:hotkey" } } });
    } else {
      items.push({ id: "hotkey", level: "attention", title: "Hotkey", detail: `${combo || "The hotkey"} did not register${h.error ? `: ${h.error}` : ""}.`, action: { label: "Change", go: { page: "general", anchor: "general:hotkey" } } });
    }
  } else if (h && !h.wanted) {
    items.push({ id: "hotkey", level: "ok", title: "Hotkey", detail: "None set; pal toggle from a compositor keybind opens the panel.", action: { label: "Set one", go: { page: "general", anchor: "general:hotkey" } } });
  }

  const names = new Set(v.extensions.map((e) => e.name));
  for (const p of permissionRows(v.permissions, { otp: names.has("otp"), calendar: names.has("calendar"), bar: (v.bar?.length ?? 0) > 0 })) {
    if (p.state !== "missing") continue;
    // A permission only an absent extension needs is not something to do.
    if (p.id === "full_disk_access" && !names.has("otp")) continue;
    if (p.id === "calendar" && !names.has("calendar")) continue;
    if (p.id === "input_monitoring" && !(v.bar?.length ?? 0)) continue;
    items.push({ id: `permission:${p.id}`, level: "attention", title: p.title, detail: `${p.needs}. ${p.where.startsWith("Privacy") ? `Switch it on under ${p.where}` : `Granted in ${p.where}`}.`, action: { label: p.id === "full_disk_access" ? "Open the pane" : "Grant…", permission: p.id } });
  }

  for (const e of v.extensions) {
    if (e.loaded === false && e.error) {
      items.push({ id: `failed:${e.name}`, level: "attention", icon: e.icon, title: `${e.title} failed to load`, detail: e.error, action: { label: "Open", go: { page: "extensions", anchor: `extensions:${e.name}` } } });
    }
  }
  for (const e of v.extensions) {
    if (e.loaded === false) continue;
    const missing = needsSetup(e);
    if (missing.length) {
      items.push({ id: `setup:${e.name}`, level: "attention", icon: e.icon, title: `${e.title} needs ${missing.map((s) => s.label.toLowerCase()).join(" and ")}`, detail: missing[0].description ?? `Its palettes list nothing until ${missing.map((s) => s.label.toLowerCase()).join(" and ")} ${missing.length === 1 ? "is" : "are"} set.`, action: { label: "Set up", go: { page: "extensions", anchor: `extensions:${e.name}:${missing[0].id}` } } });
    }
  }
  for (const e of v.extensions) {
    for (const w of e.warnings ?? []) {
      items.push({ id: `warning:${e.name}:${w}`, level: "attention", icon: e.icon, title: `${e.title}: manifest warning`, detail: w, action: { label: "Open", go: { page: "extensions", anchor: `extensions:${e.name}` } } });
    }
  }
  for (const d of v.diagnostics ?? []) {
    items.push({ id: `config:${d.path}:${d.line ?? ""}`, level: "attention", title: d.level === "error" ? "Config file did not parse" : `Config file: ${d.message}`, detail: d.level === "error" ? `${d.message}${d.line ? ` at line ${d.line}` : ""}. pal keeps the last settings that parsed.` : `${d.path}${d.line ? ` (line ${d.line})` : ""} is ignored.`, action: { label: "Open file", go: { page: "general", anchor: "general:file" } } });
  }
  for (const b of v.bar ?? []) {
    if (b.config.enabled && b.stale) {
      items.push({ id: `stale:${b.key}`, level: "attention", icon: b.extIcon, title: `${b.extTitle} › ${b.title} is stale`, detail: "Its last render failed or timed out; the strip shows the previous state, muted.", action: { label: "Open", go: { page: "bar", anchor: `bar:${b.key}` } } });
    }
  }

  if (v.update?.available) {
    items.push({ id: "update", level: "attention", title: `pal ${v.update.version} is available`, detail: `You have ${v.version}. Download and install are not wired yet; get it from the releases page.`, action: { label: "About", go: { page: "about", anchor: "about:updates" } } });
  }
  for (const e of v.extensions) {
    if (e.latest) items.push({ id: `update:${e.name}`, level: "attention", icon: e.icon, title: `${e.title} ${e.latest} is available`, detail: `Installed: ${e.version || "unversioned"}.`, action: { label: "Update", updateExtension: e.name } });
  }
  return items;
}

/** The facts under the attention list: what is installed and reachable. */
export function overviewFacts(v: OverviewInput): { label: string; value: ReactNode; go: { page: SettingsPage; anchor?: string } }[] {
  const loaded = v.extensions.filter((e) => e.loaded !== false);
  const palettes = v.extensions.flatMap((e) => e.palettes);
  const on = palettes.filter((p) => p.config.enabled).length;
  const withHotkey = palettes.filter((p) => p.config.hotkey).length;
  const barOn = (v.bar ?? []).filter((b) => b.config.enabled && b.source).length;
  return [
    { label: "Hotkey", value: v.hotkey?.wanted ? <Kbd shortcut={v.hotkey.wanted} /> : "none", go: { page: "general", anchor: "general:hotkey" } },
    { label: "Extensions", value: `${plural(loaded.length, "extension")} loaded${loaded.length !== v.extensions.length ? `, ${v.extensions.length - loaded.length} failed` : ""}`, go: { page: "extensions" } },
    { label: "Palettes", value: `${on} of ${palettes.length} on${withHotkey ? `, ${withHotkey} with a hotkey` : ""}`, go: { page: "palettes" } },
    { label: "Bar", value: v.bar?.length ? `${barOn} of ${plural(v.bar.length, "item")} on` : "no items declared", go: { page: "bar" } },
  ];
}

export const overviewIndex: SettingsIndexEntry[] = [
  { page: "overview", label: "What needs attention", hint: "Overview", anchor: "overview:attention", keywords: "status health problems" },
];

export type SettingsOverviewProps = OverviewInput & {
  onGo: (page: SettingsPage, anchor?: string) => void;
  onRequestPermission?: (which: PermissionId) => void;
  onOpenKeyboardShortcuts?: () => void;
  onUpdateExtension?: (name: string) => void;
};

/**
 * The state of pal at a glance: what needs doing, each row with its fix
 * inline, and under it the facts (hotkey, what is loaded, what is on).
 * Nothing to do reads "Everything is set" with the version.
 */
export function SettingsOverview({ onGo, onRequestPermission, onOpenKeyboardShortcuts, onUpdateExtension, ...v }: SettingsOverviewProps) {
  const items = overviewItems(v);
  const facts = overviewFacts(v);
  const act = (a: NonNullable<OverviewItem["action"]>) => {
    if (a.go) onGo(a.go.page, a.go.anchor);
    else if (a.permission) onRequestPermission?.(a.permission);
    else if (a.keyboardShortcuts) onOpenKeyboardShortcuts?.();
    else if (a.updateExtension) onUpdateExtension?.(a.updateExtension);
  };
  return (
    <div className="pal-settings-page pal-overview">
      <header className="pal-overview__lead" data-state={items.length ? "attention" : "ok"} data-anchor="overview:attention">
        <span className="pal-overview__mark" aria-hidden>
          {items.length ? <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" /><path d="M10 6v5" /><circle cx="10" cy="14" r="0.6" fill="currentColor" /></svg> : <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" /><path d="M6.5 10.5l2.4 2.4 4.8-5.3" /></svg>}
        </span>
        <div className="pal-overview__lead-text">
          <h2 className="pal-overview__title">{items.length ? `${plural(items.length, "thing")} to look at` : "Everything is set"}</h2>
          <p className="pal-overview__sub">{items.length ? "Each row has its fix. They clear as you go." : `pal ${v.version} is reachable and every extension loaded.`}</p>
        </div>
        {!items.length && <span className="pal-overview__version">{v.version}</span>}
      </header>

      {items.length > 0 && (
        <ul className="pal-overview__list" aria-label="Needs attention">
          {items.map((it) => (
            <li key={it.id} className="pal-overview__item" data-level={it.level} data-anchor={`overview:${it.id}`}>
              <span className="pal-overview__icon">{it.icon ? <Icon icon={it.icon} /> : <span className="pal-overview__dot" aria-hidden />}</span>
              <span className="pal-overview__text">
                <span className="pal-overview__item-title">{it.title}</span>
                <span className="pal-overview__item-detail">{it.detail}</span>
              </span>
              {it.action && <button type="button" className="pal-button" data-small data-primary={it.action.permission || it.action.updateExtension || it.action.keyboardShortcuts ? "" : undefined} onClick={() => act(it.action!)}>{it.action.label}</button>}
            </li>
          ))}
        </ul>
      )}

      <dl className="pal-overview__facts" aria-label="At a glance">
        {facts.map((f) => (
          <div key={f.label} className="pal-overview__fact" role="button" tabIndex={0} onClick={() => onGo(f.go.page, f.go.anchor)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onGo(f.go.page, f.go.anchor); } }}>
            <dt className="pal-overview__fact-label">{f.label}</dt>
            <dd className="pal-overview__fact-value">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
