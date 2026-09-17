// The browsers' open tabs, for the browser-tabs palette and any extension
// that names or raises one (quicklinks: a Create form filled from the tab
// in front, a link that prefers a tab already open). Three sources merged
// into one listing: a Chromium browser with `--remote-debugging-port` open
// (the `Cdp` client below: the tab list, a media probe per page for the
// playing/muted tags, and the window each tab is in), the scriptable
// browsers on macOS (Safari and Chrome over one `osascript` JavaScript run,
// so a Chrome without the port still lists), and Firefox's session file
// (read-only, so its tabs list but only its window can be raised). Order is
// the browser's, never a ranking. The port, the apps and the Firefox file
// are the `browser-tabs` extension's settings, read here by that name
// whoever the caller is. `tabs` on `@zcag/pal`.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { home, settings, windows, type Window } from "./api.ts";
import { run } from "./exec.ts";
import { failed } from "./rows.ts";
import { errorMessage } from "./text.ts";

/** `[extensions.browser-tabs]`, defaults in its pal.json. */
export type Settings = { port: number; apps: string[]; firefox: boolean; firefox_session: string };
const EXT = "browser-tabs";
const conf = () => settings.get<Settings>(EXT);

export type Source = "cdp" | "as" | "ff";
export type Tab = { id: string; src: Source; browser: string; title: string; url: string; window: number; index: number; active: boolean; media?: Media };
/** A web tab another extension may name or raise: what `find` and `active` answer and `focus` takes. */
export type OpenTab = { id: string; title: string; url: string; browser: string };

const MAC = process.platform === "darwin";
/** The most a caller from another extension waits for the tab in front (the Create form is on its way up). */
const ACTIVE_MS = 400;
/** One `osascript` run at most. */
const OSA_MS = 8000;

// ---- Chromium over the DevTools protocol ---------------------------------------
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
class Session {
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

/** `/json/version`'s `Browser` to the app it is, for the window to raise and the AppleScript run to skip. */
function cdpApp(v: Version): string {
  const b = v.Browser;
  if (/^Brave/i.test(b)) return "Brave Browser";
  if (/^Edg/i.test(b)) return "Microsoft Edge";
  if (/^Chromium/i.test(b)) return "Chromium";
  if (/^Vivaldi/i.test(b)) return "Vivaldi";
  return "Google Chrome";
}

async function cdpTabs(cdp: Cdp): Promise<{ tabs: Tab[]; app: string } | undefined> {
  const v = await cdp.version();
  if (!v) return undefined;
  const app = cdpApp(v);
  let targets;
  try { targets = await cdp.tabs(); } catch { return { tabs: [], app }; }
  const ids = targets.map((t) => t.id);
  const [media, wins] = await Promise.all([cdp.probe(ids, 1500, v), cdp.windows(ids, 1500, v)]);
  // Protocol window ids are large integers; number them by first appearance, the front tab's window first.
  const order = new Map<number, number>();
  for (const id of ids) { const w = wins.get(id); if (w !== undefined && !order.has(w)) order.set(w, order.size + 1); }
  const perWindow = new Map<number, number>();
  const tabs = targets.map((t, i): Tab => {
    const w = wins.get(t.id);
    const window = w === undefined ? 1 : order.get(w) ?? 1;
    const index = (perWindow.get(window) ?? 0) + 1;
    perWindow.set(window, index);
    return { id: `cdp:${t.id}`, src: "cdp", browser: app, title: t.title, url: t.url, window, index, active: i === 0, media: media.get(t.id) };
  });
  return { tabs, app };
}

// ---- Safari and Chrome over AppleScript (JavaScript for Automation) --------------

/** `osascript -l JavaScript`: `list <app>...` answers `{ app: [tab...] }`; `focus`/`close` take `<app> <window> <tab>`. */
const JXA = `
function run(argv) {
  const [mode, ...rest] = argv;
  if (mode === "list") {
    const out = {};
    for (const name of rest) {
      let app;
      try { app = Application(name); if (!app.running()) continue; } catch (e) { continue; }
      const tabs = [];
      const wins = app.windows();
      for (let w = 0; w < wins.length; w++) {
        const win = wins[w];
        let active = -1;
        try { active = win.activeTabIndex(); } catch (e) { try { active = win.currentTab().index(); } catch (e2) {} }
        const ts = win.tabs();
        for (let t = 0; t < ts.length; t++) {
          const tab = ts[t];
          let title = ""; try { title = tab.title() || ""; } catch (e) { try { title = tab.name() || ""; } catch (e2) {} }
          let url = ""; try { url = tab.url() || ""; } catch (e) {}
          tabs.push({ window: w + 1, index: t + 1, title, url, active: active === t + 1 });
        }
      }
      out[name] = tabs;
    }
    return JSON.stringify(out);
  }
  const [name, w, t] = rest;
  const app = Application(name);
  const win = app.windows[Number(w) - 1];
  if (mode === "focus") {
    try { win.activeTabIndex = Number(t); } catch (e) { win.currentTab = win.tabs[Number(t) - 1]; }
    win.index = 1;
    app.activate();
    return "ok";
  }
  if (mode === "close") { win.tabs[Number(t) - 1].close(); return "ok"; }
  throw new Error("unknown mode " + mode);
}`;

const osascript = async (args: string[]): Promise<string> => (await run(["osascript", "-l", "JavaScript", "-e", JXA, ...args], { ms: OSA_MS })).trim();

/** macOS asks once per app whether pal may control it; a refusal is error -1743 on every call after. */
export const notAuthorized = (msg: string) => /-1743|not authori[sz]ed|Not permitted to send Apple events/i.test(msg);

async function scriptTabs(apps: string[]): Promise<Tab[]> {
  if (!MAC || apps.length === 0) return [];
  const out = JSON.parse((await osascript(["list", ...apps])) || "{}") as Record<string, { window: number; index: number; title: string; url: string; active: boolean }[]>;
  const tabs: Tab[] = [];
  for (const app of apps) for (const t of out[app] ?? []) tabs.push({ id: `as:${app}:${t.window}:${t.index}`, src: "as", browser: app, title: t.title, url: t.url, window: t.window, index: t.index, active: t.active });
  return tabs;
}

// ---- Firefox from its session store --------------------------------------------

/** LZ4 block format, as Firefox's `mozLz40\0` files wrap it (a 4-byte LE size after the magic). */
export function lz4Block(src: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let i = 0, o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) { let b: number; do { b = src[i++]; lit += b; } while (b === 255); }
    out.set(src.subarray(i, i + lit), o);
    i += lit; o += lit;
    if (i >= src.length) break;
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = (token & 15) + 4;
    if ((token & 15) === 15) { let b: number; do { b = src[i++]; len += b; } while (b === 255); }
    for (let from = o - offset, k = 0; k < len; k++) out[o++] = out[from++];
  }
  return out.subarray(0, o);
}

export function mozlz4(file: string): string {
  const buf = readFileSync(file);
  if (buf.subarray(0, 8).toString("latin1") !== "mozLz40\0") throw new Error(`${file}: not a mozlz4 file`);
  return new TextDecoder().decode(lz4Block(buf.subarray(12), buf.readUInt32LE(8)));
}

const FF_ROOTS = MAC ? ["~/Library/Application Support/Firefox/Profiles"] : ["~/.mozilla/firefox", "~/snap/firefox/common/.mozilla/firefox", "~/.var/app/org.mozilla.firefox/.mozilla/firefox"];

/** The newest `recovery.jsonlz4` across the profiles, or undefined. */
function firefoxSession(setting: string): string | undefined {
  if (setting) return existsSync(home(setting)) ? home(setting) : undefined;
  let best: { file: string; at: number } | undefined;
  for (const root of FF_ROOTS.map(home)) {
    let dirs: string[];
    try { dirs = readdirSync(root); } catch { continue; }
    for (const d of dirs) {
      const file = join(root, d, "sessionstore-backups", "recovery.jsonlz4");
      try { const at = statSync(file).mtimeMs; if (!best || at > best.at) best = { file, at }; } catch { /* not a profile */ }
    }
  }
  return best?.file;
}

type FfSession = { windows?: { tabs?: { index?: number; entries?: { url?: string; title?: string }[] }[]; selected?: number }[]; selectedWindow?: number };

function firefoxTabs(s: Settings): { tabs: Tab[]; front: number } {
  const tabs: Tab[] = [];
  if (!s.firefox) return { tabs, front: 1 };
  const file = firefoxSession(s.firefox_session);
  if (!file) return { tabs, front: 1 };
  const session = JSON.parse(mozlz4(file)) as FfSession;
  (session.windows ?? []).forEach((w, wi) => (w.tabs ?? []).forEach((t, ti) => {
    const entry = t.entries?.[(t.index ?? t.entries?.length ?? 1) - 1];
    if (!entry?.url) return;
    tabs.push({ id: `ff:${wi + 1}:${ti + 1}`, src: "ff", browser: "Firefox", title: entry.title ?? "", url: entry.url, window: wi + 1, index: ti + 1, active: (w.selected ?? 1) === ti + 1 });
  }));
  return { tabs, front: session.selectedWindow ?? 1 };
}

// ---- the listing ------------------------------------------------------------------

/** What `pick`-time operations need per tab, from the last `gather`. */
const table = new Map<string, Tab>();

export type Gathered = {
  tabs: Tab[];
  /** The DevTools browser, when one answered on the port. */
  over?: { app: string };
  /** Each browser's front window number. */
  front: Map<string, number>;
  /** The AppleScript run failed: `automation` when macOS refused pal control of the app, else the error's text. */
  scriptError?: { automation: boolean; message: string };
};

/** What the three sources answer right now (the operations' table refreshed): every tab, the DevTools browser's name, each browser's front window, and why the scripted browsers could not be asked. */
export async function gather(s: Settings = conf()): Promise<Gathered> {
  const cdp = new Cdp(s.port);
  const [over, ff] = await Promise.all([cdpTabs(cdp), Promise.resolve().then(() => firefoxTabs(s)).catch((e) => { console.error("[browser-tabs] firefox:", errorMessage(e)); return { tabs: [] as Tab[], front: 1 }; })]);
  let scripted: Tab[] = [];
  let scriptError: Gathered["scriptError"];
  try { scripted = await scriptTabs(s.apps.filter((a) => a !== over?.app)); } catch (e) {
    const message = errorMessage(e);
    scriptError = { automation: notAuthorized(message), message };
  }
  const tabs = [...(over?.tabs ?? []), ...scripted, ...ff.tabs];
  table.clear();
  for (const t of tabs) table.set(t.id, t);
  const front = new Map<string, number>([...(over ? [[over.app, 1] as const] : []), ...s.apps.map((a) => [a, 1] as const), ["Firefox", ff.front] as const]);
  return { tabs, over: over && { app: over.app }, front, scriptError };
}

/** The tab of the last `gather` with this id, for a pick. */
export const known = (id: string): Tab | undefined => table.get(id);

const isWeb = (url: string) => /^https?:\/\//.test(url);
const openTab = (t: Tab): OpenTab => ({ id: t.id, title: t.title, url: t.url, browser: t.browser });

/**
 * The tab in front: the DevTools browser's first target (its most recently
 * used), else the active tab of the scripted browsers' front window, else
 * Firefox's. Answers within `ms` or not at all (the sources keep running
 * and are dropped), and never throws: a form must not wait on a browser.
 */
export async function active(ms = ACTIVE_MS): Promise<OpenTab | undefined> {
  const pick = gather().then(({ tabs, front }) => tabs.find((t) => t.active && t.window === (front.get(t.browser) ?? 1) && isWeb(t.url))).catch(() => undefined);
  return Promise.race([pick, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]).then((t) => t && openTab(t));
}

/** `url` without its query and fragment, the trailing slash dropped: what two tabs share when they are the same page. */
export function samePage(url: string): string {
  try { const u = new URL(url); return `${u.origin}${u.pathname.replace(/\/+$/, "")}`.toLowerCase(); } catch { return url.trim().toLowerCase(); }
}

/** An open tab on `url`'s page (`samePage`), the front one first; undefined when none or no browser answers. */
export async function find(url: string): Promise<OpenTab | undefined> {
  const want = samePage(url);
  const { tabs } = await gather().catch(() => ({ tabs: [] as Tab[] }));
  const hit = tabs.find((t) => t.active && samePage(t.url) === want) ?? tabs.find((t) => samePage(t.url) === want);
  return hit && openTab(hit);
}

// ---- the operations ----------------------------------------------------------------

const CHROMIUM = /chrome|chromium|brave|edge|vivaldi|arc|thebrowser/i;

/** The OS window to raise for a tab: the browser's window carrying the tab's title, else its front one. */
function windowFor(t: Tab, all: Window[]): Window | undefined {
  const mine = all.filter((w) => w.app === t.browser || (t.src === "cdp" && CHROMIUM.test(w.bundle_or_class)));
  return mine.find((w) => t.title && (w.title === t.title || w.title.startsWith(t.title))) ?? mine[0];
}

/** Raises the tab as Enter on its row would: selected inside the browser, then the browser window through the `focus` effect (so the panel hides first); a failure toast when it is gone or the browser refused. */
export async function focus(tab: { id: string }) {
  const t = table.get(tab.id);
  if (!t) return failed("focus the tab", "the tab is gone");
  try {
    if (t.src === "cdp") {
      const cdp = new Cdp(conf().port);
      const id = t.id.slice(4);
      await cdp.activate(id);
      await cdp.bringToFront(id).catch(() => {});
    } else if (t.src === "as") await osascript(["focus", t.browser, String(t.window), String(t.index)]);
  } catch (e) { return failed("focus the tab", e); }
  const w = windowFor(t, await windows.list().catch(() => [] as Window[]));
  if (w) return { focus: w.id };
  if (t.src === "ff") return failed("find a Firefox window", "no Firefox window is open");
  return { hide: true as const };
}

/** Closes the tab in its browser (DevTools or AppleScript; a Firefox tab cannot be). Throws with the browser's reason. */
export async function close(t: Tab): Promise<void> {
  if (t.src === "cdp") await new Cdp(conf().port).close(t.id.slice(4));
  else if (t.src === "as") await osascript(["close", t.browser, String(t.window), String(t.index)]);
  else throw new Error("a Firefox tab can only be closed in Firefox");
}

/** Mutes or unmutes every media element in a DevTools tab. */
export async function mute(t: Tab, on: boolean): Promise<void> {
  if (t.src !== "cdp") throw new Error("only a DevTools tab can be muted");
  await new Cdp(conf().port).mute(t.id.slice(4), on);
}
