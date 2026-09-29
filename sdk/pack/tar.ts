// The package tarball (docs/registry.md, "Packages"): gzip over ustar,
// written here rather than by a `tar` binary, whose owners, mtimes, entry
// order and extensions differ between GNU and BSD. Every entry sits under
// one top directory named after the extension, sorted by bytes, directories
// before what they hold; modes 0755 or 0644 from the owner's executable bit,
// uid and gid 0, mtime 0, no user or group names. The gzip header has no
// name and mtime 0, and its OS byte is set to 255 ("unknown") by hand:
// zlib writes the platform's code (3 on Linux, 19 on macOS), which would
// make the same tree two tarballs.
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { walk } from "./treehash.ts";

const BLOCK = 512;
const enc = new TextEncoder();

/** `value` as `width - 1` octal digits and a NUL, the ustar number field. */
function octal(buf: Uint8Array, at: number, width: number, value: number) {
  const s = value.toString(8).padStart(width - 1, "0");
  if (s.length > width - 1) throw new Error(`tar: ${value} does not fit a ${width}-byte field`);
  buf.set(enc.encode(s), at);
}

/** ustar's name (100 bytes) and prefix (155 bytes): a longer path splits at a `/`. */
function splitPath(path: string): [string, string] {
  const bytes = enc.encode(path);
  if (bytes.length <= 100) return [path, ""];
  for (let i = path.lastIndexOf("/"); i > 0; i = path.lastIndexOf("/", i - 1)) {
    const [prefix, name] = [path.slice(0, i), path.slice(i + 1)];
    if (enc.encode(prefix).length <= 155 && enc.encode(name).length <= 100 && name) return [name, prefix];
  }
  throw new Error(`tar: ${path} is too long for ustar`);
}

function header(path: string, type: "0" | "5", mode: number, size: number): Uint8Array {
  const h = new Uint8Array(BLOCK);
  const [name, prefix] = splitPath(path);
  h.set(enc.encode(name), 0);
  octal(h, 100, 8, mode);
  octal(h, 108, 8, 0); // uid
  octal(h, 116, 8, 0); // gid
  octal(h, 124, 12, size);
  octal(h, 136, 12, 0); // mtime
  h.fill(0x20, 148, 156); // the checksum counts its own field as spaces
  h[156] = type.charCodeAt(0);
  h.set(enc.encode("ustar\u000000"), 257);
  h.set(enc.encode(prefix), 345);
  const sum = h.reduce((a, b) => a + b, 0);
  h.set(enc.encode(sum.toString(8).padStart(6, "0") + "\u0000 "), 148);
  return h;
}

/** The ustar bytes of the directory `dir`, its entries under `top/`. */
export async function tar(dir: string, top: string): Promise<Uint8Array> {
  const { files, dirs } = await walk(dir);
  const entries: { path: string; file?: { abs: string; exec: boolean } }[] = [
    { path: `${top}/` },
    ...dirs.map((d) => ({ path: `${top}/${d.path}/` })),
    ...files.map((f) => ({ path: `${top}/${f.path}`, file: f })),
  ];
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    if (!e.file) {
      parts.push(header(e.path, "5", 0o755, 0));
      continue;
    }
    const data = new Uint8Array(await readFile(e.file.abs));
    parts.push(header(e.path, "0", e.file.exec ? 0o755 : 0o644, data.length), data);
    if (data.length % BLOCK) parts.push(new Uint8Array(BLOCK - (data.length % BLOCK)));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  return Buffer.concat(parts);
}

/** gzip without a name, with mtime 0 and the OS byte 255, so the bytes do not depend on the machine. */
export function gzip(data: Uint8Array): Uint8Array {
  const gz = new Uint8Array(gzipSync(data, { level: 9 }));
  gz.set([0, 0, 0, 0], 4);
  gz[9] = 255;
  return gz;
}

/** The package tarball of `dir`: `gzip(tar(dir, top))`. */
export const tarball = async (dir: string, top: string) => gzip(await tar(dir, top));
