// Network: what this machine's addresses are right now, one row per
// value, the value as the row's name so it reads at a glance and Enter
// copies it. Everything comes from the OS's own tools, each run with a
// timeout, in parallel: `ifconfig`/`networksetup`/`ipconfig`/`route`/`scutil`
// on macOS, `ip -j`/`iw`/`resolv.conf` (or `resolvectl`) on Linux,
// `tailscale ip` where the CLI is installed. The public IP is one fetch,
// cached ten minutes; the shell's Refresh (⌘R) drops the cache.
// `PAL_NETWORK_OS` forces the platform and `PAL_NETWORK_RESOLV` the
// resolv.conf (the tests run both paths on one machine with fake tools on
// PATH).
import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { errorMessage, hint, run as exec, settings, toast, when, wifi as wifiCore, type Action, type BarItem, type Ctx, type Detail, type Effect, type Extension, type Item, type Metadata } from "@zcag/pal";
import { renderNetworkPopover, type NetworkPopover } from "./view.ts";

/** `[extensions.network]`, default in pal.json; `ssid_labels` and `network_icons` are the old split of `networks`, still read (see `table`). */
type Settings = { public_ip_url: string; networks?: unknown[]; ssid_labels?: unknown[]; network_icons?: unknown[] };

const OS = process.env.PAL_NETWORK_OS ?? process.platform;
const MAC = OS === "darwin";
/** The tests point this at a fixture. */
const RESOLV_CONF = process.env.PAL_NETWORK_RESOLV ?? "/etc/resolv.conf";
const GLYPH = { wifi: "\u{f05a9}", wired: "\u{f0200}", tailscale: "\u{f0582}", host: "\u{f0322}", public: "\u{f01e7}", gateway: "\u{f1087}", dns: "\u{f01d6}" }; // md-wifi, md-ethernet, md-vpn, md-laptop, md-earth, md-router_network, md-dns
/** What the strip draws instead: off, a phone's hotspot, an open network. */
const BAR_GLYPH = { off: "\u{f092d}", hotspot: "\u{f011c}", open: "\u{f0176}" }; // md-wifi_off, md-cellphone_wireless, md-coffee
/** Signal as a percentage, the core's `(dBm + 100) * 2`: -55, -67 and -75 dBm. */
const SIGNAL: [number, string][] = [[90, "\u{f0928}"], [66, "\u{f0925}"], [50, "\u{f0922}"], [0, "\u{f091f}"]];
/** `core/src/wifi.rs`'s scale, so a Linux reading and a macOS one mean the same thing. */
const percentOf = (dbm: number) => Math.max(0, Math.min(100, (dbm + 100) * 2));
/** A phone's hotspot is usually named after the phone; an entry in `networks` names the rest. */
const HOTSPOT_RE = /iphone|android|hotspot|tether/i;
const TOOL_MS = 3000;
const FETCH_MS = 3000;
const PUBLIC_TTL_MS = 10 * 60 * 1000;
/** The App Store build of Tailscale ships no CLI on PATH; its binary answers `ip` all the same. */
const TAILSCALE_APP = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const MAC_SETTINGS_URL = "x-apple.systempreferences:com.apple.Network-Settings.extension";
const LINUX_SETTINGS: string[][] = [["gnome-control-center", "network"], ["systemsettings", "kcm_networkmanagement"], ["nm-connection-editor"]];

/** Stdout of `argv`, or "" when the tool is missing, fails or takes longer than `ms`. */
const run = (argv: string[], ms = TOOL_MS): Promise<string> => (Bun.which(argv[0]) ? exec(argv, { ms }).catch(() => "") : Promise.resolve(""));

// ---- what is gathered ------------------------------------------------------

type Iface = { name: string; kind?: string; v4: string[]; v6: string[]; mac?: string; ssid?: string; /** macOS gave `<redacted>` and the core had no name either: pal lacks Location Services. */ ssidHidden?: boolean; security?: string; /** 0-100, the core's scale. */ signal?: number; up?: boolean };
type Public = { ip: string; city?: string; region?: string; country?: string; org?: string; at: number };
type Snapshot = { ifaces: Iface[]; gateway?: { ip: string; dev?: string }; dns: string[]; tailscale: string[]; host: string; localHost?: string; public?: Public | { error: string } };

const isLinkLocal = (v6: string) => /^fe80:/i.test(v6);

/** `ifconfig`: one block per interface; `inet`, `inet6` (link-local dropped), `ether`, `status: active`. */
function parseIfconfig(text: string): Iface[] {
  const out: Iface[] = [];
  let cur: Iface | undefined;
  for (const line of text.split("\n")) {
    const head = /^([a-z0-9.]+): flags=/i.exec(line);
    if (head) { cur = { name: head[1], v4: [], v6: [] }; out.push(cur); continue; }
    if (!cur) continue;
    const t = line.trim();
    let m: RegExpExecArray | null;
    if ((m = /^inet (\S+)/.exec(t))) cur.v4.push(m[1]);
    else if ((m = /^inet6 (\S+)/.exec(t))) { const a = m[1].replace(/%.*$/, ""); if (!isLinkLocal(a)) cur.v6.push(a); }
    else if ((m = /^ether (\S+)/.exec(t))) cur.mac = m[1];
    else if ((m = /^status: (\S+)/.exec(t))) cur.up = m[1] === "active";
  }
  return out.filter((i) => i.name !== "lo0" && (i.v4.length || i.v6.length));
}

/** `networksetup -listallhardwareports`: device to hardware port name ("Wi-Fi", "Ethernet"). */
function parseHardwarePorts(text: string): Map<string, string> {
  const map = new Map<string, string>();
  let port: string | undefined;
  for (const line of text.split("\n")) {
    let m: RegExpExecArray | null;
    if ((m = /^Hardware Port: (.+)$/.exec(line))) port = m[1].trim();
    else if ((m = /^Device: (\S+)/.exec(line)) && port) map.set(m[1], port);
  }
  return map;
}

/** `ipconfig getsummary en0`: the SSID (macOS redacts it for a process without Location access) and the security. */
function parseSummary(text: string): Pick<Iface, "ssid" | "ssidHidden" | "security"> {
  const ssid = /^\s*SSID : (.+)$/m.exec(text)?.[1].trim();
  const security = /^\s*Security : (.+)$/m.exec(text)?.[1].trim();
  return { ssid: ssid && ssid !== "<redacted>" ? ssid : undefined, ssidHidden: ssid === "<redacted>", security };
}

/** `scutil --dns`: nameservers in the order the resolvers list them, without repeats. */
const parseScutilDns = (text: string) => [...new Set([...text.matchAll(/^\s*nameserver\[\d+\] : (\S+)/gm)].map((m) => m[1]))];

async function macSnapshot(): Promise<Omit<Snapshot, "public" | "tailscale" | "host">> {
  const [ifc, ports, route, dns, local] = await Promise.all([run(["ifconfig"]), run(["networksetup", "-listallhardwareports"]), run(["route", "-n", "get", "default"]), run(["scutil", "--dns"]), run(["scutil", "--get", "LocalHostName"])]);
  const ifaces = parseIfconfig(ifc);
  const kinds = parseHardwarePorts(ports);
  for (const i of ifaces) i.kind = kinds.get(i.name);
  const wifi = ifaces.find((i) => i.kind === "Wi-Fi");
  if (wifi) {
    Object.assign(wifi, parseSummary(await run(["ipconfig", "getsummary", wifi.name])));
    // The core reads CoreWLAN in-process, which is the only way to two things the
    // tools will not give: the signal, and the name when macOS has redacted it
    // for a process without Location Services (pal's own grant does not reach
    // the tools it runs, but does cover an in-process read).
    const current = await wifiCore.status().then((s) => s?.current).catch(() => undefined);
    // `null` is the core's "no reading", and it is not a weak one.
    if (typeof current?.signal === "number") wifi.signal = current.signal;
    if (wifi.ssidHidden && current?.ssid) Object.assign(wifi, { ssid: current.ssid, ssidHidden: false });
  }
  const gw = /gateway: (\S+)/.exec(route)?.[1];
  const dev = /interface: (\S+)/.exec(route)?.[1];
  const localHost = local.trim() || undefined;
  return { ifaces, gateway: gw ? { ip: gw, dev } : undefined, dns: parseScutilDns(dns), localHost: localHost && `${localHost}.local` };
}

type IpAddr = { ifname: string; address?: string; operstate?: string; link_type?: string; addr_info?: { family: string; local: string; scope: string }[] };
async function linuxSnapshot(): Promise<Omit<Snapshot, "public" | "tailscale" | "host">> {
  const [addr, iw, route, resolv] = await Promise.all([run(["ip", "-j", "addr"]), run(["iw", "dev"]), run(["ip", "-j", "route", "show", "default"]), readFile(RESOLV_CONF, "utf8").catch(() => "")]);
  let list: IpAddr[] = [];
  try { list = JSON.parse(addr || "[]"); } catch {}
  const ifaces: Iface[] = list.filter((i) => i.link_type !== "loopback").map((i) => ({
    name: i.ifname,
    mac: i.address,
    up: i.operstate === "UP",
    v4: (i.addr_info ?? []).filter((a) => a.family === "inet").map((a) => a.local),
    v6: (i.addr_info ?? []).filter((a) => a.family === "inet6" && a.scope !== "link").map((a) => a.local),
  })).filter((i) => i.v4.length || i.v6.length);
  // `iw dev`: "Interface wlan0" blocks with an "ssid NAME" line while associated.
  let dev: string | undefined;
  for (const line of iw.split("\n")) {
    const t = line.trim();
    let m: RegExpExecArray | null;
    if ((m = /^Interface (\S+)/.exec(t))) { dev = m[1]; const i = ifaces.find((x) => x.name === dev); if (i) i.kind = "Wi-Fi"; }
    else if ((m = /^ssid (.+)$/.exec(t)) && dev) { const i = ifaces.find((x) => x.name === dev); if (i) i.ssid = m[1]; }
  }
  let gateway: Snapshot["gateway"];
  try { const r = JSON.parse(route || "[]")[0]; if (r?.gateway) gateway = { ip: r.gateway, dev: r.dev }; } catch {}
  // `iw dev` stops at the association; the strength is one call further in.
  const wifi = ifaces.find((i) => i.kind === "Wi-Fi");
  if (wifi) {
    const dbm = Number(/^\s*signal:\s*(-?\d+)/m.exec(await run(["iw", "dev", wifi.name, "link"]))?.[1]);
    if (Number.isFinite(dbm) && dbm < 0) wifi.signal = percentOf(dbm);
  }
  let dns = [...resolv.matchAll(/^nameserver\s+(\S+)/gm)].map((m) => m[1]);
  // systemd-resolved's stub: ask it for the real upstreams.
  if (dns.length && dns.every((d) => d.startsWith("127.0.0.53"))) {
    const real = [...(await run(["resolvectl", "dns"])).matchAll(/^Link \d+ \([^)]+\): (.+)$/gm)].flatMap((m) => m[1].trim().split(/\s+/));
    if (real.length) dns = [...new Set(real)];
  }
  return { ifaces, gateway, dns };
}

async function tailscaleIps(): Promise<string[]> {
  const bin = Bun.which("tailscale") ?? (MAC && (await Bun.file(TAILSCALE_APP).exists()) ? TAILSCALE_APP : undefined);
  if (!bin) return [];
  return (await run([bin, "ip"])).split("\n").map((l) => l.trim()).filter(Boolean);
}

// ---- public ip -------------------------------------------------------------

let publicCache: { url: string; value: Public | { error: string } } | undefined;
const IP_RE = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]+:[0-9a-f:]*)$/i;

/** One GET; JSON in any of the common shapes (ipinfo `ip`, ip-api `query`, ipwho.is `connection.isp`), or a bare address. */
async function fetchPublic(url: string): Promise<Public | { error: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS), headers: { accept: "application/json, text/plain" } });
    if (!res.ok) return { error: `${res.status} from ${new URL(url).host}` };
    const text = (await res.text()).trim();
    let j: Record<string, unknown> | undefined;
    try { j = JSON.parse(text); } catch {}
    const at = Date.now();
    if (j && typeof j === "object") {
      const ip = [j.ip, j.query, j.ip_addr].find((v): v is string => typeof v === "string");
      if (!ip) return { error: "no ip in the reply" };
      const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
      const conn = j.connection as Record<string, unknown> | undefined;
      return { ip, city: str(j.city), region: str(j.region), country: str(j.country) ?? str(j.country_name) ?? str(j.countryCode), org: str(j.org) ?? str(j.isp) ?? str(conn?.isp) ?? str(conn?.org), at };
    }
    return IP_RE.test(text) ? { ip: text, at } : { error: "not an address" };
  } catch (e) {
    return { error: (e as Error)?.name === "TimeoutError" ? `did not answer within ${FETCH_MS / 1000} s` : errorMessage(e) };
  }
}

async function publicIp(url: string, refresh: boolean): Promise<Public | { error: string }> {
  const c = publicCache;
  if (!refresh && c && c.url === url && "ip" in c.value && Date.now() - c.value.at < PUBLIC_TTL_MS) return c.value;
  const value = await fetchPublic(url);
  publicCache = { url, value };
  return value;
}

// ---- rows ------------------------------------------------------------------

const ACTIONS: Action[] = [
  { id: "copy", title: "Copy" },
  { id: "settings", title: "Open Network settings" },
];
const SECTION = { machine: "This machine", internet: "Internet", network: "Network" };

/** What the last listing knew per row: the value Enter copies and the detail pane's content. */
const known = new Map<string, { value: string; detail: Detail }>();
const meta = (pairs: [string, string | undefined][]): Metadata[] => pairs.filter((p): p is [string, string] => !!p[1]).map(([label, value]) => ({ label, value }));

function row(id: string, value: string, subtitle: string, section: string, keywords: string[], detail: Detail, icon: string): Item {
  known.set(id, { value, detail });
  return { id, name: value, subtitle, icon, keywords, section, actions: ACTIONS };
}

const ifaceDetail = (i: Iface): Detail => ({
  metadata: meta([["Interface", i.name], ["Kind", i.kind], ["SSID", i.ssid ?? (i.ssidHidden ? "hidden by macOS until pal has Location access (the Wi-Fi palette asks)" : undefined)], ["Security", i.security], ["Signal", i.signal === undefined ? undefined : `${i.signal}%`], ["IPv4", i.v4.join(", ") || undefined], ["IPv6", i.v6.join(", ") || undefined], ["MAC", i.mac], ["Status", i.up === undefined ? undefined : i.up ? "active" : "inactive"]]),
});

function rows(s: Snapshot, withPublic: boolean): Item[] {
  const out: Item[] = [];
  for (const i of s.ifaces) {
    const label = [i.name, i.kind, i.ssid].filter(Boolean).join(" · ");
    const kw = [i.name, ...(i.kind === "Wi-Fi" ? ["wifi", "wlan", "ssid"] : []), "ip", "lan", "local", ...(i.ssid ? [i.ssid] : [])];
    // The network's own glyph where it has one; the gateway key reaches only the interface carrying the route.
    const icon = marks(i, i.name === s.gateway?.dev ? s.gateway.ip : undefined).icon ?? (i.kind === "Wi-Fi" ? GLYPH.wifi : GLYPH.wired);
    for (const a of i.v4) out.push(row(`if:${i.name}:${a}`, a, label, SECTION.machine, kw, ifaceDetail(i), icon));
    for (const a of i.v6) out.push(row(`if:${i.name}:${a}`, a, `${label} · IPv6`, SECTION.machine, [...kw, "ipv6"], ifaceDetail(i), icon));
  }
  if (!s.ifaces.length) out.push(hint("if:none", "No interface has an address", "Not connected to any network", { section: SECTION.machine, icon: GLYPH.wired }));
  for (const [n, a] of s.tailscale.entries()) out.push(row(`tailscale:${a}`, a, n ? "Tailscale · IPv6" : "Tailscale", SECTION.machine, ["tailscale", "ts", "vpn"], { metadata: meta([["Tailscale IPv4", s.tailscale[0]], ["Tailscale IPv6", s.tailscale[1]]]) }, GLYPH.tailscale));
  out.push(row("hostname", s.host, "Hostname", SECTION.machine, ["hostname", "host", "name"], { metadata: meta([["Hostname", s.host], ["Local hostname", s.localHost]]) }, GLYPH.host));
  if (s.localHost && s.localHost !== s.host) out.push(row("localhostname", s.localHost, "Local hostname (Bonjour)", SECTION.machine, ["hostname", "bonjour", "mdns", "local"], { metadata: meta([["Hostname", s.host], ["Local hostname", s.localHost]]) }, GLYPH.host));
  if (withPublic) {
    const p = s.public;
    if (p && "ip" in p) {
      const where = [p.city, p.country].filter(Boolean).join(", ");
      out.push(row("public", p.ip, ["Public IP", where, p.org].filter(Boolean).join(" · "), SECTION.internet, ["public", "wan", "external", "ip", ...(p.country ? [p.country] : []), ...(p.org ? [p.org] : [])], {
        metadata: meta([["Public IP", p.ip], ["City", p.city], ["Region", p.region], ["Country", p.country], ["Organisation", p.org], ["Fetched", when(p.at)]]),
      }, GLYPH.public));
    } else out.push(hint("public:none", "Public IP unavailable", p ? `${p.error}; cmd+r tries again` : "no endpoint", { section: SECTION.internet, icon: GLYPH.public }));
  }
  if (s.gateway) out.push(row("gateway", s.gateway.ip, ["Gateway", s.gateway.dev].filter(Boolean).join(" · "), SECTION.network, ["gateway", "router", "default route"], { metadata: meta([["Gateway", s.gateway.ip], ["Interface", s.gateway.dev]]) }, GLYPH.gateway));
  for (const [n, d] of s.dns.entries()) out.push(row(`dns:${d}`, d, s.dns.length > 1 ? `DNS ${n + 1}` : "DNS", SECTION.network, ["dns", "nameserver", "resolver"], { metadata: meta([["DNS server", d], ["Order", String(n + 1)], ["All", s.dns.join(", ")]]) }, GLYPH.dns));
  if (!s.gateway && !s.dns.length) out.push(hint("network:none", "No gateway or DNS", "No default route", { section: SECTION.network, icon: GLYPH.gateway }));
  return out;
}

async function snapshot(ctx?: Ctx, includePublic = true): Promise<{ s: Snapshot; withPublic: boolean }> {
  const url = settings.get<Settings>().public_ip_url?.trim();
  const [base, tailscale, pub] = await Promise.all([MAC ? macSnapshot() : linuxSnapshot(), tailscaleIps(), includePublic && url ? publicIp(url, !!ctx?.refresh) : undefined]);
  // The tunnel interface carrying the Tailscale addresses (utun4, tailscale0) says nothing the Tailscale rows do not.
  const ifaces = base.ifaces.filter((i) => !tailscale.length || [...i.v4, ...i.v6].some((a) => !tailscale.includes(a)));
  return { s: { ...base, ifaces, tailscale, host: hostname(), public: pub }, withPublic: !!url };
}

// ---- the networks table ---------------------------------------------------
// One `networks` line per network: `SSID = kind label:Name icon:X`. The
// fields are keyed rather than positional so any subset reads the same and
// no placeholder stands in for a missing one; a bare word is the kind, and
// a label with a space is quoted. A line keys on the SSID *or* on the
// gateway, because neither alone covers home: macOS redacts the name from a
// process without Location Services, and a cable into the same router has no
// name at all.

type Kind = "hide" | "hotspot" | "public";
const KINDS = new Set<string>(["hide", "hotspot", "public"]);
/** What the table marks a network as; every field optional. */
type Marks = { kind?: Kind; label?: string; icon?: string };
type Line = Marks & { key: string };
/** One field after the `=`: an optional `name:`, then a quoted or a bare value. */
const FIELD = /(?:(\w+):)?(?:"([^"]*)"|(\S+))/g;

/** `key = rest` of one list line, both trimmed; nothing for a line without a key. */
function splitLine(value: unknown): [string, string] | undefined {
  if (typeof value !== "string") return;
  const eq = value.indexOf("=");
  const key = eq < 0 ? "" : value.slice(0, eq).trim();
  return key ? [key, value.slice(eq + 1).trim()] : undefined;
}

/** A `networks` line. A bare word that is not a kind, and a `name:` that is not a field, are skipped rather than obeyed. */
function parseLine(value: unknown): Line | undefined {
  const parts = splitLine(value);
  if (!parts) return;
  const line: Line = { key: parts[0] };
  for (const [, name, quoted, bare] of parts[1].matchAll(FIELD)) {
    const v = quoted ?? bare;
    if (name === "label") line.label = v;
    else if (name === "icon") line.icon = v;
    else if (!name && KINDS.has(v)) line.kind = v as Kind;
  }
  return line;
}

/** The last old lists seen, so their deprecation is logged once per change rather than every render. */
let legacySeen: string | undefined;

/** The table: `networks` first, then the old `ssid_labels` and `network_icons` lists folded in as label-only and icon-only lines, so a `networks` line wins. */
function table(): Line[] {
  const s = settings.get<Settings>();
  const out = (s.networks ?? []).map(parseLine).filter((l): l is Line => !!l);
  const legacy: Line[] = [];
  for (const v of s.ssid_labels ?? []) { const p = splitLine(v); if (p?.[1]) legacy.push({ key: p[0], label: p[1] }); }
  for (const v of s.network_icons ?? []) { const p = splitLine(v); if (p?.[1]) legacy.push({ key: p[0], icon: p[1] }); }
  const sig = JSON.stringify(legacy);
  if (sig !== legacySeen) {
    legacySeen = sig;
    if (legacy.length) console.error(`[network] ssid_labels and network_icons are deprecated and go away next release: put the label and icon on the network's \`networks\` line, as \`SSID = kind label:Name icon:X\` (${legacy.length} old ${legacy.length === 1 ? "entry" : "entries"} still read)`);
  }
  return out.concat(legacy);
}

/** What the table marks this network as: each field from the first line keyed on its SSID or its gateway that sets it. */
function marks(i: Iface | undefined, gateway: string | undefined): Marks {
  const out: Marks = {};
  for (const l of table()) {
    if (l.key !== i?.ssid && l.key !== gateway) continue;
    out.kind ??= l.kind; out.label ??= l.label; out.icon ??= l.icon;
  }
  return out;
}

/** The marks, with a phone's hotspot recognised by its name when no line says so. */
function classify(i: Iface | undefined, gateway: string | undefined): Marks {
  const m = marks(i, gateway);
  if (!m.kind && i?.ssid && HOTSPOT_RE.test(i.ssid)) m.kind = "hotspot";
  return m;
}

const isOpen = (i: Iface) => !!i.security && /^(none|open)$/i.test(i.security);
const signalText = (i: Iface) => i.signal === undefined ? undefined : `Signal ${i.signal}%`;

/** The link in one glyph: a marked kind first, then an open network — being told is the point — then how strong it is. */
function glyph(i: Iface, kind: Kind | undefined): string {
  if (i.kind !== "Wi-Fi") return GLYPH.wired;
  if (kind === "hotspot") return BAR_GLYPH.hotspot;
  if (kind === "public" || isOpen(i)) return BAR_GLYPH.open;
  if (i.signal === undefined) return GLYPH.wifi;
  return SIGNAL.find(([floor]) => i.signal! >= floor)![1];
}

/** Icon only: the glyph already says wired, hotspot, untrusted or how strong the link is, and the name is one hover away. */
// A glyph-only item is the core's `[bar.items."network/status"] show_title = false`, not a setting of this extension's.
const strip = (icon: string, title: string) => ({ icon, title });

/** The one interface the compact strip speaks for: default-route first. */
function active(s: Snapshot): Iface | undefined {
  return s.ifaces.find((i) => i.name === s.gateway?.dev) ?? s.ifaces.find((i) => i.kind === "Wi-Fi" && i.up) ?? s.ifaces.find((i) => i.up) ?? s.ifaces[0];
}

async function statusBar(): Promise<BarItem> {
  try {
    const { s } = await snapshot(undefined, false);
    const i = active(s);
    const { kind, label, icon: own } = classify(i, s.gateway?.ip);
    // Nothing to say about the network he is on almost all the time: gone, not
    // dimmed, so the item's mere presence is the message.
    if (kind === "hide") return { hidden: true };
    const face = (p: NetworkPopover, item: Omit<BarItem, "menu" | "click">): BarItem =>
      ({ ...item, click: "open", menu: { view: renderNetworkPopover({ ...p, interface: i && [i.name, i.kind].filter(Boolean).join(" · "), gateway: s.gateway?.ip, dns: s.dns }) } });
    if (!s.gateway) return face({ name: "Offline", kind: "offline" }, { ...strip(BAR_GLYPH.off, "Offline"), color: "red", tooltip: "No default route" });
    if (!i) return face({ name: "Connected" }, { ...strip(GLYPH.wired, "Connected"), tooltip: `Gateway ${s.gateway.ip}` });
    // The label stands in for the SSID, and on a cable for the kind, since a gateway-keyed line reaches both.
    const name = label ?? (i.kind === "Wi-Fi" ? i.ssid ?? "Wi-Fi" : i.kind ?? i.name);
    const address = i.v4[0] ?? i.v6[0];
    const badge = i.kind !== "Wi-Fi" ? "wired" as const : kind === "hotspot" ? "hotspot" as const : kind === "public" || isOpen(i) ? "public" as const : undefined;
    // A network's own glyph replaces the one that said hotspot or open, so that
    // moves into the tooltip (wired needs no word: the name is the kind there).
    const said = own && badge === "hotspot" ? "hotspot" : own && badge === "public" ? "open network" : undefined;
    // The name goes in whether or not it was relabelled: with Icon only the
    // tooltip is the one place left that can say which network this is.
    const tooltip = [i.name, name, address, said, signalText(i), `Gateway ${s.gateway.ip}`].filter(Boolean).join(" · ");
    return face({ name, kind: badge, address, signal: i.signal, security: i.security }, { ...strip(own ?? glyph(i, kind), name), tooltip });
  } catch { return { hidden: true }; }
}

async function openNetworkSettings(): Promise<Effect> {
  if (MAC) return { open: MAC_SETTINGS_URL };
  const tool = LINUX_SETTINGS.find((t) => Bun.which(t[0]));
  if (!tool) return toast("No network settings app", "None of gnome-control-center, systemsettings, nm-connection-editor is installed", "failure");
  spawnDetached(tool);
  return { hide: true };
}

/** A row's value and detail; after a restart the panel shows the restored listing before this extension has listed, so gather once more for an id not seen. */
async function lookup(id: string) {
  if (!known.has(id)) { const { s, withPublic } = await snapshot(); rows(s, withPublic); }
  return known.get(id);
}

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

export default {
  palettes: {
    network: {
      title: "Network",
      live: true,
      showDetail: true,
      placeholder: "Address, interface, DNS",
      list: async (_query, ctx) => {
        known.clear();
        const { s, withPublic } = await snapshot(ctx);
        return rows(s, withPublic);
      },
      pick: async (id, action) => {
        if (action === "settings") return openNetworkSettings();
        const value = (await lookup(id))?.value;
        return value === undefined ? toast("Row is gone", "The rows were listed again", "failure") : { copy: value };
      },
      detail: async (id) => (await lookup(id))?.detail,
    },
  },
  bar: {
    status: {
      render: statusBar,
      onOpen: openNetworkSettings,
      onAction: (action) => action === "settings" ? openNetworkSettings() : action === "addresses" ? { push: { extension: "network", palette: "network" } } : { keep: true },
    },
  },
} satisfies Extension;
