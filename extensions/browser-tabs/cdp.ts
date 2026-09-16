// A small Chrome DevTools Protocol client: the HTTP endpoints of a browser
// started with `--remote-debugging-port` (`/json` lists the tabs, `/json/
// activate` and `/json/close` act on one) and one browser-level WebSocket
// for what only the protocol proper does (a media probe in each page, mute,
// `Page.bringToFront`). Every request is id-multiplexed on the one socket,
// so a probe over fifty tabs is one round of concurrent calls. Chrome,
// Chromium, Brave, Edge, Vivaldi and Arc all speak it.

/** One entry of `/json`. */
export type Target = { id: string; type: string; title: string; url: string; webSocketDebuggerUrl?: string };
/** What `/json/version` says about the browser. */
export type Version = { Browser: string; "User-Agent"?: string; webSocketDebuggerUrl: string };
/** What the media probe finds in a page; absent when the page could not be asked. */
export type Media = { audible: boolean; muted: boolean; playing: boolean };

/** The probe run in each page: any media element playing, and whether every one is muted. */
const PROBE = `(()=>{const m=[...document.querySelectorAll('video,audio')];const live=m.filter(e=>!e.paused&&!e.ended&&e.readyState>2);return {playing:live.length>0,audible:live.some(e=>!e.muted&&e.volume>0),muted:m.length>0&&m.every(e=>e.muted)}})()`;
const MUTE = (on: boolean) => `[...document.querySelectorAll('video,audio')].forEach(e=>e.muted=${on});true`;

export class Cdp {
  constructor(readonly port: number, readonly host = "127.0.0.1") {}
  get base() { return `http://${this.host}:${this.port}`; }

  private async http<T>(path: string, ms: number, method = "GET"): Promise<T> {
    const r = await fetch(this.base + path, { method, signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    const text = await r.text();
    return (text.trim().startsWith("{") || text.trim().startsWith("[") ? JSON.parse(text) : text) as T;
  }

  /** `/json/version`, or undefined when nothing listens on the port. */
  async version(ms = 800): Promise<Version | undefined> {
    try { return await this.http<Version>("/json/version", ms); } catch { return undefined; }
  }

  /** The page targets in the browser's order (most recently used first), devtools pages left out. */
  async tabs(ms = 1500): Promise<Target[]> {
    const all = await this.http<Target[]>("/json", ms);
    return all.filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
  }

  /** Selects the tab in its window and raises that window inside the browser. */
  activate(id: string, ms = 1500) { return this.http<string>(`/json/activate/${id}`, ms); }
  close(id: string, ms = 1500) { return this.http<string>(`/json/close/${id}`, ms); }

  /** One socket for a batch of protocol calls; `fn` gets the session and the socket closes after. */
  async session<T>(fn: (s: Session) => Promise<T>, version?: Version): Promise<T> {
    const v = version ?? (await this.version());
    if (!v) throw new Error(`nothing listens on ${this.base}`);
    const s = await Session.open(v.webSocketDebuggerUrl);
    try { return await fn(s); } finally { s.close(); }
  }

  /** Media state per target id, for the tabs that answered within `ms`. */
  probe(ids: string[], ms = 1500, version?: Version): Promise<Map<string, Media>> {
    return this.session(async (s) => {
      const out = new Map<string, Media>();
      await Promise.all(ids.map(async (id) => { try { out.set(id, await s.evaluate<Media>(id, PROBE, ms)); } catch { /* discarded, crashed or slow: unknown */ } }));
      return out;
    }, version).catch(() => new Map<string, Media>());
  }

  /** The browser window (a protocol window id) of each target, for the tabs that answered. */
  windows(ids: string[], ms = 1500, version?: Version): Promise<Map<string, number>> {
    return this.session(async (s) => {
      const out = new Map<string, number>();
      await Promise.all(ids.map(async (id) => { try { out.set(id, (await s.call<{ windowId: number }>("Browser.getWindowForTarget", { targetId: id }, undefined, ms)).windowId); } catch { /* unknown */ } }));
      return out;
    }, version).catch(() => new Map<string, number>());
  }

  mute(id: string, on: boolean, ms = 2000) { return this.session((s) => s.evaluate<boolean>(id, MUTE(on), ms)); }
  bringToFront(id: string, ms = 2000) { return this.session((s) => s.attached(id, (sid) => s.call("Page.bringToFront", {}, sid, ms))); }
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

/** The browser-level socket with flattened per-target sessions. */
export class Session {
  private seq = 0;
  private pending = new Map<number, Pending>();
  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.id === undefined) return; // an event
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      msg.error ? p.reject(new Error(msg.error.message ?? "protocol error")) : p.resolve(msg.result);
    };
    ws.onclose = () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("socket closed")); } this.pending.clear(); };
  }

  static open(url: string, ms = 1500): Promise<Session> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => { ws.close(); reject(new Error("socket did not open")); }, ms);
      ws.onopen = () => { clearTimeout(timer); resolve(new Session(ws)); };
      ws.onerror = () => { clearTimeout(timer); reject(new Error(`could not connect to ${url}`)); };
    });
  }

  call<T = unknown>(method: string, params: unknown = {}, sessionId?: string, ms = 1500): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, ms);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  /** Attach to a target, run `fn` with the session id, detach. */
  async attached<T>(targetId: string, fn: (sessionId: string) => Promise<T>, ms = 1500): Promise<T> {
    const { sessionId } = await this.call<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true }, undefined, ms);
    try { return await fn(sessionId); } finally { this.call("Target.detachFromTarget", { sessionId }, undefined, 500).catch(() => {}); }
  }

  /** `Runtime.evaluate` of `expression` in the page, by value. */
  evaluate<T>(targetId: string, expression: string, ms = 1500): Promise<T> {
    return this.attached(targetId, async (sid) => {
      const r = await this.call<{ result?: { value?: T }; exceptionDetails?: { text?: string } }>("Runtime.evaluate", { expression, returnByValue: true }, sid, ms);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? "page threw");
      return r.result?.value as T;
    }, ms);
  }

  close() { try { this.ws.close(); } catch { /* already */ } }
}
