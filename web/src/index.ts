/**
 * pal inside another web app (docs/embed.md): `<pal-panel>` and `<pal-bar>`
 * frame the pages a pal server serves (`?embed=panel`, `?embed=bar`), size
 * the frame as the page asks, and turn what the page says into DOM events
 * (`pal-pick`, `pal-hud`, `pal-copy`, `pal-open`, `pal-bar-open`,
 * `pal-bar-close`, each a `CustomEvent` with the detail in `EmbedEvents`).
 */
import { PARAMS, isFromPal, type EmbedEvents, type ToPal } from "./protocol.js";

export type { EmbedEvents } from "./protocol.js";
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

  attributeChangedCallback(_: string, before: string | null, after: string | null) {
    if (before !== after && this.isConnected) this.#load();
  }

  /** The search field focused. */
  focus() { this.#send({ pal: "embed", call: "focus" }); }
  /** Back to the start: the root, or the element's `palette`. */
  reset() { this.#send({ pal: "embed", call: "reset" }); }

  protected send(msg: ToPal) { this.#send(msg); }
  /** The page's own height for its content (`<pal-bar>` with a sheet open). */
  protected resized(height: number) { this.frame.style.height = `${height}px`; }

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
      for (const q of this.#queue.splice(0)) this.#send(q);
    } else if ("size" in m) this.resized(m.size);
    else if ("scheme" in m) this.frame.style.colorScheme = m.scheme;
    else this.dispatchEvent(new CustomEvent(`pal-${m.event}`, { detail: m.detail, bubbles: true, composed: true }));
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
 * The bar's items as a strip; a tap opens the item's popover under it,
 * drawn over the page below the element (the frame grows downward, the
 * element keeps its height). Same attributes as `<pal-panel>` but `palette`.
 */
export class PalBar extends PalFrame {
  protected readonly kind = "bar";
  static css = ":host { height: 36px; } iframe { position: absolute; inset: 0 0 auto; height: 36px; z-index: 2147483000; }";

  #open = false;

  constructor() {
    super();
    this.addEventListener("pal-bar-open", () => { this.#open = true; });
    this.addEventListener("pal-bar-close", () => { this.#open = false; });
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
  }
}
