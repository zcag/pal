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
 *  ~80 meshes become ~10. Wheels, calipers and lamps stay separate. */
function prepare(src: THREE.Group): THREE.Group {
  src.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const merged: THREE.Mesh[] = [];
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const names = [mesh.name, mesh.parent?.name ?? "", mesh.parent?.parent?.name ?? ""].join(" ");
    if (WHEEL.test(names) || CALIPER.test(names) || LAMP.some(([re]) => re.test(names))) return;
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

/** Lamp colours and how bright each is lit. */
const LAMP_COLOR: Record<Lamp, number> = { head: 0xfff4e0, brake: 0xff1a0a, reverse: 0xffffff, left: 0xff8a10, right: 0xff8a10, bar: 0xff2020 };

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

    for (const mesh of meshes) {
      const names = [mesh.name, mesh.parent?.name ?? "", mesh.parent?.parent?.name ?? ""].join(" ");
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      const mat = mesh.material as THREE.MeshStandardMaterial;

      // paint: one material per car, so a colour is just that car's
      if (PAINT.test(mat.name)) {
        let p = paintFor.get(mat);
        if (!p) {
          p = new THREE.MeshPhysicalMaterial().copy(mat as THREE.MeshPhysicalMaterial);
          p.color.set(color);
          p.metalness = 0.55; p.roughness = 0.32;
          p.clearcoat = 1; p.clearcoatRoughness = 0.03;
          p.envMapIntensity = 1.1;
          paintFor.set(mat, p);
          this.paint.push(p);
        }
        mesh.material = p;
      } else if (/glass|windshield/i.test(names) && mat.transparent) {
        const g = (mat as THREE.MeshPhysicalMaterial).clone();
        g.roughness = 0.02; g.metalness = 0; g.envMapIntensity = 1.6;
        g.color.multiplyScalar(0.6);
        g.opacity = Math.max(g.opacity, 0.82);
        g.depthWrite = false;
        mesh.material = g;
        mesh.renderOrder = 2;
      }

      const lamp = LAMP.find(([re]) => re.test(names))?.[1];
      if (lamp) {
        const m = (mesh.material as THREE.MeshStandardMaterial).clone();
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
        if (lamp === "head") this.anchors.head.push(c); else if (lamp === "brake") this.anchors.tail.push(c);
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

  /** How brightly each lamp glows (0 off). */
  light(lamp: Lamp, level: number) { for (const m of this.lamps[lamp]) m.emissiveIntensity = level; }

  dispose() { this.root.removeFromParent(); }
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
