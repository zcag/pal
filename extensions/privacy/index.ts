// What is using the camera, the microphone or the screen, over the core's
// privacy capability. The bar item is off the strip until something is,
// then shows a glyph per sensor on an amber band, the apps named in the
// tooltip and the popover: a call, a screen share, a recording. It
// re-renders on the core's `privacy` trigger (a change seen within a
// second or two), not on a poll of its own. The palette lists the same
// rows, so `camera` at the root says who has it.
import { errorMessage, hint, privacy, toast, type Action, type BarCtx, type BarItem, type Effect, type Extension, type Item, type PrivacyUse } from "@zcag/pal";
import { GLYPH, SENSOR, detailOf, enterTitle, keyOf, nameOf, render, type BarState } from "./view.ts";

const MAC = process.platform === "darwin";
const PANE: Record<PrivacyUse["sensor"] | "all", string> = {
  camera: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  all: "x-apple.systempreferences:com.apple.preference.security?Privacy",
};
const LINUX_SETTINGS = [["gnome-control-center", "privacy"], ["systemsettings"]];
const ORDER: PrivacyUse["sensor"][] = ["camera", "microphone", "screen"];

async function settings(sensor: PrivacyUse["sensor"] | "all"): Promise<Effect> {
  if (MAC) return { open: PANE[sensor] };
  const argv = LINUX_SETTINGS.find(([bin]) => Bun.which(bin));
  if (!argv) return toast("No privacy settings app", "Neither gnome-control-center nor systemsettings is installed", "failure");
  Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
  return { hide: true };
}

/** Enter on a use: its app forward, else the sensor's settings. */
const show = (u: PrivacyUse): Promise<Effect> | Effect => (u.path ? { open: u.path } : settings(u.sensor));

// ---- the bar item ------------------------------------------------------------

let barFocus: string | undefined;
const barState = (uses: PrivacyUse[]): BarState => ({ uses, focus: Math.max(0, uses.findIndex((u) => keyOf(u) === barFocus)) });

async function renderBar(): Promise<BarItem> {
  let uses: PrivacyUse[];
  try { uses = await privacy.inUse(); } catch { return { hidden: true, states: { camera: null, microphone: null, screen: null } }; }
  const on = ORDER.filter((s) => uses.some((u) => u.sensor === s));
  const states = Object.fromEntries(ORDER.map((s) => [s, on.includes(s)]));
  const menu = { view: render(barState(uses)) };
  const clear = { icon: GLYPH.camera, tooltip: "Nothing is using the camera, the microphone or the screen", menu };
  if (!on.length) return { ...clear, click: "open", empty: clear, states };
  const tooltip = on.map((s) => `${SENSOR[s]}: ${uses.filter((u) => u.sensor === s).map(nameOf).join(", ")}`).join(" · ");
  return { icon: on.map((s) => GLYPH[s]).join(" "), tooltip, color: "text", background: "amber", click: "open", menu, empty: clear, states };
}

async function barAction(action: string, _ctx: BarCtx): Promise<Effect> {
  if (action === "settings") return settings("all");
  const uses = await privacy.inUse().catch(() => [] as PrivacyUse[]);
  const st = barState(uses);
  if (action.startsWith("focus:")) { barFocus = action.slice(6); return { view: render(barState(uses)) }; }
  if (action === "down" || action === "up") {
    if (!uses.length) return { keep: true };
    barFocus = keyOf(uses[(st.focus + (action === "down" ? 1 : uses.length - 1)) % uses.length]);
    return { view: render(barState(uses)) };
  }
  const cur = uses[st.focus];
  if (action === "show" && cur) return show(cur);
  return { keep: true };
}

// ---- the palette -------------------------------------------------------------

const SETTINGS: Action = { id: "settings", title: "Open privacy settings", shortcut: "cmd+," };

const item = (u: PrivacyUse): Item => ({
  id: keyOf(u),
  name: nameOf(u),
  subtitle: detailOf(u),
  icon: u.path ? { app: u.path } : GLYPH[u.sensor],
  keywords: [SENSOR[u.sensor].toLowerCase(), ...(u.sensor === "camera" ? ["webcam", "video"] : u.sensor === "microphone" ? ["mic", "audio", "recording"] : ["sharing", "share", "recording"])],
  actions: [{ id: "show", title: enterTitle(u) }, SETTINGS],
});

export default {
  palettes: {
    privacy: {
      title: "Camera, Mic & Screen",
      live: true,
      list: async (): Promise<Item[]> => {
        try {
          const uses = await privacy.inUse();
          return uses.length ? uses.map(item) : [hint("none", "Nothing is using the camera, the microphone or the screen", "Apps that turn one on are listed here", { actions: [SETTINGS] })];
        } catch (e) { return [hint("error", "Cannot tell on this machine", errorMessage(e))]; }
      },
      pick: async (id, action): Promise<Effect> => {
        const uses = await privacy.inUse().catch(() => [] as PrivacyUse[]);
        const u = uses.find((x) => keyOf(x) === id);
        if (action === "settings") return settings(u?.sensor ?? "all");
        // Gone since the list was drawn (the call ended): nothing to bring forward.
        if (!u) return { keep: true };
        return show(u);
      },
    },
  },
  bar: {
    "in-use": { render: renderBar, onAction: barAction },
  },
} satisfies Extension;
