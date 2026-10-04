// Highway's page: the garage (your car driving the highway behind a sign you
// set it up on), the run, the pause and the end of a run. The extension's
// storage keeps the save (synced: a merged one sync brings in replaces the
// page's); every finished run goes to its mode's leaderboard; the panel
// hiding pauses the run.
import * as THREE from "./vendor/three.js";
import type { SurfaceKit } from "@zcag/pal";
import { Renderer } from "./render.ts";
import { World } from "./world.ts";
import { Run, preloadTraffic, warmTraffic } from "./run.ts";
import { Chase, VIEWS } from "./camera.ts";
import { Car } from "./car.ts";
import { Sound } from "./audio.ts";
import { ONE_WAY, TWO_WAY, laneX } from "../game/layout.ts";
import { CARS, LOCATIONS, MODES, UPGRADE_MAX, FEEL, upgradeCost, stats, paintSet, classOf, type Upgrades } from "../game/content.ts";
import { load, stored, fresh, carOf, buyCar, buyUpgrade, paint, finish, places, modes, paintsOpen, opensAt, fillMissions, NO_UP, type Save, type Scene, type Result } from "../game/meta.ts";
import { xpFor, nextUnlock, progressOf, statsOf, MAX_LEVEL } from "../game/progress.ts";
import type { Miss } from "../game/score.ts";
import type { End, Packed } from "../game/drive.ts";
import { acrossAt, type Input } from "../game/vehicle.ts";

declare const pal: SurfaceKit;
const $ = (id: string) => document.getElementById(id)!;
const q = new URLSearchParams(location.search);

const r = new Renderer($("view") as HTMLCanvasElement);
const world = new World(r.gl);
const chase = new Chase(r.camera);
const sound = new Sound();
let save: Save = fresh();
let run: Run | null = null;
let builtFor = "", warmedFor = ""; // the place the world was built for, and the one its traffic's shaders were made for
type State = "loading" | "garage" | "run" | "paused" | "over" | "results";
let state: State = "loading";
let names = new Map<string, string>(); // model id to its name, for the crash line

let scene: Scene | null = null;
let trial = false; // ?test: everything open, nothing saved
/** The saved view's place in VIEWS; the first if it is gone. */
const viewOf = (s: Save) => Math.max(0, VIEWS.findIndex((v) => v.name === s.settings.view));
const persist = () => { if (!scene && !trial) pal.storage.set("save", stored(save)).catch((e: unknown) => console.error("highway: save", e)); };
/** Whether the player is signed in to a pal account, asked again on every show; until known, no offer to sign in. */
let signedIn = true;
const account = () => pal.account().then((a) => { signedIn = a.signedIn; }, () => {});
const layoutOf = (mode: string) => (MODES.find((m) => m.id === mode)?.twoWay ? TWO_WAY : ONE_WAY);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const kmh = (v: number) => (save.settings.units === "mph" ? v * 0.6214 : v);
const unit = () => (save.settings.units === "mph" ? "mph" : "km/h");
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- the road

/** Put a car on the road (building the place first if it changed); `ready` runs once it is placed, before any frame of it is shown. */
async function road(demo: boolean, ready?: () => void) {
  const loc = LOCATIONS.find((l) => l.id === save.location)!;
  const layout = layoutOf(save.mode);
  const key = `${loc.id}/${save.mode}`;
  if (builtFor !== key) {
    veil(true, `Driving to ${loc.name}`);
    run?.dispose();
    run = null;
    await world.build(loc.sky, loc.asphalt, layout);
    builtFor = key;
  }
  run?.dispose();
  const car = demo ? CARS[browse] : carOf(save.car);
  const owned = save.owned[car.id];
  const player = await Car.load(car.id, owned?.paint ?? car.paint);
  run = new Run(world, layout, player, car, owned?.upgrades ?? NO_UP, events, loc.density, demo ? "endless" : save.mode);
  if (demo) run.veh.launch((105 / 3.6) * FEEL.pace);
  run.settle();
  if (warmedFor !== key) { await warmTraffic(world, (sc) => r.warm(sc)); warmedFor = key; }
  chase.reset(run.pose);
  ready?.();
  // lift the sign over a finished picture: the land to the horizon built, every texture on the GPU, a few frames drawn
  world.land.ready(run.veh.z);
  r.upload(world.scene);
  await frames(3);
  veil(false);
}
/** `n` frames drawn, or 700 ms, whichever comes first (a page drawn in software, or not shown, draws slowly or not at all). */
const frames = (n: number) => new Promise<void>((done) => { const tick = () => (--n <= 0 ? done() : requestAnimationFrame(tick)); requestAnimationFrame(tick); setTimeout(done, 700); });

// what the run tells us
let flash = 0, slowmo = 0;
let crashInfo: { you: number; them: number; kind: string; oncoming: boolean } | null = null;
const events = {
  miss(m: Miss) {
    if (state !== "run") return;
    const label = m.double ? "Threaded the gap" : m.grade.name;
    pop(`${label}<small>+${m.points.toLocaleString("en-US")}</small>`, m.oncoming ? "oncoming" : m.double || m.grade.mult > 2 ? "big" : "");
    sound.play("combo_ding", { gain: 0.45, rate: Math.pow(2, Math.min(12, m.combo - 1) / 12) });
    const c = $("combo");
    c.classList.remove("bump");
    void c.offsetWidth;
    c.classList.add("bump");
  },
  pass(n: { kind: string }, gap: number, closing: number, side: number) {
    if (gap > 2.4 || closing < 8) return;
    const heavy = /lct|shvan|lightbody/.test(n.kind);
    sound.play(heavy ? "truck_passby" : gap < 0.8 ? "passby_close" : "passby", { gain: Math.min(1, (2.6 - gap) / 2) * Math.min(1, closing / 30), pan: side * 0.7, rate: 0.9 + closing / 140 });
  },
  bump(j: number, side: number) {
    sound.play(j > 4000 ? "impact_metal" : "bump", { gain: Math.min(1, 0.3 + j / 12000), pan: side * 0.4 });
    chase.hit(side, Math.min(1, j / 8000));
    flash = Math.min(1, flash + j / 20000);
  },
  crash(info: { you: number; them: number; kind: string; oncoming: boolean }) {
    if (state === "garage") { setTimeout(() => state === "garage" && road(true), 1800); return; }
    ended = "crash";
    state = "over";
    sound.play("crash_heavy", { gain: 1 });
    sound.play("glass_break", { gain: 0.6 });
    chase.hit(0, 1.2);
    chase.lingering = 0.001;
    flash = 1;
    crashInfo = info;
    slowmo = 1.7;
  },
  scrape() { sound.play("impact_metal", { gain: 0.35 }); },
  nitro(on: boolean) { if (state === "run" && on) { sound.play("backfire", { gain: 0.5 }); chase.hit(0, 0.25); } },
  checkpoint(added: number) { if (state === "run") { banner(`+${added} s`); sound.play("countdown_go", { gain: 0.5 }); } },
  end(why: End) {
    if (state !== "run" || why === "crash") return;
    ended = why;
    state = "over";
    sound.play(why === "time" ? "countdown_beep" : "ui_error", { gain: 0.6 });
    banner(why === "time" ? "Time's up" : "Too slow");
    slowmo = 1.2;
  },
};
let ended: End | null = null;

// ---------------------------------------------------------------- input

const keys = new Set<string>();
let muted = false;
window.addEventListener("keydown", (e: KeyboardEvent) => {
  const k = e.key.toLowerCase();
  if (e.metaKey || e.ctrlKey) return;
  sound.start();
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
  if (!e.repeat) onKey(k);
  keys.add(k);
});
// the key hints are buttons too, and a garage line is picked by clicking it
document.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const key = el.closest<HTMLElement>("[data-key]")?.dataset.key;
  if (key) { sound.start(); onKey(key); return; }
  const at = el.closest<HTMLElement>("[data-row]")?.dataset.row;
  if (at && state === "garage") { row = +at; drawGarage(); }
});
window.addEventListener("keyup", (e: KeyboardEvent) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

function input(): Input {
  const k = (...n: string[]) => n.some((x) => keys.has(x));
  return {
    throttle: k("arrowup", "w") ? 1 : 0,
    brake: k("arrowdown", "s") ? 1 : 0,
    steer: (k("arrowleft", "a") ? 1 : 0) - (k("arrowright", "d") ? 1 : 0),
    nitro: k(" ", "shift"),
  };
}

function onKey(k: string) {
  if (k === "m") { muted = !muted; sound.setVolume(muted ? 0 : save.settings.sound); return; }
  if (state === "garage") { garageKey(k); return; }
  if (state === "run") {
    if (k === "c") { chase.view = (chase.view + 1) % VIEWS.length; save.settings.view = VIEWS[chase.view].name; persist(); hint(`${VIEWS[chase.view].name} view`); }
    if (k === "p" || k === "enter") pause();
    return;
  }
  if (state === "paused") {
    if (k === "p" || k === "enter") resume();
    if (k === "q") giveUp();
    return;
  }
  if (state === "results") {
    if (tallying) { skipTally(); return; } // a key while it counts shows it all at once
    if (k === "enter" || k === " ") drive();
    if (k === "backspace" || k === "g") garage();
  }
}

// ---------------------------------------------------------------- garage

let row = 0;
let browse = 0; // the car shown, owned or not
const ROWS = ["car", "paint", "speed", "handling", "brakes", "nitro", "mode", "place"] as const;

async function garage() {
  state = "garage";
  $("card").hidden = true;
  $("hud").hidden = true;
  browse = CARS.findIndex((c) => c.id === save.car);
  fillMissions(save);
  persist();
  await road(true);
  sound.setEngine(CARS[browse].engine);
  drawGarage();
  $("garage").hidden = false;
  $("side").hidden = false;
}

const shownCar = () => CARS[browse];
const tag = (price: number) => `<em class="${save.cash >= price ? "can" : "no"}">${money(price)}</em>`;
const lock = (level: number) => `<em class="lock">level ${level}</em>`;
const pips = (n: number) => Array.from({ length: UPGRADE_MAX }, (_, i) => `<i class="${i < n ? "f" : ""}"></i>`).join("");
let tint = ""; // a colour being looked at, not yet bought

function drawGarage() {
  const car = shownCar(), owned = save.owned[car.id], up = owned?.upgrades ?? NO_UP;
  // browsing another car: each bar shows what it gains on yours in yellow, and where yours stands; on an
  // upgrade's row, what its next level adds to this car
  const k = ROWS[row] as keyof Upgrades, next = owned && k in up && k !== "nitro" && up[k] < UPGRADE_MAX;
  const st = stats(car, next ? { ...up, [k]: up[k] + 1 } : up);
  const mine = next ? stats(car, up) : car.id === save.car ? null : stats(carOf(save.car), save.owned[save.car]?.upgrades ?? NO_UP);
  const bar = (v: number, was?: number) => `<i class="${was === undefined ? "" : v > was + 0.05 ? "up" : "cmp"}" style="--v:${v.toFixed(2)};--w:${Math.min(v, was ?? v).toFixed(2)};--was:${(was ?? 0).toFixed(2)}"></i>`;
  const loc = LOCATIONS.find((l) => l.id === save.location)!;
  const mode = MODES.find((m) => m.id === save.mode)!;
  const best = save.best[save.mode];
  const sel = (k: string) => `${ROWS[row] === k ? " on" : ""}" data-row="${ROWS.indexOf(k as (typeof ROWS)[number])}`;
  const upRow = (k: keyof Upgrades, label: string) => {
    const lv = up[k], max = lv >= UPGRADE_MAX;
    const price = !owned ? "" : max ? "<em>Full</em>" : tag(upgradeCost(car, lv));
    return `<div class="row${sel(k)}"><span>${label}</span><div class="val"><span class="pips">${pips(lv)}</span>${price}</div></div>`;
  };
  const carTag = owned ? `<em>${car.id === save.car ? "Yours" : "Owned"}</em>` : tag(car.price);
  const placeOpen = places(save).includes(loc), modeOpen = modes(save).includes(mode);
  const shown = tint || owned?.paint;
  const set = paintSet(shown ?? car.paint);
  const paintTag = owned && tint && !owned.paints.includes(tint) ? (paintsOpen(save).includes(set) ? tag(set.price) : lock(opensAtPaint(set.id))) : "";
  const swatches = set.colors.map((c) => `<i style="background:${c}" class="${shown === c ? "on" : ""}"></i>`).join("");
  $("garage").innerHTML = `
    <div class="sign">
      <div class="head"><b>Highway</b><span>${money(save.cash)}</span></div>
      <div class="rows">
        <div class="row${sel("car")}"><span>${classOf(car).name}</span><div class="val"><span class="arrows">${car.name}</span>${carTag}</div></div>
        <div class="bars">
          <span>Top speed</span>${bar(st.speed, mine?.speed)}
          <span>Pickup</span>${bar(st.accel, mine?.accel)}
          <span>Handling</span>${bar(st.handling, mine?.handling)}
          <span>Brakes</span>${bar(st.brakes, mine?.brakes)}
        </div>
        <div class="row${sel("paint")}"><span>${set.name}</span><div class="val"><span class="swatches">${swatches}</span>${paintTag}</div></div>
        ${upRow("speed", "Engine")}
        ${upRow("handling", "Handling")}
        ${upRow("brakes", "Brakes")}
        ${upRow("nitro", "Nitro")}
        <div class="row${sel("mode")}"><span>Mode</span><div class="val"><span class="arrows">${mode.name}</span>${modeOpen ? "" : lock(opensAt("mode", mode.id))}</div></div>
        <div class="row${sel("place")}"><span>Place</span><div class="val"><span class="arrows">${loc.name}</span>${placeOpen ? "" : lock(opensAt("place", loc.id))}</div></div>
      </div>
      <div class="drive">
        <div><div class="go">${!owned ? "Buy it to drive" : !modeOpen || !placeOpen ? "Not open yet" : "Drive"}</div><div class="best">${best ? `Best ${best.score.toLocaleString("en-US")} in ${(best.distance / 1000).toFixed(1)} km` : mode.about}</div></div>
        <div class="keys"><button data-key=" "><kbd>space</kbd> drive</button><br><button data-key="enter"><kbd>enter</kbd> buy</button></div>
      </div>
    </div>`;
  drawSide();
}
const opensAtPaint = (id: string) => { for (let l = 1; l <= MAX_LEVEL; l++) if (paintsOpen({ ...save, level: l }).some((p) => p.id === id)) return l; return 1; };

/** The driver's level and the missions, on the right. */
function drawSide() {
  const next = nextUnlock(save.level);
  const need = xpFor(save.level);
  $("side").innerHTML = `
    <div class="driver"><b>Level ${save.level}</b><span>${save.level >= MAX_LEVEL ? "Top level" : `${Math.round(save.xp).toLocaleString("en-US")} / ${need.toLocaleString("en-US")} XP`}</span>
      <i style="--v:${save.level >= MAX_LEVEL ? 1 : save.xp / need}"></i>
      ${next ? `<small>Level ${next.level} opens ${next.unlocks.map((u) => u.name).join(", ")}</small>` : ""}</div>
    <div class="missions">${save.missions.map((m) => `<div><span>${m.text}</span><em>${money(m.reward.cash)} · ${m.reward.xp} XP</em></div>`).join("")}</div>`;
}

async function garageKey(k: string) {
  const car = shownCar(), owned = save.owned[car.id];
  const what = ROWS[row];
  if (k === "arrowup" || k === "w" || k === "arrowdown" || k === "s") {
    if (tint && owned) { tint = ""; run?.player.setColor(owned.paint); }
    row = (row + (k === "arrowup" || k === "w" ? ROWS.length - 1 : 1)) % ROWS.length;
  } else if (k === " ") {
    const loc = LOCATIONS.find((l) => l.id === save.location)!, mode = MODES.find((m) => m.id === save.mode)!;
    if (!owned || !places(save).includes(loc) || !modes(save).includes(mode)) { sound.play("ui_error", { gain: 0.5 }); return; }
    if (tint) { tint = ""; run?.player.setColor(owned.paint); }
    if (save.car !== car.id) { save.car = car.id; persist(); }
    drive();
    return;
  } else if (k === "arrowleft" || k === "arrowright" || k === "a" || k === "d") {
    const d = k === "arrowleft" || k === "a" ? -1 : 1;
    if (what === "car") { browse = (browse + d + CARS.length) % CARS.length; tint = ""; sound.play("ui_select", { gain: 0.5 }); await preview(); }
    else if (what === "paint" && owned) {
      // the open collections' colours, then the next locked one's to look at
      const colors = paintsOpen(save).flatMap((p) => p.colors);
      const i = colors.indexOf(tint || owned.paint);
      tint = colors[(i + d + colors.length) % colors.length];
      if (owned.paints.includes(tint)) { owned.paint = tint; tint = ""; persist(); }
      run?.player.setColor(tint || owned.paint);
    }
    else if (what === "mode") { const i = MODES.findIndex((m) => m.id === save.mode); save.mode = MODES[(i + d + MODES.length) % MODES.length].id; if (modes(save).some((m) => m.id === save.mode)) persist(); await road(true); }
    else if (what === "place") { const i = LOCATIONS.findIndex((l) => l.id === save.location); save.location = LOCATIONS[(i + d + LOCATIONS.length) % LOCATIONS.length].id; if (places(save).some((l) => l.id === save.location)) persist(); await road(true); }
    else return;
  } else if (k === "enter") {
    let ok = false;
    if (what === "car") { ok = !owned && buyCar(save, car); if (owned) { save.car = car.id; ok = true; } }
    else if (what === "paint" && owned && tint) { ok = paint(save, car, tint); if (ok) tint = ""; }
    else if ((what === "speed" || what === "handling" || what === "brakes" || what === "nitro") && owned) { ok = buyUpgrade(save, car, what); if (ok && run) run.setPlayer(run.player, car, owned.upgrades); }
    sound.play(ok ? "cash" : "ui_error", { gain: 0.6 });
    if (ok) persist();
  } else return;
  drawGarage();
}

/** Show the browsed car on the road. */
async function preview() {
  const car = shownCar();
  const model = await Car.load(car.id, save.owned[car.id]?.paint ?? car.paint);
  if (shownCar() !== car || !run) { model.dispose(); return; }
  run.setPlayer(model, car, save.owned[car.id]?.upgrades ?? NO_UP);
  sound.setEngine(car.engine);
  drawGarage();
}

// ---------------------------------------------------------------- the run

let musicOn = false;
/** Start a run. The garage's last frame stays up (its sign too) until the run is ready, then it cuts to it; `prep` runs
 *  on the new run before its first frame (a kept run unpacked into it). */
async function drive(prep?: () => void) {
  const car = carOf(save.car);
  browse = CARS.indexOf(car);
  state = "loading"; // nothing drawn while the car is swapped: the last frame holds
  crashInfo = null;
  ended = null;
  done.clear();
  await road(false, () => {
    $("garage").hidden = true;
    $("side").hidden = true;
    $("card").hidden = true;
    chase.view = viewOf(save);
    if (q.has("launch")) { run!.veh.launch((+q.get("launch")! / 3.6) * FEEL.pace); run!.settle(); } // ?launch=<km/h>: start a run at a speed, for trying the feel
    prep?.();
    chase.reset(run!.pose);
    state = "run";
    hud();
    $("hud").hidden = false;
  });
  sound.setEngine(car.engine);
  if (!musicOn) { musicOn = true; sound.playMusic(); }
  $("unit").textContent = unit();
  const mode = MODES.find((m) => m.id === save.mode)!;
  banner(mode.id === "endless" ? LOCATIONS.find((l) => l.id === save.location)!.name : mode.name);
  $("modebox").hidden = mode.id !== "time" && mode.id !== "trap";
  hint(save.totals.runs < 3 ? "Arrows to drive. Pass close above 100 km/h for points; Space lights the nitro" : "");
}

function pause() {
  state = "paused";
  sound.suspend();
  card(`<h2>Paused</h2><div class="why">${run ? `${Math.round(run.score.points).toLocaleString("en-US")} points so far` : ""}</div>
    <div class="keys" style="margin-top:12px"><button data-key="enter"><kbd>enter</kbd> carry on</button><button data-key="q"><kbd>q</kbd> give up the run</button></div>`);
}
function resume() { state = "run"; $("card").hidden = true; sound.start(); last = performance.now(); }
function giveUp() { if (run) { crashInfo = null; results(); } }

let tallying = false, skipTally = () => {};

function results() {
  if (!run) return;
  state = "results";
  keepRun(); // a finished run is not carried over
  $("hud").hidden = true;
  const s = run.score;
  const res = finish(save, s, save.mode, save.location, today());
  persist();
  post(Math.round(s.points), res.record);
  const what = crashInfo ? names.get(crashInfo.kind) ?? "car" : "";
  const why = ended === "time" ? "Time's up" : ended === "slow" ? "Too slow for too long" : crashInfo
    ? crashInfo.oncoming ? `Head-on with ${article(what)} ${what} at ${Math.round(kmh(crashInfo.you))} ${unit()}` : `Into ${article(what)} ${what}: you at ${Math.round(kmh(crashInfo.you))}, it at ${Math.round(kmh(crashInfo.them))} ${unit()}`
    : "You pulled over";
  card(`<div class="result">
      <div class="left">
        <div class="headline"><h2>${Math.round(s.points).toLocaleString("en-US")} points</h2>${res.record && s.points > 0 ? `<span class="plate">New best for ${MODES.find((m) => m.id === save.mode)!.name}</span>` : ""}</div>
        <div class="why ${crashInfo ? "crash" : ""}">${why}</div>
        <dl id="tally"></dl>
      </div>
      <div class="right">
        <div class="driver"><b id="lvl">Level ${res.before.level}</b><span id="xpn"></span><i id="xpbar" style="--v:${res.before.xp / xpFor(res.before.level)}"></i><small id="lvlup"></small></div>
        <div class="missions">${res.missions.map((m) => `<div class="${m.done ? "done" : ""}"><span>${m.mission.text}</span><i style="--v:${m.progress}"></i><em>${m.done ? `Done: ${money(m.mission.reward.cash)} · ${m.mission.reward.xp} XP` : `${Math.round(m.progress * 100)}%`}</em></div>`).join("")}</div>
      </div>
    </div>
    <div class="keys"><button data-key="enter"><kbd>enter</kbd> drive again</button><button data-key="g"><kbd>g</kbd> garage</button></div>`);
  tally(res);
}

/** The run to its mode's board; once it answers, where it stands under the points (and, signed out after a best, the offer to keep it). */
function post(points: number, record: boolean) {
  if (scene || trial || points <= 0) return;
  pal.score(save.mode, points).then((r) => {
    if (state !== "results" || !r.rank || !r.total) return;
    const keep = !signedIn && record ? ` · <a class="signin">Sign in to keep your scores</a>` : "";
    document.querySelector(".result .headline")?.insertAdjacentHTML("beforeend", `<span class="standing">#${r.rank.toLocaleString("en-US")} of ${r.total.toLocaleString("en-US")}${keep}</span>`);
  }).catch((e: unknown) => console.error("highway: score", e));
}
document.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest(".signin")) void pal.signIn().catch(() => {}); });

/** Count the run's pay up line by line, then the XP bar fills, a level at a time. */
function tally(res: Result) {
  const dl = $("tally");
  // the multipliers in one row, and the levels gained in another, so the card fits a panel
  const mult = res.mults.reduce((a, m) => a * m.mult, 1);
  const lv = res.levels, lvCash = lv.reduce((a, l) => a + l.cash, 0);
  const rows: [string, string, number][] = [
    ...res.lines.map((l) => [l.label, money(l.amount), l.amount] as [string, string, number]),
    ...(res.mults.length ? [[res.mults.map((m) => m.label).join(", "), `×${+mult.toFixed(2)}`, 0] as [string, string, number]] : []),
    ...(res.missionCash ? [["Missions", money(res.missionCash), res.missionCash] as [string, string, number]] : []),
    ...(lv.length ? [[lv.length > 1 ? `Levels ${lv[0].level} to ${lv[lv.length - 1].level}` : `Level ${lv[0].level}`, money(lvCash), lvCash] as [string, string, number]] : []),
  ];
  const total = res.cash + res.missionCash + res.levels.reduce((a, l) => a + l.cash, 0);
  let i = 0, timer = 0;
  tallying = true;
  const xpAnim = () => {
    // the bar fills to the end of each level climbed, then to where it stops
    let lvl = res.before.level, x = res.before.xp, left = res.xp;
    const step = () => {
      const need = xpFor(lvl), take = Math.min(left, need - x);
      x += take; left -= take;
      ($("xpbar") as HTMLElement).style.setProperty("--v", String(x / need));
      $("xpn").textContent = `+${res.xp.toLocaleString("en-US")} XP`;
      if (x >= need && lvl < MAX_LEVEL) {
        lvl++; x = 0;
        const got = res.levels.find((l) => l.level === lvl);
        timer = window.setTimeout(() => {
          $("lvl").textContent = `Level ${lvl}`;
          $("lvlup").textContent = got?.unlocks.length ? `${got.unlocks.map((u) => u.name).join(", ")} ${got.unlocks.length > 1 ? "are" : "is"} open` : "";
          ($("xpbar") as HTMLElement).style.setProperty("--v", "0");
          sound.play("bell_ding", { gain: 0.6 });
          if (left > 0) timer = window.setTimeout(step, 260); else tallying = false;
        }, 420);
      } else tallying = false;
    };
    step();
  };
  const next = () => {
    if (i < rows.length) {
      const [label, value, amount] = rows[i++];
      dl.insertAdjacentHTML("beforeend", `<dt>${label}</dt><dd>${value}</dd>`);
      dl.scrollTop = dl.scrollHeight;
      if (amount) sound.play("coin", { gain: 0.35, rate: 0.9 + i * 0.04 });
      timer = window.setTimeout(next, 170);
    } else {
      dl.insertAdjacentHTML("beforeend", `<dt class="total">Earned</dt><dd class="total">${money(total)}</dd>`);
      dl.scrollTop = dl.scrollHeight;
      sound.play("cash", { gain: 0.6 });
      timer = window.setTimeout(xpAnim, 300);
    }
  };
  skipTally = () => {
    window.clearTimeout(timer);
    dl.innerHTML = rows.map(([l, v]) => `<dt>${l}</dt><dd>${v}</dd>`).join("") + `<dt class="total">Earned</dt><dd class="total">${money(total)}</dd>`;
    $("lvl").textContent = `Level ${res.after.level}`;
    ($("xpbar") as HTMLElement).style.setProperty("--v", String(res.after.level >= MAX_LEVEL ? 1 : res.after.xp / xpFor(res.after.level)));
    $("xpn").textContent = `+${res.xp.toLocaleString("en-US")} XP`;
    const opened = res.levels.flatMap((l) => l.unlocks);
    $("lvlup").textContent = opened.length ? `${opened.map((u) => u.name).join(", ")} ${opened.length > 1 ? "are" : "is"} open` : "";
    tallying = false;
  };
  timer = window.setTimeout(next, 450);
}

// ---------------------------------------------------------------- HUD bits

/** "a" or "an" before a car's name, by its sound: an LCT, an Asti, a Kiri. */
const article = (w: string) => (/^[A-Z]{2}/.test(w) ? /^[AEFHILMNORSX]/.test(w) : /^[aeiou]/i.test(w)) ? "an" : "a";
function card(html: string) { $("card").innerHTML = `<div class="sign">${html}</div>`; $("card").hidden = false; }
function pop(html: string, cls = "") {
  const el = document.createElement("div");
  el.className = `pop plate ${cls}`;
  el.innerHTML = html;
  $("pops").append(el);
  setTimeout(() => el.remove(), 1150);
  while ($("pops").children.length > 3) $("pops").firstElementChild!.remove();
}
function banner(text: string) {
  const el = document.createElement("div");
  el.className = "banner";
  el.textContent = text;
  $("hud").append(el);
  setTimeout(() => el.remove(), 950);
}
let hintTimer = 0;
function hint(text: string) {
  const h = $("hint");
  h.textContent = text;
  h.classList.toggle("gone", !text);
  window.clearTimeout(hintTimer);
  if (text) hintTimer = window.setTimeout(() => h.classList.add("gone"), 5000);
}
function veil(on: boolean, msg?: string) {
  if (msg) $("loadmsg").textContent = msg;
  $("loading").classList.toggle("gone", !on);
}

const rateOf = (k: number) => (k ** 3 * 1e-6 + (k >= 100 ? (k * k) / 3000 : 0)) * 25;
function hud() {
  if (!run) return;
  const s = run.score, v = run.veh, k = v.kmh / FEEL.pace;
  $("score").querySelector("b")!.textContent = Math.round(s.points).toLocaleString("en-US");
  $("rate").textContent = k >= 60 ? `+${Math.round(rateOf(k))} a second` : "Faster for points";
  $("speed").textContent = String(Math.round(kmh(k)));
  $("gear").textContent = v.shifting > 0 ? "·" : String(v.gear);
  ($("rpm") as HTMLElement).style.setProperty("--rpm", String(v.rpm / v.spec.redline));
  $("dist").textContent = `${(s.distance / 1000).toFixed(1)} km`;
  $("earn").textContent = s.misses ? `${s.misses} near miss${s.misses > 1 ? "es" : ""}` : "";
  const c = $("combo");
  c.hidden = !s.combo;
  if (s.combo) { c.querySelector("b")!.textContent = `Combo ×${s.combo}`; c.style.setProperty("--left", String(s.comboLeft / 4)); }
  // nitro: the bar, lit while it burns, and a nudge once it can be lit
  const d = run.drive, nb = $("nitro");
  nb.style.setProperty("--v", String(d.nitro));
  nb.classList.toggle("lit", d.boosting);
  nb.classList.toggle("ready", !d.boosting && d.nitro >= 0.25);
  // the mode's own clock or floor
  if (d.mode === "time") $("modebox").innerHTML = `<b class="${d.clock < 10 ? "low" : ""}">${d.clock.toFixed(1)}</b><span>${d.checkpoints ? `${d.checkpoints} checkpoint${d.checkpoints > 1 ? "s" : ""}` : "Next time at 2.5 km"}</span>`;
  if (d.mode === "trap") $("modebox").innerHTML = `<b class="${d.under > 0 ? "low" : ""}">${Math.round(kmh(d.floor))}</b><span>${d.under > 0 ? `Speed up: ${(3 - d.under).toFixed(1)} s` : `Stay above, ${unit()}`}</span>`;
  // a mission finished mid-run says so at once
  const st = statsOf(s, d.mode);
  for (const m of save.missions) if (!done.has(m) && progressOf(m, st) >= 1) { done.add(m); pop(`Mission done<small>${m.text}</small>`, "mission"); sound.play("ui_confirm", { gain: 0.6 }); }
}
const done = new Set<object>();

// ---------------------------------------------------------------- the loop

const STEP = 1 / 120;
let acc = 0, last = performance.now(), t = 0, lastGear = 1;
let drawn: State = "loading"; // the state the last frame was drawn in

/** The garage's car drives itself: the lane with the most room, steered smoothly into. */
let autoLane = 1;
/** The garage's driver, and a staged scene's (`bold`: it holds its speed, changes lanes sooner and never brakes; nothing touches in a scene). */
function autopilot(target = 108, bold = false): Input {
  const rn = run!, v = rn.veh, L = rn.layout;
  // seconds until it would reach the car ahead in a lane (Infinity when the lane is clear), or -1 when
  // a car is alongside in it, which rules that lane out
  const ttc = (l: number) => {
    let t = Infinity;
    for (const n of rn.traffic.cars) {
      if (n.oncoming || n.hit || (n.lane !== l && n.from !== l)) continue;
      const gap = n.z - v.z - (n.length + rn.player.size.z) / 2;
      if (gap < -6) continue;
      if (gap < 2 && l !== autoLane) return -1;
      t = Math.min(t, Math.max(0, gap) / Math.max(0.5, v.u - n.v));
    }
    return t;
  };
  const here = ttc(autoLane);
  if (here < (bold ? 4.5 : 3)) for (const l of [autoLane - 1, autoLane + 1]) if (l >= 0 && l < L.lanes && ttc(l) > Math.max(here, ttc(autoLane)) + 0.5) autoLane = l;
  // the key sets how fast the car crosses: a sideways speed that shrinks as the lane's centre comes
  // near, so it moves over decisively and settles instead of weaving
  const dx = laneX(L, autoLane) - v.x;
  const across = acrossAt(v.spec, v.u); // what full steering gives at this speed
  const steer = THREE.MathUtils.clamp(THREE.MathUtils.clamp(dx * 2.2, -9, 9) / across, -1, 1);
  const boxed = !bold && ttc(autoLane) < 1.3;
  return { throttle: !boxed && v.kmh / FEEL.pace < target ? 1 : 0, brake: boxed ? 1 : 0, steer };
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!run || state === "loading") return;
  if (state === "paused") { r.render(world.scene, { dim: 0.35 }); return; }
  if (slowmo > 0) { slowmo -= dt; dt *= 0.25; if (slowmo <= 0 && state === "over") results(); }
  t += dt;
  acc += dt;
  const inp = state === "garage" ? autopilot() : state === "run" || state === "over" ? (scene ? autopilot(scene.speed ?? 170, true) : input()) : { throttle: 0, brake: 0.2, steer: 0 };
  const t0 = performance.now();
  while (acc >= STEP) { run.step(STEP, inp); acc -= STEP; }
  const t1 = performance.now();
  run.draw(dt, acc / STEP);
  const v = run.veh, pose = run.pose;
  const t2 = performance.now();
  world.follow(pose.z);
  const t3 = performance.now();
  if (state === "garage") {
    // a car-advert orbit around your car as it drives
    const a = t * 0.1 + 2.4, d = 8.6;
    r.camera.position.set(pose.x + Math.sin(a) * d, 1.5 + Math.sin(t * 0.21) * 0.25, pose.z + Math.cos(a) * d);
    // aim to the car's left on screen, so it stands clear of the sign
    const right = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    r.camera.lookAt(new THREE.Vector3(pose.x, 0.75, pose.z).addScaledVector(right, -2.1));
    r.camera.fov = 38;
    r.camera.updateProjectionMatrix();
  } else chase.update(dt, pose, (world.lo + world.hi) / 2);
  sound.drive(v.rpm, v.shifting > 0 ? 0 : v.throttle, v.u, Math.max(v.slipFront, v.slipRear), v.spec.redline);
  sound.loop("scrape_metal", run.scraping > 0 ? 0.55 : 0);
  if (v.gear !== lastGear) { if (v.gear > lastGear && state === "run") sound.play("gear_change", { gain: 0.3 }); lastGear = v.gear; }
  if (state === "run") hud();
  flash = Math.max(0, flash - dt * 1.6);
  if (state !== drawn) { r.finish.cut = true; drawn = state; } // a new view: the blur must not smear the old one into it
  r.render(world.scene, { speed: state === "garage" ? 0 : Math.max(0, (v.u - 30) / 45), hit: flash, dim: state === "results" ? 0.3 : 0 });
  // ?perf: a frame over 20 ms says where its time went
  if (q.has("perf")) { const t4 = performance.now(); if (t4 - t0 > 20) console.warn(`slow frame, ${r.gl.info.programs?.length} shaders, ${(t4 - t0).toFixed(1)}ms: step ${(t1 - t0).toFixed(1)} draw ${(t2 - t1).toFixed(1)} world ${(t3 - t2).toFixed(1)} render ${(t4 - t3).toFixed(1)}`); }
}

// ---------------------------------------------------------------- boot

pal.onAction((id: string) => {
  if (id === "pause") { if (state === "run") pause(); else if (state === "paused") resume(); }
  if (id === "mute") onKey("m");
  if (id === "give-up" && (state === "run" || state === "paused")) giveUp();
  if (id === "start-over" && state !== "loading") startOver();
});
pal.onHidden(() => { if (state === "run") pause(); sound.suspend(); keepRun(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) keepRun(); });
addEventListener("pagehide", keepRun);

/** A fresh save, keeping the settings, and back to the garage. */
async function startOver() {
  if (trial || scene) return;
  const settings = save.settings;
  save = fresh();
  save.settings = settings;
  ended = null; crashInfo = null; done.clear();
  pal.storage.set("run", null).catch(() => undefined);
  await garage(); // it deals the missions and saves
  hint("Started over");
}

/** A run being driven is kept in storage while the page is hidden, so closing pal (which may drop the page) loses nothing. */
type Kept = Packed & { location: string; done: number[] };
function keepRun() {
  if (scene || trial) return;
  const live = run && (state === "run" || state === "paused") && !run.over;
  const kept: Kept | null = live ? { ...run!.drive.pack(), location: save.location, done: [...done].map((m) => save.missions.indexOf(m as never)) } : null;
  pal.storage.set("run", kept).catch((e: unknown) => console.error("highway: keep", e));
}
/** Back on the road where a kept run left off, paused. */
async function carryOn(k: Kept) {
  await drive(() => {
    run!.drive.unpack(k);
    run!.settle();
    for (const i of k.done) if (save.missions[i]) done.add(save.missions[i]);
  });
  hint("");
  pause();
}
pal.onShown(() => { if (state !== "paused") sound.start(); last = performance.now(); account(); });
// A save sync merged with another machine's: take it, so the next change writes onto it rather than over it.
pal.storage.onChange((k, v) => {
  if (k !== "save" || scene || trial) return;
  const vol = save.settings.sound;
  save = load(v);
  save.settings.sound = vol; // the volume is this machine's setting (pal's Volume)
  fillMissions(save);
  if (state === "garage") drawGarage();
});
pal.onSettings((s: Record<string, unknown>) => { if (typeof s.volume === "number") { save.settings.sound = s.volume / 100; sound.setVolume(muted ? 0 : save.settings.sound); } });

// `?dev`: the page's state on window.hw, so a headless check can look inside
if (q.has("dev")) Object.assign(window, { hw: { get run() { return run; }, get save() { return save; }, get state() { return state; }, get camera() { return r.camera; }, get world() { return world; }, r, THREE } });

/** Play a staged scene: set the place and car, then the garage, a run already going, or its end. */
async function stage(sc: Scene) {
  if (sc.location) save.location = sc.location;
  save.level = Math.max(save.level, 12); // a staged scene can show any place and mode
  if (sc.mode) save.mode = sc.mode;
  if (sc.car) {
    save.car = sc.car;
    save.owned[sc.car] ??= { upgrades: { ...NO_UP }, paint: sc.paint ?? carOf(sc.car).paint, paints: [] };
    if (sc.paint) save.owned[sc.car].paint = sc.paint;
  }
  browse = CARS.findIndex((c) => c.id === save.car);
  if (sc.show === "garage") return garage();
  await drive();
  // the run, played forward by the driver, then shown live
  run!.veh.launch(((sc.speed ?? 170) / 3.6) * 0.9 * FEEL.pace);
  run!.director.time = 50; // a minute in: busy, with the gaps a driver at speed threads
  run!.drive.ghost = true; // played forward and on while the picture is taken: no crash may end it
  for (let i = 0; i < (sc.warm ?? 6) * 120; i++) { run!.step(1 / 120, autopilot(sc.speed ?? 170, true)); if (i % 60 === 0) run!.draw(1 / 2); }
  run!.settle();
  chase.reset(run!.pose);
  if (sc.show === "results") { crashInfo = sc.crash ?? null; results(); }
}

(async () => {
  pal.ready(); // the loading sign is ours to show: reveal the page at once
  scene = ((await pal.storage.get("scene").catch(() => null)) as Scene | null) ?? null;
  save = load(await pal.storage.get("save").catch(() => null));
  account();
  let kept = scene ? null : ((await pal.storage.get("run").catch(() => null)) as Kept | null);
  if (kept && save.owned[kept.car] && modes(save).some((m) => m.id === kept!.mode) && places(save).some((l) => l.id === kept!.location)) {
    save.car = kept.car; save.mode = kept.mode; save.location = kept.location;
  } else kept = null;
  if (q.has("test")) {
    // a test drive: every car and place yours, a middling car by default, nothing written back
    trial = true;
    save.cash = 2_000_000;
    for (const c of CARS) save.owned[c.id] ??= { upgrades: { ...NO_UP }, paint: c.paint, paints: [c.paint] };
    save.level = Math.max(save.level, 25);
    const want = q.get("test");
    save.car = CARS.some((c) => c.id === want) ? want! : "thunderbolt-96";
  }
  const settings = (await pal.settings().catch(() => ({}))) as Record<string, unknown>;
  if (typeof settings.volume === "number") save.settings.sound = settings.volume / 100;
  sound.volume = save.settings.sound;
  names = new Map((await fetch("./cars/cars.json").then((x) => x.json())).map((c: { id: string; name: string }) => [c.id, c.name]));
  browse = CARS.findIndex((c) => c.id === save.car);
  fillMissions(save);
  const loc = LOCATIONS.find((l) => l.id === save.location)!;
  veil(true, `Driving to ${loc.name}`);
  await world.build(loc.sky, loc.asphalt, layoutOf(save.mode));
  builtFor = `${loc.id}/${save.mode}`;
  await preloadTraffic((f) => (($("loading").querySelector("em") as HTMLElement).style.width = `${Math.round(f * 100)}%`));
  chase.view = viewOf(save);
  frame(); // the loop runs behind the sign, so it lifts over a drawn road
  if (scene) await stage(scene);
  else if (kept) await carryOn(kept);
  else if (q.has("drive")) await drive();
  else await garage();
})();
