// Snake II: a view palette whose body is the extension's own page
// (surface/index.html, a `surface` node): the Nokia 3310's screen, running
// the phone's rules (phone.ts, game.ts) and drawing its pixels (lcd.ts). The
// page keeps the phone's memory in the extension's storage (the level, the
// maze, the top score, a paused game and the random numbers' state). This
// side opens the page, answers whether this is a power-on (the first time
// the page asks since pal started: the phone's rand() starts again from 1
// then), and writes the tones setting the page's action flips.
import { settings, type Action, type Extension, type View } from "@zcag/pal";

const EXTENSION = "snake";

export const ACTIONS: Action[] = [{ id: "tones", title: "Game tones on or off", shortcut: "cmd+t" }];

let booted = false;

/** The page's messages: `{ boot: true }` answers `{ powerOn }` (once per pal session), `{ tones }` writes the setting. */
export async function message(msg: unknown): Promise<unknown> {
  const m = (msg ?? {}) as { boot?: unknown; tones?: unknown };
  if (m.boot === true) {
    const powerOn = !booted;
    booted = true;
    return { powerOn };
  }
  if (typeof m.tones === "boolean") {
    await settings.set("tones", m.tones, EXTENSION);
    return { tones: m.tones };
  }
  return undefined;
}

export default {
  palettes: {
    snake: {
      title: "Snake II",
      view: async (): Promise<View> => ({ tree: { type: "surface", src: "surface/index.html" }, actions: ACTIONS, title: "Snake II" }),
      /** The action reaches the page as `pal.onAction`, never here. */
      pick: () => {},
      onMessage: message,
    },
  },
} satisfies Extension;
