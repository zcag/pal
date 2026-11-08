// First import of main.tsx, so what Tauri's runtime would provide is there
// before any page module runs: in a plain browser, apart from the gallery,
// the page is a remote one (remote.ts).
import { install } from "./remote";

if (!window.__TAURI_INTERNALS__ && !new URLSearchParams(location.search).has("gallery")) install();
