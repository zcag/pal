// The generators and transforms, pure: identifiers, secrets, random bytes,
// hashes, encodings, lorem ipsum, a colour, a JWT taken apart. Randomness
// is the platform's CSPRNG (`crypto.getRandomValues`), never Math.random.
import { createHash } from "node:crypto";
import wordsText from "./words.txt";

// ---- randomness -------------------------------------------------------------------

const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));

/** A uniform integer in [0, n), by rejection sampling over 32-bit draws. */
export function randInt(n: number): number {
  if (n <= 0 || n > 0x100000000) throw new RangeError(`randInt(${n})`);
  const limit = 0x100000000 - (0x100000000 % n);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

const pickFrom = (alphabet: string, n: number): string => {
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[randInt(alphabet.length)];
  return s;
};

// ---- identifiers ------------------------------------------------------------------

export const uuid4 = (): string => crypto.randomUUID();

const hex = (b: Uint8Array | number[]): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** RFC 9562 UUID v7: 48 bits of unix ms, the version and variant nibbles, 74 random bits. Sorts by time. */
export function uuid7(now = Date.now()): string {
  const b = randomBytes(16);
  let t = now;
  for (let i = 5; i >= 0; i--) { b[i] = t % 256; t = Math.floor(t / 256); }
  b[6] = 0x70 | (b[6] & 0x0f);
  b[8] = 0x80 | (b[8] & 0x3f);
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 10 characters of unix ms then 16 random ones, Crockford base32, 26 in all. Sorts by time. */
export function ulid(now = Date.now()): string {
  let t = now, time = "";
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  return time + pickFrom(CROCKFORD, 16);
}

const NANO_ALPHABET = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

/** A Nano ID: 21 characters from the 64-symbol url-safe alphabet, 126 bits. */
export const nanoid = (size = 21): string => pickFrom(NANO_ALPHABET, size);

// ---- secrets ------------------------------------------------------------------------

export type Charset = "full" | "alnum" | "letters" | "digits";
const LOWER = "abcdefghijklmnopqrstuvwxyz", UPPER = LOWER.toUpperCase(), DIGITS = "0123456789", SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/";
export const CHARSETS: Record<Charset, string> = { full: LOWER + UPPER + DIGITS + SYMBOLS, alnum: LOWER + UPPER + DIGITS, letters: LOWER + UPPER, digits: DIGITS };
export const CHARSET_TITLES: Record<Charset, string> = { full: "letters, digits and symbols", alnum: "letters and digits", letters: "letters", digits: "digits" };

/** A password of `length` from the charset; with `full` or `alnum` one of each class is guaranteed by redrawing (so `A1!` never goes missing). */
export function password(length: number, charset: Charset = "full"): string {
  const alphabet = CHARSETS[charset];
  const classes = charset === "full" ? [LOWER, UPPER, DIGITS, SYMBOLS] : charset === "alnum" ? [LOWER, UPPER, DIGITS] : [];
  for (let tries = 0; ; tries++) {
    const s = pickFrom(alphabet, length);
    if (length < classes.length || tries > 50 || classes.every((c) => [...s].some((ch) => c.includes(ch)))) return s;
  }
}

/** Bits of entropy of a uniform draw of `length` symbols from `alphabet` symbols. */
export const entropy = (length: number, alphabet: number): number => Math.round(length * Math.log2(alphabet));

type Strength = { bits: number; label: "weak" | "fair" | "good" | "strong" | "very strong"; color: "red" | "amber" | "blue" | "green" | "teal" };

/** What the bits mean, on the usual scale: under 36 weak, under 60 fair, under 80 good, under 128 strong. */
export function strength(bits: number): Strength {
  if (bits < 36) return { bits, label: "weak", color: "red" };
  if (bits < 60) return { bits, label: "fair", color: "amber" };
  if (bits < 80) return { bits, label: "good", color: "blue" };
  if (bits < 128) return { bits, label: "strong", color: "green" };
  return { bits, label: "very strong", color: "teal" };
}

/**
 * The passphrase words: the 2551 common five-letter words the bundled
 * Wordle draws its answers from (12dicts' 3esl and 6of12, public domain;
 * `extensions/wordle/build.ts` says how they were made). About 11.3 bits
 * a word, so five words are 56 bits, six 68.
 */
export const WORDS: readonly string[] = wordsText.trim().split("\n");

export const passphrase = (words: number, separator = "-"): string => Array.from({ length: words }, () => WORDS[randInt(WORDS.length)]).join(separator);

// ---- random values -----------------------------------------------------------------

/** A uniform integer in [lo, hi], both inclusive. */
export const randomNumber = (lo: number, hi: number): number => lo + randInt(hi - lo + 1);
export const randomHex = (bytes: number): string => hex(randomBytes(bytes));
export const randomBase64 = (bytes: number): string => Buffer.from(randomBytes(bytes)).toString("base64");

/** A random sRGB colour as `#rrggbb`. */
export const randomColor = (): string => `#${hex(randomBytes(3))}`;

export function rgbOf(hexColor: string): { r: number; g: number; b: number } {
  const n = parseInt(hexColor.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// ---- hashes and encodings ----------------------------------------------------------

export type HashAlgo = "md5" | "sha1" | "sha256" | "sha512";
export const HASHES: HashAlgo[] = ["md5", "sha1", "sha256", "sha512"];
export const hash = (algo: HashAlgo, text: string): string => createHash(algo).update(text, "utf8").digest("hex");

export const base64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");
export const base64url = (text: string): string => Buffer.from(text, "utf8").toString("base64url");
export const utf8Hex = (text: string): string => hex(Buffer.from(text, "utf8"));

/** The text a base64 or base64url string decodes to, or undefined when it is not one (bad symbols, a length no base64 has, or bytes that are not UTF-8). */
export function base64Decode(s: string): string | undefined {
  const t = s.replace(/\s+/g, "").replace(/=+$/, "");
  if (t.length < 2 || t.length % 4 === 1 || !/^[A-Za-z0-9+/_-]+$/.test(t)) return;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(t, "base64")); } catch { return; }
}

/** The text a run of hex bytes decodes to, or undefined. */
export function hexDecode(s: string): string | undefined {
  const t = s.replace(/\s+/g, "");
  if (!t || t.length % 2 || !/^[0-9a-fA-F]+$/.test(t)) return;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(t, "hex")); } catch { return; }
}

export const urlEncode = (text: string): string => encodeURIComponent(text);

/** `decodeURIComponent`, or undefined when the text has no escape or a broken one. */
export function urlDecode(s: string): string | undefined {
  if (!/%[0-9a-fA-F]{2}/.test(s) && !s.includes("+")) return;
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return; }
}

// ---- lorem ipsum ----------------------------------------------------------------------

const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(" ");
const OPENING = ["Lorem", "ipsum", "dolor", "sit", "amet,", "consectetur", "adipiscing", "elit"];

/** `n` words: the classic opening, then random words in sentences of 8 to 16, a full stop at the end. */
export function loremWords(n: number): string {
  const out: string[] = [];
  let sentence = 0, target = 8 + randInt(9);
  while (out.length < n) {
    let w = out.length < OPENING.length ? OPENING[out.length] : LOREM[randInt(LOREM.length)];
    if (sentence === 0 && out.length >= OPENING.length) w = w[0].toUpperCase() + w.slice(1);
    sentence++;
    if (sentence >= target || out.length === n - 1) { w = w.replace(/,$/, "") + "."; sentence = 0; target = 8 + randInt(9); }
    else if (sentence > 3 && out.length >= OPENING.length && randInt(8) === 0 && !w.endsWith(",")) w += ",";
    out.push(w);
  }
  return out.join(" ");
}

/** `n` paragraphs of 40 to 70 words, a blank line between them. */
export const loremParagraphs = (n: number): string => Array.from({ length: n }, () => loremWords(40 + randInt(31))).join("\n\n");

// ---- JWT ------------------------------------------------------------------------------

type Jwt = { header: Record<string, unknown>; payload: Record<string, unknown>; signature: string; raw: [string, string, string] };

/** The three parts of a JWT decoded, or undefined when the text is not one. The signature is never checked. */
export function jwtDecode(token: string): Jwt | undefined {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || !parts.every((p, i) => (i < 2 ? p.length > 0 : true) && /^[A-Za-z0-9_-]*$/.test(p))) return;
  const json = (s: string) => { try { const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8")); return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined; } catch { return; } };
  const header = json(parts[0]), payload = json(parts[1]);
  if (!header || !payload) return;
  return { header, payload, signature: parts[2], raw: [parts[0], parts[1], parts[2]] };
}
