// The speed test tools as data: which one is installed (Ookla's
// `speedtest`, sivel's `speedtest-cli`, Netflix's `fast`), how each is
// run, and how its stream is read into one `Run` (`feed`, pure). The
// Ookla CLI streams JSON lines with a progress fraction per phase;
// speedtest-cli prints a phase per line and the numbers at the end; fast
// redraws one line with the live figure, which the regex reads out of the
// stream. `PAL_SPEEDTEST_PATH` names a directory searched first for the
// three binaries (the tests put stand-ins there).
import { existsSync } from "node:fs";
import { join } from "node:path";

export type ToolId = "ookla" | "speedtest-cli" | "fast";
export type Tool = { id: ToolId; bin: string; title: string };

/** How each is installed, for the row that says nothing is. */
export const INSTALL: Record<ToolId, string> = {
  ookla: "brew tap teamookla/speedtest && brew install speedtest",
  "speedtest-cli": "brew install speedtest-cli",
  fast: "npm install --global fast-cli",
};
export const TITLE: Record<ToolId, string> = { ookla: "Speedtest by Ookla", "speedtest-cli": "speedtest-cli", fast: "fast (Netflix)" };

const which = (name: string): string | undefined => {
  const dir = process.env.PAL_SPEEDTEST_PATH;
  if (dir) return existsSync(join(dir, name)) ? join(dir, name) : undefined;
  return Bun.which(name) ?? undefined;
};

/** `speedtest` is two programs: Ookla's prints "Speedtest by Ookla" for --version, sivel's pip package installs a `speedtest` alias of speedtest-cli. */
async function versionOf(bin: string): Promise<string> {
  try {
    const p = Bun.spawn([bin, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const t = setTimeout(() => p.kill(), 3000);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    clearTimeout(t);
    return out + err;
  } catch { return ""; }
}

/** The installed tools, Ookla first (it is the one with progress); `want` narrows to one. */
export async function detect(want: ToolId | "auto" = "auto"): Promise<Tool[]> {
  const out: Tool[] = [];
  const st = which("speedtest");
  if (st) {
    const v = await versionOf(st);
    if (/ookla/i.test(v)) out.push({ id: "ookla", bin: st, title: TITLE.ookla });
    else if (/speedtest-cli/i.test(v)) out.push({ id: "speedtest-cli", bin: st, title: TITLE["speedtest-cli"] });
  }
  const sc = which("speedtest-cli");
  if (sc && !out.some((t) => t.id === "speedtest-cli")) out.push({ id: "speedtest-cli", bin: sc, title: TITLE["speedtest-cli"] });
  const fast = which("fast");
  if (fast) out.push({ id: "fast", bin: fast, title: TITLE.fast });
  return want === "auto" ? out : out.filter((t) => t.id === want);
}

export function argv(t: Tool, server: string): string[] {
  const s = server.trim();
  switch (t.id) {
    case "ookla": return [t.bin, "--format=jsonl", "--progress=yes", "--accept-license", "--accept-gdpr", ...(s ? ["--server-id", s] : [])];
    case "speedtest-cli": return [t.bin, "--secure", ...(s ? ["--server", s] : [])];
    case "fast": return [t.bin, "--upload", "--verbose"];
  }
}

// ---- the run ------------------------------------------------------------------------

export type Phase = "starting" | "ping" | "download" | "upload" | "done" | "failed";
export type Run = {
  tool: ToolId;
  startedAt: number;
  phase: Phase;
  /** Fraction of the phase the tool reports (Ookla); the others have none and the view estimates from the elapsed time. */
  progress?: number;
  /** Mbit/s, the live figure while measuring and the result after. */
  download?: number;
  upload?: number;
  /** ms. */
  ping?: number;
  jitter?: number;
  packetLoss?: number;
  server?: string;
  isp?: string;
  ip?: string;
  /** The result page (Ookla). */
  url?: string;
  error?: string;
  endedAt?: number;
};

export const start = (tool: ToolId, now = Date.now()): Run => ({ tool, startedAt: now, phase: "starting" });
const mbps = (bytesPerSec: number) => Math.round((bytesPerSec * 8) / 1e4) / 100;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** One line of Ookla's `--format=jsonl --progress=yes`. */
function feedOokla(r: Run, line: string): void {
  let j: any;
  try { j = JSON.parse(line); } catch { return; }
  if (!j || typeof j !== "object") return;
  const server = (s: any) => (s ? [s.name, s.location].filter(Boolean).join(", ") : undefined);
  switch (j.type) {
    case "testStart": r.phase = "ping"; r.isp = j.isp ?? r.isp; r.ip = j.interface?.externalIp ?? r.ip; r.server = server(j.server) ?? r.server; break;
    case "ping": r.phase = "ping"; r.ping = num(j.ping?.latency) ?? r.ping; r.jitter = num(j.ping?.jitter) ?? r.jitter; r.progress = num(j.ping?.progress); break;
    case "download": r.phase = "download"; if (num(j.download?.bandwidth) !== undefined) r.download = mbps(j.download.bandwidth); r.progress = num(j.download?.progress); break;
    case "upload": r.phase = "upload"; if (num(j.upload?.bandwidth) !== undefined) r.upload = mbps(j.upload.bandwidth); r.progress = num(j.upload?.progress); break;
    case "result":
      r.phase = "done"; r.progress = 1;
      if (num(j.download?.bandwidth) !== undefined) r.download = mbps(j.download.bandwidth);
      if (num(j.upload?.bandwidth) !== undefined) r.upload = mbps(j.upload.bandwidth);
      r.ping = num(j.ping?.latency) ?? r.ping; r.jitter = num(j.ping?.jitter) ?? r.jitter; r.packetLoss = num(j.packetLoss);
      r.isp = j.isp ?? r.isp; r.ip = j.interface?.externalIp ?? r.ip; r.server = server(j.server) ?? r.server; r.url = j.result?.url ?? r.url;
      break;
    case "log": if (j.level === "error" && j.message) r.error = String(j.message); break;
  }
}

/** One line of speedtest-cli's human output (`--json` would say nothing until the end). */
function feedSivel(r: Run, line: string): void {
  let m: RegExpExecArray | null;
  if ((m = /^Testing from (.+?) \(([\d.a-f:]+)\)/.exec(line))) { r.isp = m[1]; r.ip = m[2]; r.phase = "ping"; }
  else if ((m = /^Hosted by (.+?) \[[\d.]+ km\]: ([\d.]+) ms/.exec(line))) { r.server = m[1].replace(/\s+\(/, ", ").replace(/\)$/, ""); r.ping = Number(m[2]); r.phase = "download"; }
  else if (/^Testing download speed/.test(line)) r.phase = "download";
  else if ((m = /^Download: ([\d.]+) Mbit\/s/.exec(line))) { r.download = Number(m[1]); r.phase = "upload"; }
  else if (/^Testing upload speed/.test(line)) r.phase = "upload";
  else if ((m = /^Upload: ([\d.]+) Mbit\/s/.exec(line))) { r.upload = Number(m[1]); r.phase = "done"; r.progress = 1; }
  else if (/^(ERROR|Cannot retrieve|No matched servers)/.test(line)) r.error = line.trim();
}

const UNIT: Record<string, number> = { Kbps: 0.001, Mbps: 1, Gbps: 1000 };
/** The last `N Mbps ↓` (or `↓ N Mbps`) in a chunk, in Mbps. */
function lastFigure(text: string, arrow: "↓" | "↑"): number | undefined {
  const m = [...text.matchAll(new RegExp(`([\\d.]+)\\s*(Kbps|Mbps|Gbps)\\s*${arrow}|${arrow}\\s*([\\d.]+)\\s*(Kbps|Mbps|Gbps)`, "g"))].at(-1);
  return m ? Number(m[1] ?? m[3]) * UNIT[m[2] ?? m[4]] : undefined;
}
/** A chunk of fast's redrawn line: the last figure per arrow, the `--verbose` latency (unloaded) and client line. */
function feedFast(r: Run, chunk: string): void {
  const text = chunk.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, " ");
  let m: RegExpExecArray | null;
  const down = lastFigure(text, "↓"), up = lastFigure(text, "↑");
  if (down !== undefined) { r.download = down; r.phase = "download"; }
  if (up !== undefined) { r.upload = up; r.phase = "upload"; }
  if ((m = /Latency:\s*([\d.]+)\s*ms/.exec(text))) r.ping = Number(m[1]);
  if ((m = /Client:\s*(.+?)\s*[•·]\s*([\d.a-f:]+)/i.exec(text))) { r.ip = m[2]; r.isp ??= m[1].trim(); }
  if (/(Could not|Error|ENOTFOUND|ECONN)/i.test(text)) r.error = text.trim().split("\n")[0];
}

/** Reads what the tool printed into the run. Ookla and speedtest-cli per line, fast per chunk (its line is redrawn in place). */
export function feed(r: Run, text: string): void {
  if (r.tool === "fast") return feedFast(r, text);
  for (const line of text.split("\n")) if (line.trim()) (r.tool === "ookla" ? feedOokla : feedSivel)(r, line);
}

/** The tool exited: a run without an upload figure is a failure, with the last error line as the reason. */
export function finish(r: Run, code: number | null, now = Date.now()): void {
  r.endedAt = now;
  if (r.phase === "done") return;
  if (r.tool === "fast" && r.download !== undefined && r.upload !== undefined && code === 0) { r.phase = "done"; r.progress = 1; return; }
  r.phase = "failed";
  r.error ??= code === null ? "stopped" : `exit ${code}`;
}

// ---- formatting -------------------------------------------------------------------------

export const speed = (n?: number) => (n === undefined ? "–" : n >= 100 ? `${Math.round(n)}` : n >= 10 ? n.toFixed(1) : n.toFixed(2));
export const ms = (n?: number) => (n === undefined ? "–" : `${n >= 100 ? Math.round(n) : n.toFixed(1)} ms`);

/** One line for the clipboard and the history row. */
export function summary(r: Run): string {
  const parts = [`↓ ${speed(r.download)} Mbps`, `↑ ${speed(r.upload)} Mbps`, `ping ${ms(r.ping)}${r.jitter !== undefined ? ` (jitter ${ms(r.jitter)})` : ""}`];
  if (r.server) parts.push(r.server);
  if (r.isp) parts.push(r.isp);
  return parts.join(" · ");
}
