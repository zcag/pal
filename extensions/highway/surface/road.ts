// The highway: a strip that follows the camera, its markings drawn from the
// world position in the shader (crisp at any distance, nothing to tile), over
// an asphalt texture. A layout is the lanes each way and what divides them.
import * as THREE from "./vendor/three.js";

export const LANE_W = 3.6;
export const SHOULDER = 2.6;

export type Layout = {
  lanes: number; // lanes our way
  oncoming: number; // lanes the other way (0 for one-way)
  median: number; // width between the two carriageways, m
};

export const ONE_WAY: Layout = { lanes: 4, oncoming: 0, median: 0 };
export const TWO_WAY: Layout = { lanes: 2, oncoming: 2, median: 0.4 };

/** Lane centres (+x is left). Lane 0 is our slow lane, on the right; with
 *  oncoming traffic, `oncomingX(0)` is their slow lane, on the far left. */
export function laneX(layout: Layout, lane: number) {
  const right = layout.oncoming ? -(layout.median / 2 + layout.lanes * LANE_W) : -(layout.lanes * LANE_W) / 2;
  return right + (lane + 0.5) * LANE_W;
}
export function oncomingX(layout: Layout, lane: number) {
  return layout.median / 2 + (layout.oncoming - 0.5 - lane) * LANE_W;
}

/** The asphalt's edges, + is left. */
export function edges(layout: Layout): [number, number] {
  if (!layout.oncoming) return [-(layout.lanes * LANE_W) / 2, (layout.lanes * LANE_W) / 2];
  return [-(layout.median / 2 + layout.lanes * LANE_W), layout.median / 2 + layout.oncoming * LANE_W];
}

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
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.86, 0.82), paint);`)
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.82, track * onRoad);
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
