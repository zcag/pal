// Battery gauge first, with the owner's optional `power` watcher folded in
// when it is present.  The watcher is authoritative for measured draw and
// alerts; this extension never tries to reconstruct its process attribution.
import { readFile } from "node:fs/promises";
import { errorMessage, exec, hint, home, settings, toast, truncate, type Accessory, type BarItem, type Effect, type Extension, type Item, type Metadata } from "@zcag/pal";
import { renderPowerPopover, type PowerPopover } from "./view.ts";

type Settings = { show_below: number; show_charging_below: number; show_draw_watts: number; always_show: boolean; power_state_file: string };
type Battery = { percent: number; source: "Battery Power" | "Power Adapter"; status: "charging" | "discharging" | "charged" | "unknown"; remaining?: string; eta?: string };
type WatchState = { ts?: number; w?: number; ext?: boolean; chg?: boolean; eta?: number; level?: string; alerts?: unknown; blame?: unknown; temp?: number; locks?: unknown; today?: unknown };
type Snapshot = Battery & { watch?: WatchState; alerts: PowerPopover["alerts"]; blame: PowerPopover["blame"] };

const MAC = process.env.PAL_POWER_OS ?? process.platform;
const GLYPH = { full: "\u{f0079}", charging: "\u{f0084}", alert: "\u{f0083}", settings: "\u{f0493}", draw: "\u{f0904}", process: "\u{f04c3}", lock: "\u{f033e}" };
/** Level lives in the glyph, so the strip never spends width saying it twice. */
const RAMP: [number, string][] = [[90, GLYPH.full], [70, "\u{f0081}"], [50, "\u{f007f}"], [30, "\u{f007d}"], [20, "\u{f007b}"], [0, "\u{f007a}"]];
/**
 * Amber at 20%, red at 10%, but the time left appears five points earlier: the
 * number that explains the colour should already be on screen by the time the
 * colour arrives, never the other way round.
 */
const LOW_PERCENT = 20, CRITICAL_PERCENT = 10, ETA_PERCENT = LOW_PERCENT + 5;
const MAC_SETTINGS = "x-apple.systempreferences:com.apple.Battery-Settings.extension";
const LINUX_SETTINGS = [["gnome-control-center", "power"], ["systemsettings", "kcm_powerdevilprofilesconfig"]];
const CMD_MS = 3000;

const run = async (argv: string[]) => Bun.which(argv[0]) ? (await exec(argv, { ms: CMD_MS })).out : "";
const settingsOf = () => settings.get<Settings>();
const asNum = (x: unknown) => typeof x === "number" && Number.isFinite(x) ? x : undefined;
const duration = (seconds: number | undefined) => seconds && seconds > 0 ? `${Math.floor(seconds / 3600)}h ${Math.max(0, Math.round(seconds / 60) % 60).toString().padStart(2, "0")}m remaining` : undefined;
/** `3:02`, the compact form the strip has room for. */
const clock = (seconds: number | undefined) => seconds && seconds > 0 ? `${Math.floor(seconds / 3600)}:${Math.max(0, Math.round(seconds / 60) % 60).toString().padStart(2, "0")}` : undefined;

/** `pmset -g batt`; Apple's compact line has stayed stable across recent macOS releases. */
export function parsePmset(text: string): Battery | undefined {
  const line = text.split("\n").find((l) => /%;/.test(l));
  const percent = line && /(\d+)%/.exec(line)?.[1];
  if (!line || !percent) return;
  const lower = line.toLowerCase();
  const source: Battery["source"] = /battery power/i.test(text) ? "Battery Power" : "Power Adapter";
  const status: Battery["status"] = /discharging/.test(lower) ? "discharging" : /charging/.test(lower) ? "charging" : /charged|finishing/.test(lower) ? "charged" : "unknown";
  const left = /(\d+:\d+) remaining/.exec(line)?.[1];
  // pmset answers 0:00 while it recalculates -- for minutes after a plug change,
  // and whenever the load swings -- so treat that as no estimate and let the
  // watcher's own figure stand in rather than showing a zero or nothing at all.
  const eta = left && left !== "0:00" ? left : undefined;
  return { percent: Number(percent), source, status, eta, remaining: eta ? `${eta} remaining` : undefined };
}

/** `upower -i`: use the display device/battery key-value form, ignoring history lines. */
export function parseUpower(text: string): Battery | undefined {
  const value = (key: string) => new RegExp(`^\\s*${key}:\\s*(.+)$`, "m").exec(text)?.[1].trim();
  const raw = value("percentage")?.replace("%", "");
  const percent = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(percent)) return;
  const rawState = value("state")?.toLowerCase() ?? "unknown";
  const status: Battery["status"] = rawState === "charging" ? "charging" : rawState === "discharging" ? "discharging" : rawState === "fully-charged" ? "charged" : "unknown";
  const remaining = value(status === "charging" ? "time to full" : "time to empty");
  return { percent, source: status === "discharging" ? "Battery Power" : "Power Adapter", status, remaining: remaining ? `${remaining.replace(/ hours?/, "h").replace(/ minutes?/, "m")} remaining` : undefined };
}

async function battery(): Promise<Battery | undefined> {
  if (MAC === "darwin") return parsePmset(await run(["pmset", "-g", "batt"]));
  const devices = (await run(["upower", "-e"])).split("\n").filter((x) => /battery/i.test(x));
  for (const device of devices) {
    const found = parseUpower(await run(["upower", "-i", device.trim()]));
    if (found) return found;
  }
}

function alerts(value: unknown): PowerPopover["alerts"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a): PowerPopover["alerts"] => {
    if (!a || typeof a !== "object") return [];
    const v = a as Record<string, unknown>;
    if (v.level !== "warn" && v.level !== "crit") return [];
    return [{ rule: typeof v.rule === "string" ? v.rule : "power", level: v.level, message: typeof v.msg === "string" ? v.msg : undefined }];
  });
}
function blame(value: unknown): PowerPopover["blame"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((x): PowerPopover["blame"] => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "number" ? [[x[0], x[1], typeof x[2] === "string" ? x[2] : ""]] : []);
}
async function watchState(): Promise<WatchState | undefined> {
  try {
    const file = home(settingsOf().power_state_file);
    const raw = JSON.parse(await readFile(file, "utf8"));
    if (!raw || typeof raw !== "object") return;
    const s = raw as WatchState;
    // A sleeping watcher must not make yesterday's draw look current.
    if (typeof s.ts === "number" && Date.now() / 1000 - s.ts > 180) return;
    return s;
  } catch { return; }
}
async function snapshot(): Promise<Snapshot | undefined> {
  const [gauge, watch] = await Promise.all([battery(), watchState()]);
  if (!gauge) return;
  const seconds = asNum(watch?.eta);
  return { ...gauge, eta: gauge.eta ?? clock(seconds), remaining: gauge.remaining ?? duration(seconds), watch, alerts: alerts(watch?.alerts), blame: blame(watch?.blame) };
}
const severity = (s: Snapshot) => s.alerts.some((a) => a.level === "crit") || (s.source === "Battery Power" && s.percent <= CRITICAL_PERCENT) ? "red" as const
  : s.alerts.length || (s.source === "Battery Power" && s.percent <= LOW_PERCENT) ? "amber" as const : undefined;
/** His ramp, and charging is its own shape; severity is the colour's job, so an
 *  alert at 80% still reads as "battery fine, something else is wrong". */
const glyph = (s: Snapshot) => s.status === "charging" || s.status === "charged" ? GLYPH.charging : RAMP.find(([floor]) => s.percent >= floor)![1];
const stateLabel = (s: Snapshot) => s.status === "charging" ? "Charging" : s.status === "discharging" ? "Discharging" : s.status === "charged" ? "Charged" : "Battery status unavailable";
const watchFresh = (s: Snapshot) => s.watch?.w === undefined ? undefined : `${s.watch.w.toFixed(1)} W draw`;
/** Waste interrupts whatever the level is; a bare draw only counts on battery. */
const loud = (s: Snapshot) => !!s.alerts.length || (s.source === "Battery Power" && (s.watch?.w ?? 0) >= settingsOf().show_draw_watts);

/** When a rule fired it named the culprit; otherwise only a dominant background process is worth the width. */
function cause(s: Snapshot): string | undefined {
  const worst = s.alerts.some((a) => a.level === "crit") ? "crit" : "warn";
  const rule = s.alerts.find((a) => a.level === worst)?.rule;
  if (rule) return rule;
  const top = s.blame[0];
  return top && top[2] === "bg" && top[1] >= 33 ? truncate(top[0], 14) : undefined;
}
/** `31% · 2:57 · 7.2W · background-burn`, and never a fourth field: at 15% the
 *  question is how long, not who, so the ETA takes the slot and the popover
 *  keeps the name. */
function title(s: Snapshot): string {
  const parts = [`${s.percent}%`];
  const eta = s.status === "discharging" && s.percent <= ETA_PERCENT ? s.eta : undefined;
  if (eta) parts.push(eta);
  if (loud(s)) {
    if (s.watch?.w !== undefined) parts.push(`${s.watch.w.toFixed(1)}W`);
    const why = eta ? undefined : cause(s);
    if (why) parts.push(why);
  }
  return parts.join(" · ");
}

function shouldShow(s: Snapshot): boolean {
  const c = settingsOf();
  if (c.always_show || loud(s)) return true;
  return s.source === "Battery Power" ? s.percent < c.show_below : s.percent <= c.show_charging_below;
}
function popover(s: Snapshot) {
  return renderPowerPopover({ percent: s.percent, source: s.source, status: stateLabel(s), remaining: s.remaining, watts: s.watch?.w, alerts: s.alerts, blame: s.blame });
}
async function barItem(): Promise<BarItem> {
  const s = await snapshot().catch(() => undefined);
  if (!s || !shouldShow(s)) return { hidden: true };
  const tooltip = [s.source, stateLabel(s), s.remaining, watchFresh(s), s.alerts[0]?.message].filter(Boolean).join(" · ");
  return { icon: glyph(s), title: title(s), color: severity(s), tooltip, click: "open", menu: { view: popover(s) } };
}

const meta = (pairs: [string, string | undefined][]): Metadata[] => pairs.filter((x): x is [string, string] => !!x[1]).map(([label, value]) => ({ label, value }));
function accessories(s: Snapshot): Accessory[] {
  const out: Accessory[] = [];
  if (s.remaining) out.push({ text: s.remaining.replace(" remaining", "") });
  out.push({ tag: stateLabel(s).toLowerCase(), color: severity(s) ?? (s.status === "charging" ? "green" : "grey") });
  return out;
}
function rows(s: Snapshot): Item[] {
  const result: Item[] = [{ id: "battery", name: `${s.percent}%`, subtitle: [s.source, stateLabel(s), s.remaining].filter(Boolean).join(" · "), icon: glyph(s), accessories: accessories(s), section: "Battery", detail: { metadata: meta([["Level", `${s.percent}%`], ["Power source", s.source], ["State", stateLabel(s)], ["Time remaining", s.remaining], ["Temperature", s.watch?.temp === undefined ? undefined : `${s.watch.temp.toFixed(1)} °C`]]) }, actions: [{ id: "settings", title: "Open Battery settings" }] }];
  if (s.watch?.w !== undefined) result.push({ id: "draw", name: `${s.watch.w.toFixed(1)} W`, subtitle: "Measured draw from the power watcher", icon: GLYPH.draw, section: "Power", detail: { metadata: meta([["Draw", `${s.watch.w.toFixed(2)} W`], ["Sample", s.watch.ts ? new Date(s.watch.ts * 1000).toLocaleTimeString() : undefined], ["Temperature", s.watch.temp === undefined ? undefined : `${s.watch.temp.toFixed(1)} °C`]]) }, actions: [] });
  for (const [n, alert] of s.alerts.entries()) result.push({ id: `alert:${n}`, name: alert.rule, subtitle: alert.message ?? "Power warning", icon: GLYPH.alert, section: "Attention", accessories: [{ tag: alert.level, color: alert.level === "crit" ? "red" : "amber" }], actions: [{ id: "settings", title: "Open Battery settings" }] });
  for (const [n, [process, share, kind]] of s.blame.entries()) result.push({ id: `blame:${n}`, name: process, subtitle: kind === "bg" ? "Background process" : kind === "front" ? "Front app" : "System process", icon: GLYPH.process, section: "Power", accessories: [{ text: `${Math.round(share)}%` }], actions: [] });
  if (Array.isArray(s.watch?.locks)) for (const [n, lock] of s.watch!.locks.entries()) if (Array.isArray(lock) && typeof lock[0] === "string") result.push({ id: `lock:${n}`, name: lock[0], subtitle: typeof lock[1] === "string" ? lock[1] : "Keeping the Mac awake", icon: GLYPH.lock, section: "Wake locks", actions: [] });
  return result;
}

async function openSettings(): Promise<Effect> {
  if (MAC === "darwin") return { open: MAC_SETTINGS };
  const argv = LINUX_SETTINGS.find((x) => Bun.which(x[0]));
  if (!argv) return toast("No power settings app", "Neither gnome-control-center nor systemsettings is installed", "failure");
  Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
  return { hide: true };
}

export default {
  palettes: {
    power: {
      title: "Battery & Power",
      live: true,
      showDetail: true,
      placeholder: "Battery, draw, or a process",
      list: async () => {
        try { const s = await snapshot(); return s ? rows(s) : [hint("missing", "No battery detected", "This machine has no battery that pmset or upower can read", { icon: GLYPH.full })]; }
        catch (e) { return [hint("error", "Battery unavailable", errorMessage(e), { icon: GLYPH.alert })]; }
      },
      pick: async (id, action) => action === "settings" || id === "battery" ? openSettings() : { keep: true },
    },
  },
  bar: {
    battery: { render: barItem, onOpen: openSettings, onAction: (action) => action === "settings" ? openSettings() : { keep: true } },
  },
} satisfies Extension;
