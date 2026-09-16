// Window switcher over the core's windows capability. An input palette:
// `windows.list` runs on open and on every keystroke, so the rows are what
// is open right now and the order is the desktop's (front to back on
// macOS, most recently focused first on Hyprland), never a ranking. Enter
// focuses (a `focus` effect: the panel hides, then the window comes up),
// the rest of the actions close or minimise without leaving the palette.
import type { Accessory, Action, Extension, Item } from "../../host/src/protocol.ts";
import { settings, windows, type Window } from "../../host/src/api.ts";

/** `[extensions.windows]`, defaults in pal.json. */
type Settings = { include_minimized: boolean };

const ACTIONS: Action[] = [
  { id: "focus", title: "Focus" },
  { id: "close", title: "Close", shortcut: "cmd+w", style: "destructive" },
  { id: "minimize", title: "Minimize", shortcut: "cmd+m" },
];

/** Every word of the query somewhere in the app name or the title. */
function matches(w: Window, query: string): boolean {
  const hay = `${w.app} ${w.title} ${w.bundle_or_class}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

function item(w: Window): Item {
  const accessories: Accessory[] = [];
  if (w.minimized) accessories.push({ tag: "minimized", color: "secondary" });
  else if (!w.on_screen) accessories.push({ text: w.workspace ? `ws ${w.workspace}` : "other space" });
  if (w.monitor) accessories.push({ text: w.monitor });
  return {
    id: w.id,
    name: w.title,
    subtitle: w.app,
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
      input: true,
      placeholder: "Switch to a window",
      list: async (query = "") => {
        const minimized = settings.get<Partial<Settings>>().include_minimized ?? true;
        return (await windows.list()).filter((w) => (minimized || !w.minimized) && matches(w, query)).map(item);
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
