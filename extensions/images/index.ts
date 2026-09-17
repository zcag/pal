// Images: what Raycast's TinyPNG and Image Modification do, local first.
// An input palette whose rows are the images at hand: the Finder
// selection, what is on the clipboard (an image, or files), a path typed
// into the box; every operation is an action on a row (or on the "All N
// images" row, or on marked rows), writes its result next to the source
// with a suffix (`-compressed`, `@0.5x`, `.webp`; `replace` writes over
// the source and keeps a copy for Restore), copies the result's path (the
// image itself when the input was the clipboard) and says in the HUD what
// it did and with which tool. Resize, Convert, Rotate and Crop push a
// level of choices; Optimise for web opens a view with the before and
// after. ops.ts plans the steps (pure), exec.ts runs them.
import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { clipboard, effects, errorMessage, hint, home, ocr, settings, tilde, toast, view as views, type Action, type Ctx, type Detail, type Effect, type Extension, type Item, type Metadata, type View, type ViewNode } from "@zcag/pal";
import { available, copyImage, dimsOf, dir, execute, exists, finderSelection, infoOf, keepOriginal, MAC, restoreOriginal, sizeOf, thumbnail, tinypng, tmpPath, trash, which } from "./exec.ts";
import { ASPECTS, cropped, dims as dimsText, FMT_TITLE, fmtOf, isImage, isMissing, LOSSY, outputFor, parseResize, percent, plan, resized, size, suffixFor, TARGETS, TOOL_HINT, type Aspect, type Avail, type Dims, type Fmt, type Info, type Job, type ResizeSpec, type ToolName } from "./ops.ts";

/** `[extensions.images]`, defaults in pal.json. */
type Settings = { replace: boolean; quality: number; web_format: "keep" | "webp" | "avif"; web_max: number; thumbnails: boolean; pad_color: string; tinypng_api_key: string; tools: string[] };
const S = () => settings.get<Settings>();

/** Material Design glyphs from the bundled Nerd Font; the tile's pink tints them. */
const GLYPH = {
  image: "\u{f02e9}", // md-image
  multiple: "\u{f02f9}", // md-image_multiple
  folder: "\u{f024f}", // md-folder_image
  resize: "\u{f0a68}", // md-resize
  convert: "\u{f04e1}", // md-swap_horizontal
  rotate: "\u{f0467}", // md-rotate_right
  rotateLeft: "\u{f0465}", // md-rotate_left
  flipH: "\u{f10e7}", // md-flip_horizontal
  flipV: "\u{f10e8}", // md-flip_vertical
  square: "\u{f01a2}", // md-crop_square
  aspect: "\u{f0a24}", // md-aspect_ratio
  pad: "\u{f004c}", // md-arrow_expand_all
  alert: "\u{f05d6}", // md-alert_circle_outline
  download: "\u{f01da}", // md-download
  off: "\u{f082b}", // md-image_off
};

/** A pick waits this long for a batch before answering with a progress toast and finishing behind the panel. */
const BUDGET_MS = 8000;
/** Jobs run at once. */
const POOL = 3;
/** The sources (Finder, clipboard) are read once per this window, not on every keystroke. */
const SOURCES_TTL_MS = 2500;
/** The row's icon and the pane's picture. */
const THUMB_ROW = 64, THUMB_PANE = 256;
/** Images listed from a folder, and completions of a typed path. */
const FOLDER_MAX = 200, COMPLETIONS = 8;
/** `14-02-33`, the clipboard result's name. */
const stamp = () => new Date().toTimeString().slice(0, 8).replace(/:/g, "-");

// ---- sources ----------------------------------------------------------------------

type Source = { path: string; from: "Finder selection" | "Clipboard"; clip?: true };
let sources: Source[] = [];
let sourcesAt = 0;

/** The images of a folder (not recursive), by name, capped. */
async function folderImages(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((n) => !n.startsWith(".") && isImage(n)).sort((a, b) => a.localeCompare(b)).slice(0, FOLDER_MAX).map((n) => join(dir, n));
}

/** The Finder selection (files, or a folder's images) then the clipboard (an image entry's file, or the images of a file list); each path once. */
async function gather(refresh = false): Promise<Source[]> {
  if (!refresh && Date.now() - sourcesAt < SOURCES_TTL_MS) return sources;
  const out: Source[] = [];
  const seen = new Set<string>();
  const add = (s: Source) => { if (!seen.has(s.path)) { seen.add(s.path); out.push(s); } };
  for (const p of await finderSelection()) {
    const st = await stat(p).catch(() => undefined);
    if (!st) continue;
    if (st.isDirectory() && !(MAC && p.endsWith(".app"))) for (const f of await folderImages(p)) add({ path: f, from: "Finder selection" });
    else if (isImage(p)) add({ path: p, from: "Finder selection" });
  }
  const e = await clipboard.current().catch(() => null);
  if (e?.kind === "image" && e.image) { add({ path: e.image, from: "Clipboard", clip: true }); clipPaths.add(e.image); }
  if (e?.kind === "files") for (const f of e.files ?? []) if (isImage(f) && exists(f)) add({ path: f, from: "Clipboard" });
  sources = out;
  sourcesAt = Date.now();
  return out;
}

// ---- results -------------------------------------------------------------------------

type Result = { source: string; output: string; job: Job; tool: ToolName; before: number; after: number; from?: Dims; to?: Dims; lossless?: boolean; gain: boolean; kept?: string; clip?: true; at: number };
/** Every output written this session, by its path, newest last; a result row is a file row too, so an output can be worked on again. */
const results = new Map<string, Result>();
const resultOf = (path: string) => results.get(path);
const clipPaths = new Set<string>();

// ---- actions ---------------------------------------------------------------------------

const OPS: Action[] = [
  { id: "compress", title: "Compress", multi: true },
  { id: "web", title: "Optimise for web", multi: true },
  { id: "lossless", title: "Compress losslessly", shortcut: "cmd+l", multi: true },
  { id: "resize", title: "Resize…", shortcut: "cmd+shift+r", multi: true },
  { id: "convert", title: "Convert…", shortcut: "cmd+shift+v", multi: true },
  { id: "rotate", title: "Rotate or flip…", shortcut: "cmd+shift+o", multi: true },
  { id: "crop", title: "Crop or pad…", shortcut: "cmd+shift+a", multi: true },
  { id: "strip", title: "Strip metadata", shortcut: "cmd+shift+m", multi: true },
  { id: "gray", title: "Grayscale", shortcut: "cmd+g", multi: true },
  { id: "icons", title: "Make an icon set", shortcut: "cmd+shift+f", multi: true },
];
const TINY: Action = { id: "tinypng", title: "Compress with TinyPNG", shortcut: "cmd+t", multi: true };
const OCR: Action = { id: "ocr", title: "Copy text (OCR)", shortcut: "cmd+shift+t" };
const FILE: Action[] = [
  { id: "info", title: "Copy info", shortcut: "cmd+shift+i" },
  { id: "copy", title: "Copy path", shortcut: "cmd+c", multi: true },
  { id: "copy-image", title: "Copy image", shortcut: "cmd+shift+p" },
  { id: "open", title: "Open", shortcut: "cmd+o" },
  { id: "reveal", title: MAC ? "Reveal in Finder" : "Show in file manager", shortcut: "cmd+shift+e" },
];
const RESTORE: Action = { id: "restore", title: "Restore original", shortcut: "cmd+shift+z" };
const TRASH: Action = { id: "trash", title: "Move result to Trash", shortcut: "cmd+d", style: "destructive", confirm: "Move the result to the Trash? The source stays." };

let ocrOk: boolean | undefined;
const ocrAvailable = async () => (ocrOk ??= await ocr.available().catch(() => false));

function actionsFor(path: string, ocrable: boolean): Action[] {
  const s = S();
  const r = resultOf(path);
  const ops = [...OPS.slice(0, 3), ...(s.tinypng_api_key ? [TINY] : []), ...OPS.slice(3)];
  return [...ops, ...(ocrable ? [OCR] : []), ...FILE, ...(r?.kept ? [RESTORE] : []), ...(r && r.output !== r.source ? [TRASH] : [])];
}

// ---- rows --------------------------------------------------------------------------------


const toolLabel = (t: ToolName) => (t === "cjpeg" && (which("cjpeg") ?? "").includes("mozjpeg") ? "mozjpeg" : t === "builtin" ? "pal" : t === "tinypng" ? "TinyPNG" : t);

/** A file row: the thumbnail, size and dimensions on the right; a result's subtitle says what made it and the saving as a tag. */
async function fileRow(path: string, o: { section?: string; clip?: true; ocrable: boolean }): Promise<Item | undefined> {
  const bytes = await sizeOf(path);
  if (!bytes) return undefined;
  const s = S();
  const [d, thumb] = await Promise.all([dimsOf(path), s.thumbnails ? thumbnail(path, THUMB_ROW) : undefined]);
  const r = resultOf(path);
  return {
    id: path,
    name: o.clip && !r ? "Clipboard image" : basename(path),
    subtitle: r ? `${jobTitle(r.job)} with ${toolLabel(r.tool)}${r.lossless && r.job.kind === "compress" && !r.job.lossless ? " (lossless: no lossy encoder for it)" : ""} · ${size(r.before)} → ${size(r.after)}` : o.clip ? "From the clipboard" : tilde(dirname(path)),
    icon: thumb ? { image: thumb } : GLYPH.image,
    keywords: [extname(path).slice(1)],
    accessories: [...(r ? [{ tag: r.gain ? percent(r.before, r.after) : "no gain", color: r.gain ? "green" : "grey" }] : []), { text: size(bytes) }, ...(d ? [{ text: dimsText(d) }] : [])],
    ...(o.section && { section: o.section }),
    actions: actionsFor(path, o.ocrable),
  };
}

const jobTitle = (j: Job): string => {
  switch (j.kind) {
    case "compress": return j.lossless ? "Compressed losslessly" : "Compressed";
    case "web": return "Optimised for web";
    case "convert": return `Converted to ${FMT_TITLE[j.to]}`;
    case "resize": return "Resized";
    case "rotate": return `Rotated ${j.degrees}°`;
    case "flip": return `Flipped ${j.axis === "horizontal" ? "horizontally" : "vertically"}`;
    case "strip": return "Stripped metadata";
    case "gray": return "Converted to grayscale";
    case "crop": return j.aspect === "1:1" ? "Cropped square" : `Cropped to ${j.aspect}`;
    case "pad": return "Padded to square";
    case "icons": return "Icon set";
  }
};

/** The root of the palette: the "All" row, the sources by origin, the results, or the hints. */
async function rootRows(query: string, refresh: boolean): Promise<Item[]> {
  const q = query.trim();
  if (/^\s*(~|\/)/.test(q)) return pathRows(q);
  const ocrable = await ocrAvailable();
  const src = await gather(refresh);
  const rows: Item[] = [];
  for (const s of src) { const r = await fileRow(s.path, { section: s.from, clip: s.clip, ocrable }); if (r) rows.push(r); }
  for (const r of [...results.values()].reverse()) { const row = await fileRow(r.output, { section: "Results", ocrable }); if (row && !rows.some((x) => x.id === row.id)) rows.push(row); }
  if (q) { const lq = q.toLowerCase(); return rows.filter((r) => r.name.toLowerCase().includes(lq) || basename(r.id).toLowerCase().includes(lq)); }
  const files = src.map((s) => s.path);
  if (files.length > 1) rows.unshift({ id: "all", name: `All ${files.length} images`, subtitle: [...new Set(src.map((s) => s.from))].join(" and "), icon: GLYPH.multiple, actions: [...OPS.slice(0, 3), ...(S().tinypng_api_key ? [TINY] : []), ...OPS.slice(3)] });
  return rows.length ? rows : hints();
}

/** Nothing at hand: how to get a row, then what to install for the encoders this machine lacks. */
function hints(): Item[] {
  const avail = available(S().tools);
  const missing = (["pngquant", "oxipng", "cjpeg", "cwebp", "avifenc"] as ToolName[]).filter((t) => !avail.includes(t));
  const none = !avail.includes("sips") && !avail.includes("magick");
  return [
    hint("how", MAC ? "Select images in Finder, copy one, or type a path" : "Copy images, or type a path", "Compress, resize, convert, rotate, strip metadata, make an icon set", { icon: GLYPH.image }),
    ...(none ? [hint("none", "Nothing here resizes or converts", MAC ? "sips is missing from /usr/bin" : "Install ImageMagick: brew install imagemagick or apt install imagemagick", { icon: GLYPH.alert })] : []),
    ...missing.slice(0, 3).map((t) => hint(t, `${t} is not installed`, `For ${TOOL_HINT[t]}`, { icon: GLYPH.download })),
  ];
}

/** A typed path: the image, a folder's images, or the completions of the last segment (images and folders). */
async function pathRows(q: string): Promise<Item[]> {
  const p = home(q).replace(/(.)\/+$/, "$1");
  const ocrable = await ocrAvailable();
  const st = await stat(p).catch(() => undefined);
  if (st?.isFile()) { const r = isImage(p) ? await fileRow(p, { ocrable }) : undefined; return r ? [r] : [hint("not-image", `${basename(p)} is not an image`, "PNG, JPEG, WebP, AVIF, HEIC, GIF, TIFF, BMP or SVG", { icon: GLYPH.off })]; }
  if (st?.isDirectory()) {
    const files = await folderImages(p);
    if (!files.length) return [hint("empty", `No images in ${tilde(p)}`, "Type on for a subfolder", { icon: GLYPH.folder })];
    const rows = await Promise.all(files.map((f) => fileRow(f, { section: tilde(p), ocrable })));
    const out = rows.filter((r): r is Item => !!r);
    if (out.length > 1) out.unshift({ id: `folder:${p}`, name: `All ${out.length} images in ${basename(p) || p}`, subtitle: tilde(p), icon: GLYPH.multiple, actions: OPS });
    return out;
  }
  const dir = dirname(p), prefix = basename(p).toLowerCase();
  const names = await readdir(dir).catch(() => [] as string[]);
  const rows: Item[] = [];
  for (const n of names.filter((n) => n.toLowerCase().startsWith(prefix) && (prefix.startsWith(".") || !n.startsWith("."))).sort((a, b) => a.localeCompare(b))) {
    if (rows.length >= COMPLETIONS) break;
    const f = join(dir, n);
    const s = await stat(f).catch(() => undefined);
    if (s?.isDirectory()) rows.push(hint(`dir:${f}`, n, "A folder: type its path with a / to list its images", { icon: GLYPH.folder }));
    else if (s?.isFile() && isImage(f)) { const r = await fileRow(f, { ocrable }); if (r) rows.push(r); }
  }
  return rows.length ? rows : [hint("nothing", "No image or folder there", `Nothing under ${tilde(dir)} starts with “${basename(p)}”`, { icon: GLYPH.off })];
}

// ---- the levels: resize, convert, rotate, crop ---------------------------------------------------

type LevelArgs = { op: "resize" | "convert" | "rotate" | "crop"; files: string[] };
/** The crumb of each level. */
const LEVEL_TITLE: Record<LevelArgs["op"], string> = { resize: "Resize", convert: "Convert", rotate: "Rotate", crop: "Crop" };
const levelOf = (ctx?: Ctx): LevelArgs | undefined => (ctx?.args as LevelArgs | undefined)?.op ? (ctx!.args as LevelArgs) : undefined;

/** `cwebp (brew install webp)`: the tool with the install line from `TOOL_HINT`. */
const installHint = (t: ToolName) => { const m = TOOL_HINT[t]?.match(/\((.*)\)/); return m ? `${t} (${m[1]})` : t; };

/** A level row: a choice of the operation; its pane shows the source, what the result will be and the tool, from the job's plan. */
async function choice(level: LevelArgs, id: string, name: string, subtitle: string, icon: string, job: Job | undefined, d: Dims): Promise<Item> {
  const first = level.files[0];
  const s = S();
  const avail = available(s.tools);
  const p = job && plan(job, first, { avail, quality: s.quality, tmp: () => "/tmp/x", output: "/tmp/x", dims: d });
  const missing = !p || isMissing(p);
  const thumb = s.thumbnails ? await thumbnail(first, THUMB_PANE) : undefined;
  const to = job && !isMissing(p!) ? (job.kind === "resize" ? resized(d, job.spec) : job.kind === "rotate" && job.degrees !== 180 ? { width: d.height, height: d.width } : job.kind === "crop" ? cropped(d, job.aspect) : job.kind === "pad" ? { width: Math.max(d.width, d.height), height: Math.max(d.width, d.height) } : d) : undefined;
  const metadata: Metadata[] = [
    { label: "Source", value: `${level.files.length === 1 ? basename(first) : `${level.files.length} images, first ${basename(first)}`}, ${dimsText(d)}` },
    ...(to ? [{ label: "Result", value: dimsText(to) }] : []),
    ...(job && !missing ? [{ label: "Writes", value: level.files.length === 1 ? basename(outputFor(first, job, { replace: s.replace, exists, avail })) : `${level.files.length} files with the ${suffixFor(job) || "new extension"} suffix` }, { label: "Tool", value: toolLabel((p as { tool: ToolName }).tool) }] : []),
    ...(p && isMissing(p) ? [{ label: "Needs", value: p.missing.map(installHint).join(" or ") }] : []),
  ];
  return { id, name, subtitle, icon, detail: { markdown: thumb ? `![](${thumb})` : undefined, metadata }, actions: missing ? [] : [{ id: "run", title: name.replace(/…$/, "") }] };
}

async function levelRows(level: LevelArgs, query: string): Promise<Item[]> {
  const first = level.files[0];
  const d = (await dimsOf(first)) ?? { width: 0, height: 0 };
  const n = level.files.length;
  const of = n === 1 ? basename(first) : `${n} images`;
  const q = query.trim();
  const row = (id: string, name: string, subtitle: string, icon: string, job: Job | undefined) => choice(level, id, name, subtitle, icon, job, d);
  let rows: Item[];
  switch (level.op) {
    case "resize": {
      const typed = parseResize(q);
      const presets: { id: string; name: string; spec: ResizeSpec }[] = [
        { id: "50", name: "Half size (@0.5x)", spec: { percent: 50 } },
        { id: "25", name: "Quarter size (@0.25x)", spec: { percent: 25 } },
        { id: "200", name: "Double size (@2x)", spec: { percent: 200 } },
        { id: "max2000", name: "Fit in 2000 px", spec: { max: 2000 } },
        { id: "max1000", name: "Fit in 1000 px", spec: { max: 1000 } },
        { id: "w1920", name: "Width 1920 px", spec: { width: 1920 } },
        { id: "w800", name: "Width 800 px", spec: { width: 800 } },
        { id: "h1080", name: "Height 1080 px", spec: { height: 1080 } },
      ];
      const one = (name: string, spec: ResizeSpec) => row(`resize:${JSON.stringify(spec)}`, name, `${of}: ${dimsText(d)} → ${dimsText(resized(d, spec))}`, GLYPH.resize, { kind: "resize", spec });
      rows = typed ? [await one(typedName(typed), typed)] : await Promise.all(presets.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())).map((p) => one(p.name, p.spec)));
      rows.push(hint("how", "Or type a size", "800 (a width), x600 (a height), 800x600 (fit inside), 50%, 2x"));
      break;
    }
    case "convert": {
      const from = fmtOf(first);
      rows = await Promise.all(TARGETS.filter((t) => t !== from || n > 1).map((t) => {
        const job: Job = { kind: "convert", to: t };
        const p = plan(job, first, { avail: available(S().tools), quality: S().quality, tmp: () => "/tmp/x", output: "/tmp/x", dims: d });
        return isMissing(p)
          ? row(`convert:${t}`, FMT_TITLE[t], `Install ${p.missing.join(" or ")}: ${p.why}`, GLYPH.download, job)
          : row(`convert:${t}`, FMT_TITLE[t], `${of} as .${t === "jpeg" ? "jpg" : t} with ${toolLabel(p.tool)}${LOSSY.includes(t) ? `, quality ${S().quality}` : ""}`, GLYPH.convert, job);
      }));
      break;
    }
    case "rotate":
      rows = await Promise.all([
        row("rotate:90", "Rotate 90° clockwise", `${of}: ${dimsText(d)} → ${dimsText({ width: d.height, height: d.width })}`, GLYPH.rotate, { kind: "rotate", degrees: 90 }),
        row("rotate:270", "Rotate 90° counter-clockwise", `${of}: ${dimsText(d)} → ${dimsText({ width: d.height, height: d.width })}`, GLYPH.rotateLeft, { kind: "rotate", degrees: 270 }),
        row("rotate:180", "Rotate 180°", of, GLYPH.rotate, { kind: "rotate", degrees: 180 }),
        row("flip:horizontal", "Flip horizontally", `${of}, mirrored left to right`, GLYPH.flipH, { kind: "flip", axis: "horizontal" }),
        row("flip:vertical", "Flip vertically", `${of}, mirrored top to bottom`, GLYPH.flipV, { kind: "flip", axis: "vertical" }),
      ]);
      break;
    case "crop":
      rows = await Promise.all([
        ...ASPECTS.map((a) => row(`crop:${a}`, a === "1:1" ? "Crop to a square" : `Crop to ${a}`, `${of}: ${dimsText(d)} → ${dimsText(cropped(d, a))}, centred`, a === "1:1" ? GLYPH.square : GLYPH.aspect, { kind: "crop", aspect: a })),
        row("pad", "Pad to a square", `${of}: ${dimsText(d)} → ${Math.max(d.width, d.height)}×${Math.max(d.width, d.height)}, ${S().pad_color} around it`, GLYPH.pad, { kind: "pad", color: S().pad_color }),
      ]);
      break;
  }
  if (q && level.op !== "resize") rows = rows.filter((r) => r.name.toLowerCase().includes(q.toLowerCase()));
  // The results of these files from this level's operations, under the choices, so a second try sees the first.
  const ocrable = await ocrAvailable();
  const ops: Record<LevelArgs["op"], Job["kind"][]> = { resize: ["resize"], convert: ["convert"], rotate: ["rotate", "flip"], crop: ["crop", "pad"] };
  for (const r of [...results.values()].reverse()) if (level.files.includes(r.source) && ops[level.op].includes(r.job.kind)) { const row = await fileRow(r.output, { section: "Results", ocrable }); if (row) rows.push(row); }
  return rows;
}

const typedName = (s: ResizeSpec) => s.percent !== undefined ? `${s.percent}%` : s.width && s.height ? `Fit in ${s.width}×${s.height}` : s.width ? `Width ${s.width} px` : s.height ? `Height ${s.height} px` : `Fit in ${s.max} px`;

/** The job a level row stands for. */
function jobOf(id: string): Job | undefined {
  const [kind, rest] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
  if (id === "pad") return { kind: "pad", color: S().pad_color };
  switch (kind) {
    case "resize": return { kind: "resize", spec: JSON.parse(rest) };
    case "convert": return { kind: "convert", to: rest as Fmt };
    case "rotate": return { kind: "rotate", degrees: Number(rest) as 90 | 180 | 270 };
    case "flip": return { kind: "flip", axis: rest as "horizontal" | "vertical" };
    case "crop": return { kind: "crop", aspect: rest as Aspect };
  }
  return undefined;
}

// ---- running jobs -------------------------------------------------------------------------------

/** One job on one file: the plan, its steps, the result recorded (and the source kept aside when it was replaced). Throws with the reason. */
async function runOne(input: string, job: Job, s: Settings, avail: Avail): Promise<Result> {
  const from = await dimsOf(input);
  if (!from) throw new Error(`${basename(input)} could not be read as an image`);
  const before = await sizeOf(input);
  const clip = clipPaths.has(input);
  // A clipboard image lives in pal's history: its result goes to the cache's clipboard folder (and back onto the clipboard), never over the history file.
  const replace = s.replace && job.kind !== "icons" && !clip;
  const output = outputFor(clip ? join(dirname(input), `clipboard-${stamp()}${extname(input)}`) : input, job, { replace, exists, avail, ...(clip && { dir: dir("clipboard") }) });
  // A replace writes to a temp path first, so a failed step leaves the source whole.
  const target = replace || output === input ? tmpPath(extname(output).slice(1) || "png") : output;
  const p = plan(job, input, { avail, quality: s.quality, tmp: tmpPath, output: target, dims: from });
  if (isMissing(p)) throw new Error(`${p.why}: install ${p.missing.join(" or ")}`);
  await execute(p, { folder: job.kind === "icons" });
  return land(input, job, output, target, p.tool, before, from, p.lossless, replace);
}

/** TinyPNG's version of `runOne`: the bytes come back from the API. */
async function runTiny(input: string, s: Settings, avail: Avail): Promise<Result> {
  const fmt = fmtOf(input);
  if (!fmt || !["png", "jpeg", "webp", "avif"].includes(fmt)) throw new Error(`TinyPNG takes PNG, JPEG, WebP and AVIF, not ${basename(input)}`);
  const from = await dimsOf(input);
  const before = await sizeOf(input);
  const job: Job = { kind: "compress" };
  const clip = clipPaths.has(input);
  const replace = s.replace && !clip;
  const output = outputFor(clip ? join(dirname(input), `clipboard-${stamp()}${extname(input)}`) : input, job, { replace, exists, avail, ...(clip && { dir: dir("clipboard") }) });
  const target = replace ? tmpPath(extname(output).slice(1)) : output;
  const r = await tinypng(input, s.tinypng_api_key);
  await writeFile(target, r.bytes);
  return land(input, job, output, target, "tinypng", before, from, false, replace);
}

/** The written file into place: no gain leaves nothing (the temp goes), a replace keeps the source aside first; the result is recorded and the caches for the path forgotten. */
async function land(input: string, job: Job, output: string, target: string, tool: ToolName, before: number, from: Dims | undefined, lossless: boolean | undefined, replace: boolean): Promise<Result> {
  const folder = job.kind === "icons";
  const after = folder ? await folderSize(target) : await sizeOf(target);
  if (!after) throw new Error(`${toolLabel(tool)} wrote nothing for ${basename(input)}`);
  const to = folder ? undefined : await dimsOf(target);
  const resized = !!(from && to && (from.width !== to.width || from.height !== to.height));
  // A compress (or a web pass that changed no pixels) that did not shrink the file is no gain: nothing is written.
  const gain = folder || !(job.kind === "compress" || (job.kind === "web" && !resized)) || after < before;
  if (!gain) {
    if (target !== input) await Bun.file(target).unlink().catch(() => {});
    const r: Result = { source: input, output: input, job, tool, before, after, from, to: from, lossless, gain: false, at: Date.now() };
    results.set(input, r);
    return r;
  }
  let kept: string | undefined;
  if (target !== output) {
    if (replace) kept = await keepOriginal(input);
    await Bun.write(output, Bun.file(target));
    await Bun.file(target).unlink().catch(() => {});
    if (replace && output !== input) await Bun.file(input).unlink().catch(() => {});
  }
  const r: Result = { source: input, output, job, tool, before, after, from, to, lossless, gain, kept, at: Date.now(), ...(clipPaths.has(input) && { clip: true as const }) };
  results.set(output, r);
  if (r.clip) clipPaths.add(output);
  return r;
}

async function folderSize(dir: string): Promise<number> {
  let n = 0;
  for (const f of await readdir(dir, { recursive: true }).catch(() => [] as string[])) n += (await stat(join(dir, f)).catch(() => undefined))?.size ?? 0;
  return n;
}

type Batch = { files: string[]; done: Result[]; failed: { file: string; error: string }[]; total: number; finished: Promise<void> };
/** The results that wrote something, in the order the files were given (`done` fills in completion order). */
const written = (b: Batch): Result[] => b.files.flatMap((f) => b.done.filter((r) => r.source === f && r.gain));

/** Runs `job` over `files`, `POOL` at a time; `done` and `failed` fill as they go and `finished` settles at the end. */
function batch(files: string[], job: Job | "tinypng", onEach?: () => void): Batch {
  const s = S();
  const avail = available(s.tools);
  const b: Batch = { files, done: [], failed: [], total: files.length, finished: Promise.resolve() };
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f !== undefined; f = queue.shift()) {
      try { b.done.push(job === "tinypng" ? await runTiny(f, s, avail) : await runOne(f, job, s, avail)); } catch (e) { b.failed.push({ file: f, error: errorMessage(e) }); }
      onEach?.();
    }
  };
  b.finished = Promise.all(Array.from({ length: Math.min(POOL, files.length) }, worker)).then(() => {});
  return b;
}

/** "Compressed photo.png: 1.2 MB → 340 KB (−72%) with pngquant", or the batch's totals; the failures after. */
function summary(b: Batch, job: Job | "tinypng"): { title: string; message?: string; ok: boolean } {
  const ok = b.done.filter((r) => r.gain);
  const noGain = b.done.filter((r) => !r.gain);
  const what = job === "tinypng" ? "Compressed" : jobTitle(job);
  const fails = b.failed.length ? `${b.failed.length} failed: ${b.failed[0].error}` : "";
  if (ok.length === 1 && b.total === 1) {
    const r = ok[0];
    const change = r.job.kind === "icons" ? `${size(r.after)} in ${basename(r.output)}` : `${size(r.before)} → ${size(r.after)} (${percent(r.before, r.after)})${r.to && r.from && (r.to.width !== r.from.width || r.to.height !== r.from.height) ? `, ${dimsText(r.from)} → ${dimsText(r.to)}` : ""}`;
    return { title: `${what} ${r.clip ? "the clipboard image" : basename(r.source)}`, message: `${change}, ${toolLabel(r.tool)}${r.kept ? ", the original kept for Restore" : ""}`, ok: true };
  }
  if (!ok.length && noGain.length && !b.failed.length) return { title: noGain.length === 1 ? `${basename(noGain[0].source)} is already small` : `${noGain.length} images are already small`, message: `${toolLabel(noGain[0].tool)} could not make ${noGain.length === 1 ? "it" : "them"} smaller; nothing written`, ok: false };
  if (!ok.length) return { title: `Could not ${what.toLowerCase().replace(/ed\b/, "")} ${b.total === 1 ? basename(b.failed[0]?.file ?? "") : `${b.total} images`}`, message: b.failed[0]?.error, ok: false };
  const before = ok.reduce((n, r) => n + r.before, 0), after = ok.reduce((n, r) => n + r.after, 0);
  const tools = [...new Set(ok.map((r) => toolLabel(r.tool)))].join(", ");
  return { title: `${what} ${ok.length} of ${b.total} images`, message: [`${size(before)} → ${size(after)} (${percent(before, after)}) with ${tools}`, noGain.length ? `${noGain.length} already small` : "", fails].filter(Boolean).join(" · "), ok: true };
}

/**
 * The effect of a job over files: waited on for `BUDGET_MS`. Done in
 * time: the result paths on the clipboard (the image itself when the
 * input came from the clipboard), the summary in the HUD, the panel down.
 * Not yet: a progress toast now, the HUD and the copy when it lands.
 */
async function runJobs(files: string[], job: Job | "tinypng"): Promise<Effect> {
  if (!files.length) return fail("No images to work on");
  const b = batch(files, job);
  const timely = await Promise.race([b.finished.then(() => true), Bun.sleep(BUDGET_MS).then(() => false)]);
  if (timely) return finish(b, job);
  b.finished.then(async () => { const e = await finish(b, job); await effects.run({ ...(e.copy && { copy: e.copy }), hud: e.hud ?? e.toast?.title ?? "Done" }).catch(() => {}); });
  return { keep: true, toast: { title: `Working on ${files.length} images…`, message: `${b.done.length + b.failed.length} of ${files.length} done; the rest lands in the HUD` } };
}

/** The finished batch as an effect: what to copy and what to say. */
async function finish(b: Batch, job: Job | "tinypng"): Promise<Effect> {
  const s = summary(b, job);
  if (!s.ok) return fail(s.title, s.message);
  const ok = written(b);
  const line = `${s.title}: ${s.message}`;
  if (ok.length === 1 && ok[0].clip && (await copyImage(ok[0].output))) return { hud: `${line} · image copied` };
  return { copy: ok.map((r) => r.output).join("\n"), hud: `${line} · path${ok.length > 1 ? "s" : ""} copied` };
}

// ---- optimise for web: the view --------------------------------------------------------------------

const webJob = (): Job => { const s = S(); return { kind: "web", to: s.web_format === "keep" ? undefined : s.web_format, max: s.web_max }; };
/** The open web views by id, so a pick from one knows its files. */
const webViews = new Map<string, { files: string[]; b: Batch }>();
let webSeq = 0;

async function webView(id: string, files: string[], b: Batch): Promise<View> {
  const rows: ViewNode[] = [];
  const ok = b.done.filter((r) => r.gain);
  for (const f of files) {
    const r = b.done.find((x) => x.source === f);
    const fail = b.failed.find((x) => x.file === f);
    const thumb = S().thumbnails ? await thumbnail(r?.output ?? f, THUMB_ROW) : undefined;
    const picture: ViewNode = thumb ? { type: "image", src: thumb, width: 40, height: 40, mask: "rounded" } : { type: "tile", width: 40, height: 40, text: extname(f).slice(1).toUpperCase(), color: "neutral" };
    const line: ViewNode[] = r
      ? r.gain
        ? [
            { type: "text", value: size(r.before), style: "number", color: "muted" }, { type: "text", value: "→", color: "faint" }, { type: "text", value: size(r.after), style: "number", color: "success" },
            { type: "badge", text: percent(r.before, r.after), color: "green" },
            { type: "spacer" }, { type: "progress", value: Math.min(1, r.after / r.before), width: 96, color: "green" },
          ]
        : [{ type: "text", value: `${size(r.before)}, already small`, style: "muted" }, { type: "badge", text: "no gain", color: "grey" }]
      : fail ? [{ type: "text", value: fail.error, style: "muted", color: "destructive" }] : [{ type: "text", value: "Working…", style: "muted" }, { type: "spacer" }, { type: "progress", value: 0, width: 96 }];
    const dimsLine = r?.gain ? `${toolLabel(r.tool)} · ${dimsText(r.from)}${r.to && (r.to.width !== r.from?.width || r.to.height !== r.from?.height) ? ` → ${dimsText(r.to)}` : ""} · ${basename(r.output)}` : tilde(dirname(f));
    rows.push({ type: "stack", key: f, direction: "row", gap: 3, align: "center", children: [
      picture,
      { type: "stack", grow: true, gap: 1, children: [
        { type: "text", value: basename(f), weight: "semibold", width: 380 },
        { type: "text", value: dimsLine, style: "muted", size: "xs", width: 380 },
        { type: "stack", direction: "row", gap: 2, align: "center", minHeight: 18, children: line },
      ] },
    ] });
  }
  const before = ok.reduce((n, r) => n + r.before, 0), after = ok.reduce((n, r) => n + r.after, 0);
  const pending = files.length - b.done.length - b.failed.length;
  const foot = pending ? `${b.done.length + b.failed.length} of ${files.length} done` : ok.length ? `Saved ${size(before - after)} (${percent(before, after)}) across ${ok.length} ${ok.length === 1 ? "image" : "images"}${b.failed.length ? `, ${b.failed.length} failed` : ""}` : b.failed.length ? "Nothing written" : "Nothing to save";
  return {
    id,
    title: "Optimised for web",
    tree: { type: "stack", padding: 4, gap: 3, children: [
      { type: "stack", direction: "row", align: "center", gap: 2, children: [{ type: "text", value: "Optimised for web", style: "title" }, { type: "spacer" }, { type: "text", value: `cap ${S().web_max} px · quality ${S().quality}${S().web_format === "keep" ? "" : ` · ${FMT_TITLE[S().web_format as Fmt]}`}`, style: "muted", size: "xs" }] },
      { type: "divider" },
      ...rows,
      { type: "divider" },
      { type: "text", key: "foot", value: foot, style: "muted" },
    ] },
    actions: [
      { id: "reveal", title: MAC ? "Reveal in Finder" : "Show in file manager" },
      { id: "copy", title: "Copy paths", shortcut: "cmd+c" },
      { id: "copy-image", title: "Copy first image", shortcut: "cmd+shift+p" },
    ],
  };
}

/** Optimise for web: the batch starts, the view opens with "Working…" rows and follows every landing through `view.update`. */
async function openWeb(files: string[]): Promise<Effect> {
  const id = `web:${++webSeq}`;
  const job = webJob();
  const b = batch(files, job, () => { webView(id, files, b).then((v) => views.update(v, { palette: "images", id })).catch(() => {}); });
  webViews.set(id, { files, b });
  // Small batches are done before the view is drawn; a big one draws its progress.
  await Promise.race([b.finished, Bun.sleep(Math.min(BUDGET_MS, 1500))]);
  return { view: await webView(id, files, b) };
}

// ---- detail --------------------------------------------------------------------------------------

const infoLines = (i: Info, path: string, bytes: number): Metadata[] => {
  const m: Metadata[] = [{ label: "Path", value: tilde(path) }, { label: "Size", value: size(bytes) }];
  if (i.width && i.height) m.push({ label: "Dimensions", value: `${i.width} × ${i.height} px${i.dpi && i.dpi !== 72 ? `, ${Math.round(i.dpi)} dpi` : ""}` });
  if (i.format) m.push({ label: "Format", value: `${FMT_TITLE[i.format as Fmt] ?? i.format.toUpperCase()}${i.bits ? `, ${i.bits} bits` : ""}${i.alpha ? ", alpha" : ""}` });
  if (i.space || i.profile) m.push({ label: "Colour", value: [i.space, i.profile].filter(Boolean).join(" · ") });
  if (i.make || i.model) m.push({ label: "Camera", value: [i.make, i.model].filter(Boolean).join(" ") });
  if (i.lens) m.push({ label: "Lens", value: i.lens });
  const exp = [i.exposure && `${i.exposure} s`, i.aperture, i.iso && `ISO ${i.iso}`, i.focal].filter(Boolean).join(" · ");
  if (exp) m.push({ label: "Exposure", value: exp });
  if (i.taken) m.push({ label: "Taken", value: i.taken });
  if (i.orientation) m.push({ label: "Orientation", value: i.orientation });
  if (i.gps) m.push({ label: "Location", value: i.gps });
  if (i.software) m.push({ label: "Software", value: i.software });
  if (i.copyright || i.artist) m.push({ label: "Credit", value: [i.artist, i.copyright].filter(Boolean).join(" · ") });
  if (i.description) m.push({ label: "Description", value: i.description });
  return m;
};

/** The pane: the picture at 256 px over the info; a result adds what made it and where the original is. */
async function detail(path: string): Promise<Detail> {
  const bytes = await sizeOf(path);
  if (!bytes) return { markdown: "This file no longer exists.", metadata: [{ label: "Path", value: tilde(path) }] };
  const [info, thumb] = await Promise.all([infoOf(path), S().thumbnails ? thumbnail(path, THUMB_PANE) : undefined]);
  const r = resultOf(path);
  const metadata = infoLines(info, path, bytes);
  if (r) {
    metadata.unshift({ label: "Made by", value: `${jobTitle(r.job)} with ${toolLabel(r.tool)}` }, { label: "From", value: `${tilde(r.source)}, ${size(r.before)}${r.from ? `, ${dimsText(r.from)}` : ""}` }, { label: "Saving", tags: [{ text: r.gain ? percent(r.before, r.after) : "no gain", color: r.gain ? "green" : "grey" }] });
    if (r.kept) metadata.push({ label: "Original kept", value: tilde(r.kept) });
  }
  return { markdown: thumb ? `![](${thumb})` : undefined, metadata };
}

// ---- pick -------------------------------------------------------------------------------------------

const spawnDetached = (argv: string[]) => Bun.spawn(argv, { stdio: ["ignore", "ignore", "ignore"], detached: true }).unref();
const fail = (title: string, message?: string): Effect => toast(title, message, "failure");

async function pick(id: string, action: string | undefined, ctx?: Ctx): Promise<Effect | void> {
  // A pick from the web view.
  if (id.startsWith("web:")) {
    const w = webViews.get(id);
    const outs = w ? written(w.b).map((r) => r.output) : [];
    if (!outs.length) return fail("Nothing was written");
    if (action === "copy") return { copy: outs.join("\n") };
    if (action === "copy-image") return (await copyImage(outs[0])) ? { hud: "Image copied" } : { copy_files: [outs[0]] };
    spawnDetached(MAC ? ["open", "-R", ...outs] : ["xdg-open", dirname(outs[0])]);
    return { hide: true };
  }
  if (!sourcesAt) await gather();
  const level = levelOf(ctx);
  if (level) {
    const job = jobOf(id);
    if (!job) return;
    if (resultOf(id)) return pick(id, action, { ...ctx, args: undefined });
    return runJobs(level.files, job);
  }
  // The files an action works on: every marked row, the "All" row's sources, else the one.
  const files = id === "all" ? (await gather()).map((s) => s.path) : id.startsWith("folder:") ? await folderImages(id.slice(7)) : (ctx?.ids ?? [id]).filter((f) => !f.startsWith("hint:") && f !== "all");
  const one = files[0];
  switch (action) {
    case "compress": case undefined: return runJobs(files, { kind: "compress" });
    case "lossless": return runJobs(files, { kind: "compress", lossless: true });
    case "tinypng": return runJobs(files, "tinypng");
    case "web": return openWeb(files);
    case "strip": return runJobs(files, { kind: "strip" });
    case "gray": return runJobs(files, { kind: "gray" });
    case "icons": return runJobs(files, { kind: "icons" });
    case "resize": case "convert": case "rotate": case "crop": return { push: { extension: "images", palette: "images", args: { op: action, files } satisfies LevelArgs, title: `${LEVEL_TITLE[action]} ${files.length === 1 ? basename(one) : `${files.length} images`}` } };
    case "ocr": {
      let text: string;
      try { text = await ocr.image({ path: one }); } catch (e) { return fail("Could not read the text", errorMessage(e)); }
      if (!text) return fail("No text in the image", basename(one));
      return { copy: text, hud: "Copied text" };
    }
    case "info": {
      const info = await infoOf(one);
      return { copy: infoLines(info, one, await sizeOf(one)).map((m) => `${m.label}: ${m.value ?? m.tags?.map((t) => t.text).join(", ")}`).join("\n"), hud: "Copied info" };
    }
    case "copy": return { copy: files.join("\n") };
    case "copy-image": return (await copyImage(one)) ? { hud: "Image copied" } : { copy_files: [one] };
    case "open": return { open: one };
    case "reveal": spawnDetached(MAC ? ["open", "-R", ...files] : ["xdg-open", dirname(one)]); return { hide: true };
    case "restore": {
      const r = resultOf(one);
      if (!r?.kept) return fail("No original kept", "The result did not replace its source");
      try { await restoreOriginal(r.kept, r.source, r.output); } catch (e) { return fail("Could not restore", errorMessage(e)); }
      results.delete(one);
      return { keep: true, toast: { title: `Restored ${basename(r.source)}`, message: r.output !== r.source ? `${basename(r.output)} removed` : "The original is back in place" } };
    }
    case "trash": {
      const r = resultOf(one);
      try { await trash(one); } catch (e) { return fail("Could not move to Trash", errorMessage(e)); }
      results.delete(one);
      return { keep: true, toast: { title: "Moved to Trash", message: `${basename(one)}${r && r.source !== one ? `; ${basename(r.source)} stays` : ""}` } };
    }
  }
}

export default {
  palettes: {
    images: {
      title: "Images",
      input: true,
      multi: true,
      showDetail: true,
      placeholder: "Search the images at hand, or type a path",
      list: async (query = "", ctx) => {
        const level = levelOf(ctx);
        return level ? levelRows(level, query) : rootRows(query, !!ctx?.refresh);
      },
      pick,
      detail: (id) => (id.startsWith("hint:") || id === "all" || id.startsWith("folder:") || id.includes(":") && !id.startsWith("/") ? undefined : detail(id)),
    },
  },
} satisfies Extension;
