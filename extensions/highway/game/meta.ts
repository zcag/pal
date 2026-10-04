// What outlives a run: cash, the garage, the driver's level and missions,
// records. Stored whole in the extension's storage under "save" after every
// change. `finish` turns a run into everything the end of a run counts up.
import { CARS, LOCATIONS, MODES, PAINT_SETS, UPGRADE_MAX, paintSet, upgradeCost, type ModeId, type PlayerCar, type Upgrades } from "./content.ts";
import { MAX_LEVEL, gainXp, levelCash, newMission, progressOf, statsOf, unlocked, xpFor, xpOfPoints, type Mission, type Unlock } from "./progress.ts";
import type { PayLine, Score } from "./score.ts";

export type Owned = { upgrades: Upgrades; paint: string; paints: string[] };
export type Best = { score: number; distance: number; combo: number; topSpeed: number };
export type Save = {
  v: 2;
  cash: number;
  car: string; // the one you drive
  owned: Record<string, Owned>;
  location: string;
  mode: ModeId;
  level: number;
  xp: number; // toward the next level
  missions: Mission[];
  day: string; // the last day a run paid the day's double (YYYY-MM-DD)
  best: Record<string, Best>; // by mode
  totals: { runs: number; distance: number; misses: number; cash: number };
  settings: { camera: number; music: number; sound: number; units: "kmh" | "mph" };
};

/** A staged moment for the store's pictures (the fixture stores it as "scene"): nothing is saved while one plays. */
export type Scene = { show: "garage" | "run" | "results"; location?: string; mode?: ModeId; car?: string; paint?: string; speed?: number; warm?: number; crash?: { you: number; them: number; kind: string; oncoming: boolean } };

export const NO_UP: Upgrades = { speed: 0, handling: 0, brakes: 0, nitro: 0 };

export function fresh(): Save {
  const first = CARS[0];
  return {
    v: 2, cash: 0, car: first.id,
    owned: { [first.id]: { upgrades: { ...NO_UP }, paint: first.paint, paints: [first.paint] } },
    location: LOCATIONS[0].id, mode: "endless", level: 1, xp: 0, missions: [], day: "",
    best: {}, totals: { runs: 0, distance: 0, misses: 0, cash: 0 },
    settings: { camera: 0, music: 0.6, sound: 1, units: "kmh" },
  };
}

/** A stored save, or a fresh one; anything unknown in it is dropped, an older save is carried over. */
export function load(raw: unknown): Save {
  const s = fresh();
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Partial<Save> & { locations?: string[] };
  if (typeof r.cash === "number") s.cash = Math.max(0, Math.floor(r.cash));
  if (r.owned) for (const [id, o] of Object.entries(r.owned)) if (CARS.some((c) => c.id === id)) s.owned[id] = { ...o, upgrades: { ...NO_UP, ...o.upgrades } };
  if (r.car && s.owned[r.car]) s.car = r.car;
  if (typeof r.level === "number") s.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(r.level)));
  if (typeof r.xp === "number") s.xp = Math.max(0, r.xp);
  if (Array.isArray(r.missions)) s.missions = r.missions.slice(0, 3);
  if (typeof r.day === "string") s.day = r.day;
  if (r.location && places(s).some((l) => l.id === r.location)) s.location = r.location;
  if (r.mode && modes(s).some((m) => m.id === r.mode)) s.mode = r.mode;
  if (r.best) s.best = r.best;
  if (r.totals) s.totals = { ...s.totals, ...r.totals };
  if (r.settings) s.settings = { ...s.settings, ...r.settings };
  return s;
}

export const carOf = (id: string) => CARS.find((c) => c.id === id)!;

/** The places, modes and paint sets the driver's level has opened. */
export const places = (s: Save) => LOCATIONS.filter((l, i) => i === 0 || unlocked(s.level).some((u) => u.kind === "place" && u.id === l.id));
export const modes = (s: Save) => MODES.filter((m, i) => i === 0 || unlocked(s.level).some((u) => u.kind === "mode" && u.id === m.id));
export const paintsOpen = (s: Save) => PAINT_SETS.filter((p, i) => i === 0 || unlocked(s.level).some((u) => u.kind === "paints" && u.id === p.id));
/** The level a place or mode opens at. */
export const opensAt = (kind: "place" | "mode", id: string) => {
  for (let l = 1; l <= MAX_LEVEL; l++) if (unlocked(l).some((u) => u.kind === kind && u.id === id)) return l;
  return 1;
};

/** Buy a car: true if it went through. */
export function buyCar(s: Save, car: PlayerCar) {
  if (s.owned[car.id] || s.cash < car.price) return false;
  s.cash -= car.price;
  s.owned[car.id] = { upgrades: { ...NO_UP }, paint: car.paint, paints: [car.paint] };
  s.car = car.id;
  return true;
}

export function buyUpgrade(s: Save, car: PlayerCar, kind: keyof Upgrades) {
  const o = s.owned[car.id];
  if (!o || o.upgrades[kind] >= UPGRADE_MAX) return false;
  const cost = upgradeCost(car, o.upgrades[kind]);
  if (s.cash < cost) return false;
  s.cash -= cost;
  o.upgrades[kind]++;
  return true;
}

/** Paint a car: a colour it has worn before is free; a new one costs its collection's price, if open. */
export function paint(s: Save, car: PlayerCar, color: string) {
  const o = s.owned[car.id], set = paintSet(color);
  if (!o || !paintsOpen(s).includes(set)) return false;
  if (!o.paints.includes(color)) {
    if (s.cash < set.price) return false;
    s.cash -= set.price;
    o.paints.push(color);
  }
  o.paint = color;
  return true;
}

/** Keep three missions on the board. */
export function fillMissions(s: Save, rnd: () => number = Math.random) {
  while (s.missions.length < 3) s.missions.push(newMission(s.level, carOf(s.car).top, s.missions, rnd));
}

/** Everything the end of a run shows, in the order it counts up. */
export type Result = {
  lines: PayLine[]; // what the driving paid
  mults: { label: string; mult: number }[]; // the place, the mode, the day's first run
  cash: number; // the run's pay after its multipliers
  missions: { mission: Mission; done: boolean; progress: number }[];
  missionCash: number; missionXp: number;
  xp: number; // all XP gained
  before: { level: number; xp: number }; after: { level: number; xp: number };
  levels: { level: number; cash: number; unlocks: Unlock[] }[]; // levels reached and what each gave
  record: boolean;
};

/** Pay a finished run into the save. `today` as YYYY-MM-DD. */
export function finish(s: Save, score: Score, mode: ModeId, location: string, today: string): Result {
  const lines = score.pay();
  const mults: Result["mults"] = [];
  const place = LOCATIONS.find((l) => l.id === location)!, m = MODES.find((x) => x.id === mode)!;
  if (place.cash !== 1) mults.push({ label: place.name, mult: place.cash });
  if (m.cash !== 1) mults.push({ label: m.name, mult: m.cash });
  const first = s.day !== today && score.distance > 500;
  if (first) { mults.push({ label: "First run today", mult: 2 }); s.day = today; }
  const cash = Math.round(lines.reduce((a, l) => a + l.amount, 0) * mults.reduce((a, x) => a * x.mult, 1));

  // missions: the ones this run finished pay and make way for new ones
  const stats = statsOf(score, mode);
  const missions = s.missions.map((mi) => ({ mission: mi, progress: progressOf(mi, stats), done: progressOf(mi, stats) >= 1 }));
  const missionCash = missions.filter((x) => x.done).reduce((a, x) => a + x.mission.reward.cash, 0);
  const missionXp = missions.filter((x) => x.done).reduce((a, x) => a + x.mission.reward.xp, 0);

  const xp = xpOfPoints(score.points) + missionXp;
  const before = { level: s.level, xp: s.xp };
  const g = gainXp(s.level, s.xp, xp);
  const levels: Result["levels"] = [];
  for (let l = s.level + 1; l <= g.level; l++) levels.push({ level: l, cash: levelCash(l), unlocks: unlocked(l).filter((u) => !unlocked(l - 1).includes(u)) });
  s.level = g.level; s.xp = g.xp;

  s.cash += cash + missionCash + levels.reduce((a, l) => a + l.cash, 0);
  s.missions = s.missions.filter((_, i) => !missions[i].done);
  fillMissions(s);
  s.totals.runs++;
  s.totals.distance += score.distance;
  s.totals.misses += score.misses;
  s.totals.cash += cash + missionCash;
  const b = s.best[mode];
  const record = !b || score.points > b.score;
  s.best[mode] = {
    score: Math.max(b?.score ?? 0, Math.round(score.points)), distance: Math.max(b?.distance ?? 0, score.distance),
    combo: Math.max(b?.combo ?? 0, score.bestCombo), topSpeed: Math.max(b?.topSpeed ?? 0, score.topSpeed),
  };
  return { lines, mults, cash, missions, missionCash, missionXp, xp, before, after: { level: s.level, xp: s.xp }, levels, record };
}

export { xpFor };
