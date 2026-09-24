// The rules, pure: a `State` in, a `State` out, nothing else touched. The
// shoe is `decks` decks shuffled together and dealt from the end; it is
// rebuilt before a deal once under a quarter of it is left. Dealer stands
// on 17 (hits a soft 17 when the setting says so), blackjack pays 3:2,
// double on any first two cards (one card, then stand), split once (aces
// get one card each), insurance offered on an ace when enabled. Every move
// is `apply(state, action)`; a move the phase does not allow is a no-op,
// which is what a key pressed a beat too late should be.

export type Suit = "S" | "H" | "D" | "C";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
/** `AS`, `10H`: rank then suit, as the shoe and the store carry them, and as the kit's card pictures are named (`/__pal/cards/10H.png`). */
export type Card = `${Rank}${Suit}`;

export const RANKS: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const SUITS: Suit[] = ["S", "H", "D", "C"];
export const rankOf = (c: Card): Rank => c.slice(0, -1) as Rank;

export type Settings = { decks: number; starting_bankroll: number; dealer_hits_soft_17: boolean; min_bet: number; insurance: boolean };
export const DEFAULTS: Settings = { decks: 6, starting_bankroll: 1000, dealer_hits_soft_17: false, min_bet: 10, insurance: false };

export type Phase = "bet" | "insurance" | "play" | "settled";
export type Outcome = "blackjack" | "win" | "push" | "lose" | "bust";

export type Hand = {
  cards: Card[];
  bet: number;
  /** Doubled, stood or bust: no more cards. */
  done: boolean;
  doubled: boolean;
  /** One of a split pair: no blackjack, aces take one card. */
  split: boolean;
  outcome?: Outcome;
  /** What came back for this hand, bet included (0 on a loss). */
  payout?: number;
};

export type Stats = { hands: number; wins: number; losses: number; pushes: number; blackjacks: number; net: number };

export type State = {
  shoe: Card[];
  /** Decks the shoe was built from; a settings change rebuilds it at the next deal. */
  decks: number;
  phase: Phase;
  hands: Hand[];
  /** Index of the hand being played. */
  active: number;
  dealer: Card[];
  /** The hole card is face down until the dealer plays. */
  revealed: boolean;
  bet: number;
  bankroll: number;
  /** Insurance paid, this hand. */
  insurance: number;
  stats: Stats;
  /** Counts up per deal; keys the cards of one hand apart from the last one's. */
  handNo: number;
};

export type Action = "deal" | "hit" | "stand" | "double" | "split" | "insure" | "decline" | "next" | "bet-up" | "bet-down" | "new";

export type Rng = () => number;

/** Cut off: the shoe is rebuilt before a deal once fewer than this share of its cards is left. */
export const RESHUFFLE_AT = 0.25;

export function shoe(decks: number, rng: Rng = Math.random): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) cards.push(`${r}${s}`);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export const cardValue = (c: Card): number => {
  const r = rankOf(c);
  return r === "A" ? 11 : r === "J" || r === "Q" || r === "K" ? 10 : Number(r);
};

/** Best total, and whether an ace still counts eleven in it (soft). */
export function value(cards: Card[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (rankOf(c) === "A") aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export const total = (cards: Card[]) => value(cards).total;
export const isBust = (cards: Card[]) => total(cards) > 21;
/** A natural: 21 on the first two cards, not after a split. */
export const isBlackjack = (h: { cards: Card[]; split?: boolean }) => h.cards.length === 2 && !h.split && total(h.cards) === 21;

const stats0: Stats = { hands: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, net: 0 };

export function newGame(s: Settings = DEFAULTS, rng: Rng = Math.random): State {
  return { shoe: shoe(s.decks, rng), decks: s.decks, phase: "bet", hands: [], active: 0, dealer: [], revealed: false, bet: s.min_bet, bankroll: s.starting_bankroll, insurance: 0, stats: { ...stats0 }, handNo: 0 };
}

/** Legal moves now, in the order the view lists them (first is Enter). */
export function actions(st: State, s: Settings = DEFAULTS): Action[] {
  const broke = st.bankroll < s.min_bet;
  switch (st.phase) {
    case "bet": return broke ? ["new"] : ["deal", "bet-up", "bet-down", "new"];
    case "insurance": return ["decline", "insure", "new"];
    case "play": {
      const a: Action[] = ["hit", "stand"];
      if (canDouble(st)) a.push("double");
      if (canSplit(st)) a.push("split");
      return [...a, "new"];
    }
    case "settled": return broke ? ["new"] : ["next", "new"];
  }
}

export function canDouble(st: State): boolean {
  const h = st.hands[st.active];
  return st.phase === "play" && !!h && !h.done && h.cards.length === 2 && st.bankroll >= h.bet;
}

export function canSplit(st: State): boolean {
  const h = st.hands[st.active];
  return st.phase === "play" && !!h && !h.done && st.hands.length === 1 && h.cards.length === 2 && cardValue(h.cards[0]) === cardValue(h.cards[1]) && st.bankroll >= h.bet;
}

const draw = (st: State): Card => {
  const c = st.shoe.pop();
  if (!c) throw new Error("the shoe is empty");
  return c;
};

const clone = (st: State): State => ({ ...st, shoe: [...st.shoe], hands: st.hands.map((h) => ({ ...h, cards: [...h.cards] })), dealer: [...st.dealer], stats: { ...st.stats } });

/** The bet clamped to what the bankroll allows, in steps of the minimum. */
export function clampBet(bet: number, bankroll: number, s: Settings): number {
  if (bankroll < s.min_bet) return s.min_bet;
  return Math.max(s.min_bet, Math.min(bet, bankroll));
}

export function apply(state: State, action: Action, s: Settings = DEFAULTS, rng: Rng = Math.random): State {
  if (!actions(state, s).includes(action)) return state;
  const st = clone(state);
  switch (action) {
    case "new": return newGame(s, rng);
    case "bet-up": st.bet = clampBet(st.bet + s.min_bet, st.bankroll, s); return st;
    case "bet-down": st.bet = clampBet(st.bet - s.min_bet, st.bankroll, s); return st;
    case "deal": return deal(st, s, rng);
    case "insure": st.bankroll -= st.hands[0].bet / 2; st.insurance = st.hands[0].bet / 2; return afterInsurance(st);
    case "decline": return afterInsurance(st);
    case "hit": {
      const h = st.hands[st.active];
      h.cards.push(draw(st));
      if (isBust(h.cards) || total(h.cards) === 21) h.done = true;
      return advance(st, s);
    }
    case "stand": st.hands[st.active].done = true; return advance(st, s);
    case "double": {
      const h = st.hands[st.active];
      st.bankroll -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(draw(st));
      h.done = true;
      return advance(st, s);
    }
    case "split": {
      const h = st.hands[0];
      st.bankroll -= h.bet;
      const second: Hand = { cards: [h.cards[1]], bet: h.bet, done: false, doubled: false, split: true };
      h.cards = [h.cards[0]];
      h.split = true;
      st.hands = [h, second];
      // Each half draws its second card; split aces get that one card and stand.
      for (const half of st.hands) {
        half.cards.push(draw(st));
        if (rankOf(half.cards[0]) === "A" || total(half.cards) === 21) half.done = true;
      }
      st.active = 0;
      return advance(st, s);
    }
    case "next": {
      st.phase = "bet";
      st.hands = [];
      st.dealer = [];
      st.revealed = false;
      st.insurance = 0;
      st.bet = clampBet(st.bet, st.bankroll, s);
      return st;
    }
  }
}

function deal(st: State, s: Settings, rng: Rng): State {
  if (st.decks !== s.decks || st.shoe.length < RESHUFFLE_AT * s.decks * 52) {
    st.shoe = shoe(s.decks, rng);
    st.decks = s.decks;
  }
  st.bet = clampBet(st.bet, st.bankroll, s);
  st.bankroll -= st.bet;
  st.handNo++;
  st.hands = [{ cards: [], bet: st.bet, done: false, doubled: false, split: false }];
  st.dealer = [];
  st.active = 0;
  st.revealed = false;
  st.insurance = 0;
  st.hands[0].cards.push(draw(st));
  st.dealer.push(draw(st));
  st.hands[0].cards.push(draw(st));
  st.dealer.push(draw(st));
  if (rankOf(st.dealer[0]) === "A" && s.insurance && st.bankroll >= st.bet / 2) {
    st.phase = "insurance";
    return st;
  }
  return afterInsurance(st);
}

/** The naturals: a dealer blackjack (peeked at under an ace or a ten) or the player's ends the hand at once. */
function afterInsurance(st: State): State {
  const dealerBj = isBlackjack({ cards: st.dealer });
  if (dealerBj) {
    st.hands[0].done = true;
    return settle(st);
  }
  if (isBlackjack(st.hands[0])) {
    st.hands[0].done = true;
    return settle(st);
  }
  st.phase = "play";
  return st;
}

/** To the next hand still open, else the dealer plays out. */
function advance(st: State, s: Settings): State {
  st.phase = "play";
  const next = st.hands.findIndex((h, i) => i > st.active && !h.done);
  if (!st.hands[st.active].done) return st;
  if (next >= 0) {
    st.active = next;
    return st;
  }
  return dealerPlay(st, s);
}

/** Reveal, then draw to 17; nothing to draw for when every hand is bust. */
function dealerPlay(st: State, s: Settings): State {
  st.revealed = true;
  if (st.hands.some((h) => !isBust(h.cards))) {
    for (;;) {
      const v = value(st.dealer);
      if (v.total > 17 || (v.total === 17 && !(v.soft && s.dealer_hits_soft_17))) break;
      st.dealer.push(draw(st));
    }
  }
  return settle(st);
}

/** Outcomes and payouts per hand, the bankroll and the stats. */
function settle(st: State): State {
  st.revealed = true;
  st.phase = "settled";
  const dealerBj = isBlackjack({ cards: st.dealer });
  const dv = total(st.dealer);
  if (st.insurance > 0 && dealerBj) st.bankroll += st.insurance * 3;
  for (const h of st.hands) {
    const pv = total(h.cards);
    let outcome: Outcome;
    if (pv > 21) outcome = "bust";
    else if (isBlackjack(h)) outcome = dealerBj ? "push" : "blackjack";
    else if (dealerBj || (dv <= 21 && dv > pv)) outcome = "lose";
    else if (dv > 21 || pv > dv) outcome = "win";
    else outcome = "push";
    h.outcome = outcome;
    h.payout = outcome === "blackjack" ? h.bet * 2.5 : outcome === "win" ? h.bet * 2 : outcome === "push" ? h.bet : 0;
    h.done = true;
    st.bankroll += h.payout;
    st.stats.hands++;
    if (outcome === "blackjack") { st.stats.blackjacks++; st.stats.wins++; }
    else if (outcome === "win") st.stats.wins++;
    else if (outcome === "push") st.stats.pushes++;
    else st.stats.losses++;
    st.stats.net += h.payout - h.bet;
  }
  st.stats.net -= st.insurance > 0 && !dealerBj ? st.insurance : 0;
  st.stats.net += st.insurance > 0 && dealerBj ? st.insurance * 2 : 0;
  return st;
}

/** Net of the last hand for the message: payouts less bets, insurance included. */
export function lastNet(st: State): number {
  const dealerBj = isBlackjack({ cards: st.dealer });
  const hands = st.hands.reduce((n, h) => n + (h.payout ?? 0) - h.bet, 0);
  return hands + (st.insurance > 0 ? (dealerBj ? st.insurance * 2 : -st.insurance) : 0);
}

/** Whether `x` is a state this version can play on; a store from another version starts over. */
export function isState(x: unknown): x is State {
  const s = x as State;
  return !!s && typeof s === "object" && Array.isArray(s.shoe) && Array.isArray(s.hands) && Array.isArray(s.dealer)
    && ["bet", "insurance", "play", "settled"].includes(s.phase) && typeof s.bankroll === "number" && typeof s.bet === "number" && !!s.stats && typeof s.handNo === "number";
}
