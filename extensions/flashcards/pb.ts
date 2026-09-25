// Just enough protobuf to read two formats that speak it: AnkiWeb's shared
// deck service (ankiweb.ts) and a 2.1.50+ deck's media index (apkg.ts).
// No schema: a message is its fields by number, a length-delimited field
// read as bytes, a string or a nested message as the caller knows it is.

export type Field = { no: number; wire: number; int?: number; bytes?: Uint8Array };

export function fields(b: Uint8Array): Field[] {
  const out: Field[] = [];
  let i = 0;
  const varint = () => { let v = 0, s = 0, x; do { x = b[i++]; v += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80 && i < b.length); return v; };
  while (i < b.length) {
    const tag = varint(), no = Math.floor(tag / 8), wire = tag & 7;
    if (wire === 0) out.push({ no, wire, int: varint() });
    else if (wire === 2) { const len = varint(); out.push({ no, wire, bytes: b.subarray(i, i + len) }); i += len; }
    else if (wire === 5) i += 4;
    else if (wire === 1) i += 8;
    else break;
  }
  return out;
}

const text = new TextDecoder();
/** The message's field `no` as a string, a number, a nested message, or every one of a repeated field. */
export const str = (m: Field[], no: number) => { const f = m.find((x) => x.no === no); return f?.bytes ? text.decode(f.bytes) : ""; };
export const int = (m: Field[], no: number) => m.find((x) => x.no === no)?.int ?? 0;
export const msg = (m: Field[], no: number) => { const f = m.find((x) => x.no === no); return f?.bytes ? fields(f.bytes) : []; };
export const all = (m: Field[], no: number) => m.filter((x) => x.no === no && x.bytes).map((x) => fields(x.bytes!));

/** Encoding, for tests that stand in for a server: field `no` as a varint or a length-delimited value. */
const varintBytes = (n: number) => { const o: number[] = []; while (n > 127) { o.push((n % 128) | 128); n = Math.floor(n / 128); } o.push(n); return o; };
export function encode(parts: [no: number, value: number | string | Uint8Array][]): Uint8Array {
  const out: number[] = [];
  for (const [no, v] of parts) {
    if (typeof v === "number") out.push(...varintBytes(no * 8), ...varintBytes(v));
    else { const b = typeof v === "string" ? new TextEncoder().encode(v) : v; out.push(...varintBytes(no * 8 + 2), ...varintBytes(b.length), ...b); }
  }
  return new Uint8Array(out);
}
