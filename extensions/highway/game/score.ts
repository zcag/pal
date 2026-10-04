// A run's score and pay. The shape is Traffic Racer's, measured from its
// code: points grow with the cube of speed (and a square on top past 100 km/h),
// so speed is the dial; a close pass above 100 km/h is a near miss, and near
// misses inside 4 s of each other build a combo. Ours grades the gap you
// actually left and shows the combo's clock; the oncoming lane pays three
// times; two passes at once (threading a door) pay a bonus.

export const NEAR_SPEED = 100; // km/h: below this nothing counts as a near miss, and a combo dies
export const COMBO_TIME = 4; // s
export const GRADES = [
  { gap: 0.3, name: "Paint trader", mult: 2.5 },
  { gap: 0.6, name: "Very close", mult: 1.6 },
  { gap: 1.0, name: "Close", mult: 1 },
] as const;

export type Miss = { points: number; grade: (typeof GRADES)[number]; combo: number; oncoming: boolean; double: boolean };

/** Points a second at a speed (km/h), and for being in the oncoming lane. */
export function rate(kmh: number, oncomingLane: boolean) {
  if (kmh < 60) return 0;
  let p = kmh ** 3 * 1e-6 + (kmh >= 100 ? kmh * kmh / 3000 : 0);
  if (oncomingLane) p += kmh * kmh / 900;
  return p * 25; // the original counts per 0.04 s tick
}

export class Score {
  points = 0;
  combo = 0; comboLeft = 0; bestCombo = 0;
  misses = 0;
  distance = 0; // m
  fastTime = 0; // s above 100 km/h
  oncomingTime = 0; // s in the oncoming lane
  topSpeed = 0; // km/h
  private lastMiss = -1;
  time = 0;

  /** Every step: drive at a speed, maybe in the oncoming lane. */
  tick(dt: number, kmh: number, oncomingLane: boolean) {
    this.time += dt;
    this.points += rate(kmh, oncomingLane) * dt;
    this.distance += (kmh / 3.6) * dt;
    if (kmh >= NEAR_SPEED) this.fastTime += dt;
    if (oncomingLane && kmh > 60) this.oncomingTime += dt;
    this.topSpeed = Math.max(this.topSpeed, kmh);
    if (this.combo) {
      this.comboLeft -= dt;
      if (this.comboLeft <= 0 || kmh < NEAR_SPEED) this.breakCombo();
    }
  }

  /** A car passed you with `gap` metres between the bodies. Null when it doesn't count. */
  pass(gap: number, kmh: number, oncoming: boolean): Miss | null {
    if (kmh < NEAR_SPEED || gap > GRADES[GRADES.length - 1].gap) return null;
    const grade = GRADES.find((g) => gap <= g.gap)!;
    this.combo++;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboLeft = COMBO_TIME;
    this.misses++;
    const n = this.combo;
    let base = n <= 5 ? 100 * n : Math.min(100 * n, 500 + 20 * Math.floor(kmh - 100));
    base *= grade.mult;
    if (oncoming) base *= 3;
    const double = this.time - this.lastMiss < 0.15;
    if (double) base += 2500;
    this.lastMiss = this.time;
    const points = Math.round(base);
    this.points += points;
    return { points, grade, combo: n, oncoming, double };
  }

  breakCombo() { this.combo = 0; this.comboLeft = 0; }

  /** Cash for the run (the original's v4 rates, before any multiplier). */
  cash() {
    return Math.round((this.distance / 1000) * 200 + this.misses * 15 + this.fastTime * 7.5 + this.oncomingTime * 12);
  }
}
