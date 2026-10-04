// A driver for a Drive, for scripts: it reads only what a player sees (your
// car, the traffic, the lanes) and answers with the keys a player would press.
// Skill is a handful of human limits: how stale the traffic it sees is, how
// far ahead it plans, how fast it dares to go, how close it passes and how
// well it hits that line, and how often it looks away. scripts/economy.ts
// plays thousands of runs with it to measure what a run pays.
import type { Drive } from "./drive.ts";
import { acrossAt, turnOf, type Input } from "./vehicle.ts";
import { FEEL, trafficTop, CARS } from "./content.ts";
import { laneX, oncomingX, LANE_W } from "./layout.ts";

export type Skill = {
  name: string;
  react: number; // s: the traffic it acts on is this old (then guessed forward at constant speed)
  look: number; // s of slack (time before it must brake for a car) under which it looks for a way round
  brakeAt: number; // s of slack, with no lane offering more, at which it brakes
  speed: number; // target, as a share of the car's top speed
  gap: number; // m it aims to leave passing a car alongside (Infinity: keeps to the lane's middle)
  aim: number; // m: spread of where that pass actually lands
  wander: number; // m: how far its line drifts in a lane
  lapse: number; // looks away this many times a minute ...
  lapseFor: number; // ... for this long: nothing it sees changes, nothing it does changes
  oncoming: number; // 0..1: how much it likes the oncoming side (Two-Way), 0 never goes there
  signals: boolean; // reads indicators: a car signalling is already in the lane it wants
  nitro: number; // lights the nitro at this much bar (over 1: never)
  nerve: number; // km/h: how much faster than the traffic it dares to go in the first car; a car that changes lanes quicker earns it more
};

/** Four players. "new" keeps to the lanes' middles, slowly, and crashes in a few minutes; "ace" lives on the paint. */
export const SKILLS: Record<string, Skill> = {
  new: { name: "new", nerve: 70, react: 0.5, look: 1.8, brakeAt: 0.6, speed: 0.8, gap: Infinity, aim: 0.4, wander: 0.35, lapse: 5, lapseFor: 1.4, oncoming: 0, signals: false, nitro: 2 },
  regular: { name: "regular", nerve: 100, react: 0.36, look: 1.4, brakeAt: 0.45, speed: 0.9, gap: 0.75, aim: 0.3, wander: 0.22, lapse: 3, lapseFor: 1.2, oncoming: 0.15, signals: false, nitro: 0.9 },
  good: { name: "good", nerve: 140, react: 0.24, look: 1.1, brakeAt: 0.35, speed: 0.97, gap: 0.45, aim: 0.18, wander: 0.12, lapse: 1.6, lapseFor: 1.0, oncoming: 0.5, signals: true, nitro: 0.6 },
  ace: { name: "ace", nerve: 200, react: 0.16, look: 0.9, brakeAt: 0.25, speed: 1, gap: 0.25, aim: 0.1, wander: 0.06, lapse: 0.6, lapseFor: 0.9, oncoming: 0.8, signals: true, nitro: 0.4 },
};

type Seen = { id: number; x: number; z: number; v: number; w: number; l: number; oncoming: boolean; signal: number };
type Slot = { x: number; oncoming: boolean; plan: number; now: number; stop: number; clear: number };

const PLAN = 1 / 30; // it looks and decides 30 times a second

export class Bot {
  /** Seconds left of looking away (0 when watching the road). */
  lapsing = 0;
  private t = 0;
  private seen: { t: number; cars: Seen[] }[] = [];
  private slots: Slot[];
  private slot: number; // the lane it is in or moving to
  private aims = new Map<number, number>(); // per car passed: how far off its line it lands
  private drift = 0; // the line's slow wander, m
  private hugX = 0;
  private plan = 0;
  private out: Input = { throttle: 1, brake: 0, steer: 0 };
  private seed: number;
  private first = { agility: CARS[0].agility } as Drive["veh"]["spec"]; // the first car's handling, the yardstick for `nerve`

  constructor(public d: Drive, public skill: Skill, seed = 1) {
    this.seed = (seed % 2147483646) + 1;
    const L = d.layout;
    // every lane across the road, right to left: ours, then (Two-Way) theirs
    this.slots = [
      ...Array.from({ length: L.lanes }, (_, i) => ({ x: laneX(L, i), oncoming: false, plan: Infinity, now: Infinity, stop: Infinity, clear: 0 })),
      ...Array.from({ length: L.oncoming }, (_, i) => ({ x: oncomingX(L, i), oncoming: true, plan: Infinity, now: Infinity, stop: Infinity, clear: 0 })),
    ].sort((a, b) => a.x - b.x);
    this.slot = this.nearest(d.veh.x);
  }

  private rnd() { return (this.seed = (this.seed * 16807) % 2147483647) / 2147483647; }
  private gauss() { return Math.sqrt(-2 * Math.log(this.rnd() + 1e-12)) * Math.cos(2 * Math.PI * this.rnd()); }
  private nearest(x: number) { let b = 0; this.slots.forEach((s, i) => { if (Math.abs(s.x - x) < Math.abs(this.slots[b].x - x)) b = i; }); return b; }

  /** The dial's top speed of the car as built (upgrades included). */
  private top() { const s = this.d.veh.spec as { top?: number }; return s.top ? (s.top * 3.6) / FEEL.pace : this.d.car.top; }

  step(dt: number): Input {
    const d = this.d, v = d.veh, k = this.skill;
    this.t += dt;
    // what it sees: a snapshot of the traffic now and then, kept as long as its reactions lag
    if (this.seen.length === 0 || this.t - this.seen[this.seen.length - 1].t >= PLAN - 1e-9) {
      this.seen.push({ t: this.t, cars: d.traffic.cars.map((n) => ({ id: n.id, x: n.x, z: n.z, v: n.hit ? 0 : n.v, w: n.width, l: n.length, oncoming: n.oncoming, signal: n.signal })) });
      while (this.seen.length > 2 && this.seen[1].t <= this.t - k.react - this.lapsing) this.seen.shift();
    }
    // looking away: it starts at random, and while it lasts the plan and the keys stay as they were
    if (this.lapsing > 0) { this.lapsing = Math.max(0, this.lapsing - dt); this.steerTo(dt); return this.out; }
    if (this.rnd() < (k.lapse / 60) * dt) { this.lapsing = k.lapseFor * (0.6 + this.rnd() * 0.8); return this.out; }
    if ((this.plan -= dt) > 0) { this.steerTo(dt); return this.out; }
    this.plan = PLAN;

    // the traffic as it was `react` ago, guessed forward to now; per lane, seconds until it reaches the first
    // car in it (`plan` at the speed it wants, `now` at the speed it has), and `stop`: seconds it could hold
    // its speed and still brake behind it. A player dodges by lanes and brakes only when boxed in, so lanes
    // are judged by the first and the brakes by the second.
    const snap = this.seen[0], age = this.t - snap.t;
    const me = { x: v.x, z: v.z, u: v.u, w: d.size.x, l: d.size.z };
    const dd = d as { floor?: number; mode?: string; nitro?: number; boosting?: boolean };
    // as fast as it dares: a player settles at a speed over the traffic they can still dodge at, more in a car
    // that changes lanes quicker; a Speed Trap's floor overrules it
    const tt = trafficTop(d.car, d.up), traffic = ((9 + tt / 5.7) + (51.5 + tt / 5.5)) / 2;
    const dare = traffic + k.nerve * (acrossAt(v.spec, v.u) / acrossAt(this.first, v.u));
    const target = Math.max(Math.min(this.top() * k.speed, dare), dd.mode === "trap" && dd.floor ? dd.floor + 6 : 0);
    const decel = v.spec.brake * 9.81 * FEEL.brake * FEEL.pace; // what full brakes do (game/vehicle.ts)
    const want = Math.max(me.u, (target / 3.6) * FEEL.pace * 0.9);
    // a car ahead closer than a following distance counts as no slack at all
    const slackAt = (u: number, dz: number, c: Seen, braking: boolean) => {
      const closing = u - (c.oncoming ? -c.v : c.v);
      if (!c.oncoming && dz < 2 + 0.2 * u) return Math.min(0, closing);
      return closing > 0.1 ? Math.max(0, dz) / closing - (c.oncoming ? 0.6 : braking ? closing / (2 * decel) : 0) : Infinity;
    };
    for (const s of this.slots) { s.plan = s.now = s.stop = Infinity; s.clear = 0; }
    const cars = snap.cars.map((c) => ({ ...c, z: c.z + (c.oncoming ? -1 : 1) * c.v * age }));
    for (const c of cars) {
      const xs = [c.x];
      if (k.signals && c.signal) xs.push(c.x + (c.oncoming ? -1 : 1) * c.signal * LANE_W);
      const dz = c.z - me.z, long = (c.l + me.l) / 2;
      for (const s of this.slots) {
        if (!xs.some((x) => Math.abs(x - s.x) < (c.w + me.w) / 2 + 0.35)) continue;
        // alongside: how long until it has dropped behind (the time it blocks moving over)
        const closing = me.u - (c.oncoming ? -c.v : c.v);
        if (Math.abs(dz) < long + 1.5) s.clear = Math.max(s.clear, closing > 0.5 ? (dz + long + 1.5) / closing : Infinity);
        if (dz <= -long * 0.5) continue;
        s.plan = Math.min(s.plan, slackAt(want, dz - long, c, false));
        s.now = Math.min(s.now, slackAt(me.u, dz - long, c, false));
        s.stop = Math.min(s.stop, slackAt(me.u, dz - long, c, true));
      }
    }

    // which lane: the most slack, reached through lanes it can cross before their own cars arrive and
    // after the ones beside them have dropped back (it overlaps a lane once within a car's width of it);
    // it only looks round when its own lane is getting short, and then only moves for a clearly better one
    const across = this.across(), CAP = 4;
    const value = (i: number) => {
      const s = this.slots[i];
      if (s.oncoming && k.oncoming <= 0) return -Infinity;
      let val = Math.min(CAP, s.plan);
      const step = i > this.slot ? 1 : -1;
      for (let j = this.slot + step; i !== this.slot && j !== i + step; j += step) {
        const p = this.slots[j];
        const reach = Math.abs(p.x - me.x) / across;
        if ((p.oncoming && k.oncoming <= 0) || p.clear > Math.max(0, Math.abs(p.x - me.x) - me.w - 0.3) / across) return -Infinity;
        if (p.now < reach + 0.2) return -Infinity;
        val = Math.min(val, p.plan + 0.5);
      }
      if (s.oncoming) val += (k.oncoming - 0.5) * 2; // the oncoming side pays three times, if it dares
      return val - 0.1 * Math.abs(i - this.slot);
    };
    const values = this.slots.map((_, i) => value(i));
    // someone moved in beside the lane it is crossing to: that lane is out until it is clear again
    if (this.slots[this.slot].clear > 0 && Math.abs(this.slots[this.slot].x - me.x) > me.w + 0.3) values[this.slot] = -Infinity;
    const stay = values[this.slot] >= k.look && values.every((x, i) => i === this.slot || x < values[this.slot] + 1);
    if (!stay) {
      let best = this.nearest(me.x);
      values.forEach((x, i) => { if (x + (i === this.slot ? 0.3 : 0) > values[best] + (best === this.slot ? 0.3 : 0)) best = i; });
      this.slot = best;
    }

    // passing close: line up beside the next car it passes in a lane next door, `gap` off its side
    this.hugX = 0;
    const kmh = d.kmh, here = this.slots[this.slot];
    if (Number.isFinite(k.gap) && kmh > 103) {
      let pick: (typeof cars)[number] | null = null, soon = 1.1;
      for (const c of cars) {
        const off = c.x - here.x;
        if (Math.abs(off) < 2.4 || Math.abs(off) > LANE_W * 1.4 || (c.oncoming && k.oncoming < 0.3)) continue;
        const closing = me.u - (c.oncoming ? -c.v : c.v), tp = (c.z - me.z) / Math.max(closing, 0.1);
        if (tp > -0.05 && tp < soon) { soon = tp; pick = c; }
      }
      if (pick) {
        let err = this.aims.get(pick.id);
        if (err === undefined) { err = this.gauss() * k.aim; this.aims.set(pick.id, err); if (this.aims.size > 64) this.aims.delete(this.aims.keys().next().value!); }
        const sgn = Math.sign(pick.x - here.x), want = (pick.w + me.w) / 2 + k.gap + (pick.oncoming ? 0.25 : 0) + err;
        this.hugX = Math.max(-2.1, Math.min(2.1, pick.x - sgn * want - here.x));
      }
    }

    // speed: its share of the top (over a Speed Trap's floor); off the gas when the lane it is in or
    // going to is closing, brakes when that is about to be too late; nitro on an open road
    // brakes when the lane it is going to will not let it stop in time, or the lane it is leaving reaches it
    // before it is out (its car's width clear of that lane's line)
    const cur = this.slots[this.nearest(me.x)];
    const out = cur === here ? Infinity : cur.now - Math.max(0, me.w + 0.3 - Math.abs(cur.x - me.x)) / across - 0.15;
    const danger = Math.min(here.stop, out + k.brakeAt);
    const boxed = danger < k.brakeAt, lift = danger < k.brakeAt + 0.4;
    const nitro = typeof dd.nitro === "number" && !dd.boosting && dd.nitro >= k.nitro && here.plan >= CAP && kmh > 100;
    this.out = { throttle: !boxed && !lift && kmh < target ? 1 : 0, brake: boxed ? 1 : 0, steer: this.out.steer, nitro };
    this.drift += (-this.drift * PLAN) / 0.8 + k.wander * Math.sqrt((2 * PLAN) / 0.8) * this.gauss();
    this.steerTo(dt);
    return this.out;
  }

  /** How fast full steering crosses the road now (game/vehicle.ts's arcade control), m/s. */
  private across() { return acrossAt(this.d.veh.spec, this.d.veh.u); }

  /** Steer toward the lane's line: a sideways speed that shrinks as the line comes near, so it settles without weaving. */
  private steerTo(_dt: number) {
    const v = this.d.veh, x = this.slots[this.slot].x + this.hugX + this.drift;
    const across = this.across(), lat = v.u * Math.sin(v.yaw) + v.v * Math.cos(v.yaw);
    const dx = x - v.x;
    const stop = turnOf(v.spec) * 1.9 * 0.6; // how hard it can check the slide, with room to spare
    const want = Math.sign(dx) * Math.min(across, Math.sqrt(2 * stop * Math.abs(dx)), 5 * Math.abs(dx));
    this.out.steer = Math.max(-1, Math.min(1, (want + (want - lat) * 0.6) / across));
  }
}
