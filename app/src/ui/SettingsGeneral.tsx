import { Kbd } from "./Kbd";
import { isMac } from "./keys";
import { SettingsGroup, SettingsHotkey, SettingsRow, SettingsSegment, SettingsSelect, SettingsSwitch } from "./SettingsField";
import type { ConfigFileInfo, GeneralConfig, HotkeyStatus, PermissionsStatus, SettingsIndexEntry } from "./SettingsTypes";
import { relativeDate, shortcutKeys } from "./format";

export type SettingsGeneralProps = {
  value: GeneralConfig;
  onChange: (value: GeneralConfig) => void;
  file: ConfigFileInfo;
  onOpenFile?: () => void;
  onRevealFile?: () => void;
  /** Maintenance, shown when wired: forget what was picked, and restart the extension host. */
  onResetFrecency?: () => void;
  onRestartHost?: () => void;
  /** How the root hotkey's last registration went; the status line under the recorder. */
  hotkey?: HotkeyStatus;
  /** Where Spotlight's binding is switched off (System Settings > Keyboard > Keyboard Shortcuts). */
  onOpenKeyboardShortcuts?: () => void;
  /** What the OS lets pal do; the Permissions group shows only when given (macOS). */
  permissions?: PermissionsStatus;
  /** The system prompt plus the System Settings pane for one permission. */
  onRequestPermission?: (which: "accessibility") => void;
};

/**
 * The combinations most people want, as buttons that write the key
 * directly. ⌘Space cannot be recorded: Spotlight opens on the press and
 * the recorder never sees it (Raycast offers the same button for the same
 * reason), so the preset is the way to ask for it.
 */
export const hotkeyPresets: string[] = isMac ? ["cmd+space", "alt+space", "ctrl+space", "cmd+shift+space"] : ["ctrl+space", "alt+space", "ctrl+shift+space"];

const sameCombo = (a: string, b: string) => shortcutKeys(a.trim().toLowerCase()).join(" ") === shortcutKeys(b.trim().toLowerCase()).join(" ");

/** Written out for prose: "⌘Space", "Ctrl+Space". */
export const comboLabel = (s: string) => shortcutKeys(s).map((k) => (k === "␣" ? "Space" : k)).join(isMac ? "" : "+");

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

/** What the search field finds on this page. */
export const generalIndex: SettingsIndexEntry[] = [
  { page: "general", label: "Show pal", hint: "Hotkey" },
  { page: "general", label: "Accessibility", hint: "Permissions" },
  { page: "general", label: "Ask on first launch", hint: "Permissions" },
  { page: "general", label: "Theme", hint: "Appearance" },
  { page: "general", label: "Launch at login", hint: "Startup" },
  { page: "general", label: "Menu bar icon", hint: "Startup" },
  { page: "general", label: "Window position", hint: "Appearance" },
  { page: "general", label: "Config file", hint: "~/.config/pal/config.toml" },
  { page: "general", label: "Search history", hint: "Maintenance" },
  { page: "general", label: "Extension host", hint: "Maintenance" },
];

/**
 * Under the recorder: registered, or not and why. A wanted ⌘Space that
 * failed is Spotlight's whether or not the OS said so, hence the second
 * clause; the guidance names the exact switch and opens the pane.
 */
function HotkeyStatusLine({ status, onOpenKeyboardShortcuts }: { status: HotkeyStatus; onOpenKeyboardShortcuts?: () => void }) {
  if (!status.wanted) return <p className="pal-hotkey-status" data-state="off">No hotkey: bind <code>pal toggle</code> in your compositor or desktop.</p>;
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
          {onOpenKeyboardShortcuts && <button type="button" className="pal-button" onClick={onOpenKeyboardShortcuts}>Open Keyboard Shortcuts</button>}
        </div>
      )}
    </>
  );
}

/** pal's own settings: the hotkey, how it looks, how it starts, what the OS lets it do, and the file behind all of it. */
export function SettingsGeneral({ value, onChange, file, onOpenFile, onRevealFile, onResetFrecency, onRestartHost, hotkey, onOpenKeyboardShortcuts, permissions, onRequestPermission }: SettingsGeneralProps) {
  const set = <K extends keyof GeneralConfig>(k: K, v: GeneralConfig[K]) => onChange({ ...value, [k]: v });
  const granted = permissions?.accessibility ?? true;
  return (
    <div className="pal-settings-page">
      <SettingsGroup title="Hotkey">
        <SettingsRow
          label="Show pal"
          description={
            <>
              From anywhere. Press the new combination while the control is recording, or pick one of the presets.
              {isMac && <> ⌘Space cannot be recorded (Spotlight opens on the press); its preset writes it directly.</>}
            </>
          }
        >
          <div className="pal-hotkey-field">
            <div className="pal-hotkey-field__row">
              <SettingsHotkey value={value.hotkey} onChange={(v) => set("hotkey", v ?? "ctrl+space")} label="Show pal" />
              <span className="pal-hotkey-presets" role="group" aria-label="Presets">
                {hotkeyPresets.map((p) => (
                  <button key={p} type="button" className="pal-button" aria-pressed={sameCombo(p, value.hotkey)} onClick={() => set("hotkey", p)}>
                    {comboLabel(p)}
                  </button>
                ))}
              </span>
            </div>
            {hotkey && <HotkeyStatusLine status={hotkey} onOpenKeyboardShortcuts={onOpenKeyboardShortcuts} />}
          </div>
        </SettingsRow>
      </SettingsGroup>

      {permissions && (
        <SettingsGroup title="Permissions">
          <SettingsRow
            label="Accessibility"
            description="Pasting into the app in front, switching to a window and pal action type drive other apps, which macOS allows only from its Accessibility list. Grant shows the system prompt (which puts pal on that list) and opens System Settings > Privacy & Security > Accessibility, where the switch is."
          >
            <span className="pal-permission" data-granted={granted || undefined} role="status">
              <span className="pal-permission__dot" aria-hidden />
              {granted ? "Granted" : "Not granted"}
            </span>
            <button type="button" className="pal-button" disabled={granted} onClick={() => onRequestPermission?.("accessibility")}>{granted ? "Granted" : "Grant…"}</button>
          </SettingsRow>
          <SettingsRow label="Ask on first launch" description="Show the Accessibility prompt the first time the panel opens on a new profile, while the Welcome tips are up.">
            <span className="pal-field__check">
              <SettingsSwitch checked={value.askPermissionsOnStart} onChange={(v) => set("askPermissionsOnStart", v)} label="Ask on first launch" />
              <span>{value.askPermissionsOnStart ? "On" : "Off"}</span>
            </span>
          </SettingsRow>
        </SettingsGroup>
      )}

      <SettingsGroup title="Appearance">
        <SettingsRow label="Theme" description="System follows the OS appearance as it changes.">
          <SettingsSegment value={value.theme} options={themes} onChange={(v) => set("theme", v as GeneralConfig["theme"])} label="Theme" />
        </SettingsRow>
        <SettingsRow label="Window position" description="On the screen with the pointer." htmlFor="pal-general-position">
          <SettingsSelect id="pal-general-position" value={value.position} options={positions} onChange={(v) => set("position", v as GeneralConfig["position"])} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Startup">
        <SettingsRow label="Launch at login" description="pal stays in the menu bar; the hotkey works from the moment you sign in.">
          <span className="pal-field__check">
            <SettingsSwitch checked={value.launchAtLogin} onChange={(v) => set("launchAtLogin", v)} label="Launch at login" />
            <span>{value.launchAtLogin ? "On" : "Off"}</span>
          </span>
        </SettingsRow>
        <SettingsRow label="Menu bar icon" description="pal has no Dock icon. Without this, the hotkey and pal settings are the ways in.">
          <span className="pal-field__check">
            <SettingsSwitch checked={value.menuBarIcon} onChange={(v) => set("menuBarIcon", v)} label="Menu bar icon" />
            <span>{value.menuBarIcon ? "On" : "Off"}</span>
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Config file">
        <SettingsRow
          label="File"
          description={
            <>
              Every setting in this window is a key in this file. Changing one here rewrites only that key, so your comments and
              formatting stay. Edit it by hand any time; pal picks the change up as you save.
              {file.changed && <> Last picked up {relativeDate(file.changed)} ago.</>}
            </>
          }
        >
          <span className="pal-settings-file">
            <code className="pal-settings-file__path">{file.path}</code>
            <button type="button" className="pal-button" onClick={onOpenFile}>Open in editor</button>
            <button type="button" className="pal-button" onClick={onRevealFile}>Reveal</button>
          </span>
        </SettingsRow>
      </SettingsGroup>

      {(onResetFrecency || onRestartHost) && (
        <SettingsGroup title="Maintenance">
          {onResetFrecency && (
            <SettingsRow label="Search history" description="What you picked, and for which query, ranks results. Forget all of it.">
              <button type="button" className="pal-button" data-destructive onClick={onResetFrecency}>Reset ranking</button>
            </SettingsRow>
          )}
          {onRestartHost && (
            <SettingsRow label="Extension host" description="Every extension runs in one process. Restart it to reload them all from scratch.">
              <button type="button" className="pal-button" onClick={onRestartHost}>Restart</button>
            </SettingsRow>
          )}
        </SettingsGroup>
      )}
    </div>
  );
}
