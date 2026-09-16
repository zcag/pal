// Screenshots: take one, and find the ones you took. Three Capture rows
// (an area, a window, the whole screen) run `screencapture` on macOS or
// `grim`/`slurp` on Linux once the panel is down, to a file in the
// screenshots folder or to the clipboard (the `destination` setting;
// cmd+c on a row takes the other one for this shot), now or after the
// `timer` seconds (cmd+enter), and the HUD says where the shot went.
// Under them the folder's screenshots and recordings newest first, each
// with its thumbnail (`thumbnailUrl`, the app's `icon://` file route),
// its pixel size and age: open, reveal, copy the image, copy the path or
// a markdown image tag, read its text (OCR), trash it. The root's Now
// section offers a screenshot taken in the last two minutes (`suggest`).
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { conceal, effects, home, ocr, settings, thumbnailUrl, type Action, type Ctx, type Detail, type Effect, type Extension, type Item } from "@zcag/pal";
import { ago, captureName, grimCommand, isScreenshot, kindOf, markdownImage, pngSize, screencaptureArgv, size, SUGGEST_MS, type Capture, type Destination, type Kind, type Mode } from "./shots.ts";

/** `[extensions.screenshots]`, defaults in pal.json. */
type Settings = { destination: Destination; folder: string; timer: number; sound: boolean; all_files: boolean; limit: number; ocr_concealed: boolean };

const MAC = process.platform === "darwin";
const HOME = home("~");
const S = () => settings.get<Settings>();
const short = (p: string) => (p === HOME ? "~" : p.startsWith(HOME + "/") ? "~" + p.slice(HOME.length) : p);

/** Material Design glyphs in the bundled Nerd Font. */
const GLYPH = {
  area: "\u{f0a6d}", // md-selection_drag
  window: "\u{f05af}", // md-window_maximize
  screen: "\u{f0379}", // md-monitor
  video: "\u{f0567}", // md-video
  image: "\u{f02e9}", // md-image
  hint: "\u{f02fc}", // md-information
};
const THUMB_PX = 48;
/** An interactive capture waits for the user; the tool is given this long before it is killed. */
const CAPTURE_MS = 5 * 60_000;
const TRASH_MS = 10_000;
/** After the pick answers `hide`, the beat the panel takes to leave the screen before the capture starts (it would otherwise be in the shot, or take the interactive selection's first click). */
const HIDE_SETTLE_MS = 250;
const CAPTURE_SECTION = "Capture";
const RECENT_SECTION = "Recent";

// ---- folder ----------------------------------------------------------------------

let located: { at: number; dir: string } | undefined;

/** Where macOS puts screenshots: `defaults read com.apple.screencapture location` when set, else the Desktop; asked once a minute. */
async function systemFolder(): Promise<string> {
  if (!MAC) {
    const pictures = join(HOME, "Pictures");
    return (await stat(join(pictures, "Screenshots")).then((s) => s.isDirectory()).catch(() => false)) ? join(pictures, "Screenshots") : pictures;
  }
  if (located && Date.now() - located.at < 60_000) return located.dir;
  const proc = Bun.spawn(["defaults", "read", "com.apple.screencapture", "location"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(proc.stdout).text().catch(() => "")).trim();
  const dir = out && (await stat(home(out)).then((s) => s.isDirectory()).catch(() => false)) ? home(out) : join(HOME, "Desktop");
  located = { at: Date.now(), dir };
  return dir;
}

const folder = async (s: Settings) => (s.folder?.trim() ? home(s.folder.trim()) : systemFolder());

// ---- scanning ------------------------------------------------------------------------

type Entry = { path: string; name: string; kind: Kind; size: number; mtime: number; dims?: { w: number; h: number } };

/** The folder's screenshots, newest first, at most `limit`; a PNG's header gives its pixel size. */
async function scan(s: Settings): Promise<{ dir: string; entries: Entry[] }> {
  const dir = await folder(s);
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => isScreenshot(n, s.all_files));
  const found = await Promise.all(names.map(async (name): Promise<Entry | undefined> => {
    const path = join(dir, name);
    const st = await stat(path).catch(() => undefined);
    if (!st || !st.isFile()) return;
    return { path, name, kind: kindOf(name)!, size: st.size, mtime: st.mtimeMs };
  }));
  const entries = found.filter((e): e is Entry => e !== undefined).sort((a, b) => b.mtime - a.mtime).slice(0, Math.max(1, s.limit || 50));
  await Promise.all(entries.map(async (e) => {
    if (!e.name.toLowerCase().endsWith(".png")) return;
    const head = await Bun.file(e.path).slice(0, 24).bytes().catch(() => undefined);
    if (head) e.dims = pngSize(head);
  }));
  return { dir, entries };
}

// ---- rows ------------------------------------------------------------------------------

const OPEN: Action = { id: "open", title: "Open", multi: true };
const REVEAL: Action = { id: "reveal", title: MAC ? "Reveal in Finder" : "Show in file manager", multi: true };
const COPY_IMAGE: Action = { id: "copy-image", title: "Copy image", shortcut: "cmd+c", multi: true };
const COPY_PATH: Action = { id: "copy-path", title: "Copy path", shortcut: "cmd+shift+c", multi: true };
const COPY_MARKDOWN: Action = { id: "copy-markdown", title: "Copy as markdown image", shortcut: "cmd+m" };
const COPY_TEXT: Action = { id: "copy-text", title: "Copy text (OCR)", shortcut: "cmd+shift+t" };
const TRASH: Action = { id: "trash", title: "Move to Trash", shortcut: "cmd+d", style: "destructive", confirm: "Move this to the Trash?", multi: true };
const IMAGE_ACTIONS: Action[] = [OPEN, REVEAL, COPY_IMAGE, COPY_PATH, COPY_MARKDOWN, COPY_TEXT, TRASH];
const VIDEO_ACTIONS: Action[] = [OPEN, REVEAL, COPY_IMAGE, COPY_PATH, TRASH];

const CAPTURE_ACTIONS = (s: Settings): Action[] => [
  { id: "capture", title: s.destination === "clipboard" ? "Capture to the clipboard" : "Capture" },
  { id: "capture-delayed", title: `Capture after ${s.timer || 3} s`, shortcut: "cmd+enter" },
  { id: "capture-other", title: s.destination === "clipboard" ? "Capture to a file" : "Capture to the clipboard", shortcut: "cmd+c" },
];

const MODES: { id: Mode; name: string; subtitle: string; icon: string; keywords: string[] }[] = [
  { id: "area", name: "Capture area", subtitle: MAC ? "Drag a selection; space switches to a window, Escape cancels" : "Drag a selection with slurp", icon: GLYPH.area, keywords: ["selection", "region", "screenshot"] },
  { id: "window", name: "Capture window", subtitle: MAC ? "Click the window; space switches to a selection" : "Drag a selection with slurp", icon: GLYPH.window, keywords: ["screenshot"] },
  { id: "screen", name: "Capture screen", subtitle: "Every display, as it is now", icon: GLYPH.screen, keywords: ["fullscreen", "display", "screenshot"] },
];

const hint = (name: string, subtitle: string, section?: string): Item => ({ id: `hint:${name}`, name, subtitle, icon: GLYPH.hint, section, actions: [] });

const captureRows = (s: Settings): Item[] => {
  if (!MAC && !(Bun.which("grim") && Bun.which("slurp"))) return [hint("Install grim and slurp", "The capture rows need both on PATH (wl-copy for the clipboard)", CAPTURE_SECTION)];
  return MODES.map((m) => ({ id: `capture:${m.id}`, name: m.name, subtitle: m.subtitle, icon: m.icon, keywords: m.keywords, section: CAPTURE_SECTION, actions: CAPTURE_ACTIONS(s) }));
};

function row(e: Entry, section?: string): Item {
  const dims = e.dims ? `${e.dims.w}×${e.dims.h} · ` : "";
  return {
    id: e.path,
    name: e.name,
    subtitle: `${dims}${size(e.size)}`,
    icon: e.kind === "image" ? { image: thumbnailUrl(e.path, THUMB_PX) } : GLYPH.video,
    keywords: [e.kind === "video" ? "recording" : "screenshot"],
    accessories: [{ date: e.mtime }],
    section,
    actions: e.kind === "image" ? IMAGE_ACTIONS : VIDEO_ACTIONS,
  };
}

async function list(): Promise<Item[]> {
  const s = S();
  const { dir, entries } = await scan(s);
  const recent = entries.length ? entries.map((e) => row(e, RECENT_SECTION)) : [hint("No screenshots yet", `${short(dir)} has none; a capture above lands there`, RECENT_SECTION)];
  return [...captureRows(s), ...recent];
}

/** A screenshot taken in the last two minutes, for the root's Now section: open, copy, the markdown tag. */
async function suggest(): Promise<Item[]> {
  const { entries } = await scan(S());
  const e = entries[0];
  if (!e || Date.now() - e.mtime >= SUGGEST_MS) return [];
  const r = row(e);
  return [{ ...r, name: `Screenshot taken ${ago(Date.now() - e.mtime)}`, subtitle: `${e.name} · ${r.subtitle}`, section: undefined, actions: e.kind === "image" ? [OPEN, COPY_IMAGE, COPY_MARKDOWN, COPY_PATH, COPY_TEXT, REVEAL] : VIDEO_ACTIONS }];
}

async function detail(path: string): Promise<Detail> {
  const st = await stat(path).catch(() => undefined);
  if (!st) return { markdown: "This file is gone.", metadata: [{ label: "Path", value: short(path) }] };
  const kind = kindOf(basename(path));
  const head = kind === "image" ? await Bun.file(path).slice(0, 24).bytes().catch(() => undefined) : undefined;
  const dims = head && pngSize(head);
  return {
    markdown: kind === "image" ? `![${basename(path)}](${thumbnailUrl(path, 0)})` : undefined,
    metadata: [
      { label: "Name", value: basename(path) },
      { label: "Folder", value: short(dirname(path)) },
      { label: "Size", value: size(st.size) },
      ...(dims ? [{ label: "Pixels", value: `${dims.w} × ${dims.h}` }] : []),
      { label: "Taken", value: new Date(st.mtimeMs).toLocaleString() },
    ],
  };
}

// ---- capture ------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs the capture once the panel is down and tells the HUD where the
 * shot went; a cancelled interactive capture (Escape: a non-zero exit and
 * no file) says nothing. `PAL_SCREENCAPTURE_BIN` is a stand-in for the
 * tests; on Linux the command is one shell line (`grimCommand`).
 */
async function capture(c: Capture): Promise<void> {
  await sleep(HIDE_SETTLE_MS);
  const bin = process.env.PAL_SCREENCAPTURE_BIN;
  const argv = bin || MAC ? screencaptureArgv(bin || "screencapture", c) : ["sh", "-c", grimCommand(c)];
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), CAPTURE_MS);
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text().catch(() => "")]);
  clearTimeout(timer);
  const landed = c.destination === "file" && (await stat(c.path).then(() => true).catch(() => false));
  const hud = c.destination === "clipboard" ? (code === 0 ? "Copied to the clipboard" : undefined) : landed ? `Screenshot saved: ${basename(c.path)}` : undefined;
  if (code !== 0 && !landed && err.trim()) console.error(`[screenshots] ${argv[0]} exited ${code}: ${err.trim()}`);
  if (hud) await effects.run({ hud }).catch((e) => console.error(`[screenshots] hud: ${e}`));
}

async function captureFrom(mode: Mode, action: string | undefined): Promise<Effect> {
  const s = S();
  const destination: Destination = action === "capture-other" ? (s.destination === "clipboard" ? "file" : "clipboard") : s.destination === "clipboard" ? "clipboard" : "file";
  const c: Capture = { mode, destination, delay: action === "capture-delayed" ? Math.max(1, Math.round(s.timer || 3)) : 0, sound: !!s.sound, path: join(await folder(s), captureName(new Date())) };
  // Not awaited: the interactive tool waits for the user, and the pick's answer is what takes the panel down first.
  void capture(c).catch((e) => console.error(`[screenshots] capture: ${e}`));
  return { hide: true };
}

// ---- actions ------------------------------------------------------------------------------

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();

async function runTool(argv: string[], ms: number): Promise<void> {
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), ms);
  const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  if (code !== 0) throw new Error(err.trim() || `${argv[0]} exited ${code}`);
}

/** Finder's delete (macOS) or `gio trash`; `PAL_SCREENSHOTS_TRASH` names a stand-in taking the path (the tests). */
const trash = (p: string) => runTool(process.env.PAL_SCREENSHOTS_TRASH ? [process.env.PAL_SCREENSHOTS_TRASH, p] : MAC ? ["osascript", "-e", `tell application "Finder" to delete POSIX file ${JSON.stringify(p)}`] : ["gio", "trash", "--", p], TRASH_MS);

const failure = (title: string, e: unknown): Effect => ({ keep: true, toast: { title, message: String((e as Error)?.message ?? e), style: "failure" } });

async function pick(id: string, action?: string, ctx?: Ctx): Promise<Effect> {
  if (id.startsWith("capture:")) return captureFrom(id.slice(8) as Mode, action);
  const ids = ctx?.ids ?? [id];
  switch (action) {
    case "reveal": spawnDetached(MAC ? ["open", "-R", ...ids] : ["xdg-open", dirname(id)]); return { hide: true };
    case "copy-image": return { copy_files: ids };
    case "copy-path": return { copy: ids.join("\n") };
    case "copy-markdown": return { copy: markdownImage(id), hud: "Copied markdown image" };
    case "copy-text": {
      let text: string;
      try { text = await ocr.image({ path: id }); } catch (e) { return failure("Could not read the text", e); }
      if (!text) return { keep: true, toast: { title: "No text found", message: basename(id) } };
      return { copy: S().ocr_concealed ? conceal(text, 0) : text, hud: "Copied text" };
    }
    case "trash": {
      let n = 0;
      try { for (const p of ids) { await trash(p); n++; } } catch (e) { return failure(n ? `Moved ${n} to the Trash, then failed` : "Could not move to Trash", e); }
      return { keep: true, toast: { title: "Moved to Trash", message: ids.length === 1 ? basename(id) : `${ids.length} items` } };
    }
    default:
      for (const p of ids.slice(1)) spawnDetached([MAC ? "open" : "xdg-open", p]);
      return { open: id };
  }
}

export default {
  palettes: {
    screenshots: {
      title: "Screenshots",
      // The folder changes under the palette: listed again on every show, so the shot just taken is there.
      live: true,
      multi: true,
      placeholder: "Search screenshots",
      list,
      pick,
      detail,
      suggest,
    },
  },
} satisfies Extension;
