// A place: the sky and its sun, the road for a layout, the guardrails and
// reflector posts, the land and everything on it, and the light at night. It
// follows the player along the road (everything streams or snaps ahead).
import * as THREE from "./vendor/three.js";
import { applySky, surface, worldUV, prop, type Sky, type Part } from "./env.ts";
import { Road, edges, type Layout } from "./road.ts";
import { Land, CHUNK, SEG, zoneAt, forestEdge, bridgeNear, hash, fbm, type Put } from "./terrain.ts";
import { bake, fuller, grassClump } from "./foliage.ts";
import { overpass, barrierPanel, lampPool, halo, signFace } from "./structures.ts";
import { SKY_LOOKS, type SkyLook } from "./skylooks.ts";

const LAMP = 260; // a street lamp's candela, in the night look's units

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
  lamps: THREE.PointLight[] = []; // at night, real light from the street lamps nearest the car

  constructor(public renderer: THREE.WebGLRenderer) {
    this.scene.add(this.sun, this.sun.target, this.fill);
    // one shadow map over the whole stretch you can make out (~90 m each side, 230 m ahead): its
    // edge is out in the haze, not a line across the road in front of you; 4096 px keeps it ~7 cm a texel
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -130; sc.right = 130; sc.top = 150; sc.bottom = -150; sc.near = 1; sc.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
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
    this.scene.userData.look = look; // for the finishing (skylooks.ts lookOf)
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
    // a low sun keeps its side of the road mostly open, so its light reaches the asphalt
    const open = !this.night && this.sky.sun.y < 0.3 ? Math.sign(this.sky.sun.x) : 0;
    this.land = await landFor(this.renderer, Math.max(this.hi, -this.lo), asphalt, this.night, open);
    this.scene.add(this.land.group);
    for (const l of this.lamps) l.removeFromParent();
    this.lamps = this.night ? [0, 1, 2, 3].map(() => new THREE.PointLight(0xffc690, 0, 45, 2)) : [];
    if (this.lamps.length) this.scene.add(...this.lamps);
  }

  /** Follow the player: the road and rails snap ahead, the land streams, the sun's shadow box moves. */
  follow(z: number) {
    this.road.follow(z);
    this.rails.position.z = Math.floor(z / 100) * 100;
    this.land.update(z);
    // centred ahead of the car, snapped to whole texels so the shadows don't crawl as it moves
    const texel = 260 / 4096, tz = Math.round((z + 95) / texel) * texel;
    this.sun.target.position.set(0, 0, tz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sky.sun, 300);
    // the lamps just behind and ahead of the car light it for real; the pools stand in further off
    if (this.lamps.length) {
      const half = Math.max(this.hi, -this.lo), near: [number, number][] = [];
      for (let c = Math.floor((z - 20) / CHUNK); c <= Math.floor((z + 110) / CHUNK); c++) for (const side of [-1, 1]) for (const lz of lampsAt(c * CHUNK, side, true)) if (lz > z - 20 && lz < z + 110) near.push([side, lz]);
      near.sort((a, b) => Math.abs(a[1] - z - 25) - Math.abs(b[1] - z - 25));
      this.lamps.forEach((l, i) => {
        const n = near[i];
        l.intensity = n ? LAMP : 0;
        if (n) l.position.set(n[0] * (half + 0.1), 9.4, n[1]);
      });
    }
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

// ---------------------------------------------------------------- the land and what stands on it

/** The models and impostors, loaded and baked once for every place. */
type Assets = { parts: Record<string, Part[]>; imp: Map<string, Part>; grass: Part };
let assets: Promise<Assets> | null = null;
function loadAssets(renderer: THREE.WebGLRenderer) {
  return (assets ??= (async () => {
    const names = ["tree_oak", "tree_aspen", "tree_pine", "tree_pine_tall", "bush_a", "bush_b", "rock_boulder", "house", "warehouse", "light_pole", "sign_gantry", "sign_speed_limit", "sign_direction", "jersey_barrier"];
    const loaded = await Promise.all(names.map((n) => prop(n)));
    const raw = Object.fromEntries(names.map((n, i) => [n, loaded[i]]));
    // the EZ-Tree crowns are thin: grow every leaf card and set the greens; the aspen and the small bush wear
    // autumn's orange, so they borrow the oak's summer leaves
    const leaf = (raw.tree_oak.find((p) => (p.mat as THREE.MeshStandardMaterial).alphaTest)!.mat as THREE.MeshStandardMaterial).map;
    const parts: Record<string, Part[]> = {
      ...raw,
      oak: fuller(raw.tree_oak, 1.7, 0x9fb27a), aspen: fuller(raw.tree_aspen, 2.1, 0xb4c48a, leaf), pine: fuller(raw.tree_pine, 1.6, 0x7f9a6e), pine_tall: fuller(raw.tree_pine_tall, 1.5, 0x7f9a6e),
      bush: fuller(raw.bush_a, 1.3, 0x9cb07a), bush_b: fuller(raw.bush_b, 1.3, 0xa8b880, leaf),
    };
    // impostors: each tree, and clusters of them for far away (a few crowns as one quad)
    const one = (p: Part[]) => [{ parts: p }];
    const imp = bake(renderer, [
      ["oak", one(parts.oak)], ["aspen", one(parts.aspen)], ["pine", one(parts.pine)], ["pine_tall", one(parts.pine_tall)],
      ["bush", one(parts.bush)], ["bush_b", one(parts.bush_b)],
      ["c_oak", [{ parts: parts.oak, x: -3.5, s: 0.9 }, { parts: parts.oak, x: 3.2, z: -1.5, rot: 2, s: 1.05 }, { parts: parts.aspen, x: 0.3, z: 2, rot: 1, s: 0.8 }]],
      ["c_pine", [{ parts: parts.pine, x: -3 }, { parts: parts.pine_tall, x: 2.5, z: -2, rot: 1.3, s: 0.8 }, { parts: parts.pine, x: 5.5, z: 1.5, rot: 4, s: 0.85 }, { parts: parts.pine, x: -6, z: 2, rot: 2.5, s: 0.75 }]],
      ["c_mix", [{ parts: parts.oak, x: -4, s: 0.95 }, { parts: parts.pine, x: 1.5, z: -1.5, rot: 1 }, { parts: parts.oak, x: 5, z: 1.5, rot: 3, s: 0.85 }]],
    ]);
    return { parts, imp, grass: grassClump() };
  })());
}

/** Rolling land around the road: forests, fields and hedgerows, the edge of a town, bridges and gantries over the road; lamps at night. */
async function landFor(renderer: THREE.WebGLRenderer, half: number, asphalt: { map: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture; tile: number }, night: boolean, open: number) {
  const [{ parts, imp, grass: grassPart }, grass] = await Promise.all([loadAssets(renderer), surface("grass")]);
  const roadHalf = half + 2.5;
  const land = new Land({ hills: 26, seed: 3, open }, roadHalf, half, groundMaterial(grass, half), placer(half, night, open));
  const I = (n: string) => [imp.get(n)!];
  // trees: full models near, their impostors beyond; forests' depths and far hills are impostors only
  for (const t of ["oak", "aspen", "pine", "pine_tall"]) {
    land.addKind(t, parts[t], 22, { far: I(t) });
    land.addKind(`i_${t}`, I(t), 500, { receive: false });
  }
  for (const c of ["c_oak", "c_pine", "c_mix"]) land.addKind(c, I(c), 140, { receive: false });
  land.addKind("bush", I("bush"), 420, { receive: false });
  land.addKind("bush_b", I("bush_b"), 220, { receive: false });
  land.addKind("grass", [grassPart], 2600, { shadow: false });
  land.addKind("rock", parts.rock_boulder, 6);
  // buildings; at night most windows are lit
  const concrete = parts.jersey_barrier[0].mat as THREE.MeshStandardMaterial;
  for (const t of [concrete.map, concrete.normalMap, concrete.roughnessMap, concrete.aoMap]) if (t) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  land.addKind("house", windows(parts.house, night ? 1.6 : 0), 14);
  land.addKind("house_dark", parts.house, 8);
  land.addKind("warehouse", parts.warehouse, 3);
  land.addKind("barn", parts.warehouse, 2);
  // over and beside the road
  const cross = new THREE.MeshStandardMaterial({ map: asphalt.map, normalMap: asphalt.normal, roughnessMap: asphalt.orm, color: 0xd8d8d8 });
  worldUV(cross, asphalt.tile * 1.5);
  land.addKind("bridge", overpass(roadHalf, concrete, cross), 1);
  await document.fonts?.load("700 100px Overpass").catch(() => undefined); // the signs' lettering
  const face = signFace();
  land.addKind("sign_limit", parts.sign_speed_limit, 1);
  land.addKind("sign_dir", parts.sign_direction, 1);
  land.addKind("gantry", parts.sign_gantry.map(({ geo, mat }) => (mat.name === "sign_face" ? { geo, mat: Object.assign((mat as THREE.MeshStandardMaterial).clone(), { map: face }) } : { geo, mat })), 1);
  land.addKind("barrier", barrierPanel(concrete), 64);
  const pole = parts.light_pole.map(({ geo, mat }) => {
    const m = (mat as THREE.MeshStandardMaterial).clone();
    if (m.emissiveIntensity > 0 && m.emissive.getHex()) m.emissiveIntensity = night ? 6 : 0;
    return { geo, mat: m };
  });
  land.addKind("pole", pole, 12);
  if (night) {
    land.addKind("pool", [lampPool(glowTexture(), new THREE.Color(0xffc68a).multiplyScalar(0.32))], 12, { shadow: false, receive: false });
    land.addKind("halo", [halo(0xffd2a0, 1.6)], 12, { shadow: false, receive: false });
  }
  return land;
}

/** A house's parts with its windows glowing warm. */
function windows(house: Part[], strength: number): Part[] {
  return house.map(({ geo, mat }) => {
    if (mat.name !== "window" || !strength) return { geo, mat };
    const m = (mat as THREE.MeshStandardMaterial).clone();
    m.emissive.set(0xffb766); m.emissiveIntensity = strength;
    return { geo, mat: m };
  });
}

/** The street lamps of a chunk on one side (their z): through towns, round every bridge, and at night along more of the road. */
function lampsAt(z0: number, side: number, night: boolean) {
  const zb = bridgeNear(z0 + CHUNK / 2), out: number[] = [];
  const lit = zoneAt(z0, side) === "town" || Math.abs(z0 + 60 - zb) < 260 || (night && (z0 < 900 || fbm(z0 / 900, 4.2) > 0.5)); // a night run leaves the city's lights
  if (lit) for (let z = z0 + (side > 0 ? 0 : 22); z < z0 + CHUNK; z += 44) if (Math.abs(z - zb) > 9 && Math.abs(z + 6 - zb) > 9) out.push(z);
  return out;
}

/** Where everything stands, chunk by chunk, from the plan in terrain.ts. */
function placer(half: number, night: boolean, open: number) {
  return (r: () => number, z0: number, put: Put) => {
    const z1 = z0 + CHUNK, zb = bridgeNear(z0 + CHUNK / 2), bridge = zb >= z0 && zb < z1;
    const clearOfBridge = (z: number) => Math.abs(z - zb) > 9;
    const X = (side: number, e: number) => side * (half + e);
    if (bridge) put("bridge", 0, zb, 0, 1, 0);
    // signs, turned to face the traffic: a gantry every half kilometre away from bridges, the limit on the verge
    // now and then, where the road goes before each bridge
    const chunk = Math.round(z0 / CHUNK);
    if (chunk % 4 === 1 && Math.abs(z0 + 60 - zb) > 300) put("gantry", 0, z0 + 60, Math.PI, (half + 2.6) / 9.4, 0);
    if (chunk % 7 === 3) put("sign_limit", -(half + 3.3), z0 + 30, Math.PI, 1.1);
    if (zb - 400 >= z0 && zb - 400 < z1) put("sign_dir", -(half + 4.2), zb - 400, Math.PI, 1.3);
    for (const side of [-1, 1]) {
      const zone = zoneAt(z0, side, open), seg = Math.floor(z0 / SEG);
      const tree = (e: number, z: number, conifer: number, near = true) => {
        const k = r(), kind = k < conifer * 0.75 ? "pine" : k < conifer ? "pine_tall" : k < conifer + (1 - conifer) * 0.7 ? "oak" : "aspen";
        put(near ? kind : `i_${kind}`, X(side, e), z, r() * 6.28, 0.75 + r() * 0.5);
      };
      // the verge: short tufts in the mown strip, longer grass beyond
      for (let i = 0; i < 700; i++) {
        const e = 3.5 + Math.pow(r(), 1.4) * 14, z = z0 + r() * CHUNK;
        if ((zone === "town" && e < 4.5) || fbm(e / 7 + side * 5, z / 7) < 0.42 + r() * 0.12) continue; // in patches, not sprinkled
        put("grass", X(side, e), z, r() * 6.28, e < 8 ? 0.25 + r() * 0.25 : 0.45 + r() * 0.55);
      }
      if (zone === "forest") {
        const edge = forestEdge(z0, side), conifer = hash(seg, side * 3.7) * 0.9;
        // the edge: a wall of full trees with bushes and long grass at their feet
        for (let z = z0 + r() * 4; z < z1; z += 4.5 + r() * 3) if (clearOfBridge(z)) tree(edge + r() * 3, z, conifer);
        for (let i = 0; i < 26; i++) { const z = z0 + r() * CHUNK; if (clearOfBridge(z)) put(r() < 0.6 ? "bush" : "bush_b", X(side, edge - 2 + r() * 3), z, r() * 6.28, 0.9 + r() * 0.9); }
        for (let i = 0; i < 160; i++) put("grass", X(side, edge - 5 + r() * 6), z0 + r() * CHUNK, r() * 6.28, 0.6 + r() * 0.6);
        // the depth of it, as impostors, thinning out up the hills
        for (let e = edge + 5; e < edge + 150; e += 5.5) for (let z = z0 + r() * 3; z < z1; z += 5 + r() * 2.5) {
          if (!clearOfBridge(z) || r() < (e - edge) / 400) continue;
          tree(e + r() * 3, z, conifer, false);
        }
      } else if (zone === "field") {
        // a hedgerow along the first field, its trees standing out of it, and hedges across between fields
        const hedge = (e: number, z: number) => put(r() < 0.7 ? "bush" : "bush_b", X(side, e + (r() - 0.5) * 1.2), z, r() * 6.28, 1.4 + r() * 0.9);
        for (let z = z0; z < z1; z += 0.9 + r() * 0.6) if (clearOfBridge(z)) hedge(22, z);
        for (let z = z0 + r() * 20; z < z1; z += 18 + r() * 30) if (clearOfBridge(z)) tree(22 + r(), z, 0.15);
        const off = side > 0 ? 17 : 41, zc = Math.ceil((z0 + off) / 110) * 110 - off; // the fields' rows, as the ground draws them
        if (zc < z1 && clearOfBridge(zc)) for (let e = 24; e < 112; e += 1.1 + r() * 0.7) hedge(e, zc);
        // lone trees out in the fields
        for (let i = 0; i < 4; i++) { const e = 30 + r() * 80; tree(e, z0 + r() * CHUNK, 0.1, e < 70); }
        // a farm: the house, its barn, trees round them
        if (r() < 0.4) {
          const e = 55 + r() * 70, z = z0 + 20 + r() * 80, rot = (r() < 0.5 ? 0 : Math.PI) + (side > 0 ? -1 : 1) * Math.PI / 2;
          put(night && r() < 0.25 ? "house_dark" : "house", X(side, e), z, rot + (r() - 0.5) * 0.2, 1);
          put("barn", X(side, e + 16 + r() * 8), z + (r() - 0.5) * 30, rot, 0.55 + r() * 0.15);
          for (let i = 0; i < 5; i++) put(r() < 0.5 ? "i_oak" : "c_oak", X(side, e + (r() - 0.5) * 40), z + (r() - 0.5) * 50, r() * 6.28, 0.8 + r() * 0.4);
        }
      } else {
        // the edge of a town: a noise barrier, the houses behind it in rows, gardens' trees, a warehouse
        for (let z = z0 + 2; z < z1; z += 4) if (clearOfBridge(z)) put("barrier", X(side, 3.6), z, 0, 1);
        for (const e of [24, 48, 72]) for (let z = z0 + r() * 10; z < z1; z += 20 + r() * 8) {
          put(night && r() < 0.3 ? "house_dark" : "house", X(side, e + r() * 4), z, (side > 0 ? -1 : 1) * Math.PI / 2 + (r() < 0.2 ? Math.PI : 0), 0.95 + r() * 0.15);
          if (r() < 0.7) put(r() < 0.6 ? "i_oak" : "i_aspen", X(side, e + 9 + r() * 4), z + 8 + r() * 4, r() * 6.28, 0.6 + r() * 0.3);
        }
        if (r() < 0.6) put("warehouse", X(side, 110 + r() * 60), z0 + 30 + r() * 60, side * Math.PI / 2, 1);
      }
      if (zone !== "forest") for (let i = 0; i < 6; i++) put("bush", X(side, 9 + r() * 10), z0 + r() * CHUNK, r() * 6.28, 0.7 + r() * 0.6);
      // a boulder or two on the slope
      if (r() < 0.5) put("rock", X(side, 8 + r() * 12), z0 + r() * CHUNK, r() * 6.28, 0.6 + r() * 0.8);
      // far away: woods in patches over the hills, which make the horizon a treeline
      for (let i = 0; i < 110; i++) {
        const e = 160 + Math.pow(r(), 0.8) * 650, z = z0 + r() * CHUNK, x = X(side, e);
        if (fbm(x / 240 + 9, z / 240) < 0.5) continue;
        const k = r();
        put(k < 0.4 ? "c_mix" : k < 0.7 ? "c_pine" : "c_oak", x, z, r() * 6.28, 1.1 + r() * 0.8);
      }
      // street lamps, their light on the road at night
      for (const z of lampsAt(z0, side, night)) {
        put("pole", X(side, 2.9), z, -side * Math.PI / 2, 1);
        if (night) {
          put("pool", X(side, 0.4), z, 0, 1, 0.03);
          put("halo", X(side, 0.1), z, 0, 1.1, 9.75);
        }
      }
    }
  };
}

/** The grass, never one colour: big and small patches, a mown verge with a gravel strip by the asphalt, fields
 *  in their crops past the hedgerow, the dark floor of a forest, earth showing where the slope is steep. */
function groundMaterial(grass: { map: THREE.Texture; normal: THREE.Texture; tile: number }, half: number) {
  const mat = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normal, roughness: 1 });
  mat.normalScale.set(0.6, 0.6);
  worldUV(mat, grass.tile * 2, (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW, vWN, vZone; attribute vec3 aZone;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normal; vZone = aZone;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", `#include <common>
      varying vec3 vW, vWN, vZone;
      float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float gn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y); }
      float gf(vec2 p){ return gn(p)*0.5 + gn(p*2.1)*0.25 + gn(p*4.3)*0.125; }
      // rows in a field, faded out before they'd shimmer
      float rows(float x, float w){ float f = fwidth(x) / w; return mix(0.5 + 0.5 * sin(x * 6.2832 / w), 0.5, smoothstep(0.15, 0.5, f)); }`).replace("#include <map_fragment>", `#include <map_fragment>
      float e = abs(vW.x) - ${half.toFixed(2)}, side = sign(vW.x);
      float big = gf(vW.xz / 70.0), mid = gf(vW.xz / 14.0 + 7.0);
      vec3 g = diffuseColor.rgb * mix(vec3(0.78), vec3(1.08), big);
      g *= mix(vec3(1.0), vec3(1.18, 1.05, 0.62), smoothstep(0.55, 0.8, mid) * 0.7);
      // the mown verge, in the stripes the mower left along it, a little dusty nearest the road
      float verge = 1.0 - smoothstep(10.0, 14.0, e);
      g *= 1.0 + verge * (0.05 + 0.04 * rows(e, 2.4));
      g = mix(g, g * vec3(1.05, 0.98, 0.8) * 0.88, (1.0 - smoothstep(3.0, 7.0, e)) * 0.6);
      // fields: crops in a patchwork, a grass margin round each
      if (vZone.x > 0.001) {
        float col = floor((e - 22.0) / 90.0), off = side > 0.0 ? 17.0 : 41.0;
        float row = floor((vW.z + off) / 110.0);
        float h = gh(vec2(col * 7.0 + side * 3.0, row));
        vec2 cell = vec2(fract((e - 22.0) / 90.0) * 90.0, fract((vW.z + off) / 110.0) * 110.0);
        float margin = smoothstep(2.0, 4.0, min(min(cell.x, 90.0 - cell.x), min(cell.y, 110.0 - cell.y)));
        float lum = dot(g, vec3(0.3, 0.55, 0.15)), s = rows(e + mid * 0.6, 0.8);
        vec3 soil = vec3(0.16, 0.12, 0.085) * (0.8 + 0.5 * mid);
        vec3 f = h < 0.28 ? g * vec3(1.1, 1.12, 0.92)
          : h < 0.52 ? lum * vec3(1.65, 1.35, 0.62) * (0.92 + 0.12 * s)
          : h < 0.72 ? soil * (0.75 + 0.5 * s)
          : h < 0.88 ? mix(soil, g * 1.1, 0.35 + 0.55 * s)
          : g * vec3(1.18, 1.02, 0.7);
        g = mix(g, f, vZone.x * margin);
      }
      // a forest's floor, a town's lawns
      g = mix(g, g * vec3(0.5, 0.47, 0.38) + vec3(0.02, 0.014, 0.006), vZone.y * 0.9);
      g = mix(g, g * vec3(1.04, 1.12, 0.88), vZone.z * 0.6);
      // bare earth on steep slopes
      float steep = 1.0 - smoothstep(0.78, 0.93, normalize(vWN).y);
      if (steep > 0.0) g = mix(g, vec3(0.3, 0.24, 0.17) * (0.75 + 0.5 * mid), steep * smoothstep(0.4, 0.65, gf(vW.xz / 5.0)) * 0.7);
      // the gravel strip between the asphalt and the grass
      float grav = smoothstep(2.45, 2.65, e) * (1.0 - smoothstep(3.2, 3.7 + mid, e));
      g = mix(g, vec3(0.34, 0.32, 0.29) * (0.65 + 0.7 * gh(floor(vW.xz * 25.0))), grav * 0.9);
      diffuseColor.rgb = g;`);
  });
  mat.customProgramCacheKey = () => `ground${half}`;
  return mat;
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
