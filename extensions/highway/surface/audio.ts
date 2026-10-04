// Sound: WebAudio over audio/manifest.json. The engine is loops recorded at
// fixed rpm: the two either side of the current rpm play together, pitched to
// it and crossfaded (equal power), once for the on-throttle recordings and
// once for the off-throttle ones where a set has them, the two blended by the
// throttle. Loops play between their loopStart/loopEnd (the files are padded so
// every decoder stays seamless). Road, wind, rain and the tyres are loops whose
// level the game sets each frame; everything else is a one-shot.

type File = { file: string; kind: "engine" | "sfx" | "music"; loop?: boolean; set?: string; load?: "on" | "off"; rpm?: number; loopStart?: number; loopEnd?: number };
type Layer = { rpm: number; src: AudioBufferSourceNode; gain: GainNode };

const nameOf = (f: File) => f.file.replace(/^.*\//, "").replace(/\.mp3$/, "");

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private files: File[] = [];
  private buffers = new Map<string, AudioBuffer>();
  private engine: { on: Layer[]; off: Layer[]; onBus: GainNode; offBus: GainNode; out: GainNode; filter: BiquadFilterNode } | null = null;
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private song: AudioBufferSourceNode | null = null;
  volume = 1;
  musicVolume = 0.45;

  constructor(private base = "./audio/") {}

  private ready = false;
  private starting: Promise<void> | null = null;

  /** Must follow a user gesture (a key press) the first time. Nothing plays until it has finished. */
  start() {
    if (this.ready) { if (this.ctx!.state === "suspended") this.ctx!.resume(); return Promise.resolve(); }
    return (this.starting ??= this.boot());
  }

  private async boot() {
    const ctx = new AudioContext();
    const m = await fetch(`${this.base}manifest.json`).then((r) => r.json());
    this.files = m.files;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.connect(this.master);
    this.music = ctx.createGain(); this.music.gain.value = this.musicVolume; this.music.connect(this.master);
    this.ctx = ctx;
    await Promise.all(this.files.filter((f) => f.kind !== "music").map((f) => this.buffer(f.file)));
    this.ready = true;
    if (this.wantEngine) this.setEngine(this.wantEngine);
  }
  private wantEngine = "";

  private async buffer(file: string) {
    let b = this.buffers.get(file);
    if (!b) {
      const data = await fetch(this.base + file).then((r) => r.arrayBuffer());
      b = await this.ctx!.decodeAudioData(data);
      this.buffers.set(file, b);
    }
    return b;
  }

  private source(f: File, out: AudioNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.get(f.file)!;
    if (f.loop) {
      src.loop = true;
      src.loopStart = f.loopStart ?? 0;
      src.loopEnd = f.loopEnd ?? src.buffer.duration;
    }
    src.connect(out);
    src.start(0, f.loop ? (f.loopStart ?? 0) + Math.random() * ((f.loopEnd ?? 1) - (f.loopStart ?? 0)) : 0);
    return src;
  }

  /** The engine for a set ("sedan", "sport", "muscle", "gt", "super"); one with no recordings plays "sport". */
  setEngine(set: string) {
    this.wantEngine = set;
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    if (!this.files.some((f) => f.kind === "engine" && f.set === set)) set = "sport";
    if (this.engine) { for (const l of [...this.engine.on, ...this.engine.off]) l.src.stop(); this.engine.out.disconnect(); }
    const filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.Q.value = 0.5;
    const out = ctx.createGain(); out.gain.value = 0;
    const onBus = ctx.createGain(), offBus = ctx.createGain();
    onBus.connect(filter); offBus.connect(filter); filter.connect(out).connect(this.sfx);
    const layers = (load: "on" | "off", bus: GainNode) => this.files
      .filter((f) => f.kind === "engine" && f.set === set && f.load === load).sort((a, b) => a.rpm! - b.rpm!)
      .map((f) => { const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(bus); return { rpm: f.rpm!, gain, src: this.source(f, gain) }; });
    this.engine = { on: layers("on", onBus), off: layers("off", offBus), onBus, offBus, out, filter };
  }

  private crossfade(layers: Layer[], rpm: number, t: number) {
    if (!layers.length) return;
    let i = layers.findIndex((x) => x.rpm > rpm);
    if (i === -1) i = layers.length;
    const lo = layers[Math.max(0, i - 1)], hi = layers[Math.min(layers.length - 1, i)];
    const f = hi.rpm > lo.rpm ? Math.min(1, Math.max(0, (rpm - lo.rpm) / (hi.rpm - lo.rpm))) : 0;
    for (const x of layers) {
      const w = x === lo && x === hi ? 1 : x === lo ? Math.cos((f * Math.PI) / 2) : x === hi ? Math.sin((f * Math.PI) / 2) : 0;
      x.gain.gain.setTargetAtTime(w, t, 0.03);
      x.src.playbackRate.setTargetAtTime(rpm / x.rpm, t, 0.02);
    }
  }

  /** Every frame: the engine at an rpm and throttle; the road, wind and tyres at a speed and slip. */
  drive(rpm: number, throttle: number, speed: number, slip: number, redline: number) {
    const ctx = this.ctx, e = this.engine;
    if (!ctx || !e || !this.ready) return;
    const t = ctx.currentTime;
    this.crossfade(e.on, rpm, t);
    this.crossfade(e.off, rpm, t);
    const hasOff = e.off.length > 0;
    e.onBus.gain.setTargetAtTime(hasOff ? 0.15 + 0.85 * throttle : 1, t, 0.05);
    e.offBus.gain.setTargetAtTime(hasOff ? 1 - throttle : 0, t, 0.05);
    const r = rpm / redline;
    // louder and brighter with rpm and load; a set with no off-throttle recording dulls itself instead
    e.out.gain.setTargetAtTime(0.25 + 0.35 * r + 0.25 * throttle, t, 0.06);
    e.filter.frequency.setTargetAtTime(hasOff ? 8000 : 700 + 7000 * (0.25 + 0.75 * throttle) * (0.5 + r * 0.5), t, 0.06);
    const kmh = speed * 3.6;
    this.loop("road_asphalt", Math.min(1, kmh / 140) * 0.45, 0.7 + kmh / 360);
    this.loop("wind_rush", Math.pow(Math.max(0, (kmh - 50) / 220), 1.5) * 0.7, 0.85 + kmh / 600);
    this.loop("tire_squeal", Math.max(0, Math.min(1, (slip - 0.75) * 2.5)) * 0.5 * Math.min(1, kmh / 40), 0.9 + slip * 0.1);
  }

  /** A looping bed by name at a level (0 fades it out). */
  loop(name: string, level: number, rate = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    let l = this.loops.get(name);
    if (!l) {
      if (level <= 0.001) return;
      const f = this.files.find((x) => nameOf(x) === name);
      if (!f) return;
      const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(this.sfx);
      l = { src: this.source(f, gain), gain };
      this.loops.set(name, l);
    }
    l.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.12);
    l.src.playbackRate.setTargetAtTime(rate, ctx.currentTime, 0.12);
  }

  /** A one-shot: `name` or a prefix of numbered variants ("passby" picks passby_1..4). */
  play(name: string, opts: { gain?: number; rate?: number; pan?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || !this.ready) return;
    const list = this.files.filter((f) => { const n = nameOf(f); return f.kind === "sfx" && (n === name || (n.startsWith(name + "_") && /^\d+$/.test(n.slice(name.length + 1)))); });
    const f = list[Math.floor(Math.random() * list.length)];
    if (!f) return;
    const gain = ctx.createGain(); gain.gain.value = opts.gain ?? 1;
    const pan = ctx.createStereoPanner(); pan.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
    gain.connect(pan).connect(this.sfx);
    const src = this.source(f, gain);
    src.playbackRate.value = opts.rate ?? 1;
  }

  async playMusic(name?: string) {
    await this.start();
    const ctx = this.ctx;
    if (!ctx) return;
    const songs = this.files.filter((f) => f.kind === "music");
    const f = songs.find((x) => nameOf(x) === name) ?? songs[Math.floor(Math.random() * songs.length)];
    await this.buffer(f.file);
    this.song?.stop();
    const src = ctx.createBufferSource(); src.buffer = this.buffers.get(f.file)!;
    src.connect(this.music); src.start();
    src.onended = () => { if (this.song === src) this.playMusic(); };
    this.song = src;
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }
  setMusicVolume(v: number) { this.musicVolume = v; if (this.ctx) this.music.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }
  suspend() { this.ctx?.suspend(); }
}
