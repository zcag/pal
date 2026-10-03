// The web build's entry (web.html): the Tauri IPC answered in the page
// (core.ts), then the app's own entry, unchanged.
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { handle } from "./core";

mockWindows("main");
mockIPC(handle, { shouldMockEvents: true });
// `ext://` (a game surface's page) is the build's `ext/` folder; `icon://` (file thumbnails) has nothing behind it here.
const base = new URL(".", document.baseURI).href;
(window as any).__TAURI_INTERNALS__.convertFileSrc = (_: string, scheme: string) => `${base}${scheme}/`;

import("../main");
