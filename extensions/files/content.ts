// File content search as data: how a query asks for it, the tool per
// platform, and the first matching line as a row's subtitle. Pure; the
// spawning is index.ts's.

/** What the query asks for: the name search, the content search, or both. */
export type Ask = { name: string; content: string; only: boolean };

/**
 * `'foo` or `content:foo` searches contents only (Alfred's `in` prefix);
 * anything else searches names, with the same words in contents as a
 * second section. Blank after the prefix asks for nothing.
 */
export function parseQuery(q: string): Ask {
  const t = q.trim();
  const m = t.match(/^(?:'|content:)\s*(.*)$/);
  if (m) return { name: "", content: m[1].trim(), only: true };
  return { name: t, content: t, only: false };
}

export type ContentBackend = "mdfind" | "rg" | "grep";

/** The file-listing command: paths of files whose text contains `q`, case-insensitive, under `folders`. */
export function contentArgv(b: ContentBackend, q: string, folders: string[], hidden: boolean): string[] {
  switch (b) {
    // Spotlight's content index; the quoted value is a literal (its own `*` glob wraps it), `cd` is case- and diacritic-insensitive.
    case "mdfind": return ["mdfind", ...folders.flatMap((f) => ["-onlyin", f]), `kMDItemTextContent == "*${q.replace(/["\\]/g, "\\$&")}*"cd`];
    // Files with a match, fixed string, the walk respecting .gitignore unless hidden files are asked for.
    case "rg": return ["rg", "--files-with-matches", "--fixed-strings", "--ignore-case", "--no-messages", ...(hidden ? ["--hidden"] : []), "--", q, ...folders];
    // Text files only (`-I` skips binaries), recursive, fixed string.
    case "grep": return ["grep", "-rlIiF", ...(hidden ? [] : ["--exclude-dir=.*"]), "--", q, ...folders];
  }
}

/** The snippet command: the first matching line of one file, `n:text`. */
export function snippetArgv(b: ContentBackend, q: string, path: string): string[] {
  return b === "rg"
    ? ["rg", "--line-number", "--max-count", "1", "--fixed-strings", "--ignore-case", "--no-messages", "--", q, path]
    : ["grep", "-niF", "-m", "1", "--", q, path];
}

/** `12:  the line` as the one-line snippet: whitespace collapsed, cut to `max`; the line number dropped. Empty when the tool printed nothing. */
export function snippet(out: string, max = 100): string {
  const line = out.split("\n").find((l) => l.trim()) ?? "";
  const text = line.replace(/^\d+:/, "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
