// One run's rules, without a picture: your car on the physics, the traffic the
// director plans and the drivers drive, the guardrails, near misses and the
// score, contact and the crash rule. The page (surface/run.ts) draws it; a
// script can play it headless (scripts/economy.ts). It tells whoever listens
// what happened through events.
import { Vehicle, type Input } from "./vehicle.ts";
import { Traffic, crossing, type Npc } from "./traffic.ts";
import { Director } from "./director.ts";
import { Score, type Miss } from "./score.ts";
import { collide, resolve, type Rigid } from "./crash.ts";
import { TRAFFIC, FEEL, spec, nitroOf, type ModeId, type PlayerCar, type Upgrades } from "./content.ts";
import { laneX, oncomingX, edges, LANE_W, type Layout } from "./layout.ts";

/** Closing speed that ends a run (km/h on the dial), as in the original; any touch of an oncoming car does too. */
export const FATAL_KMH = 35;

export type Crash = { you: number; them: number; kind: string; oncoming: boolean };
export type DriveEvents = {
  miss?(m: Miss, n: Npc, side: number): void;
  pass?(n: Npc, gap: number, closing: number, side: number): void;
  bump?(impulse: number, side: number): void;
  crash?(info: Crash): void;
  scrape?(): void;
  nitro?(on: boolean): void;
  checkpoint?(added: number): void;
  end?(why: End): void;
};
/** Why a run ended: a crash, the clock (Time Attack), too slow for too long (Speed Trap). */
export type End = "crash" | "time" | "slow";

/** A run packed for storage (`Drive.pack`). */
export type Packed = { car: string; up: Upgrades; mode: ModeId; drive: object; veh: object; traffic: object; director: object; score: object };

/** A car's footprint: width and length, m. */
export type Size = { x: number; z: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Drive {
  mode: ModeId;
  veh: Vehicle;
  traffic: Traffic;
  director: Director;
  score = new Score();
  over = false;
  scraping = 0;
  ended: End | null = null;
  // nitro: a bar near misses fill, burnt while it lasts
  nitro = 0; boosting = false; private wanted = false;
  // Time Attack: the clock and the next checkpoint (m on the dial); Speed Trap: the floor and time under it
  clock = 60; checkpoints = 0; floor = 0; under = 0;
  /** The body on its springs (squat, dive, lean), for the car and the camera. */
  spring = { pitch: 0, pitchV: 0, roll: 0, rollV: 0 };
  private seed: number;
  private pace = FEEL.pace; // the pace the car's physics were made at

  constructor(public layout: Layout, public car: PlayerCar, public up: Upgrades, public size: Size, wheelbase: number,
    private sizeOf: (id: string) => Size | undefined, public events: DriveEvents = {}, o: { density?: number; seed?: number; mode?: ModeId } = {}) {
    this.mode = o.mode ?? "endless";
    this.seed = o.seed ?? Math.floor(Math.random() * 2147483646) + 1;
    this.veh = new Vehicle(spec(car, up, wheelbase));
    this.veh.x = laneX(layout, Math.min(1, layout.lanes - 1));
    this.veh.launch((100 / 3.6) * FEEL.pace);
    this.traffic = new Traffic(layout.lanes, layout.oncoming);
    this.director = new Director({ lanes: layout.lanes, oncomingLanes: layout.oncoming, topSpeed: car.top / 3.6, rnd: () => this.rnd(), density: o.density ?? 1 });
    this.director.spare = { lane: Math.min(1, layout.lanes - 1), until: 150 };
  }

  /** The run as plain data, to carry it over a reload: pal may drop a hidden page, and the page saves this when it hides. */
  pack(): Packed {
    const data = (o: object, skip: string[] = []) => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !skip.includes(k)))));
    return {
      car: this.car.id, up: this.up, mode: this.mode,
      drive: data(this, ["layout", "car", "up", "size", "sizeOf", "events", "veh", "traffic", "director", "score", "mode"]),
      veh: data(this.veh, ["spec"]), traffic: data(this.traffic), director: data(this.director, ["o"]), score: data(this.score),
    };
  }

  /** Carry on from `pack()`; the car and mode must be the ones it was packed with. */
  unpack(p: Packed) {
    Object.assign(this, p.drive);
    Object.assign(this.veh, p.veh);
    Object.assign(this.traffic, p.traffic);
    Object.assign(this.director, p.director);
    Object.assign(this.score, p.score);
  }

  rnd() { return (this.seed = (this.seed * 16807) % 2147483647) / 2147483647; }

  /** Swap the car, keeping where and how fast it goes (the garage's browsing, an upgrade bought). */
  setCar(car: PlayerCar, up: Upgrades, size: Size, wheelbase: number) {
    const old = this.veh;
    this.car = car; this.up = up; this.size = size;
    this.veh = new Vehicle(spec(car, up, wheelbase));
    this.veh.x = old.x; this.veh.z = old.z;
    this.veh.launch(old.u * (FEEL.pace / this.pace));
    this.pace = FEEL.pace;
  }

  /** The dial's speed. */
  get kmh() { return this.veh.kmh / FEEL.pace; }

  /** Which of our lanes the car is in, and whether it is over the centre line. */
  lanePos() {
    const lane = Math.round((this.veh.x - laneX(this.layout, 0)) / LANE_W);
    return { lane: clamp(lane, 0, this.layout.lanes - 1), oncoming: this.layout.oncoming > 0 && this.veh.x > 0 };
  }

  private pickKind(heavy: boolean) {
    const list = TRAFFIC.filter((t) => !!t.heavy === heavy);
    let r = this.rnd() * list.reduce((a, t) => a + t.weight, 0);
    for (const t of list) if ((r -= t.weight) <= 0) return t;
    return list[0];
  }

  /** End the run, once. */
  private finish(why: End) {
    if (this.over) return;
    this.over = true;
    this.ended = why;
    this.boosting = false;
    this.events.end?.(why);
  }

  step(dt: number, input: Input) {
    const v = this.veh, L = this.layout, ev = this.events;
    if (this.over) input = { throttle: 0, brake: 0.3, steer: 0 };
    // nitro: lit on a press with a quarter of a bar or more, out when the bar is empty or on the brakes
    const n2 = nitroOf(this.up);
    if (input.nitro && !this.wanted && !this.boosting && this.nitro >= 0.25 && !this.over) { this.boosting = true; this.score.nitroUses++; ev.nitro?.(true); }
    this.wanted = !!input.nitro;
    if (this.boosting) {
      this.nitro = Math.max(0, this.nitro - dt / n2.burn);
      if (this.nitro <= 0 || input.brake > 0.2) { this.boosting = false; ev.nitro?.(false); }
    }
    v.boost = this.boosting ? n2.push * FEEL.pace : 0;
    this.score.boosting = this.boosting;
    v.step(dt, input);

    // the guardrails
    const [lo, hi] = edges(L);
    const lim = (hi - lo) / 2 + 1.55 - this.size.x / 2, mid = (hi + lo) / 2;
    if (Math.abs(v.x - mid) > lim) {
      v.x = mid + Math.sign(v.x - mid) * lim;
      v.v *= -0.3; v.yaw *= 0.5; v.r *= 0.5; v.u *= 1 - 1.2 * dt;
      if (this.scraping <= 0) ev.scrape?.();
      this.scraping = 0.15;
      this.score.breakCombo();
    }
    this.scraping = Math.max(0, this.scraping - dt);

    // traffic: plan, drive, place
    if (!this.over) this.director.time += dt;
    const rows = this.director.plan(v.z, v.u, this.traffic.cars.map((n) => ({ lane: n.lane, z: n.z, oncoming: n.oncoming })));
    for (const row of rows) for (const s of row.spawns) {
      const kind = s.heavy ? this.pickKind(true) : this.pickKind(this.rnd() < 0.12);
      const size = this.sizeOf(kind.id);
      if (!size) continue;
      this.traffic.add({ kind: kind.id, length: size.z, width: size.x, z: row.z + s.dz, v: s.v0, lane: s.lane, v0: s.v0, T: 1.1 + this.rnd() * 0.6, a: kind.heavy ? 0.8 : 1.4, b: 2.5, oncoming: s.oncoming, politeness: 0.3 + this.rnd() * 0.4 });
    }
    const lp = this.lanePos();
    this.traffic.step(dt, { z: v.z, v: v.u, lane: lp.lane, length: this.size.z });
    for (const n of this.traffic.cars) {
      if (n.hit) continue;
      const at = (l: number) => (n.oncoming ? oncomingX(L, l) : laneX(L, l));
      n.x = at(n.from) + (at(n.lane) - at(n.from)) * crossing(n);
    }

    // passing: near misses and the whoosh
    const kmh = this.kmh;
    for (const n of this.traffic.cars) {
      if (n.hit || n.passed || n.z > v.z) continue;
      n.passed = true;
      const gap = Math.abs(n.x - v.x) - (n.width + this.size.x) / 2;
      const closing = v.u - (n.oncoming ? -n.v : n.v);
      const side = n.x > v.x ? -1 : 1; // -1: it went by on the left of the screen
      ev.pass?.(n, gap, closing, side);
      if (this.over) continue;
      const m = this.score.pass(gap, kmh, n.oncoming || lp.oncoming);
      if (m) {
        this.nitro = Math.min(1, this.nitro + (m.double ? 0.4 : m.grade.nitro) * n2.fill);
        ev.miss?.(m, n, side);
      }
    }

    // contact
    for (const n of this.traffic.cars) {
      const nyaw = n.hit ? n.hit.yaw : n.oncoming ? Math.PI : 0;
      const c = collide({ x: v.x, z: v.z, yaw: v.yaw, w: this.size.x * 0.96, l: this.size.z * 0.98 }, { x: n.x, z: n.z, yaw: nyaw, w: n.width * 0.96, l: n.length * 0.98 });
      if (!c) continue;
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw);
      const me: Rigid = { x: v.x, z: v.z, vx: v.u * sy + v.v * cy, vz: v.u * cy - v.v * sy, r: v.r, m: v.spec.mass, I: (v.spec.mass * (this.size.z ** 2 + this.size.x ** 2)) / 12 };
      const nm = TRAFFIC.find((t) => t.id === n.kind)?.heavy ? 5500 : 1400;
      const nvz = n.hit ? n.v * (n.oncoming ? -1 : 1) : n.oncoming ? -n.v : n.v;
      const them: Rigid = { x: n.x, z: n.z, vx: n.hit?.vx ?? 0, vz: nvz, r: n.hit?.r ?? 0, m: nm, I: (nm * (n.length ** 2 + n.width ** 2)) / 12 };
      const closing = Math.abs((me.vx - them.vx) * c.nx + (me.vz - them.vz) * c.nz) * 3.6;
      const j = resolve(me, them, c);
      v.x = me.x; v.z = me.z; v.r = me.r;
      v.u = Math.max(0, me.vx * sy + me.vz * cy);
      const fatal = closing / FEEL.pace >= FATAL_KMH || n.oncoming;
      if (fatal) { v.v = me.vx * cy - me.vz * sy; v.knocked = 2; } // the run is over: the tyres slide it to a stop
      else { v.v = clamp(me.vx * cy - me.vz * sy, -4, 4); v.r = 0; } // a shove sideways your steering soaks up
      n.x = them.x; n.z = them.z;
      n.v = Math.abs(them.vz);
      n.hit = { vx: them.vx, yaw: nyaw, r: them.r };
      n.signal = 0;
      if (!this.over && fatal) {
        ev.crash?.({ you: Math.round(kmh), them: Math.round((n.v * 3.6) / FEEL.pace), kind: n.kind, oncoming: n.oncoming });
        this.finish("crash");
      } else ev.bump?.(j, n.x > v.x ? -1 : 1);
    }
    this.traffic.remove((n) => n.z < v.z - 70 || n.z > v.z + 1000);

    // the body on its springs: squat, dive, and a lean with the steering as the original's does
    // (4 degrees + 0.05 per km/h at full lock, times `lean`)
    const sp = this.spring;
    const pitchT = clamp(-v.ax * 0.0045, -0.05, 0.05);
    const rollT = v.knocked > 0 ? clamp(v.ay * 0.0055, -0.06, 0.06) : v.steer * ((4 + 0.05 * kmh) * Math.PI / 180) * FEEL.lean;
    sp.pitchV += ((pitchT - sp.pitch) * 120 - sp.pitchV * 11) * dt; sp.pitch += sp.pitchV * dt;
    sp.rollV += ((rollT - sp.roll) * 110 - sp.rollV * 10) * dt; sp.roll += sp.rollV * dt;

    if (this.over) return;
    this.score.tick(dt, kmh, lp.oncoming);

    // the modes' own rules
    if (this.mode === "time") {
      this.clock -= dt;
      // every 2.5 km on the dial: 30 s, 27, 24 ... never under 12
      if (this.score.distance >= (this.checkpoints + 1) * 2500) {
        const added = Math.max(12, 30 - 3 * this.checkpoints);
        this.checkpoints++;
        this.clock += added;
        ev.checkpoint?.(added);
      }
      if (this.clock <= 0) { this.clock = 0; this.finish("time"); }
    } else if (this.mode === "trap") {
      // 90 km/h for the first 10 s, then 5 more every 10 s
      this.floor = 90 + 5 * Math.floor(this.score.time / 10);
      this.under = kmh < this.floor ? this.under + dt : Math.max(0, this.under - dt * 2);
      if (this.under >= 3) this.finish("slow");
    }
  }
}
