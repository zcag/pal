import type { ComponentType } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { followTheme } from "./theme";
import "./styles.css";

// `?gallery` in a plain browser renders the component review page instead of
// the launcher; `?settings` is the settings window, `?hud` the HUD window,
// `?large` the Large Type window and `?bar` the bar items' popover (same
// bundle, the other Tauri windows).
// The other pages are their own chunks, imported before the render rather
// than through `lazy` + `Suspense`: React holds a resolved lazy component
// back for 300 ms after showing a fallback (its fallback throttle), which
// was most of the settings window's open-to-paint.
const params = new URLSearchParams(location.search);
const gallery = params.has("gallery");
const settings = params.has("settings");
const hud = params.has("hud");
const large = params.has("large");
const bar = params.has("bar");

if (!gallery) followTheme();

const page: Promise<{ default: ComponentType }> = gallery ? import("./gallery/Gallery") : settings ? import("./Settings") : hud ? import("./HudPage") : large ? import("./LargePage") : bar ? import("./BarPage") : Promise.resolve({ default: App });
page.then(({ default: Page }) => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Page />));

// An uncaught page error takes the React tree down to a blank window, and a release build has no devtools to see why: the message goes to pal's log as a `mark` line instead.
const report = (what: string, e: unknown) => { void import("@tauri-apps/api/core").then(({ invoke }) => invoke("mark", { name: `page-error ${location.search} ${what}: ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}` })).catch(() => {}); };
window.addEventListener("error", (ev) => report("error", ev.error ?? ev.message));
window.addEventListener("unhandledrejection", (ev) => report("rejection", ev.reason));
