// The crowd moving: each behaviour (content/enemies.ts `Gait`), status
// effects, elite traits, enemy shots, telegraphed hazards, touching you, and
// bodies pushing apart. Bosses move in bosses.ts.
import { ENEMIES } from "../content/enemies.ts";
import { next, range } from "../rng.ts";
import { HERO_R, fx, hurtPlayer, spawnAt, type Enemy, type FoeShot, type Grid, type State } from "./core.ts";

const TOO_FAR = 520, AROUND = 340;

export function stepEnemies(s: State, g: Grid, dt: number) {
  const p = s.p;
  const moon = s.moon > 0 ? 1.3 : 1;
  for (const e of s.enemies) {
    if (e.dead || e.boss || e.prop) continue;
    e.age += dt;
    e.flash = Math.max(0, e.flash - dt);
    e.walk += dt;
    const st = e.st;
    for (const k of ["slow", "freeze", "stun", "root", "burn"] as const) st[k] = Math.max(0, st[k] - dt);
    if (st.slow <= 0) st.slowBy = 0;
    if (e.path) {
      e.x += e.path.vx * dt;
      e.y += e.path.vy * dt;
      e.dir = Math.abs(e.path.vx) > Math.abs(e.path.vy) ? (e.path.vx < 0 ? 2 : 3) : e.path.vy < 0 ? 1 : 0;
      if ((e.path.life -= dt) <= 0) {
        e.dead = true;
        const gr = e.path.group !== undefined ? s.groups.get(e.path.group) : undefined;
        if (gr) gr.escaped = true;
        continue;
      }
      touch(s, e);
      continue;
    }
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (d > TOO_FAR && e.kind !== "goldtanuki") {
      // Left far behind: it comes round again ahead of you, as in Vampire Survivors.
      const a = Math.atan2(p.face.y, p.face.x) + range(s.rng, -1.1, 1.1);
      e.x = p.x + Math.cos(a) * AROUND;
      e.y = p.y + Math.sin(a) * AROUND;
      continue;
    }
    const held = st.freeze > 0 || st.stun > 0 || s.frozen > 0;
    let speed = held || st.root > 0 ? 0 : e.speed * moon * (1 - st.slowBy);
    let ux = dx / d, uy = dy / d;
    e.clock -= dt;
    switch (e.gait) {
      case "weave": {
        const w = Math.sin(e.age * 3 + e.id) * 0.6;
        [ux, uy] = [ux - uy * w, uy + ux * w];
        break;
      }
      case "lunge":
        if (e.wind > 0) {
          e.wind -= dt;
          speed = 0;
          if (e.wind <= 0) e.lunge = 0.5;
        } else if (e.lunge > 0) {
          e.lunge -= dt;
          speed *= 2.3;
        } else if (e.clock <= 0 && d < 150 && !held) {
          e.clock = range(s.rng, 2.4, 4);
          e.wind = 0.45;
        }
        break;
      case "shoot": {
        const sh = ENEMIES[e.kind].shot!;
        if (d < sh.range * 0.75) [ux, uy] = [-uy, ux]; // hold the distance, circling
        if (e.clock <= 0 && d < sh.range && !held) {
          e.clock = sh.every * range(s.rng, 0.8, 1.2);
          fireAt(s, e, sh.kind, sh.speed, sh.dmg);
        }
        break;
      }
      case "burrow":
        if (e.wind > 0) { e.wind -= dt; speed = 0; }
        else if (e.under && d < 34) {
          // Surfacing takes a moment (dust, then the mole), so you can step away.
          e.under = false;
          e.wind = 0.4;
          e.clock = 3;
          s.fx.push(fx("rock", e.x, e.y, 0.4));
          s.events.push({ sfx: "burrow" });
        } else if (!e.under && e.clock <= 0) {
          e.under = true;
          s.fx.push(fx("rock", e.x, e.y, 0.4));
        }
        if (e.under) speed *= 1.3;
        break;
      case "blink":
        if (e.fade > 0) {
          e.fade -= dt;
          speed = 0;
          if (e.fade <= 0.2 && e.hidden) {
            const a = next(s.rng) * Math.PI * 2, r = range(s.rng, 40, 70);
            e.x = p.x + Math.cos(a) * r;
            e.y = p.y + Math.sin(a) * r;
            e.hidden = false;
          }
        } else if (e.clock <= 0 && d > 60 && !held) {
          e.clock = range(s.rng, 3, 5);
          e.fade = 0.45;
          e.hidden = true;
        }
        break;
      case "flee":
        [ux, uy] = [-ux + Math.sin(e.age * 2) * 0.4, -uy + Math.cos(e.age * 2) * 0.4];
        if (e.age > 15) {
          e.dead = true;
          s.events.push({ banner: "The golden tanuki got away", tone: "info" });
        }
        break;
    }
    if (e.elite?.traits.includes("burning") && (e.elite.trail -= dt) <= 0) {
      e.elite.trail = 0.5;
      s.fx.push(fx("flame", e.x, e.y - 4, 1.6, false, 0.6));
      s.foeShots.push({ kind: "flame", x: e.x, y: e.y, vx: 0, vy: 0, r: 5, dmg: e.dmg * 0.4, life: 1.6, spin: 0 });
    }
    e.x += ux * speed * dt + e.kx * dt;
    e.y += uy * speed * dt + e.ky * dt;
    e.kx *= 0.85;
    e.ky *= 0.85;
    if (speed > 0) e.dir = Math.abs(ux) > Math.abs(uy) ? (ux < 0 ? 2 : 3) : uy < 0 ? 1 : 0;
    touch(s, e);
  }
  separate(g);
}

function touch(s: State, e: Enemy) {
  if (e.under || e.hidden || e.dmg <= 0 || (e.gait === "burrow" && e.wind > 0)) return;
  if (Math.hypot(s.p.x - e.x, s.p.y - e.y) < e.r + HERO_R) hurtPlayer(s, e.dmg, e.kind);
}

/** Bodies push apart, so a crowd is a crowd rather than one stack. */
function separate(g: Grid) {
  for (const b of g.values())
    for (let i = 0; i < b.length; i++)
      for (let j = i + 1; j < b.length; j++) {
        const a = b[i], c = b[j];
        if (a.prop || c.prop || a.path || c.path || a.flies !== c.flies) continue;
        const dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy), min = a.r + c.r;
        if (d > 0 && d < min) {
          const push = ((min - d) / d) * 0.25, wa = a.boss ? 0 : 1, wc = c.boss ? 0 : 1;
          a.x -= dx * push * wa; a.y -= dy * push * wa;
          c.x += dx * push * wc; c.y += dy * push * wc;
        }
      }
}

export function fireAt(s: State, e: { x: number; y: number }, kind: FoeShot["kind"], speed: number, dmg: number, spreadA = 0) {
  const a = Math.atan2(s.p.y - e.y, s.p.x - e.x) + spreadA;
  s.foeShots.push({ kind, x: e.x, y: e.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: kind === "club" ? 10 : 4, dmg, life: kind === "club" ? 3 : 2.8, spin: 0 });
  s.events.push({ sfx: kind === "flame" ? "fire" : kind === "water" ? "splash" : "shoot" });
}

export function stepFoeShots(s: State, dt: number) {
  const p = s.p;
  for (const f of s.foeShots) {
    f.life -= dt;
    f.spin += dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (f.kind === "club" && f.life < 1.5) {
      // The Oni's club comes back to its hand.
      const oni = s.enemies.find((e) => e.boss === "oni" && !e.dead);
      if (oni) {
        const a = Math.atan2(oni.y - f.y, oni.x - f.x), v = Math.hypot(f.vx, f.vy);
        f.vx += (Math.cos(a) * v - f.vx) * dt * 3;
        f.vy += (Math.sin(a) * v - f.vy) * dt * 3;
      }
    }
    if (Math.hypot(p.x - f.x, p.y - f.y) < f.r + HERO_R && p.dash <= 0 && p.invuln <= 0) {
      hurtPlayer(s, f.dmg, f.kind);
      if (f.kind === "ink") p.inked = 2;
      if (f.kind !== "club" && f.kind !== "flame") f.life = 0;
    }
  }
  s.foeShots = s.foeShots.filter((f) => f.life > 0);
}

/** Telegraphs: a ring or line drawn on the ground that strikes when its time comes. */
export function stepHazards(s: State, dt: number) {
  const p = s.p;
  for (const h of s.hazards) {
    h.t += dt;
    if (h.done || h.t < h.delay) continue;
    h.done = true;
    let hit = false;
    if (h.kind === "ring" || h.kind === "gust") hit = Math.hypot(p.x - h.x, p.y - h.y) < h.r + HERO_R;
    else if (h.kind === "line") {
      const lx = h.x2 - h.x, ly = h.y2 - h.y, l2 = lx * lx + ly * ly || 1;
      const k = Math.max(0, Math.min(1, ((p.x - h.x) * lx + (p.y - h.y) * ly) / l2));
      hit = Math.hypot(p.x - (h.x + lx * k), p.y - (h.y + ly * k)) < h.r + HERO_R;
    }
    if (h.kind === "dust" && h.spawn) {
      spawnAt(s, h.spawn, h.x, h.y, 1 + 0.2 * Math.floor(s.t / 60));
      s.fx.push(fx("rock", h.x, h.y, 0.4));
      continue;
    }
    if (h.dmg > 0) {
      s.fx.push(fx(h.from === "onibi" ? "flame" : h.kind === "gust" ? "smoke-circle" : "explosion", h.x, h.y, 0.4, false, (h.r * 2) / 40));
      s.events.push({ sfx: h.from === "onibi" ? "fire" : "slam" }, { shake: h.r > 30 ? 3 : 1 });
    }
    if (hit) {
      hurtPlayer(s, h.dmg, h.from ?? h.kind);
      if (h.push) {
        const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy) || 1;
        p.x += (dx / d) * h.push;
        p.y += (dy / d) * h.push;
      }
    }
  }
  s.hazards = s.hazards.filter((h) => h.t < h.delay + 0.35);
}
