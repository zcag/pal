// A read-only LevelDB reader, enough to find one key in Chromium's Local
// Storage: the SSTables (`*.ldb`: footer, index block, data blocks, each
// block prefix-compressed and snappy-packed) and the write-ahead log
// (`*.log`: 32 KB blocks of fragments reassembled into write batches), since
// a value written after the last compaction is only in the log. No leveldb
// library, no dependency: snappy's raw format is forty lines below.
//
// Every record carries its sequence number (the 8-byte suffix of an SSTable
// key, the batch header in the log), so `latest` picks the newest write of a
// key across files instead of trusting file order.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

const SST_MAGIC = 0xdb4775248b80fb57n;
const FOOTER = 48;
const LOG_BLOCK = 32768;

export type Record = { key: Uint8Array; value: Uint8Array; seq: bigint };

const uvarint = (b: Uint8Array, i: number): [number, number] => {
  let r = 0, s = 0;
  for (;;) {
    const c = b[i++];
    if (c === undefined) throw new Error("leveldb: truncated varint");
    r += (c & 0x7f) * 2 ** s;
    if (!(c & 0x80)) return [r, i];
    s += 7;
  }
};

/** Snappy's raw (block) format: a varint length, then literals and back references. */
export function snappy(src: Uint8Array): Uint8Array {
  let [n, i] = uvarint(src, 0);
  const out = new Uint8Array(n);
  let o = 0;
  while (i < src.length) {
    const tag = src[i++];
    let len: number, off: number;
    switch (tag & 3) {
      case 0: {
        len = (tag >> 2) + 1;
        if (len > 60) {
          const bytes = len - 60;
          len = 0;
          for (let k = 0; k < bytes; k++) len |= src[i + k] << (8 * k);
          len = (len >>> 0) + 1;
          i += bytes;
        }
        out.set(src.subarray(i, i + len), o);
        i += len;
        o += len;
        continue;
      }
      case 1: len = ((tag >> 2) & 7) + 4; off = ((tag >> 5) << 8) | src[i]; i += 1; break;
      case 2: len = (tag >> 2) + 1; off = src[i] | (src[i + 1] << 8); i += 2; break;
      default: len = (tag >> 2) + 1; off = (src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24)) >>> 0; i += 4;
    }
    if (off === 0 || off > o) throw new Error("snappy: bad back reference");
    // Byte by byte: a reference may overlap what it is writing (a run).
    for (let k = 0; k < len; k++) out[o + k] = out[o - off + k];
    o += len;
  }
  if (o !== n) throw new Error(`snappy: wrote ${o} of ${n} bytes`);
  return out;
}

/** One block's bytes by its trailer byte: 0 plain, 1 snappy, 2 zlib, 4 zstd. */
function unpack(raw: Uint8Array, type: number): Uint8Array {
  switch (type) {
    case 0: return raw;
    case 1: return snappy(raw);
    case 2: return new Uint8Array(inflateSync(raw));
    case 4: return new Uint8Array(Bun.zstdDecompressSync(raw));
    default: throw new Error(`leveldb: unknown block compression ${type}`);
  }
}

/** The entries of one block: keys prefix-compressed against the previous one; the restart array at the end is an index we only need to stop before. */
function* entries(block: Uint8Array): Generator<[Uint8Array, Uint8Array]> {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const restarts = view.getUint32(block.length - 4, true);
  const end = block.length - 4 - 4 * restarts;
  let i = 0, key = new Uint8Array(0);
  while (i < end) {
    let shared: number, unshared: number, vlen: number;
    [shared, i] = uvarint(block, i);
    [unshared, i] = uvarint(block, i);
    [vlen, i] = uvarint(block, i);
    const k = new Uint8Array(shared + unshared);
    k.set(key.subarray(0, shared));
    k.set(block.subarray(i, i + unshared), shared);
    i += unshared;
    key = k;
    yield [k, block.subarray(i, i + vlen)];
    i += vlen;
  }
}

/** A block at `off` of `size` bytes, followed by its 5-byte trailer (type, crc). */
const block = (file: Uint8Array, off: number, size: number) => unpack(file.subarray(off, off + size), file[off + size]);

/** Every record of one SSTable, in file order. Not an SSTable (no magic) is nothing. */
export function* sstable(file: Uint8Array): Generator<Record> {
  if (file.length < FOOTER) return;
  const footer = file.subarray(file.length - FOOTER);
  const view = new DataView(footer.buffer, footer.byteOffset, footer.byteLength);
  if (view.getBigUint64(40, true) !== SST_MAGIC) return;
  let i = 0, off: number, size: number;
  [, i] = uvarint(footer, i); // metaindex handle: offset
  [, i] = uvarint(footer, i); // and size, unused
  [off, i] = uvarint(footer, i); // index handle
  [size] = uvarint(footer, i);
  for (const [, handle] of entries(block(file, off, size))) {
    const [boff, j] = uvarint(handle, 0);
    const [bsize] = uvarint(handle, j);
    for (const [k, v] of entries(block(file, boff, bsize))) {
      if (k.length < 8) continue;
      const tail = new DataView(k.buffer, k.byteOffset + k.length - 8, 8).getBigUint64(0, true);
      // The suffix packs (sequence << 8) | type; type 1 is a put, 0 a delete.
      if ((tail & 0xffn) !== 1n) continue;
      yield { key: k.subarray(0, k.length - 8), value: v, seq: tail >> 8n };
    }
  }
}

/** Every put of the write-ahead log: fragments (full, first, middle, last) reassembled into write batches, each batch a sequence and its records. */
export function* log(file: Uint8Array): Generator<Record> {
  const batches: Uint8Array[] = [];
  let pending: Uint8Array[] = [];
  for (let base = 0; base < file.length; base += LOG_BLOCK) {
    const blk = file.subarray(base, base + LOG_BLOCK);
    let i = 0;
    while (i + 7 <= blk.length) {
      const len = blk[i + 4] | (blk[i + 5] << 8), kind = blk[i + 6];
      if (kind === 0 || i + 7 + len > blk.length) break;
      const chunk = blk.subarray(i + 7, i + 7 + len);
      i += 7 + len;
      if (kind === 1) batches.push(chunk);
      else if (kind === 2) pending = [chunk];
      else if (kind === 3) pending.push(chunk);
      else if (kind === 4) { batches.push(Buffer.concat([...pending, chunk])); pending = []; }
    }
  }
  for (const rec of batches) {
    if (rec.length < 12) continue;
    const view = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
    const seq = view.getBigUint64(0, true), count = view.getUint32(8, true);
    let i = 12;
    for (let n = 0; n < count && i < rec.length; n++) {
      const kind = rec[i++];
      let klen: number, vlen: number;
      [klen, i] = uvarint(rec, i);
      const key = rec.subarray(i, i + klen);
      i += klen;
      if (kind !== 1) continue;
      [vlen, i] = uvarint(rec, i);
      yield { key, value: rec.subarray(i, i + vlen), seq: seq + BigInt(n) };
      i += vlen;
    }
  }
}

/** The newest value of the key ending in `suffix` across the `.ldb` and `.log` files of `dir`, by sequence number. */
export function latest(dir: string, suffix: Uint8Array): Uint8Array | undefined {
  let best: Record | undefined;
  const ends = (k: Uint8Array) => k.length >= suffix.length && suffix.every((b, i) => k[k.length - suffix.length + i] === b);
  for (const name of readdirSync(dir).sort()) {
    const kind = name.endsWith(".ldb") ? sstable : name.endsWith(".log") ? log : undefined;
    if (!kind) continue;
    for (const r of kind(new Uint8Array(readFileSync(join(dir, name))))) if (ends(r.key) && (!best || r.seq >= best.seq)) best = r;
  }
  return best?.value;
}

/** A Local Storage value as text: Chromium tags it with an encoding byte, 0 for UTF-16LE, 1 for Latin-1 (what a JSON string is). */
export const localStorageText = (v: Uint8Array): string => (v[0] === 0 ? new TextDecoder("utf-16le").decode(v.subarray(1)) : new TextDecoder("latin1").decode(v.subarray(1)));
