// power: OS battery gauge plus the optional measured-power watcher state.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { tile } from "../../../sdk/src/icon.ts";
import { Host } from "../harness.ts";

const PMSET = `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t31%; discharging; 2:57 remaining present: true\n`;
const STATE = { ts: Math.floor(Date.now() / 1000), w: 7.21, ext: false, chg: false, eta: 10_934, level: "warn", temp: 30.4, alerts: [{ rule: "background-burn", level: "warn", msg: "copilot is using power in the background" }], blame: [["copilot", 28.9, "bg"], ["kitty", 11.4, "front"]], locks: [["Google Chrome", "PreventUserIdleSystemSleep"]] };
let host: Host, dir: string, state: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pal-power-"));
  const bin = join(dir, "bin");
  Bun.spawnSync(["mkdir", "-p", bin]);
  writeFileSync(join(bin, "pmset"), `#!/bin/sh\nprintf '%s' '${PMSET.replace(/'/g, "'\\''")}'\n`);
  chmodSync(join(bin, "pmset"), 0o755);
  state = join(dir, "state.json");
  writeFileSync(state, JSON.stringify(STATE));
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${dirname(process.execPath)}`;
  process.env.PAL_POWER_OS = "darwin";
  try { host = await Host.bundled({ settings: { power: { settings: { show_below: 50, show_charging_below: 20, show_draw_watts: 15, always_show: false, power_state_file: state } } } }); }
  finally { process.env.PATH = saved; delete process.env.PAL_POWER_OS; }
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("power", () => {
  test("metadata exposes the live palette and preview states", () => {
    const loaded = host.loaded().find((x) => x.extension === "power")!;
    expect(loaded.palettes).toEqual([{ name: "power", title: "Battery & Power", live: true, input: false, icon: tile("green", "\u{f0079}"), showDetail: true, placeholder: "Battery, draw, or a process" }]);
    expect(loaded.bar).toMatchObject([{ id: "battery", title: "Battery", refresh: { every: 30, on: ["wake"] }, mocks: { healthy: { item: { hidden: true } }, critical: { item: { color: "red" } } }, source: true }]);
  });

  test("bar: low battery uses the watcher warning and opens Battery Settings", async () => {
    expect(await host.render("power", "battery")).toMatchObject({ icon: "\u{f0083}", title: "31%", color: "amber", progress: 0.31, click: "open", tooltip: "Battery Power · Discharging · 2:57 remaining · 7.2 W draw · copilot is using power in the background" });
    expect(await host.request<any>("bar/open", { extension: "power", id: "battery" })).toEqual({ open: "x-apple.systempreferences:com.apple.Battery-Settings.extension" });
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

  test("healthy battery hides unless always-show is enabled", async () => {
    writeFileSync(state, JSON.stringify({ ...STATE, ts: Math.floor(Date.now() / 1000), alerts: [], w: 7.21 }));
    host.changeSettings("power", { settings: { show_below: 20, show_charging_below: 20, show_draw_watts: 15, always_show: false, power_state_file: state } });
    expect(await host.render("power", "battery")).toEqual({ hidden: true });
    host.changeSettings("power", { settings: { show_below: 20, show_charging_below: 20, show_draw_watts: 15, always_show: true, power_state_file: state } });
    const shown = await host.render("power", "battery");
    expect(shown).toMatchObject({ title: "31%" });
    expect(shown).not.toHaveProperty("color");
  });
});
