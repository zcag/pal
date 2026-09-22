// The sources, each a parser over one tool's text (tested on fixtures)
// and a sampler that runs them. Nothing here needs root: `os.cpus()` and
// `os.loadavg()` in process, `vm_stat` + `sysctl` on macOS and
// `/proc/meminfo` + `/proc/pressure/memory` on Linux for memory,
// `netstat -ibn` / `/proc/net/dev` for the counters, `df -kP` + the mount
// table for the volumes, `ps` (the SDK's `listProcesses`) for the top
// processes. Rates and CPU shares are deltas between two samples, so the
// sampler keeps the last counters; one sample alone says nothing.
import { readFile, readdir, readlink } from "node:fs/promises";
import { cpus, loadavg, uptime } from "node:os";
import { exec, listProcesses, type Proc } from "@zcag/pal";

export type OS = "darwin" | "linux";
export const OS: OS = process.platform === "linux" ? "linux" : "darwin";

export type Pressure = "normal" | "warn" | "critical";
/** Bytes throughout; `pressure` is the kernel's word for it (macOS's memorystatus level, Linux's PSI). */
export type Memory = { total: number; used: number; app: number; wired: number; compressed: number; cached: number; free: number; pressure: Pressure; swapTotal: number; swapUsed: number };
export type Volume = { mount: string; name: string; device: string; fs?: string; total: number; used: number; free: number; readOnly: boolean };
/** Per interface: cumulative bytes in and out, what two samples turn into a rate. */
export type Counters = Record<string, { rx: number; tx: number; addr?: string }>;
export type IfaceRate = { name: string; down: number; up: number; rx: number; tx: number; addr?: string };
export type Cpu = { total: number; cores: number[] };
export type Sample = {
  at: number;
  /** Percent 0..100, the whole machine and each core, over the interval since the previous sample. */
  cpu: Cpu;
  load: [number, number, number];
  memory?: Memory;
  net: { ifaces: IfaceRate[]; down: number; up: number };
  /** Seconds. */
  uptime: number;
  volumes: Volume[];
  /** The `ps` table when this sample took one (the sampler asks for it less often than it samples). */
  procs?: Proc[];
};

// ---- cpu -------------------------------------------------------------------

type CpuTimes = { busy: number; total: number }[];

/** Cumulative ticks per core from `os.cpus()`; `idle` is the only rest, the other four columns are work. */
export function cpuTimes(): CpuTimes {
  return cpus().map((c) => {
    const t = c.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    return { busy: total - t.idle, total };
  });
}

/** The shares between two readings: per core and the mean, percent. A core whose counters did not move reads 0. */
export function cpuDelta(prev: CpuTimes, next: CpuTimes): Cpu {
  const cores = next.map((n, i) => {
    const p = prev[i];
    const dt = p ? n.total - p.total : 0;
    return dt > 0 ? Math.max(0, Math.min(100, ((n.busy - p.busy) / dt) * 100)) : 0;
  });
  const total = cores.length ? cores.reduce((a, b) => a + b, 0) / cores.length : 0;
  return { total, cores };
}

// ---- memory ----------------------------------------------------------------

/** `vm_stat`: the page size from its header and every `Pages ...:` counter, in pages. */
export function parseVmStat(text: string): { pageSize: number; pages: Record<string, number> } {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 4096);
  const pages: Record<string, number> = {};
  for (const m of text.matchAll(/^"?([^:"]+)"?:\s+(\d+)\.?$/gm)) pages[m[1].trim()] = Number(m[2]);
  return { pageSize, pages };
}

/**
 * Activity Monitor's arithmetic over `vm_stat`: app memory is the anonymous
 * pages less the purgeable ones, used is app + wired + compressed, cached
 * is file-backed + purgeable. `sysctl` gives the total, the swap line
 * (`total = 4096.00M  used = 3363.88M ...`) and the pressure level
 * (1 normal, 2 warning, 4 critical).
 */
export function macMemory(vmStat: string, sysctl: { memsize: number; swap: string; pressure: number }): Memory {
  const { pageSize, pages } = parseVmStat(vmStat);
  const p = (k: string) => (pages[k] ?? 0) * pageSize;
  const app = Math.max(0, p("Anonymous pages") - p("Pages purgeable"));
  const wired = p("Pages wired down");
  const compressed = p("Pages occupied by compressor");
  const cached = p("File-backed pages") + p("Pages purgeable");
  const mb = (k: string) => { const m = new RegExp(`${k} = ([\\d.]+)([KMG])`).exec(sysctl.swap); return m ? Number(m[1]) * ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3 } as Record<string, number>)[m[2]] : 0; };
  return { total: sysctl.memsize, used: app + wired + compressed, app, wired, compressed, cached, free: p("Pages free"), pressure: sysctl.pressure >= 4 ? "critical" : sysctl.pressure >= 2 ? "warn" : "normal", swapTotal: mb("total"), swapUsed: mb("used") };
}

/** `/proc/meminfo` (kB) with `/proc/pressure/memory` for the pressure: used is total less available, cached is the page cache plus reclaimable slab. */
export function parseMeminfo(text: string, psi = ""): Memory {
  const kb: Record<string, number> = {};
  for (const m of text.matchAll(/^(\w+):\s+(\d+)/gm)) kb[m[1]] = Number(m[2]) * 1024;
  const total = kb.MemTotal ?? 0;
  const available = kb.MemAvailable ?? kb.MemFree ?? 0;
  const cached = (kb.Cached ?? 0) + (kb.SReclaimable ?? 0) + (kb.Buffers ?? 0);
  const used = Math.max(0, total - available);
  return { total, used, app: Math.max(0, used - (kb.Shmem ?? 0)), wired: kb.Shmem ?? 0, compressed: 0, cached, free: kb.MemFree ?? 0, pressure: parsePsi(psi), swapTotal: kb.SwapTotal ?? 0, swapUsed: Math.max(0, (kb.SwapTotal ?? 0) - (kb.SwapFree ?? 0)) };
}

/** PSI's `some avg10` (the share of the last 10 s some task waited on memory): warn from 10%, critical once `full` passes 5%. */
export function parsePsi(text: string): Pressure {
  const some = Number(/^some avg10=([\d.]+)/m.exec(text)?.[1] ?? 0);
  const full = Number(/^full avg10=([\d.]+)/m.exec(text)?.[1] ?? 0);
  return full >= 5 ? "critical" : some >= 10 ? "warn" : "normal";
}

// ---- network ---------------------------------------------------------------

/** What counts toward the totals: the physical links. Tunnels carry traffic a physical link already counted, and the Apple-private ones never carry the user's. */
const COUNTED = /^(en|eth|wl|enp|eno|ens|wlp|bond|br0)/;
const NOISE = /^(lo|anpi|ap|awdl|llw|gif|stf|bridge|vmenet|docker|veth|virbr)/;
export const counted = (name: string) => COUNTED.test(name) && !NOISE.test(name);
/** What a popover lists: the counted links, anything with an address (a tunnel), and whatever else moved a byte this sample. */
export const shownIface = (i: IfaceRate) => counted(i.name) || (!!i.addr && !NOISE.test(i.name)) || i.down + i.up > 0;

/**
 * `netstat -ibn`: the `<Link#N>` row of each interface has the byte
 * counters (an address column only when the link has a MAC, so the
 * columns are matched from the right), the `inet` rows under it its IPv4.
 * A name ending `*` is down.
 */
export function parseNetstat(text: string): Counters {
  const out: Counters = {};
  for (const line of text.split("\n")) {
    // The address is a MAC or nothing; only a colon tells it from the packet count that follows.
    const link = /^(\S+?)\*?\s+\d+\s+<Link#\d+>(?:\s+[0-9a-f]{1,2}(?::[0-9a-f]{1,2})+)?\s+(\d+)\s+(?:\d+|-)\s+(\d+)\s+(\d+)\s+(?:\d+|-)\s+(\d+)/.exec(line);
    if (link) { out[link[1]] = { rx: Number(link[3]), tx: Number(link[5]) }; continue; }
    const inet = /^(\S+)\s+\d+\s+\d+(?:\.\d+)*(?:\/\d+)?\s+(\d+\.\d+\.\d+\.\d+)\s/.exec(line);
    if (inet && out[inet[1]] && !out[inet[1]].addr) out[inet[1]].addr = inet[2];
  }
  return out;
}

/** `/proc/net/dev`: `name: rx_bytes ... tx_bytes` (the ninth column). */
export function parseProcNetDev(text: string): Counters {
  const out: Counters = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([^:\s]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/.exec(line);
    if (m) out[m[1]] = { rx: Number(m[2]), tx: Number(m[3]) };
  }
  return out;
}

/** `ip -j -br addr` (or `ip -j addr`): the first global IPv4 per interface. */
export function parseIpAddr(json: string): Record<string, string> {
  const out: Record<string, string> = {};
  let list: { ifname?: string; addr_info?: { family?: string; local?: string; scope?: string }[] }[] = [];
  try { list = JSON.parse(json || "[]"); } catch { return out; }
  for (const i of list) {
    const a = (i.addr_info ?? []).find((x) => x.family === "inet" && x.scope !== "link" && x.local);
    if (i.ifname && a?.local) out[i.ifname] = a.local;
  }
  return out;
}

/** Bytes per second per interface between two readings `seconds` apart; a counter that went backwards (a reset) reads 0 that once. */
export function rates(prev: Counters, next: Counters, seconds: number): IfaceRate[] {
  const out: IfaceRate[] = [];
  for (const [name, n] of Object.entries(next)) {
    const p = prev[name];
    const per = (a: number, b: number) => (p && seconds > 0 && a >= b ? (a - b) / seconds : 0);
    out.push({ name, down: p ? per(n.rx, p.rx) : 0, up: p ? per(n.tx, p.tx) : 0, rx: n.rx, tx: n.tx, addr: n.addr });
  }
  return out;
}

// ---- disks -----------------------------------------------------------------

type DfRow = { device: string; total: number; used: number; free: number; mount: string };

/** `df -kP`: 1024-blocks, the mount point being everything after the capacity column (it may hold spaces). */
export function parseDf(text: string): DfRow[] {
  const out: DfRow[] = [];
  for (const line of text.split("\n").slice(1)) {
    const m = /^(\S.*?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(\/.*)$/.exec(line);
    if (m) out.push({ device: m[1], total: Number(m[2]) * 1024, used: Number(m[3]) * 1024, free: Number(m[4]) * 1024, mount: m[5] });
  }
  return out;
}

export type MountInfo = { fs?: string; readOnly: boolean };

/** macOS `mount`: `/dev/disk5s1 on /Volumes/Slack (hfs, local, read-only, ...)`. */
export function parseMacMount(text: string): Record<string, MountInfo> {
  const out: Record<string, MountInfo> = {};
  for (const m of text.matchAll(/^\S+ on (.+) \(([^)]*)\)$/gm)) {
    const opts = m[2].split(",").map((s) => s.trim());
    out[m[1]] = { fs: opts[0], readOnly: opts.includes("read-only") };
  }
  return out;
}

/** `/proc/mounts`: device, mount point (octal escapes decoded), type, options. */
export function parseProcMounts(text: string): Record<string, MountInfo> {
  const out: Record<string, MountInfo> = {};
  for (const line of text.split("\n")) {
    const f = line.split(" ");
    if (f.length < 4) continue;
    const mount = f[1].replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
    out[mount] = { fs: f[2], readOnly: f[3].split(",").includes("ro") };
  }
  return out;
}

/** The mounts a user thinks of as disks: the startup volume and what sits under `/Volumes` on macOS (the APFS container's other roles, Preboot, VM, Data, a translocated app, are the same disk or not one); on Linux the block devices, not tmpfs, overlays, snaps or the EFI stub. */
export function volumes(rows: DfRow[], mounts: Record<string, MountInfo>, os: OS, rootName?: string): Volume[] {
  const LINUX_SKIP = new Set(["tmpfs", "devtmpfs", "squashfs", "overlay", "efivarfs", "fuse.portal", "fuse.snapfuse", "vfat"]);
  const out: Volume[] = [];
  for (const r of rows) {
    const info = mounts[r.mount] ?? { readOnly: false };
    if (os === "darwin") {
      if (r.mount !== "/" && !r.mount.startsWith("/Volumes/")) continue;
      if (!r.device.startsWith("/dev/")) continue;
    } else {
      if (!r.device.startsWith("/dev/") || LINUX_SKIP.has(info.fs ?? "") || r.mount.startsWith("/boot/efi") || r.mount.startsWith("/snap/")) continue;
    }
    if (!r.total) continue;
    // APFS volumes of one container share its free space: the startup volume's
    // own "used" is its sealed system snapshot; what the container has taken is
    // the number Finder shows.
    const used = os === "darwin" && r.mount === "/" ? r.total - r.free : r.used;
    const name = r.mount === "/" ? rootName ?? (os === "darwin" ? "Macintosh HD" : "/") : r.mount.slice(r.mount.lastIndexOf("/") + 1);
    // The sealed system volume mounts read-only; its container (the Data volume) is where the writes go, so the startup disk is not.
    const readOnly = os === "darwin" && r.mount === "/" ? false : info.readOnly;
    out.push({ mount: r.mount, name, device: r.device, fs: info.fs, total: r.total, used, free: r.free, readOnly });
  }
  return out;
}

// ---- levels ---------------------------------------------------------------

export type Level = "warn" | "crit" | undefined;
/** The colour a share earns, the popover's word for what the manifest's rules say on the strip: amber from `warn`, red from `crit`. */
export const levelOf = (value: number, warn: number, crit: number): Level => (value >= crit ? "crit" : value >= warn ? "warn" : undefined);
export const CPU = { warn: 70, crit: 90 };
export const MEMORY = { warn: 80, crit: 90 };
/** Percent used, and gigabytes free: a nearly full 4 TB disk still has room, a 128 GB one at 85% has 19 GB. */
export const DISK = { warn: 85, crit: 95, freeWarn: 20, freeCrit: 5 };
/** Load per core. */
export const LOAD = { warn: 1, crit: 2 };
export const diskLevel = (v: Volume): Level => {
  if (v.readOnly || !v.total) return undefined;
  const pct = (v.used / v.total) * 100, freeGb = v.free / 1024 ** 3;
  return pct >= DISK.crit || freeGb <= DISK.freeCrit ? "crit" : pct >= DISK.warn || freeGb <= DISK.freeWarn ? "warn" : undefined;
};

// ---- the sampler -----------------------------------------------------------

const TOOL_MS = 3000;
const sh = async (argv: string[]) => (Bun.which(argv[0]) ? (await exec(argv, { ms: TOOL_MS })).out : "");

/** The startup volume's name on macOS: `/Volumes` holds a symlink to `/` named after it. */
async function macRootName(): Promise<string | undefined> {
  try {
    for (const entry of await readdir("/Volumes")) if ((await readlink(`/Volumes/${entry}`).catch(() => "")) === "/") return entry;
  } catch {}
}

async function macMemoryNow(): Promise<Memory | undefined> {
  const [vm, sys] = await Promise.all([sh(["vm_stat"]), sh(["sysctl", "-n", "hw.memsize", "vm.swapusage", "kern.memorystatus_vm_pressure_level"])]);
  if (!vm) return;
  const [memsize, swap, pressure] = sys.split("\n");
  return macMemory(vm, { memsize: Number(memsize) || 0, swap: swap ?? "", pressure: Number(pressure) || 1 });
}

async function linuxMemoryNow(): Promise<Memory | undefined> {
  const [mi, psi] = await Promise.all([readFile("/proc/meminfo", "utf8").catch(() => ""), readFile("/proc/pressure/memory", "utf8").catch(() => "")]);
  return mi ? parseMeminfo(mi, psi) : undefined;
}

async function countersNow(addrs: boolean, last: Counters): Promise<Counters> {
  if (OS === "darwin") return parseNetstat(await sh(["netstat", "-ibn"]));
  const c = parseProcNetDev(await readFile("/proc/net/dev", "utf8").catch(() => ""));
  // The addresses are a second tool on Linux, asked for now and then; between asks the last known ride along.
  const known = addrs ? parseIpAddr(await sh(["ip", "-j", "-br", "addr"])) : Object.fromEntries(Object.entries(last).flatMap(([k, v]) => (v.addr ? [[k, v.addr]] : [])));
  for (const [k, v] of Object.entries(c)) if (known[k]) v.addr = known[k];
  return c;
}

async function volumesNow(): Promise<Volume[]> {
  if (OS === "darwin") {
    const [df, mount, root] = await Promise.all([sh(["df", "-kP"]), sh(["mount"]), macRootName()]);
    return volumes(parseDf(df), parseMacMount(mount), "darwin", root);
  }
  const [df, mounts] = await Promise.all([sh(["df", "-kP"]), readFile("/proc/mounts", "utf8").catch(() => "")]);
  return volumes(parseDf(df), parseProcMounts(mounts), "linux");
}

/** How often the slow sources are re-read, in seconds: volumes change rarely, the process table costs 20 ms. */
export const DISK_EVERY = 60, PROCS_EVERY = 10, ADDRS_EVERY = 30;

/**
 * Keeps the previous counters and answers one `Sample` per call: the CPU
 * and the rates are the change since the last call. `procs: true` takes
 * the process table this time (the popovers that rank processes ask for
 * it every tick while open; otherwise every `PROCS_EVERY` seconds), the
 * volumes and the Linux addresses refresh on their own clocks.
 */
export class Sampler {
  private cpu = cpuTimes();
  private counters: Counters = {};
  private at = 0;
  private volumesAt = 0;
  private volumes: Volume[] = [];
  private procsAt = 0;
  private addrsAt = 0;
  private lastProcs: Proc[] | undefined;

  async sample(o: { procs?: boolean } = {}): Promise<Sample> {
    const now = Date.now();
    const seconds = this.at ? (now - this.at) / 1000 : 0;
    const wantProcs = o.procs || now - this.procsAt >= PROCS_EVERY * 1000;
    const wantAddrs = now - this.addrsAt >= ADDRS_EVERY * 1000;
    const [memory, counters, vols, procs] = await Promise.all([
      OS === "darwin" ? macMemoryNow() : linuxMemoryNow(),
      countersNow(wantAddrs, this.counters),
      now - this.volumesAt >= DISK_EVERY * 1000 ? volumesNow() : undefined,
      wantProcs ? listProcesses().catch(() => undefined) : undefined,
    ]);
    const cpu = cpuTimes();
    const delta = cpuDelta(this.cpu, cpu);
    const ifaces = rates(this.counters, counters, seconds).filter((i) => !/^lo/.test(i.name) && (i.rx || i.tx));
    const totals = ifaces.filter((i) => counted(i.name));
    this.cpu = cpu;
    this.counters = counters;
    this.at = now;
    if (wantAddrs) this.addrsAt = now;
    if (vols) { this.volumes = vols; this.volumesAt = now; }
    if (procs) { this.lastProcs = procs; this.procsAt = now; }
    const [l1, l5, l15] = loadavg();
    return { at: now, cpu: delta, load: [l1, l5, l15], memory, net: { ifaces, down: totals.reduce((a, i) => a + i.down, 0), up: totals.reduce((a, i) => a + i.up, 0) }, uptime: uptime(), volumes: this.volumes, procs: procs ?? this.lastProcs };
  }
}

/** The last `HISTORY` values of each series, what the sparklines draw: 60 samples is three minutes at the default interval. */
export const HISTORY = 60;
export type Series = "cpu" | "memory" | "down" | "up" | "load";
export class History {
  private data: Record<Series, number[]> = { cpu: [], memory: [], down: [], up: [], load: [] };
  push(s: Sample) {
    const add = (k: Series, v: number) => { const a = this.data[k]; a.push(v); if (a.length > HISTORY) a.shift(); };
    add("cpu", s.cpu.total);
    if (s.memory?.total) add("memory", (s.memory.used / s.memory.total) * 100);
    add("down", s.net.down);
    add("up", s.net.up);
    add("load", s.load[0]);
  }
  get(k: Series): number[] { return this.data[k]; }
  get length(): number { return this.data.cpu.length; }
}
