// Things only the sun's shadow map sees: render.ts shows them for its pass alone. A car casts one merged
// shape in place of its parts (car.ts); the land's heavy kinds cast from their own copy, culled to the
// shadow's box rather than the camera's view (terrain.ts).
import type * as THREE from "./vendor/three.js";

export const shadowOnly = new Set<THREE.Object3D>();
