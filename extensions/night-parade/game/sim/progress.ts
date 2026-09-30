// You: moving and dashing, picking things up, levelling, choosing, and
// opening chests.
import { ITEMS, type ItemKind } from "../content/items.ts";
import { BLESSINGS, type BlessingKind } from "../content/meta.ts";
import { WEAPONS, WEAPON_MAX, type WeaponKind } from "../content/weapons.ts";
import { needed } from "../content/xp.ts";
import { next, pick } from "../rng.ts";
import { SFX_COIN, SFX_GEM, addWeapon, fx, heal, kill, restat, type Choice, type ChestPrize, type State } from "./core.ts";
import { smokePuff } from "./weapons.ts";

export type Input = { x: number; y: number; dash: boolean };

export const DASH_TIME = 0.16, DASH_SPEED = 300, DASH_CD = 2.2, SLOTS = 6;

export function move(s: State, input: Input, dt: number) {
  const p = s.p;
  p.hurt = Math.max(0, p.hurt - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.inked = Math.max(0, p.inked - dt);
  p.hp = Math.min(s.st.maxHp, p.hp + s.st.recovery * dt);
  const len = Math.hypot(input.x, input.y);
  p.moving = len > 0;
  if (p.moving) {
    p.face = { x: input.x / len, y: input.y / len };
    if (input.x) p.side = Math.sign(input.x);
    p.dir = Math.abs(input.x) > Math.abs(input.y) ? (input.x < 0 ? 2 : 3) : input.y < 0 ? 1 : 0;
    p.walk += dt;
  }
  if (input.dash && p.dashCd <= 0 && p.dash <= 0) {
    p.dash = DASH_TIME;
    p.dashCd = DASH_CD * (1 - s.st.dash);
    p.dvx = p.face.x * DASH_SPEED;
    p.dvy = p.face.y * DASH_SPEED;
    s.fx.push(fx("smoke", p.x, p.y, 0.4));
    s.events.push({ sfx: "dash" });
    if (s.load.hero === "kaze") smokePuff(s);
  }
  if (p.dash > 0) {
    p.dash -= dt;
    p.x += p.dvx * dt;
    p.y += p.dvy * dt;
  } else if (p.moving) {
    const v = s.st.move * (p.inked > 0 ? 0.6 : 1);
    p.x += (input.x / len) * v * dt;
    p.y += (input.y / len) * v * dt;
  }
}

// ---- pickups -----------------------------------------------------------------------------------------------------

export function collect(s: State, dt: number) {
  const p = s.p, reach = s.st.magnet;
  const pull = (o: { x: number; y: number; pull: boolean }, r: number) => {
    const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy);
    if (d < r) o.pull = true;
    if (o.pull) {
      const v = Math.max(140, 460 - d) * dt;
      o.x += (dx / (d || 1)) * Math.min(v, d);
      o.y += (dy / (d || 1)) * Math.min(v, d);
    }
    return d < 8;
  };
  const growth = 1 + s.st.growth;
  s.gems = s.gems.filter((g) => {
    g.age += dt;
    if (g.age > 15 && !g.pull) {
      // Left behind, a gem drifts after you: in pal's small panel most kills happen off-screen.
      const dx = p.x - g.x, dy = p.y - g.y, d = Math.hypot(dx, dy) || 1;
      g.x += (dx / d) * 34 * dt;
      g.y += (dy / d) * 34 * dt;
    }
    if (!pull(g, reach)) return true;
    p.xp += g.v * growth;
    s.events.push(SFX_GEM);
    while (p.xp >= needed(p.level)) {
      p.xp -= needed(p.level);
      p.level++;
      s.pending++;
    }
    return false;
  });
  const greed = (1 + s.st.greed) * (1 + 0.3 * s.load.omen);
  s.pickups = s.pickups.filter((o) => {
    o.age += dt;
    if (!pull(o, o.kind === "chest" ? 18 : reach)) return true;
    switch (o.kind) {
      case "coin": case "pouch": case "bag": {
        const n = { coin: 1, pouch: 10, bag: 25 }[o.kind] * greed;
        p.gold += n;
        s.events.push(SFX_COIN, { vfx: "gold", x: p.x, y: p.y });
        break;
      }
      case "onigiri": heal(s, 30); s.events.push({ sfx: "heal" }, { vfx: "heal", x: p.x, y: p.y }); break;
      case "feast": heal(s, s.st.maxHp); s.events.push({ sfx: "heal" }, { vfx: "heal", x: p.x, y: p.y }); break;
      case "chest": openChest(s, o.tier ?? 1); break;
      default: special(s, o.kind);
    }
    return false;
  });
}

function special(s: State, kind: "flute" | "hourglass" | "ofuda" | "gourd") {
  s.tally.specials++;
  const p = s.p;
  if (kind === "flute") {
    for (const g of s.gems) g.pull = true;
    s.events.push({ banner: "Shakuhachi", sub: "Every gem comes to you", tone: "good" }, { sfx: "flute" });
  } else if (kind === "hourglass") {
    s.frozen = 6;
    s.events.push({ banner: "Hourglass", sub: "The parade stands still", tone: "good" }, { sfx: "freeze" });
  } else if (kind === "ofuda") {
    for (const e of s.enemies) if (!e.boss && !e.prop && !e.dead && Math.abs(e.x - p.x) < 240 && Math.abs(e.y - p.y) < 140) kill(s, e);
    s.events.push({ banner: "Ofuda", sub: "Purified", tone: "good" }, { sfx: "purify" }, { vfx: "purify", x: p.x, y: p.y }, { shake: 3 });
  } else {
    p.invuln = 8;
    s.events.push({ banner: "Sake gourd", sub: "Nothing can touch you", tone: "good" }, { sfx: "gourd" });
  }
}

// ---- level-ups -------------------------------------------------------------------------------------------------------

/** Everything a level-up could offer now. */
export function offers(s: State): Choice[] {
  const out: Choice[] = [];
  const ban = (k: string) => s.banished.has(k);
  for (const w of s.weapons) if (!w.evolved && w.level < WEAPON_MAX && !ban(w.kind)) out.push({ type: "weapon", kind: w.kind, level: w.level + 1 });
  if (s.weapons.length < SLOTS)
    for (const k of Object.keys(WEAPONS) as WeaponKind[])
      if (!s.weapons.some((w) => w.kind === k) && !s.load.locked.includes(k) && !ban(k)) out.push({ type: "weapon", kind: k, level: 1 });
  for (const it of s.items) if (it.level < ITEMS[it.kind].max && !ban(it.kind)) out.push({ type: "item", kind: it.kind, level: it.level + 1 });
  if (s.items.length < SLOTS)
    for (const k of Object.keys(ITEMS) as ItemKind[]) if (!s.items.some((it) => it.kind === k) && !ban(k)) out.push({ type: "item", kind: k, level: 1 });
  return out;
}

/** Whether a choice would complete an evolution pair with something you hold. */
export function pairs(s: State, c: Choice): boolean {
  if (c.type === "item") return s.weapons.some((w) => !w.evolved && WEAPONS[w.kind].evolveWith === c.kind) && !s.items.some((i) => i.kind === c.kind);
  if (c.type === "weapon" && c.level === 1) return s.items.some((i) => i.kind === WEAPONS[c.kind].evolveWith);
  return false;
}

/** What comes after a card or a chest: a blessing owed first, then a level-up waiting, else the night. */
export function nextCard(s: State) {
  if (s.boons > 0) bless(s);
  else if (s.pending > 0) levelUp(s);
}

/** The act's blessing: three not yet taken, one to choose, for the rest of the night. */
export function bless(s: State) {
  const pool = (Object.keys(BLESSINGS) as BlessingKind[]).filter((b) => !s.blessed.includes(b));
  const choices: Choice[] = [];
  while (choices.length < 3 && pool.length) choices.push({ type: "blessing", kind: pool.splice(Math.floor(next(s.rng) * pool.length), 1)[0] });
  if (!choices.length) { s.boons = 0; return levelUp(s); }
  s.choices = choices;
  s.phase = "levelup";
  s.events.push({ sfx: "sparkle" }, { vfx: "levelup", x: s.p.x, y: s.p.y });
}

/** The cards showing are a blessing: no reroll, skip or banish, and no level used. */
export const blessing = (s: State) => s.choices[0]?.type === "blessing";

export function levelUp(s: State) {
  const pool = offers(s);
  const n = 3 + (next(s.rng) < s.st.luck * 0.6 ? 1 : 0);
  const choices: Choice[] = [];
  while (choices.length < n && pool.length) {
    // What you carry comes up more than something new, and a piece of a pair more still.
    const weights = pool.map((c) => (c.type === "weapon" || c.type === "item" ? (c.level > 1 ? 1.5 : 1) * (pairs(s, c) ? 1.5 : 1) : 1));
    let r = next(s.rng) * weights.reduce((a, b) => a + b, 0), i = 0;
    while ((r -= weights[i]) > 0 && i < pool.length - 1) i++;
    choices.push(pool.splice(i, 1)[0]);
  }
  s.choices = choices.length ? choices : [{ type: "gold" }, { type: "food" }];
  s.phase = "levelup";
  s.events.push({ sfx: "levelup" }, { vfx: "levelup", x: s.p.x, y: s.p.y });
}

export function apply(s: State, c: Choice) {
  if (c.type === "gold") s.p.gold += 25;
  else if (c.type === "food") heal(s, 30);
  else if (c.type === "blessing") {
    const before = s.st.maxHp;
    s.blessed.push(c.kind);
    restat(s);
    s.p.hp = c.kind === "spring" ? s.st.maxHp : s.p.hp + Math.max(0, s.st.maxHp - before);
    return;
  }
  else if (c.type === "weapon") {
    const w = s.weapons.find((x) => x.kind === c.kind);
    if (w) w.level = c.level; else addWeapon(s, c.kind);
  } else {
    const it = s.items.find((x) => x.kind === c.kind), before = s.st.maxHp;
    if (it) it.level = c.level; else s.items.push({ kind: c.kind, level: 1 });
    restat(s);
    s.p.hp += Math.max(0, s.st.maxHp - before); // new max health arrives filled
    return;
  }
  restat(s);
}

function after(s: State) {
  if (blessing(s)) s.boons--;
  else s.pending--;
  s.choices = [];
  s.phase = "play";
  nextCard(s);
}

export function choose(s: State, i: number) {
  if (s.phase !== "levelup" || !s.choices[i]) return;
  apply(s, s.choices[i]);
  s.events.push({ sfx: "accept" });
  after(s);
}

export function reroll(s: State) {
  if (s.phase !== "levelup" || s.rerolls <= 0 || blessing(s)) return;
  s.rerolls--;
  s.phase = "play";
  levelUp(s);
  s.events.push({ sfx: "reroll" });
}

export function skip(s: State) {
  if (s.phase !== "levelup" || s.skips <= 0 || blessing(s)) return;
  s.skips--;
  s.p.gold += 5;
  s.events.push({ sfx: "skip" });
  after(s);
}

/** Banish choice i for the rest of the night, and deal again. */
export function banish(s: State, i: number) {
  const c = s.choices[i];
  if (s.phase !== "levelup" || s.banishes <= 0 || blessing(s) || !c || (c.type !== "weapon" && c.type !== "item") || c.level > 1) return;
  s.banishes--;
  s.banished.add(c.kind);
  s.phase = "play";
  levelUp(s);
  s.events.push({ sfx: "banish" });
}

// ---- chests ---------------------------------------------------------------------------------------------------------------

/** One prize per tier step: an evolution first if one is ready, then upgrades of what you carry, else gold. */
export function openChest(s: State, tier: 1 | 3 | 5) {
  const luckUp = next(s.rng) < s.st.luck * 0.25;
  const n = luckUp && tier < 5 ? tier + 2 : tier;
  const prizes: ChestPrize[] = [];
  for (let i = 0; i < n; i++) {
    const ready = s.weapons.find((w) => !w.evolved && w.level >= WEAPON_MAX && s.items.some((it) => it.kind === WEAPONS[w.kind].evolveWith));
    if (ready) {
      ready.evolved = true;
      ready.cd = 0.3;
      s.tally.evolved.push(ready.kind);
      prizes.push({ type: "evolve", kind: ready.kind });
      s.events.push({ sfx: "evolve" }, { vfx: "evolve", x: s.p.x, y: s.p.y });
      restat(s);
      continue;
    }
    const owned = offers(s).filter((c) => (c.type === "weapon" || c.type === "item") && c.level > 1);
    if (owned.length) {
      const c = pick(s.rng, owned);
      apply(s, c);
      prizes.push({ type: "up", choice: c });
    } else {
      const g = 25 * (1 + s.st.greed);
      s.p.gold += g;
      prizes.push({ type: "gold", n: g });
    }
  }
  s.chest = prizes;
  s.phase = "chest";
  s.events.push({ sfx: "chest" });
}

export function resume(s: State) {
  if (s.phase !== "chest") return;
  s.chest = undefined;
  s.phase = "play";
  nextCard(s);
}
