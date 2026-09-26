// What the battery and the owner's `power` watcher know, read into one
// snapshot. The gauge (pmset / upower) says how long the machine has; the
// watcher's files say why it drains: `state.json` is the live verdict,
// `samples.jsonl` beside it the 30 s ring buffer the charts come from, and
// the `power` CLI apportions watt-hours over a window (`power blame 1d`),
// which stays its job so the split is computed in exactly one place.
import { open, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { exec, home } from "@zcag/pal";

export type Battery = { percent: number; source: "Battery Power" | "Power Adapter"; status: "charging" | "discharging" | "charged" | "unknown"; remaining?: string; eta?: string };
export type Alert = { rule: string; level: "warn" | "crit"; message?: string };
/** `front` the app in front, `bg` a background process worth naming, `system` the machine's own (WindowServer), `minor` background but small; the watcher's verdict. */
export type Kind = "front" | "bg" | "system" | "minor" | "";
/** A process right now: its share of the attributable pool, the watts that share comes to, and why it costs (per second: CPU ms, SoC wakeups, disk and network bytes). */
export type Proc = { name: string; share: number; watts?: number; kind: Kind; cpu?: number; wakeups?: number; disk?: number; net?: number };
export type Lock = { proc: string; kind: string; secs?: number };
/** One sample of the ring buffer, the fields the charts use. `w` is the gauge: system draw on battery, charge flow (negative) on the charger. */
export type Point = { ts: number; w: number; soc: number; ext: boolean };
/** Watt-hours a process was charged over a window (`wh`), and its attribution score-seconds (`ss`), which keep ranking while on the charger. */
export type Usage = { name: string; wh: number; ss: number };
/** The deep sampler's split of the draw: CPU, GPU, the chip in all, and the rest (screen, radios, memory, SSD) that belongs to no process. */
export type Split = { cpu?: number; gpu?: number; chip?: number; rest?: number };
export type Health = { cycles?: number; health?: number; capacity?: number; temp?: number; thermal?: string };

export type Snapshot = Battery & {
  /** The watcher is running and fresh. */
  watched: boolean;
  /** Measured system draw on battery; the charge rate (positive) on the charger. */
  watts?: number;
  charging: boolean;
  alerts: Alert[];
  procs: Proc[];
  locks: Lock[];
  split: Split;
  health: Health;
  front?: string;
  /** When the watcher last sampled, unix seconds. */
  ts?: number;
};

const CMD_MS = 3000;
/** A watcher silent this long is asleep or gone, and its draw is not current. */
export const STALE_S = 180;

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const run = async (argv: string[], ms = CMD_MS) => ((await Bun.which(argv[0])) || argv[0].startsWith("/") ? (await exec(argv, { ms })).out : "");
const clockOf = (seconds: number | undefined) => (seconds && seconds > 0 ? `${Math.floor(seconds / 3600)}:${Math.max(0, Math.round(seconds / 60) % 60).toString().padStart(2, "0")}` : undefined);
const durationOf = (seconds: number | undefined) => (seconds && seconds > 0 ? `${Math.floor(seconds / 3600)}h ${Math.max(0, Math.round(seconds / 60) % 60).toString().padStart(2, "0")}m remaining` : undefined);

// ---- the gauge ---------------------------------------------------------------

/** `pmset -g batt`; Apple's compact line has stayed stable across recent macOS releases. */
export function parsePmset(text: string): Battery | undefined {
  const line = text.split("\n").find((l) => /%;/.test(l));
  const percent = line && /(\d+)%/.exec(line)?.[1];
  if (!line || !percent) return;
  const lower = line.toLowerCase();
  const source: Battery["source"] = /battery power/i.test(text) ? "Battery Power" : "Power Adapter";
  const status: Battery["status"] = /discharging/.test(lower) ? "discharging" : /charging/.test(lower) ? "charging" : /charged|finishing/.test(lower) ? "charged" : "unknown";
  const left = /(\d+:\d+) remaining/.exec(line)?.[1];
  // pmset answers 0:00 while it recalculates -- for minutes after a plug change,
  // and whenever the load swings -- so treat that as no estimate and let the
  // watcher's own figure stand in rather than showing a zero or nothing at all.
  const eta = left && left !== "0:00" ? left : undefined;
  return { percent: Number(percent), source, status, eta, remaining: eta ? `${eta} remaining` : undefined };
}

/** `upower -i`: use the display device/battery key-value form, ignoring history lines. */
export function parseUpower(text: string): Battery | undefined {
  const value = (key: string) => new RegExp(`^\\s*${key}:\\s*(.+)$`, "m").exec(text)?.[1].trim();
  const raw = value("percentage")?.replace("%", "");
  const percent = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(percent)) return;
  const rawState = value("state")?.toLowerCase() ?? "unknown";
  const status: Battery["status"] = rawState === "charging" ? "charging" : rawState === "discharging" ? "discharging" : rawState === "fully-charged" ? "charged" : "unknown";
  const remaining = value(status === "charging" ? "time to full" : "time to empty");
  return { percent, source: status === "discharging" ? "Battery Power" : "Power Adapter", status, remaining: remaining ? `${remaining.replace(/ hours?/, "h").replace(/ minutes?/, "m")} remaining` : undefined };
}

async function gauge(os: string): Promise<Battery | undefined> {
  if (os === "darwin") return parsePmset(await run(["pmset", "-g", "batt"]));
  const devices = (await run(["upower", "-e"])).split("\n").filter((x) => /battery/i.test(x));
  for (const device of devices) {
    const found = parseUpower(await run(["upower", "-i", device.trim()]));
    if (found) return found;
  }
}

// ---- the watcher's files -----------------------------------------------------

type Raw = Record<string, unknown>;
const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

async function readJson(file: string): Promise<Raw | undefined> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8"));
    return raw && typeof raw === "object" ? (raw as Raw) : undefined;
  } catch { return; }
}

/**
 * The last `bytes` of the ring buffer as samples, oldest first: the file
 * is tens of MB and only its tail is ever wanted. The first line of the
 * read is dropped unless the read began at the start (it is cut mid-record).
 */
export async function tailSamples(file: string, seconds: number, now = Date.now() / 1000): Promise<Raw[]> {
  let size: number;
  try { size = (await stat(file)).size; } catch { return []; }
  // ~1.1 KB a sample every 30 s, doubled back until the window is covered.
  let want = Math.min(size, Math.max(64 * 1024, Math.ceil(seconds / 30) * 1100));
  const cut = now - seconds;
  const fh = await open(file, "r");
  try {
    for (;;) {
      const start = size - want;
      const buf = Buffer.alloc(want);
      await fh.read(buf, 0, want, start);
      const lines = buf.toString("utf8").split("\n");
      if (start > 0) lines.shift();
      const out = lines.flatMap((l) => { try { const s = JSON.parse(l); return s && typeof s === "object" && typeof s.ts === "number" ? [s as Raw] : []; } catch { return []; } });
      if (start === 0 || !out.length || (out[0].ts as number) <= cut) return out.filter((s) => (s.ts as number) >= cut);
      want = Math.min(size, want * 2);
    }
  } finally { await fh.close(); }
}

export const points = (samples: Raw[]): Point[] => samples.flatMap((s) => (num(s.w) === undefined ? [] : [{ ts: s.ts as number, w: s.w as number, soc: num(s.soc) ?? 0, ext: !!s.ext }]));

function alerts(value: unknown): Alert[] {
  return list(value).flatMap((a): Alert[] => {
    const v = (a ?? {}) as Raw;
    return v.level === "warn" || v.level === "crit" ? [{ rule: str(v.rule) ?? "power", level: v.level, message: str(v.msg) }] : [];
  });
}

/**
 * The processes of the moment: the state's four carry the watcher's class,
 * the sample's twelve carry the raw scores (shares of `btot`) and the
 * deep sampler's why-columns. Watts are the share of what the chip draws:
 * on battery the measured draw less the rest, on the charger the chip's
 * own measured figure (the gauge shows charging then, not the draw).
 */
export function procs(state: Raw, sample: Raw | undefined, chipW: number | undefined): Proc[] {
  const kinds = new Map(list(state.blame).flatMap((b) => (Array.isArray(b) && typeof b[0] === "string" ? [[b[0], (str(b[2]) ?? "") as Kind] as const] : [])));
  const why = new Map(list(sample?.why).flatMap((w) => (Array.isArray(w) && typeof w[0] === "string" ? [[w[0], w] as const] : [])));
  const total = num(sample?.btot) ?? 0;
  const front = str(state.front)?.toLowerCase();
  const fromSample = total > 0 ? list(sample?.blame).flatMap((b) => (Array.isArray(b) && typeof b[0] === "string" && typeof b[1] === "number" ? [{ name: b[0], share: (b[1] / total) * 100 }] : [])) : [];
  const rows = fromSample.length ? fromSample : list(state.blame).flatMap((b) => (Array.isArray(b) && typeof b[0] === "string" && typeof b[1] === "number" ? [{ name: b[0], share: b[1] }] : []));
  return rows.map(({ name, share }) => {
    const w = why.get(name);
    const kind = kinds.get(name) ?? (front && name.toLowerCase() === front ? "front" : "");
    return { name, share, kind, watts: chipW === undefined ? undefined : (chipW * share) / 100, cpu: num(w?.[1]), wakeups: num(w?.[2]), disk: num(w?.[3]), net: num(w?.[4]) };
  });
}

export function split(state: Raw, sample: Raw | undefined, onBattery: boolean, w: number | undefined): Split {
  const mw = (k: string) => { const v = num(state[k]) ?? num(sample?.[k]); return v === undefined ? undefined : v / 1000; };
  const cpu = mw("cpu_mw"), gpu = mw("gpu_mw"), soc = mw("soc_mw");
  const rest = onBattery ? num(state.rest_w) ?? undefined : undefined;
  // On battery the chip is what the measured draw leaves after the rest; the
  // daemon's ratio has already been applied to `rest_w`, so the two add up.
  const chip = onBattery && w !== undefined && rest !== undefined ? Math.max(0, w - rest) : soc;
  return { cpu, gpu, chip, rest };
}

export async function snapshot(o: { os: string; stateFile: string; now?: number }): Promise<Snapshot | undefined> {
  const now = o.now ?? Date.now() / 1000;
  const file = home(o.stateFile);
  const [battery, raw, samples] = await Promise.all([gauge(o.os), readJson(file), tailSamples(join(dirname(file), "samples.jsonl"), 120, now)]);
  if (!battery) return;
  const fresh = raw && typeof raw.ts === "number" && now - raw.ts <= STALE_S ? raw : undefined;
  const sample = fresh ? samples.at(-1) : undefined;
  const onBattery = battery.source === "Battery Power";
  const w = num(fresh?.w);
  const s = fresh ? split(fresh, sample, onBattery, w) : {};
  const eta = num(fresh?.eta);
  const soc = num(sample?.soc) ?? battery.percent;
  const wh = num(sample?.wh);
  return {
    ...battery,
    eta: battery.eta ?? clockOf(eta),
    remaining: battery.remaining ?? durationOf(eta),
    watched: !!fresh,
    watts: w === undefined ? undefined : Math.abs(w),
    charging: battery.status === "charging" || (battery.status !== "charged" && w !== undefined && w < -0.5),
    alerts: alerts(fresh?.alerts),
    procs: fresh ? procs(fresh, sample, s.chip) : [],
    locks: list(fresh?.locks).flatMap((l) => (Array.isArray(l) && typeof l[0] === "string" ? [{ proc: l[0], kind: str(l[1]) ?? "", secs: num(l[2]) }] : [])),
    split: s,
    health: { cycles: num(sample?.cycles), health: num(sample?.health), capacity: wh && soc > 0 ? (wh / soc) * 100 : undefined, temp: num(fresh?.temp), thermal: str(sample?.thermal) },
    front: str(fresh?.front),
    ts: num(fresh?.ts),
  };
}

// ---- windows -----------------------------------------------------------------

/** The watcher's CLI: `PAL_POWER_BIN` (tests), else on PATH, else where dotty puts it (the app's PATH has no ~/.local/bin). */
export async function powerBin(): Promise<string | undefined> {
  if (process.env.PAL_POWER_BIN) return process.env.PAL_POWER_BIN;
  const found = Bun.which("power") ?? home("~/.local/bin/power");
  return (await Bun.file(found).exists()) ? found : undefined;
}

/** `power blame [dur]` piped: `wh<TAB>ss<TAB>process` per line, heaviest first. No `span` is all time (the ledger). */
export async function usage(span?: string): Promise<Usage[] | undefined> {
  const bin = await powerBin();
  if (!bin) return;
  const out = await run(span ? [bin, "blame", span] : [bin, "blame"], 8000);
  return out.split("\n").flatMap((l) => {
    const [wh, ss, ...name] = l.split("\t");
    return name.length && Number.isFinite(Number(wh)) ? [{ name: name.join("\t"), wh: Number(wh), ss: Number(ss) || 0 }] : [];
  });
}
