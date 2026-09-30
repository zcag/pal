// Sound: the pack's effects and tracks through Web Audio. Nothing plays
// until a key has been pressed (the browser's rule). Busy sounds (hits,
// gems) are throttled so a crowd doesn't roar, and music crossfades
// between tracks. Music and effects have their own volume (settings).
const A = "./assets/";

/** Each effect's volume and the least time between two of it. */
const SFX: Record<string, [number, number]> = {
  hit: [0.12, 0.045], crit: [0.22, 0.06], hurt: [0.5, 0.2], block: [0.3, 0.1], break: [0.35, 0.05], throw: [0.12, 0.1], slash: [0.26, 0.08],
  thrust: [0.26, 0.1], chain: [0.12, 0.3], bow: [0.25, 0.1], fire: [0.18, 0.1], explosion: [0.26, 0.08], pop: [0.2, 0.05], thunder: [0.28, 0.1],
  spirit: [0.28, 0.3], gong: [0.45, 0.3], rock: [0.28, 0.1], ice: [0.2, 0.1], blizzard: [0.5, 1], geyser: [0.28, 0.1], splash: [0.2, 0.1],
  fuse: [0.2, 0.2], gust: [0.25, 0.1], vines: [0.25, 0.1], dash: [0.35, 0.1], gem: [0.1, 0.035], coin: [0.3, 0.05], heal: [0.45, 0.1],
  chest: [0.6, 0.2], evolve: [0.7, 0.2], levelup: [0.45, 0.2], accept: [0.4, 0.05], move: [0.25, 0.03], back: [0.3, 0.05],
  reroll: [0.4, 0.1], skip: [0.4, 0.1], banish: [0.45, 0.1], buy: [0.45, 0.05], alert: [0.5, 0.5], roar: [0.6, 0.4], victory: [0.6, 1],
  dawn: [0.6, 1], gameover: [0.6, 1], revive: [0.6, 1], burrow: [0.2, 0.2], shoot: [0.15, 0.12], slam: [0.45, 0.15], croak: [0.5, 0.3],
  stone: [0.5, 0.3], poof: [0.35, 0.2], draw: [0.35, 0.2], wail: [0.45, 0.4], vanish: [0.4, 0.3], feathers: [0.4, 0.2], crows: [0.45, 0.5],
  drum: [0.6, 0.3], sparkle: [0.45, 0.4], flute: [0.6, 1], freeze: [0.5, 1], purify: [0.6, 1], gourd: [0.55, 1], unlock: [0.6, 0.5],
};
export type Track = "title" | "act1" | "act2" | "act3" | "boss" | "oni" | "dawn";

let ctx: AudioContext | undefined;
let sfxBus: GainNode, musicBus: GainNode;
const buffers = new Map<string, AudioBuffer>();
const last = new Map<string, number>();
let music: { track: Track; src: AudioBufferSourceNode; gain: GainNode } | undefined;
let wanted: Track | undefined;
let vol = { music: 0.6, sfx: 0.8 };

async function load(name: string, path: string) {
  if (!ctx || buffers.has(name)) return;
  const data = await (await fetch(A + path)).arrayBuffer();
  buffers.set(name, await ctx.decodeAudioData(data));
}

/** Call from a key press: starts audio and loads the sounds, music first for the track that's wanted. */
export function wake() {
  if (ctx) return void (ctx.state === "suspended" && ctx.resume());
  ctx = new AudioContext();
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  sfxBus.gain.value = vol.sfx;
  musicBus.gain.value = vol.music;
  sfxBus.connect(ctx.destination);
  musicBus.connect(ctx.destination);
  const tracks: Track[] = ["title", "act1", "act2", "act3", "boss", "oni", "dawn"];
  tracks.sort((a, b) => (a === wanted ? -1 : b === wanted ? 1 : 0));
  for (const t of tracks) void load(`music:${t}`, `music/${t}.mp3`).then(() => { if (wanted === t && music?.track !== t) play(t); }).catch(() => {});
  for (const n of Object.keys(SFX)) void load(n, `sfx/${n}.mp3`).catch(() => {});
}

export function sfx(name: string) {
  const def = SFX[name], buf = buffers.get(name);
  if (!ctx || !def || !buf || vol.sfx <= 0) return;
  const now = ctx.currentTime;
  if (now - (last.get(name) ?? -1) < def[1]) return;
  last.set(name, now);
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf;
  if (name === "hit" || name === "gem" || name === "coin") src.playbackRate.value = 0.9 + Math.random() * 0.2;
  g.gain.value = def[0];
  src.connect(g).connect(sfxBus);
  src.start();
}

/** Crossfade to a track (undefined: fade out). */
export function play(track: Track | undefined) {
  wanted = track;
  if (!ctx || music?.track === track) return;
  const now = ctx.currentTime;
  if (music) {
    const old = music;
    old.gain.gain.setTargetAtTime(0, now, 0.5);
    old.src.stop(now + 3);
    music = undefined;
  }
  const buf = track && buffers.get(`music:${track}`);
  if (!track || !buf) return;
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf;
  src.loop = track !== "dawn";
  g.gain.value = 0;
  g.gain.setTargetAtTime(0.5, now, 0.7);
  src.connect(g).connect(musicBus);
  src.start();
  music = { track, src, gain: g };
}

export function volume(v: { music: number; sfx: number }) {
  vol = { music: v.music, sfx: v.sfx };
  if (!ctx) return;
  musicBus.gain.setTargetAtTime(v.music, ctx.currentTime, 0.05);
  sfxBus.gain.setTargetAtTime(v.sfx, ctx.currentTime, 0.05);
}

/** Pause everything (the panel hidden) and carry on. */
export const suspend = () => void ctx?.suspend();
export const unsuspend = () => void (ctx?.state === "suspended" && ctx.resume());
