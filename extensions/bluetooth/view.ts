// The Bluetooth Battery bar popover as a pure view tree. The bar item is
// an alert, not the full Bluetooth picker: the lowest connected battery
// leads as a headline (its level large, its name over it), the other low
// devices follow with a battery bar, then the rest of the connected battery picture,
// then the connected devices whose battery the OS does not report. A cursor
// (`selected`) lives in index.ts; a click moves it, Enter disconnects that
// connected device, and the footer shows the keys as keycaps.
import { POPOVER_W, column, keyHint, row, text, xdg, type Action, type BluetoothDevice, type View, type ViewNode } from "@zcag/pal";

export type BarState = {
  devices: BluetoothDevice[];
  threshold: number;
  /** Which connected row the keys act on. */
  focus: number;
};

export const GLYPH: Record<string, string> = {
  headphones: xdg("audio-headphones")!,
  speaker: xdg("audio-speakers")!,
  keyboard: xdg("input-keyboard")!,
  mouse: xdg("input-mouse")!,
  gamepad: xdg("applications-games")!,
  phone: xdg("phone")!,
  computer: xdg("computer")!,
  watch: "\u{f0589}", // md-watch
};

export const KIND: Record<string, string> = { headphones: "Headphones", speaker: "Speaker", keyboard: "Keyboard", mouse: "Mouse", gamepad: "Game controller", phone: "Phone", watch: "Watch", computer: "Computer" };

/** Connected devices with an OS-reported main level, low first for the alert. */
export const batteries = (devices: BluetoothDevice[]) => devices.filter((d) => d.connected && d.battery !== null).sort((a, b) => a.battery! - b.battery! || a.name.localeCompare(b.name));

/** Below this fixed floor the low alert is red. Lowering the configured threshold lowers this floor too. */
export const RED_PERCENT = 20;
export const levelColor = (level: number, threshold: number): "amber" | "red" => level <= Math.min(RED_PERCENT, threshold) ? "red" : "amber";

type Section = { key: string; title: string; rows: BluetoothDevice[]; low?: boolean };
/** What the popover draws: the lowest battery as its headline, the sections of the rest. */
type Shown = { lead?: BluetoothDevice; leadLow: boolean; sections: Section[] };

// Space is a 4px grid, so the outer column's `padding: 3` eats 12px a side and
// a row's `padding: 1` another 4px a side; `row()` defaults to `gap: 2` = 8px.
// Subtract all of it before sharing out the rest, or the text runs past the edge.
const OUTER_PAD = 12, ROW_PAD = 8, GAP = 8;
const GLYPH_W = 28, UNKNOWN_GLYPH_W = 22, LEVEL_W = 82, PCT_W = 34, KIND_W = 76;
const INNER_W = POPOVER_W - 2 * OUTER_PAD - ROW_PAD;
const BODY_W = INNER_W - GLYPH_W - GAP - LEVEL_W - GAP - PCT_W - GAP;
const NO_LEVEL_BODY_W = INNER_W - UNKNOWN_GLYPH_W - GAP - KIND_W - GAP;

export function shown(st: BarState): Shown {
  const withBattery = batteries(st.devices);
  const [lead, ...rest] = withBattery;
  const leadLow = !!lead && lead.battery! <= st.threshold;
  const low = rest.filter((d) => d.battery! <= st.threshold);
  const ok = rest.filter((d) => d.battery! > st.threshold);
  const unknown = st.devices.filter((d) => d.connected && d.battery === null).sort((a, b) => a.name.localeCompare(b.name));
  const sections: Section[] = [
    { key: "low", title: "Also low", rows: low, low: true },
    { key: "ok", title: leadLow ? "Other connected batteries" : "Connected batteries", rows: ok },
    { key: "unknown", title: "Connected, no battery reading", rows: unknown },
  ];
  return { lead, leadLow, sections: sections.filter((s) => s.rows.length) };
}

/** Every row the keys walk, in order: the headline's device first. */
export const rows = (st: BarState): BluetoothDevice[] => { const s = shown(st); return [...(s.lead ? [s.lead] : []), ...s.sections.flatMap((x) => x.rows)]; };

function glyph(d: BluetoothDevice, low: boolean, threshold: number): ViewNode {
  return { type: "tile", key: "glyph", width: GLYPH_W, height: GLYPH_W, text: GLYPH[d.kind] ?? xdg("bluetooth-connected")!, color: low ? levelColor(d.battery!, threshold) : "blue", fill: low ? "soft" : "outline" };
}

function batteryRow(d: BluetoothDevice, focused: boolean, threshold: number, low: boolean): ViewNode {
  // Amber and red are the alert's; a level above the threshold is fine, and says so.
  const color = low ? levelColor(d.battery!, threshold) : "green";
  return row(
    [
      glyph(d, low, threshold),
      column([
        text(d.name, { size: "md", weight: low || focused ? "semibold" : "medium", width: BODY_W }),
        text(d.battery_detail ?? (KIND[d.kind] ?? d.address), { size: "sm", color: low ? "muted" : "faint", width: BODY_W }),
      ], { key: "body", gap: 0 }),
      { type: "progress", key: "level", value: d.battery! / 100, width: LEVEL_W, color },
      text(`${d.battery}%`, { key: "pct", style: "number", size: "sm", color, width: PCT_W, align: "end" }),
    ],
    { key: d.address, padding: 1, minHeight: low ? 48 : 42, radius: true, surface: focused ? "elevated" : undefined, selected: focused || undefined, action: `focus:${d.address}`, transition: { enter: "fade", exit: "fade" } },
  );
}

/** The lowest connected battery as the popover's headline: its glyph, the name and what the OS adds (the earbuds and the case), the level large, a bar. */
function leadBlock(d: BluetoothDevice, focused: boolean, threshold: number, low: boolean): ViewNode {
  const color = low ? levelColor(d.battery!, threshold) : "green";
  return row(
    [
      glyph(d, low, threshold),
      column([
        row([text(d.name, { size: "sm", weight: "semibold" }), text(d.battery_detail ?? (KIND[d.kind] ?? d.address), { size: "xs", color: "muted" })], { key: "who", gap: 1 }),
        text(`${d.battery}%`, { key: "pct", style: "headline", color: low ? color : undefined }),
      ], { key: "body", gap: 0, grow: true }),
      { type: "progress", key: "level", value: d.battery! / 100, width: LEVEL_W, color },
    ],
    { key: d.address, padding: 1, minHeight: 64, radius: true, selected: focused || undefined, action: `focus:${d.address}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function unknownRow(d: BluetoothDevice, focused: boolean): ViewNode {
  return row(
    [
      { type: "tile", key: "glyph", width: UNKNOWN_GLYPH_W, height: UNKNOWN_GLYPH_W, text: GLYPH[d.kind] ?? xdg("bluetooth-connected")!, color: "grey", fill: "outline" },
      text(d.name, { size: "sm", weight: focused ? "semibold" : "medium", width: NO_LEVEL_BODY_W }),
      text(KIND[d.kind] ?? "Connected", { size: "xs", color: "faint", width: KIND_W, align: "end" }),
    ],
    { key: d.address, padding: 1, minHeight: 30, radius: true, selected: focused || undefined, action: `focus:${d.address}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function section(s: Section, st: BarState, offset: number): ViewNode {
  const label = row([text(s.title, { size: "xs", weight: "semibold", color: s.low ? "red" : "muted" }), { type: "badge", text: String(s.rows.length), color: s.low ? "red" : "grey" }], { key: `h-${s.key}`, gap: 1, minHeight: 22 });
  return column([label, ...s.rows.map((d, i) => d.battery === null ? unknownRow(d, offset + i === st.focus) : batteryRow(d, offset + i === st.focus, st.threshold, !!s.low))], { key: `s-${s.key}`, gap: 0 });
}

function hints(cur: BluetoothDevice | undefined): ViewNode {
  const kids: ViewNode[] = [];
  if (cur) kids.push(...keyHint("enter", "disconnect"), ...keyHint("c", "copy address"));
  kids.push(...keyHint("s", "settings"), ...keyHint("r", "refresh"), ...keyHint(["up", "down"], "move"));
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

function empty(): ViewNode {
  return column(
    [
      { type: "tile", key: "zero", width: 48, height: 48, text: "✓", color: "green", fill: "soft" },
      text("No connected devices", { style: "title", key: "zero-t" }),
      text("Bluetooth has nothing connected right now", { style: "muted", size: "sm", align: "center" }),
    ],
    { key: "empty", padding: 5, gap: 2, align: "center", justify: "center" },
  );
}

export function actions(st: BarState): Action[] {
  const cur = rows(st)[st.focus];
  const clicks = rows(st).map((d): Action => ({ id: `focus:${d.address}`, title: `Focus ${d.name}`, hidden: true }));
  return [
    ...(cur ? [{ id: "disconnect", title: `Disconnect ${cur.name}`, shortcut: "enter", style: "destructive", confirm: `Disconnect ${cur.name}?` } as Action, { id: "copy", title: "Copy address", shortcut: "c" } as Action] : []),
    { id: "settings", title: "Open Bluetooth Settings", shortcut: "s" },
    { id: "refresh", title: "Refresh", shortcut: "r" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...clicks,
  ];
}

export function render(st: BarState): View {
  const all = rows(st);
  const focus = Math.min(Math.max(0, st.focus), Math.max(0, all.length - 1));
  const s = shown(st);
  let offset = s.lead ? 1 : 0;
  const sections = s.sections.map((s) => {
    const node = section(s, { ...st, focus }, offset);
    offset += s.rows.length;
    return node;
  });
  const low = batteries(st.devices).filter((d) => d.battery! <= st.threshold).length;
  return {
    tree: column([...(s.lead ? [leadBlock(s.lead, focus === 0, st.threshold, s.leadLow)] : []), ...(all.length ? sections : [empty()]), { type: "divider", key: "rule" }, hints(all[focus])], { key: "compact", padding: 3, gap: 2 }),
    actions: actions({ ...st, focus }),
    title: low ? `${low} low Bluetooth ${low === 1 ? "battery" : "batteries"}` : "Bluetooth batteries",
    id: "battery",
    keys: "actions",
  };
}
