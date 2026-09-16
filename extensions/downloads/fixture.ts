// Writes app/src/gallery/shots/downloads.json, the store screenshots'
// fixture: a temp folder filled with made-up downloads (dated across the
// sections, two generated pictures for the thumbnails, a Chrome partial
// growing between two listings) listed through the host harness, the
// temp path scrubbed to ~/Downloads. Nothing is the owner's.
// `bun run extensions/downloads/fixture.ts`, then `node app/scripts/shots.mjs downloads`.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { Host } from "../../host/test/harness.ts";

// ---- a small PNG writer, so the thumbnails are pictures rather than flat colour ----

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function png(w: number, h: number, rgb: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) raw.set(rgb(x, y), y * (w * 3 + 1) + 1 + x * 3); }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]);
}
const sunset = png(96, 64, (x, y) => [Math.round(240 - y * 1.6), Math.round(120 + x * 0.6 - y), Math.round(80 + y * 2)]);
const plot = png(96, 64, (x, y) => (Math.abs(y - (32 + 20 * Math.sin(x / 8))) < 2 ? [60, 90, 220] : (x % 16 === 0 || y % 16 === 0 ? [225, 228, 235] : [250, 250, 252])));

// ---- the folder ---------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "pal-downloads-fixture-"));
const folder = join(root, "Downloads");
mkdirSync(folder);
const now = Date.now(), H = 3600e3, D = 24 * H;
const put = (name: string, bytes: number | Buffer, age: number) => { const p = join(folder, name); writeFileSync(p, typeof bytes === "number" ? Buffer.alloc(bytes, 120) : bytes); utimesSync(p, new Date(now - age), new Date(now - age)); return p; };
put("pal-0.1.0-arm64.dmg", 24_800_000, 20 * 60e3);
put("Sunset over Kadıköy.jpg", sunset, 2 * H);
put("Invoice 2026-09.pdf", 184_000, 5 * H);
put("Q3 metrics.xlsx", 96_000, 26 * H);
put("node-v24.8.0.pkg", 68_400_000, 30 * H);
put("latency-plot.png", plot, 3 * D);
put("design-tokens.zip", 1_240_000, 4 * D);
put("meeting-notes.md", 3_100, 6 * D);
put("bench.rb", 2_700, 12 * D);
put("2025 Transparency Report.pdf", 4_900_000, 41 * D);
put("IMG_4821.HEIC", 3_300_000, 60 * D);
const partial = put("ubuntu-26.04-desktop-arm64.iso.crdownload", 412_000_000, 40e3);
const cache = join(root, "cache");

process.env.PAL_DOWNLOADS_CACHE = cache;
const host = await Host.bundled({ settings: { downloads: { settings: { folder, browser_folders: false } } } });
try {
  const meta = host.loaded().find((l) => l.extension === "downloads")!.palettes[0];
  // Twice: the second listing has the partial's rate from its growth in between.
  await host.list("downloads", "downloads");
  await Bun.sleep(1000);
  writeFileSync(partial, Buffer.alloc(415_600_000, 120));
  utimesSync(partial, new Date(now - 30e3), new Date(now - 30e3));
  const rows = await host.list("downloads", "downloads");
  const scrub = <T,>(v: T): T => JSON.parse(JSON.stringify(v).split(folder).join("~/Downloads"));
  const target = rows.find((r) => r.name === "Invoice 2026-09.pdf")!;
  // A temp file has no Spotlight "where from"; a real download carries the url and the page, so the shot shows them.
  const detail = scrub(await host.detail("downloads", "downloads", target.id));
  detail.metadata!.push({ label: "From", link: { text: "billing.example.com/invoices/2026-09.pdf", href: "https://billing.example.com/invoices/2026-09.pdf" } }, { label: "Page", link: { text: "billing.example.com/account/invoices", href: "https://billing.example.com/account/invoices" } });
  const details: Record<string, unknown> = { [scrub(target.id)]: detail };
  const move = await host.pick("downloads", "downloads", target.id, "move");
  const fixture = {
    palettes: { downloads: { title: meta.title, icon: meta.icon, live: true, tier: meta.tier, placeholder: meta.placeholder, items: scrub(rows), details } },
    effects: { [`downloads/${scrub(target.id)}:move`]: scrub(move) },
    shots: {
      "1-downloads": { palette: "downloads", keys: ["down*2"] },
      "2-detail": { palette: "downloads", keys: ["down*3", "cmd+i"] },
      "3-actions": { palette: "downloads", keys: ["down*3", "cmd+k"] },
      "4-move": { palette: "downloads", keys: ["down*3", "cmd+m", "wait:300"] },
      "5-marked": { palette: "downloads", keys: ["down", "shift+down", "shift+down", "shift+down"] },
    },
  };
  writeFileSync(new URL("../../app/src/gallery/shots/downloads.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
  console.log("wrote app/src/gallery/shots/downloads.json");
} finally {
  host.kill();
  rmSync(root, { recursive: true, force: true });
}
