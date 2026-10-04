// The views. Traffic Racer's camera is high, narrow and stays on the road's
// centre line, which is what lets you read traffic at speed; ours keeps that
// height and reach but follows you across part of the way, lags your heading
// (so you see the car turn), and opens a few degrees with speed. A hit shakes
// it from the side it came from; a crash lets it drift back and linger.
import * as THREE from "./vendor/three.js";
/** What the camera follows: the car as drawn this frame. */
export type Pose = { x: number; z: number; yaw: number; u: number; ax: number; delta: number };

type View = { name: string; dist: number; h: number; look: number; lookH: number; fov: number; follow: number; speedFov: number };
export const VIEWS: View[] = [
  // higher and narrower than a usual chase cam: more road ahead to read, the car smaller in it
  { name: "Chase", dist: 7.8, h: 3.6, look: 14, lookH: 0.5, fov: 44, follow: 0.5, speedFov: 5 },
  // Traffic Racer's own: 38.5 degrees, about 12 m back and 28 degrees down, on the road's centre line
  { name: "Classic", dist: 10.4, h: 5.5, look: 1.5, lookH: 0, fov: 38.5, follow: 0, speedFov: 0 },
  { name: "Low", dist: 6.2, h: 2.1, look: 12, lookH: 0.9, fov: 52, follow: 0.7, speedFov: 8 },
  { name: "Bumper", dist: -0.6, h: 1.15, look: 40, lookH: 1.05, fov: 62, follow: 1, speedFov: 10 },
];

export class Chase {
  view = 0;
  pos = new THREE.Vector3();
  yaw = 0;
  shake = 0;
  kick = new THREE.Vector2(); // a directional jolt, decaying
  lingering = 0; // after a crash: drift back and around
  private t = 0;
  constructor(public camera: THREE.PerspectiveCamera) {}

  reset(v: Pose) {
    const V = VIEWS[this.view];
    this.pos.set(v.x * V.follow, V.h, v.z - V.dist);
    this.yaw = v.yaw;
    this.lingering = 0;
    this.kick.set(0, 0);
  }

  hit(side: number, strength: number) {
    this.kick.x += side * strength * 0.25;
    this.kick.y += strength * 0.12;
    this.shake = Math.max(this.shake, strength * 0.3);
  }

  update(dt: number, v: Pose, roadMid: number) {
    const V = VIEWS[this.view], cam = this.camera;
    this.t += dt;
    this.yaw += (v.yaw - this.yaw) * Math.min(1, dt * 3.2);
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const sp = Math.min(1, v.u / 75);
    let dist = V.dist + (V.dist > 0 ? sp * 0.8 : 0), h = V.h;
    if (this.lingering > 0) { this.lingering += dt; dist += Math.min(6, this.lingering * 3); h += Math.min(2, this.lingering); }
    // follow the car across only partly: the road stays framed
    const x = roadMid + (v.x - roadMid) * V.follow;
    const want = new THREE.Vector3(x, h, v.z).addScaledVector(fwd, -dist);
    if (V.dist < 0) this.pos.set(v.x, h, v.z).addScaledVector(fwd, -dist);
    else {
      this.pos.x += (want.x - this.pos.x) * Math.min(1, dt * 6);
      this.pos.y += (want.y - this.pos.y) * Math.min(1, dt * 4);
      this.pos.z = want.z + (this.pos.z - want.z) * Math.exp(-dt * 14);
    }
    // a road rumble that grows with speed, a jolt from hits
    this.shake = Math.max(0, this.shake - dt * 1.2);
    this.kick.multiplyScalar(Math.exp(-dt * 7));
    const rumble = sp * sp * 0.01 + this.shake * this.shake * 0.4;
    const n = (f: number, p: number) => Math.sin(this.t * f + p) * 0.6 + Math.sin(this.t * f * 2.3 + p * 2) * 0.4;
    cam.position.copy(this.pos).add(new THREE.Vector3(n(31, 0) * rumble + this.kick.x, n(37, 1) * rumble + this.kick.y, 0));
    const look = new THREE.Vector3(roadMid + (v.x - roadMid) * Math.min(1, V.follow + 0.15), V.lookH, v.z).addScaledVector(fwd, V.look);
    cam.lookAt(look);
    cam.fov = V.fov + sp * sp * V.speedFov - v.ax * 0.12;
    cam.updateProjectionMatrix();
  }
}
