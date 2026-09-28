// Writes app/src/gallery/shots/dpi.json and bar-dpi.json, the store
// screenshots' fixtures: the palette, the test level and the popover drawn
// through the host harness against a stand-in `dpi` (the bypass on over
// Wi-Fi, or half on: byedpi up, the SOCKS and the DNS not pointed at it)
// and a stand-in curl answering the default urls through the proxy, under
// a made-up home whose byedpi log exists. Nothing is the owner's.
// `bun run extensions/dpi/fixture.ts`, then `make shots EXT=dpi`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host, writeTool } from "../../host/test/harness.ts";
import type { BarItem, Item, View } from "../../sdk/src/protocol.ts";

const ON = "proxy   : up (pid 5317, :1080)\nservice : Wi-Fi\ndns     : 1.1.1.1 9.9.9.9 \nsocks   : 127.0.0.1:1080\n";
const HALF = "proxy   : up (pid 5317, :1080)\nservice : Wi-Fi\ndns     : There aren't any DNS Servers set on Wi-Fi. \nsocks   : off\n";
/** Host to `code seconds` through the proxy: both blocked sites reach, every control is fine. */
const CODES: Record<string, string> = { "discord.com": "200 0.64", "roblox.com": "200 0.91", "enpara.com": "200 0.33", "raycast.com": "200 0.52", "slack.com": "302 0.46", "example.com": "200 0.28" };

pinClock();
const dir = mkdtempSync(join(tmpdir(), "pal-dpi-fixture-"));
const bin = join(dir, "bin"), home = join(dir, "home"), state = join(dir, "state");
mkdirSync(join(home, "Library/Logs"), { recursive: true });
writeFileSync(join(home, "Library/Logs/dpi.log"), "ciadpi: listening on 127.0.0.1:1080\n");
writeFileSync(state, ON);
writeTool(join(bin, "dpi"), `#!/bin/sh\nPATH=/usr/bin:/bin:$PATH\n[ "$1" = status ] && cat ${JSON.stringify(state)}\n`);
writeTool(join(bin, "curl"), `#!/bin/sh\nfor u; do :; done\nhost=$(printf '%s' "$u" | /usr/bin/sed -E -e 's|https?://||' -e 's|/.*||' -e 's|^www\\.||')\ncase "$host" in\n${Object.entries(CODES).map(([h, c]) => `  ${h}) printf '${c}' ;;`).join("\n")}\nesac\n`);

const saved = { PATH: process.env.PATH, HOME: process.env.HOME };
Object.assign(process.env, { PATH: `${bin}:${dirname(process.execPath)}`, HOME: home, PAL_DPI_OS: "darwin", PAL_DPI_CURL: join(bin, "curl") });
const host = await Host.bundled();
Object.assign(process.env, saved);

/** The status re-read: the cache (five seconds) dropped the way the error hint's pick drops it. */
const reread = async (out: string) => { writeFileSync(state, out); await host.pick("dpi", "dpi", "hint:error"); };
/** The test run to its end in the palette's test level, or in the popover with `t`. */
const done = (v: View) => !/Testing/.test(JSON.stringify(v.tree));
async function testLevel(): Promise<View> {
  await host.request<View>("view", { extension: "dpi", palette: "test" });
  host.viewShown("dpi", { palette: "test" }, "test");
  const u = await host.nextViewUpdate("dpi", { palette: "test" }, (u) => done(u.spec as View), 8000);
  host.viewHidden("dpi", { palette: "test" }, "test");
  return u.spec as View;
}
async function popoverTested(): Promise<View> {
  host.viewShown("dpi", { bar: "bypass" }, "bypass", true);
  await Bun.sleep(20);
  await host.barAction("dpi", "bypass", "test");
  const u = await host.nextViewUpdate("dpi", { bar: "bypass" }, (u) => done(u.spec as View), 8000);
  host.viewHidden("dpi", { bar: "bypass" }, "bypass", true);
  return u.spec as View;
}

try {
  const meta = host.loaded().find((l) => l.extension === "dpi")!.palettes;
  const [main, test] = [meta.find((p) => p.name === "dpi")!, meta.find((p) => p.name === "test")!];
  const on = await host.list("dpi", "dpi");
  const item = await host.render("dpi", "bypass");
  const level = await testLevel();
  const popTest = await popoverTested();
  await reread(HALF);
  const half = await host.list("dpi", "dpi");
  // The `partial` rule's amber, as the core lays it over the item.
  const halfItem: BarItem = { ...(await host.render("dpi", "bypass")), color: "amber" };
  const strip = ({ states: _s, empty: _e, ...i }: BarItem) => i;

  const palette = (items: Item[]) => ({ title: main.title, icon: main.icon, live: true, items });
  writeFixture("dpi", {
    palettes: { dpi: palette(on), partial: palette(half), test: { title: test.title, icon: test.icon ?? main.icon, view: "view", tree: level } },
    shots: {
      "1-on": { palette: "dpi", keys: [], caption: "The bypass on: Turn off leads, then the status, the test, the log, the build and a copy of the status" },
      "2-status": { palette: "dpi", keys: ["down", "wait:300", "cmd+i", "wait:500"], caption: "⌘I on the status: what the script printed, and the proxy, the network service, the DNS and the SOCKS proxy it names" },
      "3-test": { palette: "test", keys: ["wait:300"], caption: "The test: a curl per url through the proxy, the blocked sites and the controls with their codes and times" },
      "4-partial": { palette: "partial", keys: [], caption: "Half on: amber with the reason, and a Repair row that turns it off and on again" },
    },
  });
  writeFixture("bar-dpi", {
    key: "dpi/bypass", title: "DPI Bypass", item: strip(item),
    states: [
      { id: "test", item: { menu: { view: popTest } } },
      { id: "partial", item: strip(halfItem) },
    ],
    shots: {
      "menubar": { target: "menubar", caption: "On the menu bar only while the bypass is on: a shield" },
      "menubar-partial": { target: "menubar", state: "partial", caption: "Half on: the shield turns amber and half full" },
      "popover": { target: "menubar", popover: true, caption: "A click opens the popover: the status with its facts; Enter turns it off, t tests it" },
      "popover-test": { target: "menubar", popover: true, state: "test", caption: "t runs the test in the popover: each url's code lands under the card" },
      "popover-partial": { target: "menubar", popover: true, state: "partial", caption: "Half on: the reason on the card and r to repair" },
      "sketchybar": { target: "sketchybar", caption: "On sketchybar: the shield while the bypass is on" },
    },
  });
  console.log("dpi.json, bar-dpi.json: on over Wi-Fi, a passing test, half on");
} finally {
  host.kill();
  rmSync(dir, { recursive: true, force: true });
}
