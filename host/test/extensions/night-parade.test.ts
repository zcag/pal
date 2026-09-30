import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { View } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";
import { night, play } from "../../../extensions/night-parade/game/bot.ts";
import { BOSSES, type BossKind } from "../../../extensions/night-parade/game/content/bosses.ts";
import { ITEMS, type ItemKind } from "../../../extensions/night-parade/game/content/items.ts";
import { WEAPONS, WEAPON_MAX, type WeaponKind } from "../../../extensions/night-parade/game/content/weapons.ts";
import { addWeapon, hazard, hurt, hurtPlayer, restat, spawnAt, spawnBoss, type State } from "../../../extensions/night-parade/game/sim/core.ts";
import { SLOTS, levelUp, openChest } from "../../../extensions/night-parade/game/sim/progress.ts";
import { banish, choose, offers, reroll, skip, step } from "../../../extensions/night-parade/game/sim/index.ts";

const still = { x: 0, y: 0, dash: false };
const run = (s: State, secs: number) => { for (let i = 0; i < secs * 60 && s.phase === "play"; i++) step(s, still); };
const cards = (s: State) => { s.pending = 1; levelUp(s); };

test("a seed replays the same night", () => {
  const a = play(night(7), undefined, 90), b = play(night(7), undefined, 90);
  expect([a.t, a.p.kills, a.p.level, a.p.hp]).toEqual([b.t, b.p.kills, b.p.level, b.p.hp]);
});

test("the bot gets through the first minutes and levels up", () => {
  const s = play(night(1), undefined, 150);
  expect(s.t).toBeGreaterThanOrEqual(150);
  expect(s.p.level).toBeGreaterThan(4);
  expect(s.p.kills).toBeGreaterThan(80);
});

describe("level-ups", () => {
  test("no new weapon or item once six slots are full", () => {
    const s = night(3);
    for (const k of ["kunai", "katana", "fire", "thunder", "spirit"] as WeaponKind[]) addWeapon(s, k);
    for (const k of ["kabuto", "do", "herbs", "whetstone", "incense", "moon"] as ItemKind[]) s.items.push({ kind: k, level: 1 });
    expect(s.weapons.length).toBe(SLOTS);
    for (const c of offers(s)) {
      if (c.type === "weapon") expect(s.weapons.some((w) => w.kind === c.kind)).toBe(true);
      if (c.type === "item") expect(s.items.some((i) => i.kind === c.kind)).toBe(true);
    }
  });

  test("locked weapons are never offered", () => {
    const s = night(4, "kaze", { locked: ["yumi", "fan"] });
    expect(offers(s).some((c) => c.type === "weapon" && (c.kind === "yumi" || c.kind === "fan"))).toBe(false);
  });

  test("banish removes a kind for the night and costs a charge; at zero it does nothing", () => {
    const s = night(5, "kaze", { banishes: 1 });
    cards(s);
    s.choices = [{ type: "weapon", kind: "kunai", level: 1 }, { type: "item", kind: "tea", level: 1 }];
    banish(s, 0);
    expect(s.banishes).toBe(0);
    expect(s.banished.has("kunai")).toBe(true);
    expect(offers(s).some((c) => c.type === "weapon" && c.kind === "kunai")).toBe(false);
    expect(s.phase).toBe("levelup");
    s.choices = [{ type: "item", kind: "tea", level: 1 }];
    banish(s, 0);
    expect(s.banished.has("tea")).toBe(false);
  });

  test("reroll and skip use their charges and do nothing at zero", () => {
    const s = night(6, "kaze", { rerolls: 1, skips: 1 });
    cards(s);
    reroll(s);
    expect(s.rerolls).toBe(0);
    expect(s.phase).toBe("levelup");
    const shown = s.choices;
    reroll(s);
    expect(s.choices).toBe(shown);
    const gold = s.p.gold;
    skip(s);
    expect(s.skips).toBe(0);
    expect(s.phase as string).toBe("play");
    expect(s.p.gold).toBe(gold + 5);
    cards(s);
    skip(s);
    expect(s.phase).toBe("levelup");
  });

  test("choose applies a weapon and an item; new max health arrives filled", () => {
    const s = night(8);
    cards(s);
    s.choices = [{ type: "weapon", kind: "kunai", level: 1 }];
    choose(s, 0);
    expect(s.weapons.some((w) => w.kind === "kunai")).toBe(true);
    const hp = s.p.hp, max = s.st.maxHp;
    cards(s);
    s.choices = [{ type: "item", kind: "do", level: 1 }];
    choose(s, 0);
    expect(s.st.maxHp).toBe(max + ITEMS.do.per);
    expect(s.p.hp).toBe(hp + ITEMS.do.per);
  });

  test("levels stop at the weapon and item maximums", () => {
    const s = night(9);
    s.weapons[0].level = WEAPON_MAX;
    s.items.push({ kind: "scroll", level: ITEMS.scroll.max });
    expect(offers(s).some((c) => c.type === "weapon" && c.kind === "shuriken")).toBe(false);
    expect(offers(s).some((c) => c.type === "item" && c.kind === "scroll")).toBe(false);
  });
});

describe("chests", () => {
  test("a maxed weapon evolves only with its item held", () => {
    const s = night(10);
    s.weapons[0].level = WEAPON_MAX;
    openChest(s, 1);
    expect(s.chest!.some((p) => p.type === "evolve")).toBe(false);
    s.weapons[0].level = WEAPON_MAX;
    s.items.push({ kind: WEAPONS.shuriken.evolveWith, level: 1 });
    openChest(s, 1);
    expect(s.chest![0]).toEqual({ type: "evolve", kind: "shuriken" });
    expect(s.weapons[0].evolved).toBe(true);
  });

  test("tier 3 and 5 chests give 3 and 5 prizes; nothing to upgrade gives gold", () => {
    const s = night(11);
    for (const k of ["kunai", "katana", "fire"] as WeaponKind[]) addWeapon(s, k);
    openChest(s, 3);
    expect(s.chest!.length).toBe(3);
    openChest(s, 5);
    expect(s.chest!.length).toBe(5);
    const g = night(12);
    g.weapons[0].level = WEAPON_MAX;
    openChest(g, 1);
    expect(g.chest![0].type).toBe("gold");
  });
});

describe("every weapon hits", () => {
  for (const k of Object.keys(WEAPONS) as WeaponKind[])
    for (const evolved of [false, true])
      test(`${k}${evolved ? " (evolved)" : ""}`, () => {
        const s = night(20);
        s.weapons = [];
        const w = addWeapon(s, k);
        if (evolved) { w.level = WEAPON_MAX; w.evolved = true; }
        restat(s);
        s.p.invuln = 1e9;
        for (let i = 0; i < 30; i++) {
          const a = (i / 30) * Math.PI * 2, r = 16 + (i % 4) * 12;
          const e = spawnAt(s, "bamboo", Math.cos(a) * r, Math.sin(a) * r, 1);
          e.hp = e.max = 1e6;
        }
        run(s, 5);
        expect(w.dmg).toBeGreaterThan(0);
      });
});

describe("bosses", () => {
  for (const k of Object.keys(BOSSES) as BossKind[])
    test(`${k} arrives at ${BOSSES[k].at} s`, () => {
      const s = night(30);
      s.p.invuln = 1e9;
      s.t = BOSSES[k].at - 0.05;
      run(s, 0.2);
      expect(s.enemies.some((e) => e.boss === k)).toBe(true);
    });

  test("a fallen boss drops a chest; the Oni falling brings dawn", () => {
    for (const k of ["frog", "tanuki"] as BossKind[]) {
      const s = night(31);
      const b = spawnBoss(s, k, 200, 0);
      hurt(s, b, 1e9, { weapon: "hero" });
      step(s, still);
      expect(s.pickups.some((p) => p.kind === "chest")).toBe(true);
    }
    const s = night(32);
    hurt(s, spawnBoss(s, "oni", 200, 0), 1e9, { weapon: "hero" });
    step(s, still);
    expect(s.phase).toBe("won");
  });
});

test("armor takes off each hit but never below 1", () => {
  const s = night(40);
  s.st.armor = 3;
  const hp = s.p.hp;
  hurtPlayer(s, 10, "test");
  expect(s.p.hp).toBe(hp - 7);
  s.p.hurt = 0;
  s.st.armor = 50;
  hurtPlayer(s, 10, "test");
  expect(s.p.hp).toBe(hp - 8);
});

test("revival brings you back once at half health", () => {
  const s = night(41);
  s.st.revival = 1;
  s.p.hp = 1;
  hurtPlayer(s, 50, "test");
  expect(s.phase).toBe("play");
  expect(s.p.hp).toBe(s.st.maxHp / 2);
  s.p.hurt = 0;
  s.p.invuln = 0;
  s.p.hp = 1;
  hurtPlayer(s, 50, "test");
  expect(s.phase as string).toBe("dead");
});

test("a ring hazard hurts inside it at its moment, and not outside", () => {
  const s = night(42);
  const hp = s.p.hp;
  s.hazards.push(hazard("ring", s.p.x, s.p.y, 20, 0.5, 30), hazard("ring", s.p.x + 100, s.p.y, 20, 0.5, 30));
  run(s, 0.3);
  expect(s.p.hp).toBeCloseTo(hp, 5);
  run(s, 0.3);
  expect(s.p.hp).toBeCloseTo(hp - 30, 5);
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => { host = await Host.bundled(); });
  afterAll(() => host.kill());

  test("a view palette whose view is the page, with the actions ⌘K hands it", async () => {
    const l = host.loaded().find((l) => l.extension === "night-parade")!;
    expect(l.palettes.map((p) => [p.name, p.title, p.view])).toEqual([["night-parade", "Night Parade", "view"]]);
    const v = await host.request<View>("view", { extension: "night-parade", palette: "night-parade" });
    expect(v.tree).toEqual({ type: "surface", src: "surface/index.html" } as unknown as View["tree"]);
    expect(v.title).toBe("Night Parade");
    expect(v.actions.map((a) => a.id)).toEqual(["pause", "mute", "give-up"]);
    expect(v.actions.at(-1)).toMatchObject({ style: "destructive" });
  });
});
