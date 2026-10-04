// Vortex's page: the stage carousel, the run, the death and the instant retry.
// The music is the clock (music.ts): a run's time is the heard audio time
// since its step 0, the sim (../game/sim.ts) is stepped up to it every frame,
// and its events become light and sound. The renderer (render.ts) draws the
// sim's state plus everything that is only for the eye: the rewind after a
// death, flashes, rings, the camera's sway. The save goes through the kit's
// storage; hiding pal's panel pauses a run.
import type { SurfaceKit } from "@zcag/pal";
import { CLEAR, RANKS, STAGES, stageOf, type Look, type RGB } from "../game/content.ts";
import { DT, beat, clock, create, speed, step, type Input, type State } from "../game/sim.ts";
import { decide, play } from "../game/bot.ts";
import { best, daily, dailyOpen, fresh, keyOf, load, open, parse, settle, type Outcome, type Save, type Scene } from "../game/meta.ts";
import { Renderer, type Frame } from "./render.ts";
import { music } from "./music.ts";
import { SONGS } from "./songs.ts";

declare const pal: SurfaceKit;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const canvas = $<HTMLCanvasElement>("#gl");
const ui = $("#ui"), hud = $("#hud"), banners = $("#banners");
let gfx: Renderer | null = null;
try { gfx = new Renderer(canvas); } catch (e) { console.error("vortex: webgl", e); }

type ScreenId = "title" | "run" | "over";
let screen: ScreenId = "title";
let save: Save = fresh();
/** The carousel: 0..5 the stages, 6 the daily; and whether hyper is chosen. */
let sel = 0, hyper = false;

let run: State | null = null;
let runKey = "", runDay: string | undefined;
/** The run's step 0 on the clock. */
let zero = 0;
let paused = false;
let deathAt = -1;
let outcome: Outcome | null = null;
let prevBest = 0, recorded = false;
/** Steered by the bot (screenshots), not the keys. */
let autopilot = false;

/** A bot plays the chosen stage behind the menus. */
let demo: State | null = null;
let demoAcc = 0, demoDeadAt = -1;

const fx = { flash: 0, shake: 0, aberr: 0, shockAt: -9, bump: 0, az: Math.random() * 6 };
const held: string[] = [];
let focus = false;
let last = performance.now();
let wasRunning = false;

// ---- helpers --------------------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const kbd = (k: string) => `<kbd>${k}</kbd>`;
const hex = (c: RGB) => `rgb(${c.map((x) => Math.round(x * 255)).join(",")})`;
const today = () => daily(new Date());
const persist = () => pal.storage.set("save", save).catch((e) => console.error("vortex: save", e));
const boardOf = () => (sel === 6 ? keyOf(today().stage, false) : keyOf(STAGES[sel].id, hyper));
const lookOf = (s: State | null, key = boardOf()) => {
  const { stage, hyper: h } = s ? { stage: s.stage.id, hyper: s.hyper } : parse(key);
  const st = stageOf(stage);
  return h ? st.hyperLook : st.look;
};

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
  run = null; paused = false;
  hud.hidden = true;
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

function carousel() {
  const board = boardOf();
  const isDaily = sel === 6;
  const st = stageOf(parse(board).stage);
  const opened = isDaily ? dailyOpen(save) : open(save, board);
  const b = isDaily ? (save.daily.day === today().day ? save.daily.best : 0) : best(save, board);
  const tries = isDaily ? (save.daily.day === today().day ? save.daily.tries : 0) : save.boards[board]?.tries ?? 0;
  const prev = STAGES[Math.max(0, sel - 1)];
  const lock = isDaily ? "Clear Pulse to open the daily" : hyper ? `Clear ${st.name} to open its hyper` : `Clear ${prev.name} to open`;
  const hyperOpen = !isDaily && open(save, keyOf(st.id, true));
  setAccent(lookOf(null, board));
  const dots = [...STAGES.map((x, i) => {
    const k = keyOf(x.id, false), cleared = best(save, k) >= CLEAR, hk = best(save, keyOf(x.id, true)) >= CLEAR;
    return `<i class="${i === sel ? "on" : ""} ${open(save, k) ? "" : "locked"} ${cleared ? "clear" : ""} ${hk ? "hclear" : ""}"></i>`;
  }), `<i class="day ${sel === 6 ? "on" : ""} ${dailyOpen(save) ? "" : "locked"}"></i>`].join("");
  ui.className = "title";
  ui.innerHTML = `
    <div class="logo"><b>VORTEX</b><span>${save.boards.pulse ? "" : "turn with ← → · survive"}</span></div>
    <div class="card ${opened ? "" : "is-locked"} ${hyper && !isDaily ? "is-hyper" : ""}">
      <div class="nav"><span class="arrow">‹</span><div class="name">${isDaily ? "Daily" : esc(st.name)}${hyper && !isDaily ? `<em>Hyper</em>` : ""}</div><span class="arrow">›</span></div>
      <div class="blurb">${isDaily ? `${esc(st.name)} · today's walls, the same every try` : esc(st.blurb)}</div>
      ${opened ? `
        <div class="stats">
          <div><small>Best</small><b>${clock(b)}</b></div>
          <div class="rk">${rankIcon(rankOf(b))}<span>${RANKS[rankOf(b)].name}</span></div>
          <div><small>Tries</small><b>${tries}</b></div>
        </div>` : `<div class="lock">${esc(lock)}</div>`}
      <div class="dots">${dots}</div>
    </div>
    <div class="keys">${kbd("←")}${kbd("→")} stage ${!isDaily ? `${kbd("↑")} ${hyperOpen || hyper ? "hyper" : '<s>hyper</s>'}` : ""} ${kbd("space")} play ${kbd("m")} sound${save.muted ? " off" : ""}</div>`;
  ui.querySelectorAll<HTMLElement>(".arrow").forEach((el, i) => el.addEventListener("click", () => key(i ? "ArrowRight" : "ArrowLeft")));
  ui.querySelector(".name")?.addEventListener("click", () => key("Enter"));
}
const rankOf = (t: number) => { let r = 0; RANKS.forEach((x, i) => { if (t >= x.at) r = i; }); return r; };

// ---- a run ----------------------------------------------------------------------------------------------------------

function begin() {
  const isDaily = sel === 6;
  const key = boardOf();
  if (isDaily ? !dailyOpen(save) : !open(save, key)) { music.sfx("back"); ui.querySelector(".card")?.animate([{ transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "none" }], { duration: 180 }); return; }
  const { stage, hyper: h } = parse(key);
  runDay = isDaily ? today().day : undefined;
  start(create({ stage, hyper: h, seed: isDaily ? today().seed : (Math.random() * 2 ** 32) >>> 0 }), key);
}

function start(s: State, key: string) {
  music.start();
  run = s; runKey = key;
  demo = null;
  screen = "run"; paused = false; deathAt = -1; outcome = null; recorded = false;
  prevBest = runDay ? (save.daily.day === runDay ? save.daily.best : 0) : best(save, key);
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
  gfx?.clearTrail();
  gfx?.ring(s.n, lookOf(s).wall);
  fx.flash = 0.55; fx.shockAt = clockNow(); fx.bump = 0.08;
  pal.title(`Vortex · ${s.stage.name}${s.hyper ? " Hyper" : ""}`);
}

function die() {
  if (!run) return;
  deathAt = clockNow();
  gfx?.burst(frameOf(run, clockNow()), lookOf(run).player);
  music.sfx("death");
  music.layer = -1;
  music.open(240, 0.35);
  fx.flash = 0.85; fx.shake = 0.45; fx.aberr = 0.024;
  outcome = settle(save, runKey, run.t, runDay);
  persist();
  setTimeout(() => { if (screen === "run" && run?.dead) { music.open(1100, 1.6); over(); } }, 520);
}

function over() {
  if (!run || !outcome) return;
  screen = "over";
  hud.hidden = true;
  const o = outcome;
  const nextRank = RANKS[o.rank + 1];
  const opened = o.opened.map((k) => k === "daily" ? "The daily is open" : `${stageOf(parse(k).stage).name}${parse(k).hyper ? " Hyper" : ""} is open`);
  const delta = o.t - o.prev;
  ui.className = "over";
  ui.innerHTML = `
    <div class="card">
      <div class="time">${clock(o.t).replace(/\.(\d+)$/, "<small>.$1</small>")}</div>
      <div class="line">${rankIcon(o.rank)}<b>${RANKS[o.rank].name}</b>
        ${o.record && o.prev > 0 ? `<span class="gold">New record · +${delta.toFixed(2)}</span>` : o.record ? `<span class="gold">First time on the board</span>` : `<span>Best ${clock(o.prev)} · ${delta.toFixed(2)}</span>`}
      </div>
      ${nextRank ? `<div class="next"><span>${nextRank.name} at ${nextRank.at}s</span><div class="bar"><i style="width:${Math.min(100, (o.t / nextRank.at) * 100).toFixed(1)}%"></i></div><span>${(nextRank.at - o.t).toFixed(1)}s away</span></div>` : `<div class="next"><span class="gold">Cleared. Every second past ${CLEAR} is yours.</span></div>`}
      ${opened.map((x) => `<div class="opened">${esc(x)}</div>`).join("")}
    </div>
    <div class="keys">${kbd("space")} again ${kbd("⌫")} stages</div>`;
  if (o.opened.length) music.sfx("open");
}

function retry() {
  if (!run) return;
  const { id } = run.stage;
  start(create({ stage: id, hyper: run.hyper, seed: runDay ? today().seed : (Math.random() * 2 ** 32) >>> 0 }), runKey);
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
      step(run, autopilot ? decide(run) : input());
      for (const e of run.events) onEvent(run, e);
      run.events.length = 0;
      if (run.dead) break;
    }
    if (!run.dead) {
      music.layer = run.rank;
      if (!recorded && prevBest > 0 && run.t > prevBest) { recorded = true; banner("New record", "", "gold"); music.sfx("record"); hud.classList.add("record"); }
    }
    updateHud(run);
  }
  if (demo && screen === "title") stepDemo(dt);

  fx.flash *= Math.exp(-dt * 7);
  fx.shake *= Math.exp(-dt * 5);
  fx.aberr *= Math.exp(-dt * 3);
  fx.bump *= Math.exp(-dt * 6);
  fx.az += dt * (screen === "run" ? 0.12 : 0.05);
  const s = run ?? demo;
  if (gfx && s) gfx.draw(frameOf(s, now), dt);
}

function input(): Input {
  const k = held[held.length - 1];
  return { dir: k === "l" ? -1 : k === "r" ? 1 : 0, focus };
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
  else if (e.type === "rank") {
    const r = RANKS[e.rank];
    banner(r.name.toUpperCase(), e.rank === RANKS.length - 1 ? (s.hyper ? "Hyper cleared" : "Stage cleared") : "", e.rank === RANKS.length - 1 ? "clear" : "");
    gfx?.ring(s.n, l.core);
    fx.flash = Math.max(fx.flash, 0.3); fx.shockAt = clockNow(); fx.bump = 0.07; fx.aberr = 0.012;
    music.sfx("rank");
  } else if (e.type === "flip") {
    if (e.surge) { fx.aberr = Math.max(fx.aberr, 0.008); music.sfx("flip"); }
  } else if (e.type === "morph") gfx?.ring(e.n, l.wall);
}

/** The state as the renderer sees it, with everything only for the eye laid on top. */
function frameOf(s: State, now: number): Frame {
  const st = s.stage;
  const base = s.hyper ? st.hyperLook : st.look, other = s.hyper ? st.look : st.hyperLook;
  // Past the clear, the colours turn: the stage shows you its other face.
  const turn = s === run && s.t > CLEAR ? Math.min(1, (s.t - CLEAR) / 2) : 0;
  const look = turn ? mixLook(base, other, turn * (s.hyper ? 0.5 : 1)) : base;
  const dead = s.dead && s === run && deathAt > 0 ? Math.max(0, now - deathAt) : 0;
  const menu = screen === "title" ? 1 : screen === "over" ? 0.6 : 0;
  const beats = (now - zero) / beat(s);
  const bar = Math.floor(beats / 4);
  const strobe = st.strobe > 0 && s === run && !s.dead && hash(bar + s.seed) < st.strobe * (0.4 + s.rank * 0.12) ? Math.floor(beats) % 2 : 0;
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const spinOn = dead ? (1 - Math.exp(-dead * 1.6)) / 1.6 : 0;
  const shockAge = now - fx.shockAt;
  return {
    time: s.t,
    rot: s.rot + s.spin * spinOn,
    n: s.n, nFrom: s.nFrom, morph: Math.min(1, (s.t - s.morphAt) / 0.35),
    a: s.a, dir: s.dir,
    walls: s.walls,
    look, hue: st.look.hue * s.t,
    speed: speed(s),
    kick: music.since("kick", now), snare: music.since("snare", now), beats,
    tilt: Math.min(44, st.tilt + st.sway * Math.sin(s.t * 0.37)) + (dead ? ease(dead / 1.2) * 8 : 0),
    az: fx.az,
    swap: strobe,
    rewind: dead ? 2.6 * ease(dead / 1.6) : 0,
    player: s.dead ? 0 : 1,
    zoom: 1 + fx.bump + (dead ? 0.22 * ease(dead / 0.9) : 0) - menu * 0.08,
    shake: fx.shake, flash: fx.flash, aberr: fx.aberr + (s.hyper ? 0.0015 : 0),
    desat: dead ? Math.min(0.65, dead * 1.8) : 0,
    shock: shockAge >= 0 && shockAge < 0.9 ? shockAge : -1,
    calm: menu * 0.7,
  };
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
  hudBest.textContent = recorded ? "Record" : prevBest > 0 ? `Best ${clock(prevBest)}` : runDay ? "Daily" : "";
}

// ---- keys -----------------------------------------------------------------------------------------------------------

const LEFT = new Set(["ArrowLeft", "a", "A"]), RIGHT = new Set(["ArrowRight", "d", "D"]);

function key(k: string) {
  if (k === "m" || k === "M") return toggleSound();
  if (screen === "title") {
    music.start();
    if (LEFT.has(k) || RIGHT.has(k)) {
      sel = (sel + (LEFT.has(k) ? -1 : 1) + 7) % 7;
      if (sel === 6) hyper = false;
      music.sfx("move"); newDemo(); carousel();
    } else if ((k === "ArrowUp" || k === "ArrowDown" || k === "w" || k === "s") && sel < 6) {
      hyper = !hyper; music.sfx("move"); newDemo(); carousel();
    } else if (k === " " || k === "Enter") begin();
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
pal.onShown(() => { if (!paused && music.ctx) music.start(); });

const loudness = (s: Record<string, unknown>) => { music.volume = typeof s.volume === "number" ? Math.max(0, Math.min(100, s.volume)) / 100 : 0.8; music.applyVolume(); };

/**
 * A staged moment for the store's screenshots (fixture.ts writes it to the
 * extension's storage): a board, a run from a seed played forward by the bot
 * and shown live with the bot still steering, or ended there. Never set by the
 * game itself.
 */
function stage(sc: Scene) {
  if (sc.board) {
    const { stage, hyper: h } = parse(sc.board);
    sel = sc.board === "daily" ? 6 : STAGES.findIndex((x) => x.id === stage); hyper = h;
  }
  if (sc.screen === "title") return title();
  const { stage, hyper: h } = parse(boardOf());
  const s = play(create({ stage, hyper: h, seed: sc.seed ?? 7 }), sc.t ?? 20);
  s.events.length = 0;
  autopilot = true;
  start(s, boardOf());
  fx.flash = 0; fx.shockAt = -9;
  if (sc.screen === "over") { s.dead = true; die(); }
}

async function boot() {
  save = load(await pal.storage.get("save").catch(() => null));
  const scene = (await pal.storage.get("scene").catch(() => null)) as Scene | null;
  music.muted = save.muted;
  loudness(await pal.settings().catch(() => ({})));
  pal.onSettings(loudness);
  const lastIdx = STAGES.findIndex((x) => x.id === parse(save.last).stage);
  sel = Math.max(0, lastIdx); hyper = parse(save.last).hyper;
  await document.fonts?.load("700 20px Orbitron").catch(() => {});
  if (scene) stage(scene);
  else title();
  if (!gfx) { ui.className = "nogl"; ui.innerHTML = `<div class="card"><b>Vortex needs WebGL 2</b><span>This window can't draw it.</span></div>`; }
  requestAnimationFrame(frame);
  requestAnimationFrame(() => pal.ready());
}

if (new URLSearchParams(location.search).has("dev")) Object.assign(window, { vx: { get run() { return run; }, get save() { return save; }, begin, key, music, songs: SONGS, title, setSel: (i: number, h = false) => { sel = i; hyper = h; carousel(); newDemo(); } } });
void boot();

