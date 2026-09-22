// dpi: the status model on canned `dpi status` output from both platforms,
// the test's targets and summary, the two views through `checkView`; then
// the extension in the host against a fake `dpi` on PATH that logs its
// argv and prints canned output (a state file says on or off), a fake
// `curl` that answers a code per host, and, for Linux, a fake `sudo` whose
// answer a file decides.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { tile } from "../../../sdk/src/icon.ts";
import { checkIcon, checkLinks, checkPalettes, checkView } from "../../../sdk/src/index.ts";
import type { Item, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { barItem, hudLine } from "../../../extensions/dpi/index.ts";
import { factLines, judge, parseLinux, parseMac, parseStatus, summary } from "../../../extensions/dpi/status.ts";
import { curlArgv, parseTargets, summary as testSummary, type Result } from "../../../extensions/dpi/test.ts";
import { renderPopover, renderTest } from "../../../extensions/dpi/view.ts";
import manifest from "../../../extensions/dpi/pal.json" with { type: "json" };
import ext from "../../../extensions/dpi/index.ts";
import { Host } from "../harness.ts";

const MAC_ON = "proxy   : up (pid 4242, :1080)\nservice : Wi-Fi\ndns     : 1.1.1.1 9.9.9.9 \nsocks   : 127.0.0.1:1080\n";
const MAC_OFF = "proxy   : down\nservice : Wi-Fi\ndns     : There aren't any DNS Servers set on Wi-Fi. \nsocks   : off\n";
const MAC_HALF = "proxy   : up (pid 4242, :1080)\nservice : Wi-Fi\ndns     : There aren't any DNS Servers set on Wi-Fi. \nsocks   : off\n";
const MAC_LEFT = "proxy   : down\nservice : Ethernet\ndns     : 1.1.1.1 9.9.9.9 \nsocks   : 127.0.0.1:1080\n";
const LINUX_ON = "zapret               active\ndnscrypt-proxy       active\n\nDNS                  66.254.114.41\n";
const LINUX_OFF = "zapret               inactive\ndnscrypt-proxy       inactive\n\nDNS                  195.175.254.2\n";
const LINUX_HALF = "zapret               active\ndnscrypt-proxy       failed\n\nDNS                  195.175.254.2\n";
const LINUX_HIJACKED = "zapret               active\ndnscrypt-proxy       active\n\nDNS                  195.175.254.2\n";

const flat = (n: ViewNode): ViewNode[] => [n, ...("children" in n && n.children ? n.children.flatMap(flat) : [])];
const texts = (v: View) => flat(v.tree).filter((n) => n.type === "text").map((n) => (n as { value: string }).value);
const badges = (v: View) => flat(v.tree).filter((n) => n.type === "badge").map((n) => (n as { text: string; color?: string }).text);

describe("the status model", () => {
  test("macOS: the four lines as facts; on, off, and the two halves", () => {
    expect(parseMac(MAC_ON)).toEqual({ platform: "macos", proxy: { up: true, pid: 4242, port: 1080 }, service: "Wi-Fi", dns: ["1.1.1.1", "9.9.9.9"], socks: "127.0.0.1:1080" });
    expect(parseMac(MAC_OFF)).toEqual({ platform: "macos", proxy: { up: false }, service: "Wi-Fi", dns: [], socks: null });
    expect(parseStatus(MAC_ON, "macos")).toMatchObject({ state: "on", port: 1080 });
    expect(parseStatus(MAC_OFF, "macos")).toMatchObject({ state: "off", port: 1080 });
    expect(parseStatus(MAC_HALF, "macos")).toMatchObject({ state: "partial", reason: "Proxy up (pid 4242), but SOCKS off and DNS not overridden" });
    expect(parseStatus(MAC_LEFT, "macos")).toMatchObject({ state: "partial", reason: "SOCKS on, DNS overridden, but proxy down" });
    // The port is the script's line, not a constant.
    expect(parseStatus(MAC_ON.replace(":1080", ":1081").replace("127.0.0.1:1080", "127.0.0.1:1081"), "macos")).toMatchObject({ state: "on", port: 1081 });
    expect(parseStatus(MAC_ON.replace(":1080)", ":1081)"), "macos")).toMatchObject({ state: "partial", reason: "Proxy up (pid 4242), DNS overridden, but SOCKS at 127.0.0.1:1080" });
    // Another override, and no override at all.
    expect(judge(parseMac(MAC_ON)!, ["8.8.8.8"])).toMatchObject({ state: "partial", reason: "Proxy up (pid 4242), SOCKS on, but DNS at 1.1.1.1 9.9.9.9" });
    expect(judge(parseMac(MAC_HALF)!, [])).toMatchObject({ state: "partial", reason: "Proxy up (pid 4242), but SOCKS off" });
    expect(() => parseStatus("dpi: no default route\n", "macos")).toThrow("unexpected status output: dpi: no default route");
  });
  test("Linux: the units and the probe; both up is on unless the resolver still answers the block page", () => {
    expect(parseLinux(LINUX_ON)).toEqual({ platform: "linux", services: [{ name: "zapret", state: "active" }, { name: "dnscrypt-proxy", state: "active" }], probe: "66.254.114.41" });
    expect(parseStatus(LINUX_ON, "linux")).toMatchObject({ state: "on" });
    expect(parseStatus(LINUX_OFF, "linux")).toMatchObject({ state: "off" });
    expect(parseStatus(LINUX_HALF, "linux")).toMatchObject({ state: "partial", reason: "Zapret up, but dnscrypt-proxy failed" });
    expect(parseStatus(LINUX_HIJACKED, "linux")).toMatchObject({ state: "partial", reason: "zapret up, dnscrypt-proxy up, but DNS still answers the block page" });
    expect(parseLinux("nothing here")).toBeUndefined();
  });
  test("the summary line and the fact lines", () => {
    expect(summary(parseStatus(MAC_ON, "macos"))).toBe("Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9");
    expect(summary(parseStatus(MAC_OFF, "macos"))).toBe("Wi-Fi as before, byedpi down");
    expect(summary(parseStatus(LINUX_ON, "linux"))).toBe("zapret + dnscrypt-proxy up, resolver -> 127.0.0.1");
    expect(factLines(parseStatus(MAC_OFF, "macos"))).toEqual([["Proxy", "down"], ["Service", "Wi-Fi"], ["DNS", "not set (the ISP's)"], ["SOCKS", "off"]]);
    expect(factLines(parseStatus(LINUX_OFF, "linux")).at(-1)).toEqual(["DNS probe", "195.175.254.2 (the block page)"]);
  });
  test("the HUD's line is the script's last line, its spacing collapsed", () => {
    expect(hudLine("proxy already up\ndpi on  (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)\n", "dpi on")).toBe("dpi on (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)");
    expect(hudLine("\n\n", "dpi off")).toBe("dpi off");
  });
});

describe("the test", () => {
  test("targets: a role after `=`, else the position (two blocked lead); junk dropped", () => {
    expect(parseTargets(["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/ = blocked", "  https://e.com/ = Control ", "", "not a url", "https://f.com/ = maybe"])).toEqual([
      { url: "https://a.com/", role: "blocked" }, { url: "https://b.com/", role: "blocked" }, { url: "https://c.com/", role: "control" }, { url: "https://d.com/", role: "blocked" }, { url: "https://e.com/", role: "control" },
    ]);
  });
  test("the summary: pending, all good, a blocked site still blocked (red), a control broken (amber)", () => {
    const rows = (codes: (string | undefined)[]): Result[] => codes.map((code, i) => ({ url: `https://s${i}.com/`, role: i < 2 ? "blocked" : "control", code, ms: 400 }));
    expect(testSummary(rows(["200", undefined, "200", "301"]))).toEqual({ text: "Testing 4 urls, 3 in…", color: "grey" });
    expect(testSummary(rows(["200", "301", "200", "403"]))).toEqual({ text: "2 blocked reach, 2 controls fine", color: "green" });
    expect(testSummary(rows(["200", "000", "200", "200"]))).toEqual({ text: "1 of 2 blocked reach (s1.com blocked), 2 controls fine", color: "red" });
    expect(testSummary(rows(["200", "200", "000", "200"]))).toEqual({ text: "2 blocked reach, 1 of 2 controls fine (s2.com broken)", color: "amber" });
    expect(testSummary([])).toEqual({ text: "Nothing to test", color: "green" });
  });
  test("curl keeps the script's shape: silent, the code and the time, 12 s, the proxy only when there is one", () => {
    expect(curlArgv("https://discord.com/", "127.0.0.1:1080").slice(1)).toEqual(["-s", "-o", "/dev/null", "-w", "%{http_code} %{time_total}", "--max-time", "12", "-x", "socks5h://127.0.0.1:1080", "https://discord.com/"]);
    expect(curlArgv("https://discord.com/", null)).not.toContain("-x");
  });
});

describe("the views", () => {
  const on = parseStatus(MAC_ON, "macos"), half = parseStatus(MAC_HALF, "macos");
  test("the popover: the card with the facts, Enter turns off while on, `r` only while partial; the missing tool is one line", () => {
    const v = renderPopover({ status: on, mac: true });
    expect(() => checkView(v, "dpi")).not.toThrow();
    expect(v.title).toBe("Bypass on");
    expect(v.actions[0]).toEqual({ id: "toggle", title: "Turn off bypass" });
    expect(v.actions.map((a) => a.shortcut)).toEqual([undefined, "t", "r", "c", "l", "o"]);
    expect(texts(v)).toEqual(expect.arrayContaining(["Bypass on", "Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9", "up (pid 4242, :1080)", "127.0.0.1:1080"]));
    expect(texts(v)).not.toContain("repair");
    expect(texts(renderPopover({ status: half, mac: false }))).toContain("repair");
    expect(renderPopover({ status: half, mac: false }).actions.map((a) => a.shortcut)).toEqual([undefined, "t", "r", "c", "o"]);
    const none = renderPopover({ status: null, error: "dpi is not installed", mac: true });
    expect(none.actions).toEqual([{ id: "open", title: "Open the DPI Bypass palette", shortcut: "o" }]);
    expect(texts(none)).toContain("dpi is not installed");
  });
  test("the test level: the header, a row per url with the code badge, the cursor ring, Enter opens the row's host", () => {
    const run = { targets: parseTargets(["https://discord.com/", "https://example.com/"]), results: [{ url: "https://discord.com/", role: "blocked" as const, code: "200", ms: 412 }, { url: "https://example.com/", role: "control" as const }], proxy: "127.0.0.1:1080", startedAt: 0 };
    const v = renderTest({ run, cursor: 1 });
    expect(() => checkView(v, "dpi")).not.toThrow();
    expect(v.title).toBe("Testing the bypass…");
    expect(badges(v)).toEqual(["Testing 2 urls, 1 in…", "blocked", "200", "control", "…"]);
    expect(texts(v)).toEqual(expect.arrayContaining(["via socks5://127.0.0.1:1080", "0.4 s", "example.com"]));
    expect(flat(v.tree).filter((n) => n.selected).map((n) => n.key)).toEqual(["r-1"]);
    expect(v.actions[0]).toEqual({ id: "open", title: "Open example.com" });
    expect(v.actions.map((a) => a.shortcut)).toEqual([undefined, "c", "cmd+c", "cmd+r", ["down", "j"], ["up", "k"], undefined, undefined]);
    const done = renderTest({ run: { ...run, endedAt: 1, results: run.results.map((r) => ({ ...r, code: "200", ms: 500 })) }, cursor: 0 });
    expect(done.title).toBe("1 blocked reach, 1 control fine");
    // The popover draws the same rows, compact, with no cursor.
    const pop = renderPopover({ status: on, mac: true, test: run });
    expect(badges(pop)).toEqual(["Testing 2 urls, 1 in…", "blocked", "200", "control", "…"]);
    expect(flat(pop.tree).some((n) => n.selected)).toBe(false);
  });
  test("the bar item: the shield by state, the facts as states, the empty shape; nothing without a status", () => {
    expect(barItem({ status: on })).toMatchObject({ icon: "\u{f0565}", tooltip: "Bypass on: Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9", states: { on: true, state: "on", service: "Wi-Fi" }, empty: { icon: "\u{f0499}" } });
    expect(barItem({ status: half })).toMatchObject({ icon: "\u{f0780}", states: { on: true, state: "partial" } });
    expect(barItem({ status: half })).not.toHaveProperty("color");
    expect(barItem({ status: parseStatus(MAC_OFF, "macos") })).toMatchObject({ icon: "\u{f0499}", states: { on: false, state: "off" } });
    expect(barItem({ status: parseStatus(LINUX_ON, "linux") })).toMatchObject({ states: { service: "zapret + dnscrypt-proxy" } });
    expect(barItem({ status: null, error: "x" })).toEqual({ hidden: true, states: { on: null, state: null, service: null } });
  });
  test("the manifest and the code agree; the mocks pass the item check", () => {
    expect(checkPalettes(manifest as never, ext).warnings).toEqual([]);
    expect(checkLinks(manifest as never, ext)).toEqual([]);
    expect(checkIcon(manifest.icon, "dpi")).toBeUndefined();
    expect(Object.keys(manifest.bar.bypass.mocks)).toEqual(["off", "on", "partial", "linux"]);
  });
});

// ---- over the wire ------------------------------------------------------------------

/** The fake tools: `dpi` reads its state from a file and logs its argv, `curl` answers a code per host from a table and sleeps per host, `sudo -n` answers what a file says. */
const dir = mkdtempSync(join(tmpdir(), "pal-dpi-"));
const bin = join(dir, "bin");
mkdirSync(bin);
const STATE = join(dir, "state"), LOG = join(dir, "log"), CODES = join(dir, "codes"), SUDO = join(dir, "sudo-ok");
const asked = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n") : []);
/** The switches the fake dpi ran: its log without the status reads and the curls. */
const cmds = () => asked().filter((l) => !/^status$|--max-time/.test(l));
const DPI_LOG = join(dir, "dpi.log");
const setState = (s: string) => writeFileSync(STATE, s);
writeFileSync(join(bin, "dpi"), `#!/bin/sh
PATH=/usr/bin:/bin:$PATH
echo "$*" >> ${JSON.stringify(LOG)}
state=$(cat ${JSON.stringify(STATE)})
os=\${PAL_DPI_FAKE_OS:-macos}
macos_status() {
  case "$state" in
    on) printf 'proxy   : up (pid 4242, :1080)\\nservice : Wi-Fi\\ndns     : 1.1.1.1 9.9.9.9 \\nsocks   : 127.0.0.1:1080\\n' ;;
    half) printf 'proxy   : up (pid 4242, :1080)\\nservice : Wi-Fi\\ndns     : There arent any DNS Servers set on Wi-Fi. \\nsocks   : off\\n' ;;
    broken) echo "dpi: no default route" >&2; exit 1 ;;
    *) printf 'proxy   : down\\nservice : Wi-Fi\\ndns     : There arent any DNS Servers set on Wi-Fi. \\nsocks   : off\\n' ;;
  esac
}
linux_status() {
  case "$state" in
    on) printf 'zapret               active\\ndnscrypt-proxy       active\\n\\nDNS                  66.254.114.41\\n' ;;
    *) printf 'zapret               inactive\\ndnscrypt-proxy       inactive\\n\\nDNS                  195.175.254.2\\n' ;;
  esac
}
case "$1" in
  status) "\${os}_status" ;;
  on) echo on > ${JSON.stringify(STATE)}; [ "$os" = macos ] && echo "dpi on  (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)" || echo "dpi on  (zapret dnscrypt-proxy up, resolver -> 127.0.0.1)" ;;
  off) echo off > ${JSON.stringify(STATE)}; echo "dpi off (Wi-Fi restored)" ;;
  toggle) if [ "$state" = off ]; then exec "$0" on; else exec "$0" off; fi ;;
  build) sleep 0.2; echo "built /Users/x/proj/byedpi/ciadpi" ;;
  *) echo "usage: dpi {on|off|status|toggle|test [url...]|build}" >&2; exit 1 ;;
esac
`);
// The fake curl: the url is the last argument; `codes` maps a host to `code delay`. The fakes reach /bin themselves: the host runs with a PATH of the fake bin and bun's alone.
writeFileSync(join(bin, "curl"), `#!/bin/sh
PATH=/usr/bin:/bin:$PATH
for u; do :; done
echo "$*" >> ${JSON.stringify(LOG)}
host=$(printf '%s' "$u" | sed -E -e 's|https?://||' -e 's|/.*||' -e 's|^www\\.||')
line=$(grep "^$host " ${JSON.stringify(CODES)} | head -1)
code=\${line#* }; delay=\${code#* }; code=\${code%% *}
[ -n "$delay" ] && [ "$delay" != "$code" ] && sleep "$delay"
printf '%s 0.%s' "\${code:-000}" "\${delay:-1}"
`);
writeFileSync(join(bin, "sudo"), `#!/bin/sh\n[ -f ${JSON.stringify(SUDO)} ]\n`);
for (const f of ["dpi", "curl", "sudo"]) chmodSync(join(bin, f), 0o755);
writeFileSync(CODES, "discord.com 200 1\nroblox.com 000 3\nenpara.com 200 1\nexample.com 200 2\n");
setState("off");

const URLS = ["https://discord.com/ = blocked", "https://www.roblox.com/ = blocked", "https://www.enpara.com/ = control", "https://example.com/ = control"];

async function startHost(os: "macos" | "linux") {
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${dirname(process.execPath)}`;
  process.env.PAL_DPI_OS = os === "macos" ? "darwin" : "linux";
  process.env.PAL_DPI_FAKE_OS = os;
  process.env.PAL_DPI_CURL = join(bin, "curl");
  process.env.PAL_DPI_LOG = DPI_LOG;
  try { return await Host.bundled({ settings: { dpi: { settings: { test_urls: URLS } } } }); }
  finally { process.env.PATH = saved; delete process.env.PAL_DPI_OS; delete process.env.PAL_DPI_FAKE_OS; delete process.env.PAL_DPI_CURL; delete process.env.PAL_DPI_LOG; }
}

describe("over the wire, macOS", () => {
  let host: Host;
  beforeAll(async () => { host = await startHost("macos"); });
  afterAll(() => host.kill());
  const rows = () => host.list("dpi", "dpi");
  const byId = (rows: Item[], id: string) => rows.find((r) => r.id === id)!;
  const now = () => host.request<{ extension: string; items: Item[] }[]>("suggest").then((r) => r.find((s) => s.extension === "dpi")?.items ?? []);
  const link = (route: string) => host.request<unknown>("link", { extension: "dpi", route, params: {} });

  test("meta: a live palette and a view palette, the item with its rules", () => {
    const l = host.loaded().find((x) => x.extension === "dpi")!;
    expect(l.palettes.map((p) => [p.name, p.title, p.live, p.view, p.suggest])).toEqual([["dpi", "DPI Bypass", true, undefined, true], ["test", "Bypass Test", false, "view", undefined]]);
    expect(l.palettes[0].icon).toEqual(tile("indigo", "\u{f0565}"));
    expect(l.bar).toMatchObject([{ id: "bypass", refresh: { every: 60, on: ["show", "wake", "network"] }, rules: [{ id: "off", hidden: true }, { id: "partial", color: "amber" }], source: true }]);
  });

  test("off: Turn on leads, then Status (its detail the facts), Test, the log (no file yet, inert), Build (asks first), Copy; nothing in the Now section", async () => {
    const r = await rows();
    expect(r.map((x) => x.id)).toEqual(["toggle", "status", "test", "log", "build", "copy"]);
    expect(byId(r, "toggle")).toMatchObject({ name: "Turn on bypass", subtitle: "Wi-Fi as before, byedpi down", icon: "\u{f0499}", accessories: [] });
    expect(byId(r, "toggle").actions!.map((a) => a.id)).toEqual(["on", "test", "copy"]);
    expect(byId(r, "status")).toMatchObject({ name: "Status: off", detail: { metadata: [{ label: "State", tags: [{ text: "off", color: "grey" }] }, { label: "Proxy", value: "down" }, { label: "Service", value: "Wi-Fi" }, { label: "DNS", value: "not set (the ISP's)" }, { label: "SOCKS", value: "off" }] } });
    expect(byId(r, "test").subtitle).toBe("curl discord.com, roblox.com (blocked) and 2 controls, direct");
    expect(byId(r, "log")).toMatchObject({ subtitle: expect.stringMatching(/^No log yet/), actions: [] });
    expect(await host.pick("dpi", "dpi", "log")).toMatchObject({ toast: { title: "No log yet" } });
    writeFileSync(DPI_LOG, "ciadpi: listening\n");
    expect((await rows()).find((x) => x.id === "log")).toMatchObject({ actions: [{ id: "open", title: "Open the log" }] });
    expect(await host.pick("dpi", "dpi", "log")).toEqual({ open: DPI_LOG });
    expect(byId(r, "build").actions![0]).toMatchObject({ confirm: "Build byedpi from source now?" });
    expect(await now()).toEqual([]);
    expect(await host.render("dpi", "bypass")).toMatchObject({ icon: "\u{f0499}", states: { on: false, state: "off", service: "Wi-Fi" }, empty: { icon: "\u{f0499}", tooltip: "Bypass off: Wi-Fi as before, byedpi down" } });
  }, 20_000);

  test("Enter on Turn on runs `dpi on`: the HUD is the script's line, the bar is pushed, the rows flip, the Now section offers Turn off", async () => {
    expect(await host.pick("dpi", "dpi", "toggle", "on")).toEqual({ hud: "dpi on (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)" });
    expect(cmds().at(-1)).toBe("on");
    // The bar was pushed inside the pick, once the script answered.
    expect(host.updates("dpi", "bypass").at(-1)).toMatchObject({ icon: "\u{f0565}", states: { state: "on" } });
    const r = await rows();
    expect(byId(r, "toggle")).toMatchObject({ name: "Turn off bypass", subtitle: "Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9", icon: { glyph: "\u{f0565}", color: "green" }, accessories: [{ tag: "on", color: "green" }] });
    expect((await now()).map((x) => x.name)).toEqual(["Turn off bypass"]);
    expect(byId(r, "test").subtitle).toMatch(/through socks5:\/\/127\.0\.0\.1:1080$/);
    expect(await host.pick("dpi", "dpi", "status", "copy")).toEqual({ copy: expect.stringContaining("proxy   : up (pid 4242, :1080)"), hud: "Copied the bypass status" });
  }, 20_000);

  test("a bare pick on the row is the toggle; the links say the script's line; `status` and `test` open the panel", async () => {
    expect(await host.pick("dpi", "dpi", "toggle")).toEqual({ hud: "dpi off (Wi-Fi restored)" });
    expect(cmds().slice(-2)).toEqual(["toggle", "off"]);
    expect(await link("on")).toEqual({ hud: "dpi on (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)" });
    expect(await link("toggle")).toEqual({ hud: "dpi off (Wi-Fi restored)" });
    expect(await link("off")).toEqual({ hud: "dpi off (Wi-Fi restored)" });
    expect(await link("status")).toEqual({ push: { extension: "dpi", palette: "dpi" } });
    expect(await link("test")).toEqual({ push: { extension: "dpi", palette: "test" } });
  }, 20_000);

  test("partial: amber, the reason, a Repair row (off, then on) and cmd+shift+r on the Turn off row", async () => {
    setState("half");
    await Bun.sleep(10);
    expect(await host.pick("dpi", "dpi", "hint:error")).toEqual({ keep: true }); // drops the cache
    const r = await rows();
    expect(r.map((x) => x.id)).toEqual(["toggle", "repair", "status", "test", "log", "build", "copy"]);
    expect(byId(r, "toggle")).toMatchObject({ name: "Turn off bypass", subtitle: "Proxy up (pid 4242), but SOCKS off and DNS not overridden", icon: { color: "amber" }, accessories: [{ tag: "partial", color: "amber" }] });
    expect(byId(r, "toggle").actions!.map((a) => a.shortcut)).toEqual([undefined, "cmd+t", "cmd+shift+r", "cmd+c"]);
    expect(byId(r, "repair")).toMatchObject({ name: "Repair bypass", subtitle: "Turn it off, then on: Proxy up (pid 4242), but SOCKS off and DNS not overridden" });
    expect(await host.render("dpi", "bypass")).toMatchObject({ icon: "\u{f0780}", states: { state: "partial" } });
    expect(await host.pick("dpi", "dpi", "repair", "repair")).toEqual({ hud: "dpi on (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)" });
    expect(cmds().slice(-2)).toEqual(["off", "on"]);
    expect(await host.pick("dpi", "dpi", "toggle", "off")).toEqual({ hud: "dpi off (Wi-Fi restored)" });
  }, 20_000);

  test("the popover: Enter toggles with the HUD, `c` copies, `o` opens the palette, `t` runs the test and the rows land in it", async () => {
    writeFileSync(CODES, "discord.com 200 1\nroblox.com 200 1\nenpara.com 200 1\nexample.com 200 2\n");
    expect(await host.barAction("dpi", "bypass", "toggle")).toEqual({ hud: "dpi on (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)" });
    expect(await host.barAction("dpi", "bypass", "copy")).toMatchObject({ hud: "Copied the bypass status" });
    expect(await host.barAction("dpi", "bypass", "open")).toEqual({ push: { extension: "dpi", palette: "dpi" } });
    host.viewShown("dpi", { bar: "bypass" }, "bypass", true);
    await Bun.sleep(20);
    expect(await host.barAction("dpi", "bypass", "test")).toEqual({ keep: true });
    const u = await host.nextViewUpdate("dpi", { bar: "bypass" }, (u) => badges(u.spec as View)[0] === "2 blocked reach, 2 controls fine", 6000);
    expect(badges(u.spec as View)).toEqual(["2 blocked reach, 2 controls fine", "blocked", "200", "blocked", "200", "control", "200", "control", "200"]);
    // Through the proxy, since it is up.
    expect(asked().filter((l) => l.includes("--max-time")).slice(-4).every((l) => l.includes("-x socks5h://127.0.0.1:1080"))).toBe(true);
    host.viewHidden("dpi", { bar: "bypass" }, "bypass", true);
    expect(await host.barAction("dpi", "bypass", "toggle")).toEqual({ hud: "dpi off (Wi-Fi restored)" });
  }, 20_000);

  test("the test level: opened, it runs; the rows arrive one by one; the cursor, Enter, `c`, cmd+c; direct while the proxy is down", async () => {
    writeFileSync(CODES, "discord.com 200 1\nroblox.com 000 3\nenpara.com 503 1\nexample.com 200 2\n");
    const v = await host.request<View>("view", { extension: "dpi", palette: "test" });
    expect(v.title).toBe("Testing the bypass…");
    expect(badges(v)).toEqual(["Testing 4 urls, 0 in…", "blocked", "…", "blocked", "…", "control", "…", "control", "…"]);
    host.viewShown("dpi", { palette: "test" }, "test");
    const first = await host.nextViewUpdate("dpi", { palette: "test" }, (u) => badges(u.spec as View).includes("200"), 4000);
    expect(badges(first.spec as View)).toContain("…");
    const done = await host.nextViewUpdate("dpi", { palette: "test" }, (u) => (u.spec as View).title !== "Testing the bypass…", 8000);
    // A 503 answered: the wire is fine, the site is not (the badge is amber, the summary counts it fine).
    expect((done.spec as View).title).toBe("1 of 2 blocked reach (roblox.com blocked), 2 controls fine");
    expect(badges(done.spec as View)).toEqual(["1 of 2 blocked reach (roblox.com blocked), 2 controls fine", "blocked", "200", "blocked", "000", "control", "503", "control", "200"]);
    expect(flat((done.spec as View).tree).filter((n) => n.type === "badge").map((n) => (n as { color?: string }).color)).toEqual(["red", "violet", "green", "violet", "red", "teal", "amber", "teal", "green"]);
    expect(texts(done.spec as View)).toContain("direct");
    expect(asked().filter((l) => l.includes("--max-time")).slice(-4).some((l) => l.includes("-x "))).toBe(false);
    expect((await host.pick("dpi", "test", "test", "down")).view!.actions[0]).toEqual({ id: "open", title: "Open roblox.com" });
    const focused = (await host.pick("dpi", "test", "test", "focus:3")).view!;
    expect(focused.actions[0]).toEqual({ id: "open", title: "Open example.com" });
    expect(flat(focused.tree).filter((n) => n.selected).map((n) => n.key)).toEqual(["r-3"]);
    expect(await host.pick("dpi", "test", "test", "open")).toEqual({ open: "https://example.com/" });
    expect(await host.pick("dpi", "test", "test", "copy")).toEqual({ copy: "https://example.com/  200  0.2 s  control", hud: "Copied example.com 200" });
    expect(await host.pick("dpi", "test", "test", "copy-all")).toMatchObject({ copy: expect.stringMatching(/^1 of 2 blocked reach.*\nhttps:\/\/discord\.com\/  200  0\.1 s  blocked\n/) });
    expect(await host.pick("dpi", "test", "test", "rerun")).toMatchObject({ view: { title: "Testing the bypass…" } });
    host.viewHidden("dpi", { palette: "test" }, "test");
  }, 20_000);

  test("a status the script cannot give is one row with the reason; a build starts and the HUD says when it landed", async () => {
    setState("broken");
    expect(await host.pick("dpi", "dpi", "hint:error")).toEqual({ keep: true });
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "hint:error", name: "Could not read the bypass status", subtitle: "no default route" });
    expect(await host.render("dpi", "bypass")).toEqual({ hidden: true, states: { on: null, state: null, service: null } });
    expect(await host.pick("dpi", "dpi", "toggle", "on")).toEqual({ hud: "dpi on (Wi-Fi -> socks5://127.0.0.1:1080, dns 1.1.1.1 9.9.9.9)" });
    setState("off");
    expect(await host.pick("dpi", "dpi", "build", "build")).toEqual({ hud: "Building byedpi… the HUD says when it is done" });
    await host.until(() => host.coreCalls.some((c) => c.method === "effects.run" && (c.params as any)?.effect?.hud === "built /Users/x/proj/byedpi/ciadpi"), 3000, "the build's HUD");
  }, 20_000);

  test("without the script: one hint row naming where it lives, Enter opens its setting; the item hides", async () => {
    host.changeSettings("dpi", { settings: { tool: "/nowhere/no-such-dpi" } });
    const r = await rows();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "hint:missing", name: "dpi is not installed", subtitle: expect.stringContaining("~/.local/bin/dpi") });
    expect(await host.pick("dpi", "dpi", "hint:missing")).toEqual({ open: "pal://settings/extensions?anchor=extensions:dpi:tool" });
    expect(await host.pick("dpi", "dpi", "toggle", "on")).toEqual({ keep: true, toast: { title: "dpi is not installed", message: expect.stringContaining("~/.local/bin/dpi"), style: "failure" } });
    await expect(link("on")).rejects.toThrow("dpi is not installed");
    expect(await host.render("dpi", "bypass")).toMatchObject({ hidden: true });
    host.changeSettings("dpi", { settings: { test_urls: URLS } });
    expect((await rows()).map((x) => x.id)).toContain("toggle");
  }, 20_000);
});

describe("over the wire, Linux", () => {
  let host: Host;
  beforeAll(async () => { setState("off"); rmSync(SUDO, { force: true }); host = await startHost("linux"); });
  afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

  test("no log or build rows; a closed sudo window is a toast and nothing runs; open, the switch goes through", async () => {
    const r = await host.list("dpi", "dpi");
    expect(r.map((x) => x.id)).toEqual(["toggle", "status", "test", "copy"]);
    expect(byIdOf(r, "status").detail!.metadata!.map((m) => m.label)).toEqual(["State", "zapret", "dnscrypt-proxy", "DNS probe"]);
    const before = asked().length;
    expect(await host.pick("dpi", "dpi", "toggle", "on")).toEqual({ keep: true, toast: { title: "Open a sudo window first: run `sudo -v` in a terminal, then try again", style: "failure" } });
    expect(asked().length).toBe(before);
    await expect(host.request("link", { extension: "dpi", route: "toggle", params: {} })).rejects.toThrow("Open a sudo window first");
    writeFileSync(SUDO, "");
    expect(await host.pick("dpi", "dpi", "toggle", "on")).toEqual({ hud: "dpi on (zapret dnscrypt-proxy up, resolver -> 127.0.0.1)" });
    expect(await host.render("dpi", "bypass")).toMatchObject({ icon: "\u{f0565}", tooltip: "Bypass on: zapret + dnscrypt-proxy up, resolver -> 127.0.0.1", states: { state: "on", service: "zapret + dnscrypt-proxy" } });
    expect(renderPopover({ status: parseStatus(LINUX_ON, "linux"), mac: false }).actions.map((a) => a.id)).not.toContain("log");
  }, 20_000);
});

const byIdOf = (rows: Item[], id: string) => rows.find((r) => r.id === id)!;
