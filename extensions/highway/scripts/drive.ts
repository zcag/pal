// How each car drives, measured: 0-100, 0-200, top speed, 100-0, a lane change.
//   bun extensions/highway/scripts/drive.ts [car id]
import { Vehicle } from "../game/vehicle.ts";
import { CARS, spec } from "../game/content.ts";
const dt = 1 / 120;
for (const car of CARS.filter((c) => !process.argv[2] || c.id === process.argv[2])) {
  const s = spec(car, { speed: 0, handling: 0, brakes: 0 }, 2.6);
  let v = new Vehicle(s), t = 0, t100 = 0, t200 = 0;
  while (t < 90) { v.step(dt, { throttle: 1, brake: 0, steer: 0 }); t += dt; if (!t100 && v.kmh >= 100) t100 = t; if (!t200 && v.kmh >= 200) t200 = t; }
  const top = v.kmh;
  v = new Vehicle(s); v.launch(100 / 3.6); const z0 = v.z; t = 0;
  while (v.u > 0.1 && t < 10) { v.step(dt, { throttle: 0, brake: 1, steer: 0 }); t += dt; }
  const stop = v.z - z0;
  // a lane change at 160: how long until 3.6 m across
  v = new Vehicle(s); v.launch(160 / 3.6); t = 0; let lane = 0;
  while (t < 4 && !lane) { v.step(dt, { throttle: 0.5, brake: 0, steer: v.x < 2.2 ? 1 : 0 }); t += dt; if (v.x >= 3.6) lane = t; }
  console.log(`${car.id.padEnd(18)} 0-100 ${t100.toFixed(1)}s  0-200 ${(t200 || 0).toFixed(1)}s  top ${top.toFixed(0)} (want ${car.top})  100-0 ${stop.toFixed(0)} m  lane@160 ${lane.toFixed(2)}s`);
}
