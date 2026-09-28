// Writes app/src/gallery/shots/immich.json, the store screenshots' fixture:
// the grids and lists through the host harness against the Immich mock
// (host/test/extensions/immich-mock.ts). The mock's days sit around the
// tests' clock (22 Sep); they move six days back to the shots' (16 Sep).
// Its pictures are seeded patterns; each is swapped here for a small SVG
// scene of what the asset's title says (a receipt, the cat, the sea at
// sunset) and a face for a person. Nothing is the owner's.
// `make shots EXT=immich`.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host, stored } from "../../host/test/harness.ts";
import { ALBUMS, ASSETS, DAYS, PEOPLE, startMock } from "../../host/test/extensions/immich-mock.ts";
import { picture } from "../../host/test/png.ts";
import { pinClock, seeded, settle, writeFixture } from "../../app/scripts/fixture-kit.ts";
import type { Item } from "../../sdk/src/protocol.ts";

pinClock();

// ---- the mock's days, six back ----------------------------------------------------------------

const back = (iso: string) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() - 6); return d.toISOString().replace(/\.\d{3}Z$/, ".000Z"); };
const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
for (const a of ASSETS) {
  if (!/^(2026-09|2025-09-22|2021-09-22)/.test(a.local)) continue;
  const was = a.local;
  a.local = a.title === "the sea at sunset" ? "2025-09-16T19:05:00.000Z" : back(was);
  a.file = a.file.replace(ymd(was), ymd(a.local));
}
for (const al of ALBUMS) if (al.modified.startsWith("2026-09")) al.modified = back(al.modified);
Object.assign(DAYS, { memories: "09-16", albumEnd: "2026-09-13" });

// ---- pictures ------------------------------------------------------------------------------------

const svg = (w: number, h: number, body: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w * 3}" height="${h * 3}" viewBox="0 0 ${w} ${h}">${body}</svg>`).toString("base64")}`;
/** A 96 by 72 scene for a title; `r` varies the colours and the placing so twenty receipts are twenty pictures. */
function scene(title: string, r: () => number): string {
  const j = (n: number) => Math.round((r() - 0.5) * n);
  if (/receipt/.test(title)) {
    const wood = ["#8a5a3b", "#6f4a33", "#9c6b47", "#d9d4cc"][Math.floor(r() * 4)];
    const tilt = j(16);
    const lines = Array.from({ length: 7 }, (_, i) => `<rect x="${38 + (i % 3 === 2 ? 6 : 0)}" y="${16 + i * 6}" width="${i % 3 === 2 ? 12 : 20 + j(6)}" height="1.6" fill="#8b8f98"/>`).join("");
    return svg(96, 72, `<rect width="96" height="72" fill="${wood}"/><path d="M0 ${20 + j(10)}h96M0 ${48 + j(10)}h96" stroke="#00000018" stroke-width="3"/><g transform="rotate(${tilt} 48 36)"><rect x="33" y="6" width="30" height="62" fill="#fbfaf6"/><rect x="38" y="10" width="20" height="3" fill="#3b3f46"/>${lines}<rect x="38" y="${58}" width="20" height="2.4" fill="#3b3f46"/></g>`);
  }
  if (/cat/.test(title)) {
    const sofa = ["#4a6fa5", "#7a5c8e", "#5b8a72", "#a0524d"][Math.floor(r() * 4)], fur = ["#e8a15a", "#8d8d8d", "#3a3a3a", "#f1e3cf"][Math.floor(r() * 4)];
    const x = 40 + j(20);
    return svg(96, 72, `<rect width="96" height="72" fill="#efe6da"/><rect x="0" y="30" width="96" height="42" rx="6" fill="${sofa}"/><rect x="0" y="22" width="96" height="16" rx="6" fill="${sofa}" opacity=".8"/><ellipse cx="${x}" cy="46" rx="18" ry="10" fill="${fur}"/><circle cx="${x + 15}" cy="38" r="8" fill="${fur}"/><path d="M${x + 9} 33l2-7 4 5zM${x + 16} 31l5-5 1 7z" fill="${fur}"/><circle cx="${x + 13}" cy="37" r="1" fill="#222"/><circle cx="${x + 18}" cy="37" r="1" fill="#222"/><path d="M${x - 18} 48q-10 -2 -8 -10" stroke="${fur}" stroke-width="4" fill="none" stroke-linecap="round"/>`);
  }
  if (/sea at sunset/.test(title)) return svg(96, 72, `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2a6b"/><stop offset=".55" stop-color="#f08a4b"/><stop offset="1" stop-color="#ffd27a"/></linearGradient></defs><rect width="96" height="44" fill="url(#s)"/><circle cx="58" cy="42" r="9" fill="#ffe3a0"/><rect y="42" width="96" height="30" fill="#2b3f66"/><path d="M40 48h36M46 54h24M52 60h12" stroke="#ffc978" stroke-width="1.5" opacity=".8"/>`);
  if (/portrait/.test(title)) {
    const edited = /edited/.test(title);
    return svg(96, 72, `<rect width="96" height="72" fill="${edited ? "#6fae5a" : "#7c9a6a"}"/><circle cx="20" cy="18" r="16" fill="${edited ? "#9fd07f" : "#93b27f"}"/><circle cx="80" cy="14" r="20" fill="${edited ? "#8cc46c" : "#86a574"}"/><path d="M30 72q0-24 18-24t18 24z" fill="${edited ? "#c0392b" : "#a23b33"}"/><circle cx="48" cy="36" r="10" fill="${edited ? "#f2c9a0" : "#d8b18e"}"/><path d="M38 34q2-12 10-12t10 12q-4-6-10-6t-10 6z" fill="#3a2a20"/>`);
  }
  if (/dog/.test(title)) {
    const beach = /beach/.test(title);
    const x = /running/.test(title) ? 58 : 44;
    return svg(96, 72, `<rect width="96" height="40" fill="${beach ? "#8ec5e8" : "#bfe3f2"}"/>${beach ? `<rect y="30" width="96" height="12" fill="#3f86b8"/><rect y="42" width="96" height="30" fill="#e8d3a2"/>` : `<rect y="38" width="96" height="34" fill="#6aa84f"/><circle cx="12" cy="30" r="12" fill="#4f8a3a"/>`}<ellipse cx="${x}" cy="50" rx="14" ry="7" fill="#b07a45"/><circle cx="${x + 14}" cy="42" r="6" fill="#b07a45"/><path d="M${x + 10} 38l-2 7 5-3z" fill="#7a4f2a"/><path d="M${x - 10} 55v8M${x - 4} 55v8M${x + 6} 55v8M${x + 10} 55v8" stroke="#b07a45" stroke-width="3" stroke-linecap="round"/><path d="M${x - 14} 48l-6-5" stroke="#b07a45" stroke-width="3" stroke-linecap="round"/>`);
  }
  return svg(96, 72, `<rect width="96" height="72" fill="#9aa5b1"/>`);
}
/** A 64 by 64 face: a coloured ground, the head and the shoulders. */
function face(r: () => number): string {
  const bg = ["#c7d7f0", "#f0d7c7", "#d5ecd0", "#e6d3ef"][Math.floor(r() * 4)], skin = ["#f1c7a5", "#d9a27e", "#b67d57", "#eac1a0"][Math.floor(r() * 4)], hair = ["#2e211a", "#6b4a2f", "#b58a4c", "#1c1c1c"][Math.floor(r() * 4)];
  return svg(64, 64, `<rect width="64" height="64" fill="${bg}"/><path d="M12 64q0-20 20-20t20 20z" fill="${["#3d5a80", "#8d3b50", "#3f7d5c"][Math.floor(r() * 3)]}"/><circle cx="32" cy="28" r="12" fill="${skin}"/><path d="M19 27q1-15 13-15t13 15q-4-8-13-8t-13 8z" fill="${hair}"/>`);
}
/** The mock's picture for each asset and face, as the extension inlines it, to the scene that replaces it. */
const pictures = new Map<string, string>();
const png = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;
for (const a of ASSETS) { const n = Number(a.id.slice(0, 8)); pictures.set(png(picture(n, 96, 72)), scene(a.title, seeded(n))); }
for (const p of PEOPLE) { const n = Number(p.id.slice(1)); pictures.set(png(picture(100 + n, 64, 64)), face(seeded(100 + n))); }
const withScenes = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, (d) => pictures.get(d) ?? d));

// ---- the fixture ---------------------------------------------------------------------------------

const { server, base } = startMock();
const cache = mkdtempSync(join(tmpdir(), "pal-immich-fixture-"));
process.env.PAL_IMMICH_CACHE = cache;
stored.clear();
const host = await Host.bundled({ settings: { immich: { settings: { url: base, api_key: "admin", web_url: "https://photos.example.com" } } } });
try {
  const l = host.loaded().find((l) => l.extension === "immich")!;
  const [grid, albums, people, memories] = l.palettes;
  // The pane's picture is the core's file route over the cache, which the gallery cannot serve: the tile's own data url stands in.
  const inline = (rows: Item[]) => rows.map((r) => ({ ...r, detail: r.detail && { ...r.detail, markdown: (r.icon as { image?: string })?.image ? `![](${(r.icon as { image: string }).image})` : undefined } }));
  const recent = inline(await host.list("immich", "immich", ""));
  const receipt = inline(await host.list("immich", "immich", "receipt"));
  const albumRows = await host.list("immich", "albums");
  const peopleRows = await host.list("immich", "people");
  const memoryRows = await host.list("immich", "memories");
  const meta = { icon: grid.icon, input: true, view: "grid", columns: grid.columns, placeholder: grid.placeholder, showDetail: true, filters: grid.filters };
  const list = (p: typeof albums, items: Item[]) => ({ title: p.title, icon: p.icon, placeholder: p.placeholder, live: p.live, items });
  const fixture = {
    palettes: {
      immich: { title: grid.title, ...meta, byQuery: { "": recent, receipt } },
      albums: list(albums, albumRows),
      people: list(people, peopleRows),
      memories: list(memories, memoryRows),
    },
    shots: {
      "1-recent": { palette: "immich", keys: [], caption: "Nothing typed: the newest uploads, the pane open on the first" },
      "2-search": { palette: "immich", keys: ["type:receipt", "wait:400", "right"], caption: "A CLIP search: what is in the picture, the place and date on every tile" },
      "3-actions": { palette: "immich", keys: ["type:receipt", "wait:400", "cmd+k"], caption: "What a photo can do: open, copy, download, favourite, add to an album, Quick Look" },
      "4-albums": { palette: "albums", keys: ["down"], caption: "Albums: the cover, the count, the dates, the library's numbers on top" },
      "5-people": { palette: "people", keys: [], caption: "People by face, favourites first" },
      "6-memories": { palette: "memories", keys: [], caption: "On this day: a row per year, Enter opens that year's photos" },
    },
  };
  writeFixture("immich", await settle(withScenes(fixture), { hosts: { [base]: "https://photos.example.com" } }));
  console.log("wrote app/src/gallery/shots/immich.json");
} finally {
  host.kill();
  server.stop(true);
  rmSync(cache, { recursive: true, force: true });
}
