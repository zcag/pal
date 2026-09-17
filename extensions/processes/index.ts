// Processes: one `ps` per keystroke, since
// the set changes constantly; busiest first (CPU, then memory). The query
// matches the name and the pid; `:3000` (or `:` alone) lists what listens
// on a TCP port instead (ports.ts over `ss` or `lsof`). Kill sends SIGTERM,
// Force kill SIGKILL, both after a confirm; the palette stays open and
// lists again so the row is seen to go.
import { exec, failed, hint, settings, type Accessory, type Action, type Detail, type Extension, type Item } from "@zcag/pal";
import { parseLsofListeners, parseSsListeners, portQuery } from "./ports.ts";

/** `[extensions.processes]`, defaults in pal.json. */
type Settings = { include_system: boolean };

type Proc = { pid: number; ppid: number; uid: number; cpu: number; rss: number; comm: string; name: string };

const LINUX = process.platform === "linux";
// `comm` last: on macOS it is the full path and may contain spaces.
const PS = LINUX ? ["ps", "-eo", "pid=,ppid=,uid=,%cpu=,%mem=,rss=,comm="] : ["ps", "-axo", "pid=,ppid=,uid=,%cpu=,%mem=,rss=,comm="];
const SELF = process.pid;
const UID = process.getuid?.() ?? -1;

const FILTERS = [
  { id: "all", title: "All" },
  { id: "mine", title: "Mine" },
  { id: "cpu", title: "Top CPU" },
  { id: "memory", title: "Top memory" },
];
/** The top-N filters show this many. */
const TOP = 25;

const MAC = process.platform === "darwin";
/** md-memory for a process without an app bundle and the palette; md-alert_circle_outline for the hint row. */
const ICON = "\u{f035b}";
const HINT_ICON = "\u{f05d6}";
const ACTIONS: Action[] = [
  { id: "kill", title: "Kill", style: "destructive", confirm: "Send SIGTERM?" },
  { id: "force-kill", title: "Force kill", shortcut: "cmd+shift+k", style: "destructive", confirm: "Send SIGKILL? The process gets no chance to clean up." },
  { id: "copy-pid", title: "Copy PID", shortcut: "cmd+c" },
  ...(MAC ? [{ id: "activity-monitor", title: "Open in Activity Monitor", shortcut: "cmd+o" }] : []),
];
/** `ss` where it is (Linux), else `lsof` (macOS ships it); neither is a hint row. */
const PORTS = Bun.which("ss") ? ["ss", "-ltnpH"] : Bun.which("lsof") ? ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"] : undefined;
const PORTS_MS = 3000;

async function ps(): Promise<Proc[]> {
  const out = await new Response(Bun.spawn(PS, { stdout: "pipe", stderr: "ignore" }).stdout).text();
  const procs: Proc[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const comm = m[7].trim();
    if (!comm) continue;
    procs.push({ pid: +m[1], ppid: +m[2], uid: +m[3], cpu: +m[4], rss: +m[6], comm, name: comm.slice(comm.lastIndexOf("/") + 1) });
  }
  return procs;
}

/** ps reports rss in KiB. */
const human = (kb: number) => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`);

/** The `.app` bundle a macOS executable lives in, for its icon; a glyph otherwise. */
function icon(p: Proc): Item["icon"] {
  if (LINUX) return ICON;
  const i = p.comm.indexOf(".app/Contents/MacOS/");
  return i > 0 ? { app: p.comm.slice(0, i + 4) } : ICON;
}

/** The last listing's processes by pid, what `detail` reads (`pick` needs only the pid). */
const seen = new Map<number, Proc>();

function detail(id: string): Detail | undefined {
  const p = seen.get(Number(id.split(":")[0]));
  if (!p) return;
  return { metadata: [
    { label: "Command", value: p.comm },
    { label: "PID", value: String(p.pid) },
    { label: "Parent", value: String(p.ppid) },
    { label: "User", value: p.uid === UID ? "you" : String(p.uid) },
    { label: "CPU", value: `${p.cpu.toFixed(1)}%` },
    { label: "Memory", value: human(p.rss) },
  ] };
}

function item(p: Proc): Item {
  seen.set(p.pid, p);
  const accessories: Accessory[] = [];
  if (p.cpu > 10) accessories.push({ tag: `${p.cpu.toFixed(0)}% cpu`, color: p.cpu >= 50 ? "red" : "amber" });
  accessories.push({ text: String(p.pid) }, { text: human(p.rss) });
  return { id: String(p.pid), name: p.name, subtitle: p.comm !== p.name ? p.comm : undefined, icon: icon(p), keywords: [String(p.pid)], accessories, actions: ACTIONS, pid: p.pid, cpu: p.cpu, rss: p.rss };
}

// Kernel threads are children of kthreadd (pid 2); `ps -o comm` shows them without the brackets `args` would.
const isSystem = (p: Proc) => p.pid < 100 || (LINUX && (p.pid === 2 || p.ppid === 2));

/** Every TCP listener, one row per process and port, with the port as a tag; the `ps` row's numbers when the process is in it. */
async function listeners(prefix: string): Promise<Item[]> {
  if (!PORTS) return [hint("no-ports", "No port listing tool", "Install lsof (or ss) to list what listens on a port", { icon: HINT_ICON })];
  // lsof exits non-zero over files it may not read; its listing still stands.
  const out = (await exec(PORTS, { ms: PORTS_MS }).catch(() => undefined))?.out ?? "";
  const found = (PORTS[0] === "ss" ? parseSsListeners(out) : parseLsofListeners(out)).filter((l) => String(l.port).startsWith(prefix)).sort((a, b) => a.port - b.port || a.pid - b.pid);
  if (!found.length) return [];
  const procs = new Map((await ps()).map((p) => [p.pid, p]));
  return found.map((l): Item => {
    const p = procs.get(l.pid);
    const base = p ? item(p) : { id: String(l.pid), name: l.command, icon: ICON, keywords: [String(l.pid)], accessories: [{ text: String(l.pid) }], actions: ACTIONS, pid: l.pid };
    return { ...base, id: `${l.pid}:${l.port}`, subtitle: `${l.address}:${l.port}`, keywords: [...(base.keywords ?? []), `:${l.port}`, String(l.port)], accessories: [{ tag: `:${l.port}`, color: "blue" }, ...(base.accessories ?? [])] };
  });
}

/** `Activity Monitor` brought up with the pid typed into its search field (needs Accessibility for the keystrokes); without it, just the app. */
function activityMonitor(pid: number) {
  const script = ['tell application "Activity Monitor" to activate', 'delay 0.5', `tell application "System Events" to tell process "Activity Monitor" to keystroke "f" using command down`, 'delay 0.2', `tell application "System Events" to keystroke "${pid}"`];
  Bun.spawn(["osascript", ...script.flatMap((l) => ["-e", l])], { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
}

async function list(query = "", filter = "all"): Promise<Item[]> {
  const { include_system } = settings.get<Settings>();
  const port = portQuery(query.trim());
  if (port !== undefined) return listeners(port);
  const q = query.trim().toLowerCase();
  let procs = (await ps()).filter((p) => p.pid !== SELF && (include_system || !isSystem(p)));
  if (filter === "mine") procs = procs.filter((p) => p.uid === UID);
  if (q) procs = procs.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).startsWith(q));
  procs.sort(filter === "memory" ? (a, b) => b.rss - a.rss || b.cpu - a.cpu : (a, b) => b.cpu - a.cpu || b.rss - a.rss);
  if (filter === "cpu" || filter === "memory") procs = procs.slice(0, TOP);
  return procs.map(item);
}

export default {
  palettes: {
    processes: {
      title: "Processes",
      live: true,
      input: true,
      placeholder: "Name, pid, or :port",
      filters: FILTERS,
      list: (query, ctx) => list(query, ctx?.filter),
      detail,
      pick: (id, action) => {
        // A listener row's id is `pid:port`.
        const pid = Number(id.split(":")[0]);
        if (action === "copy-pid") return { copy: String(pid) };
        if (action === "activity-monitor") { activityMonitor(pid); return { hide: true }; }
        try {
          process.kill(pid, action === "force-kill" ? "SIGKILL" : "SIGTERM");
        } catch (e) {
          return failed(`kill ${id}`, e);
        }
        return { keep: true };
      },
    },
  },
} satisfies Extension;
