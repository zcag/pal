// The rows the list palettes answer, from the model: rooms (a tile in the
// room's colour), lights by room (a swatch, a brightness bar), scenes (a
// five-swatch strip), sensors, automations, entertainment areas, and the
// hint rows for a home with nothing paired or a bridge away. Pure: the
// fixture renders the same rows.
import { errorMessage, hint as hintRow, type Accessory, type Action, type Item } from "@zcag/pal";
import { toHex, dim, lux as _lux } from "./color.ts";
import { HueError } from "./api.ts";
import { aggregate, lightColor, lightHex, pct, type Automation, type Entertainment, type Light, type Room, type Scene, type Sensor } from "./model.ts";

export const NAME = "hue";
export const G = {
  bulb: "\u{f0335}", bulbOff: "\u{f0336}", group: "\u{f1253}", sofa: "\u{f04b9}", home: "\u{f02dc}", motion: "\u{f0d91}", thermometer: "\u{f050f}", sun: "\u{f05a8}", button: "\u{f12a8}",
  dial: "\u{f0467}", battery: "\u{f0079}", batteryLow: "\u{f12a1}", palette: "\u{f03d8}", play: "\u{f040a}", stop: "\u{f04db}", robot: "\u{f06a9}", tv: "\u{f0ecf}", link: "\u{f0337}",
  power: "\u{f0425}", copy: "\u{f018f}", refresh: "\u{f0450}", alert: "\u{f0026}", cog: "\u{f0493}", key: "\u{f0306}", contact: "\u{f081a}", check: "\u{f012c}", zone: "\u{f0765}",
  brightness: "\u{f00df}", creation: "\u{f0674}", fire: "\u{f0238}", candle: "\u{f05e2}", shimmer: "\u{f1545}", router: "\u{f0469}",
};
export const ICON = { tile: { glyph: G.bulb, bg: "amber" } };

const svg = (body: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${body}</svg>`)}`;
/** A rounded square of the room's lit lights' colours as stripes, faded by the brightness (0..1); an off room is an outline. */
export function roomTile(colors: string[] = [], brightness = 1): string {
  if (!colors.length) return svg(`<rect x="1.6" y="1.6" width="12.8" height="12.8" rx="3.6" fill="none" stroke="#8a8f98" stroke-width="1.2"/>`);
  const shown = [...new Set(colors)].slice(0, 5);
  const opacity = (0.45 + 0.55 * Math.max(0, Math.min(1, brightness))).toFixed(2);
  if (shown.length === 1) return svg(`<rect x="1" y="1" width="14" height="14" rx="4" fill="${shown[0]}" fill-opacity="${opacity}"/>`);
  const stops = shown.flatMap((c, i) => [`<stop offset="${(i / shown.length * 100).toFixed(1)}%" stop-color="${c}"/>`, `<stop offset="${((i + 1) / shown.length * 100).toFixed(1)}%" stop-color="${c}"/>`]).join("");
  return svg(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs><rect x="1" y="1" width="14" height="14" rx="4" fill="url(#g)" fill-opacity="${opacity}"/>`);
}
/** Five stripes of a scene's swatches under one rounded clip; a scene with no colours is a grey outline. */
export function sceneStrip(swatches: string[]): string {
  if (!swatches.length) return roomTile([]);
  const w = 14 / swatches.length;
  const stripes = swatches.map((c, i) => `<rect x="${(1 + i * w).toFixed(2)}" y="1" width="${(w + 0.2).toFixed(2)}" height="14" fill="${c}"/>`).join("");
  return svg(`<defs><clipPath id="c"><rect x="1" y="1" width="14" height="14" rx="4"/></clipPath></defs><g clip-path="url(#c)">${stripes}</g>`);
}

const tag = (text: string, color: string): Accessory => ({ tag: text, color });
const onTag = (on: boolean) => (on ? tag("on", "green") : tag("off", "grey"));


export const ROOM_ACTIONS: Action[] = [
  { id: "toggle", title: "Toggle", shortcut: "enter" },
  { id: "open", title: "Open room", shortcut: "cmd+enter" },
  { id: "on", title: "Turn on" },
  { id: "off", title: "Turn off" },
  { id: "scenes", title: "Scenes of the room", shortcut: "cmd+s" },
  { id: "lights", title: "Lights in the room", shortcut: "cmd+l" },
  { id: "copy_id", title: "Copy id", shortcut: "cmd+shift+c" },
];
export const LIGHT_ACTIONS: Action[] = [
  { id: "toggle", title: "Toggle", shortcut: "enter" },
  { id: "open", title: "Open light", shortcut: "cmd+enter" },
  { id: "on", title: "Turn on" },
  { id: "off", title: "Turn off" },
  { id: "identify", title: "Blink to find it", shortcut: "cmd+b" },
  { id: "copy_hex", title: "Copy colour", shortcut: "cmd+c" },
  { id: "copy_id", title: "Copy id", shortcut: "cmd+shift+c" },
];
export const SCENE_ACTIONS: Action[] = [
  { id: "activate", title: "Activate", shortcut: "enter" },
  { id: "dynamic", title: "Play dynamically", shortcut: "cmd+enter" },
  { id: "room", title: "Open room", shortcut: "cmd+o" },
  { id: "copy_id", title: "Copy id", shortcut: "cmd+shift+c" },
];
export const SENSOR_ACTIONS: Action[] = [
  { id: "copy_value", title: "Copy value", shortcut: "enter" },
  { id: "toggle_enabled", title: "Enable or disable", shortcut: "cmd+e" },
  { id: "copy_id", title: "Copy id", shortcut: "cmd+shift+c" },
];
export const AUTOMATION_ACTIONS: Action[] = [
  { id: "toggle_enabled", title: "Enable or disable", shortcut: "enter" },
  { id: "copy_id", title: "Copy id", shortcut: "cmd+shift+c" },
];
export const ENTERTAINMENT_ACTIONS: Action[] = [
  { id: "start", title: "Start streaming", shortcut: "enter" },
  { id: "stop", title: "Stop streaming", shortcut: "cmd+enter" },
  { id: "copy_id", title: "Copy id", shortcut: "cmd+shift+c" },
];

const withBridge = (text: string, bridge: string, several: boolean) => (several ? `${text} · ${bridge}` : text);

export function roomRow(r: Room, several: boolean, bridgeName: string): Item {
  const a = aggregate(r);
  const bri = pct(a.brightness);
  const state = a.on === 0 ? "all off" : a.on === a.total ? `all ${a.total} on` : `${a.on} of ${a.total} on`;
  return {
    id: r.id, name: r.name,
    subtitle: withBridge(`${r.kind === "zone" ? "Zone" : "Room"} · ${state}${a.on && bri !== undefined ? ` · ${bri}%` : ""}`, bridgeName, several),
    icon: { image: roomTile(a.anyOn ? a.colors : [], (bri ?? 100) / 100) },
    keywords: [r.kind, r.id.slice(r.id.indexOf(":") + 1), ...r.lights.map((l) => l.name)],
    accessories: [...(a.anyOn && bri !== undefined ? [{ text: `${bri}%` }] : []), onTag(a.anyOn)],
    actions: a.anyOn ? ROOM_ACTIONS : ROOM_ACTIONS.map((x) => (x.id === "on" ? { ...x, title: "Turn on" } : x)),
  };
}

export function lightRow(l: Light, several: boolean, bridgeName: string): Item {
  const bri = pct(l.brightness);
  const kelvinText = l.mirek && l.mirekValid !== false && !(l.xy && !l.mirekValid) ? `${Math.round(1_000_000 / l.mirek)} K` : undefined;
  const acc: Accessory[] = [];
  if (l.reach === "disconnected" || l.reach === "connectivity_issue") acc.push(tag("unreachable", "red"));
  if (l.effect) acc.push(tag(l.effect, "violet"));
  if (l.on && bri !== undefined) acc.push({ text: `${bri}%` });
  acc.push(onTag(l.on));
  return {
    id: l.id, name: l.name,
    subtitle: withBridge([l.room?.name ?? "No room", archetypeName(l.archetype), l.on && kelvinText ? kelvinText : undefined].filter(Boolean).join(" · "), bridgeName, several),
    icon: l.on ? lightHex(l) : G.bulbOff,
    section: l.room?.name ?? "No room",
    keywords: [l.id.slice(6), l.room?.name ?? "", "light"].filter(Boolean),
    accessories: acc,
    actions: LIGHT_ACTIONS,
    /** The brightness, for the detail pane and the fixture; the UI ignores it. */
    brightness: bri,
  };
}

export function sceneRow(s: Scene, several: boolean, bridgeName: string): Item {
  const acc: Accessory[] = [];
  if (s.active !== "inactive") acc.push(tag(s.active === "dynamic_palette" ? "playing" : "active", "green"));
  if (s.dynamic) acc.push(tag("dynamic", "violet"));
  if (s.kind === "smart") acc.push(tag("smart", "blue"));
  return {
    id: s.id, name: s.name,
    subtitle: withBridge(s.room ? s.room.name : "Whole home", bridgeName, several),
    icon: s.kind === "smart" ? G.creation : { image: sceneStrip(s.swatches) },
    section: s.room?.name ?? "Whole home",
    keywords: ["scene", s.room?.name ?? ""].filter(Boolean),
    accessories: acc,
    actions: s.kind === "smart" ? SCENE_ACTIONS.filter((a) => a.id !== "dynamic").map((a) => (a.id === "activate" ? { ...a, title: s.active === "inactive" ? "Activate" : "Deactivate" } : a)) : s.dynamic ? SCENE_ACTIONS : SCENE_ACTIONS.filter((a) => a.id !== "dynamic"),
  };
}

const SENSOR_GLYPH: Record<Sensor["kind"], string> = { motion: G.motion, temperature: G.thermometer, light_level: G.sun, button: G.button, rotary: G.dial, contact: G.contact };

/** The sensor rows in the model's order, the device's battery on its first row only. */
export function sensorRows(sensors: Sensor[], several: boolean, bridgeName: (bridge: string) => string): Item[] {
  const seen = new Set<string>();
  return sensors.map((s) => { const first = !seen.has(`${s.bridge}/${s.device}`); seen.add(`${s.bridge}/${s.device}`); return sensorRow(s, several, bridgeName(s.bridge), first); });
}

export function sensorRow(s: Sensor, several: boolean, bridgeName: string, battery = true): Item {
  const acc: Accessory[] = [];
  if (battery && s.battery !== undefined) acc.push(s.batteryState && s.batteryState !== "normal" ? tag(`${s.battery}%`, "red") : { text: `${s.battery}%` });
  if (s.enabled === false) acc.push(tag("disabled", "grey"));
  if (s.changed) acc.push({ date: s.changed });
  return {
    id: s.id, name: s.name, subtitle: withBridge(s.value, bridgeName, several),
    icon: s.kind === "motion" && s.value === "motion" ? { glyph: G.motion, color: "green" } : SENSOR_GLYPH[s.kind],
    section: s.device, keywords: [s.kind.replace("_", " "), s.device],
    accessories: acc,
    actions: s.enabled === undefined ? SENSOR_ACTIONS.filter((a) => a.id !== "toggle_enabled") : SENSOR_ACTIONS.map((a) => (a.id === "toggle_enabled" ? { ...a, title: s.enabled ? "Disable" : "Enable" } : a)),
  };
}

export function automationRow(a: Automation, several: boolean, bridgeName: string): Item {
  const acc: Accessory[] = [];
  if (a.error) acc.push(tag("error", "red"));
  acc.push(a.enabled ? tag(a.status === "running" ? "running" : a.status ?? "enabled", a.status === "errored" ? "red" : "green") : tag("disabled", "grey"));
  return {
    id: a.id, name: a.name, subtitle: withBridge([a.script, a.category].filter(Boolean).join(" · ") || "Automation", bridgeName, several),
    icon: G.robot, keywords: ["automation", a.script ?? ""].filter(Boolean), accessories: acc,
    actions: AUTOMATION_ACTIONS.map((x) => (x.id === "toggle_enabled" ? { ...x, title: a.enabled ? "Disable" : "Enable" } : x)),
  };
}

export function entertainmentRow(e: Entertainment, several: boolean, bridgeName: string): Item {
  return {
    id: e.id, name: e.name, subtitle: withBridge(`${e.type} · ${e.lights} ${e.lights === 1 ? "light" : "lights"}`, bridgeName, several),
    icon: G.tv, keywords: ["entertainment", e.type], accessories: [e.active ? tag("streaming", "green") : tag("idle", "grey")],
    actions: e.active ? [ENTERTAINMENT_ACTIONS[1], ENTERTAINMENT_ACTIONS[0], ENTERTAINMENT_ACTIONS[2]] : ENTERTAINMENT_ACTIONS,
  };
}

/** `sultan_bulb` as `Sultan bulb`. */
export const archetypeName = (a: string) => a.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** The one inert row a broken setup lists, with the fix. */
export const hint = (e: unknown): Item[] => [hintRow("error", e instanceof HueError ? e.message : `Hue: ${errorMessage(e)}`, e instanceof HueError ? e.hint : undefined, { icon: G.alert })];

/** The row a home with no bridge lists: Enter opens the setup. */
export const SETUP_ROW: Item = { id: "setup", name: "Set up Hue", subtitle: "Find the bridge, press its button, done", icon: G.router, keywords: ["pair", "bridge"], actions: [{ id: "setup", title: "Set up Hue", shortcut: "enter" }] };

/** The detail pane of a light. */
export function lightDetail(l: Light) {
  const c = lightColor(l);
  return {
    metadata: [
      { label: "Light", value: l.name },
      { label: "Room", value: l.room?.name ?? "None" },
      { label: "State", value: l.on ? `On${l.brightness !== undefined ? `, ${pct(l.brightness)}%` : ""}` : "Off" },
      ...(l.mirek ? [{ label: "Temperature", value: `${Math.round(1_000_000 / l.mirek)} K (${l.mirek} mirek)` }] : []),
      ...(l.xy ? [{ label: "Colour", value: `${toHex(c)} (xy ${l.xy.x.toFixed(4)}, ${l.xy.y.toFixed(4)}${l.gamutType ? `, gamut ${l.gamutType}` : ""})` }] : []),
      ...(l.effects.length ? [{ label: "Effects", value: l.effects.join(", ") }] : []),
      { label: "Reachable", value: l.reach === "unknown" ? "Unknown" : l.reach.replace(/_/g, " ") },
      { label: "Type", value: archetypeName(l.archetype) },
      { label: "Id", value: l.id },
    ],
  };
}

export { dim, _lux as lux };
