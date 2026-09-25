// Snake II's page (the view's `surface`): the phone's screen and keypad.
// The rules and the screens are phone.ts and game.ts, the pixels lcd.ts, the
// same files the host tests replay against the emulator; this page only
// keeps the clock, turns keys into the phone's keys, paints the 84 by 48
// pixels and plays the buzzer.
//
// The clock is the phone's unit, 8 ms: a fixed 8 ms loop runs the phone to
// performance.now() (so nothing drifts), requestAnimationFrame only paints. A
// key acts the moment it goes down, at its own time; the phone's keypad scan
// and redraw delays are in phone.ts. The browser's key repeat is dropped: a
// held scroll key repeats as the phone repeats it (REPEAT_FIRST, then
// REPEAT_EVERY).
//
// The phone's memory (the level, the maze, the top score, a paused game,
// rand()'s state) is in the extension's storage. rand() starts again from 1
// only at a power-on: the first time the page asks the extension since pal
// started (a plain browser tab counts every load as one).
import type { SurfaceKit } from "@zcag/pal";
import type { Key } from "../game.ts";
import { LCD_H, LCD_W, frame } from "../lcd.ts";
import { REPEAT_EVERY, REPEAT_FIRST, advance, boot, enter, gone, isMemory, memory, press, repeats, type Phone } from "../phone.ts";
import { TONES, hz } from "../tones.ts";

declare const pal: SurfaceKit;

/** Milliseconds per game unit on a real phone. */
const U = 8;
const now = () => performance.now() / U;
const KEY = "phone";

const canvas = document.querySelector("#lcd") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const image = ctx.createImageData(LCD_W, LCD_H);

let ph: Phone;
let tones = true;

// ---- the LCD -----------------------------------------------------------------------------------------------

/** The panel lit by its green backlight, and unlit (in play the phone keeps it off). Colours from a photo of a 3310 (no calibrated source). */
const LIT = { bg: [168, 201, 104], px: [30, 44, 12] };
const UNLIT = { bg: [121, 143, 80], px: [26, 36, 10] };

let painted = "";
function paint() {
  const px = frame(ph);
  const c = ph.light ? LIT : UNLIT;
  const sig = `${ph.light}${px.join("")}`;
  if (sig === painted) return;
  painted = sig;
  for (let i = 0; i < px.length; i++) {
    const [r, g, b] = px[i] ? c.px : c.bg;
    image.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(image, 0, 0);
}

/** Whole multiples: as large as the page allows with pixels 7 down for 6 across (the panel's about 1.2). */
function fit() {
  const hints = (document.querySelector("#hints") as HTMLElement).offsetHeight;
  const w = innerWidth - 48, h = innerHeight - hints - 44;
  let sx = 1;
  while (LCD_W * (sx + 1) <= w && LCD_H * Math.round((sx + 1) * 1.2) <= h) sx++;
  canvas.style.width = `${LCD_W * sx}px`;
  canvas.style.height = `${LCD_H * Math.round(sx * 1.2)}px`;
}
addEventListener("resize", fit);

// ---- the buzzer ------------------------------------------------------------------------------------------------

let audio: AudioContext | undefined;
/** Square waves as the piezo is driven; the volume register taken as loudness in steps (not measured). */
function sound(t: number, kind: keyof typeof TONES) {
  if (!tones || !audio) return;
  const start = audio.currentTime + Math.max(0, (t - now()) * U) / 1000;
  for (const [at, len, div, vol] of TONES[kind]) {
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = hz(div);
    gain.gain.value = 0.05 * vol / 6;
    osc.connect(gain).connect(audio.destination);
    osc.start(start + (at * U) / 1000);
    osc.stop(start + ((at + len) * U) / 1000);
  }
}

// ---- keys ------------------------------------------------------------------------------------------------------

const PLAYING = new Set(["play", "frozen", "dying"]);
/** A keyboard key as the phone's: the arrows are 2 4 6 8 in play and the scroll keys elsewhere, Enter the left soft key, Backspace C. */
function keyOf(e: KeyboardEvent): Key | undefined {
  const inPlay = PLAYING.has(ph.screen.id);
  switch (e.key) {
    case "ArrowUp": return inPlay ? "2" : "up";
    case "ArrowDown": return inPlay ? "8" : "down";
    case "ArrowLeft": return inPlay ? "4" : undefined;
    case "ArrowRight": return inPlay ? "6" : undefined;
    case "PageUp": return "up";
    case "PageDown": return "down";
    case "Enter": return "menu";
    case "Backspace": return "c";
    case "*": case "#": return e.key;
  }
  return /^[0-9]$/.test(e.key) ? (e.key as Key) : undefined;
}

/** Keys held down, each with when the phone repeats it next. */
const held = new Map<string, { k: Key; next: number }>();
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || !ph) return;
  const k = keyOf(e);
  if (!k) return;
  e.preventDefault();
  if (e.repeat) return;
  audio ??= new AudioContext();
  const t = now();
  press(ph, k, t);
  held.set(e.code, { k, next: t + REPEAT_FIRST });
});
document.addEventListener("keyup", (e) => held.delete(e.code));
addEventListener("blur", () => held.clear());

// ---- the clock -------------------------------------------------------------------------------------------------

let leaving = false;
function run() {
  const t = now();
  for (const h of held.values()) {
    for (; h.next <= t; h.next += REPEAT_EVERY) if (repeats(ph, h.k)) press(ph, h.k, h.next);
  }
  advance(ph, t);
  for (const s of ph.sounds.splice(0)) sound(s.t, s.kind);
  save();
  title();
  if (gone(ph) && !leaving) leave();
}

/**
 * EXTRA, not the firmware: Snake II left (C on its menu, or a digit: the phone's dialer), the view closes, as Escape
 * does, where the phone would show its Games list or the dialer; opening it again enters Snake II.
 */
function leave() {
  leaving = true;
  held.clear();
  dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }));
  setTimeout(() => {
    leaving = false;
    if (gone(ph)) enter(ph, now());
  }, 600);
}

let stored = "";
function save() {
  const m = JSON.stringify(memory(ph));
  if (m === stored) return;
  stored = m;
  pal.storage.set(KEY, memory(ph)).catch((e) => console.error(`snake: save: ${e}`));
}

// ---- the panel -------------------------------------------------------------------------------------------------

/** EXTRA, not the firmware: the top score in the panel's title line, so it reads without the phone's Top score screen. */
let shown = -1;
function title() {
  if (ph.best === shown) return;
  shown = ph.best;
  pal.title(`Top score ${ph.best}`);
}

/** EXTRA, not the firmware: the panel hidden or the view left pauses the game as C does in play (Continue waits in the menu). */
pal.onHidden(() => {
  held.clear();
  if (!ph) return;
  const t = now();
  advance(ph, t);
  if (ph.screen.id === "play" || ph.screen.id === "dying") {
    press(ph, "c", t);
    advance(ph, t + 12);
  }
  save();
});

pal.onAction((id) => {
  if (id === "tones") pal.send({ tones: !tones }).catch(() => {});
});
pal.onSettings((s) => { tones = s.tones !== false; if (ph) ph.queue = s.queue_turns !== false; });

async function start() {
  const [saved, reply, s] = await Promise.all([
    pal.storage.get(KEY).catch(() => undefined),
    pal.send({ boot: true }).catch(() => undefined) as Promise<{ powerOn?: boolean } | undefined>,
    pal.settings().catch(() => ({}) as Record<string, unknown>),
  ]);
  tones = s.tones !== false;
  const mem = isMemory(saved) ? saved : undefined;
  const powerOn = reply?.powerOn ?? true;
  ph = boot(now(), mem ? { ...mem, seed: powerOn ? 1 : mem.seed } : {});
  ph.queue = s.queue_turns !== false; // EXTRA, not the firmware (game.ts `steer`)
  stored = JSON.stringify(memory(ph));
  fit();
  paint();
  title();
  pal.ready();
  setInterval(run, U);
  const draw = () => { paint(); requestAnimationFrame(draw); };
  requestAnimationFrame(draw);
}
void start();
