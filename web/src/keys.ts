/** The keys `embed.ts` opens pal with on a page (`data-keys`), the same defaults on every site. */
export type Keys = { panel: string | null; bar: string | null };

export const DEFAULT_KEYS: Keys = { panel: "shift+p", bar: "shift+b" };

/** `data-keys`: `panel:<combo> bar:<combo>` (space or comma separated, `none` for either or for both). */
export function parseKeys(spec: string | undefined): Keys {
  const keys = { ...DEFAULT_KEYS };
  if (spec?.trim() === "none") return { panel: null, bar: null };
  for (const part of (spec ?? "").split(/[\s,]+/).filter(Boolean)) {
    const [name, combo] = part.split(":");
    if (name === "panel" || name === "bar") keys[name] = !combo || combo === "none" ? null : combo.toLowerCase();
  }
  return keys;
}

type KeyLike = Pick<KeyboardEvent, "key" | "code" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">;

/** Whether `e` is `combo` (`shift+p`, `ctrl+k`, `alt+space`), modifiers exact; a letter or digit also by its physical key, which macOS's Option changes the character of. */
export function matches(combo: string, e: KeyLike): boolean {
  const parts = combo.split("+");
  const key = combo.endsWith("++") || combo === "+" ? "+" : parts.pop()!;
  const mods = new Set(parts.filter(Boolean));
  if (e.shiftKey !== mods.has("shift") || e.ctrlKey !== mods.has("ctrl") || e.altKey !== (mods.has("alt") || mods.has("option")) || e.metaKey !== (mods.has("meta") || mods.has("cmd"))) return false;
  const name = key === "space" ? " " : key;
  if (e.key.toLowerCase() === name) return true;
  return /^[a-z]$/.test(name) ? e.code === `Key${name.toUpperCase()}` : /^\d$/.test(name) && e.code === `Digit${name}`;
}
