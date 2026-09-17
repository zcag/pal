// A small PNG writer for fixtures and mocks: a picture from a pixel
// function, so a thumbnail in a screenshot is a picture rather than flat
// colour, and a mock's "GIF" is bytes an <img> draws.
import { deflateSync } from "node:zlib";

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An RGB PNG of `w` by `h`, each pixel from `rgb(x, y)`. */
export function png(w: number, h: number, rgb: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) raw.set(rgb(x, y), y * (w * 3 + 1) + 1 + x * 3); }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}

/** A few pictures that read as different things in a grid: a gradient, stripes, a blob, a checker, each in its own hue. */
export function picture(seed: number, w = 96, h = 72): Buffer {
  const hue = (seed * 67) % 360;
  const rgb = (l: number): [number, number, number] => {
    const c = 0.55, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  };
  const kind = seed % 4;
  return png(w, h, (x, y) => {
    if (kind === 0) return rgb(0.35 + (x / w) * 0.4);
    if (kind === 1) return rgb(((x + y) >> 3) % 2 ? 0.45 : 0.7);
    if (kind === 2) { const d = Math.hypot(x - w / 2, y - h / 2); return rgb(d < h / 3 ? 0.75 : 0.4); }
    return rgb(((x >> 4) + (y >> 4)) % 2 ? 0.5 : 0.65);
  });
}
