// A car from cars/<id>.json (made by tools/cars.ts): its parts found by name
// and given what a real car does. The paint is its own material so it can be
// any colour; head, brake, reverse and indicator lamps glow on their own; the
// wheels sit on pivots at their centres so they spin and the front ones steer.
import * as THREE from "./vendor/three.js";
import { BufferGeometryUtils } from "./vendor/three.js";
import { loadGltf } from "./gltf.ts";
import { floats } from "./env.ts";

export type CarInfo = { id: string; name: string; author: string; license: string; source: string; size: [number, number, number] };

const scenes = new Map<string, Promise<THREE.Group>>();

/** The car's scene, loaded once; instances are clones. */
function scene(id: string): Promise<THREE.Group> {
  let s = scenes.get(id);
  if (!s) {
    s = loadGltf(`./cars/${id}.json`, "./cars/").then(prepare);
    scenes.set(id, s);
  }
  return s;
}

type Lamp = "head" | "brake" | "reverse" | "left" | "right" | "bar";
const LAMP: [RegExp, Lamp][] = [
  [/head_?lights?(?!_?glass)/i, "head"],
  [/brake_?lights?/i, "brake"],
  [/reverse/i, "reverse"],
  [/blinkers?/i, "left"], // split into left and right below
  [/lightbar/i, "bar"],
];
// a wheel's own node (the names are unreliable for which corner, so that comes from its position)
const WHEEL = /wh(e|ee)l[a-z]*_(fl|fr|rl|rr)(?![a-z])|(^|[^a-z])wheel_\d+(?![a-z])/i;
const CALIPER = /caliper[a-z]*_(fl|fr)(?![a-z])/i;
const PAINT = /bodymat|(^|_)body$/i;

/** What a model's parts are, worked out once when it loads (they are flattened then, so their parents
 *  are gone): each part's names and box as it was placed, which wheel it belongs to, the model's size;
 *  and the geometries every car of it shares, merged on its first build. */
type Part = { names: string; box: THREE.Box3; wheel: number; caliper: boolean };
type Model = { parts: Part[]; size: THREE.Vector3; wheels: THREE.Box3[]; merged: Map<string, THREE.BufferGeometry> };
const models = new WeakMap<THREE.Object3D, Model>();

/** A part's geometry with the attributes every other one has, as plain floats, so parts merge. */
function plain(src: THREE.BufferGeometry) {
  const g = src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (!["position", "normal", "uv", "uv1"].includes(name)) { g.deleteAttribute(name); continue; }
    const a = g.attributes[name] as THREE.BufferAttribute;
    const f = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  if (!g.attributes.uv1) g.setAttribute("uv1", (g.attributes.uv as THREE.BufferAttribute).clone());
  return g;
}

/** Geometries as one: the attributes they all have, indexed (an unindexed one is given the trivial index). */
function merge(list: THREE.BufferGeometry[]) {
  const names = Object.keys(list[0].attributes).filter((n) => list.every((g) => g.attributes[n]));
  const all = list.map((g) => {
    const out = new THREE.BufferGeometry();
    for (const n of names) out.setAttribute(n, g.attributes[n]);
    out.setIndex(g.index ?? [...Array(g.attributes.position.count).keys()]);
    return out;
  });
  return BufferGeometryUtils.mergeGeometries(all, false);
}

/** Merge every part that never moves on its own into one mesh per material: ~80 meshes become ~10.
 *  Wheels, calipers, lamps and their lenses stay separate (a car merges those per car, in build), and
 *  sit flat under the model with their placement baked in, so a car is a dozen nodes, not a hundred. */
function prepare(src: THREE.Group): THREE.Group {
  src.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const merged: THREE.Mesh[] = [], rest: [THREE.Mesh, string][] = [];
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const names = [mesh.name, mesh.parent?.name ?? "", mesh.parent?.parent?.name ?? ""].join(" ");
    if (WHEEL.test(names) || CALIPER.test(names) || LENS.test(names) || LAMP.some(([re]) => re.test(names))) { rest.push([mesh, names]); return; } // a lamp's lens stays its own mesh: clear, not a window
    const g = plain(mesh.geometry).applyMatrix4(mesh.matrixWorld);
    const mat = mesh.material as THREE.Material;
    (groups.get(mat) ?? groups.set(mat, []).get(mat)!).push(g);
    merged.push(mesh);
  });
  for (const m of merged) m.removeFromParent();
  for (const [mat, list] of groups) {
    const geo = merge(list);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `merged ${mat.name}`;
    src.add(mesh);
  }
  // the model as a car measures it, and each remaining part where it stands; a wheel is its own node,
  // the highest one whose name says wheel (the names are unreliable for which corner: that comes from its position)
  const model: Model = { parts: [], size: new THREE.Box3().setFromObject(src).getSize(new THREE.Vector3()), wheels: [], merged: new Map() };
  const nodes: THREE.Object3D[] = [];
  for (const [mesh, names] of rest) {
    let wheel = -1;
    if (WHEEL.test(names)) {
      let node: THREE.Object3D = mesh;
      while (node.parent && WHEEL.test(node.parent.name)) node = node.parent;
      wheel = nodes.indexOf(node);
      if (wheel < 0) wheel = nodes.push(node) - 1;
    }
    model.parts.push({ names, box: new THREE.Box3().setFromObject(mesh), wheel, caliper: CALIPER.test(names) });
  }
  model.wheels = nodes.map((n) => new THREE.Box3().setFromObject(n));
  rest.forEach(([mesh], i) => {
    mesh.geometry = floats(mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
    mesh.userData.part = i;
    src.add(mesh);
  });
  for (const o of [...src.children]) if (!(o as THREE.Mesh).isMesh) src.remove(o);
  models.set(src, model);
  return src;
}

const cars = new Set<Car>();

/** Real reflections for the car nearest the camera (the hero: in the garage and on the road it is
 *  yours): a 256 px cube of the scene around it, one face every other frame, so its paint and
 *  windows mirror the road, the trees, the other cars and the lamps rather than only the sky photo.
 *  The car itself is hidden while a face is drawn; the shadow map is not redrawn for it. */
export class Reflections {
  private target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  private cube = new THREE.CubeCamera(0.4, 250, this.target);
  private face = 0;
  private tick = 0;
  private car: Car | null = null;
  private v = new THREE.Vector3();

  /** Compile every car's shaders as the reflecting car draws them too: a car first taking the cube
   *  mid-drive would otherwise build its variant then, a stall of a frame or several. */
  async warm(compile: () => Promise<unknown>) {
    for (const c of cars) c.reflect(this.target.texture);
    await compile();
    for (const c of cars) if (c !== this.car) c.reflect(null);
  }

  update(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    // the nearest car within 20 m; the one already reflecting keeps it unless another is clearly nearer
    const at = (c: Car) => c.root.getWorldPosition(this.v).distanceTo(camera.position);
    let best: Car | null = null, bd = 20;
    for (const c of cars) {
      if (!c.root.parent || !c.root.visible) continue;
      const d = at(c) * (c === this.car ? 0.75 : 1);
      if (d < bd) { best = c; bd = d; }
    }
    if (best !== this.car) { this.car?.reflect(null); best?.reflect(this.target.texture); this.car = best; }
    if (!best || this.tick++ % 2) return;
    best.root.getWorldPosition(this.cube.position).y += best.size.y * 0.55;
    this.cube.updateMatrixWorld();
    if (this.cube.coordinateSystem !== gl.coordinateSystem) { this.cube.coordinateSystem = gl.coordinateSystem; this.cube.updateCoordinateSystem(); }
    const last = gl.getRenderTarget();
    best.root.visible = false;
    gl.setRenderTarget(this.target, this.face);
    gl.render(scene, this.cube.children[this.face] as THREE.Camera);
    best.root.visible = true;
    gl.setRenderTarget(last);
    if (++this.face === 6) { this.face = 0; this.target.texture.needsPMREMUpdate = true; }
  }
}

let contact: THREE.MeshBasicMaterial | null = null;
function contactMaterial() {
  if (contact) return contact;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(0,0,0,0.8)"); r.addColorStop(0.5, "rgba(0,0,0,0.5)"); r.addColorStop(0.85, "rgba(0,0,0,0.08)"); r.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  contact = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.7 });
  return contact;
}

/** Lamp colours, how bright each is lit (times the level run.ts asks for: a lit brake lamp is far
 *  brighter than a tail lamp and blooms), and the colour of each when off. */
const LAMP_COLOR: Record<Lamp, number> = { head: 0xfff4e0, brake: 0xff1a0a, reverse: 0xffffff, left: 0xff8a10, right: 0xff8a10, bar: 0xff2020 };
const LAMP_GAIN: Record<Lamp, number> = { head: 1.0, brake: 3.4, reverse: 1.2, left: 1.6, right: 1.6, bar: 2 };
const LAMP_OFF: Record<Lamp, number> = { head: 0xd8d8d8, brake: 0xb0140c, reverse: 0xdddddd, left: 0x8a4a08, right: 0x8a4a08, bar: 0x6a0a06 };
const LENS = /(head|tail|brake)\w*_?glass|lights?_glass/i;
const TYRE = /tire|tyre/i;

/** The lamps in the order the merged lamps' shader indexes them. */
const LAMPS: Lamp[] = ["head", "brake", "reverse", "left", "right", "bar"];
const LAMP_GLOW = LAMPS.map((l) => new THREE.Color(LAMP_COLOR[l]));
const LAMP_DARK = LAMPS.map((l) => new THREE.Color(LAMP_OFF[l]));

/** A car's lamps of one material as one draw: each vertex says which lamp it is (aLamp), and `glow` (the car's,
 *  one colour per lamp, its brightness in it) lights it. Off, a headlamp is a chrome reflector and a tail lamp
 *  coloured plastic. */
function lampMaterial(src: THREE.Material, glow: THREE.Color[]) {
  const m = (src as THREE.MeshStandardMaterial).clone();
  delete m.userData.carAlpha; // a clone has the flag but not the shader change: carAlpha does it again
  m.emissive.set(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = 1;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLampOff = { value: LAMP_DARK };
    sh.uniforms.uLampGlow = { value: glow };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float aLamp; varying float vLamp;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvLamp = aLamp;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying float vLamp; uniform vec3 uLampOff[${LAMPS.length}], uLampGlow[${LAMPS.length}];`)
      .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nint lamp = int(vLamp + 0.5); diffuseColor.rgb = uLampOff[lamp];")
      .replace("#include <metalnessmap_fragment>", THREE.ShaderChunk.metalnessmap_fragment.replace("= metalness;", "= lamp == 0 ? 1.0 : 0.1;"))
      .replace("#include <roughnessmap_fragment>", THREE.ShaderChunk.roughnessmap_fragment.replace("= roughness;", "= lamp == 0 ? 0.12 : 0.25;"))
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance = uLampGlow[lamp];\n#include <emissivemap_fragment>");
  };
  m.customProgramCacheKey = () => "lamps";
  return m;
}

/** A car's wheels and calipers of one material as one draw: each vertex says which it is (aWheel: the wheel,
 *  or the number of wheels + the wheel a caliper sits on), and `turn` (the car's, set before each draw) spins
 *  and steers it about its wheel's centre. */
function wheelMaterial(src: THREE.Material, turn: THREE.Matrix4[]) {
  const m = src.clone();
  m.onBeforeCompile = (sh, r) => {
    src.onBeforeCompile(sh, r);
    sh.uniforms.uTurn = { value: turn };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float aWheel; uniform mat4 uTurn[${turn.length}];`)
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nmat4 turn = uTurn[int(aWheel + 0.5)]; objectNormal = mat3(turn) * objectNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed = (turn * vec4(transformed, 1.0)).xyz;");
  };
  const key = src.customProgramCacheKey.bind(src);
  m.customProgramCacheKey = () => `${key()}|wheels${turn.length}`;
  carAlpha(m);
  return m;
}

/** What a car casts into the sun's shadow map: its parts merged into one shape for the body and one for the
 *  wheels (every car material is double-sided and none is cut out), drawn there in place of ~18 parts and
 *  hidden from every other pass (Renderer.shadows). */
const SHAPE = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
function shape(geos: THREE.BufferGeometry[]) {
  return merge(geos.map((g) => { const p = new THREE.BufferGeometry(); p.setAttribute("position", g.attributes.position); p.setIndex(g.index); return p; }))!;
}

/** Show the cars' shadow shapes (for the shadow map) or hide them (for everything else). */
export function shadowShapes(on: boolean) { for (const c of cars) for (const s of c.shapes) s.visible = on; }

/** Car pixels write alpha 0 (opaque parts in the shader, see-through ones by their blending), which
 *  the finishing reads as "a car": no motion blur on it, and none of its colour smeared onto the road. */
function carAlpha(m: THREE.Material) {
  if (m.userData.carAlpha) return;
  m.userData.carAlpha = true;
  if (m.transparent) {
    Object.assign(m, { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.ZeroFactor });
    return;
  }
  const prev = m.onBeforeCompile.bind(m), key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => { prev(sh, r); sh.fragmentShader = sh.fragmentShader.replace("#include <dithering_fragment>", "#include <dithering_fragment>\n\tgl_FragColor.a = 0.0;"); };
  m.customProgramCacheKey = () => key() + "|car";
}

/** A physical material with a standard one's maps and settings (copying a standard material into a
 *  physical one directly reads physical-only fields it does not have). */
function physical(src: THREE.Material) {
  const m = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(m, src as THREE.MeshStandardMaterial);
  m.defines = { STANDARD: "", PHYSICAL: "" };
  return m;
}

const rubbers = new Map<THREE.Material, THREE.MeshStandardMaterial>();
/** The wheel atlas: tyres matte rubber (the model calls the whole wheel metal), rims and discs metal. */
function rubber(src: THREE.Material) {
  let m = rubbers.get(src);
  if (m) return m;
  m = (src as THREE.MeshStandardMaterial).clone();
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>
      float rub = 1.0 - smoothstep(0.06, 0.22, dot(diffuseColor.rgb, vec3(0.3333)));
      metalnessFactor *= 1.0 - rub;
      roughnessFactor = mix(roughnessFactor, 0.88, rub);`);
  };
  m.customProgramCacheKey = () => "rubber";
  rubbers.set(src, m);
  return m;
}

const chromes = new Map<THREE.Material, THREE.MeshStandardMaterial>();
/** Badges and trim: polished metal. */
function chrome(src: THREE.Material) {
  let m = chromes.get(src);
  if (m) return m;
  m = (src as THREE.MeshStandardMaterial).clone();
  m.metalness = 1; m.roughness = 0.1; m.envMapIntensity = 1.4;
  chromes.set(src, m);
  return m;
}

let beamGeo: THREE.BufferGeometry | null = null, beamMat: THREE.ShaderMaterial | null = null;
const BEAM_LEN = 15;
/** A cone 15 m long from the lamp, opening forward and a little down. */
function beamGeometry() {
  return (beamGeo ??= new THREE.ConeGeometry(2.4, BEAM_LEN, 24, 1, true).translate(0, -BEAM_LEN / 2, 0).rotateX(-Math.PI / 2).rotateX(0.06));
}
/** Light in hazy air: added, brightest where you look along the cone, fading with distance from the
 *  lamp and toward the road (no hard line where the cone meets the ground). Leaves alpha alone. */
function beamMaterial() {
  return (beamMat ??= new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xffe6c4).multiplyScalar(0.05) } },
    vertexShader: `varying vec3 vN, vV; varying float vT, vY, vSeen;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vT = clamp(length(position) / ${BEAM_LEN.toFixed(1)}, 0.0, 1.0); vY = wp.y;
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);
        // seen only from just behind its own car (the chase view): from anywhere else a cone of light
        // in the air reads as a solid thing
        vec3 lamp = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, to = lamp - cameraPosition;
        vSeen = smoothstep(0.8, 0.92, dot(normalize(to), normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0)))) * (1.0 - smoothstep(11.0, 16.0, length(to)));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `uniform vec3 color; varying vec3 vN, vV; varying float vT, vY, vSeen;
      void main(){
        float d = abs(dot(normalize(vN), normalize(vV))), t = 1.0 - vT;
        float f = d * d * t * t * smoothstep(0.0, 0.45, vY) * smoothstep(0.03, 0.3, vT) * vSeen;
        gl_FragColor = vec4(color * f, 0.0);
      }`,
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }));
}

export class Car {
  kind = "";
  root = new THREE.Group();
  body = new THREE.Group(); // pitches and rolls on the springs
  /** Where each wheel is and how it is turned: run.ts sets `spin.rotation.x` and, on a front one, `pivot.rotation.y`. */
  wheels: { pivot: THREE.Object3D; spin: THREE.Object3D; front: boolean; left: boolean; radius: number }[] = [];
  paint: THREE.MeshPhysicalMaterial[] = [];
  size = new THREE.Vector3();
  /** Where things are, in the car's frame (metres, +z forward). */
  anchors = { head: [] as THREE.Vector3[], tail: [] as THREE.Vector3[] };
  wheelbase = 2.6;
  track = 1.5;
  /** What it casts into the shadow map (shadowShapes). */
  shapes: THREE.Mesh[] = [];
  private beams: THREE.Mesh[] = [];
  /** Paint and windows: what mirrors the world (Reflections). */
  private shiny: THREE.MeshStandardMaterial[] = [];
  /** Each lamp's light (lampMaterial), and each wheel's and caliper's turn (wheelMaterial). */
  private glow = LAMPS.map(() => new THREE.Color(0));
  private turn: THREE.Matrix4[] = [];

  static async load(id: string, color: THREE.ColorRepresentation, opts: { shadow?: boolean } = {}) {
    const car = new Car();
    car.kind = id;
    await car.build(await scene(id), color, opts.shadow ?? true);
    return car;
  }

  private async build(src: THREE.Group, color: THREE.ColorRepresentation, shadow: boolean) {
    const info = models.get(src)!;
    const model = src.clone(true); // flat (prepare): its parts are its children
    this.root.add(this.body);
    this.body.add(model);
    this.size.copy(info.size);

    const meshes = [...model.children] as THREE.Mesh[];
    const paintFor = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
    const heads = new THREE.Box3();
    const lit: [THREE.Mesh, Lamp][] = [], turning: [THREE.Mesh, number][] = [], casts: THREE.BufferGeometry[] = [];

    for (const mesh of meshes) {
      const part = info.parts[mesh.userData.part as number] as Part | undefined; // none for a merged part
      const names = part?.names ?? [mesh.name, model.name, ""].join(" ");
      mesh.receiveShadow = true;
      const mat = mesh.material as THREE.MeshStandardMaterial;

      // paint: one material per car, so a colour is just that car's. A metallic base (the model's flake
      // texture varies it) under a glossy clear coat that mirrors the sky
      if (PAINT.test(mat.name)) {
        let p = paintFor.get(mat);
        if (!p) {
          p = physical(mat);
          p.color.set(color);
          p.metalness = 0.6; p.roughness = 0.42;
          p.clearcoat = 1; p.clearcoatRoughness = 0.035;
          p.envMapIntensity = 1.6;
          paintFor.set(mat, p);
          this.paint.push(p);
          this.shiny.push(p);
        }
        mesh.material = p;
      } else if (/glass|windshield/i.test(names) && mat.transparent) {
        // a lamp's lens is clear; a window is tinted, dark from outside, and reflects the sky
        const lens = LENS.test(names), g = physical(mat);
        g.metalness = 0; g.roughness = 0.05; g.clearcoat = 1; g.clearcoatRoughness = 0.03;
        g.color.set(lens ? 0xf4f4f4 : 0x06090c); g.opacity = lens ? 0.3 : 0.9;
        g.envMapIntensity = lens ? 1.5 : 2.2;
        g.depthWrite = !lens; // a window is the surface the depth-based finishing sees, not the cabin behind it
        if (!lens) this.shiny.push(g);
        mesh.material = g;
        mesh.renderOrder = 2;
      } else if (TYRE.test(mat.name)) mesh.material = rubber(mat);
      else if (/badges/i.test(mat.name)) mesh.material = chrome(mat);

      const lamp = LAMP.find(([re]) => re.test(names))?.[1];
      if (lamp) {
        lit.push([mesh, lamp]);
        const c = part!.box.getCenter(new THREE.Vector3());
        if (lamp === "head") { this.anchors.head.push(c); heads.union(part!.box); } else if (lamp === "brake") this.anchors.tail.push(c);
      }
      // a caliper follows its front wheel's steering, without spinning
      const cx = part?.caliper ? part.box.getCenter(new THREE.Vector3()).x : 0;
      const on = part?.caliper ? info.wheels.findIndex((b) => { const c = b.getCenter(new THREE.Vector3()); return c.z > 0 && c.x > 0 === cx > 0; }) : -1;
      if (on >= 0) turning.push([mesh, info.wheels.length + on]);
      else if (part && part.wheel >= 0) turning.push([mesh, part.wheel]);
      else if (lamp !== "left") casts.push(mesh.geometry); // a blinker casts nothing
    }

    // the lamps of a material as one mesh; a blinker mesh holds both sides, told apart by each triangle's side
    const groups = (list: [THREE.Mesh, number][]) => { const m = new Map<THREE.Material, [THREE.Mesh, number][]>(); for (const e of list) (m.get(e[0].material as THREE.Material) ?? m.set(e[0].material as THREE.Material, []).get(e[0].material as THREE.Material)!).push(e); return [...m]; };
    groups(lit.map(([m, l]) => [m, LAMPS.indexOf(l)])).forEach(([mat, list], i) => {
      const geo = cached(info, `lamps${i}`, () => merge(list.map(([mesh, l]) => {
        let g = plain(mesh.geometry);
        if (LAMPS[l] === "left") g = g.toNonIndexed();
        const p = g.attributes.position, at = new Float32Array(p.count).fill(l);
        if (LAMPS[l] === "left") for (let t = 0; t < p.count; t += 3) if (p.getX(t) + p.getX(t + 1) + p.getX(t + 2) <= 0) at.fill(LAMPS.indexOf("right"), t, t + 3);
        g.setAttribute("aLamp", new THREE.BufferAttribute(at, 1));
        return g;
      }))!);
      const mesh = new THREE.Mesh(geo, lampMaterial(mat, this.glow));
      mesh.renderOrder = Math.max(...list.map(([m]) => m.renderOrder));
      mesh.receiveShadow = true;
      model.add(mesh);
      for (const [m] of list) m.removeFromParent();
    });
    // every part of the car writes alpha 0: the motion blur (looks.ts) leaves cars sharp
    this.body.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) carAlpha(x); });

    // the wheels, on the ground (not the sprung body): pivots at their centres steer, the wheel spins inside;
    // all of them and the calipers of a material drawn as one mesh that turns each part in its shader
    this.wheels = info.wheels.map((b) => {
      const centre = b.getCenter(new THREE.Vector3()), pivot = new THREE.Object3D();
      pivot.position.copy(centre);
      return { pivot, spin: new THREE.Object3D(), front: centre.z > 0, left: centre.x > 0, radius: (b.max.y - b.min.y) / 2 };
    });
    const n = this.wheels.length, spun = new THREE.Matrix4(), back = new THREE.Matrix4();
    this.turn = Array.from({ length: 2 * n }, () => new THREE.Matrix4());
    const turn = () => this.wheels.forEach((w, i) => {
      // about the wheel's centre: steered, then (the wheel, not its caliper) spun
      const steer = this.turn[n + i], wheel = this.turn[i];
      back.makeTranslation(-w.pivot.position.x, -w.pivot.position.y, -w.pivot.position.z);
      steer.makeRotationY(w.pivot.rotation.y).setPosition(w.pivot.position);
      wheel.multiplyMatrices(steer, spun.makeRotationX(w.spin.rotation.x)).multiply(back);
      steer.multiply(back);
    });
    groups(turning).forEach(([mat, list], i) => {
      const geo = cached(info, `wheels${i}`, () => merge(list.map(([mesh, k]) => { const g = plain(mesh.geometry); g.setAttribute("aWheel", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1)); return g; }))!);
      const mesh = new THREE.Mesh(geo, wheelMaterial(mat, this.turn));
      mesh.receiveShadow = true;
      mesh.onBeforeRender = turn;
      this.root.add(mesh);
      for (const [m] of list) m.removeFromParent();
    });

    // the shadow: the body's shape on the body, the wheels' on the ground
    const body = new THREE.Mesh(cached(info, "shape", () => shape(casts)), SHAPE), wheels = new THREE.Mesh(cached(info, "wheelShape", () => shape(turning.map(([m]) => m.geometry))), SHAPE);
    for (const s of [body, wheels]) { s.castShadow = shadow; s.visible = false; this.shapes.push(s); }
    model.add(body);
    if (turning.length) this.root.add(wheels);
    this.shadow = shadow;

    // the light the headlamps throw through the air at night, one cone from each lamp
    if (!heads.isEmpty()) {
      const hw = (heads.max.x - heads.min.x) / 2, cy = (heads.min.y + heads.max.y) / 2;
      for (const x of hw > 0.4 ? [heads.min.x + 0.16, heads.max.x - 0.16] : [(heads.min.x + heads.max.x) / 2]) {
        const cone = new THREE.Mesh(beamGeometry(), beamMaterial());
        cone.position.set(x, cy, heads.max.z - 0.05);
        cone.visible = false;
        this.body.add(cone);
        this.beams.push(cone);
      }
    }

    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) twoPass(o as THREE.Mesh); });
    this.shiny = this.shiny.flatMap((m) => (sides.get(m) as THREE.MeshStandardMaterial[] | undefined) ?? [m]);
    cars.add(this);

    // a soft dark patch under the car: grounds it where the shadow map doesn't reach
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), contactMaterial());
    blob.scale.set(this.size.x * 1.5, 1, this.size.z * 1.25);
    blob.position.y = 0.025;
    blob.renderOrder = -1;
    this.root.add(blob);
    const fronts = this.wheels.filter((w) => w.front), rears = this.wheels.filter((w) => !w.front);
    if (fronts.length && rears.length) {
      this.wheelbase = fronts[0].pivot.position.z - rears[0].pivot.position.z;
      this.track = Math.abs(fronts[0].pivot.position.x - (fronts[1]?.pivot.position.x ?? -fronts[0].pivot.position.x));
    }
  }

  private shadow = true;
  /** Cast shadows or not: only cars near the camera need to. */
  setShadow(on: boolean) {
    if (on === this.shadow) return;
    this.shadow = on;
    for (const s of this.shapes) s.castShadow = on;
  }

  setColor(color: THREE.ColorRepresentation) { for (const p of this.paint) p.color.set(color); }

  /** How brightly each lamp glows (0 off); a lit headlamp also shows its beam. */
  light(lamp: Lamp, level: number) {
    const i = LAMPS.indexOf(lamp);
    this.glow[i].copy(LAMP_GLOW[i]).multiplyScalar(level * LAMP_GAIN[lamp]);
    if (lamp === "head") for (const b of this.beams) b.visible = level > 0;
  }

  /** Mirror a cube of the world (Reflections) instead of the sky photo, or the photo again (null). */
  reflect(env: THREE.Texture | null) { for (const m of this.shiny) m.envMap = env; }

  dispose() { this.root.removeFromParent(); cars.delete(this); }
}

/** A see-through part seen from both sides is drawn back faces first, then front. Three does that by flipping its
 *  material's side for each of the two draws, which makes it work the material's shader out again each time (with
 *  a road full of cars, most of a frame's work); as two groups over the same triangles, a material for each side,
 *  the same two draws, in the same order, cost nothing extra. */
const sides = new WeakMap<THREE.Material, THREE.Material[]>();
function twoPass(mesh: THREE.Mesh) {
  const m = mesh.material as THREE.Material;
  if (Array.isArray(m) || !m.transparent || m.side !== THREE.DoubleSide || m.forceSinglePass) return;
  let pair = sides.get(m);
  if (!pair) {
    pair = [THREE.BackSide, THREE.FrontSide].map((side) => Object.assign(m.clone(), { side, onBeforeCompile: m.onBeforeCompile, customProgramCacheKey: m.customProgramCacheKey }));
    sides.set(m, pair);
  }
  const g = mesh.geometry;
  if (!g.groups.length) { const n = (g.index ?? g.attributes.position).count; g.addGroup(0, n, 0); g.addGroup(0, n, 1); }
  mesh.material = pair;
}

/** A model's merged geometry, made by its first car and shared by the rest. */
const cached = (m: Model, key: string, make: () => THREE.BufferGeometry) => m.merged.get(key) ?? m.merged.set(key, make()).get(key)!;
