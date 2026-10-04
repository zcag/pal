// The environment library in env/ (manifest.json): photographed skies that
// light the scene, PBR ground textures, and props. A sky is a background
// picture plus the same sky in HDR (its sun painted out) for the light that
// bounces everywhere, with a directional light standing in for the sun so it
// casts shadows; the manifest says where the sun is and how bright.
import * as THREE from "./vendor/three.js";
import { loadGltf } from "./gltf.ts";
import { loadSkyHDR } from "./sky-decode.js";

type SkyEntry = { name: string; background: string; hdr: string; hdrNoSun?: string; sun?: { direction: [number, number, number]; color: [number, number, number]; intensity: number } };
type TexEntry = { name: string; files: { color: string; normal: string; orm: string }; tileMetres: number };
type PropEntry = { name: string; file: string };
export type Manifest = { skies: SkyEntry[]; textures: TexEntry[]; props: PropEntry[] };

let manifest: Promise<Manifest> | null = null;
export const env = (): Promise<Manifest> => (manifest ??= fetch("./env/manifest.json").then((r) => r.json() as Promise<Manifest>));

const textures = new THREE.TextureLoader();
const tex = (url: string, srgb = false) => textures.loadAsync(`./env/${url}`).then((t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; });

export type Sky = { sun: THREE.Vector3; color: THREE.Color; intensity: number; dispose(): void };

/** Put a sky on the scene, turned so its sun sits at `sunAngle` (radians from the road's direction, + to the left). */
export async function applySky(scene: THREE.Scene, renderer: THREE.WebGLRenderer, name: string, sunAngle: number): Promise<Sky> {
  const m = await env();
  const s = m.skies.find((x) => x.name === name)!;
  const [bg, hdr] = await Promise.all([tex(s.background, true), loadSkyHDR(`./env/${s.hdrNoSun ?? s.hdr}`)]);
  bg.mapping = THREE.EquirectangularReflectionMapping;
  const dir = new THREE.Vector3(...(s.sun?.direction ?? [0, 1, 0]));
  const yaw = sunAngle - Math.atan2(dir.x, dir.z);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(hdr).texture;
  pmrem.dispose(); hdr.dispose();
  scene.background = bg;
  scene.environment = envMap;
  scene.backgroundRotation.set(0, yaw, 0);
  scene.environmentRotation.set(0, yaw, 0);
  return {
    sun: dir.applyEuler(new THREE.Euler(0, yaw, 0)).normalize(),
    color: new THREE.Color(...(s.sun?.color ?? [1, 1, 1])),
    intensity: s.sun?.intensity ?? 0,
    dispose() { bg.dispose(); envMap.dispose(); },
  };
}

export type Surface = { map: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture; tile: number };

/** A ground texture set: colour, normal, and AO/roughness packed in one. */
export async function surface(name: string): Promise<Surface> {
  const m = await env();
  const t = m.textures.find((x) => x.name === name)!;
  const [map, normal, orm] = await Promise.all([tex(t.files.color, true), tex(t.files.normal), tex(t.files.orm)]);
  for (const x of [map, normal, orm]) { x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 16; }
  return { map, normal, orm, tile: t.tileMetres };
}

/** Sample every map of a material in world space (x, z) / tile metres: no seams, no stretching on any mesh. */
export function worldUV(mat: THREE.MeshStandardMaterial, tile: number, extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <uv_vertex>", `#include <uv_vertex>
      vec2 wuv = (modelMatrix * vec4(position, 1.0)).xz / ${tile.toFixed(3)};
      #ifdef USE_MAP
      vMapUv = wuv;
      #endif
      #ifdef USE_NORMALMAP
      vNormalMapUv = wuv;
      #endif
      #ifdef USE_ROUGHNESSMAP
      vRoughnessMapUv = wuv;
      #endif
      #ifdef USE_AOMAP
      vAoMapUv = wuv;
      #endif`);
    extra?.(sh);
  };
  mat.customProgramCacheKey = () => `wuv${tile}${extra ? extra.toString().length : 0}`;
}


/** Quantized attributes as plain floats, so a transform can't clip them to the quantized range. */
export function floats(g: THREE.BufferGeometry) {
  for (const [name, a] of Object.entries(g.attributes) as [string, THREE.BufferAttribute][]) {
    if (a.array instanceof Float32Array && !(a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) continue;
    const f = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = a.getComponent(i, c);
    g.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
  }
  return g;
}
export type Part = { geo: THREE.BufferGeometry; mat: THREE.Material };

/** A prop as parts (a geometry in the prop's frame and its material each), ready to instance. */
export async function prop(name: string): Promise<Part[]> {
  const m = await env();
  const p = m.props.find((x) => x.name === name)!;
  const scene = await loadGltf(`./env/${p.file}`, "./env/props/");
  scene.updateMatrixWorld(true);
  const parts: Part[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = floats(mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    parts.push({ geo, mat: mesh.material as THREE.Material });
  });
  return parts;
}
