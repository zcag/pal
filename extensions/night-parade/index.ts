// Night Parade: a view palette whose body is the game's own page
// (surface/index.html). The page keeps everything (the night, the
// save in the extension's storage), so this side only opens it. The actions
// reach the page as `pal.onAction`, never here. Escape is the panel's
// (it leaves, and leaving pauses the night and stores it, so it opens paused
// next time); the page's back is Backspace.
import type { Action, Extension, View } from "@zcag/pal";

export const ACTIONS: Action[] = [
  { id: "pause", title: "Pause or carry on", shortcut: "enter" },
  { id: "mute", title: "Sound on or off", shortcut: "m" },
  { id: "give-up", title: "Give up the night", style: "destructive", confirm: "Give up this night? What you earned so far is kept." },
];

export default {
  palettes: {
    "night-parade": {
      title: "Night Parade",
      view: async (): Promise<View> => ({ tree: { type: "surface", src: "surface/index.html" }, actions: ACTIONS, title: "Night Parade" }),
      pick: () => {},
    },
  },
} satisfies Extension;
