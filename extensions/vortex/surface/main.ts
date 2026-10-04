// Vortex's page: the stage carousel, the run, the death and the instant retry.
// The music is the clock (music.ts): a run's time is the heard audio time
// since its step 0, the sim (../game/sim.ts) is stepped up to it every frame,
// and its events become light and sound. The renderer (render.ts) draws the
// sim's state plus everything that is only for the eye: the song's sections
// (a build darkening into a drop), the ghost of your best run, the slow
// replay of what killed you, flashes, rings, the camera's sway. The save goes
// through the kit's storage (synced, and taken back when sync brings a newer
// one); every finished run goes to its leaderboard; hiding pal's panel
// pauses a run.
import type { ScoreResult, SurfaceKit } from "@zcag/pal";
import { CLEAR, RANKS, SKINS, STAGES, TRAILS, stageOf, type Look, type RGB, type SkinId, type TrailId } from "../game/content.ts";
import { DT, LEGS, beat, chartSeed, clock, create, sectionOf, skipTo, speed, step, type Input, type State, type Wall } from "../game/sim.ts";
import { decide, play, safest } from "../game/bot.ts";
import {
  BOARDS, MEDALS_TOTAL, SKIN_AT, TRAIL_AT, best, boardIdOf, daily, dailyOf, fresh, ghostOf, ghostStep, keyOf, load, medalCount, medalsOf, open, parse, record,
  settle, skinOpen, trailOpen, type Keys, type Outcome, type Save, type Scene,
} from "../game/meta.ts";
import { Renderer, type Frame } from "./render.ts";
import { music } from "./music.ts";
import { SONGS } from "./songs.ts";

declare const pal: SurfaceKit;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const canvas = $<HTMLCanvasElement>("#gl");
const ui = $("#ui"), hud = $("#hud"), banners = $("#banners");
let gfx: Renderer | null = null;
try { gfx = new Renderer(canvas); } catch (e) { console.error("vortex: webgl", e); }

type ScreenId = "title" | "run" | "over" | "look";
let screen: ScreenId = "title";
let save: Save = fresh();
/** The carousel: 0..5 the stages, 6 endless, 7 the daily; whether hyper is chosen; a practice start (a rank) per board. */
let sel = 0, hyper = false;
const CARDS = 8, ENDLESS = 6, DAILY = 7;
const practice: Record<string, number> = {};

let run: State | null = null;
/** The daily's UTC day number while playing it. */
let runKey = "", runDay: number | undefined, runPractice = 0;
/** The run's step 0 on the clock. */
let zero = 0;
let paused = false;
let deathAt = -1;
let outcome: Outcome | null = null;
let prevBest = 0, recorded = false;
/** Where the last run landed on its board, once the score's answer came; whether the player is signed in (asked again on every show). */
let standing: ScoreResult | null = null;
let signedIn = true;
/** The run's keys, for its ghost; the ghost of the board's best; the next endless leg already queued in the music. */
let keys: Keys = [];
let ghost: ReturnType<typeof ghostOf> = null;
let ghostGone = -1;
let queuedLeg = -1;
/** Steered by the bot (screenshots), not the keys. */
let autopilot = false;
/** The last second and a half of the run, a frame at a time, for the replay after a death. */
type Snap = { t: number; a: number; dir: number; rot: number; n: number; nFrom: number; morphAt: number; walls: Wall[] };
let snaps: Snap[] = [];
const REPLAY = { after: 0.42, span: 1.1, speed: 0.42 };

/** A bot plays the chosen stage behind the menus. */
let demo: State | null = null;
let demoAcc = 0, demoDeadAt = -1;
let lookSel = { row: 0, i: 0 };

const fx = { flash: 0, shake: 0, aberr: 0, shockAt: -9, bump: 0, az: Math.random() * 6, azV: 0, tilt: 0, zoom: 0 };
const held: string[] = [];
let focus = false;
let last = performance.now();
let wasRunning = false;

// ---- helpers --------------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const kbd = (k: string) => `<kbd>${k}</kbd>`;
const hex = (c: RGB) => `rgb(${c.map((x) => Math.round(x * 255)).join(",")})`;
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const today = () => daily(new Date());
const persist = () => pal.storage.set("save", save).catch((e) => console.error("vortex: save", e));
const boardOf = () => (sel === DAILY ? keyOf(today().stage, false) : sel === ENDLESS ? "endless" : keyOf(STAGES[sel].id, hyper));
const nameOf = (key: string) => (key === "endless" ? "Endless" : `${stageOf(parse(key).stage).name}${parse(key).hyper ? " Hyper" : ""}`);
const lookOf = (s: State | null, key = boardOf()) => {
  const { stage, hyper: h } = s ? { stage: s.stage.id, hyper: s.hyper } : parse(key);
  const st = stageOf(stage);
  return h ? st.hyperLook : st.look;
};
const rankOf = (t: number) => { let r = 0; RANKS.forEach((x, i) => { if (t >= x.at) r = i; }); return r; };
const SKIN_NAMES: Record<SkinId, string> = { dart: "Dart", arrow: "Arrow", diamond: "Diamond", comet: "Comet", star: "Star" };
const TRAIL_NAMES: Record<TrailId, string> = { line: "Line", ribbon: "Ribbon", sparks: "Sparks", prism: "Prism" };

/** A polygon for a rank: a dot, a line, then 3..6 sides. */
function rankIcon(r: number, cls = "") {
  const pts = (n: number) => Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return `${(12 + Math.cos(a) * 9).toFixed(1)},${(12 + Math.sin(a) * 9).toFixed(1)}`; }).join(" ");
  const body = r === 0 ? `<circle cx="12" cy="12" r="3"/>` : r === 1 ? `<line x1="4" y1="12" x2="20" y2="12"/>` : `<polygon points="${pts(r + 1)}"/>`;
  return `<svg class="poly ${cls}" viewBox="0 0 24 24">${body}</svg>`;
}

function setAccent(l: Look) {
  const r = document.documentElement.style;
  r.setProperty("--accent", hex(l.wall));
  r.setProperty("--accent2", hex(l.core));
}

function banner(big: string, small = "", cls = "") {
  const el = document.createElement("div");
  el.className = `banner ${cls}`;
  el.innerHTML = `<b>${esc(big)}</b>${small ? `<span>${esc(small)}</span>` : ""}`;
  banners.append(el);
  setTimeout(() => el.remove(), 2200);
}

// ---- the title ------------------------------------------------------------------------------------------------------

function title() {
  screen = "title";
  run = null; paused = false; ghost = null;
  hud.hidden = true;
  music.slow(false);
  music.layer = -1;
  music.open(1500, 0.6);
  newDemo();
  carousel();
}

function newDemo() {
  const { stage, hyper: h } = parse(boardOf());
  demo = create({ stage, hyper: h, seed: (Math.random() * 1e9) >>> 0 });
  play(demo, 4 + Math.random() * 20);
  demo.events.length = 0;
  demoDeadAt = -1;
  gfx?.clearTrail();
  music.setSong(SONGS[stage]);
}

/** Practice starts a board could take: from the top, or any rank you have reached there. */
const starts = (key: string) => (BOARDS.includes(key) ? RANKS.map((_, i) => i).filter((i) => i < RANKS.length - 1 && best(save, key) >= RANKS[i].at) : [0]);

function carousel() {
  const board = boardOf();
  const isDaily = sel === DAILY, isEndless = sel === ENDLESS, isStage = !isDaily && !isEndless;
  const st = stageOf(parse(board).stage);
  const opened = open(save, isDaily ? "daily" : board);
  const day = dailyOf(save, today().n);
  const b = isDaily ? day.best : best(save, board);
  const tries = isDaily ? day.tries : save.boards[board]?.tries ?? 0;
  const prev = STAGES[Math.max(0, sel - 1)];
  const lock = !isStage ? "Clear Pulse to open" : hyper ? `Clear ${st.name} to open its hyper` : `Clear ${prev.name} to open`;
  const hyperOpen = isStage && open(save, keyOf(st.id, true));
  const won = save.boards[board]?.medals ?? [];
  const medals = isDaily ? "" : `<div class="medals">${medalsOf(board).map((m) => `<span class="${won.includes(m.id) ? "won" : ""}" title="${esc(m.how)}"><i></i>${esc(m.name)}</span>`).join("")}</div>`;
  const from = practice[board] ?? 0, can = starts(board);
  setAccent(lookOf(null, board));
  const dots = [...STAGES.map((x, i) => {
    const k = keyOf(x.id, false), cleared = best(save, k) >= CLEAR, hk = best(save, keyOf(x.id, true)) >= CLEAR;
    return `<i class="${i === sel ? "on" : ""} ${open(save, k) ? "" : "locked"} ${cleared ? "clear" : ""} ${hk ? "hclear" : ""}"></i>`;
  }), `<i class="loop ${sel === ENDLESS ? "on" : ""} ${open(save, "endless") ? "" : "locked"}"></i>`, `<i class="day ${sel === DAILY ? "on" : ""} ${open(save, "daily") ? "" : "locked"}"></i>`].join("");
  const blurb = isDaily ? `${esc(st.name)} · today's walls, the same every try` : isEndless ? "Every stage in turn, then their hypers" : esc(st.blurb);
  ui.className = "title";
  ui.innerHTML = `
    <div class="logo"><b>VORTEX</b><span>${save.boards.pulse ? `${medalCount(save)} of ${MEDALS_TOTAL} medals` : "turn with ← → · survive"}</span></div>
    <div class="card ${opened ? "" : "is-locked"} ${hyper && isStage ? "is-hyper" : ""}">
      <div class="nav"><span class="arrow">‹</span><div class="name">${isDaily ? "Daily" : isEndless ? "Endless" : esc(st.name)}${hyper && isStage ? `<em>Hyper</em>` : ""}</div><span class="arrow">›</span></div>
      <div class="blurb">${blurb}</div>
      ${opened ? `
        <div class="stats">
          <div><small>Best</small><b>${clock(b)}</b></div>
          <div class="rk">${rankIcon(rankOf(b))}<span>${RANKS[rankOf(b)].name}</span></div>
          <div><small>Tries</small><b>${tries}</b></div>
        </div>${medals}
        ${can.length > 1 ? `<div class="practice">${kbd("p")} ${from ? `practice from <b>${RANKS[from].name}</b> · ${RANKS[from].at}s` : "practice from a rank you reached"}</div>` : ""}` : `<div class="lock">${esc(lock)}</div>`}
      <div class="dots">${dots}</div>
    </div>
    <div class="keys">${kbd("←")}${kbd("→")} stage ${isStage ? `${kbd("↑")} ${hyperOpen || hyper ? "hyper" : "<s>hyper</s>"}` : ""} ${kbd("space")} play ${kbd("c")} look ${kbd("m")} sound${save.muted ? " off" : ""}</div>`;
  ui.querySelectorAll<HTMLElement>(".arrow").forEach((el, i) => el.addEventListener("click", () => key(i ? "ArrowRight" : "ArrowLeft")));
  ui.querySelector(".name")?.addEventListener("click", () => key("Enter"));
}

// ---- the look: the player's shape and trail -------------------------------------------------------------------------

function look() {
  screen = "look";
  const n = medalCount(save);
  const row = (r: number, ids: readonly string[], names: Record<string, string>, at: Record<string, number>, cur: string) => ids.map((id, i) => {
    const can = n >= at[id];
    return `<div class="opt ${lookSel.row === r && lookSel.i === i ? "sel" : ""} ${cur === id ? "cur" : ""} ${can ? "" : "locked"}" data-r="${r}" data-i="${i}"><b>${esc(names[id])}</b><span>${can ? (cur === id ? "Wearing" : "Open") : `${at[id]} medals`}</span></div>`;
  }).join("");
  ui.className = "look";
  ui.innerHTML = `
    <div class="card">
      <div class="head"><b>Your look</b><span>${n} of ${MEDALS_TOTAL} medals</span></div>
      <small>Shape</small><div class="opts">${row(0, SKINS, SKIN_NAMES, SKIN_AT, save.skin)}</div>
      <small>Trail</small><div class="opts">${row(1, TRAILS, TRAIL_NAMES, TRAIL_AT, save.trail)}</div>
      <small>Ghost</small><div class="opts"><div class="opt ${lookSel.row === 2 ? "sel" : ""} ${save.ghost ? "cur" : ""}" data-r="2" data-i="0"><b>${save.ghost ? "On" : "Off"}</b><span>Race your best run</span></div></div>
    </div>
    <div class="keys">${kbd("←")}${kbd("→")}${kbd("↑")}${kbd("↓")} choose ${kbd("space")} wear ${kbd("⌫")} back</div>`;
  ui.querySelectorAll<HTMLElement>(".opt").forEach((el) => el.addEventListener("click", () => { lookSel = { row: Number(el.dataset.r), i: Number(el.dataset.i) }; key("Enter"); }));
}

function lookKey(k: string) {
  const len = [SKINS.length, TRAILS.length, 1];
  if (LEFT.has(k) || RIGHT.has(k)) lookSel.i = (lookSel.i + (LEFT.has(k) ? -1 : 1) + len[lookSel.row]) % len[lookSel.row];
  else if (k === "ArrowUp" || k === "ArrowDown") { lookSel.row = (lookSel.row + (k === "ArrowUp" ? 2 : 1)) % 3; lookSel.i = Math.min(lookSel.i, len[lookSel.row] - 1); }
  else if (k === " " || k === "Enter") {
    if (lookSel.row === 0 && skinOpen(save, SKINS[lookSel.i])) save.skin = SKINS[lookSel.i];
    else if (lookSel.row === 1 && trailOpen(save, TRAILS[lookSel.i])) save.trail = TRAILS[lookSel.i];
    else if (lookSel.row === 2) save.ghost = !save.ghost;
    else { music.sfx("back"); return; }
    persist(); music.sfx("select");
  } else if (k === "Backspace" || k === "c" || k === "C") { music.sfx("back"); title(); return; }
  else return;
  if (lookSel.row !== 2 || k === " " || k === "Enter") music.sfx("move");
  look();
}

// ---- a run ----------------------------------------------------------------------------------------------------------

function begin() {
  const key = boardOf();
  if (!open(save, sel === DAILY ? "daily" : key)) { music.sfx("back"); ui.querySelector(".card")?.animate([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }], { duration: 180 }); return; }
  runDay = sel === DAILY ? today().n : undefined;
  runPractice = runDay || key === "endless" ? 0 : practice[key] ?? 0;
  start(fresh_run(key), key);
}

/** A new run of a board: a stage plays its chart, the daily today's walls, endless chance. */
function fresh_run(key: string) {
  if (key === "endless") return create({ stage: "pulse", seed: (Math.random() * 2 ** 32) >>> 0, endless: true });
  const { stage, hyper: h } = parse(key);
  return create({ stage, hyper: h, seed: runDay ? today().seed : chartSeed(stage, h) });
}

function start(s: State, key: string) {
  music.start();
  music.slow(false);
  run = s; runKey = key;
  demo = null;
  screen = "run"; paused = false; deathAt = -1; outcome = null; recorded = false; standing = null;
  keys = []; snaps = []; queuedLeg = -1; ghostGone = -1;
  // A practice run starts at its rank: the chart played to there, you set down where it is safe for a moment.
  const at = RANKS[runPractice].at;
  if (at > 0 && s.t < at) { skipTo(s, at); s.a = safest(s); s.immune = true; }
  ghost = !runDay && !runPractice && key !== "endless" ? ghostOf(save, key) : null;
  prevBest = runPractice ? 0 : runDay !== undefined ? dailyOf(save, runDay).best : best(save, key);
  music.setSong(SONGS[s.stage.id]);
  music.layer = s.rank;
  zero = music.restart(0.07) - s.t;
  music.align(zero);
  music.open(18000, 0.1);
  music.sfx("start");
  setAccent(lookOf(s));
  ui.className = ""; ui.innerHTML = "";
  hud.hidden = false;
  hud.classList.toggle("record", false);
  shownRank = -1;
  gfx?.clearTrail();
  gfx?.ring(s.n, lookOf(s).wall);
  fx.flash = 0.55; fx.shockAt = clockNow(); fx.bump = 0.08;
  pal.title(`Vortex · ${nameOf(key)}${runPractice ? " · practice" : ""}`);
}

function die() {
  if (!run) return;
  deathAt = clockNow();
  gfx?.burst(frameOf(run, clockNow()), lookOf(run).player);
  music.sfx("death");
  music.layer = -1;
  music.open(240, 0.35);
  fx.flash = 0.85; fx.shake = 0.45; fx.aberr = 0.024;
  outcome = settle(save, runKey, { t: run.t, grazes: run.grazes, focused: run.focused, keys: autopilot ? undefined : keys }, { day: runDay, practice: !!runPractice });
  persist();
  if (!runPractice && !autopilot) {
    const ended = run;
    pal.score(boardIdOf(runKey, runDay !== undefined), Math.round(run.t * 1000) / 1000).then((r) => {
      if (run !== ended) return;
      standing = r;
      if (screen === "over") ui.querySelector(".card")?.insertAdjacentHTML("beforeend", standingLine());
    }).catch((e) => console.error("vortex: score", e));
  }
  setTimeout(() => { if (screen === "run" && run?.dead && deathAt > 0) { music.sfx("replay"); music.slow(true); } }, REPLAY.after * 1000);
  setTimeout(() => { if (screen === "run" && run?.dead) over(); }, 520);
  setTimeout(() => { if ((screen === "over" || screen === "run") && run?.dead) { music.slow(false); music.open(1100, 1.6); } }, (REPLAY.after + REPLAY.span / REPLAY.speed) * 1000);
}

function over() {
  if (!run || !outcome) return;
  screen = "over";
  hud.hidden = true;
  const o = outcome;
  const nextRank = RANKS[o.rank + 1];
  const opened = o.opened.map((k) => k === "daily" ? "The daily is open" : `${nameOf(k)} is open`);
  const medals = o.medals.map((id) => medalsOf(runKey).find((m) => m.id === id)!);
  const looks = o.looks.map((id) => (id in SKIN_NAMES ? `New shape: ${SKIN_NAMES[id as SkinId]}` : `New trail: ${TRAIL_NAMES[id as TrailId]}`));
  const delta = o.t - o.prev;
  const line = o.practice ? `<span>Practice from ${RANKS[runPractice].name}</span>`
    : o.record && o.prev > 0 ? `<span class="gold">New record · +${delta.toFixed(2)}</span>`
    : o.record ? `<span class="gold">First time on the board</span>`
    : `<span>Best ${clock(o.prev)} · ${delta.toFixed(2)}</span>`;
  ui.className = "over";
  ui.innerHTML = `
    <div class="card">
      <div class="time">${clock(o.t).replace(/\.(\d+)$/, "<small>.$1</small>")}</div>
      <div class="line">${rankIcon(o.rank)}<b>${RANKS[o.rank].name}</b>${line}</div>
      ${run.endless ? `<div class="next"><span>Reached ${esc(nameOf(keyOf(run.stage.id, run.hyper)))}, stage ${run.leg + 1} of ${LEGS.length}</span></div>`
        : nextRank ? `<div class="next"><span>${nextRank.name} at ${nextRank.at}s</span><div class="bar"><i style="width:${Math.min(100, (o.t / nextRank.at) * 100).toFixed(1)}%"></i></div><span>${(nextRank.at - o.t).toFixed(1)}s away</span></div>`
        : `<div class="next"><span class="gold">Cleared. Every second past ${CLEAR} is yours.</span></div>`}
      ${[...medals.map((m) => `Medal · ${m.name}`), ...looks, ...opened].map((x) => `<div class="opened">${esc(x)}</div>`).join("")}
      ${standingLine()}
    </div>
    <div class="keys">${kbd("space")} again ${kbd("⌫")} stages</div>`;
  if (medals.length) music.sfx("medal");
  else if (o.opened.length || looks.length) music.sfx("open");
}

/** "#12 of 340 today" under the death card once the board answered; signed out after a record, the offer to keep it. */
function standingLine() {
  if (!standing?.rank || !standing.total) return "";
  const keep = !signedIn && outcome?.record ? ` · <a class="signin">Sign in to keep your scores</a>` : "";
  return `<div class="board">#${standing.rank} of ${standing.total}${runDay !== undefined ? " today" : ""}${keep}</div>`;
}

function retry() {
  if (!run) return;
  start(fresh_run(runKey), runKey);
}

function setPaused(on: boolean) {
  if (!run || run.dead || screen !== "run") return;
  paused = on;
  if (on) {
    music.suspend();
    ui.className = "paused";
    ui.innerHTML = `<div class="card"><b>Paused</b><div class="keys">${kbd("space")} carry on ${kbd("⌫")} stages</div></div>`;
  } else {
    music.start();
    ui.className = ""; ui.innerHTML = "";
    // Carry on from the same moment, a breath later, with the music lined up again.
    zero = music.restart(0.35) - run.t;
    music.align(zero);
  }
}

// ---- the clock and the loop -----------------------------------------------------------------------------------------

const clockNow = () => music.now();

function frame() {
  requestAnimationFrame(frame);
  const p = performance.now(), dt = Math.min(0.1, (p - last) / 1000);
  last = p;
  music.tick();
  // Sound came on mid-run (the first key): the clock changed hands, keep the run where it was.
  if (music.running !== wasRunning) { wasRunning = music.running; if (run && !run.dead) { zero = clockNow() - run.t; music.align(zero); } }
  const now = clockNow();

  if (run && screen === "run" && !run.dead && !paused) {
    const target = now - zero;
    let n = 0;
    while (run.t + DT <= target && n++ < 240) {
      const inp = autopilot ? decide(run) : input();
      record(keys, inp);
      step(run, inp);
      if (ghost) ghostStep(ghost);
      if (run.immune && run.t > RANKS[runPractice].at + 0.8) run.immune = false;
      for (const e of run.events) onEvent(run, e);
      run.events.length = 0;
      if (run.dead) break;
    }
    if (!run.dead) {
      music.layer = run.rank;
      snaps.push({ t: run.t, a: run.a, dir: run.dir, rot: run.rot, n: run.n, nFrom: run.nFrom, morphAt: run.morphAt, walls: run.walls.map((w) => ({ ...w })) });
      while (snaps.length && run.t - snaps[0].t > REPLAY.span + 0.3) snaps.shift();
      if (!recorded && prevBest > 0 && run.t > prevBest) { recorded = true; banner("New record", "", "gold"); music.sfx(ghost ? "ghost" : "record"); hud.classList.add("record"); }
      if (run.endless) queueLeg(run);
    }
    updateHud(run);
  }
  if (demo && (screen === "title" || screen === "look")) stepDemo(dt);

  fx.flash *= Math.exp(-dt * 7);
  fx.shake *= Math.exp(-dt * 5);
  fx.aberr *= Math.exp(-dt * 3);
  fx.bump *= Math.exp(-dt * 6);
  fx.azV *= Math.exp(-dt * 1.8);
  fx.az += dt * ((screen === "run" ? 0.12 : 0.05) + fx.azV);
  const s = run ?? demo;
  if (gfx && s) gfx.draw({ ...frameOf(s, now, dt), ...(window as unknown as { vxFrame?: Partial<Frame> }).vxFrame }, dt);
}

/** Endless: the next stage's song starts on the bar its walls do. */
function queueLeg(s: State) {
  if (queuedLeg === s.leg || s.leg >= LEGS.length - 1) return;
  const form = s.stage.form, written = form.sections.slice(0, form.loop).reduce((a, x) => a + x.bars * 4, 0) * beat(s);
  const at = s.base + written;
  if (s.t < at - beat(s) * 8) return;
  queuedLeg = s.leg;
  music.queueSong(SONGS[LEGS[s.leg + 1].stage], zero + at);
}

function input(): Input {
  const k = held[held.length - 1];
  // Right turns clockwise, as in Super Hexagon; the sim counts angles the other way.
  return { dir: k === "l" ? 1 : k === "r" ? -1 : 0, focus };
}

function stepDemo(dt: number) {
  if (!demo) return;
  if (demo.dead) {
    if (demoDeadAt < 0) { demoDeadAt = performance.now(); gfx?.burst(frameOf(demo, clockNow()), lookOf(demo).player); }
    if (performance.now() - demoDeadAt > 1600) newDemo();
    return;
  }
  demoAcc += dt;
  while (demoAcc >= DT) {
    demoAcc -= DT;
    step(demo, decide(demo));
    demo.events.length = 0;
    if (demo.dead) break;
  }
}

function onEvent(s: State, e: State["events"][number]) {
  const l = lookOf(s);
  if (e.type === "death") die();
  else if (e.type === "rank" && !s.endless) {
    const r = RANKS[e.rank];
    banner(r.name.toUpperCase(), e.rank === RANKS.length - 1 ? (s.hyper ? "Hyper cleared" : "Stage cleared") : "", e.rank === RANKS.length - 1 ? "clear" : "");
    gfx?.ring(s.n, l.core);
    fx.flash = Math.max(fx.flash, 0.3); fx.shockAt = clockNow(); fx.bump = 0.07; fx.aberr = 0.012;
    music.sfx("rank");
  } else if (e.type === "flip") {
    if (e.surge) { fx.aberr = Math.max(fx.aberr, 0.008); music.sfx("flip"); }
  } else if (e.type === "morph") gfx?.ring(e.n, l.wall);
  else if (e.type === "section" && e.kind === "drop") {
    // The drop: light back on after the build's blackout, the camera thrown round, a ring out of the centre.
    fx.flash = Math.max(fx.flash, 0.45 * e.energy); fx.shockAt = clockNow(); fx.bump = 0.1; fx.azV = 1.4 * e.energy; fx.aberr = 0.014;
    gfx?.ring(s.n, l.core);
  } else if (e.type === "graze") {
    gfx?.graze(frameOf(s, clockNow()), e.edge, e.close);
    music.sfx("graze", e.close);
    if (s.grazes === 20 && !autopilot && !save.boards[runKey]?.medals?.includes("hairline") && !runDay && !s.endless) { banner("Hairline", "Medal", "gold"); music.sfx("medal"); }
  } else if (e.type === "stage") {
    banner(nameOf(keyOf(e.stage, e.hyper)).toUpperCase(), `Stage ${s.leg + 1} of ${LEGS.length}`);
    setAccent(lookOf(s));
    gfx?.ring(s.n, lookOf(s).core);
    fx.flash = 0.5; fx.shockAt = clockNow(); fx.bump = 0.1;
  }
}

/** The state as the renderer sees it, with everything only for the eye laid on top. */
function frameOf(s: State, now: number, dt = 0): Frame {
  const st = s.stage;
  const base = s.hyper ? st.hyperLook : st.look, other = s.hyper ? st.look : st.hyperLook;
  const local = s.t - s.base;
  // Past the clear, the colours turn: the stage shows you its other face.
  const turn = s === run && !s.endless && local > CLEAR ? Math.min(1, (local - CLEAR) / 2) : 0;
  const look = turn ? mixLook(base, other, turn * (s.hyper ? 0.5 : 1)) : base;
  const isRun = s === run;
  const since = isRun && s.dead && deathAt > 0 ? Math.max(0, now - deathAt) : 0;
  // After a death: the impact, then the last second again in slow motion, then the walls roll back.
  const replayFor = REPLAY.span / REPLAY.speed;
  const inReplay = since > REPLAY.after && since < REPLAY.after + replayFor && snaps.length > 1;
  const after = Math.max(0, since - REPLAY.after - replayFor);
  const menu = screen === "title" || screen === "look" ? 1 : screen === "over" ? 0.6 : 0;
  const beats = isRun ? (now - zero - s.base) / beat(s) : s.t / beat(s);
  const sec = sectionOf(s, isRun && !s.dead ? Math.max(s.t, now - zero) : s.t);
  const into = local / beat(s) - sec.start;
  const bar = Math.floor(beats / 4);
  const strobe = st.strobe > 0 && isRun && !s.dead && sec.kind === "drop" && hash(bar + s.seed) < st.strobe * (0.4 + sec.energy * 0.5) ? Math.floor(beats) % 2 : 0;
  // A build darkens over its last two beats; the drop's first beat throws the light back (and, in hyper, inverts it a moment).
  const blackout = isRun && !s.dead && sec.kind === "build" ? Math.max(0, Math.min(1, (into - (sec.len - 2)) / 1.5)) * 0.85 : 0;
  const invert = isRun && !s.dead && s.hyper && sec.kind === "drop" && into < 0.5 ? 1 - into * 2 : 0;
  // The camera leans with the song: flatter in a break, creeping in through a build.
  const tiltTo = sec.kind === "break" ? -7 : sec.kind === "build" ? 3 * (into / sec.len) : sec.kind === "drop" ? 2 : 0;
  const zoomTo = sec.kind === "build" ? 0.07 * (into / sec.len) : sec.kind === "break" ? -0.05 : 0;
  if (dt && isRun) { fx.tilt += (tiltTo - fx.tilt) * Math.min(1, dt * 2); fx.zoom += (zoomTo - fx.zoom) * Math.min(1, dt * 3); }
  const spinOn = since ? (1 - Math.exp(-since * 1.6)) / 1.6 : 0;
  const shockAge = now - fx.shockAt;
  const f: Frame = {
    time: s.t,
    rot: s.rot + s.spin * spinOn,
    n: s.n, nFrom: s.nFrom, morph: Math.min(1, (s.t - s.morphAt) / 0.35),
    a: s.a, dir: s.dir,
    walls: s.walls,
    look, hue: st.look.hue * s.t,
    speed: speed(s),
    kick: music.since("kick", now), snare: music.since("snare", now), beats,
    tilt: Math.min(44, st.tilt + st.sway * Math.sin(s.t * 0.37) + (isRun ? fx.tilt : 0)) + (since ? ease(after / 1.2) * 8 : 0),
    az: fx.az,
    swap: strobe,
    rewind: since ? 2.6 * ease(after / 1.6) : 0,
    player: s.dead ? 0 : s.immune && isRun ? 0.45 + 0.4 * Math.sin(s.t * 40) : 1,
    zoom: 1 + fx.bump + (isRun ? fx.zoom : 0) + (since ? 0.22 * ease(Math.min(since, 0.9) / 0.9) * (after > 0 || since < REPLAY.after ? 1 : 0) : 0) - menu * 0.08,
    shake: fx.shake, flash: fx.flash, aberr: fx.aberr + (s.hyper ? 0.0015 : 0),
    desat: since ? Math.min(0.65, since * 1.8) * (inReplay ? 0.5 : 1) : 0,
    shock: shockAge >= 0 && shockAge < 0.9 ? shockAge : -1,
    calm: menu * 0.7,
    stage: st.id, hyper: s.hyper,
    section: sec.kind, energy: isRun || screen !== "title" ? sec.energy : 0.3, sectionBeats: into, sectionLen: sec.len,
    blackout, invert,
    ghost: isRun && ghost && !s.dead ? ghostFrame(now) : null,
    killer: null, replay: 0,
    skin: save.skin, trail: save.trail,
  };
  if (inReplay) {
    // Which moment of the last second is showing, between two frames kept.
    const t = s.t - REPLAY.span + (since - REPLAY.after) * REPLAY.speed;
    let i = snaps.findIndex((x) => x.t > t);
    if (i < 1) i = i < 0 ? snaps.length - 1 : 1;
    const a = snaps[i - 1], b = snaps[i], k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-6, b.t - a.t)));
    const byId = new Map(b.walls.map((w) => [w.id, w]));
    Object.assign(f, {
      time: t, a: lerpAngle(a.a, b.a, k), dir: a.dir, rot: lerpAngle(a.rot, b.rot, k), n: a.n, nFrom: a.nFrom, morph: Math.min(1, (t - a.morphAt) / 0.35),
      walls: a.walls.map((w) => { const o = byId.get(w.id); return o ? { ...w, r: w.r + (o.r - w.r) * k } : w; }),
      player: 1, rewind: 0, killer: s.killer, replay: 1, shake: 0,
    });
  }
  return f;
}
const lerpAngle = (a: number, b: number, k: number) => { let d = b - a; if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
function ghostFrame(now: number) {
  if (!ghost) return null;
  if (ghost.state.t < ghost.t - 1e-6) return { a: ghost.state.a, alpha: 0.55 };
  if (ghostGone < 0) ghostGone = now;
  const fade = 1 - (now - ghostGone) / 0.5;
  return fade > 0 ? { a: ghost.state.a, alpha: 0.55 * fade } : null;
}
const hash = (n: number) => { let t = (n * 2654435761) >>> 0; t ^= t >>> 15; t = Math.imul(t, 2246822519) >>> 0; t ^= t >>> 13; return (t >>> 0) / 4294967296; };
function mixLook(a: Look, b: Look, t: number): Look {
  const m = (x: RGB, y: RGB): RGB => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
  return { bgA: m(a.bgA, b.bgA), bgB: m(a.bgB, b.bgB), wall: m(a.wall, b.wall), core: m(a.core, b.core), player: m(a.player, b.player), hue: a.hue };
}

// ---- the HUD --------------------------------------------------------------------------------------------------------

const hudTime = $("#time"), hudRank = $("#rank"), hudBar = $("#hud .bar i"), hudBest = $("#best"), hudIcon = $("#icon");
let shownRank = -1;
function updateHud(s: State) {
  const t = clock(s.t);
  hudTime.innerHTML = t.replace(/\.(\d+)$/, "<small>.$1</small>");
  if (shownRank !== s.rank) { shownRank = s.rank; hudRank.textContent = RANKS[s.rank].name; hudIcon.innerHTML = rankIcon(s.rank); }
  const next = RANKS[s.rank + 1];
  hudBar.style.width = next ? `${(((s.t - RANKS[s.rank].at) / (next.at - RANKS[s.rank].at)) * 100).toFixed(1)}%` : "100%";
  hudBest.textContent = s.endless ? `${nameOf(keyOf(s.stage.id, s.hyper))} · ${s.leg + 1} of ${LEGS.length}`
    : runPractice ? `Practice from ${RANKS[runPractice].name}`
    : recorded ? "Record" : prevBest > 0 ? `Best ${clock(prevBest)}` : runDay ? "Daily" : "";
}

// ---- keys -----------------------------------------------------------------------------------------------------------

const LEFT = new Set(["ArrowLeft", "a", "A"]), RIGHT = new Set(["ArrowRight", "d", "D"]);

function key(k: string) {
  if (k === "m" || k === "M") return toggleSound();
  if (screen === "look") return lookKey(k);
  if (screen === "title") {
    music.start();
    if (LEFT.has(k) || RIGHT.has(k)) {
      sel = (sel + (LEFT.has(k) ? -1 : 1) + CARDS) % CARDS;
      if (sel >= ENDLESS) hyper = false;
      music.sfx("move"); newDemo(); carousel();
    } else if ((k === "ArrowUp" || k === "ArrowDown" || k === "w" || k === "s") && sel < ENDLESS) {
      hyper = !hyper; music.sfx("move"); newDemo(); carousel();
    } else if (k === "p" || k === "P") {
      const b = boardOf(), can = starts(b);
      if (can.length < 2) { music.sfx("back"); return; }
      practice[b] = can[(can.indexOf(practice[b] ?? 0) + 1) % can.length];
      music.sfx("move"); carousel();
    } else if (k === "c" || k === "C") { music.sfx("select"); lookSel = { row: 0, i: SKINS.indexOf(save.skin) }; look(); }
    else if (k === " " || k === "Enter") begin();
    return;
  }
  if (screen === "run" && paused) {
    if (k === " " || k === "Enter") setPaused(false);
    else if (k === "Backspace") { paused = false; title(); }
    return;
  }
  if (screen === "run" && k === "Backspace" && run && !run.dead) { title(); return; }
  if ((screen === "over" || (screen === "run" && run?.dead)) && clockNow() - deathAt > 0.28) {
    if (k === " " || k === "Enter" || k === "ArrowUp" || k === "w") retry();
    else if (k === "Backspace") { music.sfx("back"); title(); }
  }
}

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Shift") focus = true;
  const dir = LEFT.has(e.key) ? "l" : RIGHT.has(e.key) ? "r" : "";
  if (dir) { if (!held.includes(dir)) held.push(dir); }
  if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace"].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  // In a run the arrows only steer.
  if (dir && screen === "run" && run && !run.dead && !paused) return;
  key(e.key);
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") focus = false;
  const dir = LEFT.has(e.key) ? "l" : RIGHT.has(e.key) ? "r" : "";
  if (dir) held.splice(held.indexOf(dir), 1);
});
window.addEventListener("blur", () => { held.length = 0; focus = false; });

function toggleSound() {
  save.muted = !save.muted;
  music.muted = save.muted;
  music.applyVolume();
  persist();
  if (screen === "title") carousel();
}

// ---- pal ------------------------------------------------------------------------------------------------------------

pal.onAction((id) => {
  if (id === "mute") return toggleSound();
  if (id === "play") return screen === "title" ? begin() : screen === "over" ? retry() : paused ? setPaused(false) : undefined;
  if (id === "stages" && screen !== "title") title();
});
pal.onHidden(() => { held.length = 0; if (screen === "run" && run && !run.dead) setPaused(true); else music.suspend(); });
pal.onShown(() => { if (!paused && music.ctx) music.start(); account(); });
ui.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest(".signin")) void pal.signIn().catch(() => {}); });
const account = () => pal.account().then((a) => { signedIn = a.signedIn; }, () => {});
// A save that sync merged with another machine's: take it, so the next run's settle writes onto it rather than over it.
pal.storage.onChange((k, v) => {
  if (k !== "save") return;
  save = load(v);
  if (screen === "title") carousel();
});

const loudness = (s: Record<string, unknown>) => { music.volume = typeof s.volume === "number" ? Math.max(0, Math.min(100, s.volume)) / 100 : 0.8; music.applyVolume(); };

/**
 * A staged moment for the store's screenshots (fixture.ts writes it to the
 * extension's storage): a board, a run of its chart played forward by the bot
 * and shown live with the bot still steering, or ended there; the look
 * screen. Never set by the game itself.
 */
function stage(sc: Scene) {
  if (sc.board) {
    const { stage, hyper: h } = parse(sc.board);
    sel = sc.board === "daily" ? DAILY : sc.board === "endless" ? ENDLESS : STAGES.findIndex((x) => x.id === stage); hyper = h;
  }
  if (sc.screen === "title") return title();
  if (sc.screen === "look") { title(); lookSel = { row: 0, i: SKINS.indexOf(save.skin) }; return look(); }
  const key = boardOf();
  const s = fresh_run(key);
  if (sc.seed !== undefined) Object.assign(s, create({ stage: s.stage.id, hyper: s.hyper, seed: sc.seed, endless: s.endless }));
  play(s, sc.t ?? 20);
  s.events.length = 0;
  autopilot = true;
  runPractice = 0;
  start(s, key);
  fx.flash = 0; fx.shockAt = -9;
  if (sc.screen === "over") { s.dead = true; s.killer = s.walls[0] ?? null; die(); }
}

async function boot() {
  save = load(await pal.storage.get("save").catch(() => null));
  account();
  const scene = (await pal.storage.get("scene").catch(() => null)) as Scene | null;
  music.muted = save.muted;
  loudness(await pal.settings().catch(() => ({})));
  pal.onSettings(loudness);
  const last = save.last === "endless" ? ENDLESS : STAGES.findIndex((x) => x.id === parse(save.last).stage);
  sel = Math.max(0, last); hyper = parse(save.last).hyper;
  await document.fonts?.load("700 20px Orbitron").catch(() => {});
  if (scene) stage(scene);
  else title();
  if (!gfx) { ui.className = "nogl"; ui.innerHTML = `<div class="card"><b>Vortex needs WebGL 2</b><span>This window can't draw it.</span></div>`; }
  requestAnimationFrame(frame);
  requestAnimationFrame(() => pal.ready());
}

if (new URLSearchParams(location.search).has("dev")) Object.assign(window, { vx: { get run() { return run; }, get save() { return save; }, begin, key, music, songs: SONGS, title, setSel: (i: number, h = false) => { sel = i; hyper = h; carousel(); newDemo(); } } });
void boot();
