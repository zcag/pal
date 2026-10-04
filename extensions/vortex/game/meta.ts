// What lasts between runs: each board's best, its medals and the ghost of its
// best run, what is open, the daily, the player's look. Pure, so the tests
// check the rules the page lives by.
import { CLEAR, SKINS, STAGES, TRAILS, rankAt, type SkinId, type StageId, type TrailId } from "./content.ts";
import { chartSeed, create, step, type Input, type State } from "./sim.ts";

export type Board = { best: number; tries: number; time: number; medals?: string[] };
/** A run's keys, run-length: [ticks, code, ticks, code, ...]; code = dir + 1, plus 3 with Shift. */
export type Keys = number[];
export type Ghost = { t: number; keys: Keys };
export type Save = {
  v: 1;
  /** By board key: a stage id, with "+" for its hyper; "endless". */
  boards: Record<string, Board>;
  /** The best run of each stage board, to race. */
  ghosts: Record<string, Ghost>;
  /** The board last played, so the menu opens on it. */
  last: string;
  daily: { day: string; best: number; tries: number };
  muted: boolean;
  skin: SkinId; trail: TrailId;
  /** Ghosts on or off. */
  ghost: boolean;
};

/** A run as the page and the screenshots set it up. */
export type Scene = { screen: "title" | "run" | "over" | "look"; board?: string; seed?: number; t?: number };

export const keyOf = (stage: StageId, hyper: boolean) => stage + (hyper ? "+" : "");
export const parse = (key: string) => ({ stage: (key === "endless" ? "pulse" : key.replace("+", "")) as StageId, hyper: key.endsWith("+") });

export const fresh = (): Save => ({ v: 1, boards: {}, ghosts: {}, last: "pulse", daily: { day: "", best: 0, tries: 0 }, muted: false, skin: "dart", trail: "line", ghost: true });

export function load(raw: unknown): Save {
  const s = fresh();
  if (!raw || typeof raw !== "object" || (raw as Save).v !== 1) return s;
  const r = raw as Partial<Save>;
  return { ...s, ...r, boards: { ...r.boards }, ghosts: { ...r.ghosts }, daily: { ...s.daily, ...r.daily } };
}

export const best = (s: Save, key: string) => s.boards[key]?.best ?? 0;

/** Boards in the menu's order: the six stages, then their hypers. */
export const BOARDS = [...STAGES.map((x) => keyOf(x.id, false)), ...STAGES.map((x) => keyOf(x.id, true))];

/** A stage opens when the one before it is cleared; its hyper when it is; endless and the daily with Pulse. */
export function open(s: Save, key: string) {
  if (key === "endless" || key === "daily") return best(s, "pulse") >= CLEAR;
  const { stage, hyper } = parse(key);
  const i = STAGES.findIndex((x) => x.id === stage);
  if (hyper) return best(s, keyOf(stage, false)) >= CLEAR;
  return i === 0 || best(s, keyOf(STAGES[i - 1].id, false)) >= CLEAR;
}
export const dailyOpen = (s: Save) => open(s, "daily");

/** The day's board and seed: every player gets the same walls today. */
export function daily(date: Date) {
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const n = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5);
  return { day, stage: STAGES[n % STAGES.length].id, seed: (n * 2654435761) >>> 0 };
}

// ---- medals and looks -----------------------------------------------------------------------------------------------

export type Medal = { id: string; name: string; how: string; won: (r: Run) => boolean };
/** What a run did, as far as medals care. */
export type Run = { t: number; grazes: number; focused: boolean };

export const STAGE_MEDALS: Medal[] = [
  { id: "clear", name: "Clear", how: "Last a minute", won: (r) => r.t >= CLEAR },
  { id: "steady", name: "Steady", how: "Last a minute without Shift", won: (r) => r.t >= CLEAR && !r.focused },
  { id: "hairline", name: "Hairline", how: "Skim 20 walls in one run", won: (r) => r.grazes >= 20 },
  { id: "marathon", name: "Marathon", how: "Last 90 seconds", won: (r) => r.t >= 90 },
];
export const ENDLESS_MEDALS: Medal[] = [
  { id: "tour", name: "Tour", how: "Last two minutes", won: (r) => r.t >= 120 },
  { id: "voyage", name: "Voyage", how: "Last four minutes", won: (r) => r.t >= 240 },
  { id: "odyssey", name: "Odyssey", how: "Last six minutes", won: (r) => r.t >= 360 },
];
export const medalsOf = (key: string) => (key === "endless" ? ENDLESS_MEDALS : STAGE_MEDALS);
export const medalCount = (s: Save) => Object.values(s.boards).reduce((a, b) => a + (b.medals?.length ?? 0), 0);
export const MEDALS_TOTAL = BOARDS.length * STAGE_MEDALS.length + ENDLESS_MEDALS.length;

/** The medals each look needs. */
export const SKIN_AT: Record<SkinId, number> = { dart: 0, arrow: 2, diamond: 5, comet: 9, star: 14 };
export const TRAIL_AT: Record<TrailId, number> = { line: 0, ribbon: 3, sparks: 7, prism: 12 };
export const skinOpen = (s: Save, k: SkinId) => medalCount(s) >= SKIN_AT[k];
export const trailOpen = (s: Save, k: TrailId) => medalCount(s) >= TRAIL_AT[k];
const looks = (s: Save) => [...SKINS.filter((k) => skinOpen(s, k)), ...TRAILS.filter((k) => trailOpen(s, k))];

// ---- a finished run ---------------------------------------------------------------------------------------------------

export type Outcome = {
  t: number; prev: number; record: boolean; rank: number; opened: string[];
  medals: string[]; looks: string[]; daily?: boolean; practice?: boolean;
};

/** Writes a finished run into the save; answers what it changed. A practice run changes nothing. */
export function settle(s: Save, key: string, run: Run & { keys?: Keys }, how: { day?: string; practice?: boolean } = {}): Outcome {
  const t = run.t;
  if (how.practice) return { t, prev: best(s, key), record: false, rank: rankAt(t), opened: [], medals: [], looks: [], practice: true };
  if (how.day) {
    if (s.daily.day !== how.day) s.daily = { day: how.day, best: 0, tries: 0 };
    const prev = s.daily.best;
    s.daily.tries++;
    s.daily.best = Math.max(prev, t);
    return { t, prev, record: t > prev, rank: rankAt(t), opened: [], medals: [], looks: [], daily: true };
  }
  const before = [...BOARDS, "endless", "daily"].filter((k) => open(s, k)), lookBefore = looks(s);
  const b = (s.boards[key] ??= { best: 0, tries: 0, time: 0 });
  const prev = b.best;
  b.tries++;
  b.time += t;
  b.best = Math.max(prev, t);
  s.last = key;
  const medals = medalsOf(key).filter((m) => m.won(run) && !b.medals?.includes(m.id)).map((m) => m.id);
  if (medals.length) b.medals = [...(b.medals ?? []), ...medals];
  if (t > prev && run.keys && key !== "endless") s.ghosts[key] = { t, keys: run.keys };
  const opened = [...BOARDS, "endless", "daily"].filter((k) => open(s, k) && !before.includes(k));
  return { t, prev, record: t > prev, rank: rankAt(t), opened, medals, looks: looks(s).filter((k) => !lookBefore.includes(k)) };
}

export const totals = (s: Save) => Object.values(s.boards).reduce((a, b) => ({ tries: a.tries + b.tries, time: a.time + b.time }), { tries: s.daily.tries, time: 0 });

// ---- keys and ghosts ------------------------------------------------------------------------------------------------

const code = (i: Input) => i.dir + 1 + (i.focus ? 3 : 0);
/** Appends a tick's keys to a recording. */
export function record(keys: Keys, i: Input) {
  const c = code(i);
  if (keys.length && keys[keys.length - 1] === c) keys[keys.length - 2]++;
  else keys.push(1, c);
}
/** Plays a recording back a tick at a time. */
export class Player {
  private i = 0; private left = 0;
  constructor(private keys: Keys) { this.left = keys[0] ?? 0; }
  next(): Input {
    while (this.left <= 0 && this.i + 2 < this.keys.length) { this.i += 2; this.left = this.keys[this.i]; }
    this.left--;
    const c = this.keys[this.i + 1] ?? 1;
    return { dir: ((c % 3) - 1) as Input["dir"], focus: c >= 3 };
  }
}

/** The ghost of a board's best run: the same chart played with its keys, a tick behind nobody. */
export function ghostOf(s: Save, key: string): { state: State; keys: Player; t: number } | null {
  const g = s.ghosts[key];
  if (!g || !s.ghost) return null;
  const { stage, hyper } = parse(key);
  return { state: create({ stage, hyper, seed: chartSeed(stage, hyper) }), keys: new Player(g.keys), t: g.t };
}
/** One tick of the ghost, alongside the run; it stops where its run ended. */
export const ghostStep = (g: NonNullable<ReturnType<typeof ghostOf>>) => { if (!g.state.dead && g.state.t < g.t) { step(g.state, g.keys.next()); g.state.events.length = 0; } };
