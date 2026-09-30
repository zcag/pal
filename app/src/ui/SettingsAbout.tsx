import { useState } from "react";
import iconUrl from "../../design/icon.svg";
import { relativeDate } from "./format";
import { ArmedButton, SettingsGroup, SettingsRow } from "./SettingsField";
import type { SettingsIndexEntry } from "./SettingsTypes";

/** updater.rs `UpdateInfo`. */
export type UpdateInfo = {
  available: boolean;
  version?: string;
  notes?: string;
  /** Why there was nothing to compare against ("no release published yet"), a fact. */
  status?: string;
  /** With `available`: whether "Install update" can do it on this build, and why not. */
  installable?: boolean;
  install_note?: string;
};

/** updater.rs `Progress`: where an install is, on `pal://update`. */
export type UpdateProgress =
  | { phase: "idle" }
  | { phase: "downloading"; version: string; downloaded: number; total?: number }
  | { phase: "installing"; version: string }
  | { phase: "restarting"; version: string }
  | { phase: "failed"; version: string; error: string };

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

/** One line for an install in progress, or nothing while idle. */
export function progressLine(p: UpdateProgress | undefined): string {
  if (!p || p.phase === "idle") return "";
  switch (p.phase) {
    case "downloading": return p.total ? `Downloading ${p.version}: ${Math.floor((p.downloaded * 100) / p.total)}% of ${mb(p.total)}…` : `Downloading ${p.version}: ${mb(p.downloaded)}…`;
    case "installing": return `Installing ${p.version}…`;
    case "restarting": return `${p.version} is installed; pal is restarting.`;
    case "failed": return `Installing ${p.version} failed: ${p.error}`;
  }
}

/** Whether an install is running (a second click is refused meanwhile). */
export const installing = (p: UpdateProgress | undefined) => !!p && (p.phase === "downloading" || p.phase === "installing" || p.phase === "restarting");

/** crash.rs `Report`: the OS's report of the last crash. `path` is the `.ips` on macOS; Linux has `coredumpctl` and no file. */
export type CrashReport = { at: number; kind: string; path?: string };
/** crash.rs `Panic`: the last Rust panic's file, its first line. */
export type PanicReport = { at: number; message: string; path: string };
/** Which of the files the About page names, for `onOpenReport`/`onRevealReport`. */
export type ReportKind = "crash" | "panic";

export type SettingsAboutProps = {
  version: string;
  /** The config file's path. */
  file: string;
  /** `changelog`: the changelog from this version on; `store` the extension store's page, `issues` a new bug report. */
  links: { docs: string; repo: string; changelog?: string; store?: string; issues?: string };
  /** One check against the release manifest and every registry; answers the release's result, rejects with its reason (network, signature). */
  onCheckUpdates?: () => Promise<UpdateInfo>;
  /** Extensions whose update waits for the user (auto-update off for their registry); the rest update by themselves on a check. */
  extensionUpdates?: { name: string; title: string }[];
  onUpdateExtensions?: (names: string[]) => Promise<void>;
  /** The last check's answer, when one ran (the Overview's, the daily one); the row starts from it. */
  update?: UpdateInfo;
  /** "Install update": download, verify, install, relaunch; the progress arrives in `progress`. */
  onInstallUpdate?: () => Promise<void>;
  progress?: UpdateProgress;
  onOpenLink?: (url: string) => void;
  onRevealFile?: () => void;
  /** What the last run left behind, when anything. */
  crash?: CrashReport;
  panic?: PanicReport;
  onOpenReport?: (which: ReportKind) => void;
  onRevealReport?: (which: ReportKind) => void;
  /** The diagnostics text (`pal doctor`'s): versions, paths, permissions, what loaded. Copied for a bug report. */
  diagnosticsText?: () => Promise<string> | string;
  /** Maintenance, shown when wired: forget what was picked, restart the extension host, list every palette again. */
  onResetFrecency?: () => void;
  onRestartHost?: () => void;
  onRefreshListings?: () => void;
};

const maintenance = {
  frecency: { anchor: "about:frecency", label: "Search history", search: "Reset ranking", description: "What you picked, and for which query, ranks results. Forget all of it.", keywords: "reset ranking frecency" },
  host: { anchor: "about:host", label: "Extension host", search: "Restart extension host", description: "Every extension runs in one process. Restart it to reload them all from scratch.", keywords: "bun reload" },
  refresh: { anchor: "about:refresh", label: "Listings", search: "Refresh listings", description: "Every indexed palette is listed again now, whatever its cache says.", keywords: "refresh relist index cache" },
} as const;

export const aboutIndex: SettingsIndexEntry[] = [
  { page: "about", label: "Check for updates", hint: "About", anchor: "about:updates", keywords: "version release" },
  { page: "about", label: "Extension updates", hint: "About", anchor: "about:extensions", keywords: "update all extensions registry" },
  ...Object.values(maintenance).map((m): SettingsIndexEntry => ({ page: "about", label: m.search, hint: "Maintenance", anchor: m.anchor, keywords: `${m.label} ${m.description} ${m.keywords}` })),
  { page: "about", label: "Documentation", hint: "About", anchor: "about:docs", keywords: "writing an extension guide" },
  { page: "about", label: "Extension store", hint: "About", anchor: "about:store", keywords: "browse install extensions website" },
  { page: "about", label: "Changelog", hint: "About", anchor: "about:changelog", keywords: "what's new release notes" },
  { page: "about", label: "Report a bug", hint: "About", anchor: "about:bug", keywords: "issue github problem" },
  { page: "about", label: "Source code", hint: "About", anchor: "about:repo", keywords: "github" },
  { page: "about", label: "Copy diagnostics", hint: "About", anchor: "about:diagnostics", keywords: "doctor bug report" },
  { page: "about", label: "Last crash", hint: "About", anchor: "about:crash", keywords: "panic report" },
  { page: "about", label: "Licences", hint: "About", anchor: "about:licences" },
];

/** The clipboard, on a click: the async API first, the selection command where a webview refuses it. */
export function copyText(text: string) {
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } finally { ta.remove(); }
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(fallback);
  else fallback();
}

/** One report's row: when, what, and the actions (open, reveal, copy the path). */
function ReportRow({ label, which, at, what, path, onOpen, onReveal }: { label: string; which: ReportKind; at: number; what: string; path?: string; onOpen?: (which: ReportKind) => void; onReveal?: (which: ReportKind) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!path) return;
    copyText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const when = new Date(at);
  return (
    <SettingsRow label={label} description={<><time dateTime={when.toISOString()} title={when.toLocaleString()}>{relativeDate(at)} ago</time>, {what}</>}>
      <span className="pal-button-row">
        {path && onOpen && <button type="button" className="pal-button" data-small onClick={() => onOpen(which)}>Open Report</button>}
        {path && onReveal && <button type="button" className="pal-button" data-small onClick={() => onReveal(which)}>Reveal</button>}
        {path && <button type="button" className="pal-button" data-small onClick={copy}>{copied ? "Copied" : "Copy Path"}</button>}
      </span>
    </SettingsRow>
  );
}

/** The app, its version, the update check, the last crash, and where the rest lives. */
export function SettingsAbout({ version, file, links, onCheckUpdates, extensionUpdates, onUpdateExtensions, update, onInstallUpdate, progress, onOpenLink, onRevealFile, crash, panic, onOpenReport, onRevealReport, diagnosticsText, onResetFrecency, onRestartHost, onRefreshListings }: SettingsAboutProps) {
  const [check, setCheck] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "done"; info: UpdateInfo } | { kind: "error"; message: string }>(update ? { kind: "done", info: update } : { kind: "idle" });
  const [installError, setInstallError] = useState<string | null>(null);
  const info = check.kind === "done" ? check.info : undefined;
  const busy = installing(progress);
  const install = async () => {
    if (!onInstallUpdate || busy) return;
    setInstallError(null);
    try { await onInstallUpdate(); } catch (e) { setInstallError(String(e)); }
  };
  const updateLine = () => {
    const p = progressLine(progress);
    if (installError) return <span data-error>{installError}</span>;
    if (p) return progress?.phase === "failed" ? <span data-error>{p}</span> : p;
    if (check.kind === "error") return <span data-error>{check.message}</span>;
    if (!info) return "Checked once a day against the latest release, with every extension.";
    if (!info.available) return info.status ? `${info.status[0].toUpperCase()}${info.status.slice(1)}.` : "You have the latest version.";
    return info.installable ? `${info.version} is available. Install downloads it, verifies the signature and relaunches pal.` : `${info.version} is available${info.install_note ? `: ${info.install_note}` : " on pal.cagdas.io"}.`;
  };
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const copyDiagnostics = async () => {
    if (!diagnosticsText) return;
    try {
      copyText(await diagnosticsText());
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 1500);
  };
  const run = async () => {
    if (!onCheckUpdates || check.kind === "busy") return;
    setCheck({ kind: "busy" });
    try {
      setCheck({ kind: "done", info: await onCheckUpdates() });
    } catch (e) {
      setCheck({ kind: "error", message: String(e) });
    }
  };
  const [updatingExt, setUpdatingExt] = useState(false);
  const updateExtensions = async () => {
    if (!onUpdateExtensions || !extensionUpdates?.length) return;
    setUpdatingExt(true);
    try { await onUpdateExtensions(extensionUpdates.map((e) => e.name)); } finally { setUpdatingExt(false); }
  };
  const extLine = !extensionUpdates?.length ? "Every extension is up to date, or updates by itself when a check finds one." : `${extensionUpdates.map((e) => e.title).join(", ")} ${extensionUpdates.length === 1 ? "has an update" : "have updates"} waiting.`;
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
        <SettingsRow anchor="about:updates" label="Version" description={updateLine()}>
          <span className="pal-about__row">
            <span>{version}</span>
            {info?.available && info.installable && onInstallUpdate && (
              <button type="button" className="pal-button" data-small data-primary="" disabled={busy} onClick={install}>{busy ? progress?.phase === "downloading" ? "Downloading…" : progress?.phase === "installing" ? "Installing…" : "Restarting…" : `Install ${info.version}`}</button>
            )}
            {links.changelog && onOpenLink && <button type="button" className="pal-button" data-small onClick={() => onOpenLink(links.changelog!)}>What's New</button>}
            {onCheckUpdates && <button type="button" className="pal-button" data-small disabled={check.kind === "busy" || busy} onClick={run}>{check.kind === "busy" ? "Checking…" : "Check for Updates"}</button>}
          </span>
        </SettingsRow>
        {extensionUpdates && (
          <SettingsRow anchor="about:extensions" label="Extensions" description={extLine}>
            {extensionUpdates.length > 0 && onUpdateExtensions && <button type="button" className="pal-button" data-small data-primary="" disabled={updatingExt} onClick={updateExtensions}>{updatingExt ? "Updating…" : extensionUpdates.length === 1 ? "Update" : "Update All"}</button>}
          </SettingsRow>
        )}
      </SettingsGroup>

      {(onResetFrecency || onRestartHost || onRefreshListings) && (
        <SettingsGroup title="Maintenance">
          {onRefreshListings && (
            <SettingsRow anchor={maintenance.refresh.anchor} label={maintenance.refresh.label} description={maintenance.refresh.description}>
              <button type="button" className="pal-button" data-small onClick={onRefreshListings}>Refresh All</button>
            </SettingsRow>
          )}
          {onRestartHost && (
            <SettingsRow anchor={maintenance.host.anchor} label={maintenance.host.label} description={maintenance.host.description}>
              <button type="button" className="pal-button" data-small onClick={onRestartHost}>Restart</button>
            </SettingsRow>
          )}
          {onResetFrecency && (
            <SettingsRow anchor={maintenance.frecency.anchor} label={maintenance.frecency.label} description={maintenance.frecency.description}>
              <ArmedButton label="Reset Ranking" arm="Forget it all? Click again" onConfirm={onResetFrecency} data-small />
            </SettingsRow>
          )}
        </SettingsGroup>
      )}

      <SettingsGroup title="Links">
        <SettingsRow anchor="about:docs" label="Documentation">{link(links.docs, "Writing an extension")}</SettingsRow>
        {links.store && <SettingsRow anchor="about:store" label="Extension store">{link(links.store, links.store.replace(/^https?:\/\//, ""))}</SettingsRow>}
        {links.changelog && <SettingsRow anchor="about:changelog" label="Changelog">{link(links.changelog, "What's new since this version")}</SettingsRow>}
        {links.issues && <SettingsRow anchor="about:bug" label="Report a bug">{link(links.issues, "Open an issue on GitHub")}</SettingsRow>}
        <SettingsRow anchor="about:repo" label="Source code">{link(links.repo, links.repo.replace(/^https?:\/\//, ""))}</SettingsRow>
        <SettingsRow label="Config file">
          <span className="pal-settings-file">
            <code className="pal-settings-file__path">{file}</code>
            {onRevealFile && <span className="pal-button-row"><button type="button" className="pal-button" data-small onClick={onRevealFile}>Reveal</button></span>}
          </span>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Bug reports">
        {diagnosticsText && (
          <SettingsRow anchor="about:diagnostics" label="Diagnostics" description="What pal doctor prints: versions, paths, permissions, which extensions loaded and which failed. Nothing secret; paste it into an issue.">
            <button type="button" className="pal-button" data-small onClick={copyDiagnostics}>{copied === "done" ? "Copied" : copied === "failed" ? "Could not copy" : "Copy Diagnostics"}</button>
          </SettingsRow>
        )}
        <div data-anchor="about:crash">
        {crash
          ? <ReportRow label="Last crash" which="crash" at={crash.at} what={crash.kind} path={crash.path} onOpen={onOpenReport} onReveal={onRevealReport} />
          : <SettingsRow label="Last crash" description="pal relaunches itself after a crash and the report of the last one shows here.">None recorded.</SettingsRow>}
        </div>
        {panic && <ReportRow label="Last panic" which="panic" at={panic.at} what={panic.message} path={panic.path} onOpen={onOpenReport} onReveal={onRevealReport} />}
      </SettingsGroup>

      <SettingsGroup title="Licences">
        <SettingsRow anchor="about:licences" label="Built with" description="Each ships under its own licence; the notices are in the repository.">
          <span className="pal-about__built">Tauri, React, Bun, and Symbols Nerd Font.</span>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
