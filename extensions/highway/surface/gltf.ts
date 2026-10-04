// glTF from the JSON files the page can be served (models/*.json with their
// buffers inline as base64). The page's policy forbids fetching data: URLs,
// which is how GLTFLoader reads an inline buffer, so the buffer is decoded
// here and the whole thing handed to the loader as a binary glTF (GLB);
// textures stay files next to the JSON.
import * as THREE from "./vendor/three.js";
import { GLTFLoader } from "./vendor/three.js";

const loader = new GLTFLoader();

function glb(json: { buffers?: { uri?: string; byteLength: number }[] }): ArrayBuffer {
  let bin = new Uint8Array(0);
  const buf = json.buffers?.[0];
  if (buf?.uri?.startsWith("data:")) {
    const b64 = buf.uri.slice(buf.uri.indexOf(",") + 1);
    const raw = atob(b64);
    bin = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
    delete buf.uri;
    buf.byteLength = bin.length;
  }
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = (text.length + 3) & ~3, binLen = (bin.length + 3) & ~3;
  const out = new ArrayBuffer(12 + 8 + jsonLen + (binLen ? 8 + binLen : 0));
  const dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.byteLength, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  u8.set(text, 20);
  for (let i = text.length; i < jsonLen; i++) u8[20 + i] = 0x20;
  if (binLen) {
    const at = 20 + jsonLen;
    dv.setUint32(at, binLen, true); dv.setUint32(at + 4, 0x004e4942, true);
    u8.set(bin, at + 8);
  }
  return out;
}

/** Load a model file; `base` is where its textures are resolved from. */
export async function loadGltf(url: string, base: string): Promise<THREE.Group> {
  const json = await fetch(url).then((r) => r.json());
  return new Promise((ok, fail) => loader.parse(glb(json), base, (g) => ok(g.scene), fail));
}
