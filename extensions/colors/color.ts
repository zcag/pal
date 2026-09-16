// Colour maths with no dependency on the host: parsing what one types
// (hex, rgb(), hsl(), hwb(), oklch(), a CSS name), the conversions the
// palette lists, WCAG contrast, the nearest CSS name (in OKLab, so the
// answer is what the eye would pick), and the SVG swatch the tiles show.
// Unit-tested directly (host/test/extensions/colors.test.ts).

/** sRGB, 0..255 per channel, alpha 0..1 (1 when the input had none). */
export type RGB = { r: number; g: number; b: number; a: number };
export type HSL = { h: number; s: number; l: number };

/** The 148 CSS named colours (CSS Color 4), lower case, with both spellings of gray. */
export const CSS_NAMES: Record<string, string> = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4", azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000", blanchedalmond: "#ffebcd", blue: "#0000ff",
  blueviolet: "#8a2be2", brown: "#a52a2a", burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e", coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b", darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9", darkkhaki: "#bdb76b", darkmagenta: "#8b008b", darkolivegreen: "#556b2f",
  darkorange: "#ff8c00", darkorchid: "#9932cc", darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f", darkslateblue: "#483d8b", darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f", darkturquoise: "#00ced1", darkviolet: "#9400d3",
  deeppink: "#ff1493", deepskyblue: "#00bfff", dimgray: "#696969", dimgrey: "#696969", dodgerblue: "#1e90ff", firebrick: "#b22222", floralwhite: "#fffaf0", forestgreen: "#228b22", fuchsia: "#ff00ff", gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff", gold: "#ffd700", goldenrod: "#daa520", gray: "#808080", green: "#008000", greenyellow: "#adff2f", grey: "#808080", honeydew: "#f0fff0", hotpink: "#ff69b4", indianred: "#cd5c5c",
  indigo: "#4b0082", ivory: "#fffff0", khaki: "#f0e68c", lavender: "#e6e6fa", lavenderblush: "#fff0f5", lawngreen: "#7cfc00", lemonchiffon: "#fffacd", lightblue: "#add8e6", lightcoral: "#f08080", lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3", lightgreen: "#90ee90", lightgrey: "#d3d3d3", lightpink: "#ffb6c1", lightsalmon: "#ffa07a", lightseagreen: "#20b2aa", lightskyblue: "#87cefa", lightslategray: "#778899", lightslategrey: "#778899",
  lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", lime: "#00ff00", limegreen: "#32cd32", linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa", mediumblue: "#0000cd", mediumorchid: "#ba55d3",
  mediumpurple: "#9370db", mediumseagreen: "#3cb371", mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a", mediumturquoise: "#48d1cc", mediumvioletred: "#c71585", midnightblue: "#191970", mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5",
  navajowhite: "#ffdead", navy: "#000080", oldlace: "#fdf5e6", olive: "#808000", olivedrab: "#6b8e23", orange: "#ffa500", orangered: "#ff4500", orchid: "#da70d6", palegoldenrod: "#eee8aa", palegreen: "#98fb98",
  paleturquoise: "#afeeee", palevioletred: "#db7093", papayawhip: "#ffefd5", peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb", plum: "#dda0dd", powderblue: "#b0e0e6", purple: "#800080", rebeccapurple: "#663399",
  red: "#ff0000", rosybrown: "#bc8f8f", royalblue: "#4169e1", saddlebrown: "#8b4513", salmon: "#fa8072", sandybrown: "#f4a460", seagreen: "#2e8b57", seashell: "#fff5ee", sienna: "#a0522d", silver: "#c0c0c0",
  skyblue: "#87ceeb", slateblue: "#6a5acd", slategray: "#708090", slategrey: "#708090", snow: "#fffafa", springgreen: "#00ff7f", steelblue: "#4682b4", tan: "#d2b48c", teal: "#008080", thistle: "#d8bfd8",
  tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee", wheat: "#f5deb3", white: "#ffffff", whitesmoke: "#f5f5f5", yellow: "#ffff00", yellowgreen: "#9acd32",
};

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const round = (x: number, d = 0) => { const f = 10 ** d; return Math.round(x * f) / f; };
const mod = (x: number, n: number) => ((x % n) + n) % n;

// ---- parsing ---------------------------------------------------------------

const NUM = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?";
/** Three or four values in a functional notation, comma or space separated, `/ alpha` allowed. */
const args = (s: string): string[] | undefined => {
  const parts = s.trim().split(/\s*[,/]\s*|\s+/).filter(Boolean);
  return parts.length === 3 || parts.length === 4 ? parts : undefined;
};
const number = (s: string): number | undefined => (new RegExp(`^${NUM}$`, "i").test(s) ? Number(s) : undefined);
/** A channel: a number on `scale`, or a percentage of it. */
const channel = (s: string, scale: number): number | undefined => (s.endsWith("%") ? (number(s.slice(0, -1)) ?? NaN) / 100 * scale : number(s));
const alpha = (s: string | undefined): number => (s === undefined ? 1 : s.endsWith("%") ? clamp((number(s.slice(0, -1)) ?? 100) / 100) : clamp(number(s) ?? 1));
/** Degrees from `30`, `30deg`, `0.5turn`, `100grad`, `1.2rad`. */
const hue = (s: string): number | undefined => {
  const m = /^([-+]?[\d.]+(?:e[-+]?\d+)?)(deg|turn|grad|rad)?$/i.exec(s);
  if (!m) return;
  const v = Number(m[1]);
  const f = { deg: 1, turn: 360, grad: 0.9, rad: 180 / Math.PI }[(m[2] ?? "deg").toLowerCase() as "deg"];
  return mod(v * f, 360);
};

const fromHex = (h: string): RGB | undefined => {
  const s = h.replace(/^#/, "");
  if (!/^[0-9a-f]+$/i.test(s) || ![3, 4, 6, 8].includes(s.length)) return;
  const full = s.length <= 4 ? [...s].map((c) => c + c).join("") : s;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 };
};

/**
 * What one types: `#ff8800`, `ff8800`, `f80`, `rgb(255, 136, 0)`,
 * `rgb(255 136 0 / 50%)`, `255 136 0`, `hsl(30 100% 50%)`, `hwb(30 0% 0%)`,
 * `oklch(0.75 0.18 60)`, a CSS name. Undefined when it is none of those.
 */
export function parse(input: string): RGB | undefined {
  const s = input.trim().toLowerCase();
  if (!s) return;
  if (CSS_NAMES[s]) return fromHex(CSS_NAMES[s]);
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const fn = /^(rgba?|hsla?|hwb|oklch)\(\s*(.*?)\s*\)$/.exec(s);
  if (!fn) {
    if (/^#?[0-9a-f]{3,8}$/.test(s)) return fromHex(s);
    const bare = args(s);
    return bare && bare.length === 3 ? rgbOf(bare) : undefined;
  }
  const a = args(fn[2]);
  if (!a) return;
  switch (fn[1]) {
    case "rgb": case "rgba": return rgbOf(a);
    case "hsl": case "hsla": {
      const [h, sat, l] = [hue(a[0]), channel(a[1], 1), channel(a[2], 1)];
      if (h === undefined || sat === undefined || l === undefined || Number.isNaN(sat) || Number.isNaN(l)) return;
      return { ...fromHsl({ h, s: clamp(sat), l: clamp(l) }), a: alpha(a[3]) };
    }
    case "hwb": {
      const [h, w, b] = [hue(a[0]), channel(a[1], 1), channel(a[2], 1)];
      if (h === undefined || w === undefined || b === undefined || Number.isNaN(w) || Number.isNaN(b)) return;
      return { ...fromHwb(h, clamp(w), clamp(b)), a: alpha(a[3]) };
    }
    case "oklch": {
      const [l, c, h] = [channel(a[0], 1), channel(a[1], 0.4), hue(a[2])];
      if (l === undefined || c === undefined || h === undefined || Number.isNaN(l) || Number.isNaN(c)) return;
      return { ...fromOklch(clamp(l), Math.max(0, c), h), a: alpha(a[3]) };
    }
  }
}

function rgbOf(a: string[]): RGB | undefined {
  const [r, g, b] = [channel(a[0], 255), channel(a[1], 255), channel(a[2], 255)];
  if ([r, g, b].some((v) => v === undefined || Number.isNaN(v))) return;
  return { r: Math.round(clamp(r!, 0, 255)), g: Math.round(clamp(g!, 0, 255)), b: Math.round(clamp(b!, 0, 255)), a: alpha(a[3]) };
}

// ---- conversions -----------------------------------------------------------

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");
/** `#ff8800`, with a fourth pair when alpha is under 1. */
export const toHex = (c: RGB) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ""}`;
const a = (c: RGB, sep = ", ") => (c.a < 1 ? `${sep}${round(c.a, 2)}` : "");
/** `rgb(255, 136, 0)`; `rgba(...)` with an alpha. */
export const toRgb = (c: RGB) => `${c.a < 1 ? "rgba" : "rgb"}(${c.r}, ${c.g}, ${c.b}${a(c)})`;

export function toHsl(c: RGB): HSL {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? mod((g - b) / d, 6) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}
export function fromHsl({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(mod(h / 60, 2) - 1)), m = l - c / 2;
  const i = Math.floor(mod(h, 360) / 60);
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255), a: 1 };
}
/** `hsl(30, 100%, 50%)`. */
export const toHslString = (c: RGB) => { const { h, s, l } = toHsl(c); return `${c.a < 1 ? "hsla" : "hsl"}(${round(h)}, ${round(s * 100)}%, ${round(l * 100)}%${a(c)})`; };

export function fromHwb(h: number, w: number, b: number): RGB {
  if (w + b >= 1) { const g = Math.round((w / (w + b)) * 255); return { r: g, g, b: g, a: 1 }; }
  const base = fromHsl({ h, s: 1, l: 0.5 });
  const f = (v: number) => Math.round((v / 255 * (1 - w - b) + w) * 255);
  return { r: f(base.r), g: f(base.g), b: f(base.b), a: 1 };
}
/** `hwb(30 0% 0%)`. */
export const toHwb = (c: RGB) => {
  const { h } = toHsl(c);
  const w = Math.min(c.r, c.g, c.b) / 255, b = 1 - Math.max(c.r, c.g, c.b) / 255;
  return `hwb(${round(h)} ${round(w * 100)}% ${round(b * 100)}%${a(c, " / ")})`;
};

// sRGB transfer and Björn Ottosson's OKLab matrices.
const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (v: number) => { const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(clamp(c) * 255); };
export function toOklab(c: RGB): [number, number, number] {
  const r = lin(c.r), g = lin(c.g), b = lin(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function fromOklch(L: number, C: number, H: number): RGB {
  const A = C * Math.cos((H * Math.PI) / 180), B = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return { r: gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s), a: 1 };
}
/** `oklch(0.75 0.18 60)`: L 0..1, chroma, hue in degrees. */
export const toOklch = (c: RGB) => {
  const [L, A, B] = toOklab(c);
  const C = Math.hypot(A, B);
  const H = C < 0.0005 ? 0 : mod((Math.atan2(B, A) * 180) / Math.PI, 360);
  return `oklch(${round(L, 3)} ${round(C, 3)} ${round(H, 1)}${a(c, " / ")})`;
};

// ---- names, contrast, relatives --------------------------------------------

/** The CSS name for exactly this colour (the first spelling in the table: `gray` over `grey`), or undefined. */
export const nameOf = (c: RGB): string | undefined => { const h = toHex({ ...c, a: 1 }); return Object.keys(CSS_NAMES).find((n) => CSS_NAMES[n] === h); };
/** The CSS name closest in OKLab, and how far (0 is exact; under ~0.02 is hard to tell apart). */
export function nearestName(c: RGB): { name: string; distance: number } {
  const lab = toOklab(c);
  let best = { name: "black", distance: Infinity };
  for (const [name, hex] of Object.entries(CSS_NAMES)) {
    const [l, a, b] = toOklab(fromHex(hex)!);
    const d = Math.hypot(l - lab[0], a - lab[1], b - lab[2]);
    if (d < best.distance) best = { name, distance: d };
  }
  return best;
}

/** WCAG 2 relative luminance, 0..1. */
export const luminance = (c: RGB) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
/** WCAG 2 contrast ratio, 1..21. */
export const contrast = (x: RGB, y: RGB) => { const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
/** What a ratio passes for normal text: `AAA` (7), `AA` (4.5), `AA large` (3, large text only), else `fail`. */
export const wcag = (ratio: number): "AAA" | "AA" | "AA large" | "fail" => (ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large" : "fail");

export const WHITE: RGB = { r: 255, g: 255, b: 255, a: 1 };
export const BLACK: RGB = { r: 0, g: 0, b: 0, a: 1 };

/** The hue across the wheel, same saturation and lightness. */
export const complementary = (c: RGB): RGB => { const h = toHsl(c); return fromHsl({ ...h, h: mod(h.h + 180, 360) }); };
/** Lightness moved by `amount` (0..1 of the scale) in HSL; negative darkens. */
export const lighten = (c: RGB, amount: number): RGB => { const h = toHsl(c); return fromHsl({ ...h, l: clamp(h.l + amount) }); };

/** A rounded square of the colour as an SVG data url: what the grid tiles and the row icons show. */
export const swatch = (hex: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="${hex}"/></svg>`)}`;
