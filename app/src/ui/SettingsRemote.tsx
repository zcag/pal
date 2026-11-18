import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SettingsGroup, SettingsRow, SettingsSwitch } from "./SettingsField";

/** `remote::Status`: whether pal serves its UI to other devices, and where. */
export type RemoteStatus = { enabled: boolean; serving: boolean; port: number; url: string; address: string; trusted_proxies: string[]; token: string; connected: number; embed_origins: string[]; embeds: { origin: string; token: string; hide: string[] }[]; pending: string[]; denied: string[] };

export type RemoteProps = {
  status: RemoteStatus;
  onEnabled: (on: boolean) => void;
  onPort: (port: number) => void;
  /** `remote.address` and `remote.trusted_proxies`: a name in front of pal (Caddy's `pal.lan`). */
  onProxy: (address: string, proxies: string[]) => void;
  onReplaceToken: () => void;
  onCopy: (text: string) => void;
  /** `remote.embed_origins`: the sites that may show pal inside their pages. */
  onEmbedOrigins: (origins: string[]) => void;
  /** A site that asked to show pal (or was turned down) allowed or denied (`remote_embed_answer`). */
  onEmbedAnswer: (origin: string, allow: boolean) => void;
  /** `remote.embed_bar_hide`: the bar items a site hides unless a device picked its own. */
  onEmbedHide: (origin: string, keys: string[]) => void;
  /** Every bar item, by key and title, for the per-site picks. */
  barItems: { key: string; title: string }[];
};

/** What a site puts in its page to show pal (docs/embed.md): one tag. */
export const embedSnippet = (url: string, token: string) => `<script type="module" src="${url}/__pal/embed.js" data-token="${token}"></script>`;

export const remoteText = {
  enabled: { anchor: "general:remote", hint: "Remote", label: "Use pal from other devices", description: "Serves pal's panel, bar and Settings to a browser on your phone or another computer, running against this machine. Your own tailnet devices get in as they are; anything else needs the token below.", keywords: "remote web browser phone mobile tablet serve server network tailscale" },
  address: { anchor: "general:remote-address", hint: "Remote", label: "Address", description: "Open it on the other device. Adding it to the home screen makes it an app there.", keywords: "url link port" },
  proxy: { anchor: "general:remote-proxy", hint: "Remote", label: "Behind a proxy", description: "When a name like https://pal.lan serves pal through a reverse proxy: that address, and the proxy's address or range, so your tailnet devices are still known through it.", keywords: "caddy nginx reverse proxy domain name https x-forwarded-for container" },
  token: { anchor: "general:remote-token", hint: "Remote", label: "Token", description: "For a device outside your tailnet: open the address with ?token= and this, once; the browser remembers it. Replace signs every such device out.", keywords: "password secret key sign in" },
  embed: { anchor: "general:remote-embed", hint: "Remote", label: "Inside other sites", description: "Web apps that may show pal's panel and bar inside their pages, by address (https://app.example). A site that puts pal's tag in its page asks here first. Each gets its own token, in the snippet it copies; taking a site off the list signs it out. A site's token can do what your extensions can.", keywords: "embed iframe web app site origin widget pal-web pal-panel pal-bar frame allow deny" },
} as const;

/** The Remote group's data: `remote_status`, kept current across config reloads and token changes. */
export function useRemote(onCopy: (text: string) => void): RemoteProps | undefined {
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [barItems, setBarItems] = useState<{ key: string; title: string }[]>([]);
  const refresh = useCallback(() => { invoke<RemoteStatus>("remote_status").then(setStatus).catch(() => {}); }, []);
  useEffect(() => {
    refresh();
    const un = [listen("pal://config", () => setTimeout(refresh, 200)), listen("pal://remote", refresh)];
    const items = (s: { all?: { key: string; title: string }[] } | null) => setBarItems(s?.all ?? []);
    invoke<{ all?: { key: string; title: string }[] }>("bar_web_items").then(items, () => {});
    const strip = listen<{ all?: { key: string; title: string }[] }>("pal://bar/strip", (e) => items(e.payload));
    return () => { for (const u of [...un, strip]) u.then((f) => f()); };
  }, [refresh]);
  if (!status) return undefined;
  return {
    status,
    onEnabled: (on) => { invoke("settings_set", { key: "remote.enabled", value: on }).catch(() => {}); },
    onPort: (port) => { invoke("settings_set", { key: "remote.port", value: port }).catch(() => {}); },
    onProxy: (address, proxies) => {
      const set = (key: string, value: unknown, empty: boolean) => invoke(empty ? "settings_unset" : "settings_set", empty ? { key } : { key, value });
      Promise.all([set("remote.address", address, !address), set("remote.trusted_proxies", proxies, !proxies.length)]).catch(() => {});
    },
    onReplaceToken: () => { invoke<RemoteStatus>("remote_replace_token").then(setStatus).catch(() => {}); },
    onCopy,
    onEmbedOrigins: (origins) => { invoke(origins.length ? "settings_set" : "settings_unset", origins.length ? { key: "remote.embed_origins", value: origins } : { key: "remote.embed_origins" }).catch(() => {}); },
    onEmbedAnswer: (origin, allow) => { invoke<RemoteStatus>("remote_embed_answer", { origin, allow }).then(setStatus).catch(() => {}); },
    onEmbedHide: (origin, keys) => {
      const map = Object.fromEntries(status.embeds.map((e) => [e.origin, e.origin === origin ? keys : e.hide]).filter(([, k]) => k.length));
      invoke(Object.keys(map).length ? "settings_set" : "settings_unset", Object.keys(map).length ? { key: "remote.embed_bar_hide", value: map } : { key: "remote.embed_bar_hide" }).catch(() => {});
    },
    barItems,
  };
}

/** A site's default bar items: each item on or off for it (`remote.embed_bar_hide`). */
function SiteBar({ hide, items, onHide }: { hide: string[]; items: { key: string; title: string }[]; onHide: (keys: string[]) => void }) {
  const known = new Set(items.map((i) => i.key));
  const flip = (key: string) => onHide(hide.includes(key) ? hide.filter((k) => k !== key) : [...hide, key]);
  return (
    <span className="pal-button-row" role="group" aria-label="Bar items shown there">
      {items.map((i) => <button key={i.key} type="button" className="pal-button" aria-pressed={!hide.includes(i.key)} title={i.key} onClick={() => flip(i.key)}>{hide.includes(i.key) ? <s>{i.title || i.key}</s> : i.title || i.key}</button>)}
      {hide.filter((k) => !known.has(k)).map((k) => <button key={k} type="button" className="pal-button" aria-pressed={false} title="Not on the bar now" onClick={() => flip(k)}><s>{k}</s></button>)}
    </span>
  );
}

export function SettingsRemote({ status, onEnabled, onPort, onProxy, onReplaceToken, onCopy, onEmbedOrigins, onEmbedAnswer, onEmbedHide, barItems }: RemoteProps) {
  const [origins, setOrigins] = useState(status.embed_origins.join(", "));
  useEffect(() => setOrigins(status.embed_origins.join(", ")), [status.embed_origins]);
  const commitOrigins = () => {
    const list = origins.split(/[,\s]+/).filter(Boolean);
    if (list.join(",") !== status.embed_origins.join(",")) onEmbedOrigins(list);
  };
  const [port, setPort] = useState(String(status.port));
  useEffect(() => setPort(String(status.port)), [status.port]);
  const [address, setAddress] = useState(status.address);
  const [proxies, setProxies] = useState(status.trusted_proxies.join(", "));
  useEffect(() => { setAddress(status.address); setProxies(status.trusted_proxies.join(", ")); }, [status.address, status.trusted_proxies]);
  const commitProxy = () => {
    const list = proxies.split(/[,\s]+/).filter(Boolean);
    const addr = address.trim();
    if (addr !== status.address || list.join(",") !== status.trusted_proxies.join(",")) onProxy(addr, list);
  };
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
          <SettingsRow anchor={remoteText.proxy.anchor} label={remoteText.proxy.label} description={remoteText.proxy.description} configKey="remote.trusted_proxies" layout="stack">
            <span className="pal-button-row">
              <input className="pal-field__input" value={address} placeholder="https://pal.lan" aria-label="Address" onChange={(e) => setAddress(e.target.value)} onBlur={commitProxy} onKeyDown={(e) => { if (e.key === "Enter") commitProxy(); }} />
              <input className="pal-field__input" value={proxies} placeholder="docker:theater-proxy" aria-label="Trusted proxies" onChange={(e) => setProxies(e.target.value)} onBlur={commitProxy} onKeyDown={(e) => { if (e.key === "Enter") commitProxy(); }} />
            </span>
          </SettingsRow>
          <SettingsRow anchor={remoteText.token.anchor} label={remoteText.token.label} description={remoteText.token.description}>
            <span className="pal-button-row">
              <button type="button" className="pal-button" onClick={() => onCopy(`${status.url}/?token=${status.token}`)}>Copy address with token</button>
              <button type="button" className="pal-button" onClick={onReplaceToken}>Replace</button>
            </span>
          </SettingsRow>
          {status.pending.map((o) => (
            <SettingsRow key={o} label={`${o} wants to show pal`} description="It put pal's tag in its page. Allowed, it shows pal's bar and panel there, and its token can do what your extensions can.">
              <span className="pal-button-row">
                <button type="button" className="pal-button" onClick={() => onEmbedAnswer(o, true)}>Allow</button>
                <button type="button" className="pal-button" onClick={() => onEmbedAnswer(o, false)}>Deny</button>
              </span>
            </SettingsRow>
          ))}
          <SettingsRow anchor={remoteText.embed.anchor} label={remoteText.embed.label} description={remoteText.embed.description} configKey="remote.embed_origins" layout="stack">
            <span className="pal-settings-file">
              <input className="pal-field__input" value={origins} placeholder="https://app.example" aria-label="Sites" onChange={(e) => setOrigins(e.target.value)} onBlur={commitOrigins} onKeyDown={(e) => { if (e.key === "Enter") commitOrigins(); }} />
              {status.denied.length > 0 && (
                <span className="pal-button-row">
                  {status.denied.map((o) => <button key={o} type="button" className="pal-button" title="Turned down; it is not asked about again" onClick={() => onEmbedAnswer(o, true)}>Allow {o}</button>)}
                </span>
              )}
            </span>
          </SettingsRow>
          {status.embeds.map((e) => (
            <SettingsRow key={e.origin} label={e.origin} description="The bar items it shows unless a device picks its own (a right-click on the bar there)." configKey="remote.embed_bar_hide" layout="stack">
              <span className="pal-settings-file">
                <span className="pal-button-row">
                  <button type="button" className="pal-button" onClick={() => onCopy(embedSnippet(status.url, e.token))}>Copy snippet</button>
                </span>
                <SiteBar hide={e.hide} items={barItems} onHide={(keys) => onEmbedHide(e.origin, keys)} />
              </span>
            </SettingsRow>
          ))}
        </>
      )}
    </SettingsGroup>
  );
}
