// SSH hosts from ~/.ssh/config (ported from v1 builtin/ssh.rs): every
// `Host` block that is a name rather than a pattern, with its HostName,
// User, Port and ProxyJump; `Include` lines are followed one level (globs,
// `~`, relative to ~/.ssh), and the file a host came from is its section.
// Optionally the names in known_hosts as a last section. Enter opens a
// terminal running `ssh <host>`; the other actions copy the name or the
// command (the `-J` form for a host behind a jump), or ping the host.
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { home, settings, xdg, type Accessory, type Action, type Extension, type Item, type Metadata } from "@zcag/pal";

/** `[extensions.ssh]`, defaults in pal.json. */
type Settings = { config: string; include_known_hosts: boolean; terminal: "auto" | "kitty" | "Terminal" | "iTerm2" | "Ghostty" | "Alacritty" };

type HostEntry = { name: string; file: string; hostname?: string; user?: string; port?: string; jump?: string };

const LINUX = process.platform === "linux";
const ICON = xdg("network-server") ?? "⌁";
const CONNECT: Action = { id: "connect", title: "Connect" };
const COPY_HOST: Action = { id: "copy-host", title: "Copy host", shortcut: "cmd+c" };
const COPY_COMMAND: Action = { id: "copy-command", title: "Copy ssh command", shortcut: "cmd+shift+c" };
const COPY_JUMP: Action = { id: "copy-jump", title: "Copy ssh -J command", shortcut: "cmd+shift+j" };
const PING: Action = { id: "ping", title: "Ping", shortcut: "cmd+p" };
const PING_MS = 3000;
const KNOWN = "Known hosts";

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
        current = value.split(/\s+/).filter((h) => h && !isPattern(h)).map((name) => ({ name, file }));
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
      case "proxyjump": if (value.toLowerCase() !== "none") for (const h of current) h.jump ??= value; break;
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

/** The section for a file: relative to the config's directory when under it, `~` for the home otherwise. */
function sectionOf(file: string, configDir: string): string {
  const rel = relative(configDir, file);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return `${basename(configDir)}/${rel}`;
  const h = home("~");
  return file.startsWith(h + "/") ? "~" + file.slice(h.length) : file;
}

/** What a pick needs beyond the name, from the last listing. */
const hosts = new Map<string, HostEntry>();

function item(h: HostEntry, section: string): Item {
  const accessories: Accessory[] = [];
  if (h.user) accessories.push({ text: h.user });
  if (h.port) accessories.push({ tag: `:${h.port}` });
  if (h.jump) accessories.push({ tag: `via ${h.jump}`, color: "blue" });
  const metadata: Metadata[] = [
    { label: "Host", value: h.name },
    ...(h.hostname ? [{ label: "HostName", value: h.hostname }] : []),
    ...(h.user ? [{ label: "User", value: h.user }] : []),
    ...(h.port ? [{ label: "Port", value: h.port }] : []),
    ...(h.jump ? [{ label: "ProxyJump", value: h.jump }] : []),
    { label: "File", value: section },
  ];
  return {
    id: h.name,
    name: h.name,
    subtitle: h.hostname && h.hostname !== h.name ? h.hostname : undefined,
    keywords: [h.hostname, h.user, h.jump].filter((k): k is string => !!k && k !== h.name),
    icon: ICON,
    accessories,
    section,
    detail: { markdown: `# ${h.name}\n\n\`\`\`\nssh ${h.jump ? `-J ${h.jump} ` : ""}${h.name}\n\`\`\``, metadata },
    actions: [CONNECT, COPY_HOST, COPY_COMMAND, ...(h.jump ? [COPY_JUMP] : []), PING],
  };
}

function list(): Item[] {
  const { config, include_known_hosts } = settings.get<Settings>();
  const file = home(config);
  const seen = new Set<string>();
  const items: Item[] = [];
  hosts.clear();
  for (const h of parse(file)) {
    if (seen.has(h.name)) continue;
    seen.add(h.name);
    hosts.set(h.name, h);
    items.push(item(h, sectionOf(h.file, dirname(file))));
  }
  // Nothing configured: one inert row that says where hosts come from.
  if (!items.length && !include_known_hosts) return [{ id: "hint:empty", name: "No hosts in your ssh config", subtitle: `Add a Host block to ${config}, or point Config file in Settings at another file`, icon: ICON, actions: [] }];
  if (!include_known_hosts) return items;
  const configured = new Set([...seen, ...items.map((i) => i.subtitle).filter(Boolean)]);
  for (const name of knownHosts(resolve(dirname(file), "known_hosts"))) if (!configured.has(name)) items.push(item({ name, file }, KNOWN));
  return items;
}

/** One echo; the round trip from ping's own `time=` field, or why not. macOS takes `-W` in ms, Linux in seconds. */
async function ping(target: string): Promise<{ ok: true; ms: number } | { ok: false; why: string }> {
  const proc = Bun.spawn(["ping", "-c", "1", "-W", LINUX ? "2" : "2000", target], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), PING_MS);
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  const m = out.match(/time[=<]([\d.]+)\s*ms/);
  if (code === 0 && m) return { ok: true, ms: parseFloat(m[1]) };
  return { ok: false, why: (err.trim() || out.trim().split("\n").pop() || `ping exited ${code}`).replace(/^ping: /, "") };
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
      placeholder: "Connect to a host",
      list,
      pick: async (id, action) => {
        const cmd = `ssh ${id}`;
        // A pick on a row restored from the persisted index, before this run has listed.
        if (!hosts.size) list();
        const h = hosts.get(id);
        switch (action) {
          case "copy-host": return { copy: id };
          case "copy-command": return { copy: cmd };
          case "copy-jump": return { copy: h?.jump ? `ssh -J ${h.jump} ${id}` : cmd };
          case "ping": {
            const target = h?.hostname ?? id;
            const r = await ping(target);
            return { keep: true, toast: r.ok ? { title: `${target}: ${r.ms < 10 ? r.ms.toFixed(1) : Math.round(r.ms)} ms`, style: "success" } : { title: `${target} did not answer`, message: r.why, style: "failure" } };
          }
        }
        const argv = terminalArgv(["ssh", id]);
        if (typeof argv === "string") return { keep: true, toast: { title: "Could not open a terminal", message: argv, style: "failure" } };
        spawnDetached(argv);
        return {};
      },
    },
  },
} satisfies Extension;
