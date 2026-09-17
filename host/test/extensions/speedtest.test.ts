// speedtest: the stream readers first (tools.ts, pure: Ookla's JSON
// lines, speedtest-cli's lines, fast's redrawn line), then the tool
// detection and the palette over the wire against stand-in tools in a
// temp dir (`PAL_SPEEDTEST_PATH`): nothing spawned until Enter, the
// running view pushed through `view.update` as the stand-in prints, the
// finished view, Stop, the history and its trend, the other two tools.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { argv, detect, feed, finish, ms, speed, start, summary, noteLine } from "../../../extensions/speedtest/tools.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Effect, View, ViewNode } from "../../../sdk/src/protocol.ts";
import { checkView } from "../../../sdk/src/view.ts";
import { Host, stored } from "../harness.ts";

const OOKLA_LINES = [
  `{"type":"testStart","timestamp":"2026-09-17T08:00:00Z","isp":"Turk Telekom","interface":{"internalIp":"10.0.0.5","name":"en0","macAddr":"aa","isVpn":false,"externalIp":"85.1.2.3"},"server":{"id":1234,"host":"speedtest.example.net:8080","port":8080,"name":"Example Net","location":"Istanbul","country":"Türkiye","ip":"1.2.3.4"}}`,
  `{"type":"ping","timestamp":"2026-09-17T08:00:01Z","ping":{"jitter":1.297,"latency":12.363,"progress":0.4}}`,
  `{"type":"download","timestamp":"2026-09-17T08:00:03Z","download":{"bandwidth":11690463,"bytes":33481651,"elapsed":2727,"progress":0.18}}`,
  `{"type":"download","timestamp":"2026-09-17T08:00:08Z","download":{"bandwidth":11700000,"bytes":95000000,"elapsed":8000,"progress":0.72}}`,
  `{"type":"upload","timestamp":"2026-09-17T08:00:12Z","upload":{"bandwidth":3625125,"bytes":19799551,"elapsed":5520,"progress":0.368}}`,
  `{"type":"result","timestamp":"2026-09-17T08:00:20Z","ping":{"jitter":1.022,"latency":12.363,"low":11.9,"high":14.1},"download":{"bandwidth":11644000,"bytes":95966645,"elapsed":10804,"latency":{"iqm":20.1}},"upload":{"bandwidth":3701179,"bytes":35468808,"elapsed":9703},"packetLoss":0,"isp":"Turk Telekom","interface":{"internalIp":"10.0.0.5","name":"en0","macAddr":"aa","isVpn":false,"externalIp":"85.1.2.3"},"server":{"id":1234,"host":"speedtest.example.net:8080","port":8080,"name":"Example Net","location":"Istanbul","country":"Türkiye","ip":"1.2.3.4"},"result":{"id":"d5ac8c40","url":"https://www.speedtest.net/result/c/d5ac8c40","persisted":true}}`,
];
const SIVEL_LINES = ["Retrieving speedtest.net configuration...", "Testing from Turk Telekom (85.1.2.3)...", "Retrieving speedtest.net server list...", "Selecting best server based on ping...", "Hosted by Example Net (Istanbul) [3.21 km]: 12.363 ms", "Testing download speed................................................................................", "Download: 93.12 Mbit/s", "Testing upload speed......................................................................................................", "Upload: 29.61 Mbit/s"];
const FAST_CHUNKS = ["\n\n    ⠋ 12 Mbps ↓\n", "\x1b[2A\x1b[2K    ⠙ 88 Mbps ↓\n", "\x1b[2A\x1b[2K    93 Mbps ↓ / 4.2 Mbps ↑\n", "\x1b[2A\x1b[2K    93 Mbps ↓ / 28 Mbps ↑\n\n  Latency: 14 ms (unloaded) / 31 ms (loaded)\n  Client: Istanbul, TR • 85.1.2.3\n"];

describe("tools.ts", () => {
  test("Ookla's lines: the server and ISP at testStart, the phase and its progress per line, the result with the figures in Mbps, the url", () => {
    const r = start("ookla", 1000);
    feed(r, OOKLA_LINES[0] + "\n");
    expect(r).toMatchObject({ phase: "ping", isp: "Turk Telekom", ip: "85.1.2.3", server: "Example Net, Istanbul" });
    feed(r, OOKLA_LINES[1] + "\n" + OOKLA_LINES[2] + "\n");
    expect(r).toMatchObject({ phase: "download", ping: 12.363, jitter: 1.297, download: 93.52, progress: 0.18 });
    feed(r, OOKLA_LINES[4] + "\nnot json\n");
    expect(r).toMatchObject({ phase: "upload", upload: 29, progress: 0.368 });
    feed(r, OOKLA_LINES[5]);
    expect(r).toMatchObject({ phase: "done", progress: 1, download: 93.15, upload: 29.61, ping: 12.363, jitter: 1.022, packetLoss: 0, url: "https://www.speedtest.net/result/c/d5ac8c40" });
    finish(r, 0, 2000);
    expect(r.endedAt).toBe(2000);
    expect(summary(r)).toBe("↓ 93.2 Mbps · ↑ 29.6 Mbps · ping 12.4 ms (jitter 1.0 ms) · Example Net, Istanbul · Turk Telekom");
  });

  test("speedtest-cli's lines: the ISP, the server with its ping, the download and upload figures, done at the last", () => {
    const r = start("speedtest-cli");
    feed(r, SIVEL_LINES.slice(0, 5).join("\n") + "\n");
    expect(r).toMatchObject({ phase: "download", isp: "Turk Telekom", ip: "85.1.2.3", server: "Example Net, Istanbul", ping: 12.363 });
    feed(r, SIVEL_LINES.slice(5, 7).join("\n") + "\n");
    expect(r).toMatchObject({ phase: "upload", download: 93.12 });
    feed(r, SIVEL_LINES.slice(7).join("\n") + "\n");
    expect(r).toMatchObject({ phase: "done", upload: 29.61, progress: 1 });
    const f = start("speedtest-cli");
    feed(f, "Retrieving speedtest.net configuration...\nERROR: Unable to connect to servers to test latency.\n");
    finish(f, 1);
    expect(f).toMatchObject({ phase: "failed", error: "ERROR: Unable to connect to servers to test latency." });
  });

  test("fast's redrawn line: the last figure of each arrow in the chunk, units folded to Mbps, the latency; done needs both figures and exit 0", () => {
    const r = start("fast");
    feed(r, FAST_CHUNKS[0]);
    expect(r).toMatchObject({ phase: "download", download: 12 });
    feed(r, FAST_CHUNKS[1] + FAST_CHUNKS[2]);
    expect(r).toMatchObject({ phase: "upload", download: 93, upload: 4.2 });
    feed(r, FAST_CHUNKS[3]);
    expect(r).toMatchObject({ upload: 28, ping: 14, ip: "85.1.2.3", isp: "Istanbul, TR" });
    finish(r, 0);
    expect(r.phase).toBe("done");
    const k = start("fast");
    feed(k, "    ⠋ ↓ 900 Kbps\n");
    expect(k.download).toBe(0.9);
    finish(k, null);
    expect(k).toMatchObject({ phase: "failed", error: "stopped" });
  });

  test("argv per tool, with the server id where the tool takes one; the figures format by size", () => {
    expect(argv({ id: "ookla", bin: "/x/speedtest", title: "" }, " 1234 ")).toEqual(["/x/speedtest", "--format=jsonl", "--progress=yes", "--accept-license", "--accept-gdpr", "--server-id", "1234"]);
    expect(argv({ id: "speedtest-cli", bin: "/x/sc", title: "" }, "")).toEqual(["/x/sc", "--secure"]);
    expect(argv({ id: "fast", bin: "/x/fast", title: "" }, "1234")).toEqual(["/x/fast", "--upload", "--verbose"]);
    expect([speed(undefined), speed(934.5), speed(93.456), speed(4.256)]).toEqual(["–", "935", "93.5", "4.26"]);
    expect([ms(undefined), ms(123.4), ms(12.36)]).toEqual(["–", "123 ms", "12.4 ms"]);
  });
});

// ---- stand-in tools -----------------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "pal-speedtest-"));
const bins = join(dir, "bin"), log = join(dir, "argv.log");
mkdirSync(bins);
const standIn = (name: string, body: string) => { const p = join(bins, name); writeFileSync(p, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\n${body}`); chmodSync(p, 0o755); };
const emit = (lines: string[], delay = 0.08) => lines.map((l) => `sleep ${delay}; printf '%s\\n' '${l.replace(/'/g, `'\\''`)}'`).join("\n");
const ookla = (delay?: number, tail = "") => `if [ "$1" = "--version" ]; then echo "Speedtest by Ookla 1.2.0.84 (ea6b6773cf) Darwin/arm64"; exit 0; fi\n${emit(OOKLA_LINES.slice(0, 5), delay)}\n${tail}\n${emit(OOKLA_LINES.slice(5), delay)}`;
const argvLog = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
/** The stand-in logs its argv as it starts, a beat after the spawn. */
const spawned = (host: Host) => host.until(() => argvLog().at(-1)?.startsWith("--") === true && argvLog().at(-1) !== "--version", 2000, "the tool spawned");

describe("detect", () => {
  test("Ookla's speedtest by its --version, sivel's alias likewise, speedtest-cli and fast by name; auto lists Ookla first and a wanted one narrows", async () => {
    process.env.PAL_SPEEDTEST_PATH = bins;
    expect(await detect()).toEqual([]);
    standIn("speedtest", ookla());
    standIn("speedtest-cli", `echo x`);
    standIn("fast", `echo x`);
    expect((await detect()).map((t) => t.id)).toEqual(["ookla", "speedtest-cli", "fast"]);
    expect((await detect("fast")).map((t) => t.id)).toEqual(["fast"]);
    standIn("speedtest", `echo "speedtest-cli 2.1.3"; echo "Python 3.12.0"`);
    expect((await detect()).map((t) => [t.id, t.bin])).toEqual([["speedtest-cli", join(bins, "speedtest")], ["fast", join(bins, "fast")]]);
    rmSync(join(bins, "speedtest")); rmSync(join(bins, "speedtest-cli")); rmSync(join(bins, "fast"));
  });
});

// ---- the palette over the wire ------------------------------------------------------------

let host: Host;
beforeAll(async () => {
  process.env.PAL_SPEEDTEST_PATH = bins;
  stored.clear();
  host = await Host.bundled({ settings: { speedtest: { settings: { keep: 5 } } } });
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); delete process.env.PAL_SPEEDTEST_PATH; });

const view = () => host.request<View>("view", { extension: "speedtest", palette: "speedtest" });
const pick = (action?: string, id = "speedtest") => host.pick("speedtest", "speedtest", id, action);
const viewOf = (e: Effect) => checkView(e.view!);
const texts = (n: ViewNode): string[] => (n.type === "text" ? [n.value] : n.type === "badge" ? [`[${n.text}]`] : n.type === "tile" ? [`${n.text ?? ""}|${n.sub ?? ""}`] : n.type === "progress" ? [`${n.color}=${n.value.toFixed(2)}`] : n.type === "stack" ? n.children.flatMap(texts) : []);
const shown = () => host.viewShown("speedtest", { palette: "speedtest" }, "speedtest");
const hidden = () => host.viewHidden("speedtest", { palette: "speedtest" }, "speedtest");
const nextTree = (pred: (t: string[]) => boolean, timeout = 6000) => host.nextViewUpdate("speedtest", { palette: "speedtest" }, (u) => pred(texts((u.spec as View).tree)), timeout).then((u) => u.spec as View);

describe("speedtest", () => {
  test("meta: a view palette on the violet tile re-asked on show; the history live; no warnings", () => {
    const l = host.loaded().find((l) => l.extension === "speedtest")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ name: "speedtest", title: "Speedtest", view: "view", input: true, on: ["show"], icon: tile("violet", "\u{f04c5}") });
    expect(l.palettes[1]).toMatchObject({ name: "history", title: "Speedtest History", live: true });
  });

  test("no tool installed: the view says so with the three install lines, Enter only looks again; nothing is spawned", async () => {
    rmSync(log, { force: true });
    const v = checkView(await view());
    const t = texts(v.tree);
    expect(t[0]).toBe("[no tool]");
    expect(t.join("\n")).toContain("brew tap teamookla/speedtest && brew install speedtest");
    expect(t.join("\n")).toContain("npm install --global fast-cli");
    expect(v.actions.map((a) => a.title)).toEqual(["Look for a tool again", "Copy result", "History"]);
    expect(await pick("copy")).toMatchObject({ keep: true, toast: { title: "No result yet" } });
    expect(texts(viewOf(await pick("start")).tree)[0]).toBe("[no tool]");
    expect(argvLog()).toEqual([]);
  });

  test("with Ookla's CLI: opening the view runs nothing; Enter spawns it, the running view is pushed as the stream comes in, the finished one has every figure; the run lands in the history", async () => {
    standIn("speedtest", ookla());
    let v = checkView(await view());
    expect(texts(v.tree).slice(0, 2)).toEqual(["[Speedtest by Ookla]", "Press Enter to start"]);
    expect(v.actions[0]).toEqual({ id: "start", title: "Start the test" });
    expect(argvLog()).toEqual(["--version"]);
    v = viewOf(await pick("start"));
    await spawned(host);
    expect(argvLog().at(-1)).toBe("--format=jsonl --progress=yes --accept-license --accept-gdpr");
    expect(texts(v.tree)).toContain("[starting]");
    expect(v.actions[0]).toEqual({ id: "stop", title: "Stop the test" });
    shown();
    const down = await nextTree((t) => t.includes("[downloading]"));
    const dt = texts(down.tree);
    expect(dt).toContain("Example Net, Istanbul · Turk Telekom");
    expect(dt).toContain("blue=0.18");
    expect(dt).toContain("93.5");
    expect(dt).toContain("12.4 ms|latency");
    const done = await nextTree((t) => t.includes("[done]"));
    const t = texts(done.tree);
    expect(t).toEqual(expect.arrayContaining(["[Speedtest by Ookla]", "blue=1.00", "93.2", "green=1.00", "29.6", "12.4 ms|latency", "1.0 ms|jitter", "0%|loss"]));
    expect(t.at(-1)).toContain("Enter runs again, cmd+Enter copies, cmd+o opens the result");
    expect(done.actions.map((a) => a.id)).toEqual(["start", "copy", "open", "history"]);
    expect(await pick("copy")).toEqual({ copy: "↓ 93.2 Mbps · ↑ 29.6 Mbps · ping 12.4 ms (jitter 1.0 ms) · Example Net, Istanbul · Turk Telekom" });
    expect(await pick("open")).toEqual({ open: "https://www.speedtest.net/result/c/d5ac8c40" });
    expect(await pick("history")).toEqual({ push: { extension: "speedtest", palette: "history" } });
    hidden();
    // A fresh open shows the last result.
    expect(texts(checkView(await view()).tree)).toContain("93.2");
  });

  test("Enter while it runs stops it: the tool is killed, the view says failed, nothing lands in the history; the server id reaches the argv", async () => {
    host.changeSettings("speedtest", { settings: { keep: 5, server: "1234" } });
    standIn("speedtest", ookla(0.05, "sleep 30"));
    const before = ((await host.list("speedtest", "history")).length);
    viewOf(await pick("start"));
    await spawned(host);
    expect(argvLog().at(-1)).toBe("--format=jsonl --progress=yes --accept-license --accept-gdpr --server-id 1234");
    shown();
    await nextTree((t) => t.includes("[uploading]"));
    const v = viewOf(await pick("start"));
    const stopped = texts(v.tree).includes("[failed]") ? v : await nextTree((t) => t.includes("[failed]"));
    expect(texts(stopped.tree).at(-1)).toBe("Failed: stopped · Enter runs again");
    expect(stopped.actions[0].title).toBe("Run again");
    await Bun.sleep(200);
    expect((await host.list("speedtest", "history")).length).toBe(before);
    hidden();
    host.changeSettings("speedtest", { settings: { keep: 5 } });
  });

  test("speedtest-cli and fast end in a done view with their figures; the bar estimates while such a tool reports no progress", async () => {
    rmSync(join(bins, "speedtest"));
    standIn("speedtest-cli", emit(SIVEL_LINES, 0.05));
    host.changeSettings("speedtest", { settings: { keep: 5, tool: "speedtest-cli" } });
    let v = viewOf(await pick("start"));
    expect(texts(v.tree)[0]).toBe("[speedtest-cli]");
    shown();
    let done = await nextTree((t) => t.includes("[done]"));
    expect(texts(done.tree)).toEqual(expect.arrayContaining(["93.1", "29.6", "12.4 ms|latency", "Example Net, Istanbul · Turk Telekom"]));
    hidden();
    standIn("fast", FAST_CHUNKS.map((c) => `sleep 0.05; printf '%s' '${c.replace(/\x1b/g, "\\033")}'`).join("\n"));
    host.changeSettings("speedtest", { settings: { keep: 5, tool: "fast" } });
    v = viewOf(await pick("start"));
    expect(texts(v.tree)[0]).toBe("[fast (Netflix)]");
    shown();
    const mid = await nextTree((t) => t.includes("[downloading]") && t.includes("12.0"));
    const est = texts(mid.tree).find((x) => x.startsWith("blue="))!;
    expect(Number(est.slice(5))).toBeGreaterThanOrEqual(0);
    expect(Number(est.slice(5))).toBeLessThan(1);
    done = await nextTree((t) => t.includes("[done]"));
    expect(texts(done.tree)).toEqual(expect.arrayContaining(["93.0", "28.0", "14.0 ms|latency"]));
    hidden();
    host.changeSettings("speedtest", { settings: { keep: 5 } });
  });

  test("history: the finished runs newest first with copy, open and remove, a Trend row drawing them as bars, Clear", async () => {
    const rows = await host.list("speedtest", "history");
    expect(rows[0]).toMatchObject({ id: "trend", name: "Trend: the last 3 runs" });
    expect(rows.slice(1, -1).map((r) => r.name)).toEqual(["↓ 93.0 Mbps  ↑ 28.0 Mbps  ·  14.0 ms", "↓ 93.1 Mbps  ↑ 29.6 Mbps  ·  12.4 ms", "↓ 93.2 Mbps  ↑ 29.6 Mbps  ·  12.4 ms"]);
    expect(rows[3]).toMatchObject({ subtitle: "Example Net, Istanbul · Turk Telekom · Speedtest by Ookla", accessories: [{ date: expect.any(Number) }] });
    expect(rows[3].actions!.map((a) => a.id)).toEqual(["copy", "open", "remove"]);
    expect(rows[1].actions!.map((a) => a.id)).toEqual(["copy", "remove"]);
    expect(rows.at(-1)).toMatchObject({ id: "clear", subtitle: "3 runs" });
    const trend = viewOf(await host.pick("speedtest", "history", "trend"));
    const t = texts(trend.tree);
    expect(trend.title).toBe("Last 3 runs");
    expect(t.filter((x) => x.startsWith("blue="))).toEqual(["blue=1.00", "blue=1.00", "blue=1.00"]);
    expect(t.filter((x) => x.startsWith("green="))).toEqual(["green=1.00", "green=1.00", "green=0.95"]);
    expect(t[1]).toBe("best ↓ 93.2 · ↑ 29.6 Mbps");
    expect(t).toContain("↓ 93.2");
    expect((await host.pick("speedtest", "history", "trend", "copy_all")).copy).toContain("↓ 93.0 Mbps · ↑ 28.0 Mbps");
    expect(await host.pick("speedtest", "history", rows[3].id)).toEqual({ copy: "↓ 93.2 Mbps · ↑ 29.6 Mbps · ping 12.4 ms (jitter 1.0 ms) · Example Net, Istanbul · Turk Telekom" });
    expect(await host.pick("speedtest", "history", rows[3].id, "open")).toEqual({ open: "https://www.speedtest.net/result/c/d5ac8c40" });
    expect(await host.pick("speedtest", "history", rows[3].id, "remove")).toMatchObject({ keep: true, toast: { title: "Removed" } });
    expect((await host.list("speedtest", "history")).length).toBe(4);
    expect(await host.pick("speedtest", "history", "clear", "clear")).toMatchObject({ keep: true, toast: { title: "History cleared" } });
    expect(await host.list("speedtest", "history")).toEqual([expect.objectContaining({ id: "hint:empty", actions: [] })]);
  });
  test("a tool that dies before any figure names its last line (a broken fast-cli's dyld complaint), not just the exit code", () => {
    const r = start("fast");
    noteLine(r, "dyld[123]: Library not loaded: Google Chrome for Testing Framework\nTROUBLESHOOTING: https://pptr.dev/troubleshooting\n");
    finish(r, 0);
    expect(r.phase).toBe("failed");
    expect(r.error).toBe("dyld[123]: Library not loaded: Google Chrome for Testing Framework (exit 0)");
  });

});
