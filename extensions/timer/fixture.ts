// Writes app/src/gallery/shots/timer.json and bar-timer.json, the store
// screenshots' fixtures: the palette's rows, the bar item and its popover
// as the extension answers them through the host harness, at fixture-kit's
// clock, over a made-up state directory (the KV files the CLI writes) and a
// stand-in `timer` that is only there to be found. A second host carries a
// pomodoro session in storage (it is read once per host). Nothing is the
// owner's. `make shots EXT=timer`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BarItem } from "../../sdk/src/index.ts";
import { Host, stored, writeTool } from "../../host/test/harness.ts";
import { NOW_S as NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";

type Spec = { state: "running" | "paused" | "done"; total: number; left?: number; ago?: number; name?: string };
/** A state file as the CLI's `printf %q` writes it: `left` seconds to go (running or paused), or landed `ago` seconds back. */
const put = (dir: string, id: string, s: Spec) => writeFileSync(join(dir, `${id}.state`), [
  `id=${id}`, `name=${(s.name ?? id).replace(/ /g, "\\ ")}`, `total=${s.total}`,
  `deadline=${s.state === "running" ? NOW + s.left! : 0}`, `left=${s.state === "paused" ? s.left : 0}`, `state=${s.state}`,
  "ring=0", "quiet=0", "auto=0", "pid=0", `fired=${s.state === "done" ? NOW - s.ago! : 0}`, "",
].join("\n"));
/** A lunch-time desk: pasta on the stove, a load of laundry, a focus block paused for lunch, eggs that just landed, a pomodoro round. */
const TIMERS: Record<string, Spec> = {
  pasta: { state: "running", total: 600, left: 192 },
  laundry: { state: "running", total: 3600, left: 1361 },
  focus: { state: "paused", total: 3000, left: 2465 },
  eggs: { state: "done", total: 420, ago: 35 },
  "Pomodoro-2-of-4": { state: "running", total: 1500, left: 1107, name: "Pomodoro 2 of 4" },
};

pinClock();
const base = mkdtempSync(join(tmpdir(), "pal-timer-fixture-"));
const dir = join(base, "state"), cli = join(base, "timer");
mkdirSync(dir);
writeTool(cli, "#!/bin/sh\nexit 0\n");
/** The directory holds exactly these timers (a spec's fields overridden per state). */
const only = (ids: string[], over: Record<string, Partial<Spec>> = {}) => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  for (const id of ids) put(dir, id, { ...TIMERS[id], ...over[id] });
};
const settings = { timer: { settings: { command: cli, dir } } };
stored.set("timer\0recent", ["25m", "7m", "1h", "90s"]);

let host = await Host.bundled({ settings });
try {
  const render = () => host.render("timer", "timer") as Promise<BarItem>;
  const meta = host.loaded().find((l) => l.extension === "timer")!.palettes[0];
  only(["pasta", "laundry", "focus"]);
  const item = await render();
  only(["laundry"]);
  const early = await render();
  only(["pasta", "laundry"], { pasta: { left: 48 } });
  const late = await render();
  only(["focus"]);
  const paused = await render();
  only(["eggs", "pasta", "laundry", "focus"]);
  const landed = await render();
  // `n` opens the field; it stays open for this host's renders, so last.
  only(["pasta", "laundry"]);
  await host.barAction("timer", "timer", "new", { reason: "open", compact: true });
  const field = await render();
  host.kill();

  // The pomodoro's host: its session and today's three finished rounds in storage before the first read.
  stored.set("timer\0pomodoro", { round: 2, of: 4, phase: "work", timerId: "Pomodoro-2-of-4", timerName: "Pomodoro 2 of 4", startedAt: NOW - 393, sessionStart: NOW - 2 * 1800 - 393 });
  stored.set("timer\0pomodoro_stats", { "2026-09-15": 6, "2026-09-16": 3 });
  host = await Host.bundled({ settings });
  only(["Pomodoro-2-of-4", "laundry"]);
  const pomodoro = await render();
  only(["eggs", "pasta", "Pomodoro-2-of-4", "laundry", "focus"]);
  const rows = await host.list("timer", "timers");

  writeFixture("timer", {
    palettes: { timers: { title: meta.title, icon: meta.icon, live: true, placeholder: meta.placeholder, items: rows } },
    shots: {
      "1-timers": { palette: "timers", keys: [], caption: "Every timer, the most urgent first: one that just landed, three running with when each lands, one paused, and the pomodoros done today" },
      "2-actions": { palette: "timers", keys: ["wait:200", "down", "cmd+k"], caption: "A running timer's actions: pause it, stop it, or add the minutes in the field beside the search (five unless you type more)" },
      "3-pomodoro": { palette: "timers", keys: ["wait:200", "down*2", "cmd+k"], caption: "A pomodoro round is a timer too: its row says the round and the phase, and skips to the break or stops the cycle" },
      "4-new": { palette: "timers", keys: ["wait:200", "down*5", "wait:200", "tab", "type:25m", "tab", "type:tea", "wait:300"], caption: "New timer, typed after the search: a duration as you would say it, an optional name, and whether the phone rings when it lands" },
    },
  });
  // A state is a patch over the item: what the state's item lacks (a landed one has no colour) is cleared.
  const state = (id: string, it: BarItem) => ({ id, item: { ...Object.fromEntries(Object.keys(item).map((k) => [k, null])), ...it } });
  writeFixture("bar-timer", {
    key: "timer/timer", title: "Timer", item,
    states: [
      state("early", early), state("late", late), state("paused", paused),
      state("landed", landed), state("new", field), state("pomodoro", pomodoro),
    ],
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar: what is left of the soonest timer, with a fill under the glyph that turns amber past two thirds" },
      "menubar-landed": { target: "menubar", state: "landed", caption: "A timer that landed: the item turns into a red alarm with its name" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: a card per timer with the time left and a bar; space pauses, + adds five minutes, backspace stops" },
      "popover-landed": { target: "menubar", popover: true, state: "landed", caption: "A landed timer sits on top, red and full, until space dismisses it" },
      "popover-new": { target: "menubar", popover: true, state: "new", caption: "n opens the field: 25m tea starts one, and the last durations are a click away" },
      "popover-pomodoro": { target: "menubar", popover: true, state: "pomodoro", caption: "A pomodoro on the popover: the round and the phase on its card, s skips to the break, the rounds finished today below" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the fill as a rule of box-drawing cells before the glyph, the countdown as the label" },
    },
  });
  console.log(`timer.json: ${rows.length} rows; bar-timer.json: the item and six states`);
} finally {
  host.kill();
  rmSync(base, { recursive: true, force: true });
}
