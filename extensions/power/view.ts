// The battery's two views as render trees, pure: index.ts reads, this
// draws what it is handed (the tests and the gallery hand it fixtures).
// The popover answers "how long, and what is eating it now" in one glance;
// the Battery & Power palette is the full account: the level and an hour-
// by-hour chart on the left, and on the right what draws power now and
// what used the battery today, this week and ever, in watt-hours.
import { column, ink, keyHint, POPOVER_W, row, sparkline, text, truncate, type Action, type SparkBand, type TagColor, type Theme, type View, type ViewNode } from "@zcag/pal";
import type { Point, Proc, Snapshot, Usage } from "./data.ts";

export const TABS = [
  { id: "now", title: "Now" },
  { id: "today", title: "Today" },
  { id: "week", title: "7 days" },
  { id: "all", title: "All time" },
] as const;
export type Tab = (typeof TABS)[number]["id"];

export type Dash = {
  snap: Snapshot;
  /** The last six hours of samples, for the chart. */
  history: Point[];
  tab: Tab;
  /** Today's window, for the day's total under the chart. */
  today?: Usage[];
  /** The tab's window: undefined while it loads, "missing" without the `power` CLI. */
  usage?: Usage[] | "missing";
  focus: number;
  theme?: Theme;
  compact?: boolean;
  now?: number;
};
export type Pop = { snap: Snapshot; hour: Point[]; today?: Usage[]; theme?: Theme; now?: number };

export const LOW = 20, CRITICAL = 10;
export const HISTORY_S = 6 * 3600;
const SLOTS = 72; // 5 min each over six hours
const NOW_ROWS = 5, NOW_ROWS_COMPACT = 4, USAGE_ROWS = 7, USAGE_ROWS_COMPACT = 5;
const LEFT_W = 272, CARD_PAD = 12, CHART_H = 96;
const G = { bolt: "\u{f140b}", battery: "\u{f0079}", alert: "\u{f0026}", lock: "\u{f033e}", dot: "\u{f111}", chip: "\u{f061a}", screen: "\u{f0379}", plug: "\u{f06a5}", awake: "\u{f0f36}" };
const RAMP: [number, string][] = [[90, "\u{f0079}"], [70, "\u{f0081}"], [50, "\u{f007f}"], [30, "\u{f007d}"], [20, "\u{f007b}"], [0, "\u{f007a}"]];

// ---- words -------------------------------------------------------------------

const onBattery = (s: Snapshot) => s.source === "Battery Power";
/** The level's colour, from the level alone: a warning at 80% still reads as "battery fine, something else is wrong", and the warning has its own card. */
export const levelColor = (s: Snapshot): TagColor => (onBattery(s) && s.percent <= CRITICAL ? "red" : onBattery(s) && s.percent <= LOW ? "amber" : "green");
export const glyphOf = (s: Snapshot) => (!onBattery(s) ? G.bolt : RAMP.find(([floor]) => s.percent >= floor)![1]);
/** `7.2 W`, `12 W`, `<0.1 W`. */
export const watts = (w: number) => (w < 0.1 ? "<0.1 W" : w < 10 ? `${w.toFixed(1)} W` : `${Math.round(w)} W`);
export const wh = (x: number) => (x < 0.1 ? "<0.1 Wh" : x < 10 ? `${x.toFixed(1)} Wh` : `${Math.round(x)} Wh`);
/** `3:07` into `3 h 7 min`, `42 min`. */
export const spoken = (clock?: string) => {
  const m = clock && /^(\d+):(\d\d)$/.exec(clock);
  if (!m) return undefined;
  const h = Number(m[1]), min = Number(m[2]);
  return h ? `${h} h${min ? ` ${min} min` : ""}` : `${min} min`;
};
/** The badge: where the power comes from, in two words. */
export const stateWord = (s: Snapshot) => (onBattery(s) ? "on battery" : s.charging ? "charging" : s.status === "charged" ? "full" : "on the charger");
/** One plain sentence under the level: what it is doing and how long that lasts. */
export function sentence(s: Snapshot): string {
  const left = spoken(s.eta);
  if (onBattery(s)) return [s.watts !== undefined ? `Drawing ${watts(s.watts)}` : "On battery", left && `${left} left`].filter(Boolean).join(" · ");
  if (s.charging) return [s.watts !== undefined && s.watts >= 0.5 ? `Charging at ${watts(s.watts)}` : "Charging", left && `full in ${left}`].filter(Boolean).join(" · ");
  return s.status === "charged" || s.percent >= 99 ? "Full, running on the charger" : "On the charger, holding the charge here";
}

/** The watcher's bookkeeping lines in plain words, and what each one is. */
const SPECIAL: Record<string, [string, string]> = {
  "(baseline)": ["Screen & the rest", "the display, Wi-Fi, memory and SSD: power no one process owns"],
  "(short-lived processes)": ["Short-lived processes", "commands that start and exit between two samples"],
  "(everything else)": ["Everything else", "every process below the top ones, together"],
};
/** A process as a person reads it: the watcher's bookkeeping lines in words, a full path cut to its file, never more than a line. */
export const nameOf = (name: string) => SPECIAL[name]?.[0] ?? truncate(name.split(/[\\/]/).filter(Boolean).at(-1) ?? name, 36);
const kindWord: Record<string, string> = { front: "in front", bg: "background", system: "system", minor: "background" };
/** Why a process costs, from the deep sampler: `24% CPU · 800 wakeups/s · 3 MB/s disk`. */
export function why(p: Proc): string | undefined {
  const rate = (b: number) => (b >= 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB/s` : `${Math.round(b / 1024)} KB/s`);
  const parts = [
    p.cpu !== undefined && p.cpu >= 5 && `${Math.round(p.cpu / 10)}% CPU`,
    p.wakeups !== undefined && p.wakeups >= 50 && `${p.wakeups >= 1000 ? `${(p.wakeups / 1000).toFixed(1)}k` : Math.round(p.wakeups)} wakeups/s`,
    p.disk !== undefined && p.disk >= 100 * 1024 && `${rate(p.disk)} disk`,
    p.net !== undefined && p.net >= 100 * 1024 && `${rate(p.net)} net`,
  ].filter(Boolean);
  // Two facts fit a line under the name; the CPU and the next strongest say most.
  return parts.length ? parts.slice(0, 2).join(" · ") : undefined;
}

// ---- the chart ---------------------------------------------------------------

/**
 * The samples into `slots` buckets ending now: the mean draw of each
 * bucket's battery samples (NaN where there were none, on the charger or
 * asleep), its last charge level, and the charger's stretches as bands.
 */
export function buckets(points: Point[], span: number, slots: number, now: number) {
  const size = span / slots, start = now - span;
  const draw: number[] = Array(slots).fill(Number.NaN), level: number[] = Array(slots).fill(Number.NaN);
  const sums = Array.from({ length: slots }, () => ({ w: 0, n: 0, ac: 0 }));
  for (const p of points) {
    const i = Math.floor((p.ts - start) / size);
    if (i < 0 || i >= slots) continue;
    level[i] = p.soc;
    if (p.ext) sums[i].ac++;
    else if (p.w > 0) { sums[i].w += p.w; sums[i].n++; }
  }
  const bands: SparkBand[] = [];
  sums.forEach((b, i) => {
    if (b.n) draw[i] = b.w / b.n;
    if (b.ac && b.ac >= b.n) {
      const last = bands.at(-1);
      if (last && last.to === i - 1) last.to = i; else bands.push({ from: i, to: i, color: "green" });
    }
  });
  const onBat = points.filter((p) => !p.ext && p.w > 0);
  return { draw, level, bands, batterySlots: draw.filter(Number.isFinite).length, mean: onBat.length ? onBat.reduce((a, p) => a + p.w, 0) / onBat.length : undefined, peak: onBat.length ? Math.max(...onBat.map((p) => p.w)) : undefined };
}

function chart(points: Point[], o: { span: number; slots: number; width: number; height: number; theme?: Theme; now: number; color: TagColor; key: string }): ViewNode[] {
  const b = buckets(points, o.span, o.slots, o.now);
  const src = sparkline([{ values: b.draw, color: o.color }, { values: b.level, color: "grey", line: true, max: 100 }], { width: o.width, height: o.height, theme: o.theme, floor: 10, slots: o.slots, bands: b.bands });
  const label = o.span >= 3600 ? `last ${o.span / 3600} h` : `last ${o.span / 60} min`;
  const caption = b.mean !== undefined ? `avg ${watts(b.mean)} · peak ${watts(b.peak!)}` : points.length ? "on the charger the whole time" : "no samples yet";
  const secs = (b.batterySlots * o.span) / o.slots;
  const onBat = o.span >= 3600 * 2 && points.length ? `${spoken(`${Math.floor(secs / 3600)}:${String(Math.round(secs / 60) % 60).padStart(2, "0")}`) ?? "0 min"} on battery · shaded: charger` : undefined;
  return [
    { type: "image", key: `${o.key}-chart`, src, width: o.width, height: o.height, alt: "Draw over time" },
    row([text(label, { style: "muted", size: "xs" }), { type: "spacer" }, text(caption, { style: "muted", size: "xs" })], { key: `${o.key}-caption`, gap: 1, minHeight: 14 }),
    ...(onBat ? [text(onBat, { key: `${o.key}-onbat`, style: "muted", size: "xs" })] : []),
  ];
}

// ---- pieces ------------------------------------------------------------------

const heading = (key: string, title: string, extra?: ViewNode): ViewNode => row([text(title, { size: "xs", weight: "semibold", color: "muted" }), ...(extra ? [{ type: "spacer" as const }, extra] : [])], { key: `h-${key}`, gap: 1, minHeight: 18 });
const tint = (color: TagColor, theme: Theme, alpha: string) => `${ink(color, theme)}${alpha}` as `#${string}`;

function head(s: Snapshot, big: "xl" | "lg" = "xl"): ViewNode[] {
  const c = levelColor(s);
  return [
    row([
      text(glyphOf(s), { key: "glyph", style: "glyph", size: "lg", color: c }),
      text(`${s.percent}%`, { key: "percent", style: "number", size: big, weight: "semibold" }),
      { type: "spacer" },
      { type: "badge", key: "state", text: stateWord(s), color: onBattery(s) ? (c === "green" ? "grey" : c) : "green" },
    ], { key: "head", gap: 2 }),
    { type: "progress", key: "level", value: s.percent / 100, color: c },
    text(sentence(s), { key: "sentence", style: "body", size: "sm" }),
  ];
}

function alertCards(s: Snapshot, theme: Theme): ViewNode[] {
  return s.alerts.map((a, i) => row([
    text(G.alert, { style: "glyph", color: a.level === "crit" ? "red" : "amber" }),
    text(a.message ?? a.rule, { size: "sm", weight: "medium" }),
  ], { key: `alert-${i}-${a.rule}`, padding: 2, gap: 2, radius: true, surface: tint(a.level === "crit" ? "red" : "amber", theme, "24"), transition: { enter: "fade", exit: "fade" } }));
}

/**
 * Where the watts go: one bar split between the chip and the rest (the
 * screen and radios), in proportion, with the watts under it. On the
 * charger the gauge shows the charge flowing in, not the draw, so only
 * the chip's own measured figure is there to show.
 */
function splitBar(s: Snapshot, theme: Theme): ViewNode[] {
  const { chip, rest, cpu, gpu } = s.split;
  if (chip === undefined) return [];
  if (!onBattery(s) || rest === undefined) {
    const parts = [cpu !== undefined && `CPU ${watts(cpu)}`, gpu !== undefined && `GPU ${watts(gpu)}`].filter(Boolean).join(" · ");
    return [heading("split", "Where the power goes", text(`chip ${watts(chip)}${parts ? ` · ${parts}` : ""}`, { style: "muted", size: "xs" })), text("On the charger only the chip is measured: the screen and the rest show on battery.", { key: "split-ac", style: "muted", size: "xs" })];
  }
  const seg = (key: string, value: number, color: TagColor): ViewNode => ({ type: "stack", key, flex: Math.max(value, 0.01), height: 10, surface: tint(color, theme, "d0"), children: [] });
  const legend = (color: TagColor, label: string) => row([text(G.dot, { style: "glyph", size: "xs", color }), text(label, { size: "xs", color: "muted" })], { gap: 1 });
  return [
    heading("split", "Where the power goes", text(`${watts(chip + rest)} in all`, { style: "muted", size: "xs" })),
    row([seg("seg-chip", chip, "violet"), seg("seg-rest", rest, "blue")], { key: "split-bar", gap: 0, radius: true, height: 10, align: "stretch" }),
    row([
      legend("violet", `Apps & chip ${watts(chip)}${cpu !== undefined && gpu !== undefined ? ` (CPU ${watts(cpu)}, GPU ${watts(gpu)})` : ""}`),
      { type: "spacer" },
      legend("blue", `Screen & the rest ${watts(rest)}`),
    ], { key: "split-legend", gap: 2, minHeight: 16 }),
  ];
}

const focusable = (key: string, children: ViewNode[], focused: boolean, action: string, minHeight = 30): ViewNode =>
  row(children, { key, padding: 1, gap: 2, minHeight, radius: true, action, ...(focused && { selected: true }), transition: { enter: "fade", exit: "fade" } });

function procRow(p: Proc, max: number, focused: boolean, i: number, barW: number): ViewNode {
  const color: TagColor = p.kind === "bg" ? "amber" : p.kind === "front" ? "blue" : "grey";
  const sub = [!SPECIAL[p.name] && kindWord[p.kind], why(p)].filter(Boolean).join(" · ");
  return focusable(`p-${p.name}`, [
    column([text(nameOf(p.name), { size: "sm", weight: focused ? "semibold" : "medium", minWidth: 0 }), ...(sub ? [text(sub, { style: "muted", size: "xs", minWidth: 0 })] : [])], { gap: 0, grow: true }),
    { type: "progress", value: max > 0 ? p.share / max : 0, width: barW, color },
    text(p.watts !== undefined ? watts(p.watts) : `${Math.round(p.share)}%`, { style: "number", size: "sm", width: 50, align: "end" }),
  ], focused, `focus:${i}`);
}

function usageRow(u: Usage, max: number, total: number, byScore: boolean, focused: boolean, i: number, barW: number): ViewNode {
  const special = SPECIAL[u.name];
  const share = byScore ? (total > 0 ? (u.ss / total) * 100 : 0) : total > 0 ? (u.wh / total) * 100 : 0;
  return focusable(`u-${u.name}`, [
    column([text(nameOf(u.name), { size: "sm", weight: focused ? "semibold" : "medium", color: special ? "muted" : undefined, minWidth: 0 }), ...(focused && special ? [text(special[1], { style: "muted", size: "xs", minWidth: 0 })] : [])], { gap: 0, grow: true }),
    { type: "progress", value: max > 0 ? (byScore ? u.ss : u.wh) / max : 0, width: barW, color: special ? "grey" : "violet" },
    text(byScore ? "" : wh(u.wh), { style: "number", size: "sm", width: 56, align: "end" }),
    text(`${share < 1 ? "<1" : Math.round(share)}%`, { style: "muted", size: "xs", width: 34, align: "end" }),
  ], focused, `focus:${i}`, 28);
}

/** What a window's rows rank by: watt-hours, or, when the window was spent on the charger (no draw to apportion), the activity scores. */
export function ranked(usage: Usage[]) {
  const total = usage.reduce((a, u) => a + u.wh, 0);
  const byScore = total < 0.05;
  const rows = (byScore ? usage.filter((u) => u.ss > 0).sort((a, b) => b.ss - a.ss) : usage.filter((u) => u.wh >= 0.005)).filter((u) => !byScore || !SPECIAL[u.name]);
  return { rows, total, byScore, scoreTotal: rows.reduce((a, u) => a + u.ss, 0) };
}

const tabTitle = (t: Tab) => TABS.find((x) => x.id === t)!.title;
const windowWords: Record<Exclude<Tab, "now">, string> = { today: "today", week: "in the last 7 days", all: "since the watcher started" };

function usageBody(d: Dash, barW: number): ViewNode[] {
  const t = d.tab as Exclude<Tab, "now">;
  if (d.usage === "missing") return [text("Install the power watcher to see what used the battery over time.", { key: "missing", style: "muted", size: "sm" })];
  if (!d.usage) return [text("Adding it up…", { key: "loading", style: "muted", size: "sm" })];
  const { rows, total, byScore, scoreTotal } = ranked(d.usage);
  if (!rows.length) return [text(`Nothing recorded ${windowWords[t]} yet.`, { key: "empty", style: "muted", size: "sm" })];
  const cap = d.snap.health.capacity;
  const summary = byScore
    ? `No battery used ${windowWords[t]}: on the charger, so this ranks by how busy each process was.`
    : `${wh(total)} used on battery ${windowWords[t]}${cap && total / cap >= 1 ? `, about ${(total / cap).toFixed(total / cap >= 10 ? 0 : 1)} full charges` : ""}.`;
  const shown = rows.slice(0, d.compact ? USAGE_ROWS_COMPACT : USAGE_ROWS);
  const max = Math.max(...shown.map((u) => (byScore ? u.ss : u.wh)));
  const focus = Math.min(d.focus, shown.length - 1);
  return [
    text(summary, { key: `summary-${t}`, style: "muted", size: "xs" }),
    column(shown.map((u, i) => usageRow(u, max, byScore ? scoreTotal : total, byScore, i === focus, i, barW)), { key: `rows-${t}`, gap: 0 }),
  ];
}

function nowBody(d: Dash, barW: number): ViewNode[] {
  const s = d.snap;
  if (!s.watched) return [text("Only the level is known. The power watcher measures the draw and names what uses it.", { key: "unwatched", style: "muted", size: "sm" })];
  const shown = s.procs.slice(0, d.compact ? NOW_ROWS_COMPACT : NOW_ROWS);
  const max = Math.max(0, ...shown.map((p) => p.share));
  const focus = Math.min(d.focus, shown.length - 1);
  const locks = [...new Set(s.locks.filter((l) => l.proc !== "powerd").map((l) => l.proc))];
  return [
    ...alertCards(s, d.theme),
    ...splitBar(s, d.theme),
    heading("procs", "Using power now", text(s.procs.some((p) => p.watts !== undefined) ? "share of the chip" : "share", { style: "muted", size: "xs" })),
    ...(shown.length ? [column(shown.map((p, i) => procRow(p, max, i === focus, i, barW)), { key: "procs", gap: 0 })] : [text("Nothing is using measurable power.", { key: "idle", style: "muted", size: "sm" })]),
    ...(locks.length ? [row([text(G.awake, { style: "glyph", size: "sm", color: "muted" }), text(`Kept awake by ${locks.join(", ")}`, { style: "muted", size: "xs" })], { key: "locks", gap: 1, minHeight: 18 })] : []),
  ];
}

function tabsRow(tab: Tab): ViewNode {
  return row([
    ...TABS.map((t): ViewNode => (t.id === tab
      ? { type: "badge", key: `tab-${t.id}`, text: t.title, color: "blue" }
      : { type: "stack", direction: "row", key: `tab-${t.id}`, padding: 0, action: `tab:${t.id}`, children: [text(t.title, { size: "xs", weight: "medium", color: "muted" })] })),
    { type: "spacer" },
    ...keyHint("tab", "switch", { size: "xs" }),
  ], { key: "tabs", gap: 3, minHeight: 22 });
}

function healthTiles(s: Snapshot, w: number): ViewNode {
  const h = s.health;
  const tiles: [string, string][] = [
    [h.health !== undefined ? `${Math.round(h.health)}%` : "–", "health"],
    [h.cycles !== undefined ? String(h.cycles) : "–", "cycles"],
    [h.temp !== undefined ? `${Math.round(h.temp)}°` : "–", h.thermal && h.thermal !== "Nominal" ? h.thermal.toLowerCase() : "temp"],
  ];
  const tw = Math.floor((w - 2 * 8) / 3);
  return row(tiles.map(([t, sub], i) => ({ type: "tile", key: `tile-${i}`, width: tw, height: 42, text: t, sub, color: sub === "health" && h.health !== undefined && h.health < 80 ? "amber" : "neutral", fill: "soft" })), { key: "tiles", gap: 2 });
}

function todayLine(d: Dash): ViewNode[] {
  if (!d.today) return [];
  const { total } = ranked(d.today), cap = d.snap.health.capacity;
  return total >= 0.05 ? [text(`Today: ${wh(total)} on battery${cap ? `, ${Math.round((total / cap) * 100)}% of a charge` : ""}`, { key: "today", size: "sm", weight: "medium" })] : [];
}

// ---- the palette -------------------------------------------------------------

/** How many rows the open tab lists, for the keys that move the cursor. */
export function rowCount(d: Dash): number {
  if (d.tab === "now") return d.snap.procs.slice(0, d.compact ? NOW_ROWS_COMPACT : NOW_ROWS).length;
  return Array.isArray(d.usage) ? ranked(d.usage).rows.slice(0, d.compact ? USAGE_ROWS_COMPACT : USAGE_ROWS).length : 0;
}
/** The name under the cursor, for Enter and copy. */
export function focusedName(d: Dash): string | undefined {
  const n = rowCount(d);
  if (!n) return;
  const i = Math.min(d.focus, n - 1);
  return d.tab === "now" ? d.snap.procs[i]?.name : Array.isArray(d.usage) ? ranked(d.usage).rows[i]?.name : undefined;
}

export function dashActions(d: Dash): Action[] {
  const name = focusedName(d);
  const real = name && !SPECIAL[name];
  return [
    ...(real ? [{ id: "processes", title: `Find ${name} in Processes`, shortcut: "enter" }] : [{ id: "settings", title: "Open Battery settings", shortcut: ["enter", "s"] }]),
    { id: "next", title: "Next tab", shortcut: ["tab", "right", "l"] },
    { id: "prev", title: "Previous tab", shortcut: ["shift+tab", "left", "h"] },
    ...TABS.map((t, i): Action => ({ id: `tab:${t.id}`, title: `Show ${t.title}`, shortcut: String(i + 1) })),
    ...(name ? [{ id: "copy", title: "Copy name", shortcut: "cmd+c" }] : []),
    ...(real ? [{ id: "settings", title: "Open Battery settings", shortcut: "s" }] : []),
    { id: "refresh", title: "Refresh", shortcut: "cmd+r" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...Array.from({ length: rowCount(d) }, (_, i): Action => ({ id: `focus:${i}`, title: `Focus row ${i + 1}`, hidden: true })),
  ];
}

export function renderDash(d: Dash): View {
  const s = d.snap, now = d.now ?? Date.now() / 1000;
  const body = d.tab === "now" ? nowBody(d, d.compact ? 70 : 96) : usageBody(d, d.compact ? 70 : 110);
  const right = column([tabsRow(d.tab), ...body], { key: `right-${d.tab}`, gap: 2, grow: true });
  const left = column([
    ...head(s),
    ...chart(d.history, { span: HISTORY_S, slots: SLOTS, width: LEFT_W - 2 * CARD_PAD, height: CHART_H, theme: d.theme, now, color: levelColor(s) === "green" ? "blue" : levelColor(s), key: "day" }),
    ...todayLine(d),
    { type: "spacer" },
    healthTiles(s, LEFT_W - 2 * CARD_PAD),
  ], { key: "left", width: LEFT_W, padding: 3, gap: 2, surface: "elevated", radius: true });
  const tree = d.compact
    ? column([...head(s, "lg"), right], { key: "dash", padding: 3, gap: 2 })
    : row([left, right], { key: "dash", padding: 3, gap: 4, align: "stretch" });
  return { title: `Battery ${s.percent}% · ${tabTitle(d.tab)}`, id: "dash", keys: "actions", actions: dashActions(d), tree };
}

// ---- the popover -------------------------------------------------------------

/** The popover's body is `POPOVER_W` wide inside its padding (the progress bar spans it). */
const POP_W = POPOVER_W;

export function renderPopover(p: Pop): View {
  const s = p.snap, now = p.now ?? Date.now() / 1000;
  const top = s.procs.slice(0, 4);
  const max = Math.max(0, ...top.map((x) => x.share));
  const today = p.today ? ranked(p.today) : undefined;
  const heaviest = today?.byScore ? undefined : today?.rows.find((u) => !SPECIAL[u.name]);
  const procLine = (x: Proc): ViewNode => row([
    text(truncate(nameOf(x.name), 30), { size: "sm", weight: "medium", minWidth: 0 }),
    { type: "spacer" },
    { type: "progress", value: max > 0 ? x.share / max : 0, width: 72, color: x.kind === "bg" ? "amber" : x.kind === "front" ? "blue" : "grey" },
    text(x.watts !== undefined ? watts(x.watts) : `${Math.round(x.share)}%`, { style: "number", size: "xs", width: 44, align: "end" }),
  ], { key: `pp-${x.name}`, gap: 2, minHeight: 22, transition: { enter: "fade", exit: "fade" } });
  return {
    title: "Battery",
    id: "power",
    keys: "actions",
    actions: [{ id: "palette", title: "Open Battery & Power", shortcut: "enter" }, { id: "settings", title: "Open Battery settings", shortcut: "s" }],
    tree: column([
      ...head(s),
      ...(s.watched && p.hour.some((x) => !x.ext && x.w > 0) ? chart(p.hour, { span: 3600, slots: 60, width: POP_W, height: 36, theme: p.theme, now, color: levelColor(s) === "green" ? "blue" : levelColor(s), key: "hour" }) : []),
      ...alertCards(s, p.theme),
      ...(top.length ? [heading("procs", "Using power now"), ...top.map(procLine)] : []),
      ...(today && today.total >= 0.05 ? [text(`Today: ${wh(today.total)} on battery${heaviest ? ` · most by ${truncate(nameOf(heaviest.name), 22)} (${wh(heaviest.wh)})` : ""}`, { key: "today", style: "muted", size: "xs" })] : []),
      ...(!s.watched ? [text("Install the power watcher to see the draw and what uses it.", { key: "unwatched", style: "muted", size: "xs" })] : []),
    ], { key: "power", padding: 3, gap: 2 }),
  };
}
