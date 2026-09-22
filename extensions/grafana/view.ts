// The alerts bar popover as a render tree (`View` in `@zcag/pal`), pure:
// index.ts fetches, this draws the state the tests pass in. Firing then
// pending, each instance a row with a colour rail (red, amber, grey once
// silenced), the rule's name, the summary under it, the severity and the
// age; a cursor (`selected`) the arrows move and a click sets; the keys
// as keycap hints. Nothing firing is one calm line. The shape GitHub's
// and Gmail's popovers take.
import { POPOVER_W, ago, column, keyHint, row, text, type Action, type TagColor, type View, type ViewNode } from "@zcag/pal";
import { DURATIONS, type AlertInstance, labelsLine } from "./api.ts";

export type BarState = {
  /** Firing first, then pending (`instances()` orders them). */
  rows: AlertInstance[];
  /** Which row the keys act on. */
  focus: number;
  /** For the ages. */
  now: number;
  /** The instance's title, when it has one ("Work"): on the view's title. */
  account?: string;
};

/** A row's inside: its own padding of one step a side, the rail, the age column and the two gaps between them. */
const ROW_PAD = 8, RAIL_W = 4, RAIL_H = 34, AGE_W = 36, GAP = 8;
const TEXT_W = POPOVER_W - ROW_PAD - RAIL_W - GAP - AGE_W - GAP;

export const SEVERITY: Record<string, TagColor> = { critical: "red", error: "red", warning: "amber", warn: "amber", info: "blue", notice: "blue" };

function header(key: string, title: string, n: number, color: TagColor): ViewNode {
  return row([text(title, { size: "xs", weight: "semibold", color: "muted" }), { type: "badge", key: "n", text: String(n), color }], { key: `h-${key}`, gap: 1, minHeight: 22 });
}

function alertRow(a: AlertInstance, focused: boolean, st: BarState): ViewNode {
  const rail: TagColor = a.silencedBy.length ? "grey" : a.state === "firing" ? "red" : "amber";
  const meta: ViewNode[] = [text(a.summary || labelsLine(a.labels) || a.folder, { size: "xs", color: "muted", minWidth: 0 })];
  if (a.severity) meta.push({ type: "badge", key: "sev", text: a.severity, color: SEVERITY[a.severity] ?? "grey" });
  if (a.silencedBy.length) meta.push({ type: "badge", key: "sil", text: "silenced", color: "grey" });
  return row(
    [
      { type: "tile", key: "rail", width: RAIL_W, height: RAIL_H, color: rail, fill: "solid" },
      column([text(a.rule, { size: "md", weight: focused ? "semibold" : "medium", width: TEXT_W }), row(meta, { key: "meta", gap: 1, minHeight: 16 })], { key: "body", gap: 0, grow: true }),
      text(a.since ? ago(a.since, { now: st.now, short: true }) : "", { style: "mono", size: "xs", color: "muted", width: AGE_W, align: "end" }),
    ],
    { key: a.id, padding: 1, radius: true, action: `focus:${a.id}`, ...(focused && { selected: true }), transition: { enter: "fade", exit: "fade" } },
  );
}

function hints(cur: AlertInstance | undefined): ViewNode {
  const kids: ViewNode[] = cur
    ? [...keyHint("enter", "rule"), ...keyHint("o", "dashboard"), ...keyHint("s", cur.silencedBy.length ? "unsilence" : "silence 1 h"), ...keyHint("c", "copy"), ...keyHint("p", "pal"), ...keyHint(["up", "down"], "move")]
    : [...keyHint("a", "alert list"), ...keyHint("p", "pal"), ...keyHint("r", "refresh")];
  return row(kids, { key: "hints", gap: 1, minHeight: 22 });
}

function empty(): ViewNode {
  return column(
    [
      { type: "tile", key: "tile", width: 48, height: 48, text: "✓", color: "green", fill: "soft" },
      text("All quiet", { style: "title", size: "lg" }),
      text("No alert is firing or pending", { style: "muted", size: "sm", align: "center" }),
    ],
    { key: "empty", padding: 5, gap: 2, align: "center", justify: "center" },
  );
}

/** Every action the popover answers to; the first listed is Enter. The per-row focus actions are hidden, reached by a click on the row. */
export function actions(st: BarState): Action[] {
  const cur = st.rows[st.focus];
  const silences: Action[] = cur
    ? cur.silencedBy.length
      ? [{ id: "unsilence", title: "Expire the silence", shortcut: ["s", "u"], confirm: `Expire the silence on ${cur.rule}? It will page again.` }]
      : Object.entries(DURATIONS).map(([k, d], i): Action => ({ id: `silence:${k}`, title: `Silence for ${d.title}`, shortcut: ["s", "f", "d"][i], confirm: `Silence ${cur.rule} (${labelsLine(cur.labels) || "every instance"}) for ${d.title}?` }))
    : [];
  return [
    ...(cur ? [{ id: "open", title: "Open the rule in Grafana" } as Action] : [{ id: "site", title: "Open the alert list in Grafana", shortcut: "a" } as Action]),
    ...(cur ? [{ id: "dashboard", title: cur.dashboardUrl ? "Open the dashboard" : "Open the alert list", shortcut: "o" } as Action] : []),
    ...silences,
    ...(cur ? [{ id: "copy", title: "Copy the summary", shortcut: ["c", "cmd+c"] } as Action] : []),
    { id: "pal", title: "Open Grafana Alerts in pal", shortcut: "p" },
    { id: "refresh", title: "Refresh", shortcut: "r" },
    ...(cur ? [{ id: "site", title: "Open the alert list in Grafana", shortcut: "a" } as Action] : []),
    { id: "down", title: "Next row", shortcut: ["down", "j"], hidden: true },
    { id: "up", title: "Previous row", shortcut: ["up", "k"], hidden: true },
    ...st.rows.map((a): Action => ({ id: `focus:${a.id}`, title: `Focus ${a.rule}`, hidden: true })),
  ];
}

export function render(st: BarState): View {
  const focus = Math.min(Math.max(0, st.focus), Math.max(0, st.rows.length - 1));
  const firing = st.rows.filter((a) => a.state === "firing"), pending = st.rows.filter((a) => a.state === "pending");
  const kids: ViewNode[] = [];
  if (!st.rows.length) kids.push(empty());
  let i = 0;
  if (firing.length) kids.push(header("firing", "Firing", firing.length, "red"), ...firing.map((a) => alertRow(a, i++ === focus, st)));
  if (pending.length) kids.push(header("pending", "Pending", pending.length, "amber"), ...pending.map((a) => alertRow(a, i++ === focus, st)));
  kids.push({ type: "divider", key: "rule" }, hints(st.rows[focus]));
  const silenced = st.rows.filter((a) => a.silencedBy.length).length;
  const parts = [firing.length - silenced > 0 && `${firing.length - silenced} firing`, pending.length && `${pending.length} pending`, silenced && `${silenced} silenced`].filter(Boolean);
  const title = `${parts.length ? parts.join(", ") : "Grafana alerts"}${st.account ? ` (${st.account})` : ""}`;
  return { tree: column(kids, { key: "compact", padding: 3, gap: 1 }), actions: actions({ ...st, focus }), title, id: "alerts", keys: "actions" };
}
