#!/usr/bin/env node
// The landing page's hero loop: drives `?gallery&shot=hero` (the fixture
// shots/hero.json) through three things the panel does, at 2x, and saves
// one PNG per moment with how long it holds; ffmpeg then stitches them
// into an mp4 and a webm, and the "chr" frame is the poster (webp, cwebp).
// Once per theme (the gallery draws the dark one over the site's dark desk).
//
//   node app/scripts/hero.mjs [out-dir]     # default ../pal-site/web/static/landing
//   SHOTS_URL=http://127.0.0.1:1430 (a Vite dev server: `npx vite --port 1430`)
//
// The three moments: `chr` finds Chrome; `12 usd to try` is answered at the
// root by Calculator; `#ff8800` by Convert Colour, and Enter opens the picker.
import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.SHOTS_URL ?? "http://127.0.0.1:1430";
const pw = process.env.PLAYWRIGHT ?? "/Users/cagdas/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = resolve(process.argv[2] ?? join(here, "../../../pal-site/web/static/landing"));
const { chromium } = await import(pw);

const keyOf = { down: "ArrowDown", enter: "Enter", escape: "Escape", backspace: "Backspace" };

/** The loop as moments: what to do, then how long the frame after it holds (seconds). */
const script = [
  ["hold", 1.0],
  ["type", "c", 0.22], ["type", "h", 0.2], ["type", "r", 1.9, "poster"],
  ["key", "escape", 0.7],
  ...[..."12 usd to try"].map((c, i, a) => ["type", c, i === a.length - 1 ? 2.4 : c === " " ? 0.16 : 0.1]),
  ["key", "escape", 0.7],
  ...[..."#ff8800"].map((c, i, a) => ["type", c, i === a.length - 1 ? 1.3 : 0.12]),
  ["key", "enter", 2.6],
  ["key", "escape", 0.35], ["key", "escape", 0.6],
];

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
for (const theme of ["light", "dark"]) {
  const dir = join(out, `frames-${theme}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 880, height: 580 }, deviceScaleFactor: 2, colorScheme: theme });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error("  page error:", e.message));
  await page.goto(`${base}/?gallery&shot=hero&theme=${theme}`, { waitUntil: "networkidle" });
  await page.waitForSelector("html[data-ready]", { timeout: 10000 });
  await page.waitForTimeout(400);
  const list = [];
  let n = 0;
  for (const [what, arg, hold, tag] of script) {
    if (what === "type") await page.keyboard.type(arg);
    if (what === "key") await page.keyboard.press(keyOf[arg]);
    // The inline answer arrives 120 ms after the last key (Launcher's ROOT_DEBOUNCE); a settle covers it and the view's fade.
    await page.waitForTimeout(what === "hold" ? 0 : 260);
    const file = join(dir, `${String(n++).padStart(3, "0")}.png`);
    await page.screenshot({ path: file, type: "png" });
    list.push(`file '${file}'\nduration ${what === "hold" ? arg : hold}`);
    if (tag === "poster") spawnSync("cwebp", ["-quiet", "-q", "86", file, "-o", join(out, `hero-${theme}.webp`)]); // brew install webp
  }
  list.push(`file '${join(dir, `${String(n - 1).padStart(3, "0")}.png`)}'`); // concat wants the last frame twice
  writeFileSync(join(dir, "list.txt"), list.join("\n") + "\n");
  await context.close();
  const common = ["-y", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf", "fps=24,format=yuv420p"];
  const mp4 = spawnSync("ffmpeg", [...common, "-c:v", "libx264", "-crf", "22", "-preset", "slow", "-tune", "stillimage", "-movflags", "+faststart", join(out, `hero-${theme}.mp4`)], { stdio: "inherit" });
  const webm = spawnSync("ffmpeg", [...common, "-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-row-mt", "1", join(out, `hero-${theme}.webm`)], { stdio: "inherit" });
  if (mp4.status || webm.status) process.exit(1);
  rmSync(dir, { recursive: true, force: true });
  for (const f of readdirSync(out).filter((f) => f.startsWith(`hero-${theme}.`))) console.log(`${f}: ${(statSync(join(out, f)).size / 1024).toFixed(0)} KB`);
}
await browser.close();
