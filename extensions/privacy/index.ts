// What is using the camera, the microphone or the screen, over the core's
// privacy capability. The bar item is off the strip until something is,
// then shows a glyph per sensor on an amber band, the apps named in the
// tooltip and the popover: a call, a screen share, a recording. It
// re-renders on the core's `privacy` trigger (a change seen within a
// second or two), not on a poll of its own. The palette lists the same
// rows, so `camera` at the root says who has it.
import { errorMessage, hint, privacy, toast, view as liveView, type Action, type BarCtx, type BarItem, type Effect, type Extension, type Item, type PrivacyUse } from "@zcag/pal";
import { GLYPH, ORDER, SENSOR, duration, enterTitle, groups, render, type BarState, type Group } from "./view.ts";

const EXTENSION = "privacy";
const ITEM = "in-use";
const MAC = process.platform === "darwin";
const PANE: Record<PrivacyUse["sensor"] | "all", string> = {
  camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  all: "x-apple.systempreferences:com.apple.preference.security?Privacy",
};
const LINUX_SETTINGS = [["gnome-control-center", "privacy"], ["systemsettings"]];
/** How often the open popover is redrawn: the durations move by the minute (the tests shorten it). */
const POPOVER_TICK_MS = Number(process.env.PAL_PRIVACY_POPOVER_TICK_MS) || 30_000;
const nowS = () => Math.floor(Date.now() / 1000);

async function settings(sensor: PrivacyUse["sensor"] | "all"): Promise<Effect> {
  if (MAC) return { open: PANE[sensor] };
  const argv = LINUX_SETTINGS.find(([bin]) => Bun.which(bin));
  if (!argv) return toast("No privacy settings app", "Neither gnome-control-center nor systemsettings is installed", "failure");
  Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
  return { hide: true };
}

/** Enter on an app: it comes forward; a row with no app opens its sensor's settings. */
const show = (g: Group): Promise<Effect> | Effect => (g.path ? { open: g.path } : settings(g.sensors[0]));

// ---- the bar item ------------------------------------------------------------

let barFocus: string | undefined;
const barState = (uses: PrivacyUse[]): BarState => ({ uses, focus: Math.max(0, groups(uses).findIndex((g) => g.key === barFocus)), now: nowS() });
const popover = async () => render(barState(await privacy.inUse().catch(() => [] as PrivacyUse[])));

async function renderBar(): Promise<BarItem> {
  let uses: PrivacyUse[];
  try { uses = await privacy.inUse(); } catch { return { hidden: true, states: { camera: null, microphone: null, screen: null } }; }
  const on = ORDER.filter((s) => uses.some((u) => u.sensor === s));
  const states = Object.fromEntries(ORDER.map((s) => [s, on.includes(s)]));
  const menu = { view: render(barState(uses)) };
  const clear = { icon: GLYPH.camera, tooltip: "Nothing is using the camera, the microphone or the screen", menu };
  if (!on.length) return { ...clear, empty: clear, states };
  const tooltip = on.map((s) => `${SENSOR[s]}: ${groups(uses).filter((g) => g.sensors.includes(s)).map((g) => g.name).join(", ")}`).join(" · ");
  return { icon: on.map((s) => GLYPH[s]).join(" "), tooltip, background: "amber", menu, empty: clear, states };
}

async function barAction(action: string, _ctx: BarCtx): Promise<Effect> {
  if (action === "settings") return settings("all");
  const uses = await privacy.inUse().catch(() => [] as PrivacyUse[]);
  const all = groups(uses);
  const st = barState(uses);
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return { view: render(barState(uses)) }; }
  if (action === "down" || action === "up") {
    if (!all.length) return { keep: true };
    barFocus = all[(st.focus + (action === "down" ? 1 : all.length - 1)) % all.length].key;
    return { view: render(barState(uses)) };
  }
  const cur = all[st.focus];
  if (action === "show" && cur) return show(cur);
  return { keep: true };
}

// The durations tick while the popover is up.
let tick: ReturnType<typeof setInterval> | undefined;
liveView.onShown((ev) => {
  if (ev.bar !== ITEM) return;
  clearInterval(tick);
  tick = setInterval(() => { popover().then((v) => liveView.update(v, { extension: EXTENSION, bar: ITEM })).catch(() => {}); }, POPOVER_TICK_MS);
}, EXTENSION);
liveView.onHidden((ev) => { if (ev.bar === ITEM) { clearInterval(tick); tick = undefined; } }, EXTENSION);

// ---- the palette -------------------------------------------------------------

const SETTINGS: Action = { id: "settings", title: "Open privacy settings", shortcut: "cmd+," };
const KEYWORDS: Record<PrivacyUse["sensor"], string[]> = { camera: ["camera", "webcam", "video"], microphone: ["microphone", "mic", "audio", "recording"], screen: ["screen", "sharing", "share", "recording"] };

const item = (g: Group, now: number): Item => ({
  id: g.key,
  name: g.name,
  subtitle: [g.sensors.map((s) => SENSOR[s]).join(", "), g.process].filter(Boolean).join(" · "),
  icon: g.path ? { app: g.path } : GLYPH[g.sensors[0]],
  ...(g.since !== null && { accessories: [{ text: duration(g.since, now) }] }),
  keywords: g.sensors.flatMap((s) => KEYWORDS[s]),
  actions: [{ id: "show", title: enterTitle(g) }, SETTINGS],
});

export default {
  palettes: {
    privacy: {
      title: "Camera, Mic & Screen",
      live: true,
      list: async (): Promise<Item[]> => {
        try {
          const all = groups(await privacy.inUse());
          return all.length ? all.map((g) => item(g, nowS())) : [hint("none", "Nothing is using the camera, the microphone or the screen", "Apps show up here the moment one does", { actions: [SETTINGS] })];
        } catch (e) { return [hint("error", "Cannot tell on this machine", errorMessage(e))]; }
      },
      pick: async (id, action): Promise<Effect> => {
        const g = groups(await privacy.inUse().catch(() => [] as PrivacyUse[])).find((x) => x.key === id);
        if (action === "settings") return settings(g?.sensors[0] ?? "all");
        // Gone since the list was drawn (the call ended): nothing to bring forward.
        if (!g) return { keep: true };
        return show(g);
      },
    },
  },
  bar: {
    [ITEM]: { render: renderBar, onAction: barAction },
  },
} satisfies Extension;
