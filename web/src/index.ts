/**
 * pal inside another web app (docs/embed.md): `<pal-panel>` and `<pal-bar>`
 * frame the pages a pal server serves (`?embed=panel`, `?embed=bar`), size
 * the frame as the page asks, and turn what the page says into DOM events
 * (`pal-pick`, `pal-hud`, `pal-copy`, `pal-open`, `pal-bar-open`, …, each a
 * cancelable `CustomEvent` with the detail in `EmbedEvents`). `embed.ts` is
 * the one-tag layer over them.
 */
import { PARAMS, isFromPal, type EmbedEvents, type FontFace, type ToPal } from "./protocol.js";

export type { EmbedEvents, FontFace } from "./protocol.js";
export type PalEvent<K extends keyof EmbedEvents> = CustomEvent<EmbedEvents[K]>;

const STYLE = `
:host { display: block; position: relative; }
:host([hidden]) { display: none; }
iframe { display: block; width: 100%; height: 100%; border: 0; background: transparent; }
`;

/** How often, and for how long, the host says hello until the page answers (its listener may not be up at the frame's `load`). */
const HELLO_EVERY = 250, HELLO_FOR = 15_000;

abstract class PalFrame extends HTMLElement {
  static observedAttributes = ["server", ...PARAMS];
  /** The element's own defaults, which the host page's styles override. */
  static css = "";
  protected abstract readonly kind: "panel" | "bar";
  protected readonly frame = document.createElement("iframe");
  #ready = false;
  #queue: ToPal[] = [];
  #tokens: { tokens: Record<string, string>; fonts?: FontFace[] } = { tokens: {} };
  #hello = 0;

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE + (this.constructor as typeof PalFrame).css;
    this.frame.allow = "clipboard-write";
    this.frame.title = "pal";
    this.frame.addEventListener("load", () => this.#greet());
    root.append(style);
  }

  /** The pal server's origin, from `server`. */
  get origin(): string | null {
    try { return new URL(this.getAttribute("server") ?? "").origin; } catch { return null; }
  }

  connectedCallback() {
    window.addEventListener("message", this.#onMessage);
    this.#load();
  }

  disconnectedCallback() {
    window.removeEventListener("message", this.#onMessage);
    clearInterval(this.#hello);
  }

  attributeChangedCallback(name: string, before: string | null, after: string | null) {
    if (before === after || !this.isConnected) return;
    if (name === "hide") this.#send({ pal: "embed", call: "hide", keys: (after ?? "").split(",").map((k) => k.trim()).filter(Boolean) });
    else if (name === "theme") this.#send({ pal: "embed", call: "theme", theme: after === "light" || after === "dark" ? after : null });
    else this.#load();
  }

  /** The frame focused, and the search field in it. */
  focus() { this.frame.focus(); this.#send({ pal: "embed", call: "focus" }); }
  /** Back to the start: the root, or the element's `palette`. */
  reset() { this.#send({ pal: "embed", call: "reset" }); }
  /** Theme tokens over pal's own in this frame (`{ "--pal-accent": "#0a7" }`, docs/embed.md "Match your site"), and the page's faces of the fonts they name; kept across reloads; `{}` clears them. */
  tokens(tokens: Record<string, string>, fonts?: FontFace[]) {
    this.#tokens = { tokens, fonts };
    if (this.#ready) this.#send({ pal: "embed", call: "tokens", ...this.#tokens });
  }

  protected send(msg: ToPal) { this.#send(msg); }
  /** The page's own height for its content (`<pal-bar>` with a sheet open). */
  protected resized(height: number, _strip?: number) { this.frame.style.height = `${height}px`; }

  #load() {
    const origin = this.origin;
    if (!origin) return;
    const url = new URL("/", origin);
    url.searchParams.set("embed", this.kind);
    for (const p of PARAMS) {
      const v = this.getAttribute(p);
      if (v !== null) url.searchParams.set(p, v || "1");
    }
    if (this.frame.src === url.href) return;
    this.#ready = false;
    this.frame.src = url.href;
    if (!this.frame.isConnected) this.shadowRoot!.append(this.frame);
  }

  #greet() {
    clearInterval(this.#hello);
    const started = Date.now();
    const hello = () => {
      if (this.#ready || Date.now() - started > HELLO_FOR) return clearInterval(this.#hello);
      if (this.origin) this.frame.contentWindow?.postMessage({ pal: "embed", hello: true } satisfies ToPal, this.origin);
    };
    hello();
    this.#hello = window.setInterval(hello, HELLO_EVERY);
  }

  #send(msg: ToPal) {
    if (this.#ready && this.origin) this.frame.contentWindow?.postMessage(msg, this.origin);
    else this.#queue.push(msg);
  }

  #onMessage = (e: MessageEvent) => {
    if (e.source !== this.frame.contentWindow || e.origin !== this.origin || !isFromPal(e.data)) return;
    const m = e.data;
    if ("ready" in m) {
      this.#ready = true;
      clearInterval(this.#hello);
      if (Object.keys(this.#tokens.tokens).length) this.#send({ pal: "embed", call: "tokens", ...this.#tokens });
      for (const q of this.#queue.splice(0)) this.#send(q);
    } else if ("size" in m) this.resized(m.size, m.strip);
    else if ("scheme" in m) this.frame.style.colorScheme = m.scheme;
    else if ("warnings" in m) for (const w of m.warnings) console.warn(`pal: ${w}`);
    else this.dispatchEvent(new CustomEvent(`pal-${m.event}`, { detail: m.detail, bubbles: true, composed: true, cancelable: true }));
  };
}

/**
 * pal's panel: search, palettes, live views, forms. A pick leaves it at
 * its start, as a pick hides the panel in the app. Attributes: `server`
 * (the pal server's address), `token` (this site's token from Settings,
 * for a device outside your tailnet), `palette` (`ext/palette` to start in),
 * `theme` (`light`, `dark`), `links="host"` (URL opens are only told, for
 * the host to make), `transparent`. Its height is the host's (440px unless
 * styled).
 */
export class PalPanel extends PalFrame {
  protected readonly kind = "panel";
  static css = ":host { height: 440px; }";

  /** Straight into a palette (`ext/palette`). */
  open(palette: string) { this.send({ pal: "embed", call: "open", palette }); }
  /** The search field set to `text`. */
  query(text: string) { this.send({ pal: "embed", call: "query", text }); }
}

/**
 * The bar's items as a strip, each on the side its `position` says; a tap
 * opens the item's popover under it, drawn over the page below the element
 * (the frame grows downward, the element keeps the strip's height, which
 * the page tells). Same attributes as `<pal-panel>` but `palette`, plus
 * `hide` (item keys, comma-separated, that leave the strip; changed live).
 * `pal-bar-items` lists every item; the strip's own picker (a right-click
 * or a long press) sets `hide` and tells `pal-bar-hide`, for the host to keep.
 */
export class PalBar extends PalFrame {
  protected readonly kind = "bar";
  static css = ":host { height: 26px; } iframe { position: absolute; inset: 0 0 auto; height: 100%; z-index: 2147483000; }";

  #open = false;

  constructor() {
    super();
    this.addEventListener("pal-bar-hide", (e) => { e.detail.keys.length ? this.setAttribute("hide", e.detail.keys.join(",")) : this.removeAttribute("hide"); });
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("pointerdown", this.#outside);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.#outside);
  }

  /** The open popover closed. */
  close() { this.send({ pal: "embed", call: "close" }); }

  /** Taller than the strip: a popover or the picker is open, and a click outside closes it. */
  protected resized(height: number, strip?: number) {
    super.resized(height);
    if (strip) this.style.height = `${strip}px`;
    this.#open = !!strip && height > strip;
  }

  #outside = (e: PointerEvent) => { if (this.#open && !e.composedPath().includes(this)) this.close(); };
}

export function define() {
  if (!customElements.get("pal-panel")) customElements.define("pal-panel", PalPanel);
  if (!customElements.get("pal-bar")) customElements.define("pal-bar", PalBar);
}

define();

declare global {
  interface HTMLElementTagNameMap { "pal-panel": PalPanel; "pal-bar": PalBar }
  interface HTMLElementEventMap {
    "pal-pick": PalEvent<"pick">;
    "pal-hud": PalEvent<"hud">;
    "pal-copy": PalEvent<"copy">;
    "pal-open": PalEvent<"open">;
    "pal-bar-open": PalEvent<"bar-open">;
    "pal-bar-close": PalEvent<"bar-close">;
    "pal-bar-items": PalEvent<"bar-items">;
    "pal-bar-hide": PalEvent<"bar-hide">;
    "pal-dismiss": PalEvent<"dismiss">;
  }
}
