// Dynamic placeholders, one grammar for every text pal fills in before it
// pastes, copies or opens it (a snippet, a quicklink's url, a note
// appended to a page): `{clipboard}`, `{selection}`, `{files}`, `{date}`,
// `{time}`, `{datetime}`, `{uuid}`, `{cursor}` and `{snippet name=...}`,
// with `format=` and `offset=` on the date and time and `sep=` on the
// files. Pure; the clipboard, the selection, the Finder selection, the
// clock, the ids and the other snippets come in as `Sources`, so a test
// pins them and an extension decides what it has.

/**
 * What a placeholder needs from outside: the clipboard's text (asked only
 * when `{clipboard}` occurs), the selected text (asked only for
 * `{selection}`; the clipboard stands in when it answers nothing or is
 * absent), the files selected in Finder (asked only for `{files}`; left
 * as written when absent, empty when nothing is selected), the moment,
 * fresh ids, and another snippet's text by name for `{snippet name=...}`
 * (left as written when absent or unknown).
 */
export type Sources = {
  clipboard: () => Promise<string> | string;
  selection?: () => Promise<string | null> | string | null;
  files?: () => Promise<string[]> | string[];
  now?: () => Date;
  uuid?: () => string;
  snippet?: (name: string) => Promise<string | undefined> | string | undefined;
};

const two = (n: number) => String(n).padStart(2, "0");
/** Local date as `YYYY-MM-DD`. */
export const isoDate = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
/** Local time as `HH:MM`. */
export const isoTime = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The placeholders in the order they are looked for; `{datetime}` is date
 * and time with a space. `{selection}` is the text selected in the app in
 * front (`selection.text()`; Raycast's spelling), the clipboard when
 * nothing is selected or the read is refused. `{files}` is the Finder
 * selection (`selection.files()`), the paths one per line, or joined by
 * `sep=` (`{files sep=" "}`); empty when Finder is not in front or
 * nothing is marked. `{cursor}` is not one here:
 * a paste from the panel cannot place the caret, so `expand` drops it
 * from the text; expansion by keyword (the app's, macOS) moves the caret
 * back to it. `{snippet name=sig}` is another snippet's text, its own
 * placeholders filled, one level deep (a `{snippet}` inside it stays as
 * written).
 */
export const PLACEHOLDERS = ["clipboard", "selection", "files", "date", "time", "datetime", "uuid", "cursor", "snippet"] as const;
/**
 * `format=` tokens for `{date}` and `{time}`: `YYYY`, `YY`, `MM`, `DD`,
 * `HH`, `mm`, `ss`, `ddd` (Mon), `MMM` (Sep); anything else in the format
 * is written as it is (`{date format=DD.MM.YYYY}`, `{time format=HH:mm:ss}`).
 */
export const FORMAT_TOKENS = ["YYYY", "YY", "MM", "DD", "HH", "mm", "ss", "ddd", "MMM"] as const;
/** `offset=`: a signed count of days, weeks, hours or minutes (`+1d`, `-2w`, `+3h`, `-90m`), applied before the format. */
const OFFSET_RE = /^([+-]?\d+)([dwhm])$/;
/** `{name}` or `{name key=value key="a value"}`; the attributes are read by `attrs`. */
const RE = /\{(clipboard|selection|files|date|time|datetime|uuid|cursor|snippet)((?:\s+[a-z]+=(?:"[^"]*"|[^\s}]+))*)\s*\}/g;

/** True when the text has a placeholder to fill. */
export const hasPlaceholders = (text: string) => new RegExp(RE.source).test(text);

/** `key=value key="a value"` into a map; a quoted value keeps its spaces. */
function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-z]+)=(?:"([^"]*)"|([^\s}]+))/g)) out[m[1]] = m[2] ?? m[3];
  return out;
}

/** `d` moved by an `offset=` value; unchanged for a value that is not one. */
export function offsetDate(d: Date, offset: string | undefined): Date {
  const m = offset?.match(OFFSET_RE);
  if (!m) return d;
  const n = Number(m[1]);
  const out = new Date(d);
  switch (m[2]) {
    case "d": out.setDate(out.getDate() + n); break;
    case "w": out.setDate(out.getDate() + 7 * n); break;
    case "h": out.setHours(out.getHours() + n); break;
    default: out.setMinutes(out.getMinutes() + n);
  }
  return out;
}

/** `d` written with the format's tokens (`FORMAT_TOKENS`); the rest of the format as written. */
export function formatDate(d: Date, format: string): string {
  return format.replace(/YYYY|YY|MMM|MM|DD|HH|mm|ss|ddd/g, (t) => {
    switch (t) {
      case "YYYY": return String(d.getFullYear());
      case "YY": return two(d.getFullYear() % 100);
      case "MMM": return MONTHS[d.getMonth()];
      case "MM": return two(d.getMonth() + 1);
      case "DD": return two(d.getDate());
      case "HH": return two(d.getHours());
      case "mm": return two(d.getMinutes());
      case "ss": return two(d.getSeconds());
      default: return DAYS[d.getDay()];
    }
  });
}

/**
 * Every placeholder replaced: `{clipboard}`, `{selection}`, `{files}`
 * (with `sep=`), `{date}`, `{time}`, `{datetime}` (with `format=` and
 * `offset=`), `{uuid}` (a fresh one each), `{snippet name=...}`;
 * `{cursor}` goes. The clipboard, the selection and the files are read
 * once each and only when asked for; a selection read that fails (no
 * Accessibility) falls back to the clipboard rather than failing the
 * paste, a files read that fails is no files. Anything else in braces is
 * left as it is (a snippet of code has braces), a `{snippet}` or a
 * `{files}` with no source or an unknown name too.
 */
export async function expand(text: string, s: Sources, depth = 0): Promise<string> {
  if (!hasPlaceholders(text)) return text;
  const now = (s.now ?? (() => new Date()))();
  const uuid = s.uuid ?? (() => crypto.randomUUID());
  let selected: string | null | undefined;
  let clip: string | undefined;
  let paths: string[] | undefined;
  const clipboard = async () => (clip ??= await s.clipboard());
  const files = async () => (paths ??= await Promise.resolve(s.files!()).catch(() => []));
  const selection = async () => {
    if (selected === undefined) {
      try { selected = s.selection ? await s.selection() : null; } catch { selected = null; }
    }
    return selected || clipboard();
  };
  let out = "";
  let last = 0;
  for (const m of text.matchAll(RE)) {
    out += text.slice(last, m.index);
    last = m.index + m[0].length;
    const a = attrs(m[2]);
    const at = offsetDate(now, a.offset);
    switch (m[1]) {
      case "clipboard": out += await clipboard(); break;
      case "selection": out += await selection(); break;
      case "files": out += s.files ? (await files()).join(a.sep ?? "\n") : m[0]; break;
      case "date": out += a.format ? formatDate(at, a.format) : isoDate(at); break;
      case "time": out += a.format ? formatDate(at, a.format) : isoTime(at); break;
      case "datetime": out += a.format ? formatDate(at, a.format) : `${isoDate(at)} ${isoTime(at)}`; break;
      case "uuid": out += uuid(); break;
      case "cursor": break;
      default: {
        // One level: the other snippet's placeholders are filled, a `{snippet}` inside it is left as written.
        const inner = depth === 0 && a.name && s.snippet ? await s.snippet(a.name) : undefined;
        out += inner === undefined ? m[0] : await expand(inner, { ...s, snippet: undefined }, depth + 1);
      }
    }
  }
  return out + text.slice(last);
}
