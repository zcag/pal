// power: OS battery gauge plus the optional measured-power watcher state.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { tile } from "../../../sdk/src/icon.ts";
import { Host, writeTool } from "../harness.ts";

// `printf` and not `cat`: the fake binaries run with a PATH of just this bin
// directory and bun's, so anything in /bin is unreachable and only builtins work.
const script = (line: string, source = "Battery Power") => `#!/bin/sh\nprintf '%s' "Now drawing from '${source}'\n -InternalBattery-0 (id=1)\t${line} present: true\n"\n`;
const STATE = { ts: Math.floor(Date.now() / 1000), w: 7.21, ext: false, chg: false, eta: 10_934, level: "warn", temp: 30.4, alerts: [{ rule: "background-burn", level: "warn", msg: "copilot is using power in the background" }], blame: [["copilot", 28.9, "bg"], ["kitty", 11.4, "front"]], locks: [["Google Chrome", "PreventUserIdleSystemSleep"]] };
let host: Host, dir: string, state: string, pmset: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pal-power-"));
  const bin = join(dir, "bin");
  Bun.spawnSync(["mkdir", "-p", bin]);
  pmset = join(bin, "pmset");
  writeTool(pmset, script("31%; discharging; 2:57 remaining"));

  state = join(dir, "state.json");
  writeFileSync(state, JSON.stringify(STATE));
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${dirname(process.execPath)}`;
  process.env.PAL_POWER_OS = "darwin";
  try { host = await Host.bundled({ settings: { power: { settings: { power_state_file: state } } } }); }
  finally { process.env.PATH = saved; delete process.env.PAL_POWER_OS; }
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("power", () => {
  test("metadata exposes the live palette and preview states", () => {
    const loaded = host.loaded().find((x) => x.extension === "power")!;
    expect(loaded.palettes).toEqual([{ name: "power", title: "Battery & Power", live: true, input: false, icon: tile("green", "\u{f0079}"), showDetail: true, placeholder: "Battery, draw, or a process" }]);
    expect(loaded.bar).toMatchObject([{ id: "battery", title: "Battery", refresh: { every: 30, on: ["wake"] }, mocks: { healthy: { item: { hidden: true, empty: { title: "100%" } } }, critical: { item: { color: "red" } } }, rules: [{ id: "fine", hidden: true }, { id: "plugged" }, { id: "low", color: "amber" }, { id: "warn" }, { id: "critical", color: "red" }, { id: "crit" }], source: true }]);
  });

  test("bar: low battery uses the watcher warning and opens Battery Settings", async () => {
    expect(await host.render("power", "battery")).toMatchObject({ icon: "\u{f007d}", title: "31% · 7.2W · background-burn", states: { level: 31, charging: false, draw: 7.21, alert: "warn" }, click: "open", tooltip: "Battery Power · Discharging · 2:57 remaining · 7.2 W draw · copilot is using power in the background" });
    expect(await host.render("power", "battery")).not.toHaveProperty("progress");
    expect(await host.request<any>("bar/open", { extension: "power", id: "battery" })).toEqual({ open: "x-apple.systempreferences:com.apple.Battery-Settings.extension" });
  });

  test("bar: the glyph ramps with the level, and time left takes the slot the culprit had", async () => {
    // 31% is above the ETA cutoff, so the strip above names the culprit instead.
    // Below it the answer is how long, and four fields do not fit a bar.
    writeTool(pmset, script("23%; discharging; 2:59 remaining"));
    expect(await host.render("power", "battery")).toMatchObject({ icon: "\u{f007b}", title: "23% · 2:59 · 7.2W" });
    writeTool(pmset, script("8%; discharging; 0:22 remaining"));
    expect(await host.render("power", "battery")).toMatchObject({ icon: "\u{f007a}", title: "8% · 0:22 · 7.2W", states: { level: 8, charging: false } });
    writeTool(pmset, script("96%; charging; 1:12 remaining", "AC Power"));
    expect(await host.render("power", "battery")).toMatchObject({ icon: "\u{f0084}", title: "96% · 7.2W · background-burn", states: { level: 96, charging: true, alert: "warn" } });
  });

  test("bar: a recalculating 0:00 defers to the watcher rather than showing a zero", async () => {
    // pmset answers 0:00 for minutes after a plug change and whenever the load
    // swings; the watcher's 10934s is the estimate worth printing.
    writeTool(pmset, script("18%; discharging; 0:00 remaining"));
    expect(await host.render("power", "battery")).toMatchObject({ title: "18% · 3:02 · 7.2W", tooltip: expect.stringContaining("3h 02m remaining") });
    writeTool(pmset, script("31%; discharging; 2:57 remaining"));
  });

  test("palette: gauge, draw, warning, attribution and wake lock are separate useful rows", async () => {
    const rows = await host.list("power", "power");
    expect(rows.map((x) => x.id)).toEqual(["battery", "draw", "alert:0", "blame:0", "blame:1", "lock:0"]);
    expect(rows[0]).toMatchObject({ name: "31%", subtitle: "Battery Power · Discharging · 2:57 remaining", accessories: [{ text: "2:57" }, { tag: "discharging", color: "amber" }] });
    expect(rows[1]).toMatchObject({ name: "7.2 W", section: "Power" });
    expect(rows[2]).toMatchObject({ name: "background-burn", accessories: [{ tag: "warn", color: "amber" }] });
    expect(rows[3]).toMatchObject({ name: "copilot", subtitle: "Background process", accessories: [{ text: "29%" }] });
    expect(rows[5]).toMatchObject({ name: "Google Chrome", subtitle: "PreventUserIdleSystemSleep", section: "Wake locks" });
    expect(await host.pick("power", "power", "battery")).toEqual({ open: "x-apple.systempreferences:com.apple.Battery-Settings.extension" });
  });

  test("a healthy battery renders its facts and the empty shape; hiding it is the manifest's `fine` rule, not the render's", async () => {
    writeFileSync(state, JSON.stringify({ ...STATE, ts: Math.floor(Date.now() / 1000), alerts: [], w: 7.21 }));
    writeTool(pmset, script("82%; discharging; 6:10 remaining"));
    const item = await host.render("power", "battery");
    expect(item).toMatchObject({ title: "82%", states: { level: 82, charging: false, draw: 7.21, alert: null }, empty: { title: "82%", tooltip: expect.stringContaining("Battery Power · Discharging · 6:10 remaining") } });
    expect(item).not.toHaveProperty("hidden");
    expect(item).not.toHaveProperty("color");
  });
});
