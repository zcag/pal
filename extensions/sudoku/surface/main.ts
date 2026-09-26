// Sudoku's page (the view's `surface`). The rules are game.ts's, the same
// the host tests: the page holds one `Play`, turns every key and click into
// a call there, draws the board from it and hands the game to the extension
// (`pal.send({ op: "save" })`) after every move. The puzzles, the lists and
// the record are the extension's (index.ts); the answer is worked out here
// from the clues (sudoku.ts `solve`), for mistakes and hints.
//
// The board is 81 cells laid out absolutely over nine box plates, so a box
// edge is a thicker line than a cell edge; one ring (the cursor) glides over
// them. Every draw works out each cell's look (digit, marks, the lit zone,
// the digit in focus, clashes, a hint, where a picked digit fits) and
// touches only the cells whose look changed.
//
// Three ways in besides a digit on the cursor: a digit typed over another
// turns the cell into notes (game.ts `enter`); auto notes (C, the
// `auto_notes` setting) show what fits everywhere, the player only taking
// marks out; digit first (D) picks a digit and then every click places it.
//
// The clock runs while the board is on screen, unsolved, not paused and not
// hidden (`pal.onHidden`); the time so far rides in every save. The `clock`
// setting (T, ⌘K) only hides it: the time still counts for the stats.
import type { SurfaceKit } from "@zcag/pal";
import {
  applyHint, clearNotes, clockText, decode, digitCounts, encode, enter, erase, fillNotes, hint, isFull, isSolved, marks, newPlay, place, toggleNote, unitsDone, wrongCells,
  type Hint, type Play,
} from "../game.ts";
import type { Check, Opened, SolvedReply, TodayView } from "../index.ts";
import { DIFFS, DIFF_TITLE, UNITS, UNITS_OF, candidates, colOf, conflicts, fromText, has, rowOf, solve, type Diff, type Tech } from "../sudoku.ts";
import { confetti } from "./fx.ts";
import { Browse, Stats, dateLong, esc } from "./screens.ts";

declare const pal: SurfaceKit;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const body = document.body;
const frame = $("#frame"), cellsEl = $("#cells"), boxesEl = $("#boxes"), cursorEl = $("#cursor");
const padEl = $("#pad"), progressEl = $("#progress"), timeEl = $("#time"), tipEl = $("#tip"), doneEl = $("#done"), hintEl = $("#hint"), nearlyEl = $("#nearly");
const helpEl = $("#help"), askEl = $("#ask"), menuEl = $("#menu"), noteEl = $("#note");

type Screen = "loading" | "play" | "browse" | "stats";
let screen: Screen = "loading";
let opened: Opened | undefined;
let givens: number[] = new Array(81).fill(0);
let solution: number[] = new Array(81).fill(0);
let st: Play = newPlay(givens);
let at = 40;
let notesMode = false;
/** Auto notes (the setting): every empty cell shows what fits, less what the player took out. */
let autoOn = false;
/** Digit first: the digit every click places, 0 when off. */
let pick = 0;
/** The digit last typed or clicked, where digit first starts. */
let lastDigit = 0;
let undos: Play[] = [], redos: Play[] = [];
/** The mistakes the header shows; -1 before the first draw of a puzzle, so opening one with mistakes does not shake. */
let shownSlips = -1;
let check: Check = "conflicts";
let clockOn = true;
let paused = false, hidden = false;
/** Three solves or more (unknown until the stats arrive): no newcomer line, no notes flash. */
let seasoned: boolean | undefined;

// ---- the extension -----------------------------------------------------------------

const send = <T = unknown>(msg: unknown) => pal.send(msg) as Promise<T>;
function save() {
  if (!opened) return;
  send({ op: "save", id: opened.id, play: encode({ ...st, ms: elapsed() }) }).catch((e) => console.error(`sudoku: save: ${e}`));
}

// ---- the clock -----------------------------------------------------------------------

let since: number | undefined;
const elapsed = () => st.ms + (since !== undefined ? Date.now() - since : 0);
const shouldRun = () => screen === "play" && !!opened && !st.done && !paused && !hidden && helpEl.hidden && askEl.hidden && menuEl.hidden;
function syncClock() {
  const want = shouldRun();
  if (want && since === undefined) since = Date.now();
  else if (!want && since !== undefined) { st = { ...st, ms: st.ms + Date.now() - since }; since = undefined; }
  tick();
}
function tick() { if (opened) timeEl.textContent = clockText(st.done ? st.done.ms : elapsed()); }
let ticks = 0;
setInterval(() => { if (since === undefined) return; tick(); if (++ticks % 20 === 0) save(); }, 250);
addEventListener("pagehide", () => { syncClock(); save(); });

// ---- the board -----------------------------------------------------------------------

type Cell = { el: HTMLElement; digit: HTMLElement; marks: HTMLElement[] };
const cells: Cell[] = [];
let looks: string[] = new Array(81).fill("");

function buildBoard() {
  const bf = document.createDocumentFragment();
  for (let b = 0; b < 9; b++) {
    const el = document.createElement("div");
    el.className = "plate";
    el.style.setProperty("--bx", String(b % 3));
    el.style.setProperty("--by", String((b / 3) | 0));
    bf.appendChild(el);
  }
  boxesEl.replaceChildren(bf);
  const cf = document.createDocumentFragment();
  for (let i = 0; i < 81; i++) {
    const el = document.createElement("div");
    el.className = "cell";
    el.dataset.i = String(i);
    for (const [k, v] of Object.entries({ "--r": rowOf(i), "--k": colOf(i), "--bx": (colOf(i) / 3) | 0, "--by": (rowOf(i) / 3) | 0, "--d": 0 })) el.style.setProperty(k, String(v));
    el.innerHTML = `<div class="marks">${"<i></i>".repeat(9)}</div><b></b>`;
    const marks = [...el.querySelectorAll<HTMLElement>(".marks i")];
    marks.forEach((m, k) => { m.textContent = String(k + 1); });
    cells.push({ el, digit: el.querySelector("b")!, marks });
    cf.appendChild(el);
  }
  cellsEl.replaceChildren(cf);
}
buildBoard();

/** The cell size that fits: the board as tall as the panel, leaving the slim side its room (less when compact). */
function fit() {
  const W = innerWidth, H = innerHeight, compact = W < 640;
  const side = compact ? 166 : 272, gap = compact ? 14 : 20;
  const s = Math.floor(Math.max(24, Math.min((H - 20 - 16) / 9, (W - 28 - gap - side - 16) / 9)));
  document.documentElement.style.setProperty("--s", `${s}px`);
  // The side's chrome (the header, the tools, the key corners) grows with the board past the regular panel's cell, up to 1.7 times on the big one.
  document.documentElement.style.setProperty("--ui", String(Math.min(1.7, Math.max(1, s / 44))));
  body.classList.toggle("compact", compact);
  moveCursor(true);
}
let placed = false;
new ResizeObserver(() => fit()).observe(body);
fit();

function moveCursor(jump = false) {
  cursorEl.style.setProperty("--r", String(rowOf(at)));
  cursorEl.style.setProperty("--k", String(colOf(at)));
  cursorEl.style.setProperty("--bx", String((colOf(at) / 3) | 0));
  cursorEl.style.setProperty("--by", String((rowOf(at) / 3) | 0));
  if (jump || !placed) { cursorEl.style.transition = "none"; void cursorEl.offsetWidth; cursorEl.style.transition = ""; placed = true; }
}

let tip: { h: Hint; stage: 1 | 2 } | undefined;

/** Each cell's look worked out from the game, the cursor and the hint; only the cells that changed are touched. */
function draw() {
  const focus = pick || st.v[at];
  const clash = conflicts(st.v);
  const wrong = new Set(check === "mistakes" ? wrongCells(st.v, givens, solution) : []);
  const zone = new Set(pick ? [] : UNITS_OF[at].flatMap((u) => UNITS[u]));
  const shown = marks(st, autoOn), fits = pick ? candidates(st.v) : undefined;
  const h = tip?.h, stage2 = tip?.stage === 2;
  const area = new Set(h?.area), about = new Set(h ? (stage2 || h.kind !== "step" ? h.cells : []) : []), sources = new Set(stage2 ? h?.sources : []);
  const gone = new Map<number, number>();
  if (stage2) for (const e of h?.step?.elim ?? []) gone.set(e.cell, (gone.get(e.cell) ?? 0) | (1 << (e.digit - 1)));
  const counts = digitCounts(st.v);
  for (let i = 0; i < 81; i++) {
    const d = st.v[i], m = shown[i];
    const cls = [
      givens[i] ? "given" : d ? "mine" : "",
      i === at ? "at" : zone.has(i) ? "zone" : "",
      focus && d === focus ? "same" : "",
      // A clash: the digit you placed underlined, the clue it runs into outlined.
      clash.has(i) ? (givens[i] ? "partner" : "clash") : "", wrong.has(i) ? "wrong" : "",
      fits && has(fits[i], pick) ? "fits" : "",
      area.has(i) ? "lit" : "", about.has(i) ? "about" : "", sources.has(i) ? "source" : "",
      tip && h?.cell === i && stage2 ? "target" : "",
    ].filter(Boolean).join(" ");
    const ghost = stage2 && h?.cell === i && !d && (h.kind === "reveal" || h.step?.place) ? String(h.digit) : "";
    const look = `${d}|${m}|${cls}|${focus && has(m, focus) ? focus : 0}|${gone.get(i) ?? 0}|${ghost}`;
    if (look === looks[i]) continue;
    const c = cells[i], was = looks[i];
    looks[i] = look;
    c.el.className = `cell ${cls}`;
    if (ghost) c.el.dataset.ghost = ghost; else delete c.el.dataset.ghost;
    const prevDigit = Number(was.split("|")[0]) || 0;
    // A fresh board (`looks` reset by load) writes every cell: an empty one must clear what the last puzzle left there.
    if (d !== prevDigit || !was) {
      c.digit.textContent = d ? String(d) : "";
      if (d && was) replay(c.digit, "pop");
    }
    c.marks.forEach((mk, k) => {
      const on = !!(m & (1 << k));
      mk.classList.toggle("on", on);
      mk.classList.toggle("focus", on && focus === k + 1);
      mk.classList.toggle("gone", on && !!((gone.get(i) ?? 0) & (1 << k)));
    });
  }
  moveCursor();
  drawPad(counts, clash, shown);
  const empty = givens.filter((g) => !g).length;
  progressEl.style.setProperty("--p", String(empty ? st.v.filter((d, i) => d && !givens[i]).length / empty : 1));
  body.classList.toggle("picking", !!pick);
  cellsEl.style.setProperty("--pick", String(pick));
  hintLine();
}

/** A digit is done when all nine are on the board and none of them clashes. */
const doneDigit = (d: number, counts = digitCounts(st.v), clash = conflicts(st.v)) => counts[d] >= 9 && ![...clash].some((i) => st.v[i] === d);

/** The pad: each key's bar fills as its digit goes down, a done one dims with a check; the corner lights when the cursor's cell has that note. */
function drawPad(counts: number[], clash: Set<number>, shown: number[]) {
  const focus = st.v[at];
  padEl.classList.toggle("notes", notesMode);
  for (let d = 1; d <= 9; d++) {
    const b = padEl.children[d - 1] as HTMLElement;
    b.classList.toggle("done", doneDigit(d, counts, clash));
    b.classList.toggle("focus", !pick && focus === d);
    b.classList.toggle("picked", pick === d);
    b.classList.toggle("over", counts[d] > 9);
    b.classList.toggle("noted", has(shown[at], d));
    b.style.setProperty("--f", String(Math.min(9, counts[d]) / 9));
    b.title = counts[d] >= 9 ? `All nine ${d}s are in` : `${9 - counts[d]} left`;
  }
  for (const [t, on] of [["notes", notesMode], ["auto", autoOn], ["pick", !!pick]] as const) $(`[data-tool=${t}]`).classList.toggle("on", on);
  $("[data-tool=undo]").classList.toggle("off", !undos.length);
  const slips = check === "mistakes" ? st.mistakes : 0, slipsEl = $("#slips");
  if (slips !== shownSlips) {
    slipsEl.textContent = slips ? `${slips} ${slips === 1 ? "mistake" : "mistakes"}` : "";
    slipsEl.hidden = !slips;
    // A new mistake shakes the pill, so it is noticed while the eye is on the board.
    if (slips > shownSlips && shownSlips >= 0) replay(slipsEl, "bump");
    shownSlips = slips;
  }
}

/** Each key: the digit, a corner that writes it as a note, the bar of how many are down, a check for when all nine are. */
function buildPad() {
  padEl.innerHTML = Array.from({ length: 9 }, (_, k) => `<button type="button" tabindex="-1" data-d="${k + 1}"><b>${k + 1}</b><i class="nz" title="A note ${k + 1} (right-click or ⌥-click the key too)">${k + 1}</i><i class="bar"></i><svg viewBox="0 0 16 16"><path d="M4.2 8.4l2.6 2.5 5-5.4"/></svg></button>`).join("");
}
buildPad();

// ---- a move ------------------------------------------------------------------------------

/** The next state: kept for undo, drawn, celebrated, saved, judged. */
function commit(next: Play, cell = at) {
  if (next === st) return;
  undos.push(st);
  if (undos.length > 500) undos.shift();
  redos = [];
  settle(st, next, cell);
}

/** From `prev` to `next`: the hint closes, a unit or a digit completed lights up, a full board is judged. */
function settle(prev: Play, next: Play, cell: number) {
  st = next;
  if (tip && (prev.v !== next.v || prev.n !== next.n || prev.x !== next.x)) closeTip(false);
  draw();
  const placedNow = next.v[cell] && next.v[cell] !== prev.v[cell];
  const full = isFull(st.v);
  if (full && isSolved(st.v, solution)) return void finish(cell);
  showNearly(full);
  if (placedNow) celebrate(prev, cell);
  save();
}

/** A row, column or box just completed sweeps from the placed cell; a digit's ninth copy makes its nine pulse. */
function celebrate(prev: Play, cell: number) {
  const before = new Set(unitsDone(prev.v, cell));
  for (const u of unitsDone(st.v, cell)) {
    if (before.has(u)) continue;
    const from = UNITS[u].indexOf(cell);
    for (const [k, i] of UNITS[u].entries()) sweep(cells[i].el, Math.abs(k - from) * 45);
  }
  const d = st.v[cell];
  if (digitCounts(prev.v)[d] === 8 && digitCounts(st.v)[d] === 9 && !conflicts(st.v).size) {
    replay(padEl.children[d - 1] as HTMLElement, "cheer");
    st.v.forEach((x, i) => { if (x === d) sweep(cells[i].el, 0, "pulse"); });
  }
}
function sweep(el: HTMLElement, delay: number, cls = "sweep") {
  el.style.setProperty("--d", `${delay}ms`);
  replay(el, cls);
  setTimeout(() => el.classList.remove(cls), delay + 900);
}

let nearlyShown = false;
function showNearly(on: boolean) {
  if (on === nearlyShown) return;
  nearlyShown = on;
  if (on) { nearlyEl.hidden = false; replay(nearlyEl, "in", ["out"]); }
  else { replay(nearlyEl, "out", ["in"]); setTimeout(() => { if (!nearlyShown) nearlyEl.hidden = true; }, 200); }
}

/**
 * A digit at the cursor. `type`: a key with no modifier (game.ts `enter`: placed, or a second digit
 * turns the cell into notes); `place`: the pad's plain click, which always places; `note`: a mark.
 */
function input(d: number, how: "type" | "place" | "note") {
  if (st.done || paused) return;
  lastDigit = d;
  if (givens[at]) return flash(`That ${givens[at]} is a clue`);
  const was = st.v[at];
  if (how === "note") {
    // A note over a digit you placed does what a second digit does: notes holding both.
    if (was) return was === d ? flash(`${d} is already here`) : commit(enter(st, givens, at, d, solution, { auto: autoOn }));
    const next = toggleNote(st, givens, at, d, autoOn);
    return next === st ? flash(`A ${d} can't go here: there's one in its row, column or box`) : commit(next);
  }
  if (how === "place") return commit(place(st, givens, at, d, solution));
  const next = enter(st, givens, at, d, solution, { auto: autoOn, mistakes: check === "mistakes" });
  if (next === st && was && was !== d) return flash(`That ${was} is right`);
  commit(next);
  if (was && !st.v[at] && seasoned === false) flash(`Notes now: ${was} and ${d}. ⌫ clears the cell`);
}

/** The first cell two games differ in. */
const changedCell = (a: Play, b: Play) => a.v.findIndex((d, i) => d !== b.v[i] || a.n[i] !== b.n[i] || a.x[i] !== b.x[i]);
/** Back (undo) or forward (redo) one move: the board, the marks and the cells turned into notes, and the mistake it made (an undone mistake is taken back); the clock and the hints left as they are. */
function travel(from: Play[], to: Play[]) {
  const prev = from.pop();
  if (!prev || st.done) return;
  to.push(st);
  const cell = changedCell(st, prev);
  if (cell >= 0) at = cell;
  settle(st, { ...st, v: prev.v, n: prev.n, x: prev.x, j: prev.j, mistakes: prev.mistakes }, at);
}
const undo = () => travel(undos, redos);
const redo = () => travel(redos, undos);

// ---- digit first -----------------------------------------------------------------------------

/** Digit first on `d` (0 leaves it); a digit that is done hands over to the next one left. */
function setPick(d: number) {
  pick = d;
  if (d) lastDigit = d;
  draw();
}
function togglePick() {
  if (pick) return setPick(0);
  const left = [st.v[at], lastDigit, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((d) => d && !doneDigit(d));
  if (!left) return flash("Every digit is in");
  setPick(left);
}
/** A click in digit first: an empty cell takes the digit (a note in notes mode), the digit clicked again comes out, another digit is picked up instead. */
function stamp(i: number) {
  at = i;
  const d = st.v[i];
  if (d && d !== pick) return setPick(d);
  if (d) return givens[i] ? draw() : commit(erase(st, givens, i, autoOn), i);
  commit(notesMode ? toggleNote(st, givens, i, pick, autoOn) : place(st, givens, i, pick, solution), i);
  if (pick && doneDigit(pick) && !st.done) {
    const next = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => ((pick + k - 1) % 9) + 1).find((k) => !doneDigit(k));
    flash(next ? `All nine ${pick}s are in, on to ${next}` : `All nine ${pick}s are in`);
    setPick(next ?? 0);
  }
}

function move(dr: number, dc: number) {
  at = ((rowOf(at) + dr + 9) % 9) * 9 + ((colOf(at) + dc + 9) % 9);
  draw();
}
/** The next (or previous) empty cell in reading order; in digit first, the next one the digit fits. */
function nextEmpty(by: 1 | -1) {
  const fits = pick ? candidates(st.v) : undefined;
  for (let k = 1; k <= 81; k++) {
    const i = (at + by * k + 81 * 2) % 81;
    if (!st.v[i] && (!fits || has(fits[i], pick))) { at = i; return draw(); }
  }
}

// ---- the hint ---------------------------------------------------------------------------------

const TITLES: Record<Tech, string> = {
  "full-house": "One cell left", "hidden-single": "The only place", "naked-single": "The only digit",
  pointing: "Locked in", claiming: "Locked in", "naked-pair": "A pair", "hidden-pair": "A hidden pair",
  "naked-triple": "A triple", "hidden-triple": "A hidden triple", "x-wing": "An X-wing", swordfish: "A swordfish", "xy-wing": "An XY-wing",
};

/** I (or the button): where to look, then why with the digit, then the move. */
function hintKey() {
  if (st.done || paused) return;
  if (!tip) {
    tip = { h: hint(givens, st, solution, autoOn), stage: 1 };
    // A wrong digit or a stuck board goes straight to the reason.
    if (tip.h.kind !== "step") tip.stage = 2;
  } else if (tip.stage === 1) tip.stage = 2;
  else {
    const h = tip.h;
    closeTip(false);
    if (h.cell !== undefined) at = h.cell;
    return commit(applyHint(st, givens, h, solution, autoOn), h.cell ?? at);
  }
  if (tip.stage === 2) {
    st = { ...st, hints: st.hints + 1 };
    if (tip.h.cell !== undefined) at = tip.h.cell;
    save();
  }
  showTip();
}
function showTip() {
  if (!tip) return;
  const { h, stage } = tip;
  $("#tip-title").textContent = stage === 1 ? "Hint" : h.kind === "wrong" ? "A wrong digit" : h.kind === "reveal" ? "Try this one" : TITLES[h.step!.tech];
  $("#tip-text").textContent = stage === 1 ? h.look : h.why;
  $("#tip-go").innerHTML = `${stage === 1 ? "Show why" : esc(h.act)} <kbd>⏎</kbd>`;
  const was = tipEl.hidden;
  tipEl.hidden = false;
  body.classList.add("tipping");
  replay(tipEl, was ? "in" : "swap", ["in", "swap"]);
  draw();
}
function closeTip(redraw = true) {
  if (!tip) return;
  tip = undefined;
  tipEl.hidden = true;
  body.classList.remove("tipping");
  if (redraw) draw();
}

// ---- the finish ----------------------------------------------------------------------------

async function finish(cell: number) {
  syncClock();
  const ms = elapsed();
  since = undefined;
  st = { ...st, ms, done: { ms, at: Date.now() } };
  closeTip(false);
  showNearly(false);
  draw();
  tick();
  body.classList.add("solved");
  const wave = waveBoard(cell);
  setTimeout(() => confetti(frame.getBoundingClientRect(), CONFETTI), wave * 0.45);
  const reply = await send<SolvedReply | null>({ op: "solved", id: opened!.id, play: encode(st) }).catch(() => null);
  setTimeout(() => showDone(reply), wave);
}
const CONFETTI = ["#FFC53D", "#FF7A59", "#5B8CFF", "#3CCB8B", "#B07CFF", "#FF5FA2"];

/** Every digit hops in turn, rippling out from the last one placed; ms until it is over. */
function waveBoard(from: number): number {
  const step = 38;
  let far = 0;
  for (let i = 0; i < 81; i++) {
    const dist = Math.abs(rowOf(i) - rowOf(from)) + Math.abs(colOf(i) - colOf(from));
    far = Math.max(far, dist);
    cells[i].el.style.setProperty("--d", `${dist * step}ms`);
    replay(cells[i].el, "wave");
  }
  return far * step + 650;
}

let reply: SolvedReply | null = null;
function showDone(r: SolvedReply | null, again = false) {
  const d = st.done;
  if (!d || !opened) return;
  reply = r;
  $("#done-what").textContent = again ? "Solved" : st.hints ? "Solved, with a hint" : "Solved!";
  $("#done-time").textContent = clockText(d.ms);
  const tags: string[] = [];
  if (r?.best) tags.push(`<span class="gold">A new best</span>`);
  else if (r?.stats.best !== undefined && !st.hints) tags.push(`<span>Best ${clockText(r.stats.best)}</span>`);
  if (r && opened.today && r.stats.streak > 1) tags.push(`<span class="hot">${r.stats.streak}-day streak</span>`);
  if (!st.hints && !st.mistakes) tags.push(`<span class="clean">Flawless</span>`);
  else if (st.hints) tags.push(`<span>${st.hints} ${st.hints === 1 ? "hint" : "hints"}</span>`);
  if (r && !r.first) tags.push(`<span>A replay</span>`);
  $("#done-tags").innerHTML = tags.join("");
  const next = nextPlay();
  $("#done-go").innerHTML = `<button type="button" tabindex="-1" data-go="next" class="primary">${esc(next.title)} <kbd>⏎</kbd></button><button type="button" tabindex="-1" data-go="play">More <kbd>⌘N</kbd></button><button type="button" tabindex="-1" data-go="stats">Stats <kbd>⌘S</kbd></button>`;
  doneEl.hidden = false;
  replay(doneEl, "in");
  body.classList.add("finished");
}
/** Enter on the finish: today's next unsolved daily after a daily, else a new puzzle of the same difficulty. */
function nextPlay(): { title: string; go: () => void } {
  const diff = opened!.diff;
  if (opened!.today && reply?.next) { const n = reply.next; return { title: `Today's ${DIFF_TITLE[n]}`, go: () => void openPuzzle({ op: "open", date: opened!.date, diff: n }) }; }
  return { title: `New ${DIFF_TITLE[diff]} puzzle`, go: () => void openPuzzle({ op: "new", diff }) };
}

// ---- keys ------------------------------------------------------------------------------------

function run(id: string) {
  if (!helpEl.hidden) closeHelp();
  if (id === "play") return menuEl.hidden ? openMenu() : closeMenu();
  if (id === "browse") return screen === "browse" ? backToPlay() : openBrowse();
  if (id === "stats") return screen === "stats" ? backToPlay() : void openStats();
  if (id === "keys") return openHelp();
  if (id === "next") return nextPlay().go();
  if (id === "clock") return void send<{ clock: boolean }>({ op: "clock", on: !clockOn }).then((r) => {
    showClock(r?.clock ?? !clockOn);
    flash(clockOn ? "The clock is back" : "The clock is hidden, T brings it back");
  });
  if (id === "auto") return void send<{ auto: boolean }>({ op: "auto", on: !autoOn }).then((r) => {
    autoOn = r?.auto ?? !autoOn;
    if (opened) draw();
    flash(autoOn ? "Auto notes on: take out the ones you rule out" : "Auto notes off, your own notes are back");
  });
  if (id === "check") return void send<{ check: Check }>({ op: "check", mode: check === "mistakes" ? "conflicts" : "mistakes" }).then((r) => {
    check = r?.check ?? check;
    draw();
    flash(check === "mistakes" ? "Mistakes show as you make them" : "Only clashes show now");
  });
  if (!opened) return;
  if (screen !== "play") backToPlay();
  if (id === "pause") return setPaused(!paused);
  if (id === "restart") return ask("Start this puzzle over? The board empties and the clock goes back to zero.", "Start over", restart);
  if (paused) setPaused(false);
  if (st.done) return;
  if (id === "hint") return hintKey();
  if (id === "notes") { notesMode = !notesMode; return draw(); }
  if (id === "pick") return togglePick();
  if ((id === "fill" || id === "clear-notes") && autoOn) return flash("Auto notes are on, C turns them off");
  if (id === "fill") { const n = fillNotes(st); if (n === st) flash("Every note is in"); return commit(n); }
  if (id === "clear-notes") return commit(clearNotes(st));
  if (id === "undo") return undo();
  if (id === "redo") return redo();
  if (id === "erase") return commit(erase(st, givens, at, autoOn));
}

function restart() {
  if (!opened) return;
  void send({ op: "restart", id: opened.id });
  doneEl.hidden = true;
  body.classList.remove("finished", "solved");
  since = undefined;
  undos = []; redos = [];
  closeTip(false);
  st = newPlay(givens);
  pick = 0;
  looks = new Array(81).fill("");
  draw();
  showNearly(false);
  deal();
  syncClock();
  save();
}

const COMBOS: Record<string, string> = {
  "cmd+n": "play", "cmd+o": "browse", "cmd+s": "stats", "cmd+p": "pause", "cmd+z": "undo", "cmd+shift+z": "redo", "cmd+y": "redo",
};
function comboOf(e: KeyboardEvent): string {
  const key = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
  return [(e.metaKey || e.ctrlKey) && "cmd", e.altKey && "alt", e.shiftKey && "shift", key].filter(Boolean).join("+");
}
const MOVES: Record<string, [number, number]> = {
  ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], k: [-1, 0], j: [1, 0], h: [0, -1], l: [0, 1],
};

window.addEventListener("keydown", (e) => {
  if (["Escape", "Shift", "Meta", "Alt", "Control"].includes(e.key)) return;
  if (!askEl.hidden) { e.preventDefault(); return answer(e.key === "Enter"); }
  if (!helpEl.hidden) { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); closeHelp(); } return; }
  const combo = COMBOS[comboOf(e)];
  if (combo) { e.preventDefault(); return run(combo); }
  if (e.metaKey || e.ctrlKey) return; // the panel's
  if (!menuEl.hidden) return menuKey(e);
  if (e.key === "?") { e.preventDefault(); return openHelp(); }
  if (screen === "browse") return browse.key(e);
  if (screen === "stats") return stats.key(e);
  if (screen !== "play" || !opened) return;
  e.preventDefault();
  if (paused) return setPaused(false);
  if (st.done) {
    if (e.key === "Enter") return nextPlay().go();
    return;
  }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(e.code)?.[1];
  if (digit === "0") return run("erase");
  const mod = e.shiftKey || e.altKey;
  if (digit && pick && !mod) return setPick(Number(digit));
  if (digit) return input(Number(digit), notesMode !== mod ? "note" : notesMode ? "place" : "type");
  const mv = MOVES[e.key] ?? (!e.shiftKey ? MOVES[k] : undefined);
  if (mv) return move(...mv);
  if (e.key === "Backspace" || e.key === "Delete" || k === "x") return run("erase");
  if (e.key === "Tab") return nextEmpty(e.shiftKey ? -1 : 1);
  if (e.key === "Enter" && pick && !tip) return stamp(at);
  if (e.key === " " || k === "n") return run("notes");
  if (k === "d") return run("pick");
  if (k === "c") return run("auto");
  if (k === "u") return run(e.shiftKey ? "redo" : "undo");
  if (k === "a") return run(e.shiftKey ? "clear-notes" : "fill");
  if (k === "i" || (e.key === "Enter" && tip)) return run("hint");
  if (k === "p") return run("pause");
  if (k === "t") return run("clock");
});
pal.onAction((id) => run(id));

// ---- the pointer ----------------------------------------------------------------------------

cellsEl.addEventListener("pointerdown", (e) => {
  const i = Number((e.target as HTMLElement).closest<HTMLElement>(".cell")?.dataset.i);
  if (!Number.isInteger(i) || screen !== "play" || st.done) return;
  e.preventDefault();
  if (paused) return setPaused(false);
  if (pick) return stamp(i);
  at = i;
  draw();
});
/** A pad key: a plain click places (writes a note in notes mode), the corner, a right-click or ⌥-click writes a note; in digit first it picks the digit. */
function padPress(e: MouseEvent, alt: boolean) {
  const t = e.target as HTMLElement, d = Number(t.closest<HTMLElement>("[data-d]")?.dataset.d);
  if (!d || screen !== "play") return;
  e.preventDefault();
  if (paused || st.done) return;
  if (pick) return setPick(pick === d ? 0 : d);
  input(d, t.closest(".nz") || notesMode !== (alt || e.altKey || e.shiftKey) ? "note" : "place");
}
padEl.addEventListener("click", (e) => padPress(e, false));
padEl.addEventListener("contextmenu", (e) => padPress(e, true));
$("#tools").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tool]")?.dataset.tool;
  if (t) run(t);
});
$("#tip-go").addEventListener("click", () => hintKey());
$("#tip-close").addEventListener("click", () => closeTip());
$("#clock").addEventListener("click", () => run("pause"));
$("#cover").addEventListener("click", () => setPaused(false));
doneEl.addEventListener("click", (e) => { const go = (e.target as HTMLElement).closest<HTMLElement>("[data-go]")?.dataset.go; if (go) run(go); });

// ---- pause, help, the menu, the question -------------------------------------------------------

function showClock(on: boolean) { clockOn = on; body.classList.toggle("noclock", !on); }

function setPaused(on: boolean) {
  if (st.done && on) return;
  paused = on;
  body.classList.toggle("paused", on);
  syncClock();
  if (on) save();
}

function openHelp() { helpEl.hidden = false; replay(helpEl, "in"); syncClock(); }
function closeHelp() { helpEl.hidden = true; syncClock(); }

let asking: (() => void) | undefined;
function ask(text: string, yes: string, go: () => void) {
  asking = go;
  askEl.querySelector("p")!.textContent = text;
  askEl.querySelector("[data-yes]")!.innerHTML = `${yes} <kbd>⏎</kbd>`;
  askEl.hidden = false;
  replay(askEl, "in");
  syncClock();
}
function answer(ok: boolean) {
  const go = asking;
  asking = undefined;
  askEl.hidden = true;
  syncClock();
  if (ok) go?.();
}
askEl.querySelector("[data-yes]")!.addEventListener("click", () => answer(true));
askEl.querySelector("[data-no]")!.addEventListener("click", () => answer(false));

/** ⌘N: today's puzzle or a new one, per difficulty, in a 2 by 4 grid. */
let menuAt = { diff: 1, row: 0 };
let todays: TodayView | undefined;
async function openMenu() {
  menuAt = { diff: Math.max(0, DIFFS.indexOf(opened?.diff ?? "medium")), row: 0 };
  todays = await send<TodayView>({ op: "today" }).catch(() => undefined);
  if (todays && ["solved", "helped"].includes(todays.days[DIFFS[menuAt.diff]])) menuAt.row = 1;
  drawMenu();
  menuEl.hidden = false;
  replay(menuEl, "in");
  syncClock();
}
function closeMenu() { menuEl.hidden = true; syncClock(); }
function drawMenu() {
  const state = (d: Diff) => todays?.days[d] ?? "new";
  $("#menu-grid").innerHTML = DIFFS.map((d, k) => {
    const s = state(d);
    const daily = s === "solved" || s === "helped" ? `<i class="m solved"><svg viewBox="0 0 16 16"><path d="M4.2 8.4l2.6 2.5 5-5.4"/></svg></i>Done` : s === "started" ? `<i class="m started"></i>Carry on` : "Play";
    return `<div class="col${k === menuAt.diff ? " on" : ""}" data-k="${k}">
      <div class="name"><span class="chip ${d}">${DIFF_TITLE[d]}</span><span class="meter">${"<i></i>".repeat(4)}</span></div>
      <p class="what">${WHAT[d]}</p>
      <button type="button" tabindex="-1" data-k="${k}" data-row="0" class="${k === menuAt.diff && menuAt.row === 0 ? "cur" : ""}"><small>Today's</small><span>${daily}</span></button>
      <button type="button" tabindex="-1" data-k="${k}" data-row="1" class="${k === menuAt.diff && menuAt.row === 1 ? "cur" : ""}"><small>Any time</small><span>New puzzle</span></button>
    </div>`;
  }).join("");
}
/** What each difficulty asks of you, in the menu. */
const WHAT: Record<Diff, string> = {
  easy: "Every digit can be spotted",
  medium: "Notes help",
  hard: "Pairs and locked digits",
  expert: "X-wings and friends",
};
function menuPick() {
  const diff = DIFFS[menuAt.diff];
  closeMenu();
  if (menuAt.row === 0) void openPuzzle({ op: "open", date: todays?.today, diff });
  else void openPuzzle({ op: "new", diff });
}
function menuKey(e: KeyboardEvent) {
  e.preventDefault();
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.key === "Enter" || e.key === " ") return menuPick();
  if (e.key === "ArrowLeft" || k === "h") menuAt.diff = (menuAt.diff + 3) % 4;
  else if (e.key === "ArrowRight" || k === "l") menuAt.diff = (menuAt.diff + 1) % 4;
  else if (e.key === "ArrowUp" || e.key === "ArrowDown" || k === "j" || k === "k" || e.key === "Tab") menuAt.row = 1 - menuAt.row;
  else if (/^[1-4]$/.test(e.key)) menuAt.diff = Number(e.key) - 1;
  else return closeMenu();
  drawMenu();
}
$("#menu").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button[data-k]");
  if (b) { menuAt = { diff: Number(b.dataset.k), row: Number(b.dataset.row) }; return menuPick(); }
  if (!(e.target as HTMLElement).closest(".card")) closeMenu();
});

let noteTimer: ReturnType<typeof setTimeout> | undefined;
/** A line at the foot of whichever screen is up. */
function note(text: string) {
  clearTimeout(noteTimer);
  noteEl.textContent = text;
  noteEl.hidden = false;
  replay(noteEl, "in");
  noteTimer = setTimeout(() => { noteEl.hidden = true; }, 2600);
}

let flashTimer: ReturnType<typeof setTimeout> | undefined, flashing = false;
/** A short line under the progress line, for a moment. */
function flash(text: string) {
  clearTimeout(flashTimer);
  flashing = true;
  footer = undefined; // whatever comes next is drawn
  hintEl.innerHTML = `<span class="flash">${esc(text)}</span>`;
  flashTimer = setTimeout(() => { flashing = false; hintLine(); }, 2400);
}

/**
 * The line under the progress: what digit first does while it is on, else one line for a
 * newcomer (fewer than three solves) until a few digits are down, else nothing.
 */
let footer: string | undefined;
function hintLine() {
  if (flashing) return;
  const newcomer = seasoned === false && st.v.filter((d, i) => d && !givens[i]).length < 6;
  const html = pick
    ? `<span class="mode"><b>${pick}</b><span class="long">Click the lit cells to ${notesMode ? "note" : "place"} it</span><span class="short">Click cells</span></span><span><kbd>D</kbd> done</span>`
    : newcomer
      ? `<span class="long">A second digit in the same cell makes notes</span><span class="short">Second digit: notes</span><span><kbd>?</kbd> keys</span>`
      : "";
  if (html === footer) return;
  footer = html;
  hintEl.innerHTML = html;
}

let dealTimer: ReturnType<typeof setTimeout> | undefined;
/** The cells arrive along the diagonals. */
function deal() {
  for (let i = 0; i < 81; i++) cells[i].el.style.setProperty("--d", `${(rowOf(i) + colOf(i)) * 22}ms`);
  replay(frame, "deal");
  clearTimeout(dealTimer);
  dealTimer = setTimeout(() => frame.classList.remove("deal"), 16 * 22 + 480);
}

/** A class's animation run again from the start (`drop`: classes to take off with it). */
function replay(el: HTMLElement, cls: string, drop: string[] = []) {
  el.classList.remove(cls, ...drop);
  void el.offsetWidth;
  el.classList.add(cls);
}

// ---- screens ------------------------------------------------------------------------------

function show(s: Screen) {
  screen = s;
  for (const el of document.querySelectorAll<HTMLElement>(".screen")) el.classList.toggle("on", el.id === (s === "loading" ? "skeleton" : s));
  body.classList.toggle("loading", s === "loading");
  syncClock();
  titleLine();
}

function titleLine() {
  const what = screen === "browse" ? "Browse" : screen === "stats" ? "Stats" : screen !== "play" || !opened ? ""
    : `${DIFF_TITLE[opened.diff]}, ${opened.today ? "today's" : opened.date ? dateLong(opened.date, true) : "new puzzle"}`;
  pal.title(what ? `Sudoku · ${what}` : "");
}

const browse = new Browse({ send, play: (id) => void openPuzzle({ op: "open", id }), fresh: (diff) => void openPuzzle({ op: "new", diff }), back: () => backToPlay() });
const stats = new Stats({ send, back: () => backToPlay() });

function openBrowse() {
  closeMenu();
  browse.open(opened);
  show("browse");
}
async function openStats() {
  closeMenu();
  await stats.open(opened?.diff ?? "medium");
  show("stats");
}
function backToPlay() {
  if (!opened) return void openPuzzle({ op: "open" });
  show("play");
}
for (const b of document.querySelectorAll<HTMLElement>("[data-back]")) b.addEventListener("click", () => backToPlay());

// ---- loading a puzzle ---------------------------------------------------------------------------

let loadSeq = 0;
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Asks the extension for a puzzle and plays it; the old board leaves first, the skeleton only if it takes a moment. */
async function openPuzzle(msg: { op: "open" | "new"; id?: string; date?: string; diff?: Diff }) {
  const seq = ++loadSeq;
  const leaving = screen === "play" && !!opened;
  if (opened) { syncClock(); save(); }
  if (leaving) body.classList.add("leaving");
  const slow = setTimeout(() => { if (seq === loadSeq) { body.classList.remove("leaving"); show("loading"); } }, leaving ? 420 : 160);
  const started = Date.now();
  const r = await send<Opened | null>(msg).catch((e) => { console.error(e); return null; });
  clearTimeout(slow);
  if (seq !== loadSeq) return;
  if (leaving) await wait(Math.max(0, 170 - (Date.now() - started)));
  body.classList.remove("leaving");
  if (!r) { if (screen === "loading") show(opened ? "play" : "browse"); return note("That puzzle could not be opened"); }
  load(r);
}

function load(o: Opened) {
  opened = o;
  shownSlips = -1;
  givens = fromText(o.givens);
  solution = solve(givens) ?? givens;
  since = undefined;
  paused = false;
  body.classList.remove("paused", "finished", "solved");
  st = o.saved ? decode(o.saved, givens) : newPlay(givens);
  undos = []; redos = [];
  notesMode = false;
  pick = 0;
  closeTip(false);
  doneEl.hidden = true;
  nearlyShown = false;
  nearlyEl.hidden = true;
  at = st.v.findIndex((d) => !d);
  if (at < 0) at = 40;
  const chip = $("#diff");
  chip.textContent = DIFF_TITLE[o.diff];
  chip.className = `chip ${o.diff}`;
  $("#when").textContent = o.today ? "Today's puzzle" : o.date ? dateLong(o.date) : "New puzzle";
  looks = new Array(81).fill("");
  placed = false;
  draw();
  deal();
  show("play");
  if (st.done) { body.classList.add("solved"); showDone(null, true); }
  else showNearly(isFull(st.v));
  tick();
}

// ---- the view's life ------------------------------------------------------------------------------

pal.onHidden(() => { hidden = true; syncClock(); save(); });
pal.onShown(() => { hidden = false; syncClock(); });
function applySettings(s: { check?: Check; clock?: boolean; auto_notes?: boolean }) {
  check = s.check === "mistakes" ? "mistakes" : "conflicts";
  autoOn = s.auto_notes === true;
  showClock(s.clock !== false);
}
pal.onSettings((s) => { applySettings(s); if (opened) draw(); });

async function start() {
  applySettings(await pal.settings());
  const first = openPuzzle({ op: "open" });
  void Promise.all(DIFFS.map((diff) => send<{ solved?: number } | null>({ op: "stats", diff }).catch(() => null)))
    .then((xs) => { seasoned = xs.reduce((n, s) => n + (s?.solved ?? 0), 0) >= 3; if (opened) hintLine(); });
  await Promise.race([first, wait(220)]);
  requestAnimationFrame(() => pal.ready());
}
void start();
