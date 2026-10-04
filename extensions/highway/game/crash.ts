// Contact between two cars seen from above: oriented boxes, separating-axis
// test, and an impulse at the contact that changes both cars' speeds and
// spins them about their centres. Road frame: x across (+ left), z along.

export type Box = { x: number; z: number; yaw: number; w: number; l: number }; // yaw 0 = along +z
export type Contact = { nx: number; nz: number; depth: number; px: number; pz: number }; // normal from b to a

function axes(b: Box) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
  return { fx: s, fz: c, rx: c, rz: -s }; // forward and right unit vectors
}
function corners(b: Box): [number, number][] {
  const { fx, fz, rx, rz } = axes(b), hl = b.l / 2, hw = b.w / 2;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([f, r]) => [b.x + fx * hl * f + rx * hw * r, b.z + fz * hl * f + rz * hw * r]);
}

/** The contact if the boxes overlap, else null. */
export function collide(a: Box, b: Box): Contact | null {
  if (Math.abs(a.z - b.z) > (a.l + b.l) / 2 + 1 || Math.abs(a.x - b.x) > (a.l + b.l) / 2 + 1) return null;
  const ca = corners(a), cb = corners(b);
  const A = axes(a), B = axes(b);
  let best = Infinity, nx = 0, nz = 0;
  for (const [ax, az] of [[A.fx, A.fz], [A.rx, A.rz], [B.fx, B.fz], [B.rx, B.rz]]) {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const [x, z] of ca) { const p = x * ax + z * az; minA = Math.min(minA, p); maxA = Math.max(maxA, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; minB = Math.min(minB, p); maxB = Math.max(maxB, p); }
    const o = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (o <= 0) return null;
    if (o < best) {
      best = o;
      const d = (a.x - b.x) * ax + (a.z - b.z) * az;
      nx = d >= 0 ? ax : -ax; nz = d >= 0 ? az : -az;
    }
  }
  // the contact point: the deepest corner of either box inside the other, else the midpoint
  let px = (a.x + b.x) / 2, pz = (a.z + b.z) / 2, deepest = -Infinity;
  for (const [x, z] of ca) { const d = -((x - b.x) * nx + (z - b.z) * nz); if (inside(b, x, z) && d > deepest) { deepest = d; px = x; pz = z; } }
  for (const [x, z] of cb) { const d = (x - a.x) * nx + (z - a.z) * nz; if (inside(a, x, z) && d > deepest) { deepest = d; px = x; pz = z; } }
  return { nx, nz, depth: best, px, pz };
}

function inside(b: Box, x: number, z: number) {
  const { fx, fz, rx, rz } = axes(b), dx = x - b.x, dz = z - b.z;
  return Math.abs(dx * fx + dz * fz) <= b.l / 2 + 0.05 && Math.abs(dx * rx + dz * rz) <= b.w / 2 + 0.05;
}

/** A body that takes impulses: world velocity, yaw rate, mass and yaw inertia. */
export type Rigid = { x: number; z: number; vx: number; vz: number; r: number; m: number; I: number };

/** Push two bodies apart and exchange an impulse at the contact (restitution e, friction mu). */
export function resolve(a: Rigid, b: Rigid, c: Contact, e = 0.15, mu = 0.35) {
  const rax = c.px - a.x, raz = c.pz - a.z, rbx = c.px - b.x, rbz = c.pz - b.z;
  // velocity of each body at the contact (yaw rate about the vertical; v = w x r in 2D)
  const vax = a.vx + a.r * raz, vaz = a.vz - a.r * rax;
  const vbx = b.vx + b.r * rbz, vbz = b.vz - b.r * rbx;
  const rvx = vax - vbx, rvz = vaz - vbz;
  const vn = rvx * c.nx + rvz * c.nz;
  // separate them, by mass
  const total = a.m + b.m;
  a.x += c.nx * c.depth * (b.m / total); a.z += c.nz * c.depth * (b.m / total);
  b.x -= c.nx * c.depth * (a.m / total); b.z -= c.nz * c.depth * (a.m / total);
  if (vn > 0) return 0; // already parting
  const cross = (rx: number, rz: number, nx: number, nz: number) => rx * nz - rz * nx;
  const ra = cross(rax, raz, c.nx, c.nz), rb = cross(rbx, rbz, c.nx, c.nz);
  const k = 1 / a.m + 1 / b.m + (ra * ra) / a.I + (rb * rb) / b.I;
  const j = (-(1 + e) * vn) / k;
  apply(a, c.nx * j, c.nz * j, rax, raz);
  apply(b, -c.nx * j, -c.nz * j, rbx, rbz);
  // friction along the contact, capped by Coulomb
  const tx = rvx - vn * c.nx, tz = rvz - vn * c.nz, tl = Math.hypot(tx, tz);
  if (tl > 1e-4) {
    const ux = tx / tl, uz = tz / tl;
    const rat = cross(rax, raz, ux, uz), rbt = cross(rbx, rbz, ux, uz);
    const kt = 1 / a.m + 1 / b.m + (rat * rat) / a.I + (rbt * rbt) / b.I;
    const jt = Math.min(tl / kt, mu * j);
    apply(a, -ux * jt, -uz * jt, rax, raz);
    apply(b, ux * jt, uz * jt, rbx, rbz);
  }
  return j; // the impulse, N s: how hard it was
}

function apply(b: Rigid, jx: number, jz: number, rx: number, rz: number) {
  b.vx += jx / b.m; b.vz += jz / b.m;
  b.r -= (rx * jz - rz * jx) / b.I;
}
