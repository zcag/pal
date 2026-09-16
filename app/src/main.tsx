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
