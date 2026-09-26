// The five popovers as render trees, pure: index.ts samples, this draws
// the state it is handed (the tests hand it fixtures). Each opens on the
// headline number, then a sparkline of the last minutes (an SVG data url,
// its ink picked for the theme), then the breakdown: cores, the memory
// segments, the volumes, the interfaces, the top processes. Rows the keys
// act on carry the accent ring and a click moves it (`focus:<id>`).
import { bytes, column, ink, keyHint, POPOVER_W, row, sparkline, text, type Action, type SparkSeries, type Theme, type Proc, type TagColor, type View, type ViewNode } from "@zcag/pal";
import { diskLevel, levelOf, CPU, LOAD, MEMORY, type Cpu, type IfaceRate, type Level, type Memory, type Volume } from "./sample.ts";

/** What every popover shares: the theme for the sparkline's ink, the sampling interval for its caption, the row the keys are on. */
type Base = { theme?: Theme; interval: number; focus: number };
export type CpuPopover = Base & { cpu: Cpu; load: [number, number, number]; uptime: number; history: number[]; procs: Proc[] };
export type MemoryPopover = Base & { memory: Memory; history: number[]; procs: Proc[] };
export type DiskPopover = Base & { volumes: Volume[] };
/** An interface with what the network palette knows about it: the kind (Wi-Fi, Ethernet) and the SSID. */
export type Iface = IfaceRate & { kind?: string; ssid?: string };
export type NetworkPopover = Base & { ifaces: Iface[]; down: number; up: number; downHistory: number[]; upHistory: number[] };
export type LoadPopover = Base & { load: [number, number, number]; cores: number; history: number[]; uptime: number };

/** The outer column's `padding: 3` is 12 px a side; a focusable row's own `padding: 1` is 4. */
const OUTER_PAD = 12, GAP = 4;
export const INNER_W = POPOVER_W - 2 * OUTER_PAD;
const SPARK_H = 44;
export const TOP_N = 5;
export const MAC = process.platform === "darwin";

export const colorOf = (level: Level): TagColor => (level === "crit" ? "red" : level === "warn" ? "amber" : "blue");
const levelBadge = (level: Level, quiet = "fine"): ViewNode => ({ type: "badge", key: "level", text: level === "crit" ? "critical" : level === "warn" ? "high" : quiet, color: level ? colorOf(level) : "green" });

// ---- text ------------------------------------------------------------------

export const pct = (n: number) => `${Math.round(n)}%`;
/** `1.2 MB/s`, `80 KB/s`, `0 B/s`. */
export const rate = (n: number) => `${bytes(Math.round(n))}/s`;
/** The strip's form: `1.2M`, `80K`, `0`. */
export const rateShort = (n: number) => (n < 1024 ? `${Math.round(n)}` : n < 1024 ** 2 ? `${Math.round(n / 1024)}K` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)}M` : `${(n / 1024 ** 3).toFixed(1)}G`);
/** `24.2 GB`, `1.5 TB`: one decimal, what a memory or a disk figure reads as. */
export const gb = (n: number) => (n >= 1024 ** 4 ? `${(n / 1024 ** 4).toFixed(1)} TB` : n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : bytes(n));
export const load = (l: number) => l.toFixed(2).replace(/0$/, "");
/** `26 d 4 h`, `4 h 12 m`, `12 m`. */
export const uptimeText = (seconds: number) => {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} m` : `${m} m`;
};
/** `▂▃▅▇▆`: the last `n` values of a series against `max`, for a strip label. */
export const sparkGlyphs = (values: number[], max: number, n = 8): string => {
  const BLOCKS = "▁▂▃▄▅▆▇█";
  const top = max > 0 ? max : 1;
  return values.slice(-n).map((v) => BLOCKS[Math.min(7, Math.max(0, Math.round((v / top) * 7)))]).join("");
};

// ---- the sparkline ---------------------------------------------------------

export { ink, sparkline, type SparkSeries, type Theme };

const spark = (series: SparkSeries[], st: Base, o: { max?: number; floor?: number; caption: string }): ViewNode[] => {
  const span = Math.max(...series.map((s) => s.values.length)) * st.interval;
  return [
    { type: "image", key: "spark", src: sparkline(series, { width: INNER_W, height: SPARK_H, theme: st.theme, max: o.max, floor: o.floor }), width: INNER_W, height: SPARK_H },
    row([text(o.caption, { style: "muted", size: "xs" }), { type: "spacer" }, text(`last ${span >= 90 ? `${Math.round(span / 60)} min` : `${span} s`}, every ${st.interval} s`, { style: "muted", size: "xs" })], { key: "spark-caption", gap: 1, minHeight: 16 }),
  ];
};

// ---- pieces ----------------------------------------------------------------

const head = (key: string, big: string, label: string, badge: ViewNode, sub?: string): ViewNode[] => [
  row([text(big, { key: "big", style: "title", size: "xl" }), text(label, { key: "label", style: "body", weight: "semibold" }), { type: "spacer" }, badge], { key: `${key}-head`, gap: 2 }),
  ...(sub ? [text(sub, { key: `${key}-sub`, style: "muted", size: "sm" })] : []),
];
const section = (key: string, title: string, extra?: ViewNode): ViewNode => row([text(title, { size: "xs", weight: "semibold", color: "muted" }), ...(extra ? [{ type: "spacer" as const }, extra] : [])], { key: `h-${key}`, gap: 1, minHeight: 20 });
const hints = (pairs: [string | string[], string, string?][]): ViewNode => row(pairs.flatMap(([k, what, action]) => keyHint(k, what, { action })), { key: "hints", gap: 1, minHeight: 22 });
const focusable = (key: string, children: ViewNode[], focused: boolean, action: string): ViewNode => row(children, { key, padding: 1, minHeight: 26, radius: true, action, ...(focused && { selected: true }), transition: { enter: "fade", exit: "fade" } });

/** A process row: the name takes what the two number columns leave. */
const procRow = (p: Proc, focused: boolean): ViewNode =>
  focusable(`p-${p.pid}`, [
    column([text(p.name, { size: "sm", weight: focused ? "semibold" : "medium", minWidth: 0 })], { key: "n", gap: 0, grow: true }),
    text(`${p.cpu.toFixed(1)}%`, { style: "mono", size: "xs", color: p.cpu >= 50 ? "red" : p.cpu >= 10 ? "amber" : "muted", width: 52, align: "end" }),
    text(bytes(p.rss * 1024), { style: "mono", size: "xs", color: "muted", width: 64, align: "end" }),
  ], focused, `focus:${p.pid}`);

const procSection = (rows: ViewNode[], title: string) => (rows.length ? [section("procs", title, text("cpu · memory", { style: "muted", size: "xs" })), ...rows] : []);
const moveActions = (rows: string[], what: string): Action[] => [
  { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
  { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
  ...rows.map((id): Action => ({ id: `focus:${id}`, title: `Focus ${what} ${id}`, hidden: true })),
];
const paletteActions: Action[] = [{ id: "palette", title: "Open Stats palette", shortcut: "s" }];
/** Activity Monitor on macOS; the Processes palette is the nearest thing on Linux. */
// Enter opens Activity Monitor on macOS and the Processes palette elsewhere, where `p` then has nothing of its own to open.
const monitorAction: Action = MAC ? { id: "monitor", title: "Open Activity Monitor", shortcut: "enter" } : { id: "processes", title: "Open Processes", shortcut: ["enter", "p"] };
const processesAction: Action[] = MAC ? [{ id: "processes", title: "Open Processes palette", shortcut: "p" }] : [];
const MONITOR_HINT = MAC ? "monitor" : "processes";
const killAction = (p: Proc | undefined): Action[] => (p ? [{ id: "kill", title: `Kill ${p.name}`, shortcut: "x", style: "destructive", confirm: `Send SIGTERM to ${p.name} (${p.pid})?` }] : []);

// ---- cpu -------------------------------------------------------------------

export const topByCpu = (procs: Proc[]) => [...procs].sort((a, b) => b.cpu - a.cpu || b.rss - a.rss).slice(0, TOP_N);
export const topByMemory = (procs: Proc[]) => [...procs].sort((a, b) => b.rss - a.rss || b.cpu - a.cpu).slice(0, TOP_N);
const clamp = (focus: number, n: number) => Math.min(Math.max(0, focus), Math.max(0, n - 1));

function coreGrid(cores: number[]): ViewNode[] {
  const COL_W = (INNER_W - 2 * GAP) / 2, LABEL_W = 24, VAL_W = 34;
  const BAR_W = Math.floor(COL_W - LABEL_W - VAL_W - 2 * GAP);
  const cell = (i: number): ViewNode => row([
    text(String(i), { style: "mono", size: "xs", color: "faint", width: LABEL_W }),
    { type: "progress", value: cores[i] / 100, width: BAR_W, color: colorOf(levelOf(cores[i], CPU.warn, CPU.crit)) },
    text(pct(cores[i]), { style: "mono", size: "xs", color: "muted", width: VAL_W, align: "end" }),
  ], { key: `core-${i}`, gap: 1 });
  const rows: ViewNode[] = [];
  const half = Math.ceil(cores.length / 2);
  for (let r = 0; r < half; r++) {
    const right = r + half < cores.length ? [cell(r + half)] : [{ type: "spacer" as const }];
    rows.push(row([cell(r), ...right], { key: `cores-${r}`, gap: 2, minHeight: 16 }));
  }
  return rows;
}

export function renderCpu(st: CpuPopover): View {
  const level = levelOf(st.cpu.total, CPU.warn, CPU.crit);
  const top = topByCpu(st.procs);
  const focus = clamp(st.focus, top.length);
  const focused = top[focus];
  const [l1, l5, l15] = st.load;
  return {
    title: `CPU ${pct(st.cpu.total)}`, id: "cpu", keys: "actions",
    actions: [monitorAction, ...killAction(focused), { id: "copy", title: "Copy share", shortcut: ["c", "cmd+c"] }, ...processesAction, ...paletteActions, ...moveActions(top.map((p) => String(p.pid)), "process")],
    tree: column([
      ...head("cpu", pct(st.cpu.total), "CPU", levelBadge(level), `${st.cpu.cores.length} cores · load ${load(l1)} ${load(l5)} ${load(l15)} · up ${uptimeText(st.uptime)}`),
      ...spark([{ values: st.history, color: colorOf(level) }], st, { max: 100, caption: "cpu, whole machine" }),
      section("cores", "Per core"),
      ...coreGrid(st.cpu.cores),
      ...procSection(top.map((p, i) => procRow(p, i === focus)), "Busiest processes"),
      { type: "divider", key: "rule" },
      hints([["enter", MONITOR_HINT, MONITOR_HINT], ["x", "kill", "kill"], ["c", "copy", "copy"], ["s", "stats", "palette"], [["up", "down"], "move"]]),
    ], { key: "cpu", padding: 3, gap: 2 }),
  };
}

// ---- memory ----------------------------------------------------------------

/** The segments of the breakdown bar, in Activity Monitor's order and colours: app, wired, compressed, cached, free. */
export const memorySegments = (m: Memory): { key: string; label: string; value: number; color: TagColor }[] => [
  { key: "app", label: "app", value: m.app, color: "blue" },
  { key: "wired", label: MAC ? "wired" : "shared", value: m.wired, color: "violet" },
  ...(m.compressed ? [{ key: "compressed", label: "compressed", value: m.compressed, color: "amber" as TagColor }] : []),
  { key: "cached", label: "cached", value: m.cached, color: "grey" },
  { key: "free", label: "free", value: Math.max(0, m.total - m.app - m.wired - m.compressed - m.cached), color: "teal" },
];

function memoryBar(m: Memory): ViewNode[] {
  const segs = memorySegments(m).filter((s) => s.value > 0);
  const W = INNER_W - (segs.length - 1) * GAP;
  const tiles: ViewNode[] = segs.map((s) => ({ type: "tile", key: `seg-${s.key}`, width: Math.max(3, Math.round((s.value / m.total) * W)), height: 10, color: s.color, fill: s.key === "free" ? "outline" : "solid" }));
  const legend: ViewNode[] = segs.map((s) => row([{ type: "tile", key: `dot-${s.key}`, width: 8, height: 8, color: s.color, fill: s.key === "free" ? "outline" : "solid" }, text(`${s.label} ${gb(s.value)}`, { style: "muted", size: "xs" })], { key: `leg-${s.key}`, gap: 1 }));
  return [row(tiles, { key: "segments", gap: 1, minHeight: 10 }), row(legend, { key: "legend", gap: 2, minHeight: 16 })];
}

export function renderMemory(st: MemoryPopover): View {
  const m = st.memory;
  const share = m.total ? (m.used / m.total) * 100 : 0;
  const level: Level = m.pressure === "critical" ? "crit" : m.pressure === "warn" ? "warn" : levelOf(share, MEMORY.warn, MEMORY.crit);
  const top = topByMemory(st.procs);
  const focus = clamp(st.focus, top.length);
  const focused = top[focus];
  const swap = m.swapTotal ? ` · swap ${gb(m.swapUsed)} of ${gb(m.swapTotal)}` : "";
  return {
    title: `Memory ${pct(share)}`, id: "memory", keys: "actions",
    actions: [monitorAction, ...killAction(focused), { id: "copy", title: "Copy usage", shortcut: ["c", "cmd+c"] }, ...processesAction, ...paletteActions, ...moveActions(top.map((p) => String(p.pid)), "process")],
    tree: column([
      ...head("memory", pct(share), "Memory", levelBadge(level, m.pressure === "normal" ? "normal" : m.pressure), `${gb(m.used)} of ${gb(m.total)} used${swap}`),
      ...memoryBar(m),
      ...spark([{ values: st.history, color: colorOf(level) }], st, { max: 100, caption: "memory used" }),
      ...procSection(top.map((p, i) => procRow(p, i === focus)), "Largest processes"),
      { type: "divider", key: "rule" },
      hints([["enter", MONITOR_HINT, MONITOR_HINT], ["x", "kill", "kill"], ["c", "copy", "copy"], ["s", "stats", "palette"], [["up", "down"], "move"]]),
    ], { key: "memory", padding: 3, gap: 2 }),
  };
}

// ---- disk ------------------------------------------------------------------

export function renderDisk(st: DiskPopover): View {
  const vols = st.volumes;
  const focus = clamp(st.focus, vols.length);
  const worst = vols.map(diskLevel).reduce<Level>((a, b) => (b === "crit" || a === "crit" ? "crit" : b ?? a), undefined);
  const cards = vols.map((v, i) => {
    const level = diskLevel(v);
    const share = v.total ? v.used / v.total : 0;
    return focusable(`vol-${v.mount}`, [
      column([
        row([text(v.name, { size: "sm", weight: i === focus ? "semibold" : "medium", minWidth: 0 }), ...(v.readOnly ? [{ type: "badge" as const, key: "ro", text: "read-only", color: "grey" as TagColor }] : []), { type: "spacer" }, text(`${gb(v.free)} free`, { style: "mono", size: "xs", color: level ? colorOf(level) : "muted" })], { key: "t", gap: 1, minHeight: 18 }),
        { type: "progress", key: "bar", value: share, color: colorOf(level) },
        row([text(v.mount, { style: "mono", size: "xs", color: "faint", minWidth: 0 }), { type: "spacer" }, text(`${gb(v.used)} of ${gb(v.total)}`, { style: "muted", size: "xs" })], { key: "m", gap: 1, minHeight: 16 }),
      ], { key: "c", gap: 1, grow: true }),
    ], i === focus, `focus:${v.mount}`);
  });
  return {
    title: vols.length === 1 ? `${vols[0].name} ${pct(vols[0].total ? (vols[0].used / vols[0].total) * 100 : 0)}` : `${vols.length} volumes`, id: "disk", keys: "actions",
    actions: [{ id: "reveal", title: MAC ? "Reveal in Finder" : "Open in file manager", shortcut: "enter" }, { id: "copy", title: "Copy path", shortcut: ["c", "cmd+c"] }, ...paletteActions, ...moveActions(vols.map((v) => v.mount), "volume")],
    tree: column([
      ...head("disk", vols.length ? `${gb(vols[focus].free)}` : "–", vols.length ? `free on ${vols[focus].name}` : "Disks", levelBadge(worst, "room")),
      ...(cards.length ? cards : [text("No volumes read", { key: "empty", style: "muted", size: "sm" })]),
      { type: "divider", key: "rule" },
      hints([["enter", MAC ? "reveal" : "open", "reveal"], ["c", "copy path", "copy"], ["s", "stats", "palette"], [["up", "down"], "move"]]),
    ], { key: "disk", padding: 3, gap: 2 }),
  };
}

// ---- network ---------------------------------------------------------------

export function renderNetwork(st: NetworkPopover): View {
  const ifaces = st.ifaces;
  const focus = clamp(st.focus, ifaces.length);
  const rows = ifaces.map((i, n) => focusable(`if-${i.name}`, [
    column([
      text([i.name, i.kind, i.ssid].filter(Boolean).join(" · "), { size: "sm", weight: n === focus ? "semibold" : "medium", minWidth: 0 }),
      text(i.addr ?? "no address", { style: "mono", size: "xs", color: "faint", minWidth: 0 }),
    ], { key: "t", gap: 0, grow: true }),
    text(`↓ ${rate(i.down)}`, { style: "mono", size: "xs", color: i.down ? "blue" : "faint", width: 92, align: "end" }),
    text(`↑ ${rate(i.up)}`, { style: "mono", size: "xs", color: i.up ? "violet" : "faint", width: 92, align: "end" }),
  ], n === focus, `focus:${i.name}`));
  const peak = Math.max(1024, ...st.downHistory, ...st.upHistory);
  return {
    title: `Network ↓ ${rate(st.down)} ↑ ${rate(st.up)}`, id: "network", keys: "actions",
    actions: [{ id: "addresses", title: "All addresses", shortcut: "enter" }, { id: "copy", title: "Copy address", shortcut: ["c", "cmd+c"] }, ...paletteActions, ...moveActions(ifaces.map((i) => i.name), "interface")],
    tree: column([
      row([
        column([text(rate(st.down), { key: "down", style: "title", size: "lg", color: "blue" }), text("down", { style: "muted", size: "xs" })], { key: "d", gap: 0 }),
        column([text(rate(st.up), { key: "up", style: "title", size: "lg", color: "violet" }), text("up", { style: "muted", size: "xs" })], { key: "u", gap: 0 }),
        { type: "spacer" },
        { type: "badge", key: "level", text: st.down + st.up >= 10 * 1024 ** 2 ? "busy" : st.down + st.up >= 1024 ? "active" : "quiet", color: st.down + st.up >= 10 * 1024 ** 2 ? "blue" : "grey" },
      ], { key: "net-head", gap: 4 }),
      ...spark([{ values: st.downHistory, color: "blue" }, { values: st.upHistory, color: "violet" }], st, { floor: peak, caption: `down and up, peak ${rate(peak)}` }),
      section("ifaces", "Interfaces"),
      ...(rows.length ? rows : [text("No interface has moved a byte", { key: "empty", style: "muted", size: "sm" })]),
      { type: "divider", key: "rule" },
      hints([["enter", "addresses", "addresses"], ["c", "copy ip", "copy"], ["s", "stats", "palette"], [["up", "down"], "move"]]),
    ], { key: "network", padding: 3, gap: 2 }),
  };
}

// ---- load ------------------------------------------------------------------

export function renderLoad(st: LoadPopover): View {
  const [l1, l5, l15] = st.load;
  const per = st.cores ? l1 / st.cores : 0;
  const level = levelOf(per, LOAD.warn, LOAD.crit);
  const tile = (key: string, value: number, sub: string): ViewNode => ({ type: "tile", key, width: Math.floor((INNER_W - 2 * 8) / 3), height: 52, text: load(value), sub, color: levelOf(st.cores ? value / st.cores : 0, LOAD.warn, LOAD.crit) ? colorOf(levelOf(st.cores ? value / st.cores : 0, LOAD.warn, LOAD.crit)) : "neutral" });
  return {
    title: `Load ${load(l1)}`, id: "load", keys: "actions",
    actions: [monitorAction, { id: "copy", title: "Copy load averages", shortcut: ["c", "cmd+c"] }, ...paletteActions],
    tree: column([
      ...head("load", load(l1), "Load", levelBadge(level, "fine"), `${st.cores} cores · ${per.toFixed(2)} per core · up ${uptimeText(st.uptime)}`),
      row([tile("l1", l1, "1 min"), tile("l5", l5, "5 min"), tile("l15", l15, "15 min")], { key: "tiles", gap: 2 }),
      ...spark([{ values: st.history, color: colorOf(level) }], st, { floor: Math.max(1, st.cores), caption: `1 min load, ${st.cores} cores is full` }),
      { type: "divider", key: "rule" },
      hints([["enter", MONITOR_HINT, MONITOR_HINT], ["c", "copy", "copy"], ["s", "stats", "palette"]]),
    ], { key: "load", padding: 3, gap: 2 }),
  };
}
