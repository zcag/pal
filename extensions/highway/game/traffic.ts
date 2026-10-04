// Traffic that drives like traffic. Each car follows the one ahead with the
// Intelligent Driver Model (a time gap it keeps, smooth braking, never a
// collision of its own making) and changes lanes by MOBIL: only when the new
// lane is better for it by a margin and nobody behind would have to brake hard
// for it. A change is signalled first, then driven over a few seconds. The
// player counts as a car in both, so traffic reacts when cut up.
//
// Positions are in the road frame: z along the road, lane index across it.
// Oncoming cars (two-way roads) drive toward -z in lanes of their own.

export type Npc = {
  id: number;
  kind: string; // the model
  length: number; width: number;
  z: number; v: number; // world position along the road, and speed along its direction of travel (oncoming cars move toward -z)
  lane: number; // the lane it is in (or moving into)
  from: number; // the lane it is leaving; equal to lane when settled
  t: number; // 0..1 through a lane change
  x: number; // lateral position, filled by the road layout
  v0: number; // the speed this driver wants
  T: number; // time gap it keeps, s
  a: number; b: number; // comfortable acceleration and braking
  signal: 0 | -1 | 1; signalT: number; // indicator and how long it has been on
  braking: boolean;
  oncoming: boolean;
  politeness: number;
  cooldown: number; // seconds before it may change lanes again
  hit?: { vx: number; yaw: number; r: number }; // knocked by a crash: sliding, no longer driving
  passed?: boolean; // the player has gone by it
  prev?: { x: number; z: number; yaw: number }; // where it was a step ago, for drawing between steps
};

export type Ego = { z: number; v: number; lane: number; length: number };

const S0 = 2.5; // jam distance, m
const CHANGE_TIME = 3.2; // s to drive across a lane
const SIGNAL_TIME = 1.4; // s of indicator before moving
const B_SAFE = 3.5; // m/s^2 the follower in the target lane may be asked to brake

/** IDM acceleration for a car at speed v with a gap and closing speed to its leader. */
export function idm(n: Pick<Npc, "v0" | "T" | "a" | "b">, v: number, gap: number, dv: number) {
  const sStar = S0 + Math.max(0, v * n.T + (v * dv) / (2 * Math.sqrt(n.a * n.b)));
  const free = 1 - Math.pow(v / Math.max(n.v0, 0.1), 4);
  return n.a * (free - Math.pow(sStar / Math.max(gap, 0.1), 2));
}

type Body = { z: number; v: number; length: number };

export class Traffic {
  cars: Npc[] = [];
  private nextId = 1;
  constructor(public lanes: number, public oncomingLanes: number) {}

  add(n: Omit<Npc, "id" | "from" | "t" | "signal" | "signalT" | "braking" | "cooldown" | "x">) {
    const car: Npc = { ...n, id: this.nextId++, from: n.lane, t: 1, signal: 0, signalT: 0, braking: false, cooldown: 2, x: 0 };
    this.cars.push(car);
    return car;
  }

  /** The nearest car ahead of z in a lane (same direction), the ego included. */
  private leader(lane: number, z: number, oncoming: boolean, ego: Ego | null, self?: Npc): Body | null {
    let best: Body | null = null, bestGap = Infinity;
    for (const o of this.cars) {
      if (o === self || o.oncoming !== oncoming || !occupies(o, lane)) continue;
      const gap = (o.z - z) * dirOf(oncoming);
      if (gap > 0 && gap < bestGap) { bestGap = gap; best = o; }
    }
    if (ego && !oncoming && ego.lane === lane) {
      const gap = ego.z - z;
      if (gap > 0 && gap < bestGap) best = ego;
    }
    return best;
  }

  private follower(lane: number, z: number, oncoming: boolean, ego: Ego | null, self?: Npc): Body | null {
    let best: Body | null = null, bestGap = Infinity;
    for (const o of this.cars) {
      if (o === self || o.oncoming !== oncoming || !occupies(o, lane)) continue;
      const gap = (z - o.z) * dirOf(oncoming);
      if (gap > 0 && gap < bestGap) { bestGap = gap; best = o; }
    }
    if (ego && !oncoming && ego.lane === lane) {
      const gap = z - ego.z;
      if (gap > 0 && gap < bestGap) best = ego;
    }
    return best;
  }

  private accel(n: Pick<Npc, "v0" | "T" | "a" | "b">, z: number, v: number, lead: Body | null, length: number, dir = 1) {
    if (!lead) return idm(n, v, 1e4, 0);
    return idm(n, v, (lead.z - z) * dir - (lead.length + length) / 2, v - lead.v);
  }

  step(dt: number, ego: Ego | null) {
    for (const n of this.cars) {
      if (n.hit) {
        // sliding on locked or scrubbing tyres until it stops
        const h = n.hit, sp = Math.hypot(h.vx, n.v), f = Math.min(1, (7 * dt) / Math.max(sp, 0.01));
        h.vx -= h.vx * f; n.v -= n.v * f;
        h.r *= Math.exp(-dt * 1.2);
        n.x += h.vx * dt; n.z += n.v * dt * dirOf(n.oncoming); h.yaw += h.r * dt;
        n.braking = true;
        continue;
      }
      const lanesHere = n.oncoming ? this.oncomingLanes : this.lanes;
      // follow whoever is ahead in either lane it touches
      const dir = dirOf(n.oncoming);
      let acc = this.accel(n, n.z, n.v, this.leader(n.lane, n.z, n.oncoming, ego, n), n.length, dir);
      if (n.t < 1) acc = Math.min(acc, this.accel(n, n.z, n.v, this.leader(n.from, n.z, n.oncoming, ego, n), n.length, dir));
      acc = Math.max(-9, acc);
      n.braking = acc < -0.6;
      n.v = Math.max(0, n.v + acc * dt);
      n.z += n.v * dt * dir;

      // a lane change under way
      if (n.signal && n.t >= 1) {
        n.signalT += dt;
        if (n.signalT > SIGNAL_TIME) {
          const target = n.lane + n.signal;
          // still safe? then go
          if (target >= 0 && target < lanesHere && this.safe(n, target, ego)) { n.from = n.lane; n.lane = target; n.t = 0; }
          else if (n.signalT > SIGNAL_TIME * 3) { n.signal = 0; n.signalT = 0; n.cooldown = 4; }
        }
      }
      if (n.t < 1) {
        n.t = Math.min(1, n.t + dt / CHANGE_TIME);
        if (n.t >= 1) { n.from = n.lane; n.signal = 0; n.signalT = 0; n.cooldown = 6 + (n.id % 5); }
      }
      n.cooldown -= dt;
      if (!n.signal && n.t >= 1 && n.cooldown <= 0) this.consider(n, lanesHere, ego);
    }
  }

  /** Would the car behind in the target lane have to brake hard if n moved in? */
  private safe(n: Npc, lane: number, ego: Ego | null) {
    const lead = this.leader(lane, n.z, n.oncoming, ego, n);
    const dir = dirOf(n.oncoming);
    if (lead && (lead.z - n.z) * dir - (lead.length + n.length) / 2 < S0 + 1) return false;
    const back = this.follower(lane, n.z, n.oncoming, ego, n);
    if (!back) return true;
    const gap = (n.z - back.z) * dir - (back.length + n.length) / 2;
    if (gap < S0 + 1) return false;
    const proto = (back as Npc).v0 !== undefined ? (back as Npc) : { v0: back.v, T: 1.0, a: 2, b: 3 };
    return idm(proto, back.v, gap, back.v - n.v) > -B_SAFE;
  }

  /** MOBIL: change if it gains enough and costs the others little. */
  private consider(n: Npc, lanesHere: number, ego: Ego | null) {
    const dir = dirOf(n.oncoming);
    const here = this.accel(n, n.z, n.v, this.leader(n.lane, n.z, n.oncoming, ego, n), n.length, dir);
    if (here > -0.2 && n.v > n.v0 * 0.95) return; // happy where it is
    let best = 0, gain = 0.4; // the threshold, m/s^2
    for (const d of [-1, 1] as const) {
      const lane = n.lane + d;
      if (lane < 0 || lane >= lanesHere || !this.safe(n, lane, ego)) continue;
      const there = this.accel(n, n.z, n.v, this.leader(lane, n.z, n.oncoming, ego, n), n.length, dir);
      // keep right unless overtaking: a small bias toward the slow lane
      const bias = d < 0 ? 0.15 : -0.1;
      const back = this.follower(lane, n.z, n.oncoming, ego, n);
      let cost = 0;
      if (back) {
        const proto = (back as Npc).v0 !== undefined ? (back as Npc) : { v0: back.v, T: 1.0, a: 2, b: 3 };
        const before = this.accel(proto, back.z, back.v, this.leader(lane, back.z, n.oncoming, null, n), back.length, dir);
        const after = idm(proto, back.v, (n.z - back.z) * dir - (back.length + n.length) / 2, back.v - n.v);
        cost = Math.max(0, before - after);
      }
      const g = there - here - n.politeness * cost + bias;
      if (g > gain) { gain = g; best = d; }
    }
    if (best) { n.signal = best as -1 | 1; n.signalT = 0; }
  }

  remove(pred: (n: Npc) => boolean) { this.cars = this.cars.filter((n) => !pred(n)); }
}

const dirOf = (oncoming: boolean) => (oncoming ? -1 : 1);

/** Does a car take up a lane: its own, and the one it is leaving while it crosses. */
export function occupies(n: Npc, lane: number) { return n.lane === lane || (n.t < 1 && n.from === lane); }

/** Smooth lateral progress through a lane change (an S curve). */
export function crossing(n: Npc) { const t = n.t; return t * t * (3 - 2 * t); }
