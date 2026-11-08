/**
 * The pages in a browser on another device (docs/design/remote.md): what
 * Tauri's runtime puts on `window` inside the app, put there over pal's
 * socket instead, so every page keeps importing `@tauri-apps/api` and does
 * not know which transport it is on. A call is `{ id, cmd, args }` on the
 * socket and the shell runs it through the same command handlers;
 * `listen`/`unlisten`/`emit` are served here from the socket's events; the
 * `icon://` and `ext://` schemes are the server's `/__icon/` and `/__ext/`
 * routes. A few commands move the calling window, which here is the browser
 * tab: those are answered on the page (`PAGE_COMMANDS`).
 */

import { POPOVER_W } from "./ui/popover-size";

type Target = { kind: "Any" } | { kind: string; label: string };
type Listener = { event: string; target: Target; handler: number };
type Reply = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
type Incoming = { id: number; ok?: unknown; err?: unknown } | { event: string; target: string | null; payload: unknown };

/** The effects a remote pick hands the device (`effects::split_for_device`). */
export type ClientEffects = { copy?: string | { text: string }; open?: string[]; hud?: string; large_type?: string };

/** Which page this document is, as the shell names a remote one: `main`, `bar` or `settings`. */
export function pageOf(search: string): "main" | "bar" | "settings" {
  const p = new URLSearchParams(search);
  return p.has("settings") ? "settings" : p.has("bar") ? "bar" : "main";
}

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");

/** A page narrower than the panel's own layout (remote.css's phone layout): its views are drawn compact, as in the bar popover. */
export const NARROW = "(max-width: 759px)";

/** Whether this document runs in a browser against a pal server rather than inside the app. */
export const isRemote = () => typeof window !== "undefined" && !!(window as { __PAL_REMOTE__?: boolean }).__PAL_REMOTE__;

/** Text onto the device's clipboard: the async API where the page is a secure context, else the selection copy that works over plain http. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* falls through to the selection copy */ }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  return ok;
}

let local: ((event: string, payload: unknown) => void) | null = null;
/** An event to this page's own listeners only, never the socket (a bar sheet's HUD line, handed up from its frame). */
export const raise = (event: string, payload: unknown) => local?.(event, payload);

/** What a page inside another site hands its host (embed.ts): a copy done, and a URL to open, which the page leaves alone when this answers true. */
export const device: { copied?: (text: string) => void; open?: (url: string) => boolean } = {};

/**
 * A phone narrower than a bar popover lays the page out at the popover's
 * width and draws it to fit: views measure their fixed widths against it
 * (the SDK's `POPOVER_W`). The device's width, not the viewport's, which
 * this sets; iOS keeps `screen` in portrait, so it is read by orientation.
 */
export function fitViewport(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const base = meta.content, portrait = matchMedia("(orientation: portrait)");
  const fit = () => {
    const w = portrait.matches ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    meta.content = w < POPOVER_W ? `width=${POPOVER_W}, viewport-fit=cover, interactive-widget=resizes-content` : base;
  };
  fit();
  portrait.addEventListener("change", fit);
}

export function install(): void {
  const label = `remote:${randomId()}:${pageOf(location.search)}`;
  /** A token on the page's own address rides on the socket too: a page framed by another site may get no cookie. */
  const token = new URLSearchParams(location.search).get("token");
  const narrow = pageOf(location.search) === "main" ? matchMedia(NARROW) : null;
  const callbacks = new Map<number, (data: unknown) => unknown>();
  const listeners = new Map<number, Listener>();
  const pending = new Map<number, Reply>();
  const queue: string[] = [];
  let seq = 1;
  let socket: WebSocket | null = null;
  let backoff = 250;

  const deliver = (event: string, target: string | null, payload: unknown) => {
    for (const [id, l] of listeners) {
      if (l.event !== event) continue;
      if (l.target.kind !== "Any" && target !== null && "label" in l.target && l.target.label !== target) continue;
      callbacks.get(l.handler)?.({ event, id, payload });
    }
  };
  local = (event, payload) => deliver(event, null, payload);

  const send = (msg: unknown) => {
    const text = JSON.stringify(msg);
    if (socket?.readyState === WebSocket.OPEN) socket.send(text);
    else queue.push(text);
  };

  const runClient = async (client: ClientEffects) => {
    if (client.copy !== undefined) {
      const text = typeof client.copy === "string" ? client.copy : client.copy.text;
      const ok = await copyText(text);
      if (client.hud === undefined) deliver("pal://hud", null, { text: ok ? "Copied" : "Could not copy here" });
      if (ok) device.copied?.(text);
    }
    for (const url of client.open ?? []) openUrl(url);
    if (client.hud !== undefined) deliver("pal://hud", null, { text: client.hud });
    if (client.large_type !== undefined) deliver("pal://large", null, { text: client.large_type });
  };

  const onMessage = (msg: Incoming) => {
    if ("event" in msg) return deliver(msg.event, msg.target, msg.payload);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.err !== undefined) return p.reject(msg.err);
    const v = msg.ok as { client?: ClientEffects } | null;
    if (v && typeof v === "object" && v.client) {
      const { client, ...rest } = v;
      void runClient(client);
      return p.resolve(rest);
    }
    p.resolve(msg.ok);
  };

  const connect = () => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__pal/ws?label=${encodeURIComponent(label)}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
    const ws = new WebSocket(url);
    socket = ws;
    ws.onopen = () => {
      backoff = 250;
      for (const event of new Set([...listeners.values()].map((l) => l.event))) ws.send(JSON.stringify({ listen: event }));
      ws.send(JSON.stringify({ visible: document.visibilityState === "visible" }));
      if (narrow) ws.send(JSON.stringify({ compact: narrow.matches }));
      for (const text of queue.splice(0)) ws.send(text);
      document.documentElement.dataset.remote = "connected";
    };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(String(e.data))); } catch (err) { console.error("[pal remote]", err); } };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      document.documentElement.dataset.remote = "offline";
      for (const [id, p] of pending) { pending.delete(id); p.reject("the connection to pal dropped; try again in a moment"); }
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 5000);
    };
  };

  const call = (cmd: string, args: unknown) => new Promise((resolve, reject) => {
    const id = seq++;
    pending.set(id, { resolve, reject });
    send({ id, cmd, args: args ?? {} });
  });

  const nav = (search: string) => { location.search = search; };
  const openUrl = (url: string) => { if (!device.open?.(url)) window.open(url, "_blank", "noopener"); };
  /** Commands that move the calling window: the window is the browser tab here, so the page answers them. */
  const PAGE_COMMANDS: Record<string, (args: Record<string, unknown>) => unknown> = {
    hide: () => null,
    panel_fit: () => null,
    panel_reveal: () => null,
    large_hide: () => null,
    settings_open: () => nav("?settings"),
    settings_close: () => (history.length > 1 ? history.back() : nav("")),
    settings_open_link: ({ url }) => {
      if (!/^https?:\/\//.test(String(url))) throw new Error(`not a web link: ${url}`);
      return openUrl(String(url));
    },
  };

  const plugin = (cmd: string, args: Record<string, unknown>): unknown => {
    switch (cmd) {
      case "plugin:event|listen": {
        const event = String(args.event);
        const first = ![...listeners.values()].some((l) => l.event === event);
        const id = args.handler as number;
        listeners.set(id, { event, target: args.target as Target, handler: id });
        if (first) send({ listen: event });
        return id;
      }
      case "plugin:event|unlisten": {
        const l = listeners.get(args.eventId as number);
        listeners.delete(args.eventId as number);
        if (l && ![...listeners.values()].some((x) => x.event === l.event)) send({ unlisten: l.event });
        return null;
      }
      case "plugin:event|emit":
        deliver(String(args.event), null, args.payload);
        send({ emit: args.event, payload: args.payload });
        return null;
      default:
        // The window plugin (a theme pin, a size): the browser owns the tab.
        if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) return null;
        throw new Error(`${cmd} is not available in a browser`);
    }
  };

  const internals = {
    metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } },
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd.startsWith("plugin:")) return plugin(cmd, args ?? {});
      if (cmd in PAGE_COMMANDS) return PAGE_COMMANDS[cmd](args ?? {});
      return call(cmd, args);
    },
    transformCallback: (cb?: (data: unknown) => unknown, once = false) => {
      const id = crypto.getRandomValues(new Uint32Array(1))[0];
      callbacks.set(id, (data) => { if (once) callbacks.delete(id); return cb?.(data); });
      return id;
    },
    unregisterCallback: (id: number) => { callbacks.delete(id); },
    runCallback: (id: number, data: unknown) => { callbacks.get(id)?.(data); },
    callbacks,
    convertFileSrc: (path: string, protocol = "asset") => `${location.origin}/__${protocol}/${encodeURIComponent(path)}`,
  };

  const w = window as unknown as Record<string, unknown>;
  w.__PAL_REMOTE__ = true;
  w.__TAURI_INTERNALS__ = internals;
  w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event: string, id: number) => { listeners.delete(id); } };
  document.addEventListener("visibilitychange", () => send({ visible: document.visibilityState === "visible" }));
  narrow?.addEventListener("change", () => send({ compact: narrow.matches }));
  connect();
}
