// Blackjack: the rules (game.ts, pure) with a rigged shoe, the moves as
// the table offers them (moves.ts, shared by the view and the page), and
// the extension over the wire: a view palette's meta and its opening view,
// one `surface` with the legal moves as actions. The page itself
// (surface/) is browser code and is not run here.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tile } from "../../../sdk/src/icon.ts";
import { DEFAULTS, RESHUFFLE_AT, actions, apply, canDouble, canSplit, isBlackjack, newGame, shoe, value, type Settings, type State } from "../../../extensions/blackjack/game.ts";
import { type Card } from "../../../extensions/blackjack/game.ts";
import { MAX_CHIPS, chipsFor, money, moveFor, titleOf, viewActions } from "../../../extensions/blackjack/moves.ts";
import type { View } from "../../../sdk/src/protocol.ts";
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

describe("the moves as the table offers them", () => {
  test("money formats whole dollars with a separator, cents only when there are any", () => {
    expect(money(1000)).toBe("$1,000");
    expect(money(22.5)).toBe("$22.50");
    expect(money(-10)).toBe("−$10");
  });
  test("a key makes the first legal move that lists it; Enter makes the first legal move", () => {
    const bet = newGame(DEFAULTS, () => 0.5);
    expect(["up", "down", "+", "-", "enter", "h"].map((k) => moveFor(k, bet, DEFAULTS))).toEqual(["bet-up", "bet-down", "bet-up", "bet-down", "deal", undefined]);
    const play = dealt(["8S", "9H", "8D", "6C"]);
    expect(["up", "down", "right", "left", "enter", "h", "s", "d", "p", "n"].map((k) => moveFor(k, play, DEFAULTS))).toEqual(["hit", "stand", "double", "split", "hit", "hit", "stand", "double", "split", "new"]);
    const s = { ...DEFAULTS, insurance: true };
    const ins = dealt(["5S", "AH", "7D", "6C"], s);
    expect(["up", "i", "down", "enter"].map((k) => moveFor(k, ins, s))).toEqual(["insure", "insure", "decline", "decline"]);
    expect(moveFor("enter", { ...bet, bankroll: 5 }, DEFAULTS)).toBe("new");
  });
  test("the view's actions are the legal moves with their keys, Enter's first; the title is the phase", () => {
    const st = dealt(["5S", "9H", "7D", "6C"]);
    expect(viewActions(st, DEFAULTS).map((a) => [a.id, a.shortcut])).toEqual([["hit", ["h", "up"]], ["stand", ["s", "down"]], ["double", ["d", "right"]], ["new", "n"]]);
    expect(viewActions(st, DEFAULTS).some((a) => "label" in a)).toBe(false);
    expect(viewActions(newGame(DEFAULTS, () => 0.5), DEFAULTS).find((a) => a.id === "new")).toMatchObject({ confirm: expect.any(String), style: "destructive" });
    expect(titleOf(newGame(DEFAULTS, () => 0.5), DEFAULTS)).toBe("Place your bet");
    expect(titleOf(st, DEFAULTS)).toBe("Your turn");
    expect(titleOf(apply(dealt(["10S", "9H", "9D", "6C", "KS"]), "stand"), DEFAULTS)).toBe("Dealer busts");
    expect(titleOf(dealt(["AS", "9H", "KD", "6C"]), DEFAULTS)).toBe("Blackjack!");
    const split = apply(dealt(["8S", "9H", "8D", "8C", "3S", "5S"]), "split");
    expect(titleOf(split, DEFAULTS)).toBe("Hand 1 of 2");
    expect(titleOf(apply(apply(split, "stand"), "stand"), DEFAULTS)).toBe("Hand 1 loses, Hand 2 loses");
    expect(titleOf({ ...newGame(DEFAULTS, () => 0.5), bankroll: 5 }, DEFAULTS)).toBe("Out of chips");
  });
  test("a stack's chips: largest first, at most a few, cents left to the amount", () => {
    expect(chipsFor(10)).toEqual([5, 5]);
    expect(chipsFor(37.5)).toEqual([25, 5, 5, 1, 1]);
    expect(chipsFor(1130)).toEqual([1000, 100, 25, 5]);
    expect(chipsFor(990)).toHaveLength(MAX_CHIPS);
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
  test("list is refused; view answers the table: one surface, the legal moves, the phase", async () => {
    await expect(host.request("list", { extension: "blackjack", palette: "blackjack" })).rejects.toThrow("view palette has no list");
    const v = await host.request<View>("view", { extension: "blackjack", palette: "blackjack" });
    expect(v.tree).toMatchObject({ type: "surface", src: "surface/index.html" });
    expect(v.title).toBe("Place your bet");
    expect(v.actions.map((a) => a.id)).toEqual(["deal", "bet-up", "bet-down", "new"]);
    expect(v.actions[0]).toMatchObject({ id: "deal", shortcut: "enter" });
  });
  test("the view follows what the page saved: a hand in play, and settings for a fresh game", async () => {
    // The page saves under "state" after every move; the view is built from it.
    stored.set("blackjack\0state", dealt(["5S", "9H", "7D", "6C"]));
    const v = await host.request<View>("view", { extension: "blackjack", palette: "blackjack" });
    expect(v.title).toBe("Your turn");
    expect(v.actions.map((a) => a.id)).toEqual(["hit", "stand", "double", "new"]);
    stored.set("blackjack\0state", { from: "an older version" });
    // A store this version cannot read starts a fresh game, with the settings: a bankroll under the minimum can only start over.
    host.changeSettings("blackjack", { settings: { starting_bankroll: 10, min_bet: 25 } });
    const fresh = await host.request<View>("view", { extension: "blackjack", palette: "blackjack" });
    expect(fresh.title).toBe("Out of chips");
    expect(fresh.actions.map((a) => a.id)).toEqual(["new"]);
  });
  // `host.surfaceSend` comes with the surface infra; until that is merged this one is skipped.
  test.skipIf(!("surfaceSend" in Host.prototype))("the page's `moved` pushes the view's actions and title for the saved state", async () => {
    stored.set("blackjack\0state", dealt(["8S", "9H", "8D", "6C"]));
    const push = (host as unknown as { surfaceSend(ext: string, palette: string, msg: unknown): Promise<unknown> }).surfaceSend("blackjack", "blackjack", { moved: true });
    const u = await host.nextViewUpdate("blackjack", { palette: "blackjack" });
    await push;
    const spec = u.spec as View;
    expect(spec.title).toBe("Your turn");
    expect(spec.actions.map((a) => a.id)).toEqual(["hit", "stand", "double", "split", "new"]);
    expect(spec.tree).toMatchObject({ type: "surface", src: "surface/index.html" });
  });
});
