// The side of the Images extension that touches the machine: which tools
// are installed, running a plan's steps (each argv's first word resolved
// to a binary), the thumbnail cache, the Finder selection, an image onto
// the clipboard, the TinyPNG API, and the originals kept for undo.
import { existsSync, mkdirSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { exec, home, selection, thumbnailUrl } from "@zcag/pal";
import { fmtOf, identifyFormat, parseExiftool, parseIdentify, parseSips, strip, TOOL_ORDER, type Avail, type Dims, type Fmt, type Info, type Plan, type Step, type ToolName } from "./ops.ts";

export const MAC = process.platform === "darwin";
/** A step that has not finished by then is killed and the job fails. */
export const STEP_MS = 60_000;
/** The API's own budget: an upload and a download of a few megabytes. */
const TINYPNG_MS = 90_000;

// ---- the cache dir ------------------------------------------------------------

/** `~/Library/Caches/pal/images` on macOS, `$XDG_CACHE_HOME/pal/images` on Linux; `PAL_IMAGES_CACHE` for the tests. Thumbnails, temp files, and the originals a `replace` displaced. */
export const CACHE = process.env.PAL_IMAGES_CACHE || (MAC ? home("~/Library/Caches/pal/images") : join(process.env.XDG_CACHE_HOME || home("~/.cache"), "pal/images"));
const ready = new Set<string>();
/** A subdirectory of the cache, made once. */
export function dir(sub: "thumbs" | "tmp" | "originals" | "clipboard"): string {
  const p = join(CACHE, sub);
  if (!ready.has(p)) { mkdirSync(p, { recursive: true }); ready.add(p); }
  return p;
}
let seq = 0;
/** A fresh temp path in the cache with the extension asked (the plans' intermediates). */
export const tmpPath = (ext: string) => join(dir("tmp"), `${process.pid}-${Date.now().toString(36)}-${++seq}.${ext}`);

// ---- tools --------------------------------------------------------------------

/** Where mozjpeg's keg-only binaries sit when brewed; `cjpeg` on PATH is libjpeg-turbo's otherwise, which also works. */
const MOZJPEG = ["/opt/homebrew/opt/mozjpeg/bin", "/usr/local/opt/mozjpeg/bin"];
const BINARIES: Partial<Record<ToolName, string[]>> = { magick: ["magick", "convert"], identify: ["magick", "identify"], cjpeg: ["cjpeg"], djpeg: ["djpeg"] };
const found = new Map<ToolName, string | null>();

/** The binary for a tool name, or null; looked up once. `PAL_IMAGES_PATH` prepends directories (the tests' stand-ins). */
export function which(tool: ToolName): string | null {
  if (tool === "builtin" || tool === "tinypng") return tool;
  if (!found.has(tool)) {
    const extra = (process.env.PAL_IMAGES_PATH ?? "").split(":").filter(Boolean);
    const dirs = [...extra, ...((tool === "cjpeg" || tool === "djpeg" || tool === "jpegtran") && MAC ? MOZJPEG : [])];
    let hit: string | null = null;
    for (const name of BINARIES[tool] ?? [tool]) {
      hit = dirs.map((d) => join(d, name)).find((p) => existsSync(p)) ?? Bun.which(name) ?? null;
      if (hit) break;
    }
    found.set(tool, hit);
  }
  return found.get(tool)!;
}

/** The `tools` setting filtered to what is installed, in its order; the helpers that only decode ride along. */
export function available(order: string[] = TOOL_ORDER): Avail {
  const named = order.filter((t): t is ToolName => TOOL_ORDER.includes(t as ToolName));
  const helpers: ToolName[] = ["djpeg", "avifdec", "dwebp", "heif-convert", "identify", "iconutil"];
  return [...named, ...helpers].filter((t) => which(t));
}

// ---- running --------------------------------------------------------------------

/** Runs a command to completion or `ms`; the trimmed stdout, or a rejection with stderr (or the exit code). */
export async function run(argv: string[], ms = STEP_MS): Promise<string> {
  const { code, out, err } = await exec(argv, { ms });
  if (code !== 0) throw new Error(err.trim().split("\n")[0] || out.trim().split("\n")[0] || `${basename(argv[0])} exited ${code}`);
  return out.trim();
}

/** One step: the built-in strip in process; anything else spawned with the tool's binary in argv[0] (`magick` as `convert x` on ImageMagick 6). */
async function step(s: Step): Promise<void> {
  if (s.tool === "builtin") {
    const [, input, output = input] = s.argv;
    await writeFile(output, strip(new Uint8Array(await readFile(input))));
    return;
  }
  const bin = which(s.tool);
  if (!bin) throw new Error(`${s.tool} is not installed`);
  const argv = [bin, ...s.argv.slice(1)];
  if (s.tool === "identify" && basename(bin) === "magick") argv.splice(1, 0, "identify");
  // pngquant exits 98 (larger) and 99 (below the quality floor) without writing; that is "no gain", not a failure.
  try { await run(argv); } catch (e) { if (s.tool === "pngquant" && /exited (98|99)/.test(String(e))) return; throw e; }
}

/** Runs a plan's steps in order, the output's directory made first (`folder`: the output is a directory the steps fill); the intermediates in the cache's tmp dir are removed after. */
export async function execute(p: Plan, opts: { folder?: boolean } = {}): Promise<void> {
  await mkdir(opts.folder ? p.output : dirname(p.output), { recursive: true });
  const tmp = dir("tmp");
  const made = new Set<string>();
  for (const s of p.steps) {
    for (const a of s.argv) {
      if (a.startsWith(tmp + "/") && a !== p.output) made.add(a);
      if (opts.folder && a.startsWith(p.output + "/")) await mkdir(dirname(a), { recursive: true });
    }
    await step(s);
  }
  for (const f of made) await unlink(f).catch(() => {});
}

// ---- files -------------------------------------------------------------------------

export const exists = (p: string) => existsSync(p);
export const sizeOf = async (p: string) => (await stat(p).catch(() => undefined))?.size ?? 0;

/** The image's pixel size: `sips` on macOS (8 ms), else `identify`; undefined when neither reads it. Cached by path and mtime. */
const dimsCache = new Map<string, Dims>();
export async function dimsOf(p: string): Promise<Dims | undefined> {
  const st = await stat(p).catch(() => undefined);
  if (!st) return undefined;
  const key = `${p}:${st.mtimeMs}:${st.size}`;
  const hit = dimsCache.get(key);
  if (hit) return hit;
  let d: Dims | undefined;
  try {
    if (which("sips")) {
      const out = await run([which("sips")!, "-g", "pixelWidth", "-g", "pixelHeight", p], 10_000);
      const w = /pixelWidth: (\d+)/.exec(out)?.[1], h = /pixelHeight: (\d+)/.exec(out)?.[1];
      if (w && h) d = { width: +w, height: +h };
    } else if (which("identify")) {
      const bin = which("identify")!;
      const out = await run([bin, ...(basename(bin) === "magick" ? ["identify"] : []), "-format", "%w %h", `${p}[0]`], 10_000);
      const [w, h] = out.split(" ").map(Number);
      if (w && h) d = { width: w, height: h };
    }
  } catch {}
  if (d) dimsCache.set(key, d);
  return d;
}

/** Get info: sips's properties on macOS (else identify's), plus exiftool's photo fields when it is installed. */
export async function infoOf(p: string): Promise<Info> {
  let info: Info = {};
  try {
    if (which("sips")) info = parseSips(await run([which("sips")!, "-g", "all", p], 10_000));
    else if (which("identify")) {
      const bin = which("identify")!;
      info = parseIdentify(await run([bin, ...(basename(bin) === "magick" ? ["identify"] : []), "-format", identifyFormat(), `${p}[0]`], 10_000));
    }
  } catch {}
  if (which("exiftool")) {
    try { info = { ...info, ...parseExiftool(await run([which("exiftool")!, "-j", "-n", "-Make", "-Model", "-LensModel", "-DateTimeOriginal", "-CreateDate", "-ExposureTime", "-FNumber", "-ISO", "-FocalLength", "-Software", "-Copyright", "-Artist", "-Orientation", "-GPSPosition", "-ProfileDescription", p], 10_000)) }; } catch {}
  }
  return info;
}

// ---- thumbnails -------------------------------------------------------------------

/** What the core's `icon://localhost/file` route reads itself (the image crate: PNG, JPEG, GIF); every other format is thumbnailed here. */
const CORE_READS: Fmt[] = ["png", "jpeg", "gif"];
/** Thumbnails made here: a JPEG for opaque formats, a PNG where there may be transparency. */
const ALPHA: Fmt[] = ["png", "gif", "webp", "avif", "svg", "tiff"];
const thumbCache = new Map<string, string>();

/**
 * A picture of the image fitted in `px` for a row, a view or the pane:
 * the core's own `icon://localhost/file` url for PNG, JPEG and GIF (it
 * decodes and caches those itself, lazily, so nothing rides the wire),
 * else a `data:image/...` url of a thumbnail made here with `sips -Z px`
 * on macOS or ImageMagick, kept in the cache keyed by path, mtime, size
 * and `px`. Undefined when nothing can thumbnail the file.
 */
export async function thumbnail(p: string, px: number): Promise<string | undefined> {
  const st = await stat(p).catch(() => undefined);
  if (!st) return undefined;
  const fmt = fmtOf(p);
  if (fmt && CORE_READS.includes(fmt) && !process.env.PAL_IMAGES_DATA_THUMBS) return thumbnailUrl(p, Math.min(px, 256));
  const ext = fmt && ALPHA.includes(fmt) ? "png" : "jpg";
  const key = `${Bun.hash(`${p}:${st.mtimeMs}:${st.size}`).toString(36)}-${px}.${ext}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const file = join(dir("thumbs"), key);
  if (!exists(file)) {
    try {
      if (which("sips")) await run([which("sips")!, "-Z", String(px), "-s", "format", ext === "jpg" ? "jpeg" : "png", ...(ext === "jpg" ? ["-s", "formatOptions", "80"] : []), p, "--out", file], 15_000);
      else if (which("magick")) await run([which("magick")!, `${p}[0]`, "-thumbnail", `${px}x${px}`, "-strip", file], 15_000);
      else return undefined;
    } catch { return undefined; }
  }
  const bytes = await readFile(file).catch(() => undefined);
  if (!bytes) return undefined;
  const url = `data:image/${ext === "jpg" ? "jpeg" : "png"};base64,${bytes.toString("base64")}`;
  thumbCache.set(key, url);
  return url;
}

// ---- the Finder selection ---------------------------------------------------------

/** The files selected in Finder while it is the app in front (the core's `selection.files()`: one read per panel show, empty off macOS, when nothing is selected or when another app is in front). `PAL_IMAGES_SELECTION` (newline-separated paths) stands in for the tests. */
export async function finderSelection(): Promise<string[]> {
  if (process.env.PAL_IMAGES_SELECTION !== undefined) return process.env.PAL_IMAGES_SELECTION.split("\n").filter(Boolean);
  return selection.files().catch(() => []);
}

// ---- the clipboard ------------------------------------------------------------------

/**
 * An image file onto the clipboard as an image (what a paste into Slack,
 * Notes or a browser takes): AppleScript's `«class PNGf»` / `«class JPEG»`
 * on macOS, `wl-copy` or `xclip` on Linux. Only PNG and JPEG have a
 * pasteboard type every app reads; anything else is left to a `copy_files`
 * (the caller's fallback). True when it was put there.
 */
export async function copyImage(p: string): Promise<boolean> {
  const fmt = fmtOf(p);
  if (fmt !== "png" && fmt !== "jpeg") return false;
  try {
    if (MAC) await run(["osascript", "-e", `set the clipboard to (read (POSIX file ${JSON.stringify(p)}) as ${fmt === "png" ? "«class PNGf»" : "«class JPEG»"})`], 10_000);
    else if (Bun.which("wl-copy")) await run(["sh", "-c", `wl-copy -t image/${fmt} < ${JSON.stringify(p)}`], 10_000);
    else if (Bun.which("xclip")) await run(["sh", "-c", `xclip -selection clipboard -t image/${fmt} -i ${JSON.stringify(p)}`], 10_000);
    else return false;
    return true;
  } catch { return false; }
}

// ---- TinyPNG -----------------------------------------------------------------------

/** `https://api.tinify.com`; `PAL_TINYPNG_API` points the tests at a mock. */
export const TINYPNG_API = process.env.PAL_TINYPNG_API || "https://api.tinify.com";

/**
 * TinyPNG (tinify.com): POST the bytes to `/shrink`, then GET the
 * `output.url` it answers; both with the API key as HTTP basic auth
 * (`api:<key>`). PNG, JPEG, WebP and AVIF. Resolves with the bytes and
 * the sizes the service reported; rejects with its `message`.
 */
export async function tinypng(input: string, key: string): Promise<{ bytes: Uint8Array; before: number; after: number }> {
  const auth = { Authorization: `Basic ${Buffer.from(`api:${key}`).toString("base64")}` };
  const body = await readFile(input);
  const r = await fetch(`${TINYPNG_API}/shrink`, { method: "POST", headers: auth, body, signal: AbortSignal.timeout(TINYPNG_MS) });
  const j = (await r.json().catch(() => ({}))) as { input?: { size: number }; output?: { size: number; url: string }; message?: string; error?: string };
  if (!r.ok || !j.output) throw new Error(j.message ?? j.error ?? `TinyPNG answered ${r.status}`);
  const d = await fetch(j.output.url, { headers: auth, signal: AbortSignal.timeout(TINYPNG_MS) });
  if (!d.ok) throw new Error(`TinyPNG download answered ${d.status}`);
  return { bytes: new Uint8Array(await d.arrayBuffer()), before: j.input?.size ?? body.length, after: j.output.size };
}

// ---- originals -----------------------------------------------------------------------

/** With `replace` on, the source is copied here before the output takes its place; "Restore original" moves it back. `<stamp>-<name>` in the cache's originals dir. */
export async function keepOriginal(p: string): Promise<string> {
  const kept = join(dir("originals"), `${Date.now().toString(36)}-${basename(p)}`);
  await copyFile(p, kept);
  return kept;
}

/** The kept copy back over `output` (the file the replace wrote), and the replaced path is the original's again. */
export async function restoreOriginal(kept: string, original: string, output: string): Promise<void> {
  if (output !== original) await unlink(output).catch(() => {});
  await rename(kept, original).catch(async () => { await copyFile(kept, original); await unlink(kept); });
}

/** A file to the Trash: Finder on macOS, `gio trash` on Linux; never a delete. */
export const trash = (p: string) => run(MAC ? ["osascript", "-e", `tell application "Finder" to delete POSIX file ${JSON.stringify(p)}`] : ["gio", "trash", "--", p], 10_000).then(() => {});
