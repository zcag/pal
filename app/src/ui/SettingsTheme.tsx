/**
 * The theme file picker on Settings > General (`general.theme_file`,
 * `pal_core::theme`, docs/config.md "Theme file"): a select over the
 * files in `<config dir>/themes/` (plus "pal's own"), the file's
 * diagnostics under it, and the two buttons that open the file in the
 * editor or the folder in Finder (seeding the bundled examples into an
 * empty folder). Pure: `useThemeFile` (Settings.tsx) fetches the status
 * and writes the key; the gallery passes a fixture.
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsRow, SettingsSelect } from "./SettingsField";
import type { Diagnostic } from "./SettingsTypes";

/** theme.rs `Status`. */
export type ThemeFileStatus = {
  /** `general.theme_file` as written; empty for none. */
  setting: string;
  /** The path it resolves to. */
  file?: string;
  /** The file's `name`. */
  name?: string | null;
  diagnostics: Diagnostic[];
  /** `<config dir>/themes`. */
  dir: string;
  themes: { name: string; path: string; title: string }[];
};

export type ThemeFileProps = {
  status: ThemeFileStatus;
  /** `theme_file` set to a name from the folder, or `""` for none. */
  onChange: (name: string) => void;
  /** "Edit theme file": the file in the editor, or the folder when none is set. */
  onEdit?: () => void;
  /** "Open themes folder". */
  onOpenDir?: () => void;
};

const NONE = "";

export function SettingsThemeFile({ status, onChange, onEdit, onOpenDir }: ThemeFileProps) {
  const inDir = status.themes.some((t) => t.name === status.setting);
  // A file outside the folder (a path in the config) is listed as itself, so the select shows what is set.
  const options = [
    { id: NONE, title: "pal's own" },
    ...status.themes.map((t) => ({ id: t.name, title: t.title === t.name ? t.name : `${t.title} (${t.name})` })),
    ...(status.setting && !inDir ? [{ id: status.setting, title: status.setting }] : []),
  ];
  const errors = status.diagnostics.filter((d) => d.level === "error");
  const warnings = status.diagnostics.filter((d) => d.level !== "error");
  return (
    <SettingsRow anchor="general:theme-file" label="Theme file" description={<>Colours, radii and fonts from a TOML file in <code>{status.dir}</code>, light and dark sections applied to the theme above; saved changes apply live. The folder starts with a Catppuccin Frappé and a Rosé Pine Dawn to copy from.</>} htmlFor="pal-general-theme-file">
      <span className="pal-theme-file">
        <SettingsSelect id="pal-general-theme-file" value={status.setting} options={options} onChange={onChange} />
        <span className="pal-button-row">
          {onEdit && <button type="button" className="pal-button" data-small onClick={onEdit}>{status.setting ? "Edit theme file" : "Open themes folder"}</button>}
          {onOpenDir && status.setting && <button type="button" className="pal-button" data-small onClick={onOpenDir}>Open themes folder</button>}
        </span>
        {status.setting && status.name && !errors.length && <span className="pal-theme-file__note">{status.name}{status.file ? `, ${status.file}` : ""}</span>}
        {errors.map((d, i) => <span key={`e${i}`} className="pal-theme-file__note" data-level="error" role="alert">{d.line ? `line ${d.line}: ` : ""}{d.message}</span>)}
        {warnings.length > 0 && (
          <span className="pal-theme-file__note" data-level="warning">
            {warnings.length === 1 ? "1 key ignored" : `${warnings.length} keys ignored`}: {warnings.map((d) => `${d.path} (${d.message})`).join("; ")}
          </span>
        )}
      </span>
    </SettingsRow>
  );
}

/**
 * The live status from `theme_status`, refreshed on every `pal://theme`
 * (a save, a config change) and after a write; `onChange` writes
 * `general.theme_file` (unset for none). For Settings.tsx.
 */
export function useThemeFile(): ThemeFileProps | undefined {
  const [status, setStatus] = useState<ThemeFileStatus | null>(null);
  const refresh = useCallback(() => { invoke<ThemeFileStatus>("theme_status").then(setStatus).catch(() => {}); }, []);
  useEffect(() => {
    refresh();
    const un = listen("pal://theme", refresh);
    return () => { un.then((f) => f()); };
  }, [refresh]);
  if (!status) return undefined;
  const onChange = (name: string) => {
    const call = name ? invoke("settings_set", { key: "general.theme_file", value: name }) : invoke("settings_unset", { key: "general.theme_file" });
    call.then(() => setTimeout(refresh, 300)).catch(() => {});
  };
  return {
    status,
    onChange,
    onEdit: () => invoke("theme_open").then(() => setTimeout(refresh, 500)).catch(() => {}),
    onOpenDir: () => invoke("theme_open_dir").then(() => setTimeout(refresh, 500)).catch(() => {}),
  };
}
