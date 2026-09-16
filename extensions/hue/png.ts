// A coloured dot as a PNG data url for the bar item's icon: the menu bar
// decodes PNG only (`bar/glyph.rs`), so an SVG will not do there. One
// RGBA image, one IDAT chunk through zlib, the CRC by hand.
import { deflateSync } from "node:zlib";
import type { RGB } from "./color.ts";

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf: Uint8Array) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A `size` px square PNG of a disc in `color`, anti-aliased, transparent around; `ring` draws a hairline outline instead of a fill. */
export function dotPng(color: RGB, size = 36, ring = false): string {
  const raw = new Uint8Array((size * 4 + 1) * size);
  const c = size / 2, r = size / 2 - 1.5;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const cover = ring ? Math.max(0, 1 - Math.abs(d - r + 1)) : Math.max(0, Math.min(1, r - d + 0.5));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(color.r * 255); raw[o + 1] = Math.round(color.g * 255); raw[o + 2] = Math.round(color.b * 255); raw[o + 3] = Math.round(cover * 255);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size); dv.setUint32(4, size);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", ihdr), ...chunk("IDAT", new Uint8Array(deflateSync(raw))), ...chunk("IEND", new Uint8Array())]);
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}
