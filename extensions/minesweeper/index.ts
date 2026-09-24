// Minesweeper: a view palette whose body is the extension's own page
// (surface/index.html, a `surface` node). The page runs the game: it
// imports the rules from game.ts, keeps the state whole in the extension's
// storage after every move (`pal.storage`, the same file `storage` reads
// here), and pauses the clock while the view is away. This side only opens
// the page, lists the moves for cmd+k (the page gets them as `pal.onAction`),
// and writes the difficulty the page's level picker chooses, so the setting
// stays the one the settings page shows.
import { settings, type Action, type Extension, type ViewPalette } from "@zcag/pal";
import { LEVELS, type Level } from "./game.ts";

const EXTENSION = "minesweeper";

export const ACTIONS: Action[] = [
  { id: "open", title: "Open", shortcut: "enter" },
  { id: "flag", title: "Flag", shortcut: ["/", "f", "space"] },
  { id: "new", title: "New game", shortcut: "n" },
  { id: "level", title: "Difficulty", shortcut: "d" },
];

/** The page's messages: `{ difficulty }` writes the setting and answers the level now set. */
export async function message(msg: unknown): Promise<unknown> {
  const level = (msg as { difficulty?: unknown } | null)?.difficulty;
  if (typeof level !== "string" || !(level in LEVELS)) return undefined;
  await settings.set("difficulty", level, EXTENSION);
  return { difficulty: level as Level };
}

const minesweeper: ViewPalette = {
  title: "Minesweeper",
  view: async () => ({ tree: { type: "surface", src: "surface/index.html" }, actions: ACTIONS, title: "Minesweeper" }),
  /** The moves reach the page as `pal.onAction`, never here. */
  pick: () => {},
  onMessage: message,
};

export default { palettes: { minesweeper } } satisfies Extension;
