import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Launcher, pickLevel, type LauncherHandle, type PickRow } from "./Launcher";
import { mark, useCore, usePrefs, useLiveViews } from "./core";
import { Confirm, Presence, type ToastSpec } from "./ui";
import { SHOWN_EVENT } from "./ui/virtual";
import type { Effect } from "./items";
import type { Item } from "./ui/types";

const hide = () => invoke("hide");

/** A confirm card the core asks for (`pal://confirm`, deeplink.rs); `null` drops the one up. */
type Ask = { title: string; message?: string; ok: string; cancel: string; token: number };

export default function App() {
  const { sources, version, bump, showing, search, inline, fallback, suggest, history, dialog, forget, detail, view, pick, refresh } = useCore(hide);
  const prefs = usePrefs();
  const launcher = useRef<LauncherHandle>(null);

  // A copy landed in history: re-list, but only when the clipboard palette is what is showing.
  useEffect(() => {
    const un = listen("pal://clipboard", () => { if (showing.current?.extension === "clipboard") bump(); });
    return () => {
      un.then((f) => f());
    };
  }, [bump, showing]);

  // hotkey -> painted panel; a palette hotkey names where to open, the switcher's chord adds `hold` (switcher.rs); `keep` (general.pop_to_root, pop.rs) leaves the level and query as they were
  useEffect(() => {
    const un = listen<{ t0: number; palette?: string; keep?: boolean; hold?: boolean }>("pal://shown", (e) => {
      if (e.payload.palette) launcher.current?.open(e.payload.palette, { hold: !!e.payload.hold });
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
    type Delivered = { query?: string | null; filter?: string | null; reset?: boolean; effect?: Effect; item?: Item & { args?: unknown }; toast?: { title: string; message?: string | null } };
    const un = listen<Delivered>("pal://deeplink", (e) => {
      const p = e.payload;
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
  const pickReply = useCallback((token: number, ids: string[] | null) => { invoke("pick_reply", { token, ids }).finally(() => { launcher.current?.reset(); hide(); }); }, []);

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
      <Launcher ref={launcher} sources={sources} search={search} inline={inline} fallback={fallback} suggest={suggest} history={history} dialog={dialog} prefs={prefs} detail={detail} view={view} version={version} mark={mark} onHide={hide} onPick={pick} onSettings={() => invoke("settings_open")} onRefresh={refresh} onWelcome={welcome} onLink={link} onForget={forget} onPickReply={pickReply} onViewOpen={viewOpen} onCompact={() => invoke("settings_set", { key: "general.compact", value: !prefs.compact }).catch(() => {})} />
      {panel && createPortal(<Presence show={!!ask}>{ask && <Confirm title={ask.title} message={ask.message} action={ask.ok} onConfirm={() => answer(true)} onCancel={() => answer(false)} />}</Presence>, panel)}
    </>
  );
}
