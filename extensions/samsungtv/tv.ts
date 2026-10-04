// What every part of the extension shares: the paired TVs and which is
// current, the one connection to it (opened on first use, kept while a
// view, the bar item or Stay connected wants it, closed once nothing has
// for a while), the TV's apps with their pictures, the controls it
// provides (published whenever they change) and the ones served to it
// (its own, or a group's device's: `controls.get`), and the redraw loop:
// every view level of ours that is open is redrawn by the renderer its
// palette registered whenever the TV or a served control says something
// (`push`), a burst being one redraw, and the bar item with it when it
// changed. index.ts and pairing.ts keep their state and register here.
import { bar, controls, errorMessage, failed, settings, state, storage, view as liveView, type BarItem, type ControlName, type ControlStates, type Effect, type Served, type View } from "@zcag/pal";
import { iconData, letterTile } from "./art.ts";
import { fakeDriver } from "./fake.ts";
import type { App, Conn, Driver, Paired } from "./types.ts";

export const NAME = "samsungtv";

/** `[extensions.samsungtv]`, defaults in pal.json. */
export type Settings = { device: string; favorites: string[]; wake: boolean; stay: boolean };
/** The bar item's own settings. */
export type BarSettings = { when: "on" | "app" };
export const cfg = (): Settings => settings.get<Settings>(NAME);

let driverP: Promise<Driver> | undefined;
/** The real driver, loaded on first use; the fake one when a test says so. */
export const driver = (): Promise<Driver> => (driverP ??= process.env.PAL_SAMSUNGTV_FAKE ? Promise.resolve(fakeDriver(process.env.PAL_SAMSUNGTV_FAKE)) : import("./device.ts").then((m) => m.realDriver));

/** An error as a sentence the views can show. */
export const plain = (e: unknown): string => errorMessage(e).replace(/^Error: /, "");

// ---- paired TVs -----------------------------------------------------------------------------------

let devices: Paired[] | undefined;
export async function paired(): Promise<Paired[]> {
  return (devices ??= ((await storage.get("devices", NAME)) as Paired[] | null) ?? []);
}
export async function savePaired(list: Paired[]): Promise<void> {
  devices = list;
  await storage.set("devices", list, NAME);
}
/** The TV the `device` setting names (by name or id), else the one paired last. */
export function current(list: Paired[] = devices ?? []): Paired | undefined {
  const want = cfg().device?.trim().toLowerCase();
  return (want && list.find((d) => d.name.toLowerCase() === want || d.id.toLowerCase() === want)) || list[list.length - 1];
}

// ---- the connection -------------------------------------------------------------------------------

/** The connection's state, read by every view. `waking`: a turn-on is under way. */
export const tv = { conn: undefined as Conn | undefined, state: "down" as "connecting" | "up" | "down", error: undefined as string | undefined, waking: false };
let connecting: Promise<Conn> | undefined;
let unlisten: (() => void) | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const IDLE_MS = 90_000;

/** The open connection to the current TV, opened now when there is none; one attempt at a time. */
export async function ensure(): Promise<Conn> {
  const dev = current(await paired());
  if (!dev) throw new Error("No Samsung TV paired: run Set Up Samsung TV");
  if (tv.conn && tv.conn.device.id === dev.id) return tv.conn;
  if (tv.conn) await drop();
  connecting ??= (async () => {
    tv.state = "connecting"; tv.error = undefined; push();
    try {
      const c = await (await driver()).connect(dev);
      tv.conn = c; tv.state = "up";
      unlisten = c.on((e) => {
        if (e.kind === "connection") tv.error = e.up ? undefined : e.error;
        if (e.kind === "token") void keepToken(c.device.id, e.token);
        push();
      });
      if (c.token !== dev.token) void keepToken(dev.id, c.token);
      return c;
    } catch (e) {
      tv.state = "down"; tv.error = plain(e);
      throw e;
    } finally {
      connecting = undefined;
      push();
      idle();
    }
  })();
  return connecting;
}

/** The TV handed out a new token: kept, so the next connect does not ask for Allow again. */
async function keepToken(id: string, token: string): Promise<void> {
  const list = await paired();
  if (list.some((d) => d.id === id && d.token !== token)) await savePaired(list.map((d) => (d.id === id ? { ...d, token } : d)));
}

/** Wait a moment for a first connection, so a view opened cold draws the TV rather than "connecting". */
export async function warm(ms = 1500): Promise<void> {
  if (!connecting && !tv.conn && (await paired()).length) await Promise.race([ensure().catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

export async function drop(): Promise<void> {
  const c = tv.conn;
  unlisten?.(); unlisten = undefined; tv.conn = undefined; tv.state = "down";
  await c?.close().catch(() => {});
}

/** Close the connection once nothing has wanted it for a while: no level open, Stay connected off. */
export function idle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { idleTimer = undefined; if (!(levels.size > 0 || (cfg().stay && !!devices?.length))) void drop(); else idle(); }, IDLE_MS);
}

/** Run `f` on the connection, as a failure toast when it throws; `undefined` when it went. */
export async function withConn(what: string, f: (c: Conn) => Promise<unknown>): Promise<Effect | undefined> {
  try { await f(await ensure()); return undefined; } catch (e) { return failed(what, e); }
}

/** How long a turn-on from off waits for the TV to answer again. */
const WAKE_MS = 20_000;

/**
 * Turn the TV on: through the connection when there is one (KEY_POWER from
 * standby, Wake-on-LAN), else Wake-on-LAN alone and connect again as it
 * comes up. `busy` on the power control while it does.
 */
export async function turnOn(): Promise<void> {
  const dev = current(await paired());
  if (!dev) throw new Error("No Samsung TV paired");
  tv.waking = true; push();
  try {
    if (tv.conn) return await tv.conn.turnOn();
    await (await driver()).wake(dev);
    const until = Date.now() + WAKE_MS;
    for (;;) {
      if (await ensure().then((c) => c.power() === "on", () => false)) return;
      if (Date.now() >= until) throw new Error(`${dev.name} did not wake; is Power On with Mobile on in its settings (General › Network › Expert Settings)?`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally { tv.waking = false; push(); }
}

// ---- apps and their pictures ------------------------------------------------------------------------

/** App lists per TV, the last read kept in storage so the root and the dock have them before the TV answers. */
export const appLists = new Map<string, App[]>();

export async function appsOf(dev: Paired, fresh = false): Promise<App[]> {
  if (!fresh && appLists.has(dev.id)) return appLists.get(dev.id)!;
  const cached = (await storage.get(`apps:${dev.id}`, NAME)) as App[] | null;
  if (!fresh && cached) { appLists.set(dev.id, cached); return cached; }
  const list = [...(await (await ensure()).apps())].sort((a, b) => a.name.localeCompare(b.name));
  appLists.set(dev.id, list);
  await storage.set(`apps:${dev.id}`, list, NAME).catch(() => {});
  return list;
}

/** The TV's own icons (`ed.apps.icon`), asked once per app; kept in memory, not storage (they are large). */
const icons = new Map<string, string | null>();
export function artOf(a: App): string {
  const have = icons.get(a.id);
  if (have) return have;
  if (have === undefined && a.icon && tv.conn) {
    icons.set(a.id, null);
    void tv.conn.icon(a).then((b) => { const d = iconData(b); if (d) { icons.set(a.id, d); push(); } }).catch(() => {});
  }
  return letterTile(a.name);
}

/** The app on screen, named from the TV's list when it is there. */
export function frontApp(): App | undefined {
  const f = tv.conn?.foreground(), dev = tv.conn?.device;
  if (!f?.visible || !dev) return undefined;
  return (appLists.get(dev.id) ?? []).find((a) => a.id === f.id) ?? { id: f.id, name: f.name };
}

/** How often each app was opened from pal: the dock's order when no favourites are set. */
export let launches: Record<string, number> | undefined;
export async function launch(id: string, name: string): Promise<Effect> {
  const e = await withConn(`open ${name}`, (c) => c.launch(id));
  if (e) return e;
  launches ??= ((await storage.get("launches", NAME)) as Record<string, number> | null) ?? {};
  launches[id] = (launches[id] ?? 0) + 1;
  await storage.set("launches", launches, NAME).catch(() => {});
  return { hud: `Opening ${name}`, keep: true };
}

// ---- the controls it provides, and the ones served to it ----------------------------------------------

/** What this TV publishes for each control now; `null` when it cannot be driven that way. */
export function provided(): { [C in ControlName]: ControlStates[C] | null } {
  const dev = current(), c = tv.conn, on = c?.power() === "on";
  const device = dev?.name;
  const v = on ? c!.volume() : undefined;
  const m = on ? c!.media() : undefined, front = on ? frontApp() : undefined;
  return {
    // The keys always step it; a level only while the TV takes one (`levelSettable`: not with its sound on the soundbar).
    volume: on ? { device, ...(v !== undefined && c!.levelSettable() !== false && { level: v / 100 }), muted: c!.muted() ?? false } : null,
    // A TV that is off is still woken by Wake-on-LAN: its power stays offered while its MAC is known.
    power: dev && (c || dev.mac) ? { device, on: !!on, ...(tv.waking && { busy: true }) } : null,
    inputs: on ? { device, list: c!.inputs().map((i) => ({ id: i.id, name: i.name })) } : null,
    player: on && (m || front) ? {
      device, app: front?.name, title: m?.title ?? front?.name, palette: "remote",
      ...(m && { state: m.state === "playing" ? "playing" : m.state === "paused" ? "paused" : "stopped", position: m.position, at: m.at, duration: m.duration }),
    } : null,
  };
}

let publishedJson: Partial<Record<ControlName, string>> = {};
function publishControls(): void {
  for (const [k, v] of Object.entries(provided()) as [ControlName, ControlStates[ControlName] | null][]) {
    const json = JSON.stringify(v);
    if (publishedJson[k] === json) continue;
    publishedJson[k] = json;
    void controls.publish(k, v as never, NAME).catch(() => { publishedJson[k] = undefined; });
  }
}

/** The controls as they are served to this TV's remote: its own, or what its group binds (another device's volume). */
export const served: { volume?: Served<"volume"> | null; power?: Served<"power"> | null; inputs?: Served<"inputs"> | null } = {};
async function refreshServed(): Promise<void> {
  const [volume, power, inputs] = await Promise.all((["volume", "power", "inputs"] as const).map((c) => controls.get(c, NAME).catch(() => null)));
  Object.assign(served, { volume, power, inputs });
  push();
}
controls.onChange((c) => { if (c.mine) void refreshServed(); }, NAME);

// ---- open levels and the redraw ---------------------------------------------------------------------

/** A view level of ours that is open: a palette's (or the bar item's popover), panel or popover layout. */
export type Level = { palette?: string; bar?: string; compact?: boolean };
const levels = new Map<string, Level>();
const levelKey = (l: Level) => (l.bar ? `bar:${l.bar}` : `palette:${l.palette}`);
export const openLevels = () => [...levels.values()];

const renderers = new Map<string, (l: Level) => Promise<View>>();
export const registerView = (key: string, f: (l: Level) => Promise<View>) => renderers.set(key, f);
let barRender: (() => Promise<BarItem>) | undefined;
export const registerBar = (f: () => Promise<BarItem>) => { barRender = f; };
const opened: ((l: Level) => void)[] = [];
export const onOpen = (f: (l: Level) => void) => opened.push(f);

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastBar = "";
/** Redraw every open level of ours and the bar item, publish what changed; a burst of calls is one redraw. */
export function push(): void {
  if (pushTimer) return;
  pushTimer = setTimeout(async () => {
    pushTimer = undefined;
    // Nothing a redraw meets may escape: an unhandled rejection ends the worker.
    try {
      publishControls();
      publishStates();
      for (const l of openLevels()) {
        const f = renderers.get(l.bar ? `bar:${l.bar}` : l.palette!);
        if (!f) continue;
        const v = await f(l).catch(() => undefined);
        if (v) void liveView.update(v, { ...(l.bar ? { bar: l.bar } : { palette: l.palette }), id: v.id, extension: NAME }).catch(() => {});
      }
      if (devices?.length && barRender) {
        const item = await barRender(), json = JSON.stringify(item);
        if (json !== lastBar) { lastBar = json; void bar.update("tv", item, NAME).catch(() => {}); }
      }
      ticking();
    } catch (e) {
      console.error(`[samsungtv] redraw: ${plain(e)}`);
    }
  }, 30);
}

let tick: ReturnType<typeof setInterval> | undefined;
/** A 1 s beat while a level is open and media plays: the position moves. */
function ticking(): void {
  const want = levels.size > 0 && tv.conn?.media()?.state === "playing";
  if (want && !tick) tick = setInterval(() => { if (tv.conn?.media()?.state !== "playing" || !levels.size) { clearInterval(tick); tick = undefined; } push(); }, 1000);
}

liveView.onShown((ev) => {
  if (!ev.bar && !renderers.has(ev.palette ?? "")) return;
  const l: Level = { palette: ev.palette, bar: ev.bar, compact: ev.compact };
  levels.set(levelKey(l), l);
  for (const f of opened) f(l);
  void ensure().then(async () => {
    const dev = current(await paired());
    if (dev && !appLists.has(dev.id)) await appsOf(dev).catch(() => {});
    push();
  }).catch(() => push());
}, NAME);
liveView.onHidden((ev) => { levels.delete(levelKey({ palette: ev.palette, bar: ev.bar })); idle(); }, NAME);

// ---- states --------------------------------------------------------------------------------------------

let said: Record<string, unknown> = {};
/** `samsungtv/power` and `app`: published when they change. */
function publishStates(): void {
  const c = tv.conn;
  const now: Record<string, unknown> = { power: c ? c.power() : null, app: frontApp()?.name ?? null };
  for (const [k, v] of Object.entries(now)) if (said[k] !== v) void state.set(k, v as string | null, NAME).catch(() => {});
  said = now;
}

export function disposeTv(): void {
  for (const t of [idleTimer, pushTimer]) if (t) clearTimeout(t);
  if (tick) clearInterval(tick);
  void drop();
}

// The device setting moves the connection.
let lastDevice: string | undefined;
settings.onChange(() => {
  const want = cfg().device ?? "";
  if (lastDevice !== undefined && want !== lastDevice && tv.conn && current()?.id !== tv.conn.device.id) void drop().then(() => ensure()).catch(() => {});
  lastDevice = want;
  push();
}, NAME);

void refreshServed();
