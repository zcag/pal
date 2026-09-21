// The process table and the terminals: which `claude`, `codex` and
// `copilot` processes are running, from which directory, on which tty, and
// how to bring that tty's window in front. Everything is a command the
// tests can stand in for on PATH (`ps`, `lsof`, `tmux`, `kitten`,
// `osascript`, `open`); nothing here reads a session file. The host runs
// under launchd's PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so a tool is
// looked for on PATH and then in the bins launchd does not know
// (`tool`); kitty is reached over the socket `listen_on` in kitty.conf
// names, with kitty's pid appended as kitty does (`kittyTo`).
//
// Focus is a ladder of steps that each answer whether they did it, tried
// in order: the tmux pane on that tty (selected inside its own server,
// then the client's terminal brought in front by the same ladder), a
// kitty window (`kitten @ ls`, matched by the pid the window's shell is
// an ancestor of), iTerm2 and Terminal over AppleScript matched by tty,
// and last the `.app` bundle found walking the pid's parents, activated
// with nothing selected inside it.
import { readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { exec, home, run, terminal } from "@zcag/pal";
import type { Agent } from "./agents.ts";

export const log = (...a: unknown[]) => console.error("[sessions]", ...a);

export type Proc = { pid: number; ppid: number; tty?: string; cpu: number; /** Accumulated cpu, seconds. */ time: number; started: number; command: string };
export type Pane = { tty: string; pid: number; target: string; session: string };
export type KittyWindow = { id: number; pid: number; pids: number[] };

const LINUX = process.platform === "linux";
const PS = ["ps", "-axo", "pid=,ppid=,tty=,%cpu=,cputime=,lstart=,command="];
const MS = 4000;

// ---- finding the tools ----------------------------------------------------------

/** Where the tools live when launchd's PATH does not say: Homebrew (Apple silicon, then Intel), the user's own bin, kitty's bundle. */
export const EXTRA_BINS = ["/opt/homebrew/bin", "/usr/local/bin", "~/.local/bin", "/Applications/kitty.app/Contents/MacOS", "/Applications/WezTerm.app/Contents/MacOS"];
const found = new Map<string, string>();
/** `name` as PATH resolves it, else the first of `dirs` that has it; a hit is cached, a miss is looked for again next time. */
export function tool(name: string, dirs = EXTRA_BINS): string | undefined {
  const hit = found.get(name) ?? Bun.which(name, { PATH: process.env.PATH ?? "" }) ?? dirs.map((d) => join(home(d), name)).find((p) => Bun.file(p).size > 0);
  if (hit) found.set(name, hit);
  return hit;
}
/** The argv word for `name`: its path when found, the bare name otherwise (so the failure names it). */
const bin = (name: string) => tool(name) ?? name;

/** `0:01.23`, `12:34.56`, `1:02:03`, `2-03:04:05` as seconds. */
export function cputime(s: string): number {
  const [days, rest] = s.includes("-") ? s.split("-") : ["0", s];
  return rest.split(":").reduce((acc, x) => acc * 60 + Number(x), 0) + Number(days) * 86400;
}

/** `ttys007` and `pts/3` as the device tmux and the terminals name (`/dev/ttys007`); `??` and `?` are none. */
export const ttyOf = (s: string): string | undefined => (!s || s === "??" || s === "?" || s === "-" ? undefined : s.startsWith("/") ? s : `/dev/${s}`);

/** Every process: pid, parent, tty, cpu, the cumulative cpu seconds, the start time and the command line. */
export async function table(): Promise<Proc[]> {
  const { out } = await exec(PS, { ms: MS });
  const procs: Proc[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\d.]+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
    if (!m) continue;
    procs.push({ pid: +m[1], ppid: +m[2], tty: ttyOf(m[3]), cpu: +m[4], time: cputime(m[5]), started: Date.parse(m[6]) || 0, command: m[7].trim() });
  }
  return procs;
}

/** The interpreters a CLI hides behind: `node /path/claude ...` is claude. */
const RUNTIMES = new Set(["node", "bun", "deno", "npx"]);
const SUBCOMMANDS_NOT_A_SESSION = new Set(["mcp-server", "app-server", "mcp", "completion", "login", "logout", "--version", "-V", "--help", "-h"]);

/**
 * Which agent a command line runs, or none: the basename of the first
 * word (or the next when the first is a runtime), matched whole, so
 * `claude-state` and `codex-code-mode-host` are neither. A `codex
 * mcp-server` (Claude Code's Codex MCP) or a `claude mcp serve` is a
 * server, not a session.
 */
export function agentOf(command: string): Agent | undefined {
  const words = command.split(/\s+/);
  let i = 0;
  if (RUNTIMES.has(base(words[0]))) i = 1;
  const name = base(words[i] ?? "");
  if (name !== "claude" && name !== "codex" && name !== "copilot") return;
  const sub = words[i + 1];
  if (sub && SUBCOMMANDS_NOT_A_SESSION.has(sub)) return;
  if (name === "claude" && sub === "mcp") return;
  return name;
}
const base = (w: string) => w.slice(w.lastIndexOf("/") + 1);

/** The working directory of each pid: one `lsof` for all of them on macOS, `/proc` on Linux. Unreadable ones are absent. */
export async function cwds(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!pids.length) return out;
  if (LINUX) {
    await Promise.all(pids.map((pid) => readlink(`/proc/${pid}/cwd`).then((p) => out.set(pid, p)).catch(() => {})));
    return out;
  }
  const r = await exec(["lsof", "-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"], { ms: MS });
  let pid = 0;
  for (const line of r.out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid) out.set(pid, line.slice(1));
  }
  return out;
}

/** The parents of `pid`, nearest first, from the table. */
export function ancestors(pid: number, procs: Proc[]): Proc[] {
  const by = new Map(procs.map((p) => [p.pid, p]));
  const out: Proc[] = [];
  for (let p = by.get(pid)?.ppid; p && p > 1 && !out.some((x) => x.pid === p); p = by.get(p)?.ppid) { const q = by.get(p); if (!q) break; out.push(q); }
  return out;
}

/** The `.app` bundle an ancestor runs from (`/Applications/kitty.app/Contents/MacOS/kitty`), nearest first. */
export function appOf(pid: number, procs: Proc[]): string | undefined {
  for (const p of ancestors(pid, procs)) {
    const m = p.command.match(/^(.*?\.app)\/Contents\/MacOS\//);
    if (m) return m[1];
  }
}

// ---- tmux -----------------------------------------------------------------------

/** Every pane of every tmux server the default socket knows: its tty, its shell's pid and its `session:window.pane` target. None when tmux is not running. */
export async function panes(): Promise<Pane[]> {
  const r = await exec([bin("tmux"), "list-panes", "-a", "-F", "#{pane_tty} #{pane_pid} #{session_name}:#{window_index}.#{pane_index}"], { ms: MS }).catch(() => undefined);
  if (!r || r.code !== 0) return [];
  return r.out.split("\n").map((l) => l.trim().split(" ")).filter((w) => w.length === 3).map(([tty, pid, target]) => ({ tty, pid: Number(pid), target, session: target.slice(0, target.lastIndexOf(":")) }));
}

/** The pane a process runs in: by its tty, else by its shell being one of the process's ancestors. */
export const paneOf = (p: Proc, list: Pane[], procs: Proc[]): Pane | undefined => list.find((x) => p.tty && x.tty === p.tty) ?? list.find((x) => ancestors(p.pid, procs).some((a) => a.pid === x.pid));

/** The tty of the client attached to a tmux session, to focus the terminal that shows it; none when it is detached. */
export async function clientTty(session: string): Promise<string | undefined> {
  const r = await exec([bin("tmux"), "list-clients", "-t", session, "-F", "#{client_tty}"], { ms: MS }).catch(() => undefined);
  return r?.code === 0 ? r.out.split("\n").map((s) => s.trim()).find(Boolean) : undefined;
}

/** The pane selected inside its server: the client switched to its session, the window and the pane picked. */
export async function selectPane(pane: Pane): Promise<void> {
  await run([bin("tmux"), "switch-client", "-t", pane.target], { ms: MS }).catch(() => {});
  await run([bin("tmux"), "select-window", "-t", pane.target], { ms: MS });
  await run([bin("tmux"), "select-pane", "-t", pane.target], { ms: MS });
}

/** A line typed into the pane and sent: `-l` keeps it literal, Enter goes as a key on its own (after `-l` it would be four letters). */
export async function sendKeys(pane: Pane, text: string): Promise<void> {
  await run([bin("tmux"), "send-keys", "-t", pane.target, "-l", text], { ms: MS });
  await run([bin("tmux"), "send-keys", "-t", pane.target, "Enter"], { ms: MS });
}

// ---- kitty -----------------------------------------------------------------------

/** The `listen_on` line of a kitty.conf (`unix:/tmp/mykitty`, `tcp:localhost:12345`); none when unset or `none`. */
export function kittyListenOn(conf: string): string | undefined {
  const m = conf.match(/^\s*listen_on\s+(\S+)/m);
  return m && m[1] !== "none" ? m[1] : undefined;
}

/** The kitty processes' pids (`kitty.app/Contents/MacOS/kitty`, or a bare `kitty`), for the socket names. */
export const kittyPids = (procs: Proc[]): number[] => procs.filter((p) => base(p.command.split(/\s+/)[0]) === "kitty").map((p) => p.pid);

/**
 * The sockets kitty may be listening on, best first: `KITTY_LISTEN_ON` (set
 * inside a kitty window), then `listen_on` from kitty.conf, which for a
 * `unix:<path>` kitty serves as `<path>-<pid>` when the conf named it
 * (one instance per socket), or as `<path>` when the command line did.
 */
export function kittyCandidates(listenOn: string | undefined, pids: number[], env: Record<string, string | undefined> = process.env): string[] {
  const out: string[] = [];
  if (env.KITTY_LISTEN_ON) out.push(env.KITTY_LISTEN_ON);
  if (listenOn) {
    if (listenOn.startsWith("unix:") && !listenOn.startsWith("unix:@")) out.push(...pids.map((pid) => `${listenOn}-${pid}`));
    out.push(listenOn);
  }
  return [...new Set(out)];
}

/** kitty.conf as kitty reads it: `$KITTY_CONFIG_DIRECTORY/kitty.conf`, else `~/.config/kitty/kitty.conf`. */
async function kittyConf(): Promise<string> {
  const dirs = [process.env.KITTY_CONFIG_DIRECTORY, "~/.config/kitty"].filter((d): d is string => !!d);
  for (const d of dirs) { const t = await readFile(join(home(d), "kitty.conf"), "utf8").catch(() => undefined); if (t !== undefined) return t; }
  return "";
}

const kittyLs = (to: string) => exec([bin("kitten"), "@", "--to", to, "ls"], { ms: MS }).catch(() => undefined);

// The socket that answered last, kept until it stops answering.
let kittySocket: string | undefined;

/**
 * kitty's windows over remote control (`allow_remote_control yes` and a
 * `listen_on` in kitty.conf): each with the pid of its shell and of what
 * runs in front, and the socket that answered (for the `focus-window` that
 * follows). Empty, with the reason logged, when kitten is not installed,
 * no socket answers, or kitty refuses.
 */
export async function kittyWindows(procs: Proc[]): Promise<{ to?: string; windows: KittyWindow[] }> {
  if (!tool("kitten")) { log(`focus: kitten not found on PATH or in ${EXTRA_BINS.join(", ")}`); return { windows: [] }; }
  let r = kittySocket ? await kittyLs(kittySocket) : undefined;
  if (!r || r.code !== 0) {
    kittySocket = undefined;
    const tried = kittyCandidates(kittyListenOn(await kittyConf()), kittyPids(procs));
    for (const to of tried) { r = await kittyLs(to); if (r?.code === 0) { kittySocket = to; break; } }
    if (!kittySocket) { log(tried.length ? `focus: no kitty socket answered (tried ${tried.join(", ")})` : "focus: kitty has no listen_on in kitty.conf and KITTY_LISTEN_ON is unset"); return { windows: [] }; }
  }
  let data: unknown;
  try { data = JSON.parse(r!.out); } catch { return { to: kittySocket, windows: [] }; }
  const out: KittyWindow[] = [];
  for (const os of Array.isArray(data) ? data : []) for (const tab of (os as { tabs?: unknown[] }).tabs ?? []) for (const w of (tab as { windows?: Record<string, unknown>[] }).windows ?? []) {
    if (typeof w.id !== "number" || typeof w.pid !== "number") continue;
    const fg = Array.isArray(w.foreground_processes) ? (w.foreground_processes as { pid?: unknown }[]).map((p) => p.pid).filter((p): p is number => typeof p === "number") : [];
    out.push({ id: w.id, pid: w.pid, pids: fg });
  }
  return { to: kittySocket, windows: out };
}

/** The kitty window whose shell is the process, one of its ancestors, or has it in front. */
export const kittyWindowOf = (pid: number, windows: KittyWindow[], procs: Proc[]): KittyWindow | undefined => {
  const chain = new Set([pid, ...ancestors(pid, procs).map((p) => p.pid)]);
  return windows.find((w) => chain.has(w.pid) || w.pids.some((p) => chain.has(p)));
};

// ---- the focus ladder ----------------------------------------------------------

export type Terminal = "auto" | "kitty" | "iterm" | "terminal" | "wezterm" | "tmux";
export type Step = "tmux" | "kitty" | "iterm" | "terminal" | "wezterm" | "pid" | "app";

/** The steps the ladder tries for a setting: tmux first always, then only the named app, or every one with the pid and app rungs last. */
export const stepsFor = (want: Terminal): Step[] => (want === "tmux" ? ["tmux"] : want === "auto" ? ["tmux", "kitty", "iterm", "terminal", "wezterm", "pid", "app"] : ["tmux", want]);

const appRunning = (procs: Proc[], bundle: string) => procs.some((p) => p.command.includes(`${bundle}/Contents/MacOS/`));

/** iTerm2's tab whose session sits on `tty`, selected and its window brought in front; false when no tab has it or iTerm2 is not running (AppleScript would launch it). */
export async function focusITerm(tty: string, procs: Proc[]): Promise<boolean> {
  if (!appRunning(procs, "iTerm.app")) return false;
  const script = `tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        if tty of s is "${tty}" then
          select t
          tell s to select
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end repeat
end tell
return "no"`;
  const r = await exec(["osascript", "-e", script], { ms: MS }).catch(() => undefined);
  return r?.out.trim() === "ok";
}

/** Terminal.app's tab on `tty`, likewise. */
export async function focusTerminalApp(tty: string, procs: Proc[]): Promise<boolean> {
  if (!appRunning(procs, "Terminal.app")) return false;
  const script = `tell application "Terminal"
  repeat with w in windows
    repeat with t in tabs of w
      if tty of t is "${tty}" then
        set selected tab of w to t
        set index of w to 1
        activate
        return "ok"
      end if
    end repeat
  end repeat
end tell
return "no"`;
  const r = await exec(["osascript", "-e", script], { ms: MS }).catch(() => undefined);
  return r?.out.trim() === "ok";
}

/** kitty's window holding `pid` focused over remote control, then the app itself brought in front (focus-window alone does not raise kitty over another app). */
export async function focusKitty(pid: number, procs: Proc[]): Promise<boolean> {
  const { to, windows } = await kittyWindows(procs);
  const w = to && kittyWindowOf(pid, windows, procs);
  if (!w) return false;
  const r = await exec([bin("kitten"), "@", "--to", to, "focus-window", "--match", `id:${w.id}`], { ms: MS }).catch(() => undefined);
  if (r?.code !== 0) { log(`focus: kitty refused focus-window id:${w.id}: ${r?.err.trim() ?? "no answer"}`); return false; }
  if (!LINUX) await exec(["open", "-a", "kitty"], { ms: MS }).catch(() => {});
  log(`focus: kitty window ${w.id}`);
  return true;
}

/** WezTerm's pane on `tty` (`wezterm cli list` names each pane's tty), activated, then the app brought in front. Only while WezTerm runs, and only when `wezterm` is found. */
export async function focusWezTerm(tty: string, procs: Proc[]): Promise<boolean> {
  if (!procs.some((p) => /wezterm/i.test(p.command.split(/\s+/)[0]))) return false;
  const wt = tool("wezterm");
  if (!wt) { log(`focus: WezTerm runs but wezterm was not found on PATH or in ${EXTRA_BINS.join(", ")}`); return false; }
  const r = await exec([wt, "cli", "list", "--format", "json"], { ms: MS }).catch(() => undefined);
  if (r?.code !== 0) { log(`focus: wezterm cli list failed: ${r?.err.trim() ?? "no answer"}`); return false; }
  let panes: { pane_id?: unknown; tty_name?: unknown }[] = [];
  try { panes = JSON.parse(r.out); } catch { return false; }
  const pane = panes.find((p) => p.tty_name === tty);
  if (typeof pane?.pane_id !== "number") return false;
  const a = await exec([wt, "cli", "activate-pane", "--pane-id", String(pane.pane_id)], { ms: MS }).catch(() => undefined);
  if (a?.code !== 0) { log(`focus: wezterm refused activate-pane ${pane.pane_id}: ${a?.err.trim() ?? "no answer"}`); return false; }
  if (!LINUX) await exec(["open", "-a", "WezTerm"], { ms: MS }).catch(() => {});
  return true;
}

/** The nearest ancestor of `pid` that is a GUI app (its command inside a `.app` bundle): Alacritty, Ghostty, Warp, VS Code's terminal. */
export const appProcOf = (pid: number, procs: Proc[]): Proc | undefined => ancestors(pid, procs).find((p) => /\.app\/Contents\/MacOS\//.test(p.command));

/**
 * That ancestor brought to the front by its pid through System Events:
 * for a one-window-per-process terminal (Alacritty) the very window, for
 * a many-windows one the app with its last window, which is the most
 * macOS offers without an API of the app's own.
 */
export async function focusPid(pid: number, procs: Proc[]): Promise<Proc | undefined> {
  if (LINUX) return;
  const p = appProcOf(pid, procs);
  if (!p) return;
  const r = await exec(["osascript", "-e", `tell application "System Events" to set frontmost of (first process whose unix id is ${p.pid}) to true`], { ms: MS }).catch(() => undefined);
  if (r?.code !== 0) { log(`focus: System Events would not raise pid ${p.pid}: ${r?.err.trim() ?? "no answer"}`); return; }
  return p;
}

/** The app an ancestor of `pid` runs from, activated; the last resort, nothing inside it selected. */
export async function focusApp(pid: number, procs: Proc[]): Promise<boolean> {
  const app = appOf(pid, procs);
  if (!app) return false;
  const r = await exec(["open", app], { ms: MS }).catch(() => undefined);
  return r?.code === 0;
}

/**
 * The window showing `pid` (which sits on `tty`) in front, by the ladder
 * for `want`. A tmux pane is selected first and the focus then goes to the
 * client's tty by the rest of the ladder; a pane with no client attached
 * gets a terminal window running `tmux attach` instead. The step that did
 * it, or undefined.
 */
export async function focus(pid: number, tty: string | undefined, want: Terminal, procs: Proc[]): Promise<string | undefined> {
  const steps = stepsFor(want);
  const me = procs.find((p) => p.pid === pid) ?? { pid, ppid: 0, cpu: 0, time: 0, started: 0, command: "", tty };
  let target = { pid, tty };
  if (steps.includes("tmux")) {
    const pane = paneOf(me, await panes(), procs);
    if (pane) {
      await selectPane(pane).catch(() => {});
      const client = await clientTty(pane.session);
      if (!client) {
        const why = terminal.open([bin("tmux"), "attach", "-t", pane.session], "auto");
        log(why ? `focus: tmux pane ${pane.target} has no client and no terminal opens: ${why}` : `focus: tmux pane ${pane.target}, attached in a new terminal`);
        return why ? undefined : "tmux";
      }
      // The client is a tmux process on that tty; the ladder continues from it.
      const cp = procs.find((p) => p.tty === client && /(^|\/)tmux(\s|$)/.test(p.command)) ?? procs.find((p) => p.tty === client);
      target = { pid: cp?.pid ?? pid, tty: client };
      log(`focus: tmux pane ${pane.target} selected, its client on ${client}`);
      if (steps.length === 1) return "tmux";
    } else if (steps.length === 1) { log(`focus: pid ${pid} is in no tmux pane`); return; }
  }
  for (const step of steps) {
    if (step === "kitty" && (await focusKitty(target.pid, procs))) return "kitty";
    if (step === "iterm" && target.tty && (await focusITerm(target.tty, procs))) { log(`focus: iTerm2 tab on ${target.tty}`); return "iterm"; }
    if (step === "terminal" && target.tty && (await focusTerminalApp(target.tty, procs))) { log(`focus: Terminal tab on ${target.tty}`); return "terminal"; }
    if (step === "wezterm" && target.tty && (await focusWezTerm(target.tty, procs))) { log(`focus: WezTerm pane on ${target.tty}`); return "wezterm"; }
    if (step === "pid") { const p = await focusPid(target.pid, procs); if (p) { log(`focus: pid ${p.pid} (${appOf(target.pid, procs)}) raised`); return "pid"; } }
    if (step === "app" && (await focusApp(target.pid, procs))) { log(`focus: app ${appOf(target.pid, procs)}`); return "app"; }
  }
  log(`focus: nothing found for pid ${target.pid}${target.tty ? ` on ${target.tty}` : ""} (tried ${steps.join(", ")})`);
}
