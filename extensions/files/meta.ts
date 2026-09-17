// What the detail pane adds beyond stat: parsers, pure. `mdls -raw` prints
// the asked attributes NUL-separated in the asked order, a number as
// digits, an array as `(\n    "a",\n    "b"\n)` and a missing one as
// `(null)`; a Finder tag is `Name\n<colour index>` when it has a colour.

type Meta = { width?: number; height?: number; tags: string[] };

/** The output of `mdls -name kMDItemPixelWidth -name kMDItemPixelHeight -name kMDItemUserTags -raw`. */
export function parseMdls(text: string): Meta {
  const [w = "", h = "", t = ""] = text.split("\0");
  const num = (s: string) => { const n = Number(s.trim()); return Number.isInteger(n) && n > 0 ? n : undefined; };
  const tags = [...t.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\n[\s\S]*$/, "").replace(/\\(.)/g, "$1").trim()).filter(Boolean);
  return { width: num(w), height: num(h), tags };
}
