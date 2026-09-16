// timer against a temp state directory (the KV files the owner's CLI
// writes) and a fake `timer` on a path setting that records what it was
// asked and edits the files the way the real one would. The bar item's
// pushes (fs.watch and the 1 Hz tick) are real, so this test takes seconds.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BarItem } from "../../../sdk/src/index.ts";
import { fmt, readTimers, unquote } from "../../../extensions/timer/index.ts";
import { Host } from "../harness.ts";

const base = mkdtempSync(join(tmpdir(), "pal-timer-"));
const dir = join(base, "state");
const log = join(base, "cli.log");
const cli = join(base, "timer");
writeFileSync(cli, `#!/bin/sh
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
chmodSync(cli, 0o755);

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
    expect(l.bar).toEqual([{ id: "timer", title: "Timer", description: expect.any(String), refresh: { every: 10, on: ["wake"] }, source: true }]);
  });

  test("the state directory is made on the first render; no timers is hidden, and the palette has only the New row", async () => {
    expect(await render()).toEqual({ hidden: true });
    expect(existsSync(dir)).toBe(true);
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["new"]);
    expect(items[0]).toMatchObject({ name: "New timer", actions: [{ id: "new", title: "New timer" }] });
  });

  test("the strip: the soonest running timer's time left with a fill and a colour by progress, a landed one as the alarm, a paused one muted", async () => {
    put("tea", { state: "running", deadline: now() + 600 });
    put("eggs", { state: "paused", left: 30 });
    put("pizza", { state: "done", fired: now() - 10, auto: true, name: "25m" });
    const done = await render();
    expect(done).toMatchObject({ icon: "\u{f0954}", title: "Done", urgent: true, progress: 1, tooltip: "25m landed 0:10 ago (+2 more)", menu: { palette: "timers", extension: "timer" } });
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
    expect(await render()).toEqual({ hidden: true });
    put("tea", { state: "running", deadline: now() + 300 });
    const first = await host.nextUpdate("timer", "timer", (i) => !i.hidden);
    expect(["5:00", "4:59"]).toContain(first.title!);
    const second = await host.nextUpdate("timer", "timer", (i) => i.title === "4:59", 2500);
    expect(second.progress).toBeCloseTo((1500 - 299) / 1500, 3);
    await host.nextUpdate("timer", "timer", (i) => i.title === "4:58", 2500);
    unlinkSync(join(dir, "tea.state"));
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
    expect(items.map((i) => i.id)).toEqual(["pizza", "tea", "eggs", "new"]);
    expect(items[0]).toMatchObject({ name: "pizza", subtitle: "Landed 0:10 ago", accessories: [{ tag: "done", color: "red" }] });
    expect(items[0].actions!.map((a) => a.id)).toEqual(["done", "add", "stop"]);
    expect(items[1]).toMatchObject({ name: "tea", subtitle: expect.stringMatching(/^(10:00|9:59) left, done at /), accessories: [{ tag: "running", color: "blue" }] });
    expect(items[1].actions!.map((a) => a.id)).toEqual(["pause", "add", "stop"]);
    expect(items[2]).toMatchObject({ name: "eggs", subtitle: "Paused at 0:30", accessories: [{ tag: "paused", color: "amber" }] });
    expect(items[2].actions!.map((a) => a.id)).toEqual(["resume", "add", "stop"]);
    expect(await pick("tea", "pause")).toEqual({ keep: true });
    expect(readFileSync(join(dir, "tea.state"), "utf8")).toContain("state=paused");
    expect(await pick("tea", "resume")).toEqual({ keep: true });
    expect(await pick("tea", "add")).toEqual({ keep: true });
    expect(await pick("pizza", "done")).toEqual({ keep: true });
    expect(await pick("eggs", "stop")).toEqual({ keep: true });
    expect(existsSync(join(dir, "eggs.state"))).toBe(false);
    expect(asked()).toEqual(["pause tea", "resume tea", "add 5m tea", "done", "stop eggs"]);
    clear();
  });

  test("New timer: a form; a duration the CLI refuses comes back as its error under the field; a good one starts it", async () => {
    clear();
    const f = await pick("new", "new");
    expect(f.form).toMatchObject({ id: "new", title: "New timer", submit: { id: "start", title: "Start" } });
    expect((f.form as any).fields.map((x: any) => [x.id, x.kind])).toEqual([["duration", "text"], ["name", "text"], ["ring", "checkbox"]]);
    expect(await pick("new", "start", { duration: "  ", name: "" })).toMatchObject({ form: { errors: { duration: "A duration is needed" } } });
    expect(await pick("new", "start", { duration: "nope", name: "" })).toMatchObject({ form: { errors: { duration: "bad duration 'nope' (try 25m, 90s, 1h30m, 2:30)" } } });
    expect(await pick("new", "start", { duration: "25m", name: "tea", ring: true })).toEqual({ keep: true, toast: { title: "Timer started", message: "tea started" } });
    expect(asked().at(-1)).toBe("25m tea --ring");
    expect((await list()).map((i) => i.id)).toEqual(["tea", "new"]);
    expect(await pick("new", "start", { duration: "90s" })).toMatchObject({ keep: true });
    expect(asked().at(-1)).toBe("90s");
    unlinkSync(join(dir, "90s.state"));
    clear();
  });

  test("a stopped timer is a toast when the CLI refuses", async () => {
    expect(await pick("gone", "nope")).toMatchObject({ keep: true, toast: { title: "Could not nope the timer", style: "failure" } });
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
