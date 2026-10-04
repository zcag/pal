// Every number and name: the cars you can drive, what fills the traffic,
// the places, and how the stats turn into a car that drives (spec()).
import type { Spec } from "./vehicle.ts";

/** How driving feels (DESIGN.md, "Feel").
 *  pace: the world goes by 1.4 times what the dial says (Traffic Racer's 1.66 makes realistic cars
 *    look like toys; true scale feels slow).
 *  lean: the body rolls 45% of the original's 4 degrees + 0.05 per km/h at full lock (about 5 at 160).
 *  yaw: the car is drawn turned 85% of the way it actually heads: into the move, never a drift.
 *  across: how fast it crosses, 1 = 5.5 m/s + 7% of the speed (about 10 m/s at 100, 13 at 200 on the dial).
 *  ramp: seconds to full steering, the original's 0.17: a tap nudges, holding commits.
 *  brake: how much harder than a tyre's grip the brakes stop the car (1.9: about 65 km/h a second on
 *    the dial for brakes of 1 g; the original's run 40 to 100+), down to `crawl` km/h, never a stop. */
export const FEEL = { pace: 1.4, lean: 0.45, yaw: 0.85, across: 1, ramp: 0.17, brake: 1.9, crawl: 30 };

/** The classes, cheapest first, each from its first car on: the garage names a car's. */
export const CLASSES = [
  { id: "city", name: "City", from: "compact-07" },
  { id: "sport", name: "Sport", from: "tozzo-98" },
  { id: "muscle", name: "Muscle", from: "thunderbolt-96" },
  { id: "gt", name: "GT", from: "stinger-96" },
  { id: "super", name: "Super", from: "roadster-00" },
] as const;
export const classOf = (car: PlayerCar) => [...CLASSES].reverse().find((c) => CARS.indexOf(car) >= CARS.findIndex((x) => x.id === c.from))!;

/** Where each engine note peaks, rpm. */
export const REDLINE: Record<PlayerCar["engine"], number> = { sedan: 6400, sport: 7200, muscle: 6500, gt: 7000, super: 8000 };

/** The top speed traffic is set by, km/h: the original scales it with yours, so every car meets the same
 *  road; here it follows only half of the climb above the first car, so a faster car truly outruns it
 *  (passes more cars, a minute) and is worth buying. */
export const trafficTop = (car: PlayerCar, up: Upgrades) => 158 + (car.top + up.speed * 7 - 158) * 0.5;

export type Stats = { speed: number; accel: number; handling: number; brakes: number }; // 1..10 as the garage shows them
export type PlayerCar = {
  id: string; name: string; price: number;
  top: number; // km/h, stock
  mass: number; // kg
  grip: number; // tyre friction
  agility: number; // how hard full lock turns, in g
  brake: number; // g
  engine: "sedan" | "sport" | "muscle" | "gt" | "super";
  paint: string; // the colour it comes in
};

/** The ladder, in five classes (CLASSES): every car quicker, sharper and better on the brakes than the one
 *  before, the big jumps between classes, each class with its own engine note. Prices: scripts/economy.ts. */
export const CARS: PlayerCar[] = [
  { id: "compact-07", name: "Compact '07", price: 0, top: 158, mass: 880, grip: 1.25, agility: 0.96, brake: 0.90, engine: "sedan", paint: "#e8e6e0" },
  { id: "kiri-10", name: "Kiri '10", price: 2500, top: 170, mass: 1150, grip: 1.28, agility: 1.00, brake: 0.93, engine: "sedan", paint: "#2a5caa" },
  { id: "milano-95", name: "Milano '95", price: 5000, top: 182, mass: 980, grip: 1.30, agility: 1.05, brake: 0.96, engine: "sedan", paint: "#c81d25" },
  { id: "tozzo-98", name: "Tozzo '98", price: 7500, top: 200, mass: 1260, grip: 1.30, agility: 1.10, brake: 0.98, engine: "sport", paint: "#d8d8d8" },
  { id: "sigil-07", name: "Sigil '07", price: 10000, top: 210, mass: 1300, grip: 1.32, agility: 1.13, brake: 1.00, engine: "sport", paint: "#13161c" },
  { id: "tiara-gt-83", name: "Tiara GT '83", price: 12500, top: 220, mass: 1050, grip: 1.33, agility: 1.17, brake: 1.02, engine: "sport", paint: "#f2f0ea" },
  { id: "asti-stradale-89", name: "Asti Stradale '89", price: 15000, top: 230, mass: 1200, grip: 1.38, agility: 1.21, brake: 1.04, engine: "sport", paint: "#b3121b" },
  { id: "thunderbolt-96", name: "Thunderbolt '96", price: 18000, top: 245, mass: 1320, grip: 1.40, agility: 1.23, brake: 1.05, engine: "muscle", paint: "#1b3f8f" },
  { id: "jdm-sport-99", name: "JDM Sport '99", price: 21500, top: 255, mass: 1480, grip: 1.40, agility: 1.26, brake: 1.06, engine: "muscle", paint: "#3c4652" },
  { id: "exterminator-00", name: "Exterminator '00", price: 25500, top: 265, mass: 1550, grip: 1.35, agility: 1.29, brake: 1.07, engine: "muscle", paint: "#e2b310" },
  { id: "phoenix-455-71", name: "Phoenix 455 '71", price: 30000, top: 275, mass: 1620, grip: 1.30, agility: 1.31, brake: 1.08, engine: "muscle", paint: "#0f0f12" },
  { id: "stinger-96", name: "Stinger '96", price: 35000, top: 290, mass: 1560, grip: 1.42, agility: 1.35, brake: 1.10, engine: "gt", paint: "#d6421a" },
  { id: "hazer-turbo-81", name: "Hazer Turbo '81", price: 41000, top: 300, mass: 1230, grip: 1.38, agility: 1.39, brake: 1.12, engine: "gt", paint: "#b9bcc0" },
  { id: "libeccio-v6-91", name: "Libeccio V6 '91", price: 48000, top: 310, mass: 1250, grip: 1.44, agility: 1.43, brake: 1.14, engine: "gt", paint: "#1d6b43" },
  { id: "roadster-00", name: "Roadster '00", price: 56000, top: 325, mass: 980, grip: 1.46, agility: 1.48, brake: 1.16, engine: "super", paint: "#f0c419" },
  { id: "cheetah-84", name: "Cheetah '84", price: 65000, top: 340, mass: 1500, grip: 1.45, agility: 1.53, brake: 1.18, engine: "super", paint: "#c0111d" },
  { id: "saba-v12-95", name: "Saba V12 '95", price: 76000, top: 360, mass: 1450, grip: 1.50, agility: 1.58, brake: 1.22, engine: "super", paint: "#e85d04" },
];

/** Paints in collections: the first is open from the start, the others open with driver levels (game/progress.ts). */
export const PAINT_SETS: { id: string; name: string; colors: string[]; price: number }[] = [
  { id: "basic", name: "Solid", colors: ["#e8e6e0", "#13161c", "#9aa0a6", "#c81d25", "#d6421a", "#e2b310", "#1d6b43", "#2a5caa", "#1b3f8f", "#5a2a82", "#b9bcc0", "#7a1424"], price: 800 },
  { id: "metallic", name: "Metallic", colors: ["#b8bcc4", "#3d4a5c", "#8c1c13", "#0d5c63", "#c5a15a", "#4a2c6b"], price: 2000 },
  { id: "matte", name: "Matte", colors: ["#2b2d2f", "#5c6b4a", "#6e6a62", "#3b4f6b"], price: 3500 },
  { id: "deep", name: "Deep", colors: ["#0b1d3a", "#1a3b2a", "#3a0d12", "#ff6a00"], price: 5000 },
];
export const PAINTS = PAINT_SETS.flatMap((p) => p.colors);
export const paintSet = (color: string) => PAINT_SETS.find((p) => p.colors.includes(color)) ?? PAINT_SETS[0];

export type Upgrades = { speed: number; handling: number; brakes: number; nitro: number }; // 0..5 each
export const UPGRADE_MAX = 5;
/** What a level of an upgrade costs: 6% of the car's price (at least 200), half again each level; tuned by scripts/economy.ts. */
export const upgradeCost = (car: PlayerCar, level: number) => Math.round((Math.max(200, car.price * 0.06) * 1.5 ** level) / 50) * 50;

const G = 9.81, RHO = 1.2, CDA = 0.62, CRR = 0.012, EFF = 0.88;

/** The physics for a car with its upgrades: power solved from the top speed, gears to suit. */
export function spec(car: PlayerCar, up: Upgrades, wheelbase: number): Spec & { agility: number } {
  const top = ((car.top + up.speed * 7) / 3.6) * FEEL.pace; // each speed level is +7 km/h; the world's pace scales it all
  const power = (0.5 * RHO * CDA * top ** 3 + CRR * car.mass * G * top) / EFF / 1000; // kW at the top speed
  const redline = REDLINE[car.engine];
  const wheelRadius = 0.32;
  // top gear just reaches the redline a little past top speed; the rest step down geometrically
  const topRatio = (redline * Math.PI / 30) * wheelRadius / (top * 1.04);
  const n = 6, first = 13.5; // overall: gearbox times final drive
  const final = 1; // folded into the ratios
  const gears = Array.from({ length: n }, (_, i) => first * Math.pow(topRatio / first, i / (n - 1)) * final);
  return {
    mass: car.mass, wheelbase, cgFront: 0.55, cgHeight: 0.5,
    power: power * 1.08, torque: (power * 1000 * 1.08) / ((redline * 0.62 * Math.PI) / 30), redline, idle: 850,
    gears, final, wheelRadius, drag: CDA,
    grip: car.grip + up.handling * 0.03,
    corner: 22,
    brake: car.brake + up.brakes * 0.06,
    steerMax: 0.6,
    agility: car.agility + up.handling * 0.05,
    top,
  };
}

/** The nitro a car carries with its upgrade: how long a full bar burns and how hard it pushes. */
export const nitroOf = (up: Upgrades) => ({ burn: 2.5 + up.nitro * 0.5, push: 6 + up.nitro * 1.2, fill: 1 + up.nitro * 0.15 });

/** The garage's bars, 1..10, from a car and its upgrades. */
export function stats(car: PlayerCar, up: Upgrades): Stats {
  const k = (v: number, lo: number, hi: number) => Math.max(1, Math.min(10, 1 + ((v - lo) / (hi - lo)) * 9));
  const top = car.top + up.speed * 7;
  return {
    speed: k(top, 150, 400),
    accel: k((top ** 3 / car.mass) / 1e3, 4, 45),
    handling: k(car.agility + up.handling * 0.05, 0.95, 1.85),
    brakes: k(car.brake + up.brakes * 0.06, 0.88, 1.55),
  };
}

/** Traffic: what each model is, how it is painted, how often it turns up. */
export type TrafficKind = { id: string; heavy?: boolean; livery?: boolean; weight: number; colors?: string[] };
const CIVIL = ["#d8d8d8", "#202226", "#7a0f12", "#3a4a5c", "#9da3a8", "#1d3d2a", "#c9c2b0", "#5b1d3a", "#e5e5e0", "#28406b", "#b8b8b8", "#0f0f12", "#8a6b3d"];
export const TRAFFIC: TrafficKind[] = [
  { id: "carter-98", weight: 3, colors: CIVIL }, { id: "fairheaven-lt-80", weight: 2, colors: CIVIL }, { id: "fairheaven-sw-84", weight: 2, colors: CIVIL },
  { id: "illinois-90", weight: 3, colors: CIVIL }, { id: "kiri-94", weight: 3, colors: CIVIL }, { id: "murphy-92", weight: 3, colors: CIVIL },
  { id: "negotiator-80", weight: 2, colors: CIVIL }, { id: "olympic-95", weight: 3, colors: CIVIL }, { id: "trinity-03", weight: 3, colors: CIVIL },
  { id: "urban-10", weight: 3, colors: CIVIL }, { id: "phoenix-93", weight: 1, colors: CIVIL }, { id: "ace-11", weight: 2, colors: CIVIL },
  { id: "compact-07", weight: 1, colors: CIVIL }, { id: "kiri-10", weight: 2, colors: CIVIL },
  { id: "canyon-75-taxi", weight: 1, livery: true }, { id: "conquer-89-pickup", weight: 2, colors: CIVIL },
  { id: "rancher-80-lifted", weight: 1, colors: CIVIL }, { id: "lightbody-90-md-pickup", weight: 1, colors: CIVIL },
  { id: "lightbody-90-md-flatbed", weight: 1, heavy: true, colors: ["#e8e8e8", "#5a5f66", "#7a0f12"] },
  { id: "lightbody-90-md-utility", weight: 1, heavy: true, colors: ["#f2f2f2", "#e2b310"] },
  { id: "shvan-92", weight: 2, heavy: true, colors: ["#efefef", "#c9c2b0", "#3a4a5c", "#202226"] },
  { id: "shvan-92-traveller", weight: 1, heavy: true, colors: ["#efefef", "#1d3d2a", "#7a0f12"] },
  { id: "lct-3000-95", weight: 2, heavy: true, colors: ["#f2f2f2", "#e8e8e8", "#2a5caa"] },
  { id: "lct-3000-07", weight: 1, heavy: true, colors: ["#f2f2f2", "#d8d8d8"] },
  { id: "shvan-92-ambulance", weight: 0.3, heavy: true, livery: true },
  { id: "illinois-90-police-cruiser", weight: 0.3, livery: true },
];

/** Places: a sky over the land, how it pays, how its traffic runs. */
/** Places: a sky over the land, how it pays, how its traffic runs. They open with driver levels (game/progress.ts). */
export type Location = { id: string; name: string; sky: string; cash: number; density: number; asphalt: string };
export const LOCATIONS: Location[] = [
  { id: "countryside", name: "Countryside", sky: "partly_cloudy", cash: 1, density: 1, asphalt: "asphalt_new" },
  { id: "midday", name: "High Noon", sky: "clear_midday", cash: 1.1, density: 1.05, asphalt: "asphalt_new" },
  { id: "dusk", name: "Golden Hour", sky: "golden_hour", cash: 1.2, density: 1, asphalt: "asphalt_new" },
  { id: "overcast", name: "Grey Day", sky: "overcast", cash: 1.25, density: 1.15, asphalt: "asphalt_new" },
  { id: "night", name: "Night Run", sky: "night", cash: 1.4, density: 0.8, asphalt: "asphalt_new" },
];

export type ModeId = "endless" | "twoway" | "time" | "trap";
export type Mode = { id: ModeId; name: string; about: string; twoWay?: boolean; cash: number };
export const MODES: Mode[] = [
  { id: "endless", name: "Endless", about: "Four lanes, all going your way. One crash and the run is over.", cash: 1 },
  { id: "twoway", name: "Two-Way", about: "Two lanes each way. The oncoming side pays three times, and touching it ends the run.", twoWay: true, cash: 1.2 },
  { id: "time", name: "Time Attack", about: "A clock from 60 seconds. Every 2.5 km adds time, a little less each time.", cash: 1.15 },
  { id: "trap", name: "Speed Trap", about: "Stay above a speed that rises every 10 seconds. Three seconds under it ends the run.", cash: 1.3 },
];
