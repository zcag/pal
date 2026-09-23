// System stats: five bar items (cpu, memory, disk, network, load) off one
// sampler, a palette of the same facts as rows, and `pal://stats/<item>`.
// The sampler ticks every `interval` seconds from the first render on
// (the core's own `every` floor is 10 s, a stat wants 3) and pushes every
// item with `bar.update`; the core diffs, so an unchanged strip costs
// nothing past the check. Each item states its facts (`stats/cpu`,
// `stats/memory_pressure`, `stats/disk_free`, `stats/net_down`, ...) and
// the manifest's rules hide it while quiet and colour it past the
// thresholds; the popovers are `view.ts`, the sources `sample.ts`.
import { bar, hint, now, settings, state, toast, truncate, view as liveView, when, wifi, type BarCtx, type BarItem, type Effect, type Extension, type Item, type LinkParams, type Metadata, type Proc, type View } from "@zcag/pal";
import { CPU, diskLevel, History, levelOf, LOAD, MEMORY, Sampler, shownIface, type IfaceRate, type Memory, type Sample, type Volume } from "./sample.ts";
import { colorOf, gb, INNER_W, load as loadText, MAC, memorySegments, pct, rate, rateShort, renderCpu, renderDisk, renderLoad, renderMemory, renderNetwork, sparkGlyphs, sparkline, topByCpu, topByMemory, uptimeText, type Iface, type SparkSeries, type Theme } from "./view.ts";

type Label = { cpu: "percent" | "spark" | "bars" | "top"; memory: "percent" | "used" | "free" | "spark"; disk: "percent" | "free" | "used"; network: "rate" | "down" | "spark"; load: "one" | "three" };
/** `[extensions.stats]`, defaults in pal.json. */
type Settings = { interval: number; disk_hide: string[] };

const EXTENSION = "stats";
export const ITEMS = ["cpu", "memory", "disk", "network", "load"] as const;
export type ItemId = (typeof ITEMS)[number];
const isItem = (s: string): s is ItemId => (ITEMS as readonly string[]).includes(s);
// md-chip, md-memory, md-harddisk, md-swap_vertical, md-speedometer, md-clock_outline, md-swap_horizontal
const GLYPH = { cpu: "\u{f061a}", memory: "\u{f035b}", disk: "\u{f02ca}", network: "\u{f04e2}", load: "\u{f04c5}", uptime: "\u{f0150}", swap: "\u{f04e1}", process: "\u{f035b}" };
const ACTIVITY_MONITOR = "/System/Applications/Utilities/Activity Monitor.app";
const MIN_INTERVAL = 1;
/** The first render needs two readings: this far apart, so the CPU share it answers is real. */
const FIRST_GAP_MS = 500;
/** Beyond this many cores the `bars` label is a wall; the rest is in the popover. */
const BARS_MAX = 32;
const WIFI_EVERY_MS = 30_000;

/** What the memory popover draws when `vm_stat` or `/proc/meminfo` answered nothing: the item is hidden, its popover can still be asked for by a key. */
const NO_MEMORY: Memory = { total: 0, used: 0, app: 0, wired: 0, compressed: 0, cached: 0, free: 0, pressure: "normal", swapTotal: 0, swapUsed: 0 };
const sampler = new Sampler();
const history = new History();
let last: Sample | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let started = false;
let theme: Theme;
/** Which popovers are up (a peek counts): while one is, `ps` runs every tick. */
const open = new Set<ItemId>();
/** The popovers' cursors, by the id of the focused row, so a re-render keeps it where it was. */
const focus: Partial<Record<ItemId, string>> = {};
let wifiInfo: { iface?: string; ssid?: string } = {};
let wifiAt = 0;

const cfg = () => settings.get<Settings>();
/** Each item's `label` setting (`[bar.items."stats/<id>".settings]`) as its last render got it: the loop's `bar.update` pushes have no ctx at hand. Seeded with the manifest's defaults for a push ahead of an item's first render. */
const labels: { [K in ItemId]: Label[K] } = { cpu: "percent", memory: "percent", disk: "free", network: "rate", load: "one" };
const interval = () => Math.max(MIN_INTERVAL, Number(cfg().interval) || 3);

// ---- the loop ---------------------------------------------------------------

/** One sample at a time: the sampler's deltas are against its last call, and five renders arrive together at load. */
let queue: Promise<unknown> = Promise.resolve();
function tick(o: { procs?: boolean } = {}): Promise<Sample> {
  const run = async () => {
    const s = await sampler.sample({ procs: o.procs || open.has("cpu") || open.has("memory") });
    history.push(s);
    last = s;
    if (Date.now() - wifiAt >= WIFI_EVERY_MS) {
      wifiAt = Date.now();
      wifiInfo = await wifi.status().then((w) => ({ iface: w?.interface ?? undefined, ssid: w?.current?.ssid ?? undefined })).catch(() => ({}));
    }
    return s;
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

/** The first look, for a render before the loop has ticked twice: two readings half a second apart, shared by whoever asks meanwhile. */
let ensuring: Promise<Sample> | undefined;
function ensure(): Promise<Sample> {
  if (last) return Promise.resolve(last);
  ensuring ??= (async () => {
    await tick({ procs: true });
    await new Promise((r) => setTimeout(r, FIRST_GAP_MS));
    return tick({ procs: true });
  })();
  return ensuring;
}

async function push() {
  const s = await tick();
  await Promise.all(ITEMS.map((id) => bar.update(id, itemOf(id, s), EXTENSION).catch(() => {})));
}

function follow() {
  clearInterval(timer);
  timer = setInterval(() => { push().catch(() => {}); }, interval() * 1000);
}

/** Hooked on the first render (the module is also imported by tests outside the host): the loop, the popover signals, the theme, the settings. */
function start() {
  if (started) return;
  started = true;
  follow();
  liveView.onShown((ev) => { if (ev.bar && isItem(ev.bar)) open.add(ev.bar); }, EXTENSION);
  liveView.onHidden((ev) => { if (ev.bar && isItem(ev.bar)) open.delete(ev.bar); }, EXTENSION);
  state.get("theme", EXTENSION).then((t) => { theme = t === "dark" || t === "light" ? t : undefined; }).catch(() => {});
  state.onChange("theme", (t) => { theme = t === "dark" || t === "light" ? t : undefined; });
  settings.onChange(follow, EXTENSION);
}

// ---- what each item knows ---------------------------------------------------

const roundTo = (n: number, places = 1) => Number(n.toFixed(places));
const topOf = (s: Sample): Proc | undefined => (s.procs ? topByCpu(s.procs)[0] : undefined);
/** The volume the strip speaks for: the startup disk, else the first not hidden by `disk_hide`. */
function shownVolumes(s: Sample): Volume[] {
  const hide = new Set((cfg().disk_hide ?? []).map(String));
  return s.volumes.filter((v) => !hide.has(v.mount) && !hide.has(v.name));
}
const mainVolume = (vols: Volume[]) => vols.find((v) => v.mount === "/") ?? vols[0];
/** What the network palette would say about an interface: the Wi-Fi one by its SSID, a tunnel as VPN. */
const ifaceView = (i: IfaceRate): Iface => ({ ...i, kind: i.name === wifiInfo.iface ? "Wi-Fi" : /^(utun|tun|tailscale|wg)/.test(i.name) ? "VPN" : /^bridge/.test(i.name) ? "Bridge" : undefined, ssid: i.name === wifiInfo.iface ? wifiInfo.ssid : undefined });
const base = () => ({ theme, interval: interval() });
const ifaces = (s: Sample) => s.net.ifaces.filter(shownIface).sort((a, b) => b.down + b.up - (a.down + a.up) || a.name.localeCompare(b.name)).map(ifaceView);

const focusIndex = (id: ItemId, ids: string[]) => Math.max(0, ids.indexOf(focus[id] ?? ""));

function popoverOf(id: ItemId, s: Sample): View {
  const procs = s.procs ?? [];
  switch (id) {
    case "cpu": return renderCpu({ ...base(), cpu: s.cpu, load: s.load, uptime: s.uptime, history: history.get("cpu"), procs, focus: focusIndex(id, topByCpu(procs).map((p) => String(p.pid))) });
    case "memory": return renderMemory({ ...base(), memory: s.memory ?? NO_MEMORY, history: history.get("memory"), procs, focus: focusIndex(id, topByMemory(procs).map((p) => String(p.pid))) });
    case "disk": { const vols = shownVolumes(s); return renderDisk({ ...base(), volumes: vols, focus: focusIndex(id, vols.map((v) => v.mount)) }); }
    case "network": { const list = ifaces(s); return renderNetwork({ ...base(), ifaces: list, down: s.net.down, up: s.net.up, downHistory: history.get("down"), upHistory: history.get("up"), focus: focusIndex(id, list.map((i) => i.name)) }); }
    case "load": return renderLoad({ ...base(), load: s.load, cores: s.cpu.cores.length, history: history.get("load"), uptime: s.uptime, focus: 0 });
  }
}

/** The rows a popover's cursor walks, in the order it draws them. */
function rowIds(id: ItemId, s: Sample): string[] {
  const procs = s.procs ?? [];
  switch (id) {
    case "cpu": return topByCpu(procs).map((p) => String(p.pid));
    case "memory": return topByMemory(procs).map((p) => String(p.pid));
    case "disk": return shownVolumes(s).map((v) => v.mount);
    case "network": return ifaces(s).map((i) => i.name);
    case "load": return [];
  }
}

function itemOf(id: ItemId, s: Sample): BarItem {
  const c = labels;
  const face = (item: Omit<BarItem, "empty" | "menu">, states: BarItem["states"]): BarItem => {
    const menu = { view: popoverOf(id, s) };
    return { ...item, menu, empty: { icon: item.icon, title: item.title, tooltip: item.tooltip, menu }, states };
  };
  switch (id) {
    case "cpu": {
      const top = topOf(s);
      const title = c.cpu === "spark" ? sparkGlyphs(history.get("cpu"), 100) : c.cpu === "bars" ? sparkGlyphs(s.cpu.cores.slice(0, BARS_MAX), 100, BARS_MAX) : c.cpu === "top" && top ? `${pct(s.cpu.total)} · ${truncate(top.name, 20)}` : pct(s.cpu.total);
      const tooltip = [`CPU ${pct(s.cpu.total)}`, `${s.cpu.cores.length} cores`, `load ${loadText(s.load[0])}`, top && `busiest ${top.name} ${top.cpu.toFixed(0)}%`].filter(Boolean).join(" · ");
      return face({ icon: GLYPH.cpu, title, tooltip }, { cpu: Math.round(s.cpu.total), cpu_top: top?.name ?? null, cores: s.cpu.cores.length });
    }
    case "memory": {
      const m = s.memory;
      if (!m?.total) return { hidden: true, states: { memory: null, memory_pressure: null, swap: null } };
      const share = (m.used / m.total) * 100;
      const title = c.memory === "used" ? gb(m.used) : c.memory === "free" ? `${gb(m.total - m.used)} free` : c.memory === "spark" ? sparkGlyphs(history.get("memory"), 100) : pct(share);
      const tooltip = [`Memory ${gb(m.used)} of ${gb(m.total)}`, `pressure ${m.pressure}`, m.swapTotal ? `swap ${gb(m.swapUsed)}` : undefined].filter(Boolean).join(" · ");
      return face({ icon: GLYPH.memory, title, tooltip }, { memory: Math.round(share), memory_pressure: m.pressure, swap: m.swapTotal ? Math.round((m.swapUsed / m.swapTotal) * 100) : 0 });
    }
    case "disk": {
      const vols = shownVolumes(s);
      const v = mainVolume(vols);
      if (!v) return { hidden: true, states: { disk: null, disk_free: null, disk_worst: null } };
      const share = (v.used / v.total) * 100;
      const title = c.disk === "free" ? gb(v.free) : c.disk === "used" ? gb(v.used) : pct(share);
      const more = vols.length - 1;
      const tooltip = [`${v.name}`, `${gb(v.used)} of ${gb(v.total)} used`, `${gb(v.free)} free`, more ? `${more} more ${more === 1 ? "volume" : "volumes"}` : undefined].filter(Boolean).join(" · ");
      const worst = Math.max(...vols.filter((x) => !x.readOnly && x.total).map((x) => (x.used / x.total) * 100), 0);
      return face({ icon: GLYPH.disk, title, tooltip }, { disk: Math.round(share), disk_free: roundTo(v.free / 1024 ** 3), disk_worst: Math.round(worst) });
    }
    case "network": {
      const title = c.network === "down" ? `↓${rateShort(s.net.down)}` : c.network === "spark" ? sparkGlyphs(history.get("down"), Math.max(...history.get("down"), 1)) : `↓${rateShort(s.net.down)} ↑${rateShort(s.net.up)}`;
      const busiest = ifaces(s)[0];
      const tooltip = [`↓ ${rate(s.net.down)} ↑ ${rate(s.net.up)}`, busiest && [busiest.name, busiest.kind, busiest.ssid, busiest.addr].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
      return face({ icon: GLYPH.network, title, tooltip }, { net_down: Math.round(s.net.down / 1024), net_up: Math.round(s.net.up / 1024) });
    }
    case "load": {
      const [l1, l5, l15] = s.load;
      const title = c.load === "three" ? `${loadText(l1)} ${loadText(l5)} ${loadText(l15)}` : loadText(l1);
      return face({ icon: GLYPH.load, title, tooltip: `Load ${loadText(l1)} ${loadText(l5)} ${loadText(l15)} · ${s.cpu.cores.length} cores` }, { load1: roundTo(l1, 2), load5: roundTo(l5, 2), load15: roundTo(l15, 2), cores: s.cpu.cores.length });
    }
  }
}

async function render(id: ItemId, ctx: BarCtx): Promise<BarItem> {
  const label = ctx.settings?.label;
  if (typeof label === "string") (labels as Record<ItemId, string>)[id] = label;
  start();
  const s = await ensure();
  return itemOf(id, s);
}

// ---- what a popover's keys do -------------------------------------------------

/** The value Enter copies from a popover or a row: the share, the usage, the path, the address. */
function valueOf(id: ItemId, s: Sample): string {
  switch (id) {
    case "cpu": return pct(s.cpu.total);
    case "memory": return s.memory ? `${gb(s.memory.used)} of ${gb(s.memory.total)} (${pct((s.memory.used / s.memory.total) * 100)})` : "";
    case "disk": return mainVolume(shownVolumes(s))?.mount ?? "";
    case "network": return `↓ ${rate(s.net.down)} ↑ ${rate(s.net.up)}`;
    case "load": return s.load.map(loadText).join(" ");
  }
}

const openMonitor = (): Effect => (MAC ? { open: ACTIVITY_MONITOR } : { push: { extension: "processes", palette: "processes" } });
const openPalette = (section?: ItemId): Effect => ({ push: { extension: EXTENSION, palette: "stats", ...(section && { args: { section } }) } });

function kill(pid: number, name: string): Effect | undefined {
  try { process.kill(pid, "SIGTERM"); } catch (e) { return toast(`Could not kill ${name}`, String((e as Error)?.message ?? e), "failure"); }
}

async function onAction(id: ItemId, action: string): Promise<Effect | void> {
  const s = last ?? (await ensure());
  const redraw = (): Effect => ({ view: popoverOf(id, s) });
  const ids = rowIds(id, s);
  const at = focusIndex(id, ids);
  if (action.startsWith("focus:")) { focus[id] = action.slice(6); return redraw(); }
  if (action === "down" || action === "up") {
    if (!ids.length) return { keep: true };
    focus[id] = ids[(at + (action === "down" ? 1 : ids.length - 1)) % ids.length];
    return redraw();
  }
  switch (action) {
    case "monitor": return openMonitor();
    case "processes": return { push: { extension: "processes", palette: "processes" } };
    case "palette": return openPalette(id);
    case "addresses": return { push: { extension: "network", palette: "network" } };
    case "reveal": { const v = shownVolumes(s)[at]; return v ? { open: v.mount } : { keep: true }; }
    case "copy": {
      if (id === "network") { const i = ifaces(s)[at]; return { copy: i?.addr ?? valueOf(id, s) }; }
      if (id === "disk") { const v = shownVolumes(s)[at]; return { copy: v?.mount ?? "" }; }
      return { copy: valueOf(id, s) };
    }
    case "kill": {
      const p = (id === "cpu" ? topByCpu(s.procs ?? []) : topByMemory(s.procs ?? []))[at];
      if (!p) return { keep: true };
      const failed = kill(p.pid, p.name);
      if (failed) return failed;
      // The table is read again after a beat so the row is seen to go.
      await new Promise((r) => setTimeout(r, 300));
      const next = await tick({ procs: true });
      return { keep: true, view: popoverOf(id, next) };
    }
  }
  return { keep: true };
}

// ---- the palette --------------------------------------------------------------

const SECTION = { cpu: "Processor", memory: "Memory", disk: "Disks", network: "Network", busiest: "Busiest processes", largest: "Largest processes", system: "System" };
/** What the last listing put behind each row: what Enter copies and the detail pane. */
const known = new Map<string, { value: string; detail: { markdown?: string; metadata: Metadata[] } }>();
const meta = (pairs: [string, string | undefined][]): Metadata[] => pairs.filter((p): p is [string, string] => !!p[1]).map(([label, value]) => ({ label, value }));
/** The sparkline as the detail pane's picture: the same SVG the popover draws, as a markdown image. */
const sparkMd = (series: SparkSeries[], o: { max?: number; floor?: number }) => `![](${sparkline(series, { width: INNER_W, height: 48, theme, ...o })})`;
const COPY = { id: "copy", title: "Copy" };
const MONITOR = MAC ? { id: "monitor", title: "Open Activity Monitor", shortcut: "cmd+o" } : { id: "processes", title: "Open Processes", shortcut: "cmd+o" };
const POPOVER = { id: "popover", title: "Open bar popover", shortcut: "cmd+p" };

function row(id: string, name: string, subtitle: string, icon: Item["icon"], section: string, value: string, detail: { markdown?: string; metadata: Metadata[] }, extra: Partial<Item> = {}): Item {
  known.set(id, { value, detail });
  return { id, name, subtitle, icon, section, actions: [COPY, MONITOR, POPOVER], ...extra };
}

function rows(s: Sample, only?: string): Item[] {
  const out: Item[] = [];
  const top = topOf(s);
  const [l1, l5, l15] = s.load;
  const cpuLevel = levelOf(s.cpu.total, CPU.warn, CPU.crit);
  out.push(row("cpu", pct(s.cpu.total), ["CPU", `${s.cpu.cores.length} cores`, top && `busiest ${top.name} ${top.cpu.toFixed(0)}%`].filter(Boolean).join(" · "), GLYPH.cpu, SECTION.cpu, pct(s.cpu.total), {
    markdown: sparkMd([{ values: history.get("cpu"), color: colorOf(cpuLevel) }], { max: 100 }),
    metadata: meta([["CPU", pct(s.cpu.total)], ["Cores", String(s.cpu.cores.length)], ["Per core", s.cpu.cores.map((c) => pct(c)).join(" ")], ["Load", `${loadText(l1)} ${loadText(l5)} ${loadText(l15)}`], ["Busiest", top && `${top.name} (${top.pid}) ${top.cpu.toFixed(1)}%`]]),
  }, { keywords: ["cpu", "processor", "usage"], accessories: cpuLevel ? [{ tag: cpuLevel === "crit" ? "critical" : "high", color: colorOf(cpuLevel) }] : [] }));
  const per = s.cpu.cores.length ? l1 / s.cpu.cores.length : 0;
  const loadLevel = levelOf(per, LOAD.warn, LOAD.crit);
  out.push(row("load", `${loadText(l1)} ${loadText(l5)} ${loadText(l15)}`, `Load average · 1, 5 and 15 min · ${per.toFixed(2)} per core`, GLYPH.load, SECTION.cpu, `${loadText(l1)} ${loadText(l5)} ${loadText(l15)}`, {
    markdown: sparkMd([{ values: history.get("load"), color: colorOf(loadLevel) }], { floor: Math.max(1, s.cpu.cores.length) }),
    metadata: meta([["1 min", loadText(l1)], ["5 min", loadText(l5)], ["15 min", loadText(l15)], ["Cores", String(s.cpu.cores.length)], ["Per core", per.toFixed(2)]]),
  }, { keywords: ["load", "average", "loadavg"], accessories: loadLevel ? [{ tag: loadLevel === "crit" ? "critical" : "high", color: colorOf(loadLevel) }] : [] }));
  const m = s.memory;
  if (m?.total) {
    const share = (m.used / m.total) * 100;
    const level = m.pressure === "critical" ? "crit" : m.pressure === "warn" ? "warn" : levelOf(share, MEMORY.warn, MEMORY.crit);
    const segs = memorySegments(m).map((x) => `${x.label} ${gb(x.value)}`).join(" · ");
    out.push(row("memory", `${gb(m.used)} used · ${pct(share)}`, `${segs} · pressure ${m.pressure}`, GLYPH.memory, SECTION.memory, `${gb(m.used)} of ${gb(m.total)} (${pct(share)})`, {
      markdown: sparkMd([{ values: history.get("memory"), color: colorOf(level) }], { max: 100 }),
      metadata: meta([["Used", `${gb(m.used)} of ${gb(m.total)}`], ...memorySegments(m).map((x): [string, string] => [x.label[0].toUpperCase() + x.label.slice(1), gb(x.value)]), ["Pressure", m.pressure]]),
    }, { keywords: ["memory", "ram", "pressure"], accessories: level ? [{ tag: level === "crit" ? "critical" : m.pressure !== "normal" ? m.pressure : "high", color: colorOf(level) }] : [] }));
    if (m.swapTotal) out.push(row("swap", `${gb(m.swapUsed)} of ${gb(m.swapTotal)}`, `Swap · ${pct((m.swapUsed / m.swapTotal) * 100)} used`, GLYPH.swap, SECTION.memory, `${gb(m.swapUsed)} of ${gb(m.swapTotal)}`, { metadata: meta([["Swap used", gb(m.swapUsed)], ["Swap total", gb(m.swapTotal)]]) }, { keywords: ["swap"] }));
  } else out.push(hint("memory:none", "Memory unavailable", MAC ? "vm_stat answered nothing" : "/proc/meminfo could not be read", { section: SECTION.memory, icon: GLYPH.memory }));
  const vols = shownVolumes(s);
  for (const v of vols) {
    const level = diskLevel(v);
    const share = v.total ? (v.used / v.total) * 100 : 0;
    out.push(row(`disk:${v.mount}`, `${gb(v.free)} free`, [v.name, `${gb(v.used)} of ${gb(v.total)} used`, v.readOnly ? "read-only" : undefined].filter(Boolean).join(" · "), GLYPH.disk, SECTION.disk, v.mount, {
      metadata: meta([["Volume", v.name], ["Mount", v.mount], ["Device", v.device], ["File system", v.fs], ["Used", `${gb(v.used)} (${pct(share)})`], ["Free", gb(v.free)], ["Total", gb(v.total)]]),
    }, { keywords: ["disk", "volume", "storage", "free", v.name], accessories: [...(level ? [{ tag: level === "crit" ? "nearly full" : "filling up", color: colorOf(level) }] : []), { text: pct(share) }], actions: [COPY, { id: "reveal", title: MAC ? "Reveal in Finder" : "Open in file manager", shortcut: "cmd+r" }, POPOVER] }));
  }
  if (!vols.length) out.push(hint("disk:none", "No volumes read", "df answered nothing", { section: SECTION.disk, icon: GLYPH.disk }));
  const list = ifaces(s);
  for (const i of list) {
    out.push(row(`if:${i.name}`, `↓ ${rate(i.down)} ↑ ${rate(i.up)}`, [i.name, i.kind, i.ssid, i.addr].filter(Boolean).join(" · "), GLYPH.network, SECTION.network, i.addr ?? `${i.name}`, {
      metadata: meta([["Interface", i.name], ["Kind", i.kind], ["SSID", i.ssid], ["IPv4", i.addr], ["Down", rate(i.down)], ["Up", rate(i.up)], ["Received", gb(i.rx)], ["Sent", gb(i.tx)]]),
    }, { keywords: ["network", "interface", "throughput", i.name, ...(i.ssid ? [i.ssid] : [])], actions: [{ id: "copy", title: "Copy address" }, { id: "addresses", title: "All addresses", shortcut: "cmd+a" }, POPOVER] }));
  }
  out.push(row("net", `↓ ${rate(s.net.down)} ↑ ${rate(s.net.up)}`, "All physical links", GLYPH.network, SECTION.network, `↓ ${rate(s.net.down)} ↑ ${rate(s.net.up)}`, {
    markdown: sparkMd([{ values: history.get("down"), color: "blue" }, { values: history.get("up"), color: "violet" }], { floor: 1024 }),
    metadata: meta([["Down", rate(s.net.down)], ["Up", rate(s.net.up)], ["Interfaces", list.map((i) => i.name).join(", ") || undefined]]),
  }, { keywords: ["network", "throughput", "bandwidth", "download", "upload"], actions: [COPY, { id: "addresses", title: "All addresses", shortcut: "cmd+a" }, POPOVER] }));
  const procs = s.procs ?? [];
  const procRow = (p: Proc, section: string, n: number): Item => row(`proc:${p.pid}:${section === SECTION.busiest ? "cpu" : "mem"}`, p.name, `${p.cpu.toFixed(1)}% cpu · ${gb(p.rss * 1024)} · pid ${p.pid}`, MAC && p.comm.includes(".app/Contents/MacOS/") ? { app: p.comm.slice(0, p.comm.indexOf(".app/") + 4) } : GLYPH.process, section, String(p.pid), {
    metadata: meta([["Command", p.comm], ["PID", String(p.pid)], ["CPU", `${p.cpu.toFixed(1)}%`], ["Memory", gb(p.rss * 1024)]]),
  }, { keywords: [String(p.pid), "process"], accessories: [{ text: `#${n + 1}` }], actions: [{ id: "copy", title: "Copy PID" }, { id: "kill", title: "Kill", shortcut: "cmd+backspace", style: "destructive", confirm: `Send SIGTERM to ${p.name} (${p.pid})?` }, MONITOR, POPOVER] });
  topByCpu(procs).forEach((p, n) => out.push(procRow(p, SECTION.busiest, n)));
  topByMemory(procs).forEach((p, n) => out.push(procRow(p, SECTION.largest, n)));
  out.push(row("uptime", uptimeText(s.uptime), `Uptime · since ${when(now() - s.uptime * 1000)}`, GLYPH.uptime, SECTION.system, uptimeText(s.uptime), { metadata: meta([["Uptime", uptimeText(s.uptime)], ["Seconds", String(Math.round(s.uptime))]]) }, { keywords: ["uptime", "since", "boot"], actions: [COPY] }));
  if (!only) return out;
  const want: Record<string, string[]> = { cpu: [SECTION.cpu, SECTION.busiest], memory: [SECTION.memory, SECTION.largest], disk: [SECTION.disk], network: [SECTION.network], load: [SECTION.cpu] };
  const sections = want[only];
  return sections ? out.filter((r) => sections.includes(String(r.section))) : out;
}

const itemOfRow = (id: string): ItemId => (id.startsWith("disk:") ? "disk" : id.startsWith("if:") || id === "net" ? "network" : id.startsWith("proc:") && id.endsWith(":mem") ? "memory" : id === "memory" || id === "swap" ? "memory" : id === "load" ? "load" : "cpu");

export default {
  palettes: {
    stats: {
      title: "Stats",
      live: true,
      showDetail: true,
      placeholder: "cpu, memory, a volume, an interface, a process",
      list: async (_query, ctx) => {
        start();
        const s = ctx?.refresh || !last ? await (last ? tick({ procs: true }) : ensure()) : last;
        known.clear();
        const only = (ctx?.args as { section?: string } | undefined)?.section;
        return rows(s, only);
      },
      pick: async (id, action) => {
        const s = last ?? (await ensure());
        if (action === "monitor") return openMonitor();
        if (action === "processes") return { push: { extension: "processes", palette: "processes" } };
        if (action === "addresses") return { push: { extension: "network", palette: "network" } };
        if (action === "popover") return { open: `pal://bar/${EXTENSION}/${itemOfRow(id)}` };
        if (action === "reveal") { const v = known.get(id)?.value; return v ? { open: v } : { keep: true }; }
        if (action === "kill") {
          const pid = Number(id.split(":")[1]);
          const p = s.procs?.find((x) => x.pid === pid);
          const failed = kill(pid, p?.name ?? String(pid));
          if (failed) return failed;
          await new Promise((r) => setTimeout(r, 300));
          await tick({ procs: true });
          return { keep: true };
        }
        if (!known.has(id)) rows(s);
        const value = known.get(id)?.value;
        return value ? { copy: value } : { keep: true };
      },
      detail: async (id) => {
        if (!known.has(id)) rows(last ?? (await ensure()));
        return known.get(id)?.detail;
      },
    },
  },
  bar: {
    cpu: { render: (ctx) => render("cpu", ctx), onAction: (a) => onAction("cpu", a) },
    memory: { render: (ctx) => render("memory", ctx), onAction: (a) => onAction("memory", a) },
    disk: { render: (ctx) => render("disk", ctx), onAction: (a) => onAction("disk", a) },
    network: { render: (ctx) => render("network", ctx), onAction: (a) => onAction("network", a) },
    load: { render: (ctx) => render("load", ctx), onAction: (a) => onAction("load", a) },
  },
  link: (route: string, params: LinkParams) => {
    if (!isItem(route)) throw new Error(`no stats route "${route}"`);
    return params.palette ? openPalette(route) : { open: `pal://bar/${EXTENSION}/${route}` };
  },
  dispose: () => { clearInterval(timer); timer = undefined; },
} satisfies Extension;
