import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Launcher, type LauncherHandle } from "./Launcher";
import { mark, useCore } from "./core";
import { Confirm, Presence } from "./ui";

const hide = () => invoke("hide");

/** A confirm card the core asks for (`pal://confirm`, deeplink.rs); `null` drops the one up. */
type Ask = { title: string; message?: string; ok: string; cancel: string; token: number };

export default function App() {
  const { sources, version, bump, showing, search, detail, view, pick, refresh } = useCore(hide);
  const launcher = useRef<LauncherHandle>(null);

  // A copy landed in history: re-list, but only when the clipboard palette is what is showing.
  useEffect(() => {
    const un = listen("pal://clipboard", () => { if (showing.current?.extension === "clipboard") bump(); });
    return () => {
      un.then((f) => f());
    };
  }, [bump, showing]);

  // hotkey -> painted panel; a palette hotkey names where to open
  useEffect(() => {
    const un = listen<{ t0: number; palette?: string }>("pal://shown", (e) => {
      if (e.payload.palette) launcher.current?.open(e.payload.palette);
      else launcher.current?.reset();
      requestAnimationFrame(() => mark("hotkey->paint ms", Date.now() - e.payload.t0));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // A `pal://` link: the query to type (after the palette `pal://shown` opened), at the root when asked.
  useEffect(() => {
    const un = listen<{ query?: string; reset?: boolean }>("pal://deeplink", (e) => {
      if (e.payload.reset) launcher.current?.reset();
      if (e.payload.query !== undefined) launcher.current?.type(e.payload.query);
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

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

  return (
    <>
      <Launcher ref={launcher} sources={sources} search={search} detail={detail} view={view} version={version} mark={mark} onHide={hide} onPick={pick} onSettings={() => invoke("settings_open")} onRefresh={refresh} onWelcome={welcome} />
      {panel && createPortal(<Presence show={!!ask}>{ask && <Confirm title={ask.title} message={ask.message} action={ask.ok} onConfirm={() => answer(true)} onCancel={() => answer(false)} />}</Presence>, panel)}
    </>
  );
}
