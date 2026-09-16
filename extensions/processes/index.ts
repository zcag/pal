// Processes (ported from v1 builtin/psg.rs): one `ps` per keystroke, since
// the set changes constantly; busiest first (CPU, then memory). The query
// matches the name and the pid. Kill sends SIGTERM, Force kill SIGKILL,
// both after a confirm; the palette stays open and lists again so the row
// is seen to go.
import { settings, type Accessory, type Action, type Extension, type Item } from "@zcag/pal";

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

const ACTIONS: Action[] = [
  { id: "kill", title: "Kill", style: "destructive", confirm: "Send SIGTERM?" },
  { id: "force-kill", title: "Force kill", shortcut: "cmd+shift+k", style: "destructive", confirm: "Send SIGKILL? The process gets no chance to clean up." },
  { id: "copy-pid", title: "Copy PID", shortcut: "cmd+c" },
];

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
  if (LINUX) return "▤";
  const i = p.comm.indexOf(".app/Contents/MacOS/");
  return i > 0 ? { app: p.comm.slice(0, i + 4) } : "▤";
}

function item(p: Proc): Item {
  const accessories: Accessory[] = [];
  if (p.cpu > 10) accessories.push({ tag: `${p.cpu.toFixed(0)}% cpu`, color: p.cpu >= 50 ? "red" : "orange" });
  accessories.push({ text: String(p.pid) }, { text: human(p.rss) });
  return { id: String(p.pid), name: p.name, subtitle: p.comm !== p.name ? p.comm : undefined, icon: icon(p), keywords: [String(p.pid)], accessories, actions: ACTIONS, pid: p.pid, cpu: p.cpu, rss: p.rss };
}

// Kernel threads are children of kthreadd (pid 2); `ps -o comm` shows them without the brackets `args` would.
const isSystem = (p: Proc) => p.pid < 100 || (LINUX && (p.pid === 2 || p.ppid === 2));

async function list(query = "", filter = "all"): Promise<Item[]> {
  const { include_system } = settings.get<Settings>();
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
      icon: "▤",
      live: true,
      input: true,
      placeholder: "Name or pid",
      filters: FILTERS,
      list: (query, ctx) => list(query, ctx?.filter),
      pick: (id, action) => {
        const pid = Number(id);
        if (action === "copy-pid") return { copy: id };
        try {
          process.kill(pid, action === "force-kill" ? "SIGKILL" : "SIGTERM");
        } catch (e) {
          return { keep: true, toast: { title: `Could not kill ${id}`, message: String((e as Error)?.message ?? e), style: "failure" } };
        }
        return { keep: true };
      },
    },
  },
} satisfies Extension;
