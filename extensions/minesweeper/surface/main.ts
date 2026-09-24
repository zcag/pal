// Minesweeper's page (the view's `surface`). The rules are game.ts's, the
// same the host tests play: the page holds one `State`, turns every key and
// click into an `apply`, draws what changed and writes the state to the
// extension's storage (`pal.storage`) after every move; a cursor move is
// written a beat later so a held arrow is not a write per repeat.
//
// Drawing is a diff: each cell has a look (closed, flag, open n, mine, the
// hit, a wrong flag) and only cells whose look changed are touched, with
// the animation the change calls for: an open lifts the cell's cap `--d`
// ms after the move, by its ring from the cell opened (the ripple); a lost
// game's mines pop out from the hit after the blast; a won game's flags
// plant out from the last open under confetti.
//
// The clock is the state's: `resume` when the view is on screen, `pause`
// when it leaves (`pal.onShown` / `pal.onHidden`), `settle` on load for a
// run the panel never ended. The level picker writes the difficulty
// setting through the extension (`pal.send({ difficulty })`, which calls
// `settings.set`), so the settings page and the page agree.
import { LEVELS, adopt, apply, around, count, elapsed, isChord, isState, levelOf, minesLeft, newGame, pause, pointAt, resume, rings, settle, status, clockText, type Action, type Dir, type Level, type State } from "../game.ts";
import { blast, confetti } from "./fx.ts";
import type { SurfaceKit } from "@zcag/pal";

declare const pal: SurfaceKit;

const KEY = "state";
const ORDER: Level[] = ["beginner", "intermediate", "expert"];
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const grid = $("#grid"), frame = $("#frame"), cursorEl = $("#cursor"), face = $<HTMLButtonElement>("#face");
const minesEl = $("#mines"), timeEl = $("#time"), recordEl = $("#record"), levelsEl = $("#levels"), enterHint = $("#enter-hint");
const toast = $("#toast"), prompt = $("#prompt");

let st: State;
let level: Level = "beginner";
let hidden = false;

// ---- persistence and the title ------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save(lazy = false) {
  clearTimeout(saveTimer);
  const write = () => pal.storage.set(KEY, st).catch((e) => console.error(`minesweeper: save: ${e}`));
  if (lazy) saveTimer = setTimeout(write, 400);
  else void write();
}
let shownTitle = "";
function title() {
  const t = status(st);
  if (t !== shownTitle) pal.title((shownTitle = t));
}

/** The next state: drawn, titled, saved (a cursor move lazily). */
function commit(next: State, lazy = false) {
  if (next === st) return;
  const prev = st;
  st = next;
  draw(prev);
  title();
  save(lazy);
}
const act = (a: Action, lazy = false) => commit(apply(st, a, { difficulty: level }, Math.random, Date.now()), lazy);

// ---- the board ------------------------------------------------------------

let cells: HTMLElement[] = [];
let looks: string[] = [];
let shape = "";
let pressed = new Set<number>();

const svg = (id: string) => `<svg viewBox="0 0 16 16"><use href="#${id}"/></svg>`;
function lookOf(s: State, i: number): string {
  if (s.phase === "lost") {
    if (i === s.hit) return "x";
    if (s.flag[i] && !s.mine[i]) return "w";
    if (s.mine[i] && !s.flag[i]) return "m";
  }
  if (s.flag[i]) return "f";
  return s.open[i] ? `o${count(s, i)}` : "h";
}
function paint(el: HTMLElement, look: string, anim = "", delay = 0) {
  const n = look[0] === "o" ? Number(look.slice(1)) : 0;
  el.className = `c ${look[0]}${n ? ` n${n}` : ""}${anim && ` ${anim}`}`;
  el.innerHTML = look === "f" ? svg("flag") : look === "m" || look === "x" ? svg("mine") : look === "w" ? svg("flag") + svg("cross") : n ? `<span>${n}</span>` : "";
  if (anim) el.style.setProperty("--d", `${Math.round(delay)}ms`);
}

/** The pitch that fits the board in the stage, 44 px at most, and the bevel for it. */
function fit() {
  if (!st) return;
  const stage = $("#stage").getBoundingClientRect();
  const c = Math.max(10, Math.min(44, Math.floor(Math.min((stage.width - 32) / st.w, (stage.height - 8) / st.h))));
  const bv = c >= 36 ? 3 : c >= 16 ? 2 : 1;
  const root = document.documentElement.style;
  root.setProperty("--c", `${c}px`);
  root.setProperty("--bv", `${bv}px`);
  moveCursor();
}
addEventListener("resize", fit);

function build() {
  shape = `${st.w}x${st.h}`;
  grid.style.setProperty("--w", String(st.w));
  cells = Array.from({ length: st.w * st.h }, (_, i) => {
    const el = document.createElement("div");
    el.dataset.i = String(i);
    return el;
  });
  grid.replaceChildren(...cells);
  looks = cells.map((el, i) => {
    const look = lookOf(st, i);
    paint(el, look);
    return look;
  });
  fit();
}

function moveCursor() {
  const c = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--c")) || 24;
  cursorEl.style.transform = `translate(${(st.cursor % st.w) * c}px, ${Math.floor(st.cursor / st.w) * c}px)`;
  cursorEl.classList.toggle("off", st.phase === "won" || st.phase === "lost");
}

/** The ripple's step: 28 ms a ring, less on a big flood so the whole of it lands inside half a second. */
const stepFor = (s: State, from: number, cellsHit: number[]) => Math.min(28, 480 / Math.max(1, ...cellsHit.map((i) => rings(s, i, from))));

function draw(prev?: State) {
  const fresh = !prev || prev.game !== st.game;
  if (`${st.w}x${st.h}` !== shape) build();
  else if (fresh) cells.forEach((el, i) => paint(el, (looks[i] = lookOf(st, i))));
  if (fresh && prev) replay(grid, "deal");

  const opened = !fresh && st.last && st.last !== prev!.last ? st.last : undefined;
  const openStep = opened ? stepFor(st, opened.at, opened.opened) : 0;
  const lostNow = !fresh && st.phase === "lost" && prev!.phase !== "lost";
  const wonNow = !fresh && st.phase === "won" && prev!.phase !== "won";
  const endMines = lostNow ? st.mine.flatMap((m, i) => (m || st.flag[i] ? [i] : [])) : [];
  const endStep = lostNow ? Math.min(40, 900 / Math.max(1, ...endMines.map((i) => rings(st, i, st.hit!)))) : 0;
  const winStep = wonNow && st.last ? stepFor(st, st.last.at, st.mine.flatMap((m, i) => (m ? [i] : []))) : 0;

  if (!fresh) cells.forEach((el, i) => {
    const look = lookOf(st, i), was = looks[i];
    if (look === was) return;
    looks[i] = look;
    if (look[0] === "o" && opened) paint(el, look, "rv", rings(st, i, opened.at) * openStep);
    else if (look === "x") paint(el, look, "boom");
    else if (look === "m" || look === "w") paint(el, look, "pop", 260 + rings(st, i, st.hit!) * endStep);
    else if (look === "f" && wonNow && st.last) paint(el, look, "pop", rings(st, i, st.last.at) * winStep);
    else if (look === "f") paint(el, look, "pop");
    else if (look === "h" && was === "f") {
      el.classList.add("pull");
      setTimeout(() => { if (looks[i] === "h") paint(el, "h"); }, 170);
    } else paint(el, look);
  });
  pressed.forEach((i) => cells[i]?.classList.add("pr"));

  moveCursor();
  header();
  if (lostNow) boom();
  if (wonNow) win();
  if (fresh) { toast.hidden = true; face.dataset.mood = "smile"; }
}

function header() {
  const left = minesLeft(st);
  minesEl.textContent = left < 0 ? `-${String(Math.min(99, -left)).padStart(2, "0")}` : String(Math.min(999, left)).padStart(3, "0");
  tick();
  const rec = st.records[st.level];
  recordEl.innerHTML = `${rec.best === undefined ? "" : `Best <b>${clockText(rec.best)}</b> · `}${rec.played ? `${rec.won} of ${rec.played} won` : ""}`;
  for (const b of levelsEl.querySelectorAll<HTMLElement>("button")) b.classList.toggle("on", b.dataset.level === st.level);
  enterHint.textContent = st.phase === "won" || st.phase === "lost" ? "new game" : isChord(st) ? "open around" : "open";
  if (!hold) face.dataset.mood = st.phase === "won" ? "cool" : st.phase === "lost" ? "dead" : "smile";
}
function tick() {
  const s = Math.min(999, Math.floor(elapsed(st.clock, Date.now()) / 1000));
  timeEl.textContent = String(s).padStart(3, "0");
}
setInterval(() => { if (st?.phase === "play" && !hidden) tick(); }, 250);

/** A class's animation run again from the start. */
function replay(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
function centre(i: number) {
  const r = cells[i].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: r.width };
}
function boom() {
  const { x, y, size } = centre(st.hit!);
  blast(x, y, size);
  replay(frame, "shake");
}
function win() {
  const css = getComputedStyle(document.documentElement);
  confetti(frame.getBoundingClientRect(), ["--ms-n1", "--ms-n2", "--ms-n3", "--ms-flag", "--pal-accent", "--pal-brand-amber", "--ms-n6"].map((v) => css.getPropertyValue(v).trim() || "#4F46D6"));
  const best = st.records[st.level].best === st.clock.ms;
  toast.innerHTML = `Cleared in ${clockText(st.clock.ms)}${best ? "<small>A new best</small>" : ""}`;
  toast.hidden = false;
  replay(toast, "show");
  replay(face, "bump");
}

// ---- the question before throwing a game away -----------------------------

let asking: { key: string; yes: () => void } | undefined;
function ask(text: string, key: string, yes: () => void) {
  asking = { key, yes };
  prompt.querySelector("p")!.textContent = text;
  prompt.hidden = false;
}
function answer(ok: boolean) {
  const a = asking;
  asking = undefined;
  prompt.hidden = true;
  if (ok) a?.yes();
}
prompt.querySelector("[data-yes]")!.addEventListener("click", () => answer(true));
prompt.querySelector("[data-no]")!.addEventListener("click", () => answer(false));

const restart = () => act("new");
function startOver(key = "n") {
  if (st.phase === "play") ask("Start a new game? This one is given up.", key, restart);
  else restart();
}
function enter() {
  if (st.phase === "won" || st.phase === "lost") restart();
  else act("open");
}

// ---- the level picker -------------------------------------------------------

let picking: number | undefined;
function showPicker() {
  levelsEl.classList.toggle("picking", picking !== undefined);
  levelsEl.querySelectorAll<HTMLElement>("button").forEach((b, i) => b.classList.toggle("hl", i === picking));
}
function choose(l: Level) {
  picking = undefined;
  showPicker();
  if (l === st.level) return;
  const go = () => {
    level = l;
    pal.send({ difficulty: l }).catch((e) => console.error(`minesweeper: difficulty: ${e}`));
    commit(apply(st, "new", { difficulty: l }));
  };
  if (st.phase === "play") ask(`Give up this game for ${LEVELS[l].title}?`, "d", go);
  else go();
}
levelsEl.addEventListener("click", (e) => {
  const l = (e.target as HTMLElement).closest<HTMLElement>("button")?.dataset.level;
  if (l) choose(levelOf(l));
});
face.addEventListener("click", restart);

// ---- keys -------------------------------------------------------------------

const DIRS: Record<string, Dir> = { ArrowUp: "up", k: "up", ArrowDown: "down", j: "down", ArrowLeft: "left", h: "left", ArrowRight: "right", l: "right" };
window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.key === "Escape" || e.key === "Shift") return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  e.preventDefault();
  if (asking) return answer(k === "Enter" || k === asking.key);
  if (picking !== undefined) {
    if (k === "ArrowLeft" || k === "h") picking = (picking + 2) % 3;
    else if (k === "ArrowRight" || k === "l") picking = (picking + 1) % 3;
    else if (k === "Enter" || k === " ") return choose(ORDER[picking]);
    else picking = undefined;
    return showPicker();
  }
  if (DIRS[k]) act(DIRS[k], true);
  else if (k === "Enter") enter();
  else if (k === "/" || k === "f" || k === " ") act("flag");
  else if (k === "n") startOver();
  else if (k === "d" || k === "Tab") { picking = ORDER.indexOf(st.level); showPicker(); }
});
pal.onAction((id) => {
  if (asking) answer(false);
  if (id === "open") enter();
  else if (id === "flag") act("flag");
  else if (id === "new") startOver();
  else if (id === "level") { picking = ORDER.indexOf(st.level); showPicker(); }
});

// ---- the pointer ------------------------------------------------------------
// Left opens where it is let go, and on a satisfied number opens around it;
// right flags on press; both buttons, or the middle one, chord. Held, the
// cells it would open show pressed, as in the original.

let hold: { at: number; chord: boolean; buttons: number } | undefined;

function cellAt(e: PointerEvent): number {
  const r = grid.getBoundingClientRect(), c = r.width / st.w;
  const col = Math.floor((e.clientX - r.left) / c), row = Math.floor((e.clientY - r.top) / c);
  return col < 0 || row < 0 || col >= st.w || row >= st.h ? -1 : row * st.w + col;
}
function press(next: Set<number>) {
  pressed.forEach((i) => next.has(i) || cells[i]?.classList.remove("pr"));
  next.forEach((i) => cells[i]?.classList.add("pr"));
  pressed = next;
}
const closed = (i: number) => !st.open[i] && !st.flag[i];
function showHold() {
  const h = hold;
  if (!h || h.at < 0 || st.phase === "won" || st.phase === "lost") return press(new Set());
  const ring = [h.at, ...around(h.at, st.w, st.h)].filter(closed);
  press(new Set(h.chord || st.open[h.at] ? ring : closed(h.at) ? [h.at] : []));
}
function letGo() {
  const h = hold!;
  hold = undefined;
  press(new Set());
  face.dataset.mood = "smile";
  if (h.at < 0) return header();
  const at = pointAt(st, h.at);
  if (h.chord && !at.open[h.at]) return commit(at, true);
  commit(apply(at, "open", { difficulty: level }, Math.random, Date.now()));
  header();
}

grid.addEventListener("pointerdown", (e) => {
  if (st.phase === "won" || st.phase === "lost") return;
  const i = cellAt(e);
  if (i < 0) return;
  e.preventDefault();
  grid.setPointerCapture(e.pointerId);
  if (e.button === 2 && !(e.buttons & 1)) {
    commit(apply(pointAt(st, i), "flag", { difficulty: level }, Math.random, Date.now()));
    hold = undefined;
    return;
  }
  hold = { at: i, chord: e.button === 1 || (e.buttons & 3) === 3, buttons: e.buttons };
  face.dataset.mood = "oh";
  showHold();
});
grid.addEventListener("pointermove", (e) => {
  if (!hold) {
    // Right held, then left: the classic chord.
    if ((e.buttons & 3) === 3 && st.phase === "play") hold = { at: cellAt(e), chord: true, buttons: e.buttons };
    else return;
  }
  if ((e.buttons & 3) === 3) hold.chord = true;
  // A button let go while another stays down ends the press, as in the original.
  if (e.buttons && (hold.buttons & ~e.buttons)) { hold.at = cellAt(e); return letGo(); }
  hold.buttons = e.buttons || hold.buttons;
  hold.at = cellAt(e);
  showHold();
});
grid.addEventListener("pointerup", (e) => { if (hold) { hold.at = cellAt(e); letGo(); } });
grid.addEventListener("pointercancel", () => { hold = undefined; press(new Set()); header(); });
addEventListener("contextmenu", (e) => e.preventDefault());

// ---- the view's life ----------------------------------------------------------

pal.onHidden(() => {
  hidden = true;
  const held = pause(st, Date.now());
  if (held !== st) st = held;
  save();
});
pal.onShown(() => {
  hidden = false;
  const run = resume(st, Date.now());
  if (run !== st) { st = run; save(); }
  tick();
});
pal.onSettings((s) => {
  level = levelOf(s.difficulty);
  commit(adopt(st, level));
});

async function start() {
  level = levelOf((await pal.settings()).difficulty);
  const stored = await pal.storage.get(KEY);
  st = resume(adopt(settle(isState(stored) ? stored : newGame(level)), level), Date.now());
  build();
  header();
  title();
  save();
  requestAnimationFrame(() => pal.ready());
}
void start();
