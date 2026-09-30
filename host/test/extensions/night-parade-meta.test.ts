import { expect, test } from "bun:test";
import { night } from "../../../extensions/night-parade/game/bot.ts";
import { SHRINE } from "../../../extensions/night-parade/game/content/meta.ts";
import { buy, earnedUnlocks, fresh, load, loadout, priceOf, refund, settle, shrineStats } from "../../../extensions/night-parade/game/meta.ts";

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
  expect(e.gold).toBe(43);
  expect(save.gold).toBe(43);
  expect(e.record).toBe(true);
  expect(save.best.kaze).toEqual({ t: 320, dawn: false, level: 21, kills: 77 });
  expect(save.seen.weapons).toContain("shuriken");
  expect(save.seen.items).toContain("tea");
  expect(save.seen.evolved).toContain("shuriken");
  expect(save.seen.enemies.slime).toBe(5);
  expect(save.seen.bosses.tanuki).toBe(1);
  expect(e.unlocks).toEqual(expect.arrayContaining(["ennen", "yumi", "seimei", "geyser"]));
  expect(save.totals).toEqual({ nights: 1, dawns: 0, kills: 77, gold: 43 });
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
