// Apple TV: a remote under the keys, Now Playing in full, links played on
// the TV in one key, its apps at the root, typing into the TV, what plays
// on the bar, and a guided pairing. The connection, the apps and the
// redraw loop are shared (tv.ts); this module is the remote (a pressed key
// lights its part of the clickpad for 160 ms), the bar item, the list
// palettes and the links; now.ts is Now Playing, play.ts the links, and
// pairing.ts the setup.
import { controls, settings, toast, type BarCtx, type BarItem, type Ctx, type Effect, type Extension, type Item, type LinkParams } from "@zcag/pal";
import { DOCK_WIDE, G, positionAt, render as renderRemote, titles, type DockApp, type Flash, type Layout, type RemoteState } from "./remote.ts";
import { SETUP_ROW, accountRow, appRow, commandRows, noTv } from "./rows.ts";
import { cancelPairing, setupPick, setupView } from "./pairing.ts";
import { disposeNow, nowPick, nowState } from "./now.ts";
import { render as renderNow } from "./nowplaying.ts";
import { OFFER_BAR_MS, disposePlay, dismissOffer, linkPlay, listPlay, offer, offerFresh, offerTitle, pickPlay, playLink, suggestPlay, watchClipboard } from "./play.ts";
import { LINK_APPS } from "./links.ts";
import {
  appLists, appsOf, artOf, cfg, coverArt, current, disposeTv, drop, ensure, frontApp, launch, launches, mute, muteFrom, onOpen, paired, plain, publishControls, push, readServed, registerBar, registerView,
  served, stripArtOf, tv, warm, wideArtOf, withConn, NAME, type BarSettings, type Level,
} from "./tv.ts";
import type { App, Key, MediaCommand, Press, Swipe } from "./types.ts";

let barCfg: BarSettings = { when: "playing", artwork: false };

// ---- the remote ----------------------------------------------------------------------------------------

let typing = false;
let flash: Flash | undefined;
let swipe: Swipe | undefined;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
const FLASH_MS = 160;

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
  return picked.slice(0, DOCK_WIDE).map((a) => ({ id: a.id, name: a.name, art: artOf(a), wide: wideArtOf(a) }));
}

/** The remote's whole state for a layout, from what the connection last said. */
async function remoteState(layout: Layout): Promise<RemoteState> {
  const list = await paired();
  const dev = current(list);
  const base: RemoteState = { layout, conn: tv.state, error: tv.error, power: "unknown", dock: [], skip: cfg().skip || 10, mrp: false };
  if (!dev) return { ...base, unpaired: true };
  base.device = { name: dev.name, modelName: dev.modelName };
  base.others = list.length - 1;
  base.noAirplay = !dev.airplay;
  if (offer) base.offer = { title: offerTitle()!, by: offer.info?.by, thumb: offer.thumb, app: LINK_APPS[offer.link.kind].name };
  const c = tv.conn;
  if (!c) return base;
  const now = c.nowPlaying(), front = frontApp();
  return {
    ...base,
    power: c.power(), now, position: positionAt(now, Date.now()),
    art: coverArt.data,
    app: front ? { ...front, art: artOf(front) } : undefined,
    volume: c.volume(), keyboard: c.keyboard(), typing,
    dock: dockOf(appLists.get(dev.id) ?? []),
    flash, swipe, mrp: c.mrpUp,
    served: { ...served },
  };
}

/** Light a part of the pad for a moment. */
function lightUp(f: Flash | undefined, s?: Swipe): void {
  flash = f; swipe = s;
  push();
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = undefined; swipe = undefined; push(); }, FLASH_MS);
}

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
  // The volume and power parts (`controls:*`, pal's): the Apple TV's own the way its keys go, else on whoever the group serves them from.
  if (action.startsWith("controls:")) return controlAct(action, ctx);
  if (action === "volume-up" || action === "volume-down") return step(action === "volume-up" ? 1 : -1);
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
    case "power": return power();
    case "wake": return withConn("wake it", (c) => c.turnOn());
    case "sleep": return withConn("put it to sleep", (c) => c.turnOff());
    case "seek": {
      const n = tv.conn?.nowPlaying(), f = Number(values?.value);
      if (!n?.duration || Number.isNaN(f)) return { keep: true };
      return withConn("seek", (c) => c.media("seek", Math.round(f * n.duration!)));
    }
    case "type": {
      const c = await ensure().catch(() => undefined);
      if (!c) return toast("Not connected", tv.error ?? "The Apple TV did not answer", "failure");
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
    case "now": return { push: { extension: NAME, palette: "now" } };
    case "play-link": return offer ? playLink(offer.link) : { push: { extension: NAME, palette: "play" } };
    case "offer:dismiss": dismissOffer(); return undefined;
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
      const n = tv.conn?.nowPlaying();
      if (!n?.title) return toast("Nothing playing", undefined, "failure");
      const t = titles(n, frontApp()?.name);
      return { copy: [t.title, t.sub].filter(Boolean).join(" · ") };
    }
  }
  return { keep: true };
}

// ---- the controls a group can serve from another device (docs/design/controls.md) ----------------------------

/** Who serves it, as a HUD says: "75\" Neo QLED: volume up". */
const by = (v: { provider: { device?: string } } | null | undefined) => v?.provider.device ?? "Apple TV";

/** Volume up or down: the Apple TV's key (it reaches the TV over HDMI), or the group's volume server. */
async function step(dir: 1 | -1): Promise<Effect | undefined> {
  lightUp(dir > 0 ? "vol+" : "vol-");
  const v = served.volume;
  if (v === undefined) return withConn("press the key", (c) => c.key(dir > 0 ? "volume_up" : "volume_down", "tap"));
  if (!v) return toast("Nothing serves the volume", "The group's volume device is not running", "failure");
  return served_(() => controls.run("volume", "step", dir), `${by(v)}: volume ${dir > 0 ? "up" : "down"}`);
}

/** Wake (`true`), sleep (`false`) or switch (unset, as it is now): the Apple TV alone, or every member of its group. */
async function power(on?: boolean): Promise<Effect | undefined> {
  lightUp("power");
  if (served.power === undefined) return withConn("switch it", (c) => ((on ?? c.power() === "off") ? c.turnOn() : c.turnOff()));
  const wake = on ?? served.power?.on === false;
  const names = served.power?.members?.map((m) => m.device ?? m.key).join(" and ");
  return served_(() => controls.run("power", "set", wake), `${names ?? by(served.power)}: ${wake ? "waking up" : "going to sleep"}`);
}

/** A control run on another device: a HUD naming it (none for a slider, which shows its own level), kept in the view; its error as a toast. */
async function served_(f: () => Promise<unknown>, hud?: string): Promise<Effect | undefined> {
  try { await f(); return hud ? { hud, keep: true } : { keep: true }; } catch (e) { return toast("It did not go", plain(e), "failure"); }
}

/** A click on one of pal's parts: the Apple TV's own where it serves them, else pal runs it on the group's device. */
async function controlAct(action: string, ctx?: Ctx | BarCtx): Promise<Effect | undefined> {
  const [, control, op, arg] = action.split(":");
  const values = (ctx as Ctx | undefined)?.values;
  if (control === "volume" && op === "step") return step(Number(arg) < 0 ? -1 : 1);
  if (control === "power" && op === "set") return power(arg === undefined ? undefined : arg === "true");
  if (control === "volume" && served.volume === undefined) {
    if (op === "set") { const f = Number(values?.value); return Number.isNaN(f) ? { keep: true } : withConn("set the volume", (c) => c.setVolume(Math.min(1, Math.max(0, f)))); }
    if (op === "mute") return withConn("mute", () => mute(arg === undefined ? muteFrom === undefined : arg === "true"));
  }
  const v = control === "volume" ? served.volume : control === "inputs" ? served.inputs : undefined;
  return served_(() => controls.act(action, { values: values as Record<string, string> | undefined }), control === "volume" && op === "set" ? undefined : `${by(v)}: ${control === "inputs" ? "switching input" : op === "mute" ? "mute" : "volume"}`);
}

/** A remote action from the panel view or the popover: done means a new tree in place. */
async function remotePick(action: string | undefined, ctx: Ctx | BarCtx | undefined, layout: Layout): Promise<Effect> {
  const e = await act(action ?? "select", ctx);
  const v = renderRemote(await remoteState(layout));
  if (!e) return { view: v };
  // A HUD with `keep` (a launch, a link played) stays in the view; a push, a copy or a bare HUD go out.
  if (e.hud && e.keep) return { ...e, view: v };
  return e.push || e.copy || e.hud ? e : { ...e, view: v };
}

registerView("remote", async (l) => renderRemote(await remoteState(l.compact ? "compact" : "wide")));
registerView("bar:playing", async () => renderRemote(await remoteState("compact")));
onOpen((l: Level) => {
  if (l.palette !== "remote" || !cfg().wake) return;
  const self = () => ensure().then((c) => (c.power() === "off" ? c.turnOn() : undefined));
  // In a group, waking means every member: the TV with the Apple TV.
  void readServed().then(() => (served.power?.members?.length ? controls.run("power", "set", true).catch(self) : self())).catch(() => {});
});

// ---- the bar item ---------------------------------------------------------------------------------------

async function barItem(): Promise<BarItem> {
  const dev = current(await paired());
  if (!dev) return { hidden: true };
  const menu = { view: renderRemote(await remoteState("compact")) };
  // A link just copied: the item comes up to offer it, whatever plays.
  if (offer && offerFresh(OFFER_BAR_MS)) {
    const t = offerTitle()!;
    return { icon: G.play, title: `Play on TV: ${t.length > 36 ? `${t.slice(0, 35)}…` : t}`, color: "accent", tooltip: `${t} (copied): l in the popover plays it on ${dev.name}`, menu };
  }
  if (!tv.conn) return { hidden: true, empty: { icon: G.tv, tooltip: tv.error ? `${dev.name}: ${tv.error}` : `${dev.name}: not connected`, menu } };
  const n = tv.conn.nowPlaying(), power = tv.conn.power();
  const loaded = n && n.state !== "idle" && n.state !== "stopped" && !!(n.title || n.series);
  const app = frontApp();
  // The strip's renderers draw a raster only: the app's icon as a rounded PNG when asked for, else the TV mark.
  const pic = barCfg.artwork && app ? stripArtOf(app) : undefined;
  const icon = pic ? { image: pic } : G.tv;
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
registerBar(barItem);

// ---- the list palettes ----------------------------------------------------------------------------------

async function listApps(ctx?: Ctx): Promise<Item[]> {
  const dev = current(await paired());
  if (!dev) return [SETUP_ROW];
  const rows = (apps: App[]) => {
    const dock = dockOf(apps), front = tv.conn?.nowPlaying()?.app?.id;
    return apps.map((a) => appRow(a, artOf(a), { device: dev.name, front: a.id === front, dock: (() => { const i = dock.findIndex((d) => d.id === a.id); return i < 0 ? undefined : i; })() }));
  };
  const cached = appLists.get(dev.id);
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
  if (id === "now-playing") return { push: { extension: NAME, palette: "now" } };
  if (id === "play-link") return { push: { extension: NAME, palette: "play" } };
  // The Now row (`suggest`): Enter opens Now Playing, cmd+Enter pauses.
  if (id === "now") return action === "play-pause" ? (await act("play-pause")) ?? { hud: "Paused" } : { push: { extension: NAME, palette: "now" } };
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

// ---- links -------------------------------------------------------------------------------------------------

async function link(route: string, params: LinkParams): Promise<Effect | void> {
  const str = (k: string) => String(params[k] ?? "").trim();
  const fail = (e?: Effect) => { if (e?.toast?.style === "failure") throw new Error(e.toast.message ?? e.toast.title); };
  switch (route) {
    case "key": {
      const name = str("name").toLowerCase().replace(/[\s-]+/g, "_");
      const press = (str("press") || "tap") as Press;
      await (await ensure()).key(name as Key, press);
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
      await readServed();
      const e = await power(to === "on" ? true : to === "off" ? false : undefined);
      fail(e);
      return { hud: e?.hud ?? `Apple TV: ${to === "off" ? "going to sleep" : to === "on" ? "waking up" : "power"}` };
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
      const level = str("level");
      await readServed();
      if (level === "up" || level === "down") { const e = await step(level === "up" ? 1 : -1); fail(e); return { hud: e?.hud ?? `Apple TV: volume ${level}` }; }
      const n = Number(level);
      if (Number.isNaN(n)) throw new Error("level is up, down or 0 to 100");
      const to = Math.min(100, Math.max(0, n)) / 100;
      if (served.volume === undefined) await (await ensure()).setVolume(to);
      else if (!served.volume) throw new Error("the group's volume device is not running");
      else await controls.run("volume", "set", to);
      return { hud: `${served.volume?.provider.device ?? "Apple TV"}: volume ${Math.round(n)}%` };
    }
    case "play": return linkPlay(str("url") || undefined);
  }
}

/** A link at the root: a url the TV plays, anywhere in the query. */
const PLAYABLE = /https?:\/\/\S*(youtu\.?be|netflix\.com\/(title|watch)|tv\.apple\.com)/i;

// ---- the extension ------------------------------------------------------------------------------------------

export default {
  palettes: {
    remote: {
      title: "Apple TV Remote",
      view: async (ctx) => { await warm(); return renderRemote(await remoteState(ctx?.compact ? "compact" : "wide")); },
      pick: (_id, action, ctx) => remotePick(action, ctx, ctx?.compact ? "compact" : "wide"),
    },
    now: {
      title: "Now Playing on Apple TV",
      view: async (ctx) => { await warm(); return renderNow(await nowState(ctx?.compact ? "compact" : "wide")); },
      pick: (_id, action, ctx) => nowPick(action, ctx, ctx?.compact ? "compact" : "wide"),
    },
    play: {
      title: "Play on Apple TV",
      input: true,
      placeholder: "Paste a YouTube or Netflix link, or an Apple TV+ page",
      inline: true,
      match: PLAYABLE,
      list: (q, ctx) => listPlay(q ?? "", ctx),
      pick: (id, action) => pickPlay(id, action),
      suggest: () => suggestPlay(),
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
        const n = tv.conn?.nowPlaying();
        if (!n?.title || n.state !== "playing") return [];
        const dev = tv.conn!.device, t = titles(n, frontApp()?.name);
        return [{ id: "now", name: t.title, subtitle: `${[t.sub, frontApp()?.name].filter(Boolean).join(" · ")} on ${dev.name}`, icon: coverArt.data ? { image: coverArt.data } : G.tv, section: "Apple TV", actions: [{ id: "now", title: "Now Playing" }, { id: "play-pause", title: "Pause", shortcut: "cmd+enter" }] }];
      },
    },
    users: {
      title: "Apple TV Users",
      list: async () => {
        const dev = current(await paired());
        if (!dev) return [SETUP_ROW];
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
        if (cfg().stay && (await paired()).length && !tv.conn) void ensure().catch(() => {});
        return barItem();
      },
      onAction: async (action, ctx) => remotePick(action, ctx, "compact"),
      onShown: (ctx) => { barCfg = { ...barCfg, ...(ctx.settings as Partial<BarSettings>) }; return ensure().then(() => {}).catch(() => {}); },
    },
  },
  link,
  // What a group can drive here from another device's view (docs/design/controls.md); each runs on this Apple TV.
  controls: {
    volume: {
      set: (level: number) => ensure().then((c) => c.setVolume(level)),
      step: (dir: 1 | -1) => ensure().then((c) => c.key(dir > 0 ? "volume_up" : "volume_down", "tap")),
      mute: (on: boolean) => mute(on),
    },
    power: { set: (on: boolean) => ensure().then((c) => (on ? (c.power() === "off" ? c.turnOn() : undefined) : c.power() !== "off" ? c.turnOff() : undefined)) },
    player: {
      play_pause: () => ensure().then((c) => c.key("play_pause", "tap")),
      next: () => ensure().then((c) => c.media("next")),
      previous: () => ensure().then((c) => c.media("previous")),
      seek: (seconds: number) => ensure().then((c) => c.media("seek", Math.round(seconds))),
    },
  },
  dispose: () => {
    if (flashTimer) clearTimeout(flashTimer);
    cancelPairing();
    disposeNow();
    disposePlay();
    disposeTv();
  },
} satisfies Extension;

void watchClipboard();
// Paired is enough to be woken by a group: power is published from the start, not on the first redraw.
void paired().then(() => publishControls()).catch(() => {});
