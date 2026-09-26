// Solitaire: a view palette whose body is the extension's own page
// (`surface/index.html`, the `surface` view node). The page runs the game:
// it draws the table from the pure state in game.ts, takes the mouse and
// the keys, persists the state in the extension's storage under `state`
// after every move (so Escape mid-game loses nothing and the record
// survives restarts), counts the clock only while it is shown and sets
// the title line. The extension answers the view (the node and the
// actions ⌘K lists, which the panel hands to the page, `pal.onAction`) and
// writes the `clock` setting when the page hides or shows the clock (T).
import { settings, view, type Action, type Extension, type View } from "@zcag/pal";

const EXTENSION = "solitaire";

const actions = (clock = settings.get<{ clock?: boolean }>(EXTENSION).clock !== false): Action[] => [
  { id: "draw", title: "Draw", shortcut: ["space", "d"] },
  { id: "undo", title: "Undo", shortcut: ["u", "backspace"] },
  { id: "finish", title: "Finish now" },
  { id: "new", title: "New game", shortcut: "n" },
  { id: "clock", title: clock ? "Hide the clock" : "Show the clock", shortcut: "t" },
];

const table = (): View => ({ tree: { type: "surface", src: "surface/index.html" }, actions: actions(), title: "Solitaire" });

export default {
  palettes: {
    solitaire: {
      title: "Solitaire",
      view: async () => table(),
      // Every action goes to the page (`pal.onAction`), none comes here.
      pick: () => {},
      /** `{ clock }` from the page: the setting written, the ⌘K title following it. */
      onMessage: async (msg) => {
        const clock = (msg as { clock?: unknown } | null)?.clock;
        if (typeof clock !== "boolean") return undefined;
        await settings.set("clock", clock, EXTENSION);
        await view.update(table()).catch(() => {});
        return { clock };
      },
    },
  },
} satisfies Extension;
