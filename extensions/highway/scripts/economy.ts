// What the game pays and how fast a player climbs the garage, measured: bots of four skills
// (game/bot.ts) play real runs headless (game/drive.ts at 1/120 s) for each car, upgrade level and
// mode, then simulated players start from a fresh save and spend what they earn through the game's
// own meta.finish (multipliers, missions, levels, the day's double), buying the next car when they
// can and otherwise an upgrade. Everything is read from content/meta/progress at run time, so it
// keeps working as those change; --rec applies the recommended numbers below as overrides.
//   bun extensions/highway/scripts/economy.ts [--runs 12] [--profile regular,good] [--cars all|0,3,8]
//     [--levels 0,2,5] [--modes endless,twoway] [--cap 600] [--players 200] [--day 40] [--spend 0.3]
//     [--rec] [--json out.json] [--table]
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { Drive } from "../game/drive.ts";
import { Bot, SKILLS } from "../game/bot.ts";
import * as content from "../game/content.ts";
import * as meta from "../game/meta.ts";
import { Score } from "../game/score.ts";
import { ONE_WAY, TWO_WAY } from "../game/layout.ts";
import carsJson from "../surface/cars/cars.json";

const { CARS, MODES, LOCATIONS } = content;
const DT = 1 / 120;
const sizes = new Map((carsJson as { id: string; size: number[] }[]).map((c) => [c.id, { x: c.size[0], z: c.size[2] }]));
const KINDS = Object.keys((meta as { NO_UP?: object }).NO_UP ?? meta.fresh().owned[CARS[0].id].upgrades) as (keyof content.Upgrades)[];
const uniform = (l: number) => Object.fromEntries(KINDS.map((k) => [k, l])) as content.Upgrades;

// ---------------------------------------------------------------- one run

type Run = { car: number; level: number; profile: string; mode: string; time: number; cash: number; end: string; score: Record<string, unknown> };

/** Play one run to its end (a crash, a mode's rule, crawling for 20 s, or the cap). */
function play(car: number, level: number, profile: string, mode: string, seed: number, cap: number): Run {
  const c = CARS[car], m = MODES.find((x) => x.id === mode) as { twoWay?: boolean; id: string };
  const size = sizes.get(c.id)!;
  let end = "", how = "";
  const d = new Drive(m.twoWay || mode === "twoway" ? TWO_WAY : ONE_WAY, c, uniform(level), size, size.z * 0.58, (id) => sizes.get(id), {
    crash: (x) => { end = "crash"; how = x.oncoming ? "head-on" : ""; },
  }, { seed: seed * 7919 + 13, mode: mode as content.ModeId });
  const bot = new Bot(d, SKILLS[profile], seed);
  let mark = 0, markT = 0;
  while (!d.over && d.score.time < cap) {
    d.step(DT, bot.step(DT));
    // a player never sits behind a wreck at a crawl for long: count it as giving up
    if (d.score.time - markT >= 20) { if (d.score.distance - mark < 20 * 40 / 3.6) { end = "stuck"; break; } mark = d.score.distance; markT = d.score.time; }
  }
  if (end === "crash" && !how) {
    // what it hit and how: a car cutting in (mid lane change), from behind, or alongside
    const v = d.veh, n = d.traffic.cars.filter((x) => x.hit).sort((a, b) => Math.hypot(a.x - v.x, a.z - v.z) - Math.hypot(b.x - v.x, b.z - v.z))[0];
    how = !n ? "?" : n.from !== n.lane ? "cut-in" : Math.abs(n.x - v.x) > (n.width + size.x) / 2 * 0.7 ? "side" : "rear-end";
    if (bot.lapsing > 0) how += "*";
  }
  const ended = (d as { ended?: string | null }).ended;
  if (!end) end = ended && ended !== "crash" ? ended : d.score.time >= cap ? "cap" : "?";
  return { car, level, profile, mode, time: d.score.time, cash: d.score.cash(), end: how ? `${end}:${how}` : end, score: { ...d.score } };
}

// ---------------------------------------------------------------- workers

async function runAll(jobs: Parameters<typeof play>[], threads: number) {
  const out: Run[] = [];
  let next = 0, done = 0;
  const t0 = performance.now();
  await Promise.all(Array.from({ length: Math.min(threads, jobs.length) }, () => new Promise<void>((res) => {
    const w = new Worker(new URL(import.meta.url));
    const feed = () => {
      if (next >= jobs.length) { w.terminate(); res(); return; }
      const [car, level, profile, mode, seed, cap] = jobs[next++];
      w.postMessage({ car, level, profile, mode, seed, cap });
    };
    w.on("message", (r: Run) => { out.push(r); if (++done % 100 === 0) process.stderr.write(`\r${done}/${jobs.length} runs, ${((performance.now() - t0) / 1000).toFixed(0)} s`); feed(); });
    feed();
  })));
  process.stderr.write(`\r${jobs.length} runs in ${((performance.now() - t0) / 1000).toFixed(0)} s\n`);
  return out;
}

// ---------------------------------------------------------------- overrides

/** A proposal to try against the game's own numbers with --rec: car prices, upgrade costs, pay per line of the run's pay
 * ("mode:label" keys scale one mode only). It holds the game's numbers as of the last tuning (2026-10-04); change it to try others. */
const REC = {
  prices: CARS.map((c) => c.price),
  upgrade: { frac: 0.06, min: 200, growth: 1.5 },
  pay: {} as Record<string, number>,
};
type Over = typeof REC;

/** The mode the run being paid was driven in, for mode-specific pay overrides. */
let paying = "";
/** Apply overrides in memory only: prices on the CARS objects, a pay() that scales lines by label ("mode:label" for one mode). */
function apply(o: Over | null) {
  const cost = o ? (car: content.PlayerCar, l: number) => Math.round(Math.max(o.upgrade.min, car.price * o.upgrade.frac) * o.upgrade.growth ** l / 50) * 50 : content.upgradeCost;
  if (o) {
    CARS.forEach((c, i) => { if (o.prices[i] !== undefined) c.price = o.prices[i]; });
    const pay = Score.prototype.pay;
    Score.prototype.pay = function () { return pay.call(this).map((l) => ({ ...l, amount: Math.round(l.amount * Object.entries(o.pay).reduce((a, [k, v]) => { const [m, label] = k.includes(":") ? k.split(":") : ["", k]; return (!m || m === paying) && l.label.startsWith(label) ? a * v : a; }, 1)) })); };
  }
  return cost;
}

// ---------------------------------------------------------------- projection

type Buy = { t: number; run: number; what: string; cost: number };

/** One player from a fresh save: runs drawn from the pools, paid through meta.finish, spending as it goes. */
function career(pools: Map<string, Run[]>, profile: string, modes: string[], levels: number[], cost: (c: content.PlayerCar, l: number) => number, o: { hours: number; day: number; spend: number; rnd: () => number }) {
  const s = meta.fresh(), buys: Buy[] = [], income = { run: 0, other: 0 };
  let t = 0, runs = 0, day = 0, dayT = 0;
  const rate = (car: number, level: number, mode: string) => { const p = pools.get(`${car}|${level}|${profile}|${mode}`) ?? []; return p.reduce((a, r) => a + r.cash, 0) / Math.max(1, p.reduce((a, r) => a + r.time, 0)); };
  while (t < o.hours * 3600 && runs < 20000) {
    const ci = CARS.findIndex((c) => c.id === s.car), up = s.owned[s.car].upgrades;
    const avg = KINDS.reduce((a, k) => a + up[k], 0) / KINDS.length;
    const lvl = levels.reduce((b, l) => (Math.abs(l - avg) < Math.abs(b - avg) ? l : b), levels[0]);
    // the mode: whichever open one pays best per minute for this player (as far as the pools know)
    const open = (meta.modes?.(s) ?? MODES).map((m) => m.id).filter((m) => modes.includes(m));
    const mode = open.reduce((b, m) => (rate(ci, lvl, m) * ((MODES.find((x) => x.id === m) as { cash?: number }).cash ?? 1) > rate(ci, lvl, b) * ((MODES.find((x) => x.id === b) as { cash?: number }).cash ?? 1) ? m : b), open[0] ?? "endless");
    const place = (meta.places?.(s) ?? LOCATIONS).reduce((b, l) => (l.cash > b.cash ? l : b));
    // a car the pools skipped plays like the nearest one they have
    let pool = pools.get(`${ci}|${lvl}|${profile}|${mode}`);
    for (let dd = 1; !pool && dd < CARS.length; dd++) pool = pools.get(`${ci - dd}|${lvl}|${profile}|${mode}`) ?? pools.get(`${ci + dd}|${lvl}|${profile}|${mode}`);
    const r = pool![Math.floor(o.rnd() * pool!.length)];
    const score = Object.assign(new Score(), structuredClone(r.score));
    if (dayT >= o.day * 60) { day++; dayT = 0; }
    const before = s.cash;
    paying = mode;
    const res = meta.finish(s, score, mode as content.ModeId, place.id, `d${day}`) as { cash: number } | boolean;
    const paid = typeof res === "object" ? res.cash : 0;
    income.run += paid; income.other += s.cash - before - paid;
    t += r.time; dayT += r.time; runs++;
    // spending: the next car the moment it is affordable, else the cheapest upgrade if it doesn't set the car back much
    for (;;) {
      const owned = CARS.findIndex((c) => c.id === s.car), next = CARS[owned + 1];
      if (next && s.cash >= next.price) { meta.buyCar(s, next); buys.push({ t, run: runs, what: next.id, cost: next.price }); continue; }
      const car = CARS[owned], u = s.owned[car.id].upgrades;
      const k = KINDS.filter((x) => u[x] < content.UPGRADE_MAX).sort((a, b) => cost(car, u[a]) - cost(car, u[b]))[0];
      if (!k) break;
      const c = cost(car, u[k]);
      if (s.cash < c || (next && c > o.spend * next.price)) break;
      s.cash -= c; u[k]++;
      buys.push({ t, run: runs, what: `${car.id}:${k}${u[k]}`, cost: c });
    }
    if (!CARS[CARS.findIndex((c) => c.id === s.car) + 1] && KINDS.every((k) => s.owned[s.car].upgrades[k] >= content.UPGRADE_MAX)) break;
  }
  return { buys, runs, t, level: s.level, income };
}

const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const pct = (a: number[], p: number) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : NaN; };
const hm = (s: number) => (Number.isFinite(s) ? (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : `${(s / 60).toFixed(0)}m`) : "never");

// ---------------------------------------------------------------- main

async function main() {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
  const has = (k: string) => process.argv.includes(`--${k}`);
  const N = +arg("runs", "12"), cap = +arg("cap", "600");
  const profiles = arg("profile", "regular,good").split(",");
  const cars = arg("cars", "all") === "all" ? CARS.map((_, i) => i) : arg("cars", "").split(",").map(Number);
  const levels = arg("levels", "0,2,5").split(",").map(Number);
  const modes = arg("modes", "endless,twoway").split(",");
  const threads = +arg("threads", String(Math.max(1, navigator.hardwareConcurrency - 2)));

  const jobs: Parameters<typeof play>[] = [];
  for (const p of profiles) for (const m of modes) for (const c of cars) for (const l of levels) for (let i = 0; i < N; i++) jobs.push([c, l, p, m, 1 + i + 1000 * c, cap]);
  const runs = await runAll(jobs, threads);
  const pools = new Map<string, Run[]>();
  for (const r of runs) { const k = `${r.car}|${r.level}|${r.profile}|${r.mode}`; (pools.get(k) ?? pools.set(k, []).get(k)!).push(r); }

  // per combo: what a run is like and what it pays (before the place's, mode's and day's multipliers)
  const combos = [...pools.entries()].map(([k, rs]) => {
    const [car, level, profile, mode] = k.split("|"), sc = rs.map((r) => r.score as Record<string, number>);
    const mean = (f: (s: Record<string, number>) => number) => sc.reduce((a, s) => a + f(s), 0) / sc.length;
    const ends: Record<string, number> = {};
    for (const r of rs) ends[r.end] = (ends[r.end] ?? 0) + 1;
    const time = mean((s) => s.time), cash = rs.reduce((a, r) => a + r.cash, 0) / rs.length;
    // what each line of the pay is worth a minute (label up to its first number: "Best combo ×7" -> "Best combo")
    const lines: Record<string, number> = {};
    for (const r of rs) for (const l of Object.assign(new Score(), r.score).pay()) { const key = l.label.replace(/\s*[×\d].*$/, ""); lines[key] = (lines[key] ?? 0) + (l.amount / (time * rs.length)) * 60; }
    return { car: CARS[+car].id, level: +level, profile, mode, runs: rs.length, time, medTime: med(rs.map((r) => r.time)), km: mean((s) => s.distance) / 1000, avgKmh: mean((s) => s.distance) / time * 3.6, points: mean((s) => s.points), misses: mean((s) => s.misses), combo: mean((s) => s.bestCombo), cash, perMin: (cash / time) * 60, modeMult: (MODES.find((x) => x.id === mode) as { cash?: number }).cash ?? 1, lines, ends };
  });
  if (has("table") || !has("quiet")) {
    console.log("\nper run (pay before multipliers; ends: crash:how, * = while looking away)");
    console.log("profile  mode     car                lv  len(s) med   km   km/h  points   miss combo  $/run  $/min  ends");
    for (const c of combos.sort((a, b) => a.profile.localeCompare(b.profile) || a.mode.localeCompare(b.mode) || CARS.findIndex((x) => x.id === a.car) - CARS.findIndex((x) => x.id === b.car) || a.level - b.level))
      console.log(`${c.profile.padEnd(8)} ${c.mode.padEnd(8)} ${c.car.padEnd(18)} ${String(c.level).padStart(2)} ${c.time.toFixed(0).padStart(6)} ${c.medTime.toFixed(0).padStart(5)} ${c.km.toFixed(1).padStart(5)} ${c.avgKmh.toFixed(0).padStart(5)} ${c.points.toFixed(0).padStart(7)} ${c.misses.toFixed(1).padStart(6)} ${c.combo.toFixed(1).padStart(5)} ${c.cash.toFixed(0).padStart(6)} ${c.perMin.toFixed(0).padStart(6)}  ${Object.entries(c.ends).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}  |  /min: ${Object.entries(c.lines).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")}`);
  }

  // careers, now and with the recommended numbers
  const out: Record<string, unknown> = { combos, careers: {} };
  const hours = +arg("hours", "30"), P = +arg("players", "200"), day = +arg("day", "40"), spend = +arg("spend", "0.3");
  const variants = has("rec") ? [["current", null], ["recommended", REC]] as const : [["current", null]] as const;
  const original = CARS.map((c) => c.price), pay0 = Score.prototype.pay;
  for (const [name, o] of variants) {
    CARS.forEach((c, i) => (c.price = original[i])); Score.prototype.pay = pay0;
    const cost = apply(o);
    console.log(`\n=== careers: ${name} (${P} players each, ${day} min a day, upgrades only under ${spend * 100}% of the next car)`);
    for (const p of profiles) {
      let seed = 99;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const cs = Array.from({ length: P }, () => career(pools, p, modes, levels, cost, { hours, day, spend, rnd }));
      const carAt = CARS.map((c, i) => (i === 0 ? [0] : cs.map((x) => x.buys.find((b) => b.what === c.id)?.t ?? Infinity)));
      const runAt = CARS.map((c, i) => (i === 0 ? [0] : cs.map((x) => x.buys.find((b) => b.what === c.id)?.run ?? Infinity)));
      console.log(`\n${p}: first purchase after run ${med(cs.map((x) => x.buys[0]?.run ?? Infinity))} (p90 ${pct(cs.map((x) => x.buys[0]?.run ?? Infinity), 0.9)}); income from runs ${(100 * med(cs.map((x) => x.income.run / (x.income.run + x.income.other)))).toFixed(0)}%, the rest missions and levels`);
      console.log("car                 price    reached (median, p10-p90)   runs  since last car");
      CARS.forEach((c, i) => console.log(`${c.id.padEnd(18)} ${String(c.price).padStart(7)}  ${hm(med(carAt[i])).padStart(6)} (${hm(pct(carAt[i], 0.1))}-${hm(pct(carAt[i], 0.9))})`.padEnd(52) + `${String(med(runAt[i])).padStart(5)}  ${i ? hm(med(carAt[i]) - med(carAt[i - 1])) : ""}`));
      // the cadence: runs between purchases of anything, in phases of play time
      const phases = [[0, 1800, "first 30 min"], [1800, 3 * 3600, "30 min - 3 h"], [3 * 3600, 8 * 3600, "3 h - 8 h"], [8 * 3600, 1e9, "after 8 h"]] as const;
      for (const [a, b, label] of phases) {
        const gaps: number[] = [], mins: number[] = [];
        for (const x of cs) { let last = { t: 0, run: 0 }; for (const y of x.buys) { if (y.t > a && y.t <= b && y.run > last.run) { gaps.push(y.run - last.run); mins.push(y.t - last.t); } if (y.run > last.run) last = y; } }
        if (gaps.length) console.log(`  ${label.padEnd(13)} a purchase every ${med(gaps)} runs (p90 ${pct(gaps, 0.9)}), ${hm(med(mins))} (p90 ${hm(pct(mins, 0.9))})`);
      }
      (out.careers as Record<string, unknown>)[`${name}/${p}`] = { firstRun: med(cs.map((x) => x.buys[0]?.run ?? Infinity)), cars: CARS.map((c, i) => ({ id: c.id, price: c.price, medianS: med(carAt[i]), p10: pct(carAt[i], 0.1), p90: pct(carAt[i], 0.9), runs: med(runAt[i]) })) };
    }
  }
  CARS.forEach((c, i) => (c.price = original[i])); Score.prototype.pay = pay0;
  const file = arg("json", "");
  if (file) { await Bun.write(file, JSON.stringify(out, (_, v) => (v === Infinity ? null : v), 1)); console.log(`\nwrote ${file}`); }
}

// a worker plays the runs it is sent; the main thread plans, collects and reports
if (!isMainThread) {
  parentPort!.on("message", (j: { car: number; level: number; profile: string; mode: string; seed: number; cap: number }) => parentPort!.postMessage(play(j.car, j.level, j.profile, j.mode, j.seed, j.cap)));
} else await main();
