// Writes app/src/gallery/shots/samsungtv.json and bar-samsungtv.json: the
// store screenshots' fixtures, an invented living room drawn through the
// same trees and rows the extension draws (remote.ts, setup.ts, rows.ts),
// so the shots show what the panel draws without a TV on the network. The
// apps are invented (art.ts SAMPLE_MARKS): no real app's logo.
// `bun run extensions/samsungtv/fixture.ts`, then `make shots EXT=samsungtv`.
import { NOW, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { Served } from "@zcag/pal";
import { sampleApp } from "./art.ts";
import { INPUTS } from "./device.ts";
import manifest from "./pal.json" with { type: "json" };
import { render as renderRemote, type RemoteState } from "./remote.ts";
import { appRow, commandRows } from "./rows.ts";
import { render as renderSetup } from "./setup.ts";
import type { App, Found } from "./types.ts";

const ICON = manifest.icon;
const DEVICE = "Living Room";
const provider = { key: "samsungtv", device: DEVICE };

const APPS: App[] = [
  { id: "3201900000002", name: "Northlight" }, { id: "3201900000001", name: "Reelwave" }, { id: "3201900000003", name: "Tidepool" },
  { id: "3201900000004", name: "Filmhouse" }, { id: "3201900000005", name: "Arcadia" }, { id: "3201900000006", name: "Fieldguide" },
  { id: "3201900000007", name: "Greenroom" }, { id: "3201900000008", name: "Nightfall" },
];
const art = (a: App) => sampleApp(a.id)!;
const front = APPS[0];
const dock = APPS.map((a) => ({ id: a.id, name: a.name, art: art(a), front: a.id === front.id }));

const volume: Served<"volume"> = { device: DEVICE, level: 0.24, muted: false, provider };
const power: Served<"power"> = { device: DEVICE, on: true, provider };
const inputs: Served<"inputs"> = { device: DEVICE, list: INPUTS.map((i) => ({ id: i.id, name: i.name })), provider };

const base: RemoteState = {
  layout: "wide", conn: "up", power: "on", device: { name: DEVICE, model: "QE65QN90DATXTK" }, others: 1, wakeable: true,
  front: { id: front.id, name: front.name, art: art(front) }, volume, powerSlot: power, inputs, dock, keyboard: { open: false },
};
const remote = renderRemote(base);
const pressed = renderRemote({ ...base, flash: "right" });
const typing = renderRemote({ ...base, front: { id: APPS[1].id, name: APPS[1].name, art: art(APPS[1]) }, dock: dock.map((d) => ({ ...d, front: d.id === APPS[1].id })), keyboard: { open: true, text: "harb" }, typing: true });
const compact = renderRemote({ ...base, layout: "compact" });

const LIVING: Found = { id: "uuid:5b1e2c40-7a41-4d1e-9c55-0f3a8e21b7d4", name: DEVICE, address: "192.168.1.31", model: "QE65QN90DATXTK", mac: "F4:DD:06:12:34:56", power: "on", tokenAuth: true };
const BEDROOM: Found = { id: "uuid:9a0c7e11-2b3f-4c8a-8e61-6d2f1b0c9e42", name: "Bedroom", address: "192.168.1.52", model: "UE50CU7172UXXH", power: "standby", tokenAuth: true };
const setupFind = renderSetup({ phase: "find", scanning: false }, [LIVING, BEDROOM], [], undefined, NOW);
const setupAllow = renderSetup({ phase: "allow", device: LIVING, until: NOW + 24_000 }, [LIVING, BEDROOM], [], undefined, NOW);
const paired = { id: LIVING.id, name: DEVICE, address: LIVING.address, model: LIVING.model, mac: LIVING.mac, token: "x", pairedAt: NOW };
const setupReady = renderSetup({ phase: "ready", device: paired, checks: [
  { ok: true, what: "Remote", detail: "The buttons, typing, opening apps" },
  { ok: true, what: "Apps", detail: "8 apps found, a digit each for the dock" },
  { ok: true, what: "Volume", detail: "24 now; the slider sets it, m mutes" },
  { ok: true, what: "Power", detail: "p turns it off and on; from off, Power On with Mobile has to be on" },
  { ok: true, what: "Inputs", detail: "i moves to the next HDMI input; the input menu is a key away" },
] }, [LIVING], [paired], undefined, NOW);

const appRows = [...APPS].sort((a, b) => a.name.localeCompare(b.name)).map((a) => appRow(a, art(a), { device: DEVICE, front: a.id === front.id, dock: (() => { const i = dock.findIndex((d) => d.id === a.id); return i < 0 ? undefined : i; })() }));

const fixture = {
  palettes: {
    remote: { title: "Samsung TV Remote", icon: ICON, view: "view", tree: remote },
    "remote-typing": { title: "Samsung TV Remote", icon: ICON, view: "view", tree: typing },
    apps: { title: "Samsung TV Apps", icon: ICON, placeholder: "Search the TV's apps", items: appRows },
    commands: { title: "Samsung TV", icon: ICON, items: commandRows(DEVICE, ["Bedroom"], INPUTS) },
    setup: { title: "Set Up Samsung TV", icon: ICON, view: "view", tree: setupAllow },
    "setup-find": { title: "Set Up Samsung TV", icon: ICON, view: "view", tree: setupFind },
    "setup-ready": { title: "Set Up Samsung TV", icon: ICON, view: "view", tree: setupReady },
  },
  effects: {
    "remote/remote:right": { view: pressed },
  },
  shots: {
    "1-remote": { palette: "remote", keys: ["wait:400"], raw: true, caption: "The remote: the arrows and OK, the app on screen, your apps on the digits, the inputs and the volume" },
    "2-typing": { palette: "remote-typing", keys: ["wait:400"], raw: true, caption: "The TV shows its keyboard and a field opens here: type with yours, Enter sends it" },
    "3-apps": { palette: "apps", keys: ["wait:400"], caption: "Every app on the TV; Enter opens it, cmd+D puts it on the dock" },
    "4-commands": { palette: "commands", keys: ["wait:400"], caption: "At the root: turn the TV on or off, mute, the next HDMI input, the input menu" },
    "5-setup": { palette: "setup", keys: ["wait:400"], raw: true, caption: "Guided setup: the TV asks whether to allow pal; press Allow with its remote" },
    "6-ready": { palette: "setup-ready", keys: ["wait:400"], raw: true, caption: "Then a check of what works, read from the TV itself" },
  },
};
writeFixture("samsungtv", fixture);

const bar = {
  key: "samsungtv/tv",
  title: "Samsung TV",
  item: { icon: "\u{f0502}", title: front.name, tooltip: `${front.name} on ${DEVICE}`, menu: { view: compact } },
  states: [{ id: "on", item: { title: DEVICE, tooltip: `${DEVICE} is on` } }],
  shots: {
    "menubar": { target: "menubar", caption: "On the menu bar: the app on the TV's screen" },
    "popover": { target: "menubar", popover: true, raw: true, caption: "A click opens the remote: the arrows, the buttons, the volume, the inputs and the dock" },
    "sketchybar": { target: "sketchybar", caption: "On sketchybar: the TV mark and the app" },
  },
};
writeFixture("bar-samsungtv", bar);
console.log(`${APPS.length} apps, the remote, typing, the setup, the bar item`);
