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
// extension's own, `score`, `leaderboard`, `account` and `signIn` reach
// the user's pal account through the core. The theme arrives as every
// `--pal-*` token on :root and `data-theme` on <html>, again on every
// flip. Escape and ⌘K go to the panel, and so does any cmd combo the page
// does not preventDefault.
//
// Opened in a plain browser (`window.parent === window`), or framed with
// `?web`, it is a stub, so a page is developed, screenshot and played in
// a browser as is: storage in localStorage, settings from
// `?settings=<json>`, the theme from `?theme=dark|light` or the OS
// (tokens.css linked for the values), sends logged to the console, a
// score kept as is, no board, signed out. Framed with `?play=1` (the game
// page on play.cagdas.io), the same stub but storage and the account
// calls go to that page, which keeps and syncs them: `{ pal: "call", id,
// method, params }` up, `{ pal: "result", id, result | error }` and `{
// pal: "storage", key, value }` down.
(() => {
  const q = new URLSearchParams(location.search);
  const framed = window.parent !== window;
  const play = framed && q.get("play") === "1";
  const inPal = framed && !q.has("web") && !play;
  const root = document.documentElement;
  const handlers = { message: [], action: [], settings: [], theme: [], shown: [], hidden: [], storage: [] };
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
  const onStorage = (fn) => on("storage")((m) => fn(m.key, m.value));

  // Calls answered by the parent window (the app, or the play page), each by its id.
  const pending = new Map();
  let seq = 0;
  const callUp = (method, params) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); window.parent.postMessage({ pal: "call", id, method, params }, "*"); });
  const settle = (m) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error !== undefined) p.reject(new Error(String(m.error)));
    else p.resolve(m.result);
  };
  /** The kit's account calls over `call`: the app's host, or the play page. */
  const accountCalls = (call) => ({
    score: (board, value, opts = {}) => call("score", { board: String(board), value, ...(typeof opts.replay === "string" && opts.replay && { replay: opts.replay }) }),
    replay: (board, key) => call("replay", { board: String(board), key: String(key) }),
    leaderboard: (board, opts = {}) => call("leaderboard", { board: String(board), ...(opts.period && { period: opts.period }), ...(opts.anon !== undefined && { anon: !!opts.anon }) }),
    account: () => call("account", {}),
    signIn: () => call("signIn", {}).then(() => undefined),
  });

  // The design faces the `--pal-font-*` tokens name (fonts.css, the kit's route); a face loads only once text in it shows.
  const faces = document.createElement("link");
  faces.rel = "stylesheet";
  faces.href = "/__pal/fonts.css";
  document.head.prepend(faces);

  if (!inPal) {
    // ---- the browser stub ------------------------------------------------
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
      storage: play ? {
        get: (k) => callUp("storage.get", { key: String(k) }),
        set: (k, v) => callUp("storage.set", { key: String(k), value: v === undefined ? null : v }).then(() => undefined),
        onChange: onStorage,
      } : {
        get: async (k) => { const v = localStorage.getItem(key(k)); return v === null ? null : JSON.parse(v); },
        set: async (k, v) => { if (v === null || v === undefined) localStorage.removeItem(key(k)); else localStorage.setItem(key(k), JSON.stringify(v)); },
        onChange: onStorage,
      },
      settings: async () => settings,
      title: (text) => { document.title = String(text); },
      ready: () => {},
      ...(play ? accountCalls(callUp) : {
        score: async (board, value) => ({ best: value, rank: null, total: null }),
        leaderboard: async () => ({ board: null, rows: [], me: null }),
        replay: async () => { throw new Error("no replays without a server"); },
        account: async () => ({ signedIn: false, handle: null }),
        signIn: async () => {},
      }),
    });
    if (play) {
      window.addEventListener("message", (e) => {
        if (e.source !== window.parent) return;
        const m = e.data;
        if (!m || typeof m !== "object") return;
        if (m.pal === "result") settle(m);
        else if (m.pal === "storage" && typeof m.key === "string") fire("storage", { key: m.key, value: m.value ?? null });
      });
      // A key the game left alone would scroll the play page around the frame.
      const scrolls = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "PageUp", "PageDown", "Home", "End"]);
      window.addEventListener("keydown", (e) => {
        const t = e.target;
        if (scrolls.has(e.key) && !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "")))) e.preventDefault();
      });
    }
    document.addEventListener("visibilitychange", () => fire(document.hidden ? "hidden" : "shown"));
    window.pal = pal;
    return;
  }

  // ---- inside pal ------------------------------------------------------------
  const up = (m) => window.parent.postMessage(m, "*");
  const call = callUp;
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
      case "reply": settle(m); break;
      case "message": fire("message", m.data); break;
      case "settings": fire("settings", m.data); break;
      case "storage": if (typeof m.key === "string") fire("storage", { key: m.key, value: m.value ?? null }); break;
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
      onChange: onStorage,
    },
    settings: () => call("settings", {}),
    title: (text) => up({ pal: "title", text: String(text) }),
    ready: () => { readyAsked = true; tellReady(); },
    ...accountCalls(call),
  });
  window.pal = pal;
  up({ pal: "hello" });
})();
