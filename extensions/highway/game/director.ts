// Where traffic appears. Traffic Racer drops one random car in a random lane
// every 0.2 s and trusts low numbers to keep the road passable; this plans
// the road ahead in rows instead. A row is a pattern (one car, a pair, a door
// to thread, a staggered line, a slow truck with company, a near wall) placed
// past the far edge of what you can see; every row leaves a lane through it,
// checked against the cars already there; rows come closer together as the
// run goes on, with a breather now and then that the game announces.
//
// Pure: it decides kinds, lanes, gaps and speeds; the caller makes the cars.

import { FEEL } from "./content.ts";

export type Spawn = { lane: number; dz: number; heavy: boolean; v0: number; oncoming: boolean };
export type Row = { z: number; spawns: Spawn[]; pattern: string };

export type DirectorOpts = {
  lanes: number; oncomingLanes: number;
  topSpeed: number; // the player's car, m/s: traffic speeds scale with it, as in the original
  rnd: () => number;
  density?: number; // the place's traffic, 1 normal
};

export type Occupant = { lane: number; z: number; oncoming: boolean };

const PATTERNS: { name: string; weight: (d: number) => number; make: (o: DirectorOpts, r: () => number) => { lane: number; dz: number; heavy?: boolean }[] }[] = [
  { name: "single", weight: (d) => 3 - d * 1.5, make: (o, r) => [{ lane: Math.floor(r() * o.lanes), dz: 0 }] },
  { name: "pair", weight: (d) => 1.5 + d, make: (o, r) => { const a = Math.floor(r() * o.lanes); let b = Math.floor(r() * (o.lanes - 1)); if (b >= a) b++; return [{ lane: a, dz: 0 }, { lane: b, dz: (r() - 0.5) * 6 }]; } },
  // two cars a lane apart: the gap between them is the line to take
  { name: "door", weight: (d) => 0.6 + d * 1.5, make: (o, r) => { const a = Math.floor(r() * (o.lanes - 2)); return [{ lane: a, dz: 0 }, { lane: a + 2, dz: (r() - 0.5) * 3 }]; } },
  // a diagonal: weave through it
  { name: "stagger", weight: (d) => 0.5 + d, make: (o, r) => { const up = r() < 0.5, n = Math.min(3, o.lanes - 1), s = Math.floor(r() * (o.lanes - n + 1)); return Array.from({ length: n }, (_, i) => ({ lane: up ? s + i : s + n - 1 - i, dz: i * (14 + r() * 8) })); } },
  // a truck in the slow lanes, a car keeping it company
  { name: "truck", weight: () => 1, make: (o, r) => { const t = Math.floor(r() * Math.min(2, o.lanes)); const c = t + 1 < o.lanes ? t + 1 : t - 1; return r() < 0.6 ? [{ lane: t, dz: 0, heavy: true }, { lane: c, dz: 8 + r() * 16 }] : [{ lane: t, dz: 0, heavy: true }]; } },
  // all lanes but one: find it
  { name: "wall", weight: (d) => Math.max(0, d * 2 - 0.8), make: (o, r) => { const open = Math.floor(r() * o.lanes); return Array.from({ length: o.lanes }, (_, l) => l).filter((l) => l !== open).map((l) => ({ lane: l, dz: (r() - 0.5) * 8 })); } },
];

// Traffic Racer's density, measured from its code: 5 cars in the 140 m ahead of you at the start,
// one more every 27 s, up to 14. (It then drops back to 6; a breather now and then does that job here.)
const SPAN = 140, START = 5, MOST = 14, RAMP = 27;

export class Director {
  frontier = 0; // the z the next row goes at
  time = 0; // seconds into the run
  /** A lane kept free up to a point: the start, so a run never opens with a car in your lane. */
  spare: { lane: number; until: number } | null = null;
  breather = 0; // metres of open road left in a breather
  constructor(public o: DirectorOpts) {}

  /** How dense the road is now, 0..1: busy from the first second, at full strength after ~4 km. */
  density() { return Math.min(1, (this.time / RAMP / (MOST - START)) * (this.o.density ?? 1)) * (this.breather > 0 ? 0.3 : 1); }

  /** Cars wanted in the 140 m ahead: 5, then one more every 27 s, up to 14. */
  cap() { return START + (MOST - START) * this.density(); }

  /** The speed a driver in a lane wants: below yours, faster to the left, trucks slowest. */
  private speed(lane: number, heavy: boolean, oncoming: boolean) {
    const r = this.o.rnd, top = this.o.topSpeed * 3.6;
    if (oncoming) return ((50 + r() * 25) / 3.6) * FEEL.pace;
    // the original's band, from your car's top speed: always slower than you, more so in a faster car
    const lo = 9 + top / 5.7, hi = 51.5 + top / 5.5;
    const k = this.o.lanes > 1 ? lane / (this.o.lanes - 1) : 0.5;
    const kmh = heavy ? Math.min(hi, lo + (hi - lo) * 0.35 + r() * 8) : lo + (hi - lo) * (0.15 + 0.6 * k + r() * 0.25);
    return (kmh / 3.6) * FEEL.pace; // the band is in dial km/h; the world goes by at the pace
  }

  /** Plan rows until the frontier is far enough ahead of the player. */
  plan(playerZ: number, playerV: number, cars: Occupant[]): Row[] {
    const rows: Row[] = [];
    const reach = playerZ + Math.max(320, playerV * 7); // past where you can make anything out
    if (this.frontier < playerZ + 45) this.frontier = playerZ + 45; // the first cars close enough to matter at once
    while (this.frontier < reach) {
      const d = this.density();
      const row = this.row(this.frontier, d, cars);
      if (row.spawns.length) rows.push(row);
      for (const s of row.spawns) cars.push({ lane: s.lane, z: row.z + s.dz, oncoming: s.oncoming });
      // the next row: spaced so the 140 m ahead holds the cars the moment calls for
      const ours = row.spawns.filter((s) => !s.oncoming).length || 1;
      const gap = (SPAN * ours / this.cap()) * (0.75 + this.o.rnd() * 0.5);
      this.frontier += gap;
      if (this.breather > 0) this.breather -= gap;
      else if (d > 0.5 && this.o.rnd() < 0.025) this.breather = 600;
    }
    return rows;
  }

  private row(z: number, d: number, cars: Occupant[]): Row {
    const r = this.o.rnd;
    const total = PATTERNS.reduce((a, p) => a + Math.max(0, p.weight(d)), 0);
    let pick = r() * total, p = PATTERNS[0];
    for (const x of PATTERNS) { pick -= Math.max(0, x.weight(d)); if (pick <= 0) { p = x; break; } }
    let spawns = p.make(this.o, r).map((s) => ({ ...s, heavy: !!s.heavy }));
    // never close the road: count the lanes this row and nearby cars block
    const blocked = (extra: typeof spawns) => {
      const set = new Set<number>();
      for (const c of cars) if (!c.oncoming && Math.abs(c.z - z) < 28) set.add(c.lane);
      for (const s of extra) set.add(s.lane);
      return set;
    };
    while (spawns.length && blocked(spawns).size >= this.o.lanes) spawns.pop();
    if (this.spare && z < this.spare.until) spawns = spawns.filter((s) => s.lane !== this.spare!.lane);
    // and keep clear of a car already in the same spot
    spawns = spawns.filter((s) => !cars.some((c) => !c.oncoming && c.lane === s.lane && Math.abs(c.z - (z + s.dz)) < 14));
    const out: Spawn[] = spawns.map((s) => ({ lane: s.lane, dz: s.dz, heavy: s.heavy, v0: this.speed(s.lane, s.heavy, false), oncoming: false }));
    // the other carriageway, on a two-way road: steady oncoming traffic
    if (this.o.oncomingLanes && r() < 0.35 + d * 0.5) {
      const lane = Math.floor(r() * this.o.oncomingLanes), heavy = r() < 0.2;
      out.push({ lane, dz: r() * 20, heavy, v0: this.speed(lane, heavy, true), oncoming: true });
    }
    return { z, spawns: out, pattern: p.name };
  }
}
