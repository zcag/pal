// Hue's colour maths, pure: CIE xy (what the bridge speaks) to and from
// sRGB with the gamut triangle clamp Signify documents, colour temperature
// in mirek to and from kelvin and to a display colour along the Planckian
// locus, HSV for the hue/saturation plane. No pal imports, so the tests
// drive it without a host.

export type RGB = { r: number; g: number; b: number };
export type XY = { x: number; y: number };
/** A light's `color.gamut`: the triangle it can show; `color.gamut_type` names the three Signify ships. */
export type Gamut = { red: XY; green: XY; blue: XY };

/** The three Signify gamuts by `gamut_type`; `other` and a missing one get C, the widest. */
export const GAMUTS: Record<string, Gamut> = {
  A: { red: { x: 0.704, y: 0.296 }, green: { x: 0.2151, y: 0.7106 }, blue: { x: 0.138, y: 0.08 } },
  B: { red: { x: 0.675, y: 0.322 }, green: { x: 0.409, y: 0.518 }, blue: { x: 0.167, y: 0.04 } },
  C: { red: { x: 0.6915, y: 0.3083 }, green: { x: 0.17, y: 0.7 }, blue: { x: 0.1532, y: 0.0475 } },
};

export const MIREK_MIN = 153, MIREK_MAX = 500;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const kelvin = (mirek: number) => Math.round(1_000_000 / mirek);
export const mirekOf = (k: number) => Math.round(1_000_000 / k);

const cross = (a: XY, b: XY) => a.x * b.y - a.y * b.x;
const sub = (a: XY, b: XY): XY => ({ x: a.x - b.x, y: a.y - b.y });

/** Whether `p` lies inside the gamut triangle. */
export function inGamut(p: XY, g: Gamut): boolean {
  const v1 = sub(g.green, g.red), v2 = sub(g.blue, g.red), q = sub(p, g.red);
  const s = cross(q, v2) / cross(v1, v2), t = cross(v1, q) / cross(v1, v2);
  return s >= 0 && t >= 0 && s + t <= 1;
}

/** The point on segment ab closest to p. */
function closestOnSegment(a: XY, b: XY, p: XY): XY {
  const ab = sub(b, a), ap = sub(p, a);
  const len = ab.x * ab.x + ab.y * ab.y;
  const t = len === 0 ? 0 : clamp((ap.x * ab.x + ap.y * ab.y) / len, 0, 1);
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

/** `p` itself inside the gamut, else the nearest point on its edge: what the bridge would show for it. */
export function clampToGamut(p: XY, g: Gamut): XY {
  if (inGamut(p, g)) return p;
  const d2 = (a: XY, b: XY) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  return [closestOnSegment(g.red, g.green, p), closestOnSegment(g.green, g.blue, p), closestOnSegment(g.blue, g.red, p)].reduce((best, c) => (d2(c, p) < d2(best, p) ? c : best));
}

const gammaOut = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const gammaIn = (v: number) => (v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92);

/**
 * xy with a brightness (0..1) to sRGB 0..1, the Wide RGB D65 matrix
 * Signify documents, the result normalised so the brightest channel is
 * the brightness (a hue at 100% is a full colour, not a dim one).
 */
export function xyToRgb(xy: XY, brightness = 1, gamut?: Gamut): RGB {
  const p = gamut ? clampToGamut(xy, gamut) : xy;
  const y = p.y <= 0 ? 1e-6 : p.y;
  const Y = 1, X = (Y / y) * p.x, Z = (Y / y) * (1 - p.x - y);
  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);
  const max = Math.max(r, g, b) || 1;
  const scale = brightness / max;
  return { r: clamp(gammaOut(r * scale), 0, 1), g: clamp(gammaOut(g * scale), 0, 1), b: clamp(gammaOut(b * scale), 0, 1) };
}

/** sRGB 0..1 to xy, clamped into the gamut when one is given; black falls back to the D65 white point. */
export function rgbToXy(c: RGB, gamut?: Gamut): XY {
  const r = gammaIn(c.r), g = gammaIn(c.g), b = gammaIn(c.b);
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.07231 + b * 0.986039;
  const sum = X + Y + Z;
  const xy = sum === 0 ? { x: 0.3127, y: 0.329 } : { x: X / sum, y: Y / sum };
  return gamut ? clampToGamut(xy, gamut) : xy;
}

/** The xy of a black body at `kelvin` (Kim et al.'s cubic spline of the Planckian locus, 1667..25000 K). */
export function kelvinToXy(k: number): XY {
  const T = clamp(k, 1667, 25000);
  const x = T <= 4000
    ? -0.2661239e9 / T ** 3 - 0.2343589e6 / T ** 2 + 0.8776956e3 / T + 0.17991
    : -3.0258469e9 / T ** 3 + 2.1070379e6 / T ** 2 + 0.2226347e3 / T + 0.24039;
  const y = T <= 2222
    ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : T <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return { x, y };
}

/** A colour temperature as a display colour: what a white light at that mirek looks like. */
export const mirekToRgb = (mirek: number, brightness = 1): RGB => xyToRgb(kelvinToXy(kelvin(clamp(mirek, MIREK_MIN, MIREK_MAX))), brightness);

const hex2 = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
export const toHex = (c: RGB): `#${string}` => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
export function fromHex(h: string): RGB | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

export type HSV = { h: number; s: number; v: number };

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m };
}

/** The hue and saturation a light shows, from its xy: what the plane's marker sits at. */
export const xyToHs = (xy: XY, gamut?: Gamut) => { const { h, s } = rgbToHsv(xyToRgb(xy, 1, gamut)); return { h, s }; };
/** A hue and saturation as xy, at full value, inside the gamut. */
export const hsToXy = (h: number, s: number, gamut?: Gamut) => rgbToXy(hsvToRgb({ h: ((h % 360) + 360) % 360, s: clamp(s, 0, 1), v: 1 }), gamut);

/** The mean of several colours in linear light: a room's colour from its lights'. */
export function mix(colors: RGB[]): RGB | undefined {
  if (!colors.length) return undefined;
  const lin = colors.map((c) => ({ r: gammaIn(c.r), g: gammaIn(c.g), b: gammaIn(c.b) }));
  const n = lin.length;
  const m = lin.reduce((a, c) => ({ r: a.r + c.r / n, g: a.g + c.g / n, b: a.b + c.b / n }), { r: 0, g: 0, b: 0 });
  return { r: gammaOut(m.r), g: gammaOut(m.g), b: gammaOut(m.b) };
}

/** `c` dimmed toward black by a brightness share (0..1): how a tile shows a light at 30%. */
export const dim = (c: RGB, share: number): RGB => { const k = 0.25 + 0.75 * clamp(share, 0, 1); return { r: c.r * k, g: c.g * k, b: c.b * k }; };

/** Warm white: what a light with no colour and no temperature is drawn as. */
export const WARM: RGB = mirekToRgb(370);

/** The stops of a warm-to-cool strip across the mirek range, warmest first. */
export function temperatureStops(min = MIREK_MIN, max = MIREK_MAX, n = 7): `#${string}`[] {
  return Array.from({ length: n }, (_, i) => toHex(mirekToRgb(max - ((max - min) * i) / (n - 1))));
}

/** Light level in the bridge's log scale (10000 * log10(lux) + 1) to lux. */
export const lux = (lightLevel: number) => Math.round(Math.pow(10, (lightLevel - 1) / 10000));
