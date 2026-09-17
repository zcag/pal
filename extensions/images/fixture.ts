// Writes app/src/gallery/shots/images.json, the store screenshots'
// fixture: pictures drawn here (host/test/extensions/images-png.ts) in a
// temp folder, listed through the host harness as the Finder selection
// and the clipboard, one compressed so a Results row shows; the resize and
// convert levels and the web view come from the same run. Nothing is the
// owner's; the folder reads as ~/Desktop/site in the shots. Thumbnails are
// data urls here (`PAL_IMAGES_DATA_THUMBS`), since the gallery has no
// `icon://` scheme. `bun run extensions/images/fixture.ts`, then
// `node app/scripts/shots.mjs images`.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Host } from "../../host/test/harness.ts";
import { png, type Pixel } from "../../host/test/extensions/images-png.ts";

const dir = mkdtempSync(join(tmpdir(), "pal-images-fixture-"));
/** A soft two-tone picture with a disc and a band, so the thumbnails read as photos rather than noise. */
const paint = (hue: [number, number, number], hue2: [number, number, number], w: number, h: number): Pixel => (x, y) => {
  const t = x / w, u = y / h;
  const mix = (i: number) => hue[i] * (1 - t) + hue2[i] * t;
  const d = Math.hypot(x - w * 0.62, y - h * 0.42);
  const disc = d < Math.min(w, h) * 0.22 ? 0.35 : 0;
  const band = Math.abs(x - y * 1.3 - w * 0.1) < w * 0.03 ? 0.18 : 0;
  const k = 1 - u * 0.25 + disc - band;
  return [Math.min(255, mix(0) * k), Math.min(255, mix(1) * k), Math.min(255, mix(2) * k), 255];
};
const files: [string, number, number, [number, number, number], [number, number, number]][] = [
  ["hero.png", 1600, 1000, [236, 112, 99], [244, 200, 120]],
  ["screenshot 2026-09-16.png", 1440, 900, [120, 140, 220], [200, 220, 250]],
  ["IMG_4021.jpg", 2000, 1333, [60, 120, 90], [220, 200, 140]],
  ["logo.png", 512, 512, [210, 63, 156], [255, 255, 255]],
];
for (const [name, w, h, a, b] of files) writeFileSync(join(dir, name.replace(/\.jpg$/, ".png")), png(w, h, paint(a, b, w, h)));
Bun.spawnSync(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "92", join(dir, "IMG_4021.png"), "--out", join(dir, "IMG_4021.jpg")]);
Bun.spawnSync(["sips", "-s", "make", "Apple", "-s", "model", "iPhone 15 Pro", join(dir, "IMG_4021.jpg")]);
rmSync(join(dir, "IMG_4021.png"));
mkdirSync(join(dir, "clip"));
writeFileSync(join(dir, "clip", "pasted.png"), png(800, 500, paint([90, 90, 110], [160, 200, 210], 800, 500)));

process.env.PAL_IMAGES_SELECTION = files.map(([n]) => join(dir, n)).join("\n");
process.env.PAL_IMAGES_CACHE = join(dir, "cache");
process.env.PAL_IMAGES_DATA_THUMBS = "1";
const clip = { id: 3, kind: "image", image: join(dir, "clip", "pasted.png"), text: null, files: null, source_app: "com.apple.screencapture", at: Date.now(), bytes: 1, pinned: false, width: 800, height: 500 };
const host = await Host.bundled({ settings: { images: { settings: { tinypng_api_key: "" } } }, core: { "clipboard.current": () => clip, "ocr.available": () => true } });
try {
  const meta = host.loaded().find((l) => l.extension === "images")!.palettes[0];
  const hero = join(dir, "hero.png"), photo = join(dir, "IMG_4021.jpg");
  await host.pick("images", "images", hero, "compress");
  const rows = await host.list("images", "images", "");
  const details: Record<string, unknown> = {};
  for (const r of rows) if (r.id.startsWith("/")) details[r.id] = await host.detail("images", "images", r.id);
  const resize = await host.list("images", "images", "", { args: { op: "resize", files: [hero] } });
  // Convert with cwebp left out of the tools, so the WebP row shows what a missing tool looks like.
  host.changeSettings("images", { settings: { tools: ["pngquant", "oxipng", "cjpeg", "avifenc", "sips"], tinypng_api_key: "" } });
  await Bun.sleep(50);
  const convert = await host.list("images", "images", "", { args: { op: "convert", files: [hero] } });
  host.changeSettings("images", { settings: { tinypng_api_key: "" } });
  await Bun.sleep(50);
  const web = await host.pick("images", "images", hero, "web", { ids: [hero, photo, join(dir, "logo.png")] });
  const fixture = {
    palettes: { images: { title: meta.title, icon: meta.icon, input: true, showDetail: true, placeholder: meta.placeholder, byQuery: { "": rows }, levels: { resize, convert }, details } },
    effects: {
      [`images/${hero}:resize`]: { push: { extension: "", palette: "images", args: "resize", title: "Resize hero.png" } },
      [`images/${hero}:convert`]: { push: { extension: "", palette: "images", args: "convert", title: "Convert hero.png" } },
      [`images/${hero}:web`]: { view: web.view },
    },
    shots: {
      "1-images": { palette: "images", keys: ["down"] },
      "2-actions": { palette: "images", keys: ["down", "cmd+k"] },
      "3-detail": { palette: "images", keys: ["down*3"] },
      "4-resize": { palette: "images", keys: ["down", "cmd+shift+r"] },
      "5-convert": { palette: "images", keys: ["down", "cmd+shift+v", "down"] },
      "6-web": { palette: "images", keys: ["down", "cmd+enter"] },
    },
  };
  const text = JSON.stringify(fixture, null, 2).split(join(dir, "cache", "clipboard")).join("~/Library/Caches/pal/images/clipboard").split(dir).join("~/Desktop/site");
  writeFileSync(new URL("../../app/src/gallery/shots/images.json", import.meta.url), text + "\n");
  console.log("wrote app/src/gallery/shots/images.json", rows.length, "rows");
} finally {
  host.kill();
  rmSync(dir, { recursive: true, force: true });
}
