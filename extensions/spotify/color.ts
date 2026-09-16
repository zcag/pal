// The cover's dominant colour, and the tag colour nearest to it. The
// sampler is small on purpose: every pixel of the 300 px cover (the JPEG
// decoded by jpeg-js, the same bytes the view shows) is binned by hue into 24 buckets,
// weighted by saturation and by not being too dark or too light, and the
// fullest bucket's mean is the colour. Greys win only when nothing has
// colour. The view paints with it through a `gradient` node (a hex, alpha
// allowed) and maps it to the nearest of the eight tag colours for what
// only takes those (the progress bar, badges), so the tint follows the
// theme where the tokens do.
import { decode } from "jpeg-js";
import type { TagColor } from "@zcag/pal";

export type RGB = { r: number; g: number; b: number };
export type Tint = { hex: string; tag: TagColor; /** 0..1, how colourful the cover is at all. */ chroma: number };

const BUCKETS = 24;
/** Below this saturation the whole cover counts as grey. */
const GREY = 0.12;

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
export const toHex = (c: RGB) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;

/** Hue 0..360, saturation 0..1 (HSV), value 0..1. */
export function hsv(c: RGB): { h: number; s: number; v: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v: max };
}

/**
 * The dominant colour of RGB(A) pixels. `stride` is 3 or 4 bytes per
 * pixel. Nothing for an empty picture.
 */
export function dominant(data: Uint8Array | Uint8ClampedArray, stride: 3 | 4 = 4): RGB | undefined {
  const n = Math.floor(data.length / stride);
  if (!n) return undefined;
  const sum = Array.from({ length: BUCKETS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  const grey = { w: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i < n; i++) {
    const r = data[i * stride], g = data[i * stride + 1], b = data[i * stride + 2];
    const { h, s, v } = hsv({ r, g, b });
    // Weight: colourful and mid-bright pixels count most; near-black and near-white barely.
    const w = s * (1 - Math.abs(v - 0.6)) + 0.001;
    if (s < GREY || v < 0.08) { grey.w += 1; grey.r += r; grey.g += g; grey.b += b; continue; }
    const k = Math.floor((h / 360) * BUCKETS) % BUCKETS;
    sum[k].w += w; sum[k].r += r * w; sum[k].g += g * w; sum[k].b += b * w;
  }
  const best = sum.reduce((a, b) => (b.w > a.w ? b : a));
  const pick = best.w > 0 && (grey.w === 0 || best.w > 0.002 * n) ? best : grey;
  if (pick.w === 0) return undefined;
  return { r: pick.r / pick.w, g: pick.g / pick.w, b: pick.b / pick.w };
}

/** The tag palette as hue bands (each band ends where the next begins; the tokens' amber is an orange, so it takes the oranges); grey below the saturation floor. */
const TAG_BANDS: [number, TagColor][] = [[0, "red"], [12, "amber"], [70, "green"], [165, "teal"], [195, "blue"], [250, "violet"], [290, "pink"], [345, "red"]];
export function nearestTag(c: RGB): TagColor {
  const { h, s } = hsv(c);
  if (s < GREY) return "grey";
  let tag: TagColor = "red";
  for (const [from, t] of TAG_BANDS) if (h >= from) tag = t;
  return tag;
}

/** A JPEG's dominant colour as a tint; undefined when the bytes are not a JPEG jpeg-js can read. */
export function tintOf(jpeg: Uint8Array | ArrayBuffer): Tint | undefined {
  let img: { data: Uint8Array; width: number; height: number };
  try { img = decode(jpeg, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 2, maxMemoryUsageInMB: 64 }); } catch { return undefined; }
  const c = dominant(img.data, 4);
  return c ? tintFrom(c) : undefined;
}

export const tintFrom = (c: RGB): Tint => ({ hex: toHex(c), tag: nearestTag(c), chroma: hsv(c).s });

/** `#rrggbb` with an alpha byte, for the gradient stops. */
export const withAlpha = (hex: string, alpha: number): `#${string}` => `#${hex.slice(1, 7)}${hex2(alpha * 255)}`;
