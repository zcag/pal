// screenshots: the pure half first (shots.ts: which names count, the PNG
// header, the command lines, the capture name, the markdown tag), then
// the palette over the wire on a temp folder of fake PNGs with real IHDR
// headers, a stand-in `screencapture` (`PAL_SCREENCAPTURE_BIN`) that logs
// its arguments and writes the file it was given, and a stand-in trash
// (`PAL_SCREENSHOTS_TRASH`) moving into a folder of its own, so nothing
// touches the real screen, Desktop or Trash.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ago, captureName, grimCommand, isScreenshot, kindOf, markdownImage, screencaptureArgv, SUGGEST_MS } from "../../../extensions/screenshots/shots.ts";
import { tile } from "../../../sdk/src/icon.ts";
import type { Item } from "../../../sdk/src/protocol.ts";
import { Host } from "../harness.ts";

const MAC = process.platform === "darwin";

/** A PNG's first 24 bytes with the given IHDR size, plus some padding so the file has a size. */
function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

describe("shots.ts", () => {
  test("what counts as a screenshot, the kinds, and the age", () => {
    expect(kindOf("Screenshot 2026-09-17 at 14.03.22.png")).toBe("image");
    expect(kindOf("Screen Recording 2026-09-17 at 14.03.22.mov")).toBe("video");
    expect(kindOf("notes.txt")).toBeUndefined();
    expect(isScreenshot("Screenshot 2026-09-17 at 14.03.22.png")).toBe(true);
    expect(isScreenshot("Screen Shot 2019-01-01 at 10.00.00.png")).toBe(true);
    expect(isScreenshot("grim-20260917.png")).toBe(true);
    expect(isScreenshot("holiday.jpg")).toBe(false);
    expect(isScreenshot("holiday.jpg", true)).toBe(true);
    expect(isScreenshot(".Screenshot hidden.png", true)).toBe(false);
    expect(isScreenshot("Screenshot notes.txt")).toBe(false);
    expect(ago(12_000)).toBe("12 s ago");
    expect(ago(95_000)).toBe("2 min ago");
  });

  test("the command lines: screencapture's flags per mode, destination, delay and sound; grim with slurp on Linux", () => {
    const base = { destination: "file" as const, delay: 0, sound: false, path: "/tmp/s.png" };
    expect(screencaptureArgv("screencapture", { ...base, mode: "area" })).toEqual(["screencapture", "-i", "-x", "/tmp/s.png"]);
    expect(screencaptureArgv("screencapture", { ...base, mode: "window", delay: 3, sound: true })).toEqual(["screencapture", "-i", "-W", "-T", "3", "/tmp/s.png"]);
    expect(screencaptureArgv("sc", { ...base, mode: "screen", destination: "clipboard" })).toEqual(["sc", "-c", "-x"]);
    expect(grimCommand({ ...base, mode: "screen" })).toBe("grim '/tmp/s.png'");
    expect(grimCommand({ ...base, mode: "area", delay: 3, path: "/tmp/it's.png" })).toBe(`sleep 3 && grim -g "$(slurp)" '/tmp/it'\\''s.png'`);
    expect(grimCommand({ ...base, mode: "window", destination: "clipboard" })).toBe('grim -g "$(slurp)" - | wl-copy --type image/png');
  });

  test("the capture name is macOS's, and the markdown tag keeps the path readable", () => {
    expect(captureName(new Date(2026, 8, 17, 14, 3, 22))).toBe("Screenshot 2026-09-17 at 14.03.22.png");
    expect(captureName(new Date(2026, 0, 1, 9, 0, 0), true)).toBe("Screen Recording 2026-01-01 at 09.00.00.mov");
    expect(markdownImage("/Users/x/Desktop/Screenshot 2026-09-17 at 14.03.22.png")).toBe("![Screenshot 2026-09-17 at 14.03.22](/Users/x/Desktop/Screenshot%202026-09-17%20at%2014.03.22.png)");
  });
});

let host: Host;
const root = mkdtempSync(join(tmpdir(), "pal-shots-"));
const folder = join(root, "shots");
const bin = join(root, "bin");
const trashDir = join(root, "trash");
const captureLog = join(root, "capture.log");
mkdirSync(folder); mkdirSync(bin); mkdirSync(trashDir);
// The stand-in screencapture: logs its arguments, sleeps a beat like the real one, writes the file it was given (none for -c).
writeFileSync(join(bin, "screencapture"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${captureLog}"\nlast=""\nfor a in "$@"; do last="$a"; done\ncase "$*" in *" -c"*|*"-c "*) exit 0;; esac\nprintf 'PNG' > "$last"\n`);
writeFileSync(join(bin, "trash"), `#!/bin/sh\nmv -- "$1" "${trashDir}/" || exit 1\n`);
chmodSync(join(bin, "screencapture"), 0o755); chmodSync(join(bin, "trash"), 0o755);
const at = (msAgo: number) => new Date(Date.now() - msAgo);
const one = join(folder, "Screenshot 2026-09-17 at 14.03.22.png");
const two = join(folder, "Screenshot 2026-09-16 at 09.15.00.png");
const old = join(folder, "Screen Shot 2019-01-01 at 10.00.00.png");
const rec = join(folder, "Screen Recording 2026-09-15 at 12.00.00.mov");
const stray = join(folder, "holiday.jpg");
const huds: string[] = [];

let PATH0: string | undefined;
beforeAll(async () => {
  writeFileSync(one, png(1440, 900));
  writeFileSync(two, png(800, 600));
  writeFileSync(old, png(10, 10));
  writeFileSync(rec, "mov");
  writeFileSync(stray, "jpg");
  writeFileSync(join(folder, "notes.txt"), "no");
  utimesSync(one, at(10 * 60_000), at(10 * 60_000));
  utimesSync(two, at(86400_000), at(86400_000));
  utimesSync(old, at(30 * 86400_000), at(30 * 86400_000));
  utimesSync(rec, at(2 * 86400_000), at(2 * 86400_000));
  utimesSync(stray, at(60_000), at(60_000));
  process.env.PAL_SCREENCAPTURE_BIN = join(bin, "screencapture");
  process.env.PAL_SCREENSHOTS_TRASH = join(bin, "trash");
  // Off macOS the capture rows need grim and slurp on PATH; stand-ins keep the three rows on a Linux runner.
  for (const t of ["grim", "slurp", "wl-copy"]) { writeFileSync(join(bin, t), "#!/bin/sh\nexit 0\n"); chmodSync(join(bin, t), 0o755); }
  PATH0 = process.env.PATH;
  process.env.PATH = `${bin}:${process.env.PATH}`;
  host = await Host.bundled({
    settings: { screenshots: { settings: { folder } } },
    core: {
      "effects.run": (p: { effect: { hud?: string } }) => { if (p.effect.hud) huds.push(p.effect.hud); return null; },
      "ocr.image": (p: { path: string }) => ({ text: p.path.endsWith("14.03.22.png") ? "HELLO PAL" : "" }),
    },
  });
});
afterAll(() => { host?.kill(); if (PATH0 !== undefined) process.env.PATH = PATH0; delete process.env.PAL_SCREENCAPTURE_BIN; delete process.env.PAL_SCREENSHOTS_TRASH; rmSync(root, { recursive: true, force: true }); });

const list = () => host.list("screenshots", "screenshots");
const pick = (id: string, action?: string, ctx?: { ids?: string[] }) => host.pick("screenshots", "screenshots", id, action, ctx);
const captures = () => (existsSync(captureLog) ? readFileSync(captureLog, "utf8").trim().split("\n") : []);

describe("screenshots", () => {
  test("meta: a live, multi, primary palette with the teal camera tile and the manifest's settings", async () => {
    const loaded = host.loaded().find((l) => l.extension === "screenshots")!;
    expect(loaded.warnings).toEqual([]);
    expect(loaded.palettes[0]).toMatchObject({ name: "screenshots", title: "Screenshots", live: true, input: false, multi: true, suggest: true, detail: "lazy", tier: "primary", icon: tile("teal", "\u{f0100}") });
    expect(loaded.manifest.settings!.map((s) => s.id)).toEqual(["destination", "folder", "timer", "sound", "all_files", "limit", "ocr_concealed"]);
  });

  test("rows: the three Capture rows, then the folder's screenshots newest first with their pixel size, the stray jpg and the text file left out", async () => {
    const items = await list();
    expect(items.slice(0, 3).map((i) => [i.id, i.section])).toEqual([["capture:area", "Capture"], ["capture:window", "Capture"], ["capture:screen", "Capture"]]);
    expect(items[0].actions!.map((a) => [a.id, a.shortcut])).toEqual([["capture", undefined], ["capture-delayed", "cmd+enter"], ["capture-other", "cmd+c"]]);
    expect(items[0].actions![1].title).toBe("Capture after 3 s");
    const recent = items.slice(3);
    expect(recent.map((i) => i.id)).toEqual([one, two, rec, old]);
    expect(recent.every((i) => i.section === "Recent")).toBe(true);
    expect(recent[0]).toMatchObject({ name: "Screenshot 2026-09-17 at 14.03.22.png", subtitle: "1440×900 · 64 B", icon: { image: `icon://localhost/file?path=${encodeURIComponent(one)}&size=48` } });
    expect(recent[0].accessories).toEqual([{ date: expect.any(Number) }]);
    expect(recent[0].actions!.map((a) => a.id)).toEqual(["open", "reveal", "copy-image", "copy-path", "copy-markdown", "copy-text", "trash"]);
    expect(recent[0].actions!.filter((a) => a.multi).map((a) => a.id)).toEqual(["open", "reveal", "copy-image", "copy-path", "trash"]);
    expect(recent[2]).toMatchObject({ name: "Screen Recording 2026-09-15 at 12.00.00.mov", subtitle: "3 B", icon: "\u{f0567}" });
    expect(recent[2].actions!.map((a) => a.id)).toEqual(["open", "reveal", "copy-image", "copy-path", "trash"]);
  });

  test("all_files lists every image and recording; limit cuts the tail", async () => {
    host.changeSettings("screenshots", { settings: { folder, all_files: true, limit: 2 } });
    await host.until(() => true);
    const items = (await list()).slice(3);
    expect(items.map((i) => i.id)).toEqual([stray, one]);
    host.changeSettings("screenshots", { settings: { folder } });
  });

  test("capture: the pick hides at once, the stand-in gets the flags and the file lands in the folder, the HUD names it; the timer and the clipboard rows say so", async () => {
    expect(await pick("capture:area")).toEqual({ hide: true });
    await host.until(() => huds.length === 1, 3000, "the saved HUD");
    expect(huds[0]).toMatch(/^Screenshot saved: Screenshot \d{4}-\d{2}-\d{2} at \d{2}\.\d{2}\.\d{2}\.png$/);
    expect(captures()[0]).toMatch(new RegExp(`^-i -x ${folder}/Screenshot `));
    expect(readdirSync(folder).some((n) => /^Screenshot \d{4}-\d{2}-\d{2} at/.test(n) && readFileSync(join(folder, n), "utf8") === "PNG")).toBe(true);
    expect(await pick("capture:window", "capture-delayed")).toEqual({ hide: true });
    await host.until(() => captures().length === 2, 3000, "the delayed capture");
    expect(captures()[1]).toMatch(/^-i -W -T 3 -x /);
    expect(await pick("capture:screen", "capture-other")).toEqual({ hide: true });
    await host.until(() => huds.length === 3, 3000, "the clipboard HUD");
    expect(captures()[2]).toBe("-c -x");
    expect(huds[2]).toBe("Copied to the clipboard");
  });

  test("copies: the image as a file, the path, the markdown tag, the text read by OCR (empty is a toast)", async () => {
    expect(await pick(one, "copy-image")).toEqual({ copy_files: [one] });
    expect(await pick(one, "copy-image", { ids: [one, two] })).toEqual({ copy_files: [one, two] });
    expect(await pick(one, "copy-path", { ids: [one, two] })).toEqual({ copy: `${one}\n${two}` });
    expect(await pick(one, "copy-markdown")).toEqual({ copy: `![Screenshot 2026-09-17 at 14.03.22](${folder.replace(/ /g, "%20")}/Screenshot%202026-09-17%20at%2014.03.22.png)`, hud: "Copied markdown image" });
    expect(await pick(one, "copy-text")).toEqual({ copy: "HELLO PAL", hud: "Copied text" });
    expect(await pick(two, "copy-text")).toMatchObject({ keep: true, toast: { title: "No text found" } });
    expect(await pick(one)).toEqual({ open: one });
  });

  test("detail: the picture itself over its facts", async () => {
    const d = await host.detail("screenshots", "screenshots", one);
    expect(d.markdown).toBe(`![Screenshot 2026-09-17 at 14.03.22.png](icon://localhost/file?path=${encodeURIComponent(one)}&size=0)`);
    expect(d.metadata!.map((m) => m.label)).toEqual(["Name", "Folder", "Size", "Pixels", "Taken"]);
    expect(d.metadata![3].value).toBe("1440 × 900");
    expect((await host.detail("screenshots", "screenshots", join(folder, "gone.png"))).markdown).toBe("This file is gone.");
    expect(await host.detail("screenshots", "screenshots", "capture:area")).toEqual({});
  });

  test("suggest: a screenshot under two minutes old leads the Now section, an older one does not", async () => {
    type Suggested = { extension: string; palette: string; items: Item[] }[];
    const suggest = () => host.request<Suggested>("suggest").then((r) => r.filter((s) => s.extension === "screenshots").flatMap((s) => s.items));
    // The capture test just wrote a fresh file: age it first.
    for (const n of readdirSync(folder)) utimesSync(join(folder, n), at(SUGGEST_MS + 60_000), at(SUGGEST_MS + 60_000));
    expect(await suggest()).toEqual([]);
    utimesSync(one, at(40_000), at(40_000));
    const [row] = await suggest();
    expect(row.id).toBe(one);
    expect(row.name).toMatch(/^Screenshot taken \d+ s ago$/);
    expect(row.subtitle).toBe("Screenshot 2026-09-17 at 14.03.22.png \u00b7 1440\u00d7900 \u00b7 64 B");
    expect(row.section).toBeUndefined();
    expect(row.actions!.map((a) => a.id)).toEqual(["open", "copy-image", "copy-markdown", "copy-path", "copy-text", "reveal"]);
    utimesSync(one, at(SUGGEST_MS + 1000), at(SUGGEST_MS + 1000));
    expect(await suggest()).toEqual([]);
  });

  test("trash: one file, then marked rows together; a missing file is a failure toast naming what went", async () => {
    expect(await pick(old, "trash")).toEqual({ keep: true, toast: { title: "Moved to Trash", message: "Screen Shot 2019-01-01 at 10.00.00.png" } });
    expect(existsSync(join(trashDir, "Screen Shot 2019-01-01 at 10.00.00.png"))).toBe(true);
    expect(await pick(two, "trash", { ids: [two, join(folder, "nope.png")] })).toMatchObject({ keep: true, toast: { title: "Moved 1 to the Trash, then failed", style: "failure" } });
    expect(readdirSync(trashDir).sort()).toEqual(["Screen Shot 2019-01-01 at 10.00.00.png", "Screenshot 2026-09-16 at 09.15.00.png"]);
    const items = (await list()).slice(3);
    expect(items.map((i) => i.id)).not.toContain(two);
  });

  test("an empty folder is a hint row under Recent, the capture rows still there", async () => {
    const empty = join(root, "empty");
    mkdirSync(empty);
    host.changeSettings("screenshots", { settings: { folder: empty } });
    await host.until(() => true);
    const items = await list();
    expect(items.map((i) => i.id)).toEqual(["capture:area", "capture:window", "capture:screen", "hint:empty"]);
    expect(items[3].actions).toEqual([]);
    if (!MAC) expect(items[0].name).toMatch(/Capture area|grim and slurp are not installed/);
  });
});
