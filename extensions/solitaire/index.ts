// Solitaire: a view palette whose body is the extension's own page
// (`surface/index.html`, the `surface` view node). The page runs the game:
// it draws the table from the pure state in game.ts, takes the mouse and
// the keys, persists the state in the extension's storage under `state`
// after every move (so Escape mid-game loses nothing and the record
// survives restarts), counts the clock only while it is shown and sets
// the title line. The extension answers only the view: the node and the
// actions ⌘K lists, which the panel hands to the page (`pal.onAction`).
import type { Action, Extension, View } from "@zcag/pal";

const ACTIONS: Action[] = [
  { id: "draw", title: "Draw", shortcut: ["space", "d"] },
  { id: "undo", title: "Undo", shortcut: ["u", "backspace"] },
  { id: "finish", title: "Finish now" },
  { id: "new", title: "New game", shortcut: "n" },
];

const TABLE: View = { tree: { type: "surface", src: "surface/index.html" }, actions: ACTIONS, title: "Solitaire" };

export default {
  palettes: {
    solitaire: {
      title: "Solitaire",
      view: async () => TABLE,
      // Every action goes to the page (`pal.onAction`), none comes here.
      pick: () => {},
    },
  },
} satisfies Extension;
