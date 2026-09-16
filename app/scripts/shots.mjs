#!/usr/bin/env node
// Store screenshots: drives `?gallery&shot=<extension>` (src/gallery/shots.tsx)
// in a headless Chrome and saves each shot the fixture plans to
// extensions/<extension>/screenshots/<file>.png, 1440x900 device pixels
// (a 960x600 viewport at 1.5x: the 760x480 panel centred on the wallpaper).
//
//   node app/scripts/shots.mjs [extension ...]     # all fixtures when none named
//   node app/scripts/shots.mjs bar [extension ...] # bar items (below)
//   SHOTS_URL=http://127.0.0.1:1430 (a Vite dev server: `npx vite --port 1430`)
//
// A fixture's `shots` maps a file name to { palette?, keys?, caption?, raw? }:
// `palette` opens that palette first; `keys` are pressed in order, each
// "type:<text>", "down", "up", "down*3", "tab", "enter", "escape",
// "cmd+i", "cmd+k", "cmd+shift+c", or "wait:<ms>". The captions go to
// pal.json's store.screenshots by hand. Each PNG is then quantised to 256
// colours by shot-quant.py (Pillow; a third of the size, the saturated
// colours kept); without Pillow the full PNG stays.
//
// `bar` mode drives `?gallery&bar=<ext>/<id>` (src/gallery/bar-shot.tsx) from
// `shots/bar-<extension>.json`: each of the fixture's `shots` (bar-menubar-dark,
// bar-menubar-light, bar-menubar-popover, bar-sketchybar) is a 720-wide strip
// at 2x (1440x120; taller with the popover open, the page says how tall in
// `data-h`), saved next to the panel shots and appended to pal.json's
// store.screenshots with its caption and `kind: "bar"` when not listed yet.
import { readFileSync, readdirSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
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
const args = process.argv.slice(2);
const barMode = args[0] === "bar";
if (barMode) args.shift();
const fixtureOf = (name) => (barMode ? `bar-${name}` : name);
const names = args.length ? args : readdirSync(fixtures).filter((f) => f.endsWith(".json") && f.startsWith("bar-") === barMode).map((f) => f.slice(barMode ? 4 : 0, -5));

const keyOf = { down: "ArrowDown", up: "ArrowUp", left: "ArrowLeft", right: "ArrowRight", tab: "Tab", enter: "Enter", escape: "Escape", backspace: "Backspace", space: "Space" };
const combo = (s) => s.split("+").map((k) => ({ cmd: "Meta", shift: "Shift", alt: "Alt", ctrl: "Control" })[k] ?? keyOf[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join("+");

async function press(page, step) {
  if (step.startsWith("type:")) return page.keyboard.type(step.slice(5), { delay: 8 });
  if (step.startsWith("wait:")) return page.waitForTimeout(Number(step.slice(5)));
  const [key, times = "1"] = step.split("*");
  for (let i = 0; i < Number(times); i++) { await page.keyboard.press(combo(key)); await page.waitForTimeout(40); }
}

/** A shot with `raw: true` keeps its true colours: a colour picker's gradients do not survive 256 colours. */
const quant = (path, raw) => (process.env.SHOTS_RAW || raw ? { status: 0 } : spawnSync("python3", [join(here, "shot-quant.py"), path]));

/** The bar strip's URL for one of the fixture's shots. */
const barUrl = (key, shot) => {
  const q = new URLSearchParams({ bar: key, target: shot.target, theme: shot.theme });
  if (shot.state) q.set("state", shot.state);
  if (shot.popover) q.set("popover", "1");
  return `${base}/?gallery&${q}`;
};

/** Appends the bar shots the manifest does not list yet to `store.screenshots`, with `kind: "bar"` (STORE-FIELDS.md). */
function listInManifest(name, entries) {
  const path = join(root, "extensions", name, "pal.json");
  const text = readFileSync(path, "utf8");
  const manifest = JSON.parse(text);
  const list = (manifest.store ??= {}).screenshots ??= [];
  let added = 0;
  for (const { file, caption } of entries) {
    if (list.some((s) => s.file === file)) continue;
    list.push({ file, caption, kind: "bar" });
    added++;
  }
  if (added) writeFileSync(path, JSON.stringify(manifest, null, 2) + (text.endsWith("\n") ? "\n" : ""));
  return added;
}

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
const context = await browser.newContext({
  viewport: barMode ? { width: 720, height: 60 } : { width: 960, height: 600 }, deviceScaleFactor: barMode ? 2 : 1.5, colorScheme: "light",
});
const page = await context.newPage();
page.on("pageerror", (e) => console.error("  page error:", e.message));
let failed = 0;
for (const name of names) {
  const fx = JSON.parse(readFileSync(join(fixtures, `${fixtureOf(name)}.json`), "utf8"));
  const shots = fx.shots ?? {};
  const out = join(root, "extensions", name, "screenshots");
  if (!existsSync(join(root, "extensions", name))) { console.error(`${name}: no extension directory`); failed++; continue; }
  mkdirSync(out, { recursive: true });
  const done = [];
  for (const [file, shot] of Object.entries(shots)) {
    const url = barMode ? barUrl(fx.key, shot) : `${base}/?gallery&shot=${name}${shot.palette ? `&palette=${encodeURIComponent(shot.palette)}` : ""}`;
    try {
      // A fresh document per shot: the same URL twice would keep the previous shot's state.
      await page.goto("about:blank");
      if (barMode) await page.setViewportSize({ width: 720, height: 60 });
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForSelector("html[data-ready]", { timeout: 10000 });
      await page.waitForTimeout(250);
      if (barMode) {
        // The strip says how tall it is (60, or the popover's height under the band); the viewport follows before the shot.
        const h = Number(await page.evaluate(() => document.documentElement.dataset.h)) || 60;
        if (h !== 60) { await page.setViewportSize({ width: 720, height: h }); await page.waitForTimeout(100); }
      }
      for (const step of shot.keys ?? []) await press(page, step);
      await page.waitForTimeout(shot.settle ?? 450);
      const path = join(out, `${file}.png`);
      await page.screenshot({ path, type: "png" });
      const q = quant(path, shot.raw);
      console.log(`${name}/${file}.png${shot.raw ? " (raw)" : q.status === 0 ? "" : " (not quantised: no Pillow)"}`);
      done.push({ file: `${file}.png`, caption: shot.caption });
    } catch (e) {
      failed++;
      console.error(`${name}/${file}: ${e.message.split("\n")[0]}`);
    }
  }
  if (barMode && done.length) {
    const added = listInManifest(name, done);
    if (added) console.log(`${name}/pal.json: ${added} bar screenshot${added === 1 ? "" : "s"} listed`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
