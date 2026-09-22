// A picture on the web as a data url: a view's `image` node loads `data:`
// pictures only (a row's icon may load a url), so a popover's avatars are
// fetched once each and kept; a miss is remembered for a while so an
// offline render does not wait on every picture again. And a picture file
// onto the clipboard as an image (`copyImage`), what Images and Immich
// share.
import { run } from "./exec.ts";

export const IMAGE_MS = 2000, IMAGE_MISS_TTL = 15 * 60_000, MAX_IMAGE = 96 * 1024;

const cache = new Map<string, { at: number; data?: string; pending?: Promise<string | undefined> }>();

/** The picture at `url` as a data url, or undefined (not an image, over `MAX_IMAGE`, unreachable within `IMAGE_MS`); fetched once per url, a miss remembered `IMAGE_MISS_TTL`. */
export function imageData(url: string): Promise<string | undefined> {
  const have = cache.get(url);
  if (have?.data) return Promise.resolve(have.data);
  if (have?.pending) return have.pending;
  if (have && Date.now() - have.at < IMAGE_MISS_TTL) return Promise.resolve(undefined);
  const pending = fetch(url, { signal: AbortSignal.timeout(IMAGE_MS) }).then(async (r) => {
    const type = r.headers.get("content-type")?.split(";")[0] ?? "";
    if (!r.ok || !type.startsWith("image/")) return undefined;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length && buf.length <= MAX_IMAGE ? `data:${type};base64,${buf.toString("base64")}` : undefined;
  }).catch(() => undefined).then((data) => { cache.set(url, { at: Date.now(), data }); return data; });
  cache.set(url, { at: Date.now(), pending });
  return pending;
}

/** Forget every fetched picture (tests). */
export const forgetImages = () => cache.clear();

/** The pasteboard image types every app reads, by the file's extension: PNG and JPEG; anything else is left to a `copy_files`. */
const IMAGE_FORMATS: Record<string, "png" | "jpeg"> = { png: "png", jpg: "jpeg", jpeg: "jpeg" };

/**
 * An image file onto the clipboard as an image (what a paste into Slack,
 * Notes or a browser takes): AppleScript's `«class PNGf»` / `«class JPEG»`
 * on macOS, `wl-copy` or `xclip` on Linux. Only PNG and JPEG have a
 * pasteboard type every app reads (`fmt` names one when the extension
 * does not say); anything else is left to a `copy_files` (the caller's
 * fallback). True when it was put there. `PAL_COPY_IMAGE` names a
 * stand-in taking the path and the format (the tests).
 */
export async function copyImage(path: string, fmt: "png" | "jpeg" | undefined = IMAGE_FORMATS[path.slice(path.lastIndexOf(".") + 1).toLowerCase()]): Promise<boolean> {
  if (!fmt) return false;
  try {
    if (process.env.PAL_COPY_IMAGE) await run([process.env.PAL_COPY_IMAGE, path, fmt], { ms: 10_000 });
    else if (process.platform === "darwin") await run(["osascript", "-e", `set the clipboard to (read (POSIX file ${JSON.stringify(path)}) as ${fmt === "png" ? "«class PNGf»" : "«class JPEG»"})`], { ms: 10_000 });
    else if (Bun.which("wl-copy")) await run(["sh", "-c", `wl-copy -t image/${fmt} < ${JSON.stringify(path)}`], { ms: 10_000 });
    else if (Bun.which("xclip")) await run(["sh", "-c", `xclip -selection clipboard -t image/${fmt} -i ${JSON.stringify(path)}`], { ms: 10_000 });
    else return false;
    return true;
  } catch { return false; }
}
