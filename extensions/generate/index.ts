// Generate: identifiers, secrets, random values, hashes, encodings, lorem
// ipsum, a colour, a QR code and a JWT taken apart. An input palette: the
// empty query lists a fresh value of each generator, a mode word narrows
// it (`password 32`, `lorem 3 paragraphs`), and a transform mode works on
// the text typed after it or, with none, on the newest clipboard text
// (`sha256 hello`, `base64`, `qr https://…`, `jwt eyJ…`). Every value
// copies on Enter and pastes on cmd+Enter; the shell's Refresh (cmd+r)
// lists again, which is how a value is regenerated. The values are made in
// `gen.ts`, the QR code in `qr.ts`; this file is the rows.
import { clipboard, errorMessage, hint, settings, toast, truncate, type Accessory, type Action, type Detail, type Effect, type Extension, type Item } from "@zcag/pal";
import { base64, base64Decode, base64url, CHARSET_TITLES, CHARSETS, entropy, hash, HASHES, hexDecode, jwtDecode, loremParagraphs, loremWords, nanoid, passphrase, password, randomBase64, randomColor, randomHex, randomNumber, relative, rgbOf, strength, ulid, urlDecode, urlEncode, utf8Hex, uuid4, uuid7, WORDS, type Charset, type HashAlgo } from "./gen.ts";
import { encode as encodeQr, toDataUrl, toSvg } from "./qr.ts";

/** `[extensions.generate]`, defaults in pal.json. */
type Settings = { password_length: number; password_charset: Charset; passphrase_words: number; passphrase_separator: string };

/** Material Design glyphs from the bundled Nerd Font; the tile's amber tints them. */
const GLYPH = {
  id: "\u{f0efe}", // md-identifier
  password: "\u{f07f5}", // md-form_textbox_password
  passphrase: "\u{f09a9}", // md-text_short
  number: "\u{f03a0}", // md-numeric
  hex: "\u{f12a7}", // md-hexadecimal
  bytes: "\u{f049f}", // md-shuffle_variant
  lorem: "\u{f09aa}", // md-text_long
  hash: "\u{f0423}", // md-pound
  encode: "\u{f016a}", // md-code_brackets
  url: "\u{f0339}", // md-link_variant
  qr: "\u{f0432}", // md-qrcode
  jwt: "\u{f030b}", // md-key_variant
  clock: "\u{f0150}", // md-clock_outline
  alert: "\u{f05d6}", // md-alert_circle_outline
};

const COPY: Action = { id: "copy", title: "Copy" };
const PASTE: Action = { id: "paste", title: "Paste" };
const COPY_ALL: Action = { id: "copy_all", title: "Copy all", shortcut: "cmd+shift+c" };
const PICKER: Action = { id: "picker", title: "Open in Colour Picker", shortcut: "cmd+o" };
const SHOW_QR: Action = { id: "show", title: "Show QR code" };
const COPY_SVG: Action = { id: "copy_svg", title: "Copy SVG", shortcut: "cmd+c" };
const COPY_TEXT: Action = { id: "copy", title: "Copy text" };

const DEFAULT_BYTES = 16;
const NUMBER_RANGE: [number, number] = [1, 100];
const MAX_LOREM_WORDS = 2000, MAX_LOREM_PARAGRAPHS = 50, MAX_BYTES = 1024, MAX_PASSWORD = 256, MAX_WORDS = 20;

/** What each row of the last listing holds: `pick` gets the id back and nothing else. */
type Held = { value: string; all?: string; svg?: string; qrText?: string; color?: string };
const held = new Map<string, Held>();

const S = () => settings.get<Settings>();

// ---- rows ---------------------------------------------------------------------------

type RowOpts = { name?: string; subtitle?: string; icon?: Item["icon"]; keywords?: string[]; accessories?: Accessory[]; detail?: Detail; actions?: Action[]; all?: string; kind?: string };

/** A value row: the value is the title, Copy and Paste its actions, the whole value in the detail pane. */
function row(id: string, value: string, o: RowOpts): Item {
  held.set(id, { value, all: o.all });
  const name = short(o.name ?? value.split("\n")[0], 80);
  const kind = o.kind ?? o.subtitle ?? id;
  const detail: Detail = o.detail ?? {
    markdown: `\`\`\`\n${value}\n\`\`\``,
    metadata: [{ label: "Kind", value: kind }, { label: "Length", value: `${value.length} characters` }],
  };
  return { id, name, subtitle: o.subtitle, icon: o.icon ?? GLYPH.id, keywords: o.keywords, accessories: o.accessories, detail, actions: o.actions ?? (o.all ? [COPY, PASTE, COPY_ALL] : [COPY, PASTE]) };
}

/** Cut, then one line: a value's newlines collapse only where they survive the cut. */
const short = (text: string, n = 40) => truncate(text, n).replace(/\s+/g, " ");
const of = (source: Source) => (source.clipboard ? "the clipboard" : `“${short(source.text)}”`);

/** The strength tag and the bits of a secret, on the right. */
const strengthOf = (bits: number): Accessory[] => {
  const s = strength(bits);
  return [{ tag: s.label, color: s.color }, { text: `${bits} bits` }];
};

// ---- generators ------------------------------------------------------------------

function uuidRows(): Item[] {
  return [
    row("uuid4", uuid4(), { subtitle: "UUID v4, random", keywords: ["uuid", "guid"], kind: "UUID v4" }),
    row("uuid7", uuid7(), { subtitle: "UUID v7, time-ordered", keywords: ["uuid", "guid"], kind: "UUID v7" }),
  ];
}
const ulidRow = () => row("ulid", ulid(), { subtitle: "ULID, time-ordered", keywords: ["ulid", "id"], kind: "ULID" });
const nanoidRow = () => row("nanoid", nanoid(), { subtitle: "Nano ID, 21 characters", keywords: ["nanoid", "id"], kind: "Nano ID" });

function passwordRow(length = S().password_length, charset: Charset = S().password_charset): Item {
  const n = Math.min(Math.max(1, Math.floor(length)), MAX_PASSWORD);
  const value = password(n, charset);
  const bits = entropy(n, CHARSETS[charset].length);
  const subtitle = `Password, ${n} characters, ${CHARSET_TITLES[charset]}`;
  return row("password", value, { subtitle, icon: GLYPH.password, keywords: ["password", "secret"], accessories: strengthOf(bits), kind: "Password", detail: {
    markdown: `\`\`\`\n${value}\n\`\`\``,
    metadata: [{ label: "Length", value: `${n} characters` }, { label: "Characters", value: CHARSET_TITLES[charset] }, { label: "Entropy", value: `${bits} bits, ${strength(bits).label}` }],
  } });
}

function passphraseRow(words = S().passphrase_words, separator = S().passphrase_separator): Item {
  const n = Math.min(Math.max(1, Math.floor(words)), MAX_WORDS);
  const value = passphrase(n, separator);
  const bits = entropy(n, WORDS.length);
  return row("passphrase", value, { subtitle: `Passphrase, ${n} words`, icon: GLYPH.passphrase, keywords: ["passphrase", "diceware", "words"], accessories: strengthOf(bits), kind: "Passphrase", detail: {
    markdown: `\`\`\`\n${value}\n\`\`\``,
    metadata: [{ label: "Words", value: `${n} of ${WORDS.length}` }, { label: "Entropy", value: `${bits} bits, ${strength(bits).label}` }],
  } });
}

const numberRow = (lo: number, hi: number) => row("number", String(randomNumber(lo, hi)), { subtitle: `Random number, ${lo} to ${hi}`, icon: GLYPH.number, keywords: ["number", "random", "dice", "integer"], kind: "Random number" });
const hexRow = (bytes: number) => row("hex", randomHex(bytes), { subtitle: `Random hex, ${bytes} bytes`, icon: GLYPH.hex, keywords: ["hex", "bytes", "random", "token"], kind: "Random hex" });
const bytesRow = (bytes: number) => row("bytes", randomBase64(bytes), { subtitle: `Random base64, ${bytes} bytes`, icon: GLYPH.bytes, keywords: ["base64", "bytes", "random", "secret", "token"], kind: "Random base64" });

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
function loremRow(id: string, text: string, what: string): Item {
  return row(id, text, { subtitle: `Lorem ipsum, ${what}`, icon: GLYPH.lorem, keywords: ["lorem", "ipsum", "placeholder", "text"], kind: "Lorem ipsum", detail: { markdown: text, metadata: [{ label: "Words", value: String(wordCount(text)) }, { label: "Length", value: `${text.length} characters` }] } });
}
const loremParagraphRow = (n: number, id = "lorem") => { const t = loremParagraphs(n); return loremRow(id, t, `${n} ${n === 1 ? "paragraph" : "paragraphs"}, ${wordCount(t)} words`); };
const loremWordsRow = (n: number, id = "lorem-words") => loremRow(id, loremWords(n), `${n} words`);

function colorRow(id = "colour"): Item {
  const hexColor = randomColor();
  const { r, g, b } = rgbOf(hexColor);
  const item = row(id, hexColor, { subtitle: `Random colour, rgb(${r}, ${g}, ${b})`, icon: hexColor, keywords: ["colour", "color", "random", "hex"], kind: "Colour", actions: [COPY, PASTE, PICKER], detail: {
    markdown: `# ${hexColor}`,
    metadata: [{ label: "Hex", value: hexColor }, { label: "RGB", value: `rgb(${r}, ${g}, ${b})` }],
  } });
  held.get(id)!.color = hexColor;
  return item;
}

/** The empty query: one fresh value per generator, then the transform modes as hints. */
function everything(): Item[] {
  return [
    ...uuidRows(), ulidRow(), nanoidRow(), passwordRow(), passphraseRow(),
    numberRow(...NUMBER_RANGE), hexRow(DEFAULT_BYTES), bytesRow(DEFAULT_BYTES), loremParagraphRow(1), colorRow(),
    hint("hash", "Hash text", "sha256 <text>, also md5, sha1, sha512, or hash for all four; alone, the clipboard", { icon: GLYPH.hash }),
    hint("encode", "Encode or decode text", "base64 <text>, url <text>, hex <text>, encode <text> for every form, decode <text>", { icon: GLYPH.encode }),
    hint("qr", "QR code", "qr <text>, or qr alone for the clipboard", { icon: GLYPH.qr }),
    hint("jwt", "Decode a JWT", "jwt <token>: the header, the payload and its times; the signature is not checked", { icon: GLYPH.jwt }),
  ];
}

// ---- transforms ----------------------------------------------------------------------

/** The text a transform works on: typed after the mode, else the newest clipboard text. */
type Source = { text: string; clipboard: boolean };

async function source(typed: string): Promise<Source | undefined> {
  if (typed) return { text: typed, clipboard: false };
  const text = (await clipboard.list({ kind: "text", limit: 1 }))[0]?.text;
  return text ? { text, clipboard: true } : undefined;
}

const nothing = (mode: string) => hint("nothing", `Nothing to ${mode}`, `Type text after ${mode}, or copy some first`, { icon: GLYPH.alert });

const hashRow = (algo: HashAlgo, src: Source, all?: string) =>
  row(algo, hash(algo, src.text), { subtitle: `${algo.toUpperCase()} of ${of(src)}`, icon: GLYPH.hash, all, kind: algo.toUpperCase() });

function hashRows(algos: HashAlgo[], src: Source): Item[] {
  const all = algos.length > 1 ? algos.map((a) => `${a}  ${hash(a, src.text)}`).join("\n") : undefined;
  return algos.map((a) => hashRow(a, src, all));
}

function encodeRows(forms: ("base64" | "base64url" | "url" | "hex")[], src: Source): Item[] {
  const rows: Item[] = [];
  // What decodes goes first: `base64 aGVsbG8=` wants the text back more often than a second encoding.
  if (forms.includes("base64")) { const d = base64Decode(src.text); if (d !== undefined) rows.push(row("base64-decoded", d, { subtitle: `Base64 decoded from ${of(src)}`, icon: GLYPH.encode, kind: "Base64 decoded" })); }
  if (forms.includes("url")) { const d = urlDecode(src.text); if (d !== undefined) rows.push(row("url-decoded", d, { subtitle: `URL decoded from ${of(src)}`, icon: GLYPH.url, kind: "URL decoded" })); }
  if (forms.includes("hex")) { const d = hexDecode(src.text); if (d !== undefined) rows.push(row("hex-decoded", d, { subtitle: `Hex decoded from ${of(src)}`, icon: GLYPH.hex, kind: "Hex decoded" })); }
  const made: [string, string, string, string][] = [];
  if (forms.includes("base64")) made.push(["base64", base64(src.text), "Base64", GLYPH.encode]);
  if (forms.includes("base64url")) made.push(["base64url", base64url(src.text), "Base64url", GLYPH.encode]);
  if (forms.includes("url")) made.push(["url", urlEncode(src.text), "URL encoded", GLYPH.url]);
  if (forms.includes("hex")) made.push(["hex-of", utf8Hex(src.text), "Hex", GLYPH.hex]);
  const all = made.length > 1 ? made.map(([, v, k]) => `${k}  ${v}`).join("\n") : undefined;
  for (const [id, value, kind, icon] of made) rows.push(row(id, value, { subtitle: `${kind} of ${of(src)}`, icon, all, kind }));
  return rows;
}

function decodeRows(src: Source): Item[] {
  const rows: Item[] = [];
  const b = base64Decode(src.text), u = urlDecode(src.text), h = hexDecode(src.text);
  if (b !== undefined) rows.push(row("base64-decoded", b, { subtitle: `Base64 decoded from ${of(src)}`, icon: GLYPH.encode, kind: "Base64 decoded" }));
  if (u !== undefined) rows.push(row("url-decoded", u, { subtitle: `URL decoded from ${of(src)}`, icon: GLYPH.url, kind: "URL decoded" }));
  if (h !== undefined) rows.push(row("hex-decoded", h, { subtitle: `Hex decoded from ${of(src)}`, icon: GLYPH.hex, kind: "Hex decoded" }));
  if (jwtDecode(src.text)) rows.push(...jwtRows(src));
  return rows.length ? rows : [hint("undecodable", `Not base64, hex, URL-encoded or a JWT`, of(src), { icon: GLYPH.alert })];
}

function qrRows(src: Source): Item[] {
  let qr;
  try { qr = encodeQr(src.text); } catch (e) { return [hint("qr-big", "Too long for a QR code", errorMessage(e), { icon: GLYPH.alert })]; }
  const svg = toSvg(qr);
  const url = toDataUrl(svg);
  const item = row("qr", short(src.text, 80), { subtitle: `QR code of ${of(src)}: version ${qr.version}, ${qr.size} × ${qr.size} modules, level ${qr.ecl}`, icon: { image: url }, actions: [SHOW_QR, COPY_SVG, COPY_TEXT], detail: {
    markdown: `![QR code](${url})`,
    metadata: [{ label: "Text", value: short(src.text, 120) }, { label: "Version", value: `${qr.version} (${qr.size} × ${qr.size})` }, { label: "Error correction", value: qr.ecl }, { label: "Bytes", value: String(new TextEncoder().encode(src.text).length) }],
  } });
  held.set("qr", { value: src.text, svg, qrText: src.text });
  return [item];
}

const stamp = (seconds: number) => new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 19);

function jwtRows(src: Source): Item[] {
  const jwt = jwtDecode(src.text);
  if (!jwt) return [hint("jwt-bad", "Not a JWT", `${of(src)} is not three base64url parts with JSON in the first two`, { icon: GLYPH.alert })];
  const headerJson = JSON.stringify(jwt.header, null, 2), payloadJson = JSON.stringify(jwt.payload, null, 2);
  const all = `${headerJson}\n${payloadJson}`;
  const claims = jwt.payload;
  const times: Item[] = [];
  const exp = typeof claims.exp === "number" ? claims.exp : undefined;
  const expiry: Accessory[] = exp === undefined ? [] : exp * 1000 < Date.now() ? [{ tag: `expired ${relative(exp)}`, color: "red" }] : [{ tag: `expires ${relative(exp)}`, color: "green" }];
  for (const [claim, label] of [["exp", "Expires"], ["iat", "Issued"], ["nbf", "Not before"]] as const) {
    const v = claims[claim];
    if (typeof v !== "number") continue;
    times.push(row(`jwt-${claim}`, stamp(v), { subtitle: `${label} (${claim}), ${relative(v)}`, icon: GLYPH.clock, kind: label, all, accessories: [{ text: String(v) }] }));
  }
  const alg = typeof jwt.header.alg === "string" ? jwt.header.alg : "no alg";
  const who = ["sub", "email", "name", "iss"].map((k) => claims[k]).find((v) => typeof v === "string") as string | undefined;
  return [
    row("jwt-header", headerJson, { name: `Header: ${alg}${typeof jwt.header.typ === "string" ? `, ${jwt.header.typ}` : ""}${typeof jwt.header.kid === "string" ? `, kid ${jwt.header.kid}` : ""}`, subtitle: JSON.stringify(jwt.header), icon: GLYPH.jwt, all, kind: "JWT header", accessories: [{ text: `${Object.keys(jwt.header).length} fields` }], detail: { markdown: `\`\`\`json\n${headerJson}\n\`\`\``, metadata: [{ label: "Algorithm", value: alg }, { label: "Signature", value: jwt.signature ? `${jwt.signature.length} characters, not verified` : "none" }] } }),
    row("jwt-payload", payloadJson, { name: `Payload${who ? `: ${short(who, 40)}` : ""}`, subtitle: JSON.stringify(jwt.payload), icon: GLYPH.jwt, all, kind: "JWT payload", accessories: [...expiry, { text: `${Object.keys(claims).length} claims` }], detail: { markdown: `\`\`\`json\n${payloadJson}\n\`\`\``, metadata: Object.entries(claims).slice(0, 12).map(([k, v]) => ({ label: k, value: typeof v === "number" && ["exp", "iat", "nbf"].includes(k) ? `${stamp(v)} (${relative(v)})` : typeof v === "string" ? v : JSON.stringify(v) })) } }),
    ...times,
    hint("jwt-unverified", "Signature not verified", "pal only decodes the token; whether it is genuine is for the issuer's key to say", { icon: GLYPH.alert }),
  ];
}

// ---- the query ----------------------------------------------------------------------

const int = (s: string | undefined): number | undefined => (s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined);

type Mode = "uuid" | "ulid" | "nanoid" | "password" | "passphrase" | "number" | "hex" | "bytes" | "lorem" | "colour" | HashAlgo | "hash" | "base64" | "base64url" | "url" | "encode" | "decode" | "qr" | "jwt";
const MODES: Record<string, Mode> = {
  uuid: "uuid", guid: "uuid", ulid: "ulid", nanoid: "nanoid", nano: "nanoid",
  password: "password", pass: "password", pw: "password", passphrase: "passphrase", phrase: "passphrase",
  number: "number", num: "number", dice: "number", hex: "hex", bytes: "bytes",
  lorem: "lorem", ipsum: "lorem", colour: "colour", color: "colour",
  md5: "md5", sha1: "sha1", sha256: "sha256", sha512: "sha512", sha: "sha256", hash: "hash",
  base64: "base64", b64: "base64", base64url: "base64url", b64url: "base64url", url: "url", urlencode: "url", urldecode: "url",
  encode: "encode", decode: "decode", qr: "qr", jwt: "jwt",
};
const MODE_WORDS = "sha256 · md5 · base64 · url · hex · qr · jwt · encode · decode";

const haystack = (i: Item) => `${i.name} ${i.subtitle ?? ""} ${(i.keywords ?? []).join(" ")}`.toLowerCase();

async function list(query = ""): Promise<Item[]> {
  held.clear();
  const q = query.trim();
  if (!q) return everything();
  const [word, ...args] = q.split(/\s+/);
  const mode = MODES[word.toLowerCase()];
  const rest = q.slice(word.length).trim();
  if (!mode) {
    // No mode: the generators whose name or keyword has the query; else say how a transform is asked for.
    const words = q.toLowerCase().split(/\s+/);
    const found = everything().filter((i) => !i.id.startsWith("hint:") && words.every((w) => haystack(i).includes(w)));
    return found.length ? found : [hint("mode", `Pick a mode for “${short(q)}”`, MODE_WORDS)];
  }
  switch (mode) {
    case "uuid": return uuidRows();
    case "ulid": return [ulidRow()];
    case "nanoid": return [nanoidRow()];
    case "password": {
      const charset = args.map((a) => a.toLowerCase()).find((a): a is Charset => a in CHARSETS);
      return [passwordRow(int(args.find((a) => /^\d+$/.test(a))) ?? undefined, charset)];
    }
    case "passphrase": return [passphraseRow(int(args[0]) ?? undefined)];
    case "number": {
      if (word.toLowerCase() === "dice") return [numberRow(1, 6)];
      const m = rest.match(/^(-?\d+)\s*(?:-|to|\s)\s*(-?\d+)$/) ?? rest.match(/^(-?\d+)$/);
      const [lo, hi] = m ? (m[2] !== undefined ? [Number(m[1]), Number(m[2])] : [NUMBER_RANGE[0], Number(m[1])]) : NUMBER_RANGE;
      return [numberRow(Math.min(lo, hi), Math.max(lo, hi))];
    }
    case "hex": {
      const n = int(args[0]);
      if (args.length === 0) return [hexRow(DEFAULT_BYTES)];
      if (n !== undefined && args.length === 1) return [hexRow(Math.min(Math.max(1, n), MAX_BYTES))];
      return encodeRows(["hex"], { text: rest, clipboard: false });
    }
    case "bytes": return [bytesRow(Math.min(Math.max(1, int(args[0]) ?? DEFAULT_BYTES), MAX_BYTES))];
    case "lorem": {
      const m = rest.match(/^(\d+)\s*([a-z]*)$/i);
      if (!m) return [loremWordsRow(10), loremParagraphRow(1), loremParagraphRow(3, "lorem-3")];
      const n = Number(m[1]);
      if (/^p/i.test(m[2])) return [loremParagraphRow(Math.min(Math.max(1, n), MAX_LOREM_PARAGRAPHS))];
      return [loremWordsRow(Math.min(Math.max(1, n), MAX_LOREM_WORDS))];
    }
    case "colour": return Array.from({ length: 5 }, (_, i) => colorRow(`colour-${i}`));
  }
  const src = await source(rest);
  if (!src) return [nothing(word.toLowerCase())];
  switch (mode) {
    case "hash": return hashRows(HASHES, src);
    case "md5": case "sha1": case "sha256": case "sha512": return hashRows([mode], src);
    case "base64": return encodeRows(["base64"], src);
    case "base64url": return encodeRows(["base64url"], src);
    case "url": return encodeRows(["url"], src);
    case "encode": return encodeRows(["base64", "base64url", "url", "hex"], src);
    case "decode": return decodeRows(src);
    case "qr": return qrRows(src);
    case "jwt": return jwtRows(src);
  }
}

function pick(id: string, action?: string): Effect {
  const h = held.get(id);
  if (!h) return toast("Value is gone", "The listing changed; pick again", "failure");
  switch (action) {
    case "paste": return { paste: { text: h.value } };
    case "copy_all": return { copy: h.all ?? h.value };
    case "picker": return { push: { extension: "colors", palette: "picker", args: { color: h.color, from: "typed" } } };
    case "copy_svg": return { copy: h.svg ?? h.value };
    case "show": return { show: { title: "QR code", markdown: `![QR code](${toDataUrl(h.svg!)})\n\n\`${h.qrText}\`` } };
    default: return { copy: h.value };
  }
}

export default {
  palettes: {
    generate: {
      title: "Generate",
      input: true,
      placeholder: "uuid, password 32, lorem, sha256 <text>, qr <text>, jwt <token>",
      list,
      pick,
    },
  },
} satisfies Extension;
