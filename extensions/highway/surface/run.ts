// One run, drawn: the rules are game/drive.ts; this puts your car and the
// traffic's in the world's scene where the simulation says (between its last
// two steps, so motion is smooth at any frame rate), with lamps, indicators
// and headlights, and lends the traffic its cars from a shared pool.
import * as THREE from "./vendor/three.js";
import { Car } from "./car.ts";
import type { World } from "./world.ts";
import type { Input } from "../game/vehicle.ts";
import { Drive, type DriveEvents } from "../game/drive.ts";
import { TRAFFIC, FEEL, type ModeId, type PlayerCar, type Upgrades } from "../game/content.ts";
import { laneX, oncomingX, type Layout } from "../game/layout.ts";

const rnd = Math.random;

// the traffic's cars, made once and shared by every run: idle ones wait here by model
const pool = new Map<string, Car[]>();
const sizes = new Map<string, { x: number; z: number }>();
const loading = new Set<string>();

async function makeCar(id: string) {
  const t = TRAFFIC.find((x) => x.id === id)!;
  const color = t.livery ? "#ffffff" : t.colors![Math.floor(rnd() * t.colors!.length)];
  const c = await Car.load(id, color);
  return c;
}

/** Make two of every traffic model before the first run (`progress` 0..1 as they come in), so a
 *  run never stops to load one, and compile their shaders while nobody is driving. */
export async function preloadTraffic(world: World, warm: (scene: THREE.Scene) => Promise<void>, progress: (f: number) => void) {
  let done = 0;
  await Promise.all(TRAFFIC.map(async (t) => {
    if (sizes.has(t.id)) return;
    const cars = await Promise.all([makeCar(t.id), makeCar(t.id)]);
    sizes.set(t.id, { x: cars[0].size.x, z: cars[0].size.z });
    (pool.get(t.id) ?? pool.set(t.id, []).get(t.id)!).push(...cars);
    progress(++done / TRAFFIC.length);
  }));
  // every car drawn once, lined up in front of the camera: its shaders compile and its
  // geometry and textures go to the GPU now rather than the first time it drives into view
  const parked = new THREE.Group();
  let i = 0;
  for (const list of pool.values()) for (const c of list) { lamps(c, true, true); c.root.position.set((i % 8) * 3 - 10.5, 0, -14 - Math.floor(i / 8) * 7); parked.add(c.root); i++; }
  world.scene.add(parked);
  await warm(world.scene);
  world.scene.remove(parked);
  for (const list of pool.values()) for (const c of list) c.root.removeFromParent();
}

/** Lamps for the time of day. */
function lamps(car: Car, night: boolean, braking: boolean) {
  car.light("head", night ? 3 : 0);
  car.light("brake", braking ? 3.5 : night ? 0.9 : 0);
}

export class Run {
  drive: Drive;
  private shown = new Map<number, Car>();
  private blink = 0;
  lights: THREE.SpotLight[] = [];
  /** Where the player's car is drawn: between the last two steps, so motion is smooth at any frame rate. */
  pose = { x: 0, z: 0, yaw: 0, u: 0, ax: 0, delta: 0 };
  private prev = { x: 0, z: 0, yaw: 0 };

  constructor(public world: World, public layout: Layout, public player: Car, car: PlayerCar, up: Upgrades, events: DriveEvents, density = 1, mode: ModeId = "endless") {
    this.drive = new Drive(layout, car, up, { x: player.size.x, z: player.size.z }, player.wheelbase, (id) => sizes.get(id), events, { density, mode });
    world.scene.add(player.root);
    this.headlights();
    this.settle();
  }

  get veh() { return this.drive.veh; }
  get traffic() { return this.drive.traffic; }
  get director() { return this.drive.director; }
  get score() { return this.drive.score; }
  get over() { return this.drive.over; }
  get scraping() { return this.drive.scraping; }
  get car() { return this.drive.car; }

  /** At night, two real spotlights from the player's headlamps. */
  private headlights() {
    for (const l of this.lights) { l.target.removeFromParent(); l.removeFromParent(); }
    this.lights = [];
    const player = this.player;
    if (this.world.night) for (const p of player.anchors.head.length ? player.anchors.head : [new THREE.Vector3(0.6, 0.7, 2), new THREE.Vector3(-0.6, 0.7, 2)]) {
      // dipped beams: aimed well down the road and soft-edged, so the road lights from a few metres out to
      // about 40 m instead of a hot patch at the bumper
      const spot = new THREE.SpotLight(0xfff1dc, 380, 110, 0.38, 0.85, 1.4);
      spot.position.copy(p);
      spot.target.position.set(p.x * 0.6 - 0.4, 0, p.z + 45);
      player.body.add(spot, spot.target);
      this.lights.push(spot);
    }
  }

  /** Swap the car you drive, keeping where and how fast it goes (the garage's browsing). */
  setPlayer(player: Car, car: PlayerCar, up: Upgrades) {
    this.player.root.removeFromParent();
    this.player = player;
    this.drive.setCar(car, up, { x: player.size.x, z: player.size.z }, player.wheelbase);
    this.world.scene.add(player.root);
    this.headlights();
    this.settle();
  }

  /** Draw exactly where the simulation is (after a jump: a start, a fast-forward). */
  settle() {
    const v = this.veh;
    this.prev = { x: v.x, z: v.z, yaw: v.yaw };
    Object.assign(this.pose, { x: v.x, z: v.z, yaw: v.yaw, u: v.u, ax: v.ax, delta: v.delta });
  }

  step(dt: number, input: Input) {
    const v = this.veh;
    this.prev = { x: v.x, z: v.z, yaw: v.yaw };
    for (const n of this.traffic.cars) n.prev = { x: n.x, z: n.z, yaw: n.hit ? n.hit.yaw : 0 };
    this.drive.step(dt, input);
  }

  /** Put the cars where the simulation says, once a frame; `alpha` is how far into the next step (0..1). */
  draw(dt: number, alpha = 1) {
    const v = this.veh, p = this.player, a = alpha, b = 1 - alpha;
    const pose = this.pose;
    pose.x = this.prev.x * b + v.x * a; pose.z = this.prev.z * b + v.z * a; pose.yaw = this.prev.yaw * b + v.yaw * a;
    pose.u = v.u; pose.ax = v.ax; pose.delta = v.delta;
    p.root.position.set(pose.x, 0, pose.z);
    p.root.rotation.y = pose.yaw * FEEL.yaw;
    p.body.rotation.set(this.drive.spring.pitch, 0, -this.drive.spring.roll);
    for (const w of p.wheels) { w.spin.rotation.x = v.wheelSpin; if (w.front) w.pivot.rotation.y = v.delta; }
    lamps(p, this.world.night, v.braking > 0.1);
    this.blink += dt;
    const on = Math.floor(this.blink / 0.38) % 2 === 0;
    for (const [id, car] of this.shown) if (!this.traffic.cars.some((n) => n.id === id)) {
      car.root.removeFromParent();
      pool.get(car.kind)!.push(car);
      this.shown.delete(id);
    }
    for (const n of this.traffic.cars) {
      let car = this.shown.get(n.id);
      if (!car) {
        const list = pool.get(n.kind)!;
        if (!list.length) {
          if (!loading.has(n.kind)) { loading.add(n.kind); makeCar(n.kind).then((c) => { list.push(c); loading.delete(n.kind); }); }
          continue;
        }
        car = list.pop()!;
        this.shown.set(n.id, car);
        this.world.scene.add(car.root);
      }
      const at = (l: number) => (n.oncoming ? oncomingX(this.layout, l) : laneX(this.layout, l));
      const dx = n.t < 1 ? ((at(n.lane) - at(n.from)) * 6 * n.t * (1 - n.t)) / 3.2 : 0;
      const pv = n.prev ?? { x: n.x, z: n.z, yaw: n.hit?.yaw ?? 0 };
      car.root.position.set(pv.x * b + n.x * a, 0, pv.z * b + n.z * a);
      car.root.rotation.y = n.hit ? pv.yaw * b + n.hit.yaw * a : (n.oncoming ? Math.PI : 0) + Math.atan2(dx, Math.max(n.v, 1));
      car.setShadow(Math.abs(n.z - v.z) < 150); // as far as anything is still big enough for its shadow to read
      for (const w of car.wheels) w.spin.rotation.x += (n.v / 0.33) * dt;
      lamps(car, this.world.night, n.braking);
      const hazard = !!n.hit;
      car.light("left", (n.signal === 1 || hazard) && on ? 5 : 0);
      car.light("right", (n.signal === -1 || hazard) && on ? 5 : 0);
    }
  }

  /** Leave the road: the traffic's cars go back to the pool. */
  dispose() {
    this.player.root.removeFromParent();
    for (const car of this.shown.values()) { car.root.removeFromParent(); pool.get(car.kind)!.push(car); }
    this.shown.clear();
    for (const l of this.lights) { l.target.removeFromParent(); l.removeFromParent(); }
  }
}
