import { useState } from "react";
import { Kbd } from "./Kbd";
import { isMac } from "./keys";
import { ArmedButton, SettingsGroup, SettingsHotkey, SettingsRow, SettingsSegment, SettingsSelect, SettingsSwitch } from "./SettingsField";
import { HoldControl } from "./SettingsPalettes";
import { SettingsSidebar, sidebarIndex, type SettingsSidebarProps } from "./SettingsSidebar";
import { SettingsThemeFile, type ThemeFileProps } from "./SettingsTheme";
import { MAX_ROOT_HOTKEYS, permissionRows, type ConfigFileInfo, type GeneralConfig, type HotkeyStatus, type PermissionId, type PermissionsStatus, type RootHotkeyStatus, type SettingsIndexEntry } from "./SettingsTypes";
import { relativeDate, shortcutKeys } from "./format";

export type SettingsGeneralProps = {
  value: GeneralConfig;
  onChange: (value: GeneralConfig) => void;
  file: ConfigFileInfo;
  onOpenFile?: () => void;
  onRevealFile?: () => void;
  /** Maintenance, shown when wired: forget what was picked, restart the extension host, list every palette again. */
  onResetFrecency?: () => void;
  onRestartHost?: () => void;
  onRefreshListings?: () => void;
  /** How every root hotkey's last registration went; the status line under each recorder. */
  hotkey?: HotkeyStatus;
  /** Where Spotlight's binding is switched off (System Settings > Keyboard > Keyboard Shortcuts). */
  onOpenKeyboardShortcuts?: () => void;
  /** What the OS lets pal do; the Permissions group shows only when given (macOS). */
  permissions?: PermissionsStatus;
  /** The system prompt plus the System Settings pane for one permission. */
  onRequestPermission?: (which: PermissionId) => void;
  /** The Overview, where every permission has its row and its reason. */
  onOpenOverview?: () => void;
  /** The theme file picker (`general.theme_file`), shown when given: `useThemeFile()` in Settings.tsx, a fixture in the gallery. */
  themeFile?: ThemeFileProps;
  /** The Windows palette's switcher chord (`palettes.windows.hold`): the file's value and the manifest's suggestion; the card shows when given. */
  switcher?: SwitcherProps;
  /** `[sidebar]`, the card shows when given (macOS: the only platform that builds one). */
  sidebar?: SettingsSidebarProps;
};

export type SwitcherProps = {
  /** `palettes.windows.hold` as the file has it: unset follows `suggested`, `""` is off. */
  hold?: string;
  suggested?: string;
  onChange: (hold: string | undefined) => void;
};

/**
 * The combinations most people want, as buttons that write the key
 * directly. ⌘Space cannot be recorded: Spotlight opens on the press and
 * the recorder never sees it (Raycast offers the same button for the same
 * reason), so the preset is the way to ask for it.
 */
export const hotkeyPresets: string[] = isMac ? ["cmd+space", "alt+space", "ctrl+space", "cmd+shift+space"] : ["ctrl+space", "alt+space", "ctrl+shift+space"];

export const sameCombo = (a: string, b: string) => shortcutKeys(a.trim().toLowerCase()).join(" ") === shortcutKeys(b.trim().toLowerCase()).join(" ");

/** Written out for prose: "⌘Space", "Ctrl+Space". */
export const comboLabel = (s: string) => shortcutKeys(s).map((k) => (k === "␣" ? "Space" : k)).join(isMac ? "" : "+");

/** Every root hotkey for prose: "⌘Space, ⌃Space". */
export const combosLabel = (list: string[]) => list.map(comboLabel).join(", ");

const themes = [
  { id: "system", title: "System" },
  { id: "light", title: "Light" },
  { id: "dark", title: "Dark" },
];

const positions = [
  { id: "top", title: "Upper third of the screen" },
  { id: "centre", title: "Centre of the screen" },
  { id: "last", title: "Where it was last" },
];

/**
 * Every row of the page, once: its label and description as drawn, and
 * what the search field finds it by. The index below is built from this,
 * so a setting is found by any word of its description, not only its
 * label ("dock" finds Menu bar icon, "crash" Launch at login); `keywords`
 * add what the prose does not say.
 */
const text = {
  hotkey: { anchor: "general:hotkey", hint: "Show pal from any app", label: "Show pal", description: isMac
    ? "Opens pal from any app. Press the new combination while the control is recording, or pick one of the presets; Add another gives pal a second combination that does the same. ⌘Space cannot be recorded (Spotlight opens on the press); its preset writes it directly."
    : "Opens pal from any app. Press the new combination while the control is recording, or pick one of the presets; Add another gives pal a second combination that does the same. On Wayland the registration goes through X11 and fires only while an X11 window has focus: bind pal toggle in the compositor instead and set hotkey = \"\" in the config file.", keywords: "hotkey shortcut keys spotlight cmd space several second another" },
  switcher: { anchor: "general:switcher", hint: "Switch windows", label: "Window switcher", description: "Tap it to go back to the previous window; hold it and press again to pick. cmd+tab replaces the App Switcher and needs Input Monitoring.", keywords: "switcher alt tab cmd tab hold windows previous chord" },
  permissions: { anchor: "general:permissions", hint: "Accessibility, Calendars, Full Disk Access, Input Monitoring, Location", label: "Status", description: "Each is a switch under System Settings > Privacy & Security.", keywords: "permissions grant privacy" },
  ask: { anchor: "general:ask", hint: "Permissions", label: "Ask on first launch", description: "Show the Accessibility prompt the first time the panel opens on a new profile, while the Welcome tips are up.", keywords: "" },
  theme: { anchor: "general:theme", hint: "Appearance", label: "Theme", description: "System follows the OS appearance as it changes.", keywords: "dark light" },
  themeFile: { anchor: "general:theme-file", hint: "Appearance", label: "Theme file", description: "Colours, radii and fonts from a TOML file, light and dark sections applied to the theme above; saved changes apply live. The folder starts with a Catppuccin Frappé and a Rosé Pine Dawn to copy from.", keywords: "tokens accent" },
  position: { anchor: "general:position", hint: "Appearance", label: "Window position", description: "On the screen with the pointer.", keywords: "top centre center last" },
  backspace: { anchor: "general:backspace", hint: "Keyboard", label: "Backspace goes back", description: "With nothing typed, Backspace leaves the palette or level you are in, as cmd+backspace does; a row that uses Backspace itself (a folder's Go up) comes first.", keywords: "backspace back pop level keyboard escape" },
  login: { anchor: "general:login", hint: "Startup", label: "Launch at login", description: "The hotkey works from the moment you sign in. Either way pal relaunches itself after a crash; the report shows under About.", keywords: "autostart" },
  menubar: { anchor: "general:menubar", hint: "Startup", label: "Menu bar icon", description: "pal has no Dock icon. Without this, the hotkey and pal settings are the ways in.", keywords: "tray" },
  file: { anchor: "general:file", hint: "~/.config/pal/config.toml", label: "File", description: "Every setting in this window is a key in this file. Changing one here rewrites only that key, so your comments and formatting stay. Edit it by hand any time; pal picks the change up as you save.", keywords: "config toml edit reveal open editor" },
  frecency: { anchor: "general:frecency", hint: "Maintenance", label: "Search history", description: "What you picked, and for which query, ranks results. Forget all of it.", keywords: "reset ranking frecency" },
  host: { anchor: "general:host", hint: "Maintenance", label: "Extension host", description: "Every extension runs in one process. Restart it to reload them all from scratch.", keywords: "bun" },
  refresh: { anchor: "general:refresh", hint: "Maintenance", label: "Listings", description: "Every indexed palette is listed again now, whatever its cache says.", keywords: "refresh relist" },
} as const;

/** What the search field finds on this page: every row above, by its label, its description and its keywords. The search's own label is the row's, except where the group names it better (Hotkey, Permissions, Config file, Reset ranking). */
export const generalIndex: SettingsIndexEntry[] = [
  ...(Object.entries(text) as [keyof typeof text, (typeof text)[keyof typeof text]][]).map(([id, r]): SettingsIndexEntry => ({
    page: "general",
    label: id === "hotkey" ? "Hotkey" : id === "permissions" ? "Permissions" : id === "file" ? "Config file" : id === "frecency" ? "Reset ranking" : id === "host" ? "Restart extension host" : id === "refresh" ? "Refresh listings" : r.label,
    hint: r.hint,
    anchor: r.anchor,
    keywords: `${r.label} ${r.description} ${r.keywords}`,
  })),
  ...sidebarIndex,
];

/**
 * Under a recorder: registered, or not and why. A wanted ⌘Space that
 * failed is Spotlight's whether or not the OS said so, hence the second
 * clause; the guidance names the exact switch and opens the pane.
 */
function HotkeyStatusLine({ status, onOpenKeyboardShortcuts }: { status: RootHotkeyStatus; onOpenKeyboardShortcuts?: () => void }) {
  const spotlight = status.spotlight ?? (isMac && !status.registered && sameCombo(status.wanted, "cmd+space") ? "cmd+space" : undefined);
  return (
    <>
      <p className="pal-hotkey-status" data-state={status.registered ? "ok" : "failed"} role="status">
        <span className="pal-hotkey-status__dot" aria-hidden />
        {status.registered ? <>Registered as <Kbd shortcut={status.wanted} /></> : <>Not registered{status.error ? `: ${status.error}` : ""}</>}
      </p>
      {spotlight && (
        <div className="pal-hotkey-guidance" role="note">
          <p>
            Spotlight uses {comboLabel(spotlight)}. Turn it off in System Settings &gt; Keyboard &gt; Keyboard Shortcuts &gt; Spotlight (untick Show Spotlight search), then pal registers it.
          </p>
          {onOpenKeyboardShortcuts && <button type="button" className="pal-button" data-small onClick={onOpenKeyboardShortcuts}>Open Keyboard Shortcuts</button>}
        </div>
      )}
    </>
  );
}

/**
 * The root hotkeys, one recorder per entry with its presets and its own
 * status line, so a key another app holds is reported on its row while
 * the others keep working. "Add another" opens an empty row that is
 * written once a combination lands in it (nothing is written meanwhile);
 * Remove drops a row. With no entry (`hotkey = ""`) the one row is empty
 * and the line says how pal is reached instead.
 */
function HotkeyRows({ value, onChange, status, onOpenKeyboardShortcuts }: { value: string[]; onChange: (hotkeys: string[]) => void; status?: HotkeyStatus; onOpenKeyboardShortcuts?: () => void }) {
  const [adding, setAdding] = useState(false);
  const rows = value.length ? [...value, ...(adding ? [""] : [])] : [""];
  const statusOf = (entry: string) => status?.hotkeys.find((h) => h.wanted === entry.trim());
  const put = (i: number, v: string | undefined) => {
    setAdding(false);
    const next = i < value.length ? value.map((h, j) => (j === i ? v : h)) : [...value, v];
    onChange(next.filter((h): h is string => Boolean(h && h.trim())));
  };
  const remove = (i: number) => {
    if (i >= value.length) return setAdding(false);
    onChange(value.filter((_, j) => j !== i));
  };
  return (
    <div className="pal-hotkey-field">
      {rows.map((entry, i) => {
        const several = rows.length > 1;
        const name = several ? `Show pal (${i + 1})` : "Show pal";
        const st = entry ? statusOf(entry) : undefined;
        return (
          <div key={i} className="pal-hotkey-entry" data-anchor={i ? `general:hotkey:${i + 1}` : undefined}>
            <div className="pal-hotkey-field__row">
              <SettingsHotkey value={entry || undefined} onChange={(v) => (v === undefined && several ? remove(i) : put(i, v ?? "ctrl+space"))} label={name} />
              <span className="pal-hotkey-presets" role="group" aria-label={several ? `Presets for hotkey ${i + 1}` : "Presets"}>
                {hotkeyPresets.map((p) => (
                  <button key={p} type="button" className="pal-button" data-small aria-pressed={Boolean(entry) && sameCombo(p, entry)} onClick={() => put(i, p)}>
                    {comboLabel(p)}
                  </button>
                ))}
              </span>
              {several && <button type="button" className="pal-button" data-small aria-label={`Remove hotkey ${i + 1}`} onClick={() => remove(i)}>Remove</button>}
            </div>
            {st && <HotkeyStatusLine status={st} onOpenKeyboardShortcuts={onOpenKeyboardShortcuts} />}
          </div>
        );
      })}
      {status && !value.length && <p className="pal-hotkey-status" data-state="off">No hotkey: bind <code>pal toggle</code> in your compositor or desktop.</p>}
      {value.length > 0 && !adding && value.length < MAX_ROOT_HOTKEYS && (
        <span className="pal-button-row">
          <button type="button" className="pal-button" data-small onClick={() => setAdding(true)}>Add another</button>
        </span>
      )}
    </div>
  );
}

/**
 * The Windows palette's switcher chord as its own card, so the switcher
 * is met here and not only in the file: the chord that applies (the
 * manifest's `alt+tab` until the file says otherwise), Clear for off, and
 * the Input Monitoring grant when the chord is `cmd+tab` and the grant is
 * missing (that one replaces the App Switcher through an event tap).
 */
function Switcher({ hold, suggested, onChange, permissions, onRequestPermission }: SwitcherProps & { permissions?: PermissionsStatus; onRequestPermission?: (which: PermissionId) => void }) {
  const chord = (hold ?? suggested)?.trim();
  const needsGrant = !!chord && sameCombo(chord, "cmd+tab") && permissions?.input_monitoring === false;
  return (
    <SettingsGroup title="Window switcher" note="palettes.windows.hold">
      <SettingsRow anchor={text.switcher.anchor} label={text.switcher.label} description={<>{text.switcher.description}{chord ? "" : " Off: the Windows palette opens from its hotkey or the root only."}{needsGrant && <> <span className="pal-setting__note">Input Monitoring is not granted, so {comboLabel("cmd+tab")} stays the App Switcher's until it is.</span></>}</>}>
        <span className="pal-hold pal-switcher">
          <HoldControl value={hold} suggested={suggested} label="Switch windows" onChange={onChange} />
          {needsGrant && onRequestPermission && <button type="button" className="pal-button" data-small data-primary="" onClick={() => onRequestPermission("input_monitoring")}>Turn on Input Monitoring…</button>}
        </span>
      </SettingsRow>
    </SettingsGroup>
  );
}

/** pal's own settings: the hotkey, the window switcher and the sidebar, how it looks, how it starts, what the OS lets it do, and the file behind all of it. */
export function SettingsGeneral({ value, onChange, file, onOpenFile, onRevealFile, onResetFrecency, onRestartHost, onRefreshListings, hotkey, onOpenKeyboardShortcuts, permissions, onRequestPermission, onOpenOverview, themeFile, switcher, sidebar }: SettingsGeneralProps) {
  const set = <K extends keyof GeneralConfig>(k: K, v: GeneralConfig[K]) => onChange({ ...value, [k]: v });
  const rows = permissionRows(permissions);
  const missing = rows.filter((r) => r.state === "missing");
  return (
    <div className="pal-settings-page">
      <SettingsGroup title="Hotkey">
        <SettingsRow anchor={text.hotkey.anchor} label={text.hotkey.label} description={text.hotkey.description}>
          <HotkeyRows value={value.hotkeys} onChange={(v) => set("hotkeys", v)} status={hotkey} onOpenKeyboardShortcuts={onOpenKeyboardShortcuts} />
        </SettingsRow>
      </SettingsGroup>

      {switcher && <Switcher {...switcher} permissions={permissions} onRequestPermission={onRequestPermission} />}
      {sidebar && <SettingsSidebar {...sidebar} />}

      {permissions && (
        <SettingsGroup title="Permissions">
          <SettingsRow anchor={text.permissions.anchor} label={text.permissions.label} description={<>{missing.length ? `${missing.map((r) => r.title).join(", ")} ${missing.length === 1 ? "is" : "are"} not granted; the Overview says what each is for and has the Grant button.` : "Every permission pal can use is granted."} {text.permissions.description}</>}>
            <span className="pal-permissions__wrap">
            <ul className="pal-permissions" aria-label="Permissions">
              {rows.map((r) => (
                <li key={r.id} className="pal-permission" data-granted={r.granted || undefined} data-state={r.state} title={r.needs}>
                  <span className="pal-permission__dot" aria-hidden />
                  <span className="pal-permission__title">{r.title}</span>
                  <span className="pal-permission__note">{r.brief}</span>
                  {r.state === "missing" && onRequestPermission && <button type="button" className="pal-button" data-small onClick={() => onRequestPermission(r.id)}>{r.id === "full_disk_access" ? "Open…" : "Grant…"}</button>}
                  {r.state === "unknown" && <span className="pal-permission__note">nothing to probe</span>}
                </li>
              ))}
            </ul>
            {onOpenOverview && missing.length > 0 && <button type="button" className="pal-button" data-small onClick={onOpenOverview}>What each is for: Overview</button>}
            </span>
          </SettingsRow>
          <SettingsRow anchor={text.ask.anchor} label={text.ask.label} description={text.ask.description}>
            <SettingsSwitch checked={value.askPermissionsOnStart} onChange={(v) => set("askPermissionsOnStart", v)} label="Ask on first launch" />
          </SettingsRow>
        </SettingsGroup>
      )}

      <SettingsGroup title="Appearance">
        <SettingsRow anchor={text.theme.anchor} label={text.theme.label} description={text.theme.description}>
          <SettingsSegment value={value.theme} options={themes} onChange={(v) => set("theme", v as GeneralConfig["theme"])} label="Theme" />
        </SettingsRow>
        {themeFile && <SettingsThemeFile {...themeFile} />}
        <SettingsRow anchor={text.position.anchor} label={text.position.label} description={text.position.description} htmlFor="pal-general-position">
          <SettingsSelect id="pal-general-position" value={value.position} options={positions} onChange={(v) => set("position", v as GeneralConfig["position"])} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Keyboard">
        <SettingsRow anchor={text.backspace.anchor} label={text.backspace.label} description={text.backspace.description}>
          <SettingsSwitch checked={value.backspaceBack} onChange={(v) => set("backspaceBack", v)} label="Backspace goes back" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Startup">
        <SettingsRow anchor={text.login.anchor} label={text.login.label} description={text.login.description}>
          <SettingsSwitch checked={value.launchAtLogin} onChange={(v) => set("launchAtLogin", v)} label="Launch at login" />
        </SettingsRow>
        <SettingsRow anchor={text.menubar.anchor} label={text.menubar.label} description={text.menubar.description}>
          <SettingsSwitch checked={value.menuBarIcon} onChange={(v) => set("menuBarIcon", v)} label="Menu bar icon" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Config file">
        <SettingsRow anchor={text.file.anchor} label={text.file.label} description={<>{text.file.description}{file.changed && <> Last picked up {relativeDate(file.changed)} ago.</>}</>}>
          <span className="pal-settings-file">
            <code className="pal-settings-file__path">{file.path}</code>
            <span className="pal-button-row">
              <button type="button" className="pal-button" onClick={onOpenFile}>Open in Editor</button>
              <button type="button" className="pal-button" onClick={onRevealFile}>Reveal</button>
            </span>
          </span>
        </SettingsRow>
      </SettingsGroup>

      {(onResetFrecency || onRestartHost || onRefreshListings) && (
        <SettingsGroup title="Maintenance">
          {onResetFrecency && (
            <SettingsRow anchor={text.frecency.anchor} label={text.frecency.label} description={text.frecency.description}>
              <ArmedButton label="Reset Ranking" arm="Forget it all? Click again" onConfirm={onResetFrecency} />
            </SettingsRow>
          )}
          {onRestartHost && (
            <SettingsRow anchor={text.host.anchor} label={text.host.label} description={text.host.description}>
              <button type="button" className="pal-button" onClick={onRestartHost}>Restart</button>
            </SettingsRow>
          )}
          {onRefreshListings && (
            <SettingsRow anchor={text.refresh.anchor} label={text.refresh.label} description={text.refresh.description}>
              <button type="button" className="pal-button" onClick={onRefreshListings}>Refresh All</button>
            </SettingsRow>
          )}
        </SettingsGroup>
      )}
    </div>
  );
}
