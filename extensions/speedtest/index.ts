// Speedtest: a view palette. Opening it draws the last result and which
// tool is installed (Ookla's `speedtest`, `speedtest-cli`, or `fast`;
// hints naming the brew formulas when none is); nothing runs until Enter.
// Enter spawns the tool and the view follows its stream through
// `view.update`: a progress bar per direction with the live figure, the
// ping and jitter tiles, the server and the ISP (tools.ts reads each
// tool's output). Enter while it runs stops it. A finished run is one line
// on the clipboard (cmd+Enter) and lands in the History palette (storage),
// whose first row draws the last runs as bars.
import { settings, storage, view as viewApi, type Action, type Effect, type Extension, type Item, type View, type ViewNode } from "@zcag/pal";
import { argv, detect, feed, finish, INSTALL, ms, speed, start, summary, TITLE, type Run, type Tool, type ToolId } from "./tools.ts";

/** `[extensions.speedtest]`, defaults in pal.json. */
type Settings = { tool: ToolId | "auto"; server: string; keep: number };

const GLYPH = {
  gauge: "\u{f04c5}", // md-speedometer
  history: "\u{f02da}", // md-history
  chart: "\u{f012a}", // md-chart_line
  broom: "\u{f00e2}", // md-broom
  hint: "\u{f02fd}", // md-information_outline
};

const EXT = "speedtest", PALETTE = "speedtest", VIEW_ID = "speedtest";
const RUNS = "runs";
/** A phase of speedtest-cli or fast reports no progress: the bar estimates from the elapsed time over this long, and stops short of full. */
const PHASE_ESTIMATE_MS = 12_000;
const TIMEOUT_MS = 120_000;
const S = () => settings.get<Settings>();

// ---- the run in flight ------------------------------------------------------------------------

type Live = { run: Run; proc?: Bun.Subprocess; phaseAt: number; ticker?: ReturnType<typeof setInterval>; done: Promise<void> };
let live: Live | undefined;
/** What the last look found: `view` looks again on every open (three `which`es and one `--version`, milliseconds), so a tool installed meanwhile shows up. */
let tools: Tool[] = [];
const findTools = async () => (tools = await detect(S().tool ?? "auto"));

const push = (spec: View) => viewApi.update(spec, { palette: PALETTE, id: VIEW_ID, extension: EXT }).catch(() => {});

async function remember(r: Run): Promise<void> {
  const list = ((await storage.get<Run[]>(RUNS)) ?? []).filter((x) => x && typeof x.startedAt === "number");
  list.unshift(r);
  await storage.set(RUNS, list.slice(0, Math.max(1, S().keep || 30)));
}

/** Spawns the tool in its own group; every chunk it prints feeds the run and pushes the view, the end lands in the history. */
function launch(t: Tool): Live {
  const run = start(t.id);
  const proc = Bun.spawn(argv(t, S().server ?? ""), { stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true, env: { ...process.env, TERM: "dumb", NO_COLOR: "1" } });
  const l: Live = { run, proc, phaseAt: run.startedAt, done: Promise.resolve() };
  const read = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      if (run.endedAt) return;
      const before = run.phase;
      feed(run, new TextDecoder().decode(chunk));
      if (run.phase !== before) l.phaseAt = Date.now();
      if (live === l) push(spec(l));
    }
  };
  read(proc.stdout as ReadableStream<Uint8Array>).catch(() => {});
  read(proc.stderr as ReadableStream<Uint8Array>).catch(() => {});
  const timer = setTimeout(() => { if (!run.endedAt) { run.error = "took over two minutes"; stop(l); } }, TIMEOUT_MS);
  l.ticker = setInterval(() => { if (live === l && !run.endedAt) push(spec(l)); }, 1000);
  // The exit ends the run; a child the tool left behind may hold the pipes open, so the streams are not waited for.
  l.done = proc.exited.then(async (code) => {
    clearTimeout(timer);
    clearInterval(l.ticker);
    finish(run, proc.signalCode ? null : code);
    if (live === l) push(spec(l));
    if (run.phase === "done") await remember(run);
  });
  return l;
}

/** SIGTERM to the tool's group (a shell wrapper's children included), SIGKILL a second later if it is still there. */
function stop(l: Live): void {
  if (l.run.endedAt || !l.proc) return;
  l.run.error ??= "stopped";
  const kill = (sig: NodeJS.Signals) => { try { process.kill(-l.proc!.pid, sig); } catch {} try { l.proc!.kill(sig); } catch {} };
  kill("SIGTERM");
  setTimeout(() => { if (!l.run.endedAt) kill("SIGKILL"); }, 1000);
}

// A view level opened while a run was in flight gets the current state (the push may have gone out before the level reported itself).
viewApi.onShown((ev) => { if (live && ev.palette === PALETTE) push(spec(live)); }, EXT);

// ---- the tree ---------------------------------------------------------------------------------

const running = (r: Run) => !r.endedAt && r.phase !== "done" && r.phase !== "failed";
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
export function spec(l: Live | undefined, now = Date.now(), found: Tool[] = tools): View {
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
  else if (r) foot.push({ type: "text", value: `${new Date(r.startedAt).toLocaleString()}${r.endedAt ? ` · ${elapsed(r.startedAt, r.endedAt)}` : ""} · Enter runs again, cmd+Enter copies${r.url ? ", cmd+o opens the result" : ""}`, style: "muted", size: "sm" });
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

// ---- the palette ------------------------------------------------------------------------------

/** The last finished run, for a fresh open: the view shows it until Enter. */
async function lastRun(): Promise<Live | undefined> {
  if (live) return live;
  const r = ((await storage.get<Run[]>(RUNS)) ?? [])[0];
  return r ? { run: r, phaseAt: r.startedAt, done: Promise.resolve() } : undefined;
}

async function view(): Promise<View> {
  await findTools();
  return spec(await lastRun(), Date.now());
}

async function pick(_id: string, action?: string): Promise<Effect> {
  switch (action) {
    case "stop": if (live) stop(live); return { view: spec(live) };
    case "copy": {
      const l = await lastRun();
      if (!l || running(l.run)) return { keep: true, toast: { title: l ? "Still measuring" : "No result yet", message: l ? "Copy once it has finished" : "Enter runs a test" } };
      return { copy: summary(l.run) };
    }
    case "open": { const l = await lastRun(); return l?.run.url ? { open: l.run.url } : { keep: true, toast: { title: "No result page", message: "Only Speedtest by Ookla gives one" } }; }
    case "history": return { push: { extension: EXT, palette: "history" } };
    default: {
      if (live && running(live.run)) { stop(live); return { view: spec(live) }; }
      const found = await findTools();
      if (!found.length) return { view: spec(undefined, Date.now(), found) };
      live = launch(found[0]);
      return { view: spec(live) };
    }
  }
}

// ---- history --------------------------------------------------------------------------------

const runs = async (): Promise<Run[]> => ((await storage.get<Run[]>(RUNS)) ?? []).filter((x) => x && typeof x.startedAt === "number");
const runId = (r: Run) => `run:${r.startedAt}`;
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The last runs as bars: one row per run, download in blue and upload in green, each against the best of its own. */
export function trend(list: Run[]): View {
  const shown = list.slice(0, 20).reverse();
  const maxDown = Math.max(1, ...shown.map((r) => r.download ?? 0)), maxUp = Math.max(1, ...shown.map((r) => r.upload ?? 0));
  const rows: ViewNode[] = shown.map((r) => ({
    type: "stack", direction: "row", gap: 2, align: "center", key: runId(r), children: [
      { type: "text", value: `${day(r.startedAt)} ${new Date(r.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`, style: "muted", size: "xs", width: 96 },
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

async function historyRows(): Promise<Item[]> {
  const list = await runs();
  if (!list.length) return [{ id: "hint:empty", name: "No runs yet", subtitle: "A finished test lands here", icon: GLYPH.history, actions: [] }];
  const out: Item[] = [{ id: "trend", name: `Trend: the last ${Math.min(20, list.length)} runs`, subtitle: "Download and upload as bars", icon: GLYPH.chart, actions: [{ id: "trend", title: "Show the trend" }] }];
  for (const r of list) out.push({
    id: runId(r), name: `↓ ${speed(r.download)} Mbps  ↑ ${speed(r.upload)} Mbps  ·  ${ms(r.ping)}`, subtitle: [r.server, r.isp, TITLE[r.tool]].filter(Boolean).join(" · "), icon: GLYPH.gauge, accessories: [{ date: r.startedAt }],
    detail: { markdown: `**${summary(r)}**`, metadata: [{ label: "When", value: new Date(r.startedAt).toLocaleString() }, { label: "Tool", value: TITLE[r.tool] }, ...(r.ip ? [{ label: "IP", value: r.ip }] : []), ...(r.url ? [{ label: "Result", link: { text: r.url.replace(/^https?:\/\//, ""), href: r.url } }] : [])] },
    actions: [{ id: "copy", title: "Copy result" }, ...(r.url ? [{ id: "open", title: "Open the result page", shortcut: "cmd+o" }] : []), { id: "remove", title: "Remove", shortcut: "cmd+d", style: "destructive" }],
  });
  out.push({ id: "clear", name: "Clear history", subtitle: `${list.length} ${list.length === 1 ? "run" : "runs"}`, icon: GLYPH.broom, actions: [{ id: "clear", title: "Clear history", style: "destructive", confirm: "Forget every run?" }] });
  return out;
}

async function historyPick(id: string, action?: string): Promise<Effect> {
  const list = await runs();
  if (id === "trend" || action === "copy_all") return action === "copy_all" ? { copy: list.map((r) => `${new Date(r.startedAt).toLocaleString()}  ${summary(r)}`).join("\n") } : { view: trend(list) };
  if (id === "clear") { await storage.remove(RUNS); return { keep: true, toast: { title: "History cleared" } }; }
  const r = list.find((x) => runId(x) === id);
  if (!r) return { keep: true, toast: { title: "Run is gone", style: "failure" } };
  switch (action) {
    case "open": return r.url ? { open: r.url } : { keep: true };
    case "remove": await storage.set(RUNS, list.filter((x) => x !== r)); return { keep: true, toast: { title: "Removed" } };
    default: return { copy: summary(r) };
  }
}

export default {
  palettes: {
    speedtest: {
      title: "Speedtest",
      // The panel shown again with the level kept redraws from the run in flight or the last result.
      on: ["show"],
      view,
      pick,
    },
    history: {
      title: "Speedtest History",
      live: true,
      placeholder: "Search past runs",
      list: historyRows,
      pick: historyPick,
    },
  },
  dispose: () => { if (live) stop(live); },
} satisfies Extension;
