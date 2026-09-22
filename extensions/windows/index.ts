// Window switcher over the core's windows capability. A live palette:
// `windows.list` runs every time the panel shows, so the rows are what is
// open right now, in the index (window titles are root results, as in
// Raycast), and the order is the core's: most recently used first (macOS
// from pal's own focus history, Hyprland from the compositor's), never a
// ranking; the section is the app, so an app's windows sit together in
// the order its most recent window gives. Enter focuses (a `focus` effect:
// the panel hides, then the window comes up), the rest of the actions
// close or minimise, one window or the app's whole set, without leaving
// the palette; Hide app is macOS's hide, Show app undoes it.
//
// Spaces is the same capability one level up: a row per Space, workspace
// or desktop in the desktop's order, the apps on it as the subtitle and
// the icon of the one used there last; Enter brings it in front (a
// `space` effect: the panel hides, then on macOS a window there is raised
// and the desktop follows it, an empty space is reached with Mission
// Control's ctrl+arrows). `spaces` names the desktops by number, and a
// named space's row id is its name, so `item_hotkeys` read `term =
// "ctrl+alt+shift+a"`; "Previous space" (`last`) goes back to the space
// left most recently, a swipe counted too.
import { failed, settings, toast, windows, xdg, type Accessory, type Action, type Extension, type Item, type Window, type Workspace } from "@zcag/pal";

/** `[extensions.windows]`, defaults in pal.json. */
type Settings = { include_minimized: boolean; spaces: string[]; back_and_forth: boolean };

const MAC = process.platform === "darwin";
/** The row's glyph when the app has no artwork (md-window_maximize). */
const WINDOW_GLYPH = xdg("window-new")!;
/** A space with nothing on it (md-monitor). */
const SPACE_GLYPH = xdg("video-display")!;

/** The name `spaces` gives desktop `n` (1-based), else nothing. */
const named = (n: number | string | null | undefined) => {
  const i = Number(n);
  return Number.isInteger(i) && i > 0 ? settings.get<Settings>().spaces[i - 1] : undefined;
};

/** What the accessory calls the window's workspace: the desktop's name when it has one. */
const workspaceLabel = (ws: string) => named(ws) ?? ws;

/** The row title: the desktop's name, else the compositor's workspace name, else its number; a full-screen app's space is named by the app. */
function spaceTitle(s: Workspace, apps: string[]): string {
  if (s.fullscreen) return `${apps[0] ?? "Full screen"} (full screen)`;
  return named(s.index) ?? s.name ?? (MAC ? `Desktop ${s.index}` : `Workspace ${s.index}`);
}

/** The row id `item_hotkeys` key on: the desktop's name when it has one, else its number (a full-screen space its backend id, there is no name to give it). */
const spaceRowId = (s: Workspace) => (s.fullscreen ? `fs-${s.id}` : named(s.index) ?? String(s.index));

/** One `windows.list` per show, shared by the two palettes (each is listed on every show; the read is AX round trips). */
let listing: { at: number; rows: Promise<Window[]> } | undefined;
const SHARE_MS = 500;
function sharedList(): Promise<Window[]> {
  const now = Date.now();
  if (!listing || now - listing.at > SHARE_MS) listing = { at: now, rows: windows.list() };
  return listing.rows;
}

const GO: Action = { id: "go", title: "Go" };

function spaceItem(s: Workspace, all: Window[]): Item {
  const there = s.windows.map((id) => all.find((w) => w.id === id)).filter((w): w is Window => !!w);
  const apps = [...new Set(there.map((w) => w.app))];
  const accessories: Accessory[] = [];
  if (s.current) accessories.push({ tag: "current" });
  if (s.previous) accessories.push({ tag: "previous" });
  if (s.monitor) accessories.push({ text: s.monitor });
  const title = spaceTitle(s, apps);
  return {
    id: spaceRowId(s),
    name: title,
    subtitle: apps.join(" · ") || "Nothing open",
    keywords: ["space", "desktop", "workspace", String(s.index), ...apps],
    // The icon of the window used there last (`all` is most recently used first).
    icon: there[0]?.icon ? { app: there[0].icon } : SPACE_GLYPH,
    accessories,
    actions: [GO],
  };
}

const FOCUS: Action = { id: "focus", title: "Focus" };
// Close and minimize work on marked rows too (`multi`); focus is one window by nature.
const CLOSE: Action = { id: "close", title: "Close", shortcut: "cmd+w", style: "destructive", multi: true };
const MINIMIZE: Action = { id: "minimize", title: "Minimize", shortcut: "cmd+m", multi: true };
const HIDE_APP: Action = { id: "hide-app", title: "Hide app", shortcut: "cmd+h" };
const SHOW_APP: Action = { id: "show-app", title: "Show app", shortcut: "cmd+shift+h" };
const MINIMIZE_ALL: Action = { id: "minimize-all", title: "Minimize all of this app", shortcut: "cmd+shift+m" };
const CLOSE_ALL: Action = { id: "close-all", title: "Close all of this app", shortcut: "cmd+shift+w", style: "destructive", confirm: "Close every window of this app?" };

function item(w: Window, siblings: number): Item {
  const accessories: Accessory[] = [];
  // Hidden is its own state: a hidden app's windows are off screen too, but they are not on another space.
  if (w.hidden) accessories.push({ tag: "hidden" });
  else if (w.minimized) accessories.push({ tag: "minimized" });
  else if (!w.on_screen) accessories.push({ text: w.workspace ? `ws ${workspaceLabel(w.workspace)}` : "other space" });
  if (w.monitor) accessories.push({ text: w.monitor });
  return {
    id: w.id,
    name: w.title,
    subtitle: w.app,
    keywords: [w.bundle_or_class, w.app],
    icon: w.icon ? { app: w.icon } : WINDOW_GLYPH,
    accessories,
    section: w.app,
    actions: [FOCUS, CLOSE, ...(w.minimized ? [] : [MINIMIZE]), ...(MAC ? [w.hidden ? SHOW_APP : HIDE_APP] : []), ...(siblings > 1 ? [MINIMIZE_ALL, CLOSE_ALL] : [])],
  };
}


/** The app's windows: the same process, else the same bundle id or class. */
const sameApp = (w: Window, all: Window[]) => all.filter((x) => (w.pid ? x.pid === w.pid : x.bundle_or_class === w.bundle_or_class));

/** `System Events` hides by process, which needs Automation for pal once. */
async function hideApp(pid: number): Promise<void> {
  const proc = Bun.spawn(["osascript", "-e", `tell application "System Events" to set visible of (first process whose unix id is ${pid}) to false`], { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), 3000);
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(err.trim() || `osascript exited ${code}`);
}

export default {
  palettes: {
    windows: {
      title: "Windows",
      live: true,
      // Tab (and `x` with nothing typed) marks rows: windows are closed in batches.
      multi: true,
      placeholder: "Switch to a window",
      list: async () => {
        const { include_minimized } = settings.get<Settings>();
        const all = (await sharedList()).filter((w) => include_minimized || !w.minimized);
        return all.map((w) => item(w, sameApp(w, all).length));
      },
      pick: async (id, action, ctx) => {
        const many = action === "close-all" || action === "minimize-all";
        const all = many || action === "hide-app" ? await windows.list() : [];
        const w = all.find((x) => x.id === id);
        // The marked rows of a multi pick, else the one.
        const ids = ctx?.ids ?? [id];
        switch (action) {
          case "close":
            try { for (const i of ids) await windows.close(i); } catch (e) { return failed(ids.length === 1 ? "close the window" : "close every marked window", e); }
            return { keep: true };
          case "minimize":
            try { for (const i of ids) await windows.minimize(i); } catch (e) { return failed(ids.length === 1 ? "minimize the window" : "minimize every marked window", e); }
            return { keep: true };
          case "close-all":
          case "minimize-all": {
            const targets = w ? sameApp(w, all) : [];
            const close = action === "close-all";
            try { for (const t of targets) if (close || !t.minimized) await (close ? windows.close(t.id) : windows.minimize(t.id)); } catch (e) { return failed(`${close ? "close" : "minimize"} every window of ${w?.app ?? "the app"}`, e); }
            return { keep: true };
          }
          case "hide-app":
            if (!w) return failed("hide the app", "the window is gone");
            try { await hideApp(w.pid); } catch (e) { return failed(`hide ${w.app}`, e); }
            return { keep: true };
          // The app forward, unhidden, every window back: the panel hides as it comes up.
          case "show-app":
            try { await windows.activate(id); } catch (e) { return failed("show the app", e); }
            return {};
          default:
            return { focus: id };
        }
      },
    },
    spaces: {
      title: "Spaces",
      live: true,
      placeholder: "Switch to a space",
      list: async () => {
        const [spaces, all] = await Promise.all([windows.spaces(), sharedList()]);
        const rows = spaces.map((s) => spaceItem(s, all));
        const prev = spaces.find((s) => s.previous);
        rows.push({
          id: "last",
          name: "Previous space",
          subtitle: prev ? spaceTitle(prev, []) : "None yet",
          keywords: ["back", "toggle", "last"],
          icon: xdg("go-previous")!,
          actions: [GO],
        });
        return rows;
      },
      // Read again at the pick: a hotkey's id has to land on the space that is there now.
      pick: async (id) => {
        let spaces: Workspace[];
        try { spaces = await windows.spaces(); } catch (e) { return failed("list the spaces", e); }
        const previous = spaces.find((s) => s.previous);
        let target = id === "last" ? previous : spaces.find((s) => spaceRowId(s) === id);
        if (!target) return toast(id === "last" ? "No previous space" : `No space ${id}`, undefined, "failure");
        // A space's own key pressed on it goes back (Hyprland's `workspace_back_and_forth`).
        if (target.current && settings.get<Settings>().back_and_forth && previous) target = previous;
        return { space: target.id };
      },
    },
  },
} satisfies Extension;
