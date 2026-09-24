/**
 * A `surface` node (docs/design/game-surface.md): a game's own page in a
 * sandboxed frame (`allow-scripts` alone: an opaque origin, so no reach
 * into this document, its storage or Tauri's IPC) that fills the view
 * body, and the app's half of the kit's postMessage bridge
 * (surface-kit/surface.js). A message counts only from our frame's
 * window. The page's calls go to the host through `SurfaceHost` (the
 * Launcher, which knows the level's extension; the page never names
 * one), its forwarded keys (Escape, ⌘K, the cmd combos it left alone)
 * are dispatched here as the keydowns the panel would have had, and the
 * Launcher's side (a view action, `surface.post`, shown and hidden)
 * comes in through the handle it attaches. The theme goes to the page as
 * every `--pal-*` token's value, on its hello and on every flip; the
 * frame stays invisible until the page says `ready` (a second after it
 * loaded at the latest), so nothing flashes white.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";

/** What the Launcher gives the level's surface. */
export type SurfaceHost = {
  /** The page's URL for the node's `src` (the extension's `ext://` origin). */
  url(src: string): string;
  /** A page's call (`send`, `storage.get`, `storage.set`, `settings`), answered by the host. */
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  /** `pal.title`: the level's title line; empty for the view's own. */
  title(text: string): void;
  /** The frame's handle while it is mounted, null once it is gone. */
  attach(h: SurfaceHandle | null): void;
};
/** The Launcher's way into the page: a message for the kit (`action`, `message`, `settings`, `shown`, `hidden`) and the focus. */
export type SurfaceHandle = { post(msg: { pal: string } & Record<string, unknown>): void; focus(): void };

export const SurfaceContext = createContext<SurfaceHost | null>(null);

/** The page's calls, the only ones relayed. */
const CALLS = new Set(["send", "storage.get", "storage.set", "settings"]);
/** Revealed this long after the load even without `pal.ready()`, so a page that never says it is still seen. */
const READY_FALLBACK_MS = 1000;

/** Every `--pal-*` custom property the document's style sheets declare, once. */
let tokenNames: string[] | null = null;
function tokens(): Record<string, string> {
  if (!tokenNames) {
    const names = new Set<string>();
    const walk = (rules: CSSRuleList) => {
      for (const r of Array.from(rules)) {
        if ("cssRules" in r && (r as CSSGroupingRule).cssRules) walk((r as CSSGroupingRule).cssRules);
        const style = (r as CSSStyleRule).style;
        if (style) for (let i = 0; i < style.length; i++) if (style[i].startsWith("--pal-")) names.add(style[i]);
      }
    };
    for (const s of Array.from(document.styleSheets)) {
      try { walk(s.cssRules); } catch { /* a sheet we may not read */ }
    }
    tokenNames = [...names];
  }
  const cs = getComputedStyle(document.documentElement);
  return Object.fromEntries(tokenNames.map((n) => [n, cs.getPropertyValue(n).trim()]).filter(([, v]) => v));
}
const schemeNow = () => (getComputedStyle(document.documentElement).getPropertyValue("--pal-scheme").trim() === "dark" ? "dark" : "light");

export function Surface({ src }: { src: string }) {
  const host = useContext(SurfaceContext);
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  // The bridge's state outlives a re-render (a new host from the Launcher): posts wait for the kit's hello.
  const bridge = useRef<{ hello: boolean; queue: object[] }>({ hello: false, queue: [] }).current;
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    const win = () => frame.current?.contentWindow;
    const post = (m: object) => { if (bridge.hello) win()?.postMessage(m, "*"); else bridge.queue.push(m); };
    const theme = () => post({ pal: "theme", scheme: schemeNow(), tokens: tokens() });
    const onMessage = (e: MessageEvent) => {
      if (!win() || e.source !== win()) return;
      const m = e.data;
      if (!m || typeof m !== "object") return;
      switch (m.pal) {
        case "hello":
          bridge.hello = true;
          win()?.postMessage({ pal: "theme", scheme: schemeNow(), tokens: tokens() }, "*");
          for (const q of bridge.queue.splice(0)) win()?.postMessage(q, "*");
          break;
        case "ready": setReady(true); break;
        case "title": hostRef.current?.title(String(m.text ?? "")); break;
        case "key": {
          const init: KeyboardEventInit = { key: String(m.key), code: String(m.code ?? ""), metaKey: !!m.metaKey, ctrlKey: !!m.ctrlKey, altKey: !!m.altKey, shiftKey: !!m.shiftKey, repeat: !!m.repeat, bubbles: true, cancelable: true };
          frame.current?.dispatchEvent(new KeyboardEvent("keydown", init));
          break;
        }
        case "call": {
          const reply = (r: { result?: unknown; error?: string }) => win()?.postMessage({ pal: "reply", id: m.id, ...r }, "*");
          const h = hostRef.current;
          if (!h || !CALLS.has(m.method)) { reply({ error: `no surface call ${String(m.method)}` }); break; }
          h.call(m.method, m.params && typeof m.params === "object" ? m.params : {}).then((result) => reply({ result }), (err) => reply({ error: err instanceof Error ? err.message : String(err) }));
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    // A flip: `data-theme` or a theme file's variables on <html>, or the OS's scheme under `system`.
    const mo = new MutationObserver(theme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style"] });
    const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : undefined;
    mq?.addEventListener?.("change", theme);
    return () => { window.removeEventListener("message", onMessage); mo.disconnect(); mq?.removeEventListener?.("change", theme); };
  }, []);

  useEffect(() => {
    if (!host) return;
    host.attach({
      post: (m) => { if (bridge.hello) frame.current?.contentWindow?.postMessage(m, "*"); else bridge.queue.push(m); },
      focus: () => frame.current?.focus(),
    });
    return () => host.attach(null);
  }, [host]);

  const url = host?.url(src);
  const onLoad = () => {
    frame.current?.focus();
    setTimeout(() => setReady(true), READY_FALLBACK_MS);
  };
  return (
    <div className="pal-view__node pal-view__surface" data-ready={ready || undefined}>
      {url && <iframe ref={frame} src={url} sandbox="allow-scripts" title="surface" onLoad={onLoad} />}
    </div>
  );
}
