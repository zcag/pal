// What the detail pane adds beyond stat: parsers, pure. `mdls -raw` prints
// the asked attributes NUL-separated in the asked order, a number as
// digits, an array as `(\n    "a",\n    "b"\n)` and a missing one as
// `(null)`; a Finder tag is `Name\n<colour index>` when it has a colour.
// A PNG's size sits in its IHDR chunk (bytes 16 to 24, big-endian).

export type Meta = { width?: number; height?: number; tags: string[] };

/** The output of `mdls -name kMDItemPixelWidth -name kMDItemPixelHeight -name kMDItemUserTags -raw`. */
export function parseMdls(text: string): Meta {
  const [w = "", h = "", t = ""] = text.split("\0");
  const num = (s: string) => { const n = Number(s.trim()); return Number.isInteger(n) && n > 0 ? n : undefined; };
  const tags = [...t.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\n[\s\S]*$/, "").replace(/\\(.)/g, "$1").trim()).filter(Boolean);
  return { width: num(w), height: num(h), tags };
}

/** A PNG's pixel size off its signature and IHDR; undefined for anything else. */
export function pngSize(head: Uint8Array): { width: number; height: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length < 24 || sig.some((b, i) => head[i] !== b)) return;
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const width = dv.getUint32(16), height = dv.getUint32(20);
  return width && height ? { width, height } : undefined;
}
