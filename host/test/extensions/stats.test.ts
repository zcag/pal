// stats: the parsers over canned tool output (vm_stat, sysctl, df, mount,
// netstat -ibn, /proc/meminfo, /proc/pressure/memory, /proc/net/dev,
// /proc/mounts, ps), the level and colour logic, the popovers as trees
// through checkView on fixtures, and the extension in the host against
// the real machine (the numbers are whatever this box is doing; the
// shapes are what is checked).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpus } from "node:os";
import { tile } from "../../../sdk/src/icon.ts";
import { parsePs } from "../../../sdk/src/procs.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { counted, cpuDelta, DISK, diskLevel, History, levelOf, macMemory, parseDf, parseIpAddr, parseMacMount, parseMeminfo, parseNetstat, parseProcMounts, parseProcNetDev, parsePsi, parseVmStat, rates, shownIface, volumes, type Sample, type Volume } from "../../../extensions/stats/sample.ts";
import { colorOf, gb, ink, INNER_W, load, memorySegments, pct, rate, rateShort, renderCpu, renderDisk, renderLoad, renderMemory, renderNetwork, sparkGlyphs, sparkline, uptimeText } from "../../../extensions/stats/view.ts";
import { Host } from "../harness.ts";

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                              274962.
Pages active:                            706987.
Pages inactive:                          786163.
Pages speculative:                        22088.
Pages throttled:                              0.
Pages wired down:                        361425.
Pages purgeable:                          21919.
"Translation faults":               38367470592.
Pages copy-on-write:                 5934220625.
Pages zero filled:                  15215945091.
Pages reactivated:                    208069471.
Pages purged:                         168166690.
File-backed pages:                       525936.
Anonymous pages:                         989302.
Pages stored in compressor:              959368.
Pages occupied by compressor:            147157.
Decompressions:                       223761969.
Compressions:                         447348031.
Pageins:                              198691207.
Pageouts:                               3516415.
Swapins:                               14244194.
Swapouts:                               22152376.
`;
const DF = `Filesystem     1024-blocks      Used  Available Capacity  Mounted on
/dev/disk3s1s1  1948404040  16852400 1556311512     2%    /
devfs                  209       209          0   100%    /dev
/dev/disk3s6    1948404040   4194324 1556311512     1%    /System/Volumes/VM
/dev/disk3s2    1948404040  16250824 1556311512     2%    /System/Volumes/Preboot
/dev/disk3s5    1948404040 350426876 1556311512    19%    /System/Volumes/Data
map auto_home            0         0          0   100%    /System/Volumes/Data/home
/dev/disk4s1         22084      7712      14372    35%    /Volumes/Steam
/dev/disk5s1        857560    573196     284364    67%    /Volumes/Slack
/dev/disk6s2     976285620 812345678  163939942    84%    /Volumes/Time Machine Backup
/Users/cagdas/Downloads/Scroll Reverser.app  1948404040 131365956 1779567148     7%    /private/var/folders/ls/T/AppTranslocation/B2F6
`;
const MOUNT = `/dev/disk3s1s1 on / (apfs, sealed, local, read-only, journaled)
devfs on /dev (devfs, local, nobrowse)
/dev/disk3s5 on /System/Volumes/Data (apfs, local, journaled, nobrowse, protect, root data)
/dev/disk4s1 on /Volumes/Steam (hfs, local, nodev, nosuid, read-only, noowners, quarantine, mounted by cagdas)
/dev/disk5s1 on /Volumes/Slack (hfs, local, nodev, nosuid, read-only, noowners, quarantine, mounted by cagdas)
/dev/disk6s2 on /Volumes/Time Machine Backup (apfs, local, nodev, nosuid, journaled, noowners)
`;
const NETSTAT = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                      78822359     0 123684739970 78822359     0 123684739970     0
lo0        16384 127           127.0.0.1       78822359     - 123684739970 78822359     - 123684739970     -
lo0        16384 ::1/128     ::1               78822359     - 123684739970 78822359     - 123684739970     -
gif0*      1280  <Link#2>                             0     0          0        0     0          0     0
en0        1500  <Link#15>   26:9c:73:77:72:39 431229948     0 501156651054 124449892     0 73047266812     0
en0        1500  fe80::8d:14 fe80:f::8d:1407:1 431229948     - 501156651054 124449892     - 73047266812     -
en0        1500  192.168.1     192.168.1.131   431229948     - 501156651054 124449892     - 73047266812     -
awdl0      1500  <Link#16>   3a:e7:7c:1c:65:b7      265     0      54971     1437     0     285791     0
utun4      1280  <Link#20>                       1234     0  156653641959   5678     0  7487123922     0
utun4      1280  100.67.72.103/32 100.67.72.103   1234     -  156653641959   5678     -  7487123922     -
`;
const MEMINFO = `MemTotal:       16303348 kB
MemFree:         1234568 kB
MemAvailable:    8901234 kB
Buffers:          345678 kB
Cached:          6543210 kB
SwapCached:            0 kB
Shmem:            456789 kB
SReclaimable:     234567 kB
SwapTotal:       4194300 kB
SwapFree:        3145725 kB
`;
const PSI = `some avg10=12.50 avg60=4.10 avg300=1.00 total=123456
full avg10=0.20 avg60=0.10 avg300=0.00 total=1234
`;
const PROC_NET_DEV = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 1234567    9876    0    0    0     0          0         0  1234567    9876    0    0    0     0       0          0
  eth0: 501156651054 431229948    0    0    0     0          0    123 73047266812 124449892    0    0    0     0       0          0
wlan0:       0       0    0    0    0     0          0         0        0       0    0    0    0     0       0          0
`;
const PROC_MOUNTS = `/dev/nvme0n1p2 / ext4 rw,relatime 0 0
/dev/nvme0n1p1 /boot/efi vfat rw,relatime 0 0
tmpfs /run tmpfs rw,nosuid 0 0
/dev/loop3 /snap/core/1234 squashfs ro,nodev 0 0
/dev/sdb1 /mnt/back\\040up ext4 ro,relatime 0 0
`;
const LINUX_DF = `Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/nvme0n1p2   488000000 300000000 163000000      65% /
/dev/nvme0n1p1      523248      6220    517028       2% /boot/efi
tmpfs               8000000         0   8000000       0% /run
/dev/loop3           102400    102400         0     100% /snap/core/1234
/dev/sdb1         976285620 900000000  76285620      93% /mnt/back up
`;
const PS = `  458     1   501   0.0   0.1  12340 /usr/libexec/rapportd
 4321   458   501  31.4   2.1 812345 /Applications/Visual Studio Code.app/Contents/MacOS/Electron
 9999     1     0  12.0   0.5 123456 /usr/sbin/sysmond
garbage line
`;

const procs = () => parsePs(PS);
const mem = () => macMemory(VM_STAT, { memsize: 38654705664, swap: "total = 4096.00M  used = 3363.88M  free = 732.12M  (encrypted)", pressure: 1 });
const vols = () => volumes(parseDf(DF), parseMacMount(MOUNT), "darwin", "Macintosh HD");
const base = { theme: "dark" as const, interval: 3, focus: 0 };

describe("stats parsers", () => {
  test("vm_stat and sysctl: Activity Monitor's used, the segments, swap and the pressure word", () => {
    const { pageSize, pages } = parseVmStat(VM_STAT);
    expect(pageSize).toBe(16384);
    expect(pages["Anonymous pages"]).toBe(989302);
    expect(pages["Translation faults"]).toBe(38367470592);
    const m = mem();
    expect(m.total).toBe(38654705664);
    expect(m.app).toBe((989302 - 21919) * 16384);
    expect(m.wired).toBe(361425 * 16384);
    expect(m.compressed).toBe(147157 * 16384);
    expect(m.used).toBe(m.app + m.wired + m.compressed);
    expect(m.cached).toBe((525936 + 21919) * 16384);
    expect(m.free).toBe(274962 * 16384);
    expect(m.swapTotal).toBe(4096 * 1024 ** 2);
    expect(Math.round(m.swapUsed / 1024 ** 2)).toBe(3364);
    expect(m.pressure).toBe("normal");
    expect(macMemory(VM_STAT, { memsize: 1, swap: "", pressure: 2 }).pressure).toBe("warn");
    expect(macMemory(VM_STAT, { memsize: 1, swap: "", pressure: 4 }).pressure).toBe("critical");
    expect(macMemory(VM_STAT, { memsize: 1, swap: "", pressure: 4 }).swapTotal).toBe(0);
  });

  test("/proc/meminfo and PSI: used is total less available, cached adds buffers and reclaimable slab, swap from the two totals", () => {
    const m = parseMeminfo(MEMINFO, PSI);
    expect(m.total).toBe(16303348 * 1024);
    expect(m.used).toBe((16303348 - 8901234) * 1024);
    expect(m.cached).toBe((6543210 + 234567 + 345678) * 1024);
    expect(m.wired).toBe(456789 * 1024);
    expect(m.swapTotal).toBe(4194300 * 1024);
    expect(m.swapUsed).toBe((4194300 - 3145725) * 1024);
    expect(m.pressure).toBe("warn");
    expect(parsePsi("some avg10=0.00\nfull avg10=0.00\n")).toBe("normal");
    expect(parsePsi("some avg10=40.00\nfull avg10=6.50\n")).toBe("critical");
    expect(parsePsi("")).toBe("normal");
  });

  test("netstat -ibn: the Link row's counters whether or not it has a MAC, the inet row's address, a down interface still listed", () => {
    const c = parseNetstat(NETSTAT);
    expect(c.lo0).toEqual({ rx: 123684739970, tx: 123684739970, addr: "127.0.0.1" });
    expect(c.en0).toEqual({ rx: 501156651054, tx: 73047266812, addr: "192.168.1.131" });
    expect(c.gif0).toEqual({ rx: 0, tx: 0 });
    expect(c.awdl0).toEqual({ rx: 54971, tx: 285791 });
    expect(c.utun4).toEqual({ rx: 156653641959, tx: 7487123922, addr: "100.67.72.103" });
  });

  test("/proc/net/dev and ip -j: bytes in and out, the first global IPv4", () => {
    const c = parseProcNetDev(PROC_NET_DEV);
    expect(c.lo).toEqual({ rx: 1234567, tx: 1234567 });
    expect(c.eth0).toEqual({ rx: 501156651054, tx: 73047266812 });
    expect(c.wlan0).toEqual({ rx: 0, tx: 0 });
    expect(parseIpAddr(JSON.stringify([{ ifname: "eth0", addr_info: [{ family: "inet6", local: "fe80::1", scope: "link" }, { family: "inet", local: "10.0.0.5", scope: "global" }] }, { ifname: "lo", addr_info: [] }]))).toEqual({ eth0: "10.0.0.5" });
    expect(parseIpAddr("not json")).toEqual({});
  });

  test("rates: bytes per second between two readings, a reset reads 0, an unseen interface reads 0", () => {
    const prev = { en0: { rx: 1000, tx: 500 }, utun4: { rx: 9000, tx: 100 } };
    const next = { en0: { rx: 1000 + 3 * 1024 * 1024, tx: 500 + 3 * 512, addr: "192.168.1.131" }, utun4: { rx: 10, tx: 100 }, en7: { rx: 5, tx: 5 } };
    const r = Object.fromEntries(rates(prev, next, 3).map((i) => [i.name, i]));
    expect(r.en0).toMatchObject({ down: 1024 * 1024, up: 512, addr: "192.168.1.131", rx: next.en0.rx });
    expect(r.utun4).toMatchObject({ down: 0, up: 0 });
    expect(r.en7).toMatchObject({ down: 0, up: 0 });
    expect(rates({}, next, 0).every((i) => i.down === 0 && i.up === 0)).toBe(true);
  });

  test("counted and shown interfaces: physical links count, tunnels and Apple's private ones do not, anything that moved shows", () => {
    expect(["en0", "eth0", "wlan0", "enp3s0", "wlp2s0"].every(counted)).toBe(true);
    expect(["lo0", "utun4", "awdl0", "anpi0", "bridge0", "docker0", "veth1a", "gif0"].some(counted)).toBe(false);
    expect(shownIface({ name: "en0", down: 0, up: 0, rx: 0, tx: 0 })).toBe(true);
    expect(shownIface({ name: "utun4", down: 0, up: 0, rx: 0, tx: 0, addr: "100.67.72.103" })).toBe(true);
    expect(shownIface({ name: "utun0", down: 0, up: 0, rx: 0, tx: 0 })).toBe(false);
    expect(shownIface({ name: "awdl0", down: 0, up: 0, rx: 0, tx: 0 })).toBe(false);
    expect(shownIface({ name: "awdl0", down: 10, up: 0, rx: 0, tx: 0 })).toBe(true);
  });

  test("df -kP and mount on macOS: the startup disk and /Volumes only, the container's usage on the root, read-only images marked, a name with spaces kept", () => {
    const rows = parseDf(DF);
    expect(rows.find((r) => r.mount === "/Volumes/Time Machine Backup")).toMatchObject({ device: "/dev/disk6s2", total: 976285620 * 1024 });
    expect(rows.find((r) => r.mount.startsWith("/private/var/folders"))).toMatchObject({ device: "/Users/cagdas/Downloads/Scroll Reverser.app" });
    const v = vols();
    expect(v.map((x) => x.mount)).toEqual(["/", "/Volumes/Steam", "/Volumes/Slack", "/Volumes/Time Machine Backup"]);
    expect(v[0]).toMatchObject({ name: "Macintosh HD", fs: "apfs", readOnly: false, total: 1948404040 * 1024, free: 1556311512 * 1024, used: (1948404040 - 1556311512) * 1024 });
    expect(v[1]).toMatchObject({ name: "Steam", readOnly: true, used: 7712 * 1024 });
    expect(v[3]).toMatchObject({ name: "Time Machine Backup", readOnly: false });
    expect(parseMacMount(MOUNT)["/Volumes/Slack"]).toEqual({ fs: "hfs", readOnly: true });
    expect(volumes(parseDf(DF), {}, "darwin")[0].name).toBe("Macintosh HD");
  });

  test("df -kP and /proc/mounts on Linux: block devices only, no tmpfs, snaps or the EFI stub, an octal-escaped mount point decoded", () => {
    const m = parseProcMounts(PROC_MOUNTS);
    expect(m["/mnt/back up"]).toEqual({ fs: "ext4", readOnly: true });
    expect(m["/"]).toEqual({ fs: "ext4", readOnly: false });
    const v = volumes(parseDf(LINUX_DF), m, "linux");
    expect(v.map((x) => [x.mount, x.name, x.readOnly])).toEqual([["/", "/", false], ["/mnt/back up", "back up", true]]);
    expect(v[0].used).toBe(300000000 * 1024);
  });

  test("ps: seven columns, a path with spaces kept whole, the basename as the name, junk skipped", () => {
    const p = procs();
    expect(p).toHaveLength(3);
    expect(p[1]).toEqual({ pid: 4321, ppid: 458, uid: 501, cpu: 31.4, rss: 812345, comm: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron", name: "Electron" });
  });

  test("cpuDelta: busy over total per core, the mean across them, a core with no movement reads 0", () => {
    const prev = [{ busy: 100, total: 1000 }, { busy: 500, total: 1000 }, { busy: 0, total: 0 }];
    const next = [{ busy: 150, total: 1100 }, { busy: 600, total: 1100 }, { busy: 0, total: 0 }];
    expect(cpuDelta(prev, next)).toEqual({ total: 50, cores: [50, 100, 0] });
    expect(cpuDelta([], next).cores).toEqual([0, 0, 0]);
  });
});

describe("stats levels and text", () => {
  test("levelOf and colours: warn from the first threshold, crit from the second, blue below", () => {
    expect(levelOf(69.9, 70, 90)).toBeUndefined();
    expect(levelOf(70, 70, 90)).toBe("warn");
    expect(levelOf(95, 70, 90)).toBe("crit");
    expect(colorOf(undefined)).toBe("blue");
    expect(colorOf("warn")).toBe("amber");
    expect(colorOf("crit")).toBe("red");
  });

  test("diskLevel: percent or free space, whichever is worse; a read-only image never colours", () => {
    const v = (used: number, total: number, readOnly = false): Volume => ({ mount: "/", name: "x", device: "d", total, used, free: total - used, readOnly });
    const GB = 1024 ** 3;
    expect(diskLevel(v(100 * GB, 1000 * GB))).toBeUndefined();
    expect(diskLevel(v(DISK.warn * 10 * GB, 1000 * GB))).toBe("warn");
    expect(diskLevel(v(990 * GB, 1000 * GB))).toBe("crit");
    // A small disk: the free-space thresholds come first.
    expect(diskLevel(v(82 * GB, 100 * GB))).toBe("warn");
    expect(diskLevel(v(36 * GB, 40 * GB))).toBe("crit");
    expect(diskLevel(v(990 * GB, 1000 * GB, true))).toBeUndefined();
  });

  test("the words: shares, rates, sizes, load, uptime, spark glyphs", () => {
    expect(pct(63.4)).toBe("63%");
    expect(rate(0)).toBe("0 B/s");
    expect(rate(1.2 * 1024 ** 2)).toBe("1.2 MB/s");
    expect(rateShort(80 * 1024)).toBe("80K");
    expect(rateShort(24.6 * 1024 ** 2)).toBe("24.6M");
    expect(rateShort(12)).toBe("12");
    expect(gb(24.2 * 1024 ** 3)).toBe("24.2 GB");
    expect(gb(1.5 * 1024 ** 4)).toBe("1.5 TB");
    expect(gb(512 * 1024 ** 2)).toBe("512.0 MB");
    expect(load(3.2)).toBe("3.2");
    expect(load(3.26)).toBe("3.26");
    expect(uptimeText(26 * 86400 + 4 * 3600 + 12 * 60)).toBe("26 d 4 h");
    expect(uptimeText(4 * 3600 + 12 * 60)).toBe("4 h 12 m");
    expect(uptimeText(600)).toBe("10 m");
    expect(sparkGlyphs([0, 14, 29, 43, 57, 71, 86, 100], 100)).toBe("▁▂▃▄▅▆▇█");
    expect(sparkGlyphs([0, 50, 100, 25, 75, 10, 90, 60, 30], 100)).toHaveLength(8);
    expect(sparkGlyphs([], 100)).toBe("");
  });

  test("sparkline: an SVG data url, one area and one line per series, the theme's ink, the scale from max or the peak", () => {
    const url = sparkline([{ values: [10, 50, 90], color: "amber" }], { width: 372, height: 44, theme: "dark", max: 100 });
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    const svg = decodeURIComponent(url.slice("data:image/svg+xml,".length));
    expect(svg).toContain(`stroke="${ink("amber", "dark")}"`);
    expect(svg.match(/<polyline/g)).toHaveLength(1);
    expect(svg).toContain('points="0.0,38.8 186.0,22.0 372.0,5.2"');
    const light = decodeURIComponent(sparkline([{ values: [1, 2], color: "blue" }], { width: 100, height: 20, theme: "light" }).slice(19));
    expect(light).toContain(ink("blue", "light"));
    // No theme known: the middle shade; a single value draws nothing but the baseline.
    const none = decodeURIComponent(sparkline([{ values: [5], color: "blue" }], { width: 100, height: 20 }).slice(19));
    expect(none).not.toContain("<polyline");
    expect(none).toContain("<line");
    const two = decodeURIComponent(sparkline([{ values: [0, 1024], color: "blue" }, { values: [0, 512], color: "violet" }], { width: 100, height: 20, floor: 1 }).slice(19));
    expect(two.match(/<polyline/g)).toHaveLength(2);
    expect(two).toContain(ink("violet", undefined));
  });

  test("memorySegments: app, wired, compressed (when any), cached, free from the remainder", () => {
    const m = mem();
    const segs = memorySegments(m);
    expect(segs.map((s) => s.key)).toEqual(["app", "wired", "compressed", "cached", "free"]);
    expect(segs.reduce((a, s) => a + s.value, 0)).toBe(m.total);
    expect(memorySegments({ ...m, compressed: 0 }).map((s) => s.key)).not.toContain("compressed");
  });

  test("History keeps the last 60 of each series", () => {
    const h = new History();
    const s = (n: number): Sample => ({ at: n, cpu: { total: n, cores: [n] }, load: [n, 0, 0], memory: { ...mem(), used: n, total: 100 }, net: { ifaces: [], down: n, up: n }, uptime: 0, volumes: [] });
    for (let i = 0; i < 70; i++) h.push(s(i));
    expect(h.length).toBe(60);
    expect(h.get("cpu")[0]).toBe(10);
    expect(h.get("memory")[59]).toBe(69);
    expect(h.get("load")).toHaveLength(60);
  });
});

describe("stats popovers", () => {
  const hist = Array.from({ length: 60 }, (_, i) => 30 + (i % 7) * 5);

  test("cpu: the share and level, a core row per pair, the five busiest with a Kill on the focused, the cursor ring", () => {
    const many = [...procs(), ...Array.from({ length: 6 }, (_, i) => ({ pid: 100 + i, ppid: 1, uid: 501, cpu: 5 - i * 0.5, rss: 1000, comm: `p${i}`, name: `p${i}` }))];
    const v = renderCpu({ ...base, cpu: { total: 78, cores: [90, 66, 12, 0, 100] }, load: [3.26, 3.25, 2.91], uptime: 90000, history: hist, procs: many, focus: 1 });
    checkView(v, "cpu");
    expect(v.title).toBe("CPU 78%");
    // Enter is Activity Monitor on macOS, the Processes palette elsewhere (where `p` has no row of its own).
    expect(v.actions.map((a) => a.id)).toEqual([...(process.platform === "darwin" ? ["monitor", "kill", "copy", "processes"] : ["processes", "kill", "copy"]), "palette", "down", "up", "focus:4321", "focus:9999", "focus:100", "focus:101", "focus:102"]);
    expect(v.actions[1]).toMatchObject({ title: "Kill sysmond", style: "destructive", confirm: "Send SIGTERM to sysmond (9999)?", shortcut: "x" });
    const flat = JSON.stringify(v.tree);
    expect(flat).toContain('"text":"high"');
    expect(flat).toContain("5 cores · load 3.26 3.25 2.91 · up 1 d 1 h");
    expect((v.tree as any).children.filter((n: any) => n.key?.startsWith("cores-"))).toHaveLength(3);
    const focused = JSON.parse(flat).children.find((n: any) => n.key === "p-9999");
    expect(focused.selected).toBe(true);
    expect(focused.action).toBe("focus:9999");
    expect(flat).not.toContain("p-105");
  });

  test("memory: the segments sum to the width, the pressure word wins the badge, the largest processes", () => {
    const v = renderMemory({ ...base, memory: { ...mem(), pressure: "critical" }, history: hist, procs: procs() });
    checkView(v, "memory");
    expect(v.title).toBe("Memory 63%");
    const tree = v.tree as any;
    const segs = tree.children.find((n: any) => n.key === "segments").children;
    expect(segs).toHaveLength(5);
    expect(segs.reduce((a: number, t: any) => a + t.width, 0)).toBeGreaterThanOrEqual(INNER_W - 4 * 4 - 3);
    expect(JSON.stringify(tree)).toContain('"text":"critical"');
    expect(tree.children.find((n: any) => n.key === "p-4321").selected).toBe(true);
    expect(v.actions[1]).toMatchObject({ id: "kill", title: "Kill Electron" });
  });

  test("disk: a card per volume with a bar, the read-only badge, Enter reveals the focused one", () => {
    const v = renderDisk({ ...base, volumes: vols(), focus: 3 });
    checkView(v, "disk");
    expect(v.title).toBe("4 volumes");
    expect(v.actions.map((a) => a.id)).toEqual(["reveal", "copy", "palette", "down", "up", "focus:/", "focus:/Volumes/Steam", "focus:/Volumes/Slack", "focus:/Volumes/Time Machine Backup"]);
    const tree = v.tree as any;
    expect(tree.children[0].children[0].value).toBe("156.3 GB");
    expect(tree.children.find((n: any) => n.key === "vol-/Volumes/Time Machine Backup").selected).toBe(true);
    expect(JSON.stringify(tree)).toContain('"text":"read-only"');
    const one = renderDisk({ ...base, volumes: vols().slice(0, 1) });
    expect(one.title).toBe("Macintosh HD 20%");
    checkView(renderDisk({ ...base, volumes: [] }), "empty");
  });

  test("network: the two rates, both lines in the sparkline, an interface row with its kind and address", () => {
    const v = renderNetwork({ ...base, ifaces: [{ name: "en0", down: 1.2 * 1024 ** 2, up: 80 * 1024, rx: 1, tx: 1, addr: "192.168.1.131", kind: "Wi-Fi", ssid: "Zaxxon" }, { name: "utun4", down: 0, up: 0, rx: 1, tx: 1, addr: "100.67.72.103", kind: "VPN" }], down: 1.2 * 1024 ** 2, up: 80 * 1024, downHistory: hist, upHistory: hist.map((x) => x / 4) });
    checkView(v, "network");
    expect(v.title).toBe("Network ↓ 1.2 MB/s ↑ 80 KB/s");
    const flat = JSON.stringify(v.tree);
    expect(flat).toContain("en0 · Wi-Fi · Zaxxon");
    expect(flat).toContain("192.168.1.131");
    expect(flat).toContain('"text":"active"');
    expect(v.actions.map((a) => a.id)).toEqual(["addresses", "copy", "palette", "down", "up", "focus:en0", "focus:utun4"]);
    const svg = decodeURIComponent(((v.tree as any).children.find((n: any) => n.key === "spark").src as string).slice(19));
    expect(svg.match(/<polyline/g)).toHaveLength(2);
  });

  test("load: three tiles, amber past the cores, red past twice", () => {
    const fine = renderLoad({ ...base, load: [3.26, 3.25, 2.91], cores: 18, history: hist, uptime: 1000 });
    checkView(fine, "load");
    expect(fine.title).toBe("Load 3.26");
    expect(JSON.stringify(fine.tree)).toContain('"text":"fine"');
    const hot = renderLoad({ ...base, load: [40, 20, 10], cores: 18, history: hist, uptime: 1000 });
    const tiles = (hot.tree as any).children.find((n: any) => n.key === "tiles").children;
    expect(tiles.map((t: any) => t.color)).toEqual(["red", "amber", "neutral"]);
    expect(JSON.stringify(hot.tree)).toContain('"text":"critical"');
  });
});

let host: Host;
beforeAll(async () => { host = await Host.bundled(); });
afterAll(() => host.kill());

describe("stats in the host", () => {
  test("meta: the live palette, five items with rules and mocks, the states and links declared, no warnings", () => {
    const l = host.loaded().find((x) => x.extension === "stats")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes).toMatchObject([{ name: "stats", title: "Stats", live: true, input: false, icon: tile("slate", "\u{f0127}"), showDetail: true }]);
    expect(l.bar.map((b) => b.id)).toEqual(["cpu", "memory", "disk", "network", "load"]);
    for (const b of l.bar) {
      expect(b.source).toBe(true);
      expect(b.rules!.length).toBeGreaterThanOrEqual(2);
      expect(b.rules![0]).toMatchObject({ id: "quiet", hidden: true });
      expect(Object.keys(b.mocks!)).toContain("idle");
      expect(b.mocks!.idle.item).toMatchObject({ hidden: true, empty: { title: expect.any(String) } });
      expect(b.keys!.length).toBeGreaterThanOrEqual(3);
    }
    expect(Object.keys(l.manifest.states!)).toEqual(["cpu", "cpu_top", "cores", "memory", "memory_pressure", "swap", "disk", "disk_free", "disk_worst", "net_down", "net_up", "load1", "load5", "load15"]);
    expect(Object.keys(l.manifest.links!)).toEqual(["cpu", "memory", "disk", "network", "load"]);
  });

  test("bar: every item renders from one sampler with its facts, a popover view and the empty shape; the states carry numbers", async () => {
    const cpu = await host.render("stats", "cpu");
    expect(cpu).toMatchObject({ icon: "\u{f061a}", title: expect.stringMatching(/^\d+%$/), states: { cpu: expect.any(Number), cores: expect.any(Number) }, empty: { icon: "\u{f061a}", title: cpu.title, menu: { view: { id: "cpu" } } } });
    expect((cpu.menu as any).view.title).toMatch(/^CPU \d+%$/);
    expect(cpu).not.toHaveProperty("color");
    expect(cpu).not.toHaveProperty("hidden");
    const memory = await host.render("stats", "memory");
    expect(memory).toMatchObject({ icon: "\u{f035b}", title: expect.stringMatching(/^\d+%$/), states: { memory: expect.any(Number), memory_pressure: expect.stringMatching(/^(normal|warn|critical)$/), swap: expect.any(Number) } });
    const disk = await host.render("stats", "disk");
    expect(disk).toMatchObject({ icon: "\u{f02ca}", title: expect.stringMatching(/^[\d.]+ [GMT]B$/), states: { disk: expect.any(Number), disk_free: expect.any(Number), disk_worst: expect.any(Number) } });
    const network = await host.render("stats", "network");
    expect(network).toMatchObject({ icon: "\u{f04e2}", title: expect.stringMatching(/^↓\S+ ↑\S+$/), states: { net_down: expect.any(Number), net_up: expect.any(Number) } });
    const load = await host.render("stats", "load");
    // Read before the match: bun's toMatchObject leaves its matchers in the received object.
    const cores = load.states!.cores;
    expect(load).toMatchObject({ icon: "\u{f04c5}", title: expect.stringMatching(/^\d+\.\d+$/), states: { load1: expect.any(Number), load5: expect.any(Number), load15: expect.any(Number), cores: expect.any(Number) } });
    expect(cores).toBe(cpus().length);
  });

  test("bar: each item's label setting changes what its strip says", async () => {
    const label = (id: string, value: string) => host.render("stats", id, { reason: "settings", settings: { label: value } });
    expect(host.manifests.get("stats")!.settings!.map((s) => s.id)).toEqual(["interval", "disk_hide"]);
    expect(["cpu", "memory", "disk", "network", "load"].map((id) => host.manifests.get("stats")!.bar![id]!.settings!.map((s) => s.id))).toEqual([["label"], ["label"], ["label"], ["label"], ["label"]]);
    expect((await label("cpu", "spark")).title).toMatch(/^[▁▂▃▄▅▆▇█]+$/);
    expect((await label("memory", "used")).title).toMatch(/^[\d.]+ [GM]B$/);
    expect((await label("disk", "percent")).title).toMatch(/^\d+%$/);
    expect((await label("network", "down")).title).toMatch(/^↓\S+$/);
    expect((await label("load", "three")).title).toMatch(/^\d+\.\d+ \d+\.\d+ \d+\.\d+$/);
    // The declared defaults again when the ctx leaves them out.
    expect((await host.render("stats", "disk")).title).toMatch(/^[\d.]+ [GMT]B$/);
    for (const id of ["cpu", "memory", "network", "load"]) await host.render("stats", id);
  });

  test("popover keys: the cursor moves and wraps, a click focuses, copy answers the value, the palette and monitor open", async () => {
    const down = await host.barAction("stats", "cpu", "down");
    expect(down).toMatchObject({ view: { id: "cpu" } });
    const first = await host.barAction("stats", "disk", "focus:/");
    expect(JSON.stringify(first)).toContain('"key":"vol-/","padding":1');
    expect(await host.barAction("stats", "disk", "copy")).toEqual({ copy: "/" });
    expect(await host.barAction("stats", "disk", "reveal")).toEqual({ open: "/" });
    expect(await host.barAction("stats", "cpu", "copy")).toEqual({ copy: expect.stringMatching(/^\d+%$/) });
    expect(await host.barAction("stats", "load", "copy")).toEqual({ copy: expect.stringMatching(/^[\d.]+ [\d.]+ [\d.]+$/) });
    expect(await host.barAction("stats", "cpu", "palette")).toEqual({ push: { extension: "stats", palette: "stats", args: { section: "cpu" } } });
    expect(await host.barAction("stats", "network", "addresses")).toEqual({ push: { extension: "network", palette: "network" } });
    expect(await host.barAction("stats", "memory", "processes")).toEqual({ push: { extension: "processes", palette: "processes" } });
    if (process.platform === "darwin") expect(await host.barAction("stats", "cpu", "monitor")).toEqual({ open: "/System/Applications/Utilities/Activity Monitor.app" });
  });

  test("palette: the facts as rows in sections, Enter copies the value, a section arg narrows the listing", async () => {
    const rows = await host.list("stats", "stats");
    const ids = rows.map((r) => r.id);
    expect(ids.slice(0, 3)).toEqual(["cpu", "load", "memory"]);
    expect(ids.some((id) => id.startsWith("disk:"))).toBe(true);
    expect(ids.filter((id) => id.startsWith("proc:") && id.endsWith(":cpu"))).toHaveLength(5);
    expect(ids.filter((id) => id.startsWith("proc:") && id.endsWith(":mem"))).toHaveLength(5);
    expect(ids[ids.length - 1]).toBe("uptime");
    expect(rows[0]).toMatchObject({ name: expect.stringMatching(/^\d+%$/), section: "Processor", subtitle: expect.stringContaining("CPU · "), actions: [{ id: "copy" }, { id: expect.stringMatching(/monitor|processes/) }, { id: "popover" }] });
    expect(rows.find((r) => r.id === "memory")).toMatchObject({ section: "Memory", name: expect.stringMatching(/GB used · \d+%$/) });
    const disk = rows.find((r) => r.id.startsWith("disk:"))!;
    expect(disk).toMatchObject({ section: "Disks", name: expect.stringMatching(/free$/), actions: [{ id: "copy" }, { id: "reveal", shortcut: "cmd+r" }, { id: "popover" }] });
    expect(await host.pick("stats", "stats", disk.id)).toEqual({ copy: disk.id.slice(5) });
    expect(await host.pick("stats", "stats", "cpu")).toEqual({ copy: rows[0].name });
    expect(await host.pick("stats", "stats", "cpu", "popover")).toEqual({ open: "pal://bar/stats/cpu" });
    expect(await host.pick("stats", "stats", disk.id, "popover")).toEqual({ open: "pal://bar/stats/disk" });
    const detail = await host.detail("stats", "stats", "cpu");
    expect(detail?.markdown).toMatch(/^!\[\]\(data:image\/svg\+xml,/);
    expect(detail?.metadata?.map((m) => m.label)).toEqual(expect.arrayContaining(["CPU", "Cores", "Per core", "Load"]));
    const only = await host.list("stats", "stats", undefined, { args: { section: "disk" } });
    expect(only.every((r) => r.section === "Disks")).toBe(true);
    const procRows = await host.list("stats", "stats", undefined, { args: { section: "memory" } });
    expect(new Set(procRows.map((r) => r.section))).toEqual(new Set(["Memory", "Largest processes"]));
    expect(procRows.find((r) => r.id.startsWith("proc:"))!.actions!.map((a) => a.id)).toEqual(["copy", "kill", expect.stringMatching(/monitor|processes/), "popover"]);
  });

  test("links: pal://stats/<item> opens the popover, ?palette=1 the palette on that section, an unknown route throws", async () => {
    const link = (route: string, params: Record<string, unknown> = {}) => host.request<Record<string, unknown>>("link", { extension: "stats", route, params });
    expect(await link("cpu")).toEqual({ open: "pal://bar/stats/cpu" });
    expect(await link("network", { palette: true })).toEqual({ push: { extension: "stats", palette: "stats", args: { section: "network" } } });
    await expect(link("gpu")).rejects.toThrow("no route stats/gpu");
  });

  test("the loop pushes every item on its interval", async () => {
    host.changeSettings("stats", { settings: { interval: 1 } });
    const item = await host.nextUpdate("stats", "load", () => true, 4000);
    expect(item).toMatchObject({ icon: "\u{f04c5}", states: { load1: expect.any(Number) } });
    await host.nextUpdate("stats", "network", () => true, 4000);
    host.changeSettings("stats", { settings: {} });
  });
});
