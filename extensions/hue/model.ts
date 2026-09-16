// The home as the palettes read it: every bridge's resources in one map,
// kept current by the event stream (`merge`), and the derived shapes the
// rows and the view draw (`lightsOf`, `roomsOf`, `scenesOf`, `sensorsOf`,
// `automationsOf`, `entertainmentOf`). Ids are readable slugs of the names
// (`room:living-room`, `scene:living-room/relax`), so a deep link, an
// `item_hotkeys` entry or a fixture reads without a UUID; the model maps
// them back to the bridge's ids. Pure: no pal imports, no I/O.
import { GAMUTS, WARM, clamp, dim, mirekToRgb, toHex, xyToRgb, type Gamut, type RGB, type XY } from "./color.ts";
import type { HueEvent, Ref, Resource } from "./api.ts";

export type Effect = "prism" | "opal" | "glisten" | "sparkle" | "fire" | "candle" | "underwater" | "cosmos" | "sunbeam" | "enchant" | "no_effect";
export type Reach = "connected" | "disconnected" | "connectivity_issue" | "unidirectional_incoming" | "unknown";

export type Light = {
  id: string; rid: string; bridge: string; name: string; archetype: string;
  on: boolean; brightness?: number; minDim?: number;
  mirek?: number; mirekRange?: [number, number]; mirekValid?: boolean;
  xy?: XY; gamut?: Gamut; gamutType?: string;
  effect?: Effect; effects: Effect[];
  dynamics?: { status: string; speed: number };
  reach: Reach; room?: { id: string; name: string; kind: "room" | "zone" };
  mode: string;
};
export type Room = {
  id: string; rid: string; bridge: string; kind: "room" | "zone"; name: string; archetype: string;
  lights: Light[]; grouped?: { rid: string; on: boolean; brightness?: number };
};
export type Scene = {
  id: string; rid: string; bridge: string; kind: "scene" | "smart"; name: string;
  room?: { id: string; name: string }; active: "inactive" | "static" | "dynamic_palette";
  speed?: number; autoDynamic?: boolean; swatches: `#${string}`[]; dynamic: boolean;
};
export type Sensor = {
  id: string; rid: string; bridge: string; kind: "motion" | "temperature" | "light_level" | "button" | "rotary" | "contact";
  name: string; device: string; enabled?: boolean; value: string; changed?: string; battery?: number; batteryState?: string; control?: number;
};
export type Automation = { id: string; rid: string; bridge: string; name: string; enabled: boolean; status?: string; script?: string; category?: string; error?: string };
export type Entertainment = { id: string; rid: string; bridge: string; name: string; type: string; active: boolean; lights: number };
export type BridgeInfo = { id: string; name: string; ip: string; timeZone?: string };

/** A slug of a name: lower-case ASCII words joined by `-`. */
export function slug(name: string): string {
  const s = name.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/ß/g, "ss").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "unnamed";
}

/** One home: every bridge's resources by `<bridge>/<rid>`, so two bridges never collide. */
export class Home {
  readonly resources = new Map<string, Resource & { bridge: string }>();
  readonly bridges = new Map<string, BridgeInfo>();
  /** Bumped on every change; the rows' cache key. */
  version = 0;

  /** Replace one bridge's resources whole (a full `GET /clip/v2/resource`). */
  load(bridge: BridgeInfo, all: Resource[]) {
    for (const k of [...this.resources.keys()]) if (k.startsWith(`${bridge.id}/`)) this.resources.delete(k);
    for (const r of all) this.resources.set(`${bridge.id}/${r.id}`, { ...r, bridge: bridge.id });
    const b = all.find((r) => r.type === "bridge") as { time_zone?: { time_zone?: string } } | undefined;
    this.bridges.set(bridge.id, { ...bridge, timeZone: b?.time_zone?.time_zone });
    this.version++;
  }

  forget(bridge: string) {
    for (const k of [...this.resources.keys()]) if (k.startsWith(`${bridge}/`)) this.resources.delete(k);
    this.bridges.delete(bridge);
    this.version++;
  }

  /** One stream event into the map: `update` patches (objects merged, arrays replaced), `add` inserts, `delete` removes. Answers the ids touched. */
  merge(bridge: string, ev: HueEvent): string[] {
    const touched: string[] = [];
    for (const d of ev.data) {
      if (!d?.id) continue;
      const k = `${bridge}/${d.id}`;
      if (ev.type === "delete") { if (this.resources.delete(k)) touched.push(d.id); continue; }
      const cur = this.resources.get(k);
      if (ev.type === "add") { this.resources.set(k, { ...d, bridge }); touched.push(d.id); continue; }
      if (!cur) continue;
      this.resources.set(k, deepMerge(cur, d) as Resource & { bridge: string });
      touched.push(d.id);
    }
    if (touched.length) this.version++;
    return touched;
  }

  get(bridge: string, rid: string) { return this.resources.get(`${bridge}/${rid}`); }
  ofType(type: string) { return [...this.resources.values()].filter((r) => r.type === type); }
  get paired() { return this.bridges.size > 0; }
}

export function deepMerge(base: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || !base || typeof base !== "object" || Array.isArray(base)) return patch;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = deepMerge(out[k], v);
  return out;
}

// ---- derived --------------------------------------------------------------

type Any = Record<string, any>;
const name = (r: Any) => String(r.metadata?.name ?? r.id);

/** Slugs made unique within one prefix: a second "Lamp" is `lamp-2`, in a stable order. */
function unique<T extends { rid: string; bridge: string }>(items: (T & { slugBase: string })[], prefix: string): (T & { id: string })[] {
  const seen = new Map<string, number>();
  return [...items].sort((a, b) => a.slugBase.localeCompare(b.slugBase) || a.bridge.localeCompare(b.bridge) || a.rid.localeCompare(b.rid)).map((it) => {
    const n = (seen.get(it.slugBase) ?? 0) + 1;
    seen.set(it.slugBase, n);
    const { slugBase, ...rest } = it;
    return { ...rest, id: `${prefix}:${slugBase}${n > 1 ? `-${n}` : ""}` } as unknown as T & { id: string };
  });
}

const reachOf = (home: Home, bridge: string, device?: Ref): Reach => {
  const d = device?.rtype === "device" ? (home.get(bridge, device.rid) as Any | undefined) : undefined;
  for (const s of (d?.services ?? []) as Ref[]) {
    if (s.rtype !== "zigbee_connectivity") continue;
    const z = home.get(bridge, s.rid) as Any | undefined;
    if (z?.status) return z.status as Reach;
  }
  return "unknown";
};

/** The light services a room or zone holds: a room's children are devices (their light services), a zone's are lights. */
function lightRids(home: Home, bridge: string, group: Any): Set<string> {
  const out = new Set<string>();
  for (const c of (group.children ?? []) as Ref[]) {
    if (c.rtype === "light") out.add(c.rid);
    else if (c.rtype === "device") for (const s of ((home.get(bridge, c.rid) as Any | undefined)?.services ?? []) as Ref[]) if (s.rtype === "light") out.add(s.rid);
  }
  return out;
}

/** Every light, by name; `room` is the room that holds its device (a zone never claims a light). */
export function lightsOf(home: Home): Light[] {
  const rooms = home.ofType("room").map((r) => ({ r, rids: lightRids(home, r.bridge, r) }));
  const roomIds = new Map(roomsOf(home, false).map((r) => [`${r.bridge}/${r.rid}`, r.id]));
  const items = home.ofType("light").map((r) => {
    const l = r as Any;
    const room = rooms.find((x) => x.r.bridge === r.bridge && x.rids.has(r.id))?.r;
    const range = l.color_temperature?.mirek_schema;
    const effects: Effect[] = l.effects_v2?.status?.effect_values ?? l.effects?.effect_values ?? l.effects?.status_values ?? [];
    const effect: Effect | undefined = l.effects_v2?.status?.effect ?? l.effects?.status ?? l.effects?.effect;
    // The bridge reports the running effect as `status`; a PUT (and the mock's echo of one) names it `effect`.
    return {
      slugBase: slug(name(l)), rid: r.id, bridge: r.bridge, name: name(l), archetype: String(l.metadata?.archetype ?? "unknown_archetype"),
      on: !!l.on?.on, brightness: typeof l.dimming?.brightness === "number" ? l.dimming.brightness : undefined, minDim: l.dimming?.min_dim_level,
      mirek: typeof l.color_temperature?.mirek === "number" ? l.color_temperature.mirek : undefined, mirekValid: l.color_temperature?.mirek_valid,
      mirekRange: l.color_temperature ? [range?.mirek_minimum ?? 153, range?.mirek_maximum ?? 500] as [number, number] : undefined,
      xy: l.color?.xy, gamut: l.color?.gamut ?? (l.color ? GAMUTS[l.color.gamut_type as string] ?? GAMUTS.C : undefined), gamutType: l.color?.gamut_type,
      effect: effect && effect !== "no_effect" ? effect : undefined, effects: effects.filter((e) => e !== "no_effect"),
      dynamics: l.dynamics ? { status: String(l.dynamics.status ?? "none"), speed: Number(l.dynamics.speed ?? 0) } : undefined,
      reach: reachOf(home, r.bridge, r.owner), mode: String(l.mode ?? "normal"),
      room: room ? { id: roomIds.get(`${room.bridge}/${room.id}`)!, name: name(room), kind: "room" as const } : undefined,
    };
  });
  return unique(items, "light");
}

/** Rooms then zones, each with its lights and its grouped light. */
export function roomsOf(home: Home, withLights = true): Room[] {
  const lights = withLights ? lightsOf(home) : [];
  const byRid = new Map(lights.map((l) => [`${l.bridge}/${l.rid}`, l]));
  const groups = (type: "room" | "zone") => home.ofType(type).map((r) => {
    const g = r as Any;
    const rids = lightRids(home, r.bridge, g);
    const gl = ((g.services ?? []) as Ref[]).find((s) => s.rtype === "grouped_light");
    const grouped = gl ? (home.get(r.bridge, gl.rid) as Any | undefined) : undefined;
    return {
      slugBase: slug(name(g)), rid: r.id, bridge: r.bridge, kind: type, name: name(g), archetype: String(g.metadata?.archetype ?? "other"),
      lights: [...rids].map((rid) => byRid.get(`${r.bridge}/${rid}`)).filter((l): l is Light => !!l).sort((a, b) => a.name.localeCompare(b.name)),
      grouped: gl ? { rid: gl.rid, on: !!grouped?.on?.on, brightness: typeof grouped?.dimming?.brightness === "number" ? grouped.dimming.brightness : undefined } : undefined,
    };
  });
  return [...unique(groups("room"), "room"), ...unique(groups("zone"), "zone")];
}

/** Colour of a light as shown: its xy at full value, else its temperature, else warm white; black when off. */
export function lightColor(l: Light): RGB {
  if (l.xy && !(l.mirekValid && l.mirek)) return xyToRgb(l.xy, 1, l.gamut);
  if (l.mirek) return mirekToRgb(l.mirek);
  return WARM;
}
export const lightHex = (l: Light) => toHex(lightColor(l));

/**
 * What a room shows: how many of its lights are on, each lit light's
 * colour (`colors`, for a tile of stripes), the one that stands for the
 * room (`color`: the most saturated, since a mean of a blue strip and two
 * whites is grey), and `hex`, that colour dimmed by the grouped brightness.
 */
export function aggregate(room: Room): { on: number; total: number; brightness?: number; color?: RGB; colors: `#${string}`[]; hex?: `#${string}`; anyOn: boolean } {
  const on = room.lights.filter((l) => l.on);
  const brightness = room.grouped?.brightness ?? (on.length ? on.reduce((a, l) => a + (l.brightness ?? 100), 0) / on.length : undefined);
  const rgbs = on.map(lightColor);
  const sat = (c: RGB) => { const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b); return max === 0 ? 0 : (max - min) / max; };
  const color = rgbs.length ? rgbs.reduce((best, c) => (sat(c) > sat(best) + 1e-6 ? c : best)) : undefined;
  return { on: on.length, total: room.lights.length, brightness, color, colors: rgbs.map(toHex), hex: color ? toHex(dim(color, (brightness ?? 100) / 100)) : undefined, anyOn: room.grouped?.on ?? on.length > 0 };
}

/** Up to five swatches of a scene: its palette's colours, else the colours its actions set, temperatures as their white. */
export function swatchesOf(scene: Any): `#${string}`[] {
  const out: `#${string}`[] = [];
  const push = (c: RGB) => { const h = toHex(c); if (!out.includes(h)) out.push(h); };
  for (const p of (scene.palette?.color ?? []) as Any[]) if (p.color?.xy) push(xyToRgb(p.color.xy, 1));
  for (const p of (scene.palette?.color_temperature ?? []) as Any[]) if (p.color_temperature?.mirek) push(mirekToRgb(p.color_temperature.mirek));
  if (!out.length) for (const a of (scene.actions ?? []) as Any[]) {
    const act = a.action ?? {};
    if (act.color?.xy) push(xyToRgb(act.color.xy, 1));
    else if (act.color_temperature?.mirek) push(mirekToRgb(act.color_temperature.mirek));
    else if (act.on?.on) push(WARM);
  }
  return out.slice(0, 5);
}

/** Scenes and smart scenes, by room then name. */
export function scenesOf(home: Home): Scene[] {
  const rooms = new Map(roomsOf(home, false).map((r) => [`${r.bridge}/${r.rid}`, r]));
  const roomOf = (bridge: string, g?: Ref) => { const r = g ? rooms.get(`${bridge}/${g.rid}`) : undefined; return r ? { id: r.id, name: r.name } : undefined; };
  const items = home.ofType("scene").map((r) => {
    const s = r as Any;
    const room = roomOf(r.bridge, s.group);
    return {
      slugBase: `${room ? room.id.replace(/^(room|zone):/, "") : "home"}/${slug(name(s))}`, rid: r.id, bridge: r.bridge, kind: "scene" as const, name: name(s), room,
      active: (s.status?.active ?? "inactive") as Scene["active"], speed: typeof s.speed === "number" ? s.speed : undefined, autoDynamic: !!s.auto_dynamic,
      swatches: swatchesOf(s), dynamic: ((s.palette?.color ?? []) as unknown[]).length > 1 || !!s.auto_dynamic,
    };
  });
  const smart = home.ofType("smart_scene").map((r) => {
    const s = r as Any;
    const room = roomOf(r.bridge, s.group);
    return { slugBase: `${room ? room.id.replace(/^(room|zone):/, "") : "home"}/${slug(name(s))}`, rid: r.id, bridge: r.bridge, kind: "smart" as const, name: name(s), room, active: (s.state === "active" ? "static" : "inactive") as Scene["active"], swatches: [] as `#${string}`[], dynamic: false };
  });
  return [...unique(items, "scene"), ...unique(smart, "smart")].sort((a, b) => (a.room?.name ?? "").localeCompare(b.room?.name ?? "") || a.name.localeCompare(b.name));
}

const sensorKinds: Record<string, Sensor["kind"]> = { motion: "motion", camera_motion: "motion", temperature: "temperature", light_level: "light_level", button: "button", relative_rotary: "rotary", contact: "contact" };

/** Every sensor service with the device's name, its value as text and when it last changed; the device's battery beside it. */
export function sensorsOf(home: Home): Sensor[] {
  const power = new Map<string, Any>();
  for (const p of home.ofType("device_power")) if (p.owner) power.set(`${p.bridge}/${(p.owner as Ref).rid}`, p as Any);
  const items: (Omit<Sensor, "id"> & { slugBase: string })[] = [];
  for (const r of home.resources.values()) {
    const kind = sensorKinds[r.type];
    if (!kind) continue;
    const s = r as Any;
    const device = r.owner?.rtype === "device" ? (home.get(r.bridge, r.owner.rid) as Any | undefined) : undefined;
    const deviceName = device ? name(device) : name(s);
    const control = s.metadata?.control_id;
    const label = control !== undefined && ["button", "rotary"].includes(kind) ? `${deviceName} · ${kind === "button" ? "button" : "dial"} ${control}` : `${deviceName} · ${{ motion: "motion", temperature: "temperature", light_level: "light level", button: "button", rotary: "dial", contact: "contact" }[kind]}`;
    let value = "", changed: string | undefined;
    switch (kind) {
      case "motion": value = s.motion?.motion_valid === false ? "no reading" : s.motion?.motion ? "motion" : "clear"; changed = s.motion?.motion_report?.changed; break;
      case "temperature": value = s.temperature?.temperature_valid === false ? "no reading" : `${Number(s.temperature?.temperature ?? 0).toFixed(1)} °C`; changed = s.temperature?.temperature_report?.changed; break;
      case "light_level": { const ll = s.light?.light_level; value = s.light?.light_level_valid === false || typeof ll !== "number" ? "no reading" : `${Math.round(Math.pow(10, (ll - 1) / 10000)).toLocaleString()} lux`; changed = s.light?.light_level_report?.changed; break; }
      case "button": value = String(s.button?.button_report?.event ?? s.button?.last_event ?? "no press yet").replace(/_/g, " "); changed = s.button?.button_report?.updated; break;
      case "rotary": { const rep = s.relative_rotary?.rotary_report ?? s.relative_rotary?.last_event; value = rep?.rotation ? `${rep.rotation.direction === "clock_wise" ? "clockwise" : "counter-clockwise"} ${rep.rotation.steps ?? 0} steps` : "no turn yet"; changed = s.relative_rotary?.rotary_report?.updated; break; }
      case "contact": value = String(s.contact_report?.state ?? "unknown").replace(/_/g, " "); changed = s.contact_report?.changed; break;
    }
    const p = r.owner ? power.get(`${r.bridge}/${r.owner.rid}`) : undefined;
    items.push({ slugBase: slug(label), rid: r.id, bridge: r.bridge, kind, name: label, device: deviceName, enabled: typeof s.enabled === "boolean" ? s.enabled : undefined, value, changed, battery: p?.power_state?.battery_level, batteryState: p?.power_state?.battery_state, control });
  }
  return unique(items, "sensor").sort((a, b) => a.device.localeCompare(b.device) || a.name.localeCompare(b.name));
}

/** `behavior_instance` rows (the app's automations: wake up, go to sleep, timers, motion), with the script's name. */
export function automationsOf(home: Home): Automation[] {
  const scripts = new Map(home.ofType("behavior_script").map((s) => [`${s.bridge}/${s.id}`, s as Any]));
  const items = home.ofType("behavior_instance").map((r) => {
    const b = r as Any;
    const script = scripts.get(`${r.bridge}/${b.script_id}`);
    const n = String(b.metadata?.name || script?.metadata?.name || "Automation");
    return { slugBase: slug(n), rid: r.id, bridge: r.bridge, name: n, enabled: !!b.enabled, status: b.status ? String(b.status) : undefined, script: script ? String(script.metadata?.name ?? "") : undefined, category: script?.metadata?.category ? String(script.metadata.category) : undefined, error: b.last_error ? String(b.last_error) : undefined };
  });
  return unique(items, "auto").sort((a, b) => a.name.localeCompare(b.name));
}

export function entertainmentOf(home: Home): Entertainment[] {
  const items = home.ofType("entertainment_configuration").map((r) => {
    const e = r as Any;
    return { slugBase: slug(name(e)), rid: r.id, bridge: r.bridge, name: name(e), type: String(e.configuration_type ?? "other"), active: e.status === "active", lights: ((e.light_services ?? []) as unknown[]).length };
  });
  return unique(items, "ent").sort((a, b) => a.name.localeCompare(b.name));
}

/** The brightness a light or room shows, 0..100, whole. */
export const pct = (v: number | undefined) => (v === undefined ? undefined : Math.round(clamp(v, 0, 100)));
