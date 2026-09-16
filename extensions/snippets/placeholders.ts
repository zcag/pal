// Snippet text as data: the stored shape and the dynamic placeholders
// filled in when a snippet is pasted. Pure; the clipboard and the clock
// come in as arguments so the tests can pin them.

export type Snippet = { id: string; name: string; keyword?: string; text: string };

/**
 * What a placeholder needs from outside: the clipboard's text (asked only
 * when `{clipboard}` occurs), the selected text (asked only for
 * `{selection}`; the clipboard stands in when it answers nothing or is
 * absent), the moment, and fresh ids.
 */
export type Sources = { clipboard: () => Promise<string> | string; selection?: () => Promise<string | null> | string | null; now?: () => Date; uuid?: () => string };

const two = (n: number) => String(n).padStart(2, "0");
/** Local date as `YYYY-MM-DD`. */
export const isoDate = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
/** Local time as `HH:MM`. */
export const isoTime = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}`;

/**
 * The placeholders in the order they are looked for; `{datetime}` is date
 * and time with a space. `{selection}` is the text selected in the app in
 * front (`selection.text()`; Raycast's spelling), the clipboard when
 * nothing is selected or the read is refused. `{cursor}` is not one: pal
 * pastes whole and cannot place the caret, so it stays in the text.
 */
export const PLACEHOLDERS = ["clipboard", "selection", "date", "time", "datetime", "uuid"] as const;
const RE = /\{(clipboard|selection|date|time|datetime|uuid)\}/g;

/** True when the text has a placeholder to fill. */
export const hasPlaceholders = (text: string) => new RegExp(RE.source).test(text);

/**
 * Every `{clipboard}`, `{selection}`, `{date}`, `{time}`, `{datetime}` and
 * `{uuid}` replaced; every `{uuid}` is a fresh one, the clipboard and the
 * selection are read once each and only when asked for. A selection read
 * that fails (no Accessibility) falls back to the clipboard rather than
 * failing the paste. Anything else in braces is left as it is (a snippet
 * of code has braces).
 */
export async function expand(text: string, s: Sources): Promise<string> {
  if (!hasPlaceholders(text)) return text;
  const now = (s.now ?? (() => new Date()))();
  const uuid = s.uuid ?? (() => crypto.randomUUID());
  let selected: string | null = null;
  if (text.includes("{selection}") && s.selection) {
    try { selected = await s.selection(); } catch { selected = null; }
  }
  const clip = text.includes("{clipboard}") || (text.includes("{selection}") && !selected) ? await s.clipboard() : "";
  return text.replace(RE, (_, k: string) => {
    switch (k) {
      case "clipboard": return clip;
      case "selection": return selected || clip;
      case "date": return isoDate(now);
      case "time": return isoTime(now);
      case "datetime": return `${isoDate(now)} ${isoTime(now)}`;
      default: return uuid();
    }
  });
}

/** The stored list, defensively: whatever is not a snippet with an id, a name and a text is dropped. */
export const asSnippets = (v: unknown): Snippet[] =>
  Array.isArray(v)
    ? v.filter((x): x is Snippet => !!x && typeof x === "object" && typeof (x as Snippet).id === "string" && typeof (x as Snippet).name === "string" && typeof (x as Snippet).text === "string")
        .map((x) => ({ id: x.id, name: x.name, text: x.text, ...(typeof x.keyword === "string" && x.keyword ? { keyword: x.keyword } : {}) }))
    : [];

/**
 * An import file as snippets: a JSON array of `{name, text, keyword?}`
 * (Raycast's export shape too); anything without a name and a text is
 * dropped, a keyword with a space in it too, and every snippet gets a
 * fresh id. Throws on a non-array.
 */
export function fromJson(data: unknown): Snippet[] {
  if (!Array.isArray(data)) throw new Error("expected a JSON array of {name, text, keyword?}");
  return data
    .map((r) => (r && typeof r === "object" ? (r as { name?: unknown; text?: unknown; keyword?: unknown }) : {}))
    .filter((r) => typeof r.name === "string" && r.name.trim() && typeof r.text === "string" && r.text.trim())
    .map((r) => {
      const keyword = typeof r.keyword === "string" ? r.keyword.trim() : "";
      return { id: crypto.randomUUID(), name: (r.name as string).trim(), text: r.text as string, ...(keyword && !badKeyword(keyword) && { keyword }) };
    });
}

/** A keyword is one word: no spaces, so typing it finds the row whole. */
export const badKeyword = (k: string): string | undefined => (/\s/.test(k.trim()) ? "One word, no spaces" : undefined);

/** The first line of the text, trimmed to `max` characters, for a subtitle. */
export function preview(text: string, max = 80): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

