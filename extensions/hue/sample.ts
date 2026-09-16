// A small home as the bridge would send it (`GET /clip/v2/resource`), for
// the store screenshots' fixture and the tests' mock bridge: two rooms and
// a zone, six lights of three kinds, scenes with palettes, a motion
// sensor with its temperature and light level, a dimmer switch, an
// automation, an entertainment area. The shapes follow the CLIP v2 API
// (openhue's spec was the reference); the ids are readable rather than
// UUIDs, which nothing in the extension depends on.
import type { Resource } from "./api.ts";

const ref = (rtype: string, rid: string) => ({ rid, rtype });
const dev = (id: string, name: string, archetype: string, services: [string, string][], product = "Hue color lamp"): Resource => ({ id, type: "device", product_data: { model_id: "LCA001", manufacturer_name: "Signify Netherlands B.V.", product_name: product, product_archetype: archetype, certified: true, software_version: "1.104.2" }, metadata: { name, archetype }, identify: {}, services: services.map(([t, r]) => ref(t, r)) });
const zigbee = (id: string, owner: string, status = "connected"): Resource => ({ id, type: "zigbee_connectivity", owner: ref("device", owner), status, mac_address: "00:17:88:01:00:00:00:01" });
const GAMUT_C = { red: { x: 0.6915, y: 0.3083 }, green: { x: 0.17, y: 0.7 }, blue: { x: 0.1532, y: 0.0475 } };

type LightOpts = { on?: boolean; brightness?: number; mirek?: number | null; xy?: { x: number; y: number }; color?: boolean; ct?: boolean; effects?: string[]; effect?: string; archetype?: string };
const light = (id: string, owner: string, name: string, o: LightOpts): Resource => ({
  id, id_v1: `/lights/${id.slice(-1)}`, type: "light", owner: ref("device", owner),
  metadata: { name, archetype: o.archetype ?? "sultan_bulb", function: "mixed" }, identify: {}, service_id: 0,
  on: { on: o.on ?? false },
  dimming: { brightness: o.brightness ?? 100, min_dim_level: 0.2 },
  ...(o.ct !== false && { color_temperature: { mirek: o.mirek ?? null, mirek_valid: o.mirek != null, mirek_schema: { mirek_minimum: 153, mirek_maximum: 500 } } }),
  ...(o.color && { color: { xy: o.xy ?? { x: 0.4575, y: 0.4099 }, gamut: GAMUT_C, gamut_type: "C" } }),
  dynamics: { status: "none", status_values: ["none", "dynamic_palette"], speed: 0, speed_valid: false },
  alert: { action_values: ["breathe"] },
  ...(o.effects && { effects: { status_values: ["no_effect", ...o.effects], status: o.effect ?? "no_effect", effect_values: ["no_effect", ...o.effects] } }),
  mode: "normal",
});
const grouped = (id: string, ownerType: string, owner: string, on: boolean, brightness: number): Resource => ({ id, type: "grouped_light", owner: ref(ownerType, owner), on: { on }, dimming: { brightness }, alert: { action_values: ["breathe"] } });
const scene = (id: string, name: string, group: string, actions: { light: string; on?: boolean; brightness?: number; xy?: { x: number; y: number }; mirek?: number }[], o: { palette?: { x: number; y: number }[]; ct?: number; active?: string; speed?: number; auto?: boolean } = {}): Resource => ({
  id, type: "scene", metadata: { name, image: ref("public_image", `img-${id}`) }, group: ref("room", group),
  actions: actions.map((a) => ({ target: ref("light", a.light), action: { on: { on: a.on ?? true }, dimming: { brightness: a.brightness ?? 100 }, ...(a.xy && { color: { xy: a.xy } }), ...(a.mirek && { color_temperature: { mirek: a.mirek } }) } })),
  palette: { color: (o.palette ?? []).map((xy) => ({ color: { xy }, dimming: { brightness: 80 } })), dimming: [], color_temperature: o.ct ? [{ color_temperature: { mirek: o.ct }, dimming: { brightness: 80 } }] : [], effects: [] },
  speed: o.speed ?? 0.5, auto_dynamic: !!o.auto, status: { active: o.active ?? "inactive" },
});

export const SAMPLE_RESOURCES: Resource[] = [
  { id: "bridge-1", type: "bridge", owner: ref("device", "dev-bridge"), bridge_id: "ecb5fafffe000001", time_zone: { time_zone: "Europe/Istanbul" } },
  { id: "home-1", type: "bridge_home", children: [ref("device", "dev-bridge"), ref("room", "room-living"), ref("room", "room-bedroom")], services: [ref("grouped_light", "gl-home")] },
  dev("dev-bridge", "Hue Bridge", "bridge_v2", [["bridge", "bridge-1"], ["zigbee_connectivity", "zc-bridge"]], "Hue Bridge"),
  zigbee("zc-bridge", "dev-bridge"),
  // Living room: three lights, one of them a gradient strip.
  { id: "room-living", type: "room", metadata: { name: "Living room", archetype: "living_room" }, children: [ref("device", "dev-1"), ref("device", "dev-2"), ref("device", "dev-3")], services: [ref("grouped_light", "gl-living")] },
  dev("dev-1", "Sofa lamp", "table_shade", [["light", "light-1"], ["zigbee_connectivity", "zc-1"]]),
  dev("dev-2", "Ceiling", "ceiling_round", [["light", "light-2"], ["zigbee_connectivity", "zc-2"]], "Hue white ambiance"),
  dev("dev-3", "TV strip", "hue_lightstrip", [["light", "light-3"], ["zigbee_connectivity", "zc-3"]], "Hue gradient lightstrip"),
  light("light-1", "dev-1", "Sofa lamp", { on: true, brightness: 72, mirek: 366, color: true, xy: { x: 0.4575, y: 0.4099 }, effects: ["candle", "fire", "sparkle"], archetype: "table_shade" }),
  light("light-2", "dev-2", "Ceiling", { on: true, brightness: 100, mirek: 233, archetype: "ceiling_round" }),
  light("light-3", "dev-3", "TV strip", { on: true, brightness: 45, mirek: null, color: true, xy: { x: 0.1532, y: 0.0475 }, effects: ["candle", "fire", "prism", "opal", "glisten", "sparkle"], effect: "candle", archetype: "hue_lightstrip" }),
  zigbee("zc-1", "dev-1"), zigbee("zc-2", "dev-2"), zigbee("zc-3", "dev-3"),
  grouped("gl-living", "room", "room-living", true, 72),
  // Bedroom: two lights, one unreachable.
  { id: "room-bedroom", type: "room", metadata: { name: "Bedroom", archetype: "bedroom" }, children: [ref("device", "dev-4"), ref("device", "dev-5")], services: [ref("grouped_light", "gl-bedroom")] },
  dev("dev-4", "Bedside", "table_shade", [["light", "light-4"], ["zigbee_connectivity", "zc-4"]]),
  dev("dev-5", "Wardrobe", "wall_lantern", [["light", "light-5"], ["zigbee_connectivity", "zc-5"]], "Hue white lamp"),
  light("light-4", "dev-4", "Bedside", { on: false, brightness: 30, mirek: 447, color: true, effects: ["candle"], archetype: "table_shade" }),
  light("light-5", "dev-5", "Wardrobe", { on: false, brightness: 100, ct: false, archetype: "wall_lantern" }),
  zigbee("zc-4", "dev-4"), zigbee("zc-5", "dev-5", "disconnected"),
  grouped("gl-bedroom", "room", "room-bedroom", false, 30),
  // Hallway: one light in no scene's palette, a motion sensor with temperature and light level.
  { id: "room-hall", type: "room", metadata: { name: "Hallway", archetype: "hallway" }, children: [ref("device", "dev-6"), ref("device", "dev-motion")], services: [ref("grouped_light", "gl-hall")] },
  dev("dev-6", "Hall spot", "single_spot", [["light", "light-6"], ["zigbee_connectivity", "zc-6"]], "Hue white ambiance"),
  light("light-6", "dev-6", "Hall spot", { on: true, brightness: 40, mirek: 300, archetype: "single_spot" }),
  zigbee("zc-6", "dev-6"),
  grouped("gl-hall", "room", "room-hall", true, 40),
  // A zone across the living room lamp and the bedside.
  { id: "zone-evening", type: "zone", metadata: { name: "Evening", archetype: "other" }, children: [ref("light", "light-1"), ref("light", "light-4")], services: [ref("grouped_light", "gl-evening")] },
  grouped("gl-evening", "zone", "zone-evening", true, 51),
  grouped("gl-home", "bridge_home", "home-1", true, 64),
  // Scenes.
  scene("scene-relax", "Relax", "room-living", [{ light: "light-1", brightness: 57, mirek: 447 }, { light: "light-2", brightness: 57, mirek: 447 }, { light: "light-3", brightness: 57, mirek: 447 }], { ct: 447, active: "static" }),
  scene("scene-savanna", "Savanna sunset", "room-living", [{ light: "light-1", xy: { x: 0.5451, y: 0.4157 } }, { light: "light-2", mirek: 400 }, { light: "light-3", xy: { x: 0.6531, y: 0.3237 } }], { palette: [{ x: 0.6531, y: 0.3237 }, { x: 0.5451, y: 0.4157 }, { x: 0.4575, y: 0.4099 }, { x: 0.5016, y: 0.4147 }, { x: 0.6087, y: 0.3654 }], speed: 0.6, auto: true }),
  scene("scene-tropical", "Tropical twilight", "room-living", [{ light: "light-1", xy: { x: 0.1552, y: 0.1108 } }, { light: "light-3", xy: { x: 0.2073, y: 0.0949 } }], { palette: [{ x: 0.1552, y: 0.1108 }, { x: 0.2073, y: 0.0949 }, { x: 0.3, y: 0.15 }, { x: 0.1666, y: 0.3055 }, { x: 0.4, y: 0.2 }], speed: 0.4 }),
  scene("scene-read", "Read", "room-living", [{ light: "light-1", mirek: 346 }, { light: "light-2", mirek: 346 }, { light: "light-3", mirek: 346 }], { ct: 346 }),
  scene("scene-nightlight", "Nightlight", "room-bedroom", [{ light: "light-4", brightness: 1, mirek: 447 }, { light: "light-5", on: false }], { ct: 447 }),
  scene("scene-bright", "Bright", "room-bedroom", [{ light: "light-4", mirek: 233 }, { light: "light-5" }], { ct: 233 }),
  { id: "smart-natural", type: "smart_scene", metadata: { name: "Natural light", image: ref("public_image", "img-natural") }, group: ref("room", "room-living"), week_timeslots: [], transition_duration: 60000, state: "inactive" },
  // The motion sensor: three services on one device, a battery.
  dev("dev-motion", "Hallway sensor", "unknown_archetype", [["motion", "motion-1"], ["temperature", "temp-1"], ["light_level", "ll-1"], ["device_power", "power-motion"], ["zigbee_connectivity", "zc-motion"]], "Hue motion sensor"),
  { id: "motion-1", type: "motion", owner: ref("device", "dev-motion"), enabled: true, motion: { motion: true, motion_valid: true, motion_report: { changed: "2026-09-16T19:58:12Z", motion: true } }, sensitivity: { status: "set", sensitivity: 2, sensitivity_max: 4 } },
  { id: "temp-1", type: "temperature", owner: ref("device", "dev-motion"), enabled: true, temperature: { temperature: 22.4, temperature_valid: true, temperature_report: { changed: "2026-09-16T19:55:00Z", temperature: 22.4 } } },
  { id: "ll-1", type: "light_level", owner: ref("device", "dev-motion"), enabled: true, light: { light_level: 18000, light_level_valid: true, light_level_report: { changed: "2026-09-16T19:57:30Z", light_level: 18000 } } },
  { id: "power-motion", type: "device_power", owner: ref("device", "dev-motion"), power_state: { battery_state: "normal", battery_level: 84 } },
  zigbee("zc-motion", "dev-motion"),
  // A dimmer switch: four buttons, a battery running low.
  dev("dev-dimmer", "Bedroom dimmer", "unknown_archetype", [["button", "btn-1"], ["button", "btn-2"], ["button", "btn-3"], ["button", "btn-4"], ["device_power", "power-dimmer"], ["zigbee_connectivity", "zc-dimmer"]], "Hue dimmer switch"),
  { id: "btn-1", type: "button", owner: ref("device", "dev-dimmer"), metadata: { control_id: 1 }, button: { last_event: "short_release", button_report: { updated: "2026-09-16T18:40:03Z", event: "short_release" }, repeat_interval: 800, event_values: ["initial_press", "repeat", "short_release", "long_release", "long_press"] } },
  { id: "btn-2", type: "button", owner: ref("device", "dev-dimmer"), metadata: { control_id: 2 }, button: { event_values: ["initial_press", "repeat", "short_release", "long_release", "long_press"] } },
  { id: "btn-3", type: "button", owner: ref("device", "dev-dimmer"), metadata: { control_id: 3 }, button: { event_values: ["initial_press", "repeat", "short_release", "long_release", "long_press"] } },
  { id: "btn-4", type: "button", owner: ref("device", "dev-dimmer"), metadata: { control_id: 4 }, button: { last_event: "long_press", button_report: { updated: "2026-09-15T23:10:41Z", event: "long_press" }, event_values: ["initial_press", "repeat", "short_release", "long_release", "long_press"] } },
  { id: "power-dimmer", type: "device_power", owner: ref("device", "dev-dimmer"), power_state: { battery_state: "low", battery_level: 12 } },
  zigbee("zc-dimmer", "dev-dimmer"),
  // A tap dial: a rotary.
  dev("dev-dial", "Kitchen dial", "unknown_archetype", [["relative_rotary", "rot-1"], ["device_power", "power-dial"], ["zigbee_connectivity", "zc-dial"]], "Hue tap dial switch"),
  { id: "rot-1", type: "relative_rotary", owner: ref("device", "dev-dial"), metadata: { control_id: 0 }, relative_rotary: { rotary_report: { updated: "2026-09-16T19:20:00Z", action: "repeat", rotation: { direction: "clock_wise", steps: 45, duration: 400 } }, last_event: { action: "repeat", rotation: { direction: "clock_wise", steps: 45, duration: 400 } } } },
  { id: "power-dial", type: "device_power", owner: ref("device", "dev-dial"), power_state: { battery_state: "normal", battery_level: 97 } },
  zigbee("zc-dial", "dev-dial"),
  // Automations.
  { id: "script-wake", type: "behavior_script", metadata: { name: "Wake up", category: "automation" }, configuration_schema: {}, trigger_schema: {}, state_schema: {}, version: "0.0.1", supported_features: [] },
  { id: "script-motion", type: "behavior_script", metadata: { name: "Motion sensor", category: "automation" }, configuration_schema: {}, trigger_schema: {}, state_schema: {}, version: "0.0.1", supported_features: [] },
  { id: "auto-wake", type: "behavior_instance", script_id: "script-wake", enabled: true, status: "running", configuration: { when: { time_point: { type: "time", time: { hour: 7, minute: 15 } } } }, dependees: [], metadata: { name: "Weekday wake up" } },
  { id: "auto-hall", type: "behavior_instance", script_id: "script-motion", enabled: false, status: "disabled", configuration: {}, dependees: [], metadata: { name: "Hallway motion" } },
  // Entertainment.
  { id: "ent-tv", type: "entertainment_configuration", metadata: { name: "TV area" }, configuration_type: "screen", status: "inactive", stream_proxy: { mode: "auto", node: ref("entertainment", "e-3") }, channels: [], locations: { service_locations: [] }, light_services: [ref("light", "light-1"), ref("light", "light-3")] },
];

/** The key the mock bridge expects and the pairing hands out. */
export const SAMPLE_KEY = "pal-test-application-key-0001";
export const SAMPLE_BRIDGE_ID = "ecb5fafffe000001";
