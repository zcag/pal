// Samsung TV: a remote under the keys, the TV's apps at the root, its
// inputs and volume a key away, typing into its keyboard, what is on in
// the bar, and a guided pairing (press Allow on the TV). The connection,
// the apps, the controls and the redraw loop are shared (tv.ts); this
// module is the remote (a pressed key lights its part of the pad for
// 160 ms), the controls the TV provides (its volume, power, inputs and
// what is on, which a group may hand to another device's remote), the
// bar item, the list palettes and the links; pairing.ts is the setup.
import { controls, settings, toast, type BarCtx, type BarItem, type Ctx, type Effect, type Extension, type Item, type LinkParams } from "@zcag/pal";
import { DOCK_WIDE, G, positionAt, render as renderRemote, type DockApp, type Flash, type Layout, type RemoteState } from "./remote.ts";
import { SETUP_ROW, appRow, commandRows, noTv } from "./rows.ts";
import { cancelPairing, setupPick, setupView } from "./pairing.ts";
import {
  appLists, appsOf, artOf, cfg, current, disposeTv, drop, ensure, frontApp, launch, launches, onOpen, paired, plain, push, registerBar, registerView,
  served, tv, turnOn, warm, withConn, NAME, type BarSettings, type Level,
} from "./tv.ts";
import type { App, Input, Key, Press } from "./types.ts";

let barCfg: BarSettings = { when: "on" };

// ---- the remote ----------------------------------------------------------------------------------------

/** Escape on the field: it stays down until the TV's keyboard closes and opens again. */
let dismissed = false;
let flash: Flash | undefined;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
const FLASH_MS = 160;

/** Apps a TV usually has, in the order a dock would want them when nothing else says. */
const LIKELY = ["YouTube", "Netflix", "Prime Video", "Disney+", "Spotify", "Apple TV", "Max", "Plex", "Twitch"];

/** The dock: the favourites setting in its order (names or ids), else the apps opened most, else the likely ones, else the TV's first. */
function dockOf(apps: App[]): DockApp[] {
  const favs = cfg().favorites ?? [];
  const find = (k: string) => apps.find((a) => a.id === k || a.name.toLowerCase() === k.trim().toLowerCase());
  let picked: App[] = favs.map(find).filter((a): a is App => !!a);
  if (!picked.length) {
    const used = Object.entries(launches ?? {}).sort((a, b) => b[1] - a[1]).map(([id]) => apps.find((a) => a.id === id)).filter((a): a is App => !!a);
    picked = [...new Map([...used, ...LIKELY.map(find).filter((a): a is App => !!a), ...apps].map((a) => [a.id, a])).values()];
  }
  const front = frontApp()?.id;
  return picked.slice(0, DOCK_WIDE).map((a) => ({ id: a.id, name: a.name, art: artOf(a), front: a.id === front }));
}

/** The remote's whole state for a layout, from what the connection last said and what is served to it. */
async function remoteState(layout: Layout): Promise<RemoteState> {
  const list = await paired();
  const dev = current(list);
  const base: RemoteState = { layout, conn: tv.state, error: tv.error, power: "unknown", dock: [] };
  if (!dev) return { ...base, unpaired: true };
  base.device = { name: dev.name, model: dev.model };
  base.others = list.length - 1;
  base.wakeable = !!dev.mac;
  const c = tv.conn;
  if (!c) return base;
  const front = frontApp(), media = c.media();
  if (!c.keyboard().open) dismissed = false;
  return {
    ...base,
    power: c.power(),
    front: front ? { ...front, art: artOf(front) } : undefined,
    media, position: positionAt(media, Date.now()),
    volume: served.volume, powerSlot: served.power, inputs: served.inputs,
    keyboard: c.keyboard(), typing: c.keyboard().open && !dismissed,
    dock: dockOf(appLists.get(dev.id) ?? []),
    flash,
  };
}

/** Light a part of the pad for a moment. */
function lightUp(f: Flash | undefined): void {
  flash = f;
  push();
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash = undefined; push(); }, FLASH_MS);
}

const KEYS: Record<string, [Key, Flash?]> = {
  up: ["up", "up"], down: ["down", "down"], left: ["left", "left"], right: ["right", "right"], select: ["select", "select"],
  back: ["back", "back"], home: ["home", "home"], "play-pause": ["play_pause", "play"], rewind: ["rewind", "rewind"], forward: ["forward", "forward"],
  previous: ["previous"], next: ["next"], "channel-up": ["channel_up"], "channel-down": ["channel_down"], menu: ["menu"], guide: ["guide"], info: ["info"], exit: ["exit"],
};

/** One action of the remote, from a key, a click, the bar popover or a root row; `undefined` means it was done and the view redraws. */
async function act(action: string, ctx?: Ctx | BarCtx): Promise<Effect | undefined> {
  const values = (ctx as Ctx | undefined)?.values;
  if (KEYS[action]) {
    const [key, f] = KEYS[action];
    if (f) lightUp(f);
    return withConn("press the key", (c) => c.key(key));
  }
  if (action.startsWith("controls:")) {
    if (action.startsWith("controls:power")) lightUp("power");
    try { await controls.act(action, { values: values as Record<string, string> | undefined }); return undefined; } catch (e) { return toast("Could not do that", plain(e), "failure"); }
  }
  if (action.startsWith("launch:")) {
    const dev = current(await paired());
    const app = dev ? dockOf(appLists.get(dev.id) ?? [])[Number(action.slice(7))] : undefined;
    return app ? launch(app.id, app.name) : { keep: true };
  }
  switch (action) {
    // KEY_HDMI: the TV moves to its next HDMI input itself.
    case "input:next": return withConn("switch the input", (c) => c.setInput("hdmi"));
    case "wake": try { await turnOn(); return undefined; } catch (e) { return toast("Could not turn it on", plain(e), "failure"); }
    case "type": dismissed = false; return undefined;
    case "type:send": {
      const text = String(values?.input ?? "");
      const e = await withConn("type", (c) => c.type(text, true));
      return e ?? { hud: text ? `Typed “${text.length > 40 ? `${text.slice(0, 39)}…` : text}”` : "Sent", keep: true };
    }
    case "type:cancel": dismissed = true; return undefined;
    case "apps": return { push: { extension: NAME, palette: "apps" } };
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
  }
  return { keep: true };
}

/** A remote action from the panel view or the popover: done means a new tree in place. */
async function remotePick(action: string | undefined, ctx: Ctx | BarCtx | undefined, layout: Layout): Promise<Effect> {
  const e = await act(action ?? "select", ctx);
  const v = renderRemote(await remoteState(layout));
  if (!e) return { view: v };
  if (e.hud && e.keep) return { ...e, view: v };
  return e.push || e.copy || e.hud ? e : { ...e, view: v };
}

registerView("remote", async (l) => renderRemote(await remoteState(l.compact ? "compact" : "wide")));
registerView("bar:tv", async () => renderRemote(await remoteState("compact")));
onOpen((l: Level) => {
  if (l.palette === "remote" && cfg().wake) void ensure().then((c) => (c.power() !== "on" ? turnOn() : undefined)).catch(() => {});
});

// ---- the controls it provides ------------------------------------------------------------------------------

/** The ops of the TV's controls (docs/design/controls.md): what a group's other device, or this remote, runs on it. */
const handlers: Extension["controls"] = {
  volume: {
    set: async (level: number) => { await (await ensure()).setVolume(Math.round(level * 100)); },
    step: async (d: 1 | -1) => { await (await ensure()).key(d > 0 ? "volume_up" : "volume_down"); },
    mute: async (on: boolean) => { await (await ensure()).setMuted(on); },
  },
  power: { set: async (on: boolean) => { if (on) await turnOn(); else await (await ensure()).turnOff(); } },
  inputs: { set: async (id: string) => { await (await ensure()).setInput(id as Input["id"]); } },
  player: {
    play_pause: async () => { await (await ensure()).key("play_pause"); },
    next: async () => { await (await ensure()).key("next"); },
    previous: async () => { await (await ensure()).key("previous"); },
    seek: async () => { throw new Error("The TV does not seek from here; its own remote's arrows do"); },
  },
};

// ---- the bar item ---------------------------------------------------------------------------------------

async function barItem(): Promise<BarItem> {
  const dev = current(await paired());
  if (!dev) return { hidden: true };
  const menu = { view: renderRemote(await remoteState("compact")) };
  if (!tv.conn) return { hidden: true, empty: { icon: G.tv, tooltip: tv.error ? `${dev.name}: ${tv.error}` : `${dev.name}: not connected`, menu } };
  const power = tv.conn.power();
  if (power !== "on") return { hidden: true, empty: { icon: G.tv, tooltip: `${dev.name} is in standby`, menu } };
  const app = frontApp(), media = tv.conn.media();
  if (!app && !media && barCfg.when === "app") return { hidden: true, empty: { icon: G.tv, tooltip: `${dev.name}: no app in front`, menu } };
  const title = media?.title ?? app?.name ?? dev.name;
  return {
    icon: G.tv,
    title: title.length > 48 ? `${title.slice(0, 47)}…` : title,
    color: media?.state === "paused" ? "muted" : undefined,
    tooltip: media ? `${title} on ${dev.name}${media.state === "paused" ? ", paused" : ""}` : app ? `${app.name} on ${dev.name}` : `${dev.name} is on`,
    states: { power, app: app?.name ?? null },
    menu,
  };
}
registerBar(barItem);

// ---- the list palettes ----------------------------------------------------------------------------------

async function listApps(ctx?: Ctx): Promise<Item[]> {
  const dev = current(await paired());
  if (!dev) return [SETUP_ROW];
  const rows = (apps: App[]) => {
    const dock = dockOf(apps), front = frontApp()?.id;
    return apps.map((a) => appRow(a, artOf(a), { device: dev.name, front: a.id === front, dock: (() => { const i = dock.findIndex((d) => d.id === a.id); return i < 0 ? undefined : i; })() }));
  };
  const cached = appLists.get(dev.id) ?? ((await appsOf(dev).catch(() => undefined)) || undefined);
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
    case "quit": return (await withConn(`close ${app.name}`, (c) => c.quit(app.id))) ?? { hud: `Closed ${app.name}`, keep: true };
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

/** The root rows' ids that are the remote's own actions. */
const ROW_ACTION: Record<string, string> = {
  home: "home", "play-pause": "play-pause", menu: "menu", guide: "guide",
  "volume-up": "controls:volume:step:1", "volume-down": "controls:volume:step:-1", mute: "controls:volume:mute",
};

async function pickCommand(id: string, action: string | undefined, ctx?: Ctx): Promise<Effect> {
  if (id === "setup" || action === "setup") return { push: { extension: NAME, palette: "setup" } };
  if (id.startsWith("hint:")) return { keep: true };
  const dev = current(await paired());
  const name = dev?.name ?? "Samsung TV";
  if (id.startsWith("device:")) { await settings.set({ device: id.slice(7) }, NAME); await drop(); return { hud: `Samsung TV: ${id.slice(7)}` }; }
  if (id === "wake" || id === "standby") {
    try { await controls.run("power", "set", id === "wake"); } catch (e) { return toast(`Could not turn ${id === "wake" ? "it on" : "it off"}`, plain(e), "failure"); }
    return { hud: `${name}: ${id === "wake" ? "turning on" : "turning off"}` };
  }
  if (id.startsWith("input:")) {
    const e = await withConn("switch the input", (c) => c.setInput(id.slice(6) as Input["id"]));
    return e ?? { hud: `${name}: ${id === "input:source" ? "the input menu" : id === "input:hdmi" ? "next HDMI input" : id.slice(6).toUpperCase()}` };
  }
  const e = await act(ROW_ACTION[id] ?? id, ctx);
  if (e?.toast) return e;
  return { hud: `${name}: ${commandRows("", [], []).find((r) => r.id === id)?.name ?? id}` };
}

// ---- links -------------------------------------------------------------------------------------------------

async function link(route: string, params: LinkParams): Promise<Effect | void> {
  const str = (k: string) => String(params[k] ?? "").trim();
  switch (route) {
    case "key": {
      const name = str("name").toLowerCase().replace(/[\s-]+/g, "_");
      const press = (str("press") || "tap") as Press;
      const c = await ensure();
      await (/^key_/i.test(name) ? c.rawKey(name.toUpperCase(), press) : c.key(name as Key, press));
      return { hud: `Samsung TV: ${name}${press !== "tap" ? ` (${press})` : ""}` };
    }
    case "launch": {
      const want = str("app").toLowerCase();
      const dev = current(await paired());
      if (!dev) throw new Error("no Samsung TV paired");
      const apps = await appsOf(dev);
      const app = apps.find((a) => a.id.toLowerCase() === want || a.name.toLowerCase() === want) ?? apps.find((a) => a.name.toLowerCase().startsWith(want));
      if (!app) throw new Error(`no app "${params.app}" on ${dev.name}`);
      const e = await launch(app.id, app.name);
      if (e.toast?.style === "failure") throw new Error(e.toast.message ?? e.toast.title);
      return { hud: e.hud };
    }
    case "power": {
      const to = str("to") || "toggle";
      const on = to === "on" || (to === "toggle" && tv.conn?.power() !== "on");
      await (on ? turnOn() : (await ensure()).turnOff());
      return { hud: `Samsung TV: ${on ? "turning on" : "turning off"}` };
    }
    case "volume": {
      const c = await ensure();
      const level = str("level");
      if (level === "up" || level === "down") { await c.key(level === "up" ? "volume_up" : "volume_down"); return { hud: `Samsung TV: volume ${level}` }; }
      if (level === "mute" || level === "unmute") { await c.setMuted(level === "mute"); return { hud: `Samsung TV: ${level}d` }; }
      const n = Number(level);
      if (Number.isNaN(n)) throw new Error("level is up, down, mute, unmute or 0 to 100");
      await c.setVolume(Math.min(100, Math.max(0, Math.round(n))));
      return { hud: `Samsung TV: volume ${Math.round(n)}` };
    }
    case "input": {
      const id = (str("to") || "hdmi").toLowerCase() as Input["id"];
      if (!["hdmi", "source", "tv"].includes(id)) throw new Error("to is hdmi (the next HDMI input), source (the input menu) or tv");
      await (await ensure()).setInput(id);
      return { hud: `Samsung TV: ${id}` };
    }
    case "type": {
      const c = await ensure();
      if (!c.keyboard().open) throw new Error("no text field is open on the TV");
      await c.type(str("text"), true);
      return { hud: `Typed “${str("text")}”` };
    }
  }
}

// ---- the extension ------------------------------------------------------------------------------------------

export default {
  palettes: {
    remote: {
      title: "Samsung TV Remote",
      view: async (ctx) => { await warm(); return renderRemote(await remoteState(ctx?.compact ? "compact" : "wide")); },
      pick: (_id, action, ctx) => remotePick(action, ctx, ctx?.compact ? "compact" : "wide"),
    },
    apps: {
      title: "Samsung TV Apps",
      placeholder: "Search the TV's apps",
      list: (_q, ctx) => listApps(ctx),
      pick: (id, action) => pickApp(id, action),
    },
    commands: {
      title: "Samsung TV",
      list: async () => {
        const list = await paired();
        const dev = current(list);
        const inputs = tv.conn?.inputs() ?? (await import("./device.ts")).INPUTS;
        return dev ? commandRows(dev.name, list.filter((d) => d.id !== dev.id).map((d) => d.name), inputs) : [SETUP_ROW];
      },
      pick: (id, action, ctx) => pickCommand(id, action, ctx),
    },
    setup: {
      title: "Set Up Samsung TV",
      view: setupView,
      pick: (_id, action, ctx) => setupPick(action, ctx),
    },
  },
  controls: handlers,
  bar: {
    tv: {
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
  dispose: () => {
    if (flashTimer) clearTimeout(flashTimer);
    cancelPairing();
    disposeTv();
  },
} satisfies Extension;
