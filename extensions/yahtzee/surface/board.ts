// Draws a `State`: the dice, the scorecard, the footer, the final score.
// The elements are made once and only their classes and text change, so a
// draw is cheap and every animation is a transform (WAAPI) or a class the
// stylesheet animates: a roll tumbles the free dice while their faces
// flicker, a score drops into its row while the total counts up to it, a
// Yahtzee makes the dice jump under a banner and a burst of confetti.
import { BONUS_AT, CATEGORIES, FIXED, LABELS, LOWER, UPPER, UPPER_BONUS, average, counted, gain, isOpen, isYahtzee, options, totals, type Category, type State } from "../game.ts";

/** Where the keys are: on a die, or on a category of the card. */
export type Cursor = { zone: "dice" | "card"; die: number; cat?: Category };

export type Handlers = { hold(die: number): void; roll(): void; score(cat: Category): void; point(cat: Category): void; again(): void };

const PLACES = ["tl", "tr", "ml", "c", "mr", "bl", "br"];
const PIPS: string[][] = [[], ["c"], ["tl", "br"], ["tl", "c", "br"], ["tl", "tr", "bl", "br"], ["tl", "tr", "c", "bl", "br"], ["tl", "tr", "ml", "mr", "bl", "br"]];
/** Pip centres in a 15 px mini die, for the upper rows' icons. */
const MINI: Record<string, [number, number]> = { tl: [4, 4], tr: [11, 4], ml: [4, 7.5], c: [7.5, 7.5], mr: [11, 7.5], bl: [4, 11], br: [11, 11] };
const CONFETTI = ["#f4c75a", "#e0584e", "#4f8ef7", "#3fbf7f", "#b36ae2", "#ff9f43"];

const $ = (id: string) => document.getElementById(id)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.append(e);
  return e;
}
const kbd = (k: string) => `<kbd>${k}</kbd>`;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Board {
  private dice: HTMLButtonElement[] = [];
  private faces: HTMLElement[] = [];
  private rows = new Map<Category, HTMLElement>();
  private bonus: HTMLElement;
  private roll = $("roll") as HTMLButtonElement;
  private total = 0;
  private counter = 0;
  /** Each tumbling die's throw; a die lands only if no later throw took it. */
  private tumbling = new Map<number, number>();
  private throws = 0;
  /** The state last drawn, what a die lands on. */
  private st?: State;

  constructor(on: Handlers) {
    const tray = $("tray");
    for (let i = 0; i < 5; i++) {
      const die = el("button", "die blank", tray);
      die.type = "button";
      die.tabIndex = -1;
      const body = el("div", "body", die);
      const face = el("div", "face", body);
      for (const p of PLACES) el("i", `pip ${p}`, face);
      el("span", "tag", die, "Held");
      die.addEventListener("click", () => on.hold(i));
      this.dice.push(die);
      this.faces.push(face);
    }
    const row = (col: HTMLElement, cat: Category) => {
      const r = el("div", "cat", col);
      const up = UPPER.indexOf(cat as (typeof UPPER)[number]);
      if (up >= 0) {
        const m = el("span", "mini", r);
        for (const p of PIPS[up + 1]) Object.assign(el("i", "", m).style, { left: `${MINI[p][0]}px`, top: `${MINI[p][1]}px` });
      }
      el("span", "lbl", r, LABELS[cat]);
      el("span", "val", r);
      el("kbd", "enter", r, "⏎");
      r.addEventListener("click", () => on.score(cat));
      r.addEventListener("mouseenter", () => on.point(cat));
      this.rows.set(cat, r);
    };
    for (const c of UPPER) row($("upper"), c);
    this.bonus = el("div", "cat bonus", $("upper"));
    this.bonus.innerHTML = `<span class="lbl">Bonus</span><span class="bar"><i class="ghost"></i><i class="fill"></i></span><span class="of"></span><span class="val"></span>`;
    this.bonus.title = `${UPPER_BONUS} more once the upper section reaches ${BONUS_AT}`;
    for (const c of LOWER) row($("lower"), c);
    this.roll.addEventListener("click", () => on.roll());
    $("again").addEventListener("click", () => on.again());
  }

  private face(i: number, v: number) {
    const f = this.faces[i];
    const on = PIPS[v] ?? [];
    for (const p of f.children) p.classList.toggle("on", on.includes((p as HTMLElement).classList[1]));
    f.classList.toggle("one", v === 1);
  }

  /** Draws `st`; `prev` says what just happened, for the animation it calls for. */
  render(st: State, cur: Cursor, prev?: State) {
    this.st = st;
    const opts = options(st);
    const t = totals(st);
    const rolled = !!prev && st.rolls > prev.rolls;
    const scored = prev && CATEGORIES.find((c) => isOpen(prev, c) && !isOpen(st, c));
    const picked = cur.zone === "card" && cur.cat && opts[cur.cat] !== undefined ? cur.cat : undefined;

    // The dice.
    const ring = picked && (opts[picked] ?? 0) > 0 ? counted(picked, st.dice) : [];
    const moving: number[] = [];
    st.dice.forEach((v, i) => {
      const d = this.dice[i];
      const fixed = st.rolls === 0 || st.rolls >= 3 || !!st.ended;
      if (rolled && !(prev!.rolls > 0 && prev!.held[i])) moving.push(i);
      d.classList.toggle("blank", v === 0 && !this.tumbling.has(i));
      d.classList.toggle("held", st.held[i] && st.rolls > 0);
      d.classList.toggle("fixed", fixed);
      d.classList.toggle("cur", cur.zone === "dice" && cur.die === i && !fixed);
      d.classList.toggle("counts", !!ring[i]);
      if (!this.tumbling.has(i)) this.face(i, v);
    });
    if (moving.length) this.tumble(moving, st);
    // Scored: the dice leave the tray and the empty slots settle in.
    if (scored && !reduced()) this.dice.forEach((d, i) => (d.querySelector(".body") as HTMLElement).animate([{ opacity: 0, transform: "scale(0.85)" }, { opacity: 1, transform: "none" }], { duration: 260, delay: i * 30, easing: "ease-out", fill: "backwards" }));

    // Roll: the dots are the rolls left.
    const left = st.ended ? 0 : 3 - st.rolls;
    this.roll.disabled = left === 0;
    this.roll.querySelector(".word")!.textContent = left === 0 ? "Pick a score" : "Roll";
    this.roll.querySelectorAll(".left i").forEach((d, k) => d.classList.toggle("used", k >= left));
    (this.roll.querySelector(".left") as HTMLElement).style.display = left === 0 ? "none" : "";

    // The card.
    for (const c of CATEGORIES) {
      const r = this.rows.get(c)!;
      const used = !isOpen(st, c);
      const o = opts[c];
      const v = used ? st.scores[c]! : o;
      r.classList.toggle("used", used);
      r.classList.toggle("opt", o !== undefined);
      r.classList.toggle("shut", !used && st.rolls > 0 && o === undefined);
      r.classList.toggle("zero", v === 0);
      r.classList.toggle("cur", c === picked);
      const val = r.querySelector(".val")!;
      const note = !used && o === undefined && st.rolls === 0 && FIXED[c] !== undefined;
      val.classList.toggle("note", note);
      val.textContent = v !== undefined ? String(v) : note ? String(FIXED[c]) : "";
      if (c === "yahtzee") {
        const lbl = r.querySelector(".lbl")!;
        lbl.innerHTML = LABELS.yahtzee + (st.bonuses ? `<span class="ybonus${prev && st.bonuses > prev.bonuses ? " new" : ""}">+${st.bonuses * 100}</span>` : "");
      }
      if (c === scored) this.replay(r, "scored");
    }
    // The upper bonus: the bar to 63, the part the picked box would add in a lighter shade.
    const ahead = picked && (UPPER as readonly string[]).includes(picked) ? opts[picked]! : 0;
    const reach = t.upper + UPPER.filter((c) => isOpen(st, c)).reduce((a, c) => a + (UPPER.indexOf(c as (typeof UPPER)[number]) + 1) * 5, 0);
    const won = t.upperBonus > 0;
    this.bonus.classList.toggle("won", won);
    this.bonus.classList.toggle("would", !won && t.upper + ahead >= BONUS_AT);
    this.bonus.classList.toggle("lost", !won && reach < BONUS_AT);
    (this.bonus.querySelector(".fill") as HTMLElement).style.width = `${Math.min(100, (t.upper / BONUS_AT) * 100)}%`;
    (this.bonus.querySelector(".ghost") as HTMLElement).style.width = `${Math.min(100, ((t.upper + ahead) / BONUS_AT) * 100)}%`;
    this.bonus.querySelector(".of")!.textContent = `${t.upper} / ${BONUS_AT}`;
    this.bonus.querySelector(".val")!.textContent = won || reach >= BONUS_AT ? String(UPPER_BONUS) : "0";
    if (won && prev && totals(prev).upperBonus === 0) this.replay(this.bonus, "scored");
    $("upper-sum").textContent = String(t.upper + t.upperBonus);
    $("lower-sum").textContent = String(t.lower + t.yahtzeeBonus);

    // The footer: the keys for this moment, the record, the total and what the picked box adds.
    $("hints").innerHTML = hints(st, cur);
    const r = st.record;
    $("record").innerHTML = r.games ? `Best ${r.best} · Avg ${average(r)}<span class="games"> · ${r.games} ${r.games === 1 ? "game" : "games"}</span>` : "";
    const g = picked ? gain(st, picked) : undefined;
    $("delta").textContent = g ? `+${g}` : "";
    this.count(t.total, !!prev);

    // Game over: the score in the stage, with the record.
    document.body.classList.toggle("over", !!st.ended);
    document.body.classList.toggle("newbest", !!st.ended?.best);
    if (st.ended) {
      $("facts").textContent = `Best ${r.best} · Average ${average(r)} · ${r.games} ${r.games === 1 ? "game" : "games"}`;
      if (prev && !prev.ended) this.countUp($("final"), 0, st.ended.total, 900);
      else $("final").textContent = String(st.ended.total);
      if (prev && !prev.ended && st.ended.best) setTimeout(() => this.burst(document.getElementById("final")!), 500);
    }
  }

  /** Restarts a class's animation on an element. */
  private replay(e: HTMLElement, cls: string) {
    e.classList.remove(cls);
    void e.offsetWidth;
    e.classList.add(cls);
  }

  /** The total counts to its new value; the first draw just sets it. */
  private count(to: number, animate: boolean) {
    if (to === this.total) return;
    const from = this.total;
    this.total = to;
    if (!animate || reduced()) { $("total").textContent = String(to); return; }
    this.countUp($("total"), from, to, 520);
  }
  private countUp(e: HTMLElement, from: number, to: number, ms: number) {
    const id = ++this.counter;
    const t0 = performance.now();
    const step = (now: number) => {
      if (e.id === "total" && id !== this.counter) return;
      const k = Math.min(1, (now - t0) / ms);
      e.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** The free dice thrown: each tumbles in from its side while its face flickers, and lands on the rolled value. */
  private tumble(which: number[], st: State) {
    const throwNo = ++this.throws;
    if (reduced()) { which.forEach((i) => this.face(i, st.dice[i])); return; }
    let longest = 0;
    for (const i of which) {
      this.dice[i].classList.remove("blank");
      const body = this.dice[i].querySelector(".body") as HTMLElement;
      const dx = (i - 2) * 10 + (Math.random() - 0.5) * 24;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (200 + Math.random() * 160);
      const ms = 560 + i * 45 + Math.random() * 90;
      longest = Math.max(longest, ms);
      body.getAnimations().forEach((a) => a.cancel());
      body.animate([
        { transform: `translate(${dx}px, -34px) rotate(${spin}deg) scale(0.86)` },
        { transform: `translate(${dx * 0.4}px, 0) rotate(${spin * 0.35}deg) scale(1)`, offset: 0.38 },
        { transform: `translate(${dx * 0.15}px, -9px) rotate(${spin * 0.12}deg)`, offset: 0.58 },
        { transform: `translate(0, 0) rotate(${spin * 0.03}deg)`, offset: 0.78 },
        { transform: "translate(0, -2px) rotate(0deg)", offset: 0.88 },
        { transform: "none" },
      ], { duration: ms, easing: "cubic-bezier(.25,.6,.35,1)" });
      this.tumbling.set(i, throwNo);
      const flick = setInterval(() => this.face(i, 1 + Math.floor(Math.random() * 6)), 65);
      setTimeout(() => {
        clearInterval(flick);
        if (this.tumbling.get(i) !== throwNo) return;
        this.tumbling.delete(i);
        const v = this.st!.dice[i];
        this.face(i, v);
        this.dice[i].classList.toggle("blank", v === 0);
      }, ms * 0.62);
    }
    if (isYahtzee(st.dice)) setTimeout(() => { if (throwNo === this.throws) this.yahtzee(st); }, longest + 60);
  }

  /** Five of a kind: the dice jump in a wave, the banner, the confetti. */
  private yahtzee(st: State) {
    this.dice.forEach((d, i) => (d.querySelector(".body") as HTMLElement).animate(
      [{ transform: "none" }, { transform: "translateY(-16px) rotate(-8deg) scale(1.06)", offset: 0.4 }, { transform: "translateY(0)", offset: 0.75 }, { transform: "translateY(-3px)", offset: 0.88 }, { transform: "none" }],
      { duration: 620, delay: i * 70, easing: "ease-out" },
    ));
    const joker = !isOpen(st, "yahtzee");
    this.banner(joker && st.scores.yahtzee === 50 ? `<span class="word">Yahtzee!</span> +100` : joker ? `<span class="word">Yahtzee!</span> as a Joker` : `<span class="word">Yahtzee!</span>`);
    this.burst($("tray"));
  }

  private banner(html: string) {
    const b = $("banner");
    b.innerHTML = html;
    b.getAnimations().forEach((a) => a.cancel());
    b.animate([
      { opacity: 0, transform: "translate(-50%, -50%) scale(0.4) rotate(-6deg)" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1.12) rotate(1deg)", offset: 0.14 },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.22 },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.85 },
      { opacity: 0, transform: "translate(-50%, -60%) scale(0.96)" },
    ], { duration: reduced() ? 1200 : 1900, easing: "ease-out" });
  }

  /** Confetti thrown up from an element's centre, falling under gravity. */
  burst(from: HTMLElement, n = 46) {
    if (reduced()) return;
    const fx = $("fx");
    const box = from.getBoundingClientRect();
    const x = box.left + box.width / 2, y = box.top + box.height / 2;
    for (let k = 0; k < n; k++) {
      const bit = el("i", "", fx);
      bit.style.background = CONFETTI[k % CONFETTI.length];
      if (k % 3 === 0) bit.style.borderRadius = "50%";
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = 110 + Math.random() * 190;
      const vx = Math.cos(a) * v, vy = Math.sin(a) * v;
      const spin = (Math.random() - 0.5) * 900;
      const frames = [...Array(9).keys()].map((s) => {
        const t = s / 8;
        return { transform: `translate(${x + vx * t * 1.4}px, ${y + vy * t * 1.4 + 420 * t * t}px) rotate(${spin * t}deg)`, opacity: t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3 };
      });
      bit.animate(frames, { duration: 1100 + Math.random() * 500, easing: "linear" }).finished.then(() => bit.remove(), () => bit.remove());
    }
  }

  /** Roll refused (none left): the button shakes its head. */
  nudge() { this.replay(this.roll, "nudge"); }
  press() { this.replay(this.roll, "pressed"); setTimeout(() => this.roll.classList.remove("pressed"), 120); }
}

/** The keys that do something now, the essentials first (`.opt` ones drop in compact). */
function hints(st: State, cur: Cursor): string {
  const h = (keys: string[], word: string, opt = false) => `<span class="h${opt ? " opt" : ""}">${keys.map(kbd).join("")} ${word}</span>`;
  if (st.ended) return h(["⏎"], "new game");
  if (st.rolls === 0) return [h(["space"], "roll"), h(["N"], "new game", true)].join("");
  const out: string[] = [];
  if (cur.zone === "card") {
    out.push(h(["↑", "↓", "←", "→"], "pick"), h(["⏎"], "score"));
    if (st.rolls < 3) out.push(h(["space"], "roll again", true));
  } else {
    out.push(h(["←", "→"], "die", true), h(["⏎", "1–5"], "hold"), h(["space"], "roll"), h(["↓"], "score"));
  }
  return out.join("");
}
