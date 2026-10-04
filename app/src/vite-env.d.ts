/// <reference types="vite/client" />

/** What the gallery reads of the extension repos (vite.config.ts `extensions()`). */
declare module "virtual:pal-extensions" {
  /** Every extension's pal.json. */
  export const manifests: { name: string; title: string; icon?: unknown; [k: string]: unknown }[];
  /** The screenshot fixtures by file name (`tela.json`, `bar-tela.json`, `hero.json`), each loaded on demand. */
  export const shots: Record<string, () => Promise<{ default: unknown }>>;
}

/** What Tauri's runtime hangs on the window; only `convertFileSrc` is read (ui/icons.ts). Absent in a plain browser. */
interface Window {
  __TAURI_INTERNALS__?: { convertFileSrc?: (path: string, protocol: string) => string };
}
