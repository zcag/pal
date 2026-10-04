// Vortex's sound: every note is synthesised here, so the music is the game's
// clock. A sequencer reads a song (songs.ts) a sixteenth at a time and
// schedules each note a little ahead on the AudioContext; the run's time is
// that same clock (as heard: minus the output latency), so a wall lands on
// the beat you hear and the world pumps with the kick you hear.
//
// The mix: drums dry; bass, chords, arp and lead on a bus the kick ducks
// (the pump); sends to a long reverb and a dotted-eighth delay; one master
// low-pass that muffles the music on the menus and closes like a tape stop
// when you die. Layers come in as a run climbs the ranks.
import { SONGS, chordTones, freq, type Song } from "./songs.ts";

type Hit = "kick" | "snare" | "hat";

export class Music {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private muffle!: BiquadFilterNode;
  private duck!: GainNode;
  private drums!: GainNode;
  private sfxBus!: GainNode;
  private verb!: ConvolverNode;
  private delay!: DelayNode;
  private verbSend!: GainNode;
  private delaySend!: GainNode;
  private noise!: AudioBuffer;
  private shaper!: WaveShaperNode;

  song: Song = SONGS.pulse;
  /** Audio time of step 0, and the next step to schedule. */
  private anchor = 0;
  private nextStep = 0;
  /** -1: the menus (sparse, muffled); 0..5: a run's rank. */
  layer = -1;
  private live: AudioScheduledSourceNode[] = [];
  private hits: Record<Hit, number[]> = { kick: [], snare: [], hat: [] };
  volume = 0.8;
  muted = false;
  private t0 = performance.now();

  /** Starts sound; must follow a key press the first time. */
  start() {
    if (!this.ctx) this.boot();
    if (this.ctx!.state === "suspended") this.ctx!.resume();
  }
  suspend() { this.ctx?.suspend(); }

  private boot() {
    const ctx = (this.ctx = new AudioContext({ latencyHint: "interactive" }));
    this.master = ctx.createGain();
    this.applyVolume();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -2; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.05;
    this.master.connect(comp).connect(limit).connect(ctx.destination);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = "lowpass"; this.muffle.frequency.value = 1800; this.muffle.Q.value = 0.9;
    this.muffle.connect(this.master);
    this.duck = ctx.createGain(); this.duck.connect(this.muffle);
    this.drums = ctx.createGain(); this.drums.connect(this.muffle);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.8, 2.6);
    const verbHp = ctx.createBiquadFilter(); verbHp.type = "highpass"; verbHp.frequency.value = 300;
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 0.32;
    this.verbSend.connect(verbHp).connect(this.verb).connect(this.muffle);

    this.delay = ctx.createDelay(2);
    const fb = ctx.createGain(); fb.gain.value = 0.34;
    const dlp = ctx.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 2600;
    this.delaySend = ctx.createGain(); this.delaySend.gain.value = 0.22;
    this.delaySend.connect(this.delay).connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(this.duck);

    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 1.7) / Math.tanh(1.7); }
    this.shaper.curve = curve;
    this.shaper.connect(this.drums);
    this.setSong(this.song, true);
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!, len = Math.floor(ctx.sampleRate * seconds), b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
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
  get beatLen() { return 60 / this.song.bpm; }
  /** Beats since the anchor, as heard. */
  beats(at = this.now()) { return (at - this.anchor) / this.beatLen; }
  /** Seconds since the last kick (or snare, hat) you heard. */
  since(h: Hit, at = this.now()) {
    const xs = this.hits[h];
    for (let i = xs.length - 1; i >= 0; i--) if (xs[i] <= at) return at - xs[i];
    return 9;
  }

  /** Moves the song's step 0 to just ahead of now (a run starts on its downbeat); answers that time, as heard. */
  restart(lead = 0.06) {
    for (const n of this.live) try { n.stop(); } catch { /* already stopped */ }
    this.live = [];
    this.anchor = (this.running ? this.ctx!.currentTime : this.now()) + lead;
    this.nextStep = 0;
    for (const h of Object.values(this.hits)) h.length = 0;
    return this.anchor;
  }

  /** Puts step 0 at `zero` (a run resumed mid-way), carrying on from the step due now. */
  align(zero: number) {
    this.anchor = zero;
    if (this.running) this.nextStep = Math.max(0, Math.ceil((this.ctx!.currentTime - zero) / (this.beatLen / 4)));
  }

  setSong(song: Song, restart = false) {
    const changed = song !== this.song;
    this.song = song;
    this.delay?.delayTime.setValueAtTime((60 / song.bpm) * 0.75, this.ctx?.currentTime ?? 0);
    if ((changed || restart) && this.ctx) this.restart(0.05);
  }

  /** Opens or closes the music's filter: runs open, menus muffled, death closes it. */
  open(hz: number, seconds = 0.25) {
    if (!this.ctx) return;
    const p = this.muffle.frequency, t = this.ctx.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.exponentialRampToValueAtTime(Math.max(60, hz), t + seconds);
  }

  // ---- the sequencer --------------------------------------------------------------------------------------------------

  /** Called every frame: schedules every sixteenth up to a little ahead. */
  tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const sixteenth = this.beatLen / 4, horizon = ctx.currentTime + 0.14;
    // After a long stall (a hidden panel), skip what is past rather than play it all at once.
    const due = Math.floor((ctx.currentTime - this.anchor) / sixteenth);
    if (due > this.nextStep + 4) this.nextStep = due;
    while (this.anchor + this.nextStep * sixteenth < horizon) {
      this.play(this.nextStep, this.anchor + this.nextStep * sixteenth);
      this.nextStep++;
    }
    this.live = this.live.filter((n) => (n as unknown as { _end: number })._end > ctx.currentTime);
  }

  private play(step: number, t: number) {
    const s = this.song, L = this.layer, menu = L < 0;
    const bar = Math.floor(step / 16), i = step % 16;
    const bars = s.chords.length;
    const chord = s.chords[bar % bars];
    const sixteenth = this.beatLen / 4;
    // Every eighth bar of a run ends in a fill: the snare rolls, the kick holds off.
    const fill = !menu && L >= 1 && bar % 8 === 7 && i >= 12;
    const on = (pat: string | undefined) => !!pat && pat[i] !== "." && pat[i] !== undefined;

    if (!menu || s.menuBeat) {
      if (on(s.kick) && !fill) this.kick(t, s.kickTone);
      if (L >= 1 && on(s.snare)) this.snare(t, s.snareTone);
      if (fill && (i % 2 === 0 || L >= 4)) this.snare(t, s.snareTone, 0.35 + (i - 12) * 0.12);
      if (L >= 0 && on(L >= 4 && s.hats2 ? s.hats2 : s.hats)) this.hat(t, s.hats[i] === "o" ? 0.22 : 0.05, i % 4 === 2 ? 0.5 : 0.32);
      if (L >= 3 && on(s.ride)) this.hat(t, 0.4, 0.14, 7000);
    }
    if (on(s.bass) && (!menu || s.menuBass)) {
      const tok = s.bass[i];
      const root = chord + (tok === "o" ? 7 : tok === "5" ? 4 : 0);
      const len = Math.max(1, (s.bass.slice(i + 1).match(/^-*/)?.[0].length ?? 0) + 1) * sixteenth;
      this.bass(t, freq(s, root, s.bassOct), len * 0.9, L >= 4 ? 1 : 0.8);
    }
    if (i === 0) this.pad(t, chordTones(s, chord).map((d) => freq(s, d, 3)), this.beatLen * 4, menu ? 0.5 : 0.32);
    if ((L >= 1 || menu) && s.arp && s.arp[i] !== ".") {
      const tones = chordTones(s, chord), k = Number(s.arp[i]);
      const d = tones[k % 3] + (k >= 3 ? 7 : 0);
      this.pluck(t, freq(s, d, s.arpOct), sixteenth * 1.6, menu ? 0.08 : 0.12);
    }
    if (L >= 2 && s.lead.length) {
      const phrase = s.lead[(bar >> 1) % s.lead.length];
      const tok = phrase[(bar % 2) * 16 + i];
      if (tok !== undefined && tok !== "." && tok !== "-") {
        let n = 1;
        while (phrase[(bar % 2) * 16 + i + n] === "-") n++;
        const deg = Number(tok);
        this.lead(t, freq(s, deg, s.leadOct), n * sixteenth * 0.95, L >= 3 ? 0.12 : 0.11, L >= 3);
      }
    }
    if (L >= 5 && i % 8 === 0 && s.stabs) this.stab(t, chordTones(s, chord).map((d) => freq(s, d, 4)), sixteenth * 2);
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
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    o.connect(out); o.start(t); o.stop(end);
    return this.keep(o, end);
  }
  private noiseAt(t: number, end: number, out: AudioNode) {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noise; n.loop = true;
    n.connect(out); n.start(t, Math.random() * 0.9); n.stop(end);
    return this.keep(n, end);
  }
  private pump(t: number) {
    const g = this.duck.gain;
    g.setTargetAtTime(this.song.pump, t, 0.004);
    g.setTargetAtTime(1, t + 0.03, this.beatLen * 0.16);
  }

  private kick(t: number, tone: number) {
    const ctx = this.ctx!, g = ctx.createGain(), o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(tone * 3.4, t);
    o.frequency.exponentialRampToValueAtTime(tone, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(tone * 0.8, t + 0.4);
    g.gain.setValueAtTime(0.62, t);
    g.gain.setTargetAtTime(0.0001, t + 0.06, 0.055);
    o.connect(g).connect(this.shaper);
    o.start(t); o.stop(t + 0.6); this.keep(o, t + 0.6);
    const c = ctx.createGain(), hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 2400;
    c.gain.setValueAtTime(0.35, t); c.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    this.noiseAt(t, t + 0.02, hp); hp.connect(c).connect(this.drums);
    this.pump(t);
    this.hits.kick.push(t); this.trim("kick");
  }
  private snare(t: number, tone: number, vel = 1) {
    const ctx = this.ctx!;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1900; bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    this.noiseAt(t, t + 0.25, bp); bp.connect(g).connect(this.drums);
    const sg = ctx.createGain(); sg.gain.value = 0.25 * vel;
    g.connect(sg).connect(this.verbSend);
    const body = ctx.createGain(), o = ctx.createOscillator();
    o.type = "triangle"; o.frequency.setValueAtTime(tone * 1.6, t); o.frequency.exponentialRampToValueAtTime(tone, t + 0.05);
    body.gain.setValueAtTime(0.5 * vel, t); body.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(body).connect(this.drums); o.start(t); o.stop(t + 0.15); this.keep(o, t + 0.15);
    if (vel >= 1) { this.hits.snare.push(t); this.trim("snare"); }
  }
  private hat(t: number, len: number, vel: number, hz = 8200) {
    const ctx = this.ctx!, hp = ctx.createBiquadFilter(), g = ctx.createGain();
    hp.type = "highpass"; hp.frequency.value = hz;
    g.gain.setValueAtTime(vel * 1.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    this.noiseAt(t, t + len + 0.02, hp); hp.connect(g).connect(this.drums);
    this.hits.hat.push(t); this.trim("hat");
  }
  private bass(t: number, f: number, len: number, vel: number) {
    const ctx = this.ctx!, s = this.song, lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass"; lp.Q.value = s.bassQ;
    const top = s.bassCut * (this.layer >= 3 ? 1.5 : 1);
    lp.frequency.setValueAtTime(top, t);
    lp.frequency.setTargetAtTime(top * 0.25, t + 0.01, len * 0.5);
    if (s.wobble) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = (s.bpm / 60) * s.wobble; lg.gain.value = top * 0.7;
      lfo.connect(lg).connect(lp.frequency); lfo.start(t); lfo.stop(t + len + 0.1); this.keep(lfo, t + len + 0.1);
    }
    this.env(g, t, 0.004, 0.2 * vel, 0.2, 0.7, t + len, 0.05);
    this.osc("sawtooth", f, t, t + len + 0.1, lp, -8);
    this.osc("sawtooth", f, t, t + len + 0.1, lp, 8);
    lp.connect(g).connect(this.duck);
    const sub = ctx.createGain();
    this.env(sub, t, 0.004, 0.15 * vel, 0.2, 0.8, t + len, 0.05);
    this.osc("sine", f / 2, t, t + len + 0.1, sub);
    sub.connect(this.duck);
  }
  private pad(t: number, fs: number[], len: number, vel: number) {
    const ctx = this.ctx!, lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = this.layer >= 4 ? 2400 : 1300;
    this.env(g, t, len * 0.18, vel * 0.14, len * 0.5, 0.7, t + len * 0.92, 0.6);
    for (const f of fs) for (const d of [-11, 11]) this.osc("sawtooth", f, t, t + len + 0.8, lp, d);
    lp.connect(g);
    g.connect(this.duck);
    g.connect(this.verbSend);
  }
  private pluck(t: number, f: number, len: number, vel: number) {
    const ctx = this.ctx!, lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass"; lp.Q.value = 6;
    lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(500, t + len);
    g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    this.osc(this.song.arpWave, f, t, t + len + 0.02, lp);
    lp.connect(g); g.connect(this.duck); g.connect(this.delaySend);
  }
  private lead(t: number, f: number, len: number, vel: number, wide: boolean) {
    const ctx = this.ctx!, lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass"; lp.Q.value = 2;
    lp.frequency.setValueAtTime(800, t); lp.frequency.exponentialRampToValueAtTime(this.song.leadCut, t + 0.04);
    lp.frequency.setTargetAtTime(this.song.leadCut * 0.5, t + 0.05, len);
    this.env(g, t, 0.01, vel, 0.3, 0.75, t + len, 0.12);
    // Vibrato creeps in on a held note.
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = 5.5;
    vg.gain.setValueAtTime(0, t); vg.gain.setValueAtTime(0, t + Math.min(0.25, len * 0.6)); vg.gain.linearRampToValueAtTime(f * 0.012, t + len + 0.01);
    vib.connect(vg); vib.start(t); vib.stop(t + len + 0.2); this.keep(vib, t + len + 0.2);
    const det = wide ? [-18, -9, 0, 9, 18] : [-7, 7];
    for (const d of det) vg.connect(this.osc(this.song.leadWave, f, t, t + len + 0.2, lp, d).frequency);
    if (wide) this.osc("square", f / 2, t, t + len + 0.2, lp, 0);
    lp.connect(g); g.connect(this.duck); g.connect(this.delaySend); g.connect(this.verbSend);
  }
  private stab(t: number, fs: number[], len: number) {
    const ctx = this.ctx!, lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.setValueAtTime(6000, t); lp.frequency.exponentialRampToValueAtTime(700, t + len);
    g.gain.setValueAtTime(0.07, t); g.gain.exponentialRampToValueAtTime(0.001, t + len * 1.4);
    for (const f of fs) for (const d of [-12, 12]) this.osc("sawtooth", f, t, t + len * 1.5, lp, d);
    lp.connect(g); g.connect(this.duck); g.connect(this.verbSend);
  }
  private trim(h: Hit) { const xs = this.hits[h]; if (xs.length > 16) xs.splice(0, xs.length - 16); }

  // ---- effects --------------------------------------------------------------------------------------------------------

  /** A one-shot, at once (or at `at`, audio time). */
  sfx(kind: "death" | "rank" | "record" | "move" | "select" | "start" | "flip" | "back" | "open", at?: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t = at ?? ctx.currentTime + 0.005, out = this.sfxBus;
    const tone = (type: OscillatorType, f0: number, f1: number, len: number, vol: number, dest: AudioNode = out) => {
      const g = ctx.createGain(), o = ctx.createOscillator();
      o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + len);
      o.connect(g).connect(dest); o.start(t); o.stop(t + len + 0.02);
    };
    const hiss = (f0: number, f1: number, len: number, vol: number, attack = 0.005, type: BiquadFilterType = "bandpass") => {
      const bp = ctx.createBiquadFilter(), g = ctx.createGain(), n = ctx.createBufferSource();
      bp.type = type; bp.Q.value = 1.2; bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + len);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + len);
      n.buffer = this.noise; n.loop = true; n.connect(bp).connect(g).connect(out); n.start(t); n.stop(t + len + 0.02);
      return g;
    };
    switch (kind) {
      case "death": {
        tone("sine", 160, 28, 1.1, 1.0);
        tone("sawtooth", 420, 40, 0.5, 0.25);
        tone("square", 1800, 90, 0.28, 0.09);
        const g = hiss(5200, 300, 1.4, 0.55, 0.003, "lowpass");
        g.connect(this.verbSend);
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
        const s = this.song, tones = chordTones(s, 0);
        tones.concat([tones[0] + 7]).forEach((d, k) => {
          const o = ctx.createOscillator(), g = ctx.createGain(), at2 = t + k * 0.035;
          o.type = "sawtooth"; o.frequency.value = freq(s, d, 5);
          const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(7000, at2); lp.frequency.exponentialRampToValueAtTime(900, at2 + 0.8);
          g.gain.setValueAtTime(0.09, at2); g.gain.exponentialRampToValueAtTime(0.0008, at2 + 1.1);
          o.connect(lp).connect(g).connect(out); g.connect(this.verbSend); g.connect(this.delaySend); o.start(at2); o.stop(at2 + 1.2);
        });
        hiss(9000, 2000, 1.6, 0.22, 0.005, "highpass").connect(this.verbSend);
        tone("sine", 110, 40, 0.5, 0.6);
        break;
      }
      case "record": {
        const s = this.song, tones = chordTones(s, 0);
        [0, 1, 2, 3, 4, 5].forEach((k) => {
          const d = tones[k % 3] + 7 * Math.floor(k / 3), o = ctx.createOscillator(), g = ctx.createGain(), at2 = t + k * 0.06;
          o.type = "square"; o.frequency.value = freq(s, d, 5);
          g.gain.setValueAtTime(0.05, at2); g.gain.exponentialRampToValueAtTime(0.0008, at2 + 0.35);
          o.connect(g).connect(out); g.connect(this.delaySend); o.start(at2); o.stop(at2 + 0.4);
        });
        break;
      }
      case "start": tone("sine", 90, 38, 0.6, 0.8); hiss(800, 9000, 0.35, 0.2, 0.3, "bandpass"); break;
      case "flip": hiss(400, 2400, 0.25, 0.05, 0.2); break;
      case "move": tone("triangle", 1250, 900, 0.06, 0.12); break;
      case "select": tone("sine", 220, 880, 0.18, 0.25); hiss(1200, 6000, 0.3, 0.12, 0.15); break;
      case "back": tone("sine", 700, 260, 0.14, 0.18); break;
      case "open": hiss(300, 7000, 0.9, 0.18, 0.7, "bandpass"); tone("sine", 55, 55, 1.4, 0.3); break;
    }
  }
}

export const music = new Music();
