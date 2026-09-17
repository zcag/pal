// The terminal on Linux, one answer for every extension that opens one
// (apps' Terminal=true entries, ssh, shell's "Run in terminal"): `$TERMINAL`
// when set, else the first installed of a known list, `x-terminal-emulator`
// (Debian's alternatives pointer, the user's own choice there) first. How
// the command is handed over differs per program: kitty and foot take it as
// trailing arguments, WezTerm and GNOME Terminal after `start --` / `--`,
// the rest after `-e`.

/** Known terminals in the order they are tried when `$TERMINAL` is unset. */
export const LINUX_TERMINALS = ["x-terminal-emulator", "kitty", "foot", "alacritty", "wezterm", "ghostty", "gnome-terminal", "konsole", "xfce4-terminal", "xterm"];

type Which = (name: string) => string | null;
const which: Which = (name) => Bun.which(name);

/** The terminal's command name or path, or undefined when nothing is found (the caller says "set $TERMINAL"). */
export function linuxTerminal(env: Record<string, string | undefined> = process.env, has: Which = which): string | undefined {
  const t = env.TERMINAL?.trim();
  return t || LINUX_TERMINALS.find((n) => has(n));
}

/** argv running `cmd` in `term` (a name or path), the way that program takes a command. */
export function linuxTerminalArgv(term: string, cmd: string[]): string[] {
  const base = term.slice(term.lastIndexOf("/") + 1).toLowerCase();
  switch (base) {
    case "kitty": case "foot": return [term, ...cmd];
    case "wezterm": return [term, "start", "--", ...cmd];
    case "gnome-terminal": return [term, "--", ...cmd];
    default: return [term, "-e", ...cmd];
  }
}
