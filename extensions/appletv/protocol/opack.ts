// OPACK, Apple's compact binary format that every Companion message rides
// in: a port of pyatv's `support/opack.py`, back-references included
// (0xA0..0xC4 point at an earlier value; the Apple TV uses them, and
// node-appletv-remote's decoder does not, so its `_systemInfo` reply failed).
// Dicts decode to plain objects when every key is a string, else to a Map;
// a whole float that must stay a float is written as `float(n)`, a UUID as
// `Uuid`, and `sized(n, bytes)` keeps an integer's width.

/** A 16-byte UUID (OPACK 0x05). */
export class Uuid {
  constructor(readonly bytes: Uint8Array) { if (bytes.length !== 16) throw new Error("A UUID is 16 bytes"); }
  static parse(s: string): Uuid { return new Uuid(Buffer.from(s.replace(/[{}-]/g, ""), "hex")); }
  toString(): string { const h = Buffer.from(this.bytes).toString("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; }
}
/** A number written as a float64 even when it is whole. */
export class Float { constructor(readonly value: number) {} }
/** An integer written with a fixed width (1, 2, 4 or 8 bytes), as some fields are on the wire. */
export class Sized { constructor(readonly value: number | bigint, readonly size: 1 | 2 | 4 | 8) {} }
export const float = (n: number) => new Float(n);
export const sized = (n: number | bigint, size: 1 | 2 | 4 | 8) => new Sized(n, size);

const isBytes = (v: unknown): v is Uint8Array => v instanceof Uint8Array;
/** Little-endian `n` in exactly `size` bytes. */
const leN = (n: number | bigint, size: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b.subarray(0, size); };

/** The identity a value is shared under, as Python's `==` compares them: numbers by value, bytes by content. */
function identity(v: unknown): string | undefined {
  if (typeof v === "string") return `s${v}`;
  if (typeof v === "number" || typeof v === "bigint") return `n${String(v)}`;
  if (v instanceof Float) return `n${v.value}`;
  if (v instanceof Sized) return `n${String(v.value)}`;
  if (v instanceof Uuid) return `u${v.toString()}`;
  if (isBytes(v)) return `b${Buffer.from(v).toString("hex")}`;
  return undefined;
}

function packInt(n: number | bigint, size?: number): Buffer {
  const v = BigInt(n);
  if (v < 0n) throw new TypeError("OPACK has no negative integers");
  if (v < 0x28n && !size) return Buffer.from([Number(v) + 8]);
  const w = size ?? (v <= 0xffn ? 1 : v <= 0xffffn ? 2 : v <= 0xffffffffn ? 4 : 8);
  return Buffer.concat([Buffer.from([0x30 + Math.log2(w)]), leN(v, w)]);
}

/** A long string's or bytes' header: the first tag whose length field (`widths`, bytes) holds `len`, then the length. */
function packLen(len: number, tags: number[], widths: number[]): Buffer {
  for (const [i, w] of widths.entries()) if (len < 2 ** (8 * w)) return Buffer.concat([Buffer.from([tags[i]]), leN(len, w)]);
  throw new TypeError("OPACK value too long");
}

/** Encodes a value; shared strings, bytes, numbers and UUIDs become references to their first occurrence. */
export function pack(data: unknown): Buffer {
  const seen: string[] = [];
  const go = (v: unknown): Buffer => {
    let out: Buffer;
    let shareable = true;
    if (v === null || v === undefined) { out = Buffer.from([0x04]); shareable = false; }
    else if (typeof v === "boolean") { out = Buffer.from([v ? 1 : 2]); shareable = false; }
    else if (v instanceof Uuid) out = Buffer.concat([Buffer.from([0x05]), Buffer.from(v.bytes)]);
    else if (v instanceof Float) { out = Buffer.alloc(9); out[0] = 0x36; out.writeDoubleLE(v.value, 1); }
    else if (v instanceof Sized) out = packInt(v.value, v.size);
    else if (typeof v === "bigint") out = packInt(v);
    else if (typeof v === "number") {
      if (Number.isInteger(v) && v >= 0) out = packInt(v);
      else { out = Buffer.alloc(9); out[0] = 0x36; out.writeDoubleLE(v, 1); }
    } else if (typeof v === "string") {
      const s = Buffer.from(v, "utf8");
      out = s.length <= 0x20 ? Buffer.concat([Buffer.from([0x40 + s.length]), s]) : Buffer.concat([packLen(s.length, [0x61, 0x62, 0x63, 0x64], [1, 2, 3, 4]), s]);
    } else if (isBytes(v)) {
      const b = Buffer.from(v);
      out = b.length <= 0x20 ? Buffer.concat([Buffer.from([0x70 + b.length]), b]) : Buffer.concat([packLen(b.length, [0x91, 0x92, 0x93, 0x94], [1, 2, 4, 8]), b]);
    } else if (Array.isArray(v)) {
      out = Buffer.concat([Buffer.from([0xd0 + Math.min(v.length, 0xf)]), ...v.map(go), ...(v.length >= 0xf ? [Buffer.from([0x03])] : [])]);
      shareable = false;
    } else if (v instanceof Map || typeof v === "object") {
      const entries = v instanceof Map ? [...v.entries()] : Object.entries(v as object);
      out = Buffer.concat([Buffer.from([0xe0 + Math.min(entries.length, 0xf)]), ...entries.flatMap(([k, x]) => [go(k), go(x)]), ...(entries.length >= 0xf ? [Buffer.from([0x03])] : [])]);
      shareable = false;
    } else throw new TypeError(`OPACK cannot hold ${typeof v}`);
    if (!shareable) return out;
    const id = identity(v)!;
    const i = seen.indexOf(id);
    if (i >= 0) {
      if (i < 0x21) return Buffer.from([0xa0 + i]);
      // 0xC1..0xC4 carry the index in 1..4 bytes, as the decoder (and the Apple TV) read them.
      const w = i <= 0xff ? 1 : i <= 0xffff ? 2 : i <= 0xffffff ? 3 : 4;
      return Buffer.concat([Buffer.from([0xc0 + w]), leN(i, w)]);
    }
    if (out.length > 1) seen.push(id);
    return out;
  };
  return go(data);
}

const readInt = (b: Buffer, at: number, size: number): number | bigint => {
  const v = size === 8 ? b.readBigUInt64LE(at) : BigInt(b.readUIntLE(at, size));
  return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
};

/** Decodes one value; `rest` is what follows it. */
export function unpack(data: Uint8Array): { value: unknown; rest: Buffer } {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const objects: unknown[] = [];
  const ids: string[] = [];
  let at = 0;
  const go = (): unknown => {
    if (at >= buf.length) throw new RangeError("OPACK: data ended early");
    const t = buf[at++];
    let value: unknown;
    let add = true;
    if (t === 0x01 || t === 0x02) { value = t === 0x01; add = false; }
    else if (t === 0x04) { value = null; add = false; }
    else if (t === 0x05) { value = new Uuid(Uint8Array.from(buf.subarray(at, at + 16))); at += 16; }
    else if (t === 0x06) { value = readInt(buf, at, 8); at += 8; } // absolute time, as pyatv: the raw integer
    else if (t >= 0x08 && t <= 0x2f) { value = t - 8; add = false; }
    else if (t === 0x35) { value = buf.readFloatLE(at); at += 4; }
    else if (t === 0x36) { value = buf.readDoubleLE(at); at += 8; }
    else if ((t & 0xf0) === 0x30) { const n = 2 ** (t & 0xf); value = readInt(buf, at, n); at += n; }
    else if (t >= 0x40 && t <= 0x60) { const n = t - 0x40; value = buf.toString("utf8", at, at + n); at += n; }
    else if (t > 0x60 && t <= 0x64) { const w = t & 0xf, n = Number(readInt(buf, at, w)); at += w; value = buf.toString("utf8", at, at + n); at += n; }
    else if (t >= 0x70 && t <= 0x90) { const n = t - 0x70; value = Buffer.from(buf.subarray(at, at + n)); at += n; }
    else if (t >= 0x91 && t <= 0x94) { const w = 1 << ((t & 0xf) - 1), n = Number(readInt(buf, at, w)); at += w; value = Buffer.from(buf.subarray(at, at + n)); at += n; }
    else if ((t & 0xf0) === 0xd0) {
      const count = t & 0xf, out: unknown[] = [];
      if (count === 0xf) { while (buf[at] !== 0x03) out.push(go()); at++; } else for (let i = 0; i < count; i++) out.push(go());
      value = out; add = false;
    } else if ((t & 0xe0) === 0xe0) {
      const count = t & 0xf, pairs: [unknown, unknown][] = [];
      const one = () => { const k = go(); pairs.push([k, go()]); };
      if (count === 0xf) { while (buf[at] !== 0x03) one(); at++; } else for (let i = 0; i < count; i++) one();
      value = pairs.every(([k]) => typeof k === "string") ? Object.fromEntries(pairs) : new Map(pairs);
      add = false;
    } else if (t >= 0xa0 && t <= 0xc0) { value = ref(t - 0xa0); add = false; }
    else if (t >= 0xc1 && t <= 0xc4) { const w = t - 0xc0; const i = Number(readInt(buf, at, w)); at += w; value = ref(i); add = false; }
    else throw new TypeError(`OPACK: unknown tag 0x${t.toString(16)}`);
    if (add) { const id = identity(value); if (id !== undefined && !ids.includes(id)) { ids.push(id); objects.push(value); } }
    return value;
  };
  const ref = (i: number) => { if (i >= objects.length) throw new RangeError(`OPACK: reference ${i} to nothing`); return objects[i]; };
  const value = go();
  return { value, rest: buf.subarray(at) };
}

/** Decodes a whole buffer holding one value. */
export const decode = (data: Uint8Array): unknown => unpack(data).value;
