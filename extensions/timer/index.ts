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
// all. A click opens the popover (view.ts): a card per timer with the
// time left large and a bar, the keys on the card with the ring (space
// pauses, `+` adds five minutes, backspace stops, arrows or a click move
// the ring), `n` opens the search row as a field (`25m tea`) that starts
// one, `o` opens the `timers` palette. The core asks every 10 s; the
// second-level ticks are the extension's own: an `fs.watch` on the
// directory pushes on every change the CLI makes, and a 1 Hz interval
// pushes the countdown, running while a timer runs or the popover is up
// (`bar.update` carries the popover's tree with the item, so both move).
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { bar, home, settings, storage, view as liveView, type Action, type BarItem, type Effect, type Extension, type Form, type Item, type LinkParams } from "@zcag/pal";
import { DEFAULT_RECENT, MAX_RECENT, current, fmt, render, secsLeft as leftAt, type PopoverState, type State, type Timer } from "./view.ts";

export { fmt };
type Settings = { command: string; dir: string };

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
const secsLeft = (t: Timer) => leftAt(t, now());
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

// The popover's own state, in process: the card the keys act on, whether
// the field is open (closed again when the popover leaves), and the last
// durations started from here (storage `recent`, for the tiles).
const pop: { cursor?: string; field: boolean; recent: string[]; open: boolean } = { field: false, recent: [], open: false };
const RECENT_KEY = "recent";
let recentLoaded = false;
async function loadRecent() {
  if (recentLoaded) return;
  recentLoaded = true;
  const v = await storage.get<unknown>(RECENT_KEY, EXTENSION).catch(() => null);
  if (Array.isArray(v)) pop.recent = v.filter((x): x is string => typeof x === "string").slice(0, MAX_RECENT);
}
async function remember(duration: string) {
  pop.recent = [duration, ...pop.recent.filter((d) => d !== duration)].slice(0, MAX_RECENT);
  await storage.set(RECENT_KEY, pop.recent, EXTENSION).catch(() => {});
}

/** The popover's tree for these timers: no timer and no field opens the field at once, so typing a duration is the first thing to do. */
export function popoverState(ts: Timer[]): PopoverState {
  return { timers: ts, cursor: pop.cursor, field: pop.field || ts.length === 0, recent: pop.recent.length ? pop.recent : DEFAULT_RECENT, now: now() };
}

export function barItem(ts: Timer[]): BarItem {
  const t = ts[0];
  if (!t) return { hidden: true };
  const more = ts.length > 1 ? ` (+${ts.length - 1} more)` : "";
  const menu = { view: render(popoverState(ts)) };
  if (t.state === "done") return { icon: GLYPH, title: (t.auto ? "Done" : t.name).slice(0, 24), urgent: true, progress: 1, tooltip: `${t.name} landed ${fmt(now() - t.fired)} ago${more}`, menu };
  const left = secsLeft(t);
  const pct = t.total > 0 ? Math.min(1, Math.max(0, (t.total - left) / t.total)) : 0;
  const color = t.state === "paused" ? "muted" : pct > 0.9 ? "red" : pct > 0.66 ? "amber" : "blue";
  return { icon: GLYPH, title: fmt(left), progress: pct, color, tooltip: `${t.name}${t.state === "paused" ? ", paused" : ""}${more}`, menu };
}

let tick: ReturnType<typeof setInterval> | undefined;
let watcher: { dir: string; w: FSWatcher } | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;

/** Reads and pushes the item, popover tree included (the page replaces the level in place, the field's text kept). */
async function push() {
  const ts = await readTimers(dirOf());
  follow(ts);
  await bar.update(ITEM, barItem(ts), EXTENSION).catch(() => {});
}

/** The 1 Hz tick runs while a timer runs, or while the popover is up (a landed card's "ago" and a paused one's ring still want the clock); off otherwise. */
function follow(ts: Timer[]) {
  if (ts.some((t) => t.state === "running") || (pop.open && ts.length)) tick ??= setInterval(() => { push().catch(() => {}); }, 1000);
  else { clearInterval(tick); tick = undefined; }
}

// The shell says when the popover's level is on top and when it left: the field closes with it, the tick follows. Hooked on the first render (the module is also imported by tests outside the host).
let hooked = false;
function hookViews() {
  if (hooked) return;
  hooked = true;
  liveView.onShown((ev) => { if (ev.bar === ITEM) { pop.open = true; push().catch(() => {}); } }, EXTENSION);
  liveView.onHidden((ev) => { if (ev.bar === ITEM) { pop.open = false; pop.field = false; readTimers(dirOf()).then(follow).catch(() => {}); } }, EXTENSION);
}

/** `25m tea`: the first word is the duration, the rest the name; `ring` at the end asks the phone. */
export function parseNew(input: string): { duration: string; name: string; ring: boolean } {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const duration = words.shift() ?? "";
  const ring = words[words.length - 1]?.toLowerCase() === "ring";
  if (ring) words.pop();
  return { duration, name: words.join(" "), ring };
}

/** A key or a click in the popover: the CLI is asked, the popover state patched, and the item re-rendered (`keep`), which carries the new tree. */
async function popoverAction(action: string, ctx: { values?: Record<string, string> }): Promise<Effect> {
  await loadRecent();
  const ts = await readTimers(dirOf());
  const st = popoverState(ts);
  const t = current(st);
  const fail = (what: string, e: unknown): Effect => ({ keep: true, toast: { title: `Could not ${what}`, message: (e as Error).message, style: "failure" } });
  const start = async (input: string): Promise<Effect> => {
    const { duration, name, ring } = parseNew(input);
    if (!duration) return { keep: true, toast: { title: "A duration is needed", message: "25m tea, 90s, 1h30m, 2:30, or minutes as a number", style: "failure" } };
    let out: string;
    try { out = await timer(duration, ...(name ? [name] : []), ...(ring ? ["--ring"] : [])); } catch (e) { return fail("start the timer", e); }
    await remember(duration);
    pop.field = false;
    pop.cursor = out.replace(/ started$/, "") || undefined;
    return { keep: true, hud: `Started ${out || duration}` };
  };
  if (action === "start") return start(ctx.values?.input ?? "");
  if (action.startsWith("recent:")) return start(action.slice(7));
  if (action === "new") { pop.field = true; return { keep: true }; }
  if (action === "cancel") { pop.field = false; return { keep: true }; }
  if (action === "open") return { push: { extension: EXTENSION, palette: PALETTE } };
  if (action.startsWith("focus:")) { pop.cursor = action.slice(6); return { keep: true }; }
  if (action === "up" || action === "down") {
    const i = t ? ts.findIndex((x) => x.id === t.id) : -1;
    const n = ts.length ? (i + (action === "down" ? 1 : -1) + ts.length) % ts.length : -1;
    pop.cursor = ts[n]?.id;
    return { keep: true };
  }
  if (!t) return { keep: true };
  const args = action === "toggle" ? (t.state === "done" ? ["done"] : t.state === "paused" ? ["resume", t.id] : ["pause", t.id]) : action === "add" ? ["add", ADD, t.id] : action === "stop" ? ["stop", t.id] : undefined;
  if (!args) return { keep: true };
  try { await timer(...args); } catch (e) { return fail(`${args[0]} the timer`, e); }
  if (action === "stop" || (action === "toggle" && t.state === "done")) pop.cursor = ts.find((x) => x.id !== t.id)?.id;
  return { keep: true };
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
  hookViews();
  await watchDir();
  await loadRecent();
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
  // `pal://timer/start?duration=25m&name=tea&ring=1`: the New timer form's submit, from a link; the CLI's line is the HUD's.
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    if (route !== "start") return;
    const name = typeof params.name === "string" ? params.name.trim() : "";
    const out = await timer(String(params.duration).trim(), ...(name ? [name] : []), ...(params.ring === true ? ["--ring"] : []));
    return { hud: `Timer started: ${out || name || String(params.duration)}` };
  },
  palettes: {
    [PALETTE]: {
      title: "Timers",
      live: true,
      placeholder: "Find a timer by name",
      list,
      // The empty root's Now section: the most urgent timer while one runs, is paused or just landed.
      suggest: async () => readTimers(dirOf()).then((ts) => ts.slice(0, 1).map(row)),
      pick,
    },
  },
  bar: {
    [ITEM]: { render: renderBar, onAction: popoverAction },
  },
  dispose: () => { clearInterval(tick); clearTimeout(pending); watcher?.w.close(); },
} satisfies Extension;
