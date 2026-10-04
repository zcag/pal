// The views. Rigid, like Traffic Racer's: the camera never turns with the car
// and never eases after it, so what the car does is what you see it do (its
// heading shows on screen, which is how you judge a turn). It sits a fixed
// fraction of the way between the road's centre line and the car, looks down
// the road, and opens a little with speed (with speed only: tying it to the
// acceleration made every gear change lurch). A hit jolts it from the side it
// came from; after a crash it drifts back and up.
import * as THREE from "./vendor/three.js";

/** What the camera follows: the car as drawn this frame. */
export type Pose = { x: number; z: number; yaw: number; u: number; ax: number; delta: number };

type View = { name: string; dist: number; h: number; look: number; lookH: number; fov: number; follow: number; speedFov: number; attached?: boolean };
export const VIEWS: View[] = [
  // higher than a usual chase cam, about 17 degrees down: the road ahead to read, the car small in it
  { name: "Chase", dist: 8.6, h: 4.4, look: 5, lookH: 0.2, fov: 42, follow: 0.55, speedFov: 4 },
  // Traffic Racer's own: 38.5 degrees, about 12 m back and 28 down, on the road's centre line
  { name: "Classic", dist: 10.4, h: 5.5, look: 1.5, lookH: 0, fov: 38.5, follow: 0, speedFov: 0 },
  { name: "Low", dist: 6.4, h: 2.3, look: 12, lookH: 0.9, fov: 50, follow: 0.75, speedFov: 6 },
  { name: "Bumper", dist: -0.6, h: 1.15, look: 40, lookH: 1.05, fov: 62, follow: 1, speedFov: 8, attached: true },
];

export class Chase {
  view = 0;
  kick = new THREE.Vector2(); // a directional jolt, decaying
  shake = 0;
  lingering = 0; // after a crash: drift back and up
  private fov = 42;
  private t = 0;
  constructor(public camera: THREE.PerspectiveCamera) {}

  reset(v: Pose) {
    this.lingering = 0;
    this.kick.set(0, 0);
    this.shake = 0;
    this.fov = VIEWS[this.view].fov;
    this.update(0, v, 0);
  }

  hit(side: number, strength: number) {
    this.kick.x += side * strength * 0.25;
    this.kick.y += strength * 0.12;
    this.shake = Math.max(this.shake, strength * 0.3);
  }

  update(dt: number, v: Pose, roadMid: number) {
    const V = VIEWS[this.view], cam = this.camera;
    this.t += dt;
    const sp = Math.min(1, v.u / 75);
    let dist = V.dist, h = V.h;
    if (this.lingering > 0) { this.lingering += dt; dist += Math.min(6, this.lingering * 3); h += Math.min(2, this.lingering); }
    this.shake = Math.max(0, this.shake - dt * 1.2);
    this.kick.multiplyScalar(Math.exp(-dt * 7));
    // only hits shake it; the road itself adds the faintest tremor near the top speed
    const tremor = sp > 0.8 ? (sp - 0.8) * 0.02 : 0;
    const n = (f: number, p: number) => Math.sin(this.t * f + p) * 0.6 + Math.sin(this.t * f * 2.3 + p * 2) * 0.4;
    const jx = n(31, 0) * (tremor + this.shake * this.shake * 0.4) + this.kick.x, jy = n(37, 1) * (tremor + this.shake * this.shake * 0.4) + this.kick.y;
    if (V.attached) {
      const fwd = new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw));
      cam.position.set(v.x, h, v.z).addScaledVector(fwd, -dist).add(new THREE.Vector3(jx, jy, 0));
      cam.lookAt(new THREE.Vector3(v.x, V.lookH, v.z).addScaledVector(fwd, V.look));
    } else {
      const x = roadMid + (v.x - roadMid) * V.follow;
      cam.position.set(x + jx, h + jy, v.z - dist);
      cam.lookAt(x, V.lookH, v.z + V.look);
    }
    // the lens opens with speed, slowly, so it never jumps
    const want = V.fov + sp * sp * V.speedFov;
    this.fov += (want - this.fov) * Math.min(1, dt * 1.5);
    if (dt === 0) this.fov = want;
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
