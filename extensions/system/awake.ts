// Keep awake: `caffeinate` (Linux: `systemd-inhibit`) run by the
// extension, for a while, until a time, while an app runs, or until turned
// off. The tool does the timing itself (`caffeinate -t <secs>`, `sleep
// <secs>` under systemd-inhibit), so a run ends on time whether or not pal
// is up; pal keeps one record of the run (pid, until, display, app) in
// storage and reconciles it against the live process on every read: the
// pid alive and its command line the tool's (a reboot may hand the number
// to something else), and the deadline not passed. The child is spawned
// unref'd and outlives the host (reparented to launchd / init; verified
// with a bun scratch script, 2026-09-22), so a host restart finds the same
// run back by its pid rather than starting over.
//
// The pure parts (the spelling of a target, the time left, the
// reconciliation) are exported for the tests; the process parts take the
// tool from `PAL_AWAKE_TOOL` so a test can stand a script in for it.
import { basename } from "node:path";
import { clock, exec, parseDuration, windows } from "@zcag/pal";

/** One run: the process, when it started, when it ends (`null`: until turned off, or while `app` runs), and whether the display is kept up too. */
export type Awake = { pid: number; started: number; until: number | null; display: boolean; app?: string };

/** What a spelling asks for: an end (`null` for none) and how it was said, for the HUD's line. */
export type Target = { until: number | null; how: "for" | "until" | "forever" };

/** The tool, or what the tests put in its place (a script named like it); `null` when the machine lacks it (Linux without systemd). */
export const TOOL: string | null = process.env.PAL_AWAKE_TOOL || (process.platform === "darwin" ? "caffeinate" : Bun.which("systemd-inhibit") ?? null);
/** The tool gets this long to die at once (a refused inhibit); alive past it is a run. */
const SETTLE_MS = 150;
const FOREVER = new Set(["forever", "inf", "infinite", "infinity", "∞", "always", "indefinitely", "on", "0"]);

/**
 * `45m`, `2h`, `1h30m`, a bare number of minutes (`parseDuration`); a
 * clock time `14:30`, `2pm`, `2:30pm`, with or without `until`/`till`/`at`
 * in front (the next such moment: tomorrow's when today's has passed);
 * `forever`, `inf`, `∞`, `0` for no end. Anything else is `undefined`; a
 * blank is too (the caller's default applies).
 */
export function parseTarget(input: string, now: number): Target | undefined {
  const t = input.trim().toLowerCase().replace(/^(until|till|at)\s+/, "");
  if (!t) return;
  if (FOREVER.has(t)) return { until: null, how: "forever" };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
  if (m && (m[2] !== undefined || m[3])) {
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (m[3] === "pm" && h < 12) h += 12;
    if (m[3] === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) return;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    return { until: d.getTime(), how: "until" };
  }
  const secs = parseDuration(t);
  return secs ? { until: now + secs * 1000, how: "for" } : undefined;
}

/** `2h 40m`, `40m`, `45s`: the bar's countdown. */
export function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
}

/** `2:40:12`, `40:12`, `0:45`: the popover's big figure. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** `1 h`, `1 h 30 min`, `45 min`, `90 s`: a span as a sentence says it. */
export function fmtSpan(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return m ? `${m} min` : `${s} s`;
}

/** The HUD's line for a run that just started: `Awake for 1 h`, `Awake until 14:30`, `Awake until turned off`, `Awake while Xcode runs`. */
export function describe(a: Pick<Awake, "until" | "app">, how: Target["how"], now: number): string {
  if (a.app) return `Awake while ${a.app} runs`;
  if (a.until === null) return "Awake until turned off";
  return how === "for" ? `Awake for ${fmtSpan(a.until - now)}` : `Awake until ${clock(a.until)}`;
}

/** What the run is, for a subtitle or a tooltip: `until 14:30, 44 min left`, `until turned off`, `while Xcode runs`; `, display too` when it is. */
export function summary(a: Pick<Awake, "until" | "display" | "app">, now: number): string {
  const when = a.app ? `while ${a.app} runs` : a.until === null ? "until turned off" : `until ${clock(a.until)}, ${fmtSpan(a.until - now)} left`;
  return a.display ? `${when}, display too` : when;
}

/**
 * The record against the live process: kept when the pid is alive, its
 * command line is the tool's (`command` is what `ps` says, `undefined`
 * for no such process) and the deadline has not passed; gone otherwise.
 * `stale` says the process is still there past its deadline (the tool is
 * about to exit; the caller kills it rather than wait).
 */
export function reconcile(a: Awake | null, command: string | undefined, now: number, tool = TOOL ?? "caffeinate"): { awake: Awake | null; stale: boolean } {
  if (!a) return { awake: null, stale: false };
  if (!command?.includes(basename(tool))) return { awake: null, stale: false };
  if (a.until !== null && a.until <= now) return { awake: null, stale: true };
  return { awake: a, stale: false };
}

/** Ms until the countdown's text next changes: at the next whole second under a minute (or while `fine`, the popover's seconds), else at the next whole minute of what is left; nothing for a run with no end. */
export function nextTick(a: Awake, now: number, fine: boolean): number | undefined {
  if (a.until === null) return;
  const left = Math.max(0, a.until - now);
  const step = fine || left <= 60_000 ? 1000 : 60_000;
  return Math.max(50, left % step || step);
}

/** The command line for a run: the tool with the display and idle assertions, a deadline in seconds, and a pid to follow. */
export function argv(tool: string, o: { display: boolean; secs?: number; pid?: number }): string[] {
  if (basename(tool) === "caffeinate") {
    return [tool, o.display ? "-di" : "-i", ...(o.secs !== undefined ? ["-t", String(o.secs)] : []), ...(o.pid !== undefined ? ["-w", String(o.pid)] : [])];
  }
  // systemd-inhibit holds the lock while its command runs: sleep for the deadline, tail a pid, or both under timeout.
  const cmd = o.pid !== undefined ? [...(o.secs !== undefined ? ["timeout", String(o.secs)] : []), "tail", `--pid=${o.pid}`, "-f", "/dev/null"] : ["sleep", o.secs !== undefined ? String(o.secs) : "infinity"];
  return [tool, `--what=${o.display ? "idle:sleep" : "sleep"}`, "--who=pal", "--why=Keep awake", ...cmd];
}

/** The process's command line as `ps` prints it, or `undefined` when there is no such process. */
export async function commandOf(pid: number): Promise<string | undefined> {
  const r = await exec(["ps", "-o", "command=", "-p", String(pid)], { ms: 2000 });
  return r.code === 0 && r.out.trim() ? r.out.trim() : undefined;
}

/** The pid of the first window of an app named like `name` (case-insensitive, a prefix will do), or nothing. */
export async function pidOfApp(name: string): Promise<{ app: string; pid: number } | undefined> {
  const q = name.trim().toLowerCase();
  if (!q) return;
  const ws = await windows.list();
  const w = ws.find((w) => w.app.toLowerCase() === q) ?? ws.find((w) => w.app.toLowerCase().startsWith(q));
  return w ? { app: w.app, pid: w.pid } : undefined;
}

/**
 * Starts the tool for `target` and answers the record. The child is
 * unref'd (the host's loop does not wait on it) and not killed with the
 * host; one that dies within `SETTLE_MS` is a failure with its stderr.
 */
export async function spawn(tool: string, o: { until: number | null; display: boolean; app?: { app: string; pid: number } }, now: number): Promise<Awake> {
  const secs = o.until === null ? undefined : Math.max(1, Math.ceil((o.until - now) / 1000));
  const proc = Bun.spawn(argv(tool, { display: o.display, secs, pid: o.app?.pid }), { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  proc.unref();
  await Bun.sleep(SETTLE_MS);
  if (proc.exitCode !== null) {
    const err = (await new Response(proc.stderr).text()).trim();
    throw new Error(`${basename(tool)}: ${err || `exited ${proc.exitCode}`}`);
  }
  return { pid: proc.pid, started: now, until: o.until, display: o.display, ...(o.app && { app: o.app.app }) };
}

/** Ends the run: SIGTERM to the tool (caffeinate drops its assertions on exit); a process already gone is fine. */
export function kill(pid: number): void {
  try { process.kill(pid, "SIGTERM"); } catch { /* gone already */ }
}
