// Typing's page: the test and its result. The run is typing.ts (what a key
// does to it, and the score), the part the host tests; this page turns keys
// into those calls, draws the words and the caret, keeps the clock, and
// saves the options and the records in the extension's storage (the options
// under "config", which the extension reads for the view's actions and
// title; it is told with `{ moved: true }`).
//
// Drawing is incremental: every word is an element made once, and a key
// redraws only the word it touched. The caret is one element moved by a
// transition, so it glides; the words box shows three lines and slides up a
// line when the caret reaches the third.
//
// A test starts on its first key and ends when the time is up, or with the
// last word in a words test. Tab drops it for new words; the panel hidden
// drops it too (the clock cannot be fair to a test nobody sees).
import type { SurfaceKit } from "@zcag/pal";
import {
  COUNTS, MODES, TIMES, backspace, configOf, endZen, optionsOf, paceAt, paceWpm, settingOf, configure, file, input, label, missed, modeKey, newRun, recent, recordsOf, refill, result, titleOf, typeChar, typeSpace,
  type Config, type Options, type Records, type Result, type Run,
} from "../typing.ts";
import { Chart } from "./chart.ts";
import { Stats } from "./stats.ts";

declare const pal: SurfaceKit;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const body = document.body;
const inner = $("#inner"), caret = $("#caret"), paceEl = $("#pace"), counter = $("#counter"), pbEl = $("#pb"), testEl = $("#test");
const chart = new Chart($("#chart"));
const stats = new Stats();

let cfg: Config;
/** The extension's settings: the pace caret and stop on error. */
let opts: Options;
let records: Records;
/** The pace caret's speed for this test, if it has one. */
let pace: number | undefined;
let run: Run;
let phase: "idle" | "running" | "over" = "idle";
/** performance.now() at the first key. */
let t0 = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let last: Result | undefined;
/** The title line for the result on screen. */
let resultTitle = "";
/** The stats page is open (over the test or the result, which wait under it). */
let viewing = false;
/** When the result showed: keys still in flight from the test are dropped for a moment, so a stray R or Tab does not skip it. */
let shownAt = 0;
const GRACE_MS = 700;

// ---- the words ---------------------------------------------------------------------------------------------

const wordEls: HTMLElement[] = [];

function makeWords(from: number) {
  const frag = document.createDocumentFragment();
  for (let i = from; i < run.words.length; i++) {
    const w = document.createElement("div");
    w.className = "word";
    wordEls[i] = w;
    drawWord(i);
    frag.appendChild(w);
  }
  inner.appendChild(frag);
}

/** Word `i` as typed: each letter right, wrong (the letter it should be, in red) or still to type, then any extra letters. */
function drawWord(i: number) {
  const w = run.words[i], x = i <= run.at ? run.typed[i] ?? "" : "";
  const el = wordEls[i];
  let html = "";
  for (let j = 0; j < Math.max(w.length, x.length); j++) {
    const ch = j < w.length ? w[j] : x[j];
    const cls = j >= x.length ? "" : j >= w.length ? "extra" : x[j] === w[j] ? "ok" : "bad";
    html += `<span${cls ? ` class="${cls}"` : ""}>${ch === "<" ? "&lt;" : ch === "&" ? "&amp;" : ch}</span>`;
  }
  el.innerHTML = html;
  el.classList.toggle("err", missed(run, i));
}

let scrolled = 0;
/** The caret to the current letter; the box up a line once the caret is on the third, down again when Backspace goes back. */
function place() {
  const w = wordEls[run.at];
  if (!w) return;
  const lineH = w.getBoundingClientRect().height;
  const line = Math.round(w.offsetTop / lineH);
  const want = Math.max(0, line - 1);
  if (want !== scrolled) {
    scrolled = want;
    inner.style.transform = `translateY(${-want * lineH}px)`;
  }
  const spans = w.children as HTMLCollectionOf<HTMLElement>;
  const n = input(run).length;
  // A letter's offsetParent is the words box (#inner), as the word's is.
  const end = spans[spans.length - 1];
  const left = n < spans.length ? spans[n].offsetLeft : end ? end.offsetLeft + end.offsetWidth : w.offsetLeft;
  caret.style.transform = `translate(${left}px, ${w.offsetTop}px)`;
}

// ---- a test ------------------------------------------------------------------------------------------------

/** A fresh test: new words, or `words` again (the result's R). */
function fresh(words?: string[]) {
  clearTimeout(timer);
  run = newRun(cfg, Math.random, words, opts.stop);
  pace = paceWpm(records, modeKey(cfg), opts.pace);
  phase = "idle";
  for (const w of wordEls.splice(0)) w.remove();
  scrolled = 0;
  inner.style.transform = "";
  makeWords(0);
  // The caret jumps to the start rather than gliding there.
  caret.style.transition = "none";
  place();
  void caret.offsetWidth;
  caret.style.transition = "";
  body.classList.remove("running", "hush", "over", "best", "pacing");
  body.classList.add("idle");
  body.classList.toggle("zen", cfg.mode === "zen");
  counter.textContent = "";
  showOptions();
}

/** Tab: the words fade out and new ones in. */
function restart(words?: string[]) {
  if (phase === "over") return fresh(words);
  testEl.classList.add("swap");
  setTimeout(() => { fresh(words); testEl.classList.remove("swap"); }, 90);
}

function start() {
  phase = "running";
  t0 = performance.now();
  body.classList.remove("idle");
  body.classList.add("running");
  body.classList.toggle("pacing", pace !== undefined);
  if (cfg.mode === "time") timer = setTimeout(() => finish(cfg.time * 1000), cfg.time * 1000);
  tick();
}

/** Every frame of a test: the counter (seconds left, words done out of all, zen's seconds so far; the seconds only with the clock on) and the pace caret. */
function tick() {
  if (phase !== "running") return;
  const ms = performance.now() - t0;
  counter.textContent = cfg.mode === "words" ? `${run.at}/${run.words.length}` : !opts.clock ? "" : cfg.mode === "time" ? String(Math.max(0, Math.ceil(cfg.time - ms / 1000))) : String(Math.floor(ms / 1000));
  if (pace !== undefined) placePace(ms);
  requestAnimationFrame(tick);
}

/** The pace caret where a typist at the pace would be now, gliding through each letter. */
function placePace(ms: number) {
  const p = paceAt(run.words, pace!, ms);
  const w = wordEls[p.word];
  if (!w) return;
  const span = w.children[p.letter] as HTMLElement | undefined;
  const end = w.children[run.words[p.word].length - 1] as HTMLElement | undefined;
  // Within a letter, across it; on the space after the word, at the word's end.
  const left = span && p.letter < run.words[p.word].length ? span.offsetLeft + p.frac * span.offsetWidth : end ? end.offsetLeft + end.offsetWidth : w.offsetLeft;
  paceEl.style.transform = `translate(${left}px, ${w.offsetTop}px)`;
}

/** A key stop on error refused: the caret shakes red. */
function refuse() {
  caret.classList.remove("nope");
  void caret.offsetWidth;
  caret.classList.add("nope");
}

function finish(ms: number) {
  if (phase !== "running") return;
  clearTimeout(timer);
  phase = "over";
  const res = result(run, ms);
  const filed = file(records, res);
  records = filed.records;
  if (!res.invalid) void pal.storage.set("records", records).catch((e) => console.error("typing: save", e));
  last = res;
  shownAt = performance.now();
  showResult(res, filed.best, filed.prev);
}

// ---- keys --------------------------------------------------------------------------------------------------

function key(e: KeyboardEvent) {
  // Cmd combos are the panel's: surface.js forwards what the page leaves alone.
  if (e.metaKey) return;
  const k = e.key;
  if (phase === "over" && performance.now() - shownAt < GRACE_MS) { e.preventDefault(); return; }
  if (viewing) {
    e.preventDefault();
    if (e.repeat && !k.startsWith("Arrow")) return;
    if (k === "Tab" || k === "Enter" || k === "s" || k === "S") closeStats();
    else if (k === "ArrowLeft" || k === "ArrowRight") stats.step(k === "ArrowLeft" ? -1 : 1);
    else if (k === "ArrowUp" || k === "ArrowDown") stats.scroll(k === "ArrowUp" ? -1 : 1);
    return;
  }
  if (k === "Tab") { e.preventDefault(); restart(); return; }
  if (phase === "over") {
    if (k === "Enter" && !e.repeat) { e.preventDefault(); restart(); }
    else if ((k === "s" || k === "S") && !e.repeat) { e.preventDefault(); openStats(); }
    else if ((k === "r" || k === "R") && !e.repeat && last) { e.preventDefault(); restart(cfg.mode === "zen" ? undefined : run.words); }
    return;
  }
  if (phase === "idle" && k.startsWith("Arrow")) { e.preventDefault(); arrow(k); return; }
  body.classList.add("typing", "hush");
  const t = () => performance.now() - t0;
  if (k === "Enter") {
    e.preventDefault();
    if (phase === "running" && endZen(run)) finish(t());
    return;
  }
  if (k === "Backspace") {
    e.preventDefault();
    const from = run.at;
    if (!backspace(run, e.altKey || e.ctrlKey)) return;
    // Zen drops the word it left.
    for (const w of wordEls.splice(run.words.length)) w.remove();
    if (from < run.words.length) drawWord(from);
    drawWord(run.at);
    place();
    return;
  }
  if (e.ctrlKey || e.altKey && k.length !== 1) return;
  if (k === " ") {
    e.preventDefault();
    if (phase === "idle") return;
    const from = run.at;
    const took = typeSpace(run, t());
    if (took === "blocked") return refuse();
    if (!took) return;
    drawWord(from);
    const added = refill(run);
    if (added) makeWords(run.words.length - added);
    else if (run.words.length > wordEls.length) makeWords(wordEls.length);
    place();
    if (run.over) finish(t());
    return;
  }
  if (k.length !== 1) return;
  e.preventDefault();
  if (phase === "idle") start();
  const took = typeChar(run, k, t());
  if (took === "blocked") return refuse();
  if (!took) return;
  drawWord(run.at);
  place();
  if (run.over) finish(t());
}

/** Before the first key: ↑ ↓ time, words or zen, ← → the length. */
function arrow(k: string) {
  if (k === "ArrowUp" || k === "ArrowDown") return setConfig({ ...cfg, mode: MODES[(MODES.indexOf(cfg.mode) + (k === "ArrowUp" ? MODES.length - 1 : 1)) % MODES.length] });
  if (cfg.mode === "zen") return;
  const list: readonly number[] = cfg.mode === "time" ? TIMES : COUNTS;
  const i = list.indexOf(cfg.mode === "time" ? cfg.time : cfg.words) + (k === "ArrowLeft" ? -1 : 1);
  if (i < 0 || i >= list.length) return;
  setConfig({ ...cfg, [cfg.mode === "time" ? "time" : "words"]: list[i] });
}

// ---- the options -------------------------------------------------------------------------------------------

function setConfig(next: Config) {
  const redo = next.mode !== cfg.mode || next.words !== cfg.words || next.punctuation !== cfg.punctuation || next.numbers !== cfg.numbers || phase !== "idle";
  cfg = next;
  pal.title(titleOf(cfg));
  void pal.storage.set("config", cfg).then(() => pal.send({ moved: true })).catch((e) => console.error("typing: save", e));
  // A new length of time keeps the words on screen; anything else deals new ones.
  if (redo) restart();
  else { run.cfg = cfg; showOptions(); }
  if (viewing) stats.show(records, cfg);
}

function showOptions() {
  makeLengths();
  for (const b of document.querySelectorAll<HTMLElement>("#bar [data-id]")) {
    const id = b.dataset.id!;
    b.classList.toggle("on", id === "punctuation" ? cfg.punctuation : id === "numbers" ? cfg.numbers : id === `mode:${cfg.mode}` || id === `${cfg.mode}:${cfg.mode === "time" ? cfg.time : cfg.words}`);
  }
  const best = records.best[modeKey(cfg)];
  pbEl.textContent = [best && `best ${Math.floor(best.wpm)} wpm`, pace !== undefined && `pace caret ${Math.floor(pace)}`].filter(Boolean).join(" · ");
  hints();
}

function makeLengths() {
  const box = $("#lengths");
  box.replaceChildren(...(cfg.mode === "time" ? TIMES : cfg.mode === "words" ? COUNTS : []).map((n) => {
    const b = document.createElement("button");
    b.type = "button";
    b.tabIndex = -1;
    b.dataset.id = `${cfg.mode}:${n}`;
    b.textContent = String(n);
    return b;
  }));
}

$("#bar").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;
  if (!id) return;
  if (id === "stats") return viewing ? closeStats() : openStats();
  setConfig(id.startsWith("mode:") ? { ...cfg, mode: id.slice(5) as Config["mode"] } : configure(cfg, id));
});

// ---- the stats page ------------------------------------------------------------------------------------------

/** Over whatever is on screen; a test in progress is dropped (its clock would run on unseen). */
function openStats() {
  if (phase === "running") fresh();
  viewing = true;
  body.classList.add("stats");
  body.classList.remove("hush", "typing");
  stats.show(records, cfg);
  pal.title("Typing · stats");
  hints();
}

function closeStats() {
  if (!viewing) return;
  viewing = false;
  body.classList.remove("stats");
  pal.title(phase === "over" ? resultTitle : titleOf(cfg));
  hints();
}

// ---- the result ----------------------------------------------------------------------------------------------

/** A number counting up to `to` in about half a second. */
function countUp(el: HTMLElement, to: number, fmt: (x: number) => string) {
  const t = performance.now();
  const step = (now: number) => {
    const p = Math.min(1, (now - t) / 550);
    el.textContent = fmt(to * (1 - (1 - p) ** 3));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function showResult(res: Result, best: boolean, prev?: { wpm: number }) {
  body.classList.remove("running", "hush", "idle");
  body.classList.add("over");
  body.classList.toggle("best", best && !res.invalid);
  countUp($("#r-wpm"), res.wpm, (x) => String(Math.floor(x)));
  countUp($("#r-acc"), res.acc, (x) => `${Math.floor(x)}%`);
  $("#r-wpm").title = `${res.wpm.toFixed(2)} wpm`;
  $("#r-acc").title = `${res.acc.toFixed(2)}%`;
  const avg = recent(records, res.key);
  const note = $("#r-note");
  if (res.invalid) note.innerHTML = `<span class="bad">not counted</span><br>${res.invalid}`;
  else {
    const parts = [];
    if (prev && !best) parts.push(`best ${Math.floor(prev.wpm)}`);
    else if (prev && best) parts.push(`+${Math.floor(res.wpm - prev.wpm)} on ${Math.floor(prev.wpm)}`);
    if (avg.count > 1) parts.push(`avg ${Math.floor(avg.wpm)} of last ${avg.count}`);
    note.textContent = parts.join(" · ");
  }
  $("#r-type").textContent = label(cfg);
  $("#r-raw").textContent = String(Math.floor(res.raw));
  $("#r-raw").title = res.raw.toFixed(2);
  $("#r-chars").textContent = res.chars.join("/");
  $("#r-cons").textContent = `${Math.floor(res.consistency)}%`;
  $("#r-time").textContent = `${Math.round(res.secs)}s`;
  resultTitle = res.invalid ? `${titleOf(cfg)} · not counted` : `${Math.floor(res.wpm)} wpm · ${Math.floor(res.acc)}% acc${best ? " · new best" : ""}`;
  pal.title(resultTitle);
  hints();
  // Drawn once the result is laid out, so the chart has its size.
  requestAnimationFrame(() => chart.show(res.samples));
}

function hints() {
  const k = (keys: string, what: string) => `<span><kbd>${keys}</kbd>${what}</span>`;
  $("#hints").innerHTML = viewing
    ? k("tab", "back") + k("← →", "test kind") + k("↑ ↓", "scroll") + k("esc", "leave")
    : phase === "over"
    ? k("tab", "next test") + (cfg.mode === "zen" ? "" : k("r", "repeat")) + k("s", "stats") + k("esc", "leave")
    : cfg.mode === "zen"
    ? k("enter", "finish") + k("tab", "start over") + k("↑ ↓", "mode") + k("esc", "leave")
    : k("tab", "new test") + k("← →", "length") + k("↑ ↓", "mode") + k("esc", "leave");
}

// ---- wiring --------------------------------------------------------------------------------------------------

window.addEventListener("keydown", key);
// The bar and the pointer come back when the mouse moves.
window.addEventListener("mousemove", (e) => {
  if (!e.movementX && !e.movementY) return;
  body.classList.remove("typing", "hush");
});
const focus = () => body.classList.toggle("blurred", !document.hasFocus());
window.addEventListener("focus", focus);
window.addEventListener("blur", focus);
window.addEventListener("resize", () => run && place());
document.addEventListener("mousedown", () => window.focus());

pal.onAction((id) => {
  const write = settingOf(id);
  if (write) {
    // Written by the extension (so the Settings window agrees); taken here at once for the next test.
    void pal.send({ set: id }).catch((e) => console.error("typing: setting", e));
    applyOptions({ pace_caret: opts.pace, stop_on_error: opts.stop, clock: opts.clock, ...write });
  } else if (id === "stats") openStats();
  else if (id === "restart") { closeStats(); restart(); }
  else setConfig(configure(cfg, id));
});
// Hidden mid-test: the test is dropped, a fresh one waits.
pal.onHidden(() => { if (phase === "running") fresh(); });
pal.onTheme(() => last && phase === "over" && chart.show(last.samples));

/** New settings: stop on error now if nothing is typed yet, the pace caret from the next test (or this one, before its first key). */
function applyOptions(s: unknown) {
  opts = optionsOf(s);
  if (!run || phase !== "idle") return;
  run.stop = opts.stop;
  pace = paceWpm(records, modeKey(cfg), opts.pace);
  showOptions();
}
pal.onSettings((s) => { applyOptions(s); void pal.send({ moved: true }).catch(() => {}); });

[cfg, records, opts] = await Promise.all([pal.storage.get("config").then(configOf), pal.storage.get("records").then(recordsOf), pal.settings().then(optionsOf)]);
fresh();
pal.title(titleOf(cfg));
await document.fonts.ready;
place();
focus();
pal.ready();
