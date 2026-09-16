import { useState } from "react";
import iconUrl from "../../design/icon.svg";
import { SettingsGroup, SettingsRow } from "./SettingsField";
import type { SettingsIndexEntry } from "./SettingsTypes";

/** updater.rs `UpdateInfo`. */
export type UpdateInfo = { available: boolean; version?: string; notes?: string };

export type SettingsAboutProps = {
  version: string;
  /** The config file's path. */
  file: string;
  links: { docs: string; repo: string };
  /** One check against the release manifest; rejects with the reason (network, signature). */
  onCheckUpdates?: () => Promise<UpdateInfo>;
  onOpenLink?: (url: string) => void;
  onRevealFile?: () => void;
};

export const aboutIndex: SettingsIndexEntry[] = [
  { page: "about", label: "Version", hint: "About" },
  { page: "about", label: "Check for updates", hint: "About" },
  { page: "about", label: "Documentation", hint: "About" },
  { page: "about", label: "Source code", hint: "About" },
  { page: "about", label: "Licences", hint: "About" },
];

/** The app, its version, the update check, and where the rest lives. */
export function SettingsAbout({ version, file, links, onCheckUpdates, onOpenLink, onRevealFile }: SettingsAboutProps) {
  const [check, setCheck] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "done"; info: UpdateInfo } | { kind: "error"; message: string }>({ kind: "idle" });
  const run = async () => {
    if (!onCheckUpdates || check.kind === "busy") return;
    setCheck({ kind: "busy" });
    try {
      setCheck({ kind: "done", info: await onCheckUpdates() });
    } catch (e) {
      setCheck({ kind: "error", message: String(e) });
    }
  };
  const link = (url: string, text: string) => (onOpenLink ? <button type="button" className="pal-link" onClick={() => onOpenLink(url)}>{text}</button> : <span>{text}</span>);
  return (
    <div className="pal-settings-page pal-about">
      <div className="pal-about__hero">
        <img className="pal-about__icon" src={iconUrl} alt="" draggable={false} />
        <h2 className="pal-about__name">pal</h2>
        <p className="pal-about__version">Version {version}</p>
        <p className="pal-about__tagline">A launcher: one search box over everything.</p>
      </div>

      <SettingsGroup title="Updates">
        <SettingsRow label="Version" description={
          check.kind === "done" ? (check.info.available ? `${check.info.version} is available.` : "You have the latest version.")
          : check.kind === "error" ? <span data-error>{check.message}</span>
          : "Checked once a day against the latest release."
        }>
          <span className="pal-about__row">
            <span>{version}</span>
            {onCheckUpdates && <button type="button" className="pal-button" data-small disabled={check.kind === "busy"} onClick={run}>{check.kind === "busy" ? "Checking…" : "Check for Updates"}</button>}
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Links">
        <SettingsRow label="Documentation">{link(links.docs, "Writing an extension")}</SettingsRow>
        <SettingsRow label="Source code">{link(links.repo, links.repo.replace(/^https?:\/\//, ""))}</SettingsRow>
        <SettingsRow label="Config file">
          <span className="pal-settings-file">
            <code className="pal-settings-file__path">{file}</code>
            {onRevealFile && <span className="pal-button-row"><button type="button" className="pal-button" data-small onClick={onRevealFile}>Reveal</button></span>}
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Licences">
        <SettingsRow label="Built with" description="Each ships under its own licence; the notices are in the repository.">
          <span className="pal-about__built">Tauri, React, Bun, and Symbols Nerd Font.</span>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
