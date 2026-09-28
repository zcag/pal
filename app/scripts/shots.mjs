#!/usr/bin/env node
// The store screenshots (docs/design/screenshots.md): for each extension,
// every panel shot its fixture plans (`src/gallery/shots/<name>.json`,
// `?gallery&shot=<name>`) and every bar shot (`shots/bar-<name>.json`,
// `?gallery&bar=...`), each on the light theme as `<file>.png` and on the
// dark one as `<file>-dark.png`, into extensions/<name>/screenshots/. Then
// the directory holds exactly those (an older picture is removed),
// `store.screenshots` in pal.json lists the light ones with the fixtures'
// captions, and `screenshots/.shots.json` stamps the fixtures' hash, which
// host/test/screenshots.test.ts checks. `make shots` runs this with the
// fixtures regenerated and a Vite server up; run by hand:
//
//   node app/scripts/shots.mjs [extension ...]      # every extension with a fixture when none named
//   SHOTS_URL=http://127.0.0.1:1430                  # the gallery (`npx vite --port 1430` in app/)
//   SHOTS_OUT=dir                                     # the landing page's renders: <dir>/<extension>-<file>-<theme>.png, nothing else touched
//   SHOTS_RAW=1                                       # keep true colour (no 256-colour quantising)
//
// A panel shot is { palette?, keys?, caption, raw?, settle? }: `palette`
// opens that palette first; `keys` are pressed in order ("type:<text>",
// "down", "down*3", "enter", "escape", "cmd+k", "wait:<ms>"); `raw` keeps true
// colour (a colour picker's gradients). A bar shot is { target, state?,
// popover?, caption } under the names `menubar`, `popover`, `sketchybar`,
// `menubar-<state>`, `popover-<state>`. The browser is playwright-core's
// own Chrome for Testing (`npx playwright-core install chromium`), never the
// daily one.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { FIXTURES as fixtures, NOW, ROOT as root, TZ, barFixtureOf, fixtureHash, fixtureOf } from "./shots-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.SHOTS_URL ?? "http://127.0.0.1:1430";
const outDir = process.env.SHOTS_OUT;
const THEMES = ["light", "dark"];
const read = (f) => JSON.parse(readFileSync(f, "utf8"));

const args = process.argv.slice(2);
const names = args.length
  ? args
  : [...new Set(readdirSync(fixtures).filter((f) => f.endsWith(".json")).map((f) => f.replace(/^bar-/, "").slice(0, -5)))].filter((n) => existsSync(join(root, "extensions", n))).sort();

const keyOf = { down: "ArrowDown", up: "ArrowUp", left: "ArrowLeft", right: "ArrowRight", tab: "Tab", enter: "Enter", escape: "Escape", backspace: "Backspace", space: "Space" };
const combo = (s) => s.split("+").map((k) => ({ cmd: "Meta", shift: "Shift", alt: "Alt", ctrl: "Control" })[k] ?? keyOf[k] ?? k).join("+");  // a letter as written: "s" is e.key "s", as a page compares it
async function press(page, step) {
  if (step.startsWith("type:")) return page.keyboard.type(step.slice(5), { delay: 8 });
  if (step.startsWith("wait:")) return page.waitForTimeout(Number(step.slice(5)));
  const [key, times = "1"] = step.split("*");
  for (let i = 0; i < Number(times); i++) { await page.keyboard.press(combo(key)); await page.waitForTimeout(40); }
}

/** 256 colours unless the shot or SHOTS_RAW keeps true colour (shot-quant.py, pngquant; a quarter of the size). */
const quant = (path, raw) => (process.env.SHOTS_RAW || raw ? true : spawnSync("python3", [join(here, "shot-quant.py"), path]).status === 0);

const browser = await chromium.launch({ headless: true, args: ["--force-color-profile=srgb", "--hide-scrollbars"] });
let failed = 0;

async function shoot({ url, viewport, scale, theme, keys, settle, path, raw }) {
  // en-GB: a page's own toLocale* reads as the SDK writes dates (16 Sep, 14:32), not the headless default's Sep 16, 02:32 PM.
  const context = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: theme, timezoneId: TZ, locale: "en-GB" });
  // The fixtures' clock: Date reads NOW (timers still run, so a page settles and animates as it would).
  await context.clock.setFixedTime(NOW);
  // Chance, seeded in every frame (a game's deal, a page's shuffle): the same picture every run (fixture-kit's seeded(42), mulberry32).
  await context.addInitScript(() => {
    let a = 42;
    Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForSelector("html[data-ready]", { timeout: 10000 });
    // data-ready says the fixture is in; the palette it opens lands a few frames later (the Launcher's open, its first search). Keys pressed before then are lost, so wait until the page stops changing.
    await page.waitForFunction(() => {
      const w = window, html = document.body.innerHTML;
      if (w.__shotHtml !== html) { w.__shotHtml = html; w.__shotSince = performance.now(); return false; }
      return performance.now() - w.__shotSince > 300 && (!document.activeElement || document.activeElement !== document.body || !document.querySelector("input"));
    }, null, { timeout: 5000, polling: 50 }).catch(() => {});
    for (const step of keys ?? []) await press(page, step);
    await page.waitForTimeout(settle ?? 450);
    if (errors.length) throw new Error(`page error: ${errors[0]}`);
    await page.screenshot({ path, type: "png" });
    if (!quant(path, raw)) throw new Error(`${path}: not quantised (brew install pngquant)`);
  } finally {
    await context.close();
  }
}

/**
 * `store.screenshots` in pal.json becomes `list`, the rest of the file as it
 * was: only the array's text is replaced (a whole-file rewrite reflowed every
 * hand-formatted manifest), and nothing is written when the list is the same.
 */
function writeList(path, list) {
  const text = readFileSync(path, "utf8");
  const manifest = JSON.parse(text);
  if (JSON.stringify(manifest.store?.screenshots ?? null) === JSON.stringify(list)) return;
  const body = JSON.stringify(list, null, 2);
  const store = text.search(/"store"\s*:\s*\{/);
  const at = store < 0 ? -1 : text.slice(store).search(/"screenshots"\s*:\s*\[/);
  if (at < 0) {
    (manifest.store ??= {}).screenshots = list;
    return writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  }
  const open = text.indexOf("[", store + at);
  let depth = 0, end = open, inStr = false;
  for (; end < text.length; end++) {
    const c = text[end];
    if (inStr) { if (c === "\\") end++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  const indent = text.slice(text.lastIndexOf("\n", open) + 1).match(/^\s*/)[0];
  writeFileSync(path, text.slice(0, open) + body.replace(/\n/g, "\n" + indent) + text.slice(end + 1));
}

const barUrl = (key, shot, theme) => {
  const q = new URLSearchParams({ bar: key, target: shot.target, theme });
  if (shot.state) q.set("state", shot.state);
  if (shot.popover) q.set("popover", "1");
  return `${base}/?gallery&${q}`;
};

for (const name of names) {
  const panel = fixtureOf(name) && read(fixtureOf(name));
  const bar = barFixtureOf(name) && read(barFixtureOf(name));
  const dir = join(root, "extensions", name, "screenshots");
  const out = outDir ?? dir;
  mkdirSync(out, { recursive: true });
  const listed = [];
  const made = new Set();
  let broke = 0;
  for (const [file, shot] of Object.entries(panel?.shots ?? {})) {
    for (const theme of THEMES) {
      const png = outDir ? `${name}-${file}-${theme}.png` : `${file}${theme === "dark" ? "-dark" : ""}.png`;
      const url = `${base}/?gallery&shot=${name}${shot.palette ? `&palette=${encodeURIComponent(shot.palette)}` : ""}${theme === "dark" ? "&theme=dark" : ""}`;
      try {
        await shoot({ url, viewport: { width: 960, height: 600 }, scale: 1.5, theme, keys: shot.keys, settle: shot.settle, path: join(out, png), raw: shot.raw });
        made.add(png);
        console.log(`${name}/${png}`);
      } catch (e) { failed++; broke++; console.error(`${name}/${png}: ${e.message.split("\n")[0]}`); }
    }
    listed.push({ file: `${file}.png`, caption: shot.caption });
  }
  for (const [key, shot] of Object.entries(bar?.shots ?? {})) {
    for (const theme of THEMES) {
      const png = outDir ? `${name}-bar-${key}-${theme}.png` : `bar-${key}${theme === "dark" ? "-dark" : ""}.png`;
      try {
        await shoot({ url: barUrl(bar.key, shot, theme), viewport: { width: 720, height: shot.popover ? 540 : 60 }, scale: 2, theme, path: join(out, png) });
        made.add(png);
        console.log(`${name}/${png}`);
      } catch (e) { failed++; broke++; console.error(`${name}/${png}: ${e.message.split("\n")[0]}`); }
    }
    listed.push({ file: `bar-${key}.png`, caption: shot.caption, kind: "bar" });
  }
  // Half a set is not stamped: the directory, the list and the stamp stay as they were until every shot renders.
  if (outDir || broke) continue;
  // The directory is exactly what the fixtures plan: a picture no fixture makes any more goes.
  for (const f of readdirSync(dir)) if (f.endsWith(".png") && !made.has(f)) { rmSync(join(dir, f)); console.log(`${name}/${f}: removed (no fixture plans it)`); }
  writeList(join(root, "extensions", name, "pal.json"), listed.map(({ file, caption, kind }) => ({ file, caption, ...(kind && { kind }) })));
  writeFileSync(join(dir, ".shots.json"), JSON.stringify({ fixtures: fixtureHash(name) }) + "\n");
}
await browser.close();
process.exit(failed ? 1 : 0);
