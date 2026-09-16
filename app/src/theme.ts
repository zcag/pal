/**
 * `general.theme` onto <html data-theme>: tokens.css pins light or dark on
 * that attribute and follows the OS without it. Both windows (the panel and
 * settings) apply it, from `settings_get` at start and from every
 * `pal://config` the core emits after a reload.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Theme = "system" | "light" | "dark";

export function applyTheme(theme: Theme | undefined) {
  const el = document.documentElement;
  if (theme === "light" || theme === "dark") el.dataset.theme = theme;
  else delete el.dataset.theme;
}

type ConfigEvent = { config?: { general?: { theme?: Theme } } };

/** Applies the theme now and keeps it applied; returns the stop function. */
export function followTheme(): () => void {
  invoke<ConfigEvent>("settings_get").then((v) => applyTheme(v.config?.general?.theme)).catch(() => {});
  const un = listen<ConfigEvent>("pal://config", (e) => applyTheme(e.payload.config?.general?.theme));
  return () => { un.then((f) => f()); };
}
