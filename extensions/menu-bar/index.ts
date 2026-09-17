// The front app's menu bar as a palette (Raycast's Search Menu Bar Items).
// Live: `core/menubar.items` walks the menus of the app in front every
// time the panel shows (pal's panel never takes the app's place, so the
// app behind it is the one read), one row per enabled leaf item: the
// item's title, the menus above it as the subtitle ("File > Export"), its
// shortcut as key caps, a check mark on a checked item, the app's icon on
// every row, and the top menu as the section, in menu order. The whole
// path is searchable (the segments are keywords). Enter presses the item:
// the core hides the panel first and presses the very element it listed
// (`menubar.press`), then the HUD says what was pressed; a press that
// fails says why there. A pick more than two seconds after the listing,
// or of an id it does not have (`pal run`, an item hotkey, the app in
// front changed), reads the menus once more first.
// macOS only, over Accessibility: elsewhere, and without the permission,
// the one row says so.
import { core, errorMessage, failed, hint, permissions, toast, xdg, type Accessory, type Effect, type Extension, type Item } from "@zcag/pal";

/** `pal_core::menubar::Item`. */
type MenuItem = { id: string; path: string[]; shortcut: string | null; checked: boolean };
/** `pal_core::menubar::Menu`: the app in front and its items. */
export type Menu = { app: string; bundle: string; pid: number; icon: string | null; items: MenuItem[]; truncated: boolean; elapsed_ms: number };

const MAC = process.platform === "darwin";
/** md-menu: the row glyph when the app has no icon. */
const MENU_GLYPH = "\u{f035c}";

const menubar = {
  items: () => core.call<Menu>("menubar.items"),
  press: (pid: number, id: string) => core.call<null>("menubar.press", { pid, id }),
};

/** What the last listing read, so a pick knows which app the row belongs to, and when. */
let current: Menu | null = null;
let listedAt = 0;
/** A pick this long after the listing reads the menus again: an item hotkey or `pal run` fires without a show, and the app in front may have changed. */
const FRESH_MS = 2000;

export function row(m: Menu, i: MenuItem): Item {
  const accessories: Accessory[] = [];
  if (i.checked) accessories.push({ text: "✓" });
  if (i.shortcut) accessories.push({ keys: i.shortcut });
  return {
    id: i.id,
    name: i.path[i.path.length - 1],
    subtitle: i.path.slice(0, -1).join(" > "),
    icon: m.icon ? { app: m.icon } : MENU_GLYPH,
    keywords: [...i.path.slice(0, -1), m.app],
    accessories,
    section: i.path[0],
    actions: [{ id: "press", title: "Press" }],
  };
}

const NEEDS_ACCESSIBILITY = /Accessibility/;

/** The one row when the menus cannot be read: the Accessibility ask, or what stands in the way. */
function problem(e: unknown): Item {
  const message = errorMessage(e);
  if (NEEDS_ACCESSIBILITY.test(message)) {
    return hint("accessibility", "Menu bar search needs Accessibility", "Grant pal in System Settings > Privacy & Security > Accessibility", { icon: xdg("dialog-warning")!, actions: [{ id: "open", title: "Open System Settings" }] });
  }
  return hint("unavailable", MAC ? "No menu bar to read" : "Menu bar search is macOS only", message.replace(/^menu bar unavailable: /, ""), { icon: xdg("dialog-error")! });
}

export default {
  palettes: {
    "menu-bar": {
      title: "Menu Bar Items",
      live: true,
      placeholder: "Search the front app's menus",
      list: async () => {
        try {
          current = await menubar.items();
          listedAt = Date.now();
        } catch (e) {
          current = null;
          return [problem(e)];
        }
        if (current.truncated) console.log(`menu-bar\t${current.app}\t${current.items.length} items in ${current.elapsed_ms} ms, deeper menus left out`);
        return current.items.map((i) => row(current!, i));
      },
      pick: async (id, action): Promise<Effect | void> => {
        if (id === "hint:unavailable") return { keep: true };
        if (id === "hint:accessibility") {
          try { await permissions.request("accessibility"); } catch (e) { return failed("open System Settings", e); }
          return { keep: true };
        }
        if (action != null && action !== "press") return;
        // A row from an older listing (an item hotkey, `pal run`, the app in front changed): read the menus once more, so the press lands in the app in front now.
        let m = current;
        let item = m?.items.find((i) => i.id === id);
        if (!item || Date.now() - listedAt > FRESH_MS) {
          try { current = m = await menubar.items(); listedAt = Date.now(); } catch { m = null; }
          item = m?.items.find((i) => i.id === id);
        }
        if (!m || !item) return toast("That menu is gone", "The app in front changed; the list is read again on the next show", "failure");
        // The core hides the panel before pressing, so a failure can only reach the HUD.
        try { await menubar.press(m.pid, id); } catch (e) { return { hud: `Could not press ${item.path[item.path.length - 1]}: ${errorMessage(e)}` }; }
        return { hud: `${m.app}: ${item.path.join(" > ")}` };
      },
    },
  },
} satisfies Extension;
