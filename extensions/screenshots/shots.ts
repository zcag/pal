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
