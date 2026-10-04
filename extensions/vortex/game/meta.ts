// What lasts between runs: each board's best, what is open, the daily. Pure,
// so the tests check the rules the page lives by.
import { CLEAR, STAGES, rankAt, type StageId } from "./content.ts";

export type Board = { best: number; tries: number; time: number };
export type Save = {
  v: 1;
  /** By board key: a stage id, with "+" for its hyper. */
  boards: Record<string, Board>;
  /** The board last played, so the menu opens on it. */
  last: string;
  daily: { day: string; best: number; tries: number };
  muted: boolean;
};

/** A run as the page and the screenshots set it up. */
export type Scene = { screen: "title" | "run" | "over"; board?: string; seed?: number; t?: number };

export const keyOf = (stage: StageId, hyper: boolean) => stage + (hyper ? "+" : "");
export const parse = (key: string) => ({ stage: key.replace("+", "") as StageId, hyper: key.endsWith("+") });

export const fresh = (): Save => ({ v: 1, boards: {}, last: "pulse", daily: { day: "", best: 0, tries: 0 }, muted: false });

export function load(raw: unknown): Save {
  const s = fresh();
  if (!raw || typeof raw !== "object" || (raw as Save).v !== 1) return s;
  const r = raw as Partial<Save>;
  return { ...s, ...r, boards: { ...r.boards }, daily: { ...s.daily, ...r.daily } };
}

export const best = (s: Save, key: string) => s.boards[key]?.best ?? 0;

/** Boards in the menu's order: the six stages, then their hypers. */
export const BOARDS = [...STAGES.map((x) => keyOf(x.id, false)), ...STAGES.map((x) => keyOf(x.id, true))];

/** A stage opens when the one before it is cleared; its hyper when it is. */
export function open(s: Save, key: string) {
  const { stage, hyper } = parse(key);
  const i = STAGES.findIndex((x) => x.id === stage);
  if (hyper) return best(s, keyOf(stage, false)) >= CLEAR;
  return i === 0 || best(s, keyOf(STAGES[i - 1].id, false)) >= CLEAR;
}
export const dailyOpen = (s: Save) => best(s, "pulse") >= CLEAR;

/** The day's board and seed: every player gets the same walls today. */
export function daily(date: Date) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const n = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  return { day, stage: STAGES[n % STAGES.length].id, seed: (n * 2654435761) >>> 0 };
}

export type Outcome = { t: number; prev: number; record: boolean; rank: number; opened: string[]; daily?: boolean };

/** Writes a finished run into the save; answers what it changed. */
export function settle(s: Save, key: string, t: number, day?: string): Outcome {
  const before = BOARDS.filter((k) => open(s, k));
  const dailyBefore = dailyOpen(s);
  if (day) {
    if (s.daily.day !== day) s.daily = { day, best: 0, tries: 0 };
    const prev = s.daily.best;
    s.daily.tries++;
    s.daily.best = Math.max(prev, t);
    return { t, prev, record: t > prev, rank: rankAt(t), opened: [], daily: true };
  }
  const b = (s.boards[key] ??= { best: 0, tries: 0, time: 0 });
  const prev = b.best;
  b.tries++;
  b.time += t;
  b.best = Math.max(prev, t);
  s.last = key;
  const opened = BOARDS.filter((k) => open(s, k) && !before.includes(k));
  if (!dailyBefore && dailyOpen(s)) opened.push("daily");
  return { t, prev, record: t > prev, rank: rankAt(t), opened };
}

export const totals = (s: Save) => Object.values(s.boards).reduce((a, b) => ({ tries: a.tries + b.tries, time: a.time + b.time }), { tries: s.daily.tries, time: 0 });
