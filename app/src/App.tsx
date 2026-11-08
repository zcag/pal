import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Launcher, pickLevel, type LauncherHandle, type LauncherProps, type PanelMode, type PickRow } from "./Launcher";
import { installMissing, missingInfo, opened } from "./store";
import { iconOf } from "./items";
import { mark, surface, useCore, usePrefs, useLiveViews } from "./core";
import { Confirm, Presence, type ToastSpec } from "./ui";
import { SHOWN_EVENT } from "./ui/virtual";
import type { Effect } from "./items";
import type { Item } from "./ui/types";
/** The window to a design's fitted panel height (compact.rs `panel_fit`), or the full height back (`null`). */
const panelFit = (height: number | null) => { invoke("panel_fit", { height }).catch(() => {}); };
/** A glance card's open: the panel steps aside and the bar item is clicked, or with `line` that line's action runs (glance.rs). */
const glanceOpen = (key: string, line?: number) => { invoke("glance_open", { key, line: line ?? null }).catch(() => {}); };
type Glance = NonNullable<LauncherProps["glance"]>;

/** A confirm card the core asks for (`pal://confirm`, deeplink.rs); `null` drops the one up. */
type Ask = { title: string; message?: string; ok: string; cancel: string; token: number };

export type EmbedHandle = Pick<LauncherHandle, "back" | "open" | "type" | "focus" | "reset">;

/** The panel as a remote page's home (RemoteShell): never hidden, so a pick that would hide it goes back to the root instead. */
export type AppRemote = {
  /** A touch screen: rows carry their actions button and take a long press (Launcher `touch`). */
  touch: boolean;
  /** The layers over the root, for the page's history (Launcher `onLayers`). */
  onLayers: (layers: number) => void;
  /** The browser's back (one layer off the top), and what a host page asks of an embed (embed.ts). */
  handle: Ref<EmbedHandle>;
  /** The palette the panel starts in and goes back to, for an embed that asked for one. */
  home?: string;
  /** Every pick, as it is made: an embed tells its host. */
  onPick?: (item: Item, action?: string) => void;
};

export default function App({ remote }: { remote?: AppRemote }) {
  const launcher = useRef<LauncherHandle>(null);
  const home = !!remote;
  const start = remote?.home;
  const reset = useCallback(() => { launcher.current?.reset(); if (start) launcher.current?.open(start); }, [start]);
  const hide = useCallback(() => { if (home) reset(); else invoke("hide"); }, [home, reset]);
  useImperativeHandle(remote?.handle, () => ({ back: () => launcher.current?.back(), open: (p) => launcher.current?.open(p), type: (q) => launcher.current?.type(q), focus: () => launcher.current?.focus(), reset }), [reset]);
  const { sources, version, bump, showing, search, inline, fallback, lateFallback, suggest, history, dialog, forget, detail, view, pick: corePick, refresh } = useCore(hide);
  const told = remote?.onPick;
  const pick = useCallback<LauncherProps["onPick"]>((item, query, action, ctx) => { told?.(item, action); return corePick(item, query, action, ctx); }, [corePick, told]);
  const prefs = usePrefs();
  // The glance strip's cards (glance.rs): read on every show and every few seconds, the bar items' last renders, so the strip says what the bar says.
  const [glance, setGlance] = useState<Glance>([]);
  useEffect(() => {
    const read = () => { invoke<Glance>("glance_items").then(setGlance).catch(() => {}); };
    read();
    const t = setInterval(read, 10_000);
    window.addEventListener(SHOWN_EVENT, read);
    return () => { clearInterval(t); window.removeEventListener(SHOWN_EVENT, read); };
  }, []);


  // A remote home has no hotkey to show it: the index first listing, and the tab coming back into view, are its shows (the Now rows and the glance asked again).
  const listed = sources.length > 0;
  useEffect(() => { if (listed && start) launcher.current?.open(start); }, [listed, start]);
  useEffect(() => {
    if (!home || !listed) return;
    const show = () => { if (document.visibilityState !== "visible") return; launcher.current?.shown(); window.dispatchEvent(new Event(SHOWN_EVENT)); };
    show();
    document.addEventListener("visibilitychange", show);
    return () => document.removeEventListener("visibilitychange", show);
  }, [home, listed]);

  // A trigger (`pal://trigger`: a copy recorded, the network back) lists the palette showing again when it asks for that one under `on` (a view's are re-asked in the Launcher).
  useEffect(() => {
    const un = listen<{ name: string }>("pal://trigger", (e) => { const s = showing.current; if (s && s.view !== "view" && s.on?.includes(e.payload.name)) bump(); });
    return () => {
      un.then((f) => f());
    };
  }, [bump, showing]);

  // hotkey -> painted panel; a palette hotkey names where to open, the switcher's chord adds `hold` and the presses it took before the show as `steps` (switcher.rs); `keep` (general.pop_to_root, pop.rs) leaves the level and query as they were
  useEffect(() => {
    const un = listen<{ t0: number; palette?: string; keep?: boolean; hold?: boolean; steps?: number }>("pal://shown", (e) => {
      if (e.payload.palette) launcher.current?.open(e.payload.palette, { hold: !!e.payload.hold, steps: e.payload.steps });
      else if (e.payload.keep) launcher.current?.shown();
      else launcher.current?.reset();
      window.dispatchEvent(new Event(SHOWN_EVENT));
      requestAnimationFrame(() => mark("hotkey->paint ms", Date.now() - e.payload.t0));
    });
    // The switcher while it holds a palette: a press steps the cursor, the modifier let go (or `pal switch commit`) runs the row under it.
    const unSwitch = listen<{ step?: number; commit?: boolean }>("pal://switch", (e) => launcher.current?.switch(e.payload));
    return () => {
      un.then((f) => f());
      unSwitch.then((f) => f());
    };
  }, []);

  // A `pal://` link (deeplink.rs): the query to type and the filter to pick (after the palette `pal://shown` opened), at the root when asked;
  // a pick's answer to apply with the item it came from (`deliver`); a toast while the panel is up.
  useEffect(() => {
    // `missing`: a link to a palette of an extension that is not loaded (the core's `Missing`, deeplink.rs `known_palette`); the panel opens on its card, Install or Turn on, then that palette.
    type Missing = { name: string; palette?: string | null; state: "not_installed" | "disabled"; registry?: string | null; title: string; tagline: string; icon: unknown };
    type Delivered = { query?: string | null; filter?: string | null; reset?: boolean; effect?: Effect; item?: Item & { args?: unknown }; toast?: { title: string; message?: string | null }; missing?: Missing };
    const un = listen<Delivered>("pal://deeplink", (e) => {
      const p = e.payload;
      if (p.missing) {
        const m = p.missing;
        // A palette key is `ext/palette`; the payload may name the palette alone.
        const palette = m.palette ? (m.palette.includes("/") ? m.palette : `${m.name}/${m.palette}`) : undefined;
        launcher.current?.missing(m.name, palette, { title: m.title || m.name, icon: iconOf(m.icon, m.title || m.name), tagline: m.tagline, state: m.state, installable: true, registry: m.registry ?? undefined });
        return;
      }
      if (p.reset) launcher.current?.reset();
      if (p.query != null) launcher.current?.type(p.query);
      if (p.filter != null) launcher.current?.filter(p.filter);
      if (p.effect && p.item) { const { args, ...item } = p.item; launcher.current?.apply(item, p.effect, args ?? undefined); }
      if (p.toast) launcher.current?.toast({ style: "success", title: p.toast.title, message: p.toast.message ?? undefined } satisfies ToastSpec);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // `pal pick` (pick.rs): the rows as a picker level, the query typed; the answer goes back by token and the panel hides (the core cancels a pending pick on any hide).
  useEffect(() => {
    const un = listen<{ token: number; title: string; multi: boolean; query?: string; rows: PickRow[] }>("pal://pick", (e) => {
      const p = e.payload;
      launcher.current?.start(pickLevel(p.token, p.title, p.rows, p.multi));
      if (p.query) launcher.current?.type(p.query);
    });
    const unCancel = listen<{ token: number }>("pal://pick/cancel", () => launcher.current?.reset());
    return () => {
      un.then((f) => f());
      unCancel.then((f) => f());
    };
  }, []);
  const pickReply = useCallback((token: number, ids: string[] | null) => { invoke("pick_reply", { token, ids }).finally(() => { launcher.current?.reset(); hide(); }); }, [hide]);

  // Live views: a push for the level on top lands in place, a trigger re-asks it, and the shell hears which view is on top (views.rs).
  const viewOpen = useLiveViews(launcher);

  // The core's confirm card (a `pal://run` or `pal://install` link): the answer goes back by token.
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    const un = listen<Ask | null>("pal://confirm", (e) => setAsk(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, []);
  const answer = (ok: boolean) => {
    if (ask) emit("pal://confirm/reply", { token: ask.token, ok });
    setAsk(null);
    launcher.current?.focus();
  };
  // Over the panel, so the scrim and the card sit where the Launcher's own confirm does.
  const panel = document.querySelector(".pal-panel");

  // The welcome marker goes; the core puts the rows back and bumps the index.
  const welcome = useCallback(() => invoke("welcome_reset"), []);
  // "Copy deep link": the core hides the panel, copies with the bundle's scheme, and says so in the HUD.
  const link = useCallback((link: string) => invoke("link_copy", { link }), []);

  return (
    <>
      <Launcher ref={launcher} sources={sources} search={search} inline={inline} fallback={fallback} lateFallback={lateFallback} suggest={suggest} history={history} dialog={dialog} prefs={prefs} detail={detail} view={view} version={version} mark={mark} onHide={hide} onPick={pick} onSettings={() => invoke("settings_open")} onRefresh={refresh} onWelcome={welcome} onLink={link} onForget={forget} onPickReply={pickReply} onViewOpen={viewOpen} surface={surface} onCompact={() => invoke("settings_set", { key: "general.compact", value: !prefs.compact }).catch(() => {})} onPanelMode={(palette, mode) => invoke<PanelMode>("panel_mode", { palette, mode })} onPanelFit={panelFit} onHoldDrawn={() => invoke("panel_reveal").catch(() => {})} glance={glance} onGlance={glanceOpen} missing={missingInfo} onInstallMissing={installMissing} onOpened={opened} asking={!!ask} touch={remote?.touch} onLayers={remote?.onLayers} />
      {panel && createPortal(<Presence show={!!ask}>{ask && <Confirm title={ask.title} message={ask.message} action={ask.ok} onConfirm={() => answer(true)} onCancel={() => answer(false)} />}</Presence>, panel)}
    </>
  );
}
