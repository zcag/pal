// The TV's remote websocket, `wss://<tv>:8002/api/v2/channels/
// samsung.remote.control?name=<base64>&token=<t>` (a self-signed
// certificate). Without a token, or with one the TV no longer knows, the
// TV asks "Allow pal?" on screen; Allow answers `ms.channel.connect` with
// the token to keep, Deny `ms.channel.unauthorized`, no answer
// `ms.channel.timeOut`. What travels: `ms.remote.control` (keys as
// SendRemoteKey Click/Press/Release, text as SendInputString, the cursor
// as ProcessMouseDevice) and `ms.channel.emit` to `host` (the installed
// apps, launching one, an app's icon), whose answers come back as events
// of the same name; the keyboard opening and closing come as
// `ms.remote.imeStart` / `imeUpdate` / `imeEnd`. The message shapes are
// samsungtvws's (xchwarze/samsung-tv-ws-api), the reference both Home
// Assistant and this follow.
import type { App, Key } from "../types.ts";

export const NAME = "pal";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** `Key` → the TV's code. Not every model has every code: the numbered HDMI keys are the usual gap. */
export const KEYS: Record<Key, string> = {
  up: "KEY_UP", down: "KEY_DOWN", left: "KEY_LEFT", right: "KEY_RIGHT", select: "KEY_ENTER", back: "KEY_RETURN", home: "KEY_HOME", menu: "KEY_MENU", exit: "KEY_EXIT",
  play: "KEY_PLAY", pause: "KEY_PAUSE", play_pause: "KEY_PLAY_BACK", stop: "KEY_STOP", rewind: "KEY_REWIND", forward: "KEY_FF", previous: "KEY_REWIND_", next: "KEY_FF_",
  volume_up: "KEY_VOLUP", volume_down: "KEY_VOLDOWN", mute: "KEY_MUTE", power: "KEY_POWER",
  channel_up: "KEY_CHUP", channel_down: "KEY_CHDOWN", channel_list: "KEY_CH_LIST", guide: "KEY_GUIDE", info: "KEY_INFO", tools: "KEY_TOOLS",
  source: "KEY_SOURCE", hdmi: "KEY_HDMI", tv: "KEY_TV", hdmi1: "KEY_HDMI1", hdmi2: "KEY_HDMI2", hdmi3: "KEY_HDMI3", hdmi4: "KEY_HDMI4",
  red: "KEY_RED", green: "KEY_GREEN", yellow: "KEY_YELLOW", blue: "KEY_CYAN",
  0: "KEY_0", 1: "KEY_1", 2: "KEY_2", 3: "KEY_3", 4: "KEY_4", 5: "KEY_5", 6: "KEY_6", 7: "KEY_7", 8: "KEY_8", 9: "KEY_9",
};

export function remoteUrl(address: string, token?: string, opts: { port?: number; secure?: boolean } = {}): string {
  const secure = opts.secure ?? true;
  const q = `name=${encodeURIComponent(b64(NAME))}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  return `${secure ? "wss" : "ws"}://${address}:${opts.port ?? (secure ? 8002 : 8001)}/api/v2/channels/samsung.remote.control?${q}`;
}

// ---- messages out ----------------------------------------------------------------------------------

export const keyMsg = (code: string, cmd: "Click" | "Press" | "Release" = "Click") =>
  ({ method: "ms.remote.control", params: { Cmd: cmd, DataOfCmd: code, Option: "false", TypeOfRemote: "SendRemoteKey" } });
export const textMsg = (text: string) => ({ method: "ms.remote.control", params: { Cmd: b64(text), DataOfCmd: "base64", TypeOfRemote: "SendInputString" } });
export const textEndMsg = () => ({ method: "ms.remote.control", params: { TypeOfRemote: "SendInputEnd" } });
export const moveMsg = (x: number, y: number, at = Date.now()) => ({ method: "ms.remote.control", params: { Cmd: "Move", Position: { x, y, Time: String(at) }, TypeOfRemote: "ProcessMouseDevice" } });
export const clickMsg = () => ({ method: "ms.remote.control", params: { Cmd: "LeftClick", TypeOfRemote: "ProcessMouseDevice" } });
const emit = (event: string, data?: Record<string, unknown>) => ({ method: "ms.channel.emit", params: { event, to: "host", ...(data && { data }) } });
export const appsMsg = () => emit("ed.installedApp.get");
/** `app_type` 2 (a web app) launches as DEEP_LINK, anything else NATIVE_LAUNCH; `meta` is the deep link. */
export const launchMsg = (id: string, type?: number, meta?: string) => emit("ed.apps.launch", { action_type: type === 2 ? "DEEP_LINK" : "NATIVE_LAUNCH", appId: id, ...(meta !== undefined && { metaTag: meta }) });
export const iconMsg = (path: string) => emit("ed.apps.icon", { iconPath: path });

// ---- messages in -----------------------------------------------------------------------------------

/** `ed.installedApp.get`'s `data.data`: `{ appId, name, app_type, icon }` each. */
export function parseApps(data: any): App[] {
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list
    .filter((a: any) => a && a.appId)
    .map((a: any): App => ({ id: String(a.appId), name: String(a.name ?? a.appId), type: typeof a.app_type === "number" ? a.app_type : undefined, icon: typeof a.icon === "string" && a.icon ? a.icon : undefined }));
}

/** The text an `imeUpdate` carries: base64 on the TVs that send it, plain on others. */
export function imeText(data: unknown): string | undefined {
  if (typeof data !== "string" || !data) return undefined;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(data) && data.length % 4 === 0) {
    const s = Buffer.from(data, "base64").toString("utf8");
    if (!s.includes("�")) return s;
  }
  return data;
}

/** The connect outcome in words: Deny, no one answering the prompt, a TV that dropped the socket. */
export function refusal(event: string): string {
  if (event === "ms.channel.unauthorized") return "The TV refused pal: Deny was pressed, or pal is blocked under Settings › General › External Device Manager › Device Connection Manager";
  if (event === "ms.channel.timeOut") return "No one pressed Allow on the TV in time";
  return `The TV closed the connection (${event})`;
}

export type RemoteEvent = { event: string; data?: any };

/**
 * One open remote channel: `send` a message, `request` one whose answer
 * is an event of the same name, `on` every event. `token` is what the TV
 * gave at connect (the same one, a new one, or none on a TV that does not
 * hand them out).
 */
export class Remote {
  private listeners = new Set<(e: RemoteEvent) => void>();
  private closedL = new Set<(why: string) => void>();
  open = true;
  private constructor(private ws: WebSocket, readonly token: string | undefined) {
    ws.addEventListener("message", (m) => { const e = parse(m.data); if (e) for (const l of this.listeners) l(e); });
    ws.addEventListener("close", (c) => { this.open = false; for (const l of this.closedL) l(c.reason || `closed (${c.code})`); });
  }

  /**
   * Open the channel and wait for the TV's verdict: `ms.channel.connect`
   * resolves, a refusal or `timeoutMs` (an unanswered Allow prompt, a TV
   * that never speaks) rejects and closes.
   */
  static connect(url: string, timeoutMs: number): Promise<Remote> {
    return new Promise((resolve, reject) => {
      // Bun's WebSocket takes `tls`: the TV's certificate is its own, signed by nothing a trust store has.
      const ws = new WebSocket(url, { tls: { rejectUnauthorized: false } } as any);
      let settled = false;
      const fail = (why: string) => { if (settled) return; settled = true; clearTimeout(timer); try { ws.close(); } catch {} reject(new Error(why)); };
      const timer = setTimeout(() => fail(/[?&]token=/.test(url) ? "The TV did not answer" : "No one pressed Allow on the TV in time"), timeoutMs);
      ws.addEventListener("message", (m) => {
        if (settled) return;
        const e = parse(m.data);
        if (!e) return;
        if (e.event === "ms.channel.connect") { settled = true; clearTimeout(timer); resolve(new Remote(ws, typeof e.data?.token === "string" ? e.data.token : undefined)); }
        else if (e.event === "ms.channel.unauthorized" || e.event === "ms.channel.timeOut") fail(refusal(e.event));
      });
      ws.addEventListener("error", () => fail("Could not reach the TV's remote; is it on and on this network?"));
      ws.addEventListener("close", (c) => fail(c.code === 1000 ? "The TV closed the connection" : `The TV closed the connection (${c.code}${c.reason ? `: ${c.reason}` : ""})`));
    });
  }

  send(msg: unknown): void {
    if (!this.open) throw new Error("The TV's remote is not connected");
    this.ws.send(JSON.stringify(msg));
  }

  /** Send, then the first event named `event` (or `undefined` after `timeoutMs`: older TVs answer some of these with nothing). */
  request(msg: unknown, event: string, timeoutMs: number): Promise<RemoteEvent | undefined> {
    return new Promise((resolve, reject) => {
      const off = this.on((e) => { if (e.event === event) { off(); clearTimeout(t); resolve(e); } });
      const t = setTimeout(() => { off(); resolve(undefined); }, timeoutMs);
      try { this.send(msg); } catch (e) { off(); clearTimeout(t); reject(e); }
    });
  }

  on(l: (e: RemoteEvent) => void): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  onClose(l: (why: string) => void): () => void { this.closedL.add(l); return () => this.closedL.delete(l); }
  close(): void { this.open = false; this.listeners.clear(); try { this.ws.close(); } catch {} }
}

function parse(raw: unknown): RemoteEvent | undefined {
  try {
    const j = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw as ArrayBuffer).toString("utf8"));
    return typeof j?.event === "string" ? { event: j.event, data: j.data } : undefined;
  } catch { return undefined; }
}
