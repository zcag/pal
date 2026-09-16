// Blackjack: the rules (game.ts, pure) with a rigged shoe, the tree
// (render.ts), and the extension over the wire: a view palette's meta, its
// opening tree, a pick that answers a tree and persists the state.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { DEFAULTS, RESHUFFLE_AT, actions, apply, canDouble, canSplit, isBlackjack, newGame, shoe, value, type Settings, type State } from "../../../extensions/blackjack/game.ts";
import { backSvg, cardSvg, type Card } from "../../../extensions/blackjack/cards.ts";
import { money, render } from "../../../extensions/blackjack/render.ts";
import type { View, ViewNode } from "../../../sdk/src/protocol.ts";
import { Host, stored } from "../harness.ts";

/** A shoe that deals `order` in that order: the dealer pops from the end. */
const rig = (st: State, order: Card[]): State => ({ ...st, shoe: [...st.shoe.slice(0, 100), ...[...order].reverse()] });
const start = (order: Card[], s: Settings = DEFAULTS): State => rig(newGame(s, () => 0.5), order);
/** player, dealer, player, hole, then draws. */
const dealt = (order: Card[], s: Settings = DEFAULTS) => apply(start(order, s), "deal", s);

describe("hand values", () => {
  test("aces count eleven while they can", () => {
    expect(value(["AS", "KH"])).toEqual({ total: 21, soft: true });
    expect(value(["AS", "AD"])).toEqual({ total: 12, soft: true });
    expect(value(["AS", "AD", "9C"])).toEqual({ total: 21, soft: true });
    expect(value(["AS", "5H", "KD"])).toEqual({ total: 16, soft: false });
    expect(value(["10S", "9H", "5D"])).toEqual({ total: 24, soft: false });
    expect(value(["JS", "QH"])).toEqual({ total: 20, soft: false });
  });
  test("a natural is two cards, not after a split", () => {
    expect(isBlackjack({ cards: ["AS", "KH"] })).toBe(true);
    expect(isBlackjack({ cards: ["AS", "KH"], split: true })).toBe(false);
    expect(isBlackjack({ cards: ["AS", "5H", "5D"] })).toBe(false);
  });
});

describe("dealing and the dealer", () => {
  test("the shoe is decks by 52 and the deal takes the bet", () => {
    expect(shoe(6, () => 0.5)).toHaveLength(312);
    const st = dealt(["5S", "9H", "7D", "6C"]);
    expect(st.phase).toBe("play");
    expect(st.hands[0].cards).toEqual(["5S", "7D"]);
    expect(st.dealer).toEqual(["9H", "6C"]);
    expect(st.revealed).toBe(false);
    expect(st.bankroll).toBe(DEFAULTS.starting_bankroll - DEFAULTS.min_bet);
    expect(st.handNo).toBe(1);
  });
  test("dealer stands on 17 and on soft 17 by default", () => {
    const st = apply(dealt(["10S", "AH", "8D", "6C"]), "stand");
    expect(st.phase).toBe("settled");
    expect(st.dealer).toEqual(["AH", "6C"]);
    expect(st.hands[0].outcome).toBe("win");
  });
  test("dealer hits soft 17 when the setting says so", () => {
    const s = { ...DEFAULTS, dealer_hits_soft_17: true };
    const st = apply(dealt(["10S", "AH", "8D", "6C", "5S", "9C"], s), "stand", s);
    expect(st.dealer).toEqual(["AH", "6C", "5S", "9C"]);
    expect(value(st.dealer).total).toBe(21);
    expect(st.hands[0].outcome).toBe("lose");
  });
  test("dealer draws to 17 and busts", () => {
    const st = apply(dealt(["10S", "9H", "8D", "6C", "KS"]), "stand");
    expect(st.dealer).toEqual(["9H", "6C", "KS"]);
    expect(st.hands[0].outcome).toBe("win");
    expect(st.bankroll).toBe(DEFAULTS.starting_bankroll + DEFAULTS.min_bet);
  });
  test("the dealer does not draw when every hand is bust", () => {
    const st = apply(dealt(["10S", "9H", "8D", "6C", "KS"]), "hit");
    expect(st.hands[0].outcome).toBe("bust");
    expect(st.dealer).toHaveLength(2);
    expect(st.revealed).toBe(true);
  });
});

describe("payouts", () => {
  test("blackjack pays 3:2 and ends the hand at once", () => {
    const st = dealt(["AS", "9H", "KD", "6C"]);
    expect(st.phase).toBe("settled");
    expect(st.hands[0].outcome).toBe("blackjack");
    expect(st.bankroll).toBe(DEFAULTS.starting_bankroll + 15);
    expect(st.stats).toMatchObject({ hands: 1, wins: 1, blackjacks: 1, net: 15 });
  });
  test("dealer blackjack takes the bet, both naturals push", () => {
    const lose = dealt(["5S", "AH", "7D", "KC"]);
    expect(lose.hands[0].outcome).toBe("lose");
    expect(lose.bankroll).toBe(DEFAULTS.starting_bankroll - 10);
    const push = dealt(["AS", "AH", "KD", "KC"]);
    expect(push.hands[0].outcome).toBe("push");
    expect(push.bankroll).toBe(DEFAULTS.starting_bankroll);
  });
  test("win pays even, push returns the bet, lose keeps it", () => {
    expect(apply(dealt(["10S", "9H", "9D", "8C"]), "stand").bankroll).toBe(1010);
    expect(apply(dealt(["10S", "9H", "7D", "8C"]), "stand").bankroll).toBe(1000);
    expect(apply(dealt(["10S", "9H", "6D", "8C"]), "stand").bankroll).toBe(990);
  });
  test("insurance, when offered: pays 2:1 on a dealer natural, lost otherwise", () => {
    const s = { ...DEFAULTS, insurance: true };
    const offered = dealt(["5S", "AH", "7D", "KC"], s);
    expect(offered.phase).toBe("insurance");
    const paid = apply(offered, "insure", s);
    expect(paid.phase).toBe("settled");
    expect(paid.bankroll).toBe(DEFAULTS.starting_bankroll - 10 - 5 + 15);
    const lost = apply(apply(dealt(["5S", "AH", "7D", "6C", "9S"], s), "insure", s), "stand", s);
    expect(lost.insurance).toBe(5);
    expect(lost.bankroll).toBe(DEFAULTS.starting_bankroll - 10 - 5);
    expect(dealt(["5S", "AH", "7D", "6C"]).phase).toBe("play");
  });
});

describe("double and split", () => {
  test("double takes one card, doubles the bet, and only on two cards with the chips", () => {
    const st = dealt(["5S", "9H", "6D", "6C", "9S", "KS"]);
    expect(canDouble(st)).toBe(true);
    const d = apply(st, "double");
    expect(d.hands[0]).toMatchObject({ cards: ["5S", "6D", "9S"], bet: 20, doubled: true, done: true });
    expect(d.phase).toBe("settled");
    expect(d.hands[0].outcome).toBe("win");
    expect(d.bankroll).toBe(1020);
    expect(canDouble(apply(dealt(["2S", "9H", "3D", "6C", "4S"]), "hit"))).toBe(false);
    const poor = { ...DEFAULTS, starting_bankroll: 15 };
    expect(canDouble(dealt(["5S", "9H", "6D", "6C"], poor))).toBe(false);
  });
  test("split once, each half plays, aces take one card", () => {
    const st = dealt(["8S", "9H", "8D", "8C", "3S", "5S", "10S"]);
    expect(canSplit(st)).toBe(true);
    const sp = apply(st, "split");
    expect(sp.hands.map((h) => h.cards)).toEqual([["8S", "3S"], ["8D", "5S"]]);
    expect(sp.bankroll).toBe(980);
    expect(canSplit(sp)).toBe(false);
    expect(sp.active).toBe(0);
    const h1 = apply(sp, "hit");
    expect(h1.hands[0].cards).toEqual(["8S", "3S", "10S"]);
    expect(h1.active).toBe(1);
    const done = apply(h1, "stand");
    expect(done.phase).toBe("settled");
    expect(done.hands.map((h) => h.outcome)).toEqual(["win", "lose"]);
    const aces = apply(dealt(["AS", "9H", "AD", "8C", "KS", "5S"]), "split");
    expect(aces.phase).toBe("settled");
    expect(aces.hands.map((h) => h.outcome)).toEqual(["win", "lose"]);
    expect(isBlackjack(aces.hands[0])).toBe(false);
    expect(canSplit(dealt(["8S", "9H", "7D", "7C"]))).toBe(false);
  });
});

describe("shoe, bets and moves out of turn", () => {
  test("the shoe is rebuilt before a deal once under a quarter is left", () => {
    let st = newGame(DEFAULTS, () => 0.5);
    st = { ...st, shoe: st.shoe.slice(0, Math.floor(RESHUFFLE_AT * 312) - 1) };
    const d = apply(st, "deal");
    expect(d.shoe.length).toBe(312 - 4);
    const fine = { ...st, shoe: newGame(DEFAULTS, () => 0.5).shoe.slice(0, 100) };
    expect(apply(fine, "deal").shoe.length).toBe(96);
  });
  test("a changed deck count rebuilds the shoe", () => {
    const st = newGame(DEFAULTS, () => 0.5);
    expect(apply(st, "deal", { ...DEFAULTS, decks: 2 }).shoe.length).toBe(104 - 4);
  });
  test("the bet moves by the minimum within the bankroll", () => {
    const st = newGame({ ...DEFAULTS, starting_bankroll: 25 }, () => 0.5);
    expect(apply(st, "bet-up").bet).toBe(20);
    expect(apply(apply(st, "bet-up"), "bet-up").bet).toBe(25);
    expect(apply(st, "bet-down").bet).toBe(10);
  });
  test("a move the phase does not allow is a no-op, and a broke table only starts over", () => {
    const st = newGame(DEFAULTS, () => 0.5);
    expect(apply(st, "hit")).toBe(st);
    expect(apply(st, "next")).toBe(st);
    const broke: State = { ...st, bankroll: 5 };
    expect(actions(broke)).toEqual(["new"]);
    expect(apply(broke, "deal")).toBe(broke);
    expect(apply(broke, "new").bankroll).toBe(DEFAULTS.starting_bankroll);
  });
  test("the legal moves per phase are what the view offers, Enter first", () => {
    expect(actions(newGame(DEFAULTS, () => 0.5))).toEqual(["deal", "bet-up", "bet-down", "new"]);
    expect(actions(dealt(["5S", "9H", "6D", "6C"]))).toEqual(["hit", "stand", "double", "new"]);
    expect(actions(dealt(["8S", "9H", "8D", "6C"]))).toEqual(["hit", "stand", "double", "split", "new"]);
    expect(actions(dealt(["AS", "9H", "KD", "6C"]))).toEqual(["next", "new"]);
  });
});

const find = (n: ViewNode, pred: (n: ViewNode) => boolean, out: ViewNode[] = []): ViewNode[] => {
  if (pred(n)) out.push(n);
  if (n.type === "stack") n.children.forEach((c) => find(c, pred, out));
  return out;
};

describe("render", () => {
  test("money formats whole dollars with a separator, cents only when there are any", () => {
    expect(money(1000)).toBe("$1,000");
    expect(money(22.5)).toBe("$22.50");
    expect(money(-10)).toBe("−$10");
  });
  test("the tree: dealer's hole face down until revealed, keyed cards, the legal actions with their keys", () => {
    const st = dealt(["5S", "9H", "7D", "6C"]);
    const v = render(st, DEFAULTS);
    expect(v.keys).toBe("actions");
    expect(v.title).toBe("Your turn");
    expect(v.actions.map((a) => [a.id, a.shortcut])).toEqual([["hit", "h"], ["stand", "s"], ["double", "d"], ["new", "n"]]);
    const images = find(v.tree, (n) => n.type === "image");
    expect(images).toHaveLength(4);
    expect(images.every((n) => n.type === "image" && n.src.startsWith("data:image/svg+xml") && n.width === 56 && n.height === 80)).toBe(true);
    expect(images.map((n) => n.key)).toEqual(["d0-1", "d-hole-1", "p-5S-1", "p-7D-1"]);
    expect(images[2].transition).toEqual({ enter: "slide-up", delay: 0, move: true });
    expect(find(v.tree, (n) => n.key === "felt")[0]).toMatchObject({ surface: "sunken", radius: true, padding: 3 });
    // A split carries the second card to the new hand under the same key, so it moves rather than re-enters; a same card again is numbered.
    const pair = apply(dealt(["8S", "9H", "8S", "6C", "3D", "4D"]), "split");
    expect(pair.hands.map((h) => h.cards)).toEqual([["8S", "3D"], ["8S", "4D"]]);
    const keys = find(render(pair, DEFAULTS).tree, (n) => n.type === "image").map((n) => n.key);
    expect(keys).toEqual(["d0-1", "d-hole-1", "p-8S-1", "p-3D-1", "p-8S#1-1", "p-4D-1"]);
    expect(find(render(dealt(["8S", "9H", "8S", "6C"]), DEFAULTS).tree, (n) => n.type === "image").map((n) => n.key)).toEqual(["d0-1", "d-hole-1", "p-8S-1", "p-8S#1-1"]);
    const hole = images[1] as Extract<ViewNode, { type: "image" }>;
    expect(hole.src).toBe(backSvg());
    expect(hole.transition).toEqual({ enter: "slide-up", exit: "none", delay: 3 });
    const badges = find(v.tree, (n) => n.type === "badge").map((n) => (n as { text: string }).text);
    expect(badges).toEqual(["9", "12"]);
    const stood = render(apply(st, "stand"), DEFAULTS);
    const flip = find(stood.tree, (n) => n.key === "d1-1")[0] as Extract<ViewNode, { type: "image" }>;
    expect(flip.transition).toEqual({ enter: "flip", delay: 0 });
    expect(flip.src).toBe(cardSvg("6C"));
    expect(stood.actions[0].id).toBe("next");
  });
  test("the bet phase shows the bet with its keys", () => {
    const v = render(newGame(DEFAULTS, () => 0.5), DEFAULTS);
    expect(v.title).toBe("Place your bet");
    expect(find(v.tree, (n) => n.type === "keycap").map((n) => (n as { keys: string }).keys)).toEqual(["-", "+", "enter"]);
    expect(v.actions.map((a) => a.shortcut)).toEqual(["enter", "+", "-", "n"]);
    expect(find(v.tree, (n) => n.type === "image")).toHaveLength(0);
    expect(find(v.tree, (n) => n.type === "progress")).toHaveLength(1);
  });
});

describe("over the wire", () => {
  let host: Host;
  beforeAll(async () => { stored.clear(); host = await Host.bundled(); });
  afterAll(() => host.kill());

  test("a view palette is input on the wire with view: view", async () => {
    const l = host.loaded().find((l) => l.extension === "blackjack")!;
    expect(l.palettes).toEqual([{ name: "blackjack", title: "Blackjack", live: false, input: true, icon: tile("red", "\u{f18a1}"), view: "view", ttl: undefined, detail: undefined, columns: undefined, placeholder: undefined, showDetail: undefined, filters: undefined }]);
  });
  test("list is refused, view answers the opening tree", async () => {
    await expect(host.request("list", { extension: "blackjack", palette: "blackjack" })).rejects.toThrow("view palette has no list");
    const v = await host.request<View>("view", { extension: "blackjack", palette: "blackjack" });
    expect(v.title).toBe("Place your bet");
    expect(v.actions[0]).toMatchObject({ id: "deal", shortcut: "enter" });
  });
  test("a pick answers the next tree and persists the state; an unknown action is a no-op", async () => {
    const r = await host.pick("blackjack", "blackjack", "view", "deal");
    const v = r.view as View;
    expect(["Your turn", "Blackjack!", "Dealer wins", "Push"]).toContain(v.title ?? "");
    expect(find(v.tree, (n) => n.type === "image").length).toBeGreaterThanOrEqual(4);
    const st = stored.get("blackjack\0state") as State;
    expect(st.handNo).toBe(1);
    const same = await host.pick("blackjack", "blackjack", "view", "hologram");
    expect((same.view as View).title).toBe(v.title);
    // The settings reach the game: a new game starts with the configured bankroll.
    host.changeSettings("blackjack", { settings: { starting_bankroll: 500 } });
    const fresh = await host.pick("blackjack", "blackjack", "view", "new");
    expect((stored.get("blackjack\0state") as State).bankroll).toBe(500);
    expect((fresh.view as View).title).toBe("Place your bet");
  });
});
