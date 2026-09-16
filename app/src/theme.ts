/**
 * `general.theme` onto <html data-theme>: tokens.css pins light or dark on
 * that attribute and follows the OS without it. Every window applies it,
 * from `settings_theme` at start and from every `pal://config` the core
 * emits after a reload.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type Theme = "system" | "light" | "dark";

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
}

type ConfigEvent = { config?: { general?: { theme?: Theme } } };

/** Applies the theme now and keeps it applied; returns the stop function. */
export function followTheme(): () => void {
  invoke<Theme>("settings_theme").then(applyTheme).catch(() => {});
  const un = listen<ConfigEvent>("pal://config", (e) => applyTheme(e.payload.config?.general?.theme));
  return () => { un.then((f) => f()); };
}
