// Speedtest's trees, pure (no host): the view over a run in flight or the
// last result, and the trend over the history. index.ts pushes them; the
// store fixture draws them at its own clock.
import { clock, dayName, now as clockNow, when, type Action, type View, type ViewNode } from "@zcag/pal";
import { INSTALL, ms, speed, TITLE, type Run, type Tool, type ToolId } from "./tools.ts";

export const VIEW_ID = "speedtest";
/** A phase of speedtest-cli or fast reports no progress: the bar estimates from the elapsed time over this long, and stops short of full. */
const PHASE_ESTIMATE_MS = 12_000;

/** A run and, while it is in flight, its process; `phaseAt` is when the phase began (the estimate's start). */
export type Live = { run: Run; proc?: Bun.Subprocess; phaseAt: number; ticker?: ReturnType<typeof setInterval>; done: Promise<void> };
export const runId = (r: Run) => `run:${r.startedAt}`;

export const running = (r: Run) => !r.endedAt && r.phase !== "done" && r.phase !== "failed";
const elapsed = (from: number, now: number) => `${Math.round((now - from) / 1000)} s`;

/** The bar's fill for a phase: the tool's fraction, else the elapsed time over `PHASE_ESTIMATE_MS`, stopping short of full. */
function fill(l: Live, phase: "download" | "upload", now: number): number {
  const r = l.run;
  if (r.phase === "done") return 1;
  const order = ["starting", "ping", "download", "upload"];
  const at = order.indexOf(r.phase), mine = order.indexOf(phase);
  if (at < 0 || at < mine) return 0;
  if (at > mine) return 1;
  return r.progress ?? Math.min(0.95, (now - l.phaseAt) / PHASE_ESTIMATE_MS);
}

const STATUS: Record<Run["phase"], { text: string; color: "grey" | "blue" | "green" | "red" | "amber" }> = {
  starting: { text: "starting", color: "amber" }, ping: { text: "measuring ping", color: "amber" }, download: { text: "downloading", color: "blue" }, upload: { text: "uploading", color: "green" }, done: { text: "done", color: "green" }, failed: { text: "failed", color: "red" },
};

function gauge(label: string, value: number | undefined, fillValue: number, color: "blue" | "green", key: string): ViewNode {
  return {
    type: "stack", direction: "row", gap: 3, align: "center", key, children: [
      { type: "text", value: label, style: "muted", width: 80 },
      { type: "progress", value: fillValue, color },
      { type: "text", value: speed(value), style: "number", size: "xl", weight: "semibold", width: 72, align: "end" },
      { type: "text", value: "Mbps", style: "muted", size: "sm", width: 40 },
    ],
  };
}

/** The whole view: the head (tool, server, ISP, status), the two gauges, the ping tiles, the foot line, with the actions the state allows. */
export function spec(l: Live | undefined, found: Tool[], now = clockNow()): View {
  const r = l?.run;
  const busy = !!r && running(r);
  const tool = found[0];
  const head: ViewNode[] = [
    { type: "badge", text: r ? TITLE[r.tool] : tool ? tool.title : "no tool", color: r || tool ? "grey" : "red" },
    { type: "text", value: [r?.server, r?.isp].filter(Boolean).join(" · ") || (r ? "" : tool ? "Press Enter to start" : "Install one of the tools below"), style: "muted", size: "sm" },
    { type: "spacer" },
    ...(r ? [{ type: "badge", text: STATUS[r.phase].text, color: STATUS[r.phase].color } as ViewNode] : []),
  ];
  const ping: ViewNode = {
    type: "stack", direction: "row", gap: 2, align: "center", key: "ping", children: [
      { type: "text", value: "Ping", style: "muted", width: 80 },
      { type: "tile", width: 96, height: 44, text: ms(r?.ping), sub: "latency", color: r?.phase === "ping" && busy ? "amber" : "neutral" },
      { type: "tile", width: 96, height: 44, text: ms(r?.jitter), sub: "jitter", color: "neutral" },
      ...(r?.packetLoss !== undefined ? [{ type: "tile", width: 96, height: 44, text: `${r.packetLoss}%`, sub: "loss", color: r.packetLoss > 0 ? "amber" : "neutral" } as ViewNode] : []),
    ],
  };
  const foot: ViewNode[] = [];
  if (!r && !tool) {
    foot.push({ type: "text", value: "No speed test tool is installed. One of:", style: "muted", size: "sm" });
    for (const id of Object.keys(INSTALL) as ToolId[]) foot.push({ type: "text", value: `${TITLE[id]}:  ${INSTALL[id]}`, style: "mono", size: "sm" });
  } else if (busy) foot.push({ type: "text", value: `${elapsed(r!.startedAt, now)} · Enter stops`, style: "muted", size: "sm" });
  else if (r?.phase === "failed") foot.push({ type: "text", value: `Failed: ${r.error ?? "unknown"} · Enter runs again`, color: "destructive", size: "sm" });
  else if (r) foot.push({ type: "text", value: `${when(r.startedAt, now)}${r.endedAt ? ` · ${elapsed(r.startedAt, r.endedAt)}` : ""} · Enter runs again, cmd+Enter copies${r.url ? ", cmd+o opens the result" : ""}`, style: "muted", size: "sm" });
  else foot.push({ type: "text", value: `${tool!.title}${found.length > 1 ? ` (also ${found.slice(1).map((t) => t.title).join(", ")})` : ""} · nothing runs until Enter`, style: "muted", size: "sm" });
  const actions: Action[] = busy
    ? [{ id: "stop", title: "Stop the test" }, { id: "copy", title: "Copy result" }, { id: "history", title: "History", shortcut: "cmd+h" }]
    : [
        { id: "start", title: !tool ? "Look for a tool again" : r ? "Run again" : "Start the test" },
        { id: "copy", title: "Copy result" },
        ...(r?.url ? [{ id: "open", title: "Open the result page", shortcut: "cmd+o" }] : []),
        { id: "history", title: "History", shortcut: "cmd+h" },
      ];
  return {
    id: VIEW_ID,
    title: "Speed test",
    actions,
    tree: {
      type: "stack", direction: "column", gap: 3, padding: 4, children: [
        { type: "stack", direction: "row", gap: 2, align: "center", key: "head", children: head },
        { type: "stack", direction: "column", gap: 3, padding: 4, surface: "elevated", radius: true, key: "gauges", children: [
          gauge("Download", r?.download, l ? fill(l, "download", now) : 0, "blue", "down"),
          gauge("Upload", r?.upload, l ? fill(l, "upload", now) : 0, "green", "up"),
          ping,
        ] },
        { type: "stack", direction: "column", gap: 1, key: "foot", children: foot },
      ],
    },
  };
}

/** The last runs as bars: one row per run, download in blue and upload in green, each against the best of its own. */
export function trend(list: Run[]): View {
  const shown = list.slice(0, 20).reverse();
  const maxDown = Math.max(1, ...shown.map((r) => r.download ?? 0)), maxUp = Math.max(1, ...shown.map((r) => r.upload ?? 0));
  const rows: ViewNode[] = shown.map((r) => ({
    type: "stack", direction: "row", gap: 2, align: "center", key: runId(r), children: [
      { type: "text", value: `${dayName(r.startedAt)} ${clock(r.startedAt)}`, style: "muted", size: "xs", width: 96 },
      { type: "progress", value: (r.download ?? 0) / maxDown, color: "blue", width: 220 },
      { type: "text", value: `↓ ${speed(r.download)}`, style: "number", size: "sm", width: 64 },
      { type: "progress", value: (r.upload ?? 0) / maxUp, color: "green", width: 120 },
      { type: "text", value: `↑ ${speed(r.upload)}`, style: "number", size: "sm", width: 64 },
      { type: "text", value: ms(r.ping), style: "muted", size: "xs", width: 56, align: "end" },
    ],
  }));
  return {
    id: "trend",
    title: `Last ${shown.length} runs`,
    actions: [{ id: "copy_all", title: "Copy as text" }],
    tree: { type: "stack", direction: "column", gap: 2, padding: 4, children: [
      { type: "stack", direction: "row", gap: 2, children: [{ type: "text", value: "Mbps, oldest first", style: "muted", size: "xs" }, { type: "spacer" }, { type: "text", value: `best ↓ ${speed(maxDown)} · ↑ ${speed(maxUp)} Mbps`, style: "muted", size: "xs" }] },
      { type: "stack", direction: "column", gap: 2, padding: 3, surface: "sunken", radius: true, children: rows },
    ] },
  };
}
