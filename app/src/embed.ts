/**
 * A remote page framed by another site (docs/embed.md): `?embed=panel` or
 * `?embed=bar`, with what the host element's attributes say. The host
 * speaks first (`hello`); its origin is the only one this page posts to,
 * and the browser has already held it to `[remote] embed_origins`
 * (`frame-ancestors`, remote.rs), so the page never posts to `*`.
 */
import { isToPal, type EmbedEvents, type FromPal, type ToPal } from "../../web/src/protocol";
import { device } from "./remote";
import type { Item } from "./ui/types";

export type Embed = { kind: "panel" | "bar"; palette?: string };

/** The embed this page is, from its query; `null` when it is not one. */
export function embedOf(search: string): Embed | null {
  const p = new URLSearchParams(search);
  const kind = p.get("embed");
  if (kind !== "panel" && kind !== "bar") return null;
  const palette = p.get("palette")?.trim();
  return { kind, palette: palette && palette.includes("/") ? palette : undefined };
}

/** A theme the page was asked for (`?theme=`), over the configured one. */
export function themeOf(search: string): "light" | "dark" | null {
  const t = new URLSearchParams(search).get("theme");
  return t === "light" || t === "dark" ? t : null;
}

/** What a frame inside this page carries on of its own query: the token (no cookie may reach it) and the look. */
export function passOn(search: string): string {
  const p = new URLSearchParams(search), out = new URLSearchParams();
  for (const k of ["token", "theme", "links", "transparent"]) { const v = p.get(k); if (v !== null) out.set(k, v); }
  const s = out.toString();
  return s && `&${s}`;
}

/** What the host hears of a pick: the row's own words, never its data. */
export const picked = (item: Item, action?: string): EmbedEvents["pick"] => ({ id: item.id, name: item.name, subtitle: item.subtitle, palette: item.source ? `${item.source.extension}/${item.source.palette}` : item.palette, action });

let host: string | null = null;
const waiting: FromPal[] = [];
const handlers = new Set<(m: Exclude<ToPal, { hello: true }>) => void>();

const post = (m: FromPal) => window.parent.postMessage(m, host!);

/** The host's messages heard: the first `hello` from the parent names its origin; anything else from elsewhere is dropped. */
export function listenHost() {
  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || window.parent === window || !isToPal(e.data)) return;
    if ("hello" in e.data) {
      if (host !== null && host !== e.origin) return;
      host = e.origin;
      post({ pal: "embed", ready: true });
      for (const m of waiting.splice(0)) post(m);
      return;
    }
    if (e.origin !== host) return;
    for (const h of handlers) h(e.data);
  });
}

export const onHost = (h: (m: Exclude<ToPal, { hello: true }>) => void) => { handlers.add(h); return () => { handlers.delete(h); }; };

/** A message to the host, held until it has said hello. */
export const toHost = (m: FromPal) => (host === null ? waiting.push(m) : post(m));

const told = <K extends keyof EmbedEvents>(event: K, detail: EmbedEvents[K]) => ({ pal: "embed", event, detail }) as FromPal;

export const emitHost = <K extends keyof EmbedEvents>(event: K, detail: EmbedEvents[K]) => toHost(told(event, detail));

/** The page's copies and URL opens (remote.ts `device`) told through `tell`; with `links=host` a URL is the host's to open. */
export function handOver(tell: (m: FromPal) => void, search: string) {
  const hostOpens = new URLSearchParams(search).get("links") === "host";
  device.copied = (text) => tell(told("copy", { text }));
  device.open = (url) => { tell(told("open", { url })); return hostOpens; };
}

/** A pick told through `tell` (a bar item's sheet, to the embed around it). */
export const tellPick = (tell: (m: FromPal) => void, item: Item, action?: string) => tell(told("pick", picked(item, action)));
