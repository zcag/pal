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
//
// Pomodoro (pomodoro.ts) rides on the same timers: a session is one of the
// CLI's timers at a time (`Pomodoro 2 of 4`, `Break 2 of 4`, `Long break`)
// and the session record in storage; every read of the directory checks
// whether the session's timer has landed and, if so, stops it and starts
// the next phase's timer, so the cycle runs on the same watcher and tick
// that draw the bar. Finished work rounds are tallied per day.
import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { bar, clock, effects, errorMessage, exec, failed, hint, home, settings, storage, toast, view as liveView, type Action, type BarItem, type Effect, type Extension, type Form, type Item, type LinkParams } from "@zcag/pal";
import { KEY as POMODORO_KEY, STATS_KEY, asSession, dayOf, describe, minutesOf, nameOf, next as nextPhase, phaseWord, tally, type Config, type Phase, type Session, type Stats } from "./pomodoro.ts";
import { DEFAULT_RECENT, MAX_RECENT, current, fmt, render, secsLeft as leftAt, type PopoverState, type State, type Timer } from "./view.ts";

export { fmt };
type Settings = { command: string; dir: string } & Config;

const EXTENSION = "timer", ITEM = "timer", PALETTE = "timers";
/** nf-md-timer, drawn from the bundled Nerd Font; nf-md-plus for the New row, nf-md-alert for a missing CLI. */
const GLYPH = "\u{f0954}";
const PLUS = "\u{f0415}";
const WARN = "\u{f0026}";
/** The CLI's default `TIMER_DONE_TTL`: how long a landed timer's badge lingers. */
const DONE_TTL = 300;
const NEW = "new";
const POMODORO = "pomodoro";
const STATS_ROW = "pomodoro:today";
const ADD = "5m";
const CLI_MS = 5000;
/** nf-md-food_apple: the pomodoro rows' glyph (the font has no tomato). */
const TOMATO = "\u{f025b}";

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
  const { out, err, code } = await exec([cmd, ...args], { env: { ...process.env, TIMER_DIR: home(s.dir) }, ms: CLI_MS });
  if (code !== 0) throw new Error(err.trim().replace(/^timer: /, "") || out.trim() || `timer exited ${code}`);
  return out.trim();
}

// ---- pomodoro -------------------------------------------------------------------

// The session in memory, loaded from storage once per process; `null` is
// none. `advancing` keeps two reads (the tick and the watcher) from
// starting the next phase twice.
let session: Session | null = null;
let sessionLoaded = false;
let advancing: Promise<void> | undefined;
let stats: Stats = {};

async function loadSession() {
  if (sessionLoaded) return;
  sessionLoaded = true;
  session = asSession(await storage.get<unknown>(POMODORO_KEY, EXTENSION).catch(() => null));
  const st = await storage.get<unknown>(STATS_KEY, EXTENSION).catch(() => null);
  stats = st && typeof st === "object" ? (st as Stats) : {};
}
const saveSession = async () => (session ? storage.set(POMODORO_KEY, session, EXTENSION) : storage.remove(POMODORO_KEY, EXTENSION)).catch(() => {});

/** Finished work rounds today. */
export const today = (): number => stats[dayOf(now())] ?? 0;

/** The phase's timer through the CLI, found back by name in the directory (the id is the CLI's slug of it); the session record follows. */
async function startPhase(phase: Phase, round: number, of: number, sessionStart: number): Promise<Timer> {
  const name = nameOf(phase, round, of);
  await timer(`${minutesOf(phase, conf())}m`, name);
  const t = (await readTimers(dirOf())).find((x) => x.name === name && x.state === "running");
  if (!t) throw new Error(`${name} did not start`);
  session = { round, of, phase, timerId: t.id, timerName: name, startedAt: now(), sessionStart };
  await saveSession();
  return t;
}

/**
 * The phase after `s`: its timer stopped, the next one started, the HUD
 * told. One switch at a time (`advancing`): the watcher's push lands while
 * the old file is gone and the new one is not yet there, and must not read
 * that gap as the session ending.
 */
function switchPhase(s: Session, line: (n: { phase: Phase; round: number }) => string): Promise<void> {
  advancing ??= (async () => {
    const n = nextPhase(s);
    await timer("stop", s.timerId).catch(() => {});
    try {
      await startPhase(n.phase, n.round, s.of, s.sessionStart);
      await effects.run({ hud: `Pomodoro. ${line(n)}` }).catch(() => {});
    } catch (e) {
      session = null;
      await saveSession();
      await effects.run({ hud: `Pomodoro stopped: ${errorMessage(e)}` }).catch(() => {});
    }
  })().finally(() => { advancing = undefined; });
  return advancing;
}

/** A session's timer that landed: the round tallied, the next phase started. Missing altogether (stopped from the terminal): the session ends. */
async function advance(ts: Timer[]): Promise<Timer[]> {
  await loadSession();
  if (advancing) { await advancing; return readTimers(dirOf()); }
  const s = session;
  if (!s) return ts;
  const t = ts.find((x) => x.id === s.timerId);
  if (!t) { session = null; await saveSession(); return ts; }
  if (t.state !== "done") return ts;
  if (s.phase === "work") { stats = tally(stats, dayOf(now())); await storage.set(STATS_KEY, stats, EXTENSION).catch(() => {}); }
  await switchPhase(s, (n) => (n.phase === "work" ? `Round ${n.round} of ${s.of}: ${minutesOf("work", conf())} min` : `${n.phase === "long" ? "Long break" : "Break"}: ${minutesOf(n.phase, conf())} min`));
  return readTimers(dirOf());
}

/** The directory as the palette and the bar read it: every timer, the pomodoro session moved on if its timer landed. */
const timers = async (): Promise<Timer[]> => advance(await readTimers(dirOf()));

async function startPomodoro(): Promise<Effect> {
  await loadSession();
  if (session) return toast("A pomodoro is running", describe(session));
  const of = Math.max(1, Math.round(conf().pomodoro_rounds));
  try { await startPhase("work", 1, of, now()); } catch (e) { return failed("start the pomodoro", e); }
  pop.cursor = session!.timerId;
  return { keep: true, hud: `Pomodoro. Round 1 of ${of}: ${minutesOf("work", conf())} min` };
}

/** Skip: the current phase's timer stopped and the next started (a skipped work round is not tallied). */
async function skipPomodoro(): Promise<Effect> {
  await loadSession();
  const s = session;
  if (!s) return { keep: true };
  await switchPhase(s, () => describe(session!));
  if (!session) return toast("Could not start the next phase", undefined, "failure");
  pop.cursor = session.timerId;
  return { keep: true };
}

async function stopPomodoro(): Promise<Effect> {
  await loadSession();
  const s = session;
  if (!s) return { keep: true };
  session = null;
  await saveSession();
  await timer("stop", s.timerId).catch(() => {});
  return { keep: true, hud: "Pomodoro stopped" };
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
  return { timers: ts, cursor: pop.cursor, field: pop.field || ts.length === 0, recent: pop.recent.length ? pop.recent : DEFAULT_RECENT, now: now(), ...(session && { pomodoro: session }), today: today() };
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
  // The pomodoro's timer says which phase it is in: `12:34 · 2/4` while working, `4:59 · break` on a break.
  const p = session?.timerId === t.id ? session : undefined;
  const title = p ? `${fmt(left)} · ${p.phase === "work" ? `${p.round}/${p.of}` : "break"}` : fmt(left);
  return { icon: GLYPH, title, progress: pct, color, tooltip: `${p ? `Pomodoro: ${describe(p).toLowerCase()}` : t.name}${t.state === "paused" ? ", paused" : ""}${more}`, menu };
}

let tick: ReturnType<typeof setInterval> | undefined;
let watcher: { dir: string; w: FSWatcher } | undefined;
let pending: ReturnType<typeof setTimeout> | undefined;

/** Reads and pushes the item, popover tree included (the page replaces the level in place, the field's text kept). */
async function push() {
  const ts = await timers();
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
  liveView.onHidden((ev) => { if (ev.bar === ITEM) { pop.open = false; pop.field = false; timers().then(follow).catch(() => {}); } }, EXTENSION);
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
  const ts = await timers();
  const st = popoverState(ts);
  const t = current(st);
  const start = async (input: string): Promise<Effect> => {
    const { duration, name, ring } = parseNew(input);
    if (!duration) return toast("A duration is needed", "25m tea, 90s, 1h30m, 2:30, or minutes as a number", "failure");
    let out: string;
    try { out = await timer(duration, ...(name ? [name] : []), ...(ring ? ["--ring"] : [])); } catch (e) { return failed("start the timer", e); }
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
  if (action === "pomodoro") return startPomodoro();
  if (action === "skip") return skipPomodoro();
  if (action === "stop-pomodoro") return stopPomodoro();
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
  try { await timer(...args); } catch (e) { return failed(`${args[0]} the timer`, e); }
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
  const ts = await timers();
  follow(ts);
  return barItem(ts);
}

// ---- the palette ------------------------------------------------------------------

const STATE: Record<State, { tag: string; color: string }> = { running: { tag: "running", color: "blue" }, paused: { tag: "paused", color: "amber" }, done: { tag: "done", color: "red" } };

/** The pomodoro session's own actions, on its timer's row: the next phase now, or the whole session off. */
const POMODORO_ACTIONS: Action[] = [{ id: "skip", title: "Skip to the next phase", shortcut: "cmd+s" }, { id: "stop-pomodoro", title: "Stop pomodoro", shortcut: "cmd+shift+d", style: "destructive" }];

function row(t: Timer): Item {
  const left = secsLeft(t);
  const when = t.state === "done" ? `Landed ${fmt(now() - t.fired)} ago` : t.state === "paused" ? `Paused at ${fmt(left)}` : `${fmt(left)} left, done at ${clock(t.deadline * 1000)}`;
  const p = session?.timerId === t.id ? session : undefined;
  const subtitle = p ? `${describe(p)} · ${when}` : when;
  const first: Action = t.state === "done" ? { id: "done", title: "Dismiss" } : t.state === "paused" ? { id: "resume", title: "Resume" } : { id: "pause", title: "Pause" };
  const actions: Action[] = [first, { id: "add", title: "Add 5 minutes", shortcut: "cmd++" }, ...(p ? POMODORO_ACTIONS : []), { id: "stop", title: "Stop", shortcut: "cmd+d", style: "destructive" }];
  return { id: t.id, name: t.name, subtitle, icon: p ? TOMATO : GLYPH, keywords: ["timer", t.state, ...(p ? ["pomodoro", phaseWord(p.phase)] : [])], accessories: [...(p ? [{ tag: phaseWord(p.phase), color: p.phase === "work" ? "violet" : "green" }] : []), { tag: STATE[t.state].tag, color: STATE[t.state].color }], actions };
}

const newRow: Item = { id: NEW, name: "New timer", subtitle: "A duration and a name", icon: PLUS, keywords: ["timer", "start", "countdown"], actions: [{ id: "new", title: "New timer" }] };
const pomodoroRow = (c: Config): Item => ({ id: POMODORO, name: "Start Pomodoro", subtitle: `${minutesOf("work", c)} min of work, ${minutesOf("break", c)} of break, ${Math.max(1, Math.round(c.pomodoro_rounds))} rounds then ${minutesOf("long", c)} min off`, icon: TOMATO, keywords: ["pomodoro", "focus", "work", "break"], actions: [{ id: POMODORO, title: "Start pomodoro" }] });
const statsRow = (n: number): Item => ({ id: STATS_ROW, name: `Pomodoros today: ${n}`, subtitle: n === 1 ? "One work round finished" : `${n} work rounds finished`, icon: TOMATO, keywords: ["pomodoro", "stats"], actions: [] });

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
  const ts = await timers();
  if (!cliPath()) return [...ts.map(row), hint("cli", `${conf().command} is not installed`, "Set timer command in Settings › Extensions › Timer to the timer CLI; the rows above are read from its state directory", { icon: WARN })];
  const n = today();
  return [...ts.map(row), newRow, ...(session ? [] : [pomodoroRow(conf())]), ...(n ? [statsRow(n)] : [])];
}

async function pick(id: string, action?: string, ctx?: { values?: Record<string, string | boolean> }): Promise<Effect> {
  if (id === POMODORO) return startPomodoro();
  if (id === STATS_ROW) return { keep: true };
  if (action === "skip") return skipPomodoro();
  if (action === "stop-pomodoro") return stopPomodoro();
  if (id === NEW) {
    if (action !== "start") return { form: form() };
    const v = ctx?.values ?? {};
    const duration = String(v.duration ?? "").trim(), name = String(v.name ?? "").trim();
    if (!duration) return { form: form({ duration: "A duration is needed" }) };
    let out: string;
    try { out = await timer(duration, ...(name ? [name] : []), ...(v.ring ? ["--ring"] : [])); } catch (e) { return { form: form({ duration: errorMessage(e) }) }; }
    return toast("Timer started", out);
  }
  const args = action === "add" ? ["add", ADD, id] : action === "done" ? ["done"] : [action ?? "pause", id];
  try { await timer(...args); } catch (e) { return failed(`${action ?? "pause"} the timer`, e); }
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
      suggest: async () => timers().then((ts) => ts.slice(0, 1).map(row)),
      pick,
    },
  },
  bar: {
    [ITEM]: { render: renderBar, onAction: popoverAction },
  },
  dispose: () => { clearInterval(tick); clearTimeout(pending); watcher?.w.close(); },
} satisfies Extension;
