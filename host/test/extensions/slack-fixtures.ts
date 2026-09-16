// Builders for the Slack tests: a real-shaped LevelDB (an SSTable with a
// snappy-packed data block, its index block and footer; a write-ahead log
// with whole and fragmented records), a Chromium cookie jar (SQLite,
// AES-128-CBC under the PBKDF2 key, the 32-byte host hash in front), and a
// whole app directory made of both, which `PAL_SLACK_APP_DIR` points at.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encrypt } from "../../../extensions/slack/cookies.ts";

export const varint = (n: number): number[] => { const out: number[] = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
export const u32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
export const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(n); return [...b]; };
export const bytes = (...parts: (number[] | Uint8Array | string)[]) => Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));

/** A snappy encoder of the simplest kind: one literal, then back references wherever the previous 3 bytes repeat (enough to exercise every tag the decoder has). */
export function snappyEncode(src: Uint8Array): Uint8Array {
  const out: number[] = varint(src.length);
  const literal = (s: Uint8Array) => {
    if (!s.length) return;
    const n = s.length - 1;
    if (n < 60) out.push(n << 2);
    else if (n < 256) out.push(60 << 2, n);
    else out.push(61 << 2, n & 0xff, n >> 8);
    out.push(...s);
  };
  let i = 0, litStart = 0;
  while (i < src.length) {
    // A run of the same 4 bytes as 4 bytes back: a copy with offset 4.
    let len = 0;
    while (i + len < src.length && i - 4 >= 0 && src[i + len] === src[i + len - 4] && len < 64) len++;
    if (len >= 4) {
      literal(src.subarray(litStart, i));
      if (len <= 11) out.push(1 | ((len - 4) << 2) | ((4 >> 8) << 5), 4 & 0xff); // copy1, offset 4
      else out.push(2 | ((len - 1) << 2), 4, 0); // copy2
      i += len;
      litStart = i;
    } else i++;
  }
  literal(src.subarray(litStart));
  return new Uint8Array(out);
}

/** A block of prefix-compressed entries with a one-restart trailer. */
function block(entries: [Uint8Array, Uint8Array][]): Uint8Array {
  const out: number[] = [];
  let prev: Uint8Array = new Uint8Array(0);
  for (const [k, v] of entries) {
    let shared = 0;
    while (shared < prev.length && shared < k.length && prev[shared] === k[shared]) shared++;
    out.push(...varint(shared), ...varint(k.length - shared), ...varint(v.length), ...k.subarray(shared), ...v);
    prev = k;
  }
  out.push(...u32(0), ...u32(1));
  return new Uint8Array(out);
}

/** An SSTable of one data block (`compress` picks snappy or plain) holding `entries`, keyed with the leveldb suffix (sequence, put). */
export function buildSSTable(entries: { key: string; value: Uint8Array; seq: number }[], compress = true): Uint8Array {
  const data = block(entries.map((e) => [bytes(e.key, u64((BigInt(e.seq) << 8n) | 1n)), e.value]));
  const packed = compress ? snappyEncode(data) : data;
  const dataBlock = bytes(packed, [compress ? 1 : 0], u32(0));
  const handle = [...varint(0), ...varint(packed.length)];
  const lastKey = bytes(entries.at(-1)!.key, u64((BigInt(entries.at(-1)!.seq) << 8n) | 1n));
  const index = block([[lastKey, new Uint8Array(handle)]]);
  const indexOff = dataBlock.length;
  const indexBlock = bytes(index, [0], u32(0));
  const metaOff = indexOff + indexBlock.length;
  const meta = bytes(block([]), [0], u32(0));
  const footer = Buffer.alloc(48);
  const handles = [...varint(metaOff), ...varint(block([]).length), ...varint(indexOff), ...varint(index.length)];
  footer.set(handles, 0);
  footer.writeBigUInt64LE(0xdb4775248b80fb57n, 40);
  return bytes(dataBlock, indexBlock, meta, footer);
}

/** A write-ahead log: `batches` of puts, each at its sequence; with `splitSecond` the second batch is written as FIRST + LAST fragments across the 32 KB block boundary. */
export function buildLog(batches: { seq: number; puts: { key: string; value: Uint8Array }[] }[], splitSecond = false): Uint8Array {
  const chunks: number[] = [];
  const record = (kind: number, body: Uint8Array) => chunks.push(...u32(0), body.length & 0xff, body.length >> 8, kind, ...body);
  batches.forEach((b, j) => {
    const body = bytes(u64(BigInt(b.seq)), u32(b.puts.length), ...b.puts.flatMap((p) => [[1, ...varint(p.key.length)], p.key, varint(p.value.length), p.value] as (number[] | string | Uint8Array)[]));
    if (!(splitSecond && j === 1)) return record(1, body);
    // A filler batch (count 0) leaves 100 bytes in the block; the record's first 93 bytes end the block, the rest opens the next.
    record(1, bytes(u64(0n), u32(0), new Uint8Array(32768 - chunks.length - 7 - 100 - 12)));
    record(2, body.subarray(0, 93));
    if (chunks.length !== 32768) throw new Error(`test builder: block is ${chunks.length}`);
    record(4, body.subarray(93));
  });
  return new Uint8Array(chunks);
}

/** Chromium's Local Storage key for an origin's key, and its value with the encoding byte. */
export const lsKey = (origin: string, key: string) => `_${origin}\0\x01${key}`;
export const lsValue = (text: string, utf16 = false) => (utf16 ? bytes([0], Buffer.from(text, "utf16le")) : bytes([1], text));

/** A cookie jar with one `d` cookie for `.slack.com`, encrypted under `key`. */
export function buildJar(path: string, d: string, key: Buffer, hostHash = true) {
  const db = new Database(path);
  db.run("create table cookies (host_key text, name text, encrypted_value blob, value text)");
  db.run("insert into cookies values (?, ?, ?, '')", [".slack.com", "d", encrypt(d, key, hostHash ? createHash("sha256").update(".slack.com").digest() : undefined)]);
  db.close();
}

/** A whole app directory: Local Storage with the given `localConfig_v2` and a jar with the cookie. */
export function buildAppDir(dir: string, config: unknown, d: string, key: Buffer) {
  const ldb = join(dir, "Local Storage/leveldb");
  mkdirSync(ldb, { recursive: true });
  const stale = lsValue(JSON.stringify({ teams: {} }));
  writeFileSync(join(ldb, "000005.ldb"), buildSSTable([{ key: lsKey("https://app.slack.com", "localConfig_v2"), value: stale, seq: 10 }, { key: lsKey("https://app.slack.com", "other"), value: lsValue("x"), seq: 11 }]));
  writeFileSync(join(ldb, "000009.log"), buildLog([{ seq: 40, puts: [{ key: lsKey("https://app.slack.com", "localConfig_v2"), value: lsValue(JSON.stringify(config)) }] }]));
  writeFileSync(join(ldb, "LOCK"), "");
  buildJar(join(dir, "Cookies"), d, key);
}

