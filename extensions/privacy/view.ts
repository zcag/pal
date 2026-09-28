// The Camera & Microphone popover as a pure view tree: one row per app (or
// camera) using a sensor, cameras first, the focused one marked. index.ts
// keeps the focus; a click moves it, Enter brings the app forward (a camera
// with no app opens its privacy settings).
import { POPOVER_W, column, keyHint, row, text, type Action, type PrivacyUse, type View, type ViewNode } from "@zcag/pal";

export const GLYPH: Record<PrivacyUse["sensor"], string> = { camera: "\u{f05a0}", microphone: "\u{f036c}", screen: "\u{f0e51}" }; // md-webcam, md-microphone, md-monitor_share
export const SENSOR: Record<PrivacyUse["sensor"], string> = { camera: "Camera", microphone: "Microphone", screen: "Screen sharing" };

/** A use's stable key: the sensor with its app, pid or device. */
export const keyOf = (u: PrivacyUse) => `${u.sensor}:${u.pid ?? u.device ?? u.app ?? ""}`;
/** What the row is called: the app, else the camera, else the sensor. */
export const nameOf = (u: PrivacyUse) => u.app ?? u.device ?? SENSOR[u.sensor];
/** The line under it: the sensor, and the process or the camera when they add something. */
export const detailOf = (u: PrivacyUse) => [SENSOR[u.sensor], u.process, u.app ? u.device : null].filter(Boolean).join(" · ");

export type BarState = { uses: PrivacyUse[]; focus: number };

const ICON = 28, OUTER_PAD = 12, ROW_PAD = 8, GAP = 8;
const BODY_W = POPOVER_W - 2 * OUTER_PAD - ROW_PAD - ICON - GAP;

function mark(u: PrivacyUse): ViewNode {
  if (u.path) return { type: "image", key: "icon", src: `icon://localhost/app?path=${encodeURIComponent(u.path)}&size=64`, width: ICON, height: ICON, alt: u.app ?? "" };
  return { type: "tile", key: "icon", width: ICON, height: ICON, text: GLYPH[u.sensor], color: "amber", fill: "soft" };
}

function useRow(u: PrivacyUse, focused: boolean): ViewNode {
  const k = keyOf(u);
  return row(
    [
      mark(u),
      column([
        text(nameOf(u), { size: "md", weight: focused ? "semibold" : "medium", width: BODY_W }),
        text(detailOf(u), { size: "sm", color: "muted", width: BODY_W }),
      ], { key: "body", gap: 0 }),
    ],
    { key: k, padding: 1, minHeight: 42, radius: true, surface: focused ? "elevated" : undefined, selected: focused || undefined, action: `focus:${k}`, transition: { enter: "fade", exit: "fade" } },
  );
}

function empty(): ViewNode {
  return column(
    [
      { type: "tile", key: "zero", width: 48, height: 48, text: "✓", color: "green", fill: "soft" },
      text("Nothing is using the camera or microphone", { style: "title", key: "zero-t", align: "center" }),
    ],
    { key: "empty", padding: 5, gap: 2, align: "center", justify: "center" },
  );
}

/** Enter's title for a use: bring its app forward, or open the sensor's privacy settings. */
export const enterTitle = (u: PrivacyUse) => (u.path ? `Show ${u.app}` : "Open privacy settings");

function actions(cur: PrivacyUse | undefined, uses: PrivacyUse[]): Action[] {
  return [
    ...(cur ? [{ id: "show", title: enterTitle(cur), shortcut: "enter" } as Action] : []),
    { id: "settings", title: "Open Privacy & Security settings", shortcut: "s" },
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...uses.map((u): Action => ({ id: `focus:${keyOf(u)}`, title: `Focus ${nameOf(u)}`, hidden: true })),
  ];
}

export function render(st: BarState): View {
  const focus = Math.min(Math.max(0, st.focus), Math.max(0, st.uses.length - 1));
  const cur = st.uses[focus];
  const hints = row([...(cur ? keyHint("enter", cur.path ? "show app" : "settings") : []), ...keyHint("s", "privacy settings")], { key: "hints", gap: 1, minHeight: 22 });
  return {
    tree: column([...(st.uses.length ? [column(st.uses.map((u, i) => useRow(u, i === focus)), { key: "rows", gap: 0 })] : [empty()]), { type: "divider", key: "rule" }, hints], { key: "compact", padding: 3, gap: 2 }),
    actions: actions(cur, st.uses),
    title: "Camera & Microphone",
    id: "in-use",
    keys: "actions",
  };
}
