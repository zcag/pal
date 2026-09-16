import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Hud, Presence } from "./ui";
import type { Icon } from "./ui/types";

/** Brief's HUD motion: in 120, hold 900, out 240 (tokens.css; hud.rs hides the window after the out). */
const IN_PLUS_HOLD = 120 + 900;

type Payload = { text: string; icon?: Icon; celebrate?: boolean };

/**
 * The `hud` window's page (`index.html?hud`): the capsule at the bottom
 * centre, shown for every `pal://hud` the shell emits (hud.rs). Nothing else
 * runs here: no list, no host, so the page stays cheap while it idles hidden.
 */
export default function HudPage() {
  const [hud, setHud] = useState<Payload | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const un = listen<Payload>("pal://hud", (e) => {
      clearTimeout(timer.current);
      setHud(e.payload);
      timer.current = setTimeout(() => setHud(null), IN_PLUS_HOLD);
    });
    return () => {
      clearTimeout(timer.current);
      un.then((f) => f());
    };
  }, []);
  return (
    <div className="pal-hud-page">
      <Presence show={!!hud} dur="hud-out">{hud && <Hud text={hud.text} icon={hud.icon} celebrate={hud.celebrate} />}</Presence>
    </div>
  );
}
