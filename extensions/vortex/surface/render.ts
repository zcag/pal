// Vortex's picture, in WebGL2. The arena is real 3D seen from a tilted,
// slowly circling camera: a striped floor drawn by a shader, the walls and the
// centre as extruded prisms, the player a lit triangle with a trail. It is
// drawn in HDR into a multisampled buffer, then a bloom (a mip chain down and
// back up) makes everything bright glow, and a last pass adds chromatic
// aberration, a shockwave ripple, the flash, grain and a vignette, and tone
// maps it. Particles (shards on a death, motes rushing in, rings at a rank)
// live here; the sim knows nothing of them.
import { FEEL, type Look, type RGB } from "../game/content.ts";
import type { Wall } from "../game/sim.ts";

const TAU = Math.PI * 2;

export type Frame = {
  time: number;
  rot: number; n: number; nFrom: number; morph: number;
  a: number; dir: number;
  walls: Wall[];
  look: Look; hue: number; speed: number;
  /** Seconds since the kick and snare you heard; beats since the run's zero. */
  kick: number; snare: number; beats: number;
  tilt: number; az: number;
  /** Floor stripes swapped (a strobe), 0..1. */
  swap: number;
  /** Walls drawn this far out (the rewind after a death). */
  rewind: number;
  /** The player drawn (alive), and its glow. */
  player: number;
  /** The world's scale: a bump at a rank, a push in on a death. */
  zoom: number;
  shake: number; flash: number; aberr: number; desat: number;
  /** Seconds since a shockwave started (-1: none). */
  shock: number;
  /** 0..1: the menus, where everything dims and slows behind the cards. */
  calm: number;
};

// ---- small maths ----------------------------------------------------------------------------------------------------

type M4 = Float32Array;
const m4 = () => new Float32Array(16);
function mul(a: M4, b: M4): M4 {
  const o = m4();
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2), o = m4();
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = (2 * far * near) / (near - far);
  return o;
}
function lookAt(eye: number[], at: number[], up: number[]): M4 {
  const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
  const norm = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x), o = m4();
  o.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  return o;
}
function model(rot: number, s: number): M4 {
  const c = Math.cos(rot) * s, n = Math.sin(rot) * s, o = m4();
  o.set([c, n, 0, 0, -n, c, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
  return o;
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
/** sRGB-ish to linear, so the bloom and the tone map work on light, not on numbers. */
const lin = (c: RGB): RGB => c.map((x) => Math.pow(x, 2.2)) as RGB;

// ---- shaders --------------------------------------------------------------------------------------------------------

const GEO_VS = `#version 300 es
layout(location=0) in vec3 p; layout(location=1) in vec4 c;
uniform mat4 vp; uniform mat4 model;
out vec4 vc;
void main(){ vc = c; gl_Position = vp * model * vec4(p, 1.0); }`;
const GEO_FS = `#version 300 es
precision highp float;
in vec4 vc; out vec4 o;
void main(){ o = vc; }`;

const FLOOR_VS = `#version 300 es
layout(location=0) in vec3 p;
uniform mat4 vp; uniform mat4 model;
out vec2 lp;
void main(){ lp = p.xy; gl_Position = vp * model * vec4(p, 1.0); }`;
const FLOOR_FS = `#version 300 es
precision highp float;
in vec2 lp; out vec4 o;
uniform vec3 A, B, glow;
uniform float n, nFrom, morph, time, kick, swap, speed, calm;
const float TAU = 6.28318530718;
vec2 stripe(float sides){
  float ang = atan(lp.y, lp.x); if (ang < 0.0) ang += TAU;
  float seg = TAU / sides, f = ang / seg, idx = floor(f), t = fract(f);
  float r = length(lp);
  float poly = r * cos((t - 0.5) * seg);
  float s = mod(idx, 2.0);
  if (mod(sides, 2.0) > 0.5 && idx > sides - 1.5) s = 0.5;
  // Soften across the boundary by a pixel, so the spokes never shimmer.
  float d = min(t, 1.0 - t) * seg * r, w = fwidth(d) * 1.2;
  float k = smoothstep(0.0, w, d);
  float prev = mod(idx + (t < 0.5 ? -1.0 : 1.0) + sides, sides);
  float sp = mod(prev, 2.0); if (mod(sides, 2.0) > 0.5 && prev > sides - 1.5) sp = 0.5;
  return vec2(mix((s + sp) * 0.5, s, k), poly);
}
void main(){
  vec2 a = stripe(n), b = stripe(nFrom);
  float s = mix(b.x, a.x, morph), poly = mix(b.y, a.y, morph);
  s = mix(s, 1.0 - s, swap);
  vec3 col = mix(A, B, s);
  // Rings of the polygon rushing in, faint: the floor moves with the walls.
  float ring = fract(poly * 0.42 + time * speed * 0.42);
  col += glow * 0.035 * smoothstep(0.75, 1.0, ring) * (1.0 - calm * 0.6);
  // Light pooled round the centre, breathing on the kick; dark far out.
  col += glow * (0.05 + 0.06 * kick) * exp(-poly * 0.7);
  col *= exp(-max(poly - 2.5, 0.0) * 0.16);
  o = vec4(col, 1.0);
}`;

const QUAD_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
out vec2 uv;
void main(){ vec2 p = P[gl_VertexID]; uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const PREFILTER_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D src; uniform vec2 texel; uniform float threshold;
void main(){
  vec3 c = vec3(0.0);
  c += texture(src, uv + texel * vec2(-1.0, -1.0)).rgb; c += texture(src, uv + texel * vec2(1.0, -1.0)).rgb;
  c += texture(src, uv + texel * vec2(-1.0, 1.0)).rgb; c += texture(src, uv + texel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - threshold + 0.5, 0.0, 1.0); soft = soft * soft * 0.5;
  float w = max(soft, br - threshold) / max(br, 1e-4);
  o = vec4(c * w, 1.0);
}`;
const DOWN_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D src; uniform vec2 texel;
void main(){
  vec3 c = texture(src, uv).rgb * 4.0;
  c += texture(src, uv + texel * vec2(-1.0, -1.0)).rgb; c += texture(src, uv + texel * vec2(1.0, -1.0)).rgb;
  c += texture(src, uv + texel * vec2(-1.0, 1.0)).rgb; c += texture(src, uv + texel * vec2(1.0, 1.0)).rgb;
  o = vec4(c / 8.0, 1.0);
}`;
const UP_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D src; uniform vec2 texel;
void main(){
  vec3 c = vec3(0.0);
  c += texture(src, uv + texel * vec2(-2.0, 0.0)).rgb; c += texture(src, uv + texel * vec2(2.0, 0.0)).rgb;
  c += texture(src, uv + texel * vec2(0.0, -2.0)).rgb; c += texture(src, uv + texel * vec2(0.0, 2.0)).rgb;
  c += texture(src, uv + texel * vec2(-1.0, -1.0)).rgb * 2.0; c += texture(src, uv + texel * vec2(1.0, -1.0)).rgb * 2.0;
  c += texture(src, uv + texel * vec2(-1.0, 1.0)).rgb * 2.0; c += texture(src, uv + texel * vec2(1.0, 1.0)).rgb * 2.0;
  o = vec4(c / 12.0, 1.0);
}`;
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D scene, bloom; uniform vec2 res;
uniform float bloomK, aberr, flash, desat, hue, time, shock, vignette, exposure;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 hueRot(vec3 c, float a){
  const vec3 k = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 p = uv - 0.5; p.x *= res.x / res.y;
  float r = length(p);
  vec2 dir = r > 0.0 ? p / r : vec2(0.0);
  vec2 q = uv;
  // The shockwave: a ring that bends the picture as it passes.
  if (shock >= 0.0) {
    float front = shock * 1.6, d = r - front;
    float push = exp(-d * d * 260.0) * 0.035 * (1.0 - clamp(shock / 0.9, 0.0, 1.0));
    q -= vec2(dir.x * res.y / res.x, dir.y) * push;
  }
  float ab = aberr * (0.4 + r * 1.6);
  vec2 off = vec2(dir.x * res.y / res.x, dir.y) * ab;
  vec3 c;
  c.r = texture(scene, q + off).r + texture(bloom, q + off).r * bloomK;
  c.g = texture(scene, q).g + texture(bloom, q).g * bloomK;
  c.b = texture(scene, q - off).b + texture(bloom, q - off).b * bloomK;
  c = hueRot(c, hue);
  c = aces(c * exposure);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), desat);
  c += flash;
  c *= 1.0 - vignette * smoothstep(0.35, 1.05, r);
  c += (hash(uv * res + fract(time * 7.13)) - 0.5) * 0.035;
  o = vec4(pow(max(c, 0.0), vec3(1.0 / 1.08)), 1.0);
}`;

// ---- GL plumbing ----------------------------------------------------------------------------------------------------

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  const u: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i)!.name; u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}
type Prog = ReturnType<typeof program>;
type Target = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };

type Shard = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; ang: number; size: number; life: number; color: RGB };
type Mote = { a: number; r: number; z: number; v: number };
type Ring = { age: number; n: number; color: RGB };

export class Renderer {
  private gl: WebGL2RenderingContext;
  private geo: Prog; private floor: Prog; private pre: Prog; private down: Prog; private up: Prog; private fin: Prog;
  private vbo: WebGLBuffer; private vao: WebGLVertexArrayObject;
  private floorVao: WebGLVertexArrayObject;
  private empty: WebGLVertexArrayObject;
  private data = new Float32Array(7 * 60000);
  private count = 0;
  private hdr: boolean;
  private msaa: { fb: WebGLFramebuffer; color: WebGLRenderbuffer; depth: WebGLRenderbuffer } | null = null;
  private scene: Target | null = null;
  private mips: Target[] = [];
  private w = 0; private h = 0;
  private shards: Shard[] = [];
  private motes: Mote[] = [];
  private rings: Ring[] = [];
  private trail: { a: number; t: number }[] = [];
  lost = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("webgl2");
    this.gl = gl;
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("OES_texture_float_linear");
    this.geo = program(gl, GEO_VS, GEO_FS);
    this.floor = program(gl, FLOOR_VS, FLOOR_FS);
    this.pre = program(gl, QUAD_VS, PREFILTER_FS);
    this.down = program(gl, QUAD_VS, DOWN_FS);
    this.up = program(gl, QUAD_VS, UP_FS);
    this.fin = program(gl, QUAD_VS, FINAL_FS);
    this.vbo = gl.createBuffer()!;
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    this.floorVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.floorVao);
    const fb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    const R = 60;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-R, -R, 0, R, -R, 0, R, R, 0, -R, -R, 0, R, R, 0, -R, R, 0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    this.empty = gl.createVertexArray()!;
    gl.bindVertexArray(null);
    for (let i = 0; i < 140; i++) this.motes.push({ a: Math.random() * TAU, r: 1.5 + Math.random() * 14, z: Math.random() * 2.2, v: 0.4 + Math.random() * 0.8 });
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    const gl = this.gl;
    const fmt = this.hdr ? gl.RGBA16F : gl.RGBA8;
    if (this.msaa) { gl.deleteFramebuffer(this.msaa.fb); gl.deleteRenderbuffer(this.msaa.color); gl.deleteRenderbuffer(this.msaa.depth); }
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
    const color = gl.createRenderbuffer()!, depth = gl.createRenderbuffer()!, mfb = gl.createFramebuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, color); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, w, h);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mfb);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    this.msaa = { fb: mfb, color, depth };
    const target = (tw: number, th: number): Target => {
      const tex = gl.createTexture()!, fb = gl.createFramebuffer()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt, tw, th, 0, gl.RGBA, this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fb, tex, w: tw, h: th };
    };
    for (const t of [this.scene, ...this.mips]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    this.scene = target(w, h);
    this.mips = [];
    let mw = w >> 1, mh = h >> 1;
    for (let i = 0; i < 6 && mw > 4 && mh > 4; i++, mw >>= 1, mh >>= 1) this.mips.push(target(mw, mh));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---- geometry -------------------------------------------------------------------------------------------------------

  private v(x: number, y: number, z: number, c: RGB, a = 1) {
    if (this.count >= 60000) return;
    const o = this.count++ * 7, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = c[0]; d[o + 4] = c[1]; d[o + 5] = c[2]; d[o + 6] = a;
  }
  private quad(p: number[][], c: RGB | RGB[], a = 1) {
    const cs = Array.isArray(c[0]) ? (c as RGB[]) : [c as RGB, c as RGB, c as RGB, c as RGB];
    for (const i of [0, 1, 2, 0, 2, 3]) this.v(p[i][0], p[i][1], p[i][2], cs[i], a);
  }
  private polar(a: number, r: number, z: number) { return [Math.cos(a) * r, Math.sin(a) * r, z]; }

  /** A prism over a side's angles, between apothems r0 and r1, height h; lit top, shaded sides, a hot edge facing in. */
  private prism(a0: number, a1: number, r0: number, r1: number, h: number, top: RGB, side: RGB, edge: RGB) {
    const k = 1 / Math.cos((a1 - a0) / 2);
    const i0 = this.polar(a0, r0 * k, h), i1 = this.polar(a1, r0 * k, h), o0 = this.polar(a0, r1 * k, h), o1 = this.polar(a1, r1 * k, h);
    const g = (p: number[]) => [p[0], p[1], 0];
    // Lit from the centre: brightest on the edge facing in, falling off over the first unit, dim beyond.
    const band = Math.min(r1, r0 + 0.9), m0 = this.polar(a0, band * k, h), m1 = this.polar(a1, band * k, h);
    const mid = scale(top, lerp(1.25, 0.55, (band - r0) / 0.9));
    this.quad([i0, i1, m1, m0], [scale(top, 1.25), scale(top, 1.25), mid, mid]);
    if (band < r1) this.quad([m0, m1, o1, o0], [mid, mid, scale(top, 0.4), scale(top, 0.4)]);
    this.quad([g(i0), g(i1), i1, i0], [scale(side, 0.6), scale(side, 0.6), side, side]);
    this.quad([g(o1), g(o0), o0, o1], scale(side, 0.5));
    this.quad([g(o0), g(i0), i0, o0], scale(side, 0.75));
    this.quad([g(i1), g(o1), o1, i1], scale(side, 0.75));
    // The edge that will hit you, burning.
    const e = Math.min(0.06, (r1 - r0) * 0.5) * k;
    const j0 = this.polar(a0, r0 * k + e, h + 0.01), j1 = this.polar(a1, r0 * k + e, h + 0.01);
    this.quad([this.polar(a0, r0 * k, h + 0.01), this.polar(a1, r0 * k, h + 0.01), j1, j0], edge);
  }

  // ---- events from the game -------------------------------------------------------------------------------------------

  /** Shards burst from the player's spot. */
  burst(f: Frame, color: RGB) {
    const ang = f.a, px = Math.cos(ang) * FEEL.orbit, py = Math.sin(ang) * FEEL.orbit;
    for (let i = 0; i < 70; i++) {
      const a = ang + (Math.random() - 0.5) * 2.6, sp = 1.5 + Math.random() * 6;
      this.shards.push({
        x: px, y: py, z: 0.15, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 1 + Math.random() * 4,
        spin: (Math.random() - 0.5) * 30, ang: Math.random() * TAU, size: 0.04 + Math.random() * 0.12, life: 1, color: i % 3 ? color : [1, 1, 1],
      });
    }
  }
  ring(n: number, color: RGB) { this.rings.push({ age: 0, n, color }); }
  clearTrail() { this.trail = []; }

  // ---- a frame --------------------------------------------------------------------------------------------------------

  draw(f: Frame, dt: number) {
    if (this.lost) return;
    this.resize();
    const gl = this.gl;
    const L = f.look;
    const wall = lin(L.wall), core = lin(L.core), player = lin(L.player);
    const kickEnv = Math.exp(-f.kick * 9), snareEnv = Math.exp(-f.snare * 8);
    const pump = 1 + 0.05 * kickEnv * (1 - f.calm);

    // Camera: tilted, circling slowly, shaken.
    const tilt = (f.tilt * Math.PI) / 180, D = 17 / (f.zoom * pump);
    const sx = (Math.random() - 0.5) * f.shake, sy = (Math.random() - 0.5) * f.shake;
    const eye = [Math.sin(tilt) * Math.cos(f.az) * D + sx, Math.sin(tilt) * Math.sin(f.az) * D + sy, Math.cos(tilt) * D];
    const up = [-Math.cos(f.az), -Math.sin(f.az), 0];
    const proj = perspective((38 * Math.PI) / 180, this.w / this.h, 2, 90);
    const vp = mul(proj, lookAt(eye, [sx * 0.3, sy * 0.3, 0], up));
    const md = model(f.rot, 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaa!.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // The floor.
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.floor.p);
    const fu = this.floor.u;
    gl.uniformMatrix4fv(fu.vp, false, vp); gl.uniformMatrix4fv(fu.model, false, md);
    const bgA = scale(L.bgA, 0.45), bgB = scale(L.bgB, 0.8), lift = 1 + snareEnv * 0.25 * (1 - f.calm);
    gl.uniform3fv(fu.A, scale(bgA, lift)); gl.uniform3fv(fu.B, scale(bgB, lift)); gl.uniform3fv(fu.glow, wall);
    gl.uniform1f(fu.n, f.n); gl.uniform1f(fu.nFrom, f.nFrom); gl.uniform1f(fu.morph, f.morph);
    gl.uniform1f(fu.time, f.time); gl.uniform1f(fu.kick, kickEnv); gl.uniform1f(fu.swap, f.swap); gl.uniform1f(fu.speed, f.speed); gl.uniform1f(fu.calm, f.calm);
    gl.bindVertexArray(this.floorVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Solid geometry: walls, the centre, the player.
    this.count = 0;
    const coreA = FEEL.core * (1 + 0.1 * kickEnv * (1 - f.calm));
    const hWall = 0.2 + 0.07 * kickEnv;
    const edge = scale(mix(wall, [1, 1, 1], 0.4), 2.6);
    for (let i = 0; i < f.walls.length; i++) {
      const w = f.walls[i];
      const r0 = Math.max(w.r + f.rewind, coreA * 0.98), r1 = w.r + w.len + f.rewind;
      if (r1 <= r0) continue;
      // Out of the dark far away, brightest close in.
      const fog = 1 - smooth(7, FEEL.spawn - 0.3, r0);
      if (fog <= 0.01) continue;
      const near = 1 + 0.6 * Math.exp(-Math.max(0, r0 - 1) * 0.6);
      const top = scale(wall, 0.75 * near * fog), side = scale(wall, 0.3 * fog);
      // Heights differ a hair, so walls that overlap (a tunnel's and a row's) never fight for the same plane.
      this.prism(w.a0, w.a1, r0, r1, hWall + (i % 5) * 0.006, top, side, scale(edge, fog));
    }
    this.centre(f, coreA, core, wall, kickEnv);
    if (f.player > 0) this.ship(f, player);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    this.flush(vp, md);

    // Light: shards, rings, motes and the trail, added on top.
    this.count = 0;
    this.particles(f, dt, wall, kickEnv);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    this.flush(vp, md);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // Resolve, bloom, finish.
    const sc = this.scene!;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaa!.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sc.fb);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindVertexArray(this.empty);
    const pass = (p: Prog, src: Target, dst: Target | null, set?: () => void) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
      gl.viewport(0, 0, dst ? dst.w : this.w, dst ? dst.h : this.h);
      gl.useProgram(p.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(p.u.src ?? p.u.scene, 0);
      gl.uniform2f(p.u.texel, 1 / src.w, 1 / src.h);
      set?.();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    pass(this.pre, sc, this.mips[0], () => gl.uniform1f(this.pre.u.threshold, this.hdr ? 1.1 : 0.7));
    for (let i = 1; i < this.mips.length; i++) pass(this.down, this.mips[i - 1], this.mips[i]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.mips.length - 1; i > 0; i--) pass(this.up, this.mips[i], this.mips[i - 1]);
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.fin.p);
    const u = this.fin.u;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sc.tex); gl.uniform1i(u.scene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mips[0].tex); gl.uniform1i(u.bloom, 1);
    gl.uniform2f(u.res, this.w, this.h);
    gl.uniform1f(u.bloomK, (this.hdr ? 0.55 : 0.8) * (1 + 0.4 * kickEnv * (1 - f.calm)));
    gl.uniform1f(u.aberr, f.aberr + 0.0016 + 0.0022 * kickEnv * (1 - f.calm));
    gl.uniform1f(u.flash, f.flash);
    gl.uniform1f(u.desat, f.desat);
    gl.uniform1f(u.hue, f.hue * TAU);
    gl.uniform1f(u.time, f.time);
    gl.uniform1f(u.shock, f.shock);
    gl.uniform1f(u.vignette, 0.55 + f.calm * 0.25);
    gl.uniform1f(u.exposure, 1.1 - f.calm * 0.35);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  private flush(vp: M4, md: M4) {
    if (!this.count) return;
    const gl = this.gl;
    gl.useProgram(this.geo.p);
    gl.uniformMatrix4fv(this.geo.u.vp, false, vp); gl.uniformMatrix4fv(this.geo.u.model, false, md);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * 7);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }

  /** The centre: a raised polygon, dark inside a burning rim, morphing between side counts. */
  private centre(f: Frame, apo: number, core: RGB, wall: RGB, kick: number) {
    const m = Math.max(f.n, f.nFrom), t = ease(f.morph);
    const pts: number[][] = [];
    for (let k = 0; k <= m; k++) {
      const at = (n: number) => { const kk = Math.min(k, n); const a = (TAU * kk) / n; const rr = apo / Math.cos(Math.PI / n); return [Math.cos(a) * rr, Math.sin(a) * rr]; };
      const p0 = at(f.nFrom), p1 = at(f.n);
      pts.push([lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)]);
    }
    const h = 0.34, rim = 0.11, inner = scale(lin(f.look.bgA), 1.4), rimC = scale(core, 3.2 + 2.5 * kick);
    for (let k = 0; k < m; k++) {
      const [a, b] = [pts[k], pts[k + 1]];
      const ia = [a[0] * (1 - rim / apo), a[1] * (1 - rim / apo)], ib = [b[0] * (1 - rim / apo), b[1] * (1 - rim / apo)];
      this.v(0, 0, h, scale(wall, 0.25)); this.v(ia[0], ia[1], h, inner); this.v(ib[0], ib[1], h, inner);
      this.quad([[ia[0], ia[1], h], [ib[0], ib[1], h], [b[0], b[1], h], [a[0], a[1], h]], rimC);
      this.quad([[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], h], [a[0], a[1], h]], [scale(core, 0.2), scale(core, 0.2), scale(core, 0.9), scale(core, 0.9)]);
    }
  }

  /** The player: a bright triangle on the orbit pointing out, leaning into its turn, with a fading trail. */
  private ship(f: Frame, color: RGB) {
    const a = f.a, r = FEEL.orbit, z = 0.18;
    const lean = f.dir * 0.22;
    const tip = this.polar(a + lean * 0.15, r + 0.17, z), l = this.polar(a - 0.11 + lean * 0.05, r - 0.06, z), rr = this.polar(a + 0.11 + lean * 0.05, r - 0.06, z);
    const hot = scale(color, 7 * f.player);
    this.v(tip[0], tip[1], tip[2], hot); this.v(l[0], l[1], l[2], hot); this.v(rr[0], rr[1], rr[2], hot);
    const g = (p: number[]) => [p[0], p[1], 0.02];
    this.quad([g(l), g(rr), rr, l], scale(color, 1.5 * f.player));
    this.quad([g(rr), g(tip), tip, rr], scale(color, 2 * f.player));
    this.quad([g(tip), g(l), l, tip], scale(color, 2 * f.player));
    this.trail.push({ a, t: f.time });
    while (this.trail.length && f.time - this.trail[0].t > 0.16) this.trail.shift();
  }

  private particles(f: Frame, dt: number, wall: RGB, kick: number) {
    // The trail.
    const tr = this.trail;
    for (let i = 1; i < tr.length; i++) {
      const a0 = tr[i - 1].a, a1 = tr[i].a;
      if (Math.abs(a1 - a0) > Math.PI) continue;
      const k0 = 1 - (f.time - tr[i - 1].t) / 0.16, k1 = 1 - (f.time - tr[i].t) / 0.16;
      if (Math.abs(a1 - a0) < 1e-4) continue;
      const w0 = 0.05 * k0, w1 = 0.05 * k1, c0 = scale(lin(f.look.player), 2.2 * k0 * k0 * f.player), c1 = scale(lin(f.look.player), 2.2 * k1 * k1 * f.player);
      this.quad([this.polar(a0, FEEL.orbit - w0, 0.17), this.polar(a1, FEEL.orbit - w1, 0.17), this.polar(a1, FEEL.orbit + w1, 0.17), this.polar(a0, FEEL.orbit + w0, 0.17)], [c0, c1, c1, c0]);
    }
    // Motes rushing in with the walls.
    const mc = scale(wall, 0.9 + kick * 0.8);
    for (const m of this.motes) {
      m.r -= f.speed * m.v * dt * (1 - f.calm * 0.7);
      if (m.r < FEEL.core) { m.r = 10 + Math.random() * 6; m.a = Math.random() * TAU; m.z = Math.random() * 2.2; }
      const fade = smooth(0.8, 2.5, m.r) * (1 - smooth(9, 15, m.r)) * 0.55;
      const len = 0.08 + f.speed * 0.03, w = 0.012;
      const n = [Math.cos(m.a), Math.sin(m.a)], tn = [-n[1], n[0]];
      const p0 = [n[0] * m.r, n[1] * m.r], p1 = [n[0] * (m.r + len), n[1] * (m.r + len)];
      this.quad([[p0[0] - tn[0] * w, p0[1] - tn[1] * w, m.z], [p0[0] + tn[0] * w, p0[1] + tn[1] * w, m.z], [p1[0] + tn[0] * w, p1[1] + tn[1] * w, m.z], [p1[0] - tn[0] * w, p1[1] - tn[1] * w, m.z]], [scale(mc, fade), scale(mc, fade), scale(mc, 0), scale(mc, 0)]);
    }
    // Rings out of the centre.
    for (const g of this.rings) {
      g.age += dt;
      const t = g.age / 1.1, apo = FEEL.core + t * 14, wdt = 0.08 + t * 0.5, k = Math.pow(1 - t, 2) * 3;
      const c = scale(lin(g.color), k);
      for (let i = 0; i < g.n; i++) {
        const a0 = (TAU * i) / g.n, a1 = (TAU * (i + 1)) / g.n, kk = 1 / Math.cos(Math.PI / g.n);
        this.quad([this.polar(a0, apo * kk, 0.05), this.polar(a1, apo * kk, 0.05), this.polar(a1, (apo + wdt) * kk, 0.05), this.polar(a0, (apo + wdt) * kk, 0.05)], [c, c, scale(c, 0), scale(c, 0)]);
      }
    }
    this.rings = this.rings.filter((g) => g.age < 1.1);
    // Shards.
    for (const s of this.shards) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.vz -= 9 * dt;
      if (s.z < 0) { s.z = 0; s.vz *= -0.4; s.vx *= 0.7; s.vy *= 0.7; }
      s.vx *= 1 - dt * 1.2; s.vy *= 1 - dt * 1.2;
      s.ang += s.spin * dt; s.life -= dt * 0.55;
      const c = scale(lin(s.color), 4 * Math.max(0, s.life));
      const p = (a: number) => [s.x + Math.cos(s.ang + a) * s.size, s.y + Math.sin(s.ang + a) * s.size, s.z + Math.sin(s.ang * 0.7 + a) * s.size * 0.6];
      const [p0, p1, p2] = [p(0), p(2.1), p(4.2)];
      this.v(p0[0], p0[1], p0[2], c); this.v(p1[0], p1[1], p1[2], c); this.v(p2[0], p2[1], p2[2], c);
    }
    this.shards = this.shards.filter((s) => s.life > 0);
  }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
