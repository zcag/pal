// The two audio bar items' popovers as render trees (`View` in
// `@zcag/pal`), pure: the tests render them directly. Both are the same
// shape, because both answer the same question in opposite directions —
// where is the sound going, and where is it coming from. The device in
// use leads on a card (its glyph, its name and transport, a slider for
// its level and a mute switch), the other devices of that direction
// follow as rows a click makes default, and the other direction gets one
// quiet line so the popover is the whole picture rather than half of it.
// A cursor (`selected`) the arrows move and a click sets; the keys as
// keycap hints.
import { POPOVER_W, column, keyHint, row, text, type Action, type AudioDevice, type View, type ViewNode } from "@zcag/pal";

/** Which direction the popover leads with; the other one is the quiet line under it. */
export type BarKind = AudioDevice["kind"];
export type BarState = {
  kind: BarKind;
  /** Every device of `kind`, the default among them. */
  devices: AudioDevice[];
  /** The default device of the other direction, for the line at the foot. */
  other?: AudioDevice;
  /** Which of `devices` the keys act on. */
  focus: number;
};

const GLYPH = { output: "\u{f04c3}", headphones: "\u{f08c3}", hdmi: "\u{f04c3}", input: "\u{f036c}", muted: "\u{f075f}", micMuted: "\u{f036d}" };
/** The rows' inner width, and what the name column has left once the glyph, the level and the switch have theirs. */
const PAD = 8, GLYPH_W = 22, LEVEL_W = 38, SWITCH_W = 34, SLIDER_W = 120;
const ROW_W = POPOVER_W - 2 * PAD;
const NAME_W = ROW_W - GLYPH_W - LEVEL_W - SWITCH_W - 3 * PAD;
const LEAD_NAME_W = ROW_W - GLYPH_W - 2 * PAD;
/** Volume presets on the digits, the same five the palette offers. */
export const PRESETS = [0, 25, 50, 75, 100];

export const deviceGlyph = (d: AudioDevice): string => {
  if (d.kind === "input") return d.muted ? GLYPH.micMuted : GLYPH.input;
  if (d.muted) return GLYPH.muted;
  return d.transport === "bluetooth" ? GLYPH.headphones : GLYPH.output;
};

/** "Bluetooth · muted · 40%": what the device is, over its name. Only the parts it can answer. */
const subtitle = (d: AudioDevice): string => {
  const parts = [d.transport, d.muted === true ? "muted" : undefined, d.volume === null ? undefined : `${d.volume}%`];
  return parts.filter((x): x is string => !!x).join(" · ") || (d.kind === "output" ? "Output" : "Input");
};

/**
 * The device in use, as a card: the glyph and the name, then the level on
 * its own line — a slider a click sets anywhere along it, the number, and
 * the mute switch. A device the backend gives no level for (an HDMI sink,
 * some USB interfaces) gets no slider rather than a dead one at zero.
 */
function lead(d: AudioDevice): ViewNode {
  const level = d.volume ?? 0;
  const muted = d.muted === true;
  const kids: ViewNode[] = [
    row([
      text(deviceGlyph(d), { key: "g", style: "glyph", size: "lg", width: GLYPH_W }),
      column([
        text(d.name, { key: "n", style: "title", size: "sm", width: LEAD_NAME_W }),
        text(subtitle(d), { key: "s", style: "muted", size: "xs", width: LEAD_NAME_W }),
      ], { key: "name", gap: 0 }),
    ], { key: "who", gap: 1, align: "center", minHeight: 30 }),
  ];
  if (d.volume !== null) {
    kids.push(row([
      { type: "slider", key: "level", value: muted ? 0 : level / 100, width: SLIDER_W, color: muted ? "grey" : "green", action: "set", label: `${d.name} volume` },
      text(muted ? "muted" : `${level}%`, { key: `v-${muted ? "m" : level}`, style: "mono", size: "xs", color: "muted", width: LEVEL_W + 12, align: "end", transition: { enter: "fade", exit: "none" } }),
      { type: "spacer" },
      { type: "switch", key: "mute", on: !muted, action: "mute", label: `${d.name} sound` },
    ], { key: "level-row", gap: 2, align: "center", minHeight: 26 }));
  } else if (d.muted !== null) {
    kids.push(row([text(muted ? "Muted" : "On", { key: "m", style: "muted", size: "xs" }), { type: "spacer" }, { type: "switch", key: "mute", on: !muted, action: "mute", label: `${d.name} sound` }], { key: "level-row", gap: 2, align: "center", minHeight: 26 }));
  }
  return column(kids, { key: "lead", gap: 1, padding: 2, surface: "elevated", radius: true });
}

/** One of the devices you could switch to: a click or Enter makes it the default for its direction. */
function deviceRow(d: AudioDevice, focused: boolean): ViewNode {
  return row([
    text(deviceGlyph(d), { key: "g", style: "glyph", size: "sm", color: "muted", width: GLYPH_W }),
    column([
      text(d.name, { key: "n", style: "body", size: "sm", weight: focused ? "semibold" : "regular", width: NAME_W }),
      ...(d.transport ? [text(d.transport, { key: "t", style: "muted", size: "xs", width: NAME_W })] : []),
    ], { key: "name", gap: 0, grow: true }),
    text(d.volume === null ? "" : `${d.volume}%`, { key: "v", style: "mono", size: "xs", color: "muted", width: LEVEL_W, align: "end" }),
  ], { key: `dev-${d.id}`, gap: 1, padding: 1, radius: true, minHeight: 26, action: `focus:${d.id}`, ...(focused && { selected: true }) });
}

/** The other direction in one line: what it is and whether it is muted, with the key that fixes it. */
function otherLine(d: AudioDevice, kind: BarKind): ViewNode {
  const muted = d.muted === true;
  const what = kind === "output" ? "Input" : "Output";
  return row([
    text(deviceGlyph(d), { key: "g", style: "glyph", size: "sm", color: muted ? "red" : "muted", width: GLYPH_W }),
    text(`${what}: ${d.name}`, { key: "n", style: "muted", size: "xs", width: ROW_W - GLYPH_W - 80 }),
    { type: "spacer" },
    ...(muted ? [{ type: "badge", key: "b", text: "muted", color: "red" } as ViewNode] : []),
  ], { key: "other", gap: 1, align: "center", minHeight: 20 });
}

function hints(st: BarState): ViewNode {
  const cur = st.devices[st.focus];
  const lead = st.devices.find((d) => d.default);
  return row([
    ...(cur && !cur.default ? keyHint("enter", "use") : []),
    ...(lead?.muted !== null ? keyHint("m", "mute") : []),
    ...(lead?.volume !== null ? [...keyHint(["-", "+"], "volume"), ...keyHint("0…4", "preset")] : []),
    { type: "spacer" },
    ...keyHint("p", "pal"),
  ], { key: "hints", gap: 1, minHeight: 22 });
}

export function actions(st: BarState): Action[] {
  const cur = st.devices[st.focus];
  const lead = st.devices.find((d) => d.default);
  const dir = st.kind === "output" ? "output" : "input";
  // Only the devices that get a row: the one in use leads the card instead, so a click action for it would reach nothing.
  const clicks: Action[] = st.devices.filter((d) => !d.default).map((d): Action => ({ id: `focus:${d.id}`, title: `Go to ${d.name}`, hidden: true }));
  return [
    ...(cur && !cur.default ? [{ id: "use", title: `Use ${cur.name} as ${dir}` }] : []),
    ...(lead && lead.muted !== null ? [{ id: "mute", title: lead.muted ? `Unmute ${lead.name}` : `Mute ${lead.name}`, shortcut: ["m", "cmd+m"] } as Action] : []),
    ...(lead && lead.volume !== null ? [
      { id: "up", title: "Louder", shortcut: ["+", "="] } as Action,
      { id: "down", title: "Quieter", shortcut: "-" } as Action,
    ] : []),
    { id: "open-pal", title: "Open in pal", shortcut: "p" },
    // The slider's own click, which arrives with the fraction in `ctx.values.value`: no key, so it stays out of the list.
    ...(lead && lead.volume !== null ? [{ id: "set", title: "Set the volume", hidden: true } as Action] : []),
    // The digits are presets, so the cursor keys are the arrows alone.
    ...(lead && lead.volume !== null ? PRESETS.map((p, i): Action => ({ id: `preset:${p}`, title: `Set ${p}%`, shortcut: `${i}`, hidden: true })) : []),
    { id: "next", title: "Next device", shortcut: ["down", "j"], hidden: true },
    { id: "prev", title: "Previous device", shortcut: ["up", "k"], hidden: true },
    ...clicks,
  ];
}

export function render(st: BarState): View {
  const d = st.devices.find((x) => x.default);
  const others = st.devices.filter((x) => !x.default);
  const what = st.kind === "output" ? "Output" : "Input";
  let tree: ViewNode;
  if (!d) {
    tree = column([
      { type: "tile", key: "none", width: 48, height: 48, text: st.kind === "output" ? GLYPH.muted : GLYPH.micMuted, color: "red", fill: "soft" },
      text(`No ${st.kind} device`, { style: "title", key: "none-t" }),
      text("Nothing is plugged in, or the audio backend did not answer", { style: "muted", size: "sm", align: "center" }),
      row([...keyHint("p", "pal")], { key: "hints", gap: 1, minHeight: 22 }),
    ], { key: "compact", padding: 3, gap: 2, align: "center" });
  } else {
    tree = column([
      lead(d),
      ...(others.length
        ? [column([
            row([text(`Other ${st.kind}s`, { key: "h", style: "muted", size: "xs", weight: "semibold" }), { type: "spacer" }, ...keyHint(["up", "down"], "move")], { key: "oh", gap: 1, minHeight: 14 }),
            column(others.map((x) => deviceRow(x, st.devices[st.focus]?.id === x.id)), { key: "others", gap: 0, surface: "sunken", radius: true }),
          ], { key: "other-devices", gap: 1 })]
        : []),
      ...(st.other ? [{ type: "divider", key: "div" } as ViewNode, otherLine(st.other, st.kind)] : []),
      hints(st),
    ], { key: "compact", padding: 3, gap: 2 });
  }
  const title = d ? `${what}: ${d.name}` : `No ${st.kind}`;
  return { tree, actions: actions(st), title, id: st.kind === "output" ? "volume" : "microphone", keys: "actions" };
}
