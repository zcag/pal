// Browser tabs (ported from v1's `tabs` palette, which shelled out to `bt`).
// Three sources, merged into one live listing: a Chromium browser with
// `--remote-debugging-port` open (cdp.ts: the tab list, a media probe per
// page for the playing/muted tags, and the window each tab is in), the
// scriptable browsers on macOS (Safari and Chrome over one `osascript`
// JavaScript run, so a Chrome without the port still lists), and Firefox's
// session file (read-only, so its tabs list but only its window can be
// raised). Enter focuses: the tab is selected inside the browser, then the
// browser window comes up through the `focus` effect so the panel hides
// first. Order is the browser's, never a ranking.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { home, settings, windows, type Accessory, type Action, type Extension, type Item, type Window } from "@zcag/pal";
import { Cdp, type Media, type Version } from "./cdp.ts";

/** `[extensions.browser-tabs]`, defaults in pal.json. */
type Settings = { port: number; apps: string[]; firefox: boolean; firefox_session: string };

type Source = "cdp" | "as" | "ff";
type Tab = { id: string; src: Source; browser: string; title: string; url: string; window: number; index: number; active: boolean; media?: Media };

const MAC = process.platform === "darwin";
const ICON = "◍";
const AUTOMATION_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";
/** One `osascript` run at most. */
const OSA_MS = 8000;

const FILTERS = [
  { id: "all", title: "All" },
  { id: "audible", title: "Audible" },
  { id: "window", title: "This window" },
];

const FOCUS: Action = { id: "focus", title: "Focus" };
const CLOSE: Action = { id: "close", title: "Close", shortcut: "cmd+w", style: "destructive" };
const COPY: Action = { id: "copy-url", title: "Copy URL", shortcut: "cmd+c" };
const MARKDOWN: Action = { id: "copy-markdown", title: "Copy as markdown link", shortcut: "cmd+shift+c" };
const mute = (muted: boolean): Action => ({ id: "mute", title: muted ? "Unmute" : "Mute", shortcut: "cmd+m" });

/** `/json/version`'s `Browser` to the app it is, for the window to raise and the AppleScript run to skip. */
function cdpApp(v: Version): string {
  const b = v.Browser;
  if (/^Brave/i.test(b)) return "Brave Browser";
  if (/^Edg/i.test(b)) return "Microsoft Edge";
  if (/^Chromium/i.test(b)) return "Chromium";
  if (/^Vivaldi/i.test(b)) return "Vivaldi";
  return "Google Chrome";
}

// ---- Chromium over the DevTools protocol ---------------------------------------

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
    const window = w === undefined ? 1 : order.get(w)!;
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

async function osascript(args: string[]): Promise<string> {
  const proc = Bun.spawn(["osascript", "-l", "JavaScript", "-e", JXA, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), OSA_MS);
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(err.trim() || `osascript exited ${code}`);
  return out.trim();
}

/** macOS asks once per app whether pal may control it; a refusal is error -1743 on every call after. */
const notAuthorized = (msg: string) => /-1743|not authori[sz]ed|Not permitted to send Apple events/i.test(msg);

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

// ---- rows -------------------------------------------------------------------------

const hostOf = (url: string) => { try { const u = new URL(url); return u.protocol.startsWith("http") ? u.host : url; } catch { return url; } };
const isWeb = (url: string) => /^https?:\/\//.test(url);
const appPath = (name: string) => [`/Applications/${name}.app`, home(`~/Applications/${name}.app`)].find((p) => existsSync(p));

function item(t: Tab, browsers: number, windowsOf: number): Item {
  const accessories: Accessory[] = [];
  if (browsers > 1) accessories.push({ text: t.browser });
  if (windowsOf > 1) accessories.push({ text: `window ${t.window}` });
  if (t.media?.audible) accessories.push({ tag: "playing", color: "green" });
  else if (t.media?.muted) accessories.push({ tag: "muted" });
  // Close is destructive, so it sits last (the brief) and never on cmd+enter.
  const actions = t.src === "cdp" ? [FOCUS, COPY, mute(!!t.media?.muted), MARKDOWN, CLOSE] : t.src === "as" ? [FOCUS, COPY, MARKDOWN, CLOSE] : [{ ...FOCUS, title: "Focus window" }, COPY, MARKDOWN];
  const app = MAC ? appPath(t.browser) : undefined;
  return {
    id: t.id,
    name: t.title || t.url.replace(/^https?:\/\//, ""),
    subtitle: hostOf(t.url),
    url: isWeb(t.url) ? t.url : undefined,
    icon: isWeb(t.url) ? undefined : app ? { app } : ICON,
    keywords: [t.url, hostOf(t.url), t.browser],
    accessories,
    actions,
  };
}

const hint = (id: string, name: string, subtitle: string, actions: Action[] = []): Item => ({ id, name, subtitle, icon: ICON, actions });

/** What `pick` needs per row, from the last listing. */
const table = new Map<string, Tab>();

async function list(filter = "all"): Promise<Item[]> {
  const s = settings.get<Settings>();
  const cdp = new Cdp(s.port);
  const [over, ff] = await Promise.all([cdpTabs(cdp), Promise.resolve().then(() => firefoxTabs(s)).catch((e) => { console.error("[browser-tabs] firefox:", String((e as Error)?.message ?? e)); return { tabs: [] as Tab[], front: 1 }; })]);
  const hints: Item[] = [];
  let scripted: Tab[] = [];
  try { scripted = await scriptTabs(s.apps.filter((a) => a !== over?.app)); } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    hints.push(notAuthorized(msg)
      ? hint("automation", "Automation permission needed", "pal may not control the browser yet: allow it under Privacy & Security, Automation", [{ id: "settings", title: "Open System Settings" }])
      : hint("osascript", "Could not ask the browsers", msg));
  }
  let tabs = [...(over?.tabs ?? []), ...scripted, ...ff.tabs];
  table.clear();
  for (const t of tabs) table.set(t.id, t);
  const total = tabs.length;
  const front = new Map<string, number>([...(over ? [[over.app, 1] as const] : []), ...s.apps.map((a) => [a, 1] as const), ["Firefox", ff.front] as const]);
  if (filter === "audible") tabs = tabs.filter((t) => t.media?.audible);
  if (filter === "window") tabs = tabs.filter((t) => t.window === (front.get(t.browser) ?? 1));
  const browsers = new Set(tabs.map((t) => t.browser)).size;
  const windowsOf = new Map<string, number>();
  for (const t of tabs) windowsOf.set(t.browser, Math.max(windowsOf.get(t.browser) ?? 0, t.window));
  if (tabs.length === 0 && hints.length === 0) {
    if (total > 0) return [hint("none", "No tabs match", filter === "audible" ? "No tab is playing sound" : "No tab is in the front window")];
    const where = MAC ? `none of ${s.apps.join(", ")} is running` : `start one with --remote-debugging-port=${s.port}`;
    return [hint("none", "No browser tabs", over ? `${over.app} on :${s.port} has none, and ${where}` : `Nothing listens on :${s.port}, and ${where}`)];
  }
  return [...hints, ...tabs.map((t) => item(t, browsers, windowsOf.get(t.browser) ?? 1))];
}

// ---- picks --------------------------------------------------------------------------

const CHROMIUM = /chrome|chromium|brave|edge|vivaldi|arc|thebrowser/i;

/** The OS window to raise for a tab: the browser's window carrying the tab's title, else its front one. */
function windowFor(t: Tab, all: Window[]): Window | undefined {
  const mine = all.filter((w) => w.app === t.browser || (t.src === "cdp" && CHROMIUM.test(w.bundle_or_class)));
  return mine.find((w) => t.title && (w.title === t.title || w.title.startsWith(t.title))) ?? mine[0];
}

const failed = (what: string, e: unknown) => ({ keep: true as const, toast: { title: `Could not ${what}`, message: String((e as Error)?.message ?? e), style: "failure" as const } });

async function focus(t: Tab, cdp: Cdp) {
  try {
    if (t.src === "cdp") {
      const id = t.id.slice(4);
      await cdp.activate(id);
      await cdp.bringToFront(id).catch(() => {});
    } else if (t.src === "as") await osascript(["focus", t.browser, String(t.window), String(t.index)]);
  } catch (e) { return failed("focus the tab", e); }
  const w = windowFor(t, await windows.list().catch(() => [] as Window[]));
  if (w) return { focus: w.id };
  if (t.src === "ff") return failed("find a Firefox window", new Error("no Firefox window is open"));
  return { hide: true as const };
}

export default {
  palettes: {
    tabs: {
      title: "Browser Tabs",
      icon: ICON,
      live: true,
      placeholder: "Switch to a tab",
      filters: FILTERS,
      list: (_query, ctx) => list(ctx?.filter),
      pick: async (id, action) => {
        if (id === "automation") return { open: AUTOMATION_URL };
        const t = table.get(id);
        if (!t) return { keep: true };
        const cdp = new Cdp(settings.get<Settings>().port);
        switch (action) {
          case "copy-url": return { copy: t.url };
          case "copy-markdown": return { copy: `[${t.title || t.url}](${t.url})` };
          case "close":
            try { t.src === "cdp" ? await cdp.close(t.id.slice(4)) : await osascript(["close", t.browser, String(t.window), String(t.index)]); } catch (e) { return failed("close the tab", e); }
            return { keep: true };
          case "mute":
            try { await cdp.mute(t.id.slice(4), !t.media?.muted); } catch (e) { return failed(t.media?.muted ? "unmute the tab" : "mute the tab", e); }
            return { keep: true };
          default: return focus(t, cdp);
        }
      },
    },
  },
} satisfies Extension;
