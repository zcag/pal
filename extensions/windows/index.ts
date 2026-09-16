// Window switcher over the core's windows capability. A live palette:
// `windows.list` runs every time the panel shows, so the rows are what is
// open right now, in the index (window titles are root results, as in
// Raycast), and the order is the desktop's (front to back on macOS, most
// recently focused first on Hyprland), never a ranking. Enter focuses (a
// `focus` effect: the panel hides, then the window comes up), the rest of
// the actions close or minimise without leaving the palette.
import { settings, windows, type Accessory, type Action, type Extension, type Item, type Window } from "@zcag/pal";

/** `[extensions.windows]`, defaults in pal.json. */
type Settings = { include_minimized: boolean };

const ACTIONS: Action[] = [
  { id: "focus", title: "Focus" },
  { id: "close", title: "Close", shortcut: "cmd+w", style: "destructive" },
  { id: "minimize", title: "Minimize", shortcut: "cmd+m" },
];

function item(w: Window): Item {
  const accessories: Accessory[] = [];
  if (w.minimized) accessories.push({ tag: "minimized" });
  else if (!w.on_screen) accessories.push({ text: w.workspace ? `ws ${w.workspace}` : "other space" });
  if (w.monitor) accessories.push({ text: w.monitor });
  return {
    id: w.id,
    name: w.title,
    subtitle: w.app,
    keywords: [w.bundle_or_class],
    icon: w.icon ? { app: w.icon } : "▢",
    accessories,
    actions: w.minimized ? ACTIONS.filter((a) => a.id !== "minimize") : ACTIONS,
  };
}

const failed = (what: string, e: unknown) => ({ keep: true as const, toast: { title: `Could not ${what} the window`, message: String((e as Error)?.message ?? e), style: "failure" as const } });

export default {
  palettes: {
    windows: {
      title: "Windows",
      icon: "▣",
      live: true,
      placeholder: "Switch to a window",
      list: async () => {
        const { include_minimized } = settings.get<Settings>();
        return (await windows.list()).filter((w) => include_minimized || !w.minimized).map(item);
      },
      pick: async (id, action) => {
        switch (action) {
          case "close":
            try { await windows.close(id); } catch (e) { return failed("close", e); }
            return { keep: true };
          case "minimize":
            try { await windows.minimize(id); } catch (e) { return failed("minimize", e); }
            return { keep: true };
          default:
            return { focus: id };
        }
      },
    },
  },
} satisfies Extension;
