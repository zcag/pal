// Writes app/src/gallery/shots/bar-timer.json: the store screenshots'
// fixture for the bar item, its popover tree from view.ts over made-up
// timers (a running one near its end, one early, one paused) at a fixed
// clock, and the strip variants the shots pick. `bun run
// extensions/timer/fixture.ts`, then `node app/scripts/shots.mjs bar timer`.
import { writeFileSync } from "node:fs";
import { DEFAULT_RECENT, render, type PopoverState, type Timer } from "./view.ts";

/** 16 Sep 2026, 14:32 local: the strip's clock. */
const NOW = Math.floor(new Date(2026, 8, 16, 14, 32, 0).getTime() / 1000);
const t = (id: string, name: string, total: number, state: Timer["state"], leftOrAgo: number): Timer => ({
  id, name, total, state,
  deadline: state === "running" ? NOW + leftOrAgo : 0,
  left: state === "paused" ? leftOrAgo : 0,
  fired: state === "done" ? NOW - leftOrAgo : 0,
  auto: false,
});
const tea = t("tea", "tea", 1500, "running", 192);
const laundry = t("laundry", "laundry", 1500, "running", 1361);
const focus = t("focus", "focus", 3600, "paused", 2465);
const landed = t("eggs", "eggs", 420, "done", 35);

const state = (timers: Timer[], extra: Partial<PopoverState> = {}): PopoverState => ({ timers, cursor: timers[0]?.id, field: false, recent: DEFAULT_RECENT, now: NOW, ...extra });

const GLYPH = "\u{f0954}";
const bar = {
  key: "timer/timer",
  title: "Timer",
  item: { icon: GLYPH, title: "3:12", progress: 0.87, color: "amber", tooltip: "tea (+2 more)", menu: { view: render(state([tea, laundry, focus])) } },
  states: [
    { id: "early", item: { title: "22:41", progress: 0.09, color: "blue", tooltip: "laundry" } },
    { id: "late", item: { title: "0:48", progress: 0.97, color: "red", tooltip: "tea (+1 more)" } },
    { id: "paused", item: { title: "41:05", progress: 0.31, color: "muted", tooltip: "focus, paused" } },
    { id: "landed", item: { title: "eggs", progress: 1, color: null, urgent: true, tooltip: "eggs landed 0:35 ago (+3 more)", menu: { view: render(state([landed, tea, laundry, focus])) } } },
    // The field open (`n`), the last durations as tiles.
    { id: "new", item: { menu: { view: render(state([tea, laundry], { field: true, recent: ["25m", "7m", "1h", "90s"] })) } } },
  ],
  shots: {
    "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: what is left of the soonest timer, a fill under the glyph, amber past two thirds" },
    "bar-menubar-light": { target: "menubar", theme: "light", state: "landed", caption: "A timer that landed: the item turns into a red alarm with its name" },
    "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the popover: a card per timer with the time left and a bar, space pauses, + adds five minutes, backspace stops" },
    "bar-menubar-popover-dark": { target: "menubar", theme: "dark", popover: true, state: "landed", caption: "A landed timer on top, red and full; Enter dismisses it" },
    "bar-menubar-popover-new": { target: "menubar", theme: "light", popover: true, state: "new", caption: "n opens the field: 25m tea starts one, the last durations are a click away" },
    "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the fill as a rule of box-drawing cells before the glyph, the countdown as the label" },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/bar-timer.json", import.meta.url), JSON.stringify(bar) + "\n");
console.log("bar-timer.json: three timers, a landed state, the field open");
