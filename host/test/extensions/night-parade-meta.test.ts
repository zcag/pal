import { describe, expect, test } from "bun:test";
import { night, play } from "../../../extensions/night-parade/game/bot.ts";
import { declared, manifestOf, merge, problems, storedKeys } from "./game-accounts.ts";
import { SHRINE } from "../../../extensions/night-parade/game/content/meta.ts";
import { ENEMIES } from "../../../extensions/night-parade/game/content/enemies.ts";
import { BOSSES } from "../../../extensions/night-parade/game/content/bosses.ts";
import { HEROES } from "../../../extensions/night-parade/game/content/heroes.ts";
import { NIGHT, boardsOf, buy, earnedUnlocks, fresh, load, type Save, loadout, nightBonus, packRun, priceOf, refund, settle, shrineStats, unpackRun } from "../../../extensions/night-parade/game/meta.ts";

test("a stored save loads with anything newer filled in", () => {
  const s = fresh();
  s.gold = 123;
  s.unlocked.push("ennen");
  const back = load(JSON.parse(JSON.stringify(s)));
  expect(back).toEqual(s);
  const old = load({ v: 1, gold: 5, settings: { music: 0.2 } });
  expect(old.gold).toBe(5);
  expect(old.settings).toEqual({ ...fresh().settings, music: 0.2 });
  expect(old.seen.weapons).toEqual([]);
  expect(load(null)).toEqual(fresh());
  expect(load({ v: 99, gold: 9 })).toEqual(fresh());
  // A best night's dawn was once a boolean.
  expect(load({ v: 1, best: { kaze: { t: 950, dawn: true, level: 40, kills: 3000 }, tomoe: { t: 300, dawn: false, level: 9, kills: 200 } } }).best).toEqual({ kaze: { t: 950, dawn: 1, level: 40, kills: 3000 }, tomoe: { t: 300, dawn: 0, level: 9, kills: 200 } });
});

test("the shrine's ranks add up to stats", () => {
  const s = fresh();
  s.shrine = { might: 2, maxHp: 1, armor: 1 };
  const st = shrineStats(s);
  expect(st.might).toBeCloseTo(0.1, 9);
  expect(st.maxHp).toBe(10);
  expect(st.armor).toBe(1);
  expect(st.luck).toBeUndefined();
});

test("buy respects gold and ranks, and each rank costs more", () => {
  const s = fresh();
  expect(buy(s, "might")).toBe(false);
  s.gold = 1e6;
  const p0 = priceOf(s, "might");
  expect(buy(s, "might")).toBe(true);
  expect(s.gold).toBe(1e6 - p0);
  expect(priceOf(s, "might")).toBeGreaterThan(p0);
  expect(priceOf(s, "greed")).toBeGreaterThan(SHRINE.greed.cost); // any rank bought raises every price
  for (let i = 0; i < 10; i++) buy(s, "revival");
  expect(s.shrine.revival).toBe(SHRINE.revival.ranks);
});

test("refund gives back exactly what was spent (bought one kind at a time)", () => {
  const s = fresh();
  s.gold = 1e6;
  for (let i = 0; i < 3; i++) buy(s, "might");
  buy(s, "greed");
  refund(s);
  expect(s.gold).toBe(1e6);
  expect(s.shrine).toEqual({});
});

// A rank's price depends on every rank bought before it (content/meta.ts
// `rankCost`), so a refund returns the gold recorded as spent, whatever the order.
test("refund gives back exactly what was spent when kinds are interleaved", () => {
  const s = fresh();
  s.gold = 1e6;
  buy(s, "might");
  buy(s, "greed");
  buy(s, "might");
  refund(s);
  expect(s.gold).toBe(1e6);
});

test("settle adds gold, keeps the best, fills the codex and unlocks", () => {
  const save = fresh();
  const run = night(1);
  Object.assign(run, { t: 320, phase: "dead" });
  run.p.gold = 42.6;
  run.p.kills = 77;
  run.p.level = 21;
  run.tally.bosses.push("tanuki");
  run.tally.evolved.push("shuriken");
  run.tally.kinds.slime = 5;
  run.items.push({ kind: "tea", level: 1 });
  const e = settle(save, run);
  // 43 picked up, and for the night 5 minutes at 15 and one boss at 40.
  expect([e.found, e.bonus, e.gold]).toEqual([43, 115, 158]);
  expect(save.gold).toBe(158);
  expect(e.record).toBe(true);
  expect(save.best.kaze).toEqual({ t: 320, dawn: 0, level: 21, kills: 77 });
  expect(save.seen.weapons).toContain("shuriken");
  expect(save.seen.items).toContain("tea");
  expect(save.seen.evolved).toContain("shuriken");
  expect(save.seen.enemies.slime).toBe(5);
  expect(save.seen.bosses.tanuki).toBe(1);
  expect(e.unlocks).toEqual(expect.arrayContaining(["ennen", "yumi", "seimei", "geyser"]));
  expect(save.totals).toEqual({ nights: 1, dawns: 0, kills: 77, gold: 158 });
  // A shorter night isn't a record, and unlocks come once.
  const worse = night(2);
  Object.assign(worse, { t: 100, phase: "dead" });
  const e2 = settle(save, worse);
  expect(e2.record).toBe(false);
  expect(save.best.kaze!.t).toBe(320);
  expect(e2.unlocks).not.toContain("ennen");
});

test("earnedUnlocks reads the night", () => {
  const run = night(3);
  expect(earnedUnlocks(run)).toEqual([]);
  Object.assign(run, { t: 900, phase: "won" });
  run.tally.bosses.push("tengu");
  expect(earnedUnlocks(run)).toEqual(expect.arrayContaining(["ennen", "raiden", "hayate", "omens"]));
});

test("a loadout locks unopened weapons and falls back from a locked hero", () => {
  const s = fresh();
  s.hero = "hayate";
  const l = loadout(s, 1);
  expect(l.hero).toBe("kaze");
  expect(l.locked).toEqual(expect.arrayContaining(["yumi", "kusarigama", "ice", "geyser", "fan", "vines"]));
  expect(l.locked).not.toContain("shuriken");
  s.unlocked.push("hayate", "yumi");
  const m = loadout(s, 1);
  expect(m.hero).toBe("hayate");
  expect(m.locked).not.toContain("yumi");
  s.omen = 3;
  expect(loadout(s, 1).omen).toBe(0);
  s.unlocked.push("omens");
  expect(loadout(s, 1).omen).toBe(3);
});

test("a night stored partway plays on exactly as the one left open", () => {
  const a = play(night(7), undefined, 60);
  const b = unpackRun(JSON.parse(JSON.stringify(packRun(a))))!;
  expect(b.banished).toBeInstanceOf(Set);
  expect(b.groups).toBeInstanceOf(Map);
  play(a, undefined, 150);
  play(b, undefined, 150);
  expect([b.t, b.p.kills, b.p.level, b.p.hp, b.p.xp, b.enemies.length]).toEqual([a.t, a.p.kills, a.p.level, a.p.hp, a.p.xp, a.enemies.length]);
  a.phase = "dead";
  expect(unpackRun(packRun(a))).toBeUndefined();
  expect(unpackRun(null)).toBeUndefined();
});

test("a night's bonus: 15 a minute, 40 a boss, 250 for the dawn, times Greed", () => {
  const run = night(4);
  Object.assign(run, { t: 900, phase: "won" });
  run.tally.bosses.push("frog", "tanuki", "yurei", "tengu", "samurai", "oni");
  expect(nightBonus(run)).toBe(15 * 15 + 6 * 40 + 250);
  run.st = { ...run.st, greed: 0.5 };
  expect(nightBonus(run)).toBe(Math.round((15 * 15 + 6 * 40 + 250) * 1.5));
});

test("a night stored before blessings loads with none", () => {
  const packed = packRun(night(8)) as { v: number; run: Record<string, unknown> };
  delete packed.run.boons;
  delete packed.run.blessed;
  const s = unpackRun(JSON.parse(JSON.stringify(packed)))!;
  expect([s.boons, s.blessed]).toEqual([0, []]);
});

describe("accounts", () => {
  const m = manifestOf("night-parade");
  const rule = m.sync.save as { fields: Record<string, { fields: Record<string, { fields: Record<string, unknown> }> }> };

  test("every stored key has a rule (a night left open and a staged scene stay on this machine); every hero, rank, enemy and boss is listed", () => {
    expect(problems(m)).toEqual([]);
    expect(Object.keys(m.sync).sort()).toEqual(storedKeys("night-parade"));
    expect([m.sync.run, m.sync.scene]).toEqual(["local", "local"]);
    expect(Object.keys(rule.fields).sort()).toEqual(Object.keys(fresh()).sort());
    expect(Object.keys(rule.fields.shrine.fields).sort()).toEqual(Object.keys(SHRINE).sort());
    expect(Object.keys(rule.fields.best.fields).sort()).toEqual(Object.keys(HEROES).sort());
    expect(Object.keys(rule.fields.seen.fields.enemies.fields).sort()).toEqual(Object.keys(ENEMIES).sort());
    expect(Object.keys(rule.fields.seen.fields.bosses.fields).sort()).toEqual(Object.keys(BOSSES).sort());
  });

  test("a night goes to its hero's longest night (a dawn is the whole night), the most defeated, and a dawn to the fastest", () => {
    const dead = night(1);
    Object.assign(dead, { t: 412.3456, phase: "dead" });
    dead.p.kills = 640;
    expect(boardsOf(dead)).toEqual([["night/kaze", 412.35], ["kills", 640]]);
    const won = night(2);
    Object.assign(won, { t: 1011.5, phase: "won" });
    expect(boardsOf(won)).toEqual([["night/kaze", NIGHT], ["kills", won.p.kills], ["dawn", 1011.5]]);
    for (const [b, v] of [...boardsOf(dead), ...boardsOf(won)]) {
      const d = declared(m, b as string);
      expect(d, b as string).toBeDefined();
      expect(v).toBeGreaterThanOrEqual(d!.min!);
      expect(v).toBeLessThanOrEqual(d!.max!);
    }
    for (const h of Object.keys(HEROES)) expect(declared(m, `night/${h}`)?.title).toBe(`${HEROES[h as keyof typeof HEROES].name}: longest night`);
    expect(declared(m, "dawn")?.order).toBe("asc");
  });

  test("two machines that both played since they synced keep the gold, ranks, unlocks, codex and records of both", () => {
    const base = fresh();
    base.gold = 1000;
    const synced = JSON.parse(JSON.stringify(base)) as Save;
    const a = load(structuredClone(synced)), b = load(structuredClone(synced));
    buy(a, "might");
    a.unlocked.push("ennen");
    a.seen.enemies.slime = 30;
    a.best.kaze = { t: 400, dawn: 0, level: 20, kills: 900 };
    a.totals.nights += 2;
    b.gold += 300;
    buy(b, "armor");
    b.unlocked.push("omens");
    b.seen.enemies.slime = 12;
    b.seen.weapons.push("katana");
    b.best.kaze = { t: 960, dawn: 1, level: 33, kills: 2500 };
    b.totals.nights += 1;
    const merged = load(merge(m.sync.save, b, merge(m.sync.save, a, synced, synced), synced));
    expect(merged.gold).toBe(1000 + (a.gold - 1000) + (b.gold - 1000));
    expect(merged.spent).toBe(a.spent + b.spent);
    expect(merged.shrine).toEqual({ might: 1, armor: 1 });
    expect(merged.unlocked.sort()).toEqual(["ennen", "omens"]);
    expect(merged.seen.enemies.slime).toBe(42);
    expect(merged.seen.weapons).toEqual(["katana"]);
    expect(merged.best.kaze).toEqual({ t: 960, dawn: 1, level: 33, kills: 2500 });
    expect(merged.totals.nights).toBe(3);
  });
});
