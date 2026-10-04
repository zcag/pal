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

export type Stats = { speed: number; accel: number; handling: number; brakes: number }; // 1..10 as the garage shows them
export type PlayerCar = {
  id: string; name: string; price: number;
  top: number; // km/h, stock
  mass: number; // kg
  grip: number; // tyre friction
  agility: number; // how hard full lock turns, in g
  brake: number; // g
  engine: "sport" | "sedan";
  paint: string; // the colour it comes in
  extraLife?: boolean;
};

/** The ladder: each about a third dearer than the last, each a bit quicker or sharper. */
export const CARS: PlayerCar[] = [
  { id: "compact-07", name: "Compact '07", price: 0, top: 158, mass: 880, grip: 1.25, agility: 0.96, brake: 0.9, engine: "sedan", paint: "#e8e6e0" },
  { id: "kiri-10", name: "Kiri '10", price: 6000, top: 176, mass: 1150, grip: 1.28, agility: 0.99, brake: 0.92, engine: "sedan", paint: "#2a5caa" },
  { id: "milano-95", name: "Milano '95", price: 12000, top: 192, mass: 980, grip: 1.30, agility: 1.08, brake: 0.95, engine: "sport", paint: "#c81d25" },
  { id: "tozzo-98", name: "Tozzo '98", price: 20000, top: 204, mass: 1260, grip: 1.30, agility: 1.05, brake: 0.95, engine: "sport", paint: "#d8d8d8" },
  { id: "sigil-07", name: "Sigil '07", price: 30000, top: 214, mass: 1300, grip: 1.32, agility: 1.08, brake: 0.98, engine: "sport", paint: "#13161c" },
  { id: "tiara-gt-83", name: "Tiara GT '83", price: 42000, top: 212, mass: 1050, grip: 1.33, agility: 1.18, brake: 0.98, engine: "sport", paint: "#f2f0ea" },
  { id: "asti-stradale-89", name: "Asti Stradale '89", price: 58000, top: 224, mass: 1200, grip: 1.38, agility: 1.24, brake: 1.0, engine: "sport", paint: "#b3121b" },
  { id: "thunderbolt-96", name: "Thunderbolt '96", price: 78000, top: 238, mass: 1320, grip: 1.40, agility: 1.27, brake: 1.02, engine: "sport", paint: "#1b3f8f" },
  { id: "jdm-sport-99", name: "JDM Sport '99", price: 105000, top: 252, mass: 1480, grip: 1.40, agility: 1.24, brake: 1.03, engine: "sport", paint: "#3c4652" },
  { id: "exterminator-00", name: "Exterminator '00", price: 140000, top: 256, mass: 1550, grip: 1.35, agility: 1.15, brake: 1.0, engine: "sport", paint: "#e2b310" },
  { id: "phoenix-455-71", name: "Phoenix 455 '71", price: 180000, top: 250, mass: 1620, grip: 1.30, agility: 1.08, brake: 0.96, engine: "sport", paint: "#0f0f12", extraLife: true },
  { id: "stinger-96", name: "Stinger '96", price: 230000, top: 266, mass: 1400, grip: 1.42, agility: 1.30, brake: 1.05, engine: "sport", paint: "#d6421a" },
  { id: "hazer-turbo-81", name: "Hazer Turbo '81", price: 290000, top: 262, mass: 1230, grip: 1.38, agility: 1.27, brake: 1.02, engine: "sport", paint: "#b9bcc0" },
  { id: "libeccio-v6-91", name: "Libeccio V6 '91", price: 360000, top: 272, mass: 1250, grip: 1.44, agility: 1.33, brake: 1.06, engine: "sport", paint: "#1d6b43" },
  { id: "roadster-00", name: "Roadster '00", price: 440000, top: 276, mass: 980, grip: 1.46, agility: 1.43, brake: 1.08, engine: "sport", paint: "#f0c419" },
  { id: "cheetah-84", name: "Cheetah '84", price: 540000, top: 292, mass: 1500, grip: 1.45, agility: 1.33, brake: 1.08, engine: "sport", paint: "#c0111d" },
  { id: "saba-v12-95", name: "Saba V12 '95", price: 680000, top: 322, mass: 1450, grip: 1.50, agility: 1.40, brake: 1.12, engine: "sport", paint: "#e85d04" },
];

export const PAINTS = ["#e8e6e0", "#13161c", "#9aa0a6", "#c81d25", "#d6421a", "#e2b310", "#1d6b43", "#2a5caa", "#1b3f8f", "#5a2a82", "#b9bcc0", "#7a1424"];
export const PAINT_PRICE = 1500;

export type Upgrades = { speed: number; handling: number; brakes: number }; // 0..5 each
export const UPGRADE_MAX = 5;
/** What a level of an upgrade costs: doubling, from a twentieth of the car's price (as the original). */
export const upgradeCost = (car: PlayerCar, level: number) => Math.round(Math.max(800, car.price / 20) * 2 ** level / 50) * 50;

const G = 9.81, RHO = 1.2, CDA = 0.62, CRR = 0.012, EFF = 0.88;

/** The physics for a car with its upgrades: power solved from the top speed, gears to suit. */
export function spec(car: PlayerCar, up: Upgrades, wheelbase: number): Spec & { agility: number } {
  const top = ((car.top + up.speed * 7) / 3.6) * FEEL.pace; // each speed level is +7 km/h; the world's pace scales it all
  const power = (0.5 * RHO * CDA * top ** 3 + CRR * car.mass * G * top) / EFF / 1000; // kW at the top speed
  const redline = car.engine === "sport" ? 7200 : 6400;
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
  };
}

/** The garage's bars, 1..10, from a car and its upgrades. */
export function stats(car: PlayerCar, up: Upgrades): Stats {
  const k = (v: number, lo: number, hi: number) => Math.max(1, Math.min(10, 1 + ((v - lo) / (hi - lo)) * 9));
  const top = car.top + up.speed * 7;
  return {
    speed: k(top, 150, 340),
    accel: k((top ** 3 / car.mass) / 1e3, 5, 30),
    handling: k(car.agility + up.handling * 0.05, 0.95, 1.65),
    brakes: k(car.brake + up.brakes * 0.06, 0.88, 1.4),
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
export type Location = { id: string; name: string; sky: string; price: number; cash: number; density: number; asphalt: string };
export const LOCATIONS: Location[] = [
  { id: "countryside", name: "Countryside", sky: "partly_cloudy", price: 0, cash: 1, density: 1, asphalt: "asphalt_new" },
  { id: "midday", name: "High Noon", sky: "clear_midday", price: 15000, cash: 1.1, density: 1.05, asphalt: "asphalt_worn" },
  { id: "dusk", name: "Golden Hour", sky: "golden_hour", price: 40000, cash: 1.2, density: 1, asphalt: "asphalt_new" },
  { id: "overcast", name: "Grey Day", sky: "overcast", price: 80000, cash: 1.25, density: 1.15, asphalt: "asphalt_worn" },
  { id: "night", name: "Night Run", sky: "night", price: 150000, cash: 1.4, density: 0.8, asphalt: "asphalt_new" },
];

export type Mode = { id: "endless" | "twoway"; name: string; about: string };
export const MODES: Mode[] = [
  { id: "endless", name: "Endless", about: "Four lanes, all going your way. One crash and the run is over." },
  { id: "twoway", name: "Two-Way", about: "Two lanes each way. The oncoming side pays three times, and touching it ends the run." },
];
