// Apple TV: a remote under the keys, its apps at the root, typing into the
// TV, what plays on the bar, and a guided pairing. One connection to the
// current Apple TV (device.ts: Companion for the buttons, apps, text and
// power; MRP over AirPlay for what plays) is opened on first use and kept
// while the remote or the bar item needs it; everything it tells (a new
// song, the TV going to sleep, a keyboard on screen) pushes a fresh tree
// into every open remote level (`view.update`) and the bar item
// (`bar.update`), so nothing here polls the TV. A pressed key lights its
// part of the clickpad for 160 ms. Pairing keeps the long-term keys in
// storage (`devices`); which Apple TV is current is the `device` setting,
// so Settings shows and changes it too.
import { bar, errorMessage, failed, imageData, settings, state, storage, toast, view as liveView, type BarCtx, type BarItem, type Ctx, type Effect, type Extension, type Item, type LinkParams } from "@zcag/pal";
import { placeholderArt } from "./art.ts";
import { fakeDriver } from "./fake.ts";
import { DOCK_WIDE, G, positionAt, render as renderRemote, titles, type DockApp, type Flash, type Layout, type RemoteState } from "./remote.ts";
import { NAME, SETUP_ROW, accountRow, appRow, commandRows, noTv } from "./rows.ts";
import { render as renderSetup, type Check, type SetupState } from "./setup.ts";
import type { App, Conn, Credentials, Driver, Found, Key, MediaCommand, Pairing, PairProtocol, Paired, Press, Swipe } from "./types.ts";

/** `[extensions.apple-tv]`, defaults in pal.json. */
type Settings = { device: string; favorites: string[]; skip: number; wake: boolean; stay: boolean };
/** The bar item's own settings. */
type BarSettings = { when: "playing" | "awake"; artwork: boolean };

const cfg = (): Settings => settings.get<Settings>(NAME);
let barCfg: BarSettings = { when: "playing", artwork: true };

// ---- the driver ------------------------------------------------------------------------------

let driverP: Promise<Driver> | undefined;
/** The real driver, loaded on first use (it pulls in the protocol stack); the fake one when a test says so. */
const driver = (): Promise<Driver> => (driverP ??= process.env.PAL_APPLETV_FAKE ? Promise.resolve(fakeDriver(process.env.PAL_APPLETV_FAKE)) : import("./device.ts").then((m) => m.realDriver));

// ---- paired Apple TVs ------------------------------------------------------------------------

let devices: Paired[] | undefined;
async function paired(): Promise<Paired[]> {
  return (devices ??= ((await storage.get("devices", NAME)) as Paired[] | null) ?? []);
}
async function savePaired(list: Paired[]): Promise<void> {
  devices = list;
  await storage.set("devices", list, NAME);
}
/** The Apple TV the `device` setting names (by name or id), else the one paired last. */
function current(list: Paired[]): Paired | undefined {
  const want = cfg().device?.trim().toLowerCase();
  return (want && list.find((d) => d.name.toLowerCase() === want || d.id.toLowerCase() === want)) || list[list.length - 1];
}

// ---- the connection ---------------------------------------------------------------------------

let conn: Conn | undefined;
let connecting: Promise<Conn> | undefined;
let connState: RemoteState["conn"] = "down";
let connError: string | undefined;
let unlisten: (() => void) | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const IDLE_MS = 90_000;

/** The open connection to the current Apple TV, opened now when there is none; one attempt at a time. */
async function ensure(): Promise<Conn> {
  const dev = current(await paired());
  if (!dev) throw new Error("No Apple TV paired: run Set Up Apple TV");
  if (conn && conn.device.id === dev.id) return conn;
  if (conn) await drop();
  connecting ??= (async () => {
    connState = "connecting"; connError = undefined; push();
    try {
      const c = await (await driver()).connect(dev);
      conn = c; connState = "up";
      unlisten = c.on((e) => {
        if (e.kind === "connection") { connState = e.up ? "up" : "down"; connError = e.error; }
        if (e.kind === "now_playing") cover();
        push();
      });
      cover();
      return c;
    } catch (e) {
      connState = "down"; connError = plain(e);
      throw e;
    } finally {
      connecting = undefined;
      push();
      idle();
    }
  })();
  return connecting;
}

async function drop(): Promise<void> {
  const c = conn;
  unlisten?.(); unlisten = undefined; conn = undefined; connState = "down";
  await c?.close().catch(() => {});
}

/** Whether something wants the connection kept: an open remote, or the bar item with Stay connected on. */
const wanted = () => openLevels().length > 0 || (cfg().stay && !!devices?.length);

/** Close the connection once nothing has wanted it for a while. */
function idle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { idleTimer = undefined; if (!wanted()) drop(); else idle(); }, IDLE_MS);
}

/** An error as a sentence the views can show. */
const plain = (e: unknown): string => errorMessage(e).replace(/^Error: /, "");

/** Run `f` on the connection, as a toast on failure. */
async function withConn(what: string, f: (c: Conn) => Promise<unknown>): Promise<Effect | undefined> {
  try { await f(await ensure()); return undefined; } catch (e) { return failed(what, e); }
}

// ---- what the views draw ----------------------------------------------------------------------

let typing = false;
let flash: Flash | undefined;
let swipe: Swipe | undefined;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
const FLASH_MS = 160;

/** App lists per Apple TV, the last read kept in storage so the root and the dock have them before the TV answers. */
const appLists = new Map<string, App[]>();
/** Pictures by bundle id: the App Store icon once fetched, else the stand-in. */
const icons = new Map<string, string>();
let iconUrls: Record<string, string | null> | undefined;
/** How often each app was opened from pal: the dock's order when no favourites are set. */
let launches: Record<string, number> | undefined;
/** The cover of what plays, keyed by the item. */
let coverArt: { item: string; data?: string } | undefined;

async function appsOf(dev: Paired, fresh = false): Promise<App[]> {
  if (!fresh && appLists.has(dev.id)) return appLists.get(dev.id)!;
  const cached = (await storage.get(`apps:${dev.id}`, NAME)) as App[] | null;
  if (!fresh && cached) { appLists.set(dev.id, cached); return cached; }
  const list = [...(await (await ensure()).apps())].sort((a, b) => a.name.localeCompare(b.name));
  appLists.set(dev.id, list);
  await storage.set(`apps:${dev.id}`, list, NAME);
  return list;
}

/** An app's picture now: the fetched icon, else Apple's mark or the initial (and the fetch starts, pushing when it lands). */
function artOf(a: App): string {
  const have = icons.get(a.id);
  if (have) return have;
  const stand = placeholderArt(a.id, a.name);
  icons.set(a.id, stand);
  void fetchIcon(a.id).then((data) => { if (data) { icons.set(a.id, data); push(); } });
  return stand;
}

async function fetchIcon(bundleId: string): Promise<string | undefined> {
  iconUrls ??= ((await storage.get("icons", NAME)) as Record<string, string | null> | null) ?? {};
  let url = iconUrls[bundleId];
  if (url === undefined) {
    url = (await (await driver()).appIcon(bundleId).catch(() => undefined)) ?? null;
    iconUrls[bundleId] = url;
    await storage.set("icons", iconUrls, NAME).catch(() => {});
  }
  return url ? imageData(url) : undefined;
}

/** The cover of what plays, fetched once per item (a push when it lands); none from an app that gives none. */
function cover(): void {
  const n = conn?.nowPlaying();
  const item = n?.itemId ?? `${n?.title ?? ""}|${n?.app?.id ?? ""}`;
  if (!n || !n.title || coverArt?.item === item) return;
  coverArt = { item };
  if (n.artworkAvailable === false) return;
  conn!.artwork(300, 300).then((bytes) => {
    if (!bytes?.length || coverArt?.item !== item) return;
    const type = bytes[0] === 0x89 ? "image/png" : "image/jpeg";
    coverArt = { item, data: `data:${type};base64,${Buffer.from(bytes).toString("base64")}` };
    push();
  }).catch(() => {});
}

/** The dock: the favourites setting in its order (names or bundle ids), else the apps opened most, else the TV's own first ones. */
function dockOf(apps: App[]): DockApp[] {
  const favs = cfg().favorites ?? [];
  const find = (k: string) => apps.find((a) => a.id === k || a.name.toLowerCase() === k.trim().toLowerCase());
  let picked: App[] = favs.map(find).filter((a): a is App => !!a);
  if (!picked.length) {
    const used = Object.entries(launches ?? {}).sort((a, b) => b[1] - a[1]).map(([id]) => apps.find((a) => a.id === id)).filter((a): a is App => !!a);
    const likely = ["com.apple.TVWatchList", "com.google.ios.youtube", "com.netflix.Netflix", "com.plexapp.plex", "com.spotify.client", "com.apple.TVMusic", "com.apple.TVPhotos", "com.apple.TVSettings"].map(find).filter((a): a is App => !!a);
    picked = [...new Map([...used, ...likely, ...apps].map((a) => [a.id, a])).values()];
  }
  return picked.slice(0, DOCK_WIDE).map((a) => ({ id: a.id, name: a.name, art: artOf(a) }));
}

/** The remote's whole state for a layout, from what the connection last said. */
async function remoteState(layout: Layout): Promise<RemoteState> {
  const list = await paired();
  const dev = current(list);
  const base: RemoteState = { layout, conn: connState, error: connError, power: "unknown", dock: [], skip: cfg().skip || 10, mrp: false };
  if (!dev) return { ...base, unpaired: true };
  base.device = { name: dev.name, modelName: dev.modelName };
  base.others = list.length - 1;
  base.noAirplay = !dev.airplay;
  if (!conn) return base;
  const now = conn.nowPlaying();
  const apps = appLists.get(dev.id) ?? [];
  const front = now?.app?.id ? apps.find((a) => a.id === now.app!.id) ?? { id: now.app.id, name: now.app.name ?? now.app.id } : undefined;
  return {
    ...base,
    power: conn.power(),
    now,
    position: positionAt(now, Date.now()),
    art: coverArt?.data,
    app: front ? { ...front, art: artOf(front) } : undefined,
    volume: conn.volume(),
    keyboard: conn.keyboard(),
    typing,
    dock: dockOf(apps),
    flash, swipe,
    mrp: conn.mrpUp,
  };
}

// ---- pushes into open levels ----------------------------------------------------------------------

type Level = { palette?: string; bar?: string; compact?: boolean };
const levels = new Map<string, Level>();
const levelKey = (l: Level) => (l.bar ? `bar:${l.bar}` : `palette:${l.palette}`);
const openLevels = () => [...levels.values()];

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let lastBar = "";
/** Redraw every open remote level and the bar item; a burst of events is one redraw. */
function push(): void {
  if (pushTimer) return;
  pushTimer = setTimeout(async () => {
    pushTimer = undefined;
    for (const l of openLevels()) {
      const layout: Layout = l.compact || l.bar ? "compact" : "wide";
      const tree = renderRemote(await remoteState(layout));
      void liveView.update(tree, { ...(l.bar ? { bar: l.bar } : { palette: l.palette }), id: "remote", extension: NAME }).catch(() => {});
    }
    if (devices?.length) {
      // A key's flash redraws the remote twice; the strip only when it changed.
      const item = await barItem(), json = JSON.stringify(item);
      if (json !== lastBar) { lastBar = json; void bar.update("playing", item, NAME).catch(() => {}); }
    }
    publish();
  }, 30);
}

let tick: ReturnType<typeof setInterval> | undefined;
/** A 1 s beat while a remote is open and something plays: the position moves. */
function ticking(): void {
  const want = openLevels().length > 0 && conn?.nowPlaying()?.state === "playing";
  if (want && !tick) tick = setInterval(() => { if (conn?.nowPlaying()?.state !== "playing" || !openLevels().length) { clearInterval(tick); tick = undefined; } push(); }, 1000);
}

liveView.onShown((ev) => {
  if (ev.palette !== "remote" && ev.bar !== "playing") return;
  levels.set(levelKey(ev), { palette: ev.palette, bar: ev.bar, compact: ev.compact });
  void ensure().then(async (c) => {
    if (cfg().wake && c.power() === "off" && ev.palette === "remote") await c.turnOn().catch(() => {});
    const dev = current(await paired());
    if (dev && !appLists.has(dev.id)) await appsOf(dev).catch(() => {});
    push(); ticking();
  }).catch(() => push());
}, NAME);
liveView.onHidden((ev) => { levels.delete(levelKey(ev)); if (ev.palette === "remote") typing = false; idle(); }, NAME);

/** Light a part of the pad for a moment. */
function lightUp(f: Flash | undefined, s?: Swipe): void {
  flash = f; swipe = s;
  push();
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = undefined; swipe = undefined; push(); }, FLASH_MS);
}

// ---- states --------------------------------------------------------------------------------

let said: Record<string, unknown> = {};
/** `apple-tv/power`, `playing`, `app`, `title`: published when they change. */
function publish(): void {
  const n = conn?.nowPlaying();
  const now: Record<string, unknown> = {
    power: conn ? conn.power() : null,
    playing: conn ? n?.state === "playing" : null,
    app: n?.app?.name ?? n?.app?.id ?? null,
    title: n?.title ?? null,
  };
  for (const [k, v] of Object.entries(now)) if (said[k] !== v) void state.set(k, v as string | boolean | null, NAME).catch(() => {});
  said = now;
}

// ---- the remote's actions ------------------------------------------------------------------------

const KEYS: Record<string, [Key, Press?, Flash?]> = {
  up: ["up", "tap", "up"], down: ["down", "tap", "down"], left: ["left", "tap", "left"], right: ["right", "tap", "right"],
  select: ["select", "tap", "select"], "select:hold": ["select", "hold", "select"],
  menu: ["menu", "tap", "menu"], home: ["home", "tap", "home"], "home:double": ["home", "double", "home"], "control-center": ["home", "hold", "home"],
  "play-pause": ["play_pause", "tap", "play"], "volume-up": ["volume_up", "tap", "vol+"], "volume-down": ["volume_down", "tap", "vol-"],
  screensaver: ["screensaver"],
};
const MEDIA: Record<string, MediaCommand> = { "skip-back": "skip_backward", "skip-forward": "skip_forward", previous: "previous", next: "next" };

/** One action of the remote, from a key, a click, the bar popover or a root row; `undefined` means it was done and the view redraws. */
async function act(action: string, ctx?: Ctx | BarCtx): Promise<Effect | undefined> {
  const values = (ctx as Ctx | undefined)?.values;
  if (KEYS[action]) {
    const [key, press, f] = KEYS[action];
    if (f) lightUp(f);
    return withConn("press the key", (c) => c.key(key, press));
  }
  if (MEDIA[action]) return withConn("send it", (c) => c.media(MEDIA[action], action.startsWith("skip") ? cfg().skip || 10 : undefined));
  if (action.startsWith("swipe:")) { const d = action.slice(6) as Swipe; lightUp(undefined, d); return withConn("swipe", (c) => c.swipe(d)); }
  if (action.startsWith("launch:")) {
    const dev = current(await paired());
    const app = dev ? dockOf(appLists.get(dev.id) ?? [])[Number(action.slice(7))] : undefined;
    return app ? launch(app.id, app.name) : { keep: true };
  }
  switch (action) {
    case "power": {
      lightUp("power");
      return withConn("switch it", async (c) => { if (c.power() === "off") await c.turnOn(); else await c.turnOff(); });
    }
    case "wake": return withConn("wake it", (c) => c.turnOn());
    case "sleep": return withConn("put it to sleep", (c) => c.turnOff());
    case "seek": {
      const n = conn?.nowPlaying(), f = Number(values?.value);
      if (!n?.duration || Number.isNaN(f)) return { keep: true };
      return withConn("seek", (c) => c.media("seek", Math.round(f * n.duration!)));
    }
    case "volume:set": {
      const f = Number(values?.value);
      return Number.isNaN(f) ? { keep: true } : withConn("set the volume", (c) => c.setVolume(Math.min(1, Math.max(0, f))));
    }
    case "type": {
      const c = await ensure().catch(() => undefined);
      if (!c) return toast("Not connected", connError ?? "The Apple TV did not answer", "failure");
      if (!c.keyboard().focused) return toast("Nothing to type into yet", "Open a search or a text field on the TV first; the remote says when one is waiting", "failure");
      typing = true;
      return undefined;
    }
    case "type:send": {
      const text = String(values?.input ?? "");
      typing = false;
      const e = await withConn("type", (c) => c.setText(text));
      return e ?? { hud: text ? `Typed “${text.length > 40 ? `${text.slice(0, 39)}…` : text}”` : "Cleared the field", keep: true };
    }
    case "type:cancel": typing = false; return undefined;
    case "apps": return { push: { extension: NAME, palette: "apps" } };
    case "accounts": return { push: { extension: NAME, palette: "users" } };
    case "setup": return { push: { extension: NAME, palette: "setup" } };
    case "reconnect": await drop(); await ensure().catch(() => {}); return undefined;
    case "device": {
      const list = await paired(), dev = current(list);
      if (list.length < 2) return { keep: true };
      const next = list[(list.findIndex((d) => d.id === dev?.id) + 1) % list.length];
      await settings.set({ device: next.name }, NAME);
      await drop(); await ensure().catch(() => {});
      return undefined;
    }
    case "copy": {
      const n = conn?.nowPlaying();
      if (!n?.title) return toast("Nothing playing", undefined, "failure");
      const t = titles(n, n.app?.name);
      return { copy: [t.title, t.sub].filter(Boolean).join(" · ") };
    }
  }
  return { keep: true };
}

async function launch(id: string, name: string): Promise<Effect> {
  const e = await withConn(`open ${name}`, (c) => c.launch(id));
  if (e) return e;
  launches ??= ((await storage.get("launches", NAME)) as Record<string, number> | null) ?? {};
  launches[id] = (launches[id] ?? 0) + 1;
  await storage.set("launches", launches, NAME).catch(() => {});
  return { hud: `Opening ${name}`, keep: true };
}

/** A remote action from the panel view or the popover: done means a new tree in place. */
async function remotePick(action: string | undefined, ctx: Ctx | BarCtx | undefined, layout: Layout): Promise<Effect> {
  const e = await act(action ?? "select", ctx);
  ticking();
  const v = renderRemote(await remoteState(layout));
  if (!e) return { view: v };
  return e.push || e.copy || e.hud ? e : { ...e, view: v };
}

// ---- the bar item -------------------------------------------------------------------------------------

async function barItem(): Promise<BarItem> {
  const list = await paired();
  const dev = current(list);
  if (!dev) return { hidden: true };
  const menu = { view: renderRemote(await remoteState("compact")) };
  if (!conn) return { hidden: true, empty: { icon: G.tv, tooltip: connError ? `${dev.name}: ${connError}` : `${dev.name}: not connected`, menu } };
  const n = conn.nowPlaying(), power = conn.power();
  const loaded = n && n.state !== "idle" && n.state !== "stopped" && !!(n.title || n.series);
  const app = n?.app?.id ? (appLists.get(dev.id) ?? []).find((a) => a.id === n.app!.id) ?? { id: n.app.id, name: n.app.name ?? n.app.id } : undefined;
  // The strip's renderers draw a raster picture only (the App Store's icon, base64 PNG or JPEG); a drawn SVG tile stays in the views and the TV mark stands in.
  const pic = app ? artOf(app) : undefined;
  const icon = barCfg.artwork && pic && /^data:image\/(png|jpeg);base64,/.test(pic) ? { image: pic } : G.tv;
  if (power === "off") return { hidden: true, empty: { icon: G.tv, tooltip: `${dev.name} is asleep`, menu } };
  if (!loaded && barCfg.when === "playing") return { hidden: true, empty: { icon: G.tv, tooltip: `${dev.name}: nothing playing`, menu } };
  const t = loaded ? titles(n!, app?.name) : undefined;
  const title = t ? [t.title, t.sub && !n!.series ? t.sub : undefined].filter(Boolean).join(" · ") : app?.name ?? "Home Screen";
  return {
    icon,
    title: title.length > 48 ? `${title.slice(0, 47)}…` : title,
    color: n?.state === "paused" ? "muted" : undefined,
    tooltip: `${t ? [t.title, t.sub].filter(Boolean).join(" · ") : title}${app ? ` · ${app.name}` : ""} on ${dev.name}${n?.state === "paused" ? ", paused" : ""}`,
    states: { power, playing: n?.state === "playing", app: app?.name ?? null, title: n?.title ?? null },
    menu,
  };
}

// ---- setup -----------------------------------------------------------------------------------------

let setup: SetupState = { phase: "find", scanning: false };
let found: Found[] = [];
let scannedAt = 0;
let scanning: Promise<void> | undefined;
let pairing: Pairing | undefined;
let companionCreds: Credentials | undefined;
let typingAddress: string | undefined;

function pushSetup(): void {
  void paired().then((list) => liveView.update(renderSetup(setup, found, list, typingAddress), { palette: "setup", id: "setup", extension: NAME }).catch(() => {}));
}

function scan(): void {
  if (scanning) return;
  setup = { phase: "find", scanning: true };
  scanning = (async () => {
    try { found = await (await driver()).scan(4000); setup = { phase: "find", scanning: false }; }
    catch (e) { setup = { phase: "find", scanning: false, error: `Could not look: ${plain(e)}` }; }
    scannedAt = Date.now(); scanning = undefined;
    pushSetup();
  })();
}

/** Put a code on the TV for `protocol` and wait for it to be typed. */
function askPin(device: Found, protocol: PairProtocol, error?: string, tries = 0): void {
  pairing?.cancel();
  pairing = undefined;
  setup = { phase: "pin", protocol, device, asking: true, error, tries };
  void (async () => {
    try {
      // A sleeping TV is woken by the connection itself; give it the time to draw the code.
      pairing = await (await driver()).pair(device, protocol);
      if (setup.phase === "pin" && setup.device.id === device.id) setup = { ...setup, asking: false };
    } catch (e) {
      setup = { phase: "failed", device, protocol, error: plain(e), hint: protocol === "companion" ? "On the Apple TV: Settings › Remotes and Devices › Remote App and Devices should list pal while the code shows. If no code appears, check Settings › AirPlay and HomeKit › Allow Access." : "On the Apple TV: Settings › AirPlay and HomeKit › Allow Access set to Everyone on the Same Network lets the code appear; you can also skip this step." };
    }
    pushSetup();
  })();
}

async function savePairing(device: Found, companion: Credentials, airplay?: Credentials): Promise<Paired> {
  const list = (await paired()).filter((d) => d.id !== device.id);
  const p: Paired = { id: device.id, name: device.name, address: device.address, model: device.model, modelName: device.modelName, companionPort: device.companionPort, airplayPort: device.airplayPort, companion, airplay, pairedAt: Date.now() };
  await savePaired([...list, p]);
  await settings.set({ device: p.name }, NAME).catch(() => {});
  return p;
}

/** Connect to the freshly paired TV and read what works: the checks of the Ready step. */
async function check(p: Paired): Promise<Check[]> {
  await drop();
  const c = await ensure();
  const checks: Check[] = [{ ok: true, what: "Remote", detail: "Buttons, swipes, sleep and wake" }];
  const apps = await appsOf(p, true).catch(() => [] as App[]);
  checks.push({ ok: apps.length > 0, what: "Apps", detail: apps.length ? `${apps.length} apps, a digit each for the dock` : "The TV did not list its apps" });
  checks.push({ ok: true, what: "Typing", detail: "Into any text field the TV shows (t on the remote)" });
  const v = c.volume();
  checks.push({ ok: v !== undefined ? true : "skipped", what: "Volume", detail: v !== undefined ? `${Math.round(v * 100)}% now; the slider sets it` : "The TV does not report its volume: the buttons step it" });
  if (!p.airplay) checks.push({ ok: "skipped", what: "Now playing", detail: "Skipped: the remote works without it; Set Up again adds it" });
  else { const n = c.nowPlaying(); checks.push({ ok: c.mrpUp, what: "Now playing", detail: c.mrpUp ? (n?.title ? `${n.title}${n.app?.name ? ` in ${n.app.name}` : ""}` : "Nothing playing right now; the bar item shows it when something does") : "Paired, but the TV did not answer yet" }); }
  const accounts = await c.accounts().catch(() => []);
  if (accounts.length > 1) checks.push({ ok: true, what: "Users", detail: `${accounts.length} people: u switches` });
  return checks;
}

function finish(device: Found, companion: Credentials, airplay?: Credentials): void {
  setup = { phase: "checking", device };
  void (async () => {
    const p = await savePairing(device, companion, airplay);
    try { setup = { phase: "ready", device: p, checks: await check(p) }; }
    catch (e) { setup = { phase: "ready", device: p, checks: [{ ok: false, what: "Connection", detail: `Paired, but the connection failed: ${plain(e)}` }] }; }
    pushSetup(); push();
  })();
}

async function setupView(): Promise<ReturnType<typeof renderSetup>> {
  if (setup.phase === "find" && !scanning && Date.now() - scannedAt > 20_000) scan();
  return renderSetup(setup, found, await paired(), typingAddress);
}

async function setupPick(action: string | undefined, ctx?: Ctx): Promise<Effect> {
  const input = String(ctx?.values?.input ?? "").trim();
  const byId = (id: string) => found.find((f) => f.id === id);
  switch (action) {
    case "rescan": scannedAt = 0; scan(); break;
    case "type": typingAddress = ""; break;
    case "type:cancel": typingAddress = undefined; break;
    case "pair:typed": {
      typingAddress = undefined;
      if (!/^[\w.:-]+$/.test(input)) { setup = { phase: "find", scanning: false, error: `${input || "Nothing"} is not an address` }; break; }
      const f = found.find((x) => x.address === input) ?? { id: input, name: input, address: input, model: "AppleTV", modelName: "Apple TV", companionPort: 49153, airplayPort: 7000 };
      if (!found.includes(f)) found = [...found, f];
      companionCreds = undefined; askPin(f, "companion");
      break;
    }
    case "pin": {
      if (setup.phase !== "pin" || !pairing) break;
      const st = setup;
      if (!/^\d{4}$/.test(input)) { setup = { ...st, error: "The code is four digits", tries: st.tries + 1 }; break; }
      try {
        const creds = await pairing.finish(input);
        pairing = undefined;
        if (st.protocol === "companion") { companionCreds = creds; askPin(st.device, "airplay"); }
        else finish(st.device, companionCreds!, creds);
      } catch (e) {
        askPin(st.device, st.protocol, plain(e), st.tries + 1);
      }
      break;
    }
    case "pin:again": if (setup.phase === "pin") askPin(setup.device, setup.protocol, undefined, setup.tries); break;
    case "skip": if (setup.phase === "pin" && companionCreds) { pairing?.cancel(); pairing = undefined; finish(setup.device, companionCreds); } break;
    case "back": pairing?.cancel(); pairing = undefined; setup = { phase: "find", scanning: false }; break;
    case "remote": return { push: { extension: NAME, palette: "remote" } };
    case "apps": return { push: { extension: NAME, palette: "apps" } };
    case "bar": return { open: "pal://settings/bar" };
    case "forget": {
      const list = await paired(), dev = current(list);
      if (!dev) break;
      if (conn?.device.id === dev.id) await drop();
      await savePaired(list.filter((d) => d.id !== dev.id));
      await storage.set(`apps:${dev.id}`, null, NAME).catch(() => {});
      if (cfg().device?.trim().toLowerCase() === dev.name.toLowerCase()) await settings.set({ device: null }, NAME).catch(() => {});
      push();
      return { ...toast(`Forgot ${dev.name}`, "Remove pal on the TV too: Settings › Remotes and Devices"), view: renderSetup(setup, found, await paired(), typingAddress) };
    }
    default:
      if (action?.startsWith("pair:")) { const f = byId(action.slice(5)); if (f) { companionCreds = undefined; askPin(f, "companion"); } }
      else if (action?.startsWith("retry:") && setup.phase === "failed") {
        const p = action.slice(6) as PairProtocol;
        if (p === "airplay" && companionCreds) askPin(setup.device, "airplay"); else { companionCreds = undefined; askPin(setup.device, "companion"); }
      }
  }
  return { view: renderSetup(setup, found, await paired(), typingAddress) };
}

// ---- the list palettes ----------------------------------------------------------------------------

/** The current Apple TV for a listing, or the rows that stand in: the setup row unpaired. */
async function forList(): Promise<Paired | Item[]> {
  const dev = current(await paired());
  return dev ?? [SETUP_ROW];
}

async function listApps(ctx?: Ctx): Promise<Item[]> {
  const dev = await forList();
  if (Array.isArray(dev)) return dev;
  const rows = (apps: App[]) => {
    const dock = dockOf(apps), front = conn?.nowPlaying()?.app?.id;
    return apps.map((a) => appRow(a, artOf(a), { device: dev.name, front: a.id === front, dock: (() => { const i = dock.findIndex((d) => d.id === a.id); return i < 0 ? undefined : i; })() }));
  };
  const cached = appLists.get(dev.id) ?? ((await storage.get(`apps:${dev.id}`, NAME)) as App[] | null) ?? undefined;
  if (cached?.length) ctx?.partial?.(rows(cached));
  try { return rows(await appsOf(dev, true)); }
  catch (e) { return cached?.length ? rows(cached) : noTv(`${dev.name}: ${plain(e)}`); }
}

async function pickApp(id: string, action: string | undefined): Promise<Effect> {
  if (id === "setup") return { push: { extension: NAME, palette: "setup" } };
  if (id.startsWith("hint:")) { await drop(); return { keep: true }; }
  const dev = current(await paired());
  const app = (dev && appLists.get(dev.id)?.find((a) => a.id === id)) ?? { id, name: id };
  switch (action ?? "launch") {
    case "launch": return launch(app.id, app.name);
    case "launch:remote": { const e = await launch(app.id, app.name); return e.toast ? e : { push: { extension: NAME, palette: "remote" } }; }
    case "copy": return { copy: app.id };
    case "dock": {
      const favs = [...(cfg().favorites ?? [])];
      const apps = dev ? appLists.get(dev.id) ?? [] : [];
      // Turning the automatic dock into an explicit one starts from what it showed, so adding one app does not empty the rest.
      const base = favs.length ? favs : dockOf(apps).map((d) => d.name);
      const has = base.some((f) => f === app.id || f.toLowerCase() === app.name.toLowerCase());
      const next = has ? base.filter((f) => f !== app.id && f.toLowerCase() !== app.name.toLowerCase()) : [...base, app.name].slice(0, DOCK_WIDE);
      await settings.set({ favorites: next }, NAME);
      return toast(has ? `${app.name} left the dock` : `${app.name} is in the dock`, has ? undefined : `Digit ${next.length} on the remote`);
    }
  }
  return { keep: true };
}

async function pickCommand(id: string, action: string | undefined, ctx?: Ctx): Promise<Effect> {
  if (id === "setup" || action === "setup") return { push: { extension: NAME, palette: "setup" } };
  if (id.startsWith("hint:")) return { keep: true };
  if (id === "users") return { push: { extension: NAME, palette: "users" } };
  // The Now row (`suggest`): Enter opens the remote, cmd+Enter pauses.
  if (id === "now") return action === "play-pause" ? (await act("play-pause")) ?? { hud: "Paused" } : { push: { extension: NAME, palette: "remote" } };
  if (id.startsWith("device:")) { await settings.set({ device: id.slice(7) }, NAME); await drop(); return { hud: `Apple TV: ${id.slice(7)}` }; }
  if (id === "type") {
    const text = String(ctx?.values?.text ?? "");
    const e = await withConn("type", async (c) => {
      if (!c.keyboard().focused) throw new Error("Open a search or a text field on the TV first");
      await (action === "type:append" ? c.appendText(text) : c.setText(text));
    });
    return e ?? { hud: `Typed “${text}”` };
  }
  const e = await act(id, ctx);
  if (e && !e.keep) return e;
  if (e?.toast) return e;
  const dev = current(await paired());
  return { hud: `${dev?.name ?? "Apple TV"}: ${commandRows("", []).find((r) => r.id === id)?.name ?? id}` };
}

// ---- links ----------------------------------------------------------------------------------------------

async function link(route: string, params: LinkParams): Promise<Effect | void> {
  const str = (k: string) => String(params[k] ?? "").trim();
  const fail = (e?: Effect) => { if (e?.toast?.style === "failure") throw new Error(e.toast.message ?? e.toast.title); };
  switch (route) {
    case "key": {
      const name = str("name").toLowerCase().replace(/[\s-]+/g, "_");
      const press = (str("press") || "tap") as Press;
      const c = await ensure();
      await c.key(name as Key, press);
      return { hud: `Apple TV: ${name}${press !== "tap" ? ` (${press})` : ""}` };
    }
    case "launch": {
      const want = str("app").toLowerCase();
      const dev = current(await paired());
      if (!dev) throw new Error("no Apple TV paired");
      const apps = await appsOf(dev);
      const app = apps.find((a) => a.id.toLowerCase() === want || a.name.toLowerCase() === want) ?? apps.find((a) => a.name.toLowerCase().startsWith(want));
      if (!app && !/^[a-z][\w+.-]*:/.test(want)) throw new Error(`no app "${params.app}" on ${dev.name}`);
      const e = await launch(app?.id ?? str("app"), app?.name ?? str("app"));
      fail(e);
      return { hud: e.hud };
    }
    case "power": {
      const to = str("to") || "toggle";
      const c = await ensure();
      const on = to === "on" || (to === "toggle" && c.power() === "off");
      await (on ? c.turnOn() : c.turnOff());
      return { hud: `Apple TV: ${on ? "waking up" : "going to sleep"}` };
    }
    case "type": {
      const c = await ensure();
      if (!c.keyboard().focused) throw new Error("no text field is open on the TV");
      await (params.append ? c.appendText(str("text")) : c.setText(str("text")));
      return { hud: `Typed “${str("text")}”` };
    }
    case "media": {
      const cmd = str("command").replace(/-/g, "_") as MediaCommand;
      if (cmd === ("play_pause" as MediaCommand)) { await (await ensure()).key("play_pause"); return { hud: "Apple TV: play or pause" }; }
      await (await ensure()).media(cmd, params.value !== undefined ? Number(params.value) : undefined);
      return { hud: `Apple TV: ${cmd.replace(/_/g, " ")}` };
    }
    case "volume": {
      const c = await ensure();
      const level = str("level");
      if (level === "up" || level === "down") { await c.key(level === "up" ? "volume_up" : "volume_down"); return { hud: `Apple TV: volume ${level}` }; }
      const n = Number(level);
      if (Number.isNaN(n)) throw new Error("level is up, down or 0 to 100");
      await c.setVolume(Math.min(100, Math.max(0, n)) / 100);
      return { hud: `Apple TV: volume ${Math.round(n)}%` };
    }
  }
}

// ---- the extension ---------------------------------------------------------------------------------------

export default {
  palettes: {
    remote: {
      title: "Apple TV Remote",
      view: async (ctx) => {
        const layout: Layout = ctx?.compact ? "compact" : "wide";
        if (!connecting && !conn && (await paired()).length) await Promise.race([ensure().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
        return renderRemote(await remoteState(layout));
      },
      pick: (_id, action, ctx) => remotePick(action, ctx, ctx?.compact ? "compact" : "wide"),
    },
    apps: {
      title: "Apple TV Apps",
      placeholder: "Search the Apple TV's apps",
      list: (_q, ctx) => listApps(ctx),
      pick: (id, action) => pickApp(id, action),
    },
    commands: {
      title: "Apple TV",
      list: async () => {
        const list = await paired();
        const dev = current(list);
        return dev ? commandRows(dev.name, list.filter((d) => d.id !== dev.id).map((d) => d.name)) : [SETUP_ROW];
      },
      pick: (id, action, ctx) => pickCommand(id, action, ctx),
      suggest: async () => {
        const n = conn?.nowPlaying();
        if (!n?.title || n.state !== "playing") return [];
        const dev = conn!.device, t = titles(n, n.app?.name);
        return [{ id: "now", name: t.title, subtitle: `${[t.sub, n.app?.name].filter(Boolean).join(" · ")} on ${dev.name}`, icon: coverArt?.data ? { image: coverArt.data } : G.tv, section: "Apple TV", actions: [{ id: "remote", title: "Open the remote" }, { id: "play-pause", title: "Pause", shortcut: "cmd+enter" }] }];
      },
    },
    users: {
      title: "Apple TV Users",
      list: async () => {
        const dev = await forList();
        if (Array.isArray(dev)) return dev;
        try { return (await (await ensure()).accounts()).map((a) => accountRow(a, dev.name)); }
        catch (e) { return noTv(`${dev.name}: ${plain(e)}`); }
      },
      pick: async (id, action) => {
        if (id === "setup") return { push: { extension: NAME, palette: "setup" } };
        if (id.startsWith("hint:") || action !== "switch") return { keep: true };
        const e = await withConn("switch the user", (c) => c.switchAccount(id));
        return e ?? { keep: true, hud: "Switched" };
      },
    },
    setup: {
      title: "Set Up Apple TV",
      view: setupView,
      pick: (_id, action, ctx) => setupPick(action, ctx),
    },
  },
  bar: {
    playing: {
      render: async (ctx) => {
        barCfg = { ...barCfg, ...(ctx.settings as Partial<BarSettings>) };
        if (cfg().stay && (await paired()).length && !conn && !connecting) void ensure().catch(() => {});
        return barItem();
      },
      onAction: async (action, ctx) => remotePick(action, ctx, "compact"),
      onShown: (ctx) => { barCfg = { ...barCfg, ...(ctx.settings as Partial<BarSettings>) }; return ensure().then(() => {}).catch(() => {}); },
    },
  },
  link,
  dispose: () => {
    for (const t of [idleTimer, flashTimer, pushTimer]) if (t) clearTimeout(t);
    if (tick) clearInterval(tick);
    pairing?.cancel();
    void drop();
  },
} satisfies Extension;

// The device setting moves the connection.
let lastDevice = "";
settings.onChange(() => {
  const want = cfg().device ?? "";
  if (want !== lastDevice) { lastDevice = want; if (conn && current(devices ?? [])?.id !== conn.device.id) void drop().then(() => ensure()).catch(() => {}); }
  push();
}, NAME);
