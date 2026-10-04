// A place: the sky and its sun, the road for a layout, the guardrails and
// reflector posts, the land with its trees, and the light at night. It follows
// the player along the road (everything streams or snaps ahead).
import * as THREE from "./vendor/three.js";
import { applySky, surface, worldUV, prop, type Sky } from "./env.ts";
import { Road, edges, type Layout } from "./road.ts";
import { Land, type Placer } from "./terrain.ts";

export type SkyLook = { sunAngle: number; exposure: number; fog: number; fogColor: number; env?: number; night?: boolean };
export const SKY_LOOKS: Record<string, SkyLook> = {
  partly_cloudy: { sunAngle: 2.5, exposure: 1.0, fog: 0.0009, fogColor: 0xb4c2cf },
  clear_midday: { sunAngle: 2.2, exposure: 1.0, fog: 0.0008, fogColor: 0xb9c6d2 },
  golden_hour: { sunAngle: 0.9, exposure: 1.0, fog: 0.0016, fogColor: 0xd8b48e },
  overcast: { sunAngle: 0, exposure: 1.0, fog: 0.0022, fogColor: 0xa9adb0 },
  night: { sunAngle: 2.6, exposure: 0.9, fog: 0.0025, fogColor: 0x0a0d14, env: 0.08, night: true },
};

export class World {
  scene = new THREE.Scene();
  sun = new THREE.DirectionalLight();
  fill = new THREE.HemisphereLight(0x8a9cc0, 0x0c0d10, 0);
  road!: Road;
  land!: Land;
  rails = new THREE.Group();
  look!: SkyLook;
  sky!: Sky;
  lo = 0; hi = 0; // the asphalt's edges
  night = false;
  glow: THREE.Texture;

  constructor(public renderer: THREE.WebGLRenderer) {
    this.scene.add(this.sun, this.sun.target, this.fill);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -18; sc.right = 18; sc.top = 40; sc.bottom = -16; sc.near = 1; sc.far = 200;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.02;
    this.glow = glowTexture();
  }

  async build(sky: string, asphaltName: string, layout: Layout) {
    const look = (this.look = SKY_LOOKS[sky]);
    this.night = !!look.night;
    this.sky?.dispose();
    this.sky = await applySky(this.scene, this.renderer, sky, look.sunAngle);
    this.renderer.toneMappingExposure = look.exposure;
    this.scene.environmentIntensity = look.env ?? 1;
    this.scene.backgroundIntensity = this.night ? 0.6 : 1;
    this.sun.color.copy(this.sky.color);
    this.sun.intensity = this.night ? this.sky.intensity * 0.06 : this.sky.intensity;
    this.sun.castShadow = this.sun.intensity > 0.3;
    this.scene.fog = new THREE.FogExp2(look.fogColor, look.fog);
    // moonlight and the glow of the sky: enough to see the shape of a car at night
    this.fill.intensity = this.night ? 0.55 : 0;

    // the road
    if (this.road) this.scene.remove(this.road.mesh);
    const asphalt = await surface(asphaltName);
    this.road = new Road(layout, { color: asphalt.map, normal: asphalt.normal, rough: asphalt.orm, tile: asphalt.tile * 1.5 });
    this.scene.add(this.road.mesh);
    [this.lo, this.hi] = edges(layout);

    // guardrails and reflector posts
    this.scene.remove(this.rails);
    this.rails = railsFor(this.lo, this.hi);
    this.scene.add(this.rails);

    // the land
    if (this.land) this.scene.remove(this.land.group);
    this.land = await landFor(Math.max(this.hi, -this.lo));
    this.scene.add(this.land.group);
  }

  /** Follow the player: the road and rails snap ahead, the land streams, the sun's shadow box moves. */
  follow(x: number, z: number) {
    this.road.follow(z);
    this.rails.position.z = Math.floor(z / 100) * 100;
    this.land.update(z);
    this.sun.target.position.set(x, 0, z + 12);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sky.sun, 80);
  }
}

/** A W-beam guardrail on each side (the real profile, extruded), its posts, and a reflector post every 50 m. */
function railsFor(lo: number, hi: number) {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  const p = [[0, 0], [0.03, 0.02], [0.08, 0.04], [0.085, 0.08], [0.03, 0.1], [0.03, 0.2], [0.085, 0.22], [0.08, 0.26], [0.03, 0.28], [0, 0.31]];
  shape.moveTo(0, 0);
  for (const [x, y] of p) shape.lineTo(x, y);
  for (const [x, y] of [...p].reverse()) shape.lineTo(x + 0.004, y);
  const len = 1000;
  const rail = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, steps: 1 }).translate(0, 0.52, -100);
  const railMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.85, roughness: 0.38 });
  const postGeo = new THREE.BoxGeometry(0.1, 0.8, 0.15);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.6, roughness: 0.5 });
  for (const side of [1, -1]) {
    const x = side > 0 ? hi + 1.9 : lo - 1.9;
    const m = new THREE.Mesh(rail, railMat);
    m.scale.x = side; m.position.x = x;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    const posts = new THREE.InstancedMesh(postGeo, postMat, 250);
    for (let i = 0; i < 250; i++) posts.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x + side * 0.12, 0.4, -100 + i * 4));
    posts.castShadow = true;
    group.add(posts);
  }
  const post = new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(0, 0.5, 0);
  const band = new THREE.BoxGeometry(0.13, 0.12, 0.13).translate(0, 0.86, 0);
  const n = 20;
  const posts = new THREE.InstancedMesh(post, new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 }), n * 2);
  const bands = new THREE.InstancedMesh(band, new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff9a30, emissiveIntensity: 0.4, roughness: 0.3 }), n * 2);
  for (let i = 0; i < n; i++) for (const [k, x] of [[0, hi + 2.6], [1, lo - 2.6]] as const) {
    const mt = new THREE.Matrix4().makeTranslation(x, 0, -100 + i * 50);
    posts.setMatrixAt(i * 2 + k, mt);
    bands.setMatrixAt(i * 2 + k, mt);
  }
  posts.castShadow = true;
  group.add(posts, bands);
  return group;
}

/** Rolling grass with trees, bushes, rocks and the odd house; the fields never one colour. */
async function landFor(half: number) {
  const grass = await surface("grass");
  const mat = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normal, roughness: 1 });
  mat.normalScale.set(0.6, 0.6);
  worldUV(mat, grass.tile * 2, (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vW;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
      varying vec3 vW;
      float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
      float gf(vec2 p){ return gn(p)*0.5 + gn(p*2.1)*0.25 + gn(p*4.3)*0.125; }`).replace("#include <map_fragment>", `#include <map_fragment>
      float big = gf(vW.xz / 70.0), mid = gf(vW.xz / 14.0 + 7.0);
      diffuseColor.rgb *= mix(vec3(0.78), vec3(1.08), big);
      diffuseColor.rgb *= mix(vec3(1.0), vec3(1.18, 1.05, 0.62), smoothstep(0.55, 0.8, mid) * 0.7);
      float verge = 1.0 - smoothstep(${(half + 3).toFixed(1)}, ${(half + 9).toFixed(1)}, abs(vW.x));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 0.98, 0.8) * 0.85, verge * 0.6);`);
  });
  const placer: Placer = (r, z0, put) => {
    for (let i = 0; i < 46; i++) {
      const side = r() < 0.5 ? -1 : 1, x = side * (half + 10 + Math.pow(r(), 1.7) * 220), z = z0 + r() * 120;
      const k = r();
      put(k < 0.3 ? "oak" : k < 0.5 ? "aspen" : k < 0.68 ? "pine" : k < 0.78 ? "pine_tall" : k < 0.9 ? "bush" : "rock", x, z, r() * 6.28, 0.8 + r() * 0.5);
    }
    for (let i = 0; i < 5; i++) { const side = r() < 0.5 ? -1 : 1; put(r() < 0.5 ? "bush" : "bush_b", side * (half + 4.5 + r() * 5), z0 + r() * 120, r() * 6.28, 0.7 + r() * 0.5); }
    if (r() < 0.35) put("house", (r() < 0.5 ? -1 : 1) * (half + 40 + r() * 80), z0 + r() * 120, r() * 6.28, 1);
  };
  const land = new Land({ hills: 26, flat: 16, seed: 3 }, half + 2.5, mat, placer);
  const kinds = [["oak", "tree_oak", 14], ["aspen", "tree_aspen", 10], ["pine", "tree_pine", 9], ["pine_tall", "tree_pine_tall", 6], ["bush", "bush_a", 10], ["bush_b", "bush_b", 4], ["rock", "rock_boulder", 6], ["house", "house", 1]] as const;
  const parts = await Promise.all(kinds.map(([, file]) => prop(file)));
  kinds.forEach(([kind, , per], i) => land.addKind(kind, parts[i], per));
  return land;
}

/** A soft round glow, for the light pools of headlights. */
function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.3, "rgba(255,255,255,.5)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
