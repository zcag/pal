// Solitaire's page: the table drawn from the pure state (../game.ts, the
// only rules), played with the mouse or one-handed on the keys. Each of
// the 52 cards is one element for the whole session, placed by a
// transform (layout.ts says where), so a card that changes place glides
// there by a CSS transition whatever moved it: a drop, a drag's release or
// its snap back, an undo, the finish. A card turned over flips (the
// element's two faces, rotated), the deal gathers the cards on the stock
// and sends them out row by row, a win bounces them off the foundations
// leaving trails on a canvas.
//
// The state persists whole in the extension's storage (`state`, the key
// the host side's storage reads) after every change, so Escape mid-game
// loses nothing. The clock counts only while the page is shown: the time
// since it was shown (or since the last change) is folded in at every
// change and when it is hidden.
import { DEFAULTS, F, RANKS, SUITS, SUIT_GLYPH, STOCK, WASTE, apply, canFinish, clock, finishStep, headline, isFoundation, isState, newGame, play, refusal, run, running, suitOf, type Action, type Card, type Settings, type State } from "../game.ts";
import { dropBox, geometry, layout, overlap, slot, topBox, type Box, type Layout } from "./layout.ts";
import type { SurfaceKit } from "@zcag/pal";

declare const pal: SurfaceKit;

const KEY = "state";
/** A card's glide (style.css `--move`); the deal's step between two cards; the finish's between two cards home. */
const MOVE = 240, DEAL_STEP = 34, FINISH_STEP = 110;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const root = document.documentElement, body = document.body;
body.classList.add("kbd");
const table = $("table"), felt = $("felt"), rail = $("rail"), dialog = $("dialog"), canvas = $<HTMLCanvasElement>("cascade");
const div = (cls: string, parent: HTMLElement = table) => {
  const el = document.createElement("div");
  el.className = cls;
  parent.append(el);
  return el;
};
const at = (el: HTMLElement, b: { x: number; y: number }) => (el.style.transform = `translate(${b.x}px, ${b.y}px)`);
const box = (el: HTMLElement, b: Box) => Object.assign(el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });

let st: State;
let settings: Settings = DEFAULTS;
let lay: Layout;

// ---- the elements ------------------------------------------------------------

/** The thirteen places, by pile index: the stock, the waste, the foundations, the tableau. */
const slots = Array.from({ length: 13 }, (_, p) => {
  const el = div(`slot${p === STOCK ? " stock" : ""}`);
  el.dataset.pile = String(p);
  if (isFoundation(p)) el.textContent = SUIT_GLYPH[SUITS[p - 2]];
  return el;
});
const glows = Array.from({ length: 13 }, () => div("glow"));
const ring = div("ring");
ring.id = "ring";

const cards = new Map<Card, HTMLElement>();
const fronts = new Map<Card, HTMLImageElement>();
for (const s of SUITS) for (const r of RANKS) {
  const c: Card = `${r}${s}`;
  const el = div("card down");
  el.dataset.card = c;
  el.innerHTML = `<div class="inner"><img class="front" alt="" src="/__pal/cards/${c}.png"><img class="back" alt="" src="/__pal/cards/back-blue2.png"></div>`;
  cards.set(c, el);
  fronts.set(c, el.querySelector("img")!);
}
/** Each card's pending "land" (its stacking order restored once the glide is over). */
const landing = new Map<Card, ReturnType<typeof setTimeout>>();

// ---- the clock ------------------------------------------------------------------

/** When the clock last (re)started; unset while the page is hidden. */
let since: number | undefined = Date.now();
const elapsed = () => st.elapsed + (since !== undefined && running(st) ? Date.now() - since : 0);
/** The time since `since` into the state; the clock restarts from now. */
function fold() {
  st = { ...st, elapsed: elapsed() };
  if (since !== undefined) since = Date.now();
}
let tick: ReturnType<typeof setInterval> | undefined;
const startTick = () => (tick ??= setInterval(() => ($("time").textContent = clock(elapsed())), 1000));

// ---- drawing --------------------------------------------------------------------

type Draw = { instant?: boolean; delays?: Map<Card, number>; flipAfter?: number };

/** The pile a card is in, and how many cards a pick-up there takes (none for a face-down card, or one under the top of the waste or a foundation). */
function locate(s: State, c: Card): { pile: number; count: number } {
  if (s.stock.includes(c)) return { pile: STOCK, count: 0 };
  const top = (cs: Card[]) => (cs.at(-1) === c ? 1 : 0);
  if (s.waste.includes(c)) return { pile: WASTE, count: top(s.waste) };
  const f = s.foundations.findIndex((cs) => cs.includes(c));
  if (f >= 0) return { pile: F(f), count: top(s.foundations[f]) };
  const t = s.tableau.findIndex((p) => p.down.includes(c) || p.up.includes(c));
  const up = s.tableau[t].up.indexOf(c);
  return { pile: 6 + t, count: up < 0 ? 0 : s.tableau[t].up.length - up };
}

/** Where `cards` (from pile `from`) can go: the tableau piles that take them, and their own foundation. */
function targets(from: number, cs: Card[]): number[] {
  const out: number[] = [];
  for (let p = 2; p < 13; p++) {
    if (p === from || refusal(st, cs, p)) continue;
    if (!isFoundation(p) || p === F(SUITS.indexOf(suitOf(cs[0])))) out.push(p);
  }
  return out;
}

function glow(on: number[], hot?: number) {
  glows.forEach((el, p) => {
    const lit = on.includes(p);
    el.classList.toggle("on", lit);
    el.classList.toggle("hot", lit && p === hot);
    if (lit) box(el, topBox(lay, st, p));
  });
}

let shownTitle = "";
function draw(o: Draw = {}) {
  lay = layout(st, geometry(innerWidth, innerHeight, st));
  const { g } = lay;
  root.style.setProperty("--cw", `${g.w}px`);
  root.style.setProperty("--ch", `${g.h}px`);
  box(felt, g.felt);
  box(rail, g.rail);
  box(dialog, g.felt);
  slots.forEach((el, p) => at(el, slot(g, p)));
  slots[STOCK].textContent = st.waste.length ? "↻" : "";

  for (const [c, to] of lay.cards) {
    const el = cards.get(c)!;
    if (grab?.dragging && grab.cards.includes(c)) continue;
    const where = `${to.x},${to.y}`, moved = el.dataset.at !== where;
    const { pile, count } = locate(st, c);
    el.dataset.at = where;
    el.dataset.z = String(to.z);
    el.classList.toggle("down", !to.up);
    el.classList.toggle("lifted", to.lifted);
    el.classList.toggle("can", count > 0 && !st.won);
    el.classList.toggle("stock", pile === STOCK);
    // A card under another on the waste or a foundation casts no shadow: a dozen stacked would draw a dark edge.
    el.classList.toggle("flat", (pile === WASTE || isFoundation(pile)) && !count);
    const d = o.delays?.get(c) ?? 0;
    el.style.setProperty("--d", `${d}ms`);
    el.style.setProperty("--fd", `${d + (o.flipAfter ?? 0)}ms`);
    at(el, to);
    // A card on its way flies over the others, and takes its place in the pile when it lands.
    if (moved && !o.instant) {
      el.style.zIndex = String(2000 + to.z);
      clearTimeout(landing.get(c));
      landing.set(c, setTimeout(() => { el.style.zIndex = el.dataset.z!; landing.delete(c); }, MOVE + d + 40));
    } else if (!landing.has(c)) el.style.zIndex = String(to.z);
  }

  ring.classList.toggle("off", !lay.ring || !!grab?.dragging);
  if (lay.ring) box(ring, { x: lay.ring.x - 3, y: lay.ring.y - 3, w: lay.ring.w + 6, h: lay.ring.h + 6 });
  if (!grab?.dragging) glow(st.held ? targets(st.held.from, run(st, st.held.from, st.held.count)).filter((p) => p !== st.cursor) : []);
  status();
}

const keycaps = (keys: string[], what: string) => `<li>${keys.map((k) => `<kbd>${k}</kbd>`).join("")}<span>${what}</span></li>`;
function status() {
  $("moves").textContent = String(st.moves);
  $("time").textContent = clock(elapsed());
  const { played, won } = st.stats;
  $("record").textContent = played ? `${won} of ${played}` : "none yet";
  $("home").style.width = `${(st.foundations.reduce((n, f) => n + f.length, 0) / 52) * 100}%`;
  $("draw").textContent = `Draw ${st.draw}`;
  const enter = st.held ? (st.cursor === st.held.from ? "send" : "drop") : st.cursor === STOCK ? "draw" : "pick up";
  const keys = st.won
    ? keycaps(["⏎"], "new game")
    : [keycaps(["←", "→"], "pile"), keycaps(["↑", "↓"], "cards"), keycaps(["⏎"], enter), keycaps(["␣"], "draw"), keycaps(["U"], "undo"), keycaps(["N"], "new game")].join("");
  const list = $("keys");
  if (list.innerHTML !== keys) list.innerHTML = keys;
  const t = headline(st);
  if (t !== shownTitle) pal.title((shownTitle = t));
}

/** Everything in place at once: the first frame, a resize. */
function snap() {
  body.classList.add("instant");
  draw({ instant: true });
  void body.offsetWidth;
  body.classList.remove("instant");
}

// ---- changing the state ---------------------------------------------------------

const save = () => pal.storage.set(KEY, st).catch(() => {});

/** The one way the state changes: the clock folded in, the change made, stored, drawn, then what follows it (the finish, the win). */
function update(f: (s: State) => State, o: Draw = {}) {
  fold();
  const before = st, next = f(st);
  if (next === st) return;
  st = next;
  save();
  draw(o);
  if (canFinish(st)) finishSoon();
  if (st.won && !before.won) celebrate();
}

let finishing: ReturnType<typeof setTimeout> | undefined;
/** The finish: once every card is face up, one card home at a time. */
function finishSoon() {
  finishing ??= setTimeout(() => {
    finishing = undefined;
    if (canFinish(st)) update(finishStep);
  }, FINISH_STEP);
}

/** A new deal: the cards gather on the stock face down, then go out row by row as by hand, the top ones turning as they land. */
function deal() {
  clearTimeout(finishing);
  finishing = undefined;
  stopCascade();
  clear();
  closeDialog();
  fold();
  st = apply(st, "new", settings);
  save();
  const s = slot(lay.g, STOCK);
  cards.forEach((el, c) => {
    el.style.visibility = "";
    el.classList.add("down");
    el.classList.remove("lifted", "can");
    el.style.setProperty("--d", `${Math.round(Math.random() * 80)}ms`);
    el.style.setProperty("--fd", "0ms");
    el.dataset.at = "";
    at(el, s);
    el.style.zIndex = String(2000 + st.stock.indexOf(c));
  });
  setTimeout(() => draw({ delays: dealOrder(), flipAfter: MOVE - 60 }), 380);
}

/** Each tableau card's delay: dealt a row at a time, left to right. */
function dealOrder(): Map<Card, number> {
  const out = new Map<Card, number>();
  let n = 0;
  for (let row = 0; row < 7; row++) for (let i = row; i < 7; i++) {
    const p = st.tableau[i];
    out.set(row < p.down.length ? p.down[row] : p.up[row - p.down.length], n++ * DEAL_STEP);
  }
  return out;
}

// ---- the keys ---------------------------------------------------------------------

const KEYS: Record<string, Action> = {
  ArrowLeft: "left", h: "left", ArrowRight: "right", l: "right", ArrowUp: "up", k: "up", ArrowDown: "down", j: "down",
  Enter: "select", " ": "draw", d: "draw", u: "undo", Backspace: "undo", n: "new",
};

/** An action by key, by ⌘K, or by the footer. */
function act(a: string) {
  if (a === "new" || (a === "select" && st.won)) return askNew();
  if (a === "select" && canFinish(st)) a = "finish";
  if (a === "finish") { clearTimeout(finishing); finishing = undefined; }
  update((s) => apply(s, a as Action, settings));
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  body.classList.add("kbd");
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (asking) {
    if (key === "Escape") return;
    e.preventDefault();
    if (key === "Enter" || key === "n") asking.yes();
    else asking.no?.();
    return;
  }
  if (cascading) { stopCascade(); showWon(); }
  const a = KEYS[key];
  if (!a || (e.repeat && a === "select")) return;
  e.preventDefault();
  act(a);
});

// ---- the mouse --------------------------------------------------------------------

/** A press on cards that can move: a click once it lets go where it was, a drag once it moves. */
type Grab = { from: number; count: number; cards: Card[]; x: number; y: number; dragging: boolean; can: number[]; over?: number };
let grab: Grab | undefined;

table.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  body.classList.remove("kbd");
  if (cascading) { stopCascade(); showWon(); return; }
  if (st.won) return;
  const el = (e.target as HTMLElement).closest<HTMLElement>(".card, .slot");
  if (!el) return update((s) => (s.held ? { ...s, held: undefined } : s));
  const { pile, count } = el.dataset.card ? locate(st, el.dataset.card as Card) : { pile: Number(el.dataset.pile), count: 0 };
  if (pile === STOCK) return update((s) => apply({ ...s, cursor: STOCK, depth: 1 }, "draw"));
  grab = { from: pile, count, cards: [], x: e.clientX, y: e.clientY, dragging: false, can: [] };
  table.setPointerCapture(e.pointerId);
});

table.addEventListener("pointermove", (e) => {
  if (!grab) return;
  const dx = e.clientX - grab.x, dy = e.clientY - grab.y;
  if (!grab.dragging) {
    if (!grab.count || Math.hypot(dx, dy) < 5) return;
    // The drag takes the cards off whatever was picked up.
    if (st.held) { st = { ...st, held: undefined }; draw(); }
    grab.dragging = true;
    grab.cards = run(st, grab.from, grab.count);
    grab.can = targets(grab.from, grab.cards);
    unhover();
    grab.cards.forEach((c, i) => {
      const el = cards.get(c)!;
      el.classList.add("drag");
      el.style.zIndex = String(4000 + i);
    });
    ring.classList.add("off");
  }
  grab.cards.forEach((c) => {
    const from = lay.cards.get(c)!;
    at(cards.get(c)!, { x: from.x + dx, y: from.y + dy });
  });
  // Over the pile the leading card covers most of; lit when the cards can go there.
  const lead = lay.cards.get(grab.cards[0])!;
  const held = { x: lead.x + dx, y: lead.y + dy, w: lay.g.w, h: lay.g.h };
  let best = 0;
  grab.over = undefined;
  for (let p = 1; p < 13; p++) {
    const o = p === grab.from ? 0 : overlap(held, dropBox(lay, st, p));
    if (o > best) { best = o; grab.over = p; }
  }
  const over = grab.over;
  const hot = over === undefined ? undefined : isFoundation(over) ? grab.can.find(isFoundation) : grab.can.includes(over) ? over : undefined;
  glow(grab.can, hot);
});

table.addEventListener("pointerup", (e) => {
  const g = grab;
  grab = undefined;
  if (!g) return;
  if (table.hasPointerCapture(e.pointerId)) table.releasePointerCapture(e.pointerId);
  if (g.dragging) {
    g.cards.forEach((c) => cards.get(c)!.classList.remove("drag"));
    // A drop on a pile they can go on, or back where they came from (with the reason, when there is one).
    if (g.over === undefined || g.over === STOCK) return draw();
    return update((s) => play({ ...s, cursor: g.over! }, g.from, g.count, g.over), { flipAfter: 80 });
  }
  click(g.from, g.count);
});
table.addEventListener("pointercancel", () => { if (grab?.dragging) grab.cards.forEach((c) => cards.get(c)!.classList.remove("drag")); grab = undefined; draw(); });

/**
 * A click: on cards that can move, picks them up (and they show where they
 * can go); a second click drops them on the pile clicked, or, on the same
 * cards, sends them where they go. So a double click sends a card home.
 */
function click(pile: number, count: number) {
  const h = st.held;
  if (!h) return update((s) => (count ? { ...s, cursor: pile, depth: count, held: { from: pile, count }, note: undefined } : { ...s, cursor: pile, depth: 1, note: undefined }));
  if (pile !== h.from) return update((s) => play({ ...s, cursor: pile }, h.from, h.count, pile), { flipAfter: 80 });
  if (count === h.count) return update((s) => play(s, h.from, h.count), { flipAfter: 80 });
  update((s) => (count ? { ...s, depth: count, held: { from: pile, count } } : { ...s, held: undefined }));
}

// Hovering cards that can move lifts them, the whole run under the pointer.
let hovered: Card[] = [];
const unhover = () => { hovered.forEach((c) => cards.get(c)!.classList.remove("hl")); hovered = []; };
table.addEventListener("pointerover", (e) => {
  if (grab) return;
  unhover();
  const el = (e.target as HTMLElement).closest<HTMLElement>(".card.can");
  if (!el || st.held) return;
  const { pile, count } = locate(st, el.dataset.card as Card);
  hovered = run(st, pile, count);
  hovered.forEach((c) => cards.get(c)!.classList.add("hl"));
});
table.addEventListener("pointerleave", unhover);
addEventListener("pointermove", () => body.classList.remove("kbd"), { passive: true });

// ---- the dialog: the ask before a new deal, the won table ------------------------

let asking: { yes: () => void; no?: () => void } | undefined;
function ask(title: string, text: string, yes: [string, () => void], no?: [string, () => void]) {
  $("dialog-title").textContent = title;
  $("dialog-text").textContent = text;
  const y = $("dialog-yes"), n = $("dialog-no");
  y.innerHTML = `${yes[0]} <kbd>⏎</kbd>`;
  y.onclick = yes[1];
  n.hidden = !no;
  if (no) { n.textContent = no[0]; n.onclick = no[1]; }
  asking = { yes: yes[1], no: no?.[1] };
  dialog.hidden = false;
}
function closeDialog() {
  asking = undefined;
  dialog.hidden = true;
}

function askNew() {
  if (!running(st)) return deal();
  ask("Deal a new game?", "This one counts as lost.", ["Deal", deal], ["Keep playing", closeDialog]);
}

function showWon() {
  const { played, won } = st.stats;
  ask("You won", `${st.moves} moves in ${clock(st.elapsed)} · ${won} of ${played} won`, ["New game", deal]);
}

// ---- the win: the cards bounce off the foundations, leaving trails ------------

let cascading: number | undefined;
const ctx = canvas.getContext("2d")!;
function clear() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function celebrate() {
  setTimeout(() => {
    if (!st.won) return;
    const dpr = devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    clear();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { g } = lay;
    const s = g.w / 80;
    // Kings first, round the four foundations, down to the aces.
    const queue: Card[] = [];
    for (let r = 12; r >= 0; r--) st.foundations.forEach((f) => f[r] && queue.push(f[r]));
    type Flying = { c: Card; x: number; y: number; vx: number; vy: number };
    const flying: Flying[] = [];
    let last = 0, prev = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(3, (now - prev) / 16.7);
      prev = now;
      if (queue.length && now - last > 320) {
        last = now;
        const c = queue.shift()!, from = lay.cards.get(c)!;
        cards.get(c)!.style.visibility = "hidden";
        flying.push({ c, x: from.x, y: from.y, vx: (2 + Math.random() * 3.5) * s * (Math.random() < 0.5 ? -1 : 1), vy: -(1 + Math.random() * 6) * s });
      }
      for (const f of flying) {
        f.vy += 0.55 * s * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.y + g.h > innerHeight) { f.y = innerHeight - g.h; f.vy = -f.vy * (0.62 + Math.random() * 0.2); }
        ctx.drawImage(fronts.get(f.c)!, f.x, f.y, g.w, g.h);
      }
      for (let i = flying.length - 1; i >= 0; i--) if (flying[i].x + g.w < 0 || flying[i].x > innerWidth) flying.splice(i, 1);
      if (queue.length || flying.length) cascading = requestAnimationFrame(frame);
      else { cascading = undefined; showWon(); }
    };
    cascading = requestAnimationFrame(frame);
  }, MOVE + 200);
}

function stopCascade() {
  if (cascading !== undefined) cancelAnimationFrame(cascading);
  cascading = undefined;
}

// ---- the panel: actions, settings, shown and hidden ------------------------------

pal.onAction(act);
pal.onSettings((s) => (settings = { ...DEFAULTS, ...s } as Settings));
pal.onShown(() => {
  since ??= Date.now();
  startTick();
});
pal.onHidden(() => {
  fold();
  since = undefined;
  clearInterval(tick);
  tick = undefined;
  save();
});
addEventListener("pagehide", () => { fold(); save(); });
addEventListener("resize", () => snap());

// ---- the first frame -------------------------------------------------------------

const [stored, s] = await Promise.all([pal.storage.get(KEY).catch(() => undefined), pal.settings().catch(() => ({}))]);
settings = { ...DEFAULTS, ...s } as Settings;
const fresh = !isState(stored);
st = fresh ? newGame(settings) : { ...stored, held: undefined, note: undefined, drawn: [] };
snap();
startTick();
pal.ready();
if (fresh) {
  save();
  // The first deal: everything on the stock, then out.
  const s0 = slot(geometry(innerWidth, innerHeight, st), STOCK);
  body.classList.add("instant");
  cards.forEach((el) => { el.classList.add("down"); at(el, s0); el.dataset.at = ""; });
  void body.offsetWidth;
  body.classList.remove("instant");
  setTimeout(() => draw({ delays: dealOrder(), flipAfter: MOVE - 60 }), 150);
} else if (st.won) showWon();
else if (canFinish(st)) finishSoon();
