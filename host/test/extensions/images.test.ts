// images: the pure half first (ops.ts: formats, naming, every operation's
// argv per tool and platform, the built-in strip, the info parsers), then
// the palette over the wire on pictures drawn here (images-png.ts): the
// sources, the rows, compress and the other operations writing next to
// the source, replace and restore, the levels, the web view, the batch,
// TinyPNG against a mock, and the hints for missing tools. The wire tests
// run against stand-in tools (a temp bin on `PAL_IMAGES_PATH`: each
// script copies its input to its output, a compressor a smaller copy, the
// stand-in sips answers `-g` from the PNG header), so the argv, the
// naming, the HUD text and the Results section read the same on every
// box; the real tools get a few extras at the end, skipped where absent.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { ASPECTS, cropped, fmtOf, geomFormat, ICONSET, isImage, outputFor, outputFmt, parseExiftool, parseIdentify, parseResize, parseSips, percent, plan, resized, strip, stripJpeg, stripPng, suffixFor, TOOL_ORDER, type Avail, type Plan } from "../../../extensions/images/ops.ts";
import type { Item, View, ViewNode } from "../../../sdk/src/index.ts";
import { tile } from "../../../sdk/src/icon.ts";
import { bytes } from "../../../sdk/src/text.ts";
import { Host, writeTool } from "../harness.ts";
import { chunk, flat, gradient, png, text } from "./images-png.ts";

const MAC = process.platform === "darwin";
const REAL_SIPS = MAC && Bun.which("sips") !== null;
const MAGICK = Bun.which("magick") ?? Bun.which("convert");
const ALL: Avail = [...TOOL_ORDER, "djpeg", "avifdec", "dwebp", "heif-convert", "identify", "iconutil"];
const DIMS = { width: 1200, height: 900 };
const opts = (avail: Avail, output = "/out/x.png", platform = "darwin") => ({ avail, quality: 80, tmp: (ext: string) => `/tmp/t.${ext}`, output, dims: DIMS, platform });
const argvs = (p: Plan | { missing: string[] }) => ("missing" in p ? p.missing : p.steps.map((s) => s.argv.join(" ")));

describe("formats and naming", () => {
  test("the format by extension, case-insensitive; what counts as an input", () => {
    expect(fmtOf("a.JPG")).toBe("jpeg");
    expect(fmtOf("a.jpeg")).toBe("jpeg");
    expect(fmtOf("a.heif")).toBe("heic");
    expect(fmtOf("a.tif")).toBe("tiff");
    expect(fmtOf("a.txt")).toBeUndefined();
    expect(isImage("x.svg")).toBe(true);
    expect(isImage("x.pdf")).toBe(false);
    expect(isImage("x.ico")).toBe(false);
  });

  test("the suffix per job; a percent as @Nx, a width as -Nw, a fit as -WxH", () => {
    expect(suffixFor({ kind: "compress" })).toBe("-compressed");
    expect(suffixFor({ kind: "web", max: 2000 })).toBe("-web");
    expect(suffixFor({ kind: "resize", spec: { percent: 50 } })).toBe("@0.5x");
    expect(suffixFor({ kind: "resize", spec: { percent: 25 } })).toBe("@0.25x");
    expect(suffixFor({ kind: "resize", spec: { width: 800 } })).toBe("-800w");
    expect(suffixFor({ kind: "resize", spec: { height: 600 } })).toBe("-600h");
    expect(suffixFor({ kind: "resize", spec: { width: 800, height: 600 } })).toBe("-800x600");
    expect(suffixFor({ kind: "resize", spec: { max: 2000 } })).toBe("-2000max");
    expect(suffixFor({ kind: "rotate", degrees: 270 })).toBe("-rotated270");
    expect(suffixFor({ kind: "flip", axis: "horizontal" })).toBe("-flipped-h");
    expect(suffixFor({ kind: "crop", aspect: "1:1" })).toBe("-square");
    expect(suffixFor({ kind: "crop", aspect: "16:9" })).toBe("-16x9");
    expect(suffixFor({ kind: "pad", color: "#fff" })).toBe("-padded");
    expect(suffixFor({ kind: "strip" })).toBe("-stripped");
    expect(suffixFor({ kind: "gray" })).toBe("-gray");
    expect(suffixFor({ kind: "icons" })).toBe("-icons");
  });

  test("outputFor: next to the source with the suffix; a convert swaps the extension; a taken name gets -2; replace is the source's path; the retina pair; a folder for icons; a dir override", () => {
    const none = () => false;
    expect(outputFor("/d/photo.png", { kind: "compress" }, { replace: false, exists: none, avail: ALL })).toBe("/d/photo-compressed.png");
    expect(outputFor("/d/photo.JPG", { kind: "convert", to: "webp" }, { replace: false, exists: none, avail: ALL })).toBe("/d/photo.webp");
    expect(outputFor("/d/photo.png", { kind: "convert", to: "jpeg" }, { replace: false, exists: none, avail: ALL })).toBe("/d/photo.jpg");
    expect(outputFor("/d/photo.png", { kind: "compress" }, { replace: false, exists: (p) => p === "/d/photo-compressed.png" || p === "/d/photo-compressed-2.png", avail: ALL })).toBe("/d/photo-compressed-3.png");
    expect(outputFor("/d/photo.png", { kind: "compress" }, { replace: true, exists: () => true, avail: ALL })).toBe("/d/photo.png");
    expect(outputFor("/d/photo.png", { kind: "convert", to: "webp" }, { replace: true, exists: () => true, avail: ALL })).toBe("/d/photo.webp");
    expect(outputFor("/d/icon.png", { kind: "resize", spec: { percent: 200 } }, { replace: false, exists: none, avail: ALL })).toBe("/d/icon@2x.png");
    expect(outputFor("/d/icon@3x.png", { kind: "resize", spec: { percent: 200 } }, { replace: false, exists: none, avail: ALL })).toBe("/d/icon@2x.png");
    expect(outputFor("/d/icon@2x.png", { kind: "resize", spec: { percent: 50 } }, { replace: false, exists: none, avail: ALL })).toBe("/d/icon.png");
    expect(outputFor("/d/icon.png", { kind: "resize", spec: { percent: 50 } }, { replace: false, exists: none, avail: ALL })).toBe("/d/icon@0.5x.png");
    expect(outputFor("/d/photo.png", { kind: "icons" }, { replace: false, exists: none, avail: ALL })).toBe("/d/photo-icons");
    expect(outputFor("/d/photo.png", { kind: "icons" }, { replace: false, exists: (p) => p === "/d/photo-icons", avail: ALL })).toBe("/d/photo-icons-2");
    expect(outputFor("/d/photo.png", { kind: "compress" }, { replace: false, exists: none, avail: ALL, dir: "/cache/clipboard" })).toBe("/cache/clipboard/photo-compressed.png");
  });

  test("the output's format: a convert's, the web format, PNG for an SVG, and PNG for a geometry job on WebP or SVG under sips (it writes neither)", () => {
    expect(outputFmt({ kind: "convert", to: "avif" }, "png", ALL)).toBe("avif");
    expect(outputFmt({ kind: "web", to: "webp", max: 2000 }, "jpeg", ALL)).toBe("webp");
    expect(outputFmt({ kind: "web", max: 2000 }, "jpeg", ALL)).toBe("jpeg");
    expect(outputFmt({ kind: "compress" }, "svg", ALL)).toBe("png");
    expect(outputFmt({ kind: "resize", spec: { width: 1 } }, "webp", ALL)).toBe("png");
    expect(outputFmt({ kind: "resize", spec: { width: 1 } }, "webp", ["magick"])).toBe("webp");
    expect(geomFormat("jpeg", ALL)).toBe("jpeg");
    expect(outputFor("/d/a.webp", { kind: "rotate", degrees: 90 }, { replace: false, exists: () => false, avail: ALL })).toBe("/d/a-rotated90.png");
  });

  test("parseResize: a width, x a height, a fit, a percent, a multiplier; anything else nothing", () => {
    expect(parseResize("800")).toEqual({ width: 800 });
    expect(parseResize("800w")).toEqual({ width: 800 });
    expect(parseResize("800px")).toEqual({ width: 800 });
    expect(parseResize("x600")).toEqual({ height: 600 });
    expect(parseResize("600h")).toEqual({ height: 600 });
    expect(parseResize("800x600")).toEqual({ width: 800, height: 600 });
    expect(parseResize("800 × 600")).toEqual({ width: 800, height: 600 });
    expect(parseResize("50%")).toEqual({ percent: 50 });
    expect(parseResize("2x")).toEqual({ percent: 200 });
    expect(parseResize("@0.5x")).toEqual({ percent: 50 });
    expect(parseResize("big")).toBeUndefined();
    expect(parseResize("")).toBeUndefined();
  });

  test("resized keeps the aspect; a fit never grows past either side; cropped is the largest centred box of the aspect", () => {
    expect(resized(DIMS, { percent: 50 })).toEqual({ width: 600, height: 450 });
    expect(resized(DIMS, { width: 800 })).toEqual({ width: 800, height: 600 });
    expect(resized(DIMS, { height: 300 })).toEqual({ width: 400, height: 300 });
    expect(resized(DIMS, { width: 800, height: 800 })).toEqual({ width: 800, height: 600 });
    expect(resized(DIMS, { max: 2000 })).toEqual(DIMS);
    expect(resized(DIMS, { max: 600 })).toEqual({ width: 600, height: 450 });
    expect(cropped(DIMS, "1:1")).toEqual({ width: 900, height: 900 });
    expect(cropped(DIMS, "16:9")).toEqual({ width: 1200, height: 675 });
    expect(cropped(DIMS, "9:16")).toEqual({ width: 506, height: 899 });
    expect(cropped({ width: 900, height: 1200 }, "4:3")).toEqual({ width: 900, height: 675 });
    expect(ASPECTS).toContain("3:2");
  });

  test("percent as the rows print it", () => {
    expect(percent(1000, 280)).toBe("−72%");
    expect(percent(1000, 1020)).toBe("+2%");
    expect(percent(1000, 1000)).toBe("0%");
  });
});

describe("plans: the argv per tool", () => {
  test("PNG: pngquant lossy at the quality with a floor 25 under, oxipng lossless; a lossy ask without pngquant lands on oxipng and says lossless; magick as the fallback, never sips", () => {
    expect(argvs(plan({ kind: "compress" }, "/d/a.png", opts(ALL)))).toEqual(["pngquant --quality=55-80 --speed 1 --strip --force --output /out/x.png -- /d/a.png"]);
    expect(argvs(plan({ kind: "compress", lossless: true }, "/d/a.png", opts(ALL)))).toEqual(["oxipng -o 4 --strip safe --out /out/x.png /d/a.png"]);
    const p = plan({ kind: "compress" }, "/d/a.png", opts(["oxipng", "sips", "magick"]));
    expect(argvs(p)[0]).toStartWith("oxipng");
    expect((p as Plan).lossless).toBe(true);
    expect(argvs(plan({ kind: "compress" }, "/d/a.png", opts(["sips", "magick"])))).toEqual(["magick /d/a.png -strip -define png:compression-level=9 /out/x.png"]);
    expect(plan({ kind: "compress" }, "/d/a.png", opts(["sips"]))).toEqual({ missing: ["pngquant", "oxipng", "magick"], why: "nothing compresses PNG" });
  });

  test("JPEG: djpeg to a PPM then cjpeg progressive at the quality; jpegtran for lossless; sips and magick re-encode; a PNG source goes through a BMP for cjpeg under sips", () => {
    expect(argvs(plan({ kind: "compress" }, "/d/a.jpg", opts(ALL, "/out/x.jpg")))).toEqual(["djpeg -outfile /tmp/t.ppm /d/a.jpg", "cjpeg -quality 80 -optimize -progressive -outfile /out/x.jpg /tmp/t.ppm"]);
    expect(argvs(plan({ kind: "compress", lossless: true }, "/d/a.jpg", opts(ALL, "/out/x.jpg")))).toEqual(["jpegtran -copy none -optimize -progressive -outfile /out/x.jpg /d/a.jpg"]);
    expect(argvs(plan({ kind: "compress" }, "/d/a.jpg", opts(["sips", "magick"], "/out/x.jpg")))).toEqual(["sips -s format jpeg -s formatOptions 80 /d/a.jpg --out /out/x.jpg"]);
    expect(argvs(plan({ kind: "compress" }, "/d/a.jpg", opts(["magick"], "/out/x.jpg")))).toEqual(["magick /d/a.jpg -strip -quality 80 -interlace Plane /out/x.jpg"]);
    expect(argvs(plan({ kind: "convert", to: "jpeg" }, "/d/a.png", opts(["cjpeg", "sips"], "/out/x.jpg")))).toEqual(["sips -s format bmp /d/a.png --out /tmp/t.bmp", "cjpeg -quality 80 -optimize -progressive -outfile /out/x.jpg /tmp/t.bmp"]);
    expect(argvs(plan({ kind: "convert", to: "jpeg" }, "/d/a.heic", opts(["cjpeg", "magick"], "/out/x.jpg")))).toEqual(["magick /d/a.heic /tmp/t.ppm", "cjpeg -quality 80 -optimize -progressive -outfile /out/x.jpg /tmp/t.ppm"]);
  });

  test("WebP and AVIF: cwebp and avifenc from a PNG or JPEG, a HEIC decoded by sips first; lossless flags; the magick fallbacks; sips writes AVIF and HEIC itself", () => {
    expect(argvs(plan({ kind: "convert", to: "webp" }, "/d/a.jpg", opts(ALL, "/out/x.webp")))).toEqual(["cwebp -q 80 -metadata none -quiet /d/a.jpg -o /out/x.webp"]);
    expect(argvs(plan({ kind: "compress", lossless: true }, "/d/a.webp", opts(ALL, "/out/x.webp")))).toEqual(["cwebp -lossless -z 9 -metadata none -quiet /d/a.webp -o /out/x.webp"]);
    expect(argvs(plan({ kind: "convert", to: "webp" }, "/d/a.heic", opts(ALL, "/out/x.webp")))).toEqual(["sips -s format png /d/a.heic --out /tmp/t.png", "cwebp -q 80 -metadata none -quiet /tmp/t.png -o /out/x.webp"]);
    expect(argvs(plan({ kind: "convert", to: "webp" }, "/d/a.heic", opts(["cwebp", "heif-convert"], "/out/x.webp")))).toEqual(["heif-convert /d/a.heic /tmp/t.png", "cwebp -q 80 -metadata none -quiet /tmp/t.png -o /out/x.webp"]);
    expect(argvs(plan({ kind: "convert", to: "webp" }, "/d/a.png", opts(["magick"], "/out/x.webp")))).toEqual(["magick /d/a.png -strip -quality 80 /out/x.webp"]);
    expect(argvs(plan({ kind: "convert", to: "avif" }, "/d/a.png", opts(ALL, "/out/x.avif")))).toEqual(["avifenc -q 80 -s 6 --ignore-exif --ignore-xmp /d/a.png /out/x.avif"]);
    expect(argvs(plan({ kind: "convert", to: "avif" }, "/d/a.avif", opts(["avifenc", "avifdec"], "/out/x.avif")))).toEqual(["avifdec /d/a.avif /tmp/t.png", "avifenc -q 80 -s 6 --ignore-exif --ignore-xmp /tmp/t.png /out/x.avif"]);
    expect(argvs(plan({ kind: "convert", to: "avif" }, "/d/a.png", opts(["sips"], "/out/x.avif")))).toEqual(["sips -s format avif -s formatOptions 80 /d/a.png --out /out/x.avif"]);
    expect(argvs(plan({ kind: "convert", to: "heic" }, "/d/a.png", opts(ALL, "/out/x.heic")))).toEqual(["sips -s format heic -s formatOptions 80 /d/a.png --out /out/x.heic"]);
    expect(argvs(plan({ kind: "convert", to: "pdf" }, "/d/a.png", opts(ALL, "/out/x.pdf")))).toEqual(["sips -s format pdf /d/a.png --out /out/x.pdf"]);
    expect(argvs(plan({ kind: "convert", to: "gif" }, "/d/a.gif", opts(ALL, "/out/x.gif")))).toEqual(["gifsicle -O3 --no-comments --no-names -o /out/x.gif /d/a.gif"]);
    expect(plan({ kind: "convert", to: "webp" }, "/d/a.png", opts(["sips"], "/out/x.webp"))).toEqual({ missing: ["cwebp", "magick"], why: "nothing writes WebP" });
    expect(plan({ kind: "convert", to: "webp" }, "/d/a.txt", opts(ALL))).toMatchObject({ missing: [] });
  });

  test("geometry is sips's on macOS whatever the order (-z H W, -r, -f, -c H W, -p, -m the grey profile), ImageMagick's otherwise; a WebP source under sips comes out as PNG", () => {
    expect(argvs(plan({ kind: "resize", spec: { width: 800 } }, "/d/a.jpg", opts(["magick", "sips"], "/out/x.jpg")))).toEqual(["sips -z 600 800 /d/a.jpg --out /out/x.jpg"]);
    expect(argvs(plan({ kind: "resize", spec: { percent: 50 } }, "/d/a.jpg", opts(["magick"], "/out/x.jpg")))).toEqual(["magick /d/a.jpg -resize 600x450! /out/x.jpg"]);
    expect(argvs(plan({ kind: "rotate", degrees: 90 }, "/d/a.png", opts(ALL)))).toEqual(["sips -r 90 /d/a.png --out /out/x.png"]);
    expect(argvs(plan({ kind: "rotate", degrees: 270 }, "/d/a.png", opts(["magick"])))).toEqual(["magick /d/a.png -rotate 270 /out/x.png"]);
    expect(argvs(plan({ kind: "flip", axis: "horizontal" }, "/d/a.png", opts(ALL)))).toEqual(["sips -f horizontal /d/a.png --out /out/x.png"]);
    expect(argvs(plan({ kind: "flip", axis: "vertical" }, "/d/a.png", opts(["magick"])))).toEqual(["magick /d/a.png -flip /out/x.png"]);
    expect(argvs(plan({ kind: "flip", axis: "horizontal" }, "/d/a.png", opts(["magick"])))).toEqual(["magick /d/a.png -flop /out/x.png"]);
    expect(argvs(plan({ kind: "crop", aspect: "16:9" }, "/d/a.png", opts(ALL)))).toEqual(["sips -c 675 1200 /d/a.png --out /out/x.png"]);
    expect(argvs(plan({ kind: "crop", aspect: "1:1" }, "/d/a.png", opts(["magick"])))).toEqual(["magick /d/a.png -gravity center -crop 900x900+0+0 +repage /out/x.png"]);
    expect(argvs(plan({ kind: "pad", color: "#ffffff" }, "/d/a.png", opts(ALL)))).toEqual(["sips -p 1200 1200 --padColor ffffff /d/a.png --out /out/x.png"]);
    expect(argvs(plan({ kind: "pad", color: "#000" }, "/d/a.png", opts(["magick"])))).toEqual(["magick /d/a.png -background #000 -gravity center -extent 1200x1200 /out/x.png"]);
    expect(argvs(plan({ kind: "gray" }, "/d/a.png", opts(ALL)))).toEqual(["sips -m /System/Library/ColorSync/Profiles/Generic Gray Profile.icc /d/a.png --out /out/x.png"]);
    expect(argvs(plan({ kind: "gray" }, "/d/a.png", opts(["magick"])))).toEqual(["magick /d/a.png -colorspace Gray /out/x.png"]);
    expect(argvs(plan({ kind: "rotate", degrees: 90 }, "/d/a.webp", opts(ALL)))).toEqual(["sips -r 90 -s format png /d/a.webp --out /out/x.png"]);
    expect(plan({ kind: "rotate", degrees: 90 }, "/d/a.png", opts(["pngquant"]))).toMatchObject({ missing: ["sips", "magick"] });
  });

  test("strip: the built-in for PNG and JPEG, exiftool then magick for the rest, a hint naming both otherwise", () => {
    expect(argvs(plan({ kind: "strip" }, "/d/a.jpg", opts(ALL, "/out/x.jpg")))).toEqual(["strip /d/a.jpg /out/x.jpg"]);
    expect(argvs(plan({ kind: "strip" }, "/d/a.png", opts([], "/out/x.png")))).toEqual(["strip /d/a.png /out/x.png"]);
    expect(argvs(plan({ kind: "strip" }, "/d/a.heic", opts(ALL, "/out/x.heic")))).toEqual(["exiftool -all= -o /out/x.heic /d/a.heic"]);
    expect(argvs(plan({ kind: "strip" }, "/d/a.heic", opts(["magick"], "/out/x.heic")))).toEqual(["magick /d/a.heic -strip /out/x.heic"]);
    expect(plan({ kind: "strip" }, "/d/a.heic", opts(["sips"], "/out/x.heic"))).toEqual({ missing: ["exiftool", "magick"], why: "nothing strips HEIC losslessly" });
  });

  test("web: the cap only when the long side is over it, then the lossy encoder, then the built-in strip for PNG and JPEG outputs", () => {
    expect(argvs(plan({ kind: "web", max: 2000 }, "/d/a.jpg", opts(ALL, "/out/x.jpg")))).toEqual(["djpeg -outfile /tmp/t.ppm /d/a.jpg", "cjpeg -quality 80 -optimize -progressive -outfile /out/x.jpg /tmp/t.ppm", "strip /out/x.jpg"]);
    expect(argvs(plan({ kind: "web", max: 1000 }, "/d/a.jpg", opts(ALL, "/out/x.jpg")))).toEqual(["sips -Z 1000 /d/a.jpg --out /tmp/t.jpg", "djpeg -outfile /tmp/t.ppm /tmp/t.jpg", "cjpeg -quality 80 -optimize -progressive -outfile /out/x.jpg /tmp/t.ppm", "strip /out/x.jpg"]);
    expect(argvs(plan({ kind: "web", max: 1000, to: "webp" }, "/d/a.png", opts(ALL, "/out/x.webp")))).toEqual(["sips -Z 1000 /d/a.png --out /tmp/t.png", "cwebp -q 80 -metadata none -quiet /tmp/t.png -o /out/x.webp"]);
    expect(argvs(plan({ kind: "web", max: 1000 }, "/d/a.png", opts(["magick"], "/out/x.png")))).toEqual(["magick /d/a.png -resize 1000x1000> /tmp/t.png", "magick /tmp/t.png -strip -define png:compression-level=9 /out/x.png", "strip /out/x.png"]);
  });

  test("icons: a 1024 square master, the ten iconset files, the five web sizes, favicon.ico, and iconutil on macOS", () => {
    const p = plan({ kind: "icons" }, "/d/photo.png", opts(ALL, "/d/photo-icons")) as Plan;
    const a = p.steps.map((s) => s.argv.join(" "));
    expect(a[0]).toBe("sips -c 900 900 -z 1024 1024 -s format png /d/photo.png --out /tmp/t.png");
    for (const [px, name] of ICONSET) expect(a).toContain(`sips -z ${px} ${px} /tmp/t.png --out /d/photo-icons/photo.iconset/${name}`);
    expect(a).toContain("sips -z 180 180 /tmp/t.png --out /d/photo-icons/apple-touch-icon.png");
    expect(a).toContain("sips -z 32 32 -s format ico /tmp/t.png --out /d/photo-icons/favicon.ico");
    expect(a.at(-1)).toBe("iconutil -c icns /d/photo-icons/photo.iconset -o /d/photo-icons/photo.icns");
    const l = plan({ kind: "icons" }, "/d/photo.png", opts(["magick"], "/d/photo-icons", "linux")) as Plan;
    const b = l.steps.map((s) => s.argv.join(" "));
    expect(b[0]).toBe("magick /d/photo.png -gravity center -crop 900x900+0+0 +repage -resize 1024x1024! /tmp/t.png");
    expect(b).toContain("magick /tmp/t.png -define icon:auto-resize=16,32,48 /d/photo-icons/favicon.ico");
    expect(b.some((x) => x.startsWith("iconutil"))).toBe(false);
  });
});

describe("the built-in strip", () => {
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  test("a JPEG keeps SOI, APP0, APP14 and everything from SOS on; APP1 (EXIF), APP2 (ICC) and COM go", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, ...seg(0xe0, [0x4a, 0x46]), ...seg(0xe1, [0x45, 0x78, 0x69, 0x66]), ...seg(0xe2, [0x49, 0x43]), ...seg(0xfe, [0x68, 0x69]), ...seg(0xee, [0x41]), ...seg(0xdb, [1, 2]), 0xff, 0xda, 0, 2, 9, 9, 9, 0xff, 0xd9]);
    const out = stripJpeg(jpeg);
    expect([...out]).toEqual([0xff, 0xd8, ...seg(0xe0, [0x4a, 0x46]), ...seg(0xee, [0x41]), ...seg(0xdb, [1, 2]), 0xff, 0xda, 0, 2, 9, 9, 9, 0xff, 0xd9]);
    expect(stripJpeg(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
  });
  test("a PNG loses tEXt, iTXt, zTXt, tIME, eXIf and iCCP and keeps IHDR, sRGB, PLTE, tRNS, IDAT, IEND; the pixels are byte-identical", () => {
    const withText = png(4, 4, flat, [text("Comment", "hello"), ...chunk("sRGB", new Uint8Array([0])), ...chunk("tIME", new Uint8Array(7)), ...chunk("eXIf", new Uint8Array([1, 2]))]);
    const out = stripPng(withText);
    const types = (b: Uint8Array) => { const t: string[] = []; for (let i = 8; i + 8 <= b.length;) { const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; t.push(String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7])); i += 12 + len; } return t; };
    expect(types(withText)).toEqual(["IHDR", "tEXt", "sRGB", "tIME", "eXIf", "IDAT", "IEND"]);
    expect(types(out)).toEqual(["IHDR", "sRGB", "IDAT", "IEND"]);
    expect(out).toEqual(png(4, 4, flat, [...chunk("sRGB", new Uint8Array([0]))]));
    expect(strip(withText)).toEqual(out);
    expect(stripPng(new Uint8Array([1, 2]))).toEqual(new Uint8Array([1, 2]));
  });
});

describe("the info parsers", () => {
  test("sips -g all: numbers as numbers, yes/no as a boolean, <nil> absent", () => {
    const i = parseSips(`/x/a.jpg\n  pixelWidth: 640\n  pixelHeight: 480\n  typeIdentifier: public.jpeg\n  format: jpeg\n  dpiWidth: 72.000\n  samplesPerPixel: 3\n  bitsPerSample: 8\n  hasAlpha: no\n  space: RGB\n  profile: sRGB IEC61966-2.1\n  make: Canon\n  model: EOS R5\n  creation: <nil>\n  copyright: someone\n`);
    expect(i).toEqual({ width: 640, height: 480, format: "jpeg", dpi: 72, space: "RGB", profile: "sRGB IEC61966-2.1", alpha: false, bits: 8, make: "Canon", model: "EOS R5", copyright: "someone" });
  });
  test("identify -format lines in the field order; EXIF fractions read as an exposure, an aperture, a focal length", () => {
    const i = parseIdentify("4032\n3024\nJPEG\n72\nsRGB\n\nUndefined\n8\nApple\niPhone 15 Pro\niPhone 15 Pro back camera\n2026:09:16 12:00:00\n1/250\n28/10\n100\n6860/1000\n17.0\n\n\n1\n");
    expect(i).toMatchObject({ width: 4032, height: 3024, format: "jpeg", dpi: 72, space: "sRGB", alpha: false, bits: 8, make: "Apple", model: "iPhone 15 Pro", exposure: "1/250", aperture: "f/2.8", iso: "100", focal: "6.9 mm", software: "17.0", orientation: "1" });
    expect(i.profile).toBeUndefined();
  });
  test("exiftool -j: the photo fields, f-number prefixed, empty strings dropped, bad JSON nothing", () => {
    expect(parseExiftool(JSON.stringify([{ Make: "Canon", Model: "R5", FNumber: 2.8, ExposureTime: "1/250", ISO: 100, FocalLength: "50.0 mm", LensModel: "RF50", DateTimeOriginal: "2026:09:16 12:00:00", GPSPosition: "41.0 N, 29.0 E", Artist: "" }]))).toEqual({ make: "Canon", model: "R5", lens: "RF50", taken: "2026:09:16 12:00:00", exposure: "1/250", aperture: "f/2.8", iso: "100", focal: "50.0 mm", gps: "41.0 N, 29.0 E" });
    expect(parseExiftool("nope")).toEqual({});
  });
});

// ---- over the wire -----------------------------------------------------------------

/**
 * The stand-in for every tool the plans name: the input is the last
 * positional argument that exists, the output the argument after
 * `--out`/`--output`/`-outfile`/`-o`/`-out`, else the last positional; a
 * compressor writes the first 60% of the input (over 400 bytes: below
 * that a copy, so a small file is "already small"), anything else a copy;
 * `sips -g` prints the PNG header's size and a few properties. POSIX sh
 * with `od`, `wc`, `head` and `cp` only, so it runs with `PATH=/usr/bin:/bin`.
 */
const STAND_IN = `#!/bin/sh
tool=$(basename "$0")
out=""; in=""; last=""; props=""; want=""; shrink=""
for a in "$@"; do
  if [ -n "$want" ]; then out="$a"; want=""; continue; fi
  case "$a" in
    --out|--output|-outfile|-o|-out) want=1 ;;
    -g) props=1 ;;
    -quality|-define) shrink=1 ;;
    -*) ;;
    *) if [ -e "$a" ]; then in="$a"; else last="$a"; fi ;;
  esac
done
case "$tool" in pngquant|oxipng|optipng|cjpeg|jpegtran|cwebp|avifenc|gifsicle) shrink=1 ;; sips) shrink="" ;; esac
if [ -n "$props" ]; then
  set -- $(od -An -tu1 -j16 -N8 "$in")
  w=$(( $1 * 16777216 + $2 * 65536 + $3 * 256 + $4 )); h=$(( $5 * 16777216 + $6 * 65536 + $7 * 256 + $8 ))
  echo "$in"; echo "  pixelWidth: $w"; echo "  pixelHeight: $h"; echo "  format: png"; echo "  bitsPerSample: 8"; echo "  hasAlpha: yes"; echo "  space: RGB"; echo "  profile: sRGB IEC61966-2.1"; echo "  make: Canon"; echo "  model: EOS R5"; echo "  creation: <nil>"
  exit 0
fi
[ -z "$out" ] && out="$last"
[ -z "$out" ] && exit 0
[ -z "$in" ] && { echo "no input" >&2; exit 1; }
if [ -d "$in" ]; then printf icns > "$out"; exit 0; fi
size=$(wc -c < "$in")
if [ -n "$shrink" ] && [ "$size" -gt 400 ]; then head -c $(( size * 6 / 10 )) "$in" > "$out"; else cp "$in" "$out"; fi
`;
const TOOLS = ["pngquant", "oxipng", "cjpeg", "djpeg", "jpegtran", "cwebp", "avifenc", "gifsicle", "exiftool", "magick", "sips", "iconutil"];

let host: Host;
let dir: string;
let bin: string;
let clip: { kind: string; image?: string; files?: string[] } | null = null;
const effectsRun: unknown[] = [];
let tinyCalls = 0;
let server: ReturnType<typeof Bun.serve> | undefined;
const P = (p: string) => join(dir, p);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "pal-images-"));
  bin = join(dir, "bin");
  mkdirSync(bin);
  for (const t of TOOLS) writeTool(join(bin, t), STAND_IN);
  writeFileSync(P("photo.png"), png(1200, 900, gradient));
  // The "JPEG" is the same PNG bytes under a .jpg name: the stand-ins read the header, the plans read the extension.
  writeFileSync(P("photo.jpg"), png(1200, 900, gradient));
  writeFileSync(P("flat.png"), png(64, 64, flat));
  writeFileSync(P("noted.png"), png(32, 32, flat, [text("Comment", "a note nobody needs")]));
  writeFileSync(P("notes.txt"), "not an image\n");
  mkdirSync(P("shots"));
  writeFileSync(P("shots/one.png"), png(40, 30, gradient));
  writeFileSync(P("shots/two.png"), png(30, 40, gradient));
  writeFileSync(P("shots/readme.md"), "# shots\n");
  mkdirSync(P("clipdir"));
  writeFileSync(P("clipdir/pasted.png"), png(200, 100, gradient));
  process.env.PAL_IMAGES_PATH = bin;
  process.env.PAL_IMAGES_SELECTION = `${P("photo.png")}\n${P("photo.jpg")}\n${P("notes.txt")}\n${P("shots")}`;
  process.env.PAL_IMAGES_CACHE = P("cache");
  // TinyPNG: a mock that answers a 1000-byte "compressed" file for anything posted.
  server = Bun.serve({ port: 0, fetch: async (req) => {
    const u = new URL(req.url);
    if (req.headers.get("authorization") !== `Basic ${Buffer.from("api:test-key").toString("base64")}`) return Response.json({ error: "Unauthorized", message: "Credentials are invalid." }, { status: 401 });
    if (u.pathname === "/shrink" && req.method === "POST") { tinyCalls++; const n = (await req.arrayBuffer()).byteLength; return Response.json({ input: { size: n, type: "image/png" }, output: { size: 1000, type: "image/png", width: 1, height: 1, ratio: 1000 / n, url: `http://127.0.0.1:${server!.port}/output/abc` } }, { status: 201 }); }
    if (u.pathname === "/output/abc") return new Response(png(1, 1, flat), { headers: { "content-type": "image/png" } });
    return new Response("nope", { status: 404 });
  } });
  process.env.PAL_TINYPNG_API = `http://127.0.0.1:${server.port}`;
  host = await Host.bundled({
    settings: { images: { settings: { tinypng_api_key: "test-key" } } },
    core: {
      "clipboard.current": () => (clip ? { id: 7, text: null, source_app: null, at: Date.now(), bytes: 1, pinned: false, width: null, height: null, image: null, files: null, ...clip } : null),
      "ocr.available": () => true,
      "ocr.image": (p: { path: string }) => ({ text: `text of ${basename(p.path)}` }),
      "effects.run": (p: unknown) => { effectsRun.push(p); return null; },
    },
  });
});
afterAll(() => { host?.kill(); server?.stop(true); if (dir) rmSync(dir, { recursive: true, force: true }); });

const list = (q = "", ctx?: object) => host.list("images", "images", q, ctx);
const pick = (id: string, action?: string, ctx?: object) => host.pick("images", "images", id, action, ctx);
const ids = (rows: Item[]) => rows.map((r) => r.id);

describe("images: the palette (stand-in tools)", () => {
  test("loads with the manifest's tile and no warnings; one input palette with multi and the detail pane", () => {
    const l = host.loaded().find((l) => l.extension === "images")!;
    expect(l.warnings).toEqual([]);
    expect(l.manifest.icon).toEqual(tile("pink", "\u{f02e9}"));
    expect(l.palettes.map((p) => [p.name, p.input, p.multi, p.showDetail])).toEqual([["images", true, true, true]]);
  });

  test("the empty query: the All row, the Finder selection's images (a folder's too, a text file skipped) with size and dimensions, a thumbnail, and every operation as an action", async () => {
    const rows = await list();
    expect(rows[0]).toMatchObject({ id: "all", name: "All 4 images", subtitle: "Finder selection" });
    expect(rows[0].actions!.map((a) => a.id)).toEqual(["compress", "web", "lossless", "tinypng", "resize", "convert", "rotate", "crop", "strip", "gray", "icons"]);
    expect(ids(rows).slice(1)).toEqual([P("photo.png"), P("photo.jpg"), P("shots/one.png"), P("shots/two.png")]);
    const photo = rows[1];
    expect(photo.section).toBe("Finder selection");
    expect(photo.name).toBe("photo.png");
    expect(photo.accessories).toEqual([{ text: bytes(statSync(P("photo.png")).size) }, { text: "1200×900" }]);
    expect(photo.icon).toEqual({ image: `icon://localhost/file?path=${encodeURIComponent(P("photo.png"))}&size=64` });
    expect(photo.keywords).toEqual(["png"]);
    expect(photo.actions!.map((a) => a.id)).toEqual(["compress", "web", "lossless", "tinypng", "resize", "convert", "rotate", "crop", "strip", "gray", "icons", "ocr", "info", "copy", "copy-image", "open", "reveal"]);
    // Sentence case: no capital after the first word but TinyPNG and OCR.
    for (const a of photo.actions!) expect(a.title.replace(/TinyPNG|OCR|Finder|Trash/g, "")).not.toMatch(/\s[A-Z]/);
    // Every shortcut the code declares is in the manifest's key table, and none is a shell key.
    const keys = host.loaded().find((l) => l.extension === "images")!.manifest.palettes!.images.keys!.map((k) => k.keys);
    for (const a of photo.actions!) if (a.shortcut) { expect(keys).toContain(a.shortcut as string); expect(["cmd+i", "cmd+r", "cmd+k", "cmd+shift+b", "cmd+shift+c", "cmd+backspace"]).not.toContain(a.shortcut as string); }
  });

  test("a query filters the rows by name; a typed path lists the file, a folder's images with an All row, completions, or one hint", async () => {
    expect(ids(await list("one"))).toEqual([P("shots/one.png")]);
    expect(ids(await list(P("flat.png")))).toEqual([P("flat.png")]);
    const folder = await list(P("shots") + "/");
    expect(folder[0]).toMatchObject({ id: `folder:${P("shots")}`, name: "All 2 images in shots" });
    expect(ids(folder).slice(1)).toEqual([P("shots/one.png"), P("shots/two.png")]);
    expect(ids(await list(P("ph")))).toEqual([P("photo.jpg"), P("photo.png")]);
    expect((await list(P("sh")))[0]).toMatchObject({ id: `hint:dir:${P("shots")}`, actions: [] });
    expect((await list(P("notes.txt")))[0].name).toBe("notes.txt is not an image");
    expect((await list(P("zzz")))[0].name).toBe("No image or folder there");
  });

  test("the clipboard: an image entry is a Clipboard image row, a file list its images, a path already selected counted once; a query nothing matches is empty", async () => {
    clip = { kind: "image", image: P("clipdir/pasted.png") };
    let rows = await list("", { refresh: true });
    const c = rows.find((r) => r.section === "Clipboard")!;
    expect(c).toMatchObject({ id: P("clipdir/pasted.png"), name: "Clipboard image", subtitle: "From the clipboard" });
    expect(rows[0].subtitle).toBe("Finder selection and Clipboard");
    clip = { kind: "files", files: [P("flat.png"), P("photo.png"), P("notes.txt"), P("gone.png")] };
    rows = await list("", { refresh: true });
    expect(rows.filter((r) => r.section === "Clipboard").map((r) => r.name)).toEqual(["flat.png"]);
    clip = null;
    expect(await list("nothing-matches-this", { refresh: true })).toEqual([]);
  });

  test("the detail pane: the picture at 256 px over the info the stand-in sips answers", async () => {
    const d = await host.detail("images", "images", P("photo.jpg"));
    expect(d.markdown).toBe(`![](icon://localhost/file?path=${encodeURIComponent(P("photo.jpg"))}&size=256)`);
    expect(d.metadata).toEqual([
      { label: "Path", value: P("photo.jpg") }, { label: "Size", value: bytes(statSync(P("photo.jpg")).size) }, { label: "Dimensions", value: "1200 × 900 px" },
      { label: "Format", value: "PNG, 8 bits, alpha" }, { label: "Colour", value: "RGB · sRGB IEC61966-2.1" }, { label: "Camera", value: "Canon EOS R5" },
    ]);
  });

  test("compress writes -compressed next to the source, copies the path and says the tool and the sizes in the HUD; the row then sits under Results with the saving; the pane says what made it; a second time is -2", async () => {
    const before = statSync(P("photo.png")).size;
    const e = await pick(P("photo.png"), "compress");
    expect(e.copy).toBe(P("photo-compressed.png"));
    const after = statSync(P("photo-compressed.png")).size;
    expect(after).toBe(Math.floor(before * 6 / 10));
    expect(e.hud).toBe(`Compressed photo.png: ${bytes(before)} → ${bytes(after)} (${percent(before, after)}), pngquant · path copied`);
    const rows = await list();
    const r = rows.find((x) => x.id === P("photo-compressed.png"))!;
    expect(r.section).toBe("Results");
    expect(r.subtitle).toBe(`Compressed with pngquant · ${bytes(before)} → ${bytes(after)}`);
    expect(r.accessories).toEqual([{ tag: percent(before, after), color: "green" }, { text: bytes(after) }, { text: "1200×900" }]);
    expect(r.actions!.map((a) => a.id)).toContain("trash");
    expect(r.actions!.map((a) => a.id)).not.toContain("restore");
    const d = await host.detail("images", "images", P("photo-compressed.png"));
    expect(d.metadata!.slice(0, 3)).toEqual([{ label: "Made by", value: "Compressed with pngquant" }, { label: "From", value: `${P("photo.png")}, ${bytes(before)}, 1200×900` }, { label: "Saving", tags: [{ text: percent(before, after), color: "green" }] }]);
    expect((await pick(P("photo.png"), "compress")).copy).toBe(P("photo-compressed-2.png"));
    // Lossless names the lossless tool; a JPEG goes through cjpeg (lossy) and jpegtran (lossless).
    expect((await pick(P("photo.png"), "lossless")).hud).toContain("(−40%), oxipng · path copied");
    expect((await pick(P("photo.jpg"), "compress")).hud).toContain(", cjpeg · path copied");
    expect((await pick(P("photo.jpg"), "lossless")).hud).toContain(", jpegtran · path copied");
  });

  test("an image that is already small: nothing is written, a failure toast names the tool that tried", async () => {
    const e = await pick(P("flat.png"), "compress");
    expect(e).toEqual({ keep: true, toast: { title: "flat.png is already small", message: "pngquant could not make it smaller; nothing written", style: "failure" } });
    expect(existsSync(P("flat-compressed.png"))).toBe(false);
  });

  test("the operations by action: strip (the note gone, lossless), gray, and the level choices for resize, rotate, crop and pad, each named for the pixels it lands on", async () => {
    const s = await pick(P("noted.png"), "strip");
    expect(s.copy).toBe(P("noted-stripped.png"));
    expect(new TextDecoder().decode(readFileSync(P("noted-stripped.png")))).not.toContain("nobody needs");
    expect(s.hud).toContain(", pal · path copied");
    expect((await pick(P("photo.png"), "gray")).hud).toMatch(/^Converted to grayscale photo\.png: .*, sips · path copied$/);
    const push = await pick(P("photo.png"), "resize");
    expect(push.push).toEqual({ extension: "images", palette: "images", args: { op: "resize", files: [P("photo.png")] }, title: "Resize photo.png" });
    const level = { args: push.push!.args };
    const presets = await list("", level);
    expect(presets[0]).toMatchObject({ id: 'resize:{"percent":50}', name: "Half size (@0.5x)", subtitle: "photo.png: 1200×900 → 600×450" });
    expect(presets[0].detail!.metadata).toEqual([{ label: "Source", value: "photo.png, 1200×900" }, { label: "Result", value: "600×450" }, { label: "Writes", value: "photo@0.5x.png" }, { label: "Tool", value: "sips" }]);
    expect(presets.map((r) => r.name)).toContain("Double size (@2x)");
    expect(presets.at(-1)).toMatchObject({ id: "hint:how", name: "Or type a size", actions: [] });
    const typed = await list("800x600", level);
    expect(typed[0]).toMatchObject({ id: 'resize:{"width":800,"height":600}', name: "Fit in 800×600", subtitle: "photo.png: 1200×900 → 800×600" });
    expect((await list("banana", level)).map((r) => r.id)).toEqual(["hint:how"]);
    const r = await pick(typed[0].id, "run", level);
    expect(r.copy).toBe(P("photo-800x600.png"));
    // The stand-in copies the pixels, so the HUD reports the sizes it can see; the level then lists the result after the choices.
    expect(r.hud).toMatch(/^Resized photo\.png: .*, sips · path copied$/);
    expect((await list("", level)).at(-1)).toMatchObject({ id: P("photo-800x600.png"), section: "Results" });
    expect((await pick('resize:{"percent":200}', "run", level)).copy).toBe(P("photo@2x.png"));
    const rot = { args: { op: "rotate", files: [P("photo.png")] } };
    expect((await list("", rot)).map((r) => r.id)).toEqual(["rotate:90", "rotate:270", "rotate:180", "flip:horizontal", "flip:vertical"]);
    expect((await list("", rot))[0].detail!.metadata).toEqual([{ label: "Source", value: "photo.png, 1200×900" }, { label: "Result", value: "900×1200" }, { label: "Writes", value: "photo-rotated90.png" }, { label: "Tool", value: "sips" }]);
    expect((await pick("rotate:90", "run", rot)).copy).toBe(P("photo-rotated90.png"));
    const crop = { args: { op: "crop", files: [P("photo.png")] } };
    expect((await list("", crop)).map((r) => r.id)).toEqual(["crop:1:1", "crop:16:9", "crop:4:3", "crop:3:2", "crop:9:16", "pad"]);
    expect((await list("", crop))[0].subtitle).toBe("photo.png: 1200×900 → 900×900, centred");
    expect((await list("", crop))[5].subtitle).toBe("photo.png: 1200×900 → 1200×1200, #ffffff around it");
    expect((await pick("crop:1:1", "run", crop)).copy).toBe(P("photo-square.png"));
    expect((await pick("pad", "run", crop)).copy).toBe(P("photo-padded.png"));
  });

  test("convert: the formats with the tool that writes each, a missing one named and inert; the result carries the new extension", async () => {
    const level = { args: { op: "convert", files: [P("photo.png")] } };
    const rows = await list("", level);
    expect(rows.map((r) => [r.id, r.subtitle])).toEqual([
      ["convert:jpeg", "photo.png as .jpg with cjpeg, quality 80"], ["convert:webp", "photo.png as .webp with cwebp, quality 80"], ["convert:avif", "photo.png as .avif with avifenc, quality 80"],
      ["convert:heic", "photo.png as .heic with sips, quality 80"], ["convert:pdf", "photo.png as .pdf with sips"], ["convert:tiff", "photo.png as .tiff with sips"], ["convert:gif", "photo.png as .gif with sips"],
    ]);
    const e = await pick("convert:webp", "run", level);
    expect(e.copy).toBe(P("photo.webp"));
    expect(e.hud).toMatch(/^Converted to WebP photo\.png: .*, cwebp · path copied$/);
    // With only sips listed, WebP has no writer: the row says what to install and takes no action.
    host.changeSettings("images", { settings: { tools: ["sips"], tinypng_api_key: "test-key" } });
    await Bun.sleep(50);
    const webp = (await list("", level)).find((r) => r.id === "convert:webp")!;
    expect(webp.actions).toEqual([]);
    expect(webp.subtitle).toBe("Install cwebp or magick: nothing writes WebP");
    expect(webp.detail!.metadata!.at(-1)).toEqual({ label: "Needs", value: "cwebp (brew install webp) or magick (brew install imagemagick)" });
    host.changeSettings("images", { settings: { tinypng_api_key: "test-key" } });
    await Bun.sleep(50);
  });

  test("replace: the result takes the source's place, the original is kept in the cache and Restore puts it back", async () => {
    writeFileSync(P("rep.png"), png(300, 300, gradient));
    const before = statSync(P("rep.png")).size;
    host.changeSettings("images", { settings: { replace: true, tinypng_api_key: "test-key" } });
    await Bun.sleep(50);
    const e = await pick(P("rep.png"), "compress");
    expect(e.copy).toBe(P("rep.png"));
    expect(e.hud).toContain("pngquant, the original kept for Restore · path copied");
    expect(statSync(P("rep.png")).size).toBe(Math.floor(before * 6 / 10));
    const kept = readdirSync(P("cache/originals"));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toEndWith("-rep.png");
    const row = (await list(P("rep.png")))[0];
    expect(row.actions!.map((a) => a.id)).toContain("restore");
    expect(row.actions!.map((a) => a.id)).not.toContain("trash");
    const r = await pick(P("rep.png"), "restore");
    expect(r.toast).toMatchObject({ title: "Restored rep.png" });
    expect(statSync(P("rep.png")).size).toBe(before);
    expect(readdirSync(P("cache/originals"))).toEqual([]);
    host.changeSettings("images", { settings: { tinypng_api_key: "test-key" } });
    await Bun.sleep(50);
  });

  test("a clipboard image's result goes to the cache's clipboard folder and the image itself is what gets copied (or the file, where nothing can write the pasteboard)", async () => {
    clip = { kind: "image", image: P("clipdir/pasted.png") };
    await list("", { refresh: true });
    const e = await pick(P("clipdir/pasted.png"), "gray");
    const out = readdirSync(P("cache/clipboard"));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^clipboard-\d\d-\d\d-\d\d-gray\.png$/);
    expect(existsSync(P("clipdir/pasted-gray.png"))).toBe(false);
    expect(e.hud).toMatch(/^Converted to grayscale the clipboard image: .*, sips · (image|path) copied$/);
    clip = null;
  });

  test("the icon set: a folder with the iconset, the web sizes, favicon.ico and the .icns", async () => {
    const e = await pick(P("photo.png"), "icons");
    expect(e.copy).toBe(P("photo-icons"));
    expect(e.hud).toMatch(/^Icon set photo\.png: [\d.]+ [KM]B in photo-icons, sips · path copied$/);
    // The .icns comes from iconutil, which the plan asks for on macOS only.
    const files = ["android-chrome-192.png", "android-chrome-512.png", "apple-touch-icon.png", "favicon-16.png", "favicon-32.png", "favicon.ico", ...(process.platform === "darwin" ? ["photo.icns"] : []), "photo.iconset"];
    expect(readdirSync(P("photo-icons")).sort()).toEqual(files);
    expect(readdirSync(P("photo-icons/photo.iconset")).sort()).toEqual(ICONSET.map(([, n]) => n).sort());
  });

  test("optimise for web: a view with a row per image (thumbnail, sizes, the saving, a bar; already small for one nothing shrinks), the total at the foot; its picks copy the paths or the first image", async () => {
    const e = await pick(P("photo.png"), "web", { ids: [P("photo.png"), P("flat.png")] });
    const v = e.view as View;
    expect(v.id).toBe("web:1");
    expect(v.title).toBe("Optimised for web");
    expect(v.actions.map((a) => a.id)).toEqual(["reveal", "copy", "copy-image"]);
    const tree = v.tree as ViewNode & { children: ViewNode[] };
    const rows = tree.children.filter((n) => n.type === "stack" && n.key) as (ViewNode & { key: string; children: ViewNode[] })[];
    expect(rows.map((r) => r.key)).toEqual([P("photo.png"), P("flat.png")]);
    expect(JSON.stringify(rows[0])).toContain('"type":"progress"');
    expect(JSON.stringify(rows[0])).toContain('"type":"image"');
    expect(JSON.stringify(rows[0])).toContain('{"type":"badge","text":"−40%","color":"green"}');
    expect(JSON.stringify(rows[1])).toContain("already small");
    const foot = tree.children.at(-1) as ViewNode & { value: string };
    expect(foot.value).toMatch(/^Saved [\d.]+ [KM]?B \(−40%\) across 1 image$/);
    expect(existsSync(P("photo-web.png"))).toBe(true);
    expect((await pick("web:1", "copy")).copy).toBe(P("photo-web.png"));
    expect(effectsRun).toEqual([]);
  });

  test("a batch: the All row runs the operation over every source, the HUD sums it up and every path is copied; marked rows the same", async () => {
    await list("", { refresh: true });
    const e = await pick("all", "gray");
    expect(e.hud).toMatch(/^Converted to grayscale 4 of 4 images: .* with sips · paths copied$/);
    expect(String(e.copy).split("\n")).toEqual([P("photo-gray-2.png"), P("photo-gray.jpg"), P("shots/one-gray.png"), P("shots/two-gray.png")]);
    const m = await pick(P("shots/one.png"), "copy", { ids: [P("shots/one.png"), P("shots/two.png")] });
    expect(m.copy).toBe(`${P("shots/one.png")}\n${P("shots/two.png")}`);
  });

  test("TinyPNG: the bytes posted with the key as basic auth, the output fetched and written as -compressed; a bad key is the service's message", async () => {
    const e = await pick(P("flat.png"), "tinypng");
    expect(tinyCalls).toBe(1);
    expect(e.copy).toBe(P("flat-compressed.png"));
    expect(e.hud).toContain(", TinyPNG · path copied");
    expect(statSync(P("flat-compressed.png")).size).toBe(png(1, 1, flat).length);
    expect((await pick(P("notes.txt"), "tinypng")).toast?.message).toContain("TinyPNG takes PNG, JPEG, WebP and AVIF");
    host.changeSettings("images", { settings: { tinypng_api_key: "wrong" } });
    await Bun.sleep(50);
    const bad = await pick(P("flat.png"), "tinypng");
    expect(bad.toast).toMatchObject({ style: "failure", message: "Credentials are invalid." });
    host.changeSettings("images", { settings: { tinypng_api_key: "test-key" } });
    await Bun.sleep(50);
  });

  test("OCR through the core, Copy info as lines, Copy path, Open", async () => {
    expect(await pick(P("flat.png"), "ocr")).toEqual({ copy: "text of flat.png", hud: "Copied text" });
    const info = await pick(P("flat.png"), "info");
    expect(info.hud).toBe("Copied info");
    expect(info.copy).toBe(`Path: ${P("flat.png")}\nSize: ${bytes(statSync(P("flat.png")).size)}\nDimensions: 64 × 64 px\nFormat: PNG, 8 bits, alpha\nColour: RGB · sRGB IEC61966-2.1\nCamera: Canon EOS R5`);
    expect(await pick(P("flat.png"), "copy")).toEqual({ copy: P("flat.png") });
    expect(await pick(P("flat.png"), "open")).toEqual({ open: P("flat.png") });
  });

  test("with TinyPNG's key unset its action is gone; with no encoders listed the hints name what to install", async () => {
    host.changeSettings("images", { settings: { tinypng_api_key: "", tools: [] } });
    await Bun.sleep(50);
    const rows = await list("", { refresh: true });
    expect(rows[1].actions!.map((a) => a.id)).not.toContain("tinypng");
    const sel = process.env.PAL_IMAGES_SELECTION;
    // Nothing at hand: a fresh host with an empty selection lists the hints.
    process.env.PAL_IMAGES_SELECTION = "";
    const bare = await Host.bundled({ settings: { images: { settings: { tools: [] } } }, core: { "clipboard.current": () => null, "ocr.available": () => false } });
    try {
      const hints = await bare.list("images", "images", "");
      expect(hints[0]).toMatchObject({ id: "hint:how", actions: [] });
      expect(hints[0].name).toBe(MAC ? "Select images in Finder, copy one, or type a path" : "Copy images, or type a path");
      expect(hints[1]).toMatchObject({ id: "hint:none", name: "Nothing here resizes or converts" });
      expect(hints.slice(2).map((h) => h.name)).toEqual(["pngquant is not installed", "oxipng is not installed", "cjpeg is not installed"]);
      for (const h of hints) { expect(h.subtitle).not.toMatch(/\.$/); expect(h.actions).toEqual([]); }
    } finally { bare.kill(); process.env.PAL_IMAGES_SELECTION = sel; }
    host.changeSettings("images", { settings: { tinypng_api_key: "test-key" } });
    await Bun.sleep(50);
  });
});

// ---- the real tools, where they are -------------------------------------------------

describe.skipIf(!MAGICK && !REAL_SIPS)("images: the real tools", () => {
  let real: Host;
  let rdir: string;
  const R = (p: string) => join(rdir, p);
  beforeAll(async () => {
    rdir = mkdtempSync(join(tmpdir(), "pal-images-real-"));
    writeFileSync(R("photo.png"), png(1200, 900, gradient));
    const path = process.env.PAL_IMAGES_PATH;
    delete process.env.PAL_IMAGES_PATH;
    process.env.PAL_IMAGES_SELECTION = R("photo.png");
    process.env.PAL_IMAGES_CACHE = R("cache");
    try { real = await Host.bundled({ core: { "clipboard.current": () => null, "ocr.available": () => false } }); } finally { process.env.PAL_IMAGES_PATH = path; }
  });
  afterAll(() => { real?.kill(); if (rdir) rmSync(rdir, { recursive: true, force: true }); });

  test("the drawn PNG's size and pixels are read by sips or identify", async () => {
    const rows = await real.list("images", "images", "");
    expect(rows[0].accessories).toEqual([{ text: bytes(statSync(R("photo.png")).size) }, { text: "1200×900" }]);
  });

  test.skipIf(!MAGICK)("compress through ImageMagick (or pngquant/oxipng when installed) writes a smaller, still-readable PNG", async () => {
    const e = await real.pick("images", "images", R("photo.png"), "compress");
    expect(e.copy).toBe(R("photo-compressed.png"));
    expect(e.hud).toMatch(/^Compressed photo\.png: .* \(−\d+%\), (pngquant|oxipng|optipng|magick) · path copied$/);
    expect(statSync(R("photo-compressed.png")).size).toBeLessThan(statSync(R("photo.png")).size);
    const id = Bun.spawnSync([MAGICK!, ...(basename(MAGICK!) === "magick" ? ["identify"] : []), "-format", "%m %w %h", R("photo-compressed.png")]);
    expect(id.stdout.toString()).toBe("PNG 1200 900");
  });

  test("a half-size resize lands on 600×450 through sips or ImageMagick", async () => {
    const level = { args: { op: "resize", files: [R("photo.png")] } };
    const e = await real.pick("images", "images", 'resize:{"percent":50}', "run", level);
    expect(e.copy).toBe(R("photo@0.5x.png"));
    expect(e.hud).toContain("1200×900 → 600×450");
    const rows = await real.list("images", "images", "", level);
    expect(rows.at(-1)).toMatchObject({ id: R("photo@0.5x.png"), section: "Results", accessories: [expect.objectContaining({ color: "green" }), expect.anything(), { text: "600×450" }] });
  });
});
