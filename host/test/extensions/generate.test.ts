// generate: the pure generators and the QR encoder first (gen.ts, qr.ts),
// then the palette over the wire: the empty listing, the mode words, the
// transforms on typed text and on the clipboard, the QR and JWT rows, the
// effects. The QR matrices were also compared against segno (Python) and
// decoded by Apple's Vision framework by hand (versions 1 to 39); the
// golden matrix below is one of those.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { base64, base64Decode, base64url, entropy, hash, hexDecode, jwtDecode, loremParagraphs, loremWords, nanoid, passphrase, password, randInt, randomColor, randomNumber, strength, ulid, urlDecode, urlEncode, utf8Hex, uuid7, WORDS } from "../../../extensions/generate/gen.ts";
import { capacity, encode, toDataUrl, toSvg, versionFor } from "../../../extensions/generate/qr.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Item } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE5MDAwMDAwMDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("gen", () => {
  test("uuid v7 carries the time in its first 48 bits, the version and variant nibbles set; ulid and nanoid have their alphabets and lengths", () => {
    const at = Date.UTC(2026, 8, 16, 12, 0, 0);
    const u = uuid7(at);
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(u.replace(/-/g, "").slice(0, 12), 16)).toBe(at);
    expect(uuid7(at) < uuid7(at + 1000)).toBe(true);
    const l = ulid(at);
    expect(l).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(ulid(at).slice(0, 10)).toBe(l.slice(0, 10));
    expect(ulid(at) < ulid(at + 1000)).toBe(true);
    expect(nanoid()).toMatch(/^[A-Za-z0-9_-]{21}$/);
    expect(nanoid(8)).toHaveLength(8);
  });

  test("randInt is within range; randomNumber is inclusive at both ends; a colour is six hex digits", () => {
    for (let i = 0; i < 200; i++) expect(randInt(3)).toBeLessThan(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(randomNumber(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
    expect(randomColor()).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("a password has the length asked and, at full or alnum, one of each class; the entropy scale", () => {
    for (let i = 0; i < 30; i++) {
      const p = password(12, "full");
      expect(p).toHaveLength(12);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[^a-zA-Z0-9]/);
    }
    expect(password(6, "digits")).toMatch(/^\d{6}$/);
    expect(password(8, "letters")).toMatch(/^[a-zA-Z]{8}$/);
    expect(entropy(20, 86)).toBe(129);
    expect(strength(20).label).toBe("weak");
    expect(strength(40).label).toBe("fair");
    expect(strength(70)).toEqual({ bits: 70, label: "good", color: "blue" });
    expect(strength(100).label).toBe("strong");
    expect(strength(129).label).toBe("very strong");
  });

  test("a passphrase is n words off the list, joined by the separator; the list is the 2551 five-letter words", () => {
    expect(WORDS).toHaveLength(2551);
    expect(WORDS.every((w) => /^[a-z]{5}$/.test(w))).toBe(true);
    const p = passphrase(4, " ");
    const words = p.split(" ");
    expect(words).toHaveLength(4);
    expect(words.every((w) => WORDS.includes(w))).toBe(true);
    expect(passphrase(3).split("-")).toHaveLength(3);
  });

  test("hashes match the known digests; base64, base64url, hex and url encode and decode; a decode that is not one answers undefined", () => {
    expect(hash("sha256", "hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(hash("md5", "hi")).toBe("49f68a5c8493ec2c0bf489821c21fc3b");
    expect(hash("sha1", "abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
    expect(hash("sha512", "")).toMatch(/^cf83e1357eefb8bd/);
    expect(base64("hello")).toBe("aGVsbG8=");
    expect(base64url("??>")).toBe("Pz8-");
    expect(base64Decode("aGVsbG8=")).toBe("hello");
    expect(base64Decode("aGVsbG8")).toBe("hello");
    expect(base64Decode("Pz8-")).toBe("??>");
    expect(base64Decode("hello")).toBeUndefined();
    expect(base64Decode("not base64!")).toBeUndefined();
    expect(base64Decode("a")).toBeUndefined();
    expect(utf8Hex("hi")).toBe("6869");
    expect(hexDecode("68 65 6c 6c 6f")).toBe("hello");
    expect(hexDecode("6")).toBeUndefined();
    expect(hexDecode("zz")).toBeUndefined();
    expect(urlEncode("a b&c=d/é")).toBe("a%20b%26c%3Dd%2F%C3%A9");
    expect(urlDecode("a%20b%26c")).toBe("a b&c");
    expect(urlDecode("a+b")).toBe("a b");
    expect(urlDecode("plain")).toBeUndefined();
    expect(urlDecode("%zz")).toBeUndefined();
  });

  test("lorem: the word count asked, the classic opening, sentences ending in a full stop; paragraphs separated by a blank line", () => {
    const w = loremWords(25);
    expect(w.split(" ")).toHaveLength(25);
    expect(w.startsWith("Lorem ipsum dolor sit amet,")).toBe(true);
    expect(w.endsWith(".")).toBe(true);
    expect(loremParagraphs(3).split("\n\n")).toHaveLength(3);
    expect(loremWords(1)).toBe("Lorem.");
  });

  test("a JWT decodes to its header and payload, never verified; junk and a two-part token are not JWTs", () => {
    const j = jwtDecode(JWT)!;
    expect(j.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(j.payload).toMatchObject({ sub: "1234567890", name: "John Doe", iat: 1516239022, exp: 1900000000 });
    expect(j.signature).toBe("SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    expect(jwtDecode("a.b")).toBeUndefined();
    expect(jwtDecode("not.a.jwt")).toBeUndefined();
    expect(jwtDecode(`${JWT.split(".")[0]}.${Buffer.from("[1]").toString("base64url")}.x`)).toBeUndefined();
  });
});

describe("qr", () => {
  test("capacities are the standard's byte-mode figures; the version is the smallest that fits", () => {
    expect(capacity(1, "M")).toBe(14);
    expect(capacity(1, "L")).toBe(17);
    expect(capacity(10, "M")).toBe(213);
    expect(capacity(40, "L")).toBe(2953);
    expect(versionFor(14, "M")).toBe(1);
    expect(versionFor(15, "M")).toBe(2);
    expect(versionFor(2954, "L")).toBeUndefined();
    expect(() => encode("x".repeat(3000))).toThrow(/do not fit/);
  });

  test("a v2 code matches the matrix segno produces and Vision decodes (byte mode, level M, mask 2)", () => {
    const qr = encode("Ünïcödé 日本語 🎉", { mask: 2, boost: false });
    expect([qr.version, qr.ecl, qr.mask, qr.size]).toEqual([2, "M", 2, 25]);
    expect(qr.modules.map((r) => r.map((b) => (b ? "1" : "0")).join(""))).toEqual([
      "1111111001011100001111111", "1000001001000010001000001", "1011101011001101101011101", "1011101011101110101011101", "1011101010010101001011101",
      "1000001011100000001000001", "1111111010101010101111111", "0000000011001100100000000", "1011111001101101001111100", "1101100000001100101110100",
      "0010011001110100101001111", "0010000010001101110100101", "1100001000001001000011010", "1111000111001110000101011", "1001011100000110100010100",
      "1010110100001000111101110", "1001111101111101111111101", "0000000011101000100010101", "1111111001111001101010110", "1000001011110101100010000",
      "1011101011111110111111100", "1011101010001011101111011", "1011101010110000000010101", "1000001001110101101110101", "1111111010110000101001011",
    ]);
  });

  test("every version draws: the three finders, the size, a mask in range; the level boosts when the version has room", () => {
    for (const n of [1, 20, 100, 500, 1500, 2900]) {
      const qr = encode("a".repeat(n), { ecl: "L" });
      expect(qr.size).toBe(qr.version * 4 + 17);
      expect(qr.mask).toBeGreaterThanOrEqual(0);
      expect(qr.mask).toBeLessThan(8);
      const finder = (x: number, y: number) => [0, 1, 2, 3, 4, 5, 6].map((dx) => (qr.modules[y][x + dx] ? "1" : "0")).join("");
      expect(finder(0, 0)).toBe("1111111");
      expect(finder(qr.size - 7, 0)).toBe("1111111");
      expect(finder(0, qr.size - 7)).toBe("1111111");
      expect(finder(0, 3)).toBe("1011101");
    }
    expect(encode("HELLO").ecl).toBe("H");
    expect(encode("HELLO", { boost: false }).ecl).toBe("M");
    expect(encode("HELLO", { ecl: "L" }).ecl).toBe("H");
    expect(encode("x".repeat(17), { ecl: "L" })).toMatchObject({ version: 1, ecl: "L" });
  });

  test("the svg is one path on a white square with a four-module quiet zone; the data url is base64 svg", () => {
    const qr = encode("hi");
    const svg = toSvg(qr);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 29 29" width="224" height="224" shape-rendering="crispEdges"><rect width="29" height="29" fill="#fff"\/><path d="M/);
    expect(svg.match(/h1v1h-1z/g)!.length).toBe(qr.modules.flat().filter(Boolean).length);
    expect(toDataUrl(svg)).toMatch(/^data:image\/svg\+xml;base64,PHN2Zy/);
  });
});

let host: Host;
let clipboardText: string | null = "hello world";
beforeAll(async () => {
  host = await Host.bundled({ core: { "clipboard.list": () => (clipboardText === null ? [] : [{ id: 1, kind: "text", text: clipboardText, image: null, files: null, source_app: null, at: 1, bytes: 1, pinned: false, width: null, height: null }]) } });
});
afterAll(() => host.kill());

const list = (q?: string) => host.list("generate", "generate", q);
const pick = (id: string, action?: string) => host.pick("generate", "generate", id, action);
const ids = (items: Item[]) => items.map((i) => i.id);

describe("generate", () => {
  test("meta: an input palette with the amber dice tile and a placeholder that says what to type; the manifest and the code agree", () => {
    const l = host.loaded().find((l) => l.extension === "generate")!;
    expect(l.warnings).toEqual([]);
    expect(l.palettes[0]).toMatchObject({ name: "generate", title: "Generate", input: true, live: false, icon: tile("amber", "\u{f076e}") });
    expect(l.palettes[0].placeholder).toContain("sha256 <text>");
  });

  test("the empty query: a fresh value of every generator with Copy and Paste, the secrets with a strength tag, the colour with the picker, then the transform hints", async () => {
    const items = await list("");
    expect(ids(items)).toEqual(["uuid4", "uuid7", "ulid", "nanoid", "password", "passphrase", "number", "hex", "bytes", "lorem", "colour", "hint:hash", "hint:encode", "hint:qr", "hint:jwt"]);
    expect(items[0].name).toMatch(/^[0-9a-f-]{36}$/);
    expect(items[0].actions).toEqual([{ id: "copy", title: "Copy" }, { id: "paste", title: "Paste" }]);
    expect(items[0].detail!.markdown).toContain(items[0].name);
    expect(items[4]).toMatchObject({ subtitle: "Password, 20 characters, letters, digits and symbols", accessories: [{ tag: "very strong", color: "teal" }, { text: "129 bits" }] });
    expect(items[4].name).toHaveLength(20);
    expect(items[5].accessories).toEqual([{ tag: "fair", color: "amber" }, { text: "57 bits" }]);
    expect(items[5].name.split("-")).toHaveLength(5);
    expect(Number(items[6].name)).toBeGreaterThanOrEqual(1);
    expect(items[7].name).toMatch(/^[0-9a-f]{32}$/);
    expect(items[9].subtitle).toMatch(/^Lorem ipsum, 1 paragraph, \d+ words$/);
    expect(items[10]).toMatchObject({ icon: items[10].name, actions: [{ id: "copy", title: "Copy" }, { id: "paste", title: "Paste" }, { id: "picker", title: "Open in Colour Picker", shortcut: "cmd+o" }] });
    expect(items[10].name).toMatch(/^#[0-9a-f]{6}$/);
    expect(items.slice(11).every((i) => i.actions!.length === 0)).toBe(true);
    // Every row has a glyph, an image or a swatch: nothing falls to its initial.
    expect(items.every((i) => i.icon)).toBe(true);
    // A second listing is a second set of values.
    expect((await list(""))[0].name).not.toBe(items[0].name);
  });

  test("mode words: password with a length and a charset, passphrase with a count, number with a range, dice, hex and bytes with a size, lorem in words or paragraphs, five colours", async () => {
    const pw = (await list("password 12 alnum"))[0];
    expect(pw.name).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(pw).toMatchObject({ subtitle: "Password, 12 characters, letters and digits", accessories: [{ tag: "good", color: "blue" }, { text: "71 bits" }] });
    await list("pw 300");
    expect(((await pick("password")).copy as string)).toHaveLength(256);
    expect((await list("passphrase 3"))[0].name.split("-")).toHaveLength(3);
    for (let i = 0; i < 20; i++) expect(Number((await list("number 5-6"))[0].name)).toBeGreaterThanOrEqual(5);
    expect((await list("number 5 to 6"))[0].subtitle).toBe("Random number, 5 to 6");
    expect((await list("number 10"))[0].subtitle).toBe("Random number, 1 to 10");
    expect((await list("dice"))[0].subtitle).toBe("Random number, 1 to 6");
    expect((await list("hex 4"))[0].name).toMatch(/^[0-9a-f]{8}$/);
    expect((await list("bytes 3"))[0].name).toMatch(/^[A-Za-z0-9+/]{4}$/);
    expect(ids(await list("lorem"))).toEqual(["lorem-words", "lorem", "lorem-3"]);
    expect((await list("lorem 7"))[0].name.split(" ")).toHaveLength(7);
    expect((await list("lorem 2 paragraphs"))[0].subtitle).toMatch(/^Lorem ipsum, 2 paragraphs, \d+ words$/);
    expect((await list("lorem 2p"))[0].subtitle).toMatch(/2 paragraphs/);
    expect(ids(await list("colour"))).toEqual(["colour-0", "colour-1", "colour-2", "colour-3", "colour-4"]);
    expect(ids(await list("uuid"))).toEqual(["uuid4", "uuid7"]);
  });

  test("no mode: the generators whose name or keyword has the words; nothing matching says how to pick a mode", async () => {
    expect(ids(await list("uu"))).toEqual(["uuid4", "uuid7"]);
    expect(ids(await list("random"))).toEqual(["uuid4", "number", "hex", "bytes", "colour"]);
    expect(ids(await list("time ordered"))).toEqual(["uuid7", "ulid"]);
    const none = await list("hello there");
    expect(none).toHaveLength(1);
    expect(none[0]).toMatchObject({ id: "hint:mode", name: "Pick a mode for “hello there”", actions: [] });
    expect(none[0].subtitle).toContain("sha256");
  });

  test("hashes: one digest for one algorithm, all four for hash with Copy all carrying every line", async () => {
    const one = await list("sha256 hello");
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ id: "sha256", name: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824", subtitle: "SHA256 of “hello”" });
    expect(one[0].actions!.map((a) => a.id)).toEqual(["copy", "paste"]);
    const all = await list("hash hi");
    expect(ids(all)).toEqual(["md5", "sha1", "sha256", "sha512"]);
    expect(all[0].actions!.map((a) => a.id)).toEqual(["copy", "paste", "copy_all"]);
    expect(await pick("md5")).toEqual({ copy: "49f68a5c8493ec2c0bf489821c21fc3b" });
    expect((await pick("sha1", "copy_all")).copy).toBe(`md5  49f68a5c8493ec2c0bf489821c21fc3b\nsha1  c22b5f9178342609428d6f51b2c5af4c0bde6a42\nsha256  ${hash("sha256", "hi")}\nsha512  ${hash("sha512", "hi")}`);
    expect(await pick("sha256", "paste")).toEqual({ paste: { text: hash("sha256", "hi") } });
  });

  test("encodings: what decodes comes first; encode gives every form; decode tries base64, hex, url and a JWT; hex with a number is random bytes", async () => {
    expect(ids(await list("base64 aGVsbG8="))).toEqual(["base64-decoded", "base64"]);
    expect((await list("base64 hello"))[0]).toMatchObject({ id: "base64", name: "aGVsbG8=", subtitle: "Base64 of “hello”" });
    expect((await list("b64url ??>"))[0]).toMatchObject({ id: "base64url", name: "Pz8-" });
    expect(ids(await list("url a%20b"))).toEqual(["url-decoded", "url"]);
    expect((await list("url a b"))[0]).toMatchObject({ id: "url", name: "a%20b" });
    expect(ids(await list("encode hi"))).toEqual(["base64", "base64url", "url", "hex-of"]);
    expect((await pick("url", "copy_all")).copy).toBe("Base64  aGk=\nBase64url  aGk\nURL encoded  hi\nHex  6869");
    expect(ids(await list("hex hello"))).toEqual(["hex-of"]);
    expect(ids(await list("hex 68656c6c6f"))).toEqual(["hex-decoded", "hex-of"]);
    expect((await list("hex 8"))[0].subtitle).toBe("Random hex, 8 bytes");
    expect(ids(await list("decode 6869"))).toEqual(["hex-decoded"]);
    expect(ids(await list(`decode ${JWT}`))).toEqual(["jwt-header", "jwt-payload", "jwt-exp", "jwt-iat", "hint:jwt-unverified"]);
    const bad = await list("decode !!!");
    expect(bad[0]).toMatchObject({ id: "hint:undecodable", actions: [] });
  });

  test("a transform with nothing typed works on the newest clipboard text; with an empty clipboard it says what to do", async () => {
    const r = await list("sha256");
    expect(r[0]).toMatchObject({ name: hash("sha256", "hello world"), subtitle: "SHA256 of the clipboard" });
    expect(host.coreCalls.filter((c) => c.method === "clipboard.list").pop()!.params).toEqual({ kind: "text", limit: 1 });
    expect((await list("base64"))[0]).toMatchObject({ name: "aGVsbG8gd29ybGQ=", subtitle: "Base64 of the clipboard" });
    clipboardText = null;
    expect((await list("md5"))[0]).toMatchObject({ id: "hint:nothing", name: "Nothing to md5", subtitle: "Type text after md5, or copy some first", actions: [] });
    expect((await list("qr"))[0].id).toBe("hint:nothing");
    clipboardText = "hello world";
  });

  test("qr: one row wearing the code as its icon, the version in the subtitle, the code large in the detail; Enter shows it, cmd+c copies the SVG, the text is copyable too", async () => {
    const [qr] = await list("qr https://pal.cagdas.io");
    expect(qr).toMatchObject({ id: "qr", name: "https://pal.cagdas.io", subtitle: "QR code of “https://pal.cagdas.io”: version 2, 25 × 25 modules, level M" });
    expect((qr.icon as { image: string }).image).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(qr.actions).toEqual([{ id: "show", title: "Show QR code" }, { id: "copy_svg", title: "Copy SVG", shortcut: "cmd+c" }, { id: "copy", title: "Copy text" }]);
    expect(qr.detail!.markdown).toMatch(/^!\[QR code\]\(data:image\/svg\+xml;base64,/);
    expect(qr.detail!.metadata).toEqual([{ label: "Text", value: "https://pal.cagdas.io" }, { label: "Version", value: "2 (25 × 25)" }, { label: "Error correction", value: "M" }, { label: "Bytes", value: "21" }]);
    const shown = await pick("qr", "show");
    expect(shown.show).toMatchObject({ title: "QR code" });
    expect((shown.show as { markdown: string }).markdown).toContain("`https://pal.cagdas.io`");
    expect((await pick("qr", "copy_svg")).copy).toMatch(/^<svg xmlns=/);
    expect(await pick("qr", "copy")).toEqual({ copy: "https://pal.cagdas.io" });
    const big = await list(`qr ${"x".repeat(3000)}`);
    expect(big[0]).toMatchObject({ id: "hint:qr-big", name: "Too long for a QR code", actions: [] });
  });

  test("jwt: header and payload rows with the expiry as a tag, a row per time claim, and the unverified reminder; Copy all is both parts", async () => {
    const rows = await list(`jwt ${JWT}`);
    expect(ids(rows)).toEqual(["jwt-header", "jwt-payload", "jwt-exp", "jwt-iat", "hint:jwt-unverified"]);
    expect(rows[0]).toMatchObject({ name: "Header: HS256, JWT", subtitle: '{"alg":"HS256","typ":"JWT"}', accessories: [{ text: "2 fields" }] });
    expect(rows[0].detail!.metadata).toEqual([{ label: "Algorithm", value: "HS256" }, { label: "Signature", value: "43 characters, not verified" }]);
    expect(rows[1].name).toBe("Payload: 1234567890");
    expect(rows[1].subtitle).toContain('"name":"John Doe"');
    expect(rows[1].accessories).toEqual([{ tag: expect.stringMatching(/^expires in \d+ y$/), color: "green" }, { text: "4 claims" }]);
    expect(rows[2]).toMatchObject({ name: "2030-03-17 17:46:40", accessories: [{ text: "1900000000" }] });
    expect(rows[2].subtitle).toMatch(/^Expires \(exp\), in \d+ y$/);
    expect(rows[3].subtitle).toMatch(/^Issued \(iat\), \d+ y ago$/);
    expect(rows[4]).toMatchObject({ name: "Signature not verified", actions: [] });
    expect((await pick("jwt-header")).copy).toBe('{\n  "alg": "HS256",\n  "typ": "JWT"\n}');
    expect((await pick("jwt-payload", "copy_all")).copy).toContain('"name": "John Doe"');
    const expired = Buffer.from(JSON.stringify({ sub: "x", exp: 1000000000 })).toString("base64url");
    const old = await list(`jwt ${JWT.split(".")[0]}.${expired}.sig`);
    expect(old[1].accessories![0]).toEqual({ tag: expect.stringMatching(/^expired \d+ y ago$/), color: "red" });
    expect((await list("jwt nope"))[0]).toMatchObject({ id: "hint:jwt-bad", name: "Not a JWT", actions: [] });
  });

  test("the colour row opens the Colors picker on cmd+o with its hex; Enter copies; an id from an older listing is a failure toast that keeps the panel", async () => {
    const [c] = await list("colour");
    expect(await pick("colour-0", "picker")).toEqual({ push: { extension: "colors", palette: "picker", args: { color: c.name, from: "typed" } } });
    expect(await pick("colour-0")).toEqual({ copy: c.name });
    await list("uuid");
    expect(await pick("colour-0")).toEqual({ keep: true, toast: { title: "Value is gone", message: "The listing changed; pick again", style: "failure" } });
  });

  test("settings: the password length and charset and the passphrase words and separator come from the file", async () => {
    host.changeSettings("generate", { settings: { password_length: 8, password_charset: "digits", passphrase_words: 3, passphrase_separator: " " } });
    const items = await list("");
    expect(items[4].name).toMatch(/^\d{8}$/);
    expect(items[4].subtitle).toBe("Password, 8 characters, digits");
    expect(items[4].accessories![0]).toEqual({ tag: "weak", color: "red" });
    expect(items[5].name.split(" ")).toHaveLength(3);
    host.changeSettings("generate", {});
    expect((await list(""))[4].name).toHaveLength(20);
  });
});
