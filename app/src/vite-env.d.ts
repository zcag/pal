/// <reference types="vite/client" />

/** What Tauri's runtime hangs on the window; only `convertFileSrc` is read (ui/icons.ts). Absent in a plain browser. */
interface Window {
  __TAURI_INTERNALS__?: { convertFileSrc?: (path: string, protocol: string) => string };
}
