// SSH hosts from ~/.ssh/config (ported from v1 builtin/ssh.rs): every
// `Host` block that is a name rather than a pattern, with its HostName,
// User and Port; `Include` lines are followed one level (globs, `~`,
// relative to ~/.ssh). Optionally the names in known_hosts as a second
// section. Enter opens a terminal running `ssh <host>`; the other actions
// copy the name or the command.
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { Accessory, Action, Extension, Item } from "../../host/src/protocol.ts";
import { home, settings } from "../../host/src/api.ts";
import { xdg } from "../../host/src/icons.ts";

/** `[extensions.ssh]`, defaults in pal.json. */
type Settings = { config: string; include_known_hosts: boolean; terminal: "auto" | "kitty" | "Terminal" | "iTerm2" | "Ghostty" | "Alacritty" };

type HostEntry = { name: string; hostname?: string; user?: string; port?: string };

const LINUX = process.platform === "linux";
const ICON = xdg("network-server") ?? "⌁";
const ACTIONS: Action[] = [
  { id: "connect", title: "Connect" },
  { id: "copy-host", title: "Copy host", shortcut: "cmd+c" },
  { id: "copy-command", title: "Copy ssh command", shortcut: "cmd+shift+c" },
];

// ---- config ----------------------------------------------------------------

const read = (file: string) => { try { return readFileSync(file, "utf8"); } catch { return ""; } };
const isPattern = (h: string) => /[*?!]/.test(h);

/** An Include operand: `~` expanded, relative to ~/.ssh, globs expanded. */
function included(pattern: string, sshDir: string): string[] {
  const p = home(pattern);
  const abs = isAbsolute(p) ? p : resolve(sshDir, p);
  if (!/[*?[]/.test(abs)) return [abs];
  const dir = dirname(abs);
  return [...new Bun.Glob(basename(abs)).scanSync({ cwd: dir, absolute: true })].sort();
}

/**
 * The `Host` blocks of one file, in order; a `Match` line ends the current
 * block. Keys are case-insensitive, `key value` or `key=value`. `Include`
 * is followed only from the top file (one level, like the v1 builtin).
 */
function parse(file: string, depth = 0): HostEntry[] {
  const out: HostEntry[] = [];
  let current: HostEntry[] = [];
  for (const raw of read(file).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+?)(?:\s*=\s*|\s+)(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    switch (key) {
      case "host":
        current = value.split(/\s+/).filter((h) => h && !isPattern(h)).map((name) => ({ name }));
        out.push(...current);
        break;
      case "match":
        current = [];
        break;
      case "include":
        if (depth === 0) for (const inc of value.split(/\s+/)) for (const f of included(inc, dirname(file))) out.push(...parse(f, depth + 1));
        break;
      case "hostname": for (const h of current) h.hostname ??= value; break;
      case "user": for (const h of current) h.user ??= value; break;
      case "port": for (const h of current) h.port ??= value; break;
    }
  }
  return out;
}

/**
 * Names in known_hosts: the first field, comma-separated, `[host]:port`
 * unwrapped. Hashed lines (`|1|...`) say nothing; bare IPs are noise.
 */
function knownHosts(file: string): string[] {
  const names = new Set<string>();
  for (const raw of read(file).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("@") || line.startsWith("|")) continue;
    for (const part of line.split(/\s+/)[0].split(",")) {
      const h = part.startsWith("[") ? part.slice(1, part.indexOf("]")) : part;
      if (h && !/^[\d.:]+$/.test(h)) names.add(h);
    }
  }
  return [...names].sort();
}

function item(h: HostEntry, section: string): Item {
  const accessories: Accessory[] = [];
  if (h.user) accessories.push({ text: h.user });
  if (h.port) accessories.push({ tag: `:${h.port}` });
  return {
    id: h.name,
    name: h.name,
    subtitle: h.hostname && h.hostname !== h.name ? h.hostname : undefined,
    keywords: [h.hostname, h.user].filter((k): k is string => !!k && k !== h.name),
    icon: ICON,
    accessories,
    section,
    actions: ACTIONS,
  };
}

function list(): Item[] {
  const { config, include_known_hosts } = settings.get<Settings>();
  const file = home(config);
  const seen = new Set<string>();
  const items: Item[] = [];
  for (const h of parse(file)) if (seen.add(h.name)) items.push(item(h, "Configured"));
  if (!include_known_hosts) return items;
  const configured = new Set([...seen, ...items.map((i) => i.subtitle).filter(Boolean)]);
  for (const name of knownHosts(resolve(dirname(file), "known_hosts"))) if (!configured.has(name)) items.push(item({ name }, "Known hosts"));
  return items;
}

// ---- terminals ---------------------------------------------------------------

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

const MAC_APPS = ["kitty", "Ghostty", "Alacritty", "iTerm2", "Terminal"] as const;
const macApp = (name: string) => [`/Applications/${name}.app`, `${home("~")}/Applications/${name}.app`, `/System/Applications/Utilities/${name}.app`].find((p) => Bun.file(`${p}/Contents/Info.plist`).size > 0);

/** Each terminal's way of opening a new window that runs a command; Terminal and iTerm2 have no CLI for it, so AppleScript. */
function macArgv(name: string, app: string, cmd: string[]): string[] {
  const script = (...lines: string[]) => ["osascript", ...lines.flatMap((l) => ["-e", l])];
  const quoted = cmd.join(" ").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  switch (name) {
    // `-1`: a new OS window in the running instance when it was started single-instance, else its own.
    case "kitty": return [`${app}/Contents/MacOS/kitty`, "-1", ...cmd];
    case "Terminal": return script(`tell application "Terminal" to do script "${quoted}"`, 'tell application "Terminal" to activate');
    case "iTerm2": return script(`tell application "iTerm2" to create window with default profile command "${quoted}"`, 'tell application "iTerm2" to activate');
    default: return ["open", "-na", app, "--args", "-e", ...cmd];
  }
}

/** The terminal to run `cmd` in, or undefined with a reason. */
function terminalArgv(cmd: string[]): string[] | string {
  if (LINUX) {
    const term = process.env.TERMINAL || ["kitty", "foot", "alacritty", "xterm"].find((t) => Bun.which(t));
    if (!term) return "no terminal: set $TERMINAL";
    return /(^|\/)(kitty|foot)$/.test(term) ? [term, ...cmd] : [term, "-e", ...cmd];
  }
  const want = settings.get<Settings>().terminal;
  const name = want === "auto" ? MAC_APPS.find(macApp) : want;
  const app = name && macApp(name);
  if (!name || !app) return want === "auto" ? "no terminal found in /Applications" : `${want}.app is not installed`;
  return macArgv(name, app, cmd);
}

export default {
  palettes: {
    ssh: {
      title: "SSH Hosts",
      icon: ICON,
      placeholder: "Connect to a host",
      list,
      pick: (id, action) => {
        const cmd = `ssh ${id}`;
        switch (action) {
          case "copy-host": return { copy: id };
          case "copy-command": return { copy: cmd };
        }
        const argv = terminalArgv(["ssh", id]);
        if (typeof argv === "string") return { keep: true, toast: { title: "Could not open a terminal", message: argv, style: "failure" } };
        spawnDetached(argv);
        return {};
      },
    },
  },
} satisfies Extension;
