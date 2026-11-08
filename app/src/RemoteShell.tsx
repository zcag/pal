import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App, { type AppRemote, type EmbedHandle } from "./App";
import { embedOf, emitHost, passOn, picked, toHost } from "./embed";
import { useEmbedShell } from "./embed-shell";
import HudPage from "./HudPage";
import LargePage from "./LargePage";
import { NARROW, raise } from "./remote";
import { historyLayers } from "./remote-history";
import { isSheetMessage, sheetSrc } from "./sheet";
import { schemeInForce } from "./theme";
import { Presence } from "./ui";
import { MenubarItem, defaultLook, shapeItem, type BarLook, type BarStripItem } from "./ui/BarStrip";
import { touchFirst } from "./ui/touch";
import { POPOVER_W } from "./ui/popover-size";

/** `bar_web_items` and `pal://bar/strip`: the bar's items as the web target draws them, in order. */
export type WebStrip = { items: { key: string; item: BarStripItem; look?: Partial<BarLook> }[] };

/** The scheme the tokens are drawn in, followed as the theme pin or the OS flips. */
function useScheme(): "light" | "dark" {
  const [scheme, setScheme] = useState(() => schemeInForce());
  useEffect(() => {
    const read = () => setScheme(schemeInForce());
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => { mo.disconnect(); mq.removeEventListener("change", read); };
  }, []);
  return scheme;
}

/** The strip's items: asked once, then every `pal://bar/strip`; none while the command is not there, or the page draws no strip. */
function useStrip(on: boolean): WebStrip["items"] {
  const [items, setItems] = useState<WebStrip["items"]>([]);
  useEffect(() => {
    if (!on) return;
    invoke<WebStrip>("bar_web_items").then((s) => setItems(s?.items ?? []), () => setItems([]));
    const un = listen<WebStrip>("pal://bar/strip", (e) => setItems(e.payload?.items ?? []));
    return () => { un.then((f) => f()); };
  }, [on]);
  return items;
}

/**
 * How much a sheet's frame is drawn down: a popover is laid out for its
 * 420 px (views measure against `POPOVER_W`), so a card narrower than that
 * (a phone) draws the popover at its own width, scaled to fit.
 */
function useSheetScale() {
  const [room, setRoom] = useState(POPOVER_W);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    ro.current = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.current.observe(el);
  }, []);
  return { ref, scale: Math.min(1, room / POPOVER_W) };
}

/** Whether `query` matches, followed as it changes. */
function useMedia(query: string) {
  const [on, setOn] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const read = () => setOn(mq.matches);
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, [query]);
  return on;
}

/** The page's height as the keyboard leaves it: iOS keeps the layout viewport and shrinks only the visual one. */
function useViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const set = () => document.documentElement.style.setProperty("--pal-remote-vh", `${vv.height}px`);
    set();
    vv.addEventListener("resize", set);
    return () => vv.removeEventListener("resize", set);
  }, []);
}

const SLIDERS = <svg viewBox="0 0 18 18" aria-hidden><path d="M3 5h12M3 9h12M3 13h12" /><circle cx="6.5" cy="5" r="1.6" /><circle cx="11.5" cy="9" r="1.6" /><circle cx="7.5" cy="13" r="1.6" /></svg>;

/**
 * A remote page's home (docs/design/remote.md, "The page on a phone"): the
 * bar's items as a strip along the top, the panel under it, always up and
 * never hidden, and the HUD and Large Type over it. A bar item opens as a
 * sheet (sheet.ts). Every layer (a level, the actions, a sheet) is a history
 * entry, so the browser's back pops one.
 *
 * Framed by another site (`?embed=`, embed.ts) it is the panel alone or the
 * strip alone, with no Settings and no history of its own, and tells its
 * host what happens (embed-shell.ts).
 */
const embed = embedOf(location.search);
const strip = embed?.kind !== "panel", panel = embed?.kind !== "bar";

export default function RemoteShell() {
  const scheme = useScheme();
  const items = useStrip(strip);
  useViewportHeight();
  const touch = useMemo(touchFirst, []);
  const narrow = useMedia(NARROW);
  const app = useRef<EmbedHandle>(null);
  const [sheet, setSheet] = useState<{ key: string; x: number; title: string; line?: number } | null>(null);
  const [frameHeight, setHeight] = useState<number | null>(null);
  const fit = useSheetScale();
  const height = frameHeight === null ? null : frameHeight * fit.scale;
  const [panelLayers, setPanelLayers] = useState(0);
  const sheetUp = useRef(false);
  sheetUp.current = !!sheet;

  const close = useCallback(() => setSheet(null), []);
  /** A glance card: its item's sheet (or the sheet of one of its lines), placed under the item on the strip when it is there. */
  const glance = useCallback((key: string, line?: number) => {
    const item = document.querySelector<HTMLElement>(`.pal-remote__item[data-key="${CSS.escape(key)}"]`), r = item?.getBoundingClientRect();
    setSheet({ key, line, x: r ? r.left + r.width / 2 : window.innerWidth / 2, title: item?.getAttribute("aria-label") ?? key });
  }, []);
  const history = useMemo(() => embed ? { sync() {}, popped: () => false } : historyLayers({ push: () => window.history.pushState({ pal: true }, ""), go: (n) => window.history.go(n) }), []);
  useEffect(() => { history.sync(panelLayers + (sheet ? 1 : 0)); }, [history, panelLayers, sheet]);
  useEffect(() => {
    const pop = () => { if (!history.popped()) return; if (sheetUp.current) close(); else app.current?.back(); };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [history, close]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || !isSheetMessage(e.data)) return;
      const m = e.data;
      if ("size" in m) setHeight(m.size);
      else if ("hide" in m) close();
      else if ("embed" in m) { if (embed) toHost(m.embed); }
      else raise(m.event, m.payload);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [close]);
  useEffect(() => { if (!sheet) setHeight(null); }, [sheet]);
  const scaled = fit.scale < 1 ? { width: POPOVER_W, height: `${100 / fit.scale}%`, transform: `scale(${fit.scale})`, transformOrigin: "0 0" } : undefined;
  useEffect(() => {
    if (!sheet) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [sheet, close]);

  useEmbedShell(embed, { app, sheet, height, close, scheme });
  const remote = useMemo<AppRemote>(() => ({ touch, narrow, onGlance: glance, onLayers: setPanelLayers, handle: app, home: embed?.palette, onPick: embed ? (item, action) => emitHost("pick", picked(item, action)) : undefined }), [touch, narrow, glance]);
  const shaped = items.map((it) => { const look = { ...defaultLook, ...it.look }; return { key: it.key, look, item: shapeItem(it.item, look) }; }).filter((it) => !it.item.hidden);

  return (
    <div className="pal-remote" data-sheet={sheet ? "" : undefined}>
      {strip && <header className="pal-remote__top">
        <div className="g-bar pal-remote__strip" data-theme={scheme} role="toolbar" aria-label="Bar items">
          <div className="g-mb pal-remote__items">
            {shaped.map(({ key, look, item }) => (
              <button
                key={key}
                type="button"
                className="pal-remote__item"
                data-key={key}
                data-open={sheet?.key === key || undefined}
                aria-label={item.title || item.tooltip || key}
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setSheet(sheet?.key === key ? null : { key, x: r.left + r.width / 2, title: item.title || item.tooltip || key }); }}
              >
                <MenubarItem item={item} look={look} dark={scheme === "dark"} />
              </button>
            ))}
          </div>
        </div>
        <span className="pal-remote__link" aria-hidden title="Reconnecting to pal" />
        {!embed && <a className="pal-remote__settings" href="?settings" aria-label="Settings" title="Settings">{SLIDERS}</a>}
      </header>}
      {panel && <main className="pal-remote__main">
        <App remote={remote} />
      </main>}
      <Presence show={!!sheet} dur="base">
        {sheet && (
          <div className="pal-remote-sheet" style={{ "--pal-sheet-x": `${sheet.x}px` } as CSSProperties}>
            <div className="pal-remote-sheet__scrim" onClick={close} aria-hidden />
            <div ref={fit.ref} className="pal-remote-sheet__card" role="dialog" aria-label={sheet.title} data-sized={height !== null || undefined} style={height !== null ? ({ "--pal-sheet-h": `${height}px` } as CSSProperties) : undefined}>
              <iframe key={`${sheet.key}:${sheet.line}`} className="pal-remote-sheet__frame" src={sheetSrc(sheet.key, sheet.line) + (embed ? passOn(location.search) : "")} title={sheet.title} allow="clipboard-write" style={scaled} />
            </div>
          </div>
        )}
      </Presence>
      {panel && <HudPage />}
      {panel && <LargePage />}
    </div>
  );
}
