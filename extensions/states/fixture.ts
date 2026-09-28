// Writes app/src/gallery/shots/states.json and bar-states.json, the store
// screenshots' fixtures: the palette and the bar item through the host
// harness over a made-up states table standing in for the core's
// (`core/states.*`, as host/test/extensions/states.test.ts does): a few
// declared states (one on an expression, one held by hand for a while), a
// publisher's, the built-ins at the fixed clock. `bun run
// extensions/states/fixture.ts`, then `make shots EXT=states`.
import { Host } from "../../host/test/harness.ts";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { StateEntry } from "../../sdk/src/protocol.ts";
import manifest from "./pal.json" with { type: "json" };

pinClock();
const min = 60_000;
const mine = (name: string, value: StateEntry["value"], o: Partial<StateEntry> = {}): StateEntry => ({ name, value, source: "default", declared: true, builtin: false, ...o });
const builtin = (name: string, value: StateEntry["value"]): StateEntry => ({ name, value, source: { published: "builtin" }, declared: false, builtin: true });
const table = (held: StateEntry[] = []): StateEntry[] => [
  mine("working", true, { source: "expr", expr: `hour >= 9 and hour < 18 and weekday not in ["sat", "sun"]`, description: "On the clock: the work items show" }),
  mine("focus", false, { description: "Deep work: the chat and mail items hide" }),
  mine("office", true, { source: "expr", expr: `network == "Harbor 5G"`, description: "At the office, by its Wi-Fi" }),
  mine("quiet", false, { source: "expr", expr: "hour >= 22 or hour < 8", description: "Quiet hours: no sounds from the bar" }),
  mine("travel", false, { description: "On the road: the calendar item shows the zone" }),
  { name: "sessions/working", value: 2, source: { published: "sessions" }, declared: false, builtin: false },
  builtin("hour", 14), builtin("minute", 32), builtin("weekday", "wed"), builtin("date", "2026-09-16"),
  builtin("front_app", "com.microsoft.VSCode"), builtin("network", "Harbor 5G"), builtin("theme", "light"), builtin("idle", 4), builtin("locked", false), builtin("panel", true),
].map((e) => held.find((h) => h.name === e.name) ?? e);

// Focus held by hand for a while, quiet forced on over its expression until reset; the bar's first state holds focus alone.
const FOCUS = mine("focus", true, { source: "manual", until: NOW + 88 * min, description: "Deep work: the chat and mail items hide" });
const QUIET = mine("quiet", true, { source: "manual", expr: "hour >= 22 or hour < 8", description: "Quiet hours: no sounds from the bar" });
let entries = table([FOCUS, QUIET]);
const host = await Host.bundled({ core: { "states.list": () => entries, "states.get": ({ name }: { name?: string }) => entries.find((e) => e.name === name)?.value ?? null } });
try {
  const meta = host.loaded().find((l) => l.extension === "states")!.palettes[0];
  const rows = await host.list("states", "states");
  const held = await host.list("states", "states", undefined, { filter: "held" });
  const ext = await host.list("states", "states", undefined, { filter: "ext" });
  const form = (await host.pick("states", "states", "new")).form;
  const two = await host.render("states", "forced");
  entries = table([FOCUS]);
  const item = await host.render("states", "forced");
  const palette = { title: meta.title, icon: meta.icon, live: true, placeholder: meta.placeholder, filters: meta.filters, items: rows, byFilter: { held, ext } };
  writeFixture("states", {
    palettes: { states: palette },
    effects: { "states/new": { form } },
    shots: {
      "1-list": { palette: "states", keys: [], caption: "Every state with its value and which layer answers: its expression, set by hand with the time left, a publisher, built-in" },
      "2-held": { palette: "states", keys: ["tab"], caption: "Tab steps through the filters: held by hand, yours, what extensions publish, the built-ins" },
      "3-actions": { palette: "states", keys: ["down*2", "cmd+k"], caption: "Set a state for an hour, three, until tomorrow or a value typed, reset it, or remove it from the config" },
      "4-new": { palette: "states", keys: ["enter", "type:meeting", "tab", "type:hour >= 15 and hour < 16"], caption: "New state writes [states.<name>] to the config: a name, an expression over the others, a default" },
    },
  });
  writeFixture("bar-states", {
    key: "states/forced",
    title: manifest.bar.forced.title,
    item,
    states: [{ id: "two", item: two }],
    // The rows as the app keeps them: its toItem (app/src/items.ts) does not carry a row's `args` over, so no argument fields.
    palette: { title: meta.title, placeholder: meta.placeholder, rows: rows.map(({ args: _, ...r }) => r) },
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar only while a state is held by hand: its name and the time left" },
      "menubar-two": { target: "menubar", state: "two", caption: "Two held: the soonest to run out first, the count after it" },
      "popover": { target: "menubar", popover: true, state: "two", caption: "A click opens the palette: every state with its value; Enter flips one, ⌘R resets it" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the state and the time left on amber" },
    },
  });
  console.log("wrote app/src/gallery/shots/states.json and bar-states.json");
} finally {
  host.kill();
}
