// The pure half of the screenshots palette: which files count as
// screenshots, the PNG header's dimensions, the capture command lines,
// the file name a capture gets, sizes and ages. No I/O; index.ts spawns
// and reads.

/** What the recent list shows: images and screen recordings. */
export const IMAGE_EXT = ["png", "jpg", "jpeg"] as const;
export const VIDEO_EXT = ["mov", "mp4"] as const;
/** A screenshot taken within this is offered on the root's Now section. */
export const SUGGEST_MS = 2 * 60_000;

export type Kind = "image" | "video";

/** The kind by extension, or nothing for a file the palette does not list. */
export function kindOf(name: string): Kind | undefined {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if ((IMAGE_EXT as readonly string[]).includes(ext)) return "image";
  if ((VIDEO_EXT as readonly string[]).includes(ext)) return "video";
  return undefined;
}

/** macOS names its captures `Screenshot 2026-09-17 at 14.03.22.png` and `Screen Recording ...mov`; older systems `Screen Shot`. `all` lists every image and video instead. */
export function isScreenshot(name: string, all = false): boolean {
  if (!kindOf(name) || name.startsWith(".")) return false;
  return all || /^(screen ?shot|screen recording|screencapture|grim-)/i.test(name);
}

/** Width and height off a PNG's IHDR (the first chunk, bytes 16..24), or nothing for anything else. */
export function pngSize(head: Uint8Array): { w: number; h: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length < 24 || sig.some((b, i) => head[i] !== b)) return undefined;
  if (String.fromCharCode(head[12], head[13], head[14], head[15]) !== "IHDR") return undefined;
  const be = (i: number) => ((head[i] << 24) >>> 0) + (head[i + 1] << 16) + (head[i + 2] << 8) + head[i + 3];
  const w = be(16), h = be(20);
  return w > 0 && h > 0 ? { w, h } : undefined;
}

export const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);

/** "12 s ago", "3 min ago", for the suggest row. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s ago` : `${Math.round(s / 60)} min ago`;
}

const two = (n: number) => String(n).padStart(2, "0");
/** The name macOS gives a capture, so the recent list and Finder agree: `Screenshot 2026-09-17 at 14.03.22.png`. */
export const captureName = (d: Date, video = false) => `${video ? "Screen Recording" : "Screenshot"} ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} at ${two(d.getHours())}.${two(d.getMinutes())}.${two(d.getSeconds())}.${video ? "mov" : "png"}`;

export type Mode = "area" | "window" | "screen";
export type Destination = "file" | "clipboard";
export type Capture = { mode: Mode; destination: Destination; /** Seconds before the shot; 0 is now. */ delay: number; sound: boolean; /** The file to write (ignored for the clipboard). */ path: string };

/**
 * The macOS command line: `-i` selects interactively (`-W` starts it in
 * window mode), the whole screen needs neither; `-c` to the clipboard,
 * `-T n` after a delay, `-x` silences the shutter. The path comes last
 * (dropped for the clipboard, where screencapture would still write it).
 */
export function screencaptureArgv(bin: string, c: Capture): string[] {
  const args = [bin];
  if (c.mode === "area") args.push("-i");
  if (c.mode === "window") args.push("-i", "-W");
  if (c.destination === "clipboard") args.push("-c");
  if (c.delay > 0) args.push("-T", String(c.delay));
  if (!c.sound) args.push("-x");
  if (c.destination === "file") args.push(c.path);
  return args;
}

/**
 * The Linux command line, one shell string: `grim` alone for the screen,
 * `grim -g "$(slurp)"` for an area (`slurp` returns the selection, or
 * nothing on Escape, and grim then refuses), the clipboard through
 * `wl-copy`; a delay is a `sleep` in front. Window mode has no portable
 * spelling and takes the area path.
 */
export function grimCommand(c: Capture): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const parts: string[] = [];
  if (c.delay > 0) parts.push(`sleep ${c.delay}`);
  const geometry = c.mode === "screen" ? "" : ' -g "$(slurp)"';
  parts.push(c.destination === "clipboard" ? `grim${geometry} - | wl-copy --type image/png` : `grim${geometry} ${q(c.path)}`);
  return parts.join(" && ");
}

/** Markdown for the image: the file name without its extension as the alt, the path as the target (spaces percent-encoded so the link survives a strict renderer). */
export const markdownImage = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const alt = name.replace(/\.[^.]+$/, "");
  return `![${alt}](${path.replace(/ /g, "%20")})`;
};
