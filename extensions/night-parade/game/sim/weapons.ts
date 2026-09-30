// How each of the sixteen weapons fights (content/weapons.ts has the
// numbers and docs/design.md what each is for). Every weapon reads its
// `ws`: its level's numbers with your stats already in (core.ts
// `weaponStats`). The shots and ground zones they leave are stepped here too.
import { BREAK_SHOTS, type WeaponKind } from "../content/weapons.ts";
import { next, pick, range } from "../rng.ts";
import {
  fx, heal, hurt, near, status, targetable,
  type Enemy, type Grid, type Shot, type ShotSprite, type State, type Weapon, type Zone,
} from "./core.ts";

type Fire = (s: State, w: Weapon, g: Grid, dt: number) => void;

// ---- aiming -----------------------------------------------------------------------------------------------------------

function nearest(s: State, n: number, r = 220): Enemy[] {
  const { x, y } = s.p, out: [number, Enemy][] = [];
  for (const e of s.enemies) {
    if (!targetable(e)) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d < r) out.push([d, e]);
  }
  return out.sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);
}

function toughest(s: State, r: number, skip: Set<number>): Enemy | undefined {
  let best: Enemy | undefined;
  for (const e of s.enemies) {
    if (!targetable(e) || skip.has(e.id) || Math.hypot(e.x - s.p.x, e.y - s.p.y) > r) continue;
    if (!best || e.hp > best.hp) best = e;
  }
  return best;
}

function randomNear(s: State, r: number, skip?: Set<number>): Enemy | undefined {
  const xs = s.enemies.filter((e) => targetable(e) && !skip?.has(e.id) && Math.hypot(e.x - s.p.x, e.y - s.p.y) < r);
  return xs.length ? pick(s.rng, xs) : undefined;
}

/** Where the crowd is thickest near you: the best of a few random enemies by how many stand around it. */
function crowd(s: State, r: number, skip: { x: number; y: number }[]): { x: number; y: number } | undefined {
  let best: Enemy | undefined, score = -1;
  for (let i = 0; i < 10; i++) {
    const e = randomNear(s, r);
    if (!e || skip.some((q) => Math.hypot(q.x - e.x, q.y - e.y) < 30)) continue;
    let n = 0;
    for (const o of s.enemies) if (targetable(o) && Math.abs(o.x - e.x) < 30 && Math.abs(o.y - e.y) < 30) n++;
    if (n > score) { score = n; best = e; }
  }
  return best;
}

const shot = (w: Weapon, sprite: ShotSprite, x: number, y: number, a: number, v: number, r: number, more: Partial<Shot> = {}): Shot => ({
  weapon: w.kind, sprite, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r, dmg: w.ws.dmg, crit: w.ws.crit, pierce: w.ws.pierce,
  life: w.ws.dur, age: 0, kb: w.ws.kb, hit: new Set(), homing: false, back: false, spin: 0, ...more,
});

const zone = (w: Weapon | "hero", kind: Zone["kind"], x: number, y: number, r: number, dmg: number, life: number, tick: number, more: Partial<Zone> = {}): Zone => ({
  weapon: w === "hero" ? "hero" : w.kind, kind, x, y, r, dmg, life, tick, next: new Map(), fuse: 0, vx: 0, vy: 0, age: 0, ...more,
});

/** Break the enemy shots within r of (x, y): your attacks swat them out of the air (all but the Oni's club). */
export function breakShots(s: State, x: number, y: number, r: number) {
  if (!BREAK_SHOTS || !s.foeShots.length) return;
  for (const f of s.foeShots)
    if (f.life > 0 && f.kind !== "club" && Math.abs(f.x - x) < r + f.r && Math.abs(f.y - y) < r + f.r && Math.hypot(f.x - x, f.y - y) < r + f.r) {
      f.life = 0;
      if (s.fx.length < 120) s.fx.push(fx("hit", f.x, f.y, 0.25, false, 0.5));
    }
}

const hitOf = (w: Weapon, from: { x: number; y: number }, push = w.ws.kb) => ({ weapon: w.kind, crit: w.ws.crit, push, from });

// ---- the sixteen -------------------------------------------------------------------------------------------------------

const shuriken: Fire = (s, w) => {
  const ws = w.ws, n = ws.amount, targets = nearest(s, n);
  for (let i = 0; i < n; i++) {
    const t = targets[i % Math.max(1, targets.length)];
    const a = t ? Math.atan2(t.y - s.p.y, t.x - s.p.x) + (i >= targets.length ? range(s.rng, -0.6, 0.6) : 0) : range(s.rng, 0, Math.PI * 2);
    s.shots.push(shot(w, w.evolved ? "shuriken-magic" : "shuriken", s.p.x, s.p.y, a, ws.speed, 5 * ws.area, { homing: w.evolved, back: w.evolved, life: ws.dur * (w.evolved ? 1.8 : 1) }));
  }
  s.events.push({ sfx: "throw" });
};

const kunai: Fire = (s, w) => {
  const ws = w.ws, { x: fx_, y: fy } = s.p.face;
  const n = w.evolved ? (s.p.moving ? 2 : 1) : ws.amount;
  const a0 = Math.atan2(fy, fx_);
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 6;
    const a = a0 + (w.evolved ? range(s.rng, -0.18, 0.18) : 0);
    s.shots.push(shot(w, w.evolved ? "kunai-big" : "kunai", s.p.x - fy * off, s.p.y + fx_ * off, a, ws.speed, (w.evolved ? 5 : 4) * ws.area));
  }
  if (!w.evolved || w.drops++ % 3 === 0) s.events.push({ sfx: "throw" });
};

/** A katana cut on one side (±1): a box in front of you. */
function cut(s: State, w: Weapon, g: Grid, side: number) {
  const ws = w.ws, W = 72 * ws.area, H = 30 * ws.area, cx = s.p.x + side * (W / 2 + 4), cy = s.p.y - 2;
  near(g, cx, cy, Math.hypot(W, H) / 2, (e) => {
    if (Math.abs(e.x - cx) <= W / 2 + e.r && Math.abs(e.y - cy) <= H / 2 + e.r) hurt(s, e, ws.dmg, hitOf(w, s.p));
  });
  s.fx.push(fx("slash", cx, cy, 0.22, side < 0, ws.area * 1.4));
  breakShots(s, cx, cy, W / 2);
  s.events.push({ sfx: "slash" });
}

const katana: Fire = (s, w, g) => {
  const ws = w.ws;
  if (w.evolved) {
    const r = 54 * ws.area;
    near(g, s.p.x, s.p.y, r, (e) => hurt(s, e, ws.dmg, hitOf(w, s.p)));
    breakShots(s, s.p.x, s.p.y, r);
    s.fx.push(fx("slash-circle", s.p.x, s.p.y, 0.28, false, (r * 2) / 32), fx("slash-circle", s.p.x, s.p.y, 0.28, true, (r * 1.6) / 32, Math.PI));
    s.events.push({ sfx: "slash" });
    return;
  }
  cut(s, w, g, s.p.side);
  if (w.level >= 2) w.later.push({ at: s.t + 0.15, side: -s.p.side });
};

/** A naginata thrust from you at angle a: a line that hits everything along it. */
function thrust(s: State, w: Weapon, g: Grid, a: number) {
  const ws = w.ws, len = 74 * ws.area, cos = Math.cos(a), sin = Math.sin(a);
  const hit = new Set<number>();
  for (let d = 8; d <= len; d += 8) breakShots(s, s.p.x + cos * d, s.p.y + sin * d, 7);
  for (let d = 8; d <= len; d += 8)
    near(g, s.p.x + cos * d, s.p.y + sin * d, 7, (e) => {
      if (hit.has(e.id)) return;
      hit.add(e.id);
      hurt(s, e, ws.dmg, { weapon: w.kind, crit: ws.crit, push: ws.kb, from: s.p });
    });
  const f = fx("thrust", s.p.x, s.p.y, 0.24, false, 1, a);
  f.len = len;
  s.fx.push(f);
  if (w.evolved)
    s.shots.push(shot(w, "wave", s.p.x + cos * len, s.p.y + sin * len, a, 220, 9 * ws.area, { pierce: 999, life: 1.2, dmg: ws.dmg * 0.6, kb: 2 }));
}

const naginata: Fire = (s, w, g) => {
  const a = Math.atan2(s.p.face.y, s.p.face.x);
  if (w.evolved) for (let i = 0; i < 4; i++) thrust(s, w, g, a + (i * Math.PI) / 2);
  else {
    thrust(s, w, g, a);
    if (w.level >= 4) w.later.push({ at: s.t + 0.12, a: a + Math.PI });
  }
  s.events.push({ sfx: "thrust" });
};

/** Where each sickle is now, for the fight and for drawing. */
export function sickles(s: State, w: Weapon): { x: number; y: number; a: number }[] {
  const ws = w.ws, n = ws.amount, out: { x: number; y: number; a: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = w.angle + (i / n) * Math.PI * 2;
    const r = (w.evolved ? 58 + 32 * Math.sin(w.angle * 0.7 + i) : 46) * ws.area;
    out.push({ x: s.p.x + Math.cos(a) * r, y: s.p.y + Math.sin(a) * r, a });
  }
  return out;
}

const kusarigama: Fire = (s, w, g, dt) => {
  const ws = w.ws;
  w.angle += ws.speed * dt;
  for (const k of sickles(s, w)) breakShots(s, k.x, k.y, 9 * ws.area);
  for (const k of sickles(s, w))
    near(g, k.x, k.y, 9 * ws.area, (e) => {
      if ((w.touched.get(e.id) ?? 0) > s.t) return;
      w.touched.set(e.id, s.t + ws.cd);
      if (w.evolved && !e.boss && e.hp < e.max * 0.1) {
        hurt(s, e, e.hp + 1, { weapon: w.kind });
        s.fx.push(fx("claw", e.x, e.y, 0.25));
        return;
      }
      hurt(s, e, ws.dmg, hitOf(w, s.p));
    });
  if (s.steps % 40 === 0) s.events.push({ sfx: "chain" });
};

const yumi: Fire = (s, w) => {
  const ws = w.ws, used = new Set<number>();
  for (let i = 0; i < ws.amount; i++) {
    const t = toughest(s, 260, used);
    if (!t) break;
    used.add(t.id);
    const a = Math.atan2(t.y - s.p.y, t.x - s.p.x);
    s.shots.push(shot(w, "arrow", s.p.x, s.p.y, a, ws.speed, 4, { split: w.evolved ? 2 : 0 }));
  }
  if (used.size) s.events.push({ sfx: "bow" });
};

const fire: Fire = (s, w) => {
  const ws = w.ws, r = 20 * ws.area;
  for (let i = 0; i < ws.amount; i++) {
    const t = randomNear(s, 160);
    const tx = t ? t.x : s.p.x + range(s.rng, -70, 70), ty = t ? t.y : s.p.y + range(s.rng, -70, 70);
    const d = Math.hypot(tx - s.p.x, ty - s.p.y) || 1;
    const sh = shot(w, "fireball", s.p.x, s.p.y, Math.atan2(ty - s.p.y, tx - s.p.x), ws.speed, 5, { pierce: 0, life: d / ws.speed });
    sh.burst = { x: tx, y: ty, r, dmg: ws.dmg, burn: w.evolved ? 3 * (1 + s.st.duration) : 0 };
    s.shots.push(sh);
  }
  s.events.push({ sfx: "fire" });
};

function strike(s: State, w: Weapon, g: Grid, x: number, y: number, dmg: number) {
  near(g, x, y, 14 * w.ws.area, (e) => hurt(s, e, dmg, { weapon: w.kind, crit: w.ws.crit }));
  breakShots(s, x, y, 14 * w.ws.area);
  s.fx.push(fx("thunder", x, y, 0.35, next(s.rng) < 0.5));
}

const thunder: Fire = (s, w, g) => {
  const ws = w.ws, struck = new Set<number>();
  for (let i = 0; i < ws.amount; i++) {
    const t = randomNear(s, 190, struck);
    if (!t) break;
    struck.add(t.id);
    strike(s, w, g, t.x, t.y, ws.dmg);
    if (!w.evolved) continue;
    const chain = s.enemies.filter((e) => targetable(e) && !struck.has(e.id) && Math.hypot(e.x - t.x, e.y - t.y) < 75).slice(0, 3);
    for (const o of chain) {
      struck.add(o.id);
      strike(s, w, g, o.x, o.y, ws.dmg * 0.7);
    }
  }
  if (struck.size) s.events.push({ sfx: "thunder" }, { shake: 1 });
};

/** Where each spirit is now, for the fight and for drawing. */
export function spirits(s: State, w: Weapon): { x: number; y: number; ring: number }[] {
  if (!w.evolved && w.on <= 0) return [];
  const ws = w.ws, n = ws.amount, out: { x: number; y: number; ring: number }[] = [];
  for (let ring = 0; ring < (w.evolved ? 2 : 1); ring++) {
    const r = (30 + 22 * ring) * ws.area, dirn = ring ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const a = dirn * w.angle + (i / n) * Math.PI * 2 + ring * 0.4;
      out.push({ x: s.p.x + Math.cos(a) * r, y: s.p.y + Math.sin(a) * r, ring });
    }
  }
  return out;
}

const spirit: Fire = (s, w, g, dt) => {
  const ws = w.ws;
  w.angle += ws.speed * dt;
  if (!w.evolved) {
    if (w.on > 0) w.on -= dt;
    else if ((w.cd -= dt) <= 0) {
      w.on = ws.dur;
      w.cd = ws.cd;
      s.events.push({ sfx: "spirit" });
    }
  }
  for (const sp of spirits(s, w)) breakShots(s, sp.x, sp.y, 7);
  for (const sp of spirits(s, w))
    near(g, sp.x, sp.y, 7, (e) => {
      if ((w.touched.get(e.id) ?? 0) > s.t) return;
      w.touched.set(e.id, s.t + 0.4);
      hurt(s, e, ws.dmg, hitOf(w, s.p));
      if (w.evolved && w.drops++ % 25 === 0) heal(s, 2);
    });
};

const bell: Fire = (s, w, g) => {
  const ws = w.ws, r = 28 * ws.area;
  near(g, s.p.x, s.p.y, r, (e) => hurt(s, e, ws.dmg, hitOf(w, s.p)));
  breakShots(s, s.p.x, s.p.y, r);
  if (w.drops++ % 2 === 0) s.fx.push(fx("circle", s.p.x, s.p.y, 0.5, false, (r * 2) / 32));
  if (!w.evolved || w.drops % 6 !== 0) return;
  // The gong: every sixth chime a wave rolls out, stunning, hitting harder the more health you can hold.
  const R = 130 * ws.area, dmg = ws.dmg * 4 + s.st.maxHp * 0.25;
  near(g, s.p.x, s.p.y, R, (e) => {
    hurt(s, e, dmg, hitOf(w, s.p, 3));
    status(e, "stun", 1);
  });
  breakShots(s, s.p.x, s.p.y, R);
  s.fx.push(fx("circle", s.p.x, s.p.y, 0.6, false, (R * 2) / 32));
  s.events.push({ sfx: "gong" }, { shake: 2 });
};

function spikeRing(s: State, w: Weapon, g: Grid, ring: number) {
  const ws = w.ws, n = ws.amount + ring * 4, rad = (30 + 26 * ring) * ws.area, hit = new Set<number>();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + ring * 0.3, x = s.p.x + Math.cos(a) * rad, y = s.p.y + Math.sin(a) * rad;
    breakShots(s, x, y, 12 * ws.area);
    near(g, x, y, 12 * ws.area, (e) => {
      if (hit.has(e.id)) return;
      hit.add(e.id);
      hurt(s, e, ws.dmg, hitOf(w, s.p));
      if (w.evolved) status(e, "stun", 0.6);
    });
    s.fx.push(fx("rock-spike", x, y, 0.45, i % 2 === 0, 0.6 * Math.sqrt(ws.area)));
  }
  s.events.push({ sfx: "rock" });
}

const rock: Fire = (s, w, g) => {
  spikeRing(s, w, g, 0);
  if (w.evolved) {
    w.later.push({ at: s.t + 0.18, ring: 1 }, { at: s.t + 0.36, ring: 2 });
    s.events.push({ shake: 3 });
  }
};

const ice: Fire = (s, w) => {
  const ws = w.ws, t = nearest(s, 1)[0];
  const a0 = t ? Math.atan2(t.y - s.p.y, t.x - s.p.x) : Math.atan2(s.p.face.y, s.p.face.x);
  const n = ws.amount, spread = Math.min(1.2, 0.18 * (n - 1));
  for (let i = 0; i < n; i++) {
    const a = a0 + (n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0);
    s.shots.push(shot(w, "ice", s.p.x, s.p.y, a, ws.speed, 4, { slow: 2 * (1 + s.st.duration), freeze: ws.effect }));
  }
  s.events.push({ sfx: "ice" });
  if (w.evolved && w.drops++ % 5 === 4) {
    // Blizzard: everything on screen freezes.
    for (const e of s.enemies) if (targetable(e) && Math.abs(e.x - s.p.x) < 240 && Math.abs(e.y - s.p.y) < 140) {
      status(e, "freeze", 2 * (1 + s.st.duration));
      if (next(s.rng) < 0.15) s.fx.push(fx("ice-flake", e.x, e.y, 0.6));
    }
    s.events.push({ sfx: "blizzard" }, { banner: "Blizzard", tone: "info" });
  }
};

const geyser: Fire = (s, w, g) => {
  const ws = w.ws, used: { x: number; y: number }[] = [];
  for (let i = 0; i < ws.amount; i++) {
    const c = crowd(s, 180, used);
    if (!c) break;
    used.push(c);
    const r = 18 * ws.area;
    breakShots(s, c.x, c.y, r);
    near(g, c.x, c.y, r, (e) => {
      hurt(s, e, ws.dmg, { weapon: w.kind, crit: ws.crit });
      status(e, "stun", ws.effect * (1 + s.st.duration));
    });
    s.fx.push(fx("pillar", c.x, c.y, 0.5, false, Math.sqrt(ws.area)));
    if (w.evolved) s.zones.push(zone(w, "whirl", c.x, c.y, r * 1.8, ws.dmg * 0.25, 3 * (1 + s.st.duration), 0.3));
  }
  if (used.length) s.events.push({ sfx: "geyser" });
};

const caltrop: Fire = (s, w) => {
  const ws = w.ws, r = 9 * ws.area;
  w.drops++;
  if (w.evolved) {
    // Festival crackers: a string of them popping one after another behind you.
    const bx = -s.p.face.x, by = -s.p.face.y;
    for (let i = 0; i < 5; i++)
      s.zones.push(zone(w, "cracker", s.p.x + bx * (8 + i * 12), s.p.y + by * (8 + i * 12), 18 * ws.area, ws.dmg * 1.8, 2, 0, { fuse: 0.5 + i * 0.12 }));
    s.events.push({ sfx: "fuse" });
    return;
  }
  if (w.level >= 5 && w.drops % 3 === 0) s.zones.push(zone(w, "bomb", s.p.x, s.p.y, r, ws.dmg * 4, 10, 0));
  else s.zones.push(zone(w, "caltrop", s.p.x, s.p.y, r, ws.dmg, ws.dur, 0.5));
};

const fan: Fire = (s, w) => {
  const ws = w.ws, a = Math.atan2(s.p.face.y, s.p.face.x);
  const gust = (ang: number) => s.shots.push(shot(w, "gust", s.p.x, s.p.y, ang, ws.speed, 10 * ws.area, { grow: 1.4 }));
  gust(a);
  if (w.level >= 4) gust(a + Math.PI);
  s.events.push({ sfx: "gust" });
  if (w.evolved && !s.zones.some((z) => z.kind === "tornado"))
    s.zones.push(zone(w, "tornado", s.p.x + 40, s.p.y, 24 * ws.area, ws.dmg * 0.5, 1e9, 0.25));
};

const vines: Fire = (s, w) => {
  const ws = w.ws;
  if (w.evolved) {
    // Sacred grove: bamboo rings spreading out from you.
    for (let ring = 0; ring < 3; ring++) w.later.push({ at: s.t + ring * 0.2, ring: ring + 1 });
    s.events.push({ sfx: "vines" });
    return;
  }
  const segs = 5 + 2 * (w.level >= 2 ? 1 : 0) + 2 * (w.level >= 8 ? 1 : 0);
  for (let i = 0; i < ws.amount; i++) {
    const t = randomNear(s, 160);
    const a = t ? Math.atan2(t.y - s.p.y, t.x - s.p.x) : range(s.rng, 0, Math.PI * 2);
    for (let k = 0; k < segs; k++) w.later.push({ at: s.t + k * 0.06, x: s.p.x + Math.cos(a) * (14 + k * 13), y: s.p.y + Math.sin(a) * (14 + k * 13) });
  }
  s.events.push({ sfx: "vines" });
};

function vineAt(s: State, w: Weapon, g: Grid, x: number, y: number) {
  const ws = w.ws;
  breakShots(s, x, y, 10 * ws.area);
  near(g, x, y, 10 * ws.area, (e) => {
    if ((w.touched.get(e.id) ?? 0) > s.t) return;
    w.touched.set(e.id, s.t + 0.3);
    hurt(s, e, ws.dmg, { weapon: w.kind, crit: ws.crit });
    status(e, "root", ws.effect * (1 + s.st.duration));
  });
  s.fx.push(fx("plant", x, y - 6, 0.5, next(s.rng) < 0.5, Math.sqrt(ws.area)));
}

const FIRE: Record<WeaponKind, Fire> = { shuriken, kunai, katana, naginata, kusarigama, yumi, fire, thunder, spirit, bell, rock, ice, geyser, caltrop, fan, vines };
/** Weapons that run every step rather than on a cooldown. */
const ALWAYS = new Set<WeaponKind>(["kusarigama", "spirit"]);

export function fireAll(s: State, g: Grid, dt: number) {
  for (const w of s.weapons) {
    for (const l of w.later.filter((x) => x.at <= s.t)) {
      if (l.side) cut(s, w, g, l.side);
      else if (l.a !== undefined) thrust(s, w, g, l.a);
      else if (l.x !== undefined) vineAt(s, w, g, l.x, l.y!);
      else if (w.kind === "vines") for (let i = 0; i < 10 + 4 * l.ring!; i++) {
        const a = (i / (10 + 4 * l.ring!)) * Math.PI * 2 + l.ring!, r = 26 * l.ring! * w.ws.area;
        vineAt(s, w, g, s.p.x + Math.cos(a) * r, s.p.y + Math.sin(a) * r);
      }
      else spikeRing(s, w, g, l.ring ?? 0);
    }
    w.later = w.later.filter((x) => x.at > s.t);
    if (ALWAYS.has(w.kind)) { FIRE[w.kind](s, w, g, dt); continue; }
    w.cd -= dt;
    if (w.cd > 0) continue;
    w.cd = w.ws.cd;
    FIRE[w.kind](s, w, g, dt);
  }
  if (s.steps % 600 === 0) for (const w of s.weapons) for (const [id, t] of w.touched) if (t < s.t) w.touched.delete(id);
}

// ---- shots and zones -------------------------------------------------------------------------------------------------

export function stepShots(s: State, g: Grid, dt: number) {
  for (const sh of s.shots) {
    sh.life -= dt;
    sh.age += dt;
    sh.spin += dt;
    if (sh.grow) sh.r += sh.grow * dt * 10;
    if (sh.homing) {
      let best: Enemy | undefined, bd = 170;
      for (const e of s.enemies) {
        if (!targetable(e) || sh.hit.has(e.id)) continue;
        const d = Math.hypot(e.x - sh.x, e.y - sh.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) steer(sh, Math.atan2(best.y - sh.y, best.x - sh.x), 7 * dt);
    }
    if (sh.back && sh.life < 0.5) steer(sh, Math.atan2(s.p.y - sh.y, s.p.x - sh.x), 12 * dt);
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;
    if (sh.burst) {
      if (sh.life <= 0) burst(s, g, sh);
      continue;
    }
    near(g, sh.x, sh.y, sh.r, (e) => {
      if (sh.pierce <= 0 || sh.hit.has(e.id)) return;
      sh.hit.add(e.id);
      if (!e.prop) sh.pierce--;
      hurt(s, e, sh.dmg, { weapon: sh.weapon, crit: sh.crit, push: sh.kb, from: { x: sh.x - sh.vx * 0.05, y: sh.y - sh.vy * 0.05 } });
      if (sh.slow) status(e, "slow", sh.slow, 0.5);
      if (sh.freeze && next(s.rng) < sh.freeze) { status(e, "freeze", 1.2); s.fx.push(fx("ice-flake", e.x, e.y, 0.5)); }
      if (sh.split) {
        const a = Math.atan2(sh.vy, sh.vx), v = Math.hypot(sh.vx, sh.vy);
        for (const da of [-0.35, 0.35]) s.shots.push({ ...sh, vx: Math.cos(a + da) * v, vy: Math.sin(a + da) * v, split: 0, hit: new Set(sh.hit), life: 0.6 });
        sh.split = 0;
      }
    });
    if (sh.pierce <= 0) sh.life = 0;
    breakShots(s, sh.x, sh.y, sh.r + 2);
  }
  s.shots = s.shots.filter((sh) => sh.life > 0);
}

function steer(sh: Shot, a: number, max: number) {
  const cur = Math.atan2(sh.vy, sh.vx), v = Math.hypot(sh.vx, sh.vy);
  const d = Math.atan2(Math.sin(a - cur), Math.cos(a - cur));
  const n = cur + Math.max(-max, Math.min(max, d));
  sh.vx = Math.cos(n) * v;
  sh.vy = Math.sin(n) * v;
}

function burst(s: State, g: Grid, sh: Shot) {
  const b = sh.burst!;
  near(g, b.x, b.y, b.r, (e) => hurt(s, e, b.dmg, { weapon: sh.weapon, crit: sh.crit, push: sh.kb, from: b }));
  breakShots(s, b.x, b.y, b.r);
  s.fx.push(fx("explosion", b.x, b.y, 0.45, false, (b.r * 2) / 40));
  if (b.burn) s.zones.push(zone(s.weapons.find((w) => w.kind === sh.weapon)!, "burn", b.x, b.y, b.r, b.dmg * 0.3, b.burn, 0.4));
  s.events.push({ sfx: "explosion" });
}

export function stepZones(s: State, g: Grid, dt: number) {
  for (const z of s.zones) {
    z.life -= dt;
    z.age += dt;
    const hitAll = (dmg: number, r: number, push = 0) =>
      near(g, z.x, z.y, r, (e) => hurt(s, e, dmg, { weapon: z.weapon, push, from: z }));
    switch (z.kind) {
      case "dynamite":
      case "cracker":
        if ((z.fuse -= dt) <= 0) {
          hitAll(z.dmg, z.r, 2);
          s.fx.push(fx("explosion", z.x, z.y, 0.4, false, (z.r * 2) / 40));
          s.events.push({ sfx: z.kind === "cracker" ? "pop" : "explosion" });
          z.life = 0;
        }
        continue;
      case "bomb": {
        let boom = false;
        near(g, z.x, z.y, z.r, (e) => { if (!e.prop) boom = true; });
        if (boom) {
          hitAll(z.dmg, 28, 2);
          s.fx.push(fx("explosion", z.x, z.y, 0.45, false, 1.4));
          s.events.push({ sfx: "explosion" });
          z.life = 0;
        }
        continue;
      }
      case "whirl":
      case "tornado": {
        if (z.kind === "tornado") {
          // Wander around you: a lazy orbit with a wobble.
          const a = z.age * 0.9, tx = s.p.x + Math.cos(a) * 55 + Math.sin(z.age * 2.3) * 12, ty = s.p.y + Math.sin(a) * 40;
          z.x += (tx - z.x) * Math.min(1, dt * 2);
          z.y += (ty - z.y) * Math.min(1, dt * 2);
          for (const f of s.foeShots) if (Math.hypot(f.x - z.x, f.y - z.y) < z.r * 1.2) f.life = 0;
        }
        near(g, z.x, z.y, z.r * 1.6, (e) => {
          if (e.boss) return;
          const dx = z.x - e.x, dy = z.y - e.y, d = Math.hypot(dx, dy) || 1;
          e.x += (dx / d) * 40 * dt * (1 - e.steady);
          e.y += (dy / d) * 40 * dt * (1 - e.steady);
        });
        break;
      }
    }
    near(g, z.x, z.y, z.r, (e) => {
      if ((z.next.get(e.id) ?? 0) > s.t) return;
      z.next.set(e.id, s.t + z.tick);
      hurt(s, e, z.dmg, { weapon: z.weapon });
      if (z.kind === "burn") { e.st.burn = 1; e.st.burnDps = z.dmg; }
    });
  }
  s.zones = s.zones.filter((z) => z.life > 0);
}

/** Kaze's trait: the dash leaves a puff of smoke that hurts. */
export const smokePuff = (s: State) => s.zones.push(zone("hero", "smoke", s.p.x, s.p.y, 16, 6 * (1 + s.st.might), 0.9, 0.3));
