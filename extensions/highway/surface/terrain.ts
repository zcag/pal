// The land beside the road, in chunks that stream ahead of the car: flat
// verges by the asphalt rising into rolling hills further out, and whatever
// stands on it (trees, rocks, poles, buildings) scattered per chunk from a seed,
// so the same stretch of road always looks the same.
import * as THREE from "./vendor/three.js";

export const CHUNK = 120; // m along the road
const AHEAD = 9, BEHIND = 1;
const WIDTH = 900; // each side
const COLS = 48, ROWS = 12;

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// value noise for the hills
function hash(x: number, z: number) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, z: number) { let v = 0, a = 0.5; for (let i = 0; i < 5; i++) { v += a * noise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; } return v; }

export type Terrain = { hills: number; flat: number; seed: number }; // hill height, flat verge width

/** Ground height at a point: flat near the road, hills further out. */
export function heightAt(t: Terrain, x: number, z: number, roadHalf: number) {
  const d = Math.max(0, Math.abs(x) - roadHalf - t.flat);
  const rise = 1 - Math.exp(-d / 60);
  const h = (fbm(x / 260 + t.seed, z / 260) - 0.35) * t.hills + fbm(x / 60, z / 60 + t.seed) * t.hills * 0.12;
  // a gentle cutting or embankment right by the road, then the land
  return rise * h - 0.05 + Math.min(d, 6) * 0.02;
}

export type Placer = (r: () => number, z0: number, put: (kind: string, x: number, z: number, rot: number, scale: number) => void) => void;

type Kind = { meshes: THREE.InstancedMesh[]; per: number; yOffset: number };

export class Land {
  group = new THREE.Group();
  ground: THREE.Mesh[] = [];
  material: THREE.MeshStandardMaterial;
  kinds = new Map<string, Kind>();
  slots: number[] = []; // which chunk each slot holds
  constructor(public t: Terrain, public roadHalf: number, material: THREE.MeshStandardMaterial, public placer: Placer) {
    this.material = material;
    for (let i = 0; i < AHEAD + BEHIND; i++) {
      for (const side of [-1, 1]) {
        const geo = new THREE.PlaneGeometry(WIDTH, CHUNK, COLS, ROWS).rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(geo, material);
        m.receiveShadow = true;
        m.userData.side = side;
        this.group.add(m);
        this.ground.push(m);
      }
      this.slots.push(-999);
    }
  }

  /** Something that can stand on the land: its parts (geometry and material each), how many per chunk. */
  addKind(name: string, parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[], per: number, shadow = true, yOffset = 0) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const meshes = parts.map(({ geo, mat }) => {
      const mesh = new THREE.InstancedMesh(geo, mat, per * this.slots.length);
      mesh.castShadow = shadow; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, zero);
      this.group.add(mesh);
      return mesh;
    });
    this.kinds.set(name, { meshes, per, yOffset });
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = -999; // rebuild with the new kind
  }

  private build(slot: number, chunk: number) {
    const z0 = chunk * CHUNK;
    // the ground: two strips, heights from the noise, skirted under the road
    for (let k = 0; k < 2; k++) {
      const m = this.ground[slot * 2 + k], side = m.userData.side as number;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      const base = (m.geometry.userData.base ??= Float32Array.from(pos.array as Float32Array));
      for (let i = 0; i < pos.count; i++) {
        const lx = base[i * 3], lz = base[i * 3 + 2];
        // distance out from the road, denser near it; mirrored on the right so x still grows with lx (the winding holds)
        const d = side > 0 ? lx + WIDTH / 2 : WIDTH / 2 - lx;
        const x = side * (this.roadHalf - 1 + d * Math.pow(d / WIDTH, 1.6));
        const z = z0 + lz + CHUNK / 2;
        pos.setXYZ(i, x, heightAt(this.t, x, z, this.roadHalf), z);
      }
      pos.needsUpdate = true;
      m.geometry.computeVertexNormals();
      m.geometry.computeBoundingSphere();
    }
    // what stands on it
    const used = new Map<string, number>();
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    this.placer(rng(chunk * 7919 + this.t.seed * 13), z0, (kind, x, z, rot, scale) => {
      const k = this.kinds.get(kind);
      if (!k) return;
      const n = used.get(kind) ?? 0;
      if (n >= k.per) return;
      used.set(kind, n + 1);
      const y = Math.abs(x) < this.roadHalf + 0.5 ? 0 : heightAt(this.t, x, z, this.roadHalf);
      M.compose(P.set(x, y + k.yOffset * scale, z), Q.setFromAxisAngle(Y, rot), S.setScalar(scale));
      for (const mesh of k.meshes) mesh.setMatrixAt(slot * k.per + n, M);
    });
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const [name, k] of this.kinds) {
      for (const mesh of k.meshes) {
        for (let n = used.get(name) ?? 0; n < k.per; n++) mesh.setMatrixAt(slot * k.per + n, zero);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  update(z: number) {
    const first = Math.floor(z / CHUNK) - BEHIND;
    for (let c = first; c < first + this.slots.length; c++) {
      const slot = ((c % this.slots.length) + this.slots.length) % this.slots.length;
      if (this.slots[slot] !== c) { this.slots[slot] = c; this.build(slot, c); }
    }
  }
}
