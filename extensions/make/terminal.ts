// A terminal window running a command: the same rule as the ssh extension's
// Connect (`extensions/ssh/index.ts`), carried here as a copy because a
// bundled extension may not import a sibling's file (each is installable on
// its own). Differences: the words are shell-quoted for the AppleScript
// terminals (ssh passes one bare host name; a path here may carry spaces),
// and `cwd` runs the command from a directory. The same file sits in
// `extensions/docker/`; a shared helper in `@zcag/pal` would replace both.
import { appendFileSync } from "node:fs";
import { home } from "@zcag/pal";

export type TerminalChoice = "auto" | "kitty" | "Terminal" | "iTerm2" | "Ghostty" | "Alacritty";

const LINUX = process.platform === "linux";
const MAC_APPS = ["kitty", "Ghostty", "Alacritty", "iTerm2", "Terminal"] as const;
const macApp = (name: string) => [`/Applications/${name}.app`, `${home("~")}/Applications/${name}.app`, `/System/Applications/Utilities/${name}.app`].find((p) => Bun.file(`${p}/Contents/Info.plist`).size > 0);

/** One word for `sh`: single-quoted unless it needs no quoting. */
export const shq = (s: string) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** Each terminal's way of opening a new window that runs a command; Terminal and iTerm2 have no CLI for it, so AppleScript. */
function macArgv(name: string, app: string, cmd: string[]): string[] {
  const script = (...lines: string[]) => ["osascript", ...lines.flatMap((l) => ["-e", l])];
  const quoted = cmd.map(shq).join(" ").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  switch (name) {
    // `-1`: a new OS window in the running instance when it was started single-instance, else its own.
    case "kitty": return [`${app}/Contents/MacOS/kitty`, "-1", ...cmd];
    case "Terminal": return script(`tell application "Terminal" to do script "${quoted}"`, 'tell application "Terminal" to activate');
    case "iTerm2": return script(`tell application "iTerm2" to create window with default profile command "${quoted}"`, 'tell application "iTerm2" to activate');
    default: return ["open", "-na", app, "--args", "-e", ...cmd];
  }
}

/** The argv that opens a terminal running `cmd` (from `cwd` when given), or a string saying why there is none. */
export function terminalArgv(cmd: string[], want: TerminalChoice = "auto", cwd?: string): string[] | string {
  // Every terminal takes an argv, none a directory the same way: a `cd` in front covers them all.
  if (cwd) cmd = ["sh", "-c", `cd ${shq(cwd)} && exec ${cmd.map(shq).join(" ")}`];
  if (LINUX) {
    const term = process.env.TERMINAL || ["kitty", "foot", "alacritty", "xterm"].find((t) => Bun.which(t));
    if (!term) return "no terminal: set $TERMINAL";
    return /(^|\/)(kitty|foot)$/.test(term) ? [term, ...cmd] : [term, "-e", ...cmd];
  }
  const name = want === "auto" ? MAC_APPS.find(macApp) : want;
  const app = name && macApp(name);
  if (!name || !app) return want === "auto" ? "no terminal found in /Applications" : `${want}.app is not installed`;
  return macArgv(name, app, cmd);
}

/** Opens the terminal and forgets it; the reason when none could be opened. `PAL_TERMINAL_LOG` (tests) records the argv instead of running it. */
export function openTerminal(cmd: string[], want: TerminalChoice = "auto", cwd?: string): string | undefined {
  const argv = terminalArgv(cmd, want, cwd);
  if (typeof argv === "string") return argv;
  const log = process.env.PAL_TERMINAL_LOG;
  if (log) { appendFileSync(log, JSON.stringify(argv) + "\n"); return; }
  Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
}
