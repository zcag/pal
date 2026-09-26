// Minesweeper: a view palette whose body is the extension's own page
// (surface/index.html, a `surface` node). The page runs the game: it
// imports the rules from game.ts, keeps the state whole in the extension's
// storage after every move (`pal.storage`, the same file `storage` reads
// here), and pauses the clock while the view is away. This side only opens
// the page, lists the moves for cmd+k (the page gets them as `pal.onAction`),
// and writes the difficulty the page's level picker chooses and the clock
// the page hides or shows, so the settings stay the ones the settings page
// shows.
import { settings, view, type Action, type Extension, type View, type ViewPalette } from "@zcag/pal";
import { LEVELS, type Level } from "./game.ts";

const EXTENSION = "minesweeper";

const clockShown = () => settings.get<{ clock?: boolean }>(EXTENSION).clock !== false;

export const actions = (clock = clockShown()): Action[] => [
  { id: "open", title: "Open", shortcut: "enter" },
  { id: "flag", title: "Flag", shortcut: ["/", "f", "space"] },
  { id: "new", title: "New game", shortcut: "n" },
  { id: "level", title: "Difficulty", shortcut: "d" },
  { id: "clock", title: clock ? "Hide the clock" : "Show the clock", shortcut: "t" },
];
const screen = (): View => ({ tree: { type: "surface", src: "surface/index.html" }, actions: actions(), title: "Minesweeper" });

/** The page's messages: `{ difficulty }` or `{ clock }` writes that setting and answers it as now set. */
export async function message(msg: unknown): Promise<unknown> {
  const m = (msg ?? {}) as { difficulty?: unknown; clock?: unknown };
  if (typeof m.clock === "boolean") {
    await settings.set("clock", m.clock, EXTENSION);
    await view.update(screen()).catch(() => {});
    return { clock: m.clock };
  }
  const level = m.difficulty;
  if (typeof level !== "string" || !(level in LEVELS)) return undefined;
  await settings.set("difficulty", level, EXTENSION);
  return { difficulty: level as Level };
}

const minesweeper: ViewPalette = {
  title: "Minesweeper",
  view: async () => screen(),
  /** The moves reach the page as `pal.onAction`, never here. */
  pick: () => {},
  onMessage: message,
};

export default { palettes: { minesweeper } } satisfies Extension;
