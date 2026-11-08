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

/** `<pal-bar>`'s strip, where a sheet's card starts, the room under it for its shadow (embed.css), and its height before it says. */
const STRIP_H = 36, SHEET_TOP = 40, SHEET_ROOM = 16, SHEET_H = 240;

type Shell = { app: RefObject<EmbedHandle | null>; sheet: { key: string; title: string } | null; height: number | null; close: () => void; scheme: "light" | "dark" };

export function useEmbedShell(embed: Embed | null, { app, sheet, height, close, scheme }: Shell) {
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
      else app.current?.[m.call]();
    });
    return () => { off(); for (const un of uns) un.then((f) => f()); };
  }, [on, app, close]);

  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (embed?.kind !== "bar") return;
    toHost({ pal: "embed", size: sheet ? SHEET_TOP + (height ?? SHEET_H) + SHEET_ROOM : STRIP_H });
    if (sheet && opened.current !== sheet.key) emitHost("bar-open", { key: sheet.key, title: sheet.title });
    else if (!sheet && opened.current) emitHost("bar-close", {});
    opened.current = sheet?.key ?? null;
  }, [embed, sheet, height]);

}
