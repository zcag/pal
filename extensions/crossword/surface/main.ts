// Crossword's page (the view's `surface`). The rules are game.ts's, the same
// the host tests: the page holds one `Play`, turns every key and click into
// a call there, draws what changed and hands the solve to the extension
// (`pal.send({ op: "save" })`) after every change, so it is on disk before
// the next key. The puzzles, the lists and the record are the extension's
// (index.ts); this page only asks.
//
// The grid is three layers of one geometry: the squares' colours under, the
// cursor (one element that glides from square to square) in between, and
// the numbers, letters and marks over. A key redraws only the squares whose
// look changed. The clue bar has a fixed height and shrinks a long clue's
// type to fit, so nothing moves while you type.
//
// The clock is the page's: it runs while the grid is on screen and not
// solved, paused or hidden (`pal.onHidden`), and the time so far rides in
// every save.
import type { SurfaceKit } from "@zcag/pal";
import {
  REVEALED, RIGHT, WRONG, arrow, backspace, check, clear, click, clockText, crossing, current, decode, del, encode, gridOf, isBlock, newPlay, nextWord, reveal,
  proper, selectWord, status, toggle, type, wordFull, wrongIn, type Arrow, type Grid, type Play, type Puzzle, type Scope,
} from "../game.ts";
import type { Offline, Opened, SolvedReply, SourcesView } from "../index.ts";
import { Browse, Stats, showOffline, dateLong } from "./screens.ts";

declare const pal: SurfaceKit;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const body = document.body;
const frame = $("#frame"), under = $("#under"), over = $("#over"), mediaEl = $("#media"), cursorEl = $("#cursor"), boardEl = $("#board");
const clueN = $("#clue-n"), clueText = $("#clue-text"), clueBar = $("#clue"), timeEl = $("#time");
const doneEl = $("#done"), nearlyEl = $("#nearly"), hintEl = $("#hint"), helpEl = $("#help"), askEl = $("#ask"), photoEl = $("#photo"), noteEl = $("#note");
const lists = { across: $("#lists [data-dir=across] ol"), down: $("#lists [data-dir=down] ol") };

type Screen = "loading" | "play" | "browse" | "stats" | "offline";
let screen: Screen = "loading";
let opened: Opened | undefined;
let p: Puzzle;
let g: Grid;
let st: Play;
let autocheck = false;
let hidden = false;
let paused = false;
let seasoned = false;

// ---- the extension ---------------------------------------------------------------

const send = <T = unknown>(msg: unknown) => pal.send(msg) as Promise<T>;
const isOffline = (r: unknown): r is Offline => !!r && typeof r === "object" && "error" in r;
function save() {
  if (!opened) return;
  send({ op: "save", id: p.id, play: encode({ ...st, ms: elapsed() }, p) }).catch((e) => console.error(`crossword: save: ${e}`));
}

// ---- the clock -----------------------------------------------------------------------

let since: number | undefined;
const elapsed = () => st.ms + (since !== undefined ? Date.now() - since : 0);
const shouldRun = () => screen === "play" && !!opened && !st.done && !paused && !hidden && helpEl.hidden && askEl.hidden;
/** The clock started or stopped to match what is on screen; a stop folds the stretch into the solve. */
function syncClock() {
  const want = shouldRun();
  if (want && since === undefined) since = Date.now();
  else if (!want && since !== undefined) { st = { ...st, ms: st.ms + Date.now() - since }; since = undefined; }
  tick();
}
function tick() { if (opened) timeEl.textContent = clockText(st.done ? st.done.ms : elapsed()); }
// The time also rides a save every few seconds while the clock runs, so leaving with Escape (no key after the last) loses at most that.
let ticks = 0;
setInterval(() => { if (since === undefined) return; tick(); if (++ticks % 20 === 0) save(); }, 250);
addEventListener("pagehide", () => { syncClock(); save(); });

// ---- the grid ------------------------------------------------------------------------

let unders: HTMLElement[] = [], overs: HTMLElement[] = [];
let looks: string[] = [];

/**
 * The arrangement and the square size: whichever of the three layouts (style.css, "The play
 * screen") gives the squares the most room. Side needs a column of 230 px beside the grid (200
 * compact), top one of 190 for its lists; top without lists needs nothing beside it.
 */
function fit() {
  if (!p) return;
  const W = innerWidth, H = innerHeight, compact = W < 640;
  const clueH = Math.min(18, Math.max(14, W * 0.02)) * 2.56 + 14;
  const fits = (h: number, w: number) => Math.floor(Math.min((h - 4 - (p.h - 1)) / p.h, (w - 4 - (p.w - 1)) / p.w));
  const modes = [
    { top: false, lists: true, c: fits(H - 26, W - 30 - 20 - (compact ? 200 : 230)) },
    { top: true, lists: true, c: fits(H - 26 - clueH - 10, W - 30 - 20 - 190) },
    { top: true, lists: false, c: fits(H - 26 - clueH - 10 - 34, W - 30) },
  ];
  const best = modes.reduce((a, b) => (b.c > a.c + 1 ? b : a));
  const c = Math.max(12, Math.min(104, best.c));
  body.classList.toggle("top", best.top);
  body.classList.toggle("nolists", !best.lists);
  if (best.lists) body.classList.remove("clues-open");
  const side = W - 30 - 20 - (c * p.w + p.w + 3);
  body.classList.toggle("onecol", best.top || side < 300);
  document.documentElement.style.setProperty("--c", `${c}px`);
  // A small square gives its number the top-left and its letter a little less size, set lower, so the two never touch.
  document.documentElement.style.setProperty("--ls", String(c < 40 ? 0.54 : 0.6));
  document.documentElement.style.setProperty("--lo", String(c < 40 ? 0.14 : 0.075));
  boardEl.style.width = `${c * p.w + p.w - 1 + 4}px`;
  moveCursor(true);
  fitClue();
}
new ResizeObserver(() => fit()).observe(body);

function build() {
  under.style.setProperty("--w", String(p.w));
  over.style.setProperty("--w", String(p.w));
  const circles = new Set(p.circles), right = new Set(p.bars?.right), below = new Set(p.bars?.below);
  unders = []; overs = []; looks = [];
  const uf = document.createDocumentFragment(), of = document.createDocumentFragment();
  for (let i = 0; i < p.w * p.h; i++) {
    const u = document.createElement("div"), o = document.createElement("div");
    u.className = isBlock(p, i) ? "u b" : `u${circles.has(i) ? " circ" : ""}`;
    o.className = `o${isBlock(p, i) ? " b" : ""}${right.has(i) ? " br" : ""}${below.has(i) ? " bb" : ""}`;
    o.dataset.i = String(i);
    if (!isBlock(p, i)) o.innerHTML = `${g.numbers[i] ? `<i>${g.numbers[i]}</i>` : ""}<span></span>`;
    // The deal: squares arrive along the diagonal.
    const d = `${(Math.floor(i / p.w) + (i % p.w)) * 28}ms`;
    u.style.setProperty("--d", d);
    o.style.setProperty("--d", d);
    unders.push(u); overs.push(o); looks.push(isBlock(p, i) ? "#" : "");
    uf.appendChild(u); of.appendChild(o);
  }
  under.replaceChildren(uf);
  over.replaceChildren(of);
  // A photo laid over its block of squares; a click shows it large.
  mediaEl.replaceChildren(...(p.media ?? []).map((m) => {
    const img = document.createElement("img");
    img.src = m.src;
    img.alt = "The puzzle's photo";
    img.title = "Click to see it large";
    for (const [k, v] of Object.entries({ "--r": m.row, "--k": m.col, "--rs": m.rows, "--ks": m.cols })) img.style.setProperty(k, String(v));
    img.addEventListener("click", () => showPhoto(m.src));
    return img;
  }));
  buildLists();
  fit();
}

/** A square's letter layer: the letter and its marks. */
const lookOf = (i: number) => (isBlock(p, i) ? "#" : `${st.fill[i] || "."}${st.mark[i]}`);

function paintLetter(i: number, anim: string) {
  const o = overs[i], m = st.mark[i];
  o.querySelector("span")!.textContent = st.fill[i];
  o.classList.toggle("wrong", !!(m & WRONG) && !!st.fill[i]);
  o.classList.toggle("rev", !!(m & REVEALED));
  o.classList.toggle("right", !!(m & RIGHT));
  if (anim) replay(o, anim, ["pop", "flip", "slash"]);
}

let lastWord = -1, lastCross = -1, lastAt = -1;
function draw(prev?: Play, anim: "type" | "reveal" | "check" | "" = "") {
  // Letters and marks: only the squares whose look changed.
  for (let i = 0; i < overs.length; i++) {
    const look = lookOf(i);
    if (look === looks[i]) continue;
    const was = looks[i];
    looks[i] = look;
    const wasLetter = was[0] && was[0] !== "." ? was[0] : "";
    const a = !prev ? "" : anim === "reveal" && st.mark[i] & REVEALED ? "flip" : anim === "check" && st.mark[i] & WRONG ? "slash" : st.fill[i] && st.fill[i] !== wasLetter ? "pop" : "";
    paintLetter(i, a);
  }
  // The word, the crossing word, the cursor.
  const w = current(g, st), x = crossing(g, st);
  const wi = w ? g.words.indexOf(w) : -1, xi = x ? g.words.indexOf(x) : -1;
  const inWord = new Set(w?.cells), inCross = new Set(x?.cells);
  for (let i = 0; i < unders.length; i++) {
    if (isBlock(p, i)) continue;
    unders[i].classList.toggle("w", inWord.has(i));
    unders[i].classList.toggle("x", !inWord.has(i) && inCross.has(i));
  }
  overs[lastAt]?.classList.remove("at");
  overs[st.at]?.classList.add("at");
  lastAt = st.at;
  moveCursor();
  if (wi !== lastWord || xi !== lastCross) showClue(wi, xi, wi !== lastWord);
  lastWord = wi; lastCross = xi;
  markLists();
}

let placed = false;
function moveCursor(jump = false) {
  if (!p) return;
  const c = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--c")) || 60;
  const r = Math.floor(st.at / p.w), col = st.at % p.w;
  const snap = jump || !placed;
  if (snap) cursorEl.style.transition = "none";
  cursorEl.style.transform = `translate(${col * (c + 1)}px, ${r * (c + 1)}px)`;
  if (snap) { void cursorEl.offsetWidth; cursorEl.style.transition = ""; placed = true; }
}

// ---- the clues -----------------------------------------------------------------------

const clueEls: HTMLElement[] = [];
function buildLists() {
  clueEls.length = 0;
  for (const dir of ["across", "down"] as const) {
    const frag = document.createDocumentFragment();
    g.words.forEach((w, wi) => {
      if (w.dir !== dir) return;
      const li = document.createElement("li");
      li.dataset.w = String(wi);
      li.innerHTML = `<b>${w.n}</b><span></span>`;
      li.querySelector("span")!.textContent = w.clue || "·";
      clueEls[wi] = li;
      frag.appendChild(li);
    });
    lists[dir].replaceChildren(frag);
    lists[dir].scrollTop = 0;
  }
  lastWord = lastCross = -1;
}

function markLists() {
  const w = current(g, st), x = crossing(g, st);
  g.words.forEach((word, wi) => {
    const li = clueEls[wi];
    li.classList.toggle("on", word === w);
    li.classList.toggle("cross", word === x);
    li.classList.toggle("full", wordFull(st, word));
  });
}

/** The clue bar: the word's number and direction and its clue, the type shrunk to fit its lines. */
function showClue(wi: number, xi: number, changed: boolean) {
  const w = g.words[wi];
  clueN.innerHTML = w ? `${w.n}<small>${w.dir === "across" ? "A" : "D"}</small>` : "";
  clueText.textContent = w?.clue || "";
  if (changed) replay(clueBar, "swap");
  fitClue();
  // Keep the active clue and the crossing one in view in their lists.
  for (const i of [wi, xi]) {
    const li = clueEls[i];
    if (!li) continue;
    // The least scroll that shows it whole, clear of the faded edges, landing on a clue's top so none shows cut in half.
    const ol = li.parentElement!, bottom = li.offsetTop + li.offsetHeight + 14;
    if (li.offsetTop - 4 < ol.scrollTop) ol.scrollTo({ top: Math.max(0, li.offsetTop - 4), behavior: "smooth" });
    else if (bottom > ol.scrollTop + ol.clientHeight) {
      const first = [...ol.children].find((c) => (c as HTMLElement).offsetTop - 4 >= bottom - ol.clientHeight) as HTMLElement | undefined;
      ol.scrollTo({ top: (first ?? li).offsetTop - 4, behavior: "smooth" });
    }
  }
}
function fitClue() {
  const base = parseFloat(getComputedStyle(clueBar).getPropertyValue("--clue-size")) || 16;
  let size = base;
  clueText.style.fontSize = `${size}px`;
  while (size > 11 && clueText.scrollHeight > clueText.clientHeight + 1) clueText.style.fontSize = `${(size -= 0.5)}px`;
}

// ---- a change ------------------------------------------------------------------------

/** The next state: drawn, saved, and judged (solved, or full and wrong). */
function commit(next: Play, anim: "type" | "reveal" | "check" | "" = "") {
  if (next === st) return;
  const prev = st;
  st = next;
  draw(prev, anim);
  const s = status(g, st);
  showNearly(s === "wrong");
  if (s === "solved" && !st.done) void finish();
  else save();
}

let nearlyShown = false;
function showNearly(on: boolean) {
  if (on === nearlyShown) return;
  nearlyShown = on;
  if (on) { nearlyEl.hidden = false; replay(nearlyEl, "in", ["out"]); }
  else { replay(nearlyEl, "out", ["in"]); setTimeout(() => { if (!nearlyShown) nearlyEl.hidden = true; }, 200); }
}

// ---- the finish ----------------------------------------------------------------------

async function finish() {
  syncClock();
  const ms = elapsed();
  since = undefined;
  // A Turkish grid solved with plain letters shows the answers' own (S typed for Ş shows Ş).
  st = { ...proper(g, st), ms, done: { ms, at: Date.now() } };
  draw(st);
  tick();
  body.classList.add("solved");
  const wave = waveGrid();
  const reply = await send<SolvedReply | null>({ op: "solved", id: p.id, play: encode(st, p) }).catch(() => null);
  setTimeout(() => showDone(reply), wave);
}

/** Every letter hops in turn along the diagonals, the squares light up behind them; ms until it is over. */
function waveGrid(): number {
  const step = 60;
  for (let i = 0; i < overs.length; i++) {
    if (isBlock(p, i)) continue;
    const d = `${(Math.floor(i / p.w) + (i % p.w)) * step}ms`;
    for (const el of [overs[i], unders[i]]) { el.style.setProperty("--d", d); replay(el, "wave"); }
  }
  return (p.w + p.h - 2) * step + 700;
}

function showDone(reply: SolvedReply | null, again = false) {
  const d = st.done;
  if (!d) return;
  $("#done-what").textContent = st.helped ? "Finished, with help" : again ? "Solved" : "Solved!";
  $("#done-time").textContent = clockText(d.ms);
  const tags: string[] = [];
  if (reply?.best) tags.push(`<span class="gold">A new best</span>`);
  else if (reply?.stats.best !== undefined && !st.helped) tags.push(`<span>Best ${clockText(reply.stats.best)}</span>`);
  if (reply && p.date && reply.stats.today && reply.stats.streak > 1) tags.push(`<span>${reply.stats.streak}-day streak</span>`);
  if (st.helped) tags.push(`<span>Revealed</span>`);
  else if (st.checked) tags.push(`<span>Checked</span>`);
  if (reply && !reply.first) tags.push(`<span>A replay</span>`);
  $("#done-tags").innerHTML = tags.join("");
  const note = $("#done-note");
  note.textContent = p.note ?? "";
  note.hidden = !p.note;
  doneEl.hidden = false;
  replay(doneEl, "in");
  body.classList.add("finished");
}

// ---- keys ----------------------------------------------------------------------------

const ARROWS: Record<string, Arrow> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

function scoped(kind: "check" | "reveal", scope: Scope) {
  if (st.done) return;
  if (kind === "check") {
    if (!wrongIn(g, st, scope).length) flash(scope === "square" ? "That square looks right" : scope === "word" ? "That word looks right so far" : "No mistakes so far");
    return commit(check(g, st, scope), "check");
  }
  const go = () => commit(reveal(g, st, scope), "reveal");
  if (scope === "puzzle") ask("Reveal the whole grid? It counts as finished with help.", "Reveal", go);
  else go();
}

/** An action by id: from ⌘K (`pal.onAction`), a key, or a button. */
function run(id: string) {
  if (!helpEl.hidden) closeHelp();
  if (id === "next") return void goNext();
  if (id === "browse") return screen === "browse" ? backToPlay() : openBrowse();
  if (id === "stats") return screen === "stats" ? backToPlay() : void openStats();
  if (id === "keys") return openHelp();
  if (id === "site") return void (opened && send({ op: "site", id: p.id }));
  if (id === "autocheck") return void send<{ autocheck: boolean }>({ op: "autocheck", on: !autocheck }).then((r) => { autocheck = !!r?.autocheck; flash(`Autocheck ${autocheck ? "on" : "off"}`); });
  if (!opened) return;
  if (screen !== "play") backToPlay();
  if (id === "pause") return setPaused(!paused);
  if (id === "clues") { body.classList.toggle("clues-open"); return flash(body.classList.contains("nolists") ? "" : "Every clue is beside the grid already"); }
  if (paused) setPaused(false);
  const [kind, scope] = id.split("-") as [string, Scope];
  if (kind === "check" || kind === "reveal") return scoped(kind, scope);
  if (id === "clear-word") return commit(clear(g, st, "word"));
  if (id === "clear-puzzle") return ask("Clear every square you filled?", "Clear", () => commit(clear(g, st, "puzzle")));
  if (id === "restart") return ask("Start this puzzle over? The grid empties and the clock goes back to zero.", "Start over", restart);
}

function restart() {
  void send({ op: "restart", id: p.id });
  doneEl.hidden = true;
  body.classList.remove("finished", "solved");
  since = undefined;
  st = newPlay(g);
  draw(st);
  showNearly(false);
  deal();
  syncClock();
  save();
}

const COMBOS: Record<string, string> = {
  "cmd+n": "next", "cmd+o": "browse", "cmd+s": "stats", "cmd+p": "pause", "cmd+shift+o": "site",
  "cmd+e": "check-word", "cmd+alt+e": "check-square", "cmd+shift+e": "check-puzzle",
  "cmd+u": "reveal-word", "cmd+alt+u": "reveal-square", "cmd+shift+u": "reveal-puzzle",
  "alt+backspace": "clear-word", "cmd+alt+backspace": "clear-puzzle", "cmd+l": "clues",
};
function comboOf(e: KeyboardEvent): string {
  const key = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
  return [(e.metaKey || e.ctrlKey) && "cmd", e.altKey && "alt", e.shiftKey && "shift", key].filter(Boolean).join("+");
}

window.addEventListener("keydown", (e) => {
  if (["Escape", "Shift", "Meta", "Alt", "Control"].includes(e.key)) return;
  if (!askEl.hidden) { e.preventDefault(); return answer(e.key === "Enter"); }
  if (!photoEl.hidden && !e.metaKey && !e.ctrlKey) { e.preventDefault(); photoEl.hidden = true; return; }
  if (!helpEl.hidden) { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); closeHelp(); } return; }
  const combo = COMBOS[comboOf(e)];
  if (combo) { e.preventDefault(); return run(combo); }
  if (e.metaKey || e.ctrlKey) return; // the panel's
  if (e.key === "?") { e.preventDefault(); return openHelp(); }
  if (screen === "browse") return browse.key(e);
  if (screen === "stats") return stats.key(e);
  if (screen === "offline") return offlineKey(e);
  if (screen !== "play" || !opened) return;
  e.preventDefault();
  if (paused) { if (e.key === "Enter" || e.key === " " || e.key.length === 1) setPaused(false); return; }
  if (st.done) {
    if (e.key === "Enter") return void goNext();
    return;
  }
  // Any letter: a Turkish keyboard's ş and ğ, or one the Option key makes (⌥c is ç on a US layout).
  if (/^[\p{L}0-9]$/u.test(e.key) && (!e.altKey || /[^\x00-\x7f]/.test(e.key))) {
    return commit(type(g, st, e.key, autocheck), "type");
  }
  if (e.key === "Backspace") return commit(backspace(g, st));
  if (e.key === "Delete") return commit(del(g, st));
  if (ARROWS[e.key]) return commit(arrow(g, st, ARROWS[e.key]));
  if (e.key === " ") return commit(toggle(g, st));
  if (e.key === "Tab" || e.key === "Enter") return commit(nextWord(g, st, e.shiftKey ? -1 : 1));
});
pal.onAction((id) => run(id));

// ---- the pointer ---------------------------------------------------------------------

over.addEventListener("pointerdown", (e) => {
  const i = Number((e.target as HTMLElement).closest<HTMLElement>(".o")?.dataset.i);
  if (!Number.isInteger(i) || isBlock(p, i) || screen !== "play" || st.done) return;
  e.preventDefault();
  if (paused) return setPaused(false);
  commit(click(g, st, i));
});
for (const ol of Object.values(lists)) ol.addEventListener("click", (e) => {
  const wi = Number((e.target as HTMLElement).closest<HTMLElement>("li")?.dataset.w);
  if (Number.isInteger(wi) && !st.done) { if (paused) setPaused(false); commit(selectWord(g, st, wi)); }
});
$("#credit").addEventListener("click", () => run("site"));
$("#clock").addEventListener("click", () => run("pause"));
$("#cover").addEventListener("click", () => setPaused(false));
doneEl.addEventListener("click", (e) => { const go = (e.target as HTMLElement).closest<HTMLElement>("[data-go]")?.dataset.go; if (go) run(go); });

// ---- pause, help, the question -------------------------------------------------------------

function setPaused(on: boolean) {
  if (st?.done && on) return;
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

/** The puzzle's photo large, over everything; any key or click puts it away. */
function showPhoto(src: string) {
  photoEl.querySelector("img")!.src = src;
  photoEl.hidden = false;
  replay(photoEl, "in");
}
photoEl.addEventListener("click", () => { photoEl.hidden = true; });

let noteTimer: ReturnType<typeof setTimeout> | undefined;
/** A line at the foot of whichever screen is up (a day with no puzzle, nothing left to play). */
function note(text: string) {
  clearTimeout(noteTimer);
  noteEl.textContent = text;
  noteEl.hidden = false;
  replay(noteEl, "in");
  noteTimer = setTimeout(() => { noteEl.hidden = true; }, 2600);
}

let flashTimer: ReturnType<typeof setTimeout> | undefined;
/** A short line in place of the key hint (a check that found nothing, autocheck turned on). */
function flash(text: string) {
  clearTimeout(flashTimer);
  hintEl.innerHTML = `<span class="flash">${text}</span>`;
  flashTimer = setTimeout(hint, 2000);
}

/** The one line of guidance: the main keys for a newcomer, just `?` once a few are solved. */
function hint() {
  const tr = p?.lang === "tr";
  hintEl.innerHTML = seasoned
    ? `<span><kbd>?</kbd> every key</span>`
    : `${tr ? `<span class="long">Plain letters: c turns ç where it is one</span>` : `<span class="long">Type to fill</span><span class="long"><kbd>Space</kbd> turn</span>`}<span><kbd>Tab</kbd> next clue</span><span><kbd>?</kbd> every key</span>`;
}

let dealTimer: ReturnType<typeof setTimeout> | undefined;
/** The squares arrive along the diagonals; the class goes once they are in, so a letter's own animations are not held under it. */
function deal() {
  replay(frame, "deal");
  clearTimeout(dealTimer);
  dealTimer = setTimeout(() => frame.classList.remove("deal"), (p.w + p.h) * 28 + 480);
}

/** A class's animation run again from the start (`drop`: classes to take off with it). */
function replay(el: HTMLElement, cls: string, drop: string[] = []) {
  el.classList.remove(cls, ...drop);
  void el.offsetWidth;
  el.classList.add(cls);
}

// ---- screens ------------------------------------------------------------------------

function show(s: Screen) {
  screen = s;
  for (const el of document.querySelectorAll<HTMLElement>(".screen")) el.classList.toggle("on", el.id === (s === "loading" ? "skeleton" : s));
  body.classList.toggle("loading", s === "loading");
  syncClock();
  titleLine();
}

function titleLine() {
  const tr = opened?.puzzle.source !== undefined && opened.puzzle.source !== "crosshare";
  const day = !opened ? "" : opened.today ? "today" : p.date ? dateLong(p.date, true) : "";
  const what = screen === "browse" ? "Browse" : screen === "stats" ? "Stats" : screen !== "play" || !opened ? ""
    : tr ? `${opened.credit}${day ? `, ${day}` : ""}` : opened.today ? "Today's mini" : p.date ? `Daily mini, ${day}` : "Mini";
  pal.title(what ? `Crossword · ${what}` : "");
}

const browse = new Browse({ send, play: (id, date) => void openPuzzle({ op: "open", id, date }), back: () => backToPlay() });
const stats = new Stats({ send, back: () => backToPlay() });
/** The sources, and the one the settings open on: Browse's and Stats' tabs. */
let sources: SourcesView = { sources: [{ id: "crosshare", title: "Crosshare", archive: false }], source: "crosshare" };
const currentSource = () => opened?.puzzle.source ?? sources.source;

function openBrowse() {
  browse.open(sources, opened?.puzzle);
  show("browse");
}
async function openStats() {
  await stats.open(sources, currentSource());
  show("stats");
}
function backToPlay() {
  if (!opened) return void openPuzzle({ op: "open" });
  show("play");
}

let offlineCursor = 0;
let offlineItems: { id: string }[] = [];
function offlineKey(e: KeyboardEvent) {
  e.preventDefault();
  if (e.key === "r" || e.key === "R") return void openPuzzle({ op: "open" });
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    offlineCursor = Math.max(0, Math.min(offlineItems.length - 1, offlineCursor + (e.key === "ArrowDown" ? 1 : -1)));
    document.querySelectorAll("#offline-list button").forEach((b, i) => b.classList.toggle("hl", i === offlineCursor));
  }
  if (e.key === "Enter" && offlineItems[offlineCursor]) return void openPuzzle({ op: "open", id: offlineItems[offlineCursor].id });
}
$("#offline").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("[data-retry]")) return void openPuzzle({ op: "open" });
  const id = t.closest<HTMLElement>("[data-id]")?.dataset.id;
  if (id) void openPuzzle({ op: "open", id });
});
for (const b of document.querySelectorAll<HTMLElement>("[data-back]")) b.addEventListener("click", () => backToPlay());

// ---- loading a puzzle -------------------------------------------------------------------

let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
let loadSeq = 0;
const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Asks the extension for a puzzle (`open`, `next`) and plays it; the skeleton shows only if it takes a moment. */
async function openPuzzle(msg: { op: "open" | "next"; id?: string; date?: string; from?: string; source?: string }) {
  const seq = ++loadSeq;
  const leaving = screen === "play" && !!opened;
  if (opened) { syncClock(); save(); }
  if (leaving) body.classList.add("leaving");
  const slow = setTimeout(() => { if (seq === loadSeq) { body.classList.remove("leaving"); show("loading"); } }, leaving ? 420 : 160);
  const started = Date.now();
  const r = await send<Opened | Offline | { none: true } | null>(msg).catch((e) => ({ error: String(e), source: "", opened: [] }) as Offline);
  clearTimeout(slow);
  if (seq !== loadSeq) return;
  // The old grid finishes leaving before the new one deals in.
  if (leaving) await wait(Math.max(0, 170 - (Date.now() - started)));
  body.classList.remove("leaving");
  if (!r) return;
  if ("none" in r) { show(opened ? "play" : "offline"); return note("Nothing unplayed nearby: ⌘O browses the archive"); }
  // A day the paper had no puzzle is a note on the screen you are on, not the offline page.
  if (isOffline(r) && /no .*puzzle|not found/i.test(r.error) && (opened || screen === "browse")) { if (screen === "loading") show(opened ? "play" : "browse"); return note(r.error === "not found" ? "No puzzle that day" : r.error); }
  if (isOffline(r)) {
    offlineItems = r.opened;
    offlineCursor = 0;
    showOffline(r);
    return show("offline");
  }
  load(r);
}

const goNext = () => openPuzzle({ op: "next", from: opened?.puzzle.id, source: currentSource() });

function load(o: Opened) {
  opened = o;
  p = o.puzzle;
  g = gridOf(p);
  since = undefined;
  paused = false;
  body.classList.remove("paused", "finished", "solved");
  st = o.saved ? decode(o.saved, g) : newPlay(g);
  doneEl.hidden = true;
  nearlyShown = false;
  nearlyEl.hidden = true;
  $("#ptitle").textContent = p.title;
  $("#ptitle").title = p.title;
  $("#credit").innerHTML = `${p.author ? `by ${esc(p.author)} · ` : ""}<u>${esc(o.credit)}</u><svg viewBox="0 0 16 16"><path d="M6 4h6v6M12 4 5 11"/></svg>`;
  $("#credit").title = `Open it on ${o.credit}'s site`;
  body.classList.toggle("tr", p.lang === "tr");
  body.classList.remove("clues-open");
  hint();
  placed = false;
  build();
  draw();
  deal();
  show("play");
  if (st.done) { body.classList.add("solved"); showDone(null, true); }
  else if (status(g, st) === "wrong") showNearly(true);
  tick();
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(() => void send({ op: "prefetch", from: p.id }).catch(() => {}), 1500);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ---- the view's life --------------------------------------------------------------------

pal.onHidden(() => { hidden = true; syncClock(); save(); });
pal.onShown(() => { hidden = false; syncClock(); });
pal.onSettings((s) => { autocheck = !!(s as { autocheck?: boolean }).autocheck; });

async function start() {
  autocheck = !!((await pal.settings()) as { autocheck?: boolean }).autocheck;
  sources = (await send<SourcesView | null>({ op: "sources" }).catch(() => null)) ?? sources;
  const s = await send<{ solved?: number } | null>({ op: "stats", source: sources.source }).catch(() => null);
  seasoned = (s?.solved ?? 0) >= 3;
  hint();
  // The first frame waits a moment for the puzzle (a cached one is there at once), else shows the skeleton.
  const first = openPuzzle({ op: "open" });
  await Promise.race([first, wait(220)]);
  requestAnimationFrame(() => pal.ready());
}
void start();
