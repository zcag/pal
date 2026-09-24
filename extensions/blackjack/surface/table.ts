// Draws a `State` on the felt. Cards and chips are sprites: absolutely
// placed elements keyed by what they are (the hole card, the second card
// of hand 2, the third chip of the bet), moved by a transform transition
// from where they were to where the new state puts them. A key that is
// new starts at its source (a card at the shoe, face down; a chip at the
// bankroll, or at the dealer's tray when it is a payout) and one that is
// gone leaves for its sink (the discard, the dealer, the bankroll), so a
// deal, a hit, a split, a settle and the sweep before the next hand are
// the same diff. The deal's order is the real one: player, dealer,
// player, hole. A hand's total counts a card the moment its face shows in
// the flip; what depends on the cards having landed (the result, the
// bankroll) is drawn once they have.
import { actions, isBlackjack, isBust, lastNet, value, type Action as Move, type Card, type Hand, type Settings, type State } from "../game.ts";
import { MOVES, chipsFor, keysOf, money, signed, titleOf } from "../moves.ts";

/** One step of the deal: the next card leaves the shoe this long after the last. */
const STEP = 170;
/** A card's flight, as `--fly` in table.css. */
const FLY = 460;
/** When a flip's face comes past edge-on: `.flip`'s 420 ms on `--ease` is half turned 55 ms in. */
const FACE_AT = 55;
const CARDS = "/__pal/cards/";
const BACK = `${CARDS}back-blue2.png`;

type Pose = { x: number; y: number; r?: number; k?: number; o?: number };
const transform = (p: Pose) => `translate(${p.x}px, ${p.y}px) rotate(${p.r ?? 0}deg) scale(${p.k ?? 1})`;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = (tag: string, cls: string, html = "") => { const e = document.createElement(tag); e.className = cls; e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Every card face and the back, fetched up front so a flip never shows a blank. */
export function preload(cards: Card[]) {
  for (const src of [BACK, ...cards.map((c) => `${CARDS}${c}.png`)]) new Image().src = src;
}

/** The felt's measures, from its size: cards as tall as two rows and the middle line allow. */
function geometry(W: number, H: number) {
  const ch = Math.round(Math.max(56, Math.min(150, (H - 112) / 2)));
  const cw = Math.round((ch * 14) / 19);
  const chip = Math.round(Math.max(24, Math.min(42, cw * 0.44)));
  const dealerY = 28;
  const playerY = H - 12 - ch;
  const midY = Math.round((dealerY + ch + playerY - 20) / 2);
  const shoeW = Math.round(cw * 0.66), shoeH = Math.round(ch * 0.52);
  return { W, H, cw, ch, chip, dealerY, playerY, midY, shoeW, shoeH, shoeX: W - shoeW - 12, shoeY: 24 };
}
type Geo = ReturnType<typeof geometry>;

/** A total as the badge says it: `17`, `Soft 17`, `Blackjack`, `Bust`. */
const totalText = (cards: Card[], blackjack = false): string => {
  if (blackjack) return "Blackjack";
  const v = value(cards);
  if (v.total > 21) return "Bust";
  return v.soft && v.total !== 21 ? `Soft ${v.total}` : String(v.total);
};

/**
 * Keys of the player's cards: the deal's two by their deal slot, so a
 * split carries the second to hand 2 under the same key and it slides
 * across; every later card by its hand and place. The deal number keeps
 * one hand's cards apart from the next's.
 */
function playerKey(hands: Hand[], hi: number, i: number, no: number): string {
  const split = hands.length > 1 || hands[hi].split;
  const slot = split ? (i === 0 ? `p${hi}` : `h${hi}-${i}`) : i < 2 ? `p${i}` : `h0-${i}`;
  return `${slot}#${no}`;
}

const GLYPH: Record<string, string> = { up: "↑", down: "↓", left: "←", right: "→", enter: "⏎", "-": "−" };
const cap = (k: string, alt = false) => `<kbd${alt ? ' class="alt"' : ""}>${esc(GLYPH[k] ?? k.toUpperCase())}</kbd>`;

/** A move's key caps: arrows first (the one-handed keys), letters marked `alt` so a narrow rail drops them; the primary move shows Enter too. */
export function capsOf(m: Move, primary: boolean): string {
  const keys = keysOf(m);
  const arrows = keys.filter((k) => GLYPH[k] && k !== "-" && k !== "enter");
  const rest = keys.filter((k) => !arrows.includes(k) && k !== "enter");
  const enter = primary || keys.includes("enter");
  return [...arrows.map((k) => cap(k)), ...rest.map((k) => cap(k, arrows.length > 0)), ...(enter ? [cap("enter")] : [])].join("");
}

/** The rail's order: the bet's minus before its plus, the moves as players read them. */
const RAIL: Move[] = ["bet-down", "bet-up", "deal", "hit", "stand", "double", "split", "insure", "decline", "next", "new"];

export class Table {
  private sprites = new Map<string, HTMLElement>();
  private geo!: Geo;
  private timers: number[] = [];
  private shownBank?: number;
  private overlay = el("div", "overlay");
  private labels = el("div", "overlay");

  constructor(private onMove: (m: Move) => void) {
    $("#felt").append(this.labels, this.overlay);
    // A button (or the corner's New game) runs its move; no button takes focus, so Enter stays the page's.
    document.addEventListener("mousedown", (e) => { if ((e.target as HTMLElement).closest("button")) e.preventDefault(); });
    document.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const b = t.closest<HTMLElement>("[data-move]");
      if (b) this.onMove(b.dataset.move as Move);
      // A chip on the betting spot adds one more minimum.
      else if (t.closest(".chip") && $("#felt").classList.contains("betting")) this.onMove("bet-up");
    });
  }

  /** Flashes the button of a move made from the keyboard, so a key reads as a press. */
  press(m: Move) {
    const b = document.querySelector(`#moves [data-move="${m}"], #new[data-move="${m}"]`);
    if (!b) return;
    b.classList.add("pressed");
    setTimeout(() => b.classList.remove("pressed"), 130);
  }

  /** Draws `st`; `prev` is what is on the table now (none on the first draw, which places everything without motion). */
  render(st: State, prev: State | undefined, s: Settings) {
    const felt = $("#felt");
    const g = (this.geo = geometry(felt.clientWidth, felt.clientHeight));
    felt.style.setProperty("--cw", `${g.cw}px`);
    felt.style.setProperty("--ch", `${g.ch}px`);
    felt.style.setProperty("--chip", `${g.chip}px`);
    this.timers.forEach(clearTimeout);
    this.timers = [];

    const no = st.handNo;
    const newDeal = !!prev && prev.handNo !== no && st.hands.length > 0;
    const shoe: Pose = { x: g.shoeX + g.shoeW / 2 - g.cw / 2, y: g.shoeY + g.shoeH / 2 - g.ch / 2, r: -12, k: 0.45 };
    const tray: Pose = { x: g.W / 2 - g.chip / 2, y: -g.chip * 2, o: 0 };
    const bank: Pose = { x: 30, y: g.H + g.chip, o: 0 };
    const seen = new Set<string>();
    const fresh: [HTMLElement, Pose][] = [];
    const moves: [HTMLElement, Pose, number][] = [];

    /** Places one sprite: created at `from` when new, then sent to `to` after `delay`. */
    const put = (key: string, make: () => HTMLElement, to: Pose, from: Pose, delay: number, z: number): { e: HTMLElement; isNew: boolean } => {
      seen.add(key);
      let e = this.sprites.get(key);
      const isNew = !e;
      if (!e) {
        e = make();
        e.classList.add("sprite");
        e.style.transform = transform(from);
        e.style.opacity = String(from.o ?? 1);
        $("#sprites").append(e);
        this.sprites.set(key, e);
        fresh.push([e, from]);
      }
      e.style.zIndex = String(z);
      moves.push([e, to, delay]);
      return { e, isNew };
    };

    // ---- cards: where each goes, and when it leaves the shoe ----
    type Spot = { key: string; card: Card; up: boolean; pose: Pose; z: number; who: "p" | "d"; slot: number; hand: string };
    const spots: Spot[] = [];
    const dealerOff = this.fan(st.dealer.length, g.W * 0.6);
    const dealerX = g.W / 2 - (g.cw + dealerOff * Math.max(0, st.dealer.length - 1)) / 2;
    st.dealer.forEach((c, i) => spots.push({ key: `d${i}#${no}`, card: c, up: i !== 1 || st.revealed, pose: { x: dealerX + i * dealerOff, y: g.dealerY }, z: 10 + i, who: "d", slot: i, hand: "d" }));
    const hands = this.handSpots(st);
    st.hands.forEach((h, hi) => h.cards.forEach((c, i) => spots.push({ key: playerKey(st.hands, hi, i, no), card: c, up: true, pose: { x: hands[hi].x + i * hands[hi].off, y: g.playerY }, z: 10 + i, who: "p", slot: i, hand: String(hi) })));

    // The timeline: a deal goes player, dealer, player, hole; otherwise a split's slide, the player's new cards, the hole's flip, the dealer's draws.
    let step = 0;
    const at = () => step * STEP;
    const delays = new Map<string, number>();
    let flipAt = 0, flipping = false;
    const has = (k: string) => this.sprites.has(k);
    if (newDeal) {
      const order = spots.filter((p) => p.slot < 2).sort((a, b) => a.slot - b.slot || (a.who === "p" ? -1 : 1));
      for (const p of order) { delays.set(p.key, at()); step++; }
    } else if (prev) {
      if (spots.some((p) => p.who === "p" && has(p.key) && prev.hands.length !== st.hands.length)) step++;
    }
    for (const p of spots) if (p.who === "p" && !delays.has(p.key) && !has(p.key)) { delays.set(p.key, at()); step++; }
    const hole = spots.find((p) => p.who === "d" && p.slot === 1);
    if (hole && st.revealed && (!prev || !prev.revealed || newDeal)) { flipAt = at() + (newDeal ? FLY - STEP : 0); flipping = true; step++; }
    for (const p of spots) if (p.who === "d" && !delays.has(p.key) && !has(p.key)) { delays.set(p.key, at() + (flipping ? 260 : 0)); step++; }
    const land = prev && (delays.size || flipping) ? Math.max(flipAt, ...delays.values()) + FLY : 0;
    const flips: [HTMLElement, boolean, number][] = [];
    /** When each card's face shows, per hand ("d", "0", "1"); a face-down card never. */
    const shows = new Map<string, number[]>();

    for (const p of spots) {
      const delay = delays.get(p.key) ?? 0;
      const { e, isNew } = put(p.key, () => this.cardEl(), p.pose, shoe, delay, p.z);
      const face = e.querySelector("img.face") as HTMLImageElement;
      if (p.up && !face.src.endsWith(`/${p.card}.png`)) face.src = `${CARDS}${p.card}.png`;
      // A new card turns face up in flight; the hole turns over where it lies.
      const flip = e.querySelector(".flip") as HTMLElement;
      const flipDelay = p === hole && flipping ? flipAt : delay + 90;
      if (p.up) (shows.get(p.hand) ?? shows.set(p.hand, []).get(p.hand)!).push(prev && (isNew || flip.classList.contains("down")) ? flipDelay + FACE_AT : 0);
      flips.push([flip, p.up, flipDelay]);
      e.dataset.hand = p.hand;
    }

    // ---- chips: the bet (a stack per hand, or the one in the middle while betting) and, once settled, what came back ----
    const stack = (prefix: string, amount: number, x: number, y: number, from: Pose, delay: number) =>
      chipsFor(amount).forEach((d, j) => {
        const { e } = put(`${prefix}-${j}`, () => el("div", "chip"), { x, y: y - j * 5 }, from, delay + j * 25, 30 + j);
        e.className = `chip sprite c${d}`;
        e.textContent = d >= 1000 ? `${d / 1000}K` : String(d);
      });
    const chipY = g.playerY + g.ch - g.chip - 4;
    if (st.phase === "bet") {
      if (st.bankroll >= s.min_bet) stack("b0", st.bet, g.W / 2 - g.chip / 2, g.playerY + g.ch / 2 - g.chip / 2, bank, 0);
    } else {
      st.hands.forEach((h, hi) => {
        const x = hands[hi].x - g.chip - 12;
        const lost = st.phase === "settled" && (h.outcome === "lose" || h.outcome === "bust");
        if (!lost) stack(`b${hi}`, h.bet, x, chipY, bank, 0);
        const won = (h.payout ?? 0) - h.bet;
        // The winnings land beside the bet, from the dealer's tray.
        if (st.phase === "settled" && won > 0) stack(`w${hi}`, won, Math.max(4, x - g.chip * 0.9), chipY + 2, tray, land);
      });
    }

    // ---- the rest leaves: cards to the discard, lost chips to the dealer, the rest to the bankroll ----
    let gone = 0;
    for (const [key, e] of this.sprites) {
      if (seen.has(key)) continue;
      const card = e.classList.contains("card");
      const to: Pose = card ? { x: -g.cw * 1.3, y: -g.ch * 0.3, r: -35, o: 0 } : st.phase === "settled" ? tray : bank;
      const delay = card ? gone++ * 30 : st.phase === "settled" ? land : 0;
      moves.push([e, to, delay]);
      delete e.dataset.hand;
      this.sprites.delete(key);
      setTimeout(() => e.remove(), delay + FLY + 300);
    }

    // Commit: new sprites are laid at their source first (one style flush), then everything moves at once.
    const layer = $("#sprites");
    if (!prev) layer.classList.add("instant");
    if (fresh.length) void layer.offsetWidth;
    for (const [e, to, delay] of moves) {
      e.style.setProperty("--delay", `${prev ? delay : 0}ms`);
      e.style.transform = transform(to);
      e.style.opacity = String(to.o ?? 1);
    }
    for (const [f, up, delay] of flips) {
      f.style.setProperty("--flip-delay", `${prev ? delay : 0}ms`);
      f.classList.toggle("down", !up);
    }
    if (!prev) { void layer.offsetWidth; layer.classList.remove("instant"); }

    felt.classList.toggle("betting", st.phase === "bet");
    this.drawShoe(st, g);
    this.drawPrint(s, g);
    this.drawRail(st, s);
    // A bust shakes the hand once its last card is down; the dealer's too.
    st.hands.forEach((h, hi) => { if (prev && isBust(h.cards) && !(prev.hands[hi] && isBust(prev.hands[hi].cards) && prev.handNo === no)) this.shake(String(hi), land); });
    if (prev && st.revealed && isBust(st.dealer) && !(prev.revealed && prev.handNo === no)) this.shake("d", land);
    // The totals follow the faces as they show; last hand's result and the bet's amount go at once; the rest waits for the cards.
    const count = (hand: string, t: number) => (shows.get(hand) ?? []).filter((at) => at <= t).length;
    const totals = (t: number) => this.drawLabels(st, hands, count("d", t), (hi) => count(String(hi), t));
    totals(0);
    for (const t of new Set([...shows.values()].flat().filter((t) => t > 0))) this.timers.push(window.setTimeout(() => totals(t), t));
    if (land) this.overlay.querySelectorAll(".banner, .pill, .amount").forEach((e) => e.remove());
    this.timers.push(window.setTimeout(() => this.drawLanded(st, s, hands), Math.max(0, land - 120)));
  }

  /** How far apart a fan's cards sit: half a card, less when that would pass `room`. */
  private fan(n: number, room: number) {
    const { cw } = this.geo;
    return n > 1 ? Math.min(cw * 0.5, (room - cw) / (n - 1)) : 0;
  }

  /** Each hand's first card's left edge and fan, centred under the dealer (one hand) or in its half (a split). */
  private handSpots(st: State) {
    const g = this.geo;
    const two = st.hands.length > 1;
    return st.hands.map((h, hi) => {
      const off = this.fan(h.cards.length, two ? g.W / 2 - g.chip - 48 : g.W * 0.55);
      const width = g.cw + off * Math.max(0, h.cards.length - 1);
      const centre = two ? (g.W / 2) * hi + g.W / 4 + (g.chip + 12) / 2 : g.W / 2;
      return { x: Math.round(centre - width / 2), off, centre };
    });
  }

  private cardEl() {
    return el("div", "card", `<div class="fx"><div class="flip down"><img class="face" alt=""><img class="back" alt="" src="${BACK}"></div></div>`);
  }

  private shake(hand: string, at: number) {
    for (const e of this.sprites.values()) if (e.dataset.hand === hand) e.querySelector(".fx")!.animate(
      [{ transform: "none" }, { transform: "translateX(-6px) rotate(-2deg)" }, { transform: "translateX(5px) rotate(1.5deg)" }, { transform: "translateX(-4px) rotate(-1deg)" }, { transform: "translateX(2px)" }, { transform: "none" }],
      { duration: 460, delay: at, easing: "ease-in-out" },
    );
  }

  /**
   * The hands' names and totals, counting only the cards whose face shows:
   * `dealer` of the dealer's face-up cards, `player(hi)` of hand hi's. A
   * hand with nothing showing yet has no label.
   */
  private drawLabels(st: State, hands: ReturnType<Table["handSpots"]>, dealer: number, player: (hi: number) => number) {
    const g = this.geo;
    const parts: string[] = [];
    // The dealer's face-up cards are the first one and, once revealed, the rest; the hole shows after the first.
    const up = st.revealed ? st.dealer : st.dealer.slice(0, 1);
    if (dealer) {
      const shown = up.slice(0, dealer);
      const bj = shown.length === st.dealer.length && st.revealed && isBlackjack({ cards: st.dealer });
      parts.push(`<div class="label" style="left:${g.W / 2}px;top:${g.dealerY - 22}px">Dealer <span class="total${isBust(shown) ? " bust" : bj ? " bj" : ""}">${totalText(shown, bj)}</span></div>`);
    }
    st.hands.forEach((h, hi) => {
      const n = player(hi);
      if (!n) return;
      const shown = h.cards.slice(0, n);
      const active = st.phase === "play" && hi === st.active && st.hands.length > 1;
      const idle = st.phase === "play" && st.hands.length > 1 && hi !== st.active;
      const bj = n === h.cards.length && isBlackjack(h);
      const name = st.hands.length > 1 ? `Hand ${hi + 1}` : "You";
      const tags = `${h.doubled ? '<span class="tag">×2</span>' : ""}${st.hands.length > 1 || h.doubled ? `<span>${money(h.bet)}</span>` : ""}`;
      parts.push(`<div class="label${active ? " active" : ""}${idle ? " idle" : ""}" style="left:${hands[hi].centre}px;top:${g.playerY - 22}px">${name} <span class="total${isBust(shown) ? " bust" : bj ? " bj" : ""}">${totalText(shown, bj)}</span>${tags}</div>`);
    });
    const html = parts.join("");
    if (this.labels.innerHTML !== html) this.labels.innerHTML = html;
  }

  /** What waits for the cards: the result (glow, dim, the pills, the banner), the bankroll. */
  private drawLanded(st: State, s: Settings, hands: ReturnType<Table["handSpots"]>) {
    const g = this.geo;
    const parts: string[] = [];
    const settled = st.phase === "settled";
    st.hands.forEach((h, hi) => {
      // A split's hands each get their result on the cards; one hand's is the banner.
      if (settled && h.outcome && st.hands.length > 1) {
        const net = (h.payout ?? 0) - h.bet;
        const cls = h.outcome === "blackjack" ? "bj" : h.outcome === "win" ? "win" : h.outcome === "push" ? "push" : "lose";
        const text = h.outcome === "push" ? "Push" : h.outcome === "bust" ? `Bust ${signed(net)}` : signed(net);
        parts.push(`<div class="pill ${cls}" style="left:${hands[hi].centre}px;top:${g.playerY + g.ch * 0.62}px">${text}</div>`);
      }
      for (const e of this.sprites.values()) if (e.dataset.hand === String(hi)) {
        const fx = e.querySelector(".fx")!;
        fx.classList.toggle("glow", settled && (h.outcome === "win" || h.outcome === "blackjack"));
        fx.classList.toggle("dim", settled && (h.outcome === "lose" || h.outcome === "bust"));
      }
    });
    for (const e of this.sprites.values()) if (e.dataset.hand === "d") e.querySelector(".fx")!.classList.toggle("dim", settled && st.revealed && isBust(st.dealer));

    // The middle line: the result, the insurance question, the bet, or nothing while the hand is played (the felt's print shows).
    const mid = `top:${g.midY}px`;
    if (settled) {
      const net = lastNet(st);
      const title = titleOf(st, s);
      const cls = net > 0 ? "win" : net < 0 ? "lose" : "";
      if (st.hands.length === 1 && st.hands[0].outcome === "blackjack") parts.push(`<div class="banner bj ${cls}" style="${mid}"><span class="word">Blackjack</span><span class="net">${signed(net)}</span></div>`);
      else parts.push(`<div class="banner ${cls}" style="${mid}">${esc(title)}<span class="net">${signed(net)}</span></div>`);
    } else if (st.phase === "insurance") {
      parts.push(`<div class="banner quiet" style="${mid}">Insurance? ${money(st.hands[0].bet / 2)}, pays 2 to 1 on a dealer blackjack</div>`);
    } else if (st.phase === "bet") {
      if (st.bankroll < s.min_bet) parts.push(`<div class="banner lose" style="${mid}">Out of chips</div>`);
      else parts.push(`<div class="amount" style="left:${g.W / 2}px;top:${g.playerY + g.ch / 2 + g.chip / 2 + 6}px">${money(st.bet)}</div>`);
    }
    $("#felt").classList.toggle("banner-up", parts.some((p) => p.startsWith('<div class="banner')));
    const html = parts.join("");
    if (this.overlay.innerHTML !== html) this.overlay.innerHTML = html;
    this.drawBank(st);
  }

  /** The bankroll counts to its new value, green going up, red going down; the record under it. */
  private drawBank(st: State) {
    const m = $("#bank .money");
    const from = this.shownBank ?? st.bankroll, to = st.bankroll;
    this.shownBank = to;
    const t0 = performance.now();
    m.classList.remove("up", "down");
    if (to !== from) m.classList.add(to > from ? "up" : "down");
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 550);
      m.textContent = money(k < 1 ? Math.round(from + (to - from) * (1 - (1 - k) ** 3)) : to);
      if (k < 1 && this.shownBank === to) requestAnimationFrame(tick);
      else if (k >= 1) setTimeout(() => m.classList.remove("up", "down"), 250);
    };
    requestAnimationFrame(tick);
    const r = st.stats;
    $("#bank .record").textContent = r.hands ? `${r.hands} hand${r.hands === 1 ? "" : "s"} · ${Math.round((r.wins / r.hands) * 100)}% won · ${signed(r.net)}` : "No hands yet";
  }

  /** The moves legal now as buttons with their keys; the first is Enter's and looks it. New game lives in the felt's corner unless it is the only move. */
  private drawRail(st: State, s: Settings) {
    const legal = actions(st, s);
    const shown = RAIL.filter((m) => legal.includes(m) && (m !== "new" || legal.length === 1));
    const html = shown.map((m) => {
      const primary = m === legal[0];
      return `<button class="btn${primary ? " primary" : ""}" type="button" tabindex="-1" data-move="${m}" title="${esc(MOVES[m].title)}">${esc(MOVES[m].label)}<span class="keys">${capsOf(m, primary)}</span></button>`;
    }).join("");
    const moves = $("#moves");
    if (moves.innerHTML !== html) moves.innerHTML = html;
    $("#new").style.display = legal.length === 1 && legal[0] === "new" ? "none" : "";
  }

  /** The shoe in the corner: a card back in a dark box, and what is left of it as a bar. */
  private drawShoe(st: State, g: Geo) {
    const box = $("#shoe");
    Object.assign(box.style, { left: `${g.shoeX}px`, top: `${g.shoeY}px`, width: `${g.shoeW}px`, height: `${g.shoeH}px` });
    if (!box.querySelector("img")) box.insertAdjacentHTML("afterbegin", `<img src="${BACK}" alt="">`);
    const img = box.querySelector("img")!;
    const w = g.shoeW * 0.72;
    Object.assign(img.style, { width: `${w}px`, height: `${(w * 19) / 14}px`, left: `${(g.shoeW - w) / 2}px`, top: `${-g.shoeH * 0.28}px`, transform: "rotate(-12deg)" });
    ($("#shoe .left i") as HTMLElement).style.width = `${Math.round((st.shoe.length / (st.decks * 52)) * 100)}%`;
  }

  /** The table's print, on an arc across the middle: the payout and the dealer's rule. */
  private drawPrint(s: Settings, g: Geo) {
    const svg = $("#print");
    const top = g.midY - 26, h = 60;
    Object.assign(svg.style, { top: `${top}px`, height: `${h}px` });
    svg.setAttribute("viewBox", `0 0 ${g.W} ${h}`);
    const arc = (y: number, sag: number) => `M ${g.W * 0.12} ${y} Q ${g.W / 2} ${y + sag} ${g.W * 0.88} ${y}`;
    const size = Math.max(9, Math.min(13, g.W / 52));
    const rule = `${s.dealer_hits_soft_17 ? "Dealer hits soft 17" : "Dealer stands on all 17s"}${s.insurance ? " · Insurance pays 2 to 1" : ""}`;
    svg.innerHTML =
      `<defs><path id="a1" d="${arc(18, 26)}"/><path id="a2" d="${arc(18 + size + 5, 26)}"/></defs>` +
      `<text font-size="${size}" text-anchor="middle"><textPath href="#a1" startOffset="50%">BLACKJACK PAYS 3 TO 2</textPath></text>` +
      `<text class="small" font-size="${size * 0.72}" text-anchor="middle"><textPath href="#a2" startOffset="50%">${esc(rule.toUpperCase())}</textPath></text>`;
  }
}
