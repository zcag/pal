// Replays a run recorded from the real Nokia 3310 firmware (v6.07, in the
// DCT3 emulator; snake-emulator.fixture.json) through the extension's phone
// and compares, frame for frame, what the screen showed, then the buzzer's
// tones and the backlight's switches.
//
// The emulator's own clock jitters by about one unit (its OS ticks are 7.56
// ms against the game's 7.745), so each key is pressed as long after the
// model's matching frame as it was after the emulator's frame before it: the
// frames are compared in order, and each frame's gap from the one before is
// compared in time. Where Snake II was left (C on its menu, a digit: the
// phone's Games list or dialer), the emulator's frames up to Snake II coming
// back are the phone's own and are skipped; Menu there picks Snake II again.
import { frame } from "../../../extensions/snake/lcd.ts";
import type { Key } from "../../../extensions/snake/game.ts";
import { REPEAT_EVERY, REPEAT_FIRST, advance, boot, enter, gone, press, repeats, type Phone } from "../../../extensions/snake/phone.ts";

export type Run = { keys: [number, Key, number][]; ft: number[]; frames: string; buzz: number[][]; light: number[][] };
export type Result = {
  /** Frames compared, and the index of the first that differs (-1: none). */
  frames: number;
  mismatch: number;
  /** The model left Snake II (after the frames compared), and the emulator showed its own screen then. */
  left?: [number, number];
  /** The largest difference in the time from one frame to the next. */
  gap: number;
  /** The sounds, as kinds in order on both, and the largest time apart. */
  sounds: { model: string[]; emu: string[]; dt: number };
  light: { model: number[]; emu: number[]; dt: number };
  /** On a mismatch, both frames as text. */
  diff?: string;
};

const TICK = 0.25;
const GONE = new Uint8Array(84 * 48).fill(2);
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

export function emuFrames(run: Run): Uint8Array[] {
  const blob = Bun.gunzipSync(Buffer.from(run.frames, "base64"));
  return run.ft.map((_, i) => {
    const f = new Uint8Array(84 * 48);
    for (let p = 0; p < f.length; p++) f[p] = (blob[i * 504 + (p >> 3)] >> (7 - (p & 7))) & 1;
    return f;
  });
}

/** What can change the screen, so a frame is drawn only when it may differ (animated screens every tick). */
function sig(ph: Phone): string {
  const s = ph.screen, g = ph.game, held = ph.hold && ph.t < ph.hold.until ? ph.hold.screen : null;
  const animated = [s, held].some((x) => x && "at" in x && x.id !== "over");
  return JSON.stringify([s, ph.list, held, animated ? ph.t : 0,
    g && [g.snake.length, g.snake[0].c, g.snake[g.snake.length - 1].c, g.food, g.bonus, g.score]]);
}

export function replay(run: Run): Result {
  const emu = emuFrames(run);
  const ft = run.ft.slice();
  const ph = boot(ft[0]);
  ph.lightGrid = 5; // the emulator's backlight checks fall 5 units after the key that picked Snake II
  const model: [number, Uint8Array][] = [];
  const lights: [number, number][] = [];
  let t = ft[0], last = "";
  const tick = () => {
    advance(ph, t);
    const on = ph.light ? 1 : 0;
    if (!lights.length || lights[lights.length - 1][1] !== on) lights.push([t, on]);
    const s = gone(ph) ? "gone" : sig(ph);
    if (s !== last) {
      last = s;
      const f = gone(ph) ? GONE : frame(ph);
      if (!model.length || !eq(model[model.length - 1][1], f)) model.push([t, f]);
    }
    t += TICK;
  };
  // A held key's repeats, as the page makes them.
  const keys: [number, Key, boolean][] = [];
  for (const [tk, k, hold] of run.keys) {
    keys.push([tk, k, false]);
    for (let r = tk + REPEAT_FIRST; r < tk + hold; r += REPEAT_EVERY) keys.push([r, k, true]);
  }
  keys.sort((a, b) => a[0] - b[0]);
  let shift = 0; // the model's frame index less the emulator's, changed where Snake II was left and entered again
  for (const [tk, k, rep] of keys) {
    if (rep && !repeats(ph, k)) continue;
    const j = ft.findLastIndex((x) => x <= tk) + shift;
    while (model.length <= j && t < tk + 200) tick();
    const at = model.length > j ? Math.max(model[j][0] + (tk - ft[j]), t - TICK) : tk;
    while (t <= at) tick();
    if (ph.screen.id === "gone") {
      if (k !== "menu") continue;
      while (t <= tk + 13.3) tick();
      enter(ph, t);
      shift = model.length - ft.findIndex((x) => x > tk);
      continue;
    }
    press(ph, k, at);
  }
  const end = t + (ft[ft.length - 1] - (model[model.length - 1]?.[0] ?? 0)) + 50;
  while (t < end && !gone(ph)) tick();
  if (gone(ph)) tick();

  // The phone's own screens where the model had left.
  for (let i = 0; i < model.length - 1; i++) {
    if (model[i][1] !== GONE) continue;
    let j = i;
    while (j < emu.length && !eq(emu[j], model[i + 1][1])) j++;
    if (j >= emu.length) break;
    emu.splice(i, j - i, GONE);
    ft.splice(i, j - i, model[i][0]);
  }
  const n = Math.min(model.length, emu.length);
  const res: Result = { frames: 0, mismatch: -1, gap: 0, sounds: { model: [], emu: [], dt: 0 }, light: { model: [], emu: [], dt: 0 } };
  for (let i = 0; i < n; i++) {
    if (model[i][1] === GONE && i === model.length - 1) { res.left = [model[i][0], ft[i]]; break; }
    if (!eq(model[i][1], emu[i])) {
      res.mismatch = i;
      const text = (f: Uint8Array) => Array.from({ length: 48 }, (_, y) => Array.from(f.subarray(y * 84, y * 84 + 84), (v) => (v ? "#" : ".")).join(""));
      const a = text(model[i][1]), b = text(emu[i]);
      res.diff = `frame ${i}, model at ${model[i][0]}, emulator at ${ft[i]}\n` + a.map((r, y) => `${r}  ${b[y]}${r !== b[y] ? " <" : ""}`).join("\n");
      break;
    }
    res.frames = i + 1;
    if (i > 0 && model[i - 1][1] !== GONE && emu[i - 1] !== GONE) res.gap = Math.max(res.gap, Math.abs(model[i][0] - model[i - 1][0] - (ft[i] - ft[i - 1])));
  }
  const upTo = model[Math.max(0, res.frames - 1)]?.[0] ?? 0, emuUpTo = ft[Math.max(0, res.frames - 1)] + 5;
  const toEmu = (tm: number) => {
    const i = model.findLastIndex((m, j) => j < res.frames && m[0] <= tm);
    return i < 0 ? tm : ft[i] + (tm - model[i][0]);
  };

  // The buzzer: 4930 the eat click, 29545 the death's pips, 22147 and 14773 the jingle.
  const emuSounds: [number, string][] = [];
  let on = false;
  for (const [bt, o, div] of run.buzz) {
    const sounding = o === 1 && div > 0;
    if (sounding && !on && bt <= emuUpTo) {
      const kind = div === 4930 ? "eat" : div === 29545 ? "die" : "jingle";
      const prev = emuSounds[emuSounds.length - 1];
      if (!(prev && prev[1] === kind && kind !== "eat" && bt - prev[0] < (kind === "die" ? 10 : 160))) emuSounds.push([bt, kind]);
    }
    on = sounding;
  }
  const modelSounds = ph.sounds.filter((s) => s.t <= upTo).map((s) => [toEmu(s.t), s.kind] as [number, string]);
  res.sounds = { model: modelSounds.map((s) => s[1]), emu: emuSounds.map((s) => s[1]), dt: 0 };
  if (modelSounds.length === emuSounds.length) res.sounds.dt = Math.max(0, ...modelSounds.map((s, i) => Math.abs(s[0] - emuSounds[i][0])));

  const ml = lights.slice(1).filter((l) => l[0] <= upTo).map((l) => [toEmu(l[0]), l[1]]);
  const el = run.light.filter((l) => l[0] <= emuUpTo);
  res.light = { model: ml.map((l) => l[1]), emu: el.map((l) => l[1]), dt: 0 };
  if (ml.length === el.length) res.light.dt = Math.max(0, ...ml.map((l, i) => Math.abs(l[0] - el[i][0])));
  return res;
}
