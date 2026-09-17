// A PNG writer of forty lines, so the images tests and the store fixture
// draw their own pictures instead of shipping binaries: RGBA, one IDAT,
// no filter, a zlib stream from node. `sips` (macOS) or ImageMagick then
// turns one into a JPEG for the JPEG cases.
import { deflateSync } from "node:zlib";

const table = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const be32 = (n: number) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

/** One chunk: length, type + data, crc over type + data. */
export function chunk(type: string, data: Uint8Array): Uint8Array[] {
  const t = new TextEncoder().encode(type);
  const td = new Uint8Array(t.length + data.length);
  td.set(t);
  td.set(data, t.length);
  return [be32(data.length), td, be32(crc32(td))];
}

export const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

export type Pixel = (x: number, y: number) => [number, number, number, number];

/** A `w` by `h` RGBA PNG painted by `px`; `extra` chunks go between IHDR and IDAT (a tEXt for the strip test). */
export function png(w: number, h: number, px: Pixel, extra: Uint8Array[] = []): Uint8Array {
  const raw = new Uint8Array(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0;
    for (let x = 0; x < w; x++) raw.set(px(x, y), row + 1 + x * 4);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(be32(w));
  ihdr.set(be32(h), 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunk("IHDR", ihdr), ...extra, ...chunk("IDAT", new Uint8Array(deflateSync(raw))), ...chunk("IEND", new Uint8Array())]);
}

/** A `tEXt` chunk, `key\0value`. */
export const text = (key: string, value: string): Uint8Array => concat(chunk("tEXt", new TextEncoder().encode(`${key}\0${value}`)));

/** A picture with some structure (a gradient, a diagonal stripe, a transparent band on the left), so encoders have something to do. */
export const gradient: Pixel = (x, y) => [(x * 7) & 255, (y * 5) & 255, ((x + y) * 3) & 255, x < 40 ? 0 : 255];
/** Flat colour: compresses to almost nothing, for the "already small" cases. */
export const flat: Pixel = () => [30, 120, 200, 255];
