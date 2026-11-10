/**
 * Whether this page is on screen: the document not hidden, and the shell
 * not having said it hid the window (`pal://visible`, views.rs; the macOS
 * panel's page stays visible to WebKit between shows). A poll that only
 * matters on screen runs while this is true.
 */
import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";

let shell = true;
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());
let started = false;

function start() {
  if (started) return;
  started = true;
  document.addEventListener("visibilitychange", changed);
  listen<{ visible: boolean }>("pal://visible", (e) => { shell = e.payload.visible; changed(); }).catch(() => {});
}

export const pageVisible = () => shell && document.visibilityState !== "hidden";

const subscribe = (f: () => void) => {
  start();
  subs.add(f);
  return () => { subs.delete(f); };
};

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, pageVisible, () => true);
}
