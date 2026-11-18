/**
 * pal on any page with one tag (docs/embed.md):
 *
 *   <script type="module" src="https://pal.lan/__pal/embed.js"></script>
 *
 * It asks pal whether this site may show it (`/__pal/embed.json`; a site
 * not yet allowed is offered in pal's Settings), then puts `<pal-bar>`
 * across the top and `<pal-panel>` in an overlay, owns the keys that open
 * them, follows the page's light or dark, and gives the page `window.pal`.
 * Anything that fails leaves the page as it was. The tag's `data-*`:
 * `token` (this site's token, off your tailnet), `bar` (`none`, or a CSS
 * selector to put the strip in instead of fixing it to the top), `keys`
 * (`panel:shift+p bar:shift+b`, `none`), `theme` (`light`, `dark`, `pal`).
 */
import { PalBar, PalPanel, type PalEvent } from "./index.js";
import { matches, parseKeys } from "./keys.js";

export type PalApi = {
  /** Settles once pal is up on the page (`true`), or will not be (`false`: unreachable, not allowed, not signed in). */
  ready: Promise<boolean>;
  /** The panel opened, or closed when open. */
  toggle(): void;
  /** The panel opened, in `palette` (`ext/palette`) when given. */
  open(palette?: string): void;
  close(): void;
  /** The bar shown or hidden on this device (flipped without `on`), remembered for this site. */
  bar(on?: boolean): void;
};

type Site = { allowed: boolean; signed: boolean; hide?: string[] };

/** Someone typing: the key belongs to the field. */
const typing = (e: Event) => {
  const t = e.composedPath()[0];
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
};

const store = {
  get<T>(key: string): T | null { try { const v = localStorage.getItem(key); return v === null ? null : (JSON.parse(v) as T); } catch { return null; } },
  set(key: string, v: unknown) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage off: this visit only */ } },
};

/** A colour's lightness 0–1 as painted, `null` when it paints nothing; a canvas reads any CSS colour (`oklch()`, `color-mix()`). */
function lightness(color: string): number | null {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!c) return null;
  c.canvas.width = c.canvas.height = 1;
  c.fillStyle = color;
  c.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = c.getImageData(0, 0, 1, 1).data;
  return a < 128 ? null : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The page's own background, the first of `<body>`'s and `<html>`'s that paints. */
function background(): string | null {
  for (const el of [document.body, document.documentElement]) {
    const bg = el && getComputedStyle(el).backgroundColor;
    if (bg && lightness(bg) !== null) return bg;
  }
  return null;
}

/** Light or dark as the page looks: its background, else its `color-scheme`, else the device's. */
export function pageScheme(): "light" | "dark" {
  const bg = background();
  if (bg) return lightness(bg)! < 0.5 ? "dark" : "light";
  const cs = getComputedStyle(document.documentElement).colorScheme.trim();
  if (cs === "dark" || cs === "light") return cs;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const OVERLAY_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
.scrim { position: fixed; inset: 0; z-index: 2147483600; background: rgb(0 0 0 / 0.3); animation: pal-fade 120ms ease-out; }
.dialog { position: fixed; z-index: 2147483601; top: max(10vh, 16px); left: 50%; translate: -50% 0; width: min(720px, calc(100vw - 32px)); height: min(480px, calc(100dvh - max(10vh, 16px) - 16px)); border-radius: 12px; overflow: hidden; box-shadow: 0 20px 60px rgb(0 0 0 / 0.35); animation: pal-drop 140ms ease-out; }
pal-panel { height: 100%; }
@keyframes pal-fade { from { opacity: 0; } }
@keyframes pal-drop { from { opacity: 0; transform: translateY(-6px) scale(0.98); } }
`;

const BAR_CSS = "position: fixed; top: 0; left: 0; right: 0; z-index: 2147483500;";

function start(script: HTMLScriptElement | undefined, server: string): PalApi {
  const data = script?.dataset ?? {};
  const noBar = data.bar === "none";
  const keys = { ...parseKeys(data.keys), ...(noBar ? { bar: null } : {}) };
  const asked = data.theme === "light" || data.theme === "dark" || data.theme === "pal" ? data.theme : null;
  const place = data.bar && data.bar !== "none" && data.bar !== "top" ? data.bar : null;
  const els: (PalBar | PalPanel)[] = [];
  let up = false, barOn = !noBar && store.get<boolean>("pal:bar") !== false;
  let bar: PalBar | null = null, panel: PalPanel | null = null, overlay: HTMLElement | null = null, before: Element | null = null;

  const make = <T extends PalBar | PalPanel>(tag: "pal-bar" | "pal-panel"): T => {
    const el = document.createElement(tag) as T;
    el.setAttribute("server", server);
    if (data.token) el.setAttribute("token", data.token);
    el.setAttribute("links", "host");
    const t = asked ?? pageScheme();
    if (t !== "pal") el.setAttribute("theme", t);
    els.push(el);
    return el;
  };

  const root = document.documentElement;
  const fit = new ResizeObserver(() => {
    const h = bar?.isConnected && !place ? bar.offsetHeight : 0;
    root.style.setProperty("--pal-bar-h", `${h}px`);
    root.classList.toggle("pal-bar", h > 0);
  });

  const showBar = (on: boolean) => {
    barOn = on;
    if (!up) return;
    if (!on) { bar?.remove(); fit.disconnect(); root.style.setProperty("--pal-bar-h", "0px"); root.classList.remove("pal-bar"); return; }
    bar ??= make<PalBar>("pal-bar");
    const into = place ? document.querySelector(place) : null;
    if (place && !into) return;
    if (!place) bar.style.cssText = BAR_CSS + (background() ? `background: ${background()};` : "");
    (into ?? document.body).append(bar);
    if (!place) fit.observe(bar);
  };

  const close = () => {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    panel?.reset();
    if (before instanceof HTMLElement && before.isConnected) before.focus();
  };

  const open = (palette?: string) => {
    if (!up) return;
    if (!overlay) {
      const host = document.createElement("div");
      host.setAttribute("data-pal", "");
      const shadow = host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = OVERLAY_CSS;
      const scrim = document.createElement("div");
      scrim.className = "scrim";
      scrim.addEventListener("pointerdown", close);
      const dialog = document.createElement("div");
      dialog.className = "dialog";
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", "pal");
      panel = make<PalPanel>("pal-panel");
      panel.addEventListener("pal-dismiss", close);
      dialog.append(panel);
      shadow.append(style, scrim, dialog);
      overlay = host;
      host.hidden = true;
      document.body.append(host);
    }
    if (overlay.hidden) { before = document.activeElement; overlay.hidden = false; }
    if (palette) panel!.open(palette);
    panel!.focus();
  };

  const api: PalApi = {
    ready: Promise.resolve(false),
    toggle: () => (overlay && !overlay.hidden ? close() : open()),
    open,
    close,
    bar: (on) => { if (noBar) return; const next = on ?? !barOn; store.set("pal:bar", next ? null : false); showBar(next); },
  };

  api.ready = (async () => {
    const url = new URL("/__pal/embed.json", server);
    if (data.token) url.searchParams.set("token", data.token);
    let site: Site;
    try {
      const r = await fetch(url, { credentials: "omit", cache: "no-store" });
      if (!r.ok) return false;
      site = await r.json();
    } catch { return false; }
    if (!site.allowed || !site.signed) return false;
    if (document.readyState === "loading") await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
    up = true;

    const hidden = store.get<string[]>("pal:bar-hide") ?? site.hide ?? [];
    bar = make<PalBar>("pal-bar");
    if (hidden.length) bar.setAttribute("hide", hidden.join(","));
    bar.addEventListener("pal-bar-hide", (e) => store.set("pal:bar-hide", e.detail.keys));
    showBar(barOn);

    window.addEventListener("pal-open", (e) => { if (!e.defaultPrevented) window.open((e as PalEvent<"open">).detail.url, "_blank", "noopener"); });
    window.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === "Escape" && overlay && !overlay.hidden) { e.preventDefault(); return close(); }
      if (typing(e)) return;
      if (keys.panel && matches(keys.panel, e)) { e.preventDefault(); api.toggle(); }
      else if (keys.bar && matches(keys.bar, e)) { e.preventDefault(); api.bar(); }
    });

    if (!asked) {
      let frame = 0;
      const follow = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const t = pageScheme(), bg = background();
          for (const el of els) if (el.getAttribute("theme") !== t) el.setAttribute("theme", t);
          if (bar && !place) bar.style.background = bg ?? "";
        });
      };
      const mo = new MutationObserver(follow);
      for (const el of [document.documentElement, document.body]) mo.observe(el, { attributes: true });
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", follow);
    }
    return true;
  })().catch(() => false);
  return api;
}

declare global {
  interface Window { pal?: PalApi }
}

if (typeof document !== "undefined" && !window.pal) {
  const script = [...document.querySelectorAll<HTMLScriptElement>("script[src]")].find((s) => s.src === import.meta.url);
  window.pal = start(script, new URL(import.meta.url).origin);
}
