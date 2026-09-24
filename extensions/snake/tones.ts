// The buzzer's tones, as the firmware writes them: per sound, the notes
// [start, length (units after the sound's time), divider, volume register].
// The pitch is 13 MHz / divider (440 Hz, 587 Hz, 880 Hz and 2637 Hz land on
// A4, D5, A5 and E7); the lengths are the emulator's register writes.
import type { Sound } from "./phone.ts";

export type Note = [number, number, number, number];

export const TONES: Record<Sound["kind"], Note[]> = {
  /** Food or a bonus eaten: one short E7 click. */
  eat: [[0, 0.83, 4930, 6]],
  /** The death, at the re-check: three A4 pips. */
  die: [[0, 1.9, 29545, 3], [3.9, 2, 29545, 3], [7.9, 2, 29545, 3]],
  /** A new top score, with the fireworks and again with the text: D5 D5 D5 A5 D5 A5. */
  jingle: [[0, 17.8, 22147, 3], [35.9, 14.9, 22147, 3], [53.8, 15, 22147, 3], [71.8, 52, 14773, 3], [126.8, 15, 22147, 3], [144.8, 56, 14773, 3]],
};

export const hz = (divider: number) => 13e6 / divider;
