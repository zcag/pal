// What every `extensions/<name>/fixture.ts` shares, so a fixture is the same
// on every run and on every machine (docs/design/screenshots.md, "Content"):
//
//   import { NOW, pinClock, settle } from "../../app/scripts/fixture-kit.ts";
//   pinClock();                                  // before the host starts: PAL_NOW and TZ for the extension
//   ... build the fixture through the harness against the mock server ...
//   const fx = await settle(fixture, { hosts: { [server.url]: "https://tela.example" } });
//   writeFixture("tela", fx);                    // app/src/gallery/shots/tela.json
//
// `settle` must run while the mock servers are still up: it fetches every
// picture the fixture points at on them and inlines it as a `data:` URI (the
// gallery renders long after the servers are gone), and names what is left of
// their addresses by the host you give (a subtitle that read `127.0.0.1:52891`
// reads `odak.example.com`).
import { writeFileSync } from "node:fs";

/** The one clock every fixture and shot uses: 16 Sep 2026, 14:32 in `TZ` (11:32 UTC), the strip's clock; the same instant on every machine. shots-lib.mjs's NOW is this. */
export const NOW = Date.UTC(2026, 8, 16, 11, 32, 0);
/** `NOW` in Unix seconds. */
export const NOW_S = Math.floor(NOW / 1000);
/** The zone the pictures are in: fixed, so a time of day reads the same on CI and at home. */
export const TZ = "Europe/Istanbul";

/** Pins the extensions' clock (sdk `now()`, `PAL_NOW`) and the zone for the host the fixture starts next; call before `Host.bundled`. */
export function pinClock(at = NOW) {
  process.env.TZ = TZ;
  // PAL_NOW is a wall-clock time in TZ (sdk/src/clock.ts): the instant as Istanbul reads it.
  const f = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(at));
  process.env.PAL_NOW = f.replace(" ", "T");
}

/** A seeded generator (mulberry32) for anything a fixture draws at random: the same sequence every run. */
export function seeded(seed = 42): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LOCAL = /https?:\/\/(?:127\.0\.0\.1|localhost):\d+[^\s"')\]]*/g;
const PICTURE = /\.(png|jpe?g|gif|webp|svg)(\?|$)|[?&](size|thumb)=|\/(cover|thumb|image|media|getCoverArt|avatar|artwork)/i;

async function dataUri(url: string): Promise<string | undefined> {
  try {
    const r = await fetch(url);
    if (!r.ok) return undefined;
    const type = r.headers.get("content-type")?.split(";")[0] || "image/png";
    if (!type.startsWith("image/")) return undefined;
    return `data:${type};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * The fixture with every local picture inlined and every local address named
 * by `hosts` (base url to the one to show; longest match first). Fails on a
 * local address it could not name: a shot must never carry a dead link.
 */
export async function settle<T>(fixture: T, o: { hosts?: Record<string, string> } = {}): Promise<T> {
  const text = JSON.stringify(fixture);
  const found = [...new Set(text.match(LOCAL) ?? [])];
  const inlined = new Map<string, string>();
  for (const url of found) {
    const clean = url.replace(/\\+$/, "");
    if (!PICTURE.test(clean)) continue;
    const d = await dataUri(clean);
    if (d) inlined.set(clean, d);
  }
  const bases = Object.entries(o.hosts ?? {}).sort((a, b) => b[0].length - a[0].length);
  const out = text.replace(LOCAL, (url) => {
    const clean = url.replace(/\\+$/, "");
    const tail = url.slice(clean.length);
    if (inlined.has(clean)) return inlined.get(clean)! + tail;
    const base = bases.find(([b]) => clean.startsWith(b.replace(/\/$/, "")));
    if (base) return base[1].replace(/\/$/, "") + clean.slice(base[0].replace(/\/$/, "").length) + tail;
    throw new Error(`fixture: ${clean} is a local address with no host to show it as (settle's hosts)`);
  });
  // A bare host:port (a subtitle, a server field) is named by the same table.
  const named = out.replace(/(?:127\.0\.0\.1|localhost):\d+/g, (hp) => {
    const base = bases.find(([b]) => b.includes(hp));
    if (!base) throw new Error(`fixture: ${hp} is a local address with no host to show it as (settle's hosts)`);
    return new URL(base[1]).host;
  });
  return JSON.parse(named) as T;
}

/** Writes `app/src/gallery/shots/<name>.json` (compact: it is data, the diff is the shots' business). */
export function writeFixture(name: string, fixture: unknown) {
  writeFileSync(new URL(`../src/gallery/shots/${name}.json`, import.meta.url), JSON.stringify(fixture) + "\n");
}
