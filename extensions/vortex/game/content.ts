// Vortex's numbers: the stages, the ranks, the feel. DESIGN.md says what each
// is for; the sim (sim.ts) and the page read them, nothing else holds a tuning.

export type StageId = "pulse" | "drift" | "prism" | "undertow" | "overdrive" | "singularity";
export type PatternId = "barrage" | "run" | "alt" | "spiral" | "zigzag" | "tunnel" | "mirror" | "scatter" | "rails" | "whirl";

/** A colour as linear-ish RGB, 0..1 (the renderer lifts wall and core colours above 1 for the bloom). */
export type RGB = [number, number, number];

export type Look = {
  /** The two stripe colours of the floor, dark. */
  bgA: RGB; bgB: RGB;
  /** Walls, the centre's rim, the player. */
  wall: RGB; core: RGB; player: RGB;
  /** Colour cycling speed in turns a second (0: fixed). */
  hue: number;
};

export type SectionKind = "intro" | "build" | "drop" | "break";
/** A stretch of a song: what it is, how long (bars of four beats), how hard it hits (0..1). */
export type Section = { kind: SectionKind; bars: number; energy: number };
/** A stage's song form: its sections in order, then the ones from `loop` on repeat for as long as you last. The music arranges itself by it and the walls are choreographed to it. */
export type Form = { sections: Section[]; loop: number };

export type Stage = {
  id: StageId; name: string; blurb: string;
  form: Form;
  /** Music tempo. A multiple of 12, so every rank (10, 20, 30, 45, 60 s) lands on a beat. */
  bpm: number;
  /** Walls' speed in apothem units a second at 0:00. */
  speed: number;
  /** How fast the world turns (rad/s), and how often it reverses (s, a range). */
  rot: number; flip: [number, number];
  /** Spare time a row leaves you beyond the bare move, seconds: the main difficulty dial. */
  margin: number;
  /** The shapes the centre takes, and the chance it changes between patterns. */
  sides: number[]; morph: number;
  /** Pattern weights. */
  patterns: Partial<Record<PatternId, number>>;
  /** Camera tilt in degrees, and how far it sways. */
  tilt: number; sway: number;
  /** How hard the beat pumps the world (scale), and strobing floor flips (0..1). */
  pulse: number; strobe: number;
  /** Turns of the world that briefly speed up (0..1 chance at a flip). */
  surge: number;
  look: Look; hyperLook: Look;
};

const sec = (kind: SectionKind, bars: number, energy: number): Section => ({ kind, bars, energy });
/** After the written minute: a drop, a breath, a build, round and round. */
const LOOP = [sec("drop", 8, 1), sec("break", 4, 0.5), sec("build", 4, 0.75)];
/** Two drops either side of a break, sized so the second ends near the minute that clears the stage. */
const form = (...sections: Section[]): Form => ({ sections: [...sections, ...LOOP], loop: sections.length });

const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

export const STAGES: Stage[] = [
  {
    id: "pulse", name: "Pulse", blurb: "Learn the turn",
    form: form(sec("intro", 4, 0.3), sec("build", 4, 0.55), sec("drop", 8, 0.8), sec("break", 4, 0.35), sec("build", 4, 0.65), sec("drop", 8, 1)),
    bpm: 132, speed: 5.6, rot: 1.05, flip: [4, 8], margin: 0.2, sides: [6], morph: 0,
    patterns: { barrage: 5, run: 4, alt: 3, spiral: 2, zigzag: 2, tunnel: 1 },
    tilt: 24, sway: 6, pulse: 0.05, strobe: 0, surge: 0,
    look: { bgA: rgb("#071a2c"), bgB: rgb("#0b2740"), wall: rgb("#3fe8ff"), core: rgb("#7ff3ff"), player: rgb("#e6ffff"), hue: 0 },
    hyperLook: { bgA: rgb("#1d0716"), bgB: rgb("#2c0b22"), wall: rgb("#ff4fa8"), core: rgb("#ff8fcb"), player: rgb("#fff0f7"), hue: 0 },
  },
  {
    id: "drift", name: "Drift", blurb: "The world turns on you",
    form: form(sec("intro", 4, 0.3), sec("build", 4, 0.55), sec("drop", 8, 0.8), sec("break", 4, 0.4), sec("build", 4, 0.65), sec("drop", 12, 1)),
    bpm: 144, speed: 6.4, rot: 1.55, flip: [2.5, 5.5], margin: 0.17, sides: [6, 5], morph: 0.22,
    patterns: { barrage: 3, run: 5, alt: 3, spiral: 3, zigzag: 3, tunnel: 2, mirror: 2 },
    tilt: 30, sway: 10, pulse: 0.06, strobe: 0, surge: 0.2,
    look: { bgA: rgb("#170726"), bgB: rgb("#230b3a"), wall: rgb("#d35bff"), core: rgb("#ec9bff"), player: rgb("#fbeaff"), hue: 0 },
    hyperLook: { bgA: rgb("#1e1404"), bgB: rgb("#2e1f06"), wall: rgb("#ffb627"), core: rgb("#ffd36e"), player: rgb("#fff7e3"), hue: 0 },
  },
  {
    id: "prism", name: "Prism", blurb: "Shapes that will not hold still",
    form: form(sec("intro", 4, 0.35), sec("build", 4, 0.6), sec("drop", 12, 0.85), sec("break", 4, 0.4), sec("build", 4, 0.7), sec("drop", 12, 1)),
    bpm: 156, speed: 7.0, rot: 1.8, flip: [3, 6], margin: 0.15, sides: [4, 5, 6], morph: 0.45,
    patterns: { barrage: 3, run: 4, alt: 3, spiral: 3, zigzag: 3, tunnel: 2, mirror: 3, scatter: 2 },
    tilt: 26, sway: 8, pulse: 0.07, strobe: 0.15, surge: 0.25,
    look: { bgA: rgb("#0b0b1f"), bgB: rgb("#15152f"), wall: rgb("#ff5fd2"), core: rgb("#ffffff"), player: rgb("#ffffff"), hue: 0.05 },
    hyperLook: { bgA: rgb("#030d10"), bgB: rgb("#06191c"), wall: rgb("#4bffd0"), core: rgb("#ffffff"), player: rgb("#ffffff"), hue: -0.08 },
  },
  {
    id: "undertow", name: "Undertow", blurb: "Deep, slow, heavy",
    form: form(sec("intro", 4, 0.35), sec("build", 2, 0.6), sec("drop", 8, 0.85), sec("break", 4, 0.4), sec("build", 4, 0.7), sec("drop", 8, 1)),
    bpm: 120, speed: 7.6, rot: 1.35, flip: [3, 7], margin: 0.14, sides: [5, 6, 7], morph: 0.3,
    patterns: { barrage: 2, run: 4, alt: 2, spiral: 2, zigzag: 2, tunnel: 4, mirror: 2, rails: 4, whirl: 2 },
    tilt: 36, sway: 7, pulse: 0.1, strobe: 0, surge: 0.2,
    look: { bgA: rgb("#1c0805"), bgB: rgb("#2c0e07"), wall: rgb("#ff7a2e"), core: rgb("#ffc26b"), player: rgb("#fff1dc"), hue: 0 },
    hyperLook: { bgA: rgb("#04101e"), bgB: rgb("#081a30"), wall: rgb("#3d8bff"), core: rgb("#9cc4ff"), player: rgb("#eef5ff"), hue: 0 },
  },
  {
    id: "overdrive", name: "Overdrive", blurb: "Everything at once, faster",
    form: form(sec("intro", 4, 0.4), sec("build", 4, 0.65), sec("drop", 12, 0.9), sec("break", 4, 0.45), sec("build", 4, 0.75), sec("drop", 16, 1)),
    bpm: 168, speed: 8.6, rot: 2.3, flip: [2, 4.5], margin: 0.12, sides: [6, 4, 5], morph: 0.25,
    patterns: { barrage: 2, run: 4, alt: 3, spiral: 4, zigzag: 4, tunnel: 3, mirror: 3, scatter: 3, whirl: 3 },
    tilt: 32, sway: 12, pulse: 0.08, strobe: 0.45, surge: 0.4,
    look: { bgA: rgb("#050f04"), bgB: rgb("#0b1d08"), wall: rgb("#a6ff2e"), core: rgb("#e2ff9c"), player: rgb("#f6ffe8"), hue: 0 },
    hyperLook: { bgA: rgb("#1a0303"), bgB: rgb("#2c0606"), wall: rgb("#ff3434"), core: rgb("#ff9a8a"), player: rgb("#fff0ee"), hue: 0 },
  },
  {
    id: "singularity", name: "Singularity", blurb: "The end of the line",
    form: form(sec("intro", 2, 0.45), sec("build", 4, 0.7), sec("drop", 12, 0.9), sec("break", 4, 0.45), sec("build", 4, 0.8), sec("drop", 20, 1)),
    bpm: 180, speed: 9.4, rot: 2.7, flip: [1.6, 4], margin: 0.105, sides: [4, 5, 6, 7], morph: 0.4,
    patterns: { barrage: 2, run: 4, alt: 2, spiral: 4, zigzag: 4, tunnel: 3, mirror: 4, scatter: 3, rails: 3, whirl: 4 },
    tilt: 30, sway: 10, pulse: 0.1, strobe: 0.6, surge: 0.55,
    look: { bgA: rgb("#0c0618"), bgB: rgb("#1a0f2e"), wall: rgb("#f2ecff"), core: rgb("#b493ff"), player: rgb("#ffffff"), hue: 0.02 },
    hyperLook: { bgA: rgb("#000000"), bgB: rgb("#140a00"), wall: rgb("#ffd84a"), core: rgb("#ffffff"), player: rgb("#ffffff"), hue: 0.12 },
  },
];

export const stageOf = (id: StageId) => STAGES.find((s) => s.id === id)!;

/** Hyper: the same stage, quicker and tighter, in its other colours. */
export const HYPER = { speed: 1.22, rot: 1.35, margin: 0.72 };

/** The ranks a run passes, by the seconds survived. Reaching the last clears the stage and opens the next. */
export const RANKS = [
  { at: 0, name: "Point" },
  { at: 10, name: "Line" },
  { at: 20, name: "Triangle" },
  { at: 30, name: "Square" },
  { at: 45, name: "Pentagon" },
  { at: 60, name: "Hexagon" },
] as const;
export const CLEAR = 60;
export const rankAt = (t: number) => { let r = 0; for (let i = 0; i < RANKS.length; i++) if (t >= RANKS[i].at) r = i; return r; };

export const FEEL = {
  /** The player's orbit, the centre's apothem and where walls appear (apothem units). */
  orbit: 1,
  core: 0.72,
  spawn: 11,
  /** Turning speed, rad/s; holding Shift turns at the slower one for a fine line. */
  turn: 9.6,
  focus: 4.6,
  /** Speed and spin climb through a run: per second, to 60 s and after it. */
  rampTo60: 0.0042,
  rampAfter: 0.0016,
  spinRamp: 0.006,
};

/** The section at a number of beats into the song, with where it began and how long it lasts (beats); `n` counts sections from the start, loops included. */
export function sectionAt(f: Form, beats: number) {
  let at = 0, i = 0, n = 0;
  for (;;) {
    const s = f.sections[i], len = s.bars * 4;
    if (beats < at + len) return { ...s, start: at, len, index: i, n };
    at += len; n++;
    i = i + 1 < f.sections.length ? i + 1 : f.loop;
  }
}

/** How the player looks: a shape, and what it leaves behind. Opened by medals (meta.ts). */
export const SKINS = ["dart", "arrow", "diamond", "comet", "star"] as const;
export const TRAILS = ["line", "ribbon", "sparks", "prism"] as const;
export type SkinId = (typeof SKINS)[number];
export type TrailId = (typeof TRAILS)[number];
