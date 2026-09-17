// The compact battery/power popover.  It deliberately reads the same snapshot
// as the palette: the battery gauge tells how long the machine has, while the
// optional `power` watcher explains why it is draining.
import { column, keyHint, POPOVER_W, row, text, type Action, type View, type ViewNode } from "@zcag/pal";

export type PowerPopover = {
  percent: number;
  source: string;
  status: string;
  remaining?: string;
  watts?: number;
  alerts: { rule: string; level: "warn" | "crit"; message?: string }[];
  blame: [string, number, string][];
};

const colour = (s: PowerPopover) => s.alerts.some((a) => a.level === "crit") || (s.source === "Battery Power" && s.percent <= 10) ? "red" as const
  : s.alerts.length || (s.source === "Battery Power" && s.percent <= 20) ? "amber" as const : "green" as const;

export function renderPowerPopover(s: PowerPopover): View {
  const details = [s.source, s.status, s.remaining, s.watts === undefined ? undefined : `${s.watts.toFixed(1)} W draw`].filter(Boolean).join(" · ");
  const alerts: ViewNode[] = s.alerts.length
    ? [row(s.alerts.map((a) => ({ type: "badge", key: `alert-${a.rule}`, text: a.message ?? a.rule, color: a.level === "crit" ? "red" : "amber" })), { key: "alerts", gap: 1, minHeight: 20 })]
    : [text("No power warnings", { key: "quiet", style: "muted", size: "xs" })];
  const blame: ViewNode[] = s.blame.length
    ? [
        text("Top consumers right now", { key: "blame-title", style: "muted", size: "xs", weight: "semibold" }),
        ...s.blame.slice(0, 3).map(([name, share], n) => row([
          text(name, { key: `blame-name-${n}`, style: "body", size: "sm", width: POPOVER_W - 72 }),
          text(`${Math.round(share)}%`, { key: `blame-share-${n}`, style: "number", size: "xs", width: 36, align: "end" }),
        ], { key: `blame-${n}`, gap: 2 })),
      ]
    : [];
  const actions: Action[] = [{ id: "settings", title: "Open Battery settings", shortcut: "enter" }];
  return {
    title: "Battery",
    id: "power",
    keys: "actions",
    actions,
    tree: column([
      row([text(`${s.percent}%`, { key: "percent", style: "title", size: "xl", width: 66 }), text("Battery", { key: "title", style: "body", weight: "semibold" }), { type: "spacer" }, { type: "badge", key: "source", text: s.source === "Battery Power" ? "on battery" : "on power", color: colour(s) }], { key: "head", gap: 2 }),
      { type: "progress", key: "level", value: s.percent / 100, color: colour(s) },
      text(details, { key: "details", style: "muted", size: "sm" }),
      ...alerts,
      ...blame,
      row([...keyHint("enter", "Battery Settings", { action: "settings" })], { key: "footer", gap: 1, minHeight: 20 }),
    ], { key: "power", padding: 3, gap: 2 }),
  };
}
