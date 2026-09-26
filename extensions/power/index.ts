// Battery gauge first, with the owner's optional `power` watcher folded in
// when it is present (data.ts reads both). The strip says the level and
// only grows a culprit when something is wrong; the popover answers how
// long and what is eating it now; the Battery & Power palette is the full
// account (view.ts draws both).
import { dirname, join } from "node:path";
import { home, settings, state, text, toast, truncate, view as liveView, type BarItem, type Ctx, type Effect, type Extension, type View } from "@zcag/pal";
import { points, snapshot, tailSamples, usage, type Snapshot, type Usage } from "./data.ts";
import { focusedName, glyphOf, HISTORY_S, LOW, renderDash, renderPopover, rowCount, TABS, type Dash, type Tab } from "./view.ts";

export { parsePmset, parseUpower } from "./data.ts";

type Settings = { power_state_file: string };
const EXTENSION = "power";
const OS = () => process.env.PAL_POWER_OS ?? process.platform;
/** The time left joins the strip five points before amber, so the number that explains the colour is already there when it arrives. */
const ETA_PERCENT = LOW + 5;
/** On battery, a measured draw from here up is worth the strip's width (the watts and the culprit); the manifest's rules show the item from the same number. */
const LOUD_WATTS = 15;
const MAC_SETTINGS = "x-apple.systempreferences:com.apple.Battery-Settings.extension";
const LINUX_SETTINGS = [["gnome-control-center", "power"], ["systemsettings", "kcm_powerdevilprofilesconfig"]];
/** The watcher samples every 30 s; an open palette re-reads a little faster so a new sample shows soon after it lands. */
const LIVE_MS = Number(process.env.PAL_POWER_LIVE_MS) || 10_000;
/** `power blame` reads the ring buffer; a window's answer is kept this long. */
const USAGE_TTL = 60_000;
const SPANS: Record<Exclude<Tab, "now">, () => string | undefined> = {
  today: () => { const d = new Date(); return `${Math.max(60, Math.round((d.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 1000))}s`; },
  week: () => "7d",
  all: () => undefined,
};

const stateFile = () => settings.get<Settings>().power_state_file;
const samplesFile = () => join(dirname(home(stateFile())), "samples.jsonl");
const read = () => snapshot({ os: OS(), stateFile: stateFile() });

let theme: "dark" | "light" | undefined;
let started = false;
function start() {
  if (started) return;
  started = true;
  state.get("theme", EXTENSION).then((t) => { theme = t === "dark" || t === "light" ? t : undefined; }).catch(() => {});
  state.onChange("theme", (t) => { theme = t === "dark" || t === "light" ? t : undefined; });
  liveView.onShown((ev) => { if (ev.palette === "power") follow(); }, EXTENSION);
  liveView.onHidden((ev) => { if (ev.palette === "power") stop(); }, EXTENSION);
}

const cache = new Map<Tab, { at: number; rows: Usage[] | "missing" }>();
async function windowOf(tab: Exclude<Tab, "now">): Promise<Usage[] | "missing"> {
  const hit = cache.get(tab);
  if (hit && Date.now() - hit.at < USAGE_TTL) return hit.rows;
  const rows = (await usage(SPANS[tab]()).catch(() => undefined)) ?? "missing";
  cache.set(tab, { at: Date.now(), rows });
  return rows;
}

// ---- the strip ---------------------------------------------------------------

const stateLabel = (s: Snapshot) => (s.status === "charging" ? "Charging" : s.status === "discharging" ? "Discharging" : s.status === "charged" ? "Charged" : "Not charging");
/** Waste interrupts whatever the level is; a bare draw only counts on battery. */
const loud = (s: Snapshot) => !!s.alerts.length || (s.source === "Battery Power" && (s.watts ?? 0) >= LOUD_WATTS);
/** When a rule fired it named the culprit; otherwise only a dominant background process is worth the width. */
function cause(s: Snapshot): string | undefined {
  const worst = s.alerts.some((a) => a.level === "crit") ? "crit" : "warn";
  const rule = s.alerts.find((a) => a.level === worst)?.rule;
  if (rule) return rule;
  const top = s.procs[0];
  return top && top.kind === "bg" && top.share >= 33 ? truncate(top.name, 14) : undefined;
}
/** `31% · 2:57 · 7.2W · background-burn`, never a fourth field: low down the question is how long, not who, so the time left takes the slot and the popover keeps the name. */
function title(s: Snapshot): string {
  const parts = [`${s.percent}%`];
  const eta = s.status === "discharging" && s.percent <= ETA_PERCENT ? s.eta : undefined;
  if (eta) parts.push(eta);
  if (loud(s)) {
    if (s.watts !== undefined) parts.push(`${s.watts.toFixed(1)}W`);
    const why = eta ? undefined : cause(s);
    if (why) parts.push(why);
  }
  return parts.join(" · ");
}

async function popover(s: Snapshot) {
  const [hour, today] = await Promise.all([s.watched ? tailSamples(samplesFile(), 3600).then(points) : [], s.watched ? windowOf("today") : undefined]);
  return renderPopover({ snap: s, hour, today: Array.isArray(today) ? today : undefined, theme });
}

/**
 * The item as rendered says the level and publishes the facts (`power/level`,
 * `power/charging`, `power/draw`, `power/alert`); whether it shows and in what
 * colour is the manifest's rules over those (docs/design/states.md). The
 * `empty` shape is what `show = "always"` keeps while a rule hides it. No
 * battery at all is hidden either way. A click opens the palette; a hover
 * the popover.
 */
async function barItem(): Promise<BarItem> {
  start();
  const s = await read().catch(() => undefined);
  if (!s) return { hidden: true, states: { level: null, charging: null, draw: null, alert: null } };
  const tooltip = [s.source, stateLabel(s), s.remaining, s.watts !== undefined && s.source === "Battery Power" ? `${s.watts.toFixed(1)} W draw` : undefined, s.alerts[0]?.message].filter(Boolean).join(" · ");
  const menu = { view: await popover(s) };
  const alert = s.alerts.some((a) => a.level === "crit") ? "crit" : s.alerts.length ? "warn" : null;
  return { icon: glyphOf(s), title: title(s), tooltip, click: "open", menu, empty: { icon: glyphOf(s), title: title(s), tooltip, menu }, states: { level: s.percent, charging: s.source !== "Battery Power", draw: s.source === "Battery Power" ? (s.watts ?? 0) : 0, alert } };
}

// ---- the palette -------------------------------------------------------------

type Ui = { tab: Tab; focus: number };
const ui: Ui = { tab: "now", focus: 0 };
let timer: ReturnType<typeof setInterval> | undefined;
let compact = false;

async function dash(): Promise<Dash | undefined> {
  const s = await read();
  if (!s) return;
  const [history, windowRows, today] = await Promise.all([
    s.watched ? tailSamples(samplesFile(), HISTORY_S).then(points) : Promise.resolve([]),
    ui.tab === "now" ? Promise.resolve(undefined) : windowOf(ui.tab),
    s.watched ? windowOf("today") : Promise.resolve(undefined),
  ]);
  return { snap: s, history, tab: ui.tab, usage: windowRows, today: Array.isArray(today) ? today : undefined, focus: ui.focus, theme, compact };
}

const noBattery = (): View => ({ title: "Battery & Power", actions: [{ id: "settings", title: "Open power settings" }], tree: text("This machine has no battery that pmset or upower can read.", { style: "muted" }) });
async function render(): Promise<View> {
  const d = await dash();
  return d ? renderDash(d) : noBattery();
}

function follow() {
  timer ??= setInterval(() => {
    render().then((v) => liveView.update(v, { palette: "power" })).catch(() => {});
  }, LIVE_MS);
}
function stop() { clearInterval(timer); timer = undefined; }

async function openSettings(): Promise<Effect> {
  if (OS() === "darwin") return { open: MAC_SETTINGS };
  const argv = LINUX_SETTINGS.find((x) => Bun.which(x[0]));
  if (!argv) return toast("No power settings app", "Neither gnome-control-center nor systemsettings is installed", "failure");
  Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
  return { hide: true };
}

const openPalette = (): Effect => ({ push: { extension: EXTENSION, palette: "power" } });

async function dashPick(action: string | undefined): Promise<Effect> {
  const tabs = TABS.map((t) => t.id);
  const d = await dash();
  const n = d ? rowCount(d) : 0;
  const to = (tab: Tab) => { ui.tab = tab; ui.focus = 0; };
  switch (action) {
    case "next": to(tabs[(tabs.indexOf(ui.tab) + 1) % tabs.length]); break;
    case "prev": to(tabs[(tabs.indexOf(ui.tab) + tabs.length - 1) % tabs.length]); break;
    case "down": ui.focus = Math.min(ui.focus + 1, Math.max(0, n - 1)); break;
    case "up": ui.focus = Math.max(0, ui.focus - 1); break;
    case "refresh": cache.clear(); break;
    case "settings": return openSettings();
    case "copy": { const name = d && focusedName(d); return name ? { copy: name, keep: true, toast: { title: "Copied", message: name } } : { keep: true }; }
    case "processes": { const name = d && focusedName(d); return name ? { push: { extension: "processes", palette: "processes", query: name } } : { keep: true }; }
    default:
      if (action?.startsWith("tab:")) to(action.slice(4) as Tab);
      else if (action?.startsWith("focus:")) ui.focus = Number(action.slice(6)) || 0;
  }
  return { view: await render() };
}

export default {
  palettes: {
    power: {
      title: "Battery & Power",
      view: async (ctx?: Ctx) => {
        start();
        ui.tab = "now"; ui.focus = 0; compact = !!ctx?.compact;
        return render();
      },
      pick: (_id, action) => dashPick(action),
    },
  },
  bar: {
    battery: {
      render: barItem,
      onOpen: async () => openPalette(),
      onAction: (action) => (action === "settings" ? openSettings() : action === "palette" ? openPalette() : { keep: true }),
    },
  },
  dispose: stop,
} satisfies Extension;
