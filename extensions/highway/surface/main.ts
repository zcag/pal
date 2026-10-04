// Highway's page: the garage (your car driving the highway behind a sign you
// set it up on), the run, the pause and the end of a run. The extension's
// storage keeps the save; the panel hiding pauses the run.
import * as THREE from "./vendor/three.js";
import type { SurfaceKit } from "@zcag/pal";
import { Renderer } from "./render.ts";
import { World } from "./world.ts";
import { Run, preloadTraffic } from "./run.ts";
import { Chase, VIEWS } from "./camera.ts";
import { Car } from "./car.ts";
import { Sound } from "./audio.ts";
import { ONE_WAY, TWO_WAY, laneX } from "./road.ts";
import { CARS, LOCATIONS, MODES, PAINTS, PAINT_PRICE, UPGRADE_MAX, FEEL, upgradeCost, stats, type Upgrades } from "../game/content.ts";
import { load, fresh, carOf, buyCar, buyUpgrade, paint, buyLocation, finish, type Save, type Scene } from "../game/meta.ts";
import type { Miss } from "../game/score.ts";
import type { Input } from "../game/vehicle.ts";

declare const pal: SurfaceKit;
const $ = (id: string) => document.getElementById(id)!;
const q = new URLSearchParams(location.search);

const r = new Renderer($("view") as HTMLCanvasElement);
const world = new World(r.gl);
const chase = new Chase(r.camera);
const sound = new Sound();
let save: Save = fresh();
let run: Run | null = null;
let builtFor = "";
type State = "loading" | "garage" | "run" | "paused" | "over" | "results";
let state: State = "loading";
let names = new Map<string, string>(); // model id to its name, for the crash line

let scene: Scene | null = null;
let trial = false; // ?test: everything open, nothing saved
const persist = () => { if (!scene && !trial) pal.storage.set("save", save).catch((e: unknown) => console.error("highway: save", e)); };
const layoutOf = (mode: string) => (mode === "twoway" ? TWO_WAY : ONE_WAY);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const kmh = (v: number) => (save.settings.units === "mph" ? v * 0.6214 : v);
const unit = () => (save.settings.units === "mph" ? "mph" : "km/h");
const NO_UP: Upgrades = { speed: 0, handling: 0, brakes: 0 };

// ---------------------------------------------------------------- the road

/** Build the place (once per location and layout) and put a run on it. */
async function road(demo: boolean) {
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
  run = new Run(world, layout, player, car, owned?.upgrades ?? NO_UP, events, loc.density);
  if (demo) run.veh.launch((105 / 3.6) * FEEL.pace);
  run.settle();
  chase.reset(run.pose);
  veil(false);
}

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
};

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
  };
}

function onKey(k: string) {
  if (k === "m") { muted = !muted; sound.setVolume(muted ? 0 : save.settings.sound); return; }
  if (state === "garage") { garageKey(k); return; }
  if (state === "run") {
    if (k === "c") { chase.view = (chase.view + 1) % VIEWS.length; save.settings.camera = chase.view; persist(); hint(`${VIEWS[chase.view].name} view`); }
    if (k === "p" || k === "enter") pause();
    return;
  }
  if (state === "paused") {
    if (k === "p" || k === "enter") resume();
    if (k === "q") giveUp();
    return;
  }
  if (state === "results") {
    if (k === "enter" || k === " ") drive();
    if (k === "backspace" || k === "g") garage();
  }
}

// ---------------------------------------------------------------- garage

let row = 0;
let browse = 0; // the car shown, owned or not
const ROWS = ["car", "paint", "speed", "handling", "brakes", "mode", "place"] as const;

async function garage() {
  state = "garage";
  $("card").hidden = true;
  $("hud").hidden = true;
  browse = CARS.findIndex((c) => c.id === save.car);
  await road(true);
  sound.setEngine(CARS[browse].engine);
  drawGarage();
  $("garage").hidden = false;
}

const shownCar = () => CARS[browse];
const tag = (price: number) => `<em class="${save.cash >= price ? "can" : "no"}">${money(price)}</em>`;
const pips = (n: number) => Array.from({ length: UPGRADE_MAX }, (_, i) => `<i class="${i < n ? "f" : ""}"></i>`).join("");
let tint = ""; // a colour being looked at, not yet bought

function drawGarage() {
  const car = shownCar(), owned = save.owned[car.id], up = owned?.upgrades ?? NO_UP;
  const st = stats(car, up);
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
  const placeTag = save.locations.includes(loc.id) ? "" : tag(loc.price);
  const shown = tint || owned?.paint;
  const paintTag = owned && tint && !owned.paints.includes(tint) ? tag(PAINT_PRICE) : "";
  const swatches = PAINTS.map((c) => `<i style="background:${c}" class="${shown === c ? "on" : ""}"></i>`).join("");
  $("garage").innerHTML = `
    <div class="sign">
      <div class="head"><b>Highway</b><span>${money(save.cash)}</span></div>
      <div class="rows">
        <div class="row${sel("car")}"><span>Car</span><div class="val"><span class="arrows">${car.name}</span>${carTag}</div></div>
        <div class="bars">
          <span>Top speed</span><i style="--v:${st.speed.toFixed(1)}"></i>
          <span>Pickup</span><i style="--v:${st.accel.toFixed(1)}"></i>
          <span>Handling</span><i style="--v:${st.handling.toFixed(1)}"></i>
          <span>Brakes</span><i style="--v:${st.brakes.toFixed(1)}"></i>
        </div>
        <div class="row${sel("paint")}"><span>Paint</span><div class="val"><span class="swatches">${swatches}</span>${paintTag}</div></div>
        ${upRow("speed", "Engine")}
        ${upRow("handling", "Handling")}
        ${upRow("brakes", "Brakes")}
        <div class="row${sel("mode")}"><span>Mode</span><div class="val"><span class="arrows">${mode.name}</span></div></div>
        <div class="row${sel("place")}"><span>Place</span><div class="val"><span class="arrows">${loc.name}</span>${placeTag}</div></div>
      </div>
      <div class="drive">
        <div><div class="go">${owned ? "Drive" : "Buy it to drive"}</div><div class="best">${best ? `Best ${best.score.toLocaleString("en-US")} in ${(best.distance / 1000).toFixed(1)} km` : mode.about}</div></div>
        <div class="keys"><button data-key=" "><kbd>space</kbd> drive</button><br><button data-key="enter"><kbd>enter</kbd> buy</button></div>
      </div>
    </div>`;
}

async function garageKey(k: string) {
  const car = shownCar(), owned = save.owned[car.id];
  const what = ROWS[row];
  if (k === "arrowup" || k === "w" || k === "arrowdown" || k === "s") {
    if (tint && owned) { tint = ""; run?.player.setColor(owned.paint); }
    row = (row + (k === "arrowup" || k === "w" ? ROWS.length - 1 : 1)) % ROWS.length;
  } else if (k === " ") {
    if (!owned) { sound.play("ui_error", { gain: 0.5 }); return; }
    if (tint) { tint = ""; run?.player.setColor(owned.paint); }
    if (save.car !== car.id) { save.car = car.id; persist(); }
    if (!save.locations.includes(save.location)) { sound.play("ui_error", { gain: 0.5 }); hintGarage(); return; }
    drive();
    return;
  } else if (k === "arrowleft" || k === "arrowright" || k === "a" || k === "d") {
    const d = k === "arrowleft" || k === "a" ? -1 : 1;
    if (what === "car") { browse = (browse + d + CARS.length) % CARS.length; tint = ""; sound.play("ui_select", { gain: 0.5 }); await preview(); }
    else if (what === "paint" && owned) { const i = PAINTS.indexOf(tint || owned.paint); tint = PAINTS[(i + d + PAINTS.length) % PAINTS.length]; if (owned.paints.includes(tint)) { owned.paint = tint; tint = ""; persist(); } run?.player.setColor(tint || owned.paint); }
    else if (what === "mode") { const i = MODES.findIndex((m) => m.id === save.mode); save.mode = MODES[(i + d + MODES.length) % MODES.length].id; persist(); await road(true); }
    else if (what === "place") { const i = LOCATIONS.findIndex((l) => l.id === save.location); save.location = LOCATIONS[(i + d + LOCATIONS.length) % LOCATIONS.length].id; if (save.locations.includes(save.location)) persist(); await road(true); }
    else return;
  } else if (k === "enter") {
    let ok = false;
    if (what === "car") { ok = !owned && buyCar(save, car); if (owned) { save.car = car.id; ok = true; } }
    else if (what === "paint" && owned && tint) { ok = paint(save, car, tint); if (ok) tint = ""; }
    else if ((what === "speed" || what === "handling" || what === "brakes") && owned) { ok = buyUpgrade(save, car, what); if (ok && run) run.setPlayer(run.player, car, owned.upgrades); }
    else if (what === "place") ok = buyLocation(save, save.location);
    sound.play(ok ? "cash" : "ui_error", { gain: 0.6 });
    if (ok) persist();
  } else return;
  drawGarage();
}
function hintGarage() { const el = $("garage").querySelector(".best"); if (el) el.textContent = "Buy this place first, or pick one you own"; }

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
async function drive() {
  const car = carOf(save.car);
  browse = CARS.indexOf(car);
  $("garage").hidden = true;
  $("card").hidden = true;
  crashInfo = null;
  await road(false);
  chase.view = save.settings.camera;
  if (q.has("launch")) { run!.veh.launch((+q.get("launch")! / 3.6) * FEEL.pace); run!.settle(); } // ?launch=<km/h>: start a run at a speed, for trying the feel
  chase.reset(run!.pose);
  sound.setEngine(car.engine);
  if (!musicOn) { musicOn = true; sound.playMusic(); }
  state = "run";
  $("hud").hidden = false;
  $("unit").textContent = unit();
  banner(LOCATIONS.find((l) => l.id === save.location)!.name);
  hint(save.totals.runs < 3 ? "Arrows to drive. Pass close above 100 km/h for points" : "");
}

function pause() {
  state = "paused";
  sound.suspend();
  card(`<h2>Paused</h2><div class="why">${run ? `${Math.round(run.score.points).toLocaleString("en-US")} points so far` : ""}</div>
    <div class="keys" style="margin-top:12px"><button data-key="enter"><kbd>enter</kbd> carry on</button><button data-key="q"><kbd>q</kbd> give up the run</button></div>`);
}
function resume() { state = "run"; $("card").hidden = true; sound.start(); last = performance.now(); }
function giveUp() { if (run) { crashInfo = null; results(); } }

function results() {
  if (!run) return;
  state = "results";
  $("hud").hidden = true;
  const s = run.score, loc = LOCATIONS.find((l) => l.id === save.location)!;
  const cash = Math.round(s.cash() * loc.cash);
  const record = finish(save, save.mode, { score: Math.round(s.points), distance: s.distance, combo: s.bestCombo, topSpeed: s.topSpeed, misses: s.misses, cash });
  persist();
  const what = crashInfo ? names.get(crashInfo.kind) ?? "car" : "";
  const why = crashInfo
    ? crashInfo.oncoming ? `Head-on with a ${what} at ${Math.round(kmh(crashInfo.you))} ${unit()}` : `Into a ${what}: you at ${Math.round(kmh(crashInfo.you))}, it at ${Math.round(kmh(crashInfo.them))} ${unit()}`
    : "You pulled over";
  card(`<h2>${Math.round(s.points).toLocaleString("en-US")} points</h2>
    <div class="why ${crashInfo ? "crash" : ""}">${why}</div>
    ${record && s.points > 0 ? `<div class="record"><span class="plate">New best for ${MODES.find((m) => m.id === save.mode)!.name}</span></div>` : ""}
    <dl>
      <dt>Distance</dt><dd>${(s.distance / 1000).toFixed(2)} km</dd>
      <dt>Near misses</dt><dd>${s.misses}</dd>
      <dt>Best combo</dt><dd>×${s.bestCombo}</dd>
      <dt>Top speed</dt><dd>${Math.round(kmh(s.topSpeed))} ${unit()}</dd>
      <dt class="total">Earned</dt><dd class="total">${money(cash)}</dd>
    </dl>
    <div class="keys"><button data-key="enter"><kbd>enter</kbd> drive again</button><button data-key="g"><kbd>g</kbd> garage</button></div>`);
  sound.play("cash", { gain: 0.6 });
}

// ---------------------------------------------------------------- HUD bits

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
}

// ---------------------------------------------------------------- the loop

const STEP = 1 / 120;
let acc = 0, last = performance.now(), t = 0, lastGear = 1;

/** The garage's car drives itself: the lane with the most room, steered smoothly into. */
let autoLane = 1;
function autopilot(target = 108): Input {
  const rn = run!, v = rn.veh, L = rn.layout;
  const room = (l: number) => Math.min(400, ...rn.traffic.cars.filter((n) => !n.oncoming && (n.lane === l || n.from === l) && n.z > v.z - 6).map((n) => n.z - v.z));
  if (room(autoLane) < 70) for (const l of [autoLane - 1, autoLane + 1]) if (l >= 0 && l < L.lanes && room(l) > room(autoLane) + 10) autoLane = l;
  // the key sets how fast the car crosses: ask for a gentle sideways speed that shrinks as the lane's
  // centre comes near, so it eases in and settles instead of weaving
  const dx = laneX(L, autoLane) - v.x;
  const across = 5.5 * FEEL.pace + 0.07 * v.u; // what full steering gives at this speed (game/vehicle.ts)
  const steer = THREE.MathUtils.clamp(THREE.MathUtils.clamp(dx * 1.4, -4, 4) / across, -1, 1);
  return { throttle: v.kmh / FEEL.pace < target && room(autoLane) > 40 ? (target > 120 ? 1 : 0.6) : 0, brake: room(autoLane) < 25 ? 0.5 : 0, steer };
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
  const inp = state === "garage" ? autopilot() : state === "run" || state === "over" ? (scene ? autopilot(scene.speed ?? 170) : input()) : { throttle: 0, brake: 0.2, steer: 0 };
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
  r.render(world.scene, { speed: state === "garage" ? 0 : Math.max(0, (v.u - 30) / 45), hit: flash, dim: state === "results" ? 0.3 : 0 });
  // ?perf: a frame over 20 ms says where its time went
  if (q.has("perf")) { const t4 = performance.now(); if (t4 - t0 > 20) console.warn(`slow frame, ${r.gl.info.programs?.length} shaders, ${(t4 - t0).toFixed(1)}ms: step ${(t1 - t0).toFixed(1)} draw ${(t2 - t1).toFixed(1)} world ${(t3 - t2).toFixed(1)} render ${(t4 - t3).toFixed(1)}`); }
}

// ---------------------------------------------------------------- boot

pal.onAction((id: string) => {
  if (id === "pause") { if (state === "run") pause(); else if (state === "paused") resume(); }
  if (id === "mute") onKey("m");
  if (id === "give-up" && (state === "run" || state === "paused")) giveUp();
});
pal.onHidden(() => { if (state === "run") pause(); sound.suspend(); });
pal.onShown(() => { if (state !== "paused") sound.start(); last = performance.now(); });
pal.onSettings((s: Record<string, unknown>) => { if (typeof s.volume === "number") { save.settings.sound = s.volume / 100; sound.setVolume(muted ? 0 : save.settings.sound); } });

/** Play a staged scene: set the place and car, then the garage, a run already going, or its end. */
async function stage(sc: Scene) {
  if (sc.location) { save.location = sc.location; if (!save.locations.includes(sc.location)) save.locations.push(sc.location); }
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
  run!.director.time = 160; // a few minutes in: the traffic is up to strength
  for (let i = 0; i < (sc.warm ?? 6) * 120; i++) { run!.step(1 / 120, autopilot(sc.speed ?? 170)); if (i % 60 === 0) run!.draw(1 / 2); }
  run!.settle();
  chase.reset(run!.pose);
  if (sc.show === "results") { crashInfo = sc.crash ?? null; results(); }
}

(async () => {
  pal.ready(); // the loading sign is ours to show: reveal the page at once
  scene = ((await pal.storage.get("scene").catch(() => null)) as Scene | null) ?? null;
  save = load(await pal.storage.get("save").catch(() => null));
  if (q.has("test")) {
    // a test drive: every car and place yours, a middling car by default, nothing written back
    trial = true;
    save.cash = 2_000_000;
    for (const c of CARS) save.owned[c.id] ??= { upgrades: { ...NO_UP }, paint: c.paint, paints: [c.paint] };
    save.locations = LOCATIONS.map((l) => l.id);
    const want = q.get("test");
    save.car = CARS.some((c) => c.id === want) ? want! : "thunderbolt-96";
  }
  const settings = (await pal.settings().catch(() => ({}))) as Record<string, unknown>;
  if (typeof settings.volume === "number") save.settings.sound = settings.volume / 100;
  sound.volume = save.settings.sound;
  names = new Map((await fetch("./cars/cars.json").then((x) => x.json())).map((c: { id: string; name: string }) => [c.id, c.name]));
  browse = CARS.findIndex((c) => c.id === save.car);
  const loc = LOCATIONS.find((l) => l.id === save.location)!;
  veil(true, `Driving to ${loc.name}`);
  await world.build(loc.sky, loc.asphalt, layoutOf(save.mode));
  builtFor = `${loc.id}/${save.mode}`;
  await preloadTraffic(world, (sc) => r.warm(sc), (f) => (($("loading").querySelector("em") as HTMLElement).style.width = `${Math.round(f * 100)}%`));
  chase.view = save.settings.camera;
  if (scene) await stage(scene);
  else if (q.has("drive")) await drive();
  else await garage();
  frame();
})();
