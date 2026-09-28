// Writes app/src/gallery/shots/downloads.json, the store screenshots'
// fixture: a temp folder filled with made-up downloads (dated across the
// sections, two generated pictures for the thumbnails, a Chrome partial
// growing between two listings) listed through the host harness, the
// temp path scrubbed to ~/Downloads, at the fixed clock. The partial's rate
// is measured on the real clock between the two listings, so it is said
// again (scan.ts `rate`) as if exactly a second had passed. Nothing is the owner's.
// `bun run extensions/downloads/fixture.ts`, then `node app/scripts/shots.mjs downloads`.
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytes } from "@zcag/pal";
import { NOW, pinClock, writeFixture } from "../../app/scripts/fixture-kit.ts";
import { Host } from "../../host/test/harness.ts";
import { rate } from "./scan.ts";
import { png } from "../../host/test/png.ts";

const sunset = png(96, 64, (x, y) => [Math.round(240 - y * 1.6), Math.round(120 + x * 0.6 - y), Math.round(80 + y * 2)]);
const plot = png(96, 64, (x, y) => (Math.abs(y - (32 + 20 * Math.sin(x / 8))) < 2 ? [60, 90, 220] : (x % 16 === 0 || y % 16 === 0 ? [225, 228, 235] : [250, 250, 252])));

// ---- the folder ---------------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), "pal-downloads-fixture-"));
const folder = join(root, "Downloads");
mkdirSync(folder);
const now = NOW, H = 3600e3, D = 24 * H;
const put = (name: string, data: number | Buffer, age: number) => { const p = join(folder, name); writeFileSync(p, typeof data === "number" ? Buffer.alloc(data, 120) : data); utimesSync(p, new Date(now - age), new Date(now - age)); return p; };
put("pal-0.1.0-arm64.dmg", 24_800_000, 20 * 60e3);
// A picture's own bytes, then padding past its end (readers stop there), so the sizes read as a photo's and a plot's.
const padded = (b: Buffer, size: number) => Buffer.concat([b, Buffer.alloc(size - b.length)]);
put("Sunset at the pier.jpg", padded(sunset, 2_460_000), 2 * H);
put("Invoice 2026-09.pdf", 184_000, 5 * H);
put("Q3 metrics.xlsx", 96_000, 26 * H);
put("node-v24.8.0.pkg", 68_400_000, 30 * H);
put("latency-plot.png", padded(plot, 86_000), 3 * D);
put("design-tokens.zip", 1_240_000, 4 * D);
put("meeting-notes.md", 3_100, 6 * D);
put("bench.rb", 2_700, 12 * D);
put("2025 Transparency Report.pdf", 4_900_000, 41 * D);
put("IMG_4821.HEIC", 3_300_000, 60 * D);
const partial = put("ubuntu-26.04-desktop-arm64.iso.crdownload", 412_000_000, 40e3);
const cache = join(root, "cache");

process.env.PAL_DOWNLOADS_CACHE = cache;
pinClock();
const host = await Host.bundled({ settings: { downloads: { settings: { folder, browser_folders: false } } } });
try {
  const meta = host.loaded().find((l) => l.extension === "downloads")!.palettes[0];
  // Twice: the second listing has the partial's rate from its growth in between.
  await host.list("downloads", "downloads");
  await Bun.sleep(1000);
  const [before, after] = [412_000_000, 415_600_000];
  writeFileSync(partial, Buffer.alloc(after, 120));
  utimesSync(partial, new Date(now - 30e3), new Date(now - 30e3));
  const rows = (await host.list("downloads", "downloads")).map((r) => (r.section === "Downloading" ? { ...r, accessories: r.accessories!.map((a) => ("text" in a ? { text: `${bytes(after)} · ${rate(before, after, 1000)}` } : a)) } : r));
  const scrub = <T,>(v: T): T => JSON.parse(JSON.stringify(v).split(folder).join("~/Downloads"));
  const target = rows.find((r) => r.name === "Invoice 2026-09.pdf")!;
  // A temp file has no Spotlight "where from"; a real download carries the url and the page, so the shot shows them.
  const detail = scrub(await host.detail("downloads", "downloads", target.id));
  detail.metadata!.push({ label: "From", link: { text: "billing.example.com/invoices/2026-09.pdf", href: "https://billing.example.com/invoices/2026-09.pdf" } }, { label: "Page", link: { text: "billing.example.com/account/invoices", href: "https://billing.example.com/account/invoices" } });
  const details: Record<string, unknown> = { [scrub(target.id)]: detail };
  const move = await host.pick("downloads", "downloads", target.id, "move");
  // A file row has no actions of its own, the palette's are its (items.ts `toItem`); the gallery takes rows only, so they ride on each.
  const fixture = {
    palettes: { downloads: { title: meta.title, icon: meta.icon, live: true, tier: meta.tier, placeholder: meta.placeholder, items: scrub(rows).map((r) => (r.actions ? r : { ...r, actions: meta.actions })), details } },
    effects: { [`downloads/${scrub(target.id)}:move`]: scrub(move) },
    shots: {
      "1-downloads": { palette: "downloads", keys: ["down*2"], caption: "The folder newest first: a download coming in, then Today, Yesterday, This week, Older with sizes and ages" },
      "2-detail": { palette: "downloads", keys: ["down*3", "cmd+i"], caption: "The detail pane: name, folder, size, kind, modified, and the page the file came from" },
      "3-actions": { palette: "downloads", keys: ["down*3", "cmd+k"], caption: "What a download can do: open, reveal, copy, move, rename, trash" },
      "4-move": { palette: "downloads", keys: ["down*3", "cmd+m", "wait:300"], caption: "cmd+m moves it: a form with the target folder, created when it is missing" },
      "5-marked": { palette: "downloads", keys: ["down", "shift+down", "shift+down", "shift+down"], caption: "Three rows marked with shift+down (Tab marks too): open, reveal, copy or trash them at once" },
    },
  };
  writeFixture("downloads", fixture);
  console.log("wrote app/src/gallery/shots/downloads.json");
} finally {
  host.kill();
  rmSync(root, { recursive: true, force: true });
}
