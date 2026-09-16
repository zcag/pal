// The owner's `timer` tool (`~/.local/bin/timer`, dotty) as an extension.
// The CLI keeps the timers: one detached process per timer that fires on
// its own, and one KV file per timer under its state directory
// (`<id>.state`: `id`, `name`, `total`, `deadline`, `left`, `state`,
// `fired`, `auto`, ... as bash `printf %q` writes them). pal is a view of
// that directory, like the owner's sketchybar item was, and asks the CLI
// for every change (`timer 25m tea`, `pause`, `resume`, `add`, `stop`,
// `done`), so a timer started from a terminal and one started here are
// the same thing.
//
// The bar item `timer`: the soonest timer's remaining time as the title, a
// fill for how far along it is, blue then amber then red, muted while
// paused, and an alarm (`urgent`) once it lands; hidden with no timer at
// all. A click opens the `timers` palette. The core asks every 10 s; the
// second-level ticks are the extension's own: an `fs.watch` on the
// directory pushes on every change the CLI makes, and a 1 Hz interval
// pushes the countdown, running only while a timer runs.
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { bar, home, settings, type Action, type BarItem, type Effect, type Extension, type Form, type Item } from "@zcag/pal";

type Settings = { command: string; dir: string };
type State = "running" | "paused" | "done";
type Timer = { id: string; name: string; total: number; deadline: number; left: number; state: State; fired: number; auto: boolean };

const EXTENSION = "timer", ITEM = "timer", PALETTE = "timers";
/** nf-md-timer, drawn from the bundled Nerd Font; nf-md-plus for the New row, nf-md-alert for a missing CLI. */
const GLYPH = "\u{f0954}";
const PLUS = "\u{f0415}";
const WARN = "\u{f0026}";
/** The CLI's default `TIMER_DONE_TTL`: how long a landed timer's badge lingers. */
const DONE_TTL = 300;
const NEW = "new";
const ADD = "5m";
const CLI_MS = 5000;

const conf = () => settings.get<Settings>(EXTENSION);
const dirOf = () => home(conf().dir);
const now = () => Math.floor(Date.now() / 1000);

// ---- the state directory ----------------------------------------------------

/** bash `printf %q` undone: backslash escapes, `'...'`, and `$'...'` with the ANSI-C escapes it uses for control characters. */
export function unquote(v: string): string {
  if (/^\$'[\s\S]*'$/.test(v)) return v.slice(2, -1).replace(/\\(n|t|\\|')/g, (_, c: string) => ({ n: "\n", t: "\t", "\\": "\\", "'": "'" })[c]!);
  if (/^'[\s\S]*'$/.test(v)) return v.slice(1, -1).replace(/'\\''/g, "'");
  return v.replace(/\\(.)/g, "$1");
}

/** Seconds left as the CLI counts them: to the deadline, the frozen `left`, or none. */
const secsLeft = (t: Timer) => (t.state === "running" ? Math.max(0, t.deadline - now()) : t.state === "paused" ? t.left : 0);
/** The CLI's rank: landed ones first (newest), then running (soonest), then paused. */
const rank = (t: Timer) => (t.state === "done" ? [0, now() - t.fired] : t.state === "running" ? [1, secsLeft(t)] : [2, secsLeft(t)]);

/**
 * Every timer in `dir`, most urgent first. The CLI's reap rules apply on
 * read: a running timer a minute past its deadline with nobody watching
 * would have fired, and a landed one past the badge's ttl is gone; a
 * running one just past its deadline is landed (its watcher is about to
 * write that).
 */
export async function readTimers(dir: string): Promise<Timer[]> {
  let files: string[];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".state")); } catch { return []; }
  const out: Timer[] = [];
  for (const f of files) {
    let text: string;
    try { text = await readFile(join(dir, f), "utf8"); } catch { continue; }
    const kv: Record<string, string> = {};
    for (const line of text.split("\n")) { const i = line.indexOf("="); if (i > 0) kv[line.slice(0, i)] = unquote(line.slice(i + 1)); }
    const t: Timer = { id: kv.id, name: kv.name || kv.id, total: Number(kv.total) || 0, deadline: Number(kv.deadline) || 0, left: Number(kv.left) || 0, state: kv.state as State, fired: Number(kv.fired) || 0, auto: kv.auto === "1" };
    if (!t.id || !["running", "paused", "done"].includes(t.state)) continue;
    if (t.state === "running" && t.deadline - now() <= -60) continue;
    if (t.state === "running" && t.deadline <= now()) { t.state = "done"; t.fired = t.deadline; t.left = 0; }
    if (t.state === "done" && now() - t.fired >= DONE_TTL) continue;
    out.push(t);
  }
  return out.sort((a, b) => { const [x, y] = [rank(a), rank(b)]; return x[0] - y[0] || x[1] - y[1]; });
}

/** 754 -> 12:34, 3754 -> 1:02:34, as the CLI prints it. */
export const fmt = (s: number): string => {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};

// ---- the CLI ----------------------------------------------------------------

/** `timer <args>` against the configured directory; the CLI's complaint is the error. */
async function timer(...args: string[]): Promise<string> {
  const s = conf();
  const cmd = cliPath();
  if (!cmd) throw new Error(`${s.command} is not installed`);
  const proc = Bun.spawn([cmd, ...args], { env: { ...process.env, TIMER_DIR: home(s.dir) }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const kill = setTimeout(() => proc.kill(), CLI_MS);
  try {
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    const code = await proc.exited;
    if (code !== 0) throw new Error(err.trim().replace(/^timer: /, "") || out.trim() || `timer exited ${code}`);
    return out.trim();
  } finally { clearTimeout(kill); }
}

// ---- the bar item -------------------------------------------------------------

export function barItem(ts: Timer[]): BarItem {
  const t = ts[0];
  if (!t) return { hidden: true };
  const more = ts.length > 1 ? ` (+${ts.length - 1} more)` : "";
  const menu = { palette: PALETTE, extension: EXTENSION };
  if (t.state === "done") return { icon: GLYPH, title: (t.auto ? "Done" : t.name).slice(0, 24), urgent: true, progress: 1, tooltip: `${t.name} landed ${fmt(now() - t.fired)} ago${more}`, menu };
  const left = secsLeft(t);
  const pct = t.total > 0 ? Math.min(1, Math.max(0, (t.total - left) / t.total)) : 0;
  const color = t.state === "paused" ? "muted" : pct > 0.9 ? "red" : pct > 0.66 ? "amber" : "blue";
  return { icon: GLYPH, title: fmt(left), progress: pct, color, tooltip: `${t.name}${t.state === "paused" ? ", paused" : ""}${more}`, menu };
}

let tick: ReturnType<typeof setInterval> | undefined;
let watcher: { dir: string; w: FSWatcher } | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;

/** Reads and pushes; the 1 Hz tick runs only while a timer runs (a paused or landed one does not change by itself). */
async function push() {
  const ts = await readTimers(dirOf());
  follow(ts);
  await bar.update(ITEM, barItem(ts), EXTENSION).catch(() => {});
}

function follow(ts: Timer[]) {
  if (ts.some((t) => t.state === "running")) tick ??= setInterval(() => { push().catch(() => {}); }, 1000);
  else { clearInterval(tick); tick = undefined; }
}

/** One watcher on the directory (made if missing, as the CLI does), replaced when the setting moves it; a burst of writes is one push. */
async function watchDir() {
  const dir = dirOf();
  if (watcher?.dir === dir) return;
  watcher?.w.close();
  watcher = undefined;
  await mkdir(dir, { recursive: true }).catch(() => {});
  try {
    const w = watch(dir, () => { clearTimeout(pending); pending = setTimeout(() => { push().catch(() => {}); }, 50); });
    w.on("error", () => { if (watcher?.w === w) watcher = undefined; });
    watcher = { dir, w };
  } catch { /* an unreadable directory: the core's timer still asks */ }
}

async function renderBar(): Promise<BarItem> {
  await watchDir();
  const ts = await readTimers(dirOf());
  follow(ts);
  return barItem(ts);
}

// ---- the palette ------------------------------------------------------------------

const STATE: Record<State, { tag: string; color: string }> = { running: { tag: "running", color: "blue" }, paused: { tag: "paused", color: "amber" }, done: { tag: "done", color: "red" } };

function row(t: Timer): Item {
  const left = secsLeft(t);
  const subtitle = t.state === "done" ? `Landed ${fmt(now() - t.fired)} ago` : t.state === "paused" ? `Paused at ${fmt(left)}` : `${fmt(left)} left, done at ${new Date(t.deadline * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const first: Action = t.state === "done" ? { id: "done", title: "Dismiss" } : t.state === "paused" ? { id: "resume", title: "Resume" } : { id: "pause", title: "Pause" };
  const actions: Action[] = [first, { id: "add", title: "Add 5 minutes", shortcut: "cmd++" }, { id: "stop", title: "Stop", shortcut: "cmd+d", style: "destructive" }];
  return { id: t.id, name: t.name, subtitle, icon: GLYPH, keywords: ["timer", t.state], accessories: [{ tag: STATE[t.state].tag, color: STATE[t.state].color }], actions };
}

const newRow: Item = { id: NEW, name: "New timer", subtitle: "A duration and a name", icon: PLUS, keywords: ["timer", "start", "countdown"], actions: [{ id: "new", title: "New timer" }] };

const form = (errors?: Record<string, string>): Form => ({
  id: NEW,
  title: "New timer",
  fields: [
    { kind: "text", id: "duration", label: "Duration", placeholder: "25m, 90s, 1h30m, 2:30, 25", required: true, description: "A bare number is minutes." },
    { kind: "text", id: "name", label: "Name", placeholder: "tea", description: "Optional; the duration otherwise. A name already taken restarts that timer." },
    { kind: "checkbox", id: "ring", label: "Phone", text: "Ring the phone out loud when it lands" },
  ],
  submit: { id: "start", title: "Start" },
  errors,
});

/** The CLI as the setting names it, on PATH or as a path; nothing when neither exists. */
const cliPath = () => { const c = conf().command; return Bun.which(c) ?? (Bun.file(home(c)).size > 0 ? home(c) : undefined); };

async function list(): Promise<Item[]> {
  const ts = await readTimers(dirOf());
  if (!cliPath()) return [...ts.map(row), { id: "hint:cli", name: `${conf().command} is not installed`, subtitle: "Set timer command in Settings to the timer CLI; the rows above are read from its state directory", icon: WARN, actions: [] }];
  return [...ts.map(row), newRow];
}

async function pick(id: string, action?: string, ctx?: { values?: Record<string, string | boolean> }): Promise<Effect> {
  if (id === NEW) {
    if (action !== "start") return { form: form() };
    const v = ctx?.values ?? {};
    const duration = String(v.duration ?? "").trim(), name = String(v.name ?? "").trim();
    if (!duration) return { form: form({ duration: "A duration is needed" }) };
    let out: string;
    try { out = await timer(duration, ...(name ? [name] : []), ...(v.ring ? ["--ring"] : [])); } catch (e) { return { form: form({ duration: (e as Error).message }) }; }
    return { keep: true, toast: { title: "Timer started", message: out } };
  }
  const args = action === "add" ? ["add", ADD, id] : action === "done" ? ["done"] : [action ?? "pause", id];
  try { await timer(...args); } catch (e) { return { keep: true, toast: { title: `Could not ${action ?? "pause"} the timer`, message: (e as Error).message, style: "failure" } }; }
  return { keep: true };
}

export default {
  palettes: {
    [PALETTE]: {
      title: "Timers",
      icon: GLYPH,
      live: true,
      placeholder: "Find a timer by name",
      list,
      pick,
    },
  },
  bar: {
    [ITEM]: { render: renderBar },
  },
  dispose: () => { clearInterval(tick); clearTimeout(pending); watcher?.w.close(); },
} satisfies Extension;
