// Writes app/src/gallery/shots/stats.json and bar-stats.json, the store
// screenshots' fixtures: the palette's rows, their detail panes and the CPU
// popover built by index.ts's own builders (`rows`, `itemOf`, `popoverOf`)
// over a made-up machine at the fixed clock: 12 cores and 36 GB mid-build
// (two rustc at the top), three volumes, Wi-Fi and a VPN, three minutes of
// seeded history. Nothing is read from this machine.
// `bun run extensions/stats/fixture.ts`, then `make shots EXT=stats`.
import { readFileSync } from "node:fs";
import type { Proc } from "@zcag/pal";
import { pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { Sample } from "./sample.ts";

pinClock();
// After the pin: the SDK's clock reads PAL_NOW when it loads (the uptime row's "since").
const { default: ext, detailOf, itemOf, rows } = await import("./index.ts");
const { History, HISTORY } = await import("./sample.ts");

const GB = 1024 ** 3, MB = 1024 ** 2, KB = 1024;
const rand = seeded(7);
const jitter = (v: number, by: number) => v + (rand() - 0.5) * 2 * by;

/** A process as `ps` reports it: rss in KB. */
const proc = (pid: number, comm: string, cpu: number, rssGb: number): Proc => ({ pid, ppid: 1, uid: 501, cpu, rss: Math.round((rssGb * GB) / 1024), comm, name: comm.slice(comm.lastIndexOf("/") + 1) });
const BUILD = [
  proc(51822, "/Users/dev/.rustup/toolchains/stable/bin/rustc", 402.3, 1.4),
  proc(51840, "/Users/dev/.rustup/toolchains/stable/bin/rustc", 188.6, 0.9),
  proc(48210, "/usr/local/bin/node", 64.2, 0.8),
  proc(412, "/System/Library/PrivateFrameworks/SkyLight.framework/Resources/WindowServer", 21.4, 0.6),
  proc(3318, "/usr/local/bin/rust-analyzer", 12.7, 1.9),
  proc(2204, "/opt/vm/bin/qemu-system-aarch64", 6.1, 6.2),
  proc(1987, "/System/Library/Frameworks/WebKit.framework/Versions/A/XPCServices/WebContent", 3.8, 2.4),
  proc(733, "/usr/local/bin/kitty", 2.2, 0.3),
];
const EXPORT = [proc(60114, "/usr/local/bin/ffmpeg", 1104.5, 1.1), ...BUILD.slice(2)];

/** Twelve cores around `total`, the busy ones first as the scheduler fills them. */
const coresAround = (total: number) => Array.from({ length: 12 }, (_, i) => Math.max(2, Math.min(100, jitter(total + (i < 6 ? 12 : -12), 9))));
const sample = (total: number, procs: Proc[], load: [number, number, number]): Sample => {
  const cores = coresAround(total);
  return {
    at: 0,
    cpu: { total: cores.reduce((a, b) => a + b, 0) / cores.length, cores },
    load,
    memory: { total: 36 * GB, used: 26.1 * GB, app: 17.8 * GB, wired: 3.9 * GB, compressed: 4.4 * GB, cached: 7.2 * GB, free: 2.7 * GB, pressure: "normal", swapTotal: 2 * GB, swapUsed: 0.6 * GB },
    net: {
      ifaces: [
        { name: "en0", down: 2.4 * MB, up: 310 * KB, rx: 48.2 * GB, tx: 6.1 * GB, addr: "192.168.1.24" },
        { name: "utun3", down: 184 * KB, up: 22 * KB, rx: 3.4 * GB, tx: 0.7 * GB, addr: "100.87.12.40" },
      ],
      down: 2.4 * MB,
      up: 310 * KB,
    },
    uptime: 6 * 86400 + 3 * 3600 + 17 * 60,
    volumes: [
      { mount: "/", name: "Macintosh HD", device: "/dev/disk3s1s1", fs: "apfs", total: 994.7 * GB, used: 612.4 * GB, free: 382.3 * GB, readOnly: false },
      { mount: "/Volumes/Archive", name: "Archive", device: "/dev/disk6s2", fs: "apfs", total: 1862.9 * GB, used: 1288.1 * GB, free: 574.8 * GB, readOnly: false },
      { mount: "/Volumes/Installer", name: "Installer", device: "/dev/disk8s1", fs: "hfs", total: 1.2 * GB, used: 1.1 * GB, free: 0.1 * GB, readOnly: true },
    ],
    procs,
  };
};

/** Three minutes at 3 s: a quiet machine until a build starts a minute and a half ago, or an export pinning it. */
function history(peak: number, from: number) {
  const h = new History();
  for (let i = 0; i < HISTORY; i++) {
    const on = i >= from, ramp = Math.min(1, (i - from) / 6);
    const cpu = on ? jitter(22 + (peak - 22) * ramp, 5) : jitter(18, 6);
    const down = (rand() < 0.3 ? jitter(3.2, 1.5) : jitter(0.6, 0.5)) * MB;
    h.push({ at: 0, cpu: { total: Math.max(3, Math.min(100, cpu)), cores: [] }, load: [on ? 3 + 8.8 * ramp : jitter(2.6, 0.4), 0, 0], memory: { total: 100, used: on ? 70 + 2 * ramp : jitter(68, 0.6) } as Sample["memory"], net: { ifaces: [], down: Math.max(0, down), up: Math.max(0, down / 7) }, uptime: 0, volumes: [] });
  }
  return h;
}

const ctx = (h: InstanceType<typeof History>, cpu: "percent" | "spark" | "top" = "percent") => ({ history: h, theme: undefined, interval: 3, labels: { cpu, memory: "percent", disk: "free", network: "rate", load: "one" } as const, hide: [], wifi: { iface: "en0", ssid: "Harbor 5G" }, focus: {} });
const busy = sample(78, BUILD, [11.8, 9.4, 6.2]);
const busyHistory = history(80, 30);
const pinned = sample(99, EXPORT, [21.6, 14.2, 8.1]);
const pinnedHistory = history(97, 44);
/** The sparkline label wants the climb in its last eight samples: the build caught as it starts. */
const startHistory = history(80, HISTORY - 7);

// ---- the palette ---------------------------------------------------------------

const manifest = JSON.parse(readFileSync(new URL("./pal.json", import.meta.url), "utf8"));
const p = ext.palettes.stats;
const items = rows(busy, undefined, ctx(busyHistory));
writeFixture("stats", {
  palettes: {
    stats: { title: p.title, icon: manifest.icon, live: true, showDetail: p.showDetail, placeholder: p.placeholder, items, details: Object.fromEntries(items.map((i) => [i.id, detailOf(i.id)])) },
  },
  shots: {
    "1-list": { palette: "stats", keys: [], caption: "One row per fact, the value as the name: a build running, the CPU amber, its last three minutes in the detail pane" },
    "2-memory": { palette: "stats", keys: ["down*2"], caption: "Memory as Activity Monitor counts it: app, wired, compressed and cached, the pressure and the swap" },
    "3-volumes": { palette: "stats", keys: ["down*4"], caption: "Every volume with its free space and share; Enter copies the mount point, cmd+r reveals it" },
    "4-process": { palette: "stats", keys: ["down*10", "wait:300", "cmd+k"], caption: "The busiest and the largest processes: copy the pid, open Activity Monitor, or kill one after a question" },
  },
});

// ---- the bar: the CPU item -------------------------------------------------------

/** The item as the strip gets it; the colour is the manifest's rules over `stats/cpu` (amber from 70, red from 90), which the core applies. */
const face = (s: Sample, c: ReturnType<typeof ctx>, color: string) => {
  const { states: _s, empty: _e, ...item } = itemOf("cpu", s, c);
  return { ...item, color };
};
const bar = {
  key: "stats/cpu",
  title: manifest.bar.cpu.title,
  item: face(busy, ctx(busyHistory), "amber"),
  states: [
    { id: "spark", item: { title: face(busy, ctx(startHistory, "spark"), "amber").title } },
    { id: "pinned", item: face(pinned, ctx(pinnedHistory, "top"), "red") },
  ],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar only while the CPU is busy: the share, amber from 70%" },
    "menubar-spark": { target: "menubar", state: "spark", caption: "The sparkline label: the last eight samples as block glyphs, a build starting" },
    "menubar-pinned": { target: "menubar", state: "pinned", caption: "Pinned past 90%: red, with the process behind it" },
    "popover": { target: "menubar", popover: true, caption: "A click opens the popover: every core's share and the busiest processes, x kills one after asking" },
    "popover-pinned": { target: "menubar", popover: true, state: "pinned", caption: "An export pinning every core: ffmpeg on top, x kills it after asking" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the chip glyph and the share on an amber label" },
  },
};
writeFixture("bar-stats", bar);
ext.dispose?.();
console.log("stats.json, bar-stats.json: a build on 12 cores, an export pinning them");
