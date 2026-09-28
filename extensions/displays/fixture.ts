// Writes app/src/gallery/shots/displays.json and bar-displays.json, the
// store screenshots' fixtures: the palette, a display's level, its modes,
// the brightness slider and the popover, drawn through the host harness
// against stand-in tools on PATH (system_profiler, displayplacer, m1ddc,
// the brightness CLI, nightlight) that print a made-up desk: a MacBook's
// panel on the left of a 27-inch "Aurora 27Q" on DisplayPort, the monitor
// main, two saved presets. Nothing is the owner's.
// `bun run extensions/displays/fixture.ts`, then `make shots EXT=displays`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Host, stored, writeTool } from "../../host/test/harness.ts";
import type { View } from "../../sdk/src/protocol.ts";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { formatPlacements, parseDisplayplacer, withMirror } from "./model.ts";

const PANEL = "4A1E2C90-7B3D-4F21-9E6A-1C0D52B8F3A7";
const AURORA = "D3F07A12-5C8E-4B69-A1F4-7E2B90C6D815";

const modes = (list: [number, number, boolean, number][], cur: string) => list.map(([w, h, hidpi, hz], i) => `  mode ${i}: res:${w}x${h} hz:${hz} color_depth:8${hidpi ? " scaling:on" : ""}${hidpi && `${w}x${h}@${hz}` === cur ? " <-- current mode" : ""}`).join("\n");
const LIST = `Persistent screen id: ${PANEL}
Contextual screen id: 1
Serial screen id: s4102233871
Type: MacBook built in screen
Resolution: 1512x982
Hertz: 120
Color Depth: 8
Scaling: on
Origin: (-1512,458)
Rotation: 0
Enabled: true
Resolutions for rotation 0:
${modes([[1147, 745, true, 120], [1312, 852, true, 120], [1512, 982, true, 120], [1512, 982, true, 60], [1728, 1117, true, 120], [3024, 1964, false, 120]], "1512x982@120")}

Persistent screen id: ${AURORA}
Contextual screen id: 2
Serial screen id: s27031960
Type: 27 inch external screen
Resolution: 2560x1440
Hertz: 60
Color Depth: 8
Scaling: on
Origin: (0,0) - main display
Rotation: 0
Enabled: true
Resolutions for rotation 0:
${modes([[1920, 1080, true, 60], [2304, 1296, true, 60], [2560, 1440, true, 60], [3008, 1692, true, 60], [3840, 2160, false, 60], [2560, 1440, false, 60]], "2560x1440@60")}

displayplacer "id:${PANEL} res:1512x982 hz:120 color_depth:8 enabled:true scaling:on origin:(-1512,458) degree:0" "id:${AURORA} res:2560x1440 hz:60 color_depth:8 enabled:true scaling:on origin:(0,0) degree:0"
`;
const PROFILER = JSON.stringify({ SPDisplaysDataType: [{ _name: "Apple M4 Pro", spdisplays_ndrvs: [
  { _name: "Color LCD", _spdisplays_displayID: "1", _spdisplays_pixels: "3024 x 1964", _spdisplays_resolution: "1512 x 982 @ 120.00Hz", spdisplays_connection_type: "spdisplays_internal", spdisplays_display_type: "spdisplays_built-in-retina", spdisplays_main: "spdisplays_no", spdisplays_mirror: "spdisplays_off", spdisplays_online: "spdisplays_yes" },
  { _name: "Aurora 27Q", _spdisplays_displayID: "2", _spdisplays_pixels: "5120 x 2880", _spdisplays_resolution: "2560 x 1440 @ 60.00Hz", spdisplays_connection_type: "spdisplays_displayport", spdisplays_main: "spdisplays_yes", spdisplays_mirror: "spdisplays_off", spdisplays_online: "spdisplays_yes" },
] }] });
const M1DDC = `[1] (null) (${PANEL})\n - Display ID:    1\n - System UUID:   ${PANEL}\n[2] Aurora 27Q (${AURORA})\n - Product name:  Aurora 27Q\n - Display ID:    2\n - System UUID:   ${AURORA}\n`;

/** The stand-ins: the panel at 62 %, the monitor at 70 % (contrast 75, volume 30), Night Shift on. Nothing is written back. */
function stage(dir: string) {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(dir, "list.txt"), LIST);
  writeFileSync(join(dir, "profiler.json"), PROFILER);
  writeFileSync(join(dir, "m1ddc.txt"), M1DDC);
  const tool = (name: string, body: string) => writeTool(join(bin, name), `#!/bin/sh\nDIR="${dir}"\n${body}\n`);
  tool("system_profiler", `cat "$DIR/profiler.json"`);
  tool("displayplacer", `[ "$1" = list ] && cat "$DIR/list.txt"`);
  tool("brightness", `[ "$1" = -l ] && printf 'display 0: main, active, awake, online, built-in, ID 0x1\\ndisplay 0: brightness 0.620000\\ndisplay 1: active, awake, online, external, ID 0x2\\n'`);
  tool("m1ddc", `case "$*" in
  "display list detailed") cat "$DIR/m1ddc.txt";;
  "display ${AURORA} get luminance") echo 70;;
  "display ${AURORA} get contrast") echo 75;;
  "display ${AURORA} get volume") echo 30;;
  "display ${AURORA} max "*) echo 100;;
  *) exit 1;;
esac`);
  tool("nightlight", `[ "$1" = status ] && echo on`);
  return bin;
}

if (import.meta.main) {
  pinClock();
  const dir = mkdtempSync(join(tmpdir(), "pal-displays-fixture-"));
  const bin = stage(dir);
  // Two presets saved earlier: the desk as it is, and the panel mirrored onto the monitor for a talk.
  const desk = parseDisplayplacer(LIST).placements;
  const DAY = 86_400_000;
  stored.set("displays\0presets", [
    { name: "Desk", saved: NOW - 12 * DAY, argv: [formatPlacements(desk)], displays: ["Built-in Retina Display", "Aurora 27Q"] },
    { name: "Presenting", saved: NOW - 3 * DAY - 5 * 3600_000, argv: [formatPlacements(withMirror(desk, AURORA, PANEL))], displays: ["Built-in Retina Display", "Aurora 27Q"] },
  ]);
  const saved = { PATH: process.env.PATH };
  process.env.PATH = `${bin}:/usr/bin:/bin:${dirname(process.execPath)}`;
  process.env.PAL_DISPLAYS_OS = "darwin";
  process.env.PAL_DISPLAYS_BREW = "";
  const host = await Host.bundled({
    core: {
      "windows.displays": () => [{ id: "2", frame: { x: 0, y: 0, w: 2560, h: 1440 }, visible_frame: { x: 0, y: 25, w: 2560, h: 1415 }, primary: true }, { id: "1", frame: { x: -1512, y: 458, w: 1512, h: 982 }, visible_frame: { x: -1512, y: 483, w: 1512, h: 957 }, primary: false }],
      "system.commands": () => [{ id: "sleep-displays", title: "Sleep Displays", subtitle: "", icon: "", keywords: [], destructive: false, available: true }],
    },
  });
  process.env.PATH = saved.PATH;
  try {
    const p = host.loaded().find((l) => l.extension === "displays")!.palettes[0];
    const aurora = { args: { display: "2" } };
    const root = await host.list("displays", "displays");
    const level = await host.list("displays", "displays", "", aurora);
    const modeRows = await host.list("displays", "displays", "", { args: { display: "2", level: "modes" } });
    const slider = (await host.pick("displays", "displays", "brightness", "slider", aurora)).view as View;
    const item = await host.render("displays", "brightness", { reason: "load", settings: { display: "external" } });
    // The cursor moved down to the panel's card (`↓` in the popover): its slider is the one the keys move.
    const panelFocus = (await host.barAction("displays", "brightness", "focus:1")).view as View;
    const base = { icon: p.icon };
    writeFixture("displays", {
      palettes: {
        displays: { title: p.title, placeholder: p.placeholder, live: true, ...base, items: root },
        aurora: { title: "Aurora 27Q", ...base, items: level },
        modes: { title: "Modes: Aurora 27Q", ...base, items: modeRows },
      },
      // The drill-in as the app runs it: Enter on the monitor pushes its level, Enter on Brightness opens the slider, on Resolution the modes.
      effects: {
        "displays/display:2": { push: { extension: "", palette: "aurora", title: "Aurora 27Q" } },
        "aurora/brightness": { view: slider },
        "aurora/modes": { push: { extension: "", palette: "modes", title: "Modes: Aurora 27Q" } },
      },
      shots: {
        "1-list": { palette: "displays", keys: [], caption: "Every display with its mode and brightness; Night Shift, Sleep displays and the saved arrangements below" },
        "2-display": { palette: "displays", keys: ["enter"], caption: "Enter on a monitor: brightness, contrast and volume over DDC, the input source, modes, mirroring and rotation" },
        "3-brightness": { palette: "displays", keys: ["enter", "enter", "wait:200"], caption: "A control opens as a slider: the arrows move it by the step, the digits jump to 10 to 100%" },
        "4-modes": { palette: "displays", keys: ["enter", "down*4", "enter"], caption: "Every mode the monitor takes, HiDPI first and the current one tagged; a change keeps Undo one row away" },
        "5-actions": { palette: "displays", keys: ["down", "cmd+k"], caption: "Set the brightness from the bar's text, make a display main or copy its id for a link" },
      },
    });
    writeFixture("bar-displays", {
      key: "displays/brightness", title: "Brightness", item,
      states: [{ id: "panel", item: { menu: { view: panelFocus } } }],
      shots: {
        "menubar": { target: "menubar", caption: "On the menu bar: the external monitor's brightness, a scroll on it moves it by the step" },
        "popover": { target: "menubar", popover: true, caption: "A click opens the popover: a card per display with its mode and a brightness slider" },
        "popover-panel": { target: "menubar", popover: true, state: "panel", caption: "↓ moves to the next display: the arrows and the digits now set the built-in panel" },
        "sketchybar": { target: "sketchybar", caption: "On sketchybar: the sun and the level as its label" },
      },
    });
    console.log("wrote app/src/gallery/shots/displays.json and bar-displays.json");
  } finally {
    host.kill();
    rmSync(dir, { recursive: true, force: true });
  }
}
