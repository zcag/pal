// Looks: other ways to finish the frame, to see which suits the game best.
// `?look=<id>` picks one, L cycles them. The plain look is render.ts's own
// chain; every other one draws the scene into a target that keeps its depth
// (for occlusion, outlines, focus and haze), then runs its passes:
//   scene -> [hdr passes] -> bloom -> finish (speed blur, hit, dim) -> tone map -> [display passes]
// A look may also change how the scene's materials shade (toon bands).
import * as THREE from "./vendor/three.js";
import { EffectComposer, UnrealBloomPass, ShaderPass, OutputPass } from "./vendor/three.js";
import { FINISH, type Fx } from "./render.ts";

const VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }";
const COMMON = `#include <packing>
  uniform sampler2D tDiffuse, tDepth; uniform float cNear, cFar, time, dpr; uniform vec2 res; varying vec2 vUv;
  float lz(vec2 uv){ return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cNear, cFar); }
  float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  vec3 sat(vec3 c, float s){ return max(mix(vec3(luma(c)), c, s), 0.0); }
`;
const U = () => ({ tDiffuse: { value: null }, tDepth: { value: null }, cNear: { value: 0.1 }, cFar: { value: 4000 }, time: { value: 0 }, dpr: { value: 1 }, res: { value: new THREE.Vector2(1, 1) } });
type Uniforms = Record<string, { value: unknown }>;
const pass = (fragment: string, extra: Uniforms = {}) => ({ uniforms: { ...U(), ...extra }, vertexShader: VS, fragmentShader: COMMON + fragment });

// ------------------------------------------------------------ cinematic

/** Occlusion where surfaces meet, from depth alone: on a plane 1/z is linear across the screen, so a pair
 *  of neighbours whose mean 1/z is above ours stands in front of the plane. Only near occluders count
 *  (within the probe's own radius), so a car darkens the road it sits on, not the road behind it. */
const CINE_AO = pass(`uniform float aoAmt;
  void main(){
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float z = lz(vUv), w = 1.0 / z;
    float ppm = res.y * 1.3 / z; // screen pixels per metre at this depth
    float occ = 0.0, rot = hash(gl_FragCoord.xy) * 0.39;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.3927 + rot;
      vec2 dir = vec2(cos(a), sin(a));
      for (int k = 0; k < 2; k++) {
        float m = k == 0 ? 0.2 : 0.5;
        vec2 o = dir * clamp(ppm * m, 1.5 * dpr, 40.0 * dpr) / res;
        float z1 = lz(vUv + o), z2 = lz(vUv - o);
        float ex = (0.5 / z1 + 0.5 / z2 - w) * z * z; // metres in front of the plane
        occ += smoothstep(0.01, m * 0.4, ex) * (1.0 - smoothstep(m, m * 2.5, ex));
      }
    }
    float ao = 1.0 - aoAmt * min(occ / 10.0, 1.0) * (1.0 - smoothstep(30.0, 70.0, z)); // near only: far terrain folds are not contact
    gl_FragColor = vec4(c * ao, 1.0);
  }`, { aoAmt: { value: 0.7 } });

/** Anamorphic streaks: the bloom's own bright, blurred quarter-size image smeared sideways, in blue. */
const CINE_STREAK = pass(`uniform sampler2D tBloom; uniform float streak;
  void main(){
    vec3 st = vec3(0.0);
    for (int i = -24; i <= 24; i++) {
      vec3 a = texture2D(tBloom, vUv + vec2(float(i) * 6.0 * dpr / res.x, 0.0)).rgb;
      st += max(a - 0.6, 0.0) * exp(-abs(float(i)) * 0.09);
    }
    gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb + st * vec3(0.35, 0.55, 1.0) * streak, 1.0);
  }`, { tBloom: { value: null }, streak: { value: 0.06 } });

/** A film grade on the tone-mapped frame: a filmic S-curve, cool shadows with a lifted blue floor, warm
 *  highlights, greens pulled toward olive, lateral fringing at the edges, a vignette and moving grain. */
const CINE_GRADE = pass(`
  void main(){
    vec2 d = vUv - 0.5;
    vec2 ca = d * dot(d, d) * 0.014;
    vec3 c = vec3(texture2D(tDiffuse, vUv + ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - ca).b);
    c = clamp(c, 0.0, 1.0);
    c.g -= 0.25 * max(c.g - max(c.r, c.b), 0.0);                       // greens toward olive
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.55);                          // contrast
    float l = luma(c);
    c *= mix(vec3(0.86, 0.98, 1.08), vec3(1.0), smoothstep(0.0, 0.5, l)); // teal shadows
    c *= mix(vec3(1.0), vec3(1.08, 1.0, 0.86), smoothstep(0.45, 1.0, l)); // warm highlights
    c += vec3(0.006, 0.02, 0.045) * (1.0 - l) * (1.0 - l);              // a blue floor: night stays legible
    c = sat(c, 0.94);
    c *= mix(1.0, smoothstep(1.05, 0.2, length(d * vec2(1.25, 1.0))), 0.5);
    float g = hash(floor(gl_FragCoord.xy / max(dpr, 1.0)) + fract(time * 7.13) * vec2(91.7, 37.3)) - 0.5;
    c += g * 0.045 * (1.0 - 0.6 * l);
    gl_FragColor = vec4(c, 1.0);
  }`);

// ------------------------------------------------------------ painterly

/** Generalized Kuwahara (Kyprianidis's polynomial sectors): each pixel takes the mean of the
 *  least varied of eight sectors around it, so flat areas become strokes and edges stay. */
const KUWAHARA = pass(`uniform float radius, stride, hard;
  void main(){
    vec4 m[8]; vec3 s[8];
    for (int k = 0; k < 8; k++) { m[k] = vec4(0.0); s[k] = vec3(0.0); }
    float zeta = 2.0 / radius, zc = 0.58, sz = sin(zc), eta = (zeta + cos(zc)) / (sz * sz);
    int R = int(radius);
    for (int y = -R; y <= R; y++) for (int x = -R; x <= R; x++) {
      vec2 v = vec2(float(x), float(y)) / radius;
      if (dot(v, v) > 1.0) continue;
      vec3 c = clamp(texture2D(tDiffuse, vUv + vec2(float(x), float(y)) * stride / res).rgb, 0.0, 1.0);
      float w[8], z, vxx, vyy, sum = 0.0;
      vxx = zeta - eta * v.x * v.x; vyy = zeta - eta * v.y * v.y;
      z = max(0.0, v.y + vxx); w[0] = z * z; z = max(0.0, -v.x + vyy); w[2] = z * z;
      z = max(0.0, -v.y + vxx); w[4] = z * z; z = max(0.0, v.x + vyy); w[6] = z * z;
      vec2 r = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
      vxx = zeta - eta * r.x * r.x; vyy = zeta - eta * r.y * r.y;
      z = max(0.0, r.y + vxx); w[1] = z * z; z = max(0.0, -r.x + vyy); w[3] = z * z;
      z = max(0.0, -r.y + vxx); w[5] = z * z; z = max(0.0, r.x + vyy); w[7] = z * z;
      for (int k = 0; k < 8; k++) sum += w[k];
      float g = exp(-3.125 * dot(v, v)) / max(sum, 1e-5);
      for (int k = 0; k < 8; k++) { float wk = w[k] * g; m[k] += vec4(c * wk, wk); s[k] += c * c * wk; }
    }
    vec4 o = vec4(0.0);
    for (int k = 0; k < 8; k++) {
      vec3 mu = m[k].rgb / max(m[k].w, 1e-5);
      vec3 va = abs(s[k] / max(m[k].w, 1e-5) - mu * mu);
      float wk = 1.0 / pow(hard * (va.r + va.g + va.b) + 0.002, 4.0); // never 0: the least varied sector wins
      o += vec4(mu * wk, wk);
    }
    gl_FragColor = vec4(o.rgb / max(o.w, 1e-5), 1.0);
  }`, { radius: { value: 6 }, stride: { value: 2 }, hard: { value: 8 } });

/** Canvas under the paint: a woven, embossed ground, darker pigment where colours meet, richer colour. */
const CANVAS = pass(`
  float weave(vec2 p){ return 0.5 + 0.25 * sin(p.x * 2.2) * sin(p.y * 0.35 + sin(p.x * 0.11) * 2.0) + 0.25 * sin(p.y * 2.2) * sin(p.x * 0.35); }
  float ground(vec2 p){ return weave(p) * 0.35 + vnoise(p * 0.18) * 0.4 + vnoise(p * 0.7) * 0.25; }
  void main(){
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    vec2 t = 1.5 * dpr / res;
    float lx = luma(texture2D(tDiffuse, vUv + vec2(t.x, 0.0)).rgb) - luma(texture2D(tDiffuse, vUv - vec2(t.x, 0.0)).rgb);
    float ly = luma(texture2D(tDiffuse, vUv + vec2(0.0, t.y)).rgb) - luma(texture2D(tDiffuse, vUv - vec2(0.0, t.y)).rgb);
    float edge = smoothstep(0.04, 0.25, length(vec2(lx, ly)));
    c *= 1.0 - 0.18 * edge;                                  // pigment pools where colours meet
    vec2 p = gl_FragCoord.xy / dpr;
    float h = ground(p), hx = ground(p + vec2(1.0, 0.0)), hy = ground(p + vec2(0.0, 1.0));
    c *= 0.96 + 0.07 * h + 0.3 * ((hx - h) - (hy - h));     // the canvas, lit from the top left
    c = pow(c, vec3(0.92)) + vec3(0.005, 0.012, 0.03) * (1.0 - luma(c));
    c = sat(c, 1.18);
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);
    c = mix(c, c * vec3(1.03, 1.0, 0.94) + vec3(0.015, 0.01, 0.0), 0.6); // warm, slightly aged varnish
    gl_FragColor = vec4(c, 1.0);
  }`);

// ------------------------------------------------------------ toon

/** Light in whole stops with soft steps, a crisp sun highlight, reflections in half stops. Goes in
 *  after <aomap_fragment> of MeshStandard/MeshPhysical, before the light is summed. */
const TOON_LIGHT = `{
  vec3 dl = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  float alb = max(dot(diffuseColor.rgb, vec3(0.3333)), 0.03);
  float li = max(dot(dl, vec3(0.3333)) / alb, 1e-5);
  float f = log2(li) * 0.8;
  float s = exp2((floor(f) + smoothstep(0.35, 0.65, fract(f))) / 0.8) / li;
  reflectedLight.directDiffuse *= s; reflectedLight.indirectDiffuse *= s * vec3(0.86, 0.92, 1.18); // shade leans blue
  float sl = dot(reflectedLight.directSpecular, vec3(0.3333));
  reflectedLight.directSpecular *= smoothstep(0.18, 0.24, sl) * 1.6;
  float il = max(dot(reflectedLight.indirectSpecular, vec3(0.3333)), 1e-5);
  float fi = log2(il) * 2.0;
  reflectedLight.indirectSpecular *= exp2((floor(fi) + smoothstep(0.4, 0.6, fract(fi))) / 2.0) / il;
}`;

/** Ink lines from depth (the second difference of 1/z: zero across a plane, large at a silhouette or a
 *  crease), fading with distance; the sky simplified into soft bands; cleaner, fuller colour. */
const TOON_POST = pass(`uniform float width;
  float iw(vec2 uv){ return -1.0 / perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cNear, cFar); }
  void main(){
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    vec2 o = vec2(width * dpr) / res;
    float w = iw(vUv), z = 1.0 / w;
    float wl = iw(vUv - vec2(o.x, 0.0)), wr = iw(vUv + vec2(o.x, 0.0)), wd = iw(vUv - vec2(0.0, o.y)), wu = iw(vUv + vec2(0.0, o.y));
    float e = max(abs(wl + wr - 2.0 * w), abs(wu + wd - 2.0 * w)) / w;
    float line = smoothstep(0.012, 0.04, e) * (1.0 - smoothstep(25.0, 80.0, z));
    if (z > 2000.0) {
      float l = luma(c), b = l * 6.0;
      float q = (floor(b) + smoothstep(0.3, 0.7, fract(b))) / 6.0;
      c = sat(c * q / max(l, 1e-3), 1.15);
      line = 0.0;
    }
    c = sat(c, 1.18);
    c = mix(c, c * vec3(0.16, 0.15, 0.2), line * 0.9);
    gl_FragColor = vec4(c, 1.0);
  }`, { width: { value: 1.0 } });

// ------------------------------------------------------------ retro

/** An arcade board's frame: ~360 lines wide, sharp pixels, a short draw distance into haze, 15-bit-ish
 *  colour with ordered dither, a little fringing and the scanlines of a CRT. */
const RETRO = pass(`uniform float lines; uniform vec3 haze;
  float b2(vec2 a){ a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  float bayer(vec2 a){ return b2(0.5 * a) * 0.25 + b2(a); }
  void main(){
    float B = floor(res.y / lines);
    vec2 vres = floor(res / B), cell = floor(vUv * vres), uvb = (cell + 0.5) / vres;
    float ca = 0.45 / vres.x;
    vec3 c = vec3(texture2D(tDiffuse, uvb + vec2(ca, 0.0)).r, texture2D(tDiffuse, uvb).g, texture2D(tDiffuse, uvb - vec2(ca, 0.0)).b);
    float z = lz(uvb);
    c = mix(c, haze, z > 2000.0 ? 0.2 : smoothstep(90.0, 500.0, z) * 0.6);
    c = pow(c, vec3(0.85)) + vec3(0.0, 0.01, 0.03) * (1.0 - luma(c)); // arcade nights are blue, not black
    c = sat(c, 1.35);
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.4);
    float L = 9.0;
    c = floor(c * L + bayer(cell) * 0.999) / L;
    vec2 in_ = fract(vUv * vres);
    c *= 1.0 - 0.32 * smoothstep(0.45, 1.0, abs(in_.y - 0.5) * 2.0);  // scanline gaps
    float m = mod(floor(gl_FragCoord.x / max(dpr, 1.0)), 3.0);
    c *= mix(vec3(1.0), m < 1.0 ? vec3(1.08, 0.95, 0.95) : m < 2.0 ? vec3(0.95, 1.08, 0.95) : vec3(0.95, 0.95, 1.08), 0.6);
    gl_FragColor = vec4(c * 1.08, 1.0);
  }`, { lines: { value: 180 }, haze: { value: new THREE.Color() } });

/** Vertices snapped to a 320x180 grid, as the era's fixed-point hardware did: edges wobble a little. */
const SNAP = "gl_Position.xy = floor(gl_Position.xy / gl_Position.w * vec2(160.0, 90.0) + 0.5) / vec2(160.0, 90.0) * gl_Position.w;";

// ------------------------------------------------------------ miniature

/** A very shallow focus on the player's car (found by sampling the depth where it sits): the thin-lens
 *  blur grows with |z - focus| / z, gathered on a golden-angle disc; a sharp thing never bleeds into a
 *  blurrier one behind it. That shallow focus is what makes a real scene read as a model. */
const MINI_DOF = pass(`uniform float maxR, focusY;
  float coc(float z, float zf){ return min(maxR * 1.15 * abs(z - zf) / z, maxR); }
  void main(){
    float zf = min(min(lz(vec2(0.5, focusY)), lz(vec2(0.46, focusY))), lz(vec2(0.54, focusY)));
    zf = clamp(zf, 4.0, 40.0);
    vec3 c0 = texture2D(tDiffuse, vUv).rgb;
    float z0 = lz(vUv), r0 = coc(z0, zf) * dpr;
    vec3 sum = c0; float ws = 1.0;
    float R = maxR * dpr;
    for (int i = 0; i < 64; i++) {
      float a = float(i) * 2.39996, rr = sqrt((float(i) + 0.5) / 64.0) * R;
      vec2 uv = vUv + vec2(cos(a), sin(a)) * rr / res;
      float zs = lz(uv), rs = coc(zs, zf) * dpr;
      float reach = zs < z0 ? rs : min(rs, r0);
      float w = clamp(reach - rr + 1.0, 0.0, 1.0);
      sum += texture2D(tDiffuse, uv).rgb * w; ws += w;
    }
    gl_FragColor = vec4(sum / ws, 1.0);
  }`, { maxR: { value: 9 }, focusY: { value: 0.33 } });

/** Toy colour: saturated and bright, shadows lifted and cool (so they read as tinted, not black),
 *  warm highlights, a gentle vignette. */
const MINI_GRADE = pass(`
  void main(){
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = luma(c);
    float sh = 1.0 - smoothstep(0.04, 0.42, l);
    c = mix(c, c * vec3(0.8, 0.92, 1.2) + vec3(0.012, 0.02, 0.04), sh * 0.85);
    c *= mix(vec3(1.0), vec3(1.07, 1.01, 0.9), smoothstep(0.45, 1.0, l));
    c = sat(c, 1.4);
    c = c * 1.06 + 0.01;
    c = mix(c, c * c * (3.0 - 2.0 * c), 0.2);
    vec2 d = vUv - 0.5;
    c *= mix(1.0, smoothstep(1.1, 0.3, length(d * vec2(1.2, 1.0))), 0.3);
    gl_FragColor = vec4(c, 1.0);
  }`);

// ------------------------------------------------------------ the looks

type Shader = ReturnType<typeof pass>;
type Def = {
  name: string;
  about: string;
  bloom: [strength: number, radius: number, threshold: number];
  tint?: [number, number, number][]; // bloom tint per mip, small to wide
  tone?: THREE.ToneMapping;
  exposure?: number; // times the place's own
  vignette?: number; // the finish pass's corners
  hdr?: Shader[]; // before the bloom
  post?: Shader[]; // after it (tBloom: its bright, blurred quarter-size image)
  display?: Shader[];
  shade?: Shade; // how MeshStandard/MeshPhysical materials shade
};
/** frag: GLSL after <aomap_fragment> (the light, before it is summed); vert: after <project_vertex>;
 *  blur: a texture lod bias on the colour map (less texture detail). */
type Shade = { frag?: string; vert?: string; blur?: number };

export const LOOKS: Record<string, Def> = {
  real: { name: "Real", about: "The current look: physically based, bloom, ACES.", bloom: [0.1, 0.35, 2.5] },
  cinematic: {
    name: "Cinematic",
    about: "Contact occlusion from depth, warm halation, anamorphic lamp streaks, a teal and orange film grade, vignette, grain.",
    bloom: [0.32, 0.75, 1.1],
    tint: [[1, 1, 1], [1, 0.95, 0.9], [1.1, 0.75, 0.55], [1.25, 0.6, 0.4], [1.3, 0.5, 0.35]],
    exposure: 1.05, vignette: 0,
    hdr: [CINE_AO], post: [CINE_STREAK], display: [CINE_GRADE],
  },
  painterly: {
    name: "Painterly",
    about: "A generalized Kuwahara filter turns the frame into brush strokes, laid on an embossed canvas.",
    bloom: [0.2, 0.5, 1.6], vignette: 0.2,
    display: [KUWAHARA, CANVAS],
  },
  toon: {
    name: "Toon",
    about: "Light in soft-stepped bands and crisp highlights on every material, ink outlines from depth, a banded sky.",
    bloom: [0.15, 0.4, 2.0], tone: THREE.NeutralToneMapping, exposure: 0.95, vignette: 0.12,
    shade: { frag: TOON_LIGHT, blur: 2 }, display: [TOON_POST],
  },
  retro: {
    name: "Arcade",
    about: "A 90s arcade board: 200 lines with sharp pixels, short draw distance into haze, dithered colour, CRT scanlines.",
    bloom: [0.35, 0.5, 1.4], vignette: 0.15,
    shade: { vert: SNAP }, display: [RETRO],
  },
  miniature: {
    name: "Miniature",
    about: "Tilt-shift: a shallow focus on your car turns the road into a model, in bright toy colour with soft cool shadows.",
    bloom: [0.18, 0.5, 1.8], tone: THREE.NeutralToneMapping, exposure: 1.0, vignette: 0,
    hdr: [MINI_DOF], display: [MINI_GRADE],
  },
};
export const LOOK_IDS = Object.keys(LOOKS);

/** Draws the scene into its own multisampled target with a depth texture, then copies the colour on. */
class ScenePass extends ShaderPass {
  target: THREE.WebGLRenderTarget;
  scene = new THREE.Scene();
  constructor(public camera: THREE.Camera) {
    super({ uniforms: { tDiffuse: { value: null } }, vertexShader: VS, fragmentShader: "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tDiffuse, vUv); }" });
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
  }
  setSize(w: number, h: number) { this.target.setSize(w, h); }
  render(gl: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget) {
    gl.setRenderTarget(this.target);
    gl.clear();
    gl.render(this.scene, this.camera);
    this.uniforms.tDiffuse.value = this.target.texture;
    gl.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    (this as unknown as { _fsQuad: { render(r: THREE.WebGLRenderer): void } })._fsQuad.render(gl);
  }
}

export class Looks {
  id = "real";
  private composer: EffectComposer;
  private scenePass: ScenePass;
  private bloom: UnrealBloomPass;
  private finish: ShaderPass;
  private output = new OutputPass();
  private passes: ShaderPass[] = [];
  private patched = new Map<THREE.Material, { obc: THREE.Material["onBeforeCompile"]; key: () => string }>();
  private toast = document.createElement("div");
  private hideToast: ReturnType<typeof setTimeout> | undefined;
  private tone: THREE.ToneMapping;

  constructor(private gl: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera) {
    this.tone = gl.toneMapping;
    this.composer = new EffectComposer(gl, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    this.scenePass = new ScenePass(camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.1, 0.35, 2.5);
    this.finish = new ShaderPass(FINISH);
    Object.assign(this.toast.style, { position: "fixed", left: "50%", top: "14px", transform: "translateX(-50%)", padding: "6px 14px", borderRadius: "8px", background: "rgba(0,0,0,.6)", color: "#fff", font: "600 13px/1.3 Overpass, system-ui, sans-serif", pointerEvents: "none", opacity: "0", transition: "opacity .4s", zIndex: "50", textAlign: "center", maxWidth: "80vw" });
    document.body.append(this.toast);
    addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "l" || e.metaKey || e.ctrlKey || e.repeat) return;
      const id = LOOK_IDS[(LOOK_IDS.indexOf(this.id) + (e.shiftKey ? -1 : 1) + LOOK_IDS.length) % LOOK_IDS.length];
      this.set(id);
      this.show();
    });
    const want = new URLSearchParams(location.search).get("look");
    if (want && LOOKS[want]) this.set(want);
    // for screenshots and comparisons: switch, then draw the last frame again
    (window as unknown as { highwayLooks: unknown }).highwayLooks = this;
  }

  set(id: string) {
    const def = LOOKS[id];
    if (!def) return;
    this.id = id;
    this.unpatch();
    this.gl.toneMapping = def.tone ?? this.tone;
    if (id === "real") return;
    const c = this.composer;
    c.passes.length = 0;
    this.passes = [];
    c.addPass(this.scenePass);
    for (const s of def.hdr ?? []) c.addPass(this.add(s));
    const [strength, radius, threshold] = def.bloom;
    Object.assign(this.bloom, { strength, radius, threshold });
    (def.tint ?? [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]]).forEach((t, i) => this.bloom.bloomTintColors[i].set(...t));
    c.addPass(this.bloom);
    for (const s of def.post ?? []) c.addPass(this.add(s));
    this.finish.uniforms.vignette.value = def.vignette ?? 0.28;
    c.addPass(this.finish);
    c.addPass(this.output);
    for (const s of def.display ?? []) c.addPass(this.add(s));
  }

  private add(s: Shader) { const p = new ShaderPass(s); this.passes.push(p); return p; }

  private show() {
    const d = LOOKS[this.id];
    this.toast.innerHTML = `${d.name}<div style="font-weight:400;font-size:11px;opacity:.8">${d.about}</div>`;
    this.toast.style.opacity = "1";
    clearTimeout(this.hideToast);
    this.hideToast = setTimeout(() => (this.toast.style.opacity = "0"), 2200);
  }

  setSize(w: number, h: number) { this.composer.setSize(w, h); }

  /** Patch the scene's materials for the look before its shaders are compiled. */
  prepare(scene: THREE.Scene) { const sh = LOOKS[this.id].shade; if (sh) this.patch(scene, sh); }

  /** Draw with the look; false for the plain one (render.ts draws it). */
  render(scene: THREE.Scene, fx: Fx): boolean {
    const def = LOOKS[this.id];
    if (this.id === "real") return false;
    if (def.shade) this.patch(scene, def.shade);
    const exposure = this.gl.toneMappingExposure;
    this.gl.toneMappingExposure = exposure * (def.exposure ?? 1);
    this.scenePass.scene = scene;
    const pr = this.gl.getPixelRatio(), size = this.gl.getDrawingBufferSize(new THREE.Vector2());
    const fog = scene.fog?.color;
    for (const p of this.passes) {
      const u = p.uniforms;
      u.tDepth.value = this.scenePass.target.depthTexture;
      u.cNear.value = this.camera.near; u.cFar.value = this.camera.far;
      u.time.value = performance.now() / 1000;
      u.dpr.value = pr;
      (u.res.value as THREE.Vector2).copy(size);
      if (u.tBloom) u.tBloom.value = this.bloom.renderTargetsVertical[1].texture;
      if (u.haze && fog) (u.haze.value as THREE.Color).copy(fog).convertLinearToSRGB();
    }
    const f = this.finish.uniforms;
    f.speed.value = fx.speed ?? 0; f.hit.value = fx.hit ?? 0; f.dim.value = fx.dim ?? 0;
    this.composer.render();
    this.gl.toneMappingExposure = exposure;
    return true;
  }

  /** The last frame again (a comparison changes the look on a frozen frame). */
  redraw?: () => void;

  private patch(scene: THREE.Scene, shade: Shade) {
    scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      if (!mats) return;
      for (const m of Array.isArray(mats) ? mats : [mats]) {
        if (this.patched.has(m) || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
        const obc = m.onBeforeCompile, key = m.customProgramCacheKey.bind(m), base = key();
        this.patched.set(m, { obc, key: m.customProgramCacheKey });
        m.onBeforeCompile = (sh, r) => {
          obc.call(m, sh, r);
          if (shade.frag) sh.fragmentShader = sh.fragmentShader.replace("#include <aomap_fragment>", `#include <aomap_fragment>\n${shade.frag}`);
          if (shade.blur && !m.alphaTest && !m.transparent) sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", THREE.ShaderChunk.map_fragment.replace("texture2D( map, vMapUv )", `texture2D( map, vMapUv, ${shade.blur.toFixed(2)} )`));
          if (shade.vert) sh.vertexShader = sh.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n${shade.vert}`);
        };
        m.customProgramCacheKey = () => `${base}|look:${this.id}`;
        m.needsUpdate = true;
      }
    });
  }

  private unpatch() {
    for (const [m, { obc, key }] of this.patched) { m.onBeforeCompile = obc; m.customProgramCacheKey = key; m.needsUpdate = true; }
    this.patched.clear();
  }
}
