// Writes app/src/gallery/shots/generate.json, the store screenshots'
// fixture: the palette listed through the host harness for the four
// queries the shots type, so the rows are what the code draws today. The
// empty query's values are the platform's CSPRNG by design, so after
// listing each one is swapped for the same generator's answer over a seeded
// `crypto` here (gen.ts, the same length, charset and settings), and its
// derived fields (the name, the pane, the length, the word count, the rgb) rebuilt: the rows are
// the code's, only the dice are fixed. `bun run extensions/generate/fixture.ts`,
// then `node app/scripts/shots.mjs generate`.
import { truncate, type Item } from "@zcag/pal";
import { NOW, pinClock, seeded, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host } from "../../host/test/harness.ts";
import { CHARSET_TITLES, loremParagraphs, nanoid, passphrase, password, randomBase64, randomColor, randomHex, randomNumber, rgbOf, ulid, uuid4, uuid7, type Charset } from "./gen.ts";
import manifest from "./pal.json";

const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE5MDAwMDAwMDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const QUERIES = ["", "hash pal", "qr https://pal.cagdas.io", `jwt ${JWT}`];

// gen.ts draws from `crypto.getRandomValues` and `crypto.randomUUID`: seed both, in this process only.
const rand = seeded(7);
const fill = <T extends ArrayBufferView>(a: T): T => { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i++) b[i] = Math.floor(rand() * 256); return a; };
Object.defineProperty(crypto, "getRandomValues", { value: fill });
Object.defineProperty(crypto, "randomUUID", { value: () => { const h = [...fill(new Uint8Array(16))].map((x, i) => (i === 6 ? 0x40 | (x & 0x0f) : i === 8 ? 0x80 | (x & 0x3f) : x).toString(16).padStart(2, "0")).join(""); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; } });

const defaults = Object.fromEntries(manifest.settings.map((s) => [s.id, s.default])) as { passphrase_separator: string };
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
/** The value a row holds (index.ts `row`): inside the fence, the lorem text itself, the colour's name. */
const valueOf = (i: Item) => { const md = i.detail && "markdown" in i.detail ? i.detail.markdown ?? "" : ""; return md.startsWith("```\n") ? md.slice(4, -4) : i.id === "colour" ? i.name : md; };
/** The same generator again, over the seeded dice. */
const again: Record<string, (old: string, i: Item) => string> = {
  uuid4: () => uuid4(),
  uuid7: () => uuid7(NOW),
  ulid: () => ulid(NOW),
  nanoid: () => nanoid(),
  password: (old, i) => password(old.length, (Object.entries(CHARSET_TITLES).find(([, t]) => i.subtitle?.endsWith(t))?.[0] ?? "full") as Charset),
  passphrase: (old) => passphrase(old.split(defaults.passphrase_separator).length, defaults.passphrase_separator),
  number: () => String(randomNumber(1, 100)),
  hex: (old) => randomHex(old.length / 2),
  bytes: () => randomBase64(16),
  lorem: () => loremParagraphs(1),
  colour: () => randomColor(),
};
function reroll(i: Item): Item {
  const make = again[i.id];
  if (!make || !i.detail || !("markdown" in i.detail)) return i;
  const old = valueOf(i), next = make(old, i), { r, g, b } = rgbOf(next);
  const md = i.detail.markdown ?? "";
  const fixed: Record<string, string> = { Length: `${next.length} characters`, Words: i.id === "lorem" ? String(words(next)) : "", Hex: next, RGB: `rgb(${r}, ${g}, ${b})` };
  return {
    ...i,
    name: truncate(next, 80).replace(/\s+/g, " "),
    subtitle: i.id === "lorem" ? i.subtitle?.replace(/\d+ words$/, `${words(next)} words`) : i.id === "colour" ? `Random colour, ${fixed.RGB}` : i.subtitle,
    ...(i.id === "colour" && { icon: next }),
    detail: { ...i.detail, markdown: md.startsWith("```\n") ? `\`\`\`\n${next}\n\`\`\`` : i.id === "colour" ? `# ${next}` : next, metadata: i.detail.metadata?.map((m) => (fixed[m.label] ? { ...m, value: fixed[m.label] } : m)) },
  };
}

pinClock();
const host = await Host.bundled();
try {
  const meta = host.loaded().find((l) => l.extension === "generate")!.palettes[0];
  const byQuery: Record<string, Item[]> = {};
  for (const q of QUERIES) byQuery[q] = (await host.list("generate", "generate", q)) as Item[];
  byQuery[""] = byQuery[""].map(reroll);
  writeFixture("generate", {
    palettes: { generate: { title: meta.title, icon: meta.icon, input: true, placeholder: meta.placeholder, byQuery } },
    shots: {
      "1-everything": { palette: "generate", keys: ["down*4"], caption: "The empty query: a fresh value of every generator, the secrets with their strength and entropy" },
      "2-hash": { palette: "generate", keys: ["type:hash pal", "cmd+k"], caption: "hash of typed text: all four digests, and Copy all on cmd+shift+c" },
      "3-qr": { palette: "generate", keys: ["type:qr https://pal.cagdas.io", "cmd+i"], caption: "qr of a link: the code on the row and large in the detail pane" },
      "4-jwt": { palette: "generate", keys: [`type:jwt ${JWT}`, "down"], caption: "jwt: the header, the payload with its expiry, the times, and a reminder that nothing is verified" },
    },
  });
  console.log("wrote app/src/gallery/shots/generate.json");
} finally {
  host.kill();
}
