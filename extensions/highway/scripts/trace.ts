// A lane change, step by step: where the time goes.
//   bun extensions/highway/scripts/trace.ts [car id] [km/h]
import { Vehicle } from "../game/vehicle.ts";
import { CARS, spec } from "../game/content.ts";
const car = CARS.find((c) => c.id === (process.argv[2] ?? "jdm-sport-99"))!;
const v = new Vehicle(spec(car, { speed: 0, handling: 0, brakes: 0 }, 2.6));
v.launch(+(process.argv[3] ?? 160) / 3.6);
let t = 0;
const dt = 1 / 120;
while (t < 1.6) {
  v.step(dt, { throttle: 0.5, brake: 0, steer: v.x < 2.2 ? 1 : 0 });
  t += dt;
  if (Math.round(t * 120) % 12 === 0) console.log(t.toFixed(2), "x", v.x.toFixed(2), "yaw°", (v.yaw * 57.3).toFixed(2), "r", v.r.toFixed(3), "δ°", (v.delta * 57.3).toFixed(2), "ay g", (v.ay / 9.81).toFixed(2), "slipF", v.slipFront.toFixed(2), "slipR", v.slipRear.toFixed(2));
}
