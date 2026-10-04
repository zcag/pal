// Sketchfab GLBs -> what the page can load: glTF JSON with the buffer inline
// (a data URI) and the textures as shared WebP files, each car facing +z with
// its wheels on y = 0, centred on x and z. Textures are content-addressed, so
// the library every car shares (lights, glass, tyres, plates) is one file each.
import { NodeIO, Document, type Node } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, weld } from "@gltf-transform/functions";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";

// bun scripts/cars.ts <sketchfab dir with list.json and glb/> <out dir> [ids…]
const SRC = process.argv[2];
const OUT = process.argv[3] ?? "out";
process.chdir(SRC);
mkdirSync(`${OUT}/tex`, { recursive: true });
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const list: { uid: string; name: string; author: string; url: string; license: string }[] = JSON.parse(readFileSync("list.json", "utf8"));
const only = process.argv.slice(4);

const slug = (name: string) => name.replace(/ ?- (Low|Retro).*$/i, "").replace(/'/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

function worldBox(doc: Document, filter?: (n: Node) => boolean) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const scene of doc.getRoot().listScenes()) scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh || (filter && !filter(node))) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")!;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        const y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        const w = [x, y, z];
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
      }
    }
  });
  return { min, max, center: min.map((a, k) => (a + max[k]) / 2) };
}

const manifest: Record<string, unknown>[] = existsSync(`${OUT}/cars.json`) ? JSON.parse(readFileSync(`${OUT}/cars.json`, "utf8")) : [];
for (const entry of list) {
  const file = `glb/${entry.uid}.glb`;
  if (!existsSync(file)) continue;
  const id = slug(entry.name);
  if (only.length && !only.includes(id)) continue;
  let doc: Document;
  try { doc = await io.read(file); } catch { console.log('skip (partial?)', id); continue; }
  const scene = doc.getRoot().listScenes()[0];

  // orient: the long horizontal axis is the car's; the headlights say which end is the front
  const all = worldBox(doc);
  const lenX = all.max[0] - all.min[0], lenZ = all.max[2] - all.min[2];
  const axis = lenX > lenZ ? 0 : 2;
  const head = worldBox(doc, (n) => /headlight/i.test(n.getName()));
  const front = Number.isFinite(head.center[axis]) ? Math.sign(head.center[axis] - all.center[axis]) : 1;
  // yaw that takes the front direction to +z
  const yaw = axis === 2 ? (front > 0 ? 0 : Math.PI) : (front > 0 ? -Math.PI / 2 : Math.PI / 2);
  const root = doc.createNode("car").setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
  for (const child of scene.listChildren()) { scene.removeChild(child); root.addChild(child); }
  scene.addChild(root);
  // one was exported at another scale: a delivery van is about 4.4 m
  let b = worldBox(doc);
  const len = b.max[2] - b.min[2];
  if (len > 20) { const k = 4.4 / len; root.setScale([k, k, k]); b = worldBox(doc); }
  root.setTranslation([-b.center[0], -b.min[1], -b.center[2]]);
  const size = worldBox(doc);

  // parts no camera sees: the underbody, the suspension, the inside faces of bumpers and doors
  for (const node of doc.getRoot().listNodes()) {
    if (/bottom|suspension|_inner|trunk_?door_inner|reardoor_.*inner|engine/i.test(node.getName()) && node.getMesh()) node.setMesh(null);
  }
  await doc.transform(dedup(), weld(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }));

  // 16-bit indices where they fit (every part here does): half the bytes
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    if (idx && idx.getArray() instanceof Uint32Array && prim.getAttribute("POSITION")!.getCount() < 65535) idx.setArray(new Uint16Array(idx.getArray()!));
  }

  // textures out to shared WebP files
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage()!;
    const hash = createHash("sha1").update(img).digest("hex").slice(0, 12);
    const path = `tex/${hash}.webp`;
    if (!existsSync(`${OUT}/${path}`)) {
      const meta = await sharp(img).metadata();
      const w = Math.min(1024, meta.width ?? 1024);
      await sharp(img).resize(w, w, { fit: "inside" }).webp({ quality: 82, alphaQuality: 90, effort: 5 }).toFile(`${OUT}/${path}`);
    }
    tex.setURI(path).setMimeType("image/webp");
  }

  const { json, resources } = await io.writeJSON(doc);
  for (const buf of json.buffers ?? []) {
    const data = resources[buf.uri!];
    buf.uri = `data:application/octet-stream;base64,${Buffer.from(data).toString("base64")}`;
  }
  for (const im of json.images ?? []) delete (im as { bufferView?: number }).bufferView;
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(json));
  const rec = {
    id, name: entry.name.replace(/ ?- (Low|Retro).*$/i, ""), author: entry.author, license: entry.license, source: entry.url,
    size: size.max.map((v, k) => +(v - size.min[k]).toFixed(3)), kb: Math.round(JSON.stringify(json).length / 1024),
  };
  const at = manifest.findIndex((m) => m.id === id);
  if (at >= 0) manifest[at] = rec; else manifest.push(rec);
  console.log(id, rec.size.join("x"), `${rec.kb} KB`);
}
writeFileSync(`${OUT}/cars.json`, JSON.stringify(manifest, null, 1));
