// The scheduling: FSRS (ts-fsrs, the algorithm Anki schedules with) for
// each card's memory, and the queue a session walks. Pure given `now`, so
// the tests drive it with a clock of their own.
//
// A pack's card is two cards when the pack says `reverse`: recognition
// (front → back, "gato" → "cat") and production (back → front, typed).
// Recognition comes first; a word's production card is only offered once
// its recognition card has graduated to review, and never on a day its
// sibling was answered (Anki buries siblings for the same reason: the
// one answers the other).
//
// The queue, as Anki orders it: cards in (re)learning that are due now,
// then the day's reviews with new cards mixed in (one new after every
// three reviews, up to the daily limit), then (re)learning cards due in
// the next 20 minutes, shown early rather than leaving the session with
// nothing. A day runs to 4 am, so a late session counts for the evening.
import { fsrs, Rating, State, type Card as FCard, type Grade } from "ts-fsrs";
import type { Card, Pack } from "./packs.ts";
import type { Data, LogRow } from "./store.ts";

/** A card's memory, compact: FSRS's Card with dates as unix ms. `st` 0 new, 1 learning, 2 review, 3 relearning. */
export type Mem = { due: number; s: number; d: number; st: number; reps: number; lapses: number; ls: number; sd: number; lr?: number };

export const DAY = 86_400_000;
const LEARN_AHEAD = 20 * 60_000;
/** Anki's "mature": the card is not due for three weeks. */
export const MASTERED_DAYS = 21;
/** Anki's leech threshold: forgotten this often, the card needs a better mnemonic, not more reviews. */
export const LEECH = 8;

export type Settings = { retention: number; newPerDay: number; goal: number };
export const DEFAULTS: Settings = { retention: 0.9, newPerDay: 15, goal: 20 };

const scheduler = (retention: number) => fsrs({ request_retention: retention, enable_fuzz: true, enable_short_term: true, learning_steps: ["1m", "10m"], relearning_steps: ["10m"], maximum_interval: 36500 });

const toF = (m: Mem): FCard => ({ due: new Date(m.due), stability: m.s, difficulty: m.d, elapsed_days: 0, scheduled_days: m.sd, learning_steps: m.ls, reps: m.reps, lapses: m.lapses, state: m.st as State, last_review: m.lr ? new Date(m.lr) : undefined });
const fromF = (c: FCard): Mem => ({ due: c.due.getTime(), s: c.stability, d: c.difficulty, st: c.state, reps: c.reps, lapses: c.lapses, ls: c.learning_steps, sd: c.scheduled_days, ...(c.last_review && { lr: c.last_review.getTime() }) });
const fresh = (now: number): Mem => ({ due: now, s: 0, d: 0, st: 0, reps: 0, lapses: 0, ls: 0, sd: 0 });

/** The memory after answering `rating` (1 again … 4 easy) at `now`. */
export function answer(m: Mem | undefined, rating: number, now: number, retention = DEFAULTS.retention): Mem {
  return fromF(scheduler(retention).next(toF(m ?? fresh(now)), new Date(now), rating as Grade).card);
}

/** When each rating would bring the card back, as the buttons label it: "1m", "10m", "3d", "2mo". */
export function previews(m: Mem | undefined, now: number, retention = DEFAULTS.retention): Record<1 | 2 | 3 | 4, string> {
  const all = scheduler(retention).repeat(toF(m ?? fresh(now)), new Date(now));
  const out = {} as Record<1 | 2 | 3 | 4, string>;
  for (const r of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const) out[r as 1 | 2 | 3 | 4] = span(all[r].card.due.getTime() - now);
  return out;
}

export function span(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(ms / DAY);
  if (d < 31) return `${d}d`;
  if (d < 365) return `${Math.round(d / 30.4)}mo`;
  return `${+(d / 365).toFixed(1)}y`;
}

/** The chance of recalling it now (0..1); 1 for a card never seen. */
export function recall(m: Mem, now: number): number {
  if (!m.lr || m.s <= 0) return m.st === 0 ? 1 : 0;
  // FSRS-6's forgetting curve with its default decay (0.1542).
  const t = Math.max(0, (now - m.lr) / DAY), decay = -0.1542, factor = 0.9 ** (1 / decay) - 1;
  return (1 + factor * t / m.s) ** decay;
}

export const mastered = (m?: Mem) => !!m && m.st === State.Review && m.s >= MASTERED_DAYS;

// ---- days ---------------------------------------------------------------

/** The start of the study day `now` falls in: 4 am local. */
export function dayStart(now: number): number {
  const d = new Date(now - 4 * 3_600_000);
  d.setHours(4, 0, 0, 0);
  return d.getTime();
}
/** A day's key for counting: its start. */
export const dayOf = (at: number) => dayStart(at);

// ---- cards ---------------------------------------------------------------

/** One studyable card: a pack's card in one direction. */
export type Item = { key: string; pack: Pack; card: Card; reverse: boolean; index: number };
export const keyOf = (pack: string, card: string, reverse: boolean) => `${pack}/${card}${reverse ? "<" : ""}`;
export const sibling = (key: string) => (key.endsWith("<") ? key.slice(0, -1) : `${key}<`);

/** Every card of these packs, in pack order, forward before reverse. */
export function items(packs: Pack[]): Item[] {
  const out: Item[] = [];
  for (const pack of packs) pack.cards.forEach((card, index) => {
    out.push({ key: keyOf(pack.id, card.id, false), pack, card, reverse: false, index });
    if (pack.reverse) out.push({ key: keyOf(pack.id, card.id, true), pack, card, reverse: true, index });
  });
  return out;
}

/** Keys answered since the day began, and how many of them were new then: among `among` (a session's cards) when given, so one pack's day is its own. */
function today(log: LogRow[], now: number, among?: Set<string>) {
  const start = dayStart(now), keys = new Set<string>();
  let fresh = 0, answers = 0;
  for (let i = log.length - 1; i >= 0 && log[i][0] * 1000 >= start; i--) {
    keys.add(log[i][1]);
    if (among && !among.has(log[i][1])) continue;
    answers++;
    if (log[i][3] === 0) fresh++;
  }
  return { keys, fresh, answers };
}

export type Kind = "new" | "learning" | "review";
export const kindOf = (m?: Mem): Kind => (!m || m.st === 0 ? "new" : m.st === 2 ? "review" : "learning");

export type Queue = { next: Item | null; counts: { new: number; learning: number; review: number } };

/**
 * What to study now among `all` (the active packs' items): the next card
 * and what is left today by kind. `extraNew` raises today's new limit
 * ("Learn more"); `skip` holds a key back (the card just answered, which
 * a learning step may already have made due again).
 */
export function queue(all: Item[], data: Data, now: number, s: Settings, extraNew = 0, skip?: string): Queue {
  const end = dayStart(now) + DAY;
  const t = today(data.log, now, new Set(all.map((i) => i.key)));
  const suspended = new Set(data.suspended);
  const learningNow: Item[] = [], learningSoon: Item[] = [], reviews: Item[] = [], news: Item[] = [];
  for (const it of all) {
    if (suspended.has(it.key) || it.key === skip) continue;
    const m = data.cards[it.key];
    if (m && m.st !== 0) {
      if (m.st === 2) { if (m.due < end && !t.keys.has(sibling(it.key))) reviews.push(it); }
      else if (m.due <= now) learningNow.push(it);
      else if (m.due <= now + LEARN_AHEAD) learningSoon.push(it);
      continue;
    }
    // New. A production card waits for its word to be learned, and not on the day it was answered.
    if (it.reverse) {
      const f = data.cards[sibling(it.key)];
      if (!f || f.st !== 2 || t.keys.has(sibling(it.key))) continue;
    }
    news.push(it);
  }
  const room = Math.max(0, s.newPerDay + extraNew - t.fresh);
  // Production cards of words already learned first: they are the step after, and they are few.
  news.sort((a, b) => Number(b.reverse) - Number(a.reverse) || 0);
  const newToday = news.slice(0, room);
  const byDue = (a: Item, b: Item) => data.cards[a.key].due - data.cards[b.key].due;
  learningNow.sort(byDue);
  learningSoon.sort(byDue);
  // By the day they fell due, oldest first, then shuffled within a day (by key hash, stable), as Anki's "due date, then random": a pack is not reviewed in its own order.
  const dueDay = (it: Item) => dayStart(data.cards[it.key].due);
  reviews.sort((a, b) => dueDay(a) - dueDay(b) || hash(a.key) - hash(b.key));
  const counts = { new: newToday.length, learning: learningNow.length + learningSoon.length, review: reviews.length };
  let next: Item | null = learningNow[0] ?? null;
  if (!next) {
    // One new after every three reviews: the reviews answered today, mod 4.
    const newTurn = newToday.length && (!reviews.length || (t.answers + 1) % 4 === 0);
    next = (newTurn ? newToday[0] : reviews[0]) ?? newToday[0] ?? learningSoon[0] ?? null;
  }
  // The card held back is still the one to show when nothing else is left.
  if (!next && skip) {
    const it = all.find((i) => i.key === skip);
    const m = it && data.cards[it.key];
    if (it && m && m.st !== 2 && m.st !== 0 && m.due <= now + LEARN_AHEAD) { next = it; counts.learning++; }
  }
  return { next, counts };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The cards worth a refresher, weakest first, at most `max`: forgotten in
 * the last week, forgotten three times or more, or below 80% recall now.
 * Seen cards only; suspended ones stay out.
 */
export function weak(all: Item[], data: Data, now: number, max = 20): Item[] {
  const since = (now - 7 * DAY) / 1000;
  const failed = new Set(data.log.filter((r) => r[0] >= since && r[2] === 1).map((r) => r[1]));
  const suspended = new Set(data.suspended);
  return all.filter((it) => {
    const m = data.cards[it.key];
    return m && m.st !== 0 && !suspended.has(it.key) && (failed.has(it.key) || m.lapses >= 3 || recall(m, now) < 0.8);
  }).sort((a, b) => recall(data.cards[a.key], now) - recall(data.cards[b.key], now)).slice(0, max);
}

// ---- progress --------------------------------------------------------------

export type Progress = { total: number; seen: number; learning: number; mastered: number; due: number; coverage?: number };

/** A pack's standing; `coverage` is the share of the language its words cover, counting a word once its recognition card is known (below). */
export function progress(pack: Pack, data: Data, now: number): Progress {
  const end = dayStart(now) + DAY;
  const p: Progress = { total: pack.cards.length, seen: 0, learning: 0, mastered: 0, due: 0 };
  let cov = 0, weighted = false;
  for (const c of pack.cards) {
    const m = data.cards[keyOf(pack.id, c.id, false)];
    const w = c.weight;
    if (w !== undefined) weighted = true;
    if (!m || m.st === 0) continue;
    p.seen++;
    if (mastered(m)) p.mastered++;
    else if (m.st !== 2) p.learning++;
    // A word counts once it is known: in review, or in learning past its first step (its last answer a pass; ts-fsrs puts an Again back at step 0).
    if (w && (m.st === 2 || (m.st === 1 && m.ls > 0))) cov += w;
    if (m.due < end) p.due++;
  }
  if (weighted) p.coverage = cov;
  return p;
}

// ---- the log ----------------------------------------------------------------

export type Stats = { streak: number; todayAnswers: number; goalMet: boolean; days: Record<number, number>; retention: number | null; tomorrow: number };

/**
 * The streak is the run of days the goal was met, ending today or
 * yesterday (today still has time). `days` counts answers per day start,
 * for the heatmap; `retention` is the share of reviews (not new cards)
 * passed in the last 30 days.
 */
export function stats(data: Data, all: Item[], now: number, goal: number): Stats {
  const days: Record<number, number> = {};
  let pass = 0, reviews = 0;
  const month = (now - 30 * DAY) / 1000;
  for (const [at, , rating, state] of data.log) {
    const d = dayOf(at * 1000);
    days[d] = (days[d] ?? 0) + 1;
    if (at >= month && state === 2) { reviews++; if (rating > 1) pass++; }
  }
  const t0 = dayStart(now);
  const todayAnswers = days[t0] ?? 0;
  let streak = 0;
  // Step back a day at a time; DST shifts a day by an hour, so re-anchor each step with dayStart.
  for (let d = todayAnswers >= goal ? t0 : dayStart(t0 - DAY / 2); (days[d] ?? 0) >= goal; d = dayStart(d - DAY / 2)) streak++;
  const end = t0 + 2 * DAY;
  const tomorrow = all.filter((it) => { const m = data.cards[it.key]; return m && m.st !== 0 && m.due >= t0 + DAY && m.due < end; }).length;
  return { streak, todayAnswers, goalMet: todayAnswers >= goal, days, retention: reviews ? pass / reviews : null, tomorrow };
}
