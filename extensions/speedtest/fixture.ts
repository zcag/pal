// Writes app/src/gallery/shots/speedtest.json, the store screenshots'
// fixture: the view drawn through the host harness with a stand-in
// Ookla CLI that prints a canned run (the same lines as the test), paused
// mid-download so the running view can be caught from its `view.update`
// push; a seeded history of made-up runs for the history and the trend.
// Nothing is the owner's. `bun run extensions/speedtest/fixture.ts`,
// then `node app/scripts/shots.mjs speedtest`.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, stored } from "../../host/test/harness.ts";
import type { View } from "../../sdk/src/protocol.ts";

const LINES = [
  `{"type":"testStart","isp":"Turk Telekom","interface":{"externalIp":"85.1.2.3"},"server":{"name":"Turkcell","location":"Istanbul"}}`,
  `{"type":"ping","ping":{"jitter":0.84,"latency":6.21,"progress":1}}`,
  `{"type":"download","download":{"bandwidth":55200000,"bytes":150000000,"elapsed":2700,"progress":0.31}}`,
  `{"type":"download","download":{"bandwidth":58125000,"bytes":420000000,"elapsed":7200,"progress":0.72}}`,
  "PAUSE",
  `{"type":"upload","upload":{"bandwidth":12100000,"bytes":50000000,"elapsed":4000,"progress":0.5}}`,
  `{"type":"result","ping":{"jitter":0.91,"latency":6.18},"download":{"bandwidth":58312500},"upload":{"bandwidth":12437500},"packetLoss":0,"isp":"Turk Telekom","interface":{"externalIp":"85.1.2.3"},"server":{"name":"Turkcell","location":"Istanbul"},"result":{"id":"a1b2","url":"https://www.speedtest.net/result/c/a1b2c3d4"}}`,
];
const dir = mkdtempSync(join(tmpdir(), "pal-speedtest-fixture-"));
const bins = join(dir, "bin");
mkdirSync(bins);
const script = (pause: string) => `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Speedtest by Ookla 1.2.0.84"; exit 0; fi\n${LINES.map((l) => (l === "PAUSE" ? pause : `sleep 0.05; printf '%s\\n' '${l}'`)).join("\n")}\n`;

const H = 3600e3, D = 24 * H, now = Date.now();
const run = (age: number, down: number, up: number, ping: number) => ({ tool: "ookla", startedAt: now - age, endedAt: now - age + 24e3, phase: "done", progress: 1, download: down, upload: up, ping, jitter: Math.round(ping * 0.15 * 100) / 100, packetLoss: 0, server: "Turkcell, Istanbul", isp: "Turk Telekom", ip: "85.1.2.3", url: "https://www.speedtest.net/result/c/seeded" });
const seeded = [run(2 * H, 461.2, 98.4, 6.4), run(26 * H, 448.9, 97.1, 6.9), run(2 * D + 3 * H, 312.5, 95.8, 7.2), run(3 * D, 455.0, 99.0, 6.1), run(4 * D + 5 * H, 96.3, 41.2, 18.4), run(5 * D, 452.7, 98.8, 6.3), run(6 * D + 2 * H, 430.1, 96.5, 6.7), run(8 * D, 458.6, 99.2, 6.2)];

process.env.PAL_SPEEDTEST_PATH = bins;
stored.clear();
const host = await Host.bundled();
try {
  const l = host.loaded().find((l) => l.extension === "speedtest")!;
  const [speedtest, history] = l.palettes;
  // No tool yet, then the idle view with the stand-in found, then a run caught mid-download and done.
  const noTool = await host.request<View>("view", { extension: "speedtest", palette: "speedtest" });
  writeFileSync(join(bins, "speedtest"), script("sleep 1.5"));
  chmodSync(join(bins, "speedtest"), 0o755);
  const idle = await host.request<View>("view", { extension: "speedtest", palette: "speedtest" });
  await host.pick("speedtest", "speedtest", "speedtest", "start");
  host.viewShown("speedtest", { palette: "speedtest" }, "speedtest");
  const running = (await host.nextViewUpdate("speedtest", { palette: "speedtest" }, (u) => JSON.stringify(u.spec).includes('"value":0.72'), 5000)).spec as View;
  const done = (await host.nextViewUpdate("speedtest", { palette: "speedtest" }, (u) => JSON.stringify(u.spec).includes('"text":"done"'), 8000)).spec as View;
  host.viewHidden("speedtest", { palette: "speedtest" }, "speedtest");
  // The seeded runs under the real one.
  const runs = (stored.get("speedtest\0runs") as unknown[]) ?? [];
  stored.set("speedtest\0runs", [...runs, ...seeded]);
  const rows = await host.list("speedtest", "history");
  const trend = (await host.pick("speedtest", "history", "trend")).view as View;
  const meta = { icon: speedtest.icon, view: "view" };
  const fixture = {
    palettes: {
      speedtest: { title: speedtest.title, ...meta, tree: idle },
      done: { title: speedtest.title, ...meta, tree: done },
      notool: { title: speedtest.title, ...meta, tree: noTool },
      history: { title: history.title, icon: history.icon, live: true, placeholder: history.placeholder, items: rows },
    },
    effects: { "speedtest/speedtest:start": { view: running }, "history/trend": { view: trend } },
    shots: {
      "1-idle": { palette: "speedtest", keys: ["wait:300"] },
      "2-running": { palette: "speedtest", keys: ["wait:300", "enter", "wait:600"] },
      "3-done": { palette: "done", keys: ["wait:300"] },
      "4-history": { palette: "history", keys: ["down"] },
      "5-trend": { palette: "history", keys: ["enter", "wait:600"] },
      "6-no-tool": { palette: "notool", keys: ["wait:300"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/speedtest.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/speedtest.json");
} finally {
  host.kill();
  rmSync(dir, { recursive: true, force: true });
}
