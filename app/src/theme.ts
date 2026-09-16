/**
 * `general.theme` onto <html data-theme>: tokens.css pins light or dark on
 * that attribute and follows the OS without it. Every window applies it,
 * from `settings_theme` at start and from every `pal://config` the core
 * emits after a reload.
 *
 * The theme file (`general.theme_file`, `pal_core::theme`) rides on
 * `pal://theme` as CSS variables per scheme; `applyThemeFile` sets the
 * ones for the scheme in force on `:root` (inline, so they win over
 * tokens.css) and swaps them when the scheme flips: `data-theme`, or the
 * OS's own switch while `system` is set. `general.compact` lands on
 * `data-density` the same way (`pal://config`, `settings_general` at
 * load), which tokens.css reads for the compact geometry.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Theme = "system" | "light" | "dark";

/** `theme.rs` `Current`: the file's variables per scheme, `--pal-*` to a CSS value. */
export type ThemeFile = { file?: string; theme: { name?: string | null; light: Record<string, string>; dark: Record<string, string> }; diagnostics: unknown[] };

/**
 * The page's tokens, and the window's own appearance with them: the OS
 * draws the vibrancy behind the settings window, the scrollbars and the
 * popup menus, and would draw them for the OS's scheme, not pal's.
 */
export function applyTheme(theme: Theme | undefined) {
  const el = document.documentElement;
  const pinned = theme === "light" || theme === "dark" ? theme : null;
  if (pinned) el.dataset.theme = pinned;
  else delete el.dataset.theme;
  getCurrentWindow().setTheme(pinned).catch(() => {});
  applyThemeFile(current);
}

/** `general.compact` onto <html data-density>: `compact`, or the attribute gone. */
export function applyDensity(compact: boolean | undefined) {
  const el = document.documentElement;
  if (compact) el.dataset.density = "compact";
  else delete el.dataset.density;
}

/** The scheme the tokens are drawn for right now: the pin, else the OS. */
export function schemeInForce(el: HTMLElement = document.documentElement): "light" | "dark" {
  const pinned = el.dataset.theme;
  if (pinned === "light" || pinned === "dark") return pinned;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** What `applyThemeFile` last set, so a scheme flip re-applies the right section and a new file clears the old one's variables. */
let current: ThemeFile | null = null;
let applied: string[] = [];

/**
 * The theme file's variables for the scheme in force onto `:root`, the
 * previous set cleared first; `null` (no file) clears everything. Pure
 * DOM, so the gallery can call it with a parsed file too.
 */
export function applyThemeFile(t: ThemeFile | null, el: HTMLElement = document.documentElement) {
  current = t;
  for (const k of applied) el.style.removeProperty(k);
  applied = [];
  if (!t) return;
  const vars = t.theme[schemeInForce(el)] ?? {};
  for (const [k, v] of Object.entries(vars)) {
    if (!k.startsWith("--pal-")) continue;
    el.style.setProperty(k, v);
    applied.push(k);
  }
}

type ConfigEvent = { config?: { general?: { theme?: Theme; compact?: boolean } } };

/** Applies the theme now and keeps it applied; returns the stop function. */
export function followTheme(): () => void {
  invoke<Theme>("settings_theme").then(applyTheme).catch(() => {});
  invoke<{ compact?: boolean }>("settings_general").then((g) => applyDensity(g?.compact)).catch(() => {});
  invoke<ThemeFile>("theme_current").then(applyThemeFile).catch(() => {});
  const un = listen<ConfigEvent>("pal://config", (e) => { applyTheme(e.payload.config?.general?.theme); applyDensity(e.payload.config?.general?.compact); });
  const unTheme = listen<ThemeFile>("pal://theme", (e) => applyThemeFile(e.payload));
  // While `system` is set the OS's flip changes which section applies.
  const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const onScheme = () => applyThemeFile(current);
  mq?.addEventListener("change", onScheme);
  return () => { un.then((f) => f()); unTheme.then((f) => f()); mq?.removeEventListener("change", onScheme); };
}
