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
// the digit in focus, clashes, a hint) and touches only the cells whose look
// changed.
//
// The clock runs while the board is on screen, unsolved, not paused and not
// hidden (`pal.onHidden`); the time so far rides in every save.
import type { SurfaceKit } from "@zcag/pal";
import {
  applyHint, clearNotes, clockText, decode, digitCounts, encode, erase, fillNotes, hint, isFull, isSolved, newPlay, place, toggleNote, unitsDone, wrongCells,
  type Hint, type Play,
} from "../game.ts";
import type { Check, Opened, SolvedReply, TodayView } from "../index.ts";
import { DIFFS, DIFF_TITLE, UNITS, UNITS_OF, colOf, conflicts, fromText, has, rowOf, solve, type Diff, type Tech } from "../sudoku.ts";
import { confetti } from "./fx.ts";
import { Browse, Stats, dateLong, esc } from "./screens.ts";

declare const pal: SurfaceKit;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const body = document.body;
const frame = $("#frame"), cellsEl = $("#cells"), boxesEl = $("#boxes"), cursorEl = $("#cursor");
const padEl = $("#pad"), timeEl = $("#time"), tipEl = $("#tip"), doneEl = $("#done"), hintEl = $("#hint"), nearlyEl = $("#nearly");
const helpEl = $("#help"), askEl = $("#ask"), menuEl = $("#menu"), noteEl = $("#note");

type Screen = "loading" | "play" | "browse" | "stats";
let screen: Screen = "loading";
let opened: Opened | undefined;
let givens: number[] = new Array(81).fill(0);
let solution: number[] = new Array(81).fill(0);
let st: Play = newPlay(givens);
let at = 40;
let notesMode = false;
let undos: Play[] = [], redos: Play[] = [];
let check: Check = "conflicts";
let paused = false, hidden = false, seasoned = false;

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

/** The cell size that fits: the board as tall as the panel, leaving the side its room (less when compact). */
function fit() {
  const W = innerWidth, H = innerHeight, compact = W < 640;
  const side = compact ? 178 : 280;
  const s = Math.floor(Math.max(24, Math.min((H - 28 - 16) / 9, (W - 30 - 18 - side - 16) / 9)));
  document.documentElement.style.setProperty("--s", `${s}px`);
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
  const focus = st.v[at];
  const clash = conflicts(st.v);
  const wrong = new Set(check === "mistakes" ? wrongCells(st.v, givens, solution) : []);
  const zone = new Set(UNITS_OF[at].flatMap((u) => UNITS[u]));
  const h = tip?.h, stage2 = tip?.stage === 2;
  const area = new Set(h?.area), about = new Set(h ? (stage2 || h.kind !== "step" ? h.cells : []) : []), sources = new Set(stage2 ? h?.sources : []);
  const gone = new Map<number, number>();
  if (stage2) for (const e of h?.step?.elim ?? []) gone.set(e.cell, (gone.get(e.cell) ?? 0) | (1 << (e.digit - 1)));
  const counts = digitCounts(st.v);
  for (let i = 0; i < 81; i++) {
    const d = st.v[i], m = d ? 0 : st.n[i];
    const cls = [
      givens[i] ? "given" : d ? "mine" : "",
      i === at ? "at" : zone.has(i) ? "zone" : "",
      focus && d === focus ? "same" : "",
      clash.has(i) ? "clash" : wrong.has(i) ? "wrong" : "",
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
    if (d !== prevDigit) {
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
  drawPad(counts, clash);
}

function drawPad(counts: number[], clash: Set<number>) {
  const focus = st.v[at];
  padEl.classList.toggle("notes", notesMode);
  for (let d = 1; d <= 9; d++) {
    const b = padEl.children[d - 1] as HTMLElement, left = 9 - counts[d];
    const done = left <= 0 && ![...clash].some((i) => st.v[i] === d);
    b.classList.toggle("done", done);
    b.classList.toggle("focus", focus === d);
    b.classList.toggle("over", left < 0);
    b.querySelector("small")!.textContent = done ? "" : String(Math.abs(left));
  }
  const notesBtn = $("[data-tool=notes]");
  notesBtn.classList.toggle("on", notesMode);
  notesBtn.querySelector(".pill")!.textContent = notesMode ? "On" : "Off";
  $("[data-tool=undo]").classList.toggle("off", !undos.length);
  $("#slips").textContent = check === "mistakes" && st.mistakes ? `${st.mistakes} ${st.mistakes === 1 ? "mistake" : "mistakes"}` : "";
}

function buildPad() {
  padEl.innerHTML = Array.from({ length: 9 }, (_, k) => `<button type="button" tabindex="-1" data-d="${k + 1}" style="--nx:${k % 3};--ny:${(k / 3) | 0}"><b>${k + 1}</b><small></small><svg viewBox="0 0 16 16"><path d="M4.2 8.4l2.6 2.5 5-5.4"/></svg></button>`).join("");
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
  if (tip && (prev.v.some((d, i) => d !== next.v[i]) || prev.n.some((m, i) => m !== next.n[i]))) closeTip(false);
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

function input(d: number, note: boolean) {
  if (st.done || paused) return;
  if (givens[at]) return flash(`That ${givens[at]} is a clue`);
  if (note) {
    if (st.v[at]) return flash("Erase the digit first to pencil in marks");
    return commit(toggleNote(st, givens, at, d));
  }
  commit(place(st, givens, at, d, solution));
}

function undo() {
  const prev = undos.pop();
  if (!prev || st.done) return;
  redos.push(st);
  const cell = st.v.findIndex((d, i) => d !== prev.v[i]);
  if (cell >= 0) at = cell;
  settle(st, { ...st, v: prev.v, n: prev.n }, at);
}
function redo() {
  const next = redos.pop();
  if (!next || st.done) return;
  undos.push(st);
  const cell = st.v.findIndex((d, i) => d !== next.v[i]);
  if (cell >= 0) at = cell;
  settle(st, { ...st, v: next.v, n: next.n }, at);
}

function move(dr: number, dc: number) {
  at = ((rowOf(at) + dr + 9) % 9) * 9 + ((colOf(at) + dc + 9) % 9);
  draw();
}
/** The next (or previous) empty cell in reading order. */
function nextEmpty(by: 1 | -1) {
  for (let k = 1; k <= 81; k++) {
    const i = (at + by * k + 81 * 2) % 81;
    if (!st.v[i]) { at = i; return draw(); }
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
    tip = { h: hint(givens, st, solution), stage: 1 };
    // A wrong digit or a stuck board goes straight to the reason.
    if (tip.h.kind !== "step") tip.stage = 2;
  } else if (tip.stage === 1) tip.stage = 2;
  else {
    const h = tip.h;
    closeTip(false);
    if (h.cell !== undefined) at = h.cell;
    return commit(applyHint(st, givens, h, solution), h.cell ?? at);
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
  if (id === "fill") { const n = fillNotes(st); if (n === st) flash("Every pencil mark is in"); return commit(n); }
  if (id === "clear-notes") return commit(clearNotes(st));
  if (id === "undo") return undo();
  if (id === "redo") return redo();
  if (id === "erase") return commit(erase(st, givens, at));
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
  if (digit) return input(Number(digit), notesMode !== (e.shiftKey || e.altKey));
  const mv = MOVES[e.key] ?? (!e.shiftKey ? MOVES[k] : undefined);
  if (mv) return move(...mv);
  if (e.key === "Backspace" || e.key === "Delete" || k === "x") return run("erase");
  if (e.key === "Tab") return nextEmpty(e.shiftKey ? -1 : 1);
  if (e.key === " " || k === "n") return run("notes");
  if (k === "u") return run(e.shiftKey ? "redo" : "undo");
  if (k === "a") return run(e.shiftKey ? "clear-notes" : "fill");
  if (k === "i" || (e.key === "Enter" && tip)) return run("hint");
  if (k === "p") return run("pause");
});
pal.onAction((id) => run(id));

// ---- the pointer ----------------------------------------------------------------------------

cellsEl.addEventListener("pointerdown", (e) => {
  const i = Number((e.target as HTMLElement).closest<HTMLElement>(".cell")?.dataset.i);
  if (!Number.isInteger(i) || screen !== "play" || st.done) return;
  e.preventDefault();
  if (paused) return setPaused(false);
  at = i;
  draw();
});
padEl.addEventListener("click", (e) => {
  const d = Number((e.target as HTMLElement).closest<HTMLElement>("[data-d]")?.dataset.d);
  if (d) input(d, notesMode !== (e.shiftKey || e.altKey));
});
$("#tools").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tool]")?.dataset.tool;
  if (t) run(t === "notes" ? "notes" : t);
});
$("#tip-go").addEventListener("click", () => hintKey());
$("#tip-close").addEventListener("click", () => closeTip());
$("#clock").addEventListener("click", () => run("pause"));
$("#cover").addEventListener("click", () => setPaused(false));
doneEl.addEventListener("click", (e) => { const go = (e.target as HTMLElement).closest<HTMLElement>("[data-go]")?.dataset.go; if (go) run(go); });

// ---- pause, help, the menu, the question -------------------------------------------------------

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
  medium: "Pencil marks help",
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

let flashTimer: ReturnType<typeof setTimeout> | undefined;
/** A short line in place of the key hint. */
function flash(text: string) {
  clearTimeout(flashTimer);
  hintEl.innerHTML = `<span class="flash">${esc(text)}</span>`;
  flashTimer = setTimeout(hintLine, 2200);
}

/** The one line of guidance: the main keys for a newcomer, just `?` once a few are solved. */
function hintLine() {
  hintEl.innerHTML = seasoned
    ? `<span><kbd>?</kbd> every key</span>`
    : `<span class="long"><kbd>1</kbd>–<kbd>9</kbd> place</span><span><kbd>⇧</kbd> digit: pencil mark</span><span><kbd>I</kbd> hint</span><span><kbd>?</kbd> keys</span>`;
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
  givens = fromText(o.givens);
  solution = solve(givens) ?? givens;
  since = undefined;
  paused = false;
  body.classList.remove("paused", "finished", "solved");
  st = o.saved ? decode(o.saved, givens) : newPlay(givens);
  undos = []; redos = [];
  notesMode = false;
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
  hintLine();
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
pal.onSettings((s) => { check = (s as { check?: Check }).check === "mistakes" ? "mistakes" : "conflicts"; if (opened) draw(); });

async function start() {
  check = ((await pal.settings()) as { check?: Check }).check === "mistakes" ? "mistakes" : "conflicts";
  const first = openPuzzle({ op: "open" });
  void Promise.all(DIFFS.map((diff) => send<{ solved?: number } | null>({ op: "stats", diff }).catch(() => null)))
    .then((xs) => { seasoned = xs.reduce((n, s) => n + (s?.solved ?? 0), 0) >= 3; if (opened) hintLine(); });
  await Promise.race([first, wait(220)]);
  requestAnimationFrame(() => pal.ready());
}
void start();
