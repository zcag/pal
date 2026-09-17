// A picture on the web as a data url: a view's `image` node loads `data:`
// pictures only (a row's icon may load a url), so a popover's avatars are
// fetched once each and kept; a miss is remembered for a while so an
// offline render does not wait on every picture again.

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
