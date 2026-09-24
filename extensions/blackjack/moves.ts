// The moves as the table offers them, the words it says and the chips
// it stacks: one place for the extension (the view's actions, what cmd+k
// lists and the footer names) and the page (its buttons, their key
// hints, the keys it answers), pure so the host tests them. Types only from `@zcag/pal`: the page imports this file too,
// and the SDK's runtime half has no place in a browser.
import type { Action } from "@zcag/pal";
import { actions, isBust, type Action as Move, type Settings, type State } from "./game.ts";

/** Each move's view action; `label` is the page's button, shorter than the title cmd+k lists. */
export const MOVES: Record<Move, Action & { shortcut: string | string[]; label: string }> = {
  deal: { id: "deal", title: "Deal", label: "Deal", shortcut: "enter" },
  hit: { id: "hit", title: "Hit", label: "Hit", shortcut: ["h", "up"] },
  stand: { id: "stand", title: "Stand", label: "Stand", shortcut: ["s", "down"] },
  double: { id: "double", title: "Double down", label: "Double", shortcut: ["d", "right"] },
  split: { id: "split", title: "Split", label: "Split", shortcut: ["p", "left"] },
  insure: { id: "insure", title: "Take insurance", label: "Insure", shortcut: ["i", "up"] },
  decline: { id: "decline", title: "No insurance", label: "No thanks", shortcut: ["enter", "down"] },
  next: { id: "next", title: "Next hand", label: "Next hand", shortcut: "enter" },
  "bet-up": { id: "bet-up", title: "Raise the bet", label: "Raise", shortcut: ["+", "up"] },
  "bet-down": { id: "bet-down", title: "Lower the bet", label: "Lower", shortcut: ["-", "down"] },
  new: { id: "new", title: "New game", label: "New game", shortcut: "n", confirm: "Start over with a fresh bankroll and stats?", style: "destructive" },
};

export const keysOf = (m: Move): string[] => [MOVES[m].shortcut].flat();

/**
 * The move a key makes now: the first legal move that lists it, so `up`
 * raises the bet, hits or takes insurance by phase; Enter is the first
 * legal move (Deal, Hit, Next hand, No insurance), as the footer says.
 */
export function moveFor(key: string, st: State, s: Settings): Move | undefined {
  const legal = actions(st, s);
  if (key === "enter") return legal[0];
  return legal.find((m) => keysOf(m).includes(key));
}

/** The view's actions now: the legal moves, Enter's first. */
export const viewActions = (st: State, s: Settings): Action[] => actions(st, s).map((m) => { const { label: _, ...a } = MOVES[m]; return a; });

/** Whole dollars as `$1,000`, cents only when there are any: a 3:2 blackjack on $15 pays $22.50. */
export const money = (n: number): string => {
  const abs = Math.abs(n);
  const s = Number.isInteger(abs) ? abs.toLocaleString("en-US") : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}$${s}`;
};
/** `+$25`, `−$10`, `$0`. */
export const signed = (n: number) => (n > 0 ? `+${money(n)}` : money(n));

const OUTCOME = { blackjack: "Blackjack!", win: "You win", push: "Push", lose: "Dealer wins", bust: "Bust" } as const;

/** The phase in a few words, for the view's title line: `Place your bet`, `Hand 1 of 2`, `Dealer busts`. */
export function titleOf(st: State, s: Settings): string {
  const broke = st.bankroll < s.min_bet;
  switch (st.phase) {
    case "bet": return broke ? "Out of chips" : "Place your bet";
    case "insurance": return "Insurance?";
    case "play": return st.hands.length > 1 ? `Hand ${st.active + 1} of 2` : "Your turn";
    case "settled": {
      if (st.hands.length > 1) return st.hands.map((h, i) => `Hand ${i + 1} ${h.outcome === "push" ? "pushes" : h.outcome === "win" || h.outcome === "blackjack" ? "wins" : "loses"}`).join(", ");
      const o = st.hands[0].outcome!;
      return o === "win" && isBust(st.dealer) ? "Dealer busts" : OUTCOME[o];
    }
  }
}

const DENOMS = [1000, 500, 100, 25, 5, 1];
/** A stack shows this many chips at most; the amount beside it is exact. */
export const MAX_CHIPS = 6;

/** The chips a stack shows for an amount, largest at the bottom. */
export function chipsFor(amount: number): number[] {
  const out: number[] = [];
  let left = Math.floor(amount);
  for (const d of DENOMS) while (left >= d && out.length < MAX_CHIPS) { out.push(d); left -= d; }
  return out;
}
