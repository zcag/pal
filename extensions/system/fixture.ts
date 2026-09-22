// Writes app/src/gallery/shots/bar-system.json: the store screenshots'
// fixture for the Keep Awake bar item, its popover tree from view.ts over
// a made-up run at a fixed clock, and the strip variants the shots pick.
// `bun run extensions/system/fixture.ts`, then `node app/scripts/shots.mjs
// bar system`.
import { writeFileSync } from "node:fs";
import type { Awake } from "./awake.ts";
import { DISPLAY_GLYPH, GLYPH, render, type PopoverState } from "./view.ts";

/** 16 Sep 2026, 14:32 local: the strip's clock. */
const NOW = new Date(2026, 8, 16, 14, 32, 0).getTime();
const run = (o: Partial<Awake> = {}): Awake => ({ pid: 4242, started: NOW - 35 * 60_000, until: NOW + 25 * 60_000, display: false, ...o });
const state = (awake: Awake | null, extra: Partial<PopoverState> = {}): PopoverState => ({ awake, now: NOW, presets: ["30m", "1h", "2h", "forever"], display: awake?.display ?? true, defaultFor: "1h", field: false, tool: true, ...extra });

const bar = {
  key: "system/awake",
  title: "Keep Awake",
  item: { icon: GLYPH, title: "25m", tooltip: "Awake until 14:57, 25 min left", menu: { view: render(state(run())) } },
  states: [
    { id: "forever", item: { title: "∞", tooltip: "Awake until turned off", menu: { view: render(state(run({ until: null, display: true }))) } } },
    { id: "display", item: { title: "1h 59m", segments: [{ id: "display", icon: DISPLAY_GLYPH, color: "muted", tooltip: "Display kept awake too" }], tooltip: "Awake until 16:31, 1 h 59 min left, display too", menu: { view: render(state(run({ until: NOW + 119 * 60_000, started: NOW - 60_000, display: true }))) } } },
    { id: "app", item: { title: "∞", tooltip: "Awake while Xcode runs", menu: { view: render(state(run({ until: null, app: "Xcode" }))) } } },
    { id: "ending", item: { title: "4m", color: "amber", tooltip: "Awake until 14:36, 4 min left", menu: { view: render(state(run({ until: NOW + 4 * 60_000 }))) } } },
    // Off: what `show = "always"` keeps, muted; the popover on the presets.
    { id: "off", item: { hidden: true, empty: { icon: GLYPH, tooltip: "Not kept awake" }, menu: { view: render(state(null)) } } },
    // The field open (`u`).
    { id: "field", item: { menu: { view: render(state(run(), { field: true })) } } },
  ],
  shots: {
    "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: a coffee and what is left of the run" },
    "bar-menubar-light": { target: "menubar", theme: "light", state: "display", caption: "The display kept awake too: a monitor mark after the countdown" },
    "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the popover: the run on a card with the time left and a bar, the presets on the digits, the display switch, Enter allows sleep" },
    "bar-menubar-popover-dark": { target: "menubar", theme: "dark", popover: true, state: "forever", caption: "Until turned off: ∞ on the strip and the card; a preset gives it an end" },
    "bar-menubar-popover-field": { target: "menubar", theme: "light", popover: true, state: "field", caption: "u opens the field: 45m, 14:30 or forever, then Enter" },
    "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the coffee and the countdown as the label" },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/bar-system.json", import.meta.url), JSON.stringify(bar) + "\n");
console.log("bar-system.json: a run with 25 minutes left, until turned off, the display too, an app to follow, the last minutes, off, the field open");
