import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { display, fit, isCode } from "./large";
// The tokens and the `pal-rise` keyframe come with the ui bundle; the page draws nothing from it.
import "./ui";
import "./large.css";

/**
 * The `large` window's page (`index.html?large`): the text across the
 * screen for every `pal://large` the shell emits (large.rs), sized to
 * the window by `fit`. Any key or a click dismisses it (the shell hides
 * the window on `large_hide`; it also hides after 8 s and on focus
 * loss). Nothing else runs here.
 */
export default function LargePage() {
  const [text, setText] = useState<string | null>(null);
  const [size, setSize] = useState(MINIMUM);
  const box = useRef<HTMLDivElement>(null);
  const hide = () => { setText(null); invoke("large_hide").catch(() => {}); };
  useEffect(() => {
    mark("large:page ready");
    const un = listen<{ text: string }>("pal://large", (e) => { setText(e.payload.text); mark(`large:text ${e.payload.text.length} chars`); });
    const onKey = (e: KeyboardEvent) => { e.preventDefault(); hide(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); un.then((f) => f()); };
  }, []);
  // Sized against the window as it is when the text arrives (the shell places it before the show).
  useLayoutEffect(() => {
    if (text === null) return;
    const el = box.current;
    const w = el?.clientWidth || window.innerWidth, h = el?.clientHeight || window.innerHeight;
    setSize(fit(display(text), w, h));
  }, [text]);
  return (
    <div className="pal-large-page" ref={box} onMouseDown={hide}>
      {text !== null && (
        <div className="pal-large" role="status" data-code={isCode(text) || undefined} style={{ fontSize: size }}>
          {display(text)}
        </div>
      )}
    </div>
  );
}

const MINIMUM = 28;
/** A line in the shell's log (`mark\t...`), the page's only trace: when it is ready and what it was given. */
const mark = (name: string) => invoke("mark", { name, t: Date.now() }).catch(() => {});
