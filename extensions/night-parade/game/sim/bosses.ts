// The six bosses' moves. Each walks at you between moves, telegraphs every
// big one (a ring or a line on the ground, a wind-up), and changes below half
// health (`enraged`). A boss's clock (`ai.cd`) counts down to its next move.
import { actAt } from "../content/stage.ts";
import { BOSSES } from "../content/bosses.ts";
import { next, pick, range } from "../rng.ts";
import { HERO_R, dropChest, fx, gem, hazard, hurtPlayer, spawnAt, type Enemy, type State } from "./core.ts";
import { fireAt } from "./enemies.ts";

export function stepBosses(s: State, dt: number) {
  for (const e of s.enemies) {
    if (!e.boss) continue;
    if (e.dead) { if (e.ai!.mode !== "gone") fall(s, e); continue; }
    const ai = e.ai!, st = e.st;
    e.flash = Math.max(0, e.flash - dt);
    e.walk += dt;
    e.age += dt;
    for (const k of ["slow", "freeze", "stun", "root", "burn"] as const) st[k] = Math.max(0, st[k] - dt);
    ai.t += dt;
    if (!ai.enraged && e.hp < e.max / 2) {
      ai.enraged = true;
      e.speed *= 1.25;
      s.events.push({ banner: `${BOSSES[e.boss].name} is enraged`, tone: "boss" }, { sfx: "roar" }, { shake: 3 });
      if (e.boss === "tengu") ai.n = 0;
    }
    const held = st.freeze > 0 || st.stun > 0 || s.frozen > 0;
    if (held && ai.mode !== "hop" && ai.mode !== "dash" && ai.mode !== "roll") continue;
    BOSS_AI[e.boss](s, e, dt);
    if (ai.mode !== "hop" && !e.hidden && Math.hypot(s.p.x - e.x, s.p.y - e.y) < e.r + HERO_R) hurtPlayer(s, e.dmg, e.boss);
  }
}

function walk(s: State, e: Enemy, dt: number, speed = e.speed) {
  const dx = s.p.x - e.x, dy = s.p.y - e.y, d = Math.hypot(dx, dy) || 1;
  if (d < e.r) return;
  e.x += (dx / d) * speed * (1 - e.st.slowBy) * dt;
  e.y += (dy / d) * speed * (1 - e.st.slowBy) * dt;
  e.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy < 0 ? 1 : 0;
}

const set = (e: Enemy, mode: string) => { e.ai!.mode = mode; e.ai!.t = 0; };

/** Keep up with you if you ran: a boss never falls more than a screen behind. */
function keepUp(s: State, e: Enemy) {
  const d = Math.hypot(s.p.x - e.x, s.p.y - e.y);
  if (d < 360) return;
  const a = Math.atan2(e.y - s.p.y, e.x - s.p.x);
  e.x = s.p.x + Math.cos(a) * 300;
  e.y = s.p.y + Math.sin(a) * 300;
}

type AI = (s: State, e: Enemy, dt: number) => void;

const frog: AI = (s, e, dt) => {
  const ai = e.ai!;
  switch (ai.mode) {
    case "crouch":
      if (ai.t > 0.55) set(e, "hop");
      return;
    case "hop": {
      const k = Math.min(1, ai.t / 0.7);
      e.x += (ai.tx - e.x) * Math.min(1, dt * 7);
      e.y += (ai.ty - e.y) * Math.min(1, dt * 7);
      if (k < 1) return;
      if (ai.enraged) for (let i = 0; i < 3; i++) spawnAt(s, "slime", e.x + range(s.rng, -20, 20), e.y + range(s.rng, -20, 20), 3);
      if (ai.enraged && ai.n++ % 2 === 0) { crouch(s, e); return; }
      set(e, "walk");
      ai.cd = ai.enraged ? 1.6 : 2.6;
      return;
    }
    default:
      walk(s, e, dt);
      keepUp(s, e);
      if ((ai.cd -= dt) <= 0) crouch(s, e);
  }
};

function crouch(s: State, e: Enemy) {
  const ai = e.ai!;
  set(e, "crouch");
  ai.tx = s.p.x + s.p.face.x * 20;
  ai.ty = s.p.y + s.p.face.y * 20;
  s.hazards.push(hazard("ring", ai.tx, ai.ty, 42, 1.25, e.dmg, { from: "frog" }));
  s.events.push({ sfx: "croak" });
}

const tanuki: AI = (s, e, dt) => {
  const ai = e.ai!;
  switch (ai.mode) {
    case "aim":
      if (ai.t > 0.7) set(e, "roll");
      return;
    case "roll": {
      const dx = ai.tx - e.x, dy = ai.ty - e.y, d = Math.hypot(dx, dy);
      e.x += (dx / (d || 1)) * Math.min(d, 210 * dt);
      e.y += (dy / (d || 1)) * Math.min(d, 210 * dt);
      if (d < 4 || ai.t > 1.6) {
        if (ai.enraged && ai.n++ % 2 === 0) aimLine(s, e, 200, 0.5);
        else { set(e, "walk"); ai.cd = 2.2; }
      }
      return;
    }
    case "stone":
      if (ai.t > 1.4) { set(e, "walk"); ai.cd = 1.8; }
      return;
    default: {
      walk(s, e, dt);
      keepUp(s, e);
      if ((ai.cd -= dt) > 0) return;
      const move = pick(s.rng, ["roll", "roll", "decoy", "stone"] as const);
      if (move === "roll") aimLine(s, e, 200, 0.7);
      else if (move === "stone") {
        set(e, "stone");
        s.hazards.push(hazard("ring", e.x, e.y, 60, 1.4, e.dmg * 1.2, { from: "tanuki" }));
        s.events.push({ sfx: "stone" });
      } else {
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2, d = spawnAt(s, "tanuki", e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30, 6);
          s.fx.push(fx("smoke", d.x, d.y, 0.4));
        }
        s.events.push({ sfx: "poof" });
        ai.cd = 2.5;
      }
    }
  }
};

/** Draw a line from the boss at you and set off down it. */
function aimLine(s: State, e: Enemy, len: number, delay: number) {
  const ai = e.ai!, a = Math.atan2(s.p.y - e.y, s.p.x - e.x);
  ai.tx = e.x + Math.cos(a) * len;
  ai.ty = e.y + Math.sin(a) * len;
  set(e, e.boss === "samurai" ? "draw" : "aim");
  s.hazards.push(hazard("line", e.x, e.y, 9, delay, 0, { x2: ai.tx, y2: ai.ty, from: e.boss }));
  s.events.push({ sfx: "draw" });
}

const yurei: AI = (s, e, dt) => {
  const ai = e.ai!;
  switch (ai.mode) {
    case "fade":
      if (ai.t > 0.5 && e.hidden) {
        const a = next(s.rng) * Math.PI * 2;
        e.x = s.p.x + Math.cos(a) * 85;
        e.y = s.p.y + Math.sin(a) * 85;
        e.hidden = false;
        s.fx.push(fx("smoke-circle", e.x, e.y, 0.4));
      }
      if (ai.t > 0.8) {
        wail(s, e, ai.enraged ? 18 : 12, 0);
        if (ai.enraged) wail(s, e, 18, Math.PI / 18);
        set(e, "walk");
        ai.cd = ai.enraged ? 2.2 : 3;
      }
      return;
    default:
      walk(s, e, dt, e.speed * 0.8);
      keepUp(s, e);
      if ((ai.cd -= dt) <= 0) {
        set(e, "fade");
        e.hidden = true;
        s.events.push({ sfx: "wail" });
      }
  }
};

function wail(s: State, e: Enemy, n: number, off: number) {
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    s.foeShots.push({ kind: "wisp", x: e.x, y: e.y, vx: Math.cos(a) * 55, vy: Math.sin(a) * 55, r: 4, dmg: e.dmg * 0.6, life: 4, spin: 0 });
  }
}

const tengu: AI = (s, e, dt) => {
  const ai = e.ai!;
  switch (ai.mode) {
    case "vanish":
      if (ai.t > 0.6 && e.hidden) {
        const a = next(s.rng) * Math.PI * 2;
        e.x = s.p.x + Math.cos(a) * 65;
        e.y = s.p.y + Math.sin(a) * 65;
        e.hidden = false;
        s.fx.push(fx("smoke-circle", e.x, e.y, 0.4, false, 2));
      }
      if (ai.t > 0.9) {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2 + ai.t;
          s.foeShots.push({ kind: "feather", x: e.x, y: e.y, vx: Math.cos(a) * 95, vy: Math.sin(a) * 95, r: 4, dmg: e.dmg * 0.6, life: 3, spin: 0 });
        }
        s.events.push({ sfx: "feathers" });
        set(e, "walk");
        ai.cd = ai.enraged ? 1.6 : 2.4;
      }
      return;
    case "gust":
      if (ai.t > 0.8) { set(e, "walk"); ai.cd = 1.8; }
      return;
    default: {
      walk(s, e, dt);
      keepUp(s, e);
      if (ai.enraged && (ai.n -= dt) <= 0) {
        ai.n = 10;
        for (let i = 0; i < 8; i++) spawnAt(s, "crow", e.x + range(s.rng, -30, 30), e.y + range(s.rng, -30, 30), 4);
        s.events.push({ sfx: "crows" }, { banner: "The crows answer", tone: "boss" });
      }
      if ((ai.cd -= dt) > 0) return;
      const move = pick(s.rng, ["vanish", "vanish", "volley", "gust"] as const);
      if (move === "vanish") { set(e, "vanish"); e.hidden = true; s.events.push({ sfx: "vanish" }); }
      else if (move === "volley") {
        for (const da of [-0.25, 0, 0.25]) fireAt(s, e, "feather", 130, e.dmg * 0.6, da);
        ai.cd = 1.2;
      } else {
        set(e, "gust");
        s.hazards.push(hazard("gust", e.x, e.y, 70, 0.8, e.dmg * 0.7, { push: 50, from: "tengu" }));
        s.events.push({ sfx: "gust" });
      }
    }
  }
};

const samurai: AI = (s, e, dt) => {
  const ai = e.ai!;
  switch (ai.mode) {
    case "draw":
      if (ai.t > 0.8) set(e, "dash");
      return;
    case "dash": {
      const dx = ai.tx - e.x, dy = ai.ty - e.y, d = Math.hypot(dx, dy);
      e.x += (dx / (d || 1)) * Math.min(d, 380 * dt);
      e.y += (dy / (d || 1)) * Math.min(d, 380 * dt);
      e.dir = dx < 0 ? 2 : 3;
      if (s.steps % 3 === 0) s.fx.push(fx("slash", e.x, e.y, 0.2, dx < 0, 1.4));
      if (d < 4 || ai.t > 1) {
        if (ai.enraged && ++ai.n % 3 !== 0) aimLine(s, e, 230, 0.45);
        else { set(e, "walk"); ai.cd = 2.2; }
      }
      return;
    }
    case "sweep":
      if (ai.t > 0.55) { set(e, "walk"); ai.cd = 1.5; }
      return;
    default: {
      walk(s, e, dt);
      keepUp(s, e);
      if ((ai.cd -= dt) > 0) return;
      if (Math.hypot(s.p.x - e.x, s.p.y - e.y) < 50) {
        set(e, "sweep");
        s.hazards.push(hazard("ring", e.x, e.y, 44, 0.55, e.dmg, { from: "samurai" }));
      } else aimLine(s, e, 230, 0.8);
      s.events.push({ sfx: "draw" });
    }
  }
};

const oni: AI = (s, e, dt) => {
  const ai = e.ai!;
  if (ai.enraged && ai.n === 0 && e.hp < e.max / 4) {
    ai.n = 1;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      spawnAt(s, i % 3 ? "imp" : "onibi", s.p.x + Math.cos(a) * 170, s.p.y + Math.sin(a) * 170, 12);
    }
    s.events.push({ banner: "The parade answers its master", tone: "boss" }, { sfx: "roar" }, { shake: 4 });
  }
  switch (ai.mode) {
    case "slam":
    case "throw":
      if (ai.t > 1) { set(e, "walk"); ai.cd = ai.enraged ? 1.4 : 2.2; }
      return;
    default: {
      walk(s, e, dt);
      keepUp(s, e);
      if ((ai.cd -= dt) > 0) return;
      const move = pick(s.rng, ["slam", "slam", "throw", "summon"] as const);
      if (move === "slam") {
        set(e, "slam");
        const n = ai.enraged ? 5 : 3;
        for (let i = 0; i < n; i++) {
          const x = s.p.x + (i ? range(s.rng, -50, 50) : 0), y = s.p.y + (i ? range(s.rng, -40, 40) : 0);
          s.hazards.push(hazard("ring", x, y, 36, 1 + i * 0.12, e.dmg, { from: "oni" }));
        }
        s.events.push({ sfx: "roar" });
      } else if (move === "throw") {
        set(e, "throw");
        fireAt(s, e, "club", 150, e.dmg * 0.9);
      } else {
        for (let i = 0; i < 6; i++) spawnAt(s, i % 3 ? "imp" : "onibi", e.x + range(s.rng, -40, 40), e.y + range(s.rng, -40, 40), 10);
        s.events.push({ sfx: "drum" });
        ai.cd = 2;
      }
    }
  }
};

const BOSS_AI: Record<NonNullable<Enemy["boss"]>, AI> = { frog, tanuki, yurei, tengu, samurai, oni };

/** A boss down: its prize, the music back to the act, and dawn if it was the Oni. */
function fall(s: State, e: Enemy) {
  const d = BOSSES[e.boss!];
  e.ai!.mode = "gone";
  s.tally.bosses.push(e.boss!);
  s.events.push({ banner: `${d.name} is defeated`, tone: "good" }, { sfx: "victory" }, { shake: 5 }, { vfx: "burst", x: e.x, y: e.y, n: 60 });
  for (let i = 0; i < 14; i++) gem(s, e.x + range(s.rng, -26, 26), e.y + range(s.rng, -26, 26), d.minor ? 8 : 20);
  if (e.boss === "oni") {
    s.phase = "won";
    s.events.push({ music: "dawn" }, { sfx: "dawn" });
    return;
  }
  dropChest(s, e.x, e.y, d.minor ? 3 : 5);
  s.events.push({ music: (["act1", "act2", "act3"] as const)[actAt(s.t)] });
}
