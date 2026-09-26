// Writes app/src/gallery/shots/power.json and bar-power.json, the store
// screenshots' fixtures: the palette and the popover drawn through the host
// harness against a made-up watcher (six hours of samples with a stretch
// on the charger, a background burn, a `power` CLI that answers canned
// watt-hours) and a stand-in pmset. Nothing is the owner's.
// `bun run extensions/power/fixture.ts`, then `node app/scripts/shots.mjs power`
// and `node app/scripts/shots.mjs bar power`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Host, writeTool } from "../../host/test/harness.ts";
import type { View } from "../../sdk/src/protocol.ts";

export const NOW = Math.floor(Date.now() / 1000);
/** Six hours at a sample a minute: on battery, an hour on the charger two hours ago, a build's spike, the draw settling into a background burn. */
export function samples(now = NOW) {
  const out: object[] = [];
  let soc = 88;
  for (let t = now - 6 * 3600 + 60; t <= now; t += 60) {
    const age = (now - t) / 60;
    const ac = age > 150 && age < 215;
    const build = age > 60 && age < 85;
    const w = ac ? -38 : 5.2 + 1.6 * Math.sin(t / 700) + (build ? 14 + 6 * Math.sin(t / 90) : 0) + (age < 25 ? 6 : 0);
    soc = ac ? Math.min(100, soc + 0.9) : Math.max(5, soc - w / 60 / 0.72);
    out.push({ ts: t, w: Math.round(w * 100) / 100, soc: Math.round(soc), ext: ac, chg: ac, wh: Math.round(soc * 0.72 * 10) / 10, cycles: 212, health: 91.4, thermal: "Nominal", btot: 100, blame: [["Google Chrome Helper (Renderer)", 38], ["WindowServer", 21], ["kitty", 12], ["Spotify", 8], ["mds_stores", 6], ["(short-lived processes)", 5]], why: [["Google Chrome Helper (Renderer)", 412, 880, 0, 240000], ["WindowServer", 180, 310, 0, 0], ["kitty", 96, 120, 0, 0], ["Spotify", 60, 90, 0, 180000]] });
  }
  return out;
}
export const STATE = (now = NOW) => ({ ts: now, w: 12.4, soc: 31, ext: false, chg: false, temp: 33.2, eta: 6480, level: "warn", alerts: [{ rule: "background-burn", level: "warn", msg: "Google Chrome Helper (Renderer) is using power in the background" }], blame: [["Google Chrome Helper (Renderer)", 38, "bg"], ["WindowServer", 21, "system"], ["kitty", 12, "front"], ["Spotify", 8, "minor"]], front: "kitty", locks: [["Spotify", "PreventUserIdleSystemSleep", 1260]], cpu_mw: 4100, gpu_mw: 900, soc_mw: 5300, rest_w: 6.9 });
const BLAME: Record<string, string> = {
  today: "14.2\t0\t(baseline)\n6.1\t1\tGoogle Chrome Helper (Renderer)\n2.4\t1\trustc\n1.9\t1\tWindowServer\n1.1\t1\tSpotify\n0.8\t1\t(short-lived processes)\n0.6\t1\tkitty\n0.4\t1\t(everything else)",
  week: "121\t0\t(baseline)\n38.5\t1\tGoogle Chrome Helper (Renderer)\n21.2\t1\trustc\n12.8\t1\tWindowServer\n9.7\t1\tSpotify\n6.2\t1\t(short-lived processes)\n5.9\t1\tzoom.us\n3.1\t1\tkitty\n2.2\t1\t(everything else)",
  all: "612\t0\t(baseline)\n188\t1\tGoogle Chrome Helper (Renderer)\n97\t1\trustc\n66\t1\tWindowServer\n48\t1\tzoom.us\n41\t1\tSpotify\n30\t1\t(short-lived processes)\n12\t1\t(everything else)",
};
/** A stand-in `power`: `blame <n>s` is today, `blame 7d` the week, bare `blame` all time. */
export const powerTool = () => `#!/bin/sh\ncase "$2" in\n  *s) printf '%s\\n' '${BLAME.today.replace(/\n/g, "' '")}' ;;\n  7d) printf '%s\\n' '${BLAME.week.replace(/\n/g, "' '")}' ;;\n  *) printf '%s\\n' '${BLAME.all.replace(/\n/g, "' '")}' ;;\nesac\n`;
export const pmsetTool = (line: string, source = "Battery Power") => `#!/bin/sh\nprintf '%s' "Now drawing from '${source}'\n -InternalBattery-0 (id=1)\t${line} present: true\n"\n`;

/** A watcher directory with the state and the samples, a bin with pmset and power; returns what the host needs. */
export function stage(dir: string) {
  const bin = join(dir, "bin"), watch = join(dir, "power");
  mkdirSync(bin, { recursive: true });
  mkdirSync(watch, { recursive: true });
  writeTool(join(bin, "pmset"), pmsetTool("31%; discharging; 1:48 remaining"));
  writeTool(join(bin, "power"), powerTool());
  writeFileSync(join(watch, "state.json"), JSON.stringify(STATE()));
  writeFileSync(join(watch, "samples.jsonl"), samples().map((s) => JSON.stringify(s)).join("\n") + "\n");
  return { bin, state: join(watch, "state.json"), power: join(bin, "power") };
}

if (import.meta.main) {
  const dir = mkdtempSync(join(tmpdir(), "pal-power-fixture-"));
  const { bin, state, power } = stage(dir);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${dirname(process.execPath)}`;
  process.env.PAL_POWER_OS = "darwin";
  process.env.PAL_POWER_BIN = power;
  const host = await Host.bundled({ settings: { power: { settings: { power_state_file: state } } } });
  process.env.PATH = saved;
  try {
    const p = host.loaded().find((l) => l.extension === "power")!.palettes[0];
    const now = await host.request<View>("view", { extension: "power", palette: "power" });
    const today = (await host.pick("power", "power", "dash", "tab:today")).view as View;
    const week = (await host.pick("power", "power", "dash", "tab:week")).view as View;
    const item = await host.render("power", "battery");
    const meta = { icon: p.icon, view: "view" };
    writeFileSync(new URL("../../app/src/gallery/shots/power.json", import.meta.url), JSON.stringify({
      palettes: { power: { title: p.title, ...meta, tree: now }, today: { title: p.title, ...meta, tree: today }, week: { title: p.title, ...meta, tree: week } },
      effects: {},
      shots: { "1-now": { palette: "power", keys: ["wait:300"] }, "2-today": { palette: "today", keys: ["wait:300"] }, "3-week": { palette: "week", keys: ["down", "wait:300"] } },
    }, null, 2) + "\n");
    writeFileSync(new URL("../../app/src/gallery/shots/bar-power.json", import.meta.url), JSON.stringify({
      key: "power/battery", title: "Battery", item,
      shots: {
        "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: the level, the draw and the warning that made it surface" },
        "bar-menubar-light": { target: "menubar", theme: "light", caption: "The same item on a light menu bar" },
        "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "Hover opens the popover: the level, the last hour's draw, the warning and what uses power now" },
        "bar-menubar-popover-dark": { target: "menubar", theme: "dark", popover: true, caption: "The same popover in the dark theme" },
        "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the level, draw and warning as one strip" },
      },
    }, null, 2) + "\n");
    console.log("wrote app/src/gallery/shots/power.json and bar-power.json");
  } finally {
    host.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}
