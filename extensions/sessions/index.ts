// Sessions: every AI coding session on this machine (Claude Code, Codex,
// Copilot CLI) and what each is doing, read from the files the three CLIs
// write for themselves (agents.ts) with the process table saying which of
// them is still alive (procs.ts). Nothing is asked of the agents: a file
// is folded as it grows (the byte offset kept per file, so a 50 MB
// transcript is read once), the state is derived from what the file says
// last and whether a process on that directory is busy, and a hook may
// tell the exact state through `pal://sessions/state` when the guess is
// not good enough.
//
// The state of a session, in this order: `working` when the file's last
// turn has not ended and the file was written within `stale_minutes` (an
// interrupted turn leaves no mark, only silence); `blocked` ("waiting on
// you?") when, working, the assistant's last tool call has no result after
// 20 s and the process used no cpu over 2 s, which is what a permission
// prompt looks like from outside; else `waiting` (your turn), unless a
// Claude parent's last turn end says subagents are still out, or their
// transcripts under `<id>/` were written within 90 s: `working` for them,
// the count on the row; `ended` when
// no process runs on the directory and the file was written within
// `stale_minutes`, so a crash is seen; older than that the session is
// only under the Recent filter (within `recent_hours`), as something to
// resume. A live process is paired to a file by agent and directory (the
// one it started in, then the latest the file names), newest file to
// newest process: two sessions in one directory both list, and which pid
// each gets is a guess.
//
// The bar item `sessions`: the count as the title, a red `!N` for blocked,
// amber `·N` for your turn, blue `…N` working, an alarm while anything is
// blocked; hidden with none. The popover (view.ts): a row per session by
// state with the agent's mark, Enter focuses its terminal (tmux pane,
// kitty window, iTerm2 or Terminal tab by tty, else the app), `o` the
// transcript, `r` copies the resume command, `x` kills, `s` hands a tmux
// session's row to the palette to type a line into it, `p` the palette.
// The core asks every 10 s; an `fs.watch` on the three roots pushes a
// refresh within half a second of a write.
import { watch, type FSWatcher } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { ago, bar, clock, errorMessage, exec, failed, hint, home, mdEscape, now, run, settings, state, storage, terminal, tilde, tinted, toast, truncate, view as liveView, when, type Accessory, type Action, type Arg, type BarCtx, type BarItem, type Ctx, type Detail, type Effect, type Extension, type Item, type LinkParams, type Metadata } from "@zcag/pal";
import { AGENTS, AGENT_TITLE, acc, claudeSlug, fmtTokens, fold, parseWorkspace, pending as pendingOf, title as titleOf, working as fileWorking, type Acc, type Agent } from "./agents.ts";
import { agentOf, cwds, focus, log, paneOf, panes, sendKeys, table, tool, type Proc, type Terminal } from "./procs.ts";
import { PAGE, render as renderTranscript, type TranscriptState } from "./transcript.ts";
import { AGENT_GLYPH, STATE, current, ordered, render, shown, tagOf, type PopoverState, type Session, type State } from "./view.ts";

type Settings = { agents: string[]; stale_minutes: number; recent_hours: number; terminal: Terminal; editor: string };

const EXTENSION = "sessions", ITEM = "sessions", PALETTE = "sessions";
/** nf-md-creation, the sparkle, on the bar; nf-md-robot on the tile. */
const GLYPH = "\u{f0674}";
/** A tool call this old without a result is a candidate for `blocked`; the process must then be idle over this long. */
const BLOCKED_AFTER_MS = 20_000, IDLE_OVER_MS = 2000, IDLE_CPU_S = 0.1;
/** A subagent transcript written within this is a subagent still running for its parent. */
const SUBAGENT_FRESH_MS = 90_000;
/** A state told through the link holds this long. */
const EXACT_MS = 10 * 60_000;
/** Two reads within this reuse one scan (the bar and the palette ask together). */
const SCAN_TTL_MS = 1500;
const WATCH_DEBOUNCE_MS = 500;
/** A write to a transcript shown in the view pushes the tree again this long after the last one. */
const STREAM_DEBOUNCE_MS = 300;
const CUT_PROMPT = 600, CUT_REPLY = 900;

const conf = () => settings.get<Settings>(EXTENSION);
const enabled = (): Set<Agent> => new Set(AGENTS.filter((a) => (conf().agents ?? AGENTS).includes(a)));
const roots = (): Record<Agent, string> => ({ claude: home("~/.claude"), codex: home("~/.codex"), copilot: home("~/.copilot") });

// ---- the files ----------------------------------------------------------------

/** One file's fold, kept across scans: what was read (`size`) and what it said (`acc`); `rest` is a line cut by the read. */
type Entry = { path: string; agent: Agent; size: number; mtime: number; acc: Acc; rest: string };
const files = new Map<string, Entry>();

/** The bytes appended since the last read folded in; a file that shrank, or was touched without growing (rewritten in place), is read from the start again. */
async function foldFile(e: Entry, size: number, mtime: number): Promise<void> {
  if (size < e.size || (size === e.size && mtime !== e.mtime && e.size > 0)) { e.acc = acc(e.agent); e.size = 0; e.rest = ""; }
  if (size === e.size) { e.mtime = mtime; return; }
  const reader = Bun.file(e.path).slice(e.size, size).stream().getReader();
  const decoder = new TextDecoder();
  let buf = e.rest;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { fold(e.acc, buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  e.rest = buf;
  e.size = size;
  e.mtime = mtime;
}

/** The entry for a path, folded up to date when its mtime is within `since`; absent (and forgotten) otherwise. */
async function entry(agent: Agent, path: string, since: number): Promise<Entry | undefined> {
  let s;
  try { s = await stat(path); } catch { files.delete(path); return; }
  if (s.mtimeMs < since) { files.delete(path); return; }
  let e = files.get(path);
  if (!e) { e = { path, agent, size: 0, mtime: 0, acc: acc(agent), rest: "" }; files.set(path, e); }
  await foldFile(e, s.size, s.mtimeMs);
  return e;
}

const ls = (dir: string) => readdir(dir, { withFileTypes: true }).catch(() => []);

/** Every transcript of Claude Code written since `since`: `projects/<slug>/<id>.jsonl` (the `<id>/` beside one is its subagents' folder). */
async function claudeFiles(root: string, since: number): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const d of await ls(join(root, "projects"))) {
    if (!d.isDirectory()) continue;
    for (const f of await ls(join(root, "projects", d.name))) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const e = await entry("claude", join(root, "projects", d.name, f.name), since);
      if (e) out.push(e);
    }
  }
  return out;
}

/** Codex's rollouts of the days `since` covers: `sessions/YYYY/MM/DD/rollout-*.jsonl`. */
async function codexFiles(root: string, since: number): Promise<Entry[]> {
  const out: Entry[] = [];
  const days = new Set<string>();
  for (let t = since - 86_400_000; t <= now(); t += 86_400_000) { const d = new Date(t); days.add(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`); }
  for (const day of days) {
    for (const f of await ls(join(root, "sessions", day))) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const e = await entry("codex", join(root, "sessions", day, f.name), since);
      if (e) out.push(e);
    }
  }
  return out;
}

/** Copilot's `session-state/<id>/events.jsonl`. */
async function copilotFiles(root: string, since: number): Promise<Entry[]> {
  const out: Entry[] = [];
  for (const d of await ls(join(root, "session-state"))) {
    if (!d.isDirectory()) continue;
    const e = await entry("copilot", join(root, "session-state", d.name, "events.jsonl"), since);
    if (e) out.push(e);
  }
  return out;
}

// ---- the process table and the state --------------------------------------------------

/** The cpu-seconds of each agent process on the last reads, for the idle test; a handful kept. */
const samples = new Map<number, { at: number; time: number }[]>();
function sample(procs: Proc[]) {
  const at = now();
  for (const p of procs) {
    if (!agentOf(p.command)) continue;
    const s = samples.get(p.pid) ?? [];
    s.push({ at, time: p.time });
    samples.set(p.pid, s.slice(-6));
  }
  for (const pid of samples.keys()) if (!procs.some((p) => p.pid === pid)) samples.delete(pid);
}
/** No cpu over `IDLE_OVER_MS` between two reads; undefined until there are two reads that far apart. */
function idle(pid: number): boolean | undefined {
  const s = samples.get(pid) ?? [];
  const last = s.at(-1);
  if (!last) return;
  const earlier = s.slice(0, -1).reverse().find((x) => last.at - x.at >= IDLE_OVER_MS);
  return earlier && last.time - earlier.time < IDLE_CPU_S;
}

/** The exact states hooks told through the link, in memory and in storage (`exact:<key>`), each for `EXACT_MS`. */
const exact = new Map<string, { state: "working" | "waiting" | "blocked"; at: number }>();
let exactLoaded = false;
async function loadExact() {
  if (exactLoaded) return;
  exactLoaded = true;
  for (const k of await storage.keys(EXTENSION).catch(() => [] as string[])) {
    if (!k.startsWith("exact:")) continue;
    const v = await storage.get<{ state: "working" | "waiting" | "blocked"; at: number }>(k, EXTENSION).catch(() => null);
    if (v && now() - v.at < EXACT_MS) exact.set(k.slice(6), v); else storage.remove(k, EXTENSION).catch(() => {});
  }
}

/** `<cwd>/.git/HEAD` as a branch name, for the agents whose files carry none (a worktree's `.git` file points at it); cached half a minute. */
const branches = new Map<string, { at: number; branch?: string }>();
async function branchOf(cwd: string): Promise<string | undefined> {
  const c = branches.get(cwd);
  if (c && now() - c.at < 30_000) return c.branch;
  let branch: string | undefined;
  try {
    let git = join(cwd, ".git");
    const s = await stat(git);
    if (s.isFile()) { const m = (await readFile(git, "utf8")).match(/^gitdir:\s*(.+)$/m); if (m) git = m[1].trim().startsWith("/") ? m[1].trim() : join(cwd, m[1].trim()); }
    branch = (await readFile(join(git, "HEAD"), "utf8")).match(/^ref: refs\/heads\/(.+)$/m)?.[1]?.trim();
  } catch { /* not a repository */ }
  branches.set(cwd, { at: now(), branch });
  return branch;
}

/**
 * Claude's subagents write their own transcripts under `<id>/` beside the
 * parent's (`<id>/subagents/agent-*.jsonl` today, one level down at most):
 * how many were written within `SUBAGENT_FRESH_MS`, and the newest write.
 */
async function subagents(file: string): Promise<{ fresh: number; last: number }> {
  const dir = file.replace(/\.jsonl$/, "");
  const files: string[] = [];
  for (const e of await ls(dir)) {
    if (e.isFile() && e.name.endsWith(".jsonl")) files.push(join(dir, e.name));
    else if (e.isDirectory()) for (const f of await ls(join(dir, e.name))) if (f.isFile() && f.name.endsWith(".jsonl")) files.push(join(dir, e.name, f.name));
  }
  let fresh = 0, last = 0;
  for (const f of files) {
    const m = (await stat(f).catch(() => undefined))?.mtimeMs ?? 0;
    if (m > last) last = m;
    if (now() - m <= SUBAGENT_FRESH_MS) fresh++;
  }
  return { fresh, last };
}

/** Copilot's `open-sessions-state.json`: `{ <id>: { working, openedAt, refreshedAt } }`. */
async function copilotOpen(root: string): Promise<Record<string, { working?: boolean }>> {
  try { const v = JSON.parse(await readFile(join(root, "open-sessions-state.json"), "utf8")); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

/** A Copilot session directory holds `inuse.<pid>.lock` while its process runs: the exact pairing. */
async function lockPid(dir: string): Promise<number | undefined> {
  for (const f of await ls(dir)) { const m = f.name.match(/^inuse\.(\d+)\.lock$/); if (m) return Number(m[1]); }
}

/** `dirs`: every directory the session is known by, for the pairing: the start (Claude's project slug, Codex's `session_meta`, Copilot's `workspace.yaml`) and the latest the file names. */
type Draft = Session & { acc: Acc; stale: boolean; dirs: string[]; /** The newest subagent write, the working state's start when it is theirs. */ subAt?: number };

/**
 * A process belongs to a session when its working directory is one the
 * session is known by. The directory a process reports is where it was
 * started; the transcript's latest entries name where the work is (Claude
 * writes a tool's cwd, a Codex `turn_context` may move), so the start is
 * matched first and the latest second. Claude's start is the project
 * directory's slug, compared slugged.
 */
const startedIn = (d: Draft, cwd: string | undefined): boolean => !!cwd && (cwd === d.dirs[0] || (d.agent === "claude" && claudeSlug(cwd) === basename(dirname(d.file))));
const owns = (d: Draft, cwd: string | undefined): boolean => !!cwd && (d.dirs.includes(cwd) || startedIn(d, cwd));

/** A file as a session before the process table has its say: the fold's fields, the title by agent, a `ended` state to be revised. */
async function draft(e: Entry): Promise<Draft | undefined> {
  const a = e.acc;
  let id = a.id, cwd = a.cwd, title = titleOf(a), started = a.started;
  const dirs = [a.start, a.cwd];
  if (e.agent === "copilot") {
    id = basename(dirname(e.path));
    const ws = parseWorkspace(await readFile(join(dirname(e.path), "workspace.yaml"), "utf8").catch(() => ""));
    cwd = ws.cwd || cwd;
    dirs.unshift(ws.cwd);
    if (ws.name) title = ws.name;
    started ||= Date.parse(ws.created_at) || 0;
  }
  if (!id || !cwd) return;
  const p = pendingOf(a);
  return {
    key: `${e.agent}:${id}`, agent: e.agent, id, cwd, branch: a.branch ?? (await branchOf(cwd)), title, file: e.path, version: a.version, model: a.model,
    started: started || e.mtime, last: Math.max(a.last, e.mtime), turns: a.turns, turnMs: a.turnMs, tokens: a.tokens, permission: a.permission,
    prompt: a.prompt, promptAt: a.promptAt, reply: a.reply, pending: p, state: "ended", stateAt: Math.max(a.last, e.mtime), acc: a, stale: false,
    dirs: dirs.filter((x): x is string => !!x),
  };
}

/** When the state began, for the age on the row: the prompt, the turn's end, the call, the last write. */
function stateAt(s: Draft): number {
  const a = s.acc;
  switch (s.state) {
    case "working": return s.agents ? Math.max(s.subAt ?? 0, a.endedAt) || s.last : (s.agent === "claude" ? a.promptAt : a.turnAt) || s.last;
    case "blocked": return s.pending?.at ?? s.last;
    case "waiting": return a.endedAt || s.last;
    default: return s.last;
  }
}

let scanning: Promise<Draft[]> | undefined;
let last: { at: number; drafts: Draft[] } | undefined;

/** Every session within the recent window, its state settled; one scan at a time, one per `SCAN_TTL_MS` unless forced. */
function scan(force = false): Promise<Draft[]> {
  if (!force && last && now() - last.at < SCAN_TTL_MS) return Promise.resolve(last.drafts);
  scanning ??= doScan().then((drafts) => { last = { at: now(), drafts }; return drafts; }).finally(() => { scanning = undefined; });
  return scanning;
}

async function doScan(): Promise<Draft[]> {
  await loadExact();
  const c = conf();
  const stale = Math.max(1, c.stale_minutes) * 60_000, recent = Math.max(1, c.recent_hours) * 3_600_000;
  const since = now() - Math.max(stale, recent);
  const on = enabled(), r = roots();
  const entries = [
    ...(on.has("claude") ? await claudeFiles(r.claude, since) : []),
    ...(on.has("codex") ? await codexFiles(r.codex, since) : []),
    ...(on.has("copilot") ? await copilotFiles(r.copilot, since) : []),
  ];
  const drafts: Draft[] = [];
  for (const e of entries) { const d = await draft(e); if (d) drafts.push(d); }
  drafts.sort((a, b) => b.last - a.last);

  // The processes: which agent, from where; the pairing newest file to newest process per directory.
  let procs = await table();
  sample(procs);
  const agents = procs.filter((p) => agentOf(p.command)).sort((a, b) => b.started - a.started);
  const dirs = await cwds(agents.map((p) => p.pid));
  const taken = new Set<number>();
  const open = on.has("copilot") ? await copilotOpen(r.copilot) : {};
  for (const d of drafts.filter((x) => x.agent === "copilot")) {
    const pid = await lockPid(dirname(d.file));
    const p = (pid && agents.find((x) => x.pid === pid && agentOf(x.command) === "copilot")) || (open[d.id] && agents.find((x) => !taken.has(x.pid) && agentOf(x.command) === "copilot" && owns(d, dirs.get(x.pid))));
    if (p) { taken.add(p.pid); d.pid = p.pid; d.tty = p.tty; }
  }
  for (const d of drafts.filter((x) => x.agent !== "copilot")) {
    const free = agents.filter((x) => !taken.has(x.pid) && agentOf(x.command) === d.agent);
    const p = free.find((x) => startedIn(d, dirs.get(x.pid))) ?? free.find((x) => owns(d, dirs.get(x.pid)));
    if (p) { taken.add(p.pid); d.pid = p.pid; d.tty = p.tty; }
  }

  // The state: the exact word from a hook, else the files, with the idle test for a call left hanging.
  const live = drafts.filter((d) => d.pid);
  const paneList = live.length ? await panes() : [];
  for (const d of live) {
    d.pane = paneOf(procs.find((p) => p.pid === d.pid)!, paneList, procs)?.target;
    const x = exact.get(d.key);
    if (x && now() - x.at < EXACT_MS) { d.state = x.state; d.exact = true; continue; }
    if (d.agent === "copilot" && open[d.id]?.working) { d.state = "working"; continue; }
    // A turn writes something every few seconds; one silent for `stale_minutes` was interrupted (Escape leaves no mark in the file), so it is the user's turn.
    d.state = fileWorking(d.acc) && now() - d.last <= stale ? "working" : "waiting";
    // A Claude parent whose turn ended with subagents still out, or whose subagent transcripts were written just now, is working on their account.
    if (d.state === "waiting" && d.agent === "claude") {
      const sub = await subagents(d.file);
      const n = d.acc.agents || sub.fresh;
      if (n > 0) { d.state = "working"; d.agents = n; d.subAt = sub.last; }
    }
    if (d.state === "working" && d.pending && now() - d.pending.at > BLOCKED_AFTER_MS) {
      let quiet = idle(d.pid!);
      if (quiet === undefined) { await Bun.sleep(IDLE_OVER_MS); procs = await table(); sample(procs); quiet = idle(d.pid!); }
      if (quiet) d.state = "blocked";
    }
  }
  for (const d of drafts) {
    if (!d.pid) { d.state = "ended"; d.stale = now() - d.last > stale; }
    d.stateAt = stateAt(d);
  }
  watchRoots(drafts, r, on);
  return drafts;
}

// ---- the watchers ---------------------------------------------------------------

const watchers = new Map<string, FSWatcher>();
let pendingRefresh: ReturnType<typeof setTimeout> | undefined;

/** A write under any watched directory: the scan is stale, the bar asked to render (which lists again), half a second after the last one. */
function poke() {
  clearTimeout(pendingRefresh);
  pendingRefresh = setTimeout(() => { last = undefined; bar.refresh(ITEM, EXTENSION).catch(() => {}); }, WATCH_DEBOUNCE_MS);
}

/** The roots and every directory a listed session's file sits in, watched; directories no longer of interest are let go. */
function watchRoots(drafts: Draft[], r: Record<Agent, string>, on: Set<Agent>) {
  const want = new Set<string>();
  if (on.has("claude")) want.add(join(r.claude, "projects"));
  if (on.has("codex")) { const d = new Date(now()); want.add(join(r.codex, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"))); }
  if (on.has("copilot")) { want.add(r.copilot); want.add(join(r.copilot, "session-state")); }
  for (const d of drafts) if (!d.stale) want.add(dirname(d.file));
  for (const [dir, w] of watchers) if (!want.has(dir)) { w.close(); watchers.delete(dir); }
  for (const dir of want) {
    if (watchers.has(dir)) continue;
    try {
      const w = watch(dir, poke);
      w.on("error", () => { w.close(); watchers.delete(dir); });
      watchers.set(dir, w);
    } catch { /* not there yet: the next scan tries again */ }
  }
}

// ---- rows ------------------------------------------------------------------------

const FILTERS = [{ id: "all", title: "All" }, { id: "claude", title: "Claude" }, { id: "codex", title: "Codex" }, { id: "copilot", title: "Copilot" }, { id: "recent", title: "Recent" }];
const SEND_ARGS: Arg[] = [{ id: "text", placeholder: "Line to type into the session", required: true }];
const resumeCommand = (s: Session) => (s.agent === "claude" ? `claude --resume ${s.id}` : s.agent === "codex" ? `codex resume ${s.id}` : `copilot --resume=${s.id}`);

const OPEN_ACTIONS: Action[] = [
  { id: "view", title: "Transcript", shortcut: "cmd+t" },
  { id: "transcript", title: "Open transcript in the editor", shortcut: "cmd+o" },
  { id: "reveal", title: process.platform === "darwin" ? "Reveal transcript in Finder" : "Show transcript in file manager", shortcut: "cmd+shift+o" },
  { id: "folder", title: "Open folder" },
  { id: "editor", title: "Open in editor", shortcut: "cmd+e" },
  { id: "copy-resume", title: "Copy resume command", shortcut: "cmd+c" },
  { id: "copy-id", title: "Copy session id", shortcut: "cmd+shift+c" },
  { id: "copy-cwd", title: "Copy folder path" },
];

function actionsOf(s: Session): Action[] {
  if (s.state === "ended") return [{ id: "resume", title: "Resume in a terminal" }, ...OPEN_ACTIONS];
  return [
    { id: "focus", title: "Focus the terminal" },
    ...(s.pane ? [{ id: "send", title: "Send the line", shortcut: "cmd+enter", args: true as const }] : []),
    ...OPEN_ACTIONS,
    { id: "kill", title: "Kill", shortcut: "cmd+d", style: "destructive", confirm: "Send SIGTERM? The session ends; its transcript stays.", multi: true },
  ];
}

const versionOf = (s: Session) => s.model ?? (s.version ? `v${s.version}` : undefined);

function item(s: Session): Item {
  const accessories: Accessory[] = [{ tag: tagOf(s), color: STATE[s.state].color }];
  const v = versionOf(s);
  if (v) accessories.push({ text: truncate(v, 24) });
  if (s.agents) accessories.push({ text: `${s.agents} agent${s.agents === 1 ? "" : "s"} running` });
  accessories.push({ text: ago(s.stateAt, { short: true }) });
  if (s.pane) accessories.push({ text: `tmux ${s.pane}` }); else if (s.tty) accessories.push({ text: basename(s.tty) });
  return {
    id: s.key, name: s.title,
    subtitle: [AGENT_TITLE[s.agent], basename(s.cwd) || s.cwd, s.branch].filter(Boolean).join(" · "),
    icon: tinted(AGENT_GLYPH[s.agent], s.agent === "claude" ? "orange" : s.agent === "codex" ? "teal" : "violet"),
    keywords: [s.agent, basename(s.cwd), ...(s.branch ? [s.branch] : []), s.id.slice(0, 8)],
    accessories, section: STATE[s.state].title, actions: actionsOf(s), ...(s.pane && { args: SEND_ARGS }),
  };
}

/** The rows of a filter: by state in section order, each newest first; Recent is everything within `recent_hours`, the stale ones included. */
async function list(ctx?: Ctx): Promise<Item[]> {
  const drafts = await scan(ctx?.refresh);
  const filter = ctx?.filter ?? "all";
  const rows = filter === "recent" ? drafts : drafts.filter((d) => !d.stale && (filter === "all" || d.agent === filter));
  if (!rows.length) {
    const c = conf(), on = [...enabled()];
    const why = !on.length ? "Enable an agent under Settings › Extensions › Sessions" : filter === "all" ? `Nothing from ${on.map((a) => AGENT_TITLE[a]).join(", ")} is running or ended in the last ${c.stale_minutes} min` : undefined;
    return [hint("none", filter === "recent" ? `No sessions in the last ${c.recent_hours} h` : "No sessions", why)];
  }
  return ordered(rows).map(item);
}

const by = (id: string) => last?.drafts.find((d) => d.key === id);

async function detail(id: string): Promise<Detail | undefined> {
  if (!last) await scan();
  const s = by(id);
  if (!s) return;
  const parts = [`## ${mdEscape(s.title)}`];
  if (s.prompt) parts.push(`**You** · ${when(s.promptAt)}`, ...truncate(s.prompt.trim(), CUT_PROMPT).split("\n").map((l) => `> ${mdEscape(l)}`));
  if (s.reply) parts.push(`**${AGENT_TITLE[s.agent]}**`, truncate(s.reply.trim(), CUT_REPLY));
  if (s.pending && s.state !== "waiting" && s.state !== "ended") parts.push(`**${s.state === "blocked" ? "Waiting on you?" : "Running"}** \`${s.pending.name}\` since ${clock(s.pending.at)}`, "```", s.pending.summary, "```");
  const t = s.tokens;
  const tokens = [t.context !== undefined && `${fmtTokens(t.context)} context`, t.output !== undefined && `${fmtTokens(t.output)} out`, t.total !== undefined && `${fmtTokens(t.total)} total`].filter(Boolean).join(", ");
  const metadata: Metadata[] = [
    { label: "Agent", value: `${AGENT_TITLE[s.agent]}${s.version ? ` ${s.version}` : ""}` },
    ...(s.model ? [{ label: "Model", value: s.model }] : []),
    { label: "State", tags: [{ text: tagOf(s), color: STATE[s.state].color }, ...(s.exact ? [{ text: "from a hook", color: "grey" }] : [])] },
    { label: "Folder", value: tilde(s.cwd) },
    ...(s.branch ? [{ label: "Branch", value: s.branch }] : []),
    { label: "Started", value: when(s.started) },
    { label: "Last activity", value: `${when(s.last)} (${ago(s.last)})` },
    { label: "Turns", value: `${s.turns}${s.turnMs ? `, the last took ${Math.round(s.turnMs / 1000)} s` : ""}` },
    ...(s.agents ? [{ label: "Subagents", value: `${s.agents} running (the transcripts under ${tilde(s.file.replace(/\.jsonl$/, ""))})` }] : []),
    ...(tokens ? [{ label: "Tokens", value: tokens }] : []),
    ...(s.permission ? [{ label: "Permissions", value: s.permission }] : []),
    ...(s.pid ? [{ label: "Process", value: `pid ${s.pid}${s.tty ? ` on ${basename(s.tty)}` : ""}${s.pane ? `, tmux ${s.pane}` : ""}` }] : []),
    { label: "Session", value: s.id },
    { label: "Transcript", value: tilde(s.file) },
  ];
  parts.push("_cmd+t opens the transcript here_");
  return { markdown: parts.join("\n\n"), metadata };
}

const spawn = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

/**
 * `path` in the editor Settings names when it is found (launchd's PATH
 * lacks `~/.local/bin` and Homebrew, so `tool` looks there), else the
 * OS's own way (`open -t`: TextEdit for a file; `open` for a folder;
 * `xdg-open` on Linux). A non-zero exit is a toast with the reason; an
 * editor still running after `OPEN_MS` is taken as opened.
 */
const OPEN_MS = 5000;
async function openIn(path: string, editor: string, fallback: string[]): Promise<Effect> {
  const ed = editor.trim() && tool(editor.trim());
  if (!ed) log(`open: ${editor.trim() || "no editor set"} not found on PATH or in the usual bins, falling back to ${fallback[0]}`);
  const argv = ed ? [ed, path] : fallback;
  log(`open: ${argv.join(" ")}`);
  const r = await exec(argv, { ms: OPEN_MS }).catch((e) => ({ code: -1, out: "", err: errorMessage(e), timedOut: false }));
  if (r.code !== 0 && !r.timedOut) return failed(`open ${basename(path)} with ${basename(argv[0])}`, new Error(r.err.trim() || `exit ${r.code}`));
  return { hide: true };
}

// ---- the transcript view ------------------------------------------------------

/** Per session, what the view keeps between keys: how many entries it shows, and whether the field is open. */
const views = new Map<string, { window: number; field: boolean }>();
const viewState = (key: string) => views.get(key) ?? views.set(key, { window: PAGE, field: false }).get(key)!;
// The log is read off the file's live fold, not the draft's copy: a refold from scratch (a rewritten file) replaces the accumulator.
const transcriptState = (d: Draft): TranscriptState => ({ session: d, log: files.get(d.file)?.acc.log ?? d.acc.log, ...viewState(d.key), now: now() });
const transcript = (d: Draft): Effect => ({ view: renderTranscript(transcriptState(d)) });

/** The keys of the transcript level, all answered with the level's tree again. */
async function transcriptAction(d: Draft, action: string, values?: Record<string, string | boolean>): Promise<Effect> {
  const st = viewState(d.key);
  switch (action) {
    case "older": st.window += PAGE; return transcript(d);
    case "refresh": { await scan(true); return transcript(by(d.key) ?? d); }
    case "copy-reply": return d.reply ? { copy: d.reply, hud: "Copied the last reply" } : toast("No reply yet", undefined, "failure");
    case "open-file": return act(d, "transcript");
    case "field": st.field = true; return transcript(d);
    case "cancel": st.field = false; return transcript(d);
    case "submit": {
      const r = await act(d, "send", { text: String(values?.input ?? "") });
      if (r.toast) return { ...r, view: renderTranscript(transcriptState(d)) };
      st.field = false;
      return { ...transcript(d), hud: r.hud };
    }
    default: return act(d, undefined);
  }
}
const TRANSCRIPT_ACTIONS = new Set(["older", "refresh", "copy-reply", "open-file", "field", "cancel", "submit"]);

// While a transcript level is shown its file is watched and every write pushes the tree again, so a running session streams into the view.
const streams = new Map<string, { w: FSWatcher; timer?: ReturnType<typeof setTimeout> }>();
let hooked = false;
function hookViews() {
  if (hooked) return;
  hooked = true;
  liveView.onShown((ev) => { if (ev.id && (ev.palette === PALETTE || ev.bar === ITEM)) stream(ev.id, ev.bar ? { bar: ITEM } : { palette: PALETTE }); }, EXTENSION);
  liveView.onHidden((ev) => { if (ev.id) unstream(ev.id); if (ev.bar === ITEM && ev.id === barTranscript) barTranscript = undefined; }, EXTENSION);
}
function stream(key: string, target: { palette?: string; bar?: string }) {
  const d = by(key);
  if (!d || streams.has(key)) return;
  try {
    const w = watch(d.file, () => {
      const s = streams.get(key);
      if (!s) return;
      clearTimeout(s.timer);
      s.timer = setTimeout(async () => {
        await entry(d.agent, d.file, 0).catch(() => undefined);
        liveView.update(renderTranscript(transcriptState(d)), { ...target, id: key }).catch(() => {});
      }, STREAM_DEBOUNCE_MS);
    });
    w.on("error", () => unstream(key));
    streams.set(key, { w });
  } catch { /* the file went away: the next key re-renders what is left */ }
}
function unstream(key: string) {
  const s = streams.get(key);
  if (!s) return;
  clearTimeout(s.timer);
  s.w.close();
  streams.delete(key);
}

/** The palette's rows' actions; the popover's keys land here too with the same ids. */
async function act(s: Session, action: string | undefined, values?: Record<string, string | boolean>): Promise<Effect> {
  const c = conf();
  switch (action) {
    case "view": hookViews(); return transcript(s as Draft);
    case "transcript": return openIn(s.file, c.editor, process.platform === "darwin" ? ["open", "-t", s.file] : ["xdg-open", s.file]);
    case "reveal": spawn(process.platform === "darwin" ? ["open", "-R", s.file] : ["xdg-open", dirname(s.file)]); return { hide: true };
    case "folder": return { open: s.cwd };
    case "editor": return openIn(s.cwd, c.editor, process.platform === "darwin" ? ["open", s.cwd] : ["xdg-open", s.cwd]);
    case "copy-resume": return { copy: resumeCommand(s) };
    case "copy-id": return { copy: s.id };
    case "copy-cwd": return { copy: s.cwd };
    case "kill": {
      if (!s.pid) return toast("Not running", "There is no process behind this session", "failure");
      try { await run(["kill", "-TERM", String(s.pid)]); } catch (e) { return failed(`kill ${s.pid}`, e); }
      last = undefined;
      return { keep: true, hud: `Sent SIGTERM to ${s.pid}` };
    }
    case "send": {
      const text = String(values?.text ?? "").trim();
      if (!s.pane) return toast("Not in tmux", "Only a session in a tmux pane can be typed into safely", "failure");
      if (!text) return toast("Nothing to send", "Type the line into the bar first", "failure");
      const pane = (await panes()).find((p) => p.target === s.pane);
      if (!pane) return toast("The pane is gone", s.pane, "failure");
      try { await sendKeys(pane, text); } catch (e) { return failed("send the line", e); }
      return { hud: `Sent to ${s.pane}` };
    }
    case "resume": {
      // The terminal's shell is not a login shell: the CLI by its path, since `~/.local/bin` and Homebrew are not on launchd's PATH.
      const [cli, ...rest] = resumeCommand(s).split(" ");
      const argv = [tool(cli) ?? cli, ...rest];
      if (c.terminal === "tmux") {
        try { await run([tool("tmux") ?? "tmux", "new-window", "-c", s.cwd, argv.join(" ")]); return { hide: true }; } catch (e) { return failed("open a tmux window", e); }
      }
      // WezTerm has no entry in the SDK's chooser: Auto finds whatever is installed.
      const why = terminal.open(argv, c.terminal === "iterm" ? "iTerm2" : c.terminal === "terminal" ? "Terminal" : c.terminal === "kitty" ? "kitty" : "auto", s.cwd);
      return why ? toast("Could not open a terminal", why, "failure") : { hide: true };
    }
    default: {
      if (!s.pid) return act(s, "resume");
      const how = await focus(s.pid, s.tty, c.terminal, await table());
      return how ? { hide: true } : toast("Could not find its window", s.tty ? `Nothing on ${basename(s.tty)} in tmux, kitty, iTerm2, Terminal or WezTerm, and no app to raise` : "The process has no terminal", "failure");
    }
  }
}

async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect> {
  if (id.startsWith("hint:")) return { keep: true };
  if (!last) await scan();
  const ids = ctx?.ids ?? [id];
  if (action === "kill" && ids.length > 1) {
    let n = 0;
    for (const k of ids) { const s = by(k); if (s?.pid) { await run(["kill", "-TERM", String(s.pid)]).then(() => n++).catch(() => {}); } }
    last = undefined;
    return { keep: true, hud: `Sent SIGTERM to ${n} session${n === 1 ? "" : "s"}` };
  }
  const s = by(id);
  if (!s) return toast("Session not found", "It may have gone stale; the list is refreshed", "failure");
  if (action && TRANSCRIPT_ACTIONS.has(action)) return transcriptAction(s, action, ctx?.values as Record<string, string | boolean> | undefined);
  return act(s, action, ctx?.values as Record<string, string | boolean> | undefined);
}

// ---- the bar item ----------------------------------------------------------------

let barFocus: string | undefined;
/** The session whose transcript the popover shows over its list, for the keys of that level. */
let barTranscript: string | undefined;

function popoverState(sessions: Session[]): PopoverState {
  const st: PopoverState = { sessions: ordered(sessions), cursor: barFocus, now: now() };
  barFocus = current(st)?.key;
  return st;
}

export function barItem(sessions: Session[]): BarItem {
  const menu = { view: render(popoverState(sessions)) };
  if (!sessions.length) return { hidden: true, empty: { icon: GLYPH, tooltip: "No sessions", menu } };
  const n = (state: State) => sessions.filter((s) => s.state === state).length;
  const blocked = n("blocked"), waiting = n("waiting"), working = n("working"), ended = n("ended");
  // Plain counts in the state colours, no total and no glyph prefixes: red + amber + blue add up to the sessions that are still there, which a "6 ·5" never did.
  // Ended sessions are not one of them: the strip is what is running, and a grey count of what stopped only ever read as work left to do.
  const segments = [
    ...(blocked ? [{ id: "blocked", text: String(blocked), color: "red" as const, tooltip: `${blocked} waiting on you` }] : []),
    ...(waiting ? [{ id: "waiting", text: String(waiting), color: "amber" as const, tooltip: `${waiting} your turn` }] : []),
    ...(working ? [{ id: "working", text: String(working), color: "blue" as const, tooltip: `${working} working` }] : []),
  ];
  const words = [blocked && `${blocked} waiting on you`, waiting && `${waiting} your turn`, working && `${working} working`, ended && `${ended} ended`].filter(Boolean);
  return { icon: GLYPH, segments, ...(blocked && { urgent: true }), tooltip: `${sessions.length} session${sessions.length === 1 ? "" : "s"}: ${words.join(", ")}`, menu };
}

const shownSessions = async (force = false) => (await scan(force)).filter((d) => !d.stale);

async function renderBar(ctx: BarCtx): Promise<BarItem> {
  const sessions = await shownSessions(ctx.reason === "update" || ctx.reason === "show" || ctx.reason === "wake");
  publish(sessions);
  return barItem(sessions);
}

/** The counts as states (`sessions/working`, `sessions/waiting`: docs/design/states.md), for a `working` of the user's to compose; a render is where the counts are current. */
function publish(sessions: Session[]) {
  const n = (st: State) => sessions.filter((s) => s.state === st).length;
  state.set("working", n("working"), EXTENSION).catch(() => {});
  state.set("waiting", n("waiting") + n("blocked"), EXTENSION).catch(() => {});
}

/** A key or a click in the popover: the row under the ring goes through the palette's actions; the arrows and a click move the ring. */
async function popoverAction(action: string, ctx: BarCtx): Promise<Effect> {
  if (action === "pal") return { push: { extension: EXTENSION, palette: PALETTE } };
  if (barTranscript && TRANSCRIPT_ACTIONS.has(action)) { const d = by(barTranscript); if (d) return transcriptAction(d, action, ctx.values); }
  const sessions = await shownSessions();
  const st = popoverState(sessions);
  const rows = shown(st.sessions);
  const redraw = (): Effect => ({ view: render(popoverState(sessions)) });
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return redraw(); }
  if (action === "down" || action === "up") {
    if (!rows.length) return { keep: true };
    const i = rows.findIndex((s) => s.key === barFocus);
    barFocus = rows[(i + (action === "down" ? 1 : rows.length - 1)) % rows.length].key;
    return redraw();
  }
  const s = current(st);
  if (!s) return { keep: true };
  switch (action) {
    case "send": return { push: { extension: EXTENSION, palette: PALETTE, query: s.id.slice(0, 8) } };
    case "view": barTranscript = s.key; hookViews(); return transcript(s as Draft);
    case "kill": { const r = await act(s, "kill"); return r.toast ? r : { keep: true, hud: r.hud }; }
    default: return act(s, action === "focus" ? undefined : action, ctx.values);
  }
}

// ---- the link -------------------------------------------------------------------

/** `pal://sessions/state?agent=claude&session=<id>&state=working|waiting|blocked`: what a hook knows for sure, kept ten minutes over the derivation. */
async function link(route: string, params: LinkParams): Promise<Effect | void> {
  if (route !== "state") return;
  const agent = String(params.agent), id = String(params.session), state = String(params.state) as "working" | "waiting" | "blocked";
  if (!AGENTS.includes(agent as Agent)) throw new Error(`agent must be one of ${AGENTS.join(", ")}`);
  if (!["working", "waiting", "blocked"].includes(state)) throw new Error("state must be working, waiting or blocked");
  await loadExact();
  const key = `${agent}:${id}`;
  exact.set(key, { state, at: now() });
  await storage.set(`exact:${key}`, { state, at: now() }, EXTENSION).catch(() => {});
  last = undefined;
  bar.refresh(ITEM, EXTENSION).catch(() => {});
}

export default {
  link,
  palettes: {
    [PALETTE]: {
      title: "Sessions",
      live: true,
      multi: true,
      placeholder: "Find a session by title, folder, branch or agent",
      filters: FILTERS,
      list: (_q, ctx) => list(ctx),
      detail,
      pick,
      suggest: async () => (await shownSessions()).filter((s) => s.state === "blocked" || s.state === "waiting").slice(0, 2).map(item),
    },
  },
  bar: {
    [ITEM]: { render: renderBar, onAction: popoverAction },
  },
  dispose: () => { clearTimeout(pendingRefresh); for (const w of watchers.values()) w.close(); watchers.clear(); for (const k of streams.keys()) unstream(k); },
} satisfies Extension;
