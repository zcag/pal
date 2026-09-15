/**
 * URLs for the app's `icon://` scheme, which serves size-normalised PNGs of
 * an application's artwork or a site's favicon (app/src-tauri/src/icon.rs).
 * The scheme's base differs per platform (`icon://localhost/` on macOS and
 * Linux, `http://icon.localhost/` on Windows); Tauri's own `convertFileSrc`
 * knows which, so the base is taken from it when the page runs in Tauri.
 * Outside Tauri (the gallery in a plain browser) the requests just fail
 * and the icon falls back.
 */
type Internals = { convertFileSrc?: (path: string, protocol: string) => string };

const base: string = (() => {
  const i = (window as unknown as { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__;
  try {
    return i?.convertFileSrc?.("", "icon") ?? "icon://localhost/";
  } catch {
    return "icon://localhost/";
  }
})();

export const appIconUrl = (path: string, size: number) => `${base}app?path=${encodeURIComponent(path)}&size=${size}`;
export const faviconUrl = (url: string, size: number) => `${base}favicon?url=${encodeURIComponent(url)}&size=${size}`;
