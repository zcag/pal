// Browser tabs: the SDK's `tabs` (a Chromium browser over the DevTools
// port, Safari and Chrome over AppleScript on macOS, Firefox's session
// file) as one live listing. Enter focuses: the tab is selected inside the
// browser, then the browser window comes up through the `focus` effect so
// the panel hides first. Order is the browser's, never a ranking.
import { existsSync } from "node:fs";
import { failed, hint, home, settings, tabs, type Accessory, type Action, type Extension, type Item } from "@zcag/pal";

const EXT = "browser-tabs";
const MAC = process.platform === "darwin";
const ICON = "◍";
const AUTOMATION_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

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

// ---- rows -------------------------------------------------------------------------

const hostOf = (url: string) => { try { const u = new URL(url); return u.protocol.startsWith("http") ? u.host : url; } catch { return url; } };
const isWeb = (url: string) => /^https?:\/\//.test(url);
const appPath = (name: string) => [`/Applications/${name}.app`, home(`~/Applications/${name}.app`)].find((p) => existsSync(p));

function item(t: tabs.Tab, browsers: number, windowsOf: number): Item {
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

const row = (id: string, name: string, subtitle: string, actions: Action[] = []): Item => hint(id, name, subtitle, { icon: ICON, actions });

async function list(filter = "all"): Promise<Item[]> {
  const s = settings.get<tabs.Settings>(EXT);
  const { tabs: every, over, front, scriptError } = await tabs.gather(s);
  const hints: Item[] = [];
  if (scriptError) hints.push(scriptError.automation
    ? row("automation", "Automation permission needed", "pal may not control the browser yet: allow it under Privacy & Security, Automation", [{ id: "settings", title: "Open System Settings" }])
    : row("osascript", "Could not ask the browsers", scriptError.message));
  let list = every;
  const total = list.length;
  if (filter === "audible") list = list.filter((t) => t.media?.audible);
  if (filter === "window") list = list.filter((t) => t.window === (front.get(t.browser) ?? 1));
  const browsers = new Set(list.map((t) => t.browser)).size;
  const windowsOf = new Map<string, number>();
  for (const t of list) windowsOf.set(t.browser, Math.max(windowsOf.get(t.browser) ?? 0, t.window));
  if (list.length === 0 && hints.length === 0) {
    if (total > 0) return [row("none", "No tabs match", filter === "audible" ? "No tab is playing sound" : "No tab is in the front window")];
    const where = MAC ? `none of ${s.apps.join(", ")} is running` : `start one with --remote-debugging-port=${s.port}`;
    return [row("none", "No browser tabs", over ? `${over.app} on :${s.port} has none, and ${where}` : `Nothing listens on :${s.port}, and ${where}`)];
  }
  return [...hints, ...list.map((t) => item(t, browsers, windowsOf.get(t.browser) ?? 1))];
}

export default {
  palettes: {
    tabs: {
      title: "Browser Tabs",
      live: true,
      placeholder: "Switch to a tab",
      filters: FILTERS,
      list: (_query, ctx) => list(ctx?.filter),
      pick: async (id, action) => {
        if (id === "hint:automation") return { open: AUTOMATION_URL };
        const t = tabs.known(id);
        if (!t) return { keep: true };
        switch (action) {
          case "copy-url": return { copy: t.url };
          case "copy-markdown": return { copy: `[${t.title || t.url}](${t.url})` };
          case "close":
            try { await tabs.close(t); } catch (e) { return failed("close the tab", e); }
            return { keep: true };
          case "mute":
            try { await tabs.mute(t, !t.media?.muted); } catch (e) { return failed(t.media?.muted ? "unmute the tab" : "mute the tab", e); }
            return { keep: true };
          default: return tabs.focus(t);
        }
      },
    },
  },
} satisfies Extension;
