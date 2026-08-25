import { Color, Icon, Image } from "@raycast/api";
import { getFavicon } from "@raycast/utils";
import type { PalItem } from "./pal";

/**
 * Icons are the one place the split is deliberately lopsided: pal speaks
 * freedesktop names (and emoji, for palettes written back when the frontend
 * was Raycast), Raycast speaks its own ~450-name vocabulary. That translation
 * is Raycast-specific, so it lives here rather than in pal - which also means
 * every existing palette gets sensible icons with no plugin edits.
 */
const XDG_TO_RAYCAST: Record<string, Icon> = {
  "accessories-calculator": Icon.Calculator,
  "accessories-character-map": Icon.Text,
  "application-x-executable": Icon.AppWindow,
  "audio-card": Icon.Speaker,
  bluetooth: Icon.Bluetooth,
  bookmark: Icon.Bookmark,
  "camera-web": Icon.Camera,
  "dialog-password": Icon.Key,
  docker: Icon.Box,
  "edit-paste": Icon.Clipboard,
  "face-smile": Icon.Emoji,
  "folder-remote": Icon.HardDrive,
  "font-x-generic": Icon.Text,
  "google-chrome": Icon.Globe,
  home: Icon.House,
  kitty: Icon.Terminal,
  "mail-unread": Icon.Envelope,
  "multimedia-player": Icon.Music,
  "network-server": Icon.HardDrive,
  "network-wired": Icon.Network,
  "network-wireless": Icon.Wifi,
  pda: Icon.Calendar,
  "preferences-desktop-theme": Icon.Swatch,
  "preferences-system-windows": Icon.AppWindowGrid2x2,
  "system-hibernate": Icon.Moon,
  "system-lock-screen": Icon.Lock,
  "system-log-out": Icon.Logout,
  "system-reboot": Icon.ArrowClockwise,
  "system-run": Icon.Hammer,
  "system-shutdown": Icon.Power,
  "system-suspend": Icon.Moon,
  "utilities-system-monitor": Icon.LineChart,
  "utilities-terminal": Icon.Terminal,
  "view-grid": Icon.AppWindowGrid3x3,
  "view-list": Icon.AppWindowList,
  "weather-clear": Icon.Sun,
  // Common freedesktop names beyond the ones currently in use.
  "applications-development": Icon.Code,
  "applications-games": Icon.GameController,
  "applications-internet": Icon.Globe,
  "audio-headphones": Icon.Headphones,
  "audio-volume-high": Icon.SpeakerHigh,
  "audio-volume-muted": Icon.SpeakerOff,
  "battery": Icon.Battery,
  "computer": Icon.Desktop,
  "dialog-information": Icon.Info,
  "dialog-warning": Icon.Warning,
  "document-open": Icon.Document,
  "drive-harddisk": Icon.HardDrive,
  "edit-copy": Icon.CopyClipboard,
  "edit-delete": Icon.Trash,
  "edit-find": Icon.MagnifyingGlass,
  "emblem-favorite": Icon.Star,
  "folder": Icon.Folder,
  "help-about": Icon.QuestionMarkCircle,
  "image-x-generic": Icon.Image,
  "input-keyboard": Icon.Keyboard,
  "input-mouse": Icon.Mouse,
  "media-playback-start": Icon.Play,
  "media-playback-pause": Icon.Pause,
  "network-vpn": Icon.Shield,
  "printer": Icon.Print,
  "process-stop": Icon.Stop,
  "security-high": Icon.Lock,
  "text-x-generic": Icon.Text,
  "user-home": Icon.House,
  "video-display": Icon.Monitor,
  "video-x-generic": Icon.Video,
  "web-browser": Icon.Globe,
};

const NAMED_COLORS: Record<string, Color> = {
  blue: Color.Blue,
  green: Color.Green,
  magenta: Color.Magenta,
  purple: Color.Purple,
  orange: Color.Orange,
  red: Color.Red,
  yellow: Color.Yellow,
  primary: Color.PrimaryText,
  secondary: Color.SecondaryText,
  grey: Color.SecondaryText,
  gray: Color.SecondaryText,
};

export function toColor(value?: string | null): Color.ColorLike | undefined {
  if (!value) return undefined;
  const named = NAMED_COLORS[value.toLowerCase()];
  if (named) return named;
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
  return undefined;
}

/**
 * The value if it's an emoji we can use directly (Raycast script commands take
 * one as their icon), otherwise nothing.
 */
export function asEmoji(value?: string | null): string | undefined {
  return value && isEmoji(value.trim()) ? value.trim() : undefined;
}

/** An emoji rendered as an inline SVG - List.Item.icon doesn't take emoji. */
function emojiIcon(emoji: string): Image.ImageLike {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><text x="8" y="13" font-size="13" text-anchor="middle">${escapeXml(
    emoji,
  )}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Does this string look like an emoji we can inline as SVG?
 *
 * Deliberately excludes the private-use planes: those are Nerd Font glyphs
 * meant for `icon_utf` in a terminal, and inlining one here renders an empty
 * box *and* shadows better fallbacks like a favicon.
 */
function isEmoji(value: string): boolean {
  if (value.length > 8) return false;
  if (/[\u{E000}-\u{F8FF}\u{F0000}-\u{10FFFD}]/u.test(value)) return false;
  return /[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2190}-\u{2BFF}]/u.test(value);
}

/**
 * Resolve one icon-ish string. Order matters: explicit Raycast name, then
 * URL/path, then emoji/glyph, then the freedesktop table, then a name-shaped
 * lookup against Raycast's own enum ("Terminal" -> Icon.Terminal).
 */
function resolve(value: string): Image.ImageLike | undefined {
  if (!value) return undefined;

  const direct = (Icon as unknown as Record<string, Icon>)[value];
  if (direct) return direct;

  if (/^https?:\/\//.test(value)) return value;
  if (value.startsWith("/") || value.startsWith("~/")) {
    return { fileIcon: value.replace(/^~/, process.env.HOME ?? "~") };
  }
  if (isEmoji(value)) return emojiIcon(value);

  const mapped = XDG_TO_RAYCAST[value];
  if (mapped) return mapped;

  // "network-server" -> "NetworkServer", in case Raycast has that exact name.
  const camel = value
    .split(/[-_ ]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join("");
  return (Icon as unknown as Record<string, Icon>)[camel];
}

type IconSource = {
  icon_rc?: string | null;
  icon_xdg?: string | null;
  icon?: string | null;
  icon_utf?: string | null;
  color?: string | null;
};

/**
 * Pick an icon for an item or palette, or nothing if none of the fields
 * resolve. `icon_rc` is the explicit escape hatch; otherwise try the
 * freedesktop name, the generic one, then the glyph.
 */
export function resolveIcon(source: IconSource): Image.ImageLike | undefined {
  const candidates = [source.icon_rc, source.icon_xdg, source.icon, source.icon_utf];
  for (const candidate of candidates) {
    const resolved = candidate ? resolve(candidate) : undefined;
    if (!resolved) continue;
    const tintColor = toColor(source.color);
    // Only Raycast's own glyphs take a tint; images and data URIs don't.
    if (tintColor && typeof resolved === "string" && !resolved.includes("/")) {
      return { source: resolved, tintColor };
    }
    return resolved;
  }
  return undefined;
}

export function iconFor(
  source: IconSource,
  fallback: Image.ImageLike = Icon.Dot,
): Image.ImageLike {
  return resolveIcon(source) ?? fallback;
}

/**
 * Item icons additionally fall back to the favicon of a url field, and then to
 * the palette's own icon - most plugins set an icon once on the palette rather
 * than on every item.
 */
export function itemIcon(
  item: PalItem,
  palette?: IconSource | null,
  fallback: Icon = Icon.Dot,
): Image.ImageLike {
  const explicit = resolveIcon(item);
  if (explicit) return explicit;

  const url = typeof item.url === "string" ? item.url : undefined;
  if (url && /^https?:\/\//.test(url)) return getFavicon(url, { fallback });

  return (palette ? resolveIcon(palette) : undefined) ?? fallback;
}
