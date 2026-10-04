// The finishing: everything between the scene and the screen. One look, the realistic one:
//   scene (4x MSAA, HDR, depth kept) -> occlusion from depth (half res) -> its blur (half res)
//   -> combine: occlusion, haze toward the sky's own horizon, camera motion blur (full res, HDR)
//   -> bloom -> finish: exposure, ACES, the place's grade, vignette, hit flash, dim, dither -> screen
// The sky is drawn un-tone-mapped (render.ts), so the photo's sun is bright enough to bloom.
// Cars write alpha 0 (car.ts): the motion blur leaves them sharp and never smears them onto the road.
// `?fx=-ao,-blur,-haze,-bloom,-grade,-sharpen` turns parts off, for comparing and measuring (and
// `-shadows`, three's own shadow filter, render.ts).
import * as THREE from "./vendor/three.js";
import { UnrealBloomPass } from "./vendor/three.js";
import { lookOf, SKY_LOOKS, type Grade } from "./skylooks.ts";
import type { Fx } from "./render.ts";

const VS = "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

/** Three's ACES and its inverse (the sky photos were tone-mapped with it at exposure 1). */
export const ACES = `
  const mat3 ACES_IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 ACES_OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  vec3 aces(vec3 c){ c = ACES_IN * (c / 0.6); vec3 a = c * (c + 0.0245786) - 0.000090537, b = c * (0.983729 * c + 0.4329510) + 0.238081; return clamp(ACES_OUT * (a / b), 0.0, 1.0); }
  vec3 unaces(vec3 y){
    y = clamp(inverse(ACES_OUT) * min(y, vec3(0.985)), 0.0, 0.985); // a white sun comes back about 8 times brighter than white paper
    vec3 A = 1.0 - 0.983729 * y, B = 0.0245786 - 0.432951 * y, C = -(0.000090537 + 0.238081 * y);
    return max(inverse(ACES_IN) * ((-B + sqrt(B * B - 4.0 * A * C)) / (2.0 * A)), 0.0) * 0.6;
  }`;

const DEPTH = `uniform sampler2D tDepth; uniform mat4 projInv;
  vec3 viewPos(vec2 uv, float d){ vec4 p = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
  vec3 viewAt(vec2 uv){ return viewPos(uv, texture2D(tDepth, uv).x); }
  float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

/** Ambient occlusion (scalable SAO): 6 directions x 3 steps within `radius` metres of the point, on
 *  normals rebuilt from depth; fades out past 140 m, where a fold of the land is not contact. */
const AO = DEPTH + `uniform vec2 texel; uniform float radius, intensity, scale; varying vec2 vUv;
  void main(){
    vec2 uv0 = (floor(vUv / texel) + 0.5) * texel; // on a full-res texel: its neighbours are other texels
    float d = texture2D(tDepth, uv0).x;
    if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
    vec3 p = viewPos(uv0, d);
    vec3 pl = viewAt(uv0 - vec2(texel.x, 0.0)), pr = viewAt(uv0 + vec2(texel.x, 0.0));
    vec3 pd = viewAt(uv0 - vec2(0.0, texel.y)), pu = viewAt(uv0 + vec2(0.0, texel.y));
    vec3 n = normalize(cross(abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl, abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd));
    float z = -p.z, r2 = radius * radius;
    float rpx = clamp(radius * scale / z, 3.0, 90.0);
    float a0 = ign(gl_FragCoord.xy) * 6.2832, j0 = ign(gl_FragCoord.yx + 31.0), occ = 0.0;
    for (int i = 0; i < 6; i++) {
      vec2 dir = vec2(cos(a0 + float(i) * 1.0472), sin(a0 + float(i) * 1.0472));
      for (int k = 0; k < 3; k++) {
        float s = (float(k) + fract(j0 + float(i) * 0.618)) / 3.0;
        vec3 v = viewAt(uv0 + dir * max(rpx * s * s, 1.5) * texel) - p;
        float vv = dot(v, v), f = max(r2 - vv, 0.0);
        occ += f * f * f * max((dot(v, n) - 0.004 * z) / (vv + 0.01), 0.0);
      }
    }
    float ao = max(0.0, 1.0 - occ * intensity / (r2 * r2 * r2) * (5.0 / 18.0));
    gl_FragColor = vec4(mix(1.0, ao, 1.0 - smoothstep(70.0, 140.0, z)), 0.0, 0.0, 1.0);
  }`;

/** The occlusion's noise smoothed over 4x4 half-res texels, only across similar depths. */
const AO_BLUR = DEPTH + `uniform sampler2D tAO; uniform vec2 aoTexel; varying vec2 vUv;
  void main(){
    float z0 = -viewAt(vUv).z, s = 0.0, w = 0.0;
    for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
      vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * aoTexel;
      float ww = exp(-abs(-viewAt(uv).z - z0) / (0.03 * z0 + 0.05));
      s += texture2D(tAO, uv).r * ww; w += ww;
    }
    gl_FragColor = vec4(s / max(w, 1e-4), 0.0, 0.0, 1.0);
  }`;

/** Occlusion, haze and camera motion blur, in HDR. The blur follows each pixel's own motion (its world
 *  point, from depth, seen by last frame's camera), so it is strong at the edges and near the camera
 *  at speed and nothing in the middle; it skips car pixels (alpha 0) both as targets and as samples.
 *  The haze thins with height, and its colour is the sky photo straight above the horizon that way. */
const COMBINE = DEPTH + ACES + `
  uniform sampler2D tColor, tAO, tSky; uniform mat4 viewInv, prevVP; uniform mat3 skyRot; uniform vec3 camPos; uniform vec2 texel;
  uniform float aoAmt, shutter, maxBlur, haze, hazeFall, skyIntensity, useSky; uniform vec3 fogColor, sunDir, sunCol; varying vec2 vUv;
  vec3 skyAt(vec3 d){
    d = skyRot * normalize(vec3(d.x, max(d.y, 0.035), d.z));
    vec2 uv = vec2(atan(d.z, d.x) * 0.1591549 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.3183099 + 0.5);
    return useSky > 0.5 ? unaces(textureLod(tSky, uv, 6.0).rgb) * skyIntensity : fogColor;
  }
  // occlusion from the depth buffer, at a fifth on cars (alpha 0): up close it reads a body's creases (a plate's
  // recess, a bumper's lip) as deep and paints them in black blotches, and a car's own shading already has them
  vec3 lit(vec2 uv, vec4 c){ return c.rgb * mix(1.0, texture2D(tAO, uv).r, aoAmt * mix(0.2, 1.0, clamp(c.a, 0.0, 1.0))); }
  void main(){
    float d = texture2D(tDepth, vUv).x;
    vec3 wp = (viewInv * vec4(viewPos(vUv, d), 1.0)).xyz;
    vec4 pc = prevVP * vec4(wp, 1.0);
    vec2 vel = (vUv - (pc.xy / pc.w * 0.5 + 0.5)) * shutter;
    float L = length(vel / texel);
    if (pc.w <= 0.0) vel = vec2(0.0), L = 0.0;
    if (L > maxBlur) vel *= maxBlur / L, L = maxBlur;
    vec4 c0 = texture2D(tColor, vUv);
    vel *= clamp(c0.a, 0.0, 1.0);
    vec3 c = lit(vUv, c0);
    if (L * c0.a > 1.0) {
      float w = 1.0, j = ign(gl_FragCoord.xy);
      for (int i = 0; i < 10; i++) {
        vec2 uv = vUv + vel * ((float(i) + j) / 10.0 - 0.5);
        vec4 s = texture2D(tColor, uv);
        float ws = clamp(s.a, 0.0, 1.0);
        c += lit(uv, s) * ws; w += ws;
      }
      c /= w;
    }
    if (d < 1.0 && haze > 0.0) {
      vec3 ray = wp - camPos;
      float dist = length(ray), kd = hazeFall * ray.y;
      float od = haze * exp(-hazeFall * max(camPos.y, 0.0)) * dist * (abs(kd) > 1e-4 ? (1.0 - exp(-kd)) / kd : 1.0);
      // and the sun lighting the haze, strongest looking toward it (Henyey-Greenstein, g = 0.7)
      float mu = dot(ray / dist, sunDir), hg = 0.51 / (12.566 * pow(1.49 - 1.4 * mu, 1.5));
      c = mix(c, skyAt(ray / dist) + sunCol * hg, 1.0 - exp(-od));
    }
    gl_FragColor = vec4(c.r + c.g + c.b < 3000.0 ? max(c, 0.0) : vec3(0.0), 1.0); // a NaN or an overflow would bloom into a black screen

  }`;

/** To the screen: exposure and ACES, then the place's grade on the encoded image (white balance,
 *  a soft contrast curve that never clips, saturation, lift and gain), vignette, hit, dim, dither. */
const FINISH = ACES + `
  uniform sampler2D tHDR; uniform vec2 texel; uniform float sharpen, exposure, contrast, saturation, warmth, vignette, hit, dim, grade, time; uniform vec3 lift, gain; varying vec2 vUv;
  float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
  vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, 1e-6), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  vec3 curve(vec3 c, float k){ return mix(0.45 * pow(max(c, 1e-6) / 0.45, vec3(k)), 1.0 - 0.55 * pow(max(1.0 - c, 1e-6) / 0.55, vec3(k)), step(0.45, c)); }
  void main(){
    // a little sharpening (the panel is small): the pixel pushed away from its four neighbours' mean, limited
    // to a fraction of its own brightness so edges never ring
    vec3 h = texture2D(tHDR, vUv).rgb;
    vec3 nb = (texture2D(tHDR, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tHDR, vUv - vec2(texel.x, 0.0)).rgb + texture2D(tHDR, vUv + vec2(0.0, texel.y)).rgb + texture2D(tHDR, vUv - vec2(0.0, texel.y)).rgb) * 0.25;
    h = max(h + clamp((h - nb) * sharpen, -0.25 * h, 0.25 * h), 0.0) * exposure;
    h *= grade > 0.5 ? vec3(1.0 + warmth, 1.0 + warmth * 0.1, 1.0 - warmth) : vec3(1.0);
    vec3 c = srgb(aces(h));
    if (grade > 0.5) {
      c = curve(clamp(c, 0.0, 1.0), contrast);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = max(mix(vec3(l), c, saturation), 0.0);
      c = c * gain + lift * (1.0 - c);
    }
    vec2 q = (vUv - 0.5) * vec2(1.0, 0.62);
    c *= 1.0 - vignette * smoothstep(0.18, 0.62, length(q));
    float r = length(vUv - vec2(0.5, 0.52));
    c = mix(c, c * vec3(1.6, 0.55, 0.45) + vec3(0.12, 0.0, 0.0), hit * smoothstep(0.15, 0.85, r));
    c *= 1.0 - dim;
    c += (ign(gl_FragCoord.xy + fract(time) * 97.0) - 0.5) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }`;

const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
class Quad {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader, uniforms, depthTest: false, depthWrite: false }));
    this.mesh.frustumCulled = false;
  }
  get u() { return this.mesh.material.uniforms; }
  draw(gl: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) { gl.setRenderTarget(target); gl.render(this.mesh, quadCam); }
}

const FX = new Set((new URLSearchParams(location.search).get("fx") ?? "").split(",").filter((s) => s.startsWith("-")).map((s) => s.slice(1)));
const v2 = () => ({ value: new THREE.Vector2() });

export class Finish {
  /** The scene, multisampled, with its depth. */
  scene = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) });
  private hdr = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private ao = [0, 1].map(() => new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false }));
  private aoQ = new Quad(AO, { tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, texel: v2(), radius: { value: 1.2 }, intensity: { value: 1.3 }, scale: { value: 1 } });
  private blurQ = new Quad(AO_BLUR, { tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, tAO: { value: null }, aoTexel: v2() });
  private combQ = new Quad(COMBINE, {
    tDepth: { value: null }, projInv: { value: new THREE.Matrix4() }, tColor: { value: null }, tAO: { value: null }, tSky: { value: null },
    viewInv: { value: new THREE.Matrix4() }, prevVP: { value: new THREE.Matrix4() }, skyRot: { value: new THREE.Matrix3() }, camPos: { value: new THREE.Vector3() }, texel: v2(),
    aoAmt: { value: 1 }, shutter: { value: 0 }, maxBlur: { value: 60 }, haze: { value: 0 }, hazeFall: { value: 0.02 }, skyIntensity: { value: 1 }, useSky: { value: 1 }, fogColor: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() },
  });
  private finQ = new Quad(FINISH, {
    tHDR: { value: null }, texel: v2(), sharpen: { value: 0.35 }, exposure: { value: 1 }, contrast: { value: 1 }, saturation: { value: 1 }, warmth: { value: 0 }, vignette: { value: 0.2 }, hit: { value: 0 }, dim: { value: 0 }, grade: { value: 1 }, time: { value: 0 },
    lift: { value: new THREE.Vector3() }, gain: { value: new THREE.Vector3(1, 1, 1) },
  });
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.12, 0.55, 1.6);
  private prevVP = new THREE.Matrix4();
  /** The next frame is a new view (say the garage to the road), however close the camera stayed: no blur across it. */
  cut = false;
  private prevPos = new THREE.Vector3();
  private prevDir = new THREE.Vector3();
  private lastT = 0;
  private fog: THREE.FogExp2 | null = null;
  private vp = new THREE.Matrix4();
  private m4 = new THREE.Matrix4();
  /** The parts turned off (`?fx=-ao,-blur,-haze,-bloom,-grade,-sharpen`). */
  off = FX;

  constructor(private gl: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera) {
    this.scene.depthTexture!.type = THREE.UnsignedIntType;
    for (const t of this.ao) t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
  }

  setSize(w: number, h: number) {
    const pr = this.gl.getPixelRatio(), W = Math.round(w * pr), H = Math.round(h * pr);
    this.scene.setSize(W, H);
    this.hdr.setSize(W, H);
    for (const t of this.ao) t.setSize(W >> 1, H >> 1);
    this.bloom.setSize(W, H);
  }

  /** Fog is ours to draw (as haze, by depth): taken off the scene so no material compiles with it. */
  private takeFog(scene: THREE.Scene) {
    if (scene.fog) { this.fog = scene.fog as THREE.FogExp2; scene.fog = null; }
  }

  /** Compile the scene's shaders as the frame will draw them (into the multisampled target, no fog). */
  async warm(scene: THREE.Scene) {
    this.takeFog(scene);
    this.gl.setRenderTarget(this.scene);
    await this.gl.compileAsync(scene, this.camera);
    this.gl.render(scene, this.camera);
    this.gl.setRenderTarget(null);
  }

  render(scene: THREE.Scene, fx: Fx) {
    const gl = this.gl, cam = this.camera;
    this.takeFog(scene);
    const look = lookOf(scene, this.fog?.color) ?? SKY_LOOKS.partly_cloudy;
    const g: Grade = look.grade;

    gl.setRenderTarget(this.scene);
    gl.render(scene, cam);
    const W = this.scene.width, H = this.scene.height, depth = this.scene.depthTexture;

    // occlusion, at half resolution
    const ao = !this.off.has("ao");
    if (ao) {
      const u = this.aoQ.u;
      u.tDepth.value = depth; u.projInv.value.copy(cam.projectionMatrixInverse);
      u.texel.value.set(1 / W, 1 / H);
      u.scale.value = H * 0.5 * cam.projectionMatrix.elements[5];
      this.aoQ.draw(gl, this.ao[0]);
      const b = this.blurQ.u;
      b.tDepth.value = depth; b.projInv.value.copy(cam.projectionMatrixInverse); b.tAO.value = this.ao[0].texture;
      b.aoTexel.value.set(2 / W, 2 / H);
      this.blurQ.draw(gl, this.ao[1]);
    }

    // combine: occlusion, motion blur, haze
    const now = performance.now(), dt = THREE.MathUtils.clamp((now - this.lastT) / 1000, 1 / 240, 1 / 20);
    this.lastT = now;
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const pos = cam.getWorldPosition(new THREE.Vector3()), dir = cam.getWorldDirection(new THREE.Vector3());
    // a cut (a new view, the garage to the road) is not motion
    if (this.cut || pos.distanceTo(this.prevPos) > 6 || dir.dot(this.prevDir) < 0.97) this.prevVP.copy(this.vp);
    this.cut = false;
    const c = this.combQ.u;
    c.tDepth.value = depth; c.projInv.value.copy(cam.projectionMatrixInverse); c.tColor.value = this.scene.texture;
    c.tAO.value = this.ao[1].texture; c.aoAmt.value = ao ? 1 : 0;
    c.viewInv.value.copy(cam.matrixWorld); c.prevVP.value.copy(this.prevVP); c.camPos.value.copy(pos);
    c.texel.value.set(1 / W, 1 / H);
    c.shutter.value = this.off.has("blur") ? 0 : (1 / 60) * 0.55 / dt; // a 1/110 s shutter
    c.maxBlur.value = 0.045 * W;
    const bg = scene.background as THREE.Texture | null;
    // the night photo's sky is stars and a bright moon: sampled per direction it streaks the haze, so
    // night haze is the plain fog colour
    const night = !!(scene.userData.look as { night?: boolean } | undefined)?.night;
    c.useSky.value = bg && (bg as THREE.Texture).isTexture && !night ? 1 : 0;
    c.tSky.value = c.useSky.value ? bg : null;
    c.skyRot.value.setFromMatrix4(this.m4.makeRotationFromEuler(scene.backgroundRotation)).transpose();
    c.skyIntensity.value = scene.backgroundIntensity;
    c.haze.value = this.off.has("haze") ? 0 : g.haze;
    c.hazeFall.value = 1 / g.hazeHeight;
    if (this.fog) c.fogColor.value.copy(this.fog.color);
    const sun = scene.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight | undefined;
    if (sun) { c.sunDir.value.subVectors(sun.position, sun.target.position).normalize(); c.sunCol.value.copy(sun.color).multiplyScalar(sun.intensity * 0.04 * g.glow); }
    else c.sunCol.value.setScalar(0);
    this.combQ.draw(gl, this.hdr);
    this.prevVP.copy(this.vp); this.prevPos.copy(pos); this.prevDir.copy(dir);

    // bloom, added into the HDR image
    if (!this.off.has("bloom")) {
      this.bloom.strength = g.bloom;
      this.bloom.render(gl, null as unknown as THREE.WebGLRenderTarget, this.hdr, 0, false);
    }

    // to the screen
    const f = this.finQ.u;
    f.tHDR.value = this.hdr.texture; f.texel.value.set(1 / W, 1 / H); f.sharpen.value = this.off.has("sharpen") ? 0 : 0.35;
    f.exposure.value = gl.toneMappingExposure;
    f.grade.value = this.off.has("grade") ? 0 : 1;
    f.contrast.value = g.contrast; f.saturation.value = g.saturation; f.warmth.value = g.warmth;
    f.lift.value.set(...g.lift); f.gain.value.set(...g.gain);
    f.vignette.value = g.vignette;
    f.hit.value = fx.hit ?? 0; f.dim.value = fx.dim ?? 0;
    f.time.value = now / 1000;
    this.finQ.draw(gl, null);
  }
}
