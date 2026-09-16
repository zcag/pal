/**
 * The gallery's reading of a theme file (examples/themes/*.toml): the
 * flat TOML the format allows, `key = "value"` or `key = 14` at the top
 * level and under `[light]` / `[dark]`, into the shape `applyThemeFile`
 * takes. The app never runs this: `pal_core::theme` parses the real
 * file and validates every key; this is just enough to draw the examples
 * in the gallery from the same files that ship.
 */
import type { ThemeFile } from "../theme";

const cssVar = (key: string) => `--pal-${key.replace(/_/g, "-")}`;

export function parseThemeToml(text: string, file = "theme.toml"): ThemeFile {
  const theme: ThemeFile["theme"] = { name: null, light: {}, dark: {} };
  const both: Record<string, string> = {};
  let section: "light" | "dark" | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const head = /^\[(light|dark)\]$/.exec(line);
    if (head) { section = head[1] as "light" | "dark"; continue; }
    // A quoted value keeps its `#` (a hex colour); a bare one ends at a comment.
    const kv = /^([a-z_]+)\s*=\s*(?:"([^"]*)"|([^#]+))/.exec(line);
    if (!kv) continue;
    const [, key, quoted, bare] = kv;
    const value = quoted !== undefined ? quoted : /^\d+(\.\d+)?$/.test(bare.trim()) ? `${bare.trim()}px` : bare.trim();
    if (key === "name" && !section) { theme.name = value; continue; }
    if (section) theme[section][cssVar(key)] = value;
    else both[cssVar(key)] = value;
  }
  theme.light = { ...both, ...theme.light };
  theme.dark = { ...both, ...theme.dark };
  return { file, theme, diagnostics: [] };
}
