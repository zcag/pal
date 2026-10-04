// The land beside the road, in chunks that stream ahead of the car, and the
// plan it follows: which stretches are forest, fields or the edge of a town,
// where the road runs in a cutting or on an embankment, where a bridge
// crosses. Everything is a function of the position (or a seed per chunk), so
// the same stretch of road always looks the same and the land, what stands on
// it and its shading agree without talking to each other.
import * as THREE from "./vendor/three.js";

export const CHUNK = 120; // m along the road
const AHEAD = 9, BEHIND = 1;
const WIDTH = 900; // each side
const COLS = 80, ROWS = 24;
const NEAR = 220; // chunks starting closer than this ahead draw their full meshes, the rest their impostors
const PADDED = 8; // a kind of at most this many triangles keeps its instances padded (Land.flush)

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
export function hash(x: number, z: number) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number) { let v = 0, a = 0.5; for (let i = 0; i < 5; i++) { v += a * noise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; } return v; }
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- the plan

/** A stretch of road is 240 m; each side of it is forest, fields or the edge of a town. */
export const SEG = 240;
export type Zone = "forest" | "field" | "town";
export function zoneAt(z: number, side: number, open = 0): Zone {
  const s = Math.floor(z / SEG);
  if (noise(s / 1.7 + 47, 7) > 0.82 && Math.abs(z - bridgeNear(z)) > 150) return "town"; // a town straddles the road
  const forest = noise(s / 2.1 + (side > 0 ? 0 : 57), 3) > 0.5;
  // under a low sun a forest on its side would shade the whole road: there, only one stretch in three is forest
  return forest && (side !== open || s % 3 === 2) ? "forest" : "field";
}
/** Where a forest starts, metres out from the asphalt: 14 to 34, per stretch and side. */
export const forestEdge = (z: number, side: number) => 14 + 20 * hash(Math.floor(z / SEG), side * 9.1);

/** Overpasses: one every 0.9 to 2.1 km. The z of the nearest. */
const BRIDGE_EVERY = 1500;
export function bridgeNear(z: number) {
  const k = Math.floor(z / BRIDGE_EVERY);
  let best = Infinity;
  for (let i = k - 1; i <= k + 1; i++) { const b = i * BRIDGE_EVERY + 450 + hash(i, 3.3) * 600; if (Math.abs(b - z) < Math.abs(best - z)) best = b; }
  return best;
}
export const DECK = 7.2; // the overpass road's height above ours

/** How deep the road runs: + a cutting this many metres deep, - an embankment this high; deep at every bridge. */
export function depthAt(z: number) {
  const b = noise(z / 560 + 3.3, 11.7) * 2 - 1;
  const d = 6 * smooth(0.15, 0.75, b) - 3.5 * smooth(0.2, 0.75, -b);
  const nb = Math.abs(z - bridgeNear(z));
  return d + (DECK - d) * (1 - smooth(70, 240, nb));
}

export type Terrain = { hills: number; seed: number; open?: number }; // hill height; the side kept open to a low sun (+1 left, -1 right)

/** Ground height at a point: a verge and a ditch, the cutting's or embankment's slope, then the hills. `roadHalf` is the paved edge. */
export function heightAt(t: Terrain, x: number, z: number, roadHalf: number) {
  const e = Math.abs(x) - roadHalf, D = depthAt(z);
  let y = -0.06 - Math.max(0, Math.min(e, 3)) * 0.03; // the verge falls away a little, for the water
  let top: number; // where the slope ends, m out
  if (D >= 0) {
    y -= 0.35 * smooth(1.2, 2.4, e) * (1 - smooth(2.6, 3.8, e)) * Math.min(1, D); // a ditch at the foot
    top = 3 + 1.8 * D;
    y += D * smooth(3, top, e);
  } else {
    top = 1.5 + 2 * -D;
    y += D * smooth(1.5, top, e);
  }
  // the hills, rising from the top of the slope; flattened where the bridge's road crosses
  const zb = bridgeNear(z), flat = smooth(14, 60, Math.abs(z - zb));
  const h = (fbm(x / 260 + t.seed, z / 260) - 0.35) * t.hills + fbm(x / 60, z / 60 + t.seed) * t.hills * 0.12;
  return y + (1 - Math.exp(-Math.max(0, e - top - 4) / 60)) * h * flat;
}

// ---------------------------------------------------------------- the land

export type Put = (kind: string, x: number, z: number, rot: number, scale: number, y?: number) => void;
export type Placer = (r: () => number, z0: number, put: Put) => void;
export type Part = { geo: THREE.BufferGeometry; mat: THREE.Material };
type Mode = "near" | "far";

/** A kind of thing on the land: its meshes (and an impostor's for far away), the matrices of every chunk, which
 *  chunks changed, and whether its instances are packed (see flush). */
type Kind = { meshes: THREE.InstancedMesh[]; far: THREE.InstancedMesh[]; per: number; yOffset: number; mats: Float32Array; counts: Int32Array; dirty: Set<number>; packed: boolean };

export class Land {
  group = new THREE.Group();
  ground: THREE.Mesh[] = [];
  material: THREE.MeshStandardMaterial;
  kinds = new Map<string, Kind>();
  slots: number[] = []; // which chunk each slot holds
  near: boolean[] = []; // whether each slot draws full meshes
  private queue: [slot: number, chunk: number, step: number][] = []; // chunks being built, a step a frame
  constructor(public t: Terrain, public roadHalf: number, public half: number, material: THREE.MeshStandardMaterial, public placer: Placer) {
    this.material = material;
    for (let i = 0; i < AHEAD + BEHIND; i++) {
      for (const side of [-1, 1]) {
        const geo = new THREE.PlaneGeometry(WIDTH, CHUNK, COLS, ROWS).rotateX(-Math.PI / 2);
        geo.setAttribute("aZone", new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
        const m = new THREE.Mesh(geo, material);
        m.receiveShadow = true;
        m.userData.side = side;
        this.group.add(m);
        this.ground.push(m);
      }
      this.slots.push(-999);
      this.near.push(true);
    }
  }

  /** Something that can stand on the land: its parts, how many per chunk, and optionally an impostor drawn instead when it's far. */
  addKind(name: string, parts: Part[], per: number, o: { shadow?: boolean; yOffset?: number; far?: Part[]; receive?: boolean } = {}) {
    const make = (list: Part[]) => list.map(({ geo, mat }) => {
      const mesh = new THREE.InstancedMesh(geo, mat, per * this.slots.length);
      mesh.castShadow = o.shadow ?? true; mesh.receiveShadow = o.receive ?? true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      if (mat.userData.depth) mesh.customDepthMaterial = mat.userData.depth;
      this.group.add(mesh);
      return mesh;
    });
    const tris = parts.reduce((a, { geo }) => a + (geo.index ?? geo.attributes.position).count / 3, 0);
    this.kinds.set(name, { meshes: make(parts), far: make(o.far ?? []), per, yOffset: o.yOffset ?? 0, mats: new Float32Array(per * this.slots.length * 16), counts: new Int32Array(this.slots.length), dirty: new Set(), packed: !!o.far || tris > PADDED });
    for (let i = 0; i < this.slots.length; i++) this.slots[i] = -999; // rebuild with the new kind
  }

  /** Build a chunk in three steps (each side's ground, then what stands on it), or all of them. */
  private build(slot: number, chunk: number, step = -1) {
    if (step < 0) { for (let i = 0; i < 3; i++) this.build(slot, chunk, i); return; }
    if (step < 2) this.groundFor(slot, chunk, step);
    else this.place(slot, chunk);
  }

  /** The ground: a strip, finer near the road, heights from the plan; what each vertex is (field, forest floor, lawn) for the shading. */
  private groundFor(slot: number, chunk: number, k: number) {
    const z0 = chunk * CHUNK;
    {
      const m = this.ground[slot * 2 + k], side = m.userData.side as number;
      const pos = m.geometry.attributes.position as THREE.BufferAttribute, zone = m.geometry.attributes.aZone as THREE.BufferAttribute;
      const base = (m.geometry.userData.base ??= Float32Array.from(pos.array as Float32Array));
      const zn = zoneAt(z0, side, this.t.open), edge = forestEdge(z0, side); // a chunk is all in one stretch
      for (let i = 0; i < pos.count; i++) {
        const lx = base[i * 3], lz = base[i * 3 + 2];
        // distance out from the road; mirrored on the right so x still grows with lx (the winding holds)
        const d = (side > 0 ? lx + WIDTH / 2 : WIDTH / 2 - lx) / WIDTH;
        const x = side * (this.roadHalf - 1 + WIDTH * Math.pow(d, 2.3));
        const z = z0 + lz + CHUNK / 2;
        pos.setXYZ(i, x, heightAt(this.t, x, z, this.roadHalf), z);
        const e = Math.abs(x) - this.half;
        zone.setXYZ(i, zn === "field" ? smooth(18, 26, e) : 0, zn === "forest" ? smooth(edge - 4, edge + 3, e) : 0, zn === "town" ? smooth(8, 14, e) : 0);
      }
      pos.needsUpdate = true; zone.needsUpdate = true;
      m.geometry.computeVertexNormals();
      m.geometry.computeBoundingSphere();
    }
  }

  /** What stands on a chunk. */
  private place(slot: number, chunk: number) {
    const z0 = chunk * CHUNK;
    for (const k of this.kinds.values()) { k.counts[slot] = 0; k.dirty.add(slot); }
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    this.placer(rng(chunk * 7919 + this.t.seed * 13), z0, (kind, x, z, rot, scale, y) => {
      const k = this.kinds.get(kind);
      if (!k) return;
      const n = k.counts[slot];
      if (n >= k.per) return;
      k.counts[slot] = n + 1;
      y ??= Math.abs(x) < this.roadHalf + 0.5 ? 0 : heightAt(this.t, x, z, this.roadHalf);
      M.compose(P.set(x, y + k.yOffset * scale, z), Q.setFromAxisAngle(Y, rot), S.setScalar(scale));
      M.toArray(k.mats, (slot * k.per + n) * 16);
    });
  }

  /** Copy the changed chunks' matrices into a kind's meshes. A packed kind (one with an impostor: near chunks into
   *  the full meshes, far ones into the impostor's; or a model of more than a few triangles) is sent whole, being
   *  few; a quad's kind (grass, impostors: thousands of them) keeps a fixed range per chunk, padded with nothing,
   *  so only the chunk that streamed in is sent, and the padding costs a few empty vertices. */
  private flush(k: Kind) {
    const zero = new Float32Array(16);
    if (!k.packed) {
      for (const m of k.meshes) {
        const dst = m.instanceMatrix.array as Float32Array;
        m.count = k.per * this.slots.length;
        m.instanceMatrix.clearUpdateRanges();
        for (const s of k.dirty) {
          const at = s * k.per * 16, n = k.counts[s];
          dst.set(k.mats.subarray(at, at + n * 16), at);
          for (let i = n; i < k.per; i++) dst.set(zero, at + i * 16);
          m.instanceMatrix.addUpdateRange(at, k.per * 16);
        }
        m.instanceMatrix.needsUpdate = true;
      }
      k.dirty.clear();
      return;
    }
    k.dirty.clear();
    const fill = (meshes: THREE.InstancedMesh[], want: Mode | null) => {
      if (!meshes.length) return;
      let n = 0;
      const dst = meshes[0].instanceMatrix.array as Float32Array;
      for (let s = 0; s < this.slots.length; s++) {
        if (want && (this.near[s] ? "near" : "far") !== want) continue;
        const c = k.counts[s];
        dst.set(k.mats.subarray(s * k.per * 16, (s * k.per + c) * 16), n * 16);
        n += c;
      }
      for (const m of meshes) {
        if (m !== meshes[0]) (m.instanceMatrix.array as Float32Array).set(dst.subarray(0, n * 16));
        m.count = n;
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, Math.max(16, n * 16));
        m.instanceMatrix.needsUpdate = true;
      }
    };
    fill(k.meshes, k.far.length ? "near" : null);
    fill(k.far, "far");
  }

  /** Everything up to the horizon built now (behind the loading sign), not a step a frame. Each update
   *  sends only what it changed, and the next one in the same frame would drop that before the GPU got
   *  it (stale trees and houses on the road for a few frames), so the lot goes up whole at the end. */
  ready(z: number) {
    do this.update(z); while (this.queue.length);
    for (const k of this.kinds.values()) for (const m of [...k.meshes, ...k.far]) { m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.needsUpdate = true; }
  }

  update(z: number) {
    const first = Math.floor(z / CHUNK) - BEHIND;
    for (let c = first; c < first + this.slots.length; c++) {
      const slot = ((c % this.slots.length) + this.slots.length) % this.slots.length;
      if (this.slots[slot] !== c) {
        this.slots[slot] = c;
        // near (the start, a jump) at once; far ahead, a step a frame so no one frame carries the lot
        if (c <= Math.floor(z / CHUNK) + 2) this.build(slot, c);
        else this.queue.push([slot, c, 0]);
      }
      const near = c * CHUNK < z + NEAR;
      if (this.near[slot] !== near) { this.near[slot] = near; for (const k of this.kinds.values()) if (k.far.length) k.dirty.add(slot); }
    }
    const job = this.queue[0];
    if (job) {
      if (this.slots[job[0]] === job[1]) this.build(job[0], job[1], job[2]++);
      if (job[2] > 2 || this.slots[job[0]] !== job[1]) this.queue.shift();
    }
    for (const k of this.kinds.values()) if (k.dirty.size) this.flush(k);
  }
}
