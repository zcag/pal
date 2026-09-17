// The bar item's popover as a tree (`View` in `@zcag/pal`, 420 wide,
// `ctx.compact`): the home at a glance and in reach. A status row (how
// many lights are on, the motion and temperature sensors as badges, the
// bridge when it is away), the rooms as a grid of colour tiles (each in
// its lit colour with its name, a switch, the count and a thin brightness
// bar; an off room a plain card; a tap toggles it, the chevron opens it),
// the opened room's lights inline (a swatch, the name, a brightness
// slider, a switch), the scenes of the room in view as five-swatch tiles
// (a tap or a digit plays one), and the key hints. Pure: index.ts hands
// it the model's shapes and the in-process cursor state; the fixture
// draws the same tree from the sample home.
import { POPOVER_W, column, keyHint, row, text, type Action, type HexColor, type View, type ViewNode } from "@zcag/pal";
import { clamp, fromHex, toHex, type RGB } from "./color.ts";
import { aggregate, lightColor, pct, type Light, type Room, type Scene, type Sensor } from "./model.ts";

/** Where the keys land: the rooms grid, or the opened room's lights. */
export type PopoverState = { focus: "rooms" | "lights"; cursor: number; /** The room whose lights are shown inline. */ open?: string; light: number };
export const freshPopover = (): PopoverState => ({ focus: "rooms", cursor: 0, light: 0 });

/** What the popover draws, from the model. */
export type PopoverData = {
  rooms: Room[];
  /** The scenes to offer: the opened room's, else the main room's (or the `bar_scenes` setting's). */
  scenes: Scene[];
  /** Whose scenes they are. */
  scenesOf?: string;
  sensors: Sensor[];
  lightsOn: number;
  lightsTotal: number;
  /** Bridges that did not answer their last read, by name. */
  away: string[];
  paired: boolean;
  /** The bridge's name (the first, with several): the popover's title. */
  bridge?: string;
};

/** Two tiles a row, a gap between. */
export const TILE_W = 194, TILE_H = 50, GRID_GAP = 2;
const SWATCH_H = 20, SCENES_PER_ROW = 5, SCENE_W_MAX = 92;
const SLIDER_W = 132;
/** Scenes shown at most: the digits. */
const MAX_SCENES = 9;
const MAX_BADGES = 4;
export const VIEW_ID = "home";

const hint = (keys: string[], what: string, action?: string): ViewNode[] => keyHint(keys, what, { action });

/** The tile's colour for a lit room: its colour shaded by the brightness, gently (a 30% room still reads as its colour). */
export const shade = (c: RGB, share: number): HexColor => { const k = 0.62 + 0.38 * clamp(share, 0, 1); return toHex({ r: c.r * k, g: c.g * k, b: c.b * k }); };
/** Whether black ink goes on `hex` (the renderer's rule, so the brightness bar can be drawn in the tile's ink). */
export const darkInk = (hex: string): boolean => {
  const c = fromHex(hex);
  if (!c) return false;
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b) > 0.179;
};
/** The brightness bar on a coloured tile: the tile's ink at 70%. */
const barOn = (tile: HexColor): HexColor => (darkInk(tile) ? "#000000a8" : "#ffffffc0");

/** The rooms the grid shows: rooms first, then zones, as the model orders them; a room with no lights is left out. */
export const gridRooms = (rooms: Room[]): Room[] => rooms.filter((r) => r.lights.length > 0);

const roomKey = (r: Room) => r.id.slice(r.id.indexOf(":") + 1);

function roomTile(r: Room, selected: boolean, opened: boolean): ViewNode {
  const a = aggregate(r);
  const bri = pct(a.brightness);
  const on = a.anyOn && !!a.color;
  const surface: Extract<ViewNode, { type: "stack" }>["surface"] = on ? shade(a.color!, (bri ?? 100) / 100) : "elevated";
  // The grouped light says whether the room is on; the lights say how many (a bridge mid-update can disagree for a moment).
  const status = !a.anyOn ? "off" : a.on === 0 ? "on" : `${a.on === a.total ? (a.total === 1 ? "on" : `all ${a.total} on`) : `${a.on} of ${a.total} on`}${bri !== undefined ? ` · ${bri}%` : ""}`;
  const kids: ViewNode[] = [
    row([
      text(r.name, { style: "body", size: "md", weight: "semibold", width: TILE_W - 16 - 26 - 20 - 8 }),
      // The chevron opens the room's lights (a tap anywhere else toggles the room); on the opened room it closes them.
      { type: "tile", key: "chev", width: 20, height: 20, text: opened ? "‹" : "›", color: "neutral", fill: on ? "solid" : "soft", action: opened ? "back" : `open:${r.id}` },
      { type: "switch", key: "sw", on: a.anyOn, action: `toggle:${r.id}`, label: `${r.name} power` },
    ], { key: "head", gap: 1, justify: "between" }),
    row([text(status, { key: `st-${status}`, style: "muted", size: "xs", width: 120, transition: { enter: "fade", exit: "none" } }), ...(r.kind === "zone" ? [{ type: "badge", key: "zone", text: "zone", color: "grey" } as ViewNode] : [])], { key: "status", gap: 1, minHeight: 14 }),
    { type: "progress", key: "bri", value: a.anyOn ? (bri ?? 100) / 100 : 0, color: on ? barOn(surface as HexColor) : "grey" },
  ];
  return column(kids, { key: `room-${roomKey(r)}`, surface, radius: true, padding: 2, gap: 1, minHeight: TILE_H, action: `toggle:${r.id}`, ...(selected && { selected: true }), transition: { enter: "fade" } });
}

function grid(rooms: Room[], st: PopoverState): ViewNode {
  const rows: ViewNode[] = [];
  for (let i = 0; i < rooms.length; i += 2) {
    const pair = rooms.slice(i, i + 2).map((r, j) => roomTile(r, st.focus === "rooms" && st.cursor === i + j, st.open === r.id));
    rows.push(row(pair, { key: `row-${i / 2}`, gap: GRID_GAP, align: "stretch" }));
  }
  return column(rows, { key: "grid", gap: GRID_GAP });
}

function lightRow(l: Light, selected: boolean): ViewNode {
  const bri = pct(l.brightness);
  const hex = toHex(lightColor(l));
  const value = l.on ? (bri ?? 100) / 100 : 0;
  const swatch: ViewNode = l.on
    ? { type: "tile", key: "sw", width: 18, height: 18, color: shade(lightColor(l), (bri ?? 100) / 100), fill: "solid" }
    : { type: "tile", key: "sw", width: 18, height: 18, color: "neutral", fill: "outline" };
  const unreachable = l.reach === "disconnected" || l.reach === "connectivity_issue";
  return row([
    swatch,
    text(l.name, { style: "body", size: "sm", weight: selected ? "semibold" : "regular", color: l.on ? undefined : "muted", width: POPOVER_W - 16 - 18 - SLIDER_W - 36 - 26 - 4 * 8 }),
    ...(unreachable ? [{ type: "badge", key: "reach", text: "unreachable", color: "red" } as ViewNode] : []),
    { type: "slider", key: "level", value, width: SLIDER_W, color: l.on ? hex : "grey", action: `level:${l.id}`, label: `${l.name} brightness` },
    text(l.on ? `${bri ?? 100}%` : "off", { key: `v-${value}`, style: "mono", size: "xs", color: "muted", width: 36, align: "end", transition: { enter: "fade", exit: "none" } }),
    { type: "switch", key: "on", on: l.on, action: `toggle:${l.id}`, label: `${l.name} power` },
  ], { key: `light-${l.id.slice(l.id.indexOf(":") + 1)}`, gap: 2, padding: 1, radius: true, minHeight: 22, ...(selected && { selected: true }) });
}

function lightsSection(room: Room, st: PopoverState): ViewNode {
  const a = aggregate(room);
  return column([
    row([text(`${room.name}`, { style: "body", size: "xs", weight: "semibold", color: "muted" }), text(`${room.lights.length} ${room.lights.length === 1 ? "light" : "lights"}${a.on ? `, ${a.on} on` : ""}`, { style: "muted", size: "xs" }), { type: "spacer" }, ...hint(["up", "down"], "light"), ...hint(["left", "right"], "brightness")], { key: "lh", gap: 1, minHeight: 14 }),
    column(room.lights.map((l, i) => lightRow(l, st.focus === "lights" && st.light === i)), { key: "lights", gap: 0, surface: "sunken", radius: true }),
  ], { key: `open-${roomKey(room)}`, gap: 1, transition: { enter: "slide-down", exit: "none" } });
}

/** A scene as a tile: its swatches as one strip (the width shared by however many there are), the digit that plays it and its name; the one playing is a card with its name in the accent. */
function sceneTile(s: Scene, i: number, width: number): ViewNode {
  const sw = s.swatches.length ? s.swatches : ["#8a8f98" as HexColor];
  const strip = width - 8;
  const w = Math.max(6, Math.floor(strip / sw.length));
  const on = s.active !== "inactive";
  return column([
    row(sw.map((c, j) => ({ type: "tile", key: `${j}`, width: w, height: SWATCH_H, color: c as HexColor, fill: "solid" }) as ViewNode), { key: "strip", gap: 0, radius: true }),
    row([text(String(i + 1), { style: "mono", size: "xs", color: "faint" }), text(s.name, { style: "muted", size: "xs", width: strip - 14, color: on ? "accent" : "muted", weight: on ? "semibold" : undefined })], { key: "name", gap: 1 }),
  ], { key: `scene-${s.id.slice(s.id.indexOf(":") + 1)}`, gap: 1, align: "start", action: `scene:${s.id}`, padding: 1, radius: true, surface: on ? "elevated" : undefined });
}

function scenesSection(scenes: Scene[], of: string | undefined): ViewNode | undefined {
  if (!scenes.length) return undefined;
  const shown = scenes.slice(0, MAX_SCENES);
  // As wide as the row allows for the count, up to a cap: four scenes get room for their names, nine stay five a row.
  const perRow = Math.min(SCENES_PER_ROW, shown.length);
  const width = Math.min(SCENE_W_MAX, Math.floor((POPOVER_W - (perRow - 1) * 4) / perRow));
  const rows: ViewNode[] = [];
  for (let i = 0; i < shown.length; i += perRow) rows.push(row(shown.slice(i, i + perRow).map((s, j) => sceneTile(s, i + j, width)), { key: `sr-${i / perRow}`, gap: 1, align: "start" }));
  return column([
    row([text("Scenes", { style: "body", size: "xs", weight: "semibold", color: "muted" }), ...(of ? [text(of, { style: "muted", size: "xs" })] : []), { type: "spacer" }, ...hint(["1-9"], "play")], { key: "sh", gap: 1, minHeight: 16 }),
    ...rows,
  ], { key: `scenes-${of ?? "all"}`, gap: 1, transition: { enter: "fade", exit: "none" } });
}

/** The sensors as badges: each motion sensor (green while it sees motion), then the temperatures; at most four. */
export function sensorBadges(sensors: Sensor[]): ViewNode[] {
  const out: ViewNode[] = [];
  for (const s of sensors.filter((x) => x.kind === "motion" && x.value !== "no reading")) out.push({ type: "badge", key: `sb-${s.id}`, text: `${s.device.replace(/ sensor$/i, "")}: ${s.value}`, color: s.value === "motion" ? "green" : "grey" });
  for (const s of sensors.filter((x) => x.kind === "temperature" && x.value !== "no reading")) out.push({ type: "badge", key: `sb-${s.id}`, text: s.value.replace(/ °C$/, "°"), color: "grey" });
  return out.slice(0, MAX_BADGES);
}

function statusRow(d: PopoverData): ViewNode {
  const kids: ViewNode[] = [text(d.lightsOn ? `${d.lightsOn} of ${d.lightsTotal} lights on` : "All lights off", { key: `n-${d.lightsOn}`, style: "body", size: "sm", weight: "semibold", color: d.lightsOn ? undefined : "muted", transition: { enter: "fade", exit: "none" } })];
  kids.push(...sensorBadges(d.sensors));
  for (const name of d.away) kids.push({ type: "badge", key: `away-${name}`, text: `${name} away`, color: "red" });
  return row(kids, { key: "status", gap: 1, minHeight: 18 });
}

function hints(d: PopoverData, st: PopoverState, cur: Room | undefined): ViewNode {
  const kids: ViewNode[] = st.focus === "lights"
    ? [...hint(["enter", "space"], "toggle"), ...hint(["backspace"], "rooms", "back")]
    : [...hint(["enter"], cur && st.open === cur.id ? "close" : "open"), ...hint(["space"], "toggle"), ...hint(["↑↓←→"], "room")];
  kids.push({ type: "spacer" });
  if (d.lightsOn < d.lightsTotal) kids.push(...hint(["e"], "all on", "all_on"));
  if (d.lightsOn) kids.push(...hint(["x"], "all off", "all_off"));
  kids.push(...hint(["p"], "pal", "open"));
  return row(kids, { key: `hints-${st.focus}`, gap: 1, minHeight: 22, transition: { enter: "fade", exit: "none" } });
}

/** Every action the popover answers to; the first listed is Enter. Click-only actions are hidden and carry no key. */
export function actions(d: PopoverData, st: PopoverState): Action[] {
  const rooms = gridRooms(d.rooms);
  const cur = rooms[Math.min(st.cursor, rooms.length - 1)];
  const open = st.open ? rooms.find((r) => r.id === st.open) : undefined;
  const light = open?.lights[st.light];
  const acts: Action[] = [];
  if (!d.paired) return [{ id: "open", title: "Open in pal", shortcut: "p" }, { id: "refresh", title: "Read the bridge again", shortcut: "r" }];
  if (st.focus === "lights" && light) {
    acts.push({ id: "enter", title: `${light.on ? "Turn off" : "Turn on"} ${light.name}`, shortcut: ["enter", "space"] });
    acts.push({ id: "back", title: `Close ${open!.name}`, shortcut: "backspace" });
    acts.push({ id: "bri+", title: "Brighter", shortcut: ["right", "+", "="], hidden: true }, { id: "bri-", title: "Dimmer", shortcut: ["left", "-"], hidden: true });
    acts.push({ id: "bri++", title: "Much brighter", shortcut: "shift+right", hidden: true }, { id: "bri--", title: "Much dimmer", shortcut: "shift+left", hidden: true });
    acts.push({ id: "move:down", title: "Next light", shortcut: ["down", "tab"], hidden: true }, { id: "move:up", title: "Previous light", shortcut: ["up", "shift+tab"], hidden: true });
  } else if (cur) {
    acts.push({ id: "enter", title: st.open === cur.id ? `Close ${cur.name}` : `Open ${cur.name}`, shortcut: "enter" });
    acts.push({ id: "toggle", title: `${aggregate(cur).anyOn ? "Turn off" : "Turn on"} ${cur.name}`, shortcut: "space" });
    if (st.open) acts.push({ id: "back", title: "Close the room", shortcut: "backspace" });
    acts.push({ id: "bri+", title: "Brighter", shortcut: ["+", "="], hidden: true }, { id: "bri-", title: "Dimmer", shortcut: "-", hidden: true });
    for (const dir of ["up", "down", "left", "right"] as const) acts.push({ id: `move:${dir}`, title: `Move ${dir}`, shortcut: dir, hidden: true });
    acts.push({ id: "move:next", title: "Next room", shortcut: "tab", hidden: true }, { id: "move:prev", title: "Previous room", shortcut: "shift+tab", hidden: true });
  }
  acts.push({ id: "all_off", title: "All off", shortcut: ["x", "cmd+shift+o"], style: "destructive" });
  acts.push({ id: "all_on", title: "Everything on", shortcut: "e" });
  acts.push({ id: "open", title: "Open in pal", shortcut: "p" });
  acts.push({ id: "refresh", title: "Read the bridge again", shortcut: "r" });
  for (const r of rooms) { acts.push({ id: `toggle:${r.id}`, title: `Toggle ${r.name}`, hidden: true }); if (r.id !== st.open) acts.push({ id: `open:${r.id}`, title: `Open ${r.name}`, hidden: true }); }
  for (const l of open?.lights ?? []) acts.push({ id: `toggle:${l.id}`, title: `Toggle ${l.name}`, hidden: true }, { id: `level:${l.id}`, title: `Set ${l.name}`, hidden: true });
  d.scenes.slice(0, MAX_SCENES).forEach((s, i) => acts.push({ id: `scene:${s.id}`, title: `Play ${s.name}`, shortcut: String(i + 1), hidden: true }));
  return acts;
}

export function renderPopover(d: PopoverData, st: PopoverState): View {
  const rooms = gridRooms(d.rooms);
  let tree: ViewNode;
  if (!d.paired) {
    tree = column([
      text(d.away.length ? `${d.away[0]} did not answer` : "No bridge paired", { style: "title" }),
      text(d.away.length ? "The rooms come back when it does; r asks again." : "Open Hue in pal to find the bridge and press its button.", { style: "muted", size: "sm" }),
      row([...hint(["p"], "open in pal", "open"), ...hint(["r"], "try again", "refresh")], { key: "k", gap: 1, minHeight: 22 }),
    ], { key: "unpaired", padding: 3, gap: 2 });
    return { tree, actions: actions(d, st), title: d.bridge ?? "Hue", id: VIEW_ID, keys: "actions" };
  }
  const cur = rooms[Math.min(st.cursor, Math.max(0, rooms.length - 1))];
  const open = st.open ? rooms.find((r) => r.id === st.open) : undefined;
  const kids: ViewNode[] = [statusRow(d)];
  kids.push(rooms.length ? grid(rooms, st) : text("No rooms with lights on this bridge", { key: "none", style: "muted", size: "sm" }));
  if (open) kids.push(lightsSection(open, st));
  const scenes = scenesSection(d.scenes, d.scenesOf);
  if (scenes) kids.push(scenes);
  kids.push(hints(d, st, cur));
  tree = column(kids, { key: "home", padding: 3, gap: 2 });
  return { tree, actions: actions(d, st), title: d.bridge ?? "Hue", id: VIEW_ID, keys: "actions" };
}

/**
 * The cursor after a key on the grid (two a row): arrows move over the
 * tiles, tab and shift+tab walk them in order, both clamped; in the
 * lights up and down walk the opened room's lights.
 */
export function moveCursor(st: PopoverState, dir: "up" | "down" | "left" | "right" | "next" | "prev", count: number, lights: number): PopoverState {
  if (st.focus === "lights") {
    if (dir === "down" || dir === "next") return { ...st, light: Math.min(lights - 1, st.light + 1) };
    if (dir === "up" || dir === "prev") return { ...st, light: Math.max(0, st.light - 1) };
    return st;
  }
  const delta = dir === "left" || dir === "prev" ? -1 : dir === "right" || dir === "next" ? 1 : dir === "up" ? -2 : 2;
  const next = st.cursor + delta;
  return { ...st, cursor: next < 0 || next >= count ? st.cursor : next };
}
