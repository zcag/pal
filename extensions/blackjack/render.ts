// The table as a view tree (`View` in host/src/protocol.ts): dealer's row,
// a message line, the player's hands, and a status line with the bet, the
// bankroll, the record and the shoe. Cards are keyed per deal and slot so
// a hit rises in, the hole card flips over, a split moves its card across,
// and a cleared table fades out; rows hold their height meanwhile. No host
// imports: the gallery renders a fixture state with this same function.
import { CARD_H, CARD_W, backSvg, cardSvg, type Card } from "./cards.ts";
import { actions as legal, canDouble, canSplit, isBlackjack, isBust, lastNet, value, type Action as Move, type Settings, type State } from "./game.ts";
import type { Action, View, ViewNode } from "../../host/src/protocol.ts";

/** Whole dollars as `$1,000`, cents only when there are any: a 3:2 blackjack on $15 pays $22.50. */
export const money = (n: number): string => {
  const abs = Math.abs(n);
  const s = Number.isInteger(abs) ? abs.toLocaleString("en-US") : abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? "−" : ""}$${s}`;
};
/** `+$25`, `−$10`, `$0`. */
const signed = (n: number) => (n > 0 ? `+${money(n)}` : money(n));

const MOVES: Record<Move, Action> = {
  deal: { id: "deal", title: "Deal", shortcut: "enter" },
  hit: { id: "hit", title: "Hit", shortcut: "h" },
  stand: { id: "stand", title: "Stand", shortcut: "s" },
  double: { id: "double", title: "Double down", shortcut: "d" },
  split: { id: "split", title: "Split", shortcut: "p" },
  insure: { id: "insure", title: "Take insurance", shortcut: "i" },
  decline: { id: "decline", title: "No insurance", shortcut: "enter" },
  next: { id: "next", title: "Next hand", shortcut: "enter" },
  "bet-up": { id: "bet-up", title: "Raise the bet", shortcut: "+" },
  "bet-down": { id: "bet-down", title: "Lower the bet", shortcut: "-" },
  new: { id: "new", title: "New game", shortcut: "n", confirm: "Start over with a fresh bankroll and stats?", style: "destructive" },
};

const text = (value: string, extra: Partial<Extract<ViewNode, { type: "text" }>> = {}): ViewNode => ({ type: "text", value, ...extra });
const row = (children: ViewNode[], extra: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", direction: "row", align: "center", gap: 2, ...extra, children });
const column = (children: ViewNode[], extra: Partial<Extract<ViewNode, { type: "stack" }>> = {}): ViewNode => ({ type: "stack", direction: "column", gap: 2, ...extra, children });

const card = (key: string, c: Card, delay = 0, enter: "slide-up" | "flip" = "slide-up"): ViewNode => ({ type: "image", key, src: cardSvg(c), width: CARD_W, height: CARD_H, alt: c, transition: { enter, delay } });
const back = (key: string, delay = 0): ViewNode => ({ type: "image", key, src: backSvg(), width: CARD_W, height: CARD_H, alt: "face down", transition: { enter: "slide-up", exit: "none", delay } });

/** `17`, `Soft 17`, `Blackjack`, `Bust`. */
const totalText = (cards: Card[], blackjack = false): string => {
  if (blackjack) return "Blackjack";
  const v = value(cards);
  if (v.total > 21) return "Bust";
  return v.soft && v.total !== 21 ? `Soft ${v.total}` : String(v.total);
};

const OUTCOME_TEXT = { blackjack: "Blackjack!", win: "You win", push: "Push", lose: "Dealer wins", bust: "Bust" } as const;
const OUTCOME_COLOR = { blackjack: "success", win: "success", push: "muted", lose: "destructive", bust: "destructive" } as const;

/** The one-line story of the hand for the message row and the title. */
function outcomeLine(st: State): { text: string; color: "success" | "destructive" | "muted" } {
  const net = lastNet(st);
  if (st.hands.length === 1) {
    const o = st.hands[0].outcome!;
    const dealerBust = o === "win" && isBust(st.dealer);
    return { text: `${dealerBust ? "Dealer busts" : OUTCOME_TEXT[o]}  ${signed(net)}`, color: OUTCOME_COLOR[o] };
  }
  const parts = st.hands.map((h, i) => `Hand ${i + 1} ${h.outcome === "push" ? "pushes" : h.outcome === "win" || h.outcome === "blackjack" ? "wins" : "loses"}`);
  return { text: `${parts.join(", ")}  ${signed(net)}`, color: net > 0 ? "success" : net < 0 ? "destructive" : "muted" };
}

/** Deal order: player, dealer, player, hole; a later card lands one step later. */
const dealDelay = (who: "p" | "d", index: number) => (index < 2 ? index * 2 + (who === "d" ? 1 : 0) : 0);

export function render(st: State, s: Settings): View {
  const no = st.handNo;
  // The hole card flips the moment it is revealed; the dealer's draws then land one step apart.
  const dealerCards: ViewNode[] = st.dealer.map((c, i) =>
    i === 1 && !st.revealed ? back(`d-hole-${no}`, dealDelay("d", i)) : i === 1 ? card(`d1-${no}`, c, 0, "flip") : card(`d${i}-${no}`, c, i === 0 ? dealDelay("d", 0) : i - 1),
  );
  const dealerShown = st.revealed ? st.dealer : st.dealer.slice(0, 1);
  const dealerTotal = st.dealer.length ? totalText(dealerShown, st.revealed && isBlackjack({ cards: st.dealer })) : "";

  const hands: ViewNode[] = st.hands.map((h, hi) => {
    const active = st.phase === "play" && hi === st.active;
    const cards = h.cards.map((c, i) => card(`p${hi}-${i}-${no}`, c, st.hands.length === 1 && i < 2 ? dealDelay("p", i) : 0));
    const label: ViewNode[] = [
      text(st.hands.length > 1 ? `Hand ${hi + 1}` : "You", { style: "muted", size: "xs", weight: "medium" }),
      { type: "badge", key: `t${hi}-${h.cards.map((c) => c).join("")}`, text: totalText(h.cards, isBlackjack(h)), color: isBust(h.cards) ? "red" : isBlackjack(h) ? "green" : active ? "blue" : "grey", transition: { enter: "fade" } },
      ...(h.doubled ? [{ type: "badge", text: "doubled", color: "amber" } as ViewNode] : []),
      ...(st.hands.length > 1 ? [text(money(h.bet), { style: "muted", size: "xs" })] : []),
    ];
    return column([row(label, { minHeight: 18, gap: 2 }), row(cards, { minHeight: CARD_H, gap: 1 })], { key: `hand${hi}`, gap: 1 });
  });

  // The middle line: the result, the insurance question, a bet prompt, or a hint.
  let title: string, middle: ViewNode[];
  const broke = st.bankroll < s.min_bet && st.phase !== "play" && st.phase !== "insurance";
  if (st.phase === "settled") {
    const o = outcomeLine(st);
    title = o.text.replace(/\s\s.*$/, "");
    middle = [text(o.text, { key: `result-${no}`, style: "title", color: o.color, transition: { enter: "slide-up" } })];
    if (broke) middle.push(text("Out of chips. N starts a new game.", { key: "broke", style: "muted", size: "sm", transition: { enter: "fade" } }));
  } else if (st.phase === "insurance") {
    title = "Insurance?";
    middle = [
      text(`Dealer shows an ace. Insurance costs ${money(st.hands[0].bet / 2)} and pays 2:1 on a dealer blackjack.`, { key: "ins", style: "body", transition: { enter: "fade" } }),
      row([{ type: "keycap", keys: "i" }, text("take it", { style: "muted", size: "sm" }), { type: "keycap", keys: "enter" }, text("play on", { style: "muted", size: "sm" })], { key: "ins-keys", gap: 1 }),
    ];
  } else if (st.phase === "bet") {
    if (broke) {
      title = "Out of chips";
      middle = [text("Out of chips", { key: "broke-title", style: "title", color: "destructive", transition: { enter: "fade" } }), row([{ type: "keycap", keys: "n" }, text("new game", { style: "muted", size: "sm" })], { key: "broke-keys", gap: 1 })];
    } else {
      title = "Place your bet";
      middle = [
        row([
          { type: "keycap", keys: "-" },
          text(money(st.bet), { key: "bet", style: "number", size: "xl" }),
          { type: "keycap", keys: "+" },
        ], { key: "bet-row", gap: 3, transition: { enter: "fade" } }),
        row([{ type: "keycap", keys: "enter" }, text("deal", { style: "muted", size: "sm" })], { key: "bet-keys", gap: 1 }),
      ];
    }
  } else {
    const h = st.hands[st.active];
    title = st.hands.length > 1 ? `Hand ${st.active + 1} of 2` : "Your turn";
    const keys: ViewNode[] = [{ type: "keycap", keys: "h" }, text("hit", { style: "muted", size: "sm" }), { type: "keycap", keys: "s" }, text("stand", { style: "muted", size: "sm" })];
    if (canDouble(st)) keys.push({ type: "keycap", keys: "d" }, text("double", { style: "muted", size: "sm" }));
    if (canSplit(st)) keys.push({ type: "keycap", keys: "p" }, text("split", { style: "muted", size: "sm" }));
    middle = [row(keys, { key: `keys-${h.cards.length}-${st.active}`, gap: 1, transition: { enter: "fade" } })];
  }

  const stats = st.stats;
  const rate = stats.hands ? Math.round((stats.wins / stats.hands) * 100) : 0;
  const shoeLeft = st.shoe.length / (st.decks * 52);
  const status = row(
    [
      text("Bet", { style: "muted", size: "xs" }),
      text(money(st.phase === "play" || st.phase === "insurance" || st.phase === "settled" ? st.hands.reduce((n, h) => n + h.bet, 0) : st.bet), { style: "number", size: "sm" }),
      { type: "divider" },
      text("Bankroll", { style: "muted", size: "xs" }),
      text(money(st.bankroll), { key: `bank-${st.bankroll}`, style: "number", size: "sm", transition: { enter: "fade" } }),
      { type: "divider" },
      text(stats.hands ? `${stats.hands} hand${stats.hands === 1 ? "" : "s"} · ${rate}% won · ${signed(stats.net)}` : "No hands yet", { style: "muted", size: "xs" }),
      { type: "spacer" },
      text("Shoe", { style: "muted", size: "xs" }),
      { type: "progress", value: shoeLeft, width: 72 },
    ],
    { gap: 2 },
  );

  const tree = column(
    [
      row([text("Dealer", { style: "muted", size: "xs", weight: "medium" }), ...(dealerTotal ? [{ type: "badge", key: `dt-${dealerTotal}-${no}`, text: dealerTotal, color: st.revealed && isBust(st.dealer) ? "red" : "grey", transition: { enter: "fade" } } as ViewNode] : [])], { key: "dealer-label", minHeight: 18 }),
      row(dealerCards, { key: "dealer-cards", minHeight: CARD_H, gap: 1 }),
      column(middle, { key: "middle", grow: true, align: "center", justify: "center", gap: 2, minHeight: 44 }),
      row(hands, { key: "hands", align: "start", gap: 5, minHeight: CARD_H + 22 }),
      status,
    ],
    { key: "table", padding: 4, gap: 2, grow: true },
  );

  return { tree, actions: legal(st, s).map((m) => MOVES[m]), title, keys: "actions" };
}
