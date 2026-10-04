// Vortex: a view palette whose body is the game's own page (surface/index.html).
// The page keeps everything (the run, the save in the extension's storage), so
// this side only opens it. The actions reach the page as `pal.onAction`, never
// here. Escape is the panel's (it leaves, and leaving pauses a run); the
// page's back is Backspace.
import type { Action, Extension, View } from "@zcag/pal";

export const ACTIONS: Action[] = [
  { id: "play", title: "Play, or play again", shortcut: "space" },
  { id: "mute", title: "Sound on or off", shortcut: "m" },
  { id: "stages", title: "Back to the stages", shortcut: "backspace" },
];

export default {
  palettes: {
    vortex: {
      title: "Vortex",
      view: async (): Promise<View> => ({ tree: { type: "surface", src: "surface/index.html" }, actions: ACTIONS, title: "Vortex" }),
      pick: () => {},
    },
  },
} satisfies Extension;
