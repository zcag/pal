// The six songs, one per stage, as patterns the sequencer in music.ts reads a
// sixteenth at a time. Everything is in the key's scale degrees (natural
// minor), so a chord is the scale's triad on its root and every line stays in
// key. Notation, one character (or, for leads, one token) per sixteenth:
//   drums  x hit, o open hat, . rest
//   bass   r chord root, 5 its fifth, o its octave, - hold, . rest
//   arp    0..5 the chord's tones (3..5 an octave up), . rest
//   lead   a scale degree (7 is the octave), - hold, . rest; two bars a phrase
import type { StageId } from "../game/content.ts";

export type Song = {
  bpm: number;
  /** The key's pitch class (0 = C) and its scale. */
  key: number; scale: number[];
  /** One chord a bar, as scale degrees of its root. */
  chords: number[];
  kick: string; snare: string; hats: string; hats2?: string; ride?: string;
  kickTone: number; snareTone: number;
  bass: string; bassOct: number; bassCut: number; bassQ: number;
  /** Cycles a beat of the bass filter's wobble (0: none). */
  wobble?: number;
  arp?: string; arpOct: number; arpWave: OscillatorType;
  lead: string[][]; leadOct: number; leadWave: OscillatorType; leadCut: number;
  /** How far the kick ducks the rest (gain at the hit). */
  pump: number;
  /** On the menus: the beat and the bass too, or only chords and arp. */
  menuBeat?: boolean; menuBass?: boolean;
  /** Chord stabs on the eighths at the last rank. */
  stabs?: boolean;
};

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const phrases = (...ps: string[]) => ps.map((p) => p.replace(/\|/g, " ").trim().split(/\s+/));

export const freq = (s: Song, degree: number, octave: number) => {
  const d = ((degree % 7) + 7) % 7, o = Math.floor(degree / 7);
  const midi = 12 * (octave + 1) + s.key + s.scale[d] + 12 * o;
  return 440 * Math.pow(2, (midi - 69) / 12);
};
export const chordTones = (_s: Song, root: number) => [root, root + 2, root + 4];

export const SONGS: Record<StageId, Song> = {
  // A minor, uplifting: Am F C G, an offbeat bass that pumps.
  pulse: {
    bpm: 132, key: 9, scale: MINOR, chords: [0, 5, 2, 6],
    kick: "x...x...x...x...", snare: "....x.......x...", hats: "..o...o...o...o.", hats2: "x.o.x.o.x.o.xxo.", ride: "x...x...x...x...",
    kickTone: 48, snareTone: 180,
    bass: "..r-..r-..r-..o-", bassOct: 2, bassCut: 1400, bassQ: 4,
    arp: "0120312041203120", arpOct: 4, arpWave: "square",
    lead: phrases(
      "11 - - 9 - - 7 - 9 - 11 - 12 - 11 - | 12 - - 11 - - 9 - 7 - - - 5 - 7 -",
      "9 - - 7 - - 9 - 11 - - - 9 - 11 - | 13 - - 11 - - 10 - 11 - - - - - . .",
      "11 - - 9 - - 7 - 9 - 11 - 12 - 14 - | 12 - - 11 - - 9 - 12 - - - 14 - 12 -",
      "11 - - 9 - - 11 - 14 - - - 13 - 11 - | 10 - - 8 - - 10 - 7 - - - - - - -",
    ),
    leadOct: 4, leadWave: "sawtooth", leadCut: 3400,
    pump: 0.3, menuBeat: false,
  },
  // D minor, darker electro: Dm B♭ Gm Am, a rolling sixteenth bass.
  drift: {
    bpm: 144, key: 2, scale: MINOR, chords: [0, 5, 3, 4],
    kick: "x...x...x...x...", snare: "....x.......x..x", hats: "x.x.x.x.x.x.x.x.", hats2: "xxoxxxoxxxoxxxox", ride: "..x...x...x...x.",
    kickTone: 46, snareTone: 200,
    bass: "r.rr.rr.r.rr.ro.", bassOct: 2, bassCut: 1100, bassQ: 7,
    arp: "0.2.1.3.2.4.3.5.", arpOct: 4, arpWave: "sawtooth",
    lead: phrases(
      "7 - - - 9 - - - 10 - 9 - 7 - 6 - | 5 - - - - - 7 - 5 - 4 - 2 - - -",
      "3 - - - 5 - - - 7 - 5 - 3 - 2 - | 4 - - - - - - - 6 - - - 7 - - -",
      "7 - - - 9 - - - 10 - 12 - 11 - 10 - | 9 - - - - - 10 - 9 - 7 - 5 - - -",
      "10 - 9 - 7 - 5 - 3 - 5 - 7 - 9 - | 8 - - - - - - - 7 - - - - - - -",
    ),
    leadOct: 4, leadWave: "sawtooth", leadCut: 2800,
    pump: 0.35, menuBeat: false,
  },
  // F♯ minor, bright chiptune: D E F♯m F♯m, square waves and a quick arp.
  prism: {
    bpm: 156, key: 6, scale: MINOR, chords: [5, 6, 0, 0],
    kick: "x...x...x...x...", snare: "....x.......x...", hats: "x.xxx.xxx.xxx.xx", hats2: "xxxxxxxxxxxxxxxx", ride: "..o...o...o...o.",
    kickTone: 52, snareTone: 220,
    bass: "r.o.r.o.r.o.r.o.", bassOct: 2, bassCut: 1800, bassQ: 3,
    arp: "0123012301230123", arpOct: 5, arpWave: "square",
    lead: phrases(
      "12 - 11 - 12 - 14 - 12 - 11 - 9 - 11 - | 13 - 12 - 13 - 15 - 13 - - - 11 - - -",
      "14 - - - 12 - - - 11 - 9 - 7 - 9 - | 11 - - - - - - - 9 - 11 - 12 - 14 -",
      "12 - 11 - 12 - 14 - 15 - 14 - 12 - 14 - | 13 - 15 - 17 - 15 - 13 - - - 12 - 13 -",
      "14 - - - 16 - - - 14 - 12 - 11 - 12 - | 14 - - - - - - - - - - - . . . .",
    ),
    leadOct: 4, leadWave: "square", leadCut: 5200,
    pump: 0.45, menuBeat: false,
  },
  // G minor, heavy half time: Gm E♭ Cm Dm, a wobbling bass.
  undertow: {
    bpm: 120, key: 7, scale: MINOR, chords: [0, 5, 3, 4],
    kick: "x.......x.x.....", snare: "........x.......", hats: "x.x.x.x.x.x.x.x.", hats2: "x.xxx.xxx.xxx.xx", ride: "x...x...x...x...",
    kickTone: 42, snareTone: 160,
    bass: "r-------r---o---", bassOct: 2, bassCut: 900, bassQ: 9, wobble: 2,
    arp: "0...2...1...4...", arpOct: 4, arpWave: "triangle",
    lead: phrases(
      "7 - - - - - - - 6 - - - 5 - - - | 3 - - - - - - - 2 - - - 3 - - -",
      "4 - - - - - - - 5 - - - 4 - - - | 1 - - - - - - - - - - - - - - -",
      "7 - - - - - 9 - 10 - - - 9 - - - | 7 - - - - - - - 5 - - - 7 - - -",
      "8 - - - - - 7 - 6 - - - 5 - - - | 4 - - - - - - - - - - - - - - -",
    ),
    leadOct: 4, leadWave: "sawtooth", leadCut: 2200,
    pump: 0.25, menuBeat: true, stabs: true,
  },
  // B minor, breakbeat: Bm A G A, a long reese bass under quick hats.
  overdrive: {
    bpm: 168, key: 11, scale: MINOR, chords: [0, 6, 5, 6],
    kick: "x.........x.....", snare: "....x.......x...", hats: "x.xxx.xxx.xxx.xx", hats2: "xxxxxxxxxxxxxxxx", ride: "x.o.x.o.x.o.x.o.",
    kickTone: 50, snareTone: 210,
    bass: "r---------r---o-", bassOct: 2, bassCut: 1300, bassQ: 5, wobble: 0.5,
    arp: "0.1.2.3.4.3.2.1.", arpOct: 4, arpWave: "sawtooth",
    lead: phrases(
      "7 - - 6 - - 4 - 6 - - 7 - - 9 - | 8 - - - - - 7 - 6 - - - - - - -",
      "5 - - 6 - - 7 - 9 - - 8 - - 6 - | 8 - - - - - - - 9 - - - 8 - - -",
      "11 - - 10 - - 9 - 10 - - 11 - - 13 - | 12 - - - - - 11 - 10 - - - 9 - - -",
      "9 - - 10 - - 11 - 12 - - 11 - - 9 - | 10 - - - - - - - - - - - . . . .",
    ),
    leadOct: 4, leadWave: "sawtooth", leadCut: 3600,
    pump: 0.4, menuBeat: false, stabs: true,
  },
  // C minor, hard and fast: Cm A♭ E♭ B♭, a driven kick on every beat.
  singularity: {
    bpm: 180, key: 0, scale: MINOR, chords: [0, 5, 2, 6],
    kick: "x...x...x...x...", snare: "....x.......x...", hats: "..o...o...o...o.", hats2: "x.o.x.o.x.o.x.ox", ride: "xxxxxxxxxxxxxxxx",
    kickTone: 44, snareTone: 190,
    bass: "..r.o.r...r.o.r.", bassOct: 2, bassCut: 1600, bassQ: 6,
    arp: "0123432101234321", arpOct: 5, arpWave: "sawtooth",
    lead: phrases(
      "14 - - - 12 - - - 11 - - - 12 - 14 - | 15 - - - 14 - - - 12 - - - 11 - - -",
      "9 - - - 11 - - - 12 - - - 14 - - - | 13 - - - - - - - 12 - - - 13 - - -",
      "14 - - - 12 - - - 11 - - - 12 - 14 - | 16 - - - 15 - - - 14 - - - 12 - - -",
      "13 - - - 12 - - - 11 - - - 9 - - - | 10 - - - - - - - - - - - - - - -",
    ),
    leadOct: 4, leadWave: "sawtooth", leadCut: 4400,
    pump: 0.3, menuBeat: false, stabs: true,
  },
};
