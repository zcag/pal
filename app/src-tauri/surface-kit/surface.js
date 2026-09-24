// pal's surface kit (docs/design/game-surface.md): `window.pal` for a game
// page in a `surface` node. Include it first, as a classic script:
//
//   <script src="/__pal/surface.js"></script>
//
// Inside pal the page runs in a sandboxed frame and everything here is
// postMessage to the app, which alone knows which extension the frame
// belongs to: `send` reaches the palette's `onMessage` (its return value
// is the reply), `on` hears `surface.post`, `onAction` a view action
// picked from ⌘K or the footer, `storage` and `settings` are the
// extension's own. The theme arrives as every `--pal-*` token on :root
// and `data-theme` on <html>, again on every flip. Escape and ⌘K go to
// the panel, and so does any cmd combo the page does not preventDefault.
//
// Opened in a plain browser (`window.parent === window`) it is a stub, so
// a page is developed and screenshot in Chrome as is: storage in
// localStorage, settings from `?settings=<json>`, the theme from
// `?theme=dark|light` or the OS (tokens.css linked for the values), sends
// logged to the console.
(() => {
  const inPal = window.parent !== window;
  const root = document.documentElement;
  const handlers = { message: [], action: [], settings: [], theme: [], shown: [], hidden: [] };
  // A message, an action or settings that arrive before the page listens (its module runs after this script, and the app
  // flushes what it held at the hello) wait for the first handler of their kind; the rest are states, sent again anyway.
  const early = { message: [], action: [], settings: [] };
  const call1 = (f, v) => { try { f(v); } catch (e) { console.error(e); } };
  const fire = (kind, v) => { if (!handlers[kind].length && early[kind]) early[kind].push(v); else for (const f of handlers[kind]) call1(f, v); };
  const on = (kind) => (fn) => {
    handlers[kind].push(fn);
    if (early[kind]?.length) { const held = early[kind].splice(0); queueMicrotask(() => held.forEach((v) => call1(fn, v))); }
    return () => { const i = handlers[kind].indexOf(fn); if (i >= 0) handlers[kind].splice(i, 1); };
  };
  let scheme = "light";
  const setScheme = (s) => { scheme = s === "dark" ? "dark" : "light"; root.dataset.theme = scheme; fire("theme", scheme); };

  const pal = {
    on: on("message"), onAction: on("action"), onSettings: on("settings"), onTheme: on("theme"), onShown: on("shown"), onHidden: on("hidden"),
  };

  if (!inPal) {
    // ---- the browser stub ------------------------------------------------
    const q = new URLSearchParams(location.search);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/__pal/tokens.css";
    document.head.prepend(link);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const pinned = q.get("theme");
    setScheme(pinned || (mq.matches ? "dark" : "light"));
    if (!pinned) mq.addEventListener("change", () => setScheme(mq.matches ? "dark" : "light"));
    let settings = {};
    try { settings = JSON.parse(q.get("settings") || "{}"); } catch (e) { console.error("pal stub: ?settings= is not JSON", e); }
    const key = (k) => `pal:${location.pathname}:${k}`;
    Object.assign(pal, {
      send: async (msg) => { console.log("pal.send", msg); return undefined; },
      storage: {
        get: async (k) => { const v = localStorage.getItem(key(k)); return v === null ? null : JSON.parse(v); },
        set: async (k, v) => { if (v === null || v === undefined) localStorage.removeItem(key(k)); else localStorage.setItem(key(k), JSON.stringify(v)); },
      },
      settings: async () => settings,
      title: (text) => { document.title = String(text); },
      ready: () => {},
    });
    document.addEventListener("visibilitychange", () => fire(document.hidden ? "hidden" : "shown"));
    window.pal = pal;
    return;
  }

  // ---- inside pal ------------------------------------------------------------
  const up = (m) => window.parent.postMessage(m, "*");
  const pending = new Map();
  let seq = 0;
  const call = (method, params) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); up({ pal: "call", id, method, params }); });
  // `ready` waits for the theme, so the page the app reveals is already in its colours.
  let themed = false, readyAsked = false;
  const tellReady = () => { if (themed && readyAsked) up({ pal: "ready" }); };

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent) return;
    const m = e.data;
    if (!m || typeof m !== "object") return;
    switch (m.pal) {
      case "theme":
        for (const [k, v] of Object.entries(m.tokens || {})) if (k.startsWith("--pal-")) root.style.setProperty(k, String(v));
        setScheme(m.scheme);
        if (!themed) { themed = true; tellReady(); }
        break;
      case "reply": {
        const p = pending.get(m.id);
        if (!p) break;
        pending.delete(m.id);
        if (m.error !== undefined) p.reject(new Error(String(m.error)));
        else p.resolve(m.result);
        break;
      }
      case "message": fire("message", m.data); break;
      case "settings": fire("settings", m.data); break;
      case "action": fire("action", String(m.id)); break;
      case "shown": fire("shown"); break;
      case "hidden": fire("hidden"); break;
    }
  });

  // The panel's keys: Escape and ⌘K always, another cmd combo unless the page took it (known once every listener has run).
  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  window.addEventListener("keydown", (e) => {
    const fwd = () => up({ pal: "key", key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, repeat: e.repeat });
    const cmd = mac ? e.metaKey : e.ctrlKey;
    if (e.key === "Escape" || (cmd && e.code === "KeyK" && !e.altKey && !e.shiftKey)) { e.preventDefault(); fwd(); return; }
    if (e.metaKey || e.ctrlKey) setTimeout(() => { if (!e.defaultPrevented) fwd(); });
  });

  Object.assign(pal, {
    send: (msg) => call("send", { msg }),
    storage: {
      get: (key) => call("storage.get", { key }),
      set: (key, value) => call("storage.set", { key, value: value === undefined ? null : value }).then(() => undefined),
    },
    settings: () => call("settings", {}),
    title: (text) => up({ pal: "title", text: String(text) }),
    ready: () => { readyAsked = true; tellReady(); },
  });
  window.pal = pal;
  up({ pal: "hello" });
})();
