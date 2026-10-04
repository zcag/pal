// A flick: hold left until the car crosses at full speed, then right; how long until it moves the other way.
//   bun extensions/highway/scripts/flick.ts
import { Vehicle } from "../game/vehicle.ts";
import { CARS, FEEL, spec } from "../game/content.ts";
const dt = 1 / 120;
for (const [car, lv] of [[CARS[0], 0], [CARS[7], 0], [CARS[7], 5], [CARS[CARS.length - 1], 5]] as const) {
  const v = new Vehicle(spec(car, { speed: 0, handling: lv, brakes: 0, nitro: 0 }, 2.6));
  v.launch((160 / 3.6) * FEEL.pace);
  for (let i = 0; i < 60; i++) v.step(dt, { throttle: 0.5, brake: 0, steer: 1 });
  const x0 = v.x; let t = 0, turned = 0, peak = v.x;
  while (t < 1.5 && !turned) { v.step(dt, { throttle: 0.5, brake: 0, steer: -1 }); t += dt; peak = Math.max(peak, v.x); if (v.x < peak - 0.05) turned = t; }
  console.log(`${car.id.padEnd(16)} handling +${lv}: turns back after ${(turned * 1000).toFixed(0)} ms, drifts on ${(peak - x0).toFixed(2)} m`);
}
