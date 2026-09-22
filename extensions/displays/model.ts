// The pure half of the displays extension: the model one screen is, the
// parsers of every tool's output (system_profiler, displayplacer, the
// brightness CLI, m1ddc, ddcctl, ddcutil, brightnessctl, hyprctl,
// wlr-randr, xrandr) and the arrangement maths (a mode, the main display,
// a mirror set, a rotation, as the next displayplacer command). Nothing
// here runs a process, so the tests run it on fixtures.

/** One resolution a screen can take. `id` is the tool's own handle (displayplacer's mode number, `WxH@Hz` on Linux). */
export type Mode = { id: string; w: number; h: number; hz?: number; hidpi?: boolean; depth?: number; current?: boolean };

/**
 * One screen. `id` is what `windows.displays()` reports and every route
 * takes: the CoreGraphics display id on macOS, the output name on Linux.
 * `uuid` is displayplacer's persistent id, what its commands are spelled
 * with; `ddc` the DDC tool's own handle (m1ddc's system uuid, ddcctl's
 * 1-based index, ddcutil's display number).
 */
export type Screen = {
  id: string;
  uuid?: string;
  name: string;
  builtin: boolean;
  main: boolean;
  enabled: boolean;
  /** `internal`, `displayport`, `hdmi`, `usb-c`, `thunderbolt`, ... as the OS names it. */
  connection?: string;
  w?: number;
  h?: number;
  hz?: number;
  hidpi?: boolean;
  depth?: number;
  /** The backing pixels (`3600x2338` behind a 1800x1169 HiDPI mode). */
  pixels?: { w: number; h: number };
  rotation?: number;
  origin?: { x: number; y: number };
  /** The id of the screen this one mirrors. */
  mirrorOf?: string;
  /** Screens that mirror this one. */
  mirrors: string[];
  modes: Mode[];
  ddc?: string;
  /** macOS: the `brightness` CLI's index for this display, when it can read it (the built-in panel, an Apple display). */
  cli?: number;
  /** Linux: the compositor's scale factor. */
  scale?: number;
};

/** One entry of a displayplacer command: a screen (with the screens mirroring it) and how it is set. */
export type Placement = { id: string; mirrors: string[]; enabled: boolean; w?: number; h?: number; hz?: number; depth?: number; hidpi?: boolean; x: number; y: number; degree: number };

/** The DDC input sources (VCP 60): the standard codes and LG's alternate addressing (m1ddc's `input-alt`). */
export const INPUTS = [
  { id: "dp1", title: "DisplayPort 1", code: 15, alt: 208 },
  { id: "dp2", title: "DisplayPort 2", code: 16, alt: 209 },
  { id: "hdmi1", title: "HDMI 1", code: 17, alt: 144 },
  { id: "hdmi2", title: "HDMI 2", code: 18, alt: 145 },
  { id: "usbc", title: "USB-C", code: 27, alt: 210 },
] as const;
export type InputId = (typeof INPUTS)[number]["id"];

/** `hdmi1`, `HDMI 2`, `dp-1`, `usb-c`, `17`: the source as an id, or a raw VCP code as a number. */
export function parseInput(text: string): InputId | number | undefined {
  const s = text.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (/^\d+$/.test(s)) return Number(s);
  const byId = INPUTS.find((i) => i.id === s);
  if (byId) return byId.id;
  if (s === "displayport1" || s === "dp") return "dp1";
  if (s === "displayport2") return "dp2";
  if (s === "hdmi") return "hdmi1";
  if (s === "usb" || s === "typec" || s === "usbtypec" || s === "thunderbolt") return "usbc";
  const code = INPUTS.find((i) => String(i.code) === s || String(i.alt) === s);
  return code?.id;
}

const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));

// ---- macOS -----------------------------------------------------------------

/** `spdisplays_built-in-liquid-retina-xdr` as "Built-in Liquid Retina XDR Display"; undefined for a type that says nothing. */
export function builtinName(type: string | undefined): string | undefined {
  const words = type?.replace(/^spdisplays_/, "").split("-").filter(Boolean);
  if (!words?.length || !/built/.test(words[0])) return;
  return `${words.map((w) => (w === "xdr" || w === "lcd" ? w.toUpperCase() : w === "in" ? "in" : w[0].toUpperCase() + w.slice(1))).join(" ").replace("Built in", "Built-in")} Display`;
}

/** `system_profiler SPDisplaysDataType -json`: every online display with its name, id, connection and current mode; what macOS has without a tool. */
export type ProfilerDisplay = { id: string; name: string; builtin: boolean; main: boolean; mirror: boolean; connection?: string; w?: number; h?: number; hz?: number; pixels?: { w: number; h: number } };
export function parseProfiler(json: string): ProfilerDisplay[] {
  let root: unknown;
  try { root = JSON.parse(json); } catch { return []; }
  const gpus = (root as { SPDisplaysDataType?: unknown })?.SPDisplaysDataType;
  if (!Array.isArray(gpus)) return [];
  const out: ProfilerDisplay[] = [];
  for (const gpu of gpus) {
    const ndrvs = (gpu as { spdisplays_ndrvs?: unknown }).spdisplays_ndrvs;
    if (!Array.isArray(ndrvs)) continue;
    for (const d of ndrvs as Record<string, string>[]) {
      const id = d._spdisplays_displayID;
      if (!id) continue;
      const res = /(\d+) x (\d+)(?: @ ([\d.]+)\s*Hz)?/.exec(d._spdisplays_resolution ?? "");
      const px = /(\d+) x (\d+)/.exec(d._spdisplays_pixels ?? "");
      const connection = d.spdisplays_connection_type?.replace(/^spdisplays_/, "").replace(/_/g, "-");
      const builtin = connection === "internal" || /built-?in/.test(d.spdisplays_display_type ?? "");
      out.push({
        id,
        // The panel's `_name` is the old "Color LCD"; the Displays pane names it by its type ("Built-in Liquid Retina XDR Display").
        name: (builtin && builtinName(d.spdisplays_display_type)) || d._name || (builtin ? "Built-in Display" : "Display"),
        builtin,
        main: d.spdisplays_main === "spdisplays_yes",
        mirror: d.spdisplays_mirror === "spdisplays_on",
        connection,
        w: num(res?.[1]), h: num(res?.[2]), hz: res?.[3] ? Math.round(Number(res[3])) : undefined,
        pixels: px ? { w: Number(px[1]), h: Number(px[2]) } : undefined,
      });
    }
  }
  return out;
}

/** One block of `displayplacer list`. */
export type DpScreen = { uuid: string; id: string; serial?: string; builtin: boolean; inches?: number; w: number; h: number; hz?: number; depth?: number; hidpi: boolean; origin: { x: number; y: number }; main: boolean; rotation: number; enabled: boolean; modes: Mode[] };
export type DpList = { screens: DpScreen[]; /** The arrangement as displayplacer would reproduce it: the last line of `list`. */ placements: Placement[] };

/** The quoted arguments of a `displayplacer "..." "..."` line. */
export const splitQuoted = (line: string): string[] => [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);

/** One `id:A+B res:WxH hz:N color_depth:N enabled:true scaling:on origin:(x,y) degree:0` argument. */
export function parsePlacement(arg: string): Placement | undefined {
  const kv = Object.fromEntries([...arg.matchAll(/(\w+):(\S+)/g)].map((m) => [m[1], m[2]]));
  if (!kv.id) return;
  const [id, ...mirrors] = kv.id.split("+");
  const res = /(\d+)x(\d+)/.exec(kv.res ?? "");
  const origin = /\((-?\d+),(-?\d+)\)/.exec(kv.origin ?? "");
  return {
    id, mirrors,
    enabled: kv.enabled !== "false",
    w: num(res?.[1]), h: num(res?.[2]), hz: num(kv.hz), depth: num(kv.color_depth),
    hidpi: kv.scaling === undefined ? undefined : kv.scaling === "on",
    x: Number(origin?.[1] ?? 0), y: Number(origin?.[2] ?? 0), degree: Number(kv.degree ?? 0),
  };
}

/** The argv that applies these placements: `displayplacer` then one quoted argument per screen, the form `list` prints. */
export function formatPlacements(ps: Placement[]): string[] {
  return ["displayplacer", ...ps.map((p) => {
    if (!p.enabled) return `id:${p.id} enabled:false`;
    const parts = [`id:${[p.id, ...p.mirrors].join("+")}`];
    if (p.w && p.h) parts.push(`res:${p.w}x${p.h}`);
    if (p.hz) parts.push(`hz:${p.hz}`);
    if (p.depth) parts.push(`color_depth:${p.depth}`);
    parts.push("enabled:true");
    if (p.hidpi !== undefined) parts.push(`scaling:${p.hidpi ? "on" : "off"}`);
    parts.push(`origin:(${p.x},${p.y})`, `degree:${p.degree}`);
    return parts.join(" ");
  })];
}

export function parseDisplayplacer(text: string): DpList {
  const screens: DpScreen[] = [];
  let cur: DpScreen | undefined;
  let placements: Placement[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("Persistent screen id: ")) {
      cur = { uuid: line.slice(22).trim(), id: "", builtin: false, w: 0, h: 0, hidpi: false, origin: { x: 0, y: 0 }, main: false, rotation: 0, enabled: true, modes: [] };
      screens.push(cur);
      continue;
    }
    if (line.startsWith("displayplacer ")) { placements = splitQuoted(line).map(parsePlacement).filter((p): p is Placement => !!p); continue; }
    if (!cur) continue;
    const m = /^(Contextual screen id|Serial screen id|Type|Resolution|Hertz|Color Depth|Scaling|Origin|Rotation|Enabled): (.*)$/.exec(line);
    if (m) {
      const v = m[2];
      switch (m[1]) {
        case "Contextual screen id": cur.id = v; break;
        case "Serial screen id": cur.serial = v; break;
        case "Type": cur.builtin = /built in/i.test(v); cur.inches = num(/(\d+) inch/.exec(v)?.[1]); break;
        case "Resolution": { const r = /(\d+)x(\d+)/.exec(v); if (r) { cur.w = Number(r[1]); cur.h = Number(r[2]); } break; }
        case "Hertz": cur.hz = /^\d+$/.test(v) ? Number(v) : undefined; break;
        case "Color Depth": cur.depth = num(v); break;
        case "Scaling": cur.hidpi = v === "on"; break;
        case "Origin": { const o = /\((-?\d+),(-?\d+)\)/.exec(v); if (o) cur.origin = { x: Number(o[1]), y: Number(o[2]) }; cur.main = v.includes("main display"); break; }
        case "Rotation": cur.rotation = Number(/^\d+/.exec(v)?.[0] ?? 0); break;
        case "Enabled": cur.enabled = v.startsWith("true"); break;
      }
      continue;
    }
    const mode = /^\s+mode (\d+): res:(\d+)x(\d+)(?: hz:(\d+))?(?: color_depth:(\d+))?( scaling:on)?( <-- current mode)?/.exec(line);
    if (mode) cur.modes.push({ id: mode[1], w: Number(mode[2]), h: Number(mode[3]), hz: num(mode[4]), depth: num(mode[5]), hidpi: !!mode[6], ...(mode[7] && { current: true }) });
  }
  return { screens, placements };
}

/** `brightness -l`: the displays it can read (`display 0: brightness 0.5`) and their CoreGraphics ids (`display 0: main, ..., ID 0x1`), by its own index. */
export type CliBrightness = { index: number; id?: string; builtin: boolean; level?: number };
export function parseBrightnessCli(text: string): CliBrightness[] {
  const by = new Map<number, CliBrightness>();
  for (const line of text.split("\n")) {
    const m = /^display (\d+): (.*)$/.exec(line.trim());
    if (!m) continue;
    const i = Number(m[1]);
    const d = by.get(i) ?? { index: i, builtin: false };
    by.set(i, d);
    const b = /^brightness ([\d.]+)/.exec(m[2]);
    if (b) { d.level = Math.round(Number(b[1]) * 100); continue; }
    const id = /ID 0x([0-9a-f]+)/i.exec(m[2]);
    if (id) d.id = String(parseInt(id[1], 16));
    if (/built-in/.test(m[2])) d.builtin = true;
  }
  return [...by.values()];
}

/** `m1ddc display list detailed`: each external display's index, name, system uuid and CoreGraphics id. */
export type M1ddcDisplay = { index: number; name?: string; uuid?: string; id?: string };
export function parseM1ddcList(text: string): M1ddcDisplay[] {
  const out: M1ddcDisplay[] = [];
  let cur: M1ddcDisplay | undefined;
  for (const line of text.split("\n")) {
    const head = /^\[(\d+)\] (.*?) \(([^)]*)\)\s*$/.exec(line);
    if (head) {
      cur = { index: Number(head[1]), name: head[2] === "(null)" ? undefined : head[2], uuid: head[3] === "(null)" ? undefined : head[3] };
      out.push(cur);
      continue;
    }
    const kv = /^\s*-\s*([^:]+):\s*(.*)$/.exec(line);
    if (!kv || !cur) continue;
    const v = kv[2].trim();
    if (kv[1].trim() === "Display ID" && v !== "(null)") cur.id = v;
    if (kv[1].trim() === "Product name" && v !== "(null)" && !cur.name) cur.name = v;
    if (kv[1].trim() === "System UUID" && v !== "(null)") cur.uuid = v;
  }
  return out;
}

/** `ddcctl -d 1 -b '?'`: `I: VCP control #16 (0x10) = current: 50, max: 100`. */
export function parseDdcctl(text: string): { current: number; max: number } | undefined {
  const m = /current: (\d+), max: (\d+)/.exec(text);
  return m ? { current: Number(m[1]), max: Number(m[2]) } : undefined;
}

// ---- Linux -----------------------------------------------------------------

/** `ddcutil detect --brief`: `Display N` blocks with the DRM connector (`card1-DP-1`) when ddcutil knows it and the `MFG:MODEL:SERIAL` line. */
export type DdcutilDisplay = { display: number; connector?: string; model?: string };
export function parseDdcutilDetect(text: string): DdcutilDisplay[] {
  const out: DdcutilDisplay[] = [];
  let cur: DdcutilDisplay | undefined;
  for (const line of text.split("\n")) {
    const head = /^Display (\d+)/.exec(line);
    if (head) { cur = { display: Number(head[1]) }; out.push(cur); continue; }
    if (!cur) continue;
    const drm = /DRM connector:\s*(\S+)/.exec(line);
    if (drm) cur.connector = drm[1].replace(/^card\d+-/, "");
    const mon = /Monitor:\s*([^:]*):([^:]*):/.exec(line);
    if (mon) cur.model = mon[2].trim() || mon[1].trim();
  }
  return out;
}

/** `ddcutil getvcp NN --brief`: `VCP 10 C 50 100` for a continuous value, `VCP 60 SNC x0f` for an input source. */
export function parseDdcutilVcp(text: string): { current: number; max: number } | undefined {
  const c = /VCP \w+ C (\d+) (\d+)/.exec(text);
  if (c) return { current: Number(c[1]), max: Number(c[2]) };
  const nc = /VCP \w+ SNC x([0-9a-f]+)/i.exec(text);
  return nc ? { current: parseInt(nc[1], 16), max: 0 } : undefined;
}

/** `brightnessctl -m`: `intel_backlight,backlight,12000,50%,24000`; the percent. */
export function parseBrightnessctl(text: string): number | undefined {
  const m = /^[^,]*,backlight,\d+,(\d+)%,\d+/m.exec(text);
  return m ? Number(m[1]) : undefined;
}

/** `hyprctl monitors -j`. */
export function parseHyprctl(json: string): Screen[] {
  let list: unknown;
  try { list = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return (list as Record<string, unknown>[]).map((m) => {
    const name = String(m.name);
    const modes = (Array.isArray(m.availableModes) ? (m.availableModes as string[]) : []).map((s) => parseLinuxMode(s)).filter((x): x is Mode => !!x);
    const hz = typeof m.refreshRate === "number" ? Math.round(m.refreshRate) : undefined;
    for (const mode of modes) if (mode.w === m.width && mode.h === m.height && mode.hz === hz) mode.current = true;
    const mirrorOf = typeof m.mirrorOf === "string" && m.mirrorOf !== "none" ? m.mirrorOf : undefined;
    return {
      id: name, name: String(m.description || m.model || name), builtin: isBuiltinOutput(name), main: m.focused === true, enabled: m.disabled !== true,
      w: m.width as number, h: m.height as number, hz, scale: m.scale as number, hidpi: (m.scale as number) > 1,
      rotation: typeof m.transform === "number" ? [0, 90, 180, 270][m.transform % 4] : 0,
      origin: { x: m.x as number, y: m.y as number }, mirrorOf, mirrors: [], modes,
    };
  });
}

/** `wlr-randr --json`. */
export function parseWlrRandr(json: string): Screen[] {
  let list: unknown;
  try { list = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return (list as Record<string, any>[]).map((o) => {
    const name = String(o.name);
    const modes: Mode[] = (o.modes ?? []).map((m: any) => ({ id: `${m.width}x${m.height}@${m.refresh}`, w: m.width, h: m.height, hz: Math.round(m.refresh), ...(m.current && { current: true }) }));
    const cur = modes.find((m) => m.current);
    const transform = String(o.transform ?? "normal");
    return {
      id: name, name: [o.make, o.model].filter(Boolean).join(" ") || o.description || name, builtin: isBuiltinOutput(name), main: false, enabled: o.enabled !== false,
      w: cur?.w, h: cur?.h, hz: cur?.hz, scale: o.scale, hidpi: (o.scale ?? 1) > 1,
      rotation: Number(/(\d+)/.exec(transform)?.[1] ?? 0), origin: o.position ? { x: o.position.x, y: o.position.y } : undefined, mirrors: [], modes,
    };
  });
}

/** `xrandr --query`: the connected outputs with their mode table (`*` current, `+` preferred). */
export function parseXrandr(text: string): Screen[] {
  const out: Screen[] = [];
  let cur: Screen | undefined;
  for (const line of text.split("\n")) {
    const head = /^(\S+) (connected|disconnected)( primary)?(?: (\d+)x(\d+)\+(-?\d+)\+(-?\d+))?(?: \((\w+)|( left| right| inverted))?/.exec(line);
    if (head) {
      cur = undefined;
      if (head[2] !== "connected") continue;
      const rot = / (left|right|inverted) \(/.exec(line)?.[1];
      cur = { id: head[1], name: head[1], builtin: isBuiltinOutput(head[1]), main: !!head[3], enabled: !!head[4], w: num(head[4]), h: num(head[5]), origin: head[6] ? { x: Number(head[6]), y: Number(head[7]) } : undefined, rotation: rot === "left" ? 90 : rot === "inverted" ? 180 : rot === "right" ? 270 : 0, mirrors: [], modes: [] };
      out.push(cur);
      continue;
    }
    const mode = /^\s+(\d+)x(\d+)\s+(.*)$/.exec(line);
    if (!mode || !cur) continue;
    for (const rate of mode[3].matchAll(/([\d.]+)(\*?)(\+?)/g)) {
      const hz = Math.round(Number(rate[1]));
      cur.modes.push({ id: `${mode[1]}x${mode[2]}@${rate[1]}`, w: Number(mode[1]), h: Number(mode[2]), hz, ...(rate[2] && { current: true }) });
      if (rate[2]) cur.hz = hz;
    }
  }
  return out;
}

/** `eDP-1`, `eDP1`, `LVDS-1`, `DSI-1`: the panel of a laptop. */
export const isBuiltinOutput = (name: string): boolean => /^(eDP|LVDS|DSI)/i.test(name);

/** `3840x2160@59.99Hz` (hyprctl), `1920x1080@60` as a mode. */
export function parseLinuxMode(s: string): Mode | undefined {
  const m = /^(\d+)x(\d+)(?:@([\d.]+))?/.exec(s.trim());
  return m ? { id: s.trim(), w: Number(m[1]), h: Number(m[2]), hz: m[3] ? Math.round(Number(m[3])) : undefined } : undefined;
}

// ---- merging (macOS) -------------------------------------------------------

/**
 * One list of screens from what the machine could say: system_profiler
 * (every online display, its name and connection), displayplacer (the
 * persistent id, modes, origin, rotation, mirror sets; absent without
 * the tool) and the DDC tool's handles, all joined on the CoreGraphics
 * id. A mirror set comes from displayplacer's reproduce line, since its
 * blocks do not mark one.
 */
export function mergeMac(profiler: ProfilerDisplay[], dp: DpList | undefined, ddc: M1ddcDisplay[] = []): Screen[] {
  const byId = new Map<string, Screen>();
  for (const p of profiler) byId.set(p.id, { id: p.id, name: p.name, builtin: p.builtin, main: p.main, enabled: true, connection: p.connection, w: p.w, h: p.h, hz: p.hz, pixels: p.pixels, hidpi: p.pixels && p.w ? p.pixels.w > p.w : undefined, mirrors: [], modes: [] });
  for (const s of dp?.screens ?? []) {
    const cur = byId.get(s.id) ?? (byId.set(s.id, { id: s.id, name: s.builtin ? "Built-in Display" : s.inches ? `${s.inches}″ Display` : "Display", builtin: s.builtin, main: s.main, enabled: s.enabled, mirrors: [], modes: [] }).get(s.id)!);
    Object.assign(cur, { uuid: s.uuid, main: s.main, enabled: s.enabled, w: s.w, h: s.h, hz: s.hz ?? cur.hz, depth: s.depth, hidpi: s.hidpi, rotation: s.rotation, origin: s.origin, modes: s.modes });
  }
  const byUuid = new Map([...byId.values()].filter((s) => s.uuid).map((s) => [s.uuid!, s]));
  for (const p of dp?.placements ?? []) {
    const lead = byUuid.get(p.id);
    for (const m of p.mirrors) {
      const mirror = byUuid.get(m);
      if (!lead || !mirror) continue;
      mirror.mirrorOf = lead.id;
      lead.mirrors.push(mirror.id);
    }
  }
  for (const d of ddc) {
    const s = (d.id && byId.get(d.id)) || (d.uuid && byUuid.get(d.uuid));
    if (s && !s.builtin) { s.ddc = d.uuid ?? String(d.index); if (d.name && !s.name.trim()) s.name = d.name; }
  }
  // The primary first, then by position left to right, the way the Displays pane draws them.
  return [...byId.values()].sort((a, b) => Number(b.main) - Number(a.main) || (a.origin?.x ?? 0) - (b.origin?.x ?? 0) || a.name.localeCompare(b.name));
}

// ---- arrangement maths (displayplacer) -------------------------------------

const placementOf = (ps: Placement[], uuid: string) => ps.find((p) => p.id === uuid || p.mirrors.includes(uuid));

/** The arrangement with one screen in another mode; the rest as they are. */
export function withMode(ps: Placement[], uuid: string, mode: Mode): Placement[] {
  return ps.map((p) => (p.id === uuid ? { ...p, w: mode.w, h: mode.h, hz: mode.hz ?? p.hz, depth: mode.depth ?? p.depth, hidpi: mode.hidpi ?? p.hidpi } : p));
}

/** The arrangement with `uuid` as the main display: origins shift so it sits at (0,0), the layout otherwise kept. */
export function withMain(ps: Placement[], uuid: string): Placement[] {
  const p = placementOf(ps, uuid);
  if (!p || (p.x === 0 && p.y === 0 && p.id === uuid)) return ps;
  const { x, y } = p;
  return ps.map((q) => ({ ...q, x: q.x - x, y: q.y - y }));
}

/** The arrangement with one screen rotated; displayplacer swaps nothing else. */
export const withRotation = (ps: Placement[], uuid: string, degree: number): Placement[] => ps.map((p) => (p.id === uuid ? { ...p, degree } : p));

/** The arrangement with `uuid` mirroring `lead`: its own entry goes, it joins the lead's set. */
export function withMirror(ps: Placement[], uuid: string, lead: string): Placement[] {
  if (uuid === lead) return ps;
  const own = ps.find((p) => p.id === uuid);
  const out = ps.filter((p) => p.id !== uuid).map((p) => ({ ...p, mirrors: p.mirrors.filter((m) => m !== uuid) }));
  const leadEntry = out.find((p) => p.id === lead);
  if (!leadEntry) return ps;
  // A mirrored lead keeps its mirrors; the newcomer's own mirrors follow it in.
  leadEntry.mirrors = [...leadEntry.mirrors, uuid, ...(own?.mirrors ?? [])];
  return out;
}

/** The arrangement with `uuid` out of its mirror set, placed to the right of the screen it mirrored, in `mode` (its current one). */
export function withoutMirror(ps: Placement[], uuid: string, mode: Pick<Placement, "w" | "h" | "hz" | "depth" | "hidpi">): Placement[] {
  const lead = ps.find((p) => p.mirrors.includes(uuid));
  if (!lead) return ps;
  const right = Math.max(...ps.map((p) => p.x + (p.w ?? 0)));
  return [...ps.map((p) => (p === lead ? { ...p, mirrors: p.mirrors.filter((m) => m !== uuid) } : p)), { id: uuid, mirrors: [], enabled: true, ...mode, x: right, y: lead.y, degree: 0 }];
}

/** An argv as one line a shell would take, for a preset's detail pane. */
export const formatArgv = (argv: string[]): string => argv.map((a) => (/[\s"']/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");

/** `1800×1169 @ 120 Hz · HiDPI`, the mode line a row and the popover share; a screen with no size known reads as its name would. */
export function modeText(m: { w?: number; h?: number; hz?: number; hidpi?: boolean }): string {
  if (!m.w || !m.h) return "";
  const parts = [`${m.w}×${m.h}`];
  if (m.hz) parts.push(`@ ${m.hz} Hz`);
  if (m.hidpi) parts.push("· HiDPI");
  return parts.join(" ");
}

/**
 * `66`, `1800x1169`, `1800x1169@60`, `1800x1169@60 hidpi`, `2560x1440
 * native`: the mode of `modes` a link names; a bare resolution takes the
 * highest refresh in HiDPI when the screen has such a mode.
 */
export function findMode(modes: Mode[], spec: string): Mode | undefined {
  const s = spec.trim().toLowerCase();
  if (/^\d+$/.test(s) && modes.some((m) => m.id === s)) return modes.find((m) => m.id === s);
  const m = /^(\d+)\s*[x×]\s*(\d+)(?:\s*@\s*([\d.]+)\s*(?:hz)?)?\s*(hidpi|retina|scaled|native|lodpi)?$/.exec(s);
  if (!m) return;
  const w = Number(m[1]), h = Number(m[2]), hz = m[3] ? Math.round(Number(m[3])) : undefined;
  const hidpi = m[4] ? !["native", "lodpi"].includes(m[4]) : undefined;
  const fits = modes.filter((x) => x.w === w && x.h === h && (hz === undefined || x.hz === hz) && (hidpi === undefined || !!x.hidpi === hidpi));
  return fits.sort((a, b) => Number(!!b.hidpi) - Number(!!a.hidpi) || (b.hz ?? 0) - (a.hz ?? 0))[0];
}

/** `+10`, `-5`, `50`, `0.5`: the next level from the current one, clamped to `floor`..100. */
export function levelFrom(current: number | undefined, value: string | number, floor = 0): number | undefined {
  const s = String(value).trim();
  const m = /^([+-])?\s*(\d+(?:\.\d+)?)%?$/.exec(s);
  if (!m) return;
  let n = Number(m[2]);
  if (!m[1] && n <= 1 && s.includes(".")) n *= 100;
  const next = m[1] ? (current ?? 50) + (m[1] === "-" ? -n : n) : n;
  return Math.max(floor, Math.min(100, Math.round(next)));
}
