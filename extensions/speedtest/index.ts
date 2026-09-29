// Speedtest: a view palette. Opening it draws the last result and which
// tool is installed (Ookla's `speedtest`, `speedtest-cli`, or `fast`;
// hints naming the brew formulas when none is); nothing runs until Enter.
// Enter spawns the tool and the view follows its stream through
// `view.update`: a progress bar per direction with the live figure, the
// ping and jitter tiles, the server and the ISP (tools.ts reads each
// tool's output). Enter while it runs stops it. A finished run is one line
// on the clipboard (cmd+Enter) and lands in the History palette (storage),
// whose first row draws the last runs as bars.
import { clock, hint, isoDay, now as clockNow, settings, storage, toast, view as viewApi, when, type Ctx, type Effect, type Extension, type Item, type View } from "@zcag/pal";
import { argv, detect, feed, finish, ms, speed, start, summary, TITLE, type Run, type Tool, type ToolId, noteLine } from "./tools.ts";
import { type Live, runId, running, spec, trend, VIEW_ID } from "./view.ts";

/** `[extensions.speedtest]`, defaults in pal.json. */
type Settings = { tool: ToolId | "auto"; server: string; keep: number };

const GLYPH = {
  gauge: "\u{f04c5}", // md-speedometer
  history: "\u{f02da}", // md-history
  chart: "\u{f012a}", // md-chart_line
  broom: "\u{f00e2}", // md-broom
};

const EXT = "speedtest", PALETTE = "speedtest";
const RUNS = "runs";
const TIMEOUT_MS = 120_000;
const S = () => settings.get<Settings>();

// ---- the run in flight ------------------------------------------------------------------------

let live: Live | undefined;
/** What the last look found: `view` looks again on every open (three `which`es and one `--version`, milliseconds), so a tool installed meanwhile shows up. */
let tools: Tool[] = [];
const findTools = async () => (tools = await detect(S().tool ?? "auto"));

/** The view over a run (or none) with the tools the last look found. */
const draw = (l: Live | undefined, found = tools) => spec(l, found);
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
      const text = new TextDecoder().decode(chunk);
      feed(run, text);
      noteLine(run, text);
      if (run.phase !== before) l.phaseAt = clockNow();
      if (live === l) push(draw(l));
    }
  };
  read(proc.stdout as ReadableStream<Uint8Array>).catch(() => {});
  read(proc.stderr as ReadableStream<Uint8Array>).catch(() => {});
  const timer = setTimeout(() => { if (!run.endedAt) { run.error = "took over two minutes"; stop(l); } }, TIMEOUT_MS);
  l.ticker = setInterval(() => { if (live === l && !run.endedAt) push(draw(l)); }, 1000);
  // The exit ends the run; a child the tool left behind may hold the pipes open, so the streams are not waited for.
  l.done = proc.exited.then(async (code) => {
    clearTimeout(timer);
    clearInterval(l.ticker);
    finish(run, proc.signalCode ? null : code);
    if (live === l) push(draw(l));
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
viewApi.onShown((ev) => { if (live && ev.palette === PALETTE) push(draw(live)); }, EXT);

// ---- the palette ------------------------------------------------------------------------------

/** The last finished run, for a fresh open: the view shows it until Enter. */
async function lastRun(): Promise<Live | undefined> {
  if (live) return live;
  const r = ((await storage.get<Run[]>(RUNS)) ?? [])[0];
  return r ? { run: r, phaseAt: r.startedAt, done: Promise.resolve() } : undefined;
}

async function view(): Promise<View> {
  await findTools();
  return draw(await lastRun());
}

async function pick(_id: string, action?: string): Promise<Effect> {
  switch (action) {
    case "stop": if (live) stop(live); return { view: draw(live) };
    case "copy": {
      const l = await lastRun();
      if (!l || running(l.run)) return toast(l ? "Still measuring" : "No result yet", l ? "Copy once it has finished" : "Enter runs a test");
      return { copy: summary(l.run) };
    }
    case "open": { const l = await lastRun(); return l?.run.url ? { open: l.run.url } : toast("No result page", "Only Speedtest by Ookla gives one"); }
    case "history": return { push: { extension: EXT, palette: "history" } };
    default: {
      if (live && running(live.run)) { stop(live); return { view: draw(live) }; }
      const found = await findTools();
      if (!found.length) return { view: draw(undefined, found) };
      live = launch(found[0]);
      return { view: draw(live) };
    }
  }
}

// ---- history --------------------------------------------------------------------------------

const runs = async (): Promise<Run[]> => ((await storage.get<Run[]>(RUNS)) ?? []).filter((x) => x && typeof x.startedAt === "number");

async function historyRows(): Promise<Item[]> {
  const list = await runs();
  if (!list.length) return [hint("empty", "No runs yet", "A finished test lands here", { icon: GLYPH.history })];
  const out: Item[] = [{ id: "trend", name: `Trend: the last ${Math.min(20, list.length)} runs`, subtitle: "Download and upload as bars", icon: GLYPH.chart, actions: [{ id: "trend", title: "Show the trend" }] }];
  for (const r of list) out.push({
    id: runId(r), name: `↓ ${speed(r.download)} Mbps  ↑ ${speed(r.upload)} Mbps  ·  ${ms(r.ping)}`, subtitle: [r.server, r.isp, TITLE[r.tool]].filter(Boolean).join(" · "), icon: GLYPH.gauge, accessories: [{ date: r.startedAt }],
    detail: { markdown: `**${summary(r)}**`, metadata: [{ label: "When", value: when(r.startedAt) }, { label: "Tool", value: TITLE[r.tool] }, ...(r.ip ? [{ label: "IP", value: r.ip }] : []), ...(r.url ? [{ label: "Result", link: { text: r.url.replace(/^https?:\/\//, ""), href: r.url } }] : [])] },
    // Every action also takes marked runs (`multi`): one dated line each, their pages, one write.
    actions: [{ id: "copy", title: "Copy result", multi: true }, ...(r.url ? [{ id: "open", title: "Open the result page", shortcut: "cmd+o", multi: true as const }] : []), { id: "remove", title: "Remove", shortcut: "cmd+d", style: "destructive", multi: true }],
  });
  out.push({ id: "clear", name: "Clear history", subtitle: `${list.length} ${list.length === 1 ? "run" : "runs"}`, icon: GLYPH.broom, actions: [{ id: "clear", title: "Clear history", style: "destructive", confirm: "Forget every run?" }] });
  return out;
}

async function historyPick(id: string, action?: string, ctx?: Ctx): Promise<Effect> {
  const list = await runs();
  if (id === "trend" || action === "copy_all") return action === "copy_all" ? { copy: list.map((r) => `${isoDay(r.startedAt)} ${clock(r.startedAt)}  ${summary(r)}`).join("\n") } : { view: trend(list) };
  if (id === "clear") { await storage.remove(RUNS); return toast("History cleared"); }
  const r = list.find((x) => runId(x) === id);
  if (!r) return toast("Run is gone", undefined, "failure");
  // The marked runs (`ctx.ids`), else the one.
  const marked = (ctx?.ids ?? [id]).map((i) => list.find((x) => runId(x) === i)).filter((x): x is Run => !!x);
  const line = (x: Run) => `${isoDay(x.startedAt)} ${clock(x.startedAt)}  ${summary(x)}`;
  if (marked.length > 1 && action === "open") return { open: marked.flatMap((x) => (x.url ? [x.url] : [])) };
  if (marked.length > 1 && (action === "copy" || action === undefined)) return { copy: marked.map(line).join("\n") };
  switch (action) {
    case "open": return r.url ? { open: r.url } : { keep: true };
    case "remove": {
      // Marked runs (`ctx.ids`) go in one write.
      const gone = new Set(ctx?.ids ?? [id]);
      const kept = list.filter((x) => !gone.has(runId(x))), n = list.length - kept.length;
      await storage.set(RUNS, kept);
      return toast("Removed", n > 1 ? `${n} runs` : undefined);
    }
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
