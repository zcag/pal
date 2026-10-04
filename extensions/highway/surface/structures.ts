// What people built beside and over the road, made from boxes here rather
// than shipped as models: the overpass (deck, parapets, piers, and the road
// it carries off across the land), a panel of noise barrier, the faces of the
// gantry's signs, and the glow of street lamps at night (a pool of light on
// the road, a halo at the head).
import * as THREE from "./vendor/three.js";
import type { Part } from "./env.ts";
import { DECK } from "./terrain.ts";

type Box = [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number];

/** Boxes merged into one geometry, textured by projecting along each face's axis (`tile` m a repeat) and darkened underneath, where little light gets. */
function boxes(list: Box[], tile: number, under = 0.4) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (const [x0, x1, y0, y1, z0, z1] of list) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const p = g.attributes.position, n = g.attributes.normal, base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), nx = Math.abs(n.getX(i)), ny = n.getY(i), nz = Math.abs(n.getZ(i));
      pos.push(x, y, z); nor.push(n.getX(i), ny, n.getZ(i));
      if (Math.abs(ny) > 0.5) uv.push(x / tile, z / tile); else if (nx > nz) uv.push(z / tile, y / tile); else uv.push(x / tile, y / tile);
      const c = ny < -0.5 ? under : 0.75 + 0.25 * Math.min(1, Math.max(0, y / 3)); // dimmer low down, near the dirt
      col.push(c, c, c);
    }
    for (const i of g.index!.array as Uint16Array) idx.push(i + base);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

/** An overpass across the road (x across, z along ours): a deck from slope top to slope top, parapets, a pier on each verge, and its road running off across the land. */
export function overpass(roadHalf: number, concrete: THREE.MeshStandardMaterial, asphalt: THREE.MeshStandardMaterial): Part[] {
  const L = roadHalf + 3 + 1.8 * DECK + 5, top = DECK, bot = DECK - 1.3, W = 6.2;
  const list: Box[] = [
    [-L, L, bot, top, -W, W], // the deck
    [-L, L, top - 0.45, top - 0.05, -W - 0.25, W + 0.25], // its edge beam, a shadow line along the face
    [-L, L, top, top + 0.95, -W - 0.25, -W + 0.15], [-L, L, top, top + 0.95, W - 0.15, W + 0.25], // parapets
  ];
  for (const s of [-1, 1]) {
    const x = s * (roadHalf + 1.7);
    list.push([x - 0.8, x + 0.8, bot - 0.9, bot, -W + 0.4, W - 0.4]); // the pier cap
    for (const z of [-3.6, 0, 3.6]) list.push([x - 0.45, x + 0.45, -1, bot - 0.9, z - 0.45, z + 0.45]); // columns
    list.push([s * (L - 4) - 0.5, s * (L - 4) + 0.5, bot - 2.5, bot, -W, W]); // the abutment, into the slope
  }
  const deck = boxes(list, 2.5);
  const mat = concrete.clone();
  mat.vertexColors = true;
  // the road it carries, off to the fog either side
  const road = new THREE.PlaneGeometry(900, 7.6).rotateX(-Math.PI / 2);
  const geos = [-1, 1].map((s) => road.clone().translate(s * (L + 448), top - 0.1, 0));
  const strip = new THREE.BufferGeometry();
  strip.setAttribute("position", new THREE.Float32BufferAttribute([...geos[0].attributes.position.array, ...geos[1].attributes.position.array], 3));
  strip.setAttribute("normal", new THREE.Float32BufferAttribute([...geos[0].attributes.normal.array, ...geos[1].attributes.normal.array], 3));
  strip.setIndex([...(geos[0].index!.array as Uint16Array), ...[...(geos[1].index!.array as Uint16Array)].map((i) => i + 4)]);
  return [{ geo: deck, mat }, { geo: strip, mat: asphalt }];
}

/** A 4 m panel of noise barrier along z, 4 m tall: a concrete plinth, ribbed metal cassettes, a steel post at one end. */
export function barrierPanel(concrete: THREE.MeshStandardMaterial): Part[] {
  const panel = boxes([[-0.08, 0.08, 0.6, 4.2, -2, 2]], 1);
  const uv = panel.attributes.uv as THREE.BufferAttribute, p = panel.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getZ(i) / 4, (p.getY(i) - 0.6) / 3.6);
  const plinth = boxes([[-0.15, 0.15, -0.6, 0.6, -2, 2]], 2);
  const post = boxes([[-0.12, 0.12, 0, 4.35, -2.1, -1.86]], 1);
  const tex = new THREE.CanvasTexture(ribs());
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8;
  const metal = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.3, vertexColors: true });
  const steel = new THREE.MeshStandardMaterial({ color: 0x55595c, roughness: 0.5, metalness: 0.6 });
  const con = concrete.clone(); con.vertexColors = true;
  return [{ geo: panel, mat: metal }, { geo: plinth, mat: con }, { geo: post, mat: steel }];
}

/** The cassettes' face: grey-green, a seam every half metre, fine ribs between, streaks of dirt from the bottom. */
function ribs() {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#9aa596"; g.fillRect(0, 0, 128, 256);
  for (let y = 0; y < 256; y += 8) { g.fillStyle = y % 64 === 0 ? "rgba(30,38,34,.45)" : "rgba(255,255,255,.07)"; g.fillRect(0, y, 128, y % 64 === 0 ? 3 : 2); }
  const grime = g.createLinearGradient(0, 256, 0, 150);
  grime.addColorStop(0, "rgba(60,52,40,.45)"); grime.addColorStop(1, "rgba(60,52,40,0)");
  g.fillStyle = grime; g.fillRect(0, 150, 128, 106);
  return c;
}

/** The pool of light a street lamp throws on the road: a flat glow, added to whatever is under it. */
export function lampPool(glow: THREE.Texture, color: THREE.ColorRepresentation): Part {
  const geo = new THREE.PlaneGeometry(13, 24).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: glow, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 });
  // near the car the lamps' real lights (world.ts) take over: the pools fade in from 70 m out
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying float vNear;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvNear = smoothstep(70.0, 115.0, distance(cameraPosition, (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz));");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vNear;").replace("#include <map_fragment>", "#include <map_fragment>\ndiffuseColor.rgb *= vNear;");
  };
  mat.customProgramCacheKey = () => "lamp-pool";
  return { geo, mat };
}

/** A halo round a lamp's head: a quad that always faces the camera, brightest in the middle, for the bloom to catch. */
export function halo(color: THREE.ColorRepresentation, strength: number): Part {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color).multiplyScalar(strength) } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0); c.xy += position.xy * length(instanceMatrix[0].xyz); gl_Position = projectionMatrix * c; }`,
    fragmentShader: `uniform vec3 color; varying vec2 vUv; void main() { float r = length(vUv - 0.5) * 2.0; float a = exp(-r * r * 9.0) + 0.25 * exp(-r * r * 2.0); gl_FragColor = vec4(color * a * (1.0 - smoothstep(0.8, 1.0, r)), 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  return { geo, mat };
}

/** The gantry's two direction signs, white on motorway green, a place ahead (fictional) and how far: drawn once
 *  into the bands the model's uvs give them (rows 256-512 the left panel, 0-256 the right, each upside down). */
export function signFace() {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d")!;
  for (const [top, name, km, lean] of [[256, "Ashford Vale", "51", -0.5], [0, "Northgate", "24", 0]] as const) {
    g.save();
    g.translate(0, top + 256); g.scale(1, -1);
    g.fillStyle = "#0f5a34"; g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = "#f2f4f0"; g.lineWidth = 12; g.strokeRect(16, 16, 992, 224);
    g.fillStyle = "#f2f4f0";
    // the arrow, up or bearing off
    g.save(); g.translate(95, 128); g.rotate(lean);
    g.beginPath(); g.moveTo(0, -80); g.lineTo(52, -14); g.lineTo(18, -14); g.lineTo(18, 80); g.lineTo(-18, 80); g.lineTo(-18, -14); g.lineTo(-52, -14); g.closePath(); g.fill();
    g.restore();
    g.font = "700 104px Overpass, sans-serif"; g.textBaseline = "middle";
    const w = g.measureText(name).width;
    if (w > 640) g.font = `700 ${Math.floor(104 * 640 / w)}px Overpass, sans-serif`;
    g.textAlign = "left"; g.fillText(name, 190, 136);
    g.textAlign = "right"; g.fillText(km, 975, 136);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.flipY = false;
  return t;
}
