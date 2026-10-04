// The six songs, one per stage, as patterns the sequencer in music.ts reads a
// sixteenth at a time and arranges by its stage's form (content.ts): an intro
// that states the hook on a bell, builds that roll into drops where the hook
// comes in full, breaks that breathe. Pitches are written as degrees of the
// natural minor scale (0 the tonic, 7 its octave, negative below, `#`/`b` a
// semitone off it) and stored as semitones from the tonic. The tempo is the
// stage's (content.ts), so the walls and the music never disagree on it.
// Notation, one character (or, for lines, one token) per sixteenth:
//   drums  x hit, o open hat, g ghost (soft), . rest
//   bass   r chord root, 5 its fifth, o its octave, - hold, . rest
//   arp    0..7 the chord's voicing (4..7 an octave up), . rest
//   lines  a degree, - hold, . rest; two bars a phrase, four phrases a hook
import type { StageId } from "../game/content.ts";

export type Line = (number | "-" | ".")[];
/** A bar's chord: the bass's root, and the pad's voicing (semitones from the tonic, in `padOct`). */
export type Chord = { root: number; tones: number[] };

export type Song = {
  id: StageId;
  /** The key's pitch class (0 = C). */
  key: number;
  /** Eight bars, a chord a bar, under the hook's eight (a break walks them half time); a build's last bar takes the eighth, the turn home. */
  prog: Chord[]; padOct: number;
  kick: string; snare: string; hats: string; ride: string;
  /** Kick pitch (Hz), how hard it hits the saturator, how long it booms. */
  kickTone: number; kickDrive: number; kickTail: number;
  snareTone: number;
  /** A clap (layered bursts) on the backbeat, or a plain snare. */
  clap: boolean;
  bass: string; bassOct: number; bassWave: OscillatorType; bassCut: number; bassQ: number;
  /** Saws in the bass and their spread (cents): two close ones, or three wide for a reese. */
  bassVoices: number; bassSpread: number;
  /** The drop's wobble, cycles a beat of the bass filter, one a bar (none: a plucked bass). */
  wobble?: number[];
  arp: string; arpOct: number; arpWave: OscillatorType;
  hook: Line[]; leadOct: number; leadWave: OscillatorType; leadCut: number;
  /** Saws in the lead at a drop, and their spread (cents). */
  leadVoices: number; leadSpread: number;
  /** Portamento between tied notes, seconds (0: none). */
  glide: number;
  /** Chord stabs in a full drop. */
  stab?: string;
  /** How far the kick ducks the rest in a drop (gain at the hit). */
  pump: number;
};

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const semi = (tok: string) => {
  const m = /^(-?\d+)([#b]?)$/.exec(tok);
  if (!m) throw new Error(`songs: bad pitch ${tok}`);
  const d = Number(m[1]);
  return 12 * Math.floor(d / 7) + MINOR[((d % 7) + 7) % 7] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
};
const lines = (...ps: string[]): Line[] => ps.map((p) => {
  const l = p.replace(/\|/g, " ").trim().split(/\s+/).map((t) => (t === "-" || t === "." ? t : semi(t)));
  if (l.length !== 32) throw new Error(`songs: a phrase of ${l.length} sixteenths: ${p}`);
  return l;
});
/** "root: voicing" a bar, separated by commas. */
const prog = (spec: string): Chord[] => spec.split(",").map((c) => {
  const [r, v] = c.split(":");
  return { root: semi(r.trim()), tones: v.trim().split(/\s+/).map(semi) };
});

export const freq = (s: Song, semis: number, octave: number) => 440 * Math.pow(2, (12 * (octave + 1) + s.key + semis - 69) / 12);
/** The note `steps` scale degrees from `semis` (−2: a third under), for harmonies; an off-scale note moves by a minor third. */
export const diatonic = (semis: number, steps: number) => {
  const o = Math.floor(semis / 12), d = MINOR.indexOf(semis - 12 * o);
  if (d < 0) return semis + Math.sign(steps) * 3;
  const k = d + steps;
  return 12 * (o + Math.floor(k / 7)) + MINOR[((k % 7) + 7) % 7];
};
/** A chord's tone `k` of its voicing, octaves up past its end (the arp's notation). */
export const tone = (c: Chord, k: number) => c.tones[k % c.tones.length] + 12 * Math.floor(k / c.tones.length);

export const SONGS: Record<StageId, Song> = {
  // A minor, uplifting trance: Am9 Fmaj7 Cmaj7 G6, then Am9 Fmaj7 G E7 to turn home; an offbeat bass,
  // a hook in three-three-two that calls high and answers low.
  pulse: {
    id: "pulse", key: 9,
    prog: prog("0: 0 2 4 8, -2: -2 0 2 4, 2: -1 2 4 8, -1: -1 1 3 4, 0: 0 2 4 8, -2: -2 0 2 4, -1: -1 1 3 7, -3: -3 -1# 1 3"), padOct: 3,
    kick: "x...x...x...x...", snare: "....x.......x...", hats: "g.o.g.o.g.o.g.og", ride: "x.x.x.x.x.x.x.x.",
    kickTone: 48, kickDrive: 1, kickTail: 0.055, snareTone: 180, clap: true,
    bass: "..r-..r-..r-..o-", bassOct: 2, bassWave: "sawtooth", bassCut: 1500, bassQ: 4, bassVoices: 2, bassSpread: 9,
    arp: "0123432101234565", arpOct: 4, arpWave: "sawtooth",
    hook: lines(
      "7 - - 4 - - 7 - 8 - 9 - 8 - 7 - | 9 - - 7 - - 5 - 4 - - - 2 - 4 -",
      "4 - - 2 - - 4 - 6 - 7 - 6 - 4 - | 3 - - - - - 1 - 3 - - - 4 - - -",
      "7 - - 4 - - 7 - 8 - 9 - 8 - 7 - | 9 - - 7 - - 9 - 11 - - - 10 - 9 -",
      "8 - - 6 - - 8 - 10 - - - 8 - - - | 8 - - - - - - - 6# - - - - - - -",
    ),
    leadOct: 4, leadWave: "sawtooth", leadCut: 3800, leadVoices: 5, leadSpread: 24, glide: 0,
    pump: 0.28,
  },
  // D minor, dark electro: Dm7 B♭maj7 Gm7 A7, then C9sus4 to A7; a rolling sixteenth bass with a squelchy
  // filter, stabs, a riff that leans on the A7's C♯.
  drift: {
    id: "drift", key: 2,
    prog: prog("0: 2 4 6 7, 5: 2 4 5 7, 3: 2 3 5 7, 4: 1 3 4 6#, 0: 2 4 7 8, 5: 2 4 5 7, 6: 3 5 6 7, 4: 1 3 4 6#"), padOct: 3,
    kick: "x...x...x...x...", snare: "....x.......x.g.", hats: "xgogxgogxgogxgox", ride: "..x...x...x...x.",
    kickTone: 46, kickDrive: 1.15, kickTail: 0.05, snareTone: 200, clap: true,
    bass: ".rrr.rrr.rrr.ror", bassOct: 2, bassWave: "sawtooth", bassCut: 1000, bassQ: 9, bassVoices: 2, bassSpread: 7,
    arp: "0.2.1.3.2.4.3.5.", arpOct: 4, arpWave: "sawtooth",
    hook: lines(
      "7 - - 4 - - 7 - 6 - 4 - 2 - 4 - | 5 - - - - - 4 - 2 - - - 1 - 2 -",
      "3 - - 5 - - 7 - 8 - 9 - 8 - 7 - | 6# - - - - - 8 - 7 - - - 6# - - -",
      "7 - - 4 - - 7 - 6 - 4 - 2 - 4 - | 9 - - - - - 7 - 9 - 11 - 12 - 11 -",
      "10 - - 9 - - 7 - 5 - - - 7 - 9 - | 8 - - - 6# - - - 4 - - - - - - -",
    ),
    leadOct: 4, leadWave: "sawtooth", leadCut: 2800, leadVoices: 3, leadSpread: 14, glide: 0.035,
    stab: "x..x..x...x..x..",
    pump: 0.32,
  },
  // F♯ minor, bright chiptune: Dmaj7 Eadd9 F♯m9 C♯m7, then F♯m to C♯7; a square bass bouncing octaves,
  // a quick square arp, a square lead that runs in sixteenths.
  prism: {
    id: "prism", key: 6,
    prog: prog("-2: -2 0 2 4, -1: -1 1 3 7, 0: 0 2 4 8, -3: -3 -1 1 3, -2: -2 0 2 4, -1: -1 1 3 7, 0: 0 2 4 7, -3: -3 -1# 1 3"), padOct: 3,
    kick: "x...x...x...x...", snare: "....x.......x...", hats: "x.xgx.xgx.xgx.xg", ride: "..o...o...o...o.",
    kickTone: 52, kickDrive: 0.9, kickTail: 0.045, snareTone: 220, clap: false,
    bass: "r.o.r.o.r.o.r.oo", bassOct: 2, bassWave: "square", bassCut: 1500, bassQ: 2, bassVoices: 1, bassSpread: 0,
    arp: "0123012301230123", arpOct: 5, arpWave: "square",
    hook: lines(
      "9 - 7 - 9 - 11 - 9 - 7 - 4 - 7 - | 8 - 6 - 8 - 10 - 13 - - - 11 - 10 -",
      "11 - - - 9 - 7 - 9 - - - 4 - 7 - | 8 - - - - - 7 - - - - - . . . .",
      "9 - 7 - 9 - 11 - 9 - 7 - 4 - 7 - | 8 - 6 - 8 - 10 - 13 - - - 14 - 13 -",
      "11 - 10 - 8 - 6 - 8 - - - 4 - - - | 4 - 6# - 8 - 11 - 10 - - - 8 - - -",
    ),
    leadOct: 4, leadWave: "square", leadCut: 4600, leadVoices: 2, leadSpread: 9, glide: 0,
    pump: 0.4,
  },
  // G minor, heavy half time: Gm9 E♭maj7 Cm7 D7, then B♭6 to D7; a wobble bass that quickens bar by bar,
  // a slow horn of a lead that slides between its notes.
  undertow: {
    id: "undertow", key: 7,
    prog: prog("0: 0 2 4 8, -2: -2 0 2 4, 3: -2 0 2 3, 4: 1 3 4 6#, 0: 0 2 4 8, -2: -2 0 2 4, 2: 2 4 6 7, 4: 1 3 4 6#"), padOct: 3,
    kick: "x.....x...x.....", snare: "........x....g..", hats: "x.x.x.x.x.x.xgx.", ride: "x...x...x...x...",
    kickTone: 42, kickDrive: 1.3, kickTail: 0.075, snareTone: 160, clap: false,
    bass: "r-----------r-o-", bassOct: 2, bassWave: "sawtooth", bassCut: 1100, bassQ: 8, bassVoices: 2, bassSpread: 12,
    wobble: [1, 2, 1, 4, 1, 2, 3, 4],
    arp: "0...2...1...3...", arpOct: 4, arpWave: "triangle",
    hook: lines(
      "7 - - - - - - - - - 9 - 8 - 7 - | 9 - - - - - - - 6 - - - 4 - - -",
      "5 - - - - - - - 4 - 5 - 7 - 9 - | 8 - - - - - - - 6# - - - - - - -",
      "7 - - - - - - - 10 - - - 9 - 8 - | 9 - - - - - 7 - 6 - - - 7 - 9 -",
      "11 - - - 9 - - - 7 - - - 6 - - - | 4 - - - - - - - 6# - - - 8 - - -",
    ),
    leadOct: 4, leadWave: "sawtooth", leadCut: 2400, leadVoices: 5, leadSpread: 18, glide: 0.07,
    stab: "x.......x.......",
    pump: 0.25,
  },
  // B minor, drum and bass: Bm7 Gmaj7 D A, then Em7 to F♯7; a two-step break with ghost snares,
  // a reese bass, a lead that soars on long notes and slides.
  overdrive: {
    id: "overdrive", key: 11,
    prog: prog("0: -1 0 2 4, -2: -2 0 2 4, -5: -1 2 4 6, -1: -1 1 3 6, 0: -1 0 2 4, -2: -2 0 2 4, -4: -2 0 2 3, -3: -3 -1# 1 3"), padOct: 3,
    kick: "x.........x.....", snare: "....x..g.g..x..g", hats: "x.xgx.x.x.xgx.xo", ride: "x...x...x...x...",
    kickTone: 50, kickDrive: 1.1, kickTail: 0.05, snareTone: 210, clap: false,
    bass: "r-----------r-o-", bassOct: 2, bassWave: "sawtooth", bassCut: 800, bassQ: 3, bassVoices: 3, bassSpread: 24,
    wobble: [0.25, 0.25, 0.5, 0.5, 0.25, 0.25, 0.5, 1],
    arp: "0.1.2.3.4.3.2.1.", arpOct: 4, arpWave: "sawtooth",
    hook: lines(
      "7 - - - - - 4 - 7 - 8 - 9 - - - | 8 - - - 7 - - - 4 - - - 2 - 4 -",
      "6 - - - - - 4 - 6 - 7 - 9 - - - | 8 - - - - - - - 6 - - - 4 - 3 -",
      "7 - - - - - 4 - 7 - 8 - 9 - - - | 11 - - - 10 - - - 9 - - - 7 - 9 -",
      "10 - - - 9 - 7 - 9 - - - 10 - - - | 8 - - - - - - - 6# - - - - - - -",
    ),
    leadOct: 4, leadWave: "sawtooth", leadCut: 3600, leadVoices: 5, leadSpread: 20, glide: 0.05,
    pump: 0.4,
  },
  // C minor, hard and euphoric: Cm A♭maj7 E♭ B♭, then B♭ to G7; a driven kick, a rolling bass, offbeat
  // stabs, a supersaw hook that climbs to the top of the song.
  singularity: {
    id: "singularity", key: 0,
    prog: prog("0: -3 0 2 4, -2: -2 0 2 4, -5: -3 -1 2 4, -1: -4 -1 1 3, 0: -3 0 2 8, -2: -2 0 2 4, -1: -4 -1 1 3, -3: -3 -1# 1 3"), padOct: 4,
    kick: "x...x...x...x...", snare: "....x.......x...", hats: "g.o.g.o.g.o.g.og", ride: "xgxgxgxgxgxgxgxg",
    kickTone: 44, kickDrive: 1.3, kickTail: 0.07, snareTone: 190, clap: true,
    bass: "..rr..rr..rr..ro", bassOct: 3, bassWave: "sawtooth", bassCut: 1500, bassQ: 6, bassVoices: 2, bassSpread: 10,
    arp: "0123432101234321", arpOct: 5, arpWave: "sawtooth",
    hook: lines(
      "7 - - 4 - - 2 - 4 - - 7 - - 9 - | 8 - - 7 - - 5 - 4 - - - 2 - 4 -",
      "4 - - 2 - - 4 - 6 - - 7 - - 9 - | 8 - - - - - 6 - 5 - - - 6 - - -",
      "7 - - 4 - - 2 - 4 - - 7 - - 9 - | 8 - - 7 - - 8 - 9 - - 11 - - 12 -",
      "11 - - - 10 - - - 8 - - - 6 - - - | 6# - - - - - - - 8 - - - 4 - - -",
    ),
    leadOct: 5, leadWave: "sawtooth", leadCut: 4200, leadVoices: 7, leadSpread: 26, glide: 0,
    stab: "..x...x...x...x.",
    pump: 0.25,
  },
};
