// Vortex's picture, in WebGL2. The arena is real 3D seen from a tilted,
// slowly circling camera: a striped floor drawn by a shader, the walls and the
// centre as extruded prisms, the player a lit gem with a trail. Under it lies
// each stage's world (a grid abyss, a nebula, a crystal cave, deep water, a
// speed tunnel, a black hole): a background pass the floor turns glassy over
// past the orbit, so the world is atmosphere at the edges and never noise
// where you play. Clarity first, as in Super Hexagon: walls are flat bright
// slabs on a calm dark floor, their inner edge burning; the player a bright
// shape with a dark rim and a halo. All of it is drawn in HDR into a
// multisampled buffer, then a bloom (a mip chain down and back up) and a last
// pass add aberration, a shockwave, light shafts, the stage's lens (a gravity
// well, water, glitches, a spectrum), the replay's tint, grain and a vignette,
// and tone map it. Particles (shards, sparks on a near miss, motes, bubbles,
// rings) live here; the sim knows nothing of them.
import { FEEL, STAGES, type Look, type RGB, type SectionKind, type SkinId, type StageId, type TrailId } from "../game/content.ts";
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
  /** The stage, for its world beyond the arena, and whether it is the hyper. */
  stage?: StageId; hyper?: boolean;
  /** The song's section, how hard it hits (0..1), and how far into it (beats, of len). */
  section?: SectionKind; energy?: number; sectionBeats?: number; sectionLen?: number;
  /** Lights out but for the walls' burning edges (0..1); the picture's colours inverted (0..1). */
  blackout?: number; invert?: number;
  /** Your best run's ghost on this board: its angle, how visible (0..1). */
  ghost?: { a: number; alpha: number } | null;
  /** In the replay after a death: the wall that killed you (outlined), and how slow time runs (0..1). */
  killer?: Wall | null; replay?: number;
  /** The player's shape and trail. */
  skin?: SkinId; trail?: TrailId;
};

/** Per stage: how see-through the floor gets far out (the world shows through), and how strong the light shafts from the centre are. */
const WORLD: Record<StageId, { far: number; rays: number }> = {
  pulse: { far: 0.3, rays: 0.55 },
  drift: { far: 0.22, rays: 0.3 },
  prism: { far: 0.3, rays: 0.2 },
  undertow: { far: 0.3, rays: 0.25 },
  overdrive: { far: 0.32, rays: 0.3 },
  singularity: { far: 0.14, rays: 0.4 },
};

// ---- small maths ----------------------------------------------------------------------------------------------------

type M4 = Float32Array;
type V3 = [number, number, number];
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
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The view matrix, and the camera's right, up and back axes (the background casts its rays from them). */
function lookAt(eye: V3, at: V3, up: V3) {
  const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x), m = m4();
  m.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  return { m, x, y, z };
}
function model(rot: number, s: number): M4 {
  const c = Math.cos(rot) * s, n = Math.sin(rot) * s, o = m4();
  o.set([c, n, 0, 0, -n, c, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
  return o;
}
/** A world point to 0..1 screen coordinates. */
function project(m: M4, x: number, y: number, z: number): [number, number] {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [((m[0] * x + m[4] * y + m[8] * z + m[12]) / w) * 0.5 + 0.5, ((m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5 + 0.5];
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
/** sRGB-ish to linear, so the bloom and the tone map work on light, not on numbers. */
const lin = (c: RGB): RGB => c.map((x) => Math.pow(x, 2.2)) as RGB;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** A hue (0..1, wrapping) as a pure colour. */
const spectrum = (h: number): RGB => { const x = (((h % 1) + 1) % 1) * 6; return [clamp01(Math.abs(x - 3) - 1), clamp01(2 - Math.abs(x - 2)), clamp01(2 - Math.abs(x - 4))]; };
const WHITE: RGB = [1, 1, 1];

// ---- shaders --------------------------------------------------------------------------------------------------------

/** Hashes, value noise, a spectrum, water caustics: shared by the world, floor and final shaders. */
const LIB = `
const float TAU = 6.28318530718;
float h12(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
vec2 h22(vec2 p){ vec3 q = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy); }
float h13(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * n3(p); p = p * 2.02 + 7.3; a *= .5; } return s; }
vec3 spectrum(float h){ h = fract(h) * 6.; return clamp(vec3(abs(h - 3.) - 1., 2. - abs(h - 2.), 2. - abs(h - 4.)), 0., 1.); }
vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// Light focused by a moving water surface: where three warped waves cancel, thin bright webs (0..1).
float caustic(vec2 p, float t){
  vec2 q = p + vec2(sin(p.y * 1.3 + t), cos(p.x * 1.1 - t * .8)) * .7;
  float a = sin(q.x * 2.1 + t * .7) + sin(q.y * 1.9 - t * .6) + sin((q.x + q.y) * 1.4 + t * .5);
  return pow(1. - abs(a) / 3., 14.);
}`;

const GEO_VS = `#version 300 es
layout(location=0) in vec3 p; layout(location=1) in vec4 c;
uniform mat4 vp; uniform mat4 model;
out vec4 vc;
void main(){ vc = c; gl_Position = vp * model * vec4(p, 1.0); }`;
const GEO_FS = `#version 300 es
precision highp float;
in vec4 vc; out vec4 o;
void main(){ o = vc; }`;

const QUAD_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
out vec2 uv;
void main(){ vec2 p = P[gl_VertexID]; uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

/** The world under the arena, one per stage. Rays are cast from the camera; most go down past the floor into the stage's own space. */
const WORLD_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform vec3 eye, cx, cy, cz, ax;
uniform vec2 tanH;
uniform float time, beats, spin, kick, k, hot, hyper, dim, build;
uniform vec3 A, B, W, C;
${LIB}
// Where a ray meets a plane h under the floor, relative to the point under the centre, turning with a share of the world's spin.
vec2 under(vec3 d, float h, float turn){
  float t = (-h - eye.z) / min(d.z, -1e-3), t0 = (-h - eye.z) / min(ax.z, -1e-3);
  return rot2((eye + d * t).xy - (eye + ax * t0).xy, -spin * turn);
}
float stars(vec3 d, float sc, float th){
  vec3 p = d * sc, i = floor(p), f = fract(p) - .5;
  float h = h13(i);
  if (h < th) return 0.;
  vec3 off = (vec3(h13(i + 3.1), h13(i + 7.7), h13(i + 1.3)) - .5) * .5;
  return smoothstep(.17, .0, length(f - off)) * (h - th) / (1. - th);
}
vec3 world(vec3 d){
  vec3 col = vec3(0.);
#if STAGE == 0
  // Pulse: a neon grid far below, rings of light leaving the centre on the beat, shafts breathing with the kick.
  vec2 P = under(d, 26., .35); float L = length(P);
  vec2 g = P / (hyper > .5 ? 2.2 : 3.2), gw = fwidth(g), gl = abs(fract(g - .5) - .5) / gw;
  float line = 1. - min(min(gl.x, gl.y), 1.);
  float wave = exp(-fract(L / 46. - beats * .25) * 9.);
  col = B * .5 + W * line * exp(-L * .03) * (.12 + .3 * k + .3 * kick) * (.5 + 1.6 * wave);
  float a = atan(P.y, P.x);
  float beam = pow(n2(vec2(cos(a), sin(a)) * 3.5 + time * .12), 3.) * exp(-L * .022);
  col += W * beam * (.12 + .5 * kick) * k + C * exp(-L * .05) * .12;
  col += stars(d, 150., .9) * vec3(.7, .85, 1.) * .9;
#elif STAGE == 1
  // Drift: a nebula swirling with the world's spin, aurora ribbons below it.
  vec3 q = d; float off = acos(clamp(dot(d, ax), -1., 1.));
  q.xy = rot2(q.xy, -spin * .6 + (1.1 - off) * 1.6 + time * .02);
  vec3 p = q * 2.3 + vec3(0., 0., time * .03);
  float n1 = fbm(p), n2v = fbm(p * 1.9 + n1 * 2.4 + vec3(time * .05, 0., 0.));
  float dens = smoothstep(.3, .8, n2v);
  col = (mix(A * 1.6, W * .25, dens) + C * .2 * pow(dens, 3.)) * (.5 + .6 * n1) * (.45 + .4 * k);
  vec2 P = under(d, 18., .25);
  float y = mod(P.y + 7. * sin(P.x * .05 + time * .25) + 3. * sin(P.x * .13 - time * .4), 42.) - 21.;
  float curtain = y < 0. ? exp(y * 1.5) : exp(-y * .12);
  col += mix(vec3(.15, 1., .6), C, .45) * curtain * (.4 + .6 * n2(vec2(P.x * .3, time * .3))) * .22 * k * exp(-length(P) * .012);
  col += stars(d, 170., .93) * vec3(1., .85, 1.) * .7;
#elif STAGE == 2
  // Prism: a crystal floor far below, its cells lit in slowly turning colours, spectral seams between them.
  vec2 P = under(d, 22., .5) * .11;
  vec2 i = floor(P), f = fract(P), id = i; float m1 = 9., m2 = 9.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 gq = vec2(x, y), oo = .5 + .4 * sin(time * .3 + TAU * h22(i + gq));
    vec2 r = gq + oo - f; float dd = dot(r, r);
    if (dd < m1) { m2 = m1; m1 = dd; id = i + gq; } else if (dd < m2) m2 = dd;
  }
  float edge = sqrt(m2) - sqrt(m1), h = h12(id), L = length(P);
  col = A * .8 + spectrum(h + time * .04 + L * .05) * (.015 + .025 * k) * (.6 + .4 * h);
  col += spectrum(h * 3. + time * .1 + L * .2) * smoothstep(.05, .0, edge) * (.05 + .1 * k + .12 * kick) * exp(-L * .09);
  col += spectrum(atan(P.y, P.x) / TAU + time * .05) * .02 * k;
  col += stars(d, 180., .92) * spectrum(h13(floor(d * 180.))) * 1.2;
#elif STAGE == 3
  // Undertow: deep water. A sunlit seabed's caustics, shafts converging down to the depths, drifting specks.
  vec2 P = under(d, 20., .15); float L = length(P);
  vec3 water = B * 1.4 + W * .01;
  col = mix(water, A * .5, smoothstep(10., 80., L));
  col += mix(water * 8., C, .3) * caustic(P * .25, time * .5) * .2 * exp(-L * .03) * (.5 + k);
  vec2 nd = normalize(d.xy + 1e-5);
  col += water * 3. * pow(n2(nd * 22. + vec2(time * .25, -time * .18)), 6.) * k * smoothstep(-1., -.6, d.z);
  col += stars(normalize(d + vec3(0., 0., time * .004)), 210., .93) * C * .15;
#elif STAGE == 4
  // Overdrive: a tunnel round the centre, acid streaks rushing in, rings of it pumping on the kick.
  vec3 e1 = normalize(cross(ax, vec3(0., 0., 1.))), e2 = cross(ax, e1);
  float off = acos(clamp(dot(d, ax), -1., 1.)), phi = atan(dot(d, e2), dot(d, e1)) + spin * .5;
  float depth = 1. / max(off, .01), cells = phi / TAU * 120., cell = floor(cells), h = h12(vec2(cell, 1.));
  float s = fract(depth * .3 + time * (1.2 + 2. * k + build * 2.) * (.5 + h) + h * 7.);
  float streak = smoothstep(0., .02, s) * smoothstep(.15, .02, s) * step(.55, h) * smoothstep(.3, .1, abs(fract(cells) - .5));
  col = A * 1.4 + W * .04 * kick;
  col += mix(W, spectrum(h * .4 + time * .08 + .25), .5) * streak * (.1 + .25 * k) * smoothstep(.15, .32, off);
  col += W * smoothstep(.93, 1., fract(depth * .5 - time * 1.5)) * (.03 + .1 * kick) * k * smoothstep(.15, .32, off);
#else
  // Singularity: gravity bends every ray toward the hole behind the core; an accretion disk far below, the stars stretched in.
  float c0 = dot(d, ax), off = acos(clamp(c0, -1., 1.));
  float bend = min(.006 / max(off, 1e-3), off * .9);
  vec3 perp = normalize(ax - d * c0 + 1e-6);
  vec3 b = normalize(d * cos(bend) + perp * sin(bend));
  vec2 P = under(b, 30., 0.); float R = length(P), a = atan(P.y, P.x);
  vec2 Q = rot2(P, time * (hyper > .5 ? 9. : 6.) / max(R, 4.));
  float swirl = n2(Q * .3) * .7 + n2(Q * .9) * .3;
  float disk = smoothstep(9., 11., R) * exp(-(R - 10.) * .05) * smoothstep(80., 40., R);
  float dop = 1. + .6 * dot(vec2(-sin(a), cos(a)), normalize(eye.xy + 1e-4));
  col = mix(C * 1.1, W * .35, smoothstep(10., 30., R)) * disk * (.2 + .6 * swirl * swirl) * dop * (.35 + .35 * k);
  col += C * exp(-pow((R - 10.) * .6, 2.)) * .3 * (.6 + kick);
  vec3 e1 = normalize(cross(ax, vec3(0., 0., 1.))), e2 = cross(ax, e1);
  float phi = atan(dot(b, e2), dot(b, e1));
  vec2 sp = vec2(phi * 70., log(max(acos(clamp(dot(b, ax), -1., 1.)), 1e-3)) * 9. + time * (.6 + build * 2.));
  vec2 si = floor(sp), sf = fract(sp) - .5; float sh = h12(si);
  col += step(.94, sh) * smoothstep(.12, 0., abs(sf.x)) * smoothstep(.5, 0., abs(sf.y)) * vec3(.85, .8, 1.) * .9;
  col *= smoothstep(.02, .04, off);
#endif
  return col;
}
void main(){
  vec3 d = normalize(cz + (uv.x * 2. - 1.) * tanH.x * cx + (uv.y * 2. - 1.) * tanH.y * cy);
  o = vec4(world(d) * (1. + hot * .6) * dim, 1.);
}`;

const FLOOR_VS = `#version 300 es
layout(location=0) in vec3 p;
uniform mat4 vp; uniform mat4 model;
out vec2 lp;
void main(){ lp = p.xy; gl_Position = vp * model * vec4(p, 1.0); }`;
/** The floor, drawn over the world: calm stripes, opaque round the orbit, glassy far out so the world shows; each stage adds its own light on it, away from the orbit. Premultiplied alpha. */
const FLOOR_FS = `#version 300 es
precision highp float;
in vec2 lp; out vec4 o;
uniform vec3 A, B, glow, C;
uniform float n, nFrom, morph, time, kick, swap, speed, calm, far, k, dim, beats;
${LIB}
vec2 stripe(float sides){
  float ang = atan(lp.y, lp.x); if (ang < 0.0) ang += TAU;
  float seg = TAU / sides, f = ang / seg, idx = floor(f), t = fract(f);
  float r = length(lp);
  float poly = r * cos((t - 0.5) * seg);
  float s = mod(idx, 2.0);
  if (mod(sides, 2.0) > 0.5 && idx > sides - 1.5) s = 0.5;
  // Soften across the boundary by a pixel, so the spokes never shimmer.
  float d = min(t, 1.0 - t) * seg * r, w = fwidth(d) * 1.2;
  float kk = smoothstep(0.0, w, d);
  float prev = mod(idx + (t < 0.5 ? -1.0 : 1.0) + sides, sides);
  float sp = mod(prev, 2.0); if (mod(sides, 2.0) > 0.5 && prev > sides - 1.5) sp = 0.5;
  return vec2(mix((s + sp) * 0.5, s, kk), poly);
}
void main(){
  vec2 a = stripe(n), b = stripe(nFrom);
  float s = mix(b.x, a.x, morph), poly = mix(b.y, a.y, morph);
  s = mix(s, 1.0 - s, swap);
  vec3 col = mix(A, B, s);
  // Rings of the polygon rushing in, faint: the floor moves with the walls.
  float ring = fract(poly * 0.42 + time * speed * 0.42);
  col += glow * 0.03 * smoothstep(0.75, 1.0, ring) * (1.0 - calm * 0.6);
  // Light pooled round the centre, breathing on the kick.
  col += glow * (0.04 + 0.05 * kick) * exp(-poly * 0.8);
  float alpha = mix(1.0, far, smoothstep(2.4, 7.5, poly));
  // Whatever the stage adds stays out past three apothems: the orbit is for reading walls.
  float away = smoothstep(2.6, 4.2, poly) * k;
  vec3 em = vec3(0.);
#if STAGE == 0
  vec2 g = lp * 1.1, gl = abs(fract(g - .5) - .5) / fwidth(g);
  em = glow * (1. - min(min(gl.x, gl.y), 1.)) * (.05 + .08 * kick) * away;
#elif STAGE == 2
  vec2 g = lp * 6., i = floor(g), f = fract(g) - .5; float h = h12(i);
  float tw = pow(max(0., sin(time * 3. + h * 40.)), 10.);
  em = spectrum(h * 5. + time * .2) * step(.8, h) * smoothstep(.22, .0, length(f - (h22(i) - .5) * .5)) * tw * 1.4 * away;
#elif STAGE == 3
  em = mix(glow, C, .5) * caustic(lp * 1.1, time * .7) * .14 * away;
#elif STAGE == 4
  float an = atan(lp.y, lp.x), cells = an / TAU * 150., h = h12(vec2(floor(cells), 3.));
  float st = fract(poly * .1 + time * speed * .1 * (.6 + h) + h * 9.);
  em = glow * step(.7, h) * smoothstep(.05, .0, st) * smoothstep(.4, .1, abs(fract(cells) - .5)) * .5 * away;
#elif STAGE == 5
  float sp = sin(atan(lp.y, lp.x) * 3. + log(poly + .1) * 7. + time * 4.);
  em = C * smoothstep(.8, 1., sp) * .14 * away * exp(-poly * .1);
#endif
  o = vec4((col * alpha + em) * dim, alpha);
}`;

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
/** Up a level, added on; `gain` under 1 keeps the wide halos weaker than the tight ones, so edges glow without smearing. */
const UP_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o; uniform sampler2D src; uniform vec2 texel; uniform float gain;
void main(){
  vec3 c = vec3(0.0);
  c += texture(src, uv + texel * vec2(-2.0, 0.0)).rgb; c += texture(src, uv + texel * vec2(2.0, 0.0)).rgb;
  c += texture(src, uv + texel * vec2(0.0, -2.0)).rgb; c += texture(src, uv + texel * vec2(0.0, 2.0)).rgb;
  c += texture(src, uv + texel * vec2(-1.0, -1.0)).rgb * 2.0; c += texture(src, uv + texel * vec2(1.0, -1.0)).rgb * 2.0;
  c += texture(src, uv + texel * vec2(-1.0, 1.0)).rgb * 2.0; c += texture(src, uv + texel * vec2(1.0, 1.0)).rgb * 2.0;
  o = vec4(c / 12.0 * gain, 1.0);
}`;
const FINAL_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D scene, bloom, rays; uniform vec2 res, ctr;
uniform float bloomK, aberr, flash, desat, hue, time, clock, shock, vignette, exposure, orb, raysK, k, kick, invert, replay, glitch, scan, lens, streaks;
uniform vec3 W, fog;
${LIB}
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 hueRot(vec3 c, float a){
  const vec3 kk = vec3(0.57735);
  float ca = cos(a), sa = sin(a);
  return c * ca + cross(kk, c) * sa + kk * dot(kk, c) * (1.0 - ca);
}
vec3 at(vec2 q){ return texture(scene, q).rgb + texture(bloom, q).rgb * bloomK; }
void main(){
  float asp = res.x / res.y;
  vec2 toUv = vec2(1. / asp, 1.);
  vec2 p = (uv - ctr) * vec2(asp, 1.);
  float r = length(p);
  vec2 dir = r > 0.0 ? p / r : vec2(0.0);
  vec2 q = uv;
  // Whatever moves the picture fades out round the orbit, so the walls you read are where they are.
  float away = smoothstep(orb * 2.2, orb * 4.5, r);
  // The shockwave: a ring that bends the picture as it passes.
  if (shock >= 0.0) {
    float front = shock * 1.6, d = r - front;
    float push = exp(-d * d * 260.0) * 0.035 * (1.0 - clamp(shock / 0.9, 0.0, 1.0));
    q -= dir * toUv * push;
  }
#if STAGE == 5
  // Space falls toward the core: a lens (each pixel shows what lies nearer the centre) twisted by the hole's spin.
  float rr = max(r - lens * away / max(r, .12), 0.), tw = lens * away / max(r * r, .03);
  q = ctr + rot2(dir, tw) * rr * toUv + (q - uv);
#elif STAGE == 3
  q += vec2(sin(uv.y * 19. + time * 1.7), cos(uv.x * 15. + time * 1.3)) * .0022 * (.3 + .7 * away);
#elif STAGE == 4
  if (glitch > 0.) {
    float t = floor(clock * 24.), band = floor(uv.y * 16. + h12(vec2(t, 3.)) * 16.), h = h12(vec2(band, t));
    if (h > 1. - glitch * .5) q.x += (h12(vec2(t, band)) - .5) * .09 * glitch;
  }
#endif
  float ab = aberr * (0.4 + r * 1.6) * (.35 + .65 * away);
  vec2 off = dir * toUv * ab;
  vec3 c;
#if STAGE == 2
  // Glass splits light: five taps across the spectrum instead of three.
  c = vec3(0.); vec3 ws = vec3(0.);
  for (int i = 0; i < 5; i++) { float t = float(i) / 4.; vec3 w = spectrum(.0 + t * .75) + .05; c += w * at(q + off * (t * 2. - 1.) * 1.5); ws += w; }
  c /= ws;
#else
  c.r = at(q + off).r; c.g = at(q).g; c.b = at(q - off).b;
#endif
  // Shafts of light out of the centre: the glow sampled back along the line to it.
  if (raysK > 0.) {
    vec2 st = (ctr - q) * (.55 / 12.), s = q; float dec = 1.; vec3 acc = vec3(0.);
    for (int i = 0; i < 12; i++) { s += st; acc += texture(rays, s).rgb * dec; dec *= .9; }
    c += acc * (raysK / 12.) * smoothstep(orb * .9, orb * 2.6, r);
  }
#if STAGE == 3
  // Sunlight from above in slanting shafts.
  float sh = pow(n2(vec2(uv.x * 7. + uv.y * 2.5 + time * .06, time * .12)), 3.);
  c += fog * 2. * sh * smoothstep(.15, 1., uv.y) * k * away;
#elif STAGE == 4
  float an = atan(p.y, p.x), cells = an / TAU * 160., h = h12(vec2(floor(cells), 9.));
  float s4 = fract(log(r + .01) * 1.4 - time * (2.2 + h * 2.) + h * 5.);
  c += W * .9 * step(.75, h) * smoothstep(0., .02, s4) * smoothstep(.14, .02, s4) * smoothstep(.4, .1, abs(fract(cells) - .5)) * away * streaks;
#endif
  c = hueRot(c, hue);
  c = aces(c * exposure);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), desat);
  c += flash;
  // Scanlines: a CRT on strobes, and the replay's.
  c *= 1. - scan * .3 * (.5 + .5 * cos(gl_FragCoord.y * 3.14159 * .5));
  if (replay > 0.) {
    float rl = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, mix(c, rl * vec3(1.1, .95, .92), .25), replay);
    c *= 1. - replay * .2 * (.5 + .5 * cos(gl_FragCoord.y * 3.14159 * .66));
    c += replay * .05 * exp(-pow(fract(uv.y * .7 - clock * .3) * 24., 2.));
  }
  float v = smoothstep(0.35, 1.05, length((uv - .5) * vec2(asp, 1.)));
  c = c * (1.0 - vignette * v) + fog * v * .3;
  c = mix(c, 1. - clamp(c, 0., 1.), invert);
  c += (h12(uv * res + fract(clock * 7.13) * 100.) - 0.5) * 0.03;
  o = vec4(pow(max(c, 0.0), vec3(1.0 / 1.08)), 1.0);
}`;

// ---- GL plumbing ----------------------------------------------------------------------------------------------------

function program(gl: WebGL2RenderingContext, vs: string, fs: string, stage = -1) {
  if (stage >= 0) fs = fs.replace("\n", `\n#define STAGE ${stage}\n`);
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
/** Uniforms by name; ones the compiler dropped are skipped. */
function set(gl: WebGL2RenderingContext, p: Prog, vals: Record<string, number | readonly number[]>) {
  for (const k in vals) {
    const loc = p.u[k], v = vals[k];
    if (!loc) continue;
    if (typeof v === "number") gl.uniform1f(loc, v);
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
    else gl.uniform3f(loc, v[0], v[1], v[2]);
  }
}

type Shard = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; ang: number; size: number; life: number; color: RGB };
type Spark = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; fade: number; color: RGB };
type Mote = { a: number; r: number; z: number; v: number };
type Bubble = { x: number; y: number; z: number; v: number; size: number; ph: number };
type Ring = { age: number; n: number; color: RGB };

/** The player's shapes, as outlines round the point on the orbit: u outward, v along it. About 1.5x the old dart; the tip or the centre sits near the orbit. */
/** The player's size over its outline's numbers: big enough to find at a glance in the 720 by 390 panel. */
const PLAYER = 1.35;
const SHAPES: Record<SkinId, [number, number][]> = {
  dart: [[0.25, 0], [-0.09, -0.16], [-0.09, 0.16]],
  arrow: [[0.27, 0], [-0.1, -0.19], [-0.02, 0], [-0.1, 0.19]],
  diamond: [[0.25, 0], [0.04, -0.13], [-0.14, 0], [0.04, 0.13]],
  comet: Array.from({ length: 14 }, (_, i) => [0.03 + Math.cos((i / 14) * TAU) * 0.13, Math.sin((i / 14) * TAU) * 0.13] as [number, number]),
  star: Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 0.09 : 0.21, a = (i / 10) * TAU; return [0.02 + Math.cos(a) * r, Math.sin(a) * r] as [number, number]; }),
};

export class Renderer {
  private gl: WebGL2RenderingContext;
  private geo: Prog; private pre: Prog; private down: Prog; private up: Prog;
  private stages = new Map<StageId, { world: Prog; floor: Prog; fin: Prog }>();
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
  private sparks: Spark[] = [];
  private motes: Mote[] = [];
  private bubbles: Bubble[] = [];
  private rings: Ring[] = [];
  private trail: { a: number; t: number }[] = [];
  /** Real seconds (film grain and the replay's scanlines keep moving in slow motion); the song's smoothed tension; a near miss's flicker; the drop's glitch and own shockwave. */
  private clock = 0;
  private build = 0; private brk = 0; private drop = 0;
  private grazeK = 0; private glitch = 0; private dropShock = -1;
  private lastSection: SectionKind | undefined;
  lost = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("webgl2");
    this.gl = gl;
    this.hdr = !!gl.getExtension("EXT_color_buffer_float");
    gl.getExtension("OES_texture_float_linear");
    this.geo = program(gl, GEO_VS, GEO_FS);
    this.pre = program(gl, QUAD_VS, PREFILTER_FS);
    this.down = program(gl, QUAD_VS, DOWN_FS);
    this.up = program(gl, QUAD_VS, UP_FS);
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
    for (let i = 0; i < 70; i++) this.bubbles.push({ x: (Math.random() - 0.5) * 22, y: (Math.random() - 0.5) * 22, z: Math.random() * 7, v: 0.5 + Math.random(), size: 0.03 + Math.random() * 0.07, ph: Math.random() * TAU });
    canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
    // With ?dev, the renderer is reachable for staging moments (window.vxGfx.graze(...)).
    if (new URLSearchParams(location.search).has("dev")) Object.assign(window, { vxGfx: this });
  }

  /** A stage's world, floor and final pass, compiled the first time it is shown. */
  private stageProgs(id: StageId) {
    let s = this.stages.get(id);
    if (!s) {
      const i = STAGES.findIndex((x) => x.id === id), gl = this.gl;
      s = { world: program(gl, QUAD_VS, WORLD_FS, i), floor: program(gl, FLOOR_VS, FLOOR_FS, i), fin: program(gl, QUAD_VS, FINAL_FS, i) };
      this.stages.set(id, s);
    }
    return s;
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
  private quad(p: number[][], c: RGB | RGB[], a: number | number[] = 1) {
    const cs = Array.isArray(c[0]) ? (c as RGB[]) : [c as RGB, c as RGB, c as RGB, c as RGB];
    const as = typeof a === "number" ? [a, a, a, a] : a;
    for (const i of [0, 1, 2, 0, 2, 3]) this.v(p[i][0], p[i][1], p[i][2], cs[i], as[i]);
  }
  private polar(a: number, r: number, z: number) { return [Math.cos(a) * r, Math.sin(a) * r, z]; }
  /** A thin quad from one point to another, widened across in the floor's plane: motes, sparks, outlines. */
  private streak(p: number[], q: number[], w: number, c0: RGB, c1: RGB) {
    const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1, nx = (-dy / l) * w, ny = (dx / l) * w;
    this.quad([[p[0] - nx, p[1] - ny, p[2]], [p[0] + nx, p[1] + ny, p[2]], [q[0] + nx, q[1] + ny, q[2]], [q[0] - nx, q[1] - ny, q[2]]], [c0, c0, c1, c1]);
  }
  /** A closed outline of thin quads. */
  private loop(pts: number[][], w: number, c: RGB) { for (let i = 0; i < pts.length; i++) this.streak(pts[i], pts[(i + 1) % pts.length], w, c, c); }
  /** A soft disc lying flat: bright in the middle, nothing at its rim. */
  private glowDisc(x: number, y: number, z: number, r: number, c: RGB) {
    const zero: RGB = [0, 0, 0];
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * TAU, a1 = ((i + 1) / 16) * TAU;
      this.v(x, y, z, c); this.v(x + Math.cos(a0) * r, y + Math.sin(a0) * r, z, zero); this.v(x + Math.cos(a1) * r, y + Math.sin(a1) * r, z, zero);
    }
  }

  /** A wall's corners at a height: inner and outer, at both its angles (sides are straight, so radii stretch toward the corners). */
  private corners(a0: number, a1: number, r0: number, r1: number, z: number) {
    const k = 1 / Math.cos((a1 - a0) / 2);
    return [this.polar(a0, r0 * k, z), this.polar(a1, r0 * k, z), this.polar(a1, r1 * k, z), this.polar(a0, r1 * k, z)];
  }

  /**
   * A wall: a flat, bright top in the wall's colour (the shape you read), short dark sides, a bevel round the top, and the
   * edge facing in burning brightest of all. Colours come premultiplied by `alpha` (it fades in out of the world). Glass
   * (Prism) tints the top through the spectrum and lets the sides go see-through; the top stays nearly solid.
   */
  private prism(a0: number, a1: number, r0: number, r1: number, h: number, top: RGB, side: RGB, edge: RGB, alpha: number, glass: number, tint: RGB) {
    const [i0, i1, o1, o0] = this.corners(a0, a1, r0, r1, h);
    const g = (p: number[]) => [p[0], p[1], 0];
    const sa = alpha * (1 - glass * 0.6), ta = alpha * (1 - glass * 0.15);
    // Sides first, so a glass top shows them through it.
    this.quad([g(o1), g(o0), o0, o1], scale(side, 0.45), sa);
    this.quad([g(o0), g(i0), i0, o0], scale(side, 0.7), sa);
    this.quad([g(i1), g(o1), o1, i1], scale(side, 0.7), sa);
    this.quad([g(i0), g(i1), i1, i0], [scale(side, 0.6), scale(side, 0.6), scale(side, 1.4), scale(side, 1.4)], sa);
    // The top: one flat value, a touch brighter toward the inside; glass shades it through a spectrum toward the back.
    const back = glass ? mix(scale(top, 0.75), tint, 0.55) : scale(top, 0.9);
    this.quad([i0, i1, o1, o0], [scale(top, 1.05), scale(top, 1.05), back, back], ta);
    const z = h + 0.006, b = Math.min(0.035, (r1 - r0) * 0.3);
    const [j0, j1, p1, p0] = this.corners(a0 + b / r0, a1 - b / r0, r0, r1 - b, z);
    const bev = glass ? scale(mix(top, WHITE, 0.6), 1.6) : scale(mix(top, WHITE, 0.35), 1.25);
    // The bevel: a lighter rim on the top's sides and back, so each slab is a shape, not a smear.
    const [c0, c1, c2, c3] = this.corners(a0, a1, r0, r1, z);
    this.quad([c1, c2, p1, j1], bev, alpha); this.quad([c3, c0, j0, p0], bev, alpha); this.quad([c2, c3, p0, p1], scale(bev, 0.7), alpha);
    // The edge that will hit you, burning.
    const k = 1 / Math.cos((a1 - a0) / 2), e = Math.min(0.06, (r1 - r0) * 0.5) * k;
    this.quad([this.polar(a0, r0 * k, h + 0.012), this.polar(a1, r0 * k, h + 0.012), this.polar(a1, r0 * k + e, h + 0.012), this.polar(a0, r0 * k + e, h + 0.012)], edge, alpha);
  }

  /** A soft dark pool on the floor under and behind a wall: it sits the slab on the floor and darkens the floor at its edge. */
  private shadow(a0: number, a1: number, r0: number, r1: number, s: number) {
    const z = 0.003, pa = 0.1 / Math.max(r0, 0.5);
    const inner = this.corners(a0, a1, r0, r1, z), outer = this.corners(a0 - pa, a1 + pa, r0 - 0.05, r1 + 0.45, z);
    const K: RGB = [0, 0, 0];
    this.quad(inner, K, s);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; this.quad([inner[i], outer[i], outer[j], inner[j]], K, [s, 0, 0, s]); }
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
  clearTrail() { this.trail = []; this.sparks = []; }
  /**
   * A near miss: hot sparks off the point where the wall's edge crossed the orbit, thrown along it away from the wall and
   * outward, and a flicker on the player. `edge` is in the sim's angles (a wall's a0/a1, like Frame.a); strength 0..1.
   */
  graze(f: Frame, edge: number, strength: number) {
    const s = clamp01(strength), r = FEEL.orbit, ex = Math.cos(edge) * r, ey = Math.sin(edge) * r;
    let d = f.a - edge; d = Math.atan2(Math.sin(d), Math.cos(d));
    const side = d >= 0 ? 1 : -1, tx = -Math.sin(edge) * side, ty = Math.cos(edge) * side, nx = Math.cos(edge), ny = Math.sin(edge);
    const hot = lin(mix(f.look.wall, WHITE, 0.6));
    for (let i = 0, n = 6 + Math.round(16 * s); i < n && this.sparks.length < 600; i++) {
      const sp = 2 + Math.random() * 5 * (0.5 + s), out = (Math.random() - 0.2) * 0.9;
      this.sparks.push({ x: ex, y: ey, z: 0.2, vx: (tx + nx * out) * sp, vy: (ty + ny * out) * sp, vz: Math.random() * 1.5, life: 1, fade: 2.6 + Math.random() * 2, color: i % 3 ? hot : WHITE });
    }
    this.grazeK = Math.max(this.grazeK, 0.4 + 0.6 * s);
  }

  // ---- a frame --------------------------------------------------------------------------------------------------------

  draw(f: Frame, dt: number) {
    if (this.lost) return;
    this.resize();
    const gl = this.gl, L = f.look, S: StageId = f.stage ?? "pulse", P = this.stageProgs(S), W = WORLD[S];
    this.clock += dt;
    const wall = lin(L.wall), core = lin(L.core), player = lin(L.player);
    const kickEnv = Math.exp(-f.kick * 9), snareEnv = Math.exp(-f.snare * 8);
    const live = 1 - f.calm;

    // The song: a build tightens, a drop explodes (its first beat white-hot), a break calms. Smoothed so sections blend.
    const e = f.energy ?? 0.6, sec = f.section, sb = f.sectionBeats ?? 0, sl = Math.max(1, f.sectionLen ?? 16);
    const ease1 = (x: number, to: number, rate: number) => x + (to - x) * Math.min(1, dt * rate);
    this.build = ease1(this.build, sec === "build" ? clamp01(sb / sl) * e : 0, 8);
    this.brk = ease1(this.brk, sec === "break" ? 1 : 0, 2.5);
    this.drop = ease1(this.drop, sec === "drop" ? e : 0, 4);
    const hot = sec === "drop" ? Math.exp(-Math.max(0, sb) * 3) * e * live : 0;
    if (sec === "drop" && this.lastSection && this.lastSection !== "drop") {
      this.dropShock = 0;
      if (S === "overdrive") this.glitch = 1;
    }
    this.lastSection = sec;
    if (this.dropShock >= 0) { this.dropShock += dt; if (this.dropShock > 0.9) this.dropShock = -1; }
    if (S === "overdrive" && sec === "drop" && snareEnv > 0.9 && e > 0.8 && Math.random() < dt * 6) this.glitch = Math.max(this.glitch, 0.45);
    this.glitch *= Math.exp(-dt * 5);
    this.grazeK *= Math.exp(-dt * 12);
    const hyper = f.hyper ? 1 : 0;
    const k = Math.min(1.4, ((0.45 + 0.55 * e) * (1 - 0.35 * this.brk) + 0.2 * this.drop + hot) * (1 - 0.5 * f.calm) * (1 + 0.25 * hyper));
    const bo = clamp01(f.blackout ?? 0), lights = 1 - 0.93 * bo;
    const killer = f.killer ?? null, rp = killer ? clamp01(Math.max(f.replay ?? 0, 0.6)) : 0;
    const pump = 1 + 0.05 * kickEnv * live;

    // Camera: tilted, circling slowly, shaken; creeping in through a build, wide in a break, punched in on the drop.
    const tilt = (f.tilt * Math.PI) / 180, D = (17 / (f.zoom * pump)) * (1 - 0.06 * this.build) * (1 + 0.04 * this.brk) * (1 - 0.03 * hot);
    const sx = (Math.random() - 0.5) * f.shake, sy = (Math.random() - 0.5) * f.shake;
    const eye: V3 = [Math.sin(tilt) * Math.cos(f.az) * D + sx, Math.sin(tilt) * Math.sin(f.az) * D + sy, Math.cos(tilt) * D];
    const up: V3 = [-Math.cos(f.az), -Math.sin(f.az), 0];
    const fov = (38 * Math.PI) / 180, aspect = this.w / this.h;
    const cam = lookAt(eye, [sx * 0.3, sy * 0.3, 0], up);
    const vp = mul(perspective(fov, aspect, 2, 90), cam.m);
    const md = model(f.rot, 1);
    const ctr = project(vp, 0, 0, 0);
    let orb = 0;
    for (let i = 0; i < 4; i++) { const q = project(vp, Math.cos((i * TAU) / 4) * FEEL.orbit, Math.sin((i * TAU) / 4) * FEEL.orbit, 0); orb += Math.hypot((q[0] - ctr[0]) * aspect, q[1] - ctr[1]) / 4; }

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msaa!.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);

    // The world under it all.
    const dimWorld = lights * (1 - 0.45 * f.calm) * (1 - 0.3 * rp) * (1 - 0.3 * this.brk);
    gl.useProgram(P.world.p);
    set(gl, P.world, {
      eye, cx: cam.x, cy: cam.y, cz: [-cam.z[0], -cam.z[1], -cam.z[2]], ax: norm([-eye[0], -eye[1], -eye[2]]), tanH: [Math.tan(fov / 2) * aspect, Math.tan(fov / 2)],
      time: f.time, beats: f.beats, spin: f.rot, kick: kickEnv * live, k, hot, hyper, dim: dimWorld, build: this.build,
      A: lin(L.bgA), B: lin(L.bgB), W: wall, C: core,
    });
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // The floor over it: calm stripes (low contrast, so walls stand off them), glassy far out.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(P.floor.p);
    gl.uniformMatrix4fv(P.floor.u.vp, false, vp); gl.uniformMatrix4fv(P.floor.u.model, false, md);
    const lift = 1 + snareEnv * 0.15 * live;
    set(gl, P.floor, {
      A: scale(L.bgA, 0.5 * lift), B: scale(mix(L.bgA, L.bgB, 0.6), 0.62 * lift), glow: wall, C: core,
      n: f.n, nFrom: f.nFrom, morph: f.morph, time: f.time, kick: kickEnv * live + hot, swap: f.swap, speed: f.speed, calm: f.calm,
      far: W.far, k, dim: lights * (1 - 0.35 * rp), beats: f.beats,
    });
    gl.bindVertexArray(this.floorVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Solid geometry: walls (premultiplied, so far ones dissolve into the world), the centre, the player.
    this.count = 0;
    const coreA = FEEL.core * (1 + 0.1 * kickEnv * live);
    const hWall = 0.16 + 0.05 * kickEnv;
    const edge = scale(mix(wall, WHITE, 0.5), 2.4 * (1 + 0.3 * bo));
    const glass = S === "prism" ? 1 : 0;
    const shown: { w: Wall; r0: number; r1: number; fog: number }[] = [];
    for (const w of f.walls) {
      const r0 = Math.max(w.r + f.rewind, coreA * 0.98), r1 = w.r + w.len + f.rewind;
      if (r1 <= r0) continue;
      // Out of the world far away, solid close in.
      const fog = 1 - smooth(7, FEEL.spawn - 0.3, r0);
      if (fog > 0.01) shown.push({ w, r0, r1, fog });
    }
    for (const s of shown) this.shadow(s.w.a0, s.w.a1, s.r0, s.r1, (glass ? 0.3 : 0.6) * s.fog);
    for (let i = 0; i < shown.length; i++) {
      const { w, r0, r1, fog } = shown[i];
      const dimW = killer && w.id !== killer.id ? 1 - 0.45 * rp : 1;
      const lit = lights * dimW;
      const top = scale(wall, (glass ? 0.95 : 1.0) * fog * lit), side = scale(wall, 0.22 * fog * lit);
      const tint = scale(spectrum(((w.a0 + w.a1) / 2) / TAU + f.time * 0.1), 0.8 * fog * lit);
      // Heights differ a hair, so walls that overlap (a tunnel's and a row's) never fight for the same plane.
      this.prism(w.a0, w.a1, r0, r1, hWall + (i % 5) * 0.006, top, side, scale(edge, fog * dimW), fog, glass, tint);
    }
    this.centre(f, coreA, core, wall, kickEnv, lights);
    if (f.player > 0) this.ship(f, player);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    this.flush(vp, md);

    // Light: trail, halo, ghost, the killer's outline, sparks, motes, rings, shards, added on top.
    this.count = 0;
    this.lights(f, dt, S, wall, core, player, kickEnv, lights, cam, killer, rp, coreA, hWall);
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
    const pass = (p: Prog, src: Target, dst: Target | null, vals?: Record<string, number>) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
      gl.viewport(0, 0, dst ? dst.w : this.w, dst ? dst.h : this.h);
      gl.useProgram(p.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(p.u.src ?? p.u.scene, 0);
      gl.uniform2f(p.u.texel, 1 / src.w, 1 / src.h);
      if (vals) set(gl, p, vals);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    // Wall tops sit under the threshold, so only edges, the core and the player glow: slabs stay crisp.
    pass(this.pre, sc, this.mips[0], { threshold: this.hdr ? 1.25 : 0.8 });
    for (let i = 1; i < this.mips.length; i++) pass(this.down, this.mips[i - 1], this.mips[i]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.mips.length - 1; i > 0; i--) pass(this.up, this.mips[i], this.mips[i - 1], { gain: 0.75 });
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    const fin = P.fin;
    gl.useProgram(fin.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sc.tex); gl.uniform1i(fin.u.scene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.mips[0].tex); gl.uniform1i(fin.u.bloom, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.mips[Math.min(1, this.mips.length - 1)].tex); gl.uniform1i(fin.u.rays, 2);
    const shock = f.shock >= 0 ? f.shock : this.dropShock;
    const water = S === "undertow" ? scale(mix(lin(L.bgB), core, 0.08), 1.4) : [0, 0, 0] as RGB;
    set(gl, fin, {
      res: [this.w, this.h], ctr, orb,
      bloomK: (this.hdr ? 0.5 : 0.75) * (1 + 0.35 * kickEnv * live) * (1 + 0.25 * this.drop + 0.8 * hot) * (1 - 0.2 * this.brk),
      aberr: f.aberr + 0.0014 + 0.002 * kickEnv * live + 0.003 * this.build,
      flash: f.flash + 0.16 * hot, desat: f.desat, hue: f.hue * TAU, time: f.time, clock: this.clock, shock,
      vignette: 0.55 + f.calm * 0.25 + 0.25 * bo + 0.15 * this.brk, exposure: (1.1 - f.calm * 0.35) * (1 + 0.35 * hot) * (1 - 0.12 * this.brk),
      raysK: W.rays * k * (0.6 + 0.8 * kickEnv) * lights, k, kick: kickEnv, invert: clamp01(f.invert ?? 0), replay: killer ? rp : 0,
      glitch: this.glitch, scan: S === "overdrive" ? Math.max(f.swap * 0.8, 0.5 * this.drop * kickEnv) : 0, lens: 0.0025 * (1 + 0.5 * hyper) * (0.7 + 0.3 * k),
      streaks: S === "overdrive" ? k * (0.15 + 0.6 * this.drop + 0.6 * this.build) : 0, W: wall, fog: water,
    });
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

  /** The centre's outline (morphing between side counts), at an apothem. */
  private corePts(f: Frame, apo: number) {
    const m = Math.max(f.n, f.nFrom), t = ease(f.morph), pts: number[][] = [];
    for (let k = 0; k <= m; k++) {
      const at = (n: number) => { const kk = Math.min(k, n); const a = (TAU * kk) / n; const rr = apo / Math.cos(Math.PI / n); return [Math.cos(a) * rr, Math.sin(a) * rr]; };
      const p0 = at(f.nFrom), p1 = at(f.n);
      pts.push([lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)]);
    }
    return pts;
  }

  /** The centre: a raised polygon, dark inside a burning rim (black as a hole in the Singularity). */
  private centre(f: Frame, apo: number, core: RGB, wall: RGB, kick: number, lights: number) {
    const pts = this.corePts(f, apo), m = pts.length - 1;
    const hole = f.stage === "singularity";
    const h = 0.34, rim = 0.11, inner = hole ? [0, 0, 0] as RGB : scale(lin(f.look.bgA), 1.4 * lights), rimC = scale(core, (2.2 + 1.6 * kick) * (0.4 + 0.6 * lights));
    const mid = hole ? [0, 0, 0] as RGB : scale(wall, 0.25 * lights);
    for (let k = 0; k < m; k++) {
      const [a, b] = [pts[k], pts[k + 1]];
      const ia = [a[0] * (1 - rim / apo), a[1] * (1 - rim / apo)], ib = [b[0] * (1 - rim / apo), b[1] * (1 - rim / apo)];
      this.v(0, 0, h, mid); this.v(ia[0], ia[1], h, inner); this.v(ib[0], ib[1], h, inner);
      this.quad([[ia[0], ia[1], h], [ib[0], ib[1], h], [b[0], b[1], h], [a[0], a[1], h]], rimC);
      this.quad([[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], h], [a[0], a[1], h]], [scale(core, 0.2 * lights), scale(core, 0.2 * lights), scale(core, 0.9 * lights), scale(core, 0.9 * lights)]);
    }
  }

  /** Where a skin's outline point (u out, v along) lands for a player at angle a, leaning into its turn. */
  private shapePts(f: Frame, a: number, z: number, grow = 1) {
    const sk = f.skin ?? "dart", n = [Math.cos(a), Math.sin(a)], t = [-n[1], n[0]], lean = f.dir * 0.22, r = FEEL.orbit;
    const spin = sk === "star" ? f.time * 2.5 : 0, cu = sk === "star" ? 0.02 : 0;
    return SHAPES[sk].map(([u0, v0]) => {
      let u = u0, v = v0;
      if (spin) { const du = u - cu, c = Math.cos(spin), s = Math.sin(spin); u = cu + du * c - v * s; v = du * s + v * c; }
      u *= grow * PLAYER; v *= grow * PLAYER;
      v += lean * (0.04 + 0.5 * Math.max(u, 0));
      return [n[0] * (r + u) + t[0] * v, n[1] * (r + u) + t[1] * v, z];
    });
  }

  /** The player: a dark rim, then the shape as a lit gem (facets catch the light as the world turns), bright and solid, even in a blackout. */
  private ship(f: Frame, color: RGB) {
    const z = 0.2, pts = this.shapePts(f, f.a, z), n = pts.length;
    const cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
    // A dark rim round it, so it reads on any floor and against any glow.
    const rimPts = this.shapePts(f, f.a, z - 0.012, 1.55), K: RGB = [0, 0, 0];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.v(cx, cy, z - 0.012, K, 0.95); this.v(rimPts[i][0], rimPts[i][1], rimPts[i][2], K, 0.95); this.v(rimPts[j][0], rimPts[j][1], rimPts[j][2], K, 0.95); }
    const flick = 1 + 0.9 * this.grazeK, base = scale(mix(color, WHITE, 0.3), 3.6 * f.player * flick);
    const L = norm([0.35, 0.45, 1]);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], apex = [cx, cy, z + 0.06];
      const nn = norm(cross([p[0] - apex[0], p[1] - apex[1], p[2] - apex[2]], [q[0] - apex[0], q[1] - apex[1], q[2] - apex[2]]));
      const c = scale(base, 0.8 + 0.4 * Math.abs(dot(nn, L as V3)));
      this.v(apex[0], apex[1], apex[2], scale(base, 1.15)); this.v(p[0], p[1], p[2], c); this.v(q[0], q[1], q[2], c);
      const g = (x: number[]) => [x[0], x[1], 0.02];
      this.quad([g(p), g(q), q, p], scale(color, 1.2 * f.player));
    }
    this.trail.push({ a: f.a, t: f.time });
    while (this.trail.length && f.time - this.trail[0].t > 0.34) this.trail.shift();
    if (this.trail.length > 1 && this.trail[this.trail.length - 2].t > f.time) this.trail = this.trail.slice(-1);
    if (f.trail === "sparks" && f.player > 0) {
      // Shed from the back, drifting off behind the turn and outward.
      const back = this.shapePts(f, f.a, z)[0], d = f.dir || 0;
      for (let i = 0; i < 2 && this.sparks.length < 600; i++) {
        const tx = Math.sin(f.a) * d, ty = -Math.cos(f.a) * d, nx = Math.cos(f.a), ny = Math.sin(f.a), sp = 0.4 + Math.random() * 1.2;
        this.sparks.push({ x: lerp(back[0], cx, 0.6), y: lerp(back[1], cy, 0.6), z, vx: (tx * 1.5 + nx * (Math.random() - 0.3)) * sp + (Math.random() - 0.5) * 0.6, vy: (ty * 1.5 + ny * (Math.random() - 0.3)) * sp + (Math.random() - 0.5) * 0.6, vz: Math.random() * 0.4, life: 1, fade: 1.6 + Math.random() * 1.4, color: Math.random() < 0.5 ? color : lin(f.look.wall) });
      }
    }
  }

  private lights(f: Frame, dt: number, S: StageId, wall: RGB, core: RGB, player: RGB, kick: number, lights: number, cam: { x: V3; y: V3 }, killer: Wall | null, rp: number, coreA: number, hWall: number) {
    const r = FEEL.orbit, ax = Math.cos(f.a) * r, ay = Math.sin(f.a) * r;
    // Nothing busy near the orbit: motes and bubbles fade out inside three apothems.
    const near = (d: number) => smooth(2.4, 3.6, d);

    // The trail.
    if (f.player > 0) this.trailLight(f, player, wall);
    // The player's halo, on the floor: it is found at a glance on any stage.
    if (f.player > 0) this.glowDisc(ax, ay, 0.03, 0.42 + 0.15 * this.grazeK, scale(mix(wall, player, 0.3), (0.7 + 1.5 * this.grazeK) * f.player));

    // The ghost of your best run: a faint flickering hologram of your shape, never brighter than you.
    if (f.ghost && f.ghost.alpha > 0) {
      const g = f.ghost, flick = (0.75 + 0.25 * Math.sin(this.clock * 37)) * (Math.sin(this.clock * 5.3) > 0.93 ? 0.35 : 1);
      const holo = scale(mix(player, [0.35, 0.9, 1], 0.6), g.alpha * flick);
      const pts = this.shapePts({ ...f, dir: 0 }, g.a, 0.2);
      const n = pts.length, cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
      for (let i = 0; i < n; i++) { const q = pts[(i + 1) % n]; this.v(cx, cy, 0.2, scale(holo, 0.25)); this.v(pts[i][0], pts[i][1], 0.2, scale(holo, 0.12)); this.v(q[0], q[1], 0.2, scale(holo, 0.12)); }
      this.loop(pts, 0.008, scale(holo, 0.9));
      this.glowDisc(Math.cos(g.a) * r, Math.sin(g.a) * r, 0.03, 0.3, scale(holo, 0.18));
    }

    // The wall that killed you, outlined red-white and pulsing.
    if (killer) {
      const r0 = Math.max(killer.r + f.rewind, coreA * 0.98), r1 = killer.r + killer.len + f.rewind;
      if (r1 > r0) {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 11);
        // Pure red at a moderate level: tone mapping turns any bright colour with a little green in it white.
        const red: RGB = [1, 0.025, 0.015], c = scale(mix(red, WHITE, 0.05 * pulse), (2 + 2 * pulse) * Math.max(rp, 0.5));
        const zt = hWall + 0.04, top = this.corners(killer.a0, killer.a1, r0, r1, zt), bot = this.corners(killer.a0, killer.a1, r0, r1, 0.01);
        this.quad(top, scale(red, (0.5 + 0.5 * pulse) * Math.max(rp, 0.5)));
        this.loop(top, 0.024, c); this.loop(top, 0.08, scale(c, 0.2)); this.loop(bot, 0.016, scale(c, 0.6));
        for (let i = 0; i < 4; i++) this.streak(bot[i], top[i], 0.018, scale(c, 0.6), c);
      }
    }

    // The centre's heart: rings sinking in on the beat, a hot point; a photon ring and a spiral for the Singularity.
    const h = 0.345, beatT = f.beats - Math.floor(f.beats);
    for (let j = 0; j < 3; j++) {
      const t = (beatT + j / 3) % 1, pts = this.corePts(f, coreA * 0.85 * (1 - t) + 0.05).map((p) => [p[0], p[1], h]);
      pts.pop();
      this.loop(pts, 0.008, scale(core, 2.2 * t * (1 - t) * (0.5 + kick) * lights));
    }
    if (S === "singularity") {
      const arms = 3, spin = f.time * 5;
      for (let j = 0; j < arms; j++) for (let s = 0; s < 10; s++) {
        const t0 = s / 10, t1 = (s + 1) / 10, a0 = spin + (j * TAU) / arms + t0 * 2.4, a1 = spin + (j * TAU) / arms + t1 * 2.4;
        this.streak(this.polar(a0, coreA * 0.8 * (1 - t0 * 0.85), h), this.polar(a1, coreA * 0.8 * (1 - t1 * 0.85), h), 0.012, scale(core, 1.6 * (1 - t0)), scale(core, 1.6 * (1 - t1)));
      }
    } else this.glowDisc(0, 0, h + 0.002, 0.12 + 0.06 * kick, scale(core, (0.8 + 1.2 * kick) * lights));

    // Prism: the glass throws a spectrum on the floor behind each wall.
    if (S === "prism") for (const w of f.walls) {
      const r0 = w.r + w.len + f.rewind, fog = 1 - smooth(6, FEEL.spawn - 0.5, r0);
      if (fog <= 0.01 || r0 < 2.6) continue;
      const am = (w.a0 + w.a1) / 2, hw = (w.a1 - w.a0) / 2;
      for (let b = 0; b < 3; b++) {
        const c = scale(spectrum(b / 3 + am / TAU + f.time * 0.15), 0.1 * fog * lights);
        const a0 = am - hw + (b * 2 * hw) / 3, a1 = am - hw + ((b + 1) * 2 * hw) / 3;
        this.quad([this.polar(a0, r0 + 0.05, 0.01), this.polar(a1, r0 + 0.05, 0.01), this.polar(a1, r0 + 0.8, 0.01), this.polar(a0, r0 + 0.8, 0.01)], [c, c, [0, 0, 0], [0, 0, 0]]);
      }
    }

    // Motes rushing in with the walls: swirling in Drift, spiralling in the Singularity, glints in Prism, long in Overdrive.
    if (S !== "undertow") {
      const mc = scale(wall, (0.8 + kick * 0.6) * lights);
      const sp = f.speed * (1 - f.calm * 0.7) * (1 + 2.2 * this.build) * (1 - 0.5 * this.brk);
      const swirl = S === "drift" ? 0.9 : S === "singularity" ? 3 : 0, long = S === "overdrive" ? 2 : 1;
      for (const m of this.motes) {
        const v = sp * m.v * (S === "singularity" ? 1.6 / Math.sqrt(Math.max(m.r, 0.5) / 3) : 1);
        m.r -= v * dt;
        m.a += (swirl / Math.max(m.r, 1)) * dt * (1 + this.build);
        if (m.r < FEEL.core) { m.r = 10 + Math.random() * 6; m.a = Math.random() * TAU; m.z = Math.random() * 2.2; }
        const fade = near(m.r) * (1 - smooth(9, 15, m.r)) * 0.55;
        if (fade <= 0.01) continue;
        const len = (0.08 + f.speed * 0.03) * long * (1 + this.build), lt = len / Math.max(v, 0.1);
        const c = S === "prism" ? scale(spectrum(m.v * 3 + f.time * 0.2), 1.2 * fade * lights) : scale(mc, fade);
        this.streak(this.polar(m.a, m.r, m.z), this.polar(m.a - (swirl / Math.max(m.r, 1)) * lt, m.r + len, m.z), 0.012, c, [0, 0, 0]);
      }
    } else {
      // Undertow: bubbles rising past you toward the light, wobbling, facing the camera.
      const c = Math.cos(-f.rot), s = Math.sin(-f.rot);
      const R = [cam.x[0] * c - cam.x[1] * s, cam.x[0] * s + cam.x[1] * c, cam.x[2]], U = [cam.y[0] * c - cam.y[1] * s, cam.y[0] * s + cam.y[1] * c, cam.y[2]];
      for (const b of this.bubbles) {
        b.z += b.v * dt * (1 - f.calm * 0.6) * (1 + this.build); b.ph += dt * 3;
        if (b.z > 7) { b.z = 0; b.x = (Math.random() - 0.5) * 22; b.y = (Math.random() - 0.5) * 22; }
        const fade = near(Math.hypot(b.x, b.y)) * smooth(0, 0.6, b.z) * (1 - smooth(5, 7, b.z)) * lights;
        if (fade <= 0.01) continue;
        const x = b.x + Math.sin(b.ph) * 0.12, y = b.y + Math.cos(b.ph * 0.8) * 0.12, rr = b.size, col = scale(mix(core, WHITE, 0.4), 0.9 * fade);
        const at = (a: number, k: number) => [x + (R[0] * Math.cos(a) + U[0] * Math.sin(a)) * rr * k, y + (R[1] * Math.cos(a) + U[1] * Math.sin(a)) * rr * k, b.z + (R[2] * Math.cos(a) + U[2] * Math.sin(a)) * rr * k];
        for (let i = 0; i < 8; i++) { const a0 = (i / 8) * TAU, a1 = ((i + 1) / 8) * TAU; this.quad([at(a0, 0.7), at(a1, 0.7), at(a1, 1), at(a0, 1)], col); }
        const hl = at(2.2, 0.45);
        this.v(hl[0], hl[1], hl[2], scale(col, 1.5)); const h2 = at(2.0, 0.25), h3 = at(2.4, 0.25); this.v(h2[0], h2[1], h2[2], [0, 0, 0]); this.v(h3[0], h3[1], h3[2], [0, 0, 0]);
      }
    }

    // Sparks: near misses and the sparks trail, streaked along their flight.
    for (const s of this.sparks) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      const drag = Math.exp(-dt * 3.5); s.vx *= drag; s.vy *= drag; s.vz *= drag;
      s.life -= dt * s.fade;
      if (s.life <= 0) continue;
      const k = s.life * s.life, c = scale(s.color, 3.2 * k);
      this.streak([s.x, s.y, s.z], [s.x - s.vx * 0.04, s.y - s.vy * 0.04, s.z], 0.01, c, scale(c, 0.1));
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);

    // Rings out of the centre.
    for (const g of this.rings) {
      g.age += dt;
      const t = g.age / 1.1, apo = FEEL.core + t * 14, wdt = 0.08 + t * 0.5, kk = Math.pow(1 - t, 2) * 3;
      const c = scale(lin(g.color), kk);
      for (let i = 0; i < g.n; i++) {
        const a0 = (TAU * i) / g.n, a1 = (TAU * (i + 1)) / g.n, kc = 1 / Math.cos(Math.PI / g.n);
        this.quad([this.polar(a0, apo * kc, 0.05), this.polar(a1, apo * kc, 0.05), this.polar(a1, (apo + wdt) * kc, 0.05), this.polar(a0, (apo + wdt) * kc, 0.05)], [c, c, scale(c, 0), scale(c, 0)]);
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

  /** The trail behind the player: a line, a wide fading ribbon, sparks (shed in ship()) with a thin line, or a rainbow ribbon. */
  private trailLight(f: Frame, player: RGB, wall: RGB) {
    const kind = f.trail ?? "line", tr = this.trail, r = FEEL.orbit, z = 0.19;
    const life = kind === "ribbon" || kind === "prism" ? 0.32 : kind === "sparks" ? 0.1 : 0.16;
    for (let i = 1; i < tr.length; i++) {
      const a0 = tr[i - 1].a, a1 = tr[i].a;
      if (Math.abs(a1 - a0) > Math.PI || Math.abs(a1 - a0) < 1e-4) continue;
      const k0 = 1 - (f.time - tr[i - 1].t) / life, k1 = 1 - (f.time - tr[i].t) / life;
      if (k1 <= 0) continue;
      const q0 = Math.max(0, k0), q1 = k1;
      const band = (w0: number, w1: number, o0: number, o1: number, c0: RGB, c1: RGB) =>
        this.quad([this.polar(a0, r + o0 - w0, z), this.polar(a1, r + o1 - w1, z), this.polar(a1, r + o1 + w1, z), this.polar(a0, r + o0 + w0, z)], [c0, c1, c1, c0]);
      if (kind === "ribbon") {
        const c = (q: number) => scale(mix(wall, player, q), 1.8 * Math.pow(q, 1.5) * f.player);
        band(0.02 + 0.1 * q0, 0.02 + 0.1 * q1, 0, 0, c(q0), c(q1));
        band(0.015 * q0, 0.015 * q1, 0, 0, scale(player, 2.5 * q0 * q0 * f.player), scale(player, 2.5 * q1 * q1 * f.player));
      } else if (kind === "prism") {
        // Four bands across it, through the spectrum, the colours flowing along.
        for (let b = 0; b < 4; b++) {
          const w0 = 0.025 + 0.085 * q0, w1 = 0.025 + 0.085 * q1, s0 = w0 / 4, s1 = w1 / 4;
          const c = (q: number) => scale(spectrum(b / 4 + f.time * 0.6 + q * 0.3), 2 * Math.pow(q, 1.5) * f.player);
          band(s0, s1, -w0 + s0 * (2 * b + 1), -w1 + s1 * (2 * b + 1), c(q0), c(q1));
        }
      } else {
        const w = kind === "sparks" ? 0.025 : 0.05;
        band(w * q0, w * q1, 0, 0, scale(player, 2.2 * q0 * q0 * f.player), scale(player, 2.2 * q1 * q1 * f.player));
      }
    }
  }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
