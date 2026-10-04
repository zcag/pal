// Trees, bushes and grass that cost little. A tree far away is an impostor: the
// real model rendered once at startup, from the side, into an atlas (its colour,
// and its normals so the sun still models the crown), then drawn as one quad
// that turns to face the camera. A clump of grass is three crossed cards with a
// texture of blades drawn on a canvas. The EZ-Tree models' leaf cards are
// grown about their centres so the crowns read full rather than twiggy.
import * as THREE from "./vendor/three.js";
import type { Part } from "./env.ts";

/** The parts with every leaf card (four vertices each, in an alpha-tested material) grown by `k` about its centre, and the leaves recoloured. */
export function fuller(parts: Part[], k: number, leaves?: THREE.ColorRepresentation, map?: THREE.Texture | null): Part[] {
  return parts.map(({ geo, mat }) => {
    if (!(mat as THREE.MeshStandardMaterial).alphaTest) return { geo, mat };
    const g = geo.clone(), p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i + 3 < p.count; i += 4) {
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < 4; j++) { cx += p.getX(i + j) / 4; cy += p.getY(i + j) / 4; cz += p.getZ(i + j) / 4; }
      for (let j = 0; j < 4; j++) p.setXYZ(i + j, cx + (p.getX(i + j) - cx) * k, cy + (p.getY(i + j) - cy) * k, cz + (p.getZ(i + j) - cz) * k);
    }
    const m = (mat as THREE.MeshStandardMaterial).clone();
    if (leaves !== undefined) m.color.set(leaves);
    if (map) m.map = map;
    return { geo: g, mat: m };
  });
}

/** One thing to bake: parts placed at (x, z), turned and scaled; a cluster is several. */
export type Placed = { parts: Part[]; x?: number; z?: number; rot?: number; s?: number };

const BAKE_VERT = `varying vec2 vUv; varying vec3 vN, vP;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
// colour (dimmed inside and under the crown, which the sky barely reaches) or the normal, bent toward the crown's outside so it shades as a mass
const BAKE_FRAG = `uniform sampler2D map; uniform vec3 color, centre, radius; uniform float alphaTest, hasMap, leaf, mode; varying vec2 vUv; varying vec3 vN, vP;
  void main() {
    vec4 t = hasMap > 0.5 ? texture2D(map, vUv) : vec4(1.0);
    if (t.a < alphaTest) discard;
    vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
    vec3 q = (vP - centre) / radius;
    n = normalize(mix(n, normalize(q + vec3(0.0, 0.0, 1e-3)), leaf * 0.7));
    float ao = mix(0.5, 1.0, smoothstep(0.15, 1.0, length(q))) * mix(0.72, 1.0, smoothstep(-1.0, 0.7, q.y));
    gl_FragColor = mode < 0.5 ? vec4(t.rgb * color * ao, 1.0) : vec4(n * 0.5 + 0.5, 1.0);
  }`;

const CELL = 512;

/** Render every entry into one atlas (colour and normals) and return each as a billboard part sharing one material. */
export function bake(renderer: THREE.WebGLRenderer, entries: [string, Placed[]][]): Map<string, Part> {
  const cols = 4, rows = Math.ceil(entries.length / cols);
  const opts = { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true };
  const colour = new THREE.WebGLRenderTarget(cols * CELL, rows * CELL, opts), normals = new THREE.WebGLRenderTarget(cols * CELL, rows * CELL, opts);
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, 0, 0.1, 400);
  const prev = { target: renderer.getRenderTarget(), auto: renderer.autoClear, clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() };
  renderer.autoClear = false;
  // clear to the leaves' own tone (alpha 0), so filtering at the cut edges doesn't fringe them dark
  for (const [rt, c] of [[colour, 0x2c3a1c], [normals, 0x8080ff]] as const) { renderer.setRenderTarget(rt); renderer.setClearColor(c, 0); renderer.clear(); }
  const out = new Map<string, Part>();
  const material = impostorMaterial(colour.texture, normals.texture);
  entries.forEach(([name, items], i) => {
    // the things, with a bake material each, and how far they reach from the axis and up
    const group = new THREE.Group(), mats: THREE.ShaderMaterial[] = [];
    for (const it of items) for (const { geo, mat } of it.parts) {
      const m = mat as THREE.MeshStandardMaterial;
      const bm = new THREE.ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: THREE.DoubleSide, uniforms: {
        map: { value: m.map }, hasMap: { value: m.map ? 1 : 0 }, color: { value: m.color.clone() }, alphaTest: { value: m.alphaTest || 0.5 },
        leaf: { value: m.alphaTest ? 1 : 0.3 }, mode: { value: 0 }, centre: { value: new THREE.Vector3() }, radius: { value: new THREE.Vector3(1, 1, 1) } } });
      mats.push(bm);
      const mesh = new THREE.Mesh(geo, bm);
      mesh.position.set(it.x ?? 0, 0, it.z ?? 0); mesh.rotation.y = it.rot ?? 0; mesh.scale.setScalar(it.s ?? 1);
      group.add(mesh);
    }
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    const w = 2 * Math.max(-box.min.x, box.max.x) * 1.02, h = box.max.y * 1.02;
    for (const bm of mats) { bm.uniforms.centre.value.set(0, h * 0.58, 0); bm.uniforms.radius.value.set(w / 2, h * 0.45, Math.max(-box.min.z, box.max.z)); }
    cam.left = -w / 2; cam.right = w / 2; cam.top = h; cam.bottom = 0;
    cam.position.set(0, 0, 200); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
    const cx = (i % cols) * CELL, cy = Math.floor(i / cols) * CELL;
    for (const [rt, mode] of [[colour, 0], [normals, 1]] as const) {
      for (const bm of mats) bm.uniforms.mode.value = mode;
      rt.viewport.set(cx, cy, CELL, CELL); rt.scissor.set(cx, cy, CELL, CELL); rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.clearDepth();
      renderer.render(scene, cam);
    }
    scene.remove(group);
    for (const bm of mats) bm.dispose();
    // the quad: as wide and tall as the bake, standing on its base (a little sunk, for slopes), uvs on its cell
    const geo = new THREE.PlaneGeometry(w, h).translate(0, h / 2 - 0.25, 0);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k) * CELL) / (cols * CELL), (cy + uv.getY(k) * CELL) / (rows * CELL));
    out.set(name, { geo, mat: material });
  });
  for (const rt of [colour, normals]) { rt.scissorTest = false; rt.viewport.set(0, 0, rt.width, rt.height); }
  renderer.setRenderTarget(prev.target); renderer.autoClear = prev.auto; renderer.setClearColor(prev.clear, prev.alpha);
  return out;
}

// turn the quad to face the camera about its own vertical axis (in the shadow pass the camera is the sun);
// the instance's turn only mirrors it, which is all the variety one view can give
const FACE = `
  vec4 bbC = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float bbS = length(instanceMatrix[0].xyz);
  vec3 bbF = cameraPosition - bbC.xyz; bbF.y = 0.0;
  bbF = dot(bbF, bbF) > 1e-6 ? normalize(bbF) : vec3(0.0, 0.0, 1.0);
  vec3 bbR = vec3(bbF.z, 0.0, -bbF.x) * (instanceMatrix[2].x >= 0.0 ? 1.0 : -1.0);
  mat3 bbInv = transpose(mat3(instanceMatrix)) / (bbS * bbS);`;
const PLACE = `vec3 transformed = bbInv * (bbR * position.x + vec3(0.0, position.y, 0.0) + bbF * position.z) * bbS;`;

/** The impostors' material: lit like everything else, with the baked normal turned to where the quad faces; tinted a little per tree. */
function impostorMaterial(colour: THREE.Texture, normals: THREE.Texture) {
  const mat = new THREE.MeshStandardMaterial({ map: colour, alphaTest: 0.5, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  mat.alphaToCoverage = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNormals = { value: normals };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vBbR, vBbF; varying float vTint;")
      .replace("#include <beginnormal_vertex>", `${FACE}\nvec3 objectNormal = bbInv * bbF * bbS;\nvBbR = bbR; vBbF = bbF;\nvTint = fract(sin(dot(bbC.xz, vec2(12.9898, 78.233))) * 43758.5453);`)
      .replace("#include <begin_vertex>", PLACE);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uNormals; varying vec3 vBbR, vBbF; varying float vTint;")
      // keep the crowns' coverage in the small mips, then a crisp edge from alpha to coverage
      .replace("#include <map_fragment>", `#include <map_fragment>
        vec2 aTx = vMapUv * vec2(textureSize(map, 0));
        float aLod = max(0.0, 0.5 * log2(max(dot(dFdx(aTx), dFdx(aTx)), dot(dFdy(aTx), dFdy(aTx)))));
        diffuseColor.a = clamp((diffuseColor.a * (1.0 + aLod * 0.3) - 0.5) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0);
        diffuseColor.rgb *= mix(vec3(0.78, 0.8, 0.74), vec3(1.12, 1.1, 0.92), vTint);`)
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
        vec3 bn = texture2D(uNormals, vMapUv).xyz * 2.0 - 1.0;
        normal = normalize((viewMatrix * vec4(vBbR * bn.x + vec3(0.0, bn.y, 0.0) + vBbF * bn.z, 0.0)).xyz);`);
  };
  mat.customProgramCacheKey = () => "impostor";
  // the shadow: the same quad, turned to the sun
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: colour, alphaTest: 0.5, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `${FACE}\n${PLACE}`); };
  depth.customProgramCacheKey = () => "impostor-depth";
  mat.userData.depth = depth;
  return mat;
}

/** A clump of grass: three cards crossed, their normals straight up so they light like the ground they grow from; they shrink away with distance. */
export function grassClump(): Part {
  const cards = [0, 1, 2].map((i) => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY((i * Math.PI) / 3));
  const geo = mergeAll(cards);
  const n = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const tex = new THREE.CanvasTexture(blades());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
  mat.alphaToCoverage = true;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vec3 gC = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      transformed *= 1.0 - smoothstep(55.0, 95.0, distance(cameraPosition.xz, gC.xz));`);
    sh.fragmentShader = sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
      diffuseColor.a = clamp((diffuseColor.a - 0.5) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0);
      diffuseColor.rgb *= mix(0.62, 1.08, vMapUv.y);`).replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);");
  };
  mat.customProgramCacheKey = () => "grass";
  return { geo, mat };
}

function mergeAll(geos: THREE.BufferGeometry[]) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of geos) {
    pos.push(...(g.attributes.position.array as Float32Array)); nor.push(...(g.attributes.normal.array as Float32Array)); uv.push(...(g.attributes.uv.array as Float32Array));
    for (const i of g.index!.array as Uint16Array) idx.push(i + base);
    base += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** Blades of grass on a transparent canvas: tapered, leaning, greens with the odd dry one. */
function blades() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const x = 20 + r() * 216, h = 90 + r() * 160, lean = (r() - 0.5) * 90, w = 3 + r() * 5;
    const dry = r() < 0.18, l = 0.6 + r() * 0.5;
    g.fillStyle = dry ? `rgb(${175 * l | 0},${165 * l | 0},${95 * l | 0})` : `rgb(${(90 + r() * 50) * l | 0},${(120 + r() * 50) * l | 0},${(35 + r() * 25) * l | 0})`;
    g.beginPath();
    g.moveTo(x - w / 2, 256);
    g.quadraticCurveTo(x - w / 4 + lean * 0.3, 256 - h * 0.6, x + lean, 256 - h);
    g.quadraticCurveTo(x + w / 4 + lean * 0.3, 256 - h * 0.6, x + w / 2, 256);
    g.fill();
  }
  return c;
}
