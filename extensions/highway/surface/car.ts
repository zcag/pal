// A car from cars/<id>.json (made by tools/cars.ts): its parts found by name
// and given what a real car does. The paint is its own material so it can be
// any colour; head, brake, reverse and indicator lamps glow on their own; the
// wheels sit on pivots at their centres so they spin and the front ones steer.
import * as THREE from "./vendor/three.js";
import { BufferGeometryUtils } from "./vendor/three.js";
import { loadGltf } from "./gltf.ts";

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

/** Merge every part that never moves on its own into one mesh per material:
 *  ~80 meshes become ~10. Wheels, calipers, lamps and their lenses stay separate. */
function prepare(src: THREE.Group): THREE.Group {
  src.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const merged: THREE.Mesh[] = [];
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const names = [mesh.name, mesh.parent?.name ?? "", mesh.parent?.parent?.name ?? ""].join(" ");
    if (WHEEL.test(names) || CALIPER.test(names) || LENS.test(names) || LAMP.some(([re]) => re.test(names))) return; // a lamp's lens stays its own mesh: clear, not a window
    const g = mesh.geometry.clone();
    // the same plain float attributes everywhere, so they merge
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
    g.applyMatrix4(mesh.matrixWorld);
    const mat = mesh.material as THREE.Material;
    (groups.get(mat) ?? groups.set(mat, []).get(mat)!).push(g.index ? g : g);
    merged.push(mesh);
  });
  for (const m of merged) m.removeFromParent();
  for (const [mat, list] of groups) {
    const indexed = list.every((g) => g.index), plain = indexed ? list : list.map((g) => (g.index ? g.toNonIndexed() : g));
    const geo = BufferGeometryUtils.mergeGeometries(plain, false);
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `merged ${mat.name}`;
    src.add(mesh);
  }
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
    const shadows = gl.shadowMap.autoUpdate, last = gl.getRenderTarget();
    gl.shadowMap.autoUpdate = false;
    best.root.visible = false;
    gl.setRenderTarget(this.target, this.face);
    gl.render(scene, this.cube.children[this.face] as THREE.Camera);
    best.root.visible = true;
    gl.shadowMap.autoUpdate = shadows;
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
  wheels: { pivot: THREE.Object3D; spin: THREE.Object3D; front: boolean; left: boolean; radius: number }[] = [];
  paint: THREE.MeshPhysicalMaterial[] = [];
  lamps: Record<Lamp, THREE.MeshStandardMaterial[]> = { head: [], brake: [], reverse: [], left: [], right: [], bar: [] };
  size = new THREE.Vector3();
  /** Where things are, in the car's frame (metres, +z forward). */
  anchors = { head: [] as THREE.Vector3[], tail: [] as THREE.Vector3[] };
  wheelbase = 2.6;
  track = 1.5;
  private beams: THREE.Mesh[] = [];
  /** Paint and windows: what mirrors the world (Reflections). */
  private shiny: THREE.MeshStandardMaterial[] = [];

  static async load(id: string, color: THREE.ColorRepresentation, opts: { shadow?: boolean } = {}) {
    const car = new Car();
    car.kind = id;
    await car.build(await scene(id), color, opts.shadow ?? true);
    return car;
  }

  private async build(src: THREE.Group, color: THREE.ColorRepresentation, shadow: boolean) {
    const model = src.clone(true);
    this.root.add(this.body);
    this.body.add(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    box.getSize(this.size);

    const meshes: THREE.Mesh[] = [];
    model.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const paintFor = new Map<THREE.Material, THREE.MeshPhysicalMaterial>();
    const wheelNodes = new Set<THREE.Object3D>();
    const heads = new THREE.Box3();

    for (const mesh of meshes) {
      const names = [mesh.name, mesh.parent?.name ?? "", mesh.parent?.parent?.name ?? ""].join(" ");
      mesh.castShadow = shadow;
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
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
        // off, a headlamp is a chrome reflector and a tail lamp coloured plastic
        m.color.set(LAMP_OFF[lamp]); m.metalness = lamp === "head" ? 1 : 0.1; m.roughness = lamp === "head" ? 0.12 : 0.25;
        m.emissive = new THREE.Color(LAMP_COLOR[lamp]);
        m.emissiveMap = m.map;
        m.emissiveIntensity = 0;
        if (lamp === "left") {
          // one mesh holds both sides: split it into two
          const [l, r] = splitByX(mesh);
          const mr = m.clone();
          l.material = m; r.material = mr;
          this.lamps.left.push(m); this.lamps.right.push(mr);
        } else {
          mesh.material = m;
          this.lamps[lamp].push(m);
        }
        const c = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
        if (lamp === "head") { this.anchors.head.push(c); heads.union(new THREE.Box3().setFromObject(mesh)); } else if (lamp === "brake") this.anchors.tail.push(c);
      }

      if (WHEEL.test(names)) {
        // the wheel's own node, the highest one whose name says wheel
        let node: THREE.Object3D = mesh;
        while (node.parent && WHEEL.test(node.parent.name)) node = node.parent;
        wheelNodes.add(node);
      }
      const cal = names.match(CALIPER);
      if (cal) mesh.userData.caliper = cal[1].toUpperCase();
    }

    // wheels on pivots at their centres: the pivot steers, the wheel spins inside it
    for (const node of wheelNodes) {
      const wbox = new THREE.Box3().setFromObject(node);
      const centre = wbox.getCenter(new THREE.Vector3());
      const radius = (wbox.max.y - wbox.min.y) / 2;
      const pivot = new THREE.Group();
      pivot.position.copy(centre);
      this.root.add(pivot); // wheels stay on the ground: not on the sprung body
      const spin = new THREE.Group();
      pivot.add(spin);
      node.updateMatrixWorld(true);
      const world = node.matrixWorld.clone();
      spin.updateMatrixWorld(true);
      spin.attach(node);
      node.matrixWorld.copy(world);
      this.wheels.push({ pivot, spin, front: centre.z > 0, left: centre.x > 0, radius });
    }
    // calipers follow the front wheels' steering, without spinning
    for (const mesh of meshes) {
      const c = mesh.userData.caliper as string | undefined;
      const cx = c ? new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()).x : 0;
      const wheel = c && this.wheels.find((w) => w.front && w.left === cx > 0);
      if (wheel) wheel.pivot.attach(mesh);
    }
    // every part of the car writes alpha 0: the motion blur (looks.ts) leaves cars sharp
    this.body.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) carAlpha(x); });
    for (const w of this.wheels) w.pivot.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) carAlpha(m as THREE.Material); });
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
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = on; });
  }

  setColor(color: THREE.ColorRepresentation) { for (const p of this.paint) p.color.set(color); }

  /** How brightly each lamp glows (0 off); a lit headlamp also shows its beam. */
  light(lamp: Lamp, level: number) {
    for (const m of this.lamps[lamp]) m.emissiveIntensity = level * LAMP_GAIN[lamp];
    if (lamp === "head") for (const b of this.beams) b.visible = level > 0;
  }

  /** Mirror a cube of the world (Reflections) instead of the sky photo, or the photo again (null). */
  reflect(env: THREE.Texture | null) { for (const m of this.shiny) m.envMap = env; }

  dispose() { this.root.removeFromParent(); cars.delete(this); }
}

/** Two meshes from one: the triangles left of the car's centre and right of it. */
function splitByX(mesh: THREE.Mesh): [THREE.Mesh, THREE.Mesh] {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  const pos = geo.attributes.position;
  mesh.updateMatrixWorld(true);
  // which side is decided in the car's frame: the mesh's world x (the model is centred on x = 0)
  const m = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const sides: number[][] = [[], []];
  for (let t = 0; t < pos.count; t += 3) {
    let x = 0;
    for (let k = 0; k < 3; k++) x += v.fromBufferAttribute(pos, t + k).applyMatrix4(m).x;
    sides[x > 0 ? 0 : 1].push(t);
  }
  const make = (tris: number[]) => {
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geo.attributes)) {
      const a = attr as THREE.BufferAttribute;
      const out = new Float32Array(tris.length * 3 * a.itemSize);
      let o = 0;
      for (const t of tris) for (let k = 0; k < 3; k++) for (let c = 0; c < a.itemSize; c++) out[o++] = a.getComponent(t + k, c);
      g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize, false));
    }
    const mm = new THREE.Mesh(g, mesh.material);
    mm.castShadow = false;
    mesh.parent!.add(mm);
    mm.position.copy(mesh.position); mm.quaternion.copy(mesh.quaternion); mm.scale.copy(mesh.scale);
    return mm;
  };
  const l = make(sides[0]), r = make(sides[1]);
  mesh.removeFromParent();
  return [l, r];
}
