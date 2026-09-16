import { SettingsGroup, SettingsHotkey, SettingsRow, SettingsSegment, SettingsSelect, SettingsSwitch } from "./SettingsField";
import type { ConfigFileInfo, GeneralConfig, SettingsIndexEntry } from "./SettingsTypes";
import { relativeDate } from "./format";

export type SettingsGeneralProps = {
  value: GeneralConfig;
  onChange: (value: GeneralConfig) => void;
  file: ConfigFileInfo;
  onOpenFile?: () => void;
  onRevealFile?: () => void;
  /** Maintenance, shown when wired: forget what was picked, and restart the extension host. */
  onResetFrecency?: () => void;
  onRestartHost?: () => void;
};

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
  { page: "general", label: "Theme", hint: "Appearance" },
  { page: "general", label: "Launch at login", hint: "Startup" },
  { page: "general", label: "Menu bar icon", hint: "Startup" },
  { page: "general", label: "Window position", hint: "Appearance" },
  { page: "general", label: "Config file", hint: "~/.config/pal/config.toml" },
  { page: "general", label: "Search history", hint: "Maintenance" },
  { page: "general", label: "Extension host", hint: "Maintenance" },
];

/** pal's own settings: the hotkey, how it looks, how it starts, and the file behind all of it. */
export function SettingsGeneral({ value, onChange, file, onOpenFile, onRevealFile, onResetFrecency, onRestartHost }: SettingsGeneralProps) {
  const set = <K extends keyof GeneralConfig>(k: K, v: GeneralConfig[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="pal-settings-page">
      <SettingsGroup title="Hotkey">
        <SettingsRow label="Show pal" description="From anywhere. Press the new combination while the control is recording.">
          <SettingsHotkey value={value.hotkey} onChange={(v) => set("hotkey", v ?? "ctrl+space")} label="Show pal" />
        </SettingsRow>
      </SettingsGroup>

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
