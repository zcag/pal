import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsGroup, SettingsRow, SettingsSwitch } from "./SettingsField";

/** `remote::Status`: whether pal serves its UI to other devices, and where. */
export type RemoteStatus = { enabled: boolean; serving: boolean; port: number; url: string; token: string; connected: number };

export type RemoteProps = {
  status: RemoteStatus;
  onEnabled: (on: boolean) => void;
  onPort: (port: number) => void;
  onReplaceToken: () => void;
  onCopy: (text: string) => void;
};

export const remoteText = {
  enabled: { anchor: "general:remote", hint: "Remote", label: "Use pal from other devices", description: "Serves pal's panel, bar and Settings to a browser on your phone or another computer, running against this machine. Your own tailnet devices get in as they are; anything else needs the token below.", keywords: "remote web browser phone mobile tablet serve server network tailscale" },
  address: { anchor: "general:remote-address", hint: "Remote", label: "Address", description: "Open it on the other device. Adding it to the home screen makes it an app there.", keywords: "url link port" },
  token: { anchor: "general:remote-token", hint: "Remote", label: "Token", description: "For a device outside your tailnet: open the address with ?token= and this, once; the browser remembers it. Replace signs every such device out.", keywords: "password secret key sign in" },
} as const;

/** The Remote group's data: `remote_status`, kept current across config reloads and token changes. */
export function useRemote(onCopy: (text: string) => void): RemoteProps | undefined {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const refresh = useCallback(() => { invoke<RemoteStatus>("remote_status").then(setStatus).catch(() => {}); }, []);
  useEffect(() => {
    refresh();
    const un = listen("pal://config", () => setTimeout(refresh, 200));
    return () => { un.then((f) => f()); };
  }, [refresh]);
  if (!status) return undefined;
  return {
    status,
    onEnabled: (on) => { invoke("settings_set", { key: "remote.enabled", value: on }).catch(() => {}); },
    onPort: (port) => { invoke("settings_set", { key: "remote.port", value: port }).catch(() => {}); },
    onReplaceToken: () => { invoke<RemoteStatus>("remote_replace_token").then(setStatus).catch(() => {}); },
    onCopy,
  };
}

export function SettingsRemote({ status, onEnabled, onPort, onReplaceToken, onCopy }: RemoteProps) {
  const [port, setPort] = useState(String(status.port));
  useEffect(() => setPort(String(status.port)), [status.port]);
  const commitPort = () => {
    const n = Number(port);
    if (Number.isInteger(n) && n >= 1024 && n <= 65535 && n !== status.port) onPort(n);
    else setPort(String(status.port));
  };
  const state = !status.enabled ? null : status.serving ? (status.connected ? `Serving, ${status.connected} ${status.connected === 1 ? "page" : "pages"} open` : "Serving") : `Could not serve on port ${status.port}; the log says why`;
  return (
    <SettingsGroup title="Remote">
      <SettingsRow anchor={remoteText.enabled.anchor} label={remoteText.enabled.label} description={<>{remoteText.enabled.description}{state && <> <strong>{state}.</strong></>}</>} configKey="remote.enabled">
        <SettingsSwitch checked={status.enabled} onChange={onEnabled} label={remoteText.enabled.label} />
      </SettingsRow>
      {status.enabled && (
        <>
          <SettingsRow anchor={remoteText.address.anchor} label={remoteText.address.label} description={remoteText.address.description} configKey="remote.port" htmlFor="pal-remote-port">
            <span className="pal-settings-file">
              <code className="pal-settings-file__path">{status.url}</code>
              <span className="pal-button-row">
                <input id="pal-remote-port" className="pal-field__input" type="number" min={1024} max={65535} value={port} aria-label="Port" style={{ width: "6.5em" }} onChange={(e) => setPort(e.target.value)} onBlur={commitPort} onKeyDown={(e) => { if (e.key === "Enter") commitPort(); }} />
                <button type="button" className="pal-button" onClick={() => onCopy(status.url)}>Copy</button>
              </span>
            </span>
          </SettingsRow>
          <SettingsRow anchor={remoteText.token.anchor} label={remoteText.token.label} description={remoteText.token.description}>
            <span className="pal-button-row">
              <button type="button" className="pal-button" onClick={() => onCopy(`${status.url}/?token=${status.token}`)}>Copy address with token</button>
              <button type="button" className="pal-button" onClick={onReplaceToken}>Replace</button>
            </span>
          </SettingsRow>
        </>
      )}
    </SettingsGroup>
  );
}
