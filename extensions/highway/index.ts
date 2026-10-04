// Highway: a view palette whose body is the game's own page (surface/). The
// page keeps everything (the run, the save in the extension's storage), so
// this side only opens it. The actions reach the page as `pal.onAction`.
// Escape is the panel's: it leaves, and leaving pauses the run.
import type { Action, Extension, View } from "@zcag/pal";

export const ACTIONS: Action[] = [
  { id: "pause", title: "Pause or carry on", shortcut: "p" },
  { id: "mute", title: "Sound on or off", shortcut: "m" },
  { id: "give-up", title: "End the run", style: "destructive", confirm: "End this run? What you earned so far is paid." },
  { id: "start-over", title: "Start over", style: "destructive", confirm: "Start over from nothing? Your cars, cash, level and records are wiped; your settings stay." },
];

export default {
  palettes: {
    highway: {
      title: "Highway",
      view: async (): Promise<View> => ({ tree: { type: "surface", src: "surface/index.html" }, actions: ACTIONS, title: "Highway" }),
      pick: () => {},
    },
  },
} satisfies Extension;
