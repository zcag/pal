// The pure half of the Images extension: what an image file is (its
// format by extension), what each operation is called and where its
// output goes, which tool does it and with what argv, and the parsers for
// what the tools print. Nothing here touches the disk or spawns: `plan`
// answers the steps (each `{ tool, argv }`, argv[0] the tool's name, which
// exec.ts resolves to a binary) and the tests read them as data.
import { basename, dirname, extname, join } from "node:path";

// ---- formats ------------------------------------------------------------------

export type Fmt = "png" | "jpeg" | "webp" | "avif" | "heic" | "gif" | "tiff" | "bmp" | "svg" | "pdf" | "ico";
const EXTS: Record<Fmt, string[]> = { png: ["png"], jpeg: ["jpg", "jpeg"], webp: ["webp"], avif: ["avif"], heic: ["heic", "heif"], gif: ["gif"], tiff: ["tif", "tiff"], bmp: ["bmp"], svg: ["svg"], pdf: ["pdf"], ico: ["ico"] };
/** The extension written for a format. */
export const EXT_OF: Record<Fmt, string> = { png: "png", jpeg: "jpg", webp: "webp", avif: "avif", heic: "heic", gif: "gif", tiff: "tiff", bmp: "bmp", svg: "svg", pdf: "pdf", ico: "ico" };
/** What the palette takes as input: the raster formats and SVG (rasterised on the way out). */
export const INPUTS: Fmt[] = ["png", "jpeg", "webp", "avif", "heic", "gif", "tiff", "bmp", "svg"];
/** What Convert offers. */
export const TARGETS: Fmt[] = ["png", "jpeg", "webp", "avif", "heic", "pdf", "tiff", "gif"];
export const FMT_TITLE: Record<Fmt, string> = { png: "PNG", jpeg: "JPEG", webp: "WebP", avif: "AVIF", heic: "HEIC", gif: "GIF", tiff: "TIFF", bmp: "BMP", svg: "SVG", pdf: "PDF", ico: "ICO" };
/** Formats with a quality knob; the rest are lossless by nature. */
export const LOSSY: Fmt[] = ["jpeg", "webp", "avif", "heic"];

export const fmtOf = (path: string): Fmt | undefined => {
  const e = extname(path).slice(1).toLowerCase();
  return (Object.keys(EXTS) as Fmt[]).find((f) => EXTS[f].includes(e));
};
export const isImage = (path: string): boolean => INPUTS.includes(fmtOf(path) as Fmt);

// ---- tools --------------------------------------------------------------------

/**
 * Every program the plans may name. `builtin` is this file's own JPEG and
 * PNG metadata strip; `tinypng` is the API. The helpers (`djpeg`,
 * `avifdec`, `dwebp`, `heif-convert`, `identify`, `iconutil`) are only
 * ever decode or query steps and are not in the user's preference list.
 */
export type ToolName = "pngquant" | "oxipng" | "optipng" | "cjpeg" | "jpegtran" | "cwebp" | "avifenc" | "gifsicle" | "exiftool" | "magick" | "sips" | "builtin" | "tinypng" | "djpeg" | "avifdec" | "dwebp" | "heif-convert" | "identify" | "iconutil";
/** The default `tools` setting: the order the encoders are tried; a tool left out of the list is never used. */
export const TOOL_ORDER: ToolName[] = ["pngquant", "oxipng", "optipng", "cjpeg", "jpegtran", "cwebp", "avifenc", "gifsicle", "exiftool", "sips", "magick"];
/** What each tool is for, for the hint rows naming what to install. */
export const TOOL_HINT: Partial<Record<ToolName, string>> = {
  pngquant: "lossy PNG compression (brew install pngquant)",
  oxipng: "lossless PNG compression (brew install oxipng)",
  cjpeg: "JPEG compression (brew install mozjpeg or jpeg-turbo)",
  cwebp: "WebP (brew install webp)",
  avifenc: "AVIF (brew install libavif)",
  magick: "every format on Linux, and the fallback (brew install imagemagick)",
};
/** The tools the palette can run, in preference order (the `tools` setting filtered to what is installed). */
export type Avail = ToolName[];
const first = (avail: Avail, ...want: ToolName[]): ToolName | undefined => avail.find((t) => want.includes(t));

export type Step = { tool: ToolName; argv: string[] };
/** What an operation runs: the steps in order, the encoder that gets the credit, and where the result lands. `lossless` says the bytes changed but not the pixels. */
export type Plan = { tool: ToolName; steps: Step[]; output: string; lossless?: boolean };
/** No tool can do it: the tools that would. */
export type Missing = { missing: ToolName[]; why: string };
export const isMissing = <T extends object>(p: T | Missing): p is Missing => "missing" in p;

export type Dims = { width: number; height: number };
export type ResizeSpec = { width?: number; height?: number; percent?: number; max?: number };
export type Aspect = "1:1" | "16:9" | "4:3" | "3:2" | "9:16";
export const ASPECTS: Aspect[] = ["1:1", "16:9", "4:3", "3:2", "9:16"];
export type Job =
  | { kind: "compress"; lossless?: boolean }
  | { kind: "web"; to?: Fmt; max: number }
  | { kind: "convert"; to: Fmt }
  | { kind: "resize"; spec: ResizeSpec }
  | { kind: "rotate"; degrees: 90 | 180 | 270 }
  | { kind: "flip"; axis: "horizontal" | "vertical" }
  | { kind: "strip" }
  | { kind: "gray" }
  | { kind: "crop"; aspect: Aspect }
  | { kind: "pad"; color: string }
  | { kind: "icons" };

/** What `plan` needs beyond the job: the tools, the quality, a fresh temp path per intermediate, and the output path (`outputFor`). */
export type PlanOpts = { avail: Avail; quality: number; tmp: (ext: string) => string; output: string; dims: Dims; platform?: string };

// ---- naming --------------------------------------------------------------------

const stemOf = (path: string) => basename(path, extname(path));

/** The suffix a job appends to the stem (`photo-compressed.png`, `photo@0.5x.png`); a convert changes only the extension. */
export function suffixFor(job: Job): string {
  switch (job.kind) {
    case "compress": return "-compressed";
    case "web": return "-web";
    case "convert": return "";
    case "resize": {
      const s = job.spec;
      if (s.percent !== undefined) return `@${+(s.percent / 100).toFixed(2)}x`;
      if (s.width && s.height) return `-${s.width}x${s.height}`;
      if (s.width) return `-${s.width}w`;
      if (s.height) return `-${s.height}h`;
      return `-${s.max}max`;
    }
    case "rotate": return `-rotated${job.degrees}`;
    case "flip": return job.axis === "horizontal" ? "-flipped-h" : "-flipped-v";
    case "strip": return "-stripped";
    case "gray": return "-gray";
    case "crop": return job.aspect === "1:1" ? "-square" : `-${job.aspect.replace(":", "x")}`;
    case "pad": return "-padded";
    case "icons": return "-icons";
  }
}

/**
 * Where a job's result goes: next to the source, the stem plus the job's
 * suffix (`outputFor`), the extension the job's format. A retina `@2x`
 * resize strips an existing `@Nx` first and `@1x` (a half) drops a `@2x`
 * stem to the bare name, as designers name the pair. With `replace` the
 * output is the source's own path (the extension may still change on a
 * convert); otherwise a name already taken gets `-2`, `-3`, ... (`exists`
 * says which are). `dir` puts it elsewhere (a clipboard image's result has
 * no folder of its own).
 */
export function outputFor(input: string, job: Job, opts: { replace: boolean; exists: (p: string) => boolean; avail: Avail; dir?: string }): string {
  const dir = opts.dir ?? dirname(input);
  const to = outputFmt(job, fmtOf(input), opts.avail);
  const ext = to ? EXT_OF[to] : extname(input).slice(1);
  let stem = stemOf(input);
  if (job.kind === "resize" && job.spec.percent === 200) stem = stem.replace(/@\d+x$/, "") + "@2x";
  else if (job.kind === "resize" && job.spec.percent === 50 && /@2x$/.test(stem)) stem = stem.replace(/@2x$/, "");
  else stem += suffixFor(job);
  if (job.kind === "icons") return unique(join(dir, stem), opts.exists);
  if (opts.replace) return join(dir, `${stemOf(input)}.${ext}`);
  return unique(join(dir, `${stem}.${ext}`), opts.exists);
}

/** The format a job's output has: the job's own for a convert (or a web job that names one), else the source's, except that SVG is rasterised to PNG and sips writes neither WebP nor SVG (`geomFormat`). */
export function outputFmt(job: Job, from: Fmt | undefined, avail: Avail): Fmt | undefined {
  if (!from) return undefined;
  switch (job.kind) {
    case "convert": return job.to;
    case "web": return job.to ?? (from === "svg" ? "png" : from);
    case "compress": return from === "svg" ? "png" : from;
    case "strip": return from;
    case "icons": return undefined;
    default: return geomFormat(from, avail);
  }
}

/** Geometry (resize, rotate, crop, pad, grayscale) is sips's whenever it is listed, whatever its place in the order (native, colour-managed, 10 ms); ImageMagick otherwise. */
export const geomTool = (avail: Avail): ToolName | undefined => first(avail, "sips") ?? first(avail, "magick");
/** What a geometry step writes: the source's format, or PNG when the tool is sips and the source is WebP or SVG (sips reads both, writes neither). */
export const geomFormat = (from: Fmt, avail: Avail): Fmt => (geomTool(avail) === "sips" && !SIPS_WRITES.includes(from) ? "png" : from);

const unique = (path: string, exists: (p: string) => boolean): string => {
  if (!exists(path)) return path;
  const ext = extname(path), stem = path.slice(0, path.length - ext.length);
  for (let n = 2; ; n++) if (!exists(`${stem}-${n}${ext}`)) return `${stem}-${n}${ext}`;
};

// ---- planning ---------------------------------------------------------------------

/** The quality a lossy encoder gets: clamped to 1..100. */
const q = (n: number) => Math.min(100, Math.max(1, Math.round(n)));

/** What `sips` writes (`--formats` on macOS 26; `webp` is read-only there) and what ImageMagick does. */
const SIPS_WRITES: Fmt[] = ["png", "jpeg", "tiff", "gif", "bmp", "pdf", "heic", "avif", "ico"];
const sipsFormat = (f: Fmt) => f;

/**
 * A decode step when an encoder cannot read the source's format: the
 * source as a PNG (or a PPM for cjpeg) in a temp file. `sips` on macOS,
 * else ImageMagick, else the format's own decoder (`dwebp`, `avifdec`,
 * `heif-convert`, `djpeg`). Undefined when the source is already
 * readable or nothing can decode it.
 */
function decode(input: string, from: Fmt, readable: Fmt[], want: "png" | "ppm", o: PlanOpts): { steps: Step[]; path: string } | undefined | Missing {
  if (readable.includes(from) && !(want === "ppm")) return undefined;
  const out = o.tmp(want);
  if (want === "ppm") {
    if (from === "jpeg" && o.avail.includes("djpeg")) return { steps: [{ tool: "djpeg", argv: ["djpeg", "-outfile", out, input] }], path: out };
    if (o.avail.includes("magick")) return { steps: [{ tool: "magick", argv: ["magick", input, out] }], path: out };
    // sips has no PPM; a BMP is what cjpeg reads too.
    if (o.avail.includes("sips")) { const bmp = o.tmp("bmp"); return { steps: [{ tool: "sips", argv: ["sips", "-s", "format", "bmp", input, "--out", bmp] }], path: bmp }; }
    return { missing: ["magick"], why: `nothing decodes ${FMT_TITLE[from]} for cjpeg` };
  }
  if (o.avail.includes("sips")) return { steps: [{ tool: "sips", argv: ["sips", "-s", "format", "png", input, "--out", out] }], path: out };
  if (o.avail.includes("magick")) return { steps: [{ tool: "magick", argv: ["magick", input, out] }], path: out };
  if (from === "webp" && o.avail.includes("dwebp")) return { steps: [{ tool: "dwebp", argv: ["dwebp", input, "-o", out] }], path: out };
  if (from === "avif" && o.avail.includes("avifdec")) return { steps: [{ tool: "avifdec", argv: ["avifdec", input, out] }], path: out };
  if (from === "heic" && o.avail.includes("heif-convert")) return { steps: [{ tool: "heif-convert", argv: ["heif-convert", input, out] }], path: out };
  return { missing: ["magick"], why: `nothing decodes ${FMT_TITLE[from]}` };
}

/** The encoder for `to` from a PNG or JPEG (or the source itself when readable): its steps into `output`. */
function encode(input: string, from: Fmt, to: Fmt, output: string, o: PlanOpts, lossless: boolean): Plan | Missing {
  const quality = q(o.quality);
  const via = (readable: Fmt[], want: "png" | "ppm", tool: ToolName, argv: (src: string) => string[]): Plan | Missing => {
    const d = decode(input, from, readable, want, o);
    if (d && isMissing(d)) return d;
    return { tool, steps: [...(d?.steps ?? []), { tool, argv: argv(d?.path ?? input) }], output, lossless };
  };
  switch (to) {
    case "png": {
      // Not sips: it re-encodes a palette PNG as RGBA (a 57 KB screenshot came back 93 KB), so it never compresses one.
      const t = first(o.avail, ...(lossless ? (["oxipng", "optipng", "magick"] as ToolName[]) : (["pngquant", "oxipng", "optipng", "magick"] as ToolName[])));
      switch (t) {
        case "pngquant": return via(["png"], "png", t, (s) => ["pngquant", `--quality=${Math.max(0, quality - 25)}-${quality}`, "--speed", "1", "--strip", "--force", "--output", output, "--", s]);
        // Without pngquant a lossy ask still lands here: the bytes shrink, the pixels stay (the row says so).
        case "oxipng": return { ...via(["png"], "png", t, (s) => ["oxipng", "-o", "4", "--strip", "safe", "--out", output, s]), lossless: true };
        case "optipng": return { ...via(["png"], "png", t, (s) => ["optipng", "-o2", "-strip", "all", "-out", output, s]), lossless: true };
        case "magick": return { tool: t, steps: [{ tool: t, argv: ["magick", input, "-strip", "-define", "png:compression-level=9", output] }], output, lossless: true };
        default: return { missing: ["pngquant", "oxipng", "magick"], why: "nothing compresses PNG" };
      }
    }
    case "jpeg": {
      if (lossless && from === "jpeg" && o.avail.includes("jpegtran")) return { tool: "jpegtran", steps: [{ tool: "jpegtran", argv: ["jpegtran", "-copy", "none", "-optimize", "-progressive", "-outfile", output, input] }], output, lossless: true };
      const t = first(o.avail, "cjpeg", "magick", "sips");
      if (t === "cjpeg") return via([], "ppm", t, (s) => ["cjpeg", "-quality", String(quality), "-optimize", "-progressive", "-outfile", output, s]);
      if (t === "magick") return { tool: t, steps: [{ tool: t, argv: ["magick", input, "-strip", "-quality", String(quality), "-interlace", "Plane", output] }], output };
      if (t === "sips") return { tool: t, steps: [{ tool: t, argv: ["sips", "-s", "format", "jpeg", "-s", "formatOptions", String(quality), input, "--out", output] }], output };
      return { missing: ["cjpeg", "magick"], why: "nothing writes JPEG" };
    }
    case "webp": {
      const t = first(o.avail, "cwebp", "magick");
      if (t === "cwebp") return via(["png", "jpeg", "tiff", "webp"], "png", t, (s) => ["cwebp", ...(lossless ? ["-lossless", "-z", "9"] : ["-q", String(quality)]), "-metadata", "none", "-quiet", s, "-o", output]);
      if (t === "magick") return { tool: t, steps: [{ tool: t, argv: ["magick", input, "-strip", ...(lossless ? ["-define", "webp:lossless=true"] : ["-quality", String(quality)]), output] }], output, lossless };
      return { missing: ["cwebp", "magick"], why: "nothing writes WebP" };
    }
    case "avif": {
      const t = first(o.avail, "avifenc", "sips", "magick");
      if (t === "avifenc") return via(["png", "jpeg"], "png", t, (s) => ["avifenc", ...(lossless ? ["-l"] : ["-q", String(quality)]), "-s", "6", "--ignore-exif", "--ignore-xmp", s, output]);
      if (t === "sips") return { tool: t, steps: [{ tool: t, argv: ["sips", "-s", "format", "avif", "-s", "formatOptions", String(lossless ? 100 : quality), input, "--out", output] }], output, lossless };
      if (t === "magick") return { tool: t, steps: [{ tool: t, argv: ["magick", input, "-strip", "-quality", String(lossless ? 100 : quality), output] }], output, lossless };
      return { missing: ["avifenc", "magick"], why: "nothing writes AVIF" };
    }
    case "heic": {
      const t = first(o.avail, "sips", "magick");
      if (t === "sips") return { tool: t, steps: [{ tool: t, argv: ["sips", "-s", "format", "heic", "-s", "formatOptions", String(lossless ? 100 : quality), input, "--out", output] }], output, lossless };
      if (t === "magick") return { tool: t, steps: [{ tool: t, argv: ["magick", input, "-strip", "-quality", String(lossless ? 100 : quality), output] }], output, lossless };
      return { missing: ["sips", "magick"], why: "nothing writes HEIC" };
    }
    case "gif": {
      if (from === "gif" && o.avail.includes("gifsicle")) return { tool: "gifsicle", steps: [{ tool: "gifsicle", argv: ["gifsicle", "-O3", "--no-comments", "--no-names", "-o", output, input] }], output, lossless: true };
      const t = first(o.avail, "sips", "magick");
      if (t) return { tool: t, steps: [{ tool: t, argv: t === "sips" ? ["sips", "-s", "format", "gif", input, "--out", output] : ["magick", input, "-strip", output] }], output, lossless: true };
      return { missing: ["gifsicle", "magick"], why: "nothing writes GIF" };
    }
    default: {
      // tiff, bmp, pdf, ico: sips, else ImageMagick.
      const t = first(o.avail, "sips", "magick");
      if (t === "sips" && SIPS_WRITES.includes(to)) return { tool: t, steps: [{ tool: t, argv: ["sips", "-s", "format", sipsFormat(to), input, "--out", output] }], output, lossless: true };
      if (first(o.avail, "magick")) return { tool: "magick", steps: [{ tool: "magick", argv: ["magick", input, "-strip", output] }], output, lossless: true };
      return { missing: ["magick"], why: `nothing writes ${FMT_TITLE[to]}` };
    }
  }
}

/** A geometry step (resize, rotate, flip, crop, pad, grayscale): sips on macOS, ImageMagick elsewhere, writing the source's format. */
function geometry(input: string, from: Fmt, output: string, sipsArgs: string[], magickArgs: string[], o: PlanOpts): Plan | Missing {
  const t = geomTool(o.avail);
  // sips reads SVG and WebP but writes neither: those go out as PNG (`geomFormat`; the caller named the output so).
  if (t === "sips") return { tool: t, steps: [{ tool: t, argv: ["sips", ...sipsArgs, ...(SIPS_WRITES.includes(from) ? [] : ["-s", "format", "png"]), input, "--out", output] }], output, lossless: true };
  if (t === "magick") return { tool: t, steps: [{ tool: t, argv: ["magick", input, ...magickArgs, output] }], output, lossless: true };
  return { missing: ["sips", "magick"], why: "nothing resizes: sips (macOS) or ImageMagick" };
}

/** The pixel size a resize lands on. */
export function resized(d: Dims, s: ResizeSpec): Dims {
  const r = (n: number) => Math.max(1, Math.round(n));
  if (s.percent !== undefined) return { width: r(d.width * s.percent / 100), height: r(d.height * s.percent / 100) };
  if (s.width && s.height) { const k = Math.min(s.width / d.width, s.height / d.height); return { width: r(d.width * k), height: r(d.height * k) }; }
  if (s.width) return { width: s.width, height: r(d.height * s.width / d.width) };
  if (s.height) return { width: r(d.width * s.height / d.height), height: s.height };
  const k = Math.min(1, (s.max ?? Math.max(d.width, d.height)) / Math.max(d.width, d.height));
  return { width: r(d.width * k), height: r(d.height * k) };
}

/** The centred crop box for an aspect: the largest `w:h` that fits. */
export function cropped(d: Dims, aspect: Aspect): Dims {
  const [aw, ah] = aspect.split(":").map(Number);
  const w = Math.min(d.width, Math.floor(d.height * aw / ah));
  return { width: w, height: Math.min(d.height, Math.floor(w * ah / aw)) };
}

/**
 * The steps for a job on one file. The output's format is the job's
 * (`convert`, `web` with a format) else the source's, except that sips
 * writes neither WebP nor SVG, so a geometry job on those lands as PNG.
 */
export function plan(job: Job, input: string, o: PlanOpts): Plan | Missing {
  const from = fmtOf(input);
  if (!from) return { missing: [], why: `${basename(input)} is not an image` };
  const { output, dims } = o;
  const mac = (o.platform ?? process.platform) === "darwin";
  switch (job.kind) {
    case "compress": return encode(input, from, from === "svg" ? "png" : from, output, o, !!job.lossless);
    case "convert": return encode(input, from, job.to, output, o, !LOSSY.includes(job.to));
    case "web": {
      // Cap the long side, then encode lossy at the quality, then strip what the encoder kept (builtin for PNG and JPEG, lossless).
      const to = job.to ?? (from === "svg" ? "png" : from);
      const steps: Step[] = [];
      let src = input;
      if (Math.max(dims.width, dims.height) > job.max) {
        const g = geometry(input, from, o.tmp(EXT_OF[geomFormat(from, o.avail)]), ["-Z", String(job.max)], ["-resize", `${job.max}x${job.max}>`], o);
        if (isMissing(g)) return g;
        steps.push(...g.steps);
        src = g.output;
      }
      const e = encode(src, src === input ? from : fmtOf(src)!, to, output, o, false);
      if (isMissing(e)) return e;
      steps.push(...e.steps);
      if (to === "png" || to === "jpeg") steps.push({ tool: "builtin", argv: ["strip", output] });
      return { tool: e.tool, steps, output };
    }
    case "resize": {
      const d = resized(dims, job.spec);
      return geometry(input, from, output, ["-z", String(d.height), String(d.width)], ["-resize", `${d.width}x${d.height}!`], o);
    }
    case "rotate": return geometry(input, from, output, ["-r", String(job.degrees)], ["-rotate", String(job.degrees)], o);
    case "flip": return geometry(input, from, output, ["-f", job.axis], [job.axis === "horizontal" ? "-flop" : "-flip"], o);
    case "gray": return geometry(input, from, output, ["-m", GRAY_PROFILE], ["-colorspace", "Gray"], o);
    case "crop": {
      const d = cropped(dims, job.aspect);
      return geometry(input, from, output, ["-c", String(d.height), String(d.width)], ["-gravity", "center", "-crop", `${d.width}x${d.height}+0+0`, "+repage"], o);
    }
    case "pad": {
      const s = Math.max(dims.width, dims.height);
      return geometry(input, from, output, ["-p", String(s), String(s), "--padColor", job.color.replace("#", "")], ["-background", `#${job.color.replace("#", "")}`, "-gravity", "center", "-extent", `${s}x${s}`], o);
    }
    case "strip": {
      if (from === "png" || from === "jpeg") return { tool: "builtin", steps: [{ tool: "builtin", argv: ["strip", input, output] }], output, lossless: true };
      const t = first(o.avail, "exiftool", "magick");
      if (t === "exiftool") return { tool: t, steps: [{ tool: t, argv: ["exiftool", "-all=", "-o", output, input] }], output, lossless: true };
      if (t === "magick") return { tool: t, steps: [{ tool: t, argv: ["magick", input, "-strip", output] }], output, lossless: true };
      return { missing: ["exiftool", "magick"], why: `nothing strips ${FMT_TITLE[from]} losslessly` };
    }
    case "icons": {
      // A square master at 1024 (centre-cropped, then resized), the sizes from it, the .icns through iconutil where there is one.
      const t = geomTool(o.avail);
      if (!t) return { missing: ["sips", "magick"], why: "nothing resizes: sips (macOS) or ImageMagick" };
      const side = Math.min(dims.width, dims.height);
      const master = o.tmp("png");
      const steps: Step[] = t === "sips"
        ? [{ tool: t, argv: ["sips", "-c", String(side), String(side), "-z", "1024", "1024", "-s", "format", "png", input, "--out", master] }]
        : [{ tool: t, argv: ["magick", input, "-gravity", "center", "-crop", `${side}x${side}+0+0`, "+repage", "-resize", "1024x1024!", master] }];
      const size = (px: number, out: string): Step => t === "sips" ? { tool: t, argv: ["sips", "-z", String(px), String(px), master, "--out", out] } : { tool: t, argv: ["magick", master, "-resize", `${px}x${px}!`, out] };
      const iconset = join(output, `${stemOf(input)}.iconset`);
      for (const [px, name] of ICONSET) steps.push(size(px, join(iconset, name)));
      for (const [px, name] of FAVICONS) steps.push(size(px, join(output, name)));
      if (t === "sips") steps.push({ tool: t, argv: ["sips", "-z", "32", "32", "-s", "format", "ico", master, "--out", join(output, "favicon.ico")] });
      else steps.push({ tool: t, argv: ["magick", master, "-define", "icon:auto-resize=16,32,48", join(output, "favicon.ico")] });
      if (mac && o.avail.includes("iconutil")) steps.push({ tool: "iconutil", argv: ["iconutil", "-c", "icns", iconset, "-o", join(output, `${stemOf(input)}.icns`)] });
      return { tool: t, steps, output, lossless: true };
    }
  }
}

export const GRAY_PROFILE = "/System/Library/ColorSync/Profiles/Generic Gray Profile.icc";
/** The `.iconset` Apple's iconutil wants, and the web set next to it. */
export const ICONSET: [number, string][] = [[16, "icon_16x16.png"], [32, "icon_16x16@2x.png"], [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"], [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"], [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"], [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"]];
export const FAVICONS: [number, string][] = [[16, "favicon-16.png"], [32, "favicon-32.png"], [180, "apple-touch-icon.png"], [192, "android-chrome-192.png"], [512, "android-chrome-512.png"]];

// ---- the built-in strip -----------------------------------------------------------

/**
 * A JPEG without its metadata: every APPn segment but APP0 (JFIF) and
 * APP14 (Adobe's colour transform, which the decoder needs) and every
 * COM dropped; from the SOS marker on the stream is copied whole. The
 * pixels are untouched. Anything that is not a JPEG comes back as is.
 */
export function stripJpeg(b: Uint8Array): Uint8Array {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return b;
  const keep: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    if (marker === 0xda) { keep.push(b.subarray(i)); return concat(keep); }
    const len = (b[i + 2] << 8) | b[i + 3];
    const drop = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
    if (!drop) keep.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  keep.push(b.subarray(i));
  return concat(keep);
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
/** Chunks that are metadata, not image: text, times, EXIF, the ICC profile (as `jpegtran -copy none` drops it). */
const PNG_DROP = new Set(["tEXt", "iTXt", "zTXt", "tIME", "eXIf", "iCCP", "dSIG"]);

/** A PNG without its ancillary metadata chunks; the pixels and the colour chunks (`sRGB`, `gAMA`, `cHRM`, `tRNS`, `PLTE`) stay. Not a PNG: back as is. */
export function stripPng(b: Uint8Array): Uint8Array {
  if (b.length < 8 || !PNG_SIG.every((v, i) => b[i] === v)) return b;
  const keep: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 8 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = Math.min(b.length, i + 12 + len);
    if (!PNG_DROP.has(type)) keep.push(b.subarray(i, end));
    i = end;
  }
  return concat(keep);
}

export const strip = (b: Uint8Array): Uint8Array => (b[0] === 0xff ? stripJpeg(b) : stripPng(b));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---- info ------------------------------------------------------------------------

/** What Get info shows: the pixels, the file's format and colour, and the EXIF fields that say where a photo came from. */
export type Info = {
  width?: number; height?: number; format?: string; dpi?: number; space?: string; profile?: string; alpha?: boolean; bits?: number;
  make?: string; model?: string; lens?: string; taken?: string; exposure?: string; aperture?: string; iso?: string; focal?: string; software?: string; copyright?: string; artist?: string; description?: string; orientation?: string; gps?: string;
};

/** `sips -g all` output: `  key: value` lines; `<nil>` is absent. */
export function parseSips(text: string): Info {
  const p: Record<string, string> = {};
  for (const m of text.matchAll(/^\s+(\w+): (.*)$/gm)) if (m[2] !== "<nil>") p[m[1]] = m[2].trim();
  const num = (k: string) => (p[k] !== undefined && /^-?[\d.]+$/.test(p[k]) ? Number(p[k]) : undefined);
  return clean({
    width: num("pixelWidth"), height: num("pixelHeight"), format: p.format, dpi: num("dpiWidth"), space: p.space, profile: p.profile, alpha: p.hasAlpha === undefined ? undefined : p.hasAlpha === "yes", bits: num("bitsPerSample"),
    make: p.make, model: p.model, software: p.software, copyright: p.copyright, artist: p.artist, description: p.description, taken: p.creation,
  });
}

/** The fields `identify` (ImageMagick) is asked for, one per line in this order (`identifyFormat`). */
export const IDENTIFY_FIELDS = ["%w", "%h", "%m", "%x", "%[colorspace]", "%[profile:icc]", "%A", "%z", "%[EXIF:Make]", "%[EXIF:Model]", "%[EXIF:LensModel]", "%[EXIF:DateTimeOriginal]", "%[EXIF:ExposureTime]", "%[EXIF:FNumber]", "%[EXIF:ISOSpeedRatings]", "%[EXIF:FocalLength]", "%[EXIF:Software]", "%[EXIF:Copyright]", "%[EXIF:Artist]", "%[EXIF:Orientation]"];
/** The `-format` string for `identify`. */
export const identifyFormat = () => IDENTIFY_FIELDS.join("\\n") + "\\n";

export function parseIdentify(text: string): Info {
  const v = text.split("\n");
  const num = (i: number) => (v[i] && /^-?[\d.]+/.test(v[i]) ? parseFloat(v[i]) : undefined);
  const str = (i: number) => (v[i] ? v[i] : undefined);
  return clean({
    width: num(0), height: num(1), format: str(2)?.toLowerCase(), dpi: num(3), space: str(4), profile: str(5), alpha: v[6] === undefined ? undefined : v[6] !== "Undefined" && v[6] !== "False" && v[6] !== "", bits: num(7),
    make: str(8), model: str(9), lens: str(10), taken: str(11), exposure: fraction(str(12)), aperture: fraction(str(13), "f/"), iso: str(14), focal: fraction(str(15), "", " mm"), software: str(16), copyright: str(17), artist: str(18), orientation: str(19),
  });
}

/** `exiftool -j` output (one object): the photo fields as it prints them. */
export function parseExiftool(json: string): Info {
  let o: Record<string, unknown>;
  try { o = (JSON.parse(json) as Record<string, unknown>[])[0] ?? {}; } catch { return {}; }
  const s = (k: string) => (o[k] === undefined || o[k] === null || o[k] === "" ? undefined : String(o[k]));
  return clean({
    make: s("Make"), model: s("Model"), lens: s("LensModel") ?? s("LensID"), taken: s("DateTimeOriginal") ?? s("CreateDate"), exposure: s("ExposureTime"), aperture: s("FNumber") && `f/${s("FNumber")}`, iso: s("ISO"), focal: s("FocalLength"),
    software: s("Software"), copyright: s("Copyright"), artist: s("Artist"), orientation: s("Orientation"), gps: s("GPSPosition"), profile: s("ProfileDescription"),
  });
}

/** `1/250`, `28/10` or `2.8` as EXIF spells them, to a readable value. */
function fraction(s: string | undefined, prefix = "", suffix = ""): string | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d+)\/(\d+)$/);
  if (!m) return prefix + s + suffix;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (!b) return undefined;
  if (a < b && a === 1) return `${prefix}1/${b}${suffix}`;
  const v = a / b;
  return `${prefix}${v < 1 ? `1/${Math.round(1 / v)}` : +v.toFixed(1)}${suffix}`;
}

const clean = (o: Info): Info => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as Info;

// ---- text ----------------------------------------------------------------------------

export const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB` : `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 2 : 1)} MB`);
export const dims = (d: Dims | undefined) => (d ? `${d.width}×${d.height}` : "");
/** `−72%` for a saving, `+3%` for a growth, `0%` for none. */
export const percent = (before: number, after: number) => { const p = Math.round((after / before - 1) * 100); return `${p < 0 ? "−" : p > 0 ? "+" : ""}${Math.abs(p)}%`; };

/** The query typed into the Resize level: `800` (width), `x600` (height), `800x600` (fit inside), `50%`, `2x`. */
export function parseResize(q: string): ResizeSpec | undefined {
  const s = q.trim().toLowerCase().replace(/\s+/g, "");
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+(?:\.\d+)?)%$/))) return { percent: Number(m[1]) };
  if ((m = s.match(/^@?(\d+(?:\.\d+)?)x$/))) return { percent: Number(m[1]) * 100 };
  if ((m = s.match(/^(\d+)[x×](\d+)$/))) return { width: Number(m[1]), height: Number(m[2]) };
  if ((m = s.match(/^[x×](\d+)$/))) return { height: Number(m[1]) };
  if ((m = s.match(/^(\d+)(?:w|px)?$/))) return { width: Number(m[1]) };
  if ((m = s.match(/^(\d+)h$/))) return { height: Number(m[1]) };
  return undefined;
}
