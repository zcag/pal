// Processes: one `ps` per keystroke (`listProcesses` in `@zcag/pal`), since
// the set changes constantly; busiest first (CPU, then memory). The query
// matches the name and the pid; `:3000` (or `:` alone) lists what listens
// on a TCP port instead (ports.ts over `ss` or `lsof`). Kill sends SIGTERM,
// Force kill SIGKILL, both after a confirm; the palette stays open and
// lists again so the row is seen to go.
import { exec, failed, hint, listProcesses as ps, settings, type Accessory, type Action, type Detail, type Extension, type Item, type Proc } from "@zcag/pal";
import { parseLsofListeners, parseSsListeners, portQuery } from "./ports.ts";

/** `[extensions.processes]`, defaults in pal.json. */
type Settings = { include_system: boolean };

const LINUX = process.platform === "linux";
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
// Kill, force kill and copy PID work on marked rows too (`ctx.ids`).
const ACTIONS: Action[] = [
  { id: "kill", title: "Kill", style: "destructive", confirm: "Send SIGTERM?", multi: true },
  { id: "force-kill", title: "Force kill", shortcut: "cmd+shift+k", style: "destructive", confirm: "Send SIGKILL? The process gets no chance to clean up.", multi: true },
  { id: "copy-pid", title: "Copy PID", shortcut: "cmd+c", multi: true },
  ...(MAC ? [{ id: "activity-monitor", title: "Open in Activity Monitor", shortcut: "cmd+o" }] : []),
];
/** `ss` where it is (Linux), else `lsof` (macOS ships it); neither is a hint row. */
const PORTS = Bun.which("ss") ? ["ss", "-ltnpH"] : Bun.which("lsof") ? ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"] : undefined;
const PORTS_MS = 3000;

/** ps reports rss in KiB. */
const human = (kb: number) => (kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`);

/** The `.app` bundle a macOS executable lives in, if any. */
const bundleOf = (p: Proc) => { const i = MAC ? p.comm.indexOf(".app/Contents/MacOS/") : -1; return i > 0 ? p.comm.slice(0, i + 4) : undefined; };

/** The bundle's icon for an app's process, a glyph otherwise. */
function icon(p: Proc): Item["icon"] {
  const app = bundleOf(p);
  return app ? { app } : ICON;
}

/** The last listing's processes by pid, what `detail` reads (`pick` needs only the pid). */
const seen = new Map<number, Proc>();

const busy = (p: Proc) => p.cpu > 10;
const cpuTag = (p: Proc) => ({ tag: `${p.cpu.toFixed(0)}% cpu`, color: p.cpu >= 50 ? "red" as const : "amber" as const });

/** A process as a page: where it runs from, its name, then its numbers large. */
function detail(id: string): Detail | undefined {
  const p = seen.get(Number(id.split(":")[0]));
  if (!p) return;
  return {
    caption: p.comm,
    title: p.name,
    // A busy one's CPU in its tag's colour.
    stats: [{ value: `${p.cpu.toFixed(1)}%`, label: "CPU", ...(busy(p) && { color: cpuTag(p).color }) }, { value: human(p.rss), label: "memory" }, { value: String(p.pid), label: "pid" }],
    metadata: [
      { label: "Parent", value: String(p.ppid) },
      { label: "User", value: p.uid === UID ? "you" : String(p.uid) },
    ],
  };
}

/** The name, then its pid and (outside an app, whose icon says which) the command; a busy one's CPU as a tag, its memory. */
function item(p: Proc): Item {
  seen.set(p.pid, p);
  const accessories: Accessory[] = [...(busy(p) ? [cpuTag(p)] : []), { text: human(p.rss) }];
  const where = !bundleOf(p) && p.comm !== p.name ? ` · ${p.comm}` : "";
  return { id: String(p.pid), name: p.name, subtitle: `pid ${p.pid}${where}`, icon: icon(p), keywords: [String(p.pid)], accessories, actions: ACTIONS, pid: p.pid, cpu: p.cpu, rss: p.rss };
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
    const base = p ? item(p) : { id: String(l.pid), name: l.command, icon: ICON, keywords: [String(l.pid)], accessories: [], actions: ACTIONS, pid: l.pid };
    return { ...base, id: `${l.pid}:${l.port}`, subtitle: `${l.address}:${l.port} · pid ${l.pid}`, keywords: [...(base.keywords ?? []), `:${l.port}`, String(l.port)], accessories: [{ tag: `:${l.port}`, color: "blue" }, ...(base.accessories ?? [])] };
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
      pick: (id, action, ctx) => {
        // A listener row's id is `pid:port`; two listeners of one process are one pid.
        const pidOf = (x: string) => Number(x.split(":")[0]);
        const pid = pidOf(id);
        const pids = [...new Set((ctx?.ids ?? [id]).map(pidOf))];
        if (action === "copy-pid") return { copy: pids.join("\n") };
        if (action === "activity-monitor") { activityMonitor(pid); return { hide: true }; }
        // Every pid gets its signal even when one fails (gone already, not ours); the failures are named after.
        const bad: string[] = [];
        let first: unknown;
        for (const p of pids) {
          try { process.kill(p, action === "force-kill" ? "SIGKILL" : "SIGTERM"); } catch (e) { bad.push(String(p)); first ??= e; }
        }
        if (bad.length) return failed(`kill ${pids.length > 1 ? bad.join(", ") : id}`, first);
        return pids.length > 1 ? { keep: true, toast: { title: `Killed ${pids.length} processes` } } : { keep: true };
      },
    },
  },
} satisfies Extension;
