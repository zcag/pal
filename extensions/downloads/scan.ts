// The pure half of Downloads: what a directory entry is (a finished file,
// a download in progress by its suffix, a folder), which section a
// modification time falls in, the rate spelling, the browsers'
// download folders read off their preference files, and a Safari
// `.download` bundle's progress from its Info.plist.
import { extname } from "node:path";
import { bytes } from "@zcag/pal";

export type Kind = "folder" | "image" | "video" | "audio" | "document" | "archive" | "code" | "app" | "disk" | "file";

/** Material Design outlines from the bundled Nerd Font; the tile's cyan tints them. */
export const GLYPH: Record<Kind, string> = {
  folder: "\u{f0256}", // md-folder_outline
  image: "\u{f021f}", // md-file_image
  video: "\u{f022b}", // md-file_video
  audio: "\u{f0223}", // md-file_music
  document: "\u{f09ee}", // md-file_document_outline
  archive: "\u{f07b9}", // md-folder_zip_outline
  code: "\u{f102b}", // md-file_code_outline
  app: "\u{f08c6}", // md-application
  disk: "\u{f05ee}", // md-disc
  file: "\u{f0224}", // md-file_outline
};

const EXT: Record<Exclude<Kind, "folder" | "file">, string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "svg", "bmp", "tiff", "tif", "avif", "psd", "ico"],
  video: ["mp4", "mov", "mkv", "webm", "avi", "m4v", "mpg", "mpeg"],
  audio: ["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "aiff"],
  document: ["pdf", "txt", "md", "doc", "docx", "rtf", "pages", "odt", "xls", "xlsx", "numbers", "csv", "tsv", "ppt", "pptx", "key", "epub", "mobi"],
  archive: ["zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar"],
  code: ["ts", "tsx", "js", "jsx", "py", "rs", "go", "rb", "sh", "zsh", "c", "h", "cpp", "java", "kt", "swift", "lua", "toml", "json", "yaml", "yml", "html", "css", "sql", "ipynb"],
  app: ["app", "pkg", "appimage", "deb", "rpm", "flatpak", "exe", "msi"],
  disk: ["dmg", "iso", "img"],
};
/** Thumbnails come from these; the rest wear a glyph. */
export const THUMBABLE = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif", "avif", "pdf"]);

export function kindOf(name: string, dir: boolean): Kind {
  const ext = extname(name).slice(1).toLowerCase();
  if (dir && ext !== "app") return "folder";
  return (Object.keys(EXT) as (keyof typeof EXT)[]).find((k) => EXT[k].includes(ext)) ?? "file";
}

/** The suffixes browsers give a file still coming in: Chrome, Firefox, Safari (a bundle), curl/wget and the like. */
const PARTIAL = /\.(crdownload|part|download|partial|tmp)$/i;
export const inProgress = (name: string): boolean => PARTIAL.test(name);
/** The name the file will have once done: `report.pdf.crdownload` is `report.pdf`; Chrome's `Unconfirmed 123.crdownload` has no name yet. */
export const finalName = (name: string): string => name.replace(PARTIAL, "");

export type Section = "Downloading" | "Today" | "Yesterday" | "This week" | "Older";

/** By local calendar day: today, yesterday, the last seven days, older. */
export function sectionOf(mtime: number, now = Date.now()): Exclude<Section, "Downloading"> {
  const day = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const today = day(now), that = day(mtime);
  const days = Math.round((today - that) / 86400e3);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Older";
}

/** `2.1 MB/s` from a size seen `ms` ago; nothing for no growth or no time. */
export const rate = (before: number, after: number, ms: number): string | undefined => (ms > 0 && after > before ? `${bytes(((after - before) * 1000) / ms)}/s` : undefined);

/**
 * Where the browsers put downloads, from their preference files:
 * Chrome-family `Preferences` (`download.default_directory`), Firefox
 * `prefs.js` (`browser.download.dir` when `folderList` is 2). Only
 * folders that exist; the caller drops the one equal to the setting.
 */
export function browserDirsFrom(files: { chromePrefs: string[]; firefoxPrefs: string[] }): string[] {
  const out = new Set<string>();
  for (const text of files.chromePrefs) {
    try { const d = JSON.parse(text)?.download?.default_directory; if (typeof d === "string" && d) out.add(d); } catch {}
  }
  for (const text of files.firefoxPrefs) {
    const list = /user_pref\("browser\.download\.folderList",\s*(\d)\)/.exec(text)?.[1];
    const dir = /user_pref\("browser\.download\.dir",\s*"((?:[^"\\]|\\.)*)"\)/.exec(text)?.[1];
    if (list === "2" && dir) out.add(dir.replace(/\\(.)/g, "$1"));
  }
  return [...out];
}

/** A Safari `.download` bundle's Info.plist says how far it is: bytes so far and the total. */
export function safariProgress(plist: string): { done: number; total: number } | undefined {
  const num = (key: string) => { const m = new RegExp(`<key>${key}</key>\\s*<(?:integer|real)>([\\d.]+)</(?:integer|real)>`).exec(plist); return m ? Number(m[1]) : undefined; };
  const done = num("DownloadEntryProgressBytesSoFar"), total = num("DownloadEntryProgressTotalToLoad");
  return done !== undefined && total ? { done, total } : undefined;
}

/** The root's Now row: a download finished within this. */
export const SUGGEST_MS = 10 * 60_000;

/** Files older than `days` by modification time, for the clear-out row. */
export const olderThan = <T extends { mtime: number }>(files: T[], days: number, now = Date.now()): T[] => files.filter((f) => now - f.mtime > days * 86400e3);
