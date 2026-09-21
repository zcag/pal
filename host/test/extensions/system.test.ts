// system against canned core/system.* replies with the core's real ids, a
// temp folder standing in for the Trash (`PAL_TRASH_DIR`), and a shell
// script standing in for `caffeinate` (`PAL_AWAKE_TOOL`) that logs its
// arguments and sleeps for its `-t`: the keep-awake row, its bar item and
// its link run the real process path against it. The pure parts of
// awake.ts (the spellings, the countdown texts, the reconciliation) are
// tested directly.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SystemCommand, View } from "../../../sdk/src/index.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { argv, describe as describeRun, fmtClock, fmtLeft, fmtSpan, nextTick, parseTarget, reconcile, summary, type Awake } from "../../../extensions/system/awake.ts";
import { actions, render, type PopoverState } from "../../../extensions/system/view.ts";
import { Host, stored } from "../harness.ts";

const MAC = process.platform === "darwin";
const COMMANDS: SystemCommand[] = [
  { id: "sleep", title: "Sleep", subtitle: "Put the machine to sleep", icon: "⏾", keywords: ["suspend"], destructive: false, available: true },
  { id: "shutdown", title: "Shut Down", subtitle: "Power the machine off", icon: "⏻", keywords: ["halt", "power"], destructive: true, available: true },
  { id: "empty-trash", title: "Empty Trash", subtitle: "Delete everything in the trash", icon: "⌫", keywords: ["bin"], destructive: true, available: true },
  { id: "dark-mode", title: "Toggle Dark Mode", subtitle: "Switch between light and dark appearance", icon: "◐", keywords: ["theme"], destructive: false, available: true },
  { id: "dnd", title: "Toggle Do Not Disturb", subtitle: "Focus", icon: "⊘", keywords: ["focus"], destructive: false, available: false },
  { id: "quit-all", title: "Quit All Apps", subtitle: "Quit every open app but Finder and pal", icon: "⌧", keywords: ["close all"], destructive: true, available: true },
  { id: "unhide-all", title: "Unhide All Apps", subtitle: "Show every hidden app again", icon: "◫", keywords: ["show all"], destructive: false, available: true },
  { id: "dismiss-notifications", title: "Dismiss Notifications", subtitle: "Clear every notification on screen", icon: "⌦", keywords: ["clear all"], destructive: false, available: MAC },
];
/** The core's keep-awake entry, as it sits between show-desktop and quit-all; the extension replaces it with its own row. */
const KEEP_AWAKE: SystemCommand = { id: "keep-awake", title: "Keep Awake", subtitle: "Stop the machine and display from sleeping until turned off", icon: "☕", keywords: ["caffeinate"], destructive: false, available: true };
const WITH_AWAKE = [...COMMANDS.slice(0, 5), KEEP_AWAKE, ...COMMANDS.slice(5)];

// The fake caffeinate: logs `$*`, sleeps its `-t` seconds (forever without one); killed by SIGTERM like the real one.
const fake = mkdtempSync(join(tmpdir(), "pal-awake-"));
const CLI = join(fake, "caffeinate");
const LOG = join(fake, "log");
writeFileSync(CLI, `#!/bin/sh
echo "$*" >> ${JSON.stringify(LOG)}
t=""
while [ $# -gt 0 ]; do case "$1" in -t) t="$2"; shift ;; esac; shift; done
if [ -n "$t" ]; then sleep "$t"; else while :; do sleep 1; done; fi
`);
chmodSync(CLI, 0o755);
const asked = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n") : []);
// A freshly written script takes a beat to start (macOS checks a new executable on its first run), so the log is polled for the next line rather than read at once.
let seen = 0;
const lastAsk = async (): Promise<string | undefined> => {
  const t0 = Date.now();
  while (asked().length <= seen) { if (Date.now() - t0 > 3000) throw new Error("the fake caffeinate did not log"); await Bun.sleep(10); }
  seen = asked().length;
  return asked().at(-1);
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const trash = mkdtempSync(join(tmpdir(), "pal-trash-"));
writeFileSync(join(trash, "a.txt"), "");
writeFileSync(join(trash, "b.txt"), "");
writeFileSync(join(trash, ".DS_Store"), "");

let host: Host;
const ran: string[] = [];
beforeAll(async () => {
  process.env.PAL_TRASH_DIR = trash;
  process.env.PAL_AWAKE_TOOL = CLI;
  host = await Host.bundled({ core: { "system.commands": () => COMMANDS, "system.run": (p) => { if (p.id === "sleep") throw new Error("pmset: not permitted"); ran.push(p.id); return null; } } });
});
afterAll(() => { host.kill(); rmSync(trash, { recursive: true, force: true }); rmSync(fake, { recursive: true, force: true }); });

const list = (q?: string) => host.list("system", "system", q);

describe("system", () => {
  test("meta: a live palette, indexed (not input), so its rows are root results", () => {
    expect(host.loaded().find((l) => l.extension === "system")!.palettes[0]).toMatchObject({ name: "system", title: "System", live: true, input: false, icon: tile("slate", "\u{f0425}") });
  });

  test("only available commands, mapped one to one, one run action each", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["sleep", "shutdown", "empty-trash", "dark-mode", "quit-all", "unhide-all", ...(MAC ? ["dismiss-notifications"] : [])]);
    // The app commands wear their own glyphs too.
    expect(items.slice(4).map((i) => i.icon)).toEqual(["\u{f0c5e}", "\u{f06d0}", ...(MAC ? ["\u{f039f}"] : [])]);
    // The row draws the extension's glyph for the id, not the core's text symbol.
    expect(items[0]).toEqual({ id: "sleep", name: "Sleep", subtitle: "Put the machine to sleep", icon: "\u{f0904}", keywords: ["suspend"], accessories: [], actions: [{ id: "run", title: "Sleep" }] });
  });

  test("Empty Trash counts what is in the Trash (.DS_Store aside); Toggle Dark Mode tags the current appearance", async () => {
    const by = Object.fromEntries((await list()).map((i) => [i.id, i]));
    expect(by["empty-trash"].accessories).toEqual([{ text: "2 items" }]);
    rmSync(join(trash, "b.txt"));
    expect((await list()).find((i) => i.id === "empty-trash")!.accessories).toEqual([{ text: "1 item" }]);
    rmSync(join(trash, "a.txt"));
    expect((await list()).find((i) => i.id === "empty-trash")!.accessories).toEqual([{ text: "empty" }]);
    if (MAC) expect(by["dark-mode"].accessories).toEqual([{ tag: expect.stringMatching(/^(dark|light)$/), color: expect.stringMatching(/^(violet|amber)$/) }]);
    else expect(by["dark-mode"].accessories!.length).toBeLessThanOrEqual(1);
  });

  test("an unreadable Trash is a row without a count", async () => {
    process.env.PAL_TRASH_DIR = join(trash, "nope");
    const h = await Host.bundled({ core: { "system.commands": () => COMMANDS } });
    expect((await h.list("system", "system")).find((i) => i.id === "empty-trash")!.accessories).toEqual([]);
    h.kill();
    process.env.PAL_TRASH_DIR = trash;
  });

  test("destructive rows carry a confirm while the setting is on, not when it is off", async () => {
    const on = await list();
    expect(on[1].actions).toEqual([{ id: "run", title: "Shut Down", style: "destructive", confirm: "Shut Down now?" }]);
    expect(on[2].actions![0].confirm).toBe("Empty Trash now?");
    expect(on[4].actions![0]).toEqual({ id: "run", title: "Quit All Apps", style: "destructive", confirm: "Quit All Apps now?" });
    expect(on[5].actions![0].confirm).toBeUndefined();
    expect(on[0].actions![0].confirm).toBeUndefined();
    host.changeSettings("system", { settings: { confirm_destructive: false } });
    const off = await list();
    expect(off[1].actions).toEqual([{ id: "run", title: "Shut Down" }]);
    expect(off.every((i) => i.actions![0].confirm === undefined)).toBe(true);
    host.changeSettings("system", {});
    expect((await list())[1].actions![0].confirm).toBe("Shut Down now?");
  });

  test("the list ignores a query: matching is the index's", async () => {
    expect((await list("shut")).map((i) => i.id)).toEqual(["sleep", "shutdown", "empty-trash", "dark-mode", "quit-all", "unhide-all", ...(MAC ? ["dismiss-notifications"] : [])]);
  });

  test("pick runs through the core and hides; a refusal is a failure toast that keeps the palette", async () => {
    expect(await host.pick("system", "system", "shutdown", "run")).toEqual({});
    expect(ran).toEqual(["shutdown"]);
    expect(await host.pick("system", "system", "sleep")).toEqual({ keep: true, toast: { title: "Command failed", message: "pmset: not permitted", style: "failure" } });
  });
});

// ---- keep awake -------------------------------------------------------------------

const NOW = new Date(2026, 8, 22, 14, 10, 0).getTime();
const run = (o: Partial<Awake> = {}): Awake => ({ pid: 4242, started: NOW - 15 * 60_000, until: NOW + 45 * 60_000, display: true, ...o });

describe("keep awake: the spellings and the texts", () => {
  test("parseTarget: durations from now, a clock time today or tomorrow, am/pm, forever; blank and junk are nothing", () => {
    expect(parseTarget("45m", NOW)).toEqual({ until: NOW + 45 * 60_000, how: "for" });
    expect(parseTarget("1h30m", NOW)).toEqual({ until: NOW + 90 * 60_000, how: "for" });
    expect(parseTarget("90", NOW)).toEqual({ until: NOW + 90 * 60_000, how: "for" });
    expect(parseTarget("14:30", NOW)).toEqual({ until: NOW + 20 * 60_000, how: "until" });
    expect(parseTarget("until 14:30", NOW)).toEqual({ until: NOW + 20 * 60_000, how: "until" });
    // 14:05 has passed at 14:10: tomorrow's.
    expect(parseTarget("14:05", NOW)).toEqual({ until: NOW + (24 * 60 - 5) * 60_000, how: "until" });
    expect(parseTarget("2:30pm", NOW)).toEqual({ until: NOW + 20 * 60_000, how: "until" });
    expect(parseTarget("3pm", NOW)).toEqual({ until: NOW + 50 * 60_000, how: "until" });
    expect(parseTarget("12am", NOW)).toEqual({ until: new Date(2026, 8, 23, 0, 0, 0).getTime(), how: "until" });
    for (const f of ["forever", "inf", "∞", "0", "Always"]) expect(parseTarget(f, NOW)).toEqual({ until: null, how: "forever" });
    // `2:30` is a clock time (tomorrow's, at 14:10), not the timer's minutes and seconds.
    expect(parseTarget("2:30", NOW)).toEqual({ until: new Date(2026, 8, 23, 2, 30, 0).getTime(), how: "until" });
    for (const junk of ["", "  ", "soon", "25:99", "abc", "1h at"]) expect(parseTarget(junk, NOW)).toBeUndefined();
  });

  test("the countdown texts: the bar's short form, the popover's clock, the sentence's span", () => {
    expect([fmtLeft(2 * 3_600_000 + 40 * 60_000), fmtLeft(12 * 60_000), fmtLeft(45_000), fmtLeft(60_000), fmtLeft(0)]).toEqual(["2h 40m", "12m", "45s", "1m", "0s"]);
    expect([fmtClock(2 * 3_600_000 + 40 * 60_000 + 12_000), fmtClock(45_000), fmtClock(0)]).toEqual(["2:40:12", "0:45", "0:00"]);
    expect([fmtSpan(3_600_000), fmtSpan(90 * 60_000), fmtSpan(45 * 60_000), fmtSpan(90_000), fmtSpan(20_000)]).toEqual(["1 h", "1 h 30 min", "45 min", "2 min", "20 s"]);
  });

  test("describe and summary: for, until, until turned off, while an app runs, the display", () => {
    expect(describeRun(run(), "for", NOW)).toBe("Awake for 45 min");
    expect(describeRun(run(), "until", NOW)).toBe("Awake until 14:55");
    expect(describeRun(run({ until: null }), "forever", NOW)).toBe("Awake until turned off");
    expect(describeRun(run({ until: null, app: "Xcode" }), "forever", NOW)).toBe("Awake while Xcode runs");
    expect(summary(run(), NOW)).toBe("until 14:55, 45 min left, display too");
    expect(summary(run({ display: false, until: null }), NOW)).toBe("until turned off");
    expect(summary(run({ display: false, until: null, app: "Xcode" }), NOW)).toBe("while Xcode runs");
  });

  test("reconcile: no record, no such process, another process on the pid, a run past its end (stale: the caller kills it), a live one", () => {
    expect(reconcile(null, "caffeinate -di -t 100", NOW, "caffeinate")).toEqual({ awake: null, stale: false });
    expect(reconcile(run(), undefined, NOW, "caffeinate")).toEqual({ awake: null, stale: false });
    expect(reconcile(run(), "/usr/bin/bun run host.ts", NOW, "caffeinate")).toEqual({ awake: null, stale: false });
    expect(reconcile(run({ until: NOW - 1 }), "caffeinate -di -t 100", NOW, "caffeinate")).toEqual({ awake: null, stale: true });
    expect(reconcile(run(), "caffeinate -di -t 100", NOW, "caffeinate")).toEqual({ awake: run(), stale: false });
    expect(reconcile(run({ until: null }), "/bin/sh /tmp/x/caffeinate -i", NOW, "caffeinate")).toEqual({ awake: run({ until: null }), stale: false });
    expect(reconcile(run(), "systemd-inhibit --what=idle:sleep sleep 100", NOW, "/usr/bin/systemd-inhibit").awake).not.toBeNull();
  });

  test("nextTick: to the next whole minute of what is left, the next second under a minute or while the popover is up, nothing without an end", () => {
    expect(nextTick(run({ until: NOW + 2 * 60_000 + 15_000 }), NOW, false)).toBe(15_000);
    expect(nextTick(run({ until: NOW + 2 * 60_000 }), NOW, false)).toBe(60_000);
    expect(nextTick(run({ until: NOW + 45_300 }), NOW, false)).toBe(300);
    expect(nextTick(run({ until: NOW + 45_000 }), NOW, false)).toBe(1000);
    expect(nextTick(run({ until: NOW + 2 * 60_000 + 15_000 }), NOW, true)).toBe(1000);
    expect(nextTick(run({ until: null }), NOW, false)).toBeUndefined();
  });

  test("argv: caffeinate's flags, and systemd-inhibit around sleep, tail --pid or timeout", () => {
    expect(argv("caffeinate", { display: true, secs: 3600 })).toEqual(["caffeinate", "-di", "-t", "3600"]);
    expect(argv("/tmp/x/caffeinate", { display: false })).toEqual(["/tmp/x/caffeinate", "-i"]);
    expect(argv("caffeinate", { display: false, pid: 77 })).toEqual(["caffeinate", "-i", "-w", "77"]);
    expect(argv("systemd-inhibit", { display: true, secs: 60 })).toEqual(["systemd-inhibit", "--what=idle:sleep", "--who=pal", "--why=Keep awake", "sleep", "60"]);
    expect(argv("systemd-inhibit", { display: false })).toEqual(["systemd-inhibit", "--what=sleep", "--who=pal", "--why=Keep awake", "sleep", "infinity"]);
    expect(argv("systemd-inhibit", { display: false, pid: 77, secs: 60 })).toEqual(["systemd-inhibit", "--what=sleep", "--who=pal", "--why=Keep awake", "timeout", "60", "tail", "--pid=77", "-f", "/dev/null"]);
  });
});

describe("keep awake: the popover tree", () => {
  const st = (o: Partial<PopoverState> = {}): PopoverState => ({ awake: null, now: NOW, presets: ["30m", "1h", "2h", "forever"], display: true, defaultFor: "1h", field: false, tool: true, ...o });
  const texts = (v: View): string[] => { const out: string[] = []; const walk = (n: any) => { if (n.type === "text") out.push(n.value); if (n.type === "tile") out.push(`[${n.text}]`); n.children?.forEach(walk); }; walk(v.tree); return out; };

  test("off: what to expect, the presets as tiles with ∞ for forever, the display switch; Enter is the default", () => {
    const v = render(st());
    checkView(v, "test");
    expect(v.title).toBe("Keep Awake");
    expect(v.keys).toBe("actions");
    expect(texts(v)).toEqual(expect.arrayContaining(["Not kept awake; the machine sleeps as usual", "Awake for", "[30m]", "[1h]", "[2h]", "[∞]", "Display kept awake too"]));
    expect(actions(st()).slice(0, 2)).toEqual([{ id: "default", title: "Keep awake for 1h" }, { id: "preset:0", title: "Keep awake for 30m", shortcut: "1" }]);
    expect(actions(st()).map((a) => a.id)).toEqual(["default", "preset:0", "preset:1", "preset:2", "preset:3", "display", "until", "open"]);
    expect(actions(st({ display: false }))[5]).toEqual({ id: "display", title: "Keep the display awake too", shortcut: "d" });
  });

  test("on: the card with the end, the time left large and a bar; Enter allows sleep; the last minute is amber", () => {
    const v = render(st({ awake: run() }));
    checkView(v, "test");
    expect(v.title).toBe("Until 14:55, 45 min left, display too");
    expect(texts(v)).toEqual(expect.arrayContaining(["Awake until 14:55", "since 13:55", "45:00", "Keep for"]));
    expect(actions(st({ awake: run() }))[0]).toEqual({ id: "sleep", title: "Allow sleep", shortcut: "backspace" });
    const bar = (n: any): any => (n.type === "progress" ? n : n.children?.map(bar).find(Boolean));
    expect(bar(v.tree)).toMatchObject({ value: 0.25, color: "blue" });
    expect(bar(render(st({ awake: run({ until: NOW + 30_000 }) })).tree)).toMatchObject({ color: "amber" });
    expect(texts(render(st({ awake: run({ until: null, display: false }) })))).toEqual(expect.arrayContaining(["Awake until turned off", "∞"]));
    expect(texts(render(st({ awake: run({ until: null, app: "Xcode" }) })))).toContain("Awake while Xcode runs");
    for (const v of [st({ awake: run({ until: null }) }), st({ awake: run(), field: true }), st({ presets: [] }), st({ awake: run(), display: false })]) checkView(render(v), "test");
  });

  test("the field: the search row takes a spelling, Enter starts, Escape closes; five presets at most", () => {
    const v = render(st({ field: true }));
    expect(v.input).toEqual({ placeholder: "45m, 14:30, forever", submit: "start", cancel: "cancel" });
    expect(v.title).toBe("Keep awake for…");
    expect(actions(st({ field: true }))[0]).toEqual({ id: "start", title: "Keep awake" });
    expect(actions(st({ presets: ["1m", "2m", "3m", "4m", "5m", "6m"] })).filter((a) => a.id.startsWith("preset:")).length).toBe(5);
    const none = render(st({ tool: false }));
    checkView(none, "test");
    expect(texts(none)[0]).toContain("systemd-inhibit is not installed");
    expect(actions(st({ tool: false })).map((a) => a.id)).toEqual(["open"]);
  });
});

describe("keep awake: the row, the bar item and the link", () => {
  let h: Host;
  const pids: number[] = [];
  beforeAll(async () => {
    h = await Host.bundled({ core: { "system.commands": () => WITH_AWAKE } });
  });
  afterAll(() => { h.kill(); for (const pid of pids) { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } } });
  const list = () => h.list("system", "system");
  const pick = (action?: string, values?: Record<string, string | boolean>) => h.pick("system", "system", "keep-awake", action, values && { values });
  const awakeRow = async () => (await list()).find((i) => i.id === "keep-awake")!;
  const record = () => stored.get("system\0awake") as Awake | undefined;
  /** The Now section's rows from system: the run while one is on. */
  const suggested = async () => (await h.request<{ extension: string; items: { name: string }[] }[]>("suggest")).filter((s) => s.extension === "system").flatMap((s) => s.items.map((i) => i.name));

  test("meta: the bar item with its mocks, rules and keys; the states and the link declared", () => {
    const l = h.loaded().find((l) => l.extension === "system")!;
    expect(l.bar).toEqual([expect.objectContaining({ id: "awake", title: "Keep Awake", refresh: { every: 60, on: ["wake"] }, source: true, rules: [expect.objectContaining({ id: "ending", color: "amber" })], mocks: expect.objectContaining({ off: { title: "Not kept awake", item: { hidden: true, empty: { icon: "\u{f06ca}", tooltip: "Not kept awake" } } }, left: expect.objectContaining({ item: expect.objectContaining({ title: "25m" }) }), forever: expect.objectContaining({ item: expect.objectContaining({ title: "∞" }) }), display: expect.objectContaining({ item: expect.objectContaining({ segments: [expect.objectContaining({ id: "display" })] }) }) }), keys: expect.arrayContaining([{ keys: "d", title: expect.any(String) }, { keys: "u", title: expect.any(String) }]) })]);
    expect(Object.keys(l.manifest.states!)).toEqual(["awake", "awake_until", "awake_left", "awake_display"]);
    expect(Object.keys(l.manifest.links!.awake.params!)).toEqual(["for", "until", "display", "app", "off"]);
    expect(l.warnings).toEqual([]);
  });

  test("off: the row replaces the core's in its place, with the fields in the bar and three actions; the bar item is hidden with the coffee as its empty shape", async () => {
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["sleep", "shutdown", "empty-trash", "dark-mode", "keep-awake", "quit-all", "unhide-all", ...(MAC ? ["dismiss-notifications"] : [])]);
    const row = items[4];
    expect(row).toMatchObject({ name: "Keep Awake", subtitle: "Stop the machine from sleeping for 1h, or as long as you type", icon: "\u{f06ca}", keywords: expect.arrayContaining(["caffeinate", "awake"]) });
    expect(row.args).toEqual([
      { id: "for", placeholder: "45m, 2h, 14:30, forever (blank: 1h)" },
      { id: "display", placeholder: "Display", kind: "select", options: [{ id: "on", title: "Display too" }, { id: "off", title: "System only" }], default: "on" },
    ]);
    expect(row.actions).toEqual([{ id: "awake", title: "Keep awake" }, { id: "forever", title: "Keep awake until turned off" }, { id: "until", title: "Until a time, or while an app runs…", shortcut: "cmd+u" }]);
    const item = await h.render("system", "awake");
    expect(item).toMatchObject({ hidden: true, empty: { icon: "\u{f06ca}", tooltip: "Not kept awake" }, states: { awake: false, awake_until: null, awake_left: null, awake_display: false } });
    expect((item.empty!.menu as { view: View }).view.title).toBe("Keep Awake");
    expect(await suggested()).toEqual([]);
  });

  test("a spelling in the bar starts the tool with its flags and the HUD says for how long; the row turns into Allow Sleep with the time left; the item shows the countdown and publishes the facts", async () => {
    expect(await pick("awake", { for: "45m", display: "off" })).toEqual({ hud: "Awake for 45 min" });
    expect(await lastAsk()).toBe("-i -t 2700");
    const a = record()!;
    pids.push(a.pid);
    expect(alive(a.pid)).toBe(true);
    expect(a).toMatchObject({ display: false, until: expect.any(Number) });
    const row = await awakeRow();
    expect(row).toMatchObject({ name: "Allow Sleep", subtitle: expect.stringMatching(/^Awake until \d\d:\d\d, 45 min left$/), accessories: [{ tag: "45m", color: "amber" }] });
    expect(row.actions).toEqual([{ id: "sleep", title: "Allow sleep" }, { id: "awake", title: "Keep awake for…", args: true }, { id: "display", title: "Keep the display awake too", shortcut: "cmd+d" }]);
    const item = await h.render("system", "awake");
    expect(item).toMatchObject({ icon: "\u{f06ca}", title: "45m", tooltip: expect.stringMatching(/^Awake until \d\d:\d\d, 45 min left$/), states: { awake: true, awake_until: a.until, awake_left: 45, awake_display: false } });
    expect(item.segments).toBeUndefined();
    expect((item.menu as { view: View }).view.actions[0]).toEqual({ id: "sleep", title: "Allow sleep", shortcut: "backspace" });
    // The Now section carries the run.
    expect(await suggested()).toEqual(["Allow Sleep"]);
  });

  test("Enter while on allows sleep: the process is gone, the record too, the item hidden", async () => {
    const pid = record()!.pid;
    expect(await pick()).toEqual({ hud: "Sleep allowed" });
    await Bun.sleep(100);
    expect(alive(pid)).toBe(false);
    expect(record()).toBeUndefined();
    expect(await h.render("system", "awake")).toMatchObject({ hidden: true });
    expect(await pick("sleep")).toEqual({ hud: "Not kept awake" });
  });

  test("a bare pick toggles with the default (1h, display too); a bad spelling is a failure toast; the form's bad spelling comes back under its field", async () => {
    expect(await pick()).toEqual({ hud: "Awake for 1 h" });
    expect(await lastAsk()).toBe("-di -t 3600");
    pids.push(record()!.pid);
    expect(await pick("awake", { for: "soon" })).toEqual({ keep: true, toast: { title: "Not a duration or a time", message: "45m, 2h, 14:30, 2pm, or forever", style: "failure" } });
    const form = await pick("until");
    expect(form.form).toMatchObject({ id: "keep-awake", title: "Keep Awake", submit: { id: "start", title: "Keep awake" } });
    expect(form.form!.fields.map((f) => f.id)).toEqual(["until", "display", "app"]);
    expect(await pick("start", { until: "soon", display: false, app: "" })).toMatchObject({ form: { errors: { until: expect.stringContaining("Not a duration or a time") } } });
    expect(await pick("start", { until: "", display: false, app: "Nope" })).toMatchObject({ form: { errors: { app: 'No open window of an app named "Nope"' } } });
    // The form: a time and an app to follow (the harness's window fixture has kitty on pid 11).
    expect(await pick("start", { until: "", display: false, app: "kit" })).toEqual({ hud: "Awake while kitty runs" });
    expect(await lastAsk()).toBe("-i -w 11");
    pids.push(record()!.pid);
    expect(record()).toMatchObject({ app: "kitty", until: null, display: false });
    expect(await h.render("system", "awake")).toMatchObject({ title: "∞", tooltip: "Awake while kitty runs", states: { awake: true, awake_until: null, awake_left: null } });
  });

  test("cmd+d flips the display: a new process for what is left of the run, the old one gone", async () => {
    const before = record()!;
    expect(await pick("display")).toEqual({ hud: "Display kept awake too" });
    expect(await lastAsk()).toBe("-di -w 11");
    await Bun.sleep(100);
    expect(alive(before.pid)).toBe(false);
    const after = record()!;
    pids.push(after.pid);
    expect(after.pid).not.toBe(before.pid);
    expect(after).toMatchObject({ display: true, app: "kitty" });
    expect(await h.render("system", "awake")).toMatchObject({ segments: [{ id: "display", icon: "\u{f0379}", color: "muted", tooltip: "Display kept awake too" }], states: { awake_display: true } });
  });

  test("the popover: a preset starts a run from now, the display switch flips it, the field takes a spelling, Enter allows sleep", async () => {
    expect(await h.barAction("system", "awake", "preset:2")).toEqual({ keep: true, hud: "Awake for 2 h" });
    expect(await lastAsk()).toBe("-di -t 7200");
    pids.push(record()!.pid);
    expect(await h.barAction("system", "awake", "display")).toEqual({ keep: true, hud: "Display may sleep now" });
    expect(await lastAsk()).toMatch(/^-i -t 7[12]\d\d$/);
    pids.push(record()!.pid);
    expect(await h.barAction("system", "awake", "until")).toEqual({ keep: true });
    expect(((await h.render("system", "awake")).menu as { view: View }).view.input).toMatchObject({ submit: "start" });
    expect(await h.barAction("system", "awake", "start", { reason: "open", values: { input: "15:00" } })).toMatchObject({ keep: true, hud: expect.stringMatching(/^Awake until 15:00$/) });
    pids.push(record()!.pid);
    expect(((await h.render("system", "awake")).menu as { view: View }).view.input).toBeUndefined();
    expect(await h.barAction("system", "awake", "start", { reason: "open", values: { input: "nope" } })).toMatchObject({ toast: { title: "Not a duration or a time" } });
    expect(await h.barAction("system", "awake", "sleep")).toEqual({ keep: true, hud: "Sleep allowed" });
    expect(record()).toBeUndefined();
    // Off: the switch remembers the choice for the next run without starting one.
    expect(await h.barAction("system", "awake", "display")).toEqual({ keep: true });
    expect(await h.barAction("system", "awake", "default")).toEqual({ keep: true, hud: "Awake for 1 h" });
    expect(await lastAsk()).toBe("-i -t 3600");
    pids.push(record()!.pid);
    expect(await h.barAction("system", "awake", "open")).toEqual({ push: { extension: "system", palette: "system" } });
    await h.barAction("system", "awake", "sleep");
  });

  test("the link: for and display, off, the bare toggle, run?id=keep-awake, a bad spelling", async () => {
    const link = (params: Record<string, unknown> = {}) => h.request<any>("link", { extension: "system", route: "awake", params });
    expect(await link({ for: "2h", display: "1" })).toEqual({ hud: "Awake for 2 h" });
    expect(await lastAsk()).toBe("-di -t 7200");
    pids.push(record()!.pid);
    expect(await link()).toEqual({ hud: "Sleep allowed" });
    expect(await link({ off: "1" })).toEqual({ hud: "Not kept awake" });
    expect(await link({ until: "forever" })).toEqual({ hud: "Awake until turned off" });
    expect(await lastAsk()).toBe("-di");
    pids.push(record()!.pid);
    expect(await h.request<any>("link", { extension: "system", route: "run", params: { id: "keep-awake" } })).toEqual({ hud: "Sleep allowed" });
    await expect(link({ for: "soon" })).rejects.toThrow(/not a duration or a time: "soon"/);
    await expect(link({ app: "Nope" })).rejects.toThrow(/no open window of an app named "Nope"/);
    expect(record()).toBeUndefined();
  });

  test("a run that ends on its own: the record is cleared on the next read, the bar told, the HUD says so", async () => {
    expect(await pick("awake", { for: "1s" })).toEqual({ hud: "Awake for 1 s" });
    const pid = record()!.pid;
    const huds = () => h.coreCalls.filter((c) => c.method === "effects.run").map((c) => (c.params as any).effect.hud);
    const from = huds().length;
    await h.until(() => !alive(pid), 4000, "the fake caffeinate's -t");
    await h.until(() => huds().length > from, 3000, "the HUD");
    expect(huds().at(-1)).toBe("Keep awake ended, sleep allowed");
    expect(record()).toBeUndefined();
    expect(h.updates("system", "awake").at(-1)).toMatchObject({ hidden: true });
  });

  test("a record from a previous run whose process is gone (or is something else now) is dropped on load, silently", async () => {
    stored.set("system\0awake", { pid: 999_999, started: NOW, until: null, display: true });
    let h2 = await Host.bundled({ core: { "system.commands": () => WITH_AWAKE } });
    expect(await h2.render("system", "awake")).toMatchObject({ hidden: true, states: { awake: false } });
    expect(stored.get("system\0awake")).toBeUndefined();
    expect(h2.coreCalls.some((c) => c.method === "effects.run")).toBe(false);
    h2.kill();
    // The pid is alive but it is this test's bun, not caffeinate.
    stored.set("system\0awake", { pid: process.pid, started: NOW, until: NOW + 3_600_000, display: true });
    h2 = await Host.bundled({ core: { "system.commands": () => WITH_AWAKE } });
    expect((await awakeRowOf(h2)).name).toBe("Keep Awake");
    expect(stored.get("system\0awake")).toBeUndefined();
    h2.kill();
  });

  test("a live process is found back by a fresh host: the run continues across a restart", async () => {
    expect(await pick("awake", { for: "30m" })).toEqual({ hud: "Awake for 30 min" });
    const a = record()!;
    pids.push(a.pid);
    const h2 = await Host.bundled({ core: { "system.commands": () => WITH_AWAKE } });
    expect(await h2.render("system", "awake")).toMatchObject({ title: expect.stringMatching(/^(30m|29m)$/), states: { awake: true, awake_until: a.until } });
    expect(await h2.pick("system", "system", "keep-awake")).toEqual({ hud: "Sleep allowed" });
    await Bun.sleep(100);
    expect(alive(a.pid)).toBe(false);
    h2.kill();
  });
});

const awakeRowOf = async (h: Host) => (await h.list("system", "system")).find((i) => i.id === "keep-awake")!;
