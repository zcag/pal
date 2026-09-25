// Typing: a view palette whose tree is one `surface`, the page in surface/
// (the words, the caret, the result with its chart). The page runs the test
// with typing.ts, the part the host tests, and keeps the options and the
// records in the extension's storage. The extension's part is the view's
// actions (⌘K: a new test, the stats, every length and mode, the toggles and the settings) and the
// title, pushed again when the page says the options moved; an action
// picked from ⌘K goes to the page (`onAction`). The pace caret and stop on
// error are the extension's settings, so the Settings window shows them;
// the page asks for a ⌘K pick to be written (`{ set }`).
import { settings, storage, view, type Extension, type View, type ViewNode, type ViewPalette } from "@zcag/pal";
import { configOf, optionsOf, settingOf, titleOf, viewActions, type Config } from "./typing.ts";

const EXTENSION = "typing";

const TEST: ViewNode = { type: "surface", src: "surface/index.html", key: "test" };

const screen = (c: Config): View => ({ tree: TEST, actions: viewActions(c, optionsOf(settings.get(EXTENSION))), title: titleOf(c) });
const load = async () => configOf(await storage.get("config"));

const typing: ViewPalette = {
  title: "Typing",
  view: async () => screen(await load()),
  // A surface view's picks go to the page; nothing arrives here.
  pick: () => {},
  /**
   * `{ moved: true }` after the page saved the options or heard the settings change: the actions and the title
   * follow. `{ set: "pace:pb" }` (a ⌘K action's id) writes the setting it names first.
   */
  onMessage: async (msg) => {
    const m = msg as { moved?: boolean; set?: string } | null;
    const write = typeof m?.set === "string" ? settingOf(m.set) : undefined;
    if (write) await settings.set(write, EXTENSION);
    if (m?.moved || write) await view.update(screen(await load()));
  },
};

export default { palettes: { typing } } satisfies Extension;
