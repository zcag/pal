// Vortex's sound: every note is synthesised here, so the music is the game's
// clock. A sequencer reads a song (songs.ts) a sixteenth at a time and
// schedules each note a little ahead on the AudioContext; the run's time is
// that same clock (as heard: minus the output latency), so a wall lands on
// the beat you hear and the world pumps with the kick you hear.
//
// The arrangement follows the stage's form (content.ts), beat-exact from the
// run's step 0: an intro states the key and the hook on a bell through a closed
// filter; a build opens the filter, rolls the snare from quarters to 32nds,
// lifts a noise riser and a rising saw, drops the kick for its last bar and
// swells a reversed cymbal into the drop; the drop hits with a crash and a sub
// boom and plays everything, the hook on a supersaw (a harmony and an octave
// shimmer from the second drop on); a break takes the kick out and plays the
// hook half time on the bell over a low pad. Energy scales each; the rank adds
// a little on top. The menus loop the intro and break material, muffled.
//
// The mix: drums dry; bass, chords, arp and lead on a bus the kick ducks (the
// pump) and a section filter colours; sends to a long reverb and a ping-pong
// delay; one master low-pass that muffles the music on the menus and closes
// like a tape stop when you die.
import { sectionAt, stageOf, type Form, type SectionKind } from "../game/content.ts";
import { SONGS, diatonic, freq, tone, type Chord, type Song } from "./songs.ts";

type Hit = "kick" | "snare" | "hat";
export type Sfx = "death" | "rank" | "record" | "move" | "select" | "start" | "flip" | "back" | "open" | "graze" | "medal" | "ghost" | "replay";

/** What a bar plays: its section's kind and energy, where it sits in it, its chord. */
type Part = {
  kind: SectionKind; e: number;
  /** The bar within its section, the section's bars, the bars left counting this one. */
  at: number; bars: number; left: number;
  /** The section's count from the song's start (-1: no one-shots of its own), and the drops before it. */
  n: number; drops: number;
  chord: Chord; menu: boolean;
};

/** Cents the death replay's slow motion bends the music down. */
const SLOW = 600;

export class Music {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private slowLp!: BiquadFilterNode;
  private bus!: GainNode;
  private color!: BiquadFilterNode;
  private duck!: GainNode;
  private drums!: GainNode;
  private sfxBus!: GainNode;
  private verbSend!: GainNode;
  private delaySend!: GainNode;
  private delays: DelayNode[] = [];
  private noise!: AudioBuffer;
  private wide!: AudioBuffer;
  private shaper!: WaveShaperNode;

  song: Song = SONGS.pulse;
  private form: Form = stageOf("pulse").form;
  private bpm = 132;
  /** Audio time of step 0, and the next step to schedule. */
  private anchor = 0;
  private nextStep = 0;
  /** A song queued to take over at a bar line (endless), and the grid the last one left (for `beats` until it is heard). */
  private next: { song: Song; at: number } | null = null;
  private was: { anchor: number; beatLen: number } | null = null;
  /** -1: the menus (sparse, muffled); 0..5: a run's rank. */
  layer = -1;
  private live: AudioScheduledSourceNode[] = [];
  private hits: Record<Hit, number[]> = { kick: [], snare: [], hat: [] };
  /** The bar the arrangement was worked out for, the section whose one-shots are scheduled, the lead's last note (for glides). */
  private bar = -1;
  private part!: Part;
  private cued = -1;
  private lastLead = { f: 0, end: 0 };
  /** Cents every new note is bent by (the slow motion), and grazes in a row (each one a step up the chord). */
  private bend = 0;
  private graze = { at: 0, n: 0 };
  volume = 0.8;
  muted = false;
  private t0 = performance.now();

  /** Starts sound; must follow a key press the first time. */
  start() {
    if (!this.ctx) this.boot();
    if (this.ctx!.state === "suspended") this.ctx!.resume();
  }
  suspend() { this.ctx?.suspend(); }

  /** Builds the graph on a context (the page's own, or an offline one that renders a song to measure it) into `out`. */
  private boot(ctx: AudioContext = new AudioContext({ latencyHint: "interactive" }), out: AudioNode = ctx.destination) {
    this.ctx = ctx;
    const node = <T extends AudioNode>(n: T, set: (n: T) => void = () => {}) => { set(n); return n; };
    this.master = ctx.createGain();
    this.applyVolume();
    const comp = node(ctx.createDynamicsCompressor(), (c) => { c.threshold.value = -14; c.ratio.value = 4; c.attack.value = 0.004; c.release.value = 0.2; });
    const limit = node(ctx.createDynamicsCompressor(), (c) => { c.threshold.value = -2; c.ratio.value = 20; c.attack.value = 0.001; c.release.value = 0.05; });
    this.master.connect(comp).connect(limit).connect(out);
    this.muffle = node(ctx.createBiquadFilter(), (f) => { f.type = "lowpass"; f.frequency.value = 1800; f.Q.value = 0.9; });
    this.muffle.connect(this.master);
    this.slowLp = node(ctx.createBiquadFilter(), (f) => { f.type = "lowpass"; f.frequency.value = 20000; f.Q.value = 0.5; });
    this.slowLp.connect(this.muffle);
    this.bus = ctx.createGain(); this.bus.connect(this.slowLp);
    this.color = node(ctx.createBiquadFilter(), (f) => { f.type = "lowpass"; f.frequency.value = 2000; f.Q.value = 1.1; });
    this.color.connect(this.bus);
    this.duck = ctx.createGain(); this.duck.connect(this.color);
    this.drums = ctx.createGain(); this.drums.connect(this.bus);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);

    const buffer = (channels: number, seconds: number) => {
      const b = ctx.createBuffer(channels, ctx.sampleRate * seconds, ctx.sampleRate);
      for (let c = 0; c < channels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      return b;
    };
    this.noise = buffer(1, 1);
    this.wide = buffer(2, 2);

    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    verb.buffer = ir;
    this.verbSend = node(ctx.createGain(), (g) => { g.gain.value = 0.3; });
    this.verbSend.connect(node(ctx.createBiquadFilter(), (f) => { f.type = "highpass"; f.frequency.value = 320; })).connect(verb).connect(this.color);

    // Ping-pong: the send feeds the left tap, each tap feeds the other, so echoes walk left, right, left.
    this.delaySend = node(ctx.createGain(), (g) => { g.gain.value = 0.2; });
    const merge = ctx.createChannelMerger(2), band = node(ctx.createBiquadFilter(), (f) => { f.type = "bandpass"; f.frequency.value = 1500; f.Q.value = 0.4; });
    const [l, r] = [ctx.createDelay(2), ctx.createDelay(2)];
    const fb = () => node(ctx.createGain(), (g) => { g.gain.value = 0.42; });
    this.delaySend.connect(band).connect(l);
    l.connect(fb()).connect(r); r.connect(fb()).connect(l);
    l.connect(merge, 0, 0); r.connect(merge, 0, 1);
    merge.connect(this.duck);
    this.delays = [l, r];

    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 1.7) / Math.tanh(1.7); }
    this.shaper.curve = curve;
    // The kick is driven hard into the saturator for its punch, then trimmed to sit under the music.
    this.shaper.connect(node(ctx.createGain(), (g) => { g.gain.value = 0.58; })).connect(this.drums);
    this.setSong(this.song, true);
  }

  applyVolume() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume * 0.9, this.ctx.currentTime, 0.03);
  }

  // ---- the clock ------------------------------------------------------------------------------------------------------

  /** Now as heard, seconds on the audio clock; before sound starts, a stand-in clock that keeps the menus moving. */
  now() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return (performance.now() - this.t0) / 1000;
    const ts = ctx.getOutputTimestamp?.();
    if (ts?.contextTime && ts.performanceTime) return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }
  get running() { return this.ctx?.state === "running"; }
  get beatLen() { return 60 / this.bpm; }
  private get barLen() { return 240 / this.bpm; }
  /** Beats since the anchor, as heard (on the last song's grid until a queued one is heard). */
  beats(at = this.now()) {
    if (this.was && at < this.anchor) return (at - this.was.anchor) / this.was.beatLen;
    return (at - this.anchor) / this.beatLen;
  }
  /** Seconds since the last kick (or snare, hat) you heard. */
  since(h: Hit, at = this.now()) {
    const xs = this.hits[h];
    for (let i = xs.length - 1; i >= 0; i--) if (xs[i] <= at) return at - xs[i];
    return 9;
  }

  /** Moves the song's step 0 to just ahead of now (a run starts on its downbeat); answers that time, as heard. */
  restart(lead = 0.06) {
    const ctx = this.ctx;
    if (ctx) {
      // Fade what rings out over a few milliseconds, so cutting it does not click, and open again for step 0.
      const t = ctx.currentTime, g = this.bus.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.012); g.setValueAtTime(1, t + 0.02);
      for (const n of this.live) try { n.stop(t + 0.015); } catch { /* already stopped */ }
      this.duck.gain.cancelScheduledValues(t); this.duck.gain.setValueAtTime(1, t);
      this.slow(false);
    }
    this.live = [];
    this.anchor = (this.running ? ctx!.currentTime : this.now()) + lead;
    this.nextStep = 0;
    this.next = this.was = null;
    this.bar = this.cued = -1;
    this.lastLead = { f: 0, end: 0 };
    for (const h of Object.values(this.hits)) h.length = 0;
    return this.anchor;
  }

  /** Puts step 0 at `zero` (a run resumed mid-way), carrying on from the step due now. */
  align(zero: number) {
    this.anchor = zero;
    this.bar = -1;
    if (this.running) this.nextStep = Math.max(0, Math.ceil((this.ctx!.currentTime - zero) / (this.beatLen / 4)));
  }

  setSong(song: Song, restart = false) {
    const changed = song !== this.song;
    this.use(song, this.ctx?.currentTime ?? 0);
    if ((changed || restart) && this.ctx) this.restart(0.05);
  }

  /** Endless: `song` takes over at audio time `at` (a bar line the caller picks), its step 0 there; the bar before it builds into it and a crash lands on it. */
  queueSong(song: Song, at: number) {
    const ctx = this.ctx;
    if (!ctx) { this.setSong(song); return; }
    this.next = { song, at };
    this.bar = -1;
    const from = Math.max(ctx.currentTime + 0.02, at - 2 * this.barLen);
    if (at - from > 0.25) this.rise(from, at, 0.8);
  }

  private use(song: Song, t: number) {
    this.song = song;
    const st = stageOf(song.id);
    this.form = st.form; this.bpm = st.bpm;
    this.bar = -1;
    for (const d of this.delays) d.delayTime.setValueAtTime(this.beatLen * 0.75, t);
  }

  /** Opens or closes the music's filter: runs open, menus muffled, death closes it. */
  open(hz: number, seconds = 0.25) {
    if (!this.ctx) return;
    const p = this.muffle.frequency, t = this.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.exponentialRampToValueAtTime(Math.max(60, hz), t + seconds);
  }

  /** Slow motion, for the death replay: what rings bends down like a slowing tape, new notes play down there, the top closes; off brings it back. */
  slow(on: boolean) {
    const ctx = this.ctx;
    if (!ctx || on === (this.bend !== 0)) return;
    const t = ctx.currentTime, d = on ? -SLOW : SLOW;
    this.bend = on ? -SLOW : 0;
    for (const n of this.live) {
      if (n instanceof OscillatorNode) n.detune.setTargetAtTime(n.detune.value + d, t, 0.25);
      else if (n instanceof AudioBufferSourceNode) n.playbackRate.setTargetAtTime(Math.pow(2, this.bend / 1200), t, 0.25);
    }
    const p = this.slowLp.frequency;
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t);
    p.exponentialRampToValueAtTime(on ? 650 : 20000, t + (on ? 0.6 : 0.2));
  }

  // ---- the sequencer --------------------------------------------------------------------------------------------------

  /** Called every frame: schedules every sixteenth up to a little ahead. */
  tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    this.fill(ctx.currentTime + 0.14);
    this.live = this.live.filter((n) => (n as unknown as { _end: number })._end > ctx.currentTime);
  }

  private fill(horizon: number) {
    const now = this.ctx!.currentTime;
    for (;;) {
      const sixteenth = this.beatLen / 4;
      // After a long stall (a hidden panel), skip what is past rather than play it all at once.
      const due = Math.floor((now - this.anchor) / sixteenth);
      if (due > this.nextStep + 4) this.nextStep = due;
      const t = this.anchor + this.nextStep * sixteenth;
      if (this.next && t >= this.next.at - 1e-4) {
        const { song, at } = this.next;
        this.was = { anchor: this.anchor, beatLen: this.beatLen };
        this.next = null;
        this.use(song, at);
        this.anchor = at; this.nextStep = 0; this.cued = -1;
        this.impact(Math.max(at, now), 1);
        continue;
      }
      if (t >= horizon) return;
      this.play(this.nextStep++, t);
    }
  }

  /** Where bar `bar` sits in the form (or the menu loop), and its chord. */
  private arrange(bar: number): Part {
    const menu = this.layer < 0, f = this.form;
    let w: Omit<Part, "chord" | "menu">;
    if (menu) {
      // Eight bars of the intro, eight of the break, round: the hook on the bell, never a drop.
      const at = bar % 8;
      w = { kind: bar % 16 < 8 ? "intro" : "break", e: 0.3, at, bars: 8, left: 8 - at, n: -1, drops: 0 };
    } else {
      const x = sectionAt(f, bar * 4), at = bar - x.start / 4;
      let drops = 0;
      for (let n = 0; n < x.n; n++) {
        const i = n < f.sections.length ? n : f.loop + ((n - f.sections.length) % (f.sections.length - f.loop));
        if (f.sections[i].kind === "drop") drops++;
      }
      w = { kind: x.kind, e: x.energy, at, bars: x.bars, left: x.bars - at, n: x.n, drops };
    }
    // The bar before a queued song builds into it, whatever the form says.
    if (this.next && this.anchor + (bar + 1) * this.barLen >= this.next.at - 1e-3) w = { ...w, kind: "build", e: Math.max(w.e, 0.8), at: 0, bars: 1, left: 1, n: -1 };
    const { kind, at, left } = w;
    return { ...w, menu, chord: this.song.prog[kind === "break" ? (at >> 1) % 8 : kind === "build" && left === 1 ? 7 : at % 8] };
  }

  private play(step: number, t: number) {
    const s = this.song, L = this.layer, i = step % 16, bar = Math.floor(step / 16);
    if (bar !== this.bar) { this.bar = bar; this.part = this.arrange(bar); }
    const p = this.part, { kind, e, chord, menu } = p;
    const drop = kind === "drop", build = kind === "build", brk = kind === "break", intro = kind === "intro";
    const beat = this.beatLen, six = beat / 4, x = (p.at + i / 16) / p.bars;
    const half = p.at >= p.bars / 2, big = drop && (p.drops >= 1 || L >= 4);
    const tok = (pat: string | undefined) => (pat ? pat[i] ?? "." : ".");
    const hold = (pat: ArrayLike<unknown>, j: number) => { let n = 1; while (pat[j + n] === "-") n++; return n; };

    // A section's one-shots, from wherever its first step played is (a run resumed mid-build still rises).
    if (p.n >= 0 && p.n !== this.cued) {
      this.cued = p.n;
      if (build) this.rise(t, t + (p.bars * 16 - (p.at * 16 + i)) * six, e);
    }
    if (i % 4 === 0) this.colour(p, (p.at + (i + 4) / 16) / p.bars, t, drop && p.at === 0 && i === 0);
    if (i === 0 && !menu) {
      if (drop && p.at === 0) this.impact(t, e);
      else if (drop && p.at % 8 === 0) this.crash(t, 0.45);
      else if (brk && p.at === 0) { this.crash(t, 0.4); this.fall(t, beat * 4); }
    }

    // ---- drums
    const fillBig = drop && (p.at % 8 === 7 || p.left === 1) && i >= 12;
    const fillSmall = drop && !fillBig && p.at % 4 === 3 && i >= 14;
    const k = tok(s.kick) === "x";
    const kv = drop ? (k && !fillBig ? 1 : 0)
      : build ? (k && !(p.left === 1 && (i >= 8 || e < 0.6)) ? 0.92 : 0)
      : intro ? (k && (half || e >= 0.4) && (e >= 0.4 || i % 8 === 0) ? (menu ? 0.55 : 0.8) : 0)
      : 0;
    if (kv) this.kick(t, kv, drop ? s.pump : build ? 0.5 : 0.65);

    if (drop) {
      const c = tok(s.snare);
      if (c === "x" && !(fillBig && i > 12)) this.snare(t, 1);
      else if (c === "g" && !fillBig) this.snare(t, 0.2);
      if (fillBig) {
        if (i < 14) this.tom(t, s.snareTone * (i === 12 ? 1.1 : 0.8), 0.7);
        else { this.snare(t, 0.55 + (i - 14) * 0.25); this.snare(t + six / 2, 0.6 + (i - 14) * 0.25); }
      } else if (fillSmall) this.snare(t, i === 14 ? 0.3 : 0.55);
    } else if (build && !(p.left === 1 && i === 15)) {
      // The roll: quarters, eighths, sixteenths, then thirty-seconds in the last bar, louder and higher as it goes.
      const every = [0, 0.5, 1, 2, 4][Math.min(4, p.left)];
      const vel = 0.16 + 0.62 * Math.pow(x, 1.6), pitch = 1 + 0.7 * x;
      if (every < 1) { this.snare(t, vel, pitch); this.snare(t + six / 2, vel * 0.85, pitch); }
      else if (i % every === 0) this.snare(t, vel, pitch);
    } else if (brk && !menu && e >= 0.45 && i === 8) this.snare(t, 0.4, 1, 0.9);

    const h = tok(s.hats);
    if (drop) {
      if (h !== ".") this.hat(t, h);
      else if ((e >= 0.95 || L >= 4) && i % 2 === 1) this.hat(t, "g");
      if ((big || L >= 3) && tok(s.ride) !== ".") this.ride(t, tok(s.ride) === "g" ? 0.35 : 1);
    } else if (build) {
      if (p.left === 1 ? i % 2 === 0 : h !== "." && (h !== "g" || x > 0.5)) this.hat(t, p.left === 1 ? "x" : h, 0.4 + 0.6 * x);
    } else if (intro) {
      if ((half || e >= 0.4) && i % 4 === 2) this.hat(t, menu ? "x" : "o", menu ? 0.5 : 0.75);
    } else if (brk && half && !menu && i % 4 === 2) this.hat(t, "x", 0.45);

    // ---- bass
    const b = tok(s.bass);
    const pattern = drop || (build && p.left > 1) || (intro && e >= 0.4 && half);
    if (pattern && b !== "." && b !== "-") {
      const n = hold(s.bass, i), f = freq(s, chord.root + (b === "o" ? 12 : b === "5" ? 7 : 0), s.bassOct);
      const wob = drop && s.wobble ? s.wobble[p.at % s.wobble.length] : 0;
      this.bass(t, f, n * six * 0.92, drop ? (L >= 4 ? 1 : 0.9) : 0.75, drop ? 1 : build ? 0.4 + 0.5 * x : 0.35, wob);
    } else if (i === 0 && !pattern && ((intro && half) || (brk && p.at % 2 === 0))) {
      // Under the calm sections, a long low root: the sub only, the floor of the chord.
      this.bass(t, freq(s, chord.root, s.bassOct), (brk ? 2 : 1) * this.barLen * 0.96, brk ? 0.42 : 0.55, 0);
    }

    // ---- chords
    if (i === 0 && (!brk || p.at % 2 === 0)) {
      const len = (brk ? 2 : 1) * this.barLen;
      const fs = chord.tones.map((d) => freq(s, d, s.padOct));
      if (drop) this.chords(t, fs, len, e, big);
      else this.pad(t, fs, len, menu ? 0.5 : build ? 0.3 + 0.2 * x : brk ? 0.34 : 0.42);
    }
    if (drop && s.stab && (e >= 0.9 || L >= 5) && tok(s.stab) === "x") this.stab(t, chord.tones.map((d) => freq(s, d, s.padOct + 1)), six * 2);

    // ---- arp: quiet in the drop (the counter-line, an octave up from the second), led by the filter elsewhere
    const a = tok(s.arp);
    if (a !== "." && (drop || build || (intro && half) || (brk && i % 2 === 0))) {
      const f = freq(s, tone(chord, Number(a)), s.arpOct + (big ? 1 : 0));
      const bright = drop ? 0.7 + 0.3 * e : build ? 0.25 + 0.75 * x : 0.25;
      this.pluck(t, f, six * (brk ? 3 : 1.6), drop ? (big ? 0.11 : 0.095) : menu ? 0.12 : 0.13, bright, i % 2 ? 0.35 : -0.35);
    }

    // ---- the hook: the supersaw in a drop, the bell elsewhere (half time in a break)
    if (drop) {
      const ph = s.hook[(p.at >> 1) % s.hook.length], j = (p.at % 2) * 16 + i, d = ph[j];
      if (typeof d === "number") {
        const len = hold(ph, j) * six;
        const voices = Math.min(9, s.leadVoices + (e >= 0.95 ? 2 : 0) + (L >= 4 ? 2 : 0));
        this.lead(t, freq(s, d, s.leadOct), len * 0.95, 0.22, voices, true);
        if (big) {
          this.lead(t, freq(s, diatonic(d, -2), s.leadOct), len * 0.95, 0.1, Math.max(2, voices - 2), false);
          this.bell(t, freq(s, d, s.leadOct + 1), Math.min(len * 2, 1), 0.05, 0.4);
        }
      }
    } else {
      const motif = intro || (build && p.at < 2 && p.left > 2) || brk;
      const slowed = brk ? 2 : 1, j = (p.at * 16 + i) / slowed;
      if (motif && j % 1 === 0) {
        const hb = Math.floor(j / 16) % (s.hook.length * 2), ph = s.hook[hb >> 1], jj = (hb % 2) * 16 + (j % 16), d = ph[jj];
        if (typeof d === "number") this.bell(t, freq(s, d, s.leadOct), Math.min(1.4, hold(ph, jj) * six * slowed * 1.4), menu ? 0.11 : 0.12, 0);
      }
    }
  }

  /** The section filter on the melodic bus: closed in the intro, sweeping open through a build, open in a drop, down in a break. */
  private colour(p: Part, x: number, t: number, snap: boolean) {
    const e = p.e;
    const hz = p.menu ? 9000
      : p.kind === "intro" ? 420 * Math.pow(2, x * 2.4) * (0.7 + e)
      : p.kind === "build" ? 650 * Math.pow(2, Math.min(1, x) * 4.7)
      : p.kind === "drop" ? 5000 + 13000 * e
      : (500 + 1000 * e) * Math.pow(2, Math.max(0, x - 1 + 1 / p.bars) * p.bars * 1.6);
    const f = this.color.frequency;
    if (snap) f.setValueAtTime(hz, t);
    else f.setTargetAtTime(Math.min(18000, hz), t, this.beatLen / 3);
  }

  // ---- instruments ----------------------------------------------------------------------------------------------------

  private keep<T extends AudioScheduledSourceNode>(n: T, end: number) { (n as unknown as { _end: number })._end = end; this.live.push(n); return n; }
  private env(g: GainNode, t: number, a: number, peak: number, d: number, sus: number, end: number, r: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(peak * sus, t + a, d / 3);
    g.gain.setTargetAtTime(0.0001, end, r / 4);
  }
  private osc(type: OscillatorType, f: number, t: number, end: number, out: AudioNode, detune = 0) {
    const o = this.ctx!.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune + this.bend;
    o.connect(out); o.start(t); o.stop(end);
    return this.keep(o, end);
  }
  /** Detuned voices spread across the stereo field: the supersaw. */
  private saws(type: OscillatorType, f: number, t: number, end: number, out: AudioNode, voices: number, spread: number, width = 0.8) {
    const os: OscillatorNode[] = [];
    for (let v = 0; v < voices; v++) {
      const k = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
      const pan = this.ctx!.createStereoPanner();
      pan.pan.value = k * width; pan.connect(out);
      // Spread unevenly (as a supersaw does) so the voices never beat in step.
      os.push(this.osc(type, f, t, end, pan, Math.sign(k) * Math.pow(Math.abs(k), 1.4) * spread));
    }
    return os;
  }
  private noiseAt(t: number, end: number, out: AudioNode, wide = false) {
    const n = this.ctx!.createBufferSource();
    n.buffer = wide ? this.wide : this.noise; n.loop = true;
    n.playbackRate.value = Math.pow(2, this.bend / 1200);
    n.connect(out); n.start(t, Math.random() * 0.9); n.stop(end);
    return this.keep(n, end);
  }
  private filter(type: BiquadFilterType, hz: number, q = 0.7) {
    const f = this.ctx!.createBiquadFilter();
    f.type = type; f.frequency.value = hz; f.Q.value = q;
    return f;
  }
  private pump(t: number, depth: number) {
    const g = this.duck.gain;
    g.setTargetAtTime(depth, t, 0.004);
    g.setTargetAtTime(1, t + 0.03, this.beatLen * 0.17);
  }

  private kick(t: number, vel: number, depth: number) {
    const ctx = this.ctx!, s = this.song, g = ctx.createGain(), o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(s.kickTone * 3.4, t);
    o.frequency.exponentialRampToValueAtTime(s.kickTone, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(s.kickTone * 0.8, t + 0.4);
    g.gain.setValueAtTime(0.62 * vel * s.kickDrive, t);
    g.gain.setTargetAtTime(0.0001, t + 0.06, s.kickTail);
    o.connect(g).connect(this.shaper);
    o.start(t); o.stop(t + 0.6); this.keep(o, t + 0.6);
    const c = ctx.createGain(), hp = this.filter("highpass", 2400);
    c.gain.setValueAtTime(0.3 * vel, t); c.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    this.noiseAt(t, t + 0.02, hp); hp.connect(c).connect(this.drums);
    this.pump(t, depth);
    this.hits.kick.push(t); this.trim("kick");
  }
  private snare(t: number, vel = 1, pitch = 1, room = 0.25) {
    const ctx = this.ctx!, s = this.song, g = ctx.createGain(), bp = this.filter("bandpass", (s.clap ? 1300 : 1900) * pitch, s.clap ? 1.1 : 0.7);
    if (s.clap && vel >= 0.5) {
      // A clap: three quick bursts and a tail, as hands that never quite land together.
      g.gain.setValueAtTime(0.0001, t);
      for (let k = 0; k < 3; k++) { g.gain.setValueAtTime(0.5 * vel, t + k * 0.009); g.gain.exponentialRampToValueAtTime(0.06 * vel, t + k * 0.009 + 0.008); }
      g.gain.setValueAtTime(0.42 * vel, t + 0.027); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    } else { g.gain.setValueAtTime(0.5 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2); }
    this.noiseAt(t, t + 0.24, bp, true); bp.connect(g).connect(this.drums);
    const sg = ctx.createGain(); sg.gain.value = room * vel;
    g.connect(sg).connect(this.verbSend);
    const body = ctx.createGain(), o = ctx.createOscillator(), f = s.snareTone * pitch;
    o.type = "triangle"; o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    body.gain.setValueAtTime((s.clap ? 0.3 : 0.5) * vel, t); body.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(body).connect(this.drums); o.start(t); o.stop(t + 0.15); this.keep(o, t + 0.15);
    if (vel >= 0.9) { this.hits.snare.push(t); this.trim("snare"); }
  }
  private tom(t: number, f: number, vel: number) {
    const ctx = this.ctx!, g = ctx.createGain(), o = ctx.createOscillator();
    o.type = "sine"; o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.2);
    g.gain.setValueAtTime(0.45 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.connect(g).connect(this.drums); g.connect(this.verbSend); o.start(t); o.stop(t + 0.3); this.keep(o, t + 0.3);
  }
  /** A hat by its token: x closed, o open, g a ghost. */
  private hat(t: number, kind: string, vel = 1) {
    const ctx = this.ctx!, g = ctx.createGain(), hp = this.filter("highpass", kind === "o" ? 7600 : 8600);
    const [len, v] = kind === "o" ? [0.2, 0.3] : kind === "g" ? [0.03, 0.14] : [0.045, 0.38];
    g.gain.setValueAtTime(v * vel * (0.85 + Math.random() * 0.3), t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    this.noiseAt(t, t + len + 0.02, hp, true); hp.connect(g).connect(this.drums);
    this.hits.hat.push(t); this.trim("hat");
  }
  private ride(t: number, vel: number) {
    const ctx = this.ctx!, g = ctx.createGain(), bp = this.filter("bandpass", 6800, 1.4);
    g.gain.setValueAtTime(0.1 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    this.noiseAt(t, t + 0.37, bp, true); bp.connect(g).connect(this.drums);
    const ring = ctx.createGain(); ring.gain.setValueAtTime(0.012 * vel, t); ring.gain.exponentialRampToValueAtTime(0.0005, t + 0.4);
    this.osc("square", 3150, t, t + 0.42, ring); this.osc("square", 4410, t, t + 0.42, ring);
    ring.connect(this.drums);
  }
  /** A bass note: saws through a resonant low-pass and a sub an octave under; `bright` 0 leaves the sub alone, `wobble` swings the filter. */
  private bass(t: number, f: number, len: number, vel: number, bright: number, wobble = 0) {
    const ctx = this.ctx!, s = this.song, end = t + len;
    const sub = ctx.createGain();
    this.env(sub, t, 0.005, 0.26 * vel, 0.2, 0.85, end, 0.06);
    this.osc("sine", f / 2, t, end + 0.1, sub);
    sub.connect(this.duck);
    if (!bright) return;
    const lp = this.filter("lowpass", 0, s.bassQ), g = ctx.createGain();
    const top = s.bassCut * (0.4 + 0.6 * bright) * (this.layer >= 3 ? 1.3 : 1);
    if (wobble) {
      // The filter swings at the bar's rate from a closed growl to open, in step with the grid.
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.type = "triangle"; lfo.frequency.value = (this.bpm / 60) * wobble;
      lp.frequency.value = top * 0.5; lg.gain.value = top * 0.42;
      lfo.connect(lg).connect(lp.frequency); lfo.start(t); lfo.stop(end + 0.1); this.keep(lfo, end + 0.1);
    } else {
      lp.frequency.setValueAtTime(top, t);
      lp.frequency.setTargetAtTime(top * 0.22, t + 0.01, Math.max(0.05, len * 0.45));
    }
    this.env(g, t, 0.004, (0.26 / Math.sqrt(s.bassVoices)) * vel, 0.2, 0.75, end, 0.05);
    this.saws(s.bassWave, f, t, end + 0.1, lp, s.bassVoices, s.bassSpread, 0.35);
    lp.connect(g).connect(this.duck);
  }
  /** The calm sections' pad: two soft saws a tone, a slow swell; the section filter does the rest. */
  private pad(t: number, fs: number[], len: number, vel: number) {
    const ctx = this.ctx!, lp = this.filter("lowpass", 2200), g = ctx.createGain();
    this.env(g, t, Math.min(0.6, len * 0.25), vel * 0.17, len * 0.5, 0.8, t + len * 0.95, 0.7);
    for (const f of fs) this.saws("sawtooth", f, t, t + len + 0.8, lp, 2, 14, 0.7);
    lp.connect(g); g.connect(this.duck); g.connect(this.verbSend);
  }
  /** The drop's chords: a supersaw a tone, struck, held and pumped by the kick. */
  private chords(t: number, fs: number[], len: number, e: number, big: boolean) {
    const ctx = this.ctx!, lp = this.filter("lowpass", 1800 + 3200 * e, 0.8), g = ctx.createGain();
    this.env(g, t, 0.012, 0.13, len * 0.6, 0.75, t + len * 0.97, 0.15);
    for (const f of fs) this.saws("sawtooth", f, t, t + len + 0.3, lp, big ? 3 : 2, 22, 0.9);
    lp.connect(g); g.connect(this.duck); g.connect(this.verbSend);
  }
  private pluck(t: number, f: number, len: number, vel: number, bright: number, pan: number) {
    const ctx = this.ctx!, lp = this.filter("lowpass", 0, 5), g = ctx.createGain(), p = ctx.createStereoPanner();
    lp.frequency.setValueAtTime(900 + 5200 * bright, t); lp.frequency.exponentialRampToValueAtTime(400, t + len);
    g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    this.osc(this.song.arpWave, f, t, t + len + 0.02, lp);
    p.pan.value = pan;
    lp.connect(g).connect(p); p.connect(this.duck); p.connect(this.delaySend);
  }
  /** The lead: a supersaw (or a few squares), a filter that blooms on the attack, vibrato that creeps in on a held note, a glide from a tied note. */
  private lead(t: number, f: number, len: number, vel: number, voices: number, main: boolean) {
    const ctx = this.ctx!, s = this.song, lp = this.filter("lowpass", 0, 1.2), g = ctx.createGain(), end = t + len;
    lp.frequency.setValueAtTime(s.leadCut * 0.3, t); lp.frequency.exponentialRampToValueAtTime(s.leadCut, t + 0.03);
    lp.frequency.setTargetAtTime(s.leadCut * 0.65, t + 0.05, len);
    this.env(g, t, 0.008, vel / Math.sqrt(voices), 0.3, 0.8, end, 0.12);
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 5.5;
    vg.gain.setValueAtTime(0, t); vg.gain.setValueAtTime(0, t + Math.min(0.25, len * 0.6)); vg.gain.linearRampToValueAtTime(f * 0.011, end + 0.01);
    vib.connect(vg); vib.start(t); vib.stop(end + 0.2); this.keep(vib, end + 0.2);
    const tied = main && s.glide > 0 && this.lastLead.f && t - this.lastLead.end < this.beatLen / 3;
    for (const o of this.saws(s.leadWave, f, t, end + 0.2, lp, voices, s.leadSpread)) {
      vg.connect(o.frequency);
      if (tied) { o.frequency.setValueAtTime(this.lastLead.f, t); o.frequency.exponentialRampToValueAtTime(f, t + s.glide); }
    }
    if (main) this.lastLead = { f, end };
    lp.connect(g); g.connect(this.duck); g.connect(this.delaySend); g.connect(this.verbSend);
  }
  /** An FM bell: glassy on the strike, softening as it rings; the hook in the calm sections, the chimes. Dry, it skips the section filter (the motif must read through a closed intro); its echoes do not. */
  private bell(t: number, f: number, len: number, vel: number, pan: number, ratio = 3, out: AudioNode = this.bus) {
    const ctx = this.ctx!, g = ctx.createGain(), mg = ctx.createGain(), p = ctx.createStereoPanner(), end = t + len;
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.15, t + Math.min(0.5, len));
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, end);
    this.osc("sine", f * ratio, t, end + 0.05, mg);
    mg.connect(this.osc("sine", f, t, end + 0.05, g).frequency);
    p.pan.value = pan;
    g.connect(p); p.connect(out); p.connect(this.delaySend); p.connect(this.verbSend);
  }
  private stab(t: number, fs: number[], len: number) {
    const ctx = this.ctx!, lp = this.filter("lowpass", 0, 2), g = ctx.createGain();
    lp.frequency.setValueAtTime(6000, t); lp.frequency.exponentialRampToValueAtTime(700, t + len);
    g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + len * 1.4);
    for (const f of fs) this.saws("sawtooth", f, t, t + len * 1.5, lp, 2, 16, 0.6);
    lp.connect(g); g.connect(this.duck); g.connect(this.verbSend);
  }
  private trim(h: Hit) { const xs = this.hits[h]; if (xs.length > 16) xs.splice(0, xs.length - 16); }

  // ---- transitions ----------------------------------------------------------------------------------------------------

  /** Into a drop (or a queued song) from `t` to `end`: a noise riser sweeping up, a saw climbing two octaves, a reversed cymbal over the last bar. */
  private rise(t: number, end: number, e: number) {
    const ctx = this.ctx!, len = end - t, s = this.song;
    const bp = this.filter("bandpass", 0, 0.9), g = ctx.createGain();
    bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(9000, end);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09 + 0.08 * e, end - 0.01); g.gain.linearRampToValueAtTime(0, end);
    this.noiseAt(t, end, bp, true); bp.connect(g).connect(this.bus); g.connect(this.verbSend);
    if (e >= 0.6) {
      const lp = this.filter("lowpass", 0, 3), ug = ctx.createGain(), f = freq(s, 0, 3);
      lp.frequency.setValueAtTime(600, t); lp.frequency.exponentialRampToValueAtTime(7000, end);
      ug.gain.setValueAtTime(0.0001, t); ug.gain.exponentialRampToValueAtTime(0.035, end - 0.01); ug.gain.linearRampToValueAtTime(0, end);
      for (const o of this.saws("sawtooth", f, t, end, lp, 2, 18, 0.8)) o.frequency.exponentialRampToValueAtTime(f * 4, end);
      lp.connect(ug); ug.connect(this.bus); ug.connect(this.delaySend);
    }
    const from = Math.max(t, end - Math.min(this.barLen, len));
    const hp = this.filter("highpass", 5000), rg = ctx.createGain();
    rg.gain.setValueAtTime(0.0005, from); rg.gain.exponentialRampToValueAtTime(0.22, end - 0.005); rg.gain.linearRampToValueAtTime(0, end);
    this.noiseAt(from, end, hp, true); hp.connect(rg).connect(this.drums); rg.connect(this.verbSend);
  }
  /** Out of a drop: noise sweeping down. */
  private fall(t: number, len: number) {
    const ctx = this.ctx!, bp = this.filter("bandpass", 0, 1), g = ctx.createGain();
    bp.frequency.setValueAtTime(7000, t); bp.frequency.exponentialRampToValueAtTime(300, t + len);
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    this.noiseAt(t, t + len, bp, true); bp.connect(g).connect(this.bus); g.connect(this.verbSend);
  }
  private crash(t: number, vel: number) {
    const ctx = this.ctx!, hp = this.filter("highpass", 4200), g = ctx.createGain();
    g.gain.setValueAtTime(0.32 * vel, t); g.gain.setTargetAtTime(0.0001, t + 0.02, 0.55);
    this.noiseAt(t, t + 2.6, hp, true); hp.connect(g).connect(this.drums); g.connect(this.verbSend);
  }
  /** A drop's first downbeat: the crash, a sub boom falling away under the kick. */
  private impact(t: number, e: number) {
    this.crash(t, 0.7 + 0.3 * e);
    const ctx = this.ctx!, g = ctx.createGain(), o = this.osc("sine", 0, t, t + 1.4, g);
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.9);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.45 * (0.6 + 0.4 * e), t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    g.connect(this.drums);
  }

  // ---- effects --------------------------------------------------------------------------------------------------------

  /** A one-shot, at once (or at `at`, audio time); `amount` 0..1 is how strong (a graze's closeness). */
  sfx(kind: Sfx, amount = 1, at?: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = at ?? ctx.currentTime + 0.005, out = this.sfxBus, s = this.song;
    const sweep = (type: OscillatorType, f0: number, f1: number, len: number, vol: number, dest: AudioNode = out) => {
      const g = ctx.createGain(), o = ctx.createOscillator();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + len);
      o.connect(g).connect(dest); o.start(t); o.stop(t + len + 0.02);
      return g;
    };
    const hiss = (f0: number, f1: number, len: number, vol: number, attack = 0.005, type: BiquadFilterType = "bandpass", q = 1.2) => {
      const bp = ctx.createBiquadFilter(), g = ctx.createGain(), n = ctx.createBufferSource();
      bp.type = type; bp.Q.value = q; bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + len);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + len);
      n.buffer = this.noise; n.loop = true; n.connect(bp).connect(g).connect(out); n.start(t); n.stop(t + len + 0.02);
      return g;
    };
    const home = s.prog[0].tones, chord = this.part?.chord ?? s.prog[0];
    switch (kind) {
      case "death": {
        sweep("sine", 160, 28, 1.1, 1.0);
        sweep("sawtooth", 420, 40, 0.5, 0.25);
        sweep("square", 1800, 90, 0.28, 0.09);
        hiss(5200, 300, 1.4, 0.55, 0.003, "lowpass").connect(this.verbSend);
        // A glitch: a few hard square blips, as if the tape caught.
        for (let k = 0; k < 5; k++) {
          const o = ctx.createOscillator(), gg = ctx.createGain(), at2 = t + 0.04 + k * 0.045;
          o.type = "square"; o.frequency.value = 200 + Math.random() * 1600;
          gg.gain.setValueAtTime(0.06, at2); gg.gain.setValueAtTime(0, at2 + 0.025);
          o.connect(gg).connect(out); o.start(at2); o.stop(at2 + 0.03);
        }
        break;
      }
      case "rank": {
        home.concat([home[0] + 12]).forEach((d, k) => {
          const o = ctx.createOscillator(), g = ctx.createGain(), at2 = t + k * 0.035;
          o.type = "sawtooth"; o.frequency.value = freq(s, d, 5);
          const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(7000, at2); lp.frequency.exponentialRampToValueAtTime(900, at2 + 0.8);
          g.gain.setValueAtTime(0.075, at2); g.gain.exponentialRampToValueAtTime(0.0008, at2 + 1.1);
          o.connect(lp).connect(g).connect(out); g.connect(this.verbSend); g.connect(this.delaySend); o.start(at2); o.stop(at2 + 1.2);
        });
        hiss(9000, 2000, 1.6, 0.22, 0.005, "highpass").connect(this.verbSend);
        sweep("sine", 110, 40, 0.5, 0.6);
        break;
      }
      case "record": {
        [0, 1, 2, 3, 4, 5].forEach((k) => {
          const d = home[k % 3] + 12 * Math.floor(k / 3), o = ctx.createOscillator(), g = ctx.createGain(), at2 = t + k * 0.06;
          o.type = "square"; o.frequency.value = freq(s, d, 5);
          g.gain.setValueAtTime(0.05, at2); g.gain.exponentialRampToValueAtTime(0.0008, at2 + 0.35);
          o.connect(g).connect(out); g.connect(this.delaySend); o.start(at2); o.stop(at2 + 0.4);
        });
        break;
      }
      case "graze": {
        // A zing in the chord of the moment, a step up it for each graze in a quick run (to two octaves up); softer when they crowd.
        const a = Math.max(0, Math.min(1, amount)), gap = t - this.graze.at;
        if (gap < 0.045) break;
        this.graze = { at: t, n: gap < 0.6 ? this.graze.n + 1 : 0 };
        const f = freq(s, tone(chord, Math.min(7, this.graze.n)), 5), crowd = gap < 0.15 ? 0.6 : 1, vol = (0.025 + 0.06 * a) * crowd;
        const p = ctx.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 0.8; p.connect(out); p.connect(this.delaySend);
        const g = ctx.createGain(), o = ctx.createOscillator(), o2 = ctx.createOscillator();
        o.type = "triangle"; o.frequency.setValueAtTime(f * 0.97, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.02);
        o2.type = "sine"; o2.frequency.value = f * 2.005;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.09 + 0.12 * a);
        o.connect(g); o2.connect(g); g.connect(p);
        o.start(t); o2.start(t); o.stop(t + 0.25); o2.stop(t + 0.25);
        hiss(5500 + 2500 * a, 9000, 0.05 + 0.04 * a, vol * 0.7, 0.002, "bandpass", 3).connect(p);
        break;
      }
      case "medal": {
        // Up the relative major's triad and land on it, held, with a shimmer: a fanfare in the song's key.
        [3, 7, 10, 15].forEach((d, k) => {
          const at2 = t + k * 0.075, o = ctx.createOscillator(), g = ctx.createGain();
          o.type = "square"; o.frequency.value = freq(s, d, 5);
          g.gain.setValueAtTime(0.045, at2); g.gain.exponentialRampToValueAtTime(0.0008, at2 + 0.22);
          o.connect(g).connect(out); g.connect(this.delaySend); o.start(at2); o.stop(at2 + 0.25);
          this.bell(at2, freq(s, d, 6), 0.5, 0.04, (k - 1.5) * 0.3, 3, out);
        });
        const at2 = t + 0.3, lp = this.filter("lowpass", 0, 1), g = ctx.createGain();
        lp.frequency.setValueAtTime(6500, at2); lp.frequency.exponentialRampToValueAtTime(1200, at2 + 1.2);
        g.gain.setValueAtTime(0.0001, at2); g.gain.linearRampToValueAtTime(0.06, at2 + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, at2 + 1.3);
        for (const d of [3, 7, 10, 15]) this.saws("sawtooth", freq(s, d, 4), at2, at2 + 1.35, lp, 3, 20, 0.9);
        lp.connect(g).connect(out); g.connect(this.verbSend);
        hiss(4000, 12000, 1, 0.08, 0.3, "highpass").connect(this.verbSend);
        break;
      }
      case "ghost":
        // Barely there: a fifth and an octave rung softly, far back in the room.
        this.bell(t, freq(s, home[2] ?? 7, 6), 0.9, 0.03, -0.3, 3.5, out);
        this.bell(t + 0.09, freq(s, 12, 6), 1.1, 0.025, 0.3, 3.5, out);
        break;
      case "replay": {
        // A tape slowing: everything sinks and dulls at once.
        sweep("sine", 420, 45, 1.1, 0.3);
        sweep("sawtooth", 210, 30, 0.9, 0.05);
        hiss(7000, 250, 1.2, 0.3, 0.02, "lowpass", 4);
        break;
      }
      case "start": sweep("sine", 90, 38, 0.6, 0.8); hiss(800, 9000, 0.35, 0.2, 0.3, "bandpass"); break;
      case "flip": hiss(400, 2400, 0.25, 0.05, 0.2); break;
      case "move": sweep("triangle", 1250, 900, 0.06, 0.12); break;
      case "select": sweep("sine", 220, 880, 0.18, 0.25); hiss(1200, 6000, 0.3, 0.12, 0.15); break;
      case "back": sweep("sine", 700, 260, 0.14, 0.18); break;
      case "open": hiss(300, 7000, 0.9, 0.18, 0.7, "bandpass"); sweep("sine", 55, 55, 1.4, 0.3); break;
    }
  }
}

export const music = new Music();
