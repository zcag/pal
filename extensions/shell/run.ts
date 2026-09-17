// Running a command: the shell's argv from the `shell` setting, the
// spawn with a process-group kill on timeout, stdout and stderr kept
// apart with a cap each, the exit code and the duration; plus the pure
// helpers around it (what looks destructive, the `env` list as a table,
// the argv that opens a terminal on the command).
import { home } from "@zcag/pal";
import { linuxTerminal, linuxTerminalArgv } from "../apps/terminal.ts";

export type Run = {
  cmd: string;
  out: string;
  err: string;
  /** null when the process was killed. */
  code: number | null;
  ms: number;
  timedOut: boolean;
  /** Bytes dropped from stdout or stderr past `CAP`. */
  truncated: boolean;
  startedAt: number;
};

/** Per stream: what is kept for the view and the clipboard (a `find /` prints far more; the tail is what a person reads). */
export const CAP = 256 * 1024;
/** A pick waits this long for the command before answering a running view; the shell's own pick limit is 10 s. */
export const PICK_GRACE_MS = 2500;
/** After SIGTERM on timeout, SIGKILL this much later. */
const KILL_MS = 1500;
const MAC = process.platform === "darwin";

/** `$SHELL -lic` (the default) or any spelling: the first word is the binary, `$SHELL`/`${SHELL}` and `~` expanded; empty falls to the login shell. */
export function shellArgv(setting: string, env: Record<string, string | undefined> = process.env): string[] {
  const login = env.SHELL || (MAC ? "/bin/zsh" : "/bin/sh");
  const words = setting.trim().split(/\s+/).filter(Boolean).map((w) => home(w.replace(/\$\{?SHELL\}?/g, login)));
  return words.length ? words : [login, "-lic"];
}

/** `KEY=VALUE` lines (the `env` list setting) as a table; a line without `=` is skipped, `~` in a value expanded. */
export function envTable(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines) {
    const i = l.indexOf("=");
    if (i > 0) out[l.slice(0, i).trim()] = home(l.slice(i + 1));
  }
  return out;
}

/**
 * Commands that remove, overwrite or escalate, for the confirm card. The
 * line is cut into simple commands (`;`, `&&`, `||`, `|`, subshells) and
 * each one's command word is read past leading `VAR=x` assignments and
 * wrappers (`xargs`, `time`, `nohup`, `exec`, `env`, `nice`); `sudo` and
 * `doas` count by themselves. Then: `rm`, `mv`, `dd`, `mkfs`, `shred`,
 * `truncate`, `wipefs`, `shutdown`/`reboot`/`halt`/`poweroff`, `dropdb`;
 * with their arguments `chmod`/`chown`/`chgrp -R`, `git push --force`,
 * `git reset --hard`, `git clean -f`, `git branch -D`, `git checkout --`,
 * `kill -9`, `docker rm`/`rmi`/`system prune`, a package manager's
 * uninstall/remove/purge, `diskutil erase`, `launchctl bootout`, and any
 * redirect onto a disk device. An argument named `rm` (`echo rm`) is not
 * a command; `rmdir`, `mvn` and `format` never match.
 */
const ALWAYS = new Set(["rm", "mv", "dd", "mkfs", "shred", "truncate", "wipefs", "shutdown", "reboot", "halt", "poweroff", "dropdb", "sudo", "doas"]);
const WRAPPERS = new Set(["xargs", "time", "nohup", "exec", "env", "nice", "command", "builtin", "caffeinate", "timeout"]);
const WITH_ARGS: [RegExp, RegExp][] = [
  [/^(chmod|chown|chgrp)$/, /(^|\s)(-\w*R\w*|--recursive)(\s|$)/],
  [/^git$/, /^\s*(push\s+.*(-\w*f\w*|--force)(\s|$)|reset\s+--hard|clean\s+-\w*[fd]|branch\s+-D|checkout\s+--\s)/],
  [/^(kill|killall|pkill)$/, /(^|\s)-(9|KILL|SIGKILL)(\s|$)/],
  [/^(docker|podman)$/, /^\s*(system\s+prune|rm|rmi|volume\s+(rm|prune)|container\s+(rm|prune)|image\s+(rm|prune))(\s|$)/],
  [/^(brew|apt|apt-get|dnf|yum|pacman|npm|pnpm|yarn|pip|pip3|gem|cargo)$/, /^\s*(uninstall|remove|purge|autoremove|-R\w*)(\s|$)/],
  [/^diskutil$/, /^\s*(erase\w*|reformat|partition\w*|zeroDisk)/i],
  [/^launchctl$/, /^\s*(unload|bootout|remove)(\s|$)/],
  [/^(psql|mysql|sqlite3)$/, /DROP\s+(TABLE|DATABASE|SCHEMA)/i],
];
const DEVICE = /(^|[^<])>\s*\/dev\/(r?disk|sd|nvme|hd|mmcblk)/;

/** The simple commands of a line as [command word, the rest], `mkfs.ext4` read as `mkfs`. */
export function commandsOf(line: string): [string, string][] {
  return line.split(/\|\|?|&&|;|&|\$\(|`|[()]/).flatMap((seg) => {
    const words = seg.trim().split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || WRAPPERS.has(words[i]))) i++;
    if (i >= words.length) return [];
    const name = words[i].replace(/^.*\//, "").replace(/^mkfs\..*$/, "mkfs");
    return [[name, words.slice(i + 1).join(" ")] as [string, string]];
  });
}

export const looksDestructive = (cmd: string): boolean =>
  DEVICE.test(cmd) || commandsOf(cmd).some(([name, rest]) => ALWAYS.has(name) || WITH_ARGS.some(([n, args]) => n.test(name) && args.test(rest)));

/** Runs `cmd` through the shell, in `cwd`, with `env` on top of the host's, for at most `timeout` seconds. Never throws: a shell that cannot start is a Run with the error in `err`. */
export async function run(cmd: string, o: { shell: string[]; cwd: string; env: Record<string, string>; timeout: number }): Promise<Run> {
  const startedAt = Date.now();
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn([...o.shell, cmd], { cwd: o.cwd, env: { ...process.env, ...o.env }, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
  } catch (e) {
    return { cmd, out: "", err: `${o.shell[0]}: ${e instanceof Error ? e.message : String(e)}`, code: null, ms: Date.now() - startedAt, timedOut: false, truncated: false, startedAt };
  }
  const kill = (sig: NodeJS.Signals) => { try { process.kill(-proc.pid, sig); } catch {} try { proc.kill(sig); } catch {} };
  let timedOut = false;
  const timers = [setTimeout(() => { timedOut = true; kill("SIGTERM"); }, o.timeout * 1000), setTimeout(() => { if (timedOut) kill("SIGKILL"); }, o.timeout * 1000 + KILL_MS)];
  // Both streams drained concurrently, never rejecting (an unhandled rejection exits Bun); each capped at CAP with the tail kept.
  let truncated = false;
  const drain = async (s: ReadableStream<Uint8Array>): Promise<string> => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for await (const c of s) {
        chunks.push(c); size += c.length;
        while (size > CAP * 2 && chunks.length > 1) { size -= chunks[0].length; chunks.shift(); truncated = true; }
      }
    } catch {}
    let text = Buffer.concat(chunks).toString();
    if (text.length > CAP) { text = text.slice(-CAP); truncated = true; }
    return text;
  };
  const [code, out, err] = await Promise.all([proc.exited, drain(proc.stdout), drain(proc.stderr)]);
  timers.forEach(clearTimeout);
  return { cmd, out, err, code: timedOut ? null : code, ms: Date.now() - startedAt, timedOut, truncated, startedAt };
}

/** `1.2 s`, `340 ms`, `2 min 5 s`. */
export const duration = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

/** The shell line for a terminal: the command, then the shell kept open so the output stays readable. */
const keepOpen = (cmd: string, shell: string[]) => `${cmd}; exec ${shell[0]}`;

/**
 * What opens a terminal on the command in `cwd` (the `terminal` setting
 * names the app; macOS: Terminal and iTerm over AppleScript, kitty,
 * Alacritty, WezTerm and Ghostty by their command-line flags; Linux: the
 * name, else `$TERMINAL`, else the first installed terminal, each the way
 * it takes a command: `../apps/terminal.ts`). The line is quoted for the
 * shell it lands in; undefined when Linux has no terminal to name.
 */
export function terminalArgv(cmd: string, cwd: string, shell: string[], terminal: string, env: Record<string, string | undefined> = process.env, has?: (name: string) => string | null): string[] | undefined {
  return terminalOn(keepOpen(cmd, shell), cwd, shell, terminal, env, has);
}

/** What opens a terminal in `cwd` with nothing run but the shell (Files' Open in Terminal); the same table as `terminalArgv`. */
export function terminalAt(cwd: string, terminal: string, shell: string[] = [process.env.SHELL || "/bin/sh"], env: Record<string, string | undefined> = process.env, has?: (name: string) => string | null): string[] | undefined {
  return terminalOn(`exec ${shell[0]}`, cwd, shell, terminal, env, has);
}

/** The terminal table: `tail` is what runs after `cd cwd` (a command kept open, or the shell alone). */
function terminalOn(tail: string, cwd: string, shell: string[], terminal: string, env: Record<string, string | undefined>, has?: (name: string) => string | null): string[] | undefined {
  const line = `cd ${q(cwd)} && ${tail}`;
  if (!MAC) {
    const term = terminal.trim() || linuxTerminal(env, has);
    return term ? linuxTerminalArgv(term, [shell[0], "-c", line]) : undefined;
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

/** Single-quoted for a POSIX shell. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
