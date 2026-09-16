import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { followTheme } from "./theme";
import "./styles.css";

// `?gallery` in a plain browser renders the component review page instead of
// the launcher; `?settings` is the settings window and `?hud` the HUD window
// (same bundle, second and third Tauri windows).
const Gallery = lazy(() => import("./gallery/Gallery"));
const Settings = lazy(() => import("./Settings"));
const HudPage = lazy(() => import("./HudPage"));
const params = new URLSearchParams(location.search);
const gallery = params.has("gallery");
const settings = params.has("settings");
const hud = params.has("hud");

if (!gallery) followTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  gallery ? <Suspense><Gallery /></Suspense> : settings ? <Suspense><Settings /></Suspense> : hud ? <Suspense><HudPage /></Suspense> : <App />,
);
