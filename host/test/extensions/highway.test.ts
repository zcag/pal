import { describe, expect, test } from "bun:test";
import { Vehicle } from "../../../extensions/highway/game/vehicle.ts";
import { Director } from "../../../extensions/highway/game/director.ts";
import { Score } from "../../../extensions/highway/game/score.ts";
import { CARS, FEEL, MODES, spec } from "../../../extensions/highway/game/content.ts";
import { Drive } from "../../../extensions/highway/game/drive.ts";
import { ONE_WAY } from "../../../extensions/highway/game/layout.ts";
import { fresh, buyCar, buyUpgrade, load, stored, xpTotal, type Save } from "../../../extensions/highway/game/meta.ts";
import { gainXp, xpFor } from "../../../extensions/highway/game/progress.ts";
import { declared, manifestOf, merge, problems, storedKeys } from "./game-accounts.ts";

const NO_UP = { speed: 0, handling: 0, brakes: 0, nitro: 0 };

test("every car reaches about its top speed, and brakes from 100 km/h to a crawl in about a second", () => {
  for (const car of [CARS[0], CARS[CARS.length - 1]]) {
    const v = new Vehicle(spec(car, NO_UP, 2.6));
    for (let i = 0; i < 120 * 70; i++) v.step(1 / 120, { throttle: 1, brake: 0, steer: 0 });
    expect(Math.abs(v.kmh / FEEL.pace - car.top) / car.top).toBeLessThan(0.08);
    const b = new Vehicle(spec(car, NO_UP, 2.6));
    b.launch((100 / 3.6) * FEEL.pace);
    let t = 0;
    while (b.kmh / FEEL.pace > FEEL.crawl + 1 && t < 5) { b.step(1 / 120, { throttle: 0, brake: 1, steer: 0 }); t += 1 / 120; }
    expect(t).toBeLessThan(1.5);
    for (let i = 0; i < 240; i++) b.step(1 / 120, { throttle: 0, brake: 1, steer: 0 });
    expect(b.kmh / FEEL.pace).toBeGreaterThan(FEEL.crawl - 1); // the brakes never stop you on the highway
  }
});

test("a tap of the steering moves the car across and lets it straighten, without a spin", () => {
  const v = new Vehicle(spec(CARS[6], NO_UP, 2.6));
  v.launch(220 / 3.6);
  for (let i = 0; i < 120 * 4; i++) v.step(1 / 120, { throttle: 0.5, brake: 0, steer: i < 60 ? 1 : 0 });
  expect(v.x).toBeGreaterThan(1);
  expect(Math.abs(v.yaw)).toBeLessThan(0.05);
});

test("the director never fills every lane of a row", () => {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const d = new Director({ lanes: 4, oncomingLanes: 0, topSpeed: 70, rnd });
  const cars: { lane: number; z: number; oncoming: boolean }[] = [];
  for (let z = 0; z < 30000; z += 200) {
    d.time = z / 60;
    d.plan(z, 60, cars);
  }
  for (const c of cars) {
    const near = new Set(cars.filter((o) => Math.abs(o.z - c.z) < 10).map((o) => o.lane));
    expect(near.size).toBeLessThan(4);
  }
});

test("a near miss counts only fast and close, and builds a combo", () => {
  const s = new Score();
  expect(s.pass(0.5, 90, false)).toBeNull();
  expect(s.pass(1.5, 150, false)).toBeNull();
  const a = s.pass(0.5, 150, false)!, b = s.pass(0.2, 150, true)!;
  expect(a.combo).toBe(1);
  expect(b.combo).toBe(2);
  expect(b.points).toBeGreaterThan(a.points * 3);
  s.tick(5, 150, false);
  expect(s.combo).toBe(0);
});

test("buying needs the cash, and a save survives a round trip", () => {
  const s = fresh();
  expect(buyCar(s, CARS[1])).toBe(false);
  s.cash = CARS[1].price + 5000;
  expect(buyCar(s, CARS[1])).toBe(true);
  expect(buyUpgrade(s, CARS[1], "speed")).toBe(true);
  const back = load(JSON.parse(JSON.stringify(stored(s))));
  expect(back.owned[CARS[1].id].upgrades.speed).toBe(1);
  expect(back.car).toBe(CARS[1].id);
});

describe("accounts", () => {
  const m = manifestOf("highway");
  const rule = m.sync.save as { fields: Record<string, { fields: Record<string, unknown> }> };

  test("every stored key has a rule (a kept run and a staged scene stay on this machine), every car and mode merges field by field", () => {
    expect(problems(m)).toEqual([]);
    expect(Object.keys(m.sync).sort()).toEqual(storedKeys("highway"));
    expect([m.sync.run, m.sync.scene]).toEqual(["local", "local"]);
    expect(Object.keys(rule.fields.owned.fields)).toEqual(CARS.map((c) => c.id));
    expect(Object.keys(rule.fields.best.fields)).toEqual(MODES.map((x) => x.id));
    expect(Object.keys(rule.fields).sort()).toEqual(Object.keys(stored(fresh())).sort());
  });

  test("each mode has its board, the one a finished run posts to", () => {
    for (const x of MODES) expect(declared(m, x.id), x.id).toMatchObject({ title: x.name, order: "desc", format: "points" });
  });

  test("the level is stored as every XP earned, and a save from before reads it back from its level", () => {
    const s = fresh();
    Object.assign(s, gainXp(1, 0, xpFor(1) + xpFor(2) + 120));
    expect([s.level, s.xp]).toEqual([3, 120]);
    expect(stored(s).xpTotal).toBe(xpTotal(3, 120));
    expect(load({ ...stored(s), level: 1, xp: 0 })).toMatchObject({ level: 3, xp: 120 });
    expect(load({ v: 2, level: 7, xp: 40 })).toMatchObject({ level: 7, xp: 40 });
  });

  test("two machines that both played since they synced keep the cash, XP, cars, upgrades and records of both", () => {
    const base = fresh();
    base.cash = 10000;
    Object.assign(base, gainXp(1, 0, 500));
    const synced = JSON.parse(JSON.stringify(stored(base))) as Save;
    const a = load(structuredClone(synced)), b = load(structuredClone(synced));
    // a buys a car and upgrades it, earns XP, sets a record
    buyCar(a, CARS[1]); buyUpgrade(a, CARS[1], "speed");
    Object.assign(a, gainXp(a.level, a.xp, 300));
    a.best.endless = { score: 40000, distance: 9000, combo: 5, topSpeed: 230 };
    a.totals.runs += 3;
    // b earns cash, upgrades the first car, does better on Two-Way
    b.cash += 4000;
    buyUpgrade(b, CARS[0], "brakes");
    Object.assign(b, gainXp(b.level, b.xp, 2000));
    b.best.twoway = { score: 52000, distance: 7000, combo: 8, topSpeed: 210 };
    b.totals.runs += 2;
    const merged = load(merge(m.sync.save, stored(b), merge(m.sync.save, stored(a), synced, synced), synced));
    // what each spent and earned since: the base, less a's car and upgrade, plus b's earnings less its upgrade
    expect(merged.cash).toBe(10000 + (a.cash - 10000) + (b.cash - 10000));
    expect(merged.cash).toBeLessThan(10000);
    expect(merged.owned[CARS[1].id].upgrades.speed).toBe(1);
    expect(merged.owned[CARS[0].id].upgrades.brakes).toBe(1);
    expect(xpTotal(merged.level, merged.xp)).toBe(500 + 300 + 2000);
    expect(merged.best).toMatchObject({ endless: { score: 40000 }, twoway: { score: 52000 } });
    expect(merged.totals.runs).toBe(5);
  });
});

test("Speed Trap ends a run held under its floor; Time Attack's clock runs down", () => {
  const size = { x: 1.9, z: 4.5 }, sizeOf = () => size;
  const trap = new Drive(ONE_WAY, CARS[6], NO_UP, size, 2.6, sizeOf, {}, { seed: 3, mode: "trap" });
  for (let i = 0; i < 120 * 6 && !trap.ended; i++) trap.step(1 / 120, { throttle: 0, brake: 1, steer: 0 });
  expect(trap.ended).toBe("slow");
  const time = new Drive(ONE_WAY, CARS[6], NO_UP, size, 2.6, sizeOf, {}, { seed: 3, mode: "time" });
  for (let i = 0; i < 120; i++) time.step(1 / 120, { throttle: 0.3, brake: 0, steer: 0 });
  expect(time.clock).toBeCloseTo(59, 1);
});

test("a run packed and unpacked carries on exactly as it would have", () => {
  const size = { x: 1.9, z: 4.5 }, sizeOf = () => size;
  const drive = (i: number) => ({ throttle: 1, brake: 0, steer: Math.sin(i / 90) * 0.6 });
  const a = new Drive(ONE_WAY, CARS[6], NO_UP, size, 2.6, sizeOf, {}, { seed: 11, mode: "time" });
  for (let i = 0; i < 120 * 5; i++) a.step(1 / 120, drive(i));
  const b = new Drive(ONE_WAY, CARS[6], NO_UP, size, 2.6, sizeOf, {}, { seed: 99, mode: "time" });
  b.unpack(JSON.parse(JSON.stringify(a.pack())));
  for (let i = 600; i < 120 * 10; i++) { a.step(1 / 120, drive(i)); b.step(1 / 120, drive(i)); }
  expect(b.veh.z).toBe(a.veh.z);
  expect(b.score.points).toBe(a.score.points);
  expect(b.traffic.cars.map((n) => n.z)).toEqual(a.traffic.cars.map((n) => n.z));
  expect(b.clock).toBe(a.clock);
});
