// timer against a temp state directory (the KV files the owner's CLI
// writes) and a fake `timer` on a path setting that records what it was
// asked and edits the files the way the real one would. The bar item's
// pushes (fs.watch and the 1 Hz tick) are real, so this test takes seconds.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BarItem, View, ViewNode } from "../../../sdk/src/index.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { fmt, parseNew, readTimers, unquote } from "../../../extensions/timer/index.ts";
import { asSession, next, tally, type Session } from "../../../extensions/timer/pomodoro.ts";
import { DEFAULT_RECENT, actions, render as renderPopover, type PopoverState, type Timer } from "../../../extensions/timer/view.ts";
import { Host, writeTool } from "../harness.ts";

const base = mkdtempSync(join(tmpdir(), "pal-timer-"));
const dir = join(base, "state");
const log = join(base, "cli.log");
const cli = join(base, "timer");
writeTool(cli, `#!/bin/sh
echo "$*" >> ${JSON.stringify(log)}
case "$1" in
  stop) rm -f "$TIMER_DIR/$2.state" ;;
  pause) sed 's/^state=running/state=paused/' "$TIMER_DIR/$2.state" > "$TIMER_DIR/$2.tmp" && mv "$TIMER_DIR/$2.tmp" "$TIMER_DIR/$2.state" ;;
  resume) sed 's/^state=paused/state=running/' "$TIMER_DIR/$2.state" > "$TIMER_DIR/$2.tmp" && mv "$TIMER_DIR/$2.tmp" "$TIMER_DIR/$2.state" ;;
  add) echo "$3 +5m" ;;
  done) rm -f "$TIMER_DIR"/*.done ;;
  nope) echo "timer: bad duration 'nope' (try 25m, 90s, 1h30m, 2:30)" >&2; exit 1 ;;
  *) id=$(printf '%s' "\${2:-$1}" | tr ' ' '-'); printf 'id=%s\\nname=%s\\ntotal=1500\\ndeadline=%s\\nleft=1500\\nstate=running\\nring=0\\nquiet=0\\nauto=0\\npid=0\\nfired=0\\n' "$id" "\${2:-$1}" $(( $(date +%s) + 1500 )) > "$TIMER_DIR/$id.state"; echo "$id started" ;;
esac
`);


const now = () => Math.floor(Date.now() / 1000);
type Spec = { state: "running" | "paused" | "done"; total?: number; deadline?: number; left?: number; fired?: number; auto?: boolean; name?: string };
/** A state file as bash `printf %q` writes it. */
const put = (id: string, s: Spec) => writeFileSync(join(dir, `${id}.state`), [
  `id=${id}`, `name=${(s.name ?? id).replace(/ /g, "\\ ")}`, `total=${s.total ?? 1500}`, `deadline=${s.deadline ?? 0}`, `left=${s.left ?? 0}`, `state=${s.state}`,
  "ring=0", "quiet=0", `auto=${s.auto ? 1 : 0}`, "pid=0", `fired=${s.fired ?? 0}`, "",
].join("\n"));
const clear = () => { for (const f of ["tea", "eggs", "pizza", "stale", "old", "over"]) if (existsSync(join(dir, `${f}.state`))) unlinkSync(join(dir, `${f}.state`)); };
const asked = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);

let host: Host;
beforeAll(async () => {
  host = await Host.bundled({ settings: { timer: { settings: { command: cli, dir } } } });
});
afterAll(() => { host.kill(); rmSync(base, { recursive: true, force: true }); });

const render = () => host.render("timer", "timer");
const list = () => host.list("timer", "timers");
const pick = (id: string, action?: string, values?: Record<string, string | boolean>) => host.pick("timer", "timers", id, action, values && { values });

describe("timer", () => {
  test("meta: the palette is live, the bar entry refreshes every 10 s and on wake", () => {
    const l = host.loaded().find((l) => l.extension === "timer")!;
    expect(l.palettes).toMatchObject([{ name: "timers", title: "Timers", live: true, input: false }]);
    expect(l.bar).toEqual([{ id: "timer", title: "Timer", description: expect.any(String), refresh: { every: 10, on: ["wake"] }, mocks: expect.objectContaining({ plain: { title: "A timer running", item: expect.objectContaining({ color: "blue" }) }, running: { title: "A pomodoro round running", item: expect.objectContaining({ progress: 0.58 }) }, ending: { title: expect.any(String), item: expect.objectContaining({ color: "red" }) }, paused: { title: "Paused timer", item: expect.objectContaining({ color: "muted" }) }, landed: { title: "Timer landed", item: expect.objectContaining({ urgent: true }) }, idle: { title: "No timers", item: { hidden: true, empty: { icon: "\u{f0954}", tooltip: "No timers" } } } }), keys: expect.arrayContaining([{ keys: "space", title: expect.any(String) }, { keys: "n", title: expect.any(String) }]), source: true }]);
  });

  test("the state directory is made on the first render; no timers is hidden, and the palette has only the New and Start Pomodoro rows", async () => {
    expect(await render()).toMatchObject({ hidden: true, empty: { icon: "\u{f0954}" } });
    expect(existsSync(dir)).toBe(true);
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["new", "pomodoro"]);
    expect(items[0]).toMatchObject({ name: "New timer", icon: "\u{f0415}", actions: [{ id: "start", title: "Start" }] });
    // The bar takes the duration, a name and whether the phone rings; only the duration is required.
    expect(items[0].args).toEqual([
      { id: "duration", placeholder: "25m, 90s, 1h30m, 2:30, 25", required: true },
      { id: "name", placeholder: "Name (optional)" },
      { id: "ring", placeholder: "Phone", kind: "select", options: [{ id: "no", title: "Silent" }, { id: "yes", title: "Ring the phone" }], default: "no" },
    ]);
    expect(items[1]).toMatchObject({ name: "Start Pomodoro", subtitle: "25 min of work, 5 of break, 4 rounds then 15 min off", icon: "\u{f025b}", actions: [{ id: "pomodoro", title: "Start pomodoro" }] });
  });

  test("a command that is not installed is one hint row in place of New timer, and a pick says so", async () => {
    host.changeSettings("timer", { settings: { command: "pal-no-such-timer", dir } });
    const items = await list();
    expect(items[items.length - 1]).toMatchObject({ id: "hint:cli", name: "pal-no-such-timer is not installed", actions: [] });
    expect(await pick("new", "start", { duration: "5m" })).toMatchObject({ form: { errors: { duration: "pal-no-such-timer is not installed" } } });
    host.changeSettings("timer", { settings: { command: cli, dir } });
  });

  // "landed N ago" is read off the clock: a second may tick between the fixture and the render on a slow runner.
  test("the strip: the soonest running timer's time left with a fill and a colour by progress, a landed one as the alarm, a paused one muted", async () => {
    put("tea", { state: "running", deadline: now() + 600 });
    put("eggs", { state: "paused", left: 30 });
    put("pizza", { state: "done", fired: now() - 10, auto: true, name: "25m" });
    const done = await render();
    expect(done).toMatchObject({ icon: "\u{f0954}", title: "Done", urgent: true, progress: 1, tooltip: expect.stringMatching(/^25m landed 0:1[0-2] ago \(\+2 more\)$/), menu: { view: { id: "timer", keys: "actions", title: "3 timers" } } });
    unlinkSync(join(dir, "pizza.state"));
    // The clock may tick between the file and the render: a second less is fine.
    const tea = await render();
    expect(["10:00", "9:59"]).toContain(tea.title!);
    expect(tea).toMatchObject({ progress: expect.closeTo(0.6, 2), color: "blue", tooltip: "tea (+1 more)" });
    expect(tea.urgent).toBeUndefined();
    put("tea", { state: "running", deadline: now() + 100 });
    expect(await render()).toMatchObject({ title: expect.stringMatching(/^1:(40|39)$/), color: "red" });
    put("tea", { state: "running", deadline: now() + 400 });
    expect(await render()).toMatchObject({ title: expect.stringMatching(/^6:(40|39)$/), color: "amber" });
    unlinkSync(join(dir, "tea.state"));
    expect(await render()).toMatchObject({ title: "0:30", color: "muted", tooltip: "eggs, paused" });
    clear();
  });

  test("pushes: a change in the directory is pushed; the 1 Hz tick runs while a timer runs and stops once none does", async () => {
    expect(await render()).toMatchObject({ hidden: true, empty: { icon: "\u{f0954}" } });
    put("tea", { state: "running", deadline: now() + 300 });
    // The tick moves the countdown on, a second at a time or two when a tick lands late; never an exact title: written at the end of a
    // second the first push already reads 4:59, and a tick that slips past a boundary skips one (waiting on 4:59 then 4:58 failed both ways).
    const secs = (i: BarItem) => { const [m, s] = i.title!.split(":").map(Number); return m * 60 + s; };
    try {
      const first = await host.nextUpdate("timer", "timer", (i) => !i.hidden);
      expect(["5:00", "4:59"]).toContain(first.title!);
      const second = await host.nextUpdate("timer", "timer", (i) => secs(i) < secs(first), 2500);
      expect(secs(first) - secs(second)).toBeLessThanOrEqual(2);
      expect(second.progress).toBeCloseTo((1500 - secs(second)) / 1500, 3);
      const third = await host.nextUpdate("timer", "timer", (i) => secs(i) < secs(second), 2500);
      expect(secs(second) - secs(third)).toBeLessThanOrEqual(2);
    } finally {
      // Left behind, a running timer keeps the tick pushing into the tests after this one.
      if (existsSync(join(dir, "tea.state"))) unlinkSync(join(dir, "tea.state"));
    }
    await host.nextUpdate("timer", "timer", (i) => i.hidden === true);
    const n = host.updates("timer", "timer").length;
    await Bun.sleep(1500);
    expect(host.updates("timer", "timer")).toHaveLength(n);
  });

  test("the palette: a row per timer with what is left and actions by state; picks go to the CLI and keep the list", async () => {
    put("tea", { state: "running", deadline: now() + 600 });
    put("eggs", { state: "paused", left: 30 });
    put("pizza", { state: "done", fired: now() - 10 });
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["pizza", "tea", "eggs", "new", "pomodoro"]);
    expect(items[0]).toMatchObject({ name: "pizza", subtitle: expect.stringMatching(/^Landed 0:1[0-2] ago$/), accessories: [{ tag: "done", color: "red" }] });
    expect(items[0].actions!.map((a) => a.id)).toEqual(["done", "add", "stop"]);
    expect(items[1]).toMatchObject({ name: "tea", subtitle: expect.stringMatching(/^(10:00|9:59) left, done at /), accessories: [{ tag: "running", color: "blue" }] });
    expect(items[1].actions!.map((a) => a.id)).toEqual(["pause", "add", "stop"]);
    expect(items[2]).toMatchObject({ name: "eggs", subtitle: "Paused at 0:30", accessories: [{ tag: "paused", color: "amber" }] });
    expect(items[2].actions!.map((a) => a.id)).toEqual(["resume", "add", "stop"]);
    // The bar's field on a timer row: minutes for Add only; five when blank or absent (a hotkey).
    expect(items[1].args).toEqual([{ id: "add", placeholder: "Minutes to add", kind: "number", default: "5" }]);
    expect(items[1].actions!.filter((a) => a.args).map((a) => a.id)).toEqual(["add"]);
    expect(await pick("tea", "pause")).toEqual({ keep: true });
    expect(readFileSync(join(dir, "tea.state"), "utf8")).toContain("state=paused");
    expect(await pick("tea", "resume")).toEqual({ keep: true });
    expect(await pick("tea", "add")).toEqual({ keep: true });
    expect(await pick("tea", "add", { add: "15" })).toEqual({ keep: true });
    expect(await pick("tea", "add", { add: "" })).toEqual({ keep: true });
    expect(await pick("pizza", "done")).toEqual({ keep: true });
    expect(await pick("eggs", "stop")).toEqual({ keep: true });
    expect(existsSync(join(dir, "eggs.state"))).toBe(false);
    expect(asked()).toEqual(["pause tea", "resume tea", "add 5m tea", "add 15m tea", "add 5m tea", "done", "stop eggs"]);
    clear();
  });

  test("New timer: the bar's values start it; a pick without them is the same fields as a form; a duration the CLI refuses comes back as its error under the field", async () => {
    clear();
    const f = await pick("new", "start");
    expect(f.form).toMatchObject({ id: "new", title: "New timer", submit: { id: "start", title: "Start" } });
    expect((f.form as any).fields.map((x: any) => [x.id, x.kind])).toEqual([["duration", "text"], ["name", "text"], ["ring", "select"]]);
    expect(await pick("new", "start", { duration: "  ", name: "" })).toMatchObject({ form: { errors: { duration: "A duration is needed" } } });
    expect(await pick("new", "start", { duration: "nope", name: "" })).toMatchObject({ form: { errors: { duration: "bad duration 'nope' (try 25m, 90s, 1h30m, 2:30)" } } });
    expect(await pick("new", "start", { duration: "25m", name: "tea", ring: "yes" })).toEqual({ keep: true, toast: { title: "Timer started", message: "tea started" } });
    expect(asked().at(-1)).toBe("25m tea --ring");
    expect(await pick("new", "start", { duration: "25m", name: "tea", ring: "no" })).toMatchObject({ keep: true });
    expect(asked().at(-1)).toBe("25m tea");
    expect((await list()).map((i) => i.id)).toEqual(["tea", "new", "pomodoro"]);
    expect(await pick("new", "start", { duration: "90s" })).toMatchObject({ keep: true });
    expect(asked().at(-1)).toBe("90s");
    unlinkSync(join(dir, "90s.state"));
    clear();
  });

  /** Every node of a tree, depth first. */
  const nodes = (n: ViewNode): ViewNode[] => [n, ...(n.type === "stack" ? n.children.flatMap(nodes) : [])];
  const menuView = (item: BarItem) => (item.menu as { view: View }).view;
  const act = (action: string, values?: Record<string, string>) => host.barAction("timer", "timer", action, { reason: "open", compact: true, ...(values && { values }) });

  test("no timer: hidden, the empty shape (the glyph, the popover open on the field to start one) offered for the core's show = always", async () => {
    const item = await render();
    expect(item).toMatchObject({ hidden: true, empty: { icon: "\u{f0954}", tooltip: "No timers" } });
    expect(item.title).toBeUndefined();
    expect(item.progress).toBeUndefined();
    const v = checkView(menuView(item.empty!));
    expect(v).toMatchObject({ id: "timer", keys: "actions" });
    expect(v.input).toBeDefined();
    expect(v.actions.map((a) => a.id)).toContain("start");
  });

  test("the popover: a card per timer with the time left, a bar in the strip's colour and the ring on the first; the tree passes the check; the keys are the actions", async () => {
    put("tea", { state: "running", deadline: now() + 600 });
    put("eggs", { state: "paused", left: 30 });
    put("pizza", { state: "done", fired: now() - 10 });
    const v = menuView(await render());
    expect(checkView(v)).toBe(v);
    const all = nodes(v.tree);
    const cards = all.filter((n) => n.type === "stack" && n.key?.startsWith("t-"));
    expect(cards.map((c) => c.key)).toEqual(["t-pizza", "t-tea", "t-eggs"]);
    expect(cards.map((c) => c.action)).toEqual(["focus:pizza", "focus:tea", "focus:eggs"]);
    expect(cards.map((c) => c.selected)).toEqual([true, undefined, undefined]);
    const bars = all.filter((n) => n.type === "progress") as Extract<ViewNode, { type: "progress" }>[];
    expect(bars.map((b) => b.color)).toEqual(["red", "blue", "grey"]);
    expect(bars[0].value).toBe(1);
    const big = all.filter((n) => n.type === "text" && n.key === "left") as Extract<ViewNode, { type: "text" }>[];
    expect(big.map((t) => t.value)).toEqual(["0:00", expect.stringMatching(/^(10:00|9:59)$/), "0:30"]);
    expect(big[0]).toMatchObject({ style: "number", size: "xl", color: "destructive" });
    expect(all.some((n) => n.type === "badge" && n.text === "done")).toBe(true);
    expect(all.some((n) => n.type === "badge" && n.text === "paused")).toBe(true);
    // The first card is the landed one: Enter dismisses; the keys of the hints row are the actions.
    expect(v.actions[0]).toEqual({ id: "toggle", title: "Dismiss", shortcut: ["space", "d"] });
    expect(v.actions.map((a) => a.id)).toEqual(["toggle", "stop", "new", "pomodoro", "open", "up", "down", "focus:pizza", "focus:tea", "focus:eggs"]);
    expect(all.filter((n) => n.type === "keycap").map((n) => (n as { keys: string }).keys)).toEqual(["space", "backspace", "up", "down", "n", "p", "o"]);
    expect(v.input).toBeUndefined();
  });

  test("the keys route to the CLI for the card with the ring: arrows and a click move the ring, space pauses and resumes, + adds, backspace stops, Enter dismisses a landed one", async () => {
    const logAt = asked().length;
    // Down twice from pizza (landed) lands on eggs; space resumes it.
    expect(await act("down")).toEqual({ keep: true });
    expect(menuView(await render()).actions[0]).toMatchObject({ id: "toggle", title: "Pause" });
    expect(await act("down")).toEqual({ keep: true });
    expect(menuView(await render()).actions[0]).toMatchObject({ id: "toggle", title: "Resume" });
    expect(await act("toggle")).toEqual({ keep: true });
    expect(readFileSync(join(dir, "eggs.state"), "utf8")).toContain("state=running");
    // A click on tea's card: the ring moves there, the keys follow.
    expect(await act("focus:tea")).toEqual({ keep: true });
    const cards = nodes(menuView(await render()).tree).filter((n) => n.type === "stack" && n.key?.startsWith("t-"));
    expect(cards.find((c) => c.selected)?.key).toBe("t-tea");
    expect(await act("toggle")).toEqual({ keep: true });
    expect(readFileSync(join(dir, "tea.state"), "utf8")).toContain("state=paused");
    expect(await act("add")).toEqual({ keep: true });
    expect(await act("stop")).toEqual({ keep: true });
    expect(existsSync(join(dir, "tea.state"))).toBe(false);
    // Up from the first wraps to the last; the landed one dismissed through `done`.
    expect(await act("focus:pizza")).toEqual({ keep: true });
    expect(await act("toggle")).toEqual({ keep: true });
    expect(asked().slice(logAt)).toEqual(["resume eggs", "pause tea", "add 5m tea", "stop tea", "done"]);
    expect(await act("open")).toEqual({ push: { extension: "timer", palette: "timers" } });
    clear();
  });

  test("the field: n opens it, Start reads 25m tea ring from ctx.values.input and starts the timer, the duration joins the tiles; Escape's cancel closes it; an empty line is a toast", async () => {
    put("eggs", { state: "paused", left: 30 });
    expect(await act("new")).toEqual({ keep: true });
    let v = menuView(await render());
    expect(v.input).toEqual({ placeholder: "25m tea", submit: "start", cancel: "cancel" });
    expect(v.actions[0]).toEqual({ id: "start", title: "Start" });
    expect(nodes(v.tree).filter((n) => n.type === "tile").map((n) => (n as { text: string }).text)).toEqual(DEFAULT_RECENT);
    expect(nodes(v.tree).filter((n) => n.type === "keycap").map((n) => (n as { keys: string }).keys)).toEqual(["enter", "escape"]);
    expect(await act("start", { input: "  " })).toMatchObject({ keep: true, toast: { title: "A duration is needed", style: "failure" } });
    expect(await act("start", { input: "nope" })).toMatchObject({ keep: true, toast: { title: "Could not start the timer", message: "bad duration 'nope' (try 25m, 90s, 1h30m, 2:30)", style: "failure" } });
    expect(await act("start", { input: "25m tea ring" })).toEqual({ keep: true, hud: "Started tea started" });
    expect(asked().at(-1)).toBe("25m tea --ring");
    v = menuView(await render());
    expect(v.input).toBeUndefined();
    expect(nodes(v.tree).filter((n) => n.type === "stack" && n.key?.startsWith("t-")).find((c) => c.selected)?.key).toBe("t-tea");
    // The tiles remember: the next field opens with 25m first; a tile's click starts that duration at once.
    expect(await act("new")).toEqual({ keep: true });
    v = menuView(await render());
    expect(nodes(v.tree).filter((n) => n.type === "tile").map((n) => (n as { text: string }).text)).toEqual(["25m", "5m", "1h"]);
    expect(await act("cancel")).toEqual({ keep: true });
    expect(menuView(await render()).input).toBeUndefined();
    expect(await act("recent:5m")).toMatchObject({ keep: true });
    expect(asked().at(-1)).toBe("5m");
    unlinkSync(join(dir, "5m.state"));
    clear();
  });

  test("the popover live: shown with only a paused timer the tick still pushes (the item, tree included) every second, and stops once it is hidden", async () => {
    put("eggs", { state: "paused", left: 30 });
    await render();
    await Bun.sleep(1500);
    const before = host.updates("timer", "timer").length;
    host.viewShown("timer", { bar: "timer" }, "timer", true);
    await host.nextUpdate("timer", "timer", (i) => !!(i.menu as { view?: View })?.view, 2500);
    await host.nextUpdate("timer", "timer", (i) => !!(i.menu as { view?: View })?.view, 2500);
    expect(host.updates("timer", "timer").length).toBeGreaterThan(before + 1);
    host.viewHidden("timer", { bar: "timer" }, "timer", true);
    // A tick in flight at the hide may still land; after that, nothing.
    await Bun.sleep(2000);
    const n = host.updates("timer", "timer").length;
    await Bun.sleep(2000);
    expect(host.updates("timer", "timer")).toHaveLength(n);
    clear();
  }, 12000);

  test("a stopped timer is a toast when the CLI refuses", async () => {
    expect(await pick("gone", "nope")).toMatchObject({ keep: true, toast: { title: "Could not nope the timer", style: "failure" } });
  });

  // ---- pomodoro: the session rides on the CLI's timers, advanced on every read of the directory.
  const huds = () => host.coreCalls.filter((c) => c.method === "effects.run").map((c) => (c.params as { effect: { hud?: string } }).effect.hud);
  /** The CLI firing a timer: its file says done. */
  const land = (id: string, name: string) => put(id, { state: "done", fired: now() - 1, name });
  const ids = async () => (await list()).map((i) => i.id);
  const sessionStored = () => host.coreCalls.filter((c) => c.method === "storage.set" && (c.params as { key: string }).key === "pomodoro").map((c) => (c.params as { value: Session }).value);

  test("Start Pomodoro: the first round's timer through the CLI, the row marked with the phase and the round, the session in storage, the Start row gone", async () => {
    clear();
    host.changeSettings("timer", { settings: { command: cli, dir, pomodoro_rounds: 2 } });
    expect(await pick("pomodoro")).toEqual({ keep: true, hud: "Pomodoro. Round 1 of 2: 25 min" });
    expect(asked().at(-1)).toBe("25m Pomodoro 1 of 2");
    expect(await ids()).toEqual(["Pomodoro-1-of-2", "new"]);
    const r = (await list())[0];
    expect(r).toMatchObject({ name: "Pomodoro 1 of 2", subtitle: expect.stringMatching(/^Round 1 of 2, work · (25:00|24:59) left/), icon: "\u{f025b}", keywords: ["timer", "running", "pomodoro", "work"], accessories: [{ tag: "work", color: "violet" }, { tag: "running", color: "blue" }] });
    expect(r.actions!.map((a) => a.id)).toEqual(["pause", "add", "skip", "stop-pomodoro", "stop"]);
    expect(sessionStored().at(-1)).toMatchObject({ round: 1, of: 2, phase: "work", timerId: "Pomodoro-1-of-2", timerName: "Pomodoro 1 of 2" });
    expect(await pick("pomodoro")).toMatchObject({ keep: true, toast: { title: "A pomodoro is running", message: "Round 1 of 2, work" } });
    // The strip names the round; the tooltip the phase.
    expect(await render()).toMatchObject({ title: expect.stringMatching(/^(25:00|24:59) · 1\/2$/), tooltip: "Pomodoro: round 1 of 2, work" });
  });

  test("the work timer lands: stopped, the round tallied, the break started and the HUD told; the break lands: the next round; the last round lands: the long break; then round 1 again", async () => {
    land("Pomodoro-1-of-2", "Pomodoro 1 of 2");
    expect(await ids()).toEqual(["Break-1-of-2", "new", "pomodoro:today"]);
    expect(asked().slice(-2)).toEqual(["stop Pomodoro-1-of-2", "5m Break 1 of 2"]);
    expect(huds().at(-1)).toBe("Pomodoro. Break: 5 min");
    expect((await list())[0]).toMatchObject({ subtitle: expect.stringMatching(/^Round 1 of 2, break · /), accessories: [{ tag: "break", color: "green" }, { tag: "running", color: "blue" }] });
    expect((await list())[2]).toMatchObject({ id: "pomodoro:today", name: "Pomodoros today: 1", subtitle: "One work round finished", actions: [] });
    expect(await render()).toMatchObject({ title: expect.stringMatching(/ · break$/) });
    land("Break-1-of-2", "Break 1 of 2");
    expect(await ids()).toEqual(["Pomodoro-2-of-2", "new", "pomodoro:today"]);
    expect(huds().at(-1)).toBe("Pomodoro. Round 2 of 2: 25 min");
    land("Pomodoro-2-of-2", "Pomodoro 2 of 2");
    expect(await ids()).toEqual(["Long-break", "new", "pomodoro:today"]);
    expect(asked().at(-1)).toBe("15m Long break");
    expect(huds().at(-1)).toBe("Pomodoro. Long break: 15 min");
    expect((await list())[0]).toMatchObject({ subtitle: expect.stringMatching(/^Long break · /), accessories: [{ tag: "long break", color: "green" }, { tag: "running", color: "blue" }] });
    expect((await list())[2].name).toBe("Pomodoros today: 2");
    land("Long-break", "Long break");
    expect(await ids()).toEqual(["Pomodoro-1-of-2", "new", "pomodoro:today"]);
    expect(sessionStored().at(-1)).toMatchObject({ round: 1, phase: "work" });
  });

  test("skip starts the next phase without a tally; stop ends the session, its timer gone and Start Pomodoro back", async () => {
    expect(await pick("Pomodoro-1-of-2", "skip")).toEqual({ keep: true });
    expect(asked().slice(-2)).toEqual(["stop Pomodoro-1-of-2", "5m Break 1 of 2"]);
    expect(huds().at(-1)).toBe("Pomodoro. Round 1 of 2, break");
    expect((await list())[2].name).toBe("Pomodoros today: 2");
    expect(await pick("Break-1-of-2", "stop-pomodoro")).toEqual({ keep: true, hud: "Pomodoro stopped" });
    expect(existsSync(join(dir, "Break-1-of-2.state"))).toBe(false);
    expect(host.coreCalls.filter((c) => c.method === "storage.remove" && (c.params as { key: string }).key === "pomodoro")).toHaveLength(1);
    expect(await ids()).toEqual(["new", "pomodoro", "pomodoro:today"]);
  });

  test("the popover: p starts one, the card names the phase and the round, s skips, the tally sits at the end of the hints; a session whose timer went away ends by itself", async () => {
    expect(await act("pomodoro")).toEqual({ keep: true, hud: "Pomodoro. Round 1 of 2: 25 min" });
    let v = menuView(await render());
    const all = nodes(v.tree);
    expect(all.find((n) => n.type === "badge" && n.key === "phase")).toMatchObject({ text: "work", color: "violet" });
    expect(all.find((n) => n.type === "text" && n.key === "today")).toMatchObject({ value: "2 today" });
    expect(all.filter((n) => n.type === "keycap").map((n) => (n as { keys: string }).keys)).toEqual(["space", "+", "backspace", "n", "s", "o"]);
    expect(v.actions.map((a) => a.id)).toEqual(["toggle", "add", "stop", "new", "skip", "stop-pomodoro", "open", "focus:Pomodoro-1-of-2"]);
    expect(checkView(v)).toBe(v);
    expect(await act("skip")).toEqual({ keep: true });
    expect(huds().at(-1)).toBe("Pomodoro. Round 1 of 2, break");
    v = menuView(await render());
    expect(nodes(v.tree).find((n) => n.type === "badge" && n.key === "phase")).toMatchObject({ text: "break", color: "green" });
    // Stopped from the terminal: the file goes; the next read ends the session.
    unlinkSync(join(dir, "Break-1-of-2.state"));
    expect(await ids()).toEqual(["new", "pomodoro", "pomodoro:today"]);
    expect(await render()).toMatchObject({ hidden: true, empty: { icon: "\u{f0954}" } });
    host.changeSettings("timer", { settings: { command: cli, dir } });
  });

  test("a session survives a host restart: read back from storage with its timer", async () => {
    expect(await pick("pomodoro")).toMatchObject({ keep: true });
    const h = await Host.bundled({ settings: { timer: { settings: { command: cli, dir } } } });
    try {
      const items = await h.list("timer", "timers");
      expect(items[0]).toMatchObject({ id: "Pomodoro-1-of-4", subtitle: expect.stringMatching(/^Round 1 of 4, work · /) });
      expect(items.map((i) => i.id)).toEqual(["Pomodoro-1-of-4", "new", "pomodoro:today"]);
      expect(await h.pick("timer", "timers", "Pomodoro-1-of-4", "stop-pomodoro")).toEqual({ keep: true, hud: "Pomodoro stopped" });
    } finally { h.kill(); }
    expect(await ids()).toEqual(["new", "pomodoro", "pomodoro:today"]);
  });
});

describe("timer: the popover's tree", () => {
  const T = (id: string, state: Timer["state"], extra: Partial<Timer> = {}): Timer => ({ id, name: id, total: 1500, deadline: state === "running" ? 1000 + 300 : 0, left: state === "paused" ? 750 : 0, fired: state === "done" ? 1000 - 35 : 0, state, auto: false, ...extra });
  const st = (timers: Timer[], extra: Partial<PopoverState> = {}): PopoverState => ({ timers, field: false, recent: [], now: 1000, ...extra });

  test("no timer and no field: the field is what the empty state offers, with the default tiles", () => {
    const v = renderPopover(st([], { field: true }));
    expect(checkView(v)).toBe(v);
    expect(v.title).toBe("New timer");
    expect(v.input?.submit).toBe("start");
    expect(actions(st([], { field: true })).map((a) => a.id)).toEqual(["start", "open", "cancel", "recent:5m", "recent:25m", "recent:1h"]);
  });

  test("the colours follow the strip's rule and the ring the cursor; one timer has no arrows", () => {
    const late = T("late", "running", { deadline: 1000 + 100 });
    const v = renderPopover(st([late, T("mid", "running", { deadline: 1000 + 400 }), T("p", "paused")], { cursor: "mid" }));
    const all = (n: ViewNode): ViewNode[] => [n, ...(n.type === "stack" ? n.children.flatMap(all) : [])];
    expect(all(v.tree).filter((n) => n.type === "progress").map((n) => (n as { color: string }).color)).toEqual(["red", "amber", "grey"]);
    expect(all(v.tree).filter((n) => n.type === "stack" && n.selected).map((n) => n.key)).toEqual(["t-mid"]);
    expect(v.title).toBe("3 timers");
    const one = actions(st([late]));
    expect(one.some((a) => a.id === "up")).toBe(false);
    expect(one[0]).toMatchObject({ id: "toggle", title: "Pause" });
  });

  test("pomodoro: the phase after each, the tally keeps sixty days, a stored session is read defensively", () => {
    expect(next({ round: 1, of: 4, phase: "work" })).toEqual({ phase: "break", round: 1 });
    expect(next({ round: 1, of: 4, phase: "break" })).toEqual({ phase: "work", round: 2 });
    expect(next({ round: 4, of: 4, phase: "work" })).toEqual({ phase: "long", round: 4 });
    expect(next({ round: 4, of: 4, phase: "long" })).toEqual({ phase: "work", round: 1 });
    expect(next({ round: 1, of: 1, phase: "work" })).toEqual({ phase: "long", round: 1 });
    expect(tally({ "2026-09-16": 3, "2026-07-01": 9, "2026-09-17": 0 }, "2026-09-17")).toEqual({ "2026-09-16": 3, "2026-09-17": 1 });
    expect(tally({}, "2026-09-17")).toEqual({ "2026-09-17": 1 });
    expect(asSession({ round: 2, of: 4, phase: "break", timerId: "b", timerName: "Break 2 of 4" })).toEqual({ round: 2, of: 4, phase: "break", timerId: "b", timerName: "Break 2 of 4", startedAt: 0, sessionStart: 0 });
    expect(asSession({ round: 2, phase: "nap", timerId: "b", timerName: "x" })).toBeNull();
    expect(asSession(null)).toBeNull();
  });

  test("parseNew: the first word is the duration, the rest the name, a trailing ring asks the phone", () => {
    expect(parseNew("25m tea")).toEqual({ duration: "25m", name: "tea", ring: false });
    expect(parseNew(" 1h30m make the tea ring ")).toEqual({ duration: "1h30m", name: "make the tea", ring: true });
    expect(parseNew("90s")).toEqual({ duration: "90s", name: "", ring: false });
    expect(parseNew("")).toEqual({ duration: "", name: "", ring: false });
  });
});

describe("timer: reading the state files", () => {
  test("bash %q undone", () => {
    expect(unquote("make\\ the\\ tea")).toBe("make the tea");
    expect(unquote("$'a\\nb\\'c'")).toBe("a\nb'c");
    expect(unquote("'it'\\''s'")).toBe("it's");
    expect(unquote("plain")).toBe("plain");
  });

  test("fmt as the CLI prints it", () => {
    expect(fmt(754)).toBe("12:34");
    expect(fmt(3754)).toBe("1:02:34");
    expect(fmt(-5)).toBe("0:00");
  });

  test("the reap rules: a running timer well past its deadline is gone, one just past it has landed, a landed one past the badge ttl is gone; a name with spaces reads back", async () => {
    const d = mkdtempSync(join(tmpdir(), "pal-timer-read-"));
    const write = (id: string, lines: string[]) => writeFileSync(join(d, `${id}.state`), lines.join("\n") + "\n");
    write("stale", ["id=stale", "name=stale", "total=60", `deadline=${now() - 120}`, "left=60", "state=running", "auto=0", "fired=0"]);
    write("over", ["id=over", "name=over", "total=60", `deadline=${now() - 5}`, "left=60", "state=running", "auto=0", "fired=0"]);
    write("old", ["id=old", "name=old", "total=60", "deadline=0", "left=0", "state=done", "auto=0", `fired=${now() - 400}`]);
    write("tea", ["id=tea", "name=make\\ the\\ tea", "total=600", `deadline=${now() + 100}`, "left=600", "state=running", "auto=0", "fired=0"]);
    write("junk", ["nothing=here"]);
    writeFileSync(join(d, "README"), "not a timer");
    const ts = await readTimers(d);
    expect(ts.map((t) => [t.id, t.state])).toEqual([["over", "done"], ["tea", "running"]]);
    expect(ts[1].name).toBe("make the tea");
    expect(await readTimers(join(d, "missing"))).toEqual([]);
    rmSync(d, { recursive: true, force: true });
  });
});
