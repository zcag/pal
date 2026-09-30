// The run's state and the primitives every part of the sim shares: the
// spatial grid, damaging an enemy, a kill and what it drops, hurting you,
// effects and events. weapons.ts, enemies.ts, bosses.ts, spawn.ts and
// progress.ts build on these; index.ts steps them in order.
import { BOSSES, type BossKind } from "../content/bosses.ts";
import { ENEMIES, type EnemyKind, type Gait, type ShotKind as FoeShotKind } from "../content/enemies.ts";
import { HEROES, type HeroKind } from "../content/heroes.ts";
import { ITEMS, type ItemKind } from "../content/items.ts";
import { BREAK_DROPS, omen, type ChestTier, type PickupKind } from "../content/meta.ts";
import { ELITE_TRAITS, type EliteTrait } from "../content/stage.ts";
import { BASE, add, type Stats } from "../content/stats.ts";
import { WEAPONS, levelStats, type WStats, type WeaponKind } from "../content/weapons.ts";
import { chance, next, range, rng, type Rng } from "../rng.ts";

export const DT = 1 / 60;

/** Sheet columns of the pack's 4-direction sprites. */
export type Dir = 0 | 1 | 2 | 3; // down, up, left, right

export type Status = { slow: number; slowBy: number; freeze: number; stun: number; root: number; burn: number; burnDps: number; burnBy?: WeaponKind };

export type Enemy = {
  id: number; kind: EnemyKind; boss?: BossKind; prop?: "jar" | "lantern";
  x: number; y: number; hp: number; max: number; speed: number; dmg: number; r: number; xp: number;
  gait: Gait; flies: boolean; steady: number;
  kx: number; ky: number; flash: number; dir: Dir; walk: number; clock: number; age: number;
  /** A lunge's wind-up and its charge; a blink's fade; a burrower underground. */
  wind: number; lunge: number; fade: number; under: boolean; hidden: boolean;
  st: Status;
  elite?: { traits: EliteTrait[]; shield: number; trail: number };
  /** Walking a set line (a swarm, a procession): ignores you, leaves when `life` runs out. */
  path?: { vx: number; vy: number; life: number; group?: number };
  /** A boss's move and its clock (bosses.ts). */
  ai?: { mode: string; t: number; n: number; tx: number; ty: number; enraged: boolean; cd: number };
  dead: boolean; lastHitBy?: WeaponKind;
};

export type ShotSprite = "shuriken" | "shuriken-magic" | "kunai" | "kunai-big" | "fireball" | "arrow" | "ice" | "gust" | "wave";
export type Shot = {
  weapon: WeaponKind; sprite: ShotSprite; x: number; y: number; vx: number; vy: number; r: number; dmg: number; crit: number;
  pierce: number; life: number; age: number; kb: number; hit: Set<number>; homing: boolean; back: boolean; spin: number;
  burst?: { x: number; y: number; r: number; dmg: number; burn: number };
  split?: number; slow?: number; freeze?: number; grow?: number;
};
export type ZoneKind = "caltrop" | "bomb" | "burn" | "cracker" | "whirl" | "tornado" | "smoke" | "dynamite";
export type Zone = {
  weapon: WeaponKind | "hero"; kind: ZoneKind; x: number; y: number; r: number; dmg: number; life: number; tick: number;
  next: Map<number, number>; fuse: number; vx: number; vy: number; age: number;
};
export type FoeShot = { kind: FoeShotKind; x: number; y: number; vx: number; vy: number; r: number; dmg: number; life: number; spin: number };
/** A telegraphed danger: drawn from `t` 0, strikes at `delay`. */
export type Hazard = {
  kind: "ring" | "line" | "dust" | "gust"; x: number; y: number; r: number; x2: number; y2: number;
  t: number; delay: number; dmg: number; done: boolean; stun?: number; push?: number;
  spawn?: EnemyKind; from?: BossKind | "onibi";
};
export type FxKind =
  | "slash" | "slash-circle" | "thunder" | "explosion" | "flame" | "rock-spike" | "smoke" | "smoke-circle" | "spark" | "ice" | "ice-flake"
  | "plant" | "water" | "pillar" | "aura" | "circle" | "boost" | "shield" | "thrust" | "hit" | "leaf" | "rock" | "claw";
export type Fx = { kind: FxKind; x: number; y: number; t: number; dur: number; flip: boolean; scale: number; angle: number; len?: number };
export type Num = { x: number; y: number; v: number; crit: boolean; t: number; heal?: boolean };
export type Gem = { x: number; y: number; v: number; pull: boolean; age: number };
export type Pickup = { kind: PickupKind; x: number; y: number; pull: boolean; tier?: ChestTier; age: number };
export type Later = { at: number; side?: number; ring?: number; x?: number; y?: number; a?: number };
export type Weapon = {
  kind: WeaponKind; level: number; evolved: boolean; cd: number; on: number; angle: number; drops: number;
  later: Later[]; touched: Map<number, number>; dmg: number; kills: number; since: number;
  ws: WStats;
};
export type Item = { kind: ItemKind; level: number };
export type Choice =
  | { type: "weapon"; kind: WeaponKind; level: number }
  | { type: "item"; kind: ItemKind; level: number }
  | { type: "gold" } | { type: "food" };
export type ChestPrize = { type: "evolve"; kind: WeaponKind } | { type: "up"; choice: Choice } | { type: "gold"; n: number };
export type Phase = "play" | "levelup" | "chest" | "dead" | "won";

export type Event =
  | { sfx: string; x?: number; y?: number }
  | { music: "act1" | "act2" | "act3" | "boss" | "oni" | "dawn" | "none" }
  | { banner: string; sub?: string; tone: "act" | "event" | "boss" | "info" | "good" }
  | { boss: BossKind }
  | { shake: number }
  | { vfx: "death" | "pop" | "hurt" | "levelup" | "gem" | "heal" | "burst" | "dust" | "evolve" | "purify" | "gold"; x: number; y: number; color?: string; n?: number };

export type Loadout = {
  hero: HeroKind; seed: number;
  /** Stats bought at the shrine. */
  bonus: Partial<Stats>;
  rerolls: number; skips: number; banishes: number; omen: number;
  /** Weapons not unlocked yet: never offered. */
  locked: WeaponKind[];
};

export type Player = {
  x: number; y: number; hp: number; dir: Dir; face: { x: number; y: number }; side: number; moving: boolean; walk: number;
  hurt: number; dash: number; dashCd: number; dvx: number; dvy: number; invuln: number; inked: number;
  level: number; xp: number; gold: number; kills: number; revived: number; healed: number;
};

export type State = {
  load: Loadout; rng: Rng; t: number; phase: Phase; steps: number;
  p: Player; st: Stats;
  weapons: Weapon[]; items: Item[];
  enemies: Enemy[]; shots: Shot[]; zones: Zone[]; foeShots: FoeShot[]; hazards: Hazard[];
  fx: Fx[]; nums: Num[]; gems: Gem[]; pickups: Pickup[];
  /** Level-ups waiting, the cards showing, the tools left, what's banished. */
  pending: number; choices: Choice[]; rerolls: number; skips: number; banishes: number; banished: Set<string>;
  chest?: ChestPrize[];
  /** Stage clocks: the trickle, the elites, the next event, blood moon and hourglass time left, the drums. */
  trickle: number; elites: number; eventIdx: number; moon: number; frozen: number; drums: boolean; act: number;
  /** Processions still marching: their members left and where the last fell. */
  groups: Map<number, { left: number; escaped: boolean; reward: boolean; x: number; y: number }>;
  /** World: which chunks have had their jars and lanterns placed. */
  chunks: Set<string>;
  tally: {
    breaks: number; specials: number; lastHurt: number; bosses: BossKind[]; evolved: WeaponKind[]; kinds: Partial<Record<EnemyKind, number>>;
    /** Damage taken by what dealt it (an enemy kind, a boss, "burst"...), and what dealt the last hit. */
    hurtBy: Record<string, number>; killedBy?: string;
    /** The longest stretch without being hurt, in seconds. */
    clean: number;
  };
  events: Event[]; nextId: number;
};

export const HERO_R = 5;

/** The commonest events, shared rather than made fresh for every hit and gem (less garbage in a big fight). */
export const SFX_HIT: Event = { sfx: "hit" }, SFX_CRIT: Event = { sfx: "crit" }, SFX_GEM: Event = { sfx: "gem" }, SFX_COIN: Event = { sfx: "coin" };

export function create(load: Loadout): State {
  const hero = HEROES[load.hero];
  const s: State = {
    load, rng: rng(load.seed), t: 0, phase: "play", steps: 0,
    p: {
      x: 0, y: 0, hp: 0, dir: 0, face: { x: 1, y: 0 }, side: 1, moving: false, walk: 0, hurt: 0, dash: 0, dashCd: 0, dvx: 0, dvy: 0,
      invuln: 0, inked: 0, level: 1, xp: 0, gold: 0, kills: 0, revived: 0, healed: 0,
    },
    st: BASE, weapons: [], items: [], enemies: [], shots: [], zones: [], foeShots: [], hazards: [], fx: [], nums: [], gems: [], pickups: [],
    pending: 0, choices: [], rerolls: load.rerolls, skips: load.skips, banishes: load.banishes, banished: new Set(),
    trickle: 0, elites: 0, eventIdx: 0, moon: 0, frozen: 0, drums: false, act: 0, groups: new Map(), chunks: new Set(),
    tally: { breaks: 0, specials: 0, lastHurt: 0, bosses: [], evolved: [], kinds: {}, hurtBy: {}, clean: 0 },
    events: [], nextId: 1,
  };
  addWeapon(s, hero.weapon);
  restat(s);
  s.p.hp = s.st.maxHp;
  return s;
}

// ---- stats --------------------------------------------------------------------------------------------------------

/** Hero, shrine and items summed; each weapon's numbers with them. Call after anything changes. */
export function restat(s: State) {
  let st = add(add(BASE, HEROES[s.load.hero].stats), s.load.bonus);
  for (const it of s.items) st = add(st, { [ITEMS[it.kind].stat]: ITEMS[it.kind].per * it.level });
  s.st = st;
  for (const w of s.weapons) w.ws = weaponStats(s, w);
}

export function weaponStats(s: State, w: Weapon): WStats {
  const b = levelStats(w.kind, w.level, w.evolved), st = s.st;
  return {
    dmg: b.dmg * (1 + st.might), cd: b.cd * Math.max(0.4, 1 - st.cooldown), area: b.area * (1 + st.area), speed: b.speed * (1 + st.speed),
    dur: b.dur * (1 + st.duration), amount: b.amount + st.amount, pierce: b.pierce, kb: b.kb, crit: b.crit + st.luck, effect: b.effect,
  };
}

export function addWeapon(s: State, kind: WeaponKind) {
  const w: Weapon = { kind, level: 1, evolved: false, cd: 0.3, on: 0, angle: 0, drops: 0, later: [], touched: new Map(), dmg: 0, kills: 0, since: s.t, ws: levelStats(kind, 1, false) };
  s.weapons.push(w);
  w.ws = weaponStats(s, w);
  return w;
}

// ---- the grid -------------------------------------------------------------------------------------------------------

export type Grid = Map<number, Enemy[]>;
const CELL = 24;
const key = (cx: number, cy: number) => ((cx + 32768) << 16) | (cy + 32768);

export function hash(es: Enemy[]): Grid {
  const g: Grid = new Map();
  for (const e of es) {
    if (e.dead) continue;
    const k = key(Math.floor(e.x / CELL), Math.floor(e.y / CELL));
    const b = g.get(k);
    if (b) b.push(e); else g.set(k, [e]);
  }
  return g;
}

/** Every enemy (and breakable) you can hit whose body reaches within r of (x, y). */
export function near(g: Grid, x: number, y: number, r: number, fn: (e: Enemy) => void) {
  const pad = r + 48;
  const x0 = Math.floor((x - pad) / CELL), x1 = Math.floor((x + pad) / CELL), y0 = Math.floor((y - pad) / CELL), y1 = Math.floor((y + pad) / CELL);
  for (let cx = x0; cx <= x1; cx++)
    for (let cy = y0; cy <= y1; cy++) {
      const b = g.get(key(cx, cy));
      if (b) for (const e of b) if (!e.dead && !e.under && !e.hidden && Math.hypot(e.x - x, e.y - y) <= r + e.r) fn(e);
    }
}

/** Enemies weapons may aim at: alive, above ground, visible, not scenery. */
export const targetable = (e: Enemy) => !e.dead && !e.under && !e.hidden && !e.prop && !e.path;

// ---- damage ---------------------------------------------------------------------------------------------------------

export type Hit = { weapon: WeaponKind | "hero"; crit?: number; push?: number; from?: { x: number; y: number } };

/** Damage an enemy: crits, shields, numbers, knockback, and a kill when it's done. Returns the damage dealt. */
export function hurt(s: State, e: Enemy, dmg: number, hit: Hit): number {
  if (e.dead || e.under || e.hidden) return 0;
  if (e.boss && e.ai?.mode === "stone") {
    s.nums.push({ x: e.x, y: e.y - e.r, v: 0, crit: false, t: 0 });
    return 0;
  }
  let crit = false;
  if (hit.crit && next(s.rng) < hit.crit) { dmg *= 2; crit = true; }
  if (e.elite?.shield) {
    e.elite.shield--;
    s.fx.push(fx("shield", e.x, e.y, 0.3, false, e.r / 8));
    s.events.push({ sfx: "block" });
    return 0;
  }
  e.hp -= dmg;
  e.flash = 0.1;
  if (hit.weapon !== "hero") {
    const w = s.weapons.find((x) => x.kind === hit.weapon);
    if (w) w.dmg += Math.min(dmg, e.hp + dmg);
    e.lastHitBy = hit.weapon;
  }
  if (s.nums.length < 90 && !e.prop) s.nums.push({ x: e.x + range(s.rng, -3, 3), y: e.y - e.r - 2, v: dmg, crit, t: 0 });
  const push = (hit.push ?? 0) * (crit && s.load.hero === "raiden" ? 2.5 : 1);
  if (push && hit.from && !e.boss && !e.prop) {
    const dx = e.x - hit.from.x, dy = e.y - hit.from.y, d = Math.hypot(dx, dy) || 1, k = 1 - e.steady;
    e.kx += (dx / d) * push * 7 * k;
    e.ky += (dy / d) * push * 7 * k;
  }
  if (!e.prop) s.events.push(crit ? SFX_CRIT : SFX_HIT);
  if (e.hp <= 0) kill(s, e);
  return dmg;
}

export function status(e: Enemy, k: "slow" | "freeze" | "stun" | "root", t: number, slowBy = 0.5) {
  const resist = e.boss ? 0.25 : e.elite ? 0.6 : 1;
  e.st[k] = Math.max(e.st[k], t * resist);
  if (k === "slow") e.st.slowBy = Math.max(e.st.slowBy, slowBy);
}

export function kill(s: State, e: Enemy) {
  e.dead = true;
  if (e.prop) return breakProp(s, e);
  const p = s.p;
  p.kills++;
  s.tally.kinds[e.kind] = (s.tally.kinds[e.kind] ?? 0) + 1;
  const w = e.lastHitBy && s.weapons.find((x) => x.kind === e.lastHitBy);
  if (w) w.kills++;
  s.events.push({ vfx: "death", x: e.x, y: e.y, n: e.boss ? 40 : e.elite ? 16 : 5 });
  s.fx.push(fx("smoke", e.x, e.y, 0.35, false, e.boss ? 3 : e.elite ? 1.6 : 0.8));
  if (s.load.hero === "ennen" && p.kills % 100 === 0) heal(s, 10);
  if (e.boss) return; // bosses.ts handles its own ending
  const xp = e.xp * (s.moon > 0 ? 2 : 1);
  gem(s, e.x, e.y, xp);
  const d = ENEMIES[e.kind];
  if (d.death === "split" && !e.path) for (let i = 0; i < 2; i++) spawnAt(s, "slimelet", e.x + range(s.rng, -5, 5), e.y + range(s.rng, -5, 5), 1);
  if (d.death === "burst") s.hazards.push(hazard("ring", e.x, e.y, 22, 0.7, e.dmg * 0.8, { from: "onibi" }));
  if (d.death === "spores") s.fx.push(fx("smoke-circle", e.x, e.y, 0.5, false, 0.7));
  if (e.elite) {
    if (e.elite.traits.includes("splitting")) for (let i = 0; i < 3; i++) spawnAt(s, e.kind, e.x + range(s.rng, -8, 8), e.y + range(s.rng, -8, 8), 1);
    dropChest(s, e.x, e.y, chance(s.rng, 0.15 + s.st.luck * 0.3) ? 3 : 1);
  } else if (e.path?.group !== undefined) {
    const g = s.groups.get(e.path.group);
    if (g) { g.left--; g.x = e.x; g.y = e.y; }
  } else if (chance(s.rng, 0.03 + (w?.kind === "caltrop" && w.evolved ? 0.25 : 0))) drop(s, "coin", e.x + 4, e.y);
  else if (chance(s.rng, 0.004)) drop(s, "onigiri", e.x, e.y);
  if (e.kind === "lantern" && chance(s.rng, 0.2)) drop(s, "coin", e.x, e.y + 4);
  if (e.kind === "goldtanuki") {
    for (let i = 0; i < 6; i++) drop(s, "bag", e.x + range(s.rng, -14, 14), e.y + range(s.rng, -14, 14));
    dropChest(s, e.x, e.y, 3);
    s.events.push({ banner: "Caught the golden tanuki!", tone: "good" }, { sfx: "chest" });
  }
}

function breakProp(s: State, e: Enemy) {
  s.tally.breaks++;
  s.events.push({ sfx: "break" }, { vfx: "pop", x: e.x, y: e.y, color: e.prop === "jar" ? "#c98b5a" : "#b8b8c0", n: 10 });
  let r = next(s.rng) * BREAK_DROPS.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of BREAK_DROPS) {
    if ((r -= w) > 0) continue;
    if (k !== "nothing") drop(s, k, e.x, e.y);
    break;
  }
}

export function gem(s: State, x: number, y: number, v: number) {
  v *= 1 + s.st.curse;
  if (s.gems.length >= 220) {
    // Too many on the ground: the value joins the one nearest you (Vampire Survivors folds it into one gem).
    let best = s.gems[0], bd = Infinity;
    for (const g of s.gems) {
      const d = Math.abs(g.x - s.p.x) + Math.abs(g.y - s.p.y);
      if (d < bd) { bd = d; best = g; }
    }
    best.v += v;
    return;
  }
  s.gems.push({ x, y, v, pull: false, age: 0 });
}

export const drop = (s: State, kind: PickupKind, x: number, y: number) => s.pickups.push({ kind, x, y, pull: false, age: 0 });
export const dropChest = (s: State, x: number, y: number, tier: ChestTier) => s.pickups.push({ kind: "chest", x, y, pull: false, tier, age: 0 });

export function heal(s: State, n: number) {
  const before = s.p.hp;
  s.p.hp = Math.min(s.st.maxHp, s.p.hp + n);
  const got = s.p.hp - before;
  s.p.healed += got;
  if (got >= 1) s.nums.push({ x: s.p.x, y: s.p.y - 12, v: got, crit: false, t: 0, heal: true });
}

/** Hurt the player: armor off, a short grace after, a revival if the mirror (or the shrine) allows. */
export function hurtPlayer(s: State, dmg: number, by: string) {
  const p = s.p;
  if (p.hurt > 0 || p.dash > 0 || p.invuln > 0 || s.phase !== "play") return;
  const got = Math.max(1, dmg * (1 + 0.05 * s.load.omen) - s.st.armor);
  p.hp -= got;
  s.tally.clean = Math.max(s.tally.clean, s.t - s.tally.lastHurt);
  s.tally.hurtBy[by] = (s.tally.hurtBy[by] ?? 0) + got;
  s.tally.killedBy = by;
  p.hurt = 0.6;
  s.tally.lastHurt = s.t;
  s.events.push({ sfx: "hurt" }, { shake: 2 }, { vfx: "hurt", x: p.x, y: p.y });
  if (p.hp > 0) return;
  if (p.revived < s.st.revival) {
    p.revived++;
    p.hp = s.st.maxHp / 2;
    p.invuln = 3;
    for (const e of s.enemies) if (!e.boss && !e.prop && Math.hypot(e.x - p.x, e.y - p.y) < 90) kill(s, e);
    s.events.push({ banner: "The mirror shows you standing", tone: "good" }, { sfx: "revive" }, { vfx: "purify", x: p.x, y: p.y });
    return;
  }
  p.hp = 0;
  s.phase = "dead";
  s.events.push({ sfx: "gameover" }, { music: "none" });
}

// ---- making things ----------------------------------------------------------------------------------------------------

export const fx = (kind: FxKind, x: number, y: number, dur: number, flip = false, scale = 1, angle = 0): Fx => ({ kind, x, y, t: 0, dur, flip, scale, angle });

export const hazard = (kind: Hazard["kind"], x: number, y: number, r: number, delay: number, dmg: number, more: Partial<Hazard> = {}): Hazard =>
  ({ kind, x, y, r, x2: x, y2: y, t: 0, delay, dmg, done: false, ...more });

const NO_STATUS = (): Status => ({ slow: 0, slowBy: 0, freeze: 0, stun: 0, root: 0, burn: 0, burnDps: 0 });

/** A normal enemy of a kind at a place, its health scaled by the minute (and the night's omen and curse). */
export function spawnAt(s: State, kind: EnemyKind, x: number, y: number, hpMul: number, elite?: EliteTrait[]): Enemy {
  const d = ENEMIES[kind], o = omen(s.load.omen), curse = 1 + s.st.curse;
  const big = elite ? (elite.includes("hulking") ? 2.6 : 1.8) : 1;
  const hp = d.hp * hpMul * o.hp * curse * (elite ? (elite.includes("hulking") ? 22 : 12) : 1);
  const e: Enemy = {
    id: s.nextId++, kind, x, y, hp, max: hp, speed: d.speed * o.speed * (1 + s.st.curse * 0.5) * (elite?.includes("swift") ? 1.6 : 1) * (elite ? 0.9 : 1),
    dmg: d.dmg * (elite ? 1.5 : 1), r: d.r * big, xp: d.xp * (elite ? 12 : 1), gait: d.gait, flies: !!d.flies,
    steady: elite ? Math.max(0.7, d.steady ?? 0) : d.steady ?? 0,
    kx: 0, ky: 0, flash: 0, dir: 0, walk: next(s.rng), clock: range(s.rng, 1, 4), age: 0,
    wind: 0, lunge: 0, fade: 0, under: d.gait === "burrow", hidden: false, st: NO_STATUS(), dead: false,
  };
  if (elite) e.elite = { traits: elite, shield: elite.includes("shielded") ? 12 : 0, trail: 0 };
  s.enemies.push(e);
  return e;
}

export function spawnBoss(s: State, kind: BossKind, x: number, y: number): Enemy {
  const d = BOSSES[kind];
  // Bosses grow with you a little, so a strong build still gets a fight.
  const hp = d.hp * omen(s.load.omen).hp * (0.7 + s.p.level / 40);
  const e: Enemy = {
    id: s.nextId++, kind: "slime", boss: kind, x, y, hp, max: hp, speed: d.speed, dmg: d.dmg, r: d.r, xp: 0, gait: "chase", flies: false, steady: 1,
    kx: 0, ky: 0, flash: 0, dir: 0, walk: 0, clock: 0, age: 0, wind: 0, lunge: 0, fade: 0, under: false, hidden: false, st: NO_STATUS(), dead: false,
    ai: { mode: "enter", t: 0, n: 0, tx: x, ty: y, enraged: false, cd: 2 },
  };
  s.enemies.push(e);
  return e;
}

export const eliteTint = (e: Enemy) => (e.elite ? ELITE_TRAITS[e.elite.traits[0]].tint : undefined);
export const WEAPON_NAME = (k: WeaponKind) => WEAPONS[k].name;
