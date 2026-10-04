// The highway: a strip that follows the camera, its markings drawn from the
// world position in the shader (crisp at any distance, nothing to tile), over
// an asphalt texture. A layout is the lanes each way and what divides them.
import * as THREE from "./vendor/three.js";

import { LANE_W, SHOULDER, edges, type Layout } from "../game/layout.ts";

const LEN = 900, BEHIND = 60;

export class Road {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  uniforms = {
    uEdges: { value: new THREE.Vector2() },
    uLanes: { value: new THREE.Vector4() }, // ours, oncoming, median, lane width
    uWet: { value: 0 },
    uReflect: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
  };

  tile = 2;
  constructor(public layout: Layout, maps: { color?: THREE.Texture; normal?: THREE.Texture; rough?: THREE.Texture; tile?: number } = {}) {
    this.tile = maps.tile ?? 2;
    const [lo, hi] = edges(layout);
    const w = hi - lo + SHOULDER * 2;
    const geo = new THREE.PlaneGeometry(w, LEN, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate((lo + hi) / 2, 0, LEN / 2 - BEHIND);
    this.material = new THREE.MeshStandardMaterial({
      color: maps.color ? 0xffffff : 0x3a3c40, map: maps.color ?? null, normalMap: maps.normal ?? null, roughnessMap: maps.rough ?? null,
      roughness: 0.9, metalness: 0,
    });
    for (const t of [maps.color, maps.normal, maps.rough]) if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; }
    this.uniforms.uEdges.value.set(lo, hi);
    this.uniforms.uLanes.value.set(layout.lanes, layout.oncoming, layout.median, LANE_W);
    this.patch();
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.receiveShadow = true;
  }

  private patch() {
    const u = this.uniforms;
    this.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;")
        // the textures tile in world space, a texel per ~3 mm, so the road never swims
        .replace("#include <uv_vertex>", `#include <uv_vertex>\n#if defined(USE_MAP) || defined(USE_NORMALMAP) || defined(USE_ROUGHNESSMAP)\nvec2 wuv = (modelMatrix * vec4(position, 1.0)).xz / ${this.tile.toFixed(3)};\n#endif\n#ifdef USE_MAP\nvMapUv = wuv;\n#endif\n#ifdef USE_NORMALMAP\nvNormalMapUv = wuv;\n#endif\n#ifdef USE_ROUGHNESSMAP\nvRoughnessMapUv = wuv;\n#endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          varying vec3 vWorld; uniform vec2 uEdges; uniform vec4 uLanes; uniform float uWet; uniform sampler2D uReflect; uniform vec2 uRes;
          // a painted stripe of width w centred at c, antialiased
          float stripe(float x, float c, float w) { float d = abs(x - c) - w * 0.5; float fw = fwidth(x); return 1.0 - smoothstep(-fw, fw, d); }
          float dashes(float z, float on, float period) { float p = mod(z, period); float fw = fwidth(z); return smoothstep(0.0, fw, p) * (1.0 - smoothstep(on - fw, on, p)); }
          float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
          // a line hw wide each side of d = 0 that thins to its average tone instead of shimmering far away
          float thin(float d, float hw) { float fw = fwidth(d) + 1e-5; return clamp((hw + fw * 0.5 - abs(d)) / fw, 0.0, 1.0) * min(1.0, hw * 2.0 / fw); }
          float paintMask(vec3 w) {
            float x = w.x, z = w.z, lw = uLanes.w, m = 0.0;
            // edge lines, solid
            m = max(m, stripe(x, uEdges.x + 0.25, 0.2));
            m = max(m, stripe(x, uEdges.y - 0.25, 0.2));
            float ours = uLanes.x, onc = uLanes.y, med = uLanes.z;
            if (onc > 0.0) {
              // the centre: a double solid line
              m = max(m, stripe(x, -0.12, 0.12)); m = max(m, stripe(x, 0.12, 0.12));
              for (int i = 1; i < 4; i++) { if (float(i) >= onc) break; m = max(m, stripe(x, med * 0.5 + float(i) * lw, 0.15) * dashes(z, 3.0, 12.0)); }
              for (int i = 1; i < 4; i++) { if (float(i) >= ours) break; m = max(m, stripe(x, -(med * 0.5 + float(i) * lw), 0.15) * dashes(z, 3.0, 12.0)); }
            } else {
              for (int i = 1; i < 6; i++) { if (float(i) >= ours) break; m = max(m, stripe(x, uEdges.x + float(i) * lw, 0.15) * dashes(z, 3.0, 12.0)); }
            }
            // worn paint: speckles and fade along its length
            float wear = hash12(floor(w.xz * vec2(40.0, 40.0)));
            return m * (0.82 + 0.18 * wear) * (wear > 0.08 ? 1.0 : 0.3);
          }`)
        .replace("#include <map_fragment>", `#include <map_fragment>
          float onRoad = step(uEdges.x - 0.05, vWorld.x) * step(vWorld.x, uEdges.y + 0.05);
          float paint = paintMask(vWorld) * onRoad;
          // shoulders a little lighter and dustier, the tyre tracks of each lane darker and polished
          float shoulder = 1.0 - onRoad;
          diffuseColor.rgb *= mix(1.0, 1.18, shoulder);
          float lanePos = fract((vWorld.x - uEdges.x) / uLanes.w);
          float track = (smoothstep(0.12, 0.25, lanePos) - smoothstep(0.30, 0.42, lanePos)) + (smoothstep(0.58, 0.70, lanePos) - smoothstep(0.75, 0.88, lanePos));
          diffuseColor.rgb *= 1.0 - 0.10 * track * onRoad;
          // wear: the tone drifting along the road, a patch relaid here and there with its seams sealed, black tar
          // over the cracks (across a lane, and wandering beside the lane lines), oil dripped down each lane's middle
          float lane = floor((vWorld.x - uEdges.x) / uLanes.w), lx = (lanePos - 0.5) * uLanes.w, zf = vWorld.z;
          diffuseColor.rgb *= mix(1.0, mix(0.9, 1.07, vn(vec2(vWorld.x * 0.12, zf * 0.018))) * mix(0.96, 1.03, vn(vec2(lane * 3.0, zf * 0.15))), onRoad);
          float ci = floor(zf / 31.0), ph = hash12(vec2(lane * 13.1 + 2.0, ci)), patched = 0.0, seam = 0.0;
          if (ph < 0.13) {
            float pz = ci * 31.0 + hash12(vec2(ci, lane + 7.0)) * 14.0, plen = 4.0 + hash12(vec2(lane, ci + 3.0)) * 13.0;
            float px = hash12(vec2(ci, lane + 1.0)) < 0.5 ? -0.5 : -0.1, pw = mix(0.55, 1.0, hash12(vec2(ci + 5.0, lane)));
            float sd = max(max((px - lx / uLanes.w) * uLanes.w, (lx / uLanes.w - px - pw) * uLanes.w), max(pz - zf, zf - pz - plen));
            float fw = fwidth(sd);
            patched = (1.0 - smoothstep(-fw, fw, sd)) * onRoad;
            seam = thin(sd, 0.035) * onRoad;
            diffuseColor.rgb *= mix(1.0, (0.78 + ph * 1.1) * mix(0.94, 1.04, vn(vWorld.xz * 1.7)), patched);
          }
          float tc = floor(zf / 11.0), th = hash12(vec2(tc, lane * 3.0 + 1.0)), tar = seam;
          if (th < 0.3) tar = max(tar, thin(zf - (tc * 11.0 + 2.0 + th * 22.0 + sin(lx * 1.6 + th * 40.0) * 0.4 + sin(lx * 5.1) * 0.06), 0.022));
          tar = max(tar, thin(lx - uLanes.w * 0.42 + sin(zf * 0.45) * 0.07 + sin(zf * 1.9) * 0.02, 0.018) * step(0.6, vn(vec2(lane, zf / 17.0))));
          tar *= onRoad;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022), tar * 0.8);
          float oq = (lanePos - 0.5) / 0.075, oil = exp(-oq * oq) * (0.35 + 0.65 * vn(vec2(lane * 5.0, zf / 5.0)));
          diffuseColor.rgb *= 1.0 - 0.2 * oil * onRoad;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.86, 0.82), paint);`)
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.82, track * onRoad);
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.8, oil * onRoad);
          roughnessFactor = mix(roughnessFactor, 0.4, tar);
          roughnessFactor = mix(roughnessFactor, 0.55, paint);
          roughnessFactor = mix(roughnessFactor, 0.06, uWet * (0.55 + 0.45 * track));`)
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
          if (uWet > 0.0) {
            vec2 suv = gl_FragCoord.xy / uRes; suv.x = 1.0 - suv.x;
            vec3 acc = vec3(0.); float ws = 0.;
            float j = hash12(gl_FragCoord.xy);
            for (int k = 0; k < 10; k++) { float o = (float(k) + j) / 10.0 * 2.0 - 1.0; float wk = 1.0 - abs(o) * 0.7;
              acc += texture2D(uReflect, suv + vec2(o * 0.002, o * 0.03)).rgb * wk; ws += wk; }
            totalEmissiveRadiance += acc / ws * uWet * 0.55 * (1.0 - paint * 0.5);
          }`);
    };
  }

  /** Keep the strip under the camera. */
  follow(z: number) { this.mesh.position.z = Math.floor(z / 12) * 12; }
}
