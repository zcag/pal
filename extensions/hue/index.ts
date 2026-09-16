// Philips Hue over CLIP v2: rooms, lights and scenes at the root, a
// light/room view under the keys, sensors, automations and entertainment
// areas, the bar item, and the guided pairing. One `Home` (model.ts)
// holds every paired bridge's resources, filled by one `GET /clip/v2/
// resource` per bridge and kept current by each bridge's event stream, so
// a listing or a view never waits on the bridge; a change is one PUT
// (api.ts), applied to the model at once and confirmed by the stream. The
// bridges live in storage (`bridges`), paired here, or come from the
// settings (`bridge` + `application_key`) for a key kept in the keychain.
import { hostname } from "node:os";
import { bar, effects, settings, storage, type BarItem, type BarMenuNode, type Ctx, type Effect, type Extension, type Item, type LinkParams } from "@zcag/pal";
import { Client, GROUP_GAP_MS, HueError, LIGHT_GAP_MS, PAIR_WINDOW_MS, SETTINGS_HINT, config, devicetype, discoverCloud, discoverMdns, peekCertificate, pressLink, type Bridge, type Found, type HueEvent } from "./api.ts";
import { MIREK_MAX, MIREK_MIN, clamp, hsToXy, toHex, xyToHs, type RGB } from "./color.ts";
import { Home, aggregate, automationsOf, entertainmentOf, lightColor, lightsOf, roomsOf, scenesOf, sensorsOf, type Room, type Scene } from "./model.ts";
import { dotPng } from "./png.ts";
import { DURATIONS, EFFECTS, FOCUS, PRESETS, fresh, render, renderSetup, shown, type SetupState, type Target, type ViewState } from "./render.ts";
import { G, NAME, SETUP_ROW, automationRow, entertainmentRow, hint, lightDetail, lightRow, roomRow, roomTile, sceneRow, sensorRows } from "./rows.ts";

/** `[extensions.hue]`, defaults in pal.json. */
type Settings = { bridge: string; application_key: string; insecure: boolean; timeout: number; main_room: string; bar_scenes: string[]; transition: number };
type Args = { light?: string; room?: string; scenes?: string; lights?: string };

const current = (): Settings => settings.get<Settings>(NAME);
const STORAGE_KEY = "bridges";
const DISCOVERY_TTL = 10 * 60_000;
const STREAM_BACKOFF = [1000, 2000, 5000, 15000, 60000];

// ---- the home and its bridges ----------------------------------------------------

const home = new Home();
let bridges: Bridge[] = [];
const clients = new Map<string, Client>();
const streams = new Map<string, AbortController>();
/** Which bridges failed their last read, with the reason: the rows say so. */
const down = new Map<string, HueError>();
let loading: Promise<void> | undefined;
let loadedFor = "";

const settingsBridge = (s: Settings): Bridge | undefined => (s.bridge?.trim() && s.application_key?.trim() && !/^(keychain|env):/.test(s.application_key) ? { id: `settings:${s.bridge.trim()}`, ip: s.bridge.trim(), name: "Hue Bridge", key: s.application_key.trim(), from_settings: true } : undefined);
const clientFor = (b: Bridge) => new Client(b, { timeoutMs: Math.max(1, Number(current().timeout) || 5) * 1000, insecure: !!current().insecure });
const bridgeName = (id: string) => home.bridges.get(id)?.name ?? bridges.find((b) => b.id === id)?.name ?? "Hue";
const several = () => home.bridges.size > 1;

async function readStored(): Promise<Bridge[]> {
  const v = await storage.get<unknown>(STORAGE_KEY, NAME);
  return Array.isArray(v) ? v.filter((b): b is Bridge => !!b && typeof b === "object" && typeof (b as Bridge).ip === "string" && typeof (b as Bridge).key === "string") : [];
}

/** Reads one bridge whole into the home and (re)starts its stream; a failure is remembered for the rows and the bar. */
async function connect(b: Bridge): Promise<void> {
  const c = clientFor(b);
  clients.set(b.id, c);
  try {
    const all = await c.all();
    const info = all.find((r) => r.type === "bridge") as { bridge_id?: string } | undefined;
    // A settings bridge learns its real id from the bridge itself; storage ones were paired with it.
    if (b.from_settings && info?.bridge_id && b.id !== info.bridge_id.toLowerCase()) {
      const real = info.bridge_id.toLowerCase();
      clients.delete(b.id); bridges = bridges.filter((x) => x.id !== b.id || x === b); b.id = real; clients.set(real, c);
    }
    home.load({ id: b.id, name: b.name, ip: b.ip }, all);
    down.delete(b.id);
    startStream(b);
  } catch (e) {
    down.set(b.id, e instanceof HueError ? e : new HueError(String((e as Error)?.message ?? e), "cmd+r tries again"));
    console.error(`hue: ${b.ip}: ${(e as Error).message}`);
  }
}

/** The bridges from storage and the settings, connected once; again when `force` (cmd+r) or the settings changed. */
async function load(force = false): Promise<void> {
  const s = current();
  const key = `${s.bridge}|${s.application_key ? "k" : ""}|${s.insecure}|${s.timeout}`;
  if (loading && !force && key === loadedFor) return loading;
  loadedFor = key;
  loading = (async () => {
    const stored = await readStored();
    const fromSettings = settingsBridge(s);
    // The settings' key wins over a stored one for the same address.
    bridges = [...(fromSettings ? [fromSettings] : []), ...stored.filter((b) => !fromSettings || b.ip !== fromSettings.ip)];
    for (const id of [...clients.keys()]) if (!bridges.some((b) => b.id === id)) { stopStream(id); clients.delete(id); home.forget(id); }
    await Promise.all(bridges.map(connect));
    scheduleBar();
  })();
  return loading;
}

async function saveBridges(list: Bridge[]) {
  await storage.set(STORAGE_KEY, list.filter((b) => !b.from_settings).map(({ from_settings, ...b }) => b), NAME);
}

// ---- the event stream -----------------------------------------------------------------

function stopStream(id: string) { streams.get(id)?.abort(); streams.delete(id); }

/** One long-lived stream per bridge, merged into the home as events arrive; reconnects with backoff, forever, until `dispose` or the bridge is forgotten. */
function startStream(b: Bridge) {
  stopStream(b.id);
  const ctl = new AbortController();
  streams.set(b.id, ctl);
  (async () => {
    let failures = 0;
    while (!ctl.signal.aborted) {
      const c = clients.get(b.id);
      if (!c) return;
      try {
        for await (const ev of c.events(ctl.signal, () => { failures = 0; })) onEvent(b.id, ev);
      } catch (e) {
        if (ctl.signal.aborted) return;
        if (failures === 0) console.error(`hue: stream ${b.ip}: ${(e as Error).message}`);
      }
      if (ctl.signal.aborted) return;
      await Bun.sleep(STREAM_BACKOFF[Math.min(failures++, STREAM_BACKOFF.length - 1)]);
      // Whatever happened while the stream was down is read again whole.
      try { const all = await c.all(); home.load({ id: b.id, name: b.name, ip: b.ip }, all); down.delete(b.id); scheduleBar(); } catch { /* the next round tries again */ }
    }
  })();
}

function onEvent(bridge: string, ev: HueEvent) {
  const touched = home.merge(bridge, ev);
  if (touched.length) scheduleBar();
}

// ---- writes -------------------------------------------------------------------------

/** Per resource, the last body queued while one is in flight: arrow-key repeats collapse to the newest, sent once the gap Hue asks for has passed. */
const inflight = new Map<string, { next?: Record<string, unknown>; timer?: ReturnType<typeof setTimeout> }>();

function applyLocally(bridge: string, rid: string, body: Record<string, unknown>) {
  const { dynamics, alert, ...rest } = body;
  // A PUT names the effect as `effect`; the resource reports it as `status`, which is what the model reads.
  const fx = (rest.effects as { effect?: string } | undefined)?.effect;
  if (fx) rest.effects = { status: fx };
  const cur = home.get(bridge, rid);
  if (cur) home.merge(bridge, { id: "local", type: "update", creationtime: new Date().toISOString(), data: [{ id: rid, type: cur.type, ...rest }] });
}

/** A PUT with Hue's rate guidance: one per light per 100 ms, one per group per second; the model takes the change at once. */
function put(bridge: string, type: string, rid: string, body: Record<string, unknown>, transition?: number): Promise<void> {
  const c = clients.get(bridge);
  if (!c) return Promise.reject(new HueError("No bridge", "Run Set up Hue first"));
  const withDynamics = transition !== undefined && transition > 0 && !("dynamics" in body) ? { ...body, dynamics: { duration: transition } } : body;
  applyLocally(bridge, rid, withDynamics);
  const key = `${bridge}/${rid}`;
  const slot = inflight.get(key);
  if (slot) { slot.next = { ...(slot.next ?? {}), ...withDynamics }; return Promise.resolve(); }
  const entry: { next?: Record<string, unknown>; timer?: ReturnType<typeof setTimeout> } = {};
  inflight.set(key, entry);
  const gap = type === "grouped_light" ? GROUP_GAP_MS : LIGHT_GAP_MS;
  const send = async (b: Record<string, unknown>): Promise<void> => {
    try { await c.put(type, rid, b); } finally {
      entry.timer = setTimeout(() => {
        const next = entry.next;
        entry.next = undefined;
        if (next) void send(next).catch((e) => console.error(`hue: ${type}/${rid}: ${(e as Error).message}`));
        else inflight.delete(key);
      }, gap);
    }
  };
  return send(withDynamics);
}

const toast = (title: string, message?: string, style: "success" | "failure" = "success"): Effect => ({ keep: true, toast: { title, message, style } });
const failed = (what: string, e: unknown): Effect => toast(`Could not ${what}`, e instanceof HueError ? `${e.message}. ${e.hint}` : String((e as Error)?.message ?? e), "failure");

// ---- lookups ---------------------------------------------------------------------------

const findLight = (id: string) => lightsOf(home).find((l) => l.id === id);
const findRoom = (id: string) => roomsOf(home).find((r) => r.id === id);
const findScene = (id: string) => scenesOf(home).find((s) => s.id === id);
const roomScenes = (room: Room | undefined) => (room ? scenesOf(home).filter((s) => s.room?.id === room.id && s.kind === "scene") : []);

async function setRoom(r: Room, body: Record<string, unknown>, transition?: number) {
  if (r.grouped) return put(r.bridge, "grouped_light", r.grouped.rid, body, transition);
  await Promise.all(r.lights.map((l) => put(l.bridge, "light", l.rid, body, transition)));
}

async function recall(s: Scene, dynamic = false): Promise<Effect> {
  try {
    if (s.kind === "smart") { await clients.get(s.bridge)!.put("smart_scene", s.rid, { recall: { action: s.active === "inactive" ? "activate" : "deactivate" } }); return toast(`${s.name}: ${s.active === "inactive" ? "activated" : "deactivated"}`); }
    const t = current().transition;
    await clients.get(s.bridge)!.put("scene", s.rid, { recall: { action: dynamic ? "dynamic_palette" : "active", ...(t > 0 && { duration: t }) } });
    applyLocally(s.bridge, s.rid, { status: { active: dynamic ? "dynamic_palette" : "static" } });
    return toast(`${s.name}${s.room ? ` in ${s.room.name}` : ""}`, dynamic ? "Playing dynamically" : undefined);
  } catch (e) {
    return failed(`play ${s.name}`, e);
  }
}

// ---- the light / room view ---------------------------------------------------------------

const viewStates = new Map<string, ViewState>();
const stateOf = (id: string): ViewState => { let st = viewStates.get(id); if (!st) { st = fresh(); st.duration = current().transition; viewStates.set(id, st); } return st; };

function targetOf(args: Args): Target | undefined {
  if (args.light) { const l = findLight(args.light); return l ? { kind: "light", light: l, room: l.room ? findRoom(l.room.id) : undefined } : undefined; }
  if (args.room) { const r = findRoom(args.room); return r ? { kind: "room", room: r } : undefined; }
  return undefined;
}

const targetId = (t: Target) => (t.kind === "light" ? t.light.id : t.room.id);
const roomOf = (t: Target) => t.room;
const draw = (t: Target) => render(t, stateOf(targetId(t)), roomScenes(roomOf(t)));

/** Where a change from the view goes: the light, or its room when the scope says so. */
async function write(t: Target, st: ViewState, body: Record<string, unknown>) {
  if (t.kind === "room" || (st.scope === "room" && t.room)) return setRoom(t.kind === "room" ? t.room : t.room!, body, st.duration);
  return put(t.light.bridge, "light", t.light.rid, body, st.duration);
}

async function viewPick(t: Target, action: string | undefined): Promise<Effect> {
  const st = stateOf(targetId(t));
  const s = shown(t);
  const scenes = roomScenes(roomOf(t));
  const bri = s.brightness ?? 100;
  const level = (v: number) => write(t, st, v <= 0 ? { on: { on: false } } : { on: { on: true }, dimming: { brightness: clamp(v, 1, 100) } });
  const ct = (delta: number) => { const [lo, hi] = s.mirekRange ?? [MIREK_MIN, MIREK_MAX]; return write(t, st, { on: { on: true }, color_temperature: { mirek: Math.round(clamp((s.mirek ?? hi) + delta, lo, hi)) } }); };
  const hs = (dh: number, ds: number) => {
    const cur = s.hs ?? xyToHs(t.kind === "light" && t.light.xy ? t.light.xy : { x: 0.3127, y: 0.329 });
    const gamut = t.kind === "light" ? t.light.gamut : t.room.lights.find((l) => l.gamut)?.gamut;
    return write(t, st, { on: { on: true }, color: { xy: hsToXy(cur.h + dh, clamp(cur.s + ds, 0, 1), gamut) } });
  };
  const rowLength = st.focus === "presets" ? PRESETS.length : st.focus === "scenes" ? Math.min(8, scenes.length) : st.focus === "effects" ? s.effects.length + 1 : 1;
  try {
    switch (action) {
      case "toggle": case "toggle:t": await write(t, st, { on: { on: !s.on } }); break;
      case "bri+": await level(bri + 5); break;
      case "bri-": await level(bri - 5); break;
      case "bri++": await level(bri + 20); break;
      case "bri--": await level(bri - 20); break;
      case "ct+": await ct(-20); break;
      case "ct-": await ct(20); break;
      case "ct++": await ct(-80); break;
      case "ct--": await ct(80); break;
      case "hue+": await hs(10, 0); break;
      case "hue-": await hs(-10, 0); break;
      case "hue++": await hs(40, 0); break;
      case "hue--": await hs(-40, 0); break;
      case "sat+": await hs(0, 0.05); break;
      case "sat-": await hs(0, -0.05); break;
      case "sat++": await hs(0, 0.2); break;
      case "sat--": await hs(0, -0.2); break;
      case "copy": return { copy: toHex(s.color) };
      case "scenes": return roomOf(t) ? { push: { extension: NAME, palette: "scenes", args: { scenes: roomOf(t)!.id } } } : toast("No room", "This light is in no room", "failure");
      case "room": return t.kind === "light" && t.room ? { push: { extension: NAME, palette: "light", args: { room: t.room.id } } } : { keep: true };
      case "identify": if (t.kind === "light") await clients.get(t.light.bridge)!.put("light", t.light.rid, { alert: { action: "breathe" } }); break;
      case "scope": st.scope = st.scope === "room" ? "light" : "room"; break;
      case "duration": st.duration = DURATIONS[(DURATIONS.indexOf(st.duration) + 1) % DURATIONS.length]; break;
      case "refresh": await load(true); break;
      case "focus:next": st.focus = FOCUS[(FOCUS.indexOf(st.focus) + 1) % FOCUS.length]; st.index = 0; break;
      case "focus:prev": st.focus = FOCUS[(FOCUS.indexOf(st.focus) - 1 + FOCUS.length) % FOCUS.length]; st.index = 0; break;
      case "along:next": st.index = (st.index + 1) % Math.max(1, rowLength); break;
      case "along:prev": st.index = (st.index - 1 + Math.max(1, rowLength)) % Math.max(1, rowLength); break;
      case "apply":
        if (st.focus === "presets") { const p = PRESETS[st.index]; await write(t, st, { on: { on: true }, dimming: { brightness: p.brightness }, ...(s.hasTemperature ? { color_temperature: { mirek: clamp(p.mirek, s.mirekRange?.[0] ?? MIREK_MIN, s.mirekRange?.[1] ?? MIREK_MAX) } } : {}) }); }
        else if (st.focus === "scenes" && scenes[st.index]) { const r = await recall(scenes[st.index]); if (r.toast?.style === "failure") return r; }
        else if (st.focus === "effects") {
          const fx = st.index === 0 ? "no_effect" : s.effects[st.index - 1];
          const lights = t.kind === "light" ? [t.light] : t.room.lights;
          await Promise.all(lights.filter((l) => fx === "no_effect" ? l.effect : l.effects.includes(fx as typeof EFFECTS[number])).map((l) => put(l.bridge, "light", l.rid, fx === "no_effect" ? { effects: { effect: "no_effect" } } : { on: { on: true }, effects: { effect: fx } })));
        }
        break;
      default:
        if (action?.startsWith("level:")) await level(Number(action.slice(6)) * 10);
    }
  } catch (e) {
    return { ...failed(`reach ${s.name}`, e), view: draw(refreshTarget(t) ?? t) };
  }
  // The model already holds the change; the target is read again so the tree shows it.
  return { view: draw(refreshTarget(t) ?? t) };
}

const refreshTarget = (t: Target): Target | undefined => targetOf(t.kind === "light" ? { light: t.light.id } : { room: t.room.id });

// ---- pairing -------------------------------------------------------------------------------

let setup: SetupState = { phase: "idle" };
let typing: string | undefined;
let discovered: { at: number; found: Found[] } | undefined;
let pairing: AbortController | undefined;

/** The cloud endpoint and mDNS, both, kept ten minutes; the settings' address is always a candidate. */
async function discover(force = false): Promise<Found[]> {
  if (!force && discovered && Date.now() - discovered.at < DISCOVERY_TTL) return discovered.found;
  const url = process.env.PAL_HUE_DISCOVERY ?? undefined;
  const [cloud, mdns] = await Promise.all([discoverCloud(url).catch((e) => { console.error(`hue: discovery: ${(e as Error).message}`); return [] as Found[]; }), discoverMdns().catch(() => [] as Found[])]);
  const found: Found[] = [];
  const s = current();
  if (s.bridge?.trim()) found.push({ id: "", ip: s.bridge.trim(), name: "Hue Bridge (settings)", via: "setting" });
  for (const f of [...mdns, ...cloud]) if (!found.some((x) => x.ip === f.ip || (f.id && x.id === f.id))) found.push(f);
  // Every candidate is asked its name and id, no key needed; one that does not answer is left as found.
  await Promise.all(found.map(async (f) => {
    try {
      const cert = await peekCertificate(f.ip, f.port ?? 443).catch(() => undefined);
      const c = await config(f.ip, { insecure: !!s.insecure, cert: cert?.selfSigned ? cert.pem : undefined });
      f.id = c.bridgeid; f.name = c.name;
    } catch { /* keep the discovery's facts */ }
  }));
  discovered = { at: Date.now(), found };
  return found;
}

/** Press-link: asks the bridge every second for thirty seconds from a background task, since a pick may not wait that long; the panel is brought back when the key is in. */
function startPairing(ip: string, name: string, id?: string): void {
  pairing?.abort();
  const ctl = new AbortController();
  pairing = ctl;
  const deadline = Date.now() + PAIR_WINDOW_MS;
  setup = { phase: "press", ip, name, id, deadline, attempts: 0 };
  (async () => {
    let cert: Awaited<ReturnType<typeof peekCertificate>> | undefined;
    const s = current();
    try {
      cert = await peekCertificate(ip);
      if (id && cert.cn && cert.cn !== id && !s.insecure) throw new HueError(`${ip}'s certificate is for bridge ${cert.cn}, not ${id}`, "Another bridge answers at that address; pair by its own address");
    } catch (e) {
      if (!s.insecure) { setup = { phase: "failed", ip, name, error: `${(e as Error).message}${e instanceof HueError ? `. ${e.hint}` : ""}` }; return; }
    }
    const tls = { insecure: !!s.insecure, cert: cert?.selfSigned ? cert.pem : undefined };
    while (!ctl.signal.aborted && Date.now() < deadline) {
      try {
        const r = await pressLink(ip, tls, devicetype(hostname()));
        if (setup.phase === "press") setup.attempts++;
        if (r) {
          const conf = await config(ip, tls).catch(() => ({ name, bridgeid: id ?? cert?.cn ?? ip }));
          const b: Bridge = { id: conf.bridgeid, ip, name: conf.name, key: r.username, clientkey: r.clientkey, cert: cert?.selfSigned ? cert.pem : undefined, paired_at: Date.now() };
          bridges = [...bridges.filter((x) => x.id !== b.id && x.ip !== b.ip), b];
          await saveBridges(bridges);
          await connect(b);
          setup = { phase: "paired", ip, name: conf.name, id: conf.bridgeid, key: r.username };
          scheduleBar();
          await effects.run({ push: { extension: NAME, palette: "setup" } }).catch(() => {});
          return;
        }
      } catch (e) {
        if (setup.phase === "press") setup.error = `${(e as Error).message}${e instanceof HueError ? `. ${e.hint}` : ""}`;
      }
      await Bun.sleep(1000);
    }
    if (!ctl.signal.aborted) {
      setup = { phase: "failed", ip, name, error: "The button was not pressed within 30 seconds. Press it, then try again." };
      await effects.run({ hud: "Hue: the bridge button was not pressed" }).catch(() => {});
    }
  })().catch((e) => { setup = { phase: "failed", ip, name, error: String((e as Error)?.message ?? e) }; });
}

async function setupView() {
  await load();
  const found = setup.phase === "idle" ? await discover() : discovered?.found ?? [];
  return renderSetup(setup, found, bridges, Date.now(), typing);
}

async function setupPick(action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const found = discovered?.found ?? [];
  const byIp = (ip: string) => found.find((f) => f.ip === ip);
  switch (action) {
    case "check": {
      // One immediate attempt, so Enter after the press does not wait for the next tick.
      if (setup.phase === "press") {
        const s = current(), ip = setup.ip;
        try { const r = await pressLink(ip, { insecure: !!s.insecure, cert: bridges.find((b) => b.ip === ip)?.cert }, devicetype(hostname())); if (r) await Bun.sleep(1200); } catch { /* the loop reports it */ }
      }
      break;
    }
    case "cancel": pairing?.abort(); setup = { phase: "idle" }; break;
    case "back": setup = { phase: "idle" }; break;
    case "rescan": discovered = undefined; setup = { phase: "idle" }; break;
    case "type": typing = ""; break;
    case "type:cancel": typing = undefined; break;
    case "rooms": return { push: { extension: NAME, palette: "rooms" } };
    case "copy_key": return setup.phase === "paired" ? { copy: setup.key, hud: "Copied the application key" } : { keep: true };
    case "forget": {
      const b = bridges.find((x) => !x.from_settings);
      if (!b) return toast("Nothing to forget", "The bridge in the settings is removed there", "failure");
      pairing?.abort(); stopStream(b.id); clients.delete(b.id); home.forget(b.id);
      bridges = bridges.filter((x) => x !== b);
      await saveBridges(bridges);
      discovered = undefined;
      scheduleBar();
      break;
    }
    case "pair:typed": {
      const ip = String((ctx?.values as { input?: unknown } | undefined)?.input ?? "").trim();
      typing = undefined;
      if (!/^[\w.:-]+$/.test(ip)) { setup = { phase: "idle", error: `${ip || "Nothing"} is not an address` }; break; }
      startPairing(ip, byIp(ip)?.name ?? "Hue Bridge", byIp(ip)?.id || undefined);
      break;
    }
    default:
      if (action?.startsWith("pair:")) { const ip = action.slice(5); const f = byIp(ip); startPairing(ip, f?.name ?? "Hue Bridge", f?.id || undefined); }
  }
  return { view: renderSetup(setup, discovered?.found ?? [], bridges, Date.now(), typing) };
}

// ---- the bar item ----------------------------------------------------------------------------

let barTimer: ReturnType<typeof setTimeout> | undefined;
/** A push at most every 300 ms: a scene recall is a burst of light events. */
function scheduleBar() {
  if (barTimer) return;
  barTimer = setTimeout(() => { barTimer = undefined; bar.update("home", barItem(), NAME).catch(() => {}); }, 300);
}

/** The room the dot is coloured by: the `main_room` setting, else the room with most lights on. */
function mainRoom(rooms: Room[]): Room | undefined {
  const s = current();
  const named = s.main_room?.trim() ? rooms.find((r) => r.name.toLowerCase() === s.main_room.trim().toLowerCase() || r.id === s.main_room.trim()) : undefined;
  return named ?? [...rooms].filter((r) => r.kind === "room").sort((a, b) => aggregate(b).on - aggregate(a).on)[0];
}

export function barItem(): BarItem {
  if (!bridges.length) return { hidden: true };
  if (!home.paired) return { icon: G.bulbOff, color: "muted", stale: true, tooltip: `Hue: ${down.values().next().value?.message ?? "the bridge did not answer"}`, menu: [{ type: "item", id: "open", title: "Open in pal", subtitle: "The row says what to fix", icon: G.home }] };
  const rooms = roomsOf(home), lights = lightsOf(home), scenes = scenesOf(home);
  const on = lights.filter((l) => l.on).length;
  const main = mainRoom(rooms);
  const a = main ? aggregate(main) : undefined;
  const s = current();
  const wanted = (s.bar_scenes ?? []).map((x) => x.toLowerCase());
  const shortcuts = (wanted.length ? scenes.filter((sc) => wanted.includes(sc.name.toLowerCase()) || wanted.includes(sc.id)) : main ? scenes.filter((sc) => sc.room?.id === main.id) : scenes).slice(0, 6);
  const menu: BarMenuNode[] = [
    { type: "section", title: "Rooms", children: rooms.map((r) => { const ag = aggregate(r); return { type: "item", id: `toggle:${r.id}`, title: r.name, subtitle: ag.on ? `${ag.on} of ${ag.total} on${ag.brightness !== undefined ? ` · ${Math.round(ag.brightness)}%` : ""}` : "off", icon: ag.anyOn ? { image: roomTile(ag.colors, (ag.brightness ?? 100) / 100) } : G.bulbOff, checked: ag.anyOn }; }) },
    ...(shortcuts.length ? [{ type: "section" as const, title: "Scenes", children: shortcuts.map((sc) => ({ type: "item" as const, id: `scene:${sc.id}`, title: sc.name, subtitle: sc.room?.name, icon: sc.swatches[0] ?? G.palette, checked: sc.active !== "inactive" })) }] : []),
    { type: "separator" },
    { type: "item", id: "open", title: "Open in pal", subtitle: "Rooms, lights, scenes", icon: G.home },
    { type: "item", id: "all_off", title: "All off", icon: G.power, style: "destructive", shortcut: "cmd+shift+o" },
  ];
  const stale = down.size > 0 && down.size === home.bridges.size;
  const color: RGB | undefined = a?.anyOn ? a.color : undefined;
  return {
    icon: color ? { image: dotPng(color) } : G.bulbOff,
    title: on ? `${on} on` : undefined,
    color: on ? undefined : "muted",
    tooltip: on ? `${on} of ${lights.length} lights on${main && a?.anyOn ? ` · ${main.name}${a.brightness !== undefined ? ` ${Math.round(a.brightness)}%` : ""}` : ""}` : "All lights off",
    stale: stale || undefined,
    menu,
  };
}

async function allOff(): Promise<Effect> {
  const rooms = roomsOf(home);
  try {
    await Promise.all(rooms.filter((r) => r.kind === "room" && aggregate(r).anyOn).map((r) => setRoom(r, { on: { on: false } }, current().transition)));
    // Lights in no room too.
    await Promise.all(lightsOf(home).filter((l) => !l.room && l.on).map((l) => put(l.bridge, "light", l.rid, { on: { on: false } })));
    return { keep: true, hud: "All lights off" };
  } catch (e) {
    return failed("turn everything off", e);
  }
}

// ---- the list palettes ---------------------------------------------------------------------

/** Rows of a palette, or the setup row with no bridge, or the hint when every bridge is away. */
async function rows(make: () => Item[], ctx?: Ctx): Promise<Item[]> {
  try { await load(!!ctx?.refresh); } catch (e) { return hint(e); }
  if (!bridges.length) return [SETUP_ROW];
  if (!home.paired) return hint(down.values().next().value ?? new HueError("The bridge did not answer", "cmd+r tries again"));
  const list = make();
  const away = [...down.values()];
  return away.length ? [...hint(away[0]), ...list] : list;
}

/** Enter on a room row toggles it; the other actions open, list or copy. */
async function pickRoom(id: string, action: string | undefined): Promise<Effect> {
  if (id === "setup") return { push: { extension: NAME, palette: "setup" } };
  if (id === "hint") return { keep: true };
  const r = findRoom(id);
  if (!r) return toast("Unknown room", id, "failure");
  const a = aggregate(r);
  try {
    switch (action ?? "toggle") {
      case "toggle": await setRoom(r, { on: { on: !a.anyOn } }, current().transition); return { keep: true, hud: `${r.name}: ${a.anyOn ? "off" : "on"}` };
      case "on": await setRoom(r, { on: { on: true } }, current().transition); return { keep: true };
      case "off": await setRoom(r, { on: { on: false } }, current().transition); return { keep: true };
      case "open": return { push: { extension: NAME, palette: "light", args: { room: r.id } } };
      case "scenes": return { push: { extension: NAME, palette: "scenes", args: { scenes: r.id } } };
      case "lights": return { push: { extension: NAME, palette: "lights", args: { lights: r.id } } };
      case "copy_id": return { copy: r.id };
    }
  } catch (e) { return failed(`switch ${r.name}`, e); }
  return { keep: true };
}

async function pickLight(id: string, action: string | undefined): Promise<Effect> {
  if (id === "setup") return { push: { extension: NAME, palette: "setup" } };
  if (id === "hint") return { keep: true };
  const l = findLight(id);
  if (!l) return toast("Unknown light", id, "failure");
  const c = clients.get(l.bridge)!;
  try {
    switch (action ?? "toggle") {
      case "toggle": await put(l.bridge, "light", l.rid, { on: { on: !l.on } }, current().transition); return { keep: true, hud: `${l.name}: ${l.on ? "off" : "on"}` };
      case "on": await put(l.bridge, "light", l.rid, { on: { on: true } }, current().transition); return { keep: true };
      case "off": await put(l.bridge, "light", l.rid, { on: { on: false } }, current().transition); return { keep: true };
      case "open": return { push: { extension: NAME, palette: "light", args: { light: l.id } } };
      case "identify": await c.put("light", l.rid, { alert: { action: "breathe" } }); return toast(`${l.name} is blinking`);
      case "copy_hex": return { copy: toHex(lightColor(l)) };
      case "copy_id": return { copy: l.id };
    }
  } catch (e) { return failed(`switch ${l.name}`, e); }
  return { keep: true };
}

async function pickScene(id: string, action: string | undefined): Promise<Effect> {
  if (id === "setup") return { push: { extension: NAME, palette: "setup" } };
  if (id === "hint") return { keep: true };
  const s = findScene(id);
  if (!s) return toast("Unknown scene", id, "failure");
  switch (action ?? "activate") {
    case "activate": { const r = await recall(s); return r.toast?.style === "failure" ? r : { keep: true, hud: r.toast?.title }; }
    case "dynamic": { const r = await recall(s, true); return r.toast?.style === "failure" ? r : { keep: true, hud: `${s.name}: playing` }; }
    case "room": return s.room ? { push: { extension: NAME, palette: "light", args: { room: s.room.id } } } : { keep: true };
    case "copy_id": return { copy: s.id };
  }
  return { keep: true };
}

export default {
  palettes: {
    rooms: {
      title: "Hue Rooms",
      live: true,
      placeholder: "Search rooms and zones",
      list: (_q, ctx) => rows(() => roomsOf(home).map((r) => roomRow(r, several(), bridgeName(r.bridge))), ctx),
      pick: (id, action) => pickRoom(id, action),
      detail: (id) => { const r = findRoom(id); if (!r) return; const a = aggregate(r); return { metadata: [{ label: r.kind === "zone" ? "Zone" : "Room", value: r.name }, { label: "Lights", value: r.lights.map((l) => `${l.name}${l.on ? " (on)" : ""}`).join(", ") || "None" }, { label: "State", value: a.on ? `${a.on} of ${a.total} on${a.brightness !== undefined ? `, ${Math.round(a.brightness)}%` : ""}` : "Off" }, { label: "Id", value: r.id }] }; },
    },
    lights: {
      title: "Hue Lights",
      live: true,
      placeholder: "Search lights",
      list: (_q, ctx) => rows(() => {
        const args = (ctx?.args ?? {}) as Args;
        const all = lightsOf(home).filter((l) => !args.lights || l.room?.id === args.lights);
        const order = roomsOf(home, false).map((r) => r.name);
        return all.sort((a, b) => (a.room ? order.indexOf(a.room.name) : 99) - (b.room ? order.indexOf(b.room.name) : 99) || a.name.localeCompare(b.name)).map((l) => lightRow(l, several(), bridgeName(l.bridge)));
      }, ctx),
      pick: (id, action) => pickLight(id, action),
      detail: (id) => { const l = findLight(id); return l ? lightDetail(l) : undefined; },
    },
    scenes: {
      title: "Hue Scenes",
      live: true,
      placeholder: "Search scenes",
      list: (_q, ctx) => rows(() => {
        const args = (ctx?.args ?? {}) as Args;
        return scenesOf(home).filter((s) => !args.scenes || s.room?.id === args.scenes).map((s) => sceneRow(s, several(), bridgeName(s.bridge)));
      }, ctx),
      pick: (id, action) => pickScene(id, action),
    },
    light: {
      title: "Hue Light",
      placeholder: "A light or a room under the keys",
      view: async (ctx) => {
        await load();
        const t = targetOf((ctx?.args ?? {}) as Args);
        if (!t) throw new HueError(bridges.length ? "No such light or room" : "No bridge paired", bridges.length ? "Open it from Hue Rooms or Hue Lights" : "Run Set up Hue first");
        return draw(t);
      },
      pick: async (id, action) => {
        const t = targetOf(id.startsWith("light:") ? { light: id } : { room: id });
        if (!t) return toast("Gone", `${id} is no longer on the bridge`, "failure");
        return viewPick(t, action);
      },
    },
    setup: {
      title: "Set up Hue",
      view: setupView,
      pick: (_id, action, ctx) => setupPick(action, ctx),
    },
    sensors: {
      title: "Hue Sensors",
      live: true,
      placeholder: "Search sensors and switches",
      list: (_q, ctx) => rows(() => sensorRows(sensorsOf(home), several(), bridgeName), ctx),
      pick: async (id, action) => {
        if (id === "setup") return { push: { extension: NAME, palette: "setup" } };
        if (id === "hint") return { keep: true };
        const s = sensorsOf(home).find((x) => x.id === id);
        if (!s) return toast("Unknown sensor", id, "failure");
        if (action === "copy_id") return { copy: s.id };
        if (action === "toggle_enabled" && s.enabled !== undefined) {
          const type = { motion: "motion", temperature: "temperature", light_level: "light_level", button: "button", rotary: "relative_rotary", contact: "contact" }[s.kind];
          try { await clients.get(s.bridge)!.put(type, s.rid, { enabled: !s.enabled }); applyLocally(s.bridge, s.rid, { enabled: !s.enabled }); return { keep: true, hud: `${s.name}: ${s.enabled ? "disabled" : "enabled"}` }; } catch (e) { return failed(`change ${s.name}`, e); }
        }
        return { copy: s.value };
      },
    },
    automations: {
      title: "Hue Automations",
      live: true,
      placeholder: "Search automations",
      list: (_q, ctx) => rows(() => automationsOf(home).map((a) => automationRow(a, several(), bridgeName(a.bridge))), ctx),
      pick: async (id, action) => {
        if (id === "setup") return { push: { extension: NAME, palette: "setup" } };
        if (id === "hint") return { keep: true };
        const a = automationsOf(home).find((x) => x.id === id);
        if (!a) return toast("Unknown automation", id, "failure");
        if (action === "copy_id") return { copy: a.id };
        try { await clients.get(a.bridge)!.put("behavior_instance", a.rid, { enabled: !a.enabled }); applyLocally(a.bridge, a.rid, { enabled: !a.enabled }); return { keep: true, hud: `${a.name}: ${a.enabled ? "disabled" : "enabled"}` }; } catch (e) { return failed(`change ${a.name}`, e); }
      },
    },
    entertainment: {
      title: "Hue Entertainment",
      live: true,
      placeholder: "Search entertainment areas",
      list: (_q, ctx) => rows(() => entertainmentOf(home).map((e) => entertainmentRow(e, several(), bridgeName(e.bridge))), ctx),
      pick: async (id, action) => {
        if (id === "setup") return { push: { extension: NAME, palette: "setup" } };
        if (id === "hint") return { keep: true };
        const e = entertainmentOf(home).find((x) => x.id === id);
        if (!e) return toast("Unknown area", id, "failure");
        if (action === "copy_id") return { copy: e.id };
        const start = (action ?? (e.active ? "stop" : "start")) === "start";
        try { await clients.get(e.bridge)!.put("entertainment_configuration", e.rid, { action: start ? "start" : "stop" }); applyLocally(e.bridge, e.rid, { status: start ? "active" : "inactive" }); return { keep: true, hud: `${e.name}: ${start ? "streaming" : "stopped"}` }; } catch (err) { return failed(`${start ? "start" : "stop"} ${e.name}`, err); }
      },
    },
  },
  bar: {
    home: {
      render: async () => { try { await load(); } catch { /* hidden below */ } return barItem(); },
      onAction: async (action) => {
        await load();
        if (action === "open") return { push: { extension: NAME, palette: "rooms" } };
        if (action === "all_off") return allOff();
        if (action.startsWith("toggle:")) { const r = await pickRoom(action.slice(7), "toggle"); return { ...r, keep: true }; }
        if (action.startsWith("scene:")) { const r = await pickScene(action.slice(6), "activate"); return { ...r, keep: true }; }
      },
      onShown: () => load().catch(() => {}),
    },
  },
  link: async (route: string, params: LinkParams): Promise<Effect | void> => {
    await load();
    const want = (k: string) => String(params[k] ?? "").trim().toLowerCase();
    const room = want("room") ? roomsOf(home).find((r) => r.id === want("room") || r.id.slice(r.id.indexOf(":") + 1) === want("room") || r.name.toLowerCase() === want("room")) : undefined;
    if (want("room") && !room) throw new Error(`no room "${params.room}"`);
    switch (route) {
      case "toggle": { if (!room) throw new Error("room is required"); const a = aggregate(room); await setRoom(room, { on: { on: params.on === undefined ? !a.anyOn : !!params.on } }, current().transition); return { hud: `${room.name}: ${(params.on === undefined ? !a.anyOn : !!params.on) ? "on" : "off"}` }; }
      case "scene": {
        const s = scenesOf(home).find((x) => (!room || x.room?.id === room.id) && (x.name.toLowerCase() === want("name") || x.id === want("name") || x.id.endsWith(`/${want("name")}`)));
        if (!s) throw new Error(`no scene "${params.name}"${room ? ` in ${room.name}` : ""}`);
        const r = await recall(s, !!params.dynamic);
        if (r.toast?.style === "failure") throw new Error(r.toast.message ?? r.toast.title);
        return { hud: r.toast?.title };
      }
      case "off": { const r = await allOff(); return { hud: r.hud ?? r.toast?.title }; }
    }
  },
  dispose: () => {
    for (const id of [...streams.keys()]) stopStream(id);
    pairing?.abort();
    if (barTimer) clearTimeout(barTimer);
    for (const e of inflight.values()) if (e.timer) clearTimeout(e.timer);
  },
} satisfies Extension;

// The settings decide which bridges there are: a change reads them again and re-renders the bar.
settings.onChange(() => { load(true).catch((e) => console.error(`hue: ${(e as Error).message}`)); }, NAME);
