// Browser bookmark files as data: Chrome's `Bookmarks` JSON (also Brave,
// Edge, Chromium, Arc, Vivaldi), Safari's `Bookmarks.plist` (as the XML
// `plutil -convert xml1` prints), Firefox's `places.sqlite` rows. Pure:
// every reader takes the file's content and answers the same `Found`
// shape, so the tests need no browser and no host.

/** One bookmark: `folder` is its path of folder names, root first (`["Bookmarks Bar", "Dev"]`). */
export type Found = { name: string; url: string; folder: string[] };

/** `calendar.google.com` for `https://calendar.google.com/`: the address without its scheme, `www.` and a trailing slash, the name of a bookmark saved without one (Chrome's bar keeps those nameless). */
export const bareUrl = (url: string): string => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
/** The bookmark's title, else its bare address. */
export const titleOf = (name: unknown, url: string): string => (typeof name === "string" && name.trim() ? name.trim() : bareUrl(url));

const isHttp = (u: unknown): u is string => typeof u === "string" && /^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith("javascript:") && !u.startsWith("place:");

// ---- Chrome ----------------------------------------------------------------

type ChromeNode = { type?: string; name?: string; url?: string; children?: ChromeNode[] };
/** The roots in Chrome's own order; `trash` and unknown roots are skipped. */
const CHROME_ROOTS: [key: string, title: string][] = [["bookmark_bar", "Bookmarks Bar"], ["other", "Other Bookmarks"], ["synced", "Mobile Bookmarks"]];

/** `Bookmarks` JSON: the three roots walked depth first. */
export function chromeBookmarks(json: unknown): Found[] {
  const roots = (json as { roots?: Record<string, ChromeNode> } | null)?.roots;
  if (!roots || typeof roots !== "object") return [];
  const out: Found[] = [];
  const walk = (n: ChromeNode, folder: string[]) => {
    if (n.type === "url") { if (isHttp(n.url)) out.push({ name: titleOf(n.name, n.url), url: n.url, folder }); return; }
    for (const c of n.children ?? []) walk(c, [...folder, n.name ?? ""]);
  };
  for (const [key, title] of CHROME_ROOTS) {
    const root = roots[key];
    if (root?.children) for (const c of root.children) walk(c, [title]);
  }
  return out;
}

// ---- Safari ----------------------------------------------------------------

/** A plist value as JSON: dicts and arrays nest, everything else is its text. */
export type Plist = string | Plist[] | { [key: string]: Plist };

/**
 * The XML plist form (`plutil -convert xml1`), enough for a bookmarks
 * file: `dict`, `array`, `string`, `key`, and the scalars (`date`,
 * `integer`, `real`, `data`, `true`, `false`) as their text.
 */
export function parsePlist(xml: string): Plist | undefined {
  const tags = [...xml.matchAll(/<(\/?)([a-z]+)(\s[^>]*)?(\/?)>|<!--[\s\S]*?-->|<\?[^?]*\?>|<!DOCTYPE[^>]*>/g)];
  let i = 0;
  const textBetween = (from: number, to: number) => xml.slice(from, to).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&");
  const value = (): Plist | undefined => {
    for (; i < tags.length; i++) {
      const t = tags[i];
      if (!t[2] || t[1] === "/") continue;
      const name = t[2], selfClosing = !!t[4];
      i++;
      switch (name) {
        case "plist": return value();
        case "true": case "false": return name;
        case "dict": {
          const d: { [key: string]: Plist } = {};
          if (selfClosing) return d;
          while (i < tags.length && !(tags[i][1] === "/" && tags[i][2] === "dict")) {
            const k = tags[i];
            if (k[2] !== "key" || k[1] === "/") { i++; continue; }
            const close = tags[i + 1];
            const key = textBetween(k.index! + k[0].length, close.index!);
            i += 2;
            const v = value();
            if (v !== undefined) d[key] = v;
          }
          i++;
          return d;
        }
        case "array": {
          const a: Plist[] = [];
          if (selfClosing) return a;
          while (i < tags.length && !(tags[i][1] === "/" && tags[i][2] === "array")) {
            const v = value();
            if (v === undefined) break;
            a.push(v);
          }
          i++;
          return a;
        }
        default: {
          if (selfClosing) return "";
          const close = tags[i];
          const text = close ? textBetween(t.index! + t[0].length, close.index!) : "";
          i++;
          return name === "data" ? text.replace(/\s+/g, "") : text.trim();
        }
      }
    }
    return undefined;
  };
  return value();
}

type SafariNode = { WebBookmarkType?: Plist; Title?: Plist; URLString?: Plist; URIDictionary?: Plist; Children?: Plist };
/** Safari's root folder titles as the app shows them; `com.apple.ReadingList` is skipped. */
const SAFARI_TITLES: Record<string, string> = { BookmarksBar: "Favorites", BookmarksMenu: "Bookmarks Menu" };

/** `Bookmarks.plist` (the XML form): every leaf under the root's children, the Reading List left out. */
export function safariBookmarks(plist: Plist | undefined): Found[] {
  const out: Found[] = [];
  const walk = (n: SafariNode, folder: string[]) => {
    const kind = n.WebBookmarkType;
    if (kind === "WebBookmarkTypeLeaf") {
      const url = n.URLString;
      const title = (n.URIDictionary as { title?: Plist } | undefined)?.title;
      if (isHttp(url)) out.push({ name: titleOf(title, url), url, folder });
      return;
    }
    if (kind !== "WebBookmarkTypeList" || !Array.isArray(n.Children)) return;
    const title = typeof n.Title === "string" ? n.Title : "";
    if (title === "com.apple.ReadingList") return;
    const name = SAFARI_TITLES[title] ?? title;
    for (const c of n.Children) if (c && typeof c === "object" && !Array.isArray(c)) walk(c as SafariNode, name ? [...folder, name] : folder);
  };
  const root = plist as SafariNode | undefined;
  if (root && typeof root === "object" && !Array.isArray(root) && Array.isArray(root.Children)) for (const c of root.Children) if (c && typeof c === "object" && !Array.isArray(c)) walk(c as SafariNode, []);
  return out;
}

// ---- Firefox ---------------------------------------------------------------

/** `moz_bookmarks` rows joined with `moz_places` (the query in index.ts): folders and urls alike. */
export type FirefoxRow = { id: number; parent: number; type: number; title: string | null; url: string | null };
/** Firefox's root folder guids to titles; `tags` is not a bookmark tree. */
const FIREFOX_ROOTS: Record<string, string> = { toolbar: "Bookmarks Toolbar", menu: "Bookmarks Menu", unfiled: "Other Bookmarks", mobile: "Mobile Bookmarks" };

/** The bookmarks (`type` 1) with their folder path from the `type` 2 rows; the `tags` and `root` folders are not part of a path. */
export function firefoxBookmarks(rows: FirefoxRow[]): Found[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path = (id: number, depth = 0): string[] | undefined => {
    const r = byId.get(id);
    if (!r || depth > 64) return [];
    if (r.type !== 2) return undefined;
    if (r.parent === 0 || !byId.has(r.parent)) return [];
    const parent = byId.get(r.parent)!;
    const title = r.title ?? "";
    if (parent.parent === 0 || !byId.has(parent.parent)) {
      if (title === "tags") return undefined;
      return [FIREFOX_ROOTS[title] ?? title];
    }
    const up = path(r.parent, depth + 1);
    return up && [...up, title];
  };
  const out: Found[] = [];
  for (const r of rows) {
    if (r.type !== 1 || !isHttp(r.url)) continue;
    const folder = path(r.parent);
    if (folder) out.push({ name: titleOf(r.title, r.url), url: r.url, folder });
  }
  return out;
}

// ---- helpers ---------------------------------------------------------------

/** True when an `exclude_folders` entry (a name, or a few segments like `Bookmarks Bar/Old`) is in the path. */
export function excludedFolder(folder: string[], exclude: string[]): boolean {
  const path = "/" + folder.join("/") + "/";
  return exclude.some((x) => {
    const e = x.replace(/^\/+|\/+$/g, "");
    return !!e && path.toLowerCase().includes(`/${e.toLowerCase()}/`);
  });
}

/** `[name](url)` for a markdown link, the name's brackets escaped. */
export const markdownLink = (name: string, url: string) => `[${name.replace(/[[\]]/g, "\\$&")}](${url})`;
