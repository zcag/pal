// The Camera, Mic & Screen popover as a pure view tree: one row per app,
// its icon, what it holds as coloured glyphs and words, and how long. A
// camera no one has named yet is a row of its own under the device's name.
// index.ts keeps the focus; a click moves it, Enter brings the app forward
// (a row with no app opens the privacy settings).
import { POPOVER_W, column, keyHint, row, text, type Action, type PrivacyUse, type View, type ViewNode } from "@zcag/pal";

type Sensor = PrivacyUse["sensor"];
export const ORDER: Sensor[] = ["camera", "microphone", "screen"];
export const GLYPH: Record<Sensor, string> = { camera: "\u{f05a0}", microphone: "\u{f036c}", screen: "\u{f0e51}" }; // md-webcam, md-microphone, md-monitor_share
export const SENSOR: Record<Sensor, string> = { camera: "Camera", microphone: "Microphone", screen: "Screen" };
/** macOS's own dot colours: green camera, orange microphone, purple screen. */
export const COLOR: Record<Sensor, "green" | "amber" | "violet"> = { camera: "green", microphone: "amber", screen: "violet" };

/** Each sensor's colour as a faint square behind its glyph (`#rrggbbaa`, the panel's ink kept). */
const TINT: Record<Sensor, `#${string}`> = { camera: "#5ccb8e2e", microphone: "#f0b25a2e", screen: "#b39dff2e" };

/** One app and everything it holds. */
export type Group = { key: string; name: string; path: string | null; process: string | null; sensors: Sensor[]; since: number | null };

/** The uses as one group per app, in the order they came (cameras first), each group's sensors in camera, mic, screen order and its earliest start. */
export function groups(uses: PrivacyUse[]): Group[] {
  const out: Group[] = [];
  for (const u of uses) {
    const key = u.app ?? `${u.sensor}:${u.device ?? ""}`;
    let g = out.find((x) => x.key === key);
    if (!g) out.push(g = { key, name: u.app ?? u.device ?? SENSOR[u.sensor], path: u.path, process: u.process, sensors: [], since: u.since });
    if (!g.sensors.includes(u.sensor)) g.sensors.push(u.sensor);
    g.path ??= u.path;
    g.process ??= u.process;
    if (u.since !== null && (g.since === null || u.since < g.since)) g.since = u.since;
  }
  for (const g of out) g.sensors.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return out;
}

/** How long, from a Unix-seconds start: `just now`, `12 min`, `1 h 5 min`. */
export function duration(since: number | null, now: number): string {
  if (since === null) return "";
  const m = Math.floor(Math.max(0, now - since) / 60);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** The title line: which sensors are on, in words. */
export function headline(uses: PrivacyUse[]): string {
  const on = ORDER.filter((s) => uses.some((u) => u.sensor === s)).map((s) => SENSOR[s].toLowerCase());
  if (!on.length) return "All clear";
  const words = on.length === 3 ? "camera, microphone and screen" : on.join(" and ");
  return `${words[0].toUpperCase()}${words.slice(1)} in use`;
}

export type BarState = { uses: PrivacyUse[]; focus: number; now: number };

const ICON = 36, OUTER_PAD = 12, ROW_PAD = 8, GAP = 8, SINCE_W = 72;
const BODY_W = POPOVER_W - 2 * OUTER_PAD - 2 * ROW_PAD - ICON - SINCE_W - 2 * GAP;

function mark(g: Group): ViewNode {
  if (g.path) return { type: "image", key: "icon", src: `icon://localhost/app?path=${encodeURIComponent(g.path)}&size=72`, width: ICON, height: ICON, alt: g.name };
  // A glyph as text on a tinted square: a tile's text face has no Nerd Font glyphs.
  const s = g.sensors[0];
  return { type: "stack", key: "icon", direction: "column", width: ICON, height: ICON, align: "center", justify: "center", radius: true, surface: TINT[s], children: [text(GLYPH[s], { style: "glyph", size: "lg", color: COLOR[s] })] };
}

/** What it holds: a coloured glyph and word per sensor. */
const holds = (g: Group): ViewNode =>
  row(g.sensors.flatMap((s) => [
    text(GLYPH[s], { key: `g-${s}`, style: "glyph", size: "xs", color: COLOR[s] }),
    text(SENSOR[s], { key: `w-${s}`, size: "xs", weight: "medium", color: COLOR[s] }),
  ]), { key: "holds", gap: 1 });

function groupRow(g: Group, focused: boolean, now: number): ViewNode {
  const name: ViewNode[] = [text(g.name, { key: "name", size: "md", weight: "semibold" })];
  if (g.process) name.push(text(g.process, { key: "proc", size: "sm", color: "faint" }));
  return row(
    [
      mark(g),
      column([row(name, { key: "top", gap: 1 }), holds(g)], { key: "body", gap: 0, width: BODY_W }),
      text(duration(g.since, now), { key: "since", style: "number", size: "sm", color: "muted", width: SINCE_W, align: "end" }),
    ],
    { key: g.key, padding: 2, minHeight: 56, radius: true, surface: focused ? "elevated" : undefined, selected: focused || undefined, action: `focus:${g.key}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function empty(): ViewNode {
  return column(
    [
      { type: "tile", key: "zero", width: 48, height: 48, text: "✓", color: "green", fill: "soft" },
      text("Nothing is using the camera, the microphone or the screen", { style: "title", key: "zero-t", align: "center" }),
      text("Apps show up here the moment one does.", { key: "zero-s", style: "muted", size: "sm", align: "center" }),
    ],
    { key: "empty", padding: 5, gap: 2, align: "center", justify: "center" },
  );
}

/** Enter's title for a group: bring its app forward, or open the privacy settings. */
export const enterTitle = (g: Group) => (g.path ? `Show ${g.name}` : "Open privacy settings");

function actions(cur: Group | undefined, all: Group[]): Action[] {
  return [
    ...(cur ? [{ id: "show", title: enterTitle(cur), shortcut: "enter" } as Action] : []),
    { id: "settings", title: "Open Privacy & Security settings", shortcut: "s" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...all.map((g): Action => ({ id: `focus:${g.key}`, title: `Focus ${g.name}`, hidden: true })),
  ];
}

export function render(st: BarState): View {
  const all = groups(st.uses);
  const focus = Math.min(Math.max(0, st.focus), Math.max(0, all.length - 1));
  const cur = all[focus];
  const hints = row([...(cur ? keyHint("enter", cur.path ? "show app" : "settings") : []), ...keyHint("s", "privacy settings")], { key: "hints", gap: 1, minHeight: 22 });
  return {
    tree: column([...(all.length ? [column(all.map((g, i) => groupRow(g, i === focus, st.now)), { key: "rows", gap: 0 })] : [empty()]), { type: "divider", key: "rule" }, hints], { key: "compact", padding: 3, gap: 2 }),
    actions: actions(cur, all),
    title: headline(st.uses),
    id: "in-use",
    keys: "actions",
  };
}
