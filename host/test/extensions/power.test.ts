// power: the OS battery gauge plus the optional `power` watcher (its state,
// its ring buffer of samples, its `blame` CLI), all stand-ins from the
// fixture: a stand-in pmset and power on a bare PATH, a watcher directory.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pmsetTool, samples, stage, STATE } from "../../../extensions/power/fixture.ts";
import { tailSamples } from "../../../extensions/power/data.ts";
import { buckets, nameOf, ranked, renderPopover, why } from "../../../extensions/power/view.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { Host, writeTool } from "../harness.ts";

let host: Host, dir: string, state: string, pmset: string;
const texts = (n: ViewNode | View): string[] => ("tree" in n ? texts(n.tree) : n.type === "text" ? [n.value] : n.type === "badge" ? [n.text] : n.type === "tile" ? [n.text ?? ""] : n.type === "stack" ? n.children.flatMap(texts) : []);
const view = () => host.request<View>("view", { extension: "power", palette: "power" });
const pick = async (action: string) => (await host.pick("power", "power", "dash", action)) as { view?: View; push?: unknown; copy?: string };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pal-power-"));
  const staged = stage(dir);
  state = staged.state;
  pmset = join(staged.bin, "pmset");
  const saved = process.env.PATH;
  process.env.PATH = `${staged.bin}:${dirname(process.execPath)}`;
  process.env.PAL_POWER_OS = "darwin";
  process.env.PAL_POWER_BIN = staged.power;
  try { host = await Host.bundled({ settings: { power: { settings: { power_state_file: state } } } }); }
  finally { process.env.PATH = saved; delete process.env.PAL_POWER_OS; delete process.env.PAL_POWER_BIN; }
});
afterAll(() => { host.kill(); rmSync(dir, { recursive: true, force: true }); });

describe("power: the strip", () => {
  test("metadata: one view palette, the bar item with its rules", () => {
    const loaded = host.loaded().find((x) => x.extension === "power")!;
    expect(loaded.palettes).toMatchObject([{ name: "power", title: "Battery & Power" }]);
    expect(loaded.bar).toMatchObject([{ id: "battery", title: "Battery", refresh: { every: 30, on: ["wake"] }, rules: [{ id: "fine", hidden: true }, { id: "plugged" }, { id: "low", color: "amber" }, { id: "warn" }, { id: "critical", color: "red" }, { id: "crit" }] }]);
  });

  test("the watcher's warning names the culprit; a click opens the palette, hover the popover", async () => {
    const item = await host.render("power", "battery") as any;
    expect(item).toMatchObject({ icon: "\u{f007d}", title: "31% · 12.4W · background-burn", states: { level: 31, charging: false, draw: 12.4, alert: "warn" }, click: "open" });
    expect(item.tooltip).toBe("Battery Power · Discharging · 1:48 remaining · 12.4 W draw · Google Chrome Helper (Renderer) is using power in the background");
    expect(texts(item.menu.view)).toEqual(expect.arrayContaining(["31%", "on battery", "Drawing 12 W · 1 h 48 min left", "Using power now", "Google Chrome Helper (Renderer) is using power in the background", "2.1 W"]));
    expect(await host.request<any>("bar/open", { extension: "power", id: "battery" })).toEqual({ push: { extension: "power", palette: "power" } });
  });

  test("the glyph ramps with the level, and low down the time left takes the culprit's slot", async () => {
    writeTool(pmset, pmsetTool("23%; discharging; 2:59 remaining"));
    expect(await host.render("power", "battery")).toMatchObject({ icon: "\u{f007b}", title: "23% · 2:59 · 12.4W" });
    writeTool(pmset, pmsetTool("8%; discharging; 0:22 remaining"));
    expect(await host.render("power", "battery")).toMatchObject({ icon: "\u{f007a}", title: "8% · 0:22 · 12.4W", states: { level: 8 } });
    // pmset's 0:00 while it recalculates defers to the watcher's own estimate (6480 s).
    writeTool(pmset, pmsetTool("18%; discharging; 0:00 remaining"));
    expect(await host.render("power", "battery")).toMatchObject({ title: "18% · 1:48 · 12.4W" });
    writeTool(pmset, pmsetTool("96%; charging; 1:12 remaining", "AC Power"));
    expect(await host.render("power", "battery")).toMatchObject({ icon: "\u{f140b}", title: "96% · 12.4W · background-burn", states: { level: 96, charging: true, draw: 0 } });
    writeTool(pmset, pmsetTool("31%; discharging; 1:48 remaining"));
  });

  test("healthy: the facts and the empty shape; hiding is the manifest's rule, not the render's", async () => {
    writeFileSync(state, JSON.stringify({ ...STATE(), ts: Math.floor(Date.now() / 1000), alerts: [], w: 7.2 }));
    writeTool(pmset, pmsetTool("82%; discharging; 6:10 remaining"));
    const item = await host.render("power", "battery");
    expect(item).toMatchObject({ title: "82%", states: { level: 82, charging: false, draw: 7.2, alert: null }, empty: { title: "82%" } });
    expect(item).not.toHaveProperty("hidden");
    writeFileSync(state, JSON.stringify(STATE()));
    writeTool(pmset, pmsetTool("31%; discharging; 1:48 remaining"));
  });
});

describe("power: the palette", () => {
  test("Now: the warning, where the watts go, and the processes with their watts and why", async () => {
    const v = await view();
    const t = texts(v);
    expect(v.title).toBe("Battery 31% · Now");
    expect(t).toEqual(expect.arrayContaining(["Now", "Google Chrome Helper (Renderer) is using power in the background", "Where the power goes", "12 W in all", "Apps & chip 5.5 W (CPU 4.1 W, GPU 0.9 W)", "Screen & the rest 6.9 W", "Kept awake by Spotify", "91%", "212", "Today: 27 Wh on battery, 38% of a charge"]));
    // 38% of the chip's 5.5 W (12.4 measured less 6.9 of the rest), and why it costs.
    expect(t).toEqual(expect.arrayContaining(["2.1 W", "background · 41% CPU · 880 wakeups/s", "in front · 10% CPU · 120 wakeups/s"]));
    expect(v.actions[0]).toMatchObject({ id: "processes", title: "Find Google Chrome Helper (Renderer) in Processes", shortcut: "enter" });
  });

  test("keys: the cursor moves, Enter finds the process, cmd+c copies, tabs switch", async () => {
    await view();
    expect(texts((await pick("down")).view!)).toContain("WindowServer");
    expect(await pick("processes")).toMatchObject({ push: { extension: "processes", palette: "processes", query: "WindowServer" } });
    expect(await pick("copy")).toMatchObject({ copy: "WindowServer" });
    const today = (await pick("next")).view!;
    expect(today.title).toBe("Battery 31% · Today");
    expect(texts(today)).toEqual(expect.arrayContaining(["Screen & the rest", "6.1 Wh", "Google Chrome Helper (Renderer)"]));
    // The bookkeeping line under the cursor has no process to find: Enter is Battery settings there.
    expect(today.actions[0]).toMatchObject({ id: "settings", shortcut: ["enter", "s"] });
    const week = (await pick("tab:week")).view!;
    expect(texts(week).find((x) => x.startsWith("221 Wh used on battery in the last 7 days"))).toBe("221 Wh used on battery in the last 7 days, about 3.1 full charges.");
    expect((await pick("prev")).view!.title).toBe("Battery 31% · Today");
    expect((await pick("tab:all")).view!.title).toBe("Battery 31% · All time");
  });

  test("a stale watcher leaves only the gauge, said plainly", async () => {
    writeFileSync(state, JSON.stringify({ ...STATE(), ts: Math.floor(Date.now() / 1000) - 3600 }));
    const t = texts(await view());
    expect(t).toContain("Only the level is known. The power watcher measures the draw and names what uses it.");
    expect(t).toContain("On battery · 1 h 48 min left");
    writeFileSync(state, JSON.stringify(STATE()));
  });
});

describe("power: pure pieces", () => {
  const now = 1_800_000_000;
  test("buckets: the mean battery draw per slot, the charger's stretches as bands, gaps as NaN", () => {
    const pts = [{ ts: now - 3500, w: 6, soc: 50, ext: false }, { ts: now - 3490, w: 8, soc: 50, ext: false }, { ts: now - 1700, w: -30, soc: 60, ext: true }, { ts: now - 1100, w: -30, soc: 70, ext: true }, { ts: now - 10, w: 10, soc: 69, ext: false }];
    const b = buckets(pts, 3600, 6, now);
    expect(b.draw.map((x) => (Number.isNaN(x) ? null : x))).toEqual([7, null, null, null, null, 10]);
    expect(b.bands).toEqual([{ from: 3, to: 4, color: "green" }]);
    expect(b.mean).toBe(8);
    expect(b.peak).toBe(10);
  });

  test("ranked: watt-hours, or activity when the window was spent on the charger", () => {
    expect(ranked([{ name: "(baseline)", wh: 3, ss: 0 }, { name: "a", wh: 1, ss: 9 }]).byScore).toBe(false);
    const ac = ranked([{ name: "(baseline)", wh: 0, ss: 0 }, { name: "a", wh: 0, ss: 5 }, { name: "b", wh: 0, ss: 9 }]);
    expect(ac.byScore).toBe(true);
    expect(ac.rows.map((u) => u.name)).toEqual(["b", "a"]);
  });

  test("names and reasons in plain words", () => {
    expect(nameOf("(baseline)")).toBe("Screen & the rest");
    expect(nameOf("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Game\\Game.exe")).toBe("Game.exe");
    expect(why({ name: "x", share: 1, kind: "", cpu: 250, wakeups: 1500, disk: 3 << 20 })).toBe("25% CPU · 1.5k wakeups/s");
    expect(why({ name: "x", share: 1, kind: "", cpu: 1 })).toBeUndefined();
  });

  test("tailSamples reads back past a first guess that was too short", async () => {
    const file = join(dir, "big.jsonl");
    const rows = samples(now).map((s: any) => ({ ...s, pad: "x".repeat(3000) }));
    writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const got = await tailSamples(file, 3 * 3600, now);
    expect(got.length).toBe(181);
    expect(got[0].ts).toBe(now - 3 * 3600);
  });

  test("the popover without the watcher says what installing it adds", () => {
    const v = renderPopover({ snap: { percent: 64, source: "Battery Power", status: "discharging", eta: "4:10", watched: false, charging: false, alerts: [], procs: [], locks: [], split: {}, health: {} }, hour: [] });
    expect(texts(v)).toEqual(expect.arrayContaining(["64%", "On battery · 4 h 10 min left", "Install the power watcher to see the draw and what uses it."]));
  });
});
