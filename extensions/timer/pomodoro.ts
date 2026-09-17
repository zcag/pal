// Pomodoro as data: the session the extension keeps in storage while one
// runs (which round, which phase, which of the CLI's timers is the
// current one), the phase that follows a landed one, the timer names, and
// the per-day tally of finished rounds. Pure; index.ts drives it off the
// timers it reads and asks the CLI for each phase's timer.

export type Phase = "work" | "break" | "long";
/** `[extensions.timer]`'s pomodoro keys: minutes per phase and rounds per cycle. */
export type Config = { pomodoro_work: number; pomodoro_break: number; pomodoro_long_break: number; pomodoro_rounds: number };
/** Storage `pomodoro`: one session, gone once stopped. `timerName` is what the phase's timer is called (its id is the CLI's slug of it). */
export type Session = { round: number; of: number; phase: Phase; timerId: string; timerName: string; startedAt: number; sessionStart: number };
/** Storage `pomodoro_stats`: finished work rounds per local day. */
export type Stats = Record<string, number>;

export const STATS_DAYS = 60;
export const KEY = "pomodoro";
export const STATS_KEY = "pomodoro_stats";

export const nameOf = (phase: Phase, round: number, of: number): string => (phase === "work" ? `Pomodoro ${round} of ${of}` : phase === "break" ? `Break ${round} of ${of}` : "Long break");
export const minutesOf = (phase: Phase, c: Config): number => Math.max(1, Math.round(phase === "work" ? c.pomodoro_work : phase === "break" ? c.pomodoro_break : c.pomodoro_long_break));
/** "work", "break", "long break": the word the rows and the HUD use. */
export const phaseWord = (phase: Phase): string => (phase === "long" ? "long break" : phase);

/** After a landed phase: a break after work (the long one after the last round), work again after a break, the next round on. */
export function next(s: Pick<Session, "round" | "of" | "phase">): { phase: Phase; round: number } {
  if (s.phase === "work") return { phase: s.round >= s.of ? "long" : "break", round: s.round };
  if (s.phase === "break") return { phase: "work", round: s.round + 1 };
  return { phase: "work", round: 1 };
}

/** "Round 2 of 4, work", "Long break": the session in a line. */
export const describe = (s: Pick<Session, "round" | "of" | "phase">): string => (s.phase === "long" ? "Long break" : `Round ${s.round} of ${s.of}, ${s.phase}`);

const two = (n: number) => String(n).padStart(2, "0");
/** Local `YYYY-MM-DD`. */
export const dayOf = (epochSecs: number): string => { const d = new Date(epochSecs * 1000); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };

/** One more finished round on `day`; days older than `STATS_DAYS` before it dropped. */
export function tally(stats: Stats, day: string): Stats {
  const cutoff = new Date(day);
  cutoff.setDate(cutoff.getDate() - STATS_DAYS);
  const keep = dayOf(cutoff.getTime() / 1000);
  const out: Stats = {};
  for (const [d, n] of Object.entries(stats)) if (d >= keep && Number.isInteger(n) && n > 0) out[d] = n;
  out[day] = (out[day] ?? 0) + 1;
  return out;
}

/** The stored session, defensively; null for anything that is not one. */
export function asSession(v: unknown): Session | null {
  const s = v as Partial<Session> | null;
  if (!s || typeof s !== "object" || typeof s.timerId !== "string" || typeof s.timerName !== "string") return null;
  if (!["work", "break", "long"].includes(s.phase as string) || !Number.isInteger(s.round) || !Number.isInteger(s.of)) return null;
  return { round: s.round!, of: s.of!, phase: s.phase as Phase, timerId: s.timerId, timerName: s.timerName, startedAt: Number(s.startedAt) || 0, sessionStart: Number(s.sessionStart) || 0 };
}
