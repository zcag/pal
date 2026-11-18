/**
 * What RemoteShell does inside another site's page (docs/embed.md): the
 * host's calls run on the panel, `<pal-bar>`'s height (the strip, and an
 * open sheet under it) goes to the host, and so do HUD lines, copies, URL
 * opens and the sheet opening and closing.
 */
import { useEffect, useRef, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import type { EmbedHandle } from "./App";
import { emitHost, handOver, onHost, toHost, type Embed } from "./embed";
import type { FontFace } from "../../web/src/protocol";
import { invoke } from "@tauri-apps/api/core";
import { askTheme, applyHostTokens } from "./theme";

/** The host's faces of the fonts its tokens name, loaded once each; only `url()`s over http(s), so a face cannot reach anything else. */
const loaded = new Set<string>();
function loadFaces(faces: FontFace[]) {
  for (const f of faces) {
    const id = JSON.stringify(f);
    if (loaded.has(id) || /["'\\]/.test(f.family) || [...f.src.matchAll(/url\(([^)]*)\)/g)].some(([, u]) => !/^"?https?:\/\//.test(u))) continue;
    loaded.add(id);
    new window.FontFace(f.family, f.src, { weight: f.weight, style: f.style }).load().then((face) => document.fonts.add(face), () => {});
  }
}

/** `<pal-bar>`'s strip (embed.css), where a sheet's card starts, the room under it for its shadow, and its height before it says. */
const STRIP_H = 26, SHEET_TOP = 30, SHEET_ROOM = 16, SHEET_H = 240;

/** `sheet`: the item whose popover is open; `dropped`: the height of the card open under the strip (a popover's, `null` while it has not said, or the item picker's). */
type Shell = { app: RefObject<EmbedHandle | null>; sheet: { key: string; title: string } | null; height: number | null; picker: number | null; close: () => void; scheme: "light" | "dark"; onHide: (keys: string[]) => void; all: { key: string; title: string }[] };

export function useEmbedShell(embed: Embed | null, { app, sheet, height, picker, close, scheme, onHide, all }: Shell) {
  const on = !!embed;
  useEffect(() => { if (on) toHost({ pal: "embed", scheme }); }, [on, scheme]);
  useEffect(() => {
    if (!on) return;
    handOver(toHost, location.search);
    const fwd = (event: string, large: boolean) => listen<{ text?: string }>(event, (e) => { if (e.payload?.text) emitHost("hud", large ? { text: e.payload.text, large } : { text: e.payload.text }); });
    const uns = [fwd("pal://hud", false), fwd("pal://large", true)];
    const off = onHost((m) => {
      if (m.call === "open") app.current?.open(m.palette);
      else if (m.call === "query") app.current?.type(m.text);
      else if (m.call === "close") close();
      else if (m.call === "hide") onHide(m.keys);
      else if (m.call === "theme") askTheme(m.theme);
      else if (m.call === "tokens") { loadFaces(m.fonts ?? []); invoke<{ vars: Record<string, string>; warnings: string[] }>("theme_check", { tokens: m.tokens }).then((c) => { applyHostTokens(c.vars); if (c.warnings.length) toHost({ pal: "embed", warnings: c.warnings }); }, () => {}); }
      else app.current?.[m.call]();
    });
    return () => { off(); for (const un of uns) un.then((f) => f()); };
  }, [on, app, close, onHide]);

  const told = useRef("");
  useEffect(() => {
    if (embed?.kind !== "bar" || !all.length) return;
    const now = JSON.stringify(all);
    if (now !== told.current) emitHost("bar-items", all);
    told.current = now;
  }, [embed, all]);

  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (embed?.kind !== "bar") return;
    const card = sheet ? (height ?? SHEET_H) : picker;
    toHost({ pal: "embed", size: card !== null ? SHEET_TOP + card + SHEET_ROOM : STRIP_H, strip: STRIP_H });
    if (sheet && opened.current !== sheet.key) emitHost("bar-open", { key: sheet.key, title: sheet.title });
    else if (!sheet && opened.current) emitHost("bar-close", {});
    opened.current = sheet?.key ?? null;
  }, [embed, sheet, height, picker]);

}
