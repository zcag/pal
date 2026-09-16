// Recently used files as data: the lines `mdfind -attr kMDItemLastUsedDate`
// prints on macOS, and GTK's `recently-used.xbel` on Linux. Pure, so the
// tests need no Spotlight. Both answer paths with the moment they were
// last used, newest first.

export type Recent = { path: string; at: number };

/** `<path>   kMDItemLastUsedDate = 2026-09-16 07:41:41 +0000` per line; a line without a date is skipped. */
export function parseMdfindRecent(out: string): Recent[] {
  const found: Recent[] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^(.*?)\s+kMDItemLastUsedDate = (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) ([+-]\d{4})$/);
    if (!m) continue;
    const at = Date.parse(`${m[2].replace(" ", "T")}${m[3].slice(0, 3)}:${m[3].slice(3)}`);
    if (!Number.isNaN(at)) found.push({ path: m[1], at });
  }
  return found.sort((a, b) => b.at - a.at);
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Every `<bookmark href="file://…" … visited="…">` (else `modified`, else `added`), local files only. */
export function parseXbel(xml: string): Recent[] {
  const found: Recent[] = [];
  for (const m of xml.matchAll(/<bookmark\s([^>]*)>/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], decode(a[2])]));
    const href = attrs.href;
    if (!href?.startsWith("file://")) continue;
    let path: string;
    try { path = decodeURIComponent(href.slice("file://".length)); } catch { continue; }
    const at = Date.parse(attrs.visited ?? attrs.modified ?? attrs.added ?? "");
    if (!Number.isNaN(at)) found.push({ path, at });
  }
  return found.sort((a, b) => b.at - a.at);
}
