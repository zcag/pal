import { useEffect, useReducer, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULTS, age, countLabel, exiting, initial, isModifier, liveText, reduce, rippleColor, showsCursor, showsKeys, visible, type Entry, type Payload, type Ripple, type State } from "./keycast";
// The tokens (the tag palette, the HUD's surface) and `.pal-kbd` come with the ui bundle: the caps are the panel's own key caps, larger.
import "./ui";
import "./keycast.css";

/** The page's clock while entries are up: each is marked exiting for its last 240 ms and dropped once its hold has ended. Driven here rather than by a CSS delay so an entry a scroll keeps updating never fades mid-gesture. */
const TICK_MS = 100;

/**
 * The `keycast` window's page (`index.html?keycast`): the overlay the shell
 * shows over the whole display under the cursor (keycast.rs). Everything
 * it draws arrives on `pal://keycast`: the strip's entries after every key,
 * the cursor's position and clicks, the display's insets, and the state
 * with the settings. Nothing else runs here: no list, no host.
 */
export default function KeycastPage() {
  const [st, dispatch] = useReducer(reduce, undefined, initial);
  useEffect(() => {
    const un = listen<Payload>("pal://keycast", (e) => dispatch(e.payload));
    // A page that loads while the overlay is on (or reloads) asks where things stand.
    invoke<{ active: boolean; mode: State["mode"]; settings: State["settings"] }>("keycast_state").then((s) => s.settings && dispatch({ kind: "state", active: s.active, mode: s.mode, settings: s.settings })).catch(() => {});
    return () => { un.then((f) => f()); };
  }, []);
  // Entries leave the DOM once their hold has ended; a keys payload puts the shell's pruned list back anyway.
  const hold = (st.settings ?? DEFAULTS).hold;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!st.entries.length) return;
    const t = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const kept = visible(st.entries, hold, t);
      if (kept.length !== st.entries.length) dispatch({ kind: "keys", entries: kept });
    }, TICK_MS);
    return () => clearInterval(t);
  }, [st.entries, hold]);
  if (!st.active || !st.settings) return <div className="pal-keycast-page" />;
  const s = st.settings;
  const [top, right, bottom, left] = st.inset;
  return (
    <div className="pal-keycast-page" style={{ "--kc-scale": s.scale, "--kc-hold": `${hold * 1000}ms`, "--kc-ring": `var(--pal-tag-${s.ring_color})` } as React.CSSProperties}>
      {showsKeys(st.mode) && (
        <div className="pal-keycast__area" style={{ inset: `${top}px ${right}px ${bottom}px ${left}px` }}>
          <div className="pal-keycast__strip" data-position={s.position} role="log" aria-live="off">
            {st.entries.map((e) => <Caps key={`${e.id}:${e.count}`} entry={e} age={age(e, hold, now)} live={liveText(e, st.entries, now)} out={exiting(e, hold, now)} />)}
          </div>
        </div>
      )}
      {showsCursor(st.mode) && (
        <div className="pal-keycast__cursor" aria-hidden>
          {s.ring && st.cursor && <i className="pal-keycast__ring" data-down={st.down || undefined} style={{ transform: `translate(${st.cursor.x}px, ${st.cursor.y}px)` }} />}
          {st.ripples.map((r) => <RippleMark key={r.id} ripple={r} ring={s.ring_color} onDone={() => dispatch({ kind: "ripple-done", id: r.id })} />)}
        </div>
      )}
    </div>
  );
}

/** One entry: a run of typing as text (a caret while it still takes characters), anything else as caps with the modifiers marked, the repeat count as a badge; `age` fades it, `out` for its last moments. A scroll's `level` sizes its arrow. */
function Caps({ entry, age, live, out }: { entry: Entry; age: number; live: boolean; out: boolean }) {
  const count = countLabel(entry.count);
  return (
    <div className="pal-keycast__entry" data-kind={entry.kind} data-level={entry.level || undefined} data-exiting={out || undefined} style={{ "--kc-age": age } as React.CSSProperties}>
      {entry.kind === "text" ? (
        <span className="pal-keycast__text" data-live={live || undefined}>{entry.keys[0]}</span>
      ) : (
        <span className="pal-kbd">{entry.keys.map((k, i) => <kbd key={i} data-mod={isModifier(k) || undefined} data-wide={k.length > 2 || undefined}>{k}</kbd>)}</span>
      )}
      {count && <span className="pal-keycast__count">{count}</span>}
    </div>
  );
}

/** A click's ripple, gone once its animation ends. */
function RippleMark({ ripple, ring, onDone }: { ripple: Ripple; ring: string; onDone: () => void }) {
  return <i className="pal-keycast__ripple" data-button={ripple.button} style={{ left: ripple.x, top: ripple.y, "--kc-ripple": `var(--pal-tag-${rippleColor(ripple.button, ring)})` } as React.CSSProperties} onAnimationEnd={onDone} />;
}
