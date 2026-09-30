// Who arrives, and when: the minute's crowd (content/stage.ts CROWD and
// `pressure`), an elite at :30, the scripted events and bosses (EVENTS), the
// golden tanuki now and then, and the jars and lanterns along the road.
import { BOSSES } from "../content/bosses.ts";
import type { EnemyKind } from "../content/enemies.ts";
import { omen } from "../content/meta.ts";
import { ACTS, CROWD, ELITE_TRAITS, EVENTS, MAX_ENEMIES, actAt, pressure, type EliteTrait } from "../content/stage.ts";
import { chance, next, pick, range, rng } from "../rng.ts";
import { hazard, spawnAt, spawnBoss, type State } from "./core.ts";

const NEAR = 330, FAR = 380;

export function spawn(s: State, dt: number) {
  const minute = Math.min(14, Math.floor(s.t / 60));
  const pr = pressure(minute), o = omen(s.load.omen), curse = 1 + s.st.curse;
  const act = actAt(s.t);
  if (act !== s.act) {
    s.act = act;
    s.events.push({ banner: ACTS[act].name, sub: ACTS[act].sub, tone: "act" }, { music: (["act1", "act2", "act3"] as const)[act] });
  }
  const alive = s.enemies.reduce((n, e) => n + (e.prop || e.path || e.dead ? 0 : 1), 0);
  const bossUp = s.enemies.some((e) => e.boss && !e.dead);
  const min = pr.min * o.count * curse * (s.drums ? 1.5 : 1) * (bossUp ? 0.6 : 1);
  let n = Math.max(0, Math.round(min) - alive);
  if ((s.trickle -= dt) <= 0) {
    s.trickle = pr.every;
    n += Math.round(pr.batch * o.count * curse);
  }
  n = Math.min(n, MAX_ENEMIES - s.enemies.length, 12);
  for (let i = 0; i < n; i++) {
    const { x, y } = ring(s);
    spawnAt(s, kindAt(s, minute), x, y, pr.hp);
  }
  if (s.t >= 30 + 60 * s.elites) {
    s.elites++;
    const { x, y } = ring(s);
    spawnAt(s, kindAt(s, minute), x, y, pr.hp, traits(s));
  }
  while (s.eventIdx < EVENTS.length && s.t >= EVENTS[s.eventIdx].at) event(s, s.eventIdx++, pr.hp);
  // The golden tanuki: a small chance each second after the first minute, at most twice a night.
  if (s.steps % 60 === 0 && s.t > 60 && (s.tally.kinds.goldtanuki ?? 0) + s.enemies.filter((e) => e.kind === "goldtanuki").length < 2 && chance(s.rng, 0.004)) {
    const a = next(s.rng) * Math.PI * 2;
    spawnAt(s, "goldtanuki", s.p.x + Math.cos(a) * 150, s.p.y + Math.sin(a) * 150, 1 + minute * 0.3);
    s.events.push({ banner: "A golden tanuki!", sub: "Catch it before it gets away", tone: "good" }, { sfx: "sparkle" });
  }
  s.moon = Math.max(0, s.moon - dt);
  s.frozen = Math.max(0, s.frozen - dt);
  props(s);
}

function ring(s: State) {
  const a = next(s.rng) * Math.PI * 2, d = range(s.rng, NEAR, FAR);
  return { x: s.p.x + Math.cos(a) * d, y: s.p.y + Math.sin(a) * d };
}

function kindAt(s: State, m: number): EnemyKind {
  const mix = CROWD[m];
  let r = next(s.rng) * mix.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of mix) if ((r -= w) <= 0) return k;
  return mix[0][0];
}

/** One trait for an elite in Acts I and II, two in Act III. */
function traits(s: State): EliteTrait[] {
  const all = Object.keys(ELITE_TRAITS) as EliteTrait[], out: EliteTrait[] = [pick(s.rng, all)];
  if (actAt(s.t) === 2) {
    const second = pick(s.rng, all.filter((t) => t !== out[0]));
    out.push(second);
  }
  return out;
}

function event(s: State, i: number, hp: number) {
  const ev = EVENTS[i], p = s.p;
  if (ev.kind === "boss") {
    const d = BOSSES[ev.boss], a = next(s.rng) * Math.PI * 2;
    spawnBoss(s, ev.boss, p.x + Math.cos(a) * 200, p.y + Math.sin(a) * 200);
    s.events.push({ boss: ev.boss }, { banner: d.name, sub: d.title, tone: "boss" }, { music: ev.boss === "oni" ? "oni" : "boss" }, { sfx: "alert" });
    return;
  }
  if (ev.kind === "bloodmoon") {
    s.moon = ev.dur;
    s.events.push({ banner: ev.text, sub: "Everything is faster; experience is doubled", tone: "event" }, { sfx: "alert" });
    return;
  }
  if (ev.kind === "drums") {
    s.drums = true;
    s.events.push({ banner: ev.text, sub: "The parade gathers for its master", tone: "event" }, { sfx: "drum" }, { shake: 3 });
    return;
  }
  s.events.push({ banner: ev.text, tone: "event" }, { sfx: "alert" });
  const a = next(s.rng) * Math.PI * 2, cos = Math.cos(a), sin = Math.sin(a);
  switch (ev.kind) {
    case "swarm":
    case "stampede": {
      // From one side across to the other, a wide front for a stampede, a tight stream for a swarm.
      const speed = ev.kind === "swarm" ? 95 : 115, width = ev.kind === "swarm" ? 50 : 260;
      for (let k = 0; k < ev.count; k++) {
        const lat = range(s.rng, -width / 2, width / 2), back = (k / ev.count) * (ev.kind === "swarm" ? 260 : 120);
        const e = spawnAt(s, ev.enemy, p.x - cos * (FAR + back) - sin * lat, p.y - sin * (FAR + back) + cos * lat, hp);
        e.path = { vx: cos * speed, vy: sin * speed, life: (2 * FAR + back + 60) / speed };
      }
      return;
    }
    case "procession": {
      // A column marching past you, not at you; break every one before it leaves for a chest.
      const group = s.nextId++, off = 70;
      s.groups.set(group, { left: ev.count, escaped: false, reward: ev.reward, x: 0, y: 0 });
      for (let k = 0; k < ev.count; k++) {
        const back = k * 20;
        const e = spawnAt(s, ev.enemy, p.x - cos * (FAR + back) - sin * off, p.y - sin * (FAR + back) + cos * off, hp * 1.5);
        e.path = { vx: cos * 30, vy: sin * 30, life: (2 * FAR + back + 40) / 30, group };
      }
      return;
    }
    case "ring":
      for (let k = 0; k < ev.count; k++) {
        const b = (k / ev.count) * Math.PI * 2;
        spawnAt(s, ev.enemy, p.x + Math.cos(b) * 170, p.y + Math.sin(b) * 170, hp * 0.7);
      }
      return;
    case "rise":
      for (let k = 0; k < ev.count; k++) {
        const b = next(s.rng) * Math.PI * 2, d = range(s.rng, 45, 120);
        s.hazards.push(hazard("dust", p.x + Math.cos(b) * d, p.y + Math.sin(b) * d, 8, 1 + k * 0.08, 0, { spawn: ev.enemy }));
      }
      return;
    case "surge":
      for (let k = 0; k < ev.count; k++) {
        const b = next(s.rng) * Math.PI * 2, d = range(s.rng, 120, 200);
        spawnAt(s, ev.enemy, p.x + Math.cos(b) * d, p.y + Math.sin(b) * d, hp);
      }
      return;
  }
}

/** Processions that are over: a chest if every member fell before any got away. */
export function settleGroups(s: State) {
  for (const [id, g] of s.groups) {
    if (g.left > 0 && !g.escaped) continue;
    if (g.left <= 0 && !g.escaped && g.reward) {
      s.pickups.push({ kind: "chest", x: g.x, y: g.y, pull: false, tier: 3, age: 0 });
      s.events.push({ banner: "The procession is broken", sub: "A chest for your trouble", tone: "good" }, { sfx: "chest" });
    } else if (g.escaped) s.events.push({ banner: "The procession passed", tone: "info" });
    s.groups.delete(id);
  }
}

// ---- the road's jars and lanterns ---------------------------------------------------------------------------------------

export const CHUNK = 256;

/** Jars and stone lanterns in each chunk near you, placed from the seed so a chunk is the same whenever you pass. */
function props(s: State) {
  if (s.steps % 30 !== 0) return;
  const cx = Math.floor(s.p.x / CHUNK), cy = Math.floor(s.p.y / CHUNK);
  for (let x = cx - 2; x <= cx + 2; x++)
    for (let y = cy - 2; y <= cy + 2; y++) {
      const id = `${x},${y}`;
      if (s.chunks.has(id)) continue;
      s.chunks.add(id);
      if (x === 0 && y === 0) continue;
      const r = rng((s.load.seed ^ (x * 73856093) ^ (y * 19349663)) >>> 0);
      const n = next(r) < 0.35 ? 0 : next(r) < 0.7 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const lantern = next(r) < 0.35;
        const e = spawnAt(s, "slime", x * CHUNK + range(r, 20, CHUNK - 20), y * CHUNK + range(r, 20, CHUNK - 20), 1);
        Object.assign(e, { prop: lantern ? "lantern" : "jar", hp: 8, max: 8, speed: 0, dmg: 0, xp: 0, r: 6, steady: 1 });
      }
    }
  // Scenery you've left far behind goes, and its chunk can place again later.
  for (const e of s.enemies)
    if (e.prop && Math.hypot(e.x - s.p.x, e.y - s.p.y) > CHUNK * 3.2) {
      e.dead = true;
      s.chunks.delete(`${Math.floor(e.x / CHUNK)},${Math.floor(e.y / CHUNK)}`);
    }
}
