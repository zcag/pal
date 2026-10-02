// Writes app/src/gallery/shots/speedtest.json, the store screenshots'
// fixture. The idle and no-tool views come through the host harness with
// a stand-in Ookla CLI (found, never run); the running view is view.ts's `spec` over
// a run fed Ookla's own lines up to mid-download (the parser the live
// stream goes through), the finished one the view a fresh open draws over
// the last run in storage, above a history of made-up runs for the list and
// the trend. The ISP, the server and the address are invented (a
// documentation-range IP). `make shots EXT=speedtest`.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, stored, writeTool } from "../../host/test/harness.ts";
import type { View } from "../../sdk/src/protocol.ts";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { spec } from "./view.ts";
import { feed, finish, start, type Run } from "./tools.ts";

pinClock();
const where = `"isp":"Marmara Fiber","interface":{"externalIp":"203.0.113.24"},"server":{"name":"Anatolia Net","location":"Istanbul"}`;
const LINES = [
  `{"type":"testStart",${where}}`,
  `{"type":"ping","ping":{"jitter":0.84,"latency":6.21,"progress":1}}`,
  `{"type":"download","download":{"bandwidth":54800000,"bytes":150000000,"elapsed":2700,"progress":0.31}}`,
  `{"type":"download","download":{"bandwidth":56900000,"bytes":420000000,"elapsed":7200,"progress":0.72}}`,
  `{"type":"upload","upload":{"bandwidth":12100000,"bytes":50000000,"elapsed":4000,"progress":0.5}}`,
  `{"type":"result","ping":{"jitter":0.91,"latency":6.18},"download":{"bandwidth":57650000},"upload":{"bandwidth":12300000},"packetLoss":0,${where},"result":{"id":"a1b2","url":"https://www.speedtest.net/result/c/a1b2c3d4"}}`,
];
/** A run of Ookla started `ago` ms before the clock, fed `lines`; `took` ends it. */
const ookla = (ago: number, lines: string[], took?: number): Run => {
  const r = start("ookla", NOW - ago);
  feed(r, lines.join("\n") + "\n");
  if (took) finish(r, 0, r.startedAt + took);
  return r;
};

const H = 3600e3, D = 24 * H;
const run = (age: number, down: number, up: number, ping: number): Run => ({ tool: "ookla", startedAt: NOW - age, endedAt: NOW - age + 24e3, phase: "done", progress: 1, download: down, upload: up, ping, jitter: Math.round(ping * 0.15 * 100) / 100, packetLoss: 0, server: "Anatolia Net, Istanbul", isp: "Marmara Fiber", ip: "203.0.113.24", url: "https://www.speedtest.net/result/c/e5f6a7b8" });
const past = [run(5 * H + 11 * 60e3, 458.3, 98.4, 6.4), run(26 * H, 448.9, 97.1, 6.9), run(2 * D + 3 * H, 312.5, 95.8, 7.2), run(3 * D, 455.0, 99.0, 6.1), run(4 * D + 5 * H, 96.3, 41.2, 18.4), run(5 * D, 452.7, 98.8, 6.3), run(6 * D + 2 * H, 430.1, 96.5, 6.7), run(8 * D, 458.6, 99.2, 6.2)];

const dir = mkdtempSync(join(tmpdir(), "pal-speedtest-fixture-"));
const bins = join(dir, "bin");
mkdirSync(bins);
process.env.PAL_SPEEDTEST_PATH = bins;
stored.clear();
const host = await Host.bundled();
try {
  const l = host.loaded().find((l) => l.extension === "speedtest")!;
  const [speedtest, history] = l.palettes;
  const viewOf = () => host.request<View>("view", { extension: "speedtest", palette: "speedtest" });
  // No tool yet, then the idle view with the stand-in found and no run before.
  const noTool = await viewOf();
  writeTool(join(bins, "speedtest"), `echo "Speedtest by Ookla 1.2.0.84"`);
  const idle = await viewOf();
  // Nine seconds in, 72% through the download.
  const running = spec({ run: ookla(9e3, LINES.slice(0, 4)), phaseAt: NOW - 4e3, done: Promise.resolve() }, [], NOW);
  // A minute ago, 21 s long, on top of the history.
  stored.set("speedtest\0runs", [ookla(62e3, LINES, 21e3), ...past]);
  const done = await viewOf();
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
      "1-idle": { palette: "speedtest", caption: "Opened: the tool found; nothing runs until Enter" },
      "2-running": { palette: "speedtest", keys: ["enter", "wait:600"], caption: "Downloading: the bar fills with Ookla's progress, the figure moves with it" },
      "3-done": { palette: "done", caption: "Done: both figures, ping and jitter, the server and the ISP" },
      "4-history": { palette: "history", keys: ["down", "cmd+i"], caption: "History: the runs, newest first; the pane has a run's figures large, its ISP and its result page" },
      "5-trend": { palette: "history", keys: ["enter", "wait:600"], caption: "The trend: the last runs as bars, download in blue and upload in green" },
      "6-no-tool": { palette: "notool", caption: "Nothing installed: the three ways to get a tool" },
    },
  };
  writeFixture("speedtest", fixture);
  console.log("wrote app/src/gallery/shots/speedtest.json");
} finally {
  host.kill();
  rmSync(dir, { recursive: true, force: true });
}
