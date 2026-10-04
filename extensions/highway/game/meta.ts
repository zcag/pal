// What outlives a run: cash, the garage, records. Stored whole in the
// extension's storage under "save" after every change.
import { CARS, LOCATIONS, PAINT_PRICE, UPGRADE_MAX, upgradeCost, type PlayerCar, type Upgrades } from "./content.ts";

export type Owned = { upgrades: Upgrades; paint: string; paints: string[] };
export type Best = { score: number; distance: number; combo: number; topSpeed: number };
export type Save = {
  v: 1;
  cash: number;
  car: string; // the one you drive
  owned: Record<string, Owned>;
  locations: string[];
  location: string;
  mode: "endless" | "twoway";
  best: Record<string, Best>; // by mode
  totals: { runs: number; distance: number; misses: number; cash: number };
  settings: { camera: number; music: number; sound: number; units: "kmh" | "mph" };
};

/** A staged moment for the store's pictures (the fixture stores it as "scene"): nothing is saved while one plays. */
export type Scene = { show: "garage" | "run" | "results"; location?: string; mode?: "endless" | "twoway"; car?: string; paint?: string; speed?: number; warm?: number; crash?: { you: number; them: number; kind: string; oncoming: boolean } };

export function fresh(): Save {
  const first = CARS[0];
  return {
    v: 1, cash: 0, car: first.id,
    owned: { [first.id]: { upgrades: { speed: 0, handling: 0, brakes: 0 }, paint: first.paint, paints: [first.paint] } },
    locations: [LOCATIONS[0].id], location: LOCATIONS[0].id, mode: "endless",
    best: {}, totals: { runs: 0, distance: 0, misses: 0, cash: 0 },
    settings: { camera: 0, music: 0.6, sound: 1, units: "kmh" },
  };
}

/** A stored save, or a fresh one; anything unknown in it is dropped. */
export function load(raw: unknown): Save {
  const s = fresh();
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Partial<Save>;
  if (typeof r.cash === "number") s.cash = Math.max(0, Math.floor(r.cash));
  if (r.owned) for (const [id, o] of Object.entries(r.owned)) if (CARS.some((c) => c.id === id)) s.owned[id] = o;
  if (r.car && s.owned[r.car]) s.car = r.car;
  if (Array.isArray(r.locations)) s.locations = r.locations.filter((l) => LOCATIONS.some((x) => x.id === l));
  if (!s.locations.includes(LOCATIONS[0].id)) s.locations.unshift(LOCATIONS[0].id);
  if (r.location && s.locations.includes(r.location)) s.location = r.location;
  if (r.mode === "twoway" || r.mode === "endless") s.mode = r.mode;
  if (r.best) s.best = r.best;
  if (r.totals) s.totals = { ...s.totals, ...r.totals };
  if (r.settings) s.settings = { ...s.settings, ...r.settings };
  return s;
}

export const carOf = (id: string) => CARS.find((c) => c.id === id)!;

/** Buy a car: true if it went through. */
export function buyCar(s: Save, car: PlayerCar) {
  if (s.owned[car.id] || s.cash < car.price) return false;
  s.cash -= car.price;
  s.owned[car.id] = { upgrades: { speed: 0, handling: 0, brakes: 0 }, paint: car.paint, paints: [car.paint] };
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

/** Paint a car: a colour it has worn before is free. */
export function paint(s: Save, car: PlayerCar, color: string) {
  const o = s.owned[car.id];
  if (!o) return false;
  if (!o.paints.includes(color)) {
    if (s.cash < PAINT_PRICE) return false;
    s.cash -= PAINT_PRICE;
    o.paints.push(color);
  }
  o.paint = color;
  return true;
}

export function buyLocation(s: Save, id: string) {
  const l = LOCATIONS.find((x) => x.id === id);
  if (!l || s.locations.includes(id) || s.cash < l.price) return false;
  s.cash -= l.price;
  s.locations.push(id);
  s.location = id;
  return true;
}

/** Record a finished run; true when it beat the best score for its mode. */
export function finish(s: Save, mode: string, run: Best & { misses: number; cash: number }) {
  s.cash += run.cash;
  s.totals.runs++;
  s.totals.distance += run.distance;
  s.totals.misses += run.misses;
  s.totals.cash += run.cash;
  const b = s.best[mode];
  const record = !b || run.score > b.score;
  s.best[mode] = {
    score: Math.max(b?.score ?? 0, run.score), distance: Math.max(b?.distance ?? 0, run.distance),
    combo: Math.max(b?.combo ?? 0, run.combo), topSpeed: Math.max(b?.topSpeed ?? 0, run.topSpeed),
  };
  return record;
}
