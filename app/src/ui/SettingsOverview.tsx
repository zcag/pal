import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { Kbd } from "./Kbd";
import { isMac } from "./keys";
import { comboLabel, combosLabel } from "./SettingsGeneral";
import { installing, progressLine, type UpdateInfo, type UpdateProgress } from "./SettingsAbout";
import { holdOf, needsSetup, permissionRows, type BarItem, type Diagnostic, type HotkeyStatus, type PermissionId, type PermissionUser, type PermissionsStatus, type SettingsExtension, type SettingsIndexEntry, type SettingsPage } from "./SettingsTypes";
import { relativeDate } from "./format";
import type { Icon as IconSpec } from "./types";

/**
 * The update checks as the Overview reports them: whether they run by
 * themselves (`general.check_updates`), when the newest last ran, what a
 * failed one said, and what the app's answered when there was no release
 * to compare against. None of it is an issue: a failure is a fact next to
 * the time, and with the setting off nothing has run that could fail.
 */
export type OverviewChecks = {
  enabled: boolean;
  /** Unix ms; `undefined` while no check ran this process. */
  checkedAt?: number;
  error?: string;
  /** `UpdateInfo.status`: "no release published yet" and the like. */
  status?: string;
  /** A check is running now. */
  busy?: boolean;
};

/** What the Overview reads; all of it comes from `settings_get` and the update checks. */
export type OverviewInput = {
  version: string;
  hotkey?: HotkeyStatus;
  permissions?: PermissionsStatus;
  extensions: SettingsExtension[];
  bar?: BarItem[];
  /** This platform draws bar items (macOS); `false` keeps every bar row off the page. */
  barSupported?: boolean;
  diagnostics?: Diagnostic[];
  /** The last app update check; `undefined` while none ran. */
  update?: UpdateInfo;
  /** An install under way (`pal://update`), for the update row's text. */
  progress?: UpdateProgress;
  checks?: OverviewChecks;
  /** The Windows palette's switcher chord as it applies (`holdOf`); `""` is off, absent means no Windows palette and no fact. */
  switcher?: string;
  /** `[sidebar]` in one line (`sidebarSummary`): "Windows on the right edge", or "off"; absent where none is built. */
  sidebar?: string;
  /** Who uses each permission and what for: the extensions that declare it, the features that are on (`permissionUsers`). A missing permission is a row only when something uses it. */
  users?: Partial<Record<PermissionId, PermissionUser[]>>;
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
  action?: { label: string; go?: { page: SettingsPage; anchor?: string }; permission?: PermissionId; keyboardShortcuts?: boolean; updateExtension?: string; installUpdate?: boolean; disabled?: boolean };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The attention list, in the order the user should take it: the hotkeys
 * (pal is unreachable without one; a row per entry that failed, naming
 * it, since the others may well work), permissions (features silently do
 * nothing), extensions that failed to load, extensions with nothing to
 * work with, manifest warnings, config file problems, updates. Pure, so
 * the page and its tests share it.
 */
export function overviewItems(v: OverviewInput): OverviewItem[] {
  const items: OverviewItem[] = [];
  const h = v.hotkey;
  if (h && !h.hotkeys.length) {
    items.push({ id: "hotkey", level: "ok", title: "Hotkey", detail: "None set; pal toggle from a compositor keybind opens the panel.", action: { label: "Set one", go: { page: "shortcuts", anchor: "shortcuts:hotkey" } } });
  }
  for (const [i, r] of (h?.hotkeys ?? []).entries()) {
    if (r.registered) continue;
    const id = i ? `hotkey:${i + 1}` : "hotkey";
    const anchor = i ? `shortcuts:hotkey:${i + 1}` : "shortcuts:hotkey";
    const combo = comboLabel(r.wanted);
    const others = h!.hotkeys.filter((o) => o !== r && o.registered).map((o) => comboLabel(o.wanted));
    const still = others.length ? ` ${others.join(", ")} still opens pal.` : "";
    const spotlight = r.spotlight ?? (isMac && /spotlight/i.test(r.error ?? "") ? r.wanted : undefined);
    if (spotlight) {
      items.push({ id, level: "attention", title: "Hotkey", detail: `${combo} is Spotlight's. Untick Show Spotlight search under Keyboard Shortcuts > Spotlight, then pal takes it.${still}`, action: { label: "Open Keyboard Shortcuts", keyboardShortcuts: true } });
    } else if (/already registered|in use/i.test(r.error ?? "")) {
      items.push({ id, level: "attention", title: "Hotkey", detail: `${combo} is held by another app (Raycast, if it is running: its hotkey is under Raycast Settings > General). Change one of them.${still}`, action: { label: "Change", go: { page: "shortcuts", anchor } } });
    } else {
      items.push({ id, level: "attention", title: "Hotkey", detail: `${combo} did not register${r.error ? `: ${r.error}` : ""}.${still}`, action: { label: "Change", go: { page: "shortcuts", anchor } } });
    }
  }

  // The switcher over cmd+tab replaces the App Switcher through an event tap, which needs the grant (hotkey.rs).
  if (h?.hold_blocked) {
    items.push({ id: "hold", level: "attention", title: "Switcher", detail: `The switcher chord ${comboLabel(h.hold_blocked)} needs Input Monitoring. Switch it on under Privacy & Security > Input Monitoring.`, action: { label: "Grant…", permission: "input_monitoring" } });
  }

  const users = v.users ?? {};
  // A permission is a row when it is refused and something uses it
  // (`users`): Accessibility always (asked on the first show; the one
  // every paste needs), Full Disk Access (no prompt exists, so this row is
  // the only telling), Input Monitoring once a feature that watches keys
  // is on (pal asked when it was switched on; a bar peek only degrades
  // without it), and Calendars or Location once the prompt was answered
  // no. One the OS has not asked about yet (`not_determined`) is not: the
  // extension prompts from its own row the first time it is used, and a
  // fresh install must not open on a list of grants for palettes never
  // opened.
  for (const p of permissionRows(v.permissions, { users, bar: (v.bar?.length ?? 0) > 0 })) {
    if (p.state !== "missing") continue;
    if (p.id !== "accessibility" && !users[p.id]?.length) continue;
    if ((p.id === "calendar" || p.id === "location") && v.permissions?.[p.id] === "not_determined") continue;
    items.push({ id: `permission:${p.id}`, level: "attention", title: p.title, detail: `${p.needs}. ${p.where.startsWith("Privacy") ? `Switch it on under ${p.where}` : `Granted in ${p.where}`}.`, action: { label: p.id === "full_disk_access" ? "Open the pane" : "Grant…", permission: p.id } });
  }

  // Per instance (`key`): "Gmail (Work) needs token" points at that instance's field; a manifest warning is the extension's, said once.
  for (const e of v.extensions) {
    if (e.loaded === false && e.error) {
      items.push({ id: `failed:${e.key}`, level: "attention", icon: e.icon, title: `${e.title} failed to load`, detail: e.error, action: { label: "Open", go: { page: "extensions", anchor: `extensions:${e.key}` } } });
    }
  }
  // Nothing to work with: a row for an extension the user chose (installed
  // from the store, or a second instance they added), not for a bundled
  // one never touched: fifty ship with pal, a dozen of them want a token,
  // and a fresh install must not open on "11 things to look at" for
  // services it may never use. A bundled one says so in its own palette
  // and on its Extensions page.
  for (const e of v.extensions) {
    if (e.loaded === false) continue;
    if ((e.bundled ?? e.repo === "bundled") && (!e.instance || e.instance.isDefault)) continue;
    const missing = needsSetup(e);
    if (missing.length) {
      items.push({ id: `setup:${e.key}`, level: "attention", icon: e.icon, title: `${e.title} needs ${missing.map((s) => s.label.toLowerCase()).join(" and ")}`, detail: missing[0].description ?? `Its palettes list nothing until ${missing.map((s) => s.label.toLowerCase()).join(" and ")} ${missing.length === 1 ? "is" : "are"} set.`, action: { label: "Set up", go: { page: "extensions", anchor: `extensions:${e.key}:${missing[0].id}` } } });
    }
  }
  const warned = new Set<string>();
  for (const e of v.extensions) {
    for (const w of e.warnings ?? []) {
      if (warned.has(`${e.name}:${w}`)) continue;
      warned.add(`${e.name}:${w}`);
      items.push({ id: `warning:${e.name}:${w}`, level: "attention", icon: e.icon, title: `${e.extTitle ?? e.title}: manifest warning`, detail: w, action: { label: "Open", go: { page: "extensions", anchor: `extensions:${e.name}` } } });
    }
  }
  for (const d of v.diagnostics ?? []) {
    items.push({ id: `config:${d.path}:${d.line ?? ""}`, level: "attention", title: d.level === "error" ? "Config file did not parse" : `Config file: ${d.message}`, detail: d.level === "error" ? `${d.message}${d.line ? ` at line ${d.line}` : ""}. pal keeps the last settings that parsed.` : `${d.path}${d.line ? ` (line ${d.line})` : ""} is ignored.`, action: { label: "Open file", go: { page: "general", anchor: "general:file" } } });
  }
  for (const b of v.barSupported === false ? [] : (v.bar ?? [])) {
    if (b.config.enabled && b.stale) {
      items.push({ id: `stale:${b.key}`, level: "attention", icon: b.extIcon, title: `${b.extTitle} › ${b.title} is stale`, detail: "Its last render failed or timed out; the strip shows the previous state, muted.", action: { label: "Open", go: { page: "bar", anchor: `bar:${b.key}` } } });
    }
  }

  if (v.update?.available) {
    const p = progressLine(v.progress);
    if (v.update.installable) {
      items.push({ id: "update", level: "attention", title: `pal ${v.update.version} is available`, detail: p || `You have ${v.version}. Install downloads it, verifies the signature and relaunches pal.`, action: { label: installing(v.progress) ? "Installing…" : "Install", installUpdate: true, disabled: installing(v.progress) } });
    } else {
      items.push({ id: "update", level: "attention", title: `pal ${v.update.version} is available`, detail: `You have ${v.version}. ${v.update.install_note ? `${v.update.install_note[0].toUpperCase()}${v.update.install_note.slice(1)}.` : "Get it from the releases page."}`, action: { label: "About", go: { page: "about", anchor: "about:updates" } } });
    }
  }
  const updates = new Set<string>();
  for (const e of v.extensions) {
    if (e.latest && !updates.has(e.name)) {
      updates.add(e.name);
      items.push({ id: `update:${e.name}`, level: "attention", icon: e.icon, title: `${e.extTitle ?? e.title} ${e.latest} is available`, detail: `Installed: ${e.version || "unversioned"}.`, action: { label: "Update", updateExtension: e.name } });
    }
  }
  return items;
}

/**
 * The updates line under the facts: when the checks last ran and what
 * they said, one sentence, never a row in the attention list. Pure, for
 * the tests; `now` is the clock the relative time reads against.
 */
export function updatesLine(c: OverviewChecks | undefined, now = Date.now()): string {
  if (!c) return "";
  if (c.busy) return "Checking for updates…";
  const off = c.enabled ? "" : " Automatic checks are off.";
  if (c.checkedAt === undefined) return c.enabled ? "Updates are checked once a day." : "Updates are not checked automatically.";
  const when = relativeDate(c.checkedAt, now);
  const said = c.error ? `The check failed: ${c.error}.` : c.status ? `${c.status[0].toUpperCase()}${c.status.slice(1)}.` : "";
  return `Updates checked ${when === "now" ? "just now" : `${when} ago`}.${said ? ` ${said}` : ""}${off}`;
}

/** The facts under the attention list: what is installed and reachable. */
export function overviewFacts(v: OverviewInput): { label: string; value: ReactNode; go: { page: SettingsPage; anchor?: string } }[] {
  // Extensions count by name; the instances of `multi` ones (`gmail@work`) are said separately when there are any beyond the defaults.
  const names = new Set(v.extensions.map((e) => e.name));
  const failedNames = new Set(v.extensions.filter((e) => e.loaded === false).map((e) => e.name));
  const instances = v.extensions.filter((e) => e.instance && !e.instance.isDefault).length;
  const palettes = v.extensions.flatMap((e) => e.palettes);
  const on = palettes.filter((p) => p.config.enabled).length;
  const withHotkey = palettes.filter((p) => p.config.hotkey).length;
  const withHold = palettes.filter((p) => holdOf(p)).length;
  const itemHotkeys = palettes.reduce((n, p) => n + Object.keys(p.config.itemHotkeys ?? {}).length, 0);
  const barOn = (v.bar ?? []).filter((b) => b.config.enabled && b.source).length;
  const hotkeys = [withHotkey ? `${withHotkey} with a hotkey` : "", withHold ? `${withHold} with a switcher chord` : "", itemHotkeys ? `${plural(itemHotkeys, "item hotkey")}` : ""].filter(Boolean).join(", ");
  return [
    { label: "Hotkey", value: v.hotkey?.hotkeys.length ? <span className="pal-overview__hotkeys" aria-label={combosLabel(v.hotkey.hotkeys.map((h) => h.wanted))}>{v.hotkey.hotkeys.map((h, i) => <span key={i}>{i ? ", " : ""}<Kbd shortcut={h.wanted} /></span>)}</span> : "none", go: { page: "shortcuts", anchor: "shortcuts:hotkey" } },
    ...(v.switcher === undefined ? [] : [{ label: "Switcher", value: v.switcher ? <span className="pal-overview__hotkeys" aria-label={comboLabel(v.switcher)}><Kbd shortcut={v.switcher} /></span> : "off", go: { page: "shortcuts" as const, anchor: "shortcuts:switcher" } }]),
    ...(v.sidebar === undefined ? [] : [{ label: "Sidebar", value: v.sidebar, go: { page: "features" as const, anchor: "features:sidebar" } }]),
    { label: "Extensions", value: `${plural(names.size - failedNames.size, "extension")} loaded${failedNames.size ? `, ${failedNames.size} failed` : ""}${instances ? `, ${plural(instances, "extra instance")}` : ""}`, go: { page: "extensions" } },
    { label: "Palettes", value: `${on} of ${palettes.length} on${hotkeys ? `, ${hotkeys}` : ""}`, go: { page: "extensions" } },
    ...(v.barSupported === false ? [] : [{ label: "Bar", value: v.bar?.length ? `${barOn} of ${plural(v.bar.length, "item")} on` : "no items declared", go: { page: "bar" as const } }]),
  ];
}

export const overviewIndex: SettingsIndexEntry[] = [
  { page: "overview", label: "What needs attention", hint: "Overview", anchor: "overview:attention", keywords: "status health problems" },
  { page: "overview", label: "Check for updates now", hint: "Overview", anchor: "overview:updates", keywords: "update release extensions latest" },
];

export type SettingsOverviewProps = OverviewInput & {
  onGo: (page: SettingsPage, anchor?: string) => void;
  onRequestPermission?: (which: PermissionId) => void;
  onOpenKeyboardShortcuts?: () => void;
  onUpdateExtension?: (name: string) => void;
  /** "Check now": both checks, whatever the setting says. */
  onCheckUpdates?: () => void;
  /** The update row's Install. */
  onInstallUpdate?: () => void;
};

/**
 * The state of pal at a glance: what needs doing, each row with its fix
 * inline, and under it the facts (hotkey, what is loaded, what is on).
 * Nothing to do reads "Everything is set" with the version.
 */
export function SettingsOverview({ onGo, onRequestPermission, onOpenKeyboardShortcuts, onUpdateExtension, onCheckUpdates, onInstallUpdate, ...v }: SettingsOverviewProps) {
  const items = overviewItems(v);
  const facts = overviewFacts(v);
  const act = (a: NonNullable<OverviewItem["action"]>) => {
    if (a.go) onGo(a.go.page, a.go.anchor);
    else if (a.permission) onRequestPermission?.(a.permission);
    else if (a.keyboardShortcuts) onOpenKeyboardShortcuts?.();
    else if (a.updateExtension) onUpdateExtension?.(a.updateExtension);
    else if (a.installUpdate) onInstallUpdate?.();
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
              {it.action && <button type="button" className="pal-button" data-small data-primary={it.action.permission || it.action.updateExtension || it.action.keyboardShortcuts || it.action.installUpdate ? "" : undefined} disabled={it.action.disabled} onClick={() => act(it.action!)}>{it.action.label}</button>}
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

      {v.checks && (
        <p className="pal-overview__checks" data-anchor="overview:updates">
          <span className="pal-overview__checks-text">{updatesLine(v.checks)}</span>
          {onCheckUpdates && <button type="button" className="pal-button" data-small disabled={v.checks.busy} onClick={onCheckUpdates}>{v.checks.busy ? "Checking…" : "Check now"}</button>}
        </p>
      )}
    </div>
  );
}
