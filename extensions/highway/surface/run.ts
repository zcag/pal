// One run: your car on the physics, the traffic the director plans and the
// drivers drive, near misses and the score, the crash rule. It draws itself
// into the world's scene and tells the page what happened through events.
import * as THREE from "./vendor/three.js";
import { Car } from "./car.ts";
import { laneX, oncomingX, LANE_W, type Layout } from "./road.ts";
import type { World } from "./world.ts";
import { Vehicle, type Input } from "../game/vehicle.ts";
import { Traffic, crossing, type Npc } from "../game/traffic.ts";
import { Director } from "../game/director.ts";
import { Score, type Miss } from "../game/score.ts";
import { collide, resolve, type Rigid } from "../game/crash.ts";
import { TRAFFIC, FEEL, spec, type PlayerCar, type Upgrades } from "../game/content.ts";

/** Closing speed that ends a run (km/h), as in the original; any touch of an oncoming car does too. */
export const FATAL_KMH = 35;

export type RunEvents = {
  miss(m: Miss, n: Npc, side: number): void;
  pass(n: Npc, gap: number, closing: number, side: number): void;
  bump(impulse: number, side: number): void;
  crash(info: { you: number; them: number; kind: string; oncoming: boolean }): void;
  scrape(): void;
};

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// the traffic's cars, made once and shared by every run: idle ones wait here by model
const pool = new Map<string, Car[]>();
const sizes = new Map<string, THREE.Vector3>();
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
    sizes.set(t.id, cars[0].size.clone());
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
  veh: Vehicle;
  traffic: Traffic;
  director: Director;
  score = new Score();
  over = false;
  /** The body on its springs, for the car and the camera. */
  spring = { pitch: 0, pitchV: 0, roll: 0, rollV: 0 };
  scraping = 0;
  private shown = new Map<number, Car>();
  private blink = 0;
  lights: THREE.SpotLight[] = [];
  private pace = FEEL.pace; // the pace the car's physics were made at

  constructor(public world: World, public layout: Layout, public player: Car, public car: PlayerCar, public up: Upgrades, public events: RunEvents, density = 1) {
    seed = Math.floor(Math.random() * 2147483646) + 1;
    const s = spec(car, up, player.wheelbase);
    this.veh = new Vehicle(s);
    this.veh.x = laneX(layout, Math.min(1, layout.lanes - 1));
    this.veh.launch((100 / 3.6) * FEEL.pace);
    this.traffic = new Traffic(layout.lanes, layout.oncoming);
    this.director = new Director({ lanes: layout.lanes, oncomingLanes: layout.oncoming, topSpeed: car.top / 3.6, rnd, density });
    this.director.spare = { lane: Math.min(1, layout.lanes - 1), until: 150 };
    world.scene.add(player.root);
    this.headlights();
    this.settle();
  }

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
    this.up = up;
    const old = this.veh;
    this.player.root.removeFromParent();
    this.player = player;
    this.car = car;
    this.veh = new Vehicle(spec(car, up, player.wheelbase));
    this.veh.x = old.x; this.veh.z = old.z;
    this.veh.launch(old.u * (this.pace / FEEL.pace === 1 ? 1 : FEEL.pace / this.pace));
    this.pace = FEEL.pace;
    this.world.scene.add(player.root);
    this.headlights();
    this.settle();
  }

  private pickKind(heavy: boolean) {
    const list = TRAFFIC.filter((t) => !!t.heavy === heavy);
    const total = list.reduce((a, t) => a + t.weight, 0);
    let r = rnd() * total;
    for (const t of list) if ((r -= t.weight) <= 0) return t;
    return list[0];
  }

  /** Which of our lanes the car is in, and whether it is over the centre line. */
  lanePos() {
    const lane = Math.round((this.veh.x - laneX(this.layout, 0)) / LANE_W);
    const onc = this.layout.oncoming > 0 && this.veh.x > 0;
    return { lane: Math.max(0, Math.min(this.layout.lanes - 1, lane)), oncoming: onc };
  }

  /** Where the player's car is drawn: between the last two steps, so motion is smooth at any frame rate. */
  pose = { x: 0, z: 0, yaw: 0, u: 0, ax: 0, delta: 0 };
  private prev = { x: 0, z: 0, yaw: 0 };

  /** Draw exactly where the simulation is (after a jump: a start, a fast-forward). */
  settle() {
    const v = this.veh;
    this.prev = { x: v.x, z: v.z, yaw: v.yaw };
    Object.assign(this.pose, { x: v.x, z: v.z, yaw: v.yaw, u: v.u, ax: v.ax, delta: v.delta });
  }

  step(dt: number, input: Input) {
    const v = this.veh, L = this.layout;
    this.prev = { x: v.x, z: v.z, yaw: v.yaw };
    for (const n of this.traffic.cars) n.prev = { x: n.x, z: n.z, yaw: n.hit ? n.hit.yaw : 0 };
    if (this.over) input = { throttle: 0, brake: 0.3, steer: 0 };
    v.step(dt, input);

    // the guardrails
    const lim = (this.world.hi - this.world.lo) / 2 + 1.55 - this.player.size.x / 2;
    const mid = (this.world.hi + this.world.lo) / 2;
    if (Math.abs(v.x - mid) > lim) {
      v.x = mid + Math.sign(v.x - mid) * lim;
      v.v *= -0.3; v.yaw *= 0.5; v.r *= 0.5; v.u *= 1 - 1.2 * dt;
      if (this.scraping <= 0) this.events.scrape();
      this.scraping = 0.15;
      this.score.breakCombo();
    }
    this.scraping = Math.max(0, this.scraping - dt);

    // traffic: plan, drive, place
    if (!this.over) this.director.time += dt;
    const rows = this.director.plan(v.z, v.u, this.traffic.cars.map((n) => ({ lane: n.lane, z: n.z, oncoming: n.oncoming })));
    for (const row of rows) for (const s of row.spawns) {
      const kind = s.heavy ? this.pickKind(true) : this.pickKind(rnd() < 0.12);
      const size = sizes.get(kind.id);
      if (!size) continue;
      this.traffic.add({ kind: kind.id, length: size.z, width: size.x, z: row.z + s.dz, v: s.v0, lane: s.lane, v0: s.v0, T: 1.1 + rnd() * 0.6, a: kind.heavy ? 0.8 : 1.4, b: 2.5, oncoming: s.oncoming, politeness: 0.3 + rnd() * 0.4 });
    }
    const lp = this.lanePos();
    this.traffic.step(dt, { z: v.z, v: v.u, lane: lp.lane, length: this.player.size.z });
    for (const n of this.traffic.cars) {
      if (n.hit) continue;
      const at = (l: number) => (n.oncoming ? oncomingX(L, l) : laneX(L, l));
      n.x = at(n.from) + (at(n.lane) - at(n.from)) * crossing(n);
    }

    // passing: near misses and the whoosh
    const kmh = v.kmh / FEEL.pace; // what the dial says
    for (const n of this.traffic.cars) {
      if (n.hit || n.passed) continue;
      const rel = n.z - v.z;
      if (rel > 0) continue;
      n.passed = true;
      const gap = Math.abs(n.x - v.x) - (n.width + this.player.size.x) / 2;
      const closing = v.u - (n.oncoming ? -n.v : n.v);
      const side = n.x > v.x ? -1 : 1; // -1: it went by on the left of the screen
      this.events.pass(n, gap, closing, side);
      if (this.over) continue;
      const m = this.score.pass(gap, kmh, n.oncoming || lp.oncoming);
      if (m) this.events.miss(m, n, side);
    }

    // contact
    for (const n of this.traffic.cars) {
      const nyaw = n.hit ? n.hit.yaw : n.oncoming ? Math.PI : 0;
      const c = collide({ x: v.x, z: v.z, yaw: v.yaw, w: this.player.size.x * 0.96, l: this.player.size.z * 0.98 }, { x: n.x, z: n.z, yaw: nyaw, w: n.width * 0.96, l: n.length * 0.98 });
      if (!c) continue;
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
      const me: Rigid = { x: v.x, z: v.z, vx: v.u * sy + v.v * cy, vz: v.u * cy - v.v * sy, r: v.r, m: v.spec.mass, I: v.spec.mass * (this.player.size.z ** 2 + this.player.size.x ** 2) / 12 };
      const heavy = !!TRAFFIC.find((t) => t.id === n.kind)?.heavy;
      const nm = heavy ? 5500 : 1400;
      const nvz = n.hit ? n.v * (n.oncoming ? -1 : 1) : n.oncoming ? -n.v : n.v;
      const them: Rigid = { x: n.x, z: n.z, vx: n.hit?.vx ?? 0, vz: nvz, r: n.hit?.r ?? 0, m: nm, I: (nm * (n.length ** 2 + n.width ** 2)) / 12 };
      const closing = Math.abs((me.vx - them.vx) * c.nx + (me.vz - them.vz) * c.nz) * 3.6;
      const j = resolve(me, them, c);
      v.x = me.x; v.z = me.z; v.r = me.r;
      v.u = Math.max(0, me.vx * sy + me.vz * cy);
      const fatal = closing / FEEL.pace >= FATAL_KMH || n.oncoming;
      if (fatal) { v.v = me.vx * cy - me.vz * sy; v.knocked = 2; } // the run is over: the tyres slide it to a stop
      else { v.v = THREE.MathUtils.clamp(me.vx * cy - me.vz * sy, -4, 4); v.r = 0; } // a shove sideways your steering soaks up
      n.x = them.x; n.z = them.z;
      n.v = Math.abs(them.vz);
      n.hit = { vx: them.vx, yaw: nyaw, r: them.r };
      n.signal = 0;
      const side = n.x > v.x ? -1 : 1;
      if (!this.over && fatal) {
        this.over = true;
        this.events.crash({ you: Math.round(kmh), them: Math.round((n.v * 3.6) / FEEL.pace), kind: n.kind, oncoming: n.oncoming });
      } else this.events.bump(j, side);
    }
    this.traffic.remove((n) => n.z < v.z - 70 || n.z > v.z + 1000);

    // the body on its springs: squat, dive, lean
    const sp = this.spring;
    // the body leans with the steering, as the original's does (4 degrees + 0.05 per km/h at full lock, times `lean`)
    const pitchT = THREE.MathUtils.clamp(-v.ax * 0.0045, -0.05, 0.05);
    const rollT = v.knocked > 0 ? THREE.MathUtils.clamp(v.ay * 0.0055, -0.06, 0.06) : v.steer * THREE.MathUtils.degToRad(4 + 0.05 * kmh) * FEEL.lean;
    sp.pitchV += ((pitchT - sp.pitch) * 120 - sp.pitchV * 11) * dt; sp.pitch += sp.pitchV * dt;
    sp.rollV += ((rollT - sp.roll) * 110 - sp.rollV * 10) * dt; sp.roll += sp.rollV * dt;

    if (!this.over) this.score.tick(dt, kmh, lp.oncoming);
  }

  /** Put the cars where the simulation says, once a frame; `alpha` is how far into the next step (0..1). */
  draw(dt: number, alpha = 1) {
    const v = this.veh, p = this.player, a = alpha, b = 1 - alpha;
    const pose = this.pose;
    pose.x = this.prev.x * b + v.x * a; pose.z = this.prev.z * b + v.z * a; pose.yaw = this.prev.yaw * b + v.yaw * a;
    pose.u = v.u; pose.ax = v.ax; pose.delta = v.delta;
    p.root.position.set(pose.x, 0, pose.z);
    p.root.rotation.y = pose.yaw * FEEL.yaw;
    p.body.rotation.set(this.spring.pitch, 0, -this.spring.roll);
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
