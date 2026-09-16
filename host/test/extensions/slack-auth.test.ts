// The Slack extension's two extractions against files this test builds:
// a real-shaped LevelDB (an SSTable with a snappy-packed data block, its
// index block and footer; a write-ahead log with a full record and one
// fragmented across the 32 KB block boundary) and a Chromium cookie jar
// (SQLite, AES-128-CBC under the PBKDF2 key, with and without the 32-byte
// host hash newer Chromium prefixes). The builders are exported for the
// host test, which points `PAL_SLACK_APP_DIR` at a directory made of them
// (the builders are `slack-fixtures.ts`).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localConfig } from "../../../extensions/slack/auth.ts";
import { decrypt, derive, encrypt, encryptedCookie } from "../../../extensions/slack/cookies.ts";
import { latest, localStorageText, log, snappy, sstable } from "../../../extensions/slack/leveldb.ts";
import { buildAppDir, buildJar, buildLog, buildSSTable, bytes, lsKey, lsValue, snappyEncode, u32, u64 } from "./slack-fixtures.ts";

// ---- tests -------------------------------------------------------------------------------

const KEY = lsKey("https://app.slack.com", "localConfig_v2");
const config = { teams: { T1: { id: "T1", name: "Acme", domain: "acme", token: "xoxc-1-" + "a".repeat(100), user_id: "U_ME" } } };

describe("slack: leveldb", () => {
  test("snappy: literals, a short and a long back reference, round trip", () => {
    const text = new TextEncoder().encode("abcd".repeat(40) + "tail" + "wxyz".repeat(5));
    const packed = snappyEncode(text);
    expect(packed.length).toBeLessThan(text.length);
    expect([...snappy(packed)]).toEqual([...text]);
    expect(() => snappy(new Uint8Array([4, 0x0d, 0x00]))).toThrow(/back reference/);
  });

  test("sstable: a snappy data block reached through the index, keys with the sequence suffix stripped", () => {
    const value = lsValue(JSON.stringify(config));
    const t = buildSSTable([{ key: KEY, value, seq: 7 }, { key: lsKey("https://app.slack.com", "zzz"), value: lsValue("z"), seq: 8 }]);
    const recs = [...sstable(t)];
    expect(recs.map((r) => new TextDecoder("latin1").decode(r.key))).toEqual([KEY, lsKey("https://app.slack.com", "zzz")]);
    expect(recs[0].seq).toBe(7n);
    expect(localStorageText(recs[0].value)).toBe(JSON.stringify(config));
    // A plain block reads the same; a file without the magic is nothing.
    expect([...sstable(buildSSTable([{ key: KEY, value, seq: 7 }], false))]).toHaveLength(1);
    expect([...sstable(new Uint8Array(100))]).toEqual([]);
  });

  test("log: a full record, a record split across the block boundary, deletes skipped, sequences per put", () => {
    const one = buildLog([{ seq: 3, puts: [{ key: "a", value: lsValue("1") }, { key: "b", value: lsValue("2") }] }]);
    expect([...log(one)].map((r) => [new TextDecoder().decode(r.key), r.seq])).toEqual([["a", 3n], ["b", 4n]]);
    const big = new Uint8Array(3000).fill(0x42);
    const split = buildLog([{ seq: 9, puts: [{ key: KEY, value: lsValue("first") }] }, { seq: 20, puts: [{ key: KEY, value: bytes([1], big) }] }], true);
    expect(split.length).toBeGreaterThan(32768);
    const recs = [...log(split)];
    expect(recs.map((r) => r.seq)).toEqual([9n, 20n]);
    expect(recs[1].value.length).toBe(3001);
    // A delete (kind 0) carries no value and is not a record.
    const del = bytes(u32(0), [15, 0, 1], u64(5n), u32(1), [0, 1], "k");
    expect([...log(del)]).toEqual([]);
  });

  test("latest: the newest write of the key wins across ldb and log, by sequence, and the app dir reads through a copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "pal-slack-t-"));
    try {
      buildAppDir(dir, config, "xoxd-x", derive("pw", 1003));
      const v = latest(join(dir, "Local Storage/leveldb"), new TextEncoder().encode("localConfig_v2"));
      expect(JSON.parse(localStorageText(v!))).toEqual(config);
      expect(localConfig(dir).teams?.T1?.token).toBe(config.teams.T1.token);
      // A UTF-16 value (encoding byte 0) decodes too.
      writeFileSync(join(dir, "Local Storage/leveldb/000010.log"), buildLog([{ seq: 99, puts: [{ key: KEY, value: lsValue("{\"teams\":{}}", true) }] }]));
      expect(localConfig(dir)).toEqual({ teams: {} });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("slack: cookies", () => {
  test("derive is 16 bytes of PBKDF2-SHA1 over saltysalt; encrypt/decrypt round-trip with and without the host hash", () => {
    const key = derive("pw", 1003);
    expect(key.length).toBe(16);
    expect(derive("pw", 1003).equals(key)).toBe(true);
    expect(derive("peanuts", 1).equals(key)).toBe(false);
    const d = "xoxd-abc%2Fdef%3D";
    expect(decrypt(encrypt(d, key), key)).toBe(d);
    expect(decrypt(encrypt(d, key, createHash("sha256").update(".slack.com").digest()), key)).toBe(d);
    expect(() => decrypt(encrypt(d, key), derive("other", 1003))).toThrow();
    expect(() => decrypt(new Uint8Array([0x76, 0x39, 0x39, 1, 2]), key)).toThrow(/prefix/);
  });

  test("the jar is read through a copy and the cookie found by host and name", () => {
    const dir = mkdtempSync(join(tmpdir(), "pal-slack-j-"));
    try {
      const key = derive("pw", 1003);
      buildJar(join(dir, "Cookies"), "xoxd-1", key);
      const raw = encryptedCookie(join(dir, "Cookies"), ".slack.com", "d")!;
      expect(new TextDecoder("latin1").decode(raw.subarray(0, 3))).toBe("v10");
      expect(decrypt(raw, key)).toBe("xoxd-1");
      expect(encryptedCookie(join(dir, "Cookies"), ".slack.com", "b")).toBeUndefined();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
