// tabs.ts, the pure half: the page identity two tabs share, Firefox's
// mozlz4 session file (compressed here by hand: literals, one 16-byte
// match, literals, so the decoder's copy path runs), the Automation
// refusal. The sources and the operations run against fakes in
// extensions/browser-tabs.test.ts and quicklinks.test.ts.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lz4Block, mozlz4, notAuthorized, samePage } from "../../sdk/src/tabs.ts";

describe("tabs", () => {
  test("samePage: the origin and path, no query or fragment, no trailing slash, lower-cased", () => {
    expect(samePage("https://GitHub.com/zcag/pal/?tab=x#top")).toBe("https://github.com/zcag/pal");
    expect(samePage("https://github.com/zcag/pal")).toBe(samePage("https://github.com/zcag/pal/"));
    expect(samePage("not a url")).toBe("not a url");
  });

  test("lz4Block and mozlz4: literals, a back-reference, the size header, the magic", () => {
    const text = '{"a":{"url":"https://x.example/"},"b":{"url":"https://y.example/"}}';
    const src = Buffer.from(text, "utf8");
    const needle = Buffer.from('{"url":"https://');
    const p1 = src.indexOf(needle), p2 = src.indexOf(needle, p1 + 1);
    const lits = (n: number, m: number) => (n < 15 ? [(n << 4) | m] : [0xf0 | m, ...Array(Math.floor((n - 15) / 255)).fill(255), (n - 15) % 255]);
    const seq1 = Buffer.concat([Buffer.from(lits(p2, 12)), src.subarray(0, p2), Buffer.from([(p2 - p1) & 0xff, (p2 - p1) >> 8])]);
    const rest = src.subarray(p2 + 16);
    const block = Buffer.concat([seq1, Buffer.from(lits(rest.length, 0)), rest]);
    expect(Buffer.from(lz4Block(block, src.length)).toString("utf8")).toBe(text);
    const dir = mkdtempSync(join(tmpdir(), "pal-mozlz4-"));
    try {
      const size = Buffer.alloc(4);
      size.writeUInt32LE(src.length);
      const file = join(dir, "recovery.jsonlz4");
      writeFileSync(file, Buffer.concat([Buffer.from("mozLz40\0", "latin1"), size, block]));
      expect(mozlz4(file)).toBe(text);
      const bad = join(dir, "bad.jsonlz4");
      writeFileSync(bad, "not compressed");
      expect(() => mozlz4(bad)).toThrow("not a mozlz4 file");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("notAuthorized: the Automation refusal in its three spellings", () => {
    expect(notAuthorized("execution error: Not authorized to send Apple events to Safari. (-1743)")).toBe(true);
    expect(notAuthorized("Not permitted to send Apple events")).toBe(true);
    expect(notAuthorized("osascript exited 1")).toBe(false);
  });
});
