import { expect, test } from "bun:test";
import { Vehicle } from "../../../extensions/highway/game/vehicle.ts";
import { Director } from "../../../extensions/highway/game/director.ts";
import { Score } from "../../../extensions/highway/game/score.ts";
import { CARS, FEEL, spec } from "../../../extensions/highway/game/content.ts";
import { fresh, buyCar, buyUpgrade, load } from "../../../extensions/highway/game/meta.ts";

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
  const back = load(JSON.parse(JSON.stringify(s)));
  expect(back.owned[CARS[1].id].upgrades.speed).toBe(1);
  expect(back.car).toBe(CARS[1].id);
});
