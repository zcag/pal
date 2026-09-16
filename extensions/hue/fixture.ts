// Writes app/src/gallery/shots/hue.json and bar-hue.json: the store
// screenshots' fixtures, from the sample home (sample.ts) through the same
// rows, trees and bar item the extension draws, so the shots show what the
// panel draws without a bridge on the network.
// `bun run extensions/hue/fixture.ts`, then `node app/scripts/shots.mjs hue`
// and `node app/scripts/shots.mjs bar hue`.
import { writeFileSync } from "node:fs";
import { Home, aggregate, lightsOf, roomsOf, scenesOf, sensorsOf } from "./model.ts";
import { fresh, render, renderSetup } from "./render.ts";
import { G, ICON, automationRow, lightRow, roomRow, roomTile, sceneRow, sensorRows } from "./rows.ts";
import { automationsOf } from "./model.ts";
import { SAMPLE_BRIDGE_ID, SAMPLE_RESOURCES } from "./sample.ts";

const home = new Home();
home.load({ id: SAMPLE_BRIDGE_ID, name: "Hue Bridge", ip: "192.168.1.25" }, SAMPLE_RESOURCES);
const rooms = roomsOf(home), lights = lightsOf(home), scenes = scenesOf(home), sensors = sensorsOf(home);
const living = rooms.find((r) => r.id === "room:living-room")!;
const bedroom = rooms.find((r) => r.id === "room:bedroom")!;
const sofa = lights.find((l) => l.id === "light:sofa-lamp")!;
const livingScenes = scenes.filter((s) => s.room?.id === living.id && s.kind === "scene");
const bedroomScenes = scenes.filter((s) => s.room?.id === bedroom.id && s.kind === "scene");

const roomItems = rooms.map((r) => roomRow(r, false, "Hue"));
const order = rooms.map((r) => r.name);
const lightItems = [...lights].sort((a, b) => (a.room ? order.indexOf(a.room.name) : 99) - (b.room ? order.indexOf(b.room.name) : 99) || a.name.localeCompare(b.name)).map((l) => lightRow(l, false, "Hue"));
const sceneItems = scenes.map((s) => sceneRow(s, false, "Hue"));
const sensorItems = sensorRows(sensors, false, () => "Hue");
const automationItems = automationsOf(home).map((a) => automationRow(a, false, "Hue"));

const lightView = render({ kind: "light", light: sofa, room: living }, fresh(), livingScenes);
const roomView = render({ kind: "room", room: bedroom }, { ...fresh(), focus: "scenes", index: 1 }, bedroomScenes);
const NOW = 1_758_050_000_000;
const setupView = renderSetup({ phase: "press", ip: "192.168.1.25", name: "Hue Bridge", id: "ecb5fafffe8c0231", deadline: NOW + 23_000, attempts: 7 }, [], [], NOW);

const fixture = {
  palettes: {
    rooms: { title: "Hue Rooms", icon: ICON, live: true, placeholder: "Search rooms and zones", items: roomItems, details: { "room:living-room": { metadata: [{ label: "Room", value: "Living room" }, { label: "Lights", value: "Ceiling (on), Sofa lamp (on), TV strip (on)" }, { label: "State", value: "3 of 3 on, 72%" }, { label: "Id", value: "room:living-room" }] } } },
    lights: { title: "Hue Lights", icon: ICON, live: true, placeholder: "Search lights", items: lightItems },
    scenes: { title: "Hue Scenes", icon: ICON, live: true, placeholder: "Search scenes", items: sceneItems },
    sensors: { title: "Hue Sensors", icon: ICON, live: true, placeholder: "Search sensors and switches", items: sensorItems },
    automations: { title: "Hue Automations", icon: ICON, live: true, placeholder: "Search automations", items: automationItems },
    light: { title: "Hue Light", icon: ICON, view: "view", tree: lightView },
    room: { title: "Hue Light", icon: ICON, view: "view", tree: roomView },
    setup: { title: "Set up Hue", icon: ICON, view: "view", tree: setupView },
  },
  effects: {
    "light/light:sofa-lamp:bri+": { view: render({ kind: "light", light: { ...sofa, brightness: 77 }, room: living }, fresh(), livingScenes) },
    "room/room:bedroom:along:next": { view: render({ kind: "room", room: bedroom }, { ...fresh(), focus: "scenes", index: 0 }, bedroomScenes) },
  },
  shots: {
    "1-rooms": { palette: "rooms", keys: ["wait:300", "down*2", "wait:300"] },
    // The view's strips and plane are gradients: true colour, like the colour picker's.
    "2-light": { palette: "light", keys: ["wait:400", "right", "wait:500"], raw: true },
    "3-room": { palette: "room", keys: ["wait:400", "right", "wait:500"], raw: true },
    "4-scenes": { palette: "scenes", keys: ["wait:300", "down*4", "wait:300"] },
    "5-sensors": { palette: "sensors", keys: ["wait:300", "down*4", "wait:300"] },
    "6-setup": { palette: "setup", keys: ["wait:400"], raw: true },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/hue.json", import.meta.url), JSON.stringify(fixture) + "\n");

// The bar item: the sample home with the living room as the main room.
const on = lights.filter((l) => l.on).length;
const menu = [
  { type: "section", title: "Rooms", children: rooms.map((r) => { const ag = aggregate(r); return { type: "item", id: `toggle:${r.id}`, title: r.name, subtitle: ag.on ? `${ag.on} of ${ag.total} on${ag.brightness !== undefined ? ` · ${Math.round(ag.brightness)}%` : ""}` : "off", icon: ag.anyOn ? { image: roomTile(ag.colors, (ag.brightness ?? 100) / 100) } : G.bulbOff, checked: ag.anyOn }; }) },
  { type: "section", title: "Scenes", children: livingScenes.map((sc) => ({ type: "item", id: `scene:${sc.id}`, title: sc.name, subtitle: sc.room?.name, icon: sc.swatches[0] ?? G.palette, checked: sc.active !== "inactive" })) },
  { type: "separator" },
  { type: "item", id: "open", title: "Open in pal", subtitle: "Rooms, lights, scenes", icon: G.home },
  { type: "item", id: "all_off", title: "All off", icon: G.power, style: "destructive", shortcut: "cmd+shift+o" },
];
const bar = {
  key: "hue/home",
  title: "Home",
  // The real strip carries the room's colour as a PNG dot (`dotPng`); the gallery's bar page draws glyphs only, so the shot shows the bulb in amber.
  item: { icon: G.bulb, color: "amber", title: `${on} on`, tooltip: `${on} of ${lights.length} lights on · Living room 72%`, menu },
  states: [
    { id: "off", item: { icon: G.bulbOff, title: null, color: "muted", tooltip: "All lights off" } },
    { id: "stale", item: { stale: true, tooltip: `${on} of ${lights.length} lights on (stale)` } },
  ],
  shots: {
    "bar-menubar-dark": { target: "menubar", theme: "dark", caption: "On the menu bar: how many lights are on (the live strip carries the main room's colour as a dot; the gallery draws the bulb)" },
    "bar-menubar-light": { target: "menubar", theme: "light", caption: "The same item on a light menu bar" },
    "bar-menubar-popover": { target: "menubar", theme: "light", popover: true, caption: "A click opens the popover: every room as a toggle, the scenes, All off" },
    "bar-sketchybar": { target: "sketchybar", theme: "dark", caption: "On sketchybar: the glyph and the count on the label" },
  },
};
writeFileSync(new URL("../../app/src/gallery/shots/bar-hue.json", import.meta.url), JSON.stringify(bar) + "\n");
console.log(`${roomItems.length} rooms, ${lightItems.length} lights, ${sceneItems.length} scenes, ${sensorItems.length} sensors; the bar says ${on} on`);
