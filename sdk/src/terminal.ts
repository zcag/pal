// A terminal window, for every extension that opens one (apps' Terminal=true
// entries, ssh's Connect, shell's and make's "Run in terminal", docker's
// exec, Files' "Open in Terminal"). Two shapes: `argv`/`open` run a command
// in a fresh window (the app chosen by name or found in /Applications; on
// Linux `$TERMINAL`, else the first installed of `LINUX_TERMINALS`), `at`/`on`
// open a shell in a folder with a line typed into it (the app named as text,
// Terminal when blank). How the command is handed over differs per program:
// kitty and foot take it as trailing arguments, WezTerm and GNOME Terminal
// after `start --` / `--`, the rest after `-e`; Terminal and iTerm2 have no
// CLI for a new window, so AppleScript.
import { appendFileSync } from "node:fs";
import { home } from "./api.ts";

const MAC = process.platform === "darwin";

// ---- Linux ------------------------------------------------------------------

/** Known terminals in the order they are tried when `$TERMINAL` is unset; `x-terminal-emulator` is Debian's alternatives pointer, the user's own choice there. */
export const LINUX_TERMINALS = ["x-terminal-emulator", "kitty", "foot", "alacritty", "wezterm", "ghostty", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"];

type Which = (name: string) => string | null;
const which: Which = (name) => Bun.which(name);

/** The terminal's command name or path, or undefined when nothing is found (the caller says "set $TERMINAL"). */
export function linux(env: Record<string, string | undefined> = process.env, has: Which = which): string | undefined {
  const t = env.TERMINAL?.trim();
  return t || LINUX_TERMINALS.find((n) => has(n));
}

/** argv running `cmd` in `term` (a name or path), the way that program takes a command. */
export function linuxArgv(term: string, cmd: string[]): string[] {
  const base = term.slice(term.lastIndexOf("/") + 1).toLowerCase();
  switch (base) {
    case "kitty": case "foot": return [term, ...cmd];
    case "wezterm": return [term, "start", "--", ...cmd];
    case "gnome-terminal": return [term, "--", ...cmd];
    default: return [term, "-e", ...cmd];
  }
}

// ---- a command in a new window ----------------------------------------------

/** The `terminal` setting of the extensions that open one: found in /Applications, or named. */
export type Choice = "auto" | "kitty" | "Terminal" | "iTerm2" | "Ghostty" | "Alacritty";

const MAC_APPS = ["kitty", "Ghostty", "Alacritty", "iTerm2", "Terminal"] as const;
const macApp = (name: string) => [`/Applications/${name}.app`, `${home("~")}/Applications/${name}.app`, `/System/Applications/Utilities/${name}.app`].find((p) => Bun.file(`${p}/Contents/Info.plist`).size > 0);

/** One word for `sh`: single-quoted unless it needs no quoting. */
export const quote = (s: string) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** Each app's way of opening a new window that runs a command. */
function macArgv(name: string, app: string, cmd: string[]): string[] {
  const script = (...lines: string[]) => ["osascript", ...lines.flatMap((l) => ["-e", l])];
  const quoted = cmd.map(quote).join(" ").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  switch (name) {
    // `-1`: a new OS window in the running instance when it was started single-instance, else its own.
    case "kitty": return [`${app}/Contents/MacOS/kitty`, "-1", ...cmd];
    case "Terminal": return script(`tell application "Terminal" to do script "${quoted}"`, 'tell application "Terminal" to activate');
    case "iTerm2": return script(`tell application "iTerm2" to create window with default profile command "${quoted}"`, 'tell application "iTerm2" to activate');
    default: return ["open", "-na", app, "--args", "-e", ...cmd];
  }
}

/** `cmd` as the terminal runs it: from `cwd` when given. Every terminal takes an argv, none a directory the same way, so a `cd` in front covers them all. */
export const command = (cmd: string[], cwd?: string): string[] => (cwd ? ["sh", "-c", `cd ${quote(cwd)} && exec ${cmd.map(quote).join(" ")}`] : cmd);

/** The argv that opens a terminal running `cmd` (from `cwd` when given), or a string saying why there is none. */
export function argv(cmd: string[], want: Choice = "auto", cwd?: string): string[] | string {
  cmd = command(cmd, cwd);
  if (!MAC) {
    const term = linux();
    return term ? linuxArgv(term, cmd) : "no terminal: set $TERMINAL";
  }
  const name = want === "auto" ? MAC_APPS.find(macApp) : want;
  const app = name && macApp(name);
  if (!name || !app) return want === "auto" ? "no terminal found in /Applications" : `${want}.app is not installed`;
  return macArgv(name, app, cmd);
}

/**
 * Opens the terminal and forgets it; the reason when none could be opened.
 * `PAL_TERMINAL_LOG` (tests) records the command the terminal would run
 * (`command`: the `cd` wrapper included) instead of opening one: what a
 * test asserts is the command, and the terminal's own argv differs per
 * machine (kitty takes it as trailing arguments, Terminal.app on the CI
 * runner wraps it in an AppleScript line with its own quoting).
 */
export function open(cmd: string[], want: Choice = "auto", cwd?: string): string | undefined {
  const a = argv(cmd, want, cwd);
  if (typeof a === "string") return a;
  const log = process.env.PAL_TERMINAL_LOG;
  if (log) { appendFileSync(log, JSON.stringify(command(cmd, cwd)) + "\n"); return; }
  Bun.spawn(a, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
}

// ---- a shell in a folder ----------------------------------------------------

/** Single-quoted for a POSIX shell, always. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * What opens a terminal in `cwd` with `tail` run after the `cd` (a command
 * kept open, or the shell alone): the `terminal` setting names the app
 * (macOS: Terminal and iTerm over AppleScript, kitty, Alacritty, WezTerm
 * and Ghostty by their flags, any other name through `open -na`; Linux:
 * the name, else `$TERMINAL`, else the first installed). Undefined when
 * Linux has no terminal to name.
 */
export function on(tail: string, cwd: string, shell: string[], terminal: string, env: Record<string, string | undefined> = process.env, has?: Which): string[] | undefined {
  const line = `cd ${q(cwd)} && ${tail}`;
  if (!MAC) {
    const term = terminal.trim() || linux(env, has);
    return term ? linuxArgv(term, [shell[0], "-c", line]) : undefined;
  }
  const name = (terminal || "Terminal").trim();
  switch (name.toLowerCase()) {
    case "terminal": case "terminal.app": return ["osascript", "-e", `tell application "Terminal"`, "-e", "activate", "-e", `do script ${JSON.stringify(line)}`, "-e", "end tell"];
    case "iterm": case "iterm2": case "iterm.app": return ["osascript", "-e", `tell application "iTerm"`, "-e", "activate", "-e", `set w to (create window with default profile)`, "-e", `tell current session of w to write text ${JSON.stringify(line)}`, "-e", "end tell"];
    case "kitty": return ["open", "-na", "kitty", "--args", "--directory", cwd, shell[0], "-c", tail];
    case "alacritty": return ["open", "-na", "Alacritty", "--args", "--working-directory", cwd, "-e", shell[0], "-c", tail];
    case "wezterm": return ["open", "-na", "WezTerm", "--args", "start", "--cwd", cwd, "--", shell[0], "-c", tail];
    case "ghostty": return ["open", "-na", "Ghostty", "--args", `--working-directory=${cwd}`, `--command=${shell[0]} -c ${q(tail)}`];
    default: return ["open", "-na", name, "--args", "-e", shell[0], "-c", line];
  }
}

/** What opens a terminal in `cwd` with nothing run but the shell (Files' Open in Terminal). */
export function at(cwd: string, terminal: string, shell: string[] = [process.env.SHELL || "/bin/sh"], env: Record<string, string | undefined> = process.env, has?: Which): string[] | undefined {
  return on(`exec ${shell[0]}`, cwd, shell, terminal, env, has);
}
