// network: both platform paths against fake tools on PATH (a temp bin dir
// of shell scripts printing canned output) and a local server standing in
// for the public IP endpoint. `PAL_NETWORK_OS` picks the path, so the Linux
// one runs on a Mac too.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Host, type CoreTable } from "../harness.ts";

const IFCONFIG = `lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
\tinet 127.0.0.1 netmask 0xff000000
\tinet6 ::1 prefixlen 128
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tether 26:9c:73:77:72:39
\tinet6 fe80::8d:1407:130e:40ad%en0 prefixlen 64 secured scopeid 0xf
\tinet 192.168.1.131 netmask 0xffffff00 broadcast 192.168.1.255
\tinet6 fde8:77b8:c7e1:7e6e:1c19:75aa:36d5:d86e prefixlen 64 autoconf secured
\tstatus: active
en5: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tether 06:ef:98:39:f6:0c
\tinet 10.0.0.7 netmask 0xffffff00 broadcast 10.0.0.255
\tstatus: active
bridge0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tether 36:4a:eb:ac:34:40
utun4: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1280
\tinet6 fe80::841b:7475:a205:65e1%utun4 prefixlen 64 scopeid 0x16
\tinet 100.67.72.103 --> 100.67.72.103 netmask 0xffffffff
\tinet6 fd7a:115c:a1e0::503b:4868 prefixlen 48
`;
const PORTS = `
Hardware Port: Wi-Fi
Device: en0
Ethernet Address: 26:9c:73:77:72:39

Hardware Port: Ethernet Adapter (en5)
Device: en5
Ethernet Address: 06:ef:98:39:f6:0c
`;
const SUMMARY = `<dictionary> {
  BSSID : <redacted>
  InterfaceType : WiFi
  SSID : Cafe Wifi
  Security : WPA2_PSK
}
`;
const ROUTE = `   route to: default
destination: default
    gateway: 192.168.1.1
  interface: en0
`;
const SCUTIL_DNS = `DNS configuration

resolver #1
  nameserver[0] : 100.100.100.100
  nameserver[1] : fd7a:115c:a1e0::53
  if_index : 22 (utun4)

resolver #2
  nameserver[0] : 192.168.1.1
  if_index : 15 (en0)
`;
const IP_ADDR = JSON.stringify([
  { ifname: "lo", link_type: "loopback", operstate: "UNKNOWN", addr_info: [{ family: "inet", local: "127.0.0.1", scope: "host" }] },
  { ifname: "wlan0", link_type: "ether", address: "aa:bb:cc:dd:ee:01", operstate: "UP", addr_info: [{ family: "inet", local: "192.168.0.42", scope: "global" }, { family: "inet6", local: "fe80::1", scope: "link" }, { family: "inet6", local: "2001:db8::42", scope: "global" }] },
  { ifname: "eth0", link_type: "ether", address: "aa:bb:cc:dd:ee:02", operstate: "DOWN", addr_info: [] },
  { ifname: "docker0", link_type: "ether", address: "aa:bb:cc:dd:ee:03", operstate: "UP", addr_info: [{ family: "inet", local: "172.17.0.1", scope: "global" }] },
]);
const IW = `phy#0
\tInterface wlan0
\t\tifindex 3
\t\ttype managed
\t\tssid Home Net
\t\tchannel 36
`;
const IP_ROUTE = JSON.stringify([{ dst: "default", gateway: "192.168.0.1", dev: "wlan0", protocol: "dhcp" }]);
const RESOLVECTL = `Global:
Link 3 (wlan0): 1.1.1.1 9.9.9.9
`;

/** Shell scripts named like the tools, printing canned text; `bun` is linked in since PATH is replaced, not extended. */
function fakeBin(tools: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "pal-net-bin-"));
  for (const [name, body] of Object.entries(tools)) {
    const p = join(dir, name);
    writeFileSync(p, `#!/bin/sh\n${body}\n`);
    chmodSync(p, 0o755);
  }
  return dir;
}
const heredoc = (text: string) => `/bin/cat <<'PAL_EOF'\n${text}PAL_EOF`;

/** The public IP endpoint: counts hits; `/json` is ipinfo's shape, `/text` a bare address, `/fail` a 500, `/junk` a body that is neither. */
let hits = 0;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    hits++;
    const path = new URL(req.url).pathname;
    if (path === "/json") return Response.json({ ip: "203.0.113.9", city: "Istanbul", region: "Istanbul", country: "TR", org: "AS1 Example ISP" });
    if (path === "/text") return new Response("198.51.100.4\n");
    if (path === "/junk") return new Response("<html>nope</html>");
    return new Response("boom", { status: 500 });
  },
});
const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;

const dirs: string[] = [];
afterAll(() => { server.stop(true); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const withPath = async (bin: string, os: string, extraEnv: Record<string, string>, settings: Record<string, unknown>, core?: CoreTable): Promise<Host> => {
  const saved = { ...process.env };
  // Only the fakes and bun itself: a real `tailscale` or `systemsettings` on the box would be found otherwise (marko has both).
  process.env.PATH = `${bin}:${dirname(process.execPath)}`;
  process.env.PAL_NETWORK_OS = os;
  Object.assign(process.env, extraEnv);
  try { return await Host.bundled({ settings: { network: { settings } }, core }); }
  finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
};

describe("network on macOS tools", () => {
  let host: Host;
  beforeAll(async () => {
    const bin = fakeBin({
      ifconfig: heredoc(IFCONFIG),
      networksetup: heredoc(PORTS),
      ipconfig: `[ "$1 $2" = "getsummary en0" ] || exit 1\n${heredoc(SUMMARY)}`,
      route: heredoc(ROUTE),
      scutil: `case "$1" in --dns) ${heredoc(SCUTIL_DNS)}\n;; --get) echo fakehost;; esac`,
      tailscale: `[ "$1" = ip ] && printf '100.67.72.103\\nfd7a:115c:a1e0::503b:4868\\n'`,
    });
    dirs.push(bin);
    host = await withPath(bin, "darwin", {}, { public_ip_url: url("/json"), ssid_labels: ["Cafe Wifi = Cafe"] });
  });
  afterAll(() => host.kill());
  const list = (ctx?: { refresh?: boolean }) => host.list("network", "network", undefined, ctx);

  test("meta: live with a minute's ttl, opens with the detail pane, lazy detail", () => {
    const loaded = host.loaded().find((l) => l.extension === "network")!;
    expect(loaded.palettes).toEqual([{ name: "network", title: "Network", live: true, input: false, icon: tile("cyan", "\u{f0317}"), showDetail: true, placeholder: "Address, interface, DNS", detail: "lazy", ttl: 60 }]);
    expect(loaded.bar).toMatchObject([{ id: "status", title: "Network status", refresh: { every: 5, on: ["network", "wake"] }, mocks: { offline: { item: { color: "red" } } }, source: true }]);
  });

  test("bar: uses a friendly SSID label and opens Network Settings directly", async () => {
    expect(await host.render("network", "status")).toMatchObject({ icon: "\u{f05a9}", title: "Cafe", tooltip: "en0 · Cafe · 192.168.1.131 · Gateway 192.168.1.1", click: "open", menu: { view: { title: "Connection", id: "network" } } });
    expect(await host.request<any>("bar/open", { extension: "network", id: "status" })).toEqual({ open: "x-apple.systempreferences:com.apple.Network-Settings.extension" });
  });

  test("rows: the value is the name, the label the subtitle, three sections; the tunnel carrying the Tailscale addresses is folded into the Tailscale rows", async () => {
    const items = await list();
    expect(items.map((i) => [i.id, i.name, i.subtitle, i.section])).toEqual([
      ["if:en0:192.168.1.131", "192.168.1.131", "en0 · Wi-Fi · Cafe Wifi", "This machine"],
      ["if:en0:fde8:77b8:c7e1:7e6e:1c19:75aa:36d5:d86e", "fde8:77b8:c7e1:7e6e:1c19:75aa:36d5:d86e", "en0 · Wi-Fi · Cafe Wifi · IPv6", "This machine"],
      ["if:en5:10.0.0.7", "10.0.0.7", "en5 · Ethernet Adapter (en5)", "This machine"],
      ["tailscale:100.67.72.103", "100.67.72.103", "Tailscale", "This machine"],
      ["tailscale:fd7a:115c:a1e0::503b:4868", "fd7a:115c:a1e0::503b:4868", "Tailscale · IPv6", "This machine"],
      ["hostname", hostname(), "Hostname", "This machine"],
      ["localhostname", "fakehost.local", "Local hostname (Bonjour)", "This machine"],
      ["public", "203.0.113.9", "Public IP · Istanbul, TR · AS1 Example ISP", "Internet"],
      ["gateway", "192.168.1.1", "Gateway · en0", "Network"],
      ["dns:100.100.100.100", "100.100.100.100", "DNS 1", "Network"],
      ["dns:fd7a:115c:a1e0::53", "fd7a:115c:a1e0::53", "DNS 2", "Network"],
      ["dns:192.168.1.1", "192.168.1.1", "DNS 3", "Network"],
    ]);
    const wifi = items[0];
    // Each row carries its kind's glyph: Wi-Fi, Ethernet, Tailscale, hostname, public IP, gateway, DNS.
    expect(items.map((i) => i.icon)).toEqual(["\u{f05a9}", "\u{f05a9}", "\u{f0200}", "\u{f0582}", "\u{f0582}", "\u{f0322}", "\u{f0322}", "\u{f01e7}", "\u{f1087}", "\u{f01d6}", "\u{f01d6}", "\u{f01d6}"]);
    expect(wifi.keywords).toEqual(["en0", "wifi", "wlan", "ssid", "ip", "lan", "local", "Cafe Wifi"]);
    expect(wifi.actions).toEqual([{ id: "copy", title: "Copy" }, { id: "settings", title: "Open Network settings" }]);
    expect(items[7].keywords).toEqual(["public", "wan", "external", "ip", "TR", "AS1 Example ISP"]);
    expect(items[9].keywords).toEqual(["dns", "nameserver", "resolver"]);
  });

  test("Enter copies the value; Open Network settings opens the System Settings pane", async () => {
    expect(await host.pick("network", "network", "if:en0:192.168.1.131")).toEqual({ copy: "192.168.1.131" });
    expect(await host.pick("network", "network", "public", "copy")).toEqual({ copy: "203.0.113.9" });
    expect(await host.pick("network", "network", "hostname")).toEqual({ copy: hostname() });
    expect(await host.pick("network", "network", "dns:fd7a:115c:a1e0::53")).toEqual({ copy: "fd7a:115c:a1e0::53" });
    expect(await host.pick("network", "network", "gateway", "settings")).toEqual({ open: "x-apple.systempreferences:com.apple.Network-Settings.extension" });
    expect(await host.pick("network", "network", "if:en9:1.2.3.4")).toEqual({ keep: true, toast: { title: "Row is gone", message: "The rows were listed again", style: "failure" } });
  });

  test("detail: every field of the interface, the public lookup, the gateway, a DNS server", async () => {
    expect(await host.detail("network", "network", "if:en0:192.168.1.131")).toEqual({
      metadata: [{ label: "Interface", value: "en0" }, { label: "Kind", value: "Wi-Fi" }, { label: "SSID", value: "Cafe Wifi" }, { label: "Security", value: "WPA2_PSK" }, { label: "IPv4", value: "192.168.1.131" }, { label: "IPv6", value: "fde8:77b8:c7e1:7e6e:1c19:75aa:36d5:d86e" }, { label: "MAC", value: "26:9c:73:77:72:39" }, { label: "Status", value: "active" }],
    });
    const pub = await host.detail("network", "network", "public");
    expect(pub.metadata!.slice(0, 5)).toEqual([{ label: "Public IP", value: "203.0.113.9" }, { label: "City", value: "Istanbul" }, { label: "Region", value: "Istanbul" }, { label: "Country", value: "TR" }, { label: "Organisation", value: "AS1 Example ISP" }]);
    expect(pub.metadata![5].label).toBe("Fetched");
    expect(await host.detail("network", "network", "gateway")).toEqual({ metadata: [{ label: "Gateway", value: "192.168.1.1" }, { label: "Interface", value: "en0" }] });
    expect(await host.detail("network", "network", "dns:192.168.1.1")).toEqual({ metadata: [{ label: "DNS server", value: "192.168.1.1" }, { label: "Order", value: "3" }, { label: "All", value: "100.100.100.100, fd7a:115c:a1e0::53, 192.168.1.1" }] });
    expect(await host.detail("network", "network", "tailscale:100.67.72.103")).toEqual({ metadata: [{ label: "Tailscale IPv4", value: "100.67.72.103" }, { label: "Tailscale IPv6", value: "fd7a:115c:a1e0::503b:4868" }] });
  });

  test("the public IP is fetched once and kept; the shell's refresh fetches again; a bare-text endpoint works; a failing one is an inert row; an empty url drops the section", async () => {
    const before = hits;
    await list();
    await list();
    expect(hits).toBe(before);
    await list({ refresh: true });
    expect(hits).toBe(before + 1);
    host.changeSettings("network", { settings: { public_ip_url: url("/text") } });
    expect((await list()).find((i) => i.section === "Internet")).toMatchObject({ id: "public", name: "198.51.100.4", subtitle: "Public IP" });
    host.changeSettings("network", { settings: { public_ip_url: url("/fail") } });
    expect((await list()).find((i) => i.section === "Internet")).toMatchObject({ id: "hint:public:none", name: "Public IP unavailable", subtitle: `500 from 127.0.0.1:${server.port}; cmd+r tries again`, actions: [] });
    host.changeSettings("network", { settings: { public_ip_url: url("/junk") } });
    expect((await list()).find((i) => i.section === "Internet")).toMatchObject({ id: "hint:public:none", subtitle: "not an address; cmd+r tries again" });
    host.changeSettings("network", { settings: { public_ip_url: "" } });
    expect((await list()).some((i) => i.section === "Internet")).toBe(false);
    // A failure is not cached: the next listing with a good url fetches.
    host.changeSettings("network", { settings: { public_ip_url: url("/json") } });
    const n = hits;
    expect((await list()).find((i) => i.id === "public")).toBeDefined();
    expect(hits).toBe(n + 1);
  });
});

describe("network on macOS with the SSID redacted", () => {
  const fakes = (core?: CoreTable) => {
    const bin = fakeBin({
      ifconfig: heredoc(IFCONFIG),
      networksetup: heredoc(PORTS),
      ipconfig: heredoc(SUMMARY.replace("SSID : Cafe Wifi", "SSID : <redacted>")),
      route: heredoc(ROUTE),
      scutil: `case "$1" in --dns) ${heredoc(SCUTIL_DNS)}\n;; --get) echo fakehost;; esac`,
    });
    dirs.push(bin);
    return withPath(bin, "darwin", {}, { public_ip_url: "" }, core);
  };
  test("the core's in-process name stands in (pal's Location grant does not reach ipconfig); without one the row says what is missing", async () => {
    const granted = await fakes({ "wifi.status": () => ({ interface: "en0", powered: true, current: { ssid: "Cafe Wifi", signal: 90, channel: "44", security: "WPA2 Personal", ip: "192.168.1.131" } }) });
    try {
      const wifi = (await granted.list("network", "network"))[0];
      expect(wifi).toMatchObject({ id: "if:en0:192.168.1.131", subtitle: "en0 · Wi-Fi · Cafe Wifi" });
      expect(granted.coreCalls.some((c) => c.method === "wifi.status")).toBe(true);
    } finally { granted.kill(); }
    const none = await fakes({ "wifi.status": () => ({ interface: "en0", powered: true, current: { ssid: null, signal: null, channel: "44", security: "WPA2_PSK", ip: "192.168.1.131" } }) });
    try {
      const wifi = (await none.list("network", "network"))[0];
      expect(wifi.subtitle).toBe("en0 · Wi-Fi");
      const d = await none.detail("network", "network", wifi.id);
      expect(d.metadata).toContainEqual({ label: "SSID", value: "hidden by macOS until pal has Location access (the Wi-Fi palette asks)" });
    } finally { none.kill(); }
  });
});

describe("network status: what the strip says about the network", () => {
  const boot = (settings: Record<string, unknown>, opts: { ssid?: string; security?: string; signal?: number | null; route?: boolean } = {}) => {
    const summary = SUMMARY.replace("SSID : Cafe Wifi", `SSID : ${opts.ssid ?? "Cafe Wifi"}`).replace("Security : WPA2_PSK", `Security : ${opts.security ?? "WPA2_PSK"}`);
    const bin = fakeBin({
      ifconfig: heredoc(IFCONFIG),
      networksetup: heredoc(PORTS),
      ipconfig: heredoc(summary),
      route: opts.route === false ? "exit 1" : heredoc(ROUTE),
      scutil: `case "$1" in --dns) ${heredoc(SCUTIL_DNS)}\n;; --get) echo fakehost;; esac`,
    });
    dirs.push(bin);
    return withPath(bin, "darwin", {}, { public_ip_url: "", ...settings }, { "wifi.status": () => ({ interface: "en0", powered: true, current: { ssid: opts.ssid ?? "Cafe Wifi", signal: opts.signal === undefined ? 72 : opts.signal, channel: "44", security: opts.security ?? "WPA2 Personal", ip: "192.168.1.131" } }) });
  };
  const bar = async (settings: Record<string, unknown>, opts?: Parameters<typeof boot>[1]) => {
    const host = await boot(settings, opts);
    try { return await host.render("network", "status"); } finally { host.kill(); }
  };

  test("the signal picks the glyph, and the tooltip carries the number", async () => {
    expect(await bar({})).toMatchObject({ icon: "\u{f0925}", title: "Cafe Wifi", tooltip: "en0 · Cafe Wifi · 192.168.1.131 · Signal 72% · Gateway 192.168.1.1" });
    expect(await bar({}, { signal: 94 })).toMatchObject({ icon: "\u{f0928}" });
    expect(await bar({}, { signal: 55 })).toMatchObject({ icon: "\u{f0922}" });
    expect(await bar({}, { signal: 20 })).toMatchObject({ icon: "\u{f091f}" });
    // No reading at all is not a weak one: the plain glyph rather than one bar.
    expect(await bar({}, { signal: null })).toMatchObject({ icon: "\u{f05a9}" });
  }, 20000);

  test("a network marked hide draws nothing, by its name or by its gateway", async () => {
    expect(await bar({ networks: ["Cafe Wifi = hide"] })).toEqual({ hidden: true });
    // The gateway is the half that still works when macOS redacts the name.
    expect(await bar({ networks: ["192.168.1.1 = hide"] }, { ssid: "<redacted>" })).toEqual({ hidden: true });
    expect(await bar({ networks: ["elsewhere = hide"] })).toMatchObject({ title: "Cafe Wifi" });
  }, 20000);

  test("hotspot and open networks get their own glyph; a phone's name is recognised without configuring it", async () => {
    expect(await bar({ networks: ["Cafe Wifi = hotspot"] })).toMatchObject({ icon: "\u{f011c}" });
    expect(await bar({ networks: ["Cafe Wifi = public"] })).toMatchObject({ icon: "\u{f0176}" });
    expect(await bar({}, { ssid: "Nazli's iPhone" })).toMatchObject({ icon: "\u{f011c}", title: "Nazli's iPhone" });
    // Nothing configured, but an unsecured network is worth saying so on its own.
    expect(await bar({}, { security: "NONE" })).toMatchObject({ icon: "\u{f0176}" });
    // A kind that is not one of the three is ignored rather than obeyed.
    expect(await bar({ networks: ["Cafe Wifi = nonsense"] })).toMatchObject({ icon: "\u{f0925}" });
  }, 20000);

  test("icon only drops the title from every state, and keeps the tooltip that now carries the name", async () => {
    const wifi = await bar({ icon_only: true });
    expect(wifi.title).toBeUndefined();
    expect(wifi).toMatchObject({ icon: "\u{f0925}", tooltip: "en0 · Cafe Wifi · 192.168.1.131 · Signal 72% · Gateway 192.168.1.1" });
    const offline = await bar({ icon_only: true }, { route: false });
    expect(offline.title).toBeUndefined();
    expect(offline).toMatchObject({ icon: "\u{f092d}", color: "red" });
    expect(await bar({}, { route: false })).toMatchObject({ icon: "\u{f092d}", title: "Offline", color: "red" });
  }, 20000);

  test("the popover answers what this link is, not what every address is", async () => {
    const host = await boot({});
    try {
      const view = (await host.render("network", "status") as any).menu.view;
      expect(view.title).toBe("Connection");
      const kv = Object.fromEntries(view.tree.children.filter((c: any) => c.type === "stack" && c.key !== "head" && c.key !== "footer").map((c: any) => [c.key, c.children[1].value]));
      // Strength and what secures it share a row: both answer "how good is this link".
      expect(kv).toEqual({ interface: "en0 · Wi-Fi", ip: "192.168.1.131", gateway: "192.168.1.1", signal: "72% · WPA2_PSK", dns: "100.100.100.100, fd7a:115c:a1e0::53, 192.168.1.1" });
      expect(view.tree.children[0].children[2]).toMatchObject({ type: "badge", text: "connected" });
      expect(view.actions.map((a: any) => a.id)).toEqual(["settings", "addresses"]);
      // The address book is still one key away rather than gone.
      expect(await host.request("bar/action", { extension: "network", id: "status", action: "addresses" })).toEqual({ push: { extension: "network", palette: "network" } });
      expect(await host.request("bar/action", { extension: "network", id: "status", action: "settings" })).toEqual({ open: "x-apple.systempreferences:com.apple.Network-Settings.extension" });
    } finally { host.kill(); }
  }, 20000);

  test("the badge names the kind, and offline says so with no rows to show", async () => {
    const hotspot = (await bar({ networks: ["Cafe Wifi = hotspot"] }) as any).menu.view;
    expect(hotspot.tree.children[0].children[2]).toMatchObject({ text: "hotspot", color: "amber" });
    const offline = (await bar({}, { route: false }) as any).menu.view;
    expect(offline.tree.children[0]).toMatchObject({ children: [{ value: "Offline" }, { type: "spacer" }, { text: "no route", color: "red" }] });
    expect(offline.tree.children.some((c: any) => c.key === "gateway")).toBe(false);
  }, 20000);
});

describe("network on Linux tools", () => {
  let host: Host;
  beforeAll(async () => {
    const bin = fakeBin({
      ip: `case "$*" in "-j addr") ${heredoc(IP_ADDR + "\n")}\n;; "-j route show default") ${heredoc(IP_ROUTE + "\n")}\n;; *) exit 1;; esac`,
      iw: heredoc(IW),
      resolvectl: `[ "$1" = dns ] && ${heredoc(RESOLVECTL)}`,
    });
    dirs.push(bin);
    const etc = mkdtempSync(join(tmpdir(), "pal-net-etc-"));
    dirs.push(etc);
    writeFileSync(join(etc, "resolv.conf"), "# stub\nnameserver 127.0.0.53\noptions edns0\n");
    host = await withPath(bin, "linux", { PAL_NETWORK_RESOLV: join(etc, "resolv.conf") }, { public_ip_url: "" });
  });
  afterAll(() => host.kill());

  test("rows from ip -j addr (loopback and link-local dropped, an interface without addresses too), the SSID from iw dev, the gateway from ip -j route, the upstreams from resolvectl behind the stub; no Tailscale without the CLI", async () => {
    const items = await host.list("network", "network");
    expect(items.map((i) => [i.id, i.name, i.subtitle, i.section])).toEqual([
      ["if:wlan0:192.168.0.42", "192.168.0.42", "wlan0 · Wi-Fi · Home Net", "This machine"],
      ["if:wlan0:2001:db8::42", "2001:db8::42", "wlan0 · Wi-Fi · Home Net · IPv6", "This machine"],
      ["if:docker0:172.17.0.1", "172.17.0.1", "docker0", "This machine"],
      ["hostname", hostname(), "Hostname", "This machine"],
      ["gateway", "192.168.0.1", "Gateway · wlan0", "Network"],
      ["dns:1.1.1.1", "1.1.1.1", "DNS 1", "Network"],
      ["dns:9.9.9.9", "9.9.9.9", "DNS 2", "Network"],
    ]);
    expect(await host.detail("network", "network", "if:wlan0:192.168.0.42")).toEqual({
      metadata: [{ label: "Interface", value: "wlan0" }, { label: "Kind", value: "Wi-Fi" }, { label: "SSID", value: "Home Net" }, { label: "IPv4", value: "192.168.0.42" }, { label: "IPv6", value: "2001:db8::42" }, { label: "MAC", value: "aa:bb:cc:dd:ee:01" }, { label: "Status", value: "active" }],
    });
    expect(await host.detail("network", "network", "hostname")).toEqual({ metadata: [{ label: "Hostname", value: hostname() }] });
  });

  test("a pick before any listing gathers on its own; the settings action reports when no settings app is installed", async () => {
    const fresh = await withPath(dirs[dirs.length - 2], "linux", { PAL_NETWORK_RESOLV: join(dirs[dirs.length - 1], "resolv.conf") }, { public_ip_url: "" });
    expect(await fresh.pick("network", "network", "gateway")).toEqual({ copy: "192.168.0.1" });
    expect(await fresh.detail("network", "network", "dns:9.9.9.9")).toEqual({ metadata: [{ label: "DNS server", value: "9.9.9.9" }, { label: "Order", value: "2" }, { label: "All", value: "1.1.1.1, 9.9.9.9" }] });
    fresh.kill();
    expect(await host.pick("network", "network", "gateway", "settings")).toEqual({ keep: true, toast: { title: "No network settings app", message: "None of gnome-control-center, systemsettings, nm-connection-editor is installed", style: "failure" } });
  });
});
