import { Kbd } from "./Kbd";
import { isMac } from "./keys";
import { ArmedButton, SettingsGroup, SettingsRow, SettingsSegment, SettingsSelect, SettingsSwitch } from "./SettingsField";
import { SettingsSidebar, sidebarIndex, type SettingsSidebarProps } from "./SettingsSidebar";
import { SettingsThemeFile, type ThemeFileProps } from "./SettingsTheme";
import { permissionRows, type ConfigFileInfo, type GeneralConfig, type PermissionId, type PermissionsStatus, type SettingsIndexEntry } from "./SettingsTypes";
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
  /** What the OS lets pal do; the Permissions group shows only when given (macOS). */
  permissions?: PermissionsStatus;
  /** The system prompt plus the System Settings pane for one permission. */
  onRequestPermission?: (which: PermissionId) => void;
  /** The Overview, where every permission has its row and its reason. */
  onOpenOverview?: () => void;
  /** The theme file picker (`general.theme_file`), shown when given: `useThemeFile()` in Settings.tsx, a fixture in the gallery. */
  themeFile?: ThemeFileProps;
  /** `[sidebar]`, the card shows when given (macOS: the only platform that builds one). */
  sidebar?: SettingsSidebarProps;
  /** The Shortcuts page, where the hotkey and the switcher chord went: the pointer at the top of this one. */
  onOpenShortcuts?: () => void;
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
  shortcuts: { anchor: "general:shortcuts", hint: "Every global key, on its own page", label: "Keyboard shortcuts", description: "The hotkey that shows pal, the window switcher chord, and every palette, row and bar item shortcut are on the Shortcuts page, with what each collides with.", keywords: "hotkey shortcut keys switcher chord" },
  permissions: { anchor: "general:permissions", hint: "Accessibility, Calendars, Full Disk Access, Input Monitoring, Location", label: "Status", description: "Each is a switch under System Settings > Privacy & Security. pal asks for one the first time something needs it, with a card saying what for; nothing is asked at launch.", keywords: "permissions grant privacy ask" },
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
    label: id === "permissions" ? "Permissions" : id === "file" ? "Config file" : id === "frecency" ? "Reset ranking" : id === "host" ? "Restart extension host" : id === "refresh" ? "Refresh listings" : r.label,
    hint: r.hint,
    anchor: r.anchor,
    keywords: `${r.label} ${r.description} ${r.keywords}`,
  })),
  ...sidebarIndex,
];

/** pal's own settings: the sidebar, how it looks, how it starts, what the OS lets it do, and the file behind all of it; the keys are the Shortcuts page's. */
export function SettingsGeneral({ value, onChange, file, onOpenFile, onRevealFile, onResetFrecency, onRestartHost, onRefreshListings, permissions, onRequestPermission, onOpenOverview, themeFile, sidebar, onOpenShortcuts }: SettingsGeneralProps) {
  const set = <K extends keyof GeneralConfig>(k: K, v: GeneralConfig[K]) => onChange({ ...value, [k]: v });
  const rows = permissionRows(permissions);
  const missing = rows.filter((r) => r.state === "missing");
  return (
    <div className="pal-settings-page">
      <SettingsGroup title="Shortcuts">
        <SettingsRow anchor={text.shortcuts.anchor} label={text.shortcuts.label} description={text.shortcuts.description}>
          <span className="pal-general__shortcuts">
            {value.hotkeys.length ? <span className="pal-overview__hotkeys" aria-label={combosLabel(value.hotkeys)}>{value.hotkeys.map((h, i) => <span key={i}>{i ? ", " : ""}<Kbd shortcut={h} /></span>)}</span> : <span className="pal-hold__off">No hotkey</span>}
            {onOpenShortcuts && <button type="button" className="pal-button" data-small onClick={onOpenShortcuts}>Open Shortcuts</button>}
          </span>
        </SettingsRow>
      </SettingsGroup>

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
