// Between nights: the save (gold, shrine ranks, unlocks, the codex,
// records, settings), the loadout a night starts from, and what a finished
// night earns. Pure: the page stores the save with the kit's storage.
import { HEROES, type HeroKind } from "./content/heroes.ts";
import { ITEMS, type ItemKind } from "./content/items.ts";
import { OMEN_MAX, SHRINE, UNLOCKS, rankCost, type ShrineKind, type UnlockKind } from "./content/meta.ts";
import { add, BASE, type Stats } from "./content/stats.ts";
import { WEAPONS, type WeaponKind } from "./content/weapons.ts";
import type { EnemyKind } from "./content/enemies.ts";
import type { BossKind } from "./content/bosses.ts";
import type { Loadout, State } from "./sim/index.ts";

export type Settings = { music: number; sfx: number; numbers: boolean; shake: boolean };

export type Save = {
  v: 1;
  gold: number;
  shrine: Partial<Record<ShrineKind, number>>;
  /** Gold offered at the shrine so far: what a refund gives back (prices depend on the order bought, so it's recorded, not recomputed). */
  spent: number;
  unlocked: UnlockKind[];
  hero: HeroKind;
  omen: number;
  /** The codex: weapons and items picked, evolutions seen, enemies and bosses defeated (counts). */
  seen: { weapons: WeaponKind[]; items: ItemKind[]; evolved: WeaponKind[]; enemies: Partial<Record<EnemyKind, number>>; bosses: Partial<Record<BossKind, number>> };
  /** Best night per hero: the time, and whether it saw the dawn. */
  best: Partial<Record<HeroKind, { t: number; dawn: boolean; level: number; kills: number }>>;
  totals: { nights: number; dawns: number; kills: number; gold: number };
  settings: Settings;
};

export const fresh = (): Save => ({
  v: 1, gold: 0, shrine: {}, spent: 0, unlocked: [], hero: "kaze", omen: 0,
  seen: { weapons: [], items: [], evolved: [], enemies: {}, bosses: {} },
  best: {}, totals: { nights: 0, dawns: 0, kills: 0, gold: 0 },
  settings: { music: 0.6, sfx: 0.8, numbers: true, shake: true },
});

/** A stored save, filled out with anything a newer version added. */
export function load(raw: unknown): Save {
  const f = fresh();
  if (!raw || typeof raw !== "object" || (raw as Save).v !== 1) return f;
  const r = raw as Save;
  return { ...f, ...r, seen: { ...f.seen, ...r.seen }, totals: { ...f.totals, ...r.totals }, settings: { ...f.settings, ...r.settings } };
}

export const heroOpen = (s: Save, h: HeroKind) => !HEROES[h].unlock || s.unlocked.includes(HEROES[h].unlock as UnlockKind);
export const weaponOpen = (s: Save, w: WeaponKind) => !WEAPONS[w].unlock || s.unlocked.includes(WEAPONS[w].unlock as UnlockKind);

/** What the shrine adds, as stats. */
export function shrineStats(s: Save): Partial<Stats> {
  let st = { ...BASE };
  for (const k of Object.keys(SHRINE) as ShrineKind[]) {
    const n = s.shrine[k] ?? 0;
    for (let i = 0; i < n; i++) st = add(st, SHRINE[k].per);
  }
  const out: Partial<Stats> = {};
  for (const k of Object.keys(st) as (keyof Stats)[]) if (st[k] !== BASE[k]) out[k] = st[k] - BASE[k];
  return out;
}

export function loadout(s: Save, seed: number): Loadout {
  return {
    hero: heroOpen(s, s.hero) ? s.hero : "kaze", seed, bonus: shrineStats(s),
    rerolls: s.shrine.reroll ?? 0, skips: s.shrine.skip ?? 0, banishes: s.shrine.banish ?? 0,
    omen: s.unlocked.includes("omens") ? Math.min(s.omen, OMEN_MAX) : 0,
    locked: (Object.keys(WEAPONS) as WeaponKind[]).filter((w) => !weaponOpen(s, w)),
  };
}

// ---- the shrine ------------------------------------------------------------------------------------------------------

export const ranksBought = (s: Save) => Object.values(s.shrine).reduce((a, b) => a + (b ?? 0), 0);
export const priceOf = (s: Save, k: ShrineKind) => rankCost(k, s.shrine[k] ?? 0, ranksBought(s));

export function buy(s: Save, k: ShrineKind): boolean {
  const owned = s.shrine[k] ?? 0, price = priceOf(s, k);
  if (owned >= SHRINE[k].ranks || s.gold < price) return false;
  s.gold -= price;
  s.spent += price;
  s.shrine[k] = owned + 1;
  return true;
}

/** Everything offered at the shrine, back. */
export function refund(s: Save) {
  s.gold += s.spent;
  s.spent = 0;
  s.shrine = {};
}

// ---- a night's end ---------------------------------------------------------------------------------------------------

/** What a night earned: `gold` is `found` (picked up) plus `bonus` (for how long it lasted, the bosses beaten and the dawn). */
export type Earned = { gold: number; found: number; bonus: number; unlocks: UnlockKind[]; record: boolean };

/** The gold a night pays on top of what was picked up: 15 a minute, 40 a boss, 250 for the dawn, with Greed. */
export const nightBonus = (run: State) =>
  Math.round((15 * Math.floor(run.t / 60) + 40 * run.tally.bosses.length + (run.phase === "won" ? 250 : 0)) * (1 + run.st.greed));

/** Fold a finished night into the save: gold, records, the codex, and unlocks. */
export function settle(save: Save, run: State): Earned {
  const p = run.p, won = run.phase === "won", hero = run.load.hero;
  const found = Math.round(p.gold), bonus = nightBonus(run), gold = found + bonus;
  save.gold += gold;
  save.totals.nights++;
  save.totals.kills += p.kills;
  save.totals.gold += gold;
  if (won) save.totals.dawns++;
  const b = save.best[hero];
  const record = !b || (won && !b.dawn) || (won === b.dawn && run.t > b.t);
  if (record) save.best[hero] = { t: run.t, dawn: won, level: p.level, kills: p.kills };
  const seen = save.seen;
  for (const w of run.weapons) if (!seen.weapons.includes(w.kind)) seen.weapons.push(w.kind);
  for (const i of run.items) if (!seen.items.includes(i.kind)) seen.items.push(i.kind);
  for (const w of run.tally.evolved) if (!seen.evolved.includes(w)) seen.evolved.push(w);
  for (const [k, n] of Object.entries(run.tally.kinds)) seen.enemies[k as EnemyKind] = (seen.enemies[k as EnemyKind] ?? 0) + (n ?? 0);
  for (const k of run.tally.bosses) seen.bosses[k] = (seen.bosses[k] ?? 0) + 1;
  const unlocks = earnedUnlocks(run).filter((u) => !save.unlocked.includes(u));
  save.unlocked.push(...unlocks);
  return { gold, found, bonus, unlocks, record };
}

/** What this night earned, whether or not it was already unlocked. */
export function earnedUnlocks(run: State): UnlockKind[] {
  const out: UnlockKind[] = [], t = run.tally, won = run.phase === "won";
  if (t.evolved.length) out.push("seimei");
  if (run.t >= 300) out.push("ennen");
  if (t.bosses.includes("tengu")) out.push("raiden");
  if (won) out.push("hayate", "omens");
  if (run.p.kills >= 1000) out.push("kusarigama");
  if (t.bosses.includes("tanuki")) out.push("yumi");
  if (Math.max(t.clean, run.phase === "dead" ? 0 : run.t - t.lastHurt) >= 180) out.push("ice");
  if (run.p.level >= 20) out.push("geyser");
  if (t.specials >= 5) out.push("fan");
  if (t.breaks >= 30) out.push("vines");
  return out;
}

// ---- a night left open -------------------------------------------------------------------------------------------------

/**
 * A night in progress, for the page to store when the panel hides and pick up
 * when it opens again. The state is plain data but for its Sets and Maps,
 * which go through JSON tagged; what's only for the eye (effects, numbers,
 * undrained events) is left behind.
 */
export function packRun(s: State): unknown {
  const bare = { ...s, fx: [], nums: [], events: [] };
  return { v: 1, run: JSON.parse(JSON.stringify(bare, (_, x) => x instanceof Set ? { $set: [...x] } : x instanceof Map ? { $map: [...x] } : x)) };
}

/** A stored night back as a state, or undefined when there's none (or it's from another version). */
export function unpackRun(raw: unknown): State | undefined {
  if (!raw || typeof raw !== "object" || (raw as { v?: number }).v !== 1) return undefined;
  const s = JSON.parse(JSON.stringify((raw as { run: unknown }).run), (_, x) =>
    x && typeof x === "object" && "$set" in x ? new Set(x.$set) : x && typeof x === "object" && "$map" in x ? new Map(x.$map) : x) as State;
  if (!(s?.phase === "play" || s?.phase === "levelup" || s?.phase === "chest")) return undefined;
  s.boons ??= 0; // stored before blessings
  s.blessed ??= [];
  return s;
}

/**
 * A staged moment for the store's screenshots (fixture.ts writes it to the
 * page's storage; surface/main.ts `stage` plays it): a night from a seed with
 * a build, played forward by the bot, then shown live; or a card over it.
 */
export type Scene = {
  hero: HeroKind; seed: number; t: number; play: number; level: number;
  weapons: [WeaponKind, number, boolean?][]; items: [ItemKind, number][];
  card?: "levelup" | "chest";
};

export const unlockName = (u: UnlockKind) => UNLOCKS[u].name;
export const itemName = (k: ItemKind) => ITEMS[k].name;
