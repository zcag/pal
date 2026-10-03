// Pictures from bytes: a JPEG decoded (jpeg-js), its corners rounded into
// a PNG for the bar's strip (the menu bar and sketchybar draw raster
// pictures only, `bar/glyph.rs`), and a cover's dominant colour, which the
// Now Playing view turns into its backdrop. One small PNG encoder (one
// RGBA image, one IDAT through zlib), as Hue's dot is made.
import { decode } from "jpeg-js";
import { deflateSync } from "node:zlib";

export type RGB = { r: number; g: number; b: number };
export type Pixels = { width: number; height: number; data: Uint8Array };

/** A JPEG's pixels as RGBA, or undefined for bytes that are not one. */
export function decodeJpeg(bytes: Uint8Array): Pixels | undefined {
  try {
    const img = decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 4, maxMemoryUsageInMB: 64 });
    return { width: img.width, height: img.height, data: img.data as Uint8Array };
  } catch { return undefined; }
}

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

/** RGBA pixels as a PNG data url. */
export function pngData(p: Pixels): string {
  const row = p.width * 4 + 1;
  const raw = new Uint8Array(row * p.height);
  for (let y = 0; y < p.height; y++) raw.set(p.data.subarray(y * p.width * 4, (y + 1) * p.width * 4), y * row + 1);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, p.width); dv.setUint32(4, p.height);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", ihdr), ...chunk("IDAT", new Uint8Array(deflateSync(raw))), ...chunk("IEND", new Uint8Array())]);
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

/** The picture with its corners cut round (a radius of `r` of the shorter side), anti-aliased, as tvOS and macOS draw app icons. */
export function rounded(p: Pixels, r = 0.225): Pixels {
  const out = new Uint8Array(p.data);
  const rad = Math.min(p.width, p.height) * r;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const cx = x + 0.5 < rad ? rad : x + 0.5 > p.width - rad ? p.width - rad : x + 0.5;
    const cy = y + 0.5 < rad ? rad : y + 0.5 > p.height - rad ? p.height - rad : y + 0.5;
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const cover = Math.max(0, Math.min(1, rad - d + 0.5));
    out[(y * p.width + x) * 4 + 3] = Math.round(out[(y * p.width + x) * 4 + 3] * cover);
  }
  return { ...p, data: out };
}

/** The colour a picture is known by: the saturated, mid-bright pixels' hue bucket that weighs most (24 buckets), else the mean grey. */
export function dominant(p: Pixels): RGB | undefined {
  const n = p.width * p.height;
  if (!n) return undefined;
  const sum = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  const grey = { w: 0, r: 0, g: 0, b: 0 };
  // Every 4th pixel is plenty for a colour.
  for (let i = 0; i < n; i += 4) {
    const r = p.data[i * 4], g = p.data[i * 4 + 1], b = p.data[i * 4 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), s = max ? (max - min) / max : 0, v = max / 255;
    if (s < 0.15 || v < 0.1) { grey.w++; grey.r += r; grey.g += g; grey.b += b; continue; }
    const d = max - min;
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const w = s * (1 - Math.abs(v - 0.6));
    const k = Math.floor(h / 15) % 24;
    sum[k].w += w; sum[k].r += r * w; sum[k].g += g * w; sum[k].b += b * w;
  }
  const best = sum.reduce((a, b) => (b.w > a.w ? b : a));
  // Colour wins unless nine pixels in ten are grey (a black-and-white still with a red logo stays grey).
  const pick = best.w > 0 && grey.w < Math.ceil(n / 4) * 0.9 ? best : grey;
  return pick.w ? { r: pick.r / pick.w, g: pick.g / pick.w, b: pick.b / pick.w } : undefined;
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
export const hexOf = (c: RGB): `#${string}` => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

/**
 * The backdrop a cover's colour gives: the hue kept, the saturation
 * tempered and the lightness brought down to a deep tone white text reads
 * on in either theme, and a lighter accent of the same hue for the bars.
 */
export function backdrop(c: RGB): { deep: `#${string}`; glow: `#${string}`; accent: `#${string}` } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = d === 0 ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const hsl = (hh: number, ss: number, ll: number): RGB => {
    const k = (n: number) => (n + hh / 30) % 12, a = ss * Math.min(ll, 1 - ll);
    const f = (n: number) => ll - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
  };
  return { deep: hexOf(hsl(h, Math.min(0.55, s), 0.16)), glow: hexOf(hsl(h, Math.min(0.6, s), 0.26)), accent: hexOf(hsl(h, Math.min(0.85, Math.max(0.45, s)), 0.62)) };
}
