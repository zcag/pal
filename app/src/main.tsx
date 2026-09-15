import { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// `?gallery` in a plain browser renders the component review page instead of the launcher.
const Gallery = lazy(() => import("./gallery/Gallery"));
const gallery = new URLSearchParams(location.search).has("gallery");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  gallery ? <Suspense><Gallery /></Suspense> : <App />,
);
