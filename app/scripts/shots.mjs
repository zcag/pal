#!/usr/bin/env node
// Store screenshots: drives `?gallery&shot=<extension>` (src/gallery/shots.tsx)
// in a headless Chrome and saves each shot the fixture plans to
// extensions/<extension>/screenshots/<file>.png, 1440x900 device pixels
// (a 960x600 viewport at 1.5x: the 760x480 panel centred on the wallpaper).
//
//   node app/scripts/shots.mjs [extension ...]     # all fixtures when none named
//   SHOTS_URL=http://127.0.0.1:1430 (a Vite dev server: `npx vite --port 1430`)
//
// A fixture's `shots` maps a file name to { palette?, keys?, caption? }:
// `palette` opens that palette first; `keys` are pressed in order, each
// "type:<text>", "down", "up", "down*3", "tab", "enter", "escape",
// "cmd+i", "cmd+k", "cmd+shift+c", or "wait:<ms>". The captions go to
// pal.json's store.screenshots by hand. Each PNG is then quantised to 256
// colours by shot-quant.py (Pillow; a third of the size, the saturated
// colours kept); without Pillow the full PNG stays.
import { readFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const fixtures = join(root, "app/src/gallery/shots");
const base = process.env.SHOTS_URL ?? "http://127.0.0.1:1430";
const pw = process.env.PLAYWRIGHT ?? "/Users/cagdas/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core/index.mjs";
const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const { chromium } = await import(pw);
const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(fixtures).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

const keyOf = { down: "ArrowDown", up: "ArrowUp", left: "ArrowLeft", right: "ArrowRight", tab: "Tab", enter: "Enter", escape: "Escape", backspace: "Backspace", space: "Space" };
const combo = (s) => s.split("+").map((k) => ({ cmd: "Meta", shift: "Shift", alt: "Alt", ctrl: "Control" })[k] ?? keyOf[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join("+");

async function press(page, step) {
  if (step.startsWith("type:")) return page.keyboard.type(step.slice(5), { delay: 8 });
  if (step.startsWith("wait:")) return page.waitForTimeout(Number(step.slice(5)));
  const [key, times = "1"] = step.split("*");
  for (let i = 0; i < Number(times); i++) { await page.keyboard.press(combo(key)); await page.waitForTimeout(40); }
}

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
const context = await browser.newContext({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 1.5, colorScheme: "light" });
const page = await context.newPage();
page.on("pageerror", (e) => console.error("  page error:", e.message));
let failed = 0;
for (const name of names) {
  const fx = JSON.parse(readFileSync(join(fixtures, `${name}.json`), "utf8"));
  const shots = fx.shots ?? {};
  const out = join(root, "extensions", name, "screenshots");
  if (!existsSync(join(root, "extensions", name))) { console.error(`${name}: no extension directory`); failed++; continue; }
  mkdirSync(out, { recursive: true });
  for (const [file, shot] of Object.entries(shots)) {
    const url = `${base}/?gallery&shot=${name}${shot.palette ? `&palette=${encodeURIComponent(shot.palette)}` : ""}`;
    try {
      // A fresh document per shot: the same URL twice would keep the previous shot's state.
      await page.goto("about:blank");
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForSelector("html[data-ready]", { timeout: 10000 });
      await page.waitForTimeout(250);
      for (const step of shot.keys ?? []) await press(page, step);
      await page.waitForTimeout(shot.settle ?? 450);
      const path = join(out, `${file}.png`);
      await page.screenshot({ path, type: "png" });
      const q = process.env.SHOTS_RAW ? { status: 0 } : spawnSync("python3", [join(here, "shot-quant.py"), path]);
      console.log(`${name}/${file}.png${q.status === 0 ? "" : " (not quantised: no Pillow)"}`);
    } catch (e) {
      failed++;
      console.error(`${name}/${file}: ${e.message.split("\n")[0]}`);
    }
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
