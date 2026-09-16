// Window switcher over the core's windows capability. A live palette:
// `windows.list` runs every time the panel shows, so the rows are what is
// open right now, in the index (window titles are root results, as in
// Raycast), and the order is the desktop's (front to back on macOS, most
// recently focused first on Hyprland), never a ranking; the section is the
// app, so an app's windows sit together in the order its front window
// gives. Enter focuses (a `focus` effect: the panel hides, then the window
// comes up), the rest of the actions close or minimise, one window or the
// app's whole set, without leaving the palette; Hide app is macOS's hide.
import { settings, windows, xdg, type Accessory, type Action, type Extension, type Item, type Window } from "@zcag/pal";

/** `[extensions.windows]`, defaults in pal.json. */
type Settings = { include_minimized: boolean };

const MAC = process.platform === "darwin";
/** The row's glyph when the app has no artwork (md-window_maximize). */
const WINDOW_GLYPH = xdg("window-new")!;

const FOCUS: Action = { id: "focus", title: "Focus" };
// Close and minimize work on marked rows too (`multi`); focus is one window by nature.
const CLOSE: Action = { id: "close", title: "Close", shortcut: "cmd+w", style: "destructive", multi: true };
const MINIMIZE: Action = { id: "minimize", title: "Minimize", shortcut: "cmd+m", multi: true };
const HIDE_APP: Action = { id: "hide-app", title: "Hide app", shortcut: "cmd+h" };
const MINIMIZE_ALL: Action = { id: "minimize-all", title: "Minimize all of this app", shortcut: "cmd+shift+m" };
const CLOSE_ALL: Action = { id: "close-all", title: "Close all of this app", shortcut: "cmd+shift+w", style: "destructive", confirm: "Close every window of this app?" };

function item(w: Window, siblings: number): Item {
  const accessories: Accessory[] = [];
  if (w.minimized) accessories.push({ tag: "minimized" });
  else if (!w.on_screen) accessories.push({ text: w.workspace ? `ws ${w.workspace}` : "other space" });
  if (w.monitor) accessories.push({ text: w.monitor });
  return {
    id: w.id,
    name: w.title,
    subtitle: w.app,
    keywords: [w.bundle_or_class, w.app],
    icon: w.icon ? { app: w.icon } : WINDOW_GLYPH,
    accessories,
    section: w.app,
    actions: [FOCUS, CLOSE, ...(w.minimized ? [] : [MINIMIZE]), ...(MAC ? [HIDE_APP] : []), ...(siblings > 1 ? [MINIMIZE_ALL, CLOSE_ALL] : [])],
  };
}

const failed = (what: string, e: unknown) => ({ keep: true as const, toast: { title: `Could not ${what}`, message: String((e as Error)?.message ?? e), style: "failure" as const } });

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
        const all = (await windows.list()).filter((w) => include_minimized || !w.minimized);
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
          default:
            return { focus: id };
        }
      },
    },
  },
} satisfies Extension;
