// Writes app/src/gallery/shots/bar-network.json, the store screenshots'
// fixture for the status item: the item and its popover drawn through the
// host harness on the macOS path (`PAL_NETWORK_OS=darwin`) against
// stand-in `ifconfig`, `networksetup`, `route`, `scutil` and `ipconfig`
// that print what `net` below holds, and a canned `core/wifi.status` for
// the signal. Made-up networks: home Wi-Fi labelled by a `networks`
// line, then an open café network. A stand-in `tailscale` answers
// nothing, so the machine's own is never run. The panel fixture
// (network.json) is written by hand: its hostname row would otherwise be
// this machine's.
// `bun run extensions/network/fixture.ts`, then `make shots EXT=network`.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host, writeTool } from "../../host/test/harness.ts";

type Net = { ssid: string; security: string; signal: number; ip: string; gateway: string; dns: string[] };
const HOME: Net = { ssid: "Home-5G", security: "WPA2_PSK", signal: 72, ip: "192.168.1.42", gateway: "192.168.1.1", dns: ["192.168.1.1", "1.1.1.1"] };
const CAFE: Net = { ssid: "Cafe Guest", security: "OPEN", signal: 61, ip: "10.0.1.44", gateway: "10.0.1.1", dns: ["10.0.1.1"] };

/** What each tool prints for `n`, in the shapes the macOS tools print (host/test/extensions/network.test.ts has the real ones). */
const outputs = (n: Net): Record<string, string> => ({
  ifconfig: `lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384\n\tinet 127.0.0.1 netmask 0xff000000\nen0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500\n\tether 3a:1f:6c:02:9d:e4\n\tinet ${n.ip} netmask 0xffffff00\n\tstatus: active\n`,
  networksetup: "Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: 3a:1f:6c:02:9d:e4\n",
  route: `   route to: default\ndestination: default\n    gateway: ${n.gateway}\n  interface: en0\n`,
  "scutil-dns": `DNS configuration\n\nresolver #1\n${n.dns.map((d, i) => `  nameserver[${i}] : ${d}\n`).join("")}  if_index : 15 (en0)\n`,
  "scutil-name": "macbook\n",
  ipconfig: `<dictionary> {\n  InterfaceType : WiFi\n  SSID : ${n.ssid}\n  Security : ${n.security}\n}\n`,
});

pinClock();
const dir = mkdtempSync(join(tmpdir(), "pal-network-fixture-"));
const bin = join(dir, "bin"), out = join(dir, "out");
const stage = (n: Net) => { for (const [k, v] of Object.entries(outputs(n))) writeFileSync(`${out}-${k}`, v); };
const cat = (k: string) => `/bin/cat '${out}-${k}'`;
for (const t of ["ifconfig", "networksetup", "route", "ipconfig"]) writeTool(join(bin, t), `#!/bin/sh\n${cat(t)}\n`);
writeTool(join(bin, "scutil"), `#!/bin/sh\nif [ "$1" = "--dns" ]; then ${cat("scutil-dns")}; else ${cat("scutil-name")}; fi\n`);
writeTool(join(bin, "tailscale"), "#!/bin/sh\n");

let net = HOME;
stage(net);
const saved = { ...process.env };
// Only the stand-ins and bun itself, so no real tool on the box answers.
process.env.PATH = `${bin}:${dirname(process.execPath)}`;
process.env.PAL_NETWORK_OS = "darwin";
const host = await Host.bundled({
  settings: { network: { settings: { networks: ["Home-5G = label:Home"] } } },
  core: { "wifi.status": () => ({ current: { ssid: net.ssid, signal: net.signal } }) },
});
process.env = saved;
try {
  const item = await host.render("network", "status");
  net = CAFE;
  stage(net);
  const cafe = await host.render("network", "status");
  writeFixture("bar-network", {
    key: "network/status",
    title: "Network status",
    item,
    states: [{ id: "open", item: cafe }],
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar: the signal as a Wi-Fi glyph and the network's name, or the label you gave it" },
      "menubar-open": { target: "menubar", state: "open", caption: "On an open network the glyph turns into a coffee cup, so you know before you type a password" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the connection, interface, address, gateway, signal and DNS, with keys for settings and all addresses" },
      "popover-open": { target: "menubar", popover: true, state: "open", caption: "An open café network, flagged amber as open in the popover" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the Wi-Fi glyph and the network's label" },
    },
  });
  console.log("bar-network.json: home Wi-Fi labelled Home, an open café network");
} finally {
  host.kill();
  rmSync(dir, { recursive: true, force: true });
}
